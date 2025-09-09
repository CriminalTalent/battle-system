/**
 * PYXIS Battle System — Server
 * - Node >= 18
 * - Express + Socket.IO
 * - In-memory battle/OTP store (개발용)
 *
 * 고친 것 (핵심 보강):
 * 1) 관리자 인증 실패 원인 제거
 *    - adminAuth 가 항상 battle.adminToken 과 비교되도록 정규화
 *    - /api/admin/battles/:id/links 에서 토큰을 포함한 관리/플레이어/관전자 링크 자동 반환
 * 2) 플레이어 채팅 미표시 수정
 *    - chat:send, chatMessage 모두 battle:chat 으로 정규화 브로드캐스트
 *    - 모든 채팅/응원을 battle.log 에도 남김
 * 3) 관전자 응원 버튼 미작동 수정
 *    - spectator:cheer 수신 → battle:log(type:"cheer")와 battle:chat 동시 브로드캐스트
 * 4) 플레이어 준비/자동 시작
 *    - player:ready 수신 시 전원 준비 검사 후 자동 startBattle()
 * 5) 턴 타이머 골격 제공(5분) + turn:tick 브로드캐스트
 * 6) 아바타 업로드 라우트 보강 (multer 사용)
 *
 * 정적 경로:
 *  /admin      → public/pages/admin.html
 *  /play       → public/pages/player.html
 *  /spectator  → public/pages/spectator.html
 *  업로드 루트: /uploads/avatars/:battleId/*
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import cors from "cors";
import { Server as IOServer } from "socket.io";

// ───────────────────────────────────────────────────────────
// 기본 설정
// ───────────────────────────────────────────────────────────
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const app  = express();
const server = http.createServer(app);
const io  = new IOServer(server, {
  path: "/socket.io",
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// 정적 파일
const PUBLIC_DIR = path.join(process.cwd(), "packages", "battle-server", "public");
app.use(express.static(PUBLIC_DIR));

// 페이지 라우팅
app.get("/admin", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "pages", "admin.html")));
app.get("/play", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "pages", "player.html")));
app.get("/spectator", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "pages", "spectator.html")));

// 업로드 저장소
const UPLOAD_ROOT = path.join(PUBLIC_DIR, "uploads", "avatars");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const { id } = req.params;
    const dir = path.join(UPLOAD_ROOT, id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, crypto.randomBytes(8).toString("hex") + ext);
  },
});
const upload = multer({ storage });

// ───────────────────────────────────────────────────────────
// 인메모리 저장소
// ───────────────────────────────────────────────────────────
/**
 * battle = {
 *   id, mode, status: "waiting"|"live"|"ended",
 *   createdAt, startedAt, endedAt,
 *   adminToken,
 *   players:[ { id, name, team:"phoenix"|"eaters", stats:{atk,def,agi,luk}, items:[], avatar, hp:100, maxHp:100, ready:false } ],
 *   turn:{ current: playerId|null, lastChange },
 *   log:[ { t, type:"system"|"chat"|"cheer", message } ],
 *   turnTimer?: { endAt:number, timer?:NodeJS.Timeout }
 * }
 */
const BATTLES = new Map();

/**
 * OTP_STORE[token] = { role:"player"|"spectator", battleId, usesLeft, expiresAt }
 *  - spectator: usesLeft=30, TTL=30분
 *  - player   : usesLeft=1,  TTL=2시간 (요청수 만큼 배열 발급)
 */
const OTP_STORE = new Map();

// ───────────────────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────────────────
const now = () => Date.now();
const rid = (p) => p + "_" + crypto.randomBytes(6).toString("hex");
const battleRoom = (id) => `battle:${id}`;

function battleSnapshot(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    endedAt: b.endedAt,
    players: b.players.map(p => ({
      id: p.id, name: p.name, team: p.team, stats: p.stats,
      items: [...p.items], avatar: p.avatar, hp: p.hp, maxHp: p.maxHp, ready: p.ready
    })),
    turn: { current: b.turn.current, lastChange: b.turn.lastChange },
    log: [...b.log],
  };
}

