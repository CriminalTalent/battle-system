// packages/battle-server/src/services/BattleEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// PYXIS BattleEngine (server-agnostic, KR)
// - 팀: team1('불사조 기사단') / team2('죽음을 먹는 자들')
// - 규칙: 명중/치명(d20), 가드/회피, 보정기/디터니, 페이즈(A→B→라운드+1)
// - 타이머: 전투 1시간(틱 1초), 미응답 5분(자동 패스)
// - OTP: 관리자 60분, 플레이어 30분, 관전자 30분(풀/상한)
// - 퍼블릭 상태: 통합 server.js와 동일 포맷(players map/turn.pending 등)
// - 콜백: onState/onLog/onPhase/onTimer/onEnd
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = () => Date.now();
const d20 = () => Math.floor(Math.random() * 20) + 1;

class BattleEngine {
  /**
   * @param {object} opts
   * @param {number} opts.battleDurationMs - 전투 전체 시간(기본 1h)
   * @param {number} opts.inactivityMs - 미응답 자동 패스 시간(기본 5m)
   * @param {number} opts.spectatorLimit - 관전자 동시 접속 제한
   * @param {number} opts.playerOtpTtlMs - 플레이어 OTP TTL
   * @param {number} opts.adminOtpTtlMs - 관리자 OTP TTL
   * @param {number} opts.spectatorOtpTtlMs - 관전자 OTP TTL
   */
  constructor(opts = {}) {
    this.opts = Object.assign({
      battleDurationMs: 60 * 60 * 1000,
      inactivityMs: 5 * 60 * 1000,
      spectatorLimit: 30,
      playerOtpTtlMs: 30 * 60 * 1000,
      adminOtpTtlMs: 60 * 60 * 1000,
      spectatorOtpTtlMs: 30 * 60 * 1000,
    }, opts);

    this.battles = new Map(); // id -> state
    this._timers = new Map(); // id -> interval
    this._inactivity = new Map(); // id -> Map(pid -> timeout)
    this._callbacks = new Map(); // id -> {onState,onLog,onPhase,onTimer,onEnd}
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Battle lifecycle
  // ───────────────────────────────────────────────────────────────────────────
  createBattle(mode = '1v1') {
    const caps = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4 };
    const playersPerTeam = caps[mode] || 1;

    const id = `battle_${rid(6)}`;
    const ts = now();

    const adminOtp = { value: rid(8), exp: ts + this.opts.adminOtpTtlMs };
    const specOtp = { value: rid(8), exp: ts + this.opts.spectatorOtpTtlMs }; // 1개 편의 제공
    const watcherPool = new Map([[specOtp.value, specOtp.exp]]); // token -> exp

    const battle = {
      id, mode,
      status: 'waiting',     // waiting|ongoing|ended
      createdAt: ts,
      startedAt: null,
      endsAt: null,
      timerEnd: null,

      teams: { team1: '불사조 기사단', team2: '죽음을 먹는 자들' },
      config: { playersPerTeam, spectatorLimit: this.opts.spectatorLimit },

      players: {},           // pid -> model
      avatars: {},           // pid -> url(dataUrl or static url)

      // phase model(A/B 팀 페이즈)
      round: 1,
      phase: 'team1',        // team1 -> team2 -> round++
      acted: { team1: new Set(), team2: new Set() },
      turn: { pending: [] }, // 현재 페이즈에서 아직 행동 안한 플레이어 pid 배열

      chat: [],              // {type,text,ts, ...}

      otp: {
        admin: adminOtp,
        player: new Map(),   // pid -> {value,exp}
        spectatorPool: watcherPool
      }
    };

    this.battles.set(id, battle);
    this._inactivity.set(id, new Map());
    return battle;
  }

  setCallbacks(id, cbs = {}) {
    this._callbacks.set(id, Object.assign({
      onState: () => {},
      onLog: () => {},
      onPhase: () => {},
      onTimer: () => {},
      onEnd: () => {},
    }, cbs));
  }

  getBattle(id) { return this.battles.get(id) || null; }

  // ───────────────────────────────────────────────────────────────────────────
  // Auth & OTP
  // ───────────────────────────────────────────────────────────────────────────
  _validOtp(obj) { return obj && obj.exp > now(); }

