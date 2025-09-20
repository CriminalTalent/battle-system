// /packages/battle-server/index.js
// PYXIS Battle Server (ESM) — 교체용 전체본
// 변경점
// 1) 플레이어 ID를 항상 URL-safe(영숫자/하이픈/언더스코어)로 서버에서 생성/보정
//    → 한글/공백 등이 포함된 이름으로 링크가 깨지는 문제 해결
// 2) /api/state/:battleId : 초기 렌더 스냅샷 제공(동일)

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
// Utils
// ---------------------------------------------------------------------------
const id8 = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toISOString();
const log = (...a) => console.log(...a);
const asAbs = (req, rel) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${rel}`;
};

// URL-safe ID만 허용(영문/숫자/-/_). 불일치 시 새 ID 생성
const SAFE_ID = /^[A-Za-z0-9_-]{3,64}$/;
const makeSafeId = () => `p_${id8()}${id8()}`; // 항상 ASCII
const ensureSafeId = (maybe) => (SAFE_ID.test(String(maybe || '')) ? String(maybe) : makeSafeId());

// ---------------------------------------------------------------------------
// Engine + Mirror
// ---------------------------------------------------------------------------
const engine = createBattleStore?.() ?? {};
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
  const key = p.id || p.playerId;
  const idx = m.players.findIndex(x => (x.id || x.playerId) === key);
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
const io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use('/', express.static(PUBLIC_DIR, { extensions: ['html'] }));
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
app.get('/api/link/participant', (req, res) => {
  const { battleId } = req.query;
  if (!battleId) return res.status(400).json({ ok: false, error: 'MISSING_battleId' });
  const id = ensureSafeId(req.query.id);
  const url = asAbs(req, `/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id)}`);
  res.json({ ok: true, url, battleId, role: 'player' });
});

app.get('/api/link/spectator', (req, res) => {
  const { battleId } = req.query;
  if (!battleId) return res.status(400).json({ ok: false, error: 'MISSING_battleId' });
  const url = asAbs(req, `/spectator?battleId=${encodeURIComponent(battleId)}`);
  res.json({ ok: true, url, battleId, role: 'spectator' });
});

// 관리자: 현재 등록된 플레이어 기준으로 링크 일괄 생성
app.post('/api/admin/battles/:battleId/links', (req, res) => {
  try {
    const { battleId } = req.params;
    const snap = mirror.get(battleId);
    if (!snap) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

    // 플레이어 id가 비어있거나 unsafe면 보정
    (snap.players || []).forEach(p => {
      const fixed = ensureSafeId(p.id || p.playerId);
      p.id = fixed; p.playerId = fixed;
    });

    const players = (snap.players || []).map(p => {
      const pid = p.id || p.playerId;
      const url = asAbs(
        req,
        `/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(pid)}`
      );
      return { playerId: pid, team: p.team, name: p.name, url };
    });
    const spectator = { url: asAbs(req, `/spectator?battleId=${encodeURIComponent(battleId)}`) };

    setMirror(battleId, { ...snap, players: snap.players });
    return res.json({ ok: true, links: { players, spectator } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 초기 스냅샷 제공
app.get('/api/state/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;
    let snap = await engine_snapshot?.(battleId);
    if (!snap) snap = mirror.get(battleId);
    if (!snap) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    // 플레이어 id 안전 보정
    (snap.players || []).forEach(p => {
      const fixed = ensureSafeId(p.id || p.playerId);
      p.id = fixed; p.playerId = fixed;
    });
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
  socket.on('disconnect', () => log(`[Socket] 연결 해제: ${socket.id}`));

  socket.on('join', async ({ battleId }) => {
    try {
      if (!battleId) return;
      socket.join(battleId);
      let snap = await engine_snapshot?.(battleId);
      if (!snap) snap = mirror.get(battleId);
      if (snap) {
        (snap.players || []).forEach(p => {
          const fixed = ensureSafeId(p.id || p.playerId);
          p.id = fixed; p.playerId = fixed;
        });
        socket.emit('battle:update', snap);
      }
    } catch {}
  });

  // 전투 생성
  socket.on('createBattle', async ({ mode }, cb) => {
    try {
      const battleId = id8().toUpperCase();
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

  // 플레이어 추가 — 서버에서 URL-safe id 확정
  socket.on('addPlayer', async ({ battleId, player }, cb) => {
    try {
      if (!battleId || !player) throw new Error('MISSING_PARAMS');

      const pid = ensureSafeId(player.id || player.playerId); // 외부 전달값이 유효하면 사용
      const finalId = SAFE_ID.test(pid) ? pid : makeSafeId(); // 아니면 신규
      const payload = { ...player, id: finalId, playerId: finalId };

      await engine_addPlayer?.(battleId, payload);

      upsertMirrorPlayer(battleId, {
        id: finalId,
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
      cb?.({ ok: true, playerId: finalId });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

  socket.on('deletePlayer', async ({ battleId, playerId }, cb) => {
    try {
      const pid = ensureSafeId(playerId);
      await engine_deletePlayer?.(battleId, pid);
      removeMirrorPlayer(battleId, pid);
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

  socket.on('setReady', async ({ battleId, playerId, ready = true }, cb) => {
    try {
      const pid = ensureSafeId(playerId);
      await engine_setReady?.(battleId, pid, ready);
      const m = getMirror(battleId);
      if (m) {
        const p = m.players.find(x => (x.id || x.playerId) === pid);
        if (p) p.ready = !!ready;
      }
      await emitSnapshot(battleId);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: String(e?.message || e) });
    }
  });

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

  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    const payload = { ts: Date.now(), name: name || '익명', message: String(message || '') };
    io.to(battleId).emit('chatMessage', payload);
  });
});

// 스냅샷 브로드캐스트(플레이어 id 안전 보정 포함)
async function emitSnapshot(battleId) {
  let snap = await engine_snapshot?.(battleId);
  if (!snap) snap = mirror.get(battleId);
  if (!snap) return;

  (snap.players || []).forEach(p => {
    const fixed = ensureSafeId(p.id || p.playerId);
    p.id = fixed; p.playerId = fixed;
  });

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
