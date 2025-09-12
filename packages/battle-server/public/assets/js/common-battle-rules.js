// packages/battle-server/public/assets/js/common-battle-rules.js
// PYXIS 공통 전투 룰 모듈 (브라우저/노드 겸용 UMD 스타일)
// 규칙 요약
// - 스탯: 공격/방어/민첩/행운 각각 1~5, 총합 제한 없음
// - HP: 기본/최대 100
// - 공격 수치: 공격력 + d20
// - 회피 판정: 민첩 + d20 ≥ 공격수치 → 완전 회피(0 대미지)
// - 치명타: d20 ≥ (20 - 행운/2) → 최종 대미지 2배
// - 대미지 계산:
//    · 일반 대상: max(1, 공격수치 - (방어력×보정))   ← 하한 1
//    · 방어 태세 대상: max(0, 공격수치 - (방어력×보정 + d20)) ← 하한 0
// - 아이템:
//    · 디터니: HP +10 (확정)
//    · 공격 보정기: 이번 공격 최종 대미지 2배, 성공률 10% (실패해도 소모됨 처리 여부는 상위 로직)
//    · 방어 보정기: 이번 피격 방어력 2배, 성공률 10% (실패해도 소모됨 처리 여부는 상위 로직)
// - 팀 선공 결정 참고: 팀별 (민첩 합 + d20 각자) 합이 높은 쪽 선공, 동점 시 재굴림(상위에서 처리)

