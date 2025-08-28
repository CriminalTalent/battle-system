// packages/battle-server/src/services/BattleEngine.js
const crypto = require('crypto');

class BattleEngine {
  constructor() {
    /** @type {Map<string, any>} */
    this.battles = new Map();
  }

  getBattleCount() {
    return this.battles.size;
  }

  generateOTP(len = 8) {
    return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
  }

  createBattle(mode = '1v1', adminId = null) {
    const id = crypto.randomBytes(16).toString('hex');
    const configs = {
      '1v1': { playersPerTeam: 1 },
      '2v2': { playersPerTeam: 2 },
      '3v3': { playersPerTeam: 3 },
      '4v4': { playersPerTeam: 4 },
    };
    const config = configs[mode] || configs['1v1'];
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
      config,
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

  addPlayer(battleId, { name, team, stats, inventory = [], imageUrl = '' }) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error('존재하지 않는 전투');
    if (battle.status !== 'waiting') throw new Error('이미 시작된 전투');
    if (!['team1', 'team2'].includes(team)) throw new Error('잘못된 팀');

    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam)
      throw new Error('해당 팀 가득 참');

    const allPlayers = [...battle.teams.team1.players, ...battle.teams.team2.players];
    if (allPlayers.some(p => p.name === name)) throw new Error('중복된 이름');

