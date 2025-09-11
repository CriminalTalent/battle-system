// packages/battle-server/index.js
// PYXIS Battle Server - Express + Socket.IO (단일 파일 서버)
// - 한글화 / 이모지 금지
// - 팀 내부키: phoenix/eaters, 화면 표기: A/B팀(프런트에서 치환)
// - 스탯 각 1~5, 총합 제한 없음, HP 최대 100
// - 방어 시 최소 1 보장 제거 (요청 반영)
// - 턴 구조: 선공 팀 전원 커밋 → 후공 팀 전원 커밋 → 일괄 해석, 이후 선공/후공 교대

"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

// ───────────────────────────────────────────────────────────────
// 기본 설정
// ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const ROOT = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.join(ROOT, "uploads");

// 디렉터리 보장
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 업로드 설정
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const id = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, "avatar-" + id + ext);
  },
});
const upload = multer({ storage });

// 유틸
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const d20 = () => Math.floor(Math.random() * 20) + 1;
const now = () => Date.now();

// 내부 팀 키 표준화
function normTeam(t) {
  const k = String(t || "").toLowerCase();
  if (k === "phoenix" || k === "a") return "phoenix";
  if (k === "eaters" || k === "death" || k === "b") return "eaters";
  return "phoenix";
}

// 스탯 읽기(각 1~5 clamp)
function readStats(p) {
  const s = p?.stats || {};
  return {
    attack: clamp(Number(s.attack ?? 3), 1, 5),
    defense: clamp(Number(s.defense ?? 3), 1, 5),
    agility: clamp(Number(s.agility ?? 3), 1, 5),
    luck: clamp(Number(s.luck ?? 3), 1, 5),
  };
}

// 치명타 판정
function isCritical(luck) {
  const th = 20 - luck / 2;
  const r = d20();
  return { crit: r >= th, roll: r, threshold: th };
}

// 아이템 효과(1회성/해당 턴)
const ITEM = {
  DITTANY: "dittany",
  ATK_BOOST: "attack_booster",
  DEF_BOOST: "defense_booster",
};
const ATK_MULT = 1.5;
const DEF_MULT = 1.5;
const BOOST_SUCCESS = 0.10;
function tryBooster() {
  return Math.random() < BOOST_SUCCESS;
}

// ───────────────────────────────────────────────────────────────
// 인메모리 데이터
// ───────────────────────────────────────────────────────────────
/**
 * battles[battleId] = {
 *   id, mode, status: 'waiting'|'active'|'paused'|'ended',
 *   players: [{ id, name, team:'phoenix'|'eaters', hp, maxHp:100, stats, items, avatar, ready }],
 *   log: [{ ts, type, message }],
 *   chat: [],
 *   // 턴/커밋 제어
 *   commitFirstTeam: 'phoenix'|'eaters',  // 이번 턴 선커밋 팀
 *   currentTeam: 'phoenix'|'eaters',      // 현재 입력을 받고 있는 팀
 *   phase: 'commitA'|'commitB'|'resolve',
 *   turn: 1,
 *   turnStartTime: <ms>,
 *   // 커밋 액션
 *   pendingActions: { phoenix: Map<playerId, action>, eaters: Map<playerId, action> },
 * }
 */
const battles = Object.create(null);

// ───────────────────────────────────────────────────────────────
// 서버/소켓
// ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", immutable: true }));
app.use("/", express.static(PUBLIC_DIR, { maxAge: "1h" }));

