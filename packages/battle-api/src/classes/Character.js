import { GAME_CONFIG } from './constants.js';

export class Character {
  constructor(name, stats) {
    this.name = name;
    this.maxHp = GAME_CONFIG.STARTING_HP;
    this.hp = GAME_CONFIG.STARTING_HP;
    this.stats = {
      attack: Math.max(GAME_CONFIG.MIN_STAT, Math.min(GAME_CONFIG.MAX_STAT, stats.attack)),
      defense: Math.max(GAME_CONFIG.MIN_STAT, Math.min(GAME_CONFIG.MAX_STAT, stats.defense)),
      agility: Math.max(GAME_CONFIG.MIN_STAT, Math.min(GAME_CONFIG.MAX_STAT, stats.agility)),
      luck: Math.max(GAME_CONFIG.MIN_STAT, Math.min(GAME_CONFIG.MAX_STAT, stats.luck))
    };
  }

  // 주사위 굴리기 (d20)
  rollD20() {
    return Math.floor(Math.random() * GAME_CONFIG.DICE_SIDES) + 1;
  }

  // 명중 판정
  rollToHit(target) {
    const attackRoll = this.rollD20() + this.stats.agility;
    const defenseValue = GAME_CONFIG.BASE_AC + target.stats.agility; // AC = 10 + 민첩
    return {
      roll: attackRoll,
      defense: defenseValue,
      hit: attackRoll >= defenseValue
    };
  }

  // 크리티컬 히트 판정
  isCritical(roll) {
    const criticalThreshold = 20 - Math.floor(this.stats.luck / 2); // 행운이 높을수록 크리티컬 확률 증가
    return roll >= criticalThreshold;
  }

  // 데미지 계산
  calculateDamage(isCritical = false) {
    let damage = this.stats.attack + Math.floor(Math.random() * GAME_CONFIG.BASE_DAMAGE_DICE) + 1; // 기본 공격력 + 1d6
    if (isCritical) {
      damage *= GAME_CONFIG.CRITICAL_MULTIPLIER;
    }
    return damage;
  }

  // 데미지 받기
  takeDamage(damage) {
    const reducedDamage = Math.max(GAME_CONFIG.MIN_DAMAGE, damage - this.stats.defense); // 방어력으로 데미지 감소, 최소 1
    this.hp = Math.max(0, this.hp - reducedDamage);
    return reducedDamage;
  }

  // 생존 여부
  isAlive() {
    return this.hp > 0;
  }

  // 상태 초기화
  reset() {
    this.hp = this.maxHp;
  }

  // 캐릭터 정보 반환
  getInfo() {
    return {
      name: this.name,
      hp: this.hp,
      maxHp: this.maxHp,
      stats: { ...this.stats },
      isAlive: this.isAlive()
    };
  }

  // 공격력 보너스 계산
  getAttackBonus() {
    return this.stats.agility;
  }

  // 방어도 계산
  getArmorClass() {
    return GAME_CONFIG.BASE_AC + this.stats.agility;
  }

  // 크리티컬 확률 계산
  getCriticalChance() {
    const threshold = 20 - Math.floor(this.stats.luck / 2);
    return ((20 - threshold + 1) / 20) * 100; // 퍼센트로 반환
  }

  // 평균 데미지 계산
  getAverageDamage() {
    const baseDamage = this.stats.attack + (GAME_CONFIG.BASE_DAMAGE_DICE / 2) + 0.5;
    const critChance = this.getCriticalChance() / 100;
    const critDamage = baseDamage * GAME_CONFIG.CRITICAL_MULTIPLIER;
    return baseDamage * (1 - critChance) + critDamage * critChance;
  }

  // 디버그 정보
  getDebugInfo() {
    return {
      name: this.name,
      hp: `${this.hp}/${this.maxHp}`,
      stats: this.stats,
      attackBonus: this.getAttackBonus(),
      armorClass: this.getArmorClass(),
      criticalChance: `${this.getCriticalChance().toFixed(1)}%`,
      averageDamage: this.getAverageDamage().toFixed(1)
    };
  }
}
