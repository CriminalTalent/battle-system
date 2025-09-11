// BroadcastManager: 브로드캐스트 계층 캡슐화
// - init(io)로 초기화 후 인스턴스 메서드로 송신
// - 공개 스냅샷 정제 및 이벤트 명칭 통일
"use strict";

class BroadcastManager {
  /** @param {import('socket.io').Server} io */
  constructor(io) {
    this.io = io || null;
    this.isInitialized = false;
    this.options = {
      verbose: false,
      enableMetrics: false,
      batchEnabled: false,
    };
    this.metrics = {
      messagesSent: 0,
      errors: 0,
      lastActivity: Date.now(),
    };
  }

  init(io, options = {}) {
    if (io) this.io = io;
    if (!this.io) throw new Error("Socket.IO instance is required");

    this.options = { ...this.options, ...options };
    this.isInitialized = true;
    if (this.options.verbose) {
      console.log("[BroadcastManager] Initialized", this.options);
    }
  }

  /* ========== 룸 규칙 ========== */
  room(battleId) {
    const id = String(battleId || "").trim();
    return `battle:${id}`;
  }
  teamRoom(battleId, teamAB) {
    return `${this.room(battleId)}:${teamAB}`; // teamAB: "A" | "B"
  }
  roleRoom(battleId, role) {
    return `${this.room(battleId)}:${role}`; // role: "admin" | "player" | "spectator"
  }

  _ensureInitialized() {
    if (!this.isInitialized || !this.io) {
      throw new Error("BroadcastManager not initialized. Call init() first.");
    }
  }

  _incrementMetrics(type = "message") {
    if (!this.options.enableMetrics) return;
    if (type === "error") this.metrics.errors += 1;
    else this.metrics.messagesSent += 1;
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

  /* ========== 공개 스냅샷 정제 ========== */
  _pickPlayerPublic(p) {
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      team: p.team, // "phoenix" | "eaters"
      stats: {
        atk: p?.stats?.atk,
        def: p?.stats?.def,
        agi: p?.stats?.agi,
        luk: p?.stats?.luk,
      },
      hp: p.hp,
      ready: !!p.ready,
      avatarUrl: p.avatarUrl || null,
    };
  }

