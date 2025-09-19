/* ESM BattleEngine – 선택 페이즈는 '의도 로그', 해석 페이즈에서만 '결과+적용(일괄)' */

import { randomUUID } from 'node:crypto';

const now = () => Date.now();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** 내부 유틸 – 정렬: 민첩 내림차순, 동률 시 이름 오름차순(ABC) */
function sortByInitiative(players) {
  return [...players].sort((a, b) => {
    const ag = (b.stats?.agility ?? 0) - (a.stats?.agility ?? 0);
    if (ag !== 0) return ag;
    const an = (a.name || '').toString();
    const bn = (b.name || '').toString();
    return an.localeCompare(bn, 'ko-KR');
  });
}

/** 대미지 간단 공식 */
function calcDamage(attacker, defender, crit = false, boosted = false) {
  const atk = attacker.stats?.attack ?? 0;
  const def = defender.stats?.defense ?? 0;
  const base = Math.max(1, atk * (boosted ? 2 : 1) - Math.floor(def / 2));
  const critMul = crit ? 2 : 1;
  const roll = 0.85 + Math.random() * 0.3; // 0.85~1.15
  return Math.max(1, Math.floor(base * critMul * roll));
}

/** 치유량 간단 공식 */
function calcHeal(user) {
  return 10 + Math.floor((user.stats?.luck ?? 0) / 2);
}

/** 로그 push 헬퍼 */
function pushLog(battle, message, type = 'system') {
  battle.logs.push({ ts: now(), type, message });
}

/** 팀 문자 'A' | 'B' 검증 */
const teamOf = (p) => (p?.team === 'B' ? 'B' : 'A');

