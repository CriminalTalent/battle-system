/* ESM BattleEngine – 선택 페이즈는 '의도 로그', 해석 페이즈에서만 '결과+적용'
   - 공격/방어 보정기, 디터니 모두 1회용
   - attackBooster: targetId 있으면 해석 단계에서 즉시 강화공격 수행
   - targetId 없으면 그 라운드에 한해 해당 배우의 일반 공격에만 공격스탯×2 적용
   - defenseBooster: 그 라운드에 '방어 의도' 낸 경우에만 방어스탯×2 적용
   - 대미지/치명타/회피/방어/라운드 교대 규칙 유지
*/

import { randomUUID } from 'node:crypto';

const now = () => Date.now();
const TEAM_SELECT_MS = 5 * 60 * 1000; // 팀 선택 5분 제한(표시용)

// 정렬: 민첩 내림차순, 동률 시 이름 오름차순
function sortByInitiative(players) {
  return [...players].sort((a, b) => {
    const ag = (b.stats?.agility ?? 0) - (a.stats?.agility ?? 0);
    if (ag !== 0) return ag;
    const an = (a.name || '').toString();
    const bn = (b.name || '').toString();
    return an.localeCompare(bn, 'ko-KR');
  });
}

// d10(1~10)
const d10 = () => 1 + Math.floor(Math.random() * 10);

// 팀
const teamOf = (p) => (p?.team === 'B' ? 'B' : 'A');

