// packages/battle-server/src/combat.js
// PYXIS Combat Resolver (ESM)
// - 하나의 전투참여자 행동을 받아 서버 전투 상태를 갱신합니다.
// - 지원 액션: attack, defend, dodge, item, pass
// - 로그는 서버 상위(index.js)에서 pushLog로 합쳐 브로드캐스트합니다.
// - 이 파일은 순수 로직만 담당합니다(소켓 송신/권한 검사는 상위 계층).

import { rollWithReroll } from "./dice.js";
import {
  ITEMS,
  normalizeItemKey,
  applyItemEffect,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  computeHit,
  computeDamage,
  computeAttackScore
} from "./rules.js";

/** effects 보장 */
function ensureEffects(battle) {
  if (!Array.isArray(battle.effects)) battle.effects = [];
}

/** 유틸: 탐색 */
function findAny(battle, id) {
  return (battle.players || []).find(p => p && p.id === id) || null;
}

function findAlive(battle, id) {
  const p = findAny(battle, id);
  return p && p.hp > 0 ? p : null;
}

function opponentsOf(battle, actor) {
  return (battle.players || []).filter(p => p && p.team !== actor.team && p.hp > 0);
}

function findAliveOpponent(battle, actor) {
  return opponentsOf(battle, actor)[0] || null;
}

function getAlliesOf(battle, actor) {
  return (battle.players || []).filter(p => p && p.team === actor.team && p.hp > 0 && p.id !== actor.id);
}

/** HP 업데이트 병합 */
function mergeHpUpdates(dest, src) {
  Object.keys(src || {}).forEach(k => { dest[k] = src[k]; });
}

/** 방어 보정 효과 적용 */
function applyDefenseBoostFactor(battle, defender) {
  let mul = 1;
  const effects = battle.effects || [];
  
  for (const fx of effects) {
    if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
    if (fx.type === "defenseBoost") {
      mul *= fx.factor || 1;
      fx.charges -= 1; // 피격시 소모
    }
  }
  
  // 사용된 효과 제거
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
  return mul;
}

/** 회피 준비 효과 확인/소모 */
function hasDodgePrep(battle, defender) {
  for (const fx of battle.effects || []) {
    if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
    if (fx.type === "dodgePrep") return true;
  }
  return false;
}

function consumeDodge(battle, defender) {
  const effects = battle.effects || [];
  for (const fx of effects) {
    if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
    if (fx.type === "dodgePrep") { 
      fx.charges -= 1; 
      break;
    }
  }
  // 사용된 효과 제거
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
}

/**
 * 액션 해석기
 * @param {Object} battle - 서버 배틀 상태
 * @param {Object} action - { actorId, type, targetId?, itemType? }
 * @returns {Object} - { logs:[], updates:{hp:{}}, turnEnded:boolean }
 */
