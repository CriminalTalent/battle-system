// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle System - 핵심 전투 로직 엔진
// 실시간 턴제 전투, 주사위 시스템, 팀별 전투 관리

const EventEmitter = require('events');
const TimerManager = require('../utils/TimerManager');
const { validateAction, calculateDamage, rollDice } = require('../utils/combat');
const logger = require('../utils/logger');

/**
 * PYXIS 전투 엔진 클래스
 * - 턴제 전투 시스템 관리
 * - 플레이어 액션 처리
 * - 실시간 이벤트 방출
 */
class BattleEngine extends EventEmitter {
  constructor(battleId, players, socketManager, options = {}) {
    super();
    
    this.battleId = battleId;
    this.players = new Map(); // playerId -> player object
    this.socketManager = socketManager;
    this.options = {
      battleTimeLimit: options.battleTimeLimit || 60 * 60 * 1000, // 1시간
      turnTimeLimit: options.turnTimeLimit || 5 * 60 * 1000, // 5분
      maxTurns: options.maxTurns || 100,
      maxHP: options.maxHP || 50,
      ...options
    };
    
    // 전투 상태
    this.status = 'initializing'; // initializing, active, paused, ended
    this.currentTurn = 1;
    this.currentPlayerIndex = 0;
    this.turnOrder = [];
    this.actionQueue = [];
    this.battleStartTime = null;
    
    // 팀 구성
    this.teams = {
      phoenix: [], // 불사조 기사단
      eaters: []   // 죽음을 먹는 자들
    };
    
    // 전투 기록
    this.actionLog = [];
    this.chatLog = [];
    this.spectators = new Set();
    
    // 타이머 관리
    this.timer = new TimerManager(
      battleId,
      this.handleBattleTimeout.bind(this),
      this.handlePlayerTimeout.bind(this)
    );
    
    // 플레이어 초기화
    this.initializePlayers(players);
    
    logger.info(`Battle Engine initialized for battle ${battleId}`, {
      playerCount: this.players.size,
      teams: this.getTeamCounts()
    });
  }
  
  /**
   * 플레이어 초기화
   */
  initializePlayers(playersData) {
    for (const playerData of playersData) {
      const player = {
        id: playerData.id,
        name: playerData.name,
        team: playerData.team, // 'phoenix' or 'eaters'
        
        // 스탯 (각 1~5 범위)
        stats: {
          attack: Math.max(1, Math.min(5, playerData.stats?.attack || 3)),
          defense: Math.max(1, Math.min(5, playerData.stats?.defense || 3)),
          agility: Math.max(1, Math.min(5, playerData.stats?.agility || 3)),
          luck: Math.max(1, Math.min(5, playerData.stats?.luck || 3))
        },
        
        // HP (기본 50)
        hp: this.options.maxHP,
        maxHp: this.options.maxHP,
        
        // 아이템 (시작 아이템)
        items: {
          dittany: Math.max(0, Math.min(9, playerData.items?.dittany || 0)), // 디터니 (회복)
          attackBoost: Math.max(0, Math.min(9, playerData.items?.attackBoost || 0)), // 공격 보정기
          defenseBoost: Math.max(0, Math.min(9, playerData.items?.defenseBoost || 0)) // 방어 보정기
        },
        
        // 전투 상태
        isAlive: true,
        isConnected: true,
        lastActionTime: Date.now(),
        
        // 임시 효과
        effects: {
          attackBoost: false, // 1턴간 공격력 1.5배
          defenseBoost: false, // 1턴간 방어력 1.5배
          dodgeBonus: 0 // 회피 보너스
        },
        
        // 아바타 정보
        avatar: playerData.avatar || null
      };
      
      this.players.set(player.id, player);
      
      // 팀 배정
      if (player.team === 'phoenix' || player.team === 'A') {
        this.teams.phoenix.push(player.id);
      } else if (player.team === 'eaters' || player.team === 'B') {
        this.teams.eaters.push(player.id);
      }
    }
  }
  
