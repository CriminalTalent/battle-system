// packages/battle-server/src/engine/rules.js
import { d20 } from "./dice.js";

/**
 * 치명타 판정: D20 >= (20 - luck/2)
 */
export function rollCrit(luck = 0) {
  const roll = d20();
  const need = Math.max(1, Math.floor(20 - (luck || 0) / 2));
  return { crit: roll >= need, roll, need };
}

/**
 * 회피 판정: (민첩 + D20) >= 공격수치
 */
export function checkEvade(targetAgi, atkScore) {
  const roll = d20();
  const evadeScore = (targetAgi || 0) + roll;
  return { evaded: evadeScore >= atkScore, roll, evadeScore };
}

/**
 * 공격 처리
 * 규칙:
 * - 공격수치 = 공격 + D20
 * - 방어태세면 방어 = 방어 + D20, 아니면 방어 = 방어
 * - 방어보정 활성화면 방어 2배
 * - 회피 태세면 (민첩 + D20)로 회피 판정 → 성공시 피해 0
 * - 치명타 시 최종 피해 2배
 * - 공격보정 활성화 시 최종 피해 2배 (1회성, 사용 후 해제)
 * - 최소 피해: 방어태세면 0, 아니면 1
 */
export function resolveAttack(attacker, defender) {
  const aStats = attacker.stats || {};
  const dStats = defender.stats || {};
  const aState = attacker.state || {};
  const dState = defender.state || {};

  const atkRoll = d20();
  const atkScore = (aStats.attack || 0) + atkRoll;

  // 회피 우선
  if (dState.dodging) {
    const { evaded, roll: evRoll } = checkEvade(dStats.agility || 0, atkScore);
    defender.state.dodging = false; // 1회성
    if (evaded) {
      return {
        hit: false, evaded: true, damage: 0, crit: false,
        atkRoll, defRoll: evRoll, wasDefending: dState.defending, wasDodging: true
      };
    }
  }

  // 방어값
  let defRoll = 0;
  let defense = (dStats.defense || 0);
  let minDamage = 1;
  if (dState.defending) {
    defRoll = d20();
    defense += defRoll;
    minDamage = 0;
    defender.state.defending = false; // 1회성
  }
  if (dState.defenseBoost) {
    defense *= 2;
    defender.state.defenseBoost = false; // 1회성
  }

  let raw = atkScore - defense;
  if (raw < minDamage) raw = minDamage;

  // 치명타
  const { crit } = rollCrit(aStats.luck || 0);
  if (crit) raw *= 2;

  // 공격 보정 (한 번만)
  if (aState.atkBoostActive) {
    raw *= 2;
    attacker.state.atkBoostActive = false;
  }

  const damage = Math.max(0, Math.floor(raw));
  return {
    hit: damage > 0,
    evaded: false,
    damage,
    crit,
    atkRoll,
    defRoll,
    wasDefending: !!dState.defending,
    wasDodging: !!dState.dodging
  };
}

/**
 * 아이템 사용 처리
 * - dittany: HP +10 (고정, 확정)
 * - attackBooster: 10% 성공시 다음 공격 2배 (실패해도 소모)
 * - defenseBooster: 10% 성공시 다음 피격 방어 2배 (실패해도 소모)
 */
export function useItem(player, itemType) {
  const items = player.items || {};
  const st = player.state || (player.state = {});
  const nameMap = {
    ditany: "dittany", dittany: "dittany",
    attack_boost: "attackBooster", attackBooster: "attackBooster",
    defense_boost: "defenseBooster", defenseBooster: "defenseBooster",
  };
  const key = nameMap[itemType] || itemType;

  const has = (k) => (items[k] && items[k] > 0);
  const dec = (k) => { items[k] = Math.max(0, (items[k] || 0) - 1); };

  if (key === "dittany") {
    if (!has("dittany")) return { ok: false, reason: "no_item" };
    dec("dittany");
    const before = player.hp;
    player.hp = Math.min(player.maxHp || 100, (player.hp || 0) + 10);
    return { ok: true, type: "heal", amount: player.hp - before };
  }
  if (key === "attackBooster") {
    if (!has("attackBooster")) return { ok: false, reason: "no_item" };
    dec("attackBooster");
    const success = Math.random() < 0.10;
    if (success) st.atkBoostActive = true;
    return { ok: true, type: "atk_boost", success };
  }
  if (key === "defenseBooster") {
    if (!has("defenseBooster")) return { ok: false, reason: "no_item" };
    dec("defenseBooster");
    const success = Math.random() < 0.10;
    if (success) player.state.defenseBoost = true;
    return { ok: true, type: "def_boost", success };
  }
  return { ok: false, reason: "unknown_item" };
}
