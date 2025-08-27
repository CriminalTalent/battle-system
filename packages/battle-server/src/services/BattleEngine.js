// packages/battle-server/services/BattleEngine.js
const crypto = require("crypto");

class BattleEngine {
  constructor() {
    this.battles = new Map();
    this.turnTimers = new Map();
  }

  static BASE_HP = 100;
  static STAT_MIN = 1;
  static STAT_MAX = 5;
  static TURN_TIMEOUT = 5 * 60 * 1000; // 5분
  static MAX_TURNS = 50;

  static ITEM_INFO = {
    "공격 보정기": { type: "attack_buff", effect: { attack: 1.5 }, duration: 1 },
    "방어 보정기": { type: "defense_buff", effect: { defense: 1.5 }, duration: 1 },
    "디터니": { type: "heal", effect: { heal: 10 } }
  };

  /** 주사위 굴림 (1~20) */
  rollDice() {
    return Math.floor(Math.random() * 20) + 1;
  }

  /** OTP 생성 */
  generateOTP() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  /** 스탯 정규화 */
  normalizeStats(stats = {}) {
    return {
      attack: Math.min(Math.max(stats.attack ?? 2, BattleEngine.STAT_MIN), BattleEngine.STAT_MAX),
      defense: Math.min(Math.max(stats.defense ?? 2, BattleEngine.STAT_MIN), BattleEngine.STAT_MAX),
      agility: Math.min(Math.max(stats.agility ?? 2, BattleEngine.STAT_MIN), BattleEngine.STAT_MAX),
      luck: Math.min(Math.max(stats.luck ?? 2, BattleEngine.STAT_MIN), BattleEngine.STAT_MAX),
    };
  }

  /** 전투 생성 */
  createBattle(mode = "1v1", adminId = null) {
    const id = crypto.randomBytes(16).toString("hex");
    const config = { "1v1":1, "2v2":2, "3v3":3, "4v4":4 }[mode] || 1;

    const battle = {
      id,
      mode,
      status: "waiting", // waiting, ongoing, ended
      createdAt: Date.now(),
      adminId,
      teams: {
        team1: { name: "불사조 기사단", players: [] },
        team2: { name: "죽음을 먹는자들", players: [] }
      },
      config: { playersPerTeam: config },
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        spectator: this.generateOTP()
      },
      currentTeam: null,
      turnNumber: 1,
      roundNumber: 1,
      turnStartTime: null,
      battleLog: [],
      chatLog: [],
      winner: null,
      endReason: null
    };

    this.battles.set(id, battle);
    return battle;
  }

  /** 플레이어 추가 */
  addPlayer(battleId, playerData) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error("존재하지 않는 전투");
    if (battle.status !== "waiting") throw new Error("이미 시작됨");

    const { name, team, stats, inventory = [], imageUrl = "" } = playerData;
    if (!["team1", "team2"].includes(team)) throw new Error("잘못된 팀");

    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam) {
      throw new Error("팀 인원 초과");
    }

    // 이름 중복 체크
    if ([...battle.teams.team1.players, ...battle.teams.team2.players].some(p => p.name === name)) {
      throw new Error("중복 이름");
    }

    const player = {
      id: crypto.randomBytes(8).toString("hex"),
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory,
      imageUrl,
      hp: BattleEngine.BASE_HP,
      maxHp: BattleEngine.BASE_HP,
      alive: true,
      hasActed: false,
      isDefending: false,
      isDodging: false,
      buffs: {}
    };

    targetTeam.players.push(player);
    this.addBattleLog(battleId, "system", `${player.name}이 ${targetTeam.name}에 참가`);
    return player;
  }

  /** 전투 시작 */
  startBattle(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error("전투 없음");
    if (battle.status !== "waiting") throw new Error("이미 시작됨");

    battle.status = "ongoing";
    battle.turnStartTime = Date.now();
    this.determineFirstTeam(battle);
    this.addBattleLog(battleId, "system", "전투 시작!");
    return battle;
  }

  /** 선공 결정 */
  determineFirstTeam(battle) {
    const team1Total = battle.teams.team1.players.reduce((s, p) => s + p.stats.agility + this.rollDice(), 0);
    const team2Total = battle.teams.team2.players.reduce((s, p) => s + p.stats.agility + this.rollDice(), 0);

    if (team1Total > team2Total) battle.currentTeam = "team1";
    else if (team2Total > team1Total) battle.currentTeam = "team2";
    else this.determineFirstTeam(battle); // 동점이면 다시
  }

  /** 액션 실행 */
  executeAction(battleId, playerId, action) {
    const battle = this.battles.get(battleId);
    const player = this.findPlayer(battle, playerId);
    if (!battle || !player) throw new Error("잘못된 요청");

    switch (action.type) {
      case "attack": return this.executeAttack(battle, player, action.targetId);
      case "defend": return this.executeDefend(battle, player);
      case "dodge": return this.executeDodge(battle, player);
      case "item": return this.executeItem(battle, player, action.itemType, action.targetId);
      case "pass": return this.executePass(battle, player);
      default: throw new Error("알 수 없는 액션");
    }
  }

  executeAttack(battle, attacker, targetId) {
    const target = this.findPlayer(battle, targetId);
    if (!target || !target.alive) throw new Error("대상 없음");

    let attackPower = attacker.stats.attack + this.rollDice();
    if (attacker.buffs.attack_buff) attackPower = Math.floor(attackPower * 1.5);

    let damage = attackPower;
    if (target.isDefending) {
      damage = Math.max(1, attackPower - target.stats.defense);
    }

    if (this.rollDice() >= 20 - Math.floor(attacker.stats.luck / 2)) damage *= 2;

    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) target.alive = false;

    this.addBattleLog(battle.id, "action", `${attacker.name} -> ${target.name} ${damage} 데미지`);
    return { damage, targetHp: target.hp };
  }

  executeDefend(battle, player) {
    player.isDefending = true;
    this.addBattleLog(battle.id, "action", `${player.name} 방어`);
  }

  executeDodge(battle, player) {
    player.isDodging = true;
    this.addBattleLog(battle.id, "action", `${player.name} 회피 준비`);
  }

  executeItem(battle, player, itemType, targetId) {
    if (!BattleEngine.ITEM_INFO[itemType]) throw new Error("아이템 없음");
    const item = BattleEngine.ITEM_INFO[itemType];

    if (item.type === "heal") {
      const target = targetId ? this.findPlayer(battle, targetId) : player;
      target.hp = Math.min(target.maxHp, target.hp + item.effect.heal);
      this.addBattleLog(battle.id, "action", `${player.name} → ${target.name} HP +${item.effect.heal}`);
    } else {
      player.buffs[item.type] = true;
      this.addBattleLog(battle.id, "action", `${player.name} ${itemType} 사용`);
    }
  }

  executePass(battle, player) {
    this.addBattleLog(battle.id, "action", `${player.name} 턴 넘김`);
  }

  /** 로그 */
  addBattleLog(battleId, type, message) {
    const battle = this.battles.get(battleId);
    if (!battle) return;
    battle.battleLog.push({ type, message, timestamp: Date.now() });
    if (battle.battleLog.length > 100) battle.battleLog.shift();
  }

  findPlayer(battle, playerId) {
    return [...battle.teams.team1.players, ...battle.teams.team2.players].find(p => p.id === playerId);
  }

  getBattle(battleId) {
    return this.battles.get(battleId);
  }
}

module.exports = BattleEngine;