  /**
   * 전투 시작
   */
  async startBattle() {
    try {
      this.status = 'active';
      this.battleStartTime = Date.now();
      
      // 선공 팀 결정 (민첩성 합계)
      this.calculateTurnOrder();
      
      // 전투 시작 이벤트
      this.emit('battleStarted', {
        battleId: this.battleId,
        turnOrder: this.turnOrder,
        firstTeam: this.getPlayerTeam(this.turnOrder[0])
      });
      
      // 전투 타이머 시작 (1시간)
      this.timer.startBattleTimer(this.options.battleTimeLimit);
      
      // 첫 번째 턴 시작
      await this.startNextTurn();
      
      logger.info(`Battle started: ${this.battleId}`, {
        playerCount: this.players.size,
        turnOrder: this.turnOrder,
        firstPlayer: this.getCurrentPlayer()?.name
      });
      
    } catch (error) {
      logger.error(`Failed to start battle ${this.battleId}:`, error);
      this.emit('error', { error: error.message });
    }
  }
  
  /**
   * 턴 순서 계산 (민첩성 기반)
   */
  calculateTurnOrder() {
    // 각 팀의 민첩성 합계 계산
    const phoenixAgility = this.teams.phoenix.reduce((sum, playerId) => {
      const player = this.players.get(playerId);
      return sum + (player?.stats.agility || 0);
    }, 0);
    
    const eatersAgility = this.teams.eaters.reduce((sum, playerId) => {
      const player = this.players.get(playerId);
      return sum + (player?.stats.agility || 0);
    }, 0);
    
    // 선공 팀 결정
    const firstTeam = phoenixAgility >= eatersAgility ? 'phoenix' : 'eaters';
    const secondTeam = firstTeam === 'phoenix' ? 'eaters' : 'phoenix';
    
    // 턴 순서: 선공 팀 전원 -> 후공 팀 전원
    this.turnOrder = [
      ...this.teams[firstTeam].filter(id => this.players.get(id)?.isAlive),
      ...this.teams[secondTeam].filter(id => this.players.get(id)?.isAlive)
    ];
    
    this.currentPlayerIndex = 0;
    
    logger.info(`Turn order calculated`, {
      phoenixAgility,
      eatersAgility,
      firstTeam,
      turnOrder: this.turnOrder
    });
  }
  
  /**
   * 다음 턴 시작
   */
  async startNextTurn() {
    if (this.isBattleOver()) {
      return this.endBattle();
    }
    
    // 살아있는 플레이어만 필터링
    this.turnOrder = this.turnOrder.filter(id => {
      const player = this.players.get(id);
      return player?.isAlive && player?.hp > 0;
    });
    
    if (this.turnOrder.length === 0) {
      return this.endBattle();
    }
    
    // 현재 플레이어 인덱스 조정
    if (this.currentPlayerIndex >= this.turnOrder.length) {
      this.currentPlayerIndex = 0;
      this.currentTurn++;
    }
    
    const currentPlayerId = this.turnOrder[this.currentPlayerIndex];
    const currentPlayer = this.players.get(currentPlayerId);
    
    if (!currentPlayer || !currentPlayer.isAlive) {
      this.currentPlayerIndex++;
      return this.startNextTurn();
    }
    
    // 임시 효과 정리 (매 턴 시작 시)
    this.clearTemporaryEffects(currentPlayerId);
    
    // 턴 시작 이벤트
    this.emit('turnStart', {
      battleId: this.battleId,
      turn: this.currentTurn,
      playerId: currentPlayerId,
      playerName: currentPlayer.name,
      team: currentPlayer.team,
      timeLimit: this.options.turnTimeLimit
    });
    
    // 플레이어 타이머 시작 (5분)
    this.timer.startPlayerTimer(currentPlayerId, this.options.turnTimeLimit);
    
    logger.info(`Turn ${this.currentTurn} started`, {
      playerId: currentPlayerId,
      playerName: currentPlayer.name
    });
  }
  
