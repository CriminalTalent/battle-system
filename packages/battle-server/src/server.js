// packages/battle-server/src/server.js
// Express + Socket.IO 기반 API 서버 (updated)
// - 팀 이름 고정: "불사조 기사단" / "죽음을 먹는 자들"
// - 관리자: 로스터 추가(스탯/아이템/아바타 업로드) + 플레이어별 링크
// - 플레이어: 이름 또는 ID로 인증 (OTP 필수)
// - 관전자: 별도 OTP + 자유 닉네임
// - 채팅: /t 팀채팅 분리, 관리자 채팅 고정
// - 아바타 업로드: /api/upload/avatar (multer)

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');

const BattleEngine = require('./services/BattleEngine');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const app = express();
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') },
  path: '/socket.io/',
});

const engine = new BattleEngine();

app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// 업로드 폴더 준비 (public/uploads)
const uploadDir = path.join(publicDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Multer 설정
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, safe);
  },
});
const fileFilter = (_req, file, cb) => {
  const ok = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '');
  cb(ok ? null : new Error('invalid_file_type'), ok);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

// 루트 → /admin
app.get('/', (_req, res) => res.redirect('/admin'));

// SPA 단일 진입
app.get(['/admin', '/play', '/watch'], (req, res) => {
  const page = (req.path.replace('/', '') || 'admin') + '.html';
  res.sendFile(path.join(publicDir, page));
});

// 유틸
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

// 헬스
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    battles: engine.getBattleCount(),
    connections: io.engine.clientsCount,
  });
});

// 이미지 업로드 (아바타)
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    // 정적 경로 기준 URL
    const url = `/uploads/${req.file.filename}`;
    return res.json({ ok: true, url });
  } catch (e) {
    console.error('[POST /api/upload/avatar] error', e);
    res.status(500).json({ error: 'upload_failed' });
  }
});

// 배틀 목록
app.get('/api/battles', (_req, res) => {
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

// 배틀 생성
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
    res.status(500).json({ error: 'internal_error' });
  }
});

// 배틀 조회
app.get('/api/battles/:id', (req, res) => {
  const { id } = req.params;
  const b = engine.getBattle(id);
  if (!b) return res.status(404).json({ error: 'battle_not_found', id });
  res.json(b);
});

// 로스터 추가
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const { name, team, stats, inventory = [], imageUrl = '' } = req.body || {};
    const p = engine.addPlayer(id, { name, team, stats, inventory, imageUrl });
    broadcast(id);
    res.status(201).json({ ok: true, battleId: id, player: p });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'bad_request' });
  }
});

// 플레이어 제거
app.delete('/api/battles/:id/players/:playerId', (req, res) => {
  try {
    const { id, playerId } = req.params;
    const result = engine.removePlayer(id, playerId);
    if (result.success) {
      broadcast(id);
      return res.json({ ok: true });
    }
    return res.status(404).json({ ok: false, error: result.message });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// 링크 집합
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: 'battle_not_found', id });

    const baseUrl = baseUrlFromReq(req);
    const { admin, player, spectator } = b.otps;

    const playerLinks = [
      ...(b.teams?.team1?.players || []),
      ...(b.teams?.team2?.players || []),
    ].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      url: `${baseUrl}/play?battle=${encodeURIComponent(
        id
      )}&token=${encodeURIComponent(player)}&name=${encodeURIComponent(
        p.name
      )}&pid=${encodeURIComponent(p.id)}`,
    }));

    res.json({
      id,
      otps: b.otps,
      urls: {
        admin: `${baseUrl}/admin?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(admin)}`,
        player: `${baseUrl}/play?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(player)}`,
        spectator: `${baseUrl}/watch?battle=${encodeURIComponent(
          id
        )}&token=${encodeURIComponent(spectator)}`,
      },
      playerLinks,
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links] error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 시작/일시정지/종료
app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const b = engine.startBattle(req.params.id);
    broadcast(req.params.id);
    res.json({ ok: true, battle: b });
  } catch (e) {
    const msg = e.message || 'bad_request';
    res.status(/전투 없음/.test(msg) ? 404 : 400).json({ ok: false, error: msg });
  }
});
app.post('/api/admin/battles/:id/pause', (req, res) => {
  try {
    const id = req.params.id;
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
    res.json({ ok: true, battle: b });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const id = req.params.id;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ ok: false, error: 'battle_not_found' });
    engine.endBattle(id, null, '관리자 종료');
    broadcast(id);
    res.json({ ok: true, ended: id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  socket.role = null;
  socket.battleId = null;
  socket.playerId = null;
  socket.playerTeam = null;
  socket.spectatorName = null;

  const roomAll = (id) => id;
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
      socket.emit('authError', 'internal_error');
    }
  });

  // 플레이어 인증 (ID 또는 이름)
  socket.on('playerAuth', ({ battleId, otp, playerId, playerName }) => {
    try {
      let result;
      if (playerId) result = engine.playerAuth(battleId, otp, playerId);
      else if (playerName) result = engine.playerAuthByName(battleId, otp, playerName);
      else return socket.emit('authError', '플레이어 ID 또는 이름이 필요합니다');

      if (!result?.success) return socket.emit('authError', result?.message || '인증 실패');

      const p = result.player;
      socket.join(roomAll(battleId));
      socket.join(roomTeam(battleId, p.team));

      socket.role = 'player';
      socket.battleId = battleId;
      socket.playerId = p.id;
      socket.playerTeam = p.team;

      socket.emit('authSuccess', { role: 'player', battle: result.battle, player: p });
      broadcast(battleId);
    } catch {
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
    } catch {
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

  // 채팅
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

      const out = {
        sender: entry.sender,
        senderType: entry.senderType,
        message: entry.message,
        channel: entry.channel,
        team: entry.team,
        timestamp: entry.timestamp,
      };

      if (chan === 'team' && socket.role === 'player' && socket.playerTeam) {
        io.to(roomTeam(bId, socket.playerTeam)).emit('chatMessage', out);
        io.to(roomAdmin(bId)).emit('chatMessage', out);
      } else {
        io.to(roomAll(bId)).emit('chatMessage', out);
      }

      broadcast(bId);
    } catch (e) {
      console.error('[chatMessage] error', e);
      socket.emit('chatError', 'internal_error');
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.role === 'player' && socket.battleId && socket.playerId) {
        const b = engine.getBattle(socket.battleId);
        if (b) {
          engine.addBattleLog(socket.battleId, 'system', `${socket.playerId} 연결 해제`);
          broadcast(socket.battleId);
        }
      }
    } catch {}
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Battle server listening on http://${HOST}:${PORT}`);
  console.log(`Static root: ${publicDir}`);
  console.log(`Access pages: /admin  /play  /watch`);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
