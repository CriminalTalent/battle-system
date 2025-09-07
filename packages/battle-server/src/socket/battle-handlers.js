/* packages/battle-server/src/socket/battle-handlers.js
 * ────────────────────────────────────────────────────────────────────
 * PYXIS Battle Handlers - Enhanced Socket.IO Server-side Handlers
 * - 스탯 시스템 1-5 범위 완전 적용
 * - 총합 제한 제거된 강화된 검증 시스템
 * - 성능 최적화 및 메모리 관리
 * - 상세한 로깅 및 모니터링
 * - 향상된 에러 처리 및 복구
 * - broadcastManager와의 통합 브로드캐스트
 * - [NEW] 관전자 입장/응원 이벤트 통합
 * ────────────────────────────────────────────────────────────────────
 */

"use strict";

const broadcastManager = require('./broadcast/broadcastManager');

// 메모리 스토어 (프로덕션에서는 Redis/DB 추천)
const battles = new Map();

// 보안 및 제한 설정
const SECURITY_LIMITS = {
  MAX_MESSAGE_LENGTH: 500,
  MAX_NAME_LENGTH: 50,
  MAX_CONNECTIONS_PER_IP: 10,
  MAX_BATTLES_PER_HOUR: 5,
  RATE_LIMIT_WINDOW: 60_000, // 1분
  MAX_REQUESTS_PER_MINUTE: 30
};

