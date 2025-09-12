// packages/battle-server/src/engine/battle-handlers.js
"use strict";

/**
 * PYXIS Battle 경량 핸들러 (라운드/페이즈 내장)
 * 상태키: waiting | active | paused | ended
 * 시작:
 *   - 생존자 기준 팀별 (민첩 + d20) 합 비교로 선공 결정
 *   - 동점 다회 발생/빈 팀 케이스를 위한 안전 장치 포함
 * 턴:
 *   - 선공 페이즈(A/B) → 후공 페이즈 → 라운드 +1, 선공/후공 스왑
 * 팀 표기: 항상 "A" / "B"
 */

/* ---------- d20 ---------- */
function d20() { return Math.floor(Math.random() * 20) + 1; }

/* ---------- 생성 ---------- */
function createBattle({ id, mode = "2v2", adminToken, spectatorOtp }) {
  if (!id) throw new Error("Battle ID is required");

  return {
    id,
    mode,
    adminToken,
    spectatorOtp,

    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,

    // 라운드/페이즈 기반 상태
    turn: {
      round: 0,                 // startBattle 시 1
      order: ["A", "B"],        // ["A","B"]=A선공, ["B","A"]=B선공
      phaseIndex: 0,            // 0=선공, 1=후공
      acted: { A: new Set(), B: new Set() }
    },

    players: [],            // { id, name, team:"A"|"B", stats:{attack,defense,agility,luck}, hp, ready, avatarUrl }
    log: [],                // { type, message, ts }
    effects: [],            // 일회성 보정(defenseBoost 등)
    winner: null            // "A" | "B" | null
  };
}

/* ---------- 로그 ---------- */
function pushLog(battle, entry) {
  if (!battle || !entry) return;
  const logEntry = {
    type: entry.type || "system",
    message: entry.message || "",
    ts: Date.now(),
    ...entry
  };
  battle.log = battle.log || [];
  battle.log.push(logEntry);
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
}

/* ---------- 유틸: 생존자/합계 ---------- */
const _alive = (p) => p && (p.hp || 0) > 0;
const _team = (t) => (t === "A" || t === "B") ? t : "A";

function _alivePlayers(battle, team) {
  const T = _team(team);
  return (battle.players || []).filter(p => p && p.team === T && _alive(p));
}
function _aliveIdsOfTeam(battle, team){
  return _alivePlayers(battle, team).map(p => p.id);
}
function _phaseTeamLetter(battle){ return battle.turn.order[battle.turn.phaseIndex]; } // "A"|"B"
function _otherLetter(letter){ return letter === "A" ? "B" : "A"; }

/* ---------- 종료/승패 ---------- */
function isBattleOver(battle) {
  if (!battle || !Array.isArray(battle.players)) return true;
  if (battle.status === "ended") return true;

  const aliveA = _alivePlayers(battle, "A").length > 0;
  const aliveB = _alivePlayers(battle, "B").length > 0;
  return !(aliveA && aliveB);
}

function winnerByHpSum(battle) {
  if (!battle || !Array.isArray(battle.players)) return null;
  const sum = (team) => (battle.players || [])
    .filter(p => p && p.team === team)
    .reduce((s, p) => s + Math.max(0, p?.hp || 0), 0);

  const sumA = sum("A");
  const sumB = sum("B");
  if (sumA === sumB) return null;
  return sumA > sumB ? "A" : "B";
}

function decideWinner(battle) {
  // 1) 생존자 존재 팀 우선
  const aAlive = _alivePlayers(battle, "A").length;
  const bAlive = _alivePlayers(battle, "B").length;
  if (aAlive > 0 && bAlive === 0) return "A";
  if (bAlive > 0 && aAlive === 0) return "B";

  // 2) 합계 HP 비교
  return winnerByHpSum(battle);
}

/* ---------- 선공 결정 (민첩+d20, 동점 재굴림/안전장치) ---------- */
function decideLeadingOrder(battle) {
  const A = _alivePlayers(battle, "A");
  const B = _alivePlayers(battle, "B");

  // 빈 팀 처리
  if (A.length === 0 && B.length === 0) return ["A", "B"];
  if (A.length > 0 && B.length === 0) return ["A", "B"];
  if (B.length > 0 && A.length === 0) return ["B", "A"];

  const rollTeam = (list) => list.reduce((tot, p) => tot + Number(p?.stats?.agility || 0) + d20(), 0);

  // 재시도 한도(드물지만 장시간 동점 방지)
  const MAX_RETRY = 20;
  for (let i = 0; i < MAX_RETRY; i++) {
    const a = rollTeam(A);
    const b = rollTeam(B);
    if (a > b) return ["A", "B"];
    if (b > a) return ["B", "A"];
  }

  // 최후 보정: 총 민첩 합 → 동점이면 동전 던지기
  const sumAgi = (list) => list.reduce((s, p) => s + Number(p?.stats?.agility || 0), 0);
  const agA = sumAgi(A), agB = sumAgi(B);
  if (agA > agB) return ["A", "B"];
  if (agB > agA) return ["B", "A"];
  return Math.random() < 0.5 ? ["A", "B"] : ["B", "A"];
}

