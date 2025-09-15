// packages/battle-server/index.js - PYXIS Battle Server
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
const d20 = () => (Math.random() * 20 | 0) + 1;

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

/* ---------------- 턴/타이머(요청 범위 내 최소 추가) ---------------- */
function alivePlayers(b, team) {
  return (b.players || []).filter(p => p.team === team && (p.hp ?? 0) > 0);
}
function teamHpSum(b, team) {
  return (b.players || []).filter(p => p.team === team)
    .reduce((s, p) => s + (p.hp ?? 0), 0);
}
function nextUnactedId(b, team) {
  const acted = team === "A" ? b.currentTurn.actedA : b.currentTurn.actedB;
  const list = alivePlayers(b, team);
  const n = list.find(p => !acted.has(p.id));
  return n ? n.id : null;
}
function startTurnTimer(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  clearInterval(b._timer);
  b._timer = setInterval(() => {
    const bb = battles.get(battleId);
    if (!bb || bb.status !== "active" || !bb.currentTurn) return;
    if (typeof bb.currentTurn.timeLeftSec !== "number") return;
    bb.currentTurn.timeLeftSec = Math.max(0, bb.currentTurn.timeLeftSec - 1);
    // 남은 시간 방송
    emitBattleUpdate(battleId);
    // 0초 도달 시: 현재 팀 남은 인원 자동 패스 처리 후, 상대 팀으로 전환/종료
    if (bb.currentTurn.timeLeftSec === 0) {
      pushLog(battleId, "rule", `[시간만료] 자동 패스 처리`);
      // 현재 팀을 모두 행동 완료로 마킹
      const curTeam = bb.currentTurn.currentTeam;
      const alive = alivePlayers(bb, curTeam);
      const acted = curTeam === "A" ? bb.currentTurn.actedA : bb.currentTurn.actedB;
      alive.forEach(p => acted.add(p.id));
      advanceAfterAction(battleId); // 다음 단계로
    }
  }, 1000);
}
function stopTurnTimer(battleId) {
  const b = battles.get(battleId);
  if (b && b._timer) {
    clearInterval(b._timer);
    b._timer = null;
  }
}
function decideInitiative(b) {
  // 팀 민첩 합 + D20, 동점시 재굴림
  const agiA = alivePlayers(b, "A").reduce((s, p) => s + (p.stats?.agility || 0), 0);
  const agiB = alivePlayers(b, "B").reduce((s, p) => s + (p.stats?.agility || 0), 0);
  let rA, rB;
  do {
    rA = d20(); rB = d20();
  } while (agiA + rA === agiB + rB);
  const scoreA = agiA + rA;
  const scoreB = agiB + rB;
  const first = scoreA > scoreB ? "A" : "B";
  // 상세 로그(최종수치 포함)
  pushLog(b.id, "rule",
    `선공 결정 ▶ A팀: 민첩합 ${agiA} + D20(${rA}) = ${scoreA}, ` +
    `B팀: 민첩합 ${agiB} + D20(${rB}) = ${scoreB} → ${first}팀 선공`);
  return first;
}
function initTurnState(b) {
  const startTeam = decideInitiative(b);
  b.currentTurn = {
    turnNumber: 1,
    startTeam,              // 라운드 시작팀(라운드마다 교대)
    currentTeam: startTeam,
    actedA: new Set(),
    actedB: new Set(),
    currentPlayerId: nextUnactedId(b, startTeam),
    timeLeftSec: 5 * 60
  };
  startTurnTimer(b.id);
  emitBattleUpdate(b.id);
}
function roundSummary(b) {
  const a = teamHpSum(b, "A");
  const bsum = teamHpSum(b, "B");
  pushLog(b.id, "rule", `라운드 ${b.currentTurn.turnNumber} 종료 ▶ A팀 HP합 ${a}, B팀 HP합 ${bsum}`);
}
function advanceAfterAction(battleId) {
  const b = battles.get(battleId);
  if (!b || !b.currentTurn) return;
  const T = b.currentTurn;
  const curTeam = T.currentTeam;
  const otherTeam = curTeam === "A" ? "B" : "A";
  const curActed = curTeam === "A" ? T.actedA : T.actedB;
  const othActed = curTeam === "A" ? T.actedB : T.actedA;

  // 현재 팀에 아직 남았으면 다음 사람
  const nextId = nextUnactedId(b, curTeam);
  if (nextId) {
    T.currentPlayerId = nextId;
    emitBattleUpdate(battleId);
    return;
  }
  // 현재 팀 완료 → 상대 팀 차례로
  if (alivePlayers(b, otherTeam).some(p => !othActed.has(p.id))) {
    T.currentTeam = otherTeam;
    T.currentPlayerId = nextUnactedId(b, otherTeam);
    T.timeLeftSec = Math.max(T.timeLeftSec, 1); // 시간 남아있으면 유지(요청: 모두 선택 시 남은 시간과 무관하게 넘어감 → 여기선 팀 교대)
    emitBattleUpdate(battleId);
    return;
  }

  // 양 팀 모두 완료 → 라운드 종료/요약/선후공 교대
  roundSummary(b);
  T.turnNumber += 1;
  T.startTeam = T.startTeam === "A" ? "B" : "A";
  T.currentTeam = T.startTeam;
  T.actedA = new Set();
  T.actedB = new Set();
  T.currentPlayerId = nextUnactedId(b, T.currentTeam);
  T.timeLeftSec = 5 * 60; // 새 라운드 시간
  emitBattleUpdate(battleId);
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
      _timer: null
    };
    battles.set(id, battle);
    console.log(`[BATTLE] Created: ${id} (${mode})`);
    res.json({ ok: true, battleId: id, battle });
  } catch (e) {
    console.error("Create battle error:", e);
    res.status(500).json({ ok: false, error: "create_failed" });
  }
});

