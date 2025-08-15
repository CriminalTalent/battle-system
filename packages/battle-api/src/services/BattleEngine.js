const { v4: uuidv4 } = require('uuid');
const { 
  rollDice, 
  calculateBattleResult, 
  calculateDefenseBonus,
  validateStats 
} = require('../utils/dice');
const { 
  BATTLE_ACTIONS, 
  BATTLE_STATUS, 
  GAME_CONSTANTS,
  WIN_CONDITIONS,
  RULESETS,
  determineTurnOrder,
  checkBattleEndCondition,
  canPlayerAct,
  generateBattleMessage
} = require('../utils/rules');

class BattleEngine {
  constructor(logger) {
    this.battles = new Map(); // battleId -> battleState
    this.logger = logger || console;
    this.turnTimers = new Map(); // battleId -> timerId
  }

  /**
   * 새로운 전투 생성
   */
  createBattle(config) {
    const battleId = uuidv4();
    const ruleset = RULESETS[config.ruleset] || RULESETS.standard;
    
    const battle = {
      id: battleId,
      status: BATTLE_STATUS.WAITING,
      ruleset: config.ruleset || 'standard',
      
      participants: {
        A: this.createParticipant(config.participantA, ruleset),
        B: this.createParticipant(config.participantB, ruleset)
      },
      
      // 전투 진행 상태
      currentTurn: null,
      turnCount: 0,
      turnStartTime: null,
      actionQueue: [],
      
      // 로그 및 관전
      battleLog: [],
      spectators: new Set(),
      
      // 메타데이터
      createdAt: new Date(),
      settings: {
        turnTimeLimit: config.turnTimeLimit || ruleset.turnTimeLimit,
        maxTurns: config.maxTurns || ruleset.maxTurns,
        autoStart: config.autoStart !== false,
        allowSpectatorChat: config.allowSpectatorChat || false,
        allowSurrender: ruleset.allowSurrender
      }
    };

    this.battles.set(battleId, battle);
    this.logger.info(`Battle created: ${battleId}`);
    
    return battle;
  }

  /**
   * 참가자 객체 생성
   */
  createParticipant(config, ruleset) {
    const stats = config.stats || ruleset.baseStats;
    
    // 스탯 유효성 검사
    if (!validateStats(stats)) {
      throw new Error('Invalid stats provided');
    }
    
    return {
      id: config.id,
      name: config.name,
      image: config.image || '/images/default-character.png',
      
      // HP
      hp: GAME_CONSTANTS.STARTING_HP,
      maxHp: GAME_CONSTANTS.MAX_HP,
      
      // 스탯 (1-5)
      stats: {
        attack: stats.attack,
        defense: stats.defense,
        agility: stats.agility,
        luck: stats.luck
      },
      
      // 상태 효과
      statusEffects: [],
      
      // 연결 상태
      connected: false,
      socketId: null,
      lastAction: null,
      lastActionTime: null,
      
      // 전투 통계
      damageDealt: 0,
      damageTaken: 0,
      actionsUsed: 0,
      criticalHits: 0,
      missedAttacks: 0,
      dodgedAttacks: 0,
      defenseActions: 0
    };
  }

  /**
   * 전투 삭제
   */
  deleteBattle(battleId) {
    this.clearTurnTimer(battleId);
    return this.battles.delete(battleId);
  }

