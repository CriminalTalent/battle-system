// ESM Entry for PYXIS Battle Server
// - Loads .env
// - Serves static files
// - Adds /admin /player /spectator routes
// - Exposes /healthz
// - Wires minimal Socket.IO channels expected by the UI (auth/join/chat/cheer/log/update)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import { Server as IOServer } from 'socket.io';

// --------------------------------------------------
// Env & Paths
// --------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from packages/battle-server/.env (preferred) or fallback to repo root
const envLocal = path.join(__dirname, '.env');
const envRoot = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
else if (fs.existsSync(envRoot)) dotenv.config({ path: envRoot });
else dotenv.config();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
if (!Number.isFinite(PORT) || PORT <= 0 || PORT >= 65536) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// --------------------------------------------------
// Minimal In-Memory State (for demo/compat)
// 실제 운영 로직이 별도 모듈에 있다면, 아래는 안전하게 대체/제거해도 됨.
// --------------------------------------------------
const battles = new Map(); // battleId -> { status, players[], log[], spectators: Set<socketId> }

// Helpers
const now = () => Date.now();
function ensureBattle(battleId) {
  if (!battles.has(battleId)) {
    battles.set(battleId, {
      id: battleId,
      mode: '1v1',
      status: 'waiting', // waiting | active | paused | ended
      players: [],       // { id, team, name, hp, stats }
      log: [],           // { ts, type, message }
      spectators: new Set()
    });
  }
  return battles.get(battleId);
}
function pushLog(b, type, message) {
  const item = { ts: now(), type, message };
  b.log.push(item);
  if (b.log.length > 200) b.log.splice(0, b.log.length - 200);
  return item;
}

// --------------------------------------------------
// Express
// --------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 정적 파일
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// 진입 라우트(고정)
app.get('/admin', (_, res) => res.sendFile(path.join(publicDir, 'pages', 'admin.html')));
app.get('/player', (_, res) => res.sendFile(path.join(publicDir, 'pages', 'player.html')));
app.get('/spectator', (_, res) => res.sendFile(path.join(publicDir, 'pages', 'spectator.html')));

// 헬스체크
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      HOST,
      PORT,
      PUBLIC_BASE_URL
    }
  });
});

// (선택) 간이 전투 생성 API — admin.js가 /api/battles POST를 호출하므로 최소 동작 제공
// 실제 로직으로 교체 가능
app.post('/api/battles', (req, res) => {
  const mode = String(req.body?.mode || '1v1');
  const battleId = `b_${Math.random().toString(36).slice(2, 10)}`;
  const b = ensureBattle(battleId);
  b.mode = mode;
  pushLog(b, 'system', `전투 생성: 모드=${mode}`);
  const url = new URL(PUBLIC_BASE_URL);
  const adminUrl = `${url.origin}/admin?battle=${battleId}&token=admin-${battleId}`;
  const playerBase = `${url.origin}/player?battle=${battleId}`;
  const spectatorBase = `${url.origin}/spectator?battle=${battleId}`;
  return res.json({ ok: true, id: battleId, adminUrl, playerBase, spectatorBase });
});

app.post('/api/battles/:id/start', (req, res) => {
  const b = ensureBattle(req.params.id);
  b.status = 'active';
  pushLog(b, 'system', `전투 시작`);
  io.to(b.id).emit('battle:update', serializeBattle(b));
  return res.json({ ok: true });
});

// --------------------------------------------------
// HTTP + Socket.IO
// --------------------------------------------------
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true, credentials: true }
});

// 클라이언트 전달용 battle 스냅샷
function serializeBattle(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    players: b.players,
    log: b.log
  };
}

