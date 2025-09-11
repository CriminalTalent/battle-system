// packages/battle-server/src/engine/BattleEngine.js
// BattleEngine (ESM 최종본)
// - 고급 전투 엔진(선택 사용). combat.js와 동일한 resolve 인터페이스 제공
// - 상태키 예시: waiting | active | paused | ended (엔진이 강제하진 않음)
// - 라운드/페이즈(선공/후공) 관리 + 플레이어별 1회 행동 체크
// - 규칙/계산은 rules.js의 공식 사용(룰 변경 없음)

"use strict";

import { roll } from "../dice.js";
import {
  ITEMS,
  normalizeItemKey,
  computeHit,
  computeDamage,
  computeAttackScore,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect,
} from "../rules.js";

export class BattleEngine {
  /**
   * @param {object} battle - 서버가 관리하는 battle 상태 객체 (players, effects 등 포함)
   */
  constructor(battle) {
    this.battle = battle || {};
    this._ensureTurnState();
  }

  /* =========================
   *  Turn/Round State Helpers
   * ========================= */

  _ensureTurnState() {
    const b = this.battle;

    // effects 컨테이너 보장
    if (!b.effects) b.effects = [];

    // turn 컨테이너 보장
    if (!b.turn) {
      // 외부에서 선공을 지정했을 수 있음: leadingTeam === "A" | "B"
      const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
      const lag = lead === "A" ? "B" : "A";

      b.turn = {
        round: typeof b.round === "number" && b.round > 0 ? b.round : 1,
        order: [lead, lag], // [선공, 후공]
        phaseIndex: 0, // 0: 선공 페이즈, 1: 후공 페이즈
        acted: { A: new Set(), B: new Set() }, // 각 페이즈에서 행동 완료한 플레이어 ID
      };
    } else {
      // 복구 시(Set 직렬화 복원 포함) 안전화
      const t = b.turn;
      if (!Array.isArray(t.order) || t.order.length !== 2) {
        const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
        t.order = [lead, lead === "A" ? "B" : "A"];
      }
      if (typeof t.phaseIndex !== "number") t.phaseIndex = 0;
      if (!t.acted) t.acted = { A: new Set(), B: new Set() };
      if (!(t.acted.A instanceof Set)) t.acted.A = new Set(Array.from(t.acted.A || []));
      if (!(t.acted.B instanceof Set)) t.acted.B = new Set(Array.from(t.acted.B || []));
      if (typeof t.round !== "number" || t.round <= 0) t.round = 1;
    }
  }

  _currentPhaseTeam() {
    const { order, phaseIndex } = this.battle.turn;
    return order[phaseIndex]; // "A" | "B"
  }

  _otherTeam(team) {
    return team === "A" ? "B" : "A";
  }

  _aliveTeamPlayerIds(teamAB) {
    const teamKey = teamAB === "A" ? "phoenix" : "eaters"; // A/B ↔ phoenix/eaters 매핑
    const players = this.battle.players || [];
    return players.filter((p) => p && p.team === teamKey && p.hp > 0).map((p) => p.id);
  }

  _markActed(playerId) {
    const teamAB = this._currentPhaseTeam();
    const set = this.battle.turn.acted[teamAB];
    set.add(playerId);
  }

  _isPhaseDone() {
    const teamAB = this._currentPhaseTeam();
    const aliveIds = this._aliveTeamPlayerIds(teamAB);
    const actedSet = this.battle.turn.acted[teamAB];
    for (const id of aliveIds) {
      if (!actedSet.has(id)) return false;
    }
    return true;
  }

  _advancePhaseIfNeeded() {
    const logs = [];
    let changed = false;
    let roundCompleted = false;

    if (this._isPhaseDone()) {
      const t = this.battle.turn;
      if (t.phaseIndex === 0) {
        // 선공 페이즈 종료 → 후공 페이즈
        t.phaseIndex = 1;
        // 후공 페이즈 카운터 초기화
        t.acted[this._currentPhaseTeam()] = new Set();
        changed = true;
        logs.push({ type: "system", message: "후공 페이즈로 전환" });
      } else {
        // 후공 페이즈 종료 → 라운드 종료 및 다음 라운드 준비
        roundCompleted = true;

        // 다음 라운드 선공/후공 스왑
        const first = t.order[0];
        const second = t.order[1];
        this.battle.turn.order = [second, first];

        this.battle.turn.round += 1;
        this.battle.turn.phaseIndex = 0;
        this.battle.turn.acted.A = new Set();
        this.battle.turn.acted.B = new Set();

        // 외부 참고용 leadingTeam 갱신
        this.battle.leadingTeam = this.battle.turn.order[0];

        logs.push({
          type: "system",
          message: `라운드 종료 → ${this.battle.turn.round}턴 시작 준비 (선공: ${this.battle.leadingTeam}팀)`,
        });
      }
    }

    return { logs, changed, roundCompleted };
  }