;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PYXIS_RULES = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────
   * 상수/유틸
   * ────────────────────────────────────────────────────────────── */
  const RULES = {
    MAX_HP: 100,
    MIN_DAMAGE_NORMAL: 1,  // 일반 공격 하한
    MIN_DAMAGE_DEFEND: 0,  // 방어 태세 하한
    ATK_BOOSTER_SUCCESS: 0.10, // 10%
    DEF_BOOSTER_SUCCESS: 0.10, // 10%
    ATK_DAMAGE_MULTIPLIER: 2,  // 공격 보정기: 최종 대미지 배수
    DEFENSE_MULTIPLIER: 2      // 방어 보정기: 방어력 배수
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function toInt(v, fb = 0) { const n = parseInt(v, 10); return Number.isNaN(n) ? fb : n; }
  function rollD(sides = 20) { return Math.floor(Math.random() * sides) + 1; }
  function rollD20() { return rollD(20); }

  // stats.attack/defense/agility/luck 와 atk/def/agi/luk 호환
  function readStats(entity) {
    const s = entity?.stats || entity || {};
    const attack  = clamp(toInt(s.attack  ?? s.atk  , 3), 1, 5);
    const defense = clamp(toInt(s.defense ?? s.def  , 3), 1, 5);
    const agility = clamp(toInt(s.agility ?? s.agi  , 3), 1, 5);
    const luck    = clamp(toInt(s.luck    ?? s.luk  , 3), 1, 5);
    return { attack, defense, agility, luck };
  }

  /* ──────────────────────────────────────────────────────────────
   * 아이템 확률 처리(성공/실패만 반환; 실제 소모는 상위에서)
   * ────────────────────────────────────────────────────────────── */
  function tryAttackBooster() {
    const success = Math.random() < RULES.ATK_BOOSTER_SUCCESS;
    return { success, multiplier: success ? RULES.ATK_DAMAGE_MULTIPLIER : 1 };
  }
  function tryDefenseBooster() {
    const success = Math.random() < RULES.DEF_BOOSTER_SUCCESS;
    return { success, multiplier: success ? RULES.DEFENSE_MULTIPLIER : 1 };
  }
  function useDittany(currentHp, maxHp = RULES.MAX_HP) {
    return clamp((currentHp | 0) + 10, 0, maxHp);
  }

  /* ──────────────────────────────────────────────────────────────
   * 코어 판정
   * ────────────────────────────────────────────────────────────── */
  // 공격 수치 = 공격력 + d20
  function computeAttackScore(attacker) {
    const { attack } = readStats(attacker);
    const roll = rollD20();
    const score = attack + roll;
    return { score, roll };
  }

  // 치명타: d20 ≥ (20 - luck/2)
  function computeCritical(attacker) {
    const { luck } = readStats(attacker);
    const roll = rollD20();
    const threshold = 20 - Math.floor(luck / 2);
    const critical = roll >= threshold;
    return { critical, roll, threshold };
  }

  // 방어치(보정기 반영): defense * defMultiplier
  function computeDefenseValue(defender, defBoosterUsed = false) {
    const { defense } = readStats(defender);
    const booster = defBoosterUsed ? tryDefenseBooster() : { success: false, multiplier: 1 };
    const value = Math.floor(defense * booster.multiplier);
    return { value, boosterUsed: !!defBoosterUsed, boosterSuccess: booster.success, boosterMultiplier: booster.multiplier };
  }

  /* ──────────────────────────────────────────────────────────────
   * 대미지 계산(최종 배수 적용 순서: 방어 차감 → 하한 적용 → 치명타/공보 배수)
   * ────────────────────────────────────────────────────────────── */
  function finalizeDamage(base, { isDefending, crit, atkBooster }) {
    let dmg = Math.max(isDefending ? RULES.MIN_DAMAGE_DEFEND : RULES.MIN_DAMAGE_NORMAL, base | 0);
    if (crit) dmg *= RULES.ATK_DAMAGE_MULTIPLIER;
    if (atkBooster?.success) dmg *= RULES.ATK_DAMAGE_MULTIPLIER;
    return Math.max(isDefending ? RULES.MIN_DAMAGE_DEFEND : RULES.MIN_DAMAGE_NORMAL, Math.floor(dmg));
  }

  /* ──────────────────────────────────────────────────────────────
   * 행동 해석기
   * ────────────────────────────────────────────────────────────── */

  // 1) 일반 공격/방어 태세 대상에게의 공격
  //    - defenderIsDefending: 방어 태세일 경우 방어력에 d20 추가, 하한 0
  //    - useAtkBooster / useDefBooster: 각 보정기 사용 시도 후 결과 반영
  function resolveAttack(attacker, defender, {
    defenderIsDefending = false,
    useAtkBooster = false,
    useDefBooster = false
  } = {}) {
    // 공격/치명
    const atk = computeAttackScore(attacker);
    const crit = computeCritical(attacker);

    // 보정기
    const atkBooster = useAtkBooster ? tryAttackBooster() : { success: false, multiplier: 1 };
    const defVal = computeDefenseValue(defender, useDefBooster);

    // 방어 태세 추가 주사위
    let defendRoll = 0;
    let raw = 0;
    if (defenderIsDefending) {
      defendRoll = rollD20();
      raw = atk.score - (defVal.value + defendRoll);
    } else {
      raw = atk.score - defVal.value;
    }

    const base = defenderIsDefending
      ? Math.max(RULES.MIN_DAMAGE_DEFEND, raw)
      : Math.max(RULES.MIN_DAMAGE_NORMAL, raw);

    const damage = finalizeDamage(base, {
      isDefending: defenderIsDefending,
      crit: crit.critical,
      atkBooster
    });

    return {
      damage,
      context: {
        mode: defenderIsDefending ? 'defendTarget' : 'normal',
        attackScore: atk.score,
        attackRoll: atk.roll,
        defendExtraRoll: defendRoll,
        defenseValue: defVal.value,
        defenseBoosterUsed: defVal.boosterUsed,
        defenseBoosterSuccess: defVal.boosterSuccess,
        crit: crit.critical,
        critRoll: crit.roll,
        critThreshold: crit.threshold,
        attackBoosterUsed: !!useAtkBooster,
        attackBoosterSuccess: atkBooster.success
      }
    };
  }

  // 2) 회피 시도
  //    - 회피 성공: 0 대미지
  //    - 회피 실패: 일반 대상과 동일 계산(하한 1), 방어 태세가 아님
  function resolveDodge(attacker, defender, {
    useAtkBooster = false,
    useDefBooster = false   // 회피 실패 시 방어 보정기 반영 여부(규정상 아이템 사용 선택 가능성 고려)
  } = {}) {
    const atk = computeAttackScore(attacker);
    const crit = computeCritical(attacker);

    // 회피 판정
    const { agility } = readStats(defender);
    const dodgeRoll = rollD20();
    const dodgeScore = agility + dodgeRoll;
    const dodged = dodgeScore >= atk.score;

    const atkBooster = useAtkBooster ? tryAttackBooster() : { success: false, multiplier: 1 };

    if (dodged) {
      return {
        damage: 0,
        context: {
          mode: 'dodgeSuccess',
          attackScore: atk.score,
          attackRoll: atk.roll,
          dodgeScore,
          dodgeRoll,
          crit: crit.critical,
          critRoll: crit.roll,
          critThreshold: crit.threshold,
          attackBoosterUsed: !!useAtkBooster,
          attackBoosterSuccess: atkBooster.success
        }
      };
    }

    // 실패 시 일반 대상과 동일(하한 1)
    const defVal = computeDefenseValue(defender, useDefBooster);
    const raw = atk.score - defVal.value;
    const base = Math.max(RULES.MIN_DAMAGE_NORMAL, raw);
    const damage = finalizeDamage(base, {
      isDefending: false,
      crit: crit.critical,
      atkBooster
    });

    return {
      damage,
      context: {
        mode: 'dodgeFail',
        attackScore: atk.score,
        attackRoll: atk.roll,
        dodgeScore,
        dodgeRoll,
        defenseValue: defVal.value,
        defenseBoosterUsed: defVal.boosterUsed,
        defenseBoosterSuccess: defVal.boosterSuccess,
        crit: crit.critical,
        critRoll: crit.roll,
        critThreshold: crit.threshold,
        attackBoosterUsed: !!useAtkBooster,
        attackBoosterSuccess: atkBooster.success
      }
    };
  }

  /* ──────────────────────────────────────────────────────────────
   * 팀 선공 계산(상위에서 동점시 재굴림)
   * ────────────────────────────────────────────────────────────── */
  function computeTeamInitiative(teamPlayers = []) {
    let total = 0;
    const detail = [];
    for (const p of teamPlayers) {
      const { agility } = readStats(p);
      const r = rollD20();
      const sum = agility + r;
      total += sum;
      detail.push({ id: p?.id || null, name: p?.name || '', agility, roll: r, sum });
    }
    return { total, detail };
  }

  /* ──────────────────────────────────────────────────────────────
   * HP 적용 헬퍼
   * ────────────────────────────────────────────────────────────── */
  function applyDamage(hp, damage, maxHp = RULES.MAX_HP) {
    return clamp((hp | 0) - Math.max(0, damage | 0), 0, maxHp);
  }
  function applyHeal(hp, heal, maxHp = RULES.MAX_HP) {
    return clamp((hp | 0) + Math.max(0, heal | 0), 0, maxHp);
  }

  /* ──────────────────────────────────────────────────────────────
   * 공개 API
   * ────────────────────────────────────────────────────────────── */
  return {
    RULES,

    // 주사위
    rollD20,

    // 스탯/아이템
    readStats,
    tryAttackBooster,
    tryDefenseBooster,
    useDittany,

    // 판정/계산
    computeAttackScore,
    computeCritical,
    computeDefenseValue,
    resolveAttack,
    resolveDodge,
    computeTeamInitiative,

    // HP 도우미
    applyDamage,
    applyHeal
  };
});
