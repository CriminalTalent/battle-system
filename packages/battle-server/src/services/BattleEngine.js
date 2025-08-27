// packages/battle-api/src/services/BattleEngine.js
const crypto = require("crypto");

class BattleEngine {
  constructor() {
    this.battles = new Map();
    this.turnTimers = new Map();
  }

  /** ================================
   *  전투 생성
   *  ================================ */
  createBattle(mode = "1v1", adminId = null) {
    const battleId = crypto.randomBytes(16).toString("hex");
    const config = this.getBattleConfig(mode);

    const battle = {
      id: battleId,
      mode,
      status: "waiting", // waiting, ongoing, ended
      createdAt: Date.now(),
      adminId,

      teams: {
        team1: { name: "불사조 기사단", players: [] },
        team2: { name: "죽음을 먹는자들", players: [] },
      },

      // 전투 상태
      currentTeam: null,
      roundNumber: 1,
      turnNumber: 1,
      turnStartTime: null,

      // 로그
      battleLog: [],
      chatLog: [],

      // 설정
      config,

      // OTP (만료 시간 포함)
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        spectator: this.generateOTP(),
      },
      otpExpiry: {
        admin: Date.now() + 60 * 60 * 1000, // 1시간
        player: Date.now() + 30 * 60 * 1000, // 30분
        spectator: Date.now() + 30 * 60 * 1000,
      },
    };

    this.battles.set(battleId, battle);
    this.log(battle, "system", `전투 생성 완료 [${mode}] (ID: ${battleId})`);

