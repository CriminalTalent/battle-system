// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버 (:3001)
// 라우트: /api/health, /api/battles(목록), /api/battles/:id, /api/battles/:id/players
// 관리자: /api/admin/battles/:id/links, /api/admin/battles/:id/start, /api/admin/battles/:id/end, /api/admin/battles/:id/refresh-otp

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

// BattleEngine: 내부에서 Map으로 battles 관리 (id, otps, teams, players 등)
const BattleEngine = require('./services/BattleEngine');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
  path: '/socket.io/',
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
app.use(express.static(path.join(__dirname, '../public'))); // admin.html, play.html, watch.html 등

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

const ALLOWED_CHEERS = new Set([
  // 관전자 UI 버튼 + 서버 기본 허용 세트 모두 포함
  '힘내라!', '멋지다!', '이길 수 있어!', '포기하지마!',
  '힘내!', '지지마!', '포기하지 마!', '화이팅!', '대박!'
]);

function battleSummary(b) {
  const playerCount =
    (b?.teams?.team1?.players?.length || 0) +
    (b?.teams?.team2?.players?.length || 0);
  return {
    id: b.id,
    mode: b.mode || '1v1',
    status: b.status || 'waiting',
    playerCount,
    createdAt: b.createdAt || Date.now(),
  };
}

function safeListBattles() {
  // 1) 표준 메서드가 있으면 사용
  if (typeof engine.listBattles === 'function') {
    const list = engine.listBattles();
    return Array.isArray(list) ? list.map(battleSummary) : [];
  }
  // 2) toJSON()이 있으면 그 결과에서 battles 추정
  if (typeof engine.toJSON === 'function') {
    const data = engine.toJSON();
    const arr = Array.isArray(data?.battles)
      ? data.battles
      : Object.values(data?.battles || {});
    return arr.map(battleSummary);
  }
  // 3) 엔진 내부 맵 접근(구현 따라 다를 수 있음)
  const raw = engine._battles || engine.battles;
  if (raw instanceof Map) return [...raw.values()].map(battleSummary);
  if (Array.isArray(raw)) return raw.map(battleSummary);
  return [];
}

function normalizeAction(action) {
  if (typeof action === 'string') return { type: action };
  if (action && typeof action === 'object') {
    if (!action.type && action.action) return { type: String(action.action) };
    if (action.type) return action;
  }
  return { type: 'pass' };
}

// ───────────────────────────────────────────────────────────────────────────────
// 헬스체크
// ───────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: engine.getBattleCount?.() ?? safeListBattles().length });
});

// ───────────────────────────────────────────────────────────────────────────────
// 배틀 생성 / 조회 / 목록 / 참여
// ───────────────────────────────────────────────────────────────────────────────

// 배틀 생성
// body: { mode?: "1v1"|"2v2"|"3v3"|"4v4", adminId?: string }
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);
    return res.status(201).json({ battle }); // ← 관리자 UI가 기대하는 형태
  } catch (e) {
    console.error('[POST /api/battles] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 배틀 목록(관리자 UI 테이블용)
app.get('/api/battles', (req, res) => {
  try {
    const battles = safeListBattles();
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

// (관전자·플레이어 폴백용) /battles/:id 도 허용
app.get('/battles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const battle = engine.getBattle(id);
    if (!battle) return res.status(404).json({ error: 'battle_not_found', id });
    return res.json(battle);
  } catch (e) {
    console.error('[GET /battles/:id] error', e);
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

// ───────────────────────────────────────────────────────────────────────────────
// 관리자용: 링크 생성 / 시작 / 종료 / OTP 회전
// ───────────────────────────────────────────────────────────────────────────────

// 링크/OTP 및 바로가기 URL 반환
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin;
    const playerOtp = b.otps?.player ?? (Array.isArray(b.otps?.players) ? b.otps.players[0] : undefined);
    const spectOtp  = b.otps?.spectator ?? b.otps?.spectators;

    // 팀 지정은 쿼리로 넘김 (플레이어 페이지가 team 파라미터를 읽음)
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

// OTP 회전(있으면 사용)
app.post('/api/admin/battles/:id/refresh-otp', (req, res) => {
  try {
    const { id } = req.params;
    if (typeof engine.refreshOtps !== 'function')
      return res.status(400).json({ ok: false, error: 'refresh_otps_not_supported' });
    const b = engine.refreshOtps(id);
    broadcast(id);
    return res.json({ ok: true, success: true, otps: b?.otps || null });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/refresh-otp] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// (선택) 공지 핀 API가 있다면 noticeUpdate 브로드캐스트
app.post('/api/admin/battles/:id/notice', (req, res) => {
  try {
    const { id } = req.params;
    const { text = '' } = req.body || {};
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });
    // 엔진에 기록
    if (!b.notice) b.notice = {};
    b.notice.text = text;
    broadcast(id);
    io.to(id).emit('noticeUpdate', { text });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/notice] error', e);
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
      engine.updatePlayerConnection?.(battleId, playerId, true);
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
  // payload: { battleId, playerId, action }  // action은 문자열 또는 {type,...}
  socket.on('playerAction', ({ battleId, playerId, action }) => {
    try {
      const norm = normalizeAction(action);
      engine.executeAction(battleId, playerId, norm);
      broadcast(battleId);
      socket.emit('actionSuccess');
    } catch (e) {
      socket.emit('actionError', e.message || 'action_failed');
    }
  });

  // ── 채팅 (이벤트 이름 호환: 'chat' & 'chatMessage')
  function handleChat(payload) {
    if (!socket.battleId || !payload) return;
    const message = String(payload.message || payload.text || '').slice(0, 500);
    if (!message) return;

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

    // 팀 전용 여부(플레이어만 사용): payload.teamOnly === true
    const teamOnly = !!payload.teamOnly || payload.scope === 'team';

    engine.addChatMessage(socket.battleId, sender, message, socket.role || 'system', { teamOnly });
    // 실시간 이벤트와 전체 스냅샷 둘 다 쏴줌
    io.to(socket.battleId).emit('chat', {
      timestamp: Date.now(),
      name: sender,
      message,
      teamOnly,
      isAdmin: socket.role === 'admin',
    });
    broadcast(socket.battleId);
  }
  socket.on('chat', handleChat);
  socket.on('chatMessage', handleChat);

  // ── 관전자 응원 (이벤트 이름 호환: 'cheer' & 'cheerMessage')
  function handleCheer(payload) {
    if (!socket.battleId || socket.role !== 'spectator') return;
    const message = String(payload?.message || '').trim();
    if (!ALLOWED_CHEERS.has(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
    engine.addChatMessage(socket.battleId, socket.spectatorName || '관전자', message, 'spectator', { teamOnly:false });
    io.to(socket.battleId).emit('chat', {
      timestamp: Date.now(),
      name: socket.spectatorName || '관전자',
      message: `[응원] ${message}`,
      teamOnly: false,
      isAdmin: false,
    });
    broadcast(socket.battleId);
  }
  socket.on('cheer', handleCheer);
  socket.on('cheerMessage', handleCheer);

  // 관리자 단체 알림(예시)
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

// ───────────────────────────────────────────────────────────────────────────────
// 서버 시작
// ───────────────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Battle server listening on http://localhost:${PORT}`);
  console.log(`관리자 페이지(정적): http://localhost:${PORT}/admin.html`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
