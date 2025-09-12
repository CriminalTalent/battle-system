// packages/battle-server/src/dice.js
// PYXIS Dice/Random Utilities (ESM)
// - roll(n): 1..n
// - rollWithReroll(n): 같은 값이면 재굴림
// - chance(p): 0..1
// - seedRng(seed): optional, reproducible RNG (LCG)
"use strict";

let RNG = Math.random;

/**
 * n면체 주사위 굴리기
 * @param {number} n 
 * @returns {number} 1 ~ n
 */
export function roll(n = 20) {
  const r = RNG();
  return Math.max(1, Math.floor(r * n) + 1);
}

/**
 * 재굴림 기능이 있는 주사위 굴리기
 * 첫 번째와 두 번째 값이 같으면 세 번째 굴림 실행
 * @param {number} n 
 * @returns {object} { first, second, final, rerolled }
 */
export function rollWithReroll(n = 20) {
  const first = roll(n);
  const second = roll(n);
  
  if (first === second) {
    // 같은 값이면 한번 더 굴림
    const third = roll(n);
    return {
      first,
      second,
      final: third,
      rerolled: true,
      rolls: [first, second, third]
    };
  } else {
    return {
      first,
      second, 
      final: second,
      rerolled: false,
      rolls: [first, second]
    };
  }
}

/**
 * 여러 개 주사위 굴리기
 * @param {number} count 
 * @param {number} n 
 * @returns {Array<number>}
 */
export function rollMultiple(count, n = 20) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(roll(n));
  }
  return results;
}

/**
 * 재굴림 기능으로 여러 개 주사위 굴리기
 * @param {number} count 
 * @param {number} n 
 * @returns {Array<object>}
 */
export function rollMultipleWithReroll(count, n = 20) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(rollWithReroll(n));
  }
  return results;
}

/**
 * 확률 판정
 * @param {number} p 0~1 또는 0~100 (100보다 크면 퍼센트로 간주)
 * @returns {boolean}
 */
export function chance(p) {
  let probability = Number(p) || 0;
  
  // 100보다 크면 퍼센트로 간주하고 0~1로 변환
  if (probability > 1) {
    probability = probability / 100;
  }
  
  const q = Math.max(0, Math.min(1, probability));
  return RNG() < q;
}

/**
 * 확률 판정 (퍼센트 기준)
 * @param {number} percent 0~100
 * @returns {boolean}
 */
export function chancePercent(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return RNG() * 100 < p;
}

/**
 * 범위 내 랜덤 정수
 * @param {number} min 
 * @param {number} max 
 * @returns {number}
 */
export function randomInt(min, max) {
  const minVal = Math.ceil(Number(min) || 0);
  const maxVal = Math.floor(Number(max) || 0);
  return Math.floor(RNG() * (maxVal - minVal + 1)) + minVal;
}

/**
 * 배열에서 랜덤 요소 선택
 * @param {Array} array 
 * @returns {*}
 */
export function randomChoice(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return undefined;
  }
  const index = Math.floor(RNG() * array.length);
  return array[index];
}

/**
 * 가중치가 있는 랜덤 선택
 * @param {Array<{item: *, weight: number}>} choices 
 * @returns {*}
 */
export function weightedChoice(choices) {
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  
  const totalWeight = choices.reduce((sum, choice) => sum + (choice.weight || 0), 0);
  if (totalWeight <= 0) {
    return randomChoice(choices.map(c => c.item));
  }
  
  let random = RNG() * totalWeight;
  
  for (const choice of choices) {
    random -= (choice.weight || 0);
    if (random <= 0) {
      return choice.item;
    }
  }
  
  // 폴백
  return choices[choices.length - 1].item;
}

/**
 * 배열 섞기 (Fisher-Yates)
 * @param {Array} array 
 * @returns {Array} 새로운 섞인 배열
 */
export function shuffle(array) {
  if (!Array.isArray(array)) {
    return [];
  }
  
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(RNG() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 시드 기반 RNG 설정 (LCG)
 * @param {number} seed 
 */
export function seedRng(seed = Date.now()) {
  let s = (Number(seed) >>> 0) || 1;
  RNG = function() {
    // Linear Congruential Generator: X_{n+1} = (a * X_n + c) mod m
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000; // 2^32
  };
}

/**
 * Math.random으로 복원
 */
export function useSystemRng() {
  RNG = Math.random;
}

/**
 * 현재 RNG 함수 반환 (테스트용)
 * @returns {Function}
 */
export function getCurrentRng() {
  return RNG;
}

/**
 * RNG 상태 확인 (시드 사용 중인지)
 * @returns {boolean}
 */
export function isUsingSeededRng() {
  return RNG !== Math.random;
}

// 편의 함수들
export const d4 = () => roll(4);
export const d6 = () => roll(6);
export const d8 = () => roll(8);
export const d10 = () => roll(10);
export const d12 = () => roll(12);
export const d20 = () => roll(20);
export const d100 = () => roll(100);

// 재굴림 버전
export const d20WithReroll = () => rollWithReroll(20);
export const d100WithReroll = () => rollWithReroll(100);

// 기본 export
export default {
  roll,
  rollWithReroll,
  rollMultiple,
  rollMultipleWithReroll,
  chance,
  chancePercent,
  randomInt,
  randomChoice,
  weightedChoice,
  shuffle,
  seedRng,
  useSystemRng,
  getCurrentRng,
  isUsingSeededRng,
  // 주사위 단축키
  d4, d6, d8, d10, d12, d20, d100,
  d20WithReroll,
  d100WithReroll
};
