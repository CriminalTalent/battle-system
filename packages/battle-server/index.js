// packages/battle-server/index.js
"use strict";

/**
 * PYXIS Battle Server – Express + Socket.IO (통합본)
 * - /admin /play /spectator 페이지 제공
 * - OTP(관리자/플레이어/관전자) 발급 및 검증
 * - 아바타 업로드(Multer)
 * - 플레이어 준비 → 전원 준비 시 전투 시작 & 선공 결정(민첩 합)
 * - 턴 타이머(5분) : 시간 초과 시 자동 다음 턴 / 관전/플레이어에 tick 방송
 * - 액션(공격/방어/회피/아이템/패스) 처리 및 로그/채팅 브로드캐스트
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const { Server } = require("socket.io");

/* ───────────────────────────────────────────
   환경
─────────────────────────────────────────── */
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || null;

/* ───────────────────────────────────────────
   서버/미들웨어
─────────────────────────────────────────── */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST", "DELETE"] },
});
app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ───────────────────────────────────────────
   정적 제공
─────────────────────────────────────────── */
const PUB_DIR = path.join(__dirname, "public");
app.use(express.static(PUB_DIR, { index: false }));
app.use("/uploads", express.static(path.join(PUB_DIR, "uploads"), { maxAge: "7d" }));

// 페이지
app.get("/admin", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "admin.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "player.html")));
app.get("/spectator", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "spectator.html")));

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now(), service: "battle-server" })
);

