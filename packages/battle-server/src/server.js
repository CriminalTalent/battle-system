const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

// 서비스 모듈
const BattleEngine = require('./services/BattleEngine');
const setupBattleSocket = require('./socket/battleSocket');

// Express 앱 생성
const app = express();
const server = http.createServer(app);

// Socket.IO 설정
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// 서비스 인스턴스 생성
const battleEngine = new BattleEngine();
const battleSocket = setupBattleSocket(io, battleEngine);

// 미들웨어 설정
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS 설정
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true
}));

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '../public')));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: '너무 많은 요청입니다. 잠시 후 다시 시도하세요.'
});
app.use('/api/', limiter);

// 파일 업로드 설정 (캐릭터 이미지)
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/characters');
    await fs.ensureDir(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다'));
    }
  }
});

// ===== API 라우트 =====

// 헬스 체크
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

// 전투 생성
app.post('/api/battles', async (req, res) => {
  try {
    const { mode = '1v1', settings = {} } = req.body;

    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: '유효하지 않은 전투 모드입니다' });
    }

    const battle = battleEngine.createBattle({
      mode: mode,
      turnTimeLimit: settings.turnTimeLimit || 300000,
      maxTurns: settings.maxTurns || 50,
      itemsEnabled: settings.itemsEnabled !== false,
      autoStart: settings.autoStart !== false
    });

    res.status(201).json({
      success: true,
      battleId: battle.id,
      battle: battle
    });

  } catch (error) {
    console.error('전투 생성 오류:', error);
    res.status(500).json({ error: '전투 생성에 실패했습니다' });
  }
});

// 전투 조회
app.get('/api/battles/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = battleEngine.getBattle(battleId);

    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }

    res.json({
      success: true,
      ...battle
    });

  } catch (error) {
    console.error('전투 조회 오류:', error);
    res.status(500).json({ error: '전투 조회에 실패했습니다' });
  }
});

// ===== 관리자 API =====

// 링크 생성 (OTP 발급)
app.post('/api/admin/battles/:battleId/links', (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = battleEngine.getBattle(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }

    const tokens = {
      admin: battleSocket.issueOTP(battleId, 'admin'),
      player: battleSocket.issueOTP(battleId, 'player'),
      spectator: battleSocket.issueOTP(battleId, 'spectator')
    };

    res.json({
      success: true,
      tokens: tokens,
      urls: {
        admin: `/admin.html?token=${tokens.admin}&battle=${battleId}`,
        player: `/play.html?token=${tokens.player}&battle=${battleId}`,
        spectator: `/watch.html?token=${tokens.spectator}&battle=${battleId}`
      }
    });

  } catch (error) {
    console.error('링크 생성 오류:', error);
    res.status(500).json({ error: '링크 생성에 실패했습니다' });
  }
});

// OTP 발급
app.post('/api/admin/battles/:battleId/issue-otp', (req, res) => {
  try {
    const { battleId } = req.params;
    const { role, playerName } = req.body;

    if (!['admin', 'player', 'spectator'].includes(role)) {
      return res.status(400).json({ error: '유효하지 않은 역할입니다' });
    }

    const otp = battleSocket.issueOTP(battleId, role, playerName);

    res.json({
      success: true,
      otp: otp,
      role: role,
      expiresIn: '5분'
    });

  } catch (error) {
    console.error('OTP 발급 오류:', error);
    res.status(500).json({ error: 'OTP 발급에 실패했습니다' });
  }
});

// OTP 인증
app.post('/api/admin/battles/:battleId/auth', (req, res) => {
  try {
    const { battleId } = req.params;
    const { otp, role } = req.body;

    const result = battleSocket.verifyOTP(otp, battleId);
    
    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    if (result.data.role !== role) {
      return res.status(401).json({ error: '역할이 일치하지 않습니다' });
    }

    res.json({
      success: true,
      token: otp, // 실제로는 JWT 토큰 생성 권장
      role: role
    });

  } catch (error) {
    console.error('인증 오류:', error);
    res.status(500).json({ error: '인증에 실패했습니다' });
  }
});

