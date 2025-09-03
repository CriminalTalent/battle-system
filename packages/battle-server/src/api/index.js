// packages/battle-server/src/api/index.js
const express = require('express');
const router = express.Router();

// 메모리 기반 저장소 (임시용, 서버 재시작 시 초기화됨)
const battles = new Map();
const otps = new Map();

// [POST] /api/battles - 전투 생성
router.post('/battles', (req, res) => {
  const { mode } = req.body;

  if (!mode || !['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'INVALID_MODE' });
  }

  const battleId = `battle-${Date.now()}`;
  const battle = {
    id: battleId,
    mode,
    createdAt: new Date(),
    players: [],
    status: 'waiting',
  };

  battles.set(battleId, battle);
  return res.json({ ok: true, id: battleId });
});

// [POST] /api/battles/:battleId/players - 플레이어 추가
router.post('/battles/:battleId/players', (req, res) => {
  const { battleId } = req.params;
  const { name, team, stats, items } = req.body;

  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false, error: 'BATTLE_NOT_FOUND' });

  const playerId = `player-${Date.now()}`;
  const player = {
    id: playerId,
    name,
    team,
    hp: 100,
    maxHp: 100,
    ...stats,
    items: items || [],
  };

  battle.players.push(player);
  return res.json({ ok: true, player });
});

// [POST] /api/battles/:battleId/avatar - 아바타 업로드 (폼데이터용, 추후 미들웨어 필요)
router.post('/battles/:battleId/avatar', (req, res) => {
  return res.json({ ok: true }); // 일단 응답만 (실제 업로드 로직 필요)
});

// [POST] /api/otp - OTP 생성
router.post('/otp', (req, res) => {
  const { role, battleId, playerId, name } = req.body;

  if (!battleId || !role) {
    return res.status(400).json({ ok: false, error: 'MISSING_PARAMS' });
  }

  const otp = Math.random().toString(36).substring(2, 8).toUpperCase();
  otps.set(otp, { role, battleId, playerId, name });

  return res.json({ ok: true, otp });
});

// [GET] /api/health - 헬스 체크
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
