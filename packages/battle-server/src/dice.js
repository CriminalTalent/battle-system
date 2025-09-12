// packages/battle-server/src/dice.js
// 주사위 롤링 유틸리티 (호환용 별칭 포함: d, roll, d100, chance, checkSuccess 등)

/** 기본 주사위 한 번 굴림 (기본 D20) */
export function d(sides = 20) {
  const n = Number.isFinite(sides) && sides > 0 ? Math.floor(sides) : 20;
  return Math.floor(Math.random() * n) + 1; // 1..n
}

/** 별칭: d()와 동일 (기존 코드 호환) */
export const roll = (sides = 20) => d(sides);

/** 여러 번 굴림 */
export function rollMultiple(count, sides = 20) {
  const c = Math.max(0, Math.floor(count));
  const out = new Array(c);
  for (let i = 0; i < c; i++) out[i] = d(sides);
  return out;
}

/** 정수 범위 랜덤 (min..max) */
export function rollRange(min, max) {
  let a = Math.floor(min), b = Math.floor(max);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return d(20);
  if (a > b) [a, b] = [b, a];
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

/** D100 한 번 */
export const d100 = () => d(100);

/** 확률(percent %) 성공 여부 */
export function chance(percent = 50) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return d100() <= p;
}

/** 별칭: chance()와 동일 (기존 코드 호환) */
export const checkSuccess = (pct) => chance(pct);

/** 별칭: rollRange() (이름만 다름) */
export const randInt = (min, max) => rollRange(min, max);

/** 기본 내보내기(디폴트)도 제공해서 import 방식 혼용 지원 */
export default { d, roll, rollMultiple, rollRange, randInt, d100, chance, checkSuccess };