// 플레이어 추가 (관리자)
app.post('/api/admin/battles/:battleId/add-player', upload.single('characterImage'), async (req, res) => {
  try {
    const { battleId } = req.params;
    const { name, team, attack, defense, agility, luck } = req.body;
    
    const battle = battleEngine.getBattle(battleId);
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }

    if (battle.status !== 'waiting') {
      return res.status(400).json({ error: '이미 시작된 전투입니다' });
    }

    // 아이템 처리
    const inventory = [];
    const itemTypes = ['공격 보정기', '방어 보정기', '디터니'];
    
    itemTypes.forEach(itemType => {
      const count = parseInt(req.body[itemType]) || 0;
      for (let i = 0; i < count; i++) {
        inventory.push(itemType);
      }
    });

    // 플레이어 데이터 생성
    const playerData = {
      name: name || `플레이어${Date.now()}`,
      maxHp: 100,
      attack: parseInt(attack) * 10 || 50,
      defense: parseInt(defense) * 10 || 30,
      agility: parseInt(agility) * 10 || 50,
      luck: parseInt(luck) * 10 || 30,
      inventory: inventory,
      imageUrl: req.file ? `/uploads/characters/${req.file.filename}` : null
    };

    const updatedBattle = battleEngine.joinBattle(battleId, playerData, team);

    res.json({
      success: true,
      message: `${playerData.name}이(가) ${team === 'team1' ? '불사조 기사단' : '죽음을 먹는자들'}에 추가되었습니다`,
      battle: updatedBattle
    });

  } catch (error) {
    console.error('플레이어 추가 오류:', error);
    res.status(500).json({ error: error.message || '플레이어 추가에 실패했습니다' });
  }
});

// 전투 시작 가능 여부 확인
app.get('/api/admin/battles/:battleId/can-start', (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = battleEngine.getBattle(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }

    const team1Count = battle.teams.team1.players.length;
    const team2Count = battle.teams.team2.players.length;
    const expectedCount = battle.config.playersPerTeam;
    
    // 모든 플레이어 준비 확인
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players
    ];
    const allReady = allPlayers.length > 0 && allPlayers.every(p => p.isReady);
    
    const canStart = 
      team1Count === expectedCount && 
      team2Count === expectedCount && 
      allReady &&
      battle.status === 'waiting';

    let reason = '';
    if (team1Count < expectedCount) reason = `불사조 기사단 인원 부족 (${team1Count}/${expectedCount})`;
    else if (team2Count < expectedCount) reason = `죽음을 먹는자들 인원 부족 (${team2Count}/${expectedCount})`;
    else if (!allReady) reason = '모든 플레이어가 준비되지 않았습니다';
    else if (battle.status !== 'waiting') reason = '이미 시작되었거나 종료된 전투입니다';

    res.json({
      canStart: canStart,
      reason: reason,
      team1Count: team1Count,
      team2Count: team2Count,
      expectedCount: expectedCount,
      allReady: allReady
    });

  } catch (error) {
    console.error('전투 시작 확인 오류:', error);
    res.status(500).json({ error: '확인에 실패했습니다' });
  }
});

// 전투 시작 (관리자)
app.post('/api/admin/battles/:battleId/start', (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = battleEngine.startBattle(battleId);
    
    // 소켓으로 모든 클라이언트에 알림
    io.to(battleId).emit('battleUpdate', battle);
    
    res.json({
      success: true,
      message: '전투가 시작되었습니다',
      battle: battle
    });

  } catch (error) {
    console.error('전투 시작 오류:', error);
    res.status(500).json({ error: error.message || '전투 시작에 실패했습니다' });
  }
});

// 전투 종료 (관리자)
app.post('/api/admin/battles/:battleId/end', (req, res) => {
  try {
    const { battleId } = req.params;
    const { winner } = req.body;
    
    const battle = battleEngine.endBattle(battleId, winner);
    
    // 소켓으로 모든 클라이언트에 알림
    io.to(battleId).emit('battleUpdate', battle);
    
    res.json({
      success: true,
      message: '전투가 종료되었습니다',
      battle: battle
    });

  } catch (error) {
    console.error('전투 종료 오류:', error);
    res.status(500).json({ error: '전투 종료에 실패했습니다' });
  }
});

