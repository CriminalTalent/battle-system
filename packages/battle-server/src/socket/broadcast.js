// packages/battle-server/src/socket/broadcast.js
// Enhanced PYXIS Broadcast Hub - 통합 Socket.IO 브로드캐스트 시스템
// - 내부 팀 표준: 'A'/'B' (외부 룸 네이밍은 phoenix/eaters로 변환)
// - 스탯 범위 1~5로 통일
// - 기존 server/io 재사용 가능 (주입식)
// - battles 스토어 외부 주입 가능 (단일 소스 오브 트루스)
// - X-Forwarded-For 우선 IP 추출, 레이트리밋/보안 강화, 폴백 BroadcastManager

"use strict";

const http = require("http");
const { Server } = require("socket.io");
const broadcastManagerMod = require("./broadcast/broadcastManager");

// ────────────────────────────────────────────────────────────────────────────
// 설정
// ────────────────────────────────────────────────────────────────────────────

const SECURITY_CONFIG = {
  MAX_MESSAGE_LENGTH: 500,
  MAX_NAME_LENGTH: 64,
  MAX_AVATAR_LENGTH: 256,
  MAX_HP: 1000,
  MAX_LOGS_PER_BATTLE: 1000,
  MAX_PLAYERS_PER_BATTLE: 8,

  RATE_LIMIT_GENERAL: 300, // ms
  RATE_LIMIT_CHAT: 3000,
  RATE_LIMIT_ACTION: 1000,
  RATE_LIMIT_STATE: 500,

  MAX_CONNECTIONS_PER_IP: 15,
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30분
};

// ────────────────────────────────────────────────────────────────────────────
/** 레이트 리미터 */
// ────────────────────────────────────────────────────────────────────────────
class EnhancedRateLimiter {
  constructor() {
    this.requests = new Map(); // socketId:event -> [timestamps]
    this.ipConnections = new Map(); // ip -> Set<socketId>
  }

  isAllowed(socketId, event, customLimit = null) {
    const now = Date.now();
    const key = `${socketId}:${event}`;

    let limit = customLimit;
    if (!limit) {
      if (event.includes("chat")) limit = SECURITY_CONFIG.RATE_LIMIT_CHAT;
      else if (event.includes("action") || event.includes("player:")) limit = SECURITY_CONFIG.RATE_LIMIT_ACTION;
      else if (event.includes("state") || event.includes("update")) limit = SECURITY_CONFIG.RATE_LIMIT_STATE;
      else limit = SECURITY_CONFIG.RATE_LIMIT_GENERAL;
    }

    if (!this.requests.has(key)) this.requests.set(key, []);

    const arr = this.requests.get(key);
    while (arr.length > 0 && now - arr[0] > limit) arr.shift();

    if (arr.length > 0) return false;
    arr.push(now);
    return true;
  }

  trackConnection(socketId, ip) {
    if (!this.ipConnections.has(ip)) this.ipConnections.set(ip, new Set());
    this.ipConnections.get(ip).add(socketId);
    return this.ipConnections.get(ip).size <= SECURITY_CONFIG.MAX_CONNECTIONS_PER_IP;
  }

  untrackConnection(socketId, ip) {
    if (this.ipConnections.has(ip)) {
      this.ipConnections.get(ip).delete(socketId);
      if (this.ipConnections.get(ip).size === 0) this.ipConnections.delete(ip);
    }
    // 해당 소켓 요청 기록 제거
    for (const key of Array.from(this.requests.keys())) {
      if (key.startsWith(`${socketId}:`)) this.requests.delete(key);
    }
  }

  cleanup() {
    const now = Date.now();
    // 오래된 키 정리 (보수적으로 10분 기준)
    const maxAge = 10 * 60 * 1000;
    for (const [key, stamps] of this.requests.entries()) {
      while (stamps.length > 0 && now - stamps[0] > maxAge) stamps.shift();
      if (stamps.length === 0) this.requests.delete(key);
    }
  }
}

const rateLimiter = new EnhancedRateLimiter();

// ────────────────────────────────────────────────────────────────────────────
// 내부 저장소 (기본). attach에서 외부 battlesStore 주입 가능
// ────────────────────────────────────────────────────────────────────────────
const _localBattles = new Map();
let battles = _localBattles; // 외부 주입 시 교체

