// PYXIS Battle Server (ESM)
// 턴 구조(라운드 단위):
//   1턴: 선공 전원 커밋 → 후공 전원 커밋 → 일괄 해석(= 1턴 종료)
//   2턴: (이전 턴의 후공이 선공이 됨) 후공 전원 커밋 → 선공 전원 커밋 → 일괄 해석
//   3턴: 다시 반전 … 반복
//
// 규칙 고정 유지(공/방/민/운, 치명타, 회피/방어/역공, 아이템 일시 보정 등).
// currentTeam: "지금 커밋을 입력 중인 팀" (UI에서 현재 턴 표시에 사용)
// commitFirstTeam: "이번 턴에 먼저 입력해야 하는 팀"(턴마다 반전)
// phase: commitA → commitB → resolve
//
// REST:  POST /api/upload/avatar, POST /api/battles, POST /api/battles/:id/start, GET /api/battles/:id
// Socket:
//   admin: join, createBattle, addPlayer, startBattle, pauseBattle, resumeBattle, endBattle, generateSpectatorOtp, chat:send
//   player: playerAuth, player:ready, player:action
//   broadcast: battle:update, battle:log, battle:chat, spectatorOtpGenerated
//
// 실행: node packages/battle-server/index.js

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
const io = new IOServer(server, { cors: { origin: true, credentials: true } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
app.use("/uploads", express.static(uploadDir));

// ─────────────────────────────────────────────────────────────
// 모델(메모리)
// ─────────────────────────────────────────────────────────────
const battles = new Map();

const TEAM_A = "phoenix";
const TEAM_B = "eaters";
const BASE_HP = 100;
const TURN_MS = 5 * 60 * 1000;

const now = () => Date.now();
const rid = () => Math.random().toString(36).slice(2, 10);
const otherTeam = (t) => (t === TEAM_A ? TEAM_B : TEAM_A);
const teamAB = (t) => (t === TEAM_B ? "B팀" : "A팀");

function createBattle({ mode = "1v1" } = {}) {
  const id = rid();
  const b = {
    id,
    mode,
    status: "idle",
    players: [],
    // 라운드 상태
    round: 0,
    // 이번 턴에 먼저 입력해야 하는 팀(턴마다 반전)
    commitFirstTeam: TEAM_A,
    // 지금 커밋을 받고 있는 팀(= UI에서 현재 턴 표기)
    currentTeam: TEAM_A,
    phase: "commitA",
    turnStartTime: 0,

    pendingA: new Map(), // playerId -> action
    pendingB: new Map(),

    log: [],
  };
  log(b, "system", `전투 생성됨 - 모드: ${mode}`);
  battles.set(id, b);
  return b;
}

// ─────────────────────────────────────────────────────────────
// 규칙 유틸(문서 규칙 유지)
// ─────────────────────────────────────────────────────────────
const d20 = () => 1 + Math.floor(Math.random() * 20);

function finalAttack(p, atkBoost = false) {
  // "공격 보정기(1턴) = 공격력 x1.5" → 최종 공격력 산식에 반영
  const base = Number(p?.stats?.attack || 1);
  const boosted = atkBoost ? Math.round(base * 1.5) : base;
  return boosted + d20();
}
function critHappens(luck) {
  // d20 ≥ (20 - 운/2) → 치명 2배
  const dice = d20();
  const th = 20 - (Number(luck || 0) / 2);
  return dice >= th;
}
function applyDamage(target, dmg) {
  target.hp = Math.max(0, target.hp - Math.max(1, Math.floor(dmg)));
}

// ─────────────────────────────────────────────────────────────
// 전투 시작/턴 흐름
// ─────────────────────────────────────────────────────────────
function startBattle(b) {
  if (!b || b.status === "active") return;

  // 선공 결정: 팀별 (민첩 + d20) 합계 비교
  const sumFor = (team) =>
    b.players
      .filter((p) => p.team === team)
      .reduce((s, p) => s + (Number(p?.stats?.agility || 0) + d20()), 0);

  const sumA = sumFor(TEAM_A);
  const sumB = sumFor(TEAM_B);
  b.commitFirstTeam = sumA >= sumB ? TEAM_A : TEAM_B; // 1턴 선공
  // 1턴은 선공이 먼저 커밋
  b.currentTeam = b.commitFirstTeam;
  b.phase = b.commitFirstTeam === TEAM_A ? "commitA" : "commitB";

  b.status = "active";
  b.round = 1;
  b.turnStartTime = now();
  b.pendingA.clear();
  b.pendingB.clear();

  log(b, "system", `전투 시작! ${teamAB(b.commitFirstTeam)} 선공 (민첩성: A=${sumA}, B=${sumB})`);
  push(b);
}

function everyoneActed(b, team) {
  const alive = b.players.filter((p) => p.team === team && p.hp > 0);
  const bag = team === TEAM_A ? b.pendingA : b.pendingB;
  return alive.length > 0 && alive.every((p) => bag.has(p.id));
}

function teamCommit(b, team, playerId, action) {
  const bag = team === TEAM_A ? b.pendingA : b.pendingB;
  bag.set(playerId, action);

  if (everyoneActed(b, team)) {
    // 이번 턴의 첫 커밋 팀이 모두 입력 → 다음은 반대 팀 커밋
    if (b.phase === "commitA") {
      b.phase = "commitB";
      b.currentTeam = TEAM_B;            // UI: 지금은 B팀 입력 중
      b.turnStartTime = now();           // 타이머 전환
      push(b);
      tryResolve(b);                     // 두 팀 다 끝났다면 resolve 내부에서 처리
      return;
    }
    if (b.phase === "commitB") {
      b.phase = "resolve";
      // UI에선 resolve 동안 currentTeam을 유지해도 무방
      tryResolve(b);
      return;
    }
  }
  push(b);
}

function tryResolve(b) {
  if (b.phase !== "resolve") return;

  // 방어 보정기(1턴) 임시 적용: 방어력 x1.5
  const defBackup = new Map();
  for (const p of b.players) {
    if (p.__defenseBoostThisRound) {
      defBackup.set(p.id, p.stats.defense);
      p.stats.defense = Math.round(p.stats.defense * 1.5);
    }
  }

  // 같은 라운드에서 플레이어가 어떤 액션을 선택했는지 조회
  const actOf = (pid) => {
    if (b.pendingA.has(pid)) return b.pendingA.get(pid);
    if (b.pendingB.has(pid)) return b.pendingB.get(pid);
    return null;
  };

  // "이번 턴에 먼저 커밋한 팀"이 항상 먼저 처리되도록 순서 결정
  const order =
    b.commitFirstTeam === TEAM_A ? [b.pendingA, b.pendingB] : [b.pendingB, b.pendingA];

  for (const bag of order) {
    for (const [pid, action] of bag) {
      const actor = b.players.find((x) => x.id === pid);
      if (!actor || actor.hp <= 0) continue;

      const atkBoost = !!actor.__attackBoostThisRound;

      switch (action.type) {
        case "attack": {
          const target = b.players.find((x) => x.id === action.targetId && x.hp > 0);
          if (!target) { log(b, "system", `${actor.name}의 공격 대상이 없습니다.`); break; }

          const atkVal = finalAttack(actor, atkBoost);
          const crit = critHappens(actor?.stats?.luck || 0);

          const targetAct = actOf(target.id);

          // 회피: 민첩 + d20 ≥ 상대 최종공격력 → 완전 회피
          if (targetAct?.type === "dodge") {
            const dodgeVal = Number(target?.stats?.agility || 0) + d20();
            if (dodgeVal >= atkVal) {
              log(b, "battle", `${actor.name}의 공격을 ${target.name}이(가) 회피`);
              break;
            }
            // 실패: 방어력 차감 없이 정면 피해
            let dmg = atkVal;
            if (crit) dmg *= 2;
            applyDamage(target, dmg);
            log(b, "battle", `${actor.name}의 공격 명중 → ${target.name}에게 ${dmg} 피해${crit ? " (치명타)" : ""}`);
            if (target.hp === 0) log(b, "system", `${target.name} 전투불능`);
            break;
          }

          // 방어: 피해 = 최종공격력 - 방어력(최소1), 이후 역공격(방어 불가)
          if (targetAct?.type === "defend") {
            const defense = Number(target?.stats?.defense || 0);
            let dmg = Math.max(1, atkVal - defense);
            if (crit) dmg *= 2;
            applyDamage(target, dmg);
            log(b, "battle", `${target.name} 방어 → ${actor.name}의 공격 피해 ${dmg} 적용${crit ? " (치명타)" : ""}`);
            if (target.hp === 0) { log(b, "system", `${target.name} 전투불능`); break; }

            // 역공 (상대 방어 불가)
            const cc = Number(target?.stats?.attack || 1) + d20();
            applyDamage(actor, cc);
            log(b, "battle", `${target.name}의 역공격 → ${actor.name}에게 ${cc} 피해`);
            if (actor.hp === 0) log(b, "system", `${actor.name} 전투불능`);
            break;
          }

          // 일반 피격(방어/회피 선택 아님): 방어력 차감 없이 정면 피해
          let dmg = atkVal;
          if (crit) dmg *= 2;
          applyDamage(target, dmg);
          log(b, "battle", `${actor.name}의 공격 → ${target.name}에게 ${dmg} 피해${crit ? " (치명타)" : ""}`);
          if (target.hp === 0) log(b, "system", `${target.name} 전투불능`);
          break;
        }

        case "defend": {
          log(b, "battle", `${actor.name} 방어 자세`);
          break;
        }

        case "dodge": {
          log(b, "battle", `${actor.name} 회피 자세`);
          break;
        }

        case "item": {
          const t = String(action.itemType || "");
          if (t === "dittany") {
            const target =
              (action.targetId && b.players.find((x) => x.id === action.targetId)) || actor;
            const c = Number(actor?.items?.dittany || 0);
            if (!c) { log(b, "system", `${actor.name}의 디터니가 없습니다.`); break; }
            actor.items.dittany = c - 1;
            const before = target.hp;
            target.hp = Math.min(target.maxHp, target.hp + 10);
            log(b, "battle", `${actor.name} → ${target.name}에게 디터니 사용 (+${target.hp - before})`);
            break;
          }
          if (t === "attack_booster") {
            const c = Number(actor?.items?.attack_booster || 0);
            if (!c) { log(b, "system", `${actor.name}의 공격 보정기가 없습니다.`); break; }
            actor.items.attack_booster = c - 1;
            actor.__attackBoostThisRound = true;
            log(b, "battle", `${actor.name} 공격 보정기 사용`);
            break;
          }
          if (t === "defense_booster") {
            const c = Number(actor?.items?.defense_booster || 0);
            if (!c) { log(b, "system", `${actor.name}의 방어 보정기가 없습니다.`); break; }
            actor.items.defense_booster = c - 1;
            actor.__defenseBoostThisRound = true;
            log(b, "battle", `${actor.name} 방어 보정기 사용`);
            break;
          }
          log(b, "system", `${actor.name} 아이템 사용 실패`);
          break;
        }

        default:
          log(b, "battle", `${actor.name} 패스`);
          break;
      }
    }
  }

  // 방어 보정 원복 및 1턴 한정 플래그 제거
  for (const [pid, orig] of defBackup) {
    const p = b.players.find((x) => x.id === pid);
    if (p) p.stats.defense = orig;
  }
  for (const p of b.players) {
    delete p.__attackBoostThisRound;
    delete p.__defenseBoostThisRound;
  }

  // 승패 체크
  const aliveA = b.players.some((p) => p.team === TEAM_A && p.hp > 0);
  const aliveB = b.players.some((p) => p.team === TEAM_B && p.hp > 0);
  if (!aliveA || !aliveB) {
    const win = aliveA ? TEAM_A : aliveB ? TEAM_B : null;
    b.status = "ended";
    if (win) log(b, "system", `${teamAB(win)} 승리!`);
    else log(b, "system", `무승부`);
    push(b);
    return;
  }

  // ── 1턴 종료 → 다음 턴 세팅(선/후공 반전)
  b.round += 1;
  b.commitFirstTeam = otherTeam(b.commitFirstTeam);        // 선/후공 교대
  b.phase = b.commitFirstTeam === TEAM_A ? "commitA" : "commitB";
  b.currentTeam = b.commitFirstTeam;                       // 다음 턴 첫 커밋 팀이 현재 턴으로 표시
  b.turnStartTime = now();
  b.pendingA.clear();
  b.pendingB.clear();

  log(b, "system", `턴 ${b.round}: ${teamAB(b.commitFirstTeam)} 차례`);
  push(b);
}

// ─────────────────────────────────────────────────────────────
// 브로드캐스트/로그/뷰
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
    commitFirstTeam: b.commitFirstTeam,
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

app.post("/api/battles", (req, res) => {
  const { mode } = req.body || {};
  const b = createBattle({ mode });
  res.json({ ok: true, id: b.id });
});

app.post("/api/battles/:id/start", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: "not found" });
  startBattle(b);
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
  // 공통: 방 참가/상태 푸시
  socket.on("join", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    socket.join(b.id);
    socket.emit("battle:update", publicView(b));
  });

  // 관리자
  socket.on("createBattle", ({ mode = "1v1" } = {}) => {
    const b = createBattle({ mode });
    socket.emit("battleCreated", { success: true, battleId: b.id, mode: b.mode });
  });

  socket.on("addPlayer", ({ battleId, playerData }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const name = (playerData?.name || "").trim();
    if (!name) return;
    if (b.players.some((p) => p.name === name)) {
      log(b, "system", `플레이어 이름 중복: ${name}`);
      push(b); return;
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
    log(b, "system", `전투 참가자 추가: ${p.name} (${teamAB(p.team)})`);
    push(b);
  });

  socket.on("startBattle", ({ battleId }) => {
    const b = battles.get(battleId); if (!b) return;
    startBattle(b);
  });
  socket.on("pauseBattle", ({ battleId }) => {
    const b = battles.get(battleId); if (!b || b.status!=="active") return;
    b.status = "paused"; log(b,"system","전투 일시정지"); push(b);
  });
  socket.on("resumeBattle", ({ battleId }) => {
    const b = battles.get(battleId); if (!b || b.status!=="paused") return;
    b.status = "active"; b.turnStartTime = now(); log(b,"system","전투 재개"); push(b);
  });
  socket.on("endBattle", ({ battleId }) => {
    const b = battles.get(battleId); if (!b) return;
    b.status = "ended"; log(b,"system","전투 종료"); push(b);
  });

  socket.on("generateSpectatorOtp", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("spectatorOtpGenerated", { success:false, error:"not found" });
    const spectatorUrl = `${process.env.PUBLIC_ORIGIN || ""}/spectator?battle=${b.id}&otp=spectator-${b.id}`;
    socket.emit("spectatorOtpGenerated", { success:true, spectatorUrl });
  });

  socket.on("chat:send", ({ battleId, name, message, role }) => {
    const b = battles.get(battleId); if (!b) return;
    io.to(b.id).emit("battle:chat", { name: name||"익명", message: message||"", role: role||"system" });
  });

  // 플레이어
  socket.on("playerAuth", ({ battleId, name, token }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("authError", { error: "전투 없음" });
    const p = b.players.find((x) => x.name === name);
    const ok = token === `player-${encodeURIComponent(name)}-${battleId}` || token === `player-${name}-${battleId}`;
    if (!p || !ok) return socket.emit("authError", { error: "잘못된 자격증명" });
    socket.join(b.id);
    socket.emit("auth:success", { role:"player", playerId:p.id, battleId:b.id, battle: publicView(b) });
  });

  socket.on("player:ready", ({ battleId, playerId }) => {
    const b = battles.get(battleId); if (!b) return;
    const p = b.players.find((x)=>x.id===playerId); if (!p) return;
    p.ready = true; log(b,"system",`${p.name} 준비완료`); push(b);
  });

  // 플레이어 액션(타깃 포함)
  socket.on("player:action", ({ battleId, playerId, action }) => {
    const b = battles.get(battleId);
    if (!b || b.status!=="active") return;
    const actor = b.players.find((x)=>x.id===playerId);
    if (!actor || actor.hp<=0) return;

    const sane = sanitizeAction(action);
    if (actor.team === TEAM_A) {
      b.pendingA.set(actor.id, sane);
      teamCommit(b, TEAM_A, actor.id, sane);
    } else {
      b.pendingB.set(actor.id, sane);
      teamCommit(b, TEAM_B, actor.id, sane);
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
  const t = String(a.type || "pass");
  const known = ["attack", "defend", "dodge", "item", "pass"];
  const type = known.includes(t) ? t : "pass";
  return {
    type,
    targetId: a.targetId || null,
    itemType: a.itemType || null,
  };
}

// ─────────────────────────────────────────────────────────────
// 서버 시작
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PYXIS] battle-server listening on :${PORT}`);
});
