// packages/battle-server/src/dice.js - 주사위 롤링 유틸리티
export function roll(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollMultiple(count, sides = 20) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(roll(sides));
  }
  return results;
}

export default { roll, rollMultiple };

// ================================================================================================

// packages/battle-server/src/rules.js - 게임 규칙 및 계산 로직
import { roll } from './dice.js';

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
    type: 'buff',
    multiplier: 1.5,
    success: 10 // 10% 성공률
  },
  defense_boost: {
    key: 'defense_boost',
    name: '방어 보정기', 
    type: 'buff',
    multiplier: 1.5,
    success: 10 // 10% 성공률
  }
};

export function normalizeItemKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z_]/g, '');
  return Object.keys(ITEMS).includes(normalized) ? normalized : null;
}

// 명중 계산
export function computeHit({ luk, hitRoll }) {
  const hitScore = luk + hitRoll;
  const hit = hitScore >= 10; // 기본 명중 기준
  
  // 치명타 계산: 주사위(1-20) >= (20 - 행운/2)
  const critThreshold = 20 - Math.floor(luk / 2);
  const crit = hit && hitRoll >= critThreshold;
  
  return { hit, crit, hitScore };
}

// 데미지 계산
export function computeDamage({ atk, def, atkRoll, crit, atkMul = 1, defMul = 1 }) {
  let baseDmg = Math.max(1, (atk * atkMul) + atkRoll - (def * defMul));
  
  // 치명타시 2배 데미지
  if (crit) {
    baseDmg *= 2;
  }
  
  return { dmg: Math.floor(baseDmg) };
}

// 공격력 점수 계산
export function computeAttackScore({ atk, atkRoll, atkMul = 1 }) {
  return Math.floor((atk * atkMul) + atkRoll);
}

// 공격 배율 소모 (1회용
  switch (item.type) {
    case 'heal':
      // 디터니 - 고정 10 회복
      target.hp = Math.min(target.maxHp || 100, target.hp + item.effect);
      return {
        success: true,
        message: `${target.name}이(가) ${item.effect} 체력을 회복했습니다`,
        consumed: true
      };
      
    case 'buff':
      // 공격/방어 보정기
      if (!battle.effects) battle.effects = [];
      
      const effectType = itemKey === 'attack_boost' ? 'attackBoost' : 'defenseBoost';
      
      battle.effects.push({
        ownerId: playerId,
        type: effectType,
        factor: item.multiplier, // 2배 배율
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

// 턴 순서 계산 함수들
export function calculateTurnOrder(players) {
  // 팀별로 분리
  const teamA = players.filter(p => p.team === 'A' && p.hp > 0);
  const teamB = players.filter(p => p.team === 'B' && p.hp > 0);
  
  // 팀 내에서 민첩성 순으로 정렬
  teamA.sort((a, b) => (b.stats?.agility || 0) - (a.stats?.agility || 0));
  teamB.sort((a, b) => (b.stats?.agility || 0) - (a.stats?.agility || 0));
  
  return { teamA, teamB };
}

export function determineFirstTeam(teamA, teamB) {
  const agilityA = teamA.reduce((sum, p) => sum + (p.stats?.agility || 0), 0);
  const agilityB = teamB.reduce((sum, p) => sum + (p.stats?.agility || 0), 0);
  
  return agilityA >= agilityB ? 'A' : 'B';
}

export default {
  ITEMS,
  normalizeItemKey,
  computeHit,
  computeDamage,
  computeAttackScore,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect,
  calculateTurnOrder,
  determineFirstTeam
};)
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
  
  // 사용된 효과 제거
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
  return { mul };
}

// 방어 배율 소모 (피격시)
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

// 아이템 효과 적용
export function applyItemEffect(battle, playerId, itemKey, targetId = null) {
  const item = ITEMS[itemKey];
  if (!item) return { success: false, message: '알 수 없는 아이템' };
  
  const player = battle.players?.find(p => p.id === playerId);
  if (!player) return { success: false, message: '플레이어를 찾을 수 없음' };
  
  // 아이템 보유 체크
  if (!player.items[itemKey] || player.items[itemKey] <= 0) {
    return { success: false, message: '아이템이 부족합니다' };
  }
  
  // 성공률 체크
  const successRoll = roll(100);
  const itemSuccess = successRoll <= item.success;
  
  // 아이템 소모 (실패해도 소모)
  player.items[itemKey] -= 1;
  
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
  
  // 아이템 효과 적
