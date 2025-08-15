const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const BattleEngine = require('./services/BattleEngine');
const TokenService = require('./services/TokenService');
const { BATTLE_STATUS } = require('./utils/rules');

// Express 앱 생성
const app = express();
const server = http.createServer(app);

// Socket.IO 설정
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// 서비스 인스턴스 생성
const battleEngine = new BattleEngine(console);
const tokenService = new TokenService({
  secret: process.env.JWT_SECRET,
  logger: console
});

// 미들웨어 설정
app.use(helmet({
  contentSecurityPolicy: false // Socket.IO 연결을 위해 비활성화
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS 설정
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100 요청
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// API 라우트
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    activeBattles: battleEngine.getActiveBattleCount()
  });
});

// 전투 생성 API
app.post('/api/battles', async (req, res) => {
  try {
    const { participantA, participantB, settings = {} } = req.body;

    // 입력 유효성 검사
    if (!participantA || !participantB) {
      return res.status(400).json({ error: 'Missing participant data' });
    }

    if (!participantA.name || !participantB.name) {
      return res.status(400).json({ error: 'Participant names are required' });
    }

    // 전투 생성
    const battle = battleEngine.createBattle({
      participantA: {
        id: participantA.id || `player_a_${Date.now()}`,
        name: participantA.name,
        image: participantA.image,
        stats: participantA.stats
      },
      participantB: {
        id: participantB.id || `player_b_${Date.now()}`,
        name: participantB.name,
        image: participantB.image,
        stats: participantB.stats
      },
      ruleset: settings.ruleset || 'standard',
      turnTimeLimit: settings.turnTimeLimit,
      maxTurns: settings.maxTurns,
      autoStart: settings.autoStart
    });

    // 토큰 생성
    const tokens = tokenService.generateBattleTokens(
      battle.id,
      battle.participants.A,
      battle.participants.B,
      { baseUrl: req.protocol + '://' + req.get('host') }
    );

    res.status(201).json({
      battleId: battle.id,
      tokens,
      battle: battleEngine.serializeBattleState(battle, 'admin')
    });

  } catch (error) {
    console.error('Error creating battle:', error);
    res.status(500).json({ error: 'Failed to create battle' });
  }
});

// 전투 조회 API
app.get('/api/battles/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = battleEngine.getBattle(battleId);

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    res.json({
      battle: battleEngine.serializeBattleState(battle, 'spectator')
    });

  } catch (error) {
    console.error('Error fetching battle:', error);
    res.status(500).json({ error: 'Failed to fetch battle' });
  }
});

// 전투 목록 조회 API (관리자용)
app.get('/api/admin/battles', async (req, res) => {
  try {
    const battles = battleEngine.getAllBattles();
    res.json({ battles });
  } catch (error) {
    console.error('Error fetching battles:', error);
    res.status(500).json({ error: 'Failed to fetch battles' });
  }
});

