// packages/battle-server/src/turns.js
// PYXIS Turn Engine (ESM)
// - 턴 순서 관리 (A팀/B팀 기준)
// - 전투 종료 판정
// - 승자 결정(체력 합산)
// - BattleEngine과 통합된 턴 관리

import { rollWithReroll } from './dice.js';

/**
 * 다음 턴 전투참여자 결정
 * @param {Object} battle - 전투 상태
 * @returns {Object|null} - 다음 턴 전투참여자 또는 null
 */
export function nextTurn(battle) {
  if (!battle || !Array.isArray(battle.players) || battle.players.length === 0) {
    if (battle.turn) {
      battle.turn.current = null;
      battle.turn.lastChange = Date.now();
    }
    return null;
  }

  // 생존한 전투참여자들만 필터링
  const alivePlayers = battle.players.filter(p => p && p.hp > 0);
  
  if (alivePlayers.length === 0) {
    if (battle.turn) {
      battle.turn.current = null;
      battle.turn.lastChange = Date.now();
    }
    return null;
  }

  // 현재 턴 전투참여자의 인덱스 찾기
  const currentId = battle.turn?.current;
  const currentIdx = alivePlayers.findIndex(p => p.id === currentId);
  
  // 다음 순서 계산 (라운드 로빈)
  const nextIdx = (currentIdx + 1) % alivePlayers.length;
  const nextPlayer = alivePlayers[nextIdx];
  
  // 턴 정보 업데이트
  if (!battle.turn) {
    battle.turn = {};
  }
  
  battle.turn.current = nextPlayer.id;
  battle.turn.lastChange = Date.now();
  battle.turn.number = (battle.turn.number || 0) + 1;
  
  // 새로운 라운드 시작 체크
  if (nextIdx === 0) {
    battle.turn.round = (battle.turn.round || 1) + 1;
  }

  return nextPlayer;
}

/**
 * 첫 번째 턴 전투참여자 결정 (민첩성 기반)
 * @param {Object} battle - 전투 상태
 * @returns {Object|null} - 첫 번째 턴 전투참여자
 */
export function initFirstTurn(battle) {
  if (!battle || !Array.isArray(battle.players) || battle.players.length === 0) {
    return null;
  }

  const alivePlayers = battle.players.filter(p => p && p.hp > 0);
  if (alivePlayers.length === 0) return null;

  // 팀별 민첩성 합계 계산
  const teamAAgility = sumTeamAgility(battle, 'A');
  const teamBAgility = sumTeamAgility(battle, 'B');
  
  // 선공 팀 결정
  const leadingTeam = teamAAgility >= teamBAgility ? 'A' : 'B';
  battle.leadingTeam = leadingTeam;
  
  // 선공 팀에서 가장 민첩한 전투참여자 선택
  const leadingTeamPlayers = alivePlayers
    .filter(p => p.team === leadingTeam)
    .sort((a, b) => (b.stats?.agility || 0) - (a.stats?.agility || 0));
  
  const firstPlayer = leadingTeamPlayers[0];
  
  // 턴 정보 초기화
  battle.turn = {
    current: firstPlayer ? firstPlayer.id : null,
    lastChange: Date.now(),
    number: 1,
    round: 1,
    phase: leadingTeam, // A 또는 B
    teamAAgility,
    teamBAgility,
    leadingTeam
  };

  return firstPlayer;
}

/**
 * 팀별 민첩성 합계 계산
 * @param {Object} battle - 전투 상태
 * @param {string} team - 팀 식별자 ('A' 또는 'B')
 * @returns {number} - 팀 민첩성 합계
 */
export function sumTeamAgility(battle, team) {
  return (battle.players || [])
    .filter(p => p && p.team === team && p.hp > 0)
    .reduce((sum, p) => sum + (p.stats?.agility || 0), 0);
}

/**
 * 전투 종료 여부 확인
 * @param {Object} battle - 전투 상태
 * @returns {boolean} - 전투 종료 여부
 */
export function isBattleOver(battle) {
  if (!battle || !Array.isArray(battle.players)) return true;
  
  const aliveA = battle.players.some(p => p && p.team === 'A' && p.hp > 0);
  const aliveB = battle.players.some(p => p && p.team === 'B' && p.hp > 0);
  
  // 한쪽 팀이 전멸하면 종료
  const teamElimination = !(aliveA && aliveB);
  
  // 시간 제한 체크
  const timeLimit = battle.options?.timeLimit || 3600000; // 1시간 기본값
  const timeExpired = battle.startedAt && (Date.now() - battle.startedAt) >= timeLimit;
  
  // 최대 턴 수 체크
  const maxTurns = battle.options?.maxTurns || 100;
  const turnLimitReached = (battle.turn?.number || 0) >= maxTurns;
  
  return teamElimination || timeExpired || turnLimitReached;
}

