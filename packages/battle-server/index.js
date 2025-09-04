const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════════════════
// PYXIS Battle System - 완전한 서버 구현
// 우아한 네이비+골드 디자인, 게임풍 전투 시스템
// ═══════════════════════════════════════════════════════════════════════

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// 환경 설정
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// 필요한 디렉토리 생성
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
};

ensureDir('./public/pages');
ensureDir('./public/assets');
ensureDir('./uploads');
ensureDir('./logs');

// 메모리 저장소 (개발용 - 프로덕션에서는 DB 사용 권장)
const battles = new Map();
const otpStore = new Map(); // OTP 저장소
const rooms = new Map(); // Socket.io 룸 관리

// 유틸리티 함수들
function generateId(length = 8) {
  return Math.random().toString(36).substr(2, length).toUpperCase();
}

function generateOTP() {
  return Math.random().toString().substr(2, 6);
}

function logWithTimestamp(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  
  // 로그 파일에 기록
  const logFile = level === 'ERROR' ? './logs/error.log' : './logs/access.log';
  fs.appendFileSync(logFile, logMessage + '\n');
}

// ═══════════════════════════════════════════════════════════════════════
// 미들웨어 설정
// ═══════════════════════════════════════════════════════════════════════

// 보안 헤더
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS 설정
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.CORS_ORIGIN === '*' ? '*' : 
                        (process.env.CORS_ORIGIN || '').split(',');
  
  if (allowedOrigins === '*' || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

// JSON 파싱 (크기 제한)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 요청 로깅
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logWithTimestamp(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// 정적 파일 서빙 (캐싱 최적화)
app.use('/assets', express.static(path.join(__dirname, 'public/assets'), {
  maxAge: NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1h',
  etag: true
}));

// ═══════════════════════════════════════════════════════════════════════
// API 엔드포인트
// ═══════════════════════════════════════════════════════════════════════

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    battles: battles.size,
    uptime: process.uptime()
  });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', name = 'New Battle', adminPassword } = req.body;
    
    const battleId = generateId();
    const adminToken = generateId(16);
    
    const battle = {
      id: battleId,
      name,
      mode,
      adminToken,
      adminPassword: adminPassword || generateId(8),
      status: 'waiting', // waiting, active, finished
      createdAt: new Date().toISOString(),
      players: [],
      teams: {
        phoenix: [], // 불사조 기사단
        eaters: []   // 죽음을 먹는 자들
      },
      currentTurn: null,
      turnTimer: null,
      gameTimer: null,
      logs: [],
      settings: {
        turnTimeLimit: 5 * 60 * 1000, // 5분
        gameTimeLimit: 60 * 60 * 1000, // 1시간
        maxPlayersPerTeam: parseInt(mode.charAt(0))
      }
    };
    
    battles.set(battleId, battle);
    
    logWithTimestamp(`Battle created: ${battleId} (${mode}) by admin`);
    
    res.json({
      battleId,
      adminToken,
      adminPassword: battle.adminPassword,
      adminUrl: `/admin?battle=${battleId}&token=${adminToken}`,
      playerUrl: `/play?battle=${battleId}`,
      spectatorUrl: `/spectator?battle=${battleId}`
    });
    
  } catch (error) {
    logWithTimestamp(`Error creating battle: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to create battle' });
  }
});

// 플레이어 추가
app.post('/api/battles/:battleId/players', (req, res) => {
  try {
    const { battleId } = req.params;
    const { name, team, stats, avatar, items } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    if (battle.status !== 'waiting') {
      return res.status(400).json({ error: 'Battle already started' });
    }
    
    // 팀 인원 확인
    if (battle.teams[team].length >= battle.settings.maxPlayersPerTeam) {
      return res.status(400).json({ error: 'Team is full' });
    }
    
    const playerId = generateId();
    const player = {
      id: playerId,
      name,
      team,
      stats: {
        hp: stats.hp || 100,
        maxHp: stats.hp || 100,
        attack: stats.attack || 10,
        defense: stats.defense || 5,
        agility: stats.agility || 8,
        luck: stats.luck || 5
      },
      avatar: avatar || null,
      items: items || {
        attackBooster: 0,
        defenseBooster: 0,
        potion: 0
      },
      status: 'alive', // alive, dead
      effects: [], // 버프/디버프
      lastAction: null,
      joinedAt: new Date().toISOString()
    };
    
    battle.players.push(player);
    battle.teams[team].push(playerId);
    
    // Socket.io로 실시간 업데이트
    io.to(`battle-${battleId}`).emit('playerJoined', {
      player,
      teams: battle.teams
    });
    
    logWithTimestamp(`Player ${name} joined battle ${battleId} as ${team}`);
    
    res.json({
      playerId,
      player,
      battle: {
        id: battle.id,
        name: battle.name,
        mode: battle.mode,
        status: battle.status,
        teams: battle.teams
      }
    });
    
  } catch (error) {
    logWithTimestamp(`Error adding player: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// OTP 생성 (관전자용)
app.post('/api/otp', (req, res) => {
  try {
    const { battleId, adminToken } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle || battle.adminToken !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30분
    
    otpStore.set(otp, {
      battleId,
      expiresAt,
      used: false,
      maxUses: 30
    });
    
    res.json({ otp, expiresAt });
    
  } catch (error) {
    logWithTimestamp(`Error generating OTP: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

// OTP 검증
app.post('/api/otp/verify', (req, res) => {
  try {
    const { otp } = req.body;
    
    const otpData = otpStore.get(otp);
    if (!otpData) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }
    
    if (new Date() > otpData.expiresAt) {
      otpStore.delete(otp);
      return res.status(401).json({ error: 'OTP expired' });
    }
    
    if (otpData.used >= otpData.maxUses) {
      return res.status(401).json({ error: 'OTP usage limit exceeded' });
    }
    
    otpData.used++;
    
    res.json({
      valid: true,
      battleId: otpData.battleId,
      spectatorUrl: `/spectator?battle=${otpData.battleId}&otp=${otp}`
    });
    
  } catch (error) {
    logWithTimestamp(`Error verifying OTP: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Socket.IO 이벤트 핸들러
// ═══════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  logWithTimestamp(`Socket connected: ${socket.id}`);
  
  // 전투 방 참가
  socket.on('joinBattle', (data) => {
    try {
      const { battleId, role = 'spectator', playerId, adminToken, otp } = data;
      
      const battle = battles.get(battleId);
      if (!battle) {
        socket.emit('error', { message: 'Battle not found' });
        return;
      }
      
      // 권한 검증
      let authorized = false;
      
      if (role === 'admin' && battle.adminToken === adminToken) {
        authorized = true;
      } else if (role === 'player' && battle.players.some(p => p.id === playerId)) {
        authorized = true;
      } else if (role === 'spectator') {
        if (otp) {
          const otpData = otpStore.get(otp);
          authorized = otpData && otpData.battleId === battleId && new Date() <= otpData.expiresAt;
        } else {
          authorized = true; // 공개 관전
        }
      }
      
      if (!authorized) {
        socket.emit('error', { message: 'Unauthorized access' });
        return;
      }
      
      const roomName = `battle-${battleId}`;
      socket.join(roomName);
      
      socket.battleId = battleId;
      socket.role = role;
      socket.playerId = playerId;
      
      // 현재 전투 상태 전송
      socket.emit('battleState', {
        battle: {
          ...battle,
          adminToken: role === 'admin' ? battle.adminToken : undefined,
          adminPassword: role === 'admin' ? battle.adminPassword : undefined
        }
      });
      
      logWithTimestamp(`Socket ${socket.id} joined battle ${battleId} as ${role}`);
      
    } catch (error) {
      logWithTimestamp(`Socket joinBattle error: ${error.message}`, 'ERROR');
      socket.emit('error', { message: 'Failed to join battle' });
    }
  });
  
  // 채팅 메시지
  socket.on('chatMessage', (data) => {
    try {
      const { message, playerName } = data;
      
      if (!socket.battleId) {
        socket.emit('error', { message: 'Not in a battle' });
        return;
      }
      
      const chatData = {
        id: generateId(),
        message: message.substring(0, 500), // 메시지 길이 제한
        sender: playerName || 'Anonymous',
        role: socket.role,
        timestamp: new Date().toISOString()
      };
      
      // 같은 방의 모든 클라이언트에게 전송
      io.to(`battle-${socket.battleId}`).emit('chatMessage', chatData);
      
    } catch (error) {
      logWithTimestamp(`Socket chatMessage error: ${error.message}`, 'ERROR');
    }
  });
  
  // 플레이어 액션
  socket.on('playerAction', (data) => {
    try {
      const { action, target, itemType } = data;
      
      if (!socket.battleId || socket.role !== 'player') {
        socket.emit('error', { message: 'Unauthorized action' });
        return;
      }
      
      const battle = battles.get(socket.battleId);
      const player = battle.players.find(p => p.id === socket.playerId);
      
      if (!player || player.status !== 'alive') {
        socket.emit('error', { message: 'Player cannot act' });
        return;
      }
      
      // TODO: 액션 처리 로직 구현
      // - 공격, 방어, 회피, 아이템 사용, 패스
      // - 주사위 굴리기, 데미지 계산
      // - 턴 관리
      
      logWithTimestamp(`Player ${player.name} performed ${action} in battle ${socket.battleId}`);
      
    } catch (error) {
      logWithTimestamp(`Socket playerAction error: ${error.message}`, 'ERROR');
    }
  });
  
  // 연결 해제
  socket.on('disconnect', () => {
    logWithTimestamp(`Socket disconnected: ${socket.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// HTML 페이지 라우팅
// ═══════════════════════════════════════════════════════════════════════

// 관리자 페이지
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/admin.html'));
});

// 플레이어 페이지
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/play.html'));
});

// 관전자 페이지
app.get('/spectator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/spectator.html'));
});

// 메인 페이지 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ═══════════════════════════════════════════════════════════════════════
// 에러 핸들링
// ═══════════════════════════════════════════════════════════════════════

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 글로벌 에러 핸들러
app.use((error, req, res, next) => {
  logWithTimestamp(`Global error: ${error.message}`, 'ERROR');
  res.status(500).json({ error: 'Internal server error' });
});

// ═══════════════════════════════════════════════════════════════════════
// 서버 시작 및 우아한 종료
// ═══════════════════════════════════════════════════════════════════════

// 우아한 종료
const gracefulShutdown = () => {
  console.log('Shutting down gracefully...');
  
  server.close(() => {
    console.log('HTTP server closed');
    
    // 진행 중인 전투 정리
    battles.clear();
    otpStore.clear();
    
    process.exit(0);
  });
  
  // 강제 종료 (10초 후)
  setTimeout(() => {
    console.log('Forcing shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
  logWithTimestamp(`Uncaught exception: ${error.message}`, 'ERROR');
  console.error(error.stack);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logWithTimestamp(`Unhandled rejection at ${promise}: ${reason}`, 'ERROR');
});

// 서버 시작
server.listen(PORT, HOST, () => {
  console.log(`
=================================================================
  PYXIS Battle System Server
=================================================================
  Environment: ${NODE_ENV}
  Server: http://${HOST}:${PORT}
  
  Admin Panel: http://${HOST}:${PORT}/admin
  Player Page: http://${HOST}:${PORT}/play  
  Spectator: http://${HOST}:${PORT}/spectator
  
  API Health: http://${HOST}:${PORT}/api/health
=================================================================
  `);
  
  logWithTimestamp(`PYXIS server started on ${HOST}:${PORT} (${NODE_ENV})`);
});

module.exports = { app, server, io };
