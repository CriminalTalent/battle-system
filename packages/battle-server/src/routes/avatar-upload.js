"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const router = express.Router();

function ensureDir(p){
  if(!fs.existsSync(p)){
    fs.mkdirSync(p, { recursive:true });
  }
}

const storage = multer.diskStorage({
  destination: function(req, file, cb){
    const battleId = req.params.id || "common";
    const dest = path.join(__dirname, "../../public/uploads/avatars", battleId);
    ensureDir(dest);
    cb(null, dest);
  },
  filename: function(req, file, cb){
    const ts = Date.now();
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, "avatar_" + ts + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function(req, file, cb){
    const ok = /image\/(png|jpeg|jpg|gif|webp)/i.test(file.mimetype);
    cb(ok ? null : new Error("이미지 파일만 업로드 가능합니다."), ok);
  }
});

// POST /api/battles/:id/avatar
router.post("/battles/:id/avatar", upload.single("avatar"), (req, res)=>{
  try{
    if(!req.file){
      return res.status(400).json({ ok:false, error:"파일이 없습니다." });
    }
    const battleId = req.params.id;
    const rel = `/uploads/avatars/${encodeURIComponent(battleId)}/${encodeURIComponent(req.file.filename)}`;
    return res.json({ ok:true, url: rel });
  }catch(e){
    return res.status(500).json({ ok:false, error: e.message });
  }
});

module.exports = router;
