// packages/battle-server/src/socket/broadcast/broadcastManager.js
// PYXIS Broadcast Manager — Enhanced Socket.IO Broadcasting System
// 강화된 브로드캐스트 매니저: 성능 최적화, 배치 처리, 실시간 모니터링 추가

"use strict";

class BroadcastManager {
  constructor() {
    this.io = null;
    this.initialized = false; // ← 추가: init 여부 노출
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
      // 하트비트
      enableHeartbeat: false,
    };

    // 배치 처리 큐
    this.batchQueue = new Map(); // roomName -> events[]
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

  // 초기화 (idemponent)
  init(io, options = {}) {
    if (this.initialized && this.io === io) {
      // 이미 같은 io로 초기화된 경우: 옵션만 병합
      this.opts = { ...this.opts, ...options };
      this.log(`[BroadcastManager] options merged (already initialized)`);
      return;
    }

    this.io = io;
    this.opts = { ...this.opts, ...options };
    this.initialized = true;

    this.startMetricsCollection();
    this.startHeartbeat();

    // Socket.IO 어댑터 이벤트 모니터링
    if (io?.engine) {
      io.engine.on('connection_error', (err) => {
        this.metrics.errors++;
        this.log(`[BroadcastManager] Connection error:`, err.message);
      });
    }

    this.log(`[BroadcastManager] Enhanced version initialized`);
    this.log(`Batch processing: ${this.opts.batchEnabled ? 'enabled' : 'disabled'}`);
    this.log(`Metrics: ${this.opts.enableMetrics ? 'enabled' : 'disabled'}`);
  }

  // 헬퍼 메서드들
  ns() { return this.opts.roomPrefix; }
  getBattleRoom(battleId) { return `${this.ns()}:${battleId}`; }
  getTeamRoom(battleId, teamKey) {
    const k = this.opts.teamKeys.includes(teamKey) ? teamKey : this.opts.teamKeys[0];
    return `${this.ns()}:${battleId}:${k}`;
  }
  getRoleRoom(battleId, role) { return `${this.ns()}:${battleId}:${role}`; }

  // 로깅
  log(...args) {
    if (this.opts.verbose) {
      console.log(`[${new Date().toISOString()}]`, ...args);
    }
  }

  // 안전한 이벤트 전송
  safeEmit(room, event, data, options = {}) {
    if (!this.io) return false;

    try {
      const startTime = Date.now();

      // 배치 처리
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

      const latency = Date.now() - startTime;
      this.updateMetrics(event, roomSize, latency);
      return true;
    } catch (e) {
      this.metrics.errors++;
      console.error(`[BroadcastManager] Emit error (${event} → ${room})`, e?.message || e);
      return false;
    }
  }

  // 배치 처리
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

      const grouped = this.groupEventsByType(events);

