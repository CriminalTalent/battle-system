/* packages/battle-server/index.js (ESM) */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import { Server as IOServer } from 'socket.io';

/* ─────────────────────────── 기본 설정 ─────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: '/socket.io',
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));

/* ───────────────────── 정적 라우팅 + 별칭 (/admin 등) ───────────────────── */
const PUBLIC_DIR = path.resolve(__dirname, 'public');

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// 업로드 디렉토리 설정
const uploadsDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

const send = file => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/', send('admin.html'));          // 루트 → 관리자
app.get('/admin', send('admin.html'));
app.get('/player', send('player.html'));
app.get('/spectator', send('spectator.html'));

/* ─────────────────────────── 공용 유틸 ─────────────────────────── */
const battles = new Map(); // id -> battle state
const passwordStore = new Map(); // 토큰/OTP 저장소

// BattleEngine 임포트
import { createBattleStore } from './src/engine/BattleEngine.js';
const battleEngine = createBattleStore();

/* ─────────────────────────── 업로드 설정 ─────────────────────────── */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, avatarsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'avatar-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
  }
});

/* ─────────────────────────── API 라우트 ─────────────────────────── */

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    battles: battleEngine.size(),
    uptime: process.uptime()
  });
});

// 아바타 업로드
app.use('/api/upload', express.Router().post('/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '파일이 없습니다' });
    }
    
    const url = `/uploads/avatars/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}));

// 전투 생성 (HTTP 폴백)
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '2v2' } = req.body;
    const battle = battleEngine.create(mode);
    battles.set(battle.id, battle);
    
    res.json({ ok: true, battleId: battle.id, battle });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 링크 생성 함수
function buildLinks(battle, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  
  // 관전자 OTP 생성
  if (!battle.spectatorOtp) {
    battle.spectatorOtp = Math.random().toString(36).slice(2, 8).toUpperCase();
    passwordStore.set(`spectator_${battle.id}`, { 
      otp: battle.spectatorOtp, 
      expiresAt: Date.now() + 30 * 60 * 1000 
    });
  }
  
  // 플레이어 토큰 생성
  battle.players.forEach(player => {
    if (!player.token) {
      player.token = Math.random().toString(36).slice(2, 8).toUpperCase();
      passwordStore.set(`player_${battle.id}_${player.id}`, { 
        token: player.token, 
        expiresAt: Date.now() + 30 * 60 * 1000 
      });
    }
  });
  
  const spectator = {
    otp: battle.spectatorOtp,
    url: base ? `${base}/spectator?battle=${encodeURIComponent(battle.id)}&otp=${encodeURIComponent(battle.spectatorOtp)}` : undefined,
  };
  
  const players = (battle.players || []).map((p) => ({
    id: p.id,
    playerId: p.id,
    name: p.name,
    playerName: p.name,
    team: p.team,
    otp: p.token,
    token: p.token,
    url: base ? `${base}/player?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(p.token)}` : undefined,
  }));
  
  return {
    spectator,
    players,
    playerLinks: players  // 기존 클라이언트 호환용
  };
}

// 링크 생성 (관리자용)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battle = battleEngine.get(req.params.id);
    if (!battle) {
      return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = buildLinks(battle, baseUrl);

    res.json({ ok: true, links });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 링크 생성 (호환성)
app.post('/api/battles/:id/links', (req, res) => {
  try {
    const battle = battleEngine.get(req.params.id);
    if (!battle) {
      return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = buildLinks(battle, baseUrl);

    res.json({ ok: true, links });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* ─────────────────────────── 브로드캐스트 헬퍼 ─────────────────────────── */
function broadcastToRoom(battleId, event, data) {
  io.to(`battle_${battleId}`).emit(event, data);
}

function broadcastBattleUpdate(battle) {
  const snapshot = battleEngine.snapshot(battle.id);
  if (snapshot) {
    broadcastToRoom(battle.id, 'battleUpdate', snapshot);
    broadcastToRoom(battle.id, 'battle:update', snapshot);
  }
}

function broadcastLog(battleId, log) {
  broadcastToRoom(battleId, 'battle:log', log);
  broadcastToRoom(battleId, 'battleLog', log);
}

function broadcastChat(battleId, chat) {
  broadcastToRoom(battleId, 'chatMessage', chat);
  broadcastToRoom(battleId, 'battle:chat', chat);
}

/* ─────────────────────────── 소켓 핸들러 ─────────────────────────── */
io.on('connection', (socket) => {
  console.log(`[SOCKET] 클라이언트 연결: ${socket.id}`);
  
  let currentBattle = null;
  let currentPlayerId = null;
  let displayName = null;
  let joinedRole = null;
  let joinedTeamAB = null;

  // 방 입장
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    
    const battle = battleEngine.get(battleId);
    if (!battle) {
      socket.emit('error', { message: '전투를 찾을 수 없습니다' });
      return;
    }
    
    currentBattle = battleId;
    socket.join(`battle_${battleId}`);
    
    // 현재 상태 전송
    const snapshot = battleEngine.snapshot(battleId);
    if (snapshot) {
      socket.emit('battleUpdate', snapshot);
      socket.emit('battle:update', snapshot);
    }
  });

  // 전투 생성
  socket.on('createBattle', ({ mode = '2v2' }, callback) => {
    try {
      const battle = battleEngine.create(mode);
      battles.set(battle.id, battle);
      
      currentBattle = battle.id;
      socket.join(`battle_${battle.id}`);
      
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: `${mode} 전투가 생성되었습니다`
      });
      
      broadcastBattleUpdate(battle);
      callback({ ok: true, battleId: battle.id });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId }, callback) => {
    try {
      const result = battleEngine.start(battleId);
      if (!result) {
        return callback({ ok: false, error: '전투를 시작할 수 없습니다' });
      }
      
      broadcastBattleUpdate(result.b);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 전투 일시정지
  socket.on('pauseBattle', ({ battleId }, callback) => {
    try {
      const battle = battleEngine.get(battleId);
      if (!battle) {
        return callback({ ok: false, error: '전투를 찾을 수 없습니다' });
      }
      
      battle.status = 'paused';
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: '전투가 일시정지되었습니다'
      });
      
      broadcastBattleUpdate(battle);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 전투 재개
  socket.on('resumeBattle', ({ battleId }, callback) => {
    try {
      const battle = battleEngine.get(battleId);
      if (!battle) {
        return callback({ ok: false, error: '전투를 찾을 수 없습니다' });
      }
      
      battle.status = 'active';
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: '전투가 재개되었습니다'
      });
      
      broadcastBattleUpdate(battle);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 전투 종료
  socket.on('endBattle', ({ battleId }, callback) => {
    try {
      const battle = battleEngine.end(battleId);
      if (!battle) {
        return callback({ ok: false, error: '전투를 찾을 수 없습니다' });
      }
      
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: '전투가 종료되었습니다'
      });
      
      broadcastBattleUpdate(battle);
      broadcastToRoom(battleId, 'battle:ended', { winner: 'Draw' });
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 플레이어 추가
  socket.on('addPlayer', ({ battleId, player }, callback) => {
    try {
      const addedPlayer = battleEngine.addPlayer(battleId, player);
      if (!addedPlayer) {
        return callback({ ok: false, error: '플레이어 추가에 실패했습니다' });
      }
      
      const battle = battleEngine.get(battleId);
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: `${addedPlayer.name}이(가) ${addedPlayer.team}팀에 입장했습니다`
      });
      
      broadcastBattleUpdate(battle);
      callback({ ok: true, player: addedPlayer });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 플레이어 제거
  socket.on('deletePlayer', ({ battleId, playerId }, callback) => {
    socket.emit('removePlayer', { battleId, playerId }, callback);
  });

  socket.on('removePlayer', ({ battleId, playerId }, callback) => {
    try {
      const battle = battleEngine.get(battleId);
      if (!battle) {
        return callback({ ok: false, error: '전투를 찾을 수 없습니다' });
      }
      
      const player = battle.players.find(p => p.id === playerId);
      const removed = battleEngine.removePlayer(battleId, playerId);
      
      if (removed && player) {
        battle.logs.push({
          ts: Date.now(),
          type: 'system',
          message: `${player.name}이(가) 퇴장했습니다`
        });
        
        broadcastBattleUpdate(battle);
      }
      
      callback({ ok: removed });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  // 플레이어 인증
  socket.on('playerAuth', ({ battleId, name, token, team }, callback) => {
    try {
      const battle = battleEngine.get(battleId);
      if (!battle) {
        socket.emit('authError', { error: 'not found' });
        return callback?.({ ok: false, error: 'not found' });
      }

      let player = null;
      if (token) {
        player = battleEngine.authByToken(battleId, token);
      }

      if (!player && name) {
        player = battle.players.find(x => x.name === name) || null;
      }

      if (!player) {
        socket.emit('authError', { error: 'auth failed' });
        return callback?.({ ok: false, error: 'auth failed' });
      }

      currentBattle = battleId;
      currentPlayerId = player.id;
      displayName = player.name;
      joinedRole = 'player';
      joinedTeamAB = player.team;

      socket.join(`battle_${battleId}`);

      socket.emit('authSuccess', { ok: true, playerId: player.id, name: player.name, team: player.team });
      socket.emit('auth:success', { ok: true, playerId: player.id, name: player.name, team: player.team });
      callback?.({ ok: true, playerId: player.id, name: player.name, team: player.team });

      // 입장 로그
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: `${player.name} 입장`
      });
      broadcastBattleUpdate(battle);
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  // 관전자 인증
  socket.on('spectatorAuth', ({ battleId, otp, name }, callback) => {
    try {
      const battle = battleEngine.get(battleId);
      if (!battle) {
        return callback?.({ ok: false, error: 'not found' });
      }

      const storedData = passwordStore.get(`spectator_${battleId}`);
      if (!storedData || storedData.otp !== otp || Date.now() > storedData.expiresAt) {
        return callback?.({ ok: false, error: 'invalid otp' });
      }

      currentBattle = battleId;
      displayName = name || '관전자';
      joinedRole = 'spectator';

      socket.join(`battle_${battleId}`);

      callback?.({ ok: true });

      // 입장 로그
      battle.logs.push({
        ts: Date.now(),
        type: 'system',
        message: `${displayName} 관전 입장`
      });
      broadcastBattleUpdate(battle);
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  // 플레이어 준비 완료
  socket.on('player:ready', ({ battleId, playerId }, callback) => {
    socket.emit('playerReady', { battleId, playerId, ready: true }, callback);
  });

  socket.on('playerReady', ({ battleId, playerId, ready = true }, callback) => {
    try {
      const result = battleEngine.markReady(battleId, playerId, ready);
      if (!result) {
        return callback?.({ ok: false, error: '준비 상태 변경 실패' });
      }
      
      const battle = battleEngine.get(battleId);
      const player = battle?.players.find(p => p.id === playerId);
      
      if (battle && player) {
        battle.logs.push({
          ts: Date.now(),
          type: 'system',
          message: `${player.name} 준비완료`
        });
        broadcastBattleUpdate(battle);
      }
      
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  // 플레이어 행동
  socket.on('player:action', ({ battleId, playerId, action }, callback) => {
    socket.emit('playerAction', { battleId, playerId, action }, callback);
  });

  socket.on('playerAction', ({ battleId, playerId, action }, callback) => {
    try {
      const result = battleEngine.playerAction(battleId, playerId, action);
      if (!result) {
        return callback?.({ ok: false, error: '행동 처리 실패' });
      }
      
      broadcastBattleUpdate(result.b);
      
      socket.emit('actionSuccess', { ok: true, result: result.result });
      socket.emit('player:action:success', { ok: true, result: result.result });
      callback?.({ ok: true, result: result.result });
    } catch (error) {
      socket.emit('actionError', { error: error.message });
      callback?.({ ok: false, error: error.message });
    }
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message?.trim()) return;
    
    const chat = {
      ts: Date.now(),
      name: name || displayName || '익명',
      message: message.trim()
    };
    
    broadcastChat(battleId, chat);
  });

  // 관전자 응원
  socket.on('spectator:cheer', ({ battleId, message }) => {
    if (!battleId || !message?.trim() || joinedRole !== 'spectator') return;
    
    const chat = {
      ts: Date.now(),
      name: displayName || '관전자',
      message: message.trim(),
      type: 'cheer'
    };
    
    broadcastChat(battleId, chat);
  });

  // 연결 해제
  socket.on('disconnect', () => {
    console.log(`[SOCKET] 클라이언트 연결 해제: ${socket.id}`);
    
    if (currentBattle && displayName) {
      const battle = battleEngine.get(currentBattle);
      if (battle) {
        battle.logs.push({
          ts: Date.now(),
          type: 'system',
          message: `${displayName} 퇴장`
        });
        broadcastBattleUpdate(battle);
      }
    }
  });
});

/* ─────────────────────────── 서버 시작 ─────────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════╗
║           PYXIS Battle System          ║
║        서버가 시작되었습니다           ║
╠════════════════════════════════════════╣
║ 주소: http://${HOST}:${PORT}${HOST === '0.0.0.0' ? ' (모든 인터페이스)' : ''}
║ 환경: ${process.env.NODE_ENV || 'development'}
║ CORS: ${CORS_ORIGIN.join(', ')}
╚════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[서버] SIGTERM 신호를 받았습니다. 서버를 종료합니다...');
  server.close(() => {
    console.log('[서버] HTTP 서버가 종료되었습니다.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[서버] SIGINT 신호를 받았습니다. 서버를 종료합니다...');
  server.close(() => {
    console.log('[서버] HTTP 서버가 종료되었습니다.');
    process.exit(0);
  });
});

// 처리되지 않은 예외 처리
process.on('uncaughtException', (err) => {
  console.error('[서버] 처리되지 않은 예외:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[서버] 처리되지 않은 Promise 거부:', reason);
  console.error('Promise:', promise);
  process.exit(1);
});
