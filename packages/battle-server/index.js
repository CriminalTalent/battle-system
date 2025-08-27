// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

// BattleEngine 클래스 (경로 수정됨)
const BattleEngine = require("./src/services/BattleEngine");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const engine = new BattleEngine();

// ========================
// REST API
// ========================
app.get("/api/health", (_, res) =>
  res.json({
    status: "ok",
    battles: engine.getBattleCount(),
    timestamp: new Date().toISOString(),
  })
);

app.post("/api/battles", (req, res) => {
  const { mode } = req.body;
  const battle = engine.createBattle(mode);
  res.json({ success: true, battle });
});

app.get("/api/battles/:id", (req, res) => {
  const battle = engine.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "전투 없음" });
  res.json(battle);
});

// ========================
// Socket.IO
// ========================
io.on("connection", (socket) => {
  console.log("[소켓연결]", socket.id);

  // 관리자 인증
  socket.on("adminAuth", ({ battleId, otp }) => {
    const result = engine.adminAuth(battleId, otp);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.emit("authSuccess", { battle: result.battle });
    console.log("[관리자인증]", socket.id, battleId);
  });

  // 플레이어 인증
  socket.on("playerAuth", ({ battleId, otp, playerId }) => {
    const result = engine.playerAuth(battleId, otp, playerId);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.emit("authSuccess", { battle: result.battle, player: result.player });
    console.log("[플레이어인증]", socket.id, battleId, playerId);
  });

  // 관전자 인증
  socket.on("spectatorAuth", ({ battleId, otp, name }) => {
    const result = engine.spectatorAuth(battleId, otp, name);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.emit("authSuccess", { battle: result.battle });
    console.log("[관전자인증]", socket.id, battleId);
  });

  // 플레이어 행동
  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("[소켓해제]", socket.id);
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