/**
 * 승자 결정 (체력 합산 기준)
 * @param {Object} battle - 전투 상태
 * @returns {string|null} - 승자 ('A', 'B', 'draw', null)
 */
export function determineWinner(battle) {
  if (!battle || !Array.isArray(battle.players)) return null;
  
  const aliveA = battle.players.some(p => p && p.team === 'A' && p.hp > 0);
  const aliveB = battle.players.some(p => p && p.team === 'B' && p.hp > 0);
  
  // 전멸 체크
  if (!aliveA && !aliveB) return 'draw';
  if (!aliveA) return 'B';
  if (!aliveB) return 'A';
  
  // 체력 합산으로 결정 (시간/턴 제한 도달시)
  const sumA = sumTeamHp(battle, 'A');
  const sumB = sumTeamHp(battle, 'B');
  
  if (sumA === sumB) return 'draw';
  return sumA > sumB ? 'A' : 'B';
}

/**
 * 승자 결정 (체력 합산만)
 * @param {Object} battle - 전투 상태
 * @returns {string|null} - 승자 ('A', 'B', null)
 */
export function winnerByHpSum(battle) {
  const sumA = sumTeamHp(battle, 'A');
  const sumB = sumTeamHp(battle, 'B');
  
  if (sumA === sumB) return null; // 무승부
  return sumA > sumB ? 'A' : 'B';
}

/**
 * 팀별 체력 합계 계산
 * @param {Object} battle - 전투 상태
 * @param {string} team - 팀 식별자 ('A' 또는 'B')
 * @returns {number} - 팀 체력 합계
 */
export function sumTeamHp(battle, team) {
  return (battle.players || [])
    .filter(p => p && p.team === team)
    .reduce((sum, p) => sum + Math.max(0, Number(p.hp || 0)), 0);
}

/**
 * 팀별 생존자 수 계산
 * @param {Object} battle - 전투 상태
 * @param {string} team - 팀 식별자 ('A' 또는 'B')
 * @returns {number} - 생존자 수
 */
export function countAliveTeamMembers(battle, team) {
  return (battle.players || [])
    .filter(p => p && p.team === team && p.hp > 0)
    .length;
}

/**
 * 전투 통계 생성
 * @param {Object} battle - 전투 상태
 * @returns {Object} - 전투 통계
 */
export function generateBattleStats(battle) {
  const stats = {
    duration: battle.startedAt ? Date.now() - battle.startedAt : 0,
    totalTurns: battle.turn?.number || 0,
    totalRounds: battle.turn?.round || 0,
    
    teamA: {
      players: battle.players.filter(p => p && p.team === 'A').length,
      alive: countAliveTeamMembers(battle, 'A'),
      totalHp: sumTeamHp(battle, 'A'),
      totalAgility: sumTeamAgility(battle, 'A')
    },
    
    teamB: {
      players: battle.players.filter(p => p && p.team === 'B').length,
      alive: countAliveTeamMembers(battle, 'B'),
      totalHp: sumTeamHp(battle, 'B'),
      totalAgility: sumTeamAgility(battle, 'B')
    },
    
    winner: determineWinner(battle),
    isOver: isBattleOver(battle),
    leadingTeam: battle.leadingTeam || null
  };
  
  return stats;
}

/**
 * 턴 타임아웃 체크
 * @param {Object} battle - 전투 상태
 * @returns {boolean} - 타임아웃 여부
 */
export function isTurnTimeout(battle) {
  if (!battle.turn || !battle.turn.lastChange) return false;
  
  const timeout = battle.options?.turnTimeout || 300000; // 5분 기본값
  return (Date.now() - battle.turn.lastChange) >= timeout;
}

/**
 * 자동 패스 처리 (타임아웃시)
 * @param {Object} battle - 전투 상태
 * @returns {Object} - 처리 결과
 */
export function handleAutoPass(battle) {
  if (!isTurnTimeout(battle)) {
    return { autoPass: false };
  }
  
  const currentPlayer = battle.players.find(p => p && p.id === battle.turn?.current);
  if (!currentPlayer) {
    return { autoPass: false };
  }
  
  // 다음 턴으로 넘김
  const nextPlayer = nextTurn(battle);
  
  return {
    autoPass: true,
    passedPlayer: currentPlayer,
    nextPlayer,
    message: `${currentPlayer.name}이(가) 시간 초과로 자동 패스됨`
  };
}

// 기본 export
export default {
  nextTurn,
  initFirstTurn,
  sumTeamAgility,
  isBattleOver,
  determineWinner,
  winnerByHpSum,
  sumTeamHp,
  countAliveTeamMembers,
  generateBattleStats,
  isTurnTimeout,
  handleAutoPass
};
