// packages/battle-server/src/utils/battleCleanup.js
"use strict";

function cleanupOTPsForBattle(app, battleId) {
  try {
    if (!app || !battleId) return { ok: false, removed: 0, reason: "invalid_args" };
    const otpMgr = app.get && app.get("otp");
    if (!otpMgr) return { ok: false, removed: 0, reason: "otp_manager_not_initialized" };

    const removed = otpMgr.clearByBattle(battleId);
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, removed: 0, reason: e.message };
  }
}

module.exports = { cleanupOTPsForBattle };
