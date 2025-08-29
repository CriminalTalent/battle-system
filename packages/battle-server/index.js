// packages/battle-server/index.js
// Express + Socket.IO 서버 (관리자 채팅 가능 / 관전자 채팅 불가, 응원 프리셋만)
// - 관전자/플레이어 OTP 30분, 관리자 OTP 60분
// - 아바타 업로드 검증(<=300KB, data:image/*;base64)
// - 1v1 / 2v2 / 3v3 / 4v4 지원, 한쪽 전멸 즉시 종료, 총 시간 1시간
// - 정적 라우트: /admin(.html), /play(.html), /watch(.html)
// - [호환] 전투 생성 엔드포인트 다수 허용: POST
//     /api/battles
//     /api/admin/battles
//     /api/battle
//     /api/admin/battle
//   (JSON / x-www-form-urlencoded / querystring 모두 지원)

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');

// BattleEngine 로딩(기본/이름 내보내기 모두 지원)
let BE = null;
try { BE = require('./src/services/BattleEngine'); } catch (e) {
  console.error('BattleEngine 로드 실패:', e && (e.stack || e.message || e));
}
const BattleEngine =
  (typeof BE === 'function') ? BE :
  (BE && typeof BE.BattleEngine === 'function') ? BE.BattleEngine :
  null;
if (!BattleEngine) {
  throw new Error('BattleEngine를 찾을 수 없습니다. ./src/services/BattleEngine 내보내기 확인');
}

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true })); // 폼 전송 호환

// 간단 요청 로거(원인 추적용)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// CORS
const ALLOW = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOW.includes('*') || ALLOW.includes(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'), false);
    },
    credentials: true,
  })
);

// 정적 파일
const pubDir = path.join(__dirname, 'public');
app.use(express.static(pubDir, { fallthrough: true }));

// 정적 파일 명시 라우팅
const send = (res, file) => res.sendFile(path.join(pubDir, file));
app.get('/admin', (req, res) => {
  const f = path.join(pubDir, 'admin.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  return res.redirect('/play');
});
app.get('/admin.html', (req, res) => {
  const f = path.join(pubDir, 'admin.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  return res.redirect('/play');
});
app.get('/play', (req, res) => send(res, 'play.html'));
app.get('/play.html', (req, res) => send(res, 'play.html'));
app.get('/watch', (req, res) => send(res, 'watch.html'));
app.get('/watch.html', (req, res) => send(res, 'watch.html'));

// 루트
app.get('/', (req, res) => {
  const hasAdmin = fs.existsSync(path.join(pubDir, 'admin.html'));
  return res.redirect(hasAdmin ? '/admin' : '/play');
});

// 인메모리 저장소
const battles = new Map();

function now() { return Date.now(); }
function genId(len = 12) { return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0, len); }
function genOTP(len = 24) { return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0, len); }
function minutes(n) { return n * 60 * 1000; }

const MODE_CONFIG = {
  '1v1': { playersPerTeam: 1 },
  '2v2': { playersPerTeam: 2 },
  '3v3': { playersPerTeam: 3 },
  '4v4': { playersPerTeam: 4 },
};
function safeMode(m) { return MODE_CONFIG[m] ? m : '1v1'; }
function room(bid) { return `battle:${bid}`; }

function sanitizePublicBattle(b) {
  const players = {};
  for (const pid of Object.keys(b.players)) {
    const p = b.players[pid];
    players[pid] = {
      id: p.id, name: p.name, team: p.team,
      hp: p.hp, maxHp: p.maxHp, alive: p.alive,
      stats: p.stats, inventory: p.inventory, avatar: p.avatar || null
    };
  }
  return {
    id: b.id, mode: b.mode, status: b.status,
    createdAt: b.createdAt, startedAt: b.startedAt || null, endsAt: b.endsAt || null,
    teams: b.teams, players,
    turn: b.engine.getTurnPublic ? b.engine.getTurnPublic() : null,
    chat: b.chat.slice(-200)
  };
}

function emitState(io, b) {
  if (b._emitScheduled) return;
  b._emitScheduled = true;
  setTimeout(() => {
    b._emitScheduled = false;
    io.to(room(b.id)).emit('state', sanitizePublicBattle(b));
  }, 10);
}

