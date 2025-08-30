// packages/battle-server/src/socket/broadcast/broadcastManager.js
// PYXIS Broadcast Manager — Socket.IO 브로드캐스트 유틸(강화본)
// - 룸 규칙: battle:<id>, battle:<id>:phoenix|eaters, 역할 룸은 사용 안 함(필요시 옵션)
// - 이벤트 멀티 네이밍(레거시 호환) 지원
// - 안전 전송(safeEmit), 옵션형 로깅, 룸 통계/정리, 팀 룸 재배치 유틸

"use strict";

class BroadcastManager {
  constructor() {
    this.io = null;
    this.opts = {
      roomPrefix: "battle",            // 최상위 룸 prefix (콜론 네임스페이스)
      teamKeys: ["phoenix", "eaters"], // 팀 키
      legacyEvents: true,              // 레거시 이벤트 동시 송신
      verbose: false                   // 콘솔 로깅
    };
  }

  // ───────────────────────── 초기화 ─────────────────────────
  init(io, options = {}) {
    this.io = io;
    this.opts = { ...this.opts, ...options };
    this.log(`[BroadcastManager] initialized (prefix=${this.opts.roomPrefix})`);
  }

  // ───────────────────────── 헬퍼/룸 ─────────────────────────
  ns() { return this.opts.roomPrefix; }

  // 전체 전투 룸: battle:<id>
  getBattleRoom(battleId) {
    return `${this.ns()}:${battleId}`;
  }

  // 팀 룸: battle:<id>:phoenix|eaters
  getTeamRoom(battleId, teamKey) {
    const k = this.opts.teamKeys.includes(teamKey) ? teamKey : this.opts.teamKeys[0];
    return `${this.ns()}:${battleId}:${k}`;
  }

  // (선택) 역할 룸이 필요할 때만 사용
  getRoleRoom(battleId, role) {
    return `${this.ns()}:${battleId}:${role}`;
  }

  // ───────────────────────── 내부 공용 ─────────────────────────
  log(...args) {
    if (this.opts.verbose) console.log(...args);
  }

  safeEmit(room, event, data) {
    if (!this.io) return;
    try {
      this.io.to(room).emit(event, data);
    } catch (e) {
      console.error(`[BroadcastManager] emit error (${event} → ${room})`, e?.message || e);
    }
  }

  toAll(battleId, event, data) {
    this.safeEmit(this.getBattleRoom(battleId), event, data);
    this.log(`[Broadcast] ${event} → all (${battleId})`);
  }

  toTeam(battleId, teamKey, event, data) {
    this.safeEmit(this.getTeamRoom(battleId, teamKey), event, data);
    this.log(`[Broadcast] ${event} → team:${teamKey} (${battleId})`);
  }

  toRole(battleId, role, event, data) {
    this.safeEmit(this.getRoleRoom(battleId, role), event, data);
    this.log(`[Broadcast] ${event} → role:${role} (${battleId})`);
  }

  toRoom(roomName, event, data) {
    this.safeEmit(roomName, event, data);
    this.log(`[Broadcast] ${event} → room:${roomName}`);
  }

  // ───────────────────────── 상태/턴/페이즈 ─────────────────────────
  broadcastBattleState(battleId, state) {
    if (!battleId || !state) return;
    // 신/구 이벤트 병행
    const events = ["state:snapshot", "state:update", "state", "battleUpdate"];
    for (const ev of events) this.toAll(battleId, ev, state);
    this.log(`[Broadcast] state updated (${battleId})`);
  }

  broadcastBattleEvent(battleId, eventType, data = {}) {
    const map = {
      created: "battle:created",
      started: "battle:started",
      paused:  "battle:paused",
      resumed: "battle:resumed",
      ended:   "battle:ended"
    };
    const ev = map[eventType] || `battle:${eventType}`;
    const payload = { battleId, timestamp: Date.now(), ...data };
    this.toAll(battleId, ev, payload);

    // 레거시 호환
    if (this.opts.legacyEvents && eventType === "ended") {
      this.toAll(battleId, "battle:end", payload);
    }
  }

  broadcastPhaseChange(battleId, phaseData) {
    this.toAll(battleId, "phase:change", phaseData);
  }

