// packages/battle-server/index.js - PYXIS Battle Server (플레이어 인증 & 관리자 제어 포함)
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';
const HOST = process.env.HOST || '0.0.0.0';

// Express & Socket.IO
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
});

// In-memory stores
const battles = new Map();   // battleId -> battle
const otpStore = new Map();  // keys like spectator_<battleId>, player_<battleId>_<playerId>

// Helpers
function generateId() {
  return 'battle_' + Math.random().toString(36).slice(2, 10);
}

function generateOTP(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let r = '';
  for (let i = 0; i < length; i++) r += chars[(Math.random() * chars.length) | 0];
  return r;
}

function validateStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const { attack, defense, agility, luck } = stats;
  return [attack, defense, agility, luck].every(n => Number.isInteger(n) && n >= 1 && n <= 5);
}

function emitBattleUpdate(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  io.to(battleId).emit('battleUpdate', battle);
  io.to(battleId).emit('battle:update', battle);
}

function pushLog(battleId, type, message, data = {}) {
  const b = battles.get(battleId);
  if (!b) return;
  const entry = { timestamp: Date.now(), type, message, data };
  b.logs = b.logs || [];
  b.logs.push(entry);
  if (b.logs.length > 1000) b.logs = b.logs.slice(-500);
  io.to(battleId).emit('battle:log', entry);
}

// Middleware
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Uploads
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Root -> admin.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

// Create battle (HTTP)
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '2v2' } = req.body || {};
    if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'Invalid mode' });
    }
    const battleId = generateId();
    const battle = {
      id: battleId,
      mode,
      status: 'waiting',
      createdAt: Date.now(),
      players: [],
      logs: [],
    };
    battles.set(battleId, battle);

    console.log(`Battle created: ${battleId} (${mode})`);
    res.json({ ok: true, battleId, battle });
  } catch (e) {
    console.error('Battle creation error:', e);
    res.status(500).json({ ok: false, error: 'Creation failed' });
  }
});

