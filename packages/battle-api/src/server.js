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
const battleEngine = new BattleEngine();

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
    activeBattles: battleEngine.battles.size
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    activeBattles: battleEngine.battles.size
  });
});

// 팀전 생성 API
app.post('/api/battles', async (req, res) => {
  try {
    const { mode = '1v1', settings = {} } = req.body;

    // 입력 유효성 검사
    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid battle mode' });
    }

    // 팀전 생성
    const battle = battleEngine.createBattle({
      mode: mode,
      turnTimeLimit: settings.turnTimeLimit || 30000,
      maxTurns: settings.maxTurns || 50,
      autoStart: settings.autoStart !== false
    });

    res.status(201).json({
      success: true,
      battleId: battle.id,
      battle: {
        id: battle.id,
        mode: battle.mode,
        status: battle.status,
        teams: battle.teams,
        createdAt: battle.createdAt
      }
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
      success: true,
      battle: serializeBattleForClient(battle)
    });

  } catch (error) {
    console.error('Error fetching battle:', error);
    res.status(500).json({ error: 'Failed to fetch battle' });
  }
});

// 전투 목록 조회 API (관리자용)
app.get('/api/admin/battles', async (req, res) => {
  try {
    const battles = Array.from(battleEngine.battles.values()).map(battle => ({
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      playerCount: battle.teams.team1.length + battle.teams.team2.length,
      createdAt: battle.createdAt
    }));
    
    res.json({ 
      success: true,
      battles: battles 
    });
  } catch (error) {
    console.error('Error fetching battles:', error);
    res.status(500).json({ error: 'Failed to fetch battles' });
  }
});

// 배틀 상태 직렬화 함수
function serializeBattleForClient(battle) {
  return {
    id: battle.id,
    status: battle.status,
    mode: battle.mode,
    teams: battle.teams,
    turnOrder: battle.turnOrder,
    currentTurnIndex: battle.currentTurnIndex,
    currentPlayer: battle.turnOrder ? battle.turnOrder[battle.currentTurnIndex] : null,
    initiativeRolls: battle.initiativeRolls,
    battleLogs: battle.battleLogs ? battle.battleLogs.slice(-20) : [], // 최근 20개 로그만
    createdAt: battle.createdAt
  };
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // 배틀 생성
  socket.on('create_battle', (data) => {
    try {
      const battle = battleEngine.createBattle({
        mode: data.mode || '1v1'
      });
      
      socket.emit('battle_created', {
        success: true,
        battleId: battle.id,
        battle: serializeBattleForClient(battle)
      });
    } catch (error) {
      console.error('Error creating battle:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 배틀 참가
  socket.on('join_battle', (data) => {
    try {
      const { battleId, playerName, maxHp, attack, defense, agility } = data;

      if (!battleId || !playerName) {
        socket.emit('error', { message: 'Battle ID and player name are required' });
        return;
      }

      const player = {
        id: socket.id,
        name: playerName,
        maxHp: maxHp || 100,
        attack: attack || 50,
        defense: defense || 30,
        agility: agility || 50
      };

      const battle = battleEngine.joinBattle(battleId, player);
      
      // 소켓을 배틀 룸에 참가
      socket.join(battleId);
      socket.battleId = battleId;
      socket.playerId = socket.id;
      
      // 모든 참가자에게 배틀 업데이트 전송
      io.to(battleId).emit('battle_updated', {
        success: true,
        battle: serializeBattleForClient(battle)
      });

    } catch (error) {
      console.error('Error joining battle:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 액션 실행
  socket.on('execute_action', (data) => {
    try {
      if (!socket.battleId) {
        socket.emit('error', { message: 'Not in a battle' });
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
        socket.id,
        action
      );

      const battle = battleEngine.getBattle(socket.battleId);
      
      // 액션 결과를 모든 클라이언트에게 전송
      io.to(socket.battleId).emit('action_result', {
        success: true,
        result: result,
        battle: serializeBattleForClient(battle)
      });

      // 전투가 종료되었는지 확인
      if (battle.status === 'ended') {
        io.to(socket.battleId).emit('battle_ended', {
          battle: serializeBattleForClient(battle)
        });
      }

    } catch (error) {
      console.error('Error executing action:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 배틀 상태 요청
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

      socket.emit('battle_state', {
        success: true,
        battle: serializeBattleForClient(battle)
      });

    } catch (error) {
      console.error('Error getting battle state:', error);
      socket.emit('error', { message: 'Failed to get battle state' });
    }
  });

  // 플레이어 준비 상태 토글
  socket.on('toggle_ready', () => {
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

      // 플레이어의 준비 상태 토글 로직 (필요시 구현)
      
      io.to(socket.battleId).emit('battle_updated', {
        success: true,
        battle: serializeBattleForClient(battle)
      });

    } catch (error) {
      console.error('Error toggling ready state:', error);
      socket.emit('error', { message: 'Failed to toggle ready state' });
    }
  });

  // 채팅 메시지 (관전자용)
  socket.on('chat_message', (data) => {
    try {
      if (!socket.battleId) {
        socket.emit('error', { message: 'Not in a battle' });
        return;
      }

      const { message } = data;
      
      if (!message || message.trim().length === 0) {
        return;
      }

      // 채팅 메시지를 같은 배틀의 모든 사용자에게 전송
      io.to(socket.battleId).emit('chat_message', {
        socketId: socket.id,
        message: message.trim(),
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  });

  // 연결 해제 처리
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);

    if (socket.battleId) {
      const battle = battleEngine.getBattle(socket.battleId);
      if (battle) {
        // 플레이어가 배틀에서 나갔음을 다른 참가자들에게 알림
        socket.to(socket.battleId).emit('player_disconnected', {
          playerId: socket.id,
          battle: serializeBattleForClient(battle)
        });
      }
    }
  });

  // 에러 처리
  socket.on('error', (error) => {
    console.error('Socket error:', socket.id, error);
  });
});

// 정기적인 정리 작업 (30분마다)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30분

  battleEngine.battles.forEach((battle, battleId) => {
    const age = now - battle.createdAt;
    if (age > maxAge && (battle.status === 'ended' || battle.status === 'waiting')) {
      console.log(`Cleaning up old battle: ${battleId}`);
      battleEngine.battles.delete(battleId);
      battleEngine.turnTimers.delete(battleId);
    }
  });
}, parseInt(process.env.CLEANUP_INTERVAL) || 1800000); // 30분마다

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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Battle API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
  console.log(`Team Battle System Ready!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = { app, server, io, battleEngine };
