// packages/battle-server/index.js - 완전 정리 버전 (ESM 모드)
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

// 업로드 라우터
import uploadRouter from './src/routes/avatar-upload.js';

// 전투 엔진 import
import BattleEngine from './src/engine/BattleEngine.js';

// 소켓 핸들러
import { makeSocketHandlers } from './src/socket/socketHandlers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';
const HOST = process.env.HOST || '0.0.0.0';

console.log(`[PYXIS] 서버 초기화 중... 포트: ${PORT}`);

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { 
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true 
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ========================================
// 전역 상태
// ========================================
const battles = new Map();
const otpStore = new Map();

// ========================================
// 미들웨어 및 정적 자원
// ========================================
app.set('trust proxy', true);
app.use(cors({ 
  origin: process.env.CORS_ORIGIN?.split(',') || true,
  credentials: true 
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ========================================
// 유틸리티 함수들
// ========================================
function generateId() {
  return 'battle_' + Math.random().toString(36).slice(2, 10);
}

function generateOTP(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function validateStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const { attack, defense, agility, luck } = stats;
  return [attack, defense, agility, luck].every(s => Number.isInteger(s) && s >= 1 && s <= 5);
}

function createBattleState(id, mode = '2v2') {
  return {
    id,
    mode,
    status: 'waiting',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    players: [],
    currentTurn: 0,
    currentPlayer: null,
    leadingTeam: null, // A 또는 B
    effects: [],
    logs: [],
    options: {
      timeLimit: 3600000, // 1시간
      turnTimeout: 300000, // 5분
      maxPlayers: parseInt(mode.charAt(0)) * 2,
    }
  };
}

function emitBattleUpdate(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  io.to(battleId).emit('battleUpdate', battle);
  io.to(battleId).emit('battle:update', battle);
}

function logBattleAction(battleId, type, message, data = {}) {
  const battle = battles.get(battleId);
  if (!battle) return;
  const logEntry = { timestamp: Date.now(), type, message, data };
  battle.logs.push(logEntry);
  if (battle.logs.length > 1000) {
    battle.logs = battle.logs.slice(-500);
  }
  io.to(battleId).emit('battle:log', logEntry);
  emitBattleUpdate(battleId);
}

// ========================================
// API 엔드포인트
// ========================================

// 상태 확인
app.get('/api/health', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'PYXIS Battle System', 
    uptime: Math.floor(process.uptime()),
    battles: battles.size,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
    },
    timestamp: Date.now() 
  });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '2v2', options = {} } = req.body;
    if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ error: 'invalid_mode', message: '지원되지 않는 전투 모드입니다' });
    }
    const battleId = generateId();
    const adminOtp = generateOTP(8);
    const battle = createBattleState(battleId, mode);
    battle.options = { ...battle.options, ...options };
    battles.set(battleId, battle);
    otpStore.set(`admin_${battleId}`, {
      otp: adminOtp, battleId, role: 'admin',
      expires: Date.now() + 30 * 60 * 1000
    });
    res.json({
      ok: true,
      battleId,
      adminOtp,
      mode,
      urls: {
        admin: `/admin?battle=${battleId}&otp=${adminOtp}`,
        player: `/player?battle=${battleId}`,
        spectator: `/watch?battle=${battleId}`
      }
    });
  } catch (error) {
    console.error('[PYXIS] 전투 생성 실패:', error);
    res.status(500).json({ error: 'creation_failed', message: '전투 생성 중 오류가 발생했습니다' });
  }
});

// 전투 상태 조회
app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'not_found', message: '전투를 찾을 수 없습니다' });
  res.json(battle);
});

