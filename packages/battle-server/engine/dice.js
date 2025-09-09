// PYXIS Dice/Random Utilities (ESM)
// - roll(n): 1..n
// - chance(p): 0..1
// - seedRng(seed): optional, reproducible RNG (LCG)

let RNG = Math.random;

export function roll(n = 20) {
  const r = RNG();
  return Math.max(1, Math.floor(r * n) + 1);
}

export function chance(p) {
  const q = Math.max(0, Math.min(1, Number(p) || 0));
  return RNG() < q;
}

// 간단 LCG 시드 RNG (선택 사용)
export function seedRng(seed = Date.now()) {
  let s = (Number(seed) >>> 0) || 1;
  RNG = function () {
    // LCG: X_{n+1} = (a X_n + c) mod m
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

// 기본 Math.random 사용으로 되돌리기
export function useSystemRng() {
  RNG = Math.random;
}