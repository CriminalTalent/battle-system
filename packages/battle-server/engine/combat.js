// PYXIS Combat Resolver (ESM)
// - 하나의 플레이어 행동을 받아 서버 전투 상태를 갱신합니다.
// - 지원 액션: attack, defend, dodge, item, pass
// - 로그는 서버 상위(index.js)에서 pushLog로 합쳐 브로드캐스트합니다.
// - 이 파일은 순수 로직만 담당합니다(소켓 송신/권한 검사는 상위 계층).

import { roll } from "./dice.js";
import {
  ITEMS,
  normalizeItemKey,
  computeHit,
  computeDamage,
  computeAttackScore,
  EVASION_CHECK, // 필요 시 회피 산식에 반영할 수 있도록 남겨둠
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect
} from "./rules.js";

/**
 * 전투 효과 보조
 */
function ensureEffects(battle) {
  if (!battle.effects) battle.effects = [];
}
function applyDefenseBoostFactor(battle, defender) {
  // defend 액션 혹은 defense_booster 성공 시 1회성 방어 배율을 누적 적용
  let mul = 1;
  for (const fx of battle.effects || []) {
    if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
    if (fx.type === "defenseBoost") {
      mul *= fx.factor || 1;
      // 방어 배율은 피격 1회 후 자동 소모되도록 여기서 charges 차감
      fx.charges -= 1;
    }
  }
  return mul;
}
function hasDodgePrep(battle, defender) {
  for (const fx of battle.effects || []) {
    if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
    if (fx.type === "dodgePrep") return true;
  }
  return false;
}
function consumeDodge(battle, defender) {
  for (const fx of battle.effects || []) {
    if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
    if (fx.type === "dodgePrep") { fx.charges -= 1; return; }
  }
}

/**
 * 유틸: 탐색
 */
function findAny(battle, id) {
  return (battle.players || []).find(p => p.id === id) || null;
}
function findAlive(battle, id) {
  const p = findAny(battle, id);
  return p && p.hp > 0 ? p : null;
}
function opponentsOf(battle, actor) {
  return (battle.players || []).filter(p => p.team !== actor.team && p.hp > 0);
}
function findAliveOpponent(battle, actor) {
  return opponentsOf(battle, actor)[0] || null;
}

/**
 * HP 업데이트 병합
 */
function mergeHpUpdates(dest, src) {
  Object.keys(src || {}).forEach(k => { dest[k] = src[k]; });
}

/**
 * 액션 해석기
 * @param {Object} battle - 서버 배틀 상태
 * @param {Object} action - { actorId, type, ... }
 * @returns {Object} - { logs:[], updates:{hp:{}}, turnEnded:boolean }
 */
export function resolveAction(battle, action) {
  const { actorId, type } = action || {};
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

  // 2) 방어: 다음 피격 1회 방어 배율 +25% (확정)
  if (kind === "defend") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "defenseBoost",
      factor: 1.25,
      charges: 1,
      success: true,
      source: "action:defend"
    });
    logs.push({ type: "system", message: `${actor.name} 방어 태세` });
    return { logs, updates, turnEnded: true };
  }

  // 3) 회피: 다음 피격 1회 회피 판정 +4
  if (kind === "dodge") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "dodgePrep",
      add: 4,
      charges: 1,
      success: true,
      source: "action:dodge"
    });
    logs.push({ type: "system", message: `${actor.name} 회피 준비` });
    return { logs, updates, turnEnded: true };
  }

  // 4) 아이템: attack_booster / defense_booster / dittany
  if (kind === "item") {
    const key = normalizeItemKey(action.itemType);
    const target = action.targetId ? findAny(battle, action.targetId) : actor;

    if (!target) {
      logs.push({ type: "system", message: "대상이 유효하지 않음" });
      return { logs, updates, turnEnded: true };
    }
    if (key === "dittany" && target.hp <= 0) {
      logs.push({ type: "system", message: "사망자에게는 회복 불가" });
      return { logs, updates, turnEnded: true };
    }

    // ESM: rules.applyItemEffect 직접 호출
    const { logs: l2, updates: up } = applyItemEffect(battle, { actor, target, itemType: key });
    (l2 || []).forEach(x => logs.push(x));
    mergeHpUpdates(updates.hp, up?.hp || {});

    return { logs, updates, turnEnded: true };
  }

  // 5) 공격
  if (kind === "attack") {
    const target = findAliveOpponent(battle, actor);
    if (!target) {
      logs.push({ type: "system", message: "공격 대상이 없음" });
      return { logs, updates, turnEnded: false };
    }

    // 공격 수치 산출(공격력+주사위-상대방어력의 기반 값 등 rules에 위임)
    const attackScore = computeAttackScore(actor, battle);

    // 회피 준비 보너스(+4) 1회성
    let evasionBonus = 0;
    if (hasDodgePrep(battle, target)) {
      evasionBonus = 4;
      consumeDodge(battle, target);
    }

    // 명중(행운+주사위 기반, rules에 위임)
    const isHit = computeHit({ attacker: actor, defender: target, evasionBonus });
    if (!isHit) {
      logs.push({ type: "battle", message: `${actor.name}의 공격이 빗나감` });
      return { logs, updates, turnEnded: true };
    }

    // 방어 배율(방어 태세/방어 보정기 성공 시)
    const defenseMultiplier = applyDefenseBoostFactor(battle, target);

    // 피해 계산(치명 포함), 하한 0, 치명 시 2배는 rules에서 처리
    const { dmg, crit } = computeDamage({
      attacker: actor,
      defender: target,
      attackScore,
      defenseMultiplier
    });

    updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);

    logs.push({
      type: "battle",
      message: crit
        ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해`
        : `${actor.name}가 ${target.name}에게 ${dmg} 피해`
    });

    // 1회성 배율/효과 소모
    consumeAttackMultiplier(battle, actor);
    consumeDefenseMultiplierOnHit(battle, target);

    return { logs, updates, turnEnded: true };
  }

  // 알 수 없는 액션
  logs.push({ type: "system", message: "알 수 없는 행동" });
  return { logs, updates, turnEnded: false };
}