// Links (admin)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);

    // Store spectator OTP
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      battleId,
      role: 'spectator',
      expires: Date.now() + 30 * 60 * 1000,
    });

    const links = [];
    const players = battle.players || [];

    players.forEach((player, index) => {
      const playerToken = generateOTP(6);
      const otpKey = `player_${battleId}_${player.id}`;

      // Store player OTP
      otpStore.set(otpKey, {
        otp: playerToken,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });

      // Auto-login URL for players
      const playerUrl = `${base}/player.html?battle=${battleId}&password=${playerToken}&token=${playerToken}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;

      links.push({
        id: index + 1,
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl,
      });

      console.log(`Created auto-login link: ${playerUrl}`);
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${battleId}&otp=${spectatorOtp}`,
      playerLinks: links,
    });
  } catch (e) {
    console.error('Link creation error:', e);
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// Links (fallback)
app.post('/api/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);

    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      battleId,
      role: 'spectator',
      expires: Date.now() + 30 * 60 * 1000,
    });

    const links = [];
    const players = battle.players || [];

    players.forEach((player, index) => {
      const playerToken = generateOTP(6);
      const otpKey = `player_${battleId}_${player.id}`;

      otpStore.set(otpKey, {
        otp: playerToken,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });

      const playerUrl = `${base}/player.html?battle=${battleId}&password=${playerToken}&token=${playerToken}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;

      links.push({
        id: index + 1,
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl,
      });
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${battleId}&otp=${spectatorOtp}`,
      playerLinks: links,
    });
  } catch (e) {
    console.error('Link creation error:', e);
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// Socket events
io.on('connection', (socket) => {
  console.log('[SOCKET] Connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected:', socket.id);
  });

  // ---- Battle creation (socket) ----
  socket.on('createBattle', ({ mode = '2v2' }, callback) => {
    try {
      if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
        return callback?.({ error: 'Invalid mode' });
      }
      const battleId = generateId();
      const battle = {
        id: battleId,
        mode,
        status: 'waiting',
        createdAt: Date.now(),
        players: [],
        logs: [],
      };
      battles.set(battleId, battle);

      socket.join(battleId);
      console.log(`Battle created: ${battleId} (${mode})`);
      callback?.({ ok: true, battleId, battle });
    } catch (e) {
      console.error('Socket battle creation error:', e);
      callback?.({ error: 'Creation failed' });
    }
  });

  // ---- Add player ----
  socket.on('addPlayer', ({ battleId, player }, callback) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) return callback?.({ error: 'Battle not found' });

      if (!player?.name || !validateStats(player.stats)) {
        return callback?.({ error: 'Invalid player data' });
      }

      const playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newPlayer = {
        id: playerId,
        name: String(player.name).trim(),
        team: player.team === 'B' ? 'B' : 'A',
        hp: 100,
        maxHp: 100,
        stats: {
          attack: Math.max(1, Math.min(5, parseInt(player.stats.attack) || 3)),
          defense: Math.max(1, Math.min(5, parseInt(player.stats.defense) || 3)),
          agility: Math.max(1, Math.min(5, parseInt(player.stats.agility) || 3)),
          luck: Math.max(1, Math.min(5, parseInt(player.stats.luck) || 2)),
        },
        items: {
          // 내부 표준 키: dittany / attack_boost / defense_boost
          dittany: Math.max(0, parseInt(player.items?.dittany || player.items?.ditany) || 0),
          attack_boost: Math.max(0, parseInt(player.items?.attackBooster || player.items?.attack_boost) || 0),
          defense_boost: Math.max(0, parseInt(player.items?.defenseBooster || player.items?.defense_boost) || 0),
        },
        avatar: player.avatar || null,
        ready: false,
        joinedAt: Date.now(),
      };

      battle.players.push(newPlayer);
      console.log(`Player added: ${newPlayer.name} (${playerId}) to team ${newPlayer.team}`);

      emitBattleUpdate(battleId);
      callback?.({ ok: true, player: newPlayer });
    } catch (e) {
      console.error('Socket player addition error:', e);
      callback?.({ error: 'Addition failed' });
    }
  });

  // ---- Player auth (auto-login) ----
  socket.on('playerAuth', ({ battleId, password, token, otp }, callback) => {
    try {
      console.log(`[AUTH] Player auth: battleId=${battleId}, token=${password || token || otp}`);

      const battle = battles.get(battleId);
      if (!battle) {
        const err = { ok: false, error: 'battle_not_found', message: '전투를 찾을 수 없습니다.' };
        callback?.(err);
        socket.emit('authError', err);
        return;
      }

      const authToken = password || token || otp;
      let otpRecord = null;

      for (const [key, record] of otpStore.entries()) {
        if (key.startsWith(`player_${battleId}`) && record.otp === authToken) {
          if (record.expires && Date.now() > record.expires) {
            otpStore.delete(key);
            continue;
          }
          otpRecord = record;
          break;
        }
      }

      if (!otpRecord) {
        const err = { ok: false, error: 'invalid_token', message: '잘못된 비밀번호입니다.' };
        callback?.(err);
        socket.emit('authError', err);
        return;
      }

      const player = battle.players.find(p => p.id === otpRecord.playerId);
      if (!player) {
        const err = { ok: false, error: 'player_not_found', message: '플레이어를 찾을 수 없습니다.' };
        callback?.(err);
        socket.emit('authError', err);
        return;
      }

      socket.join(battleId);
      socket.battleId = battleId;
      socket.playerId = player.id;
      socket.role = 'player';

      const result = {
        ok: true,
        playerId: player.id,
        playerData: player,
        battle,
        message: '인증 성공! 전투에 참가했습니다.',
      };

      console.log(`[AUTH] Player authenticated: ${player.name} (${player.id})`);
      callback?.(result);
      socket.emit('authSuccess', result);
      socket.emit('auth:success', result);

      pushLog(battleId, 'system', `${player.name}님이 접속했습니다.`);
    } catch (e) {
      console.error('[AUTH] Player auth error:', e);
      const err = { ok: false, error: 'auth_failed', message: '인증 중 오류가 발생했습니다.' };
      callback?.(err);
      socket.emit('authError', err);
    }
  });

  // Compatibility alias
  socket.on('player:auth', (...args) => socket.emit('playerAuth', ...args));

  // ---- Room join & snapshot ----
  socket.on('join', ({ battleId }) => {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('battleError', { error: 'battle_not_found' });
      return;
    }
    socket.join(battleId);
    socket.emit('battleUpdate', battle);
    socket.emit('battle:update', battle);
  });

  socket.on('getBattle', ({ battleId }, cb) => {
    const battle = battles.get(battleId);
    if (battle) {
      cb?.({ ok: true, battle });
      socket.emit('battleUpdate', battle);
      socket.emit('battle:update', battle);
    } else {
      cb?.({ ok: false, error: 'battle_not_found' });
    }
  });

  // ---- Admin auth (lightweight: accept & join room) ----
  socket.on('adminAuth', ({ battleId, otp, token }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) {
      const err = { ok: false, error: 'battle_not_found' };
      cb?.(err);
      socket.emit('authError', err);
      return;
    }
    // (원하면 otp/token 검증 로직 추가)
    socket.join(battleId);
    socket.role = 'admin';
    cb?.({ ok: true });
    socket.emit('authSuccess', { ok: true, role: 'admin' });
  });

  // ---- Battle status controls ----
  function setBattleStatus(battleId, status) {
    const b = battles.get(battleId);
    if (!b) return false;
    b.status = status;
    emitBattleUpdate(battleId);
    return true;
  }

  socket.on('startBattle', ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    if (b.status === 'ended') return;
    b.status = 'active';
    b.turn = b.turn || { round: 1, order: ['A', 'B'], currentTeam: 'A', playerActions: {} };
    pushLog(battleId, 'system', '전투가 시작되었습니다.');
    emitBattleUpdate(battleId);
  });

  socket.on('pauseBattle', ({ battleId }) => {
    if (setBattleStatus(battleId, 'paused')) {
      pushLog(battleId, 'system', '전투가 일시정지되었습니다.');
    }
  });

  socket.on('resumeBattle', ({ battleId }) => {
    if (setBattleStatus(battleId, 'active')) {
      pushLog(battleId, 'system', '전투가 재개되었습니다.');
    }
  });

  socket.on('endBattle', ({ battleId }) => {
    if (setBattleStatus(battleId, 'ended')) {
      pushLog(battleId, 'system', '전투가 종료되었습니다.');
    }
  });

  // ---- Simple chat passthrough (optional) ----
  socket.on('chatMessage', (payload) => {
    const { battleId, message, name = '익명', role = 'user' } = payload || {};
    if (!battleId || !message) return;
    io.to(battleId).emit('chatMessage', { message, name, role, ts: Date.now() });
  });
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`
PYXIS Battle System

Server: http://${HOST}:${PORT}
Socket: ${SOCKET_PATH}
Static: ${publicDir}
Uploads: ${uploadsDir}
Ready for battle!
`);
});
