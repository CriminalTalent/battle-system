// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버
// - 정적 페이지: /admin, /play, /watch (확장자 없이 접근 가능)
// - API: /api/health, /api/battles (목록/생성/조회/플레이어참여)
// - Admin API: /api/admin/battles/:id/{links|start|pause|end}
// - Socket.IO: admin/player/spectator 인증, 액션, 채팅(팀 채널 지원)

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

// 전투 엔진
const BattleEngine = require('./services/BattleEngine');

// ───────────────────────────────────────────────────────────────────────────────
// 환경
// ───────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

// ───────────────────────────────────────────────────────────────────────────────
// 앱/서버/소켓
// ───────────────────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true); // Nginx 뒤에서 원본 스킴/호스트 신뢰

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') },
  path: '/socket.io/',
});

// 엔진 인스턴스
const engine = new BattleEngine();

// ───────────────────────────────────────────────────────────────────────────────
// 미들웨어
// ───────────────────────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 서빙: 확장자 없는 접근 지원(extensions: ['html'])
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// 루트 접근 시 관리자 페이지로
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// 예쁜 경로 → 개별 파일 매핑 (명시적 보강)
app.get(['/admin', '/play', '/watch'], (req, res) => {
  const page = (req.path.replace('/', '') || 'admin') + '.html';
  res.sendFile(path.join(publicDir, page));
});

// ───────────────────────────────────────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────────
// 헬스체크
// ───────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: engine.getBattleCount() });
});

// ───────────────────────────────────────────────────────────────────────────────
// 배틀 목록/생성/조회/참여
// ───────────────────────────────────────────────────────────────────────────────

// 목록: 관리자 페이지에서 사용
app.get('/api/battles', (req, res) => {
  try {
    const rows = [];
    for (const [, b] of engine.battles) {
      rows.push({
        id: b.id,
        mode: b.mode,
        status: b.status,
        playerCount: (b.teams?.team1?.players?.length || 0) + (b.teams?.team2?.players?.length || 0),
        createdAt: b.createdAt,
      });
    }
    // 최신순
    rows.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ battles: rows });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
});

// 생성
// body: { mode?: "1v1"|"2v2"|"3v3"|"4v4", adminId?: string }
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);
    // 관리자/플레이어/관전자 URL도 같이 반환(편의)
    const baseUrl = baseUrlFromReq(req);
    const adminOtp = battle.otps?.admin || '';
    const playerOtp = battle.otps?.player || (Array.isArray(battle.otps?.players) ? battle.otps.players[0] : '');
    const spectOtp  = battle.otps?.spectator || battle.otps?.spectators || '';

    return res.status(201).json({
      battle,
      urls: {
        admin:     `${baseUrl}/admin?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(adminOtp)}`,
        player:    `${baseUrl}/play?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(playerOtp)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(spectOtp)}`,
      },
    });
  } catch (e) {
    console.error('[POST /api/battles] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 조회
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
// body: { name, team: "team1"|"team2", stats?, inventory?, imageUrl? }
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const { name, team, stats, inventory = [], imageUrl = '' } = req.body || {};
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

// ───────────────────────────────────────────────────────────────────────────────
/** 관리자 API */
// ───────────────────────────────────────────────────────────────────────────────

// 링크 생성(OTP 포함)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin || '';
    const playerOtp = b.otps?.player || (Array.isArray(b.otps?.players) ? b.otps.players[0] : '');
    const spectOtp  = b.otps?.spectator || b.otps?.spectators || '';

    return res.json({
      id,
      otps: b.otps,
      urls: {
        admin:     `${baseUrl}/admin?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(adminOtp)}`,
        player:    `${baseUrl}/play?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(playerOtp)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(spectOtp)}`,
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

// 일시정지/재개 토글 (엔진에 메서드 없으므로 여기서 상태 토글)
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
    return res.json({ ok: true, battle: b });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/pause] error', e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// 전투 종료
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ ok: false, error: 'battle_not_found' });

    engine.endBattle(id, null, '관리자 종료');
    // 메모리에서 제거되므로, 이어서 broadcast는 생략/무의미
    return res.json({ ok: true, success: true, ended: id });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/end] error', e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Socket.IO
// ───────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.role = null;        // 'admin' | 'player' | 'spectator'
  socket.battleId = null;
  socket.playerId = null;
  socket.playerTeam = null;  // 'team1' | 'team2'
  socket.spectatorName = null;

  // 룸 헬퍼
  const roomAll = (id) => id; // 전체 방송 룸
  const roomAdmin = (id) => `${id}-admin`;
  const roomTeam = (id, team) => `${id}-team-${team}`;

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = engine.adminAuth(battleId, otp);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      socket.join(roomAll(battleId));
      socket.join(roomAdmin(battleId));
      // 관리자도 팀 채팅 모니터링을 위해 두 팀 룸 모두 참여
      socket.join(roomTeam(battleId, 'team1'));
      socket.join(roomTeam(battleId, 'team2'));

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

      const player = result.player;
      socket.join(roomAll(battleId));
      socket.join(roomTeam(battleId, player.team));

      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = playerId;
      socket.playerTeam = player.team;

      engine.updatePlayerConnection?.(battleId, playerId, true);
      socket.emit('authSuccess', { role: 'player', battle: result.battle, player });
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

      socket.join(roomAll(battleId));

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

  // 채팅(팀 채널 지원)
  // payload: { message, channel?: 'team'|'all' }
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

      // 기록(엔진이 추가 인자 무시해도 안전)
      engine.addChatMessage(bId, sender, message, senderType, chan);

      // 브로드캐스트
      if (chan === 'team' && socket.role === 'player' && socket.playerTeam) {
        // 같은 팀에게만 + 관리자는 항상 수신
        io.to(roomTeam(bId, socket.playerTeam)).emit('chatMessage', {
          sender, senderType, message, channel: 'team', timestamp: Date.now(),
        });
        io.to(roomAdmin(bId)).emit('chatMessage', {
          sender, senderType, message, channel: 'team', timestamp: Date.now(),
        });
      } else {
        // 전체 방송
        io.to(roomAll(bId)).emit('chatMessage', {
          sender, senderType, message, channel: 'all', timestamp: Date.now(),
        });
      }
    } catch (e) {
      console.error('[socket chatMessage] error', e);
      socket.emit('chatError', 'internal_error');
    }
  });

  // 관전자 응원(허용된 메시지만)
  socket.on('cheerMessage', ({ message }) => {
    try {
      if (!socket.battleId || socket.role !== 'spectator') return;
      const allowed = ['힘내라!', '멋지다!', '이길 수 있어!', '포기하지마!', '화이팅!', '대박!'];
      if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');

      engine.addChatMessage(socket.battleId, socket.spectatorName || '관전자', message, 'spectator', 'all');
      io.to(roomAll(socket.battleId)).emit('chatMessage', {
        sender: socket.spectatorName || '관전자',
        senderType: 'spectator',
        message,
        channel: 'all',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error('[socket cheerMessage] error', e);
    }
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
// 시작
// ───────────────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`Battle server listening on http://${HOST}:${PORT}`);
  console.log(`Static root: ${publicDir}`);
  console.log(`Access admin page: /admin  (also /play, /watch)`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
