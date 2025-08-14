const { v4: uuidv4 } = require('uuid');
const { rollDice, rollMultipleDice, calculateDamage } = require('../utils/dice');
const { BATTLE_ACTIONS, BATTLE_STATUS, STATUS_EFFECTS, RULESETS } = require('../utils/rules');

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
        turnTimeLimit: config.turnTimeLimit || 30000, // 30초
        maxTurns: config.maxTurns || 50,
        autoStart: config.autoStart !== false, // 기본값 true
        allowSpectatorChat: config.allowSpectatorChat || false
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
    const baseStats = ruleset.baseStats;
    const customStats = config.stats || {};
    
    return {
      id: config.id,
      name: config.name,
      image: config.image,
      
      // HP/MP
      hp: config.maxHp || baseStats.maxHp,
      maxHp: config.maxHp || baseStats.maxHp,
      mp: config.maxMp || baseStats.maxMp,
      maxMp: config.maxMp || baseStats.maxMp,
      
      // 스탯
      stats: {
        attack: customStats.attack || baseStats.attack,
        defense: customStats.defense || baseStats.defense,
        speed: customStats.speed || baseStats.speed,
        accuracy: customStats.accuracy || baseStats.accuracy,
        critical: customStats.critical || baseStats.critical,
        luck: customStats.luck || baseStats.luck
      },
      
      // 상태
      statusEffects: [],
      temporaryStats: {},
      
      // 연결 상태
      connected: false,
      socketId: null,
      lastAction: null,
      
      // 전투 통계
      damageDealt: 0,
      damageTaken: 0,
      actionsUsed: 0,
      criticalHits: 0
    };
  }

  /**
   * 전투 조회
   */
  getBattle(battleId) {
    return this.battles.get(battleId);
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
      message: `${participant.name}이 전투에 참여했습니다.`,
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
      message: `${participant.name}의 연결이 끊어졌습니다.`,
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
    battle.currentTurn = this.determineTurnOrder(battle);
    battle.turnCount = 1;
    battle.turnStartTime = Date.now();

    this.addLogEntry(battle, {
      type: 'system',
      message: '⚔️ 전투가 시작되었습니다!',
      participants: Object.values(battle.participants).map(p => ({
        name: p.name,
        hp: p.hp,
        mp: p.mp
      })),
      timestamp: new Date()
    });

    // 턴 타이머 시작
    this.startTurnTimer(battleId);

    this.logger.info(`Battle started: ${battleId}`);
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
   * 턴 순서 결정 (속도 기반)
   */
  determineTurnOrder(battle) {
    const participants = Object.entries(battle.participants);
    const [keyA, participantA] = participants[0];
    const [keyB, participantB] = participants[1];

    const speedA = this.getEffectiveStats(participantA).speed;
    const speedB = this.getEffectiveStats(participantB).speed;

    if (speedA > speedB) {
      return keyA;
    } else if (speedB > speedA) {
      return keyB;
    } else {
      // 동일한 속도면 랜덤 + 운 스탯 고려
      const luckA = participantA.stats.luck;
      const luckB = participantB.stats.luck;
      const randomA = rollDice(20) + luckA;
      const randomB = rollDice(20) + luckB;
      
      return randomA >= randomB ? keyA : keyB;
    }
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
    const validation = this.validateAction(participant, action);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 액션 처리
    const result = this.processAction(battle, participantKey, action);
    
    if (result.success) {
      // 통계 업데이트
      participant.actionsUsed++;
      participant.lastAction = action;

      // 로그 추가
      this.addLogEntry(battle, result.logEntry);
      
      // 전투 종료 체크
      if (this.checkBattleEnd(battle)) {
        this.endBattle(battle);
      } else {
        this.nextTurn(battle);
      }
    }

    return result;
  }

  /**
   * 액션 유효성 검증
   */
  validateAction(participant, action) {
    switch (action.type) {
      case BATTLE_ACTIONS.ATTACK:
        return { valid: true };
      
      case BATTLE_ACTIONS.DEFEND:
        return { valid: true };
      
      case BATTLE_ACTIONS.SKILL:
        if (!action.skill) {
          return { valid: false, error: 'Skill not specified' };
        }
        if (participant.mp < action.skill.cost) {
          return { valid: false, error: 'Insufficient MP' };
        }
        return { valid: true };
      
      case BATTLE_ACTIONS.ITEM:
        if (!action.item) {
          return { valid: false, error: 'Item not specified' };
        }
        return { valid: true };
      
      default:
        return { valid: false, error: 'Unknown action type' };
    }
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
        return this.processAttack(attacker, defender, action);
      
      case BATTLE_ACTIONS.DEFEND:
        return this.processDefend(attacker, action);
      
      case BATTLE_ACTIONS.SKILL:
        return this.processSkill(attacker, defender, action);
      
      case BATTLE_ACTIONS.ITEM:
        return this.processItem(attacker, action);
      
      default:
        return { success: false, error: 'Unknown action type' };
    }
  }

  /**
   * 공격 처리
   */
  processAttack(attacker, defender, action) {
    const attackerStats = this.getEffectiveStats(attacker);
    const defenderStats = this.getEffectiveStats(defender);
    
    // 명중률 계산
    const accuracyRoll = rollDice(20);
    const hitChance = attackerStats.accuracy - defenderStats.speed + accuracyRoll;
    const isHit = hitChance >= 10; // 기본 명중 기준값
    
    if (!isHit) {
      return {
        success: true,
        logEntry: {
          type: 'attack',
          attacker: attacker.name,
          defender: defender.name,
          hit: false,
          roll: accuracyRoll,
          message: `${attacker.name}의 공격이 빗나갔습니다! (${accuracyRoll})`,
          timestamp: new Date()
        }
      };
    }

    // 데미지 계산
    const damageRoll = rollDice(20);
    const baseDamage = calculateDamage(attackerStats.attack, defenderStats.defense, damageRoll);
    
    // 크리티컬 히트 체크
    const criticalRoll = rollDice(100);
    const isCritical = criticalRoll <= attackerStats.critical;
    const finalDamage = isCritical ? Math.floor(baseDamage * 1.5) : baseDamage;
    
    // 방어 상태 효과 적용
    const defendEffect = defender.statusEffects.find(e => e.type === 'defend');
    const actualDamage = defendEffect 
      ? Math.floor(finalDamage * (1 - defendEffect.value))
      : finalDamage;
    
    // 데미지 적용
    defender.hp = Math.max(0, defender.hp - actualDamage);
    
    // 통계 업데이트
    attacker.damageDealt += actualDamage;
    defender.damageTaken += actualDamage;
    if (isCritical) attacker.criticalHits++;

    return {
      success: true,
      logEntry: {
        type: 'attack',
        attacker: attacker.name,
        defender: defender.name,
        hit: true,
        damage: actualDamage,
        critical: isCritical,
        roll: damageRoll,
        message: `${attacker.name}이 ${defender.name}에게 ${actualDamage} 데미지를 입혔습니다!${isCritical ? '크리티컬!' : ''} (${damageRoll})`,
        timestamp: new Date()
      },
      effects: {
        damageDealt: actualDamage,
        targetHp: defender.hp,
        critical: isCritical
      }
    };
  }

  /**
   * 방어 처리
   */
  processDefend(attacker, action) {
    // 기존 방어 효과 제거
    attacker.statusEffects = attacker.statusEffects.filter(e => e.type !== 'defend');
    
    // 새 방어 효과 추가
    attacker.statusEffects.push({
      type: 'defend',
      duration: 1,
      value: 0.5, // 50% 데미지 감소
      source: 'defend_action'
    });

    return {
      success: true,
      logEntry: {
        type: 'defend',
        participant: attacker.name,
        message: `${attacker.name}이 방어 태세를 취했습니다!`,
        timestamp: new Date()
      }
    };
  }

  /**
   * 스킬 처리
   */
  processSkill(attacker, defender, action) {
    const skill = action.skill;
    
    // MP 소모
    attacker.mp -= skill.cost;
    
    let result = {
      success: true,
      logEntry: {
        type: 'skill',
        attacker: attacker.name,
        skill: skill.name,
        timestamp: new Date()
      },
      effects: {
        mpUsed: skill.cost,
        casterMp: attacker.mp
      }
    };

    // 스킬 타입별 처리
    switch (skill.type) {
      case 'damage':
        const attackerStats = this.getEffectiveStats(attacker);
        const defenderStats = this.getEffectiveStats(defender);
        const damage = calculateDamage(
          attackerStats.attack * skill.power, 
          defenderStats.defense
        );
        
        defender.hp = Math.max(0, defender.hp - damage);
        attacker.damageDealt += damage;
        defender.damageTaken += damage;
        
        result.logEntry.defender = defender.name;
        result.logEntry.damage = damage;
        result.logEntry.message = `${attacker.name}이 ${skill.name}을 사용해 ${defender.name}에게 ${damage} 데미지를 입혔습니다!`;
        result.effects.damageDealt = damage;
        result.effects.targetHp = defender.hp;
        break;
        
      case 'heal':
        const healAmount = Math.min(skill.power, attacker.maxHp - attacker.hp);
        attacker.hp += healAmount;
        
        result.logEntry.heal = healAmount;
        result.logEntry.message = `${attacker.name}이 ${skill.name}을 사용해 HP를 ${healAmount} 회복했습니다!`;
        result.effects.healAmount = healAmount;
        result.effects.casterHp = attacker.hp;
        break;
        
      case 'buff':
        attacker.statusEffects.push({
          type: 'buff',
          stat: skill.stat,
          value: skill.value,
          duration: skill.duration,
          source: skill.name
        });
        
        result.logEntry.message = `${attacker.name}이 ${skill.name}을 사용했습니다! ${skill.stat} +${skill.value} (${skill.duration}턴)`;
        break;
        
      case 'debuff':
        defender.statusEffects.push({
          type: 'debuff',
          stat: skill.stat,
          value: skill.value,
          duration: skill.duration,
          source: skill.name
        });
        
        result.logEntry.defender = defender.name;
        result.logEntry.message = `${attacker.name}이 ${skill.name}을 사용해 ${defender.name}의 ${skill.stat}을 ${skill.value} 감소시켰습니다! (${skill.duration}턴)`;
        break;
    }

    return result;
  }

  /**
   * 아이템 처리
   */
  processItem(attacker, action) {
    const item = action.item;
    
    switch (item.type) {
      case 'heal':
        const healAmount = Math.min(item.power, attacker.maxHp - attacker.hp);
        attacker.hp += healAmount;
        
        return {
          success: true,
          logEntry: {
            type: 'item',
            participant: attacker.name,
            item: item.name,
            heal: healAmount,
            message: `${attacker.name}이 ${item.name}을 사용해 HP를 ${healAmount} 회복했습니다!`,
            timestamp: new Date()
          },
          effects: {
            healAmount: healAmount,
            targetHp: attacker.hp
          }
        };
      
      case 'mp_restore':
        const mpAmount = Math.min(item.power, attacker.maxMp - attacker.mp);
        attacker.mp += mpAmount;
        
        return {
          success: true,
          logEntry: {
            type: 'item',
            participant: attacker.name,
            item: item.name,
            mpRestore: mpAmount,
            message: `${attacker.name}이 ${item.name}을 사용해 MP를 ${mpAmount} 회복했습니다!`,
            timestamp: new Date()
          },
          effects: {
            mpRestored: mpAmount,
            targetMp: attacker.mp
          }
        };
      
      default:
        return { success: false, error: 'Unknown item type' };
    }
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
      this.endBattle(battle, 'timeout');
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
   * 효과적인 스탯 계산 (버프/디버프 적용)
   */
  getEffectiveStats(participant) {
    const baseStats = { ...participant.stats };
    const effectiveStats = { ...baseStats };
    
    participant.statusEffects.forEach(effect => {
      if (effect.type === 'buff' && effect.stat in effectiveStats) {
        effectiveStats[effect.stat] += effect.value;
      } else if (effect.type === 'debuff' && effect.stat in effectiveStats) {
        effectiveStats[effect.stat] = Math.max(1, effectiveStats[effect.stat] - effect.value);
      }
    });
    
    return effectiveStats;
  }

  /**
   * 전투 종료 조건 체크
   */
  checkBattleEnd(battle) {
    const aliveParticipants = Object.values(battle.participants).filter(p => p.hp > 0);
    return aliveParticipants.length <= 1;
  }

  /**
   * 전투 종료
   */
  endBattle(battle, reason = 'normal') {
    battle.status = BATTLE_STATUS.ENDED;
    battle.endedAt = new Date();
    this.clearTurnTimer(battle.id);

    let winner = null;
    let message = '';

    if (reason === 'timeout') {
      // 시간 초과 시 HP가 높은 쪽 승리
      const participantA = battle.participants.A;
      const participantB = battle.participants.B;
      
      if (participantA.hp > participantB.hp) {
        winner = participantA;
        message = `시간 초과! ${winner.name}이 승리했습니다! (HP: ${winner.hp})`;
      } else if (participantB.hp > participantA.hp) {
        winner = participantB;
        message = `시간 초과! ${winner.name}이 승리했습니다! (HP: ${winner.hp})`;
      } else {
        message = '시간 초과! 무승부입니다!';
      }
    } else {
      const alive = Object.values(battle.participants).filter(p => p.hp > 0);
      if (alive.length === 1) {
        winner = alive[0];
        message = `${winner.name}이 승리했습니다!`;
      } else {
        message = '무승부입니다!';
      }
    }

    this.addLogEntry(battle, {
      type: 'system',
      message: message,
      winner: winner?.name,
      reason: reason,
      finalStats: {
        A: {
          name: battle.participants.A.name,
          hp: battle.participants.A.hp,
          damageDealt: battle.participants.A.damageDealt,
          damageTaken: battle.participants.A.damageTaken,
          criticalHits: battle.participants.A.criticalHits
        },
        B: {
          name: battle.participants.B.name,
          hp: battle.participants.B.hp,
          damageDealt: battle.participants.B.damageDealt,
          damageTaken: battle.participants.B.damageTaken,
          criticalHits: battle.participants.B.criticalHits
        }
      },
      timestamp: new Date()
    });

    this.logger.info(`Battle ended: ${battle.id}, Winner: ${winner?.name || 'Draw'}, Reason: ${reason}`);
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
      message: `⏰ ${currentParticipant.name}의 턴 시간이 초과되어 자동으로 방어합니다.`,
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
          mp: battle.participants.A.mp,
          maxMp: battle.participants.A.maxMp,
          statusEffects: battle.participants.A.statusEffects,
          connected: battle.participants.A.connected
        },
        B: {
          name: battle.participants.B.name,
          image: battle.participants.B.image,
          hp: battle.participants.B.hp,
          maxHp: battle.participants.B.maxHp,
          mp: battle.participants.B.mp,
          maxMp: battle.participants.B.maxMp,
          statusEffects: battle.participants.B.statusEffects,
          connected: battle.participants.B.connected
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
        baseState.participants[participantKey].stats = participant.stats;
        baseState.participants[participantKey].battleStats = {
          damageDealt: participant.damageDealt,
          damageTaken: participant.damageTaken,
          actionsUsed: participant.actionsUsed,
          criticalHits: participant.criticalHits
        };
      }
    }

    return baseState;
  }

  /**
   * 전투 통계 계산
   */
  calculateBattleStats(battle) {
    const stats = {
      duration: battle.endedAt ? 
        Math.floor((battle.endedAt - battle.createdAt) / 1000) : 
        Math.floor((Date.now() - battle.createdAt) / 1000),
      totalTurns: battle.turnCount,
      totalDamage: Object.values(battle.participants).reduce((sum, p) => sum + p.damageDealt, 0),
      totalActions: Object.values(battle.participants).reduce((sum, p) => sum + p.actionsUsed, 0),
      participants: {}
    };

    Object.entries(battle.participants).forEach(([key, participant]) => {
      stats.participants[key] = {
        name: participant.name,
        finalHp: participant.hp,
        damageDealt: participant.damageDealt,
        damageTaken: participant.damageTaken,
        actionsUsed: participant.actionsUsed,
        criticalHits: participant.criticalHits,
        accuracy: participant.actionsUsed > 0 ? 
          Math.round((participant.damageDealt / participant.actionsUsed) * 100) / 100 : 0
      };
    });

    return stats;
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

  /**
   * 강제 전투 종료 (관리자용)
   */
  forceBattleEnd(battleId, reason = 'admin') {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, error: 'Battle not found' };

    if (battle.status === BATTLE_STATUS.ENDED) {
      return { success: false, error: 'Battle already ended' };
    }

    this.endBattle(battle, reason);
    return { success: true };
  }

  /**
   * 전투 설정 업데이트 (진행 중이 아닌 경우만)
   */
  updateBattleSettings(battleId, newSettings) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, error: 'Battle not found' };

    if (battle.status !== BATTLE_STATUS.WAITING) {
      return { success: false, error: 'Cannot update settings of active battle' };
    }

    battle.settings = { ...battle.settings, ...newSettings };
    return { success: true };
  }

  /**
   * 참가자 재연결 처리
   */
  handleReconnect(battleId, participantId, socketId) {
    const battle = this.getBattle(battleId);
    if (!battle) return { success: false, error: 'Battle not found' };

    const participantKey = this.findParticipantKey(battle, participantId);
    if (!participantKey) return { success: false, error: 'Participant not found' };

    const participant = battle.participants[participantKey];
    participant.connected = true;
    participant.socketId = socketId;

    this.addLogEntry(battle, {
      type: 'system',
      message: `${participant.name}이 다시 연결되었습니다.`,
      timestamp: new Date()
    });

    // 일시정지된 전투 재개
    if (battle.status === BATTLE_STATUS.PAUSED && this.areAllParticipantsConnected(battle)) {
      this.resumeBattle(battleId);
    }

    return { success: true, participantKey };
  }
}

module.exports = BattleEngine;