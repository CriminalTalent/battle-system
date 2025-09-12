// packages/battle-server/src/rules.js - 최종 게임 규칙
// 새로운 전투 시스템: 공격보정기 2배, 회피/방어 시스템 개편, 역공격 추가

import { rollWithReroll } from './dice.js';

// 아이템 정의
export const ITEMS = {
  dittany: {
    key: 'dittany',
    name: '디터니',
    type: 'heal',
    effect: 10, // 고정 회복량
    success: 100 // 100% 성공률
  },
  attack_boost: {
    key: 'attack_boost', 
    name: '공격 보정기',
    type: 'attack_buff',
    multiplier: 2.0, // 2배
    success: 10 // 10% 성공률
  },
  defense_boost: {
    key: 'defense_boost',
    name: '방어 보정기', 
    type: 'defense_buff',
    multiplier: 1.5, // 1.5배 (방어는 그대로)
    success: 10 // 10% 성공률
  }
};

export function normalizeItemKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z_]/g, '');
  return Object.keys(ITEMS).includes(normalized) ? normalized : null;
}

// 최종공격력 계산: 공격스탯 × (공격보정기 있으면 2.0, 없으면 1) + d20
export function computeFinalAttackPower(attacker, hasAttackBoost = false) {
  const attackStat = attacker.stats?.attack || 0;
  const boostMultiplier = hasAttackBoost ? 2.0 : 1.0;
  const rollResult = rollWithReroll(20);
  
  const finalPower = (attackStat * boostMultiplier) + rollResult.final;
  
  return {
    finalPower,
    attackStat,
    boostMultiplier,
    rollResult,
    breakdown: `${attackStat} × ${boostMultiplier} + ${rollResult.final} = ${finalPower}`
  };
}

// 치명타 조건: d20 ≥ (20 − 행운/2)
export function checkCriticalHit(attacker) {
  const luck = attacker.stats?.luck || 0;
  const critThreshold = 20 - Math.floor(luck / 2);
  const rollResult = rollWithReroll(20);
  
  const isCrit = rollResult.final >= critThreshold;
  
  return {
    isCrit,
    luck,
    critThreshold,
    rollResult,
    breakdown: `주사위 ${rollResult.final} >= ${critThreshold} (20 - ${luck}/2)`
  };
}

// 회피 판정: 대상 민첩 + d20 vs 공격자의 최종공격력
export function checkEvasion(defender, attackerFinalPower) {
  const agility = defender.stats?.agility || 0;
  const rollResult = rollWithReroll(20);
  const evasionTotal = agility + rollResult.final;
  
  const evaded = evasionTotal >= attackerFinalPower;
  
  return {
    evaded,
    agility,
    rollResult,
    evasionTotal,
    attackerPower: attackerFinalPower,
    breakdown: `민첩 ${agility} + 주사위 ${rollResult.final} = ${evasionTotal} vs ${attackerFinalPower}`
  };
}

// 방어값 계산: (방어스탯 × (방어보정기 있으면 2.0)) + d20
export function computeDefenseValue(defender, hasDefenseBoost = false) {
  const defenseStat = defender.stats?.defense || 0;
  const boostMultiplier = hasDefenseBoost ? 2.0 : 1.0;
  const rollResult = rollWithReroll(20);
  
  const defenseValue = (defenseStat * boostMultiplier) + rollResult.final;
  
  return {
    defenseValue,
    defenseStat,
    boostMultiplier,
    rollResult,
    breakdown: `${defenseStat} × ${boostMultiplier} + ${rollResult.final} = ${defenseValue}`
  };
}

// 피해 계산: 기본 피해 = (치명타면 최종공격력×2, 아니면 최종공격력) - 방어값, 최종 피해 = max(1, 기본 피해)
export function computeDamage(attackPower, isCrit, defenseValue = 0) {
  const baseDamage = isCrit ? attackPower * 2 : attackPower;
  const reducedDamage = baseDamage - defenseValue;
  const finalDamage = Math.max(1, reducedDamage); // 최소 1 보장
  
  return {
    finalDamage,
    baseDamage,
    reducedDamage,
    defenseValue,
    isCrit,
    breakdown: isCrit 
      ? `치명타: ${attackPower} × 2 = ${baseDamage}, ${baseDamage} - ${defenseValue} = ${reducedDamage}, 최종: ${finalDamage}`
      : `일반: ${attackPower} - ${defenseValue} = ${reducedDamage}, 최종: ${finalDamage}`
  };
}

