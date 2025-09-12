// packages/battle-server/src/routes/avatar-upload.js
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// 저장 위치
const root = path.resolve(__dirname, '../../');
const uploadDir = path.join(root, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'avatar', ext).replace(/\s+/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const imageFilter = (_req, file, cb) => {
  const ok = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimetype);
  cb(ok ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE'), ok);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// 필드명 호환: avatar / image / file 중 무엇이 와도 1개만 받는다
const acceptAnyImage = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'image',  maxCount: 1 },
  { name: 'file',   maxCount: 1 },
]);

function pickOneFile(req) {
  if (req.file) return req.file;
  const f = (req.files?.avatar?.[0]) || (req.files?.image?.[0]) || (req.files?.file?.[0]);
  return f || null;
}

// POST /api/upload  (avatar/image/file)
router.post('/', acceptAnyImage, (req, res) => {
  const f = pickOneFile(req);
  if (!f) return res.status(400).json({ error: 'no_file' });
  const url = `/uploads/${f.filename}`;
  res.json({ ok: true, url, path: url, filename: f.filename });
});

// POST /api/upload/avatar  (avatar 권장)
router.post('/avatar', acceptAnyImage, (req, res) => {
  const f = pickOneFile(req);
  if (!f) return res.status(400).json({ error: 'no_file' });
  const url = `/uploads/${f.filename}`;
  res.json({ ok: true, url, path: url, filename: f.filename });
});

export default router;
