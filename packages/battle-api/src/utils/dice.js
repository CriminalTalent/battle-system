/**
 * Dice and Random Utility Functions
 * 주사위 굴리기와 랜덤 계산 관련 유틸리티
 */

/**
 * 1부터 sides까지의 랜덤한 숫자 반환 (주사위)
 */
function rollDice(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * 여러 주사위 굴리기
 */
function rollMultipleDice(sides = 20, count = 1) {
  const rolls = [];
  let total = 0;
  
  for (let i = 0; i < count; i++) {
    const roll = rollDice(sides);
    rolls.push(roll);
    total += roll;
  }
  
  return {
    rolls,
    total,
    average: total / count
  };
}

/**
 * min부터 max까지의 랜덤한 정수 반환
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 확률 체크 (0.0 ~ 1.0)
 * @param {number} chance - 확률 (0.1 = 10%)
 * @returns {boolean} - 성공 여부
 */
function checkChance(chance) {
  return Math.random() < chance;
}

/**
 * 배열에서 랜덤한 요소 선택
 */
function randomChoice(array) {
  if (!array || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * 가중치 기반 랜덤 선택
 * @param {Array} items - [{value, weight}, ...] 형태의 배열
 */
function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) {
      return item.value;
    }
  }
  
  return items[items.length - 1].value;
}

/**
 * 데미지 계산 (공격력, 방어력, 주사위 결과 기반)
 * @param {number} attack - 공격력 (1-5)
 * @param {number} defense - 방어력 (1-5)
 * @param {number} roll - 주사위 결과 (1-20)
 * @returns {number} - 최종 데미지
 */
function calculateDamage(attack, defense, roll) {
  // 기본 데미지 = (공격력 * 2) + (주사위 / 2)
  const baseDamage = (attack * 2) + Math.floor(roll / 2);
  
  // 방어력으로 데미지 감소
  const finalDamage = Math.max(1, baseDamage - defense);
  
  return finalDamage;
}

/**
 * 명중률 계산
 * @param {number} agility - 공격자 민첩
 * @param {number} targetAgility - 대상 민첩
 * @param {number} roll - 주사위 결과 (1-20)
 * @returns {boolean} - 명중 여부
 */
function calculateHit(agility, targetAgility, roll) {
  // 기본 명중 기준값: 10
  const baseHitThreshold = 10;
  
  // 민첩 차이만큼 조정
  const agilityBonus = agility - targetAgility;
  
  // 최종 명중 기준값
  const hitThreshold = baseHitThreshold - agilityBonus;
  
  return roll >= Math.max(2, Math.min(19, hitThreshold));
}

/**
 * 크리티컬 히트 확인
 * @param {number} luck - 행운 스탯 (1-5)
 * @param {number} roll - 주사위 결과 (1-20)
 * @returns {boolean} - 크리티컬 여부
 */
function calculateCritical(luck, roll) {
  // 기본 크리티컬 기준: 20
  // 행운 1당 크리티컬 범위 1씩 증가 (행운 5면 16-20)
  const criticalThreshold = 21 - luck;
  
  return roll >= criticalThreshold;
}

/**
 * 회피 계산
 * @param {number} agility - 방어자 민첩
 * @param {number} roll - 주사위 결과 (1-20)
 * @returns {boolean} - 회피 여부
 */
function calculateDodge(agility, roll) {
  // 민첩이 높을수록 회피 확률 증가
  // 민첩 1: 5% (20), 민첩 5: 25% (16-20)
  const dodgeThreshold = 21 - agility;
  
  return roll >= dodgeThreshold;
}

/**
 * 종합 전투 계산
 * @param {Object} attacker - 공격자 스탯
 * @param {Object} defender - 방어자 스탯
 * @returns {Object} - 전투 결과
 */
function calculateBattleResult(attacker, defender) {
  const attackRoll = rollDice(20);
  const defenseRoll = rollDice(20);
  
  // 명중 확인
  const isHit = calculateHit(attacker.agility, defender.agility, attackRoll);
  
  if (!isHit) {
    return {
      hit: false,
      damage: 0,
      critical: false,
      dodge: false,
      attackRoll,
      defenseRoll,
      message: '공격이 빗나갔습니다!'
    };
  }
  
  // 회피 확인 (명중해도 회피 가능)
  const isDodged = calculateDodge(defender.agility, defenseRoll);
  
  if (isDodged) {
    return {
      hit: true,
      damage: 0,
      critical: false,
      dodge: true,
      attackRoll,
      defenseRoll,
      message: '공격을 회피했습니다!'
    };
  }
  
  // 크리티컬 확인
  const isCritical = calculateCritical(attacker.luck, attackRoll);
  
  // 데미지 계산
  let damage = calculateDamage(attacker.attack, defender.defense, attackRoll);
  
  // 크리티컬이면 1.5배
  if (isCritical) {
    damage = Math.floor(damage * 1.5);
  }
  
  return {
    hit: true,
    damage,
    critical: isCritical,
    dodge: false,
    attackRoll,
    defenseRoll,
    message: isCritical 
      ? `크리티컬 히트! ${damage} 데미지!`
      : `${damage} 데미지를 입혔습니다!`
  };
}

/**
 * 방어 행동 효과 계산
 * @param {number} defense - 방어력
 * @param {number} roll - 주사위 결과
 * @returns {Object} - 방어 효과
 */
function calculateDefenseBonus(defense, roll) {
  // 방어 행동시 다음 턴까지 방어력 증가
  const bonusDefense = Math.floor((defense + roll) / 4);
  
  return {
    bonusDefense,
    duration: 1, // 1턴
    message: `방어 태세! 다음 턴까지 방어력 +${bonusDefense}`
  };
}

/**
 * 스탯 유효성 검사
 * @param {Object} stats - 스탯 객체
 * @returns {boolean} - 유효 여부
 */
function validateStats(stats) {
  const requiredStats = ['attack', 'defense', 'agility', 'luck'];
  
  for (const stat of requiredStats) {
    if (!stats[stat] || stats[stat] < 1 || stats[stat] > 5) {
      return false;
    }
  }
  
  return true;
}

/**
 * 랜덤 스탯 생성 (총합 제한)
 * @param {number} totalPoints - 총 스탯 포인트 (기본 14)
 * @returns {Object} - 랜덤 스탯
 */
function generateRandomStats(totalPoints = 14) {
  let remaining = totalPoints;
  const stats = {
    attack: 1,
    defense: 1,
    agility: 1,
    luck: 1
  };
  
  remaining -= 4; // 기본 1씩 할당
  
  const statNames = Object.keys(stats);
  
  while (remaining > 0) {
    const randomStat = randomChoice(statNames);
    if (stats[randomStat] < 5) {
      stats[randomStat]++;
      remaining--;
    }
  }
  
  return stats;
}

module.exports = {
  rollDice,
  rollMultipleDice,
  randomInt,
  checkChance,
  randomChoice,
  weightedRandom,
  calculateDamage,
  calculateHit,
  calculateCritical,
  calculateDodge,
  calculateBattleResult,
  calculateDefenseBonus,
  validateStats,
  generateRandomStats
};
