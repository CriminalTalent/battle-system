// packages/battle-server/index.js
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========================
// BattleEngine 클래스
// ========================
class BattleEngine {
  constructor() {
    this.battles = new Map();
  }

  getBattleCount() {
    return this.battles.size;
  }

  generateOTP() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  createBattle(mode = "1v1", adminId = null) {
    const id = crypto.randomBytes(16).toString("hex");
    const configs = {
      "1v1": { playersPerTeam: 1 },
      "2v2": { playersPerTeam: 2 },
      "3v3": { playersPerTeam: 3 },
      "4v4": { playersPerTeam: 4 },
    };
    const config = configs[mode] || configs["1v1"];

    const battle = {
      id,
      mode,
      status: "waiting",
      createdAt: Date.now(),
      adminId,
      teams: {
        team1: { name: "불사조 기사단", players: [] },
        team2: { name: "죽음을 먹는자들", players: [] },
      },
      currentTeam: null,
      currentPlayerIndex: 0,
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
        spectator: this.generateOTP(),
      },
      playerOTPs: new Map(),
    };

    this.battles.set(id, battle);
    this.addBattleLog(id, "system", `[전투생성] 모드: ${mode}`);
    return battle;
  }

  getBattle(id) {
    return this.battles.get(id);
  }

  createPlayerSlot(battleId, { name, team }) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("존재하지 않는 전투");
    if (battle.status !== "waiting") throw new Error("이미 시작된 전투");

    if (!["team1", "team2"].includes(team)) throw new Error("잘못된 팀");
    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam)
      throw new Error("해당 팀 가득 참");

    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players,
    ];
    if (allPlayers.some((p) => p.name === name)) throw new Error("중복된 이름");

    const playerId = crypto.randomBytes(8).toString("hex");
    const playerOTP = this.generateOTP();

    const player = {
      id: playerId,
      name,
      team,
      stats: null,
      inventory: [],
      imageUrl: "",
      hp: 100,
      maxHp: 100,
      alive: true,
      hasActed: false,
      isReady: false,
      isDefending: false,
      isDodging: false,
      buffs: {},
      registered: false,
      connected: false,
    };

    targetTeam.players.push(player);
    battle.playerOTPs.set(playerId, playerOTP);

    this.addBattleLog(battleId, "system", `${player.name} 슬롯이 ${targetTeam.name}에 생성됨`);

    return { player, otp: playerOTP };
  }

  registerPlayer(battleId, playerId, playerOTP, { stats, inventory = [], imageUrl = "" }) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("존재하지 않는 전투");

    const player = this.findPlayer(battle, playerId);
    if (!player) throw new Error("플레이어 슬롯을 찾을 수 없습니다");

    const storedOTP = battle.playerOTPs.get(playerId);
    if (!storedOTP || storedOTP !== playerOTP) throw new Error("잘못된 플레이어 OTP입니다");

    if (player.registered) throw new Error("이미 등록된 플레이어입니다");

    player.stats = this.normalizeStats(stats);
    player.inventory = inventory;
    player.imageUrl = imageUrl;
    player.registered = true;

    this.addBattleLog(battleId, "system", `${player.name}이 캐릭터 등록을 완료했습니다`);

    return player;
  }

  normalizeStats(stats = {}) {
    const clamp = (val) => Math.max(1, Math.min(5, val || 2));
    return {
      attack: clamp(stats.attack),
      defense: clamp(stats.defense),
      agility: clamp(stats.agility),
      luck: clamp(stats.luck),
    };
  }

  startBattle(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("전투 없음");
    if (battle.status !== "waiting") throw new Error("이미 시작됨");

    const allPlayers = [...battle.teams.team1.players, ...battle.teams.team2.players];
    const unregisteredPlayers = allPlayers.filter(p => !p.registered);
    if (unregisteredPlayers.length > 0)
      throw new Error(`${unregisteredPlayers.map(p => p.name).join(', ')} 플레이어가 아직 등록되지 않았습니다`);

    this.determineFirstTeam(battle);
    battle.status = "ongoing";
    battle.turnStartTime = Date.now();
    this.addBattleLog(battleId, "system", "전투 시작!");

    return battle;
  }

  endBattle(battleId, winner = null, reason = "") {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("전투 없음");

    battle.status = "ended";
    battle.winner = winner;
    battle.endReason = reason || "전투 종료";
    battle.endedAt = Date.now();

    if (winner) {
      const winnerTeam = battle.teams[winner];
      this.addBattleLog(battleId, "system", `${winnerTeam ? winnerTeam.name : winner} 팀 승리!`);
    } else {
      this.addBattleLog(battleId, "system", reason || "무승부");
    }

    return battle;
  }

  determineFirstTeam(battle) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    const team1Total = battle.teams.team1.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    const team2Total = battle.teams.team2.players.reduce((s, p) => s + p.stats.agility + roll(), 0);

    if (team1Total > team2Total) {
      battle.currentTeam = "team1";
      this.addBattleLog(battle.id, "system", `${battle.teams.team1.name} 선공 (${team1Total} vs ${team2Total})`);
    } else if (team2Total > team1Total) {
      battle.currentTeam = "team2";
      this.addBattleLog(battle.id, "system", `${battle.teams.team2.name} 선공 (${team2Total} vs ${team1Total})`);
    } else {
      this.addBattleLog(battle.id, "system", "동점! 재굴림");
      this.determineFirstTeam(battle);
    }
  }

  executeAction(battleId, playerId, action) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== "ongoing") throw new Error("진행 중 아님");

    const player = this.findPlayer(battle, playerId);
    if (!player || !player.alive) throw new Error("행동 불가");
    if (player.team !== battle.currentTeam) throw new Error("현재 팀의 턴이 아닙니다");
    if (player.hasActed) throw new Error("이미 행동완료");

    let result;
    switch (action.type) {
      case "attack":
        result = this.attack(battle, player, action.targetId);
        break;
      case "defend":
        result = this.defend(battle, player);
        break;
      case "dodge":
        result = this.dodge(battle, player);
        break;
      case "item":
        result = this.useItem(battle, player, action.itemType, action.targetId);
        break;
      case "pass":
        result = { action: "pass" };
        this.addBattleLog(battle.id, "action", `${player.name} 패스`);
        break;
      default:
        throw new Error("알 수 없는 액션");
    }

    player.hasActed = true;
    this.checkAndAdvanceTurn(battle);
    this.checkVictoryConditions(battle);

    return result;
  }

  checkAndAdvanceTurn(battle) {
    const currentTeamData = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeamData.players.filter(p => p.alive);
    const actedPlayers = alivePlayers.filter(p => p.hasActed);

    if (actedPlayers.length >= alivePlayers.length) {
      this.advanceToNextTeam(battle);
    }
  }

  advanceToNextTeam(battle) {
    battle.teams[battle.currentTeam].players.forEach(p => {
      p.hasActed = false;
      p.isDefending = false;
      p.isDodging = false;
      p.buffs = {};
    });

    battle.currentTeam = battle.currentTeam === "team1" ? "team2" : "team1";
    battle.turnNumber++;
    battle.turnStartTime = Date.now();

    const currentTeamName = battle.teams[battle.currentTeam].name;
    this.addBattleLog(battle.id, "system", `${currentTeamName} 팀 턴 시작 (턴 ${battle.turnNumber})`);

    if (battle.turnNumber > 50) {
      this.handleTimeoutVictory(battle);
    }
  }

  handleTimeoutVictory(battle) {
    const team1HP = battle.teams.team1.players.reduce((sum, p) => sum + p.hp, 0);
    const team2HP = battle.teams.team2.players.reduce((sum, p) => sum + p.hp, 0);

    if (team1HP > team2HP) {
      this.endBattle(battle.id, "team1", `시간 초과 - ${battle.teams.team1.name} 팀 승리 (HP: ${team1HP} vs ${team2HP})`);
    } else if (team2HP > team1HP) {
      this.endBattle(battle.id, "team2", `시간 초과 - ${battle.teams.team2.name} 팀 승리 (HP: ${team2HP} vs ${team1HP})`);
    } else {
      this.endBattle(battle.id, null, `시간 초과 - 무승부 (HP: ${team1HP} vs ${team2HP})`);
    }
  }

  checkVictoryConditions(battle) {
    const team1Alive = battle.teams.team1.players.filter(p => p.alive).length;
    const team2Alive = battle.teams.team2.players.filter(p => p.alive).length;

    if (team1Alive === 0) {
      this.endBattle(battle.id, "team2", `${battle.teams.team2.name} 팀 승리 - 상대 전멸`);
    } else if (team2Alive === 0) {
      this.endBattle(battle.id, "team1", `${battle.teams.team1.name} 팀 승리 - 상대 전멸`);
    }
  }
  attack(battle, attacker, targetId) {
    const target = this.findPlayer(battle, targetId);
    if (!target || !target.alive) throw new Error("대상 없음");

    let dmg = attacker.stats.attack + this.rollDice(20);
    if (attacker.buffs.attack_buff) dmg = Math.floor(dmg * 1.5);

    if (target.isDodging) {
      const dodgeRoll = target.stats.agility + this.rollDice(20);
      if (dodgeRoll >= dmg) {
        this.addBattleLog(battle.id, "action", `${target.name}이 ${attacker.name}의 공격을 회피했습니다!`);
        return { damage: 0, dodged: true, targetAlive: target.alive };
      }
    }

    if (target.isDefending) {
      let def = target.stats.defense;
      if (target.buffs.defense_buff) def = Math.floor(def * 1.5);
      dmg = Math.max(1, dmg - def);

      const counterDmg = target.stats.attack + this.rollDice(20);
      attacker.hp = Math.max(0, attacker.hp - counterDmg);
      if (attacker.hp === 0) attacker.alive = false;

      this.addBattleLog(battle.id, "action", `${target.name}이 방어했습니다! 역공격으로 ${attacker.name}에게 ${counterDmg} 피해`);
    }

    const crit = this.rollDice(20) >= 20 - Math.floor(attacker.stats.luck / 2);
    if (crit) dmg *= 2;

    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0) target.alive = false;

    const critText = crit ? " (치명타!)" : "";
    this.addBattleLog(battle.id, "action", `${attacker.name} → ${target.name} ${dmg} 피해${critText}`);

    return { damage: dmg, crit, targetAlive: target.alive };
  }

  defend(battle, player) {
    player.isDefending = true;
    this.addBattleLog(battle.id, "action", `${player.name} 방어 자세`);
    return { action: "defend" };
  }

  dodge(battle, player) {
    player.isDodging = true;
    this.addBattleLog(battle.id, "action", `${player.name} 회피 자세`);
    return { action: "dodge" };
  }

  useItem(battle, player, itemType, targetId) {
    const idx = player.inventory.indexOf(itemType);
    if (idx === -1) throw new Error("아이템 없음");
    player.inventory.splice(idx, 1);

    if (itemType === "디터니") {
      const target = targetId ? this.findPlayer(battle, targetId) : player;
      if (!target || !target.alive) throw new Error("치료 대상이 올바르지 않습니다");
      target.hp = Math.min(target.maxHp, target.hp + 10);
      this.addBattleLog(battle.id, "action", `${player.name}이 ${target.name}에게 디터니 사용 - HP +10`);
      return { action: "heal", target: target.name };
    }

    if (itemType === "공격 보정기") {
      player.buffs.attack_buff = true;
      this.addBattleLog(battle.id, "action", `${player.name}이 공격 보정기 사용 - 공격력 강화`);
      return { action: "attack_buff" };
    }

    if (itemType === "방어 보정기") {
      player.buffs.defense_buff = true;
      this.addBattleLog(battle.id, "action", `${player.name}이 방어 보정기 사용 - 방어력 강화`);
      return { action: "defense_buff" };
    }

    throw new Error("알 수 없는 아이템");
  }

  rollDice(max = 20) {
    return Math.floor(Math.random() * max) + 1;
  }

  findPlayer(battle, id) {
    return [...battle.teams.team1.players, ...battle.teams.team2.players].find((p) => p.id === id);
  }

  addBattleLog(battleId, type, message) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.battleLog.push({ type, message, timestamp: Date.now() });
    if (battle.battleLog.length > 100) battle.battleLog.shift();
  }

  addChatMessage(battleId, sender, message, senderType = "player") {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.chatLog.push({ sender, message, senderType, timestamp: Date.now() });
    if (battle.chatLog.length > 50) battle.chatLog.shift();
  }

  adminAuth(battleId, otp) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    if (battle.otps.admin !== otp) return { success: false, message: "OTP 불일치" };
    return { success: true, battle };
  }

  playerAuth(battleId, playerId, playerOTP) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    const player = this.findPlayer(battle, playerId);
    if (!player) return { success: false, message: "플레이어 없음" };
    const storedOTP = battle.playerOTPs.get(playerId);
    if (!storedOTP || storedOTP !== playerOTP) {
      return { success: false, message: "플레이어 OTP 불일치" };
    }
    return { success: true, battle, player };
  }

  spectatorAuth(battleId, otp, name) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    if (battle.otps.spectator !== otp) return { success: false, message: "OTP 불일치" };
    return { success: true, battle, spectator: { name } };
  }

  regenerateOTPs(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("전투 없음");
    battle.otps.admin = this.generateOTP();
    battle.otps.player = this.generateOTP();
    battle.otps.spectator = this.generateOTP();
    return battle.otps;
  }

  updatePlayerConnection(battleId, playerId, connected) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    const player = this.findPlayer(battle, playerId);
    if (player) {
      player.connected = connected;
    }
  }
}

