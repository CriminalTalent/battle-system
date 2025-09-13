// packages/battle-server/src/routes/avatar-upload.js
"use strict";

import path from "path";
import fs from "fs";
import { Router } from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import crypto from "crypto";

const router = Router();

// 경로 계산
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, "../../..");

// 업로드 디렉터리
const UPLOAD_BASE = path.join(REPO_ROOT, "uploads");
const AVATAR_DIR  = path.join(UPLOAD_BASE, "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// 허용 MIME
const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"
]);

// multer 설정
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safeBase = (file.originalname || "avatar").replace(/[^\w.\-]+/g, "_").slice(0, 64);
    const rnd = crypto.randomBytes(6).toString("hex");
    cb(null, `${Date.now()}_${rnd}_${safeBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has((file.mimetype || "").toLowerCase())) {
      return cb(new Error("UNSUPPORTED_FILE_TYPE"));
    }
    cb(null, true);
  }
});

// avatar/image/file 어떤 이름으로 와도 허용
const fields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "image",  maxCount: 1 },
  { name: "file",   maxCount: 1 }
]);

// 공통 처리기
const handleUpload = (req, res) => {
  const f =
    (req.files?.avatar && req.files.avatar[0]) ||
    (req.files?.image  && req.files.image[0])  ||
    (req.files?.file   && req.files.file[0]);

  if (!f) return res.status(400).json({ ok: false, error: "NO_FILE" });

  const filename  = path.basename(f.path);
  const publicUrl = `/uploads/avatars/${filename}`; // 정적 서빙과 일치해야 함

  return res.status(200).json({ ok: true, filename, url: publicUrl, fileUrl: publicUrl });
};

// multer 래퍼
const withFields = (req, res) => {
  fields(req, res, (err) => {
    if (err) {
      const code = err.message === "UNSUPPORTED_FILE_TYPE" ? 415 : 400;
      return res.status(code).json({ ok: false, error: err.message || "UPLOAD_ERROR" });
    }
    return handleUpload(req, res);
  });
};

// 프런트가 시도하는 모든 경로를 받아줌 (router는 /api에 마운트된다고 가정)
router.post("/upload/avatar", withFields);
router.post("/battles/:battleId/avatar", withFields);
router.post("/battle/:battleId/avatar", withFields);
router.post("/battles/:battleId/upload-avatar", withFields);
router.post("/battle/:battleId/upload-avatar", withFields);

export default router;
