/* packages/battle-server/src/socket/battle-handlers.js
 * ────────────────────────────────────────────────────────────────────
 * PYXIS Battle Handlers - Enhanced Socket.IO Server-side Handlers
 * - 스탯 시스템 1-5 범위 완전 적용
 * - 총합 제한 제거된 강화된 검증 시스템
 * - 성능 최적화 및 메모리 관리
 * - 상세한 로깅 및 모니터링
 * - 향상된 에러 처리 및 복구
 * ────────────────────────────────────────────────────────────────────
 */

const { Server } = require('socket.io');
const broadcastManager = require('./broadcast/broadcastManager');

// 데이터 스토어 (프로덕션에서는 Redis/DB 권장)
const battles = new Map();
const players = new Map();
const spectators = new Map();
const admins = new Map();
const connectionMetrics = new Map();

// 보안 및 제한 설정
const SECURITY_LIMITS = {
  MAX_MESSAGE_LENGTH: 500,
  MAX_NAME_LENGTH: 50,
  MAX_CONNECTIONS_PER_IP: 10,
  MAX_BATTLES_PER_HOUR: 5,
  RATE_LIMIT_WINDOW: 60000, // 1분
  MAX_REQUESTS_PER_MINUTE: 30
};

// 게임 규칙 상수 (BattleEngine과 동일)
const GAME_RULES = {
  STAT_MIN: 1,
  STAT_MAX: 5,
  // TOTAL_STAT_POINTS 제거됨
  DEFAULT_HP: 100,
  MIN_HP: 1,
  MAX_HP: 1000
};

// 전투 클래스 강화
class Battle {
  constructor(id, mode = '2v2') {
    this.id = id;
    this.mode = mode;
    this.status = 'waiting';
    this.created = Date.now();
    this.started = null;
    this.ended = null;
    this.lastActivity = Date.now();
    
    // 팀 구성
    this.teams = { A: [], B: [] };
    
    // 턴 관리
    this.currentTurn = 1;
    this.currentTeam = null;
    this.turnStartTime = null;
    this.turnTimeLimit = 5 * 60 * 1000; // 5분
    this.turnTimer = null;
    this.maxTurns = 50;
    
    // 전투 로그
    this.logs = [];
    this.maxLogs = 1000;
    
    // 보안 토큰
    this.adminOtp = this.generateSecureOtp();
    this.spectatorOtp = this.generateSecureOtp();
    this.playerTokens = new Map();
    
    // 통계 추적
    this.stats = {
      totalActions: 0,
      totalDamage: 0,
      totalHealing: 0,
      criticalHits: 0,
      itemsUsed: 0,
      spectatorCount: 0,
      maxSpectators: 0
    };
    
    // 상태 효과 관리
    this.activeEffects = new Map();
    
    // 검증 강화
    this.validateMode();
  }

  validateMode() {
    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    if (!validModes.includes(this.mode)) {
      throw new Error(`잘못된 전투 모드: ${this.mode}`);
    }
  }

  generateSecureOtp() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  generatePlayerToken() {
    return 'PT_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 16);
  }

