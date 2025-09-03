const express = require('express');
const http = require('http');
const path = require('path');
const { initializeSocketHandlers } = require('./src/socket/battle-handlers');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 라우팅: HTML 페이지
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/admin.html'));
});
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/play.html'));
});
app.get('/spectator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/pages/spectator.html'));
});
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 소켓 핸들러 초기화
initializeSocketHandlers(server);

// 서버 시작
server.listen(PORT, () => {
  console.log(`✅ PYXIS Battle System 서버 실행 중: http://localhost:${PORT}`);
});
