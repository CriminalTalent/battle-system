// packages/battle-server/src/engine/BattleEngine.js
// ESM

/* BattleEngine (Store-Factory)
   - 선/후공 교체
   - 동일 민첩 시 이름(ABC) 순
   - 라운드 요약 중계 및 개별 로그
   - 1시간 제한 종료 시 팀 HP 합계로 승자 결정 (서든데스 없음)
*/

function uid(n = 8) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ---------- 전투 저장소 ---------- */
export function createBattleStore() {
  const battles = new Map(); // id -> battle

  /* ---------- 내부 유틸 ---------- */
  function pushLog(battleId, type, message) {
    const b = battles.get(battleId);
    if (!b) return;
    b.logs.push({ ts: Date.now(), type, message });
  }

  function sumTeamHp(b, team) {
    return b.players
      .filter(p => p.team === team)
      .reduce((acc, p) => acc + Math.max(0, p.hp | 0), 0);
  }

  // 시간 제한 체크: 마감이면 즉시 종료 처리(HP 합계 승부)
  function checkTimeLimitAndMaybeEnd(battleId) {
    const b = battles.get(battleId);
    if (!b) return false;
    if (!b.deadlineAt || b.status !== 'active') return false;

    if (Date.now() < b.deadlineAt) return false;

    const aHp = sumTeamHp(b, 'A');
    const bHp = sumTeamHp(b, 'B');

    let winner;
    if (aHp !== bHp) {
      winner = (aHp > bHp) ? 'A' : 'B';
    } else {
      const aAlive = b.players.filter(p => p.team === 'A' && p.hp > 0).length;
      const bAlive = b.players.filter(p => p.team === 'B' && p.hp > 0).length;
      if (aAlive !== bAlive) {
        winner = (aAlive > bAlive) ? 'A' : 'B';
      } else {
        // 완전 동률이면 규칙상 반드시 승자 필요 → A팀 우선
        winner = 'A';
      }
    }

    b.status = 'ended';
    b.winner = winner;
    pushLog(battleId, 'result', `시간 종료 – 승자: ${winner}팀 (A:${aHp} / B:${bHp})`);
    return true;
  }

  function livingTeamPlayers(b, team) {
    return b.players.filter(p => p.team === team && p.hp > 0);
  }

  function sortByAgilityThenName(list) {
    // 민첩 내림차순, 같으면 이름 오름차순(ABC)
    return list.sort((a, b) => {
      const aA = a.stats?.agility || 0;
      const bA = b.stats?.agility || 0;
      if (aA !== bA) return bA - aA;
      const an = (a.name || '').toString();
      const bn = (b.name || '').toString();
      return an.localeCompare(bn, 'ko');
    });
  }

  function eligibleActorsThisPhase(b) {
    // 현재 팀이 행동하는 턴이면, 살아있는 해당 팀 플레이어들
    if (b.phase === 'A_select') return sortByAgilityThenName(livingTeamPlayers(b, 'A'));
    if (b.phase === 'B_select') return sortByAgilityThenName(livingTeamPlayers(b, 'B'));
    return [];
  }

  function findPlayer(b, id) {
    return b.players.find(p => p.id === id) || null;
  }

  function makeSnapshot(b) {
    // 최소한의 공개 상태
    return {
      id: b.id,
      mode: b.mode,
      status: b.status,
      round: b.round,
      currentTeam: b.currentTeam,
      phase: b.phase,
      currentTurn: deepClone(b.currentTurn),
      players: deepClone(b.players),
      logs: deepClone(b.logs.slice(-200)), // 최근 로그만
      winner: b.winner || null
    };
  }

  /* ---------- 전투 생성/조회 ---------- */
  function create(mode = '2v2') {
    const id = uid(8);
    const b = {
      id,
      mode,
      status: 'waiting',     // waiting | active | paused | ended
      round: 0,
      currentTeam: 'A',
      phase: 'inter',        // inter | A_select | B_select | resolve
      currentTurn: { turnNumber: 0, currentTeam: 'A', timeLeftSec: 0, currentPlayer: null },
      players: [],
      logs: [],
      actions: { A: [], B: [] }, // 각 팀 선택 누적
      spectatorOtp: null,
      winner: null,

      startedAt: null,   // 시작 시각(ms)
      deadlineAt: null,  // 시작+1시간
    };
    battles.set(id, b);
    return b;
  }

  function get(id) {
    return battles.get(id) || null;
  }

  function size() {
    return battles.size;
  }

  function snapshot(id) {
    const b = battles.get(id);
    return b ? makeSnapshot(b) : null;
  }

  /* ---------- 전투 흐름 ---------- */
  function start(id) {
    const b = battles.get(id);
    if (!b) return null;
    if (b.players.length === 0) return null;

    b.status = 'active';
    b.round = 1;
    b.currentTeam = 'A';
    b.phase = 'A_select';
    b.currentTurn = { turnNumber: 1, currentTeam: 'A', timeLeftSec: 0, currentPlayer: null };
    b.actions = { A: [], B: [] };

    b.startedAt = Date.now();
    b.deadlineAt = b.startedAt + (60 * 60 * 1000); // 1시간

    pushLog(id, 'notice', `라운드 1 시작 (선공: A팀)`);
    pushLog(id, 'system', `제한시간: 60분. 시간 종료 시 양 팀 남은 HP 합계로 승자 결정`);
    return { ok: true, b };
  }

  function pause(id) {
    const b = battles.get(id);
    if (!b) return null;
    if (b.status !== 'active') return null;
    b.status = 'paused';
    pushLog(id, 'system', '전투가 일시정지되었습니다');
    return b;
  }

  function resume(id) {
    const b = battles.get(id);
    if (!b) return null;
    if (b.status !== 'paused') return null;
    b.status = 'active';
    pushLog(id, 'system', '전투가 재개되었습니다');
    return b;
  }

  function end(id) {
    const b = battles.get(id);
    if (!b) return null;
    b.status = 'ended';
    return b;
  }

  /* ---------- 플레이어 관리 ---------- */
  function addPlayer(battleId, player) {
    const b = battles.get(battleId);
    if (!b) return null;
    const id = uid(8);
    const p = {
      id,
      name: String(player?.name || `Player_${id}`),
      team: (player?.team === 'B') ? 'B' : 'A',
      hp: clamp(Number(player?.hp ?? 100), 1, 100000),
      maxHp: clamp(Number(player?.maxHp ?? player?.hp ?? 100), 1, 100000),
      stats: {
        attack: clamp(Number(player?.stats?.attack ?? 1), 0, 999),
        defense: clamp(Number(player?.stats?.defense ?? 1), 0, 999),
        agility: clamp(Number(player?.stats?.agility ?? 1), 0, 999),
        luck: clamp(Number(player?.stats?.luck ?? 1), 0, 999),
      },
      items: {
        dittany: Number(player?.items?.dittany ?? player?.items?.ditany ?? 0) | 0,
        attackBooster: Number(player?.items?.attackBooster ?? player?.items?.attack_boost ?? 0) | 0,
        defenseBooster: Number(player?.items?.defenseBooster ?? player?.items?.defense_boost ?? 0) | 0,
      },
      token: player?.token || null,
      avatar: player?.avatar || null,
      ready: !!player?.ready
    };
    b.players.push(p);
    return p;
  }

  function removePlayer(battleId, playerId) {
    const b = battles.get(battleId);
    if (!b) return false;
    const idx = b.players.findIndex(p => p.id === playerId);
    if (idx < 0) return false;
    b.players.splice(idx, 1);
    return true;
  }

  function markReady(battleId, playerId, ready = true) {
    const b = battles.get(battleId);
    if (!b) return false;
    const p = findPlayer(b, playerId);
    if (!p) return false;
    p.ready = !!ready;
    return true;
  }

  function authByToken(battleId, token) {
    const b = battles.get(battleId);
    if (!b) return null;
    return b.players.find(p => p.token && p.token === token) || null;
  }

  /* ---------- 전투 계산 ---------- */

  // 간단한 데미지/회복 모델: 공격 = 공격자 공격 - 대상 방어(최소 1), 디터니 회복 10
  function computeAction(b, actor, action) {
    // 반환용 로그 텍스트
    function say(txt) {
      pushLog(b.id, 'battle', txt);
    }

    if (!actor || actor.hp <= 0) return;

    const type = action?.type;
    if (type === 'pass') {
      say(`${actor.name} 패스`);
      return;
    }

    if (type === 'defend') {
      actor._defending = true; // 이번 라운드 동안 방어 플래그
      say(`${actor.name} 방어 자세`);
      return;
    }

    if (type === 'dodge') {
      actor._dodging = true; // 이번 라운드 동안 회피 플래그(간단 처리)
      say(`${actor.name} 회피 준비`);
      return;
    }

    if (type === 'attack') {
      const target = findPlayer(b, action.targetId);
      if (!target || target.hp <= 0) {
        say(`${actor.name} 공격했으나 대상이 없습니다`);
        return;
      }
      // 기본 피해량
      const atk = actor.stats?.attack || 0;
      const def = (target.stats?.defense || 0) * (target._defending ? 2 : 1);
      let dmg = Math.max(1, atk - def);

      // 간단한 운(크리티컬 15% 가산)
      const crit = Math.random() < (0.15 + (actor.stats?.luck || 0) * 0.005);
      if (crit) dmg = Math.round(dmg * 1.5);

      // 대상이 회피 중이면 40% 확률 회피
      if (target._dodging && Math.random() < 0.4) {
        say(`${actor.name} → ${target.name} 공격 (회피됨)`);
        return;
      }

      target.hp = clamp(target.hp - dmg, 0, target.maxHp);
      say(`${actor.name} → ${target.name} 공격 (-${dmg})`);
      if (target.hp <= 0) {
        say(`${target.name} 전투불능`);
      }
      return;
    }

    if (type === 'item') {
      const item = action?.item;
      if (item === 'dittany' || item === 'ditany') {
        const target = findPlayer(b, action.targetId) || actor;
        if ((actor.items?.dittany || actor.items?.ditany) > 0 && target.hp > 0) {
          const heal = 10;
          target.hp = clamp(target.hp + heal, 0, target.maxHp);
          actor.items.dittany = (actor.items?.dittany || actor.items?.ditany || 1) - 1;
          if (actor.items.ditany && actor.items.dittany < 0) actor.items.ditany -= 1;
          say(`${actor.name} → ${target.name} 디터니(+${heal})`);
        } else {
          say(`${actor.name} 디터니 사용 실패`);
        }
        return;
      }
      if (item === 'attackBooster') {
        if ((actor.items?.attackBooster || actor.items?.attack_boost) > 0) {
          actor._atkBoost = true;
          actor.items.attackBooster = (actor.items.attackBooster || actor.items.attack_boost || 1) - 1;
          say(`${actor.name} 공격 보정기 사용`);
        } else {
          say(`${actor.name} 공격 보정기 없음`);
        }
        return;
      }
      if (item === 'defenseBooster') {
        if ((actor.items?.defenseBooster || actor.items?.defense_boost) > 0) {
          actor._defBoost = true;
          actor.items.defenseBooster = (actor.items.defenseBooster || actor.items.defense_boost || 1) - 1;
          say(`${actor.name} 방어 보정기 사용`);
        } else {
          say(`${actor.name} 방어 보정기 없음`);
        }
        return;
      }
      // 알 수 없는 아이템
      pushLog(b.id, 'system', `${actor.name} 알 수 없는 아이템 시도`);
      return;
    }
  }

  // 라운드 해석: 같은 팀 내부 민첩 순(동률은 이름 ABC)으로 순차 처리
  function resolveRound(battleId) {
    const b = battles.get(battleId);
    if (!b || b.status !== 'active') return;

    b.phase = 'resolve';
    pushLog(battleId, 'round', `라운드 ${b.round} 해석 시작`);

    // 팀 A → 팀 B 순서로(혹은 현재 라운드 교대 규칙에 맞게) 처리해도 되지만,
    // 여기서는 "현재 라운드 팀"이 제출한 액션을 우선 처리하고, 이어 상대팀 처리.
    const seq = (b.currentTeam === 'A') ? ['A', 'B'] : ['B', 'A'];

    for (const team of seq) {
      // 라운드 일시 플래그 초기화
      b.players.forEach(p => { p._defending = false; p._dodging = false; });

      const acts = b.actions[team] || [];
      if (acts.length === 0) continue;

      // 액터 정렬(민첩 desc, 이름 asc)
      const actors = sortByAgilityThenName(
        acts
          .map(a => ({ actor: findPlayer(b, a.playerId), action: a.action }))
          .filter(x => x.actor && x.actor.hp > 0)
          .map(x => x.actor)
      );

      // 같은 배우가 복수 제출했을 가능성 대비: 마지막 제출만 채택
      const latestByActor = new Map();
      for (const a of acts) latestByActor.set(a.playerId, a.action);

      for (const actor of actors) {
        const act = latestByActor.get(actor.id);
        if (!act) continue;

        // 보정 효과(공/방)는 "이번 라운드 다음 한 번" 개념으로 간단화:
        // 공격 보정은 공격행동 시 공격력 x2, 방어 보정은 방어력 x2 (이미 computeAction에서 반영)
        if (actor._atkBoost && act.type === 'attack') {
          // 공격력 임시 2배: 간단히 공격 스탯만 증가
          actor._origAtk = actor._origAtk ?? actor.stats.attack;
          actor.stats.attack = (actor._origAtk) * 2;
        }
        if (actor._defBoost && act.type !== 'attack') {
          // 방어 보정은 주로 피격시 반영하지만 간단 처리: 방어 스탯 2배
          actor._origDef = actor._origDef ?? actor.stats.defense;
          actor.stats.defense = (actor._origDef) * 2;
        }

        computeAction(b, actor, act);

        // 사용 후 원복
        if (actor._origAtk != null) {
          actor.stats.attack = actor._origAtk; delete actor._origAtk;
          actor._atkBoost = false;
        }
        if (actor._origDef != null) {
          actor.stats.defense = actor._origDef; delete actor._origDef;
          actor._defBoost = false;
        }
      }
    }

    // 요약
    const aLeft = sumTeamHp(b, 'A');
    const bLeft = sumTeamHp(b, 'B');
    pushLog(battleId, 'round', `라운드 ${b.round} 종료 (A:${aLeft} / B:${bLeft})`);

    // 승부 확인(전멸)
    const aAlive = b.players.some(p => p.team === 'A' && p.hp > 0);
    const bAlive = b.players.some(p => p.team === 'B' && p.hp > 0);

    if (!aAlive || !bAlive) {
      b.status = 'ended';
      b.winner = aAlive ? 'A' : (bAlive ? 'B' : 'A'); // 동시 전멸 → A 우선(규칙 명시)
      pushLog(battleId, 'result', `승자: ${b.winner}팀`);
      return;
    }

    // 시간 종료 체크
    if (checkTimeLimitAndMaybeEnd(battleId)) return;

    // 다음 턴 세팅
    b.actions = { A: [], B: [] };
    b.round += 1;
    b.currentTeam = (b.currentTeam === 'A') ? 'B' : 'A';
    b.phase = (b.currentTeam === 'A') ? 'A_select' : 'B_select';
    b.currentTurn = {
      turnNumber: b.round,
      currentTeam: b.currentTeam,
      timeLeftSec: 0,
      currentPlayer: null
    };
    pushLog(battleId, 'notice', `라운드 ${b.round} 시작 (${b.currentTeam}팀 선택)`);
  }

  /* ---------- 액션 엔트리 ---------- */
  function playerAction(battleId, playerId, action) {
    const b = battles.get(battleId);
    if (!b || b.status !== 'active') return null;

    // 시간 종료 체크
    if (checkTimeLimitAndMaybeEnd(battleId)) return { ok: false, error: 'time over', b };

    const actor = findPlayer(b, playerId);
    if (!actor || actor.hp <= 0) return null;

    const team = actor.team;
    const isTeamTurn =
      (b.phase === 'A_select' && team === 'A') ||
      (b.phase === 'B_select' && team === 'B');

    if (!isTeamTurn) {
      pushLog(battleId, 'system', `${actor.name}의 차례가 아닙니다`);
      return { ok: false, error: 'not your turn', b };
    }

    // 현재 팀의 살아있는 명단
    const eligibles = eligibleActorsThisPhase(b).map(p => p.id);
    if (!eligibles.includes(actor.id)) {
      pushLog(battleId, 'system', `${actor.name} 행동 불가(사망 또는 비활성)`);
      return { ok: false, error: 'ineligible', b };
    }

    // 액션 저장(같은 플레이어 여러 번 보내면 마지막 것으로 덮어씀)
    const list = b.actions[team];
    const idx = list.findIndex(x => x.playerId === actor.id);
    const normalized = normalizeAction(action);
    if (idx >= 0) list[idx] = { playerId: actor.id, action: normalized };
    else list.push({ playerId: actor.id, action: normalized });

    // 모두 제출했는지 확인 → 해석 단계로
    const submittedAll = eligibles.every(pid => list.some(a => a.playerId === pid));
    let result = { submitted: list.length, required: eligibles.length };

    if (submittedAll) {
      // 상대팀도 이미 제출되어 있다면(동시제출 모드가 필요하면 여기서 확장),
      // 현 규칙은 "현재 팀 제출 완료" 시 즉시 resolve.
      resolveRound(battleId);
    }

    // 액션 직후에도 시간 체크(정밀)
    checkTimeLimitAndMaybeEnd(battleId);

    return { ok: true, b, result };
  }

  function normalizeAction(a) {
    if (!a || typeof a !== 'object') return { type: 'pass' };
    const type = String(a.type || 'pass');
    if (type === 'attack') {
      return { type: 'attack', targetId: a.targetId || null };
    }
    if (type === 'defend') return { type: 'defend' };
    if (type === 'dodge') return { type: 'dodge' };
    if (type === 'item') {
      const item = a.item || '';
      const targetId = a.targetId || null;
      return { type: 'item', item, targetId };
    }
    if (type === 'pass') return { type: 'pass' };
    return { type: 'pass' };
  }

  /* ---------- 공개 API ---------- */
  return {
    // store helpers
    create,
    get,
    size,
    snapshot,

    // flow
    start,
    pause,
    resume,
    end,

    // players
    addPlayer,
    removePlayer,
    markReady,
    authByToken,

    // actions
    playerAction,
  };
}
