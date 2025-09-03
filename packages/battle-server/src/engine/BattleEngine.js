// packages/battle-server/src/engine/BattleEngine.js

const TimerManager = require('../utils/TimerManager');

class BattleEngine {
  constructor(battleId, players, io, onBattleEnd) {
    this.battleId = battleId;
    this.players = players; // { playerId: { name, team, stats, items, hp, ... } }
    this.io = io;
    this.turnOrder = [];
    this.currentTurn = 0;
    this.timer = new TimerManager(battleId, this.handleBattleTimeout.bind(this), this.handlePlayerTimeout.bind(this));
    this.teams = { A: [], B: [] };
    this.actionLog = [];

    this.initBattle();
  }

  initBattle() {
    this.divideTeams();
    this.calculateInitiative();
    this.timer.startBattleTimer(); // 1시간 타이머
    this.nextTurn();
  }

  divideTeams() {
    for (const [id, p] of Object.entries(this.players)) {
      if (p.team === 'A') this.teams.A.push(id);
      else this.teams.B.push(id);
    }
  }

  calculateInitiative() {
    const agilitySum = team =>
      this.teams[team].reduce((sum, id) => sum + (this.players[id].stats.agility || 0), 0);

    const A = agilitySum('A');
    const B = agilitySum('B');

    const first = A >= B ? 'A' : 'B';
    const second = first === 'A' ? 'B' : 'A';

    this.turnOrder = [...this.teams[first], ...this.teams[second]];
  }

  nextTurn() {
    if (this.isBattleOver()) return this.endBattle();

    const playerId = this.turnOrder[this.currentTurn % this.turnOrder.length];
    this.currentPlayer = playerId;

    this.io.to(this.battleId).emit('turnStart', { playerId });

    this.timer.startPlayerTimer(playerId);
  }

  handlePlayerTimeout(playerId) {
    this.actionLog.push({ playerId, action: 'pass (timeout)' });
    this.io.to(this.battleId).emit('action', {
      playerId,
      action: 'pass',
      reason: 'timeout',
    });
    this.advanceTurn();
  }

  performAction(playerId, actionData) {
    if (playerId !== this.currentPlayer) return;

    this.timer.clearPlayerTimer(playerId);

    const player = this.players[playerId];
    const target = this.players[actionData.targetId];
    const dice = () => Math.ceil(Math.random() * 20);
    let log = { playerId, action: actionData.type };

    switch (actionData.type) {
      case 'attack': {
        const attack = player.stats.attack + dice();
        const defense = target.stats.defense;
        let damage = attack - defense;

        const critCheck = dice();
        const isCrit = critCheck >= (20 - player.stats.luck / 2);
        if (isCrit) damage *= 2;
        damage = Math.max(0, damage);

        target.hp -= damage;
        log = { ...log, targetId: target.id, damage, isCrit };
        break;
      }

      case 'defend': {
        const evadeCheck = player.stats.agility + dice();
        const blocked = evadeCheck >= actionData.incomingAttack;
        log.blocked = blocked;
        break;
      }

      case 'evade': {
        const evadeChance = player.stats.agility + dice();
        log.evaded = evadeChance >= actionData.incomingAttack;
        break;
      }

      case 'item': {
        const item = actionData.item;
        const chance = dice();

        if (!player.items.includes(item)) return;

        player.items = player.items.filter(i => i !== item);

        if (item === 'heal') {
          player.hp = Math.min(player.hp + 10, 100);
          log.result = 'healed';
        } else if (item === 'attackBoost' && chance >= 19) {
          player.stats.attack = Math.floor(player.stats.attack * 1.5);
          log.result = 'boost-success';
        } else if (item === 'defenseBoost' && chance >= 19) {
          player.stats.defense = Math.floor(player.stats.defense * 1.5);
          log.result = 'boost-success';
        } else {
          log.result = 'boost-failed';
        }
        break;
      }

      case 'pass': {
        log.result = 'turn skipped';
        break;
      }

      default:
        return;
    }

    this.actionLog.push(log);
    this.io.to(this.battleId).emit('action', log);

    this.advanceTurn();
  }

  advanceTurn() {
    this.currentTurn++;
    this.nextTurn();
  }

  isBattleOver() {
    const alive = team => this.teams[team].some(id => this.players[id].hp > 0);
    return !alive('A') || !alive('B') || this.currentTurn >= 100;
  }

  endBattle() {
    this.timer.clearAll();

    const teamHP = team =>
      this.teams[team].reduce((sum, id) => sum + Math.max(this.players[id].hp, 0), 0);

    const totalA = teamHP('A');
    const totalB = teamHP('B');
    const winner = totalA > totalB ? 'A' : totalB > totalA ? 'B' : 'draw';

    this.io.to(this.battleId).emit('battleEnd', {
      totalA,
      totalB,
      winner,
    });
  }

  handleBattleTimeout() {
    this.endBattle();
  }
}

module.exports = BattleEngine;
