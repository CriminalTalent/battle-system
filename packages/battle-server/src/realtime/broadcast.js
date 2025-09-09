// Broadcast helpers: 단일 전투 룸으로 상태/로그/채팅을 내보내는 유틸
// - index.js 또는 socketHandlers.js 에서 주입한 io를 사용
// - 상태키: waiting | active | paused | ended

let ioRef = null;

export function initBroadcast(io) {
  ioRef = io;
}

function room(battleId) {
  return String(battleId || "");
}

export function broadcastBattleState(battle) {
  if (!ioRef || !battle) return;
  const payload = {
    id: battle.id,
    status: battle.status,
    turn: battle.turn,
    current: battle.current,
    startedAt: battle.startedAt,
    endedAt: battle.endedAt,
    turnEndsAt: battle.turnEndsAt,
    players: (battle.players || []).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      ready: !!p.ready,
      avatarUrl: p.avatarUrl,
      stats: p.stats
    })),
    log: (battle.log || []).slice(-200)
  };
  ioRef.to(room(battle.id)).emit("battle:update", payload);
}

export function broadcastBattleLog(battleId, { type = "system", message = "" }) {
  if (!ioRef || !battleId) return;
  ioRef.to(room(battleId)).emit("battle:log", { type, message });
}

export function broadcastChat(battleId, { name = "", message = "" }) {
  if (!ioRef || !battleId) return;
  ioRef.to(room(battleId)).emit("battle:chat", { name, message });
}

export function broadcastSpectatorCount(battleId, count) {
  if (!ioRef || !battleId) return;
  ioRef.to(room(battleId)).emit("spectator:count", { count: Number(count) || 0 });
}
