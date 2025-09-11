// BroadcastManager: 브로드캐스트 계층 캡슐화 (신/구 이벤트 동시 지원)
// - init(io) 후 인스턴스 메서드 사용
// - 상태/로그/채팅/턴/관전자 카운트 모두 신·구 이벤트명으로 송신

"use strict";

/** @typedef {import('socket.io').Server} IOServer */

class BroadcastManager {
  /** @param {IOServer} [io] */
  constructor(io) {
    this.io = io || null;
    this.isInitialized = !!io;
    this.options = {
      verbose: false,
      enableMetrics: false,
      batchEnabled: false
    };
    this.metrics = {
      messagesSent: 0,
      errors: 0,
      lastActivity: Date.now()
    };
  }

  /** @param {IOServer} io */
  init(io, options = {}) {
    if (io) this.io = io;
    if (!this.io) throw new Error("Socket.IO instance is required");

    this.options = { ...this.options, ...options };
    this.isInitialized = true;

    if (this.options.verbose) {
      console.log("[BroadcastManager] Initialized", this.options);
    }
  }

  room(battleId) {
    return String(battleId || "");
  }

  _ensureInitialized() {
    if (!this.isInitialized || !this.io) {
      throw new Error("BroadcastManager not initialized. Call init() first.");
    }
  }

  _incrementMetrics(type = "message") {
    if (!this.options.enableMetrics) return;
    if (type === "error") this.metrics.errors++;
    else this.metrics.messagesSent++;
    this.metrics.lastActivity = Date.now();
  }

  _safeEmit(roomId, event, data) {
    try {
      this._ensureInitialized();
      this.io.to(roomId).emit(event, data);
      this._incrementMetrics("message");
      return true;
    } catch (err) {
      console.error("[BroadcastManager] Emit error:", err);
      this._incrementMetrics("error");
      return false;
    }
  }

  // =============== 공통 송신기 ===============
  toAll(battleId, event, data) {
    if (!battleId || !event) return false;
    return this._safeEmit(this.room(battleId), event, data);
  }
  toTeam(battleId, teamKey, event, data) {
    if (!battleId || !teamKey || !event) return false;
    return this._safeEmit(`battle:${battleId}:${teamKey}`, event, data);
  }
  toRole(battleId, role, event, data) {
    if (!battleId || !role || !event) return false;
    return this._safeEmit(`battle:${battleId}:${role}`, event, data);
  }

  // =============== 룸 조인/이탈 ===============
  joinSocketToRooms(socket, battleId, role, teamAB, options = {}) {
    if (!socket || !battleId) return false;
    try {
      this._ensureInitialized();
      socket.join(this.room(battleId));
      if (options.withRoleRooms && role) socket.join(`battle:${battleId}:${role}`);
      if (teamAB) socket.join(`battle:${battleId}:${teamAB}`);
      return true;
    } catch (e) {
      console.error("[BroadcastManager] joinSocketToRooms error:", e);
      return false;
    }
  }
  leaveSocketFromRooms(socket, battleId, role, teamAB) {
    if (!socket || !battleId) return false;
    try {
      this._ensureInitialized();
      socket.leave(this.room(battleId));
      if (role) socket.leave(`battle:${battleId}:${role}`);
      if (teamAB) socket.leave(`battle:${battleId}:${teamAB}`);
      return true;
    } catch (e) {
      console.error("[BroadcastManager] leaveSocketFromRooms error:", e);
      return false;
    }
  }

  // =============== 상태 스냅샷 ===============
  /**
   * 전투 상태 전체 브로드캐스트
   * - 신: "battle:update"
   * - 구: "battleUpdate"
   */
  state(battle, extra = {}) {
    if (!battle?.id) return false;

    const players = Array.isArray(battle.players) ? battle.players : [];
    const logs = Array.isArray(battle.log) ? battle.log : [];

    // 엔진(turn 객체)과 레거시(turn number/current) 모두 전송
    const payload = {
      ...battle,
      id: battle.id,
      status: battle.status || "waiting",
      // 엔진형 turn 동봉 (round/order/phase 등)
      turn: battle.turn || battle.turn === 0 ? battle.turn : undefined,
      // 레거시 호환 필드
      current: battle.current ?? null,
      startedAt: battle.startedAt ?? null,
      endedAt: battle.endedAt ?? null,
      turnEndsAt: battle.turnEndsAt ?? null,
      players: players.map(p => ({
        id: p?.id || "",
        name: p?.name || "",
        team: p?.team || "",
        hp: Number(p?.hp || 0),
        ready: !!p?.ready,
        avatar: p?.avatar || p?.avatarUrl || "",
        stats: p?.stats || {}
      })).filter(p => p.id),
      log: logs.slice(-200),
      ...extra
    };

    const roomId = this.room(battle.id);
    return (
      this._safeEmit(roomId, "battle:update", payload) &
      this._safeEmit(roomId, "battleUpdate", payload)
    );
  }

