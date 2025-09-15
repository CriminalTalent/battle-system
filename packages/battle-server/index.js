// packages/battle-server/index.js - PYXIS Battle Server (정적 라우트/자동 로그인/관리자용 링크 생성 + 디버그 로그/호환 이벤트 포함)
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";
import uploadRouter from "./src/routes/avatar-upload.js"; // 업로드 라우터 (기존 유지)

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
const battles = new Map(); // battleId -> battle snapshot
const otpStore = new Map(); // key -> { otp, role, battleId, ... }
const turnTimers = new Map(); // battleId -> intervalId

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

/** 선공 판정: 팀 민첩합 + D20, 동점은 재굴림 */
function rollD20() {
  return (Math.random() * 20 + 1) | 0;
}
function sumAgi(players, team) {
  return players
    .filter((p) => p.team === team)
    .reduce((s, p) => s + (p.stats?.agility || 0), 0);
}
function decideInitiative(b) {
  // 안전장치
  if (!b.players?.length) {
    return { firstTeam: "A", detail: "참가자 부족 - 기본 A팀 선공" };
  }
  while (true) {
    const aAgi = sumAgi(b.players, "A");
    const bAgi = sumAgi(b.players, "B");
    const aRoll = rollD20();
    const bRoll = rollD20();
    const aTot = aAgi + aRoll;
    const bTot = bAgi + bRoll;
    if (aTot !== bTot) {
      const firstTeam = aTot > bTot ? "A" : "B";
      const detail =
        `선공 판정: A팀(민첩합 ${aAgi} + 주사위 ${aRoll} = ${aTot}), ` +
        `B팀(민첩합 ${bAgi} + 주사위 ${bRoll} = ${bTot}) → ${firstTeam}팀 선공`;
      return { firstTeam, detail, aAgi, bAgi, aRoll, bRoll, aTot, bTot };
    }
  }
}

/** 5분(300초) 제한 타이머 시작/정지 */
function startTurnTimer(battleId, seconds = 300) {
  const b = battles.get(battleId);
  if (!b) return;
  // 중복 방지
  if (turnTimers.has(battleId)) clearInterval(turnTimers.get(battleId));

  b.timeLeft = seconds;
  b.turnStartedAt = Date.now();

  const itv = setInterval(() => {
    const bb = battles.get(battleId);
    if (!bb || bb.status !== "active") return; // pause/end 시 자연 정지
    bb.timeLeft = Math.max(0, (bb.timeLeft || 0) - 1);
    emitBattleUpdate(battleId);
    if (bb.timeLeft <= 0) {
      clearInterval(itv);
      turnTimers.delete(battleId);
      // 시간 초과 자동 패스(서버 규칙 엔진이 없으므로 로그만)
      pushLog(battleId, "rule", "팀 제한 시간 만료 - 자동 진행");
    }
  }, 1000);
  turnTimers.set(battleId, itv);
}
function stopTurnTimer(battleId) {
  if (turnTimers.has(battleId)) {
    clearInterval(turnTimers.get(battleId));
    turnTimers.delete(battleId);
  }
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
fs.mkdirSync(publicDir, { recursive: true });

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));
app.use("/api/upload", uploadRouter); // 아바타 업로드(기존 유지)

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});
app.get(["/admin.html", "/player.html", "/spectator.html"], (req, res) => {
  res.sendFile(path.join(publicDir, path.basename(req.path)));
});
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
      timeLeft: 0,
    };
    battles.set(id, battle);
    console.log(`[BATTLE] Created: ${id} (${mode})`);
    res.json({ ok: true, battleId: id, battle });
  } catch (e) {
    console.error("Create battle error:", e);
    res.status(500).json({ ok: false, error: "create_failed" });
  }
});

