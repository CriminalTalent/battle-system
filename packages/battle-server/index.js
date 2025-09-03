// packages/battle-server/index.js
// Express + Socket.IO 진입점 (디자인 변경 없음: 정적 파일 그대로 사용)

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { BattleEngine } = require('./src/engine/BattleEngine');
const { generateOtp, verifyOtp, pruneExpired } = require('./src/utils/otp');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 자산 (디자인/HTML 그대로)
app.use(express.static(path.join(__dirname, 'public')));

// ============================= In-memory store =============================
/**
 * 메모리 저장 구조 (단일 프로세스 전제)
 * battles: {
 *   [bid]: {
 *     id, mode, createdAt, startedAt, endsAt,
 *     logs: [], chat: [],
 *     players: { [pid]: {...} },
 *     order: { team: 'A'|'B', idx: 0 }, // 턴 순서 관리
 *     spectators: Set(socketId),
 *     otps: { admin:Set, players:Map, spectators:Set },
 *     spectatorLimit: 30,
 *   }
 * }
 */
const battles = Object.create(null);
const TEAM_A = 'phoenix';   // 불사조 기사단
const TEAM_B = 'death';     // 죽음을 먹는 자들
const ONE_HOUR = 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

function newId(prefix='b') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() { return Date.now(); }

function battlePublicState(b) {
  return {
    id: b.id,
    mode: b.mode,
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    endsAt: b.endsAt,
    players: Object.values(b.players).map(p => ({
      id: p.id, name: p.name, team: p.team,
      hp: p.hp, stats: p.stats, alive: p.alive,
      status: { effects: p.status.effects.map(e => e.type) }
    })),
    order: b.order,
    logs: b.logs.slice(-200),
  };
}

// ============================= REST APIs ==================================

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  const { mode = 1 } = req.body;
  if (![1,2,3,4].includes(Number(mode))) {
    return res.status(400).json({ error: 'mode must be 1,2,3,4' });
  }
  const id = newId('battle');
  battles[id] = {
    id,
    mode: Number(mode),
    createdAt: now(),
    startedAt: null,
    endsAt: null,
    logs: [],
    chat: [],
    players: {},
    order: { team: TEAM_A, idx: 0 },
    spectators: new Set(),
    otps: {
      admin: new Set(),
      players: new Map(),     // otp -> { playerId, exp }
      spectators: new Set(),  // { otp, exp }
    },
    spectatorLimit: 30,
    timers: {
      autoPass: null,
      battleEnd: null
    }
  };
  // 관리자 초대 OTP (60분)
  const adminOtp = generateOtp(60);
  battles[id].otps.admin.add(adminOtp.token);

  return res.json({ id, mode: battles[id].mode, adminOtp: adminOtp.token });
});

// 플레이어 추가
app.post('/api/battles/:id/players', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not found' });

  const { name, team, stats, items } = req.body;
  if (!name || ![TEAM_A, TEAM_B].includes(team)) {
    return res.status(400).json({ error: 'name, team required' });
  }
  const pid = newId('player');
  b.players[pid] = {
    id: pid, name, team,
    hp: 100,
    stats: {
      atk: clampInt(stats?.atk ?? 1, 1, 10),
      def: clampInt(stats?.def ?? 1, 1, 10),
      agi: clampInt(stats?.agi ?? 1, 1, 10),
      luk: clampInt(stats?.luk ?? 1, 1, 10),
    },
    items: {
      attack_boost: clampInt(items?.attack_boost ?? 0, 0, 99),
      defense_boost: clampInt(items?.defense_boost ?? 0, 0, 99),
      diterney: clampInt(items?.diterney ?? 0, 0, 99),
    },
    alive: true,
    status: { effects: [], pending: {} },
    lastActionAt: now()
  };
  return res.json({ ok: true, player: b.players[pid] });
});

// 링크(OTP) 생성: 관리자/플레이어/관전자
app.post('/api/battles/:id/links', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not found' });

  const base = req.body.base || ''; // 프런트에서 도메인 전달 가능
  const adminUrl = `${base}/admin?battle=${b.id}&otp=${[...b.otps.admin][0]}`;

  const players = Object.values(b.players).map(p => {
    const po = generateOtp(30);
    b.otps.players.set(po.token, { playerId: p.id, exp: po.exp });
    return {
      name: p.name,
      url: `${base}/play?battle=${b.id}&player=${p.id}&otp=${po.token}`
    };
  });

  // 관전자 OTP (1개) – 접속 시점에 소모, 최대 30인 제한
  const so = generateOtp(30);
  b.otps.spectators.add(so.token);
  const spectatorUrl = `${base}/watch?battle=${b.id}&otp=${so.token}`;

  return res.json({ adminUrl, players, spectatorUrl, limit: b.spectatorLimit });
});

