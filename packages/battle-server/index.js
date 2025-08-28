// packages/battle-server/index.js
// Express + Socket.IO battle server (single entry)
// - Fixed team names: "불사조 기사단" / "죽음을 먹는 자들"
// - Admin can build roster with stats/items and copy per-player join links
// - Player can auth by (battleId + player OTP + name) => server matches player by name
// - Spectator OTP + free name
// - File upload endpoint for player avatar (local file -> URL)
// - Team chat channel support ("all" / "team")

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Server } = require('socket.io');

const BattleEngine = require('./src/services/BattleEngine');

// ──────────────────────────────────────────────────────────────
// ENV
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

// ──────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') },
  path: '/socket.io/',
});

const engine = new BattleEngine();

// ──────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Static
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// File uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    cb(null, `avatar-${base}${ext || '.png'}`);
  },
});
const upload = multer({ storage });

// Pretty routes
app.get('/', (_req, res) => res.redirect('/admin'));
app.get(['/admin', '/play', '/watch'], (req, res) => {
  const page = (req.path.replace('/', '') || 'admin') + '.html';
  res.sendFile(path.join(publicDir, page));
});

// Utils
function baseUrlFromReq(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host');
  return `${proto}://${host}`;
}
function broadcast(battleId) {
  const b = engine.getBattle(battleId);
  if (b) io.to(battleId).emit('battleUpdate', b);
}

// ──────────────────────────────────────────────────────────────
// Health
// ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    battles: engine.getBattleCount(),
    connections: io.engine.clientsCount,
  });
});

