// packages/battle-server/src/engine/BattleEngine.js
// In-memory battle store + rules engine (D20 기반)
export function createBattleStore() {
  const _battles = new Map();

  function _newId() {
    return Math.random().toString(36).slice(2, 6).toUpperCase() +
           Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function create(mode = '1v1') {
    const id = _newId();
    const battle = {
      id,
      mode,
      status: 'waiting', // waiting|active|paused|ended
      createdAt: Date.now(),
      players: [],
      logs: [],
      currentTurn: { turnNumber: 0, currentTeam: null, currentPlayer: null },
      lobby: { spectatorOTPs: new Set(), playerTokens: new Map() },
      timers: { turnDeadline: 0 },
      round: { actedA: new Set(), actedB: new Set(), firstTeam: null }, // 번갈아 선/후공
    };
    _battles.set(id, battle);
    return battle;
  }

  function get(id) { return _battles.get(id) || null; }
  function size() { return _battles.size; }

  function snapshot(id) {
    const b = get(id);
    if (!b) return null;
    return JSON.parse(JSON.stringify(b));
  }

  function addPlayer(id, player) {
    const b = get(id); if (!b) return null;
    const exists = b.players.some(p => p.name === player.name);
    if (exists) throw new Error('duplicate name');
    const p = {
      id: 'p_' + Math.random().toString(36).slice(2,8),
      name: String(player.name || '이름'),
      team: (player.team === 'B' ? 'B' : 'A'),
      hp: 100, maxHp: 100,
      stats: {
        attack: clamp(player.stats?.attack, 1, 5),
        defense: clamp(player.stats?.defense, 1, 5),
        agility: clamp(player.stats?.agility, 1, 5),
        luck: clamp(player.stats?.luck, 1, 5),
      },
      items: {
        dittany: Number(player.items?.dittany || player.items?.ditany || 0),
        attackBooster: Number(player.items?.attackBooster || player.items?.attack_boost || 0),
        defenseBooster: Number(player.items?.defenseBooster || player.items?.defense_boost || 0),
      },
      avatar: player.avatar || null,
      ready: false,
      joinedAt: Date.now(),
      _acted: false, // 현재 팀 라운드에서 행동했는지
      _defenseBuff: 0, // 이번 피격에 적용할 방어 D20 보정
      _defenseDouble: false,
      _attackDouble: false,
    };
    b.players.push(p);
    return p;
  }

  function removePlayer(id, pid) {
    const b = get(id); if (!b) return false;
    const idx = b.players.findIndex(p => p.id === pid);
    if (idx >= 0) { b.players.splice(idx, 1); return true; }
    return false;
  }

  function markReady(id, pid, ready = true) {
    const b = get(id); if (!b) return false;
    const p = b.players.find(x => x.id === pid);
    if (!p) return false;
    p.ready = !!ready;
    return true;
  }

  // OTP/Links
  function issueSpectatorOTP(id) {
    const b = get(id); if (!b) throw new Error('not found');
    const otp = Math.random().toString(36).slice(2, 8).toUpperCase();
    b.lobby.spectatorOTPs.add(otp);
    return { otp };
  }
  function issuePlayerLink(id, pid, baseURL) {
    const b = get(id); if (!b) throw new Error('not found');
    const token = Math.random().toString(36).slice(2, 10).toUpperCase();
    b.lobby.playerTokens.set(token, pid);
    const url = `${baseURL}/player.html?battle=${id}&token=${token}`;
    const p = b.players.find(x => x.id === pid);
    return { playerId: pid, name: p?.name, team: p?.team, token, url };
  }
  function authByToken(id, token) {
    const b = get(id); if (!b) return null;
    const pid = b.lobby.playerTokens.get(token);
    if (!pid) return null;
    return b.players.find(p => p.id === pid) || null;
  }

  // Initiative & turn
  function start(id) {
    const b = get(id); if (!b) return null;
    if (b.status !== 'waiting') return b;

    const sumA = sumStat(b, 'A', 'agility');
    const sumB = sumStat(b, 'B', 'agility');
    const rA = d20(); const rB = d20();
    const totalA = sumA + rA, totalB = sumB + rB;

    let first = 'A';
    if (totalB > totalA) first = 'B';
    if (totalA === totalB) {
      // 재굴림
      first = d20() >= d20() ? 'A' : 'B';
    }

    b.status = 'active';
    b.currentTurn.turnNumber = 1;
    b.currentTurn.currentTeam = first;
    b.round.firstTeam = first;
    b.timers.turnDeadline = Date.now() + 5 * 60 * 1000; // 5분
    resetRoundFlags(b);
    return { b, sumA, sumB, rA, rB, totalA, totalB, first };
  }

  function playerAction(id, pid, action) {
    const b = get(id); if (!b) throw new Error('not found');
    if (b.status !== 'active') throw new Error('not active');
    const actor = b.players.find(p => p.id === pid);
    if (!actor) throw new Error('no actor');
    if (actor.team !== b.currentTurn.currentTeam) throw new Error('not your team turn');
    if (actor._acted) throw new Error('already acted');

    const result = resolveAction(b, actor, action);
    actor._acted = true;

    // 팀이 모두 행동했는지 확인 → 팀 전환 또는 라운드 종료
    const teamPlayers = b.players.filter(p => p.team === actor.team && p.hp > 0);
    const actedCount = teamPlayers.filter(p => p._acted).length;

    let phase = 'team';
    if (actedCount >= teamPlayers.length) {
      // 상대 팀으로 전환 또는 라운드 종료
      if (b.currentTurn.currentTeam === 'A') {
        // A가 끝났음 → B 차례
        b.currentTurn.currentTeam = 'B';
        resetTeamFlags(b, 'B');
        b.timers.turnDeadline = Date.now() + 5*60*1000;
        phase = 'switch';
      } else {
        // B까지 끝 → 라운드 종료
        endRound(b);
        phase = 'roundEnd';
      }
    }

    return { result, phase, b };
  }

  function endRound(b) {
    // 라운드 결과 계산 및 다음 라운드 준비
    // 선/후공 교대
    b.currentTurn.turnNumber += 1;
    b.currentTurn.currentTeam = (b.round.firstTeam === 'A') ? 'B' : 'A';
    b.round.firstTeam = b.currentTurn.currentTeam;
    resetRoundFlags(b);
    b.timers.turnDeadline = Date.now() + 5*60*1000;
  }

  function end(id) {
    const b = get(id); if (!b) return null;
    b.status = 'ended';
    return b;
  }

  function clamp(n, lo, hi) {
    n = Number(n||0);
    if (Number.isNaN(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }
  function d20() { return Math.floor(Math.random()*20)+1; }
  function sumStat(b, team, key) {
    return b.players.filter(p=>p.team===team).reduce((s,p)=>s+(p.stats?.[key]||0),0);
  }
  function resetRoundFlags(b) {
    b.players.forEach(p=>{ p._acted=false; p._defenseBuff=0; p._defenseDouble=false; p._attackDouble=false; });
  }
  function resetTeamFlags(b, team) {
    b.players.filter(p=>p.team===team).forEach(p=>{ p._defenseBuff=0; p._attackDouble=false; });
    b.players.filter(p=>p.team!==team).forEach(p=>{ p._defenseBuff=0; p._attackDouble=false; });
  }

  function resolveAction(b, actor, action) {
    const a = action || {};
    const type = a.type;

    if (type === 'pass') {
      return { type, message: `${actor.name} 패스` };
    }

    if (type === 'defend') {
      // 다음 1회 피격 방어 D20 추가 적용
      const roll = d20();
      actor._defenseBuff = roll;
      return { type, roll, message: `${actor.name} 방어 태세 (보정 D20=${roll})` };
    }

    if (type === 'dodge') {
      // 민첩 + D20 ≥ 상대 공격이면 완전 회피
      return { type, message: `${actor.name} 회피 준비` };
    }

    if (type === 'item') {
      const item = a.item;
      if (item === 'dittany' || item === 'ditany') {
        if ((actor.items.dittany||0) > 0) {
          actor.items.dittany -= 1;
          const healed = Math.min(10, actor.maxHp - actor.hp);
          actor.hp += healed;
          return { type, item: 'dittany', healed, message: `${actor.name} 디터니 사용 (+${healed})` };
        }
        throw new Error('no dittany');
      }
      if (item === 'attackBooster' || item === 'attack_boost') {
        if ((actor.items.attackBooster||0) > 0) {
          actor.items.attackBooster -= 1;
          actor._attackDouble = Math.random() < 0.10; // 10%
          return { type, item: 'attackBooster', success: actor._attackDouble, message: `${actor.name} 공격 보정기 사용 (${actor._attackDouble?'성공':'실패'})` };
        }
        throw new Error('no attackBooster');
      }
      if (item === 'defenseBooster' || item === 'defense_boost') {
        if ((actor.items.defenseBooster||0) > 0) {
          actor.items.defenseBooster -= 1;
          actor._defenseDouble = Math.random() < 0.10; // 10%
          return { type, item: 'defenseBooster', success: actor._defenseDouble, message: `${actor.name} 방어 보정기 사용 (${actor._defenseDouble?'성공':'실패'})` };
        }
        throw new Error('no defenseBooster');
      }
      throw new Error('unknown item');
    }

    if (type === 'attack') {
      // 대상 필요
      const target = b.players.find(p => p.id === a.targetId);
      if (!target) throw new Error('target not found');
      if (target.team === actor.team) throw new Error('cannot attack ally');
      if (target.hp <= 0) throw new Error('target down');

      // 명중: 행운 + D20 vs 상대 회피(민첩 + D20)
      const rollHit = d20();
      const rollDodge = d20();
      const hitScore = (actor.stats.luck||0) + rollHit;
      const dodgeScore = (target.stats.agility||0) + rollDodge;

      if (hitScore < dodgeScore) {
        return { type, miss: true, rollHit, rollDodge, message: `${actor.name}의 공격 → ${target.name} 회피 성공 (무피해)` };
      }

      // 치명타: D20 ≥ (20 - 행운/2)
      const rollCrit = d20();
      const critThresh = 20 - Math.floor((actor.stats.luck||0)/2);
      const isCrit = rollCrit >= critThresh;

      // 방어태세 대상: 방어 + D20 추가, 보정 2배면 방어×2
      const rollAtk = d20();
      const rollDef = d20();
      let defenseVal = (target.stats.defense||0) + rollDef + (target._defenseBuff||0);
      if (target._defenseDouble) defenseVal *= 2;

      let dmg = (actor.stats.attack||0) + rollAtk - defenseVal;
      if (dmg < 0) dmg = 0;
      if (!target._defenseBuff) { // 일반 대상은 최소 1
        if (dmg < 1) dmg = 1;
      }
      if (actor._attackDouble) dmg *= 2;
      if (isCrit) dmg *= 2;

      target.hp = Math.max(0, target.hp - dmg);

      return {
        type, targetId: target.id,
        rollHit, rollDodge, rollCrit, critThresh, isCrit,
        rollAtk, rollDef,
        damage: dmg,
        targetHp: target.hp,
        message: `${actor.name} ▶ ${target.name} 공격 ${dmg} 피해${isCrit?' (치명)':''}`
      };
    }

    throw new Error('unknown action');
  }

  return {
    create, get, size, snapshot,
    addPlayer, removePlayer, markReady,
    issueSpectatorOTP, issuePlayerLink, authByToken,
    start, playerAction, end,
  };
}
