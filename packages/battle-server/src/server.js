// packages/battle-server/src/services/BattleEngine.js
// - 전투 수명주기: 생성 → (대기) → 시작(ongoing) → 종료(ended)
// - 준비(ready) → 모든 플레이어 준비 완료 후에만 startBattle 허용
// - 액션: attack / defend(가드 대상 지정 지원) / dodge / riposte(역공) / item / pass / ready
// - 회피(50% 완전회피, 1회성), 방어(피해 경감), 가드(아군 대신 피해), 역공(피격 후 1회 반격)
// - 팀 전멸 즉시 종료(무승부 방지: 양 전멸 시 현재 팀의 상대를 승자로 처리)
// - 턴 로직: 팀 전원 행동 시 턴 전환, 새 턴에서 방어/회피/역공/가드 만료, turnDeadline 갱신
// - 유틸: listBattles / refreshOtps / updatePlayerConnection / toJSON / pruneStaleBattles
// - 인증: adminAuth / playerAuth / spectatorAuth
const crypto = require("crypto");

class BattleEngine {
  /**
   * @param {{turnSeconds?:number, maxPlayersPerBattle?:number}} opts
   */
  constructor(opts = {}) {
    this.battles = new Map();
    this.turnSeconds = Number.isFinite(opts.turnSeconds) ? opts.turnSeconds : 45;
    this.maxPlayersPerBattle = Number.isFinite(opts.maxPlayersPerBattle) ? opts.maxPlayersPerBattle : 8;
  }

  // ───────────────────── 기본 유틸 ─────────────────────
  getBattleCount() {
    return this.battles.size;
  }
  generateOTP(len = 8) {
    return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
  }
  rollDice(max = 20) {
    return Math.floor(Math.random() * max) + 1;
  }
  _now() { return Date.now(); }

  // ───────────────────── 전투 수명주기 ─────────────────────
  createBattle(mode = "1v1", adminId = null) {
    const id = crypto.randomBytes(16).toString("hex");
    const configs = {
      "1v1": { playersPerTeam: 1 },
      "2v2": { playersPerTeam: 2 },
      "3v3": { playersPerTeam: 3 },
      "4v4": { playersPerTeam: 4 },
    };
    const config = configs[mode] || configs["1v1"];
    const now = this._now();

    const battle = {
      id,
      mode,
      status: "waiting", // waiting → ongoing → ended
      createdAt: now,
      adminId,
      teams: {
        team1: { name: "불사조 기사단", players: [] },
        team2: { name: "죽음을 먹는 자들", players: [] },
      },
      // 호환 필드
      players: [],
      spectators: [],

      // 진행 상태
      config,
      currentTeam: null,
      roundNumber: 1,
      turnNumber: 1,
      turnStartTime: null,
      turnDeadline: null,

      // 로그
      battleLog: [{ type: "system", message: `[전투생성] 모드: ${mode}`, timestamp: now }],
      chatLog: [],
      notice: { text: "" },

      // 결과
      winner: null,
      endReason: null,

      // OTP (단수/복수 키 동시 제공)
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        players: [this.generateOTP(), this.generateOTP()],
        spectator: this.generateOTP(),
        spectators: this.generateOTP(),
      },
    };

