// ESM Entry for PYXIS Battle Server
// - Loads .env
// - Serves static files
// - Adds /admin /player /spectator routes
// - Exposes /healthz
// - Wires minimal Socket.IO channels expected by the UI (auth/join/chat/cheer/log/update)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import { Server as IOServer } from 'socket.io';
import multer from 'multer';

// --------------------------------------------------
// Env & Paths
// --------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from packages/battle-server/.env (preferred) or fallback to repo root
const envLocal = path.join(__dirname, '.env');
const envRoot = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
else if (fs.existsSync(envRoot)) dotenv.config({ path: envRoot });
else dotenv.config();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
if (!Number.isFinite(PORT) || PORT <= 0 || PORT >= 65536) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

console.log(`[PYXIS] 서버 시작 중...`);
console.log(`- 환경: ${process.env.NODE_ENV || 'development'}`);
console.log(`- 포트: ${PORT}`);
console.log(`- 호스트: ${HOST}`);
console.log(`- 기본 URL: ${PUBLIC_BASE_URL}`);

// --------------------------------------------------
// 디렉토리 생성
// --------------------------------------------------
const directories = ['uploads', 'logs'];
directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[PYXIS] 디렉토리 생성: ${dir}`);
  }
});

// --------------------------------------------------
// Minimal In-Memory State (for demo/compat)
// 실제 운영 로직이 별도 모듈에 있다면, 아래는 안전하게 대체/제거해도 됨.
// --------------------------------------------------
const battles = new Map(); // battleId -> { status, players[], log[], spectators: Set<socketId> }

// Helpers
const now = () => Date.now();
function ensureBattle(battleId) {
  if (!battles.has(battleId)) {
    battles.set(battleId, {
      id: battleId,
      mode: '1v1',
      status: 'waiting', // waiting | active | paused | ended
      players: [],       // { id, team, name, hp, stats, items }
      log: [],           // { ts, type, message }
      spectators: new Set(),
      createdAt: new Date().toISOString(),
      turn: 0,
      current: null,
      effects: []
    });
  }
  return battles.get(battleId);
}

function pushLog(b, type, message) {
  const item = { ts: now(), type, message };
  b.log.push(item);
  if (b.log.length > 200) b.log.splice(0, b.log.length - 200);
  return item;
}

// 전투 생성 헬퍼
function createNewBattle(mode = '1v1') {
  const battleId = `b_${Math.random().toString(36).slice(2, 10)}`;
  const battle = ensureBattle(battleId);
  battle.mode = mode;
  battle.status = 'waiting';
  pushLog(battle, 'system', `전투 생성: 모드=${mode}`);
  
  const url = new URL(PUBLIC_BASE_URL);
  const adminUrl = `${url.origin}/admin?battle=${battleId}&token=admin-${battleId}`;
  const playerBase = `${url.origin}/player?battle=${battleId}`;
  const spectatorBase = `${url.origin}/spectator?battle=${battleId}`;
  
  return {
    battleId,
    battle,
    adminUrl,
    playerBase,
    spectatorBase
  };
}

// 플레이어 추가 헬퍼
function addPlayerToBattle(battleId, playerData) {
  const battle = ensureBattle(battleId);
  
  // 중복 확인
  const existing = battle.players.find(p => p.name === playerData.name);
  if (existing) {
    throw new Error('이미 존재하는 플레이어 이름입니다');
  }
  
  const player = {
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    name: playerData.name,
    team: playerData.team || 'phoenix',
    hp: 100,
    maxHp: 100,
    stats: {
      attack: playerData.stats?.attack || 3,
      defense: playerData.stats?.defense || 3,
      agility: playerData.stats?.agility || 3,
      luck: playerData.stats?.luck || 3
    },
    items: {
      dittany: playerData.items?.dittany || 1,
      attack_booster: playerData.items?.attack_booster || 1,
      defense_booster: playerData.items?.defense_booster || 1
    },
    avatar: playerData.avatar || null,
    isReady: false,
    isAlive: true
  };
  
  battle.players.push(player);
  pushLog(battle, 'system', `전투 참가자 추가: ${player.name} (${player.team}팀)`);
  
  return player;
}

// --------------------------------------------------
// Express + Multer
// --------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다'));
    }
  }
});

// 정적 파일
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 진입 라우트(고정)
app.get('/admin', (_, res) => res.sendFile(path.join(publicDir, 'pages', 'admin.html')));
app.get('/player', (_, res) => res.sendFile(path.join(publicDir, 'pages', 'player.html')));
app.get('/spectator', (_, res) => res.sendFile(path.join(publicDir, 'pages', 'spectator.html')));

// 헬스체크
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    battles: battles.size,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      HOST,
      PORT,
      PUBLIC_BASE_URL
    }
  });
});

// API 라우트들
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    battles: battles.size,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      HOST,
      PORT,
      PUBLIC_BASE_URL
    }
  });
});

// 전투 생성 API
app.post('/api/battles', (req, res) => {
  try {
    const mode = String(req.body?.mode || '1v1');
    const result = createNewBattle(mode);
    
    res.json({
      ok: true,
      id: result.battleId,
      adminUrl: result.adminUrl,
      playerBase: result.playerBase,
      spectatorBase: result.spectatorBase
    });
  } catch (error) {
    console.error('전투 생성 API 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 전투 시작 API
app.post('/api/battles/:id/start', (req, res) => {
  try {
    const battle = ensureBattle(req.params.id);
    
    if (battle.players.length < 2) {
      return res.status(400).json({ ok: false, error: '최소 2명의 참여자가 필요합니다' });
    }
    
    battle.status = 'active';
    battle.startedAt = new Date().toISOString();
    pushLog(battle, 'system', '전투 시작');
    
    // 모든 클라이언트에게 알림
    io.to(battle.id).emit('battle:update', serializeBattle(battle));
    io.to(battle.id).emit('battle:started', serializeBattle(battle));
    
    res.json({ ok: true });
  } catch (error) {
    console.error('전투 시작 API 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 아바타 업로드 API
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '파일이 업로드되지 않았습니다' });
    }
    
    const avatarUrl = `/uploads/${req.file.filename}`;
    res.json({ ok: true, avatarUrl });
  } catch (error) {
    console.error('아바타 업로드 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --------------------------------------------------
// HTTP + Socket.IO
// --------------------------------------------------
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true, credentials: true }
});

// 클라이언트 전달용 battle 스냅샷
function serializeBattle(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    players: b.players,
    log: b.log,
    turn: b.turn,
    current: b.current,
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    spectatorCount: b.spectators.size
  };
}

// 소켓 이벤트
io.on('connection', (socket) => {
  console.log(`[SOCKET] 연결: ${socket.id}`);

  // 공통: 룸 합류
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const b = ensureBattle(battleId);
    socket.emit('battle:update', serializeBattle(b));
    console.log(`[SOCKET] 룸 참여: ${socket.id} -> ${battleId}`);
  });

  // ========== 관리자 이벤트 ==========
  
  // 관리자 인증
  socket.on('adminAuth', ({ battleId, token }) => {
    if (!battleId || !token) return socket.emit('authError', { error: 'Missing credentials' });
    const b = ensureBattle(battleId);
    // 간이 토큰 규칙: admin-${battleId}
    if (token !== `admin-${battleId}`) return socket.emit('authError', { error: 'Invalid token' });
    socket.join(battleId);
    socket.emit('auth:success', { role: 'admin', battleId });
    socket.emit('battle:update', serializeBattle(b));
    console.log(`[SOCKET] 관리자 인증: ${socket.id} -> ${battleId}`);
  });

  // 전투 생성 (Socket 이벤트)
  socket.on('createBattle', ({ mode }) => {
    try {
      console.log(`[SOCKET] 전투 생성 요청: ${mode}`);
      const result = createNewBattle(mode);
      
      socket.emit('battleCreated', {
        success: true,
        battleId: result.battleId,
        mode: result.battle.mode,
        adminUrl: result.adminUrl,
        playerBase: result.playerBase,
        spectatorBase: result.spectatorBase
      });
      
      socket.emit('battle:update', serializeBattle(result.battle));
      console.log(`[SOCKET] 전투 생성 완료: ${result.battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 생성 오류:', error);
      socket.emit('battleCreated', {
        success: false,
        error: error.message
      });
    }
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId }) => {
    try {
      if (!battleId) {
        socket.emit('battleError', { error: '전투 ID가 필요합니다' });
        return;
      }
      
      const battle = ensureBattle(battleId);
      
      if (battle.players.length < 2) {
        socket.emit('battleError', { error: '최소 2명의 참여자가 필요합니다' });
        return;
      }
      
      battle.status = 'active';
      battle.startedAt = new Date().toISOString();
      pushLog(battle, 'system', '전투 시작');
      
      // 모든 클라이언트에게 전투 시작 알림
      io.to(battleId).emit('battle:started', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      
      socket.emit('battleStarted', { success: true, battleId });
      console.log(`[SOCKET] 전투 시작: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 시작 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 일시정지
  socket.on('pauseBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      battle.status = 'paused';
      pushLog(battle, 'system', '전투 일시정지');
      
      io.to(battleId).emit('battle:paused', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      console.log(`[SOCKET] 전투 일시정지: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 일시정지 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 재개
  socket.on('resumeBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      battle.status = 'active';
      pushLog(battle, 'system', '전투 재개');
      
      io.to(battleId).emit('battle:resumed', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      console.log(`[SOCKET] 전투 재개: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 재개 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 종료
  socket.on('endBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      battle.status = 'ended';
      battle.endedAt = new Date().toISOString();
      pushLog(battle, 'system', '전투 종료');
      
      io.to(battleId).emit('battle:ended', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      console.log(`[SOCKET] 전투 종료: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 종료 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 플레이어 추가
  socket.on('addPlayer', ({ battleId, playerData }) => {
    try {
      const player = addPlayerToBattle(battleId, playerData);
      const battle = ensureBattle(battleId);
      
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerAdded', { success: true, player });
      console.log(`[SOCKET] 플레이어 추가: ${player.name} -> ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 플레이어 추가 오류:', error);
      socket.emit('playerAdded', { success: false, error: error.message });
    }
  });

  // OTP 생성
  socket.on('generatePlayerOtp', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      const playerLinks = battle.players.map(player => ({
        name: player.name,
        url: `${PUBLIC_BASE_URL}/player?battle=${battleId}&token=player-${player.name}-${battleId}&name=${encodeURIComponent(player.name)}`
      }));
      
      socket.emit('playerOtpGenerated', { success: true, playerLinks });
      console.log(`[SOCKET] 플레이어 OTP 생성: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 플레이어 OTP 생성 오류:', error);
      socket.emit('playerOtpGenerated', { success: false, error: error.message });
    }
  });

  socket.on('generateSpectatorOtp', ({ battleId }) => {
    try {
      const spectatorUrl = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}&otp=spectator-${battleId}`;
      
      socket.emit('spectatorOtpGenerated', { success: true, spectatorUrl });
      console.log(`[SOCKET] 관전자 OTP 생성: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 관전자 OTP 생성 오류:', error);
      socket.emit('spectatorOtpGenerated', { success: false, error: error.message });
    }
  });

  // ========== 플레이어 이벤트 ==========
  
  // 플레이어 인증
  socket.on('playerAuth', ({ battleId, name, token }) => {
    if (!battleId || !name || !token) return socket.emit('authError', { error: 'Missing credentials' });
    const b = ensureBattle(battleId);
    // 간이 토큰 규칙: player-${name}-${battleId}
    if (token !== `player-${name}-${battleId}`) return socket.emit('authError', { error: 'Invalid token' });

    // 플레이어 찾기
    let p = b.players.find((x) => x.name === name);
    if (!p) {
      return socket.emit('authError', { error: '등록되지 않은 플레이어입니다' });
    }

    socket.join(battleId);
    socket.emit('auth:success', { role: 'player', battleId, playerId: p.id });
    socket.emit('battle:update', serializeBattle(b));
    console.log(`[SOCKET] 플레이어 인증: ${name} -> ${battleId}`);
  });

  // 플레이어 준비
  socket.on('player:ready', ({ battleId, playerId }) => {
    try {
      const battle = ensureBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      
      if (player) {
        player.isReady = true;
        pushLog(battle, 'system', `${player.name} 준비완료`);
        io.to(battleId).emit('battle:update', serializeBattle(battle));
        console.log(`[SOCKET] 플레이어 준비: ${player.name}`);
      }
    } catch (error) {
      console.error('[SOCKET] 플레이어 준비 오류:', error);
    }
  });

  // 플레이어 액션
  socket.on('player:action', ({ battleId, playerId, action }) => {
    try {
      const battle = ensureBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      
      if (player && battle.status === 'active') {
        const actionText = action?.type || 'unknown';
        pushLog(battle, 'battle', `${player.name}의 행동: ${actionText}`);
        io.to(battleId).emit('battle:log', { 
          type: 'battle', 
          message: `${player.name}의 행동: ${actionText}`,
          timestamp: new Date().toISOString()
        });
        console.log(`[SOCKET] 플레이어 액션: ${player.name} -> ${actionText}`);
      }
    } catch (error) {
      console.error('[SOCKET] 플레이어 액션 오류:', error);
    }
  });

  // ========== 관전자 이벤트 ==========
  
  // 관전자 인증
  socket.on('spectatorAuth', ({ battleId, otp, name }) => {
    if (!battleId || !otp) return socket.emit('authError', { error: 'Missing credentials' });
    const b = ensureBattle(battleId);
    // 간이 규칙: otp === `spectator-${battleId}`
    if (otp !== `spectator-${battleId}`) return socket.emit('authError', { error: 'Invalid password' });

    b.spectators.add(socket.id);
    socket.join(battleId);
    socket.emit('auth:success', { role: 'spectator', battleId });
    socket.emit('battle:update', serializeBattle(b));
    io.to(b.id).emit('spectator:count', { count: b.spectators.size });
    console.log(`[SOCKET] 관전자 인증: ${name || 'Anonymous'} -> ${battleId}`);
  });

  // ========== 공통 이벤트 ==========
  
  // 채팅
  socket.on('chat:send', ({ battleId, name, message, team }) => {
    if (!battleId || !message) return;
    
    const chatData = { 
      name: name || '익명', 
      message,
      team: team || null,
      timestamp: new Date().toISOString()
    };
    
    io.to(battleId).emit('battle:chat', chatData);
    console.log(`[SOCKET] 채팅: ${chatData.name} -> ${message}`);
  });

  // 응원
  socket.on('cheer:send', ({ battleId, cheer, name }) => {
    if (!battleId || !cheer) return;
    
    const cheerMessage = name ? `${name}: ${cheer}` : cheer;
    io.to(battleId).emit('battle:log', { 
      type: 'cheer', 
      message: cheerMessage,
      timestamp: new Date().toISOString()
    });
    console.log(`[SOCKET] 응원: ${cheerMessage}`);
  });

  // 연결 종료
  socket.on('disconnect', () => {
    console.log(`[SOCKET] 연결 해제: ${socket.id}`);
    
    // 관전자 카운트 정리
    for (const b of battles.values()) {
      if (b.spectators.delete(socket.id)) {
        io.to(b.id).emit('spectator:count', { count: b.spectators.size });
      }
    }
  });

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error(`[SOCKET] 소켓 오류 ${socket.id}:`, error);
  });
});

// --------------------------------------------------
// Start
// --------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] Listening on http://${HOST}:${PORT} (public: ${PUBLIC_BASE_URL})`);
  console.log(`[PYXIS] 관리자: ${PUBLIC_BASE_URL}/admin`);
  console.log(`[PYXIS] 플레이어: ${PUBLIC_BASE_URL}/player`);
  console.log(`[PYXIS] 관전자: ${PUBLIC_BASE_URL}/spectator`);
});

// 우아한 종료 처리
process.on('SIGTERM', () => {
  console.log('[PYXIS] SIGTERM 수신, 서버 종료 중...');
  server.close(() => {
    console.log('[PYXIS] 서버 종료 완료');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[PYXIS] SIGINT 수신, 서버 종료 중...');
  server.close(() => {
    console.log('[PYXIS] 서버 종료 완료');
    process.exit(0);
  });
});
