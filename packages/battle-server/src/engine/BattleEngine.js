// BattleEngine: 고급 전투 엔진(선택 사용)
// - resolveAction 을 외부에 제공 (현재 combat.js와 동일 인터페이스)
// - 상태키: waiting | active | paused | ended

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
  }

  resolve(action) {
    const { actorId, type } = action || {};
    const logs = [];
    const updates = { hp: {} };

    const actor = this.findAlive(actorId);
    if (!actor) {
      logs.push({ type: "system", message: "행동 주체가 유효하지 않음" });
      return { logs, updates, turnEnded: false };
    }

    const kind = String(type || "").toLowerCase();

    if (kind === "pass") {
      logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
      return { logs, updates, turnEnded: true };
    }

    if (kind === "defend") {
      this.ensureEffects();
      this.battle.effects.push({ 
        ownerId: actor.id, 
        type: "defenseBoost", 
        factor: 1.25, 
        charges: 1, 
        success: true, 
        source: "action:defend" 
      });
      logs.push({ type: "system", message: `${actor.name} 방어 태세` });
      return { logs, updates, turnEnded: true };
    }

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
      return { logs, updates, turnEnded: true };
    }

    if (kind === "item") {
      const key = normalizeItemKey(action.itemType);
      const target = action.targetId ? this.findAny(action.targetId) : actor;
      if (!target) {
        logs.push({ type: "system", message: "대상이 유효하지 않음" });
        return { logs, updates, turnEnded: true };
      }
      if (key === "dittany" && target.hp <= 0) {
        logs.push({ type: "system", message: "사망자에게는 회복 불가" });
        return { logs, updates, turnEnded: true };
      }
      
      const itemResult = applyItemEffect(this.battle, { actor, target, itemType: key });
      const { logs: l2, updates: up } = itemResult || {};
      
      if (Array.isArray(l2)) {
        l2.forEach(x => logs.push(x));
      }
      if (up?.hp) {
        Object.assign(updates.hp, up.hp);
      }
      
      return { logs, updates, turnEnded: true };
    }

    if (kind === "attack") {
      const target = this.findAliveOpponent(actor);
      if (!target) {
        logs.push({ type: "system", message: "공격 대상이 없음" });
        return { logs, updates, turnEnded: false };
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
        return { logs, updates, turnEnded: true };
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

      return { logs, updates, turnEnded: true };
    }

    logs.push({ type: "system", message: "알 수 없는 행동" });
    return { logs, updates, turnEnded: false };
  }

  // 보조: 효과/탐색

  ensureEffects() { 
    if (!this.battle.effects) {
      this.battle.effects = []; 
    }
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
