/* packages/battle-server/public/js/core/socket-manager.js
 * ─────────────────────────────────────────────────────────────
 * PYXIS Socket Manager (브라우저 전용, UMD 스타일)
 * - 동적 로더로 /socket.io/socket.io.js 주입
 * - 안정적 재연결(backoff), 이벤트 큐잉, 상태 추적
 * - 역할별 인증(admin / player / spectator) 헬퍼
 * - 서버 브로드캐스트 이벤트 다중 호환명 수신
 * - 선택적 브라우저 알림 훅(onNotify) 제공(디자인 미변경)
 * - 전역 네임스페이스: window.PyxisSocket
 * ─────────────────────────────────────────────────────────────
 */

(function (global) {
  'use strict';

  // ───────────────────────────────────────────────────────────
  // 유틸
  // ───────────────────────────────────────────────────────────
  const DEFAULTS = {
    url: null,                               // 기본: 현재 origin
    path: '/socket.io/',                     // 서버 소켓 경로
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
    battleStatus: ['battle:status', 'battle:created', 'battle:started', 'battle:paused', 'battle:resumed', 'battle:ended', 'battle:end'],
    // 타이머/공지/로그
    timerSync: ['timer:sync'],
    notice: ['notice:update', 'noticeUpdate'],
    logNew: ['log:new'],
    // 액션 결과(신/구)
    actionOk: ['action:success', 'actionSuccess'],
    actionErr: ['action:error', 'actionError'],
    // 관전자 응원
    cheer: ['spectator:cheer'],
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
      // 이미 로드된 경우 중복 방지
      if ([...document.scripts].some(s => s.src.endsWith('/socket.io/socket.io.js'))) {
        return resolve();
      }
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(el);
    });
  }

  function pick(list, handler) {
    list.forEach(evt => handler(evt));
  }

  function now() { return Date.now(); }

  // ───────────────────────────────────────────────────────────
  // SocketManager
  // ───────────────────────────────────────────────────────────
  class SocketManager {
    constructor() {
      this.io = null;          // window.io (socket.io client factory)
      this.socket = null;      // active socket instance
      this.opts = { ...DEFAULTS };
      this.connected = false;
      this.connecting = false;
      this.lastError = null;
      this._queue = [];        // emit 큐 (연결 전 송신 보관)
      this._listeners = new Map(); // {evt -> Set(handler)}
      this._notify = null;     // 알림 훅 (title, body) => void
      this._roleCtx = null;    // { role, battleId, playerId?, spectatorName?, otp? }
      this._latency = null;    // ping round-trip(ms)
      this._onVisibilityChange = this._onVisibilityChange.bind(this);
    }

    // 알림 훅 등록(선택)
    onNotify(fn) {
      this._notify = typeof fn === 'function' ? fn : null;
    }

    // 초기화 및 연결 시작
    async init(options = {}) {
      // 옵션 병합
      this.opts = Object.assign({}, DEFAULTS, options);
      if (!this.opts.url) {
        this.opts.url = window.location.origin;
      }

      // socket.io client 로더
      if (!('io' in global)) {
        await loadScript((this.opts.url.replace(/\/+$/, '')) + '/socket.io/socket.io.js');
      }
      this.io = global.io;

      // 가시성 이벤트로 재연결 트리거
      document.addEventListener('visibilitychange', this._onVisibilityChange);

      // 최초 연결
      await this._connect();
      return this;
    }

    // 역할별 인증 헬퍼 (admin/player/spectator)
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

    // 간단 조인(디버그 대시보드용)
    async joinBattle({ battleId, role }) {
      if (!battleId || !role) throw new Error('battleId/role required');
      this._roleCtx = { role, battleId };
      await this._ensureConnected();
      this.socket.emit('join-battle', { battleId, role });
    }

    // 채팅 송신(자동 채널 prefix 처리: /t 팀채팅)
    async sendChat({ text, channel = 'all', teamKey = null, sender = null, battleId = null }) {
      if (!text) return;
      await this._ensureConnected();
      const useTeamPrefix = channel === 'team' && !/^\s*\/t\b/i.test(text);
      const message = useTeamPrefix ? `/t ${text}` : text;

      const finalBattleId = battleId || this._roleCtx?.battleId;
      if (!finalBattleId) return;

      // 서버가 신/구 이벤트를 모두 수신하도록 대표 이벤트 하나만 보낸다(서버가 양방향 변환)
      this.socket.emit('send-chat', {
        battleId: finalBattleId,
        message,
        teamKey: teamKey || undefined,
        sender: sender || undefined,
      });
    }

    // 임의 emit(연결 전이면 큐잉)
    emit(event, payload) {
      if (this.socket && this.connected) {
        this.socket.emit(event, payload);
      } else {
        this._queue.push({ event, payload });
      }
    }

    // 이벤트 구독
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

    // 현재 상태 리드
    isConnected() { return this.connected; }
    isConnecting() { return this.connecting; }
    getLastError() { return this.lastError; }
    getLatencyMs() { return this._latency; }
    getRoleContext() { return Object.assign({}, this._roleCtx || {}); }

    // 정리(페이지 언마운트 시)
    destroy() {
      try { document.removeEventListener('visibilitychange', this._onVisibilityChange); } catch (_) {}
      try { if (this.socket) { this.socket.close(); this.socket = null; } } catch (_) {}
      this._listeners.clear();
      this._queue.length = 0;
      this.connected = false;
      this.connecting = false;
      this.lastError = null;
    }

    // ───────────────────────────────────────────
    // 내부: 연결/재연결/리스너 바인딩
    // ───────────────────────────────────────────
    async _ensureConnected() {
      if (this.connected) return;
      if (this.connecting) return;
      await this._connect();
    }

    async _connect() {
      this.connecting = true;
      this.lastError = null;

      if (!this.io) throw new Error('socket.io client not loaded');

      // 기존 소켓 정리
      if (this.socket) {
        try { this.socket.removeAllListeners(); } catch (_) {}
        try { this.socket.close(); } catch (_) {}
      }

      // 소켓 생성
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

      // 기본 리스너
      this._bindSocketCoreEvents();
      this._bindBroadcastEvents();

      // 연결 완료 대기
      await new Promise((resolve) => {
        const done = once(resolve);
        this.socket.once('connect', done);
        // 너무 오래 걸리면 resolve (재시도는 소켓이 수행)
        setTimeout(done, Math.max(2000, this.opts.timeout));
      });
    }

    _bindSocketCoreEvents() {
      const s = this.socket;

      s.on('connect', () => {
        this.connected = true;
        this.connecting = false;
        this.lastError = null;

        // 대기 큐 flush
        if (this._queue.length) {
          const copies = this._queue.splice(0, this._queue.length);
          copies.forEach(({ event, payload }) => s.emit(event, payload));
        }

        // 가벼운 ping(왕복측정)
        const t0 = now();
        try {
          s.timeout(3000).emit('state:pull', null, () => {
            this._latency = now() - t0;
          });
        } catch (_) {}

        this._fire('socket:connect', { id: s.id });

        // 재연결 시 역할 컨텍스트 자동 인증
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

      // 인증 결과 표준화 이벤트
      pick(EVENT_ALIASES.authOk, (evt) => {
        s.on(evt, (payload) => {
          this._fire('auth:ok', payload);
          // 알림 훅(선택)
          if (this._notify) {
            this._notify('연결 완료', '서버 인증이 성공했습니다.');
          }
        });
      });

      pick(EVENT_ALIASES.authErr, (evt) => {
        s.on(evt, (message) => {
          this._fire('auth:error', { message });
        });
      });
    }

    _bindBroadcastEvents() {
      const s = this.socket;

      // 상태 스냅샷·업데이트
      pick(EVENT_ALIASES.state, (evt) => {
        s.on(evt, (state) => {
          this._fire('state', state);
        });
      });

      // 채팅
      pick(EVENT_ALIASES.chat, (evt) => {
        s.on(evt, (msg) => {
          // 레거시 'chat-message' 형식 보정
          const payload = msg && msg.message && !msg.text
            ? { name: msg.name, message: msg.message, teamOnly: msg.teamOnly, teamKey: msg.teamKey, timestamp: msg.timestamp }
            : msg;
          this._fire('chat', payload);
        });
      });

      // 페이즈/턴/배틀 상태
      pick(EVENT_ALIASES.phaseChange, (evt) => {
        s.on(evt, (data) => {
          this._fire('phase', data);
          if (this._notify && data?.phase) {
            const phaseName = data.phase === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
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
      // 핸들러 실행
      set.forEach(fn => {
        try { fn(payload); } catch (_) {}
      });
    }

    _onVisibilityChange() {
      if (document.visibilityState === 'visible' && !this.connected && !this.connecting) {
        // 포그라운드 복귀 시 재연결 시도
        this._connect().catch(() => {});
      }
    }
  }

  // 싱글톤 노출
  const instance = new SocketManager();

  // 브라우저 전역에 공개
  global.PyxisSocket = instance;

  // CommonJS/AMD 호환(선택)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
})(window);

