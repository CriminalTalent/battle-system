// packages/battle-server/src/routes/avatar-upload.js
// ESM 모드
'use strict';

import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import multer from 'multer';

const router = Router();

// 업로드 디렉터리: packages/battle-server/uploads/avatars
// index.js 에서 app.use('/uploads', express.static(uploadsDir)) 로 공개 제공된다고 가정
const UPLOAD_BASE = path.join(process.cwd(), 'packages', 'battle-server', 'uploads');
const AVATAR_DIR   = path.join(UPLOAD_BASE, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || 'avatar').replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// 프런트 필드명이 avatar/image/file 어느 것이든 허용
const fields = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'image',  maxCount: 1 },
  { name: 'file',   maxCount: 1 },
]);

// POST /api/upload/avatar
router.post('/avatar', (req, res, next) => {
  fields(req, res, (err) => {
    if (err) return next(err);

    const f =
      (req.files?.avatar && req.files.avatar[0]) ||
      (req.files?.image  && req.files.image[0])  ||
      (req.files?.file   && req.files.file[0]);

    if (!f) return res.status(400).json({ ok: false, error: 'NO_FILE' });

    // 업로드 파일을 /uploads/avatars/ 파일명 으로 접근 가능
    const filename = path.basename(f.path);
    res.status(200).json({
      ok: true,
      filename,
      url: `/uploads/avatars/${filename}`,
    });
  });
});

export default router;
