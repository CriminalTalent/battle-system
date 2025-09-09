// PYXIS Battle Server - Entry (ESM, Turn Timer, CORS/.env/Proxy)
// Node.js >= 18

import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// 전투 엔진
import { resolveAction } from './engine/combat.js';
import { nextTurn, isBattleOver, winnerByHpSum } from './engine/turns.js';

// ── 환경설정 로드
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// CORS 허용 도메인
const ALLOW_ORIGINS = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Express CORS
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOW_ORIGINS.includes('*') || ALLOW_ORIGINS.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('CORS blocked'), false);
    },
    credentials: true,
  })
);

// Socket.IO
const io = new Server(server, {
  cors: { origin: ALLOW_ORIGINS.includes('*') ? true : ALLOW_ORIGINS, credentials: true },
});

// 프록시 신뢰(HTTPS 판단)
if (String(process.env.TRUST_PROXY || '0') === '1') {
  app.set('trust proxy', true);
}

app.use(express.json());

// 정적 파일 루트: public
app.use(express.static(path.join(__dirname, 'public')));

// 업로드(이미지) - public 아래 저장
const upload = multer({ dest: path.join(__dirname, 'public/uploads/avatars') });

// ─────────────────────────────────────────────
// 인메모리 저장소
// ─────────────────────────────────────────────
const BATTLES = new Map();

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function newId(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function battleRoom(id) {
  return id;
}

function broadcastUpdate(battle) {
  io.to(battleRoom(battle.id)).emit('battleUpdate', battle);
}

function pushLog(battle, type, message) {
  const entry = { t: Date.now(), type, message };
  battle.log.push(entry);
  io.to(battleRoom(battle.id)).emit('battle:log', entry);
  broadcastUpdate(battle);
}

// ─────────────────────────────────────────────
// 5분 턴 타이머
// ─────────────────────────────────────────────
const TURN_MS = 5 * 60 * 1000;

function startTurnTimer(battle) {
  stopTurnTimer(battle);
  battle.turnTimer = { endAt: Date.now() + TURN_MS };
  battle.turnTimer.iv = setInterval(() => {
    const remaining = Math.max(0, battle.turnTimer.endAt - Date.now());
    io.to(battleRoom(battle.id)).emit('turn:tick', { remaining });
    if (remaining <= 0) {
      const cur = (battle.players || []).find((p) => p.id === battle.turn.current);
      if (cur) pushLog(battle, 'system', `${cur.name} 시간 초과로 턴 종료`);
      advanceTurn(battle);
    }
  }, 1000);
}

function stopTurnTimer(battle) {
  if (battle?.turnTimer?.iv) clearInterval(battle.turnTimer.iv);
  if (battle) battle.turnTimer = undefined;
}

function resetTurnTimer(battle) {
  startTurnTimer(battle);
}

function advanceTurn(battle) {
  nextTurn(battle);
  pushLog(battle, 'system', `턴 변경: ${getCurrentPlayerName(battle)}`);
  resetTurnTimer(battle);
}

function getCurrentPlayerName(battle) {
  const p = (battle.players || []).find((x) => x.id === battle.turn.current);
  return p ? p.name : '-';
}

// ─────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/battles', (req, res) => {
  const mode = req.body?.mode || '1v1';
  const id = newId('battle');
  const adminToken = newId('admin');

  const battle = {
    id,
    mode,
    status: 'waiting',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    adminToken,
    players: [],
    turn: { current: null, lastChange: null },
    log: [],
  };

  BATTLES.set(id, battle);
  console.log(`[${new Date().toISOString()}] Battle created (mode ${mode})`);
  res.json({ id, token: adminToken, battle });
});

app.get('/api/battles/:id', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
});

app.post('/api/battles/:id/players', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });

  const { name, team, stats, items, avatar } = req.body || {};
  const player = {
    id: newId('p'),
    name: String(name || '전투 참가자'),
    team: team === 'A' || team === 'phoenix' ? 'phoenix' : 'eaters',
    stats: {
      atk: Number(stats?.atk ?? 0),
      def: Number(stats?.def ?? 0),
      agi: Number(stats?.agi ?? 0),
      luk: Number(stats?.luk ?? 0),
    },
    items: Array.isArray(items) ? items.slice(0, 50) : [],
    avatar: avatar || '',
    hp: 100,
    maxHp: 100,
    ready: false,
  };

  b.players.push(player);
  pushLog(b, 'system', `Player joined: ${player.name} [${player.team}]`);
  res.json(player);
});

app.delete('/api/battles/:id/players/:pid', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  const idx = b.players.findIndex((p) => p.id === req.params.pid);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [rm] = b.players.splice(idx, 1);
  pushLog(b, 'system', `Player removed: ${rm.name}`);
  res.json({ ok: true });
});

// 전투 제어
app.post('/api/admin/battles/:id/start', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  if (b.status === 'live') return res.json({ ok: true });
  startBattle(b);
  res.json({ ok: true });
});

app.post('/api/admin/battles/:id/end', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  endBattle(b, '전투 종료(관리자)');
  res.json({ ok: true });
});

