// packages/battle-server/src/engine/battle-handlers.js
"use strict";

/**
 * Battle 경량 핸들러 (라운드/페이즈 내장)
 * - 상태키: waiting | active | paused | ended
 * - 시작: 팀별 (민첩 + d20) 합 비교, 동점 시 자동 재굴림
 * - 턴: 선공 페이즈(A/B) → 후공 페이즈 → 라운드 +1, 선공/후공 스왑
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
    effects: []             // 일회성 보정(defenseBoost 등)
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

/* ---------- 종료/승패 ---------- */
function isBattleOver(battle) {
  if (!battle || !Array.isArray(battle.players)) return true;
  if (battle.status === "ended") return true;

  const aliveA = battle.players.some(p => p && p.team === "A" && (p.hp || 0) > 0);
  const aliveB = battle.players.some(p => p && p.team === "B" && (p.hp || 0) > 0);
  return !(aliveA && aliveB);
}

function winnerByHpSum(battle) {
  if (!battle || !Array.isArray(battle.players)) return null;
  const sum = (team) => battle.players
    .filter(p => p && p.team === team)
    .reduce((s, p) => s + (p?.hp || 0), 0);

  const sumA = sum("A");
  const sumB = sum("B");
  if (sumA === sumB) return null;
  return sumA > sumB ? "A" : "B";
}

/* ---------- 선공 결정 (민첩+d20, 동점 재굴림) ---------- */
function decideLeadingOrder(players) {
  const rollTeam = (team) =>
    players.filter(p => p && p.team === team)
      .reduce((tot, p) => tot + Number(p?.stats?.agility || 0) + d20(), 0);

  while (true) {
    const a = rollTeam("A");
    const b = rollTeam("B");
    if (a > b) return ["A","B"];
    if (b > a) return ["B","A"];
  }
}

/* ---------- 시작/종료 ---------- */
function startBattle(battle) {
  if (!battle || battle.status === "active") return;

  battle.status = "active";
  battle.startedAt = Date.now();
  if (!Array.isArray(battle.players)) battle.players = [];

  const order = decideLeadingOrder(battle.players);
  battle.turn.order = order;
  battle.turn.phaseIndex = 0;
  battle.turn.round = 1;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  pushLog(battle, { type:"system", message:`전투 시작 (1턴 선공: ${order[0]}팀)` });
}

function endBattle(battle) {
  if (!battle) return;
  battle.status = "ended";
  battle.endedAt = Date.now();
}

/* ---------- 내부 유틸 ---------- */
function _phaseTeamLetter(battle){ return battle.turn.order[battle.turn.phaseIndex]; } // "A"|"B"
function _otherLetter(letter){ return letter === "A" ? "B" : "A"; }

function _aliveIdsOfTeam(battle, team){
  return (battle.players || [])
    .filter(p => p && p.team === team && (p.hp || 0) > 0)
    .map(p => p.id);
}

/* ---------- 턴/페이즈 진행 ---------- */
function nextTurn(battle, { actorId } = {}) {
  if (!battle || battle.status !== "active")
    return { teamPhaseCompleted:false, roundCompleted:false, currentTeam:null };

  const phaseLetter = _phaseTeamLetter(battle);

  if (actorId) {
    const actor = (battle.players || []).find(p => p && p.id === actorId);
    if (actor && actor.team === phaseLetter && (actor.hp || 0) > 0) {
      battle.turn.acted[phaseLetter].add(actorId);
    }
  }

  const aliveIds = _aliveIdsOfTeam(battle, phaseLetter);
  const actedSet = battle.turn.acted[phaseLetter];
  const done = aliveIds.every(id => actedSet.has(id));

  if (!done) {
    return { teamPhaseCompleted:false, roundCompleted:false, currentTeam:phaseLetter };
  }

  if (battle.turn.phaseIndex === 0) {
    battle.turn.phaseIndex = 1;
    const nextLetter = _phaseTeamLetter(battle);
    battle.turn.acted[nextLetter] = new Set();
    pushLog(battle, { type:"system", message:"후공 페이즈로 전환" });
    return { teamPhaseCompleted:true, roundCompleted:false, currentTeam:nextLetter };
  }

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
  startBattle,
  endBattle,
  nextTurn,
  validateBattleState,
  cleanupBattle
};
