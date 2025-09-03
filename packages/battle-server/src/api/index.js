const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────
// 메모리 저장소 (예시용)
// 실제 서비스에서는 DB 또는 Redis 권장
// ─────────────────────────────
const battles = new Map();
const otps = new Map();
const players = new Map();

// UUID 유사 생성기
const generateId = () => Math.random().toString(36).substring(2, 10);
const generateOTP = () => Math.random().toString().slice(2, 8);

// ─────────────────────────────
// 아바타 업로드
// ─────────────────────────────
const uploadDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

// ─────────────────────────────
// 전투 생성
// ─────────────────────────────
router.post('/battles', (req, res) => {
  const { mode } = req.body;
  if (!mode) return res.status(400).json({ ok: false, error: 'MODE_REQUIRED' });

  const id = generateId();
  const battle = { id, mode, status: 'waiting', createdAt: Date.now(), players: [] };
  battles.set(id, battle);
  return res.json({ ok: true, id });
});

// ─────────────────────────────
// 플레이어 추가
// ─────────────────────────────
router.post('/battles/:battleId/players', (req, res) => {
  const { battleId } = req.params;
  const { name, team, stats, items } = req.body;

  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const id = generateId();
  const player = {
    id,
    name,
    team,
    stats,
    items,
    hp: 100,
    maxHp: 100,
    alive: true,
    avatar: null
  };

  battle.players.push(player);
  players.set(id, player);

  return res.json({ ok: true, player });
});

// ─────────────────────────────
// 아바타 업로드
// ─────────────────────────────
router.post('/battles/:battleId/avatar', upload.single('avatar'), (req, res) => {
  const { battleId } = req.params;
  const { playerId } = req.body;

  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });

  const player = players.get(playerId);
  if (!player) return res.status(404).json({ ok: false, error: 'PLAYER_NOT_FOUND' });

  const url = `/uploads/${req.file.filename}`;
  player.avatar = url;

  return res.json({ ok: true, url });
});

// ─────────────────────────────
// OTP 생성
// ─────────────────────────────
router.post('/api/otp', (req, res) => {
  const { role, battleId, playerId, name } = req.body;
  if (!role || !battleId || !name) {
    return res.status(400).json({ ok: false, error: 'INVALID_PARAMS' });
  }

  const otp = generateOTP();
  otps.set(otp, { role, battleId, playerId, name });

  return res.json({ ok: true, otp });
});

// ─────────────────────────────
// 관리자 전투 상태 변경 (예시)
// ─────────────────────────────
router.post('/battles/:battleId/start', (req, res) => {
  const { battleId } = req.params;
  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  battle.status = 'active';
  return res.json({ ok: true });
});

router.post('/battles/:battleId/end', (req, res) => {
  const { battleId } = req.params;
  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  battle.status = 'ended';
  return res.json({ ok: true });
});

module.exports = router;
