// PYXIS Combat Resolver (ESM)
// - 하나의 플레이어 행동을 받아 서버 전투 상태를 갱신합니다.
// - 지원 액션: attack, defend, dodge, item, pass
// - 로그는 서버 상위(index.js)에서 pushLog로 합쳐 브로드캐스트합니다.
// - 이 파일은 순수 로직만 담당합니다(소켓 송신/권한 검사는 상위 계층).

import { roll } from "./dice.js";
import {
  ITEMS,
  normalizeItemKey,
  applyItemEffect,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  computeAttackScoreFromActor,
  computeHitFromActors,
  computeDamageFromActors
} from "./rules.js";

/** effects 보장 */
function ensureEffects(battle) {
  if (!Array.isArray(battle.effects)) battle.effects = [];
}

/** 유틸: 탐색 */
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

/** HP 업데이트 병합 */
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

  // 2) 방어
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

  // 3) 회피
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

  // 4) 아이템
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

    const { logs: l2, updates: up } = applyItemEffect(battle, { actor, target, itemType: key });
    (l2 || []).forEach(x => logs.push(x));
    mergeHpUpdates(updates.hp, up?.hp || {});
    return { logs, updates, turnEnded: true };
  }

  // 5) 공격
  if (kind === "attack") {
    const target =
      action.targetId
        ? (() => {
            const cand = findAny(battle, action.targetId);
            return (cand && cand.hp > 0 && cand.team !== actor.team) ? cand : null;
          })()
        : findAliveOpponent(battle, actor);

    if (!target) {
      logs.push({ type: "system", message: "공격 대상이 없음" });
      return { logs, updates, turnEnded: false };
    }

    // 회피 판정용 기본 공격수치 (atkMul 미적용)
    const { score: baseAtkScore, atk, atkRoll } = computeAttackScoreFromActor(attackerFrom(actor));

    // 회피 보너스(+4) 소비 여부
    let evasionBonus = 0;
    const hadDodge = hasDodgePrep(battle, target);
    if (hadDodge) evasionBonus = 4;

    // 히트/치명 + (선택)회피 판정
    const { hit, crit } = computeHitFromActors({
      attacker: attackerFrom(actor),
      defender: defenderFrom(target),
      evasionBonus,
      attackScore: baseAtkScore
    });

    if (!hit) {
      // 회피 버프는 판정시 사용되며, 사용했다면 charges 소모
      if (hadDodge) consumeDodge(battle, target);
      logs.push({ type: "battle", message: `${actor.name}의 공격이 빗나감` });
      return { logs, updates, turnEnded: true };
    }

    // 여기서 dodge 소모 (명중 시에만 소모하도록 바꾸려면 위에서 소모를 빼고 여기서 조건부 소모)
    if (hadDodge) consumeDodge(battle, target);

    // 배율 계산(히트 후에만 소모)
    const { mul: atkMul } = consumeAttackMultiplier(battle, actor.id);
    const { mul: defMul } = consumeDefenseMultiplierOnHit(battle, target.id);

    // 피해 계산
    const { dmg } = computeDamageFromActors({
      attacker: attackerFrom(actor),
      defender: defenderFrom(target),
      atk,        // 위에서 사용한 동일한 atk 값
      atkRoll,    // 위에서 사용한 동일한 d20
      crit,
      atkMul,
      defMul
    });

    updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);

    logs.push({
      type: "battle",
      message: crit
        ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해`
        : `${actor.name}가 ${target.name}에게 ${dmg} 피해`
    });

    return { logs, updates, turnEnded: true };
  }

  // 알 수 없는 액션
  logs.push({ type: "system", message: "알 수 없는 행동" });
  return { logs, updates, turnEnded: false };
}

/* ─────────────────────────────────────────────
 * 내부 보조 (actor/defender shape 정규화)
 * ────────────────────────────────────────────*/
function attackerFrom(a) {
  return a;
}
function defenderFrom(d) {
  return d;
}

/* ─────────────────────────────────────────────
 * 회피 준비/소모 (combat 전용 보조)
 * ────────────────────────────────────────────*/
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
