/* packages/battle-server/public/js/core/socket-manager.js
 * ─────────────────────────────────────────────────────────────
 * PYXIS Socket Manager - Enhanced Design Version
 * - /socket.io/socket.io.js 동적 로딩
 * - 안정적 재연결, 이벤트 큐잉, 상태 추적
 * - 역할별 인증(admin / player / spectator) 헬퍼
 * - 신/구 서버 이벤트명 호환 수신
 * - sendChat / sendAction / sendPlayerAction / sendAdminCommand / apiCall 포함
 * - 게임적 효과 및 향상된 UX 연동
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
    gameEffects: true,                       // 게임 효과 활성화
    notifications: true,                     // 알림 활성화
    autoReconnect: true,                     // 자동 재연결
    heartbeatInterval: 30000,                // 하트비트 간격 (30초)
  };

  const EVENT_ALIASES = Object.freeze({
    // 상태 스냅샷/업데이트
    state: ['state:snapshot', 'state:update', 'state', 'battleUpdate', 'battle-state'],
    // 채팅
    chat: ['chat:new', 'chat', 'chat-message'],
    // 페이즈/턴/배틀
    phaseChange: ['phase:change'],
    turnUpdate: ['turn:update', 'turn:begin', 'turn:end', 'battle:turn:begin', 'battle:turn:end'],
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
    actionOk: ['action:success', 'actionSuccess', 'action:result'],
    actionErr: ['action:error', 'actionError'],
    // 관전자 응원 (양쪽 다 수신)
    cheer: ['spectator:cheer', 'spectator:cheer:sent'],
    // 에러/시스템
    error: ['error'],
    system: ['system:message'],
    // 인증(직접 수신)
    authOk: ['authSuccess', 'auth:ok'],
    authErr: ['authError', 'auth:error'],
    // 게임 이벤트 추가
    playerJoin: ['player:join', 'playerJoined'],
    playerLeave: ['player:leave', 'playerLeft'],
    playerDeath: ['player:death', 'playerDied'],
  });

  // 연결 상태 타입
  const CONNECTION_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
  };

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

  // 로그 헬퍼
  function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[PyxisSocket][${timestamp}]`;
    if (level === 'error') console.error(prefix, message, data || '');
    else if (level === 'warn') console.warn(prefix, message, data || '');
    else if (level === 'debug' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) console.log(prefix, message, data || '');
    else if (level === 'info') console.info(prefix, message, data || '');
  }

  // ───────────────────────────────────────────────────────────
  // Enhanced SocketManager
  // ───────────────────────────────────────────────────────────
  class SocketManager {
    constructor() {
      this.io = null;
      this.socket = null;
      this.opts = { ...DEFAULTS };
      this.connectionState = CONNECTION_STATES.DISCONNECTED;
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 10;

      this._queue = [];                 // emit 큐
      this._listeners = new Map();      // {evt -> Set(handler)}
      this._notify = null;              // (title, body, options) => void
      this._roleCtx = null;             // { role, battleId, playerId?, spectatorName?, otp? }
      this._latency = null;
      this._heartbeatTimer = null;
      this._connectionStartTime = null;
      this._lastHeartbeat = null;
      this._stats = {
        totalConnections: 0,
        totalDisconnections: 0,
        totalReconnections: 0,
        totalMessages: 0,
        totalErrors: 0
      };

      // 게임 효과 관련
      this._gameEffects = true;
      this._connectionIndicators = new Set();
      this._isPageVisible = !document.hidden;

      this._onVisibilityChange = this._onVisibilityChange.bind(this);
      this._setupConnectionVisuals();
    }

    // ───────────────────────────────────────────────────────────
    // 게임적 시각 효과 설정
    // ───────────────────────────────────────────────────────────
    _setupConnectionVisuals() {
      if (!document.querySelector('#pyxis-socket-styles')) {
        const style = document.createElement('style');
        style.id = 'pyxis-socket-styles';
        style.textContent = `
          .pyxis-connection-pulse { animation: pyxisConnectionPulse 2s infinite; }
          @keyframes pyxisConnectionPulse { 0%,100% { opacity:1; transform:scale(1);} 50% { opacity:.7; transform:scale(1.1);} }
          .pyxis-connection-lost { animation: pyxisConnectionLost 1s infinite; }
          @keyframes pyxisConnectionLost { 0%,100% { opacity:1; } 50% { opacity:.3; } }
          .pyxis-connection-good { box-shadow: 0 0 10px rgba(34,197,94,.5); }
          .pyxis-connection-poor { box-shadow: 0 0 10px rgba(245,158,11,.5); }
          .pyxis-connection-bad  { box-shadow: 0 0 10px rgba(239,68,68,.5); }

          .pyxis-socket-overlay {
            position: fixed; inset: 0;
            background: rgba(0, 8, 13, 0.9);
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            z-index: 99999; color: #E2E8F0; font-family: 'Inter', sans-serif;
          }
          .pyxis-socket-spinner {
            width: 50px; height: 50px; border: 3px solid rgba(220,199,162,.3); border-top: 3px solid #DCC7A2;
            border-radius: 50%; animation: pyxisSpinner 1s linear infinite; margin-bottom: 20px;
          }
          @keyframes pyxisSpinner { 0% { transform: rotate(0deg);} 100% { transform: rotate(360deg);} }
          .pyxis-socket-message { font-size: 18px; font-weight: 600; color: #DCC7A2; text-align: center; margin-bottom: 10px; }
          .pyxis-socket-status  { font-size: 14px; color: #94A3B8; text-align: center; }
        `;
        document.head.appendChild(style);
      }
    }

    _showConnectionOverlay(message, status = '') {
      if (!this._gameEffects) return;
      this._hideConnectionOverlay();
      const overlay = document.createElement('div');
      overlay.id = 'pyxis-socket-overlay';
      overlay.className = 'pyxis-socket-overlay';
      overlay.innerHTML = `
        <div class="pyxis-socket-spinner"></div>
        <div class="pyxis-socket-message">${message}</div>
        <div class="pyxis-socket-status">${status}</div>
      `;
      document.body.appendChild(overlay);
    }

    _hideConnectionOverlay() {
      const overlay = document.getElementById('pyxis-socket-overlay');
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.parentNode && overlay.parentNode.removeChild(overlay), 250);
      }
    }

    _updateConnectionIndicators() {
      this._connectionIndicators.forEach(indicator => {
        if (!indicator || !indicator.parentNode) return;
        indicator.classList.remove(
          'pyxis-connection-pulse','pyxis-connection-lost','pyxis-connection-good','pyxis-connection-poor','pyxis-connection-bad'
        );
        switch (this.connectionState) {
          case CONNECTION_STATES.CONNECTED:
            indicator.classList.add('pyxis-connection-good');
            if (this._latency > 1000) indicator.classList.add('pyxis-connection-poor');
            break;
          case CONNECTION_STATES.CONNECTING:
          case CONNECTION_STATES.RECONNECTING:
            indicator.classList.add('pyxis-connection-pulse');
            break;
          case CONNECTION_STATES.DISCONNECTED:
          case CONNECTION_STATES.ERROR:
            indicator.classList.add('pyxis-connection-lost', 'pyxis-connection-bad');
            break;
        }
      });
    }

    registerConnectionIndicator(element) {
      if (element && element.nodeType === 1) {
        this._connectionIndicators.add(element);
        this._updateConnectionIndicators();
      }
    }

    unregisterConnectionIndicator(element) {
      this._connectionIndicators.delete(element);
    }

    // ───────────────────────────────────────────────────────────
    // 알림 및 효과 설정
    // ───────────────────────────────────────────────────────────
    onNotify(fn) {
      this._notify = (typeof fn === 'function') ? fn : null;
      log('debug', 'Notification handler registered');
    }

    setGameEffects(enabled) {
      this._gameEffects = !!enabled;
      log('info', `Game effects ${enabled ? 'enabled' : 'disabled'}`);
    }

    // ───────────────────────────────────────────────────────────
    // 하트비트 시스템
    // ───────────────────────────────────────────────────────────
    _startHeartbeat() {
      this._stopHeartbeat();
      if (!this.opts.heartbeatInterval || this.opts.heartbeatInterval <= 0) return;
      this._heartbeatTimer = setInterval(() => {
        if (this.socket && this.connectionState === CONNECTION_STATES.CONNECTED) {
          const startTime = now();
          this.socket.timeout(5000).emit('ping', { ts: startTime }, () => {
            const latency = now() - startTime;
            this._latency = latency;
            this._lastHeartbeat = now();
            log('debug', `Heartbeat: ${latency}ms`);
            this._updateConnectionIndicators();
            if (latency > 3000 && this._notify) {
              this._notify('연결 지연', '네트워크 연결이 느립니다', { type: 'warning' });
            }
          });
        }
      }, this.opts.heartbeatInterval);
    }

    _stopHeartbeat() {
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    }

    // ───────────────────────────────────────────────────────────
    // 초기화 + 연결
    // ───────────────────────────────────────────────────────────
    async init(options = {}) {
      this.opts = Object.assign({}, DEFAULTS, options);
      if (!this.opts.url) this.opts.url = window.location.origin;

      log('info', 'Initializing PyxisSocket', this.opts);

      // socket.io client 로드
      if (!('io' in global)) {
        if (this._gameEffects) this._showConnectionOverlay('Socket.IO 로딩 중...', '클라이언트 라이브러리를 불러오고 있습니다');
        try {
          await loadScript(this.opts.url.replace(/\/+$/, '') + '/socket.io/socket.io.js');
          log('info', 'Socket.IO client loaded successfully');
        } catch (error) {
          log('error', 'Failed to load Socket.IO client', error);
          this._notify?.('연결 실패', 'Socket.IO 클라이언트를 로드할 수 없습니다', { type: 'error' });
          throw error;
        }
      }
      this.io = global.io;

      document.addEventListener('visibilitychange', this._onVisibilityChange);
      await this._connect();
      return this;
    }

    // ───────────────────────────────────────────────────────────
    // 인증 헬퍼
    // ───────────────────────────────────────────────────────────
    async authAsAdmin({ battleId, otp }) {
      if (!battleId || !otp) throw new Error('battleId/otp required');
      log('info', 'Authenticating as admin', { battleId });
      this._roleCtx = { role: 'admin', battleId, otp };
      await this._ensureConnected();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Authentication timeout')), 10000);
        const cleanup = () => { clearTimeout(timeout); this.off('auth:ok', onSuccess); this.off('auth:error', onError); };
        const onSuccess = (data) => { cleanup(); log('info', 'Admin authentication successful'); resolve(data); };
        const onError = (error) => { cleanup(); log('error', 'Admin authentication failed', error); reject(new Error(error.message || 'Authentication failed')); };
        this.on('auth:ok', onSuccess); this.on('auth:error', onError);
        this.socket.emit('adminAuth', { battleId, otp });
      });
    }

    async authAsPlayer({ battleId, playerId, otp, name }) {
      if (!battleId || !playerId || !otp) throw new Error('battleId/playerId/otp required');
      log('info', 'Authenticating as player', { battleId, playerId, name });
      this._roleCtx = { role: 'player', battleId, playerId, otp, name };
      await this._ensureConnected();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Authentication timeout')), 10000);
        const cleanup = () => { clearTimeout(timeout); this.off('auth:ok', onSuccess); this.off('auth:error', onError); };
        const onSuccess = (data) => { cleanup(); log('info', 'Player authentication successful'); this._notify?.('입장 완료!', `${name || playerId}님, 전투에 참가하셨습니다`, { type: 'success' }); resolve(data); };
        const onError = (error) => { cleanup(); log('error', 'Player authentication failed', error); this._notify?.('입장 실패', error.message || '인증에 실패했습니다', { type: 'error' }); reject(new Error(error.message || 'Authentication failed')); };
        this.on('auth:ok', onSuccess); this.on('auth:error', onError);
        this.socket.emit('playerAuth', { battleId, playerId, otp, name });
      });
    }

    async authAsSpectator({ battleId, otp, spectatorName }) {
      if (!battleId || !otp) throw new Error('battleId/otp required');
      const name = spectatorName || '관전자';
      log('info', 'Authenticating as spectator', { battleId, name });
      this._roleCtx = { role: 'spectator', battleId, spectatorName: name, otp };
      await this._ensureConnected();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Authentication timeout')), 10000);
        const cleanup = () => { clearTimeout(timeout); this.off('auth:ok', onSuccess); this.off('auth:error', onError); };
        const onSuccess = (data) => { cleanup(); log('info', 'Spectator authentication successful'); this._notify?.('관전 시작!', `${name}님, 관전을 시작합니다`, { type: 'success' }); resolve(data); };
        const onError = (error) => { cleanup(); log('error', 'Spectator authentication failed', error); this._notify?.('관전 실패', error.message || '인증에 실패했습니다', { type: 'error' }); reject(new Error(error.message || 'Authentication failed')); };
        this.on('auth:ok', onSuccess); this.on('auth:error', onError);
        this.socket.emit('spectatorAuth', { battleId, otp, spectatorName: name });
      });
    }

    // 구버전 대시보드용
    async joinBattle({ battleId, role }) {
      if (!battleId || !role) throw new Error('battleId/role required');
      log('info', 'Joining battle (legacy)', { battleId, role });
      this._roleCtx = { role, battleId };
      await this._ensureConnected();
      this.socket.emit('join-battle', { battleId, role });
    }

    // ───────────────────────────────────────────────────────────
    // 채팅
    // ───────────────────────────────────────────────────────────
    async sendChat({ text, channel = 'all', teamKey = null, sender = null, battleId = null }) {
      if (!text) return;
      this._stats.totalMessages++;
      await this._ensureConnected();

      const useTeamPrefix = channel === 'team' && !/^\s*\/t\b/i.test(text);
      const message = useTeamPrefix ? `/t ${text}` : text;
      const finalBattleId = battleId || this._roleCtx?.battleId;
      if (!finalBattleId) { log('warn', 'No battleId for chat message'); return; }

      log('debug', 'Sending chat message', { channel, text: text.substring(0, 50) });
      return new Promise((resolve) => {
        this.socket.emit('chat:send', { battleId: finalBattleId, message, teamKey: teamKey || undefined, sender: sender || undefined }, (ack) => {
          if (ack && ack.ok !== false) { log('debug', 'Chat message sent successfully'); resolve(true); }
          else {
            log('debug', 'Fallback to legacy chat event');
            this.socket.emit('send-chat', { battleId: finalBattleId, message, teamKey: teamKey || undefined, sender: sender || undefined });
            resolve(false);
          }
        });
      });
    }

    // ───────────────────────────────────────────────────────────
    // 액션
    // ───────────────────────────────────────────────────────────
    async sendAction(actionData, battleId = null, playerId = null) {
      this._stats.totalMessages++;
      await this._ensureConnected();

      const payload = Object.assign(
        {
          battleId: battleId || this._roleCtx?.battleId,
          playerId: playerId || this._roleCtx?.playerId,
          timestamp: now()
        },
        actionData || {}
      );

      if (!payload.battleId || !payload.playerId) {
        const error = new Error('battleId/playerId required');
        log('error', 'Action failed: missing required fields', payload);
        throw error;
      }

      log('debug', 'Sending player action', { type: payload.type, action: payload.action });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { log('warn', 'Action timeout'); reject(new Error('Action timeout')); }, 15000);
        this.socket.emit('player:action', payload, (res) => {
          clearTimeout(timeout);
          if (res && res.ok !== false) {
            log('debug', 'Action successful', res);
            resolve(res);
          } else {
            log('debug', 'Fallback to legacy action event');
            this.socket.emit('playerAction', payload);
            resolve({ ok: true, legacy: true });
          }
        });
      });
    }

    // 구 시그니처 유지
    async sendPlayerAction(action, targetId = null, battleId = null, playerId = null) {
      return this.sendAction({ type: action, action, targetPid: targetId, targetId }, battleId, playerId);
    }

    // ───────────────────────────────────────────────────────────
    // 관리자 명령
    // ───────────────────────────────────────────────────────────
    async sendAdminCommand(command, data = {}) {
      this._stats.totalMessages++;
      await this._ensureConnected();

      const battleId = this._roleCtx?.battleId || data.battleId;
      if (!battleId) { const error = new Error('battleId required'); log('error', 'Admin command failed: no battleId', { command, data }); throw error; }

      log('info', 'Sending admin command', { command, battleId });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { log('warn', 'Admin command timeout', command); reject(new Error(`Command '${command}' timeout`)); }, 20000);
        this.socket.emit(`admin:${command}`, { battleId, ...data }, (res) => {
          clearTimeout(timeout);
          if (res && res.ok !== false) {
            log('debug', 'Admin command successful', { command, result: res });
            resolve(res || { ok: true });
          } else {
            const error = new Error(res?.message || `Command '${command}' failed`);
            log('error', 'Admin command failed', { command, error: error.message });
            reject(error);
          }
        });
      });
    }

    // ───────────────────────────────────────────────────────────
    // REST 래퍼
    // ───────────────────────────────────────────────────────────
    async apiCall(endpoint, options = {}) {
      try {
        log('debug', 'Making API call', { endpoint, method: options.method || 'GET' });
        const res = await fetch(endpoint, { headers: { 'Content-Type': 'application/json' }, ...options });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          log('warn', 'API call failed', { endpoint, status: res.status, data });
          return { ok: false, status: res.status, message: data.message || 'API 호출 실패' };
        }
        log('debug', 'API call successful', { endpoint, status: res.status });
        return data;
      } catch (err) {
        log('error', 'API call error', { endpoint, error: err.message });
        return { ok: false, message: 'API 호출 실패: ' + err.message };
      }
    }

    // ───────────────────────────────────────────────────────────
    // 범용 emit (연결 전 큐잉)
    // ───────────────────────────────────────────────────────────
    emit(event, payload) {
      this._stats.totalMessages++;
      if (this.socket && this.connectionState === CONNECTION_STATES.CONNECTED) {
        log('debug', 'Emitting event', { event, hasPayload: !!payload });
        this.socket.emit(event, payload);
      } else {
        log('debug', 'Queueing event (not connected)', { event, queueSize: this._queue.length });
        this._queue.push({ event, payload, timestamp: now() });
        if (this._queue.length > 100) {
          const removed = this._queue.splice(0, 50);
          log('warn', 'Event queue overflow, removed old events', { removed: removed.length });
        }
      }
    }

    // ───────────────────────────────────────────────────────────
    // 이벤트 구독/해제
    // ───────────────────────────────────────────────────────────
    on(evt, handler) {
      if (typeof handler !== 'function') { log('warn', 'Invalid event handler', { event: evt }); return () => {}; }
      if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
      this._listeners.get(evt).add(handler);
      log('debug', 'Event listener added', { event: evt, totalListeners: this._listeners.get(evt).size });
      return () => this.off(evt, handler);
    }

    off(evt, handler) {
      const set = this._listeners.get(evt);
      if (!set) return;
      const wasPresent = set.has(handler);
      set.delete(handler);
      if (set.size === 0) this._listeners.delete(evt);
      if (wasPresent) log('debug', 'Event listener removed', { event: evt, remainingListeners: set.size });
    }

    removeAllListeners(evt = null) {
      if (evt) {
        this._listeners.delete(evt);
        log('debug', 'All listeners removed for event', { event: evt });
      } else {
        const totalEvents = this._listeners.size;
        this._listeners.clear();
        log('debug', 'All event listeners removed', { totalEvents });
      }
    }

    // ───────────────────────────────────────────────────────────
    // 상태 조회
    // ───────────────────────────────────────────────────────────
    isConnected() { return this.connectionState === CONNECTION_STATES.CONNECTED; }
    isConnecting() { return this.connectionState === CONNECTION_STATES.CONNECTING; }
    isReconnecting() { return this.connectionState === CONNECTION_STATES.RECONNECTING; }
    hasError() { return this.connectionState === CONNECTION_STATES.ERROR; }

    getConnectionState() { return this.connectionState; }
    getLastError() { return this.lastError; }
    getLatencyMs() { return this._latency; }
    getRoleContext() { return Object.assign({}, this._roleCtx || {}); }
    getReconnectAttempts() { return this.reconnectAttempts; }
    getConnectionUptime() { return this._connectionStartTime ? now() - this._connectionStartTime : 0; }

    getStats() {
      return {
        ...this._stats,
        connectionState: this.connectionState,
        latency: this._latency,
        uptime: this.getConnectionUptime(),
        reconnectAttempts: this.reconnectAttempts,
        queueSize: this._queue.length,
        listenerCount: Array.from(this._listeners.values()).reduce((sum, set) => sum + set.size, 0)
      };
    }

    getConnectionQuality() {
      if (!this.isConnected()) return 'disconnected';
      if (this._latency === null) return 'unknown';
      if (this._latency < 100) return 'excellent';
      if (this._latency < 300) return 'good';
      if (this._latency < 800) return 'fair';
      if (this._latency < 2000) return 'poor';
      return 'bad';
    }

    // ───────────────────────────────────────────────────────────
    // 정리
    // ───────────────────────────────────────────────────────────
    destroy() {
      log('info', 'Destroying PyxisSocket', this.getStats());
      try { document.removeEventListener('visibilitychange', this._onVisibilityChange); } catch (_) {}
      this._stopHeartbeat();
      this._hideConnectionOverlay();
      this._connectionIndicators.clear();
      try {
        if (this.socket) {
          this.socket.removeAllListeners?.();
          this.socket.close();
          this.socket = null;
        }
      } catch (_) {}
      this.removeAllListeners();
      this._queue.length = 0;
      this.connectionState = CONNECTION_STATES.DISCONNECTED;
      this.lastError = null;
      this.reconnectAttempts = 0;
      this._connectionStartTime = null;
      this._lastHeartbeat = null;
    }

    // ───────────────────────────────────────────────────────────
    // 내부: 연결/재연결/바인딩
    // ───────────────────────────────────────────────────────────
    async _ensureConnected() {
      if (this.isConnected() || this.isConnecting()) return;
      await this._connect();
    }

    async _connect() {
      if (this.isConnecting() || this.isConnected()) return;

      this.connectionState = CONNECTION_STATES.CONNECTING;
      this.lastError = null;
      this._stats.totalConnections++;

      log('info', 'Attempting to connect', { attempt: this.reconnectAttempts + 1, url: this.opts.url });

      if (this._gameEffects && !this._isPageVisible) {
        this._showConnectionOverlay('서버에 연결 중...', `시도 ${this.reconnectAttempts + 1}회`);
      }

      this._updateConnectionIndicators();

      if (!this.io) {
        const error = new Error('socket.io client not loaded');
        log('error', 'Connection failed: Socket.IO not loaded');
        this._handleConnectionError(error);
        throw error;
      }

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

      // 연결 완료 대기
      await new Promise((resolve) => {
        const done = once(resolve);
        this.socket.once('connect', () => { log('info', 'Socket connected successfully'); done(); });
        this.socket.once('connect_error', (error) => { log('warn', 'Socket connection failed', error.message); done(); });
        setTimeout(() => { log('warn', 'Connection timeout'); done(); }, Math.max(5000, this.opts.timeout));
      });
    }

    _handleConnectionError(error) {
      this.connectionState = CONNECTION_STATES.ERROR;
      this.lastError = error;
      this._stats.totalErrors++;
      log('error', 'Connection error', { message: error.message, attempts: this.reconnectAttempts });
      this._notify?.('연결 오류', error.message || '서버 연결에 실패했습니다', { type: 'error', priority: 'high' });
      this._updateConnectionIndicators();

      if (this.opts.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this._scheduleReconnect();
      } else {
        log('error', 'Max reconnection attempts reached');
        this._notify?.('연결 포기', '최대 재연결 시도 횟수에 도달했습니다', { type: 'error', priority: 'urgent' });
      }
    }

    _scheduleReconnect() {
      this.connectionState = CONNECTION_STATES.RECONNECTING;
      this.reconnectAttempts++;
      this._stats.totalReconnections++;

      const delay = Math.min(
        this.opts.reconnectionDelay * Math.pow(1.5, this.reconnectAttempts - 1),
        this.opts.reconnectionDelayMax
      );

      log('info', 'Scheduling reconnection', { attempt: this.reconnectAttempts, delay: delay + 'ms' });

      if (this._gameEffects) {
        this._showConnectionOverlay('재연결 중...', `${(delay/1000).toFixed(1)}초 후 ${this.reconnectAttempts}번째 시도`);
      }

      this._updateConnectionIndicators();

      setTimeout(() => {
        if (this.connectionState === CONNECTION_STATES.RECONNECTING) {
          this._connect().catch((error) => this._handleConnectionError(error));
        }
      }, delay);
    }

    _bindSocketCoreEvents() {
      const s = this.socket;

      s.on('connect', () => {
        this.connectionState = CONNECTION_STATES.CONNECTED;
        this.lastError = null;
        this.reconnectAttempts = 0;
        this._connectionStartTime = now();

        log('info', 'Socket connected', { id: s.id });

        this._hideConnectionOverlay();
        this._updateConnectionIndicators();

        this._startHeartbeat();

        // 큐 flush
        if (this._queue.length) {
          const copies = this._queue.splice(0, this._queue.length);
          log('info', 'Flushing queued events', { count: copies.length });
          copies.forEach(({ event, payload }) => {
            try { s.emit(event, payload); } catch (error) { log('warn', 'Failed to emit queued event', { event, error: error.message }); }
          });
        }

        // 초기 레이턴시 측정
        const t0 = now();
        try { s.timeout(3000).emit('ping', { ts: t0 }, () => { this._latency = now() - t0; this._updateConnectionIndicators(); }); } catch (_) {}

        this._fire('socket:connect', { id: s.id, stats: this.getStats() });

        // 알림
        if (this._notify && this._stats.totalConnections > 1) {
          this._notify('연결 복구!', '서버 연결이 복구되었습니다', { type: 'success', priority: 'high' });
        }

        // 재연결 시 자동 재인증
        if (this._roleCtx) this._autoReauth();
      });

      s.on('connect_error', (err) => {
        this._handleConnectionError(err);
        this._fire('socket:error', { type: 'connect_error', message: err?.message || String(err || ''), stats: this.getStats() });
      });

      s.on('disconnect', (reason) => {
        this.connectionState = CONNECTION_STATES.DISCONNECTED;
        this._stats.totalDisconnections++;
        log('warn', 'Socket disconnected', { reason });
        this._stopHeartbeat();
        this._updateConnectionIndicators();
        this._fire('socket:disconnect', { reason, stats: this.getStats() });

        // 예상치 못한 끊김이면 재연결
        if (reason !== 'io client disconnect' && this.opts.autoReconnect) {
          this._notify?.('연결 끊김', '서버와의 연결이 끊어졌습니다', { type: 'warning', priority: 'high' });
          setTimeout(() => {
            if (this.connectionState === CONNECTION_STATES.DISCONNECTED) this._scheduleReconnect();
          }, 1000);
        }
      });

      // 인증 결과 표준화
      pick(EVENT_ALIASES.authOk, (evt) => {
        s.on(evt, (payload) => { log('info', 'Authentication successful', { event: evt, role: this._roleCtx?.role }); this._fire('auth:ok', payload); });
      });
      pick(EVENT_ALIASES.authErr, (evt) => {
        s.on(evt, (message) => { log('warn', 'Authentication failed', { event: evt, message }); this._fire('auth:error', { message }); });
      });
    }

    _autoReauth() {
      const { role, battleId, playerId, spectatorName, otp } = this._roleCtx || {};
      if (!role || !battleId) return;
      log('info', 'Auto re-authenticating', { role, battleId });
      if (role === 'admin' && otp) this.socket.emit('adminAuth', { battleId, otp });
      else if (role === 'player' && playerId && otp) this.socket.emit('playerAuth', { battleId, playerId, otp });
      else if (role === 'spectator' && otp) this.socket.emit('spectatorAuth', { battleId, otp, spectatorName: spectatorName || '관전자' });
      else this.socket.emit('join-battle', { battleId, role });
    }

    _bindBroadcastEvents() {
      const s = this.socket;

      // 상태
      pick(EVENT_ALIASES.state, (evt) => {
        s.on(evt, (state) => { log('debug', 'State update received', { event: evt }); this._fire('state', state); });
      });

      // 채팅
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
          log('debug', 'Chat message received', { from: payload.from?.nickname, scope: payload.scope });
          this._fire('chat', payload);
          if (!this._isPageVisible && this._notify && payload.text) {
            this._notify('새 메시지', payload.text.substring(0, 50), { type: 'general', priority: 'normal' });
          }
        });
      });

      // 페이즈/턴/배틀
      pick(EVENT_ALIASES.phaseChange, (evt) => {
        s.on(evt, (data) => {
          log('info', 'Phase change', { event: evt, phase: data?.phase });
          this._fire('phase', data);
          if (this._notify && data?.phase) {
            const phaseName = data.phase === 'team1' || data.phase === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
            this._notify('턴 변경', `${phaseName}의 차례입니다`, { type: 'turn', priority: 'normal' });
          }
        });
      });

      pick(EVENT_ALIASES.turnUpdate, (evt) => {
        s.on(evt, (data) => { log('debug', 'Turn update', { event: evt }); this._fire('turn', data); });
      });

      pick(EVENT_ALIASES.battleStatus, (evt) => {
        s.on(evt, (data) => {
          log('info', 'Battle status change', { event: evt });
          this._fire('battle', { event: evt, data });
          if (this._notify) {
            if (evt === 'battle:started') this._notify('전투 시작!', '전투가 시작되었습니다', { type: 'battle', priority: 'high' });
            if (evt === 'battle:ended' || evt === 'battle:end') this._notify('전투 종료', '전투가 종료되었습니다', { type: 'victory', priority: 'urgent' });
          }
        });
      });

      // 게임 이벤트
      pick(EVENT_ALIASES.playerJoin, (evt) => {
        s.on(evt, (data) => { log('info', 'Player joined', { player: data?.name }); this._fire('player:join', data); this._notify?.('플레이어 입장', `${data?.name || '플레이어'}님이 입장했습니다`, { type: 'general', priority: 'low' }); });
      });
      pick(EVENT_ALIASES.playerLeave, (evt) => {
        s.on(evt, (data) => { log('info', 'Player left', { player: data?.name }); this._fire('player:leave', data); this._notify?.('플레이어 퇴장', `${data?.name || '플레이어'}님이 퇴장했습니다`, { type: 'general', priority: 'low' }); });
      });
      pick(EVENT_ALIASES.playerDeath, (evt) => {
        s.on(evt, (data) => { log('info', 'Player death', { player: data?.name }); this._fire('player:death', data); this._notify?.('플레이어 사망', `${data?.name || '플레이어'}님이 쓰러졌습니다`, { type: 'defeat', priority: 'high' }); });
      });

      // 타이머/공지/로그
      pick(EVENT_ALIASES.timerSync, (evt) => {
        s.on(evt, (data) => { log('debug', 'Timer sync', { event: evt }); this._fire('timer', data); });
      });
      pick(EVENT_ALIASES.notice, (evt) => {
        s.on(evt, (data) => { log('info', 'Notice update', { event: evt }); this._fire('notice', data); });
      });
      pick(EVENT_ALIASES.logNew, (evt) => {
        s.on(evt, (line) => { log('debug', 'New log entry', { event: evt }); this._fire('log', line); });
      });

      // 액션 결과
      pick(EVENT_ALIASES.actionOk, (evt) => {
        s.on(evt, (res) => { log('debug', 'Action successful', { event: evt, type: res?.type }); this._fire('action:ok', res); });
      });
      pick(EVENT_ALIASES.actionErr, (evt) => {
        s.on(evt, (err) => {
          log('warn', 'Action failed', { event: evt, error: err });
          this._fire('action:error', err);
          this._notify?.('액션 실패', err?.message || '액션 수행에 실패했습니다', { type: 'error', priority: 'normal' });
        });
      });

      // 관전자 응원
      pick(EVENT_ALIASES.cheer, (evt) => {
        s.on(evt, (data) => { log('debug', 'Cheer received', { event: evt }); this._fire('cheer', data); });
      });

      // 에러/시스템
      pick(EVENT_ALIASES.error, (evt) => {
        s.on(evt, (e) => {
          log('error', 'Socket error event', { event: evt, error: e });
          this._fire('error', e);
          this._notify?.('오류', e?.message || '시스템 오류가 발생했습니다', { type: 'error', priority: 'high' });
        });
      });
      pick(EVENT_ALIASES.system, (evt) => {
        s.on(evt, (e) => { log('info', 'System message', { event: evt }); this._fire('system', e); });
      });
    }

    _fire(evt, payload) {
      const set = this._listeners.get(evt);
      if (!set || set.size === 0) return;
      set.forEach(fn => {
        try { fn(payload); }
        catch (error) { log('error', 'Event handler error', { event: evt, error: error.message }); }
      });
    }

    _onVisibilityChange() {
      this._isPageVisible = !document.hidden;
      if (this._isPageVisible) {
        log('debug', 'Page became visible');
        this._hideConnectionOverlay();
        if (!this.isConnected() && !this.isConnecting() && this.opts.autoReconnect) {
          log('info', 'Reconnecting on page visibility');
          this._connect().catch((error) => this._handleConnectionError(error));
        }
      } else {
        log('debug', 'Page became hidden');
      }
    }
  }

  // ───────────────────────────────────────────────────────────
  // 싱글톤/전역 노출
  // ───────────────────────────────────────────────────────────
  const instance = new SocketManager();

  // PyxisNotify 연동 (있을 때 자동)
  const setupNotifications = () => {
    if (global.PyxisNotify && typeof global.PyxisNotify.notify === 'function') {
      instance.onNotify((title, body, options = {}) => {
        global.PyxisNotify.notify(title, { body, ...options });
      });
      log('info', 'PyxisNotify integration enabled');
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNotifications);
  } else {
    setupNotifications();
  }

  // 연결 상태 표시기 자동 탐지
  const autoAttachIndicators = () => {
    const nodes = document.querySelectorAll('#connectionDot, .connection-status, .status-dot');
    nodes.forEach(el => instance.registerConnectionIndicator(el));
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoAttachIndicators);
  } else {
    autoAttachIndicators();
  }

  // 전역/모듈 노출
  global.PyxisSocket = instance;
  if (typeof module !== 'undefined' && module.exports) module.exports = instance;

  // 언로드 시 정리
  global.addEventListener?.('beforeunload', () => { instance.destroy(); });

})(window);