// 관리자 링크 생성
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ error: 'not_found', message: '전투를 찾을 수 없습니다' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp, battleId, role: 'spectator',
      expires: Date.now() + 30 * 60 * 1000
    });
    const maxPlayers = battle.options.maxPlayers || 4;
    const playerLinks = [];
    for (let i = 1; i <= maxPlayers; i++) {
      const playerOtp = generateOTP(6);
      const linkId = `player_${battleId}_${i}`;
      otpStore.set(linkId, {
        otp: playerOtp, battleId, role: 'player', playerId: i,
        expires: Date.now() + 2 * 60 * 60 * 1000
      });
      playerLinks.push({ id: i, otp: playerOtp, url: `${baseUrl}/player?battle=${battleId}&token=${playerOtp}` });
    }
    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${baseUrl}/watch?battle=${battleId}&token=${spectatorOtp}`,
      playerLinks
    });
  } catch (error) {
    console.error('[PYXIS] 링크 생성 실패:', error);
    res.status(500).json({ error: 'link_creation_failed', message: '링크 생성 중 오류가 발생했습니다' });
  }
});

// 업로드 라우터
app.use('/api/upload', uploadRouter);

// ========================================
// HTML 라우팅
// ========================================
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(publicDir, 'player.html')));
app.get(['/spectator', '/watch'], (req, res) => res.sendFile(path.join(publicDir, 'spectator.html')));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ========================================
// Socket.IO 이벤트 처리
// ========================================
io.on('connection', (socket) => {
  console.log(`[PYXIS] 클라이언트 연결: ${socket.id}`);

  // 방 참가
  socket.on('join', ({ battleId, token }) => {
    if (!battleId) return socket.emit('error', { message: '전투 ID가 필요합니다' });
    const battle = battles.get(battleId);
    if (!battle) return socket.emit('error', { message: '전투를 찾을 수 없습니다' });
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit('battleUpdate', battle);
    socket.emit('battle:update', battle);
    logBattleAction(battleId, 'system', `클라이언트 연결됨 (${socket.id})`);
  });

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }, ack) => {
    const stored = otpStore.get(`admin_${battleId}`);
    if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
      const error = { error: 'invalid_otp', message: '잘못된 관리자 비밀번호입니다' };
      if (typeof ack === 'function') ack(error);
      socket.emit('authError', error);
      return;
    }
    socket.role = 'admin';
    socket.battleId = battleId;
    const success = { ok: true, role: 'admin', battleId };
    if (typeof ack === 'function') ack(success);
    socket.emit('auth:success', success);
    logBattleAction(battleId, 'system', '관리자 인증 성공');
  });

  // 전투 생성 (소켓)
  socket.on('createBattle', (payload, ack) => {
    try {
      const { mode = '2v2' } = payload || {};
      if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
        const error = { error: 'invalid_mode', message: '지원되지 않는 전투 모드' };
        if (typeof ack === 'function') ack(error);
        return;
      }
      const battleId = generateId();
      const adminOtp = generateOTP(8);
      const battle = createBattleState(battleId, mode);
      battles.set(battleId, battle);
      otpStore.set(`admin_${battleId}`, {
        otp: adminOtp, battleId, role: 'admin',
        expires: Date.now() + 30 * 60 * 1000
      });
      socket.join(battleId);
      socket.battleId = battleId;
      socket.role = 'admin';
      const result = { ok: true, battle, battleId, adminOtp };
      if (typeof ack === 'function') ack(result);
      socket.emit('battle:created', result);
      logBattleAction(battleId, 'system', `전투 생성됨 (${mode})`);
    } catch (error) {
      console.error('[PYXIS] 전투 생성 오류:', error);
      const errorResponse = { error: 'creation_failed', message: '전투 생성 실패' };
      if (typeof ack === 'function') ack(errorResponse);
    }
  });

  // 플레이어 추가
  socket.on('addPlayer', ({ battleId, player }, ack) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) {
        const error = { error: 'not_found', message: '전투를 찾을 수 없습니다' };
        if (typeof ack === 'function') ack(error);
        return;
      }
      if (!player || !player.name || !player.name.trim()) {
        const error = { error: 'name_required', message: '플레이어 이름이 필요합니다' };
        if (typeof ack === 'function') ack(error);
        return;
      }
      const nameExists = battle.players.some(p => p.name.trim().toLowerCase() === player.name.trim().toLowerCase());
      if (nameExists) {
        const error = { error: 'name_duplicate', message: '이미 사용 중인 이름입니다' };
        if (typeof ack === 'function') ack(error);
        return;
      }
      if (battle.players.length >= battle.options.maxPlayers) {
        const error = { error: 'battle_full', message: '전투가 가득 찼습니다' };
        if (typeof ack === 'function') ack(error);
        return;
      }
      if (!validateStats(player.stats)) {
        const error = { error: 'invalid_stats', message: '스탯은 각각 1-5 범위여야 합니다' };
        if (typeof ack === 'function') ack(error);
        return;
      }
      const newPlayer = {
        id: `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: player.name.trim(),
        team: player.team === 'B' ? 'B' : 'A', // A팀 / B팀
        hp: 100,
        maxHp: 100,
        stats: {
          attack: Number(player.stats.attack),
          defense: Number(player.stats.defense),
          agility: Number(player.stats.agility),
          luck: Number(player.stats.luck)
        },
        items: {
          dittany: Math.max(0, Math.min(5, Number(player.items?.dittany) || 0)),
          attack_boost: Math.max(0, Math.min(5, Number(player.items?.attack_boost) || 0)),
          defense_boost: Math.max(0, Math.min(5, Number(player.items?.defense_boost) || 0))
        },
        avatar: String(player.avatar || ''),
        status: 'ready',
        lastAction: null,
        joinedAt: Date.now()
      };
      battle.players.push(newPlayer);
      const success = { ok: true, battle, player: newPlayer };
      if (typeof ack === 'function') ack(success);
      emitBattleUpdate(battleId);
      logBattleAction(battleId, 'system', `${newPlayer.name} 참가 (${newPlayer.team}팀)`);
    } catch (error) {
      console.error('[PYXIS] 플레이어 추가 오류:', error);
      const errorResponse = { error: 'add_player_failed', message: '플레이어 추가 실패' };
      if (typeof ack === 'function') ack(errorResponse);
    }
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId }) => {
    const battle = battles.get(battleId);
    if (!battle) return;
    if (battle.players.length < 2) {
      socket.emit('error', { message: '최소 2명의 플레이어가 필요합니다' });
      return;
    }
    const teamAAgility = battle.players.filter(p => p.team === 'A').reduce((sum, p) => sum + p.stats.agility, 0);
    const teamBAgility = battle.players.filter(p => p.team === 'B').reduce((sum, p) => sum + p.stats.agility, 0);
    battle.leadingTeam = teamAAgility >= teamBAgility ? 'A' : 'B';
    battle.status = 'active';
    battle.startedAt = Date.now();
    battle.currentTurn = 1;
    const engine = new BattleEngine(battle);
    emitBattleUpdate(battleId);
    logBattleAction(battleId, 'system',
      `전투 시작! 선공: ${battle.leadingTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'} (민첩성 - A팀: ${teamAAgility}, B팀: ${teamBAgility})`
    );
  });

  // 전투 일시정지/재개/종료
  socket.on('pauseBattle', ({ battleId }) => {
    const battle = battles.get(battleId);
    if (battle && battle.status === 'active') {
      battle.status = 'paused';
      emitBattleUpdate(battleId);
      logBattleAction(battleId, 'system', '전투 일시정지');
    }
  });

  socket.on('resumeBattle', ({ battleId }) => {
    const battle = battles.get(battleId);
    if (battle && battle.status === 'paused') {
      battle.status = 'active';
      emitBattleUpdate(battleId);
      logBattleAction(battleId, 'system', '전투 재개');
    }
  });

  socket.on('endBattle', ({ battleId }) => {
    const battle = battles.get(battleId);
    if (battle) {
      battle.status = 'ended';
      battle.endedAt = Date.now();
      emitBattleUpdate(battleId);
      logBattleAction(battleId, 'system', '전투 종료');
    }
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, message, name, role }) => {
    if (!battleId || !message || !message.trim()) return;
    const chatData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name || '익명',
      message: message.trim(),
      role: role || 'player',
      timestamp: Date.now()
    };
    io.to(battleId).emit('chatMessage', chatData);
    io.to(battleId).emit('battle:chat', chatData);
    logBattleAction(battleId, 'chat', `[${chatData.name}] ${chatData.message}`, chatData);
  });

  // 연결 해제
  socket.on('disconnect', (reason) => {
    console.log(`[PYXIS] 클라이언트 연결 해제: ${socket.id} (${reason})`);
    if (socket.battleId) {
      logBattleAction(socket.battleId, 'system', `클라이언트 연결 해제됨 (${socket.id})`);
    }
  });
});

