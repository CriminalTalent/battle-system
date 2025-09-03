const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  createBattle,
  getBattle,
  addPlayerToBattle,
} = require('../socket/battle-handlers');

// JSON 파싱 미들웨어
router.use(express.json());

// ─────────────────────────────────────────────
// 전투 생성 API
// POST /api/battles
// ─────────────────────────────────────────────

router.post('/battles', (req, res) => {
  try {
    const { mode } = req.body;
    const { battleId } = createBattle(mode || '2v2');
    return res.json({ ok: true, id: battleId });
  } catch (err) {
    console.error('[API] 전투 생성 실패:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// 플레이어 추가 API
// POST /api/battles/:battleId/players
// ─────────────────────────────────────────────

router.post('/battles/:battleId/players', (req, res) => {
  try {
    const { battleId } = req.params;
    const player = addPlayerToBattle(battleId, req.body);
    return res.json({ ok: true, player });
  } catch (err) {
    console.error('[API] 플레이어 추가 실패:', err);
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// OTP 발급 API (관리자/플레이어/관전자)
// POST /api/otp
// ─────────────────────────────────────────────

router.post('/otp', (req, res) => {
  try {
    const { role, battleId, playerId, name } = req.body;
    const battle = getBattle(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    if (role === 'admin') {
      return res.json({ ok: true, otp: battle.adminOtp });
    }

    if (role === 'spectator') {
      return res.json({ ok: true, otp: battle.spectatorOtp });
    }

    if (role === 'player') {
      const player = battle.getPlayer(playerId);
      if (!player) throw new Error('플레이어를 찾을 수 없습니다');
      return res.json({ ok: true, otp: player.token });
    }

    throw new Error('지원되지 않는 역할입니다');
  } catch (err) {
    console.error('[API] OTP 발급 실패:', err);
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// 아바타 업로드 API
// POST /api/battles/:battleId/avatar
// ─────────────────────────────────────────────

const uploadDir = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

router.post('/battles/:battleId/avatar', upload.single('avatar'), (req, res) => {
  try {
    const { battleId } = req.params;
    const { playerId } = req.body;

    const battle = getBattle(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const player = battle.getPlayer(playerId);
    if (!player) throw new Error('플레이어를 찾을 수 없습니다');

    const fileUrl = `/uploads/${req.file.filename}`;
    player.avatar = fileUrl;

    return res.json({ ok: true, url: fileUrl });
  } catch (err) {
    console.error('[API] 아바타 업로드 실패:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// 전투 상태 확인 API
// GET /api/battles/:battleId
// ─────────────────────────────────────────────

router.get('/battles/:battleId', (req, res) => {
  try {
    const { battleId } = req.params;
    const battle = getBattle(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    return res.json({ ok: true, state: battle.getSnapshot() });
  } catch (err) {
    console.error('[API] 상태 조회 실패:', err);
    return res.status(404).json({ ok: false, error: err.message });
  }
});

module.exports = router;
