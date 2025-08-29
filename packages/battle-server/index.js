// index.js - Battle Server Entry
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');

// 채팅 모듈
const { initChat } = require('./src/socket/chat');

// Express app
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================ Storage ==================
const battles = {}; // in-memory 전투 관리

// ================== Utils ==================
function newId(prefix) {
  return prefix + '_' + Math.random().toString(36).substr(2, 9);
}
function now() {
  return Date.now();
}

// ================== Multer ==================
const upload = multer({ dest: path.join(__dirname, 'uploads/') });
app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  try {
    const { id } = req.params;
    if (!battles[id]) return res.status(404).json({ ok: false, message: '전투 없음' });
    if (!req.file) return res.status(400).json({ ok: false, message: '파일 없음' });

    battles[id].avatar = req.file.filename;
    res.json({ ok: true, file: req.file.filename });
  } catch (e) {
    console.error('[POST /api/battles/:id/avatar]', e);
    res.status(500).json({ ok: false, message: '업로드 실패' });
  }
});

// ================== Admin API ==================

// 전투 생성
app.post('/api/admin/battles', (req, res) => {
  try {
    const { mode } = req.body;
    if (!mode) return res.json({ ok: false, message: 'mode 필요' });

    const battleId = newId('battle');
    battles[battleId] = {
      id: battleId,
      mode,
      createdAt: now(),
      teamA: { name: '불사조 기사단', players: [] },
      teamB: { name: '죽음을 먹는 자들', players: [] },
      otp: { players: {}, spectator: { value: newId('spec') } },
      state: 'created'
    };

    res.json({ ok: true, battleId });
  } catch (e) {
    console.error('[POST /api/admin/battles]', e);
    res.status(500).json({ ok: false, message: '생성 실패' });
  }
});

// 전투 링크 발급
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = battles[id];
    if (!b) return res.status(404).json({ ok: false, message: '전투 없음' });

    const base = process.env.BASE_URL || 'http://localhost:3001';
    const playUrl = new URL('/play', base);
    playUrl.searchParams.set('battle', b.id);
    playUrl.searchParams.set('token', newId('pTok'));
    playUrl.searchParams.set('name', '플레이어');
    playUrl.searchParams.set('pid', newId('p'));

    const watchUrl = new URL('/watch', base);
    watchUrl.searchParams.set('battle', b.id);
    // spectator token 안정적으로
    const specTok = (b.otp && b.otp.spectator && b.otp.spectator.value) || '';
    watchUrl.searchParams.set('token', specTok);

    res.json({
      ok: true,
      play: playUrl.toString(),
      watch: watchUrl.toString(),
      admin: `${base}/admin?battle=${b.id}`
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links]', e);
    res.status(500).json({ ok: false, message: '링크 발급 실패' });
  }
});

// 전투 시작
app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const { id } = req.params;
    const b = battles[id];
    if (!b) return res.status(404).json({ ok: false, message: '전투 없음' });
    b.state = 'started';
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/start]', e);
    res.status(500).json({ ok: false, message: '시작 실패' });
  }
});

// 전투 종료
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const b = battles[id];
    if (!b) return res.status(404).json({ ok: false, message: '전투 없음' });
    b.state = 'ended';
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/end]', e);
    res.status(500).json({ ok: false, message: '종료 실패' });
  }
});

// ================== Health Check ==================
app.get('/api/health', (req, res) => res.json({ ok: true, ts: now() }));

// ================== HTTP/Socket.io ==================
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 30000,
  allowEIO3: true
});

// 채팅 초기화
initChat(io, {
  pushChat: (battleId, entry) => {
    try {
      const dir = path.join(__dirname, 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `chat-${battleId}.log`);
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('[chatLogWrite]', e);
    }
  }
});

// ================== Start ==================
const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  console.log(`Battle server on http://0.0.0.0:${PORT}`);
  console.log(`Static root: ${path.join(__dirname, 'public')}`);
  console.log('Access pages: /admin  /play  /watch');
});