  // 관리자 델타(meta) 전용
  admin(battleId, data) {
    if (!battleId) return false;
    return this.toAll(battleId, "admin:update", data || {});
  }

  // =============== 종료 알림 ===============
  /**
   * - 신: "battle:ended"
   */
  ended(battleId, result) {
    if (!battleId) return false;
    return this.toAll(battleId, "battle:ended", result || {});
  }

  // =============== 로그 & 채팅 ===============
  /**
   * 전투 로그 1건
   * - 신: "battle:log"
   * - 구: "battleLog"
   * - 추가 신식: "log:new" (선택)
   */
  log(battleId, { type = "system", message = "", ts, timestamp } = {}) {
    if (!battleId) return false;
    const entry = {
      type,
      message: String(message).substring(0, 500),
      ts: ts || timestamp || Date.now()
    };
    const roomId = this.room(battleId);
    const a = this._safeEmit(roomId, "battle:log", entry);
    const b = this._safeEmit(roomId, "battleLog", entry);
    const c = this._safeEmit(roomId, "log:new", { ...entry, timestamp: entry.ts });
    return a && b && c;
  }

  /**
   * 채팅
   * - 구: "chatMessage" { senderName, message }
   * - 신: "chat:message" { senderName, message }
   * - 추가 신식: "chat:new" { name, message, timestamp }
   */
  chat(battleId, { name = "", senderName, message = "", timestamp } = {}) {
    if (!battleId) return false;
    const sender = (senderName || name || "익명").toString().substring(0, 50);
    const msg = message.toString().substring(0, 500);
    const ts = timestamp || Date.now();
    const roomId = this.room(battleId);

    const payloadLegacy = { senderName: sender, message: msg };
    const payloadNew = { senderName: sender, message: msg };
    const payloadNewest = { name: sender, message: msg, timestamp: ts };

    const a = this._safeEmit(roomId, "chatMessage", payloadLegacy);
    const b = this._safeEmit(roomId, "chat:message", payloadNew);
    const c = this._safeEmit(roomId, "chat:new", payloadNewest);
    return a && b && c;
  }

  // =============== 관전자 카운트 ===============
  /**
   * - 신: "spectator:count_update" { count }
   * - 구: "spectatorCountUpdate"   { count }
   * - 추가 신식: "spectator:count" { count, timestamp }
   */
  spectators(battleId, count) {
    if (!battleId) return false;
    const c = Math.max(0, Number(count) || 0);
    const roomId = this.room(battleId);

    const a = this._safeEmit(roomId, "spectator:count_update", { count: c });
    const b = this._safeEmit(roomId, "spectatorCountUpdate", { count: c });
    const d = this._safeEmit(roomId, "spectator:count", { count: c, timestamp: Date.now() });
    return a && b && d;
  }

  // =============== 턴/페이즈 이벤트 ===============
  /**
   * 턴 시작 힌트
   * - 신: "turn:start"
   * data 예: { playerId, phaseTeam: "A"|"B", round, order }
   */
  turnStart(battleId, data) {
    if (!battleId) return false;
    return this.toAll(battleId, "turn:start", data || {});
  }

  /**
   * 턴 종료 힌트
   * - 신: "turn:end"
   * data 예: { teamPhaseCompleted, roundCompleted }
   */
  turnEnd(battleId, data) {
    if (!battleId) return false;
    return this.toAll(battleId, "turn:end", data || {});
  }

  // =============== 스냅샷(선택) ===============
  snapshot(battleId, snapshot) {
    if (!battleId || !snapshot) return false;
    return this.toAll(battleId, "state:snapshot", snapshot);
  }

  // =============== 시스템 통계/정리 ===============
  getSystemStats() {
    if (!this.options.enableMetrics) return { metricsDisabled: true };
    return {
      ...this.metrics,
      isInitialized: this.isInitialized,
      options: this.options,
      uptime: Date.now() - (this.metrics.lastActivity || Date.now())
    };
  }

  destroy() {
    this.io = null;
    this.isInitialized = false;
    this.metrics = { messagesSent: 0, errors: 0, lastActivity: Date.now() };
    if (this.options.verbose) console.log("[BroadcastManager] Destroyed");
  }
}

module.exports = {
  BroadcastManager,
  init: (io, options) => {
    const manager = new BroadcastManager();
    manager.init(io, options);
    return manager;
  }
};
