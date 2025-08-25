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

const BattleEngine = require('./services/BattleEngine');
const setupBattleSocket = require('./socket/battleSocket');

const app = express();
const server = http.createServer(app);

// 소켓 초기화
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const battleEngine = new BattleEngine();
const battleSocket = setupBattleSocket(io, battleEngine);

// 미들웨어
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true
}));

app.use(express.static(path.join(__dirname, '../public')));

// 요청 제한
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: '너무 많은 요청입니다. 잠시 후 다시 시도하세요.'
});
app.use('/api/', limiter);

// 파일 업로드 설정
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('이미지 파일만 업로드 가능합니다'));
  }
});

// 헬스 체크
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
      mode,
      turnTimeLimit: settings.turnTimeLimit || 300000,
      maxTurns: settings.maxTurns || 50,
      itemsEnabled: settings.itemsEnabled !== false,
      autoStart: settings.autoStart !== false
    });
    res.status(201).json({ success: true, battleId: battle.id, battle });
  } catch (err) {
    console.error('전투 생성 오류:', err);
    res.status(500).json({ error: '전투 생성에 실패했습니다' });
  }
});

// 전투 조회
app.get('/api/battles/:battleId', async (req, res) => {
  try {
    const battle = battleEngine.getBattle(req.params.battleId);
    if (!battle) return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    res.json({ success: true, ...battle });
  } catch (err) {
    console.error('전투 조회 오류:', err);
    res.status(500).json({ error: '전투 조회에 실패했습니다' });
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
      otp,
      role,
      expiresIn: '5분'
    });
  } catch (err) {
    console.error('OTP 발급 오류:', err);
    res.status(500).json({ error: 'OTP 발급에 실패했습니다' });
  }
});

// 관리자 인증
app.post('/api/admin/battles/:battleId/auth', (req, res) => {
  try {
    const { otp, role } = req.body;
    const { battleId } = req.params;

    const result = battleSocket.verifyOTP(otp, battleId);
    if (!result.valid) return res.status(401).json({ error: result.error });
    if (result.data.role !== role) return res.status(401).json({ error: '역할이 일치하지 않습니다' });

    res.json({ success: true, token: otp, role });
  } catch (err) {
    console.error('인증 오류:', err);
    res.status(500).json({ error: '인증에 실패했습니다' });
  }
});

// 전투 시작
app.post('/api/admin/battles/:battleId/start', (req, res) => {
  try {
    const battle = battleEngine.startBattle(req.params.battleId);
    io.to(battle.id).emit('battleUpdate', battle);
    res.json({ success: true, message: '전투가 시작되었습니다', battle });
  } catch (err) {
    console.error('전투 시작 오류:', err);
    res.status(500).json({ error: err.message || '전투 시작에 실패했습니다' });
  }
});

// 정적 파일 라우팅
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, '../public/play.html')));
app.get('/watch', (req, res) => res.sendFile(path.join(__dirname, '../public/watch.html')));

// 404 처리
app.use((req, res) => res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다' }));

// 에러 처리
app.use((err, req, res, next) => {
  console.error('서버 오류:', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

// 자동 정리
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  battleEngine.battles.forEach((battle, id) => {
    const age = now - battle.createdAt;
    if (age > maxAge && (battle.status === 'ended' || battle.status === 'waiting')) {
      console.log(`오래된 전투 정리: ${id}`);
      battleEngine.battles.delete(id);
      battleEngine.turnTimers.delete(id);
    }
  });

  battleSocket.otpStore.forEach((otpData, otp) => {
    if (now - otpData.createdAt > 300000) {
      battleSocket.otpStore.delete(otp);
    }
  });
}, parseInt(process.env.CLEANUP_INTERVAL) || 1800000);

// 서버 실행
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
  console.log(`관리자 페이지: http://${HOST}:${PORT}/admin`);
  console.log(`플레이어 페이지: http://${HOST}:${PORT}/play`);
  console.log(`관전자 페이지: http://${HOST}:${PORT}/watch`);
  console.log(`========================================`);
});

// 예외 처리
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

process.on('uncaughtException', (err) => {
  console.error('처리되지 않은 예외:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('처리되지 않은 거부:', promise, '이유:', reason);
  process.exit(1);
});

module.exports = { app, server, io, battleEngine };