// 게임 규칙 상수
const GAME_RULES = {
  STAT_MIN: 1,
  STAT_MAX: 5,
  DEFAULT_HP: 100,
  MIN_HP: 1,
  MAX_HP: 1000
};

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function sanitizeString(str, max = SECURITY_LIMITS.MAX_MESSAGE_LENGTH) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
            .replace(/[<>\"'&]/g, '')
            .trim()
            .slice(0, max);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function dice(d = 20) {
  return Math.floor(Math.random() * d) + 1;
}

function now() { return Date.now(); }

// ─────────────────────────────────────────────
// Battle 클래스
// ─────────────────────────────────────────────
class Battle {
  constructor(id, mode = '2v2') {
    this.id = id;
    this.mode = mode;
    this.status = 'waiting';
    this.created = now();
    this.started = null;
    this.ended = null;
    this.lastActivity = now();

    // 팀
    this.teams = { A: [], B: [] }; // 플레이어 객체 리스트

    // 턴/타이머
    this.currentTurn = 1;
    this.currentTeam = null;     // 'A' | 'B'
    this.turnStartTime = null;
    this.turnTimeLimit = 5 * 60 * 1000; // 5분
    this.turnTimer = null;
    this.maxTurns = 50;

    // 로그
    this.logs = [];
    this.maxLogs = 1000;

    // 토큰
    this.adminOtp = this.generateSecureOtp();
    this.spectatorOtp = this.generateSecureOtp();
    this.playerTokens = new Map(); // token -> playerId

    // 통계
    this.stats = {
      totalActions: 0,
      totalDamage: 0,
      totalHealing: 0,
      criticalHits: 0,
      itemsUsed: 0,
      spectatorCount: 0,
      maxSpectators: 0
    };

    // 상태효과
    this.activeEffects = new Map();

    this.validateMode();
  }

  validateMode() {
    const valid = ['1v1', '2v2', '3v3', '4v4'];
    if (!valid.includes(this.mode)) {
      throw new Error(`잘못된 전투 모드: ${this.mode}`);
    }
  }

  generateSecureOtp() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  generatePlayerToken() {
    return 'PT_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 16);
  }

  sanitizeString(str) { return sanitizeString(str); }

  generatePlayerId() {
    return 'P_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  }

  getMaxPlayersPerTeam() {
    const head = parseInt(this.mode.charAt(0), 10);
    return Number.isFinite(head) ? head : 1;
  }

  updateActivity() { this.lastActivity = now(); }

  addLog(type, message, data = {}) {
    const log = {
      id: 'L_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
      type,
      message: sanitizeString(message),
      data,
      timestamp: now(),
      turn: this.currentTurn
    };
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }
    this.updateActivity();
    return log;
  }

  // ── 검증/추가 ──────────────────────────────────────────────────────
  validatePlayerData(playerData) {
    if (!playerData?.name || typeof playerData.name !== 'string') {
      throw new Error('플레이어 이름이 필요합니다');
    }
    if (playerData.name.length > SECURITY_LIMITS.MAX_NAME_LENGTH) {
      throw new Error(`이름이 너무 깁니다 (최대 ${SECURITY_LIMITS.MAX_NAME_LENGTH}자)`);
    }
    if (!['A', 'B'].includes(playerData.team)) {
      throw new Error('잘못된 팀 선택입니다');
    }

    const stats = playerData.stats || {};
    const reqStats = ['attack', 'defense', 'agility', 'luck'];
    for (const k of reqStats) {
      const v = stats[k];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < GAME_RULES.STAT_MIN || v > GAME_RULES.STAT_MAX) {
        throw new Error(`${k} 스탯은 ${GAME_RULES.STAT_MIN}-${GAME_RULES.STAT_MAX} 범위의 정수여야 합니다`);
      }
    }

    const names = this.getAllPlayers().map(p => p.name.toLowerCase());
    if (names.includes(playerData.name.toLowerCase())) {
      throw new Error('이미 존재하는 플레이어 이름입니다');
    }

    if (playerData.hp && (playerData.hp < GAME_RULES.MIN_HP || playerData.hp > GAME_RULES.MAX_HP)) {
      throw new Error(`HP는 ${GAME_RULES.MIN_HP}-${GAME_RULES.MAX_HP} 범위여야 합니다`);
    }
  }

  addPlayer(playerData) {
    this.validatePlayerData(playerData);

    const maxPerTeam = this.getMaxPlayersPerTeam();
    if (this.teams[playerData.team].length >= maxPerTeam) {
      throw new Error(`${playerData.team}팀이 가득 찼습니다 (최대 ${maxPerTeam}명)`);
    }

    const player = {
      id: this.generatePlayerId(),
      name: this.sanitizeString(playerData.name),
      team: playerData.team,
      stats: {
        attack: clamp(playerData.stats?.attack ?? 3, GAME_RULES.STAT_MIN, GAME_RULES.STAT_MAX),
        defense: clamp(playerData.stats?.defense ?? 3, GAME_RULES.STAT_MIN, GAME_RULES.STAT_MAX),
        agility: clamp(playerData.stats?.agility ?? 3, GAME_RULES.STAT_MIN, GAME_RULES.STAT_MAX),
        luck: clamp(playerData.stats?.luck ?? 3, GAME_RULES.STAT_MIN, GAME_RULES.STAT_MAX)
      },
      hp: clamp(playerData.hp ?? GAME_RULES.DEFAULT_HP, GAME_RULES.MIN_HP, GAME_RULES.MAX_HP),
      maxHp: clamp(playerData.maxHp ?? playerData.hp ?? GAME_RULES.DEFAULT_HP, GAME_RULES.MIN_HP, GAME_RULES.MAX_HP),
      items: {
        dittany: clamp(playerData.items?.dittany ?? 1, 0, 9),
        attackBoost: clamp(playerData.items?.attackBoost ?? 1, 0, 9),
        defenseBoost: clamp(playerData.items?.defenseBoost ?? 1, 0, 9),
      },
      status: 'alive',
      effects: [],
      token: this.generatePlayerToken(),
      joinedAt: now(),
      actionThisTurn: null,
      avatar: playerData.avatar || null,
      lastAction: null,
      actionCount: 0,
      isConnected: false
    };

    this.teams[playerData.team].push(player);
    this.playerTokens.set(player.token, player.id);

    const teamName = player.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    this.addLog('system', `${player.name}이 ${teamName}에 합류했습니다. (공격:${player.stats.attack}, 방어:${player.stats.defense}, 민첩:${player.stats.agility}, 행운:${player.stats.luck})`);
    this.updateActivity();
    return player;
  }

  removePlayer(playerId) {
    for (const t of ['A', 'B']) {
      const idx = this.teams[t].findIndex(p => p.id === playerId);
      if (idx !== -1) {
        const [removed] = this.teams[t].splice(idx, 1);
        this.addLog('system', `${removed.name}이(가) 전투에서 제거되었습니다.`);
        this.updateActivity();
        return true;
      }
    }
    return false;
  }

  getAllPlayers() { return [...this.teams.A, ...this.teams.B]; }
  getPlayer(id) { return this.getAllPlayers().find(p => p.id === id); }
  getPlayerByToken(token) {
    const pid = this.playerTokens.get(token); return pid ? this.getPlayer(pid) : null;
  }
  getAlivePlayersInTeam(team) { return this.teams[team].filter(p => p.status === 'alive' && p.hp > 0); }

  // ── 전투 시작/종료/턴 ───────────────────────────────────────────────
  canStartBattle() {
    const a = this.getAlivePlayersInTeam('A').length;
    const b = this.getAlivePlayersInTeam('B').length;
    return a > 0 && b > 0 && this.status === 'waiting' && a <= this.getMaxPlayersPerTeam() && b <= this.getMaxPlayersPerTeam();
  }

  rollDice() { return dice(20); }

  startBattle() {
    if (!this.canStartBattle()) {
      throw new Error('전투를 시작할 수 없습니다. 양 팀에 플레이어가 있어야 합니다.');
    }
    this.status = 'ongoing';
    this.started = now();

    const teamAAgi = this.teams.A.reduce((s, p) => s + p.stats.agility, 0) + this.rollDice();
    const teamBAgi = this.teams.B.reduce((s, p) => s + p.stats.agility, 0) + this.rollDice();

    this.currentTeam = teamAAgi >= teamBAgi ? 'A' : 'B';
    this.startTurn();

    const firstName = this.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    this.addLog('system', `전투가 시작되었습니다! ${firstName}이 선공합니다.`, { teamAAgi, teamBAgi, firstTeam: this.currentTeam });
    this.updateActivity();
  }

  startTurn() {
    this.turnStartTime = now();

    // 현재 팀 준비
    this.getAlivePlayersInTeam(this.currentTeam).forEach(p => {
      p.actionThisTurn = null;
      this.processEffects(p);
    });

    this.resetTurnTimer();
    this.updateActivity();
  }

  resetTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => {
      if (this.status === 'ongoing') this.autoPass();
    }, this.turnTimeLimit);
  }

  processEffects(player) {
    player.effects = player.effects.filter(e => {
      e.duration--;
      return e.duration > 0;
    });
  }

  autoPass() {
    this.addLog('system', '시간 초과로 턴이 자동으로 넘어갑니다.');
    this.getAlivePlayersInTeam(this.currentTeam).forEach(p => {
      if (p.actionThisTurn === null) p.actionThisTurn = 'auto_pass';
    });
    this.endTurn();
  }

  canEndTurn() {
    const list = this.getAlivePlayersInTeam(this.currentTeam);
    return list.length === 0 || list.every(p => p.actionThisTurn !== null);
  }

  endTurn() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }

    if (this.checkBattleEnd()) return;

    if (this.currentTurn >= this.maxTurns) {
      this.endBattle('timeout');
      return;
    }

    this.currentTeam = this.currentTeam === 'A' ? 'B' : 'A';
    this.currentTurn++;
    this.startTurn();

    const teamName = this.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    this.addLog('system', `턴 ${this.currentTurn}: ${teamName}의 턴입니다.`);
  }

  checkBattleEnd() {
    const a = this.getAlivePlayersInTeam('A');
    const b = this.getAlivePlayersInTeam('B');

    if (a.length === 0 && b.length === 0) { this.endBattle('draw'); return true; }
    if (a.length === 0) { this.endBattle('team_b_wins'); return true; }
    if (b.length === 0) { this.endBattle('team_a_wins'); return true; }
    return false;
  }

  endBattle(reason = 'unknown') {
    this.status = 'ended';
    this.ended = now();
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }

    let winner = null; let message = '전투가 종료되었습니다.';
    switch (reason) {
      case 'team_a_wins': winner = 'A'; message = '불사조 기사단이 승리했습니다!'; break;
      case 'team_b_wins': winner = 'B'; message = '죽음을 먹는 자들이 승리했습니다!'; break;
      case 'draw': message = '무승부입니다!'; break;
      case 'timeout':
        ({ winner, message } = this.determineWinnerByHp());
        break;
      case 'admin_ended': message = '관리자에 의해 전투가 종료되었습니다.'; break;
    }

    this.addLog('system', message, { winner, reason, finalStats: this.stats });
    this.updateActivity();
  }

  determineWinnerByHp() {
    const a = this.teams.A.reduce((s, p) => s + Math.max(0, p.hp), 0);
    const b = this.teams.B.reduce((s, p) => s + Math.max(0, p.hp), 0);
    if (a > b) return { winner: 'A', message: '시간 초과! HP 합계로 불사조 기사단이 승리했습니다!' };
    if (b > a) return { winner: 'B', message: '시간 초과! HP 합계로 죽음을 먹는 자들이 승리했습니다!' };
    return { winner: null, message: '시간 초과! HP 합계가 같아 무승부입니다!' };
  }

  // ── 액션 처리 ───────────────────────────────────────────────────────
  processAction(playerId, action) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('플레이어를 찾을 수 없습니다');

    this.validateActionPermissions(player, action);
    const roll = this.rollDice();

    let result;
    switch (action.type) {
      case 'attack': result = this.processAttack(player, action.target, roll); break;
      case 'defend': result = this.processDefend(player, roll); break;
      case 'dodge':  result = this.processDodge(player, roll); break;
      case 'item':   result = this.processItem(player, action.itemType, action.target, roll); break;
      case 'pass':   result = this.processPass(player); break;
      default: throw new Error(`알 수 없는 액션 타입: ${action.type}`);
    }

    player.actionThisTurn = action.type;
    player.lastAction = now();
    player.actionCount++;
    this.stats.totalActions++;

    if (this.canEndTurn()) setTimeout(() => this.endTurn(), 1000);

    this.updateActivity();
    return result;
  }

  validateActionPermissions(player, action) {
    if (this.status !== 'ongoing') throw new Error('전투가 진행 중이 아닙니다');
    if (player.team !== this.currentTeam) throw new Error('현재 팀의 턴이 아닙니다');
    if (player.status !== 'alive' || player.hp <= 0) throw new Error('사망한 플레이어는 행동할 수 없습니다');
    if (player.actionThisTurn !== null) throw new Error('이미 이번 턴에 행동했습니다');

    if (action.type === 'attack' && action.target) {
      const target = this.getPlayer(action.target);
      if (!target) throw new Error('대상을 찾을 수 없습니다');
      if (target.team === player.team) throw new Error('같은 팀을 공격할 수 없습니다');
      if (target.status !== 'alive' || target.hp <= 0) throw new Error('사망한 대상을 공격할 수 없습니다');
    }

    if (action.type === 'item') {
      if (!player.items[action.itemType] || player.items[action.itemType] <= 0) {
        throw new Error('아이템이 부족합니다');
      }
    }
  }

  processAttack(attacker, targetId, roll) {
    const target = this.getPlayer(targetId);

    // 공격력
    let atk = attacker.stats.attack;
    const atkBoost = attacker.effects.find(e => e.type === 'attackBoost');
    if (atkBoost) atk *= atkBoost.multiplier;

    // 명중
    const hitRoll = attacker.stats.luck + roll;

    // 회피
    const dodgeEffect = target.effects.find(e => e.type === 'dodging');
    if (dodgeEffect && dodgeEffect.value >= hitRoll) {
      target.effects = target.effects.filter(e => e.type !== 'dodging');
      this.addLog('action', `${target.name}이(가) ${attacker.name}의 공격을 회피했습니다!`, {
        attacker: attacker.id, target: target.id, roll, dodgeValue: dodgeEffect.value
      });
      return { success: true, dodged: true };
    }

    // 치명타
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCritical = roll >= critThreshold;

    // 데미지
    let dmg = atk + roll;
    const defEffect = target.effects.find(e => e.type === 'defending');
    if (defEffect) {
      dmg -= defEffect.value;
      target.effects = target.effects.filter(e => e.type !== 'defending');
    } else {
      dmg -= target.stats.defense;
    }
    if (isCritical) { dmg *= 2; this.stats.criticalHits++; }
    dmg = Math.max(1, Math.floor(dmg));

    target.hp = Math.max(0, target.hp - dmg);
    this.stats.totalDamage += dmg;
    if (target.hp === 0) target.status = 'dead';

    const msg = `${attacker.name}이(가) ${target.name}을(를) 공격했습니다! ${isCritical ? '치명타! ' : ''}${dmg} 데미지!`;
    this.addLog('action', msg, { attacker: attacker.id, target: target.id, damage: dmg, isCritical, roll, targetHp: target.hp });

    return { success: true, damage: dmg, isCritical, targetHp: target.hp };
  }

  processDefend(defender, roll) {
    let val = defender.stats.defense + roll;
    const boost = defender.effects.find(e => e.type === 'defenseBoost');
    if (boost) val *= boost.multiplier;

    const finalVal = Math.floor(val);
    defender.effects.push({ type: 'defending', value: finalVal, duration: 1 });

    this.addLog('action', `${defender.name}이(가) 방어 자세를 취했습니다! 방어력: ${finalVal}`, {
      defender: defender.id, defenseValue: finalVal, roll
    });

    return { success: true, defenseValue: finalVal };
  }

  processDodge(dodger, roll) {
    const dodgeValue = dodger.stats.agility + roll;
    dodger.effects.push({ type: 'dodging', value: dodgeValue, duration: 1 });

    this.addLog('action', `${dodger.name}이(가) 회피 자세를 취했습니다! 민첩성: ${dodgeValue}`, {
      dodger: dodger.id, dodgeValue, roll
    });

    return { success: true, dodgeValue };
  }

  processItem(user, itemType, targetId, _roll) {
    if ((user.items[itemType] ?? 0) <= 0) throw new Error('아이템이 부족합니다');

    let target = user;
    if (targetId && targetId !== user.id) {
      target = this.getPlayer(targetId);
      if (!target) throw new Error('대상을 찾을 수 없습니다');
    }

    user.items[itemType]--;
    this.stats.itemsUsed++;

    switch (itemType) {
      case 'dittany': {
        const heal = 10;
        const before = target.hp;
        target.hp = clamp(target.hp + heal, 0, target.maxHp);
        const actual = target.hp - before;
        this.stats.totalHealing += actual;
        this.addLog('action', `${user.name}이(가) ${target.name}에게 디터니를 사용했습니다! HP ${actual} 회복!`, {
          user: user.id, target: target.id, healAmount: actual, targetHp: target.hp
        });
        return { success: true, healAmount: actual, targetHp: target.hp };
      }
      case 'attackBoost': {
        const ok = Math.random() < 0.1;
        if (ok) user.effects.push({ type: 'attackBoost', multiplier: 1.5, duration: 1 });
        this.addLog('action', `${user.name}이(가) 공격 보정기를 ${ok ? '성공적으로' : '실패하여'} 사용했습니다.`, { user: user.id, success: ok });
        return { success: ok, effect: ok ? 'attackBoost' : null };
      }
      case 'defenseBoost': {
        const ok = Math.random() < 0.1;
        if (ok) user.effects.push({ type: 'defenseBoost', multiplier: 1.5, duration: 1 });
        this.addLog('action', `${user.name}이(가) 방어 보정기를 ${ok ? '성공적으로' : '실패하여'} 사용했습니다.`, { user: user.id, success: ok });
        return { success: ok, effect: ok ? 'defenseBoost' : null };
      }
      default:
        throw new Error(`지원하지 않는 아이템: ${itemType}`);
    }
  }

  processPass(player) {
    this.addLog('action', `${player.name}이(가) 턴을 패스했습니다.`, { player: player.id });
    return { success: true };
  }

  // 연결 상태
  setPlayerConnection(playerId, isConnected) {
    const p = this.getPlayer(playerId);
    if (p) { p.isConnected = isConnected; this.updateActivity(); }
  }

  // 스냅샷
  getSnapshot() {
    return {
      id: this.id,
      mode: this.mode,
      status: this.status,
      currentTurn: this.currentTurn,
      currentTeam: this.currentTeam,
      turnStartTime: this.turnStartTime,
      turnTimeLimit: this.turnTimeLimit,
      teams: {
        A: this.teams.A.map(p => ({ ...p, token: undefined })),
        B: this.teams.B.map(p => ({ ...p, token: undefined }))
      },
      logs: this.logs.slice(-50),
      created: this.created,
      started: this.started,
      ended: this.ended,
      lastActivity: this.lastActivity,
      stats: this.stats
    };
  }
}

