/* packages/battle-server/src/socket/battle-handlers.js
 * ────────────────────────────────────────────────────────────────────
 * PYXIS Battle Handlers - Enhanced Socket.IO Server-side Handlers
 * - 강화된 보안 및 검증 시스템
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
    
    // 스탯 검증
    const stats = playerData.stats || {};
    const totalStats = (stats.attack || 1) + (stats.defense || 1) + 
                      (stats.agility || 1) + (stats.luck || 1);
                      
    if (totalStats > 12) {
      throw new Error('스탯 합계가 12를 초과할 수 없습니다');
    }
    
    // 각 스탯이 1-10 범위인지 확인
    Object.values(stats).forEach(stat => {
      if (stat < 1 || stat > 10) {
        throw new Error('각 스탯은 1-10 범위여야 합니다');
      }
    });
    
    // 중복 이름 검증
    const existingNames = this.getAllPlayers().map(p => p.name.toLowerCase());
    if (existingNames.includes(playerData.name.toLowerCase())) {
      throw new Error('이미 존재하는 플레이어 이름입니다');
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
        attack: Math.max(1, Math.min(10, playerData.stats?.attack || 1)),
        defense: Math.max(1, Math.min(10, playerData.stats?.defense || 1)),
        agility: Math.max(1, Math.min(10, playerData.stats?.agility || 1)),
        luck: Math.max(1, Math.min(10, playerData.stats?.luck || 1))
      },
      hp: playerData.maxHp || 100,
      maxHp: playerData.maxHp || 100,
      items: {
        dittany: Math.max(0, playerData.items?.dittany || 1),
        attackBoost: Math.max(0, playerData.items?.attackBoost || 1),
        defenseBoost: Math.max(0, playerData.items?.defenseBoost || 1)
      },
      status: 'alive',
      effects: [],
      token: this.generatePlayerToken(),
      joinedAt: Date.now(),
      actionThisTurn: null,
      avatar: playerData.avatar || null,
      lastAction: null,
      actionCount: 0
    };

    this.teams[playerData.team].push(player);
    this.playerTokens.set(player.token, player.id);
    
    this.addLog('system', `${player.name}이 ${player.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'}에 합류했습니다.`);
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
      ended: this.ended,
      lastActivity: this.lastActivity,
      stats: this.stats,
      spectatorCount: this.stats.spectatorCount
    };
  }

  cleanup() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    
    this.playerTokens.clear();
    this.activeEffects.clear();
  }
}

// 레이트 리미터
class RateLimiter {
  constructor() {
    this.requests = new Map();
  }

  isAllowed(socketId, limit = SECURITY_LIMITS.MAX_REQUESTS_PER_MINUTE) {
    const now = Date.now();
    const windowStart = now - SECURITY_LIMITS.RATE_LIMIT_WINDOW;
    
    if (!this.requests.has(socketId)) {
      this.requests.set(socketId, []);
    }
    
    const userRequests = this.requests.get(socketId);
    
    // 오래된 요청 제거
    while (userRequests.length > 0 && userRequests[0] < windowStart) {
      userRequests.shift();
    }
    
    if (userRequests.length >= limit) {
      return false;
    }
    
    userRequests.push(now);
    return true;
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - SECURITY_LIMITS.RATE_LIMIT_WINDOW;
    
    for (const [socketId, requests] of this.requests.entries()) {
      while (requests.length > 0 && requests[0] < windowStart) {
        requests.shift();
      }
      
      if (requests.length === 0) {
        this.requests.delete(socketId);
      }
    }
  }
}

const rateLimiter = new RateLimiter();

// 정리 작업 스케줄러
setInterval(() => {
  rateLimiter.cleanup();
  
  // 비활성 전투 정리
  const now = Date.now();
  const maxInactivity = 2 * 60 * 60 * 1000; // 2시간
  
  for (const [battleId, battle] of battles.entries()) {
    if (now - battle.lastActivity > maxInactivity) {
      console.log(`[Cleanup] 비활성 전투 제거: ${battleId}`);
      battle.cleanup();
      battles.delete(battleId);
    }
  }
}, 60 * 1000); // 1분마다

// Socket.IO 서버 초기화 함수
function initializeSocketHandlers(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000,
    connectTimeout: 60000,
    maxHttpBufferSize: 1e6 // 1MB
  });

  // BroadcastManager 초기화
  broadcastManager.init(io, {
    verbose: process.env.NODE_ENV === 'development',
    enableMetrics: true,
    batchEnabled: true
  });

  // IP별 연결 추적
  const connectionsByIp = new Map();

  function trackConnection(socket) {
    const ip = socket.handshake.address;
    if (!connectionsByIp.has(ip)) {
      connectionsByIp.set(ip, new Set());
    }
    connectionsByIp.get(ip).add(socket.id);
    
    // IP별 연결 제한 확인
    if (connectionsByIp.get(ip).size > SECURITY_LIMITS.MAX_CONNECTIONS_PER_IP) {
      console.log(`[Security] IP ${ip}에서 과도한 연결 시도`);
      socket.emit('error', 'Too many connections from this IP');
      socket.disconnect(true);
      return false;
    }
    
    return true;
  }

  function untrackConnection(socket) {
    const ip = socket.handshake.address;
    if (connectionsByIp.has(ip)) {
      connectionsByIp.get(ip).delete(socket.id);
      if (connectionsByIp.get(ip).size === 0) {
        connectionsByIp.delete(ip);
      }
    }
  }

  // 유틸리티 함수들
  function sanitizeInput(input, maxLength = SECURITY_LIMITS.MAX_MESSAGE_LENGTH) {
    if (typeof input !== 'string') return '';
    return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
                .replace(/[<>\"'&]/g, '')
                .trim()
                .slice(0, maxLength);
  }

  function validateBattleAccess(battleId, socket) {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('authError', '존재하지 않는 전투입니다');
      return null;
    }
    return battle;
  }

  function logActivity(socket, action, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${socket.id} - ${action}`, data);
  }

  // 메인 연결 이벤트
  io.on('connection', (socket) => {
    if (!trackConnection(socket)) return;
    
    console.log(`[Socket] 새 연결: ${socket.id} (IP: ${socket.handshake.address})`);
    
    let authenticated = false;
    let role = null;
    let battleId = null;
    let playerId = null;
    let lastActivity = Date.now();

    // 활동 추적
    function updateActivity() {
      lastActivity = Date.now();
    }

    // 레이트 리미터 확인
    function checkRateLimit() {
      if (!rateLimiter.isAllowed(socket.id)) {
        socket.emit('error', 'Rate limit exceeded');
        return false;
      }
      return true;
    }

    // 인증 상태 확인
    function requireAuth() {
      if (!authenticated) {
        socket.emit('authError', '인증이 필요합니다');
        return false;
      }
      return true;
    }

    // 역할 권한 확인
    function requireRole(requiredRole) {
      if (!requireAuth()) return false;
      if (role !== requiredRole) {
        socket.emit('authError', '권한이 없습니다');
        return false;
      }
      return true;
    }

    // 관리자 인증
    socket.on('adminAuth', ({ battleId: bid, otp }) => {
      try {
        if (!checkRateLimit()) return;
        if (authenticated) return;
        
        const battle = validateBattleAccess(bid, socket);
        if (!battle) return;

        if (battle.adminOtp !== otp) {
          logActivity(socket, 'ADMIN_AUTH_FAILED', { battleId: bid });
          return socket.emit('authError', '잘못된 관리자 OTP입니다');
        }

        authenticated = true;
        role = 'admin';
        battleId = bid;
        updateActivity();

        broadcastManager.joinSocketToRooms(socket, battleId, role, null, { withRoleRooms: true });
        admins.set(socket.id, { battleId, role, socketId: socket.id, joinedAt: Date.now() });

        socket.emit('authSuccess', { 
          role: 'admin', 
          battleId,
          state: battle.getSnapshot()
        });

        logActivity(socket, 'ADMIN_AUTH_SUCCESS', { battleId });
      } catch (error) {
        logActivity(socket, 'ADMIN_AUTH_ERROR', { error: error.message });
        socket.emit('authError', error.message);
      }
    });

    // 플레이어 인증
    socket.on('playerAuth', ({ battleId: bid, playerId: pid, otp }) => {
      try {
        if (!checkRateLimit()) return;
        if (authenticated) return;
        
        const battle = validateBattleAccess(bid, socket);
        if (!battle) return;

        const player = battle.getPlayer(pid);
        if (!player) {
          return socket.emit('authError', '존재하지 않는 플레이어입니다');
        }

        if (player.token !== otp) {
          logActivity(socket, 'PLAYER_AUTH_FAILED', { battleId: bid, playerId: pid });
          return socket.emit('authError', '잘못된 플레이어 토큰입니다');
        }

        authenticated = true;
        role = 'player';
        battleId = bid;
        playerId = pid;
        updateActivity();

        broadcastManager.joinSocketToRooms(socket, battleId, role, player.team);
        players.set(socket.id, { 
          battleId, 
          playerId, 
          role, 
          team: player.team,
          socketId: socket.id,
          joinedAt: Date.now()
        });

        socket.emit('authSuccess', { 
          role: 'player', 
          battleId,
          playerId,
          playerData: { ...player, token: undefined },
          state: battle.getSnapshot()
        });

        battle.addLog('system', `${player.name}이 전투에 참여했습니다.`);
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        logActivity(socket, 'PLAYER_AUTH_SUCCESS', { battleId, playerId: pid, playerName: player.name });
      } catch (error) {
        logActivity(socket, 'PLAYER_AUTH_ERROR', { error: error.message });
        socket.emit('authError', error.message);
      }
    });

    // 관전자 인증
    socket.on('spectatorAuth', ({ battleId: bid, otp, spectatorName = '관전자' }) => {
      try {
        if (!checkRateLimit()) return;
        if (authenticated) return;
        
        const battle = validateBattleAccess(bid, socket);
        if (!battle) return;

        if (battle.spectatorOtp !== otp) {
          logActivity(socket, 'SPECTATOR_AUTH_FAILED', { battleId: bid });
          return socket.emit('authError', '잘못된 관전자 OTP입니다');
        }

        authenticated = true;
        role = 'spectator';
        battleId = bid;
        updateActivity();
        
        const spectatorData = {
          name: sanitizeInput(spectatorName, 50),
          battleId,
          role,
          socketId: socket.id,
          joinedAt: Date.now()
        };

        broadcastManager.joinSocketToRooms(socket, battleId, role);
        spectators.set(socket.id, spectatorData);
        battle.stats.spectatorCount++;
        battle.stats.maxSpectators = Math.max(battle.stats.maxSpectators, battle.stats.spectatorCount);

        socket.emit('authSuccess', {
          role: 'spectator',
          battleId,
          spectatorData,
          state: battle.getSnapshot()
        });

        battle.addLog('system', `관전자 ${spectatorData.name}이 입장했습니다.`);
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        logActivity(socket, 'SPECTATOR_AUTH_SUCCESS', { battleId, name: spectatorData.name });
      } catch (error) {
        logActivity(socket, 'SPECTATOR_AUTH_ERROR', { error: error.message });
        socket.emit('authError', error.message);
      }
    });

    // 관리자 전용 이벤트들
    socket.on('admin:createBattle', ({ mode = '2v2' }) => {
      try {
        if (!requireRole('admin')) return;
        if (!checkRateLimit()) return;

        const newBattleId = 'B_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
        const battle = new Battle(newBattleId, mode);
        battles.set(newBattleId, battle);

        socket.emit('admin:battleCreated', {
          battleId: newBattleId,
          adminOtp: battle.adminOtp,
          spectatorOtp: battle.spectatorOtp,
          state: battle.getSnapshot()
        });

        logActivity(socket, 'BATTLE_CREATED', { battleId: newBattleId, mode });
      } catch (error) {
        logActivity(socket, 'BATTLE_CREATE_ERROR', { error: error.message });
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:addPlayer', (playerData) => {
      try {
        if (!requireRole('admin')) return;
        if (!checkRateLimit()) return;

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const player = battle.addPlayer(playerData);
        
        socket.emit('admin:playerAdded', { player: { ...player, token: undefined } });
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        logActivity(socket, 'PLAYER_ADDED', { battleId, playerName: player.name, team: player.team });
      } catch (error) {
        logActivity(socket, 'PLAYER_ADD_ERROR', { error: error.message });
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:startBattle', () => {
      try {
        if (!requireRole('admin')) return;
        if (!checkRateLimit()) return;

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        battle.startBattle();
        
        socket.emit('admin:battleStarted', { success: true });
        broadcastManager.broadcastBattleEvent(battleId, 'started', { adminId: socket.id });
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        logActivity(socket, 'BATTLE_STARTED', { battleId });
      } catch (error) {
        logActivity(socket, 'BATTLE_START_ERROR', { error: error.message });
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:endBattle', () => {
      try {
        if (!requireRole('admin')) return;

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        battle.endBattle('admin_ended');
        broadcastManager.broadcastBattleEvent(battleId, 'ended', { reason: 'admin_ended' });
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        logActivity(socket, 'BATTLE_ENDED_BY_ADMIN', { battleId });
      } catch (error) {
        logActivity(socket, 'BATTLE_END_ERROR', { error: error.message });
        socket.emit('admin:error', error.message);
      }
    });

    // 플레이어 액션
    socket.on('player:action', (actionData) => {
      try {
        if (!requireRole('player')) return;
        if (!checkRateLimit()) return;
        updateActivity();

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const result = battle.processAction(playerId, actionData);
        
        socket.emit('player:actionResult', { success: true, result });
        broadcastManager.broadcastActionResult(battleId, result, true);
        broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());

        logActivity(socket, 'PLAYER_ACTION', { 
          battleId, 
          playerId, 
          actionType: actionData.type,
          target: actionData.target 
        });
      } catch (error) {
        logActivity(socket, 'PLAYER_ACTION_ERROR', { error: error.message });
        socket.emit('player:actionError', error.message);
        broadcastManager.broadcastActionResult(battleId, { error: error.message }, false);
      }
    });

    // 채팅 시스템
    socket.on('chat:send', ({ message, channel = 'all' }) => {
      try {
        if (!requireAuth()) return;
        if (!checkRateLimit()) return;
        updateActivity();

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const sanitizedMessage = sanitizeInput(message, SECURITY_LIMITS.MAX_MESSAGE_LENGTH);
        if (!sanitizedMessage.trim()) return;

        let senderName = '익명';
        const chatMessage = {
          id: 'C_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
          sender: senderName,
          role: role,
          message: sanitizedMessage,
          channel,
          timestamp: Date.now()
        };

        // 발신자 이름 설정
        if (role === 'player') {
          const player = battle.getPlayer(playerId);
          chatMessage.sender = player ? player.name : '플레이어';
        } else if (role === 'spectator') {
          const spectator = spectators.get(socket.id);
          chatMessage.sender = spectator ? spectator.name : '관전자';
        } else if (role === 'admin') {
          chatMessage.sender = '관리자';
        }

        // 채널별 전송
        switch (channel) {
          case 'team':
            if (role === 'player') {
              const player = battle.getPlayer(playerId);
              if (player) {
                broadcastManager.broadcastTeamChat(battleId, player.team === 'A' ? 'phoenix' : 'eaters', chatMessage);
              }
            }
            break;
          default:
            broadcastManager.broadcastChat(battleId, chatMessage);
        }

        logActivity(socket, 'CHAT_SENT', { battleId, channel, messageLength: sanitizedMessage.length });
      } catch (error) {
        logActivity(socket, 'CHAT_ERROR', { error: error.message });
        socket.emit('chat:error', error.message);
      }
    });

    // 관전자 응원
    socket.on('spectator:cheer', ({ message, team }) => {
      try {
        if (!requireRole('spectator')) return;
        if (!checkRateLimit()) return;
        updateActivity();

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const spectator = spectators.get(socket.id);
        const cheerMessage = {
          id: 'CH_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
          spectator: spectator.name,
          message: sanitizeInput(message, 200),
          team,
          timestamp: Date.now()
        };

        broadcastManager.broadcastCheer(battleId, cheerMessage);
        
        logActivity(socket, 'CHEER_SENT', { battleId, team, spectatorName: spectator.name });
      } catch (error) {
        logActivity(socket, 'CHEER_ERROR', { error: error.message });
        socket.emit('spectator:error', error.message);
      }
    });

    // 공통 이벤트들
    socket.on('battle:getState', () => {
      try {
        if (!requireAuth()) return;
        updateActivity();

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        socket.emit('battle:state', battle.getSnapshot());
      } catch (error) {
        socket.emit('battle:error', error.message);
      }
    });

    socket.on('ping', () => {
      updateActivity();
      socket.emit('pong', { timestamp: Date.now() });
    });

    // 연결 해제 처리
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] 연결 해제: ${socket.id} (${reason})`);
      
      try {
        untrackConnection(socket);

        if (authenticated && battleId) {
          const battle = battles.get(battleId);
          
          if (role === 'player' && battle) {
            players.delete(socket.id);
            const player = battle.getPlayer(playerId);
            if (player) {
              battle.addLog('system', `${player.name}이 연결을 끊었습니다.`);
            }
          } else if (role === 'spectator' && battle) {
            const spectator = spectators.get(socket.id);
            spectators.delete(socket.id);
            battle.stats.spectatorCount = Math.max(0, battle.stats.spectatorCount - 1);
            if (spectator) {
              battle.addLog('system', `관전자 ${spectator.name}이 퇴장했습니다.`);
            }
          } else if (role === 'admin') {
            admins.delete(socket.id);
          }

          if (battle) {
            broadcastManager.leaveSocketFromRooms(socket, battleId, role);
            broadcastManager.broadcastBattleState(battleId, battle.getSnapshot());
          }
        }

        logActivity(socket, 'DISCONNECTED', { reason, role, battleId });
      } catch (error) {
        console.error(`[Socket] 연결 해제 처리 오류: ${error.message}`);
      }
    });

    // 에러 핸들링
    socket.on('error', (error) => {
      console.error(`[Socket] 소켓 오류 ${socket.id}:`, error);
      logActivity(socket, 'SOCKET_ERROR', { error: error.message });
    });

    // 연결 성공 알림
    socket.emit('connection:ready', {
      socketId: socket.id,
      timestamp: Date.now(),
      message: 'PYXIS 전투 시스템에 연결되었습니다',
      serverVersion: '2.0.0'
    });

    updateActivity();
  });

  console.log('[Socket] PYXIS Enhanced Battle Handlers 초기화 완료');
  return io;
}

// API 헬퍼 함수들
function createBattle(mode = '2v2') {
  const battleId = 'B_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  const battle = new Battle(battleId, mode);
  battles.set(battleId, battle);
  
  console.log(`[API] 전투 생성: ${battleId} (${mode})`);
  
  return {
    battleId,
    adminOtp: battle.adminOtp,
    spectatorOtp: battle.spectatorOtp,
    state: battle.getSnapshot()
  };
}

function getBattle(battleId) {
  return battles.get(battleId);
}

function addPlayerToBattle(battleId, playerData) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('전투를 찾을 수 없습니다');
  
  return battle.addPlayer(playerData);
}

function generatePlayerLinks(battleId) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('전투를 찾을 수 없습니다');

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3001';
  const links = {
    admin: `${baseUrl}/admin?battleId=${battleId}&otp=${battle.adminOtp}`,
    spectator: `${baseUrl}/watch?battleId=${battleId}&otp=${battle.spectatorOtp}`,
    players: {}
  };

  battle.getAllPlayers().forEach(player => {
    links.players[player.id] = {
      name: player.name,
      team: player.team,
      url: `${baseUrl}/play?battleId=${battleId}&playerId=${player.id}&otp=${player.token}`
    };
  });

  return links;
}

function getAllBattles() {
  return Array.from(battles.values()).map(battle => battle.getSnapshot());
}

function deleteBattle(battleId) {
  const battle = battles.get(battleId);
  if (battle) {
    battle.cleanup();
    battles.delete(battleId);
    console.log(`[API] 전투 삭제: ${battleId}`);
    return true;
  }
  return false;
}

function getSystemStats() {
  return {
    totalBattles: battles.size,
    activeBattles: Array.from(battles.values()).filter(b => b.status === 'ongoing').length,
    totalPlayers: players.size,
    totalSpectators: spectators.size,
    totalAdmins: admins.size,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    broadcastStats: broadcastManager.getSystemStats()
  };
}

// 모듈 내보내기
module.exports = {
  initializeSocketHandlers,
  Battle,
  createBattle,
  getBattle,
  addPlayerToBattle,
  generatePlayerLinks,
  getAllBattles,
  deleteBattle,
  getSystemStats,
  getBattles: () => battles,
  getPlayers: () => players,
  getSpectators: () => spectators,
  getAdmins: () => admins
};