function createBattle(mode = '2v2') {
  const id = `battle_${genId(12)}`;
  const adminOTP = genOTP(24);
  const spectatorOTP = genOTP(24);
  const m = safeMode(mode);

  const b = {
    id,
    mode: m,
    config: MODE_CONFIG[m],
    status: 'waiting',
    createdAt: now(),
    startedAt: null,
    endsAt: null,
    maxDurationMs: 60 * 60 * 1000,
    teams: { team1: '불사조 기사단', team2: '죽음을 먹는 자들' },
    players: {},
    chat: [],
    tokens: {
      admin: { token: adminOTP, exp: now() + minutes(60) },
      spectator: { token: spectatorOTP, exp: now() + minutes(30) },
      players: {}, // token -> { pid, exp }
    },
    engine: null,
    _emitScheduled: false,
  };

  // 엔진 인스턴스(콜백 제공)
  b.engine = new BattleEngine(b, {
    onResolve: (logs) => {
      if (Array.isArray(logs) && logs.length) {
        for (const line of logs) b.chat.push({ type: 'system', ts: now(), text: line });
      }
    },
    onEnd: (reason) => {
      if (b.status !== 'ended') {
        b.status = 'ended';
        b.chat.push({ type: 'system', ts: now(), text: `전투 종료: ${reason}` });
      }
    },
  });

  battles.set(id, b);
  return b;
}

function findBattleOr404(req, res) {
  const b = battles.get(req.params.id);
  if (!b) { res.status(404).json({ error: 'battle_not_found' }); return null; }
  return b;
}

app.get('/api/health', (req, res) => res.json({ ok: true, ts: now() }));

// ------------------------
// 전투 생성(호환 라우트 묶음)
// ------------------------
function extractMode(req) {
  // JSON/폼/쿼리 어디서든 mode를 허용
  return (req.body && req.body.mode) || req.query.mode || undefined;
}
function createBattleResponse(req, res) {
  const mode = extractMode(req) || '2v2';
  const b = createBattle(mode);
  res.json({
    ok: true,
    battle: sanitizePublicBattle(b),
    otps: { admin: b.tokens.admin.token, spectator: b.tokens.spectator.token },
    urls: {
      admin: absoluteUrl(req, `/admin?battle=${b.id}&token=${b.tokens.admin.token}`),
      watch: absoluteUrl(req, `/watch?battle=${b.id}&token=${b.tokens.spectator.token}&name=${encodeURIComponent('관전자')}`),
    },
  });
}
// 신규 사양
app.post('/api/battles', createBattleResponse);
// 구형/관리자 사양 호환
app.post('/api/admin/battles', createBattleResponse);
app.post('/api/battle', createBattleResponse);
app.post('/api/admin/battle', createBattleResponse);

// 플레이어 추가(대기중)
app.post('/api/battles/:id/players', (req, res) => {
  const b = findBattleOr404(req, res); if (!b) return;
  if (b.status !== 'waiting') return res.status(400).json({ error: 'already_started' });

  const { name, team } = req.body || {};
  const stats = (req.body && req.body.stats) || {};
  const inventory = Array.isArray(req.body && req.body.inventory) ? req.body.inventory : [];

  if (!name || !team) return res.status(400).json({ error: 'invalid_payload' });
  if (!['team1','team2'].includes(team)) return res.status(400).json({ error: 'invalid_team' });

  // 이름 중복 금지
  for (const pid of Object.keys(b.players)) {
    if (b.players[pid].name === name) return res.status(400).json({ error: 'duplicate_name' });
  }
  // 팀 수용 제한
  const maxTeam = b.config.playersPerTeam;
  const teamCount = Object.values(b.players).filter(p => p.team === team).length;
  if (teamCount >= maxTeam) return res.status(400).json({ error: 'team_full' });

  const pid = `p_${genId(10)}`;
  b.players[pid] = {
    id: pid,
    name,
    team,
    hp: 100, maxHp: 100, alive: true,
    stats: {
      attack: clampInt(stats.attack, 1, 5),
      defense: clampInt(stats.defense, 1, 5),
      agility: clampInt(stats.agility, 1, 5),
      luck: clampInt(stats.luck, 1, 5),
    },
    inventory: inventory.slice(0, 10),
    avatar: null,
  };

  emitState(io, b);
  res.json({ ok: true, player: b.players[pid] });
});

