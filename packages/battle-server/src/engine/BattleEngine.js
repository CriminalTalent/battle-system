// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle Engine - Final with 5min (300s) timer tick

const EventEmitter = require('events');

class BattleEngine extends EventEmitter {
  constructor() {
    super();
    this.battles = new Map();
  }

  createBattle(id, data = {}) {
    const battle = {
      id,
      players: data.players || [],
      status: 'waiting',
      phase: null,
      round: 0,
      currentTurn: {
        deadlineAt: null,
        timeLeftSec: 0,
        timerId: null,
      },
      logs: [],
    };
    this.battles.set(id, battle);
    return battle;
  }

  get(id) {
    return this.battles.get(id);
  }

  snapshot(id) {
    const b = this.get(id);
    if (!b) return null;
    return {
      id: b.id,
      players: b.players,
      status: b.status,
      phase: b.phase,
      round: b.round,
      currentTurn: {
        timeLeftSec: b.currentTurn.timeLeftSec || 0,
        deadlineAt: b.currentTurn.deadlineAt,
        currentPlayer: b.currentTurn.currentPlayer,
      },
      logs: b.logs,
    };
  }

  // 선택 페이즈 타이머 (팀당 5분, 1초 tick)
  startPhaseTimer(battle, seconds, onExpire, onTick) {
    if (battle.currentTurn?.timerId) {
      clearInterval(battle.currentTurn.timerId);
      battle.currentTurn.timerId = null;
    }

    const deadline = Date.now() + seconds * 1000;
    if (!battle.currentTurn) battle.currentTurn = {};
    battle.currentTurn.deadlineAt = deadline;

    const updateLeft = () => {
      const leftMs = Math.max(0, deadline - Date.now());
      const leftSec = Math.ceil(leftMs / 1000);
      battle.currentTurn.timeLeftSec = leftSec;

      if (typeof onTick === 'function') onTick(battle);

      if (leftSec <= 0) {
        if (battle.currentTurn?.timerId) {
          clearInterval(battle.currentTurn.timerId);
          battle.currentTurn.timerId = null;
        }
        if (typeof onExpire === 'function') onExpire(battle);
      }
    };

    battle.currentTurn.timerId = setInterval(updateLeft, 1000);
    updateLeft();
  }
}

module.exports = new BattleEngine();
