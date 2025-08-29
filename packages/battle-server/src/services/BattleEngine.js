// packages/battle-server/src/services/BattleEngine.js
const crypto = require('crypto');

function rid(len = 12) { return crypto.randomBytes(len).toString('hex'); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function now() { return Date.now(); }

class BattleEngine {
  constructor(opts = {}) {
    this.opts = Object.assign({ spectatorOtpTtlMs: 30 * 60 * 1000 }, opts);
    this.battles = new Map();
  }

  createBattle(mode = '1v1') {
    const caps = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4 };
    const playersPerTeam = caps[mode] || 1;

    const id = `battle_${rid(6)}`;
    const ts = now();

    const battle = {
      id,
      mode,
      status: 'waiting',
      createdAt: ts,
      startedAt: null,
      endsAt: null,
      teams: { team1: '불사조 기사단', team2: '죽음을 먹는 자들' },

      players: {},
      turn: { turnIndex: 0, frameIndex: 0, framePlan: [], pending: [] },
      chat: [],
      config: { playersPerTeam },

      otp: {
        admin: rid(12),
        spectator: { value: rid(12), issuedAt: ts, ttlMs: this.opts.spectatorOtpTtlMs },
        player: {}
      },

      // pid -> dataURL
      avatars: {}
    };

    this.battles.set(id, battle);
    return battle;
  }

  getBattle(id) { return this.battles.get(id) || null; }

  // players에 avatar를 포함해서 반환
  getPublicState(id) {
    const b = this.getBattle(id);
    if (!b) return null;
    const players = {};
    for (const [pid, p] of Object.entries(b.players)) {
      players[pid] = Object.assign({}, p, { avatar: b.avatars[pid] || null });
    }
    return {
      id: b.id, mode: b.mode, status: b.status,
      createdAt: b.createdAt, startedAt: b.startedAt, endsAt: b.endsAt,
      teams: { team1: b.teams.team1, team2: b.teams.team2 },
      players,
      turn: b.turn,
      chat: b.chat
    };
  }

  adminAuth(id, token) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    if (b.otp.admin !== token) return { ok: false, message: 'OTP 불일치' };
    return { ok: true, state: this.getPublicState(id) };
  }

  spectatorAuth(id, token, name) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    const spec = b.otp.spectator;
    if (!spec || spec.value !== token) return { ok: false, message: 'OTP 불일치' };
    if (spec.issuedAt + (spec.ttlMs || 0) < now()) return { ok: false, message: 'OTP 만료' };
    return { ok: true, state: this.getPublicState(id), spectator: { name } };
  }

  playerAuthByName(id, token, name) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    const p = Object.values(b.players).find(x => x.name === name);
    if (!p) return { ok: false, message: '해당 이름의 플레이어 없음' };
    const pt = b.otp.player[p.id];
    if (!pt || pt !== token) return { ok: false, message: '플레이어 OTP 불일치' };
    return { ok: true, state: this.getPublicState(id), selfPid: p.id };
  }

  addPlayer(id, payload) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작된 전투');

    const { name, team, stats, inventory = [] } = payload || {};
    if (!name || !['team1', 'team2'].includes(team)) throw new Error('이름/팀 필수');

    if (Object.values(b.players).some(p => p.name === name)) throw new Error('중복된 이름');

    const teamCount = Object.values(b.players).filter(p => p.team === team).length;
    if (teamCount >= b.config.playersPerTeam) throw new Error('해당 팀 가득 참');

    const pid = `p_${rid(5)}`;
    const pl = {
      id: pid,
      name,
      team,
      stats: this.normalizeStats(stats),
      inventory: Array.isArray(inventory) ? inventory.slice(0, 12) : [],
      hp: 100, maxHp: 100, alive: true,
      isDefending: false, isDodging: false,
      buffs: {}
    };
    b.players[pid] = pl;
    // avatar는 별도 저장소(b.avatars)에 저장, state에서 합쳐줌
    this.rebuildOrder(b);
    return { ok: true, player: pl };
  }

  removePlayer(id, pid) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작된 전투');
    if (!b.players[pid]) throw new Error('플레이어 없음');
    delete b.players[pid];
    delete b.avatars[pid];
    this.rebuildOrder(b);
    return { ok: true };
  }

  setPlayerAvatar(id, pid, dataUrl) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (!b.players[pid]) throw new Error('플레이어 없음');

    if (typeof dataUrl !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl))
      throw new Error('잘못된 이미지 데이터');

    const approx = Math.ceil(dataUrl.length * 3 / 4);
    if (approx > 2 * 1024 * 1024) throw new Error('이미지 용량 초과 (2MB)');

    b.avatars[pid] = dataUrl;
    return { ok: true };
  }

  generatePlayerLinks(id, publicBaseUrl) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');

    const playerLinks = [];
    for (const p of Object.values(b.players)) {
      const tok = rid(9);
      b.otp.player[p.id] = tok;
      const url = new URL((publicBaseUrl || '').trim() || 'http://localhost');
      url.pathname = '/play';
      url.searchParams.set('battle', id);
      url.searchParams.set('token', tok);
      url.searchParams.set('name', p.name);
      url.searchParams.set('pid', p.id);
      playerLinks.push({ id: p.id, name: p.name, url: url.toString() });
    }

    const wurl = new URL((publicBaseUrl || '').trim() || 'http://localhost');
    wurl.pathname = '/watch';
    wurl.searchParams.set('battle', id);
    wurl.searchParams.set('token', b.otp.spectator.value);
    wurl.searchParams.set('name', '관전자');

    return { ok: true, playerLinks, urls: { watch: wurl.toString() } };
  }

  startBattle(id) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작됨');

    const t1 = Object.values(b.players).filter(p => p.team === 'team1').length;
    const t2 = Object.values(b.players).filter(p => p.team === 'team2').length;
    if (!t1 || !t2) throw new Error('각 팀에 최소 1명 필요');

    b.status = 'ongoing';
    b.startedAt = now();
    this.rebuildOrder(b);
    return { ok: true, state: this.getPublicState(id) };
  }

  pauseBattle(id) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'ongoing') throw new Error('진행중 아님');
    b.status = 'waiting';
    return { ok: true };
  }

  endBattle(id, reason = '종료') {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    b.status = 'ended';
    b.endsAt = now();
    b.chat.push({ type: 'system', text: `[전투 종료] ${reason}`, ts: now() });
    return { ok: true };
  }

  rebuildOrder(b) {
    const t1 = Object.values(b.players).filter(p => p.alive && p.team === 'team1');
    const t2 = Object.values(b.players).filter(p => p.alive && p.team === 'team2');
    const order = [...t1.map(p=>p.id), ...t2.map(p=>p.id)];
    b.turn.framePlan = order;
    b.turn.pending = order.slice();
    b.turn.turnIndex = b.turn.turnIndex || 0;
    b.turn.frameIndex = 0;
  }

  _actor(b) { return b.turn.pending[0] || null; }

  playerAction(id, pid, action) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'ongoing') throw new Error('진행중 아님');

    const actorId = this._actor(b);
    if (!actorId || actorId !== pid) throw new Error('내 차례가 아님');

    const me = b.players[pid];
    if (!me || !me.alive) throw new Error('플레이어 없음');

    const kind = action && action.type;
    if (!kind) throw new Error('행동 타입 없음');

    if (kind === 'attack') {
      const target = b.players[action.targetPid];
      if (!target || !target.alive) throw new Error('대상 없음');
      const atkMul = me.buffs.atk ? 1.5 : 1.0;
      const defMul = target.buffs.def ? 1.5 : 1.0;
      const base = clamp(Math.round(10 + me.stats.attack * 3 * atkMul - target.stats.defense * 2 * defMul), 1, 50);
      const dodge = target.isDodging ? 0.5 : 1.0;
      const dmg = Math.max(0, Math.round(base * dodge));
      target.hp = clamp(target.hp - dmg, 0, target.maxHp);
      if (target.hp === 0) target.alive = false;
      this._log(b, 'action', `${me.name} → ${target.name} 공격 (${dmg})`);
    } else if (kind === 'defend') {
      me.buffs.def = true;
      this._log(b, 'action', `${me.name} 방어 준비`);
    } else if (kind === 'evade') {
      me.isDodging = true;
      this._log(b, 'action', `${me.name} 회피 준비`);
    } else if (kind === 'useItem') {
      const item = action.item;
      if (!['디터니','공격 보정기','방어 보정기'].includes(item)) throw new Error('허용되지 않은 아이템');

      let has = 0;
      if (Array.isArray(me.inventory)) has = me.inventory.filter(x=>x===item).length;
      else if (me.inventory && typeof me.inventory==='object') has = +me.inventory[item] || 0;
      if (!has) throw new Error('아이템 없음');

      const consume = ()=>{
        if (Array.isArray(me.inventory)) {
          const i = me.inventory.indexOf(item);
          if (i>-1) me.inventory.splice(i,1);
        } else { me.inventory[item] = Math.max(0,(+me.inventory[item]||0)-1); }
      };

      if (item==='디터니') {
        const tgt = b.players[action.targetPid] || me;
        if (!tgt || !tgt.alive) throw new Error('대상 없음');
        consume();
        tgt.hp = clamp(tgt.hp + 10, 0, tgt.maxHp);
        this._log(b, 'action', `${me.name} → ${tgt.name} HP +10 회복`);
      } else if (item==='공격 보정기') {
        consume(); me.buffs.atk = true; this._log(b,'action',`${me.name} 공격력 강화(1턴)`);
      } else if (item==='방어 보정기') {
        consume(); me.buffs.def = true; this._log(b,'action',`${me.name} 방어력 강화(1턴)`);
      }
    } else if (kind === 'pass') {
      this._log(b, 'action', `${me.name} 패스`);
    } else {
      throw new Error('알 수 없는 행동');
    }

    b.turn.pending.shift();
    b.turn.frameIndex++;
    if (b.turn.pending.length === 0) {
      b.turn.turnIndex++;
      Object.values(b.players).forEach(p => { p.isDodging=false; p.buffs.atk=false; p.buffs.def=false; });
      this.rebuildOrder(b);
    }
    this._checkEnd(b);
    return { ok:true, state:this.getPublicState(id) };
  }

  pushChat(id, entry) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    b.chat.push(Object.assign({ ts: now() }, entry));
    if (b.chat.length > 500) b.chat.splice(0, b.chat.length - 500);
  }

  normalizeStats(s = {}) {
    return {
      attack: clamp(+s.attack || 3, 1, 10),
      defense: clamp(+s.defense || 3, 1, 10),
      agility: clamp(+s.agility || 3, 1, 10),
      luck: clamp(+s.luck || 3, 1, 10),
    };
  }

  _log(b, type, text) { b.chat.push({ type, text, ts: now() }); }
  _checkEnd(b) {
    const alive1 = Object.values(b.players).some(p=>p.alive && p.team==='team1');
    const alive2 = Object.values(b.players).some(p=>p.alive && p.team==='team2');
    if (!alive1 || !alive2) {
      b.status='ended'; b.endsAt=now();
      const win = alive1 && !alive2 ? '불사조 기사단' : (!alive1 && alive2 ? '죽음을 먹는 자들' : '무승부');
      this._log(b,'system',`경기 종료: ${win}`);
    }
  }
}

module.exports = BattleEngine;