/** 관리자: 관전자 OTP + 플레이어 개별 링크 생성 */
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
      links.push({ id: idx + 1, playerId: p.id, playerName: p.name, team: p.team, otp, url });
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

/** 구버전 호환 */
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

  /* 채팅 (중계: 채팅창에만 보이도록) */
  socket.on("chatMessage", ({ battleId, message, name, role }) => {
    const id = battleId || socket.battleId;
    if (!id || !battles.has(id) || !message) return;
    io.to(id).emit("chatMessage", { message, name: name || "익명", role: role || "user" });
  });

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
        _timer: null
      };
      battles.set(id, battle);
      socket.join(id);
      socket.battleId = id;
      pushLog(id, "system", `전투 생성: ${mode}`);
      emitBattleUpdate(id);
      typeof cb === "function" && cb({ ok: true, battleId: id, battle });
    } catch (e) {
      typeof cb === "function" && cb({ error: "create_failed", detail: String(e?.message || e) });
    }
  });

  /* 관리자 전투 제어 */
  socket.on("startBattle", ({ battleId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    b.status = "active";
    pushLog(id, "rule", "전투 시작");
    initTurnState(b);
    cb && cb({ ok: true });
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
    startTurnTimer(id);
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

  /* 플레이어 자동 로그인(토큰) */
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
      const err = { ok: false, error: "auth_failed", message: "인증 중 오류가 발생했습니다." };
      cb && cb(err); socket.emit("authError", err);
    }
  });
  socket.on("player:auth", (...args) => socket.emit("playerAuth", ...args));
  socket.on("battle:chat", (payload) => socket.emit("chatMessage", payload));

  /* ---------------------- [요청추가] 준비/액션/응원 ---------------------- */
  socket.on("playerReady", ({ battleId, playerId }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b) return cb && cb({ error: "not_found" });
    const p = b.players.find((x) => x.id === playerId);
    if (!p) return cb && cb({ error: "player_not_found" });
    p.ready = true;
    // 모든 페이지에 송출
    io.to(id).emit("playerReady", { playerId: p.id, name: p.name, team: p.team });
    pushLog(id, "rule", `${p.name} 준비 완료`);
    emitBattleUpdate(id);
    cb && cb({ ok: true });
  });
  socket.on("player:ready", (payload, cb) => socket.emit("playerReady", payload, cb));

  socket.on("playerAction", ({ battleId, playerId, action }, cb) => {
    const id = battleId || socket.battleId;
    const b = battles.get(id);
    if (!b || b.status !== "active" || !b.currentTurn) {
      cb && cb({ error: "not_active" }); pushLog(id, "error", "행동 전송 실패: 전투가 활성 상태가 아님"); return;
    }
    const p = b.players.find((x) => x.id === playerId);
    if (!p) { cb && cb({ error: "player_not_found" }); pushLog(id,"error","행동 전송 실패: 플레이어를 찾을 수 없음"); return; }

    const aType = action?.type || "action";
    // 내 팀 차례 + 아직 행동하지 않은 사람만 허용
    if (b.currentTurn.currentTeam !== p.team) {
      cb && cb({ error: "not_your_team_turn" }); pushLog(id,"error","행동 전송 실패: 팀 차례가 아님"); return;
    }
    const acted = p.team === "A" ? b.currentTurn.actedA : b.currentTurn.actedB;
    if (acted.has(p.id)) {
      cb && cb({ error: "already_acted" }); pushLog(id,"error","행동 전송 실패: 이미 행동함"); return;
    }

    // 브로드캐스트/로그
    pushLog(id, "battle", `[행동] ${p.name}: ${aType}` + (action?.targetId ? ` -> ${action.targetId}` : ""));
    io.to(id).emit("actionSuccess", { playerId, action });

    // 행동 완료 처리 → 다음으로
    acted.add(p.id);
    advanceAfterAction(id);

    cb && cb({ ok: true });
  });
  socket.on("player:action", (payload, cb) => socket.emit("playerAction", payload, cb));

  socket.on("spectator:cheer", ({ battleId, name, message }) => {
    const id = battleId || socket.battleId;
    if (!battles.has(id)) return;
    // 채팅으로만 송출(요청사항)
    io.to(id).emit("chatMessage", { name: name || "관전자", message });
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
