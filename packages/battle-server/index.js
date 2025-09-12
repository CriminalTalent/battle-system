// packages/battle-server/index.js - PYXIS Battle Server (ESM)
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

import uploadRouter from './src/routes/avatar-upload.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// -----------------------------
// In-memory state
// -----------------------------
const battles = new Map();
const otpStore = new Map();

// -----------------------------
// Helpers
// -----------------------------
function generateId() {
  return 'battle_' + Math.random().toString(36).slice(2, 10);
}
function generateOTP(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let r = '';
  for (let i = 0; i < length; i++) r += chars[(Math.random() * chars.length) | 0];
  return r;
}
function validateStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const { attack, defense, agility, luck } = stats;
  return [attack, defense, agility, luck].every(n => Number.isInteger(n) && n >= 1 && n <= 5);
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
    leadingTeam: null, // 'A' | 'B'
    effects: [],
    logs: [],
    options: {
      timeLimit: 60 * 60 * 1000, // 1h
      turnTimeout: 5 * 60 * 1000, // 5m
      maxPlayers: parseInt(mode, 10) ? parseInt(mode, 10) * 2 : parseInt(mode[0], 10) * 2,
    },
  };
}
function emitBattleUpdate(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  io.to(battleId).emit('battleUpdate', battle);
  io.to(battleId).emit('battle:update', battle);
}
function pushLog(battleId, type, message, data = {}) {
  const b = battles.get(battleId);
  if (!b) return;
  const entry = { timestamp: Date.now(), type, message, data };
  b.logs.push(entry);
  if (b.logs.length > 1000) b.logs = b.logs.slice(-500);
  io.to(battleId).emit('battle:log', entry);
}

// -----------------------------
// Middleware & static
// -----------------------------
app.set('trust proxy', true);
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// uploads
app.use('/api/upload', uploadRouter);

// -----------------------------
// API
// -----------------------------
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'PYXIS Battle System',
    uptime: Math.floor(process.uptime()),
    battles: battles.size,
    timestamp: Date.now(),
  }),
);

app.post('/api/battles', (req, res) => {
  try {
    const { mode = '2v2', options = {} } = req.body || {};
    if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'invalid_mode' });
    }
    const battleId = generateId();
    const adminOtp = generateOTP(8);
    const battle = createBattleState(battleId, mode);
    battle.options = { ...battle.options, ...options };
    battles.set(battleId, battle);
    otpStore.set(`admin_${battleId}`, { otp: adminOtp, battleId, role: 'admin', expires: Date.now() + 30 * 60 * 1000 });
    res.json({
      ok: true,
      battleId,
      adminOtp,
      battle,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'creation_failed' });
  }
});

