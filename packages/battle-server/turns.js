// packages/battle-server/src/turns.js
// PYXIS Turn Engine (ESM)
// - 턴 순서 관리 (A팀/B팀 기준)
// - 전투 종료 판정
// - 승자 결정(체력 합산)
// - BattleEngine과 통합된 턴 관리

import { roll } from './dice.js';

/**
 * 다음 턴 전투참여자 결정
 */
export function nextTurn(battle) {
  if (!battle || !Array.isArray(battle.players) || battle.players.length === 0) {
    if (battle.turn) {
      battle.turn.current = null;
      battle.turn.lastChange = Date.now();
    }
    return null;
  }

  const alivePlayers = battle.players.filter(p => p && p.hp > 0);
  if (alivePlayers.length === 0) {
    if (battle.turn) {
      battle.turn.current = null;
      battle.turn.lastChange = Date.now();
    }
    return null;
  }

  const currentId = battle.turn?.current;
  const currentIdx = alivePlayers.findIndex(p => p.id === currentId);
  const nextIdx = (currentIdx + 1) % alivePlayers.length;
  const nextPlayer = alivePlayers[nextIdx];

  if (!battle.turn) battle.turn = {};
  battle.turn.current = nextPlayer.id;
  battle.turn.lastChange = Date.now();
  battle.turn.number = (battle.turn.number || 0) + 1;

  if (nextIdx === 0) {
    battle.turn.round = (battle.turn.round || 1) + 1;
  }

  return nextPlayer;
}

/**
 * 첫 번째 턴 전투참여자 결정 (팀별 민첩 합계 + D20, 동점시 재굴림)
 */
export function initFirstTurn(battle) {
  if (!battle || !Array.isArray(battle.players) || battle.players.length === 0) return null;

  const alivePlayers = battle.players.filter(p => p && p.hp > 0);
  if (alivePlayers.length === 0) return null;

  // 팀별 민첩 합계 + D20
  let teamAAgility = sumTeamAgility(battle, 'A') + roll(20);
  let teamBAgility = sumTeamAgility(battle, 'B') + roll(20);

  // 동점이면 재굴림
  while (teamAAgility === teamBAgility) {
    teamAAgility = sumTeamAgility(battle, 'A') + roll(20);
    teamBAgility = sumTeamAgility(battle, 'B') + roll(20);
  }

  const leadingTeam = teamAAgility > teamBAgility ? 'A' : 'B';
  battle.leadingTeam = leadingTeam;

  // 선공 팀의 아무 생존자
  const firstPlayer = alivePlayers.find(p => p.team === leadingTeam);

  battle.turn = {
    current: firstPlayer ? firstPlayer.id : null,
    lastChange: Date.now(),
    number: 1,
    round: 1,
    phase: leadingTeam,
    teamAAgility,
    teamBAgility,
    leadingTeam
  };

  return firstPlayer;
}

/** 팀별 민첩 합계 */
export function sumTeamAgility(battle, team) {
  return (battle.players || [])
    .filter(p => p && p.team === team && p.hp > 0)
    .reduce((sum, p) => sum + (p.stats?.agility || 0), 0);
}

/** 전투 종료 여부 */
export function isBattleOver(battle) {
  if (!battle || !Array.isArray(battle.players)) return true;

  const aliveA = battle.players.some(p => p && p.team === 'A' && p.hp > 0);
  const aliveB = battle.players.some(p => p && p.team === 'B' && p.hp > 0);

  const teamElimination = !(aliveA && aliveB);
  const timeLimit = battle.options?.timeLimit || 3600000;
  const timeExpired = battle.startedAt && (Date.now() - battle.startedAt) >= timeLimit;
  const maxTurns = battle.options?.maxTurns || 100;
  const turnLimitReached = (battle.turn?.number || 0) >= maxTurns;

  return teamElimination || timeExpired || turnLimitReached;
}

/** 승자 결정 */
export function determineWinner(battle) {
  if (!battle || !Array.isArray(battle.players)) return null;

  const aliveA = battle.players.some(p => p && p.team === 'A' && p.hp > 0);
  const aliveB = battle.players.some(p => p && p.team === 'B' && p.hp > 0);

  if (!aliveA && !aliveB) return 'draw';
  if (!aliveA) return 'B';
  if (!aliveB) return 'A';

  const sumA = sumTeamHp(battle, 'A');
  const sumB = sumTeamHp(battle, 'B');

  if (sumA === sumB) return 'draw';
  return sumA > sumB ? 'A' : 'B';
}

/** 체력 합산 승자 */
export function winnerByHpSum(battle) {
  const sumA = sumTeamHp(battle, 'A');
  const sumB = sumTeamHp(battle, 'B');
  if (sumA === sumB) return null;
  return sumA > sumB ? 'A' : 'B';
}

/** 팀별 체력 합계 */
export function sumTeamHp(battle, team) {
  return (battle.players || [])
    .filter(p => p && p.team === team)
    .reduce((sum, p) => sum + Math.max(0, Number(p.hp || 0)), 0);
}

/** 팀별 생존자 수 */
export function countAliveTeamMembers(battle, team) {
  return (battle.players || [])
    .filter(p => p && p.team === team && p.hp > 0)
    .length;
}

/** 전투 통계 */
export function generateBattleStats(battle) {
  return {
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
}

/** 턴 타임아웃 */
export function isTurnTimeout(battle) {
  if (!battle.turn || !battle.turn.lastChange) return false;
  const timeout = battle.options?.turnTimeout || 300000;
  return (Date.now() - battle.turn.lastChange) >= timeout;
}

/** 자동 패스 처리 */
export function handleAutoPass(battle) {
  if (!isTurnTimeout(battle)) return { autoPass: false };
  const currentPlayer = battle.players.find(p => p && p.id === battle.turn?.current);
  if (!currentPlayer) return { autoPass: false };

  const nextPlayer = nextTurn(battle);
  return {
    autoPass: true,
    passedPlayer: currentPlayer,
    nextPlayer,
    message: `${currentPlayer.name}이(가) 시간 초과로 자동 패스됨`
  };
}

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
