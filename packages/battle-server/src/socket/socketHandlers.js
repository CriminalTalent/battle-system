// packages/battle-server/src/socket/socketHandlers.js
// Enhanced PYXIS Socket Handlers - 통합 소켓 이벤트 처리 시스템
// - 강화된 보안 및 인증 시스템
// - 포괄적인 에러 처리 및 검증
// - 실시간 모니터링 및 로깅
// - BattleEngine 및 BroadcastManager와의 완전 통합

"use strict";

const BattleEngine = require('../engine/BattleEngine');
const OTPManager = require('../utils/OTPManager');
const broadcastManager = require('./broadcast/broadcastManager');

// 보안 설정
const SECURITY_CONFIG = {
  MAX_BATTLES_PER_IP: 3,
  MAX_ACTIONS_PER_MINUTE: 30,
  MAX_MESSAGE_LENGTH: 500,
  MAX_NICKNAME_LENGTH: 50,
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30분
  BATTLE_TIMEOUT: 2 * 60 * 60 * 1000, // 2시간
  OTP_EXPIRY: 30 * 60 * 1000, // 30분
  MAX_SPECTATORS: 30
};

// 전역 상태 관리
const activeBattles = new Map(); // battleId -> BattleEngine
const playerSessions = new Map(); // socketId -> sessionData
const rateLimits = new Map(); // socketId -> { actions: [], lastActivity: timestamp }
const ipBattleCount = new Map(); // ip -> battleCount
const otpManager = new OTPManager();

