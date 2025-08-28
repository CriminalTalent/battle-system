// index.single.js — 단일 파일 서버(프런트/엔드포인트와 완전 호환)
// Express + Socket.IO
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", true); // Nginx 뒤에서 req.protocol이 https로 잡히도록

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
  path: "/socket.io/", // Nginx location과 일치
});

const PORT = process.env.PORT || 3001;

// ───────────────────────────────────────────────────────────────────────────────
// 미들웨어 / 정적
// ───────────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // admin.html, play.html, watch.html

// /admin, /play, /watch로 접속해도 각각 *.html을 서빙 (Nginx 없이도 동작)
app.get(["/admin", "/play", "/watch"], (req, res) => {
  const name = req.path.replace("/", "") + ".html";
  res.sendFile(path.join(__dirname, "public", name));
});

function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// BattleEngine (프런트 기대 구조와 100% 호환)
// ───────────────────────────────────────────────────────────────────────────────
class BattleEngine {
  constructor() {
    this.battles = new Map();
  }
  getBattleCount() { return this.battles.size; }
  // OTP: 대문자 8자
  generateOTP() { return Math.random().toString(36).substr(2, 8).toUpperCase(); }

  createBattle(mode = "1v1", adminId = null) {
    const id = crypto.randomBytes(16).toString("hex");
    const configs = {
      "1v1": { playersPerTeam: 1 },
      "2v2": { playersPerTeam: 2 },
      "3v3": { playersPerTeam: 3 },
      "4v4": { playersPerTeam: 4 }
    };
    const config = configs[mode] || configs["1v1"];

    const battle = {
      id, mode,
      status: "waiting",
      createdAt: Date.now(),
      adminId,
      teams: {
        team1: { name: "불사조 기사단", players: [] },
        team2: { name: "죽음을 먹는자들", players: [] }
      },
      currentTeam: null,
      roundNumber: 1,
      turnNumber: 1,
      turnStartTime: null,
      battleLog: [],
      chatLog: [],
      config,
      winner: null,
      endReason: null,
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        spectator: this.generateOTP()
      },
    };

