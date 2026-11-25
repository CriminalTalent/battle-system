/* packages/battle-server/index.js (ESM) */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';

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

const ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) console.warn('[경고] ADMIN_KEY 미설정: 모든 관리자 기능이 거부됩니다');
const digest = v => createHash('sha256').update(String(v)).digest();
const isAdminKey = k => !!ADMIN_KEY && typeof k === 'string' && timingSafeEqual(digest(k), digest(ADMIN_KEY));
function requireAdmin(req, res, next) {
  if (isAdminKey(req.get('x-admin-key'))) return next();
  res.status(401).json({ ok: false, error: '관리자 인증이 필요합니다' });
}

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
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

app.use('/uploads', express.static(uploadsDir, {
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}));

const send = file => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/', send('admin.html'));
app.get('/admin', send('admin.html'));
app.get('/player', send('player.html'));
app.get('/spectator', send('spectator.html'));

/* ─────────────────────────── 공용 유틸 ─────────────────────────── */

// BattleEngine 임포트
import { createBattleStore } from './src/engine/BattleEngine.js';
const battleEngine = createBattleStore();

/* ====== ★ 엔진 이벤트 훅 연결: 로그/업데이트를 소켓으로 브로드캐스트 ★ ====== */
function broadcastToRoom(battleId, event, data) {
  io.to(`battle_${battleId}`).emit(event, data);
}
function broadcastSnapshot(battleId) {
  const snap = battleEngine.snapshot(battleId);
  if (snap) {
    broadcastToRoom(battleId, 'battleUpdate', snap);
    broadcastToRoom(battleId, 'battle:update', snap);
  }
}
function broadcastLog(battleId, log) {
  broadcastToRoom(battleId, 'battle:log', log);
  broadcastToRoom(battleId, 'battleLog', log);
}

// 엔진 훅 등록
battleEngine.setLogger((battleId, log) => {
  broadcastLog(battleId, log);
});
battleEngine.setUpdate((battleId) => {
  broadcastSnapshot(battleId);
});

/* ─────────────────────────── 업로드 설정 ─────────────────────────── */
import multerPkg from 'multer';
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const storage = multerPkg.diskStorage({
  destination: function (_req, _file, cb) { cb(null, avatarsDir); },
  filename: function (_req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = IMAGE_EXT[file.mimetype];
    cb(null, 'avatar-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (_req, file, cb) {
    if (Object.hasOwn(IMAGE_EXT, file.mimetype)) return cb(null, true);
    cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

/* ─────────────────────────── API 라우트 ─────────────────────────── */

// 헬스체크
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    battles: battleEngine.size ? battleEngine.size() : 0,
    uptime: process.uptime()
  });
});

