// BroadcastManager: 브로드캐스트 계층을 캡슐화 (선택 사용)
// - init(io) 로 초기화 후 instance 메서드로 송신
// - broadcast.js 의 함수형 API와 동일 동작

export class BroadcastManager {
  /** @param {import('socket.io').Server} io */
  constructor(io) {
    this.io = io;
  }
  room(battleId) { return String(battleId || ""); }

  state(battle) {
    if (!this.io || !battle) return;
    const payload = {
      id: battle.id,
      status: battle.status,
      turn: battle.turn,
      current: battle.current,
      startedAt: battle.startedAt,
      endedAt: battle.endedAt,
      turnEndsAt: battle.turnEndsAt,
      players: (battle.players || []).map(p => ({
        id: p.id, name: p.name, team: p.team, hp: p.hp,
        ready: !!p.ready, avatarUrl: p.avatarUrl, stats: p.stats
      })),
      log: (battle.log || []).slice(-200)
    };
    this.io.to(this.room(battle.id)).emit("battle:update", payload);
  }

  log(battleId, { type = "system", message = "" }) {
    if (!this.io || !battleId) return;
    this.io.to(this.room(battleId)).emit("battle:log", { type, message });
  }

  chat(battleId, { name = "", message = "" }) {
    if (!this.io || !battleId) return;
    this.io.to(this.room(battleId)).emit("battle:chat", { name, message });
  }

  spectators(battleId, count) {
    if (!this.io || !battleId) return;
    this.io.to(this.room(battleId)).emit("spectator:count", { count: Number(count) || 0 });
  }
}
