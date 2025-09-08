"use strict";

/**
 * PYXIS Battle Server – Unified Entrypoint (Express + Socket.IO)
 * - Admin/Player/Spectator OTP 인증 및 입장/응원/채팅/행동/턴 브로드캐스트
 * - 채팅과 로그 채널 분리(battle:chat / battle:log) + 구버전 호환(chat:msg / log:add)
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
const io = new Server(server, { cors: { origin: CORS_ORIGIN, methods: ["GET","POST","DELETE"] } });

app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ----------------------------------------------------------------------------
   정적 경로
---------------------------------------------------------------------------- */
const PUB_DIR = path.join(__dirname, "public");
app.use(express.static(PUB_DIR, { index: false }));
app.use("/uploads", express.static(path.join(PUB_DIR, "uploads"), { maxAge: "7d" }));

// 페이지 단축 라우트
app.get("/admin", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "admin.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "player.html")));
app.get("/spectator", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "spectator.html")));
app.get("/", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "admin.html")));

// 헬스체크
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now(), service: "battle-server" }));

/* ----------------------------------------------------------------------------
   간단한 상태 메모리
---------------------------------------------------------------------------- */
const battles = new Map(); // id -> battle

const now = () => Date.now();
const makeId = (n = 10) => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0];
  return s;
};
const teamKey = (v) => {
  const s = String(v || "").toLowerCase();
  if (["a","phoenix","team1"].includes(s)) return "phoenix";
  if (["b","eaters","team2","death","deatheaters"].includes(s)) return "eaters";
  return "phoenix";
};
const toAbsBase = (req) => (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`.replace(/\/+$/, ""));

// 이름 → 플레이어 찾기
const findPlayerByName = (b, name) => {
  const n = String(name || "").trim().toLowerCase();
  return b.players.find(p => (p.name||"").toLowerCase() === n);
};
// id → 플레이어
const playerById = (b, id) => b.players.find(p => p.id === id);
// id → 이름
const playerName = (b, id) => playerById(b, id)?.name || "-";

/* ----------------------------------------------------------------------------
   OTP(간이)
   - spectator: 기본적으로 다회 사용을 허용(소모하지 않음)
   - player   : 1회성(consume)
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
    players: [],      // [{id,name,team,stats:{atk,def,agi,luk}, items:[], avatar, hp,maxHp, ready,_claimed}]
    turn: { current: null, lastChange: null, currentName: null },
    log: [],          // [{t,type,message}]
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
      atk: Math.max(0, Math.min(5, Number(stats?.atk ?? 0))),
      def: Math.max(0, Math.min(5, Number(stats?.def ?? 0))),
      agi: Math.max(0, Math.min(5, Number(stats?.agi ?? 0))),
      luk: Math.max(0, Math.min(5, Number(stats?.luk ?? 0))),
    },
    items: Array.isArray(items) ? items.slice(0, 9) : [],
    avatar: avatar || "",
    hp: 100, maxHp: 100,
    ready: false,
    _claimed: false,
  };
  b.players.push(p);
  b.log.push({ t: now(), type: "system", message: `Player added: ${p.name} [${p.team}]` });
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
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  startBattle(b);
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
  const adminUrl = `${base}/admin?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.adminToken)}`;
  const playerUrl = `${base}/play?battle=${encodeURIComponent(b.id)}&token={playerOtp}`;
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(spectatorOtp)}`;
  res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl });
});

/* ----------------------------------------------------------------------------
   OTP REST
---------------------------------------------------------------------------- */
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
   내부 유틸: 배틀 시작/선공/턴