// 역공격 피해: (대상의 공격스탯 + d20) - 방어 불가, 보정 없음
export function computeCounterAttack(defender) {
  const attackStat = defender.stats?.attack || 0;
  const rollResult = rollWithReroll(20);
  const counterDamage = attackStat + rollResult.final;
  
  return {
    counterDamage,
    attackStat,
    rollResult,
    breakdown: `${attackStat} + ${rollResult.final} = ${counterDamage}`
  };
}

// 아이템 효과 적용
export function applyItemEffect(battle, playerId, itemKey, targetId = null) {
  const item = ITEMS[itemKey];
  if (!item) return { success: false, message: '알 수 없는 아이템' };
  
  const player = battle.players?.find(p => p.id === playerId);
  if (!player) return { success: false, message: '전투참여자를 찾을 수 없음' };
  
  // 아이템 보유 체크
  if (!player.items[itemKey] || player.items[itemKey] <= 0) {
    return { success: false, message: '아이템이 부족합니다' };
  }
  
  // 성공률 체크 (디터니는 100%, 보정기들은 10%)
  const successRoll = rollWithReroll(100);
  const itemSuccess = successRoll.final <= item.success;
  
  // 아이템 소모 (실패해도 소모)
  player.items[itemKey] -= 1;
  
  if (!itemSuccess) {
    return { 
      success: false, 
      message: `${item.name} 사용 실패 (${successRoll.final}/${item.success})`,
      consumed: true,
      rollDetails: successRoll
    };
  }
  
  let target = player;
  if (targetId) {
    target = battle.players?.find(p => p.id === targetId);
    if (!target) {
      return { success: false, message: '대상을 찾을 수 없음', consumed: true };
    }
  }
  
  // 아이템 효과 적용
  switch (item.type) {
    case 'heal':
      // 디터니 - 고정 10 회복
      const oldHp = target.hp;
      target.hp = Math.min(target.maxHp || 100, target.hp + item.effect);
      const healAmount = target.hp - oldHp;
      
      return {
        success: true,
        message: `${target.name}이(가) ${healAmount} 체력을 회복했습니다`,
        consumed: true,
        effect: { type: 'heal', amount: healAmount, target: target.id }
      };
      
    case 'attack_buff':
      // 공격 보정기 - 즉시 적용하여 2배 공격 실행
      if (!targetId) {
        return { success: false, message: '공격 대상이 필요합니다', consumed: true };
      }
      
      const enemy = battle.players?.find(p => p.id === targetId);
      if (!enemy || enemy.team === player.team) {
        return { success: false, message: '올바른 적 대상을 선택하세요', consumed: true };
      }
      
      // 즉시 2배 공격 실행
      const boostedAttack = executeBoostedAttack(battle, player, enemy, item.multiplier);
      
      return {
        success: true,
        message: `${item.name} 사용 성공! ${boostedAttack.message}`,
        consumed: true,
        rollDetails: successRoll,
        attack: boostedAttack
      };
      
    case 'defense_buff':
      // 방어 보정기 - 다음 피격에 적용될 효과 저장
      if (!battle.effects) battle.effects = [];
      
      battle.effects.push({
        ownerId: playerId,
        type: 'defenseBoost',
        factor: item.multiplier, // 2배
        charges: 1,
        success: true,
        source: `item:${itemKey}`,
        appliedAt: Date.now()
      });
      
      return {
        success: true,
        message: `${item.name} 사용 성공! 다음 피격시 ${item.multiplier}배 방어력 적용`,
        consumed: true,
        rollDetails: successRoll,
        effect: { type: 'defense_buff', multiplier: item.multiplier }
      };
      
    default:
      return { success: false, message: '알 수 없는 아이템 타입', consumed: true };
  }
}

