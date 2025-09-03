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

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─────────────────────────────────────────────
// 라우팅 추가: Clean URL → HTML 페이지 연결
// ─────────────────────────────────────────────

// http://도메인/admin  → admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/admin.html'));
});

// http://도메인/play  → play.html
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/play.html'));
});

// http://도메인/spectator  → spectator.html
app.get('/spectator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/spectator.html'));
});

// 루트 접근 시 선택적으로 index.html 또는 admin으로 리디렉션
app.get('/', (req, res) => {
  res.redirect('/admin'); // or: res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 헬스 체크 API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ─────────────────────────────────────────────
// 소켓 핸들러 연결
// ─────────────────────────────────────────────
socketHandlers(io);

// 서버 시작
server.listen(PORT, () => {
  console.log(`✅ PYXIS Battle System 서버 실행 중: http://localhost:${PORT}`);
});
