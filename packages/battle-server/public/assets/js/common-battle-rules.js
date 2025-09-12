// packages/battle-server/public/assets/js/common-battle-rules.js
// PYXIS 공통 전투 룰 모듈
// - 스탯: 각 1~5 / HP 최대 100
// - 공격/방어 보정기: 성공확률 10%, 성공 시 해당 스탯 2배(그 턴 1회)
// - 디터니: +10HP
// - 치명타: d20 ≥ (20 - luck/2) → 최종 대미지 2배
// - 방어: 대미지 = max(0, 공격수치 - 방어치)  ← 단순 감산식, 역공 없음
// - 회피: 성공 시 0, 실패 시 하한 1 없음(직격)

;(function initPyxisRules (root) {
  const RULES = {
    MIN_DAMAGE: 0,            // 회피 실패 하한 제거
    ATK_BOOSTER_SUCCESS: 0.10,
    DEF_BOOSTER_SUCCESS: 0.10,
    ATK_MULTIPLIER: 2,        // ×2
    DEF_MULTIPLIER: 2,        // ×2
    MAX_HP: 100
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rollD20() { return Math.floor(Math.random() * 20) + 1; }
  function toInt(v, fb=0){ const n = parseInt(v,10); return Number.isNaN(n)?fb:n; }

  // stats.attack/defense/agility/luck 와 atk/def/dex/luk 호환
  function readStats(entity) {
    const s = entity?.stats || entity || {};
    const attack  = toInt(s.attack  ?? s.atk, 3);
    const defense = toInt(s.defense ?? s.def, 3);
    const agility = toInt(s.agility ?? s.dex, 3);
    const luck    = toInt(s.luck    ?? s.luk, 2);
    return {
      attack:  clamp(attack,  1, 5),
      defense: clamp(defense, 1, 5),
      agility: clamp(agility, 1, 5),
      luck:    clamp(luck,    1, 5),
    };
  }

  function isCritical(attackerLuck) {
    const th = 20 - (attackerLuck / 2);
    const d  = rollD20();
    return d >= th;
  }

  function tryAttackBooster() {
    const ok = Math.random() < RULES.ATK_BOOSTER_SUCCESS;
    return { success: ok, mult: ok ? RULES.ATK_MULTIPLIER : 1 };
  }
  function tryDefenseBooster() {
    const ok = Math.random() < RULES.DEF_BOOSTER_SUCCESS;
    return { success: ok, mult: ok ? RULES.DEF_MULTIPLIER : 1 };
  }
  function useDittany(hp, maxHp = RULES.MAX_HP) {
    return clamp(hp + 10, 0, maxHp);
  }

  // 공격자 최종 공격수치 = floor(공격력×보정) + d20
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
    const crit  = isCritical(luck);
    return { score, roll, crit, boosterUsed: !!useAtkBooster, boosterSuccess: booster.success };
  }

  // 방어치 = floor(방어력×보정)
  function computeDefenseValue(defender, { useDefBooster=false }={}) {
    const { defense } = readStats(defender);
    let defStat = defense;
    let booster = { success:false, mult:1 };
    if (useDefBooster) {
      booster = tryDefenseBooster();
      defStat = Math.floor(defStat * booster.mult);
    }
    return { value: defStat, boosterUsed: !!useDefBooster, boosterSuccess: booster.success };
  }

  // 방어: damage = max(0, 공격수치 - 방어치). 역공/대항 굴림 없음.
  function resolveDefense(attacker, defender, opts={}) {
    const atk = computeAttackScore(attacker, { useAtkBooster: !!opts.useAtkBooster });
    const def = computeDefenseValue(defender, { useDefBooster: !!opts.useDefBooster });

    let raw = atk.score - def.value;
    if (atk.crit) raw *= 2;                   // 치명타는 최종 대미지 ×2
    const damage = Math.max(0, raw);

    return {
      damage,
      defended: damage === 0,                 // 방어치가 더 높아 0이면 '성공'
      attackDetail: atk,
      defenseDetail: def
    };
  }

  // 회피: 민첩 + d20 ≥ 공격수치 → 0, 실패 시 직격(하한 1 없음)
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
      damage = Math.max(0, raw);             // 하한 제거
    }
    return { damage, dodged, attackDetail: atk, dodgeRoll };
  }

  // 선택적 명중 판정(필요 시 사용할 것)
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

  // 팀 선공
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
    tryDefenseBooster,
    useDittany,
    computeAttackScore,
    computeDefenseValue,
    resolveDefense,   // ← 단순 감산식 & 역공 제거
    resolveDodge,     // ← 성공 0 / 실패 하한 없음
    optionalHitCheck,
    computeTeamInitiative,
    applyDamage,
    applyHeal,
  };

  root.PYXIS_RULES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