/** 엔진 스토어 */
export function createBattleStore() {
  const battles = new Map(); // id -> battle

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

  /** 전투 생성 */
  function create(mode = '2v2') {
    const id = randomUUID();
    const battle = {
      id,
      mode,
      status: 'waiting', // waiting|active|paused|ended
      phase: 'idle',     // idle|A_select|B_select|resolve|inter
      round: 0,
      currentTeam: null,     // 현재 선택 페이즈의 팀
      nextFirstTeam: null,   // 해당 라운드 선공팀(라운드 끝나면 교대)
      selectionDone: { A: false, B: false }, // 라운드 선택 완료 플래그
      players: [],
      choices: { A: [], B: [] }, // 의도 큐
      logs: [],
      createdAt: now(),
      hardLimitAt: now() + 60 * 60 * 1000, // 1시간 제한
      turnCursor: null,        // UI용 현재 차례 플레이어
      phaseEndsAt: null
    };
    battles.set(id, battle);
    return battle;
  }

  /** 플레이어 추가 */
  function addPlayer(battleId, player) {
    const b = get(battleId);
    if (!b) return null;
    const id = player.id || randomUUID();
    const p = {
      id,
      team: player.team === 'B' ? 'B' : 'A',
      name: player.name || `P${b.players.length + 1}`,
      avatar: player.avatar || '',
      hp: Number.isFinite(player.hp) ? player.hp : 100,
      maxHp: Number.isFinite(player.maxHp) ? player.maxHp : (Number.isFinite(player.hp) ? player.hp : 100),
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
    return p;
  }

  function removePlayer(battleId, playerId) {
    const b = get(battleId);
    if (!b) return false;
    const idx = b.players.findIndex(p => p.id === playerId);
    if (idx === -1) return false;
    b.players.splice(idx, 1);
    ['A','B'].forEach(t => { b.choices[t] = b.choices[t].filter(c => c.playerId !== playerId); });
    return true;
  }

  function markReady(battleId, playerId, ready = true) {
    const b = get(battleId);
    if (!b) return false;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return false;
    p.ready = !!ready;
    pushLog(b, `${p.name}이(가) 준비 완료했습니다`, 'system');
    return true;
  }

  function allReady(b) {
    const teams = new Set(b.players.map(p => p.team));
    if (teams.size !== 2) return false;
    return b.players.every(p => p.ready);
  }

  /** 전투 시작 – 선공팀 결정 + 선공팀 선택부터 */
  function start(battleId) {
    const b = get(battleId);
    if (!b) return null;
    if (b.status !== 'waiting') return null;

    if (!allReady(b)) {
      pushLog(b, '모든 플레이어가 준비되면 시작할 수 있습니다', 'notice');
      return null;
    }

    b.status = 'active';
    b.round = 1;

    // 선공 결정: 두 팀의 민첩 평균 + 주사위(1~10)
    const teamA = b.players.filter(p => p.team === 'A');
    const teamB = b.players.filter(p => p.team === 'B');
    const avgA = teamA.reduce((s,p)=>s+(p.stats?.agility ?? 0),0) / Math.max(1,teamA.length);
    const avgB = teamB.reduce((s,p)=>s+(p.stats?.agility ?? 0),0) / Math.max(1,teamB.length);
    const rollA = 1 + Math.floor(Math.random()*10);
    const rollB = 1 + Math.floor(Math.random()*10);
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

    // 선택 페이즈 시작(의도만 수집)
    startSelectPhase(b, first);
    return { b };
  }

  /** 선택 페이즈 시작 (의도 수집 전용) — 팀 전환 시 의도 큐/커서 초기화 보장 */
  function startSelectPhase(b, team) {
    if (b.status !== 'active') return;

    b.phase = (team === 'A') ? 'A_select' : 'B_select';
    b.currentTeam = team;

    // 해당 팀의 의도 큐는 전환 시마다 초기화 (라운드 내 중복/잔여 방지)
    b.choices[team] = [];

    // 팀 내 생존자 이니시 정렬로 표시용 커서 구성
    const alive = sortByInitiative(b.players.filter(p => p.team === team && p.hp > 0));
    b.turnCursor = { team, order: alive.map(p => p.id), index: 0, playerId: alive[0]?.id || null };

    // 선택 페이즈 제한시간(클라이언트 UI 타이머용)
    b.phaseEndsAt = now() + 30_000;

    pushLog(b, `=== ${team}팀 선택 페이즈 시작 ===`, team === 'A' ? 'teamA' : 'teamB');
  }

  /** 선택(의도만 저장 & 의도 로그만 송출) */
  function playerAction(battleId, playerId, action) {
    const b = get(battleId);
    if (!b || b.status !== 'active') return null;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return null;

    const p = b.players.find(x => x.id === playerId);
    if (!p || p.hp <= 0) return null;
    const team = teamOf(p);
    if (team !== b.currentTeam) return null;

    // 의도 덮어쓰기(중복 선택 방지)
    b.choices[team] = b.choices[team].filter(c => c.playerId !== p.id);

    // 대상 유효성 검증(의도 수집 시는 생존 여부만)
    let target = null;
    if (action?.targetId) {
      target = b.players.find(x => x.id === action.targetId) || null;
    }

    // 의도 저장
    const intent = {
      playerId: p.id,
      type: action?.type,
      targetId: target?.id || null,
      raw: { ...action }
    };
    b.choices[team].push(intent);

    // 의도 로그(피해/회복 수치 없음)
    if (intent.type === 'attack') {
      pushLog(b, `→ ${p.name}이(가) ${target?.name ?? '대상'}에게 공격`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'defend') {
      pushLog(b, `→ ${p.name}이(가) 방어를 준비`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'dodge') {
      pushLog(b, `→ ${p.name}이(가) 회피를 준비`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'item') {
      const itemName = intent.raw.item === 'dittany' || intent.raw.item === 'ditany' ? '디터니'
        : intent.raw.item === 'attackBooster' ? '공격 보정기'
        : intent.raw.item === 'defenseBooster' ? '방어 보정기' : '아이템';
      const tgt = intent.raw.targetId ? (b.players.find(x=>x.id===intent.raw.targetId)?.name ?? '대상') : '자신';
      pushLog(b, `→ ${p.name}이(가) ${itemName} 사용 예정 (${tgt})`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'pass') {
      pushLog(b, `→ ${p.name}이(가) 패스`, team === 'A' ? 'teamA' : 'teamB');
    } else {
      pushLog(b, `→ ${p.name} 행동 선택`, team === 'A' ? 'teamA' : 'teamB');
    }

    // 턴커서 진행(표시용)
    if (b.turnCursor?.playerId === p.id) {
      b.turnCursor.index++;
      const nextId = b.turnCursor.order[b.turnCursor.index] || null;
      b.turnCursor.playerId = nextId;
    }

    // 팀 내 모든 생존자 의도 수집이 끝났는지 체크
    const aliveIds = new Set(b.players.filter(x => x.team === team && x.hp > 0).map(x => x.id));
    const chosenIds = new Set(b.choices[team].map(c => c.playerId));
    const done = [...aliveIds].every(id => chosenIds.has(id));

    if (done && !b.selectionDone[team]) {
      b.selectionDone[team] = true;
      pushLog(b, `[${team}] ${team}팀 선택 완료`, team === 'A' ? 'teamA' : 'teamB');
      finishSelectOrNext(b);
    }
    return { b, result: { queued: true } };
  }

  /** ✅ 확정: 이번 라운드 선공팀/후공팀 선택 흐름 보장 */
  function finishSelectOrNext(b) {
    if (b.status !== 'active') return;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return;

    const first = b.nextFirstTeam || 'A';
    const second = first === 'A' ? 'B' : 'A';

    const cur = b.currentTeam;              // 지금 선택 중이던 팀
    const curDone = !!b.selectionDone[cur];
    const other = cur === 'A' ? 'B' : 'A';  // 반대 팀
    const otherDone = !!b.selectionDone[other];

    // 1) 현재가 선공팀이고, 후공팀이 아직 미완료면 → 후공팀 선택 페이즈로 전환
    if (cur === first && curDone && !otherDone) {
      startSelectPhase(b, second);
      return;
    }

    // 2) 두 팀이 모두 완료되었으면 → 해석
    if (b.selectionDone.A && b.selectionDone.B) {
      startResolve(b);
      return;
    }

    // 3) 안정장치: 후공팀이 먼저 완료된 비정상 흐름이면 선공팀 선택으로 되돌림
    if (cur === second && curDone && !b.selectionDone[first]) {
      startSelectPhase(b, first);
      return;
    }
  }

  /** 해석 – 결과(수치 포함) '모두 계산 → 일괄 적용 & 로그 송출' */
  function startResolve(b) {
    if (b.status !== 'active') return;
    b.phase = 'resolve';
    b.currentTeam = null;
    b.turnCursor = null;
    b.phaseEndsAt = now() + 3_000;

    const first = b.nextFirstTeam || 'A';
    const second = first === 'A' ? 'B' : 'A';

    // 시뮬레이션 상태(실제 배틀 상태를 바꾸지 않고 계산)
    const simById = new Map();
    for (const p of b.players) {
      simById.set(p.id, {
        id: p.id,
        name: p.name,
        team: p.team,
        avatar: p.avatar,
        hp: p.hp,
        maxHp: p.maxHp,
        stats: { ...p.stats },
        items: { ...p.items },
      });
    }

    // 팀별 해석 결과(로그 텍스트를 먼저 모은다)
    const logsBuffer = [];
    const { logs: logsFirst } = computeTeamOutcomes(b, first, simById);
    const { logs: logsSecond } = computeTeamOutcomes(b, second, simById);

    // 해석 로그 일괄 송출
    pushLog(b, '라운드 해석', 'result');
    for (const line of logsFirst) pushLog(b, line, 'result');
    for (const line of logsSecond) pushLog(b, line, 'result');

    // 시뮬레이션 최종치를 실제 상태에 일괄 적용
    for (const p of b.players) {
      const sim = simById.get(p.id);
      p.hp = clamp(sim.hp, 0, p.maxHp);
      // 아이템(소모/사용) 반영
      p.items.dittany = Math.max(0, sim.items.dittany|0);
      p.items.attackBooster = Math.max(0, sim.items.attackBooster|0);
      p.items.defenseBooster = Math.max(0, sim.items.defenseBooster|0);
      // 임시 버프는 라운드 종료 시 제거
      if (p.stats._defTmp) delete p.stats._defTmp;
      if (p.stats._dodgeTmp) delete p.stats._dodgeTmp;
    }

    // 라운드 종료/다음 라운드
    pushLog(b, `=== ${b.round}라운드 종료 ===`, 'result');
    b.round += 1;

    // 선후공 교대
    b.nextFirstTeam = (b.nextFirstTeam === 'A') ? 'B' : 'A';

    // 다음 라운드 준비
    b.selectionDone = { A: false, B: false };
    b.phase = 'inter';
    b.phaseEndsAt = now() + 5_000;
    pushLog(b, '5초 후 다음 라운드 시작...', 'system');

    // 다음 라운드 시작(짧은 지연 후)
    setTimeout(() => {
      if (b.status !== 'active') return;
      startSelectPhase(b, b.nextFirstTeam);
    }, 50);
  }

  /**
   * ⚙️ 팀 해석(시뮬레이션만 변경) – 결과 로그 문자열만 반환
   * - 의도 큐를 이니시 순으로 처리하되, 실제 b.players는 건드리지 않음
   * - 모든 계산은 simById를 읽고/쓰며, 최종 적용은 startResolve에서 한 번에 수행
   */
  function computeTeamOutcomes(b, team, simById) {
    const intents = b.choices[team] || [];
    const logs = [];
    if (!intents.length) return { logs };

    const order = sortByInitiative(
      intents
        .map(c => simById.get(c.playerId))
        .filter(Boolean)
    ).map(p => p.id);

    for (const pid of order) {
      const intent = intents.find(c => c.playerId === pid);
      if (!intent) continue;

      const actor = simById.get(pid);
      if (!actor || actor.hp <= 0) continue;

      const target = intent.targetId ? simById.get(intent.targetId) : null;

      if (intent.type === 'attack') {
        if (!target || target.hp <= 0) continue;
        const critChance = clamp(0.05 + (actor.stats?.luck ?? 0) * 0.02, 0, 0.5);
        const isCrit = Math.random() < critChance;
        const dmg = calcDamage(actor, target, isCrit, false);
        target.hp = clamp(target.hp - dmg, 0, target.maxHp);
        logs.push(`→ ${actor.name}이(가) ${target.name}에게 ${isCrit ? '치명타 ' : ''}공격 (피해 ${dmg}) → HP ${target.hp}`);
      } else if (intent.type === 'defend') {
        actor.stats._defTmp = (actor.stats._defTmp ?? 0) + 2;
        logs.push(`→ ${actor.name}이(가) 방어 태세`);
      } else if (intent.type === 'dodge') {
        actor.stats._dodgeTmp = (actor.stats._dodgeTmp ?? 0) + 1;
        logs.push(`→ ${actor.name}이(가) 회피 태세`);
      } else if (intent.type === 'item') {
        const it = intent.raw?.item;
        if (it === 'dittany' || it === 'ditany') {
          const tgt = intent.raw?.targetId ? (simById.get(intent.raw?.targetId) || actor) : actor;
          if ((actor.items.dittany|0) > 0 && tgt.hp > 0) {
            actor.items.dittany = (actor.items.dittany|0) - 1;
            const heal = calcHeal(actor);
            tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp);
            logs.push(`→ ${actor.name}이(가) 디터니 사용 — ${tgt.name} HP +${heal} → HP ${tgt.hp}`);
          } else {
            logs.push(`→ ${actor.name}이(가) 디터니 사용 실패(재고/대상 불가)`);
          }
        } else if (it === 'attackBooster') {
          const tgt = intent.raw?.targetId ? simById.get(intent.raw?.targetId) : null;
          if ((actor.items.attackBooster|0) > 0) {
            actor.items.attackBooster = (actor.items.attackBooster|0) - 1;
            const realTarget = tgt && tgt.hp > 0 ? tgt : null;
            const dmg = realTarget ? calcDamage(actor, realTarget, Math.random()<0.2, true) : 0;
            if (realTarget) {
              realTarget.hp = clamp(realTarget.hp - dmg, 0, realTarget.maxHp);
              logs.push(`→ ${actor.name}이(가) 공격 보정기 사용 성공 — ${realTarget.name} 대상 즉시 강화 공격 (피해 ${dmg}) → HP ${realTarget.hp}`);
            } else {
              logs.push(`→ ${actor.name}이(가) 공격 보정기 사용(대상 부재)`);
            }
          } else {
            logs.push(`→ ${actor.name}이(가) 공격 보정기 사용 실패(재고 없음)`);
          }
        } else if (it === 'defenseBooster') {
          if ((actor.items.defenseBooster|0) > 0) {
            actor.items.defenseBooster = (actor.items.defenseBooster|0) - 1;
            actor.stats._defTmp = (actor.stats._defTmp ?? 0) + 4;
            logs.push(`→ ${actor.name}이(가) 방어 보정기 사용 — 방어 강화`);
          } else {
            logs.push(`→ ${actor.name}이(가) 방어 보정기 사용 실패(재고 없음)`);
          }
        } else {
          logs.push(`→ ${actor.name}이(가) 아이템 사용 시도`);
        }
      } else if (intent.type === 'pass') {
        logs.push(`→ ${actor.name}이(가) 행동을 생략`);
      }
    }

    // 팀 의도 큐는 실제 적용 단계에서 초기화할 것이므로 여기선 유지
    return { logs };
  }

  /** 전투 종료 */
  function end(battleId) {
    const b = get(battleId);
    if (!b) return null;
    b.status = 'ended';
    b.phase = 'idle';
    b.turnCursor = null;
    b.phaseEndsAt = null;
    return b;
  }

  /** 토큰 인증(플레이어 찾기) */
  function authByToken(battleId, token) {
    const b = get(battleId);
    if (!b) return null;
    return b.players.find(p => p.token === token) || null;
  }

  return {
    size, get, snapshot,
    create, addPlayer, removePlayer,
    markReady, start, playerAction,
    end, authByToken
  };
}
