// packages/battle-server/index.js
// ESM 모드("type": "module") 가정
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

// 업로드 라우터는 default export(중요)
import uploadRouter from './src/routes/avatar-upload.js';

// 절대 import 하지 말 것(실행 크래시 원인)
// import { makeSocketHandlers } from './src/socket/socketHandlers.js';
// import { registerAvatarRoute } from './src/routes/avatar-upload.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,                 // 클라이언트: /socket.io/socket.io.js
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
});

// 프록시 환경(HTTPS 링크, 원본 IP) 대응
app.set('trust proxy', true);

// 미들웨어
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 경로
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// 업로드 디렉터리 및 정적 제공
const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
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
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, service: 'PYXIS', uptime: process.uptime(), ts: Date.now() })
);

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

  const base = `${req.protocol}://${req.get('host')}`;
  const spectatorOtp = `spectator-${id}`;
  const playerLinks = [1, 2, 3, 4].map(i => ({
    url: `${base}/player?battle=${id}&token=player-${i}-${id}`,
  }));
  res.json({ spectatorOtp, playerLinks });
});

// 업로드 라우터
app.use('/api/upload', uploadRouter);

// 페이지 라우팅(루트 파일 기준: public/admin.html 등)
app.get('/admin',   (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/player',  (_req, res) => res.sendFile(path.join(publicDir, 'player.html')));
app.get(['/spectator','/watch'], (_req, res) =>
  res.sendFile(path.join(publicDir, 'spectator.html'))
);

// Socket.IO
io.on('connection', (socket) => {
  // 방 참가
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

  // 전투 생성
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

  // 진행 상태 전환
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
        attack:  Number(player.stats?.attack  ?? 3),
        defense: Number(player.stats?.defense ?? 3),
        agility: Number(player.stats?.agility ?? 3),
        luck:    Number(player.stats?.luck    ?? 2),
      },
      items: {
        dittany:       Number(player.items?.dittany       ?? 0),
        attack_boost:  Number(player.items?.attack_boost  ?? 0),
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

// 서버 시작
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PYXIS] battle-server listening on :${PORT}`);
});