  // 플레이어 데이터 검증 (스탯 1-5 범위, 총합 제한 없음)
  validatePlayerData(playerData) {
    if (!playerData.name || typeof playerData.name !== 'string') {
      throw new Error('플레이어 이름이 필요합니다');
    }
    
    if (playerData.name.length > SECURITY_LIMITS.MAX_NAME_LENGTH) {
      throw new Error(`이름이 너무 깁니다 (최대 ${SECURITY_LIMITS.MAX_NAME_LENGTH}자)`);
    }
    
    if (!['A', 'B'].includes(playerData.team)) {
      throw new Error('잘못된 팀 선택입니다');
    }
    
    // 스탯 검증 - 각 스탯이 1-5 범위인지 확인 (총합 제한 없음)
    const stats = playerData.stats || {};
    const requiredStats = ['attack', 'defense', 'agility', 'luck'];
    
    for (const statName of requiredStats) {
      const statValue = stats[statName];
      if (typeof statValue !== 'number' || 
          statValue < GAME_RULES.STAT_MIN || 
          statValue > GAME_RULES.STAT_MAX ||
          !Number.isInteger(statValue)) {
        throw new Error(`${statName} 스탯은 ${GAME_RULES.STAT_MIN}-${GAME_RULES.STAT_MAX} 범위의 정수여야 합니다`);
      }
    }
    
    // 중복 이름 검증
    const existingNames = this.getAllPlayers().map(p => p.name.toLowerCase());
    if (existingNames.includes(playerData.name.toLowerCase())) {
      throw new Error('이미 존재하는 플레이어 이름입니다');
    }
    
    // HP 검증
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
        attack: Math.max(GAME_RULES.STAT_MIN, Math.min(GAME_RULES.STAT_MAX, playerData.stats?.attack || 3)),
        defense: Math.max(GAME_RULES.STAT_MIN, Math.min(GAME_RULES.STAT_MAX, playerData.stats?.defense || 3)),
        agility: Math.max(GAME_RULES.STAT_MIN, Math.min(GAME_RULES.STAT_MAX, playerData.stats?.agility || 3)),
        luck: Math.max(GAME_RULES.STAT_MIN, Math.min(GAME_RULES.STAT_MAX, playerData.stats?.luck || 3))
      },
      hp: Math.max(GAME_RULES.MIN_HP, Math.min(GAME_RULES.MAX_HP, playerData.hp || GAME_RULES.DEFAULT_HP)),
      maxHp: Math.max(GAME_RULES.MIN_HP, Math.min(GAME_RULES.MAX_HP, playerData.maxHp || playerData.hp || GAME_RULES.DEFAULT_HP)),
      items: {
        dittany: Math.max(0, Math.min(9, playerData.items?.dittany || 1)),
        attackBoost: Math.max(0, Math.min(9, playerData.items?.attackBoost || 1)),
        defenseBoost: Math.max(0, Math.min(9, playerData.items?.defenseBoost || 1))
      },
      status: 'alive',
      effects: [],
      token: this.generatePlayerToken(),
      joinedAt: Date.now(),
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

  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
              .replace(/[<>\"'&]/g, '')
              .trim();
  }

  generatePlayerId() {
    return 'P_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  }

  getMaxPlayersPerTeam() {
    return parseInt(this.mode.charAt(0));
  }

  updateActivity() {
    this.lastActivity = Date.now();
  }

  addLog(type, message, data = {}) {
    const log = {
      id: 'L_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
      type,
      message: this.sanitizeString(message),
      data,
      timestamp: Date.now(),
      turn: this.currentTurn
    };

    this.logs.push(log);
    
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }

    this.updateActivity();
    return log;
  }

  getAllPlayers() {
    return [...this.teams.A, ...this.teams.B];
  }

  getPlayer(playerId) {
    return this.getAllPlayers().find(p => p.id === playerId);
  }

  getPlayerByToken(token) {
    const playerId = this.playerTokens.get(token);
    return playerId ? this.getPlayer(playerId) : null;
  }

  getAlivePlayersInTeam(team) {
    return this.teams[team].filter(p => p.status === 'alive' && p.hp > 0);
  }

  canStartBattle() {
    const teamACount = this.getAlivePlayersInTeam('A').length;
    const teamBCount = this.getAlivePlayersInTeam('B').length;
    
    return teamACount > 0 && teamBCount > 0 && 
           this.status === 'waiting' &&
           teamACount <= this.getMaxPlayersPerTeam() &&
           teamBCount <= this.getMaxPlayersPerTeam();
  }

  startBattle() {
    if (!this.canStartBattle()) {
      throw new Error('전투를 시작할 수 없습니다. 양 팀에 플레이어가 있어야 합니다.');
    }

    this.status = 'ongoing';
    this.started = Date.now();
    
    // 선공 결정 (민첩성 합계 + 주사위)
    const teamAAgi = this.teams.A.reduce((sum, p) => sum + p.stats.agility, 0) + this.rollDice();
    const teamBAgi = this.teams.B.reduce((sum, p) => sum + p.stats.agility, 0) + this.rollDice();
    
    this.currentTeam = teamAAgi >= teamBAgi ? 'A' : 'B';
    this.startTurn();

    const winningTeam = this.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    this.addLog('system', `전투가 시작되었습니다! ${winningTeam}이 선공합니다.`, {
      teamAAgi,
      teamBAgi,
      firstTeam: this.currentTeam
    });

    this.updateActivity();
  }

  rollDice() {
    return Math.floor(Math.random() * 20) + 1;
  }

  startTurn() {
    this.turnStartTime = Date.now();
    
    // 현재 팀 플레이어들의 액션 초기화
    this.getAlivePlayersInTeam(this.currentTeam).forEach(player => {
      player.actionThisTurn = null;
      this.processEffects(player);
    });
    
    // 자동 패스 타이머 설정
    this.resetTurnTimer();
    this.updateActivity();
  }

  resetTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }
    
