// packages/battle-server/src/services/BattleEngine.js
const crypto = require('crypto');

class BattleEngine {
  constructor() {
    this.battles = new Map();
  }

  // 전투 개수 조회
  getBattleCount() {
    return this.battles.size;
  }

  // OTP 생성
  generateOTP() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  // 전투 생성
  createBattle(mode = '1v1', adminId = null) {
    const id = crypto.randomBytes(16).toString('hex');
    const configs = {
      '1v1': { playersPerTeam: 1 },
      '2v2': { playersPerTeam: 2 },
      '3v3': { playersPerTeam: 3 },
      '4v4': { playersPerTeam: 4 }
    };
    const config = configs[mode] || configs['1v1'];

    const battle = {
      id,
      mode,
      status: 'waiting',
      createdAt: Date.now(),
      adminId,
      teams: {
        team1: { name: '불사조 기사단', players: [] },
        team2: { name: '죽음을 먹는자들', players: [] }
      },
      currentTeam: null,
      roundNumber: 1,
      turnNumber: 1,
      turnStartTime: null,
      battleLog: [],
      chatLog: [],
      config,
      winner: null,
      endReason: null,
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        spectator: this.generateOTP()
      }
    };

    this.battles.set(id, battle);
    this.addBattleLog(id, 'system', `[전투생성] 모드: ${mode}`);
    return battle;
  }

  // 전투 가져오기
  getBattle(id) {
    return this.battles.get(id);
  }

  // 플레이어 추가
  addPlayer(battleId, { name, team, stats, inventory = [], imageUrl = '' }) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error('존재하지 않는 전투');
    if (battle.status !== 'waiting') throw new Error('이미 시작된 전투');

    if (!['team1', 'team2'].includes(team)) throw new Error('잘못된 팀');
    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam) throw new Error('해당 팀 가득 참');

    // 중복 이름 체크
    const allPlayers = [...battle.teams.team1.players, ...battle.teams.team2.players];
    if (allPlayers.some(p => p.name === name)) throw new Error('중복된 이름');

    const player = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory,
      imageUrl,
      hp: 100,
      maxHp: 100,
      alive: true,
      hasActed: false,
      isReady: false,
      isDefending: false,
      isDodging: false,
      buffs: {}
    };

    targetTeam.players.push(player);
    this.addBattleLog(battleId, 'system', `${player.name}이 ${targetTeam.name}에 참가`);
    return player;
  }

  // 스탯 정규화
  normalizeStats(stats = {}) {
    const clamp = (val) => Math.max(1, Math.min(5, val || 2));
    return {
      attack: clamp(stats.attack),
      defense: clamp(stats.defense),
      agility: clamp(stats.agility),
      luck: clamp(stats.luck)
    };
  }

  // 전투 시작
  startBattle(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error('전투 없음');
    if (battle.status !== 'waiting') throw new Error('이미 시작됨');

    this.determineFirstTeam(battle);
    battle.status = 'ongoing';
    battle.turnStartTime = Date.now();
    this.addBattleLog(battleId, 'system', '전투 시작!');
    return battle;
  }

  // 선공 결정
  determineFirstTeam(battle) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    const team1Total = battle.teams.team1.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    const team2Total = battle.teams.team2.players.reduce((s, p) => s + p.stats.agility + roll(), 0);

    if (team1Total > team2Total) {
      battle.currentTeam = 'team1';
      this.addBattleLog(battle.id, 'system', `${battle.teams.team1.name} 선공`);
    } else if (team2Total > team1Total) {
      battle.currentTeam = 'team2';
      this.addBattleLog(battle.id, 'system', `${battle.teams.team2.name} 선공`);
    } else {
      this.addBattleLog(battle.id, 'system', '동점! 재굴림');
      this.determineFirstTeam(battle);
    }
  }

  // 액션 실행
  executeAction(battleId, playerId, action) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== 'ongoing') throw new Error('진행 중 아님');

    const player = this.findPlayer(battle, playerId);
    if (!player || !player.alive) throw new Error('행동 불가');
    if (player.team !== battle.currentTeam) throw new Error('턴 아님');
    if (player.hasActed) throw new Error('이미 행동');

    let result;
    switch (action.type) {
      case 'attack':
        result = this.attack(battle, player, action.targetId);
        break;
      case 'defend':
        result = this.defend(battle, player);
        break;
      case 'dodge':
        result = this.dodge(battle, player);
        break;
      case 'item':
        result = this.useItem(battle, player, action.itemType, action.targetId);
        break;
      case 'pass':
        result = { action: 'pass' };
        this.addBattleLog(battle.id, 'action', `${player.name} 패스`);
        break;
      default:
        throw new Error('알 수 없는 액션');
    }

    player.hasActed = true;
    return result;
  }

  // 공격
  attack(battle, attacker, targetId) {
    const target = this.findPlayer(battle, targetId);
    if (!target || !target.alive) throw new Error('대상 없음');

    let dmg = attacker.stats.attack + this.rollDice(20);
    if (attacker.buffs.attack_buff) dmg = Math.floor(dmg * 1.5);

    if (target.isDefending) {
      let def = target.stats.defense;
      if (target.buffs.defense_buff) def = Math.floor(def * 1.5);
      dmg = Math.max(1, dmg - def);
    }

    const crit = this.rollDice(20) >= 20 - Math.floor(attacker.stats.luck / 2);
    if (crit) dmg *= 2;

    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0) target.alive = false;

    this.addBattleLog(battle.id, 'action', `${attacker.name} → ${target.name} ${dmg} 피해`);
    return { damage: dmg, crit, targetAlive: target.alive };
  }

  defend(battle, player) {
    player.isDefending = true;
    this.addBattleLog(battle.id, 'action', `${player.name} 방어`);
    return { action: 'defend' };
  }

  dodge(battle, player) {
    player.isDodging = true;
    this.addBattleLog(battle.id, 'action', `${player.name} 회피`);
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
      this.addBattleLog(battle.id, 'action', `${player.name} → ${target.name} HP +10`);
      return { action: 'heal', target: target.name };
    }

    if (itemType === '공격 보정기') {
      player.buffs.attack_buff = true;
      this.addBattleLog(battle.id, 'action', `${player.name} 공격력 버프`);
      return { action: 'attack_buff' };
    }

    if (itemType === '방어 보정기') {
      player.buffs.defense_buff = true;
      this.addBattleLog(battle.id, 'action', `${player.name} 방어력 버프`);
      return { action: 'defense_buff' };
    }

    throw new Error('알 수 없는 아이템');
  }

  // 유틸
  rollDice(max = 20) {
    return Math.floor(Math.random() * max) + 1;
  }

  findPlayer(battle, id) {
    return [...battle.teams.team1.players, ...battle.teams.team2.players].find(p => p.id === id);
  }

  addBattleLog(battleId, type, message) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.battleLog.push({ type, message, timestamp: Date.now() });
    if (battle.battleLog.length > 100) battle.battleLog.shift();
  }

  addChatMessage(battleId, sender, message, senderType = 'player') {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.chatLog.push({ sender, message, senderType, timestamp: Date.now() });
    if (battle.chatLog.length > 50) battle.chatLog.shift();
  }

  // 인증
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

  spectatorAuth(battleId, otp, name) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: '전투 없음' };
    if (battle.otps.spectator !== otp) return { success: false, message: 'OTP 불일치' };
    return { success: true, battle, spectator: { name } };
  }
}

module.exports = BattleEngine;
