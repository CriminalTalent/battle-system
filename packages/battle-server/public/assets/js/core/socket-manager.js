// PYXIS Socket Manager - 소켓 연결 및 이벤트 관리 (클라이언트)
class PyxisSocketManager {
  constructor(options = {}) {
    this.options = {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      path: '/socket.io/',
      ...options
    };

    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;

    this.eventHandlers = new Map();
    this.pendingRequests = new Map();

    this.auth = {
      battleId: null,
      role: null,        // 'admin' | 'player' | 'spectator'
      playerId: null,
      spectatorName: null,
      token: null
    };
  }

  // 소켓 초기화
  init(url = window.location.origin) {
    if (this.socket) {
      this.disconnect();
    }
    if (typeof io === 'undefined') {
      console.error('[SocketManager] Socket.IO client not found');
      return null;
    }
    console.log('[SocketManager] Initializing connection to:', url);

    this.socket = io(url, this.options);
    this.setupEventListeners();
    return this.socket;
  }

  // 핵심 이벤트 리스너 설정
  setupEventListeners() {
    if (!this.socket) return;

    // 연결 상태 이벤트
    this.socket.on('connect', () => {
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.emit('connection:success');
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.connecting = false;
      this.emit('connection:disconnect', { reason });
    });

    this.socket.on('connect_error', (error) => {
      this.connected = false;
      this.connecting = false;
      this.emit('connection:error', { error });
    });

    this.socket.on('reconnect', (attemptNumber) => {
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.emit('connection:reconnect', { attemptNumber });
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      this.connecting = true;
      this.reconnectAttempts = attemptNumber;
      this.emit('connection:attempting', { attemptNumber });
    });

    this.socket.on('reconnect_failed', () => {
      this.connected = false;
      this.connecting = false;
      this.emit('connection:failed');
    });

    // 인증 이벤트
    this.socket.on('authSuccess', (data) => this.emit('authSuccess', data));
    this.socket.on('authError', (message) => this.emit('authError', message));

    // 게임 상태
    this.socket.on('state:update', (state) => this.emit('state:update', state));
    this.socket.on('state', (state) => this.emit('state', state));
    this.socket.on('battleUpdate', (state) => this.emit('state:update', state));

    // 채팅
    this.socket.on('chat:new', (message) => this.emit('chat:new', message));
    this.socket.on('chat', (message) => this.emit('chat:new', message));
    this.socket.on('chat-message', (data) => this.emit('chat:new', data.message || data));
    this.socket.on('chatError', (error) => this.emit('chat:error', error));

    // 전투
    this.socket.on('battle:created', (data) => this.emit('battle:created', data));
    this.socket.on('battle:started', (data) => this.emit('battle:started', data));
    this.socket.on('battle:ended', (result) => this.emit('battle:end', result));
    this.socket.on('battle:end', (result) => this.emit('battle:end', result));

    // 턴/페이즈
    this.socket.on('turn:start', (data) => this.emit('turn:start', data));
    this.socket.on('turn:end', (data) => this.emit('turn:end', data));
    this.socket.on('phase:change', (phase) => this.emit('phase:change', phase));

    // 액션
    this.socket.on('action:success', (data) => this.emit('action:success', data));
    this.socket.on('action:error', (message) => this.emit('action:error', message));
    this.socket.on('actionSuccess', (data) => this.emit('action:success', data));
    this.socket.on('actionError', (message) => this.emit('action:error', message));

    // 플레이어
    this.socket.on('player:added', (data) => this.emit('player:added', data));
    this.socket.on('player:removed', (data) => this.emit('player:removed', data));
    this.socket.on('player:updated', (data) => this.emit('player:updated', data));

    // 관전자
    this.socket.on('spectator:joined', (data) => this.emit('spectator:joined', data));
    this.socket.on('spectator:left', (data) => this.emit('spectator:left', data));
    this.socket.on('spectator:cheer:sent', (data) => this.emit('spectator:cheer:sent', data));

    // 로그/타이머/공지
    this.socket.on('log:new', (event) => this.emit('log:new', event));
    this.socket.on('noticeUpdate', (data) => this.emit('notice:update', data));
    this.socket.on('timer:sync', (data) => this.emit('timer:sync', data));

    // 일반 에러
    this.socket.on('error', (error) => {
      console.error('[SocketManager] General error:', error);
      this.emit('error', error);
    });
  }

  // 이벤트 에미터
  emit(eventName, data = null) {
    const handlers = this.eventHandlers.get(eventName) || [];
    handlers.forEach(handler => {
      try { handler(data); }
      catch (error) { console.error(`[SocketManager] Error in ${eventName} handler:`, error); }
    });
  }
  on(eventName, handler) {
    if (typeof handler !== 'function') return;
    if (!this.eventHandlers.has(eventName)) this.eventHandlers.set(eventName, []);
    this.eventHandlers.get(eventName).push(handler);
  }
  off(eventName, handler) {
    const handlers = this.eventHandlers.get(eventName);
    if (!handlers) return;
    const i = handlers.indexOf(handler);
    if (i > -1) handlers.splice(i, 1);
  }
  once(eventName, handler) {
    const onceHandler = (data) => {
      handler(data);
      this.off(eventName, onceHandler);
    };
    this.on(eventName, onceHandler);
  }

