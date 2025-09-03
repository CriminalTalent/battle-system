// packages/battle-server/src/api/index.js
const express = require('express');
const router = express.Router();

// Dummy route for testing
router.get('/battles', (req, res) => {
  res.json({ message: '전투 리스트 없음 (개발용)' });
});

router.post('/battles', (req, res) => {
  // 이 부분은 실제 로직으로 교체 필요
  const dummyBattleId = 'battle-' + Date.now();
  res.json({ ok: true, id: dummyBattleId });
});

router.post('/otp', (req, res) => {
  const otp = Math.random().toString(36).substring(2, 8).toUpperCase();
  res.json({ ok: true, otp });
});

module.exports = router;