    this.battles.set(id, battle);
    this.addBattleLog(id, "system", `[전투생성] 모드: ${mode}`);
    return battle;
  }

  getBattle(id) { return this.battles.get(id); }

  // 플레이어 추가
  addPlayer(battleId, { name, team, stats, inventory = [], imageUrl = "" }) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("존재하지 않는 전투");
    if (battle.status !== "waiting") throw new Error("이미 시작된 전투");
    if (!["team1", "team2"].includes(team)) throw new Error("잘못된 팀");

    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam) {
      throw new Error("해당 팀 가득 참");
    }

    // 중복 이름 방지
    const all = [...battle.teams.team1.players, ...battle.teams.team2.players];
    if (all.some(p => p.name === name)) throw new Error("중복된 이름");

    const clamp = v => Math.max(1, Math.min(5, v || 2));
    const player = {
      id: crypto.randomBytes(8).toString("hex"),
      name,
      team,
      stats: {
        attack: clamp(stats?.attack),
        defense: clamp(stats?.defense),
        agility: clamp(stats?.agility),
        luck: clamp(stats?.luck)
      },
      inventory,
      imageUrl,
      hp: 100, maxHp: 100, alive: true,
      hasActed: false, isReady: false,
      isDefending: false, isDodging: false,
      buffs: {},
    };
    targetTeam.players.push(player);
    this.addBattleLog(battleId, "system", `${player.name}이 ${targetTeam.name}에 참가`);
    return player;
  }

  // 전투 시작/종료
  startBattle(battleId) {
    const b = this.getBattle(battleId);
    if (!b) throw new Error("전투 없음");
    if (b.status !== "waiting") throw new Error("이미 시작됨");
    this.determineFirstTeam(b);
    b.status = "ongoing";
    b.turnStartTime = Date.now();
    this.addBattleLog(battleId, "system", "전투 시작!");
    return b;
  }

  endBattle(battleId, winner = null, reason = "") {
    const b = this.getBattle(battleId);
    if (!b) throw new Error("전투 없음");
    b.status = "ended";
    b.winner = winner;
    b.endReason = reason || "전투 종료";
    b.endedAt = Date.now();
    if (winner) {
      this.addBattleLog(battleId, "system", `${b.teams[winner]?.name || winner} 팀 승리!`);
    } else {
      this.addBattleLog(battleId, "system", reason || "무승부");
    }
    return b;
  }

  determineFirstTeam(b) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    const t1 = b.teams.team1.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    const t2 = b.teams.team2.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    if (t1 > t2) {
      b.currentTeam = "team1";
      this.addBattleLog(b.id, "system", `${b.teams.team1.name} 선공`);
    } else if (t2 > t1) {
      b.currentTeam = "team2";
      this.addBattleLog(b.id, "system", `${b.teams.team2.name} 선공`);
    } else {
      this.addBattleLog(b.id, "system", "동점! 재굴림");
      this.determineFirstTeam(b);
    }
  }

  // 액션
  rollDice(max = 20) { return Math.floor(Math.random() * max) + 1; }
  findPlayer(b, id) { return [...b.teams.team1.players, ...b.teams.team2.players].find(p => p.id === id); }

  executeAction(battleId, playerId, action) {
    const b = this.getBattle(battleId);
    if (!b || b.status !== "ongoing") throw new Error("진행 중 아님");
    const p = this.findPlayer(b, playerId);
    if (!p || !p.alive) throw new Error("행동 불가");
    if (p.team !== b.currentTeam) throw new Error("턴 아님");
    if (p.hasActed) throw new Error("이미 행동");

    switch (action.type) {
      case "attack": this.attack(b, p, action.targetId); break;
      case "defend": this.defend(b, p); break;
      case "dodge":  this.dodge(b, p); break;
      case "item":   this.useItem(b, p, action.itemType, action.targetId); break;
      case "pass":   this.addBattleLog(b.id, "action", `${p.name} 패스`); break;
      default: throw new Error("알 수 없는 액션");
    }
    p.hasActed = true;
  }

  attack(b, attacker, targetId) {
    const t = this.findPlayer(b, targetId);
    if (!t || !t.alive) throw new Error("대상 없음");
    let dmg = attacker.stats.attack + this.rollDice(20);
    if (attacker.buffs.attack_buff) dmg = Math.floor(dmg * 1.5);
    if (t.isDefending) {
      let def = t.stats.defense;
      if (t.buffs.defense_buff) def = Math.floor(def * 1.5);
      dmg = Math.max(1, dmg - def);
    }
    const crit = this.rollDice(20) >= 20 - Math.floor(attacker.stats.luck / 2);
    if (crit) dmg *= 2;
    t.hp = Math.max(0, t.hp - dmg);
    if (t.hp === 0) t.alive = false;
    this.addBattleLog(b.id, "action", `${attacker.name} → ${t.name} ${dmg} 피해`);
    return { damage: dmg, crit, targetAlive: t.alive };
  }

  defend(b, p) { p.isDefending = true; this.addBattleLog(b.id, "action", `${p.name} 방어`); }
  dodge(b, p) { p.isDodging  = true; this.addBattleLog(b.id, "action", `${p.name} 회피`); }

  useItem(b, p, itemType, targetId) {
    const idx = p.inventory.indexOf(itemType);
    if (idx === -1) throw new Error("아이템 없음");
    p.inventory.splice(idx, 1);

    if (itemType === "디터니") {
      const t = targetId ? this.findPlayer(b, targetId) : p;
      if (!t) throw new Error("대상 없음");
      t.hp = Math.min(t.maxHp, t.hp + 10);
      this.addBattleLog(b.id, "action", `${p.name} → ${t.name} HP +10`);
      return;
    }
    if (itemType === "공격 보정기") { p.buffs.attack_buff  = true; this.addBattleLog(b.id, "action", `${p.name} 공격력 버프`); return; }
    if (itemType === "방어 보정기") { p.buffs.defense_buff = true; this.addBattleLog(b.id, "action", `${p.name} 방어력 버프`); return; }
    throw new Error("알 수 없는 아이템");
  }

  addBattleLog(battleId, type, message) {
    const b = this.getBattle(battleId);
    if (!b) return;
    b.battleLog.push({ type, message, timestamp: Date.now() });
    if (b.battleLog.length > 100) b.battleLog.shift();
  }

  addChatMessage(battleId, sender, message, senderType = "player") {
    const b = this.getBattle(battleId);
    if (!b) return;
    b.chatLog.push({ sender, message, senderType, timestamp: Date.now() });
    if (b.chatLog.length > 50) b.chatLog.shift();
  }

  // 인증
  adminAuth(battleId, otp) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: "전투 없음" };
    if (b.otps.admin !== otp) return { success: false, message: "OTP 불일치" };
    return { success: true, battle: b };
  }
  playerAuth(battleId, otp, playerId) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: "전투 없음" };
    if (b.otps.player !== otp) return { success: false, message: "OTP 불일치" };
    const player = this.findPlayer(b, playerId);
    if (!player) return { success: false, message: "플레이어 없음" };
    return { success: true, battle: b, player };
  }
  spectatorAuth(battleId, otp, name) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: "전투 없음" };
    if (b.otps.spectator !== otp) return { success: false, message: "OTP 불일치" };
    return { success: true, battle: b, spectator: { name: name || "관전자" } };
  }
}
const engine = new BattleEngine();

// ───────────────────────────────────────────────────────────────────────────────
// REST API (프런트와 합치기)
// ───────────────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: Date.now(), battles: engine.getBattleCount() });
});

