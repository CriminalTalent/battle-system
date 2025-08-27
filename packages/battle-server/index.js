// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const BattleEngine = require("./services/BattleEngine");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const engine = new BattleEngine();

// REST API
app.get("/api/health", (_, res) => res.json({ status: "ok", battles: engine.battles.size }));
app.post("/api/battles", (req, res) => {
  const { mode } = req.body;
  const battle = engine.createBattle(mode);
  res.json(battle);
});
app.get("/api/battles/:id", (req, res) => {
  const battle = engine.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not found" });
  res.json(battle);
});

// Socket.IO
io.on("connection", socket => {
  console.log("소켓 연결", socket.id);

  socket.on("playerAuth", ({ battleId, otp, playerId }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.player !== otp) return socket.emit("authError", "인증 실패");
    socket.join(battleId);
    socket.emit("authSuccess", { battle });
  });

  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      const result = engine.executeAction(battleId, playerId, action);
      io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });
});

httpServer.listen(3001, () => console.log("서버 실행: http://localhost:3001"));