export function resolveAction(battle, action) {
  const { actorId, type, targetId, itemType } = action || {};
  const logs = [];
  const updates = { hp: {} };

  const actor = findAlive(battle, actorId);
  if (!actor) {
    logs.push({ type: "system", message: "행동 주체가 유효하지 않음" });
    return { logs, updates, turnEnded: false };
  }

  const kind = String(type || "").toLowerCase();

  // 1) 패스
  if (kind === "pass") {
    logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
    return { logs, updates, turnEnded: true };
  }

  // 2) 방어 - 다음 피격시 2배 방어력 (확정)
  if (kind === "defend") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "defenseBoost",
      factor: 2.0, // 2배 방어력
      charges: 1,
      success: true,
      source: "action:defend",
      appliedAt: Date.now()
    });
    logs.push({ type: "system", message: `${actor.name} 방어 태세 (다음 피격시 2배 방어력)` });
    return { logs, updates, turnEnded: true };
  }

  // 3) 회피 - 다음 피격시 +5 회피 보너스 (확정)
  if (kind === "dodge") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "dodgePrep",
      bonus: 5, // 회피 보너스
      charges: 1,
      success: true,
      source: "action:dodge",
      appliedAt: Date.now()
    });
    logs.push({ type: "system", message: `${actor.name} 회피 준비 (다음 피격시 +5 회피 보너스)` });
    return { logs, updates, turnEnded: true };
  }

  // 4) 아이템 - 즉시 적용 시스템
  if (kind === "item") {
    const key = normalizeItemKey(itemType);
    if (!key) {
      logs.push({ type: "system", message: "알 수 없는 아이템" });
      return { logs, updates, turnEnded: true };
    }

    // 아이템 보유 확인
    if (!actor.items || !actor.items[key] || actor.items[key] <= 0) {
      logs.push({ type: "system", message: `${ITEMS[key]?.name || '아이템'}이 부족합니다` });
      return { logs, updates, turnEnded: true };
    }

    if (key === "dittany") {
      // 디터니: 대상 지정 가능한 회복 아이템 (100% 성공률)
      let target = actor; // 기본값: 자신
      if (targetId) {
        const candidate = findAny(battle, targetId);
        if (candidate && candidate.team === actor.team && candidate.hp > 0) {
          target = candidate;
        }
      }

      if (target.hp <= 0) {
        logs.push({ type: "system", message: "사망자에게는 회복 불가" });
        return { logs, updates, turnEnded: true };
      }

      const result = applyItemEffect(battle, actor.id, key, target.id);
      if (result.success) {
        updates.hp[target.id] = target.hp;
        logs.push({ 
          type: "item", 
          message: result.message
        });
      } else {
        logs.push({ 
          type: "item", 
          message: result.message
        });
      }
      return { logs, updates, turnEnded: true };
      
    } else if (key === "attack_boost") {
      // 공격 보정기: 10% 확률로 즉시 2배 데미지 공격 실행
      if (!targetId) {
        logs.push({ type: "system", message: "공격 보정기는 적 대상이 필요합니다" });
        return { logs, updates, turnEnded: true };
      }
      
      const target = findAny(battle, targetId);
      if (!target || target.team === actor.team || target.hp <= 0) {
        // 아이템 소모 (실패해도 소모)
        actor.items.attack_boost -= 1;
        logs.push({ type: "system", message: "올바른 적 대상을 선택하세요 (공격 보정기 소모됨)" });
        return { logs, updates, turnEnded: true };
      }

      const result = applyItemEffect(battle, actor.id, key, targetId);
      if (result.success && result.attack) {
        // 성공: 즉시 2배 데미지 공격 실행
        if (result.attack.success) {
          updates.hp[targetId] = target.hp;
        }
        logs.push({ 
          type: "item", 
          message: result.message,
          rollDetails: result.rollDetails
        });
        
        // 공격 세부 정보 로그
        if (result.attack.success) {
          logs.push({
            type: "battle",
            message: `보정된 공격 세부사항: 명중 ${result.attack.hitDetails?.hitRoll || 0}/20${result.attack.crit ? ' (치명타!)' : ''}, 데미지 ${result.attack.damageDetails?.atkRoll || 0}/20`,
            data: result.attack
          });
        }
      } else {
        // 실패: 아이템만 소모됨
        logs.push({ 
          type: "item", 
          message: result.message,
          rollDetails: result.rollDetails
        });
      }
      return { logs, updates, turnEnded: true };
      
    } else if (key === "defense_boost") {
      // 방어 보정기: 10% 확률로 다음 피격시 2배 방어력
      const result = applyItemEffect(battle, actor.id, key);
      logs.push({ 
        type: "item", 
        message: result.message,
        rollDetails: result.rollDetails
      });
      return { logs, updates, turnEnded: true };
    }

    // 지원되지 않는 아이템
    logs.push({ type: "system", message: "지원되지 않는 아이템" });
    return { logs, updates, turnEnded: true };
  }

  // 5) 공격
  if (kind === "attack") {
    // 대상 결정
    let target = null;
    if (targetId) {
      const candidate = findAny(battle, targetId);
      target = (candidate && candidate.hp > 0 && candidate.team !== actor.team) ? candidate : null;
    }
    if (!target) {
      target = findAliveOpponent(battle, actor);
    }

    if (!target) {
      logs.push({ type: "system", message: "공격 대상이 없음" });
      return { logs, updates, turnEnded: true };
    }

    // 공격 수치 계산 (재굴림 적용)
    const attackResult = computeAttackScore({ 
      atk: actor.stats?.attack || 0, 
      atkMul: 1 
    });
    const attackScore = attackResult.score;

    // 회피 체크 (재굴림 적용)
    const evadeResult = rollWithReroll(20);
    const evadeRoll = evadeResult.final;
    
    // 회피 준비 보너스 적용
    let evasionBonus = 0;
    if (hasDodgePrep(battle, target)) {
      evasionBonus = 5; // 회피 액션 보너스
      consumeDodge(battle, target);
    }

    const targetAgility = target.stats?.agility || 0;
    const totalEvasion = targetAgility + evadeRoll + evasionBonus;

    // 회피 성공 체크
    if (totalEvasion >= attackScore) {
      logs.push({ 
        type: "battle", 
        message: evasionBonus > 0 
          ? `${target.name}이(가) 준비된 회피로 ${actor.name}의 공격을 피함 (민첩성 ${targetAgility} + 주사위 ${evadeRoll} + 보너스 ${evasionBonus} = ${totalEvasion} vs ${attackScore})`
          : `${target.name}이(가) ${actor.name}의 공격을 회피 (민첩성 ${targetAgility} + 주사위 ${evadeRoll} = ${totalEvasion} vs ${attackScore})`,
        data: { 
          evadeRoll: evadeResult, 
          attackScore, 
          evasionBonus,
          totalEvasion,
          rerolled: evadeResult.rerolled
        }
      });
      return { logs, updates, turnEnded: true };
    }

    // 명중 판정 (재굴림 적용)
    const hitResult = computeHit({ 
      luk: actor.stats?.luck || 0
    });

    if (!hitResult.hit) {
      logs.push({ 
        type: "battle", 
        message: `${actor.name}의 공격이 빗나감 (행운 ${actor.stats?.luck || 0} + 주사위 ${hitResult.hitRoll} = ${hitResult.hitScore})`,
        data: { 
          ...hitResult,
          rerolled: hitResult.rollDetails?.rerolled || false
        }
      });
      return { logs, updates, turnEnded: true };
    }

    // 방어 배율 계산 (방어 태세/방어 보정기)
    const defenseMultiplier = applyDefenseBoostFactor(battle, target);

    // 피해 계산 (재굴림 적용)
    const damageResult = computeDamage({
      atk: actor.stats?.attack || 0,
      def: target.stats?.defense || 0,
      crit: hitResult.crit,
      atkMul: 1,
      defMul: defenseMultiplier
    });

    // 체력 업데이트
    const oldHp = target.hp;
    const newHp = Math.max(0, oldHp - damageResult.dmg);
    updates.hp[target.id] = newHp;

    // 로그 생성
    const baseMessage = hitResult.crit
      ? `${actor.name}의 치명타 적중!`
      : `${actor.name}이(가) ${target.name}을(를) 공격`;
    
    const defenseInfo = defenseMultiplier > 1 
      ? ` (${defenseMultiplier}배 방어력 적용)`
      : '';
    
    logs.push({
      type: "battle",
      message: `${baseMessage} - ${target.name}에게 ${damageResult.dmg} 피해${defenseInfo}`,
      data: {
        attacker: actor.name,
        target: target.name,
        damage: damageResult.dmg,
        crit: hitResult.crit,
        hitRoll: hitResult.rollDetails,
        damageRoll: damageResult.rollDetails,
        defenseMultiplier,
        oldHp,
        newHp,
        hitRerolled: hitResult.rollDetails?.rerolled || false,
        damageRerolled: damageResult.rollDetails?.rerolled || false
      }
    });

    // 상세 정보 로그
    logs.push({
      type: "system",
      message: `공격 세부사항: 명중 ${hitResult.hitRoll}/20${hitResult.crit ? ' (치명타!)' : ''}, 데미지 ${damageResult.atkRoll}/20${hitResult.rollDetails?.rerolled || damageResult.rollDetails?.rerolled ? ' (재굴림 발생)' : ''}`,
      data: {
        hitDetails: hitResult,
        damageDetails: damageResult
      }
    });

    // 1회성 효과 소모
    consumeAttackMultiplier(battle, actor);
    consumeDefenseMultiplierOnHit(battle, target);

    return { logs, updates, turnEnded: true };
  }

  // 알 수 없는 액션
  logs.push({ type: "system", message: "알 수 없는 행동" });
  return { logs, updates, turnEnded: false };
}

export default { resolveAction };