---------------------------------------------------------------------------- */
function pickFirstTurn(b){
  if (!b.players.length) { b.turn.current = null; b.turn.currentName = null; return; }
  // 팀 민첩 합 비교 → 이긴 팀 중 민첩 최상위 1명
  const sumAgi = (team) => b.players.filter(p=>p.team===team).reduce((a,p)=>a+(p.stats?.agi||0),0);
  const firstTeam = sumAgi("phoenix") >= sumAgi("eaters") ? "phoenix" : "eaters";
  const first = b.players
    .filter(p => p.team === firstTeam)
    .sort((x,y) => (y.stats?.agi||0) - (x.stats?.agi||0))[0] || b.players[0];
  b.turn.current = first.id;
  b.turn.currentName = first.name;
  b.turn.lastChange = now();
}
function nextTurn(b){
  if(!b.players.length) { b.turn.current = null; b.turn.currentName = null; return; }
  const order = b.players.map(p=>p.id);
  const idx = Math.max(0, order.indexOf(b.turn.current));
  const nextId = order[(idx + 1) % order.length];
  b.turn.current = nextId;
  b.turn.currentName = playerName(b, nextId);
  b.turn.lastChange = now();
}
function startBattle(b){
  b.status = "live";
  b.startedAt = b.startedAt || now();
  if(!b.turn.current) pickFirstTurn(b);
  b.log.push({ t: now(), type: "system", message: `Battle started (first: ${b.turn.currentName||"-"})` });
  io.to(b.id).emit("battleUpdate", b);
  // 선공 알림(이름)
  io.to(b.id).emit("turn:first", { playerId: b.turn.current, name: b.turn.currentName });
  io.to(b.id).emit("battle:log", { type: "system", msg: `선공: ${b.turn.currentName}` });
  io.to(b.id).emit("log:add", { type: "system", msg: `선공: ${b.turn.currentName}` }); // 구버전 호환
}