    this.turnTimer = setTimeout(() => {
      if (this.status === 'ongoing') {
        this.autoPass();
      }
    }, this.turnTimeLimit);
  }

  processEffects(player) {
    // 지속 효과 처리
    player.effects = player.effects.filter(effect => {
      effect.duration--;
      return effect.duration > 0;
    });
  }

  autoPass() {
    this.addLog('system', '시간 초과로 턴이 자동으로 넘어갑니다.');
    
    // 아직 행동하지 않은 플레이어들을 자동 패스 처리
    this.getAlivePlayersInTeam(this.currentTeam).forEach(player => {
      if (player.actionThisTurn === null) {
        player.actionThisTurn = 'auto_pass';
      }
    });
    
    this.endTurn();
  }

  canEndTurn() {
    const currentTeamPlayers = this.getAlivePlayersInTeam(this.currentTeam);
    return currentTeamPlayers.length === 0 || 
           currentTeamPlayers.every(p => p.actionThisTurn !== null);
  }

  endTurn() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // 승부 판정
    if (this.checkBattleEnd()) {
      return;
    }

    // 턴 제한 확인
    if (this.currentTurn >= this.maxTurns) {
      this.endBattle('timeout');
      return;
    }

    // 턴 교체
    this.currentTeam = this.currentTeam === 'A' ? 'B' : 'A';
    this.currentTurn++;
    
    this.startTurn();
    
    const teamName = this.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    this.addLog('system', `턴 ${this.currentTurn}: ${teamName}의 턴입니다.`);
  }

  checkBattleEnd() {
    const teamAAlive = this.getAlivePlayersInTeam('A');
    const teamBAlive = this.getAlivePlayersInTeam('B');

    if (teamAAlive.length === 0 && teamBAlive.length === 0) {
      this.endBattle('draw');
      return true;
    }
    
    if (teamAAlive.length === 0) {
      this.endBattle('team_b_wins');
      return true;
    }
    
    if (teamBAlive.length === 0) {
      this.endBattle('team_a_wins');
      return true;
    }

    return false;
  }

  endBattle(reason = 'unknown') {
    this.status = 'ended';
    this.ended = Date.now();
    
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    let winner = null;
    let message = '전투가 종료되었습니다.';

    switch (reason) {
      case 'team_a_wins':
        winner = 'A';
        message = '불사조 기사단이 승리했습니다!';
        break;
      case 'team_b_wins':
        winner = 'B';
        message = '죽음을 먹는 자들이 승리했습니다!';
        break;
      case 'draw':
        message = '무승부입니다!';
        break;
      case 'timeout':
        const { winner: timeoutWinner, message: timeoutMessage } = this.determineWinnerByHp();
        winner = timeoutWinner;
        message = timeoutMessage;
        break;
      case 'admin_ended':
        message = '관리자에 의해 전투가 종료되었습니다.';
        break;
    }

    this.addLog('system', message, { winner, reason, finalStats: this.stats });
    this.updateActivity();
  }

  determineWinnerByHp() {
    const teamAHp = this.teams.A.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
    const teamBHp = this.teams.B.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
    
    if (teamAHp > teamBHp) {
      return { winner: 'A', message: '시간 초과! HP 합계로 불사조 기사단이 승리했습니다!' };
    } else if (teamBHp > teamAHp) {
      return { winner: 'B', message: '시간 초과! HP 합계로 죽음을 먹는 자들이 승리했습니다!' };
    } else {
      return { winner: null, message: '시간 초과! HP 합계가 같아 무승부입니다!' };
    }
  }

  // 강화된 액션 처리
  processAction(playerId, action) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('플레이어를 찾을 수 없습니다');
    
    this.validateActionPermissions(player, action);
    
    const result = this.executeAction(player, action);
    player.actionThisTurn = action.type;
    player.lastAction = Date.now();
    player.actionCount++;
    this.stats.totalActions++;

    // 턴 종료 체크
    if (this.canEndTurn()) {
      setTimeout(() => this.endTurn(), 1000);
    }

    this.updateActivity();
    return result;
  }

  validateActionPermissions(player, action) {
    if (this.status !== 'ongoing') {
      throw new Error('전투가 진행 중이 아닙니다');
    }
    
    if (player.team !== this.currentTeam) {
      throw new Error('현재 팀의 턴이 아닙니다');
    }
    
    if (player.status !== 'alive' || player.hp <= 0) {
      throw new Error('사망한 플레이어는 행동할 수 없습니다');
    }
    
    if (player.actionThisTurn !== null) {
      throw new Error('이미 이번 턴에 행동했습니다');
    }

    // 액션별 추가 검증
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

  executeAction(player, action) {
    const roll = this.rollDice();
    
    switch (action.type) {
      case 'attack':
        return this.processAttack(player, action.target, roll);
      case 'defend':
        return this.processDefend(player, roll);
      case 'dodge':
        return this.processDodge(player, roll);
      case 'item':
        return this.processItem(player, action.itemType, action.target, roll);
      case 'pass':
        return this.processPass(player);
      default:
        throw new Error(`알 수 없는 액션 타입: ${action.type}`);
    }
  }

  processAttack(attacker, targetId, roll) {
    const target = this.getPlayer(targetId);
    
    // 공격력 계산 (보정기 적용)
    let attackPower = attacker.stats.attack;
    const attackBoost = attacker.effects.find(e => e.type === 'attackBoost');
    if (attackBoost) {
      attackPower *= attackBoost.multiplier;
    }

    // 명중률 계산
    const hitRoll = attacker.stats.luck + roll;
    
    // 대상의 회피 시도
    const dodgeEffect = target.effects.find(e => e.type === 'dodging');
    if (dodgeEffect && dodgeEffect.value >= hitRoll) {
      target.effects = target.effects.filter(e => e.type !== 'dodging');
      
      this.addLog('action', `${target.name}이(가) ${attacker.name}의 공격을 회피했습니다!`, {
        attacker: attacker.id,
        target: target.id,
        roll,
        dodgeValue: dodgeEffect.value
      });
      
      return { success: true, dodged: true };
    }

    // 치명타 계산
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCritical = roll >= critThreshold;
    
    // 데미지 계산
    let damage = attackPower + roll;
    
    // 대상의 방어 적용
    const defenseEffect = target.effects.find(e => e.type === 'defending');
    if (defenseEffect) {
      damage -= defenseEffect.value;
      target.effects = target.effects.filter(e => e.type !== 'defending');
    } else {
      damage -= target.stats.defense;
    }
    
    // 치명타 적용
    if (isCritical) {
      damage *= 2;
      this.stats.criticalHits++;
    }
    
    // 최소 데미지 보장
    damage = Math.max(1, Math.floor(damage));

    // HP 적용
    target.hp = Math.max(0, target.hp - damage);
    this.stats.totalDamage += damage;
    
    if (target.hp === 0) {
      target.status = 'dead';
    }

    const logMessage = `${attacker.name}이(가) ${target.name}을(를) 공격했습니다! ${isCritical ? '치명타! ' : ''}${damage} 데미지!`;
    this.addLog('action', logMessage, {
      attacker: attacker.id,
      target: target.id,
      damage,
      isCritical,
      roll,
      targetHp: target.hp
    });

    return { success: true, damage, isCritical, targetHp: target.hp };
  }

  processDefend(defender, roll) {
    let defenseValue = defender.stats.defense + roll;
    
    // 방어 보정기 적용
    const defenseBoost = defender.effects.find(e => e.type === 'defenseBoost');
    if (defenseBoost) {
      defenseValue *= defenseBoost.multiplier;
    }
    
    defender.effects.push({
      type: 'defending',
      value: Math.floor(defenseValue),
      duration: 1
    });

    this.addLog('action', `${defender.name}이(가) 방어 자세를 취했습니다! 방어력: ${Math.floor(defenseValue)}`, {
      defender: defender.id,
      defenseValue: Math.floor(defenseValue),
      roll
    });

    return { success: true, defenseValue: Math.floor(defenseValue) };
  }

  processDodge(dodger, roll) {
    const dodgeValue = dodger.stats.agility + roll;
    
    dodger.effects.push({
      type: 'dodging',
      value: dodgeValue,
      duration: 1
    });

    this.addLog('action', `${dodger.name}이(가) 회피 자세를 취했습니다! 민첩성: ${dodgeValue}`, {
      dodger: dodger.id,
      dodgeValue,
      roll
    });

    return { success: true, dodgeValue };
  }

  processItem(user, itemType, targetId, roll) {
    if (user.items[itemType] <= 0) {
      throw new Error('아이템이 부족합니다');
    }

    let target = user;
    if (targetId && targetId !== user.id) {
      target = this.getPlayer(targetId);
      if (!target) throw new Error('대상을 찾을 수 없습니다');
    }

    user.items[itemType]--;
    this.stats.itemsUsed++;
    let result = {};

    switch (itemType) {
      case 'dittany':
        const healAmount = 10;
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + healAmount);
        const actualHeal = target.hp - oldHp;
        this.stats.totalHealing += actualHeal;
        
        this.addLog('action', `${user.name}이(가) ${target.name}에게 디터니를 사용했습니다! HP ${actualHeal} 회복!`, {
          user: user.id,
          target: target.id,
          healAmount: actualHeal,
          targetHp: target.hp
        });
        result = { success: true, healAmount: actualHeal, targetHp: target.hp };
        break;

      case 'attackBoost':
        const successRate = 0.1;
        const success = Math.random() < successRate;
        if (success) {
          user.effects.push({ type: 'attackBoost', multiplier: 1.5, duration: 1 });
        }
        
        this.addLog('action', `${user.name}이(가) 공격 보정기를 ${success ? '성공적으로' : '실패하여'} 사용했습니다.`, {
          user: user.id,
          success
        });
        result = { success, effect: success ? 'attackBoost' : null };
        break;

      case 'defenseBoost':
        const defSuccessRate = 0.1;
        const defSuccess = Math.random() < defSuccessRate;
        if (defSuccess) {
          user.effects.push({ type: 'defenseBoost', multiplier: 1.5, duration: 1 });
        }
        
        this.addLog('action', `${user.name}이(가) 방어 보정기를 ${defSuccess ? '성공적으로' : '실패하여'} 사용했습니다.`, {
          user: user.id,
          success: defSuccess
        });
        result = { success: defSuccess, effect: defSuccess ? 'defenseBoost' : null };
        break;
    }

    return result;
  }

  processPass(player) {
    this.addLog('action', `${player.name}이(가) 턴을 패스했습니다.`, {
      player: player.id
    });

    return { success: true };
  }

  // 플레이어 연결 상태 관리
  setPlayerConnection(playerId, isConnected) {
    const player = this.getPlayer(playerId);
    if (player) {
      player.isConnected = isConnected;
      this.updateActivity();
    }
  }

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
        A: this.teams.A.map(p => ({ ...p, token: undefined })), // 토큰 숨김
        B: this.teams.B.map(p => ({ ...p, token: undefined }))
      },
      logs: this.logs.slice(-50),
      created: this.created,
      started: this.started,
