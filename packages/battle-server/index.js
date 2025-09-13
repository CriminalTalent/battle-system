// packages/battle-server/index.js
// PYXIS Battle Server (정적 라우트 / 자동 로그인 / 관리자용 링크 생성 포함)
// - 팀 표기 A/B 정규화
// - 아이템 키 canonical: dittany / attack_boost / defense_boost
// - 신/구 소켓 이벤트 호환(battleUpdate & battle:update, chatMessage & battle:chat 등)

import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io";

/* ------------------------------ App/IO Setup ------------------------------ */
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

/* ------------------------------ In-Memory DB ------------------------------ */
const battles = new Map();  // battleId -> battle snapshot
const otpStore = new Map(); // key -> { otp, role, battleId, ... }

/* -------------------------------- Helpers -------------------------------- */
const genId = () => "battle_" + Math.random().toString(36).slice(2, 10);
function genOTP(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function toAB(t) {
  const s = String(t || "").toLowerCase();
  if (s === "phoenix" || s === "a" || s === "team_a" || s === "team-a") return "A";
  if (s === "eaters"  || s === "b" || s === "death"  || s === "team_b" || s === "team-b") return "B";
  return "A";
}

function normalizeStats(s = {}) {
  const cv = (v, d) => clamp(Number.isFinite(+v) ? Math.floor(+v) : d, 1, 5);
  return {
    attack:  cv(s.attack  ?? s.atk, 3),
    defense: cv(s.defense ?? s.def, 3),
    agility: cv(s.agility ?? s.dex ?? s.agi, 3),
    luck:    cv(s.luck    ?? s.luk, 2),
  };
}

function normalizeItems(items = {}) {
  // 입력은 ditany/dittany, attackBooster/attack_boost, defenseBooster/defense_boost 모두 허용
  const d = Number.parseInt(items.dittany ?? items.ditany ?? 0, 10);
  const ab = Number.parseInt(items.attack_boost ?? items.attackBooster ?? 0, 10);
  const db = Number.parseInt(items.defense_boost ?? items.defenseBooster ?? 0, 10);
  return {
    dittany: clamp(Number.isFinite(d) ? d : 0, 0, 99),
    attack_boost: clamp(Number.isFinite(ab) ? ab : 0, 0, 99),
    defense_boost: clamp(Number.isFinite(db) ? db : 0, 0, 99),
  };
}

function emitBattleUpdate(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  io.to(battleId).emit("battleUpdate", b);
  io.to(battleId).emit("battle:update", b);
}

function pushLog(battleId, type, message, data = {}) {
  const b = battles.get(battleId);
  if (!b) return;
  const entry = { ts: Date.now(), type, message, data };
  b.logs = b.logs || [];
  b.logs.push(entry);
  if (b.logs.length > 1000) b.logs = b.logs.slice(-500);
  io.to(battleId).emit("battle:log", entry);
}

/* -------------------------------- Middleware ------------------------------ */
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ----------------------------- Static & Routes ---------------------------- */
const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));
console.log("[STATIC] Serving from:", publicDir);

/** 루트 -> admin.html */
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

/** 명시적 파일 라우트 */
app.get(["/admin.html", "/player.html", "/spectator.html"], (req, res) => {
  res.sendFile(path.join(publicDir, path.basename(req.path)));
});

/** 캐치올: SPA처럼 admin.html 반환 */
app.use((req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.sendFile(path.join(publicDir, "admin.html"));
  }
  next();
});

/* --------------------------------- APIs ---------------------------------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/** 전투 생성 */
app.post("/api/battles", (req, res) => {
  try {
    const { mode = "2v2" } = req.body || {};
    if (!["1v1", "2v2", "3v3", "4v4"].includes(mode))
      return res.status(400).json({ ok: false, error: "invalid_mode" });

    const id = genId();
    const battle = {
      id,
      mode,
      status: "waiting",
      createdAt: Date.now(),
      players: [],
      logs: [],
      currentTurn: null,
    };
    battles.set(id, battle);
    console.log(`[BATTLE] Created: ${id} (${mode})`);
    res.json({ ok: true, battleId: id, battle });
  } catch (e) {
    console.error("Create battle error:", e);
    res.status(500).json({ ok: false, error: "create_failed" });
  }
});