// ========================
// Socket.IO
// ========================
io.on("connection", (socket) => {
  console.log("[소켓연결]", socket.id);

  socket.on("adminAuth", ({ battleId, otp }) => {
    const result = engine.adminAuth(battleId, otp);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "admin";
    socket.emit("authSuccess", { role: "admin", battle: result.battle });
  });

  socket.on("playerAuth", ({ battleId, playerId, playerOTP }) => {
    const result = engine.playerAuth(battleId, playerId, playerOTP);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.playerId = playerId;
    socket.role = "player";
    engine.updatePlayerConnection(battleId, playerId, true);
    socket.emit("authSuccess", { role: "player", battle: result.battle, player: result.player });
    io.to(battleId).emit("battleUpdate", engine.getBattle(battleId));
  });

  socket.on("spectatorAuth", ({ battleId, otp, spectatorName }) => {
    const result = engine.spectatorAuth(battleId, otp, spectatorName);
    if (!result.success) return socket.emit("authError", result.message);
    socket.join(battleId);
    socket.battleId = battleId;
    socket.role = "spectator";
    socket.spectatorName = spectatorName;
    socket.emit("authSuccess", { role: "spectator", battle: result.battle });
  });

  socket.on("playerAction", ({ battleId, playerId, action }) => {
    try {
      engine.executeAction(battleId, playerId, action);
      const battle = engine.getBattle(battleId);
      io.to(battleId).emit("battleUpdate", battle);
      socket.emit("actionSuccess");
    } catch (e) {
      socket.emit("actionError", e.message);
    }
  });

  socket.on("chatMessage", ({ message }) => {
    if (!socket.battleId || !message) return;

    let senderName = "알 수 없음";
    if (socket.role === "player") {
      const battle = engine.getBattle(socket.battleId);
      const player = engine.findPlayer(battle, socket.playerId);
      senderName = player ? player.name : "플레이어";
    } else if (socket.role === "spectator") {
      senderName = socket.spectatorName || "관전자";
    } else if (socket.role === "admin") {
      senderName = "관리자";
    }

    engine.addChatMessage(socket.battleId, senderName, message, socket.role);
    io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
  });

  socket.on("cheerMessage", ({ message }) => {
    if (!socket.battleId || socket.role !== "spectator") return;

    const allowedCheers = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    if (!allowedCheers.includes(message)) {
      socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
      return;
    }

    engine.addChatMessage(socket.battleId, socket.spectatorName || "관전자", message, "spectator");
    io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
  });

  socket.on("disconnect", () => {
    console.log("[소켓해제]", socket.id);
    if (socket.role === "player" && socket.battleId && socket.playerId) {
      engine.updatePlayerConnection(socket.battleId, socket.playerId, false);
      io.to(socket.battleId).emit("battleUpdate", engine.getBattle(socket.battleId));
    }
  });
});

// ========================
// 서버 실행
// ========================
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log("========================================");
  console.log("   전투 시스템 서버 실행 중");
  console.log("========================================");
  console.log(`포트: ${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || "development"}`);
  console.log("----------------------------------------");
  console.log(`헬스체크: http://localhost:${PORT}/api/health`);
  console.log(`관리자 페이지: http://localhost:${PORT}/admin.html`);
  console.log(`플레이어 페이지: http://localhost:${PORT}/play.html`);
  console.log(`관전자 페이지: http://localhost:${PORT}/watch.html`);
  console.log("========================================");
});
