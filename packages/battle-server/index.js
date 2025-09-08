"use strict";

/**
 * PYXIS Battle Server – Unified Entrypoint (FIXED)
 * - Express + Socket.IO
 * - OTP(관전석 1회 발급, 최대 30명) & 플레이어 OTP
 * - 전원 준비 → 자동 시작, 선공 "플레이어 이름" 표시
 * - 채팅 이벤트 정규화(chat:send/chatMessage → battle:chat)
 * - /admin, /play, /spectator 페이지 라우팅 그대로
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");

/* ----------------------------------------------------------------------------
   환경
---------------------------------------------------------------------------- */
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

/* ----------------------------------------------------------------------------
   앱/소켓
---------------------------------------------------------------------------- */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST", "DELETE"] },
});
app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ----------------------------------------------------------------------------
   정적 경로
---------------------------------------------------------------------------- */
const PUB_DIR = path.join(__dirname, "public");
app.use(express.static(PUB_DIR, { index: false }));
// 아바타/업로드 정적 제공
app.use("/uploads", express.static(path.join(PUB_DIR, "uploads"), { maxAge: "7d" }));

// 단축 라우트(페이지)
app.get("/admin", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "admin.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "player.html")));
app.get("/spectator", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "spectator.html")));

// 헬스체크
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now(), service: "battle-server" }));

/* ----------------------------------------------------------------------------
   간단한 상태 메모리
---------------------------------------------------------------------------- */
const battles = new Map(); // id -> battle

