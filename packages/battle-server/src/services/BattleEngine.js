// packages/battle-server/src/services/BattleEngine.js
// 간단 턴제 엔진(1v1/2v2/3v3/4v4). 프레임 단위로 즉시 해석.
// 액션: ATTACK, DEFEND, ITEM(디터니/공격 보정기/방어 보정기), PASS

class BattleEngine {
  constructor(battle, callbacks = {}) {
    this.battle = battle; // { players, teams, status, ... }
    this.cb = {
      onResolve: (logs)=>{},
      onEnd: (reason)=>{},
      ...callbacks
    };
    this.turnIndex = 0;
    this.frameIndex = 0;
    this.framePlan = [];
    this.pending = [];
  }

  onStart() {
    if (this.turnIndex === 0) this.turnIndex = 1;
    this._rebuildPlan();
  }

  forceEnd(reason = '종료') {
    this.cb.onEnd && this.cb.onEnd(reason);
  }

  getTurnPublic() {
    return {
      turnIndex: this.turnIndex,
      frameIndex: this.frameIndex,
      framePlan: this.framePlan.map(f => ({
        pid: f.pid,
        allows: Array.from(f.allows),
        targetable: f.targetable,
        targetTeam: f.targetTeam || null
      })),
      pending: this.pending.slice()
    };
  }

  chooseAction(pid, payload) {
    const b = this.battle;
    if (b.status !== 'ongoing') return { ok:false, error:'invalid_state' };
    const cur = this.framePlan[this.frameIndex];
    if (!cur || cur.pid !== pid) return { ok:false, error:'not_your_turn' };

    const actor = b.players[pid];
    if (!actor || !actor.alive) return { ok:false, error:'actor_dead' };

    const kind = String(payload.kind || '').toUpperCase();
    if (!cur.allows.has(kind)) return { ok:false, error:'action_not_allowed' };

    let logs = [];
    let resolved = false;

    if (kind === 'ATTACK') {
      const target = this._pickTarget(payload.targetId, actor, 'enemy');
      if (!target) return { ok:false, error:'invalid_target' };
      logs.push(...this._doAttack(actor, target));
      resolved = true;
    } else if (kind === 'DEFEND') {
      actor._buffs = actor._buffs || {};
      actor._buffs.guard = 1; // 이번 라운드 1회 피해 경감
      logs.push(`${actor.name} 방어 태세`);
      resolved = true;
    } else if (kind === 'ITEM') {
      const item = String(payload.itemName || '');
      if (!Array.isArray(actor.inventory) || !actor.inventory.includes(item)) {
        return { ok:false, error:'no_item' };
      }
      const t = this._applyItem(actor, item, payload.targetId);
      if (!t.ok) return t;
      logs.push(...t.logs);
      // 소모형 처리
      this._consumeItem(actor, item);
      resolved = true;
    } else if (kind === 'PASS') {
      logs.push(`${actor.name} 패스`);
      resolved = true;
    } else {
      return { ok:false, error:'unknown_action' };
    }

    // 프레임 진행
    this.cb.onResolve && logs.length && this.cb.onResolve(logs);
    this._advanceFrame();

    // 전투 종료 검사
    const endReason = this._checkEnd();
    if (endReason) {
      this.battle.status = 'ended';
      this.cb.onEnd && this.cb.onEnd(endReason);
      return { ok:true, resolved:true };
    }

    return { ok:true, resolved };
  }

  // 내부 구현 --------------------------------------

  _rebuildPlan() {
    const b = this.battle;
    const order = this._frameOrder();
    this.framePlan = order.map(pid => {
      const p = b.players[pid];
      const allows = new Set(['ATTACK','DEFEND','ITEM','PASS']);
      return {
        pid: pid,
        allows,
        targetable: true,
        targetTeam: null // UI에서 전체에서 골라오되, 실제 적용 시 검증
      };
    });
    this.frameIndex = 0;
  }

  _frameOrder() {
    const b = this.battle;
    const aliveByTeam = (team) => Object.values(b.players).filter(p=>p.team===team && p.alive);
    const t1 = aliveByTeam('team1').sort((a,b)=>b.stats.agility - a.stats.agility);
    const t2 = aliveByTeam('team2').sort((a,b)=>b.stats.agility - a.stats.agility);

    const mode = b.mode || '1v1';
    if (mode === '1v1') {
      // 단순 교차
      const o = [];
      if (t1[0]) o.push(t1[0].id);
      if (t2[0]) o.push(t2[0].id);
      return o;
    } else {
      // 팀별 순차: A1, A2, ... -> B1, B2, ...
      return [...t1.map(p=>p.id), ...t2.map(p=>p.id)];
    }
  }

