// packages/battle-server/src/routes/avatar-upload.js
"use strict";

import path from "path";
import fs from "fs";
import { Router } from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import crypto from "crypto";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// uploads 폴더를 server index.js와 동일 위치로 맞춤: packages/battle-server/uploads/avatars
const AVATAR_DIR  = path.resolve(__dirname, "../../uploads/avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const base = (file.originalname || "avatar").replace(/[^\w.\-]+/g, "_").slice(0, 48);
    const rnd = crypto.randomBytes(6).toString("hex");
    cb(null, `${Date.now()}_${rnd}_${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has((file.mimetype || "").toLowerCase())) {
      return cb(new Error("UNSUPPORTED_FILE_TYPE"));
    }
    cb(null, true);
  }
});

const fields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "image",  maxCount: 1 },
  { name: "file",   maxCount: 1 }
]);

// POST /api/upload/avatar
router.post("/avatar", (req, res) => {
  fields(req, res, (err) => {
    if (err) {
      const code = err.message === "UNSUPPORTED_FILE_TYPE" ? 415 : 400;
      return res.status(code).json({ ok: false, error: err.message || "UPLOAD_ERROR" });
    }
    const f =
      (req.files?.avatar && req.files.avatar[0]) ||
      (req.files?.image  && req.files.image[0])  ||
      (req.files?.file   && req.files.file[0]);
    if (!f) return res.status(400).json({ ok: false, error: "NO_FILE" });

    const filename = path.basename(f.path);
    const publicUrl = `/uploads/avatars/${filename}`;

    return res.status(200).json({ ok: true, filename, url: publicUrl });
  });
});

export default router;
