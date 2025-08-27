const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const BattleEngine = require("./services/BattleEngine");
const battleEngine = new BattleEngine();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ============================
// 헬스체크
// ============================
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    battles: battleEngine.battles.size,
    timestamp: new Date()
  });
});

// ============================
// 전투 생성
// ============================
app.post("/api/battles", (req, res) => {
  const { mode } = req.body;
  try {
    const battle = battleEngine.createBattle(mode || "1v1");
    res.status(201).json({ success: true, battle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 전투 조회
app.get("/api/battles/:id", (req, res) => {
  const battle = battleEngine.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "전투 없음" });
  res.json({ success: true, battle });
});

// 플레이어 추가
app.post("/api/battles/:id/players", (req, res) => {
  const { name, team, stats, inventory, imageUrl } = req.body;
  try {
    const player = battleEngine.addPlayer(req.params.id, {
      name, team, stats, inventory, imageUrl
    });
    const battle = battleEngine.getBattle(req.params.id);
    io.to(req.params.id).emit("battleUpdate", battle);
    res.json({ success: true, player });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================
// 소켓 이벤트
// ============================
io.on("connection", (socket) => {
  console.log("소켓 연결:", socket.id);

  // 인증 후 방 참가
  socket.on("adminAuth", ({ battleId, otp }) => {
    const battle = battleEngine.getBattle(battleId);
    if (!battle) return socket.emit("authError", { message: "전투 없음" });
    socket.join(battleId);
    socket.emit("authSuccess", { battle });
  });

  socket.on("playerAuth", ({ battleId, playerId }) => {
    const battle = battleEngine.getBattle(battleId);
    if (!battle) return socket.emit("authError", { message: "전투 없음" });
    socket.join(battleId);
    socket.emit("authSuccess", { battle });
  });

  socket.on("spectatorAuth", ({ battleId }) => {
    const battle = battleEngine.getBattle(battleId);
    if (!battle) return socket.emit("authError", { message: "전투 없음" });
    socket.join(battleId);
    socket.emit("authSuccess", { battle });
  });

  // 액션 처리
  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      const result = battleEngine.executeAction(battleId, playerId, action);
      const battle = battleEngine.getBattle(battleId);
      io.to(battleId).emit("battleUpdate", battle);
      socket.emit("actionResult", result);
    } catch (err) {
      socket.emit("actionError", { error: err.message });
    }
  });

  // 채팅
  socket.on("chatMessage", ({ battleId, sender, message, senderType }) => {
    battleEngine.addChatMessage(battleId, sender, message, senderType);
    io.to(battleId).emit("chatMessage", {
      sender, message, senderType, timestamp: Date.now()
    });
  });

  // 응원 메시지
  socket.on("cheerMessage", ({ battleId, message }) => {
    io.to(battleId).emit("chatMessage", {
      sender: "관전자",
      message,
      senderType: "spectator",
      timestamp: Date.now()
    });
  });

  socket.on("disconnect", () => {
    console.log("소켓 해제:", socket.id);
  });
});

// ============================
// 서버 시작
// ============================
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`전투 시스템 서버 실행: http://${HOST}:${PORT}`);
});
