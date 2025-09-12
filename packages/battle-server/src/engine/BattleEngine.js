// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle Engine - 7학년 모의 전투 규칙 적용 (통합 규격)
// - 팀 단위 턴제 (선공팀 전원 → 후공팀 전원)
// - 공격치: floor(공격력×공격보정) + D20
// - 방어치: floor(방어력×방어보정)
// - 피해: max(0, (공격치 ×(치명타?2:1)) - 방어치)   ← 하한 0, “최소 1” 없음
// - 치명타: D20 ≥ (20 - luck/2) → 2배 피해
// - 회피: (민첩 + D20) ≥ 공격치 → 0 피해
// - 아이템: 디터니(+10HP), 공/방 보정기(성공 10%, 해당 스탯×2배, 1회성)
// - 팀명은 상위 상태에서 A/B로만 관리

"use strict";

import { roll } from "../dice.js";
import {
  computeAttackScore,        // ({ atk, atkRoll, atkMul }) => number | { score, roll, crit, ... }
  computeDamage,             // ({ atk, def, atkRoll, crit, atkMul, defMul }) => { dmg }
  applyItemEffect,
  consumeAttackMultiplier,   // (battle, actorId) => { mul, used? }
  consumeDefenseMultiplierOnHit, // (battle, targetId) => { mul, used? }
  normalizeItemKey,
} from "../rules.js";

export class BattleEngine {
  constructor(battle) {
    this.battle = battle || {};
    this._ensureTurnState();
  }

  /* =========================
   *  턴 상태 보장
   * ========================= */
  _ensureTurnState() {
    const b = this.battle;
    if (!b.effects) b.effects = [];

    if (!b.turn) {
      const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
      const lag = lead === "A" ? "B" : "A";
      b.turn = {
        round: 1,
        order: [lead, lag],     // [선공, 후공]
        phaseIndex: 0,
        acted: { A: new Set(), B: new Set() },
        maxTurns: 100,
      };
    } else {
      if (!Array.isArray(b.turn.order) || b.turn.order.length !== 2) {
        const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
        b.turn.order = [lead, lead === "A" ? "B" : "A"];
      }
    }
  }

  /* =========================
   *  전투 행동 처리
   * ========================= */
  processAction(actor, target, logs, updates) {
    // --- 공/방 보정 배수 확보(이 턴 1회) ---
    const atkMulObj = consumeAttackMultiplier(this.battle, actor.id) || { mul: 1 };
    const defMulObj = consumeDefenseMultiplierOnHit(this.battle, target.id) || { mul: 1 };

    // --- 공격치 계산 (회피/피해 공통 기준) ---
    const atkRoll = roll(20);
    const atkScoreRes = computeAttackScore({
      atk: actor?.stats?.attack ?? 0,
      atkRoll,
      atkMul: atkMulObj.mul,
    });
    const attackScore =
      typeof atkScoreRes === "number"
        ? atkScoreRes
        : (atkScoreRes && typeof atkScoreRes.score === "number"
            ? atkScoreRes.score
            : Math.floor((actor?.stats?.attack ?? 0) * (atkMulObj.mul || 1)) + atkRoll);

    // --- 회피 판정 ---
    const evadeRoll = roll(20);
    const evadeScore = (target?.stats?.agility ?? 0) + evadeRoll;

    logs.push({
      type: "combat",
      message: `${actor.name} 공격 시도 → 공격치 ${attackScore}, ${target.name} 회피 판정 ${evadeScore}`,
    });

    if (evadeScore >= attackScore) {
      logs.push({ type: "combat", message: `${target.name} 회피 성공! 피해 없음` });
      return;
    }

    // --- 치명타 판정 (룰 모듈이 crit을 제공하면 우선 사용) ---
    const luck = actor?.stats?.luck ?? 0;
    const critThreshold = 20 - Math.floor(luck / 2);
    const isCritical =
      (atkScoreRes && typeof atkScoreRes.crit === "boolean")
        ? atkScoreRes.crit
        : (atkRoll >= critThreshold);

    // --- 피해 계산 (감산 하한 0, “최소 1” 제거) ---
    const dmgRes = computeDamage({
      atk: actor?.stats?.attack ?? 0,
      def: target?.stats?.defense ?? 0,
      atkRoll,
      crit: isCritical,
      atkMul: atkMulObj.mul,    // 공격 보정기 실제 피해에도 반영
      defMul: defMulObj.mul,    // 방어 보정기 1회성 반영
    });

    // 모듈 방어: 혹시 음수/NaN이 넘어오면 안전 보정
    let dmg = Number(dmgRes?.dmg ?? 0);
    if (!Number.isFinite(dmg)) dmg = 0;
    if (dmg < 0) dmg = 0;

    if (isCritical) {
      logs.push({ type: "combat", message: `치명타 발생!` });
    }

    // --- 피해 적용 ---
    const prevHP = Math.max(0, target.hp || 0);
    const newHP = Math.max(0, prevHP - dmg);
    const actualDamage = prevHP - newHP;

    target.hp = newHP;
    updates.hp[target.id] = newHP;

    logs.push({
      type: "damage",
      message: `${target.name} 피해 ${actualDamage} (${newHP}/${target.maxHp})`,
    });
  }

  /* =========================
   *  아이템 사용 처리
   * ========================= */
  useItem(player, itemKey, targetId, logs, updates) {
    const key = normalizeItemKey(itemKey);
    if (!key) {
      logs.push({ type: "system", message: "알 수 없는 아이템" });
      return;
    }

    const result = applyItemEffect(this.battle, player.id, key, targetId);
    logs.push({ type: "item", message: result.message });

    // 디터니로 HP가 변하면 동기화
    if (result.success && key === "dittany") {
      updates.hp[player.id] = player.hp;
    }
  }
}

export default BattleEngine;
