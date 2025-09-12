// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle Engine - 7학년 모의 전투 규칙 완전 적용
// - 팀 단위 턴제 (선공팀 전원 행동 → 후공팀 전원 행동 → 결과 도출)
// - 새로운 계산식: 공격력+D20-방어력, 치명타=D20≥(20-행운/2), 회피=민첩+D20≥공격수치
// - 아이템 효과: 디터니(10 고정), 보정기(10% 성공률, 성공시 2배)
// - 팀명 고정: A팀=불사조 기사단, B팀=죽음을 먹는 자들
// - 100턴 제한, HP 합산 승리 조건

"use strict";

import { roll } from "../dice.js";
import {
  computeAttackPower,
  checkCriticalHit,
  computeHitChance,
  computeDamage,
  applyItemEffect,
  normalizeItemKey,
} from "../rules.js";

export class BattleEngine {
  constructor(battle) {
    this.battle = battle || {};
    this._ensureTurnState();
    this._ensureTeamNames();
  }

  /* =========================
   *  팀명 및 기본 상태 보장
   * ========================= */
  _ensureTeamNames() {
    // 팀명 고정
    if (!this.battle.teamNames) {
      this.battle.teamNames = {
        A: "불사조 기사단",
        B: "죽음을 먹는 자들"
      };
    }
  }

  _ensureTurnState() {
    const b = this.battle;

    // effects 컨테이너
    if (!b.effects) b.effects = [];

    // turn 상태 초기화
    if (!b.turn) {
      // 선공 결정: leadingTeam 또는 기본값 A
      const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
      const lag = lead === "A" ? "B" : "A";

      b.turn = {
        round: typeof b.round === "number" && b.round > 0 ? b.round : 1,
        order: [lead, lag], // [선공, 후공]
        phaseIndex: 0, // 0: 선공 페이즈, 1: 후공 페이즈
        acted: { A: new Set(), B: new Set() }, // 각 페이즈에서 행동 완료한 플레이어 ID
        maxTurns: 100, // 100턴 제한
      };
    } else {
      // 복구 시 Set 객체 복원
      const t = b.turn;
      if (!Array.isArray(t.order) || t.order.length !== 2) {
        const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
        t.order = [lead, lead === "A" ? "B" : "A"];
      }
    }
  }

  /* =========================
   *  전투 처리 (공격/방어/치명타/HP)
   * ========================= */
  processAction(actor, target, baseDamage, totalAttack, isCritical, logs, updates) {
    // 4. 방어 태세 체크
    const defendStance = (this.battle.effects || []).find(e =>
      e && e.ownerId === target.id && e.type === "defendStance" && e.charges > 0
    );

    let finalDamage = baseDamage;
    let counterDamage = 0;

    if (defendStance) {
      // 방어 태세: 방어력 + D20으로 대응
      const defenseRoll = roll(20);
      const totalDefense = (target.defense || 0) + defenseRoll;

      logs.push({
        type: "combat",
        message: `${target.name} 방어 대응: ${target.defense} + D20(${defenseRoll}) = ${totalDefense}`
      });

      // 공격력 vs 방어력 비교
      if (totalDefense >= totalAttack) {
        // 방어 성공 - 공격자가 방어력만큼 피해
        finalDamage = 0;
        counterDamage = Math.max(1, totalDefense - totalAttack);
        logs.push({
          type: "combat",
          message: `방어 성공! ${actor.name}이 ${counterDamage} 피해를 받음`
        });
      } else {
        // 방어 실패 - 서로 피해 (공격력 - 방어력)
        finalDamage = Math.max(1, totalAttack - totalDefense);
        counterDamage = Math.max(1, totalDefense);
        logs.push({
          type: "combat",
          message: `맞대응! ${target.name} ${finalDamage} 피해, ${actor.name} ${counterDamage} 피해`
        });
      }

      defendStance.charges--;
    }

    // 5. 치명타 적용 (방어 태세가 없을 때만)
    if (!defendStance && isCritical) {
      finalDamage = baseDamage * 2;
      logs.push({
        type: "combat",
        message: `치명타! ${baseDamage} × 2 = ${finalDamage}`
      });
    }

    // 6. HP 적용 (피격자)
    if (finalDamage > 0) {
      const newHP = Math.max(0, (target.hp || 0) - finalDamage);
      const actualDamage = (target.hp || 0) - newHP;

      target.hp = newHP;
      updates.hp[target.id] = newHP;

      logs.push({
        type: "damage",
        message: `${target.name}에게 ${actualDamage} 피해! (${target.hp}/${target.maxHP})`
      });
    }

    // 반격 피해 처리 (공격자)
    if (counterDamage > 0) {
      const newHP = Math.max(0, (actor.hp || 0) - counterDamage);
      const actualDamage = (actor.hp || 0) - newHP;

      actor.hp = newHP;
      updates.hp[actor.id] = newHP;

      logs.push({
        type: "damage",
        message: `${actor.name}에게 ${actualDamage} 피해! (${actor.hp}/${actor.maxHP})`
      });
    }
  }
}
