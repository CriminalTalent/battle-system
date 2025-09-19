// packages/battle-server/index.js
// Node >=18, ESM
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

import { createBattleStore } from './src/engine/BattleEngine.js';

// ---------------------------------------------------------------------
// 환경/경로
// ---------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const PORT = Number(process.env.PORT || process.env.PYXIS_PORT || 3001);

// 프록시 뒤에서 실제 Host/Proto 확인 허용
const app = express();
app.set('trust proxy', true);

// 미들웨어
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 파일
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

// 업로드 폴더 준비
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer 저장소
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'avatar', ext).replace(/[^\w.-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({ storage });

// ---------------------------------------------------------------------
// 배틀 엔진 구동
// ---------------------------------------------------------------------
const engine = createBattleStore();
const engineTag = engine?.version ? `battle-engine@${engine.version}` : 'battle-engine';

console.log(`[ENGINE LOADED] ${engineTag}`);

// ---------------------------------------------------------------------
// HTTP 서버 + Socket.IO
// ---------------------------------------------------------------------
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/socket.io',
});

io.on('connection', (socket) => {
  console.log(`[Socket] 새 연결: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket] 연결 해제: ${socket.id}`);
  });

  // 방 참가
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const snap = safeSnapshot(battleId);
    if (snap) socket.emit('battle:update', snap);
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    const payload = { ts: Date.now(), name: name || '익명', message: String(message) };
    io.to(battleId).emit('chatMessage', payload);
  });

  // 관리 명령
  socket.on('createBattle', (params = {}, cb) => {
    try {
      const battle = engine.createBattle({ mode: params.mode || '2v2' });
      socket.join(battle.id);
      const snap = safeSnapshot(battle.id);
      io.to(battle.id).emit('battle:update', snap);
      cb?.({ ok: true, battleId: battle.id, battle: snap });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('addPlayer', ({ battleId, player }, cb) => {
    try {
      engine.addPlayer(battleId, player);
      broadcastUpdate(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('deletePlayer', ({ battleId, playerId }, cb) => {
    try {
      engine.removePlayer(battleId, playerId);
      broadcastUpdate(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('startBattle', ({ battleId }, cb) => {
    try {
      engine.startBattle(battleId);
      broadcastUpdate(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('pauseBattle', ({ battleId }, cb) => {
    try {
      engine.pauseBattle(battleId);
      broadcastUpdate(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('resumeBattle', ({ battleId }, cb) => {
    try {
      engine.resumeBattle(battleId);
      broadcastUpdate(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('endBattle', ({ battleId }, cb) => {
    try {
      engine.endBattle(battleId);
      broadcastUpdate(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });
});

// 엔진 이벤트 → 실시간 브로드캐스트(있으면)
if (typeof engine?.on === 'function') {
  engine.on('update', (battleId) => broadcastUpdate(battleId));
  engine.on('log', ({ battleId, ts, type, message }) => {
    if (!battleId || !message) return;
    io.to(battleId).emit('battle:log', { ts: ts || Date.now(), type: type || 'system', message: String(message) });
    if (process.env.ENGINE_STDOUT) {
      console.log(`[BATTLE LOG][${battleId}] ${message}`);
    }
  });
  engine.on('chat', ({ battleId, name, message, ts }) => {
    if (!battleId || !message) return;
    io.to(battleId).emit('chatMessage', { ts: ts || Date.now(), name: name || '시스템', message: String(message) });
  });
}

// ---------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------
function safeSnapshot(battleId) {
  try {
    return engine.snapshot(battleId);
  } catch {
    return null;
  }
}

function broadcastUpdate(battleId) {
  const snap = safeSnapshot(battleId);
  if (snap) io.to(battleId).emit('battle:update', snap);
}

function getBaseUrl(req) {
  // x-forwarded-* 우선
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (proto && host) return `${proto}://${host}`;
  // 환경 변수 우선
  if (process.env.PUBLIC_BASE) return process.env.PUBLIC_BASE.replace(/\/+$/, '');
  // 로컬 기본값
  return `http://127.0.0.1:${PORT}`;
}

function absUrl(req, relative) {
  const base = getBaseUrl(req);
  if (!relative.startsWith('/')) relative = `/${relative}`;
  return `${base}${relative}`;
}

// ---------------------------------------------------------------------
// 라우팅(페이지)
// ---------------------------------------------------------------------

// 관리자 페이지
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// 플레이어 페이지(id → playerId 보정 리다이렉트)
app.get('/player', (req, res) => {
  const hasId = req.query.id && !req.query.playerId;
  if (hasId) {
    const q = new URLSearchParams(req.query);
    q.set('playerId', req.query.id);
    q.delete('id');
    return res.redirect(302, `/player?${q.toString()}`);
  }
  res.sendFile(path.join(PUBLIC_DIR, 'player.html'));
});

// 관전자 페이지
app.get('/spectator', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'spectator.html'));
});

// 대시/헬스
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, engine: engineTag }));

// ---------------------------------------------------------------------
// 라우팅(파일 업로드 / API)
// ---------------------------------------------------------------------

// 아바타 업로드(JSON 응답)
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    const rel = `/uploads/${req.file.filename}`;
    // 상대/절대 둘 다 제공(클라이언트에서 절대화 처리)
    res.json({ ok: true, url: rel, absoluteUrl: absUrl(req, rel) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 배틀 스냅샷 조회(플레이어/관전자 초기 데이터용)
app.get('/api/battles/:battleId', (req, res) => {
  const snap = safeSnapshot(req.params.battleId);
  if (!snap) return res.status(404).json({ ok: false, error: 'battle not found' });
  res.json({ ok: true, battle: snap });
});

// 플레이어 링크 유효성 검사(선택)
app.get('/api/validate/player-link', (req, res) => {
  const battleId = req.query.battleId || req.query.battle;
  const playerId = req.query.playerId || req.query.pid || req.query.id;
  const snap = battleId ? safeSnapshot(battleId) : null;
  const player = snap?.players?.find(p => p.id === playerId);
  if (!battleId || !playerId || !snap || !player) {
    return res.status(400).json({ ok: false, error: 'invalid link' });
  }
  res.json({ ok: true, battleId, player });
});

// 관리자: 링크 묶음 생성(관전자 + 참가자들)
app.post('/api/admin/battles/:battleId/links', (req, res) => {
  const battleId = req.params.battleId;
  const snap = safeSnapshot(battleId);
  if (!snap) return res.status(404).json({ ok: false, error: 'battle not found' });

  const spectatorUrl = absUrl(req, `/spectator?battleId=${encodeURIComponent(battleId)}`);

  const players = (snap.players || []).map(p => {
    // 관리자 UI 호환: id 파라미터 사용(플레이어 페이지에서 id→playerId 보정)
    const url = absUrl(req, `/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(p.id)}`);
    return {
      id: p.id,
      playerName: p.name,
      name: p.name,
      team: p.team,
      url,
    };
  });

  // 두 가지 포맷을 모두 반환(클라이언트 호환 최적화)
  res.json({
    ok: true,
    links: {
      spectator: { url: spectatorUrl },
      players,
      playerLinks: players,
    },
  });
});

// 단건 링크 생성(참가자)
app.get('/api/link/participant', (req, res) => {
  const battleId = req.query.battleId || req.query.battle;
  const playerId = req.query.playerId || req.query.pid || req.query.id;
  if (!battleId || !playerId) return res.status(400).json({ ok: false, error: 'missing params' });

  const url = absUrl(req, `/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(playerId)}`);
  res.json({ ok: true, url, battleId, role: 'player' });
});

// 단건 링크 생성(관전자)
app.get('/api/link/spectator', (req, res) => {
  const battleId = req.query.battleId || req.query.battle;
  if (!battleId) return res.status(400).json({ ok: false, error: 'missing params' });

  const url = absUrl(req, `/spectator?battleId=${encodeURIComponent(battleId)}`);
  res.json({ ok: true, url, battleId, role: 'spectator' });
});

// ---------------------------------------------------------------------
// 에러 핸들러(최후)
// ---------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[HTTP ERROR]', err);
  res.status(500).json({ ok: false, error: err?.message || 'internal error' });
});

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