/* ----------------------------------------------------------------------------
   Socket.IO
---------------------------------------------------------------------------- */
io.on("connection", (socket) => {
  let scope = { role: null, battleId: null, playerId: null, name: null };

  const safeBattle = () => (scope.battleId ? battles.get(scope.battleId) : null);

  // ----- 관리자 인증 -----
  socket.on("adminAuth", ({ battleId, token }) => {
    const b = battles.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit("authError", { error: "unauthorized" });
      return;
    }
    scope = { role: "admin", battleId, playerId: null, name: "관리자" };
    socket.join(battleId);
    socket.emit("authSuccess", { ok: true, battle: b });
  });

  socket.on("admin:requestState", ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) socket.emit("battleUpdate", b);
  });

  socket.on("battle:start", ({ battleId }, ack) => {
    const b = battles.get(battleId);
    if (!b) return typeof ack === "function" && ack({ success: false });
    startBattle(b);
    typeof ack === "function" && ack({ success: true });
  });

  // ----- 관전자 입장/응원 -----
  socket.on("spectator:join", ({ battleId, otp, name }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("spectator:join_fail", { reason: "battle_not_found" });

    const v = validateOTP(otp);
    if (!v.valid || v.role !== "spectator" || v.data?.battleId !== battleId) {
      return socket.emit("spectator:join_fail", { reason: "invalid_token" });
    }
    // spectator OTP는 기본적으로 consume하지 않음(다회 사용)
    scope = { role: "spectator", battleId, playerId: null, name: String(name||"관객") };
    socket.join(battleId);

    // 현재 턴 이름 계산
    const currentPlayerName = b.turn?.current ? playerName(b, b.turn.current) : null;

    socket.emit("spectator:join_ok", {
      roster: b.players,
      battle: { id: b.id, status: b.status, turn: { ...b.turn, currentName: currentPlayerName } },
      currentPlayerName
    });

    // 입장 알림(로그/채팅 분리)
    io.to(b.id).emit("battle:log", { type: "system", msg: `관전자 입장: ${scope.name}` });
    io.to(b.id).emit("log:add", { type: "system", msg: `관전자 입장: ${scope.name}` });
  });

  socket.on("spectator:cheer", ({ msg }) => {
    const b = safeBattle();
    if (!b || scope.role !== "spectator") return;
    const text = String(msg || "").slice(0, 200);
    // 채팅 채널
    io.to(b.id).emit("battle:chat", { name: scope.name, msg: text });
    // 로그 채널
    io.to(b.id).emit("battle:log", { type: "cheer", msg: `${scope.name}: ${text}` });
    io.to(b.id).emit("log:add", { type: "cheer", msg: `${scope.name}: ${text}` });
  });

  // ----- 플레이어 인증/준비/행동/채팅 -----
  socket.on("player:auth", ({ battleId, otp, name }) => {
    const b = battles.get(battleId);
    if (!b) return socket.emit("auth:fail", { reason: "battle_not_found" });

    const v = validateOTP(otp);
    if (!v.valid || v.role !== "player" || v.data?.battleId !== battleId) {
      return socket.emit("auth:fail", { reason: "invalid_token" });
    }
    // 플레이어 OTP는 1회성
    consumeOTP(otp);

    // 이름으로 기존 로스터 바인딩(없으면 자동 생성)
    let me = name ? findPlayerByName(b, name) : null;
    if (!me) {
      me = {
        id: makeId(12),
        name: String(name || "Player"),
        team: (b.players.filter(p=>p.team==='phoenix').length <= b.players.filter(p=>p.team==='eaters').length) ? 'phoenix':'eaters',
        stats: { atk:0, def:0, agi:0, luk:0 },
        items: [],
        avatar: "",
        hp: 100, maxHp: 100,
        ready: false, _claimed: false
      };
      b.players.push(me);
      b.log.push({ t: now(), type: "system", message: `Player auto-added: ${me.name} [${me.team}]` });
    }
    me._claimed = true;

    scope = { role:"player", battleId, playerId: me.id, name: me.name };
    socket.join(battleId);

    // 팀 분리(프런트용)
    const allies = b.players.filter(p=>p.team===me.team);
    const enemies = b.players.filter(p=>p.team!==me.team);

    socket.emit("auth:success", {
      player: me,
      teamMates: allies,
      enemies,
      battle: { id: b.id, status: b.status, turn: b.turn }
    });

    // 알림
    io.to(b.id).emit("battle:log", { type:"system", msg:`플레이어 입장: ${me.name} [${me.team}]` });
    io.to(b.id).emit("log:add", { type:"system", msg:`플레이어 입장: ${me.name} [${me.team}]` });
    io.to(b.id).emit("battleUpdate", b);
  });

  socket.on("player:ready", ({ ready }) => {
    const b = safeBattle();
    if (!b || scope.role !== "player") return;
    const me = playerById(b, scope.playerId);
    if (!me) return;
    me.ready = !!ready;

    // 모두 준비 → 자동 시작
    if (b.status === "waiting" && b.players.length && b.players.every(p => p.ready)) {
      startBattle(b);
    } else {
      io.to(b.id).emit("battleUpdate", b);
    }
  });

  socket.on("player:action", ({ action }, ack) => {
    const b = safeBattle();
    if (!b || scope.role !== "player") return typeof ack === "function" && ack({ success:false, reason:"forbidden" });

    // 자기 턴인지 체크
    if (b.turn.current !== scope.playerId) {
      return typeof ack === "function" && ack({ success:false, reason:"not_your_turn" });
    }

    const me = playerById(b, scope.playerId);
    const act = String(action||"").toLowerCase();
    // 간단 처리: 로그만 남기고 턴 넘기기(전투 룰 확장 가능)
    io.to(b.id).emit("battle:log", { type:"event", msg:`${me.name} → ${act}` });
    io.to(b.id).emit("log:add", { type:"event", msg:`${me.name} → ${act}` });

    // 턴 로테이션
    nextTurn(b);
    io.to(b.id).emit("turn:change", { playerId: b.turn.current, name: b.turn.currentName });
    io.to(b.id).emit("battleUpdate", b);

    typeof ack === "function" && ack({ success:true });
  });

  // 채팅(플레이어/관리자 공통) - 프런트 호환 이벤트 모두 발행
  socket.on("chat:send", ({ msg }) => {
    const b = safeBattle();
    if (!b) return;
    const who = scope.name || (scope.role || "사용자");
    const text = String(msg || "").slice(0, 500);
    io.to(b.id).emit("battle:chat", { name: who, msg: text });
    io.to(b.id).emit("chat:msg",   { name: who, msg: text }); // 구버전 호환
    // 로그에도 남기고 싶다면 아래 라인 유지
    io.to(b.id).emit("battle:log", { type: "chat", msg: `${who}: ${text}` });
    io.to(b.id).emit("log:add",    { type: "chat", msg: `${who}: ${text}` });
  });

  // 기존 관리자 채팅 이벤트(호환)
  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const sender = role === "admin" ? "관리자" : "플레이어";
    const msg = String(message || "").slice(0, 500);
    io.to(b.id).emit("battle:chat", { name: sender, msg });
    io.to(b.id).emit("chat:msg",   { name: sender, msg });
    io.to(b.id).emit("battle:log", { type: "chat", msg: `${sender}: ${msg}` });
    io.to(b.id).emit("log:add",    { type: "chat", msg: `${sender}: ${msg}` });
  });

  socket.on("disconnect", () => {
    // 필요 시 퇴장 처리/프레즌스 추가 가능
  });
});

/* ----------------------------------------------------------------------------
   시작
---------------------------------------------------------------------------- */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS battle-server listening on ${HOST}:${PORT}`);
});
