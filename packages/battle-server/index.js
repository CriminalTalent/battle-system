// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

// BattleEngine 클래스
const BattleEngine = require("./src/services/BattleEngine");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 제공
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
    return res
      .status(404)
      .json({ success: false, error: "전투를 찾을 수 없습니다." });
  }
  res.json({ success: true, battle });
});

// 전투 목록 조회
app.get("/api/battles", (req, res) => {
  try {
    const battles = Array.from(engine.battles.values()).map((battle) => ({
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      createdAt: battle.createdAt,
      playerCount:
        battle.teams.team1.players.length + battle.teams.team2.players.length,
      maxPlayers: battle.config.playersPerTeam * 2,
    }));

    res.json({ success: true, battles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 링크 재발급
app.post("/api/admin/battles/:id/links", (req, res) => {
  const battle = engine.getBattle(req.params.id);
  if (!battle) {
    return res
      .status(404)
      .json({ success: false, error: "전투를 찾을 수 없습니다." });
  }

  // OTP 새로 생성
  battle.otps = {
    admin: Math.random().toString(36).substr(2, 6).toUpperCase(),
    player: Math.random().toString(36).substr(2, 6).toUpperCase(),
    spectator: Math.random().toString(36).substr(2, 6).toUpperCase(),
  };

  res.json({
    success: true,
    tokens: battle.otps,
    urls: {
      admin: `/admin?token=${battle.otps.admin}&battle=${battle.id}`,
      player: `/play?token=${battle.otps.player}&battle=${battle.id}`,
      spectator: `/watch?token=${battle.otps.spectator}&battle=${battle.id}`,
    },
  });
});

// 전투 시작
app.post("/api/admin/battles/:id/start", (req, res) => {
  try {
    const battle = engine.startBattle(req.params.id);
    res.json({ success: true, battle });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 전투 강제 종료
app.post("/api/admin/battles/:id/end", (req, res) => {
  try {
    const { winner = null } = req.body;
    engine.endBattle(req.params.id, winner, "관리자가 강제 종료했습니다.");
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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

  // 관리자 인증
  socket.on("adminAuth", ({ battleId, otp }) => {
    const battle = engine.getBattle(battleId);
    if (!battle || battle.otps.admin !== otp) {
      return socket.emit("authError", "잘못된 관리자 OTP입니다.");
    }
    socket.join(battleId);
    socket.emit("authSuccess", { role: "admin", battle });
    console.log(`[관리자 인증 성공] 전투: ${battleId}`);
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
// 라우트: /admin, /play, /watch → html 파일 연결
// ================================
app.get("/admin", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html"))
);
app.get("/play", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "play.html"))
);
app.get("/watch", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "watch.html"))
);

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
