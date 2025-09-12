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
// API
// -----------------------------
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
      return res.status(400).json({ ok: false, error: 'invalid_mode' });
    }
    const battleId = generateId();
    const adminOtp = generateOTP(8);
    const battle = createBattleState(battleId, mode);
    battle.options = { ...battle.options, ...options };
    battles.set(battleId, battle);
    otpStore.set(`admin_${battleId}`, { otp: adminOtp, battleId, role: 'admin', expires: Date.now() + 60 * 60 * 1000 });
    res.json({
      ok: true,
      battleId,
      adminOtp,
      battle,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'creation_failed' });
  }
});

// 수정된 링크 생성 API
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
    
    if (players.length === 0) {
      // 플레이어가 없으면 빈 배열 반환
      console.log(`No players found for battle ${battleId}`);
    } else {
      // 실제 추가된 플레이어들에 대한 링크 생성
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
        
        const playerUrl = `${base}/player?battle=${battleId}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;
        
        links.push({ 
          id: index + 1, 
          playerId: player.id,
          playerName: player.name,
          team: player.team,
          url: playerUrl
        });
        
        console.log(`Created link for player ${player.name} (${player.id}): ${playerUrl}`);
      });
    }

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator?battle=${battleId}&token=${spectatorOtp}`,
      playerLinks: links,
    });
  } catch (e) {
    console.error('Link creation error:', e);
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// 대체 링크 생성 API
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
      
      links.push({ 
        id: index + 1, 
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: `${base}/player?battle=${battleId}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`
      });
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator?battle=${battleId}&token=${spectatorOtp}`,
      playerLinks: links,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// 전투 정보 조회 API
app.get('/api/battles/:id', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });
    
    res.json({
      ok: true,
      battle
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'fetch_failed' });
  }
});

// -----------------------------
// HTML routes
// -----------------------------
app.get('/admin', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(publicDir, 'player.html')));
app.get(['/spectator', '/watch'], (_req, res) => res.sendFile(path.join(publicDir, 'spectator.html')));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// -----------------------------
// Socket.IO
// -----------------------------
io.on('connection', (socket) => {
  console.log('[SOCKET] Connected:', socket.id);

  // join
  socket.on('join', ({ battleId }) => {
    const battle = battleId && battles.get(battleId);
    if (!battle) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit('battleUpdate', battle);
    socket.emit('battle:update', battle);
    pushLog(battleId, 'system', `클라이언트 접속: ${socket.id}`);
  });

  // ---- battle:create variants (모두 지원) ----
  const handleCreate = (payload, ack) => {
    try {
      const mode = (payload && payload.mode) || '2v2';
      if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
        const err = { ok: false, error: 'invalid_mode' };
        if (typeof ack === 'function') ack(err);
        return;
      }
      const battleId = generateId();
      const adminOtp = generateOTP(8);
      const battle = createBattleState(battleId, mode);
      battles.set(battleId, battle);

      otpStore.set(`admin_${battleId}`, { otp: adminOtp, battleId, role: 'admin', expires: Date.now() + 60 * 60 * 1000 });

      socket.join(battleId);
      socket.battleId = battleId;

      const result = { ok: true, battleId, adminOtp, battle };

      // 1) ack (페이지는 이걸로 state 세팅)
      if (typeof ack === 'function') ack(result);

      // 2) 이벤트는 "battle 객체" 그대로도 쏴줌(구 UI 호환)
      socket.emit('battle:created', battle);

      // 즉시 스냅샷도
      socket.emit('battleUpdate', battle);
      socket.emit('battle:update', battle);

      pushLog(battleId, 'system', `전투 생성 (${mode})`);
    } catch (e) {
      const err = { ok: false, error: 'creation_failed' };
      if (typeof ack === 'function') ack(err);
    }
  };

  socket.on('createBattle', handleCreate);
  socket.on('battle:create', handleCreate);
  socket.on('admin:createBattle', handleCreate);

  // add player
  socket.on('addPlayer', ({ battleId, player }, ack) => {
    try {
      const battle = battleId && battles.get(battleId);
      if (!battle) {
        const err = { ok: false, error: 'not_found' };
        if (typeof ack === 'function') ack(err);
        return;
      }
      if (!player?.name?.trim()) {
        const err = { ok: false, error: 'name_required' };
        if (typeof ack === 'function') ack(err);
        return;
      }
      if (!validateStats(player.stats || {})) {
        const err = { ok: false, error: 'invalid_stats' };
        if (typeof ack === 'function') ack(err);
        return;
      }
      if (battle.players.length >= (battle.options.maxPlayers || 2)) {
        const err = { ok: false, error: 'battle_full' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const np = {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: String(player.name).trim(),
        team: player.team === 'B' ? 'B' : 'A',
        hp: Math.max(1, Math.min(100, parseInt(player.hp) || 100)),
        maxHp: 100,
        stats: {
          attack: Math.max(1, Math.min(5, parseInt(player.stats.attack) || 3)),
          defense: Math.max(1, Math.min(5, parseInt(player.stats.defense) || 3)),
          agility: Math.max(1, Math.min(5, parseInt(player.stats.agility) || 3)),
          luck: Math.max(1, Math.min(5, parseInt(player.stats.luck) || 2)),
        },
        items: {
          ditany: Math.max(0, parseInt(player.items?.ditany) || 1),
          attackBooster: Math.max(0, parseInt(player.items?.attackBooster) || 0),
          defenseBooster: Math.max(0, parseInt(player.items?.defenseBooster) || 0),
        },
        avatar: player.avatar || null,
        status: 'ready',
        joinedAt: Date.now(),
      };

      battle.players.push(np);

      const result = { ok: true, player: np, battle };
      if (typeof ack === 'function') ack(result);

      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', `플레이어 추가: ${np.name} (${np.team}팀)`);
      
      console.log(`Player added: ${np.name} (${np.id}) to team ${np.team}`);
    } catch (e) {
      console.error('Add player error:', e);
      const err = { ok: false, error: 'add_player_failed' };
      if (typeof ack === 'function') ack(err);
    }
  });

  // 수정된 플레이어 인증
  socket.on('playerAuth', ({ battleId, token, playerId, name, team }, ack) => {
    try {
      console.log(`[AUTH] Player auth attempt: battleId=${battleId}, token=${token}, playerId=${playerId}, name=${name}, team=${team}`);
      
      const battle = battleId && battles.get(battleId);
      if (!battle) {
        const err = { ok: false, error: 'battle_not_found' };
        console.log('[AUTH] Battle not found');
        if (typeof ack === 'function') ack(err);
        socket.emit('authError', err);
        return;
      }

      // 토큰으로 OTP 검증
      let otpRecord = null;
      for (const [key, record] of otpStore.entries()) {
        if (key.startsWith(`player_${battleId}_`) && record.otp === token) {
          if (record.expires && Date.now() > record.expires) {
            otpStore.delete(key);
            continue;
          }
          otpRecord = record;
          break;
        }
      }

      if (!otpRecord) {
        const err = { ok: false, error: 'invalid_token' };
        console.log('[AUTH] Invalid token');
        if (typeof ack === 'function') ack(err);
        socket.emit('authError', err);
        return;
      }

      // playerId 결정 (URL에서 온 것 우선, 없으면 OTP 레코드에서)
      const finalPlayerId = playerId || otpRecord.playerId;
      console.log(`[AUTH] Final player ID: ${finalPlayerId}`);
      
      // 플레이어 찾기
      let player = battle.players.find(p => p.id === finalPlayerId);
      
      if (!player) {
        const err = { ok: false, error: 'player_not_found' };
        console.log(`[AUTH] Player not found: ${finalPlayerId}`);
        console.log(`[AUTH] Available players:`, battle.players.map(p => `${p.name}(${p.id})`));
        if (typeof ack === 'function') ack(err);
        socket.emit('authError', err);
        return;
      }

      // 소켓을 배틀 룸에 조인
      socket.join(battleId);
      socket.battleId = battleId;
      socket.playerId = player.id;
      socket.role = 'player';

      const result = { 
        ok: true, 
        battle, 
        player,
        message: '인증 성공' 
      };

      console.log(`[AUTH] Success: ${player.name} (${player.id}) authenticated`);

      if (typeof ack === 'function') ack(result);
      socket.emit('authSuccess', result);
      socket.emit('auth:success', result);

      pushLog(battleId, 'system', `플레이어 접속: ${player.name} (${player.team}팀)`);
    } catch (e) {
      console.error('[AUTH] Player auth error:', e);
      const err = { ok: false, error: 'auth_failed' };
      if (typeof ack === 'function') ack(err);
      socket.emit('authError', err);
    }
  });

  // 관전자 인증
  socket.on('spectatorAuth', ({ battleId, token }, ack) => {
    try {
      const battle = battleId && battles.get(battleId);
      if (!battle) {
        const err = { ok: false, error: 'battle_not_found' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      // 관전자 토큰 검증
      let otpRecord = null;
      for (const [key, record] of otpStore.entries()) {
        if (key.startsWith(`spectator_${battleId}`) && record.otp === token) {
          if (record.expires && Date.now() > record.expires) {
            otpStore.delete(key);
            continue;
          }
          otpRecord = record;
          break;
        }
      }

      if (!otpRecord) {
        const err = { ok: false, error: 'invalid_token' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      socket.join(battleId);
      socket.battleId = battleId;
      socket.role = 'spectator';

      const result = { ok: true, battle, message: '관전자 인증 성공' };

      if (typeof ack === 'function') ack(result);
      socket.emit('authSuccess', result);
      socket.emit('auth:success', result);

      pushLog(battleId, 'system', `관전자 접속`);
    } catch (e) {
      const err = { ok: false, error: 'auth_failed' };
      if (typeof ack === 'function') ack(err);
    }
  });

  // 관리자 액션들
  ['startBattle', 'pauseBattle', 'resumeBattle', 'endBattle'].forEach(action => {
    socket.on(action, ({ battleId }) => {
      const battle = battleId && battles.get(battleId);
      if (!battle) return;
      
      const actionMap = {
        startBattle: 'active',
        pauseBattle: 'paused', 
        resumeBattle: 'active',
        endBattle: 'ended'
      };
      
      battle.status = actionMap[action];
      if (action === 'startBattle') battle.startedAt = Date.now();
      if (action === 'endBattle') battle.endedAt = Date.now();
      
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', `전투 ${action}`);
    });
    
    // 호환 이벤트들
    socket.on(`battle:${action.replace('Battle', '')}`, ({ battleId }) => {
      const battle = battleId && battles.get(battleId);
      if (!battle) return;
      
      const actionMap = {
        'battle:start': 'active',
        'battle:pause': 'paused',
        'battle:resume': 'active', 
        'battle:end': 'ended'
      };
      
      const eventName = `battle:${action.replace('Battle', '')}`;
      battle.status = actionMap[eventName];
      if (eventName === 'battle:start') battle.startedAt = Date.now();
      if (eventName === 'battle:end') battle.endedAt = Date.now();
      
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', `전투 ${action}`);
    });
  });

  // 채팅
  ['chatMessage', 'chat:send', 'battle:chat', 'chat:message'].forEach(eventName => {
    socket.on(eventName, (payload) => {
      const battleId = payload?.battleId || socket.battleId;
      if (!battleId) return;
      
      const message = {
        timestamp: Date.now(),
        name: payload?.name || payload?.senderName || '익명',
        message: payload?.message || '',
        role: payload?.role || 'player'
      };
      
      io.to(battleId).emit('chatMessage', message);
      io.to(battleId).emit('chat:message', message);
      pushLog(battleId, 'chat', `${message.name}: ${message.message}`);
    });
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected:', socket.id);
  });
});

// -----------------------------
// Server start
// -----------------------------
server.listen(PORT, HOST, () => {
  console.log(`\n PYXIS Battle System`);
  console.log(` Server: http://${HOST}:${PORT}`);
  console.log(` Socket: ${SOCKET_PATH}`);
  console.log(` Static: ${publicDir}`);
  console.log(` Uploads: ${uploadsDir}`);
  console.log(` Ready for battle!\n`);
});
