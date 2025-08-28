// packages/battle-server/src/services/BattleEngine.js
const crypto = require('crypto');

class BattleEngine {
  constructor() {
    this.battles = new Map();
  }

  // count
  getBattleCount() {
    return this.battles.size;
  }

  // OTP
  generateOTP(len = 8) {
    return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
  }

  // create
  createBattle(mode = '1v1', adminId = null) {
    const id = crypto.randomBytes(16).toString('hex');
    const cfgs = { '1v1':1, '2v2':2, '3v3':3, '4v4':4 };
    const playersPerTeam = cfgs[mode] || 1;
    const now = Date.now();

    const battle = {
      id,
      mode,
      status: 'waiting',
      createdAt: now,
      adminId,
      teams: {
        team1: { name: '불사조 기사단', players: [] },
        team2: { name: '죽음을 먹는 자들', players: [] },
      },
      players: [],
      spectators: [],
      currentTeam: null,
      roundNumber: 1,
      turnNumber: 1,
      turnStartTime: null,
      battleLog: [{ type: 'system', message: `[전투생성] 모드: ${mode}`, timestamp: now }],
      chatLog: [],
      config: { playersPerTeam },
      winner: null,
      endReason: null,
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        spectator: this.generateOTP(),
      },
    };

    this.battles.set(id, battle);
    return battle;
  }

  getBattle(id) {
    return this.battles.get(id);
  }

  // add/remove players
  addPlayer(battleId, { name, team, stats, inventory = [], imageUrl = '' }) {
    const b = this.battles.get(battleId);
    if (!b) throw new Error('존재하지 않는 전투');
    if (b.status !== 'waiting') throw new Error('이미 시작된 전투');
    if (!['team1', 'team2'].includes(team)) throw new Error('잘못된 팀');

    const t = b.teams[team];
    if (t.players.length >= b.config.playersPerTeam) throw new Error('해당 팀 가득 참');

    const all = [...b.teams.team1.players, ...b.teams.team2.players];
    if (all.some(p => p.name === name)) throw new Error('중복된 이름');

    const player = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory: Array.isArray(inventory) ? inventory.slice(0) : [],
      imageUrl: imageUrl || '',
      hp: 100,
      maxHp: 100,
      alive: true,
      hasActed: false,
      isReady: false,
      isDefending: false,
      isDodging: false,
      buffs: {},
    };

    t.players.push(player);
    b.players.push(player);
    this.addBattleLog(battleId, 'system', `${player.name}이 ${t.name}에 참가`);
    return player;
  }

  removePlayer(battleId, playerId) {
    const b = this.battles.get(battleId);
    if (!b) return { success: false, message: '존재하지 않는 전투' };
    if (b.status !== 'waiting') return { success: false, message: '전투 중에는 제거 불가' };

    let removed = null;
    for (const key of ['team1', 'team2']) {
      const arr = b.teams[key].players;
      const idx = arr.findIndex(p => p.id === playerId);
      if (idx !== -1) {
        removed = arr.splice(idx, 1)[0];
        break;
      }
    }
    if (!removed) return { success: false, message: '플레이어를 찾을 수 없습니다' };

    const gi = b.players.findIndex(p => p.id === playerId);
    if (gi !== -1) b.players.splice(gi, 1);

    this.addBattleLog(battleId, 'system', `${removed.name} 제거`);
    return { success: true, removedPlayer: removed };
  }

  // normalize stats
  normalizeStats(stats = {}) {
    const clamp = (v) => Math.max(1, Math.min(5, v ?? 3));
    return {
      attack: clamp(stats.attack),
      defense: clamp(stats.defense),
      agility: clamp(stats.agility),
      luck: clamp(stats.luck),
    };
  }

  // start / end
  startBattle(battleId) {
    const b = this.getBattle(battleId);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작됨');

    if (b.teams.team1.players.length === 0 || b.teams.team2.players.length === 0) {
      throw new Error('각 팀에 최소 1명이 필요합니다');
    }

    this.determineFirstTeam(b);
    b.status = 'ongoing';
    b.turnStartTime = Date.now();
    this.addBattleLog(battleId, 'system', '전투 시작!');
    return b;
  }

  endBattle(battleId, winnerOrReason = null, maybeReason = '') {
    const b = this.getBattle(battleId);
    if (!b) return false;

    let winner = null, reason = '';
    const isTeam = (v) => v === 'team1' || v === 'team2';
    if (typeof winnerOrReason === 'string' && !maybeReason && !isTeam(winnerOrReason)) {
      reason = winnerOrReason;
    } else {
      winner = winnerOrReason || null;
      reason = maybeReason || (winner ? `${winner} 승리` : '전투 종료');
    }

    b.status = 'ended';
    b.winner = winner;
    b.endReason = reason;
    b.endedAt = Date.now();

    if (winner && isTeam(winner)) {
      const t = b.teams[winner];
      this.addBattleLog(battleId, 'system', `${t ? t.name : winner} 팀 승리!`);
    } else {
      this.addBattleLog(battleId, 'system', reason || '무승부');
    }
    return true;
  }

  // initiative
  determineFirstTeam(b) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    const t1 = b.teams.team1.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    const t2 = b.teams.team2.players.reduce((s, p) => s + p.stats.agility + roll(), 0);

    if (t1 > t2) {
      b.currentTeam = 'team1';
      this.addBattleLog(b.id, 'system', `${b.teams.team1.name} 선공`);
    } else if (t2 > t1) {
      b.currentTeam = 'team2';
      this.addBattleLog(b.id, 'system', `${b.teams.team2.name} 선공`);
    } else {
      this.addBattleLog(b.id, 'system', '동점! 재굴림');
      this.determineFirstTeam(b);
    }
  }

  // actions
  executeAction(battleId, playerId, action) {
    const b = this.getBattle(battleId);
    if (!b || b.status !== 'ongoing') throw new Error('진행 중 아님');

    const p = this.findPlayer(b, playerId);
    if (!p || !p.alive) throw new Error('행동 불가');
    if (p.team !== b.currentTeam) throw new Error('턴 아님');
    if (p.hasActed) throw new Error('이미 행동');

    let result;
    switch (action.type) {
      case 'attack': result = this.attack(b, p, action.targetId); break;
      case 'defend': result = this.defend(b, p); break;
      case 'dodge':  result = this.dodge(b, p); break;
      case 'item':   result = this.useItem(b, p, action.itemType, action.targetId); break;
      case 'pass':
        result = { action: 'pass' };
        this.addBattleLog(b.id, 'action', `${p.name} 패스`);
        break;
      default: throw new Error('알 수 없는 액션');
    }

    p.hasActed = true;
    this.checkTurnEnd(b);
    return result;
  }

  checkTurnEnd(b) {
    const cur = b.teams[b.currentTeam];
    const alive = cur.players.filter(p => p.alive);
    const allActed = alive.every(p => p.hasActed);
    if (allActed) this.nextTurn(b);
  }

  nextTurn(b) {
    const reset = (p) => {
      p.hasActed = false;
      p.isDefending = false;
      p.isDodging = false;
      for (const k of Object.keys(p.buffs)) delete p.buffs[k]; // 1턴 지속 버프
    };
    b.teams.team1.players.forEach(reset);
    b.teams.team2.players.forEach(reset);

    b.currentTeam = b.currentTeam === 'team1' ? 'team2' : 'team1';
    if (b.currentTeam === 'team1') {
      b.roundNumber++;
      this.addBattleLog(b.id, 'system', `라운드 ${b.roundNumber} 시작`);
    }
    b.turnNumber++;
    b.turnStartTime = Date.now();

    this.checkVictoryConditions(b);
  }

  checkVictoryConditions(b) {
    const alive1 = b.teams.team1.players.filter(p => p.alive).length;
    const alive2 = b.teams.team2.players.filter(p => p.alive).length;

    if (alive1 === 0 && alive2 === 0) return this.endBattle(b.id, null, '무승부 - 양팀 전멸');
    if (alive1 === 0) return this.endBattle(b.id, 'team2', `${b.teams.team2.name} 승리!`);
    if (alive2 === 0) return this.endBattle(b.id, 'team1', `${b.teams.team1.name} 승리!`);

    if (b.roundNumber > 50) {
      const hp1 = b.teams.team1.players.reduce((s, p) => s + p.hp, 0);
      const hp2 = b.teams.team2.players.reduce((s, p) => s + p.hp, 0);
      if (hp1 > hp2) return this.endBattle(b.id, 'team1', `${b.teams.team1.name} 승리! (HP 우세)`);
      if (hp2 > hp1) return this.endBattle(b.id, 'team2', `${b.teams.team2.name} 승리! (HP 우세)`);
      return this.endBattle(b.id, null, '무승부 (HP 동일)');
    }
  }

  attack(b, attacker, targetId) {
    const target = this.findPlayer(b, targetId);
    if (!target || !target.alive) throw new Error('대상 없음');

    let base = attacker.stats.attack + this.rollDice(20);
    if (attacker.buffs.attack_buff) base = Math.floor(base * 1.5);
    let dmg = base;

    // dodge
    if (target.isDodging) {
      const dodgeRoll = target.stats.agility + this.rollDice(20);
      if (dodgeRoll >= base) {
        this.addBattleLog(b.id, 'action', `${target.name}이 ${attacker.name}의 공격을 회피!`);
        return { damage: 0, dodged: true, targetAlive: target.alive };
      }
    }

    // defend
    if (target.isDefending) {
      let def = target.stats.defense;
      if (target.buffs.defense_buff) def = Math.floor(def * 1.5);
      dmg = Math.max(1, dmg - def);

      // counter chance
      if (dmg <= def / 2) {
        const cdmg = target.stats.attack + this.rollDice(10);
        attacker.hp = Math.max(0, attacker.hp - cdmg);
        if (attacker.hp === 0) attacker.alive = false;
        this.addBattleLog(b.id, 'action', `${target.name} 역공격으로 ${attacker.name}에게 ${cdmg} 피해`);
      }
    }

    // crit
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const critRoll = this.rollDice(20);
    const isCrit = critRoll >= critThreshold;
    if (isCrit) dmg *= 2;

    // apply
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0) target.alive = false;

    this.addBattleLog(b.id, 'action', `${attacker.name} → ${target.name} ${dmg} 피해${isCrit ? ' (치명타)' : ''}`);
    return { damage: dmg, crit: isCrit, targetAlive: target.alive };
  }

  defend(b, player) {
    player.isDefending = true;
    this.addBattleLog(b.id, 'action', `${player.name} 방어 자세`);
    return { action: 'defend' };
  }

  dodge(b, player) {
    player.isDodging = true;
    this.addBattleLog(b.id, 'action', `${player.name} 회피 준비`);
    return { action: 'dodge' };
  }

  useItem(b, player, itemType, targetId) {
    const idx = player.inventory.indexOf(itemType);
    if (idx === -1) throw new Error('아이템 없음');
    player.inventory.splice(idx, 1);

    if (itemType === '디터니') {
      const target = targetId ? this.findPlayer(b, targetId) : player;
      if (!target) throw new Error('대상 없음');
      target.hp = Math.min(target.maxHp, target.hp + 10);
      this.addBattleLog(b.id, 'action', `${player.name} → ${target.name} HP +10 회복`);
      return { action: 'heal', target: target.name };
    }

    if (itemType === '공격 보정기') {
      player.buffs.attack_buff = true;
      this.addBattleLog(b.id, 'action', `${player.name} 공격력 강화! (1턴)`);
      return { action: 'attack_buff' };
    }

    if (itemType === '방어 보정기') {
      player.buffs.defense_buff = true;
      this.addBattleLog(b.id, 'action', `${player.name} 방어력 강화! (1턴)`);
      return { action: 'defense_buff' };
    }

    throw new Error('알 수 없는 아이템');
  }

  // util
  rollDice(max = 20) { return Math.floor(Math.random() * max) + 1; }

  findPlayer(b, id) {
    return [...b.teams.team1.players, ...b.teams.team2.players].find(p => p.id === id);
  }

  findPlayerByName(b, name) {
    return [...b.teams.team1.players, ...b.teams.team2.players].find(p => p.name === name);
  }

  addBattleLog(battleId, type, message) {
    const b = this.getBattle(battleId);
    if (!b) return;
    b.battleLog.push({ type, message, timestamp: Date.now() });
    if (b.battleLog.length > 200) b.battleLog.shift();
  }

  addChatMessage(battleId, entryOrSender, message, senderType = 'player', extra = {}) {
    const b = this.getBattle(battleId);
    if (!b) return;

    let entry;
    if (entryOrSender && typeof entryOrSender === 'object' && entryOrSender.sender) {
      entry = { timestamp: Date.now(), channel: 'all', team: null, senderType: 'player', ...entryOrSender };
    } else {
      entry = {
        sender: entryOrSender,
        message,
        senderType,
        channel: extra.channel || 'all',
        team: extra.team || null,
        timestamp: Date.now(),
      };
    }
    b.chatLog.push(entry);
    if (b.chatLog.length > 200) b.chatLog.shift();
    return entry;
  }

  // auth
  adminAuth(battleId, otp) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: '전투 없음' };
    if (b.otps.admin !== otp) return { success: false, message: 'OTP 불일치' };
    return { success: true, battle: b };
    }

  playerAuth(battleId, otp, playerId) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: '전투 없음' };
    if (b.otps.player !== otp) return { success: false, message: 'OTP 불일치' };
    const p = this.findPlayer(b, playerId);
    if (!p) return { success: false, message: '플레이어 없음' };
    return { success: true, battle: b, player: p };
  }

  playerAuthByName(battleId, otp, playerName) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: '전투 없음' };
    if (b.otps.player !== otp) return { success: false, message: 'OTP 불일치' };
    const p = this.findPlayerByName(b, playerName);
    if (!p) return { success: false, message: '해당 이름의 플레이어 없음' };
    return { success: true, battle: b, player: p };
  }

  spectatorAuth(battleId, otp, name) {
    const b = this.getBattle(battleId);
    if (!b) return { success: false, message: '전투 없음' };
    if (b.otps.spectator !== otp) return { success: false, message: 'OTP 불일치' };
    return { success: true, battle: b, spectator: { name } };
  }
}

module.exports = BattleEngine;