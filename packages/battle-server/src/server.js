// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버 (업데이트)
// - 팀 이름 고정: "불사조 기사단" / "죽음을 먹는 자들"
// - 관리자 페이지에서 로스터 관리 (스탯/아이템 포함)
// - 플레이어는 ID 또는 이름으로 인증 가능
// - 관전자 OTP 별도 발행
// - 채널형(전체/팀) 채팅

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

// 전투 엔진 (playerAuthByName, removePlayer, addChatMessage(channel 지원) 포함이어야 함)
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
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') },
  path: '/socket.io/', // Nginx와 동일해야 함
});

// 엔진 인스턴스
const engine = new BattleEngine();

// ───────────────────────────────────────────────────────────────────────────────
// 미들웨어
// ───────────────────────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 서빙
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// 루트 접근 시 관리자 페이지로
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// 예쁜 경로 → 개별 파일 매핑
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
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    battles: engine.getBattleCount(),
    connections: io.engine.clientsCount,
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 배틀 목록/생성/조회/참여
// ───────────────────────────────────────────────────────────────────────────────

// 목록
app.get('/api/battles', (req, res) => {
  try {
    const rows = [];
    for (const [, b] of engine.battles) {
      rows.push({
        id: b.id,
        mode: b.mode,
        status: b.status,
        playerCount:
          (b.teams?.team1?.players?.length || 0) +
          (b.teams?.team2?.players?.length || 0),
        createdAt: b.createdAt,
      });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ battles: rows });
  } catch (e) {
    console.error('[GET /api/battles] error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = battle.otps?.admin || '';
    const playerOtp = battle.otps?.player || '';
    const spectatorOtp = battle.otps?.spectator || '';

    return res.status(201).json({
      battle,
      urls: {
        admin: `${baseUrl}/admin?battle=${encodeURIComponent(
          battle.id
        )}&token=${encodeURIComponent(adminOtp)}`,
        player: `${baseUrl}/play?battle=${encodeURIComponent(
          battle.id
        )}&token=${encodeURIComponent(playerOtp)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(
          battle.id
        )}&token=${encodeURIComponent(spectatorOtp)}`,
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

// 플레이어 추가
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const { name, team, stats, inventory = [], imageUrl = '' } = req.body || {};
    const player = engine.addPlayer(id, {
      name,
      team,
      stats,
      inventory,
      imageUrl,
    });

    broadcast(id);
    return res.status(201).json({
      ok: true,
      success: true,
      battleId: id,
      player,
    });
  } catch (e) {
    console.error('[POST /api/battles/:id/players] error', e);
    return res
      .status(400)
      .json({ ok: false, success: false, error: e.message || 'bad_request' });
  }
});

// 플레이어 제거
app.delete('/api/battles/:id/players/:playerId', (req, res) => {
  try {
    const { id, playerId } = req.params;
    const result = engine.removePlayer(id, playerId);

    if (result.success) {
      broadcast(id);
      return res.json({ ok: true, success: true });
    } else {
      return res
        .status(404)
        .json({ ok: false, error: result.message || 'player_not_found' });
    }
  } catch (e) {
    console.error('[DELETE /api/battles/:id/players/:playerId] error', e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// 관리자 API
// ───────────────────────────────────────────────────────────────────────────────

// 링크 생성(플레이어별 링크 포함)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const adminOtp = b.otps?.admin || '';
    const playerOtp = b.otps?.player || '';
    const spectatorOtp = b.otps?.spectator || '';

    // 플레이어별 링크 생성
    const playerLinks = [];
    const allPlayers = [
      ...(b.teams?.team1?.players || []),
      ...(b.teams?.team2?.players || []),
    ];

    allPlayers.forEach((p) => {
      playerLinks.push({
        id: p.id,
        name: p.name,
        team: p.team,
        url: `${baseUrl}/play?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(playerOtp)}&name=${encodeURIComponent(
          p.name
        )}&pid=${encodeURIComponent(p.id)}`,
      });
    });

    return res.json({
      id,
      otps: b.otps,
      urls: {
        admin: `${baseUrl}/admin?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(adminOtp)}`,
        player: `${baseUrl}/play?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(playerOtp)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(spectatorOtp)}`,
      },
      playerLinks,
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

// 일시정지/재개 토글
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
      return res
        .status(400)
        .json({ ok: false, error: `cannot_pause_from_${b.status}` });
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
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.playerTeam = null;
  socket.spectatorName = null;

  // 룸 이름
  const roomAll = (id) => id; // 공용 룸
  const roomAdmin = (id) => `${id}-admin`;
  const roomTeam = (id, team) => `${id}-team-${team}`;

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = engine.adminAuth(battleId, otp);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      socket.join(roomAll(battleId));
      socket.join(roomAdmin(battleId));
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

  // 플레이어 인증 (ID 또는 이름)
  socket.on('playerAuth', ({ battleId, otp, playerId, playerName }) => {
    try {
      let result;
      if (playerId) {
        result = engine.playerAuth(battleId, otp, playerId);
      } else if (playerName) {
        result = engine.playerAuthByName(battleId, otp, playerName);
      } else {
        return socket.emit('authError', '플레이어 ID 또는 이름이 필요합니다');
      }

      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      const player = result.player;
      socket.join(roomAll(battleId));
      socket.join(roomTeam(battleId, player.team));

      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = player.id;
      socket.playerTeam = player.team;

      socket.emit('authSuccess', { role: 'player', battle: result.battle, player });
      broadcast(battleId);
    } catch (e) {
      console.error('[socket playerAuth] error', e);
      socket.emit('authError', 'internal_error');
    }
  });

  // 관전자 인증
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
  socket.on('playerAction', ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      broadcast(battleId);
      socket.emit('actionSuccess');
    } catch (e) {
      socket.emit('actionError', e.message || 'action_failed');
    }
  });

  // 채팅 (전체/팀)
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

      const entry = {
        sender,
        senderType,
        message,
        channel: chan,
        team: chan === 'team' ? socket.playerTeam : null,
        timestamp: Date.now(),
      };

      engine.addChatMessage(bId, entry);

      const chatData = {
        sender,
        senderType,
        message,
        channel: chan,
        timestamp: entry.timestamp,
      };

      if (chan === 'team' && socket.role === 'player' && socket.playerTeam) {
        io.to(roomTeam(bId, socket.playerTeam)).emit('chatMessage', chatData);
        io.to(roomAdmin(bId)).emit('chatMessage', chatData);
      } else {
        io.to(roomAll(bId)).emit('chatMessage', chatData);
      }

      broadcast(bId);
    } catch (e) {
      console.error('[socket chatMessage] error', e);
      socket.emit('chatError', 'internal_error');
    }
  });

  // 관전자 응원(화이트리스트)
  socket.on('cheerMessage', ({ message }) => {
    try {
      if (!socket.battleId || socket.role !== 'spectator') return;
      const allowed = [
        '힘내!',
        '지지마!',
        '이길 수 있어!',
        '포기하지 마!',
        '화이팅!',
        '대박!',
        '힘내라!',
        '멋지다!',
        '포기하지마!',
      ];
      if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');

      const entry = {
        sender: socket.spectatorName || '관전자',
        senderType: 'spectator',
        message: `[응원] ${message}`,
        channel: 'all',
        team: null,
        timestamp: Date.now(),
      };

      engine.addChatMessage(socket.battleId, entry);

      io.to(roomAll(socket.battleId)).emit('chatMessage', {
        sender: entry.sender,
        senderType: 'spectator',
        message: entry.message,
        channel: 'all',
        timestamp: entry.timestamp,
      });

      broadcast(socket.battleId);
    } catch (e) {
      console.error('[socket cheerMessage] error', e);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.role === 'player' && socket.battleId && socket.playerId) {
        const b = engine.getBattle(socket.battleId);
        if (b) {
          engine.addBattleLog(
            socket.battleId,
            'system',
            `${socket.playerId} 연결 해제`
          );
          broadcast(socket.battleId);
        }
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