// ──────────────────────────────────────────────────────────────
// Battles
// ──────────────────────────────────────────────────────────────
app.get('/api/battles', (_req, res) => {
  try {
    const rows = [];
    for (const [, b] of engine.battles) {
      rows.push({
        id: b.id,
        mode: b.mode,
        status: b.status,
        playerCount:
          (b.teams?.team1?.players?.length || 0) +
          (b.teams?.team2?.players?.length || 0),
        createdAt: b.createdAt,
      });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ battles: rows });
  } catch (e) {
    console.error('[GET /api/battles] error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = battle.otps?.admin || '';
    const playerOtp = battle.otps?.player || '';
    const spectatorOtp = battle.otps?.spectator || '';

    return res.status(201).json({
      battle,
      urls: {
        admin: `${baseUrl}/admin?battle=${encodeURIComponent(
          battle.id
        )}&token=${encodeURIComponent(adminOtp)}`,
        player: `${baseUrl}/play?battle=${encodeURIComponent(
          battle.id
        )}&token=${encodeURIComponent(playerOtp)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(
          battle.id
        )}&token=${encodeURIComponent(spectatorOtp)}`,
      },
    });
  } catch (e) {
    console.error('[POST /api/battles] error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/battles/:id', (req, res) => {
  try {
    const b = engine.getBattle(req.params.id);
    if (!b) return res.status(404).json({ error: 'battle_not_found' });
    res.json(b);
  } catch (e) {
    console.error('[GET /api/battles/:id] error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const { name, team, stats, inventory = [], imageUrl = '' } = req.body || {};
    const player = engine.addPlayer(id, { name, team, stats, inventory, imageUrl });
    broadcast(id);
    res.status(201).json({ ok: true, success: true, battleId: id, player });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'bad_request' });
  }
});

app.delete('/api/battles/:id/players/:playerId', (req, res) => {
  try {
    const { id, playerId } = req.params;
    const result = engine.removePlayer(id, playerId);
    if (result.success) {
      broadcast(id);
      res.json({ ok: true, success: true });
    } else {
      res.status(404).json({ ok: false, error: result.message || 'not_found' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Update player's avatar after auth
app.patch('/api/battles/:id/players/:playerId/avatar', (req, res) => {
  try {
    const { id, playerId } = req.params;
    const { imageUrl } = req.body || {};
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ ok: false, error: 'battle_not_found' });
    const p = engine.findPlayer(b, playerId);
    if (!p) return res.status(404).json({ ok: false, error: 'player_not_found' });
    p.imageUrl = imageUrl || '';
    engine.addBattleLog(id, 'system', `${p.name} 아바타 업데이트`);
    broadcast(id);
    res.json({ ok: true, player: p });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Upload avatar file
app.post('/api/uploads/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
});

// Admin helpers
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found' });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin || '';
    const playerOtp = b.otps?.player || '';
    const spectatorOtp = b.otps?.spectator || '';

    const players = [
      ...(b.teams?.team1?.players || []),
      ...(b.teams?.team2?.players || []),
    ];
    const playerLinks = players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      url: `${baseUrl}/play?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(
        playerOtp
      )}&name=${encodeURIComponent(p.name)}&pid=${encodeURIComponent(p.id)}`,
    }));

    res.json({
      id,
      otps: b.otps,
      urls: {
        admin: `${baseUrl}/admin?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(adminOtp)}`,
        player: `${baseUrl}/play?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(playerOtp)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(spectatorOtp)}`,
      },
      playerLinks,
    });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const b = engine.startBattle(req.params.id);
    broadcast(req.params.id);
    res.json({ ok: true, battle: b });
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('전투 없음')) return res.status(404).json({ ok: false, error: 'battle_not_found' });
    res.status(400).json({ ok: false, error: msg || 'bad_request' });
  }
});

app.post('/api/admin/battles/:id/pause', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ ok: false, error: 'battle_not_found' });
    if (b.status === 'ongoing') {
      b.status = 'paused';
      engine.addBattleLog(id, 'system', '전투 일시정지');
    } else if (b.status === 'paused') {
      b.status = 'ongoing';
      engine.addBattleLog(id, 'system', '전투 재개');
    } else {
      return res.status(400).json({ ok: false, error: `cannot_pause_from_${b.status}` });
    }
    broadcast(id);
    res.json({ ok: true, battle: b });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ ok: false, error: 'battle_not_found' });
    engine.endBattle(id, null, '관리자 종료');
    broadcast(id);
    res.json({ ok: true, ended: id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ──────────────────────────────────────────────────────────────
// Socket.IO
// ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.playerTeam = null;
  socket.spectatorName = null;

  const roomAll = (id) => id;
  const roomAdmin = (id) => `${id}-admin`;
  const roomTeam = (id, team) => `${id}-team-${team}`;

  // Admin auth
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = engine.adminAuth(battleId, otp);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      socket.join(roomAll(battleId));
      socket.join(roomAdmin(battleId));
      socket.join(roomTeam(battleId, 'team1'));
      socket.join(roomTeam(battleId, 'team2'));

      socket.role = 'admin';
      socket.battleId = battleId;
      socket.emit('authSuccess', { role: 'admin', battle: result.battle });
    } catch (e) {
      socket.emit('authError', 'internal_error');
    }
  });

  // Player auth (by id or by name)
  socket.on('playerAuth', ({ battleId, otp, playerId, playerName }) => {
    try {
      let result;
      if (playerId) result = engine.playerAuth(battleId, otp, playerId);
      else if (playerName) result = engine.playerAuthByName(battleId, otp, playerName);
      else return socket.emit('authError', '플레이어 ID 또는 이름이 필요합니다');

      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      const player = result.player;
      socket.join(roomAll(battleId));
      socket.join(roomTeam(battleId, player.team));

      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = player.id;
      socket.playerTeam = player.team;

      socket.emit('authSuccess', { role: 'player', battle: result.battle, player });
      broadcast(battleId);
    } catch (e) {
      socket.emit('authError', 'internal_error');
    }
  });

  // Spectator auth
  socket.on('spectatorAuth', ({ battleId, otp, spectatorName }) => {
    try {
      const result = engine.spectatorAuth(battleId, otp, spectatorName || '관전자');
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      socket.join(roomAll(battleId));

      socket.role = 'spectator';
      socket.battleId = battleId;
      socket.spectatorName = spectatorName || '관전자';
      socket.emit('authSuccess', { role: 'spectator', battle: result.battle });
    } catch (e) {
      socket.emit('authError', 'internal_error');
    }
  });

  // Player action
  socket.on('playerAction', ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      broadcast(battleId);
      socket.emit('actionSuccess');
    } catch (e) {
      socket.emit('actionError', e.message || 'action_failed');
    }
  });

  // Chat (all roles)
  socket.on('chatMessage', ({ message, channel }) => {
    try {
      if (!socket.battleId || !message) return;
      const bId = socket.battleId;
      const chan = channel === 'team' ? 'team' : 'all';

      let sender = '알 수 없음';
      let senderType = socket.role || 'system';

      if (socket.role === 'player') {
        const b = engine.getBattle(bId);
        const p = b && engine.findPlayer(b, socket.playerId);
        sender = p ? p.name : '플레이어';
      } else if (socket.role === 'spectator') {
        sender = socket.spectatorName || '관전자';
      } else if (socket.role === 'admin') {
        sender = '관리자';
      }

      const entry = {
        sender,
        senderType,
        message,
        channel: chan,
        team: chan === 'team' ? socket.playerTeam : null,
        timestamp: Date.now(),
      };
      engine.addChatMessage(bId, entry);

      const payload = {
        sender: entry.sender,
        senderType: entry.senderType,
        message: entry.message,
        channel: entry.channel,
        timestamp: entry.timestamp,
        team: entry.team || null,
      };

      if (chan === 'team' && socket.role === 'player' && socket.playerTeam) {
        io.to(roomTeam(bId, socket.playerTeam)).emit('chatMessage', payload);
        io.to(roomAdmin(bId)).emit('chatMessage', payload);
      } else {
        io.to(roomAll(bId)).emit('chatMessage', payload);
      }
      broadcast(bId);
    } catch (e) {
      socket.emit('chatError', 'internal_error');
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.role === 'player' && socket.battleId && socket.playerId) {
        const b = engine.getBattle(socket.battleId);
        if (b) {
          engine.addBattleLog(socket.battleId, 'system', `${socket.playerId} 연결 해제`);
          broadcast(socket.battleId);
        }
      }
    } catch (_) {}
  });
});

// ──────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`Battle server listening on http://${HOST}:${PORT}`);
  console.log(`Static root: ${publicDir}`);
  console.log(`Access pages: /admin /play /watch`);
});