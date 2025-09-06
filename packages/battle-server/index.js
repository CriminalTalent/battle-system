/* eslint-disable no-console */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// ═══════════════════════════════════════════════════════════════════════
// PYXIS Battle System - 서버 구현 (개선판)
// - Nginx 프록시/HTTPS 환경 친화
// - 견고한 CORS, 보안 헤더 정리, 로그 개선
// - OTP 사용 카운트/만료 처리 보강
// - 관전자/채팅/전투 상태 전송 안정화
// ═══════════════════════════════════════════════════════════════════════

const app = express();
const server = createServer(app);

// ── 환경 설정 ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Nginx 뒤에서 클라이언트 IP 식별 (X-Forwarded-For 신뢰)
app.set('trust proxy', true);

// ── 디렉터리 준비 ─────────────────────────────────────────────────────
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
};

const ROOT = __dirname;
ensureDir(path.join(ROOT, 'public/pages'));
ensureDir(path.join(ROOT, 'public/assets'));
ensureDir(path.join(ROOT, 'uploads'));
ensureDir(path.join(ROOT, 'logs'));

// 로그 스트림
const accessStream = fs.createWriteStream(path.join(ROOT, 'logs/access.log'), { flags: 'a' });
const errorStream = fs.createWriteStream(path.join(ROOT, 'logs/error.log'), { flags: 'a' });

function logWithTimestamp(message, level = 'INFO') {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [${level}] ${message}\n`;
  if (level === 'ERROR') errorStream.write(msg);
  else accessStream.write(msg);
  // 콘솔도 보기 쉽게
  if (level === 'ERROR') console.error(msg.trim());
  else console.log(msg.trim());
}

// ── 메모리 저장소(데모/개발 용) ────────────────────────────────────────
const battles = new Map();
const otpStore = new Map(); // { otp: { battleId, expiresAt: Date, used: number, maxUses: number } }

// ── 유틸 ───────────────────────────────────────────────────────────────
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
const nowISO = () => new Date().toISOString();

function generateId(length = 8) {
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

function generateOTP(digits = 6) {
  const n = Math.floor(Math.random() * 10 ** digits)
    .toString()
    .padStart(digits, '0');
  return n;
}

function sanitize(input) {
  return String(input ?? '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 1000);
}

// ── CORS (강화된 설정) ────────────────────────────────────────────────
const rawOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
const allowAll = rawOrigins.includes('*');

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowAll) return cb(null, true);
      if (rawOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  })
);
app.options('*', cors());

// ── 보안 헤더(서버/NGINX 중복 무해, SAMEORIGIN으로 통일) ─────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // XSS Protection 헤더는 최신 브라우저에서 비권장이라 미설정 가능
  next();
});

// ── 파서/로깅 ─────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logWithTimestamp(
      `${req.ip} ${req.method} ${req.originalUrl} - ${res.statusCode} (${ms}ms) ua="${req.headers['user-agent'] || '-'}"`
    );
  });
  next();
});

// ── 정적 파일 ─────────────────────────────────────────────────────────
app.use(
  '/assets',
  express.static(path.join(ROOT, 'public/assets'), {
    maxAge: NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
    lastModified: true,
    fallthrough: true,
  })
);

// 업로드(민감: 캐싱 짧게)
app.use(
  '/uploads',
  express.static(path.join(ROOT, 'uploads'), {
    maxAge: '1h',
    etag: true,
  })
);

// public 루트 제공(이미지/JS 등)
app.use(
  express.static(path.join(ROOT, 'public'), {
    index: false,
    maxAge: NODE_ENV === 'production' ? '1d' : 0,
  })
);

// ── Socket.IO ─────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin(origin, cb) {
      if (!origin || allowAll) return cb(null, true);
      if (rawOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS (WS)'));
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  // path 기본값: /socket.io  (Nginx 설정과 일치)
});

// ── API ────────────────────────────────────────────────────────────────

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: nowISO(),
    version: '1.0.1',
    battles: battles.size,
    sockets: io.engine.clientsCount,
    uptime: process.uptime(),
    env: NODE_ENV,
  });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', name = 'New Battle', adminPassword } = req.body || {};

    const head = parseInt(String(mode).charAt(0), 10);
    const maxPlayersPerTeam = Number.isFinite(head) ? clamp(head, 1, 4) : 1;

    const battleId = generateId(8);
    const adminToken = generateId(16);

    const battle = {
      id: battleId,
      name: sanitize(name) || 'New Battle',
      mode: String(mode),
      adminToken,
      adminPassword: adminPassword || generateId(8),
      status: 'waiting', // waiting, active, finished
      createdAt: nowISO(),
      players: [],
      teams: {
        phoenix: [],
        eaters: [],
      },
      currentTurn: null,
      turnTimer: null,
      gameTimer: null,
      logs: [],
      settings: {
        turnTimeLimit: 5 * 60 * 1000, // 5분
        gameTimeLimit: 60 * 60 * 1000, // 1시간
        maxPlayersPerTeam,
      },
    };

    battles.set(battleId, battle);
    logWithTimestamp(`Battle created: ${battleId} (${battle.mode})`);

    res.json({
      battleId,
      adminToken,
      adminPassword: battle.adminPassword,
      adminUrl: `/admin?battle=${battleId}&token=${adminToken}`,
      playerUrl: `/play?battle=${battleId}`,
      spectatorUrl: `/spectator?battle=${battleId}`,
    });
  } catch (error) {
    logWithTimestamp(`Error creating battle: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to create battle' });
  }
});

