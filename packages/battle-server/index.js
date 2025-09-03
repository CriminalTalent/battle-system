const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// 커스텀 모듈들
const { initializeSocketHandlers } = require('./src/socket/battle-handlers');
const apiRouter = require('./src/api');
const { createDirectories, validateEnvironment } = require('./src/utils/startup');
const logger = require('./src/utils/logger');

// 환경 변수 검증 및 기본값 설정
const config = {
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || '5mb',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3001',
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15분
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 100 // 요청 수
};

// Express 앱 생성
const app = express();
const server = http.createServer(app);

// 필수 디렉토리 생성
createDirectories();

// 환경 변수 검증
validateEnvironment();

// ═══════════════════════════════════════════════════════════════════════
// 보안 미들웨어
// ═══════════════════════════════════════════════════════════════════════

// Helmet으로 보안 헤더 설정
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS 설정
app.use(cors({
  origin: config.NODE_ENV === 'production' 
    ? [config.CORS_ORIGIN] 
    : ["http://localhost:3001", "http://127.0.0.1:3001"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// ═══════════════════════════════════════════════════════════════════════
// 기본 미들웨어
// ═══════════════════════════════════════════════════════════════════════

// 압축
app.use(compression());

// JSON 파서 (크기 제한 포함)
app.use(express.json({ 
  limit: config.MAX_FILE_SIZE,
  verify: (req, res, buf) => {
    // JSON 파싱 에러 처리를 위한 raw body 저장
    req.rawBody = buf;
  }
}));

// URL 인코딩 파서
app.use(express.urlencoded({ 
  extended: true, 
  limit: config.MAX_FILE_SIZE 
}));

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  const start = Date.now();
  
  // 응답 완료 시 로깅
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    if (config.NODE_ENV === 'development') {
      console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    }
    
    logger.info('HTTP Request', logData);
  });
  
  next();
});

// ═══════════════════════════════════════════════════════════════════════
// API 라우터
// ═══════════════════════════════════════════════════════════════════════

app.use('/api', apiRouter);

// ═══════════════════════════════════════════════════════════════════════
// 정적 파일 서빙
// ═══════════════════════════════════════════════════════════════════════

// 정적 파일 캐싱 설정
const staticOptions = {
  maxAge: config.NODE_ENV === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // HTML 파일은 캐시하지 않음
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // CSS/JS 파일은 캐싱
    else if (path.match(/\.(css|js)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
};

app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  ...staticOptions,
  maxAge: '7d' // 업로드된 파일은 7일간 캐싱
}));

// ═══════════════════════════════════════════════════════════════════════
// HTML 페이지 라우팅
// ═══════════════════════════════════════════════════════════════════════

// 페이지 라우터 함수
const servePage = (pageName) => (req, res, next) => {
  const filePath = path.join(__dirname, 'public', 'pages', `${pageName}.html`);
  
  // 파일 존재 여부 확인
  res.sendFile(filePath, (err) => {
    if (err) {
      logger.error(`Failed to serve ${pageName}.html`, { 
        error: err.message,
        path: filePath 
      });
      
      // 404 페이지로 리다이렉트 또는 에러 페이지 서빙
      if (err.code === 'ENOENT') {
        res.status(404).json({ 
          error: 'Page not found',
          message: `The page '${pageName}' could not be found.`
        });
      } else {
        next(err);
      }
    }
  });
};

// 페이지 라우트들
app.get('/admin', servePage('admin'));
app.get('/play', servePage('play'));
app.get('/player', servePage('play')); // 별칭
app.get('/spectator', servePage('spectator'));
app.get('/watch', servePage('spectator')); // 별칭

// 루트 경로 - 관리자 페이지로 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ═══════════════════════════════════════════════════════════════════════
// API 엔드포인트들
// ═══════════════════════════════════════════════════════════════════════

// 헬스 체크 (상세 정보 포함)
app.get('/api/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
    env: config.NODE_ENV
  };
  
  res.json(healthData);
});

// 서버 정보
app.get('/api/info', (req, res) => {
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

// ═══════════════════════════════════════════════════════════════════════
// 에러 핸들링 미들웨어
// ═══════════════════════════════════════════════════════════════════════

// 404 핸들러
app.use((req, res) => {
  const error = {
    status: 404,
    message: 'Not Found',
    path: req.path,
    timestamp: new Date().toISOString()
  };
  
  logger.warn('404 Not Found', {
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  // API 요청인 경우 JSON 응답
  if (req.path.startsWith('/api/')) {
    res.status(404).json(error);
  } else {
    // 웹 페이지 요청인 경우 관리자 페이지로 리다이렉트
    res.redirect('/admin');
  }
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
  // JSON 파싱 에러 처리
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error('JSON Parsing Error', {
      error: err.message,
      path: req.path,
      ip: req.ip
    });
    
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON.'
    });
  }
  
  // 파일 크기 초과 에러
  if (err.code === 'LIMIT_FILE_SIZE' || err.message.includes('request entity too large')) {
    logger.error('File Size Exceeded', {
      limit: config.MAX_FILE_SIZE,
      path: req.path,
      ip: req.ip
    });
    
    return res.status(413).json({
      error: 'File too large',
      message: `File size exceeds the limit of ${config.MAX_FILE_SIZE}.`
    });
  }
  
  // 일반적인 에러 로깅
  logger.error('Unhandled Error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  // 개발 환경에서는 상세 에러 정보 제공
  const errorResponse = {
    status: err.status || 500,
    message: config.NODE_ENV === 'development' 
      ? err.message 
      : 'Internal Server Error',
    timestamp: new Date().toISOString()
  };
  
  if (config.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }
  
  res.status(err.status || 500).json(errorResponse);
});

// ═══════════════════════════════════════════════════════════════════════
// 소켓 핸들러 초기화
// ═══════════════════════════════════════════════════════════════════════

try {
  initializeSocketHandlers(server);
  logger.info('Socket handlers initialized successfully');
} catch (error) {
  logger.error('Failed to initialize socket handlers', { error: error.message });
  process.exit(1);
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
    
    logger.info('🚀 PYXIS Battle System 서버 시작됨', {
      port: config.PORT,
      env: config.NODE_ENV,
      url: `http://localhost:${config.PORT}`,
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

// 우아한 종료 처리
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // 추가 정리 작업 (DB 연결 해제, 캐시 정리 등)
    setTimeout(() => {
      logger.info('Graceful shutdown completed');
      process.exit(0);
    }, 1000);
  });
  
  // 10초 후 강제 종료
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
};

// 시그널 리스너
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 예외 처리
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason.toString(),
    stack: reason.stack,
    promise: promise.toString()
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  
  // 예외 발생 시 우아한 종료 시도
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// 메모리 사용량 모니터링 (개발 환경)
if (config.NODE_ENV === 'development') {
  setInterval(() => {
    const usage = process.memoryUsage();
    if (usage.heapUsed > 100 * 1024 * 1024) { // 100MB 이상
      logger.warn('High memory usage detected', {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB'
      });
    }
  }, 30000); // 30초마다 체크
}

// 서버 시작
startServer();

// 모듈 익스포트 (테스트용)
module.exports = { app, server, config };
