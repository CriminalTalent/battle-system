// packages/battle-server/src/dice.js - 주사위 롤링 유틸리티

/**
 * 기본 주사위 굴림
 * @param {number} sides - 면의 수 (기본 20)
 * @returns {number} - 1 ~ sides 사이의 랜덤 값
 */
export function roll(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * 여러 번 주사위 굴림
 * @param {number} count - 굴릴 횟수
 * @param {number} sides - 면의 수 (기본 20)
 * @returns {number[]} - 각 굴림 결과 배열
 */
export function rollMultiple(count, sides = 20) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(roll(sides));
  }
  return results;
}

/**
 * 범위 내 주사위 굴림
 * 예: rollRange(5, 10) → 5~10 사이 랜덤 정수
 * @param {number} min - 최소값
 * @param {number} max - 최대값
 * @returns {number} - min ~ max 사이의 랜덤 값
 */
export function rollRange(min, max) {
  if (min > max) [min, max] = [max, min];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 확률 체크용 주사위
 * 예: checkSuccess(30) → 30% 확률 성공 여부
 * @param {number} chance - 성공 확률 (0~100)
 * @returns {boolean}
 */
export function checkSuccess(chance) {
  const value = roll(100);
  return value <= chance;
}

export default { roll, rollMultiple, rollRange, checkSuccess };
