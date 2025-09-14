
// broadcast.js
// Unified broadcaster: emits both legacy and new event names for compatibility.
export class BroadcastManager {
  constructor(io){ this.io = io; }

  _rooms(battle){ 
    const id = typeof battle === 'string' ? battle : battle?.id;
    return [`battle-${id}`, id, String(id)];
  }

  // ---- low-level helpers ----
  _emitRooms(rooms, evt, payload){
    rooms.forEach(r => this.io.to(r).emit(evt, payload));
  }

  // ---- generic ----
  broadcastBattleUpdate(battle, opts={}){
    const payload = sanitizeBattle(battle);
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'battleUpdate', payload);
    this._emitRooms(rooms, 'battle:update', payload);
    if (opts.immediate) { /* no-op; kept for API parity */ }
  }

  broadcastSystemLog(battleId, log){
    const rooms = this._rooms(battleId);
    this._emitRooms(rooms, 'battleLog', log);
    this._emitRooms(rooms, 'battle:log', log);
  }

  broadcastCombatLog(battleId, logs){
    const rooms = this._rooms(battleId);
    (logs || []).forEach(l => {
      this._emitRooms(rooms, 'battleLog', l);
      this._emitRooms(rooms, 'battle:log', l);
    });
  }

  broadcastActionResult(battle, action, result){
    const payload = { type:'action_result', action, ...result };
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'battle_update', payload);
    this._emitRooms(rooms, 'actionSuccess', payload);
  }

  broadcastPhaseComplete(battle, payload){
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'phase_complete', payload);
  }

  broadcastTurnChange(battle, payload){
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'turn_change', payload);
  }

  broadcastBattleStart(battle, initiative){
    const payload = { type:'battle_start', initiative };
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'battle_start', payload);
    this._emitRooms(rooms, 'battle:started', payload);
    this._emitRooms(rooms, 'battleStarted', payload);
  }

  broadcastBattleEnd(battle, endData){
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'battle_end', endData);
    this._emitRooms(rooms, 'battle:ended', endData);
  }

  broadcastChat(battleId, data){
    const rooms = this._rooms(battleId);
    this._emitRooms(rooms, 'chatMessage', data);
    this._emitRooms(rooms, 'battle:chat', data);
  }

  broadcastSpectatorCount(battleId, count){
    const rooms = this._rooms(battleId);
    this._emitRooms(rooms, 'spectator_count', { count });
  }
}

// Fallback functional APIs (some code imports these directly)
export const broadcastChat = (io, battleId, data)=> {
  const mgr = new BroadcastManager(io);
  mgr.broadcastChat(battleId, data);
};
export const broadcastSpectatorCount = (io, battleId, count)=> {
  const mgr = new BroadcastManager(io);
  mgr.broadcastSpectatorCount(battleId, count);
};

function sanitizeBattle(b){
  // Shallow copy only the fields the clients rely on.
  if (!b) return {};
  return {
    id: b.id,
    status: b.status,
    players: b.players,
    effects: b.effects,
    currentTeam: b.currentTeam,
    timeLeft: b.timeLeft,
    turn: b.turn,
    currentTurn: b.currentTurn,
    leadingTeam: b.leadingTeam
  };
}
