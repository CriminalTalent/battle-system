// packages/battle-server/index.js
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

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

/* ------------------------------ In-memory ------------------------------ */
const battles = new Map(); // battleId -> battle
const otpStore = new Map();

const genId = () => "battle_" + Math.random().toString(36).slice(2, 10);
const otherTeam = (t) => (t === "A" ? "B" : "A");

/* ------------------------------ Helpers ------------------------------ */
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
function alivePlayersOfTeam(b, team) {
  return (b.players || []).filter((p) => p.team === team && (p.hp ?? 1) > 0);
}
function emitBattleUpdate(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  io.to(battleId).emit("battleUpdate", b);
  io.to(battleId).emit("battle:update", b); // 호환
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

/* 현재 팀에서 아직 행동하지 않은 다음 플레이어를 currentPlayer로 세팅 */
function selectNextCurrentPlayer(b) {
  if (!b?.currentTurn) return;
  const t = b.currentTurn.currentTeam || "A";
  const actions = b.currentTurn.playerActions || {};
  const nextP = alivePlayersOfTeam(b, t).find((p) => !actions[p.id]);
  if (nextP) {
    b.currentTurn.currentPlayer = { id: nextP.id, avatar: nextP.avatar };
  } else {
    b.currentTurn.currentPlayer = null;
  }
}

/* 현재 팀 전원이 선택 완료되었는지 */
function teamActionsComplete(b) {
  const t = b.currentTurn?.currentTeam || "A";
  const alive = alivePlayersOfTeam(b, t);
  const actions = b.currentTurn?.playerActions || {};
  return alive.length > 0 && alive.every((p) => actions[p.id]);
}

/* 팀 전환 또는 라운드 종료 처리 (공통) */
function advanceTurn(b, reason = "auto") {
  const id = b.id;
  const curTeam = b.currentTurn.currentTeam;
  const nextTeam = otherTeam(curTeam);

  if (b.currentTurn.phase === "first") {
    // 후공으로 전환
    b.currentTurn.currentTeam = nextTeam;
    b.currentTurn.phase = "second";
    b.currentTurn.playerActions = {};
    b.currentTurn.timeLeftSec = 300;
    b._lastTick = Date.now();
    pushLog(id, "system", `${curTeam}팀 선택 완료 → ${nextTeam}팀 차례로 전환`);
    selectNextCurrentPlayer(b);
  } else {
    // 라운드 종료 → 선후공 교대
    const round = b.currentTurn.turnNumber || 1;
    pushLog(id, "system", `라운드 ${round} 종료`);
    const newStarter = otherTeam(b.currentTurn.starterTeam || "A");
    b.currentTurn = {
      turnNumber: round + 1,
      currentTeam: newStarter,
      playerActions: {},
      phase: "first",
      starterTeam: newStarter,
      timeLeftSec: 300,
    };
    b._lastTick = Date.now();
    pushLog(id, "system", `라운드 ${round + 1} 시작 · 선공: ${newStarter}팀`);
    selectNextCurrentPlayer(b);
  }
}

/* ------------------------------ Middleware/Static ------------------------------ */
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));
console.log("[STATIC] Serving from:", publicDir);

/* ------------------------------ Routes ------------------------------ */
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get(["/admin.html", "/player.html", "/spectator.html"], (req, res) =>
  res.sendFile(path.join(publicDir, path.basename(req.path)))
);
app.use((req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.sendFile(path.join(publicDir, "admin.html"));
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

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
    res.json({ ok: true, battleId: id, battle });
  } catch {
    res.status(500).json({ ok: false, error: "create_failed" });
  }
});

