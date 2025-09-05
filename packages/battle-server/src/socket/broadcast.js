// packages/battle-server/src/socket/broadcast.js
// Enhanced PYXIS Broadcast Hub - 통합 Socket.IO 브로드캐스트 시스템
// - BroadcastManager와 연동된 고성능 허브
// - 강화된 보안, 검증, 모니터링 시스템
// - 실시간 전투 상태 동기화 및 최적화

"use strict";

const http = require("http");
const { Server } = require("socket.io");
const broadcastManager = require('./broadcast/broadcastManager');

// 데이터 스토어 (다른 모듈과 동기화)
const battles = new Map();
const activeSessions = new Map(); // 활성 세션 추적
const connectionMetrics = new Map(); // 연결 통계

// 보안 및 제한 설정
const SECURITY_CONFIG = {
  MAX_MESSAGE_LENGTH: 500,
  MAX_NAME_LENGTH: 64,
  MAX_AVATAR_LENGTH: 256,
  MAX_HP: 1000,
  MAX_LOGS_PER_BATTLE: 1000,
  MAX_PLAYERS_PER_BATTLE: 8,
  
  // 레이트 리미팅
  RATE_LIMIT_GENERAL: 300,     // 300ms - 일반 이벤트
  RATE_LIMIT_CHAT: 3000,       // 3초 - 채팅
  RATE_LIMIT_ACTION: 1000,     // 1초 - 게임 액션
  RATE_LIMIT_STATE: 500,       // 500ms - 상태 업데이트
  
  // 연결 제한
  MAX_CONNECTIONS_PER_IP: 15,
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30분
};

// 레이트 리미터 개선
class EnhancedRateLimiter {
  constructor() {
    this.requests = new Map(); // socketId:event -> timestamp[]
    this.ipConnections = new Map(); // ip -> Set<socketId>
  }

  isAllowed(socketId, event, customLimit = null) {
    const now = Date.now();
    const key = `${socketId}:${event}`;
    
    let limit = customLimit;
    if (!limit) {
      if (event.includes('chat')) limit = SECURITY_CONFIG.RATE_LIMIT_CHAT;
      else if (event.includes('action') || event.includes('player:')) limit = SECURITY_CONFIG.RATE_LIMIT_ACTION;
      else if (event.includes('state') || event.includes('update')) limit = SECURITY_CONFIG.RATE_LIMIT_STATE;
      else limit = SECURITY_CONFIG.RATE_LIMIT_GENERAL;
    }

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const userRequests = this.requests.get(key);
    
    // 오래된 요청 제거
    while (userRequests.length > 0 && now - userRequests[0] > limit) {
      userRequests.shift();
    }

    if (userRequests.length > 0) {
      return false; // 아직 쿨다운 중
    }

    userRequests.push(now);
    return true;
  }

  trackConnection(socketId, ip) {
    if (!this.ipConnections.has(ip)) {
      this.ipConnections.set(ip, new Set());
    }
    
    this.ipConnections.get(ip).add(socketId);
    
    // IP별 연결 제한 확인
    return this.ipConnections.get(ip).size <= SECURITY_CONFIG.MAX_CONNECTIONS_PER_IP;
  }

  untrackConnection(socketId, ip) {
    if (this.ipConnections.has(ip)) {
      this.ipConnections.get(ip).delete(socketId);
      if (this.ipConnections.get(ip).size === 0) {
        this.ipConnections.delete(ip);
      }
    }
    
    // 해당 소켓의 모든 요청 기록 삭제
    for (const key of this.requests.keys()) {
      if (key.startsWith(`${socketId}:`)) {
        this.requests.delete(key);
      }
    }
  }

  cleanup() {
    const now = Date.now();
    const maxAge = Math.max(...Object.values(SECURITY_CONFIG).filter(v => typeof v === 'number' && v < 100000));
    
    for (const [key, timestamps] of this.requests.entries()) {
      while (timestamps.length > 0 && now - timestamps[0] > maxAge * 2) {
        timestamps.shift();
      }
      
      if (timestamps.length === 0) {
        this.requests.delete(key);
      }
    }
  }
}

