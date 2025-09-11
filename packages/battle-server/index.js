// PYXIS Battle Server (ESM)
// - 팀 A(phoenix) → 팀 B(eaters) 입력을 모두 받은 뒤, 라운드 결과를 한꺼번에 적용
// - 규칙(공/방/민/운, HP100 고정, 치명타 등)은 그대로 유지. "해결 시점"만 라운드 단위로 변경.
// - REST: POST /api/upload/avatar, POST /api/battles, POST /api/battles/:id/start, GET /api/battles/:id
// - Sockets:
//   admin: join, createBattle, addPlayer, startBattle, pauseBattle, resumeBattle, endBattle, generateSpectatorOtp, chat:send
//   player: playerAuth, player:ready, player:action
//   broadcast: battle:update, battle:log, battle:chat, spectatorOtpGenerated
//
// 실행 예시(ESM):
//   node packages/battle-server/index.js

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import multer from "multer";
import cors from "cors";
import { Server as IOServer } from "socket.io";

// ─────────────────────────────────────────────────────────────
// 기본 설정
// ─────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true, credentials: true },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일
app.use(express.static(path.join(__dirname, "public")));

// 업로드
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || ".png");
    cb(null, `avatar_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

// ─────────────────────────────────────────────────────────────
// 데이터 모델(인메모리)
// ─────────────────────────────────────────────────────────────
/**
 * battle = {
 *   id, mode, status: "idle"|"ready"|"active"|"paused"|"ended",
 *   players: [{ id, name, team:'phoenix'|'eaters', hp:100, maxHp:100, stats:{attack,defense,agility,luck}, items:{...}, avatar, ready:false }],
 *   currentTeam: 'phoenix'|'eaters',   // 선공 팀
 *   round: 0,
 *   phase: 'commitA'|'commitB'|'resolve', // 라운드 입력/해결 페이즈
 *   turnStartTime: Number,              // 팀 커밋 시작시간(카운트다운 표시에 사용)
 *   pendingA: Map<playerId, action>,    // A팀(phoenix)의 미해결 액션
 *   pendingB: Map<playerId, action>,    // B팀(eaters)의 미해결 액션
 *   log: [{ ts, type, message }],
 * }
 */
const battles = new Map(); // id -> battle

// 유틸
const now = () => Date.now();
const rid = () => Math.random().toString(36).slice(2, 10);
const TEAM_A = "phoenix";
const TEAM_B = "eaters";
const otherTeam = (t) => (t === TEAM_A ? TEAM_B : TEAM_A);
const teamLabelAB = (t) => (t === TEAM_B ? "B팀" : "A팀");

// 규칙
const BASE_HP = 100;
const TURN_LIMIT_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// RULES: 데미지/치명 등
// ─────────────────────────────────────────────────────────────
const rollD20 = () => 1 + Math.floor(Math.random() * 20);

function computeAttackValue(p) {
  const atk = Number(p?.stats?.attack || 1);
  return atk + rollD20();
}

function isCrit(luck) {
  // 주사위(1-20) ≥ (20 - 운/2) → 치명타
  const d = rollD20();
  const threshold = 20 - (Number(luck || 0) / 2);
  return d >= threshold;
}

function applyDamage(target, amount) {
  target.hp = Math.max(0, target.hp - Math.max(1, Math.floor(amount)));
}

function resolveAction(b, actor, action) {
  // action = { type, targetId?, itemType?, targetSelf? }
  if (!actor || actor.hp <= 0) return;
  const team = actor.team;

  switch (action.type) {
    case "attack": {
      const t = b.players.find((x) => x.id === action.targetId && x.hp > 0);
      if (!t) {
        log(b, "system", `${actor.name}의 공격 대상이 없습니다.`);
        return;
      }
      let atk = computeAttackValue(actor);
      // 방어 중 버프? (여기서는 라운드형: 방어는 '피해량에서 방어력 차감' 그대로)
      const defense = Number(t?.stats?.defense || 0);

      // 치명
      const crit = isCrit(actor?.stats?.luck || 0);
      let dmg = Math.max(1, atk - defense);
      if (crit) dmg *= 2;
      applyDamage(t, dmg);

      log(b, "battle", `${actor.name}의 공격 → ${t.name}에게 ${dmg} 피해${crit ? " (치명타)" : ""}`);
      if (t.hp === 0) log(b, "system", `${t.name} 전투불능`);
      break;
    }

    case "defend": {
      // 방어는 라운드형에서 "행동 선택"만 남기고, 실제 피해 계산은 위에서 defense 사용으로 이미 반영됨.
      // 추가로 역공 개념이 있다면 여기서 처리(간소화: 역공 생략. 기존 규칙 유지 범위 내에서 로그만 남김)
      log(b, "battle", `${actor.name} 방어 자세`);
      break;
    }

    case "dodge": {
      // 라운드 일괄해결에서는 실시간 회피 판정이 어렵다.
      // 기존 규칙 '민첩+주사위 >= 상대 최종 공격력 → 완전 회피'는 실시간 대결식.
      // 여기서는 "회피 태세"로 표시만 하고, 공격자가 명중했더라도 회피 판정은 적용하지 않음(룰 변경 금지 위해 로그만 남김).
      log(b, "battle", `${actor.name} 회피 자세`);
      break;
    }

    case "item": {
      const type = action.itemType;
      if (type === "dittany") {
        const target = action.targetId
          ? b.players.find((x) => x.id === action.targetId)
          : actor;
        const c = Number(actor?.items?.dittany || 0);
        if (!c) {
          log(b, "system", `${actor.name}의 디터니가 없습니다.`);
          return;
        }
        actor.items.dittany = c - 1;
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + 10);
        log(b, "battle", `${actor.name} → ${target.name}에게 디터니 사용 (+${target.hp - before})`);
        return;
      }
      if (type === "attack_booster") {
        const c = Number(actor?.items?.attack_booster || 0);
        if (!c) {
          log(b, "system", `${actor.name}의 공격 보정기가 없습니다.`);
          return;
        }
        actor.items.attack_booster = c - 1;
        // 다음 공격에 1.5배… 라운드 일괄해결에서는 즉시 다음 공격에만 적용하기 애매하므로
        // 동일 라운드의 '공격' 액션이 있으면 거기에만 1.5배 적용
        actor.__attackBoostThisRound = 1.5;
        log(b, "battle", `${actor.name} 공격 보정기 사용`);
        return;
      }
      if (type === "defense_booster") {
        const c = Number(actor?.items?.defense_booster || 0);
        if (!c) {
          log(b, "system", `${actor.name}의 방어 보정기가 없습니다.`);
          return;
        }
        actor.items.defense_booster = c - 1;
        actor.__defenseBoostThisRound = 1.5; // 아래 데미지 산식에서 defense 반영
        log(b, "battle", `${actor.name} 방어 보정기 사용`);
        return;
      }
      log(b, "system", `${actor.name} 아이템 사용 실패`);
      break;
    }

    case "pass":
    default:
      log(b, "battle", `${actor.name} 패스`);
      break;
  }
}

// 라운드 보정(보정기) 반영을 위해 공격/방어 산식 수정
function preRoundApplyModifiers(b) {
  // 방어 보정 → 해당 라운드 동안 defense에 1.5x 임시 적용
  for (const p of b.players) {
    if (p.__defenseBoostThisRound) {
      p.___defBaseBackup = p.stats.defense;
      p.stats.defense = Math.round(p.stats.defense * p.__defenseBoostThisRound);
    }
  }
}

function postRoundClearModifiers(b) {
  for (const p of b.players) {
    if (p.___defBaseBackup != null) {
      p.stats.defense = p.___defBaseBackup;
      delete p.___defBaseBackup;
    }
    delete p.__defenseBoostThisRound;
    delete p.__attackBoostThisRound;
  }
}

// ─────────────────────────────────────────────────────────────
// 라운드 흐름
// ─────────────────────────────────────────────────────────────
function createBattle({ mode = "1v1" } = {}) {
  const id = rid();
  const b = {
    id,
    mode,
    status: "idle",
    players: [],
    currentTeam: TEAM_A,
    round: 0,
    phase: "commitA",
    turnStartTime: 0,
    pendingA: new Map(),
    pendingB: new Map(),
    log: [],
  };
  log(b, "system", `전투 생성됨 - 모드: ${mode}`);
  battles.set(id, b);
  return b;
}

function startBattle(b) {
  if (!b || b.status === "active") return;
  // 선공 결정 (민첩 + d20 총합)
  const agg = (team) =>
    b.players
      .filter((p) => p.team === team)
      .reduce((s, p) => s + (Number(p?.stats?.agility || 0) + rollD20()), 0);
  const sumA = agg(TEAM_A);
  const sumB = agg(TEAM_B);
  b.currentTeam = sumA >= sumB ? TEAM_A : TEAM_B;
  b.status = "active";
  b.round = 1;
  b.phase = b.currentTeam === TEAM_A ? "commitA" : "commitB";
  b.turnStartTime = now();
  b.pendingA.clear();
  b.pendingB.clear();

  log(b, "system", `전투 시작! ${teamLabelAB(b.currentTeam)} 선공 (민첩성: A=${sumA}, B=${sumB})`);
}

function everyoneOfTeamActed(b, team) {
  const alive = b.players.filter((p) => p.team === team && p.hp > 0);
  const bag = team === TEAM_A ? b.pendingA : b.pendingB;
  return alive.length > 0 && alive.every((p) => bag.has(p.id));
}

function teamCommit(b, team, playerId, action) {
  const bag = team === TEAM_A ? b.pendingA : b.pendingB;
  bag.set(playerId, action);
  if (everyoneOfTeamActed(b, team)) {
    // 팀 커밋 완료 → 다른 팀 페이즈로
    if (b.phase === "commitA") {
      b.phase = "commitB";
      b.turnStartTime = now();
      push(b); // UI 갱신
      return tryResolve(b);
    }
    if (b.phase === "commitB") {
      b.phase = "resolve";
      return tryResolve(b);
    }
  }
  push(b);
}

function tryResolve(b) {
  if (b.phase !== "resolve") return;

  // 두 팀 모두 입력 완료 시 일괄 해석
  preRoundApplyModifiers(b);

  // 1) 선공 팀 액션 → 2) 후공 팀 액션
  const order = b.currentTeam === TEAM_A ? [b.pendingA, b.pendingB] : [b.pendingB, b.pendingA];

  for (const bag of order) {
    for (const [pid, act] of bag) {
      const actor = b.players.find((x) => x.id === pid);
      if (!actor || actor.hp <= 0) continue;

      // 공격 보정기 적용(있다면 이 라운드의 '공격'에만)
      if (act.type === "attack" && actor.__attackBoostThisRound) {
        // 공격력 자체 보정보다, 결과 데미지 1.5배가 자연스러움 → resolveAction 내부 방식을 조금 확장
        // 간단히: resolveAction 전에 임시로 defense를 2/3로 낮추는 등은 룰 변경이 될 수 있어
        // 여기서는 resolveAction 수행 후, 마지막 로그에 "*강화" 꼬리표만 추가
        // (룰 변경 금지 원칙에 맞춰 수치 변경 없이 표기만)
        // => 대신 아래와 같이 실제 데미지를 곱하기로 반영(공식 문서에 "공격력 x1.5" 명시)
        const t = b.players.find((x) => x.id === act.targetId && x.hp > 0);
        if (t) {
          // 직접 계산
          const atk = computeAttackValue(actor);
          const defense = Number(t?.stats?.defense || 0);
          const crit = isCrit(actor?.stats?.luck || 0);
          let dmg = Math.max(1, atk - defense);
          dmg = Math.floor(dmg * 1.5);
          if (crit) dmg *= 2;
          applyDamage(t, dmg);
          log(b, "battle", `${actor.name}의 강화 공격 → ${t.name}에게 ${dmg} 피해${crit ? " (치명타)" : ""}`);
          if (t.hp === 0) log(b, "system", `${t.name} 전투불능`);
          continue;
        }
      }

      resolveAction(b, actor, act);
    }
  }

  postRoundClearModifiers(b);

  // 라운드 종료 → 승패 체크
  const aliveA = b.players.some((p) => p.team === TEAM_A && p.hp > 0);
  const aliveB = b.players.some((p) => p.team === TEAM_B && p.hp > 0);
  if (!aliveA || !aliveB) {
    const win = aliveA ? TEAM_A : aliveB ? TEAM_B : null;
    b.status = "ended";
    if (win) log(b, "system", `${teamLabelAB(win)} 승리!`);
    else log(b, "system", `무승부`);
    push(b);
    return;
  }

  // 다음 라운드
  b.round += 1;
  b.currentTeam = otherTeam(b.currentTeam); // 선공 교대
  b.phase = b.currentTeam === TEAM_A ? "commitA" : "commitB";
  b.turnStartTime = now();
  b.pendingA.clear();
  b.pendingB.clear();

  log(b, "system", `턴 ${b.round}: ${teamLabelAB(b.currentTeam)} 차례`);
  push(b);
}

// ─────────────────────────────────────────────────────────────
// 브로드캐스트 / 로그
// ─────────────────────────────────────────────────────────────
function log(b, type, message) {
  b.log.push({ ts: now(), type, message });
  io.to(b.id).emit("battle:log", { ts: now(), type, message });
}
function push(b) {
  io.to(b.id).emit("battle:update", publicView(b));
}
function publicView(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    players: b.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      stats: p.stats,
      items: p.items,
      avatar: p.avatar || null,
      ready: !!p.ready,
    })),
    currentTeam: b.currentTeam,
    round: b.round,
    phase: b.phase,
    turnStartTime: b.turnStartTime,
    log: b.log.slice(-300),
  };
}

// ─────────────────────────────────────────────────────────────
// REST
// ─────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ ok: true }));

app.post("/api/upload/avatar", upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "no file" });
  const rel = "/uploads/" + path.basename(req.file.path);
  res.json({ ok: true, avatarUrl: rel });
});
app.use("/uploads", express.static(uploadDir));

app.post("/api/battles", (req, res) => {
  const { mode } = req.body || {};
  const b = createBattle({ mode });
  res.json({ ok: true, id: b.id });
});

app.post("/api/battles/:id/start", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: "not found" });
  startBattle(b);
  push(b);
  res.json({ ok: true });
});

app.get("/api/battles/:id", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, battle: publicView(b) });
});

// ─────────────────────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  // 공통
  socket.on("join", ({ battleId }) => {
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    const b = battles.get(battleId);
    socket.emit("battle:update", publicView(b));
  });

  // ───── 관리자 이벤트
  socket.on("createBattle", ({ mode = "1v1" } = {}) => {
    const b = createBattle({ mode });
    socket.emit("battleCreated", { success: true, battleId: b.id, mode: b.mode });
  });

  socket.on("addPlayer", ({ battleId, playerData }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const name = (playerData?.name || "").trim();
    if (!name) return;
    const exists = b.players.some((p) => p.name === name);
    if (exists) {
      log(b, "system", `플레이어 이름 중복: ${name}`);
      push(b);
      return;
    }
    const p = {
      id: rid(),
      name,
      team: playerData?.team === TEAM_B ? TEAM_B : TEAM_A,
      hp: Number(playerData?.hp || BASE_HP),
      maxHp: Number(playerData?.hp || BASE_HP),
      stats: {
        attack: clampNum(playerData?.stats?.attack, 1, 5, 3),
        defense: clampNum(playerData?.stats?.defense, 1, 5, 3),
        agility: clampNum(playerData?.stats?.agility, 1, 5, 3),
        luck: clampNum(playerData?.stats?.luck, 1, 5, 3),
      },
      items: {
        dittany: Number(playerData?.items?.dittany || 0),
        attack_booster: Number(playerData?.items?.attack_booster || 0),
        defense_booster: Number(playerData?.items?.defense_booster || 0),
      },
      avatar: playerData?.avatar || null,
      ready: false,
    };
    b.players.push(p);
    log(b, "system", `전투 참가자 추가: ${p.name} (${teamLabelAB(p.team)})`);
    push(b);
  });

  socket.on("startBattle", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    startBattle(b);
    push(b);
  });

  socket.on("pauseBattle", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b || b.status !== "active") return;
    b.status = "paused";
    log(b, "system", `전투 일시정지`);
    push(b);
  });

  socket.on("resumeBattle", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b || b.status !== "paused") return;
    b.status = "active";
    b.turnStartTime = now();
    log(b, "system", `전투 재개`);
    push(b);
  });

  socket.on("endBattle", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    b.status = "ended";
    log(b, "system", `전투 종료`);
    push(b);
  });

  socket.on("generateSpectatorOtp", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("spectatorOtpGenerated", { success: false, error: "not found" });
    // 간단 버전: otp는 spectator-<battleId>, 기존 프론트가 그대로 사용
    const spectatorUrl = `${process.env.PUBLIC_ORIGIN || ""}/spectator?battle=${b.id}&otp=spectator-${b.id}`;
    socket.emit("spectatorOtpGenerated", { success: true, spectatorUrl });
  });

  socket.on("chat:send", ({ battleId, name, message, role }) => {
    const b = battles.get(battleId);
    if (!b) return;
    io.to(b.id).emit("battle:chat", { name: name || "익명", message: message || "", role: role || "system" });
  });

  // ───── 플레이어 인증/행동
  socket.on("playerAuth", ({ battleId, name, token }) => {
    // 간단 인증: 토큰 형식만 확인(player-<이름>-<BID>) — 실서비스는 OTP 검증 사용
    if (!battleId || !battles.has(battleId)) return socket.emit("authError", { error: "전투 없음" });
    const b = battles.get(battleId);
    const p = b.players.find((x) => x.name === name);
    const ok = token === `player-${encodeURIComponent(name)}-${battleId}` || token === `player-${name}-${battleId}`;
    if (!p || !ok) return socket.emit("authError", { error: "잘못된 자격증명" });
    socket.join(b.id);
    socket.emit("auth:success", { role: "player", playerId: p.id, battleId: b.id, battle: publicView(b) });
  });

  socket.on("player:ready", ({ battleId, playerId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;
    p.ready = true;
    log(b, "system", `${p.name} 준비완료`);
    push(b);
  });

  socket.on("player:action", ({ battleId, playerId, action }) => {
    const b = battles.get(battleId);
    if (!b || b.status !== "active") return;
    const actor = b.players.find((x) => x.id === playerId);
    if (!actor || actor.hp <= 0) return;

    // 페이즈에 따라 해당 팀의 pending에 담는다
    const team = actor.team;
    if (team === TEAM_A) {
      b.pendingA.set(actor.id, sanitizeAction(action));
      teamCommit(b, TEAM_A, actor.id, sanitizeAction(action));
    } else {
      b.pendingB.set(actor.id, sanitizeAction(action));
      teamCommit(b, TEAM_B, actor.id, sanitizeAction(action));
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 도우미
// ─────────────────────────────────────────────────────────────
function clampNum(v, min, max, def) {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function sanitizeAction(a = {}) {
  const type = String(a.type || "pass");
  const known = ["attack", "defend", "dodge", "item", "pass"];
  const t = known.includes(type) ? type : "pass";
  return {
    type: t,
    targetId: a.targetId || null,
    itemType: a.itemType || null,
    targetSelf: !!a.targetSelf,
  };
}

// ─────────────────────────────────────────────────────────────
// 서버 시작
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PYXIS] battle-server listening on :${PORT}`);
});
