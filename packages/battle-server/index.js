// packages/battle-server/index.js - PYXIS Battle Server
import path from 'path';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';

import avatarUploadRouter from './src/routes/avatar-upload.js';
import { makeSocketHandlers } from './src/socket/socketHandlers.js';
import { createBattleStore } from './src/engine/BattleEngine.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';

// Paths
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const uploadsAvatarDir = path.join(uploadsDir, 'avatars');

// Ensure upload dirs
fs.mkdirSync(uploadsAvatarDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: '*', methods: ['GET','POST'] },
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

// Mount upload router  ✅ 불변조건
app.use('/api/upload', avatarUploadRouter);

// In-memory battle store
const battles = createBattleStore();

// Helpers
function ok(res, data = {}) { return res.status(200).json({ ok: true, ...data }); }
function bad(res, msg = 'bad request', code = 400) { return res.status(code).json({ ok: false, error: msg }); }

// API
app.get('/api/health', (_req, res) => {
  ok(res, { uptime: process.uptime(), battles: battles.size() });
});

// HTTP fallback: create battle
app.post('/api/battles', (req, res) => {
  const mode = String(req.body?.mode || '1v1');
  const b = battles.create(mode);
  ok(res, { battleId: b.id, battle: battles.snapshot(b.id) });
});

// HTTP fallback: links (admin)
app.post(['/api/admin/battles/:id/links', '/api/battles/:id/links'], (req, res) => {
  const id = String(req.params.id || '');
  const b = battles.get(id);
  if (!b) return bad(res, 'not found', 404);

  const base = req.headers['x-base-url'] || `${req.protocol}://${req.get('host')}`;
  const spec = battles.issueSpectatorOTP(id);
  const players = b.players.map(p => battles.issuePlayerLink(id, p.id, base));
  ok(res, {
    spectator: {
      otp: spec.otp,
      url: `${base}/spectator.html?battle=${id}&otp=${spec.otp}`
    },
    players
  });
});

// Socket Handlers
makeSocketHandlers(io, { battles });

// Routes for SPA-like HTML
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(publicDir, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(publicDir, 'spectator.html')));

// Errors
app.use((err, _req, res, _next) => {
  console.error('Error:', err);
  bad(res, 'internal error', 500);
});

process.on('uncaughtException', (e)=>console.error('Uncaught', e));
process.on('unhandledRejection', (e)=>console.error('Unhandled', e));

server.listen(PORT, HOST, () => {
  console.log('======================================');
  console.log('PYXIS Battle System');
  console.log(`Server : http://${HOST}:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log('Ready for battle!');
  console.log('======================================');
});
