// packages/battle-server/src/engine/BattleEngine.js
// Enhanced PYXIS Battle Engine - 고성능 실시간 전투 시스템
// - 스탯 범위 1-5 적용, 총합 제한 제거
// - 단축키 제거된 UI 친화적 설계
// - 강화된 보안 및 검증 시스템
// - 포괄적인 에러 처리 및 복구
// - 실시간 모니터링 및 상태 추적

"use strict";

const EventEmitter = require('events');
const broadcastManager = require('../socket/broadcast/broadcastManager');

// 게임 규칙 상수
const GAME_RULES = {
  // 스탯 규칙 (수정됨)
  STAT_MIN: 1,
  STAT_MAX: 5,
  // TOTAL_STAT_POINTS 제거됨
  
  // HP 규칙
  DEFAULT_HP: 100,
  MIN_HP: 1,
  MAX_HP: 1000,
  
  // 시간 제한
  BATTLE_TIME_LIMIT: 60 * 60 * 1000, // 1시간
  TURN_TIME_LIMIT: 5 * 60 * 1000,    // 5분
  MAX_TURNS: 50,
  
  // 아이템 규칙
  MAX_ITEM_COUNT: 9,
  ITEM_SUCCESS_RATE: 0.1, // 10%
  DITTANY_HEAL_AMOUNT: 10,
  BOOST_MULTIPLIER: 1.5,
  DODGE_BONUS: 5,
  
  // 주사위 규칙
  DICE_SIDES: 20,
  CRIT_BASE_THRESHOLD: 20,
  
  // 로그 제한
  MAX_ACTION_LOGS: 1000,
  MAX_CHAT_LOGS: 500
};

// 유틸리티 함수들
function rollDice(sides = GAME_RULES.DICE_SIDES) {
  return Math.floor(Math.random() * sides) + 1;
}

function validateStats(stats) {
  if (!stats || typeof stats !== 'object') {
    throw new Error('Invalid stats object');
  }
  
  const requiredStats = ['attack', 'defense', 'agility', 'luck'];
  const validatedStats = {};
  
  for (const stat of requiredStats) {
    const value = parseInt(stats[stat]);
    if (!Number.isInteger(value) || value < GAME_RULES.STAT_MIN || value > GAME_RULES.STAT_MAX) {
      throw new Error(`Invalid ${stat} value: must be between ${GAME_RULES.STAT_MIN} and ${GAME_RULES.STAT_MAX}`);
    }
    validatedStats[stat] = value;
  }
  
  // 총합 검증 제거됨
  return validatedStats;
}

