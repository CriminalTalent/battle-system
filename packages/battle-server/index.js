// packages/battle-server/index.js
// 최소 변경 패치: OTP 인증/실시간 브로드캐스트/관전자·플레이어 접속/아바타 업로드 복구
// 디자인/규칙/이모지 변경 없음

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

// 정적 파일 (디자인/자산 그대로 사용)
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

// 플레이어 추가 (+ 기본값 보정)
// 관리자 UI에서 호출된다고 가정
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

// OTP 발급 (관리자 UI에서 플레이어/관전자용 생성)
// role: 'player' | 'spectator'
// player의 경우 playerId 필요
app.post('/api/otp', (req, res) => {
  const { role, battleId, playerId, name } = req.body || {};
  if (!['player', 'spectator'].includes(role)) {
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

// (선택) OTP 단발 인증 확인 API (UI가 필요하면 사용)
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

// 플레이어 아바타 업로드 (폼필드: avatar)
// 인증은 소켓에서 이미 완료되었다고 가정하고, 여기서는 최소 검증
app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  const { id } = req.params;
  const { playerId } = req.body || {};
  const b = battles[id];
  if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const player = b.players.find(x => x.id === playerId);
  if (!player) return res.status(400).json({ ok: false, error: 'PLAYER_NOT_FOUND' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });

  player.avatar = req.file.filename; // 저장된 파일명
  broadcastRoster(id);
  pushLog(id, `플레이어 "${player.name}" 아바타가 업데이트되었습니다.`);
  return res.json({ ok: true, file: req.file.filename });
});

// ===== Socket.IO =====
io.on('connection', (socket) => {
  // 접속 클라이언트가 즉시 호출
  socket.on('session:init', ({ role, battleId, otp, name }) => {
    const ticket = otps[otp];
    if (!ticket) return; // 무시
    if (ticket.exp < now()) return;
    if (ticket.battleId !== battleId) return;
    if (ticket.role !== role) return;

    const b = battles[battleId];
    if (!b) return;

    socket.data.role = role;
    socket.data.battleId = battleId;
    socket.data.name = name || ticket.name || role;

    let playerObj = null;
    if (role === 'player') {
      playerObj = b.players.find(x => x.id === ticket.playerId);
      if (!playerObj) return;
      socket.data.playerId = playerObj.id;
    }

    socket.join(battleId);

    // 현재 상태 동기화
    socket.emit('roster:update', { id: b.id, players: b.players });
    socket.emit('log:bootstrap', b.logs);

    pushLog(battleId, `${socket.data.name} 님이 ${role === 'player' ? '플레이어' : '관전자'}로 입장했습니다.`);

    // 채팅: 관전자는 송신 금지
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

    // 연결 종료
    socket.on('disconnect', () => {
      // 알림만 남김 (플레이어 제거 X)
      pushLog(battleId, `${socket.data.name} 님이 퇴장했습니다.`);
    });
  });
});

// ===== 서버 시작 =====
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
server.listen(PORT, () => {
  console.log('[battle-server] listening on :' + PORT);
});
