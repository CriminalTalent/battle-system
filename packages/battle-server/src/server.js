// packages/battle-server/src/server.js
'use strict';

/**
 * Pyxis Battle Server (Express + Socket.IO)
 * - .env 지원 (PORT, HOST, PUBLIC_BASE_URL, CORS_ORIGIN, MAX_FILE_SIZE)
 * - Nginx 프록시 호환 (app.set('trust proxy', true), socket path '/socket.io/')
 * - 정적 단일 라우팅 보강: /admin(.html), /play(.html), /watch(.html)
 * - /api/battles 리스트 추가 (admin UI 새로고침용)
 * - 팀 전용 채팅 (/t 접두사) + 관리자 열람
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
const MAX_FILE_SIZE = (process.env.MAX_FILE_SIZE || '5mb').toLowerCase();

// ───────────────────────────────────────────────────────────
// App / Server / Socket.IO
// ───────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true); // Behind Nginx/Proxy → trust X-Forwarded-Proto/Host

// CORS
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

// 정적 파일 서빙 (public 폴더)
app.use(express.static(path.join(__dirname, '../public')));

// 단일 파일 라우팅 보강 (직접 링크용)
app.get(['/admin', '/admin.html'], (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html'))
);
app.get(['/play', '/play.html'], (req, res) =>
  res.sendFile(path.join(__dirname, '../public/play.html'))
);
app.get(['/watch', '/watch.html'], (req, res) =>
  res.sendFile(path.join(__dirname, '../public/watch.html'))
);

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors:
    CORS_ORIGIN === '*'
      ? { origin: true, methods: ['GET', 'POST'] }
      : { origin: CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
});

// (선택) 클러스터 어댑터/스티키 지원: 패키지가 없으면 무시
try {
  const { createAdapter } = require('@socket.io/cluster-adapter');
  const { setupWorker } = require('@socket.io/sticky');
  io.adapter(createAdapter());
  setupWorker(io);
  // 콘솔에 표시만
  console.log('[socket.io] cluster-adapter + sticky enabled');
} catch {
  // 로컬/싱글 프로세스 또는 웹소켓 단독 전송일 경우 문제 없음
}

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
// Battles: list / create / get / join
// ───────────────────────────────────────────────────────────

// 전투 목록 (admin UI 새로고침용)
app.get('/api/battles', (_req, res) => {
  try {
    const arr =
      engine.battles && typeof engine.battles.values === 'function'
        ? Array.from(engine.battles.values())
        : [];
    const battles = arr.map((b) => ({
      id: b.id,
      mode: b.mode,
      status: b.status,
      playerCount:
        (b.teams?.team1?.players?.length || 0) + (b.teams?.team2?.players?.length || 0),
      createdAt: b.createdAt || Date.now(),
    }));
    res.json({ battles });
  } catch (e) {
    console.error('[GET /api/battles] error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 배틀 생성
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
  socket.playerTeam = null; // team1 | team2

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = engine.adminAuth(battleId, otp);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);                 // 공용 룸
      socket.join(`${battleId}-admin`);      // 관리자 룸
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

      const battle = result.battle;
      const p = result.player;
      const teamKey = p?.team || null;

      socket.join(battleId);                            // 공용 룸
      if (teamKey) socket.join(`${battleId}-team-${teamKey}`); // 팀 룸

      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = playerId;
      socket.playerTeam = teamKey;

      if (typeof engine.updatePlayerConnection === 'function') {
        engine.updatePlayerConnection(battleId, playerId, true);
      }

      socket.emit('authSuccess', { role: 'player', battle, player: p });
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
      socket.join(battleId); // 공용 룸
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

  // 채팅 (팀 전용 /t 지원, 관리자는 항상 열람)
  socket.on('chatMessage', ({ message }) => {
    if (!socket.battleId || !message || typeof message !== 'string') return;

    const b = engine.getBattle(socket.battleId);
    if (!b) return;

    let sender = '알 수 없음';
    if (socket.role === 'player') {
      const p = engine.findPlayer(b, socket.playerId);
      sender = p ? p.name : '플레이어';
    } else if (socket.role === 'spectator') {
      sender = socket.spectatorName || '관전자';
    } else if (socket.role === 'admin') {
      sender = '관리자';
    }

    // 팀 채팅: "/t " 또는 "/T "
    const isTeamChat = /^\/t\s+/i.test(message);
    if (isTeamChat && socket.role === 'player' && socket.playerTeam) {
      const clean = message.replace(/^\/t\s+/i, '').slice(0, 500);
      engine.addChatMessage(socket.battleId, sender, clean, 'team');

      // 같은 팀 + 관리자에게만 전송
      io.to(`${socket.battleId}-team-${socket.playerTeam}`).emit('battleUpdate', engine.getBattle(socket.battleId));
      io.to(`${socket.battleId}-admin`).emit('battleUpdate', engine.getBattle(socket.battleId));
      return;
    }

    // 일반 채팅
    const clean = String(message).slice(0, 500);
    engine.addChatMessage(socket.battleId, sender, clean, socket.role || 'system');
    broadcast(socket.battleId);
  });

  // 관전자 응원 (허용 리스트만)
  socket.on('cheerMessage', ({ message }) => {
    if (!socket.battleId || socket.role !== 'spectator') return;
    const allowed = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
    engine.addChatMessage(socket.battleId, socket.spectatorName || '관전자', message, 'spectator');
    broadcast(socket.battleId);
  });

  // 관리자 브로드캐스트
  socket.on('adminMessage', ({ battleId, message }) => {
    if (socket.role !== 'admin') return;
    io.to(`${battleId}-admin`).emit('adminBroadcast', { message, at: Date.now() });
  });

  socket.on('disconnect', () => {
    try {
      if (socket.role === 'player' && socket.battleId && socket.playerId) {
        if (typeof engine.updatePlayerConnection === 'function') {
          engine.updatePlayerConnection(socket.battleId, socket.playerId, false);
        }
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
  console.log(`정적 페이지: /admin.html /play.html /watch.html`);
});
