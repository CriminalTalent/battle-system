const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 미들웨어
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// 전투 상태를 저장할 임시 메모리 저장소
const battles = {};
const otps = {}; // { battleId: { role: otp } }

// 헬스체크
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date(),
    activeBattles: Object.keys(battles).length
  });
});

// 전투 생성
app.post("/api/battles", (req, res) => {
  const battleId = "battle_" + uuidv4();
  const battle = {
    id: battleId,
    mode: "1v1",
    status: "waiting",
    teams: {
      team1: { name: "불사조 기사단", players: [] },
      team2: { name: "죽음을 먹는자들", players: [] }
    },
    config: {
      playersPerTeam: 1,
      turnTimeLimit: 300000,
      maxTurns: 50,
      itemsEnabled: true,
      autoStart: true
    },
    currentTeam: "team1",
    currentPlayerIndex: 0,
    turnOrder: [],
    turnNumber: 0,
    roundNumber: 1,
    battleLog: [
      {
        type: "system",
        message: "1v1 전투가 생성되었습니다",
        timestamp: Date.now()
      }
    ],
    chatLog: [],
    createdAt: Date.now(),
    turnStartTime: null,
    winner: null,
    endReason: null
  };

  battles[battleId] = battle;

  res.status(201).json({
    success: true,
    battleId,
    battle
  });
});

// 전투 조회
app.get("/api/battles/:battleId", (req, res) => {
  const battle = battles[req.params.battleId];
  if (!battle) {
    return res.status(404).json({ error: "전투를 찾을 수 없습니다" });
  }
  res.json(battle);
});

// OTP 발급
app.post("/api/admin/battles/:battleId/issue-otp", express.urlencoded({ extended: true }), (req, res) => {
  const { role } = req.body;
  const { battleId } = req.params;

  if (!["admin", "player", "spectator"].includes(role)) {
    return res.status(400).json({ error: "유효하지 않은 역할입니다" });
  }

  const otp = Math.random().toString(36).substr(2, 6).toUpperCase();

  if (!otps[battleId]) otps[battleId] = {};
  otps[battleId][role] = otp;

  res.json({
    success: true,
    otp,
    role,
    expiresIn: "5분"
  });
});

// 🔐 로그인 라우트 추가
app.post("/api/auth/login", express.urlencoded({ extended: true }), (req, res) => {
  const { otp, role, battleId } = req.body;

  if (!otp || !role || !battleId) {
    return res.status(400).json({ error: "OTP, 역할, 전투 ID가 필요합니다." });
  }

  if (!otps[battleId] || !otps[battleId][role]) {
    return res.status(404).json({ error: "OTP 정보가 존재하지 않습니다." });
  }

  if (otps[battleId][role] !== otp) {
    return res.status(401).json({ error: "인증 실패. 올바른 OTP가 아닙니다." });
  }

  return res.json({
    success: true,
    token: `${role.toUpperCase()}-${Date.now()}`
  });
});

// 소켓 연결
io.on("connection", (socket) => {
  console.log("소켓 연결:", socket.id);

  socket.on("disconnect", () => {
    console.log("소켓 연결 해제:", socket.id);
  });
});

// 서버 시작
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("   전투 시스템 서버 시작");
  console.log("========================================");
  console.log(`포트: ${PORT}`);
  console.log(`호스트: ${HOST}`);
  console.log(`환경: ${process.env.NODE_ENV}`);
  console.log(`CORS: *`);
  console.log("========================================");
  console.log("API 엔드포인트:");
  console.log(`- 헬스체크: http://${HOST}:${PORT}/api/health`);
  console.log(`- 전투 생성: POST /api/battles`);
  console.log(`- 전투 조회: GET /api/battles/:battleId`);
  console.log("========================================");
  console.log(`관리자 페이지: http://${HOST}:${PORT}/admin`);
  console.log(`플레이어 페이지: http://${HOST}:${PORT}/play`);
  console.log(`관전자 페이지: http://${HOST}:${PORT}/watch`);
  console.log("========================================");
});
