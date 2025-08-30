// PYXIS Socket Manager - 완전히 새로운 소켓 연결 및 이벤트 관리
class PyxisSocketManager {
  constructor(options = {}) {
    // 기본 설정
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
    
    // 연결 상태
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;
    
    // 이벤트 관리
    this.eventHandlers = new Map();
    this.pendingRequests = new Map();
    
    // 인증 정보
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

    console.log('[SocketManager] Initializing connection to:', url);
    
    this.socket = io(url, this.options);
    this.setupEventListeners();
    return this.socket;
  }

  // 핵심 이벤트 리스너 설정
  setupEventListeners() {
    if (!this.socket) return;

    // === 연결 상태 이벤트 ===
    this.socket.on('connect', () => {
      console.log('[SocketManager] Connected with ID:', this.socket.id);
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.emit('connection:success');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[SocketManager] Disconnected:', reason);
      this.connected = false;
      this.connecting = false;
      this.emit('connection:disconnect', { reason });
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SocketManager] Connection error:', error);
      this.connected = false;
      this.connecting = false;
      this.emit('connection:error', { error });
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('[SocketManager] Reconnected after', attemptNumber, 'attempts');
      this.connected = true;
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.emit('connection:reconnect', { attemptNumber });
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('[SocketManager] Reconnection attempt:', attemptNumber);
      this.connecting = true;
      this.reconnectAttempts = attemptNumber;
      this.emit('connection:attempting', { attemptNumber });
    });

    this.socket.on('reconnect_failed', () => {
      console.error('[SocketManager] Reconnection failed');
      this.connected = false;
      this.connecting = false;
      this.emit('connection:failed');
    });

    // === 인증 이벤트 ===
    this.socket.on('authSuccess', (data) => {
      console.log('[SocketManager] Authentication successful');
      this.emit('authSuccess', data);
    });

    this.socket.on('authError', (message) => {
      console.error('[SocketManager] Authentication failed:', message);
      this.emit('authError', message);
    });

    // === 게임 상태 이벤트 ===
    this.socket.on('state:update', (state) => {
      this.emit('state:update', state);
    });

    this.socket.on('state', (state) => {
      this.emit('state', state);
    });

    this.socket.on('battleUpdate', (state) => {
      this.emit('state:update', state);
    });

    // === 채팅 이벤트 ===
    this.socket.on('chat:new', (message) => {
      this.emit('chat:new', message);
    });

    this.socket.on('chat', (message) => {
      this.emit('chat:new', message);
    });

    this.socket.on('chat-message', (data) => {
      this.emit('chat:new', data.message || data);
    });

    this.socket.on('chatError', (error) => {
      this.emit('chat:error', error);
    });

    // === 전투 이벤트 ===
    this.socket.on('battle:created', (data) => {
      this.emit('battle:created', data);
    });

    this.socket.on('battle:started', (data) => {
      this.emit('battle:started', data);
    });

    this.socket.on('battle:ended', (result) => {
      this.emit('battle:end', result);
    });

    this.socket.on('battle:end', (result) => {
      this.emit('battle:end', result);
    });

    // === 턴/페이즈 이벤트 ===
    this.socket.on('turn:start', (data) => {
      this.emit('turn:start', data);
    });

    this.socket.on('turn:end', (data) => {
      this.emit('turn:end', data);
    });

    this.socket.on('phase:change', (phase) => {
      this.emit('phase:change', phase);
    });

    // === 액션 이벤트 ===
    this.socket.on('action:success', (data) => {
      this.emit('action:success', data);
    });

    this.socket.on('action:error', (message) => {
      this.emit('action:error', message);
    });

    this.socket.on('actionSuccess', (data) => {
      this.emit('action:success', data);
    });

    this.socket.on('actionError', (message) => {
      this.emit('action:error', message);
    });

    // === 플레이어 이벤트 ===
    this.socket.on('player:added', (data) => {
      this.emit('player:added', data);
    });

    this.socket.on('player:removed', (data) => {
      this.emit('player:removed', data);
    });

    this.socket.on('player:updated', (data) => {
      this.emit('player:updated', data);
    });

