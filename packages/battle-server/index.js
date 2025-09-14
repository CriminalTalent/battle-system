// index_fixed.js
// PYXIS server entry (ESM). Keeps existing APIs and socket path, no feature changes.
// - Port: 3001 (or PORT env)
// - Socket.IO path: /socket.io
// - Static: ./public
// - APIs: /api/health, /api/battles (delegated), /api/upload/avatar
// - Ensures upload dir exists
// - CORS via env CORS_ORIGIN (comma-separated)

import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

// IMPORTANT: match your actual file locations (flat at project root)
import { registerSocketEvents, battles } from './events.js';
// If you import other handlers/engines, keep paths flat like below:
// import { BattleEngine } from './BattleEngine (1).js';           // if needed by events.js
// import { attachBattleApis } from './battle-handlers.js';        // if needed by events.js

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3001,http://127.0.0.1:3001')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const io = new SocketIOServer(server, {
  path: '/socket.io',
  cors: { origin: ORIGINS, methods: ['GET','POST'] }
});

// --- middleware
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: ORIGINS }));

// --- static
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// --- ensure upload dir
const AVATAR_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// --- upload: avatars (PNG/WebP recommended)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    // keep original name with timestamp prefix
    const ext = path.extname(file.originalname) || '';
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_').slice(0, 64);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB guard (client side also checks)
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('이미지 파일만 허용됩니다.'));
    cb(null, true);
  }
});

// --- APIs
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), battles: Object.keys(battles || {}).length || 0 });
});

// avatar upload (keeps existing spec /api/upload/avatar)
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
  // public URL
  const rel = path.relative(PUBLIC_DIR, req.file.path).split(path.sep).join('/');
  res.json({ ok: true, url: `/${rel}` });
});

// Delegate battles API if your events/handlers expose an express router.
// If not, keep compatibility by returning 501 (so we don't silently change behavior).
if (typeof registerSocketEvents?.attachBattleRouter === 'function') {
  app.use('/api/battles', registerSocketEvents.attachBattleRouter(express.Router()));
} else if (typeof battles?.router === 'function') {
  app.use('/api/battles', battles.router());
} else {
  app.all('/api/battles/*', (req, res) => res.status(501).json({ ok: false, error: 'NOT_IMPLEMENTED' }));
}

// --- sockets
registerSocketEvents?.(io, app);

// --- start
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, () => {
  console.log(`[PYXIS] server listening on http://localhost:${PORT}`);
  console.log(`[PYXIS] socket.io path: /socket.io`);
  console.log(`[PYXIS] static root: ${PUBLIC_DIR}`);
});
