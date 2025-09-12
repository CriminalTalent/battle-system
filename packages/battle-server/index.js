// packages/battle-server/index.js - 정리/안정화 버전 (ESM)
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

// 업로드 라우터 (라우터가 default export여야 합니다)
import uploadRouter from './src/routes/avatar-upload.js';

// (선택) 엔진 사용시 필요
import BattleEngine from './src/engine/BattleEngine.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';
const HOST = process.env.HOST || '0.0.0.0';

console.log(`[PYXIS] 서버 초기화 중... 포트: ${PORT}`);

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

// =====================================================
// 전역 상태 (메모리 보관)
// =====================================================
/** @type {Map<string, any>} */
const battles = new Map();
/** @type {Map<string, {otp:string,battleId:string,role:'admin'|'player'|'spectator',playerId?:number,expires:number}>} */
const otpStore = new Map();

// =====================================================
// 미들웨어 & 정적 파일
// =====================================================
app.set('trust proxy', true);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// =====================================================
// 유틸 함수
// =====================================================
const rand = (n) => Math.floor(Math.random() * n);
function generateId() {
  return 'battle_' + Math.random().toString(36).slice(2, 10);
}
function generateOTP(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[rand(chars.length)];
  return out;
}
function clamp(v, lo, hi) {
  v = Number(v) || 0;
  return Math.max(lo, Math.min(hi, v));
}
function validateStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const { attack, defense, agility, luck } = stats;
  return [attack, defense, agility, luck].every((s) => Number.isInteger(+s) && s >= 1 && s <= 5);
}

function createBattleState(id, mode = '1v1') {
  // 기본 모드 1v1 로 통일
  const x = Number(mode?.[0]) || 1;
  return {
    id,
    mode,
    status: 'waiting',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    players: [],
    currentTurn: 0,
    currentPlayer: null,
    leadingTeam: null, // 'A' | 'B'
    effects: [],
    logs: [],
    options: {
      timeLimit: 60 * 60 * 1000, // 1h
      turnTimeout: 5 * 60 * 1000, // 5m
      maxPlayers: x * 2,
    },
  };
}

function emitBattleUpdate(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  io.to(battleId).emit('battleUpdate', battle);
  io.to(battleId).emit('battle:update', battle);
}

function pushLog(battleId, type, message, data = undefined) {
  const b = battles.get(battleId);
  if (!b) return;
  const entry = { timestamp: Date.now(), type, message, ...(data ? { data } : {}) };
  b.logs.push(entry);
  if (b.logs.length > 1000) b.logs = b.logs.slice(-500);
  io.to(battleId).emit('battle:log', entry);
}

// =====================================================
// REST API
// =====================================================

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'PYXIS Battle System',
    uptime: Math.floor(process.uptime()),
    battles: battles.size,
    ts: Date.now(),
  });
});

// 전투 생성 (REST)
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', options = {} } = req.body || {};
    if (!['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'invalid_mode' });
    }
    const battleId = generateId();
    const adminOtp = generateOTP(8);
    const battle = createBattleState(battleId, mode);
    battle.options = { ...battle.options, ...options };
    battles.set(battleId, battle);
    otpStore.set(`admin_${battleId}`, {
      otp: adminOtp,
      battleId,
      role: 'admin',
      expires: Date.now() + 30 * 60 * 1000,
    });

    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      ok: true,
      battleId,
      adminOtp,
      mode,
      urls: {
        admin: `${base}/admin.html?battle=${battleId}&otp=${adminOtp}`,
        player: `${base}/player.html?battle=${battleId}`,
        spectator: `${base}/spectator.html?battle=${battleId}`,
      },
    });
  } catch (e) {
    console.error('[create battle] error', e);
    res.status(500).json({ ok: false, error: 'creation_failed' });
  }
});

// 전투 조회
app.get('/api/battles/:id', (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, battle: b });
});

// 로그 조회 (플레이어 페이지가 사용)
app.get('/api/battles/:id/log', (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, log: b.logs || [] });
});

