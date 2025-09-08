"use strict";

/**
 * PYXIS Battle Server – Unified Entrypoint (정리판)
 * - Express + Socket.IO
 * - 정적 페이지: /admin, /play, /spectator
 * - REST: /api/battles..., /api/admin..., /api/otp..., /api/battles/:id/avatar
 * - 실시간: adminAuth, player/spectator 인증(OTP), 준비완료, 액션, 채팅, 응원
 * - 채팅은 항상 'battle:chat', 로그는 항상 'battle:log' 로 브로드캐스트합니다.
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");
require("dotenv").config();

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
app.use("/uploads", express.static(path.join(PUB_DIR, "uploads"), { maxAge: "7d" }));
app.get("/admin", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "admin.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "player.html")));
app.get("/spectator", (_req, res) => res.sendFile(path.join(PUB_DIR, "pages", "spectator.html")));

/* ----------------------------------------------------------------------------
   유틸 & 상태
---------------------------------------------------------------------------- */
const battles = new Map(); // id -> battle object
const sockets = new Map(); // socket.id -> { battleId, role, playerId, name }
const otps = new Map(); // token -> { role, battleId, createdAt, used: false }

function now() {
  return Date.now();
}
function makeId(n = 10) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0];
  return s;
}
function toAbsBase(req) {
  return (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}
function clamp(n, min, max) {
  const v = Number(n || 0);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function teamKey(v) {
  const s = String(v || "").toLowerCase();
  if (["a", "phoenix", "team1"].includes(s)) return "phoenix"; // 불사조 기사단
  if (["b", "eaters", "team2", "death", "deatheaters"].includes(s)) return "eaters"; // 죽먹자
  return "phoenix";
}

/* ----------------------------------------------------------------------------
   간이 OTP
---------------------------------------------------------------------------- */
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
   배틀 생성 도우미
---------------------------------------------------------------------------- */
function newBattle(mode = "2v2") {
  return {
    id: makeId(10),
    mode,
    status: "waiting",
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    adminToken: makeId(16),
    players: [], // {id,name,team,stats:{atk,def,agi,luk},items:[],avatar,hp,maxHp,ready:false,alive:true}
    turn: { current: null, lastChange: null }, // current: playerId
    log: [], // {t,type,message}
  };
}
function addLog(b, type, msg) {
  b.log.push({ t: now(), type, message: msg });
  io.to(b.id).emit("battle:log", { type, msg });
}
function broadcastBattle(b) {
  io.to(b.id).emit("battleUpdate", b); // 기존 호환
  io.to(b.id).emit("battle:update", b); // 신규
}

/* ----------------------------------------------------------------------------
   REST: Health
---------------------------------------------------------------------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now(), service: "battle-server" }));

/* ----------------------------------------------------------------------------
   REST: Battles
---------------------------------------------------------------------------- */
app.post("/api/battles", (req, res) => {
  const mode = String(req.body?.mode || "2v2");
  const b = newBattle(mode);
  battles.set(b.id, b);
  addLog(b, "system", `Battle created (mode ${mode})`);
  res.json({ id: b.id, token: b.adminToken, battle: b });
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
      atk: clamp(stats?.atk, 0, 5),
      def: clamp(stats?.def, 0, 5),
      agi: clamp(stats?.agi, 0, 5),
      luk: clamp(stats?.luk, 0, 5),
    },
    items: Array.isArray(items) ? items.slice(0, 9) : [],
    avatar: avatar || "",
    hp: 100,
    maxHp: 100,
    ready: false,
    alive: true,
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

/* ----------------------------------------------------------------------------
   REST: Admin ops
---------------------------------------------------------------------------- */
app.post("/api/admin/battles/:id/start", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  if (b.status !== "live") {
    b.status = "live";
    b.startedAt = b.startedAt || now();
  }
  // 선공은 이미 준비완료 시점에 잡혀 있을 수 있음
  if (!b.turn.current && b.players.length) {
    const sum = (t) => b.players.filter((p) => p.team === t).reduce((a, p) => a + (p.stats?.agi || 0), 0);
    const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
    const first = b.players.find((p) => p.team === firstTeam) || b.players[0];
    b.turn.current = first?.id || null;
    b.turn.lastChange = now();
  }
  addLog(b, "system", "Battle started");
  broadcastBattle(b);
  res.json({ ok: true, battle: b });
});

app.post("/api/admin/battles/:id/pause", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "waiting";
  addLog(b, "system", "Battle paused");
  broadcastBattle(b);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/end", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  b.status = "ended";
  b.endedAt = now();
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
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(
    spectatorOtp
  )}`;
  res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl });
});

app.post("/api/admin/battles/:id/otp", (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  const role = String(req.body?.role || "player").toLowerCase();
  if (!["player", "spectator"].includes(role)) return res.status(400).json({ error: "invalid_role" });
  const count = role === "player" ? Math.max(1, Math.min(100, Number(req.body?.count || 1))) : 1;
  const otplist = Array.from({ length: count }, () => genOTP(role, b.id));
  addLog(b, "system", `OTP issued for ${role} x${count}`);
  res.json({ ok: true, role, otps: otplist });
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
   소켓
---------------------------------------------------------------------------- */

/** 다음 턴 플레이어를 간단히 계산 (상대 팀에서 아직 생존인 아무나) */
function pickNextPlayer(b, currentId) {
  if (!b.players.length) return null;
  const cur = b.players.find((p) => p.id === currentId);
  const curTeam = cur ? cur.team : "phoenix";
  const oppTeam = curTeam === "phoenix" ? "eaters" : "phoenix";
  const aliveOpp = b.players.filter((p) => p.team === oppTeam && p.alive && p.hp > 0);
  if (aliveOpp.length) return aliveOpp[0].id;

  // 상대 없으면 같은 팀 순환
  const sameAlive = b.players.filter((p) => p.team === curTeam && p.alive && p.hp > 0);
  if (!sameAlive.length) return null;
  const idx = sameAlive.findIndex((p) => p.id === currentId);
  const next = sameAlive[(idx + 1) % sameAlive.length];
  return next?.id || null;
}

io.on("connection", (socket) => {
  /* ---------------- Admin ---------------- */
  socket.on("adminAuth", ({ battleId, token }) => {
    const b = battles.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit("authError", { error: "unauthorized" });
      return;
    }
    socket.join(battleId);
    sockets.set(socket.id, { battleId, role: "admin", name: "관리자" });
    socket.emit("authSuccess", { ok: true, battle: b });
  });

  socket.on("admin:requestState", ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) {
      socket.emit("battleUpdate", b);
      socket.emit("battle:update", b);
    }
  });

  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const name = role === "admin" ? "관리자" : "시스템";
    addLog(b, "chat", `${name}: ${String(message || "").slice(0, 500)}`);
    io.to(b.id).emit("battle:chat", { name, msg: String(message || "").slice(0, 500) });
    broadcastBattle(b);
  });

  /* ---------------- Player auth & state ---------------- */
  socket.on("player:auth", ({ battleId, otp, name }) => {
    const v = validateOTP(otp);
    if (!v.valid || v.role !== "player" || v.data.battleId !== battleId) {
      socket.emit("auth:fail", { reason: "OTP 불일치" });
      return;
    }
    const b = battles.get(battleId);
    if (!b) return socket.emit("auth:fail", { reason: "배틀 없음" });

    // 이름으로 플레이어 찾기(관리자에서 먼저 등록되어 있어야 함)
    const p = b.players.find((x) => x.name === name);
    if (!p) {
      socket.emit("auth:fail", { reason: "등록되지 않은 이름" });
      return;
    }

    consumeOTP(otp);
    socket.join(battleId);
    sockets.set(socket.id, { battleId, role: "player", playerId: p.id, name: p.name });

    // UI 초기 데이터 내려주기
    const teamMates = b.players.filter((x) => x.team === p.team && x.id !== p.id);
    const enemies = b.players.filter((x) => x.team !== p.team);
    socket.emit("auth:success", { player: p, teamMates, enemies, battle: b });

    addLog(b, "system", `${p.name} 접속`);
    broadcastBattle(b);
  });

  socket.on("player:ready", () => {
    const meta = sockets.get(socket.id);
    if (!meta) return;
    const b = battles.get(meta.battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === meta.playerId);
    if (!p) return;

    p.ready = true;
    addLog(b, "system", `${p.name} 준비 완료`);

    // 모두 준비됐는지 확인
    const allReady = b.players.length > 0 && b.players.every((x) => x.ready);
    if (allReady && b.status !== "live") {
      b.status = "live";
      b.startedAt = b.startedAt || now();
      // 선공: 민첩 합 비교 후 **플레이어 이름**으로 로그
      const sum = (t) => b.players.filter((pp) => pp.team === t).reduce((a, pp) => a + (pp.stats?.agi || 0), 0);
      const firstTeam = sum("phoenix") >= sum("eaters") ? "phoenix" : "eaters";
      const first = b.players.find((pp) => pp.team === firstTeam) || b.players[0];
      b.turn.current = first?.id || null;
      b.turn.lastChange = now();
      addLog(b, "system", `모두 준비됨 → 전투 시작 / 선공: ${first?.name || "-"}`);
    }
    broadcastBattle(b);
  });

  /* ---------------- Player action ---------------- */
  socket.on("player:action", ({ action, targetId }) => {
    const meta = sockets.get(socket.id);
    if (!meta || meta.role !== "player") return;
    const b = battles.get(meta.battleId);
    if (!b) return;
    const p = b.players.find((x) => x.id === meta.playerId);
    if (!p || !p.alive) return;

    if (b.status !== "live") {
      socket.emit("action:fail", { reason: "전투 대기/종료 상태" });
      return;
    }
    if (b.turn.current !== p.id) {
      socket.emit("action:fail", { reason: "당신의 턴이 아닙니다" });
      return;
    }

    const act = String(action || "");
    // 공격/아이템은 타깃 필요
    if (["attack", "item"].includes(act) && !targetId) {
      socket.emit("action:fail", { reason: "대상이 필요합니다" });
      return;
    }
    // 기본 효과 아주 간단히 처리 (데모용)
    if (act === "attack") {
      const tgt = b.players.find((x) => x.id === targetId);
      if (!tgt || !tgt.alive) return socket.emit("action:fail", { reason: "대상을 찾지 못함" });
      const base = 5 + (p.stats?.atk || 0);
      const red = (tgt.stats?.def || 0);
      const dmg = Math.max(1, base - Math.floor(red / 2));
      tgt.hp = Math.max(0, tgt.hp - dmg);
      if (tgt.hp === 0) {
        tgt.alive = false;
        addLog(b, "action", `${p.name} ▶ ${tgt.name} : ${dmg} 피해 (사망)`);
      } else {
        addLog(b, "action", `${p.name} ▶ ${tgt.name} : ${dmg} 피해 (${tgt.hp}/${tgt.maxHp})`);
      }
    } else if (act === "defend") {
      addLog(b, "action", `${p.name} 방어 태세`);
    } else if (act === "dodge") {
      addLog(b, "action", `${p.name} 회피 태세`);
    } else if (act === "pass") {
      addLog(b, "action", `${p.name} 턴 패스`);
    } else if (act === "item") {
      const tgt = b.players.find((x) => x.id === targetId);
      if (!tgt) return socket.emit("action:fail", { reason: "대상을 찾지 못함" });
      const heal = 10;
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
      addLog(b, "action", `${p.name} ▶ ${tgt.name} : 아이템 사용, HP +${heal} (${tgt.hp}/${tgt.maxHp})`);
    } else {
      return socket.emit("action:fail", { reason: "알 수 없는 액션" });
    }

    // 턴 넘기기
    const nextId = pickNextPlayer(b, p.id);
    b.turn.current = nextId;
    b.turn.lastChange = now();
    if (nextId) {
      const nextP = b.players.find((x) => x.id === nextId);
      addLog(b, "system", `턴 전환 → ${nextP?.name || "-"}`);
    } else {
      addLog(b, "system", "턴 전환 실패(다음 플레이어 없음)");
    }

    broadcastBattle(b);
    socket.emit("action:ok", { ok: true });
  });

  /* ---------------- Chat (player/admin 공통) ---------------- */
  socket.on("chat:send", ({ battleId, msg }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const meta = sockets.get(socket.id) || {};
    const name = meta?.name || (meta?.role === "admin" ? "관리자" : "익명");
    const text = String(msg || "").slice(0, 500);
    addLog(b, "chat", `${name}: ${text}`);
    io.to(b.id).emit("battle:chat", { name, msg: text });
    broadcastBattle(b);
  });

  /* ---------------- Spectator ---------------- */
  socket.on("spectator:join", ({ battleId, otp, name }) => {
    const v = validateOTP(otp);
    if (!v.valid || v.role !== "spectator" || v.data.battleId !== battleId) {
      socket.emit("spectator:join_fail", { reason: "OTP 불일치" });
      return;
    }
    const b = battles.get(battleId);
    if (!b) return socket.emit("spectator:join_fail", { reason: "배틀 없음" });

    consumeOTP(otp);
    socket.join(battleId);
    sockets.set(socket.id, { battleId, role: "spectator", name: String(name || "관전자") });

    socket.emit("spectator:join_ok", { battle: b });
    addLog(b, "system", `${name || "관전자"} 관전 입장`);
    broadcastBattle(b);
  });

  socket.on("spectator:cheer", ({ name, msg }) => {
    const meta = sockets.get(socket.id);
    if (!meta || meta.role !== "spectator") return;
    const b = battles.get(meta.battleId);
    if (!b) return;
    const text = String(msg || "").slice(0, 120);
    // 응원은 채팅/로그 둘 다 보냄(관전자 채팅창 + 전투 로그 하이라이트)
    io.to(b.id).emit("battle:chat", { name: String(name || "관전자"), msg: text });
    addLog(b, "cheer", `${String(name || "관전자")}: ${text}`);
    broadcastBattle(b);
  });

  /* ---------------- Disconnect ---------------- */
  socket.on("disconnect", () => {
    const meta = sockets.get(socket.id);
    if (!meta) return;
    const b = battles.get(meta.battleId);
    if (b && meta.role === "player" && meta.playerId) {
      const p = b.players.find((x) => x.id === meta.playerId);
      if (p) addLog(b, "system", `${p.name} 접속 종료`);
      broadcastBattle(b);
    }
    sockets.delete(socket.id);
  });
});

/* ----------------------------------------------------------------------------
   시작
---------------------------------------------------------------------------- */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS battle-server listening on ${HOST}:${PORT}`);
});
