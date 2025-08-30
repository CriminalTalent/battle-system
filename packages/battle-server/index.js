// Minimal static server for PYXIS Admin/Player/Spectator
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); // 이미 소켓 서버가 있다면 이 부분만 생략 가능
// const favicon = require('serve-favicon'); // svg를 굳이 미들웨어로 줄 필요는 없습니다

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: '*' }
});

// 정적 파일
const PUB = path.join(__dirname, 'public');
app.use('/assets', express.static(path.join(PUB, 'assets'), { maxAge: '1d' }));
app.use('/pages', express.static(path.join(PUB, 'pages'), { maxAge: '1d' }));
app.use(express.json());

// 파비콘(svg) – <link rel="icon" href="/assets/images/favicon.svg"> 로 제공
// app.use(favicon(path.join(PUB, 'assets', 'images', 'favicon.svg'))); // 원하면 사용

// 라우팅: /admin, /play, /spectator
app.get('/', (_req, res) => res.redirect('/admin'));

app.get('/admin', (_req, res) =>
  res.sendFile(path.join(PUB, 'pages', 'admin.html'))
);

app.get('/play', (_req, res) =>
  res.sendFile(path.join(PUB, 'pages', 'play.html'))
);

app.get('/spectator', (_req, res) =>
  res.sendFile(path.join(PUB, 'pages', 'spectator.html'))
);

// 필요 시 기타 API 라우트(이미 다른 서버가 처리하면 생략)
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// (옵션) 소켓 기본 이벤트 – 실제 게임 소켓 서버가 따로 있으면 삭제해도 됨
io.on('connection', (socket) => {
  // 연결만 확인
  socket.emit('chat:new', { type: 'system', text: '소켓 연결됨', ts: Date.now() });
});

// 포트
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[PYXIS] server listening on http://0.0.0.0:${PORT}`);
});
