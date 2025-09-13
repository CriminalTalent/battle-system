// packages/battle-server/index.js - PYXIS Battle Server (ESM)
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

import uploadRouter from './src/routes/avatar-upload.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';
const HOST = process.env.HOST || '0.0.0.0';

// Express 앱 먼저 생성
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// -----------------------------
// In-memory state
// -----------------------------
const battles = new Map();
const otpStore = new Map();

// -----------------------------
// Helpers
// -----------------------------
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
function createBattleState(id, mode = '2v2') {
  return {
    id,
    mode,
    status: 'waiting',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    players: [],
    currentTurn: 0,
    currentPlayer: null,
    leadingTeam: null, // 'A' | 'B'
    effects: [],
    logs: [],
    options: {
      timeLimit: 60 * 60 * 1000, // 1h
      turnTimeout: 5 * 60 * 1000, // 5m
      maxPlayers: parseInt(mode, 10) ? parseInt(mode, 10) * 2 : parseInt(mode[0], 10) * 2,
    },
  };
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
  b.logs.push(entry);
  if (b.logs.length > 1000) b.logs = b.logs.slice(-500);
  io.to(battleId).emit('battle:log', entry);
}

// -----------------------------
// Middleware & static
// -----------------------------
app.set('trust proxy', true);
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// uploads
app.use('/api/upload', uploadRouter);

// -----------------------------
// Routes
// -----------------------------

// 루트 경로를 admin.html로 연결
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// API
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'PYXIS Battle System',
    uptime: Math.floor(process.uptime()),
    battles: battles.size,
    timestamp: Date.now(),
  }),
);

app.post('/api/battles', (req, res) => {
  try {
    const { mode = '2v2', options = {} } = req.body || {};
    if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'Invalid mode' });
    }

    const battleId = generateId();
    const battle = createBattleState(battleId, mode);
    battles.set(battleId, battle);

    console.log(`Battle created: ${battleId} (${mode})`);
    res.json({ ok: true, battleId, battle });
  } catch (e) {
    console.error('Battle creation error:', e);
    res.status(500).json({ ok: false, error: 'Creation failed' });
  }
});

app.post('/api/battles/:id/players', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'Battle not found' });

    const { name, team = 'A', stats, items = {}, avatar } = req.body;
    if (!name || !validateStats(stats)) {
      return res.status(400).json({ ok: false, error: 'Invalid player data' });
    }

    const playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const player = {
      id: playerId,
      name: String(name).trim(),
      team: team === 'B' ? 'B' : 'A',
      hp: 100,
      maxHp: 100,
      stats: {
        attack: Math.max(1, Math.min(5, parseInt(stats.attack) || 3)),
        defense: Math.max(1, Math.min(5, parseInt(stats.defense) || 3)),
        agility: Math.max(1, Math.min(5, parseInt(stats.agility) || 3)),
        luck: Math.max(1, Math.min(5, parseInt(stats.luck) || 2)),
      },
      items: {
        dittany: Math.max(0, parseInt(items.dittany) || 0),
        attack_boost: Math.max(0, parseInt(items.attackBooster || items.attack_boost) || 0),
        defense_boost: Math.max(0, parseInt(items.defenseBooster || items.defense_boost) || 0),
      },
      avatar: avatar || null,
      ready: false,
      joinedAt: Date.now(),
    };

    battle.players.push(player);
    console.log(`Player added: ${name} (${playerId}) to team ${player.team}`);
    
    emitBattleUpdate(battleId);
    res.json({ ok: true, player });
  } catch (e) {
    console.error('Player addition error:', e);
    res.status(500).json({ ok: false, error: 'Addition failed' });
  }
});

// Admin links API
app.post('/api/admin/battles/:id/links', (req, res) => {
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
      const tok = generateOTP(6);
      const otpKey = `player_${battleId}_${player.id}`;
      otpStore.set(otpKey, {
        otp: tok,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      
      const playerUrl = `${base}/player.html?battle=${battleId}&password=${tok}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;
        
      links.push({ 
        id: index + 1, 
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl
      });
      
      console.log(`Created link for player ${player.name} (${player.id}): ${playerUrl}`);
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

// Alternative links API
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
      const tok = generateOTP(6);
      const otpKey = `player_${battleId}_${player.id}`;
      otpStore.set(otpKey, {
        otp: tok,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      
      const playerUrl = `${base}/player.html?battle=${battleId}&password=${tok}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;
      
      links.push({ 
        id: index + 1, 
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl
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

// -----------------------------
// Socket.IO
// -----------------------------
io.on('connection', (socket) => {
  console.log('[SOCKET] Connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected:', socket.id);
  });

  // Join battle room
  socket.on('join', ({ battleId }) => {
    if (battleId) {
      socket.join(battleId);
    }
  });

  // Add player (from socket)
  socket.on('addPlayer', ({ battleId, player }, callback) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) {
        return callback({ error: 'Battle not found' });
      }

      if (!player.name || !validateStats(player.stats)) {
        return callback({ error: 'Invalid player data' });
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
      callback({ ok: true, player: newPlayer });
    } catch (e) {
      console.error('Socket player addition error:', e);
      callback({ error: 'Addition failed' });
    }
  });

  // Basic socket events for battle management
  socket.on('createBattle', ({ mode = '2v2' }, callback) => {
    try {
      if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
        return callback({ error: 'Invalid mode' });
      }

      const battleId = generateId();
      const battle = createBattleState(battleId, mode);
      battles.set(battleId, battle);

      socket.join(battleId);
      console.log(`Battle created via socket: ${battleId} (${mode})`);
      callback({ ok: true, battleId, battle });
    } catch (e) {
      console.error('Socket battle creation error:', e);
      callback({ error: 'Creation failed' });
    }
  });
});

// -----------------------------
// Error handling
// -----------------------------
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// -----------------------------
// Server start
// -----------------------------
server.listen(PORT, HOST, () => {
  console.log(`
 ______   __  __  __   __  ______  ______       
/\\  == \\ /\\ \\_\\ \\/\\ \\ / /\\  ___\\/\\  ___\\      
\\ \\  __/ \\ \\____ \\ \\ \\'/\\ \\___  \\ \\___  \\     
 \\ \\_\\ \\_\\\\/\\_____\\\\ \\__| \\/\\_____\\/\\_____\\    
  \\/_/ /_/ \\/_____/ \\/_/   \\/_____/\\/_____/    
                                               
 PYXIS Battle System v1.0
 
 Server: http://${HOST}:${PORT}
 Socket: ${SOCKET_PATH}
 Static: ${publicDir}
 Uploads: ${uploadsDir}
 Ready for battle!
`);
});
