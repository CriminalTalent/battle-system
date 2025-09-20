// packages/battle-server/index.js
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import multer from 'multer';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────
// 정적 파일
// ─────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// 헬스체크(프록시 502 디버깅용)
app.get('/api/health', (_req, res) => res.json({ ok: true, pid: process.pid, ts: Date.now() }));

// ─────────────────────────────────────────
// 업로드 (아바타)
// ─────────────────────────────────────────
const uploadDir = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext || '.png'}`);
  }
});
const upload = multer({ storage });

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
    const url = `/uploads/${req.file.filename}`;
    return res.json({ ok: true, url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ─────────────────────────────────────────
// 외부 엔진 로드(있으면 우선)
// ─────────────────────────────────────────
function pick(fn) { return (typeof fn === 'function') ? fn : null; }

async function tryLoadExternalEngine(ioInstance) {
  const candidate = path.join(__dirname, 'src/engine/BattleEngine.js');
  try { await fs.promises.access(candidate, fs.constants.R_OK); }
  catch { return null; }

  try {
    const mod = await import(pathToFileURL(candidate).href);
    if (typeof mod.createBattleStore !== 'function') return null;

    const ext = mod.createBattleStore(ioInstance) ||
                mod.createBattleStore({ io: ioInstance }) ||
                mod.createBattleStore();

    const bind = (name) => pick(ext?.[name]?.bind?.(ext) ?? ext?.[name]?.bind?.(ext) ?? null) || (typeof ext?.[name] === 'function' ? ext[name].bind(ext) : null);
    const _create = bind('createBattle') || bind('create');
    const _add    = bind('addPlayer')   || bind('addPlayerToBattle');
    const _remove = bind('deletePlayer')|| bind('removePlayer');
    const _ready  = bind('setReady')    || bind('readyPlayer') || bind('playerReady');
    const _start  = bind('start')       || bind('startBattle');
    const _pause  = bind('pause')       || bind('pauseBattle');
    const _resume = bind('resume')      || bind('resumeBattle');
    const _end    = bind('end')         || bind('endBattle');
    const _act    = bind('act')         || bind('applyAction') || bind('resolveAction');

    const tryMany = async (fn, variants) => {
      if (!fn) throw new Error('method missing');
      let lastErr;
      for (const makeArgs of variants) {
        try {
          const ret = fn(...makeArgs());
          return ret instanceof Promise ? await ret : ret;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('No matching signature');
    };

    const adapter = {
      battles: ext.battles || ext.store || new Map(),

      async snapshot(battleId) {
        // 가장 그럴듯한 스냅샷 추출
        if (typeof ext.getSnapshot === 'function') return await ext.getSnapshot(battleId);
        if (typeof ext.getBattle === 'function')   return await ext.getBattle(battleId);
        if (adapter.battles?.get) return adapter.battles.get(battleId);
        return null;
      },

      async createBattle(mode = '2v2') {
        return await tryMany(_create, [
          () => [mode],
          () => [{ mode }],
          () => [{ params: { mode } }],
        ]);
      },

      async addPlayer(battleId, player) {
        const pj = JSON.stringify(player);
        return await tryMany(_add, [
          () => [battleId, player],
          () => [{ battleId, player }],
          () => [battleId, pj],
          () => [{ battleId, player: pj }],
        ]);
      },

      async deletePlayer(battleId, playerId) {
        return await tryMany(_remove, [
          () => [battleId, playerId],
          () => [{ battleId, playerId }],
        ]);
      },

      async setReady(battleId, playerId) {
        return await tryMany(_ready, [
          () => [battleId, playerId],
          () => [{ battleId, playerId }],
        ]);
      },

      async start(battleId) {
        return await tryMany(_start, [
          () => [battleId],
          () => [{ battleId }],
        ]);
      },

      async pause(battleId) {
        return await tryMany(_pause, [
          () => [battleId],
          () => [{ battleId }],
        ]);
      },

      async resume(battleId) {
        return await tryMany(_resume, [
          () => [battleId],
          () => [{ battleId }],
        ]);
      },

      async end(battleId, winner = null) {
        return await tryMany(_end, [
          () => [battleId, winner],
          () => [{ battleId, winner }],
        ]);
      },

      async act(battleId, playerId, action) {
        const aj = JSON.stringify(action || { type: 'pass' });
        return await tryMany(_act, [
          () => [battleId, playerId, action],
          () => [{ battleId, playerId, action }],
          () => [battleId, playerId, aj],
          () => [{ battleId, playerId, action: aj }],
        ]);
      },

      makeLinks: pick(ext.makeLinks) ? ext.makeLinks.bind(ext) : null,
      authByToken: pick(ext.authByToken) ? ext.authByToken.bind(ext) : null,

      __ext: ext
    };

    console.log('[ENGINE] External BattleEngine.js loaded (multi-signature adapter)');
    return adapter;
  } catch (e) {
    console.log('[ENGINE] External load failed:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────
// 내부(폴백) 엔진 — 외부 없을 때만 사용
// ─────────────────────────────────────────
function createFallbackEngine() {
  const store = new Map();
  const rnd = () => Math.random().toString(36).slice(2, 10).toUpperCase();

  return {
    battles: store,

    async createBattle(mode = '2v2') {
      const id = rnd();
      const battle = {
        id, mode, status: 'waiting',
        players: [], logs: [],
        createdAt: Date.now()
      };
      store.set(id, battle);
      return battle;
    },

    async addPlayer(battleId, player) {
      const b = store.get(battleId);
      if (!b) throw new Error('BATTLE_NOT_FOUND');
      b.players.push({
        id: rnd(),
        team: player.team || 'A',
        name: player.name || '플레이어',
        hp: player.hp ?? 100,
        maxHp: player.maxHp ?? player.hp ?? 100,
        stats: player.stats || { attack: 1, defense: 1, agility: 1, luck: 1 },
        items: player.items || { dittany: 0, attackBooster: 0, defenseBooster: 0 },
        avatar: player.avatar || ''
      });
      return { ok: true };
    },

    async deletePlayer(battleId, playerId) {
      const b = store.get(battleId);
      if (!b) throw new Error('BATTLE_NOT_FOUND');
      b.players = b.players.filter(p => p.id !== playerId);
      return { ok: true };
    },

    async setReady(_battleId, _playerId) { return { ok: true }; },
    async start(battleId) { const b=store.get(battleId); if(b) b.status='active'; return { ok:true }; },
    async pause(battleId) { const b=store.get(battleId); if(b) b.status='paused'; return { ok:true }; },
    async resume(battleId){ const b=store.get(battleId); if(b) b.status='active'; return { ok:true }; },
    async end(battleId)   { const b=store.get(battleId); if(b) b.status='ended'; return { ok:true }; },
    async act() { return { ok: true }; },

    async getBattle(id) { return store.get(id); },
  };
}

// ─────────────────────────────────────────
// 엔진 인스턴스 준비
// ─────────────────────────────────────────
let engine;
const boot = async () => {
  engine = await tryLoadExternalEngine(io);
  if (!engine) {
    console.log('[ENGINE] Fallback engine in use');
    engine = createFallbackEngine();
  }
};
await boot();

// ─────────────────────────────────────────
// 링크 생성 API
// ─────────────────────────────────────────
function absBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

app.get('/api/link/participant', async (req, res) => {
  const { battleId, id } = req.query;
  if (!battleId) return res.status(400).json({ ok: false, error: 'MISSING_battleId' });
  const url = `${absBase(req)}/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id || battleId)}`;
  return res.json({ ok: true, url, battleId, role: 'player' });
});

app.get('/api/link/spectator', async (req, res) => {
  const { battleId, id } = req.query;
  if (!battleId) return res.status(400).json({ ok: false, error: 'MISSING_battleId' });
  const url = `${absBase(req)}/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(id || battleId)}`;
  return res.json({ ok: true, url, battleId, role: 'spectator' });
});

// 관리자에서 한 번에 링크 세트 요청
app.post('/api/admin/battles/:battleId/links', async (req, res) => {
  try {
    const { battleId } = req.params;
    let battle = await engine.snapshot?.(battleId);
    if (!battle?.players && engine.getBattle) battle = await engine.getBattle(battleId);

    const spectator = {
      url: `${absBase(req)}/spectator?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(battleId)}`
    };

    const players = (battle?.players || []).map(p => ({
      team: p.team,
      playerId: p.id,
      playerName: p.name,
      url: `${absBase(req)}/player?battleId=${encodeURIComponent(battleId)}&id=${encodeURIComponent(p.id)}`
    }));

    return res.json({ ok: true, links: { spectator, players } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ─────────────────────────────────────────
// 소켓 이벤트
// ─────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);

  socket.on('disconnect', () => {
    console.log('[Socket] 연결 해제:', socket.id);
  });

  socket.on('join', async ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
    if (snap) socket.emit('battle:update', snap);
  });

  socket.on('createBattle', async ({ mode }, cb) => {
    try {
      const battle = await engine.createBattle(mode || '2v2');
      cb?.({ ok: true, battleId: battle.id, battle });
      io.emit('battle:update', battle);
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('addPlayer', async ({ battleId, player }, cb) => {
    try {
      await engine.addPlayer(battleId, player);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('deletePlayer', async ({ battleId, playerId }, cb) => {
    try {
      await engine.deletePlayer(battleId, playerId);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('setReady', async ({ battleId, playerId }, cb) => {
    try {
      await engine.setReady(battleId, playerId);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('startBattle', async ({ battleId }, cb) => {
    try {
      await engine.start(battleId);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('pauseBattle', async ({ battleId }, cb) => {
    try {
      await engine.pause(battleId);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('resumeBattle', async ({ battleId }, cb) => {
    try {
      await engine.resume(battleId);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('endBattle', async ({ battleId }, cb) => {
    try {
      await engine.end(battleId);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('act', async ({ battleId, playerId, action }, cb) => {
    try {
      await engine.act(battleId, playerId, action);
      const snap = await (engine.snapshot?.(battleId) || engine.getBattle?.(battleId));
      if (snap) io.to(battleId).emit('battle:update', snap);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: String(e?.message || e) }); }
  });

  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    io.to(battleId).emit('chatMessage', { name: name || '관리자', message, ts: Date.now() });
  });
});

// ─────────────────────────────────────────
// 에러 핸들러(마지막에)
// ─────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[HTTP ERROR]', err);
  res.status(500).send('Server error');
});

// ─────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
