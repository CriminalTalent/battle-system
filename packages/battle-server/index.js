// packages/battle-server/index.js
// - /admin, /player, /spectator 정적 별칭
// - 아바타 업로드(/api/upload/avatar, /upload) → JSON 응답
// - 참가자/관전자 링크 생성(/api/link/participant, /api/link/spectator, /api/link, 호환용 /link/*)
// - /api/* 404는 JSON으로 고정
// - battle:update/battleUpdate, battle:log/battleLog 이벤트 브로드캐스트
// - 1초 주기 스냅샷/로그 재전송

import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import multer from 'multer';
import { createBattleStore } from './src/engine/BattleEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 정적 파일
const pubDir = path.join(__dirname, 'public');
const uploadDir = path.join(pubDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use(express.static(pubDir, { extensions: ['html'] }));

// 페이지 별칭
app.get('/admin', (_req, res) => res.sendFile(path.join(pubDir, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(pubDir, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(pubDir, 'spectator.html')));
app.get('/', (_req, res) => res.sendFile(path.join(pubDir, 'index.html')));

// 헬스체크
app.get('/health', (_req, res) => res.json({ ok: true }));

// ================================
// 업로드(API) - JSON 응답
// ================================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cb(null, ext ? `${base}${ext}` : base);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|gif|webp|avif)$/.test(file.mimetype)) {
      return cb(new Error('INVALID_TYPE'));
    }
    cb(null, true);
  },
});
function handleAvatarUpload(req, res) {
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
  const urlPath = `/uploads/${req.file.filename}`;
  return res.json({ ok: true, url: urlPath });
}
app.post('/api/upload/avatar', upload.single('avatar'), handleAvatarUpload);
app.post('/upload', upload.single('avatar'), handleAvatarUpload); // 호환

// 업로드 에러를 JSON으로
app.use((err, _req, res, next) => {
  if (err?.message === 'INVALID_TYPE') {
    return res.status(400).json({ ok: false, error: 'INVALID_TYPE' });
  }
  if (err?.name === 'MulterError') {
    return res.status(400).json({ ok: false, error: err.code || 'MULTER_ERROR' });
  }
  return next(err);
});

// ================================
// 링크 생성(API)
// ================================
function absoluteUrl(req, pathnameWithQuery) {
  const proto =
    (req.headers['x-forwarded-proto']?.toString().split(',')[0]) ||
    req.protocol || 'http';
  const host =
    (req.headers['x-forwarded-host']?.toString().split(',')[0]) ||
    req.get('host');
  return `${proto}://${host}${pathnameWithQuery}`;
}
function linkHandler(kind) {
  const basePath = kind === 'spectator' ? '/spectator' : '/player';
  return (req, res) => {
    const id =
      req.body?.battleId || req.query?.battleId ||
      req.body?.id || req.query?.id || '';
    if (!id) return res.status(400).json({ ok: false, error: 'NO_BATTLE_ID' });
    const qs = `?battleId=${encodeURIComponent(id)}&id=${encodeURIComponent(id)}`;
    const url = absoluteUrl(req, `${basePath}${qs}`);
    return res.json({ ok: true, url, battleId: id, role: kind });
  };
}
// 신경로
app.post('/api/link/participant', linkHandler('player'));
app.get('/api/link/participant', linkHandler('player'));
app.post('/api/link/spectator', linkHandler('spectator'));
app.get('/api/link/spectator', linkHandler('spectator'));
app.post('/api/link', (req, res) => {
  const role = (req.body?.role || req.query?.role || '').toString();
  if (role === 'player') return linkHandler('player')(req, res);
  if (role === 'spectator') return linkHandler('spectator')(req, res);
  return res.status(400).json({ ok: false, error: 'INVALID_ROLE' });
});
app.get('/api/link', (req, res) => {
  const role = (req.query?.role || '').toString();
  if (role === 'player') return linkHandler('player')(req, res);
  if (role === 'spectator') return linkHandler('spectator')(req, res);
  return res.status(400).json({ ok: false, error: 'INVALID_ROLE' });
});
// 구버전/호환 경로
app.post('/link/participant', linkHandler('player'));
app.get('/link/participant', linkHandler('player'));
app.post('/link/spectator', linkHandler('spectator'));
app.get('/link/spectator', linkHandler('spectator'));
app.post('/link', (req, res) => {
  const role = (req.body?.role || req.query?.role || '').toString();
  if (role === 'player') return linkHandler('player')(req, res);
  if (role === 'spectator') return linkHandler('spectator')(req, res);
  return res.status(400).json({ ok: false, error: 'INVALID_ROLE' });
});
app.get('/link', (req, res) => {
  const role = (req.query?.role || '').toString();
  if (role === 'player') return linkHandler('player')(req, res);
  if (role === 'spectator') return linkHandler('spectator')(req, res);
  return res.status(400).json({ ok: false, error: 'INVALID_ROLE' });
});

