const express = require('express');
const http = require('http');
const path = require('path');
const { initializeSocketHandlers } = require('./src/socket/battle-handlers');
const apiRouter = require('./src/api');  // ✅ API 라우터 가져오기

const app = express();
const server = http.createServer(app);

// ✅ JSON 파서 → API 라우터 연결은 HTML 서빙보다 먼저!
app.use(express.json());
app.use('/api', apiRouter);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// HTML 페이지 라우팅
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
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ PYXIS Battle System 서버 실행 중: http://localhost:${PORT}`);
});