function now() { return Date.now(); }
function makeId(n = 10) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0]; return s;
}
function teamKey(v) {
  const s = String(v || "").toLowerCase();
  if (["a", "phoenix", "team1"].includes(s)) return "phoenix";
  if (["b", "eaters", "team2", "death", "deatheaters"].includes(s)) return "eaters";
  return "phoenix";
}
function toAbsBase(req) {
  return (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`.replace(/\/+$/, ""));
}

/* ----------------------------------------------------------------------------
   OTP 저장소(개선)
   - token -> { role, battleId, usesLeft, expiresAt }
---------------------------------------------------------------------------- */
const OTP_STORE = new Map();

function createOTP({ role, battleId, usesLeft = 1, ttlMs = 2 * 60 * 60 * 1000 }) {
  const token = makeId(16);
  OTP_STORE.set(token, { role, battleId, usesLeft, expiresAt: now() + ttlMs });
  return token;
}

function issueSpectatorOTP(battleId) {
  // 1개 토큰으로 30명 입장, 30분 TTL
  return createOTP({ role: "spectator", battleId, usesLeft: 30, ttlMs: 30 * 60 * 1000 });
}

function issuePlayerOTPs(battleId, count = 1) {
  // 플레이어는 1회용 토큰(2시간)
  count = Math.max(1, Math.min(100, Number(count || 1)));
  return Array.from({ length: count }, () => createOTP({ role: "player", battleId, usesLeft: 1, ttlMs: 2 * 60 * 60 * 1000 }));
}

function validateOTP(token) {
  const d = OTP_STORE.get(token);
  if (!d) return { valid: false, error: "not_found" };
  if (d.expiresAt < now()) {
    OTP_STORE.delete(token);
    return { valid: false, error: "expired" };
  }
  if (d.usesLeft <= 0) {
    OTP_STORE.delete(token);
    return { valid: false, error: "exhausted" };
  }
  return { valid: true, role: d.role, battleId: d.battleId, usesLeft: d.usesLeft, expiresAt: d.expiresAt };
}

function consumeOTP(token) {
  const v = validateOTP(token);
  if (!v.valid) return v;
  const d = OTP_STORE.get(token);
  d.usesLeft -= 1;
  if (d.usesLeft <= 0) OTP_STORE.delete(token);
  else OTP_STORE.set(token, d);
  return { ok: true, role: d.role, battleId: d.battleId, usesLeft: d.usesLeft };
}

/* ----------------------------------------------------------------------------
   전투 유틸
---------------------------------------------------------------------------- */
function ensureBattle(battleId) {
  const b = battles.get(battleId);
  if (!b) throw new Error("not_found");
  return b;
}

function sumAgiOfTeam(b, t) {
  return b.players.filter((p) => p.team === t).reduce((a, p) => a + (p.stats?.agi || p.stats?.AGI || 0), 0);
}

function pickFirstTurnPlayer(b) {
  // 팀 민첩 합 → 선공 팀 → 그 팀의 첫 플레이어
  const a = sumAgiOfTeam(b, "phoenix");
  const e = sumAgiOfTeam(b, "eaters");
  const firstTeam = a >= e ? "phoenix" : "eaters";
  const first = b.players.find((p) => p.team === firstTeam);
  return first?.id || null;
}

function startBattle(b, reason = "auto") {
  if (b.status === "live") return;
  b.status = "live";
  b.startedAt = b.startedAt || now();
  if (!b.turn.current) {
    b.turn.current = pickFirstTurnPlayer(b);
    b.turn.lastChange = now();
  }
  const turnName = (b.players.find((p) => p.id === b.turn.current)?.name) || b.turn.current || "-";
  b.log.push({ t: now(), type: "system", message: `Battle started (first: ${turnName})` });
  io.to(b.id).emit("battleUpdate", b);
  io.to(b.id).emit("battle:log", { type: "system", msg: `전투 시작! 선공: ${turnName}` });
}

function areAllReady(b) {
  const list = b.players;
  return list.length > 0 && list.every((p) => p.ready === true);
}

/* ----------------------------------------------------------------------------
   REST: Battles
---------------------------------------------------------------------------- */
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
    turn: { current: null, lastChange: null },
    log: [],
  };
  battles.set(id, b);
  b.log.push({ t: now(), type: "system", message: `Battle created (mode ${mode})` });
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
  const { name, team, stats, items, avatar } = req.body || {};
  if (!name) return res.status(400).json({ error: "invalid_name" });

  const p = {
    id: makeId(12),
    name: String(name),
    team: teamKey(team),
    stats: {
      atk: Math.max(0, Math.min(5, Number(stats?.atk ?? 3))),
      def: Math.max(0, Math.min(5, Number(stats?.def ?? 3))),
      agi: Math.max(0, Math.min(5, Number(stats?.agi ?? 3))),
      luk: Math.max(0, Math.min(5, Number(stats?.luk ?? 3))),
    },
    items: Array.isArray(items) ? items.slice(0, 30) : [],
    avatar: avatar || "",
    hp: 100,
    maxHp: 100,
    ready: false,
  };
  b.players.push(p);
  b.log.push({ t: now(), type: "system", message: `Player joined: ${p.name} [${p.team}]` });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true, player: p });
});

app.delete("/api/battles/:id/players/:playerId", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const n = b.players.length;
  b.players = b.players.filter((p) => p.id !== req.params.playerId);
  if (b.players.length === n) return res.status(404).json({ error: "player_not_found" });
  b.log.push({ t: now(), type: "system", message: `Player removed: ${req.params.playerId}` });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true });
});

/* ----------------------------------------------------------------------------
   REST: Admin
---------------------------------------------------------------------------- */
app.post("/api/admin/battles/:id/start", (req, res) => {
  try {
    const b = ensureBattle(req.params.id);
    startBattle(b, "admin");
    res.json({ ok: true, battle: b });
  } catch (e) {
    res.status(404).json({ error: "not_found" });
  }
});

app.post("/api/admin/battles/:id/pause", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "waiting";
  b.log.push({ t: now(), type: "system", message: "Battle paused" });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/end", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "ended";
  b.endedAt = now();
  b.log.push({ t: now(), type: "system", message: "Battle ended" });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/links", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const base = toAbsBase(req);
  const spectatorOtp = issueSpectatorOTP(b.id);
  const adminUrl = `${base}/admin?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.adminToken)}`;
  const playerUrl = `${base}/play?battle=${encodeURIComponent(b.id)}&token={playerOtp}`;
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(spectatorOtp)}`;
  res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl });
});

app.post("/api/admin/battles/:id/otp", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const role = String(req.body?.role || "player").toLowerCase();

  if (role === "spectator") {
    const token = issueSpectatorOTP(b.id);
    b.log.push({ t: now(), type: "system", message: "OTP issued for spectator x1" });
    return res.json({ ok: true, role, otps: [token], usesLeft: 30 });
  }

  if (role === "player") {
    const count = Math.max(1, Math.min(100, Number(req.body?.count || 1)));
    const otps = issuePlayerOTPs(b.id, count);
    b.log.push({ t: now(), type: "system", message: `OTP issued for player x${count}` });
    return res.json({ ok: true, role, otps });
  }

  return res.status(400).json({ error: "invalid_role" });
});

app.get("/api/otp/:token", (req, res) => {
  const v = validateOTP(req.params.token);
  if (!v.valid) return res.status(400).json(v);
  res.json(v);
});

/* ----------------------------------------------------------------------------
   아바타 업로드: POST /api/battles/:id/avatar
---------------------------------------------------------------------------- */
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