    this.battles.set(id, battle);
    return battle;
  }

  listBattles() {
    return [...this.battles.values()].map((b) => ({
      id: b.id,
      mode: b.mode,
      status: b.status,
      playerCount:
        (b.teams?.team1?.players?.length || 0) +
        (b.teams?.team2?.players?.length || 0),
      createdAt: b.createdAt || this._now(),
    }));
  }

  refreshOtps(battleId) {
    const b = this.getBattle(battleId);
    if (!b) throw new Error("전투 없음");
    b.otps.admin = this.generateOTP();
    b.otps.player = this.generateOTP();
    b.otps.players = [this.generateOTP(), this.generateOTP()];
    b.otps.spectator = this.generateOTP();
    b.otps.spectators = this.generateOTP();
    return b;
  }

  toJSON() {
    return { battles: this.listBattles() };
  }

  getBattle(id) {
    return this.battles.get(id);
  }

  // ───────────────────── 플레이어 관리 ─────────────────────
  addPlayer(battleId, { name, team, stats, inventory = [], imageUrl = "" }) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error("존재하지 않는 전투");
    if (battle.status !== "waiting") throw new Error("이미 시작된 전투");
    if (!["team1", "team2"].includes(team)) throw new Error("잘못된 팀");

    // 전체 인원 제한
    const total =
      (battle.teams.team1.players?.length || 0) +
      (battle.teams.team2.players?.length || 0);
    if (total >= this.maxPlayersPerBattle) throw new Error("전투 인원 초과");

    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam)
      throw new Error("해당 팀 가득 참");

    // 중복 이름 방지
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players,
    ];
    if (allPlayers.some((p) => p.name === name)) throw new Error("중복된 이름");

    const player = {
      id: crypto.randomBytes(8).toString("hex"),
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory: Array.isArray(inventory) ? inventory.slice() : [],
      imageUrl,
      hp: 100,
      maxHp: 100,
      alive: true,

      // 턴/상태
      hasActed: false,
      isReady: false,
      isDefending: false,
      guardTargetId: null,     // 방어 대상(가드)
      isDodging: false,
      riposte: false,          // 역공 준비

      // 기타
      online: false,
      buffs: {},
      lastSeenAt: null,
    };

    targetTeam.players.push(player);
    battle.players.push(player);

    this.addBattleLog(battleId, "system", `${player.name}이 ${targetTeam.name}에 참가`);
    return player;
  }

  updatePlayerConnection(battleId, playerId, online) {
    const b = this.getBattle(battleId);
    if (!b) return;
    const p = this.findPlayer(b, playerId);
    if (!p) return;
    p.online = !!online;
    p.lastSeenAt = this._now();
  }

  setPlayerReady(battleId, playerId, ready = true) {
    const b = this.getBattle(battleId);
    if (!b || b.status !== "waiting") throw new Error("대기 중 아님");
    const p = this.findPlayer(b, playerId);
    if (!p) throw new Error("플레이어 없음");
    p.isReady = !!ready;
    this.addBattleLog(battleId, "system", `${p.name} 전투 준비 ${ready ? "완료" : "해제"}`);
    return p.isReady;
  }

  allPlayersReady(battle) {
    const t1 = battle.teams.team1.players;
    const t2 = battle.teams.team2.players;
    if (!t1.length || !t2.length) return false;
    return [...t1, ...t2].every((p) => p.isReady);
  }

  // ───────────────────── 전투 진행 ─────────────────────
  startBattle(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("전투 없음");
    if (battle.status !== "waiting") throw new Error("이미 시작됨");
    if (!this.allPlayersReady(battle)) throw new Error("모든 플레이어가 준비되지 않음");
    if (!battle.teams.team1.players.length || !battle.teams.team2.players.length)
      throw new Error("양 팀에 최소 1명 필요");

    this.determineFirstTeam(battle);
    battle.status = "ongoing";
    this._openTurnWindow(battle);
    this.addBattleLog(battleId, "system", "전투 시작!");
    return battle;
  }

  endBattle(battleId, winnerOrReason = null, maybeReason = "") {
    const battle = this.getBattle(battleId);
    if (!battle) return false;

    let winner = null;
    let reason = "";
    const isTeamKey = (v) => v === "team1" || v === "team2";

    if (typeof winnerOrReason === "string" && !maybeReason && !isTeamKey(winnerOrReason)) {
      winner = null;
      reason = winnerOrReason;
    } else {
      winner = winnerOrReason || null;
      reason = maybeReason || (winner ? `${winner} 승리` : "전투 종료");
    }

    battle.status = "ended";
    battle.winner = winner;
    battle.endReason = reason;
    battle.endedAt = this._now();

    if (winner && isTeamKey(winner)) {
      const team = battle.teams[winner];
      this.addBattleLog(battleId, "system", `${team ? team.name : winner} 팀 승리!`);
    } else {
      this.addBattleLog(battleId, "system", reason || "무승부");
    }

    // 종료 시 메모리에서 제거
    this.battles.delete(battleId);
    return true;
  }

  determineFirstTeam(battle) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    const t1 = battle.teams.team1.players.reduce((s, p) => s + p.stats.agility + roll(), 0);
    const t2 = battle.teams.team2.players.reduce((s, p) => s + p.stats.agility + roll(), 0);

    if (t1 > t2) {
      battle.currentTeam = "team1";
      this.addBattleLog(battle.id, "system", `${battle.teams.team1.name} 선공`);
    } else if (t2 > t1) {
      battle.currentTeam = "team2";
      this.addBattleLog(battle.id, "system", `${battle.teams.team2.name} 선공`);
    } else {
      this.addBattleLog(battle.id, "system", "동점! 재굴림");
      this.determineFirstTeam(battle);
    }
  }

  _openTurnWindow(battle) {
    battle.turnStartTime = this._now();
    battle.turnDeadline = battle.turnStartTime + this.turnSeconds * 1000;
  }

  _allActedThisTurn(battle) {
    const members = battle.teams[battle.currentTeam].players.filter((p) => p.alive);
    return members.length > 0 && members.every((p) => p.hasActed);
  }

  _flipTeam(teamKey) {
    return teamKey === "team1" ? "team2" : "team1";
  }

  _clearExpiredStancesFor(teamPlayers) {
    // 새 턴이 시작된 팀(자기 차례)에게서는 방어/회피/역공/가드 만료
    for (const p of teamPlayers) {
      p.isDefending = false;
      p.isDodging = false;
      p.riposte = false;
      p.guardTargetId = null;
    }
  }

  _nextTurn(battle) {
    const nextTeam = this._flipTeam(battle.currentTeam);

    // 새 턴이 시작되는 팀은 지난 적 턴 동안 유지되던 방어/회피/역공/가드 만료
    this._clearExpiredStancesFor(battle.teams[nextTeam].players);

    // hasActed 초기화: 이전 팀 전원
    for (const p of battle.teams[battle.currentTeam].players) p.hasActed = false;

    battle.currentTeam = nextTeam;
    battle.turnNumber += 1;
    if (nextTeam === "team1") battle.roundNumber += 1;

    this._openTurnWindow(battle);
    this.addBattleLog(battle.id, "system", `턴 전환 → 현재 팀: ${battle.currentTeam}`);
  }

  _checkWipeAndEnd(battle) {
    const alive1 = battle.teams.team1.players.some((p) => p.alive);
    const alive2 = battle.teams.team2.players.some((p) => p.alive);
    if (alive1 && alive2) return false;
    const winner = alive1 ? "team1" : alive2 ? "team2" : null;
    // 무승부 방지: 둘 다 전멸이면 현재 팀의 상대를 승자로
    const resolved = winner || this._flipTeam(battle.currentTeam);
    this.endBattle(battle.id, resolved, "전멸로 종료");
    return true;
  }

  // ───────────────────── 액션 처리 ─────────────────────
  normalizeStats(stats = {}) {
    const clamp = (v) => Math.max(1, Math.min(5, v ?? 2));
    return {
      attack: clamp(stats.attack),
      defense: clamp(stats.defense),
      agility: clamp(stats.agility),
      luck: clamp(stats.luck),
    };
  }

  findPlayer(battle, id) {
    return [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players,
    ].find((p) => p.id === id);
  }

  executeAction(battleId, playerId, action) {
    const battle = this.getBattle(battleId);
    if (!battle) throw new Error("전투 없음");

    // READY는 대기중에서도 허용
    if (action?.type === "ready") {
      return { action: "ready", ready: this.setPlayerReady(battleId, playerId, true) };
    }
    if (battle.status !== "ongoing") throw new Error("진행 중 아님");

    const player = this.findPlayer(battle, playerId);
    if (!player || !player.alive) throw new Error("행동 불가");
    if (player.team !== battle.currentTeam) throw new Error("턴 아님");
    if (player.hasActed) throw new Error("이미 행동");

    let result;
    switch (action.type) {
      case "attack":
        result = this._actAttack(battle, player, action.targetId);
        break;
      case "defend":
        result = this._actDefend(battle, player, action.targetId);
        break;
      case "dodge":
        result = this._actDodge(battle, player);
        break;
      case "riposte":
        result = this._actRiposte(battle, player);
        break;
      case "item":
        result = this._actItem(battle, player, action.itemType, action.targetId);
        break;
      case "pass":
        result = { action: "pass" };
        this.addBattleLog(battle.id, "action", `${player.name} 턴 패스`);
        break;
      default:
        throw new Error("알 수 없는 액션");
    }

    player.hasActed = true;

    // 전멸 체크
    if (this._checkWipeAndEnd(battle)) return result;

    // 팀 전원 행동 → 턴 전환
    if (this._allActedThisTurn(battle)) this._nextTurn(battle);

    return result;
  }

  // 공격(가드/회피/방어/치명타/역공 반응 포함)
  _actAttack(battle, attacker, targetId) {
    let target = this.findPlayer(battle, targetId);
    if (!target || !target.alive) throw new Error("대상 없음");
    if (target.team === attacker.team) throw new Error("아군 공격 불가");

    // 가드: 아군이 방어 중이며 guardTargetId가 대상이면 공격이 가드에게 이동
    const guards = battle.teams[target.team].players.filter(
      (p) => p.alive && p.isDefending && p.guardTargetId === target.id
    );
    if (guards.length) {
      guards.sort((a, b) => b.stats.agility - a.stats.agility);
      const guard = guards[0];
      this.addBattleLog(battle.id, "action", `${guard.name} 가드 발동 → ${target.name} 대신 피해`);
      target = guard;
    }

    // 회피: 50% 확률 완전 회피(소모)
    if (target.isDodging) {
      const miss = this.rollDice(100) <= 50;
      target.isDodging = false;
      if (miss) {
        this.addBattleLog(battle.id, "action", `${attacker.name}의 공격 → ${target.name} 회피!`);
        return { action: "attack", hit: false, damage: 0, target: target.name };
      }
    }

    // 피해 계산
    let dmg = attacker.stats.attack + this.rollDice(20);
    if (attacker.buffs.attack_buff) dmg = Math.floor(dmg * 1.5);

    // 방어 경감(가드 포함)
    if (target.isDefending) {
      let def = target.stats.defense;
      if (target.buffs.defense_buff) def = Math.floor(def * 1.5);
      dmg = Math.max(1, dmg - def);
    }

    // 치명타
    const crit = this.rollDice(20) >= 20 - Math.floor(attacker.stats.luck / 2);
    if (crit) dmg *= 2;

    // 적용
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0) target.alive = false;

    this.addBattleLog(battle.id, "action", `${attacker.name} → ${target.name} ${dmg} 피해${crit ? " (치명)" : ""}`);

    // 역공(피격 후 1회 반격, 방어 무시 성격): 설명 상 "데미지를 모두 맞고 상대에게 데미지"
    if (target.riposte && target.alive) {
      target.riposte = false;
      const ripDmg = target.stats.attack + this.rollDice(12);
      attacker.hp = Math.max(0, attacker.hp - ripDmg);
      if (attacker.hp === 0) attacker.alive = false;
      this.addBattleLog(battle.id, "action", `↳ ${target.name}의 역공! ${attacker.name}에게 ${ripDmg} 피해`);
    }

    return {
      action: "attack",
      hit: true,
      damage: dmg,
      crit,
      targetAlive: target.alive,
      targetId: target.id,
    };
  }

  // 방어(자기 자신 or 아군 가드)
  _actDefend(battle, player, targetId) {
    player.isDefending = true;
    player.guardTargetId = null;

    if (targetId && targetId !== player.id) {
      const ally = this.findPlayer(battle, targetId);
      if (!ally || ally.team !== player.team) throw new Error("가드 대상은 아군이어야 함");
      if (!ally.alive) throw new Error("사망자 가드 불가");
      player.guardTargetId = ally.id;
      this.addBattleLog(battle.id, "action", `${player.name} 가드 자세 → ${ally.name} 보호`);
      return { action: "defend", guard: ally.id };
    }

    this.addBattleLog(battle.id, "action", `${player.name} 방어`);
    return { action: "defend", guard: null };
  }

  _actDodge(battle, player) {
    player.isDodging = true;
    this.addBattleLog(battle.id, "action", `${player.name} 회피 자세`);
    return { action: "dodge" };
  }

  _actRiposte(battle, player) {
    player.riposte = true;
    this.addBattleLog(battle.id, "action", `${player.name} 역공 준비(피격 시 반격)`);
    return { action: "riposte" };
  }

  _actItem(battle, player, itemType, targetId) {
    const idx = player.inventory.findIndex((it) => String(it) === String(itemType));
    if (idx === -1) throw new Error("아이템 없음");
    player.inventory.splice(idx, 1); // 1개 소모

    if (itemType === "디터니") {
      const target = targetId ? this.findPlayer(battle, targetId) : player;
      if (!target) throw new Error("대상 없음");
      target.hp = Math.min(target.maxHp, target.hp + 10);
      this.addBattleLog(battle.id, "action", `${player.name} → ${target.name} HP +10`);
      return { action: "heal", targetId: target.id, amount: 10 };
    }

    if (itemType === "공격 보정기") {
      player.buffs.attack_buff = true;
      this.addBattleLog(battle.id, "action", `${player.name} 공격력 버프`);
      return { action: "attack_buff" };
    }

    if (itemType === "방어 보정기") {
      player.buffs.defense_buff = true;
      this.addBattleLog(battle.id, "action", `${player.name} 방어력 버프`);
      return { action: "defense_buff" };
    }

    throw new Error("알 수 없는 아이템");
  }

  // ───────────────────── 로그/채팅/정리 ─────────────────────
  addBattleLog(battleId, type, message) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    battle.battleLog.push({ type, message, timestamp: this._now() });
    if (battle.battleLog.length > 200) battle.battleLog.shift();
  }

  /**
   * 채팅 저장
   * @param {string} battleId
   * @param {string} sender
   * @param {string} message
   * @param {'player'|'spectator'|'admin'|'system'} senderType
   * @param {{teamOnly?: boolean}} opts
   */
  addChatMessage(battleId, sender, message, senderType = "player", opts = {}) {
    const battle = this.getBattle(battleId);
    if (!battle) return;
    const entry = {
      sender,
      message: String(message).slice(0, 500),
      senderType,
      teamOnly: !!opts.teamOnly,
      timestamp: this._now(),
    };
    battle.chatLog.push(entry);
    if (battle.chatLog.length > 200) battle.chatLog.shift();
  }

  /**
   * 오래된/종료된 전투 정리(선택적)
   * 기본: 상태가 ended이고 종료 후 60분이 지난 전투 제거
   */
  pruneStaleBattles(maxAgeMs = 60 * 60 * 1000) {
    const now = this._now();
    for (const [id, b] of this.battles.entries()) {
      if (b.status === "ended" && b.endedAt && now - b.endedAt > maxAgeMs) {
        this.battles.delete(id);
      }
    }
  }

  // ───────────────────── 인증 ─────────────────────
  adminAuth(battleId, otp) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    if (battle.otps.admin !== otp) return { success: false, message: "OTP 불일치" };
    return { success: true, battle };
  }

  playerAuth(battleId, otp, playerId) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    if (battle.otps.player !== otp && !battle.otps.players?.includes(otp))
      return { success: false, message: "OTP 불일치" };
    const player = this.findPlayer(battle, playerId);
    if (!player) return { success: false, message: "플레이어 없음" };
    return { success: true, battle, player };
  }

  spectatorAuth(battleId, otp, name) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, message: "전투 없음" };
    if (battle.otps.spectator !== otp && battle.otps.spectators !== otp)
      return { success: false, message: "OTP 불일치" };
    return { success: true, battle, spectator: { name } };
  }
}

module.exports = BattleEngine;
