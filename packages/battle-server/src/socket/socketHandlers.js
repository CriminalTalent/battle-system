// packages/battle-server/src/socket/socketHandlers.js
import { makeBattleHandlers } from '../engine/battle-handlers.js';

export function makeSocketHandlers(io, { battles }) {
  const h = makeBattleHandlers({ battles, io });

  io.on('connection', (socket) => {
    let currentBattle = null;
    let currentPlayerId = null;
    let displayName = '익명';

    function roomEmit(ev, data) {
      if (!currentBattle) return;
      io.to(currentBattle).emit(ev, data);
    }

    socket.on('join', ({ battleId }) => {
      if (!battleId) return;
      currentBattle = String(battleId);
      socket.join(currentBattle);
      const snap = battles.snapshot(currentBattle);
      if (snap) {
        socket.emit('battleUpdate', snap);
        socket.emit('battle:update', snap);
        roomEmit('battleLog', { ts: Date.now(), type:'info', message:`관람 입장` });
        roomEmit('battle:log', { ts: Date.now(), type:'info', message:`관람 입장` });
      }
    });

    // 인증: token/otp/name(폴백) 허용
    socket.on('playerAuth', ({ battleId, token, password, otp, playerName }) => {
      const bid = String(battleId || currentBattle || '');
      if (!bid) return socket.emit('authError', { error: 'no battle' });

      const snap = battles.get(bid);
      if (!snap) return socket.emit('authError', { error: 'not found' });

      // Player token
      let p = null;
      if (token) p = battles.authByToken(bid, token);

      // 이름 매칭(폴백) — 관리자가 링크 없이 입장 시 사용
      if (!p && playerName) {
        p = snap.players.find(x => x.name === playerName) || null;
      }

      if (!p) return socket.emit('authError', { error: 'auth failed' });

      currentBattle = bid;
      currentPlayerId = p.id;
      displayName = p.name;

      socket.join(currentBattle);
      socket.emit('authSuccess', { ok: true, playerId: p.id, name: p.name, team: p.team });
      socket.emit('auth:success', { ok: true, playerId: p.id, name: p.name, team: p.team }); // 호환
      h.sendChat(currentBattle, { name: '시스템', message: `${p.name} 입장` });
    });

    // 준비 완료
    socket.on('player:ready', () => {
      if (!currentBattle || !currentPlayerId) return;
      h.markReady(currentBattle, currentPlayerId);
    });

    // 행동
    socket.on('player:action', (payload) => {
      if (!currentBattle || !currentPlayerId) return;
      try {
        h.playerAction(currentBattle, currentPlayerId, payload || {});
      } catch (e) {
        socket.emit('actionError', { error: String(e?.message || e) });
      }
    });

    // 전투 제어
    socket.on('createBattle', ({ mode }, cb = ()=>{}) => {
      try {
        const id = h.createBattle(mode || '1v1');
        cb({ ok: true, battleId: id, battle: battles.snapshot(id) });
      } catch (e) { cb({ ok:false, error:String(e?.message||e) }); }
    });
    socket.on('startBattle', ({ battleId }, cb = ()=>{}) => {
      try { h.startBattle(battleId || currentBattle); cb({ ok:true }); } catch(e){ cb({ ok:false, error:String(e?.message||e) }); }
    });
    socket.on('pauseBattle', (_p, cb = ()=>{}) => { cb({ ok:true }); }); // TODO: 구현시 상태만 바꾸고 브로드캐스트
    socket.on('resumeBattle', (_p, cb = ()=>{}) => { cb({ ok:true }); });
    socket.on('endBattle', ({ battleId }, cb = ()=>{}) => {
      try { battles.end(battleId || currentBattle); cb({ ok:true }); } catch(e){ cb({ ok:false, error:String(e?.message||e) }); }
    });

    // 채팅: 서버는 한 이벤트(chatMessage)만 받아서 양쪽으로 브로드캐스트
    socket.on('chatMessage', (payload) => {
      if (!currentBattle) return;
      const data = {
        name: payload?.name || displayName || '익명',
        message: String(payload?.message || '').slice(0, 500),
      };
      h.sendChat(currentBattle, data);
    });
    // 구호환 입력 이벤트를 받더라도 자체 재전송하지 않음(루프 방지)

    // 응원: 채팅에만 표기, 로그 X
    socket.on('spectator:cheer', ({ message, name }) => {
      if (!currentBattle) return;
      const m = String(message || '').trim();
      if (!m) return;
      h.sendCheerToChat(currentBattle, name || displayName, m);
    });
    // 구 이벤트를 받으면 신 이벤트로 변환만
    socket.on('cheerMessage', ({ message, name }) => {
      socket.emit('spectator:cheer', { message, name });
    });

    socket.on('disconnect', () => {
      // no-op
    });
  });
}
