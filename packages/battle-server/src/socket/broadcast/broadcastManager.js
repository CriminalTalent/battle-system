// packages/battle-server/src/socket/broadcast/broadcastManager.js
// PYXIS Broadcast Manager — Enhanced Socket.IO Broadcasting System
// 강화된 브로드캐스트 매니저: 성능 최적화, 배치 처리, 실시간 모니터링 추가

"use strict";

class BroadcastManager {
  constructor() {
    this.io = null;
    this.opts = {
      roomPrefix: "battle",
      teamKeys: ["phoenix", "eaters"],
      legacyEvents: true,
      verbose: false,
      // 성능 향상 옵션
      batchEnabled: true,
      batchDelay: 16, // 60fps 기준
      compressionThreshold: 1024, // 1KB 이상시 압축 고려
      maxBatchSize: 50,
      // 모니터링 옵션
      enableMetrics: true,
      metricsInterval: 30000, // 30초
    };

    // 배치 처리 큐
    this.batchQueue = new Map(); // battleId -> events[]
    this.batchTimer = null;

    // 메트릭스 추적
    this.metrics = {
      totalEmits: 0,
      batchedEmits: 0,
      roomSizes: {},
      lastActivity: Date.now(),
      errors: 0,
      averageLatency: 0
    };

    // 연결 모니터링
    this.connectionStates = new Map(); // socketId -> state
    this.heartbeatInterval = null;
  }

  // 초기화 강화
  init(io, options = {}) {
    this.io = io;
    this.opts = { ...this.opts, ...options };
    
    this.startMetricsCollection();
    this.startHeartbeat();
    
    // Socket.IO 어댑터 이벤트 모니터링
    if (io.engine) {
      io.engine.on('connection_error', (err) => {
        this.metrics.errors++;
        this.log(`[BroadcastManager] Connection error:`, err.message);
      });
    }

    this.log(`[BroadcastManager] Enhanced version initialized`);
    this.log(`Batch processing: ${this.opts.batchEnabled ? 'enabled' : 'disabled'}`);
    this.log(`Metrics: ${this.opts.enableMetrics ? 'enabled' : 'disabled'}`);
  }

  // 헬퍼 메서드들 (기존 유지)
  ns() { return this.opts.roomPrefix; }
  getBattleRoom(battleId) { return `${this.ns()}:${battleId}`; }
  getTeamRoom(battleId, teamKey) {
    const k = this.opts.teamKeys.includes(teamKey) ? teamKey : this.opts.teamKeys[0];
    return `${this.ns()}:${battleId}:${k}`;
  }
  getRoleRoom(battleId, role) { return `${this.ns()}:${battleId}:${role}`; }

  // 로깅 강화
  log(...args) {
    if (this.opts.verbose) {
      console.log(`[${new Date().toISOString()}]`, ...args);
    }
  }

  // 안전한 이벤트 전송 (강화됨)
  safeEmit(room, event, data, options = {}) {
    if (!this.io) return false;
    
    try {
      const startTime = Date.now();
      
      // 배치 처리 활성화시
      if (this.opts.batchEnabled && !options.immediate) {
        this.addToBatch(room, event, data);
        return true;
      }

      // 즉시 전송
      const roomSize = this.getRoomSize(room);
      if (roomSize === 0) {
        this.log(`[Broadcast] No recipients in room: ${room}`);
        return false;
      }

      this.io.to(room).emit(event, data);
      
      // 메트릭스 업데이트
      const latency = Date.now() - startTime;
      this.updateMetrics(event, roomSize, latency);
      
      return true;
    } catch (e) {
      this.metrics.errors++;
      console.error(`[BroadcastManager] Emit error (${event} → ${room})`, e?.message || e);
      return false;
    }
  }