/* ----------------------------------------------------------------------------
   Socket.IO
---------------------------------------------------------------------------- */
io.on("connection", (socket) => {
  // --- Admin auth ---
  socket.on("adminAuth", ({ battleId, token }) => {
    const b = battles.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit("authError", { error: "unauthorized" });
      return;
    }
    socket.join(battleId);
    socket.emit("authSuccess", { ok: true, battle: b });
  });

  socket.on("admin:requestState", ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) socket.emit("battleUpdate", b);
  });

  socket.on("battle:start", ({ battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    startBattle(b, "admin");
  });

  // --- Player auth using OTP ---
  socket.on("player:auth", ({ battleId, otp, name }) => {
    try {
      const v = consumeOTP(otp);
      if (!v.ok || v.role !== "player" || v.battleId !== battleId) {
        socket.emit("auth:fail", { reason: "OTP가 유효하지 않습니다" });
        return;
      }
      const b = ensureBattle(battleId);
      socket.join(battleId);
      // 이름으로 기존 플레이어 매칭(관리자에서 미리 추가한 경우)
      let player = b.players.find((p) => p.name === name);
      if (!player) {
        // 없으면 기본값으로 신규 등록(phoenix)
        player = {
          id: makeId(12),
          name,
          team: "phoenix",
          stats: { atk: 3, def: 3, agi: 3, luk: 3 },
          items: [],
          avatar: "",
          hp: 100,
          maxHp: 100,
          ready: false,
        };
        b.players.push(player);
        b.log.push({ t: now(), type: "system", message: `Player auto-joined: ${name} [phoenix]` });
        io.to(b.id).emit("battleUpdate", b);
      }
      socket.data.playerId = player.id;
      socket.emit("auth:success", {
        player,
        players: b.players,
        snapshot: b,
      });
    } catch (e) {
      socket.emit("auth:fail", { reason: "인증 중 오류" });
    }
  });

  // --- Player ready ---
  socket.on("player:ready", ({ battleId, playerId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;
    p.ready = true;
    b.log.push({ t: now(), type: "system", message: `${p.name} 준비 완료` });
    io.to(b.id).emit("battleUpdate", b);
    if (areAllReady(b)) {
      b.log.push({ t: now(), type: "system", message: "모두 준비됨 → 전투 시작" });
      startBattle(b, "autoReady");
    }
  });

  // --- Player action (간이: 로그만) ---
  socket.on("player:action", ({ battleId, playerId, action }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;
    b.log.push({ t: now(), type: "system", message: `Action: ${JSON.stringify(action)} by ${p.name}` });
    io.to(b.id).emit("battleUpdate", b);
  });

  // --- Spectator join ---
  socket.on("spectator:join", ({ battleId, otp, name }) => {
    const v = consumeOTP(otp);
    if (!v.ok || v.role !== "spectator" || v.battleId !== battleId) {
      socket.emit("authError", { error: "OTP_INVALID" });
      return;
    }
    const b = battles.get(battleId);
    if (!b) {
      socket.emit("authError", { error: "BATTLE_NOT_FOUND" });
      return;
    }
    socket.join(battleId);
    socket.data.spectatorName = name || "관전자";
    socket.emit("spectator:join_ok");
    socket.emit("battleUpdate", b);
    b.log.push({ t: now(), type: "system", message: `Spectator joined: ${socket.data.spectatorName}` });
    io.to(b.id).emit("battleUpdate", b);
  });

  // --- Spectator cheer ---
  socket.on("spectator:cheer", ({ battleId, name, msg }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const who = name || socket.data.spectatorName || "관전자";
    io.to(b.id).emit("battle:chat", { name: who, msg });
    b.log.push({ t: now(), type: "cheer", message: `${who}: ${msg}` });
    io.to(b.id).emit("battleUpdate", b);
  });

  // --- Chat: normalize ---
  socket.on("chat:send", ({ battleId, msg, name }) => {
    const b = battles.get(battleId);
    if (!b || !msg) return;
    const who = name || "플레이어";
    io.to(b.id).emit("battle:chat", { name: who, msg });
    b.log.push({ t: now(), type: "chat", message: `${who}: ${msg}` });
    io.to(b.id).emit("battleUpdate", b);
  });

  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = battles.get(battleId);
    if (!b || !message) return;
    const sender = role === "admin" ? "관리자" : "플레이어";
    io.to(b.id).emit("battle:chat", { name: sender, msg: message });
    b.log.push({ t: now(), type: "chat", message: `${sender}: ${message}` });
    io.to(b.id).emit("battleUpdate", b);
  });
});

/* ----------------------------------------------------------------------------
   시작
---------------------------------------------------------------------------- */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS battle-server listening on ${HOST}:${PORT}`);
});
