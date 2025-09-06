/**
 * PYXIS Battle Server - unified index.js
 * - Express + Socket.IO
 * - In-memory battles store
 * - Health / static / pages
 * - REST: create battle, players, avatar upload
 * - Admin REST: links(OTP), start/pause/end, command(HP 보정)
 * - WS: admin/player/spectator auth, battleUpdate, chatMessage, admin fallbacks
 *
 * 디자인/룰은 변경하지 않습니다. (스탯 1~5, 기본 HP 100 등)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''; // 소켓 폴백 링크 생성 시 사용 가능

// ----------------------------------------------------------------------------
// App / Server / IO
// ----------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ----------------------------------------------------------------------------
/* Paths */
// ----------------------------------------------------------------------------
const ROOT = __dirname;
const PUB_DIR = path.resolve(ROOT, 'public');
const UPLOAD_DIR = path.resolve(ROOT, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(PUB_DIR, { extensions: ['html'] }));

// 페이지 라우트(정적 빌드와 공존)
app.get(['/admin', '/play', '/watch'], (req, res) => {
  const name = req.path.replace(/^\//, '');
  const file = path.join(PUB_DIR, `${name}.html`);
  if (fs.existsSync(file)) return res.sendFile(file);
  // pages/ 하위 구조 지원
  const alt = path.join(PUB_DIR, 'pages', `${name}.html`);
  if (fs.existsSync(alt)) return res.sendFile(alt);
  res.status(404).send('Not Found');
});

// ----------------------------------------------------------------------------
/* In-memory store */
// ----------------------------------------------------------------------------
/**
 * battles: {
 *   [id]: {
 *     id, mode, status, createdAt,
 *     players: [{ id,name,team,stats:{atk,def,agi,luk}, items:[], hp,maxHp, avatar }]
 *     otps: { admin:{token,exp}, player:{token,exp}, spectator:{token,exp} }
 *     log: [{ t, type, message }]
 *   }
 * }
 */
const battles = Object.create(null);

// ----------------------------------------------------------------------------
/* Utils */
// ----------------------------------------------------------------------------
const clamp = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};
const randId = (n = 8) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();

// Node 버전 무관 URL-safe 토큰
const token = (n = 24) => {
  const b64 = crypto.randomBytes(n).toString('base64');
  const safe = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
  return safe.slice(0, n);
};

const now = () => Date.now();

const OTP_TTL = {
  admin: 60 * 60 * 1000,      // 60분
  player: 30 * 60 * 1000,     // 30분
  spectator: 30 * 60 * 1000   // 30분
};

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function ensureOtps(b) {
  const t = now();
  b.otps = b.otps || {};
  if (!b.otps.admin || b.otps.admin.exp < t) b.otps.admin = { token: token(28), exp: t + OTP_TTL.admin };
  if (!b.otps.player || b.otps.player.exp < t) b.otps.player = { token: token(20), exp: t + OTP_TTL.player };
  if (!b.otps.spectator || b.otps.spectator.exp < t) b.otps.spectator = { token: token(20), exp: t + OTP_TTL.spectator };
}

function addLog(b, type, message) {
  b.log = b.log || [];
  b.log.push({ t: now(), type, message });
  if (b.log.length > 500) b.log.shift();
}

// ----------------------------------------------------------------------------
/* Health */
// ----------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development', time: new Date().toISOString() });
});

// ----------------------------------------------------------------------------
/* Battles - REST */
// ----------------------------------------------------------------------------
app.post('/api/battles', (req, res) => {
  try {
    const mode = String(req.body?.mode || '2v2');
    const id = randId(8);
    const b = {
      id,
      mode,
      status: 'waiting',
      createdAt: now(),
      players: [],
      otps: {},
      log: []
    };
    battles[id] = b;
    addLog(b, 'system', `Battle created (${mode})`);
    console.log('[INFO] Battle created:', id, `(${mode})`);
    res.json({ id });
  } catch (e) {
    console.error('[ERR] create battle:', e);
    res.status(500).json({ error: 'create_failed' });
  }
});

app.get('/api/battles', (req, res) => {
  const list = Object.values(battles).map(b => ({ id: b.id, mode: b.mode, status: b.status, createdAt: b.createdAt, players: b.players.length }));
  res.json({ battles: list });
});

app.get('/api/battles/:id', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  res.json(b);
});