  /**
   * 플레이어 액션 처리
   */
  async performAction(playerId, actionData) {
    try {
      const currentPlayer = this.getCurrentPlayer();
      
      // 턴 검증
      if (!currentPlayer || currentPlayer.id !== playerId) {
        throw new Error('Not your turn');
      }
      
      // 액션 유효성 검증
      const validationResult = validateAction(actionData, currentPlayer, this.players);
      if (!validationResult.valid) {
        throw new Error(validationResult.error);
      }
      
      // 플레이어 타이머 정지
      this.timer.clearPlayerTimer(playerId);
      
      // 액션 실행
      const result = await this.executeAction(playerId, actionData);
      
      // 액션 로그 기록
      this.addActionLog({
        turn: this.currentTurn,
        playerId: playerId,
        playerName: currentPlayer.name,
        action: actionData.type,
        target: actionData.targetId,
        result: result,
        timestamp: Date.now()
      });
      
      // 액션 결과 이벤트
      this.emit('actionPerformed', {
        battleId: this.battleId,
        turn: this.currentTurn,
        playerId: playerId,
        action: actionData,
        result: result
      });
      
      // 전투 종료 확인
      if (this.isBattleOver()) {
        return this.endBattle();
      }
      
      // 다음 턴으로 진행
      this.currentPlayerIndex++;
      await this.startNextTurn();
      
    } catch (error) {
      logger.error(`Action failed for player ${playerId}:`, error);
      this.emit('actionError', {
        playerId: playerId,
        error: error.message
      });
    }
  }
  
  /**
   * 액션 실행
   */
  async executeAction(playerId, actionData) {
    const actor = this.players.get(playerId);
    const actionType = actionData.type;
    
    switch (actionType) {
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
        throw new Error(`Unknown action type: ${actionType}`);
    }
  }
  