// 다음 턴 진행 (관리자)
app.post('/api/admin/battles/:battleId/next-turn', (req, res) => {
  try {
    const { battleId } = req.params;
    
    battleEngine.endCurrentTurn(battleId);
    const battle = battleEngine.getBattle(battleId);
    
    // 소켓으로 모든 클라이언트에 알림
    io.to(battleId).emit('battleUpdate', battle);
    
    res.json({
      success: true,
      message: '다음 턴으로 진행되었습니다',
      battle: battle
    });

  } catch (error) {
    console.error('다음 턴 진행 오류:', error);
    res.status(500).json({ error: '다음 턴 진행에 실패했습니다' });
  }
});

// 채팅 전송 (관리자)
app.post('/api/admin/battles/:battleId/chat', (req, res) => {
  try {
    const { battleId } = req.params;
    const { message, sender, senderType } = req.body;
    
    battleEngine.addChatMessage(battleId, sender, message, senderType);
    const battle = battleEngine.getBattle(battleId);
    
    // 소켓으로 모든 클라이언트에 알림
    io.to(battleId).emit('battleUpdate', battle);
    
    res.json({
      success: true,
      message: '메시지가 전송되었습니다'
    });

  } catch (error) {
    console.error('채팅 전송 오류:', error);
    res.status(500).json({ error: '메시지 전송에 실패했습니다' });
  }
});

// 전투 목록 조회 (관리자)
app.get('/api/admin/battles', async (req, res) => {
  try {
    const battles = Array.from(battleEngine.battles.values()).map(battle => ({
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      playerCount: battle.teams.team1.players.length + battle.teams.team2.players.length,
      maxPlayers: battle.config.playersPerTeam * 2,
      createdAt: battle.createdAt,
      roundNumber: battle.roundNumber
    }));
    
    res.json({ 
      success: true,
      battles: battles,
      total: battles.length
    });
    
  } catch (error) {
    console.error('전투 목록 조회 오류:', error);
    res.status(500).json({ error: '전투 목록 조회에 실패했습니다' });
  }
});

// ===== 정적 파일 서빙 =====

// 업로드된 이미지 서빙
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// HTML 파일 라우팅
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/play.html'));
});

app.get('/watch', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/watch.html'));
});

// 404 처리
app.use((req, res) => {
  res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다' });
});

// 에러 처리
app.use((err, req, res, next) => {
  console.error('서버 오류:', err);
  res.status(500).json({ 
    error: '서버 오류가 발생했습니다',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===== 정리 작업 =====

// 정기적인 정리 작업 (30분마다)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30분

  battleEngine.battles.forEach((battle, battleId) => {
    const age = now - battle.createdAt;
    if (age > maxAge && (battle.status === 'ended' || battle.status === 'waiting')) {
      console.log(`오래된 전투 정리: ${battleId}`);
      battleEngine.battles.delete(battleId);
      battleEngine.turnTimers.delete(battleId);
    }
  });

  // OTP 정리
  battleSocket.otpStore.forEach((otpData, otp) => {
    if (now - otpData.createdAt > 300000) { // 5분
      battleSocket.otpStore.delete(otp);
    }
  });
  
}, parseInt(process.env.CLEANUP_INTERVAL) || 1800000);

// ===== 서버 시작 =====

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`========================================`);
  console.log(`   전투 시스템 서버 시작`);
  console.log(`========================================`);
  console.log(`포트: ${PORT}`);
  console.log(`호스트: ${HOST}`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS: ${process.env.CORS_ORIGIN || '*'}`);
  console.log(`========================================`);
  console.log(`API 엔드포인트:`);
  console.log(`- 헬스체크: http://${HOST}:${PORT}/api/health`);
  console.log(`- 전투 생성: POST /api/battles`);
  console.log(`- 전투 조회: GET /api/battles/:battleId`);
  console.log(`========================================`);
  console.log(`관리자 페이지: http://${HOST}:${PORT}/admin`);
  console.log(`플레이어 페이지: http://${HOST}:${PORT}/play`);
  console.log(`관전자 페이지: http://${HOST}:${PORT}/watch`);
  console.log(`========================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM 신호 수신, 서버 종료 중...');
  server.close(() => {
    console.log('서버가 안전하게 종료되었습니다');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT 신호 수신, 서버 종료 중...');
  server.close(() => {
    console.log('서버가 안전하게 종료되었습니다');
    process.exit(0);
  });
});

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
  console.error('처리되지 않은 예외:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('처리되지 않은 거부:', promise, '이유:', reason);
  process.exit(1);
});

module.exports = { app, server, io, battleEngine };
