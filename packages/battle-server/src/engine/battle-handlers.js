// Battle 경량 핸들러: 인메모리 상태 관리와 보조 유틸
// - index.js 또는 socketHandlers.js에서 사용
// - 상태키: waiting | active | paused | ended

export function createBattle({ id, mode = "2v2", adminToken, spectatorOtp }) {
  return {
    id,
    mode,
    adminToken,
    spectatorOtp,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    turnMs: 5 * 60 * 1000,
    turn: 0,
    current: null,         // teamKey 또는 playerId
    firstTeamKey: null,
    players: [],           // { id, name, team, stats, hp, ready, avatarUrl }
    log: [],               // { type, message, ts }
    effects: []            // 1회성 보정(attackMultiplier/defenseMultiplier/dodgePrep/defenseBoost 등)
  };
}

export function pushLog(battle, entry) {
  battle.log.push({ ...entry, ts: Date.now() });
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
}

export function isBattleOver(battle) {
  const aliveA = (battle.players || []).some(p => p.team === "phoenix" && p.hp > 0);
  const aliveB = (battle.players || []).some(p => p.team === "eaters" && p.hp > 0);
  return !(aliveA && aliveB) || battle.status === "ended";
}

export function winnerByHpSum(battle) {
  const sumA = (battle.players || []).filter(p => p.team === "phoenix").reduce((s, p) => s + (p.hp || 0), 0);
  const sumB = (battle.players || []).filter(p => p.team === "eaters").reduce((s, p) => s + (p.hp || 0), 0);
  if (sumA === sumB) return null;
  return sumA > sumB ? "phoenix" : "eaters";
}

export function startBattle(battle) {
  if (battle.status === "active") return;
  battle.status = "active";
  battle.startedAt = Date.now();

  const sumA = (battle.players || []).filter(p => p.team === "phoenix").reduce((s, p) => s + (p.stats?.agi || 0), 0);
  const sumB = (battle.players || []).filter(p => p.team === "eaters").reduce((s, p) => s + (p.stats?.agi || 0), 0);
  battle.firstTeamKey = sumA >= sumB ? "phoenix" : "eaters";
  battle.current = battle.firstTeamKey;
  battle.turn = 1;
}

export function endBattle(battle) {
  battle.status = "ended";
  battle.endedAt = Date.now();
}

export function nextTurn(battle) {
  battle.turn = (battle.turn || 0) + 1;
  // 단순 팀 턴 교대 (팀 단위 턴 구조 기준)
  if (battle.current === "phoenix") battle.current = "eaters";
  else if (battle.current === "eaters") battle.current = "phoenix";
  else battle.current = battle.firstTeamKey || "phoenix";
}