// 헬스체크
app.get("/api/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

// 아바타 업로드
app.post("/api/upload/avatar", upload.single("avatar"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "파일 없음" });
    const url = "/uploads/" + req.file.filename;
    return res.json({ ok: true, avatarUrl: url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// 전투 생성
app.post("/api/battles", (req, res) => {
  try {
    const battleId = createBattle(String(req.body?.mode || "1v1"));
    return res.json({ ok: true, id: battleId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// 전투 시작(관리자용 단순 REST 훅, 소켓 이벤트도 존재)
app.post("/api/battles/:id/start", (req, res) => {
  const id = String(req.params.id || "");
  const b = battles[id];
  if (!b) return res.status(404).json({ ok: false, error: "전투 없음" });
  startBattle(b);
  return res.json({ ok: true });
});

// 전투 상태 조회
app.get("/api/battles/:id", (req, res) => {
  const b = battles[String(req.params.id || "")];
  if (!b) return res.status(404).json({ ok: false, error: "전투 없음" });
  return res.json({ ok: true, battle: publicBattle(b) });
});

// ───────────────────────────────────────────────────────────────
// 소켓 이벤트
// ───────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  // 클라이언트가 특정 전투방에 참여
  socket.on("join", ({ battleId }) => {
    if (!battleId || !battles[battleId]) return;
    socket.join(room(battleId));
    emitBattleUpdate(battles[battleId]);
  });

  // 관리자: 전투 생성
  socket.on("createBattle", ({ mode }) => {
    try {
      const id = createBattle(String(mode || "1v1"));
      socket.emit("battleCreated", { success: true, battleId: id, mode: battles[id].mode });
      // 생성자도 방에 조인
      socket.join(room(id));
      emitBattleUpdate(battles[id]);
    } catch (e) {
      socket.emit("battleCreated", { success: false, error: String(e && e.message || e) });
    }
  });

  // 참가자 추가(관리자)
  socket.on("addPlayer", ({ battleId, playerData }) => {
    const b = battles[battleId];
    if (!b) return;
    try {
      addPlayer(b, playerData || {});
      log(b, "system", `전투 참가자 ${playerData?.name || "이름없음"} 등록 (A/B팀 표기는 화면에서 처리)`);
      emitBattleUpdate(b);
    } catch (e) {
      log(b, "system", "참가자 추가 실패: " + (e && e.message || e));
      emitBattleUpdate(b);
    }
  });

  // 관전자 링크/비밀번호 발급(소켓 이벤트명은 사양에 있으므로 지원)
  socket.on("generateSpectatorOtp", ({ battleId }) => {
    const b = battles[battleId];
    if (!b) return socket.emit("spectatorOtpGenerated", { success: false, error: "전투 없음" });
    const url = spectatorUrl(battleId);
    socket.emit("spectatorOtpGenerated", { success: true, spectatorUrl: url });
  });

  // 전투 제어
  socket.on("startBattle", ({ battleId }) => {
    const b = battles[battleId];
    if (!b) return;
    startBattle(b);
    emitBattleUpdate(b);
    io.to(room(battleId)).emit("battle:started", { message: "전투가 시작되었습니다.", battle: publicBattle(b) });
  });

  socket.on("pauseBattle", ({ battleId }) => {
    const b = battles[battleId];
    if (!b) return;
    if (b.status === "active") b.status = "paused";
    log(b, "system", "전투 일시정지");
    emitBattleUpdate(b);
  });

  socket.on("resumeBattle", ({ battleId }) => {
    const b = battles[battleId];
    if (!b) return;
    if (b.status === "paused") {
      b.status = "active";
      // 페이즈 재개 시 타이머 리셋
      b.turnStartTime = now();
      log(b, "system", "전투 재개");
      emitBattleUpdate(b);
    }
  });

  socket.on("endBattle", ({ battleId }) => {
    const b = battles[battleId];
    if (!b) return;
    b.status = "ended";
    log(b, "system", "전투 종료");
    emitBattleUpdate(b);
    io.to(room(battleId)).emit("battle:ended", { message: "전투가 종료되었습니다." });
  });

  // 채팅
  socket.on("chat:send", ({ battleId, name, message, role }) => {
    const b = battles[battleId];
    if (!b || !message) return;
    io.to(room(battleId)).emit("battle:chat", { name: name || "익명", message: String(message).slice(0, 500), role: role || "player" });
  });

  // 플레이어 인증 (자동 링크 포맷: player-<이름>-<BID>)
  socket.on("playerAuth", ({ battleId, name, token }) => {
    const b = battles[battleId];
    if (!b) return socket.emit("authError", { error: "전투 없음" });
    const player = b.players.find((p) => String(p.name) === String(name));
    if (!player) return socket.emit("authError", { error: "플레이어 없음" });
    const expected = `player-${encodeURIComponent(player.name)}-${b.id}`;
    if (token !== expected) return socket.emit("authError", { error: "비밀번호 불일치" });

    // 방 참가 및 상태 전송
    socket.join(room(battleId));
    socket.emit("auth:success", { role: "player", battleId, playerId: player.id, player, battle: publicBattle(b) });
    emitBattleUpdate(b);
  });

  // 준비 상태
  socket.on("player:ready", ({ battleId, playerId }) => {
    const b = battles[battleId];
    if (!b) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;
    p.ready = true;
    log(b, "system", `${p.name} 준비 완료`);
    emitBattleUpdate(b);
  });

  // 플레이어 액션 커밋
  socket.on("player:action", ({ battleId, playerId, action }) => {
    const b = battles[battleId];
    if (!b) return;

    if (b.status !== "active") return;
    if (b.phase !== "commitA" && b.phase !== "commitB") return;

    const p = b.players.find((x) => x.id === playerId);
    if (!p || p.hp <= 0) return;

    const team = normTeam(p.team);
    if (team !== b.currentTeam) return; // 현재 커밋 팀만 입력 허용

    // 액션 저장(한 턴당 1회 갱신 가능)
    const store = b.pendingActions[team];
    if (!(store instanceof Map)) b.pendingActions[team] = new Map();
    b.pendingActions[team].set(playerId, sanitizeAction(action));

    // 모든 생존자 커밋 완료 시 페이즈 전환
    const needCount = b.players.filter((x) => normTeam(x.team) === team && x.hp > 0).length;
    const doneCount = b.pendingActions[team].size;
    if (needCount > 0 && doneCount >= needCount) {
      // 다음 페이즈
      if (b.phase === "commitA") {
        // 반대 팀으로 전환
        b.phase = "commitB";
        b.currentTeam = otherTeam(b.currentTeam);
        b.turnStartTime = now();
        log(b, "system", `상대 팀 커밋 차례`);
      } else if (b.phase === "commitB") {
        // 해석 단계로
        b.phase = "resolve";
        resolveTurn(b);
      }
      emitBattleUpdate(b);
    } else {
      // 일부만 커밋 완료
      emitBattleUpdate(b);
    }
  });
});

// ───────────────────────────────────────────────────────────────
/** 전투 생성 */
// ───────────────────────────────────────────────────────────────
function createBattle(mode = "1v1") {
  const id = nano();
  const battle = {
    id,
    mode,
    status: "waiting",
    players: [],
    log: [],
    chat: [],
    commitFirstTeam: "phoenix",
    currentTeam: "phoenix",
    phase: "commitA",
    turn: 1,
    turnStartTime: 0,
    pendingActions: { phoenix: new Map(), eaters: new Map() },
    createdAt: now(),
  };
  battles[id] = battle;
  log(battle, "system", `전투 생성: ${mode}`);
  return id;
}

// 참가자 추가
function addPlayer(b, data) {
  const name = String(data?.name || "").trim();
  if (!name) throw new Error("이름 필수");
  if (b.players.some((p) => p.name === name)) throw new Error("이름 중복");

  const team = normTeam(data?.team || "phoenix");
  const stats = readStats({ stats: data?.stats || {} });
  const items = normalizeItems(data?.items);

  const player = {
    id: nano(),
    name,
    team,
    hp: clamp(Number(data?.hp || 100), 1, 100),
    maxHp: 100,
    stats,
    items,  // {dittany:n, attack_booster:n, defense_booster:n}
    avatar: data?.avatar || "",
    ready: false,
  };
  b.players.push(player);
  return player;
}

function normalizeItems(it) {
  const toInt = (v) => (Number.isFinite(Number(v)) ? Math.max(0, parseInt(v, 10)) : 0);
  return {
    [ITEM.DITTANY]: toInt(it?.dittany || it?.DITTANY || 0),
    [ITEM.ATK_BOOST]: toInt(it?.attack_booster || it?.ATK || 0),
    [ITEM.DEF_BOOST]: toInt(it?.defense_booster || it?.DEF || 0),
  };
}

// 전투 시작
function startBattle(b) {
  if (b.status === "active") return;
  b.status = "active";
  b.turn = 1;
  b.phase = "commitA";
  // 선커밋 팀 랜덤 결정: 양 팀 민첩 합+d20 합 비교
  const init = teamInitiative(b);
  b.commitFirstTeam = init.winner;
  b.currentTeam = b.commitFirstTeam;
  b.turnStartTime = now();
  b.pendingActions = { phoenix: new Map(), eaters: new Map() };

  log(b, "system", `선공: ${b.commitFirstTeam}팀`);
}

// 턴 해석 → 다음 턴으로
function resolveTurn(b) {
  if (b.status !== "active" || b.phase !== "resolve") return;

  const first = b.commitFirstTeam;
  const second = otherTeam(first);

  // 결과 로그 버퍼
  const turnLog = [];

  // 해석 순서: 선커밋 팀 → 후커밋 팀
  const order = [first, second];

  // 액션 대기열 복사 및 초기화(1턴 1회성)
  const actA = b.pendingActions[first];
  const actB = b.pendingActions[second];
  b.pendingActions = { phoenix: new Map(), eaters: new Map() };

  // 각 팀 액션을 순서대로 적용
  for (const team of order) {
    const acts = team === first ? actA : actB;
    for (const [pid, action] of acts.entries()) {
      const actor = b.players.find((p) => p.id === pid);
      if (!actor || actor.hp <= 0) continue;
      applyAction(b, actor, action, turnLog);
      // 전원 사망 체크
      if (isTeamAllDown(b, otherTeam(team))) break;
    }
  }

  // 로그 출력
  turnLog.forEach((m) => log(b, m.type, m.message));

  // 승패/종료 확인
  const aliveA = b.players.some((p) => normTeam(p.team) === "phoenix" && p.hp > 0);
  const aliveB = b.players.some((p) => normTeam(p.team) === "eaters" && p.hp > 0);
  if (!aliveA || !aliveB) {
    b.status = "ended";
    const winner = aliveA ? "phoenix" : aliveB ? "eaters" : "draw";
    log(b, "system", winner === "draw" ? "무승부" : `${winner} 팀 승리`);
    emitBattleUpdate(b);
    io.to(room(b.id)).emit("battle:ended", { message: winner === "draw" ? "무승부" : `${winner} 팀의 승리입니다.` });
    return;
  }

  // 다음 턴 세팅(선/후공 교대)
  b.turn += 1;
  b.commitFirstTeam = otherTeam(b.commitFirstTeam);
  b.currentTeam = b.commitFirstTeam;
  b.phase = "commitA";
  b.turnStartTime = now();
  log(b, "system", `다음 턴 시작: ${b.commitFirstTeam}팀 커밋`);
}

// 액션 적용
function applyAction(b, actor, action, turnLog) {
  const a = sanitizeAction(action);
  const A = readStats(actor);

  switch (a.type) {
    case "pass": {
      turnLog.push({ type: "system", message: `${actor.name} 패스` });
      return;
    }
    case "item": {
      if (a.itemType === ITEM.DITTANY) {
        const target = findTarget(b, a.targetId) || actor;
        const before = target.hp;
        target.hp = clamp(target.hp + 10, 0, 100);
        if (consumeItem(actor, ITEM.DITTANY)) {
          turnLog.push({ type: "system", message: `${actor.name} 디터니 사용 → ${target.name} HP ${before}→${target.hp}` });
        } else {
          turnLog.push({ type: "system", message: `${actor.name} 디터니 사용 실패(소지 없음)` });
        }
        return;
      }
      if (a.itemType === ITEM.ATK_BOOST) {
        if (consumeItem(actor, ITEM.ATK_BOOST)) {
          actor._buffAtk = true; // 이번 턴 공격에만 적용
          turnLog.push({ type: "system", message: `${actor.name} 공격 보정기 사용` });
        } else {
          turnLog.push({ type: "system", message: `${actor.name} 공격 보정기 없음` });
        }
        return;
      }
      if (a.itemType === ITEM.DEF_BOOST) {
        if (consumeItem(actor, ITEM.DEF_BOOST)) {
          actor._buffDef = true; // 이번 턴 방어에만 적용
          turnLog.push({ type: "system", message: `${actor.name} 방어 보정기 사용` });
        } else {
          turnLog.push({ type: "system", message: `${actor.name} 방어 보정기 없음` });
        }
        return;
      }
      turnLog.push({ type: "system", message: `${actor.name} 알 수 없는 아이템` });
      return;
    }
    case "defend": {
      actor._defending = true;
      turnLog.push({ type: "defense", message: `${actor.name} 방어 자세` });
      return;
    }
    case "dodge": {
      actor._dodging = true;
      turnLog.push({ type: "dodge", message: `${actor.name} 회피 준비` });
      return;
    }
    case "attack": {
      const target = findTarget(b, a.targetId, { enemyOf: actor });
      if (!target || target.hp <= 0) {
        turnLog.push({ type: "attack", message: `${actor.name} 공격 대상 없음` });
        return;
      }

      // 공격력 + d20 (+공격 보정 시 공격 스탯 ×1.5)
      let atkStat = A.attack;
      if (actor._buffAtk === true) {
        // 성공확률 10%: 성공 시 ×1.5, 실패 시 그대로(아이템은 이미 소모)
        const ok = tryBooster();
        if (ok) atkStat = Math.floor(atkStat * ATK_MULT);
      }
      const atkRoll = d20();
      const atkScore = atkStat + atkRoll;

      // 치명타
      const crit = isCritical(A.luck).crit;

      // 타깃이 회피 선택?
      if (target._dodging) {
        const T = readStats(target);
        const dodgeRoll = d20();
        const dodgeScore = T.agility + dodgeRoll;
        if (dodgeScore >= atkScore) {
          turnLog.push({ type: "dodge", message: `${target.name} 회피 성공` });
          return;
        } else {
          // 회피 실패 시 정면 피격(방어력 차감 없음). 하한 1은 기존 유지 가능하지만
          // 방어에서만 최소1 제거를 요청했으므로 여기서는 그대로 1 하한 유지
          let raw = atkScore;
          if (crit) raw *= 2;
          const dmg = Math.max(1, raw);
          applyDamageTo(b, target, dmg, turnLog, `${actor.name}의 공격 명중(회피 실패)`);
          return;
        }
      }

      // 타깃이 방어 선택?
      if (target._defending) {
        const T = readStats(target);

        // 방어 성공 판정: (민첩 + d20) ≥ 공격수치 → 0 대미지
        const defendRoll = d20();
        const defendScore = T.agility + defendRoll;
        if (defendScore >= atkScore) {
          turnLog.push({ type: "defense", message: `${target.name} 방어 성공` });
          return;
        }

        // 방어 실패 → 방어치 감산 (여기서 "최소 1 보장" 제거)
        let defStat = T.defense;
        if (target._buffDef === true) {
          const ok = tryBooster();
          if (ok) defStat = Math.floor(defStat * DEF_MULT);
        }
        let raw = atkScore - defStat;
        if (crit) raw *= 2;
        const dmg = Math.max(0, raw); // ← 방어에 한정해 최소1 제거(요청 반영)
        if (dmg > 0) {
          applyDamageTo(b, target, dmg, turnLog, `${actor.name}의 공격 명중(방어 실패)`);
          // 역공격: 피해 받은 경우만, 방어 불가 고정타
          const cRoll = d20();
          const counter = readStats(target).attack + cRoll;
          applyDamageTo(b, actor, counter, turnLog, `${target.name} 역공격`);
        } else {
          turnLog.push({ type: "defense", message: `${target.name} 방어로 피해 상쇄` });
        }
        return;
      }

      // 일반 명중(방어/회피 안 했을 때)
      let raw = atkScore;
      if (crit) raw *= 2;
      const dmg = Math.max(1, raw); // 기본 공격은 하한 1 유지
      applyDamageTo(b, target, dmg, turnLog, `${actor.name}의 공격 명중`);
      return;
    }
    default: {
      turnLog.push({ type: "system", message: `${actor.name} 알 수 없는 행동` });
      return;
    }
  }
}

// 데미지 적용
function applyDamageTo(b, target, dmg, logBuf, label) {
  const before = target.hp;
  target.hp = clamp(before - Math.max(0, dmg | 0), 0, 100);
  logBuf.push({
    type: "attack",
    message: `${label} → ${target.name} HP ${before}→${target.hp} (-${Math.max(0, dmg | 0)})`,
  });
}

// 커밋 종료 후 턴 상태 초기화 플래그 제거(버프/자세는 1턴 지속)
function clearTurnFlags(b) {
  b.players.forEach((p) => {
    delete p._defending;
    delete p._dodging;
    delete p._buffAtk;
    delete p._buffDef;
  });
}

function consumeItem(p, key) {
  if (!p.items) p.items = {};
  const n = Number(p.items[key] || 0);
  if (n <= 0) return false;
  p.items[key] = n - 1;
  return true;
}

function findTarget(b, targetId, opts = {}) {
  if (targetId) return b.players.find((p) => p.id === targetId) || null;
  if (opts.enemyOf) {
    const myTeam = normTeam(opts.enemyOf.team);
    return b.players.find((p) => normTeam(p.team) !== myTeam && p.hp > 0) || null;
  }
  return null;
}

function isTeamAllDown(b, team) {
  return b.players.filter((p) => normTeam(p.team) === team).every((p) => p.hp <= 0);
}

// 선공 결정(팀 이니시티브)
function teamInitiative(b) {
  const sum = (team) =>
    b.players
      .filter((p) => normTeam(p.team) === team)
      .reduce((acc, p) => acc + readStats(p).agility + d20(), 0);
  let a = sum("phoenix");
  let e = sum("eaters");
  // 동점이면 재굴림
  while (a === e) {
    a = sum("phoenix");
    e = sum("eaters");
  }
  return { winner: a > e ? "phoenix" : "eaters" };
}

function otherTeam(t) {
  return t === "phoenix" ? "eaters" : "phoenix";
}

function room(id) {
  return "battle-" + id;
}

// 공용 로그
function log(b, type, message) {
  b.log.push({ ts: now(), type: type || "system", message: String(message || "") });
  // 메모리 방어
  if (b.log.length > 1000) b.log = b.log.slice(-600);
  io.to(room(b.id)).emit("battle:log", { ts: now(), type: type || "system", message: String(message || "") });
}

function emitBattleUpdate(b) {
  // 턴 종료 후 플래그 정리(해석 단계 끝날 때)
  if (b.phase === "resolve") {
    clearTurnFlags(b);
  }
  io.to(room(b.id)).emit("battle:update", publicBattle(b));
}

// 클라이언트에 전달할 전투 스냅샷
function publicBattle(b) {
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
      avatar: p.avatar || "",
      ready: !!p.ready,
    })),
    log: b.log.slice(-200),
    commitFirstTeam: b.commitFirstTeam,
    currentTeam: b.currentTeam,
    phase: b.phase,
    turn: b.turn,
    turnStartTime: b.turnStartTime,
  };
}

// 스펙테이터 URL(비밀번호 포함)
function spectatorUrl(battleId) {
  return `${process.env.PUBLIC_ORIGIN || ""}/spectator?battle=${battleId}&otp=spectator-${battleId}`;
}

// 액션 정규화
function sanitizeAction(a) {
  const type = String(a?.type || "").toLowerCase();
  if (type === "attack") return { type, targetId: String(a?.targetId || "") };
  if (type === "defend") return { type };
  if (type === "dodge") return { type };
  if (type === "pass") return { type };
  if (type === "item") {
    const it = String(a?.itemType || "").toLowerCase();
    const itemType =
      it === ITEM.DITTANY || it === ITEM.ATK_BOOST || it === ITEM.DEF_BOOST
        ? it
        : "";
    return { type, itemType, targetId: a?.targetId ? String(a.targetId) : "" };
  }
  return { type: "pass" };
}

// 난수 ID
function nano() {
  return uuidv4().replace(/-/g, "").slice(0, 12);
}

// ───────────────────────────────────────────────────────────────
// 시작
// ───────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[INFO] PYXIS server started on 0.0.0.0:${PORT} (${process.env.NODE_ENV || "development"})`);
});
