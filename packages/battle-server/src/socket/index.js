// PYXIS Socket Handler - 완전히 새로운 소켓 이벤트 핸들러
const adminHandler = require('./handlers/adminHandler');
const playerHandler = require('./handlers/playerHandler');
const spectatorHandler = require('./handlers/spectatorHandler');
const chatHandler = require('./handlers/chatHandler');
const broadcastManager = require('./broadcast/broadcastManager');

// 전투 로직 (선택적)
let battleEngine = null;
try {
  battleEngine = require('../services/BattleEngine');
} catch (e) {
  console.warn('[Socket] BattleEngine not found, using mock');
}

module.exports = function initSocket(io) {
  console.log('[Socket] Initializing PYXIS Socket System');

  // 브로드캐스트 매니저 초기화
  broadcastManager.init(io);

  // 소켓 연결 처리
  io.on('connection', (socket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    // 소켓 인증 정보 초기화
    socket.auth = {
      battleId: null,
      role: null,        // 'admin' | 'player' | 'spectator'
      playerId: null,
      spectatorName: null,
      teamKey: null,     // 'team1' | 'team2'
      authenticated: false
    };

    // 공통 유틸리티 함수들
    const utils = createSocketUtils(socket, io);

    // === 연결 상태 이벤트 ===
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] ${socket.id} disconnected: ${reason}`);
      handleDisconnect(socket, reason, utils);
    });

    socket.on('error', (error) => {
      console.error(`[Socket] ${socket.id} error:`, error);
      socket.emit('error', { message: '소켓 오류가 발생했습니다' });
    });

    // === 인증 핸들러 ===
    
    // 관리자 인증
    socket.on('adminAuth', (data) => {
      adminHandler.authenticate(socket, data, utils);
    });

    // 플레이어 인증
    socket.on('playerAuth', (data) => {
      playerHandler.authenticate(socket, data, utils);
    });

    // 관전자 인증
    socket.on('spectatorAuth', (data) => {
      spectatorHandler.authenticate(socket, data, utils);
    });

    // === 관리자 전용 이벤트 ===
    socket.on('admin:startBattle', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.startBattle(socket, data, utils);
    });

    socket.on('admin:pauseBattle', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.pauseBattle(socket, data, utils);
    });

    socket.on('admin:endBattle', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.endBattle(socket, data, utils);
    });

    socket.on('admin:addPlayer', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.addPlayer(socket, data, utils);
    });

    socket.on('admin:removePlayer', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.removePlayer(socket, data, utils);
    });

    socket.on('admin:chat', (data) => {
      if (socket.auth.role !== 'admin') return;
      chatHandler.handleAdminChat(socket, data, utils);
    });

    socket.on('admin:requestState', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.requestState(socket, data, utils);
    });

    socket.on('admin:notice', (data) => {
      if (socket.auth.role !== 'admin') return;
      adminHandler.updateNotice(socket, data, utils);
    });

    // === 플레이어 전용 이벤트 ===
    socket.on('player:action', (data) => {
      if (socket.auth.role !== 'player') return;
      playerHandler.handleAction(socket, data, utils);
    });

    socket.on('playerAction', (data) => {  // 레거시 지원
      if (socket.auth.role !== 'player') return;
      playerHandler.handleAction(socket, data, utils);
    });

    socket.on('player:requestState', (data) => {
      if (socket.auth.role !== 'player') return;
      playerHandler.requestState(socket, data, utils);
    });

    // === 관전자 전용 이벤트 ===
    socket.on('spectator:join', (data) => {
      spectatorHandler.joinBattle(socket, data, utils);
    });

    socket.on('spectator:cheer', (data) => {
      if (socket.auth.role !== 'spectator') return;
      spectatorHandler.handleCheer(socket, data, utils);
    });

    socket.on('cheer', (data) => {  // 레거시 지원
      if (socket.auth.role !== 'spectator') return;
      spectatorHandler.handleCheer(socket, data, utils);
    });

    socket.on('spectator:requestState', (data) => {
      if (socket.auth.role !== 'spectator') return;
      spectatorHandler.requestState(socket, data, utils);
    });

    // === 채팅 이벤트 (공통) ===
    socket.on('chat:send', (data) => {
      if (!socket.auth.authenticated) return;
      chatHandler.handleChat(socket, data, utils);
    });

    socket.on('send-chat', (data) => {  // 레거시 지원
      if (!socket.auth.authenticated) return;
      chatHandler.handleChat(socket, data, utils);
    });

    socket.on('chatMessage', (data) => {  // 레거시 지원
      if (!socket.auth.authenticated) return;
      chatHandler.handleChat(socket, data, utils);
    });

    // === 상태 동기화 ===
    socket.on('ping', () => {
      socket.emit('pong');
    });

    socket.on('heartbeat', () => {
      socket.emit('heartbeat', { timestamp: Date.now() });
    });
  });

  return io;
};

// 소켓 유틸리티 함수 생성
function createSocketUtils(socket, io) {
  return {
    // 룸 관리
    joinRoom: (roomName) => {
      socket.join(roomName);
      console.log(`[Socket] ${socket.id} joined room: ${roomName}`);
    },

    leaveRoom: (roomName) => {
      socket.leave(roomName);
      console.log(`[Socket] ${socket.id} left room: ${roomName}`);
    },

    // 브로드캐스트 헬퍼
    broadcast: broadcastManager,

    // 응답 헬퍼
    success: (event, data = {}) => {
      socket.emit(event, { ok: true, ...data });
    },

    error: (event, message) => {
      socket.emit(event, { ok: false, message });
    },

    // 전투 엔진 접근
    battleEngine: battleEngine,

    // 인증 체크
    requireAuth: () => {
      if (!socket.auth.authenticated) {
        throw new Error('인증이 필요합니다');
      }
    },

    requireRole: (role) => {
      if (socket.auth.role !== role) {
        throw new Error(`${role} 권한이 필요합니다`);
      }
    },

    // 로깅
    log: (message, data = null) => {
      console.log(`[Socket:${socket.id}] ${message}`, data || '');
    },

    error: (message, error = null) => {
      console.error(`[Socket:${socket.id}] ${message}`, error || '');
    }
  };
}

// 연결 해제 처리
function handleDisconnect(socket, reason, utils) {
  const { auth } = socket;
  
  if (auth.authenticated && auth.battleId) {
    // 역할별 정리 작업
    switch (auth.role) {
      case 'admin':
        adminHandler.handleDisconnect(socket, utils);
        break;
      case 'player':
        playerHandler.handleDisconnect(socket, utils);
        break;
      case 'spectator':
        spectatorHandler.handleDisconnect(socket, utils);
        break;
    }

    // 브로드캐스트: 연결 해제 알림
    utils.broadcast.toRoom(auth.battleId, 'user:disconnected', {
      role: auth.role,
      userId: auth.playerId || auth.spectatorName,
      reason: reason
    });
  }
}