// 이미지 업로드
app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const url = `/uploads/avatars/${req.params.id}/${req.file.filename}`;
  res.json({ ok: true, url });
});

// ─────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  // 관리자 인증
  socket.on('adminAuth', ({ battleId, token }) => {
    const b = BATTLES.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit('authError', { error: 'unauthorized' });
      return;
    }
    socket.join(battleRoom(battleId));
    socket.emit('authSuccess', { battle: b });
    pushLog(b, 'system', '관리자 접속');
  });

  // 플레이어 인증(간단: 이름 매칭)
  socket.on('player:auth', ({ battleId, otp, name }) => {
    const b = BATTLES.get(battleId);
    if (!b) return socket.emit('auth:fail', { reason: '전투를 찾을 수 없습니다.' });
    const player = b.players.find((p) => p.name === name);
    if (!player) return socket.emit('auth:fail', { reason: '참가자를 찾을 수 없습니다.' });

    socket.join(battleRoom(battleId));
    socket.data.playerId = player.id;
    socket.emit('auth:success', { player, players: b.players, snapshot: b });
    pushLog(b, 'system', `플레이어 인증: ${name}`);
  });

  // 관전자 입장
  socket.on('spectator:join', ({ battleId, otp, name }) => {
    const b = BATTLES.get(battleId);
    if (!b) return socket.emit('authError', { error: 'BATTLE_NOT_FOUND' });
    socket.join(battleRoom(battleId));
    socket.emit('spectator:join_ok', { battle: b });
    pushLog(b, 'system', `관전자 입장: ${name || '관전자'}`);
  });

  // 플레이어 준비
  socket.on('player:ready', ({ battleId, playerId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;
    p.ready = true;
    pushLog(b, 'system', `${p.name} 준비 완료`);
    if (b.players.length > 0 && b.players.every((x) => x.ready) && b.status !== 'live') {
      startBattle(b);
    }
  });

  // 행동 수행
  socket.on('player:action', ({ battleId, playerId, action }) => {
    const b = BATTLES.get(battleId);
    if (!b || b.status !== 'live') return;

    const result = resolveAction(b, {
      actorId: playerId,
      type: action?.type,
      targetId: action?.target,
      itemType: action?.itemType,
    });

    // HP 반영
    if (result.updates?.hp) {
      for (const [pid, hp] of Object.entries(result.updates.hp)) {
        const pl = b.players.find((x) => x.id === pid);
        if (pl) pl.hp = hp;
      }
    }

    // 로그
    for (const l of result.logs || []) {
      pushLog(b, l.type || 'system', l.message || '');
    }

    // 종료/턴
    if (isBattleOver(b)) {
      const w = winnerByHpSum(b);
      pushLog(
        b,
        'system',
        `전투 종료. 승자: ${w ? (w === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들') : '무승부'}`
      );
      endBattle(b);
    } else if (result.turnEnded) {
      advanceTurn(b);
    } else {
      broadcastUpdate(b);
    }
  });

  // 채팅
  socket.on('chat:send', ({ battleId, msg, name }) => {
    const b = BATTLES.get(battleId);
    if (!b || !msg) return;
    io.to(battleRoom(battleId)).emit('battle:chat', { name: String(name || '익명'), msg: String(msg) });
    pushLog(b, 'chat', `${String(name || '익명')}: ${String(msg)}`);
  });

  // 응원
  socket.on('spectator:cheer', ({ battleId, name, msg }) => {
    const b = BATTLES.get(battleId);
    if (!b || !msg) return;
    io.to(battleRoom(battleId)).emit('battle:chat', { name: String(name || '관전자'), msg: String(msg) });
    pushLog(b, 'cheer', `${String(name || '관전자')}: ${String(msg)}`);
  });
});

// ─────────────────────────────────────────────
// 전투 시작/종료
// ─────────────────────────────────────────────
function startBattle(battle) {
  if (!battle) return;
  battle.status = 'live';
  battle.startedAt = Date.now();

  // 선공: 팀별 민첩 합
  const sumA = battle.players.filter((p) => p.team === 'phoenix').reduce((s, p) => s + (p.stats?.agi || 0), 0);
  const sumB = battle.players.filter((p) => p.team === 'eaters').reduce((s, p) => s + (p.stats?.agi || 0), 0);
  const firstTeam = sumA >= sumB ? 'phoenix' : 'eaters';
  const first = battle.players.find((p) => p.team === firstTeam);
  if (first) {
    battle.turn.current = first.id;
    battle.turn.lastChange = Date.now();
  }

  pushLog(battle, 'system', `전투 시작! 선공: ${getCurrentPlayerName(battle)}`);
  startTurnTimer(battle);
  broadcastUpdate(battle);
}

function endBattle(battle, reason = '전투 종료') {
  if (!battle) return;
  battle.status = 'ended';
  battle.endedAt = Date.now();
  stopTurnTimer(battle);
  pushLog(battle, 'system', reason);
  broadcastUpdate(battle);
}

// ─────────────────────────────────────────────
// 서버 시작
// ─────────────────────────────────────────────
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, HOST, () => {
  console.log(`[INFO] PYXIS server started on ${HOST}:${PORT}`);
});
