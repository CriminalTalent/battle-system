// BattleEngine: 고급 전투 엔진(선택 사용)
// - resolveAction 을 외부에 제공 (현재 combat.js와 동일 인터페이스)
// - 상태키: waiting | active | paused | ended
// - 규칙/계산 로직은 기존 rules.js 그대로 사용 (룰 변경 없음)
// - 추가: 라운드/페이즈(선공/후공) 상태 추적 및 전환 안정화

"use strict";

const { roll } = require("./dice.js");
const {
  ITEMS,
  normalizeItemKey,
  computeHit,
  computeDamage,
  computeAttackScore,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect
} = require("./rules.js");

class BattleEngine {
  constructor(battle) {
    this.battle = battle;
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
      // 선공팀을 이미 외부에서 정했을 수 있음 (예: b.leadingTeam === "A" | "B")
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

  _otherTeam(team) { return team === "A" ? "B" : "A"; }

  _aliveTeamPlayerIds(team) {
    const players = this.battle.players || [];
    return players.filter(p => p && p.team === team && p.hp > 0).map(p => p.id);
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

        logs.push({ type: "system", message: `라운드 종료 → ${this.battle.turn.round}턴 시작 준비 (선공: ${this.battle.leadingTeam}팀)` });
      }
    }

    return { logs, changed, roundCompleted };
  }

  /* =========================
   *  Public: resolve(action)
   * ========================= */
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
    const phaseTeam = this._currentPhaseTeam();
    if ((actor.team !== phaseTeam)) {
      logs.push({ type: "system", message: `${actor.name}는 지금 턴이 아님` });
      return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
    }

    const kind = String(type || "").toLowerCase();

    // === PASS ===
    if (kind === "pass") {
      logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
      this._markActed(actor.id);
      const phaseStep = this._advancePhaseIfNeeded();
      logs.push(...phaseStep.logs);

      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
        roundCompleted: phaseStep.roundCompleted,
        turn: this._turnReport()
      };
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
      const phaseStep = this._advancePhaseIfNeeded();
      logs.push(...phaseStep.logs);

      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
        roundCompleted: phaseStep.roundCompleted,
        turn: this._turnReport()
      };
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
      const phaseStep = this._advancePhaseIfNeeded();
      logs.push(...phaseStep.logs);

      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
        roundCompleted: phaseStep.roundCompleted,
        turn: this._turnReport()
      };
    }

    // === ITEM ===
    if (kind === "item") {
      const key = normalizeItemKey(action.itemType);
      const target = action.targetId ? this.findAny(action.targetId) : actor;
      if (!target) {
        logs.push({ type: "system", message: "대상이 유효하지 않음" });
        // 행동은 소비된 것으로 간주 (턴 흐름 막지 않음)
        this._markActed(actor.id);
        const phaseStep = this._advancePhaseIfNeeded();
        logs.push(...phaseStep.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
          roundCompleted: phaseStep.roundCompleted,
          turn: this._turnReport()
        };
      }
      if (key === "dittany" && (target.hp || 0) <= 0) {
        logs.push({ type: "system", message: "사망자에게는 회복 불가" });
        this._markActed(actor.id);
        const phaseStep = this._advancePhaseIfNeeded();
        logs.push(...phaseStep.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
          roundCompleted: phaseStep.roundCompleted,
          turn: this._turnReport()
        };
      }

      const itemResult = applyItemEffect(this.battle, { actor, target, itemType: key });
      const { logs: l2, updates: up } = itemResult || {};
      if (Array.isArray(l2)) l2.forEach(x => logs.push(x));
      if (up?.hp) Object.assign(updates.hp, up.hp);

      this._markActed(actor.id);
      const phaseStep = this._advancePhaseIfNeeded();
      logs.push(...phaseStep.logs);

      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
        roundCompleted: phaseStep.roundCompleted,
        turn: this._turnReport()
      };
    }

    // === ATTACK ===
    if (kind === "attack") {
      // 대상 지정이 있을 수 있음(아군 회복/특정 타깃 공격 등의 확장 대비)
      let target = null;
      if (action.targetId) {
        const cand = this.findAny(action.targetId);
        target = (cand && cand.hp > 0 && cand.team !== actor.team) ? cand : null;
      }
      if (!target) {
        target = this.findAliveOpponent(actor);
      }
      if (!target) {
        logs.push({ type: "system", message: "공격 대상이 없음" });
        // 행동은 소비
        this._markActed(actor.id);
        const phaseStep = this._advancePhaseIfNeeded();
        logs.push(...phaseStep.logs);
        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
          roundCompleted: phaseStep.roundCompleted,
          turn: this._turnReport()
        };
      }

      const attackScore = computeAttackScore(actor, this.battle);

      // 회피 보너스 소비
      let evasionBonus = 0;
      if (this.hasDodgePrep(target)) { 
        evasionBonus = 4;
        this.consumeDodge(target);
      }

      const isHit = computeHit({ attacker: actor, defender: target, evasionBonus });
      if (!isHit) {
        logs.push({ type: "battle", message: `${actor.name}의 공격이 빗나감` });

        this._markActed(actor.id);
        const phaseStep = this._advancePhaseIfNeeded();
        logs.push(...phaseStep.logs);

        return {
          logs,
          updates,
          turnEnded: true,
          teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
          roundCompleted: phaseStep.roundCompleted,
          turn: this._turnReport()
        };
      }

      const defMul = this.applyDefenseBoostFactor(target);
      const { dmg, crit } = computeDamage({
        attacker: actor,
        defender: target,
        attackScore,
        defenseMultiplier: defMul
      });

      updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);

      logs.push({
        type: "battle",
        message: crit
          ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해`
          : `${actor.name}가 ${target.name}에게 ${dmg} 피해`
      });

      consumeAttackMultiplier(this.battle, actor);
      consumeDefenseMultiplierOnHit(this.battle, target);

      this._markActed(actor.id);
      const phaseStep = this._advancePhaseIfNeeded();
      logs.push(...phaseStep.logs);

      return {
        logs,
        updates,
        turnEnded: true,
        teamPhaseCompleted: phaseStep.changed && !phaseStep.roundCompleted,
        roundCompleted: phaseStep.roundCompleted,
        turn: this._turnReport()
      };
    }

    // === UNKNOWN ===
    logs.push({ type: "system", message: "알 수 없는 행동" });
    return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
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

  applyDefenseBoostFactor(defender) {
    let mul = 1;
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "defenseBoost") {
        mul *= fx.factor || 1;
        fx.charges -= 1;
      }
    }
    return mul;
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
        return; 
      }
    }
  }

  findAny(id) {
    const players = this.battle.players || [];
    return players.find(p => p && p.id === id) || null;
  }

  findAlive(id) {
    const p = this.findAny(id);
    return p && p.hp > 0 ? p : null;
  }

  opponentsOf(actor) {
    const players = this.battle.players || [];
    return players.filter(p => p && p.team !== actor.team && p.hp > 0);
  }

  findAliveOpponent(actor) {
    const opponents = this.opponentsOf(actor);
    return opponents[0] || null;
  }
}

module.exports = { BattleEngine };