// 전투 시작
app.post('/api/battles/:id/start', (req, res) => {
  const b = battles[req.params.id];
  if (!b) return res.status(404).json({ error: 'not found' });

  if (b.startedAt) return res.json({ ok: true, already: true });

  // 선공: 팀 민첩 총합 비교
  const sumAgi = team => Object.values(b.players)
    .filter(p => p.team === team && p.alive)
    .reduce((s, p) => s + p.stats.agi, 0);

  const a = sumAgi(TEAM_A);
  const d = sumAgi(TEAM_B);
  if (a === d) b.order.team = Math.random() < 0.5 ? TEAM_A : TEAM_B;
  else b.order.team = a > d ? TEAM_A : TEAM_B;

  b.startedAt = now();
  b.endsAt = b.startedAt + ONE_HOUR;

  // 1시간 제한 타이머
  if (b.timers.battleEnd) clearTimeout(b.timers.battleEnd);
  b.timers.battleEnd = setTimeout(() => {
    endByTime(b);
  }, ONE_HOUR);

  // 자동 패스 감시 시작
  scheduleAutoPass(b);

  io.to(b.id).emit('state', battlePublicState(b));
  return res.json({ ok: true, state: battlePublicState(b) });
});

// ============================ Socket.IO ====================================
io.on('connection', (socket) => {
  // 인증
  socket.on('auth', (payload, ack) => {
    try {
      const { role, battle, player, otp, name } = payload || {};
      const b = battles[battle];
      if (!b) return ack?.({ ok: false, error: 'not found' });

      pruneExpired(b.otps.players);
      pruneSpectators(b);

      // 관리자
      if (role === 'admin') {
        if (!b.otps.admin.has(otp)) return ack?.({ ok: false, error: 'auth' });
        socket.join(b.id);
        socket.data = { role, battle: b.id };
        return ack?.({ ok: true, state: battlePublicState(b) });
      }

      // 플레이어
      if (role === 'player') {
        const linked = b.otps.players.get(otp);
        if (!linked || linked.playerId !== player || linked.exp < now()) {
          return ack?.({ ok: false, error: 'auth' });
        }
        socket.join(b.id);
        socket.data = { role, battle: b.id, playerId: player };
        return ack?.({ ok: true, state: battlePublicState(b) });
      }

      // 관전자
      if (role === 'spectator') {
        if (!b.otps.spectators.has(otp)) return ack?.({ ok: false, error: 'auth' });
        if (b.spectators.size >= b.spectatorLimit) {
          return ack?.({ ok: false, error: 'full' });
        }
        b.otps.spectators.delete(otp); // 일회용
        socket.join(b.id);
        b.spectators.add(socket.id);
        socket.data = { role, battle: b.id, name: name || 'spectator' };
        return ack?.({ ok: true, state: battlePublicState(b) });
      }

      return ack?.({ ok: false, error: 'role' });
    } catch (e) {
      return ack?.({ ok: false, error: 'error' });
    }
  });

  // 채팅
  socket.on('chat', (msg) => {
    const { battle } = socket.data || {};
    const b = battles[battle];
    if (!b) return;
    const name = socket.data?.role === 'player'
      ? b.players[socket.data.playerId]?.name || 'player'
      : socket.data?.name || socket.data?.role || 'user';
    const entry = { t: now(), name, msg: String(msg).slice(0, 500) };
    b.chat.push(entry);
    io.to(b.id).emit('chat', entry);
  });

  // 액션
  socket.on('action', (payload, ack) => {
    const { battle, playerId, type, targetId, item } = payload || {};
    const b = battles[battle];
    if (!b || !socket.data) return ack?.({ ok: false });

    // 권한: 플레이어 본인만
    if (socket.data.role !== 'player' || socket.data.playerId !== playerId) {
      return ack?.({ ok: false, error: 'forbidden' });
    }

    const engine = BattleEngine(b);
    const result = engine.processAction(playerId, { type, targetId, item });

    // 다음 턴 및 자동 패스 스케줄 조정
    if (result?.advancedTurn) {
      scheduleAutoPass(b);
    }

    io.to(b.id).emit('state', battlePublicState(b));
    return ack?.({ ok: true, result });
  });

  socket.on('disconnect', () => {
    const { battle, role } = socket.data || {};
    const b = battles[battle];
    if (!b) return;
    if (role === 'spectator') b.spectators.delete(socket.id);
  });
});

// ============================== Helpers ====================================

function clampInt(n, min, max) {
  n = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : min;
  return Math.max(min, Math.min(max, n));
}

function scheduleAutoPass(b) {
  if (!b.startedAt) return;
  if (b.timers.autoPass) clearTimeout(b.timers.autoPass);
  b.timers.autoPass = setTimeout(() => {
    const engine = BattleEngine(b);
    engine.autoPassIfInactive(FIVE_MIN);
    io.to(b.id).emit('state', battlePublicState(b));
    // 다음 턴에 대해서도 연장
    scheduleAutoPass(b);
  }, FIVE_MIN);
}

function endByTime(b) {
  // 팀 HP 합산으로 승부 결정
  const sumHp = team => Object.values(b.players)
    .filter(p => p.team === team)
    .reduce((s, p) => s + Math.max(0, p.hp), 0);

  const a = sumHp(TEAM_A);
  const d = sumHp(TEAM_B);
  const winner = a === d ? 'draw' : (a > d ? TEAM_A : TEAM_B);
  b.logs.push({ t: now(), type: 'system', msg: `timeup winner=${winner} A=${a} B=${d}` });
  b.endsAt = now();
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`battle-server listening on :${PORT}`);
});
