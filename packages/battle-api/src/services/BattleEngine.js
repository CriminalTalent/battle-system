// packages/battle-api/src/services/BattleEngine.js
const logger = require('../config/logger');
const { calculateDamage, calculateHeal, applyStatusEffect } = require('../utils/rules');
const { rollDice, getRandomFloat, getRandomInt } = require('../utils/dice');

class BattleEngine {
  constructor(battle) {
    this.battle = battle;
    this.player1 = battle.characters.player1.characterId;
    this.player2 = battle.characters.player2.characterId;
    this.settings = battle.settings;
    this.debugInfo = {
      calculations: {},
      randomValues: [],
      conditions: {}
    };
  }

  // 메인 액션 처리
  async processAction(actorSlot, action) {
    const startTime = Date.now();
    
    try {
      logger.info(`Processing action in battle ${this.battle.roomId}: ${actorSlot} -> ${action.type}`);

      // 액터와 타겟 설정
      const actor = this.getCharacter(actorSlot);
      const targetSlot = this.getTargetSlot(actorSlot, action.target);
      const target = this.getCharacter(targetSlot);

      // 액션 유효성 검증
      const validation = this.validateAction(actorSlot, action);
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
          result = await this.processAttack(actor, target, action);
          break;
        
        case 'skill':
          result = await this.processSkill(actor, target, action);
          break;
        
        case 'defend':
          result = await this.processDefend(actor, action);
          break;
        
        case 'heal':
          result = await this.processHeal(actor, target, action);
          break;
        
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      // 상태 이상 처리 (턴 종료 시)
      await this.processStatusEffects(actor);
      if (target && target !== actor) {
        await this.processStatusEffects(target);
      }

      // 전투 종료 조건 확인
      const battleEndCheck = this.checkBattleEnd();
      if (battleEndCheck.ended) {
        result.battleEnded = true;
        result.winner = battleEndCheck.winner;
        result.reason = battleEndCheck.reason;
      }

      // 최종 결과 구성
      const finalResult = {
        ...result,
        success: true,
        actorSlot,
        targetSlot,
        actor: {
          name: actor.name,
          hp: actor.stats.hp,
          maxHp: actor.stats.maxHp,
          statusEffects: actor.statusEffects
        },
        target: target ? {
          name: target.name,
          hp: target.stats.hp,
          maxHp: target.stats.maxHp,
          statusEffects: target.statusEffects
        } : null,
        processingTime: Date.now() - startTime,
        debug: this.debugInfo
      };

      // 통계 업데이트
      this.updateBattleStats(actorSlot, action, result);

      return finalResult;

    } catch (error) {
      logger.error('Battle engine error:', error);
      return {
        success: false,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  // 액션 유효성 검증
  validateAction(actorSlot, action) {
    const actor = this.getCharacter(actorSlot);

    // 기본 검증
    if (!actor.isAlive) {
      return { valid: false, error: '행동할 수 없는 상태입니다.' };
    }

    // 액션별 검증
    switch (action.type) {
      case 'skill':
        return this.validateSkillAction(actor, action);
      
      case 'attack':
        return this.validateAttackAction(actor, action);
      
      case 'defend':
        return { valid: true };
      
      case 'heal':
        return this.validateHealAction(actor, action);
      
      default:
        return { valid: false, error: '알 수 없는 액션 타입입니다.' };
    }
  }

  // 스킬 액션 검증
  validateSkillAction(actor, action) {
    if (!action.skillName) {
      return { valid: false, error: '스킬명이 필요합니다.' };
    }

    const skill = actor.skills.find(s => s.name === action.skillName);
    if (!skill) {
      return { valid: false, error: '존재하지 않는 스킬입니다.' };
    }

    // 쿨다운 확인
    if (!actor.canUseSkill(action.skillName)) {
      return { valid: false, error: '스킬이 쿨다운 중입니다.' };
    }

    // 비용 확인 (MP 등이 있다면)
    if (skill.cost && actor.stats.mp < skill.cost) {
      return { valid: false, error: 'MP가 부족합니다.' };
    }

    return { valid: true };
  }

  // 공격 액션 검증
  validateAttackAction(actor, action) {
    if (actor.stats.hp <= 0) {
      return { valid: false, error: '체력이 0 이하일 때는 공격할 수 없습니다.' };
    }

    return { valid: true };
  }

  // 힐 액션 검증
  validateHealAction(actor, action) {
    if (action.target && action.target !== 'self') {
      const target = this.getCharacter(action.target);
      if (!target.isAlive) {
        return { valid: false, error: '죽은 대상을 치료할 수 없습니다.' };
      }
    }

    return { valid: true };
  }

  // 공격 처리
  async processAttack(actor, target, action) {
    const attackRoll = rollDice(1, 100);
    this.debugInfo.randomValues.push({ type: 'attack_roll', value: attackRoll });

    // 명중률 계산
    const hitChance = actor.stats.accuracy || 85;
    const isHit = attackRoll <= hitChance;

    if (!isHit) {
      return {
        type: 'attack',
        hit: false,
        damage: 0,
        message: `${actor.name}의 공격이 빗나갔습니다!`
      };
    }

    // 크리티컬 확인
    const criticalRoll = rollDice(1, 100);
    this.debugInfo.randomValues.push({ type: 'critical_roll', value: criticalRoll });
    const isCritical = criticalRoll <= (actor.stats.criticalRate || 5);

    // 데미지 계산
    const baseDamage = actor.stats.attack;
    const damageVariance = getRandomFloat(0.8, 1.2); // ±20% 변동
    let finalDamage = Math.floor(baseDamage * damageVariance);

    // 크리티컬 적용
    if (isCritical) {
      finalDamage = Math.floor(finalDamage * this.settings.ruleset.criticalMultiplier);
    }

    // 방어력 적용
    const defense = target.stats.defense * this.settings.ruleset.defenseReduction;
    finalDamage = Math.max(1, finalDamage - defense);

    this.debugInfo.calculations.damage = {
      baseDamage,
      damageVariance,
      criticalMultiplier: isCritical ? this.settings.ruleset.criticalMultiplier : 1,
      defense,
      finalDamage
    };

    // 데미지 적용
    const actualDamage = target.takeDamage(finalDamage);
    actor.battleStats.totalDamageDealt += actualDamage;

    if (isCritical) {
      actor.battleStats.criticalHits++;
    }

    return {
      type: 'attack',
      hit: true,
      damage: actualDamage,
      isCritical,
      targetDefeated: !target.isAlive,
      message: isCritical ? 
        `${actor.name}이(가) ${target.name}에게 치명타로 ${actualDamage} 데미지를 입혔습니다!` :
        `${actor.name}이(가) ${target.name}에게 ${actualDamage} 데미지를 입혔습니다!`
    };
  }

  // 스킬 처리
  async processSkill(actor, target, action) {
    const skill = actor.skills.find(s => s.name === action.skillName);
    
    if (!skill) {
      throw new Error('스킬을 찾을 수 없습니다.');
    }

    // 스킬 쿨다운 설정
    const existingCooldown = actor.skillCooldowns.find(c => c.skillName === skill.name);
    if (existingCooldown) {
      existingCooldown.remainingTurns = skill.cooldown;
    } else {
      actor.skillCooldowns.push({
        skillName: skill.name,
        remainingTurns: skill.cooldown
      });
    }

    actor.battleStats.skillsUsed++;

    let result = {
      type: 'skill',
      skillName: skill.name,
      skillType: skill.type,
      effects: []
    };

    // 스킬 타입별 처리
    switch (skill.type) {
      case 'attack':
        result = { ...result, ...(await this.processAttackSkill(actor, target, skill)) };
        break;
      
      case 'heal':
        result = { ...result, ...(await this.processHealSkill(actor, target, skill)) };
        break;
      
      case 'buff':
        result = { ...result, ...(await this.processBuffSkill(actor, target, skill)) };
        break;
      
      case 'debuff':
        result = { ...result, ...(await this.processDebuffSkill(actor, target, skill)) };
        break;
      
      case 'special':
        result = { ...result, ...(await this.processSpecialSkill(actor, target, skill)) };
        break;
    }

    result.message = `${actor.name}이(가) ${skill.name}을(를) 사용했습니다!`;
    
    return result;
  }

  // 공격 스킬 처리
  async processAttackSkill(actor, target, skill) {
    const hitRoll = rollDice(1, 100);
    const hitChance = (actor.stats.accuracy || 85) + (skill.accuracy || 0);
    const isHit = hitRoll <= hitChance;

    if (!isHit) {
      return {
        hit: false,
        damage: 0,
        message: `${skill.name}이(가) 빗나갔습니다!`
      };
    }

    // 스킬 데미지 계산
    const skillPower = skill.power || 0;
    const baseDamage = actor.stats.attack + skillPower;
    const damageVariance = getRandomFloat(0.9, 1.1); // ±10% 변동
    let finalDamage = Math.floor(baseDamage * damageVariance);

    // 방어력 적용
    const defense = target.stats.defense * this.settings.ruleset.defenseReduction;
    finalDamage = Math.max(1, finalDamage - defense);

    // 데미지 적용
    const actualDamage = target.takeDamage(finalDamage);
    actor.battleStats.totalDamageDealt += actualDamage;

    // 스킬 효과 적용
    const effects = [];
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        const appliedEffect = await this.applySkillEffect(target, effect);
        effects.push(appliedEffect);
      }
    }

    return {
      hit: true,
      damage: actualDamage,
      effects,
      targetDefeated: !target.isAlive
    };
  }

  // 힐 스킬 처리
  async processHealSkill(actor, target, skill) {
    const healPower = skill.power || 0;
    const baseHeal = healPower;
    const healVariance = getRandomFloat(0.9, 1.1);
    const finalHeal = Math.floor(baseHeal * healVariance);

    const actualHeal = target.heal(finalHeal);

    return {
      heal: actualHeal,
      effects: [],
      message: `${target.name}이(가) ${actualHeal} 회복했습니다!`
    };
  }

  // 버프 스킬 처리
  async processBuffSkill(actor, target, skill) {
    const effects = [];
    
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        const appliedEffect = await this.applySkillEffect(target, effect);
        effects.push(appliedEffect);
      }
    }

