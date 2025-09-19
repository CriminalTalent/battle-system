/* packages/battle-server/index.js (ESM) — 서버/소켓 핸들러
   - authSuccess 에 player 전체 객체 포함
   - addPlayer 콜백에 player 반환
*/
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import { Server as IOServer } from 'socket.io';

import { createBattleStore } from './src/engine/BattleEngine.js';

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
app.use(cors({ origin: CORS_ORIGIN }));

/* 정적 파일 */
const PUBLIC_DIR = path.resolve(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

/* 업로드 디렉토리 */
const uploadsDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

/* Battle store */
const battleEngine = createBattleStore();
const battles = new Map();      // 필요시 부가 메모
const passwordStore = new Map();// OTP/토큰 저장소

/* multer */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'avatar-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) return cb(null, true);
    cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

/* API */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    battles: battleEngine.size ? battleEngine.size() : 0,
    uptime: process.uptime()
  });
});

const uploadRouter = express.Router();
uploadRouter.post('/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: '파일이 없습니다' });
    const url = `/uploads/avatars/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
uploadRouter.use((err, _req, res, _next) => {
  if (err instanceof Error) return res.status(400).json({ ok: false, error: err.message });
  res.status(500).json({ ok: false, error: '업로드 중 오류' });
});
app.use('/api/upload', uploadRouter);

/* 링크 생성 헬퍼 (관전자 OTP/플레이어 토큰 DB 대용) */
function buildLinks(battle, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');

  // 관전자 OTP
  if (!battle.spectatorOtp) {
    battle.spectatorOtp = Math.random().toString(36).slice(2, 8).toUpperCase();
    passwordStore.set(`spectator_${battle.id}`, {
      otp: battle.spectatorOtp,
      expiresAt: Date.now() + 30 * 60 * 1000
    });
  }
  // 플레이어 토큰 보관
  (battle.players || []).forEach(p => {
    if (!p.token) {
      p.token = Math.random().toString(36).slice(2, 10).toUpperCase();
    }
    passwordStore.set(`player_${battle.id}_${p.id}`, {
      token: p.token,
      expiresAt: Date.now() + 30 * 60 * 1000
    });
  });

  const spectator = {
    otp: battle.spectatorOtp,
    url: `${base}/spectator?battle=${encodeURIComponent(battle.id)}&otp=${encodeURIComponent(battle.spectatorOtp)}`
  };

  const players = (battle.players || []).map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    token: p.token,
    url: `${base}/player?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(p.token)}`
  }));

  return { spectator, players, playerLinks: players };
}

app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const b = battleEngine.get(req.params.id);
    if (!b) return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    // 프로덕션 도메인 고정
    const baseUrl = 'https://pyxisbattlesystem.monster';
    const links = buildLinks(b, baseUrl);
    res.json({ ok: true, links });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/battles/:id/links', (req, res) => {
  try {
    const b = battleEngine.get(req.params.id);
    if (!b) return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    const baseUrl = 'https://pyxisbattlesystem.monster';
    const links = buildLinks(b, baseUrl);
    res.json({ ok: true, links });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* 소켓 */
io.on('connection', (socket) => {
  let currentBattle = null;

  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    const b = battleEngine.get(battleId);
    if (!b) {
      socket.emit('error', { message: '전투를 찾을 수 없습니다' });
      return;
    }
    currentBattle = battleId;
    socket.join(`battle_${battleId}`);
    const snap = battleEngine.snapshot(battleId);
    if (snap) {
      socket.emit('battleUpdate', snap);
      socket.emit('battle:update', snap);
    }
  });

  socket.on('createBattle', ({ mode = '2v2' }, cb = () => {}) => {
    try {
      const b = battleEngine.create(mode);
      battles.set(b.id, b);
      currentBattle = b.id;
      socket.join(`battle_${b.id}`);
      b.logs.push({ ts: Date.now(), type: 'system', message: `${mode} 전투가 생성되었습니다` });
      const snap = battleEngine.snapshot(b.id);
      io.to(`battle_${b.id}`).emit('battle:update', snap);
      cb({ ok: true, battleId: b.id, battle: snap });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('startBattle', ({ battleId }, cb = () => {}) => {
    try {
      const result = battleEngine.start(battleId);
      if (!result) return cb({ ok: false, error: '전투를 시작할 수 없습니다' });
      const snap = battleEngine.snapshot(battleId);
      io.to(`battle_${battleId}`).emit('battle:update', snap);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('pauseBattle', ({ battleId }, cb = () => {}) => {
    try {
      const b = battleEngine.get(battleId);
      if (!b) return cb({ ok: false, error: '전투를 찾을 수 없습니다' });
      b.status = 'paused';
      b.logs.push({ ts: Date.now(), type: 'system', message: '전투가 일시정지되었습니다' });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('resumeBattle', ({ battleId }, cb = () => {}) => {
    try {
      const b = battleEngine.get(battleId);
      if (!b) return cb({ ok: false, error: '전투를 찾을 수 없습니다' });
      b.status = 'active';
      b.logs.push({ ts: Date.now(), type: 'system', message: '전투가 재개되었습니다' });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('endBattle', ({ battleId }, cb = () => {}) => {
    try {
      const b = battleEngine.end(battleId);
      if (!b) return cb({ ok: false, error: '전투를 찾을 수 없습니다' });
      b.logs.push({ ts: Date.now(), type: 'system', message: '전투가 종료되었습니다' });
      const snap = battleEngine.snapshot(battleId);
      io.to(`battle_${battleId}`).emit('battle:update', snap);
      io.to(`battle_${battleId}`).emit('battle:ended', { winner: 'Draw' });
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('addPlayer', ({ battleId, player }, cb = () => {}) => {
    try {
      const added = battleEngine.addPlayer(battleId, player);
      if (!added) return cb({ ok: false, error: '플레이어 추가에 실패했습니다' });
      const b = battleEngine.get(battleId);
      b.logs.push({ ts: Date.now(), type: 'system', message: `${added.name}이(가) ${added.team}팀에 입장했습니다` });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
      cb({ ok: true, player: added });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('deletePlayer', ({ battleId, playerId }, cb = () => {}) => {
    try {
      const ok = battleEngine.removePlayer(battleId, playerId);
      if (!ok) return cb({ ok: false, error: '제거 실패' });
      const b = battleEngine.get(battleId);
      b.logs.push({ ts: Date.now(), type: 'system', message: `플레이어 제거됨` });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  /* 플레이어 인증 — player 전체 객체 포함해서 반환 */
  socket.on('playerAuth', ({ battleId, name, token }, cb) => {
    try {
      const b = battleEngine.get(battleId);
      if (!b) {
        socket.emit('authError', { error: 'not found' });
        return cb?.({ ok: false, error: 'not found' });
      }
      let player = null;
      if (token) player = battleEngine.authByToken(battleId, token);
      if (!player && name) player = b.players.find(x => x.name === name) || null;

      if (!player) {
        socket.emit('authError', { error: 'auth failed' });
        return cb?.({ ok: false, error: 'auth failed' });
      }

      socket.join(`battle_${battleId}`);
      const payload = { ok: true, playerId: player.id, name: player.name, team: player.team, player };
      socket.emit('authSuccess', payload);
      socket.emit('auth:success', payload);
      cb?.(payload);

      b.logs.push({ ts: Date.now(), type: 'system', message: `${player.name} 입장` });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  /* 관전자 인증 */
  socket.on('spectatorAuth', ({ battleId, otp, name }, cb) => {
    try {
      const b = battleEngine.get(battleId);
      if (!b) return cb?.({ ok: false, error: 'not found' });

      const stored = passwordStore.get(`spectator_${battleId}`);
      if (!stored || stored.otp !== otp || Date.now() > stored.expiresAt) {
        return cb?.({ ok: false, error: 'invalid otp' });
      }

      socket.join(`battle_${battleId}`);
      cb?.({ ok: true });

      b.logs.push({ ts: Date.now(), type: 'system', message: `${name || '관전자'} 관전 입장` });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('player:ready', ({ battleId, playerId }, cb = () => {}) => {
    try {
      const ok = battleEngine.markReady(battleId, playerId, true);
      if (!ok) return cb({ ok: false, error: '준비 실패' });
      const b = battleEngine.get(battleId);
      const p = b.players.find(x => x.id === playerId);
      b.logs.push({ ts: Date.now(), type: 'system', message: `${p?.name || '플레이어'} 준비완료` });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('player:action', ({ battleId, playerId, action }, cb = () => {}) => {
    try {
      const res = battleEngine.playerAction(battleId, playerId, action);
      if (!res) {
        socket.emit('actionError', { error: '행동 실패' });
        return cb({ ok: false, error: '행동 실패' });
      }
      socket.emit('actionSuccess', { ok: true, result: res.result });
      socket.emit('player:action:success', { ok: true, result: res.result });
      io.to(`battle_${battleId}`).emit('battle:update', battleEngine.snapshot(battleId));
      cb({ ok: true, result: res.result });
    } catch (e) {
      socket.emit('actionError', { error: e.message });
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message?.trim()) return;
    const chat = { ts: Date.now(), name: name || '익명', message: message.trim() };
    io.to(`battle_${battleId}`).emit('chatMessage', chat);
    io.to(`battle_${battleId}`).emit('battle:chat', chat);
  });

  socket.on('disconnect', () => { /* 로그만 필요시 추가 */ });
});

/* 서버 시작 */
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] listening on http://${HOST}:${PORT}`);
});