app.post("/api/admin/battles/:id/links", (req, res) => {
  try {
    const battleId = req.params.id;
    const b = battles.get(battleId);
    if (!b) return res.status(404).json({ ok: false, error: "not_found" });

    const base = `${req.protocol}://${req.get("host")}`;

    const spectatorOtp = genOTP(6);
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      role: "spectator",
      battleId,
      expires: Date.now() + 30 * 60 * 1000,
    });

    const playerLinks = [];
    (b.players || []).forEach((p, i) => {
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
        `&token=${otp}&playerId=${p.id}&name=${encodeURIComponent(p.name)}&team=${p.team}`;
      playerLinks.push({
        id: i + 1,
        playerId: p.id,
        playerName: p.name,
        team: p.team,
        otp,
        url,
      });
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${battleId}&otp=${spectatorOtp}`,
      playerLinks,
    });
  } catch {
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

/* ------------------------------ Socket.IO ------------------------------ */
io.on("connection", (socket) => {
  socket.on("join", ({ battleId }) => {
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    socket.battleId = battleId;
    socket.emit("battleUpdate", battles.get(battleId));
  });

  /* 채팅: 단일 이벤트만 사용 */
  socket.on("chatMessage", ({ battleId, message, name, role }) => {
    const id = battleId || socket.battleId;
    if (!id || !battles.has(id) || !message) return;
    io.to(id).emit("chatMessage", {
      message,
      name: name || "익명",
      role: role || "user",
    });
  });
  socket.on("battle:chat", (payload) => socket.emit("chatMessage", payload)); // 호환

  /* 전투 생성(소켓) */
  socket.on("createBattle", ({ mode = "2v2" } = {}, cb) => {
    if (!["1v1", "2v2", "3v3", "4v4"].includes(mode))
      return cb && cb({ error: "invalid_mode" });
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
    pushLog(id, "rule", `전투가 생성되었습니다 · 모드: ${mode}`);
    emitBattleUpdate(id);
    cb && cb({ ok: true, battleId: id, battle });
  });

  /* 관리자 전투 제어 */
  socket.on("startBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    const starter = b.currentTurn?.currentTeam || "A";
    b.currentTurn = {
      turnNumber: 1,
      currentTeam: starter,
      playerActions: {},
      phase: "first",
      starterTeam: starter,
      timeLeftSec: 300,
    };
    b._lastTick = Date.now();
    pushLog(id, "rule", `전투 시작! 선공: ${starter}팀`);
    selectNextCurrentPlayer(b);
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  socket.on("pauseBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "paused";
    pushLog(id, "system", "전투 일시정지");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  socket.on("resumeBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    pushLog(id, "system", "전투 재개");
    b._lastTick = Date.now();
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  socket.on("endBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "ended";
    pushLog(id, "system", "전투 종료");
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });

  /* 참가자 추가/삭제 (기존 유지) */
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
      pushLog(id, "system", `참가자 추가: ${p.name} (${p.team}팀)`);
      // 현재 턴의 플레이어가 없으면 갱신
      if (b.status === "active" && b.currentTurn) selectNextCurrentPlayer(b);
      emitBattleUpdate(id);
      cb && cb({ ok: true, player: p });
    } catch {
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
      pushLog(id, "system", `참가자 삭제: ${playerId}`);
      if (b.status === "active" && b.currentTurn) selectNextCurrentPlayer(b);
      emitBattleUpdate(id);
    }
    cb && cb({ ok: removed });
  });
  socket.on("removePlayer", (payload, cb) =>
    socket.emit("deletePlayer", payload, cb)
  );

  /* 플레이어 인증(자동 로그인 링크) */
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
    } catch {
      const err = { ok: false, error: "auth_failed", message: "인증 중 오류가 발생했습니다." };
      cb && cb(err); socket.emit("authError", err);
    }
  });
  socket.on("player:auth", (...args) => socket.emit("playerAuth", ...args));

  /* 준비 완료: 로그 + 브로드캐스트 */
  socket.on("playerReady", ({ battleId, playerId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return cb && cb({ error: "player_not_found" });
    p.ready = true;
    pushLog(id, "system", `${p.name} 님 준비 완료`);
    io.to(id).emit("playerReady", { playerId: p.id, name: p.name });
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("player:ready", (payload, cb) => socket.emit("playerReady", payload, cb));

  /* 액션: 팀 전원 선택 시 자동 진행 */
  socket.on("playerAction", ({ battleId, playerId, action }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b || b.status !== "active") return cb && cb({ error: "not_active" });
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return cb && cb({ error: "player_not_found" });

    if ((b.currentTurn?.currentTeam || "A") !== p.team)
      return cb && cb({ error: "not_your_turn" });

    b.currentTurn = b.currentTurn || {
      turnNumber: 1,
      currentTeam: "A",
      playerActions: {},
      phase: "first",
      starterTeam: "A",
      timeLeftSec: 300,
    };
    b.currentTurn.playerActions = b.currentTurn.playerActions || {};
    b.currentTurn.playerActions[playerId] = action || { type: "action" };

    pushLog(id, "battle", `[행동] ${p.name}: ${action?.type || "action"}`);
    io.to(id).emit("actionSuccess", { playerId, action });

    // 다음 개인 턴 지정
    selectNextCurrentPlayer(b);

    // 팀 전원 완료 → 단계 전진
    if (teamActionsComplete(b)) {
      advanceTurn(b, "team-complete");
    }
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("player:action", (payload, cb) => socket.emit("playerAction", payload, cb));

  /* 응원: 채팅으로만 브로드캐스트(로그 X) */
  socket.on("spectator:cheer", ({ battleId, name, message }) => {
    const id = battleId || socket.battleId;
    if (!battles.has(id)) return;
    io.to(id).emit("cheerMessage", { name: name || "관전자", message });
  });
  socket.on("cheerMessage", (payload) => socket.emit("spectator:cheer", payload));
});

/* ------------------------------ Turn timer tick ------------------------------ */
/* 매 1초: active 배틀의 팀 제한시간 감소, 0이면 자동 진행 */
setInterval(() => {
  const now = Date.now();
  for (const b of battles.values()) {
    if (b.status !== "active" || !b.currentTurn) continue;
    if (typeof b.currentTurn.timeLeftSec !== "number") continue;
    if (!b._lastTick) b._lastTick = now;
    const diff = Math.floor((now - b._lastTick) / 1000);
    if (diff <= 0) continue;
    b._lastTick = now;
    b.currentTurn.timeLeftSec = Math.max(0, b.currentTurn.timeLeftSec - diff);
    if (b.currentTurn.timeLeftSec === 0) {
      pushLog(b.id, "system", `${b.currentTurn.currentTeam}팀 제한시간 종료 → 자동 진행`);
      advanceTurn(b, "timeout");
      emitBattleUpdate(b.id);
    } else {
      // 주기적인 업데이트는 과도하므로 생략, 단계 변화 시에만 브로드캐스트
    }
  }
}, 1000);

/* ------------------------------ Start ------------------------------ */
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
