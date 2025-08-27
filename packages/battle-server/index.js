// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const BattleEngine = require("./src/services/BattleEngine"); // ✅ 경로 수정

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const engine = new BattleEngine();

// ===================== REST API =====================

// 헬스 체크
app.get("/api/health", (_, res) => {
  res.json({
    status: "ok",
    battles: engine.battles.size,
    timestamp: new Date().toISOString()
  });
});

// 전투 생성
app.post("/api/battles", (req, res) => {
  try {
    const { mode } = req.body;
    const battle = engine.createBattle(mode);
    res.json(battle);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 전투 조회
app.get("/api/battles/:id", (req, res) => {
  const battle = engine.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not found" });
  res.json(battle);
});

// ===================== Socket.IO =====================
io.on("connection", socket => {
  console.log("[소켓 연결]", socket.id);

  // ---------------- 플레이어 인증 ----------------
  socket.on("playerAuth", ({ battleId, otp, playerId }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.player !== otp) {
      return socket.emit("authError", "잘못된 플레이어 OTP");
    }
    socket.join(battleId);
    engine.updatePlayerConnection(battleId, playerId, true);
    socket.emit("authSuccess", { role: "player", battle });
    console.log(`[플레이어 인증] battle=${battleId}, player=${playerId}`);
  });

  // ---------------- 관리자 인증 ----------------
  socket.on("adminAuth", ({ battleId, otp }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.admin !== otp) {
      return socket.emit("authError", "잘못된 관리자 OTP");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { role: "admin", battle });
    console.log(`[관리자 인증] battle=${battleId}`);
  });

  // ---------------- 관전자 인증 ----------------
  socket.on("spectatorAuth", ({ battleId, otp, name }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.spectator !== otp) {
      return socket.emit("authError", "잘못된 관전자 OTP");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { role: "spectator", battle });
    console.log(`[관전자 인증] battle=${battleId}, name=${name || "관전자"}`);
  });

  // ---------------- 플레이어 액션 ----------------
  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      const result = engine.executeAction(battleId, playerId, action);
      io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
      socket.emit("actionSuccess", result);
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });

  // ---------------- 채팅 ----------------
  socket.on("chatMessage", ({ battleId, sender, message }) => {
    if (!message || !message.trim()) return;
    const battle = engine.getBattle(battleId);
    if (!battle) return;
    engine.addChatMessage(battleId, sender, message.trim());
    io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
  });

  socket.on("disconnect", () => {
    console.log("[소켓 해제]", socket.id);
    // 연결 끊김 상태는 BattleEngine.updatePlayerConnection 에서 관리 가능
  });
});

// ===================== 서버 실행 =====================
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
