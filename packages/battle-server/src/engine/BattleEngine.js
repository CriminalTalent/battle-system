// packages/battle-server/src/engine/BattleEngine.js
// BattleEngine (ESM 최종본)
// - 고급 전투 엔진. combat.js와 동일한 resolve 인터페이스 제공
// - 상태키 예시: waiting | active | paused | ended
// - 라운드/페이즈(선공/후공) 관리 + 전투참여자별 1회 행동 체크
// - 규칙/계산은 rules.js의 공식 사용. A팀/B팀 분류 사용

"use strict";

import { rollWithReroll } from "../dice.js";
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
    if (!Array.isArray(b.effects)) b.effects = [];

    // turn 컨테이너 보장
    if (!b.turn) {
      // 외부에서 선공을 지정했을 수 있음: leadingTeam === "A" | "B"
      const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
      const lag = lead === "A" ? "B" : "A";

      b.turn = {
        round: typeof b.round === "number" && b.round > 0 ? b.round : 1,
        order: [lead, lag], // [선공, 후공]
        phaseIndex: 0, // 0: 선공 페이즈, 1: 후공 페이즈
        acted: { A: new Set(), B: new Set() }, // 각 페이즈에서 행동 완료한 전투참여자 ID
        current: null, // 현재 턴 전투참여자 ID
        lastChange: Date.now()
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
      if (!t.lastChange) t.lastChange = Date.now();
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
    // A팀/B팀으로 직접 매핑 (phoenix/eaters 사용하지 않음)
    const players = this.battle.players || [];
    return players.filter((p) => p && p.team === teamAB && p.hp > 0).map((p) => p.id);
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
    
    // 생존자가 모두 행동했는지 체크
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
        logs.push({ type: "system", message: `${this._currentPhaseTeam()}팀 페이즈 시작` });
      } else {
        // 후공 페이즈 종료 → 라운드 종료 및 다음 라운드 준비
        roundCompleted = true;

        // 다음 라운드 선공/후공 스왑
        const first = t.order[0];
        const second = t.order[1];
        t.order = [second, first];

        t.round += 1;
        t.phaseIndex = 0;
        t.acted.A = new Set();
        t.acted.B = new Set();

        // 외부 참고용 leadingTeam 갱신
        this.battle.leadingTeam = t.order[0];
        this.battle.currentTurn = t.round;

        logs.push({
          type: "system",
          message: `${t.round}라운드 시작 (선공: ${this.battle.leadingTeam}팀)`,
        });
      }
      
      t.lastChange = Date.now();
    }

    return { logs, changed, roundCompleted };
  }

  /* =========================
   *  Next Turn Logic
   * ========================= */
  
  _getNextPlayer() {
    const teamAB = this._currentPhaseTeam();
    const aliveIds = this._aliveTeamPlayerIds(teamAB);
    const actedSet = this.battle.turn.acted[teamAB];
    
    // 아직 행동하지 않은 첫 번째 전투참여자 찾기
    for (const id of aliveIds) {
      if (!actedSet.has(id)) {
        const player = this.findAny(id);
        if (player && player.hp > 0) {
          return player;
        }
      }
    }
    return null;
  }

  /* =========================
   *  Public API: processAction(playerId, action)
   *  - combat.js와 동일하게 사용 가능
   * ========================= */
  processAction(playerId, action) {
    this._ensureTurnState();

    const { type, targetId, itemType } = action || {};
    const logs = [];
    const updates = { hp: {} };

    const actor = this.findAlive(playerId);
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

    // 현재 페이즈의 올바른 팀인지 확인 (A팀/B팀)
    const phaseTeamAB = this._currentPhaseTeam();
    const actorTeamAB = actor.team; // 이미 A 또는 B
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

    // 이미 행동한 전투참여자인지 체크
    const actedSet = this.battle.turn.acted[actorTeamAB];
    if (actedSet.has(playerId)) {
      logs.push({ type: "system", message: `${actor.name}는 이미 행동함` });
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

    // === DEFEND === (다음 피격 1회 방어 배율 2배 확정)
    if (kind === "defend") {
      this.ensureEffects();
      this.battle.effects.push({
        ownerId: actor.id,
        type: "defenseBoost",
        factor: 2.0, // 2배 방어력
        charges: 1,
        success: true,
        source: "action:defend",
        appliedAt: Date.now()
      });
      logs.push({ type: "system", message: `${actor.name} 방어 태세 (다음 피격시 2배 방어력)` });

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

    // === DODGE === (다음 피격 1회 회피 판정 +5)
    if (kind === "dodge") {
      this.ensureEffects();
      this.battle.effects.push({
        ownerId: actor.id,
        type: "dodgePrep",
        bonus: 5, // 회피 보너스
        charges: 1,
        success: true,
        source: "action:dodge",
        appliedAt: Date.now()
      });
      logs.push({ type: "system", message: `${actor.name} 회피 준비 (다음 피격시 +5 회피 보너스)` });

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

    // === ITEM === (즉시 적용 시스템)
    if (kind === "item") {
      const key = normalizeItemKey(itemType);
      if (!key) {
        logs.push({ type: "system", message: "알 수 없는 아이템" });
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

      // 아이템 보유 체크
      if (!actor.items || !actor.items[key] || actor.items[key] <= 0) {
        logs.push({ type: "system", message: `${ITEMS[key]?.name || '아이템'}이 부족합니다` });
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

      // 대상 결정
      let target = actor; // 기본값: 자신
      if (targetId) {
        const candidate = this.findAny(targetId);
        if (key === "dittany") {
          // 디터니: 아군만 가능
          if (candidate && candidate.team === actor.team && candidate.hp > 0) {
            target = candidate;
          }
        } else if (key === "attack_boost") {
          // 공격 보정기: 적군만 가능
          if (candidate && candidate.team !== actor.team && candidate.hp > 0) {
            target = candidate;
          } else {
            logs.push({ type: "system", message: "공격 보정기는 적 대상이 필요합니다" });
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
        }
      }

      if (key === "dittany" && target.hp <= 0) {
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

      // 아이템 효과 적용
      const itemResult = applyItemEffect(this.battle, actor.id, key, target.id);
      if (itemResult.success) {
        if (itemResult.attack) {
          // 공격 보정기의 경우 즉시 공격 실행됨
          updates.hp[target.id] = target.hp;
        } else if (itemResult.effect?.type === 'heal') {
          // 디터니의 경우 체력 회복
          updates.hp[target.id] = target.hp;
        }
      }
      
      logs.push({ type: "item", message: itemResult.message });
      if (itemResult.rollDetails) {
        logs.push({ 
          type: "system", 
          message: `아이템 성공률 굴림: ${itemResult.rollDetails.final}/100${itemResult.rollDetails.rerolled ? ' (재굴림 발생)' : ''}` 
        });
      }

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
      if (targetId) {
        const candidate = this.findAny(targetId);
        const isEnemy = candidate && candidate.team !== actor.team;
        target = isEnemy && candidate.hp > 0 ? candidate : null;
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

      // 공격 수치 계산 (재굴림 적용)
      const attackResult = computeAttackScore({
        atk: actor.stats?.attack || 0,
        atkMul: 1
      });
      const attackScore = attackResult.score;

      // 회피 체크 (재굴림 적용)
      const evadeResult = rollWithReroll(20);
      const evadeRoll = evadeResult.final;
      
      // 회피 준비 보너스 적용
      let evasionBonus = 0;
      if (this.hasDodgePrep(target)) {
        evasionBonus = 5;
        this.consumeDodge(target);
      }

      const targetAgility = target.stats?.agility || 0;
      const totalEvasion = targetAgility + evadeRoll + evasionBonus;

      // 회피 성공 체크
      if (totalEvasion >= attackScore) {
        logs.push({
          type: "battle",
          message: evasionBonus > 0
            ? `${target.name}이(가) 준비된 회피로 ${actor.name}의 공격을 피함 (${totalEvasion} vs ${attackScore})`
            : `${target.name}이(가) ${actor.name}의 공격을 회피 (${totalEvasion} vs ${attackScore})`,
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

      // 명중 판정 (재굴림 적용)
      const hitResult = computeHit({
        luk: actor.stats?.luck || 0,
      });

      if (!hitResult.hit) {
        logs.push({
          type: "battle",
          message: `${actor.name}의 공격이 빗나감 (행운 ${actor.stats?.luck || 0} + 주사위 ${hitResult.hitRoll} = ${hitResult.hitScore})`,
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

      // 방어 배율 계산
      const defMul = this.applyDefenseBoostFactor(target).mul || 1;

      // 피해 계산 (재굴림 적용)
      const damageResult = computeDamage({
        atk: actor.stats?.attack || 0,
        def: target.stats?.defense || 0,
        crit: hitResult.crit,
        atkMul: 1,
        defMul,
      });

      const oldHp = target.hp;
      updates.hp[target.id] = Math.max(0, oldHp - damageResult.dmg);

      const defenseInfo = defMul > 1 ? ` (${defMul}배 방어력 적용)` : '';
      logs.push({
        type: "battle",
        message: hitResult.crit
          ? `${actor.name}의 치명타 적중! ${target.name}에게 ${damageResult.dmg} 피해${defenseInfo}`
          : `${actor.name}이(가) ${target.name}에게 ${damageResult.dmg} 피해${defenseInfo}`,
      });

      // 상세 로그
      logs.push({
        type: "system",
        message: `공격 세부사항: 명중 ${hitResult.hitRoll}/20${hitResult.crit ? ' (치명타!)' : ''}, 데미지 ${damageResult.atkRoll}/20${hitResult.rollDetails?.rerolled || damageResult.rollDetails?.rerolled ? ' (재굴림 발생)' : ''}`,
      });

      // 1회성 효과 소모
      consumeAttackMultiplier(this.battle, actor.id);
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
    const nextPlayer = this._getNextPlayer();
    
    return {
      round: t.round,
      order: [...t.order], // ["A","B"]
      phase: t.phaseIndex === 0 ? "lead" : "lag",
      phaseTeam: this._currentPhaseTeam(), // "A" | "B"
      current: nextPlayer ? nextPlayer.id : null,
      nextPlayer: nextPlayer,
      lastChange: t.lastChange
    };
  }

  /* =========================
   *  Effects / Find Helpers
   * ========================= */

  ensureEffects() {
    if (!Array.isArray(this.battle.effects)) this.battle.effects = [];
  }

  applyDefenseBoostFactor(defender) {
    let mul = 1;
    const effects = this.battle.effects || [];
    for (const fx of effects) {
      if (!fx || fx.ownerId !== defender.id || fx.charges <= 0) continue;
      if (fx.type === "defenseBoost") {
        mul *= fx.success ? (fx.factor || 1) : 1;
        fx.charges -= 1;
      }
    }
    // 사용된 효과 제거
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
    const opponents = this.opponentsOf(actor);
    return opponents[0] || null;
  }
}

export default BattleEngine;
