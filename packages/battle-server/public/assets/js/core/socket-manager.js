/* packages/battle-server/public/assets/js/core/socket-manager.js
 * ────────────────────────────────────────────────────────────────────
 * PYXIS Socket Manager - 실시간 통신 클라이언트
 * - Socket.IO 클라이언트 래퍼
 * - 자동 재연결 및 이벤트 큐잉
 * - 역할별 인증 (관리자/플레이어/관전자)
 * - 이벤트 다중 호환성
 * ────────────────────────────────────────────────────────────────────
 */

(function(global) {
  'use strict';

  // ════════════════════════════════════════════════════════════════════
  // 상수 및 설정
  // ════════════════════════════════════════════════════════════════════
  
  const DEFAULTS = {
    url: null, // 기본: 현재 origin
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    timeout: 10000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    withCredentials: true,
  };

  const EVENT_ALIASES = Object.freeze({
    // 상태 관련
    state: ['state:update', 'state', 'battleUpdate', 'battle-state'],
    // 채팅
    chat: ['chat:new', 'chat', 'chat-message'],
    // 페이즈/턴
    phaseChange: ['phase:change', 'turn:change'],
    turnUpdate: ['turn:update'],
    // 전투 상태
    battleStatus: ['battle:status', 'battle:created', 'battle:started', 'battle:ended'],
    // 액션 결과
    actionOk: ['action:success', 'actionSuccess'],
    actionErr: ['action:error', 'actionError'],
    // 관전자
    cheer: ['spectator:cheer'],
    // 인증
    authOk: ['authSuccess', 'auth:success'],
    authErr: ['authError', 'auth:error'],
    // 시스템
    error: ['error'],
    system: ['system:message']
  });

  // ════════════════════════════════════════════════════════════════════
  // 유틸리티 함수들
  // ════════════════════════════════════════════════════════════════════
  
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // 이미 로드된 경우
      if ([...document.scripts].some(s => s.src.includes('socket.io.js'))) {
        return resolve();
      }
      
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Socket.IO client'));
      document.head.appendChild(script);
    });
  }

  function once(fn, context) {
    let done = false;
    return function(...args) {
      if (done) return;
      done = true;
      return fn.apply(context || null, args);
    };
  }

  function pickEvents(eventList, handler) {
    eventList.forEach(event => handler(event));
  }

  // ════════════════════════════════════════════════════════════════════
  // PyxisSocket 클래스
  // ════════════════════════════════════════════════════════════════════
  
  class PyxisSocket {
    constructor() {
      this.io = null;
      this.socket = null;
      this.options = { ...DEFAULTS };
      this.connected = false;
      this.connecting = false;
      this.lastError = null;
      this._eventQueue = [];
      this._listeners = new Map();
      this._roleContext = null;
      this._latency = null;
      this._notifyHandler = null;

      this._onVisibilityChange = this._onVisibilityChange.bind(this);
    }

    // ────────────────────────────────────────────────────────────────
    // 초기화 및 연결
    // ────────────────────────────────────────────────────────────────
    
    async init(options = {}) {
      this.options = Object.assign({}, DEFAULTS, options);
      
      if (!this.options.url) {
        this.options.url = window.location.origin;
      }

      // Socket.IO 클라이언트 동적 로드
      if (typeof window.io === 'undefined') {
        const socketPath = this.options.url.replace(/\/+$/, '') + '/socket.io/socket.io.js';
        await loadScript(socketPath);
      }
      
      this.io = window.io;

      // 가시성 변경 시 재연결
      document.addEventListener('visibilitychange', this._onVisibilityChange);

      await this._connect();
      return this;
    }

    async _connect() {
      if (this.connecting || this.connected) return;
      
      this.connecting = true;
      this.lastError = null;

      if (!this.io) {
        throw new Error('Socket.IO client not loaded');
      }

      // 기존 소켓 정리
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      }

      // 새 소켓 생성
      this.socket = this.io(this.options.url, {
        path: this.options.path,
        transports: this.options.transports,
        timeout: this.options.timeout,
        reconnection: this.options.reconnection,
        reconnectionAttempts: this.options.reconnectionAttempts,
        reconnectionDelay: this.options.reconnectionDelay,
        reconnectionDelayMax: this.options.reconnectionDelayMax,
        withCredentials: this.options.withCredentials,
      });

      this._bindSocketEvents();
      this._bindBroadcastEvents();

      // 연결 완료 대기
      await new Promise((resolve) => {
        const done = once(resolve);
        this.socket.once('connect', done);
        setTimeout(done, this.options.timeout);
      });
    }

    _bindSocketEvents() {
      const socket = this.socket;

      socket.on('connect', () => {
        console.log('[PyxisSocket] Connected:', socket.id);
        this.connected = true;
        this.connecting = false;
        this.lastError = null;

        // 큐에 있는 이벤트들 전송
        if (this._eventQueue.length > 0) {
          const queue = this._eventQueue.splice(0, this._eventQueue.length);
          queue.forEach(({ event, payload }) => {
            socket.emit(event, payload);
          });
        }

        // 핑 측정
        const startTime = Date.now();
        socket.timeout(3000).emit('ping', null, () => {
          this._latency = Date.now() - startTime;
        });

        this._emit('connection:success', { id: socket.id });

        // 역할 컨텍스트가 있으면 자동 재인증
        if (this._roleContext) {
          this._autoReauth();
        }
      });

      socket.on('connect_error', (error) => {
        console.error('[PyxisSocket] Connection error:', error);
        this.connected = false;
        this.connecting = false;
        this.lastError = error;
        this._emit('connection:error', { error: error.message || String(error) });
      });

      socket.on('disconnect', (reason) => {
        console.log('[PyxisSocket] Disconnected:', reason);
        this.connected = false;
        this.connecting = false;
        this._emit('connection:disconnect', { reason });
      });

      // 인증 이벤트
      pickEvents(EVENT_ALIASES.authOk, (event) => {
        socket.on(event, (data) => {
          console.log('[PyxisSocket] Authentication success');
          this._emit('auth:success', data);
          this._emit('authSuccess', data); // 호환성
          
          if (this._notifyHandler) {
            this._notifyHandler('연결 완료', '서버 인증이 성공했습니다.');
          }
        });
      });

      pickEvents(EVENT_ALIASES.authErr, (event) => {
        socket.on(event, (message) => {
          console.error('[PyxisSocket] Authentication error:', message);
          this._emit('auth:error', { message });
          this._emit('authError', message); // 호환성
        });
      });
    }

    _bindBroadcastEvents() {
      const socket = this.socket;

      // 상태 업데이트
      pickEvents(EVENT_ALIASES.state, (event) => {
        socket.on(event, (state) => {
          this._emit('state:update', state);
          this._emit('state', state); // 호환성
        });
      });

      // 채팅
      pickEvents(EVENT_ALIASES.chat, (event) => {
        socket.on(event, (message) => {
          // 레거시 형식 변환
          const payload = message && message.message && !message.text
            ? { 
                name: message.name, 
                text: message.message, 
                teamOnly: message.teamOnly, 
                teamKey: message.teamKey, 
                timestamp: message.timestamp 
              }
            : message;
          
          this._emit('chat:new', payload);
          this._emit('chat', payload); // 호환성
        });
      });

      // 페이즈/턴 변경
      pickEvents(EVENT_ALIASES.phaseChange, (event) => {
        socket.on(event, (data) => {
          this._emit('phase:change', data);
          
          if (this._notifyHandler && data?.phase) {
            const phaseName = data.phase === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
            this._notifyHandler('턴 변경', `${phaseName}의 턴입니다`);
          }
        });
      });

      // 전투 상태
      pickEvents(EVENT_ALIASES.battleStatus, (event) => {
        socket.on(event, (data) => {
          this._emit('battle:status', data);
          
          if (this._notifyHandler) {
            const statusMap = {
              'started': '전투 시작',
              'ended': '전투 종료',
              'paused': '전투 일시정지',
              'resumed': '전투 재개'
            };
            const title = statusMap[data.status] || '전투 상태 변경';
            this._notifyHandler(title, data.message || '');
          }
        });
      });

      // 액션 결과
      pickEvents(EVENT_ALIASES.actionOk, (event) => {
        socket.on(event, (result) => {
          this._emit('action:success', result);
          this._emit('actionSuccess', result); // 호환성
        });
      });

      pickEvents(EVENT_ALIASES.actionErr, (event) => {
        socket.on(event, (error) => {
          this._emit('action:error', error);
          this._emit('actionError', error); // 호환성
        });
      });

      // 관전자 응원
      pickEvents(EVENT_ALIASES.cheer, (event) => {
        socket.on(event, (data) => {
          this._emit('spectator:cheer', data);
        });
      });

      // 시스템 메시지
      pickEvents(EVENT_ALIASES.system, (event) => {
        socket.on(event, (data) => {
          this._emit('system:message', data);
        });
      });

      // 에러
      pickEvents(EVENT_ALIASES.error, (event) => {
        socket.on(event, (error) => {
          this._emit('error', error);
        });
      });
    }

    _autoReauth() {
      const ctx = this._roleContext;
      if (!ctx) return;

      setTimeout(() => {
        if (ctx.role === 'admin') {
          this.authenticateAsAdmin(ctx.battleId, ctx.otp);
        } else if (ctx.role === 'player') {
          this.authenticateAsPlayer(ctx.battleId, ctx.playerId, ctx.otp);
        } else if (ctx.role === 'spectator') {
          this.authenticateAsSpectator(ctx.battleId, ctx.otp, ctx.spectatorName);
        }
      }, 100);
    }

    _onVisibilityChange() {
      if (!document.hidden && !this.connected && !this.connecting) {
        console.log('[PyxisSocket] Page visible, attempting reconnection...');
        setTimeout(() => this._connect(), 1000);
      }
    }

    // ────────────────────────────────────────────────────────────────
    // 이벤트 시스템
    // ────────────────────────────────────────────────────────────────
    
    on(event, handler) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, new Set());
      }
      this._listeners.get(event).add(handler);
      return this;
    }

    off(event, handler) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).delete(handler);
      }
      return this;
    }

    once(event, handler) {
      const onceHandler = (...args) => {
        this.off(event, onceHandler);
        handler(...args);
      };
      return this.on(event, onceHandler);
    }

    _emit(event, data) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).forEach(handler => {
          try {
            handler(data);
          } catch (error) {
            console.error(`[PyxisSocket] Error in event handler for "${event}":`, error);
          }
        });
      }
    }

    // ────────────────────────────────────────────────────────────────
    // 인증 메소드들
    // ────────────────────────────────────────────────────────────────
    
    async authenticateAsAdmin(battleId, otp) {
      if (!battleId || !otp) {
        throw new Error('battleId와 otp가 필요합니다');
      }

      this._roleContext = { role: 'admin', battleId, otp };
      await this._ensureConnected();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('인증 타임아웃'));
        }, 10000);

        this.once('auth:success', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });

        this.once('auth:error', (error) => {
          clearTimeout(timeout);
          reject(new Error(error.message || '인증 실패'));
        });

        this.socket.emit('adminAuth', { battleId, otp });
      });
    }

    async authenticateAsPlayer(battleId, playerId, otp) {
      if (!battleId || !playerId || !otp) {
        throw new Error('battleId, playerId, otp가 모두 필요합니다');
      }

      this._roleContext = { role: 'player', battleId, playerId, otp };
      await this._ensureConnected();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('인증 타임아웃'));
        }, 10000);

        this.once('auth:success', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });

        this.once('auth:error', (error) => {
          clearTimeout(timeout);
          reject(new Error(error.message || '인증 실패'));
        });

        this.socket.emit('playerAuth', { battleId, playerId, otp });
      });
    }

    async authenticateAsSpectator(battleId, otp, spectatorName = '관전자') {
      if (!battleId || !otp) {
        throw new Error('battleId와 otp가 필요합니다');
      }

      this._roleContext = { role: 'spectator', battleId, otp, spectatorName };
      await this._ensureConnected();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('인증 타임아웃'));
        }, 10000);

        this.once('auth:success', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });

        this.once('auth:error', (error) => {
          clearTimeout(timeout);
          reject(new Error(error.message || '인증 실패'));
        });

        this.socket.emit('spectatorAuth', { battleId, otp, spectatorName });
      });
    }

    // ────────────────────────────────────────────────────────────────
    // 메시지 전송
    // ────────────────────────────────────────────────────────────────
    
    async sendChat(options) {
      const { text, channel = 'all', teamKey = null, battleId = null } = options;
      
      if (!text || !text.trim()) return;

      await this._ensureConnected();
      
      // 팀 채팅 접두사 처리
      const useTeamPrefix = channel === 'team' && !/^\s*\/t\b/i.test(text);
      const message = useTeamPrefix ? `/t ${text}` : text;

      const payload = {
        text: message,
        channel,
        teamKey,
        battleId,
        timestamp: Date.now()
      };

      this.socket.emit('chat:send', payload);
    }

    async sendAction(action, options = {}) {
      await this._ensureConnected();
      
      const payload = {
        action,
        ...options,
        timestamp: Date.now()
      };

      this.socket.emit('player:action', payload);
    }

    async sendCheer(message, team = null) {
      await this._ensureConnected();
      
      this.socket.emit('spectator:cheer', {
        message,
        team,
        timestamp: Date.now()
      });
    }

    // ────────────────────────────────────────────────────────────────
    // 유틸리티
    // ────────────────────────────────────────────────────────────────
    
    async _ensureConnected() {
      if (this.connected) return;
      if (this.connecting) {
        // 연결 완료까지 대기
        await new Promise((resolve) => {
          if (this.connected) return resolve();
          this.once('connection:success', resolve);
          setTimeout(resolve, 5000); // 타임아웃
        });
        return;
      }
      await this._connect();
    }

    // 알림 핸들러 설정
    onNotify(handler) {
      this._notifyHandler = typeof handler === 'function' ? handler : null;
    }

    // 연결 상태 확인
    isConnected() {
      return this.connected;
    }

    // 지연시간 확인
    getLatency() {
      return this._latency;
    }

    // 소켓 ID 확인
    getSocketId() {
      return this.socket?.id || null;
    }

    // 정리
    disconnect() {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      }
      
      this.connected = false;
      this.connecting = false;
      this.socket = null;
      this._roleContext = null;
      this._listeners.clear();
      this._eventQueue.length = 0;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 전역 인스턴스 생성
  // ════════════════════════════════════════════════════════════════════
  
  const PyxisSocketInstance = new PyxisSocket();

  // 전역 객체에 등록
  if (typeof global.PyxisSocket === 'undefined') {
    global.PyxisSocket = PyxisSocketInstance;
  }

  // CommonJS/AMD 호환성
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PyxisSocketInstance;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => PyxisSocketInstance);
  }

})(typeof window !== 'undefined' ? window : this);