    const player = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory: Array.isArray(inventory) ? inventory.slice(0, 12) : [],
      imageUrl: imageUrl || '',
      imageData: null, // base64 dataURL (updateAvatar)
      hp: 100,
      maxHp: 100,
      alive: true,
      hasActed: false,
      isReady: false,
      isDefending: false,
      isDodging: false,
      buffs: {},
    };

    targetTeam.players.push(player);
    battle.players.push(player);

    this.addBattleLog(battleId, 'system', `${player.name}이 ${targetTeam.name}에 참가`);
    return player;
  }

  removePlayer(battleId, playerId) {
    const battle = this.battles.get(battleId);
    if (!battle) return { success: false, message: '존재하지 않는 전투' };
    if (battle.status !== 'waiting') return { success: false, message: '전투 중에는 플레이어를 제거할 수 없습니다' };

    let removedPlayer = null;
    for (const teamKey of ['team1', 'team2']) {
      const team = battle.teams[teamKey];
      const idx = team.players.findIndex(p => p.id === playerId);
      if (idx !== -1) {
        removedPlayer = team.players.splice(idx, 1)[0];
        break;
      }
    }
    if (!removedPlayer) return { success: false, message: '플레이어를 찾을 수 없습니다' };

    const glbIdx = battle.players.findIndex(p => p.id === playerId);
    if (glbIdx !== -1) battle.players.splice(glbIdx, 1);

    this.addBattleLog(battleId, 'system', `${removedPlayer.name}이 전투에서 제거됨`);
    return { success: true, removedPlayer };
  }

  setPlayerAvatar(battleId, playerId, dataUrl) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error('전투 없음');
    const p = this.findPlayer(battle, playerId);
    if (!p) throw new Error('플레이어 없음');
    // 간단 검증: data:image/*;base64, 로 시작
    if (typeof dataUrl !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl)) {
      throw new Error('잘못된 이미지 데이터');
    }
    // 300KB 제한 (대략적인 방어)
    const approxBytes = Math.ceil(dataUrl.length * 3 / 4);
    if (approxBytes > 300 * 1024) throw new Error('이미지 용량 초과 (300KB)');

    p.imageData = dataUrl;
    this.addBattleLog(battleId, 'system', `${p.name} 아바타 업데이트`);
    return true;
  }

  normalizeStats(stats = {}) {
    const clamp = (v) => Math.max(1, Math.min(5, v ?? 2));
    return {
      attack: clamp(stats.attack),
      defense: clamp(stats.defense),
      agility: clamp(stats.agility),
      luck: clamp(stats.luck),
    };
  }

  startBattle(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error('전투 없음');
    if (battle.status !== 'waiting') throw new Error('이미 시작됨');

    const t1 = battle.teams.team1.players.length;
    const t2 = battle.teams.team2.players.length;
    if (t1 === 0 || t2 === 0) throw new Error('각 팀에 최소 1명의 플레이어가 필요합니다');

    this.determineFirstTeam(battle);
    battle.status = 'ongoing';
    battle.turnStartTime = Date.now();
    this.addBattleLog(battleId, 'system', '전투 시작!');
    return battle;
  }

  endBattle(battleId, winnerOrReason = null, maybeReason = '') {
    const battle = this.getBattle(battleId);
    if (!battle) return false;

    let winner = null, reason = '';
    const isTeamKey = (v) => v === 'team1' || v === 'team2';

    if (typeof winnerOrReason === 'string' && !maybeReason && !isTeamKey(winnerOrReason)) {
      winner = null; reason = winnerOrReason;
    } else {
      winner = winnerOrReason || null;
      reason = maybeReason || (winner ? `${winner} 승리` : '전투 종료');
    }

    battle.status = 'ended';
    battle.winner = winner;
    battle.endReason = reason;
    battle.endedAt = Date.now();

    if (winner && isTeamKey(winner)) {
      const team = battle.teams[winner];
      this.addBattleLog(battleId, 'system', `${team ? team.name : winner} 팀 승리!`);
    } else {
      this.addBattleLog(battleId, 'system', reason || '무승부');
    }
    return true;
  }

  determineFirstTeam(battle) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    const t1 = battle.teams.team1.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    const t2 = battle.teams.team2.players.reduce((s, p) => s + p.stats.agility + roll(), 0);

    if (t1 > t2) {
      battle.currentTeam = 'team1';
      this.addBattleLog(battle.id, 'system', `${battle.teams.team1.name} 선공`);
    } else if (t2 > t1) {
      battle.currentTeam = 'team2';
      this.addBattleLog(battle.id, 'system', `${battle.teams.team2.name} 선공`);
    } else {
      this.addBattleLog(battle.id, 'system', '동점! 재굴림');
      this.determineFirstTeam(battle);
    }
  }

  executeAction(battleId, playerId, action) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== 'ongoing') throw new Error('진행 중 아님');

    const player = this.findPlayer(battle, playerId);
    if (!player || !player.alive) throw new Error('행동 불가');
    if (player.team !== battle.currentTeam) throw new Error('턴 아님');
    if (player.hasActed) throw new Error('이미 행동');

    let result;
    switch (action.type) {
      case 'attack': result = this.attack(battle, player, action.targetId); break;
      case 'defend': result = this.defend(battle, player); break;
      case 'dodge':  result = this.dodge(battle, player); break;
      case 'item':   result = this.useItem(battle, player, action.itemType, action.targetId); break;
      case 'pass':   result = { action:'pass' }; this.addBattleLog(battle.id, 'action', `${player.name} 패스`); break;
      default: throw new Error('알 수 없는 액션');
    }

    player.hasActed = true;
    this.checkTurnEnd(battle);
    return result;
  }

  checkTurnEnd(battle) {
    const currentTeam = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeam.players.filter(p => p.alive);
    const allActed = alivePlayers.every(p => p.hasActed);
    if (allActed) this.nextTurn(battle);
  }

  nextTurn(battle) {
    const reset = (p) => {
      p.hasActed = false; p.isDefending = false; p.isDodging = false;
      Object.keys(p.buffs).forEach(k => { if (p.buffs[k] === true) delete p.buffs[k]; });
    };
    battle.teams.team1.players.forEach(reset);
    battle.teams.team2.players.forEach(reset);

    battle.currentTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
    if (battle.currentTeam === 'team1') {
      battle.roundNumber++;
      this.addBattleLog(battle.id, 'system', `라운드 ${battle.roundNumber} 시작`);
    }
    battle.turnNumber++;
    battle.turnStartTime = Date.now();
    this.checkVictoryConditions(battle);
  }

  checkVictoryConditions(battle) {
    const t1Alive = battle.teams.team1.players.filter(p => p.alive).length;
    const t2Alive = battle.teams.team2.players.filter(p => p.alive).length;

    if (t1Alive === 0 && t2Alive === 0) this.endBattle(battle.id, null, '무승부 - 양팀 전멸');
    else if (t1Alive === 0) this.endBattle(battle.id, 'team2', `${battle.teams.team2.name} 승리!`);
    else if (t2Alive === 0) this.endBattle(battle.id, 'team1', `${battle.teams.team1.name} 승리!`);
    else if (battle.roundNumber > 50) {
      const t1HP = battle.teams.team1.players.reduce((s,p)=>s+(p.hp||0),0);
      const t2HP = battle.teams.team2.players.reduce((s,p)=>s+(p.hp||0),0);
      if (t1HP > t2HP) this.endBattle(battle.id, 'team1', `${battle.teams.team1.name} 승리! (HP 우세)`);
      else if (t2HP > t1HP) this.endBattle(battle.id, 'team2', `${battle.teams.team2.name} 승리! (HP 우세)`);
      else this.endBattle(battle.id, null, '무승부 (HP 동일)');
    }
  }

  attack(battle, attacker, targetId) {
    const target = this.findPlayer(battle, targetId);
    if (!target || !target.alive) throw new Error('대상 없음');

    let baseDmg = attacker.stats.attack + this.rollDice(20);
    if (attacker.buffs.attack_buff) baseDmg = Math.floor(baseDmg * 1.5);
    let finalDmg = baseDmg;

    // dodge
    if (target.isDodging) {
      const dodgeRoll = target.stats.agility + this.rollDice(20);
      if (dodgeRoll >= baseDmg) {
        this.addBattleLog(battle.id, 'action', `${target.name}이 ${attacker.name}의 공격을 회피!`);
        return { damage: 0, dodged: true, targetAlive: target.alive };
      }
    }

    // defend
    if (target.isDefending) {
      let def = target.stats.defense;
      if (target.buffs.defense_buff) def = Math.floor(def * 1.5);
      finalDmg = Math.max(1, finalDmg - def);

      if (finalDmg <= def / 2) {
        const counterDmg = target.stats.attack + this.rollDice(10);
        attacker.hp = Math.max(0, attacker.hp - counterDmg);
        if (attacker.hp === 0) attacker.alive = false;
        this.addBattleLog(battle.id, 'action', `${target.name}의 역공격으로 ${attacker.name}에게 ${counterDmg} 피해`);
      }
    }

    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const critRoll = this.rollDice(20);
    const isCrit = critRoll >= critThreshold;
    if (isCrit) finalDmg *= 2;

    target.hp = Math.max(0, target.hp - finalDmg);
    if (target.hp === 0) target.alive = false;

    const critText = isCrit ? ' (치명타!)' : '';
    this.addBattleLog(battle.id, 'action', `${attacker.name} → ${target.name} ${finalDmg} 피해${critText}`);
    return { damage: finalDmg, crit: isCrit, targetAlive: target.alive };
  }

  defend(battle, player) {
    player.isDefending = true;
    this.addBattleLog(battle.id, 'action', `${player.name} 방어 자세`);
    return { action: 'defend' };
  }

  dodge(battle, player) {
    player.isDodging = true;
    this.addBattleLog(battle.id, 'action', `${player.name} 회피 준비`);
    return { action: 'dodge' };
  }

  useItem(battle, player, itemType, targetId) {
    const idx = player.inventory.indexOf(itemType);
    if (idx === -1) throw new Error('아이템 없음');
    player.inventory.splice(idx, 1);

    if (itemType === '디터니') {
      const target = targetId ? this.findPlayer(battle, targetId) : player;
      if (!target) throw new Error('대상 없음');
      target.hp = Math.min(target.maxHp, target.hp + 10);
      this.addBattleLog(battle.id, 'action', `${player.name} → ${target.name} HP +10 회복`);
      return { action: 'heal', target: target.name };
    }

    if (itemType === '공격 보정기') {
      player.buffs.attack_buff = true;
      this.addBattleLog(battle.id, 'action', `${player.name} 공격력 강화! (1턴)`);
      return { action: 'attack_buff' };
    }

    if (itemType === '방어 보정기') {
      player.buffs.defense_buff = true;
      this.addBattleLog(battle.id, 'action', `${player.name} 방어력 강화! (1턴)`);
      return { action: 'defense_buff' };
    }

    throw new Error('알 수 없는 아이템');
  }

  rollDice(max = 20) {
    return Math.floor(Math.random() * max) + 1;
  }

  findPlayer(battle, id) {
    return [...battle.teams.team1.players, ...battle.teams.team2.players].find(p => p.id === id);
  }

  findPlayerByName(battle, name) {
    return [...battle.teams.team1.players, ...battle.teams.team2.players].find(p => p.name === name);
  }

  addBattleLog(battleId, type, message) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.battleLog.push({ type, message, timestamp: Date.now() });
    if (battle.battleLog.length > 200) battle.battleLog.shift();
  }

  addChatMessage(battleId, entryOrSender, message, senderType = 'player', extra = {}) {
    const battle = this.getBattle(battleId);
    if (!battle) return;

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
    battle.chatLog.push(entry);
    if (battle.chatLog.length > 100) battle.chatLog.shift();
    return entry;
  }

  adminAuth(battleId, otp) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: '전투 없음' };
    if (battle.otps.admin !== otp) return { success: false, message: 'OTP 불일치' };
    return { success: true, battle };
  }

  playerAuth(battleId, otp, playerId) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: '전투 없음' };
    if (battle.otps.player !== otp) return { success: false, message: 'OTP 불일치' };
    const player = this.findPlayer(battle, playerId);
    if (!player) return { success: false, message: '플레이어 없음' };
    return { success: true, battle, player };
  }

  playerAuthByName(battleId, otp, playerName) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: '전투 없음' };
    if (battle.otps.player !== otp) return { success: false, message: 'OTP 불일치' };
    const player = this.findPlayerByName(battle, playerName);
    if (!player) return { success: false, message: '해당 이름의 플레이어 없음' };
    return { success: true, battle, player };
  }

  spectatorAuth(battleId, otp, name) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: '전투 없음' };
    if (battle.otps.spectator !== otp) return { success: false, message: 'OTP 불일치' };
    return { success: true, battle, spectator: { name } };
  }
}

module.exports = BattleEngine;