  /* =========================
   *  Public API: resolve(action)
   *  - combat.js와 동일하게 사용 가능
   * ========================= */
  resolve(action) {
    this._ensureTurnState();

    const { actorId, type } = action || {};
    const logs = [];
    const updates = { hp: {} };

    const actor = this.findAlive(actorId);
    if (!actor) {
      logs.push({ type: "system", message: "행동 주체가 유효하지 않음" });
      return {
        logs,
        updates,
        turnEnded: false,
        teamPhaseCompleted: false,
        roundCompleted: false,
        turn: this._turnReport(),
      };
    }

    // 현재 페이즈의 올바른 팀인지 확인 (A/B ↔ phoenix/eaters)
    const phaseTeamAB = this._currentPhaseTeam();
    const actorTeamAB = actor.team === "phoenix" ? "A" : "B";
    if (actorTeamAB !== phaseTeamAB) {
      logs.push({ type: "system", message: `${actor.name}는 지금 턴이 아님` });
      return {
        logs,
        updates,
        turnEnded: false,
        teamPhaseCompleted: false,
        roundCompleted: false,
        turn: this._turnReport(),
      };
    }

    const kind = String(type || "").toLowerCase();

    // === PASS ===
    if (kind === "pass") {
      logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded();
      logs.push(...step.logs);
      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: step.changed && !step.roundCompleted,
        roundCompleted: step.roundCompleted,
        turn: this._turnReport(),
      };
    }

