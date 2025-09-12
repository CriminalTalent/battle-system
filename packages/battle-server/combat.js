// packages/battle-server/src/combat.js
// PYXIS Combat Resolver (ESM) - 7학년 모의 전투 규칙 적용
// - 지원 액션: attack, defend, item, pass (dodge는 안내 로그만; 회피는 공격 시 자동 판정)
// - 규칙: 보정기 2배, 역공격 없음, 팀 단위 턴제(턴 진행은 외부 엔진이 담당)

"use strict";

import { roll } from "./dice.js";
import {
  computeAttackScore,
  computeDamage,
  applyItemEffect,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  normalizeItemKey,
} from "./rules.js";

/* ─────────────────────────────────────────────
 * 내부 유틸
 * ───────────────────────────────────────────── */
function findAny(battle, id) {
  return (battle.players || []).find((p) => p && p.id === id) || null;
}
function findAlive(battle, id) {
  const p = findAny(battle, id);
  return p && (p.hp || 0) > 0 ? p : null;
}
function opponentsOf(battle, actor) {
  return (battle.players || []).filter((p) => p && p.team !== actor.team && (p.hp || 0) > 0);
}
function findAliveOpponent(battle, actor) {
  return opponentsOf(battle, actor)[0] || null;
}

/* 방어 2배 효과 조회(1회성) */
function pollDefenseBoostFactor(battle, targetId) {
  const fx = (battle.effects || []).find(
    (e) => e && e.ownerId === targetId && e.type === "defenseBoost" && (e.charges || 0) > 0
  );
  return fx ? (fx.factor || 2) : 1;
}

/* ─────────────────────────────────────────────
 * 액션 해석기
 * ───────────────────────────────────────────── */
/**
 * @param {Object} battle  서버 배틀 상태(직렬화 가능한 POJO)
 * @param {Object} action  { actorId, type, targetId?, itemType? }
 * @returns {{ logs: Array, updates: {hp:Object}, turnEnded: boolean }}
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

  /* 패스 */
  if (kind === "pass") {
    logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
    return { logs, updates, turnEnded: true };
  }

  /* 방어 태세: 다음 피격 1회 방어력 ×2 (확률 없음) */
  if (kind === "defend") {
    battle.effects = Array.isArray(battle.effects) ? battle.effects : [];
    battle.effects.push({
      ownerId: actor.id,
      type: "defenseBoost",
      factor: 2.0,
      charges: 1,
      success: true,
      source: "action:defend",
      appliedAt: Date.now(),
    });
    logs.push({ type: "system", message: `${actor.name} 방어 태세 (다음 피격 시 방어력 2배)` });
    return { logs, updates, turnEnded: true };
  }

  /* dodge: 안내만. 실제 회피는 공격 시 자동 판정 */
  if (kind === "dodge") {
    logs.push({
      type: "system",
      message: `${actor.name} 회피 자세 (공격 시 민첩+D20 자동 판정)`,
    });
    return { logs, updates, turnEnded: true };
  }

  /* 아이템 사용 */
  if (kind === "item") {
    const key = normalizeItemKey(itemType);
    if (!key) {
      logs.push({ type: "system", message: "알 수 없는 아이템" });
      return { logs, updates, turnEnded: true };
    }

    // 디터니(자신/아군), 공격/방어 보정기는 rules.applyItemEffect가 처리
    const tgt =
      key === "dittany" && targetId
        ? findAny(battle, targetId) || actor
        : actor;

    const res = applyItemEffect(battle, actor.id, key, tgt?.id);
    logs.push({
      type: "item",
      message: res.message,
      rollDetails: res.rollDetails,
    });

    // 디터니로 HP 변동 시 반영
    if (res.success && key === "dittany" && tgt) {
      updates.hp[tgt.id] = tgt.hp;
    }

    // 공격 보정기 성공 시 rules 쪽에서 즉시 공격을 수행했다면 대상 HP가 변했을 수 있음
    if (res.success && res.attack && res.attack.targetId) {
      const t = findAny(battle, res.attack.targetId);
      if (t) updates.hp[t.id] = t.hp;
    }

    return { logs, updates, turnEnded: true };
  }

  /* 공격 */
  if (kind === "attack") {
    // 대상 결정
    let target = null;
    if (targetId) {
      const c = findAny(battle, targetId);
      target = c && c.hp > 0 && c.team !== actor.team ? c : null;
    }
    if (!target) target = findAliveOpponent(battle, actor);
    if (!target) {
      logs.push({ type: "system", message: "공격 대상이 없음" });
      return { logs, updates, turnEnded: true };
    }

    // 공격치 계산(보정기 소모 포함)
    const atkRoll = roll(20);
    const atkMul = consumeAttackMultiplier(battle, actor.id).mul || 1;
    const attackScore = computeAttackScore({
      atk: Number(actor.stats?.attack || 0),
      atkRoll,
      atkMul,
    });

    // 회피(민첩 + d20) 자동 판정
    const dodgeRoll = roll(20);
    const dodgeScore = Number(target.stats?.agility || 0) + dodgeRoll;
    if (dodgeScore >= attackScore) {
      logs.push({
        type: "battle",
        message: `${target.name}이(가) ${actor.name}의 공격을 회피! (민첩${target.stats?.agility || 0}+d20=${dodgeScore} ≥ 공격치${attackScore})`,
        data: { dodgeRoll, dodgeScore, attackScore },
      });
      return { logs, updates, turnEnded: true };
    }

    // 방어 2배 효과 확인 및 1회 소모
    const defMul = pollDefenseBoostFactor(battle, target.id);
    consumeDefenseMultiplierOnHit(battle, target.id); // 효과 소모 처리

    // 치명타: d20 ≥ (20 - luck/2)
    const critThreshold = 20 - Math.floor(Number(actor.stats?.luck || 0) / 2);
    const isCritical = atkRoll >= critThreshold;

    // 최종 피해 계산 (rules.computeDamage가 0 하한 보장)
    const { dmg } = computeDamage({
      atk: Number(actor.stats?.attack || 0),
      def: Number(target.stats?.defense || 0),
      atkRoll,
      crit: isCritical,
      atkMul,
      defMul: defMul || 1,
    });

    const oldHp = target.hp;
    const newHp = Math.max(0, oldHp - dmg);
    target.hp = newHp;
    updates.hp[target.id] = newHp;

    if (isCritical) {
      logs.push({ type: "battle", message: `치명타 발생!` });
    }
    logs.push({
      type: "battle",
      message: `${actor.name} → ${target.name} ${dmg} 피해${defMul > 1 ? " (방어 2배)" : ""}  [${oldHp}→${newHp}]`,
      data: {
        attacker: actor.name,
        target: target.name,
        atkRoll,
        atkMul,
        defMul,
        crit: isCritical,
        damage: dmg,
      },
    });

    return { logs, updates, turnEnded: true };
  }

  // 알 수 없는 액션
  logs.push({ type: "system", message: "알 수 없는 행동" });
  return { logs, updates, turnEnded: false };
}

export default { resolveAction };