export function createBattleStore() {
  const battles = new Map();

  let onLog = null;     // (battleId, {ts,type,message})
  let onUpdate = null;  // (battleId)

  function setLogger(fn) { onLog = typeof fn === 'function' ? fn : null; }
  function setUpdate(fn) { onUpdate = typeof fn === 'function' ? fn : null; }

  function pushLog(battle, message, type = 'system') {
    const entry = { ts: now(), type, message };
    battle.logs.push(entry);
    if (onLog) onLog(battle.id, entry);
  }
  function touch(battle) { if (onUpdate) onUpdate(battle.id); }

  function size() { return battles.size; }
  function get(id) { return battles.get(id) || null; }

  function snapshot(id) {
    const b = battles.get(id);
    if (!b) return null;
    const { status, phase, round, currentTeam, nextFirstTeam, createdAt, hardLimitAt } = b;
    const currentPlayer = b.turnCursor?.playerId
      ? b.players.find(p => p.id === b.turnCursor.playerId) || null
      : null;
    const timeLeftSec = Math.max(0, Math.ceil(((b.phaseEndsAt || now()) - now()) / 1000));
    return {
      id: b.id,
      status,
      phase,
      round,
      currentTeam,
      nextFirstTeam,
      createdAt,
      hardLimitAt,
      currentTurn: { round, currentTeam, timeLeftSec, currentPlayer },
      players: b.players.map(p => ({
        id: p.id, name: p.name, team: p.team, avatar: p.avatar,
        hp: p.hp, maxHp: p.maxHp,
        ready: !!p.ready,
        stats: { ...p.stats },
        items: { ...p.items }
      }))
    };
  }

  // 전투 생성
  function create(mode = '2v2') {
    const id = randomUUID();
    const battle = {
      id,
      mode,
      status: 'waiting', // waiting|active|paused|ended
      phase: 'idle',     // idle|A_select|B_select|resolve|inter
      round: 0,
      currentTeam: null,
      nextFirstTeam: null,
      selectionDone: { A: false, B: false },
      players: [],
      choices: { A: [], B: [] },
      logs: [],
      createdAt: now(),
      hardLimitAt: now() + 60 * 60 * 1000, // 1시간 하드 제한
      turnCursor: null,
      phaseEndsAt: null
    };
    battles.set(id, battle);
    return battle;
  }

  // 플레이어 추가
  function addPlayer(battleId, player) {
    const b = get(battleId);
    if (!b) return null;
    const id = player.id || randomUUID();
    const baseHp = Number.isFinite(player.hp) ? player.hp : 100;
    const p = {
      id,
      team: player.team === 'B' ? 'B' : 'A',
      name: player.name || `P${b.players.length + 1}`,
      avatar: player.avatar || '',
      hp: baseHp,
      maxHp: Number.isFinite(player.maxHp) ? player.maxHp : baseHp,
      stats: {
        attack: +(player.stats?.attack ?? 1),
        defense: +(player.stats?.defense ?? 1),
        agility: +(player.stats?.agility ?? 1),
        luck:    +(player.stats?.luck ?? 1),
      },
      items: {
        dittany: +(player.items?.dittany ?? player.items?.ditany ?? 0),
        attackBooster: +(player.items?.attackBooster ?? player.items?.attack_boost ?? 0),
        defenseBooster: +(player.items?.defenseBooster ?? player.items?.defense_boost ?? 0),
      },
      ready: false,
      token: player.token || null,
    };
    b.players.push(p);
    touch(b);
    return p;
  }

  function removePlayer(battleId, playerId) {
    const b = get(battleId);
    if (!b) return false;
    const idx = b.players.findIndex(p => p.id === playerId);
    if (idx === -1) return false;
    b.players.splice(idx, 1);
    ['A','B'].forEach(t => { b.choices[t] = b.choices[t].filter(c => c.playerId !== playerId); });
    touch(b);
    return true;
  }

  function markReady(battleId, playerId, ready = true) {
    const b = get(battleId);
    if (!b) return false;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return false;
    p.ready = !!ready;
    pushLog(b, `${p.name}이(가) 준비 완료했습니다`, 'system');
    touch(b);
    return true;
  }

  function allReady(b) {
    const teams = new Set(b.players.map(p => p.team));
    if (teams.size !== 2) return false;
    return b.players.every(p => p.ready);
  }

  // 전투 시작
  function start(battleId) {
    const b = get(battleId);
    if (!b) return null;
    if (b.status !== 'waiting') return null;

    if (!allReady(b)) {
      pushLog(b, '모든 플레이어가 준비되면 시작할 수 있습니다', 'notice');
      touch(b);
      return null;
    }

    b.status = 'active';
    b.round = 1;

    // 선공: 팀 평균 민첩 + d10
    const teamA = b.players.filter(p => p.team === 'A');
    const teamB = b.players.filter(p => p.team === 'B');
    const avgA = teamA.reduce((s,p)=>s+(p.stats?.agility ?? 0),0) / Math.max(1,teamA.length);
    const avgB = teamB.reduce((s,p)=>s+(p.stats?.agility ?? 0),0) / Math.max(1,teamB.length);
    const rollA = d10();
    const rollB = d10();
    const scoreA = Math.floor(avgA) + rollA;
    const scoreB = Math.floor(avgB) + rollB;

    const first = (scoreA === scoreB) ? (Math.random() < 0.5 ? 'A' : 'B') : (scoreA > scoreB ? 'A' : 'B');
    b.currentTeam = first;
    b.nextFirstTeam = first;
    b.selectionDone = { A: false, B: false };

    pushLog(b, `선공 결정: A팀(민첩 ${Math.floor(avgA)} + ${rollA} = ${scoreA}) vs B팀(민첩 ${Math.floor(avgB)} + ${rollB} = ${scoreB})`, 'system');
    pushLog(b, `${first}팀이 선공입니다!`, 'system');
    pushLog(b, '전투가 시작되었습니다!', 'system');
    pushLog(b, `${b.round}라운드 시작`, 'system');

    startSelectPhase(b, first);
    touch(b);
    return { b };
  }

  function startSelectPhase(b, team) {
    if (b.status !== 'active') return;
    b.phase = (team === 'A') ? 'A_select' : 'B_select';
    b.currentTeam = team;
    b.choices[team] = [];

    const alive = sortByInitiative(b.players.filter(p => p.team === team && p.hp > 0));
    b.turnCursor = { team, order: alive.map(p=>p.id), index: 0, playerId: alive[0]?.id || null };
    b.phaseEndsAt = now() + TEAM_SELECT_MS;

    pushLog(b, `=== ${team}팀 선택 페이즈 시작 ===`, team === 'A' ? 'teamA' : 'teamB');
    touch(b);
  }

  // 선택(의도 기록) + 아이템 재고 0 가드
  function playerAction(battleId, playerId, action) {
    const b = get(battleId);
    if (!b || b.status !== 'active') return null;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return null;

    const p = b.players.find(x => x.id === playerId);
    if (!p || p.hp <= 0) return null;
    const team = teamOf(p);
    if (team !== b.currentTeam) return null;

    // 아이템 재고 체크
    if (action?.type === 'item') {
      const kind = action.item;
      const inv =
        (kind === 'dittany' || kind === 'ditany') ? (p.items.dittany ?? 0)
      : (kind === 'attackBooster') ? (p.items.attackBooster ?? 0)
      : (kind === 'defenseBooster') ? (p.items.defenseBooster ?? 0)
      : 0;
      if (inv <= 0) {
        pushLog(b, `아이템 사용 불가: ${p.name} — 재고 없음`, 'notice');
        touch(b);
        return { b, result: { queued: false, error: 'no_item' } };
      }
    }

    // 덮어쓰기
    b.choices[team] = b.choices[team].filter(c => c.playerId !== p.id);

    // 대상
    let target = null;
    if (action?.targetId) {
      target = b.players.find(x => x.id === action.targetId) || null;
    }

    const intent = {
      playerId: p.id,
      type: action?.type,
      targetId: target?.id || null,
      raw: { ...action }
    };
    b.choices[team].push(intent);

    // 의도 로그(수치 없음)
    if (intent.type === 'attack') {
      pushLog(b, `→ ${p.name}이(가) ${target?.name ?? '대상'}에게 공격`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'defend') {
      pushLog(b, `→ ${p.name}이(가) 방어를 준비`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'dodge') {
      pushLog(b, `→ ${p.name}이(가) 회피를 준비`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'item') {
      const itemName = (intent.raw.item === 'dittany' || intent.raw.item === 'ditany') ? '디터니'
        : intent.raw.item === 'attackBooster' ? '공격 보정기'
        : intent.raw.item === 'defenseBooster' ? '방어 보정기' : '아이템';
      const tgtName = intent.raw.targetId ? (b.players.find(x=>x.id===intent.raw.targetId)?.name ?? '대상') : '자신';
      pushLog(b, `→ ${p.name}이(가) ${itemName} 사용 예정 (${tgtName})`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'pass') {
      pushLog(b, `→ ${p.name}이(가) 패스`, team === 'A' ? 'teamA' : 'teamB');
    } else {
      pushLog(b, `→ ${p.name} 행동 선택`, team === 'A' ? 'teamA' : 'teamB');
    }

    // 커서 진행(표시용)
    if (b.turnCursor?.playerId === p.id) {
      b.turnCursor.index++;
      const nextId = b.turnCursor.order[b.turnCursor.index] || null;
      b.turnCursor.playerId = nextId;
    }

    // 완료 판정
    const aliveIds = new Set(b.players.filter(x => x.team === team && x.hp > 0).map(x => x.id));
    const chosenIds = new Set(b.choices[team].map(c => c.playerId));
    const done = [...aliveIds].every(id => chosenIds.has(id));

    if (done && !b.selectionDone[team]) {
      b.selectionDone[team] = true;
      pushLog(b, `[${team}] ${team}팀 선택 완료`, team === 'A' ? 'teamA' : 'teamB');
      touch(b);
      finishSelectOrNext(b);
    } else {
      touch(b);
    }
    return { b, result: { queued: true } };
  }

  // 선공팀 → 후공팀 → 해석
  function finishSelectOrNext(b) {
    if (b.status !== 'active') return;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return;

    const firstTeamThisRound = b.nextFirstTeam || 'A';
    const secondTeam = firstTeamThisRound === 'A' ? 'B' : 'A';

    if (b.currentTeam === firstTeamThisRound) {
      if (!b.selectionDone[secondTeam]) {
        startSelectPhase(b, secondTeam);
        return;
      }
      // 동시 완료면 아래로
    }

    if (b.selectionDone.A && b.selectionDone.B) {
      startResolve(b);
    }
  }

  // 승리 체크
  function checkWinner(b) {
    const aliveA = b.players.filter(p => p.team === 'A' && p.hp > 0).length;
    const aliveB = b.players.filter(p => p.team === 'B' && p.hp > 0).length;
    if (aliveA === 0 && aliveB === 0) return 'Draw';
    if (aliveA === 0) return 'B';
    if (aliveB === 0) return 'A';

    // 1시간 제한 도달 시 HP 합 승부
    if (now() >= b.hardLimitAt) {
      const sumA = b.players.filter(p=>p.team==='A').reduce((s,p)=>s+Math.max(0,p.hp),0);
      const sumB = b.players.filter(p=>p.team==='B').reduce((s,p)=>s+Math.max(0,p.hp),0);
      if (sumA === sumB) return 'Draw';
      return sumA > sumB ? 'A' : 'B';
    }
    return null;
  }

  // 해석 – 아이템 소모/적용, 전투 의도 적용
  function startResolve(b) {
    if (b.status !== 'active') return;
    b.phase = 'resolve';
    b.currentTeam = null;
    b.turnCursor = null;
    b.phaseEndsAt = now() + 3_000;

    pushLog(b, '라운드 해석', 'result');
    touch(b);

    const first = b.nextFirstTeam || 'A';
    const second = first === 'A' ? 'B' : 'A';

    // 이번 라운드 보정기 플래그
    const atkBoost = new Set(); // 배우 id
    const defBoost = new Set();

    // 1) 아이템 선처리(모두 1회용 소모) + 공격보정기의 ‘즉시 강화 공격’(targetId 있을 때)
    const allIntents = [...(b.choices.A || []), ...(b.choices.B || [])];

    // 유틸: 한 번의 공격을 위 규칙대로 해석/적용
    const resolveSingleAttack = (actor, target, useAtkBoost) => {
      if (!actor || !target || actor.hp <= 0 || target.hp <= 0) return;

      // 회피 체크
      const finalAttack = (actor.stats?.attack ?? 0) * (useAtkBoost ? 2 : 1) + d10();
      const dodgeScore  = (target.stats?.agility ?? 0) + d10();
      if (dodgeScore >= finalAttack) {
        pushLog(b, `→ ${actor.name}의 공격을 ${target.name}이(가) 회피`, 'result');
        return;
      }

      // 치명타
      const luck = (actor.stats?.luck ?? 0);
      const crit = d10() >= (10 - Math.floor(luck / 2));
      const attackValue = crit ? (finalAttack * 2) : finalAttack;

      // 방어 의도 여부 확인
      const targetDefendIntent = allIntents.find(c => c.playerId === target.id && c.type === 'defend');
      let damage = attackValue;
      if (targetDefendIntent) {
        const defMul = defBoost.has(target.id) ? 2 : 1;
        const defenseValue = (target.stats?.defense ?? 0) * defMul + d10();
        damage = Math.max(1, attackValue - defenseValue);
      }

      target.hp = Math.max(0, Math.min(target.maxHp, target.hp - damage));
      pushLog(
        b,
        `→ ${actor.name}이(가) ${target.name}에게 ${crit ? '치명타 ' : ''}공격 (피해 ${damage}) → HP ${target.hp}`,
        'result'
      );
    };

    for (const it of allIntents) {
      if (it.type !== 'item') continue;
      const actor = b.players.find(p => p.id === it.playerId);
      if (!actor || actor.hp <= 0) continue;

      const kind = it.raw?.item;
      if (kind === 'dittany' || kind === 'ditany') {
        if ((actor.items.dittany ?? 0) > 0) {
          actor.items.dittany -= 1;
          const tgt = it.raw?.targetId ? (b.players.find(p=>p.id===it.raw.targetId) || actor) : actor;
          if (tgt.hp > 0) {
            const heal = 10 + Math.floor((actor.stats?.luck ?? 0) / 2);
            tgt.hp = Math.min(tgt.maxHp, Math.max(0, tgt.hp + heal));
            pushLog(b, `→ ${actor.name}이(가) 디터니 사용 — ${tgt.name} HP +${heal} → HP ${tgt.hp}`, 'result');
          }
        } else {
          pushLog(b, `→ ${actor.name}이(가) 디터니 사용 실패(재고 없음)`, 'result');
        }
      } else if (kind === 'attackBooster') {
        if ((actor.items.attackBooster ?? 0) > 0) {
          actor.items.attackBooster -= 1; // 1회용 소모

          const tgt = it.raw?.targetId ? b.players.find(p => p.id === it.raw.targetId) : null;
          if (tgt && tgt.hp > 0) {
            // 대상 지정 시: 즉시 강화 공격 실행
            pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용 — 즉시 강화 공격`, 'result');
            resolveSingleAttack(actor, tgt, /*useAtkBoost*/ true);
          } else {
            // 대상 미지정: 그 라운드 일반 공격 시에만 공격×2 적용
            atkBoost.add(actor.id);
            pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용 — 이 라운드 공격 강화`, 'result');
          }
        } else {
          pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용 실패(재고 없음)`, 'result');
        }
      } else if (kind === 'defenseBooster') {
        if ((actor.items.defenseBooster ?? 0) > 0) {
          actor.items.defenseBooster -= 1; // 1회용 소모
          defBoost.add(actor.id);          // 방어 의도 시 방어×2
          pushLog(b, `→ ${actor.name}이(가) 방어 보정기 사용`, 'result');
        } else {
          pushLog(b, `→ ${actor.name}이(가) 방어 보정기 사용 실패(재고 없음)`, 'result');
        }
      }
    }

    // 2) 팀별 전투 의도 해석(선→후), 팀 내부 민첩 우선
    const resolveTeam = (team) => {
      const intents = b.choices[team] || [];
      if (!intents.length) return;
      const order = sortByInitiative(
        intents.map(c => b.players.find(p => p.id === c.playerId)).filter(Boolean)
      ).map(p => p.id);

      for (const pid of order) {
        const intent = intents.find(c => c.playerId === pid);
        if (!intent) continue;
        const actor = b.players.find(p => p.id === pid);
        if (!actor || actor.hp <= 0) continue;

        if (intent.type === 'pass') {
          pushLog(b, `→ ${actor.name}이(가) 행동을 생략`, 'result');
          continue;
        }
        if (intent.type === 'defend') {
          pushLog(b, `→ ${actor.name}이(가) 방어 태세`, 'result');
          continue;
        }
        if (intent.type === 'dodge') {
          pushLog(b, `→ ${actor.name}이(가) 회피 태세`, 'result');
          continue;
        }
        if (intent.type === 'item') {
          // 아이템은 위에서 이미 처리/소모/로그 완료
          continue;
        }
        if (intent.type === 'attack') {
          const target = intent.targetId ? b.players.find(p => p.id === intent.targetId) : null;
          if (!target || target.hp <= 0) continue;
          // 일반 공격: atkBoost에 있으면 공격×2
          resolveSingleAttack(actor, target, atkBoost.has(actor.id));
        }
      }

      // 팀 의도 큐 비우기
      b.choices[team] = [];
    };

    resolveTeam(first);
    resolveTeam(second);

    // 승리/라운드 처리
    const winner = checkWinner(b);
    pushLog(b, `=== ${b.round}라운드 종료 ===`, 'result');

    if (winner) {
      b.status = 'ended';
      b.phase = 'idle';
      b.currentTeam = null;
      b.turnCursor = null;
      if (winner === 'Draw') pushLog(b, `무승부`, 'result');
      else pushLog(b, `${winner}팀 승리!`, 'result');
      touch(b);
      return;
    }

    // 다음 라운드: 선후 교대
    b.round += 1;
    b.nextFirstTeam = (b.nextFirstTeam === 'A') ? 'B' : 'A';
    b.selectionDone = { A: false, B: false };
    b.phase = 'inter';
    b.phaseEndsAt = now() + 5_000;
    pushLog(b, '5초 후 다음 라운드 시작...', 'system');
    touch(b);

    setTimeout(() => {
      if (b.status !== 'active') return;
      startSelectPhase(b, b.nextFirstTeam);
    }, 50);
  }

  // 수동 종료
  function end(battleId) {
    const b = get(battleId);
    if (!b) return null;
    b.status = 'ended';
    b.phase = 'idle';
    b.turnCursor = null;
    b.phaseEndsAt = null;
    touch(b);
    return b;
  }

  // 토큰 인증
  function authByToken(battleId, token) {
    const b = get(battleId);
    if (!b) return null;
    return b.players.find(p => p.token === token) || null;
  }

  return {
    setLogger, setUpdate,
    size, get, snapshot,
    create, addPlayer, removePlayer,
    markReady, start, playerAction,
    end, authByToken
  };
}
