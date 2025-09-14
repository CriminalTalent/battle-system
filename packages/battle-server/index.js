// index_full_a.js
// PYXIS Server (ESM). Includes static routes + admin links API. No feature additions to gameplay logic.
// Uses events_a.js (root) for socket bindings; keeps API/paths per spec.
//
// Port: 3001 (env PORT overrides)
// Socket path: /socket.io
// Static: ./public (+ direct routes to local *_full_v2.html)
// APIs: /api/health, /api/upload/avatar, /api/admin/battles/:battleId/links (and fallback /api/battles/:battleId/links)

import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

import { registerSocketEvents, battles } from './events_a.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3001,http://127.0.0.1:3001')
  .split(',').map(s=>s.trim()).filter(Boolean);

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

// --- static files (public)
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
app.use(express.static(PUBLIC_DIR));

// --- direct routes to local HTML (keeps backwards-compat)
const sendHtml = (res, filename) => res.sendFile(path.join(__dirname, filename));
app.get('/', (req,res)=> res.redirect('/admin'));
app.get('/admin',    (req,res)=> sendHtml(res, 'admin_full_v2.html'));
app.get('/player',   (req,res)=> sendHtml(res, 'player_full_v2.html'));
app.get('/spectator',(req,res)=> sendHtml(res, 'spectator_full_v2.html'));

// --- ensure avatar upload dir
const AVATAR_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// --- upload (PNG/WebP recommended)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_').slice(0, 64);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('이미지 파일만 허용됩니다.'));
    cb(null, true);
  }
});

// --- API: health
app.get('/api/health', (req, res) => {
  res.json({ ok:true, uptime: process.uptime(), battles: battles?.size ?? 0 });
});

// --- API: avatar upload (keeps spec)
app.post('/api/upload/avatar', upload.single('avatar'), (req,res)=>{
  if (!req.file) return res.status(400).json({ ok:false, error:'NO_FILE' });
  const rel = path.relative(PUBLIC_DIR, req.file.path).split(path.sep).join('/');
  res.json({ ok:true, url: `/${rel}` });
});

// --- API: admin/player links (compat with admin UI)
function buildPlayerLink(origin, battleId, name){
  const token = crypto.randomBytes(8).toString('hex');
  const url = `${origin}/player?battle=${encodeURIComponent(battleId)}&name=${encodeURIComponent(name)}&otp=${token}`;
  return url;
}

function getOrigin(req){
  return (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-host'])
    ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`
    : (req.headers.origin || `http://localhost:${process.env.PORT||3001}`);
}

app.post('/api/admin/battles/:battleId/links', (req,res)=>{
  const { battleId } = req.params;
  const b = battles.get(battleId);
  if (!b) return res.status(404).json({ ok:false, error:'BATTLE_NOT_FOUND' });
  const origin = getOrigin(req);

  // spectator OTP
  const spectatorOtp = crypto.randomBytes(6).toString('hex');

  // player links (create one per current players, or 4 defaults)
  const baseNames = (b.players && b.players.length>0) ? b.players.map(p=>p.name) : ['전투참가자1','전투참가자2','전투참가자3','전투참가자4'];
  const playerLinks = baseNames.map(n => buildPlayerLink(origin, battleId, n));

  res.json({ ok:true, spectatorOtp, playerLinks });
});

// fallback route for older admin
app.post('/api/battles/:battleId/links', (req,res)=>{
  req.url = `/api/admin/battles/${req.params.battleId}/links`;
  app._router.handle(req, res, () => {});
});

// --- sockets
registerSocketEvents(io);

// --- start
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, ()=>{
  console.log(`[PYXIS] listening on http://localhost:${PORT}`);
  console.log(`[PYXIS] socket path: /socket.io`);
});