app.post('/api/battles/:id/players', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  let name = String(body.name || '플레이어').slice(0, 50);
  const teamRaw = String(body.team || 'phoenix').toLowerCase();
  const team = ['eaters', 'death', 'deatheaters', 'b', 'team2'].includes(teamRaw) ? 'eaters' : 'phoenix';

  const stats = {
    atk: clamp(body.stats?.atk ?? body.atk ?? 3, 1, 5),
    def: clamp(body.stats?.def ?? body.def ?? 3, 1, 5),
    agi: clamp(body.stats?.agi ?? body.agi ?? 3, 1, 5),
    luk: clamp(body.stats?.luk ?? body.luk ?? 3, 1, 5)
  };

  const items = Array.isArray(body.items) ? body.items.slice(0, 5)
                : (body.item ? [body.item] : []);

  // 이름 중복 방지
  const set = new Set(b.players.map(p => p.name));
  if (set.has(name)) {
    let i = 2, base = name;
    while (set.has(`${base}(${i})`)) i++;
    name = `${base}(${i})`;
  }

  const p = {
    id: 'P_' + randId(10),
    name, team, stats, items,
    hp: 100, maxHp: 100,
    avatar: typeof body.avatar === 'string' ? body.avatar : undefined
  };

  b.players.push(p);
  addLog(b, 'join', `${name} joined (${team})`);
  io.to(`battle-${b.id}`).emit('battleUpdate', b);

  res.json({ player: p });
});

