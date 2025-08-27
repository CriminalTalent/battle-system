// packages/battle-server/src/server.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const BattleEngine = require('./services/BattleEngine');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const battleEngine = new BattleEngine();

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// REST API
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now(), battles: battleEngine.getBattleCount() });
});

app.post('/api/battles', (req, res) => {
  try {
    const { mode, adminId } = req.body;
    const battle = battleEngine.createBattle(mode, adminId);
    res.json({ success: true, battle });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/battles/:id', (req, res) => {
  const battle = battleEngine.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: '전투 없음' });
  res.json(battle);
});

app.post('/api/battles/:id/players', (req, res) => {
  try {
    const player = battleEngine.addPlayer(req.params.id, req.body);
    res.json({ success: true, player });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 소켓 연결
io.on('connection', (socket) => {
  console.log(`[소켓 연결] ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[소켓 종료] ${socket.id}`);
  });

  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }) => {
    const result = battleEngine.adminAuth(battleId, otp);
    if (!result.success) return socket.emit('authError', result.message);
    socket.join(battleId);
    socket.emit('authSuccess', { role: 'admin', battle: result.battle });
  });

  // 플레이어 인증
  socket.on('playerAuth', ({ battleId, otp, playerId }) => {
    const result = battleEngine.playerAuth(battleId, otp, playerId);
    if (!result.success) return socket.emit('authError', result.message);
    socket.join(battleId);
    socket.emit('authSuccess', { role: 'player', battle: result.battle, player: result.player });
  });

  // 관전자 인증
  socket.on('spectatorAuth', ({ battleId, otp, spectatorName }) => {
    const result = battleEngine.spectatorAuth(battleId, otp, spectatorName);
    if (!result.success) return socket.emit('authError', result.message);
    socket.join(battleId);
    socket.emit('authSuccess', { role: 'spectator', battle: result.battle });
  });

  // 플레이어 액션
  socket.on('playerAction', (data) => {
    try {
      const result = battleEngine.executeAction(data.battleId, data.playerId, data);
      io.to(data.battleId).emit('battleUpdate', battleEngine.getBattle(data.battleId));
      socket.emit('actionSuccess', result);
    } catch (err) {
      socket.emit('actionError', err.message);
    }
  });

  // 채팅 메시지
  socket.on('chatMessage', (data) => {
    battleEngine.addChatMessage(data.battleId, data.sender, data.message, data.senderType);
    io.to(data.battleId).emit('battleUpdate', battleEngine.getBattle(data.battleId));
  });

  // 응원 메시지
  socket.on('cheerMessage', (data) => {
    battleEngine.addChatMessage(data.battleId, data.sender, data.message, 'spectator');
    io.to(data.battleId).emit('battleUpdate', battleEngine.getBattle(data.battleId));
  });
});

// 서버 실행
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[서버 시작] 포트 ${PORT}`);
});
