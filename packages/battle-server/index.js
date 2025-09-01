// packages/battle-server/index.js
// 기능 요약:
// - OTP 인증(admin | player | spectator)
// - 실시간 브로드캐스트(로스터/로그)
// - 플레이어 아바타 업로드
// - 관리자/플레이어 채팅 송신, 관전자 채팅 금지
// - 관전자 응원(화이트리스트, 3초 레이트리밋)
// - ★ 관전자 OTP별 동시접속 최대 30명 제한 추가
// 디자인/스타일 변경 없음. 이모지 없음.

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  }
});

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// 업로드 경로
const UPLOAD_DIR = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

// ===== 인메모리 상태 =====
const battles = Object.create(null);
/*
 battles[id] = {
   id, mode, players: [], spectators: [],
   started:false, turn:0, createdAt:ts,
   logs: [{ts,text,type}]
 }
*/

const otps = Object.create(null);
/*
  otps[token] = {
    role: 'admin'|'player'|'spectator',
    battleId, playerId?, name?, exp: timestamp
  }
*/

// 관전자 OTP 동시접속 카운트(track by battleId+otp)
const spectatorUsage = Object.create(null);
/*
 spectatorUsage[battleId] = {
   [otp]: currentCountNumber
 }
*/
const SPECTATOR_LIMIT_PER_OTP = 30;

// ===== 유틸 =====
function rid(prefix, size = 8) {
  return prefix + '_' + crypto.randomBytes(size).toString('hex').slice(0, size);
}
function now() { return Date.now(); }
function pushLog(battleId, text, type = 'system') {
  const b = battles[battleId];
  if (!b) return;
  const entry = { ts: now(), text: String(text), type };
  b.logs.push(entry);
  io.to(battleId).emit('log:append', entry);
}
function broadcastRoster(battleId) {
  const b = battles[battleId];
  if (!b) return;
  io.to(battleId).emit('roster:update', { id: b.id, players: b.players });
}
function incSpectatorCount(battleId, otp) {
  spectatorUsage[battleId] = spectatorUsage[battleId] || Object.create(null);
  spectatorUsage[battleId][otp] = (spectatorUsage[battleId][otp] || 0) + 1;
  return spectatorUsage[battleId][otp];
}
function decSpectatorCount(battleId, otp) {
  if (!spectatorUsage[battleId] || spectatorUsage[battleId][otp] == null) return;
  spectatorUsage[battleId][otp] = Math.max(0, spectatorUsage[battleId][otp] - 1);
  if (spectatorUsage[battleId][otp] === 0) delete spectatorUsage[battleId][otp];
  if (Object.keys(spectatorUsage[battleId]).length === 0) delete spectatorUsage[battleId];
}

// ===== API =====

// 헬스체크
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  const { mode } = req.body || {};
  if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'INVALID_MODE' });
  }
  const id = rid('b');
  battles[id] = {
    id, mode,
    players: [],
    spectators: [],
    started: false,
    turn: 0,
    createdAt: now(),
    logs: []
  };
  io.emit('battle:list:update', { id, mode });
  pushLog(id, `전투가 생성되었습니다. 모드: ${mode}`);
  return res.json({ ok: true, id });
});

// 플레이어 추가
app.post('/api/battles/:id/players', (req, res) => {
  const { id } = req.params;
  const b = battles[id];
  if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const { name, team, stats = {}, items = [] } = req.body || {};
  if (!name || !team) return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  if (!['불사조 기사단', '죽음을 먹는 자들'].includes(team)) {
    return res.status(400).json({ ok: false, error: 'INVALID_TEAM' });
  }

  const pid = rid('p');
  const p = {
    id: pid,
    name: String(name),
    team,
    stats: {
      atk: Number(stats.atk || 1),
      def: Number(stats.def || 1),
      agi: Number(stats.agi || 1),
      luk: Number(stats.luk || 1),
    },
    items: Array.isArray(items) ? items : [],
    hp: 100,
    alive: true,
    avatar: null
  };
  b.players.push(p);
  broadcastRoster(id);
  pushLog(id, `플레이어 "${p.name}"이(가) ${p.team}에 추가되었습니다.`);
  return res.json({ ok: true, player: p });
});

// OTP 발급 (admin | player | spectator)
app.post('/api/otp', (req, res) => {
  const { role, battleId, playerId, name } = req.body || {};
  if (!['admin','player','spectator'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'INVALID_ROLE' });
  }
  const b = battles[battleId];
  if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  if (role === 'player') {
    const exists = b.players.find(x => x.id === playerId);
    if (!exists) return res.status(400).json({ ok: false, error: 'PLAYER_NOT_FOUND' });
  }

  const token = crypto.randomBytes(12).toString('hex');
  otps[token] = {
    role,
    battleId,
    playerId: role === 'player' ? playerId : undefined,
    name: name ? String(name) : undefined,
    exp: now() + 1000 * 60 * 30 // 30분
  };
  return res.json({ ok: true, otp: token });
});

