// packages/battle-server/src/server.js
'use strict';

/**
 * Pyxis Battle Server (Express + Socket.IO)
 * - .env 지원 (PORT, HOST, PUBLIC_BASE_URL, CORS_ORIGIN, MAX_FILE_SIZE)
 * - Nginx 프록시 호환 (app.set('trust proxy', true), socket path '/socket.io/')
 * - API/소켓 계약: 기존 엔진(BattleEngine)과 100% 호환
 */

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const BattleEngine = require('./services/BattleEngine');

// ───────────────────────────────────────────────────────────
// Env
// ───────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_FILE_SIZE = (process.env.MAX_FILE_SIZE || '5mb').toLowerCase().replace('mb', 'mb'); // normalize

// ───────────────────────────────────────────────────────────
// App / Server / Socket.IO
// ───────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true); // Behind Nginx/Proxy → trust X-Forwarded-Proto/Host

// CORS: '*'면 간단 허용, 그 외엔 화이트리스트 + credentials
const corsMiddleware =
  CORS_ORIGIN === '*'
    ? cors()
    : cors({
        origin: CORS_ORIGIN.split(',').map((s) => s.trim()),
        credentials: true,
      });

app.use(corsMiddleware);
app.use(express.json({ limit: MAX_FILE_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_FILE_SIZE }));
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors:
    CORS_ORIGIN === '*'
      ? { origin: true, methods: ['GET', 'POST'] }
      : { origin: CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
});

// ───────────────────────────────────────────────────────────
// Engine & helpers
// ───────────────────────────────────────────────────────────
const engine = new BattleEngine();

function baseUrlFromReq(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.get('host');
  return `${proto}://${host}`;
}

function broadcast(battleId) {
  const b = engine.getBattle(battleId);
  if (b) io.to(battleId).emit('battleUpdate', b);
}

// ───────────────────────────────────────────────────────────
// Health
// ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: engine.getBattleCount() });
});

// ───────────────────────────────────────────────────────────
// Battles CRUD (minimal)
// ───────────────────────────────────────────────────────────

// Create battle
// body: { mode?: "1v1"|"2v2"|"3v3"|"4v4", adminId?: string }
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);
    return res.status(201).json(battle);
  } catch (e) {
    console.error('[POST /api/battles] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Get battle
app.get('/api/battles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const battle = engine.getBattle(id);
    if (!battle) return res.status(404).json({ error: 'battle_not_found', id });
    return res.json(battle);
  } catch (e) {
    console.error('[GET /api/battles/:id] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Join (player)
// body: { name, team: "team1"|"team2", stats?, inventory?, imageUrl? }
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const { name, team, stats, inventory, imageUrl } = req.body || {};
    const player = engine.addPlayer(id, { name, team, stats, inventory, imageUrl });

    return res.status(201).json({
      ok: true,
      success: true,
      battleId: id,
      player,
    });
  } catch (e) {
    console.error('[POST /api/battles/:id/players] error', e);
    return res.status(400).json({ ok: false, success: false, error: e.message || 'bad_request' });
  }
});

// ───────────────────────────────────────────────────────────
// Admin: links / start / end
// ───────────────────────────────────────────────────────────

app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin;
    const playerOtp = b.otps?.player ?? (Array.isArray(b.otps?.players) ? b.otps.players[0] : undefined);
    const spectOtp = b.otps?.spectator ?? b.otps?.spectators;

    return res.json({
      id,
      otps: b.otps,
      urls: {
        admin: `${baseUrl}/admin?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(adminOtp || '')}`,
        player: `${baseUrl}/play?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(playerOtp || '')}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(spectOtp || '')}`,
      },
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.startBattle(id);
    broadcast(id);
    return res.json({ ok: true, success: true, battle: b });
  } catch (e) {
    if (String(e.message || '').includes('전투 없음'))
      return res.status(404).json({ ok: false, error: 'battle_not_found' });
    return res.status(400).json({ ok: false, error: e.message || 'bad_request' });
  }
});

app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    engine.endBattle(id, null, '관리자 종료');
    broadcast(id);
    return res.json({ ok: true, success: true, ended: id });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/end] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ───────────────────────────────────────────────────────────
// Socket.IO
// ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.spectatorName = null;

  // Admin auth
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = engine.adminAuth(battleId, otp);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);
      socket.join(`${battleId}-admin`);
      socket.role = 'admin';
      socket.battleId = battleId;
      socket.emit('authSuccess', { role: 'admin', battle: result.battle });
    } catch (e) {
      console.error('[socket adminAuth] error', e);
      socket.emit('authError', 'internal_error');
    }
  });

  // Player auth
  // payload: { battleId, otp, playerId }
  socket.on('playerAuth', ({ battleId, otp, playerId }) => {
    try {
      const result = engine.playerAuth(battleId, otp, playerId);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);
      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = playerId;
      engine.updatePlayerConnection?.(battleId, playerId, true);
      socket.emit('authSuccess', { role: 'player', battle: result.battle, player: result.player });
      broadcast(battleId);
    } catch (e) {
      console.error('[socket playerAuth] error', e);
      socket.emit('authError', 'internal_error');
    }
  });

  // Spectator auth
  // payload: { battleId, otp, spectatorName }
  socket.on('spectatorAuth', ({ battleId, otp, spectatorName }) => {
    try {
      const result = engine.spectatorAuth(battleId, otp, spectatorName || '관전자');
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);
      socket.role = 'spectator';
      socket.battleId = battleId;
      socket.spectatorName = spectatorName || '관전자';
      socket.emit('authSuccess', { role: 'spectator', battle: result.battle });
    } catch (e) {
      console.error('[socket spectatorAuth] error', e);
      socket.emit('authError', 'internal_error');
    }
  });

  // Player action
  // payload: { battleId, playerId, action: { type, ... } }
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
  socket.on('chatMessage', ({ message }) => {
    if (!socket.battleId || !message) return;
    let sender = '알 수 없음';
    if (socket.role === 'player') {
      const b = engine.getBattle(socket.battleId);
      const p = b && engine.findPlayer(b, socket.playerId);
      sender = p ? p.name : '플레이어';
    } else if (socket.role === 'spectator') {
      sender = socket.spectatorName || '관전자';
    } else if (socket.role === 'admin') {
      sender = '관리자';
    }
    engine.addChatMessage(socket.battleId, sender, message, socket.role || 'system');
    broadcast(socket.battleId);
  });

  // Cheer (spectators only, allowlist)
  socket.on('cheerMessage', ({ message }) => {
    if (!socket.battleId || socket.role !== 'spectator') return;
    const allowed = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
    engine.addChatMessage(socket.battleId, socket.spectatorName || '관전자', message, 'spectator');
    broadcast(socket.battleId);
  });

  socket.on('adminMessage', ({ battleId, message }) => {
    if (socket.role !== 'admin') return;
    io.to(`${battleId}-admin`).emit('adminBroadcast', { message, at: Date.now() });
  });

  socket.on('disconnect', () => {
    try {
      if (socket.role === 'player' && socket.battleId && socket.playerId) {
        engine.updatePlayerConnection?.(socket.battleId, socket.playerId, false);
        broadcast(socket.battleId);
      }
    } catch (_) {}
  });
});

// ───────────────────────────────────────────────────────────
// Server start
// ───────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`Battle server listening on http://${HOST}:${PORT}`);
  console.log(`관리자 페이지(정적): http://${HOST}:${PORT}/admin.html`);
});
