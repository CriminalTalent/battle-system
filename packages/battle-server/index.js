// packages/battle-server/index.js
// ESM 모드 가정("type": "module")
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

import uploadRouter from './src/routes/avatar-upload.js';
// 주의: socketHandlers에서 makeSocketHandlers를 export하지 않으므로 import 제거
// import { makeSocketHandlers } from './src/socket/socketHandlers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
});

// 미들웨어
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 업로드/정적
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// 인메모리 상태
const battles = new Map();

function newBattleId() {
  return 'battle_' + Math.random().toString(36).slice(2, 10);
}
function emptyBattle(mode = '4v4') {
  return {
    id: newBattleId(),
    mode,
    status: 'waiting',
    createdAt: Date.now(),
    players: [],
    logs: [],
  };
}
function emitUpdate(b) {
  io.emit('battleUpdate', b);
  io.emit('battle:update', b);
}

// API
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.post('/api/battles', (req, res) => {
  const payload = req.body?.battle || req.body || {};
  const mode = String(payload.mode || '4v4');
  const battle = emptyBattle(mode);
  battles.set(battle.id, battle);
  emitUpdate(battle);
  res.json(battle);
});

app.get('/api/battles/:id', (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not_found' });
  res.json(b);
});

app.post('/api/admin/battles/:id/links', (req, res) => {
  const id = req.params.id;
  const b = battles.get(id);
  if (!b) return res.status(404).json({ error: 'not_found' });

  const spectatorOtp = `spectator-${id}`;
  const base = `${req.protocol}://${req.get('host')}`;

  const playerLinks = [1, 2, 3, 4].map(i => ({
    url: `${base}/player?battle=${id}&token=player-${i}-${id}`,
  }));

  res.json({ spectatorOtp, playerLinks });
});

// 업로드 라우터 마운트
app.use('/api/upload', uploadRouter);

// 페이지
app.get(['/admin', '/player', '/spectator', '/watch'], (req, res) => {
  const p = req.path.replace(/^\//, '');
  const file =
    p === 'player' ? 'player.html'
    : p === 'spectator' || p === 'watch' ? 'spectator.html'
    : 'admin.html';
  res.sendFile(path.join(publicDir, file));
});

// Socket.IO
io.on('connection', (socket) => {
  // join
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const snap = battles.get(battleId);
    if (snap) {
      socket.emit('battleUpdate', snap);
      socket.emit('battle:update', snap);
    }
  });

  // 선택적 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }, ack) => {
    if (!battleId || !String(otp || '').length) {
      return typeof ack === 'function' && ack({ error: 'invalid_otp' });
    }
    typeof ack === 'function' && ack({ ok: true });
  });

  // 전투 생성(호환 이벤트)
  const handleCreate = (payload, ack) => {
    const mode = String(payload?.mode || '4v4');
    const battle = emptyBattle(mode);
    battles.set(battle.id, battle);
    socket.join(battle.id);
    emitUpdate(battle);
    socket.emit('battle:created', battle);
    typeof ack === 'function' && ack(battle);
  };
  socket.on('createBattle', handleCreate);
  socket.on('battle:create', handleCreate);
  socket.on('admin:createBattle', handleCreate);
  socket.on('create:battle', handleCreate);

  // 진행 제어
  const setStatus = (battleId, st) => {
    const b = battles.get(battleId); if (!b) return;
    b.status = st; emitUpdate(b);
  };
  socket.on('startBattle',  ({ battleId }) => setStatus(battleId, 'active'));
  socket.on('battle:start', ({ battleId }) => setStatus(battleId, 'active'));
  socket.on('pauseBattle',  ({ battleId }) => setStatus(battleId, 'paused'));
  socket.on('resumeBattle', ({ battleId }) => setStatus(battleId, 'active'));
  socket.on('endBattle',    ({ battleId }) => setStatus(battleId, 'ended'));

  // 참가자 추가
  const handleAddPlayer = ({ battleId, player }, ack) => {
    const b = battles.get(battleId);
    if (!b) return typeof ack === 'function' && ack({ error: 'not_found' });
    if (!player?.name) return typeof ack === 'function' && ack({ error: 'name_required' });
    const exists = b.players.some(p => (p.name || '').trim() === player.name.trim());
    if (exists) return typeof ack === 'function' && ack({ error: 'name_duplicated' });

    const p = {
      name: String(player.name),
      team: String(player.team || 'phoenix'),
      hp: Number(player.hp ?? 100),
      maxHp: Number(player.maxHp ?? 100),
      stats: {
        attack: Number(player.stats?.attack ?? 3),
        defense: Number(player.stats?.defense ?? 3),
        agility: Number(player.stats?.agility ?? 3),
        luck: Number(player.stats?.luck ?? 2),
      },
      items: {
        dittany: Number(player.items?.dittany ?? 0),
        attack_boost: Number(player.items?.attack_boost ?? 0),
        defense_boost: Number(player.items?.defense_boost ?? 0),
      },
      avatar: String(player.avatar || ''),
    };
    b.players.push(p);
    emitUpdate(b);
    typeof ack === 'function' && ack({ ok: true, battle: b });
  };
  socket.on('addPlayer', handleAddPlayer);
  socket.on('admin:addPlayer', handleAddPlayer);

  // 채팅
  const handleChat = ({ battleId, message, name, role }) => {
    if (!battleId || !message) return;
    io.to(battleId).emit('chatMessage', { name: name || '플레이어', message, role: role || 'unknown' });
    io.to(battleId).emit('battle:chat', { name: name || '플레이어', message, role: role || 'unknown' });
  };
  socket.on('chatMessage', handleChat);
  socket.on('chat:send', handleChat);
});

// 시작
server.listen(PORT, () => {
  console.log(`[PYXIS] battle-server listening on :${PORT}`);
});
