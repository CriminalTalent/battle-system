// packages/battle-server/src/engine/battle-handlers.js
// PYXIS Battle System - 실시간 전투 처리 핸들러
// WebSocket 이벤트와 BattleEngine 연동

import BattleEngine from './BattleEngine.js';

/**
 * 플레이어 행동 처리
 * @param {Object} io - Socket.IO 인스턴스
 * @param {Object} battle - 전투 상태
 * @param {Object} action - 행동 데이터
 * @returns {Object} 처리 결과
 */
export function handlePlayerAction(io, battle, action) {
  const { playerId, type, targetId, itemType } = action;
  const engine = new BattleEngine(battle);
  
  const logs = [];
  const updates = { hp: {}, items: {}, effects: {} };
  
  // 현재 활성 팀 확인
  const activeTeam = engine.getCurrentActiveTeam();
  const player = engine._findPlayer(playerId);
  
  if (!player) {
    return {
      success: false,
      error: "플레이어를 찾을 수 없습니다",
      logs: [{ type: "error", message: "유효하지 않은 플레이어입니다" }]
    };
  }
  
  // 팀 턴 확인
  if (player.team !== activeTeam) {
    return {
      success: false,
      error: "현재 당신의 팀 턴이 아닙니다",
      logs: [{ type: "error", message: `현재는 ${getTeamDisplayName(activeTeam)} 턴입니다` }]
    };
  }
  
  // 이미 행동한 플레이어 확인
  const turn = battle.turn;
  if (turn.acted && turn.acted[player.team] && turn.acted[player.team].has(playerId)) {
    return {
      success: false,
      error: "이미 이번 턴에 행동했습니다",
      logs: [{ type: "error", message: "이번 턴에 이미 행동을 완료했습니다" }]
    };
  }
  
  // 생존 확인
  if (player.hp <= 0) {
    return {
      success: false,
      error: "쓰러진 플레이어는 행동할 수 없습니다",
      logs: [{ type: "error", message: "쓰러진 플레이어는 행동할 수 없습니다" }]
    };
  }

  let actionSuccess = false;
  
  // 행동 유형별 처리
  switch (String(type).toLowerCase()) {
    case 'attack':
      if (!targetId) {
        logs.push({ type: "error", message: "공격 대상을 선택해주세요" });
        break;
      }
      actionSuccess = engine.processAttack(playerId, targetId, logs, updates);
      break;
      
    case 'defend':
      actionSuccess = engine.processDefend(playerId, logs);
      break;
      
    case 'item':
      if (!itemType) {
        logs.push({ type: "error", message: "사용할 아이템을 선택해주세요" });
        break;
      }
      actionSuccess = engine.processItem(playerId, itemType, targetId, logs, updates);
      // 아이템 업데이트 반영
      updates.items[playerId] = player.items || {};
      break;
      
    case 'pass':
      actionSuccess = engine.processPass(playerId, logs);
      break;
      
    default:
      logs.push({ type: "error", message: "알 수 없는 행동입니다" });
      break;
  }
  
  if (!actionSuccess) {
    return {
      success: false,
      error: "행동 처리에 실패했습니다",
      logs
    };
  }
  
  // 행동 기록
  engine.recordPlayerAction(playerId);
  
  // 페이즈 진행 확인
  const phaseResult = engine.advancePhase();
  
  // 전투 상태 업데이트
  const battleStats = engine.getBattleStats();
  
  // 클라이언트에 브로드캐스트
  const broadcastData = {
    type: 'action_result',
    action: {
      playerId,
      playerName: player.name,
      type,
      targetId,
      itemType
    },
    logs,
    updates,
    battleState: {
      ...battleStats,
      phaseComplete: phaseResult.phaseComplete,
      turnComplete: phaseResult.turnComplete
    }
  };
  
  // 전체 참가자에게 브로드캐스트
  io.to(`battle-${battle.id}`).emit('battle_update', broadcastData);
  
  // 전투 종료 확인
  if (engine.isBattleOver()) {
    const winner = engine.determineWinner();
    handleBattleEnd(io, battle, winner);
  }
  
  return {
    success: true,
    logs,
    updates,
    battleState: battleStats,
    phaseResult
  };
}

/**
 * 전투 종료 처리
 */