// 전투 상세 조회(간단)
app.get('/api/battles/:battleId', (req, res) => {
  const battle = battles.get(req.params.battleId);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const safe = { ...battle };
  delete safe.adminToken;
  delete safe.adminPassword;
  res.json(safe);
});

// 플레이어 추가
app.post('/api/battles/:battleId/players', (req, res) => {
  try {
    const { battleId } = req.params;
    const { name, team, stats = {}, avatar, items } = req.body || {};

    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });

    if (battle.status !== 'waiting') {
      return res.status(400).json({ error: 'Battle already started' });
    }

    if (!['phoenix', 'eaters'].includes(team)) {
      return res.status(400).json({ error: 'Invalid team' });
    }

    if (battle.teams[team].length >= battle.settings.maxPlayersPerTeam) {
      return res.status(400).json({ error: 'Team is full' });
    }

    const playerId = generateId(10);
    const hp = clamp(parseInt(stats.hp ?? 100, 10) || 100, 1, 9999);

    const player = {
      id: playerId,
      name: sanitize(name || `Player-${playerId}`),
      team,
      stats: {
        hp,
        maxHp: hp,
        attack: clamp(parseInt(stats.attack ?? 10, 10) || 10, 1, 9999),
        defense: clamp(parseInt(stats.defense ?? 5, 10) || 5, 0, 9999),
        agility: clamp(parseInt(stats.agility ?? 8, 10) || 8, 0, 9999),
        luck: clamp(parseInt(stats.luck ?? 5, 10) || 5, 0, 9999),
      },
      avatar: avatar || null,
      items: items || {
        attackBooster: 0,
        defenseBooster: 0,
        potion: 0,
      },
      status: 'alive', // alive, dead
      effects: [],
      lastAction: null,
      joinedAt: nowISO(),
    };

    battle.players.push(player);
    battle.teams[team].push(playerId);

    io.to(`battle-${battleId}`).emit('playerJoined', { player, teams: battle.teams });
    logWithTimestamp(`Player ${player.name} joined battle ${battleId} (${team})`);

    res.json({
      playerId,
      player,
      battle: {
        id: battle.id,
        name: battle.name,
        mode: battle.mode,
        status: battle.status,
        teams: battle.teams,
      },
    });
  } catch (error) {
    logWithTimestamp(`Error adding player: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// OTP 생성(관전자)
app.post('/api/otp', (req, res) => {
  try {
    const { battleId, adminToken } = req.body || {};

    const battle = battles.get(battleId);
    if (!battle || battle.adminToken !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const otp = generateOTP(6);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30분

    otpStore.set(otp, {
      battleId,
      expiresAt,
      used: 0, // ← BUGFIX: 불리언이 아닌 카운터로 관리
      maxUses: 30,
    });

    res.json({ otp, expiresAt });
  } catch (error) {
    logWithTimestamp(`Error generating OTP: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

// OTP 검증
app.post('/api/otp/verify', (req, res) => {
  try {
    const { otp } = req.body || {};

    const data = otpStore.get(otp);
    if (!data) return res.status(401).json({ error: 'Invalid OTP' });

    if (Date.now() > new Date(data.expiresAt).getTime()) {
      otpStore.delete(otp);
      return res.status(401).json({ error: 'OTP expired' });
    }

    if (data.used >= data.maxUses) {
      return res.status(401).json({ error: 'OTP usage limit exceeded' });
    }

    data.used += 1;

    res.json({
      valid: true,
      battleId: data.battleId,
      spectatorUrl: `/spectator?battle=${data.battleId}&otp=${otp}`,
      remaining: Math.max(0, data.maxUses - data.used),
    });
  } catch (error) {
    logWithTimestamp(`Error verifying OTP: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// 주기적으로 만료된 OTP 정리
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (now > new Date(v.expiresAt).getTime()) otpStore.delete(k);
  }
}, 60 * 1000);

// ── Socket.IO 핸들러 ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  logWithTimestamp(`Socket connected: ${socket.id} ip=${ip}`);

  // battle 참가
  socket.on('joinBattle', (payload = {}) => {
    try {
      const { battleId, role = 'spectator', playerId, adminToken, otp } = payload;

      const battle = battles.get(battleId);
      if (!battle) {
        socket.emit('error', { message: 'Battle not found' });
        return;
      }

      // 권한 검증
      let authorized = false;
      if (role === 'admin' && battle.adminToken === adminToken) {
        authorized = true;
      } else if (role === 'player' && battle.players.some((p) => p.id === playerId)) {
        authorized = true;
      } else if (role === 'spectator') {
        if (otp) {
          const data = otpStore.get(otp);
          if (data && data.battleId === battleId && Date.now() <= new Date(data.expiresAt).getTime()) {
            authorized = true;
            // 사용량 증가(검증 API를 안 거치고 바로 ws로 들어오는 경우를 커버)
            if (data.used < data.maxUses) data.used += 1;
          }
        } else {
          // 공개 관전 허용
          authorized = true;
        }
      }

      if (!authorized) {
        socket.emit('error', { message: 'Unauthorized access' });
        return;
      }

      const roomName = `battle-${battleId}`;
      socket.join(roomName);

      socket.battleId = battleId;
      socket.role = role;
      socket.playerId = playerId || null;

      // 현재 전투 상태 전송(민감정보 제외)
      const safeBattle = { ...battle };
      if (role !== 'admin') {
        delete safeBattle.adminToken;
        delete safeBattle.adminPassword;
      }
      socket.emit('battleState', { battle: safeBattle });

      // 현재 관전자 수 브로드캐스트
      const clients = io.sockets.adapter.rooms.get(roomName)?.size || 0;
      io.to(roomName).emit('spectator:count', clients);

      logWithTimestamp(`Socket ${socket.id} joined battle ${battleId} as ${role}`);
    } catch (error) {
      logWithTimestamp(`joinBattle error: ${error.message}`, 'ERROR');
      socket.emit('error', { message: 'Failed to join battle' });
    }
  });

  // 채팅
  socket.on('chatMessage', (data = {}) => {
    try {
      if (!socket.battleId) {
        socket.emit('error', { message: 'Not in a battle' });
        return;
      }

      const message = sanitize(String(data.message || '').slice(0, 500));
      if (!message) return;

      const chatData = {
        id: generateId(10),
        message,
        sender: sanitize(data.playerName || 'Anonymous'),
        role: socket.role,
        timestamp: nowISO(),
      };

      io.to(`battle-${socket.battleId}`).emit('chatMessage', chatData);
    } catch (error) {
      logWithTimestamp(`chatMessage error: ${error.message}`, 'ERROR');
    }
  });

  // 플레이어 액션(스텁)
  socket.on('playerAction', (data = {}) => {
    try {
      if (!socket.battleId || socket.role !== 'player') {
        socket.emit('error', { message: 'Unauthorized action' });
        return;
      }

      const battle = battles.get(socket.battleId);
      const player = battle?.players.find((p) => p.id === socket.playerId);

      if (!battle || !player || player.status !== 'alive') {
        socket.emit('error', { message: 'Player cannot act' });
        return;
      }

      const action = String(data.action || '').toLowerCase();
      const targetId = String(data.target || '');
      const itemType = data.itemType ? String(data.itemType) : null;

      // TODO: 실제 전투 규칙/턴/주사위 로직 연결
      // 여기서는 로그 이벤트만 브로드캐스트
      const combatLog = {
        player: player.name,
        action,
        target: targetId,
        itemType,
        result: 'pending',
        timestamp: nowISO(),
      };

      battle.logs.push(combatLog);
      io.to(`battle-${socket.battleId}`).emit('battle:action', combatLog);

      logWithTimestamp(`Action ${action} by ${player.name} in ${socket.battleId}`);
    } catch (error) {
      logWithTimestamp(`playerAction error: ${error.message}`, 'ERROR');
    }
  });

  socket.on('disconnect', (reason) => {
    logWithTimestamp(`Socket disconnected: ${socket.id} (${reason})`);
    const roomName = socket.battleId ? `battle-${socket.battleId}` : null;
    if (roomName) {
      const clients = io.sockets.adapter.rooms.get(roomName)?.size || 0;
      io.to(roomName).emit('spectator:count', clients);
    }
  });
});

// 연결 에러 로깅
io.engine.on('connection_error', (err) => {
  logWithTimestamp(
    `WS connection_error: code=${err.code} message=${err.message} req=${err.req?.url || '-'}`
  );
});

// ── HTML 라우팅 ───────────────────────────────────────────────────────
// 정적 페이지 파일이 없을 때를 위한 폴백
const sendOrFallback = (res, file) => {
  const full = path.join(ROOT, 'public/pages', file);
  if (fs.existsSync(full)) return res.sendFile(full);
  res.type('html').send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>PYXIS</title></head>
<body style="font-family:system-ui;padding:40px;background:#001E35;color:#DCC7A2">
<h1>PYXIS Battle System</h1>
<p><strong>${file}</strong>이(가) 아직 없습니다. <code>public/pages/${file}</code>를 추가하세요.</p>
</body></html>`);
};

app.get('/admin', (_req, res) => sendOrFallback(res, 'admin.html'));
app.get('/play', (_req, res) => sendOrFallback(res, 'play.html'));
app.get('/spectator', (_req, res) => sendOrFallback(res, 'spectator.html'));

app.get('/', (_req, res) => res.redirect('/admin'));

// ── 에러 핸들링 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  logWithTimestamp(`Global error: ${error.message}`, 'ERROR');
  res.status(500).json({ error: 'Internal server error' });
});

// ── 우아한 종료 ───────────────────────────────────────────────────────
const gracefulShutdown = () => {
  console.log('Shutting down gracefully...');
  try {
    io.close(() => console.log('Socket.IO server closed'));
  } catch (_) {}
  server.close(() => {
    console.log('HTTP server closed');
    battles.clear();
    otpStore.clear();
    process.exit(0);
  });
  // 강제 종료(10s)
  setTimeout(() => {
    console.log('Forcing shutdown');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (error) => {
  logWithTimestamp(`Uncaught exception: ${error.message}`, 'ERROR');
  console.error(error.stack);
  gracefulShutdown();
});
process.on('unhandledRejection', (reason, promise) => {
  logWithTimestamp(`Unhandled rejection at ${promise}: ${reason}`, 'ERROR');
});

// ── 서버 시작 ─────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`
=================================================================
  PYXIS Battle System Server
=================================================================
  Environment: ${NODE_ENV}
  Server: http://${HOST}:${PORT}

  Admin Panel: http://${HOST}:${PORT}/admin
  Player Page: http://${HOST}:${PORT}/play
  Spectator  : http://${HOST}:${PORT}/spectator

  API Health : http://${HOST}:${PORT}/api/health
=================================================================
`);
  logWithTimestamp(`PYXIS server started on ${HOST}:${PORT} (${NODE_ENV})`);
});

module.exports = { app, server, io };