    // === DEFEND === (다음 피격 1회 방어 배율 +25% 확정)
    if (kind === "defend") {
      this.ensureEffects();
      this.battle.effects.push({
        ownerId: actor.id,
        type: "defenseBoost",
        factor: 1.25,
        charges: 1,
        success: true,
        source: "action:defend",
      });
      logs.push({ type: "system", message: `${actor.name} 방어 태세` });

      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded();
      logs.push(...step.logs);
      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: step.changed && !step.roundCompleted,
        roundCompleted: step.roundCompleted,
        turn: this._turnReport(),
      };
    }

    // === DODGE === (다음 피격 1회 회피 판정 +4)
    if (kind === "dodge") {
      this.ensureEffects();
      this.battle.effects.push({
        ownerId: actor.id,
        type: "dodgePrep",
        add: 4,
        charges: 1,
        success: true,
        source: "action:dodge",
      });
      logs.push({ type: "system", message: `${actor.name} 회피 준비` });

      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded();
      logs.push(...step.logs);
      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: step.changed && !step.roundCompleted,
        roundCompleted: step.roundCompleted,
        turn: this._turnReport(),
      };
    }

    // === ITEM === (attackBoost / defenseBoost / dittany)
    if (kind === "item") {
      const key = normalizeItemKey(action.itemType);
      const target = action.targetId ? this.findAny(action.targetId) : actor;

      if (!target) {
        logs.push({ type: "system", message: "대상이 유효하지 않음" });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded();
        logs.push(...step.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: step.changed && !step.roundCompleted,
          roundCompleted: step.roundCompleted,
          turn: this._turnReport(),
        };
      }
      if (key === "dittany" && (target.hp || 0) <= 0) {
        logs.push({ type: "system", message: "사망자에게는 회복 불가" });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded();
        logs.push(...step.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: step.changed && !step.roundCompleted,
          roundCompleted: step.roundCompleted,
          turn: this._turnReport(),
        };
      }

      const itemResult = applyItemEffect(this.battle, { actor, target, itemType: key });
      const { logs: l2, updates: up } = itemResult || {};
      if (Array.isArray(l2)) l2.forEach((x) => logs.push(x));
      if (up?.hp) Object.assign(updates.hp, up.hp);

      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded();
      logs.push(...step.logs);
      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: step.changed && !step.roundCompleted,
        roundCompleted: step.roundCompleted,
        turn: this._turnReport(),
      };
    }

    // === ATTACK ===
    if (kind === "attack") {
      // 대상 명시가 있으면 검증(상대 생존자만 허용). 없으면 첫 생존 적
      let target = null;
      if (action.targetId) {
        const cand = this.findAny(action.targetId);
        const isEnemy = cand && cand.team !== actor.team;
        target = isEnemy && cand.hp > 0 ? cand : null;
      }
      if (!target) target = this.findAliveOpponent(actor);

      if (!target) {
        logs.push({ type: "system", message: "공격 대상이 없음" });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded();
        logs.push(...step.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: step.changed && !step.roundCompleted,
          roundCompleted: step.roundCompleted,
          turn: this._turnReport(),
        };
      }

      const attackScore = computeAttackScore({
        atk: actor?.stats?.attack ?? actor.atk ?? 0,
        atkRoll: roll(20),
        atkMul: consumeAttackMultiplier(this.battle, actor.id).mul || 1,
      });

      // 회피 준비 보너스(+4) 1회성
      let evasionBonus = 0;
      if (this.hasDodgePrep(target)) {
        evasionBonus = 4;
        this.consumeDodge(target);
      }

      const hitRoll = roll(20);
      const { hit, crit } = computeHit({
        luk: actor?.stats?.luck ?? actor.luk ?? 0,
        hitRoll,
      });

      // 회피 체크(행동/룰 혼합 정책: evasionBonus가 있을 경우 명중 이전에 반영)
      // 기본 규칙은 rules.computeHit만으로 충분하나, dodgePrep(+4)은 추가 보정으로 취급
      const defenderAgi =
        target?.stats?.agility ?? target.agi ?? 0;
      const evdRoll = roll(20) + evasionBonus;
      const fullyEvaded = (defenderAgi + evdRoll) >= attackScore;

      if (!hit || fullyEvaded) {
        logs.push({
          type: "battle",
          message: !hit
            ? `${actor.name}의 공격이 빗나감`
            : `${target.name}이(가) 민첩하게 회피`,
        });

        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded();
        logs.push(...step.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: step.changed && !step.roundCompleted,
          roundCompleted: step.roundCompleted,
          turn: this._turnReport(),
        };
      }

      // 방어 배율(방어 태세/보정기 성공 시 적용)
      const defMul = this.applyDefenseBoostFactor(target).mul || 1;

      const { dmg } = computeDamage({
        atk: actor?.stats?.attack ?? actor.atk ?? 0,
        def: target?.stats?.defense ?? target.def ?? 0,
        atkRoll: 0, // 위에서 attackScore에 반영됨
        crit,
        atkMul: 1, // 이미 attackScore에 반영
        defMul,
      });

      updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);

      logs.push({
        type: "battle",
        message: crit
          ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해`
          : `${actor.name}가 ${target.name}에게 ${dmg} 피해`,
      });

      // 1회성 효과 소모(방어 측은 피격 시 소모)
      consumeDefenseMultiplierOnHit(this.battle, target.id);

      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded();
      logs.push(...step.logs);
      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: step.changed && !step.roundCompleted,
        roundCompleted: step.roundCompleted,
        turn: this._turnReport(),
      };
    }

    // === UNKNOWN ===
    logs.push({ type: "system", message: "알 수 없는 행동" });
    return {
      logs,
      updates,
      turnEnded: false,
      teamPhaseCompleted: false,
      roundCompleted: false,
      turn: this._turnReport(),
    };
  }

  _turnReport() {
    const t = this.battle.turn;
    return {
      round: t.round,
      order: [...t.order], // ["A","B"]
      phase: t.phaseIndex === 0 ? "lead" : "lag",
      phaseTeam: this._currentPhaseTeam(), // "A" | "B"
    };
  }

  /* =========================
   *  Effects / Find Helpers
   * ========================= */

  ensureEffects() {
    if (!this.battle.effects) this.battle.effects = [];
  }

  applyDefenseBoostFactor(defender) {
    let mul = 1;
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "defenseBoost") {
        // action:defend 의 확정 + 아이템 성공 여부 동시 고려
        mul *= fx.success ? (fx.factor || 1) : 1;
        fx.charges -= 1;
      }
    }
    // 찌꺼기 정리
    this.battle.effects = effects.filter((e) => (e?.charges || 0) > 0);
    return { mul };
  }

  hasDodgePrep(defender) {
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "dodgePrep") return true;
    }
    return false;
  }

  consumeDodge(defender) {
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "dodgePrep") {
        fx.charges -= 1;
        break;
      }
    }
    this.battle.effects = effects.filter((e) => (e?.charges || 0) > 0);
  }

  findAny(id) {
    const players = this.battle.players || [];
    return players.find((p) => p && p.id === id) || null;
  }

  findAlive(id) {
    const p = this.findAny(id);
    return p && p.hp > 0 ? p : null;
  }

  opponentsOf(actor) {
    const players = this.battle.players || [];
    return players.filter((p) => p && p.team !== actor.team && p.hp > 0);
  }

  findAliveOpponent(actor) {
    const opp = this.opponentsOf(actor);
    return opp[0] || null;
  }
}

export default BattleEngine;