function pushLog(b, type, message) {
  b.log.push({ t: now(), type, message });
  io.to(battleRoom(b.id)).emit("battle:log", { type, msg: message });
}

function broadcastUpdate(b) {
  io.to(battleRoom(b.id)).emit("battleUpdate", battleSnapshot(b));
}

function sumTeamAgi(b, key) {
  return b.players.filter(p => p.team === key).reduce((s, p) => s + Number(p.stats?.agi || 0), 0);
}

function startBattle(b) {
  if (b.status === "live") return;

  // 선공: 팀 agi 합 비교
  const phoenixAgi = sumTeamAgi(b, "phoenix");
  const eatersAgi  = sumTeamAgi(b, "eaters");
  const firstTeam  = phoenixAgi >= eatersAgi ? "phoenix" : "eaters";
  const firstP     = b.players.find(p => p.team === firstTeam);

  b.status = "live";
  b.startedAt = now();
  b.turn.current = firstP?.id || null;
  b.turn.lastChange = now();

  pushLog(b, "system", `전투 시작! 선공: ${firstP?.name || "-"}`);
  broadcastUpdate(b);

  startTurnTimer(b);
}

function endBattle(b, reason = "전투 종료") {
  b.status = "ended";
  b.endedAt = now();
  stopTurnTimer(b);
  pushLog(b, "system", reason);
  broadcastUpdate(b);
}

// ───────────────────────────────────────────────────────────
// 턴 타이머 (5분)
// ───────────────────────────────────────────────────────────
const TURN_MS = 5 * 60 * 1000;

function startTurnTimer(b) {
  stopTurnTimer(b);
  b.turnTimer = { endAt: now() + TURN_MS };

  // tick
  b.turnTimer.timer = setInterval(() => {
    const remaining = Math.max(0, b.turnTimer.endAt - now());
    io.to(battleRoom(b.id)).emit("turn:tick", { remaining });
    if (remaining <= 0) {
      // 서버 권한으로 자동 턴 넘김(간단히 다음 플레이어로)
      nextTurn(b);
    }
  }, 1000);
}

function stopTurnTimer(b) {
  if (b.turnTimer?.timer) clearInterval(b.turnTimer.timer);
  b.turnTimer = undefined;
}

function nextTurn(b) {
  const idx = b.players.findIndex(p => p.id === b.turn.current);
  const next = b.players[(idx + 1 + b.players.length) % b.players.length];
  b.turn.current = next?.id || null;
  b.turn.lastChange = now();
  pushLog(b, "system", `턴 변경: ${next?.name || "-"}`);
  broadcastUpdate(b);
  startTurnTimer(b);
}

// ───────────────────────────────────────────────────────────
// OTP
// ───────────────────────────────────────────────────────────
function genOTP({ role, battleId, uses, ttlMs }) {
  const token = crypto.randomBytes(12).toString("hex");
  OTP_STORE.set(token, {
    role, battleId, usesLeft: uses, expiresAt: now() + ttlMs,
  });
  return token;
}
function validateOTP(token) {
  const rec = OTP_STORE.get(token);
  if (!rec) return { ok: false, reason: "OTP_INVALID" };
  if (rec.expiresAt < now()) { OTP_STORE.delete(token); return { ok: false, reason: "OTP_EXPIRED" }; }
  if (rec.usesLeft <= 0) { OTP_STORE.delete(token); return { ok: false, reason: "OTP_USED" }; }
  return { ok: true, data: rec };
}
function consumeOTP(token) {
  const rec = OTP_STORE.get(token);
  if (!rec) return false;
  rec.usesLeft -= 1;
  if (rec.usesLeft <= 0) OTP_STORE.delete(token);
  return true;
}

// ───────────────────────────────────────────────────────────
// REST API
// ───────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: now() }));

