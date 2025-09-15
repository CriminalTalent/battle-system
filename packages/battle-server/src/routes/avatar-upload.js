// packages/battle-server/src/routes/avatar-upload.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '../../');
const uploadsDir = path.join(root, 'uploads');
const avatarDir = path.join(uploadsDir, 'avatars');

fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

function fileFilter(_req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) return cb(new Error('unsupported file type'));
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

router.post('/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const url = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok: true, filename: req.file.filename, url });
});

export default router;