// 유틸리티 함수들
function sanitizeInput(input, maxLength = SECURITY_CONFIG.MAX_MESSAGE_LENGTH) {
  if (typeof input !== 'string') return '';
  return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
            .replace(/[<>\"'&]/g, '')
            .trim()
            .slice(0, maxLength);
}

function validateBattleId(battleId) {
  return typeof battleId === 'string' && 
         battleId.length >= 5 && 
         battleId.length <= 50 && 
         /^[a-zA-Z0-9_-]+$/.test(battleId);
}

function validatePlayerId(playerId) {
  return typeof playerId === 'string' && 
         playerId.length >= 1 && 
         playerId.length <= 50 && 
         /^[a-zA-Z0-9_-]+$/.test(playerId);
}

function isRateLimited(socketId) {
  const now = Date.now();
  if (!rateLimits.has(socketId)) {
    rateLimits.set(socketId, { actions: [], lastActivity: now });
  }
  
  const limits = rateLimits.get(socketId);
  
  // 1분 이전 액션들 제거
  limits.actions = limits.actions.filter(timestamp => now - timestamp < 60000);
  
  if (limits.actions.length >= SECURITY_CONFIG.MAX_ACTIONS_PER_MINUTE) {
    return true;
  }
  
  limits.actions.push(now);
  limits.lastActivity = now;
  return false;
}

function trackIPBattle(ip, increment = true) {
  const current = ipBattleCount.get(ip) || 0;
  const newCount = Math.max(0, current + (increment ? 1 : -1));
  
  if (newCount === 0) {
    ipBattleCount.delete(ip);
  } else {
    ipBattleCount.set(ip, newCount);
  }
  
  return newCount;
}

function createSession(socket, data) {
  const session = {
    socketId: socket.id,
    ip: socket.handshake.address,
    role: data.role || 'guest',
    battleId: data.battleId || null,
    playerId: data.playerId || null,
    spectatorName: data.spectatorName || null,
    joinedAt: Date.now(),
    lastActivity: Date.now(),
    authenticated: false,
    permissions: []
  };
  
  playerSessions.set(socket.id, session);
  return session;
}

function updateSession(socketId, updates) {
  const session = playerSessions.get(socketId);
  if (session) {
    Object.assign(session, updates);
    session.lastActivity = Date.now();
  }
  return session;
}

function removeSession(socketId) {
  const session = playerSessions.get(socketId);
  if (session) {
    playerSessions.delete(socketId);
    rateLimits.delete(socketId);
  }
  return session;
}

function logActivity(socket, action, data = {}, level = 'info') {
  const timestamp = new Date().toISOString();
  const session = playerSessions.get(socket.id);
  const logData = {
    timestamp,
    socketId: socket.id,
    ip: socket.handshake.address,
    action,
    session: session ? {
      role: session.role,
      battleId: session.battleId,
      playerId: session.playerId
    } : null,
    data
  };
  
  if (level === 'error') {
    console.error(`[SocketHandler] ${action}:`, logData);
  } else if (level === 'warn') {
    console.warn(`[SocketHandler] ${action}:`, logData);
  } else {
    console.log(`[SocketHandler] ${action}:`, logData);
  }
}

function sendError(socket, error, code = 'UNKNOWN_ERROR', data = {}) {
  socket.emit('error', {
    code,
    message: typeof error === 'string' ? error : error.message,
    timestamp: Date.now(),
    data
  });
  
  logActivity(socket, 'ERROR_SENT', { code, message: error.message || error }, 'error');
}

function requireAuthentication(socket, session) {
  if (!session || !session.authenticated) {
    sendError(socket, '인증이 필요합니다', 'AUTH_REQUIRED');
    return false;
  }
  return true;
}

function requireRole(socket, session, requiredRole) {
  if (!requireAuthentication(socket, session)) return false;
  
  if (session.role !== requiredRole) {
    sendError(socket, '권한이 없습니다', 'INSUFFICIENT_PERMISSIONS', { required: requiredRole });
    return false;
  }
  return true;
}

// 메인 소켓 핸들러 함수
function socketHandlers(io) {
  // BroadcastManager 초기화
  broadcastManager.init(io, {
    verbose: process.env.NODE_ENV === 'development',
    enableMetrics: true,
    batchEnabled: true
  });

  io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    logActivity(socket, 'CONNECTED', { ip: clientIp });

    // 기본 세션 생성
    const session = createSession(socket, { role: 'guest' });

    // 전투 생성
    socket.on('createBattle', async ({ players, battleId, mode = '2v2' }, callback) => {
      try {
        if (isRateLimited(socket.id)) {
          return sendError(socket, '요청이 너무 빈번합니다', 'RATE_LIMITED');
        }

        // IP별 전투 생성 제한
        if (trackIPBattle(clientIp, false) >= SECURITY_CONFIG.MAX_BATTLES_PER_IP) {
          return sendError(socket, 'IP당 최대 전투 생성 수를 초과했습니다', 'IP_BATTLE_LIMIT');
        }

        if (!validateBattleId(battleId)) {
          return sendError(socket, '잘못된 전투 ID 형식입니다', 'INVALID_BATTLE_ID');
        }

        if (activeBattles.has(battleId)) {
          return sendError(socket, '이미 존재하는 전투 ID입니다', 'BATTLE_EXISTS');
        }

        // 플레이어 데이터 검증
        if (!Array.isArray(players) || players.length === 0) {
          return sendError(socket, '플레이어 정보가 필요합니다', 'MISSING_PLAYERS');
        }

        const validatedPlayers = players.map(player => {
          if (!player.name || !player.id) {
            throw new Error('플레이어 이름과 ID가 필요합니다');
          }
          
          return {
            id: sanitizeInput(player.id, 50),
            name: sanitizeInput(player.name, 50),
            team: ['A', 'B'].includes(player.team) ? player.team : 'A',
            stats: {
              attack: Math.max(1, Math.min(10, parseInt(player.stats?.attack) || 3)),
              defense: Math.max(1, Math.min(10, parseInt(player.stats?.defense) || 3)),
              agility: Math.max(1, Math.min(10, parseInt(player.stats?.agility) || 3)),
              luck: Math.max(1, Math.min(10, parseInt(player.stats?.luck) || 3))
            },
            hp: Math.max(1, Math.min(1000, parseInt(player.hp) || 100)),
            maxHp: Math.max(1, Math.min(1000, parseInt(player.maxHp) || 100)),
            items: player.items || { dittany: 1, attackBoost: 1, defenseBoost: 1 }
          };
        });

        // 전투 엔진 생성
        const engine = new BattleEngine(battleId, validatedPlayers, io, () => {
          activeBattles.delete(battleId);
          trackIPBattle(clientIp, false); // 전투 종료시 카운트 감소
          logActivity(socket, 'BATTLE_ENDED', { battleId });
        });

        activeBattles.set(battleId, engine);
        trackIPBattle(clientIp, true);

        // 관리자로 세션 업데이트 및 룸 참여
        updateSession(socket.id, {
          role: 'admin',
          battleId,
          authenticated: true,
          permissions: ['manage_battle', 'view_all', 'moderate_chat']
        });

        broadcastManager.joinSocketToRooms(socket, battleId, 'admin', null, { withRoleRooms: true });

        socket.emit('battleCreated', {
          battleId,
          adminOtp: engine.adminOtp,
          spectatorOtp: engine.spectatorOtp,
          players: validatedPlayers.map(p => ({ ...p, id: p.id })),
          timestamp: Date.now()
        });

        if (callback) callback({ success: true, battleId });

        logActivity(socket, 'BATTLE_CREATED', {
          battleId,
          mode,
          playerCount: validatedPlayers.length
        });

      } catch (error) {
        trackIPBattle(clientIp, false); // 실패시 카운트 복원
        logActivity(socket, 'BATTLE_CREATE_ERROR', { error: error.message }, 'error');
        sendError(socket, error.message, 'BATTLE_CREATE_FAILED');
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // 전투 참여
    socket.on('joinBattle', ({ battleId, playerId, role = 'player', otp }, callback) => {
      try {
        if (isRateLimited(socket.id)) {
          return sendError(socket, '요청이 너무 빈번합니다', 'RATE_LIMITED');
        }

        if (!validateBattleId(battleId)) {
          return sendError(socket, '잘못된 전투 ID입니다', 'INVALID_BATTLE_ID');
        }

        const engine = activeBattles.get(battleId);
        if (!engine) {
          return sendError(socket, '존재하지 않는 전투입니다', 'BATTLE_NOT_FOUND');
        }

        let teamKey = null;
        let authenticated = false;

        // 역할별 인증 처리
        if (role === 'admin') {
          if (engine.adminOtp !== otp) {
            return sendError(socket, '잘못된 관리자 OTP입니다', 'INVALID_ADMIN_OTP');
          }
          authenticated = true;
        } else if (role === 'player') {
          if (!validatePlayerId(playerId)) {
            return sendError(socket, '잘못된 플레이어 ID입니다', 'INVALID_PLAYER_ID');
          }

          const player = engine.getPlayer(playerId);
          if (!player) {
            return sendError(socket, '존재하지 않는 플레이어입니다', 'PLAYER_NOT_FOUND');
          }

          if (player.token !== otp) {
            return sendError(socket, '잘못된 플레이어 토큰입니다', 'INVALID_PLAYER_TOKEN');
          }

          teamKey = player.team === 'A' ? 'phoenix' : 'eaters';
          authenticated = true;
        } else if (role === 'spectator') {
          if (!otpManager.validateOTP(otp)) {
            return sendError(socket, '잘못된 관전자 OTP입니다', 'INVALID_SPECTATOR_OTP');
          }
          authenticated = true;
        }

        if (!authenticated) {
          return sendError(socket, '인증 실패', 'AUTH_FAILED');
        }

        // 세션 업데이트 및 룸 참여
        updateSession(socket.id, {
          role,
          battleId,
          playerId,
          authenticated: true,
          permissions: role === 'admin' ? ['manage_battle', 'view_all'] : 
                      role === 'player' ? ['play_game', 'team_chat'] : 
                      ['view_only']
        });

        broadcastManager.joinSocketToRooms(socket, battleId, role, teamKey, {
          withRoleRooms: role === 'admin'
        });

        // 참여 알림
        const joinData = {
          socketId: socket.id,
          role,
          playerId,
          spectatorName: role === 'spectator' ? otpManager.getNickname(otp) : null,
          timestamp: Date.now()
        };

        broadcastManager.broadcastPlayerEvent(battleId, 'join', joinData);

        socket.emit('joinSuccess', {
          battleId,
          role,
          playerId,
          state: engine.getSnapshot(),
          timestamp: Date.now()
        });

        if (callback) callback({ success: true });

        logActivity(socket, 'JOINED_BATTLE', {
          battleId,
          role,
          playerId,
          teamKey
        });

      } catch (error) {
        logActivity(socket, 'JOIN_BATTLE_ERROR', { error: error.message }, 'error');
        sendError(socket, error.message, 'JOIN_FAILED');
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // 플레이어 액션
    socket.on('playerAction', ({ battleId, playerId, action }, callback) => {
      try {
        const session = playerSessions.get(socket.id);
        
        if (!requireRole(socket, session, 'player')) return;
        if (isRateLimited(socket.id)) {
          return sendError(socket, '액션이 너무 빈번합니다', 'ACTION_RATE_LIMITED');
        }

        if (!validateBattleId(battleId) || !validatePlayerId(playerId)) {
          return sendError(socket, '잘못된 요청 데이터입니다', 'INVALID_REQUEST');
        }

        if (session.battleId !== battleId || session.playerId !== playerId) {
          return sendError(socket, '권한이 없는 액션입니다', 'UNAUTHORIZED_ACTION');
        }

        const engine = activeBattles.get(battleId);
        if (!engine) {
          return sendError(socket, '전투를 찾을 수 없습니다', 'BATTLE_NOT_FOUND');
        }

        // 액션 검증
        if (!action || typeof action !== 'object') {
          return sendError(socket, '잘못된 액션 데이터입니다', 'INVALID_ACTION');
        }

        const validActionTypes = ['attack', 'defend', 'dodge', 'item', 'pass'];
        if (!validActionTypes.includes(action.type)) {
          return sendError(socket, '알 수 없는 액션 타입입니다', 'UNKNOWN_ACTION_TYPE');
        }

        // 액션 실행
        const result = engine.performAction(playerId, action);
        
        updateSession(socket.id, {});

        socket.emit('actionResult', {
          success: true,
          result,
          timestamp: Date.now()
        });

        if (callback) callback({ success: true, result });

        logActivity(socket, 'PLAYER_ACTION', {
          battleId,
          playerId,
          actionType: action.type,
          target: action.target
        });

      } catch (error) {
        logActivity(socket, 'PLAYER_ACTION_ERROR', { 
          error: error.message,
          battleId,
          playerId,
          action 
        }, 'error');
        
        sendError(socket, error.message, 'ACTION_FAILED');
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // 관전자 OTP 검증
    socket.on('validateSpectator', ({ otp }, callback) => {
      try {
        if (isRateLimited(socket.id)) {
          return callback({ valid: false, error: 'rate_limited' });
        }

        const valid = otpManager.validateOTP(otp);
        if (valid) {
          const nickname = otpManager.getNickname(otp);
          callback({ 
            valid: true, 
            nickname: sanitizeInput(nickname, SECURITY_CONFIG.MAX_NICKNAME_LENGTH),
            timestamp: Date.now()
          });
          
          logActivity(socket, 'SPECTATOR_VALIDATED', { nickname });
        } else {
          callback({ valid: false, error: 'invalid_otp' });
          logActivity(socket, 'SPECTATOR_VALIDATION_FAILED', { otp: otp?.substring(0, 4) + '***' });
        }

      } catch (error) {
        logActivity(socket, 'SPECTATOR_VALIDATION_ERROR', { error: error.message }, 'error');
        callback({ valid: false, error: 'validation_error' });
      }
    });

    // 관전자 OTP 생성
    socket.on('generateSpectatorOtp', ({ nickname, battleId }, callback) => {
      try {
        const session = playerSessions.get(socket.id);
        
        if (!requireRole(socket, session, 'admin')) {
          return callback({ success: false, reason: 'unauthorized' });
        }

        if (isRateLimited(socket.id)) {
          return callback({ success: false, reason: 'rate_limited' });
        }

        const cleanNickname = sanitizeInput(nickname, SECURITY_CONFIG.MAX_NICKNAME_LENGTH);
        if (!cleanNickname) {
          return callback({ success: false, reason: 'invalid_nickname' });
        }

        const currentCount = otpManager.getActiveOTPCount();
        if (currentCount >= SECURITY_CONFIG.MAX_SPECTATORS) {
          return callback({ 
            success: false, 
            reason: 'max_spectators_exceeded',
            maxSpectators: SECURITY_CONFIG.MAX_SPECTATORS
          });
        }

        const otp = otpManager.generateOTP(cleanNickname, SECURITY_CONFIG.OTP_EXPIRY);
        if (!otp) {
          return callback({ success: false, reason: 'generation_failed' });
        }

        callback({ 
          success: true, 
          otp,
          nickname: cleanNickname,
          expiresAt: Date.now() + SECURITY_CONFIG.OTP_EXPIRY,
          timestamp: Date.now()
        });

        logActivity(socket, 'SPECTATOR_OTP_GENERATED', { 
          nickname: cleanNickname,
          battleId,
          currentOTPCount: currentCount + 1
        });

      } catch (error) {
        logActivity(socket, 'SPECTATOR_OTP_ERROR', { error: error.message }, 'error');
        callback({ success: false, reason: 'internal_error' });
      }
    });

    // 전투 상태 조회
    socket.on('getBattleState', ({ battleId }, callback) => {
      try {
        const session = playerSessions.get(socket.id);
        
        if (!requireAuthentication(socket, session)) return;

        if (!validateBattleId(battleId)) {
          return sendError(socket, '잘못된 전투 ID입니다', 'INVALID_BATTLE_ID');
        }

        const engine = activeBattles.get(battleId);
        if (!engine) {
          return sendError(socket, '전투를 찾을 수 없습니다', 'BATTLE_NOT_FOUND');
        }

        const state = engine.getSnapshot();
        
        if (callback) {
          callback({ success: true, state, timestamp: Date.now() });
        } else {
          socket.emit('battleState', state);
        }

        updateSession(socket.id, {});

      } catch (error) {
        logActivity(socket, 'GET_BATTLE_STATE_ERROR', { error: error.message }, 'error');
        sendError(socket, error.message, 'STATE_FETCH_FAILED');
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // 채팅 메시지
    socket.on('chatMessage', ({ battleId, message, channel = 'all' }, callback) => {
      try {
        const session = playerSessions.get(socket.id);
        
        if (!requireAuthentication(socket, session)) return;
        if (isRateLimited(socket.id)) {
          return sendError(socket, '메시지를 너무 빈번하게 보내고 있습니다', 'CHAT_RATE_LIMITED');
        }

        const cleanMessage = sanitizeInput(message, SECURITY_CONFIG.MAX_MESSAGE_LENGTH);
        if (!cleanMessage.trim()) {
          return sendError(socket, '빈 메시지는 보낼 수 없습니다', 'EMPTY_MESSAGE');
        }

        if (session.battleId !== battleId) {
          return sendError(socket, '전투에 참여하지 않았습니다', 'NOT_IN_BATTLE');
        }

        const chatData = {
          sender: session.role === 'player' ? session.playerId : 
                 session.role === 'spectator' ? session.spectatorName : '관리자',
          role: session.role,
          message: cleanMessage,
          channel,
          timestamp: Date.now()
        };

        broadcastManager.broadcastChat(battleId, chatData);
        
        if (callback) callback({ success: true });
        updateSession(socket.id, {});

        logActivity(socket, 'CHAT_MESSAGE', {
          battleId,
          channel,
          messageLength: cleanMessage.length
        });

      } catch (error) {
        logActivity(socket, 'CHAT_ERROR', { error: error.message }, 'error');
        sendError(socket, error.message, 'CHAT_FAILED');
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // Ping/Pong for connection monitoring
    socket.on('ping', () => {
      const session = playerSessions.get(socket.id);
      if (session) {
        updateSession(socket.id, {});
      }
      socket.emit('pong', { timestamp: Date.now() });
    });

    // 연결 해제 처리
    socket.on('disconnect', (reason) => {
      try {
        const session = removeSession(socket.id);
        
        if (session?.battleId) {
          const engine = activeBattles.get(session.battleId);
          
          if (session.role === 'admin' && session.battleId) {
            trackIPBattle(session.ip, false); // 관리자 연결 해제시 전투 카운트 감소
          }

          if (engine) {
            broadcastManager.broadcastPlayerEvent(session.battleId, 'leave', {
              socketId: socket.id,
              role: session.role,
              playerId: session.playerId,
              spectatorName: session.spectatorName,
              timestamp: Date.now()
            });
          }

          broadcastManager.leaveSocketFromRooms(socket, session.battleId, session.role, 
            session.playerId ? (engine?.getPlayer(session.playerId)?.team === 'A' ? 'phoenix' : 'eaters') : null,
            { withRoleRooms: session.role === 'admin' }
          );
        }

        logActivity(socket, 'DISCONNECTED', {
          reason,
          session: session ? {
            role: session.role,
            battleId: session.battleId,
            duration: Date.now() - session.joinedAt
          } : null
        });

      } catch (error) {
        console.error(`[SocketHandler] 연결 해제 처리 오류:`, error);
      }
    });

    // 에러 핸들링
    socket.on('error', (error) => {
      logActivity(socket, 'SOCKET_ERROR', { error: error.message }, 'error');
    });

    // 연결 성공 알림
    socket.emit('connected', {
      socketId: socket.id,
      timestamp: Date.now(),
      message: 'PYXIS 전투 시스템에 연결되었습니다',
      version: '2.0.0',
      features: [
        'enhanced-security',
        'rate-limiting', 
        'comprehensive-validation',
        'real-time-monitoring',
        'team-chat',
        'spectator-system'
      ]
    });
  });

  // 정리 작업 스케줄러
  const cleanupInterval = setInterval(() => {
    try {
      const now = Date.now();
      
      // 비활성 세션 정리
      for (const [socketId, session] of playerSessions.entries()) {
        if (now - session.lastActivity > SECURITY_CONFIG.SESSION_TIMEOUT) {
          console.log(`[Cleanup] 비활성 세션 제거: ${socketId}`);
          playerSessions.delete(socketId);
          rateLimits.delete(socketId);
        }
      }
      
      // 오래된 전투 정리
      for (const [battleId, engine] of activeBattles.entries()) {
        if (now - engine.created > SECURITY_CONFIG.BATTLE_TIMEOUT) {
          console.log(`[Cleanup] 오래된 전투 제거: ${battleId}`);
          engine.cleanup?.();
          activeBattles.delete(battleId);
        }
      }
      
      // OTP 정리
      otpManager.cleanup?.();
      
    } catch (error) {
      console.error(`[Cleanup] 정리 작업 오류:`, error);
    }
  }, 60 * 1000); // 1분마다

  // 통계 수집
  function getStats() {
    return {
      timestamp: Date.now(),
      activeBattles: activeBattles.size,
      activeSessions: playerSessions.size,
      sessionsByRole: Array.from(playerSessions.values()).reduce((acc, session) => {
        acc[session.role] = (acc[session.role] || 0) + 1;
        return acc;
      }, {}),
      ipBattleCounts: Object.fromEntries(ipBattleCount),
      rateLimitTracking: rateLimits.size,
      activeOTPs: otpManager.getActiveOTPCount?.() || 0,
      broadcastStats: broadcastManager.getSystemStats()
    };
  }

  // 정리 함수
  function cleanup() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }
    
    // 모든 활성 전투 정리
    for (const engine of activeBattles.values()) {
      try {
        engine.cleanup?.();
      } catch (error) {
        console.error('전투 정리 오류:', error);
      }
    }
    
    activeBattles.clear();
    playerSessions.clear();
    rateLimits.clear();
    ipBattleCount.clear();
    
    if (otpManager.cleanup) {
      otpManager.cleanup();
    }
    
    console.log('[SocketHandler] 정리 완료');
  }

  // 종료 시 정리
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  console.log('[SocketHandler] Enhanced PYXIS Socket Handlers 초기화 완료');
  
  return {
    getStats,
    cleanup,
    activeBattles,
    playerSessions,
    otpManager
  };
}

module.exports = socketHandlers;
