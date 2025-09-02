/* packages/battle-server/public/js/core/socket-manager.js
 * ─────────────────────────────────────────────────────────────
 * PYXIS Socket Manager (브라우저 전용, UMD 스타일)
 * - /socket.io/socket.io.js 동적 로딩
 * - 안정적 재연결, 이벤트 큐잉, 상태 추적
 * - 역할별 인증(admin / player / spectator) 헬퍼
 * - 신/구 서버 이벤트명 호환 수신
 * - sendChat / sendAction / sendPlayerAction / sendAdminCommand / apiCall 포함
 * - 전역: window.PyxisSocket
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  // ───────────────────────────────────────────────────────────
  // 기본 옵션 / 유틸
  // ───────────────────────────────────────────────────────────
  const DEFAULTS = {
    url: null,                               // 기본: 현재 origin
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    timeout: 10000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    withCredentials: true,
  };

  const EVENT_ALIASES = Object.freeze({
    // 상태 스냅샷/업데이트
    state: ['state:update', 'state', 'battleUpdate', 'battle-state'],
    // 채팅
    chat: ['chat:new', 'chat', 'chat-message'],
    // 페이즈/턴/배틀
    phaseChange: ['phase:change'],
    turnUpdate: ['turn:update'],
    battleStatus: [
      'battle:status',
      'battle:created',
      'battle:started',
      'battle:paused',
      'battle:resumed',
      'battle:ended',
      'battle:end'
    ],
    // 타이머/공지/로그
    timerSync: ['timer:sync'],
    notice: ['notice:update', 'noticeUpdate'],
    logNew: ['log:new'],
    // 액션 결과(신/구)
    actionOk: ['action:success', 'actionSuccess'],
    actionErr: ['action:error', 'actionError'],
    // 관전자 응원 (양쪽 다 수신)
    cheer: ['spectator:cheer', 'spectator:cheer:sent'],
    // 에러/시스템
    error: ['error'],
    system: ['system:message'],
    // 인증(직접 수신)
    authOk: ['authSuccess'],
    authErr: ['authError'],
  });

  function once(fn, ctx) {
    let done = false;
    return function (...args) {
      if (done) return;
      done = true;
      return fn.apply(ctx || null, args);
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // 중복 로딩 방지
      const already = [...document.scripts].some(s => s.src.includes('/socket.io/socket.io.js'));
      if (already) return resolve();
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(el);
    });
  }

  function pick(list, handler) { list.forEach(evt => handler(evt)); }
  const now = () => Date.now();

  // ───────────────────────────────────────────────────────────
  // SocketManager
  // ───────────────────────────────────────────────────────────
  class SocketManager {
    constructor() {
      this.io = null;
      this.socket = null;
      this.opts = { ...DEFAULTS };
      this.connected = false;
      this.connecting = false;
      this.lastError = null;

      this._queue = [];                 // emit 큐
      this._listeners = new Map();      // {evt -> Set(handler)}
      this._notify = null;              // (title, body) => void
      this._roleCtx = null;             // { role, battleId, playerId?, spectatorName?, otp? }
      this._latency = null;

      this._onVisibilityChange = this._onVisibilityChange.bind(this);
    }

    // 선택적 알림 훅
    onNotify(fn) { this._notify = (typeof fn === 'function') ? fn : null; }

    // 초기화 + 연결
    async init(options = {}) {
      this.opts = Object.assign({}, DEFAULTS, options);
      if (!this.opts.url) this.opts.url = window.location.origin;

      // socket.io client 로드
      if (!('io' in global)) {
        await loadScript(this.opts.url.replace(/\/+$/, '') + '/socket.io/socket.io.js');
      }
      this.io = global.io;

      document.addEventListener('visibilitychange', this._onVisibilityChange);

      await this._connect();
      return this;
    }

    // ── 인증 헬퍼 ──
    async authAsAdmin({ battleId, otp }) {
      if (!battleId || !otp) throw new Error('battleId/otp required');
      this._roleCtx = { role: 'admin', battleId, otp };
      await this._ensureConnected();
      this.socket.emit('adminAuth', { battleId, otp });
    }

    async authAsPlayer({ battleId, playerId, otp }) {
      if (!battleId || !playerId || !otp) throw new Error('battleId/playerId/otp required');
      this._roleCtx = { role: 'player', battleId, playerId, otp };
      await this._ensureConnected();
      this.socket.emit('playerAuth', { battleId, playerId, otp });
    }

    async authAsSpectator({ battleId, otp, spectatorName }) {
      if (!battleId || !otp) throw new Error('battleId/otp required');
      this._roleCtx = { role: 'spectator', battleId, spectatorName: spectatorName || '관전자', otp };
      await this._ensureConnected();
      this.socket.emit('spectatorAuth', { battleId, otp, spectatorName: spectatorName || '관전자' });
    }

    // 구버전 대시보드용
    async joinBattle({ battleId, role }) {
      if (!battleId || !role) throw new Error('battleId/role required');
      this._roleCtx = { role, battleId };
      await this._ensureConnected();
      this.socket.emit('join-battle', { battleId, role });
    }

    // ── 채팅 ──
    async sendChat({ text, channel = 'all', teamKey = null, sender = null, battleId = null }) {
      if (!text) return;
      await this._ensureConnected();

      const useTeamPrefix = channel === 'team' && !/^\s*\/t\b/i.test(text);
      const message = useTeamPrefix ? `/t ${text}` : text;
      const finalBattleId = battleId || this._roleCtx?.battleId;
      if (!finalBattleId) return;

      // 우선 최신 이벤트
      this.socket.emit('chat:send', {
        battleId: finalBattleId,
        message,
        teamKey: teamKey || undefined,
        sender: sender || undefined,
      }, (ack) => {
        // 실패하면 중간/레거시 이벤트들도 시도
        if (!ack || ack.ok === false) {
          this.socket.emit('send-chat', {
            battleId: finalBattleId,
            message,
            teamKey: teamKey || undefined,
            sender: sender || undefined,
          });
        }
      });
    }

    // ── 액션 ──
    // 통합 액션 (player.js에서 사용)
    async sendAction(actionData, battleId = null, playerId = null) {
      await this._ensureConnected();
      const payload = Object.assign(
        {
          battleId: battleId || this._roleCtx?.battleId,
          playerId: playerId || this._roleCtx?.playerId,
        },
        actionData || {}
      );
      if (!payload.battleId || !payload.playerId) throw new Error('battleId/playerId required');

      return new Promise((resolve) => {
        this.socket.emit('player:action', payload, (res) => {
          if (res && res.ok) return resolve(res);
          // 레거시 이벤트 폴백
          this.socket.emit('playerAction', payload);
          resolve({ ok: true });
        });
      });
    }

    // 구 시그니처 유지 (admin.js 등에서 사용될 수 있음)
    async sendPlayerAction(action, targetId = null, battleId = null, playerId = null) {
      return this.sendAction({ type: action, action, targetPid: targetId, targetId }, battleId, playerId);
    }

    // ── 관리자 명령 ──
    async sendAdminCommand(command, data = {}) {
      await this._ensureConnected();
      const battleId = this._roleCtx?.battleId || data.battleId;
      if (!battleId) throw new Error('battleId required');

      return new Promise((resolve, reject) => {
        this.socket.emit(`admin:${command}`, { battleId, ...data }, (res) => {
          if (res && res.ok !== false) resolve(res || { ok: true });
          else reject(new Error(res?.message || 'Command failed'));
        });
      });
    }

    // ── REST 래퍼 ──
    async apiCall(endpoint, options = {}) {
      try {
        const res = await fetch(endpoint, {
          headers: { 'Content-Type': 'application/json' },
          ...options
        });
        const data = await res.json().catch(() => ({}));
        return data;
      } catch (err) {
        console.error('[SocketManager] API call failed:', err);
        return { ok: false, message: 'API 호출 실패' };
      }
    }

    // ── 범용 emit(연결 전 큐잉) ──
    emit(event, payload) {
      if (this.socket && this.connected) this.socket.emit(event, payload);
      else this._queue.push({ event, payload });
    }

    // ── 이벤트 구독/해제 ──
    on(evt, handler) {
      if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
      this._listeners.get(evt).add(handler);
      return () => this.off(evt, handler);
    }
    off(evt, handler) {
      const set = this._listeners.get(evt);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) this._listeners.delete(evt);
    }

    // ── 상태 조회 ──
    isConnected() { return this.connected; }
    isConnecting() { return this.connecting; }
    getLastError() { return this.lastError; }
    getLatencyMs() { return this._latency; }
    getRoleContext() { return Object.assign({}, this._roleCtx || {}); }

    // ── 정리 ──
    destroy() {
      try { document.removeEventListener('visibilitychange', this._onVisibilityChange); } catch (_) {}
      try {
        if (this.socket) {
          this.socket.removeAllListeners?.();
          this.socket.close();
          this.socket = null;
        }
      } catch (_) {}
      this._listeners.clear();
      this._queue.length = 0;
      this.connected = false;
      this.connecting = false;
      this.lastError = null;
    }

    // ───────────────────────────────────────────
    // 내부: 연결/재연결/바인딩
    // ───────────────────────────────────────────
    async _ensureConnected() {
      if (this.connected || this.connecting) return;
      await this._connect();
    }

    async _connect() {
      this.connecting = true;
      this.lastError = null;

      if (!this.io) throw new Error('socket.io client not loaded');

      // 기존 소켓 정리
      if (this.socket) {
        try { this.socket.removeAllListeners?.(); } catch (_) {}
        try { this.socket.close(); } catch (_) {}
      }

      // 새 소켓
      this.socket = this.io(this.opts.url, {
        path: this.opts.path,
        transports: this.opts.transports,
        timeout: this.opts.timeout,
        reconnection: this.opts.reconnection,
        reconnectionAttempts: this.opts.reconnectionAttempts,
        reconnectionDelay: this.opts.reconnectionDelay,
        reconnectionDelayMax: this.opts.reconnectionDelayMax,
        withCredentials: this.opts.withCredentials,
      });

      this._bindSocketCoreEvents();
      this._bindBroadcastEvents();

      // 연결 완료 대기(최대 opts.timeout)
      await new Promise((resolve) => {
        const done = once(resolve);
        this.socket.once('connect', done);
        setTimeout(done, Math.max(2000, this.opts.timeout));
      });
    }

    _bindSocketCoreEvents() {
      const s = this.socket;

      s.on('connect', () => {
        this.connected = true;
        this.connecting = false;
        this.lastError = null;

        // 큐 flush
        if (this._queue.length) {
          const copies = this._queue.splice(0, this._queue.length);
          copies.forEach(({ event, payload }) => s.emit(event, payload));
        }

        // 가벼운 핑(왕복 측정)
        const t0 = now();
        try {
          s.timeout(3000).emit('state:pull', null, () => {
            this._latency = now() - t0;
          });
        } catch (_) {}

        this._fire('socket:connect', { id: s.id });

        // 재연결 시 자동 재인증
        if (this._roleCtx) {
          const { role, battleId, playerId, spectatorName, otp } = this._roleCtx;
          if (role === 'admin' && battleId && otp) {
            s.emit('adminAuth', { battleId, otp });
          } else if (role === 'player' && battleId && playerId && otp) {
            s.emit('playerAuth', { battleId, playerId, otp });
          } else if (role === 'spectator' && battleId && otp) {
            s.emit('spectatorAuth', { battleId, otp, spectatorName: spectatorName || '관전자' });
          } else if (role && battleId) {
            s.emit('join-battle', { battleId, role });
          }
        }
      });

      s.on('connect_error', (err) => {
        this.connected = false;
        this.connecting = false;
        this.lastError = err;
        this._fire('socket:error', { type: 'connect_error', message: err?.message || String(err || '') });
      });

      s.on('disconnect', (reason) => {
        this.connected = false;
        this.connecting = false;
        this._fire('socket:disconnect', { reason });
      });

      // 인증 결과 표준화
      pick(EVENT_ALIASES.authOk, (evt) => {
        s.on(evt, (payload) => {
          this._fire('auth:ok', payload);
          if (this._notify) this._notify('연결 완료', '서버 인증이 성공했습니다.');
        });
      });
      pick(EVENT_ALIASES.authErr, (evt) => {
        s.on(evt, (message) => this._fire('auth:error', { message }));
      });
    }

    _bindBroadcastEvents() {
      const s = this.socket;

      // 상태
      pick(EVENT_ALIASES.state, (evt) => {
        s.on(evt, (state) => this._fire('state', state));
      });

      // 채팅 (레거시 페이로드 보정)
      pick(EVENT_ALIASES.chat, (evt) => {
        s.on(evt, (msg) => {
          let payload = msg;
          if (msg && msg.message && !msg.text) {
            payload = {
              text: msg.message,
              scope: msg.teamOnly ? 'team' : (msg.channel || 'all'),
              from: { nickname: msg.name || msg.sender || '익명' },
              ts: msg.timestamp || Date.now()
            };
          }
          this._fire('chat', payload);
        });
      });

      // 페이즈/턴/배틀
      pick(EVENT_ALIASES.phaseChange, (evt) => {
        s.on(evt, (data) => {
          this._fire('phase', data);
          if (this._notify && data?.phase) {
            const phaseName = data.phase === 'team1' || data.phase === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
            this._notify('턴 페이즈 변경', `${phaseName}의 차례입니다.`);
          }
        });
      });

      pick(EVENT_ALIASES.turnUpdate, (evt) => {
        s.on(evt, (data) => this._fire('turn', data));
      });

      pick(EVENT_ALIASES.battleStatus, (evt) => {
        s.on(evt, (data) => {
          this._fire('battle', { event: evt, data });
          if (this._notify) {
            if (evt === 'battle:started') this._notify('전투 시작', '전투가 시작되었습니다.');
            if (evt === 'battle:ended' || evt === 'battle:end') this._notify('전투 종료', '전투가 종료되었습니다.');
          }
        });
      });

      // 타이머/공지/로그
      pick(EVENT_ALIASES.timerSync, (evt) => {
        s.on(evt, (data) => this._fire('timer', data));
      });

      pick(EVENT_ALIASES.notice, (evt) => {
        s.on(evt, (data) => this._fire('notice', data));
      });

      pick(EVENT_ALIASES.logNew, (evt) => {
        s.on(evt, (line) => this._fire('log', line));
      });

      // 액션 결과
      pick(EVENT_ALIASES.actionOk, (evt) => {
        s.on(evt, (res) => this._fire('action:ok', res));
      });
      pick(EVENT_ALIASES.actionErr, (evt) => {
        s.on(evt, (err) => this._fire('action:error', err));
      });

      // 관전자 응원
      pick(EVENT_ALIASES.cheer, (evt) => {
        s.on(evt, (data) => this._fire('cheer', data));
      });

      // 에러/시스템
      pick(EVENT_ALIASES.error, (evt) => {
        s.on(evt, (e) => this._fire('error', e));
      });
      pick(EVENT_ALIASES.system, (evt) => {
        s.on(evt, (e) => this._fire('system', e));
      });
    }

    _fire(evt, payload) {
      const set = this._listeners.get(evt);
      if (!set || set.size === 0) return;
      set.forEach(fn => { try { fn(payload); } catch (_) {} });
    }

    _onVisibilityChange() {
      if (document.visibilityState === 'visible' && !this.connected && !this.connecting) {
        this._connect().catch(() => {});
      }
    }
  }

  // ── 싱글톤/전역 노출 ──
  const instance = new SocketManager();
  global.PyxisSocket = instance;

  // CommonJS/AMD 호환(선택)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
})(window);