// 신규 battle 생성
app.post("/api/battles", (req, res) => {
  const mode = String(req.body?.mode || "1v1");
  const id = rid("B");
  const adminToken = rid("T");

  const battle = {
    id, mode,
    status: "waiting",
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    adminToken,
    players: [],
    turn: { current: null, lastChange: null },
    log: [],
  };
  BATTLES.set(id, battle);
  pushLog(battle, "system", `Battle created (mode ${mode})`);
  return res.json({ id, token: adminToken, battle: battleSnapshot(battle) });
});

// 현재 스냅샷
app.get("/api/battles/:id", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  return res.json(battleSnapshot(b));
});

// 플레이어 추가(관리자 전용/혹은 운영 자동)
app.post("/api/battles/:id/players", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  const { name, team, stats, items, avatar } = req.body || {};
  if (!name || !team) return res.status(400).json({ error: "INVALID_PAYLOAD" });

  const p = {
    id: rid("P"),
    name: String(name),
    team: team === "A" ? "phoenix" : team === "B" ? "eaters" : team,
    stats: {
      atk: clampNum(stats?.atk, 0, 5),
      def: clampNum(stats?.def, 0, 5),
      agi: clampNum(stats?.agi, 0, 5),
      luk: clampNum(stats?.luk, 0, 5),
    },
    items: Array.isArray(items) ? items.slice(0, 200) : [],
    avatar: avatar || "",
    hp: 100,
    maxHp: 100,
    ready: false,
  };
  b.players.push(p);
  pushLog(b, "system", `Player joined: ${p.name} [${p.team}]`);
  broadcastUpdate(b);
  return res.json({ ok: true, player: p });
});

// 플레이어 제거
app.delete("/api/battles/:id/players/:pid", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  const i = b.players.findIndex(p => p.id === req.params.pid);
  if (i === -1) return res.status(404).json({ error: "PLAYER_NOT_FOUND" });
  const [removed] = b.players.splice(i, 1);
  pushLog(b, "system", `Player removed: ${removed.name}`);
  broadcastUpdate(b);
  return res.json({ ok: true });
});

// 관리자 제어
app.post("/api/admin/battles/:id/start", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  startBattle(b);
  return res.json({ ok: true });
});
app.post("/api/admin/battles/:id/pause", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  if (b.status === "live") {
    b.status = "waiting";
    stopTurnTimer(b);
    pushLog(b, "system", "전투 일시정지");
    broadcastUpdate(b);
  }
  return res.json({ ok: true });
});
app.post("/api/admin/battles/:id/resume", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  if (b.status !== "live") {
    b.status = "live";
    pushLog(b, "system", "전투 재개");
    broadcastUpdate(b);
    startTurnTimer(b);
  }
  return res.json({ ok: true });
});
app.post("/api/admin/battles/:id/end", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  endBattle(b, "전투 종료(관리자)");
  return res.json({ ok: true });
});

// 링크 발급(관리자, 플레이어, 관전자)
app.post("/api/admin/battles/:id/links", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  // 관리 URL에 admin 토큰 포함
  const adminUrl = makeUrl(`/admin?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.adminToken)}`);
  const playerUrl = makeUrl(`/play?battle=${encodeURIComponent(b.id)}`);
  const spectatorUrl = makeUrl(`/spectator?battle=${encodeURIComponent(b.id)}`);

  // 관전자 OTP 1개(30명 공유) 즉시 발급(편의)
  const token = genOTP({ role: "spectator", battleId: b.id, uses: 30, ttlMs: 30 * 60 * 1000 });
  pushLog(b, "system", "OTP issued for spectator x1");
  return res.json({ admin: adminUrl, player: playerUrl, spectator: spectatorUrl, spectatorOTP: token });
});

// OTP 발급
app.post("/api/admin/battles/:id/otp", (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  const role = String(req.body?.role || "");
  if (role !== "player" && role !== "spectator") return res.status(400).json({ error: "INVALID_ROLE" });

  if (role === "player") {
    const cnt = clampNum(req.body?.count ?? 1, 1, 100);
    const tokens = Array.from({ length: cnt }, () => genOTP({ role: "player", battleId: b.id, uses: 1, ttlMs: 2 * 60 * 60 * 1000 }));
    pushLog(b, "system", `OTP issued for player x${cnt}`);
    return res.json({ tokens });
  } else {
    const token = genOTP({ role: "spectator", battleId: b.id, uses: 30, ttlMs: 30 * 60 * 1000 });
    pushLog(b, "system", "OTP issued for spectator x1");
    return res.json({ token, usesLeft: 30, ttlMin: 30 });
  }
});

