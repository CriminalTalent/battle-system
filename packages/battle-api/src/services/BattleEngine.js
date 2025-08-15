// packages/battle-api/src/services/BattleEngine.js (팀전 버전)
const logger = require('../config/logger');
const { calculateDamage, calculateHeal, applyStatusEffect } = require('../utils/rules');
const { rollDice, getRandomFloat, getRandomInt } = require('../utils/dice');

class BattleEngine {
  constructor(battle) {
    this.battle = battle;
    this.settings = battle.settings;
    this.debugInfo = {
      calculations: {},
      randomValues: [],
      conditions: {}
    };
  }

  // 메인 액션 처리 (팀전 버전)
  async processAction(actorTeam, actorPosition, action) {
    const startTime = Date.now();
    
    try {
      logger.info(`Processing team action in battle ${this.battle.roomId}: ${actorTeam}[${actorPosition}] -> ${action.type}`);

      // 액터 정보 가져오기
      const actor = this.getTeamMember(actorTeam, actorPosition);
      if (!actor || !actor.isAlive) {
        return {
          success: false,
          error: '액션을 수행할 수 없는 상태입니다.',
          processingTime: Date.now() - startTime
        };
      }

      // 액션 유효성 검증
      const validation = this.validateTeamAction(actorTeam, actorPosition, action);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          processingTime: Date.now() - startTime
        };
      }

      let result = {};

