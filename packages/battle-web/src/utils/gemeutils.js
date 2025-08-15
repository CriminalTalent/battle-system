import { GAME_CONFIG } from './constants.js';
import { Character } from './Character.js';

// 스탯 검증
export function validateStats(stats) {
  const totalPoints = Object.values(stats).reduce((sum, val) => sum + val, 0);
  const isValidRange = Object.values(stats).every(val => 
    val >= GAME_CONFIG.MIN_STAT && val <= GAME_CONFIG.MAX_STAT
  );
  
  return {
    isValid: totalPoints === GAME_CONFIG.STAT_POINTS && isValidRange,
    totalPoints,
    maxPoints: GAME_CONFIG.STAT_POINTS
  };
}

// 랜덤 스탯 생성
export function generateRandomStats() {
  let remaining = GAME_CONFIG.STAT_POINTS;
  const stats = {
    attack: GAME_CONFIG.MIN_STAT,
    defense: GAME_CONFIG.MIN_STAT,
    agility: GAME_CONFIG.MIN_STAT,
    luck: GAME_CONFIG.MIN_STAT
  };
  
  remaining -= 4; // 각 스탯에 최소값 배정
  
  const statKeys = Object.keys(stats);
  
  while (remaining > 0) {
    const randomStat = statKeys[Math.floor(Math.random() * statKeys.length)];
    if (stats[randomStat] < GAME_CONFIG.MAX_STAT) {
      stats[randomStat]++;
      remaining--;
    }
  }
  
  return stats;
}

// 기본 적 생성
export function createEnemy(difficulty = 'normal') {
  const difficultySettings = {
    easy: { statBonus: -1, name: '초보 전사' },
    normal: { statBonus: 0, name: '전사' },
    hard: { statBonus: 1, name: '정예 전사' },
    boss: { statBonus: 2, name: '보스 전사' }
  };
  
  const setting = difficultySettings[difficulty] || difficultySettings.normal;
  const baseStats = generateRandomStats();
  
  // 난이도에 따른 스탯 조정
  Object.keys(baseStats).forEach(key => {
    baseStats[key] = Math.max(
      GAME_CONFIG.MIN_STAT,
      Math.min(GAME_CONFIG.MAX_STAT, baseStats[key] + setting.statBonus)
    );
  });
  
  return new Character(setting.name, baseStats);
}

// 스탯 총합 계산
export function getTotalStats(stats) {
  return Object.values(stats).reduce((sum, val) => sum + val, 0);
}

// 스탯 분배 가능 여부 확인
export function canAllocateStat(stats, statName, increment) {
  const currentValue = stats[statName];
  const newValue = currentValue + increment;
  const currentTotal = getTotalStats(stats);
  
  if (increment > 0) {
    return newValue <= GAME_CONFIG.MAX_STAT && currentTotal < GAME_CONFIG.STAT_POINTS;
  } else {
    return newValue >= GAME_CONFIG.MIN_STAT;
  }
}

// HP 퍼센티지 계산
export function getHpPercentage(current, max) {
  return Math.max(0, Math.min(100, (current / max) * 100));
}

// HP 색상 계산 (체력에 따른 색상 변화)
export function getHpColor(percentage) {
  if (percentage > 60) return 'bg-green-500';
  if (percentage > 30) return 'bg-yellow-500';
  if (percentage > 10) return 'bg-orange-500';
  return 'bg-red-500';
}

// 전투 결과 분석
export function analyzeBattleResult(battleState) {
  const { player, enemy, battleLog } = battleState;
  
  const playerDamageDealt = battleLog
    .filter(log => log.message.includes(player.name) && log.message.includes('데미지'))
    .length;
    
  const enemyDamageDealt = battleLog
    .filter(log => log.message.includes(enemy.name) && log.message.includes('데미지'))
    .length;
  
  return {
    playerHits: playerDamageDealt,
    enemyHits: enemyDamageDealt,
    totalTurns: battleState.currentTurn,
    battleLength: battleLog.length
  };
}

// 경험치 계산 (승리 시)
export function calculateExperience(playerStats, enemyStats, victory) {
  if (!victory) return 0;
  
  const enemyTotal = getTotalStats(enemyStats);
  const playerTotal = getTotalStats(playerStats);
  const difficulty = enemyTotal - playerTotal;
  
  let baseExp = 100;
  if (difficulty > 0) {
    baseExp += difficulty * 25; // 강한 적일수록 더 많은 경험치
  }
  
  return Math.max(50, baseExp);
}

// 디버그 정보 출력
export function getDebugInfo(character) {
  return {
    name: character.name,
    hp: `${character.hp}/${character.maxHp}`,
    stats: character.stats,
    totalStats: getTotalStats(character.stats),
    hitChance: `~${Math.round((character.stats.agility + 10.5) * 5)}%`, // 대략적인 명중률
    critChance: `~${Math.round((character.stats.luck * 2.5))}%` // 대략적인 크리티컬 확률
  };
}