  adminAuth(id, token) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    if (!b.otp.admin || b.otp.admin.value !== String(token) || !this._validOtp(b.otp.admin))
      return { ok: false, message: '관리자 OTP 불일치/만료' };
    return { ok: true, state: this.getPublicState(id) };
  }

  spectatorClaim(id, token) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    const exp = b.otp.spectatorPool.get(String(token));
    if (!exp || exp <= now()) return { ok:false, message:'관전자 OTP 불일치/만료' };
    if (b.otp.spectatorPool.size > this.opts.spectatorLimit) return { ok:false, message:'관전자 한도 초과' };
    // 1회용 소모(재사용 방지)
    b.otp.spectatorPool.delete(String(token));
    return { ok:true, state: this.getPublicState(id) };
  }

  issueSpectatorOtp(id) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.otp.spectatorPool.size >= this.opts.spectatorLimit) throw new Error('관전자 한도 초과');
    const tok = rid(8);
    b.otp.spectatorPool.set(tok, now() + this.opts.spectatorOtpTtlMs);
    return tok;
  }

  generatePlayerOtp(id, pid) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (!b.players[pid]) throw new Error('플레이어 없음');
    const tok = { value: rid(9), exp: now() + this.opts.playerOtpTtlMs };
    b.otp.player.set(pid, tok);
    return tok;
  }

  playerAuthByName(id, token, name) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    const p = Object.values(b.players).find(x => x.name === name);
    if (!p) return { ok: false, message: '해당 이름의 플레이어 없음' };
    const pt = b.otp.player.get(p.id);
    if (!pt || pt.value !== String(token) || !this._validOtp(pt))
      return { ok: false, message: '플레이어 OTP 불일치/만료' };
    return { ok: true, state: this.getPublicState(id), selfPid: p.id };
  }

  playerAuthByPid(id, token, pid) {
    const b = this.getBattle(id);
    if (!b) return { ok: false, message: '전투 없음' };
    const p = b.players[pid];
    if (!p) return { ok: false, message: '플레이어 없음' };
    const pt = b.otp.player.get(pid);
    if (!pt || pt.value !== String(token) || !this._validOtp(pt))
      return { ok: false, message: '플레이어 OTP 불일치/만료' };
    return { ok: true, state: this.getPublicState(id), selfPid: p.id };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Players
  // ───────────────────────────────────────────────────────────────────────────
  addPlayer(id, payload) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작된 전투');

    const { name, team, stats, inventory = [], avatar } = payload || {};
    if (!name || !['team1', 'team2'].includes(team)) throw new Error('이름/팀 필수');

    if (Object.values(b.players).some(p => p.name === name)) throw new Error('중복된 이름');
    const teamCount = Object.values(b.players).filter(p => p.team === team).length;
    if (teamCount >= b.config.playersPerTeam) throw new Error('해당 팀 가득 참');

    const pid = `p_${rid(5)}`;
    const s = this.normalizeStats(stats);

    const inv = Array.isArray(inventory) ? inventory : [];
    const model = {
      id: pid, name, team,
      hp: 1000, maxHp: 1000, alive: true,
      atk: s.attack, def: s.defense, agi: s.agility, luk: s.luck,
      items: {
        atkBoost: inv.filter(x=>x==='공격 보정기').length,
        defBoost: inv.filter(x=>x==='방어 보정기').length,
        dittany:  inv.filter(x=>x==='디터니').length,
      },
      stance: null,
      effects: { atkBoostTurns:0, defBoostTurns:0 },
      avatar: typeof avatar==='string' ? avatar : ''
    };

    b.players[pid] = model;
    if (avatar) b.avatars[pid] = avatar;

    // OTP 1개 발급(편의)
    this.generatePlayerOtp(id, pid);

    this._rebuildPhase(b);  // 페이즈 대기열 재구성
    this._emitState(b);
    return { ok: true, player: this._pubPlayer(model) };
  }

  removePlayer(id, pid) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작된 전투');
    if (!b.players[pid]) throw new Error('플레이어 없음');

    delete b.players[pid];
    delete b.avatars[pid];
    b.otp.player.delete(pid);
    this._rebuildPhase(b);
    this._emitState(b);
    return { ok: true };
  }

  setPlayerAvatar(id, pid, url) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (!b.players[pid]) throw new Error('플레이어 없음');
    if (typeof url !== 'string' || !url.length) throw new Error('잘못된 이미지 URL');
    // 용량 검증은 업로드 레이어에서
    b.players[pid].avatar = url;
    b.avatars[pid] = url;
    this._emitState(b);
    return { ok: true };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Battle flow
  // ───────────────────────────────────────────────────────────────────────────
  startBattle(id) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'waiting') throw new Error('이미 시작됨');

    const t1 = Object.values(b.players).filter(p => p.team === 'team1').length;
    const t2 = Object.values(b.players).filter(p => p.team === 'team2').length;
    if (!t1 || !t2) throw new Error('각 팀에 최소 1명 필요');

    b.status = 'ongoing';
    b.startedAt = now();
    b.timerEnd = now() + this.opts.battleDurationMs;
    b.round = 1;
    b.acted.team1.clear(); b.acted.team2.clear();

    this._decideInitiative(b); // phase 결정
    this._rebuildPhase(b);
    this._startTimer(b);

    this._emitPhase(b, { initiative: true });
    this._emitState(b);
    return { ok: true, state: this.getPublicState(id) };
  }

  pauseBattle(id) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'ongoing') throw new Error('진행중 아님');
    b.status = 'waiting';
    this._stopTimer(b);
    this._emitState(b);
    return { ok: true };
  }

  endBattle(id, reason = '종료') {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status === 'ended') return { ok: true };

    b.status = 'ended';
    b.endsAt = now();
    this._stopTimer(b);
    this._clearAllInactivity(b);

    this._log(b, 'system', `[전투 종료] ${reason}`);
    this._emitEnd(b, { reason });
    this._emitState(b);
    return { ok: true };
  }

  // ── 행동 처리
  playerAction(id, pid, action) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    if (b.status !== 'ongoing') throw new Error('진행중 아님');

    const isMyTurn = b.turn.pending[0] === pid || b.turn.pending.includes(pid);
    // 같은 페이즈라면 순서 상관없이 '아직 미행동'이면 허용 (서버/프론트 통합 정책)
    if (!isMyTurn) throw new Error('내 페이즈에 없는 플레이어');

    const me = b.players[pid];
    if (!me || !me.alive) throw new Error('플레이어 없음');

    // 이미 행동했다면 차단
    if (b.acted[me.team].has(pid)) throw new Error('이미 행동함');

    // 지속턴 감소(행동 시점에 감소)
    if (me.effects.atkBoostTurns>0) me.effects.atkBoostTurns--;
    if (me.effects.defBoostTurns>0) me.effects.defBoostTurns--;

    const kind = action?.type;
    if (!kind) throw new Error('행동 타입 없음');

    if (kind === 'attack') {
      const target = b.players[action?.targetPid];
      if (!target || !target.alive) throw new Error('대상 없음');

      const hit = this._calcHit(me, target);
      if (!hit) {
        this._log(b, 'action', `${me.name}의 공격을 ${target.name}이(가) 회피!`);
      } else {
        const crit = this._calcCrit(me);
        const atkMul = (me.effects.atkBoostTurns>0) ? 1.5 : 1.0;
        const defMul = (target.effects.defBoostTurns>0) ? 1.5 : 1.0;
        let dmg = this._baseDamage(me, target, atkMul, defMul);
        if (crit) dmg *= 2;
        dmg = Math.round(dmg);
        const dealt = this._applyDamage(target, dmg, me);
        this._log(b, 'action', `${me.name} → ${target.name} : ${dealt} 피해${crit?' (치명타)':''}`);
      }
    }
    else if (kind === 'defend') {
      me.stance = 'guard';
      me.effects.defBoostTurns = 1;
      this._log(b, 'action', `${me.name} 방어 태세`);
    }
    else if (kind === 'evade') {
      me.stance = 'evade';
      this._log(b, 'action', `${me.name} 회피 태세`);
    }
    else if (kind === 'useItem') {
      const item = action?.item;
      if (!item) throw new Error('아이템 지정 없음');

      if (item === '공격 보정기' || item === 'atkBoost') {
        if (me.items.atkBoost<=0) throw new Error('재고 없음');
        me.items.atkBoost--;
        const success = (Math.random() < 0.10);
        if (success) me.effects.atkBoostTurns = 1;
        this._log(b,'item',`${me.name} 공격 보정기 사용 → ${success?'성공(1턴 ×1.5)':'실패(소모됨)'}`);
      } else if (item === '방어 보정기' || item === 'defBoost') {
        if (me.items.defBoost<=0) throw new Error('재고 없음');
        me.items.defBoost--;
        const success = (Math.random() < 0.10);
        if (success) me.effects.defBoostTurns = 1;
        this._log(b,'item',`${me.name} 방어 보정기 사용 → ${success?'성공(1턴 ×1.5)':'실패(소모됨)'}`);
      } else if (item === '디터니' || item === 'dittany') {
        if (me.items.dittany<=0) throw new Error('재고 없음');
        me.items.dittany--;
        const tgt = b.players[action?.targetPid] || me;
        if (!tgt || !tgt.alive) throw new Error('회복 대상 없음');
        tgt.hp = clamp(tgt.hp + 10, 0, tgt.maxHp);
        this._log(b,'item',`${me.name} → ${tgt.name} HP +10 회복`);
      } else {
        throw new Error('알 수 없는 아이템');
      }
    }
    else if (kind === 'pass') {
      this._log(b, 'action', `${me.name} 패스`);
    }
    else {
      throw new Error('알 수 없는 행동');
    }

    // 행동 완료 처리
    this._markActed(b, pid);
    this._emitState(b);

    // 페이즈 종료/전환 체크
    if (!this._checkEnd(b)) {
      this._armPhaseInactivity(b); // 남은 팀원 타이머 재무장
    }
    return { ok: true, state: this.getPublicState(id) };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Chat
  // ───────────────────────────────────────────────────────────────────────────
  pushChat(id, entry) {
    const b = this.getBattle(id);
    if (!b) throw new Error('전투 없음');
    b.chat.unshift(Object.assign({ ts: now() }, entry));
    if (b.chat.length > 500) b.chat = b.chat.slice(0, 500);
    this._emitState(b);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public State
  // ───────────────────────────────────────────────────────────────────────────
  getPublicState(id) {
    const b = this.getBattle(id);
    if (!b) return null;

    const players = {};
    for (const p of Object.values(b.players)) {
      players[p.id] = this._pubPlayer(p);
    }
    return {
      id: b.id,
      mode: b.mode,
      status: b.status,
      round: b.round,
      phase: b.phase,
      timerEnd: b.timerEnd,
      players,
      turn: { pending: Array.from(b.turn.pending) },
      chat: b.chat.slice(0, 100),
      teams: [
        { side:'A', name: b.teams.team1, players: Object.values(b.players).filter(x=>x.team==='team1').map(x=>this._pubLegacy(x)) },
        { side:'B', name: b.teams.team2, players: Object.values(b.players).filter(x=>x.team==='team2').map(x=>this._pubLegacy(x)) },
      ]
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────
  normalizeStats(s = {}) {
    return {
      attack: clamp(+s.attack || 3, 1, 10),
      defense: clamp(+s.defense || 3, 1, 10),
      agility: clamp(+s.agility || 3, 1, 10),
      luck: clamp(+s.luck || 3, 1, 10),
    };
  }

  _pubPlayer(p) {
    return {
      id: p.id, name: p.name,
      team: p.team,
      hp: p.hp, maxHp: p.maxHp,
      stats: { attack: p.atk, defense: p.def, agility: p.agi, luck: p.luk },
      alive: p.alive,
      avatar: p.avatar || null
    };
    // (프런트 호환: server.js publicState와 동일 키)
  }
  _pubLegacy(p) {
    return { id:p.id, name:p.name, hp:p.hp, atk:p.atk, def:p.def, agi:p.agi, luk:p.luk, avatar:p.avatar||'' };
  }

  _log(b, type, text) {
    const line = { type, text, ts: now() };
    b.chat.unshift(line);
    b.chat = b.chat.slice(0, 500);
    const cb = this._callbacks.get(b.id);
    cb?.onLog?.(line);
  }

  _emitState(b) {
    const cb = this._callbacks.get(b.id);
    cb?.onState?.(this.getPublicState(b.id));
  }
  _emitPhase(b, extra = {}) {
    const cb = this._callbacks.get(b.id);
    cb?.onPhase?.({ phase: b.phase, round: b.round, ...extra });
  }
  _emitTimer(b, payload) {
    const cb = this._callbacks.get(b.id);
    cb?.onTimer?.(payload);
  }
  _emitEnd(b, payload) {
    const cb = this._callbacks.get(b.id);
    cb?.onEnd?.(payload);
  }

  _decideInitiative(b) {
    const sumAgi = (team) => Object.values(b.players).filter(p=>p.alive && p.team===team).reduce((s,p)=>s+p.agi,0);
    let a = sumAgi('team1') + d20();
    let c = sumAgi('team2') + d20();
    while (a === c) { a = sumAgi('team1') + d20(); c = sumAgi('team2') + d20(); }
    b.phase = (a > c) ? 'team1' : 'team2';
  }

  _rebuildPhase(b) {
    const aliveTeam = Object.values(b.players).filter(p=>p.alive && p.team===b.phase);
    b.turn.pending = aliveTeam.map(p=>p.id).filter(pid => !b.acted[b.phase].has(pid));
  }

  _markActed(b, pid) {
    const me = b.players[pid];
    if (!me) return;

    b.acted[me.team].add(pid);
    // 미응답 타이머 해제
    this._clearInactivity(b, pid);

    // 현재 페이즈에서 더 남았는지 확인
    this._rebuildPhase(b);

    if (b.turn.pending.length === 0) {
      // 다음 페이즈 전환
      if (b.phase === 'team1') {
        b.phase = 'team2';
        b.acted.team2.clear();
      } else {
        b.phase = 'team1';
        b.acted.team1.clear();
        b.round += 1;
      }
      this._rebuildPhase(b);
      this._emitPhase(b, {});
    }
  }

  _calcHit(att, def) {
    const hitRoll = att.luk + d20();
    const dodgeRoll = def.agi + d20();
    return hitRoll >= dodgeRoll;
  }
  _calcCrit(att) {
    const r = d20();
    return r >= (20 - att.luk / 2);
  }
  _baseDamage(att, def, atkBoost=1, defBoost=1) {
    const roll = d20();
    const atk = Math.round(att.atk * atkBoost);
    const dfs = Math.round(def.def * defBoost);
    const raw = atk + roll - dfs;
    return Math.max(1, raw);
  }
  _applyDamage(target, amount, attacker) {
    // guard: 추가 피해감소
    if (target.stance === 'guard') {
      const guardRoll = target.agi + d20() - attacker.atk;
      const reduce = Math.max(0, Math.floor(guardRoll));
      amount = Math.max(0, amount - reduce);
    }
    // evade: 완전 회피 가능
    if (target.stance === 'evade') {
      const success = (target.agi + d20()) >= attacker.atk;
      if (success) amount = 0;
    }
    target.hp = clamp(target.hp - amount, 0, target.maxHp);
    if (target.hp === 0) target.alive = false;
    return amount;
  }

  _checkEnd(b) {
    const alive1 = Object.values(b.players).some(p=>p.alive && p.team==='team1');
    const alive2 = Object.values(b.players).some(p=>p.alive && p.team==='team2');
    const timeup = b.timerEnd && now() >= b.timerEnd;
    if (!alive1 || !alive2 || timeup) {
      // 점수로 승부 가를 수 있게 남겨둠(동률 무승부)
      const sumHP = (team) => Object.values(b.players).filter(p=>p.team===team).reduce((s,p)=>s+Math.max(0,p.hp),0);
      const score1 = sumHP('team1'), score2 = sumHP('team2');
      let winner = 'draw';
      if (score1 !== score2) winner = (score1 > score2) ? 'team1' : 'team2';

      this.endBattle(b.id, timeup ? '시간 만료' : '전원 사망');
      this._emitEnd(b, { winner, score1, score2, timeup, dead1:!alive1, dead2:!alive2 });
      return true;
    }
    return false;
  }

  // ── 1초 타이머
  _startTimer(b) {
    this._stopTimer(b);
    const iv = setInterval(() => {
      if (b.status !== 'ongoing') return;
      const remainMs = Math.max(0, (b.timerEnd||0) - now());
      this._emitTimer(b, { now: now(), timerEnd: b.timerEnd, remainMs });
      if (remainMs <= 0) {
        this._checkEnd(b);
      }
    }, 1000);
    this._timers.set(b.id, iv);
    // 페이즈 대기자 미응답 타이머 장착
    this._armPhaseInactivity(b);
  }
  _stopTimer(b) {
    const iv = this._timers.get(b.id);
    if (iv) clearInterval(iv);
    this._timers.delete(b.id);
  }

  // ── 미응답 자동 패스
  _armPhaseInactivity(b) {
    const map = this._inactivity.get(b.id);
    // 현재 페이즈에서 아직 행동 안한 생존자에게만 타이머
    for (const pid of b.turn.pending) {
      if (map.has(pid)) continue;
      const to = setTimeout(() => {
        const me = b.players[pid];
        if (!me || !me.alive || b.status!=='ongoing') { map.delete(pid); return; }
        // 자동 패스
        this._log(b, 'auto', `${me.name} (자동 패스)`);
        this._markActed(b, pid);
        this._emitState(b);
        if (!this._checkEnd(b)) this._armPhaseInactivity(b);
      }, this.opts.inactivityMs);
      map.set(pid, to);
    }
  }
  _clearInactivity(b, pid) {
    const map = this._inactivity.get(b.id);
    const to = map.get(pid);
    if (to) clearTimeout(to);
    map.delete(pid);
  }
  _clearAllInactivity(b) {
    const map = this._inactivity.get(b.id);
    for (const to of map.values()) clearTimeout(to);
    map.clear();
  }
}

module.exports = BattleEngine;
