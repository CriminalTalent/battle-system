// packages/battle-server/src/routes/avatar-upload.js
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
// 필요시: npm i file-type
let fileType; try { fileType = require("file-type"); } catch (_) {}

const router = express.Router();

// 배틀ID는 영문/숫자/하이픈/언더스코어만 허용 (디렉터리 탈출 방지)
function sanitizeBattleId(raw) {
  const s = String(raw || "common");
  const m = s.match(/[A-Za-z0-9_-]+/g);
  return (m && m.join("").slice(0, 100)) || "common";
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// 업로드 루트 (/public/uploads/avatars)
const UPLOAD_ROOT = path.join(__dirname, "../../public/uploads/avatars");
ensureDir(UPLOAD_ROOT);

// MIME → 확장자 매핑 (mimetype 신뢰 최소화)
const EXT_BY_MIME = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
});

// multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const battleId = sanitizeBattleId(req.params.id);
    const dest = path.join(UPLOAD_ROOT, battleId);
    ensureDir(dest);
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    const ts = Date.now();
    // 확장자는 우선 mimetype, fallback은 .png
    const fromMime = EXT_BY_MIME[file.mimetype] || "";
    const ext = fromMime || (path.extname(file.originalname || "").toLowerCase() || ".png");
    cb(null, `avatar_${ts}${ext}`);
  },
});

// 파일 필터: 이미지 외 거부
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    const ok = /^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.mimetype || "");
    if (!ok) return cb(new Error("이미지 파일만 업로드 가능합니다."));
    cb(null, true);
  },
});

// 실제 컨텐츠 시그니처 1차 검증(선택): file-type 사용 가능 시
async function verifyByMagicNumber(absPath) {
  if (!fileType) return true;
  try {
    const ft = await fileType.fromFile(absPath);
    if (!ft) return false;
    return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(ft.mime);
  } catch {
    return false;
  }
}

// 절대 URL 생성 (프록시 고려)
function buildAbsoluteURL(req, relPath) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}${relPath}`;
}

// 정적 서빙이 되어 있어야 함 (index.js 예시)
// app.use("/uploads", express.static(path.join(__dirname, "public/uploads"), { maxAge: "7d", etag: true }));

// POST /api/battles/:id/avatar
router.post("/battles/:id/avatar", upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "파일이 없습니다." });
    }

    const battleId = sanitizeBattleId(req.params.id);
    const filename = req.file.filename;
    const abs = req.file.path; // multer가 전달
    const rel = `/uploads/avatars/${encodeURIComponent(battleId)}/${encodeURIComponent(filename)}`;

    // 매직넘버 검증(선택)
    const magicOk = await verifyByMagicNumber(abs);
    if (!magicOk) {
      // 의심 파일은 즉시 삭제
      try { fs.unlinkSync(abs); } catch {}
      return res.status(415).json({ ok: false, error: "지원하지 않는 파일 형식입니다." });
    }

    // 절대 URL도 함께 반환(클라이언트 편의)
    const url = buildAbsoluteURL(req, rel);

    return res.json({ ok: true, url: rel, absoluteUrl: url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