// 2배 공격 실행 함수
function executeBoostedAttack(battle, attacker, target, attackMultiplier) {
  // 최종공격력 계산 (2배 보정 적용)
  const attackResult = computeFinalAttackPower(attacker, true);
  const finalPower = attackResult.finalPower;
  
  // 회피 체크
  const evasionResult = checkEvasion(target, finalPower);
  if (evasionResult.evaded) {
    return {
      success: false,
      message: `${target.name}이(가) 보정된 공격을 회피 (${evasionResult.breakdown})`,
      damage: 0,
      evasionDetails: evasionResult,
      attackDetails: attackResult
    };
  }
  
  // 치명타 체크
  const critResult = checkCriticalHit(attacker);
  
  // 방어값 계산 (방어 보정기 효과 확인)
  let hasDefenseBoost = false;
  if (battle.effects) {
    for (const fx of battle.effects) {
      if (fx && fx.ownerId === target.id && fx.type === 'defenseBoost' && fx.charges > 0) {
        hasDefenseBoost = true;
        fx.charges -= 1;
        break;
      }
    }
    battle.effects = battle.effects.filter(e => (e?.charges || 0) > 0);
  }
  
  const defenseResult = computeDefenseValue(target, hasDefenseBoost);
  
  // 피해 계산
  const damageResult = computeDamage(finalPower, critResult.isCrit, defenseResult.defenseValue);
  
  // 체력 감소
  const oldHp = target.hp;
  target.hp = Math.max(0, target.hp - damageResult.finalDamage);
  const actualDamage = oldHp - target.hp;
  
  // 역공격 체크 (대상이 살아있고 방어 행동이었다면)
  let counterAttack = null;
  if (target.hp > 0 && hasDefenseBoost) {
    const counterResult = computeCounterAttack(target);
    attacker.hp = Math.max(0, attacker.hp - counterResult.counterDamage);
    counterAttack = {
      damage: counterResult.counterDamage,
      details: counterResult
    };
  }
  
  return {
    success: true,
    message: critResult.isCrit 
      ? `${attacker.name}의 보정된 치명타! ${target.name}에게 ${actualDamage} 피해`
      : `${attacker.name}의 보정된 공격! ${target.name}에게 ${actualDamage} 피해`,
    damage: actualDamage,
    attackDetails: attackResult,
    critDetails: critResult,
    evasionDetails: evasionResult,
    defenseDetails: defenseResult,
    damageDetails: damageResult,
    counterAttack: counterAttack
  };
}

// 공격 배율 소모 (1회용) - 기존 호환성을 위해 유지
export function consumeAttackMultiplier(battle, playerId) {
  const effects = battle.effects || [];
  let mul = 1;
  
  for (const fx of effects) {
    if (!fx || fx.ownerId !== playerId || fx.charges <= 0) continue;
    if (fx.type === 'attackBoost') {
      mul *= fx.success ? (fx.factor || 1) : 1;
      fx.charges -= 1;
    }
  }
  
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
  return { mul };
}

// 방어 배율 소모 (피격시) - 기존 호환성을 위해 유지
export function consumeDefenseMultiplierOnHit(battle, playerId) {
  const effects = battle.effects || [];
  
  for (const fx of effects) {
    if (!fx || fx.ownerId !== playerId || fx.charges <= 0) continue;
    if (fx.type === 'defenseBoost') {
      fx.charges -= 1;
    }
  }
  
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
}

// 턴 순서 계산 함수들
export function calculateTurnOrder(players) {
  const teamA = players.filter(p => p.team === 'A' && p.hp > 0);
  const teamB = players.filter(p => p.team === 'B' && p.hp > 0);
  
  teamA.sort((a, b) => (b.stats?.agility || 0) - (a.stats?.agility || 0));
  teamB.sort((a, b) => (b.stats?.agility || 0) - (a.stats?.agility || 0));
  
  return { teamA, teamB };
}

export function determineFirstTeam(teamA, teamB) {
  const agilityA = teamA.reduce((sum, p) => sum + (p.stats?.agility || 0), 0);
  const agilityB = teamB.reduce((sum, p) => sum + (p.stats?.agility || 0), 0);
  
  return agilityA >= agilityB ? 'A' : 'B';
}

// 기존 호환성을 위한 구버전 함수들 (deprecated)
export function computeHit({ luk }) {
  const critResult = checkCriticalHit({ stats: { luck: luk } });
  return {
    hit: true, // 기본적으로 명중으로 가정
    crit: critResult.isCrit,
    hitScore: 10 + luk, // 호환성을 위한 가상값
    hitRoll: critResult.rollResult.final,
    rollDetails: critResult.rollResult
  };
}

export function computeDamage({ atk, def, crit, atkMul = 1, defMul = 1 }) {
  const attackPower = atk * atkMul;
  const defenseValue = def * defMul;
  const result = computeDamage(attackPower, crit, defenseValue);
  
  return {
    dmg: result.finalDamage,
    atkRoll: 10, // 호환성을 위한 가상값
    rollDetails: { final: 10, rerolled: false }
  };
}

export function computeAttackScore({ atk, atkMul = 1 }) {
  const result = computeFinalAttackPower({ stats: { attack: atk } }, atkMul > 1);
  return {
    score: result.finalPower,
    atkRoll: result.rollResult.final,
    rollDetails: result.rollResult
  };
}

export default {
  ITEMS,
  normalizeItemKey,
  computeFinalAttackPower,
  checkCriticalHit,
  checkEvasion,
  computeDefenseValue,
  computeDamage,
  computeCounterAttack,
  applyItemEffect,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  calculateTurnOrder,
  determineFirstTeam,
  // 호환성 함수들
  computeHit,
  computeAttackScore
};
