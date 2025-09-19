// packages/battle-server/index.js
// - /admin, /player, /spectator 라우트 별칭
// - battle:update / battleUpdate 모두 브로드캐스트
// - battle:log / battleLog 실시간 로그 브로드캐스트(증분)
// - 매 1초 스냅샷/로그 브로드캐스트(타이머 1초 갱신)
// - 아바타 업로드 엔드포인트(/api/upload/avatar, /upload) 추가(JSON 응답)

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

// ----------------------------------------------------------------------------
// Server bootstrap
// ----------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 정적 파일
const pubDir = path.join(__dirname, 'public');
const uploadDir = path.join(pubDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use(express.static(pubDir, { extensions: ['html'] }));

// 단일 파일 별칭
app.get('/admin', (_req, res) => res.sendFile(path.join(pubDir, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(pubDir, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(pubDir, 'spectator.html')));
app.get('/', (_req, res) => res.sendFile(path.join(pubDir, 'index.html')));

// 헬스체크
app.get('/health', (_req, res) => res.json({ ok: true }));

// ----------------------------------------------------------------------------
// File upload (avatar)
// ----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cb(null, ext ? `${base}${ext}` : base);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|gif|webp|avif)$/.test(file.mimetype)) {
      return cb(new Error('INVALID_TYPE'));
    }
    cb(null, true);
  }
});

// 업로드 엔드포인트(관리자 페이지 호환용으로 두 경로 모두 지원)
function handleAvatarUpload(req, res) {
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
  const urlPath = `/uploads/${req.file.filename}`; // 정적 서빙됨
  return res.json({ ok: true, url: urlPath });
}
app.post('/api/upload/avatar', upload.single('avatar'), handleAvatarUpload);
app.post('/upload', upload.single('avatar'), handleAvatarUpload); // 구버전 호환

// 업로드 에러를 JSON으로 반환
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: err.code });
  }
  if (err && (err.message === 'INVALID_TYPE')) {
    return res.status(400).json({ ok: false, error: 'INVALID_TYPE' });
  }
  return next(err);
});

// ----------------------------------------------------------------------------
// Battle Engine
// ----------------------------------------------------------------------------
const battleEngine = createBattleStore();

// 활성 배틀 추적(주기적 브로드캐스트/로그 플러시용)
const activeBattles = new Set();     // Set<battleId>
const lastLogIdx = new Map();        // Map<battleId, number>

// 스냅샷 빌더(최근 로그 포함)
function buildSnapshotWithLogs(battleId, logLimit = 200) {
  const snap = battleEngine.snapshot(battleId);
  if (!snap) return null;
  const b = battleEngine.get(battleId);
  const logs = Array.isArray(b?.logs) ? b.logs.slice(-logLimit) : [];
  return { ...snap, logs };
}

// 스냅샷 브로드캐스트(이벤트 이름 호환)
function emitUpdate(io, battleId) {
  const payload = buildSnapshotWithLogs(battleId);
  if (!payload) return;
  const room = `battle_${battleId}`;
  io.to(room).emit('battle:update', payload);
  io.to(room).emit('battleUpdate', payload); // 구버전 호환
}

// 신규 로그 플러시(증분)
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
    io.to(room).emit('battleLog', entry); // 구버전 호환
  }
  lastLogIdx.set(battleId, end);
}

// 매 1초 전체 배틀 스냅샷/로그 브로드캐스트(타이머/로그 실시간 보장)
setInterval(() => {
  for (const battleId of activeBattles) {
    emitUpdate(io, battleId);
    flushLogs(io, battleId);
  }
}, 1000);

// ----------------------------------------------------------------------------
// Socket.io
// ----------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);

  socket.on('disconnect', () => {
    console.log('[Socket] 연결 해제:', socket.id);
  });

  // 방 참가
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

  // 새 배틀 생성
  socket.on('createBattle', ({ mode = '2v2' } = {}, cb = () => {}) => {
    try {
      const b = battleEngine.create(mode);
      activeBattles.add(b.id);
      lastLogIdx.set(b.id, 0);
      emitUpdate(io, b.id);
      cb({ ok: true, battleId: b.id });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  // 플레이어 추가
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

  // 플레이어 제거
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

  // 준비 토글
  socket.on('markReady', ({ battleId, playerId, ready = true }, cb = () => {}) => {
    try {
      const ok = battleEngine.markReady(battleId, playerId, ready);
      if (!ok) return cb({ ok: false, error: '준비 상태 변경 실패' });
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId }, cb = () => {}) => {
    try {
      const result = battleEngine.start(battleId);
      if (!result) return cb({ ok: false, error: '전투를 시작할 수 없습니다' });
      activeBattles.add(battleId);
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  // 플레이어 행동(선택 페이즈 의도 큐잉)
  socket.on('player:action', ({ battleId, playerId, action }, cb = () => {}) => {
    try {
      const res = battleEngine.playerAction(battleId, playerId, action);
      if (!res) return cb({ ok: false, error: '행동 처리 실패' });
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  // 전투 종료
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

// ----------------------------------------------------------------------------
// Launch
// ----------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
