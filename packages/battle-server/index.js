// packages/battle-server/index.js - (채팅 중복 제거/응원-채팅화/턴 자동진행+선후공 교대 추가)
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
const battles = new Map(); // battleId -> battle snapshot
const otpStore = new Map(); // key -> { otp, role, battleId, ... }

/* -------------------------------- Helpers -------------------------------- */
const genId = () => "battle_" + Math.random().toString(36).slice(2, 10);
const otherTeam = (t) => (t === "A" ? "B" : "A");

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

function alivePlayersOfTeam(b, team) {
  return (b.players || []).filter((p) => p.team === team && (p.hp ?? 1) > 0);
}
function teamActionsComplete(b) {
  const t = b.currentTurn?.currentTeam || "A";
  const alive = alivePlayersOfTeam(b, t);
  const actions = b.currentTurn?.playerActions || {};
  return alive.every((p) => actions[p.id]);
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

/** 전투 생성 (HTTP 폴백용) */
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

/** 관리자: OTP/링크 생성 */
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
    console.log("[SOCKET] join <-", { battleId, sid: socket.id });
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit("battleUpdate", battles.get(battleId));
  });

  /* 채팅 (중복 방지: 서버는 'chatMessage'만 브로드캐스트) */
  socket.on("chatMessage", ({ battleId, message, name, role }) => {
    const id = battleId || socket.battleId;
    if (!id || !battles.has(id) || !message) return;
    io.to(id).emit("chatMessage", {
      message,
      name: name || "익명",
      role: role || "user",
    });
  });
  // 호환 입력만 받고 내부적으로 chatMessage로 변환
  socket.on("battle:chat", (payload) => socket.emit("chatMessage", payload));

  /* 전투 생성 (소켓 경로) */
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
      };
      battles.set(id, battle);
      socket.join(id);
      socket.battleId = id;
      pushLog(id, "system", `전투가 생성되었습니다. 모드: ${mode}`);
      emitBattleUpdate(id);
      typeof cb === "function" && cb({ ok: true, battleId: id, battle });
    } catch (e) {
      typeof cb === "function" &&
        cb({ error: "create_failed", detail: String(e?.message || e) });
    }
  });

  /* 관리자 전투 제어 */
  socket.on("startBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    // 최초 선공 팀(기존 로직 유지: 기본 A). 필요 시 사전에 정해둔 값을 사용.
    const starter = b.currentTurn?.currentTeam || "A";
    b.currentTurn = {
      turnNumber: 1,
      currentTeam: starter,
      playerActions: {},
      phase: "first",       // 선공 단계
      starterTeam: starter, // 이번 라운드 선공
    };
    pushLog(id, "admin", `전투 시작 · 선공: ${starter}팀`);
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

  /* 참가자 추가/삭제 (기존 그대로) */
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
      pushLog(id, "admin", `참가자 추가: ${p.name} (${p.team}팀)`);
      emitBattleUpdate(id);
      cb && cb({ ok: true, player: p });
    } catch (e) {
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
  socket.on("removePlayer", (payload, cb) =>
    socket.emit("deletePlayer", payload, cb)
  );

  /* 플레이어 자동 로그인(토큰) */
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
            otpStore.delete(key); continue;
          }
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
      const err = { ok: false, error: "auth_failed", message: "인증 중 오류가 발생했습니다." };
      cb && cb(err); socket.emit("authError", err);
    }
  });
  socket.on("player:auth", (...args) => socket.emit("playerAuth", ...args));

  /* 준비 완료(브로드캐스트/로그 그대로) */
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
  socket.on("player:ready", (payload, cb) => socket.emit("playerReady", payload, cb));

  /* ▶ 플레이어 액션: 선택 누적 → 팀 전원 선택 시 다음 단계/라운드 자동 전진 */
  socket.on("playerAction", ({ battleId, playerId, action }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b || b.status !== "active") return cb && cb({ error: "not_active" });
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return cb && cb({ error: "player_not_found" });

    // 현재 팀이 아닌 경우 무시(자신의 턴만 허용)
    if ((b.currentTurn?.currentTeam || "A") !== p.team) {
      return cb && cb({ error: "not_your_turn" });
    }

    b.currentTurn = b.currentTurn || {
      turnNumber: 1,
      currentTeam: "A",
      playerActions: {},
      phase: "first",
      starterTeam: "A",
    };

    b.currentTurn.playerActions = b.currentTurn.playerActions || {};
    b.currentTurn.playerActions[playerId] = action || { type: "action" };

    pushLog(id, "battle", `[행동 선택] ${p.name} · ${action?.type || "action"}`);

    // 모든 생존 구성원이 선택했으면 진행
    if (teamActionsComplete(b)) {
      const curTeam = b.currentTurn.currentTeam;
      const nextTeam = otherTeam(curTeam);

      if (b.currentTurn.phase === "first") {
        // 후공으로 전환
        b.currentTurn.currentTeam = nextTeam;
        b.currentTurn.phase = "second";
        b.currentTurn.playerActions = {};
        pushLog(id, "system", `${curTeam}팀 선택 완료 → ${nextTeam}팀 차례로 전환`);
      } else {
        // 라운드 종료 → 선후공 교대
        const round = b.currentTurn.turnNumber;
        pushLog(id, "system", `라운드 ${round} 종료`);
        // 다음 라운드: 선후공 교대
        const newStarter = otherTeam(b.currentTurn.starterTeam || "A");
        b.currentTurn = {
          turnNumber: round + 1,
          currentTeam: newStarter,
          playerActions: {},
          phase: "first",
          starterTeam: newStarter,
        };
        pushLog(id, "system", `라운드 ${round + 1} 시작 · 선공: ${newStarter}팀`);
      }
      emitBattleUpdate(id);
    }

    io.to(id).emit("actionSuccess", { playerId, action });
    io.to(id).emit("player:action:success", { playerId, action });
    cb && cb({ ok: true });
  });
  socket.on("player:action", (payload, cb) => socket.emit("playerAction", payload, cb));

  /* ▶ 관전자 응원: 채팅으로만 중계 (로그 남기지 않음) */
  socket.on("spectator:cheer", ({ battleId, name, message }) => {
    const id = battleId || socket.battleId;
    if (!battles.has(id)) return;
    io.to(id).emit("cheerMessage", { name: name || "관전자", message });
    // 이전: pushLog 로 남기던 것 제거 (요청사항)
  });
  socket.on("cheerMessage", (payload) => socket.emit("spectator:cheer", payload));
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
