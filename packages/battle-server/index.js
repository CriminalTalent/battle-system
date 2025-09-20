// /packages/battle-server/index.js
// PYXIS Battle Server (ESM). 교체용 전체본.
// - addPlayer: 플레이어 id를 서버가 선확정하여 엔진/미러/링크가 동일 식별자 사용
// - /api/state/:battleId: 초기 렌더용 스냅샷 제공

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';
import { createBattleStore } from './src/engine/BattleEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
const id8 = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toISOString();
const log = (...a) => console.log(...a);
const asAbs = (req, rel) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${rel}`;
};

// ---------------------------------------------------------------------------
// Engine + Mirror
// ---------------------------------------------------------------------------
const engine = createBattleStore?.() ?? {};
// 엔진 함수가 없더라도 서버가 죽지 않도록 no-op 보강
const safe = (fnName, fallback) => (...args) => {
  try {
    const fn = engine?.[fnName];
    if (typeof fn === 'function') return fn(...args);
  } catch (e) {
    log(`[ENGINE][${fnName}]`, e?.stack || e);
  }
  return fallback?.(...args);
};

const mirror = new Map(); // battleId -> { id, mode, status, players:[], logs:[] }
const getMirror = (id) => mirror.get(id);
const setMirror = (id, snap) => mirror.set(id, snap);
const upsertMirrorPlayer = (battleId, p) => {
  const m = mirror.get(battleId);
  if (!m) return;
  const idx = m.players.findIndex(x => (x.id || x.playerId) === (p.id || p.playerId));
  if (idx >= 0) m.players[idx] = { ...m.players[idx], ...p };
  else m.players.push(p);
};
const removeMirrorPlayer = (battleId, pid) => {
  const m = mirror.get(battleId);
  if (!m) return;
  m.players = m.players.filter(x => (x.id || x.playerId) !== pid);
};

const engine_createBattle = safe('createBattle');
const engine_addPlayer   = safe('addPlayer');
const engine_deletePlayer= safe('deletePlayer');
const engine_setReady    = safe('setReady');
const engine_startBattle = safe('startBattle');
const engine_pauseBattle = safe('pauseBattle');
const engine_resumeBattle= safe('resumeBattle');
const engine_endBattle   = safe('endBattle');
const engine_snapshot    = safe('snapshot');

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, credentials: true }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use('/', express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Friendly routes
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// ---------------------------------------------------------------------------
// Uploads (avatars)
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}_${id8()}${ext || '.png'}`);
  }
});
const upload = multer({ storage });

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
    const rel = `/uploads/${req.file.filename}`;
    return res.json({ ok: true, url: rel });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------------------------------------------------------------------------
// Link APIs
// ---------------------------------------------------------------------------
// 간단 생성기(관리자 페이지에서 사용)
app.get('/api/link/participant', (req, res) => {
  const { battleId } = req.query;
  if (!battleId) return res.status(400).json({ ok: false, error: 'MISSING_battleId' });
  const id = req.query.id || battleId;
  const url = asAbs(req, `/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id)}`);
  res.json({ ok: true, url, battleId, role: 'player' });
});

app.get('/api/link/spectator', (req, res) => {
  const { battleId } = req.query;
  if (!battleId) return res.status(400).json({ ok: false, error: 'MISSING_battleId' });
  const id = req.query.id || battleId;
  const url = asAbs(req, `/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id)}`);
  res.json({ ok: true, url, battleId, role: 'spectator' });
});