app.delete('/api/battles/:id/players/:pid', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  const i = b.players.findIndex(x => x.id === req.params.pid);
  if (i < 0) return res.status(404).json({ error: 'player_not_found' });
  const [removed] = b.players.splice(i, 1);
  addLog(b, 'leave', `${removed.name} removed`);
  io.to(`battle-${b.id}`).emit('battleUpdate', b);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
/* Avatar upload */
// ----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = req.params.id || 'unknown';
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `battle_${id}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'file_missing' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// ----------------------------------------------------------------------------
/* Admin - REST */
// ----------------------------------------------------------------------------
app.post('/api/admin/battles/:id/links', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  ensureOtps(b);

  const base = baseUrl(req);
  const id = encodeURIComponent(b.id);

  const links = {
    admin: `${base}/admin?battle=${id}&token=${encodeURIComponent(b.otps.admin.token)}`,
    player: `${base}/play?battle=${id}&token=${encodeURIComponent(b.otps.player.token)}`,
    spectator: `${base}/watch?battle=${id}&token=${encodeURIComponent(b.otps.spectator.token)}`
  };
  res.json({ links, admin: links.admin, player: links.player, spectator: links.spectator });
});

app.post('/api/admin/battles/:id/start', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  b.status = 'live';
  addLog(b, 'system', 'Battle started');
  io.to(`battle-${b.id}`).emit('battleUpdate', b);
  res.json({ ok: true });
});

app.post('/api/admin/battles/:id/pause', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  b.status = 'waiting';
  addLog(b, 'system', 'Battle paused');
  io.to(`battle-${b.id}`).emit('battleUpdate', b);
  res.json({ ok: true });
});

app.post('/api/admin/battles/:id/end', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  b.status = 'end';
  addLog(b, 'system', 'Battle ended');
  io.to(`battle-${b.id}`).emit('battleUpdate', b);
  res.json({ ok: true });
});

/**
 * Admin command
 * body: { action: "heal_partial"|"damage", playerIds: [id], value: number }
 */
app.post('/api/admin/battles/:id/command', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not_found' });
  const { action, playerIds, value } = req.body || {};
  if (!Array.isArray(playerIds) || !playerIds.length || !Number.isFinite(value)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  for (const p of b.players) {
    if (!playerIds.includes(p.id)) continue;
    if (action === 'heal_partial') {
      p.hp = Math.min(p.maxHp || 100, (p.hp || 100) + Math.max(0, value));
    } else if (action === 'damage') {
      p.hp = Math.max(0, (p.hp || 100) - Math.max(0, value));
    }
  }
  addLog(b, 'system', `Admin command: ${action} value=${value} on ${playerIds.length} player(s)`);
  io.to(`battle-${b.id}`).emit('battleUpdate', b);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
/* Socket.IO */
// ----------------------------------------------------------------------------
io.on('connection', (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  console.log('[INFO] Socket connected:', socket.id, 'ip=', ip);

  // 관리자 인증
  socket.on('adminAuth', (payload = {}) => {
    const id = payload.battleId;
    const t = payload.token || '';
    const b = id && battles[id];
    if (!b) return socket.emit('authError', { error: 'not_found' });

    ensureOtps(b);
    if (t && t !== b.otps.admin.token) return socket.emit('authError', { error: 'otp_mismatch' });

    socket.join(`battle-${b.id}`);
    socket.emit('authSuccess', { role: 'admin', battle: b });
  });

  // 플레이어 인증(선택)
  socket.on('playerAuth', (payload = {}) => {
    const id = payload.battleId;
    const t = payload.token || '';
    const b = id && battles[id];
    if (!b) return socket.emit('authError', { error: 'not_found' });
    ensureOtps(b);
    if (t && t !== b.otps.player.token) return socket.emit('authError', { error: 'otp_mismatch' });
    socket.join(`battle-${b.id}`);
    socket.emit('authSuccess', { role: 'player', battle: b });
  });

  // 관전자 인증(선택)
  socket.on('spectatorAuth', (payload = {}) => {
    const id = payload.battleId;
    const t = payload.token || '';
    const b = id && battles[id];
    if (!b) return socket.emit('authError', { error: 'not_found' });
    ensureOtps(b);
    if (t && t !== b.otps.spectator.token) return socket.emit('authError', { error: 'otp_mismatch' });
    socket.join(`battle-${b.id}`);
    socket.emit('authSuccess', { role: 'spectator', battle: b });
  });

  // 상태 요청
  socket.on('admin:requestState', (payload = {}) => {
    const id = payload.battleId;
    const b = id && battles[id];
    if (b) io.to(socket.id).emit('battleUpdate', b);
  });

  // 링크 생성 폴백(환경에 따라 정적 URL이 필요할 때)
  socket.on('admin:generateLinks', (payload = {}, ack) => {
    const id = payload.battleId;
    const b = id && battles[id];
    if (!b) return ack && ack({ ok: false, error: 'not_found' });
    ensureOtps(b);
    const base = PUBLIC_BASE_URL || '';
    const adminUrl = base ? `${base}/admin?battle=${b.id}&token=${b.otps.admin.token}` : '';
    const playerUrl = base ? `${base}/play?battle=${b.id}&token=${b.otps.player.token}` : '';
    const spectatorUrl = base ? `${base}/watch?battle=${b.id}&token=${b.otps.spectator.token}` : '';
    ack && ack({ ok: true, adminUrl, playerUrl, spectatorUrl });
  });

  // 전투 시작(WS 경로)
  socket.on('battle:start', (payload = {}, ack) => {
    const id = payload.battleId;
    const b = id && battles[id];
    if (!b) return ack && ack({ success: false, error: 'not_found' });
    b.status = 'live';
    addLog(b, 'system', 'Battle started (ws)');
    io.to(`battle-${b.id}`).emit('battleUpdate', b);
    ack && ack({ success: true });
  });

  // 관리자 명령(WS 폴백)
  socket.on('admin:command', (payload = {}, ack) => {
    const id = payload.battleId;
    const b = id && battles[id];
    if (!b) return ack && ack({ success: false, error: 'not_found' });
    const { action, playerIds, value } = payload;
    if (!Array.isArray(playerIds) || !Number.isFinite(value)) {
      return ack && ack({ success: false, error: 'bad_request' });
    }
    for (const p of b.players) {
      if (!playerIds.includes(p.id)) continue;
      if (action === 'heal_partial') p.hp = Math.min(p.maxHp || 100, (p.hp || 100) + Math.max(0, value));
      else if (action === 'damage') p.hp = Math.max(0, (p.hp || 100) - Math.max(0, value));
    }
    addLog(b, 'system', `Admin command(ws): ${action} ${value}`);
    io.to(`battle-${b.id}`).emit('battleUpdate', b);
    ack && ack({ success: true });
  });

  // 채팅
  socket.on('chatMessage', (msg = {}) => {
    const id = msg.battleId;
    const b = id && battles[id];
    if (!b) return;
    const sender = msg.role || 'channel';
    const message = String(msg.message || '');
    addLog(b, 'chat', `${sender}: ${message}`);
    io.to(`battle-${b.id}`).emit('chatMessage', { sender, message, t: now() });
  });
});

// ----------------------------------------------------------------------------
/* Start */
// ----------------------------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log('=================================================================');
  console.log(`API Health : http://${HOST}:${PORT}/api/health`);
  console.log('=================================================================');
  console.log(`[${new Date().toISOString()}] [INFO] PYXIS server started on ${HOST}:${PORT} (${process.env.NODE_ENV || 'development'})`);
});
