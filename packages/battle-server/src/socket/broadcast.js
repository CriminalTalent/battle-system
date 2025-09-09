// Battle 경량 핸들러: 인메모리 상태 관리와 보조 유틸
// - index.js 또는 socketHandlers.js에서 사용
// - 상태키: waiting | active | paused | ended

function createBattle({ id, mode = "2v2", adminToken, spectatorOtp }) {
  if (!id) {
    throw new Error('Battle ID is required');
  }

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

function pushLog(battle, entry) {
  if (!battle || !entry) return;
  
  const logEntry = {
    type: entry.type || 'system',
    message: entry.message || '',
    ts: Date.now(),
    ...entry
  };
  
  battle.log = battle.log || [];
  battle.log.push(logEntry);
  
  // 로그 크기 제한 (메모리 관리)
  if (battle.log.length > 500) {
    battle.log.splice(0, battle.log.length - 500);
  }
}

function isBattleOver(battle) {
  if (!battle || !Array.isArray(battle.players)) {
    return true;
  }

  if (battle.status === "ended") {
    return true;
  }

  const aliveA = battle.players.some(p => 
    p && p.team === "phoenix" && (p.hp || 0) > 0
  );
  const aliveB = battle.players.some(p => 
    p && p.team === "eaters" && (p.hp || 0) > 0
  );
  
  return !(aliveA && aliveB);
}

function winnerByHpSum(battle) {
  if (!battle || !Array.isArray(battle.players)) {
    return null;
  }

  const phoenixPlayers = battle.players.filter(p => p && p.team === "phoenix");
  const eatersPlayers = battle.players.filter(p => p && p.team === "eaters");
  
  const sumA = phoenixPlayers.reduce((s, p) => s + (p?.hp || 0), 0);
  const sumB = eatersPlayers.reduce((s, p) => s + (p?.hp || 0), 0);
  
  if (sumA === sumB) return null;
  return sumA > sumB ? "phoenix" : "eaters";
}

function startBattle(battle) {
  if (!battle || battle.status === "active") {
    return;
  }

  battle.status = "active";
  battle.startedAt = Date.now();

  if (!Array.isArray(battle.players)) {
    battle.players = [];
  }

  const phoenixPlayers = battle.players.filter(p => p && p.team === "phoenix");
  const eatersPlayers = battle.players.filter(p => p && p.team === "eaters");
  
  const sumA = phoenixPlayers.reduce((s, p) => s + (p?.stats?.agi || 0), 0);
  const sumB = eatersPlayers.reduce((s, p) => s + (p?.stats?.agi || 0), 0);
  
  battle.firstTeamKey = sumA >= sumB ? "phoenix" : "eaters";
  battle.current = battle.firstTeamKey;
  battle.turn = 1;
}

function endBattle(battle) {
  if (!battle) return;
  
  battle.status = "ended";
  battle.endedAt = Date.now();
}

function nextTurn(battle) {
  if (!battle) return;
  
  battle.turn = (battle.turn || 0) + 1;
  
  // 단순 팀 턴 교대 (팀 단위 턴 구조 기준)
  if (battle.current === "phoenix") {
    battle.current = "eaters";
  } else if (battle.current === "eaters") {
    battle.current = "phoenix";
  } else {
    battle.current = battle.firstTeamKey || "phoenix";
  }
}

function validateBattleState(battle) {
  if (!battle) {
    throw new Error('Battle object is required');
  }
  
  if (!battle.id) {
    throw new Error('Battle ID is required');
  }
  
  if (!Array.isArray(battle.players)) {
    battle.players = [];
  }
  
  if (!Array.isArray(battle.log)) {
    battle.log = [];
  }
  
  if (!Array.isArray(battle.effects)) {
    battle.effects = [];
  }
  
  // 상태 정규화
  const validStatuses = ["waiting", "active", "paused", "ended"];
  if (!validStatuses.includes(battle.status)) {
    battle.status = "waiting";
  }
  
  return battle;
}

function cleanupBattle(battle) {
  if (!battle) return;
  
  // 메모리 정리
  if (Array.isArray(battle.log) && battle.log.length > 1000) {
    battle.log = battle.log.slice(-500);
  }
  
  if (Array.isArray(battle.effects)) {
    // 만료된 효과 제거
    battle.effects = battle.effects.filter(effect => 
      effect && (effect.charges || 0) > 0
    );
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
