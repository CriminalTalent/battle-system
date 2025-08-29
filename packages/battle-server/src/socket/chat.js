// src/socket/chat.js
// Lightweight real-time chat for battle rooms
// - Room: battleId (global), battleId:team1 / battleId:team2 (team chat)
// - Roles: admin | player | spectator
// - Commands: "/t " -> team only (players만)
// - Basic rate-limit & sanitization

const RATE_LIMIT_WINDOW_MS = 3000; // per-socket minimal gap
const MAX_MESSAGE_LEN = 500;
const NICK_MAX = 24;

function now() { return Date.now(); }

function sanitize(text) {
  const s = String(text || '');
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, MAX_MESSAGE_LEN);
}

function safeNick(nick, role) {
  const base =
    (String(nick || '').trim() || (role === 'admin'
      ? '관리자'
      : role === 'player'
      ? '플레이어'
      : '관전자'));
  return base.slice(0, NICK_MAX);
}

function isTeamRoomAllowed(role) {
  return role === 'player';
}

/**
 * initChat(io, chatStore)
 * chatStore: { pushChat: (battleId, entry) => void }
 */
function initChat(io, chatStore) {
  const lastPostAt = new Map(); // socket.id -> ts

  io.on('connection', (socket) => {
    // 클라이언트가 배틀 룸에 조인할 때 서버 측에서도 메타 저장할 수 있도록 listener 제공
    // (서버 index.js에서 join 처리 시 socket.join(...) 후 meta를 socket.data에 넣어주면 됨)
    // 여기서는 chat 전용 이벤트만 다룬다.

    socket.on('chat:send', (payload = {}, ack) => {
      try {
        const {
          battleId,
          text,
          nickname,
          role,
          team,     // 'team1'|'team2' (선택: 서버에서 결정해 넣어줄 수 있음)
        } = payload;

        // 기본 검증
        if (!battleId) return ack?.({ ok: false, error: 'bad_request', msg: 'battleId 필요' });
        const roleSafe = (role === 'admin' || role === 'player' || role === 'spectator') ? role : 'spectator';
        const cleanText = sanitize(text);
        if (!cleanText) return ack?.({ ok: false, error: 'empty', msg: '메시지가 비어있습니다' });

        // 간단한 rate limit (socket 단위)
        const last = lastPostAt.get(socket.id) || 0;
        if (now() - last < RATE_LIMIT_WINDOW_MS) {
          return ack?.({ ok: false, error: 'rate_limited', msg: '너무 빠른 입력입니다' });
        }
        lastPostAt.set(socket.id, now());

        // 닉/범위 결정
        const nick = safeNick(nickname, roleSafe);

        const isTeamPrefix = /^\s*\/t\s+/i.test(cleanText);
        let scope = 'all';
        let finalText = cleanText;

        // 팀채팅: "/t " 프리픽스가 있고, 플레이어만 허용
        if (isTeamPrefix && isTeamRoomAllowed(roleSafe)) {
          scope = 'team';
          finalText = cleanText.replace(/^\s*\/t\s+/i, '');
        }

        // 메시지 엔트리
        const entry = {
          ts: now(),
          battleId,
          from: { nickname: nick, role: roleSafe, team: team || null },
          text: finalText,
          scope
        };

        // 로그 저장 (외부 주입)
        try {
          chatStore?.pushChat?.(battleId, entry);
        } catch (_) {}

        // 브로드캐스트
        if (scope === 'team' && team) {
          // 팀 룸으로만 전송
          io.to(`${battleId}:${team}`).emit('chat:new', entry);
        } else {
          // 전체 룸 전송
          io.to(battleId).emit('chat:new', entry);
        }

        return ack?.({ ok: true });
      } catch (e) {
        console.error('[chat:send] error', e);
        return ack?.({ ok: false, error: 'exception', msg: '채팅 처리 중 오류' });
      }
    });

    socket.on('chat:system', (payload = {}) => {
      // 서버/관리자에서 시스템 메시지를 넣고 싶을 때 사용할 수 있는 훅
      try {
        const { battleId, text } = payload;
        if (!battleId || !text) return;

        const entry = {
          ts: now(),
          battleId,
          from: { nickname: '시스템', role: 'admin' },
          text: String(text).slice(0, MAX_MESSAGE_LEN),
          scope: 'all',
          type: 'system'
        };
        try {
          chatStore?.pushChat?.(battleId, entry);
        } catch (_) {}
        io.to(battleId).emit('chat:new', entry);
      } catch (e) {
        console.error('[chat:system] error', e);
      }
    });
  });
}

module.exports = { initChat };
