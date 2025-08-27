// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const BattleEngine = require("./services/BattleEngine");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/socket.io",
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

// 미들웨어
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 (public/admin.html, play.html, watch.html)
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

["admin.html", "play.html", "watch.html"].forEach(file => {
  const filePath = path.join(publicPath, file);
  console.log(fs.existsSync(filePath) ? `[파일확인] ${file}` : `[누락] ${file}`);
});

// BattleEngine 초기화
const engine = new BattleEngine();

// REST API
app.get("/api/health", (_, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    battles: engine.battles.size,
    timestamp: Date.now()
  });
});

app.post("/api/battles", (req, res) => {
  try {
    const { mode } = req.body;
    const battle = engine.createBattle(mode);
    res.json(battle);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/battles/:id", (req, res) => {
  const battle = engine.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not found" });
  res.json(battle);
});

// Socket.IO
io.on("connection", socket => {
  console.log("[소켓 연결]", socket.id);

  // 관리자 인증
  socket.on("adminAuth", ({ battleId, otp }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.admin !== otp) {
      return socket.emit("authError", "관리자 인증 실패");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { role: "admin", battle });
    console.log(`[관리자인증] battleId=${battleId}`);
  });

  // 플레이어 인증
  socket.on("playerAuth", ({ battleId, otp, playerId }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.player !== otp) {
      return socket.emit("authError", "플레이어 인증 실패");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { role: "player", battle });
    console.log(`[플레이어인증] battleId=${battleId}, playerId=${playerId}`);
  });

  // 관전자 인증
  socket.on("spectatorAuth", ({ battleId, otp }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.spectator !== otp) {
      return socket.emit("authError", "관전자 인증 실패");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { role: "spectator", battle });
    console.log(`[관전자인증] battleId=${battleId}`);
  });

  // 플레이어 액션
  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("[소켓 해제]", socket.id);
  });
});

// 서버 시작
httpServer.listen(PORT, HOST, () => {
  console.log("=======================================");
  console.log("   Battle Server Started");
  console.log("=======================================");
  console.log(`Host: ${HOST}`);
  console.log(`Port: ${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
  console.log(`Player: http://localhost:${PORT}/play`);
  console.log(`Spectator: http://localhost:${PORT}/watch`);
  console.log("=======================================");
});
