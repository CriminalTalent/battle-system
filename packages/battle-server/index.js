// packages/battle-server/index.js
'use strict';

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

import { makeSocketHandlers } from './src/socket/socketHandlers.js';
import { registerAvatarRoute } from './src/routes/avatar-upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// ── CORS (도메인 고정)
const ORIGIN = ['https://pyxisbattlesystem.monster', 'http://127.0.0.1:3001', 'http://localhost:3001'];
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json());

// ── 정적 경로
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));

// ── 라우트: 페이지 단축 URL → 실제 파일
const send = (p) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, p));
app.get('/', send('index.html')); // 있으면 사용, 없으면 생략 가능
app.get('/admin', send('pages/admin.html'));
app.get('/play', send('pages/play.html'));
app.get('/watch', send('pages/spectator.html'));

// ── 업로드 라우트
registerAvatarRoute(app);

// ── 헬스체크
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'PYXIS', ts: Date.now() });
});

// ── Socket.IO
const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: ORIGIN, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling']
});

makeSocketHandlers(io, app);

// ── 서버 시작
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('[PYXIS] battle-server listening on :' + PORT);
});
