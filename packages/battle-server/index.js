// PYXIS Battle Server - Entry (ESM, Turn Timer, CORS/.env)
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', credentials: true } });

// 정적 및 파서
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 업로드 디렉터리: public/uploads/avatars
const upload = multer({ dest: path.join(__dirname, 'public/uploads/avatars') });

// 인메모리 저장
const BATTLES = new Map(); // id -> battle
const TURN_TIMERS = new Map(); // id -> timeout id

// 유틸
function newId(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}
function now() { return Date.now(); }
function battleRoom(id) { return id; }

function pushLog(battle, type, message) {
  battle.log.push({ type, message, ts: now() });
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
}
function broadcastUpdate(battle) {
  const payload = {
    id: battle.id,
    status: battle.status,
    turn: battle.turn,
    current: battle.current,
    startedAt: battle.startedAt,
    endedAt: battle.endedAt,
    turnEndsAt: battle.turnEndsAt,
    players: battle.players.map(p => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp, ready: !!p.ready, avatarUrl: p.avatarUrl, stats: p.stats
    })),
    log: battle.log.slice(-200)
  };
  io.to(battleRoom(battle.id)).emit('battle:update', payload);
}

// 턴 타이머
function startTurnTimer(battle) {
  stopTurnTimer(battle);
  const ms = battle.turnMs || 5 * 60 * 1000;
  battle.turnEndsAt = now() + ms;
  const tid = setTimeout(() => {
    // 시간 초과: 자동 패스 처리
    pushLog(battle, 'system', '턴 시간 초과로 자동 진행');
    nextTurn(battle);
    if (isBattleOver(battle)) {
      endBattle(battle);
    } else {
      broadcastUpdate(battle);
      startTurnTimer(battle);
    }
  }, ms);
  TURN_TIMERS.set(battle.id, tid);
}
function stopTurnTimer(battle) {
  const t = TURN_TIMERS.get(battle.id);
  if (t) clearTimeout(t);
  TURN_TIMERS.delete(battle.id);
  battle.turnEndsAt = null;
}

// 전투 수명주기
function startBattle(battle) {
  if (!battle) return;
  if (battle.status === 'active') return;
  battle.status = 'active';
  battle.startedAt = now();

  // 선공: 팀별 DEX 합 (agi로 저장되었다고 가정)
  const sumA = battle.players.filter(p => p.team === 'phoenix').reduce((s, p) => s + (p.stats?.agi || 0), 0);
  const sumB = battle.players.filter(p => p.team === 'eaters').reduce((s, p) => s + (p.stats?.agi || 0), 0);
  battle.firstTeamKey = sumA >= sumB ? 'phoenix' : 'eaters';
  battle.current = battle.firstTeamKey;
  battle.turn = 1;

  pushLog(battle, 'system', `전투 시작 (선공: ${battle.firstTeamKey === 'phoenix' ? '불사조' : '죽먹자'})`);
  broadcastUpdate(battle);
  startTurnTimer(battle);
}
function endBattle(battle, reason = '전투 종료') {
  if (!battle) return;
  battle.status = 'ended';
  battle.endedAt = now();
  stopTurnTimer(battle);
  const w = winnerByHpSum(battle);
  const msg = w ? `승자: ${w}` : '무승부';
  pushLog(battle, 'result', `${reason}. ${msg}`);
  broadcastUpdate(battle);
}

// REST API
app.post('/api/battles', (req, res) => {
  const { mode = '2v2' } = req.body || {};
  const id = newId('b');
  const adminToken = newId('admin');
  const spectatorOtp = newId('spec');

  const battle = {
    id,
    mode,
    adminToken,
    spectatorOtp,
    status: 'waiting',            // waiting | active | paused | ended
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    turnMs: 5 * 60 * 1000,
    turn: 0,
    current: null,                // teamKey 또는 playerId
    firstTeamKey: null,
    players: [],                  // { id, name, team, stats, hp, ready, avatarUrl }
    log: [],
    effects: []
  };
  BATTLES.set(id, battle);

  res.json({
    ok: true,
    id,
    adminUrl: `${process.env.PUBLIC_BASE_URL || ''}/pages/admin.html?battle=${id}&token=${adminToken}`,
    playerBase: `${process.env.PUBLIC_BASE_URL || ''}/pages/player.html?battle=${id}`,
    spectatorBase: `${process.env.PUBLIC_BASE_URL || ''}/pages/spectator.html?battle=${id}&otp=${spectatorOtp}`
  });
});

