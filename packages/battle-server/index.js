"use strict";

/**
 * PYXIS Battle Server – Unified Entrypoint (수정 안정판)
 * - Express + Socket.IO
 * - body-parser 제거 → express.json/express.urlencoded 사용
 * - OTP 발급/검증/소켓 인증(플레이어/관전자) 보강
 * - 아바타 업로드, 정적/페이지 라우트, 간단 전투상태 관리
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ----------------------------------------------------------------------------
   정적 경로
---------------------------------------------------------------------------- */
const PUB_DIR = path.join(__dirname, "public");
app.use(express.static(PUB_DIR, { index: false }));
// 업로드(아바타) 정적 제공
app.use("/uploads", express.static(path.join(PUB_DIR, "uploads"), { maxAge: "7d" }));

// 페이지 단축 라우트
app.get("/admin", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "admin.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "player.html")));
app.get("/spectator", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "spectator.html")));

// 헬스체크
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now(), service: "battle-server" }));

/* ----------------------------------------------------------------------------
   간단한 상태 메모리
---------------------------------------------------------------------------- */
const battles = new Map(); // id -> battle

function now() {
  return Date.now();
}
function makeId(n = 10) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0];
  return s;
}
function teamKey(v) {
  const s = String(v || "").toLowerCase();
  if (["a", "phoenix", "team1", "불사조", "불사조기사단"].includes(s)) return "phoenix";
  if (["b", "eaters", "team2", "death", "deatheaters", "죽음을먹는자", "죽음을먹는자들"].includes(s))
    return "eaters";
  return "phoenix";
}
function toAbsBase(req) {
  return (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

/* ----------------------------------------------------------------------------
   OTP(간이 구현)
   - token -> { role, battleId, createdAt, uses, maxUses, ttlMs, used:boolean }
---------------------------------------------------------------------------- */
const otps = new Map();
const OTP_DEFAULTS = {
  ttl: { spectator: 30 * 60 * 1000, player: 2 * 60 * 60 * 1000, admin: 24 * 60 * 60 * 1000 },
  maxUses: { spectator: 30, player: 1, admin: 1 },
};
function genOTP(role, battleId, opts = {}) {
  const token = makeId(16);
  const entry = {
    role,
    battleId,
    createdAt: now(),
    ttlMs: Number(opts.ttlMs ?? OTP_DEFAULTS.ttl[role] ?? 60 * 60 * 1000),
    uses: 0,
    maxUses: Number(opts.maxUses ?? OTP_DEFAULTS.maxUses[role] ?? 1),
    used: false,
  };
  otps.set(token, entry);
  return token;
}
function validateOTP(token) {
  const d = otps.get(token);
  if (!d) return { valid: false, error: "not_found" };
  if (d.used) return { valid: false, error: "used" };
  if (d.ttlMs > 0 && now() - d.createdAt > d.ttlMs) return { valid: false, error: "expired" };
  if (d.uses >= d.maxUses) return { valid: false, error: "exceeded" };
  return { valid: true, role: d.role, data: { battleId: d.battleId } };
}
function consumeOTP(token) {
  const d = otps.get(token);
  if (!d) return;
  d.uses++;
  if (d.uses >= d.maxUses) d.used = true;
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
  return res.json({ id, token: b.adminToken, battle: b });
});

app.get("/api/battles/:id", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  return res.json(b);
});

app.post("/api/battles/:id/players", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const { name, team, stats, items, avatar } = req.body || {};
  const nameStr = String(name || "").trim();
  if (!nameStr) return res.status(400).json({ error: "invalid_name" });

  const p = {
    id: makeId(12),
    name: nameStr,
    team: teamKey(team),
    stats: {
      atk: Math.max(0, Math.min(5, Number(stats?.atk ?? 0))),
      def: Math.max(0, Math.min(5, Number(stats?.def ?? 0))),
      agi: Math.max(0, Math.min(5, Number(stats?.agi ?? 0))),
      luk: Math.max(0, Math.min(5, Number(stats?.luk ?? 0))),
    },
    items: Array.isArray(items) ? items.slice(0, 9) : [],
    avatar: avatar || "",
    hp: 100,
    maxHp: 100,
    ready: false,
  };
  b.players.push(p);
  b.log.push({ t: now(), type: "system", message: `Player joined: ${p.name} [${p.team}]` });
  io.to(b.id).emit("battleUpdate", b);
  return res.json({ ok: true, player: p });
});

