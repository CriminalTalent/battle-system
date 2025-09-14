// packages/battle-server/src/engine/dice.js
export const rndInt = (min, max) => (Math.floor(Math.random() * (max - min + 1)) + min);
export const d20 = () => rndInt(1, 20);
export const d = (n) => rndInt(1, n);
