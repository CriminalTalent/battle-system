/* packages/battle-server/src/engine/BattleEngine.js (ESM) */
/* PYXIS BattleEngine - Alternating First-Team per Round (A <-> B) */

let _idSeq = 1;
const newId = (p = 'b') => `${p}_${(_idSeq++).toString(36)}`;

/** 내부 유틸 */
const now = () => Date.now();
const clone = (o) => JSON.parse(JSON.stringify(o));
const teamOther = (t) => (t === 'A' ? 'B' : 'A');

/** 정렬: 민첩 내림차순 → 이름 오름차순 */
function sortByAgilityThenName(players) {
  return players
    .slice()
    .sort((a, b) => {
      const da = (a.stats?.agility ?? 0);
      const db = (b.stats?.agility ?? 0);
      if (db !== da) return db - da; // agility desc
      const na = (a.name || '');
      const nb = (b.name || '');
      return na.localeCompare(nb, 'ko'); // name asc
    });
}

/** 데미지/회복 샘플 계산기 (기존 규칙 유지, 간단 버전) */
function computeAttackDamage(attacker, defender, crit = false, boosted = false) {
  const atk = (attacker.stats?.attack ?? 1) * (boosted ? 2 : 1);
  const def = (defender.stats?.defense ?? 1);
  let base = 6 + Math.max(1, atk * 3 - def * 2);
  if (crit) base = Math.round(base * 1.5);
  // 가벼운 랜덤 ±2
  const final = Math.max(1, base + (Math.floor(Math.random() * 5) - 2));
  return final;
}

function healAmount(user) {
  // 디터니: 고정 10 회복
  return 10;
}

