// packages/battle-server/src/engine/dice.js
export const rndInt = (min, max) => (Math.floor(Math.random() * (max - min + 1)) + min);
export const d20 = () => rndInt(1, 10); // D20 -> D10으로 변경
export const d10 = () => rndInt(1, 10); // D10 함수 추가
export const d = (n) => rndInt(1, n);
