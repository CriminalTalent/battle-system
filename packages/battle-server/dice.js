// packages/battle-server/src/rules.js - PYXIS 전투 규칙
import { roll } from './dice.js';

// ==============================
// 아이템 정의
// ==============================
export const ITEMS = {
  dittany: {
    key: 'dittany',
    name: '디터니',
    type: 'heal',
    effect: 10,
    success: 100 // 100% 확정 성공
  },
  attack_boost: {
    key: 'attack_boost',
    name: '공격 보정기',
    type: 'buff',
    multiplier: 2.0,
    success: 10 // 10% 확률
  },
  defense_boost: {
    key: 'defense_boost',
    name: '방어 보정기',
    type: 'buff',
    multiplier: 2.0,
    success: 10 // 10% 확률
  }
};

// ==============================
// 유틸 함수
// ==============================
export function normalizeItemKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z_]/g, '');
  return Object.keys(ITEMS).includes(normalized) ? normalized : null;
}

// ==============================
// 전투 계산 함수
// ==============================

// 공격력 계산: 공격 + D20
export function computeAttackPower(actor, multiplier = 1) {
  const atkRoll = roll(20);
  const attackPower = Math.floor((actor.stats?.attack || 0) * multiplier + atkRoll);
  return {
    attackPower,
    atkRoll,
    breakdown: `${actor.stats?.attack || 0} + D20(${atkRoll})`
  };
}

// 회피 판정: 민첩 + D20 ≥ 공격수치
export function checkEvasion(target, attackPower) {
  const evaRoll = roll(20);
  const evaScore = (target.stats?.agility || 0) + evaRoll;
  const evaded = evaScore >= attackPower;
  return {
    evaded,
    breakdown: `${target.stats?.agility || 0} + D20(${evaRoll}) = ${evaScore} vs 공격 ${attackPower}`
  };
}

// 치명타 판정: D20 ≥ (20 - 행운/2)
export function checkCriticalHit(actor) {
  const critRoll = roll(20);
  const threshold = 20 - Math.floor((actor.stats?.luck || 0) / 2);
  const isCrit = critRoll >= threshold;
  return {
    isCrit,
    breakdown: `D20(${critRoll}) ≥ ${threshold} → ${isCrit ? '성공' : '실패'}`
  };
}

// 방어값 계산 (방어력 [+D20], 보정기 적용 여부)
export function computeDefenseValue(target, boosted = false) {
  const defRoll = roll(20);
  const factor = boosted ? 2.0 : 1.0;
  const defenseValue = Math.floor((target.stats?.defense || 0) * factor + defRoll);
  return {
    defenseValue,
    breakdown: `${target.stats?.defense || 0} × ${factor} + D20(${defRoll})`
  };
}

// 최종 피해 계산
export function computeFinalDamage(attackPower, defenseValue, isCrit) {
  let dmg = Math.max(0, attackPower - defenseValue);
  if (isCrit) dmg *= 2;
  return {
    finalDamage: Math.max(0, dmg),
    breakdown: `${attackPower} - ${defenseValue}${isCrit ? ' (치명타 2배)' : ''} = ${Math.max(0, dmg)}`
  };
}

// ==============================
// 버프/아이템 효과
// ==============================
export function consumeAttackMultiplier(battle, playerId) {
  const effects = battle.effects || [];
  let mul = 1;
  for (const fx of effects) {
    if (fx && fx.ownerId === playerId && fx.type === 'attackBoost' && fx.charges > 0) {
      mul *= fx.factor || 1;
      fx.charges -= 1;
    }
  }
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
  return { mul };
}

export function consumeDefenseMultiplierOnHit(battle, playerId) {
  const effects = battle.effects || [];
  for (const fx of effects) {
    if (fx && fx.ownerId === playerId && fx.type === 'defenseBoost' && fx.charges > 0) {
      fx.charges -= 1;
    }
  }
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
}

// 아이템 효과 적용
export function applyItemEffect(battle, playerId, itemKey, targetId = null) {
  const item = ITEMS[itemKey];
  if (!item) return { success: false, message: '알 수 없는 아이템' };

  const player = battle.players?.find(p => p.id === playerId);
  if (!player) return { success: false, message: '플레이어를 찾을 수 없음' };

  if (!player.items[itemKey] || player.items[itemKey] <= 0) {
    return { success: false, message: '아이템이 부족합니다' };
  }

  const successRoll = roll(100);
  const itemSuccess = successRoll <= item.success;

  player.items[itemKey] -= 1; // 실패해도 소모

  if (!itemSuccess) {
    return {
      success: false,
      message: `${item.name} 사용 실패 (${successRoll}/${item.success})`,
      consumed: true
    };
  }

  let target = player;
  if (targetId) {
    target = battle.players?.find(p => p.id === targetId);
    if (!target) {
      return { success: false, message: '대상을 찾을 수 없음', consumed: true };
    }
  }

  switch (item.type) {
    case 'heal':
      target.hp = Math.min(target.maxHp || 100, target.hp + item.effect);
      return {
        success: true,
        message: `${target.name}이(가) ${item.effect} 체력을 회복했습니다`,
        consumed: true
      };

    case 'buff':
      if (!battle.effects) battle.effects = [];
      const effectType = itemKey === 'attack_boost' ? 'attackBoost' : 'defenseBoost';
      battle.effects.push({
        ownerId: playerId,
        type: effectType,
        factor: item.multiplier,
        charges: 1,
        success: true,
        source: `item:${itemKey}`
      });
      return {
        success: true,
        message: `${item.name} 사용 성공! 다음 행동에 ${item.multiplier}배 효과 적용`,
        consumed: true
      };

    default:
      return { success: false, message: '알 수 없는 아이템 타입', consumed: true };
  }
}

// ==============================
// 선공 결정
// ==============================
export function determineFirstTeam(teamA, teamB) {
  const agilityA = teamA.reduce((sum, p) => sum + (p.stats?.agility || 0), 0) + roll(20);
  const agilityB = teamB.reduce((sum, p) => sum + (p.stats?.agility || 0), 0) + roll(20);
  return agilityA >= agilityB ? 'A' : 'B';
}

// ==============================
// 모듈 export
// ==============================
export default {
  ITEMS,
  normalizeItemKey,
  computeAttackPower,
  checkEvasion,
  checkCriticalHit,
  computeDefenseValue,
  computeFinalDamage,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect,
  determineFirstTeam
};