// 세션/메트릭
const activeSessions = new Map(); // socketId -> session
const connectionMetrics = new Map(); // reserved

// ────────────────────────────────────────────────────────────────────────────
// 유틸: 팀/스탯/문자열/숫자/룸/스냅샷
// ────────────────────────────────────────────────────────────────────────────
function normalizeTeam(team) {
  const t = String(team || "").toLowerCase();
  if (t === "phoenix" || t === "a") return "A";
  if (t === "eaters" || t === "b") return "B";
  return "A";
}

function outwardTeam(teamAB) {
  return teamAB === "A" ? "phoenix" : "eaters";
}

function sanitizeString(value, maxLength = SECURITY_CONFIG.MAX_MESSAGE_LENGTH) {
  const str = String(value ?? "");
  return str
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[<>"'&]/g, "")
    .trim()
    .slice(0, maxLength);
}

function validateNumber(value, min = 0, max = SECURITY_CONFIG.MAX_HP) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function validateStats(stats) {
  const clamp = (n) => Math.max(1, Math.min(5, Math.floor(Number(n) || 3)));
  if (!stats || typeof stats !== "object") {
    return { attack: 3, defense: 3, agility: 3, luck: 3 };
  }
  return {
    attack: clamp(stats.attack ?? stats.atk),
    defense: clamp(stats.defense ?? stats.def),
    agility: clamp(stats.agility ?? stats.dex),
    luck: clamp(stats.luck ?? stats.luk),
  };
}

function validateTeam(team) {
  return normalizeTeam(team);
}

function validatePlayerData(playerData) {
  if (!playerData || typeof playerData !== "object") throw new Error("Invalid player data");

  const teamAB = validateTeam(playerData.team);
  const maxHp = validateNumber(playerData.maxHp, 1, SECURITY_CONFIG.MAX_HP);
  const hp = validateNumber(playerData.hp, 0, maxHp);

  return {
    id: sanitizeString(playerData.id, 64),
    name: sanitizeString(playerData.name, SECURITY_CONFIG.MAX_NAME_LENGTH),
    team: teamAB,
    hp,
    maxHp,
    stats: validateStats(playerData.stats),
    avatar: sanitizeString(playerData.avatar, SECURITY_CONFIG.MAX_AVATAR_LENGTH),
    status: ["alive", "dead", "unconscious"].includes(playerData.status) ? playerData.status : hp > 0 ? "alive" : "dead",
  };
}

function getRoomId(battleId) {
  return `battle:${battleId}`;
}
function getTeamRoomId(battleId, teamAB) {
  const t = outwardTeam(teamAB); // phoenix/eaters
  return `battle:${battleId}:${t}`;
}
function getRoleRoomId(battleId, role) {
  return `battle:${battleId}:${role}`;
}

function calculateTeamStats(battle) {
  const teams = { A: [], B: [] };
  for (const p of battle.players.values()) teams[p.team].push(p);

  const sumStats = (arr) => arr.reduce((s, p) => s + Object.values(p.stats).reduce((a, b) => a + b, 0), 0);
  const sumHp = (arr) => arr.reduce((s, p) => s + p.hp, 0);
  const alive = (arr) => arr.filter((p) => p.status === "alive" && p.hp > 0).length;

  return {
    A: { count: teams.A.length, aliveCount: alive(teams.A), totalHp: sumHp(teams.A), totalStats: sumStats(teams.A) },
    B: { count: teams.B.length, aliveCount: alive(teams.B), totalHp: sumHp(teams.B), totalStats: sumStats(teams.B) },
  };
}

function makeSnapshot(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return null;

  const playerList = Array.from(battle.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team, // 내부 표준 A/B
    hp: p.hp,
    maxHp: p.maxHp,
    stats: p.stats,
    avatar: p.avatar,
    status: p.status,
  }));

  return {
    id: battleId,
    status: battle.status,
    turn: battle.turn,
    currentTeam: battle.currentTeam, // A/B
    players: playerList,
    teamStats: calculateTeamStats(battle),
    logs: battle.logs.slice(-50),
    lastActivity: battle.lastActivity,
    connectionCount: getConnectionCount(battleId),
    stats: battle.stats,
  };
}