// 토큰 검증 API
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const verification = tokenService.verifyToken(token);

    if (!verification.valid) {
      return res.status(401).json({ 
        error: verification.error,
        code: verification.code 
      });
    }

    res.json({
      valid: true,
      payload: verification.payload,
      tokenType: verification.tokenType
    });

  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // 전투 참가
  socket.on('join_battle', async (data) => {
    try {
      const { token } = data;

      if (!token) {
        socket.emit('error', { message: 'Token is required' });
        return;
      }

      // 토큰 검증
      const verification = tokenService.verifyToken(token, { markAsUsed: true });

      if (!verification.valid) {
        socket.emit('error', { 
          message: verification.error,
          code: verification.code 
        });
        return;
      }

      const payload = verification.payload;

      if (payload.type === 'participant') {
        // 참가자로 전투 참가
        const result = battleEngine.connectParticipant(
          payload.battleId,
          payload.participantId,
          socket.id
        );

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        const battle = battleEngine.getBattle(payload.battleId);
        const participantKey = result.participantKey;

        // 소켓을 전투 룸에 참가
        socket.join(payload.battleId);
        socket.battleId = payload.battleId;
        socket.participantId = payload.participantId;
        socket.participantKey = participantKey;
        socket.userType = 'participant';

        // 참가자에게 전투 상태 전송
        socket.emit('battle_joined', {
          battle: battleEngine.serializeBattleState(battle, 'participant', payload.participantId),
          role: participantKey
        });

        // 모든 참가자에게 업데이트 알림
        io.to(payload.battleId).emit('battle_update', {
          battle: battleEngine.serializeBattleState(battle, 'spectator')
        });

      } else if (payload.type === 'spectator') {
        // 관전자로 전투 참가
        const battle = battleEngine.getBattle(payload.battleId);

        if (!battle) {
          socket.emit('error', { message: 'Battle not found' });
          return;
        }

        battleEngine.addSpectator(payload.battleId, socket.id);

        socket.join(payload.battleId);
        socket.battleId = payload.battleId;
        socket.userType = 'spectator';

        // 관전자에게 전투 상태 전송
        socket.emit('battle_joined', {
          battle: battleEngine.serializeBattleState(battle, 'spectator'),
          isSpectator: true
        });

      } else {
        socket.emit('error', { message: 'Invalid token type' });
      }

    } catch (error) {
      console.error('Error joining battle:', error);
      socket.emit('error', { message: 'Failed to join battle' });
    }
  });

  // 액션 실행
  socket.on('player_action', async (data) => {
    try {
      if (socket.userType !== 'participant') {
        socket.emit('error', { message: 'Only participants can perform actions' });
        return;
      }

      const { action } = data;

      if (!action || !action.type) {
        socket.emit('error', { message: 'Invalid action' });
        return;
      }

      // 액션 실행
      const result = battleEngine.executeAction(
        socket.battleId,
        socket.participantId,
        action
      );

      if (!result.success) {
        socket.emit('action_failed', { 
          error: result.error,
          action 
        });
        return;
      }

      const battle = battleEngine.getBattle(socket.battleId);

      // 액션 결과를 모든 클라이언트에게 전송
      io.to(socket.battleId).emit('action_result', {
        battle: battleEngine.serializeBattleState(battle, 'spectator'),
        action: action,
        result: result.effects,
        logEntry: result.logEntry
      });

      // 전투가 종료되었는지 확인
      if (battle.status === BATTLE_STATUS.ENDED) {
        io.to(socket.battleId).emit('battle_ended', {
          battle: battleEngine.serializeBattleState(battle, 'spectator'),
          finalStats: result.logEntry.finalStats
        });
      } else {
        // 턴 변경 알림
        io.to(socket.battleId).emit('turn_changed', {
          currentTurn: battle.currentTurn,
          turnCount: battle.turnCount,
          turnStartTime: battle.turnStartTime
        });
      }

    } catch (error) {
      console.error('Error executing action:', error);
      socket.emit('error', { message: 'Failed to execute action' });
    }
  });

  // 전투 상태 요청
  socket.on('get_battle_state', () => {
    try {
      if (!socket.battleId) {
        socket.emit('error', { message: 'Not in a battle' });
        return;
      }

      const battle = battleEngine.getBattle(socket.battleId);

      if (!battle) {
        socket.emit('error', { message: 'Battle not found' });
        return;
      }

      const viewerType = socket.userType === 'participant' ? 'participant' : 'spectator';
      const viewerId = socket.userType === 'participant' ? socket.participantId : null;

      socket.emit('battle_state', {
        battle: battleEngine.serializeBattleState(battle, viewerType, viewerId)
      });

    } catch (error) {
      console.error('Error getting battle state:', error);
      socket.emit('error', { message: 'Failed to get battle state' });
    }
  });

  // 연결 해제 처리
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);

    if (socket.battleId) {
      if (socket.userType === 'participant') {
        // 참가자 연결 해제
        const disconnected = battleEngine.disconnectParticipant(socket.battleId, socket.id);
        
        if (disconnected) {
          const battle = battleEngine.getBattle(socket.battleId);
          if (battle) {
            // 다른 참가자들에게 연결 해제 알림
            socket.to(socket.battleId).emit('participant_disconnected', {
              participantId: socket.participantId,
              battle: battleEngine.serializeBattleState(battle, 'spectator')
            });
          }
        }
      } else if (socket.userType === 'spectator') {
        // 관전자 제거
        battleEngine.removeSpectator(socket.battleId, socket.id);
      }
    }
  });

  // 에러 처리
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// 정기적인 정리 작업
setInterval(() => {
  battleEngine.cleanup();
}, parseInt(process.env.CLEANUP_INTERVAL) || 300000); // 5분마다

// 에러 처리
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 처리
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 서버 시작
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Battle API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    tokenService.destroy();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    tokenService.destroy();
    process.exit(0);
  });
});

module.exports = { app, server, io, battleEngine, tokenService };