  // 인증
  authenticateAsAdmin(battleId, otp) {
    return this.authenticate('admin', { battleId, otp });
  }
  authenticateAsPlayer(battleId, otp, playerId = null) {
    return this.authenticate('player', { battleId, otp, playerId });
  }
  authenticateAsSpectator(battleId, otp, spectatorName) {
    return this.authenticate('spectator', { battleId, otp, spectatorName });
  }

  authenticate(role, authData) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Socket not connected'));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Authentication timeout')), 10000);

      const successHandler = (data) => {
        clearTimeout(timeout);
        this.off('authSuccess', successHandler);
        this.off('authError', errorHandler);
        this.auth = {
          battleId: authData.battleId,
          role,
          playerId: authData.playerId || data.player?.id,
          spectatorName: authData.spectatorName,
          token: authData.otp || authData.token
        };
        resolve(data);
      };
      const errorHandler = (message) => {
        clearTimeout(timeout);
        this.off('authSuccess', successHandler);
        this.off('authError', errorHandler);
        reject(new Error(message));
      };

      this.once('authSuccess', successHandler);
      this.once('authError', errorHandler);

      const eventName = `${role}Auth`;
      this.socket.emit(eventName, authData);
    });
  }

  // 메시지 전송
  sendChat(message, channel = 'all', battleId = null) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Not connected'));
    }
    const chatData = (typeof message === 'object' && message) ? message : {
      battleId: battleId || this.auth.battleId,
      message,
      channel,
      sender: this.getSenderName()
    };
    return new Promise((resolve) => {
      this.socket.emit('chat:send', chatData, (response) => {
        if (response && response.ok) return resolve(response);
        this.socket.emit('send-chat', chatData, (response2) => {
          if (response2 && response2.ok) return resolve(response2);
          this.socket.emit('chatMessage', {
            message: chatData.message || chatData.text,
            channel: chatData.channel || chatData.scope || 'all',
            battleId: chatData.battleId
          });
          resolve({ ok: true });
        });
      });
    });
  }

  sendPlayerAction(action, targetId = null, battleId = null, playerId = null) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Not connected'));
    }
    const actionData = {
      battleId: battleId || this.auth.battleId,
      playerId: playerId || this.auth.playerId,
      action,
      targetId
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Action timeout')), 8000);
      const successHandler = (result) => {
        clearTimeout(timeout);
        this.off('action:success', successHandler);
        this.off('action:error', errorHandler);
        resolve(result);
      };
      const errorHandler = (message) => {
        clearTimeout(timeout);
        this.off('action:success', successHandler);
        this.off('action:error', errorHandler);
        reject(new Error(message));
      };
      this.once('action:success', successHandler);
      this.once('action:error', errorHandler);

      this.socket.emit('player:action', actionData, (response) => {
        if (response && response.ok) {
          clearTimeout(timeout);
          this.off('action:success', successHandler);
          this.off('action:error', errorHandler);
          resolve(response);
        } else {
          this.socket.emit('playerAction', actionData); // 레거시
        }
      });
    });
  }

  // 관전자 응원
  sendCheer(cheerMessage, battleId = null) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Not connected'));
    }
    const cheerData = {
      battleId: battleId || this.auth.battleId,
      spectator: this.auth.spectatorName,
      cheer: cheerMessage
    };
    return new Promise((resolve) => {
      this.socket.emit('spectator:cheer', cheerData, (response) => {
        if (response && response.ok) return resolve(response);
        this.socket.emit('cheer', { message: cheerMessage, battleId: cheerData.battleId });
        resolve({ ok: true });
      });
    });
  }

  // 관리자 명령
  sendAdminCommand(command, data = {}) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Not connected'));
    }
    if (this.auth.role !== 'admin') {
      return Promise.reject(new Error('Not authenticated as admin'));
    }
    const commandData = { battleId: this.auth.battleId, ...data };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Command timeout')), 8000);
      this.socket.emit(`admin:${command}`, commandData, (response) => {
        clearTimeout(timeout);
        if (response && response.ok !== false) resolve(response || { ok: true });
        else reject(new Error(response?.message || 'Command failed'));
      });
    });
  }

  // 유틸
  getSenderName() {
    switch (this.auth.role) {
      case 'admin': return '관리자';
      case 'spectator': return this.auth.spectatorName || '관전자';
      case 'player': return '플레이어';
      default: return '익명';
    }
  }
  isConnected() { return this.connected && this.socket?.connected; }
  isConnecting() { return this.connecting; }
  getReconnectAttempts() { return this.reconnectAttempts; }
  isAuthenticated() { return this.auth.battleId && this.auth.role; }
  getAuth() { return { ...this.auth }; }

  requestState() {
    if (!this.socket || !this.connected) return Promise.reject(new Error('Not connected'));
    const eventName = `${this.auth.role}:requestState`;
    this.socket.emit(eventName, { battleId: this.auth.battleId, playerId: this.auth.playerId });
  }

  async apiCall(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      return await response.json();
    } catch (error) {
      console.error('[SocketManager] API call failed:', error);
      return { ok: false, message: 'API 호출 실패' };
    }
  }

  // 연결 해제/정리
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;
    this.auth = { battleId: null, role: null, playerId: null, spectatorName: null, token: null };
  }
  cleanup() {
    this.disconnect();
    this.eventHandlers.clear();
    this.pendingRequests.clear();
  }
}

// 전역 인스턴스
window.PyxisSocket = new PyxisSocketManager();
window.PyxisSocketManager = PyxisSocketManager;
