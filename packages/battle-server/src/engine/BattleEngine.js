/* ESM BattleEngine
 * - 선택 페이즈: '의도 로그'만 송출 (누가 누구에게 무엇을 하려 한다)
 * - 해석 페이즈(resolve): 수치 적용과 '결과 로그' 일괄 송출
 * - 팀당 선택 제한: 5분 (UI는 남은 초 표시)
 * - 선후공: 라운드마다 교대 (1라운드 선공 결정 → 다음 라운드는 반대 팀이 선공)
 * - 팀 내부 실행 순서: 민첩 내림차순, 동률 시 이름 오름차순(ABC)
 * - 전투 한도: 1시간(하드리밋) – 시간 종료 시 생존 HP 합산으로 승자 판정
 * - 아이템: 모두 1회용(디터니, 공격 보정기, 방어 보정기)
 *   · 디터니: 고정 10 회복
 *   · 공격 보정기: 대상 지정 시 즉시 '강화 공격' 1회 수행
 *   · 방어 보정기: 그 라운드 방어 의도 시 방어×2 적용
 */

import { randomUUID } from 'node:crypto';

const now = () => Date.now();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const TEAM_SELECT_MS = 5 * 60 * 1000; // 팀당 5분
const ROUND_BREAK_MS = 5_000;         // 라운드 간 5초 인터벌
const RESOLVE_WINDOW_MS = 3_000;      // 해석 표시 시간

// d10: 1~10
const d10 = () => 1 + Math.floor(Math.random() * 10);

// 팀
const teamOf = (p) => (p?.team === 'B' ? 'B' : 'A');

// 민첩 내림차순, 동률이면 이름 오름차순
function sortByInitiative(players) {
  return [...players].sort((a, b) => {
    const ag = (b.stats?.agility ?? 0) - (a.stats?.agility ?? 0);
    if (ag !== 0) return ag;
    return (a.name || '').localeCompare((b.name || ''), 'ko-KR');
  });
}

