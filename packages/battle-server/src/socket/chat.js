// packages/battle-server/src/socket/chat.js
// 단순/안전 채팅 소켓 초기화 유틸
function initChat(io, adapter) {
  const pushChat = (battleId, entry) => {
    try {
      if (adapter && typeof adapter.pushChat === 'function') {
        adapter.pushChat(battleId, entry);
      }
    } catch (e) {
      // 로깅 실패는 전파하지 않음
    }
  };

  io.on('connection', (socket) => {
    socket.on('chat:send', (payload, cb) => {
      try {
        const { battleId, text, nickname, role, scope } = payload || {};
        if (!battleId || !text) {
          cb?.({ ok: false, error: 'bad_request', msg: 'battleId/text 필요' });
          return;
        }

        const entry = {
          ts: Date.now(),
          type: 'chat',
          scope: scope === 'team' ? 'team' : 'all',
          from: {
            nickname: (nickname || '').toString().slice(0, 24) || (role === 'admin' ? '관리자' : role === 'player' ? '플레이어' : '관전자'),
            role: role || 'spectator'
          },
          text: String(text).slice(0, 500)
        };

        pushChat(battleId, entry);
        io.to(battleId).emit('chat:new', entry);
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: 'exception', msg: '채팅 처리 중 오류' });
      }
    });
  });
}

module.exports = { initChat };
