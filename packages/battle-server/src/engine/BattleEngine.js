// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle Engine (수정판)
// - 방어: 곱연산 제거, '다음 피격 1회' 방어력 +2(가산)로 소모
// - 아이템: 전부 1회용 (성공/실패 무관 즉시 차감)
//   · 디터니: +10 HP (본인/아군, 사망자 불가)
//   · 공격 보정기: 10% 성공 시 그 행동에 한해 공격력 ×2로 즉시 공격
//   · 방어 보정기: 10% 성공 시 '다음 피격 1회' 방어력 +2 부여
// - 공격치 = 공격력 + d20 / 회피: (민첩 + d20) ≥ 공격치 → 0 / 치명타: d20 ≥ 20 - luck/2

"use strict";

export class BattleEngine {
  constructor(battle) {
    this.battle = battle || {};
    this._ensureTurnState();
  }

  /* ───────── 유틸 ───────── */
  _d20() { return Math.floor(Math.random() * 20) + 1; }
  _clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
  _readStats(p){
    const s = p?.stats || {};
    const cv = (v,d)=> this._clamp(Number.isFinite(+v)? Math.floor(+v): d, 1, 5);
    return {
      attack:  cv(s.attack, 3),
      defense: cv(s.defense, 3),
      agility: cv(s.agility, 3),
      luck:    cv(s.luck,   2),
    };
  }
  _ensureEffects(){ if (!Array.isArray(this.battle.effects)) this.battle.effects = []; }
  _findAny(id){ return (this.battle.players || []).find(p => p && p.id === id) || null; }
  _findAlive(id){ const p = this._findAny(id); return p && p.hp > 0 ? p : null; }

  // 방어 보정(+2) 소모
  _defenseFlatAndConsume(defenderId){
    this._ensureEffects();
    let flat = 0;
    for(const fx of this.battle.effects){
      if (fx && fx.ownerId === defenderId && fx.type === "defenseBoost" && (fx.charges||0) > 0){
        flat += (fx.flat ?? 2);
        fx.charges -= 1;
        break;
      }
    }
    this.battle.effects = this.battle.effects.filter(e => (e?.charges||0) > 0);
    return flat;
  }

  _crit(luck, atkRoll){
    const th = 20 - Math.floor(luck/2);
    return atkRoll >= th;
  }