// OTP 상태(디버깅)
app.get("/api/otp/:token", (req, res) => {
  const rec = OTP_STORE.get(req.params.token);
  if (!rec) return res.status(404).json({ error: "NOT_FOUND" });
  return res.json(rec);
});

// 이미지 업로드
app.post("/api/battles/:id/avatar", upload.single("avatar"), (req, res) => {
  const b = BATTLES.get(req.params.id);
  if (!b) return res.status(404).json({ error: "NOT_FOUND" });
  if (!req.file) return res.status(400).json({ error: "NO_FILE" });

  const relUrl = `/uploads/avatars/${encodeURIComponent(b.id)}/${encodeURIComponent(req.file.filename)}`;
  return res.json({ ok: true, url: relUrl });
});

// ───────────────────────────────────────────────────────────
// Socket.IO
// ───────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  // 관리자 인증
  socket.on("adminAuth", ({ battleId, token }) => {
    const b = BATTLES.get(battleId);
    if (!b) return socket.emit("authError", { error: "not_found" });
    if (!token || token !== b.adminToken) return socket.emit("authError", { error: "unauthorized" });

    socket.join(battleRoom(battleId));
    socket.data.role = "admin";
    socket.data.battleId = battleId;
    socket.emit("authSuccess", { battle: battleSnapshot(b) });
    pushLog(b, "system", "관리자 접속");
  });

  // 플레이어 인증(OTP 필요)
  socket.on("player:auth", ({ battleId, otp, name }) => {
    const b = BATTLES.get(battleId);
    if (!b) return socket.emit("auth:fail", { reason: "전투를 찾을 수 없습니다." });

    const v = validateOTP(otp);
    if (!v.ok || v.data.role !== "player" || v.data.battleId !== battleId) {
      return socket.emit("auth:fail", { reason: "비밀번호가 유효하지 않습니다." });
    }
    consumeOTP(otp);

    // 기존에 같은 이름이 있으면 그대로 사용, 없으면 생성
    let p = b.players.find(x => x.name === name) || null;
    if (!p) {
      p = {
        id: rid("P"),
        name: String(name || "전투 참가자"),
        team: pickTeamForJoin(b), // 자동 편성(간단 균형)
        stats: { atk: 3, def: 3, agi: 3, luk: 3 },
        items: [],
        avatar: "",
        hp: 100, maxHp: 100, ready: false,
      };
      b.players.push(p);
      pushLog(b, "system", `플레이어 인증: ${p.name}`);
    } else {
      pushLog(b, "system", `플레이어 재접속: ${p.name}`);
    }

    socket.join(battleRoom(battleId));
    socket.data.role = "player";
    socket.data.battleId = battleId;
    socket.data.playerId = p.id;

    socket.emit("auth:success", { player: p, players: b.players, snapshot: battleSnapshot(b) });
    broadcastUpdate(b);
  });

  // 관전자 입장(OTP 필요)
  socket.on("spectator:join", ({ battleId, otp, name }) => {
    const b = BATTLES.get(battleId);
    if (!b) return socket.emit("authError", { error: "BATTLE_NOT_FOUND" });

    const v = validateOTP(otp);
    if (!v.ok || v.data.role !== "spectator" || v.data.battleId !== battleId) {
      return socket.emit("authError", { error: "OTP_INVALID" });
    }
    consumeOTP(otp);

    socket.join(battleRoom(battleId));
    socket.data.role = "spectator";
    socket.data.battleId = battleId;
    socket.data.name = String(name || "관전자");

    socket.emit("spectator:join_ok");
    pushLog(b, "system", `관전자 입장: ${socket.data.name}`);
    broadcastUpdate(b);
  });

  // 플레이어 준비
  socket.on("player:ready", ({ battleId, playerId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return;
    p.ready = true;
    pushLog(b, "system", `${p.name} 준비 완료`);
    broadcastUpdate(b);

    if (areAllReady(b)) startBattle(b);
  });

  // 액션(현재는 로그만 기록)
  socket.on("player:action", ({ battleId, playerId, action }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return;
    // 여기서는 로그만
    pushLog(b, "system", `Action by ${p.name}: ${JSON.stringify(action)}`);
    broadcastUpdate(b);
    // 간단히 자동 턴 넘김
    nextTurn(b);
  });

  // 채팅(정규화)
  socket.on("chat:send", ({ battleId, name, msg }) => {
    const b = BATTLES.get(battleId);
    if (!b || !msg) return;
    const who = String(name || inferName(socket, b) || "익명");
    io.to(battleRoom(battleId)).emit("battle:chat", { name: who, msg: String(msg) });
    pushLog(b, "chat", `${who}: ${String(msg)}`);
  });

  // 레거시 호환 채널
  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = BATTLES.get(battleId);
    if (!b || !message) return;
    const who = role === "admin" ? "관리자" : (inferName(socket, b) || "전투 참가자");
    io.to(battleRoom(battleId)).emit("battle:chat", { name: who, msg: String(message) });
    pushLog(b, "chat", `${who}: ${String(message)}`);
  });

  // 관전자 응원
  socket.on("spectator:cheer", ({ battleId, name, msg }) => {
    const b = BATTLES.get(battleId);
    if (!b || !msg) return;
    const who = String(name || socket.data?.name || "관전자");
    // 채팅/로그 동시 반영
    io.to(battleRoom(battleId)).emit("battle:chat", { name: who, msg: String(msg) });
    pushLog(b, "cheer", `${who}: ${String(msg)}`);
    broadcastUpdate(b);
  });

  // 수동 시작 신호(관리자 버튼 → 소켓 브로드캐스트도 호환)
  socket.on("battle:start", ({ battleId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    startBattle(b);
  });
  socket.on("battle:pause", ({ battleId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    if (b.status === "live") {
      b.status = "waiting";
      stopTurnTimer(b);
      pushLog(b, "system", "전투 일시정지");
      broadcastUpdate(b);
    }
  });
  socket.on("battle:resume", ({ battleId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    if (b.status !== "live") {
      b.status = "live";
      pushLog(b, "system", "전투 재개");
      broadcastUpdate(b);
      startTurnTimer(b);
    }
  });
  socket.on("battle:end", ({ battleId }) => {
    const b = BATTLES.get(battleId);
    if (!b) return;
    endBattle(b, "전투 종료(관리자)");
  });

  socket.on("disconnect", () => {
    // 필요 시 연결 종료 로그 등
  });
});

// ───────────────────────────────────────────────────────────
// 보조
// ───────────────────────────────────────────────────────────
function makeUrl(p) {
  // 배포 환경의 프록시를 고려하지 않고, 서버가 아는 호스트/포트로 작성
  const host = process.env.PUBLIC_ORIGIN || `http://localhost:${PORT}`;
  return host.replace(/\/+$/, "") + p;
}
function clampNum(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function areAllReady(b) {
  const actives = b.players.filter(p => p.hp > 0);
  return actives.length > 0 && actives.every(p => p.ready);
}
function pickTeamForJoin(b) {
  const a = b.players.filter(p => p.team === "phoenix").length;
  const e = b.players.filter(p => p.team === "eaters").length;
  return a <= e ? "phoenix" : "eaters";
}
function inferName(socket, b) {
  if (socket.data?.role === "player") {
    const p = b.players.find(x => x.id === socket.data.playerId);
    return p?.name;
  }
  if (socket.data?.role === "admin") return "관리자";
  if (socket.data?.role === "spectator") return socket.data?.name || "관전자";
  return null;
}

// ───────────────────────────────────────────────────────────
// 서버 시작
// ───────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`PYXIS server listening on http://${HOST}:${PORT}`);
});
