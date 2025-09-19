// packages/battle-server/src/engine/BattleEngine.js
// 완전 교체용 - 정확한 로그 포맷 구현
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
      status: 'waiting',
      createdAt: Date.now(),
      players: [],
      logs: [],
      currentTurn: { turnNumber: 0, currentTeam: null, currentPlayer: null },
      lobby: { spectatorOTPs: new Set(), playerTokens: new Map() },
      timers: { turnDeadline: 0 },
      round: { actedA: new Set(), actedB: new Set(), firstTeam: null },
      roundEvents: [],
      phase: 'waiting',
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
      _acted: false,
      _defenseBuff: 0,
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
    p.ready = !p.ready;
    return true;
  }

  // 로그 추가 함수들
  function addGoldLog(battle, message) {
    battle.logs.push({ ts: Date.now(), type: 'gold', message });
  }

  function addTeamLog(battle, team, message) {
    battle.logs.push({ ts: Date.now(), type: team === 'A' ? 'teamA' : 'teamB', message });
  }

  function addSystemLog(battle, message) {
    battle.logs.push({ ts: Date.now(), type: 'system', message });
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

  // 순서/유틸
  function byAgilityThenNameAscKo(a, b) {
    const ag = (b.stats?.agility || 1) - (a.stats?.agility || 1);
    if (ag !== 0) return ag;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
  }
  function teamOrder(b, team) {
    return b.players
      .filter(p => p.team === team && p.hp > 0)
      .sort(byAgilityThenNameAscKo);
  }
  function nextUnacted(b, team) {
    const ord = teamOrder(b, team);
    return ord.find(p => !p._acted) || null;
  }
  function setCurrentPlayer(b, player) {
    if (!player) {
      b.currentTurn.currentPlayer = null;
      return;
    }
    b.currentTurn.currentPlayer = {
      id: player.id,
      name: player.name,
      avatar: player.avatar || null,
      team: player.team
    };
  }

  // 전투 시작
  function start(id) {
    const b = get(id); if (!b) return null;
    if (b.status !== 'waiting') return b;

    const sumA = sumStat(b, 'A', 'agility');
    const sumB = sumStat(b, 'B', 'agility');
    const rA = d10(); const rB = d10();
    const totalA = sumA + rA, totalB = sumB + rB;

    let first = 'A';
    if (totalB > totalA) first = 'B';
    if (totalA === totalB) {
      first = d10() >= d10() ? 'A' : 'B';
    }

    b.status = 'active';
    b.currentTurn.turnNumber = 1;
    b.currentTurn.currentTeam = first;
    b.round.firstTeam = first;
    b.phase = `team_select_${first}`;
    b.timers.turnDeadline = Date.now() + 5 * 60 * 1000;
    resetRoundFlags(b);

    setCurrentPlayer(b, nextUnacted(b, first));

    // 정확한 로그 포맷
    addGoldLog(b, `선공 결정: A팀(민첩 ${sumA} + ${rA} = ${totalA}) vs B팀(민첩 ${sumB} + ${rB} = ${totalB})`);
    addGoldLog(b, `${first}팀이 선공입니다!`);
    addGoldLog(b, '전투가 시작되었습니다!');
    addGoldLog(b, '1라운드 시작');
    addTeamLog(b, first, `=== ${first}팀 선택 시작 ===`);

    return { b, sumA, sumB, rA, rB, totalA, totalB, first };
  }

  function playerAction(id, pid, action) {
    const b = get(id); if (!b) throw new Error('not found');
    if (b.status !== 'active') throw new Error('not active');
    const actor = b.players.find(p => p.id === pid);
    if (!actor) throw new Error('no actor');
    if (actor.team !== b.currentTurn.currentTeam) throw new Error('not your team turn');
    if (actor._acted) throw new Error('already acted');

    // 즉시 행동 처리
    const result = resolveActionImmediately(b, actor, action);
    actor._acted = true;

    let phase = 'team';
    const team = actor.team;
    const teamPlayers = b.players.filter(p => p.team === team && p.hp > 0);
    const actedCount = teamPlayers.filter(p => p._acted).length;

    if (actedCount < teamPlayers.length) {
      setCurrentPlayer(b, nextUnacted(b, team));
    } else {
      const oppositeTeam = (b.currentTurn.currentTeam === 'A') ? 'B' : 'A';
      
      if (b.currentTurn.currentTeam === b.round.firstTeam) {
        // 선공팀 완료 -> 후공팀
        addTeamLog(b, team, `[${team}] ${team}팀 선택 완료`);
        addTeamLog(b, oppositeTeam, `=== ${oppositeTeam}팀 선택 시작 ===`);
        
        b.currentTurn.currentTeam = oppositeTeam;
        b.phase = `team_select_${oppositeTeam}`;
        resetTeamFlags(b, oppositeTeam);
        b.timers.turnDeadline = Date.now() + 5*60*1000;
        setCurrentPlayer(b, nextUnacted(b, oppositeTeam));
        phase = 'switch';
      } else {
        // 후공팀 완료 -> 라운드 종료
        addTeamLog(b, team, `[${team}] ${team}팀 선택 완료`);
        endRound(b);
        phase = 'roundEnd';
      }
    }

    return { result, phase, b };
  }

  // 즉시 행동 처리
  function resolveActionImmediately(battle, actor, action) {
    const { type, targetId, item } = action;
    const team = actor.team;
    
    switch (type) {
      case 'attack':
        if (targetId) {
          const target = battle.players.find(p => p.id === targetId);
          if (target && target.hp > 0) {
            const damage = calculateAttackDamage(battle, actor, target);
            target.hp = Math.max(0, target.hp - damage);
            
            addTeamLog(battle, team, `→ ${actor.name}이(가) ${target.name}에게 공격 (피해 ${damage}) → HP ${target.hp}`);
            
            return { type: 'attack', damage, target: target.name };
          }
        }
        break;
        
      case 'defend':
        actor._defenseBuff = d10();
        if (actor._defenseDouble) {
          actor._defenseBuff *= 2;
          actor._defenseDouble = false;
        }
        addTeamLog(battle, team, `→ ${actor.name}이(가) 방어 자세`);
        return { type: 'defend' };
        
      case 'dodge':
        addTeamLog(battle, team, `→ ${actor.name}이(가) 회피 자세`);
        return { type: 'dodge' };
        
      case 'item':
        return handleItemUse(battle, actor, item);
        
      case 'pass':
        addTeamLog(battle, team, `→ ${actor.name}이(가) 패스`);
        return { type: 'pass' };
    }
    
    return { type: 'unknown' };
  }

  function calculateAttackDamage(battle, attacker, defender) {
    const attackRoll = d20();
    const luckRoll = d20();
    
    // 치명타 판정
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCrit = luckRoll >= critThreshold;
    
    // 회피 판정
    const dodgeRoll = d20();
    const dodgeSuccess = (defender.stats.agility + dodgeRoll) >= (attacker.stats.attack + attackRoll);
    
    if (dodgeSuccess) {
      addTeamLog(battle, attacker.team, `→ ${defender.name} 회피 성공!`);
      return 0;
    }
    
    // 기본 공격력 계산
    let damage = attacker.stats.attack + attackRoll - defender.stats.defense;
    if (attacker._attackDouble) {
      damage *= 2;
      attacker._attackDouble = false;
    }
    if (isCrit) damage *= 2;
    
    // 방어 적용
    if (defender._defenseBuff > 0) {
      damage -= defender._defenseBuff;
      defender._defenseBuff = 0;
    }
    
    return Math.max(1, damage);
  }

  function handleItemUse(battle, actor, item) {
    const team = actor.team;
    
    switch (item) {
      case 'dittany':
      case 'ditany':
        if (actor.items.dittany > 0 || actor.items.ditany > 0) {
          const heal = 10;
          actor.hp = Math.min(actor.maxHp, actor.hp + heal);
          if (actor.items.dittany > 0) actor.items.dittany--;
          else actor.items.ditany--;
          addTeamLog(battle, team, `→ ${actor.name}이(가) 디터니 사용 (회복 ${heal}) → HP ${actor.hp}`);
          return { type: 'heal', amount: heal };
        }
        break;
        
      case 'attackBooster':
      case 'attack_boost':
        if (actor.items.attackBooster > 0 || actor.items.attack_boost > 0) {
          const success = d10() <= 1;
          if (actor.items.attackBooster > 0) actor.items.attackBooster--;
          else actor.items.attack_boost--;
          
          if (success) {
            actor._attackDouble = true;
            addTeamLog(battle, team, `→ ${actor.name}이(가) 공격 보정기 성공!`);
            return { type: 'boost', success: true };
          } else {
            addTeamLog(battle, team, `→ ${actor.name}이(가) 공격 보정기 실패`);
            return { type: 'boost', success: false };
          }
        }
        break;
        
      case 'defenseBooster':
      case 'defense_boost':
        if (actor.items.defenseBooster > 0 || actor.items.defense_boost > 0) {
          const success = d10() <= 1;
          if (actor.items.defenseBooster > 0) actor.items.defenseBooster--;
          else actor.items.defense_boost--;
          
          if (success) {
            actor._defenseDouble = true;
            addTeamLog(battle, team, `→ ${actor.name}이(가) 방어 보정기 성공!`);
            return { type: 'boost', success: true };
          } else {
            addTeamLog(battle, team, `→ ${actor.name}이(가) 방어 보정기 실패`);
            return { type: 'boost', success: false };
          }
        }
        break;
    }
    
    addTeamLog(battle, team, `→ ${actor.name}이(가) 아이템 사용 실패`);
    return { type: 'item_failed' };
  }

  function endRound(battle) {
    // 라운드 종료 로그
    addGoldLog(battle, `${battle.currentTurn.turnNumber}라운드 종료`);
    
    // 승리 판정
    const alivePlayers = battle.players.filter(p => p.hp > 0);
    const teamA = alivePlayers.filter(p => p.team === 'A');
    const teamB = alivePlayers.filter(p => p.team === 'B');
    
    if (teamA.length === 0) {
      battle.status = 'ended';
      addGoldLog(battle, 'B팀 승리!');
      return;
    }
    if (teamB.length === 0) {
      battle.status = 'ended';
      addGoldLog(battle, 'A팀 승리!');
      return;
    }
    
    // 다음 라운드 준비
    battle.currentTurn.turnNumber += 1;
    const nextFirst = (battle.round.firstTeam === 'A') ? 'B' : 'A';
    battle.currentTurn.currentTeam = nextFirst;
    battle.round.firstTeam = nextFirst;
    battle.phase = `team_select_${nextFirst}`;
    resetRoundFlags(battle);
    battle.timers.turnDeadline = Date.now() + 5*60*1000;

    setCurrentPlayer(battle, nextUnacted(battle, nextFirst));

    // 새 라운드 시작 로그
    addGoldLog(battle, `${battle.currentTurn.turnNumber}라운드 시작`);
    addTeamLog(battle, nextFirst, `=== ${nextFirst}팀 선택 시작 ===`);
  }

  function resetRoundFlags(b) {
    b.players.forEach(p => {
      p._acted = false;
      p._defenseBuff = 0;
    });
  }

  function resetTeamFlags(b, team) {
    b.players.filter(p => p.team === team).forEach(p => {
      p._acted = false;
    });
  }

  function end(id) {
    const b = get(id); if (!b) return null;
    b.status = 'ended';
    return b;
  }

  // Utils
  function clamp(n, lo, hi) {
    n = Number(n||0);
    if (Number.isNaN(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }
  function d10() { return Math.floor(Math.random()*10)+1; }
  function d20() { return Math.floor(Math.random()*20)+1; }
  function sumStat(b, team, key) {
    return b.players.filter(p=>p.team===team).reduce((s,p)=>s+(p.stats?.[key]||0),0);
  }

  return {
    create, get, size, snapshot,
    addPlayer, removePlayer, markReady,
    issueSpectatorOTP, issuePlayerLink, authByToken,
    start, playerAction, end,
    teamOrder, nextUnacted, setCurrentPlayer,
    resetRoundFlags, resetTeamFlags
  };
}
