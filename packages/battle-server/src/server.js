// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버 (Nginx 프록시 대상: :3001)
// 필요 라우트: /api/health, /api/battles, /api/battles/:id, /api/battles/:id/players
// 관리자 전용: /api/admin/battles/:id/links, /api/admin/battles/:id/start, /api/admin/battles/:id/end

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

// BattleEngine: 내부에서 Map으로 battles 관리 (id, otps, teams, players 등)
const BattleEngine = require('./services/BattleEngine');

const app = express();
app.set('trust proxy', true); // Nginx 뒤에서 실제 프로토콜/호스트 신뢰
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
  path: '/socket.io/', // 클라이언트/NGINX와 일치
});

const PORT = process.env.PORT || 3001;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const engine = new BattleEngine();

// ───────────────────────────────────────────────────────────────────────────────
// 미들웨어
// ───────────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public'))); // admin.html, play.html, watch.html

// ───────────────────────────────────────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────────
// 헬스체크
// ───────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: engine.getBattleCount() });
});

// ───────────────────────────────────────────────────────────────────────────────
// 배틀 생성 / 조회 / 참여
// ───────────────────────────────────────────────────────────────────────────────

// 배틀 생성
// body: { mode?: "1v1"|"2v2"|"3v3"|"4v4", adminId?: string }
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);
    return res.status(201).json(battle); // { id, ... }
  } catch (e) {
    console.error('[POST /api/battles] error', e);
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

// 플레이어 참여 (play.html이 호출)
// body: { name, team: "team1"|"team2", stats?, inventory?, imageUrl? }
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const { name, team, stats, inventory, imageUrl } = req.body || {};
    const player = engine.addPlayer(id, { name, team, stats, inventory, imageUrl });

    // 응답 포맷 호환 (success/ok 둘 다 제공)
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

// ───────────────────────────────────────────────────────────────────────────────
// 관리자용: 링크 생성 / 시작 / 종료
// ───────────────────────────────────────────────────────────────────────────────

// 링크/OTP 및 바로가기 URL 반환
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin;
    // 엔진 구현 호환: player 단일 또는 players[0]
    const playerOtp = b.otps?.player ?? (Array.isArray(b.otps?.players) ? b.otps.players[0] : undefined);
    const spectOtp  = b.otps?.spectator ?? b.otps?.spectators;

    return res.json({
      id,
      otps: b.otps,
      urls: {
        admin:     `${baseUrl}/admin?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(adminOtp || '')}`,
        player:    `${baseUrl}/play?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(playerOtp || '')}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(spectOtp || '')}`,
      },
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 전투 시작
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

// 전투 종료
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

// ───────────────────────────────────────────────────────────────────────────────
// Socket.IO
// ───────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.spectatorName = null;

  // 관리자 인증
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

  // 플레이어 인증
  // payload: { battleId, otp, playerId }
  socket.on('playerAuth', ({ battleId, otp, playerId }) => {
    try {
      const result = engine.playerAuth(battleId, otp, playerId);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);
      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = playerId;
      engine.updatePlayerConnection(battleId, playerId, true);
      socket.emit('authSuccess', { role: 'player', battle: result.battle, player: result.player });
      broadcast(battleId);
    } catch (e) {
      console.error('[socket playerAuth] error', e);
      socket.emit('authError', 'internal_error');
    }
  });

  // 관전자 인증
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

  // 플레이어 액션
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

  // 채팅
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

  // 관전자 응원(허용된 메시지만)
  socket.on('cheerMessage', ({ message }) => {
    if (!socket.battleId || socket.role !== 'spectator') return;
    const allowed = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
    engine.addChatMessage(socket.battleId, socket.spectatorName || '관전자', message, 'spectator');
    broadcast(socket.battleId);
  });

  // 관리자 단체 알림(예시)
  socket.on('adminMessage', ({ battleId, message }) => {
    if (socket.role !== 'admin') return;
    io.to(`${battleId}-admin`).emit('adminBroadcast', { message, at: Date.now() });
  });

  socket.on('disconnect', () => {
    try {
      if (socket.role === 'player' && socket.battleId && socket.playerId) {
        engine.updatePlayerConnection(socket.battleId, socket.playerId, false);
        broadcast(socket.battleId);
      }
    } catch (_) {}
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 서버 시작
// ───────────────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Battle server listening on http://localhost:${PORT}`);
  console.log(`관리자 페이지(정적): http://localhost:${PORT}/admin.html`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));