  /**
   * 공격 액션 실행
   */
  executeAttack(actor, actionData) {
    const target = this.players.get(actionData.targetId);
    if (!target || !target.isAlive) {
      throw new Error('Invalid target');
    }
    
    // 공격력 계산: 공격력 + 주사위(1-20)
    const attackRoll = rollDice(20);
    let attackPower = actor.stats.attack + attackRoll;
    
    // 공격 보정기 효과
    if (actor.effects.attackBoost) {
      attackPower = Math.floor(attackPower * 1.5);
      actor.effects.attackBoost = false; // 1회용
    }
    
    // 명중률 계산: 행운 + 주사위(1-20)
    const hitRoll = rollDice(20);
    const hitChance = actor.stats.luck + hitRoll;
    
    // 회피 계산: 민첩성 + 주사위(1-20) + 회피 보너스
    const dodgeRoll = rollDice(20);
    const dodgeChance = target.stats.agility + dodgeRoll + (target.effects.dodgeBonus || 0);
    
    // 회피 성공 여부
    if (dodgeChance > hitChance) {
      target.effects.dodgeBonus = 0; // 회피 보너스 소모
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
    
    // 기본 대미지 계산: 공격력 - 방어력
    let damage = Math.max(0, attackPower - target.stats.defense);
    
    // 치명타 확률: 주사위(1-20) >= (20 - 행운/2)
    const critRoll = rollDice(20);
    const critThreshold = 20 - Math.floor(actor.stats.luck / 2);
    const isCritical = critRoll >= critThreshold;
    
    if (isCritical) {
      damage *= 2; // 치명타 시 2배 대미지
    }
    
    // 대미지 적용
    target.hp = Math.max(0, target.hp - damage);
    
    // 사망 체크
    if (target.hp <= 0) {
      target.isAlive = false;
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
    // 방어 보정기 효과
    let defenseMultiplier = 1;
    if (actor.effects.defenseBoost) {
      defenseMultiplier = 1.5;
      actor.effects.defenseBoost = false; // 1회용
    }
    
    // 방어력 임시 증가 (이번 턴 한정)
    const originalDefense = actor.stats.defense;
    actor.stats.defense = Math.floor(actor.stats.defense * defenseMultiplier);
    
    // 다음 턴에 원래 방어력으로 복구하기 위한 타이머 설정
    setTimeout(() => {
      actor.stats.defense = originalDefense;
    }, 1000);
    
    return {
      type: 'defend',
      result: 'defending',
      defender: actor.name,
      defenseBoost: defenseMultiplier > 1,
      message: `${actor.name}이(가) 방어 태세를 취했습니다!${defenseMultiplier > 1 ? ' (방어 보정기 효과!)' : ''}`
    };
  }
  
  /**
   * 회피 액션 실행
   */
  executeDodge(actor, actionData) {
    // 다음 공격에 대한 회피 보너스 +5
    actor.effects.dodgeBonus = 5;
    
    return {
      type: 'dodge',
      result: 'dodging',
      dodger: actor.name,
      message: `${actor.name}이(가) 회피 태세를 취했습니다! (회피율 +5)`
    };
  }
  
  /**
   * 아이템 사용 액션 실행
   */
  executeItem(actor, actionData) {
    const itemType = actionData.itemType;
    const targetId = actionData.targetId || actor.id;
    const target = this.players.get(targetId);
    
    if (!target) {
      throw new Error('Invalid target for item use');
    }
    
    // 아이템 보유 확인
    if (actor.items[itemType] <= 0) {
      throw new Error(`No ${itemType} available`);
    }
    
    // 아이템 소모
    actor.items[itemType]--;
    
    switch (itemType) {
      case 'dittany': {
        // 디터니: HP +10 (확정 회복)
        const healAmount = 10;
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + healAmount);
        const actualHeal = target.hp - oldHp;
        
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
        // 공격 보정기: 10% 확률로 성공, 실패해도 아이템 소모
        const successRoll = rollDice(20);
        const success = successRoll >= 19; // 10% 확률 (19, 20)
        
        if (success) {
          actor.effects.attackBoost = true; // 다음 공격 시 1.5배
          return {
            type: 'item',
            itemType: 'attackBoost',
            result: 'success',
            user: actor.name,
            message: `${actor.name}이(가) 공격 보정기를 성공적으로 사용했습니다! (다음 공격 1.5배)`
          };
        } else {
          return {
            type: 'item',
            itemType: 'attackBoost',
            result: 'failed',
            user: actor.name,
            message: `${actor.name}의 공격 보정기가 실패했습니다...`
          };
        }
      }
      
      case 'defenseBoost': {
        // 방어 보정기: 10% 확률로 성공, 실패해도 아이템 소모
        const successRoll = rollDice(20);
        const success = successRoll >= 19; // 10% 확률 (19, 20)
        
        if (success) {
          actor.effects.defenseBoost = true; // 다음 방어 시 1.5배
          return {
            type: 'item',
            itemType: 'defenseBoost',
            result: 'success',
            user: actor.name,
            message: `${actor.name}이(가) 방어 보정기를 성공적으로 사용했습니다! (다음 방어 1.5배)`
          };
        } else {
          return {
            type: 'item',
            itemType: 'defenseBoost',
            result: 'failed',
            user: actor.name,
            message: `${actor.name}의 방어 보정기가 실패했습니다...`
          };
        }
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
   * 임시 효과 정리
   */
  clearTemporaryEffects(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      // 회피 보너스는 공격당할 때까지 유지, 여기서는 정리하지 않음
    }
  }
  
  /**
   * 플레이어 타임아웃 처리
   */
  handlePlayerTimeout(playerId) {
    logger.info(`Player timeout: ${playerId}`);
    
    // 자동으로 패스 처리
    this.performAction(playerId, { type: 'pass' }).catch(error => {
      logger.error(`Failed to handle player timeout for ${playerId}:`, error);
    });
  }
  
  /**
   * 전투 타임아웃 처리 (1시간 경과)
   */
  handleBattleTimeout() {
    logger.info(`Battle timeout: ${this.battleId}`);
    this.endBattle();
  }
  
  /**
   * 전투 종료 확인
   */
  isBattleOver() {
    // 한 팀이 모두 죽었거나
    const phoenixAlive = this.teams.phoenix.some(id => {
      const player = this.players.get(id);
      return player && player.isAlive && player.hp > 0;
    });
    
    const eatersAlive = this.teams.eaters.some(id => {
      const player = this.players.get(id);
      return player && player.isAlive && player.hp > 0;
    });
    
    // 최대 턴 수 도달했거나
    const maxTurnsReached = this.currentTurn >= this.options.maxTurns;
    
    return !phoenixAlive || !eatersAlive || maxTurnsReached;
  }
  
  /**
   * 전투 종료
   */
  endBattle() {
    this.status = 'ended';
    this.timer.clearAll();
    
    // 각 팀의 총 HP 계산
    const phoenixHP = this.teams.phoenix.reduce((total, playerId) => {
      const player = this.players.get(playerId);
      return total + Math.max(0, player?.hp || 0);
    }, 0);
    
    const eatersHP = this.teams.eaters.reduce((total, playerId) => {
      const player = this.players.get(playerId);
      return total + Math.max(0, player?.hp || 0);
    }, 0);
    
    // 승자 결정
    let winner, winnerTeam;
    if (phoenixHP > eatersHP) {
      winner = 'phoenix';
      winnerTeam = '불사조 기사단';
    } else if (eatersHP > phoenixHP) {
      winner = 'eaters';
      winnerTeam = '죽음을 먹는 자들';
    } else {
      winner = 'draw';
      winnerTeam = '무승부';
    }
    
    const battleResult = {
      battleId: this.battleId,
      winner: winner,
      winnerTeam: winnerTeam,
      phoenixHP: phoenixHP,
      eatersHP: eatersHP,
      totalTurns: this.currentTurn,
      duration: Date.now() - this.battleStartTime,
      endReason: this.currentTurn >= this.options.maxTurns ? 'timeout' : 'elimination'
    };
    
    // 전투 종료 이벤트
    this.emit('battleEnded', battleResult);
    
    logger.info(`Battle ended: ${this.battleId}`, battleResult);
    
    return battleResult;
  }
  
  /**
   * 현재 플레이어 가져오기
   */
  getCurrentPlayer() {
    if (this.currentPlayerIndex >= this.turnOrder.length) {
      return null;
    }
    const playerId = this.turnOrder[this.currentPlayerIndex];
    return this.players.get(playerId);
  }
  
  /**
   * 플레이어 팀 가져오기
   */
  getPlayerTeam(playerId) {
    const player = this.players.get(playerId);
    return player?.team;
  }
  
  /**
   * 팀별 플레이어 수 가져오기
   */
  getTeamCounts() {
    return {
      phoenix: this.teams.phoenix.length,
      eaters: this.teams.eaters.length
    };
  }
  
  /**
   * 전투 상태 정보 가져오기
   */
  getBattleState() {
    return {
      battleId: this.battleId,
      status: this.status,
      currentTurn: this.currentTurn,
      currentPlayer: this.getCurrentPlayer(),
      turnOrder: this.turnOrder,
      players: Array.from(this.players.values()),
      teams: this.teams,
      actionLogCount: this.actionLog.length
    };
  }
  
  /**
   * 액션 로그 추가
   */
  addActionLog(logEntry) {
    this.actionLog.push(logEntry);
    
    // 로그가 너무 많아지면 오래된 것부터 제거 (최대 1000개)
    if (this.actionLog.length > 1000) {
      this.actionLog = this.actionLog.slice(-1000);
    }
  }
  
  /**
   * 채팅 로그 추가
   */
  addChatLog(sender, message, role = 'player') {
    const chatEntry = {
      timestamp: Date.now(),
      sender: sender,
      message: message,
      role: role
    };
    
    this.chatLog.push(chatEntry);
    
    // 채팅 로그도 제한 (최대 500개)
    if (this.chatLog.length > 500) {
      this.chatLog = this.chatLog.slice(-500);
    }
    
    this.emit('chatMessage', chatEntry);
  }
  
  /**
   * 관전자 추가
   */
  addSpectator(spectatorId) {
    this.spectators.add(spectatorId);
    this.emit('spectatorJoined', { spectatorId, count: this.spectators.size });
  }
  
  /**
   * 관전자 제거
   */
  removeSpectator(spectatorId) {
    this.spectators.delete(spectatorId);
    this.emit('spectatorLeft', { spectatorId, count: this.spectators.size });
  }
  
  /**
   * 전투 정리
   */
  cleanup() {
    this.timer.clearAll();
    this.removeAllListeners();
    this.players.clear();
    this.spectators.clear();
    this.actionLog = [];
    this.chatLog = [];
    
    logger.info(`Battle engine cleaned up: ${this.battleId}`);
  }
}

module.exports = BattleEngine;
