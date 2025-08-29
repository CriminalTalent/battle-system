// packages/battle-server/src/services/BattleEngine.js
// 턴 수집 → 일괄 해석 엔진
// - 1v1: [A 공격] [B 방어] → 해석 → [B 공격] [A 방어] → 해석 반복
// - 2v2: [A1 공격] [A2 공격] [B1 역공] [B2 방어] → 해석 반복
// - 3v3: [A1 공격] [A2 공격] [A3 공격] [B1 역공] [B2 방어] [B3 방어] → 해석
// - 4v4: [A1] [A2] [A3] [A4] 공격 → [B1 역공] [B2 방어] [B3 방어] [B4 방어] → 해석
// - 한쪽 전멸 즉시 종료, 1시간 제한

class BattleEngine {
  /**
   * @param {any} battle
   * @param {{onResolve?:(logs:string[])=>void, onEnd?:(reason:string)=>void}} hooks
   */
  constructor(battle, hooks = {}) {
    this.b = battle;
    this.hooks = hooks;
    this.turnIndex = 0;    // 1부터
    this.frameIndex = 0;   // 현재 턴 내 프레임 인덱스
    this.framePlan = [];   // 현재 턴 프레임 계획
    this.pending = [];     // 현재 턴 수집 액션들
  }

  onStart() {
    this.turnIndex = 1;
    this.frameIndex = 0;
    this.pending = [];
    this._rebuildPlan();
  }

  forceEnd(reason) {
    this.hooks.onEnd && this.hooks.onEnd(reason || 'force_end');
  }

  getTurnPublic() {
    return {
      turnIndex: this.turnIndex,
      frameIndex: this.frameIndex,
      framePlan: this.framePlan.map(f => ({
        pid: f.pid, team: f.team, role: f.role,
        allows: f.allows, targetable: f.targetable, targetTeam: f.targetTeam || null
      })),
      pending: this.pending.map(p => ({
        pid: p.pid, kind: p.kind, targetId: p.targetId || null, itemName: p.itemName || null
      })),
    };
  }

  chooseAction(pid, { kind, targetId, itemName }) {
    const b = this.b;
    const p = b.players[pid];
    if (!p || !p.alive) return { ok: false, error: 'invalid_player' };
    if (b.status !== 'ongoing') return { ok: false, error: 'invalid_state' };

    if (b.endsAt && Date.now() >= b.endsAt) {
      this.hooks.onEnd && this.hooks.onEnd('시간 종료');
      return { ok: false, error: 'time_over' };
    }

    const frame = this.framePlan[this.frameIndex];
    if (!frame || frame.pid !== pid) return { ok: false, error: 'not_your_frame' };
    if (!frame.allows.includes(kind)) return { ok: false, error: 'invalid_action' };

    // 아이템 검사
    if (kind === 'ITEM') {
      if (!itemName || !Array.isArray(p.inventory) || !p.inventory.includes(itemName)) {
        return { ok: false, error: 'no_item' };
      }
    }

    // 타겟 검사
    if (frame.targetable) {
      if (!targetId || !b.players[targetId] || !b.players[targetId].alive) {
        return { ok: false, error: 'invalid_target' };
      }
      if (frame.targetTeam && b.players[targetId].team !== frame.targetTeam) {
        return { ok: false, error: 'target_team_mismatch' };
      }
    }

    // 기록
    this.pending.push({ pid, kind, targetId: targetId || null, itemName: itemName || null, role: frame.role });
    this.frameIndex++;

    let resolved = false;
    if (this.frameIndex >= this.framePlan.length) {
      const logs = this._resolveTurn();
      this.hooks.onResolve && this.hooks.onResolve(logs);
      resolved = true;

      const win = this._checkWin();
      if (win) {
        this.hooks.onEnd && this.hooks.onEnd(win);
      } else if (this.b.endsAt && Date.now() >= this.b.endsAt) {
        this.hooks.onEnd && this.hooks.onEnd('시간 종료');
      } else {
        this.turnIndex++;
        this.frameIndex = 0;
        this.pending = [];
        this._rebuildPlan();
      }
    }

    return { ok: true, pending: this.pending, resolved };
  }

