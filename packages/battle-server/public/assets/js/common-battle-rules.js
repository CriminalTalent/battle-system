// packages/battle-server/public/assets/js/common-battle-rules.js
// PYXIS 공통 전투 룰 (브라우저) - 수정판
// - 스탯: 각 1~5 / HP 최대 100
// - 보정기(아이템): 전부 1회용
//    • 공격 보정기: 10% 성공 → 해당 행동에서 '공격력 ×2'로 계산
//    • 방어 보정기: 10% 성공 → 다음 피격 1회 방어력 +2 (가산, 곱하기 아님)
//    • 디터니: +10 HP
// - 치명타: d20 ≥ (20 - luck/2) → 최종 피해 ×2
// - 방어: "곱하기" 없음. 피해 = max(0, (공격치 - 방어치) × (치명타?2:1))
// - 회피: 수비측 (민첩 + d20) ≥ 공격치 → 0

;(function initPyxisRules (root) {
  const RULES = {
    ATK_BOOSTER_SUCCESS: 0.10,
    DEF_BOOSTER_SUCCESS: 0.10,
    DEF_FLAT_BONUS_ON_HIT: 2,
    MAX_HP: 100
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rollD20() { return Math.floor(Math.random() * 20) + 1; }
  function toInt(v, fb=0){ const n = parseInt(v,10); return Number.isNaN(n)?fb:n; }

  function readStats(entity) {
    const s = entity?.stats || entity || {};
    const attack  = clamp(toInt(s.attack  ?? s.atk, 3), 1, 5);
    const defense = clamp(toInt(s.defense ?? s.def, 3), 1, 5);
    const agility = clamp(toInt(s.agility ?? s.dex, 3), 1, 5);
    const luck    = clamp(toInt(s.luck    ?? s.luk, 2), 1, 5);
    return { attack, defense, agility, luck };
  }

  function isCritical(attackerLuck) {
    const th = 20 - Math.floor(attackerLuck / 2);
    const d  = rollD20();
    return { crit: d >= th, roll: d, threshold: th };
  }

  // --- 아이템 판정(클라이언트 시뮬용) ---
  function tryAttackBooster() {
    const ok = Math.random() < RULES.ATK_BOOSTER_SUCCESS;
    return { success: ok, mult: ok ? 2 : 1 }; // 공격력 ×2(그 행동 1회)
  }
  function tryDefenseBooster() {
    const ok = Math.random() < RULES.DEF_BOOSTER_SUCCESS;
    return { success: ok, flat: ok ? RULES.DEF_FLAT_BONUS_ON_HIT : 0 }; // 다음 피격 1회 +2 가산
  }
  function useDittany(hp, maxHp = RULES.MAX_HP) {
    return clamp(hp + 10, 0, maxHp);
  }

  // --- 기본 계산 ---
  function computeAttackScore(attacker, { useAtkBooster=false }={}) {
    const { attack, luck } = readStats(attacker);
    const roll = rollD20();
    let atkStat = attack;
    let booster = { success:false, mult:1 };
    if (useAtkBooster) {
      booster = tryAttackBooster();
      atkStat = Math.floor(atkStat * booster.mult);
    }
    const score = atkStat + roll;
    const { crit } = isCritical(luck);
    return { score, roll, crit, boosterUsed: !!useAtkBooster, boosterSuccess: booster.success };
  }

  // 방어는 단순 가산(곱하기 X)
  function computeDefenseValue(defender, { defenseFlat=0 }={}) {
    const { defense } = readStats(defender);
    return { value: defense + (defenseFlat|0) };
  }

  // 방어 해석: damage = max(0, (atkScore - defValue) × (crit?2:1))
  function resolveDefense(attacker, defender, opts={}) {
    const atk = computeAttackScore(attacker, { useAtkBooster: !!opts.useAtkBooster });
    const defFlat = opts.defenseFlat || 0; // 방어 보정기 성공 시 +2를 외부에서 넘겨줄 수 있음
    const def = computeDefenseValue(defender, { defenseFlat: defFlat });

    let raw = atk.score - def.value;
    if (atk.crit) raw *= 2;

    const damage = Math.max(0, raw);
    return {
      damage,
      defended: damage === 0,
      attackDetail: atk,
      defenseDetail: { ...def, flat: defFlat }
    };
  }

  // 회피: 민첩 + d20 ≥ 공격수치 → 0
  function resolveDodge(attacker, defender, opts={}) {
    const atk = computeAttackScore(attacker, { useAtkBooster: !!opts.useAtkBooster });
    const { agility } = readStats(defender);
    const dodgeRoll = rollD20();
    const dodgeScore = agility + dodgeRoll;
    const dodged = dodgeScore >= atk.score;

    let damage = 0;
    if (!dodged) {
      let raw = atk.score;
      if (atk.crit) raw *= 2;
      damage = Math.max(0, raw);
    }
    return { damage, dodged, attackDetail: atk, dodgeRoll, dodgeScore };
  }

  // 선택적 명중 판정
  function optionalHitCheck(attacker, defender) {
    const { luck } = readStats(attacker);
    const { agility } = readStats(defender);
    const hitRoll = rollD20();
    const dodgeRoll = rollD20();
    const hitScore = luck + hitRoll;
    const dodgeScore = agility + dodgeRoll;
    const hit = hitScore > dodgeScore;
    return { hit, hitScore, dodgeScore, hitRoll, dodgeRoll };
  }

  // 팀 선공(합산)
  function computeTeamInitiative(teamPlayers=[]) {
    let total = 0;
    const breakdown = [];
    teamPlayers.forEach(p=>{
      const { agility } = readStats(p);
      const r = rollD20();
      total += agility + r;
      breakdown.push({ name: p?.name || '', agility, roll: r, sum: agility + r });
    });
    return { total, breakdown };
  }

  function applyDamage(hp, damage, maxHp = RULES.MAX_HP) {
    return clamp(hp - Math.max(0, damage|0), 0, maxHp);
  }
  function applyHeal(hp, heal, maxHp = RULES.MAX_HP) {
    return clamp(hp + Math.max(0, heal|0), 0, maxHp);
  }

  const API = {
    RULES,
    rollD20,
    readStats,
    isCritical,
    tryAttackBooster,
    tryDefenseBooster,   // 성공 시 flat +2 (가산)
    useDittany,          // +10 HP
    computeAttackScore,
    computeDefenseValue, // 가산형
    resolveDefense,
    resolveDodge,
    optionalHitCheck,
    computeTeamInitiative,
    applyDamage,
    applyHeal,
  };

  root.PYXIS_RULES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