app.post('/api/battles/:id/start', (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'not found' });
  startBattle(b);
  res.json({ ok: true });
});

app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  // 저장 경로와 URL 구조를 일치 (배틀ID 하위폴더 사용 안함)
  const url = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok: true, url });
});

// Socket.IO
io.on('connection', (socket) => {
  // 룸 합류 도우미
  socket.on('join', ({ battleId }) => {
    if (!battleId || !BATTLES.has(battleId)) return;
    socket.join(battleRoom(battleId));
  });

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, token }) => {
    const b = BATTLES.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit('authError', { error: 'unauthorized' });
      return;
    }
    socket.join(battleRoom(battleId));
    socket.emit('auth:success', { role: 'admin', battleId });
    broadcastUpdate(b);
  });

  // 관전자 인증 (간이 OTP)
  socket.on('spectatorAuth', ({ battleId, otp, name }) => {
    const b = BATTLES.get(battleId);
    if (!b || otp !== b.spectatorOtp) {
      socket.emit('authError', { error: 'unauthorized' });
      return;
    }
    socket.join(battleRoom(battleId));
    socket.emit('auth:success', { role: 'spectator', battleId });
    broadcastUpdate(b);
  });

  // 플레이어 인증 (이름 매칭)
  socket.on('playerAuth', ({ battleId, name }) => {
    const b = BATTLES.get(battleId);
    if (!b) {
      socket.emit('authError', { error: 'notfound' });
      return;
    }
    const player = b.players.find(p => (p.name || '').trim() === (name || '').trim());
    if (!player) {
      socket.emit('authError', { error: 'player-notfound' });
      return;
    }
    player.socketId = socket.id;
    socket.join(battleRoom(battleId));
    socket.emit('auth:success', { role: 'player', battleId, playerId: player.id });
    broadcastUpdate(b);
  });

  // 플레이어 준비
  socket.on('player:ready', ({ battleId, playerId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return;
    p.ready = true;
    pushLog(b, 'system', `${p.name} 준비 완료`);
    if (b.players.length > 0 && b.players.every(x => x.ready) && b.status !== 'active') {
      startBattle(b);
    } else {
      broadcastUpdate(b);
    }
  });

  // 플레이어 행동
  socket.on('player:action', ({ battleId, playerId, action }) => {
    const b = BATTLES.get(battleId);
    if (!b || b.status !== 'active') return;

    const result = resolveAction(b, { actorId: playerId, ...action });
    // 로그 반영
    for (const l of result.logs || []) pushLog(b, l.type || 'system', l.message || '');
    // HP 반영
    const hpUpd = result.updates?.hp || {};
    b.players.forEach(p => { if (hpUpd[p.id] != null) p.hp = Math.max(0, hpUpd[p.id]); });

    if (result.turnEnded) {
      nextTurn(b);
      startTurnTimer(b);
    }
    if (isBattleOver(b)) {
      endBattle(b);
    } else {
      broadcastUpdate(b);
    }
  });

  // 채팅
  socket.on('chat:send', ({ battleId, name, message }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const msg = String(message || '').slice(0, 500);
    io.to(battleRoom(battleId)).emit('battle:chat', { name, message: msg });
  });

  // 응원
  socket.on('cheer:send', ({ battleId, cheer }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const msg = cheer || '';
    pushLog(b, 'cheer', msg);
    io.to(battleRoom(battleId)).emit('battle:log', { type: 'cheer', message: msg });
  });

  // 연결 종료
  socket.on('disconnect', () => {
    // noop
  });
});

// 서버 시작
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] Server listening on ${HOST}:${PORT}`);
});
