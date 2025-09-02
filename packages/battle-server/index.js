// packages/battle-server/index.js
// PYXIS Battle System Server - 메인 엔트리 포인트

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// 커스텀 모듈
const SocketHandlers = require('./src/socket/socketHandlers');
const BattleEngine = require('./src/engine/BattleEngine');

// 환경 설정
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

class PyxisServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // 상태 관리
    this.battles = new Map(); // battleId -> BattleEngine
    this.otpStore = new Map(); // otp -> { role, battleId, playerId?, expires, uses }
    this.connections = new Map(); // socketId -> connectionInfo
    
    // Socket 핸들러
    this.socketHandlers = null;

    // 통계
    this.stats = {
      startTime: Date.now(),
      totalConnections: 0,
      totalBattles: 0,
      totalMessages: 0
    };

    this.init();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 초기화
  // ═══════════════════════════════════════════════════════════════════════
  
  init() {
    console.log(`[Server] Starting PYXIS Battle System...`);
    console.log(`[Server] Environment: ${NODE_ENV}`);
    console.log(`[Server] Port: ${PORT}`);

    this.setupDirectories();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupErrorHandling();
    this.setupGracefulShutdown();
    
    this.startServer();
  }

  setupDirectories() {
    // 필요한 디렉토리 생성
    const dirs = ['uploads', 'logs', 'public/uploads'];
    
    dirs.forEach(dir => {
      const fullPath = path.join(__dirname, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`[Server] Created directory: ${dir}`);
      }
    });
  }

  setupMiddleware() {
    // CORS
    this.app.use(cors({
      origin: true,
      credentials: true
    }));

    // JSON 파싱
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 정적 파일
    this.app.use(express.static(path.join(__dirname, 'public'), {
      maxAge: NODE_ENV === 'production' ? '1d' : '0'
    }));

    // 업로드 파일 접근
    this.app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    // 로깅 미들웨어
    this.app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // ═══════════════════════════════════════════════════════════════════
    // 페이지 라우트
    // ═══════════════════════════════════════════════════════════════════
    
    // 메인 페이지 (관리자)
    this.app.get('/', (req, res) => {
      res.redirect('/admin');
    });

    // 관리자 페이지
    this.app.get('/admin', (req, res) => {
      res.sendFile(path.join(__dirname, 'public/pages/admin.html'));
    });

    // 플레이어 페이지
    this.app.get('/play', (req, res) => {
      res.sendFile(path.join(__dirname, 'public/pages/player.html'));
    });

    // 관전자 페이지
    this.app.get('/watch', (req, res) => {
      res.sendFile(path.join(__dirname, 'public/pages/spectator.html'));
    });

    // ═══════════════════════════════════════════════════════════════════
    // API 라우트
    // ═══════════════════════════════════════════════════════════════════
    
    // 헬스 체크
    this.app.get('/api/health', (req, res) => {
      const uptime = Date.now() - this.stats.startTime;
      res.json({
        ok: true,
        status: 'healthy',
        uptime: uptime,
        uptimeFormatted: this.formatUptime(uptime),
        stats: {
          battles: this.battles.size,
          connections: this.connections.size,
          totalBattles: this.stats.totalBattles,
          totalConnections: this.stats.totalConnections,
          totalMessages: this.stats.totalMessages
        },
        memory: process.memoryUsage(),
        version: require('./package.json').version,
        node: process.version
      });
    });

    // OTP 생성
    this.app.post('/api/otp', (req, res) => {
      try {
        const { role, battleId, playerId, playerName, expiresIn = 3600, maxUses = 1 } = req.body;
        
        if (!role || !battleId) {
          return res.json({ ok: false, error: 'Missing required fields' });
        }

        const otp = this.generateOTP();
        const expires = Date.now() + (expiresIn * 1000);
        
        this.otpStore.set(otp, {
          role,
          battleId,
          playerId,
          playerName,
          expires,
          maxUses,
          uses: 0,
          created: Date.now()
        });

        res.json({
          ok: true,
          otp,
          expires,
          expiresIn
        });

      } catch (error) {
        console.error('[API] OTP generation error:', error);
        res.json({ ok: false, error: error.message });
      }
    });

    // OTP 검증
    this.app.post('/api/auth', (req, res) => {
      try {
        const { battleId, otp, role } = req.body;
        
        if (!battleId || !otp || !role) {
          return res.json({ ok: false, error: 'Missing required fields' });
        }

        const otpData = this.otpStore.get(otp);
        
        if (!otpData) {
          return res.json({ ok: false, error: 'Invalid or expired OTP' });
        }

        if (otpData.battleId !== battleId || otpData.role !== role) {
          return res.json({ ok: false, error: 'OTP mismatch' });
        }

        if (Date.now() > otpData.expires) {
          this.otpStore.delete(otp);
          return res.json({ ok: false, error: 'OTP expired' });
        }

        if (otpData.uses >= otpData.maxUses) {
          return res.json({ ok: false, error: 'OTP usage limit exceeded' });
        }

        // 사용 횟수 증가
        otpData.uses++;

        res.json({
          ok: true,
          role: otpData.role,
          battleId: otpData.battleId,
          playerId: otpData.playerId,
          playerName: otpData.playerName
        });

      } catch (error) {
        console.error('[API] Auth error:', error);
        res.json({ ok: false, error: error.message });
      }
    });

    // 전투 상태 조회
    this.app.get('/api/battles/:battleId', (req, res) => {
      try {
        const { battleId } = req.params;
        const battle = this.battles.get(battleId);
        
        if (!battle) {
          return res.json({ ok: false, error: 'Battle not found' });
        }

        res.json({
          ok: true,
          battle: battle.getGameState()
        });

      } catch (error) {
        console.error('[API] Battle status error:', error);
        res.json({ ok: false, error: error.message });
      }
    });

    // 아바타 업로드
    const uploadStorage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `avatar_${req.body.playerId}_${Date.now()}${ext}`;
        cb(null, filename);
      }
    });

    const upload = multer({
      storage: uploadStorage,
      limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
          cb(null, true);
        } else {
          cb(new Error('Only image files are allowed'));
        }
      }
    });

    this.app.post('/api/battles/:battleId/avatar', upload.single('avatar'), (req, res) => {
      try {
        const { battleId } = req.params;
        const { playerId } = req.body;
        
        if (!req.file) {
          return res.json({ ok: false, error: 'No file uploaded' });
        }

        const battle = this.battles.get(battleId);
        if (!battle) {
          return res.json({ ok: false, error: 'Battle not found' });
        }

        const player = battle.getPlayer(playerId);
        if (!player) {
          return res.json({ ok: false, error: 'Player not found' });
        }

        // 플레이어에 아바타 경로 저장
        player.avatar = `/uploads/${req.file.filename}`;

        console.log(`[Avatar] Uploaded for player ${player.name}: ${req.file.filename}`);

        res.json({
          ok: true,
          avatarUrl: player.avatar,
          filename: req.file.filename
        });

      } catch (error) {
        console.error('[API] Avatar upload error:', error);
        res.json({ ok: false, error: error.message });
      }
    });

    // 전투 리스트 (관리자용)
    this.app.get('/api/admin/battles', (req, res) => {
      try {
        const battles = Array.from(this.battles.values()).map(battle => ({
          battleId: battle.battleId,
          mode: battle.mode,
          status: battle.status,
          created: battle.created,
          started: battle.started,
          ended: battle.ended,
          playerCount: battle.getAllPlayers().length,
          currentTurn: battle.currentTurn
        }));

        res.json({
          ok: true,
          battles,
          total: battles.length
        });

      } catch (error) {
        console.error('[API] Battle list error:', error);
        res.json({ ok: false, error: error.message });
      }
    });

    // 서버 통계 (관리자용)
    this.app.get('/api/admin/stats', (req, res) => {
      try {
        const uptime = Date.now() - this.stats.startTime;
        
        res.json({
          ok: true,
          stats: {
            ...this.stats,
            uptime,
            uptimeFormatted: this.formatUptime(uptime),
            currentBattles: this.battles.size,
            currentConnections: this.connections.size,
            otpCount: this.otpStore.size
          },
          system: {
            memory: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            platform: process.platform,
            nodeVersion: process.version,
            pid: process.pid
          }
        });

      } catch (error) {
        console.error('[API] Stats error:', error);
        res.json({ ok: false, error: error.message });
      }
    });

    // 404 핸들러
    this.app.use((req, res) => {
      res.status(404).json({
        ok: false,
        error: 'Not found',
        path: req.path
      });
    });
  }

  setupSocketHandlers() {
    // Socket.IO 핸들러 초기화
    this.socketHandlers = new SocketHandlers(this.io);
    
    // 이벤트 리스너 설정
    this.io.on('connection', (socket) => {
      this.stats.totalConnections++;
      
      console.log(`[Socket] New connection: ${socket.id} (Total: ${this.io.sockets.sockets.size})`);

      socket.on('disconnect', (reason) => {
        console.log(`[Socket] Disconnection: ${socket.id} (Reason: ${reason})`);
      });
    });

    // 정기적인 통계 브로드캐스트
    setInterval(() => {
      this.broadcastServerStats();
    }, 30000); // 30초마다

    // OTP 정리 (만료된 OTP 제거)
    setInterval(() => {
      this.cleanupExpiredOTPs();
    }, 60000); // 1분마다
  }

  setupErrorHandling() {
    // Express 에러 핸들러
    this.app.use((error, req, res, next) => {
      console.error('[Express] Error:', error);
      
      if (error instanceof multer.MulterError) {
        return res.json({
          ok: false,
          error: 'File upload error: ' + error.message
        });
      }

      res.status(500).json({
        ok: false,
        error: NODE_ENV === 'production' ? 'Internal server error' : error.message,
        stack: NODE_ENV === 'development' ? error.stack : undefined
      });
    });

    // 전역 예외 처리
    process.on('uncaughtException', (error) => {
      console.error('[Process] Uncaught Exception:', error);
      
      if (NODE_ENV === 'production') {
        // 프로덕션에서는 graceful shutdown
        this.gracefulShutdown('uncaughtException');
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
      
      if (NODE_ENV === 'production') {
        // 프로덕션에서는 graceful shutdown
        this.gracefulShutdown('unhandledRejection');
      }
    });
  }

  setupGracefulShutdown() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`[Process] Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown(signal);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 서버 제어
  // ═══════════════════════════════════════════════════════════════════════
  
  startServer() {
    this.server.listen(PORT, HOST, () => {
      console.log(`[Server] PYXIS Battle System started on ${HOST}:${PORT}`);
      console.log(`[Server] Admin: http://${HOST}:${PORT}/admin`);
      console.log(`[Server] Health: http://${HOST}:${PORT}/api/health`);
      
      if (NODE_ENV === 'development') {
        console.log(`[Server] Development mode - Hot reload enabled`);
      }
    });
  }

  async gracefulShutdown(signal) {
    console.log(`[Server] Graceful shutdown initiated (${signal})...`);
    
    // 새로운 연결 거부
    this.server.close((err) => {
      if (err) {
        console.error('[Server] Error during server close:', err);
        return process.exit(1);
      }
      
      console.log('[Server] HTTP server closed');
    });

    // Socket.IO 연결 정리
    this.io.close((err) => {
      if (err) {
        console.error('[Socket] Error during socket close:', err);
      } else {
        console.log('[Socket] All socket connections closed');
      }
    });

    // 진행중인 전투 저장 (실제로는 데이터베이스에 저장)
    for (const [battleId, battle] of this.battles) {
      try {
        const battleData = battle.serialize();
        // TODO: 데이터베이스에 저장
        console.log(`[Battle] Saved battle ${battleId}`);
      } catch (error) {
        console.error(`[Battle] Failed to save battle ${battleId}:`, error);
      }
    }

    // 전투 정리
    this.battles.forEach(battle => {
      try {
        battle.destroy();
      } catch (error) {
        console.error('[Battle] Cleanup error:', error);
      }
    });

    console.log('[Server] Graceful shutdown completed');
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 유틸리티 메소드
  // ═══════════════════════════════════════════════════════════════════════
  
  generateOTP() {
    // 6자리 영숫자 OTP 생성
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let otp = '';
    
    for (let i = 0; i < 6; i++) {
      otp += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // 중복 방지
    if (this.otpStore.has(otp)) {
      return this.generateOTP();
    }
    
    return otp;
  }

  cleanupExpiredOTPs() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [otp, data] of this.otpStore) {
      if (now > data.expires) {
        this.otpStore.delete(otp);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[OTP] Cleaned up ${cleaned} expired OTPs`);
    }
  }

  broadcastServerStats() {
    const stats = {
      uptime: Date.now() - this.stats.startTime,
      battles: this.battles.size,
      connections: this.io.sockets.sockets.size,
      memory: process.memoryUsage()
    };

    // 관리자들에게 통계 브로드캐스트
    this.io.emit('admin:server_stats', stats);
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}일 ${hours % 24}시간`;
    } else if (hours > 0) {
      return `${hours}시간 ${minutes % 60}분`;
    } else if (minutes > 0) {
      return `${minutes}분 ${seconds % 60}초`;
    } else {
      return `${seconds}초`;
    }
  }
}

// 서버 시작
const server = new PyxisServer();

// PM2와 같은 프로세스 매니저를 위한 exports
module.exports = server;
