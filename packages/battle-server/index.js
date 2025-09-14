// packages/battle-server/index.js - PYXIS Battle Server (정적 라우트/자동 로그인/링크 생성 + 로그 브로드캐스트 + 룰 엔진 연동)
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";

// [추가] 라우터/엔진
import avatarUploadRouter from "./src/routes/avatar-upload.js";
import { BattleEngine } from "./src/engine/BattleEngine.js";

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
const battles = new Map();          // battleId -> battle snapshot
const engines = new Map();          // battleId -> BattleEngine
const otpStore = new Map();         // key -> { otp, role, battleId, ... }

/* -------------------------------- Helpers -------------------------------- */
const genId = () => "battle_" + Math.random().toString(36).slice(2, 10);

function genOTP(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function validStats(s) {
  if (!s || typeof s !== "object") return false;
  const { attack, defense, agility, luck } = s;
  return [attack, defense, agility, luck].every(
    (n) => Number.isInteger(n) && n >= 1 && n <= 5
  );
}

function emitBattleUpdate(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  // 갱신 직전 남은 팀 제한시간 갱신(엔진 보조)
  const eng = engines.get(battleId);
  if (eng) eng.updateTimeLeft();
  io.to(battleId).emit("battleUpdate", b);
  io.to(battleId).emit("battle:update", b); // 호환 이벤트
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
fs.mkdirSync(path.join(uploadsDir, "avatars"), { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));
// [추가] 업로드 라우터 마운트
app.use("/api/upload", avatarUploadRouter);

console.log("[STATIC] Serving from:", publicDir);

/** 루트 -> admin.html */
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

/** 명시적 파일 라우트 */
app.get(["/admin.html", "/player.html", "/spectator.html"], (req, res) => {
  res.sendFile(path.join(publicDir, path.basename(req.path)));
});

/** 캐치올 */
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

/** 전투 생성 (HTTP 폴백) */
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
      currentTurn: null, // 엔진이 start 시 채움
      timeLeft: null,
    };
    battles.set(id, battle);
    engines.set(
      id,
      new BattleEngine(
        battle,
        (type, msg, data) => pushLog(id, type, msg, data),
        () => emitBattleUpdate(id)
      )
    );
    console.log(`[BATTLE] Created: ${id} (${mode})`);
    res.json({ ok: true, battleId: id, battle });
  } catch (e) {
    console.error("Create battle error:", e);
    res.status(500).json({ ok: false, error: "create_failed" });
  }
});

/** 관리자: 관전자 OTP + 참가자 자동로그인 링크 생성 */
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
        expires: Date.now() + 60 * 60 * 1000, // 참가자 60분
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

