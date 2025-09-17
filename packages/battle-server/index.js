// packages/battle-server/index.js
// 포트/소켓 경로 고정: 3001 / /socket.io
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";

// 업로드 라우터(불변)
import avatarUploadRouter from "./src/routes/avatar-upload.js";

dotenv.config();

// -----------------------------------------------
// 경로/서버 기본
// -----------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const rootDir    = path.resolve(__dirname);
const publicDir  = path.join(rootDir, "public");
const uploadsDir = path.join(rootDir, "uploads");
const PORT       = Number(process.env.PORT || 3001);
const HOST       = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = "/socket.io";

// 디렉토리 보장
fs.mkdirSync(path.join(uploadsDir, "avatars"), { recursive: true });

// 앱/소켓
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// 정적 제공(불변)
app.use("/uploads", express.static(uploadsDir));
app.use("/api/upload", avatarUploadRouter);

// -----------------------------------------------
// SPA 엔드포인트(불변) - 정적 파일보다 먼저
// -----------------------------------------------
function safeSendFile(res, absPath, fallback) {
  if (fs.existsSync(absPath)) {
    res.sendFile(absPath);
  } else if (fallback) {
    res.redirect(fallback);
  } else {
    res.status(404).send("Not Found");
  }
}
app.get("/admin",     (_req,res)=> safeSendFile(res, path.join(publicDir, "admin.html"), "/admin.html"));
app.get("/player",    (_req,res)=> safeSendFile(res, path.join(publicDir, "player.html"), "/player.html"));
app.get("/spectator", (_req,res)=> safeSendFile(res, path.join(publicDir, "spectator.html"), "/spectator.html"));

// 정적 파일 제공
app.use(express.static(publicDir));

// -----------------------------------------------
// 메모리 전투 저장소
// -----------------------------------------------
const battles = new Map();
const timers = new Map();

// -----------------------------------------------
// 유틸
// -----------------------------------------------
function d20() { return Math.floor(Math.random() * 20) + 1; }
function d10() { return Math.floor(Math.random() * 10) + 1; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function generateId(prefix = "battle") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function pushLog(battleId, type, message) {
  const b = battles.get(battleId);
  if (!b) return;
  
  const logEntry = {
    ts: Date.now(),
    type: type || "system",
    message: message || ""
  };
  
  b.logs.push(logEntry);
  
  // 로그 수 제한 (최대 500개)
  if (b.logs.length > 500) {
    b.logs.splice(0, b.logs.length - 500);
  }
  
  // 소켓 브로드캐스트 (호환성 위해 두 이벤트 모두 발송)
  io.to(battleId).emit("battleLog", logEntry);
  io.to(battleId).emit("battle:log", logEntry);
}

function broadcastUpdate(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  
  const snapshot = {
    id: battleId,
    mode: b.mode,
    status: b.status,
    createdAt: b.createdAt,
    players: b.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      stats: p.stats,
      items: p.items,
      avatar: p.avatar,
      ready: p.ready,
      joinedAt: p.joinedAt
    })),
    currentTurn: b.currentTurn,
    logs: b.logs.slice(-50) // 최근 50개만
  };
  
  // 호환성 위해 두 이벤트 모두 발송
  io.to(battleId).emit("battleUpdate", snapshot);
  io.to(battleId).emit("battle:update", snapshot);
}

// -----------------------------------------------
// HTTP API (기존 호환성)
// -----------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    battles: battles.size,
    timestamp: Date.now()
  });
});