    // === 관전자 이벤트 ===
    this.socket.on('spectator:joined', (data) => {
      this.emit('spectator:joined', data);
    });

    this.socket.on('spectator:left', (data) => {
      this.emit('spectator:left', data);
    });

    this.socket.on('spectator:cheer:sent', (data) => {
      this.emit('spectator:cheer:sent', data);
    });

    // === 로그 이벤트 ===
    this.socket.on('log:new', (event) => {
      this.emit('log:new', event);
    });

    this.socket.on('noticeUpdate', (data) => {
      this.emit('notice:update', data);
    });

    this.socket.on('timer:sync', (data) => {
      this.emit('timer:sync', data);
    });

    // === 일반 에러 처리 ===
    this.socket.on('error', (error) => {
      console.error('[SocketManager] General error:', error);
      this.emit('error', error);
    });
  }

  // === 이벤트 에미터 기능 ===
  
  // 이벤트 발생
  emit(eventName, data = null) {
    const handlers = this.eventHandlers.get(eventName) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[SocketManager] Error in ${eventName} handler:`, error);
      }
    });
  }

  // 이벤트 리스너 등록
  on(eventName, handler) {
    if (typeof handler !== 'function') {
      console.warn(`[SocketManager] Handler for ${eventName} is not a function`);
      return;
    }
    
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName).push(handler);
  }

  // 이벤트 리스너 제거
  off(eventName, handler) {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // 일회성 이벤트 리스너
  once(eventName, handler) {
    const onceHandler = (data) => {
      handler(data);
      this.off(eventName, onceHandler);
    };
    this.on(eventName, onceHandler);
  }

  // === 인증 메서드 ===
  
  // 관리자 인증
  authenticateAsAdmin(battleId, otp) {
    return this.authenticate('admin', { battleId, otp });
  }

  // 플레이어 인증  
  authenticateAsPlayer(battleId, otp, playerId = null) {
    return this.authenticate('player', { battleId, otp, playerId });
  }

  // 관전자 인증
  authenticateAsSpectator(battleId, otp, spectatorName) {
    return this.authenticate('spectator', { battleId, otp, spectatorName });
  }

  // 통합 인증
  authenticate(role, authData) {
    if (!this.socket || !this.connected) {
      throw new Error('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 10000);

      const successHandler = (data) => {
        clearTimeout(timeout);
        this.off('authSuccess', successHandler);
        this.off('authError', errorHandler);
        
        // 인증 정보 저장
        this.auth = {
          battleId: authData.battleId,
          role: role,
          playerId: authData.playerId || data.player?.id,
          spectatorName: authData.spectatorName,
          token: authData.otp
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

      // 역할별 인증 이벤트 전송
      const eventName = `${role}Auth`;
      console.log(`[SocketManager] Sending ${eventName}:`, authData);
      this.socket.emit(eventName, authData);
    });
  }

  // === 메시지 전송 메서드 ===

  // 채팅 메시지 전송 (통합)
  sendChat(message, channel = 'all', battleId = null) {
    if (!this.socket || !this.connected) {
      console.warn('[SocketManager] Cannot send chat: not connected');
      return Promise.reject(new Error('Not connected'));
    }

    const chatData = {
      battleId: battleId || this.auth.battleId,
      message: message,
      channel: channel,
      sender: this.getSenderName()
    };

    // 다중 프로토콜 지원
    return new Promise((resolve) => {
      // 1) 신규 프로토콜 시도
      this.socket.emit('chat:send', chatData, (response) => {
        if (response && response.ok) {
          resolve(response);
        } else {
          // 2) 중간 프로토콜 시도  
          this.socket.emit('send-chat', chatData, (response2) => {
            if (response2 && response2.ok) {
              resolve(response2);
            } else {
              // 3) 레거시 프로토콜
              this.socket.emit('chatMessage', {
                message: message,
                channel: channel === 'team' ? 'team' : 'all',
                battleId: chatData.battleId
              });
              resolve({ ok: true });
            }
          });
        }
      });
    });
  }

  // 플레이어 액션 전송 (통합)
  sendPlayerAction(action, targetId = null, battleId = null, playerId = null) {
    if (!this.socket || !this.connected) {
      console.warn('[SocketManager] Cannot send action: not connected');
      return Promise.reject(new Error('Not connected'));
    }

    const actionData = {
      battleId: battleId || this.auth.battleId,
      playerId: playerId || this.auth.playerId,
      action: action,
      targetId: targetId
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Action timeout'));
      }, 8000);

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

      // 1) 신규 프로토콜
      this.socket.emit('player:action', actionData, (response) => {
        if (response && response.ok) {
          clearTimeout(timeout);
          this.off('action:success', successHandler);
          this.off('action:error', errorHandler);
          resolve(response);
        } else {
          // 2) 레거시 프로토콜
          this.socket.emit('playerAction', actionData);
        }
      });
    });
  }

  // 관전자 응원 전송
  sendCheer(cheerMessage, battleId = null) {
    if (!this.socket || !this.connected) {
      console.warn('[SocketManager] Cannot send cheer: not connected');
      return Promise.reject(new Error('Not connected'));
    }

    const cheerData = {
      battleId: battleId || this.auth.battleId,
      spectator: this.auth.spectatorName,
      cheer: cheerMessage
    };

    return new Promise((resolve) => {
      this.socket.emit('spectator:cheer', cheerData, (response) => {
        if (response && response.ok) {
          resolve(response);
        } else {
          // 레거시 지원
          this.socket.emit('cheer', { message: cheerMessage, battleId: cheerData.battleId });
          resolve({ ok: true });
        }
      });
    });
  }

  // 관리자 명령 전송
  sendAdminCommand(command, data = {}) {
    if (!this.socket || !this.connected) {
      console.warn('[SocketManager] Cannot send admin command: not connected');
      return Promise.reject(new Error('Not connected'));
    }

    if (this.auth.role !== 'admin') {
      return Promise.reject(new Error('Not authenticated as admin'));
    }

    const commandData = {
      battleId: this.auth.battleId,
      ...data
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Command timeout'));
      }, 8000);

      this.socket.emit(`admin:${command}`, commandData, (response) => {
        clearTimeout(timeout);
        if (response && response.ok !== false) {
          resolve(response || { ok: true });
        } else {
          reject(new Error(response?.message || 'Command failed'));
        }
      });
    });
  }

  // === 유틸리티 메서드 ===

  // 발신자 이름 얻기
  getSenderName() {
    switch (this.auth.role) {
      case 'admin':
        return '관리자';
      case 'spectator':
        return this.auth.spectatorName || '관전자';
      case 'player':
        return '플레이어';
      default:
        return '익명';
    }
  }

  // 연결 상태 확인
  isConnected() {
    return this.connected && this.socket?.connected;
  }

  isConnecting() {
    return this.connecting;
  }

  getReconnectAttempts() {
    return this.reconnectAttempts;
  }

  // 인증 상태 확인
  isAuthenticated() {
    return this.auth.battleId && this.auth.role;
  }

  getAuth() {
    return { ...this.auth };
  }

  // 상태 요청
  requestState() {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Not connected'));
    }

    const eventName = `${this.auth.role}:requestState`;
    this.socket.emit(eventName, {
      battleId: this.auth.battleId,
      playerId: this.auth.playerId
    });
  }

  // API 호출 래퍼
  async apiCall(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[SocketManager] API call failed:', error);
      return { ok: false, message: 'API 호출 실패' };
    }
  }

  // 연결 해제
  disconnect() {
    if (this.socket) {
      console.log('[SocketManager] Disconnecting socket');
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempts = 0;
    this.auth = {
      battleId: null,
      role: null,
      playerId: null,
      spectatorName: null,
      token: null
    };
  }

  // 정리
  cleanup() {
    this.disconnect();
    this.eventHandlers.clear();
    this.pendingRequests.clear();
  }
}

// 전역 인스턴스 생성
window.PyxisSocket = new PyxisSocketManager();

// 전역 접근을 위한 export
window.PyxisSocketManager = PyxisSocketManager;
