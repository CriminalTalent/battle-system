const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========================
// BattleEngine 클래스
// ========================
class BattleEngine {
  constructor() {
    this.battles = new Map();
  }

  createBattle(mode = "1v1", adminId = null) {
    const battleId = crypto.randomBytes(4).toString("hex");
    const otps = {
      admin: crypto.randomBytes(3).toString("hex"),
      players: [],
      spectators: crypto.randomBytes(2).toString("hex"),
    };

    const battle = {
      id: battleId,
      mode,
      status: "ready",
      adminId,
      otps,
      players: [],
      spectators: [],
      turn: 0,
      chat: [],
    };

    const maxPlayers = mode === "1v1" ? 2 : 4;
    for (let i = 0; i < maxPlayers; i++) {
      const playerId = crypto.randomBytes(2).toString("hex");
      const playerOTP = crypto.randomBytes(3).toString("hex");
      battle.players.push({
        id: playerId,
        otp: playerOTP,
        name: `플레이어${i + 1}`,
        hp: 100,
        mp: 50,
        status: "idle",
        connected: false,
      });
      otps.players.push(playerOTP);
    }

    this.battles.set(battleId, battle);
    return battle;
  }

  getBattle(battleId) {
    return this.battles.get(battleId);
  }

  adminAuth(battleId, otp) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.otps.admin !== otp) {
      return { success: false, message: "관리자 인증 실패" };
    }
    return { success: true, battle };
  }

  playerAuth(battleId, playerId, otp) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    const player = battle.players.find((p) => p.id === playerId && p.otp === otp);
    if (!player) return { success: false, message: "플레이어 인증 실패" };
    return { success: true, battle, player };
  }

  spectatorAuth(battleId, otp, name) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.otps.spectators !== otp) {
      return { success: false, message: "관전자 인증 실패" };
    }
    battle.spectators.push(name);
    return { success: true, battle };
  }

  executeAction(battleId, playerId, action) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("전투 없음");

    const player = battle.players.find((p) => p.id === playerId);
    if (!player) throw new Error("플레이어 없음");

    switch (action.type) {
      case "attack":
        this.attack(battle, playerId);
        break;
      case "defend":
        this.defend(player);
        break;
      case "dodge":
        this.dodge(player);
        break;
      case "useItem":
        this.useItem(player, action.item);
        break;
      default:
        throw new Error("알 수 없는 행동");
    }

    battle.turn += 1;
  }

  attack(battle, attackerId) {
    const attacker = battle.players.find((p) => p.id === attackerId);
    const target = battle.players.find((p) => p.id !== attackerId);
    if (!target) return;

    const damage = Math.floor(Math.random() * 20) + 5;
    target.hp = Math.max(0, target.hp - damage);
    attacker.status = "attacking";
  }

  defend(player) {
    player.status = "defending";
  }

  dodge(player) {
    player.status = "dodging";
  }

  useItem(player, item) {
    if (item === "heal") {
      player.hp = Math.min(100, player.hp + 20);
    }
  }

  addChatMessage(battleId, sender, message, role = "system") {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.chat.push({
      sender,
      message,
      role,
      timestamp: Date.now(),
    });
  }

  findPlayer(battle, playerId) {
    return battle.players.find((p) => p.id === playerId);
  }

  updatePlayerConnection(battleId, playerId, connected) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    const player = this.findPlayer(battle, playerId);
    if (player) {
      player.connected = connected;
    }
  }
}

// ========================
// BattleEngine 인스턴스 생성
// ========================
const engine = new BattleEngine();

// ========================
// API 엔드포인트
// ========================
app.post("/api/battles", (req, res) => {
  try {
    const { mode, adminId } = req.body;
    const battle = engine.createBattle(mode, adminId);
    res.json({ success: true, battle });
  } catch (error) {
    console.error("전투 생성 실패:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 헬스체크 엔드포인트
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ========================
// Socket.IO
// ========================
io.on("connection", (socket) => {
  console.log("[소켓연결]", socket.id);

  socket.on("adminAuth", ({ battleId, otp }) => {
    const result = engine.adminAuth(battleId, otp);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "admin";
    socket.emit("authSuccess", { role: "admin", battle: result.battle });
  });

  socket.on("playerAuth", ({ battleId, playerId, playerOTP }) => {
    const result = engine.playerAuth(battleId, playerId, playerOTP);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.playerId = playerId;
    socket.role = "player";
    engine.updatePlayerConnection(battleId, playerId, true);
    socket.emit("authSuccess", { role: "player", battle: result.battle, player: result.player });
    io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
  });

  socket.on("spectatorAuth", ({ battleId, otp, spectatorName }) => {
    const result = engine.spectatorAuth(battleId, otp, spectatorName);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "spectator";
    socket.spectatorName = spectatorName;
    socket.emit("authSuccess", { role: "spectator", battle: result.battle });
  });

  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      const battle = engine.getBattle(battleId);
      io.to(battleId).emit("battleUpdate", battle);
      socket.emit("actionSuccess");
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });

  socket.on("chatMessage", ({ message }) => {
    if (!socket.battleId || !message) return;

    let senderName = "알 수 없음";
    if (socket.role === "player") {
      const battle = engine.getBattle(socket.battleId);
      const player = engine.findPlayer(battle, socket.playerId);
      senderName = player ? player.name : "플레이어";
    } else if (socket.role === "spectator") {
      senderName = socket.spectatorName || "관전자";
    } else if (socket.role === "admin") {
      senderName = "관리자";
    }

    engine.addChatMessage(socket.battleId, senderName, message, socket.role);
    io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
  });

  socket.on("cheerMessage", ({ message }) => {
    if (!socket.battleId || socket.role !== "spectator") return;

    const allowedCheers = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    if (!allowedCheers.includes(message)) {
      socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
      return;
    }

    engine.addChatMessage(socket.battleId, socket.spectatorName || "관전자", message, "spectator");
    io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
  });

  socket.on("disconnect", () => {
    console.log("[소켓해제]", socket.id);
    if (socket.role === "player" && socket.battleId && socket.playerId) {
      engine.updatePlayerConnection(socket.battleId, socket.playerId, false);
      io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
    }
  });
});

// ========================
// 서버 실행
// ========================
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
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