// ─────────────────────────────────────────────
// 배틀 팩토리 & 저장소 API
// ─────────────────────────────────────────────
function createBattle({ id, mode = '2v2' }) {
  if (!id || typeof id !== 'string') throw new Error('battle id가 필요합니다');
  if (battles.has(id)) throw new Error('이미 존재하는 battle id입니다');
  const b = new Battle(id, mode);
  battles.set(id, b);
  return b;
}
function getBattle(id) { return battles.get(id) || null; }
function removeBattle(id) { return battles.delete(id); }
function listBattles() { return Array.from(battles.values()).map(b => b.getSnapshot()); }

// ─────────────────────────────────────────────
// Socket.IO 바인딩
// ─────────────────────────────────────────────
/**
 * attach(io): battle 네임스페이스 이벤트를 바인딩합니다.
 * 브로드캐스트는 broadcastManager를 통해 처리합니다.
 */
function attach(io) {
  // broadcastManager는 서버 전역에서 이미 init되어 있을 수 있음
  // 이 모듈 단독 사용 시 보조 init
  if (!broadcastManager.initialized) {
    broadcastManager.init(io, {
      verbose: process.env.NODE_ENV === 'development',
      enableMetrics: true,
      batchEnabled: process.env.NODE_ENV === 'production'
    });
  }

  io.on('connection', (socket) => {
    // 소켓 메타(관전자 연결수 집계를 위해)
    socket.data = socket.data || {};
    socket.data.role = null;
    socket.data.battleId = null;
    socket.data.spectatorName = null;

    // battle 생성
    socket.on('battle:create', ({ battleId, mode = '2v2', players = [] } = {}, ack) => {
      try {
        const battle = createBattle({ id: battleId, mode });

        // 초기 플레이어 세팅(선택)
        const added = [];
        for (const p of players) {
          try { added.push(battle.addPlayer(p)); } catch (_) {}
        }

        // 스냅샷 & 알림
        const snap = battle.getSnapshot();
        broadcastManager.broadcastBattleEvent(battleId, 'created', { snapshot: snap });
        ack?.({
          ok: true,
          snapshot: snap,
          added: added.map(p => p.id),
          adminOtp: battle.adminOtp,
          spectatorOtp: battle.spectatorOtp
        });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // 플레이어 추가/삭제
    socket.on('battle:player:add', ({ battleId, player } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        const added = battle.addPlayer(player);
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());
        broadcastManager.broadcastBattleEvent(battleId, 'player_added', { player: { ...added, token: undefined } });
        ack?.({ ok: true, player: { ...added, token: undefined } });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    socket.on('battle:player:remove', ({ battleId, playerId } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        const ok = battle.removePlayer(playerId);
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());
        if (ok) broadcastManager.broadcastBattleEvent(battleId, 'player_removed', { playerId });
        ack?.({ ok: true, removed: ok });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // 전투 시작/종료
    socket.on('battle:start', ({ battleId } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        battle.startBattle();
        broadcastManager.broadcastBattleEvent(battleId, 'started', { snapshot: battle.getSnapshot() });
        broadcastManager.broadcastTurnEvent(battleId, 'start', { turn: battle.currentTurn, currentTeam: battle.currentTeam });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    socket.on('battle:end', ({ battleId, reason = 'admin_ended' } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        battle.endBattle(reason);
        broadcastManager.broadcastBattleEvent(battleId, 'ended', { reason, snapshot: battle.getSnapshot() });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // 액션
    socket.on('battle:action', ({ battleId, playerId, action } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        const result = battle.processAction(playerId, action);

        // 액션에 따른 상태 브로드캐스트(HP/로그 등 포함)
        broadcastManager.broadcastBattleEvent(battleId, 'action', { playerId, action, result, turn: battle.currentTurn });
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        ack?.({ ok: true, result });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // 스냅샷 요청
    socket.on('battle:snapshot', ({ battleId } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        ack?.({ ok: true, snapshot: battle.getSnapshot() });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // ─────────────────────────────────────────
    // [NEW] 관전자 입장
    // ─────────────────────────────────────────
    socket.on('spectator:join', ({ battleId, otp, name } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');
        if (otp !== battle.spectatorOtp) throw new Error('잘못된 OTP입니다');

        const safeName = sanitizeString(name, SECURITY_LIMITS.MAX_NAME_LENGTH) || '관전자';
        socket.join(battleId);
        socket.data.role = 'spectator';
        socket.data.battleId = battleId;
        socket.data.spectatorName = safeName;

        battle.stats.spectatorCount++;
        if (battle.stats.spectatorCount > battle.stats.maxSpectators) {
          battle.stats.maxSpectators = battle.stats.spectatorCount;
        }

        ack?.({ ok: true, snapshot: battle.getSnapshot() });
        socket.emit('spectator:join_ok', { ok: true });

        // 로그 및 브로드캐스트
        const entry = battle.addLog('system', `${safeName}님이 관전에 참여했습니다.`);
        broadcastManager.broadcastBattleEvent(battleId, 'log', { entry });
        broadcastManager.broadcastBattleEvent(battleId, 'spectator_joined', { name: safeName });

      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // ─────────────────────────────────────────
    // [NEW] 관전자 응원
    // ─────────────────────────────────────────
    socket.on('spectator:cheer', ({ battleId, name, msg } = {}, ack) => {
      try {
        const battle = getBattle(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const safeName = sanitizeString(name, SECURITY_LIMITS.MAX_NAME_LENGTH) || '관전자';
        const safeMsg = sanitizeString(msg, 100);
        if (!safeMsg) throw new Error('응원 메시지를 입력하세요');

        // 로그 기록 (cheer 타입)
        const entry = battle.addLog('cheer', `${safeName}: ${safeMsg}`);

        // 채팅 + 로그 브로드캐스트
        broadcastManager.broadcastBattleEvent(battleId, 'chat', { name: safeName, msg: safeMsg, role: 'spectator' });
        broadcastManager.broadcastBattleEvent(battleId, 'log', { entry });

        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // ─────────────────────────────────────────
    // 연결 해제 처리 (관전자 카운트 다운)
    // ─────────────────────────────────────────
    socket.on('disconnect', () => {
      try {
        const { role, battleId } = socket.data || {};
        if (!battleId || role !== 'spectator') return;
        const battle = getBattle(battleId);
        if (!battle) return;
        if (battle.stats.spectatorCount > 0) {
          battle.stats.spectatorCount--;
        }
      } catch (_) {}
    });
  });

  console.log('[BattleHandlers] attached');
  return { battles, createBattle, getBattle, listBattles, removeBattle };
}

module.exports = {
  Battle,
  battles,
  createBattle,
  getBattle,
  listBattles,
  removeBattle,
  attach
};
