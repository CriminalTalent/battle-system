/* ESM BattleEngine – 선택 페이즈는 '의도 로그', 해석 페이즈에서만 '결과+적용' */

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
    // 얕은 스냅샷 (UI용)
    const { id: bid, status, phase, round, currentTeam, nextFirstTeam, createdAt, hardLimitAt } = b;
    const currentPlayer = b.turnCursor?.playerId
      ? b.players.find(p => p.id === b.turnCursor.playerId) || null
      : null;
    const timeLeftSec = Math.max(0, Math.ceil(((b.phaseEndsAt || now()) - now()) / 1000));
    return {
      id: bid,
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
      currentTeam: null, // 'A' or 'B' – 현재 선택 페이즈 팀
      nextFirstTeam: null, // 다음 라운드 선공팀
      players: [],
      choices: { A: [], B: [] }, // 선택 큐(의도만 저장)
      logs: [],
      createdAt: now(),
      hardLimitAt: now() + 60 * 60 * 1000, // 1시간 제한 (필요시 서버 레이어에서 사용)
      turnCursor: null,        // UI용 현재 차례 플레이어 (선택 페이즈 표시 목적)
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
    // 선택 큐에서도 제거
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

  /** 전투 시작 – 선공팀 결정 + A/B 선택 페이즈 중 선공팀부터 */
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
    b.nextFirstTeam = first; // 1라운드 선공 기록(라운드 종료 시 반전)
    pushLog(b, `선공 결정: A팀(민첩 ${Math.floor(avgA)} + ${rollA} = ${scoreA}) vs B팀(민첩 ${Math.floor(avgB)} + ${rollB} = ${scoreB})`, 'system');
    pushLog(b, `${first}팀이 선공입니다!`, 'system');
    pushLog(b, '전투가 시작되었습니다!', 'system');
    pushLog(b, `${b.round}라운드 시작`, 'system');

    // 선택 페이즈 시작(의도만 수집)
    startSelectPhase(b, first);
    return { b };
  }

  function startSelectPhase(b, team) {
    b.phase = (team === 'A') ? 'A_select' : 'B_select';
    b.currentTeam = team;
    b.choices[team] = []; // 당 라운드 해당 팀 선택 큐 초기화
    // 팀 내 턴커서(표시용) – 민첩/ABC 정렬
    const alive = sortByInitiative(b.players.filter(p => p.team === team && p.hp > 0));
    b.turnCursor = { team, order: alive.map(p=>p.id), index: 0, playerId: alive[0]?.id || null };
    b.phaseEndsAt = now() + 30_000; // UI 타이머용(선택 제한 30초 가정)
    pushLog(b, `=== ${team}팀 선택 페이즈 시작 ===`, team === 'A' ? 'teamA' : 'teamB');
  }

  /** 다음 팀 선택 or 해석으로 전환 */
  function finishSelectOrNext(b) {
    if (b.currentTeam === 'A') {
      // B 선택으로
      startSelectPhase(b, 'B');
    } else {
      // 해석으로
      startResolve(b);
    }
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

    // 중복 선택 방지: 기존 의도 제거 후 덮어쓰기
    b.choices[team] = b.choices[team].filter(c => c.playerId !== p.id);

    // 대상 유효성 검증(의도 수집 시 살아있는지 정도만 체크)
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

    // 의도 로그(피해/회복 없음, 내용만)
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

    if (done) {
      pushLog(b, `[${team}] ${team}팀 선택 완료`, team === 'A' ? 'teamA' : 'teamB');
      finishSelectOrNext(b);
    }
    return { b, result: { queued: true } };
  }

  /** 해석 – 결과(수치 포함) 출력 + HP/아이템 실제 적용 */
  function startResolve(b) {
    b.phase = 'resolve';
    b.currentTeam = null;
    b.turnCursor = null;
    b.phaseEndsAt = now() + 3_000;

    pushLog(b, '라운드 해석', 'result');

    const first = b.nextFirstTeam || 'A';
    const second = first === 'A' ? 'B' : 'A';

    // 해석 순서: 선공팀 → 후공팀
    resolveTeam(b, first);
    resolveTeam(b, second);

    // 라운드 종료/다음 라운드
    pushLog(b, `=== ${b.round}라운드 종료 ===`, 'result');
    b.round += 1;
    b.nextFirstTeam = (b.nextFirstTeam === 'A') ? 'B' : 'A'; // 선후공 교대
    b.phase = 'inter';
    b.phaseEndsAt = now() + 5_000;

    // 5초 후 다음 라운드 자동 시작(서버 틱 없이 간단 타이머)
    setTimeout(() => {
      if (b.status !== 'active') return;
      pushLog(b, '5초 후 다음 라운드 시작...', 'system');
      startSelectPhase(b, b.nextFirstTeam);
    }, 50); // 로그 즉시 송출
  }

  /** 한 팀의 의도들을 팀 내부 이니시 순으로 실행 */
  function resolveTeam(b, team) {
    const intents = b.choices[team] || [];
    if (!intents.length) return;

    // 팀 내 순서(민첩↓, 이름 오름차순)로 플레이어 목록 생성
    const order = sortByInitiative(
      intents
        .map(c => b.players.find(p => p.id === c.playerId))
        .filter(Boolean)
    ).map(p => p.id);

    // 실행
    for (const pid of order) {
      const intent = intents.find(c => c.playerId === pid);
      if (!intent) continue;
      const actor = b.players.find(p => p.id === pid);
      if (!actor || actor.hp <= 0) continue;

      const target = intent.targetId ? b.players.find(p => p.id === intent.targetId) : null;

      if (intent.type === 'attack') {
        if (!target || target.hp <= 0) continue;
        // 치명타 여부 (운/민첩 약간 반영)
        const critChance = clamp(0.05 + (actor.stats?.luck ?? 0) * 0.02, 0, 0.5);
        const isCrit = Math.random() < critChance;
        const dmg = calcDamage(actor, target, isCrit, false);
        target.hp = clamp(target.hp - dmg, 0, target.maxHp);
        pushLog(
          b,
          `→ ${actor.name}이(가) ${target.name}에게 ${isCrit ? '치명타 ' : ''}공격 (피해 ${dmg}) → HP ${target.hp}`,
          'result'
        );
      } else if (intent.type === 'defend') {
        // 다음 해석 1회 한정 방어 버프(간단: 임시 방어+2)
        actor.stats._defTmp = (actor.stats._defTmp ?? 0) + 2;
        pushLog(b, `→ ${actor.name}이(가) 방어 태세`, 'result');
      } else if (intent.type === 'dodge') {
        actor.stats._dodgeTmp = (actor.stats._dodgeTmp ?? 0) + 1; // 이후 로직에 반영 여지
        pushLog(b, `→ ${actor.name}이(가) 회피 태세`, 'result');
      } else if (intent.type === 'item') {
        const it = intent.raw?.item;
        if (it === 'dittany' || it === 'ditany') {
          const tgt = intent.raw?.targetId ? (b.players.find(p=>p.id===intent.raw.targetId) || actor) : actor;
          if (actor.items.dittany > 0 && tgt.hp > 0) {
            actor.items.dittany -= 1;
            const heal = calcHeal(actor);
            tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp);
            pushLog(b, `→ ${actor.name}이(가) 디터니 사용 — ${tgt.name} HP +${heal} → HP ${tgt.hp}`, 'result');
          }
        } else if (it === 'attackBooster') {
          const tgt = intent.raw?.targetId ? (b.players.find(p=>p.id===intent.raw.targetId)) : null;
          if (actor.items.attackBooster > 0) {
            actor.items.attackBooster -= 1;
            const realTarget = tgt && tgt.hp > 0 ? tgt : null;
            const dmg = realTarget ? calcDamage(actor, realTarget, Math.random()<0.2, true) : 0;
            if (realTarget) {
              realTarget.hp = clamp(realTarget.hp - dmg, 0, realTarget.maxHp);
              pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용 성공 — ${realTarget.name} 대상 즉시 강화 공격 (피해 ${dmg}) → HP ${realTarget.hp}`, 'result');
            } else {
              pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용(대상 부재)`, 'result');
            }
          }
        } else if (it === 'defenseBooster') {
          if (actor.items.defenseBooster > 0) {
            actor.items.defenseBooster -= 1;
            actor.stats._defTmp = (actor.stats._defTmp ?? 0) + 4;
            pushLog(b, `→ ${actor.name}이(가) 방어 보정기 사용 — 방어 강화`, 'result');
          }
        } else {
          pushLog(b, `→ ${actor.name}이(가) 아이템 사용 시도`, 'result');
        }
      } else if (intent.type === 'pass') {
        pushLog(b, `→ ${actor.name}이(가) 행동을 생략`, 'result');
      }
    }

    // 임시 버프 해제
    b.players.forEach(p => {
      if (p.stats._defTmp) delete p.stats._defTmp;
      if (p.stats._dodgeTmp) delete p.stats._dodgeTmp;
    });

    // 팀 의도 큐 소거
    b.choices[team] = [];
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