// 소켓 이벤트
io.on('connection', (socket) => {
  // 공통: 룸 합류
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const b = ensureBattle(battleId);
    socket.emit('battle:update', serializeBattle(b));
  });

  // 관리자 인증(간이) — 실제 검증 로직으로 교체 가능
  socket.on('adminAuth', ({ battleId, token }) => {
    if (!battleId || !token) return socket.emit('authError', { error: 'Missing credentials' });
    const b = ensureBattle(battleId);
    // 간이 토큰 규칙: admin-${battleId}
    if (token !== `admin-${battleId}`) return socket.emit('authError', { error: 'Invalid token' });
    socket.join(battleId);
    socket.emit('auth:success', { role: 'admin', battleId });
    socket.emit('battle:update', serializeBattle(b));
  });

  // 플레이어 인증(간이)
  socket.on('playerAuth', ({ battleId, name, token }) => {
    if (!battleId || !name || !token) return socket.emit('authError', { error: 'Missing credentials' });
    const b = ensureBattle(battleId);
    // 간이 토큰 규칙: player-${name}-${battleId}
    if (token !== `player-${name}-${battleId}`) return socket.emit('authError', { error: 'Invalid token' });

    // 플레이어 등록(중복 방지)
    let p = b.players.find((x) => x.name === name);
    if (!p) {
      // 기본 팀 배치: phoenix / eaters 번갈아
      const phoenixCount = b.players.filter((x) => x.team === 'phoenix').length;
      const eatersCount = b.players.filter((x) => x.team === 'eaters').length;
      const team = phoenixCount <= eatersCount ? 'phoenix' : 'eaters';
      p = {
        id: `p_${Math.random().toString(36).slice(2, 10)}`,
        team,
        name,
        hp: 100,
        stats: { str: 0, agi: 0, int: 0, wil: 0, cha: 0, mag: 0 }
      };
      b.players.push(p);
      pushLog(b, 'system', `플레이어 합류: ${name} (${team})`);
      io.to(b.id).emit('battle:update', serializeBattle(b));
    }

    socket.join(battleId);
    socket.emit('auth:success', { role: 'player', battleId, playerId: p.id });
    socket.emit('battle:update', serializeBattle(b));
  });

  // 관전자 인증(간이)
  socket.on('spectatorAuth', ({ battleId, otp, name }) => {
    if (!battleId || !otp) return socket.emit('authError', { error: 'Missing credentials' });
    const b = ensureBattle(battleId);
    // 간이 규칙: otp === `spectator-${battleId}`
    if (otp !== `spectator-${battleId}`) return socket.emit('authError', { error: 'Invalid password' });

    b.spectators.add(socket.id);
    socket.join(battleId);
    socket.emit('auth:success', { role: 'spectator', battleId });
    socket.emit('battle:update', serializeBattle(b));
    io.to(b.id).emit('spectator:count', { count: b.spectators.size });
  });

  // 준비 완료(플레이어)
  socket.on('player:ready', ({ battleId }) => {
    const b = ensureBattle(battleId);
    pushLog(b, 'system', `플레이어 준비완료`);
    io.to(b.id).emit('battle:log', { type: 'system', message: '플레이어가 준비완료를 눌렀습니다.' });
  });

  // 플레이어 액션(간이 echo)
  socket.on('player:action', ({ battleId, playerId, action }) => {
    const b = ensureBattle(battleId);
    const p = b.players.find((x) => x.id === playerId);
    const who = p ? p.name : 'Unknown';
    pushLog(b, 'battle', `행동: ${who} → ${action?.type || 'unknown'}`);
    io.to(b.id).emit('battle:log', { type: 'battle', message: `행동: ${who} → ${action?.type || 'unknown'}` });
  });

  // 채팅
  socket.on('chat:send', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    io.to(battleId).emit('battle:chat', { name: name || '익명', message });
  });

  // 응원
  socket.on('cheer:send', ({ battleId, cheer }) => {
    if (!battleId || !cheer) return;
    io.to(battleId).emit('battle:log', { type: 'cheer', message: cheer });
  });

  // 연결 종료
  socket.on('disconnect', () => {
    // 관전자 카운트 정리
    for (const b of battles.values()) {
      if (b.spectators.delete(socket.id)) {
        io.to(b.id).emit('spectator:count', { count: b.spectators.size });
      }
    }
  });
});

// --------------------------------------------------
// Start
// --------------------------------------------------
server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[PYXIS] Listening on http://${HOST}:${PORT} (public: ${PUBLIC_BASE_URL})`);
});