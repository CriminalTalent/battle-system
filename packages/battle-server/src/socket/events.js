
// events_a.js
// Root-path-safe Socket.IO event bindings. Exports { registerSocketEvents, battles }.

import crypto from 'crypto';
import { 
  initializeBroadcastManager,
  handlePlayerAction,
  handleTurnTimeout,
  startBattle,
  canPlayerAct,
  validateTarget,
  getRandomSpectatorComment
} from './battle-handlers_a.js';

import { broadcastChat, broadcastSpectatorCount } from './broadcast.js';

export const battles = new Map();

export function registerSocketEvents(io){
  const mgr = initializeBroadcastManager(io);

  io.on('connection', (socket)=>{
    // 방 참가(기존 호환)
    socket.on('join', ({ battleId })=>{
      if (!battleId) return;
      socket.join(`battle-${battleId}`);
      socket.emit('socket:connected', { ok:true, socketId: socket.id, ts: Date.now() });
    });
    socket.on('join_battle', ({ battleId })=>{
      if (!battleId) return;
      socket.join(`battle-${battleId}`);
    });

    // 전투 생성(기존 호환)
    socket.on('createBattle', ({ mode='1v1', title }, cb)=>{
      const id = crypto.randomUUID();
      const battle = {
        id, title: title || `PYXIS ${mode} 전투`,
        mode, status:'waiting', players:[], effects:[],
        logs:[], createdAt: Date.now(),
        urls: { admin:`/admin?battle=${id}`, player:`/player?battle=${id}`, spectator:`/spectator?battle=${id}` },
        currentTurn: null
      };
      battles.set(id, battle);
      cb && cb({ ok:true, battleId: id, battle });
    });
    socket.on('create_battle', (d,cb)=> socket.emit('createBattle', d, cb));

    // 전투 제어
    socket.on('startBattle', ({ battleId })=>{
      const b = battles.get(battleId); if (!b) return;
      startBattle(io, b);
    });
    socket.on('endBattle', ({ battleId })=>{
      const b = battles.get(battleId); if (!b) return;
      b.status = 'ended';
      io.to(`battle-${battleId}`).emit('battle_end', { winner:'draw' });
    });
    socket.on('pauseBattle', ({ battleId })=>{
      const b = battles.get(battleId); if (!b) return;
      b.status = 'paused';
      io.to(`battle-${battleId}`).emit('battle_update', { type:'paused' });
    });
    socket.on('resumeBattle', ({ battleId })=>{
      const b = battles.get(battleId); if (!b) return;
      b.status = 'active';
      io.to(`battle-${battleId}`).emit('battle_update', { type:'resumed' });
    });

    // 플레이어 관리
    socket.on('addPlayer', ({ battleId, player })=>{
      const b = battles.get(battleId); if (!b) return;
      b.players.push(player);
      io.to(`battle-${battleId}`).emit('battle:update', b);
    });
    socket.on('removePlayer', ({ battleId, playerId })=>{
      const b = battles.get(battleId); if (!b) return;
      b.players = (b.players||[]).filter(p=> p.id!==playerId);
      io.to(`battle-${battleId}`).emit('battle:update', b);
    });

    // 플레이어 행동
    socket.on('action', (data)=>{
      const b = battles.get(data?.battleId); if (!b) return;
      handlePlayerAction(io, b, data);
    });
    socket.on('playerAction', (data)=> socket.emit('action', data));

    // 채팅 / 응원
    socket.on('chatMessage', (d)=> broadcastChat(io, d?.battleId, d));
    socket.on('battle:chat',  (d)=> broadcastChat(io, d?.battleId, d));
    socket.on('spectator:cheer', (d)=> {
      broadcastChat(io, d?.battleId, { name: d?.name || '관전자', message: d?.message || '' });
    });

    // 연결 종료
    socket.on('disconnect', ()=>{});
  });

  // 관전자 수 브로드캐스트 예시(선택): mgr.broadcastSpectatorCount(...)
}

