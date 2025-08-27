// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

// BattleEngine 클래스 불러오기
const BattleEngine = require("./src/services/BattleEngine");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 제공 (public 디렉토리)
app.use(express.static(path.join(__dirname, "public")));

const engine = new BattleEngine();

// ================================
// REST API
// ================================

// 헬스체크
app.get("/api/health", (_, res) =>
  res.json({
    status: "ok",
    battles: engine.battles.size,
    timestamp: new Date().toISOString(),
  })
);

// 전투 생성
app.post("/api/battles", (req, res) => {
  try {
    const { mode } = req.body;
    const battle = engine.createBattle(mode);

    res.json({
      success: true,
      battleId: battle.id,
      battle,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// 전투 조회
app.get("/api/battles/:id", (req, res) => {
  const battle = engine.getBattle(req.params.id);
  if (!battle) {
    return res.status(404).json({ success: false, error: "전투를 찾을 수 없습니다." });
  }
  res.json({ success: true, battle });
});

// ================================
// Socket.IO
// ================================
io.on("connection", (socket) => {
  console.log("[소켓 연결] ID:", socket.id);

  // 플레이어 인증
  socket.on("playerAuth", ({ battleId, otp, playerId }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.player !== otp) {
      return socket.emit("authError", "인증 실패");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { battle });
    console.log(`[플레이어 인증 성공] 전투: ${battleId}, 플레이어: ${playerId}`);
  });

  // 플레이어 행동
  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
    } catch (err) {
      socket.emit("actionError", err.message);
    }
  });

  // 연결 해제
  socket.on("disconnect", () => {
    console.log("[소켓 해제] ID:", socket.id);
  });
});

// ================================
// 서버 실행
// ================================
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