  _pickBattlePublic(battle) {
    if (!battle) return null;
    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status, // waiting | active | paused | ended
      startedAt: battle.startedAt || null,
      endedAt: battle.endedAt || null,

      // 라운드/페이즈 구조 그대로 전달 (엔진에서 채워둔 객체)
      turn: battle.turn || null, // { round, order:["A","B"], phaseIndex, acted:{A:Set,B:Set} 등 직렬화 주의
      current: battle.current || null, // 레거시 호환(현재 페이즈 팀키 "phoenix"|"eaters")

      players: Array.isArray(battle.players)
        ? battle.players.map(this._pickPlayerPublic).filter(Boolean)
        : [],

      // 최근 로그 일부만
      log: Array.isArray(battle.log) ? battle.log.slice(-100) : [],
    };
  }

  /* ========== 기본 브로드캐스트 ========== */
  toAll(battleId, event, data) {
    if (!battleId || !event) return false;
    return this._safeEmit(this.room(battleId), event, data);
  }
  toTeam(battleId, teamAB, event, data) {
    if (!battleId || !teamAB || !event) return false;
    return this._safeEmit(this.teamRoom(battleId, teamAB), event, data);
  }
  toRole(battleId, role, event, data) {
    if (!battleId || !role || !event) return false;
    return this._safeEmit(this.roleRoom(battleId, role), event, data);
  }

  /* ========== 소켓 룸 입퇴장 ========== */
  joinSocketToRooms(socket, battleId, { role, teamAB, withRoleRooms = true } = {}) {
    if (!socket || !battleId) return false;
    try {
      this._ensureInitialized();
      socket.join(this.room(battleId));
      if (withRoleRooms && role) socket.join(this.roleRoom(battleId, role));
      if (teamAB) socket.join(this.teamRoom(battleId, teamAB));
      return true;
    } catch (err) {
      console.error("[BroadcastManager] joinSocketToRooms error:", err);
      return false;
    }
  }
  leaveSocketFromRooms(socket, battleId, { role, teamAB } = {}) {
    if (!socket || !battleId) return false;
    try {
      this._ensureInitialized();
      socket.leave(this.room(battleId));
      if (role) socket.leave(this.roleRoom(battleId, role));
      if (teamAB) socket.leave(this.teamRoom(battleId, teamAB));
      return true;
    } catch (err) {
      console.error("[BroadcastManager] leaveSocketFromRooms error:", err);
      return false;
    }
  }

  /* ========== 도메인 이벤트(명칭 통일) ========== */
  emitBattleUpdate(battle) {
    if (!battle?.id) return false;
    try {
      const payload = this._pickBattlePublic(battle);

      // turn.acted가 Set이면 직렬화 보정
      if (payload?.turn?.acted) {
        const acted = payload.turn.acted;
        payload.turn.acted = {
          A: Array.isArray(acted.A) ? acted.A : Array.from(acted.A || []),
          B: Array.isArray(acted.B) ? acted.B : Array.from(acted.B || []),
        };
      }
      return this.toAll(battle.id, "battleUpdate", payload);
    } catch (err) {
      console.error("[BroadcastManager] emitBattleUpdate error:", err);
      return false;
    }
  }

  emitSystem(battleId, payload) {
    return this.toAll(battleId, "systemMessage", {
      ts: Date.now(),
      ...(payload || {}),
    });
  }

  pushLogAndBroadcast(battle, entry) {
    if (!battle?.id) return false;
    const log = {
      type: entry?.type || "system",
      message: String(entry?.message || "").slice(0, 500),
      ts: entry?.ts || Date.now(),
      ...entry,
    };
    try {
      battle.log = battle.log || [];
      battle.log.push(log);
      if (battle.log.length > 500) {
        battle.log.splice(0, battle.log.length - 500);
      }
    } catch (e) {
      // 로컬 로그 실패해도 브로드캐스트는 시도
    }
    return this.toAll(battle.id, "logMessage", log);
  }

  emitChat(battleId, msg) {
    if (!battleId || !msg) return false;
    const sanitized = {
      senderRole: String(msg.senderRole || "").slice(0, 16), // admin|player|spectator
      senderName: String(msg.senderName || "").slice(0, 50),
      text: String(msg.text || "").slice(0, 500),
      ts: msg.ts || Date.now(),
    };
    return this.toAll(battleId, "chatMessage", sanitized);
  }

  emitCheer(battleId, payload) {
    if (!battleId || !payload) return false;
    const sanitized = {
      spectatorName: String(payload.spectatorName || "").slice(0, 50),
      cheerText: String(payload.cheerText || "").slice(0, 200),
      ts: payload.ts || Date.now(),
    };
    return this.toAll(battleId, "cheerMessage", sanitized);
  }

  emitRoundResult(battle, summary) {
    if (!battle?.id || !summary) return false;
    const payload = {
      round: summary.round,
      damageMatrix: summary.damageMatrix || null,
      koList: Array.isArray(summary.koList) ? summary.koList : [],
      notes: String(summary.notes || ""),
      ts: Date.now(),
    };
    return this.toAll(battle.id, "roundResult", payload);
  }

  emitError(battleId, error) {
    return this.toAll(battleId, "errorMessage", {
      ts: Date.now(),
      message: (error && error.message) ? String(error.message) : String(error || ""),
    });
  }

  /* ========== 호환 메서드(기존 호출 보전) ========== */
  // 기존 코드에서 사용 중일 수 있는 별칭들
  toAllEvent(battleId, event, data) { return this.toAll(battleId, event, data); }
  broadcastBattleEvent(battleId, type, payload) {
    return this.toAll(battleId, `battle:${type}`, payload || {});
  }
  broadcastTurnEvent(battleId, type, payload) {
    return this.toAll(battleId, `turn:${type}`, payload || {});
  }
  broadcastBattleState(battleId, snapshot) {
    return this.toAll(battleId, "state:snapshot", snapshot);
  }
  log(battleId, { type = "system", message = "" }) {
    return this.pushLogAndBroadcast({ id: battleId, log: [] }, { type, message });
  }
  chat(battleId, { name = "", message = "" }) {
    return this.emitChat(battleId, { senderName: name, text: message });
  }
  spectators(battleId, count) {
    const c = Math.max(0, Number(count) || 0);
    return this.toAll(battleId, "spectator:count", { count: c, ts: Date.now() });
  }

  /* ========== 시스템 상태 ========== */
  getSystemStats() {
    if (!this.options.enableMetrics) return { metricsDisabled: true };
    return {
      ...this.metrics,
      isInitialized: this.isInitialized,
      options: this.options,
      uptime: Date.now() - (this.metrics.lastActivity || Date.now()),
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
  },
};