  /**
   * 참가자 연결
   */
  connectParticipant(battleId, participantId, socketId) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, error: 'Battle not found' };

    const participantKey = this.findParticipantKey(battle, participantId);
    if (!participantKey) return { success: false, error: 'Participant not found' };

    const participant = battle.participants[participantKey];
    participant.connected = true;
    participant.socketId = socketId;

    this.addLogEntry(battle, {
      type: 'system',
      message: generateBattleMessage('player_joined', { player: participant.name }),
      timestamp: new Date()
    });

    // 자동 시작 설정이고 모든 참가자가 연결되면 전투 시작
    if (battle.settings.autoStart && this.areAllParticipantsConnected(battle)) {
      this.startBattle(battleId);
    }

    return { success: true, participantKey };
  }

  /**
   * 참가자 연결 해제
   */
  disconnectParticipant(battleId, socketId) {
    const battle = this.getBattle(battleId);
    if (!battle) return false;

    const participant = this.findParticipantBySocket(battle, socketId);
    if (!participant) return false;

    participant.connected = false;
    participant.socketId = null;

    this.addLogEntry(battle, {
      type: 'system',
      message: generateBattleMessage('player_disconnected', { player: participant.name }),
      timestamp: new Date()
    });

    // 전투 중이면 일시정지
    if (battle.status === BATTLE_STATUS.ACTIVE) {
      this.pauseBattle(battleId, 'disconnect');
    }

    return true;
  }

  /**
   * 관전자 추가
   */
  addSpectator(battleId, socketId) {
    const battle = this.getBattle(battleId);
    if (!battle) return false;

    battle.spectators.add(socketId);
    return true;
  }

  /**
   * 관전자 제거
   */
  removeSpectator(battleId, socketId) {
    const battle = this.getBattle(battleId);
    if (!battle) return false;

    battle.spectators.delete(socketId);
    return true;
  }

  /**
   * 모든 참가자 연결 확인
   */
  areAllParticipantsConnected(battle) {
    return Object.values(battle.participants).every(p => p.connected);
  }

  /**
   * 전투 시작
   */
  startBattle(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== BATTLE_STATUS.WAITING) {
      return { success: false, error: 'Cannot start battle' };
    }

    if (!this.areAllParticipantsConnected(battle)) {
      return { success: false, error: 'Not all participants connected' };
    }

    battle.status = BATTLE_STATUS.ACTIVE;
    battle.currentTurn = determineTurnOrder(battle.participants);
    battle.turnCount = 1;
    battle.turnStartTime = Date.now();

    const firstPlayer = battle.participants[battle.currentTurn];

    this.addLogEntry(battle, {
      type: 'system',
      message: generateBattleMessage('battle_start', { first: firstPlayer.name }),
      participants: Object.values(battle.participants).map(p => ({
        name: p.name,
        hp: p.hp,
        stats: p.stats
      })),
      timestamp: new Date()
    });

    // 턴 타이머 시작
    this.startTurnTimer(battleId);

    this.logger.info(`Battle started: ${battleId}, First turn: ${battle.currentTurn}`);
    return { success: true };
  }

  /**
   * 전투 일시정지
   */
  pauseBattle(battleId, reason = 'manual') {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== BATTLE_STATUS.ACTIVE) return false;

    battle.status = BATTLE_STATUS.PAUSED;
    this.clearTurnTimer(battleId);

    this.addLogEntry(battle, {
      type: 'system',
      message: `전투가 일시정지되었습니다. (${reason})`,
      timestamp: new Date()
    });

    return true;
  }

  /**
   * 전투 재개
   */
  resumeBattle(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== BATTLE_STATUS.PAUSED) return false;

    if (!this.areAllParticipantsConnected(battle)) {
      return { success: false, error: 'Not all participants connected' };
    }

    battle.status = BATTLE_STATUS.ACTIVE;
    battle.turnStartTime = Date.now();
    this.startTurnTimer(battleId);

    this.addLogEntry(battle, {
      type: 'system',
      message: '전투가 재개되었습니다.',
      timestamp: new Date()
    });

    return { success: true };
  }

  /**
   * 액션 실행
   */
  executeAction(battleId, participantId, action) {
    const battle = this.getBattle(battleId);
    if (!battle) {
      return { success: false, error: 'Battle not found' };
    }

    if (battle.status !== BATTLE_STATUS.ACTIVE) {
      return { success: false, error: 'Battle not active' };
    }

    const participantKey = this.findParticipantKey(battle, participantId);
    if (!participantKey || battle.currentTurn !== participantKey) {
      return { success: false, error: 'Not your turn' };
    }

    const participant = battle.participants[participantKey];
    
    // 액션 유효성 검증
    const validation = canPlayerAct(participant, battle.status);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    // 액션 처리
    const result = this.processAction(battle, participantKey, action);
    
    if (result.success) {
      // 통계 업데이트
      participant.actionsUsed++;
      participant.lastAction = action;
      participant.lastActionTime = Date.now();

      // 로그 추가
      this.addLogEntry(battle, result.logEntry);
      
      // 전투 종료 체크
      const endCheck = checkBattleEndCondition(battle.participants, battle.turnCount);
      if (endCheck.ended) {
        this.endBattle(battle, endCheck.condition, endCheck.winner);
      } else {
        this.nextTurn(battle);
      }
    }

    return result;
  }

  /**
   * 액션 처리
   */
  processAction(battle, attackerKey, action) {
    const attacker = battle.participants[attackerKey];
    const defenderKey = attackerKey === 'A' ? 'B' : 'A';
    const defender = battle.participants[defenderKey];

    switch (action.type) {
      case BATTLE_ACTIONS.ATTACK:
        return this.processAttack(attacker, defender);
      
      case BATTLE_ACTIONS.DEFEND:
        return this.processDefend(attacker);
      
      case BATTLE_ACTIONS.SURRENDER:
        return this.processSurrender(battle, attacker);
      
      default:
        return { success: false, error: 'Unknown action type' };
    }
  }

  /**
   * 공격 처리
   */
  processAttack(attacker, defender) {
    const result = calculateBattleResult(attacker.stats, defender.stats);
    
    // 방어 보너스 적용
    const defenseBonus = defender.statusEffects.find(e => e.type === 'defend');
    if (defenseBonus && result.hit && !result.dodge) {
      result.damage = Math.max(1, Math.floor(result.damage * 0.5));
      result.defendReduced = true;
    }
    
    // 데미지 적용
    if (result.hit && !result.dodge && result.damage > 0) {
      defender.hp = Math.max(0, defender.hp - result.damage);
      attacker.damageDealt += result.damage;
      defender.damageTaken += result.damage;
      
      if (result.critical) {
        attacker.criticalHits++;
      }
    } else if (!result.hit) {
      attacker.missedAttacks++;
    } else if (result.dodge) {
      defender.dodgedAttacks++;
    }

    // 방어 효과 제거 (사용됨)
    if (defenseBonus) {
      defender.statusEffects = defender.statusEffects.filter(e => e.type !== 'defend');
    }

    let message;
    if (!result.hit) {
      message = generateBattleMessage('attack_miss', { 
        attacker: attacker.name 
      });
    } else if (result.dodge) {
      message = generateBattleMessage('attack_dodge', { 
        attacker: attacker.name,
        defender: defender.name 
      });
    } else {
      message = generateBattleMessage('attack_hit', {
        attacker: attacker.name,
        defender: defender.name,
        damage: result.damage,
        critical: result.critical
      });
      
      if (result.defendReduced) {
        message += ' (방어 효과로 데미지 감소)';
      }
    }

    return {
      success: true,
      logEntry: {
        type: 'attack',
        attacker: attacker.name,
        defender: defender.name,
        hit: result.hit,
        damage: result.damage,
        critical: result.critical,
        dodge: result.dodge,
        attackRoll: result.attackRoll,
        defenseRoll: result.defenseRoll,
        defendReduced: result.defendReduced || false,
        message,
        timestamp: new Date()
      },
      effects: {
        damageDealt: result.damage,
        targetHp: defender.hp,
        critical: result.critical,
        hit: result.hit,
        dodge: result.dodge
      }
    };
  }

  /**
   * 방어 처리
   */
  processDefend(attacker) {
    // 기존 방어 효과 제거
    attacker.statusEffects = attacker.statusEffects.filter(e => e.type !== 'defend');
    
    // 방어 보너스 계산
    const defenseRoll = rollDice(20);
    const defenseBonus = calculateDefenseBonus(attacker.stats.defense, defenseRoll);
    
    // 새 방어 효과 추가
    attacker.statusEffects.push({
      type: 'defend',
      duration: defenseBonus.duration,
      value: defenseBonus.bonusDefense,
      source: 'defend_action'
    });

    attacker.defenseActions++;

    return {
      success: true,
      logEntry: {
        type: 'defend',
        participant: attacker.name,
        roll: defenseRoll,
        bonus: defenseBonus.bonusDefense,
        message: generateBattleMessage('defend', { defender: attacker.name }),
        timestamp: new Date()
      }
    };
  }

  /**
   * 항복 처리
   */
  processSurrender(battle, surrenderer) {
    if (!battle.settings.allowSurrender) {
      return { success: false, error: 'Surrender not allowed in this ruleset' };
    }

    // 항복자의 HP를 0으로 만들어 전투 종료 조건 충족
    surrenderer.hp = 0;

    return {
      success: true,
      logEntry: {
        type: 'surrender',
        participant: surrenderer.name,
        message: generateBattleMessage('surrender', { player: surrenderer.name }),
        timestamp: new Date()
      }
    };
  }

  /**
   * 다음 턴으로 진행
   */
  nextTurn(battle) {
    // 상태 효과 처리
    this.processStatusEffects(battle);
    
    // 턴 변경
    battle.currentTurn = battle.currentTurn === 'A' ? 'B' : 'A';
    battle.turnCount++;
    battle.turnStartTime = Date.now();

    // 최대 턴 수 체크
    if (battle.turnCount > battle.settings.maxTurns) {
      this.endBattle(battle, WIN_CONDITIONS.TIMEOUT);
      return;
    }

    // 턴 타이머 재시작
    this.startTurnTimer(battle.id);
  }

  /**
   * 상태 효과 처리
   */
  processStatusEffects(battle) {
    Object.values(battle.participants).forEach(participant => {
      participant.statusEffects = participant.statusEffects.filter(effect => {
        effect.duration--;
        
        if (effect.duration <= 0) {
          // 상태 효과 종료 로그
          this.addLogEntry(battle, {
            type: 'status_effect',
            participant: participant.name,
            effect: effect.type,
            message: `${participant.name}의 ${effect.source || effect.type} 효과가 종료되었습니다.`,
            timestamp: new Date()
          });
          return false;
        }
        return true;
      });
    });
  }

  /**
   * 전투 종료
   */
  endBattle(battle, reason = WIN_CONDITIONS.HP_ZERO, winner = null) {
    battle.status = BATTLE_STATUS.ENDED;
    battle.endedAt = new Date();
    this.clearTurnTimer(battle.id);

    // 승자 결정
    if (!winner) {
      if (reason === WIN_CONDITIONS.TIMEOUT) {
        const participantA = battle.participants.A;
        const participantB = battle.participants.B;
        
        if (participantA.hp > participantB.hp) {
          winner = participantA;
        } else if (participantB.hp > participantA.hp) {
          winner = participantB;
        }
        // 동점이면 winner는 null (무승부)
      } else {
        const alive = Object.values(battle.participants).filter(p => p.hp > 0);
        if (alive.length === 1) {
          winner = alive[0];
        }
      }
    }

    const message = generateBattleMessage('battle_end', { 
      winner: winner?.name,
      reason 
    });

    this.addLogEntry(battle, {
      type: 'battle_end',
      message,
      winner: winner?.name,
      reason,
      finalStats: this.calculateFinalStats(battle),
      timestamp: new Date()
    });

    this.logger.info(`Battle ended: ${battle.id}, Winner: ${winner?.name || 'Draw'}, Reason: ${reason}`);
  }

  /**
   * 최종 통계 계산
   */
  calculateFinalStats(battle) {
    const stats = {};
    
    Object.entries(battle.participants).forEach(([key, participant]) => {
      stats[key] = {
        name: participant.name,
        hp: participant.hp,
        maxHp: participant.maxHp,
        stats: participant.stats,
        damageDealt: participant.damageDealt,
        damageTaken: participant.damageTaken,
        actionsUsed: participant.actionsUsed,
        criticalHits: participant.criticalHits,
        missedAttacks: participant.missedAttacks,
        dodgedAttacks: participant.dodgedAttacks,
        defenseActions: participant.defenseActions,
        accuracy: participant.actionsUsed > 0 ? 
          Math.round(((participant.actionsUsed - participant.missedAttacks) / participant.actionsUsed) * 100) : 0,
        avgDamagePerHit: participant.criticalHits + (participant.actionsUsed - participant.missedAttacks - participant.defenseActions) > 0 ?
          Math.round(participant.damageDealt / (participant.criticalHits + (participant.actionsUsed - participant.missedAttacks - participant.defenseActions))) : 0
      };
    });
    
    return stats;
  }

  /**
   * 턴 타이머 시작
   */
  startTurnTimer(battleId) {
    this.clearTurnTimer(battleId);
    
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== BATTLE_STATUS.ACTIVE) return;

    const timerId = setTimeout(() => {
      this.handleTurnTimeout(battleId);
    }, battle.settings.turnTimeLimit);

    this.turnTimers.set(battleId, timerId);
  }

  /**
   * 턴 타이머 제거
   */
  clearTurnTimer(battleId) {
    const timerId = this.turnTimers.get(battleId);
    if (timerId) {
      clearTimeout(timerId);
      this.turnTimers.delete(battleId);
    }
  }

  /**
   * 턴 시간 초과 처리
   */
  handleTurnTimeout(battleId) {
    const battle = this.getBattle(battleId);
    if (!battle || battle.status !== BATTLE_STATUS.ACTIVE) return;

    const currentParticipant = battle.participants[battle.currentTurn];
    
    this.addLogEntry(battle, {
      type: 'system',
      message: generateBattleMessage('turn_timeout', { player: currentParticipant.name }),
      timestamp: new Date()
    });

    // 자동 방어 액션 실행
    this.executeAction(battleId, currentParticipant.id, {
      type: BATTLE_ACTIONS.DEFEND
    });
  }

  /**
   * 유틸리티 메서드들
   */
  findParticipantKey(battle, participantId) {
    return Object.keys(battle.participants).find(
      key => battle.participants[key].id === participantId
    );
  }

  findParticipantBySocket(battle, socketId) {
    return Object.values(battle.participants).find(
      p => p.socketId === socketId
    );
  }

  addLogEntry(battle, entry) {
    battle.battleLog.push({
      id: uuidv4(),
      ...entry
    });
    
    // 로그가 너무 길어지지 않도록 제한 (최대 200개)
    if (battle.battleLog.length > 200) {
      battle.battleLog = battle.battleLog.slice(-150);
    }
  }

  /**
   * 전투 상태를 클라이언트에 전송할 형태로 직렬화
   */
  serializeBattleState(battle, viewerType = 'spectator', viewerId = null) {
    const baseState = {
      id: battle.id,
      status: battle.status,
      participants: {
        A: {
          name: battle.participants.A.name,
          image: battle.participants.A.image,
          hp: battle.participants.A.hp,
          maxHp: battle.participants.A.maxHp,
          stats: battle.participants.A.stats,
          statusEffects: battle.participants.A.statusEffects,
          connected: battle.participants.A.connected,
          lastAction: battle.participants.A.lastAction
        },
        B: {
          name: battle.participants.B.name,
          image: battle.participants.B.image,
          hp: battle.participants.B.hp,
          maxHp: battle.participants.B.maxHp,
          stats: battle.participants.B.stats,
          statusEffects: battle.participants.B.statusEffects,
          connected: battle.participants.B.connected,
          lastAction: battle.participants.B.lastAction
        }
      },
      currentTurn: battle.currentTurn,
      turnCount: battle.turnCount,
      turnStartTime: battle.turnStartTime,
      battleLog: battle.battleLog.slice(-50), // 최근 50개 로그만
      spectatorCount: battle.spectators.size,
      settings: battle.settings,
      createdAt: battle.createdAt,
      endedAt: battle.endedAt
    };

    // 참가자인 경우 추가 정보 제공
    if (viewerType === 'participant' && viewerId) {
      const participantKey = this.findParticipantKey(battle, viewerId);
      if (participantKey) {
        const participant = battle.participants[participantKey];
        baseState.myRole = participantKey;
        baseState.myTurn = battle.currentTurn === participantKey;
        baseState.participants[participantKey].battleStats = {
          damageDealt: participant.damageDealt,
          damageTaken: participant.damageTaken,
          actionsUsed: participant.actionsUsed,
          criticalHits: participant.criticalHits,
          missedAttacks: participant.missedAttacks,
          dodgedAttacks: participant.dodgedAttacks,
          defenseActions: participant.defenseActions
        };
      }
    }

    return baseState;
  }

  /**
   * 전투 목록 조회 (관리자용)
   */
  getAllBattles() {
    const battles = [];
    this.battles.forEach(battle => {
      battles.push({
        id: battle.id,
        status: battle.status,
        participants: {
          A: { name: battle.participants.A.name, connected: battle.participants.A.connected },
          B: { name: battle.participants.B.name, connected: battle.participants.B.connected }
        },
        turnCount: battle.turnCount,
        spectatorCount: battle.spectators.size,
        createdAt: battle.createdAt,
        endedAt: battle.endedAt
      });
    });
    
    return battles.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 활성 전투 수 조회
   */
  getActiveBattleCount() {
    return Array.from(this.battles.values()).filter(
      battle => battle.status === BATTLE_STATUS.ACTIVE || battle.status === BATTLE_STATUS.WAITING
    ).length;
  }

  /**
   * 메모리 정리 (오래된 전투 삭제)
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24시간

    this.battles.forEach((battle, battleId) => {
      const age = now - battle.createdAt.getTime();
      if (age > maxAge && battle.status === BATTLE_STATUS.ENDED) {
        this.deleteBattle(battleId);
        this.logger.info(`Cleaned up old battle: ${battleId}`);
      }
    });
  }
}

module.exports = BattleEngine;투 조회
   */
  getBattle(battleId) {
    return this.battles.get(battleId);
  }

  /**
   * 전