// OTP 검증(선택)
app.post('/api/auth', (req, res) => {
  const { otp, battleId, role } = req.body || {};
  const ticket = otps[otp];
  if (!ticket) return res.status(400).json({ ok: false, error: 'INVALID_OTP' });
  if (ticket.exp < now()) return res.status(400).json({ ok: false, error: 'EXPIRED_OTP' });
  if (ticket.battleId !== battleId) return res.status(400).json({ ok: false, error: 'BATTLE_MISMATCH' });
  if (ticket.role !== role) return res.status(400).json({ ok: false, error: 'ROLE_MISMATCH' });

  const b = battles[battleId];
  if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  let player = null;
  if (role === 'player') {
    player = b.players.find(x => x.id === ticket.playerId);
    if (!player) return res.status(400).json({ ok: false, error: 'PLAYER_NOT_FOUND' });
  }
  return res.json({ ok: true, player });
});

// 플레이어 아바타 업로드
app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  const { id } = req.params;
  const { playerId } = req.body || {};
  const b = battles[id];
  if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const player = b.players.find(x => x.id === playerId);
  if (!player) return res.status(400).json({ ok: false, error: 'PLAYER_NOT_FOUND' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });

  player.avatar = req.file.filename;
  broadcastRoster(id);
  pushLog(id, `플레이어 "${player.name}" 아바타가 업데이트되었습니다.`);
  return res.json({ ok: true, file: req.file.filename });
});

// ===== Socket.IO =====
io.on('connection', (socket) => {
  // 접속 클라이언트가 즉시 호출
  socket.on('session:init', ({ role, battleId, otp, name }) => {
    const ticket = otps[otp];
    if (!ticket) return;
    if (ticket.exp < now()) return;
    if (ticket.battleId !== battleId) return;
    if (ticket.role !== role) return;

    const b = battles[battleId];
    if (!b) return;

    // ★ 관전자 동시접속 제한 처리(OTP 단위)
    if (role === 'spectator') {
      // 이름은 로그/응원 표시에 쓰이므로 비워두지 않게 강제(선호)
      if (!name || !String(name).trim()) {
        // 이름이 비었으면 입장 불가로 처리
        socket.emit('log:append', { ts: now(), text: '이름을 입력해야 관전 입장이 가능합니다.', type: 'system' });
        return;
      }
      const current = spectatorUsage[battleId]?.[otp] || 0;
      if (current >= SPECTATOR_LIMIT_PER_OTP) {
        // 정중히 거절(소켓은 입장하지 않음)
        socket.emit('log:append', { ts: now(), text: `관전자 정원(OTP당 ${SPECTATOR_LIMIT_PER_OTP}명)을 초과했습니다.`, type: 'system' });
        return;
      }
      incSpectatorCount(battleId, otp);
      socket.data.spectatorOtp = otp; // disconnect 시 감산용
    }

    socket.data.role = role; // 'admin'|'player'|'spectator'
    socket.data.battleId = battleId;
    socket.data.name = (name && String(name).trim()) || ticket.name || role;
    socket.data.lastCheerTs = 0; // 관전자 응원 레이트리밋용

    if (role === 'player') {
      const playerObj = b.players.find(x => x.id === ticket.playerId);
      if (!playerObj) return;
      socket.data.playerId = playerObj.id;
    }

    socket.join(battleId);

    // 현재 상태 동기화
    socket.emit('roster:update', { id: b.id, players: b.players });
    socket.emit('log:bootstrap', b.logs);

    const roleLabel = role === 'player' ? '플레이어' : role === 'admin' ? '관리자' : '관전자';
    pushLog(battleId, `${socket.data.name} 님이 ${roleLabel}로 입장했습니다.`);

    // 채팅: 관전자는 송신 금지, 관리자/플레이어는 송신 허용
    socket.on('chat:message', (msg) => {
      if (!socket.data || socket.data.battleId !== battleId) return;
      if (socket.data.role === 'spectator') return;
      const safe = {
        name: socket.data.name,
        role: socket.data.role,
        text: String(msg?.text || ''),
        ts: now()
      };
      io.to(battleId).emit('chat:message', safe);
    });

    // ===== 관전자 응원 =====
    const ALLOWED_CHEERS = new Set([
      '화이팅','좋아요','멋져요','잘한다','역전 가자',
      '죽으면 죽어!','죽지마! 살아서 보자.'
    ]);

    socket.on('cheer', (payload) => {
      if (!socket.data || socket.data.battleId !== battleId) return;
      if (socket.data.role !== 'spectator') return; // 관전자만
      const text = String(payload?.text || '').trim();
      if (!ALLOWED_CHEERS.has(text)) return; // 허용 문구만

      const t = now();
      if (t - (socket.data.lastCheerTs || 0) < 3000) return; // 3초 제한
      socket.data.lastCheerTs = t;

      const team = payload?.team ? String(payload.team) : '';
      const nameShown = socket.data.name || '관객';
      const teamPart = team ? `[${team}] ` : '';

      pushLog(battleId, `${nameShown} 관전자 응원: ${teamPart}${text}`, 'cheer');

      io.to(battleId).emit('cheer', {
        name: nameShown, team, text, ts: t
      });
    });

    // 연결 종료
    socket.on('disconnect', () => {
      if (socket.data?.role === 'spectator' && socket.data?.spectatorOtp) {
        decSpectatorCount(socket.data.battleId, socket.data.spectatorOtp);
      }
      pushLog(battleId, `${socket.data?.name || '알 수 없음'} 님이 퇴장했습니다.`);
    });
  });
});

// ===== 서버 시작 =====
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
server.listen(PORT, () => {
  console.log('[battle-server] listening on :' + PORT);
});
