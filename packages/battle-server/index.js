// index.js - Battle Server Entry (PYXIS minimal)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');

// 채팅 모듈
const { initChat } = require('./src/socket/chat');

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────
const app = express();
app.use(bodyParser.json());

// 정적 파일
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '1m' }));

// SPA처럼 접근 가능하도록 편의 라우트
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'play.html')));
app.get('/watch', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'watch.html')));

// ──────────────────────────────────────────────
/** In-memory Storage (데모용) */
const battles = {}; // battleId -> state
// ──────────────────────────────────────────────

// Utils
function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}`;
}
function now() { return Date.now(); }

// ──────────────────────────────────────────────
// 파일 업로드 (아바타)
// ──────────────────────────────────────────────
const upload = multer({
  dest: path.join(__dirname, 'uploads/'),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

app.post('/api/battles/:id/avatar', upload.single('avatar'), (req, res) => {
  try {
    const { id } = req.params;
    if (!battles[id]) return res.status(404).json({ ok: false, message: '전투 없음' });
    if (!req.file) return res.status(400).json({ ok: false, message: '파일 없음' });

    // 간단히 파일명만 저장 (실서비스는 정적 경로로 옮기는 것을 권장)
    battles[id].avatar = req.file.filename;
    res.json({ ok: true, file: req.file.filename });
  } catch (e) {
    console.error('[POST /api/battles/:id/avatar]', e);
    res.status(500).json({ ok: false, message: '업로드 실패' });
  }
});

// ──────────────────────────────────────────────
// Admin API
// ──────────────────────────────────────────────

// 전투 생성: adminOtp + spectator token 포함
app.post('/api/admin/battles', (req, res) => {
  try {
    const { mode } = req.body || {};
    if (!mode) return res.json({ ok: false, message: 'mode 필요' });

    const battleId = newId('battle');
    const adminOtp = newId('admin');           // ✅ 관리자 OTP 생성
    const spectatorOtp = newId('spec');        // 관전자 OTP

    battles[battleId] = {
      id: battleId,
      mode,
      createdAt: now(),
      teamA: { name: '불사조 기사단', players: [] },
      teamB: { name: '죽음을 먹는 자들', players: [] },
      otp: {
        admin: { value: adminOtp },            // ✅ 저장
        players: {},                           // pid -> token (옵션)
        spectator: { value: spectatorOtp }     // ✅ 저장
      },
      state: 'created'
    };

    // ✅ 응답에 adminOtp 제공
    res.json({ ok: true, battleId, adminOtp, spectatorOtp });
  } catch (e) {
    console.error('[POST /api/admin/battles]', e);
    res.status(500).json({ ok: false, message: '생성 실패' });
  }
});

// 전투 링크 발급 (플레이/관전/관리)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const { id } = req.params;
    const b = battles[id];
    if (!b) return res.status(404).json({ ok: false, message: '전투 없음' });

    const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

    // 데모용: 1명의 플레이어 링크 샘플 생성
    const pToken = newId('pTok');
    const pid = newId('p');
    b.otp.players[pid] = pToken;

    const playUrl = new URL('/play', base);
    playUrl.searchParams.set('battle', b.id);
    playUrl.searchParams.set('token', pToken);
    playUrl.searchParams.set('name', '플레이어');
    playUrl.searchParams.set('pid', pid);

    const watchUrl = new URL('/watch', base);
    watchUrl.searchParams.set('battle', b.id);
    watchUrl.searchParams.set('token', (b.otp && b.otp.spectator && b.otp.spectator.value) || '');

    const adminUrl = new URL('/admin', base);
    adminUrl.searchParams.set('battle', b.id);

    res.json({
      ok: true,
      play: playUrl.toString(),
      watch: watchUrl.toString(),
      admin: adminUrl.toString()
    });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/links]', e);
    res.status(500).json({ ok: false, message: '링크 발급 실패' });
  }
});

// 전투 시작/종료
app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const b = battles[req.params.id];
    if (!b) return res.status(404).json({ ok: false, message: '전투 없음' });
    b.state = 'started';
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/start]', e);
    res.status(500).json({ ok: false, message: '시작 실패' });
  }
});

app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const b = battles[req.params.id];
    if (!b) return res.status(404).json({ ok: false, message: '전투 없음' });
    b.state = 'ended';
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/battles/:id/end]', e);
    res.status(500).json({ ok: false, message: '종료 실패' });
  }
});

// 단순 헬스체크
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: now() }));

// ──────────────────────────────────────────────
// HTTP / Socket.IO
// ──────────────────────────────────────────────
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 30000,
  allowEIO3: true
});

// 채팅 초기화 (파일 로그로 기록)
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

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  console.log(`Battle server on http://0.0.0.0:${PORT}`);
  console.log(`Static root: ${PUBLIC_DIR}`);
  console.log('Access pages: /admin  /play  /watch');
});