/** 엔진 본체 */
export function createBattleStore() {
  /** 전체 배틀 맵 */
  const battles = new Map();

  /** 배틀 스냅샷 */
  function snapshot(id) {
    const b = battles.get(id);
    if (!b) return null;
    const s = clone(b);
    // 내부 관리 필드 제거
    delete s.pendingActions;
    delete s.firstTeamThisRound;
    return s;
  }

  /** 배틀 생성 */
  function create(mode = '2v2') {
    const id = newId('battle');
    const battle = {
      id,
      mode,
      status: 'waiting',         // waiting | active | paused | ended
      phase: 'waiting',          // waiting | A_select | B_select | resolve | inter
      round: 0,
      firstTeam: 'A',            // 현재 라운드의 선공 팀 (라운드 시작 시점 기준)
      players: [],
      logs: [],
      spectatorOtp: null,
      createdAt: now(),
      // 내부
      pendingActions: { A: [], B: [] }, // { actorId, kind, targetId, item, meta }
      firstTeamThisRound: null,
      currentTurn: {
        turnNumber: 0,
        currentTeam: null,       // A | B (선택 페이즈에 의미 있음)
        timeLeftSec: 0,
        currentPlayer: null,     // 선택 페이즈일 때 플레이어 하이라이트용(선택식이라 null 허용)
      }
    };
    battles.set(id, battle);
    return battle;
  }

  /** 배틀 조회 */
  function get(id) {
    return battles.get(id) || null;
  }

  /** 배틀 수 */
  function size() {
    return battles.size;
  }

  /** 배틀 시작 */
  function start(id) {
    const b = battles.get(id);
    if (!b || b.status !== 'waiting') return null;

    // 선공 팀 결정(기존 유지: 랜덤)
    b.firstTeam = Math.random() < 0.5 ? 'A' : 'B';

    b.status = 'active';
    b.round = 1;
    b.phase = b.firstTeam === 'A' ? 'A_select' : 'B_select';
    b.firstTeamThisRound = b.firstTeam;
    b.pendingActions = { A: [], B: [] };
    b.currentTurn = {
      turnNumber: b.round,
      currentTeam: b.firstTeam,
      timeLeftSec: 300,
      currentPlayer: null
    };

    // 로그
    b.logs.push({ ts: now(), type: 'system', message: `${b.firstTeam}팀이 선공입니다!` });
    b.logs.push({ ts: now(), type: 'system', message: '전투가 시작되었습니다!' });
    b.logs.push({ ts: now(), type: 'system', message: `${b.round}라운드 시작` });
    b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.firstTeam}팀 선택 페이즈 시작 ===` });

    return { ok: true, b };
  }

  /** 배틀 종료 */
  function end(id) {
    const b = battles.get(id);
    if (!b) return null;
    b.status = 'ended';
    return b;
  }

  /** 플레이어 추가 */
  function addPlayer(id, player) {
    const b = battles.get(id);
    if (!b) return null;

    const p = {
      id: newId('p'),
      team: player.team === 'B' ? 'B' : 'A',
      name: String(player.name || '플레이어'),
      avatar: player.avatar || null,
      hp: Number(player.hp ?? 100),
      maxHp: Number(player.maxHp ?? player.hp ?? 100),
      ready: !!player.ready,
      stats: {
        attack: Number(player.stats?.attack ?? 1),
        defense: Number(player.stats?.defense ?? 1),
        agility: Number(player.stats?.agility ?? 1),
        luck: Number(player.stats?.luck ?? 1)
      },
      items: {
        dittany: Number(player.items?.dittany ?? player.items?.ditany ?? 0),
        attackBooster: Number(player.items?.attackBooster ?? player.items?.attack_boost ?? 0),
        defenseBooster: Number(player.items?.defenseBooster ?? player.items?.defense_boost ?? 0)
      },
      token: player.token || Math.random().toString(36).slice(2, 10).toUpperCase()
    };
    b.players.push(p);
    return p;
  }

  /** 플레이어 제거 */
  function removePlayer(id, playerId) {
    const b = battles.get(id);
    if (!b) return false;
    const before = b.players.length;
    b.players = b.players.filter(p => p.id !== playerId);
    // 선택 목록에서도 제거
    b.pendingActions.A = b.pendingActions.A.filter(a => a.actorId !== playerId);
    b.pendingActions.B = b.pendingActions.B.filter(a => a.actorId !== playerId);
    return b.players.length < before;
  }

  /** 인증(토큰) */
  function authByToken(id, token) {
    const b = battles.get(id);
    if (!b) return null;
    return b.players.find(p => p.token === token) || null;
  }

  /** 준비 토글 */
  function markReady(id, playerId, ready = true) {
    const b = battles.get(id);
    if (!b) return false;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return false;
    p.ready = !!ready;
    return true;
  }

  /** 현재 팀의 살아있는 플레이어 목록 */
  function aliveOfTeam(b, team) {
    return b.players.filter(p => p.team === team && p.hp > 0);
  }

  /** 팀별 선택 완료 여부 */
  function isTeamSelectionComplete(b, team) {
    const alive = aliveOfTeam(b, team);
    if (alive.length === 0) return true;
    const picked = b.pendingActions[team].map(a => a.actorId);
    return alive.every(p => picked.includes(p.id));
  }

  /** 플레이어 액션(선택 페이즈에서만 기록) */
  function playerAction(id, playerId, action) {
    const b = battles.get(id);
    if (!b || b.status !== 'active') return null;

    // 현재 페이즈의 선택 팀만 입력 가능
    const currentTeam = b.currentTurn?.currentTeam;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return null;

    const actor = b.players.find(p => p.id === playerId);
    if (!actor || actor.team !== currentTeam || actor.hp <= 0) return null;

    // 중복 제출 방지
    if (b.pendingActions[currentTeam].some(a => a.actorId === actor.id)) return null;

    // 기본 액션 구조
    const entry = {
      actorId: actor.id,
      kind: action?.type || 'pass',  // attack | defend | dodge | item | pass
      targetId: action?.targetId || null,
      item: action?.item || null,
      ts: now()
    };
    b.pendingActions[currentTeam].push(entry);

    // 선택 로그(수치 없이)
    const tgt = entry.targetId ? b.players.find(p => p.id === entry.targetId) : null;
    const verb =
      entry.kind === 'attack' ? '공격' :
      entry.kind === 'defend' ? '방어' :
      entry.kind === 'dodge'  ? '회피' :
      entry.kind === 'item'   ? (entry.item === 'dittany' || entry.item === 'ditany' ? '치료' : '보정기 사용') :
      '행동';
    const msg =
      entry.kind === 'attack' && tgt
        ? `→ ${actor.name}이(가) ${tgt.name}에게 ${verb}`
        : entry.kind === 'item' && tgt
          ? `→ ${actor.name}이(가) ${verb} (${tgt.name})`
          : `→ ${actor.name}이(가) ${verb}`;
    b.logs.push({ ts: entry.ts, type: 'battle', message: msg });

    // 팀 선택 완료 시 페이즈 전환
    if (isTeamSelectionComplete(b, currentTeam)) {
      const nextTeam = teamOther(currentTeam);
      if (b.phase === 'A_select') {
        // A 선택 완료 → B 선택 페이즈
        b.phase = 'B_select';
        b.currentTurn.currentTeam = 'B';
        b.currentTurn.currentPlayer = null;
        b.logs.push({ ts: now(), type: 'battle', message: '=== B팀 선택 페이즈 시작 ===' });
      } else if (b.phase === 'B_select') {
        // B 선택 완료 → 라운드 해석
        b.phase = 'resolve';
        b.currentTurn.currentTeam = null;
        b.currentTurn.currentPlayer = null;
        b.logs.push({ ts: now(), type: 'battle', message: '라운드 해석' });
        resolveRound(b);
      }
    }

    return { ok: true, b, result: { accepted: true } };
  }

  /** 라운드 해석 */
  function resolveRound(b) {
    // 해석 순서: (이번 라운드 선공팀) 민첩 내림차순 → 이름 → 그 다음 (후공팀) 민첩 내림차순 → 이름
    const first = b.firstTeamThisRound || b.firstTeam || 'A';
    const second = teamOther(first);

    const aliveFirst  = sortByAgilityThenName(aliveOfTeam(b, first));
    const aliveSecond = sortByAgilityThenName(aliveOfTeam(b, second));

    // 액션 테이블: 미제출자 = pass
    const actMap = { A: new Map(), B: new Map() };
    b.pendingActions.A.forEach(a => actMap.A.set(a.actorId, a));
    b.pendingActions.B.forEach(a => actMap.B.set(a.actorId, a));

    const orderedActors = [
      ...aliveFirst.map(p => ({ team: first, p })),
      ...aliveSecond.map(p => ({ team: second, p }))
    ];

    // 실제 적용 로그
    for (const { team, p } of orderedActors) {
      const a = (team === 'A' ? actMap.A.get(p.id) : actMap.B.get(p.id)) || { kind: 'pass' };
      if (p.hp <= 0) continue;

      if (a.kind === 'attack') {
        const tgt = b.players.find(x => x.id === a.targetId && x.hp > 0);
        if (!tgt) continue;
        const crit = (p.stats?.luck ?? 0) >= 5 && Math.random() < 0.25;
        const dmg = computeAttackDamage(p, tgt, crit, false);
        tgt.hp = Math.max(0, tgt.hp - dmg);
        const kindText = crit ? '치명타 공격' : '공격';
        b.logs.push({
          ts: now(),
          type: team === 'A' ? 'teamA' : 'teamB',
          message: `${p.name}이(가) ${tgt.name}에게 ${kindText} (피해 ${dmg}) → HP ${tgt.hp}`
        });
      } else if (a.kind === 'item') {
        if (a.item === 'dittany' || a.item === 'ditany') {
          // 치유
          const tgt = b.players.find(x => x.id === a.targetId && x.hp > 0);
          if (!tgt) continue;
          if ((p.items.dittany ?? p.items.ditany ?? 0) <= 0) continue;
          const heal = healAmount(p);
          tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
          // 소비
          if (typeof p.items.dittany === 'number') p.items.dittany = Math.max(0, p.items.dittany - 1);
          else if (typeof p.items.ditany === 'number') p.items.ditany = Math.max(0, p.items.ditany - 1);

          b.logs.push({
            ts: now(),
            type: team === 'A' ? 'teamA' : 'teamB',
            message: `${p.name}이(가) ${tgt.name} 치료 (+${heal}) → HP ${tgt.hp}`
          });
        } else if (a.item === 'attackBooster') {
          if ((p.items.attackBooster ?? 0) <= 0) continue;
          const tgt = b.players.find(x => x.id === a.targetId && x.hp > 0);
          if (!tgt) continue;
          // 보정기: 즉시 강화 공격 적용
          const crit = (p.stats?.luck ?? 0) >= 5 && Math.random() < 0.25;
          const dmg = computeAttackDamage(p, tgt, crit, true);
          tgt.hp = Math.max(0, tgt.hp - dmg);
          p.items.attackBooster = Math.max(0, p.items.attackBooster - 1);
          b.logs.push({
            ts: now(),
            type: team === 'A' ? 'teamA' : 'teamB',
            message: `${p.name}이(가) 공격 보정기 사용 성공 — ${tgt.name} 대상 즉시 강화 공격 (피해 ${dmg}) → HP ${tgt.hp}`
          });
        } else if (a.item === 'defenseBooster') {
          if ((p.items.defenseBooster ?? 0) <= 0) continue;
          // 단순 효과: 다음 라운드 받는 피해 경감 같은 장기 효과는 생략(로그만)
          p.items.defenseBooster = Math.max(0, p.items.defenseBooster - 1);
          b.logs.push({
            ts: now(),
            type: team === 'A' ? 'teamA' : 'teamB',
            message: `${p.name}이(가) 방어 보정기 사용 — 방어 강화`
          });
        } else {
          // 기타 아이템 미사용 처리
          b.logs.push({
            ts: now(),
            type: 'system',
            message: `${p.name}이(가) 아이템 사용 실패`
          });
        }
      } else if (a.kind === 'defend') {
        b.logs.push({
          ts: now(),
          type: team === 'A' ? 'teamA' : 'teamB',
          message: `${p.name}이(가) 방어 태세를 취함`
        });
      } else if (a.kind === 'dodge') {
        b.logs.push({
          ts: now(),
          type: team === 'A' ? 'teamA' : 'teamB',
          message: `${p.name}이(가) 회피 시도`
        });
      } else {
        // pass
        b.logs.push({
          ts: now(),
          type: 'system',
          message: `${p.name}이(가) 행동하지 않음`
        });
      }
    }

    // 승리 조건 체크
    const aliveA = aliveOfTeam(b, 'A').length;
    const aliveB = aliveOfTeam(b, 'B').length;
    if (aliveA === 0 || aliveB === 0) {
      b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.round}라운드 종료 ===` });
      const winner = aliveA > 0 ? 'A' : aliveB > 0 ? 'B' : 'Draw';
      b.status = 'ended';
      b.phase = 'waiting';
      b.logs.push({ ts: now(), type: 'result', message: `${winner}팀 승리!` });
      return;
    }

    // 라운드 종료 → 인터페이즈
    b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.round}라운드 종료 ===` });
    b.logs.push({ ts: now(), type: 'system', message: '5초 후 다음 라운드 시작...' });

    // 다음 라운드 설정: ★★★ 선후공 교대 핵심 ★★★
    b.round += 1;
    // 현재 라운드의 firstTeam을 반대로 토글
    b.firstTeam = teamOther(b.firstTeamThisRound || b.firstTeam || 'A');
    b.firstTeamThisRound = b.firstTeam;
    b.pendingActions = { A: [], B: [] };

    b.phase = b.firstTeam === 'A' ? 'A_select' : 'B_select';
    b.currentTurn = {
      turnNumber: b.round,
      currentTeam: b.firstTeam,
      timeLeftSec: 300,
      currentPlayer: null
    };

    b.logs.push({ ts: now(), type: 'system', message: `${b.round}라운드 시작` });
    b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.firstTeam}팀 선택 페이즈 시작 ===` });
  }

  /** 1시간 제한 체크(무조건 승자 산출: 생존 HP 합) */
  function checkTimeLimitAndDecide(b) {
    const LIMIT_MS = 60 * 60 * 1000; // 1시간
    const elapsed = now() - (b.createdAt || now());
    if (elapsed < LIMIT_MS) return;

    const sumHp = (team) => b.players.filter(p => p.team === team && p.hp > 0)
      .reduce((acc, p) => acc + p.hp, 0);

    const aHp = sumHp('A');
    const bHp = sumHp('B');

    b.status = 'ended';
    b.phase = 'waiting';
    const winner = aHp > bHp ? 'A' : bHp > aHp ? 'B' : 'Draw';
    b.logs.push({ ts: now(), type: 'result', message: `시간 만료 — 최종 생존 HP 합산 결과 ${winner}팀 승리 (A:${aHp}, B:${bHp})` });
  }

  return {
    /* store ops */
    create,
    get,
    size,
    snapshot,

    /* game ops */
    start,
    end,
    addPlayer,
    removePlayer,
    authByToken,
    markReady,
    playerAction,

    /* periodic (선택적으로 서버가 주기 호출) */
    tickAll() {
      // 시간 제한 승자 산정
      for (const b of battles.values()) {
        if (b.status === 'active') checkTimeLimitAndDecide(b);
      }
    }
  };
}