      // 액션 타입별 처리
      switch (action.type) {
        case 'attack':
          result = await this.processTeamAttack(actorTeam, actorPosition, action);
          break;
        
        case 'skill':
          result = await this.processTeamSkill(actorTeam, actorPosition, action);
          break;
        
        case 'defend':
          result = await this.processTeamDefend(actorTeam, actorPosition, action);
          break;
        
        case 'heal':
          result = await this.processTeamHeal(actorTeam, actorPosition, action);
          break;
        
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      // 모든 살아있는 캐릭터의 상태 이상 처리
      await this.processAllStatusEffects();

      // 전투 종료 조건 확인
      const battleEndCheck = this.battle.checkBattleEnd();
      if (battleEndCheck.ended) {
        result.battleEnded = true;
        result.winner = battleEndCheck.winner;
        result.reason = battleEndCheck.reason;
      }

      // 최종 결과 구성
      const finalResult = {
        ...result,
        success: true,
        actor: {
          team: actorTeam,
          position: actorPosition,
          name: actor.characterId.name,
          hp: actor.characterId.stats.hp,
          maxHp: actor.characterId.stats.maxHp
        },
        processingTime: Date.now() - startTime,
        debug: this.debugInfo
      };

      return finalResult;

    } catch (error) {
      logger.error('Team battle engine error:', error);
      return {
        success: false,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  // 팀 액션 유효성 검증
  validateTeamAction(actorTeam, actorPosition, action) {
    const actor = this.getTeamMember(actorTeam, actorPosition);
    
    if (!actor || !actor.isAlive) {
      return { valid: false, error: '행동할 수 없는 상태입니다.' };
    }

    // 대상 검증
    if (action.targets && action.targets.length > 0) {
      for (const target of action.targets) {
        if (!this.battle.isValidTarget(actorTeam, actorPosition, target.team, target.position, action.type)) {
          return { valid: false, error: '유효하지 않은 대상입니다.' };
        }
      }
    }

    // 액션별 검증
    switch (action.type) {
      case 'skill':
        return this.validateTeamSkillAction(actor, action);
      
      case 'attack':
        return this.validateTeamAttackAction(actor, action);
      
      case 'defend':
        return this.validateTeamDefendAction(actor, action);
      
      case 'heal':
        return this.validateTeamHealAction(actor, action);
      
      default:
        return { valid: false, error: '알 수 없는 액션 타입입니다.' };
    }
  }

  // 팀 공격 처리
  async processTeamAttack(actorTeam, actorPosition, action) {
    const actor = this.getTeamMember(actorTeam, actorPosition);
    const results = [];

    // 대상이 지정되지 않았으면 기본 대상 선택
    let targets = action.targets;
    if (!targets || targets.length === 0) {
      // 상대 팀에서 랜덤하게 살아있는 대상 1명 선택
      const enemyTeam = actorTeam === 'team1' ? 'team2' : 'team1';
      const aliveEnemies = this.battle.teams[enemyTeam].filter(m => m.isAlive);
      
      if (aliveEnemies.length === 0) {
        return {
          type: 'attack',
          success: false,
          message: '공격할 대상이 없습니다.',
          results: []
        };
      }
      
      const randomTarget = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
      targets = [{ team: enemyTeam, position: randomTarget.position }];
    }

    // 각 대상에 대해 공격 처리
    for (const targetInfo of targets) {
      const target = this.getTeamMember(targetInfo.team, targetInfo.position);
      
      if (!target || !target.isAlive) {
        continue;
      }

      const attackResult = await this.performSingleAttack(actor, target);
      attackResult.target = {
        team: targetInfo.team,
        position: targetInfo.position,
        name: target.characterId.name
      };
      
      results.push(attackResult);
    }

    return {
      type: 'attack',
      success: true,
      results,
      message: `${actor.characterId.name}의 공격!`
    };
  }

  // 단일 공격 수행
  async performSingleAttack(actor, target) {
    const attackRoll = rollDice(1, 100);
    this.debugInfo.randomValues.push({ type: 'attack_roll', value: attackRoll });

    // 명중률 계산
    const hitChance = actor.characterId.stats.accuracy || 85;
    const isHit = attackRoll <= hitChance;

    if (!isHit) {
      return {
        hit: false,
        damage: 0,
        message: `${actor.characterId.name}의 공격이 빗나갔습니다!`
      };
    }

    // 크리티컬 확인
    const criticalRoll = rollDice(1, 100);
    const isCritical = criticalRoll <= (actor.characterId.stats.criticalRate || 5);

    // 데미지 계산
    const baseDamage = actor.characterId.stats.attack;
    const damageVariance = getRandomFloat(0.8, 1.2);
    let finalDamage = Math.floor(baseDamage * damageVariance);

    if (isCritical) {
      finalDamage = Math.floor(finalDamage * this.settings.ruleset.criticalMultiplier);
    }

    // 방어력 적용
    const defense = target.characterId.stats.defense * this.settings.ruleset.defenseReduction;
    finalDamage = Math.max(1, finalDamage - defense);

    // 데미지 적용
    const actualDamage = target.characterId.takeDamage(finalDamage);
    
    // 사망 확인
    if (target.characterId.stats.hp <= 0) {
      target.isAlive = false;
    }

    return {
      hit: true,
      damage: actualDamage,
      isCritical,
      targetDefeated: !target.isAlive,
      message: isCritical ? 
        `${target.characterId.name}에게 치명타로 ${actualDamage} 데미지!` :
        `${target.characterId.name}에게 ${actualDamage} 데미지!`
    };
  }

  // 팀 방어 처리
  async processTeamDefend(actorTeam, actorPosition, action) {
    const actor = this.getTeamMember(actorTeam, actorPosition);
    const results = [];

    // 방어 대상들 처리
    let targets = action.targets;
    if (!targets || targets.length === 0) {
      // 기본적으로 자신을 방어
      targets = [{ team: actorTeam, position: actorPosition }];
    }

    for (const targetInfo of targets) {
      const target = this.getTeamMember(targetInfo.team, targetInfo.position);
      
      if (!target || !target.isAlive) {
        continue;
      }

      // 방어 버프 적용
      target.characterId.addStatusEffect({
        type: 'buff_defense',
        value: Math.floor(target.characterId.stats.defense * 0.5),
        duration: 2 // 2턴 동안
      });

      results.push({
        target: {
          team: targetInfo.team,
          position: targetInfo.position,
          name: target.characterId.name
        },
        defenseBonus: Math.floor(target.characterId.stats.defense * 0.5),
        message: `${target.characterId.name}의 방어력이 강화되었습니다!`
      });
    }

    return {
      type: 'defend',
      success: true,
      results,
      message: `${actor.characterId.name}이(가) 동료를 보호합니다!`
    };
  }

  // 팀 힐 처리
  async processTeamHeal(actorTeam, actorPosition, action) {
    const actor = this.getTeamMember(actorTeam, actorPosition);
    const results = [];

    // 힐 대상들 처리
    let targets = action.targets;
    if (!targets || targets.length === 0) {
      // 기본적으로 자신을 힐
      targets = [{ team: actorTeam, position: actorPosition }];
    }

    const baseHeal = action.healAmount || 30;

    for (const targetInfo of targets) {
      const target = this.getTeamMember(targetInfo.team, targetInfo.position);
      
      if (!target || !target.isAlive) {
        continue;
      }

      const healVariance = getRandomFloat(0.8, 1.2);
      const finalHeal = Math.floor(baseHeal * healVariance);
      const actualHeal = target.characterId.heal(finalHeal);

      results.push({
        target: {
          team: targetInfo.team,
          position: targetInfo.position,
          name: target.characterId.name
        },
        heal: actualHeal,
        message: `${target.characterId.name}이(가) ${actualHeal} 회복!`
      });
    }

    return {
      type: 'heal',
      success: true,
      results,
      message: `${actor.characterId.name}이(가) 치료를 시전했습니다!`
    };
  }

  // 팀 스킬 처리
  async processTeamSkill(actorTeam, actorPosition, action) {
    const actor = this.getTeamMember(actorTeam, actorPosition);
    const skill = actor.characterId.skills.find(s => s.name === action.skillName);
    
    if (!skill) {
      throw new Error('스킬을 찾을 수 없습니다.');
    }

    // 스킬 쿨다운 설정
    const existingCooldown