app.post("/api/battles", (req, res) => {
  try {
    const { mode } = req.body;
    if (!["1v1", "2v2", "3v3", "4v4"].includes(mode)) {
      throw new Error("Invalid mode");
    }
    
    const battleId = generateId("battle");
    const battle = {
      id: battleId,
      mode: mode,
      status: "waiting",
      createdAt: Date.now(),
      players: [],
      currentTurn: {
        turnNumber: 1,
        currentTeam: "A",
        currentPlayer: null,
        timeLeftSec: 300
      },
      round: {
        actions: {},
        defendToken: {},
        dodgeToken: {},
        attackBoosters: {},
        defenseBoosters: {}
      },
      logs: []
    };
    
    battles.set(battleId, battle);
    pushLog(battleId, "system", `전투가 생성되었습니다 (${mode})`);
    
    res.json({ 
      ok: true, 
      battleId: battleId,
      battle: battle
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 관리자 링크 생성 (호환성)
app.post("/api/battles/:id/links", (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) {
      throw new Error("Battle not found");
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = Math.random().toString(36).slice(2, 10);
    
    const result = {
      spectator: {
        otp: spectatorOtp,
        url: `${baseUrl}/spectator?battle=${battleId}&otp=${spectatorOtp}`
      },
      playerLinks: battle.players.map(p => ({
        name: p.name,
        team: p.team,
        token: p.id,
        url: `${baseUrl}/player?battle=${battleId}&token=${p.id}`
      }))
    };
    
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 호환성을 위한 추가 엔드포인트
app.post("/api/admin/battles/:id/links", (req, res) => {
  // 위와 동일한 로직
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) {
      throw new Error("Battle not found");
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = Math.random().toString(36).slice(2, 10);
    
    const result = {
      spectator: {
        otp: spectatorOtp,
        url: `${baseUrl}/spectator?battle=${battleId}&otp=${spectatorOtp}`
      },
      playerLinks: battle.players.map(p => ({
        name: p.name,
        team: p.team,
        token: p.id,
        url: `${baseUrl}/player?battle=${battleId}&token=${p.id}`
      }))
    };
    
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------
// 소켓 이벤트
// -----------------------------------------------
io.on("connection", (socket) => {
  console.log(`소켓 연결: ${socket.id}`);
  
  // 방 입장
  socket.on("join", (data) => {
    const { battleId } = data;
    if (!battleId || !battles.has(battleId)) {
      socket.emit("error", "Invalid battle ID");
      return;
    }
    
    socket.join(battleId);
    socket.battleId = battleId;
    pushLog(battleId, "system", `새 연결이 입장했습니다`);
    broadcastUpdate(battleId);
  });
  
  // 전투 생성
  socket.on("createBattle", (data) => {
    try {
      const { mode } = data;
      if (!["1v1", "2v2", "3v3", "4v4"].includes(mode)) {
        throw new Error("Invalid mode");
      }
      
      const battleId = generateId("battle");
      const battle = {
        id: battleId,
        mode: mode,
        status: "waiting",
        createdAt: Date.now(),
        players: [],
        currentTurn: {
          turnNumber: 1,
          currentTeam: "A",
          currentPlayer: null,
          timeLeftSec: 300
        },
        round: {
          actions: {},
          defendToken: {},
          dodgeToken: {},
          attackBoosters: {},
          defenseBoosters: {}
        },
        logs: []
      };
      
      battles.set(battleId, battle);
      socket.join(battleId);
      socket.battleId = battleId;
      
      pushLog(battleId, "system", `전투가 생성되었습니다 (${mode})`);
      socket.emit("battleCreated", { battleId, battle });
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  // 플레이어 추가
  socket.on("addPlayer", (data) => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      const { name, team, hp, stats, items, avatar } = data;
      
      if (!name || !team) throw new Error("Name and team required");
      if (!["A", "B"].includes(team)) throw new Error("Invalid team");
      
      const playerId = generateId("player");
      const player = {
        id: playerId,
        name: name.trim(),
        team: team,
        hp: parseInt(hp) || 100,
        maxHp: parseInt(hp) || 100,
        stats: {
          attack: clamp(parseInt(stats?.attack) || 3, 1, 5),
          defense: clamp(parseInt(stats?.defense) || 3, 1, 5),
          agility: clamp(parseInt(stats?.agility) || 3, 1, 5),
          luck: clamp(parseInt(stats?.luck) || 2, 1, 5)
        },
        items: {
          dittany: parseInt(items?.dittany) || parseInt(items?.ditany) || 0,
          ditany: parseInt(items?.ditany) || parseInt(items?.dittany) || 0,
          attackBooster: parseInt(items?.attackBooster) || parseInt(items?.attack_boost) || 0,
          attack_boost: parseInt(items?.attack_boost) || parseInt(items?.attackBooster) || 0,
          defenseBooster: parseInt(items?.defenseBooster) || parseInt(items?.defense_boost) || 0,
          defense_boost: parseInt(items?.defense_boost) || parseInt(items?.defenseBooster) || 0
        },
        avatar: avatar || null,
        ready: false,
        joinedAt: Date.now()
      };
      
      b.players.push(player);
      pushLog(battleId, "system", `${player.name}이(가) ${team}팀으로 참가했습니다`);
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  // 플레이어 삭제 (호환성)
  socket.on("deletePlayer", (data) => {
    handleRemovePlayer(socket, data);
  });
  
  socket.on("removePlayer", (data) => {
    handleRemovePlayer(socket, data);
  });
  
  function handleRemovePlayer(socket, data) {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      const { playerId } = data;
      const playerIndex = b.players.findIndex(p => p.id === playerId);
      
      if (playerIndex === -1) throw new Error("Player not found");
      
      const removedPlayer = b.players.splice(playerIndex, 1)[0];
      pushLog(battleId, "system", `${removedPlayer.name}이(가) 전투에서 제거되었습니다`);
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  }
  
  // 전투 제어
  socket.on("startBattle", () => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      if (b.players.length === 0) throw new Error("No players");
      
      // 선공 결정: 팀별 민첩 총합 + D20
      const aTeamAgility = b.players.filter(p => p.team === "A")
        .reduce((sum, p) => sum + (p.stats.agility || 3), 0);
      const bTeamAgility = b.players.filter(p => p.team === "B")
        .reduce((sum, p) => sum + (p.stats.agility || 3), 0);
      
      const aRoll = d20();
      const bRoll = d20();
      const aTotal = aTeamAgility + aRoll;
      const bTotal = bTeamAgility + bRoll;
      
      let firstTeam = "A";
      if (bTotal > aTotal) firstTeam = "B";
      else if (aTotal === bTotal) {
        // 동점시 재굴림
        firstTeam = d20() >= d20() ? "A" : "B";
      }
      
      b.status = "active";
      b.currentTurn.currentTeam = firstTeam;
      b.currentTurn.timeLeftSec = 300;
      
      pushLog(battleId, "system", `선공 결정: A팀(${aTeamAgility}+${aRoll}=${aTotal}) vs B팀(${bTeamAgility}+${bRoll}=${bTotal})`);
      pushLog(battleId, "system", `${firstTeam}팀이 선공입니다!`);
      pushLog(battleId, "battle", "전투가 시작되었습니다!");
      
      startTurnTimer(battleId);
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  socket.on("pauseBattle", () => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      b.status = "paused";
      clearTimer(battleId);
      
      pushLog(battleId, "admin", "전투가 일시정지되었습니다");
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  socket.on("resumeBattle", () => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      b.status = "active";
      startTurnTimer(battleId);
      
      pushLog(battleId, "admin", "전투가 재개되었습니다");
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  socket.on("endBattle", () => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      b.status = "ended";
      clearTimer(battleId);
      
      pushLog(battleId, "admin", "전투가 종료되었습니다");
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  // 플레이어 인증 (호환성)
  socket.on("playerAuth", (data) => {
    try {
      const { battleId, token } = data;
      if (!battleId || !token) throw new Error("Missing credentials");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      const player = b.players.find(p => p.id === token);
      if (!player) throw new Error("Player not found");
      
      socket.join(battleId);
      socket.battleId = battleId;
      socket.playerId = player.id;
      
      // 호환성을 위해 두 이벤트 모두 발송
      socket.emit("authSuccess", { player, battle: b });
      socket.emit("auth:success", { player, battle: b });
      
      pushLog(battleId, "system", `${player.name}이(가) 로그인했습니다`);
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("authError", err.message);
    }
  });
  
  // 준비 완료
  socket.on("player:ready", () => {
    handlePlayerReady(socket);
  });
  
  socket.on("playerReady", () => {
    handlePlayerReady(socket);
  });
  
  function handlePlayerReady(socket) {
    try {
      const battleId = socket.battleId;
      const playerId = socket.playerId;
      
      if (!battleId || !playerId) throw new Error("Not authenticated");
      
      const b = battles.get(battleId);
      if (!b) throw new Error("Battle not found");
      
      const player = b.players.find(p => p.id === playerId);
      if (!player) throw new Error("Player not found");
      
      player.ready = true;
      pushLog(battleId, "system", `${player.name}이(가) 준비 완료했습니다`);
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("error", err.message);
    }
  }
  
  // 플레이어 행동
  socket.on("player:action", (data) => {
    handlePlayerAction(socket, data);
  });
  
  socket.on("playerAction", (data) => {
    handlePlayerAction(socket, data);
  });
  
  function handlePlayerAction(socket, data) {
    try {
      const battleId = socket.battleId;
      const playerId = socket.playerId;
      
      if (!battleId || !playerId) throw new Error("Not authenticated");
      
      const b = battles.get(battleId);
      if (!b || b.status !== "active") throw new Error("Battle not active");
      
      const me = b.players.find(p => p.id === playerId);
      if (!me) throw new Error("Player not found");
      if (me.hp <= 0) throw new Error("You are dead");
      if (me.team !== b.currentTurn.currentTeam) throw new Error("Not your team's turn");
      
      const { type, targetId, item } = data;
      
      // 행동 기록
      b.round.actions[playerId] = { type, targetId, item };
      
      pushLog(battleId, "battle", `${me.name}이(가) 행동을 선택했습니다`);
      
      // 팀의 모든 생존자가 행동했는지 확인
      const teamPlayers = b.players.filter(p => p.team === b.currentTurn.currentTeam && p.hp > 0);
      const actedPlayers = teamPlayers.filter(p => b.round.actions[p.id]);
      
      if (actedPlayers.length >= teamPlayers.length) {
        // 팀 전원 행동 완료 - 상대 팀으로 전환 또는 라운드 해결
        const otherTeam = b.currentTurn.currentTeam === "A" ? "B" : "A";
        const otherTeamPlayers = b.players.filter(p => p.team === otherTeam && p.hp > 0);
        
        if (otherTeamPlayers.length === 0) {
          // 상대팀이 전멸한 경우 즉시 라운드 해결
          resolveRound(battleId);
        } else {
          const otherTeamActedPlayers = otherTeamPlayers.filter(p => b.round.actions[p.id]);
          
          if (otherTeamActedPlayers.length >= otherTeamPlayers.length) {
            // 양팀 모두 행동 완료 - 라운드 해결
            resolveRound(battleId);
          } else {
            // 상대 팀으로 턴 전환
            b.currentTurn.currentTeam = otherTeam;
            b.currentTurn.timeLeftSec = 300;
            pushLog(battleId, "system", `${otherTeam}팀의 턴입니다`);
            startTurnTimer(battleId);
          }
        }
      }
      
      // 호환성을 위해 두 이벤트 모두 발송
      socket.emit("actionSuccess", { success: true });
      socket.emit("player:action:success", { success: true });
      
      broadcastUpdate(battleId);
    } catch (err) {
      socket.emit("actionError", err.message);
    }
  }
  
  // 채팅 메시지
  socket.on("chatMessage", (data) => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const chatData = {
        senderName: data.senderName || "익명",
        senderId: data.senderId || socket.playerId,
        team: data.team,
        message: data.message || data.content,
        timestamp: Date.now()
      };
      
      // 호환성을 위해 두 이벤트 모두 발송
      io.to(battleId).emit("chatMessage", chatData);
      io.to(battleId).emit("battle:chat", chatData);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  // 응원 메시지
  socket.on("spectator:cheer", (data) => {
    try {
      const battleId = socket.battleId;
      if (!battleId) throw new Error("No battle joined");
      
      const cheerData = {
        spectatorName: data.spectatorName || "관전자",
        message: data.message || data.cheer,
        timestamp: Date.now()
      };
      
      // 호환성을 위해 두 이벤트 모두 발송 (채팅에만 표시)
      io.to(battleId).emit("spectator:cheer", cheerData);
      io.to(battleId).emit("cheerMessage", cheerData);
    } catch (err) {
      socket.emit("error", err.message);
    }
  });
  
  socket.on("disconnect", () => {
    console.log(`소켓 연결 해제: ${socket.id}`);
  });
});

// -----------------------------------------------
// 라운드 해결 로직
// -----------------------------------------------
function resolveRound(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  
  pushLog(battleId, "battle", "=== 라운드 해결 시작 ===");
  
  // 행동 수집
  const attacks = [];
  const heals = [];
  const deadPlayers = new Set();
  
  // 플레이어별 ID 맵
  const byId = {};
  b.players.forEach(p => byId[p.id] = p);
  
  // A팀 행동 처리
  let aTeamHasAction = false;
  for (const [pid, sel] of Object.entries(b.round.actions)) {
    const me = byId[pid];
    if (!me || me.team !== "A" || me.hp <= 0) continue;
    
    if (sel.type === "attack") {
      const target = byId[sel.targetId];
      if (target && target.hp > 0 && target.team !== me.team) {
        attacks.push({ attacker: me, target: target });
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}을(를) 공격!`);
        pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [공격] 합니다.`);
        aTeamHasAction = true;
      }
    } else if (sel.type === "defend") {
      pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 태세`);
      pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [방어] 합니다.`);
      b.round.defendToken[pid] = true;
      aTeamHasAction = true;
    } else if (sel.type === "dodge") {
      pushLog(battleId, "battle", `→ ${me.name}이(가) 회피 태세`);
      pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [회피] 합니다.`);
      b.round.dodgeToken[pid] = true;
      aTeamHasAction = true;
    } else if (sel.type === "item") {
      if (sel.item === "dittany" || sel.item === "ditany") {
        const target = byId[sel.targetId] || me;
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}에게 디터니 사용`);
        pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:디터니]를 사용합니다.`);
        heals.push({ who: me, target: target });
        aTeamHasAction = true;
      } else if (sel.item === "attackBooster" || sel.item === "attack_boost") {
        // 수정: 90% 성공률 (기존 10%에서 변경)
        const success = Math.random() < 0.90;
        if (success) {
          b.round.attackBoosters[pid] = sel.targetId;
          const target = byId[sel.targetId];
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 성공! (대상: ${target?.name})`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:공격 보정기] 사용 성공!`);
        } else {
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 실패`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:공격 보정기] 사용 실패`);
        }
        if (me.items.attackBooster > 0) me.items.attackBooster--;
        if (me.items.attack_boost > 0) me.items.attack_boost--;
        aTeamHasAction = true;
      } else if (sel.item === "defenseBooster" || sel.item === "defense_boost") {
        // 수정: 90% 성공률 (기존 10%에서 변경)
        const success = Math.random() < 0.90;
        const target = byId[sel.targetId];
        if (success) {
          b.round.defenseBoosters[sel.targetId] = true;
          pushLog(battleId, "battle", `→ ${me.name}이(가) ${target?.name}에게 방어 보정기 사용 성공!`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:방어 보정기] 사용 성공!`);
        } else {
          pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 보정기 사용 실패`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:방어 보정기] 사용 실패`);
        }
        if (me.items.defenseBooster > 0) me.items.defenseBooster--;
        if (me.items.defense_boost > 0) me.items.defense_boost--;
        aTeamHasAction = true;
      }
    } else if (sel.type === "pass") {
      pushLog(battleId, "battle", `→ ${me.name}이(가) 행동 패스`);
      pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [패스] 합니다.`);
      aTeamHasAction = true;
    }
  }
  
  if (!aTeamHasAction) {
    pushLog(battleId, "battle", "→ A팀 행동 없음");
  }
  pushLog(battleId, "battle", "A팀 선택 완료");
  
  // B팀 행동 처리
  let bTeamHasAction = false;
  for (const [pid, sel] of Object.entries(b.round.actions)) {
    const me = byId[pid];
    if (!me || me.team !== "B" || me.hp <= 0) continue;
    
    if (sel.type === "attack") {
      const target = byId[sel.targetId];
      if (target && target.hp > 0 && target.team !== me.team) {
        attacks.push({ attacker: me, target: target });
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}을(를) 공격!`);
        pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [공격] 합니다.`);
        bTeamHasAction = true;
      }
    } else if (sel.type === "defend") {
      pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 태세`);
      pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [방어] 합니다.`);
      b.round.defendToken[pid] = true;
      bTeamHasAction = true;
    } else if (sel.type === "dodge") {
      pushLog(battleId, "battle", `→ ${me.name}이(가) 회피 태세`);
      pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [회피] 합니다.`);
      b.round.dodgeToken[pid] = true;
      bTeamHasAction = true;
    } else if (sel.type === "item") {
      if (sel.item === "dittany" || sel.item === "ditany") {
        const target = byId[sel.targetId] || me;
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}에게 디터니 사용`);
        pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:디터니]를 사용합니다.`);
        heals.push({ who: me, target: target });
        bTeamHasAction = true;
      } else if (sel.item === "attackBooster" || sel.item === "attack_boost") {
        // 수정: 90% 성공률 (기존 10%에서 변경)
        const success = Math.random() < 0.90;
        const target = byId[sel.targetId];
        if (success) {
          b.round.attackBoosters[pid] = sel.targetId;
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 성공! (대상: ${target?.name})`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:공격 보정기] 사용 성공!`);
        } else {
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 실패`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:공격 보정기] 사용 실패`);
        }
        if (me.items.attackBooster > 0) me.items.attackBooster--;
        if (me.items.attack_boost > 0) me.items.attack_boost--;
        bTeamHasAction = true;
      } else if (sel.item === "defenseBooster" || sel.item === "defense_boost") {
        // 수정: 90% 성공률 (기존 10%에서 변경)
        const success = Math.random() < 0.90;
        const target = byId[sel.targetId];
        if (success) {
          b.round.defenseBoosters[sel.targetId] = true;
          pushLog(battleId, "battle", `→ ${me.name}이(가) ${target?.name}에게 방어 보정기 사용 성공!`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:방어 보정기] 사용 성공!`);
        } else {
          pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 보정기 사용 실패`);
          pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [아이템:방어 보정기] 사용 실패`);
        }
        if (me.items.defenseBooster > 0) me.items.defenseBooster--;
        if (me.items.defense_boost > 0) me.items.defense_boost--;
        bTeamHasAction = true;
      }
    } else if (sel.type === "pass") {
      pushLog(battleId, "battle", `→ ${me.name}이(가) 행동 패스`);
      pushLog(battleId, "notice", `[알림] ${me.name}(이)가 [패스] 합니다.`);
      bTeamHasAction = true;
    }
  }
  
  if (!bTeamHasAction) {
    pushLog(battleId, "battle", "→ B팀 행동 없음");
  }
  pushLog(battleId, "battle", "B팀 선택 완료");
  
  // 결과 계산 로그
  pushLog(battleId, "battle", "=== 라운드 결과 ===");
  
  // 공격 처리 (즉시 사망 처리)
  if (attacks.length === 0) {
    pushLog(battleId, "battle", "→ 공격 없음");
  } else {
    for (const act of attacks) {
      const a = act.attacker, t = act.target;
      if (!t || a.hp <= 0 || t.hp <= 0 || deadPlayers.has(t.id)) continue;
      
      let atkRoll = d20();
      let atkStat = a.stats?.attack || 1;
      
      // 공격 보정기 확인 (해당 턴에만 적용)
      let boosted = false;
      if (b.round.attackBoosters[a.id] === t.id) {
        atkStat *= 2;
        boosted = true;
      }
      
      const attackScore = atkStat + atkRoll;
      
      // 대상이 회피 태세인지 확인
      const isTargetDodging = b.round.dodgeToken[t.id];
      if (isTargetDodging) {
        const tgtDodgeBase = t.stats?.agility || 1;
        const dodgeRoll = d20();
        const dodgeScore = tgtDodgeBase + dodgeRoll;
        
        if (dodgeScore >= attackScore) {
          pushLog(battleId, "battle", `→ ${a.name}의 ${boosted ? '강화된 ' : ''}공격이 ${t.name}에게 빗나감 (회피 성공)`);
          pushLog(battleId, "notice", `${a.name}(이)가 ${t.name}(을)를 공격했지만 회피당했습니다.`);
          continue;
        }
      }
      
      // 치명타 판정
      const critThreshold = 20 - Math.floor((a.stats?.luck || 2) / 2);
      const isCrit = atkRoll >= critThreshold;
      
      let finalDamage = attackScore;
      
      // 수정: 방어 태세를 선택한 경우에만 방어력 적용
      const isTargetDefending = b.round.defendToken[t.id];
      if (isTargetDefending) {
        let defenseValue = t.stats?.defense || 1;
        
        // 방어 보정기 적용 (해당 턴에만)
        if (b.round.defenseBoosters[t.id]) {
          defenseValue *= 2;
        }
        
        finalDamage = Math.max(0, attackScore - defenseValue);
      }
      // 방어 태세가 아니면 공격력 그대로 적용 (방어력 무시)
      
      if (isCrit) finalDamage *= 2;
      
      const oldHp = t.hp;
      t.hp = Math.max(0, oldHp - finalDamage);
      
      const defenseInfo = isTargetDefending ? ' (방어 적용)' : '';
      pushLog(battleId, "battle", `→ ${a.name}이(가) ${t.name}에게 ${finalDamage} 피해${isCrit ? ' (치명타)' : ''}${defenseInfo} (HP ${oldHp} → ${t.hp})`);
      pushLog(battleId, "notice", `${a.name}(이)가 ${t.name}(을)를 공격하여 ${finalDamage} 피해를 입혔습니다.`);
      
      if (t.hp <= 0) {
        deadPlayers.add(t.id);
        pushLog(battleId, "battle", `→ ${t.name} 사망!`);
        pushLog(battleId, "notice", `[사망] ${t.name}(이)가 쓰러졌습니다!`);
      }
    }
  }
  
  // 치유 처리
  if (heals.length === 0) {
    pushLog(battleId, "battle", "→ 치유 없음");
  } else {
    for (const heal of heals) {
      const h = heal.who, t = heal.target;
      if (!t || deadPlayers.has(t.id)) continue;
      
      const oldHp = t.hp;
      t.hp = Math.min(t.maxHp || 100, oldHp + 10);
      
      pushLog(battleId, "battle", `→ ${h.name}이(가) ${t.name}에게 디터니 사용 (+10 HP, ${oldHp} → ${t.hp})`);
      pushLog(battleId, "notice", `${h.name}(이)가 ${t.name}(을)를 치유했습니다.`);
      
      // 아이템 소모
      if (h.items.dittany > 0) h.items.dittany--;
      if (h.items.ditany > 0) h.items.ditany--;
    }
  }
  
  // 승리 조건 체크
  const aTeamAlive = b.players.filter(p => p.team === "A" && p.hp > 0);
  const bTeamAlive = b.players.filter(p => p.team === "B" && p.hp > 0);
  
  if (aTeamAlive.length === 0) {
    b.status = "ended";
    pushLog(battleId, "battle", "=== B팀 승리! ===");
    pushLog(battleId, "notice", "[승부 결정] B팀이 승리했습니다!");
    clearTimer(battleId);
  } else if (bTeamAlive.length === 0) {
    b.status = "ended";
    pushLog(battleId, "battle", "=== A팀 승리! ===");
    pushLog(battleId, "notice", "[승부 결정] A팀이 승리했습니다!");
    clearTimer(battleId);
  } else {
    // 다음 라운드 준비
    b.currentTurn.turnNumber++;
    
    // 선/후공 교대
    if (b.currentTurn.turnNumber % 2 === 1) {
      // 홀수 턴: 원래 선공팀이 선공
      // (이미 결정된 선공팀 유지)
    } else {
      // 짝수 턴: 선공팀 교대
      b.currentTurn.currentTeam = b.currentTurn.currentTeam === "A" ? "B" : "A";
    }
    
    b.currentTurn.timeLeftSec = 300;
    
    // 라운드 상태 초기화 (아이템 효과도 초기화)
    b.round = {
      actions: {},
      defendToken: {},
      dodgeToken: {},
      attackBoosters: {},
      defenseBoosters: {}
    };
    
    pushLog(battleId, "battle", `=== 제${b.currentTurn.turnNumber}라운드 시작 ===`);
    pushLog(battleId, "system", `${b.currentTurn.currentTeam}팀의 턴입니다`);
    
    startTurnTimer(battleId);
  }
  
  broadcastUpdate(battleId);
}

// -----------------------------------------------
// 타이머 관리
// -----------------------------------------------
function startTurnTimer(battleId) {
  clearTimer(battleId);
  
  const timer = setInterval(() => {
    const b = battles.get(battleId);
    if (!b || b.status !== "active") {
      clearTimer(battleId);
      return;
    }
    
    b.currentTurn.timeLeftSec--;
    
    if (b.currentTurn.timeLeftSec <= 0) {
      // 시간 초과 - 미행동 플레이어들 패스 처리
      const currentTeamPlayers = b.players.filter(p => 
        p.team === b.currentTurn.currentTeam && p.hp > 0
      );
      
      for (const player of currentTeamPlayers) {
        if (!b.round.actions[player.id]) {
          b.round.actions[player.id] = { type: "pass" };
          pushLog(battleId, "system", `${player.name} 시간 초과로 자동 패스`);
        }
      }
      
      // 상대팀으로 전환 또는 라운드 해결
      const otherTeam = b.currentTurn.currentTeam === "A" ? "B" : "A";
      const otherTeamPlayers = b.players.filter(p => p.team === otherTeam && p.hp > 0);
      
      if (otherTeamPlayers.length === 0) {
        resolveRound(battleId);
      } else {
        const otherTeamActedPlayers = otherTeamPlayers.filter(p => b.round.actions[p.id]);
        
        if (otherTeamActedPlayers.length >= otherTeamPlayers.length) {
          resolveRound(battleId);
        } else {
          b.currentTurn.currentTeam = otherTeam;
          b.currentTurn.timeLeftSec = 300;
          pushLog(battleId, "system", `${otherTeam}팀의 턴입니다`);
          startTurnTimer(battleId);
        }
      }
      
      broadcastUpdate(battleId);
    }
    
    // 10초마다 업데이트 브로드캐스트
    if (b.currentTurn.timeLeftSec % 10 === 0) {
      broadcastUpdate(battleId);
    }
  }, 1000);
  
  timers.set(battleId, timer);
}

function clearTimer(battleId) {
  const timer = timers.get(battleId);
  if (timer) {
    clearInterval(timer);
    timers.delete(battleId);
  }
}

// -----------------------------------------------
// 서버 시작
// -----------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`=== PYXIS Battle Server ===`);
  console.log(`서버 실행: http://${HOST}:${PORT}`);
  console.log(`소켓 경로: ${SOCKET_PATH}`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`시작 시간: ${new Date().toLocaleString('ko-KR')}`);
  console.log("==========================================");
});

// 종료 처리
process.on('SIGTERM', () => {
  console.log('SIGTERM 신호를 받았습니다. 서버를 종료합니다.');
  server.close(() => {
    console.log('서버가 종료되었습니다.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nCTRL+C 신호를 받았습니다. 서버를 종료합니다.');
  server.close(() => {
    console.log('서버가 종료되었습니다.');
    process.exit(0);
  });
});

export default app;
