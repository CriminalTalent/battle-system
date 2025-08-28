// packages/battle-server/src/server.js
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const cfg = require('./config/env');                 // ⬅️ 추가
const BattleEngine = require('./services/BattleEngine');

// 엔진에 턴제한/최대 인원 전달
const engine = new BattleEngine({
  turnSeconds: Math.max(5, Math.floor(cfg.turnTimeoutMs / 1000)),
  maxPlayersPerBattle: cfg.maxPlayersPerBattle,
});

const app = express();
app.set('trust proxy', true);

// 업로드 경로 준비 및 정적 서빙
if (!fs.existsSync(cfg.uploadPath)) fs.mkdirSync(cfg.uploadPath, { recursive: true });

app.use(cors({ origin: cfg.corsOrigin, credentials: true })); // ⬅️ CORS 적용
app.use(express.json({ limit: Math.max(1_000_000, cfg.maxFileSizeBytes) })); // body 한도
app.use(express.urlencoded({ extended: true, limit: Math.max(1_000_000, cfg.maxFileSizeBytes) }));
app.use('/uploads', express.static(cfg.uploadPath));
app.use(express.static(path.join(__dirname, '../public'))); // admin.html, play.html, watch.html

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: cfg.corsOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], credentials: true },
  path: '/socket.io/',
});

// 공개 베이스 URL (기존 로직 유지)
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

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

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: engine.getBattleCount?.() ?? 0 });
});

// 배틀 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);
    return res.status(201).json({ battle });
  } catch (e) {
    console.error('[POST /api/battles] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 배틀 목록
app.get('/api/battles', (req, res) => {
  try {
    const battles = engine.listBattles ? engine.listBattles() : [];
    return res.json({ battles });
  } catch (e) {
    console.error('[GET /api/battles] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 배틀 조회
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

// 플레이어 참여
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const { name, team, stats, inventory, imageUrl, avatarUrl } = req.body || {};
    const player = engine.addPlayer(id, {
      name, team, stats, inventory,
      imageUrl: imageUrl || avatarUrl || undefined,
    });

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

// 링크/OTP 및 바로가기 URL
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin;
    const playerOtp = b.otps?.player ?? (Array.isArray(b.otps?.players) ? b.otps.players[0] : undefined);
    const spectOtp  = b.otps?.spectator ?? b.otps?.spectators;

    return res.json({
      id,
      otps: b.otps,
      urls: {
        admin:     `${baseUrl}/admin?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(adminOtp || '')}`,
        team1:     `${baseUrl}/play?battle=${encodeURIComponent(id)}&team=team1&token=${encodeURIComponent(playerOtp || '')}`,
        team2:     `${baseUrl}/play?battle=${encodeURIComponent(id)}&team=team2&token=${encodeURIComponent(playerOtp || '')}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(spectOtp || '')}`,
      },
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 전투 시작/종료
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

// OTP 회전
app.post('/api/admin/battles/:id/refresh-otp', (req, res) => {
  try {
    if (typeof engine.refreshOtps !== 'function') return res.status(400).json({ ok: false, error: 'refresh_otps_not_supported' });
    const { id } = req.params;
    const b = engine.refreshOtps(id);
    broadcast(id);
    return res.json({ ok: true, success: true, otps: b?.otps || null });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/refresh-otp] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Socket.IO (기존과 동일)
io.on('connection', (socket) => {
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.spectatorName = null;

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

  socket.on('playerAction', ({ battleId, playerId, action }) => {
    try {
      const norm = (typeof action === 'string') ? { type: action } : (action || {});
      engine.executeAction(battleId, playerId, norm);
      broadcast(battleId);
      socket.emit('actionSuccess');
    } catch (e) {
      socket.emit('actionError', e.message || 'action_failed');
    }
  });

  socket.on('chatMessage', ({ message }) => {
    if (!socket.battleId || !message) return;
    let sender = '알 수 없음';
    if (socket.role === 'player') {
      const b = engine.getBattle(socket.battleId);
      const p = b && engine.findPlayer?.(b, socket.playerId);
      sender = p ? p.name : '플레이어';
    } else if (socket.role === 'spectator') {
      sender = socket.spectatorName || '관전자';
    } else if (socket.role === 'admin') {
      sender = '관리자';
    }
    engine.addChatMessage(socket.battleId, sender, message, socket.role || 'system');
    broadcast(socket.battleId);
  });

  socket.on('cheerMessage', ({ message }) => {
    if (!socket.battleId || socket.role !== 'spectator') return;
    const allowed = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!', '힘내라!', '멋지다!', '포기하지마!'];
    if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
    engine.addChatMessage(socket.battleId, socket.spectatorName || '관전자', message, 'spectator');
    broadcast(socket.battleId);
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

// 주기적 클린업 훅(엔진에 구현돼있으면 호출)
if (cfg.cleanupIntervalMs > 0) {
  setInterval(() => {
    try {
      engine.pruneStaleBattles?.(); // 선택 구현
    } catch (e) {
      console.error('[cleanup]', e);
    }
  }, cfg.cleanupIntervalMs);
}

server.listen(cfg.port, cfg.host, () => {
  console.log(`Battle server listening on http://${cfg.host}:${cfg.port}`);
  console.log(`관리자 페이지(정적): http://${cfg.host}:${cfg.port}/admin.html`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
