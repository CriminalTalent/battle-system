// PYXIS Combat Rules (ESM)
// - 공격: 공격력 + d20 - 상대 방어력
// - 명중: 행운 + d20 → 명중율 (기본 임계 12)
// - 회피: 수비측 (민첩 + d20) ≥ (공격측 공격수치) → 완전 회피
// - 치명: d20 ≥ (20 - 행운/2) → 2배
// - 방어/회피 액션: 서버 측 상태 플래그로 다음 피격 1회에 영향
// - 아이템: 1회성. 공격/방어 보정기 성공확률 10% (실패해도 소모), 디터니 +10 즉시회복

import { roll, chance } from "./dice.js";

/** 기본 상수 */
export const MAX_STAT = 5;

export const HIT_THRESHOLD = 12;              // 명중 기준: luck + d20 >= 12
export const CRIT_FORMULA = (luk, d20) => d20 >= (20 - (luk / 2));

export const EVASION_CHECK = (attackerAtkScore, defenderAgi, evdRoll) =>
  (defenderAgi + evdRoll) >= attackerAtkScore; // 회피 조건

/** 아이템 사전 (서버 키 기준) */
export const ITEMS = {
  attackBoost: { key: "attackBoost", label: "공격 보정기", factor: 1.5, success: 0.10 },
  defenseBoost:{ key: "defenseBoost", label: "방어 보정기", factor: 1.5, success: 0.10 },
  dittany:     { key: "dittany",     label: "디터니",      heal: 10 }
};

// 클라이언트 키 → 서버 키 매핑 (양쪽 모두 허용)
export function normalizeItemKey(k = "") {
  const key = String(k || "").trim();
  if (key === "atkBoost") return "attackBoost";
  if (key === "defBoost") return "defenseBoost";
  if (key === "heal10")   return "dittany";
  return key;
}

/** 유틸: 스탯 안전화(0..5) */
export function clampStat(n) {
  n = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(MAX_STAT, n));
}

/** 명중/치명 판정 */
export function computeHit({ luk, hitRoll }) {
  const hit = (Number(luk || 0) + Number(hitRoll || 0)) >= HIT_THRESHOLD;
  const crit = CRIT_FORMULA(Number(luk || 0), Number(hitRoll || 0));
  return { hit, crit };
}

/** 공격력 쪽 공격 수치 (회피/방어 계산에 사용) */
export function computeAttackScore({ atk, atkRoll, atkMul = 1 }) {
  const A = clampStat(atk);
  const r = Number(atkRoll || 0);
  return (A * atkMul) + r;
}

/** 수비 측 방어 수치 (데미지 감소 계산에 사용) */
export function computeDefenseScore({ def, defMul = 1 }) {
  const D = clampStat(def);
  return D * defMul;
}

/** 기본 데미지 공식 (치명 시 2배) */
export function computeDamage({ atk, def, atkRoll, crit, atkMul = 1, defMul = 1 }) {
  const atkScore = computeAttackScore({ atk, atkRoll, atkMul }); // 공격측 기여
  const defScore = computeDefenseScore({ def, defMul });         // 방어측 기여
  let dmg = Math.max(0, Math.floor(atkScore - defScore));
  if (crit) dmg = Math.floor(dmg * 2);
  return { dmg, atkScore };
}

/** 아이템 적용 (상태/effects 반영 + 로그/업데이트 반환) */
export function applyItemEffect(battle, { actor, target, itemType }) {
  const logs = [];
  const updates = { hp: {}, effects: [] };

  const key = normalizeItemKey(itemType);
  const spec = ITEMS[key];
  if (!spec) {
    logs.push({ type: "system", message: `알 수 없는 아이템` });
    return { ok: false, logs, updates };
  }

  // 인벤토리에서 1개 소모
  const idx = (actor.items || []).findIndex(k => normalizeItemKey(k) === key);
  if (idx === -1) {
    logs.push({ type: "system", message: `${spec.label} 사용 실패: 보유 중이 아님` });
    return { ok: false, logs, updates };
  }
  actor.items.splice(idx, 1);

  if (key === "dittany") {
    // 즉시 회복 +10
    const maxHp = Number(target.maxHp || 100) || 100;
    const nowHp = Math.max(0, Number(target.hp || 0));
    const healed = Math.min(spec.heal, Math.max(0, maxHp - nowHp));
    const newHp = Math.min(maxHp, nowHp + spec.heal);
    target.hp = newHp; // 서버 상태 갱신
    updates.hp[target.id] = newHp;
    logs.push({ type: "system", message: `${actor.name} → ${target.name} 디터니 사용, ${healed} 회복` });
    return { ok: true, logs, updates };
  }

  if (key === "attackBoost") {
    const success = chance(spec.success);
    // 효과는 "다음 자신의 행동 1회"에 적용되도록 버프를 걸어 둠
    const eff = {
      ownerId: actor.id,
      type: "attackBoost",
      factor: spec.factor,
      charges: 1,                 // 1회 사용 후 소멸
    };
    ensureEffectsArray(battle);
    battle.effects.push(eff);
    logs.push({ type: "system", message: `${actor.name} 공격 보정기 사용 ${success ? "성공" : "실패"} (성공 시 공격력 ×${spec.factor})` });
    // 성공/실패 여부는 실제 데미지 계산 시에도 확인해야 하지만,
    // 실패해도 "아이템은 소모"가 규칙. 여기서는 버프를 걸되, 성공 플래그를 함께 저장.
    eff.success = success;
    return { ok: true, logs, updates };
  }

  if (key === "defenseBoost") {
    const success = chance(spec.success);
    const eff = {
      ownerId: actor.id,
      type: "defenseBoost",
      factor: spec.factor,
      charges: 1, // 다음 피격 1회
    };
    ensureEffectsArray(battle);
    battle.effects.push(eff);
    logs.push({ type: "system", message: `${actor.name} 방어 보정기 사용 ${success ? "성공" : "실패"} (성공 시 방어력 ×${spec.factor})` });
    eff.success = success;
    return { ok: true, logs, updates };
  }

  return { ok: false, logs, updates };
}

/** 현재 공격에 적용할 일시 버프(Mul) 계산 + 차감 */
export function consumeAttackMultiplier(battle, actorId) {
  let mul = 1;
  if (!Array.isArray(battle.effects)) return { mul, note: null };
  for (const eff of battle.effects) {
    if (eff?.ownerId === actorId && eff.type === "attackBoost" && eff.charges > 0) {
      // 성공한 경우만 배율 적용
      if (eff.success) mul *= Number(eff.factor || 1);
      eff.charges -= 1;
    }
  }
  // 쓰고 난 빈 charges 는 컬렉션 정리
  battle.effects = battle.effects.filter(e => (e.charges || 0) > 0);
  return { mul, note: mul > 1 ? `공격 보정 ×${mul}` : null };
}

/** 이번 피격에 적용할 일시 방어 배율 + 차감 */
export function consumeDefenseMultiplierOnHit(battle, defenderId) {
  let mul = 1;
  if (!Array.isArray(battle.effects)) return { mul, note: null };
  for (const eff of battle.effects) {
    if (eff?.ownerId === defenderId && eff.type === "defenseBoost" && eff.charges > 0) {
      if (eff.success) mul *= Number(eff.factor || 1);
      eff.charges -= 1;
    }
  }
  battle.effects = battle.effects.filter(e => (e.charges || 0) > 0);
  return { mul, note: mul > 1 ? `방어 보정 ×${mul}` : null };
}

function ensureEffectsArray(battle) {
  if (!Array.isArray(battle.effects)) battle.effects = [];
}