  broadcastTurnEvent(battleId, type, turnData) {
    // type: "update" | "begin" | "end" 등
    this.toAll(battleId, `turn:${type}`, turnData);
    if (type === "update" && typeof turnData?.turn === "number") {
      // 일부 클라가 turn:update만 듣는 경우 대비
      this.toAll(battleId, "turn:update", turnData);
    }
  }

  // ───────────────────────── 채팅/응원/공지/로그 ─────────────────────────
  broadcastChat(battleId, messageData) {
    // 신/구 이벤트 병행
    const events = ["chat:new", "chat"];
    for (const ev of events) this.toAll(battleId, ev, messageData);
    if (this.opts.legacyEvents) {
      this.toAll(battleId, "chat-message", { message: messageData });
    }
  }

  broadcastTeamChat(battleId, teamKey, messageData) {
    // 팀/관리자에게만
    const events = ["chat:new", "chat"];
    for (const ev of events) {
      this.toTeam(battleId, teamKey, ev, messageData);
      this.toRole(battleId, "admin", ev, messageData);
    }
    if (this.opts.legacyEvents) {
      this.toTeam(battleId, teamKey, "chat-message", { message: messageData });
      this.toRole(battleId, "admin", "chat-message", { message: messageData });
    }
  }

  broadcastCheer(battleId, cheerData) {
    this.toAll(battleId, "spectator:cheer", cheerData);
    // 채팅 채널로도 노출 (형식 통일)
    const chat = {
      ...cheerData,
      type: "cheer",
      message: `[응원] ${cheerData.cheer}`,
      timestamp: Date.now()
    };
    this.broadcastChat(battleId, chat);
  }

  broadcastNotice(battleId, noticeData) {
    // 신/구 이벤트 병행
    this.toAll(battleId, "notice:update", noticeData);
    if (this.opts.legacyEvents) this.toAll(battleId, "noticeUpdate", noticeData);
  }

  broadcastLog(battleId, logData) {
    // logData: { text, type?, timestamp? }
    this.toAll(battleId, "log:new", logData);
  }

  broadcastTimer(battleId, timerData) {
    this.toAll(battleId, "timer:sync", timerData);
  }

  // ───────────────────────── 플레이어/관전자/액션 ─────────────────────────
  broadcastPlayerEvent(battleId, eventType, playerData) {
    // eventType: "join" | "leave" | "update" 등
    this.toAll(battleId, `player:${eventType}`, playerData);
  }

  broadcastSpectatorEvent(battleId, eventType, spectatorData) {
    this.toAll(battleId, `spectator:${eventType}`, spectatorData);
  }

  broadcastActionResult(battleId, result, isSuccess = true) {
    const ev = isSuccess ? "action:success" : "action:error";
    this.toAll(battleId, ev, result);
    if (this.opts.legacyEvents) {
      this.toAll(battleId, isSuccess ? "actionSuccess" : "actionError", result);
    }
  }

  // ───────────────────────── 알림/에러 ─────────────────────────
  notifyAdmins(battleId, message, data = {}) {
    this.toRole(battleId, "admin", "admin:notification", {
      message,
      timestamp: Date.now(),
      ...data
    });
  }

  broadcastSystemMessage(battleId, message, level = "info") {
    const sys = {
      type: "system",
      level,
      message,
      timestamp: Date.now()
    };
    this.toAll(battleId, "system:message", sys);
    this.broadcastLog(battleId, { text: `[시스템] ${message}`, type: "system", timestamp: Date.now() });
  }

  broadcastError(battleId, error, target = "all") {
    const payload = {
      message: typeof error === "string" ? error : (error?.message || "error"),
      timestamp: Date.now()
    };
    if (target === "admins") return this.toRole(battleId, "admin", "error", payload);
    if (target === "players") return this.toRole(battleId, "player", "error", payload);
    if (target === "spectators") return this.toRole(battleId, "spectator", "error", payload);
    this.toAll(battleId, "error", payload);
  }