// ========================================
// 전투 종료 체크
// ========================================
function checkBattleEnd(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'active') return;
  const teamA = battle.players.filter(p => p.team === 'A' && p.hp > 0);
  const teamB = battle.players.filter(p => p.team === 'B' && p.hp > 0);
  let winner = null;
  let reason = '';
  if (teamA.length === 0 && teamB.length > 0) {
    winner = 'B'; reason = 'A팀 전멸';
  } else if (teamB.length === 0 && teamA.length > 0) {
    winner = 'A'; reason = 'B팀 전멸';
  } else if (teamA.length === 0 && teamB.length === 0) {
    winner = 'draw'; reason = '양팀 전멸';
  }
  const now = Date.now();
  if (battle.startedAt && (now - battle.startedAt) >= battle.options.timeLimit) {
    const teamAHp = teamA.reduce((sum, p) => sum + p.hp, 0);
    const teamBHp = teamB.reduce((sum, p) => sum + p.hp, 0);
    if (teamAHp > teamBHp) { winner = 'A'; reason = '시간 종료 - A팀 체력 우세'; }
    else if (teamBHp > teamAHp) { winner = 'B'; reason = '시간 종료 - B팀 체력 우세'; }
    else { winner = 'draw'; reason = '시간 종료 - 무승부'; }
  }
  if (battle.currentTurn >= 100) {
    const teamAHp = teamA.reduce((sum, p) => sum + p.hp, 0);
    const teamBHp = teamB.reduce((sum, p) => sum + p.hp, 0);
    if (teamAHp > teamBHp) { winner = 'A'; reason = '최대 턴 도달 - A팀 체력 우세'; }
    else if (teamBHp > teamAHp) { winner = 'B'; reason = '최대 턴 도달 - B팀 체력 우세'; }
    else { winner = 'draw'; reason = '최대 턴 도달 - 무승부'; }
  }
  if (winner) {
    battle.status = 'ended';
    battle.endedAt = now;
    battle.winner = winner;
    battle.endReason = reason;
    emitBattleUpdate(battleId);
    logBattleAction(battleId, 'system', `전투 종료! ${reason}`);
    io.to(battleId).emit('battle:ended', { winner, reason, battle });
  }
}

// ========================================
// 서버 시작
// ========================================
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of otpStore.entries()) {
    if (data.expires < now) otpStore.delete(key);
  }
}, 5 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] 배틀 시스템 서버 시작됨`);
  console.log(`- 주소: http://${HOST}:${PORT}`);
  console.log(`- 관리자: http://${HOST}:${PORT}/admin`);
  console.log(`- 플레이어: http://${HOST}:${PORT}/player`);
  console.log(`- 관전자: http://${HOST}:${PORT}/watch`);
  console.log(`- Socket.IO 경로: ${SOCKET_PATH}`);
  console.log(`- 환경: ${process.env.NODE_ENV || 'development'}`);
});

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
