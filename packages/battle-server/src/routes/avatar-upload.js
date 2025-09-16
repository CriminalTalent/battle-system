// packages/battle-server/src/routes/avatar-upload.js
import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import { fileURLToPath } from 'url';
import multer from 'multer';

const router = Router();

// ESM에서 __dirname 구하기
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 업로드 디렉터리 설정 - 프로젝트 루트 기준이 아닌 현재 파일 기준
const AVATAR_DIR = path.join(__dirname, '../../uploads/avatars');

// 디렉토리 생성
fs.mkdirSync(AVATAR_DIR, { recursive: true });

console.log('[Avatar Upload] Upload directory:', AVATAR_DIR);

// multer 저장소 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('[Avatar Upload] Saving to:', AVATAR_DIR);
    cb(null, AVATAR_DIR);
  },
  filename: (req, file, cb) => {
    const safe = (file.originalname || 'avatar').replace(/[^\w.\-]+/g, '_');
    const filename = `${Date.now()}_${safe}`;
    console.log('[Avatar Upload] Filename:', filename);
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 제한
  fileFilter: (req, file, cb) => {
    console.log('[Avatar Upload] File mimetype:', file.mimetype);
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// 단일 파일 업로드 (avatar 필드)
router.post('/avatar', upload.single('avatar'), (req, res, next) => {
  try {
    console.log('[Avatar Upload] Request received');
    console.log('[Avatar Upload] File:', req.file);
    
    if (!req.file) {
      console.log('[Avatar Upload] No file in request');
      return res.status(400).json({ ok: false, error: 'NO_FILE' });
    }

    const filename = path.basename(req.file.path);
    const url = `/uploads/avatars/${filename}`;
    
    console.log('[Avatar Upload] Success:', url);
    
    res.status(200).json({
      ok: true,
      filename,
      url
    });
  } catch (error) {
    console.error('[Avatar Upload] Error:', error);
    next(error);
  }
});

// 에러 핸들링
router.use((error, req, res, next) => {
  console.error('[Avatar Upload] Middleware error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, error: 'FILE_TOO_LARGE' });
    }
  }
  
  res.status(500).json({ ok: false, error: error.message });
});

export default router;