  _ensureTurnState() {
    const b = this.battle;
    if (!b.effects) b.effects = [];
    if (!b.turn) {
      const lead = b.leadingTeam === "A" || b.leadingTeam === "B" ? b.leadingTeam : "A";
      const lag = lead === "A" ? "B" : "A";
      b.turn = {
        round: 1,
        order: [lead, lag],
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

  /* ───────── 행동 처리 ───────── */
  processAction(actor, target, logs, updates) {
    const A = this._readStats(actor);
    const D = this._readStats(target);

    const atkRoll = this._d20();
    const attackScore = A.attack + atkRoll;

    const evadeRoll = this._d20();
    const evadeScore = D.agility + evadeRoll;

    logs.push({ type: "combat", message: `${actor.name} 공격 시도 → 공격치 ${attackScore}, ${target.name} 회피 ${evadeScore}` });

    if (evadeScore >= attackScore) {
      logs.push({ type: "combat", message: `${target.name} 회피 성공! 피해 없음` });
      return;
    }

    const isCrit = this._crit(A.luck, atkRoll);

    const defFlat = this._defenseFlatAndConsume(target.id); // 다음 피격 1회 +2 소모
    const defenseValue = D.defense + defFlat;

    let raw = attackScore - defenseValue;
    if (isCrit) raw *= 2;

    const dmg = Math.max(0, raw);
    const newHP = this._clamp((target.hp||0) - dmg, 0, target.maxHp || 100);
    const actualDamage = (target.hp||0) - newHP;

    target.hp = newHP;
    updates.hp[target.id] = newHP;

    if (isCrit) logs.push({ type: "combat", message: `치명타 발생!` });
    logs.push({
      type: "damage",
      message: `${target.name} 피해 ${actualDamage} (${target.hp}/${target.maxHp})${defFlat? ` / 방어 +${defFlat}`:''}`,
    });
  }

  /* ───────── 아이템 처리 (전부 1회용) ───────── */
  useItem(player, itemKey, targetId, logs, updates) {
    const key = String(itemKey || "").toLowerCase();
    player.items = player.items || { dittany:0, attack_boost:0, defense_boost:0 };
    const have = (k)=> Number(player.items[k]||0) > 0;
    const consume = (k)=> { player.items[k] = Math.max(0, Number(player.items[k]||0) - 1); };

    if (key === "dittany") {
      if (!have("dittany")) { logs.push({ type: "system", message: "디터니가 없습니다" }); return; }
      consume("dittany");

      let tgt = player;
      if (targetId) {
        const c = this._findAny(targetId);
        if (c && c.team === player.team && c.hp > 0) tgt = c;
      }
      if (tgt.hp <= 0) { logs.push({ type: "system", message: "사망자에게는 회복 불가 (디터니 소모됨)" }); return; }

      const maxHp = Math.max(1, tgt.maxHp || 100);
      tgt.hp = this._clamp((tgt.hp||0) + 10, 0, maxHp);
      updates.hp[tgt.id] = tgt.hp;
      logs.push({ type: "item", message: `${player.name} → ${tgt.name}에게 디터니 사용 (+10 HP)` });
      return;
    }

    if (key === "defense_boost") {
      if (!have("defense_boost")) { logs.push({ type:"system", message:"방어 보정기가 없습니다" }); return; }
      consume("defense_boost");

      const ok = Math.random() < 0.10;
      if (!ok) { logs.push({ type:"item", message:"방어 보정기 실패 (소모됨)" }); return; }

      this._ensureEffects();
      this.battle.effects.push({
        ownerId: player.id,
        type: "defenseBoost", // 다음 피격 1회 방어력 +2
        flat: 2,
        charges: 1,
        appliedAt: Date.now(),
        source: "item:defense_boost"
      });
      logs.push({ type:"item", message:`방어 보정기 성공: ${player.name} 다음 피격 시 방어력 +2` });
      return;
    }

    if (key === "attack_boost") {
      if (!have("attack_boost")) { logs.push({ type:"system", message:"공격 보정기가 없습니다" }); return; }
      consume("attack_boost");

      const tgt = targetId ? this._findAny(targetId) : null;
      if (!tgt || tgt.team === player.team || tgt.hp <= 0) {
        logs.push({ type:"system", message:"공격 보정기는 유효한 적 대상이 필요합니다 (소모됨)" });
        return;
      }

      const ok = Math.random() < 0.10;
      if (!ok) { logs.push({ type:"item", message:"공격 보정기 실패 (소모됨)" }); return; }

      // 즉시 보정 공격: 공격력 ×2
      const A = this._readStats(player);
      const D = this._readStats(tgt);

      const atkRoll = this._d20();
      const attackScore = Math.floor(A.attack * 2) + atkRoll;

      const evadeRoll = this._d20();
      const evadeScore = D.agility + evadeRoll;

      if (evadeScore >= attackScore) {
        logs.push({ type:"item", message:`보정 공격 회피됨: ${tgt.name} 회피 성공` });
        return;
      }

      const isCrit = this._crit(A.luck, atkRoll);
      const defFlat = this._defenseFlatAndConsume(tgt.id);
      const defenseValue = D.defense + defFlat;

      let raw = attackScore - defenseValue;
      if (isCrit) raw *= 2;

      const dmg = Math.max(0, raw);
      const newHP = this._clamp((tgt.hp||0) - dmg, 0, tgt.maxHp || 100);
      const actualDamage = (tgt.hp||0) - newHP;
      tgt.hp = newHP;
      updates.hp[tgt.id] = newHP;

      logs.push({
        type:"item",
        message:`공격 보정기 성공! ${player.name} → ${tgt.name} ${actualDamage} 피해${isCrit?' (치명타)':''}${defFlat? ' / 방어 +'+defFlat:''}`
      });
      return;
    }

    logs.push({ type:"system", message:"지원하지 않는 아이템" });
  }
}

export default BattleEngine;