// 관리자에서 한 번에 리스트 생성
app.post('/api/admin/battles/:battleId/links', (req, res) => {
  try {
    const { battleId } = req.params;
    const snap = mirror.get(battleId);
    if (!snap) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    const players = (snap.players || []).map(p => {
      const pid = p.id || p.playerId || id8();
      const url = asAbs(req, `/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(pid)}`);
      return { playerId: pid, team: p.team, name: p.name, url };
    });
    const spectator = { url: asAbs(req, `/spectator?battleId=${encodeURIComponent(battleId)}`) };
    return res.json({ ok: true, links: { players, spectator } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// (신규) 초기 렌더 보조: 현재 배틀 스냅샷 반환
app.get('/api/state/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;
    let snap = await engine_snapshot?.(battleId);
    if (!snap) snap = mirror.get(battleId);
    if (!snap) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    return res.json({ ok: true, battle: snap });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  log(`[Socket] 새 연결: ${socket.id}`);

  socket.on('disconnect', () => {
    log(`[Socket] 연결 해제: ${socket.id}`);
  });

  // 방 참여
  socket.on('join', async ({ battleId }) => {
    try {
      if (!battleId) return;
      socket.join(battleId);
      let snap = await engine_snapshot?.(battleId);
      if (!snap) snap = mirror.get(battleId);
      if (snap) socket.emit('battle:update', snap);
    } catch {}
  });

  // 전투 생성
  socket.on('createBattle', async ({ mode }, cb) => {
    try {
      const battleId = id8().toUpperCase();
      // 엔진에 넘기되 실패해도 미러 최소 구성
      await engine_createBattle?.(battleId, { id: battleId, mode });
      const snap = {
        id: battleId,
        mode: mode || '1v1',
        status: 'waiting',
        createdAt: ts(),
        players: [],
        logs: []
      };
      setMirror(battleId, snap);
      io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true, battleId, battle: snap });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

  // 플레이어 추가 (교체 포인트 ①: id 선확정)
  socket.on('addPlayer', async ({ battleId, player }, cb) => {
    try {
      if (!battleId || !player) throw new Error('MISSING_PARAMS');

      const pid = player.id || player.playerId || (player.name ? `${player.name}-${id8()}` : id8());
      const payload = { ...player, id: pid, playerId: pid };

      // 엔진에도 동일 id로 전달
      await engine_addPlayer?.(battleId, payload);

      // 미러 즉시 반영
      upsertMirrorPlayer(battleId, {
        id: pid,
        team: payload.team || 'A',
        name: payload.name || '플레이어',
        hp: payload.hp ?? 100,
        maxHp: payload.maxHp ?? payload.hp ?? 100,
        stats: payload.stats || { attack: 1, defense: 1, agility: 1, luck: 1 },
        items: payload.items || { dittany: 0, attackBooster: 0, defenseBooster: 0 },
        avatar: payload.avatar || '',
        ready: !!payload.ready
      });

      await emitSnapshot(battleId);
      cb?.({ ok: true, playerId: pid });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

  // 플레이어 제거
  socket.on('deletePlayer', async ({ battleId, playerId }, cb) => {
    try {
      await engine_deletePlayer?.(battleId, playerId);
      removeMirrorPlayer(battleId, playerId);
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

  // 준비 상태
  socket.on('setReady', async ({ battleId, playerId, ready = true }, cb) => {
    try {
      await engine_setReady?.(battleId, playerId, ready);
      const m = getMirror(battleId);
      if (m) {
        const p = m.players.find(x => (x.id || x.playerId) === playerId);
        if (p) p.ready = !!ready;
      }
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

  // 전투 제어
  socket.on('startBattle', async ({ battleId }, cb) => {
    try {
      await engine_startBattle?.(battleId);
      const m = getMirror(battleId); if (m) m.status = 'active';
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('pauseBattle', async ({ battleId }, cb) => {
    try {
      await engine_pauseBattle?.(battleId);
      const m = getMirror(battleId); if (m) m.status = 'paused';
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('resumeBattle', async ({ battleId }, cb) => {
    try {
      await engine_resumeBattle?.(battleId);
      const m = getMirror(battleId); if (m) m.status = 'active';
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('endBattle', async ({ battleId }, cb) => {
    try {
      await engine_endBattle?.(battleId);
      const m = getMirror(battleId); if (m) m.status = 'ended';
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  // 채팅 브로드캐스트
  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    const payload = { ts: Date.now(), name: name || '익명', message: String(message || '') };
    io.to(battleId).emit('chatMessage', payload);
  });
});

// 스냅샷 브로드캐스트
async function emitSnapshot(battleId) {
  let snap = await engine_snapshot?.(battleId);
  if (!snap) snap = mirror.get(battleId);
  if (!snap) return;
  // 미러와 엔진 스냅샷을 가볍게 병합(엔진이 제공하면 우선)
  const base = mirror.get(battleId) || {};
  const merged = {
    id: snap.id || base.id || battleId,
    mode: snap.mode || base.mode || '1v1',
    status: snap.status || base.status || 'waiting',
    players: Array.isArray(snap.players) ? snap.players : (base.players || []),
    logs: Array.isArray(snap.logs) ? snap.logs : (base.logs || [])
  };
  setMirror(battleId, merged);
  io.to(battleId).emit('battle:update', merged);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
server.listen(PORT, '0.0.0.0', () => {
  log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