app.delete("/api/battles/:id/players/:playerId", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const n = b.players.length;
  b.players = b.players.filter((p) => p.id !== req.params.playerId);
  if (b.players.length === n) return res.status(404).json({ error: "player_not_found" });
  b.log.push({ t: now(), type: "system", message: `Player removed: ${req.params.playerId}` });
  io.to(b.id).emit("battleUpdate", b);
  return res.json({ ok: true });
});

/* ----------------------------------------------------------------------------
   REST: Admin
---------------------------------------------------------------------------- */
app.post("/api/admin/battles/:id/start", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "live";
  b.startedAt = b.startedAt || now();

  // 선공 결정 (민첩 합계 → 동률이면 phoenix)
  if (!b.turn.current && b.players.length) {
    const sum = (t) => b.players.filter((p) => p.team === t).reduce((a, p) => a + (p.stats?.agi || 0), 0);
    const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
    const first = b.players.find((p) => p.team === firstTeam) || b.players[0];
    b.turn.current = first?.id || null;
    b.turn.lastChange = now();
    if (first) {
      b.log.push({ t: now(), type: "system", message: `선공: ${first.name}` });
    }
  }

  b.log.push({ t: now(), type: "system", message: "Battle started" });
  io.to(b.id).emit("battleUpdate", b);
  return res.json({ ok: true, battle: b });
});

app.post("/api/admin/battles/:id/pause", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "waiting";
  b.log.push({ t: now(), type: "system", message: "Battle paused" });
  io.to(b.id).emit("battleUpdate", b);
  return res.json({ ok: true });
});

app.post("/api/admin/battles/:id/end", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "ended";
  b.endedAt = now();
  b.log.push({ t: now(), type: "system", message: "Battle ended" });
  io.to(b.id).emit("battleUpdate", b);
  return res.json({ ok: true });
});

