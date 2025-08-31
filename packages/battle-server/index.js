// PYXIS Battle System Server - Complete Setup
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙
const PUB = path.join(__dirname, 'public');
app.use('/assets', express.static(path.join(PUB, 'assets'), { 
  maxAge: '1d',
  etag: true
}));
app.use('/pages', express.static(path.join(PUB, 'pages'), { 
  maxAge: '1d',
  etag: true
}));

// 파비콘
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(PUB, 'assets', 'images', 'favicon.svg'));
});

// 메인 라우팅
app.get('/', (_req, res) => {
  res.redirect('/admin');
});

// 페이지 라우팅
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUB, 'pages', 'admin.html'));
});

app.get('/play', (_req, res) => {
  res.sendFile(path.join(PUB, 'pages', 'play.html'));
});

app.get('/spectator', (_req, res) => {
  res.sendFile(path.join(PUB, 'pages', 'spectator.html'));
});

app.get('/watch', (_req, res) => {
  res.redirect('/spectator');
});

// 확장자 포함 URL 지원 (리다이렉트)
app.get('/admin.html', (_req, res) => {
  res.redirect('/admin');
});

app.get('/play.html', (_req, res) => {
  res.redirect('/play');
});

app.get('/spectator.html', (_req, res) => {
  res.redirect('/spectator');
});

app.get('/watch.html', (_req, res) => {
  res.redirect('/spectator');
});

