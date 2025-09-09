// PYXIS Combat Resolver (ESM)
// - 하나의 행동을 받아 서버 상태를 갱신(HP/사망/효과 소모/턴 종료 판단)
// - 로그는 한국어로 상세 기록

import { roll } from "./dice.js";
import {
  ITEMS,
  normalizeItemKey,
  computeHit,
  computeDamage,
  computeAttackScore,
  EVASION_CHECK,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect,            // ← 직접 import
} from "./rules.js";

// ... (기존 유틸/보조 함수 유지)

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

  if (kind === "pass") {
    logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
    return { logs, updates, turnEnded: true };
  }

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

  if (kind === "item") {
    const target = action.targetId ? findAny(battle, action.targetId) : actor;
    const { logs: itemLogs, updates: itemUpdates } =
      applyItem(battle, { actor, target, itemType: action.itemType });
    itemLogs.forEach(l => logs.push(l));
    mergeHpUpdates(updates.hp, itemUpdates.hp);
    return { logs, updates, turnEnded: true };
  }

  if (kind === "attack") {
    const target = findAliveOpponent(battle, actor);
    if (!target) {
      logs.push({ type: "system", message: "공격 대상이 없음" });
      return { logs, updates, turnEnded: false };
    }
    // ... (기존 공격/치명/피해 산식 동일)
  }

  return { logs, updates, turnEnded: false };
}

function applyItem(battle, { actor, target, itemType }) {
  const key = normalizeItemKey(itemType);
  if (!target) {
    return { logs: [{ type: "system", message: "대상이 유효하지 않음" }], updates: { hp: {} } };
  }
  if (key === "dittany" && target.hp <= 0) {
    return { logs: [{ type: "system", message: "사망자에게는 회복 불가" }], updates: { hp: {} } };
  }
  // ESM 직접 import 사용
  return applyItemEffect(battle, { actor, target, itemType: key });
}

// 이하 보조 유틸들 동일 (mergeHpUpdates, ensureEffects, findAlive, findAny, findAliveOpponent 등)
function mergeHpUpdates(dest, src) {
  Object.keys(src || {}).forEach((k) => {
    dest[k] = src[k];
  });
}