app.post("/api/admin/battles/:id/links", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const base = toAbsBase(req);
  const spectatorOtp = genOTP("spectator", b.id);
  const adminUrl = `${base}/admin?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.adminToken)}`;
  const playerUrl = `${base}/play?battle=${encodeURIComponent(b.id)}&token={playerOtp}`;
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(spectatorOtp)}`;
  return res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl });
});

app.post("/api/admin/battles/:id/otp", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const role = String(req.body?.role || "player").toLowerCase();
  if (!["player", "spectator", "admin"].includes(role))
    return res.status(400).json({ ok: false, error: "invalid_role" });

  const count = role === "player" ? Math.max(1, Math.min(100, Number(req.body?.count || 1))) : 1;
  const opts = {};
  if (typeof req.body?.maxUses !== "undefined") opts.maxUses = Number(req.body.maxUses);
  if (typeof req.body?.ttlMs !== "undefined") opts.ttlMs = Number(req.body.ttlMs);

  const otplist = Array.from({ length: count }, () => genOTP(role, b.id, opts));
  b.log.push({ t: now(), type: "system", message: `OTP issued for ${role} x${count}` });
  return res.json({ ok: true, role, otps: otplist });
});

app.get("/api/otp/:token", (req, res) => {
  const v = validateOTP(req.params.token);
  return res.status(v.valid ? 200 : 400).json(v);
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
    return res.json({ ok: true, url: rel });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/* ----------------------------------------------------------------------------
   Socket.IO
---------------------------------------------------------------------------- */
io.on("connection", (socket) => {
  /* ---------- 관리자 인증/상태 ---------- */
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
      const sum = (t) => b.players.filter((p) => p.team === t).reduce((a, p) => a + (p.stats?.agi || 0), 0);
      const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
      const first = b.players.find((p) => p.team === firstTeam) || b.players[0];
      b.turn.current = first?.id || null;
      b.turn.lastChange = now();
      if (first) b.log.push({ t: now(), type: "system", message: `선공: ${first.name}` });
    }
    b.log.push({ t: now(), type: "system", message: "Battle started" });
    io.to(b.id).emit("battleUpdate", b);
  });

  /* ---------- 플레이어 인증/행동/채팅 ---------- */
  socket.on("player:auth", ({ battleId, otp, name }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("auth:fail", { reason: "전투를 찾을 수 없음" });

    const val = validateOTP(otp);
    if (!val.valid || val.role !== "player" || val.data.battleId !== battleId) {
      return socket.emit("auth:fail", { reason: "OTP가 유효하지 않음" });
    }
    consumeOTP(otp);

    socket.join(battleId);

    // 이름으로 기존 플레이어 매칭 (없으면 임시 생성)
    const byName = (s) => String(s || "").trim().toLowerCase();
    let me =
      b.players.find((p) => byName(p.name) === byName(name)) ||
      (() => {
        const newbie = {
          id: makeId(12),
          name: name || "Player",
          team: (b.players.length && b.players[0]?.team === "phoenix") ? "eaters" : "phoenix",
          stats: { atk: 0, def: 0, agi: 0, luk: 0 },
          items: [],
          avatar: "",
          hp: 100,
          maxHp: 100,
          ready: false,
        };
        b.players.push(newbie);
        b.log.push({ t: now(), type: "system", message: `Player joined (OTP): ${newbie.name} [${newbie.team}]` });
        return newbie;
      })();

    // 팀 분리
    const teamMates = b.players.filter((p) => p.team === me.team && p.id !== me.id);
    const enemies = b.players.filter((p) => p.team !== me.team);

    socket.emit("auth:success", { player: me, teamMates, enemies, battleId });

    // 현재 선공/턴 표시용 안내
    if (b.turn.current) {
      const turnPlayer = b.players.find((p) => p.id === b.turn.current);
      if (turnPlayer) {
        socket.emit("battle:log", { type: "system", msg: `현재 턴: ${turnPlayer.name}` });
      }
    }

    io.to(b.id).emit("battleUpdate", b);
  });

  socket.on("player:ready", ({ battleId, playerId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return;
    p.ready = true;
    b.log.push({ t: now(), type: "system", message: `${p.name} 준비 완료` });

    const allReady = b.players.length > 0 && b.players.every((x) => x.ready);
    if (allReady && b.status === "waiting") {
      // 모든 플레이어 준비되면 자동 시작 + 선공 알림
      b.status = "live";
      b.startedAt = b.startedAt || now();
      const sum = (t) => b.players.filter((pp) => pp.team === t).reduce((a, pp) => a + (pp.stats?.agi || 0), 0);
      const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
      const first = b.players.find((pp) => pp.team === firstTeam) || b.players[0];
      b.turn.current = first?.id || null;
      b.turn.lastChange = now();
      b.log.push({ t: now(), type: "system", message: `모두 준비됨 → 전투 시작 / 선공: ${first?.name || "-"}` });
    }
    io.to(b.id).emit("battleUpdate", b);
  });

  socket.on("player:action", ({ battleId, action }) => {
    const b = battles.get(battleId);
    if (!b) return;
    // 간단 로그만 남김 (정식 룰 엔진은 별도 모듈로)
    b.log.push({ t: now(), type: "action", message: `Action: ${String(action || "-")}` });
    io.to(b.id).emit("battleUpdate", b);
  });

  socket.on("chat:send", ({ battleId, msg }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const safe = String(msg || "").slice(0, 500);
    b.log.push({ t: now(), type: "chat", message: safe });
    io.to(b.id).emit("battle:chat", { name: "플레이어", msg: safe });
    io.to(b.id).emit("battle:log", { type: "chat", msg: `플레이어: ${safe}` });
  });

  /* ---------- 관전자 인증/응원 ---------- */
  socket.on("spectator:join", ({ battleId, otp, name }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("spectator:join_fail", { reason: "전투를 찾을 수 없음" });

    const val = validateOTP(otp);
    if (!val.valid || val.role !== "spectator" || val.data.battleId !== battleId) {
      return socket.emit("spectator:join_fail", { reason: "OTP가 유효하지 않음" });
    }
    consumeOTP(otp);

    socket.join(battleId);
    socket.emit("spectator:join_ok");
    io.to(b.id).emit("battle:log", { type: "system", msg: `관전자 입장: ${name || "관전자"}` });
  });

  socket.on("spectator:cheer", ({ name, msg, battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const who = String(name || "관전자").slice(0, 30);
    const text = String(msg || "").slice(0, 80);
    io.to(b.id).emit("battle:chat", { name: who, msg: text });
    io.to(b.id).emit("battle:log", { type: "cheer", msg: `${who}: ${text}` });
  });
});

/* ----------------------------------------------------------------------------
   시작
---------------------------------------------------------------------------- */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS battle-server listening on ${HOST}:${PORT}`);
});