function validateItems(items) {
  if (!items || typeof items !== 'object') {
    return { dittany: 1, attackBoost: 1, defenseBoost: 1 };
  }
  
  const validatedItems = {};
  const allowedItems = ['dittany', 'attackBoost', 'defenseBoost'];
  
  for (const item of allowedItems) {
    const count = Math.max(0, Math.min(GAME_RULES.MAX_ITEM_COUNT, parseInt(items[item]) || 1));
    validatedItems[item] = count;
  }
  
  return validatedItems;
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
            .replace(/[<>\"'&]/g, '')
            .trim()
            .slice(0, maxLength);
}

/**
 * Enhanced PYXIS Battle Engine
 * 실시간 턴제 전투 시스템의 핵심 엔진
 */
class BattleEngine extends EventEmitter {
  constructor(battleId, playersData, socketManager, options = {}) {
    super();
    
    this.battleId = sanitizeString(battleId, 50);
    this.socketManager = socketManager;
    this.created = Date.now();
    
    // 옵션 설정
    this.options = {
      battleTimeLimit: options.battleTimeLimit || GAME_RULES.BATTLE_TIME_LIMIT,
      turnTimeLimit: options.turnTimeLimit || GAME_RULES.TURN_TIME_LIMIT,
      maxTurns: options.maxTurns || GAME_RULES.MAX_TURNS,
      maxHP: options.maxHP || GAME_RULES.DEFAULT_HP,
      enableSpectators: options.enableSpectators !== false,
      autoCleanup: options.autoCleanup !== false,
      ...options
    };
    
    // 전투 상태
    this.status = 'initializing';
    this.currentTurn = 1;
    this.currentTeam = null; // 'phoenix' or 'eaters'
    this.turnStartTime = null;
    this.battleStartTime = null;
    this.battleEndTime = null;
    
    // 데이터 저장소
    this.players = new Map();
    this.teams = { phoenix: [], eaters: [] };
    this.actionLog = [];
    this.chatLog = [];
    this.spectators = new Set();
    
    // 타이머 관리
    this.battleTimer = null;
    this.turnTimer = null;
    
    // 보안 토큰
    this.adminOtp = this.generateSecureOtp();
    this.spectatorOtp = this.generateSecureOtp();
    this.playerTokens = new Map(); // playerId -> token
    
    // 통계 추적
    this.stats = {
      totalActions: 0,
      totalDamage: 0,
      totalHealing: 0,
      criticalHits: 0,
      itemsUsed: 0,
      timeouts: 0,
      maxSpectators: 0
    };
    
    // 플레이어 초기화
    this.initializePlayers(playersData);
    
    console.log(`[BattleEngine] Initialized: ${this.battleId}`, {
      playerCount: this.players.size,
      teams: this.getTeamCounts()
    });
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

  /**
   * 플레이어 초기화 및 검증
   */
  initializePlayers(playersData) {
    if (!Array.isArray(playersData) || playersData.length === 0) {
      throw new Error('Players data must be a non-empty array');
    }

    const usedNames = new Set();
    
    for (const playerData of playersData) {
      try {
        // 기본 데이터 검증
        if (!playerData.id || !playerData.name) {
          throw new Error('Player must have id and name');
        }

        const playerId = sanitizeString(playerData.id, 50);
        const playerName = sanitizeString(playerData.name, 50);
        
        if (!playerId || !playerName) {
          throw new Error('Invalid player id or name');
        }

        // 중복 이름 검증
        if (usedNames.has(playerName.toLowerCase())) {
          throw new Error(`Duplicate player name: ${playerName}`);
        }
        usedNames.add(playerName.toLowerCase());

        // 팀 검증
        let team = playerData.team;
        if (team === 'A') team = 'phoenix';
        else if (team === 'B') team = 'eaters';
        
        if (!['phoenix', 'eaters'].includes(team)) {
          throw new Error(`Invalid team: ${team}`);
        }

        // 스탯 검증 (1-5 범위, 총합 제한 없음)
        const validatedStats = validateStats(playerData.stats);
        
        // 아이템 검증
        const validatedItems = validateItems(playerData.items);

        // HP 검증
        const hp = Math.max(GAME_RULES.MIN_HP, Math.min(GAME_RULES.MAX_HP, 
          parseInt(playerData.hp) || this.options.maxHP));

        const player = {
          id: playerId,
          name: playerName,
          team: team,
          stats: validatedStats,
          hp: hp,
          maxHp: hp,
          items: validatedItems,
          
          // 전투 상태
          status: 'alive', // 'alive', 'dead', 'unconscious'
          isConnected: false,
          lastActionTime: null,
          actionThisTurn: null,
          
          // 임시 효과
          effects: [],
          
          // 보안
          token: this.generatePlayerToken(),
          
          // 메타데이터
          avatar: sanitizeString(playerData.avatar || '', 256),
          joinedAt: Date.now()
        };

        this.players.set(playerId, player);
        this.playerTokens.set(player.token, playerId);
        this.teams[team].push(playerId);
        
      } catch (error) {
        console.error(`[BattleEngine] Failed to initialize player ${playerData.id || 'unknown'}:`, error.message);
        throw new Error(`Player initialization failed: ${error.message}`);
      }
    }

    // 팀 밸런스 검증
    if (this.teams.phoenix.length === 0 || this.teams.eaters.length === 0) {
      throw new Error('Both teams must have at least one player');
    }

    console.log(`[BattleEngine] Players initialized successfully`, {
      total: this.players.size,
      phoenix: this.teams.phoenix.length,
      eaters: this.teams.eaters.length
    });
  }

  /**
   * 전투 시작
   */
  async startBattle() {
    try {
      if (this.status !== 'initializing') {
        throw new Error(`Cannot start battle in status: ${this.status}`);
      }

      this.status = 'ongoing';
      this.battleStartTime = Date.now();
      
      // 선공 팀 결정 (민첩성 합계 + 주사위)
      this.determineFirstTeam();
      
      // 전투 타이머 시작
      this.startBattleTimer();
      
      // 첫 번째 턴 시작
      this.startTurn();
      
      // 브로드캐스트
      if (broadcastManager) {
        broadcastManager.broadcastBattleEvent(this.battleId, 'started', {
          firstTeam: this.currentTeam,
          turnTimeLimit: this.options.turnTimeLimit
        });
        
        broadcastManager.broadcastBattleState(this.battleId, this.getSnapshot());
      }

      this.emit('battleStarted', {
        battleId: this.battleId,
        firstTeam: this.currentTeam,
        timestamp: this.battleStartTime
      });

      this.addLog('system', `전투가 시작되었습니다! ${this.getTeamName(this.currentTeam)}이 선공합니다.`);
      
      console.log(`[BattleEngine] Battle started: ${this.battleId}`, {
        firstTeam: this.currentTeam,
        playerCount: this.players.size
      });

    } catch (error) {
      console.error(`[BattleEngine] Failed to start battle: ${this.battleId}`, error);
      this.status = 'error';
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  /**
   * 선공 팀 결정
   */
  determineFirstTeam() {
    const phoenixAgility = this.teams.phoenix.reduce((sum, playerId) => {
      const player = this.players.get(playerId);
      return sum + (player?.stats.agility || 0);
    }, 0) + rollDice();

    const eatersAgility = this.teams.eaters.reduce((sum, playerId) => {
      const player = this.players.get(playerId);
      return sum + (player?.stats.agility || 0);
    }, 0) + rollDice();

    this.currentTeam = phoenixAgility >= eatersAgility ? 'phoenix' : 'eaters';
    
    console.log(`[BattleEngine] First team determined`, {
      phoenixAgility,
      eatersAgility,
      firstTeam: this.currentTeam
    });
  }

  /**
   * 턴 시작
   */
  startTurn() {
    this.turnStartTime = Date.now();
    
    // 현재 팀의 살아있는 플레이어들 확인
    const alivePlayers = this.getAlivePlayersInTeam(this.currentTeam);
    
    if (alivePlayers.length === 0) {
      return this.endBattle();
    }

    // 모든 플레이어의 턴 액션 초기화
    for (const playerId of alivePlayers) {
      const player = this.players.get(playerId);
      if (player) {
        player.actionThisTurn = null;
        this.processEffects(player);
      }
    }

    // 턴 타이머 시작
    this.startTurnTimer();

    // 브로드캐스트 (begin → 그대로 두되, 소비자는 turn:begin 또는 turn:start 중 하나를 들을 수 있음)
    if (broadcastManager) {
      broadcastManager.broadcastTurnEvent(this.battleId, 'begin', {
        turn: this.currentTurn,
        team: this.currentTeam,
        teamName: this.getTeamName(this.currentTeam),
        alivePlayers: alivePlayers.length,
        timeLimit: this.options.turnTimeLimit
      });
    }

    this.emit('turnStarted', {
      battleId: this.battleId,
      turn: this.currentTurn,
      team: this.currentTeam,
      alivePlayers: alivePlayers.length
    });

    this.addLog('system', `턴 ${this.currentTurn}: ${this.getTeamName(this.currentTeam)}의 턴이 시작되었습니다.`);
  }

  /**
   * 전투 타이머 시작
   */
  startBattleTimer() {
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
    }
    
    this.battleTimer = setTimeout(() => {
      this.handleBattleTimeout();
    }, this.options.battleTimeLimit);
  }

  /**
   * 턴 타이머 시작
   */
  startTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }
    
    this.turnTimer = setTimeout(() => {
      this.handleTurnTimeout();
    }, this.options.turnTimeLimit);
  }

  /**
   * 플레이어 액션 처리
   */
  async performAction(playerId, actionData) {
    try {
      // 기본 검증
      if (this.status !== 'ongoing') {
        throw new Error('Battle is not ongoing');
      }

      const player = this.players.get(playerId);
      if (!player) {
        throw new Error('Player not found');
      }

      if (player.status !== 'alive') {
        throw new Error('Player is not alive');
      }

      if (player.team !== this.currentTeam) {
        throw new Error('Not your team\'s turn');
      }

      if (player.actionThisTurn !== null) {
        throw new Error('Player has already acted this turn');
      }

      // 액션 데이터 검증
      if (!actionData || typeof actionData !== 'object') {
        throw new Error('Invalid action data');
      }

      const validActionTypes = ['attack', 'defend', 'dodge', 'item', 'pass'];
      if (!validActionTypes.includes(actionData.type)) {
        throw new Error(`Invalid action type: ${actionData.type}`);
      }

      // 액션 실행
      const result = await this.executeAction(player, actionData);
      
      // 액션 기록
      player.actionThisTurn = actionData.type;
      player.lastActionTime = Date.now();
      this.stats.totalActions++;

      // 로그 추가
      this.addActionLog({
        turn: this.currentTurn,
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        action: actionData.type,
        target: actionData.targetId,
        result: result,
        timestamp: Date.now()
      });

      // 브로드캐스트 (broadcastPlayerEvent로 통합)
      if (broadcastManager) {
        broadcastManager.broadcastPlayerEvent(this.battleId, 'action', {
          playerId: player.id,
          action: actionData.type,
          result
        });
        
        broadcastManager.broadcastBattleState(this.battleId, this.getSnapshot());
      }

      this.emit('actionPerformed', {
        battleId: this.battleId,
        playerId: player.id,
        action: actionData,
        result: result
      });

      // 전투 종료 확인
      if (this.checkBattleEnd()) {
        return this.endBattle();
      }

      // 팀 턴 완료 확인
      if (this.isTeamTurnComplete()) {
        this.endTurn();
      }

      return result;

    } catch (error) {
      console.error(`[BattleEngine] Action failed for player ${playerId}:`, error);
      
      if (broadcastManager) {
        broadcastManager.broadcastPlayerEvent(this.battleId, 'action', {
          playerId: playerId,
          error: error.message,
          success: false
        });
      }

      this.emit('actionError', {
        playerId: playerId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 액션 실행
   */
  async executeAction(actor, actionData) {
    switch (actionData.type) {
      case 'attack':
        return this.executeAttack(actor, actionData);
      case 'defend':
        return this.executeDefend(actor, actionData);
      case 'dodge':
        return this.executeDodge(actor, actionData);
      case 'item':
        return this.executeItem(actor, actionData);
      case 'pass':
        return this.executePass(actor, actionData);
      default:
        throw new Error(`Unknown action type: ${actionData.type}`);
    }
  }

  /**
   * 공격 액션 실행
   */
  executeAttack(actor, actionData) {
    if (!actionData.targetId) {
      throw new Error('Attack requires a target');
    }

    const target = this.players.get(actionData.targetId);
    if (!target) {
      throw new Error('Target not found');
    }

    if (target.status !== 'alive' || target.hp <= 0) {
      throw new Error('Target is not alive');
    }

    if (target.team === actor.team) {
      throw new Error('Cannot attack teammate');
    }

    // 공격력 계산
    const attackRoll = rollDice();
    let attackPower = actor.stats.attack + attackRoll;

    // 공격 보정기 효과 적용 (일회성)
    const attackBoostEffect = this.findEffect(actor, 'attackBoost');
    if (attackBoostEffect) {
      attackPower = Math.floor(attackPower * GAME_RULES.BOOST_MULTIPLIER);
      this.removeEffect(actor, attackBoostEffect);
    }

    // 명중/회피 계산
    const hitRoll = rollDice();
    const hitChance = actor.stats.luck + hitRoll;

    const dodgeRoll = rollDice();
    let dodgeChance = target.stats.agility + dodgeRoll;

    // 회피 보너스 적용 (일회성)
    const dodgeEffect = this.findEffect(target, 'dodgeBonus');
    if (dodgeEffect) {
      dodgeChance += dodgeEffect.value;
      this.removeEffect(target, dodgeEffect);
    }

    // 회피 성공 체크
    if (dodgeChance > hitChance) {
      return {
        type: 'attack',
        result: 'dodged',
        attacker: actor.name,
        target: target.name,
        attackRoll,
        hitRoll,
        dodgeRoll,
        message: `${target.name}이(가) ${actor.name}의 공격을 회피했습니다!`
      };
    }

    // 기본 대미지 계산
    let damage = Math.max(1, actor.stats.attack + attackRoll - target.stats.defense);

    // 방어 효과 적용 (일회성)
    const defendingEffect = this.findEffect(target, 'defending');
    if (defendingEffect) {
      damage = Math.max(1, damage - defendingEffect.value);
      this.removeEffect(target, defendingEffect);
    }

    // 치명타 계산
    const critRoll = rollDice();
    const critThreshold = GAME_RULES.CRIT_BASE_THRESHOLD - Math.floor(actor.stats.luck / 2);
    const isCritical = critRoll >= critThreshold;

    if (isCritical) {
      damage *= 2;
      this.stats.criticalHits++;
    }

    // 대미지 적용
    const oldHp = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    this.stats.totalDamage += Math.max(0, oldHp - target.hp);

    // 사망 처리
    if (target.hp === 0) {
      target.status = 'dead';
    }

    return {
      type: 'attack',
      result: 'hit',
      attacker: actor.name,
      target: target.name,
      damage,
      isCritical,
      targetHp: target.hp,
      targetMaxHp: target.maxHp,
      attackRoll,
      hitRoll,
      critRoll,
      message: `${actor.name}이(가) ${target.name}에게 ${damage}의 대미지를 입혔습니다!${isCritical ? ' (치명타!)' : ''}`
    };
  }

  /**
   * 방어 액션 실행
   */
  executeDefend(actor, actionData) {
    const defenseRoll = rollDice();
    let defenseValue = actor.stats.defense + defenseRoll;

    // 방어 보정기 효과 적용 (일회성)
    const defenseBoostEffect = this.findEffect(actor, 'defenseBoost');
    if (defenseBoostEffect) {
      defenseValue = Math.floor(defenseValue * GAME_RULES.BOOST_MULTIPLIER);
      this.removeEffect(actor, defenseBoostEffect);
    }

    // 방어 효과 추가 (다음 공격 1회에 적용)
    this.addEffect(actor, {
      type: 'defending',
      value: defenseValue,
      duration: 1
    });

    return {
      type: 'defend',
      result: 'defending',
      defender: actor.name,
      defenseValue,
      defenseRoll,
      message: `${actor.name}이(가) 방어 태세를 취했습니다! (방어력: ${defenseValue})`
    };
  }

  /**
   * 회피 액션 실행
   */
  executeDodge(actor, actionData) {
    // 회피 보너스 효과 추가
    this.addEffect(actor, {
      type: 'dodgeBonus',
      value: GAME_RULES.DODGE_BONUS,
      duration: 1
    });

    return {
      type: 'dodge',
      result: 'dodging',
      dodger: actor.name,
      dodgeBonus: GAME_RULES.DODGE_BONUS,
      message: `${actor.name}이(가) 회피 태세를 취했습니다! (회피율 +${GAME_RULES.DODGE_BONUS})`
    };
  }

  /**
   * 아이템 사용 액션 실행
   */
  executeItem(actor, actionData) {
    const { itemType, targetId } = actionData;
    
    if (!itemType) {
      throw new Error('Item type is required');
    }

    if (actor.items[itemType] <= 0) {
      throw new Error(`No ${itemType} available`);
    }

    let target = actor;
    if (targetId && targetId !== actor.id) {
      target = this.players.get(targetId);
      if (!target) {
        throw new Error('Target not found');
      }
    }

    // 아이템 소모
    actor.items[itemType]--;
    this.stats.itemsUsed++;

    switch (itemType) {
      case 'dittany': {
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + GAME_RULES.DITTANY_HEAL_AMOUNT);
        const actualHeal = target.hp - oldHp;
        this.stats.totalHealing += actualHeal;

        return {
          type: 'item',
          itemType: 'dittany',
          result: 'success',
          user: actor.name,
          target: target.name,
          healAmount: actualHeal,
          targetHp: target.hp,
          targetMaxHp: target.maxHp,
          message: `${actor.name}이(가) ${target.name}에게 디터니를 사용했습니다! (+${actualHeal} HP)`
        };
      }

      case 'attackBoost': {
        const successRoll = rollDice();
        const success = successRoll / GAME_RULES.DICE_SIDES >= GAME_RULES.ITEM_SUCCESS_RATE;

        if (success) {
          this.addEffect(actor, {
            type: 'attackBoost',
            multiplier: GAME_RULES.BOOST_MULTIPLIER,
            duration: 1
          });
        }

        return {
          type: 'item',
          itemType: 'attackBoost',
          result: success ? 'success' : 'failed',
          user: actor.name,
          successRoll,
          message: `${actor.name}이(가) 공격 보정기를 ${success ? '성공적으로' : '실패하여'} 사용했습니다.`
        };
      }

      case 'defenseBoost': {
        const successRoll = rollDice();
        const success = successRoll / GAME_RULES.DICE_SIDES >= GAME_RULES.ITEM_SUCCESS_RATE;

        if (success) {
          this.addEffect(actor, {
            type: 'defenseBoost',
            multiplier: GAME_RULES.BOOST_MULTIPLIER,
            duration: 1
          });
        }

        return {
          type: 'item',
          itemType: 'defenseBoost',
          result: success ? 'success' : 'failed',
          user: actor.name,
          successRoll,
          message: `${actor.name}이(가) 방어 보정기를 ${success ? '성공적으로' : '실패하여'} 사용했습니다.`
        };
      }

      default:
        throw new Error(`Unknown item type: ${itemType}`);
    }
  }

  /**
   * 패스 액션 실행
   */
  executePass(actor, actionData) {
    return {
      type: 'pass',
      result: 'passed',
      player: actor.name,
      message: `${actor.name}이(가) 턴을 넘겼습니다.`
    };
  }

  /**
   * 효과 관리
   */
  addEffect(player, effect) {
    player.effects.push({
      ...effect,
      id: Date.now() + Math.random(),
      addedAt: Date.now()
    });
  }

  findEffect(player, type) {
    return player.effects.find(effect => effect.type === type);
  }

  removeEffect(player, effect) {
    const index = player.effects.findIndex(e => e.id === effect.id);
    if (index >= 0) {
      player.effects.splice(index, 1);
    }
  }

  processEffects(player) {
    // 지속시간이 끝난 효과 제거
    player.effects = player.effects.filter(effect => {
      if (effect.duration !== undefined) {
        effect.duration--;
        return effect.duration > 0;
      }
      return true;
    });
  }

  /**
   * 턴 관리
   */
  isTeamTurnComplete() {
    const alivePlayers = this.getAlivePlayersInTeam(this.currentTeam);
    return alivePlayers.every(playerId => {
      const player = this.players.get(playerId);
      return player.actionThisTurn !== null;
    });
  }

  endTurn() {
    // 턴 타이머 정리
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // 전투 종료 확인
    if (this.checkBattleEnd()) {
      return this.endBattle();
    }

    // 팀 교체
    this.currentTeam = this.currentTeam === 'phoenix' ? 'eaters' : 'phoenix';
    this.currentTurn++;

    // 최대 턴 수 확인
    if (this.currentTurn > this.options.maxTurns) {
      return this.endBattle();
    }

    // 다음 턴 시작
    this.startTurn();

    // 브로드캐스트
    if (broadcastManager) {
      broadcastManager.broadcastTurnEvent(this.battleId, 'end', {
        turn: this.currentTurn - 1,
        nextTeam: this.currentTeam
      });
    }

    this.emit('turnEnded', {
      battleId: this.battleId,
      turn: this.currentTurn - 1,
      nextTeam: this.currentTeam
    });
  }

  /**
   * 타임아웃 처리
   */
  handleTurnTimeout() {
    console.log(`[BattleEngine] Turn timeout: ${this.battleId}`);
    this.stats.timeouts++;

    // 아직 행동하지 않은 플레이어들을 자동 패스 처리
    const alivePlayers = this.getAlivePlayersInTeam(this.currentTeam);
    const promises = [];

    for (const playerId of alivePlayers) {
      const player = this.players.get(playerId);
      if (player && player.actionThisTurn === null) {
        promises.push(
          this.performAction(playerId, { type: 'pass' }).catch(error => {
            console.error(`[BattleEngine] Auto-pass failed for ${playerId}:`, error);
          })
        );
      }
    }

    Promise.all(promises).then(() => {
      this.addLog('system', '시간 초과로 남은 플레이어들이 자동으로 패스되었습니다.');
    });
  }

  handleBattleTimeout() {
    console.log(`[BattleEngine] Battle timeout: ${this.battleId}`);
    this.addLog('system', '시간 제한에 도달하여 전투가 종료됩니다.');
    this.endBattle();
  }

  /**
   * 전투 종료 조건 확인
   */
  checkBattleEnd() {
    const phoenixAlive = this.getAlivePlayersInTeam('phoenix').length > 0;
    const eatersAlive = this.getAlivePlayersInTeam('eaters').length > 0;

    return !phoenixAlive || !eatersAlive || this.currentTurn > this.options.maxTurns;
  }

  /**
   * 전투 종료
   */
  endBattle() {
    if (this.status === 'ended') return;

    this.status = 'ended';
    this.battleEndTime = Date.now();

    // 모든 타이머 정리
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
      this.battleTimer = null;
    }
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // 승자 결정
    const result = this.calculateBattleResult();

    // 브로드캐스트
    if (broadcastManager) {
      broadcastManager.broadcastBattleEvent(this.battleId, 'ended', result);
      broadcastManager.broadcastBattleState(this.battleId, this.getSnapshot());
    }

    this.emit('battleEnded', result);

    this.addLog('system', result.message);

    console.log(`[BattleEngine] Battle ended: ${this.battleId}`, result);

    // 자동 정리 (옵션)
    if (this.options.autoCleanup) {
      setTimeout(() => this.cleanup(), 60000); // 1분 후 정리
    }

    return result;
  }

  /**
   * 전투 결과 계산
   */
  calculateBattleResult() {
    const phoenixPlayers = this.teams.phoenix.map(id => this.players.get(id));
    const eatersPlayers = this.teams.eaters.map(id => this.players.get(id));

    const phoenixHP = phoenixPlayers.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
    const eatersHP = eatersPlayers.reduce((sum, p) => sum + Math.max(0, p.hp), 0);

    const phoenixAlive = phoenixPlayers.filter(p => p.status === 'alive' && p.hp > 0).length;
    const eatersAlive = eatersPlayers.filter(p => p.status === 'alive' && p.hp > 0).length;

    let winner, winnerTeam, reason;

    if (phoenixAlive === 0 && eatersAlive === 0) {
      winner = 'draw';
      winnerTeam = '무승부';
      reason = 'both_eliminated';
    } else if (phoenixAlive === 0) {
      winner = 'eaters';
      winnerTeam = '죽음을 먹는 자들';
      reason = 'elimination';
    } else if (eatersAlive === 0) {
      winner = 'phoenix';
      winnerTeam = '불사조 기사단';
      reason = 'elimination';
    } else if (this.currentTurn > this.options.maxTurns) {
      // 시간 초과 - HP 합계로 승부 결정
      if (phoenixHP > eatersHP) {
        winner = 'phoenix';
        winnerTeam = '불사조 기사단';
        reason = 'timeout_hp';
      } else if (eatersHP > phoenixHP) {
        winner = 'eaters';
        winnerTeam = '죽음을 먹는 자들';
        reason = 'timeout_hp';
      } else {
        winner = 'draw';
        winnerTeam = '무승부';
        reason = 'timeout_tie';
      }
    } else {
      winner = 'draw';
      winnerTeam = '무승부';
      reason = 'unknown';
    }

    const message = this.getBattleEndMessage(winner, winnerTeam, reason);

    return {
      battleId: this.battleId,
      winner,
      winnerTeam,
      reason,
      message,
      phoenixHP,
      eatersHP,
      phoenixAlive,
      eatersAlive,
      totalTurns: this.currentTurn,
      duration: this.battleEndTime - this.battleStartTime,
      stats: this.stats,
      timestamp: this.battleEndTime
    };
  }

  getBattleEndMessage(winner, winnerTeam, reason) {
    switch (reason) {
      case 'elimination':
        return `${winnerTeam}이 승리했습니다!`;
      case 'timeout_hp':
        return `시간 초과! HP 합계로 ${winnerTeam}이 승리했습니다!`;
      case 'timeout_tie':
        return '시간 초과! HP 합계가 같아 무승부입니다!';
      case 'both_eliminated':
        return '양 팀 모두 전멸하여 무승부입니다!';
      default:
        return '전투가 종료되었습니다.';
    }
  }

  /**
   * 유틸리티 메서드들
   */
  getAlivePlayersInTeam(team) {
    return this.teams[team].filter(playerId => {
      const player = this.players.get(playerId);
      return player && player.status === 'alive' && player.hp > 0;
    });
  }

  getTeamName(team) {
    return team === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들';
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  getTeamCounts() {
    return {
      phoenix: this.teams.phoenix.length,
      eaters: this.teams.eaters.length,
      phoenixAlive: this.getAlivePlayersInTeam('phoenix').length,
      eatersAlive: this.getAlivePlayersInTeam('eaters').length
    };
  }

  /**
   * 로그 관리
   */
  addLog(type, message, data = {}) {
    const logEntry = {
      id: `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      message: sanitizeString(message),
      data,
      timestamp: Date.now(),
      turn: this.currentTurn
    };

    this.actionLog.push(logEntry);

    // 로그 크기 제한
    if (this.actionLog.length > GAME_RULES.MAX_ACTION_LOGS) {
      this.actionLog.splice(0, this.actionLog.length - GAME_RULES.MAX_ACTION_LOGS);
    }

    // 브로드캐스트
    if (broadcastManager) {
      broadcastManager.broadcastLog(this.battleId, logEntry);
    }

    return logEntry;
  }

  addActionLog(actionData) {
    const logEntry = {
      ...actionData,
      id: `ACTION_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now()
    };

    this.actionLog.push(logEntry);

    // 로그 크기 제한
    if (this.actionLog.length > GAME_RULES.MAX_ACTION_LOGS) {
      this.actionLog.splice(0, this.actionLog.length - GAME_RULES.MAX_ACTION_LOGS);
    }

    return logEntry;
  }

  addChatLog(sender, message, role = 'player') {
    const chatEntry = {
      id: `CHAT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      sender: sanitizeString(sender),
      message: sanitizeString(message),
      role,
      timestamp: Date.now()
    };

    this.chatLog.push(chatEntry);

    // 채팅 로그 크기 제한
    if (this.chatLog.length > GAME_RULES.MAX_CHAT_LOGS) {
      this.chatLog.splice(0, this.chatLog.length - GAME_RULES.MAX_CHAT_LOGS);
    }

    this.emit('chatMessage', chatEntry);
    return chatEntry;
  }

  /**
   * 관전자 관리
   */
  addSpectator(spectatorId, spectatorName = '관전자') {
    this.spectators.add(spectatorId);
    this.stats.maxSpectators = Math.max(this.stats.maxSpectators, this.spectators.size);

    this.emit('spectatorJoined', {
      spectatorId,
      spectatorName: sanitizeString(spectatorName),
      count: this.spectators.size
    });

    this.addLog('system', `관전자 ${sanitizeString(spectatorName)}이 입장했습니다.`);
  }

  removeSpectator(spectatorId, spectatorName = '관전자') {
    this.spectators.delete(spectatorId);

    this.emit('spectatorLeft', {
      spectatorId,
      spectatorName: sanitizeString(spectatorName),
      count: this.spectators.size
    });

    this.addLog('system', `관전자 ${sanitizeString(spectatorName)}이 퇴장했습니다.`);
  }

  /**
   * 상태 조회
   */
  getSnapshot() {
    const players = Array.from(this.players.values()).map(player => ({
      id: player.id,
      name: player.name,
      team: player.team,
      stats: player.stats,
      hp: player.hp,
      maxHp: player.maxHp,
      items: player.items,
      status: player.status,
      isConnected: player.isConnected,
      actionThisTurn: player.actionThisTurn,
      effects: player.effects,
      avatar: player.avatar
    }));

    return {
      battleId: this.battleId,
      status: this.status,
      currentTurn: this.currentTurn,
      currentTeam: this.currentTeam,
      turnStartTime: this.turnStartTime,
      battleStartTime: this.battleStartTime,
      battleEndTime: this.battleEndTime,
      options: this.options,
      players,
      teams: this.teams,
      teamCounts: this.getTeamCounts(),
      logs: this.actionLog.slice(-50), // 최근 50개만
      spectatorCount: this.spectators.size,
      stats: this.stats,
      created: this.created
    };
  }

  getBattleState() {
    return this.getSnapshot();
  }

  getPlayerState(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;

    return {
      ...player,
      token: undefined // 보안상 토큰 제외
    };
  }

  /**
   * 연결 상태 관리
   */
  setPlayerConnection(playerId, isConnected) {
    const player = this.players.get(playerId);
    if (player) {
      player.isConnected = isConnected;
      
      if (broadcastManager) {
        broadcastManager.broadcastPlayerEvent(this.battleId, 'connection', {
          playerId,
          playerName: player.name,
          isConnected
        });
      }

      this.emit('playerConnection', {
        playerId,
        playerName: player.name,
        isConnected
      });

      if (isConnected) {
        this.addLog('system', `${player.name}이 다시 연결되었습니다.`);
      } else {
        this.addLog('system', `${player.name}의 연결이 끊어졌습니다.`);
      }
    }
  }

  /**
   * 정리 및 리소스 해제
   */
  cleanup() {
    console.log(`[BattleEngine] Cleaning up battle: ${this.battleId}`);

    // 타이머 정리
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
      this.battleTimer = null;
    }
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // 이벤트 리스너 정리
    this.removeAllListeners();

    // 데이터 정리
    this.players.clear();
    this.playerTokens.clear();
    this.spectators.clear();
    this.actionLog = [];
    this.chatLog = [];

    // 상태 설정
    this.status = 'cleaned';

    console.log(`[BattleEngine] Battle cleanup completed: ${this.battleId}`);
  }

  /**
   * 디버깅 및 관리용 메서드
   */
  getDetailedStats() {
    return {
      battleId: this.battleId,
      status: this.status,
      created: this.created,
      uptime: Date.now() - this.created,
      playerCount: this.players.size,
      spectatorCount: this.spectators.size,
      actionLogSize: this.actionLog.length,
      chatLogSize: this.chatLog.length,
      currentTurn: this.currentTurn,
      currentTeam: this.currentTeam,
      stats: this.stats,
      options: this.options
    };
  }

  forceEndBattle(reason = 'admin') {
    console.log(`[BattleEngine] Force ending battle: ${this.battleId} (reason: ${reason})`);
    this.addLog('system', `관리자에 의해 전투가 강제 종료되었습니다.`);
    return this.endBattle();
  }

  pauseBattle() {
    if (this.status === 'ongoing') {
      this.status = 'paused';
      
      // 타이머 일시정지 (구현 시 타이머의 남은 시간 저장 필요)
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }

      this.addLog('system', '전투가 일시정지되었습니다.');
      
      if (broadcastManager) {
        broadcastManager.broadcastBattleEvent(this.battleId, 'paused', {
          pausedAt: Date.now()
        });
      }

      this.emit('battlePaused', { battleId: this.battleId });
      return true;
    }
    return false;
  }

  resumeBattle() {
    if (this.status === 'paused') {
      this.status = 'ongoing';
      
      // 턴 타이머 재시작
      this.startTurnTimer();

      this.addLog('system', '전투가 재개되었습니다.');
      
      if (broadcastManager) {
        broadcastManager.broadcastBattleEvent(this.battleId, 'resumed', {
          resumedAt: Date.now()
        });
      }

      this.emit('battleResumed', { battleId: this.battleId });
      return true;
    }
    return false;
  }
}

module.exports = BattleEngine;
