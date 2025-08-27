// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버 (Nginx 프록시 대상: :3001)
// 필요 라우트 포함: /api/health, /api/battles, /api/battles/:id, /api/battles/:id/players
// 관리자 전용: /api/admin/battles/:id/links, /api/admin/battles/:id/end

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

// BattleEngine: 내부에서 Map으로 battles 관리 (id, otps, players 등)
const BattleEngine = require('./services/BattleEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // 필요 시 도메인 제한 가능
  cors: { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
});

const PORT = process.env.PORT || 3001;
const battleEngine = new BattleEngine();

// ───────────────────────────────────────────────────────────────────────────────
// 미들웨어
// ───────────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일: ../public (admin.html, play.html, watch.html 등)
app.use(express.static(path.join(__dirname, '../public')));

// ───────────────────────────────────────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────────────────────────────────────
function baseUrlFromReq(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// 헬스체크
// ───────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    battles: battleEngine.getBattleCount(),
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 배틀 생성 / 조회 / 참여
// ───────────────────────────────────────────────────────────────────────────────

// 배틀 생성
// body: { mode?: "1v1" | string, adminId?: string }
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId = null } = req.body || {};
    const battle = battleEngine.createBattle(mode, adminId);
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
    const battle = battleEngine.getBattle(id);
    if (!battle) return res.status(404).json({ error: 'battle_not_found', id });
    return res.json(battle);
  } catch (e) {
    console.error('[GET /api/battles/:id] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 플레이어 참여 (프런트 play.html이 호출)
// body 예: { playerId?: string, name?: string, role?: "player"|"spectator" }
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const { playerId = null, name = null, role = 'player' } = req.body || {};

    const battle = battleEngine.getBattle(id);
    if (!battle) return res.status(404).json({ error: 'battle_not_found', id });

    // BattleEngine에 명시적 메소드가 없다면 players 배열에 최소 정보 기록
    if (!Array.isArray(battle.players)) battle.players = [];
    const joined = {
      id: playerId || `p_${Date.now()}`,
      name: name || 'anonymous',
      role,
      joinedAt: Date.now(),
    };
    battle.players.push(joined);

    return res.status(201).json({ ok: true, player: joined, battleId: id });
  } catch (e) {
    console.error('[POST /api/battles/:id/players] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// 관리자용: 링크 생성 / 종료
// ───────────────────────────────────────────────────────────────────────────────

// 링크/OTP 반환 (프런트 admin.html이 호출)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const battle = battleEngine.getBattle(id);
    if (!battle) {
      return res.status(404).json({ error: 'battle_not_found', id });
    }
    const baseUrl = baseUrlFromReq(req);
    return res.json({
      id,
      otps: battle.otps, // { admin, player, spectator }
      urls: {
        admin:     `${baseUrl}/admin?battle=${id}&token=${battle.otps.admin}`,
        player:    `${baseUrl}/play?battle=${id}&token=${battle.otps.player}`,
        spectator: `${baseUrl}/watch?battle=${id}&token=${battle.otps.spectator}`,
      },
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// 배틀 종료(삭제)
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const exists = !!battleEngine.getBattle(id);
    if (!exists) {
      return res.status(404).json({ error: 'battle_not_found', id });
    }
    // BattleEngine은 내부 Map 사용
    battleEngine.battles.delete(id);
    return res.json({ ok: true, ended: id });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/end] error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Socket.IO
// ───────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // 관리자 인증 (admin.html에서 emit)
  socket.on('adminAuth', ({ battleId, otp }) => {
    try {
      const result = battleEngine.adminAuth(battleId, otp);
      if (!result || !result.battle) {
        socket.emit('authFailed', { reason: 'invalid_otp_or_battle' });
        return;
      }
      socket.role = 'admin';
      socket.join(`${battleId}-admin`);
      socket.emit('authSuccess', { role: 'admin', battle: result.battle });
    } catch (e) {
      console.error('[socket adminAuth] error', e);
      socket.emit('authFailed', { reason: 'internal_error' });
    }
  });

  // (예시) 관리자 메시지 브로드캐스트
  socket.on('adminMessage', ({ battleId, message }) => {
    if (socket.role !== 'admin') return;
    io.to(`${battleId}-admin`).emit('adminBroadcast', { message, at: Date.now() });
  });

  socket.on('disconnect', () => {
    // 필요 시 정리 로직
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 서버 시작
// ───────────────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Battle server listening on http://localhost:${PORT}`);
  console.log(`관리자 페이지(정적): http://localhost:${PORT}/admin.html`);
});