function getConnectionCount(battleId) {
  const sessions = Array.from(activeSessions.values());
  return sessions.filter((s) => s.battleId === battleId).length;
}

function ensureBattle(battleId) {
  if (!battles.has(battleId)) {
    battles.set(battleId, {
      id: battleId,
      status: "waiting",
      turn: 1,
      currentTeam: null, // A/B
      players: new Map(), // id -> player
      logs: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stats: {
        totalActions: 0,
        totalPlayers: 0,
        spectatorCount: 0,
      },
    });
  }
  const battle = battles.get(battleId);
  battle.lastActivity = Date.now();
  return battle;
}

function addLogToBattle(battleId, message, type = "system") {
  const battle = battles.get(battleId);
  if (!battle) return;
  const entry = {
    id: `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    message: sanitizeString(message),
    timestamp: Date.now(),
    turn: battle.turn,
  };
  battle.logs.push(entry);
  if (battle.logs.length > SECURITY_CONFIG.MAX_LOGS_PER_BATTLE) {
    battle.logs.splice(0, battle.logs.length - SECURITY_CONFIG.MAX_LOGS_PER_BATTLE);
  }
  battle.lastActivity = Date.now();
  return entry;
}

function getRealIP(socket) {
  const xf = socket.handshake.headers?.["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return socket.handshake.address || socket.conn?.remoteAddress || "0.0.0.0";
}

// ────────────────────────────────────────────────────────────────────────────
// BroadcastManager 폴백(미구현 대비)
// ────────────────────────────────────────────────────────────────────────────
function createBMFallback(io) {
  return {
    init: () => {},
    toAll: (battleId, ev, data) => io.to(getRoomId(battleId)).emit(ev, data),
    toTeam: (battleId, teamKey, ev, data) => io.to(`battle:${battleId}:${teamKey}`).emit(ev, data),
    toRole: (battleId, role, ev, data) => io.to(getRoleRoomId(battleId, role)).emit(ev, data),
    joinSocketToRooms: (socket, battleId, role, teamAB, { withRoleRooms } = {}) => {
      socket.join(getRoomId(battleId));
      if (withRoleRooms && role) socket.join(getRoleRoomId(battleId, role));
      if (teamAB) socket.join(getTeamRoomId(battleId, teamAB));
    },
    leaveSocketFromRooms: (socket, battleId, role, teamAB) => {
      socket.leave(getRoomId(battleId));
      if (role) socket.leave(getRoleRoomId(battleId, role));
      if (teamAB) socket.leave(getTeamRoomId(battleId, teamAB));
    },
    broadcastChat: (battleId, msg) => io.to(getRoomId(battleId)).emit("chat:new", msg),
    broadcastLog: (battleId, log) => io.to(getRoomId(battleId)).emit("log:new", log),
    broadcastTurnEvent: (battleId, type, payload) => io.to(getRoomId(battleId)).emit(`turn:${type}`, payload),
    broadcastBattleEvent: (battleId, type, payload) => io.to(getRoomId(battleId)).emit(`battle:${type}`, payload),
    broadcastBattleState: (battleId, snapshot) => io.to(getRoomId(battleId)).emit("state:snapshot", snapshot),
    getSystemStats: () => ({ fallback: true }),
    destroy: () => {},
  };
}

// ────────────────────────────────────────────────────────────────────────────
// attach: 기존 server/io 재사용 + battlesStore 주입 지원
// attach(app, existingServer, { io, battlesStore })
// ────────────────────────────────────────────────────────────────────────────
function attach(app, existingServer, opts = {}) {
  const { io: existingIO, battlesStore } = opts;
  if (battlesStore) battles = battlesStore;

  const server = existingServer || http.createServer(app);

  // CORS 원본 처리
  const originEnv = process.env.CORS_ORIGIN || "*";
  const corsOrigin = originEnv === "*"
    ? "*"
    : originEnv.split(",").map((s) => s.trim()).filter(Boolean);

  const io =
    existingIO ||
    new Server(server, {
      cors: {
        origin: corsOrigin,
        credentials: true,
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
      pingInterval: 20000,
      pingTimeout: 30000,
      maxHttpBufferSize: 2e6,
      allowEIO3: true,
    });

  // BroadcastManager 선택(미구현 시 폴백)
  const broadcastManager =
    broadcastManagerMod && typeof broadcastManagerMod.init === "function"
      ? broadcastManagerMod
      : createBMFallback(io);

  // 초기화
  broadcastManager.init?.(io, {
    verbose: process.env.NODE_ENV === "development",
    enableMetrics: true,
    batchEnabled: process.env.NODE_ENV === "production",
  });

  // 편의 브로드캐스트 함수 (내부 A/B → 룸 phoenix/eaters 변환은 BM 내부/룸 생성에서 처리)
  const broadcast = (battleId, event, data) => broadcastManager.toAll(battleId, event, data);
  const broadcastToTeam = (battleId, teamAB, event, data) =>
    broadcastManager.toTeam(battleId, outwardTeam(teamAB), event, data);

  // 세션 관리
  function createSession(socketId, data) {
    const s = {
      socketId,
      battleId: data.battleId,
      role: data.role,
      playerId: data.playerId || null,
      team: data.team || null, // A/B
      spectatorName: data.spectatorName || null,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      ip: data.ip,
    };
    activeSessions.set(socketId, s);
    return s;
  }

  function updateSession(socketId, updates) {
    const s = activeSessions.get(socketId);
    if (s) {
      Object.assign(s, updates);
      s.lastActivity = Date.now();
    }
  }

  function removeSession(socketId) {
    const s = activeSessions.get(socketId);
    if (s) {
      rateLimiter.untrackConnection(socketId, s.ip);
      activeSessions.delete(socketId);
    }
    return s;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 소켓 이벤트
  // ──────────────────────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const clientIp = getRealIP(socket);

    if (!rateLimiter.trackConnection(socket.id, clientIp)) {
      socket.emit("error", "Too many connections from this IP");
      socket.disconnect(true);
      return;
    }

    // 관리자 참여
    socket.on("admin:join", ({ battleId } = {}) => {
      try {
        if (!battleId || !rateLimiter.isAllowed(socket.id, "admin:join")) return;
        ensureBattle(battleId);

        socket.join(getRoomId(battleId));
        createSession(socket.id, { battleId, role: "admin", ip: clientIp });

        broadcastManager.joinSocketToRooms(socket, battleId, "admin", null, { withRoleRooms: true });
        socket.emit("state:snapshot", makeSnapshot(battleId));
        addLogToBattle(battleId, "관리자가 입장했습니다.");

        // 관리자용 룸에도 조인됨: battle:{id}:admin
      } catch (e) {
        console.error("[Broadcast] admin:join error:", e.message);
        socket.emit("error", "Failed to join as admin");
      }
    });

    // 플레이어 참여
    socket.on("player:join", ({ battleId, playerId } = {}) => {
      try {
        if (!battleId || !rateLimiter.isAllowed(socket.id, "player:join")) return;

        const battle = ensureBattle(battleId);
        socket.join(getRoomId(battleId));

        let teamAB = null;
        if (playerId && battle.players.has(playerId)) {
          const player = battle.players.get(playerId);
          teamAB = player.team; // A/B
          socket.join(getTeamRoomId(battleId, teamAB));
        }

        createSession(socket.id, { battleId, role: "player", playerId, team: teamAB, ip: clientIp });
        broadcastManager.joinSocketToRooms(socket, battleId, "player", teamAB);

        socket.emit("state:snapshot", makeSnapshot(battleId));

        if (playerId && battle.players.has(playerId)) {
          const player = battle.players.get(playerId);
          addLogToBattle(battleId, `${player.name}이 전투에 참여했습니다.`);
          broadcast(battleId, "player:joined", { playerId, playerName: player.name });
        }
      } catch (e) {
        console.error("[Broadcast] player:join error:", e.message);
        socket.emit("error", "Failed to join as player");
      }
    });

    // 관전자 참여
    socket.on("spectator:join", ({ battleId, spectatorName = "관전자" } = {}) => {
      try {
        if (!battleId || !rateLimiter.isAllowed(socket.id, "spectator:join")) return;

        const battle = ensureBattle(battleId);
        socket.join(getRoomId(battleId));

        const cleanName = sanitizeString(spectatorName, 50);
        createSession(socket.id, { battleId, role: "spectator", spectatorName: cleanName, ip: clientIp });

        battle.stats.spectatorCount++;
        broadcastManager.joinSocketToRooms(socket, battleId, "spectator");

        socket.emit("state:snapshot", makeSnapshot(battleId));
        addLogToBattle(battleId, `관전자 ${cleanName}이 입장했습니다.`);
      } catch (e) {
        console.error("[Broadcast] spectator:join error:", e.message);
        socket.emit("error", "Failed to join as spectator");
      }
    });

    // 상태 스냅샷 요청
    socket.on("state:pull", () => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId) return;
        updateSession(socket.id, {});
        socket.emit("state:snapshot", makeSnapshot(s.battleId));
      } catch (e) {
        console.error("[Broadcast] state:pull error:", e.message);
      }
    });

    // 채팅
    socket.on("chat:send", (messageData = {}, ack) => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId) return ack?.({ ok: false, error: "no_battle" });
        if (!rateLimiter.isAllowed(socket.id, "chat:send")) return ack?.({ ok: false, error: "rate_limited" });

        let text = sanitizeString(messageData.text, SECURITY_CONFIG.MAX_MESSAGE_LENGTH);
        if (!text.trim()) return ack?.({ ok: false, error: "empty_message" });

        const battle = battles.get(s.battleId);
        let senderName = "익명";
        if (s.role === "player" && s.playerId && battle.players.has(s.playerId)) {
          senderName = battle.players.get(s.playerId).name;
        } else if (s.role === "spectator") {
          senderName = s.spectatorName || "관전자";
        } else if (s.role === "admin") {
          senderName = "관리자";
        }

        // /t 팀채팅
        let scope = "all";
        if (/^\s*\/t\s+/i.test(text) && s.role === "player" && s.team) {
          scope = "team";
          text = text.replace(/^\s*\/t\s+/i, "").trim();
          if (!text) return ack?.({ ok: false, error: "empty_message" });
        }

        const chatMessage = {
          id: `CHAT_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sender: senderName,
          role: s.role,
          message: text,
          scope,
          team: s.team, // A/B
          timestamp: Date.now(),
        };

        if (scope === "team" && s.team) {
          // 팀 룸 브로드캐스트 + 관리자 알림
          broadcastToTeam(s.battleId, s.team, "chat:new", chatMessage);
          broadcastManager.toRole(s.battleId, "admin", "chat:new", chatMessage);
        } else {
          broadcastManager.broadcastChat(s.battleId, chatMessage);
        }

        updateSession(socket.id, {});
        ack?.({ ok: true, messageId: chatMessage.id });
      } catch (e) {
        console.error("[Broadcast] chat:send error:", e.message);
        ack?.({ ok: false, error: "internal_error" });
      }
    });

    // 로그 추가(관리자)
    socket.on("log:append", ({ text, type = "system" } = {}) => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId || s.role !== "admin") return;
        if (!rateLimiter.isAllowed(socket.id, "log:append")) return;

        const entry = addLogToBattle(s.battleId, text, type);
        if (entry) {
          broadcastManager.broadcastLog(s.battleId, entry);
          updateSession(socket.id, {});
        }
      } catch (e) {
        console.error("[Broadcast] log:append error:", e.message);
      }
    });

    // 턴 업데이트(관리자)
    socket.on("turn:update", (payload = {}) => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId || s.role !== "admin") return;
        if (!rateLimiter.isAllowed(socket.id, "turn:update")) return;

        const battle = battles.get(s.battleId);
        if (!battle) return;

        if (typeof payload.turn === "number") {
          battle.turn = validateNumber(payload.turn, 1, 1000);
        }
        if (payload.currentTeam) {
          battle.currentTeam = validateTeam(payload.currentTeam); // A/B
        }

        const data = {
          turn: battle.turn,
          currentTeam: battle.currentTeam,
          hint: sanitizeString(payload.hint || "", 200),
          timestamp: Date.now(),
        };

        broadcastManager.broadcastTurnEvent(s.battleId, "update", data);
        updateSession(socket.id, {});
      } catch (e) {
        console.error("[Broadcast] turn:update error:", e.message);
      }
    });

    // 전투 상태 업데이트(관리자)
    socket.on("battle:status", (payload = {}) => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId || s.role !== "admin") return;
        if (!rateLimiter.isAllowed(socket.id, "battle:status")) return;

        const battle = battles.get(s.battleId);
        if (!battle) return;

        const valid = ["waiting", "ongoing", "paused", "ended"];
        const status = valid.includes(payload.status) ? payload.status : battle.status;

        battle.status = status;
        battle.lastActivity = Date.now();

        broadcastManager.broadcastBattleEvent(s.battleId, "status_changed", {
          status,
          previousStatus: payload.previousStatus,
          reason: sanitizeString(payload.reason || "", 100),
        });

        updateSession(socket.id, {});
      } catch (e) {
        console.error("[Broadcast] battle:status error:", e.message);
      }
    });

    // 로스터 업데이트(관리자)
    socket.on("roster:update", ({ players } = {}) => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId || s.role !== "admin") return;
        if (!rateLimiter.isAllowed(socket.id, "roster:update")) return;

        const battle = battles.get(s.battleId);
        if (!battle || !Array.isArray(players)) return;

        const validated = [];
        for (const pd of players) {
          try {
            const vp = validatePlayerData(pd); // team A/B
            if (vp.id && vp.name) {
              battle.players.set(vp.id, vp);
              validated.push(vp);

              // 팀 변경 시 소켓 룸 이동
              for (const [sid, sess] of activeSessions.entries()) {
                if (sess.playerId === vp.id && sess.battleId === s.battleId) {
                  const oldTeam = sess.team;
                  const newTeam = vp.team;
                  if (oldTeam !== newTeam) {
                    const ps = io.sockets.sockets.get(sid);
                    if (ps) {
                      if (oldTeam) ps.leave(getTeamRoomId(s.battleId, oldTeam));
                      ps.join(getTeamRoomId(s.battleId, newTeam));
                      updateSession(sid, { team: newTeam });
                    }
                  }
                }
              }
            }
          } catch (ve) {
            console.warn("[Broadcast] player validate failed:", ve.message);
          }
        }

        battle.stats.totalPlayers = battle.players.size;
        battle.lastActivity = Date.now();

        const snapshot = makeSnapshot(s.battleId);
        broadcastManager.broadcastBattleState(s.battleId, snapshot);
        updateSession(socket.id, {});
      } catch (e) {
        console.error("[Broadcast] roster:update error:", e.message);
      }
    });

    // HP 업데이트(관리자/플레이어 공용 허용 여부는 정책에 맞게)
    socket.on("hp:update", ({ playerId, hp } = {}) => {
      try {
        const s = activeSessions.get(socket.id);
        if (!s?.battleId) return;
        if (!rateLimiter.isAllowed(socket.id, "hp:update")) return;

        const battle = battles.get(s.battleId);
        if (!battle) return;
        const player = battle.players.get(String(playerId));
        if (!player) return;

        const newHp = validateNumber(hp, 0, player.maxHp || SECURITY_CONFIG.MAX_HP);
        player.hp = newHp;
        if (newHp === 0) player.status = "dead";
        else if (player.status === "dead" && newHp > 0) player.status = "alive";

        battle.lastActivity = Date.now();

        broadcast(s.battleId, "hp:update", {
          playerId: player.id,
          hp: player.hp,
          status: player.status,
          timestamp: Date.now(),
        });

        updateSession(socket.id, {});
      } catch (e) {
        console.error("[Broadcast] hp:update error:", e.message);
      }
    });

    // 연결 해제
    socket.on("disconnect", (reason) => {
      try {
        const s = removeSession(socket.id);
        if (s?.battleId) {
          const battle = battles.get(s.battleId);
          if (s.role === "spectator" && battle) {
            battle.stats.spectatorCount = Math.max(0, battle.stats.spectatorCount - 1);
            addLogToBattle(s.battleId, `관전자 ${s.spectatorName || "익명"}이 퇴장했습니다.`);
          } else if (s.role === "player" && s.playerId && battle) {
            const p = battle.players.get(s.playerId);
            if (p) addLogToBattle(s.battleId, `${p.name}이 연결을 끊었습니다.`);
          }

          if (battle) {
            broadcastManager.leaveSocketFromRooms(socket, s.battleId, s.role, s.team);
            broadcast(s.battleId, "connection:update", {
              type: "disconnect",
              role: s.role,
              playerId: s.playerId,
              spectatorName: s.spectatorName,
            });
          }
        }
      } catch (e) {
        console.error("[Broadcast] disconnect handler error:", e.message);
      }
    });

    socket.on("error", (err) => {
      console.error("[Broadcast] socket error:", err);
      const s = activeSessions.get(socket.id);
      if (s) console.error("[Broadcast] session:", JSON.stringify(s));
    });

    socket.emit("connection:ready", {
      socketId: socket.id,
      timestamp: Date.now(),
      message: "PYXIS 브로드캐스트 허브에 연결되었습니다",
      version: "2.0.0",
      features: ["enhanced-security", "rate-limiting", "team-chat", "real-time-sync"],
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 정리/통계
  // ──────────────────────────────────────────────────────────────────────
  const cleanupInterval = setInterval(() => {
    try {
      rateLimiter.cleanup();

      const now = Date.now();
      const sessionTimeout = SECURITY_CONFIG.SESSION_TIMEOUT;
      const battleTimeout = 4 * 60 * 60 * 1000;

      for (const [sid, s] of activeSessions.entries()) {
        if (now - s.lastActivity > sessionTimeout) {
          activeSessions.delete(sid);
        }
      }

      for (const [bid, b] of battles.entries()) {
        if (now - b.lastActivity > battleTimeout) {
          battles.delete(bid);
        }
      }

      for (const [k, ts] of connectionMetrics.entries()) {
        if (now - ts > 60 * 60 * 1000) connectionMetrics.delete(k);
      }
    } catch (e) {
      console.error("[Cleanup] error:", e.message);
    }
  }, 60 * 1000);

  function getStats() {
    const roleStats = {};
    const battleStats = {};
    for (const s of activeSessions.values()) {
      roleStats[s.role] = (roleStats[s.role] || 0) + 1;
      if (s.battleId) battleStats[s.battleId] = (battleStats[s.battleId] || 0) + 1;
    }
    return {
      timestamp: Date.now(),
      connections: {
        total: activeSessions.size,
        byRole: roleStats,
        byBattle: battleStats,
      },
      battles: {
        total: battles.size,
        active: Array.from(battles.values()).filter((b) => b.status === "ongoing").length,
        waiting: Array.from(battles.values()).filter((b) => b.status === "waiting").length,
      },
      performance: {
        rateLimiterSize: rateLimiter.requests.size,
        ipConnections: rateLimiter.ipConnections.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
      broadcastManager: broadcastManager.getSystemStats?.() || {},
    };
  }

  function cleanup() {
    if (cleanupInterval) clearInterval(cleanupInterval);
    for (const sid of activeSessions.keys()) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.disconnect(true);
    }
    activeSessions.clear();
    connectionMetrics.clear();
    broadcastManager.destroy?.();
    // battles는 외부 주입일 수 있으니 여기서 clear하지 않음
    console.log("[Broadcast] 허브 정리 완료");
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  console.log("[Broadcast] PYXIS Enhanced Broadcast Hub 초기화 완료");
  console.log(`[Broadcast] 보안 설정: Rate limiting enabled, IP 제한: ${SECURITY_CONFIG.MAX_CONNECTIONS_PER_IP}`);

  return {
    server,
    io,
    battles,
    activeSessions,
    broadcast,
    broadcastToTeam,
    snapshot: makeSnapshot,
    getStats,
    cleanup,

    addLogToBattle,
    ensureBattle,
    validatePlayerData,
    validateTeam,
    validateStats,

    SECURITY_CONFIG,
    broadcastManager,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 모듈 export
// ────────────────────────────────────────────────────────────────────────────
module.exports = {
  attach,
  battles, // 주입 후에도 참조 가능
  // 유틸/설정
  sanitizeString,
  validateNumber,
  validateTeam,
  validateStats,
  SECURITY_CONFIG,
};