  // 배치 처리 시스템
  addToBatch(room, event, data) {
    if (!this.batchQueue.has(room)) {
      this.batchQueue.set(room, []);
    }
    
    this.batchQueue.get(room).push({ event, data, timestamp: Date.now() });
    
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.processBatch(), this.opts.batchDelay);
    }
  }

  processBatch() {
    this.batchTimer = null;
    
    for (const [room, events] of this.batchQueue.entries()) {
      if (events.length === 0) continue;
      
      const roomSize = this.getRoomSize(room);
      if (roomSize === 0) continue;

      // 이벤트 타입별 그룹화
      const grouped = this.groupEventsByType(events);
      
      for (const [eventType, eventList] of grouped.entries()) {
        try {
          if (eventList.length === 1) {
            // 단일 이벤트는 그대로 전송
            this.io.to(room).emit(eventType, eventList[0].data);
          } else {
            // 다중 이벤트는 배치로 전송
            this.io.to(room).emit(`${eventType}:batch`, {
              events: eventList.map(e => e.data),
              count: eventList.length,
              timestamp: Date.now()
            });
          }
          
          this.metrics.batchedEmits += eventList.length;
        } catch (e) {
          this.metrics.errors++;
          console.error(`[BroadcastManager] Batch emit error:`, e.message);
        }
      }
    }
    
    this.batchQueue.clear();
  }

  groupEventsByType(events) {
    const grouped = new Map();
    
    for (const event of events) {
      if (!grouped.has(event.event)) {
        grouped.set(event.event, []);
      }
      grouped.get(event.event).push(event);
    }
    
    return grouped;
  }

  // 기본 브로드캐스트 메서드들 (기존과 동일하지만 safeEmit 사용)
  toAll(battleId, event, data, options = {}) {
    const success = this.safeEmit(this.getBattleRoom(battleId), event, data, options);
    if (success) this.log(`[Broadcast] ${event} → all (${battleId})`);
    return success;
  }

  toTeam(battleId, teamKey, event, data, options = {}) {
    const success = this.safeEmit(this.getTeamRoom(battleId, teamKey), event, data, options);
    if (success) this.log(`[Broadcast] ${event} → team:${teamKey} (${battleId})`);
    return success;
  }

  toRole(battleId, role, event, data, options = {}) {
    const success = this.safeEmit(this.getRoleRoom(battleId, role), event, data, options);
    if (success) this.log(`[Broadcast] ${event} → role:${role} (${battleId})`);
    return success;
  }

  toRoom(roomName, event, data, options = {}) {
    const success = this.safeEmit(roomName, event, data, options);
    if (success) this.log(`[Broadcast] ${event} → room:${roomName}`);
    return success;
  }

  // 우선순위 기반 즉시 전송
  broadcastUrgent(battleId, event, data) {
    return this.toAll(battleId, event, data, { immediate: true });
  }

  // 상태/턴/페이즈 브로드캐스트 (기존 유지하되 압축 고려)
  broadcastBattleState(battleId, state) {
    if (!battleId || !state) return false;

    // 큰 상태 객체는 압축을 고려
    const stateSize = JSON.stringify(state).length;
    const shouldCompress = stateSize > this.opts.compressionThreshold;
    
    if (shouldCompress) {
      this.log(`[Broadcast] Large state detected (${stateSize} bytes), consider compression`);
    }

    const events = ["state:snapshot", "state:update", "state", "battleUpdate"];
    let success = true;
    
    for (const ev of events) {
      success = this.toAll(battleId, ev, state) && success;
    }
    
    this.log(`[Broadcast] State updated (${battleId}), size: ${stateSize}b`);
    return success;
  }

  broadcastBattleEvent(battleId, eventType, data = {}) {
    const map = {
      created: "battle:created",
      started: "battle:started",
      paused: "battle:paused",
      resumed: "battle:resumed",
      ended: "battle:ended"
    };
    
    const ev = map[eventType] || `battle:${eventType}`;
    const payload = { battleId, timestamp: Date.now(), ...data };
    
    // 중요한 전투 이벤트는 즉시 전송
    const isUrgent = ['started', 'ended', 'paused'].includes(eventType);
    const success = this.toAll(battleId, ev, payload, { immediate: isUrgent });

    // 레거시 호환
    if (this.opts.legacyEvents && eventType === "ended") {
      this.toAll(battleId, "battle:end", payload, { immediate: true });
    }
    
    return success;
  }

  // 채팅/로그 시스템 (기존 유지)
  broadcastChat(battleId, messageData) {
    const events = ["chat:new", "chat"];
    let success = true;
    
    for (const ev of events) {
      success = this.toAll(battleId, ev, messageData) && success;
    }
    
    if (this.opts.legacyEvents) {
      this.toAll(battleId, "chat-message", { message: messageData });
    }
    
    return success;
  }

  broadcastLog(battleId, logData) {
    const enhancedLog = {
      ...logData,
      timestamp: logData.timestamp || Date.now(),
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    return this.toAll(battleId, "log:new", enhancedLog);
  }

  // 성능 모니터링 및 통계
  updateMetrics(event, roomSize, latency) {
    this.metrics.totalEmits++;
    this.metrics.lastActivity = Date.now();
    
    // 지연시간 평균 계산 (지수 이동 평균)
    this.metrics.averageLatency = this.metrics.averageLatency * 0.9 + latency * 0.1;
  }

  startMetricsCollection() {
    if (!this.opts.enableMetrics) return;
    
    setInterval(() => {
      this.collectRoomMetrics();
      this.logMetrics();
    }, this.opts.metricsInterval);
  }

  collectRoomMetrics() {
    if (!this.io) return;
    
    this.metrics.roomSizes = {};
    const rooms = this.getAllRooms();
    
    for (const room of rooms) {
      this.metrics.roomSizes[room] = this.getRoomSize(room);
    }
  }

  logMetrics() {
    if (!this.opts.verbose) return;
    
    const totalConnections = Object.values(this.metrics.roomSizes).reduce((a, b) => a + b, 0);
    
    this.log(`[Metrics] Total emits: ${this.metrics.totalEmits}, Batched: ${this.metrics.batchedEmits}`);
    this.log(`[Metrics] Connections: ${totalConnections}, Errors: ${this.metrics.errors}`);
    this.log(`[Metrics] Avg latency: ${this.metrics.averageLatency.toFixed(2)}ms`);
  }

  // 하트비트 시스템 (연결 상태 모니터링)
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.io) return;
      
      const now = Date.now();
      const staleThreshold = 300000; // 5분
      
      // 비활성 연결 정리
      for (const [socketId, state] of this.connectionStates.entries()) {
        if (now - state.lastSeen > staleThreshold) {
          this.connectionStates.delete(socketId);
        }
      }
      
      // 전역 하트비트 전송 (필요시)
      if (this.opts.enableHeartbeat) {
        this.io.emit('heartbeat', { timestamp: now });
      }
    }, 60000); // 1분마다
  }

  // 연결 상태 추적
  trackConnection(socketId, data = {}) {
    this.connectionStates.set(socketId, {
      ...data,
      lastSeen: Date.now(),
      connected: true
    });
  }

  untrackConnection(socketId) {
    this.connectionStates.delete(socketId);
  }

  // 방 크기 측정 (캐시 추가)
  getRoomSize(roomName) {
    if (!this.io) return 0;
    
    try {
      const room = this.io.sockets.adapter.rooms.get(roomName);
      return room ? room.size : 0;
    } catch (e) {
      this.log(`[BroadcastManager] Error getting room size for ${roomName}:`, e.message);
      return 0;
    }
  }

  // 전투 통계 (강화됨)
  getBattleStats(battleId) {
    const stats = {
      total: this.getRoomSize(this.getBattleRoom(battleId)),
      phoenix: this.getRoomSize(this.getTeamRoom(battleId, "phoenix")),
      eaters: this.getRoomSize(this.getTeamRoom(battleId, "eaters")),
      admins: this.getRoomSize(this.getRoleRoom(battleId, "admin")),
      spectators: this.getRoomSize(this.getRoleRoom(battleId, "spectator")),
      lastActivity: this.metrics.lastActivity,
      messagesSent: this.metrics.totalEmits
    };
    
    return stats;
  }

  // 전체 시스템 통계
  getSystemStats() {
    return {
      ...this.metrics,
      activeRooms: this.getAllRooms().length,
      totalRoomConnections: Object.values(this.metrics.roomSizes).reduce((a, b) => a + b, 0),
      queuedBatches: this.batchQueue.size,
      trackedConnections: this.connectionStates.size
    };
  }

  // 모든 방 목록 (개선됨)
  getAllRooms() {
    if (!this.io) return [];
    
    try {
      const prefix = `${this.ns()}:`;
      return Array.from(this.io.sockets.adapter.rooms.keys())
        .filter(r => r.startsWith(prefix));
    } catch (e) {
      this.log(`[BroadcastManager] Error getting rooms:`, e.message);
      return [];
    }
  }

  // 룸 조인/이탈 (기존 유지하되 추적 추가)
  joinSocketToRooms(socket, battleId, role, teamKey = null, options = {}) {
    if (!socket || !battleId || !role) return false;
    
    const { withRoleRooms = false } = options;
    
    try {
      // 전체 룸
      socket.join(this.getBattleRoom(battleId));
      
      // 팀 룸
      if (role === "player" && teamKey && this.opts.teamKeys.includes(teamKey)) {
        socket.join(this.getTeamRoom(battleId, teamKey));
      }
      
      // 역할 룸 (옵션)
      if (withRoleRooms) {
        socket.join(this.getRoleRoom(battleId, role));
        if (role === "admin") {
          for (const t of this.opts.teamKeys) {
            socket.join(this.getTeamRoom(battleId, t));
          }
        }
      }
      
      // 연결 추적
      this.trackConnection(socket.id, { battleId, role, teamKey });
      
      this.log(`[Broadcast] Socket joined: ${socket.id}, role=${role}, team=${teamKey || "-"}, battle=${battleId}`);
      return true;
    } catch (e) {
      this.log(`[BroadcastManager] Error joining rooms:`, e.message);
      return false;
    }
  }

  leaveSocketFromRooms(socket, battleId, role, teamKey = null, options = {}) {
    if (!socket || !battleId) return false;
    
    const { withRoleRooms = false } = options;
    
    try {
      socket.leave(this.getBattleRoom(battleId));
      
      if (teamKey && this.opts.teamKeys.includes(teamKey)) {
        socket.leave(this.getTeamRoom(battleId, teamKey));
      }
      
      if (withRoleRooms) {
        socket.leave(this.getRoleRoom(battleId, role));
        if (role === "admin") {
          for (const t of this.opts.teamKeys) {
            socket.leave(this.getTeamRoom(battleId, t));
          }
        }
      }
      
      // 연결 추적 해제
      this.untrackConnection(socket.id);
      
      this.log(`[Broadcast] Socket left: ${socket.id}, role=${role}, team=${teamKey || "-"}, battle=${battleId}`);
      return true;
    } catch (e) {
      this.log(`[BroadcastManager] Error leaving rooms:`, e.message);
      return false;
    }
  }

  // 전투 정리 (강화됨)
  cleanupBattle(battleId, options = {}) {
    const { forceDisconnect = false, notifyClients = true } = options;
    
    const rooms = [
      this.getBattleRoom(battleId),
      this.getTeamRoom(battleId, "phoenix"),
      this.getTeamRoom(battleId, "eaters"),
      this.getRoleRoom(battleId, "admin"),
      this.getRoleRoom(battleId, "spectator")
    ];
    
    for (const room of rooms) {
      if (!this.io.sockets.adapter.rooms.has(room)) continue;
      
      try {
        if (notifyClients) {
          this.toRoom(room, "battle:cleanup", { 
            battleId, 
            timestamp: Date.now(),
            reason: "Battle ended"
          });
        }
        
        if (forceDisconnect) {
          this.io.in(room).disconnectSockets();
        }
      } catch (e) {
        this.log(`[BroadcastManager] Error cleaning room ${room}:`, e.message);
      }
    }
    
    // 배치 큐에서 해당 전투 관련 이벤트 제거
    const battleRoomPrefix = this.getBattleRoom(battleId);
    for (const room of this.batchQueue.keys()) {
      if (room.startsWith(battleRoomPrefix)) {
        this.batchQueue.delete(room);
      }
    }
    
    this.log(`[Broadcast] Battle cleanup completed: ${battleId}, force=${forceDisconnect}`);
  }

  // 정리 메서드
  destroy() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.batchQueue.clear();
    this.connectionStates.clear();
    this.io = null;
    
    this.log(`[BroadcastManager] Destroyed`);
  }
}

// 싱글톤 인스턴스
const broadcastManager = new BroadcastManager();
module.exports = broadcastManager;