    return {
      effects,
      message: `${target.name}에게 버프가 적용되었습니다!`
    };
  }

  // 디버프 스킬 처리
  async processDebuffSkill(actor, target, skill) {
    const effects = [];
    
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        const appliedEffect = await this.applySkillEffect(target, effect);
        effects.push(appliedEffect);
      }
    }

    return {
      effects,
      message: `${target.name}에게 디버프가 적용되었습니다!`
    };
  }

  // 특수 스킬 처리
  async processSpecialSkill(actor, target, skill) {
    // 특수 스킬별 커스텀 로직
    const effects = [];
    
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        const appliedEffect = await this.applySkillEffect(target, effect);
        effects.push(appliedEffect);
      }
    }

    return {
      effects,
      message: `${skill.name}의 특수 효과가 발동했습니다!`
    };
  }

  // 방어 처리
  async processDefend(actor, action) {
    // 방어 버프 적용 (다음 턴까지)
    actor.addStatusEffect({
      type: 'buff_defense',
      value: Math.floor(actor.stats.defense * 0.5), // 방어력 50% 증가
      duration: 1
    });

    return {
      type: 'defend',
      message: `${actor.name}이(가) 방어 자세를 취했습니다!`,
      effects: [{
        type: 'buff_defense',
        applied: true,
        duration: 1
      }]
    };
  }

  // 힐 처리
  async processHeal(actor, target, action) {
    const baseHeal = action.healAmount || 30;
    const healVariance = getRandomFloat(0.8, 1.2);
    const finalHeal = Math.floor(baseHeal * healVariance);

    const actualHeal = target.heal(finalHeal);

    return {
      type: 'heal',
      heal: actualHeal,
      message: `${target.name}이(가) ${actualHeal} 회복했습니다!`
    };
  }

  // 스킬 효과 적용
  async applySkillEffect(target, effect) {
    const duration = effect.duration || this.settings.ruleset.statusEffectDuration;
    
    target.addStatusEffect({
      type: effect.type,
      value: effect.value,
      duration
    });

    return {
      type: effect.type,
      value: effect.value,
      duration,
      applied: true,
      target: target.name
    };
  }

  // 상태 이상 처리
  async processStatusEffects(character) {
    const expiredEffects = [];
    
    for (let i = character.statusEffects.length - 1; i >= 0; i--) {
      const effect = character.statusEffects[i];
      
      // 지속 시간 감소
      effect.duration--;
      
      // 효과 적용
      switch (effect.type) {
        case 'poison':
          const poisonDamage = effect.value;
          character.takeDamage(poisonDamage);
          this.debugInfo.conditions.poison = { damage: poisonDamage };
          break;
        
        case 'burn':
          const burnDamage = effect.value;
          character.takeDamage(burnDamage);
          this.debugInfo.conditions.burn = { damage: burnDamage };
          break;
        
        // 버프/디버프는 스탯에 영향을 주므로 별도 처리 불필요
      }
      
      // 지속 시간이 끝난 효과 제거
      if (effect.duration <= 0) {
        expiredEffects.push(effect.type);
        character.statusEffects.splice(i, 1);
      }
    }

    return expiredEffects;
  }

  // 전투 종료 조건 확인
  checkBattleEnd() {
    const player1Alive = this.player1.isAlive;
    const player2Alive = this.player2.isAlive;

    if (!player1Alive && !player2Alive) {
      return { ended: true, winner: 'draw', reason: 'both_defeated' };
    }
    
    if (!player1Alive) {
      return { ended: true, winner: 'player2', reason: 'knockout' };
    }
    
    if (!player2Alive) {
      return { ended: true, winner: 'player1', reason: 'knockout' };
    }

    // 최대 턴 수 확인
    if (this.battle.turnNumber >= this.battle.settings.maxTurns) {
      // HP가 더 높은 쪽 승리
      if (this.player1.stats.hp > this.player2.stats.hp) {
        return { ended: true, winner: 'player1', reason: 'timeout' };
      } else if (this.player2.stats.hp > this.player1.stats.hp) {
        return { ended: true, winner: 'player2', reason: 'timeout' };
      } else {
        return { ended: true, winner: 'draw', reason: 'timeout' };
      }
    }

    return { ended: false };
  }

  // 전투 통계 업데이트
  updateBattleStats(actorSlot, action, result) {
    // 추가 통계 업데이트 로직
    if (action.type === 'attack' && result.damage) {
      // 이미 processAttack에서 처리됨
    }
    
    if (action.type === 'skill') {
      // 이미 processSkill에서 처리됨
    }
  }

  // 헬퍼 메서드들
  getCharacter(slot) {
    return slot === 'player1' ? this.player1 : this.player2;
  }

  getTargetSlot(actorSlot, targetAction) {
    if (targetAction === 'self') {
      return actorSlot;
    }
    if (targetAction === 'enemy') {
      return actorSlot === 'player1' ? 'player2' : 'player1';
    }
    return targetAction; // 명시적으로 지정된 경우
  }

  // 현재 버프/디버프가 적용된 실제 스탯 계산
  getEffectiveStats(character) {
    const baseStats = { ...character.stats };
    
    character.statusEffects.forEach(effect => {
      switch (effect.type) {
        case 'buff_attack':
          baseStats.attack += effect.value;
          break;
        case 'debuff_attack':
          baseStats.attack = Math.max(1, baseStats.attack - effect.value);
          break;
        case 'buff_defense':
          baseStats.defense += effect.value;
          break;
        case 'debuff_defense':
          baseStats.defense = Math.max(0, baseStats.defense - effect.value);
          break;
      }
    });

    return baseStats;
  }

  // 대사 관련 전투 이벤트 (새로 추가)
  processDialogueEvent(playerSlot, dialogue) {
    // 대사가 전투에 특별한 영향을 주는 경우 처리
    // 예: 도발 대사로 상대방 공격력 일시 감소 등
    
    const effects = [];
    
    if (dialogue.category === 'taunt') {
      const target = this.getCharacter(playerSlot === 'player1' ? 'player2' : 'player1');
      
      // 도발 효과: 상대방 정확도 일시 감소
      target.addStatusEffect({
        type: 'debuff_accuracy',
        value: 10, // 정확도 10% 감소
        duration: 2
      });
      
      effects.push({
        type: 'taunt_effect',
        target: target.name,
        description: '도발로 인해 집중력이 흐트러졌습니다!'
      });
    }

    return {
      dialogueEffects: effects,
      message: effects.length > 0 ? '대사가 전투에 영향을 주었습니다!' : null
    };
  }

  // 턴 시작 시 처리
  async processTurnStart(playerSlot) {
    const character = this.getCharacter(playerSlot);
    
    // 스킬 쿨다운 업데이트
    character.updateCooldowns();
    
    // 상태 이상 지속 시간 업데이트는 액션 후에 처리
    
    return {
      cooldownsUpdated: true,
      availableSkills: character.skills.filter(skill => 
        character.canUseSkill(skill.name)
      ).map(skill => skill.name)
    };
  }
}

module.exports = BattleEngine;