  _rebuildPlan() {
    const b = this.b;
    const t1 = this._aliveTeam('team1');
    const t2 = this._aliveTeam('team2');

    if (b.mode === '1v1') {
      if (t1.length === 0 || t2.length === 0) return this._clearPlan();
      const A = t1[0], B = t2[0];
      if (this.turnIndex % 2 === 1) {
        // A 공격 / B 방어
        this.framePlan = [
          { pid: A.id, team: 'team1', role: 'attacker', allows: ['ATTACK','ITEM','PASS'], targetable: true,  targetTeam: 'team2' },
          { pid: B.id, team: 'team2', role: 'defender', allows: ['DEFEND','ITEM','PASS'], targetable: true,  targetTeam: 'team2' },
        ];
      } else {
        // B 공격 / A 방어
        this.framePlan = [
          { pid: B.id, team: 'team2', role: 'attacker', allows: ['ATTACK','ITEM','PASS'], targetable: true,  targetTeam: 'team1' },
          { pid: A.id, team: 'team1', role: 'defender', allows: ['DEFEND','ITEM','PASS'], targetable: true,  targetTeam: 'team1' },
        ];
      }
      return;
    }

    // 2v2 / 3v3 / 4v4
    const n = b.config.playersPerTeam;
    if (t1.length < n || t2.length < n) return this._clearPlan();

    // 팀1: 전원 공격 프레임
    const planA = t1.slice(0, n).map(P => (
      { pid: P.id, team: 'team1', role: 'attacker', allows: ['ATTACK','ITEM','PASS'], targetable: true, targetTeam: 'team2' }
    ));

    // 팀2: 첫 번째는 역공(공격), 나머지는 방어
    const firstB = { pid: t2[0].id, team: 'team2', role: 'counter', allows: ['ATTACK','ITEM','PASS'], targetable: true, targetTeam: 'team1' };
    const restB = t2.slice(1, n).map(P => (
      { pid: P.id, team: 'team2', role: 'defender', allows: ['DEFEND','ITEM','PASS'], targetable: true, targetTeam: 'team2' }
    ));

    this.framePlan = [...planA, firstB, ...restB];
  }

  _clearPlan() {
    this.framePlan = [];
  }

  _resolveTurn() {
    const b = this.b;
    const logs = [];

    // 아이템 처리(버프/힐)
    const buffs = {}; // pid -> { atk:+, def:+, guard:boolean }
    const heals = []; // { pid, amount }

    const ensure = (pid) => (buffs[pid] || (buffs[pid] = { atk: 0, def: 0, guard: false }));

    for (const act of this.pending) {
      const user = b.players[act.pid];
      if (!user || !user.alive) continue;

      if (act.kind === 'ITEM' && act.itemName) {
        const idx = user.inventory.indexOf(act.itemName);
        if (idx >= 0) user.inventory.splice(idx, 1); // 소비

        if (act.itemName === '디터니') {
          const target = (act.targetId && b.players[act.targetId]) || user;
          if (target && target.alive && target.team === user.team) {
            heals.push({ pid: target.id, amount: 10 });
            logs.push(`${user.name}이(가) ${target.name}에게 디터니 사용(HP +10)`);
          }
        } else if (act.itemName === '공격 보정기') {
          ensure(user.id).atk += 10;
          logs.push(`${user.name} 공격 보정기 사용(이번 턴 공격 +10)`);
        } else if (act.itemName === '방어 보정기') {
          ensure(user.id).def += 10;
          logs.push(`${user.name} 방어 보정기 사용(이번 턴 방어 +10)`);
        }
      } else if (act.kind === 'DEFEND') {
        ensure(user.id).guard = true; // 방어 선택 시 가드
        logs.push(`${user.name} 방어 태세`);
      }
    }

    // 힐 적용
    for (const h of heals) {
      const target = b.players[h.pid];
      if (!target || !target.alive) continue;
      target.hp = Math.min(target.maxHp, target.hp + h.amount);
    }

    // 공격 데미지 집계
    // dmg = max(0, 10 + atk*5 + atkBuff - def*5 - defBuff - guardBonus)
    // guardBonus = 10(방어 선택 시)
    const damages = []; // { toPid, amount, fromPid }
    const attacks = this.pending.filter(a => a.kind === 'ATTACK');

    for (const act of attacks) {
      const A = b.players[act.pid];
      const D = b.players[act.targetId];
      if (!A || !D || !A.alive || !D.alive) continue;

      const ab = ensure(A.id);
      const db = ensure(D.id);
      const guardBonus = db.guard ? 10 : 0;

      const raw = 10 + (A.stats.attack * 5) + ab.atk - (D.stats.defense * 5) - db.def - guardBonus;
      const dmg = Math.max(0, raw);
      if (dmg > 0) {
        damages.push({ toPid: D.id, amount: dmg, fromPid: A.id });
      }
    }

    // 동시 적용
    for (const d of damages) {
      const target = this.b.players[d.toPid];
      if (!target || !target.alive) continue;
      target.hp = Math.max(0, target.hp - d.amount);
      if (target.hp === 0) {
        target.alive = false;
        logs.push(`${target.name} 전투 불능`);
      }
    }

    // 요약 로그
    for (const d of damages) {
      const A = this.b.players[d.fromPid];
      const T = this.b.players[d.toPid];
      if (A && T) logs.push(`${A.name} → ${T.name} ${d.amount} 피해`);
    }

    return logs;
  }

  _checkWin() {
    const a = this._aliveTeam('team1').length;
    const b = this._aliveTeam('team2').length;
    if (a === 0 && b === 0) return '무승부(쌍방 전멸)';
    if (a === 0) return '팀2 승리';
    if (b === 0) return '팀1 승리';
    return null;
  }

  _aliveTeam(team) {
    return Object.values(this.b.players).filter(p => p.team === team && p.alive);
  }
}

module.exports = { BattleEngine };
