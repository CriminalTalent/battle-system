// BroadcastManager: 브로드캐스트 계층을 캡슐화 (선택 사용)
// - init(io) 로 초기화 후 instance 메서드로 송신
// - broadcast.js 의 함수형 API와 동일 동작

class BroadcastManager {
  /** @param {import('socket.io').Server} io */
  constructor(io) {
    this.io = io;
    this.isInitialized = false;
  }

  init(io, options = {}) {
    if (io) {
      this.io = io;
    }
    
    if (!this.io) {
      throw new Error('Socket.IO instance is required');
    }

    this.options = {
      verbose: false,
      enableMetrics: false,
      batchEnabled: false,
      ...options
    };

    this.metrics = {
      messagesSent: 0,
      errors: 0,
      lastActivity: Date.now()
    };

    this.isInitialized = true;

    if (this.options.verbose) {
      console.log('[BroadcastManager] Initialized with options:', this.options);
    }
  }

  room(battleId) { 
    return String(battleId || ""); 
  }

  _ensureInitialized() {
    if (!this.isInitialized || !this.io) {
      throw new Error('BroadcastManager not initialized. Call init() first.');
    }
  }

  _incrementMetrics(type = 'message') {
    if (this.options.enableMetrics) {
      if (type === 'error') {
        this.metrics.errors++;
      } else {
        this.metrics.messagesSent++;
      }
      this.metrics.lastActivity = Date.now();
    }
  }

  _safeEmit(roomId, event, data) {
    try {
      this._ensureInitialized();
      this.io.to(roomId).emit(event, data);
      this._incrementMetrics('message');
      return true;
    } catch (error) {
      console.error('[BroadcastManager] Emit error:', error);
      this._incrementMetrics('error');
      return false;
    }
  }

  // 전체 전투방에 브로드캐스트
  toAll(battleId, event, data) {
    if (!battleId || !event) return false;
    return this._safeEmit(this.room(battleId), event, data);
  }

  // 특정 팀에 브로드캐스트  
  toTeam(battleId, teamKey, event, data) {
    if (!battleId || !teamKey || !event) return false;
    const teamRoom = `battle:${battleId}:${teamKey}`;
    return this._safeEmit(teamRoom, event, data);
  }

  // 특정 역할에 브로드캐스트
  toRole(battleId, role, event, data) {
    if (!battleId || !role || !event) return false;
    const roleRoom = `battle:${battleId}:${role}`;
    return this._safeEmit(roleRoom, event, data);
  }

  // 소켓을 룸에 조인
  joinSocketToRooms(socket, battleId, role, teamAB, options = {}) {
    if (!socket || !battleId) return false;

    try {
      this._ensureInitialized();
      
      // 기본 배틀 룸
      socket.join(this.room(battleId));
      
      // 역할별 룸 (옵션)
      if (options.withRoleRooms && role) {
        socket.join(`battle:${battleId}:${role}`);
      }
      
      // 팀별 룸
      if (teamAB) {
        socket.join(`battle:${battleId}:${teamAB}`);
      }

      return true;
    } catch (error) {
      console.error('[BroadcastManager] joinSocketToRooms error:', error);
      return false;
    }
  }

  // 소켓을 룸에서 제거
  leaveSocketFromRooms(socket, battleId, role, teamAB) {
    if (!socket || !battleId) return false;

    try {
      this._ensureInitialized();
      
      socket.leave(this.room(battleId));
      
      if (role) {
        socket.leave(`battle:${battleId}:${role}`);
      }
      
      if (teamAB) {
        socket.leave(`battle:${battleId}:${teamAB}`);
      }

      return true;
    } catch (error) {
      console.error('[BroadcastManager] leaveSocketFromRooms error:', error);
      return false;
    }
  }

  // 전투 상태 브로드캐스트
  state(battle) {
    if (!battle?.id) return false;

    try {
      const players = Array.isArray(battle.players) ? battle.players : [];
      const logs = Array.isArray(battle.log) ? battle.log : [];
      
      const payload = {
        id: battle.id,
        status: battle.status || 'waiting',
        turn: battle.turn || 0,
        current: battle.current || null,
        startedAt: battle.startedAt || null,
        endedAt: battle.endedAt || null,
        turnEndsAt: battle.turnEndsAt || null,
        players: players.map(p => ({
          id: p?.id || '',
          name: p?.name || '',
          team: p?.team || '',
          hp: p?.hp || 0,
          ready: !!p?.ready,
          avatarUrl: p?.avatarUrl || '',
          stats: p?.stats || {}
        })).filter(p => p.id),
        log: logs.slice(-200)
      };

      return this.toAll(battle.id, "battle:update", payload);
    } catch (error) {
      console.error('[BroadcastManager] state error:', error);
      return false;
    }
  }

  // 새로운 통합 메서드들
  broadcastChat(battleId, msg) {
    if (!battleId || !msg) return false;
    
    const sanitizedMsg = {
      name: String(msg.name || '').substring(0, 50),
      message: String(msg.message || '').substring(0, 500),
      timestamp: msg.timestamp || Date.now(),
      ...msg
    };
    
    return this.toAll(battleId, "chat:new", sanitizedMsg);
  }

  broadcastLog(battleId, log) {
    if (!battleId || !log) return false;
    
    const sanitizedLog = {
      type: log.type || 'system',
      message: String(log.message || '').substring(0, 500),
      timestamp: log.timestamp || Date.now(),
      ...log
    };
    
    return this.toAll(battleId, "log:new", sanitizedLog);
  }

  broadcastTurnEvent(battleId, type, payload) {
    if (!battleId || !type) return false;
    return this.toAll(battleId, `turn:${type}`, payload || {});
  }

  broadcastBattleEvent(battleId, type, payload) {
    if (!battleId || !type) return false;
    return this.toAll(battleId, `battle:${type}`, payload || {});
  }

  broadcastBattleState(battleId, snapshot) {
    if (!battleId || !snapshot) return false;
    return this.toAll(battleId, "state:snapshot", snapshot);
  }

  // 기존 호환 메서드들
  log(battleId, { type = "system", message = "" }) {
    return this.broadcastLog(battleId, { type, message });
  }

  chat(battleId, { name = "", message = "" }) {
    return this.broadcastChat(battleId, { name, message });
  }

  spectators(battleId, count) {
    if (!battleId) return false;
    const sanitizedCount = Math.max(0, Number(count) || 0);
    return this.toAll(battleId, "spectator:count", { 
      count: sanitizedCount,
      timestamp: Date.now()
    });
  }

  // 시스템 통계
  getSystemStats() {
    if (!this.options.enableMetrics) {
      return { metricsDisabled: true };
    }

    return {
      ...this.metrics,
      isInitialized: this.isInitialized,
      options: this.options,
      uptime: Date.now() - (this.metrics.lastActivity || Date.now())
    };
  }

  // 정리
  destroy() {
    this.io = null;
    this.isInitialized = false;
    this.metrics = {
      messagesSent: 0,
      errors: 0,
      lastActivity: Date.now()
    };
    
    if (this.options?.verbose) {
      console.log('[BroadcastManager] Destroyed');
    }
  }
}

module.exports = {
  BroadcastManager,
  // 팩토리 함수
  init: (io, options) => {
    const manager = new BroadcastManager();
    manager.init(io, options);
    return manager;
  }
};
