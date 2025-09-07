// packages/battle-server/index.js
"use strict";

/**
 * PYXIS Battle Server – Unified Entrypoint
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
app.use(express.static(PUB_DIR));
// 아바타/업로드 정적 제공
app.use(
  "/uploads",
  express.static(path.join(__dirname, "public", "uploads"), { maxAge: "7d" })
);

// 단축 라우트(페이지)
app.get("/admin", (_req, res) =>
  res.sendFile(path.join(PUB_DIR, "pages", "admin.html"))
);
app.get("/play", (_req, res) =>
  res.sendFile(path.join(PUB_DIR, "pages", "player.html"))
);
app.get("/spectator", (_req, res) =>
  res.sendFile(path.join(PUB_DIR, "pages", "spectator.html"))
);

// 기본 루트 접속 시 admin 페이지 보여주기
app.get("/", (_req, res) =>
  res.sendFile(path.join(PUB_DIR, "pages", "admin.html"))
);

// 헬스체크
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now(), service: "battle-server" })
);

/* ----------------------------------------------------------------------------
   간단한 상태 메모리
---------------------------------------------------------------------------- */
const battles = new Map(); // id -> battle

function now() {
  return Date.now();
}
function makeId(n = 10) {
  const c =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++)
    s += c[(Math.random() * c.length) | 0];
  return s;
}
function teamKey(v) {
  const s = String(v || "").toLowerCase();
  if (["a", "phoenix", "team1"].includes(s)) return "phoenix";
  if (
    ["b", "eaters", "team2", "death", "deatheaters"].includes(s)
  )
    return "eaters";
  return "phoenix";
}
function toAbsBase(req) {
  return (
    PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "")
  );
}

/* ----------------------------------------------------------------------------
   OTP (간단 구현)
---------------------------------------------------------------------------- */
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
  b.log.push({
    t: now(),
    type: "system",
    message: `Battle created (mode ${mode})`,
  });
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
    items: Array.isArray(items) ? items.slice(0, 9) : [],
    avatar: avatar || "",
    hp: 100,
    maxHp: 100,
  };
  b.players.push(p);
  b.log.push({
    t: now(),
    type: "system",
    message: `Player joined: ${p.name} [${p.team}]`,
  });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true, player: p });
});

app.delete("/api/battles/:id/players/:playerId", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const n = b.players.length;
  b.players = b.players.filter((p) => p.id !== req.params.playerId);
  if (b.players.length === n)
    return res.status(404).json({ error: "player_not_found" });
  b.log.push({
    t: now(),
    type: "system",
    message: `Player removed: ${req.params.playerId}`,
  });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true });
});

/* ----------------------------------------------------------------------------
   REST: Admin
---------------------------------------------------------------------------- */
app.post("/api/admin/battles/:id/start", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "live";
  b.startedAt = b.startedAt || now();
  if (!b.turn.current && b.players.length) {
    const sum = (t) =>
      b.players
        .filter((p) => p.team === t)
        .reduce((a, p) => a + (p.stats?.agi || 0), 0);
    const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
    const first = b.players.find((p) => p.team === firstTeam) || b.players[0];
    b.turn.current = first?.id || null;
    b.turn.lastChange = now();
  }
  b.log.push({ t: now(), type: "system", message: "Battle started" });
  io.to(b.id).emit("battleUpdate", b);
  res.json({ ok: true, battle: b });
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
  const spectatorOtp = genOTP("spectator", b.id);
  const adminUrl = `${base}/admin?battle=${encodeURIComponent(
    b.id
  )}&token=${encodeURIComponent(b.adminToken)}`;
  const playerUrl = `${base}/play?battle=${encodeURIComponent(
    b.id
  )}&token={playerOtp}`;
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(
    b.id
  )}&token=${encodeURIComponent(spectatorOtp)}`;
  res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl });
});

app.post("/api/admin/battles/:id/otp", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const role = String(req.body?.role || "player").toLowerCase();
  if (!["player", "spectator"].includes(role))
    return res.status(400).json({ error: "invalid_role" });
  const count =
    role === "player"
      ? Math.max(1, Math.min(100, Number(req.body?.count || 1)))
      : 1;
  const otplist = Array.from({ length: count }, () =>
    genOTP(role, b.id)
  );
  res.json({ ok: true, role, otps: otplist });
});

app.get("/api/otp/:token", (req, res) => {
  const v = validateOTP(req.params.token);
  if (!v.valid) return res.status(400).json(v);
  res.json(v);
});

/* ----------------------------------------------------------------------------
   아바타 업로드
---------------------------------------------------------------------------- */
const storage = multer.diskStorage({
  destination: function (req, _file, cb) {
    const battleId = req.params.id || "common";
    const dest = path.join(PUB_DIR, "uploads", "avatars", battleId);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: function (_req, file, cb) {
    const ts = Date.now();
    const ext =
      path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, "avatar_" + ts + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (_req, file, cb) {
    const ok = /image\/(png|jpeg|jpg|gif|webp)/i.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error("이미지 파일만 업로드 가능합니다."));
  },
});
app.post("/api/battles/:id/avatar", upload.single("avatar"), (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ ok: false, error: "파일이 없습니다." });
    const battleId = req.params.id;
    const rel = `/uploads/avatars/${encodeURIComponent(
      battleId
    )}/${encodeURIComponent(req.file.filename)}`;
    res.json({ ok: true, url: rel });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ----------------------------------------------------------------------------
   Socket.IO
---------------------------------------------------------------------------- */
io.on("connection", (socket) => {
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
    b.status = "live";
    b.startedAt = b.startedAt || now();
    if (!b.turn.current && b.players.length) {
      const sum = (t) =>
        b.players
          .filter((p) => p.team === t)
          .reduce((a, p) => a + (p.stats?.agi || 0), 0);
      const firstTeam =
        sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
      b.turn.current =
        (b.players.find((p) => p.team === firstTeam) || b.players[0]).id;
      b.turn.lastChange = now();
    }
    b.log.push({ t: now(), type: "system", message: "Battle started" });
    io.to(b.id).emit("battleUpdate", b);
  });

  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const sender = role === "admin" ? "관리자" : "플레이어";
    const msg = String(message || "").slice(0, 500);
    b.log.push({ t: now(), type: "chat", message: `${sender}: ${msg}` });
    io.to(b.id).emit("chatMessage", { sender, message: msg });
    io.to(b.id).emit("battleUpdate", b); // 로그 동기화
  });
});

/* ----------------------------------------------------------------------------
   시작
---------------------------------------------------------------------------- */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS battle-server listening on ${HOST}:${PORT}`);
});
