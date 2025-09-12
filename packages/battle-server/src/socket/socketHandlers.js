// packages/battle-server/src/socket/socketHandlers.js
// ESM 모드
'use strict';

/**
 * 소켓 이벤트 바인딩 모듈형 핸들러
 * - index.js에서 이미 동일 이벤트를 직접 바인딩했다면, 중복 바인딩을 피하기 위해 이 함수를 호출하지 마세요.
 * - 모듈형으로 분리 운용하려면 index.js에서 아래처럼 호출:
 *     import { makeSocketHandlers } from './src/socket/socketHandlers.js';
 *     makeSocketHandlers(io, { battles, emitUpdate });
 *
 * @param {import('socket.io').Server} io
 * @param {{ battles?: Map<string, any>, emitUpdate?: (b:any)=>void }} deps
 */
export function makeSocketHandlers(io, deps = {}) {
  const battles = deps.battles instanceof Map ? deps.battles : new Map();
  const emitUpdate =
    typeof deps.emitUpdate === 'function'
      ? deps.emitUpdate
      : (b) => {
          io.emit('battleUpdate', b);
          io.emit('battle:update', b);
        };

  const newBattleId = () => 'battle_' + Math.random().toString(36).slice(2, 10);
  const newPlayerId = () => 'player_' + Math.random().toString(36).slice(2, 10);

  const emptyBattle = (mode = '4v4') => ({
    id: newBattleId(),
    mode,
    status: 'waiting',
    createdAt: Date.now(),
    players: [],
    logs: [],
  });

  io.on('connection', (socket) => {
    console.log('[SOCKET] connected:', socket.id);
    socket.emit('hello', { ok: true, ts: Date.now() });

    // 방 참가
    socket.on('join', ({ battleId }) => {
      if (!battleId) return;
      socket.join(String(battleId));
      const snap = battles.get(battleId);
      if (snap) {
        socket.emit('battleUpdate', snap);
        socket.emit('battle:update', snap);
      }
    });

    // 선택적 관리자 인증 (검증 로직은 상위에서 처리)
    socket.on('adminAuth', ({ battleId, otp }, ack) => {
      if (!battleId || !String(otp || '').length) {
        if (typeof ack === 'function') ack({ error: 'invalid_otp' });
        return;
      }
      if (typeof ack === 'function') ack({ ok: true });
    });

    // 전투 생성
    const handleCreate = (payload, ack) => {
      const mode = String(payload?.mode || '4v4');
      const battle = emptyBattle(mode);
      battles.set(battle.id, battle);
      socket.join(String(battle.id));
      emitUpdate(battle);
      socket.emit('battle:created', battle);
      if (typeof ack === 'function') ack(battle);
    };
    socket.on('createBattle', handleCreate);
    socket.on('battle:create', handleCreate);
    socket.on('admin:createBattle', handleCreate);
    socket.on('create:battle', handleCreate);

    // 상태 전환
    const setStatus = (battleId, st) => {
      const b = battles.get(battleId);
      if (!b) return;
      b.status = st;
      emitUpdate(b);
    };
    socket.on('startBattle', ({ battleId }) => setStatus(battleId, 'active'));
    socket.on('battle:start', ({ battleId }) => setStatus(battleId, 'active'));
    socket.on('pauseBattle', ({ battleId }) => setStatus(battleId, 'paused'));
    socket.on('resumeBattle', ({ battleId }) => setStatus(battleId, 'active'));
    socket.on('endBattle', ({ battleId }) => setStatus(battleId, 'ended'));

    // 참가자 추가 (팀은 A/B만 허용)
    const handleAddPlayer = ({ battleId, player }, ack) => {
      const b = battles.get(battleId);
      if (!b) {
        if (typeof ack === 'function') ack({ error: 'not_found' });
        return;
      }
      if (!player?.name || !String(player.name).trim()) {
        if (typeof ack === 'function') ack({ error: 'name_required' });
        return;
      }
      const nameTrim = String(player.name).trim();
      const exists = b.players.some((p) => (p.name || '').trim().toLowerCase() === nameTrim.toLowerCase());
      if (exists) {
        if (typeof ack === 'function') ack({ error: 'name_duplicated' });
        return;
      }

      const teamRaw = String(player.team || 'A').toUpperCase();
      const team = teamRaw === 'B' ? 'B' : 'A';

      // 스탯 1~5 보정
      const clamp15 = (n, def = 3) => {
        const v = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : def;
        return Math.max(1, Math.min(5, v));
      };

      const hp = Number.isFinite(Number(player.hp)) ? Number(player.hp) : 100;
      const maxHp = Number.isFinite(Number(player.maxHp)) ? Number(player.maxHp) : 100;

      const p = {
        id: player.id ? String(player.id) : newPlayerId(),
        name: nameTrim,
        team, // 'A' | 'B'
        hp: Math.max(0, Math.min(maxHp, hp)),
        maxHp,
        stats: {
          attack: clamp15(player.stats?.attack, 3),
          defense: clamp15(player.stats?.defense, 3),
          agility: clamp15(player.stats?.agility, 3),
          luck: clamp15(player.stats?.luck, 2),
        },
        items: {
          dittany: Math.max(0, Math.min(5, Number(player.items?.dittany ?? 0))),
          attack_boost: Math.max(0, Math.min(5, Number(player.items?.attack_boost ?? 0))),
          defense_boost: Math.max(0, Math.min(5, Number(player.items?.defense_boost ?? 0))),
        },
        avatar: String(player.avatar || ''),
        ready: true,
        joinedAt: Date.now(),
      };

      b.players.push(p);
      emitUpdate(b);
      if (typeof ack === 'function') ack({ ok: true, battle: b, player: p });
    };
    socket.on('addPlayer', handleAddPlayer);
    socket.on('admin:addPlayer', handleAddPlayer);

    // 채팅
    const handleChat = ({ battleId, message, name, role }) => {
      if (!battleId || !message || !String(message).trim()) return;
      const chatData = {
        name: name || '플레이어',
        message: String(message).trim(),
        role: role || 'unknown',
        timestamp: Date.now(),
      };
      io.to(String(battleId)).emit('chatMessage', chatData);
      io.to(String(battleId)).emit('battle:chat', chatData);
    };
    socket.on('chatMessage', handleChat);
    socket.on('chat:send', handleChat);

    socket.on('disconnect', () => {
      console.log('[SOCKET] disconnected:', socket.id);
    });
  });
}

// 유연성을 위해 default export도 제공
export default { makeSocketHandlers };
