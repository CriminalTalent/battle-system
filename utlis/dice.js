/**
 * Dice and Random Utility Functions
 * 주사위 굴리기와 랜덤 계산 관련 유틸리티
 */

/**
 * 1부터 sides까지의 랜덤한 숫자 반환 (주사위)
 */
function rollDice(sides = 6) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * min부터 max까지의 랜덤한 정수 반환
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 0부터 max까지의 랜덤한 실수 반환
 */
function randomFloat(max = 1) {
  return Math.random() * max;
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
 * 데미지 계산 (기본 공격)
 * @param {number} minDamage - 최소 데미지
 * @param {number} maxDamage - 최대 데미지
 * @param {number} criticalChance - 크리티컬 확률
 * @param {number} criticalMultiplier - 크리티컬 배율
 * @returns {Object} - {damage, isCritical}
 */
function calculateDamage(
  minDamage = 10, 
  maxDamage = 20, 
  criticalChance = 0.1, 
  criticalMultiplier = 2.0
) {
  let baseDamage = randomInt(minDamage, maxDamage);
  const isCritical = checkChance(criticalChance);
  
  if (isCritical) {
    baseDamage = Math.floor(baseDamage * criticalMultiplier);
  }
  
  return {
    damage: baseDamage,
    isCritical
  };
}

/**
 * 방어 계산
 * @param {number} incomingDamage - 들어오는 데미지
 * @param {number} defenseReduction - 방어 감소율 (0.5 = 50% 감소)
 * @param {number} blockChance - 완전 방어 확률 (선택적)
 * @returns {Object} - {finalDamage, isBlocked, damageReduced}
 */
function calculateDefense(
  incomingDamage, 
  defenseReduction = 0.5, 
  blockChance = 0
) {
  const isBlocked = blockChance > 0 && checkChance(blockChance);
  
  if (isBlocked) {
    return {
      finalDamage: 0,
      isBlocked: true,
      damageReduced: incomingDamage
    };
  }
  
  const damageReduced = Math.floor(incomingDamage * defenseReduction);
  const finalDamage = Math.max(0, incomingDamage - damageReduced);
  
  return {
    finalDamage,
    isBlocked: false,
    damageReduced
  };
}

/**
 * 회복 계산
 * @param {number} minHeal - 최소 회복량
 * @param {number} maxHeal - 최대 회복량
 * @param {number} currentHP - 현재 HP
 * @param {number} maxHP - 최대 HP
 * @returns {Object} - {healAmount, newHP}
 */
function calculateHealing(minHeal, maxHeal, currentHP, maxHP) {
  const baseHeal = randomInt(minHeal, maxHeal);
  const healAmount = Math.min(baseHeal, maxHP - currentHP);
  const newHP = Math.min(currentHP + healAmount, maxHP);
  
  return {
    healAmount,
    newHP
  };
}

/**
 * 상태이상 지속시간 계산
 * @param {number} baseDuration - 기본 지속시간
 * @param {number} variance - 변동폭 (0.2 = ±20%)
 * @returns {number} - 실제 지속시간
 */
function calculateStatusDuration(baseDuration, variance = 0.2) {
  const minDuration = Math.floor(baseDuration * (1 - variance));
  const maxDuration = Math.ceil(baseDuration * (1 + variance));
  return randomInt(minDuration, maxDuration);
}

/**
 * 경험치 계산 (미래 확장용)
 * @param {number} baseExp - 기본 경험치
 * @param {number} levelDifference - 레벨 차이
 * @param {boolean} isWin - 승리 여부
 * @returns {number} - 획득 경험치
 */
function calculateExperience(baseExp, levelDifference = 0, isWin = true) {
  let multiplier = isWin ? 1.0 : 0.3; // 패배시 30% 경험치
  
  // 레벨 차이에 따른