  // ───────────────────────── 룸 조인/이탈/재배치 ─────────────────────────
  /**
   * 소켓을 룸에 조인(필수: battleId, role)
   * - role: 'admin' | 'player' | 'spectator'
   * - teamKey: 'phoenix' | 'eaters' (player인 경우 가능)
   * - withRoleRooms: true면 역할 룸도 사용(기본 false: 팀/전체룸만 사용)
   */
  joinSocketToRooms(socket, battleId, role, teamKey = null, { withRoleRooms = false } = {}) {
    if (!socket || !battleId || !role) return;
    // 전체 룸
    socket.join(this.getBattleRoom(battleId));
    // 팀 룸
    if (role === "player" && teamKey && this.opts.teamKeys.includes(teamKey)) {
      socket.join(this.getTeamRoom(battleId, teamKey));
    }
    // 역할 룸(옵션)
    if (withRoleRooms) {
      socket.join(this.getRoleRoom(battleId, role));
      if (role === "admin") {
        // 관리자는 양 팀 룸도 모니터링
        for (const t of this.opts.teamKeys) socket.join(this.getTeamRoom(battleId, t));
      }
    }
    this.log(`[Broadcast] join rooms: socket=${socket.id}, role=${role}, team=${teamKey || "-"}, battle=${battleId}`);
  }

  /**
   * 플레이어 팀 변경 시 소켓 재배치
   */
  updateSocketTeam(socket, battleId, prevTeam, nextTeam) {
    if (!socket || !battleId) return;
    if (prevTeam && this.opts.teamKeys.includes(prevTeam)) {
      socket.leave(this.getTeamRoom(battleId, prevTeam));
    }
    if (nextTeam && this.opts.teamKeys.includes(nextTeam)) {
      socket.join(this.getTeamRoom(battleId, nextTeam));
    }
    this.log(`[Broadcast] team update: socket=${socket.id}, ${prevTeam || "-"} → ${nextTeam || "-"} (${battleId})`);
  }

  /**
   * 룸 이탈
   */
  leaveSocketFromRooms(socket, battleId, role, teamKey = null, { withRoleRooms = false } = {}) {
    if (!socket || !battleId) return;
    socket.leave(this.getBattleRoom(battleId));
    if (teamKey && this.opts.teamKeys.includes(teamKey)) {
      socket.leave(this.getTeamRoom(battleId, teamKey));
    }
    if (withRoleRooms) {
      socket.leave(this.getRoleRoom(battleId, role));
      if (role === "admin") {
        for (const t of this.opts.teamKeys) socket.leave(this.getTeamRoom(battleId, t));
      }
    }
    this.log(`[Broadcast] leave rooms: socket=${socket.id}, role=${role}, team=${teamKey || "-"}, battle=${battleId}`);
  }

  // ───────────────────────── 통계/디버깅 ─────────────────────────
  getRoomSize(roomName) {
    if (!this.io) return 0;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
    // 참고: 어댑터의 socketsById는 NodeAdapter 최신버전엔 숨김일 수 있음
  }

  getBattleStats(battleId) {
    return {
      total: this.getRoomSize(this.getBattleRoom(battleId)),
      phoenix: this.getRoomSize(this.getTeamRoom(battleId, "phoenix")),
      eaters: this.getRoomSize(this.getTeamRoom(battleId, "eaters"))
    };
  }

  getAllRooms() {
    if (!this.io) return [];
    const prefix = `${this.ns()}:`;
    return Array.from(this.io.sockets.adapter.rooms.keys()).filter((r) => r.startsWith(prefix));
  }

  // ───────────────────────── 정리 ─────────────────────────
  /**
   * 전투 종료 시 룸 정리
   * - disconnectSockets()는 실제 클라이언트를 끊으므로 신중히 사용
   * - 기본은 룸만 비우지 않고 유지(클라가 다른 전투로 이동 시 자연 이탈)
   * - 운영에서 강제 종료가 필요하면 forceDisconnect=true
   */
  cleanupBattle(battleId, { forceDisconnect = false } = {}) {
    const rooms = [
      this.getBattleRoom(battleId),
      this.getTeamRoom(battleId, "phoenix"),
      this.getTeamRoom(battleId, "eaters")
    ];
    for (const r of rooms) {
      if (!this.io.sockets.adapter.rooms.has(r)) continue;
      if (forceDisconnect) {
        this.io.in(r).disconnectSockets();
      } else {
        // 강제 disconnect 대신, 참여 소켓들에게 종료 통지만 보냄
        this.toRoom(r, "battle:ended", { battleId, timestamp: Date.now() });
      }
    }
    this.log(`[Broadcast] cleanup battle=${battleId}, force=${forceDisconnect}`);
  }
}

// 싱글톤 인스턴스
const broadcastManager = new BroadcastManager();
module.exports = broadcastManager;