app.post("/api/admin/battles/:id/links", (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: "not_found" });

    const base = `${req.protocol}://${req.get("host")}`;

    const spectatorOtp = genOTP(6);
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      role: "spectator",
      battleId,
      expires: Date.now() + 30 * 60 * 1000,
    });

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

  socket.on("join", ({ battleId }) => {
    console.log("[SOCKET] join <-", { battleId, sid: socket.id });
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit("battleUpdate", battles.get(battleId));
  });

  socket.on("chatMessage", ({ battleId, message, name, role }) => {
    const id = battleId || socket.battleId;
    if (!id || !battles.has(id) || !message) return;
    io.to(id).emit("chatMessage", { message, name: name || "익명", role: role || "user" });
  });

  socket.on("createBattle", ({ mode = "2v2" } = {}, cb) => {
    console.log("[SOCKET] createBattle <-", { mode, sid: socket.id });
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
        timeLeft: 0,
      };
      battles.set(id, battle);
      socket.join(id);
      socket.battleId = id;
      pushLog(id, "system", `전투 생성: ${mode}`);
      emitBattleUpdate(id);
      typeof cb === "function" && cb({ ok: true, battleId: id, battle });
    } catch (e) {
      console.error("createBattle socket error:", e);
      typeof cb === "function" &&
        cb({ error: "create_failed", detail: String(e?.message || e) });
    }
  });

  /* ───────── 관리자 전투 제어 ───────── */
  socket.on("startBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";

    const ini = decideInitiative(b);
    b.currentTurn = { turnNumber: 1, currentTeam: ini.firstTeam, playerActions: {} };
    pushLog(id, "rule", ini.detail);
    pushLog(id, "admin", "전투 시작");
    startTurnTimer(id, 300);

    emitBattleUpdate(id);
    cb && cb({ ok: true, firstTeam: ini.firstTeam });
  });

  socket.on("pauseBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "paused";
    stopTurnTimer(id);
    pushLog(id, "admin", "전투 일시정지");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  socket.on("resumeBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    // 남은 시간 없으면 300초 재설정
    startTurnTimer(id, b.timeLeft > 0 ? b.timeLeft : 300);
    pushLog(id, "admin", "전투 재개");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  socket.on("endBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "ended";
    stopTurnTimer(id);
    pushLog(id, "admin", "전투 종료");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  /* ───────── 참가자 추가/삭제 ───────── */
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
          ditany: Math.max(0, parseInt(player.items?.ditany || player.items?.dittany || 0)),
          attackBooster: Math.max(0, parseInt(player.items?.attackBooster || 0)),
          defenseBooster: Math.max(0, parseInt(player.items?.defenseBooster || 0)),
        },
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
  socket.on("removePlayer", (payload, cb) => socket.emit("deletePlayer", payload, cb));

  /* ───────── 인증 ───────── */
  socket.on("playerAuth", ({ battleId, password, token, otp, playerName }, cb) => {
    try {
      const id = battleId || socket.battleId;
      const b = battles.get(id);
      if (!b) {
        const err = { ok: false, error: "battle_not_found", message: "전투를 찾을 수 없습니다." };
        cb && cb(err);
        socket.emit("authError", err);
        return;
      }

      const authToken = password || token || otp;
      let rec = null;
      for (const [key, r] of otpStore.entries()) {
        if (key.startsWith(`player_${id}_`) && r.otp === authToken) {
          if (r.expires && Date.now() > r.expires) {
            otpStore.delete(key);
            continue;
          }
          rec = r;
          break;
        }
      }
      if (!rec) {
        const err = { ok: false, error: "invalid_token", message: "잘못된 비밀번호입니다." };
        cb && cb(err);
        socket.emit("authError", err);
        return;
      }

      const player = b.players.find((p) => p.id === rec.playerId);
      if (!player) {
        const err = { ok: false, error: "player_not_found", message: "플레이어를 찾을 수 없습니다." };
        cb && cb(err);
        socket.emit("authError", err);
        return;
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
  socket.on("player:auth", (...args) => socket.emit("playerAuth", ...args));
  socket.on("battle:chat", (payload) => socket.emit("chatMessage", payload));

  /* ───────── 준비/행동/응원 ───────── */

  // 준비 완료: 전원 준비 여부 추가 로그
  socket.on("playerReady", ({ battleId, playerId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return cb && cb({ error: "player_not_found" });
    if (!p.ready) {
      p.ready = true;
      pushLog(id, "system", `${p.name} 님 준비 완료`);
      // 전원 준비 확인
      if (b.players.length > 0 && b.players.every((x) => x.ready)) {
        pushLog(id, "system", "모든 참가자 준비 완료");
      }
      emitBattleUpdate(id);
    }
    cb && cb({ ok: true });
  });
  socket.on("player:ready", (payload, cb) => socket.emit("playerReady", payload, cb));

  // 행동 로그 한글화
  socket.on("playerAction", ({ battleId, playerId, action }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    const actor = b.players.find((x) => x.id === playerId);
    if (!actor) return cb && cb({ error: "player_not_found" });

    const target =
      (action?.targetId && b.players.find((x) => x.id === action.targetId)) || null;

    const phase = actor.team === (b.currentTurn?.currentTeam || "A") ? "선공" : "후공";
    const type = (action?.type || "").toLowerCase();
    const typeKo =
      type === "attack" ? "공격" :
      type === "defend" ? "방어" :
      type === "dodge"  ? "회피" :
      type === "item"   ? "아이템" :
      type === "pass"   ? "패스" : "행동";

    const tgtName = target ? `${target.name}` : (type === "item" || type === "pass" ? "" : "(대상 미지정)");
    const msg =
      tgtName
        ? `${phase} ${actor.name}이(가) ${tgtName}에게 ${typeKo}`
        : `${phase} ${actor.name}이(가) ${typeKo}`;

    pushLog(id, "rule", msg);
    io.to(id).emit("actionSuccess", { playerId, action });
    io.to(id).emit("player:action:success", { playerId, action });
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("player:action", (payload, cb) => socket.emit("playerAction", payload, cb));

  // 응원: 채팅으로만 송신(로그 남기지 않음)
  socket.on("spectator:cheer", ({ battleId, name, message }) => {
    const id = battleId || socket.battleId;
    if (!battles.has(id)) return;
    const text = `[응원] ${message}`;
    io.to(id).emit("chatMessage", { name: name || "관전자", message: text, role: "spectator" });
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
