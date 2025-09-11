"use strict";

/**
 * Battle 경량 핸들러 (라운드/페이즈 내장)
 * - 상태키: waiting | active | paused | ended
 * - 시작: 팀별 (민첩 + d20) 합 비교, 동점 시 자동 재굴림
 * - 턴: 선공 페이즈(A/B 레터) → 후공 페이즈 → 라운드 +1, 선공/후공 스왑
 * - 레거시 호환을 위해 current/firstTeamKey(phoenix|eaters)도 계속 제공
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
      acted: { A: new Set(), B: new Set() } // 현재 라운드에서 각 페이즈 내 "행동 완료한 플레이어 ID"
    },

    // 레거시 호환
    turnMs: 5 * 60 * 1000,
    current: null,          // 현재 페이즈 팀키("phoenix"/"eaters")
    firstTeamKey: null,     // 첫 라운드 선공 팀키

    players: [],            // { id, name, team:"phoenix"|"eaters", stats:{atk,def,agi,luk}, hp, ready, avatarUrl }
    log: [],                // { type, message, ts }
    effects: []             // 일회성 보정(defenseBoost/dodgePrep 등)
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

  const aliveA = battle.players.some(p => p && p.team === "phoenix" && (p.hp || 0) > 0);
  const aliveB = battle.players.some(p => p && p.team === "eaters"  && (p.hp || 0) > 0);
  return !(aliveA && aliveB);
}

function winnerByHpSum(battle) {
  if (!battle || !Array.isArray(battle.players)) return null;
  const sum = (teamKey) => battle.players
    .filter(p => p && p.team === teamKey)
    .reduce((s, p) => s + (p?.hp || 0), 0);

  const sumA = sum("phoenix");
  const sumB = sum("eaters");
  if (sumA === sumB) return null;
  return sumA > sumB ? "phoenix" : "eaters";
}

/* ---------- 선공 결정 (민첩+d20, 동점 재굴림) ---------- */
function decideLeadingOrder(players) {
  const rollTeam = (teamKey) =>
    players.filter(p => p && p.team === teamKey)
      .reduce((tot, p) => tot + Number(p?.stats?.agi || p?.stats?.agility || 0) + d20(), 0);

  while (true) {
    const a = rollTeam("phoenix");
    const b = rollTeam("eaters");
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

  // 선공 결정
  const order = decideLeadingOrder(battle.players); // ["A","B"] or ["B","A"]
  battle.turn.order = order;
  battle.turn.phaseIndex = 0;
  battle.turn.round = 1;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  // 레거시 호환
  const leadTeam = order[0] === "A" ? "phoenix" : "eaters";
  battle.firstTeamKey = leadTeam;
  battle.current = leadTeam;

  pushLog(battle, { type:"system", message:`전투 시작 (1턴 선공: ${leadTeam === "phoenix" ? "A팀" : "B팀"})` });
}

function endBattle(battle) {
  if (!battle) return;
  battle.status = "ended";
  battle.endedAt = Date.now();
}

/* ---------- 내부 매핑 ---------- */
function _phaseTeamLetter(battle){ return battle.turn.order[battle.turn.phaseIndex]; } // "A"|"B"
function _letterToTeamKey(letter){ return letter === "A" ? "phoenix" : "eaters"; }
function _otherLetter(letter){ return letter === "A" ? "B" : "A"; }

function _aliveIdsOfTeam(battle, teamKey){
  return (battle.players || [])
    .filter(p => p && p.team === teamKey && (p.hp || 0) > 0)
    .map(p => p.id);
}

/* ---------- 턴/페이즈 진행 핵심 ---------- */
/**
 * nextTurn(battle, { actorId })
 * - 현재 페이즈 팀의 생존자가 모두 1회 행동하면 페이즈 전환
 * - 후공 페이즈까지 끝나면 라운드 +1, 선공/후공 스왑
 * 반환:
 *   { teamPhaseCompleted, roundCompleted, currentTeamKey }
 */
function nextTurn(battle, { actorId } = {}) {
  if (!battle || battle.status !== "active")
    return { teamPhaseCompleted:false, roundCompleted:false, currentTeamKey:null };

  const phaseLetter = _phaseTeamLetter(battle);           // "A"|"B"
  const phaseTeamKey = _letterToTeamKey(phaseLetter);     // "phoenix"|"eaters"

  // 행동자 카운트(같은 팀 + 생존)
  if (actorId) {
    const actor = (battle.players || []).find(p => p && p.id === actorId);
    if (actor && actor.team === phaseTeamKey && (actor.hp || 0) > 0) {
      battle.turn.acted[phaseLetter].add(actorId);
    }
  }

  // 페이즈 종료 여부: 생존자 전원이 acted에 포함되어야 함
  const aliveIds = _aliveIdsOfTeam(battle, phaseTeamKey);
  const actedSet = battle.turn.acted[phaseLetter];
  const done = aliveIds.every(id => actedSet.has(id));

  if (!done) {
    battle.current = phaseTeamKey; // 레거시 호환
    return { teamPhaseCompleted:false, roundCompleted:false, currentTeamKey:battle.current };
  }

  // 선공 페이즈 → 후공 페이즈
  if (battle.turn.phaseIndex === 0) {
    battle.turn.phaseIndex = 1;
    const nextLetter = _phaseTeamLetter(battle);
    battle.turn.acted[nextLetter] = new Set(); // 다음 페이즈 카운터 초기화
    battle.current = _letterToTeamKey(nextLetter);
    pushLog(battle, { type:"system", message:"후공 페이즈로 전환" });
    return { teamPhaseCompleted:true, roundCompleted:false, currentTeamKey:battle.current };
  }

  // 후공까지 끝나면 라운드 종료 → 다음 라운드에서 직전 후공이 선공
  const oldLead = battle.turn.order[0];
  const oldLag  = battle.turn.order[1];
  battle.turn.order = [oldLag, oldLead];
  battle.turn.round += 1;
  battle.turn.phaseIndex = 0;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  const newLeadTeamKey = _letterToTeamKey(battle.turn.order[0]);
  battle.current = newLeadTeamKey;
  battle.firstTeamKey = newLeadTeamKey; // 참고용

  pushLog(battle, { type:"system", message:`라운드 종료 → ${battle.turn.round}턴 시작 준비 (선공: ${newLeadTeamKey === "phoenix" ? "A팀" : "B팀"})` });

  return { teamPhaseCompleted:true, roundCompleted:true, currentTeamKey:battle.current };
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

  // turn 보정
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
