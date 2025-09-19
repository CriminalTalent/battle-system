// packages/battle-server/index.js
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import cors from 'cors';

import { createBattleStore } from './src/engine/BattleEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*', methods: ['GET','POST'] } });

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

// 기본 미들웨어
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// 정적 파일 서빙 (+ html 확장자 자동 매핑)
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// 명시적 라우트 매핑 (브라우저가 /admin, /player, /spectator 로 접근할 때 404 방지)
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// favicon 404 줄이기(파일 없으면 빈 204 응답)
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// 업로드 설정
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.png');
    const name = `av_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage });

// 배틀 엔진
const engine = createBattleStore();

// ===== HTTP API =====

// 아바타 업로드(JSON)
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '파일 없음' });
  return res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

// 관리자용 링크 생성
app.post('/api/admin/battles/:battleId/links', (req, res) => {
  const { battleId } = req.params;
  const snap = engine.snapshot(battleId);
  if (!snap) return res.status(404).json({ ok: false, error: 'battle not found' });

  const base =
    (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://` : 'http://') +
    (req.headers.host || `127.0.0.1:${PORT}`);

  const spectator = { url: `${base}/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(battleId)}` };
  const players = snap.players.map(p => ({
    playerName: p.name,
    team: p.team,
    url: `${base}/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(p.id)}`
  }));

  return res.json({ ok: true, links: { spectator, players } });
});

// 호환용 간단 링크 API (curl 확인용)
app.get('/api/link/participant', (req, res) => {
  const battleId = req.query.battleId || '';
  const base =
    (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://` : 'http://') +
    (req.headers.host || `127.0.0.1:${PORT}`);
  return res.json({
    ok: true,
    url: `${base}/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(battleId)}`,
    battleId, role: 'player'
  });
});

app.get('/api/link/spectator', (req, res) => {
  const battleId = req.query.battleId || '';
  const base =
    (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://` : 'http://') +
    (req.headers.host || `127.0.0.1:${PORT}`);
  return res.json({
    ok: true,
    url: `${base}/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(battleId)}`,
    battleId, role: 'spectator'
  });
});

// ===== Socket.IO =====
io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);
  socket.on('disconnect', () => console.log('[Socket] 연결 해제:', socket.id));

  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const snap = engine.snapshot(battleId);
    if (snap) socket.emit('battle:update', snap);
  });

  // 전투 생성
  socket.on('createBattle', ({ mode } = {}, cb) => {
    try {
      const b = engine.create(mode || '2v2');
      // 엔진 → 소켓 브릿지
      b._emitLog = (entry) => io.to(b.id).emit('battle:log', entry);
      b._emitUpdate = (snap) => io.to(b.id).emit('battle:update', snap);
      cb && cb({ ok: true, battleId: b.id, battle: engine.snapshot(b.id) });
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  // 참가자
  socket.on('addPlayer', ({ battleId, player } = {}, cb) => {
    try {
      const p = engine.addPlayer(battleId, player);
      io.to(battleId).emit('battle:update', engine.snapshot(battleId));
      cb && cb({ ok: true, player: p });
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('deletePlayer', ({ battleId, playerId } = {}, cb) => {
    try {
      const ok = engine.deletePlayer(battleId, playerId);
      io.to(battleId).emit('battle:update', engine.snapshot(battleId));
      cb && cb({ ok });
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  // 전투 제어
  socket.on('startBattle', ({ battleId } = {}, cb) => {
    try {
      const snap = engine.startBattle(battleId);
      io.to(battleId).emit('battle:update', snap);
      cb && cb({ ok: true });
    } catch (e) { cb && cb({ ok: false, error: e.message }); }
  });

  socket.on('pauseBattle', ({ battleId } = {}, cb) => {
    try { engine.pauseBattle(battleId); cb && cb({ ok: true }); }
    catch (e) { cb && cb({ ok: false, error: e.message }); }
  });

  socket.on('resumeBattle', ({ battleId } = {}, cb) => {
    try { engine.resumeBattle(battleId); cb && cb({ ok: true }); }
    catch (e) { cb && cb({ ok: false, error: e.message }); }
  });

  socket.on('endBattle', ({ battleId } = {}, cb) => {
    try { engine.endBattle(battleId); cb && cb({ ok: true }); }
    catch (e) { cb && cb({ ok: false, error: e.message }); }
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message } = {}) => {
    if (!battleId || !message) return;
    io.to(battleId).emit('chatMessage', { name: name || '익명', message });
  });
});

// 서버 시작
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