  _advanceFrame() {
    this.frameIndex++;
    if (this.frameIndex >= this.framePlan.length) {
      this.turnIndex++;
      // 버프 턴 감소
      for (const p of Object.values(this.battle.players)) {
        if (!p._buffs) continue;
        if (p._buffs.atkUp) p._buffs.atkUp--;
        if (p._buffs.guard) p._buffs.guard--;
        if (p._buffs.defUp) p._buffs.defUp--;
      }
      this._rebuildPlan();
    }
  }

  _pickTarget(targetId, actor, relation) {
    const b = this.battle;
    const list = Object.values(b.players).filter(p=>p.alive && p.id !== actor.id);
    let cand = null;
    if (typeof targetId === 'string' && targetId) {
      cand = b.players[targetId] || null;
      if (!cand || !cand.alive) cand = null;
    }
    if (!cand && list.length) cand = list.find(p=> relation==='enemy' ? p.team !== actor.team : p.team === actor.team) || list[0];
    if (!cand) return null;
    // 관계 검증
    if (relation === 'enemy' && cand.team === actor.team) return null;
    if (relation === 'ally'  && cand.team !== actor.team) return null;
    return cand;
    }

  _rng(seed) {
    return (Math.sin((Date.now() % 1e9) + seed) + 1) / 2;
  }

  _critChance(luck) {
    return Math.min(0.1 + luck * 0.03, 0.35); // 최대 35%
  }

  _doAttack(attacker, target) {
    attacker._buffs = attacker._buffs || {};
    target._buffs = target._buffs || {};

    const atk = attacker.stats.attack + (attacker._buffs.atkUp ? 1 : 0);
    let def = target.stats.defense + (target._buffs.defUp ? 1 : 0);
    let base = 10 + atk * 2 - def;
    base = Math.max(base, 3);

    // 운에 따른 변동
    const rnd = this._rng(atk + def);
    const luck = attacker.stats.luck || 0;
    const bonus = Math.round(rnd * (2 + luck));
    let dmg = base + bonus;

    // 크리티컬
    if (Math.random() < this._critChance(luck)) {
      dmg = Math.round(dmg * 1.5);
    }

    // 방어 태세 경감
    if (target._buffs.guard > 0) {
      dmg = Math.round(dmg * 0.6);
      target._buffs.guard = 0; // 1회성
    }

    target.hp = Math.max(0, target.hp - dmg);
    const logs = [`${attacker.name} → ${target.name}에게 ${dmg} 피해`];

    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      logs.push(`${target.name} 전투 불능`);
    }
    return logs;
  }

  _applyItem(user, name, targetId) {
    const b = this.battle;
    const logs = [];
    user._buffs = user._buffs || {};
    name = String(name || '').trim();

    if (name === '디터니') {
      const t = this._pickTarget(targetId, user, 'ally');
      if (!t) return { ok:false, error:'invalid_target' };
      const heal = 10;
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + heal);
      if (t.hp > 0) t.alive = true;
      logs.push(`${user.name} 아이템 사용: 디터니 → ${t.name} +${t.hp - before} HP`);
      return { ok:true, logs };
    }
    if (name === '공격 보정기') {
      user._buffs.atkUp = 1;
      logs.push(`${user.name} 아이템 사용: 공격 보정기 (1턴 +공격)`);
      return { ok:true, logs };
    }
    if (name === '방어 보정기') {
      user._buffs.defUp = 1;
      logs.push(`${user.name} 아이템 사용: 방어 보정기 (1턴 +방어)`);
      return { ok:true, logs };
    }
    return { ok:false, error:'unknown_item' };
  }

  _consumeItem(user, name) {
    if (!Array.isArray(user.inventory)) return;
    const idx = user.inventory.indexOf(name);
    if (idx >= 0) user.inventory.splice(idx, 1);
  }

  _checkEnd() {
    const aliveTeam = (team)=>Object.values(this.battle.players).some(p=>p.team===team && p.alive);
    const a1 = aliveTeam('team1');
    const a2 = aliveTeam('team2');
    if (!a1 && !a2) return '양측 전멸';
    if (!a1) return `${this.battle.teams.team1} 전멸`;
    if (!a2) return `${this.battle.teams.team2} 전멸`;
    // 시간 제한
    if (this.battle.endsAt && Date.now() > this.battle.endsAt) return '시간 만료';
    return null;
  }
}

module.exports = BattleEngine;
module.exports.BattleEngine = BattleEngine;