// 아바타 업로드
const uploadRouter = express.Router();
uploadRouter.post('/avatar', requireAdmin, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: '파일이 없습니다' });
    const url = `/uploads/avatars/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
uploadRouter.use((err, _req, res, _next) => {
  if (err instanceof Error) return res.status(400).json({ ok: false, error: err.message });
  res.status(500).json({ ok: false, error: '업로드 중 오류' });
});
app.use('/api/upload', uploadRouter);

// 전투 생성 (HTTP 폴백)
app.post('/api/battles', requireAdmin, (req, res) => {
  try {
    const { mode = '2v2' } = req.body || {};
    const battle = battleEngine.create(mode);
    res.json({ ok: true, battleId: battle.id, battle });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 링크 생성 함수
function buildLinks(battle, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');

  if (!battle.spectatorOtp) battle.spectatorOtp = randomBytes(8).toString('hex');

  const spectator = {
    otp: battle.spectatorOtp,
    url: base ? `${base}/spectator?battle=${encodeURIComponent(battle.id)}&otp=${encodeURIComponent(battle.spectatorOtp)}` : undefined
  };

  const players = (battle.players || []).map(p => ({
    id: p.id,
    playerId: p.id,
    name: p.name,
    playerName: p.name,
    team: p.team,
    otp: p.token,
    token: p.token,
    url: base ? `${base}/player?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(p.token)}` : undefined
  }));

  return { spectator, players, playerLinks: players };
}

// 링크 생성 (관리자용)
app.post('/api/admin/battles/:id/links', requireAdmin, (req, res) => {
  try {
    const battle = battleEngine.get(req.params.id);
    if (!battle) return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = buildLinks(battle, baseUrl);
    res.json({ ok: true, links });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 링크 생성 (호환)
app.post('/api/battles/:id/links', requireAdmin, (req, res) => {
  try {
    const battle = battleEngine.get(req.params.id);
    if (!battle) return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = buildLinks(battle, baseUrl);
    res.json({ ok: true, links });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* ─────────────────────────── 소켓 핸들러 ─────────────────────────── */
io.on('connection', (socket) => {
  const isAdmin = isAdminKey(socket.handshake.auth?.adminKey);

  // 잘못된 payload/예외가 서버를 종료시키지 않도록 공통 처리
  const on = (event, handler) => socket.on(event, (...args) => {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : () => {};
    const data = (args[0] && typeof args[0] === 'object') ? args[0] : {};
    try { handler(data, callback); }
    catch (e) {
      console.error(`[socket:${event}]`, e);
      callback({ ok: false, error: '요청 처리 실패' });
    }
  });
  const onAdmin = (event, handler) => on(event, (data, callback) => {
    if (!isAdmin) return callback({ ok: false, error: '관리자 인증이 필요합니다' });
    handler(data, callback);
  });
  const isSelf = (battleId, playerId) =>
    socket.data.player?.battleId === battleId && socket.data.player?.playerId === playerId;
  const join = battleId => socket.join(`battle_${battleId}`);

  on('admin:check', (_d, callback) => callback({ ok: isAdmin }));

  // 방 입장
  on('join', ({ battleId }) => {
    if (!battleEngine.get(battleId)) return socket.emit('error', { message: '전투를 찾을 수 없습니다' });
    join(battleId);
    broadcastSnapshot(battleId);
  });

  // 전투 생성/제어 (관리자)
  onAdmin('createBattle', ({ mode = '2v2' }, callback) => {
    const battle = battleEngine.create(mode);
    join(battle.id);
    broadcastSnapshot(battle.id);
    callback({ ok: true, battleId: battle.id });
  });
  const control = (event, method, error) => onAdmin(event, ({ battleId }, callback) => {
    if (!battleEngine[method](battleId)) return callback({ ok: false, error });
    broadcastSnapshot(battleId);
    callback({ ok: true });
  });
  control('startBattle', 'start', '전투를 시작할 수 없습니다');
  control('pauseBattle', 'pause', '일시정지할 수 없습니다');
  control('resumeBattle', 'resume', '재개할 수 없습니다');
  onAdmin('endBattle', ({ battleId }, callback) => {
    const b = battleEngine.end(battleId);
    if (!b) return callback({ ok: false, error: '전투를 찾을 수 없습니다' });
    broadcastToRoom(battleId, 'battle:ended', { winner: b.winner });
    callback({ ok: true });
  });

  // 플레이어 관리 (관리자)
  onAdmin('addPlayer', ({ battleId, player }, callback) => {
    const added = battleEngine.addPlayer(battleId, player);
    if (!added) return callback({ ok: false, error: '플레이어 추가 실패(대기 중인 전투만 가능)' });
    broadcastSnapshot(battleId);
    callback({ ok: true, player: added });
  });
  for (const event of ['deletePlayer', 'removePlayer']) {
    onAdmin(event, ({ battleId, playerId }, callback) => {
      if (!battleEngine.removePlayer(battleId, playerId)) return callback({ ok: false, error: '플레이어 제거 실패' });
      broadcastSnapshot(battleId);
      callback({ ok: true });
    });
  }

  // 인증 (토큰만 허용)
  on('playerAuth', ({ battleId, token }, callback) => {
    const player = battleEngine.authByToken(battleId, token);
    if (!player) {
      socket.emit('authError', { error: 'auth failed' });
      return callback({ ok: false, error: 'auth failed' });
    }
    socket.data.player = { battleId, playerId: player.id, name: player.name };
    join(battleId);
    const payload = { ok: true, playerId: player.id, name: player.name, team: player.team, player };
    socket.emit('authSuccess', payload);
    socket.emit('auth:success', payload);
    callback(payload);
    broadcastSnapshot(battleId);
  });

  on('spectatorAuth', ({ battleId, otp }, callback) => {
    const battle = battleEngine.get(battleId);
    if (!battle || !battle.spectatorOtp || battle.spectatorOtp !== otp) return callback({ ok: false, error: 'invalid otp' });
    join(battleId);
    callback({ ok: true });
    broadcastSnapshot(battleId);
  });

  // 준비/액션 (본인만)
  for (const event of ['player:ready', 'playerReady']) {
    on(event, ({ battleId, playerId, ready = true }, callback) => {
      if (!isSelf(battleId, playerId)) return callback({ ok: false, error: '권한이 없습니다' });
      const ok = battleEngine.markReady(battleId, playerId, ready);
      broadcastSnapshot(battleId);
      callback({ ok });
    });
  }
  on('player:action', ({ battleId, playerId, action }, callback) => {
    const res = isSelf(battleId, playerId) && battleEngine.playerAction(battleId, playerId, action);
    if (!res) {
      socket.emit('actionError', { error: '행동 처리 실패' });
      return callback({ ok: false, error: '행동 처리 실패' });
    }
    socket.emit('actionSuccess', { ok: true, result: res.result });
    socket.emit('player:action:success', { ok: true, result: res.result });
    broadcastSnapshot(battleId);
    callback({ ok: true, result: res.result });
  });

  // 채팅/응원 (입장한 방에만, 이름 사칭 방지)
  const chat = (battleId, name, message, type) => {
    if (!socket.rooms.has(`battle_${battleId}`) || typeof message !== 'string' || !message.trim()) return;
    const own = socket.data.player?.battleId === battleId ? socket.data.player.name : null;
    let shown = own || String(name || '익명').trim().slice(0, 30);
    if (isAdmin) shown = '관리자';
    else if (!own && shown === '관리자') shown = '익명';
    const data = { ts: Date.now(), name: shown, message: message.trim().slice(0, 500), type };
    broadcastToRoom(battleId, 'chatMessage', data);
    broadcastToRoom(battleId, 'battle:chat', data);
  };
  on('chatMessage', ({ battleId, name, message, type }) => chat(battleId, name, message, type === 'cheer' ? 'cheer' : undefined));
  on('spectator:cheer', ({ battleId, name, message }) => chat(battleId, name, message, 'cheer'));
});

/* ─────────────────────────── 서버 시작 ─────────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`Battle System up on http://${HOST}:${PORT}`);
});
