// packages/battle-server/src/engine/BattleEngine.js
// BattleEngine: 고급 전투 엔진(선택 사용)
// - resolve(action) 을 외부에 제공 (combat.js와 동일 인터페이스로 결과 반환)
// - 상태키: waiting | active | paused | ended
// - 규칙/계산 로직은 rules.js 사용 (룰 변경 없음)
// - 추가: 라운드/페이즈(선공/후공) 상태 추적 및 전환 안정화 (team turn)

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
  EVASION_CHECK
} from "../rules.js";

export class BattleEngine {
  /**
   * @param {Object} battle - 서버 전투 상태 객체(인메모리)
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
      // 외부에서 선공팀(b.leadingTeam)이 정해졌을 수 있음 ("A"|"B")
      const lead = (b.leadingTeam === "A" || b.leadingTeam === "B") ? b.leadingTeam : "A";
      const lag  = (lead === "A") ? "B" : "A";

      b.turn = {
        round: (typeof b.round === "number" && b.round > 0) ? b.round : 1,
        order: [lead, lag],      // [선공, 후공]
        phaseIndex: 0,           // 0: 선공 페이즈, 1: 후공 페이즈
        acted: { A: new Set(), B: new Set() }, // 각 페이즈에서 행동 완료한 ID
      };
    } else {
      // 복구(재시작 등) 시 Set 타입 보장
      const t = b.turn;
      if (!Array.isArray(t.order) || t.order.length !== 2) {
        const lead = (b.leadingTeam === "A" || b.leadingTeam === "B") ? b.leadingTeam : "A";
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
    const abToKey = (ab) => (ab === "A" ? "phoenix" : "eaters"); // 팀 키 변환 규약
    const serverTeamKey = abToKey(teamAB);
    const players = this.battle.players || [];
    return players
      .filter(p => p && p.team === serverTeamKey && (p.hp || 0) > 0)
      .map(p => p.id);
  }

  _markActed(playerId) {
    // 현재 페이즈 팀에 속한 플레이어의 행동을 1회로 카운트
    const team = this._currentPhaseTeam();
    const set = this.battle.turn.acted[team];
    set.add(playerId);
  }

  _isPhaseDone() {
    const phaseTeam = this._currentPhaseTeam();
    const aliveIds = this._aliveTeamPlayerIds(phaseTeam);
    const actedSet = this.battle.turn.acted[phaseTeam];

    // 이미 죽은 플레이어는 카운트 대상 아님. 생존자 전원이 1회 행동하면 페이즈 종료
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
      // 페이즈 전환
      const t = this.battle.turn;
      if (t.phaseIndex === 0) {
        // 선공 페이즈 종료 → 후공 페이즈로
        t.phaseIndex = 1;
        // 후공 페이즈 카운터 초기화
        t.acted[this._currentPhaseTeam()] = new Set();
        changed = true;
        logs.push({ type: "system", message: "후공 페이즈로 전환" });
      } else {
        // 후공 페이즈 종료 → 라운드 종료
        roundCompleted = true;

        // 다음 라운드 준비: 후공이었던 팀이 선공이 되도록 order 스왑
        const tLead = this.battle.turn.order[0];
        const tLag  = this.battle.turn.order[1];
        this.battle.turn.order = [tLag, tLead];

        this.battle.turn.round += 1;
        this.battle.turn.phaseIndex = 0;
        this.battle.turn.acted.A = new Set();
        this.battle.turn.acted.B = new Set();

        // 외부에서 참고할 수 있도록 leadingTeam도 갱신
        this.battle.leadingTeam = this.battle.turn.order[0];

        logs.push({
          type: "system",
          message: `라운드 종료 → ${this.battle.turn.round}턴 시작 준비 (선공: ${this.battle.leadingTeam}팀)`
        });
      }
    }

    return { logs, changed, roundCompleted };
  }

  /* =========================
   *  Public: resolve(action)
   * ========================= */
  /**
   * @param {Object} action - { actorId, type, itemType?, targetId? }
   * @returns {{
   *   logs: Array<{type:string,message:string}>,
   *   updates: { hp: Record<string, number> },
   *   turnEnded: boolean,
   *   teamPhaseCompleted: boolean,
   *   roundCompleted: boolean,
   *   turn: { round:number, order:string[], phase:'lead'|'lag', phaseTeam:'A'|'B' }
   * }}
   */
  resolve(action) {
    this._ensureTurnState();

    const { actorId, type } = action || {};
    const logs = [];
    const updates = { hp: {} };

    const actor = this.findAlive(actorId);
    if (!actor) {
      logs.push({ type: "system", message: "행동 주체가 유효하지 않음" });
      return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
    }

    // 현재 페이즈 팀 체크: 잘못된 팀이 끼어들면 무효
    const phaseTeamAB = this._currentPhaseTeam(); // "A"|"B"
    const abToKey = (ab) => (ab === "A" ? "phoenix" : "eaters");
    if (actor.team !== abToKey(phaseTeamAB)) {
      logs.push({ type: "system", message: `${actor.name}는 지금 턴이 아님` });
      return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
    }

    const kind = String(type || "").toLowerCase();

    // === PASS ===
    if (kind === "pass") {
      logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
      this._markActed(actor.id);
      const phaseStep = this._advanceAndCollect(logs);
      return this._result(logs, updates, true, phaseStep);
    }

    // === DEFEND ===
    if (kind === "defend") {
      this.ensureEffects();
      this.battle.effects.push({
        ownerId: actor.id,
        type: "defenseBoost",
        factor: 1.25, // 기존 유지
        charges: 1,
        success: true,
        source: "action:defend"
      });
      logs.push({ type: "system", message: `${actor.name} 방어 태세` });

      this._markActed(actor.id);
      const phaseStep = this._advanceAndCollect(logs);
      return this._result(logs, updates, true, phaseStep);
    }

    // === DODGE ===
    if (kind === "dodge") {
      this.ensureEffects();
      this.battle.effects.push({
        ownerId: actor.id,
        type: "dodgePrep",
        add: 4,
        charges: 1,
        success: true,
        source: "action:dodge"
      });
      logs.push({ type: "system", message: `${actor.name} 회피 준비` });

      this._markActed(actor.id);
      const phaseStep = this._advanceAndCollect(logs);
      return this._result(logs, updates, true, phaseStep);
    }

    // === ITEM ===
    if (kind === "item") {
      const key = normalizeItemKey(action.itemType);
      const target = action.targetId ? this.findAny(action.targetId) : actor;
      if (!target) {
        logs.push({ type: "system", message: "대상이 유효하지 않음" });
        this._markActed(actor.id);
        const phaseStep = this._advanceAndCollect(logs);
        return this._result(logs, updates, true, phaseStep);
      }
      if (key === "dittany" && (target.hp || 0) <= 0) {
        logs.push({ type: "system", message: "사망자에게는 회복 불가" });
        this._markActed(actor.id);
        const phaseStep = this._advanceAndCollect(logs);
        return this._result(logs, updates, true, phaseStep);
      }

      const itemResult = applyItemEffect(this.battle, { actor, target, itemType: key });
      const { logs: l2, updates: up } = itemResult || {};
      if (Array.isArray(l2)) l2.forEach(x => logs.push(x));
      if (up?.hp) Object.assign(updates.hp, up.hp);

      this._markActed(actor.id);
      const phaseStep = this._advanceAndCollect(logs);
      return this._result(logs, updates, true, phaseStep);
    }

    // === ATTACK ===
    if (kind === "attack") {
      // 대상: 명시 or 자동
      let target = null;
      if (action.targetId) {
        const cand = this.findAny(action.targetId);
        // 상대팀의 생존자만 유효
        if (cand && (cand.hp || 0) > 0 && cand.team !== actor.team) target = cand;
      }
      if (!target) {
        target = this.findAliveOpponent(actor);
      }
      if (!target) {
        logs.push({ type: "system", message: "공격 대상이 없음" });
        this._markActed(actor.id);
        const phaseStep = this._advanceAndCollect(logs);
        return this._result(logs, updates, true, phaseStep);
      }

      // --- rules.js 시그니처에 맞춘 매핑 (stats: attack/defense/agility/luck) ---
      const atk = Number(actor?.stats?.attack || 0);
      const def = Number(target?.stats?.defense || 0);
      const luk = Number(actor?.stats?.luck || 0);
      const agi = Number(target?.stats?.agility || 0);

      // 공격 주사위
      const atkRoll = roll(20);

      // 공격 배율(공격 보정기 성공 시 ×factor) 1회성 소비
      const { mul: atkMul } = consumeAttackMultiplier(this.battle, actor.id);

      // 공격 수치 (회피 비교에 사용)
      const attackScore = computeAttackScore({ atk, atkRoll, atkMul });

      // 회피 보너스(+4) 1회성 소비
      let dodgeBonusAgi = 0;
      if (this.hasDodgePrep(target)) {
        dodgeBonusAgi = 4; // 민첩 가산치로 모델링
        this.consumeDodge(target);
      }

      // 회피 판정: 수비측 (민첩 + d20 [+보너스]) ≥ 공격측 공격수치 → 회피
      const evdRoll = roll(20);
      const defenderAgiForEvasion = agi + dodgeBonusAgi;
      const evaded = EVASION_CHECK(attackScore, defenderAgiForEvasion, evdRoll);
      if (evaded) {
        logs.push({ type: "battle", message: `${actor.name}의 공격이 빗나감` });
        this._markActed(actor.id);
        const phaseStep = this._advanceAndCollect(logs);
        return this._result(logs, updates, true, phaseStep);
      }

      // 명중/치명 판정 (행운 + d20)
      const hitRoll = roll(20);
      const { hit, crit } = computeHit({ luk, hitRoll });
      if (!hit) {
        logs.push({ type: "battle", message: `${actor.name}의 공격이 빗나감` });
        this._markActed(actor.id);
        const phaseStep = this._advanceAndCollect(logs);
        return this._result(logs, updates, true, phaseStep);
      }

      // 방어 배율(방어 보정기 성공 시 ×factor) 1회성 소비
      const { mul: defMul } = consumeDefenseMultiplierOnHit(this.battle, target.id);

      // 피해 계산
      const { dmg } = computeDamage({
        atk,
        def,
        atkRoll,
        crit,
        atkMul,
        defMul
      });

      updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);

      logs.push({
        type: "battle",
        message: crit
          ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해`
          : `${actor.name}가 ${target.name}에게 ${dmg} 피해`
      });

      this._markActed(actor.id);
      const phaseStep = this._advanceAndCollect(logs);
      return this._result(logs, updates, true, phaseStep);
    }

    // === UNKNOWN ===
    logs.push({ type: "system", message: "알 수 없는 행동" });
    return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
  }

  _advanceAndCollect(logs) {
    const phaseStep = this._advancePhaseIfNeeded();
    if (Array.isArray(phaseStep.logs)) logs.push(...phaseStep.logs);
    return phaseStep;
  }

  _result(logs, updates, turnEnded, phaseStep) {
    return {
      logs,
      updates,
      turnEnded: !!turnEnded,
      teamPhaseCompleted: !!(phaseStep?.changed && !phaseStep?.roundCompleted),
      roundCompleted: !!phaseStep?.roundCompleted,
      turn: this._turnReport()
    };
  }

  _turnReport() {
    const t = this.battle.turn;
    return {
      round: t.round,
      order: [...t.order],
      phase: (t.phaseIndex === 0 ? "lead" : "lag"),
      phaseTeam: this._currentPhaseTeam()
    };
  }

  /* =========================
   *  Effects / Find Helpers
   * ========================= */
  ensureEffects() {
    if (!this.battle.effects) this.battle.effects = [];
  }

  hasDodgePrep(defender) {
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || (fx.charges || 0) <= 0) continue;
      if (fx.type === "dodgePrep") return true;
    }
    return false;
  }

  consumeDodge(defender) {
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || (fx.charges || 0) <= 0) continue;
      if (fx.type === "dodgePrep") {
        fx.charges -= 1;
        break;
      }
    }
    // charges 0 정리
    this.battle.effects = effects.filter(e => (e?.charges || 0) > 0);
  }

  findAny(id) {
    const players = this.battle.players || [];
    return players.find(p => p && p.id === id) || null;
  }

  findAlive(id) {
    const p = this.findAny(id);
    return p && (p.hp || 0) > 0 ? p : null;
  }

  opponentsOf(actor) {
    const players = this.battle.players || [];
    return players.filter(p => p && p.team !== actor.team && (p.hp || 0) > 0);
  }

  findAliveOpponent(actor) {
    const opponents = this.opponentsOf(actor);
    return opponents[0] || null;
  }
}

/**
 * 편의 함수: 기존 combat.js와 유사하게 단발 액션만 처리하고 싶을 때 사용
 * @param {Object} battle
 * @param {Object} action
 */
export function resolveActionWithEngine(battle, action) {
  const engine = new BattleEngine(battle);
  return engine.resolve(action);
}