// 플레이어별 참여 링크(OTP 발급)
app.post('/api/admin/battles/:id/links', (req, res) => {
  const b = findBattleOr404(req, res); if (!b) return;

  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const playerLinks = [];
  for (const pid of Object.keys(b.players)) {
    const p = b.players[pid];
    const token = genOTP(24);
    b.tokens.players[token] = { pid, exp: now() + minutes(30) }; // 30분
    const url = `${base}/play?battle=${b.id}&token=${token}&name=${encodeURIComponent(p.name)}&pid=${pid}`;
    playerLinks.push({ pid, name: p.name, url, token });
  }
  res.json({
    ok: true,
    urls: {
      player: `${base}/play`,
      watch: `${base}/watch?battle=${b.id}&token=${b.tokens.spectator.token}`,
    },
    playerLinks,
  });
});

// 전투 제어
app.post('/api/admin/battles/:id/start', (req, res) => {
  const b = findBattleOr404(req, res); if (!b) return;
  if (!['waiting','paused'].includes(b.status)) return res.status(400).json({ error: 'invalid_state' });

  b.status = 'ongoing';
  b.startedAt = b.startedAt || now();
  b.endsAt = b.startedAt + b.maxDurationMs;
  if (typeof b.engine.onStart === 'function') b.engine.onStart();
  emitState(io, b);
  res.json({ ok: true, battle: sanitizePublicBattle(b) });
});

app.post('/api/admin/battles/:id/pause', (req, res) => {
  const b = findBattleOr404(req, res); if (!b) return;
  if (b.status !== 'ongoing') return res.status(400).json({ error: 'invalid_state' });
  b.status = 'paused';
  emitState(io, b);
  res.json({ ok: true });
});

app.post('/api/admin/battles/:id/end', (req, res) => {
  const b = findBattleOr404(req, res); if (!b) return;
  b.status = 'ended';
  if (b.engine && typeof b.engine.forceEnd === 'function') b.engine.forceEnd('관리자 종료');
  emitState(io, b);
  res.json({ ok: true });
});

// 아바타 업로드(HTTP 경로; 소켓도 지원)
app.post('/api/battles/:id/players/:pid/avatar', (req, res) => {
  const b = findBattleOr404(req, res); if (!b) return;
  const { pid } = req.params;
  const p = b.players[pid]; if (!p) return res.status(404).json({ error: 'player_not_found' });

  const { dataUrl } = req.body || {};
  const ok = validateAndApplyAvatar(p, dataUrl);
  if (!ok.ok) return res.status(400).json({ error: ok.error });

  emitState(io, b);
  res.json({ ok: true });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error('[Express Error]', err && (err.stack || err.message || err));
  res.status(500).send('Internal Server Error');
});

// Socket.IO
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  path: '/socket.io/',
  cors: { origin: ALLOW.includes('*') ? true : ALLOW, credentials: true },
});