// 배틀 생성 → battle 객체 자체를 반환(최상위에 id 존재)
app.post("/api/battles", (req, res) => {
  try {
    const { mode = "1v1", adminId = null } = req.body || {};
    const battle = engine.createBattle(mode, adminId);
    res.status(201).json(battle);
  } catch (e) {
    console.error("[POST /api/battles] error", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// 배틀 조회
app.get("/api/battles/:id", (req, res) => {
  try {
    const b = engine.getBattle(req.params.id);
    if (!b) return res.status(404).json({ error: "battle_not_found", id: req.params.id });
    res.json(b);
  } catch (e) {
    res.status(500).json({ error: "internal_error" });
  }
});

// 플레이어 등록
app.post("/api/battles/:id/players", (req, res) => {
  try {
    const { id } = req.params;
    const { name = null, team = "team1", stats = {}, inventory = [], imageUrl = "" } = req.body || {};
    const player = engine.addPlayer(id, { name: name || "플레이어", team, stats, inventory, imageUrl });
    res.status(201).json({ ok: true, player, battleId: id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 관리자: 링크(토큰) 반환
app.post("/api/admin/battles/:id/links", (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.getBattle(id);
    if (!b) return res.status(404).json({ error: "battle_not_found", id });
    const base = baseUrlFromReq(req);
    res.json({
      id,
      otps: b.otps,
      urls: {
        admin:     `${base}/admin?battle=${id}&token=${b.otps.admin}`,
        player:    `${base}/play?battle=${id}&token=${b.otps.player}`,
        spectator: `${base}/watch?battle=${id}&token=${b.otps.spectator}`,
      }
    });
  } catch (e) {
    res.status(500).json({ error: "internal_error" });
  }
});

// 관리자: 전투 시작 (관리 UI 호환)
app.post("/api/admin/battles/:id/start", (req, res) => {
  try {
    const { id } = req.params;
    const b = engine.startBattle(id);
    res.json({ ok: true, battle: b });
  } catch (e) {
    const status = /전투 없음/.test(e.message) ? 404 : 400;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// 관리자: 전투 종료(삭제)
app.post("/api/admin/battles/:id/end", (req, res) => {
  try {
    const { id } = req.params;
    const exists = !!engine.getBattle(id);
    if (!exists) return res.status(404).json({ error: "battle_not_found", id });
    engine.endBattle(id, null, "관리자 종료");
    engine.battles.delete(id);
    res.json({ ok: true, ended: id });
  } catch (e) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Socket.IO
// ───────────────────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  // 관리자 인증
  socket.on("adminAuth", ({ battleId, otp }) => {
    const r = engine.adminAuth(battleId, otp);
    if (!r.success) return socket.emit("authError", r.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "admin";
    socket.emit("authSuccess", { role: "admin", battle: r.battle });
  });

  // 플레이어 인증 (otp 키 이름 호환: otp | playerOTP 둘 다 허용)
  socket.on("playerAuth", ({ battleId, playerId, otp, playerOTP }) => {
    const r = engine.playerAuth(battleId, otp ?? playerOTP, playerId);
    if (!r.success) return socket.emit("authError", r.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "player";
    socket.playerId = playerId;
    socket.emit("authSuccess", { role: "player", battle: r.battle, player: r.player });
    io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
  });

  // 관전자 인증
  socket.on("spectatorAuth", ({ battleId, otp, spectatorName }) => {
    const r = engine.spectatorAuth(battleId, otp, spectatorName);
    if (!r.success) return socket.emit("authError", r.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "spectator";
    socket.spectatorName = spectatorName || "관전자";
    socket.emit("authSuccess", { role: "spectator", battle: r.battle });
  });

  // 플레이어 액션
  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
      socket.emit("actionSuccess");
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });

  // 채팅 / 응원
  socket.on("chatMessage", ({ message }) => {
    if (!socket.battleId || !message) return;
    let sender = "알 수 없음";
    let senderType = socket.role || "system";
    if (socket.role === "player") {
      const b = engine.getBattle(socket.battleId);
      const p = b ? engine.findPlayer(b, socket.playerId) : null;
      sender = p ? p.name : "플레이어";
    } else if (socket.role === "spectator") {
      sender = socket.spectatorName || "관전자";
    } else if (socket.role === "admin") {
      sender = "관리자";
    }
    engine.addChatMessage(socket.battleId, sender, message, senderType);
    io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
  });

  socket.on("cheerMessage", ({ message }) => {
    if (!socket.battleId || socket.role !== "spectator") return;
    const allowed = ["힘내!", "지지 마!", "이길 수 있어!", "화이팅!"];
    if (!allowed.includes(message)) return socket.emit("chatError", "허용되지 않은 응원 메시지입니다");
    engine.addChatMessage(socket.battleId, socket.spectatorName || "관전자", message, "spectator");
    io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
  });

  socket.on("disconnect", () => {
    // 연결 종료 시 별도 정리 필요하면 여기에
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 시작
// ───────────────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("========================================");
  console.log("   전투 시스템 서버 실행 중");
  console.log("========================================");
  console.log(`포트: ${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || "development"}`);
  console.log("----------------------------------------");
  console.log(`헬스체크: http://localhost:${PORT}/api/health`);
  console.log(`관리자 페이지: http://localhost:${PORT}/admin.html`);
  console.log(`플레이어 페이지: http://localhost:${PORT}/play.html`);
  console.log(`관전자 페이지: http://localhost:${PORT}/watch.html`);
  console.log("========================================");
});

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));