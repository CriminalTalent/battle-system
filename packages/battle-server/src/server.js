// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const BattleEngine = require('./services/BattleEngine');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET','POST','PUT','PATCH','DELETE'] },
  path: '/socket.io/',
});

const PORT = process.env.PORT || 3001;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const engine = new BattleEngine();

// ────────────────────────── 미들웨어 ──────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 (관리자/플레이어/관전자 페이지)
app.use(express.static(path.join(__dirname, '../public')));

// ────────────────────────── 유틸 ──────────────────────────
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

// ────────────────────────── 헬스 ──────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: engine.getBattleCount() });
});

// ────────────────────────── 배틀 REST ──────────────────────────
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

// ────────────────────────── 관리자 링크/제어 ──────────────────────────
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
        player:    `${baseUrl}/play?battle=${encodeURIComponent(id)}&token=${encodeURIComponent(playerOtp || '')}`,
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

// ────────────────────────── Socket.IO ──────────────────────────
io.on('connection', (socket) => {
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.playerTeam = null;
  socket.spectatorName = null;

  // 공용 룸 이름
  const teamRoom = (battleId, team) => `${battleId}-${team}`;
  const adminRoom = (battleId) => `${battleId}-admin`;

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = engine.adminAuth(battleId, otp);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);
      socket.join(adminRoom(battleId));
      socket.role = 'admin';
      socket.battleId = battleId;
      socket.emit('authSuccess', { role: 'admin', battle: result.battle });
    } catch (e) {
      console.error('[socket adminAuth] error', e);
      socket.emit('authError', 'internal_error');
    }
  });

  // 플레이어 인증
  socket.on('playerAuth', ({ battleId, otp, playerId }) => {
    try {
      const result = engine.playerAuth(battleId, otp, playerId);
      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');
      socket.join(battleId);
      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = playerId;

      // 팀 룸도 조인 (팀 채팅용)
      const my = result.player;
      if (my?.team) {
        socket.playerTeam = my.team; // 'team1'|'team2'
        socket.join(teamRoom(battleId, my.team));
      }

      engine.updatePlayerConnection?.(battleId, playerId, true);
      socket.emit('authSuccess', { role: 'player', battle: result.battle, player: result.player });
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
  socket.on('playerAction', ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      broadcast(battleId);
      socket.emit('actionSuccess');
    } catch (e) {
      socket.emit('actionError', e.message || 'action_failed');
    }
  });

  /**
   * 채팅
   * payload: { message: string, channel?: 'team'|'all' }
   * - '/t ...' 또는 channel='team' → 같은 팀 + 관리자에게만 전송
   * - 그 외 → 전체(battleId 룸) 전송
   */
  socket.on('chatMessage', ({ message, channel }) => {
    try {
      if (!socket.battleId || !message) return;
      const b = engine.getBattle(socket.battleId);
      if (!b) return;

      let text = String(message || '').trim();
      let finalChannel = (channel === 'team') ? 'team' : 'all';

      // 슬래시 커맨드 파싱: '/t ...'
      if (/^\/t\b/i.test(text)) {
        finalChannel = 'team';
        text = text.replace(/^\/t\b\s*/i, '');
      }
      if (!text) return;

      // 송신자/팀 판정
      let sender = '알 수 없음';
      let senderType = 'system';
      let senderTeam = null;

      if (socket.role === 'player') {
        const me = (b.teams.team1.players.concat(b.teams.team2.players)).find(p => p.id === socket.playerId);
        sender = me ? me.name : '플레이어';
        senderType = 'player';
        senderTeam = me?.team || socket.playerTeam || null;

        // 팀 채널인데 팀이 없으면 all로 강등
        if (finalChannel === 'team' && !senderTeam) finalChannel = 'all';
      } else if (socket.role === 'spectator') {
        sender = socket.spectatorName || '관전자';
        senderType = 'spectator';
        // 관전자는 팀 채팅 권한 없음 → 항상 all
        finalChannel = 'all';
      } else if (socket.role === 'admin') {
        sender = '관리자';
        senderType = 'admin';
        // 관리자도 기본은 all, 필요하면 명시 channel:'team' + team 지정 로직 확장 가능
      }

      const entry = {
        sender,
        message: text,
        senderType,
        channel: finalChannel,   // 'team' | 'all'
        team: finalChannel === 'team' ? (senderTeam || null) : null,
      };

      const saved = engine.addChatMessage(socket.battleId, entry);

      // 채널별 전송
      if (saved.channel === 'team' && saved.team) {
        // 같은 팀 플레이어들에게
        io.to(teamRoom(socket.battleId, saved.team)).emit('chatMessage', { message: saved });
        // 관리자에게도
        io.to(adminRoom(socket.battleId)).emit('chatMessage', { message: saved });
      } else {
        // 전체(관전자 포함)
        io.to(socket.battleId).emit('chatMessage', { message: saved });
      }

      // 주의: 채팅마다 battleUpdate 전체를 쏘지 않는다(팀 메시지 노출 방지 목적).
      // 다른 게임 이벤트에서만 broadcast 호출.

    } catch (e) {
      console.error('[socket chatMessage] error', e);
    }
  });

  // 관전자 응원(허용된 메시지만)
  socket.on('cheerMessage', ({ message }) => {
    if (!socket.battleId || socket.role !== 'spectator') return;
    const allowed = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    if (!allowed.includes(message)) return socket.emit('chatError', '허용되지 않은 응원 메시지입니다');

    const entry = {
      sender: socket.spectatorName || '관전자',
      message,
      senderType: 'spectator',
      channel: 'all',
      team: null,
    };
    const saved = engine.addChatMessage(socket.battleId, entry);
    io.to(socket.battleId).emit('chatMessage', { message: saved });
  });

  socket.on('adminMessage', ({ battleId, message }) => {
    if (socket.role !== 'admin' || !battleId || !message) return;
    const entry = {
      sender: '관리자',
      message,
      senderType: 'admin',
      channel: 'all',
      team: null,
    };
    const saved = engine.addChatMessage(battleId, entry);
    io.to(adminRoom(battleId)).emit('chatMessage', { message: saved });
    io.to(battleId).emit('chatMessage', { message: saved }); // 공지 성격이면 전체에도
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

// ────────────────────────── 서버 시작 ──────────────────────────
server.listen(PORT, () => {
  console.log(`Battle server listening on http://localhost:${PORT}`);
  console.log(`관리자 페이지: http://localhost:${PORT}/admin.html`);
});