io.on('connection', (socket) => {
  socket._auth = { ok: false };

  socket.on('auth', (payload, ack) => {
    try {
      const { battle, token, role, name } = payload || {};
      const b = battles.get(battle);
      if (!b) return ack && ack({ ok: false, error: 'battle_not_found' });

      let authed = false; let linkedPid = null;
      if (role === 'admin') {
        authed = token === b.tokens.admin.token && b.tokens.admin.exp > now();
      } else if (role === 'spectator') {
        authed = token === b.tokens.spectator.token && b.tokens.spectator.exp > now();
      } else if (role === 'player') {
        // 토큰 직접 매칭
        if (token && b.tokens.players[token] && b.tokens.players[token].exp > now()) {
          linkedPid = b.tokens.players[token].pid;
          authed = !!b.players[linkedPid];
        }
        // 혹시 구형 클라이언트가 name만 보내는 경우(관리자 발급 링크 없이)
        if (!authed && name) {
          const entry = Object.entries(b.tokens.players).find(([, v]) => v.exp > now() && b.players[v.pid] && b.players[v.pid].name === name);
          if (entry) { linkedPid = entry[1].pid; authed = true; }
        }
      }
      if (!authed) return ack && ack({ ok: false, error: 'auth_failed' });

      socket._auth = { ok: true, role, battle: battle, pid: linkedPid || null, name: name || null };
      socket.join(room(battle));

      if (role !== 'spectator') b.chat.push({ type: 'system', ts: now(), text: `${role === 'admin' ? '관리자' : (name || '플레이어')} 접속` });
      emitState(io, b);
      ack && ack({ ok: true, state: sanitizePublicBattle(b) });
    } catch (e) {
      console.error('[auth handler error]', e);
      ack && ack({ ok: false, error: 'auth_exception' });
    }
  });

  // 관리자/플레이어 채팅 허용, 관전자 불가
  socket.on('chatMessage', (payload) => {
    const a = socket._auth; if (!a.ok) return;
    const b = battles.get(a.battle); if (!b) return;

    if (a.role === 'spectator') { socket.emit('chatError', '관전자는 채팅을 보낼 수 없습니다'); return; }
    const { message, channel } = payload || {};
    if (!message || typeof message !== 'string') return;

    const msg = {
      type: 'chat', ts: now(),
      from: a.role === 'admin' ? '관리자' : (a.name || '플레이어'),
      channel: channel === 'team' ? 'team' : 'all',
      text: message.slice(0, 500),
      pid: a.pid || null, role: a.role,
    };
    b.chat.push(msg);
    io.to(room(b.id)).emit('chat', msg);
  });

  // 관전자 응원(프리셋만)
  socket.on('cheer', (payload) => {
    const a = socket._auth; if (!a.ok) return;
    const b = battles.get(a.battle); if (!b) return;
    if (a.role !== 'spectator') return;

    const allowed = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!'];
    const { text } = payload || {};
    if (!allowed.includes(text)) return;

    const msg = { type: 'cheer', ts: now(), from: a.name || '관전자', text };
    b.chat.push(msg);
    io.to(room(b.id)).emit('chat', msg);
  });

  // 아바타(소켓)
  socket.on('uploadAvatar', (payload, ack) => {
    const a = socket._auth; if (!a.ok) return ack && ack({ ok: false, error: 'unauthorized' });
    if (a.role !== 'player' || !a.pid) return ack && ack({ ok: false, error: 'not_player' });
    const b = battles.get(a.battle); if (!b) return ack && ack({ ok: false, error: 'battle_not_found' });
    const p = b.players[a.pid]; if (!p) return ack && ack({ ok: false, error: 'player_not_found' });

    const { dataUrl } = payload || {};
    const ok = validateAndApplyAvatar(p, dataUrl);
    if (!ok.ok) return ack && ack({ ok: false, error: ok.error });

    emitState(io, b);
    ack && ack({ ok: true });
  });

  // 액션 선택
  socket.on('chooseAction', (payload, ack) => {
    const a = socket._auth; if (!a.ok) return ack && ack({ ok: false, error: 'unauthorized' });
    if (a.role !== 'player' || !a.pid) return ack && ack({ ok: false, error: 'not_player' });

    const b = battles.get(a.battle); if (!b) return ack && ack({ ok: false, error: 'battle_not_found' });
    if (b.status !== 'ongoing') return ack && ack({ ok: false, error: 'invalid_state' });

    const { kind, targetId, itemName } = payload || {};
    const result = b.engine.chooseAction ? b.engine.chooseAction(a.pid, { kind, targetId, itemName }) : { ok: false, error: 'engine_missing' };
    if (!result.ok) return ack && ack(result);

    emitState(io, b);
    ack && ack({ ok: true, pending: result.pending });
    if (result.resolved) emitState(io, b);
  });

  socket.on('requestState', (payload, ack) => {
    const a = socket._auth; if (!a.ok) return;
    const b = battles.get(a.battle); if (!b) return;
    ack && ack({ ok: true, state: sanitizePublicBattle(b) });
  });
});

// 유틸
function clampInt(v, min, max) {
  const n = Math.floor(Number(v || 0));
  return Math.min(Math.max(n, min), max);
}
function absoluteUrl(req, p) {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return base + p;
}
function validateAndApplyAvatar(player, dataUrl) {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'invalid_data' };
  if (!dataUrl.startsWith('data:image/')) return { ok: false, error: 'invalid_mime' };
  const comma = dataUrl.indexOf(','); if (comma === -1) return { ok: false, error: 'invalid_data' };
  const b64 = dataUrl.slice(comma + 1);
  try {
    const buf = Buffer.from(b64, 'base64');
    if (!buf || !buf.length) return { ok: false, error: 'invalid_base64' };
    if (buf.length > 300 * 1024) return { ok: false, error: 'too_large' };
  } catch { return { ok: false, error: 'invalid_base64' }; }
  player.avatar = dataUrl;
  return { ok: true };
}

// 서버 시작
httpServer.listen(PORT, HOST, () => {
  console.log(`Battle server on http://${HOST}:${PORT}`);
  console.log(`Static root: ${pubDir}`);
  console.log('Access pages: /admin  /play  /watch');
});
