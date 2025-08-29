// src/socket/chat.js
// ─────────────────────────────────────────────────────────────────────────────
// Chat socket module for PYXIS Battle Server
// - 기대: 인증/조인 이후 socket.data = { battleId, role, pid, team, nickname } 세팅됨
// - 이벤트:
//    * 'chat:send'  { text }            → 전체/팀(/t 프리픽스)
//    * 'chat:cheer' { text, nickname? } → 관전자 응원(전체)
// - 보안/제한:
//    * 메시지 길이 제한, 공백/컨트롤문자 정리, 금칙어 마스킹(opt)
//    * 레이트리밋(버스트/지속), 동일 사용자 스팸쿨다운
// - 기록: engine.pushChat(battleId, entry)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  maxLen: 500,
  minLen: 1,
  // per-socket rate limits
  burst: { count: 5, intervalMs: 3_000 },      // 3초에 5개
  sustain: { count: 60, intervalMs: 300_000 }, // 5분에 60개
  cooldownMs: 800,                              // 연속 발화 쿨다운
  // very small naughty list (선택적으로 확장해서 사용)
  censor: true,
  bannedWords: ['fuck', 'shit', 'bitch', '개새', '씨발', '좆', '병신'],
};

function createRateLimiter() {
  const buckets = new Map(); // socket.id -> { hits:[], lastAt:number }
  return {
    canSend(socketId, opts = DEFAULTS) {
      const now = Date.now();
      let b = buckets.get(socketId);
      if (!b) { b = { hits: [], lastAt: 0 }; buckets.set(socketId, b); }

      // cooldown
      if (now - b.lastAt < opts.cooldownMs) return false;

      // clean expired
      const burstFrom = now - opts.burst.intervalMs;
      const sustainFrom = now - opts.sustain.intervalMs;
      b.hits = b.hits.filter(t => t >= sustainFrom);

      const burstCount = b.hits.filter(t => t >= burstFrom).length;
      const sustainCount = b.hits.length;

      if (burstCount >= opts.burst.count) return false;
      if (sustainCount >= opts.sustain.count) return false;

      b.hits.push(now);
      b.lastAt = now;
      return true;
    },
  };
}

function sanitize(text, { maxLen, minLen, censor, bannedWords }) {
  if (typeof text !== 'string') return { ok: false, text: '' };

  // normalize whitespace & strip control chars
  let t = text.replace(/[\u0000-\u001F\u007F]/g, ''); // control
  t = t.replace(/\s+/g, ' ').trim();

  if (t.length < minLen) return { ok: false, text: '' };
  if (t.length > maxLen) t = t.slice(0, maxLen);

  if (censor && bannedWords?.length) {
    const rx = new RegExp(`\\b(${bannedWords.map(escapeRegExp).join('|')})\\b`, 'gi');
    t = t.replace(rx, (m) => '*'.repeat(Math.min(m.length, 4)));
  }
  return { ok: true, text: t };
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function safeNick(nick, fallback = '관전자') {
  const t = String(nick || '').trim();
  if (!t) return fallback;
  return t.slice(0, 24);
}

function buildEntry({ scope, role, nickname, text, extra = {} }) {
  return Object.assign({
    type: scope === 'team' ? 'team' : (extra.kind === 'cheer' ? 'cheer' : 'chat'),
    scope, // 'all' | 'team'
    from: { role, nickname: safeNick(nickname, role === 'admin' ? '관리자' : (role === 'player' ? '플레이어' : '관전자')) },
    text,
  }, extra);
}

/**
 * 채팅 모듈 초기화
 * @param {import('socket.io').Server} io
 * @param {object} engine - BattleEngine 인스턴스(또는 pushChat 제공 객체)
 * @param {object} opts - 커스터마이징 옵션
 */
function initChat(io, engine, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const limiter = createRateLimiter();

  io.on('connection', (socket) => {
    // helper: 룸 브로드캐스트
    const broadcast = (battleId, scope, payload, team) => {
      if (scope === 'team' && team) {
        io.to(`${battleId}:${team}`).emit('chat:new', payload);
      } else {
        io.to(battleId).emit('chat:new', payload);
      }
    };

    // 채팅 전송
    socket.on('chat:send', (payload = {}, ack) => {
      try {
        const ctx = socket.data || {};
        const { battleId, role, team } = ctx;
        if (!battleId || !role) return ack?.({ ok: false, error: 'not_joined', message: '방에 조인되지 않았습니다.' });

        if (!limiter.canSend(socket.id, cfg)) {
          return ack?.({ ok: false, error: 'rate_limited', message: '채팅 전송 제한. 잠시 후 다시 시도하세요.' });
        }

        const raw = String(payload.text || '');
        const { ok, text } = sanitize(raw, cfg);
        if (!ok) return ack?.({ ok: false, error: 'bad_text', message: '메시지를 확인해주세요.' });

        // 팀 채팅 프리픽스 처리
        let scope = 'all';
        let finalText = text;
        if (/^\s*\/t\s+/i.test(finalText) && role === 'player') {
          scope = 'team';
          finalText = finalText.replace(/^\s*\/t\s+/i, '').trim();
          if (!finalText) return ack?.({ ok: false, error: 'empty', message: '메시지를 입력하세요.' });
        }

        const entry = buildEntry({
          scope,
          role,
          nickname: payload.nickname || ctx.nickname,
          text: finalText,
        });

        // 엔진 로그 적재(상태 최신화용)
        try {
          engine.pushChat(battleId, entry);
        } catch (e) {
          // 엔진 미연동/예외시에도 브로드캐스트는 수행
        }

        // 브로드캐스트
        broadcast(battleId, scope, entry, team);

        return ack?.({ ok: true });
      } catch (e) {
        return ack?.({ ok: false, error: 'exception', message: '채팅 처리 중 오류' });
      }
    });

    // 관전자 응원(항상 전체)
    socket.on('chat:cheer', (payload = {}, ack) => {
      try {
        const ctx = socket.data || {};
        const { battleId } = ctx;
        if (!battleId) return ack?.({ ok: false, error: 'not_joined', message: '방에 조인되지 않았습니다.' });

        if (!limiter.canSend(socket.id, cfg)) {
          return ack?.({ ok: false, error: 'rate_limited', message: '전송이 너무 잦습니다.' });
        }

        const raw = String(payload.text || '');
        const { ok, text } = sanitize(raw, cfg);
        if (!ok) return ack?.({ ok: false, error: 'bad_text', message: '메시지를 확인해주세요.' });

        const entry = buildEntry({
          scope: 'all',
          role: 'spectator',
          nickname: payload.nickname || ctx.nickname || '관전자',
          text,
          extra: { kind: 'cheer' },
        });

        try {
          engine.pushChat(battleId, entry);
        } catch (e) {}

        io.to(battleId).emit('chat:new', entry);
        return ack?.({ ok: true });
      } catch (e) {
        return ack?.({ ok: false, error: 'exception', message: '응원 처리 중 오류' });
      }
    });
  });
}

module.exports = {
  initChat,
};
