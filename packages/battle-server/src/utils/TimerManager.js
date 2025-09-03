// packages/battle-server/src/utils/TimerManager.js

class TimerManager {
  constructor(battleId, onBattleEnd, onPlayerTimeout) {
    this.battleId = battleId;
    this.onBattleEnd = onBattleEnd;
    this.onPlayerTimeout = onPlayerTimeout;
    this.battleTimer = null;
    this.playerTimers = new Map();
  }

  startBattleTimer(duration = 60 * 60 * 1000) {
    this.clearBattleTimer();
    this.battleTimer = setTimeout(() => {
      this.onBattleEnd(this.battleId);
    }, duration);
  }

  clearBattleTimer() {
    if (this.battleTimer) clearTimeout(this.battleTimer);
  }

  startPlayerTimer(playerId, timeout = 5 * 60 * 1000) {
    this.clearPlayerTimer(playerId);
    const timer = setTimeout(() => {
      this.onPlayerTimeout(playerId);
    }, timeout);
    this.playerTimers.set(playerId, timer);
  }

  clearPlayerTimer(playerId) {
    if (this.playerTimers.has(playerId)) {
      clearTimeout(this.playerTimers.get(playerId));
      this.playerTimers.delete(playerId);
    }
  }

  clearAllPlayerTimers() {
    for (const [id, timer] of this.playerTimers.entries()) {
      clearTimeout(timer);
    }
    this.playerTimers.clear();
  }

  clearAll() {
    this.clearBattleTimer();
    this.clearAllPlayerTimers();
  }
}

module.exports = TimerManager;
