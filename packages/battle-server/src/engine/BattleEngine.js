// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle Engine - 7학년 모의 전투 규칙 적용
// - 팀 단위 턴제 (선공팀 전원 행동 → 후공팀 전원 행동 → 결과 도출)
// - 공격: 공격력 + D20 - 방어력 (최소 1)
// - 치명타: D20 ≥ (20 - 행운/2) → 2배 피해
// - 회피: 민첩 + D20 ≥ 공격수치 → 완전 회피
// - 방어 태세: 다음 피격 시 방어력 2배 (역공격 없음)
// - 아이템: 디터니(+10 HP), 보정기(10% 성공, 성공시 2배)
// - 팀명: 단순히 "A" / "B"

"use strict";

import { roll } from "../dice.js";
import {
  computeAttackScore,
  computeDamage,
  applyItemEffect,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
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
        order: [lead, lag], // [선공, 후공]
        phaseIndex: 0,
        acted: { A: new Set(), B: new Set() }, // 팀별 행동 완료 ID
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
    const atkRoll = roll(20);
    const attackScore = computeAttackScore({
      atk: actor.stats.attack,
      atkRoll,
      atkMul: consumeAttackMultiplier(this.battle, actor.id).mul,
    });

    const evadeRoll = roll(20);
    const evadeScore = (target.stats?.agility || 0) + evadeRoll;

    logs.push({
      type: "combat",
      message: `${actor.name} 공격 시도 → 공격치 ${attackScore}, ${target.name} 회피 판정 ${evadeScore}`,
    });

    // 회피 성공 → 피해 없음
    if (evadeScore >= attackScore) {
      logs.push({
        type: "combat",
        message: `${target.name} 회피 성공! 피해 없음`,
      });
      return;
    }

    // 치명타 판정
    const critThreshold = 20 - Math.floor((actor.stats?.luck || 0) / 2);
    const isCritical = atkRoll >= critThreshold;

    // 방어 배율 확인
    const defMul = (() => {
      const fx = (this.battle.effects || []).find(
        e => e && e.ownerId === target.id && e.type === "defenseBoost" && e.charges > 0
      );
      if (fx) {
        fx.charges -= 1;
        return fx.factor || 2;
      }
      return 1;
    })();

    consumeDefenseMultiplierOnHit(this.battle, target.id);

    const { dmg } = computeDamage({
      atk: actor.stats.attack,
      def: target.stats.defense,
      atkRoll,
      crit: isCritical,
      atkMul: 1,
      defMul,
    });

    // 치명타 로그
    if (isCritical) {
      logs.push({
        type: "combat",
        message: `치명타 발생!`,
      });
    }

    // 피해 적용
    const newHP = Math.max(0, (target.hp || 0) - dmg);
    const actualDamage = (target.hp || 0) - newHP;
    target.hp = newHP;
    updates.hp[target.id] = newHP;

    logs.push({
      type: "damage",
      message: `${target.name} 피해 ${actualDamage} (${target.hp}/${target.maxHp})`,
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

    if (result.success && key === "dittany") {
      updates.hp[player.id] = player.hp;
    }
  }
}

export default BattleEngine;