// /api/* 404는 JSON
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

// ================================
// 배틀 엔진 + 소켓
// ================================
const battleEngine = createBattleStore();

const activeBattles = new Set(); // Set<battleId>
const lastLogIdx = new Map();    // Map<battleId, number>

function buildSnapshotWithLogs(battleId, logLimit = 200) {
  const snap = battleEngine.snapshot(battleId);
  if (!snap) return null;
  const b = battleEngine.get(battleId);
  const logs = Array.isArray(b?.logs) ? b.logs.slice(-logLimit) : [];
  return { ...snap, logs };
}
function emitUpdate(io, battleId) {
  const payload = buildSnapshotWithLogs(battleId);
  if (!payload) return;
  const room = `battle_${battleId}`;
  io.to(room).emit('battle:update', payload);
  io.to(room).emit('battleUpdate', payload); // 호환
}
function flushLogs(io, battleId) {
  const b = battleEngine.get(battleId);
  if (!b) return;
  const room = `battle_${battleId}`;
  const start = lastLogIdx.get(battleId) ?? 0;
  const end = b.logs.length;
  if (end <= start) return;
  for (let i = start; i < end; i++) {
    const entry = b.logs[i];
    io.to(room).emit('battle:log', entry);
    io.to(room).emit('battleLog', entry); // 호환
  }
  lastLogIdx.set(battleId, end);
}
// 1초마다 스냅샷/로그 재전송
setInterval(() => {
  for (const battleId of activeBattles) {
    emitUpdate(io, battleId);
    flushLogs(io, battleId);
  }
}, 1000);

io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);

  socket.on('disconnect', () => {
    console.log('[Socket] 연결 해제:', socket.id);
  });

  socket.on('join', ({ battleId }, cb = () => {}) => {
    try {
      if (!battleId) return cb({ ok: false, error: 'battleId 필요' });
      const b = battleEngine.get(battleId);
      if (!b) return cb({ ok: false, error: '존재하지 않는 전투입니다' });
      socket.join(`battle_${battleId}`);
      activeBattles.add(battleId);
      lastLogIdx.set(battleId, b.logs.length);
      emitUpdate(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('createBattle', ({ mode = '2v2' } = {}, cb = () => {}) => {
    try {
      const b = battleEngine.create(mode);
      activeBattles.add(b.id);
      lastLogIdx.set(b.id, 0);
      emitUpdate(io, b.id);
      cb({ ok: true, battleId: b.id });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('addPlayer', ({ battleId, player }, cb = () => {}) => {
    try {
      const added = battleEngine.addPlayer(battleId, player);
      if (!added) return cb({ ok: false, error: '플레이어 추가 실패' });
      const b = battleEngine.get(battleId);
      if (b) {
        b.logs.push({ ts: Date.now(), type: 'system', message: `${added.name}이(가) ${added.team}팀에 입장했습니다` });
      }
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true, player: added });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('removePlayer', ({ battleId, playerId }, cb = () => {}) => {
    try {
      const b = battleEngine.get(battleId);
      const p = b?.players?.find(x => x.id === playerId);
      const ok = battleEngine.removePlayer(battleId, playerId);
      if (!ok) return cb({ ok: false, error: '플레이어 제거 실패' });
      if (b && p) {
        b.logs.push({ ts: Date.now(), type: 'system', message: `${p.name}이(가) 전투에서 나갔습니다` });
      }
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('markReady', ({ battleId, playerId, ready = true }, cb = () => {}) => {
    try {
      const ok = battleEngine.markReady(battleId, playerId, ready);
      if (!ok) return cb({ ok: false, error: '준비 상태 변경 실패' });
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('startBattle', ({ battleId }, cb = () => {}) => {
    try {
      const started = battleEngine.start(battleId);
      if (!started) return cb({ ok: false, error: '전투를 시작할 수 없습니다' });
      activeBattles.add(battleId);
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('player:action', ({ battleId, playerId, action }, cb = () => {}) => {
    try {
      const res = battleEngine.playerAction(battleId, playerId, action);
      if (!res) return cb({ ok: false, error: '행동 처리 실패' });
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  socket.on('endBattle', ({ battleId }, cb = () => {}) => {
    try {
      const b = battleEngine.end(battleId);
      if (!b) return cb({ ok: false, error: '전투 종료 실패' });
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      activeBattles.delete(battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });
});

server.listen(PORT, () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
