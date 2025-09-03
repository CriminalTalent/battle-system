// packages/battle-server/index.js

const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const socketHandlers = require('./src/socket/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3001;

// 정적 파일 서비스
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 소켓 핸들러 초기화
socketHandlers(io);

// 서버 시작
server.listen(PORT, () => {
  console.log(`Battle System 서버 실행 중: http://localhost:${PORT}`);
});
