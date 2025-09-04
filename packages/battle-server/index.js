const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 기본 설정
const config = {
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MAX_FILE_SIZE: '5mb',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3001'
};

// Express 앱 생성
const app = express();
const server = http.createServer(app);

// ═══════════════════════════════════════════════════════════════════════
// 필수 디렉토리 생성
// ═══════════════════════════════════════════════════════════════════════

const createDirectories = () => {
  const dirs = ['uploads', 'logs', 'public/uploads'];
  dirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`📁 디렉토리 생성됨: ${dir}`);
    }
  });
};

// 시작 시 디렉토리 생성
createDirectories();

// ═══════════════════════════════════════════════════════════════════════
// 간단한 로거
// ═══════════════════════════════════════════════════════════════════════

const logger = {
  info: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] INFO: ${message}`, Object.keys(data).length ? data : '');
  },
  warn: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] WARN: ${message}`, Object.keys(data).length ? data : '');
  },
  error: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`, Object.keys(data).length ? data : '');
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 기본 미들웨어
// ═══════════════════════════════════════════════════════════════════════

// CORS 헤더 설정
app.use((req, res, next) => {
  const allowedOrigins = config.NODE_ENV === 'production' 
    ? [config.CORS_ORIGIN] 
    : ["http://localhost:3001", "http://127.0.0.1:3001"];
    
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Preflight 요청 처리
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// 기본 보안 헤더
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// JSON 파서
app.use(express.json({ limit: config.MAX_FILE_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_FILE_SIZE }));

// 요청 로깅
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (config.NODE_ENV === 'development') {
      console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    }
  });
  
  next();
});

// ═══════════════════════════════════════════════════════════════════════
// 정적 파일 서빙
// ═══════════════════════════════════════════════════════════════════════

// 정적 파일 캐싱 설정
const staticOptions = {
  maxAge: config.NODE_ENV === 'production' ? 86400000 : 0, // 1일 or 0
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (path.match(/\.(css|js)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1년
    }
  }
};

app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  ...staticOptions,
  maxAge: 604800000 // 7일
}));

// ═══════════════════════════════════════════════════════════════════════
// API 라우터 (간단한 버전)
// ═══════════════════════════════════════════════════════════════════════

const apiRouter = express.Router();

// 전투 데이터 저장소 (메모리 기반 - 프로덕션에서는 DB 사용 권장)
const battles = new Map();
const otpStore = new Map();

// 헬스 체크
apiRouter.get('/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
    },
    version: process.version,
    env: config.NODE_ENV,
    battles: battles.size
  };
  
  res.json(healthData);
});

// 서버 정보
apiRouter.get('/info', (req, res) => {
  res.json({
    name: 'PYXIS Battle System',
    version: '3.0.0',
    description: '실시간 턴제 전투 시스템',
    author: 'CriminalTalent',
    features: [
      '실시간 멀티플레이어 전투',
      '관전자 모드',
      '채팅 시스템',
      '아바타 업로드',
      'OTP 인증'
    ]
  });
});

// 전투 생성
apiRouter.post('/battles', (req, res) => {
  try {
    const battleId = generateBattleId();
    const battle = {
      id: battleId,
      mode: req.body.mode || '1v1',
      status: 'waiting',
      players: [],
      createdAt: new Date().toISOString(),
      adminOtp: generateOTP()
    };
    
    battles.set(battleId, battle);
    
    logger.info('Battle created', { battleId, mode: battle.mode });
    
    res.json({
      success: true,
      battleId: battleId,
      adminOtp: battle.adminOtp,
      battle: battle
    });
  } catch (error) {
    logger.error('Failed to create battle', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create battle'
    });
  }
});

// 플레이어 추가
apiRouter.post('/battles/:battleId/players', (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({
        success: false,
        error: 'Battle not found'
      });
    }
    
    const player = {
      id: generatePlayerId(),
      name: req.body.name,
      team: req.body.team,
      stats: req.body.stats || { attack: 3, defense: 3, agility: 3, luck: 3 },
      items: req.body.items || { dittany: 0, attackBoost: 0, defenseBoost: 0 },
      avatar: req.body.avatar || null,
      hp: 50,
      maxHp: 50
    };
    
    battle.players.push(player);
    
    logger.info('Player added to battle', { 
      battleId, 
      playerId: player.id, 
      playerName: player.name 
    });
    
    res.json({
      success: true,
      player: player,
      battle: battle
    });
  } catch (error) {
    logger.error('Failed to add player', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to add player'
    });
  }
});

// OTP 생성
apiRouter.post('/otp', (req, res) => {
  try {
    const otp = generateOTP();
    const otpData = {
      otp: otp,
      role: req.body.role,
      battleId: req.body.battleId,
      playerId: req.body.playerId,
      playerName: req.body.playerName,
      expiresAt: new Date(Date.now() + (req.body.expiresIn || 3600) * 1000),
      maxUses: req.body.maxUses || 1,
      usedCount: 0
    };
    
    otpStore.set(otp, otpData);
    
    // 만료된 OTP 정리
    setTimeout(() => {
      otpStore.delete(otp);
    }, (req.body.expiresIn || 3600) * 1000);
    
    logger.info('OTP generated', { 
      otp, 
      role: otpData.role, 
      battleId: otpData.battleId 
    });
    
    res.json({
      ok: true,
      otp: otp,
      expiresAt: otpData.expiresAt
    });
  } catch (error) {
    logger.error('Failed to generate OTP', { error: error.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to generate OTP'
    });
  }
});

// OTP 검증
apiRouter.post('/otp/verify', (req, res) => {
  try {
    const { otp, battleId } = req.body;
    const otpData = otpStore.get(otp);
    
    if (!otpData) {
      return res.status(404).json({
        valid: false,
        error: 'Invalid or expired OTP'
      });
    }
    
    if (otpData.battleId !== battleId) {
      return res.status(400).json({
        valid: false,
        error: 'OTP not valid for this battle'
      });
    }
    
    if (otpData.expiresAt < new Date()) {
      otpStore.delete(otp);
      return res.status(410).json({
        valid: false,
        error: 'OTP expired'
      });
    }
    
    if (otpData.usedCount >= otpData.maxUses) {
      return res.status(429).json({
        valid: false,
        error: 'OTP usage limit exceeded'
      });
    }
    
    // 사용 횟수 증가
    otpData.usedCount++;
    
    logger.info('OTP verified', { 
      otp, 
      battleId, 
      role: otpData.role 
    });
    
    res.json({
      valid: true,
      role: otpData.role,
      playerId: otpData.playerId,
      playerName: otpData.playerName
    });
  } catch (error) {
    logger.error('Failed to verify OTP', { error: error.message });
    res.status(500).json({
      valid: false,
      error: 'Failed to verify OTP'
    });
  }
});

// 전투 조회
apiRouter.get('/battles/:battleId', (req, res) => {
  const battle = battles.get(req.params.battleId);
  if (!battle) {
    return res.status(404).json({
      success: false,
      error: 'Battle not found'
    });
  }
  
  res.json({
    success: true,
    battle: battle
  });
});

app.use('/api', apiRouter);

// ═══════════════════════════════════════════════════════════════════════
// HTML 페이지 라우팅
// ═══════════════════════════════════════════════════════════════════════

// 페이지 서빙 함수
const servePage = (pageName) => (req, res, next) => {
  const filePath = path.join(__dirname, 'public', 'pages', `${pageName}.html`);
  
  if (!fs.existsSync(filePath)) {
    logger.error(`Page not found: ${pageName}.html`);
    return res.status(404).send(`
      <html>
        <head><title>페이지를 찾을 수 없음</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h1>🚫 페이지를 찾을 수 없습니다</h1>
          <p>요청하신 페이지 '${pageName}'가 존재하지 않습니다.</p>
          <p><a href="/admin">관리자 페이지로 돌아가기</a></p>
        </body>
      </html>
    `);
  }
  
  res.sendFile(filePath, (err) => {
    if (err) {
      logger.error(`Failed to serve ${pageName}.html`, { error: err.message });
      next(err);
    }
  });
};

// 페이지 라우트들
app.get('/admin', servePage('admin'));
app.get('/play', servePage('play'));
app.get('/player', servePage('play')); // 별칭
app.get('/spectator', servePage('spectator'));
app.get('/watch', servePage('spectator')); // 별칭

// 루트 경로
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ═══════════════════════════════════════════════════════════════════════
// 에러 핸들링
// ═══════════════════════════════════════════════════════════════════════

// 404 핸들러
app.use((req, res) => {
  logger.warn('404 Not Found', { path: req.path, method: req.method });
  
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      error: 'API endpoint not found',
      path: req.path
    });
  } else {
    res.redirect('/admin');
  }
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
  logger.error('Unhandled Error', {
    error: err.message,
    stack: config.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method
  });
  
  const errorResponse = {
    error: config.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
    timestamp: new Date().toISOString()
  };
  
  if (config.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }
  
  res.status(err.status || 500).json(errorResponse);
});

// ═══════════════════════════════════════════════════════════════════════
// Socket.IO 초기화 (간단한 버전)
// ═══════════════════════════════════════════════════════════════════════

const { Server } = require('socket.io');

const io = new Server(server, {
  cors: {
    origin: config.NODE_ENV === 'production' 
      ? [config.CORS_ORIGIN] 
      : ["http://localhost:3001", "http://127.0.0.1:3001"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// 간단한 Socket 핸들러
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
  
  // 여기에 실제 게임 로직을 추가할 수 있습니다
  socket.on('joinBattle', (data) => {
    socket.join(data.battleId);
    logger.info('Player joined battle', { 
      socketId: socket.id, 
      battleId: data.battleId 
    });
  });
  
  socket.on('chatMessage', (data) => {
    socket.to(data.battleId).emit('chatMessage', data);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 유틸리티 함수들
// ═══════════════════════════════════════════════════════════════════════

function generateBattleId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generatePlayerId() {
  return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

function generateOTP() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// 서버 시작
// ═══════════════════════════════════════════════════════════════════════

const startServer = async () => {
  try {
    await new Promise((resolve, reject) => {
      server.listen(config.PORT, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    logger.info('PYXIS Battle System 서버 시작됨', {
      port: config.PORT,
      env: config.NODE_ENV,
      pid: process.pid
    });
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  PYXIS BATTLE SYSTEM                        ║
║                                                              ║
║  🌟 서버 실행 중: http://localhost:${config.PORT.toString().padEnd(28)} ║
║  🎮 관리자: http://localhost:${config.PORT}/admin${' '.repeat(21)} ║
║  ⚔️  플레이어: http://localhost:${config.PORT}/play${' '.repeat(20)} ║
║  👁️  관전자: http://localhost:${config.PORT}/spectator${' '.repeat(15)} ║
║  📊 상태: http://localhost:${config.PORT}/api/health${' '.repeat(16)} ║
║                                                              ║
║  환경: ${config.NODE_ENV.padEnd(52)} ║
║  PID: ${process.pid.toString().padEnd(53)} ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
  } catch (error) {
    logger.error('Failed to start server', { 
      error: error.message,
      port: config.PORT 
    });
    
    console.error(`❌ 서버 시작 실패 (포트 ${config.PORT}):`, error.message);
    process.exit(1);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 프로세스 이벤트 핸들러
// ═══════════════════════════════════════════════════════════════════════

// 우아한 종료
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('Server closed successfully');
    process.exit(0);
  });
  
  // 10초 후 강제 종료
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 예외 처리
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason: reason.toString() });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// 메모리 모니터링 (개발 환경)
if (config.NODE_ENV === 'development') {
  setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    
    if (heapUsedMB > 100) {
      logger.warn('High memory usage detected', {
        heapUsed: heapUsedMB + 'MB',
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB'
      });
    }
  }, 30000);
}

// 서버 시작
startServer();

// 모듈 익스포트 (테스트용)
module.exports = { app, server, config, battles, otpStore };
