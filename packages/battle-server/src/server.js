const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 기본 설정
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 전역 상태 저장 (예시)
const battles = {};
const otps = {};

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date(),
    activeBattles: Object.keys(battles).length
  });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  const battleId = `battle_${crypto.randomUUID()}`;
  const battle = {
    id: battleId,
    mode: '1v1',
    status: 'waiting',
    teams: {
      team1: { name: '불사조 기사단', players: [] },
      team2: { name: '죽음을 먹는자들', players: [] }
    },
    config: {
      playersPerTeam: 1,
      turnTimeLimit: 300000,
      maxTurns: 50,
      itemsEnabled: true,
      autoStart: true
    },
    currentTeam: 'team1',
    currentPlayerIndex: 0,
    turnOrder: [],
    turnNumber: 0,
    roundNumber: 1,
    battleLog: [{
      type: 'system',
      message: '1v1 전투가 생성되었습니다',
      timestamp: Date.now()
    }],
    chatLog: [],
    createdAt: Date.now(),
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
app.get('/api/battles/:battleId', (req, res) => {
  const battle = battles[req.params.battleId];
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json(battle);
});

// 관리자 OTP 발급
app.post('/api/admin/battles/:battleId/issue-otp', (req, res) => {
  const { role } = req.body;
  const battleId = req.params.battleId;

  if (!['admin', 'player', 'spectator'].includes(role)) {
    return res.status(400).json({ error: '유효하지 않은 역할입니다' });
  }

  const otp = Math.random().toString(36).substring(2, 8).toUpperCase();

  otps[otp] = {
    role,
    battleId,
    expiresAt: Date.now() + 5 * 60 * 1000 // 5분 후 만료
  };

  res.json({ success: true, otp, role, expiresIn: '5분' });
});

// 인증 및 로그인 처리
app.post('/api/auth/login', (req, res) => {
  const { otp, role } = req.body;

  if (!otp || !role) {
    return res.status(400).json({ error: 'OTP 또는 역할이 누락되었습니다.' });
  }

  const found = otps[otp];

  if (!found || found.role !== role || found.expiresAt < Date.now()) {
    return res.status(401).json({ error: '인증 실패' });
  }

  return res.json({ success: true, token: `${role}-token`, battleId: found.battleId });
});

// 정적 파일 제공 (admin, play, watch 페이지)
const publicPath = path.join(__dirname, '../public');
app.use('/admin', express.static(path.join(publicPath, 'admin')));
app.use('/play', express.static(path.join(publicPath, 'play')));
app.use('/watch', express.static(path.join(publicPath, 'watch')));

// 소켓 연결 예시
io.on('connection', (socket) => {
  console.log('소켓 연결:', socket.id);

  socket.on('disconnect', () => {
    console.log('소켓 연결 해제:', socket.id);
  });
});

// 서버 시작
server.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('   전투 시스템 서버 시작');
  console.log('========================================');
  console.log(`포트: ${PORT}`);
  console.log(`호스트: ${HOST}`);
  console.log(`환경: ${process.env.NODE_ENV}`);
  console.log(`CORS: ${CORS_ORIGIN}`);
  console.log('========================================');
  console.log('API 엔드포인트:');
  console.log(`- 헬스체크: http://${HOST}:${PORT}/api/health`);
  console.log('- 전투 생성: POST /api/battles');
  console.log('- 전투 조회: GET /api/battles/:battleId');
  console.log('========================================');
  console.log(`관리자 페이지: http://${HOST}:${PORT}/admin`);
  console.log(`플레이어 페이지: http://${HOST}:${PORT}/play`);
  console.log(`관전자 페이지: http://${HOST}:${PORT}/watch`);
  console.log('========================================');
});