app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      battleId,
      role: 'spectator',
      expires: Date.now() + 30 * 60 * 1000,
    });

    const links = [];
    const max = battle.options.maxPlayers || 2;
    for (let i = 1; i <= max; i++) {
      const tok = generateOTP(6);
      otpStore.set(`player_${battleId}_${i}`, {
        otp: tok,
        battleId,
        role: 'player',
        playerId: i,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      links.push({ id: i, url: `${base}/player?battle=${battleId}&token=${tok}` });
    }

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/watch?battle=${battleId}&token=${spectatorOtp}`,
      playerLinks: links,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// -----------------------------
// HTML routes
// -----------------------------
app.get('/admin', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(publicDir, 'player.html')));
app.get(['/spectator', '/watch'], (_req, res) => res.sendFile(path.join(publicDir, 'spectator.html')));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// -----------------------------
// Socket.IO
// -----------------------------
io.on('connection', (socket) => {
  // join
  socket.on('join', ({ battleId }) => {
    const battle = battleId && battles.get(battleId);
    if (!battle) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit('battleUpdate', battle);
    socket.emit('battle:update', battle);
    pushLog(battleId, 'system', `클라이언트 접속: ${socket.id}`);
  });

  // ---- battle:create variants (모두 지원) ----
  const handleCreate = (payload, ack) => {
    try {
      const mode = (payload && payload.mode) || '2v2';
      if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
        const err = { ok: false, error: 'invalid_mode' };
        if (typeof ack === 'function') ack(err);
        return;
      }
      const battleId = generateId();
      const adminOtp = generateOTP(8);
      const battle = createBattleState(battleId, mode);
      battles.set(battleId, battle);

      otpStore.set(`admin_${battleId}`, { otp: adminOtp, battleId, role: 'admin', expires: Date.now() + 30 * 60 * 1000 });

      socket.join(battleId);
      socket.battleId = battleId;

      const result = { ok: true, battleId, adminOtp, battle };

      // 1) ack (페이지는 이걸로 state 세팅)
      if (typeof ack === 'function') ack(result);

      // 2) 이벤트는 "battle 객체" 그대로도 쏴줌(구 UI 호환)
      socket.emit('battle:created', battle);

      // 즉시 스냅샷도
      socket.emit('battleUpdate', battle);
      socket.emit('battle:update', battle);

      pushLog(battleId, 'system', `전투 생성 (${mode})`);
    } catch (e) {
      const err = { ok: false, error: 'creation_failed' };
      if (typeof ack === 'function') ack(err);
    }
  };

  socket.on('createBattle', handleCreate);
  socket.on('battle:create', handleCreate);
  socket.on('admin:createBattle', handleCreate);

  // add player
  socket.on('addPlayer', ({ battleId, player }, ack) => {
    const battle = battleId && battles.get(battleId);
    if (!battle) {
      const err = { ok: false, error: 'not_found' };
      if (typeof ack === 'function') ack(err);
      return;
    }
    if (!player?.name?.trim()) {
      const err = { ok: false, error: 'name_required' };
      if (typeof ack === 'function') ack(err);
      return;
    }
    if (!validateStats(player.stats || {})) {
      const err = { ok: false, error: 'invalid_stats' };
      if (typeof ack === 'function') ack(err);
      return;
    }
    if (battle.players.length >= (battle.options.maxPlayers || 2)) {
      const err = { ok: false, error: 'battle_full' };
      if (typeof ack === 'function') ack(err);
      return;
    }

    const np = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(player.name).trim(),
      team: player.team === 'B' ? 'B' : 'A',
      hp: 100,
      maxHp: 100,
      stats: {
        attack: +player.stats.attack || 1,
        defense: +player.stats.defense || 1,
        agility: +player.stats.agility || 1,
        luck: +player.stats.luck || 1,
      },
      items: {
        dittany: Math.max(0, Math.min(99, +player.items?.dittany || 0)),
        attack_boost: Math.max(0, Math.min(99, +player.items?.attack_boost || 0)),
        defense_boost: Math.max(0, Math.min(99, +player.items?.defense_boost || 0)),
      },
      avatar: String(player.avatar || ''),
      status: 'ready',
      joinedAt: Date.now(),
    };
    // 이름 중복 방지(대소문자 무시)
    const dup = battle.players.some(p => p.name.trim().toLowerCase() === np.name.toLowerCase());
    if (dup) {
      const err = { ok: false, error: 'name_duplicate' };
      if (typeof ack === 'function') ack(err);
      return;
    }

    battle.players.push(np);
    if (typeof ack === 'function') ack({ ok: true, battle, player: np });
    emitBattleUpdate(battleId);
    pushLog(battleId, 'system', `${np.name} 참가 (${np.team}팀)`);
  });

  // simple controls
  socket.on('startBattle', ({ battleId }) => {
    const b = battleId && battles.get(battleId);
    if (!b) return;
    if (b.players.length < 2) return;
    const aAgi = b.players.filter(p => p.team === 'A').reduce((s, p) => s + (p.stats.agility || 0), 0);
    const bAgi = b.players.filter(p => p.team === 'B').reduce((s, p) => s + (p.stats.agility || 0), 0);
    b.leadingTeam = aAgi >= bAgi ? 'A' : 'B';
    b.status = 'active';
    b.startedAt = Date.now();
    b.currentTurn = 1;
    emitBattleUpdate(battleId);
    pushLog(battleId, 'system', `전투 시작! 선공: ${b.leadingTeam}`);
    io.to(battleId).emit('battle:started', { battleId, leadingTeam: b.leadingTeam });
  });

  socket.on('pauseBattle', ({ battleId }) => {
    const b = battles.get(battleId);
    if (b && b.status === 'active') {
      b.status = 'paused';
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', '전투 일시정지');
    }
  });

  socket.on('resumeBattle', ({ battleId }) => {
    const b = battles.get(battleId);
    if (b && b.status === 'paused') {
      b.status = 'active';
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', '전투 재개');
    }
  });

  socket.on('endBattle', ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) {
      b.status = 'ended';
      b.endedAt = Date.now();
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', '전투 종료');
      io.to(battleId).emit('battle:ended', { battleId, winner: null });
    }
  });

  // chat
  socket.on('chatMessage', ({ battleId, message, name, role }) => {
    if (!battleId || !message?.trim()) return;
    const data = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name || '익명',
      message: message.trim(),
      role: role || 'player',
      timestamp: Date.now(),
    };
    io.to(battleId).emit('chatMessage', data);
    io.to(battleId).emit('battle:chat', data);
    pushLog(battleId, 'chat', `[${data.name}] ${data.message}`, data);
  });

  socket.on('disconnect', () => {
    const bid = socket.battleId;
    if (bid) pushLog(bid, 'system', `클라이언트 종료: ${socket.id}`);
  });
});

// -----------------------------
// Cleanup & start
// -----------------------------
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) if (v.expires && v.expires < now) otpStore.delete(k);
}, 5 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`[INFO] started :${PORT}`);
  console.log(`- http://${HOST}:${PORT}/admin`);
});
