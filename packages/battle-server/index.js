// packages/battle-server/index.js - PYXIS Battle Server (플레이어 인증 + 참가자 삭제 추가)
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

// Express 앱 생성
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling']
});

// 메모리 저장소
const battles = new Map();
const otpStore = new Map();

// 헬퍼 함수
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

// 미들웨어
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// 업로드 디렉토리
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// 루트 경로 -> admin.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

// 전투 생성 API
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
      logs: []
    };
    battles.set(battleId, battle);

    console.log(`Battle created: ${battleId} (${mode})`);
    res.json({ ok: true, battleId, battle });
  } catch (e) {
    console.error('Battle creation error:', e);
    res.status(500).json({ ok: false, error: 'Creation failed' });
  }
});

// 링크 생성 API
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);
    
    // 관전자 OTP 저장
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
      
      // 플레이어 토큰 저장
      otpStore.set(otpKey, {
        otp: playerToken,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      
      // 자동로그인 URL 생성
      const playerUrl = `${base}/player.html?battle=${battleId}&password=${playerToken}&token=${playerToken}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;
        
      links.push({ 
        id: index + 1, 
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl
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

// 대체 링크 API
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

// 소켓 이벤트
io.on('connection', (socket) => {
  console.log('[SOCKET] Connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected:', socket.id);
  });

  // 전투 생성
  socket.on('createBattle', ({ mode = '2v2' }, callback) => {
    try {
      if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
        return callback({ error: 'Invalid mode' });
      }

      const battleId = generateId();
      const battle = {
        id: battleId,
        mode,
        status: 'waiting',
        createdAt: Date.now(),
        players: [],
        logs: []
      };
      battles.set(battleId, battle);

      socket.join(battleId);
      console.log(`Battle created: ${battleId} (${mode})`);
      callback({ ok: true, battleId, battle });
    } catch (e) {
      console.error('Socket battle creation error:', e);
      callback({ error: 'Creation failed' });
    }
  });

  // 플레이어 추가
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

  // 플레이어 삭제 (관리자용)
  socket.on('removePlayer', ({ battleId, playerId }, callback) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) return callback && callback({ ok:false, error:'battle_not_found' });
      const idx = battle.players.findIndex(p => p.id === playerId);
      if (idx === -1) return callback && callback({ ok:false, error:'player_not_found' });

      const [removed] = battle.players.splice(idx, 1);
      pushLog(battleId, 'system', `${removed?.name || '플레이어'}가 제거되었습니다.`);
      emitBattleUpdate(battleId);
      callback && callback({ ok:true });
    } catch (e) {
      console.error('removePlayer error', e);
      callback && callback({ ok:false, error:'remove_failed' });
    }
  });

  // 플레이어 인증 (자동로그인용)
  socket.on('playerAuth', ({ battleId, password, token, otp }, callback) => {
    try {
      console.log(`[AUTH] Player auth: battleId=${battleId}, token=${password || token || otp}`);
      
      const battle = battles.get(battleId);
      if (!battle) {
        const err = { ok: false, error: 'battle_not_found', message: '전투를 찾을 수 없습니다.' };
        console.log('[AUTH] Battle not found');
        if (typeof callback === 'function') callback(err);
        socket.emit('authError', err);
        return;
      }

      // 토큰으로 OTP 검증
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
        console.log('[AUTH] Invalid token');
        if (typeof callback === 'function') callback(err);
        socket.emit('authError', err);
        return;
      }

      // 플레이어 찾기
      const player = battle.players.find(p => p.id === otpRecord.playerId);
      if (!player) {
        const err = { ok: false, error: 'player_not_found', message: '플레이어를 찾을 수 없습니다.' };
        console.log('[AUTH] Player not found');
        if (typeof callback === 'function') callback(err);
        socket.emit('authError', err);
        return;
      }

      // 인증 성공
      socket.join(battleId);
      socket.battleId = battleId;
      socket.playerId = player.id;
      socket.role = 'player';

      const result = { 
        ok: true, 
        playerId: player.id,
        playerData: player,
        battle,
        message: '인증 성공! 전투에 참가했습니다.' 
      };

      console.log(`[AUTH] Player authenticated: ${player.name} (${player.id})`);
      
      if (typeof callback === 'function') callback(result);
      socket.emit('authSuccess', result);
      socket.emit('auth:success', result);

      pushLog(battleId, 'system', `${player.name}님이 접속했습니다.`);
    } catch (e) {
      console.error('[AUTH] Player auth error:', e);
      const err = { ok: false, error: 'auth_failed', message: '인증 중 오류가 발생했습니다.' };
      if (typeof callback === 'function') callback(err);
      socket.emit('authError', err);
    }
  });

  // 호환성을 위한 추가 이벤트
  socket.on('player:auth', (...args) => socket.emit('playerAuth', ...args));
});

// 에러 핸들링
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// 서버 시작
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