function handleBattleEnd(io, battle, winner) {
  battle.status = 'ended';
  battle.endedAt = Date.now();
  battle.winner = winner;
  
  const endData = {
    type: 'battle_end',
    winner: winner,
    winnerName: getTeamDisplayName(winner),
    finalStats: {
      duration: battle.endedAt - (battle.startedAt || battle.endedAt),
      totalRounds: battle.turn?.round || 1,
      teamA: {
        totalHp: new BattleEngine(battle).getTeamTotalHp('A'),
        survivors: new BattleEngine(battle).getAlivePlayersInTeam('A').length
      },
      teamB: {
        totalHp: new BattleEngine(battle).getTeamTotalHp('B'),
        survivors: new BattleEngine(battle).getAlivePlayersInTeam('B').length
      }
    }
  };
  
  io.to(`battle-${battle.id}`).emit('battle_end', endData);
  
  // 로그 기록
  console.log(`[BATTLE] ${battle.id} ended. Winner: ${winner || 'draw'}`);
}

/**
 * 자동 턴 넘김 처리 (5분 타임아웃)
 */
export function handleTurnTimeout(io, battle) {
  const engine = new BattleEngine(battle);
  const activeTeam = engine.getCurrentActiveTeam();
  const alivePlayers = engine.getAlivePlayersInTeam(activeTeam);
  
  const turn = battle.turn;
  const actedSet = turn.acted[activeTeam] || new Set();
  
  // 미행동 플레이어들 자동 패스
  const unactedPlayers = alivePlayers.filter(p => !actedSet.has(p.id));
  
  const logs = [];
  for (const player of unactedPlayers) {
    logs.push({
      type: "timeout",
      message: `${player.name}이(가) 시간 초과로 자동 패스되었습니다`
    });
    
    engine.recordPlayerAction(player.id);
  }
  
  if (logs.length > 0) {
    // 페이즈 진행
    const phaseResult = engine.advancePhase();
    
    const timeoutData = {
      type: 'turn_timeout',
      logs,
      battleState: {
        ...engine.getBattleStats(),
        phaseComplete: phaseResult.phaseComplete,
        turnComplete: phaseResult.turnComplete
      }
    };
    
    io.to(`battle-${battle.id}`).emit('battle_update', timeoutData);
    
    // 전투 종료 확인
    if (engine.isBattleOver()) {
      const winner = engine.determineWinner();
      handleBattleEnd(io, battle, winner);
    }
  }
}

/**
 * 선공 결정 (민첩 총합 + D20)
 */
export function determineInitiative(battle) {
  const engine = new BattleEngine(battle);
  
  const teamAPlayers = engine.getAlivePlayersInTeam('A');
  const teamBPlayers = engine.getAlivePlayersInTeam('B');
  
  // 팀별 민첩 총합 계산
  const teamAAgility = teamAPlayers.reduce((sum, p) => {
    const stats = engine._readStats(p);
    return sum + stats.agility;
  }, 0);
  
  const teamBAgility = teamBPlayers.reduce((sum, p) => {
    const stats = engine._readStats(p);
    return sum + stats.agility;
  }, 0);
  
  // D20 굴림
  let rollA = Math.floor(Math.random() * 20) + 1;
  let rollB = Math.floor(Math.random() * 20) + 1;
  
  let totalA = teamAAgility + rollA;
  let totalB = teamBAgility + rollB;
  
  // 동점시 재굴림
  while (totalA === totalB) {
    rollA = Math.floor(Math.random() * 20) + 1;
    rollB = Math.floor(Math.random() * 20) + 1;
    totalA = teamAAgility + rollA;
    totalB = teamBAgility + rollB;
  }
  
  const leadingTeam = totalA > totalB ? 'A' : 'B';
  battle.leadingTeam = leadingTeam;
  
  return {
    leadingTeam,
    teamA: { agility: teamAAgility, roll: rollA, total: totalA },
    teamB: { agility: teamBAgility, roll: rollB, total: totalB },
    logs: [
      { type: "initiative", message: `선공 결정: 불사조 기사단 ${totalA} vs 죽음을 먹는 자들 ${totalB}` },
      { type: "initiative", message: `${getTeamDisplayName(leadingTeam)}이(가) 선공권을 획득했습니다!` }
    ]
  };
}

/**
 * 전투 시작 처리
 */
export function startBattle(io, battle) {
  // 선공 결정
  const initiative = determineInitiative(battle);
  
  // 전투 상태 초기화
  battle.status = 'active';
  battle.startedAt = Date.now();
  
  // 턴 시스템 초기화
  const engine = new BattleEngine(battle);
  
  const startData = {
    type: 'battle_start',
    initiative,
    battleState: engine.getBattleStats(),
    logs: initiative.logs
  };
  
  io.to(`battle-${battle.id}`).emit('battle_start', startData);
  
  console.log(`[BATTLE] ${battle.id} started. Leading team: ${initiative.leadingTeam}`);
  
  return startData;
}

