// PYXIS Battle Server - Entry (ESM, Turn Timer, CORS/.env/Proxy)
// Node.js >= 18

import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// 전투 엔진
import { resolveAction } from './engine/combat.js';
import { nextTurn, isBattleOver, winnerByHpSum } from './engine/turns.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// CORS 허용 도메인
const ALLOW_ORIGINS = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Express CORS
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));

// JSON / 정적
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 업로드(이미지) - public 아래 저장
const upload = multer({ dest: path.join(__dirname, 'public/uploads/avatars') });

// ─────────────────────────────────────────────
// 인메모리 저장소
// ─────────────────────────────────────────────
const BATTLES = new Map(); // id -> battle

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function now() { return Date.now(); }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// ─────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────

// 전투 생성
app.post('/api/battles', (req, res) => {
  const { mode = '2v2' } = req.body || {};
  const id = newId('b');
  const adminToken = newId('admin');
  const spectatorOtp = newId('spec'); // OTP 매니저는 다음 배치에서 분리 예정

  const battle = {
    id,
    mode,
    adminToken,
    spectatorOtp,
    status: 'waiting',       // waiting | active | paused | ended
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    turnEndsAt: null,        // 턴 마감 시간 (자동 넘김)
    turn: 0,
    turnMs: 5 * 60 * 1000,   // 5분
    current: null,           // 현재 턴 주체 playerId/teamKey
    firstTeam: null,
    firstTeamKey: null,
    players: [],             // { id, name, team, stats, hp, ready, avatarUrl }
    log: [],                 // { type, message, ts }
    effects: []              // 글로벌/개별 효과 (defenseBoost, dodgePrep 등)
  };

  BATTLES.set(id, battle);
  res.json({
    ok: true,
    id,
    adminUrl: `${process.env.PUBLIC_BASE_URL || ''}/pages/admin.html?battle=${id}&token=${adminToken}`,
    playerBase: `${process.env.PUBLIC_BASE_URL || ''}/pages/player.html?battle=${id}`,
    spectatorBase: `${process.env.PUBLIC_BASE_URL || ''}/pages/spectator.html?battle=${id}&otp=${spectatorOtp}`,
  });
});

// 관리자 시작(강제)
app.post('/api/battles/:id/start', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  if (b.status === 'active') return res.json({ ok: true });
  startBattle(b);
  res.json({ ok: true });
});

// 아바타 업로드 (배틀ID 폴더 미사용 → URL도 일치하게 수정)
app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const url = `/uploads/avatars/${req.file.filename}`;   // ← 저장경로와 동일 구조로 수정
  res.json({ ok: true, url });
});

// ─────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', credentials: true }
});