export function createBattleStore() {
  const battles = new Map();

  // 서버 브로드캐스트 훅(서버에서 setLogger/setUpdate로 주입)
  let onLog = null;     // (battleId, logEntry)
  let onUpdate = null;  // (battleId) => void

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
    const timeLeftSec = Math.max(0, Math.ceil(((b.phaseEndsAt || now()) - now()) / 1000));
    const currentPlayer = b.turnCursor?.playerId
      ? b.players.find(p => p.id === b.turnCursor.playerId) || null
      : null;

    return {
      id: b.id,
      status: b.status,          // waiting | active | paused | ended
      phase: b.phase,            // idle | A_select | B_select | resolve | inter
      round: b.round,
      currentTeam: b.currentTeam,   // 선택 페이즈에서만 의미 있음
      nextFirstTeam: b.nextFirstTeam,
      createdAt: b.createdAt,
      hardLimitAt: b.hardLimitAt,
      currentTurn: {
        round: b.round,
        currentTeam: b.currentTeam,
        timeLeftSec,
        currentPlayer
      },
      players: b.players.map(p => ({
        id: p.id, name: p.name, team: p.team, avatar: p.avatar,
        hp: p.hp, maxHp: p.maxHp,
        ready: !!p.ready,
        stats: { ...p.stats },
        items: { ...p.items }
      }))
    };
  }

  // 유틸
  const teamAlive = (b, team) => b.players.some(p => p.team === team && p.hp > 0);
  const bothTeamsAlive = (b) => teamAlive(b, 'A') && teamAlive(b, 'B');

  function create(mode = '2v2') {
    const id = randomUUID();
    const battle = {
      id,
      mode,
      status: 'waiting',
      phase: 'idle',
      round: 0,
      currentTeam: null,
      nextFirstTeam: null,        // 다음 라운드 선공 팀
      selectionDone: { A: false, B: false },
      players: [],
      choices: { A: [], B: [] },  // 팀별 의도 큐
      logs: [],
      createdAt: now(),
      hardLimitAt: now() + 60 * 60 * 1000, // 1시간 하드리밋
      turnCursor: null,            // { team, order:[playerId...], index, playerId }
      phaseEndsAt: null
    };
    battles.set(id, battle);
    return battle;
  }

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
        dittany:        +(player.items?.dittany ?? player.items?.ditany ?? 0),
        attackBooster:  +(player.items?.attackBooster ?? player.items?.attack_boost ?? 0),
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
    ['A', 'B'].forEach(t => { b.choices[t] = b.choices[t].filter(c => c.playerId !== playerId); });
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

  function start(battleId) {
    const b = get(battleId);
    if (!b || b.status !== 'waiting') return null;
    if (!allReady(b)) {
      pushLog(b, '모든 플레이어가 준비되면 시작할 수 있습니다', 'notice');
      touch(b);
      return null;
    }

    b.status = 'active';
    b.round = 1;

    // 선공 결정: 팀 평균 민첩 + d10
    const teamA = b.players.filter(p => p.team === 'A');
    const teamB = b.players.filter(p => p.team === 'B');
    const avgA = teamA.reduce((s, p) => s + (p.stats?.agility ?? 0), 0) / Math.max(1, teamA.length);
    const avgB = teamB.reduce((s, p) => s + (p.stats?.agility ?? 0), 0) / Math.max(1, teamB.length);
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
    b.choices[team] = []; // 해당 팀 의도 초기화

    const alive = sortByInitiative(b.players.filter(p => p.team === team && p.hp > 0));
    b.turnCursor = { team, order: alive.map(p => p.id), index: 0, playerId: alive[0]?.id || null };
    b.phaseEndsAt = now() + TEAM_SELECT_MS;

    pushLog(b, `=== ${team}팀 선택 페이즈 시작 ===`, team === 'A' ? 'teamA' : 'teamB');
    touch(b);
  }

  // 선택(의도만 저장, 의도 로그만)
  function playerAction(battleId, playerId, action) {
    const b = get(battleId);
    if (!b || b.status !== 'active') return null;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return null;

    const p = b.players.find(x => x.id === playerId);
    if (!p || p.hp <= 0) return null;
    const team = teamOf(p);
    if (team !== b.currentTeam) return null;

    // 이 플레이어의 기존 의도 제거 후 덮어쓰기
    b.choices[team] = b.choices[team].filter(c => c.playerId !== p.id);

    // 대상
    let target = null;
    if (action?.targetId) {
      target = b.players.find(x => x.id === action.targetId) || null;
    }

    const intent = {
      playerId: p.id,
      type: action?.type,          // attack | defend | dodge | item | pass
      targetId: target?.id || null,
      raw: { ...action }
    };
    b.choices[team].push(intent);

    // 의도 로그
    if (intent.type === 'attack') {
      pushLog(b, `→ ${p.name}이(가) ${target?.name ?? '대상'}에게 공격`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'defend') {
      pushLog(b, `→ ${p.name}이(가) 방어를 준비`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'dodge') {
      pushLog(b, `→ ${p.name}이(가) 회피를 준비`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'item') {
      const itemName =
        (intent.raw.item === 'dittany' || intent.raw.item === 'ditany') ? '디터니' :
        (intent.raw.item === 'attackBooster') ? '공격 보정기' :
        (intent.raw.item === 'defenseBooster') ? '방어 보정기' : '아이템';
      const tgtName = intent.raw.targetId ? (b.players.find(x => x.id === intent.raw.targetId)?.name ?? '대상') : '자신/팀원';
      pushLog(b, `→ ${p.name}이(가) ${itemName} 사용 예정 (${tgtName})`, team === 'A' ? 'teamA' : 'teamB');
    } else if (intent.type === 'pass') {
      pushLog(b, `→ ${p.name}이(가) 패스`, team === 'A' ? 'teamA' : 'teamB');
    } else {
      pushLog(b, `→ ${p.name} 행동 선택`, team === 'A' ? 'teamA' : 'teamB');
    }

    // 커서 진행(표시)
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

  // 선공 팀 → 후공 팀 → 해석
  function finishSelectOrNext(b) {
    if (b.status !== 'active') return;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return;

    const firstTeamThisRound = b.nextFirstTeam || 'A';
    const secondTeam = firstTeamThisRound === 'A' ? 'B' : 'A';

    // 선공이 끝났고, 후공이 아직이면 후공 선택으로
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

  // 해석 – 이 라운드의 모든 의도 적용(결과 로그 송출)
  function startResolve(b) {
    if (b.status !== 'active') return;
    b.phase = 'resolve';
    b.currentTeam = null;
    b.turnCursor = null;
    b.phaseEndsAt = now() + RESOLVE_WINDOW_MS;

    pushLog(b, '라운드 해석', 'result');
    touch(b);

    const first = b.nextFirstTeam || 'A';
    const second = first === 'A' ? 'B' : 'A';

    // 방어 의도/보정기 탐지용
    const allIntents = [...(b.choices.A || []), ...(b.choices.B || [])];
    const defBoost = new Set();     // 방어 보정기 적용 대상(해당 라운드 동안)
    const announceAttackBoost = []; // 메시지용

    // 아이템 우선 처리(보정기는 소비 + 플래그)
    for (const it of allIntents) {
      if (it.type !== 'item') continue;
      const actor = b.players.find(p => p.id === it.playerId);
      if (!actor || actor.hp <= 0) continue;
      const kind = it.raw?.item;

      if (kind === 'dittany' || kind === 'ditany') {
        if ((actor.items.dittany ?? 0) > 0) {
          actor.items.dittany -= 1;
          const tgt = it.raw?.targetId ? (b.players.find(p => p.id === it.raw.targetId) || actor) : actor;
          if (tgt.hp > 0) {
            const heal = 10; // 고정 10
            tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
            pushLog(b, `→ ${actor.name}이(가) 디터니 사용 — ${tgt.name} HP +${heal} → HP ${tgt.hp}`, 'result');
          }
        } else {
          pushLog(b, `→ ${actor.name}이(가) 디터니 사용 실패(재고 없음)`, 'result');
        }
      } else if (kind === 'defenseBooster') {
        if ((actor.items.defenseBooster ?? 0) > 0) {
          actor.items.defenseBooster -= 1;
          // 이 라운드에 'defend' 의도가 있는 경우 방어×2 적용
          const hasDefend = allIntents.some(c => c.playerId === actor.id && c.type === 'defend');
          if (hasDefend) {
            defBoost.add(actor.id);
            pushLog(b, `→ ${actor.name}이(가) 방어 보정기 사용 — 방어 강화`, 'result');
          } else {
            pushLog(b, `→ ${actor.name}이(가) 방어 보정기 사용(방어 의도 없음)`, 'result');
          }
        } else {
          pushLog(b, `→ ${actor.name}이(가) 방어 보정기 사용 실패(재고 없음)`, 'result');
        }
      } else if (kind === 'attackBooster') {
        if ((actor.items.attackBooster ?? 0) > 0) {
          actor.items.attackBooster -= 1;
          // 대상 지정 시 즉시 강화 공격 1회 수행
          const tgt = it.raw?.targetId ? (b.players.find(p => p.id === it.raw.targetId) || null) : null;
          if (tgt && tgt.hp > 0) {
            resolveSingleAttack(b, actor, tgt, /*useAtkBoost*/ true, defBoost, allIntents);
            announceAttackBoost.push(actor.id); // 이미 로그가 뜨지만 사용 흔적용
          } else {
            pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용(대상 부재)`, 'result');
          }
        } else {
          pushLog(b, `→ ${actor.name}이(가) 공격 보정기 사용 실패(재고 없음)`, 'result');
        }
      }
    }

    // 선/후 팀 순으로 공격/방어/회피/패스 의도 해석
    resolveTeamByOrder(b, first, defBoost, allIntents);
    resolveTeamByOrder(b, second, defBoost, allIntents);

    // 라운드 종료 및 승리 판정
    pushLog(b, `=== ${b.round}라운드 종료 ===`, 'result');

    // 하드 리밋 체크(1시간)
    if (now() >= b.hardLimitAt) {
      endByHpSum(b);
      touch(b);
      return;
    }

    // KO로 즉시 종료?
    if (!bothTeamsAlive(b)) {
      const win = teamAlive(b, 'A') ? 'A' : teamAlive(b, 'B') ? 'B' : null;
      if (win) {
        pushLog(b, `${win}팀 승리!`, 'result');
        b.status = 'ended';
        b.phase = 'idle';
        b.turnCursor = null;
        b.phaseEndsAt = null;
        touch(b);
        return;
      }
    }

    // 다음 라운드 준비(선후공 교대)
    b.round += 1;
    b.nextFirstTeam = (b.nextFirstTeam === 'A') ? 'B' : 'A';
    b.selectionDone = { A: false, B: false };
    b.phase = 'inter';
    b.phaseEndsAt = now() + ROUND_BREAK_MS;
    pushLog(b, '5초 후 다음 라운드 시작...', 'system');
    touch(b);

    // 다음 라운드 진입
    setTimeout(() => {
      if (b.status !== 'active') return;
      pushLog(b, `${b.round}라운드 시작`, 'system');
      startSelectPhase(b, b.nextFirstTeam);
    }, 50);
  }

  // 한 번의 공격 로직(회피/방어 고려), useAtkBoost=true면 공격×2 계수
  function resolveSingleAttack(b, actor, target, useAtkBoost, defBoostSet, allIntents) {
    if (!actor || !target || actor.hp <= 0 || target.hp <= 0) return;

    // 최종공격력 = attack × (보정기면 ×2, 아니면 ×1) + d10
    const finalAttack = (actor.stats?.attack ?? 0) * (useAtkBoost ? 2 : 1) + d10();

    // 회피: 대상 민첩 + d10 vs 공격자의 최종공격력
    const dodgeScore = (target.stats?.agility ?? 0) + d10();
    if (dodgeScore >= finalAttack) {
      pushLog(b, `→ ${actor.name}의 공격을 ${target.name}이(가) 회피`, 'result');
      return;
    }

    // 치명타: d10 ≥ (10 − 행운/2)
    const luck = (actor.stats?.luck ?? 0);
    const crit = d10() >= (10 - Math.floor(luck / 2));
    const attackValue = crit ? (finalAttack * 2) : finalAttack;

    // 방어: 방어 의도 시 (방어×(보정이면 2)) + d10 만큼 피해 차감
    let damage = attackValue;
    const targetDefendIntent = allIntents.find(c => c.playerId === target.id && c.type === 'defend');
    if (targetDefendIntent) {
      const defMul = defBoostSet.has(target.id) ? 2 : 1;
      const defenseValue = (target.stats?.defense ?? 0) * defMul + d10();
      damage = Math.max(1, attackValue - defenseValue);
    }

    target.hp = clamp(target.hp - damage, 0, target.maxHp);
    pushLog(b, `→ ${actor.name}이(가) ${target.name}에게 ${crit ? '치명타 ' : ''}공격 (피해 ${damage}) → HP ${target.hp}`, 'result');
  }

  // 팀 해석: 팀 내부 이니시 순으로 (attack/defend/dodge/pass) 의도 처리
  function resolveTeamByOrder(b, team, defBoostSet, allIntents) {
    // 해당 팀 의도들
    const intents = (b.choices[team] || []).slice();
    if (!intents.length) return;

    // 실행 순서: 민첩 내림차순 → 이름 오름차순
    const order = sortByInitiative(
      intents
        .map(c => b.players.find(p => p.id === c.playerId))
        .filter(Boolean)
    ).map(p => p.id);

    for (const pid of order) {
      const intent = intents.find(c => c.playerId === pid);
      if (!intent) continue;

      const actor = b.players.find(p => p.id === pid);
      if (!actor || actor.hp <= 0) continue;

      if (intent.type === 'attack') {
        const tgt = intent.targetId ? b.players.find(p => p.id === intent.targetId) : null;
        if (tgt && tgt.hp > 0) {
          resolveSingleAttack(b, actor, tgt, /*useAtkBoost*/ false, defBoostSet, allIntents);
        }
      } else if (intent.type === 'defend') {
        pushLog(b, `→ ${actor.name}이(가) 방어 태세`, 'result');
      } else if (intent.type === 'dodge') {
        pushLog(b, `→ ${actor.name}이(가) 회피 태세`, 'result');
      } else if (intent.type === 'item') {
        // 아이템은 위(아이템 처리 블록)에서 이미 소비/적용/로그 처리함
        // 여기서는 넘어감
      } else if (intent.type === 'pass') {
        pushLog(b, `→ ${actor.name}이(가) 행동을 생략`, 'result');
      }
    }

    // 의도 큐 비우기
    b.choices[team] = [];
  }

  // 하드리밋(1시간) 종료: 생존 HP 합산 승자 판정
  function endByHpSum(b) {
    const sumA = b.players.filter(p => p.team === 'A' && p.hp > 0).reduce((s, p) => s + p.hp, 0);
    const sumB = b.players.filter(p => p.team === 'B' && p.hp > 0).reduce((s, p) => s + p.hp, 0);
    let msg = '';
    if (sumA > sumB) msg = 'A';
    else if (sumB > sumA) msg = 'B';
    else msg = '무승부';
    pushLog(b, `시간 종료 — 생존 HP 합산: A=${sumA}, B=${sumB}`, 'result');
    if (msg === '무승부') {
      pushLog(b, `무승부 처리`, 'result');
    } else {
      pushLog(b, `${msg}팀 승리!`, 'result');
    }
    b.status = 'ended';
    b.phase = 'idle';
    b.turnCursor = null;
    b.phaseEndsAt = null;
  }

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

  // 토큰 인증(플레이어 찾기)
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
    end, authByToken,
  };
}
