// packages/battle-server/src/combat.js
// PYXIS Combat Resolver (ESM) - 7학년 모의 전투 규칙 적용
// - 하나의 전투참가자 행동을 받아 서버 전투 상태를 갱신
// - 지원 액션: attack, defend, dodge, item, pass
// - 새로운 규칙: 보정기 2배, 역공격 없음, 팀 단위 턴제

import { 
  computeAttackPower,
  checkCriticalHit,
  checkEvasion,
  computeDefenseValue,
  computeFinalDamage,
  ITEMS,
  normalizeItemKey,
  applyItemEffect
} from "./rules.js";

/* =========================
 * 유틸리티 함수들
 * ========================= */

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

/** 방어 보정 효과 확인 */
function hasDefenseBoost(battle, playerId) {
  const effects = battle.effects || [];
  for (const fx of effects) {
    if (fx && fx.ownerId === playerId && fx.type === 'defenseBoost' && fx.charges > 0) {
      return true;
    }
  }
  return false;
}

/** 방어 보정 효과 소모 */
function consumeDefenseBoost(battle, playerId) {
  const effects = battle.effects || [];
  for (const fx of effects) {
    if (fx && fx.ownerId === playerId && fx.type === 'defenseBoost' && fx.charges > 0) {
      fx.charges -= 1;
      break;
    }
  }
  battle.effects = effects.filter(e => (e?.charges || 0) > 0);
}

/* =========================
 * 액션 해석기
 * ========================= */
/**
 * 액션 해석기 - 새로운 7학년 모의 전투 규칙 적용
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

  // 2) 방어 - 다음 피격시 2배 방어력 (확률 없음)
  if (kind === "defend") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "defenseBoost",
      factor: 2.0,
      charges: 1,
      success: true,
      source: "action:defend",
      appliedAt: Date.now()
    });
    logs.push({ 
      type: "system", 
      message: `${actor.name} 방어 태세 (다음 피격시 2배 방어력)` 
    });
    return { logs, updates, turnEnded: true };
  }

  // 3) 회피 - 다음 회피 판정에 사용할 보너스 없음 (기본 민첩성으로만 판정)
  if (kind === "dodge") {
    logs.push({ 
      type: "system", 
      message: `${actor.name} 회피 자세 (다음 공격을 민첩성으로 회피 시도)` 
    });
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
        logs.push({ type: "item", message: result.message });
      } else {
        logs.push({ type: "item", message: result.message });
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
            message: `보정 공격 상세: ${result.attack.attackDetails?.breakdown || ''}, 피해: ${result.attack.damageDetails?.breakdown || ''}`,
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

  // 5) 공격 - 새로운 규칙 적용
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

    // 1단계: 공격력 계산
    const attackResult = computeAttackPower(actor, false); // 기본 공격 (보정기 없음)
    
    // 2단계: 회피 체크
    const evasionResult = checkEvasion(target, attackResult.attackPower);
    if (evasionResult.evaded) {
      logs.push({ 
        type: "battle", 
        message: `${target.name}이(가) ${actor.name}의 공격을 회피! (${evasionResult.breakdown})`,
        data: { 
          evasionDetails: evasionResult,
          attackDetails: attackResult
        }
      });
      return { logs, updates, turnEnded: true };
    }

    // 3단계: 치명타 체크
    const critResult = checkCriticalHit(actor);

    // 4단계: 방어값 계산 (방어 보정기 효과 확인)
    const defenseBoostActive = hasDefenseBoost(battle, target.id);
    const defenseResult = computeDefenseValue(target, defenseBoostActive);
    
    // 방어 보정기 소모
    if (defenseBoostActive) {
      consumeDefenseBoost(battle, target.id);
    }

    // 5단계: 최종 피해 계산
    const damageResult = computeFinalDamage(
      attackResult.attackPower, 
      defenseResult.defenseValue, 
      critResult.isCrit
    );

    // 6단계: 체력 업데이트
    const oldHp = target.hp;
    const newHp = Math.max(0, oldHp - damageResult.finalDamage);
    updates.hp[target.id] = newHp;

    // 7단계: 로그 생성
    const defenseInfo = defenseBoostActive ? ` (2배 방어력 적용)` : '';
    const baseMessage = critResult.isCrit
      ? `${actor.name}의 치명타!`
      : `${actor.name}이(가) ${target.name}을(를) 공격`;
    
    logs.push({
      type: "battle",
      message: `${baseMessage} - ${target.name}에게 ${damageResult.finalDamage} 피해${defenseInfo}`,
      data: {
        attacker: actor.name,
        target: target.name,
        damage: damageResult.finalDamage,
        crit: critResult.isCrit,
        oldHp,
        newHp,
        defenseBoost: defenseBoostActive
      }
    });

    // 상세 정보 로그
    logs.push({
      type: "system",
      message: `공격 상세: ${attackResult.breakdown}, 회피 시도: ${evasionResult.breakdown}, 치명타: ${critResult.breakdown}, 방어: ${defenseResult.breakdown}, 피해: ${damageResult.breakdown}`,
      data: {
        attackDetails: attackResult,
        evasionDetails: evasionResult,
        critDetails: critResult,
        defenseDetails: defenseResult,
        damageDetails: damageResult
      }
    });

    return { logs, updates, turnEnded: true };
  }

  // 알 수 없는 액션
  logs.push({ type: "system", message: "알 수 없는 행동" });
  return { logs, updates, turnEnded: false };
}

/* =========================
 * 기본 export
 * ========================= */
export default { resolveAction };
