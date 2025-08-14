// 주사위 굴리기 유틸리티
export const rollDice = (sides = 6, count = 1) => {
  let total = 0;
  const rolls = [];
  
  for (let i = 0; i < count; i++) {
    const roll = Math.floor(Math.random() * sides) + 1;
    rolls.push(roll);
    total += roll;
  }
  
  return {
    total,
    rolls,
    average: total / count
  };
};

export const rollD20 = () => rollDice(20, 1);
export const rollD6 = (count = 1) => rollDice(6, count);
export const rollD4 = (count = 1) => rollDice(4, count);