/**
 * 관리자: 관전자 OTP + 참가자 자동로그인 링크 생성
 */
app.post("/api/admin/battles/:id/links", (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: "not_found" });

    const base = `${req.protocol}://${req.get("host")}`;

    // 관전자 OTP
    const spectatorOtp = genOTP(6);
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      role: "spectator",
      battleId,
      expires: Date.now() + 30 * 60 * 1000,
    });

    // 플레이어 개별 링크
    const links = [];
    (battle.players || []).forEach((p, idx) => {
      const otp = genOTP(6);
      otpStore.set(`player_${battleId}_${p.id}`, {
        otp,
        role: "player",
        battleId,
        playerId: p.id,
        playerName: p.name,
        team: p.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      const url =
        `${base}/player.html?battle=${battleId}` +
        `&token=${otp}&playerId=${p.id}&name=${encodeURIComponent(p.name)}` +
        `&team=${p.team}`;
      links.push({
        id: idx + 1,
        playerId: p.id,
        playerName: p.name,
        team: p.team,
        otp,
        url,
      });
      console.log(`[LINK] ${p.name} -> ${url}`);
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${battleId}&otp=${spectatorOtp}`,
      playerLinks: links,
    });
  } catch (e) {
    console.error("Link creation error:", e);
    res.status(500).json({ ok: false, error: "link_create_failed" });
  }
});

/** 호환용 */
app.post("/api/battles/:id/links", (req, res) =>
  app._router.handle(
    { ...req, url: `/api/admin/battles/${req.params.id}/links`, method: "POST" },
    res,
    () => {}
  )
);

/* ------------------------------- Socket.IO -------------------------------- */
io.on("connection", (socket) => {
  console.log("[SOCKET] Connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("[SOCKET] Disconnected:", socket.id);
  });

  /* 방 참여 */
  socket.on("join", ({ battleId }) => {
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit("battleUpdate", battles.get(battleId));
  });

  /* ====== 인증(관전자) ====== */
  socket.on("spectatorAuth", ({ battleId, otp, name }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) {
      const err = { ok: false, error: "battle_not_found" };
      cb && cb(err); socket.emit("authError", err); return;
    }
    const rec = otpStore.get(`spectator_${id}`);
    if (!rec || rec.otp !== otp || (rec.expires && Date.now() > rec.expires)) {
      const err = { ok: false, error: "invalid_token" };
      cb && cb(err); socket.emit("authError", err); return;
    }
    socket.join(id);
    socket.battleId = id;
    socket.role = "spectator";
    const payload = { ok: true, role: "spectator", name, battleId: id, battle: b };
    socket.emit("authSuccess", payload);
    socket.emit("auth:success", payload);
    cb && cb(payload);
  });
  socket.on("spectator:auth", (args, cb) => socket.emit("spectatorAuth", args, cb));

  /* ====== 인증(플레이어) — 자동 로그인(토큰) ====== */
  socket.on("playerAuth", ({ battleId, password, token, otp }, cb) => {
    try {
      const id = battleId || socket.battleId;
      const b = battles.get(id);
      if (!b) {
        const err = { ok: false, error: "battle_not_found", message: "전투를 찾을 수 없습니다." };
        cb && cb(err); socket.emit("authError", err); return;
      }

      const authToken = password || token || otp;
      let rec = null;
      for (const [key, r] of otpStore.entries()) {
        if (key.startsWith(`player_${id}_`) && r.otp === authToken) {
          if (r.expires && Date.now() > r.expires) { otpStore.delete(key); continue; }
          rec = r; break;
        }
      }
      if (!rec) {
        const err = { ok: false, error: "invalid_token", message: "잘못된 비밀번호입니다." };
        cb && cb(err); socket.emit("authError", err); return;
      }

      const player = (b.players || []).find(p => p.id === rec.playerId);
      if (!player) {
        const err = { ok: false, error: "player_not_found" };
        cb && cb(err); socket.emit("authError", err); return;
      }

      socket.join(id);
      socket.battleId = id;
      socket.playerId = player.id;
      socket.role = "player";

      const result = {
        ok: true,
        playerId: player.id,
        player,
        battle: b,
        role: "player",
        message: "인증 성공",
      };
      socket.emit("authSuccess", result);
      socket.emit("auth:success", result);
      cb && cb(result);

      pushLog(id, "system", `${player.name} 님이 접속했습니다.`);
      emitBattleUpdate(id);
    } catch (e) {
      console.error("playerAuth error:", e);
      const err = { ok: false, error: "auth_failed" };
      cb && cb(err); socket.emit("authError", err);
    }
  });
  socket.on("player:auth", (args, cb) => socket.emit("playerAuth", args, cb));

  /* ====== 채팅 ====== */
  socket.on("chatMessage", ({ battleId, message, name, role }) => {
    const id = battleId || socket.battleId;
    if (!id || !battles.has(id) || !message) return;
    const payload = { message, name: name || "익명", role: role || "user" };
    io.to(id).emit("chatMessage", payload);
    io.to(id).emit("battle:chat", payload);
  });
  socket.on("chat:send", (payload) => socket.emit("chatMessage", payload));

  /* ====== 전투 생성(소켓) ====== */
  socket.on("createBattle", ({ mode = "2v2" } = {}, cb) => {
    try {
      if (!["1v1", "2v2", "3v3", "4v4"].includes(mode)) {
        return typeof cb === "function" && cb({ error: "invalid_mode" });
      }
      const id = genId();
      const battle = {
        id, mode, status: "waiting", createdAt: Date.now(),
        players: [], logs: [], currentTurn: null,
      };
      battles.set(id, battle);
      socket.join(id);
      socket.battleId = id;
      pushLog(id, "system", `전투 생성: ${mode}`);
      emitBattleUpdate(id);
      typeof cb === "function" && cb({ ok: true, battleId: id, battle });
    } catch (e) {
      console.error("createBattle socket error:", e);
      typeof cb === "function" && cb({ error: "create_failed" });
    }
  });

  /* ====== 관리자 전투 제어(간단 버전) ====== */
  socket.on("startBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    b.currentTurn = { turnNumber: 1, currentTeam: "A", playerActions: {} };
    pushLog(id, "admin", "전투 시작");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("pauseBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "paused";
    pushLog(id, "admin", "전투 일시정지");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("resumeBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    pushLog(id, "admin", "전투 재개");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("endBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "ended";
    pushLog(id, "admin", "전투 종료");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  /* ====== 참가자 추가/삭제 ====== */
  socket.on("addPlayer", ({ battleId, player }, cb) => {
    try {
      const id = battleId || socket.battleId;
      const b = battles.get(id);
      if (!b) return cb && cb({ error: "not_found" });

      const name = String(player?.name || "").trim();
      if (!name) return cb && cb({ error: "invalid_player" });

      const stats = normalizeStats(player.stats || {});
      const pid = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const p = {
        id: pid,
        name,
        team: toAB(player.team),
        hp: clamp(parseInt(player.hp ?? 100, 10) || 100, 1, 100),
        maxHp: 100,
        stats,
        items: normalizeItems(player.items || {}),
        avatar: player.avatar || null,
        ready: false,
        joinedAt: Date.now(),
      };

      b.players.push(p);
      pushLog(id, "admin", `참가자 추가: ${p.name} (${p.team})`);
      emitBattleUpdate(id);
      cb && cb({ ok: true, player: p });
    } catch (e) {
      console.error("addPlayer error:", e);
      cb && cb({ error: "add_failed" });
    }
  });

  socket.on("deletePlayer", ({ battleId, playerId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    const before = b.players.length;
    b.players = b.players.filter((x) => x.id !== playerId);
    const removed = before !== b.players.length;
    if (removed) {
      pushLog(id, "admin", `참가자 삭제: ${playerId}`);
      emitBattleUpdate(id);
    }
    cb && cb({ ok: removed });
  });

  /* 호환 이벤트 브릿지 */
  socket.on("battle:chat", (payload) => socket.emit("chatMessage", payload));
});

/* --------------------------------- Errors -------------------------------- */
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));

/* --------------------------------- Start --------------------------------- */
server.listen(PORT, HOST, () => {
  console.log(`
PYXIS Battle System

Server : http://${HOST}:${PORT}
Socket : ${SOCKET_PATH}
Static : ${publicDir}
Uploads: ${uploadsDir}
Ready for battle!
`);
});