    return battle;
  }

  getBattleConfig(mode) {
    return {
      playersPerTeam: parseInt(mode.split("v")[0]) || 1,
      maxTurns: 50,
      baseHp: 100,
    };
  }

  generateOTP() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /** ================================
   *  플레이어 관리
   *  ================================ */
  addPlayer(battleId, playerData) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error("존재하지 않는 전투입니다");
    if (battle.status !== "waiting") throw new Error("이미 시작된 전투입니다");

    const { name, team, stats, inventory = [], imageUrl = "" } = playerData;
    if (!["team1", "team2"].includes(team)) throw new Error("잘못된 팀");

    const teamObj = battle.teams[team];
    if (teamObj.players.length >= battle.config.playersPerTeam)
      throw new Error("팀 정원 초과");

    // 이름 중복 방지
    if (
      [...battle.teams.team1.players, ...battle.teams.team2.players].some(
        (p) => p.name === name
      )
    )
      throw new Error("이미 존재하는 이름");

    const player = {
      id: crypto.randomBytes(8).toString("hex"),
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory: [...inventory],
      buffs: {},

      // 상태
      hp: battle.config.baseHp,
      maxHp: battle.config.baseHp,
      alive: true,
      hasActed: false,
      isDefending: false,
      isDodging: false,

      // 기타
      imageUrl,
      connected: false,
      socketId: null,
    };

    teamObj.players.push(player);
    this.log(battle, "system", `${player.name} (${teamObj.name}) 참가`);

    return player;
  }

  normalizeStats(stats = {}) {
    return {
      attack: Math.max(1, Math.min(5, stats.attack || 2)),
      defense: Math.max(1, Math.min(5, stats.defense || 2)),
      agility: Math.max(1, Math.min(5, stats.agility || 2)),
      luck: Math.max(1, Math.min(5, stats.luck || 2)),
    };
  }

  /** ================================
   *  전투 시작 / 진행
   *  ================================ */
  startBattle(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error("전투 없음");
    if (battle.status !== "waiting") throw new Error("이미 시작됨");

    this.determineFirstTeam(battle);

    battle.status = "ongoing";
    battle.turnStartTime = Date.now();
    this.log(battle, "system", "전투 시작!");

    this.startTeamTurn(battleId);
    return battle;
  }

  determineFirstTeam(battle) {
    const calc = (team) =>
      team.players.reduce((sum, p) => sum + p.stats.agility + this.dice(20), 0);

    const t1 = calc(battle.teams.team1);
    const t2 = calc(battle.teams.team2);

    if (t1 > t2) battle.currentTeam = "team1";
    else if (t2 > t1) battle.currentTeam = "team2";
    else return this.determineFirstTeam(battle); // 동점 재굴림

    this.log(
      battle,
      "system",
      `${battle.teams[battle.currentTeam].name}이(가) 선공`
    );
  }

  startTeamTurn(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== "ongoing") return;

    if (this.checkVictoryCondition(battle)) {
      this.endBattle(battleId);
      return;
    }

    const team = battle.teams[battle.currentTeam];
    const alive = team.players.filter((p) => p.alive);

    if (!alive.length) {
      battle.winner = battle.currentTeam === "team1" ? "team2" : "team1";
      return this.endBattle(battleId);
    }

    this.log(battle, "system", `===== ${team.name} 턴 시작 =====`);
    alive.forEach((p) => {
      p.hasActed = false;
      p.isDefending = false;
      p.isDodging = false;
    });

    battle.turnStartTime = Date.now();
    this.setTurnTimer(battleId);
  }

  endTeamTurn(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    const team = battle.teams[battle.currentTeam];
    this.log(battle, "system", `===== ${team.name} 턴 종료 =====`);

    // 버프 정리
    team.players.forEach((p) => {
      if (p.buffs.attack_buff) {
        p.buffs.attack_buff = false;
        this.log(battle, "system", `${p.name} 공격 버프 해제`);
      }
      if (p.buffs.defense_buff) {
        p.buffs.defense_buff = false;
        this.log(battle, "system", `${p.name} 방어 버프 해제`);
      }
    });

    // 타이머 해제
    if (this.turnTimers.has(battleId)) {
      clearTimeout(this.turnTimers.get(battleId));
      this.turnTimers.delete(battleId);
    }

    battle.currentTeam = battle.currentTeam === "team1" ? "team2" : "team1";
    battle.turnNumber++;
    this.startTeamTurn(battleId);
  }

  checkTeamTurnEnd(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;
    const team = battle.teams[battle.currentTeam];
    if (team.players.filter((p) => p.alive).every((p) => p.hasActed)) {
      this.endTeamTurn(battleId);
    }
  }

  /** ================================
   *  액션 처리
   *  ================================ */
  executeAction(battleId, playerId, action) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== "ongoing")
      throw new Error("진행 중인 전투가 아님");

    const player = this.findPlayer(battle, playerId);
    if (!player?.alive) throw new Error("행동 불가");

    if (player.hasActed) throw new Error("이미 행동함");
    if (player.team !== battle.currentTeam)
      throw new Error("상대 팀 턴임");

    let result;
    switch (action.type) {
      case "attack":
        result = this.actionAttack(battle, player, action.targetId);
        break;
      case "defend":
        result = this.actionDefend(battle, player);
        break;
      case "dodge":
        result = this.actionDodge(battle, player);
        break;
      case "item":
        result = this.actionItem(battle, player, action.itemType, action.targetId);
        break;
      case "pass":
        result = this.actionPass(battle, player);
        break;
      default:
        throw new Error("잘못된 액션");
    }

    player.hasActed = true;
    this.checkTeamTurnEnd(battleId);
    return result;
  }

  actionAttack(battle, attacker, targetId) {
    const target = this.findPlayer(battle, targetId);
    if (!target?.alive) throw new Error("대상 없음");

    const atkRoll = this.dice(20);
    let power = attacker.stats.attack + atkRoll;

    if (attacker.buffs.attack_buff) power = Math.floor(power * 1.5);

    // 회피 체크
    if (target.isDodging) {
      const dodgeRoll = target.stats.agility + this.dice(20);
      if (dodgeRoll >= power) {
        this.log(battle, "dodge", `${target.name} 회피 성공!`);
        return { dodged: true };
      }
    }

    // 방어 체크
    let dmg = power;
    if (target.isDefending) {
      let def = target.stats.defense;
      if (target.buffs.defense_buff) def = Math.floor(def * 1.5);
      dmg = Math.max(1, dmg - def);
    }

    // 치명타 체크 (luck × 5%)
    const critChance = target.stats.luck * 5;
    if (this.dice(100) <= critChance) {
      dmg *= 2;
      this.log(battle, "crit", `${attacker.name} 치명타!`);
    }

    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp <= 0) {
      target.alive = false;
      this.log(battle, "system", `${target.name} 전투불능`);
    }

    return { hit: true, damage: dmg, targetHp: target.hp };
  }

  actionDefend(battle, player) {
    player.isDefending = true;
    this.log(battle, "action", `${player.name} 방어 태세`);
    return { defend: true };
  }

  actionDodge(battle, player) {
    player.isDodging = true;
    this.log(battle, "action", `${player.name} 회피 준비`);
    return { dodge: true };
  }

  actionItem(battle, player, itemType, targetId) {
    const idx = player.inventory.findIndex((i) => i === itemType);
    if (idx === -1) throw new Error("아이템 없음");
    player.inventory.splice(idx, 1);

    let result = {};
    switch (itemType) {
      case "공격 보정기":
        player.buffs.attack_buff = true;
        this.log(battle, "action", `${player.name} 공격 보정기 사용`);
        result = { buff: "attack" };
        break;
      case "방어 보정기":
        player.buffs.defense_buff = true;
        this.log(battle, "action", `${player.name} 방어 보정기 사용`);
        result = { buff: "defense" };
        break;
      case "디터니":
        const tgt = targetId ? this.findPlayer(battle, targetId) : player;
        const heal = 10;
        tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
        this.log(battle, "heal", `${player.name} → ${tgt.name} HP +${heal}`);
        result = { heal, target: tgt.name };
        break;
      case "피닉스의 깃털":
        const dead = targetId ? this.findPlayer(battle, targetId) : player;
        if (!dead || dead.alive) throw new Error("부활 대상 아님");
        dead.alive = true;
        dead.hp = Math.floor(dead.maxHp / 2);
        this.log(battle, "system", `${dead.name} 부활! (HP ${dead.hp})`);
        result = { revive: true, target: dead.name };
        break;
    }
    return result;
  }

  actionPass(battle, player) {
    this.log(battle, "action", `${player.name} 턴 넘김`);
    return { pass: true };
  }

  /** ================================
   *  전투 종료
   *  ================================ */
  checkVictoryCondition(battle) {
    const alive1 = battle.teams.team1.players.filter((p) => p.alive).length;
    const alive2 = battle.teams.team2.players.filter((p) => p.alive).length;

    if (!alive1) {
      battle.winner = "team2";
      return true;
    }
    if (!alive2) {
      battle.winner = "team1";
      return true;
    }
    if (battle.turnNumber >= battle.config.maxTurns) {
      const hp1 = battle.teams.team1.players.reduce((s, p) => s + p.hp, 0);
      const hp2 = battle.teams.team2.players.reduce((s, p) => s + p.hp, 0);
      if (hp1 > hp2) battle.winner = "team1";
      else if (hp2 > hp1) battle.winner = "team2";
      else battle.winner = null;
      return true;
    }
    return false;
  }

  endBattle(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;
    battle.status = "ended";
    this.turnTimers.delete(battleId);

    if (battle.winner) {
      this.log(
        battle,
        "system",
        `===== 전투 종료: ${battle.teams[battle.winner].name} 승리 =====`
      );
    } else {
      this.log(battle, "system", "===== 전투 종료: 무승부 =====");
    }
  }

  /** ================================
   *  유틸
   *  ================================ */
  dice(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  findPlayer(battle, id) {
    return [...battle.teams.team1.players, ...battle.teams.team2.players].find(
      (p) => p.id === id
    );
  }

  log(battle, type, msg) {
    battle.battleLog.push({ type, message: msg, timestamp: Date.now() });
    if (battle.battleLog.length > 200) battle.battleLog.shift();
  }
}

module.exports = BattleEngine;
