"use strict";

/**
 * 고급 전투 엔진
 * - 업로드된 엔진과 동일한 턴/라운드 전환 규칙을 따름
 * - resolve(action) 호출 시 현재 페이즈 팀 외 행동 무시
 * - 라운드 종료 시 직전 후공이 선공이 되도록 교대
 * - 룰 계산(명중/치명/피해/아이템)은 기존 rules.js를 그대로 사용한다는 가정
 */

const {
  ITEMS,
  normalizeItemKey,
  computeHit,
  computeDamage,
  computeAttackScore,
  consumeAttackMultiplier,
  consumeDefenseMultiplierOnHit,
  applyItemEffect
} = require("./rules.js"); // 기존 규칙 모듈 사용

class BattleEngine {
  constructor(battle) {
    this.battle = battle;
    this._ensureTurnState();
  }

  _ensureTurnState() {
    const b = this.battle;
    if (!b.effects) b.effects = [];
    if (!b.turn) {
      const lead = (b.leadingTeam === "A" || b.leadingTeam === "B") ? b.leadingTeam : "A";
      const lag  = (lead === "A") ? "B" : "A";
      b.turn = {
        round: (typeof b.round === "number" && b.round > 0) ? b.round : 1,
        order: [lead, lag],
        phaseIndex: 0,
        acted: { A: new Set(), B: new Set() },
      };
    } else {
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
  _otherTeam(t) { return t === "A" ? "B" : "A"; }
  _aliveTeamPlayerIds(team) {
    const players = this.battle.players || [];
    return players.filter(p => p && p.team === team && p.hp > 0).map(p => p.id);
  }
  _markActed(playerId) {
    const team = this._currentPhaseTeam();
    const set = this.battle.turn.acted[team];
    set.add(playerId);
  }
  _isPhaseDone() {
    const team = this._currentPhaseTeam();
    const aliveIds = this._aliveTeamPlayerIds(team);
    const actedSet = this.battle.turn.acted[team];
    for (const id of aliveIds) { if (!actedSet.has(id)) return false; }
    return true;
  }

  _advancePhaseIfNeeded() {
    const logs = [];
    let changed = false;
    let roundCompleted = false;

    if (!this._isPhaseDone()) return { logs, changed, roundCompleted };

    const t = this.battle.turn;
    if (t.phaseIndex === 0) {
      t.phaseIndex = 1; // 후공으로 전환
      t.acted[this._currentPhaseTeam()] = new Set();
      changed = true;
      logs.push({ type: "system", message: "후공 페이즈로 전환" });
    } else {
      // 라운드 종료 → 선공 교대
      const lead = t.order[0];
      const lag  = t.order[1];
      t.order = [lag, lead];
      t.round += 1;
      t.phaseIndex = 0;
      t.acted.A = new Set();
      t.acted.B = new Set();
      this.battle.leadingTeam = t.order[0];
      roundCompleted = true;
      logs.push({ type: "system", message: `라운드 종료 → ${t.round}턴 시작 준비 (선공 교대)` });
    }

    return { logs, changed, roundCompleted };
  }

  ensureEffects() { if (!this.battle.effects) this.battle.effects = []; }
  applyDefenseBoostFactor(defender) {
    let mul = 1;
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "defenseBoost") { mul *= fx.factor || 1; fx.charges -= 1; }
    }
    return mul;
  }
  hasDodgePrep(defender) {
    const effects = this.battle.effects || [];
    return effects.some(fx => fx && fx.ownerId === defender.id && fx.type === "dodgePrep" && fx.charges > 0);
  }
  consumeDodge(defender) {
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "dodgePrep") { fx.charges -= 1; return; }
    }
  }
  findAny(id) { const ps = this.battle.players || []; return ps.find(p => p && p.id === id) || null; }
  findAlive(id) { const p = this.findAny(id); return p && p.hp > 0 ? p : null; }
  opponentsOf(actor) { const ps = this.battle.players || []; return ps.filter(p => p && p.team !== actor.team && p.hp > 0); }
  findAliveOpponent(actor) { return this.opponentsOf(actor)[0] || null; }

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

    // 현재 페이즈 팀만 행동 가능
    const phaseTeam = this._currentPhaseTeam();
    if (actor.team !== phaseTeam) {
      logs.push({ type: "system", message: `${actor.name}는 지금 턴이 아님` });
      return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
    }

    const kind = String(type || "").toLowerCase();

    if (kind === "pass") {
      logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
      return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
    }

    if (kind === "defend") {
      this.ensureEffects();
      this.battle.effects.push({ ownerId: actor.id, type: "defenseBoost", factor: 1.25, charges: 1, source: "action:defend" });
      logs.push({ type: "system", message: `${actor.name} 방어 태세` });
      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
      return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
    }

    if (kind === "dodge") {
      this.ensureEffects();
      this.battle.effects.push({ ownerId: actor.id, type: "dodgePrep", add: 4, charges: 1, source: "action:dodge" });
      logs.push({ type: "system", message: `${actor.name} 회피 준비` });
      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
      return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
    }

    if (kind === "item") {
      const key = normalizeItemKey(action.itemType);
      const target = action.targetId ? this.findAny(action.targetId) : actor;
      if (!target) {
        logs.push({ type: "system", message: "대상이 유효하지 않음" });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
        return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
      }
      if (key === "dittany" && (target.hp || 0) <= 0) {
        logs.push({ type: "system", message: "사망자에게는 회복 불가" });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
        return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
      }

      const itemResult = applyItemEffect(this.battle, { actor, target, itemType: key });
      const { logs: l2, updates: up } = itemResult || {};
      if (Array.isArray(l2)) l2.forEach(x => logs.push(x));
      if (up?.hp) Object.assign(updates.hp, up.hp);

      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
      return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
    }

    if (kind === "attack") {
      let target = null;
      if (action.targetId) {
        const cand = this.findAny(action.targetId);
        target = (cand && cand.hp > 0 && cand.team !== actor.team) ? cand : null;
      }
      if (!target) target = this.findAliveOpponent(actor);
      if (!target) {
        logs.push({ type: "system", message: "공격 대상이 없음" });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
        return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
      }

      const attackScore = computeAttackScore(actor, this.battle);
      let evasionBonus = 0;
      if (this.hasDodgePrep(target)) { evasionBonus = 4; this.consumeDodge(target); }

      const isHit = computeHit({ attacker: actor, defender: target, evasionBonus });
      if (!isHit) {
        logs.push({ type: "battle", message: `${actor.name}의 공격이 빗나감` });
        this._markActed(actor.id);
        const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
        return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
      }

      const defMul = this.applyDefenseBoostFactor(target);
      const { dmg, crit } = computeDamage({ attacker: actor, defender: target, attackScore, defenseMultiplier: defMul });
      updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);
      logs.push({ type: "battle", message: crit ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해` : `${actor.name}가 ${target.name}에게 ${dmg} 피해` });

      consumeAttackMultiplier(this.battle, actor);
      consumeDefenseMultiplierOnHit(this.battle, target);

      this._markActed(actor.id);
      const step = this._advancePhaseIfNeeded(); logs.push(...step.logs);
      return { logs, updates, turnEnded: true, teamPhaseCompleted: step.changed && !step.roundCompleted, roundCompleted: step.roundCompleted, turn: this._turnReport() };
    }

    logs.push({ type: "system", message: "알 수 없는 행동" });
    return { logs, updates, turnEnded: false, teamPhaseCompleted: false, roundCompleted: false, turn: this._turnReport() };
  }

  _turnReport() {
    const t = this.battle.turn;
    return { round: t.round, order: [...t.order], phase: (t.phaseIndex === 0 ? "lead" : "lag"), phaseTeam: this._currentPhaseTeam() };
  }
}

module.exports = { BattleEngine };