/* ---------- 시작/일시정지/재개/종료 ---------- */
function startBattle(battle) {
  if (!battle || battle.status === "active") return;

  battle.status = "active";
  battle.startedAt = Date.now();
  if (!Array.isArray(battle.players)) battle.players = [];

  const order = decideLeadingOrder(battle);
  battle.turn.order = order;
  battle.turn.phaseIndex = 0;
  battle.turn.round = 1;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  pushLog(battle, { type:"system", message:`전투 시작 (1턴 선공: ${order[0]}팀)` });
}

function pauseBattle(battle) {
  if (!battle || battle.status !== "active") return;
  battle.status = "paused";
  pushLog(battle, { type:"system", message:"전투 일시정지" });
}

function resumeBattle(battle) {
  if (!battle || battle.status !== "paused") return;
  battle.status = "active";
  pushLog(battle, { type:"system", message:"전투 재개" });
}

function endBattle(battle) {
  if (!battle) return;
  battle.status = "ended";
  battle.endedAt = Date.now();
  battle.winner = decideWinner(battle);
  if (battle.winner) {
    pushLog(battle, { type:"result", message:`전투 종료 — ${battle.winner}팀 승리` });
  } else {
    pushLog(battle, { type:"result", message:"전투 종료 — 무승부" });
  }
}

/* ---------- 턴/페이즈 진행 ---------- */
function nextTurn(battle, { actorId } = {}) {
  if (!battle || battle.status !== "active")
    return { teamPhaseCompleted:false, roundCompleted:false, currentTeam:null };

  const phaseLetter = _phaseTeamLetter(battle);

  // 이번 페이즈 팀 소속 & 생존자만 '행동 완료' 처리
  if (actorId) {
    const actor = (battle.players || []).find(p => p && p.id === actorId);
    if (actor && actor.team === phaseLetter && _alive(actor)) {
      battle.turn.acted[phaseLetter].add(actorId);
    }
  }

  const aliveIds = _aliveIdsOfTeam(battle, phaseLetter);
  const actedSet = battle.turn.acted[phaseLetter];
  const done = aliveIds.every(id => actedSet.has(id));

  if (!done) {
    return { teamPhaseCompleted:false, roundCompleted:false, currentTeam:phaseLetter };
  }

  // 후공 페이즈로 전환
  if (battle.turn.phaseIndex === 0) {
    battle.turn.phaseIndex = 1;
    const nextLetter = _phaseTeamLetter(battle);
    battle.turn.acted[nextLetter] = new Set();
    pushLog(battle, { type:"system", message:"후공 페이즈로 전환" });
    return { teamPhaseCompleted:true, roundCompleted:false, currentTeam:nextLetter };
  }

  // 라운드 종료 → 선/후공 스왑
  const oldLead = battle.turn.order[0];
  const oldLag  = battle.turn.order[1];
  battle.turn.order = [oldLag, oldLead];
  battle.turn.round += 1;
  battle.turn.phaseIndex = 0;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  pushLog(battle, { type:"system", message:`라운드 종료 → ${battle.turn.round}턴 시작 준비 (선공: ${battle.turn.order[0]}팀)` });

  return { teamPhaseCompleted:true, roundCompleted:true, currentTeam:battle.turn.order[0] };
}

/* ---------- 유효성/정리 ---------- */
function validateBattleState(battle) {
  if (!battle) throw new Error("Battle object is required");
  if (!battle.id) throw new Error("Battle ID is required");

  if (!Array.isArray(battle.players)) battle.players = [];
  if (!Array.isArray(battle.log)) battle.log = [];
  if (!Array.isArray(battle.effects)) battle.effects = [];

  const valid = ["waiting","active","paused","ended"];
  if (!valid.includes(battle.status)) battle.status = "waiting";

  if (!battle.turn) {
    battle.turn = { round:0, order:["A","B"], phaseIndex:0, acted:{A:new Set(),B:new Set()} };
  } else {
    if (!Array.isArray(battle.turn.order) || battle.turn.order.length !== 2) battle.turn.order = ["A","B"];
    if (typeof battle.turn.phaseIndex !== "number") battle.turn.phaseIndex = 0;
    if (!battle.turn.acted) battle.turn.acted = { A:new Set(), B:new Set() };
    if (!(battle.turn.acted.A instanceof Set)) battle.turn.acted.A = new Set(Array.from(battle.turn.acted.A || []));
    if (!(battle.turn.acted.B instanceof Set)) battle.turn.acted.B = new Set(Array.from(battle.turn.acted.B || []));
    if (typeof battle.turn.round !== "number") battle.turn.round = 0;
  }

  if (!("winner" in battle)) battle.winner = null;
  return battle;
}

function cleanupBattle(battle) {
  if (!battle) return;
  if (Array.isArray(battle.log) && battle.log.length > 1000) {
    battle.log = battle.log.slice(-500);
  }
  if (Array.isArray(battle.effects)) {
    battle.effects = battle.effects.filter(e => e && (e.charges || 0) > 0);
  }
}

module.exports = {
  createBattle,
  pushLog,
  isBattleOver,
  winnerByHpSum,
  decideWinner,
  startBattle,
  pauseBattle,
  resumeBattle,
  endBattle,
  nextTurn,
  validateBattleState,
  cleanupBattle
};