/* ───────────────────────────────────────────
   유틸/상수
─────────────────────────────────────────── */
const TURN_LIMIT_MS = 5 * 60 * 1000; // 5분
function now() { return Date.now(); }
function makeId(n = 10) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0]; return s;
}
function toAbsBase(req) {
  return (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`.replace(/\/+$/, ""));
}
function clamp(n, min, max) {
  const v = Number(n || 0);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function teamKey(v) {
  const s = String(v || "").toLowerCase();
  if (["a", "phoenix", "team1"].includes(s)) return "phoenix";
  if (["b", "eaters", "team2", "death", "deatheaters"].includes(s)) return "eaters";
  return "phoenix";
}

/* ───────────────────────────────────────────
   메모리 상태
─────────────────────────────────────────── */
const battles = new Map(); // id -> battle

/**
 * battle 구조
 * {
 *   id, mode, status, createdAt, startedAt, endedAt,
 *   adminToken, players[], turn{ current, lastChange, deadline },
 *   log[],
 *   _turnTimeout, _turnTicker
 * }
 */

/* ───────────────────────────────────────────
   OTP (간단 메모리)
─────────────────────────────────────────── */
const otps = new Map(); // token -> { role, battleId, createdAt, used:false }
function genOTP(role, battleId) {
  const token = makeId(16);
  otps.set(token, { role, battleId, createdAt: now(), used: false });
  return token;
}
function validateOTP(token) {
  const d = otps.get(token);
  if (!d || d.used) return { valid: false, error: "invalid_or_used" };
  return { valid: true, role: d.role, data: { battleId: d.battleId } };
}
function consumeOTP(token) {
  const d = otps.get(token);
  if (d) d.used = true;
}

/* ───────────────────────────────────────────
   로그/브로드캐스트/턴 타이머
─────────────────────────────────────────── */
function addLog(b, type, msg) {
  b.log.push({ t: now(), type, message: String(msg || "") });
  io.to(b.id).emit("battle:log", { type, msg });
}
function broadcastBattle(b) {
  io.to(b.id).emit("battleUpdate", b);   // 구버전
  io.to(b.id).emit("battle:update", b);  // 신버전
}

function clearTurnTimer(b) {
  if (b._turnTimeout) { clearTimeout(b._turnTimeout); b._turnTimeout = null; }
  if (b._turnTicker) { clearInterval(b._turnTicker); b._turnTicker = null; }
}

function startTurnTimer(b) {
  clearTurnTimer(b);
  if (!b.turn?.current || b.status !== "live") return;

  // 1초마다 남은 시간 틱
  b._turnTicker = setInterval(() => {
    const remaining = Math.max(0, (b.turn.deadline || 0) - Date.now());
    io.to(b.id).emit("turn:tick", { remaining });
  }, 1000);

  // 데드라인 도달 시 강제 턴 종료
  const msLeft = Math.max(0, (b.turn.deadline || 0) - Date.now());
  b._turnTimeout = setTimeout(() => {
    const cur = b.players.find((p) => p.id === b.turn.current);
    const curName = cur?.name || "-";
    addLog(b, "system", `시간 초과(5분) → ${curName}의 턴 강제 종료`);
    const nextId = pickNextPlayer(b, b.turn.current);
    setTurn(b, nextId);
    broadcastBattle(b);
  }, msLeft);
}

function setTurn(b, playerId) {
  b.turn.current = playerId || null;
  b.turn.lastChange = Date.now();
  b.turn.deadline = b.turn.current ? Date.now() + TURN_LIMIT_MS : null;
  clearTurnTimer(b);
  if (b.turn.current) {
    const p = b.players.find((x) => x.id === b.turn.current);
    addLog(b, "system", `턴 전환 → ${p?.name || "-"}`);
    startTurnTimer(b);
  }
}

function pickNextPlayer(b, fromId) {
  // 생존자만 순환
  const alive = b.players.filter((p) => p.alive !== false && p.hp > 0);
  if (!alive.length) return null;
  if (!fromId) return alive[0].id;
  const idx = alive.findIndex((p) => p.id === fromId);
  const next = alive[(idx + 1) % alive.length];
  return next?.id || alive[0].id;
}

/* ───────────────────────────────────────────
   REST: Battles
─────────────────────────────────────────── */
app.post("/api/battles", (req, res) => {
  const mode = String(req.body?.mode || "2v2");
  const id = makeId(10);
  const b = {
    id,
    mode,
    status: "waiting",
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    adminToken: makeId(16),
    players: [],
    turn: { current: null, lastChange: null, deadline: null },
    log: [],
    _turnTimeout: null,
    _turnTicker: null,
  };
  battles.set(id, b);
  addLog(b, "system", `Battle created (mode ${mode})`);
  res.json({ id, token: b.adminToken, battle: b });
});

app.get("/api/battles/:id", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json(b);
});

app.post("/api/battles/:id/players", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });

  const { name, team, stats, avatar, items } = req.body || {};
  if (!name) return res.status(400).json({ error: "invalid_name" });

  const p = {
    id: makeId(12),
    name: String(name),
    team: teamKey(team),
    stats: {
      atk: clamp(stats?.atk, 0, 5),
      def: clamp(stats?.def, 0, 5),
      agi: clamp(stats?.agi, 0, 5),
      luk: clamp(stats?.luk, 0, 5),
    },
    items: Array.isArray(items) ? items.slice(0, 12) : [],
    avatar: avatar || "",
    hp: 100,
    maxHp: 100,
    alive: true,
    ready: false,
  };
  b.players.push(p);
  addLog(b, "system", `Player joined: ${p.name} [${p.team}]`);
  broadcastBattle(b);
  res.json({ ok: true, player: p });
});

app.delete("/api/battles/:id/players/:playerId", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const n = b.players.length;
  b.players = b.players.filter((p) => p.id !== req.params.playerId);
  if (b.players.length === n) return res.status(404).json({ error: "player_not_found" });
  addLog(b, "system", `Player removed: ${req.params.playerId}`);
  broadcastBattle(b);
  res.json({ ok: true });
});

/* ───────────────────────────────────────────
   REST: Admin/Links/OTP
─────────────────────────────────────────── */
app.post("/api/admin/battles/:id/start", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });

  b.status = "live";
  b.startedAt = b.startedAt || now();

  // 선공: 민첩 합
  if (!b.turn.current && b.players.length) {
    const sum = (t) => b.players.filter((p) => p.team === t).reduce((a, p) => a + (p.stats?.agi || 0), 0);
    const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
    const first = b.players.find((p) => p.team === firstTeam) || b.players[0];
    setTurn(b, first?.id || null);
  }
  addLog(b, "system", "Battle started");
  broadcastBattle(b);
  res.json({ ok: true, battle: b });
});

app.post("/api/admin/battles/:id/pause", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "waiting";
  clearTurnTimer(b);
  addLog(b, "system", "Battle paused");
  broadcastBattle(b);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/end", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "ended";
  b.endedAt = now();
  clearTurnTimer(b);
  addLog(b, "system", "Battle ended");
  broadcastBattle(b);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/links", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const base = toAbsBase(req);
  const spectatorOtp = genOTP("spectator", b.id);

  const adminUrl = `${base}/admin?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.adminToken)}`;
  const playerUrl = `${base}/play?battle=${encodeURIComponent(b.id)}&token={playerOtp}`;
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(spectatorOtp)}`;
  res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl });
});

