// PYXIS Turn Engine (ESM)
// - 턴 순서 관리
// - 전투 종료 판정
// - 승자 결정(체력 합산)

export function nextTurn(battle) {
  if (!battle || !Array.isArray(battle.players) || battle.players.length === 0) {
    battle.turn.current = null;
    return null;
  }
  const order = battle.players.map(p => p.id);
  const curIdx = Math.max(0, order.findIndex(id => id === battle.turn.current));
  const total = order.length;

  for (let step = 1; step <= total; step++) {
    const idx = (curIdx + step) % total;
    const cand = battle.players[idx];
    if (cand && cand.hp > 0) {
      battle.turn.current = cand.id;
      battle.turn.lastChange = Date.now();
      return cand;
    }
  }
  battle.turn.current = null;
  battle.turn.lastChange = Date.now();
  return null;
}

export function isBattleOver(battle) {
  const aliveA = battle.players.some(p => p.team === "phoenix" && p.hp > 0);
  const aliveB = battle.players.some(p => p.team === "eaters"  && p.hp > 0);
  return !(aliveA && aliveB);
}

export function winnerByHpSum(battle) {
  const sumA = sumTeamHp(battle, "phoenix");
  const sumB = sumTeamHp(battle, "eaters");
  if (sumA === sumB) return null;
  return sumA > sumB ? "phoenix" : "eaters";
}

export function sumTeamHp(battle, teamKey) {
  return (battle.players || [])
    .filter(p => p.team === teamKey)
    .reduce((s, p) => s + Math.max(0, Number(p.hp || 0)), 0);
}