      for (const [eventType, eventList] of grouped.entries()) {
        try {
          if (eventList.length === 1) {
            this.io.to(room).emit(eventType, eventList[0].data);
          } else {
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
      if (!grouped.has(event.event)) grouped.set(event.event, []);
      grouped.get(event.event).push(event);
    }
    return grouped;
  }

  // 기본 브로드캐스트
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

  broadcastUrgent(battleId, event, data) {
    return this.toAll(battleId, event, data, { immediate: true });
  }

  // 상태 브로드캐스트
  broadcastBattleState(battleId, state) {
    if (!battleId || !state) return false;

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

  // 전투 이벤트
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

    const isUrgent = ['started', 'ended', 'paused'].includes(eventType);
    const success = this.toAll(battleId, ev, payload, { immediate: isUrgent });

    if (this.opts.legacyEvents && eventType === "ended") {
      this.toAll(battleId, "battle:end", payload, { immediate: true });
    }
    return success;
  }

  // ✅ 추가: 턴 이벤트 브로드캐스트 (battle-handlers, broadcast.js에서 사용)
  broadcastTurnEvent(battleId, type, data = {}) {
    const map = {
      start: "turn:start",
      update: "turn:update",
      next: "turn:next",
      end: "turn:end",
      timeout: "turn:timeout",
      swap: "turn:swap"
    };
    const ev = map[type] ? map[type] : `turn:${type}`;
    const urgent = ['start', 'end', 'timeout'].includes(type);

    const payload = { battleId, timestamp: Date.now(), ...data };
    const ok = this.toAll(battleId, ev, payload, { immediate: urgent });

    // 레거시 호환
    if (this.opts.legacyEvents && type === 'update') {
      this.toAll(battleId, 'turn', payload);
    }

    return ok;
  }

  // ✅ 추가: 플레이어 이벤트 브로드캐스트 (socketHandlers 등에서 사용)
  broadcastPlayerEvent(battleId, type, data = {}) {
    const map = {
      join: "player:joined",
      leave: "player:left",
      update: "player:updated",
      action: "player:action",
      ready: "player:ready",
      reconnect: "player:reconnect",
      disconnect: "player:disconnect"
    };
    const ev = map[type] ? map[type] : `player:${type}`;
    const urgent = ['join', 'leave', 'disconnect', 'reconnect'].includes(type);

    const payload = { battleId, timestamp: Date.now(), ...data };
    const ok = this.toAll(battleId, ev, payload, { immediate: urgent });

    // 팀 지정 시 팀 룸에도 보냄(선택)
    if (data.team && this.opts.teamKeys.includes(data.team)) {
      this.toTeam(battleId, data.team, ev, payload, { immediate: urgent });
    }

    // 레거시 호환 채널
    if (this.opts.legacyEvents && type === 'action') {
      this.toAll(battleId, 'action', payload);
    }

    return ok;
  }

  // 채팅/로그
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

  // 성능 모니터링
  updateMetrics(event, roomSize, latency) {
    this.metrics.totalEmits++;
    this.metrics.lastActivity = Date.now();
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

  // 하트비트
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      if (!this.io) return;

      const now = Date.now();
      const staleThreshold = 300000; // 5분

      for (const [socketId, state] of this.connectionStates.entries()) {
        if (now - state.lastSeen > staleThreshold) {
          this.connectionStates.delete(socketId);
        }
      }

      if (this.opts.enableHeartbeat) {
        this.io.emit('heartbeat', { timestamp: now });
      }
    }, 60000);
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

  // 방/룸
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

  getBattleStats(battleId) {
    return {
      total: this.getRoomSize(this.getBattleRoom(battleId)),
      phoenix: this.getRoomSize(this.getTeamRoom(battleId, "phoenix")),
      eaters: this.getRoomSize(this.getTeamRoom(battleId, "eaters")),
      admins: this.getRoomSize(this.getRoleRoom(battleId, "admin")),
      spectators: this.getRoomSize(this.getRoleRoom(battleId, "spectator")),
      lastActivity: this.metrics.lastActivity,
      messagesSent: this.metrics.totalEmits
    };
  }

  getSystemStats() {
    return {
      ...this.metrics,
      activeRooms: this.getAllRooms().length,
      totalRoomConnections: Object.values(this.metrics.roomSizes).reduce((a, b) => a + b, 0),
      queuedBatches: this.batchQueue.size,
      trackedConnections: this.connectionStates.size
    };
  }

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

  // 룸 조인/이탈
  joinSocketToRooms(socket, battleId, role, teamKey = null, options = {}) {
    if (!socket || !battleId || !role) return false;

    const { withRoleRooms = false } = options;

    try {
      socket.join(this.getBattleRoom(battleId));

      if (role === "player" && teamKey && this.opts.teamKeys.includes(teamKey)) {
        socket.join(this.getTeamRoom(battleId, teamKey));
      }

      if (withRoleRooms) {
        socket.join(this.getRoleRoom(battleId, role));
        if (role === "admin") {
          for (const t of this.opts.teamKeys) {
            socket.join(this.getTeamRoom(battleId, t));
          }
        }
      }

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

      this.untrackConnection(socket.id);

      this.log(`[Broadcast] Socket left: ${socket.id}, role=${role}, team=${teamKey || "-"}, battle=${battleId}`);
      return true;
    } catch (e) {
      this.log(`[BroadcastManager] Error leaving rooms:`, e.message);
      return false;
    }
  }

  // 전투 정리
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

  // 정리
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
    this.initialized = false;

    this.log(`[BroadcastManager] Destroyed`);
  }
}

// 싱글톤 인스턴스
const broadcastManager = new BroadcastManager();
module.exports = broadcastManager;
