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
} from "./rules.js";

/**
 * resolveAction(battle, { actorId, type, target, targetId, itemType })
 * 반환:
 *  {
 *    logs: [{ type, message }],
 *    updates: { hp: { [pid]: newHp } },
 *    turnEnded: boolean,
 *    winner: "phoenix"|"eaters"|null
 *  }
 */
export function resolveAction(battle, action) {
  const { actorId, type } = action || {};
  const logs = [];
  const updates = { hp: {} };

  const actor = findAlive(battle, actorId);
  if (!actor) {
    logs.push({ type: "system", message: "행동 불가: 전투 참가자 상태 이상" });
    return { logs, updates, turnEnded: true };
  }

  // 사전 정규화
  const kind = String(type || "").trim();

  if (kind === "pass") {
    logs.push({ type: "system", message: `${actor.name} 패스` });
    return { logs, updates, turnEnded: true };
  }

  if (kind === "defend") {
    // 방어 준비: 다음 피격 1회에 방어력 +25% (아이템과 별개, 과도 중첩 방지로 소폭)
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "defenseBoost",
      factor: 1.25,
      charges: 1,
      success: true, // 액션 방어는 확정
      source: "action:defend"
    });
    logs.push({ type: "system", message: `${actor.name} 방어 태세` });
    return { logs, updates, turnEnded: true };
  }

  if (kind === "dodge") {
    // 회피 준비: 다음 피격 1회에 회피 판정에 +4 가산 (내부 처리용)
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "dodgePrep",
      add: 4,
      charges: 1,
      success: true,
      source: "action:dodge"
    });
    logs.push({ type: "system", message: `${actor.name} 회피 태세` });
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
    const target = findAlive(battle, action.targetId);
    if (!target) {
      logs.push({ type: "system", message: "대상이 유효하지 않음" });
      return { logs, updates, turnEnded: true };
    }

    // 공격측 일시 공격 배율(공격 보정기 성공시만 적용되도록)
    const atkEff = consumeAttackMultiplier(battle, actor.id);
    // 수비측 일시 방어 배율(방어 보정기/방어액션 성공 시 적용)
    const defEff = consumeDefenseMultiplierOnHit(battle, target.id);

    // 공격 수치(회피 비교용)
    const atkRoll = roll(20);
    const atkScore = computeAttackScore({
      atk: actor.stats?.atk ?? 0,
      atkRoll,
      atkMul: atkEff.mul
    });

    // 회피 보정(dodgePrep) 있으면 회피 굴림에 +add
    const evdRollBase = roll(20);
    const evdRoll = evdRollBase + consumeDodgeBonus(battle, target.id);

    // 회피 판정
    if (EVASION_CHECK(atkScore, (target.stats?.agi ?? 0), evdRoll)) {
      logs.push({ type: "system", message: `${target.name} 회피 성공 (민첩 ${target.stats?.agi ?? 0} + 주사위 결과)` });
      return { logs, updates, turnEnded: true };
    }

    // 명중/치명 판정 (행운 + d20)
    const hitRoll = roll(20);
    const { hit, crit } = computeHit({ luk: actor.stats?.luk ?? 0, hitRoll });
    if (!hit) {
      logs.push({ type: "system", message: `${actor.name}의 공격 빗나감 (행운 ${actor.stats?.luk ?? 0} + 주사위 ${hitRoll})` });
      return { logs, updates, turnEnded: true };
    }

    // 데미지 계산
    const { dmg } = computeDamage({
      atk: actor.stats?.atk ?? 0,
      def: target.stats?.def ?? 0,
      atkRoll,
      crit,
      atkMul: atkEff.mul,
      defMul: defEff.mul
    });

    const before = Math.max(0, Number(target.hp || 0));
    const after = Math.max(0, before - dmg);
    target.hp = after;
    updates.hp[target.id] = after;

    const tags = [];
    if (atkEff.note) tags.push(atkEff.note);
    if (defEff.note) tags.push(defEff.note);
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";

    if (crit) {
      logs.push({ type: "action", message: `${actor.name} → ${target.name} 치명타 ${dmg} 피해${tagStr}` });
    } else {
      logs.push({ type: "system", message: `${actor.name} → ${target.name} ${dmg} 피해${tagStr}` });
    }
    if (after === 0) logs.push({ type: "system", message: `${target.name} 쓰러짐` });

    return { logs, updates, turnEnded: true };
  }

  logs.push({ type: "system", message: "알 수 없는 행동" });
  return { logs, updates, turnEnded: true };
}

/** 아이템 사용 래퍼 */
function applyItem(battle, { actor, target, itemType }) {
  const key = normalizeItemKey(itemType);
  // engine/rules 의 applyItemEffect를 직접 호출하지 않고,
  // 여기서도 유효성 추가 체크: 전투 종료자/사망자 대상 금지
  if (!target) {
    return { logs: [{ type: "system", message: "대상이 유효하지 않음" }], updates: { hp: {} } };
  }
  if (key === "dittany" && target.hp <= 0) {
    return { logs: [{ type: "system", message: "사망자에게는 회복 불가" }], updates: { hp: {} } };
  }
  // 동적 import 순환 피하기 위해 require-like 접근
  const rules = requireRules();
  return rules.applyItemEffect(battle, { actor, target, itemType: key });
}

// 동적 import 방지용 안전 참조
function requireRules() {
  // eslint-disable-next-line no-undef
  return (globalThis.__PYX_RULES__ ||= (awaitImport()));
}

function awaitImport() {
  // Node ESM 환경 호환: 동기처럼 보이게 캐시해두기
  // eslint-disable-next-line no-eval
  const mod = eval('require') ? eval('require')('./rules.js') : null;
  // 브라우저 번들 환경에서는 상단 import 경로를 사용하는 환경에서만 실행됨
  return mod || {};
}

function mergeHpUpdates(dest, src = {}) {
  for (const [k, v] of Object.entries(src)) dest[k] = v;
}

function findAny(battle, playerId) {
  return (battle.players || []).find(p => p.id === playerId) || null;
}

function findAlive(battle, playerId) {
  const p = findAny(battle, playerId);
  if (!p || p.hp <= 0) return null;
  return p;
}

function ensureEffects(battle) {
  if (!Array.isArray(battle.effects)) battle.effects = [];
}

/** dodgePrep 효과를 회피 굴림에 반영하고 차감 */
function consumeDodgeBonus(battle, defenderId) {
  if (!Array.isArray(battle.effects)) return 0;
  let bonus = 0;
  for (const eff of battle.effects) {
    if (eff?.ownerId === defenderId && eff.type === "dodgePrep" && eff.charges > 0) {
      bonus += Number(eff.add || 0);
      eff.charges -= 1;
    }
  }
  battle.effects = battle.effects.filter(e => (e.charges || 0) > 0);
  return bonus;
}