const rateLimiter = new EnhancedRateLimiter();

// 데이터 정제 및 검증 함수들
function sanitizeString(value, maxLength = SECURITY_CONFIG.MAX_MESSAGE_LENGTH) {
  const str = String(value ?? "");
  return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
            .replace(/[<>\"'&]/g, "")
            .trim()
            .slice(0, maxLength);
}

function validateNumber(value, min = 0, max = SECURITY_CONFIG.MAX_HP) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function validateTeam(team) {
  return team === "phoenix" || team === "eaters" ? team : "phoenix";
}

function validatePlayerData(playerData) {
  if (!playerData || typeof playerData !== 'object') {
    throw new Error('Invalid player data');
  }
  
  return {
    id: sanitizeString(playerData.id, 64),
    name: sanitizeString(playerData.name, SECURITY_CONFIG.MAX_NAME_LENGTH),
    team: validateTeam(playerData.team),
    hp: validateNumber(playerData.hp, 0, SECURITY_CONFIG.MAX_HP),
    maxHp: validateNumber(playerData.maxHp, 1, SECURITY_CONFIG.MAX_HP),
    stats: validateStats(playerData.stats),
    avatar: sanitizeString(playerData.avatar, SECURITY_CONFIG.MAX_AVATAR_LENGTH),
    status: ['alive', 'dead', 'unconscious'].includes(playerData.status) ? playerData.status : 'alive'
  };
}

function validateStats(stats) {
  const defaultStats = { attack: 3, defense: 3, agility: 3, luck: 3 };
  
  if (!stats || typeof stats !== 'object') {
    return defaultStats;
  }
  
  return {
    attack: validateNumber(stats.attack || stats.atk, 1, 10),
    defense: validateNumber(stats.defense || stats.def, 1, 10),
    agility: validateNumber(stats.agility || stats.dex, 1, 10),
    luck: validateNumber(stats.luck || stats.luk, 1, 10)
  };
}

// 전투 데이터 관리 강화
function ensureBattle(battleId) {
  if (!battles.has(battleId)) {
    battles.set(battleId, {
      id: battleId,
      status: "waiting",
      turn: 1,
      currentTeam: null,
      players: new Map(),
      logs: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stats: {
        totalActions: 0,
        totalPlayers: 0,
        spectatorCount: 0
      }
    });
  }
  
  const battle = battles.get(battleId);
  battle.lastActivity = Date.now();
  return battle;
}

function addLogToBattle(battleId, message, type = 'system') {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  const logEntry = {
    id: `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    type,
    message: sanitizeString(message),
    timestamp: Date.now(),
    turn: battle.turn
  };
  
  battle.logs.push(logEntry);
  
  // 로그 개수 제한
  if (battle.logs.length > SECURITY_CONFIG.MAX_LOGS_PER_BATTLE) {
    battle.logs.splice(0, battle.logs.length - SECURITY_CONFIG.MAX_LOGS_PER_BATTLE);
  }
  
  battle.lastActivity = Date.now();
  return logEntry;
}

// 스냅샷 생성 최적화
function makeSnapshot(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return null;
  
  const playerList = Array.from(battle.players.values()).map(player => ({
    id: player.id,
    name: player.name,
    team: player.team,
    hp: player.hp,
    maxHp: player.maxHp,
    stats: player.stats,
    avatar: player.avatar,
    status: player.status
  }));
  
  return {
    id: battleId,
    status: battle.status,
    turn: battle.turn,
    currentTeam: battle.currentTeam,
    players: playerList,
    teamStats: calculateTeamStats(battle),
    logs: battle.logs.slice(-50), // 최근 50개만
    lastActivity: battle.lastActivity,
    connectionCount: getConnectionCount(battleId),
    stats: battle.stats
  };
}

function calculateTeamStats(battle) {
  const teams = { phoenix: [], eaters: [] };
  
  for (const player of battle.players.values()) {
    teams[player.team].push(player);
  }
  
  return {
    phoenix: {
      count: teams.phoenix.length,
      aliveCount: teams.phoenix.filter(p => p.status === 'alive' && p.hp > 0).length,
      totalHp: teams.phoenix.reduce((sum, p) => sum + p.hp, 0),
      totalStats: teams.phoenix.reduce((sum, p) => sum + Object.values(p.stats).reduce((a, b) => a + b, 0), 0)
    },
    eaters: {
      count: teams.eaters.length,
      aliveCount: teams.eaters.filter(p => p.status === 'alive' && p.hp > 0).length,
      totalHp: teams.eaters.reduce((sum, p) => sum + p.hp, 0),
      totalStats: teams.eaters.reduce((sum, p) => sum + Object.values(p.stats).reduce((a, b) => a + b, 0), 0)
    }
  };
}

function getConnectionCount(battleId) {
  const sessions = Array.from(activeSessions.values());
  return sessions.filter(session => session.battleId === battleId).length;
}

// 룸 ID 생성
function getRoomId(battleId) { 
  return `battle:${battleId}`; 
}

function getTeamRoomId(battleId, team) { 
  return `battle:${battleId}:${team}`; 
}

/**
 * Enhanced attach function - 앱에 Socket.IO 브로드캐스트 허브 부착
 * @param {import('express').Express} app Express 앱
 * @param {import('http').Server} [existingServer] 기존 서버 (옵션)
 * @returns {Object} { io, battles, broadcast, snapshot, server, getStats }
 */
function attach(app, existingServer) {
  const server = existingServer || http.createServer(app);

  const io = new Server(server, {
    cors: { 
      origin: process.env.CORS_ORIGIN || true,
      credentials: true
    },
    transports: ["websocket", "polling"],
    pingInterval: 20000,
    pingTimeout: 30000,
    maxHttpBufferSize: 2e6, // 2MB
    allowEIO3: true
  });

  // BroadcastManager 초기화
  broadcastManager.init(io, {
    verbose: process.env.NODE_ENV === 'development',
    enableMetrics: true,
    batchEnabled: process.env.NODE_ENV === 'production'
  });

  // 브로드캐스트 함수
  function broadcast(battleId, event, data) {
    return broadcastManager.toAll(battleId, event, data);
  }

  function broadcastToTeam(battleId, team, event, data) {
    const teamKey = team === 'phoenix' ? 'phoenix' : 'eaters';
    return broadcastManager.toTeam(battleId, teamKey, event, data);
  }

  // 세션 관리
  function createSession(socketId, data) {
    const session = {
      socketId,
      battleId: data.battleId,
      role: data.role,
      playerId: data.playerId || null,
      team: data.team || null,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      ip: data.ip
    };
    
    activeSessions.set(socketId, session);
    return session;
  }

  function updateSession(socketId, updates) {
    const session = activeSessions.get(socketId);
    if (session) {
      Object.assign(session, updates);
      session.lastActivity = Date.now();
    }
  }

  function removeSession(socketId) {
    const session = activeSessions.get(socketId);
    if (session) {
      rateLimiter.untrackConnection(socketId, session.ip);
      activeSessions.delete(socketId);
    }
    return session;
  }

  // 연결 이벤트 처리
  io.on("connection", (socket) => {
    const clientIp = socket.handshake.address;
    
    // IP별 연결 제한 확인
    if (!rateLimiter.trackConnection(socket.id, clientIp)) {
      console.log(`[Security] IP ${clientIp}에서 과도한 연결 시도`);
      socket.emit('error', 'Too many connections from this IP');
      socket.disconnect(true);
      return;
    }

    console.log(`[Broadcast] 새 연결: ${socket.id} (IP: ${clientIp})`);

    // 관리자 참여
    socket.on("admin:join", ({ battleId } = {}) => {
      try {
        if (!battleId || !rateLimiter.isAllowed(socket.id, 'admin:join')) return;
        
        ensureBattle(battleId);
        socket.join(getRoomId(battleId));
        
        createSession(socket.id, {
          battleId,
          role: 'admin',
          ip: clientIp
        });
        
        broadcastManager.joinSocketToRooms(socket, battleId, 'admin', null, { withRoleRooms: true });
        
        socket.emit("state:snapshot", makeSnapshot(battleId));
        addLogToBattle(battleId, "관리자가 입장했습니다.");
        
        console.log(`[Broadcast] 관리자 참여: ${socket.id} -> ${battleId}`);
      } catch (error) {
        console.error(`[Broadcast] 관리자 참여 오류:`, error.message);
        socket.emit('error', 'Failed to join as admin');
      }
    });

    // 플레이어 참여
    socket.on("player:join", ({ battleId, playerId } = {}) => {
      try {
        if (!battleId || !rateLimiter.isAllowed(socket.id, 'player:join')) return;
        
        const battle = ensureBattle(battleId);
        socket.join(getRoomId(battleId));
        
        let team = null;
        if (playerId && battle.players.has(playerId)) {
          const player = battle.players.get(playerId);
          team = player.team;
          socket.join(getTeamRoomId(battleId, team));
        }
        
        createSession(socket.id, {
          battleId,
          role: 'player',
          playerId,
          team,
          ip: clientIp
        });
        
        broadcastManager.joinSocketToRooms(socket, battleId, 'player', team);
        
        socket.emit("state:snapshot", makeSnapshot(battleId));
        
        if (playerId && battle.players.has(playerId)) {
          const player = battle.players.get(playerId);
          addLogToBattle(battleId, `${player.name}이 전투에 참여했습니다.`);
          broadcast(battleId, "player:joined", { playerId, playerName: player.name });
        }
        
        console.log(`[Broadcast] 플레이어 참여: ${socket.id} -> ${battleId} (${playerId})`);
      } catch (error) {
        console.error(`[Broadcast] 플레이어 참여 오류:`, error.message);
        socket.emit('error', 'Failed to join as player');
      }
    });

    // 관전자 참여
    socket.on("spectator:join", ({ battleId, spectatorName = '관전자' } = {}) => {
      try {
        if (!battleId || !rateLimiter.isAllowed(socket.id, 'spectator:join')) return;
        
        const battle = ensureBattle(battleId);
        socket.join(getRoomId(battleId));
        
        const cleanName = sanitizeString(spectatorName, 50);
        
        createSession(socket.id, {
          battleId,
          role: 'spectator',
          spectatorName: cleanName,
          ip: clientIp
        });
        
        battle.stats.spectatorCount++;
        broadcastManager.joinSocketToRooms(socket, battleId, 'spectator');
        
        socket.emit("state:snapshot", makeSnapshot(battleId));
        addLogToBattle(battleId, `관전자 ${cleanName}이 입장했습니다.`);
        
        console.log(`[Broadcast] 관전자 참여: ${socket.id} -> ${battleId} (${cleanName})`);
      } catch (error) {
        console.error(`[Broadcast] 관전자 참여 오류:`, error.message);
        socket.emit('error', 'Failed to join as spectator');
      }
    });

    // 상태 스냅샷 요청
    socket.on("state:pull", () => {
      try {
        const session = activeSessions.get(socket.id);
        if (session?.battleId) {
          updateSession(socket.id, {});
          socket.emit("state:snapshot", makeSnapshot(session.battleId));
        }
      } catch (error) {
        console.error(`[Broadcast] 상태 조회 오류:`, error.message);
      }
    });

    // 강화된 채팅 시스템
    socket.on("chat:send", (messageData = {}, ack) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session?.battleId) {
          return ack?.({ ok: false, error: "no_battle" });
        }
        
        if (!rateLimiter.isAllowed(socket.id, 'chat:send')) {
          return ack?.({ ok: false, error: "rate_limited" });
        }

        let text = sanitizeString(messageData.text, SECURITY_CONFIG.MAX_MESSAGE_LENGTH);
        if (!text.trim()) {
          return ack?.({ ok: false, error: "empty_message" });
        }

        const battle = battles.get(session.battleId);
        let senderName = "익명";
        
        // 발신자 이름 결정
        if (session.role === 'player' && session.playerId && battle.players.has(session.playerId)) {
          senderName = battle.players.get(session.playerId).name;
        } else if (session.role === 'spectator') {
          senderName = session.spectatorName || '관전자';
        } else if (session.role === 'admin') {
          senderName = '관리자';
        }

        // 팀 채팅 처리 (/t 프리픽스)
        let scope = "all";
        if (/^\s*\/t\s+/i.test(text) && session.role === 'player' && session.team) {
          scope = "team";
          text = text.replace(/^\s*\/t\s+/i, "").trim();
          if (!text) return ack?.({ ok: false, error: "empty_message" });
        }

        const chatMessage = {
          id: `CHAT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          sender: senderName,
          role: session.role,
          message: text,
          scope,
          team: session.team,
          timestamp: Date.now()
        };

        // 메시지 전송
        if (scope === "team" && session.team) {
          broadcastToTeam(session.battleId, session.team, "chat:new", chatMessage);
          // 관리자에게도 팀 채팅 표시
          broadcastManager.toRole(session.battleId, 'admin', "chat:new", chatMessage);
        } else {
          broadcastManager.broadcastChat(session.battleId, chatMessage);
        }

        updateSession(socket.id, {});
        ack?.({ ok: true, messageId: chatMessage.id });
        
        console.log(`[Broadcast] 채팅: ${senderName} (${scope}): ${text.substring(0, 50)}...`);
      } catch (error) {
        console.error(`[Broadcast] 채팅 오류:`, error.message);
        ack?.({ ok: false, error: "internal_error" });
      }
    });

    // 로그 추가
    socket.on("log:append", ({ text, type = 'system' } = {}) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session?.battleId || session.role !== 'admin') return;
        
        if (!rateLimiter.isAllowed(socket.id, 'log:append')) return;

        const logEntry = addLogToBattle(session.battleId, text, type);
        if (logEntry) {
          broadcastManager.broadcastLog(session.battleId, logEntry);
          updateSession(socket.id, {});
        }
      } catch (error) {
        console.error(`[Broadcast] 로그 추가 오류:`, error.message);
      }
    });

    // 턴 업데이트
    socket.on("turn:update", (payload = {}) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session?.battleId || session.role !== 'admin') return;
        
        if (!rateLimiter.isAllowed(socket.id, 'turn:update')) return;

        const battle = battles.get(session.battleId);
        if (!battle) return;

        if (typeof payload.turn === "number") {
          battle.turn = validateNumber(payload.turn, 1, 1000);
        }
        
        if (payload.currentTeam) {
          battle.currentTeam = validateTeam(payload.currentTeam);
        }

        const turnData = {
          turn: battle.turn,
          currentTeam: battle.currentTeam,
          hint: sanitizeString(payload.hint || "", 200),
          timestamp: Date.now()
        };

        broadcastManager.broadcastTurnEvent(session.battleId, 'update', turnData);
        updateSession(socket.id, {});
        
        console.log(`[Broadcast] 턴 업데이트: ${session.battleId} -> 턴 ${battle.turn}`);
      } catch (error) {
        console.error(`[Broadcast] 턴 업데이트 오류:`, error.message);
      }
    });

    // 전투 상태 업데이트
    socket.on("battle:status", (payload = {}) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session?.battleId || session.role !== 'admin') return;
        
        if (!rateLimiter.isAllowed(socket.id, 'battle:status')) return;

        const battle = battles.get(session.battleId);
        if (!battle) return;

        const validStatuses = ['waiting', 'ongoing', 'paused', 'ended'];
        const status = validStatuses.includes(payload.status) ? payload.status : battle.status;
        
        battle.status = status;
        battle.lastActivity = Date.now();

        broadcastManager.broadcastBattleEvent(session.battleId, 'status_changed', {
          status,
          previousStatus: payload.previousStatus,
          reason: sanitizeString(payload.reason || "", 100)
        });
        
        updateSession(socket.id, {});
        console.log(`[Broadcast] 전투 상태 변경: ${session.battleId} -> ${status}`);
      } catch (error) {
        console.error(`[Broadcast] 상태 업데이트 오류:`, error.message);
      }
    });

    // 로스터 업데이트 (강화된 검증)
    socket.on("roster:update", ({ players } = {}) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session?.battleId || session.role !== 'admin') return;
        
        if (!rateLimiter.isAllowed(socket.id, 'roster:update')) return;

        const battle = battles.get(session.battleId);
        if (!battle || !Array.isArray(players)) return;

        const validatedPlayers = [];
        
        for (const playerData of players) {
          try {
            const validPlayer = validatePlayerData(playerData);
            if (validPlayer.id && validPlayer.name) {
              battle.players.set(validPlayer.id, validPlayer);
              validatedPlayers.push(validPlayer);
              
              // 해당 플레이어의 소켓이 있다면 팀 룸 업데이트
              for (const [socketId, playerSession] of activeSessions.entries()) {
                if (playerSession.playerId === validPlayer.id && playerSession.battleId === session.battleId) {
                  const oldTeam = playerSession.team;
                  const newTeam = validPlayer.team;
                  
                  if (oldTeam !== newTeam) {
                    const playerSocket = io.sockets.sockets.get(socketId);
                    if (playerSocket) {
                      if (oldTeam) playerSocket.leave(getTeamRoomId(session.battleId, oldTeam));
                      playerSocket.join(getTeamRoomId(session.battleId, newTeam));
                      updateSession(socketId, { team: newTeam });
                    }
                  }
                }
              }
            }
          } catch (validationError) {
            console.warn(`[Broadcast] 플레이어 데이터 검증 실패:`, validationError.message);
          }
        }

        battle.stats.totalPlayers = battle.players.size;
        battle.lastActivity = Date.now();

        const snapshot = makeSnapshot(session.battleId);
        broadcastManager.broadcastBattleState(session.battleId, snapshot);
        
        updateSession(socket.id, {});
        console.log(`[Broadcast] 로스터 업데이트: ${session.battleId} (${validatedPlayers.length}명)`);
      } catch (error) {
        console.error(`[Broadcast] 로스터 업데이트 오류:`, error.message);
      }
    });

    // HP 업데이트
    socket.on("hp:update", ({ playerId, hp } = {}) => {
      try {
        const session = activeSessions.get(socket.id);
        if (!session?.battleId) return;
        
        if (!rateLimiter.isAllowed(socket.id, 'hp:update')) return;

        const battle = battles.get(session.battleId);
        if (!battle) return;

        const player = battle.players.get(String(playerId));
        if (!player) return;

        const newHp = validateNumber(hp, 0, player.maxHp || SECURITY_CONFIG.MAX_HP);
        player.hp = newHp;
        
        if (newHp === 0) {
          player.status = 'dead';
        } else if (player.status === 'dead' && newHp > 0) {
          player.status = 'alive';
        }

        battle.lastActivity = Date.now();

        broadcast(session.battleId, "hp:update", {
          playerId: player.id,
          hp: player.hp,
          status: player.status,
          timestamp: Date.now()
        });
        
        updateSession(socket.id, {});
      } catch (error) {
        console.error(`[Broadcast] HP 업데이트 오류:`, error.message);
      }
    });

    // 연결 해제 처리
    socket.on("disconnect", (reason) => {
      try {
        const session = removeSession(socket.id);
        
        if (session?.battleId) {
          const battle = battles.get(session.battleId);
          
          if (session.role === 'spectator' && battle) {
            battle.stats.spectatorCount = Math.max(0, battle.stats.spectatorCount - 1);
            addLogToBattle(session.battleId, `관전자 ${session.spectatorName || '익명'}이 퇴장했습니다.`);
          } else if (session.role === 'player' && session.playerId && battle) {
            const player = battle.players.get(session.playerId);
            if (player) {
              addLogToBattle(session.battleId, `${player.name}이 연결을 끊었습니다.`);
            }
          }
          
          if (battle) {
            broadcastManager.leaveSocketFromRooms(socket, session.battleId, session.role, session.team);
            broadcast(session.battleId, "connection:update", {
              type: 'disconnect',
              role: session.role,
              playerId: session.playerId,
              spectatorName: session.spectatorName
            });
          }
        }
        
        console.log(`[Broadcast] 연결 해제: ${socket.id} (${reason}) - Role: ${session?.role || 'unknown'}`);
      } catch (error) {
        console.error(`[Broadcast] 연결 해제 처리 오류:`, error.message);
      }
    });

    // 에러 핸들링
    socket.on("error", (error) => {
      console.error(`[Broadcast] 소켓 오류 ${socket.id}:`, error);
      const session = activeSessions.get(socket.id);
      if (session) {
        console.error(`[Broadcast] 세션 정보: ${JSON.stringify(session)}`);
      }
    });

    // 연결 성공 알림
    socket.emit('connection:ready', {
      socketId: socket.id,
      timestamp: Date.now(),
      message: 'PYXIS 브로드캐스트 허브에 연결되었습니다',
      version: '2.0.0',
      features: ['enhanced-security', 'rate-limiting', 'team-chat', 'real-time-sync']
    });
  });

  // 정리 작업 스케줄러
  const cleanupInterval = setInterval(() => {
    try {
      rateLimiter.cleanup();
      
      const now = Date.now();
      const sessionTimeout = SECURITY_CONFIG.SESSION_TIMEOUT;
      const battleTimeout = 4 * 60 * 60 * 1000; // 4시간
      
      // 오래된 세션 정리
      for (const [socketId, session] of activeSessions.entries()) {
        if (now - session.lastActivity > sessionTimeout) {
          console.log(`[Cleanup] 비활성 세션 제거: ${socketId}`);
          activeSessions.delete(socketId);
        }
      }
      
      // 오래된 전투 정리
      for (const [battleId, battle] of battles.entries()) {
        if (now - battle.lastActivity > battleTimeout) {
          console.log(`[Cleanup] 비활성 전투 제거: ${battleId}`);
          battles.delete(battleId);
        }
      }
      
      // 연결 메트릭스 정리
      for (const [key, timestamp] of connectionMetrics.entries()) {
        if (now - timestamp > 60 * 60 * 1000) { // 1시간
          connectionMetrics.delete(key);
        }
      }
    } catch (error) {
      console.error(`[Cleanup] 정리 작업 오류:`, error.message);
    }
  }, 60 * 1000); // 1분마다

  // 통계 수집
  function getStats() {
    const now = Date.now();
    const activeConnections = activeSessions.size;
    const activeBattles = battles.size;
    
    const roleStats = {};
    const battleStats = {};
    
    for (const session of activeSessions.values()) {
      roleStats[session.role] = (roleStats[session.role] || 0) + 1;
      if (session.battleId) {
        battleStats[session.battleId] = (battleStats[session.battleId] || 0) + 1;
      }
    }
    
    return {
      timestamp: now,
      connections: {
        total: activeConnections,
        byRole: roleStats,
        byBattle: battleStats
      },
      battles: {
        total: activeBattles,
        active: Array.from(battles.values()).filter(b => b.status === 'ongoing').length,
        waiting: Array.from(battles.values()).filter(b => b.status === 'waiting').length
      },
      performance: {
        rateLimiterSize: rateLimiter.requests.size,
        ipConnections: rateLimiter.ipConnections.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      },
      broadcastManager: broadcastManager.getSystemStats()
    };
  }

  // 정리 함수
  function cleanup() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }
    
    // 모든 활성 연결 정리
    for (const socketId of activeSessions.keys()) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    }
    
    activeSessions.clear();
    battles.clear();
    connectionMetrics.clear();
    
    if (broadcastManager.destroy) {
      broadcastManager.destroy();
    }
    
    console.log('[Broadcast] 허브 정리 완료');
  }

  // 종료 시 정리
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  console.log('[Broadcast] PYXIS Enhanced Broadcast Hub 초기화 완료');
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
    
    // 고급 기능들
    addLogToBattle,
    ensureBattle,
    validatePlayerData,
    
    // BroadcastManager 접근
    broadcastManager
  };
}

// 모듈 내보내기
module.exports = { 
  attach, 
  battles,
  
  // 유틸리티 함수들
  sanitizeString,
  validateNumber,
  validateTeam,
  validatePlayerData,
  validateStats,
  
  // 설정
  SECURITY_CONFIG
};
