// packages/battle-server/dice.js
// PYXIS Dice/Random Utilities (CommonJS)
// - roll(n): 1..n
// - chance(p): 0..1
// - seedRng(seed): optional, reproducible RNG (LCG)

"use strict";

let RNG = Math.random;

/**
 * n면체 주사위 굴리기
 * @param {number} n
 * @returns {number} 1 ~ n
 */
function roll(n = 20) {
  const r = RNG();
  return Math.max(1, Math.floor(r * n) + 1);
}

/**
 * 확률 판정
 * @param {number} p 0~1
 * @returns {boolean}
 */
function chance(p) {
  const q = Math.max(0, Math.min(1, Number(p) || 0));
  return RNG() < q;
}

/**
 * 시드 기반 RNG (LCG)
 * @param {number} seed
 */
function seedRng(seed = Date.now()) {
  let s = (Number(seed) >>> 0) || 1;
  RNG = function () {
    // LCG: X_{n+1} = (a X_n + c) mod m
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

/**
 * Math.random 으로 복원
 */
function useSystemRng() {
  RNG = Math.random;
}

module.exports = {
  roll,
  chance,
  seedRng,
  useSystemRng,
};
