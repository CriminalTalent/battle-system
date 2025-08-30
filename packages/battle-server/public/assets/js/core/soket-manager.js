// PYXIS Socket Manager - 소켓 연결 및 이벤트 관리
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
    this.callbacks = new Map();
    this.eventHandlers = new Map();
  }

  // 소켓 초기화
  init(url = window.location.origin) {
    if (this.socket) {
      this.disconnect();
    }

    console.log('[SocketManager] Initializing socket connection to:', url);
    
    this.socket = io(url, this.options);
    this.setupEventListeners();
    return this.socket;
  }

  // 기본 이벤트 리스너 설정
  setupEventListeners() {
    if (!this.socket) return;

    // 연결 이벤트
    this.socket.on('connect', () => {
      console.log('[SocketManager] Connected to server');
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

    // 게임 이벤트 중계
    const gameEvents = [
      'authSuccess', 'authError', 
      'state:update', 'state',
      'chat:new', 'chat', 'chatError',
      'log:new', 'phase:change', 'battle:end',
      'actionSuccess', 'actionError',
      'noticeUpdate', 'timer:sync'
    ];

    gameEvents.forEach(event => {
      this.socket.on(event, (data) => {
        this.emit(event, data);
      });
    });
  }

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

  // 인증 관련 메소드들
  async authenticate(authData) {
    if (!this.socket || !this.connected) {
      throw new Error('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 10000);

      // 최신 스펙 시도
      this.socket.timeout(8000).emit('join', authData, (error, ack) => {
        if (error) {
          // 중간 스펙 시도 (role별 이벤트)
          const eventMap = {
            'player': 'playerAuth',
            'admin': 'adminAuth', 
            'spectator': 'spectatorAuth'
          };
          const authEvent = eventMap[authData.role];
          
          if (authEvent) {
            this.socket.timeout(8000).emit(authEvent, authData, (error2, ack2) => {
              clearTimeout(timeout);
              if (error2 || (ack2 && !ack2.ok)) {
                reject(new Error(ack2?.message || ack2?.error || 'Auth failed'));
              } else {
                resolve(ack2);
              }
            });
          } else {
            // 레거시 폴백
            this.socket.emit('auth', authData);
            
            // authSuccess/authError 대기
            const successHandler = (result) => {
              clearTimeout(timeout);
              this.socket.off('authSuccess', successHandler);
              this.socket.off('authError', errorHandler);
              resolve(result);
            };
            
            const errorHandler = (message) => {
              clearTimeout(timeout);
              this.socket.off('authSuccess', successHandler);
              this.socket.off('authError', errorHandler);
              reject(new Error(message));
            };
            
            this.socket.on('authSuccess', successHandler);
            this.socket.on('authError', errorHandler);
          }
        } else if (ack && !ack.ok) {
          clearTimeout(timeout);
          reject(new Error(ack.msg || ack.message || 'Auth failed'));
        } else {
          clearTimeout(timeout);
          resolve(ack);
        }
      });
    });
  }

  // 액션 전송 (다중 폴백)
  async sendAction(actionData, battleId = null, playerId = null) {
    if (!this.socket || !this.connected) {
      throw new Error('Socket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Action timeout'));
      }, 8000);

      // 1) 최신 스펙: action:player
      this.socket.timeout(5000).emit('action:player', actionData, (error, ack) => {
        if (error || (ack && ack.ok === false)) {
          // 2) 중간 스펙: player:action  
          this.socket.timeout(5000).emit('player:action', actionData, (error2, ack2) => {
            if (error2 || (ack2 && ack2.ok === false)) {
              // 3) 레거시 스펙: playerAction
              this.socket.emit('playerAction', {
                battleId,
                playerId, 
                action: actionData
              });
              
              // actionSuccess/actionError 대기
              const successHandler = (result) => {
                clearTimeout(timeout);
                this.socket.off('actionSuccess', successHandler);
                this.socket.off('actionError', errorHandler);
                resolve(result);
              };
              
              const errorHandler = (message) => {
                clearTimeout(timeout);
                this.socket.off('actionSuccess', successHandler);
                this.socket.off('actionError', errorHandler);
                reject(new Error(message));
              };
              
              this.socket.on('actionSuccess', successHandler);
              this.socket.on('actionError', errorHandler);
            } else {
              clearTimeout(timeout);
              resolve(ack2);
            }
          });
        } else {
          clearTimeout(timeout);
          resolve(ack);
        }
      });
    });
  }

  // 채팅 전송 (다중 폴백)
  sendChat(chatData) {
    if (!this.socket || !this.connected) {
      console.warn('[SocketManager] Cannot send chat: not connected');
      return;
    }

    // 1) 신규 스펙
    this.socket.emit('chat:send', chatData, (ack) => {
      if (ack && ack.ok === false) {
        console.error('[SocketManager] Chat error:', ack.msg);
        this.emit('chat:error', ack.msg);
      }
    });

    // 2) 레거시 폴백
    const legacyData = {
      message: chatData.text,
      channel: chatData.scope === 'team' ? 'team' : 'all'
    };
    this.socket.emit('chatMessage', legacyData);
  }

  // API 호출 래퍼
  async apiCall(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      return await response.json();
    } catch (error) {
      console.error('[SocketManager] API call failed:', error);
      return { ok: false, msg: 'API 호출 실패' };
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
  }

  // 정리
  cleanup() {
    this.disconnect();
    this.eventHandlers.clear();
    this.callbacks.clear();
  }
}

// 전역 인스턴스
window.PyxisSocket = new PyxisSocketManager();