// 링크 생성 (관리자 페이지가 사용) – 정식 + 별칭
app.post(['/api/admin/battles/:id/links', '/api/battles/:id/links'], (req, res) => {
  try {
    const battleId = req.params.id;
    const b = battles.get(battleId);
    if (!b) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;

    // 관전자 OTP
    const spectatorOtp = generateOTP(6);
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      battleId,
      role: 'spectator',
      expires: Date.now() + 60 * 60 * 1000,
    });

    // 플레이어 링크 (playerId 포함)
    const maxPlayers = b.options.maxPlayers || 2;
    const playerLinks = [];
    for (let i = 1; i <= maxPlayers; i++) {
      const pOtp = generateOTP(6);
      otpStore.set(`player_${battleId}_${i}`, {
        otp: pOtp,
        battleId,
        role: 'player',
        playerId: i,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      playerLinks.push({
        id: i,
        otp: pOtp,
        url: `${base}/player.html?battle=${battleId}&token=${pOtp}&playerId=${i}`,
      });
    }

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${battleId}&token=${spectatorOtp}`,
      playerLinks,
    });
  } catch (e) {
    console.error('[gen links] error', e);
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// 업로드 (라우터 내부에서 /avatar 등 세부 경로 처리)
app.use('/api/upload', uploadRouter);

// =====================================================
// HTML 단축 라우트 (정적 서빙도 되지만 명시적으로 추가)
// =====================================================
const send = (name) => (req, res) => res.sendFile(path.join(publicDir, name));
app.get('/admin', send('admin.html'));
app.get('/admin.html', send('admin.html'));
app.get('/player', send('player.html'));
app.get('/player.html', send('player.html'));
app.get(['/spectator', '/watch'], send('spectator.html'));
app.get('/spectator.html', send('spectator.html'));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// =====================================================
// Socket.IO
// =====================================================
io.on('connection', (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  // 공통 join
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    const b = battles.get(battleId);
    if (!b) return;
    socket.join(battleId);
    socket.battleId = battleId;
    emitBattleUpdate(battleId);
    pushLog(battleId, 'system', `클라이언트 연결: ${socket.id}`);
  });

  // ===== 인증 (관리자/관전자) =====
  socket.on('adminAuth', ({ battleId, otp }, ack) => {
    const rec = otpStore.get(`admin_${battleId}`);
    if (!rec || rec.otp !== otp || Date.now() > rec.expires) {
      const err = { ok: false, error: 'invalid_otp', message: '잘못된 관리자 비밀번호' };
      ack?.(err);
      socket.emit('authError', err);
      return;
    }
    socket.role = 'admin';
    socket.join(battleId);
    ack?.({ ok: true, role: 'admin', battleId });
    socket.emit('auth:success', { ok: true, role: 'admin', battleId });
    emitBattleUpdate(battleId);
    pushLog(battleId, 'system', '관리자 인증 성공');
  });

  const onSpectatorAuth = ({ battleId, otp, name }, ack) => {
    const rec = otpStore.get(`spectator_${battleId}`);
    if (!rec || rec.otp !== otp || Date.now() > rec.expires) {
      const err = { ok: false, error: 'invalid_otp', message: '잘못된 관전자 비밀번호' };
      ack?.(err);
      socket.emit('authError', err);
      socket.emit('auth:error', err);
      return;
    }
    socket.role = 'spectator';
    socket.displayName = name || '관전자';
    socket.join(battleId);
    const b = battles.get(battleId);
    const ok = { ok: true, role: 'spectator', battle: b };
    ack?.(ok);
    socket.emit('auth:success', ok);
    emitBattleUpdate(battleId);
    pushLog(battleId, 'system', `관전자 입장: ${socket.displayName}`);
  };
  socket.on('spectatorAuth', onSpectatorAuth);
  socket.on('spectator:auth', onSpectatorAuth);

  // ===== 전투 생성 (소켓) – 별칭 모두 지원 =====
  const createBattleSocket = (payload, ack) => {
    try {
      const mode = ['1v1', '2v2', '3v3', '4v4'].includes(payload?.mode) ? payload.mode : '1v1';
      const battleId = generateId();
      const adminOtp = generateOTP(8);
      const battle = createBattleState(battleId, mode);
      battles.set(battleId, battle);
      otpStore.set(`admin_${battleId}`, {
        otp: adminOtp,
        battleId,
        role: 'admin',
        expires: Date.now() + 30 * 60 * 1000,
      });
      socket.join(battleId);
      socket.battleId = battleId;
      socket.role = 'admin';
      const res = { ok: true, battle, battleId, adminOtp };
      ack?.(res);
      socket.emit('battle:created', res);
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', `전투 생성 (${mode})`);
    } catch (e) {
      console.error('[socket createBattle] error', e);
      ack?.({ ok: false, error: 'creation_failed' });
    }
  };
  socket.on('createBattle', createBattleSocket);
  socket.on('battle:create', createBattleSocket);
  socket.on('admin:createBattle', createBattleSocket);

  // ===== 상태 컨트롤 (별칭 지원) =====
  const startBattle = ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    if ((b.players?.length || 0) < 2) {
      socket.emit('error', { message: '최소 2명의 플레이어 필요' });
      return;
    }
    const aAg = b.players.filter((p) => p.team === 'A').reduce((s, p) => s + (p.stats?.agility || 0), 0);
    const bAg = b.players.filter((p) => p.team === 'B').reduce((s, p) => s + (p.stats?.agility || 0), 0);
    b.leadingTeam = aAg >= bAg ? 'A' : 'B';
    b.status = 'active';
    b.startedAt = Date.now();
    b.currentTurn = 1;
    // 엔진 초기화(필요 시 내부에서 참조)
    // eslint-disable-next-line no-new
    new BattleEngine(b);
    emitBattleUpdate(battleId);
    pushLog(
      battleId,
      'system',
      `전투 시작! 선공: ${b.leadingTeam === 'A' ? 'A팀' : 'B팀'} (민첩 합 A:${aAg} / B:${bAg})`
    );
    io.to(battleId).emit('battle:started', { battle: b });
  };
  const pauseBattle = ({ battleId }) => {
    const b = battles.get(battleId);
    if (b && b.status === 'active') {
      b.status = 'paused';
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', '전투 일시정지');
    }
  };
  const resumeBattle = ({ battleId }) => {
    const b = battles.get(battleId);
    if (b && b.status === 'paused') {
      b.status = 'active';
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', '전투 재개');
    }
  };
  const endBattle = ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) {
      b.status = 'ended';
      b.endedAt = Date.now();
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', '전투 종료');
      io.to(battleId).emit('battle:ended', { winner: b.winner ?? null, battle: b });
    }
  };
  socket.on('startBattle', startBattle);
  socket.on('battle:start', startBattle);
  socket.on('pauseBattle', pauseBattle);
  socket.on('battle:pause', pauseBattle);
  socket.on('resumeBattle', resumeBattle);
  socket.on('battle:resume', resumeBattle);
  socket.on('endBattle', endBattle);
  socket.on('battle:end', endBattle);

  // ===== 플레이어/관전자 공용 채팅 & 응원 =====
  socket.on('chatMessage', ({ battleId, message, name, role }) => {
    if (!battleId || !message?.trim()) return;
    const chat = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name || '익명',
      message: message.trim(),
      role: role || 'player',
      timestamp: Date.now(),
    };
    io.to(battleId).emit('chatMessage', chat);
    io.to(battleId).emit('battle:chat', chat);
    pushLog(battleId, 'chat', `[${chat.name}] ${chat.message}`, chat);
  });

  const onCheer = ({ battleId, message, name }) => {
    if (!battleId || !message?.trim()) return;
    const cheer = {
      id: `cheer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name || '관전자',
      message: message.trim(),
      role: 'spectator',
      timestamp: Date.now(),
    };
    io.to(battleId).emit('battle:chat', cheer);
    pushLog(battleId, 'cheer', `[${cheer.name}] ${cheer.message}`, cheer);
  };
  socket.on('spectator:cheer', onCheer);
  socket.on('cheer:send', onCheer);

  // ===== 플레이어 추가 (소켓) =====
  socket.on('addPlayer', ({ battleId, player }, ack) => {
    try {
      const b = battles.get(battleId);
      if (!b) return ack?.({ ok: false, error: 'not_found' });
      if (!player?.name?.trim()) return ack?.({ ok: false, error: 'name_required' });
      if (!validateStats(player.stats)) return ack?.({ ok: false, error: 'invalid_stats' });
      if (b.players.length >= b.options.maxPlayers) return ack?.({ ok: false, error: 'battle_full' });

      const newP = {
        id: `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: player.name.trim(),
        team: player.team === 'B' ? 'B' : 'A',
        hp: 100,
        maxHp: 100,
        stats: {
          attack: +player.stats.attack,
          defense: +player.stats.defense,
          agility: +player.stats.agility,
          luck: +player.stats.luck,
        },
        items: {
          dittany: clamp(player.items?.dittany ?? 0, 0, 99),
          attack_boost: clamp(player.items?.attack_boost ?? 0, 0, 99),
          defense_boost: clamp(player.items?.defense_boost ?? 0, 0, 99),
        },
        avatar: String(player.avatar || ''),
        status: 'ready',
        joinedAt: Date.now(),
      };
      b.players.push(newP);
      ack?.({ ok: true, battle: b, player: newP });
      emitBattleUpdate(battleId);
      pushLog(battleId, 'system', `${newP.name} 참가 (${newP.team}팀)`);
    } catch (e) {
      console.error('[addPlayer] error', e);
      ack?.({ ok: false, error: 'add_player_failed' });
    }
  });

  socket.on('disconnect', (reason) => {
    const bid = socket.battleId;
    if (bid) pushLog(bid, 'system', `클라이언트 해제: ${socket.id} (${reason})`);
  });
});

// =====================================================
// 배틀 만료/OTP 정리
// =====================================================
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) {
    if (v.expires && v.expires < now) otpStore.delete(k);
  }
}, 5 * 60 * 1000);

// =====================================================
// 서버 시작
// =====================================================
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] 배틀 시스템 서버 시작`);
  console.log(`- http://${HOST}:${PORT}`);
  console.log(`- 관리자 : /admin.html`);
  console.log(`- 플레이어: /player.html`);
  console.log(`- 관전자 : /spectator.html`);
  console.log(`- Socket.IO: ${SOCKET_PATH}`);
});

// 종료 신호
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[PYXIS] ${sig} 수신 → 서버 종료`);
    server.close(() => {
      console.log('[PYXIS] 종료 완료');
      process.exit(0);
    });
  });
}