/**
 * 팀 표시 이름 반환
 */
function getTeamDisplayName(team) {
  switch (team) {
    case 'A': return '불사조 기사단';
    case 'B': return '죽음을 먹는 자들';
    default: return '무승부';
  }
}

/**
 * 관전자 멘트 랜덤 선택
 */
export function getRandomSpectatorComment() {
  const comments = [
    "멋지다!",
    "이겨라!",
    "살아서 돌아와!",
    "화이팅!",
    "죽으면 나한테 죽어!",
    "힘내요!"
  ];
  
  return comments[Math.floor(Math.random() * comments.length)];
}

/**
 * 전투 상태 검증
 */
export function validateBattleState(battle) {
  if (!battle) return { valid: false, error: "전투가 존재하지 않습니다" };
  if (!Array.isArray(battle.players)) return { valid: false, error: "플레이어 목록이 유효하지 않습니다" };
  if (battle.players.length === 0) return { valid: false, error: "참가자가 없습니다" };
  
  const teamA = battle.players.filter(p => p && p.team === 'A');
  const teamB = battle.players.filter(p => p && p.team === 'B');
  
  if (teamA.length === 0 || teamB.length === 0) {
    return { valid: false, error: "양 팀 모두 최소 1명의 참가자가 필요합니다" };
  }
  
  // 스탯 검증
  for (const player of battle.players) {
    if (!player.stats) return { valid: false, error: `${player.name}의 스탯이 설정되지 않았습니다` };
    
    const stats = player.stats;
    const statNames = ['attack', 'defense', 'agility', 'luck'];
    
    for (const statName of statNames) {
      const value = stats[statName];
      if (!Number.isFinite(value) || value < 1 || value > 5) {
        return { 
          valid: false, 
          error: `${player.name}의 ${statName} 스탯이 유효하지 않습니다 (1-5 범위)` 
        };
      }
    }
    
    // HP 검증
    if (!Number.isFinite(player.hp) || player.hp <= 0 || player.hp > 100) {
      return { valid: false, error: `${player.name}의 체력이 유효하지 않습니다 (1-100 범위)` };
    }
  }
  
  return { valid: true };
}

/**
 * 플레이어 행동 가능 여부 확인
 */
export function canPlayerAct(battle, playerId) {
  const engine = new BattleEngine(battle);
  const player = engine._findPlayer(playerId);
  
  if (!player) return { canAct: false, reason: "플레이어를 찾을 수 없습니다" };
  if (player.hp <= 0) return { canAct: false, reason: "쓰러진 플레이어는 행동할 수 없습니다" };
  if (battle.status !== 'active') return { canAct: false, reason: "전투가 진행 중이 아닙니다" };
  
  const activeTeam = engine.getCurrentActiveTeam();
  if (player.team !== activeTeam) {
    return { 
      canAct: false, 
      reason: `현재는 ${getTeamDisplayName(activeTeam)} 턴입니다` 
    };
  }
  
  const turn = battle.turn;
  if (turn.acted && turn.acted[player.team] && turn.acted[player.team].has(playerId)) {
    return { canAct: false, reason: "이번 턴에 이미 행동했습니다" };
  }
  
  return { canAct: true };
}

/**
 * 타겟 검증
 */
export function validateTarget(battle, actorId, targetId, actionType) {
  const engine = new BattleEngine(battle);
  const actor = engine._findPlayer(actorId);
  const target = engine._findPlayer(targetId);
  
  if (!actor) return { valid: false, error: "행동 주체가 유효하지 않습니다" };
  if (!target) return { valid: false, error: "대상이 유효하지 않습니다" };
  
  switch (actionType) {
    case 'attack':
      // 공격은 적 팀 대상으로만 가능
      if (actor.team === target.team) {
        return { valid: false, error: "같은 팀 멤버는 공격할 수 없습니다" };
      }
      if (target.hp <= 0) {
        return { valid: false, error: "쓰러진 대상은 공격할 수 없습니다" };
      }
      break;
      
    case 'heal':
      // 힐은 아군 또는 자신에게만 가능
      if (actor.team !== target.team) {
        return { valid: false, error: "적 팀 멤버는 치료할 수 없습니다" };
      }
      if (target.hp <= 0) {
        return { valid: false, error: "쓰러진 대상은 치료할 수 없습니다" };
      }
      break;
  }
  
  return { valid: true };
}

export default {
  handlePlayerAction,
  handleTurnTimeout,
  determineInitiative,
  startBattle,
  getRandomSpectatorComment,
  validateBattleState,
  canPlayerAct,
  validateTarget
};