app.post("/api/admin/battles/:id/otp", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });

  const role = String(req.body?.role || "player").toLowerCase();
  if (!["player", "spectator", "admin"].includes(role)) {
    return res.status(400).json({ ok: false, error: "invalid_role" });
  }
  const count = Math.max(1, Math.min(100, Number(req.body?.count || 1)));
  const list = Array.from({ length: count }, () => genOTP(role, b.id));
  addLog(b, "system", `OTP issued for ${role} x${count}`);
  res.json({ ok: true, role, otps: list });
});

app.get("/api/otp/:token", (req, res) => {
  const v = validateOTP(req.params.token);
  if (!v.valid) return res.status(400).json(v);
  res.json(v);
});

/* ───────────────────────────────────────────
   아바타 업로드
─────────────────────────────────────────── */
const storage = multer.diskStorage({
  destination: function (req, _file, cb) {
    const battleId = req.params.id || "common";
    const dest = path.join(PUB_DIR, "uploads/avatars", battleId);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: function (_req, file, cb) {
    const ts = Date.now();
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, "avatar_" + ts + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (_req, file, cb) {
    const ok = /image\/(png|jpeg|jpg|gif|webp)/i.test(file.mimetype);
    cb(ok ? null : new Error("이미지 파일만 업로드 가능합니다."), ok);
  },
});
app.post("/api/battles/:id/avatar", upload.single("avatar"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "파일이 없습니다." });
    const battleId = req.params.id;
    const rel = `/uploads/avatars/${encodeURIComponent(battleId)}/${encodeURIComponent(req.file.filename)}`;
    res.json({ ok: true, url: rel });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ───────────────────────────────────────────
   Socket.IO
─────────────────────────────────────────── */
io.on("connection", (socket) => {
  /* 관리자 인증 */
  socket.on("adminAuth", ({ battleId, token }) => {
    const b = battles.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit("authError", { error: "unauthorized" });
      return;
    }
    socket.join(battleId);
    socket.data.role = "admin";
    socket.data.battleId = battleId;
    socket.emit("authSuccess", { ok: true, battle: b });
  });

  socket.on("admin:requestState", ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) socket.emit("battleUpdate", b);
  });

  /* 채팅(관리자/플레이어/관전자 공통 수신) */
  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const sender = role === "admin" ? "관리자" : "플레이어";
    addLog(b, "chat", `${sender}: ${String(message || "").slice(0, 500)}`);
    io.to(b.id).emit("battle:chat", { name: sender, msg: String(message || "").slice(0, 500) });
  });

  /* 관전자 입장/응원 */
  socket.on("spectator:join", ({ battleId, otp, name }) => {
    const v = validateOTP(otp);
    if (!v.valid || v.role !== "spectator" || v.data.battleId !== battleId) {
      socket.emit("spectator:join_fail", { reason: "OTP가 유효하지 않습니다" });
      return;
    }
    const b = battles.get(battleId);
    if (!b) return socket.emit("spectator:join_fail", { reason: "전투가 없습니다" });

    consumeOTP(otp);
    socket.join(battleId);
    socket.data.role = "spectator";
    socket.data.battleId = battleId;
    socket.data.name = String(name || "관전자");

    socket.emit("spectator:join_ok", { battle: b });
    addLog(b, "system", `관전자 입장: ${socket.data.name}`);
    broadcastBattle(b);
  });

  socket.on("spectator:cheer", ({ name, msg }) => {
    const battleId = socket.data?.battleId;
    if (!battleId) return;
    const b = battles.get(battleId);
    if (!b) return;
    const safeName = String(name || "관전자").slice(0, 30);
    const safeMsg = String(msg || "").slice(0, 100);
    io.to(b.id).emit("battle:chat", { name: safeName, msg: safeMsg });
    addLog(b, "cheer", `${safeName}: ${safeMsg}`);
  });

  /* 플레이어 인증 */
  socket.on("player:auth", ({ battleId, otp, name }) => {
    const v = validateOTP(otp);
    if (!v.valid || v.role !== "player" || v.data.battleId !== battleId) {
      socket.emit("auth:fail", { reason: "OTP가 유효하지 않습니다" });
      return;
    }
    const b = battles.get(battleId);
    if (!b) return socket.emit("auth:fail", { reason: "전투가 없습니다" });

    consumeOTP(otp);

    // 이름으로 매칭(사전 등록 플레이어)
    const p = b.players.find((x) => x.name === name);
    if (!p) {
      socket.emit("auth:fail", { reason: "등록된 플레이어가 아닙니다" });
      return;
    }

    socket.join(battleId);
    socket.data.role = "player";
    socket.data.battleId = battleId;
    socket.data.playerId = p.id;
    socket.data.name = p.name;

    const teamMates = b.players.filter((x) => x.team === p.team);
    const enemies = b.players.filter((x) => x.team !== p.team);

    socket.emit("auth:success", { player: p, teamMates, enemies, battle: b });
    addLog(b, "system", `플레이어 인증: ${p.name}`);
    broadcastBattle(b);
  });

  /* 플레이어 준비 */
  socket.on("player:ready", () => {
    const battleId = socket.data?.battleId;
    const playerId = socket.data?.playerId;
    const b = battles.get(battleId);
    if (!b || !playerId) return;

    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;

    p.ready = true;
    addLog(b, "system", `${p.name} 준비 완료`);

    const allReady = b.players.length > 0 && b.players.every((x) => x.ready);
    if (allReady && b.status !== "live") {
      // 선공
      const sum = (t) => b.players.filter((pp) => pp.team === t).reduce((a, pp) => a + (pp.stats?.agi || 0), 0);
      const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
      const first = b.players.find((pp) => pp.team === firstTeam) || b.players[0];

      addLog(b, "system", `모두 준비됨 → 전투 시작 / 선공: ${first?.name || "-"}`);
      b.status = "live";
      b.startedAt = b.startedAt || now();
      setTurn(b, first?.id || null);
    }

    broadcastBattle(b);
  });

  /* 플레이어 액션 */
  socket.on("player:action", ({ action, targetId }) => {
    const battleId = socket.data?.battleId;
    const playerId = socket.data?.playerId;
    const b = battles.get(battleId);
    if (!b || !playerId) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p || !b.turn.current || b.turn.current !== p.id) return;

    // 간단한 액션 처리
    let logText = "";
    if (action === "pass") {
      logText = `${p.name}이(가) 패스했습니다.`;
    } else if (action === "defend") {
      logText = `${p.name}이(가) 방어 태세!`;
    } else if (action === "dodge") {
      logText = `${p.name}이(가) 회피 태세!`;
    } else if (action === "attack") {
      const tgt = b.players.find((x) => x.id === targetId && x.team !== p.team);
      if (!tgt) return;
      // 피해량(간단): atk + 랜덤(1~6) - tgt.def, 최소 1
      const dmg = Math.max(1, (p.stats?.atk || 0) + (1 + Math.floor(Math.random() * 6)) - (tgt.stats?.def || 0));
      tgt.hp = Math.max(0, tgt.hp - dmg);
      if (tgt.hp === 0) { tgt.alive = false; }
      logText = `${p.name} ▶ ${tgt.name} 공격! ${dmg} 피해 (남은 HP ${tgt.hp})`;
    } else if (action && action.type === "item") {
      logText = `${p.name}이(가) 아이템을 사용했습니다.`;
    } else {
      logText = `Action: ${JSON.stringify(action)}`;
    }

    addLog(b, "action", logText);

    // 다음 턴
    const nextId = pickNextPlayer(b, p.id);
    setTurn(b, nextId);
    broadcastBattle(b);
    socket.emit("action:ok", { ok: true });
  });

  /* 호환: 관리자가 버튼으로 시작하는 소켓 이벤트 */
  socket.on("battle:start", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    b.status = "live";
    b.startedAt = b.startedAt || now();
    if (!b.turn.current && b.players.length) {
      const sum = (t) => b.players.filter((p) => p.team === t).reduce((a, p) => a + (p.stats?.agi || 0), 0);
      const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
      const first = b.players.find((p) => p.team === firstTeam) || b.players[0];
      setTurn(b, first?.id || null);
    }
    addLog(b, "system", "Battle started");
    broadcastBattle(b);
  });

  socket.on("disconnect", () => {
    // 필요 시 정리 로직 추가 가능
  });
});

/* ───────────────────────────────────────────
   시작
─────────────────────────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS battle-server listening on ${HOST}:${PORT}`);
});