io.on('connection', (socket) => {
  // 관리자 인증
  socket.on('adminAuth', ({ battleId, token }) => {
    const b = BATTLES.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit('authError', { error: 'unauthorized' });
      return;
    }
    socket.join(`admin:${battleId}`);
    socket.emit('auth:success', { role: 'admin', battleId });
  });

  // 관전자 인증 (간이)
  socket.on('spectatorAuth', ({ battleId, otp, name }) => {
    const b = BATTLES.get(battleId);
    if (!b || otp !== b.spectatorOtp) {
      socket.emit('authError', { error: 'unauthorized' });
      return;
    }
    socket.join(`spectator:${battleId}`);
    socket.emit('auth:success', { role: 'spectator', battleId });
    io.to(`admin:${battleId}`).emit('spectator:count', { count: io.sockets.adapter.rooms.get(`spectator:${battleId}`)?.size || 1 });
  });

  // 플레이어 인증 (이름 매칭)
  socket.on('playerAuth', ({ battleId, name }) => {
    const b = BATTLES.get(battleId);
    if (!b) {
      socket.emit('authError', { error: 'notfound' });
      return;
    }
    const player = b.players.find(p => (p.name || '').trim() === (name || '').trim());
    if (!player) {
      socket.emit('authError', { error: 'player-notfound' });
      return;
    }
    player.socketId = socket.id;
    socket.join(`player:${battleId}`);
    socket.emit('auth:success', { role: 'player', battleId, playerId: player.id });
  });

  // 플레이어 준비
  socket.on('player:ready', ({ battleId, playerId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return;
    p.ready = true;
    pushLog(b, { type: 'system', message: `${p.name} 준비 완료` });
    if (b.players.length > 0 && b.players.every((x) => x.ready) && b.status !== 'active') {
      startBattle(b);
    }
  });

  // 행동 수행
  socket.on('player:action', ({ battleId, playerId, action }) => {
    const b = BATTLES.get(battleId);
    if (!b || b.status !== 'active') return;

    const result = resolveAction(b, { actorId: playerId, ...action });
    appendEngineResult(b, result);

    if (result.turnEnded) {
      nextTurn(b);
    }
    if (isBattleOver(b)) {
      endBattle(b);
    }
    broadcastState(b);
  });

  // 채팅
  socket.on('chat:send', ({ battleId, name, message }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const msg = String(message || '').slice(0, 500);
    io.to(`admin:${battleId}`).emit('battle:chat', { name, message: msg });
    io.to(`player:${battleId}`).emit('battle:chat', { name, message: msg });
    io.to(`spectator:${battleId}`).emit('battle:chat', { name, message: msg });
  });

  // 응원
  socket.on('cheer:send', ({ battleId, cheer }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    pushLog(b, { type: 'cheer', message: cheer || '' });
    io.to(`admin:${battleId}`).emit('battle:log', { type: 'cheer', message: cheer || '' });
    io.to(`player:${battleId}`).emit('battle:log', { type: 'cheer', message: cheer || '' });
    io.to(`spectator:${battleId}`).emit('battle:log', { type: 'cheer', message: cheer || '' });
  });
});

// ─────────────────────────────────────────────
// 전투 수명주기
// ─────────────────────────────────────────────
function startBattle(battle) {
  if (!battle) return;
  battle.status = 'active';
  battle.startedAt = Date.now();

  // 선공: 팀별 민첩 합
  const sumA = battle.players.filter((p) => p.team === 'phoenix').reduce((s, p) => s + (p.stats?.agi || 0), 0);
  const sumB = battle.players.filter((p) => p.team === 'eaters').reduce((s, p) => s + (p.stats?.agi || 0), 0);
  battle.firstTeamKey = sumA >= sumB ? 'phoenix' : 'eaters';
  battle.current = battle.firstTeamKey;
  battle.turn = 1;
  battle.turnEndsAt = Date.now() + (battle.turnMs || (5 * 60 * 1000));

  pushLog(battle, { type: 'system', message: `전투 시작 (선공: ${battle.firstTeamKey === 'phoenix' ? '불사조' : '죽먹자'})` });
  broadcastState(battle);
}

function endBattle(battle) {
  if (!battle) return;
  battle.status = 'ended';
  battle.endedAt = Date.now();
  const winner = winnerByHpSum(battle);
  pushLog(battle, { type: 'result', message: `전투 종료: ${winner || '무승부'}` });
  broadcastState(battle);
}

function pushLog(battle, entry) {
  battle.log.push({ ...entry, ts: Date.now() });
  // 메모리 보호: 500개 초과 시 앞에서 제거
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
}

function broadcastState(battle) {
  const payload = {
    id: battle.id,
    status: battle.status,
    turn: battle.turn,
    current: battle.current,
    startedAt: battle.startedAt,
    endedAt: battle.endedAt,
    turnEndsAt: battle.turnEndsAt,
    players: battle.players.map(p => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp, ready: !!p.ready, avatarUrl: p.avatarUrl,
      stats: p.stats
    })),
    log: battle.log.slice(-200)
  };
  io.to(`admin:${battle.id}`).emit('battle:update', payload);
  io.to(`player:${battle.id}`).emit('battle:update', payload);
  io.to(`spectator:${battle.id}`).emit('battle:update', payload);
}

// ─────────────────────────────────────────────
// 서버 기동
// ─────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] Server listening on ${HOST}:${PORT}`);
});
