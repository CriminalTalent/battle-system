// packages/battle-server/src/routes/avatar-upload.js
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// 저장 위치
const root = path.resolve(__dirname, '../../');
const uploadDir = path.join(root, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer 스토리지
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'avatar', ext).replace(/\s+/g,'_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});

const imageFilter = (_req, file, cb) => {
  const ok = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimetype);
  cb(ok ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE'), ok);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter
});

// POST /api/upload/avatar  (필드명: avatar)
router.post('/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  const filename = req.file.filename;
  const url = `/uploads/${filename}`;
  // 클라(admin.js)가 url/path/filename 중 아무거나 써도 되게 모두 내려줌
  res.json({
    ok: true,
    url,
    path: url,
    filename
  });
});

export default router;