/** 호환용 경로 */
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
    console.log("[SOCKET] join <-", { battleId, sid: socket.id });
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit("battleUpdate", battles.get(battleId));
  });

  /* 채팅 */
  socket.on("chatMessage", ({ battleId, message, name, role }) => {
    const id = battleId || socket.battleId;
    if (!id || !battles.has(id) || !message) return;
    io.to(id).emit("chatMessage", { message, name: name || "익명", role: role || "user" });
  });
  socket.on("battle:chat", (payload) => socket.emit("chatMessage", payload)); // 호환

  /* 전투 생성 (소켓) */
  socket.on("createBattle", ({ mode = "2v2" } = {}, cb) => {
    try {
      if (!["1v1", "2v2", "3v3", "4v4"].includes(mode)) {
        return typeof cb === "function" && cb({ error: "invalid_mode" });
      }
      const id = genId();
      const battle = {
        id,
        mode,
        status: "waiting",
        createdAt: Date.now(),
        players: [],
        logs: [],
        currentTurn: null,
        timeLeft: null,
      };
      battles.set(id, battle);
      engines.set(
        id,
        new BattleEngine(
          battle,
          (type, msg, data) => pushLog(id, type, msg, data),
          () => emitBattleUpdate(id)
        )
      );
      socket.join(id);
      socket.battleId = id;
      pushLog(id, "system", `전투 생성: ${mode}`);
      emitBattleUpdate(id);
      typeof cb === "function" && cb({ ok: true, battleId: id, battle });
    } catch (e) {
      console.error("createBattle socket error:", e);
      typeof cb === "function" && cb({ error: "create_failed", detail: String(e?.message || e) });
    }
  });

  /* 관리자 전투 제어 */
  socket.on("startBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    const eng = engines.get(id);
    if (!b || !eng) return cb && cb({ error: "not_found" });
    const ok = eng.startBattle();
    cb && cb(ok ? { ok: true } : { error: "start_failed" });
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

  /* 참가자 추가/삭제 */
  socket.on("addPlayer", ({ battleId, player }, cb) => {
    try {
      const id = battleId || socket.battleId;
      const b = battles.get(id);
      if (!b) return cb && cb({ error: "not_found" });
      if (!player?.name || !validStats(player.stats)) {
        return cb && cb({ error: "invalid_player" });
      }

      const pid = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const p = {
        id: pid,
        name: String(player.name).trim(),
        team: player.team === "B" ? "B" : "A",
        hp: Math.max(1, Math.min(100, parseInt(player.hp || 100))),
        maxHp: 100,
        stats: {
          attack: Math.max(1, Math.min(5, parseInt(player.stats.attack))),
          defense: Math.max(1, Math.min(5, parseInt(player.stats.defense))),
          agility: Math.max(1, Math.min(5, parseInt(player.stats.agility))),
          luck: Math.max(1, Math.min(5, parseInt(player.stats.luck))),
        },
        items: {
          // 양식 호환
          dittany: Math.max(0, parseInt(player.items?.dittany ?? player.items?.ditany ?? 0)),
          attackBooster: Math.max(0, parseInt(player.items?.attackBooster ?? 0)),
          defenseBooster: Math.max(0, parseInt(player.items?.defenseBooster ?? 0)),
        },
        avatar: player.avatar || null,
        ready: false,
        joinedAt: Date.now(),
        // 전투 중 상태 플래그
        state: { defending: false, dodging: false, defenseBoost: false, atkBoostActive: false },
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
  socket.on("removePlayer", (payload, cb) => socket.emit("deletePlayer", payload, cb)); // 호환

  /* 플레이어 인증 */
  socket.on("playerAuth", ({ battleId, password, token, otp, playerName }, cb) => {
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
      const player = b.players.find((p) => p.id === rec.playerId);
      if (!player) {
        const err = { ok: false, error: "player_not_found", message: "플레이어를 찾을 수 없습니다." };
        cb && cb(err); socket.emit("authError", err); return;
      }

      socket.join(id);
      socket.battleId = id;
      socket.playerId = player.id;
      socket.role = "player";

      const result = {
        ok: true,
        playerId: player.id,
        playerData: player,
        battle: b,
        message: "인증 성공! 전투에 참가했습니다.",
        success: true,
      };

      socket.emit("authSuccess", result);
      socket.emit("auth:success", result);
      cb && cb(result);

      pushLog(id, "system", `${player.name} 님이 접속했습니다.`);
      emitBattleUpdate(id);
    } catch (e) {
      console.error("playerAuth error:", e);
      const err = { ok: false, error: "auth_failed", message: "인증 중 오류가 발생했습니다." };
      cb && cb(err);
      socket.emit("authError", err);
    }
  });
  socket.on("player:auth", (...args) => socket.emit("playerAuth", ...args)); // 호환

  /* 준비 완료 */
  socket.on("playerReady", ({ battleId, playerId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return cb && cb({ error: "player_not_found" });
    p.ready = true;
    pushLog(id, "system", `${p.name} 님 준비 완료`);
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("player:ready", (payload, cb) => socket.emit("playerReady", payload, cb)); // 호환

  /* 플레이어 액션 (룰 엔진 적용) */
  socket.on("playerAction", ({ battleId, playerId, action }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    const eng = engines.get(id);
    if (!b || !eng) return cb && cb({ error: "not_found" });
    const res = eng.applyAction(playerId, action);
    if (res.error) return cb && cb({ error: res.error, detail: res.detail });
    cb && cb({ ok: true, result: res });
  });
  socket.on("player:action", (payload, cb) => socket.emit("playerAction", payload, cb)); // 호환

  /* 관전자 응원 (브로드캐스트 + 로그) */
  socket.on("spectator:cheer", ({ battleId, name, message }) => {
    const id = battleId || socket.battleId;
    if (!battles.has(id)) return;
    io.to(id).emit("cheerMessage", { name: name || "관전자", message });
    pushLog(id, "info", `[응원] ${name || "관전자"}: ${message}`);
  });
  socket.on("cheerMessage", (payload) => socket.emit("spectator:cheer", payload)); // 호환
});

/* --------------------------------- Errors -------------------------------- */
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));

/* --------------------------------- Start --------------------------------- */
server.listen(PORT, HOST, () => {
  console.log("======================================");
  console.log("PYXIS Battle System");
  console.log(`Server : http://${HOST}:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log("Ready for battle!");
  console.log("======================================");
});