// API 라우팅
app.get('/api/health', (_req, res) => {
  res.json({ 
    ok: true, 
    status: 'running',
    timestamp: new Date().toISOString(),
    service: 'PYXIS Battle System'
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 전투 관련 API (기본 구조)
app.post('/api/admin/battles', async (req, res) => {
  try {
    const { mode } = req.body;
    
    // 전투 ID 생성
    const battleId = generateBattleId();
    const adminOtp = generateOtp();
    const spectatorOtp = generateOtp();
    
    // 여기에 실제 전투 생성 로직 추가
    console.log(`[API] Creating battle: ${battleId}, mode: ${mode}`);
    
    res.json({
      ok: true,
      battleId,
      adminOtp,
      spectatorOtp,
      mode,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Battle creation error:', error);
    res.status(500).json({
      ok: false,
      message: '전투 생성 실패',
      error: error.message
    });
  }
});

app.post('/api/admin/battles/:battleId/start', async (req, res) => {
  try {
    const { battleId } = req.params;
    
    // 전투 시작 로직
    console.log(`[API] Starting battle: ${battleId}`);
    
    res.json({
      ok: true,
      message: '전투가 시작되었습니다',
      battleId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Battle start error:', error);
    res.status(500).json({
      ok: false,
      message: '전투 시작 실패',
      error: error.message
    });
  }
});

app.post('/api/admin/battles/:battleId/end', async (req, res) => {
  try {
    const { battleId } = req.params;
    
    // 전투 종료 로직
    console.log(`[API] Ending battle: ${battleId}`);
    
    res.json({
      ok: true,
      message: '전투가 종료되었습니다',
      battleId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Battle end error:', error);
    res.status(500).json({
      ok: false,
      message: '전투 종료 실패',
      error: error.message
    });
  }
});

app.post('/api/admin/battles/:battleId/links', async (req, res) => {
  try {
    const { battleId } = req.params;
    const baseUrl = req.protocol + '://' + req.get('host');
    
    // 링크 생성
    const playToken = generateToken();
    const watchToken = generateToken();
    const adminToken = generateToken();
    
    const links = {
      ok: true,
      play: `${baseUrl}/play?battleId=${battleId}&token=${playToken}`,
      watch: `${baseUrl}/spectator?battleId=${battleId}&token=${watchToken}`,
      admin: `${baseUrl}/admin?battleId=${battleId}&token=${adminToken}`,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[API] Generated links for battle: ${battleId}`);
    
    res.json(links);
  } catch (error) {
    console.error('[API] Link generation error:', error);
    res.status(500).json({
      ok: false,
      message: '링크 생성 실패',
      error: error.message
    });
  }
});

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  // 연결 확인 메시지
  socket.emit('connection:success', { 
    message: '소켓 연결 성공',
    socketId: socket.id,
    timestamp: new Date().toISOString()
  });
  
  // 관리자 인증
  socket.on('admin:auth', (data) => {
    console.log(`[Socket] Admin auth request:`, data);
    
    // 인증 로직 (실제 구현 필요)
    const authSuccess = true; // 임시
    
    if (authSuccess) {
      socket.join(`battle-${data.battleId}`);
      socket.join(`admin-${data.battleId}`);
      
      socket.emit('admin:authSuccess', {
        message: '관리자 인증 성공',
        battleId: data.battleId,
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('admin:authError', {
        message: '관리자 인증 실패'
      });
    }
  });
  
  // 플레이어 인증
  socket.on('player:auth', (data) => {
    console.log(`[Socket] Player auth request:`, data);
    
    // 인증 로직 (실제 구현 필요)
    const authSuccess = true; // 임시
    
    if (authSuccess) {
      socket.join(`battle-${data.battleId}`);
      socket.join(`player-${data.battleId}`);
      
      socket.emit('player:authSuccess', {
        message: '플레이어 인증 성공',
        battleId: data.battleId,
        playerData: {
          id: socket.id,
          name: data.name,
          team: data.team || 'A'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('player:authError', {
        message: '플레이어 인증 실패'
      });
    }
  });
  
  // 관전자 인증
  socket.on('spectator:join', (data) => {
    console.log(`[Socket] Spectator join request:`, data);
    
    // 인증 로직 (실제 구현 필요)
    const authSuccess = true; // 임시
    
    if (authSuccess) {
      socket.join(`battle-${data.battleId}`);
      socket.join(`spectator-${data.battleId}`);
      
      socket.emit('spectator:authSuccess', {
        message: '관전자 인증 성공',
        battleId: data.battleId,
        spectatorName: data.name,
        battleState: {
          // 임시 전투 상태
          status: 'ongoing',
          teams: {
            A: { name: '불사조 기사단', players: [] },
            B: { name: '죽음을 먹는 자들', players: [] }
          }
        },
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('spectator:authError', {
        message: '관전자 인증 실패'
      });
    }
  });
  
  // 채팅 메시지
  socket.on('chat:send', (data) => {
    console.log(`[Socket] Chat message:`, data);
    
    const chatData = {
      id: generateId(),
      name: data.name || 'Anonymous',
      message: data.message,
      type: data.type || 'normal',
      timestamp: new Date().toISOString()
    };
    
    // 해당 전투방에 브로드캐스트
    io.to(`battle-${data.battleId}`).emit('chat:new', chatData);
  });
  
  // 응원 메시지 (관전자)
  socket.on('spectator:cheer', (data) => {
    console.log(`[Socket] Spectator cheer:`, data);
    
    const cheerData = {
      id: generateId(),
      name: data.spectatorName,
      message: data.message,
      type: 'cheer',
      timestamp: new Date().toISOString()
    };
    
    // 해당 전투방에 브로드캐스트
    io.to(`battle-${data.battleId}`).emit('chat:spectator', cheerData);
  });
  
  // 연결 해제
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// 에러 핸들링
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  
  res.status(err.status || 500).json({
    ok: false,
    message: err.message || '서버 오류가 발생했습니다',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 핸들링
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.url}`);
  
  res.status(404).json({
    ok: false,
    message: '페이지를 찾을 수 없습니다',
    path: req.url,
    method: req.method
  });
});

// 유틸리티 함수들
function generateBattleId() {
  return 'B' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
}

function generateOtp() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function generateToken() {
  return Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// 서버 시작
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('=================================================');
  console.log('     PYXIS BATTLE SYSTEM - Server Started');
  console.log('=================================================');
  console.log('');
  console.log(`서버 URL: http://${HOST}:${PORT}`);
  console.log('');
  console.log('사용 가능한 경로:');
  console.log(`   관리자:     http://${HOST}:${PORT}/admin`);
  console.log(`   플레이어:   http://${HOST}:${PORT}/play`);
  console.log(`   관전자:     http://${HOST}:${PORT}/spectator`);
  console.log(`   상태 확인:  http://${HOST}:${PORT}/api/health`);
  console.log('');
  console.log('Socket.IO: 준비 완료');
  console.log('환경:', process.env.NODE_ENV || 'development');
  console.log('');
  console.log('=================================================');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM 수신, 정상 종료 중...');
  server.close(() => {
    console.log('[Server] 서버 종료 완료');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT 수신, 정상 종료 중...');
  server.close(() => {
    console.log('[Server] 서버 종료 완료');
    process.exit(0);
  });
});

// 예외 처리
process.on('uncaughtException', (err) => {
  console.error('[Server] 미처리 예외:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] 미처리 Promise 거부:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = { app, server, io };
