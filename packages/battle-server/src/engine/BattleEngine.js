/* packages/battle-server/src/engine/BattleEngine.js (ESM)
   - hp/maxHp/stats/items 누락/NaN 방지 보정
   - 선/후공 교대 + 선택/해석 분리 (이전 답변 유지)
*/

let _idSeq = 1;
const newId = (p = 'b') => `${p}_${(_idSeq++).toString(36)}`;
const now = () => Date.now();
const clone = (o) => JSON.parse(JSON.stringify(o));
const otherTeam = (t) => (t === 'A' ? 'B' : 'A');

function toInt(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.trunc(v) : d;
}
function saneStat(n)   { return Math.min(5, Math.max(0, toInt(n, 0))); }
function saneItem(n)   { return Math.max(0, toInt(n, 0)); }
function saneHp(n, d)  { return Math.max(0, toInt(n, d)); }

/** 민첩 내림차순 → 이름(ko) 오름차순 */
function sortByAgilityThenName(players) {
  return players
    .slice()
    .sort((a, b) => {
      const ga = a?.stats?.agility ?? 0;
      const gb = b?.stats?.agility ?? 0;
      if (gb !== ga) return gb - ga;
      return (a?.name || '').localeCompare(b?.name || '', 'ko');
    });
}

/** 대미지 계산(간단) */
function computeAttackDamage(attacker, defender, crit = false, boosted = false) {
  const atk = (attacker?.stats?.attack ?? 1) * (boosted ? 2 : 1);
  const def = defender?.stats?.defense ?? 1;
  let base = 6 + Math.max(1, atk * 3 - def * 2);
  if (crit) base = Math.round(base * 1.5);
  const jitter = Math.floor(Math.random() * 5) - 2; // ±2
  return Math.max(1, base + jitter);
}

const healAmount = 10;

export function createBattleStore() {
  const battles = new Map();

  /** 스냅샷 보정: 누락/NaN 필드 채우기 */
  function sanitizePlayer(p) {
    const maxHp = saneHp(p.maxHp ?? p.hp, 100);
    let hp = saneHp(p.hp, maxHp);
    if (!Number.isFinite(hp) || hp <= 0) hp = saneHp(p.hp ?? maxHp, maxHp);

    const stats = {
      attack:  saneStat(p?.stats?.attack),
      defense: saneStat(p?.stats?.defense),
      agility: saneStat(p?.stats?.agility),
      luck:    saneStat(p?.stats?.luck),
    };
    const items = {
      // ditany/dittany 둘 다 케어
      dittany:        saneItem(p?.items?.dittany ?? p?.items?.ditany),
      attackBooster:  saneItem(p?.items?.attackBooster ?? p?.items?.attack_boost),
      defenseBooster: saneItem(p?.items?.defenseBooster ?? p?.items?.defense_boost),
    };
    return {
      ...p,
      maxHp,
      hp,
      stats,
      items,
      team: p.team === 'B' ? 'B' : 'A',
      name: String(p.name || '플레이어'),
    };
  }

  function snapshot(id) {
    const b = battles.get(id);
    if (!b) return null;
    const s = clone(b);
    s.players = (s.players || []).map(sanitizePlayer);
    delete s.pendingActions;
    delete s.firstTeamThisRound;
    return s;
  }

  function create(mode = '2v2') {
    const id = newId('battle');
    const b = {
      id,
      mode,
      status: 'waiting',                 // waiting | active | paused | ended
      phase: 'waiting',                  // waiting | A_select | B_select | resolve | inter
      round: 0,
      firstTeam: 'A',                    // 다음 라운드 선공팀
      firstTeamThisRound: null,          // 현재 라운드 선공팀(해석 기준)
      players: [],
      logs: [],
      spectatorOtp: null,
      createdAt: now(),
      pendingActions: { A: [], B: [] },
      currentTurn: {
        turnNumber: 0,
        currentTeam: null,
        timeLeftSec: 300,
        currentPlayer: null
      }
    };
    battles.set(id, b);
    return b;
  }

  const get = (id) => battles.get(id) || null;
  const size = () => battles.size;

  function start(id) {
    const b = battles.get(id);
    if (!b || b.status !== 'waiting') return null;

    b.firstTeam = Math.random() < 0.5 ? 'A' : 'B';
    b.firstTeamThisRound = b.firstTeam;

    b.status = 'active';
    b.round = 1;
    b.phase = b.firstTeam === 'A' ? 'A_select' : 'B_select';
    b.pendingActions = { A: [], B: [] };
    b.currentTurn = {
      turnNumber: b.round,
      currentTeam: b.firstTeam,
      timeLeftSec: 300,
      currentPlayer: null
    };

    b.logs.push({ ts: now(), type: 'system', message: `${b.firstTeam}팀이 선공입니다!` });
    b.logs.push({ ts: now(), type: 'system', message: '전투가 시작되었습니다!' });
    b.logs.push({ ts: now(), type: 'system', message: `${b.round}라운드 시작` });
    b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.firstTeam}팀 선택 페이즈 시작 ===` });

    return { ok: true, b };
  }

  function end(id) {
    const b = battles.get(id);
    if (!b) return null;
    b.status = 'ended';
    return b;
  }

  function addPlayer(id, player) {
    const b = battles.get(id);
    if (!b) return null;

    // 들어온 값 보정(문자 → 숫자 / 누락 채우기)
    const reqMax = toInt(player.maxHp ?? player.hp, 100);
    const saneMax = reqMax > 0 ? reqMax : 100;
    const saneCur = toInt(player.hp, saneMax);
    const p = sanitizePlayer({
      id: newId('p'),
      team: player.team === 'B' ? 'B' : 'A',
      name: String(player.name || '플레이어'),
      avatar: player.avatar || null,
      hp: saneCur,
      maxHp: saneMax,
      ready: !!player.ready,
      stats: {
        attack:  player?.stats?.attack,
        defense: player?.stats?.defense,
        agility: player?.stats?.agility,
        luck:    player?.stats?.luck,
      },
      items: {
        dittany:        player?.items?.dittany ?? player?.items?.ditany,
        attackBooster:  player?.items?.attackBooster ?? player?.items?.attack_boost,
        defenseBooster: player?.items?.defenseBooster ?? player?.items?.defense_boost,
      },
      token: player.token || Math.random().toString(36).slice(2, 10).toUpperCase()
    });

    b.players.push(p);
    return p;
  }

  function removePlayer(id, playerId) {
    const b = battles.get(id);
    if (!b) return false;
    const before = b.players.length;
    b.players = b.players.filter(p => p.id !== playerId);
    b.pendingActions.A = b.pendingActions.A.filter(a => a.actorId !== playerId);
    b.pendingActions.B = b.pendingActions.B.filter(a => a.actorId !== playerId);
    return b.players.length < before;
  }

  function authByToken(id, token) {
    const b = battles.get(id);
    if (!b) return null;
    return b.players.find(p => p.token === token) || null;
  }

  function markReady(id, playerId, ready = true) {
    const b = battles.get(id);
    if (!b) return false;
    const p = b.players.find(x => x.id === playerId);
    if (!p) return false;
    p.ready = !!ready;
    return true;
  }

  const aliveOfTeam = (b, team) => b.players.filter(p => p.team === team && p.hp > 0);

  function teamSelectionComplete(b, team) {
    const alive = aliveOfTeam(b, team);
    if (alive.length === 0) return true;
    const picked = b.pendingActions[team].map(a => a.actorId);
    return alive.every(p => picked.includes(p.id));
  }

  /** 선택 입력(수치 적용 없음, 텍스트만 기록) */
  function playerAction(id, playerId, action) {
    const b = battles.get(id);
    if (!b || b.status !== 'active') return null;
    if (!(b.phase === 'A_select' || b.phase === 'B_select')) return null;

    const currentTeam = b.currentTurn?.currentTeam;
    const actor = b.players.find(p => p.id === playerId);
    if (!actor || actor.team !== currentTeam || actor.hp <= 0) return null;

    if (b.pendingActions[currentTeam].some(a => a.actorId === actor.id)) return null;

    const entry = {
      actorId: actor.id,
      kind: action?.type || 'pass',    // attack | defend | dodge | item | pass
      targetId: action?.targetId || null,
      item: action?.item || null,
      ts: now()
    };
    b.pendingActions[currentTeam].push(entry);

    // 선택 로그(수치 없음)
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

    // 팀 완료 시 페이즈 전환
    if (teamSelectionComplete(b, currentTeam)) {
      if (b.phase === 'A_select') {
        b.phase = 'B_select';
        b.currentTurn.currentTeam = 'B';
        b.currentTurn.currentPlayer = null;
        b.logs.push({ ts: now(), type: 'battle', message: '=== B팀 선택 페이즈 시작 ===' });
      } else {
        b.phase = 'resolve';
        b.currentTurn.currentTeam = null;
        b.currentTurn.currentPlayer = null;
        b.logs.push({ ts: now(), type: 'battle', message: '라운드 해석' });
        resolveRound(b);
      }
    }

    return { ok: true, b, result: { accepted: true } };
  }

  /** 라운드 해석: 이번 라운드 선공팀 → 후공팀 */
  function resolveRound(b) {
    const first = b.firstTeamThisRound || b.firstTeam || 'A';
    const second = otherTeam(first);

    const aliveFirst  = sortByAgilityThenName(aliveOfTeam(b, first));
    const aliveSecond = sortByAgilityThenName(aliveOfTeam(b, second));

    const actsA = new Map(b.pendingActions.A.map(a => [a.actorId, a]));
    const actsB = new Map(b.pendingActions.B.map(a => [a.actorId, a]));
    const actOf = (team, id) => (team === 'A' ? actsA.get(id) : actsB.get(id)) || { kind: 'pass' };

    b.logs.push({ ts: now(), type: 'system', message: `[해석] ${first}팀 결과 처리 시작` });

    // 1) 선공팀
    for (const p of aliveFirst) {
      if (p.hp <= 0) continue;
      const a = actOf(first, p.id);
      applyAction(b, first, p, a);
    }

    // 2) 후공팀
    b.logs.push({ ts: now(), type: 'system', message: `[해석] ${second}팀 결과 처리 시작` });
    for (const p of aliveSecond) {
      if (p.hp <= 0) continue;
      const a = actOf(second, p.id);
      applyAction(b, second, p, a);
    }

    // 승패 체크
    const aliveCntA = aliveOfTeam(b, 'A').length;
    const aliveCntB = aliveOfTeam(b, 'B').length;
    if (aliveCntA === 0 || aliveCntB === 0) {
      b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.round}라운드 종료 ===` });
      const winner = aliveCntA > 0 ? 'A' : aliveCntB > 0 ? 'B' : 'Draw';
      b.status = 'ended';
      b.phase = 'waiting';
      b.logs.push({ ts: now(), type: 'result', message: `${winner}팀 승리!` });
      return;
    }

    // 라운드 종료 + 다음 라운드(선공 교대)
    b.logs.push({ ts: now(), type: 'battle', message: `=== ${b.round}라운드 종료 ===` });
    b.logs.push({ ts: now(), type: 'system', message: '5초 후 다음 라운드 시작...' });

    b.round += 1;
    b.firstTeam = otherTeam(first);
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

  /** 실제 수치 적용 + 로그 */
  function applyAction(b, team, p, a) {
    const stamp = now();

    if (a.kind === 'attack') {
      const tgt = b.players.find(x => x.id === a.targetId && x.hp > 0);
      if (!tgt) return;
      const crit = (p?.stats?.luck ?? 0) >= 5 && Math.random() < 0.25;
      const dmg = computeAttackDamage(p, tgt, crit, false);
      tgt.hp = Math.max(0, tgt.hp - dmg);
      const kindText = crit ? '치명타 공격' : '공격';
      b.logs.push({
        ts: stamp,
        type: team === 'A' ? 'teamA' : 'teamB',
        message: `${p.name}이(가) ${tgt.name}에게 ${kindText} (피해 ${dmg}) → HP ${tgt.hp}`
      });
      return;
    }

    if (a.kind === 'item') {
      if (a.item === 'dittany' || a.item === 'ditany') {
        const tgt = b.players.find(x => x.id === a.targetId && x.hp > 0);
        if (!tgt) return;
        const has = (p.items.dittany ?? p.items.ditany ?? 0) > 0;
        if (!has) return;
        tgt.hp = Math.min(tgt.maxHp, tgt.hp + healAmount);
        if (typeof p.items.dittany === 'number') p.items.dittany = Math.max(0, p.items.dittany - 1);
        else if (typeof p.items.ditany === 'number') p.items.ditany = Math.max(0, p.items.ditany - 1);
        b.logs.push({
          ts: stamp,
          type: team === 'A' ? 'teamA' : 'teamB',
          message: `${p.name}이(가) ${tgt.name} 치료 (+${healAmount}) → HP ${tgt.hp}`
        });
        return;
      }

      if (a.item === 'attackBooster') {
        if ((p.items.attackBooster ?? 0) <= 0) return;
        const tgt = b.players.find(x => x.id === a.targetId && x.hp > 0);
        if (!tgt) return;
        const crit = (p?.stats?.luck ?? 0) >= 5 && Math.random() < 0.25;
        const dmg = computeAttackDamage(p, tgt, crit, true);
        tgt.hp = Math.max(0, tgt.hp - dmg);
        p.items.attackBooster = Math.max(0, p.items.attackBooster - 1);
        b.logs.push({
          ts: stamp,
          type: team === 'A' ? 'teamA' : 'teamB',
          message: `${p.name}이(가) 공격 보정기 사용 성공 — ${tgt.name} 대상 즉시 강화 공격 (피해 ${dmg}) → HP ${tgt.hp}`
        });
        return;
      }

      if (a.item === 'defenseBooster') {
        if ((p.items.defenseBooster ?? 0) <= 0) return;
        p.items.defenseBooster = Math.max(0, p.items.defenseBooster - 1);
        b.logs.push({
          ts: stamp,
          type: team === 'A' ? 'teamA' : 'teamB',
          message: `${p.name}이(가) 방어 보정기 사용 — 방어 강화`
        });
        return;
      }

      b.logs.push({ ts: stamp, type: 'system', message: `${p.name}이(가) 아이템 사용 실패` });
      return;
    }

    if (a.kind === 'defend') {
      b.logs.push({
        ts: stamp,
        type: team === 'A' ? 'teamA' : 'teamB',
        message: `${p.name}이(가) 방어 태세를 취함`
      });
      return;
    }

    if (a.kind === 'dodge') {
      b.logs.push({
        ts: stamp,
        type: team === 'A' ? 'teamA' : 'teamB',
        message: `${p.name}이(가) 회피 시도`
      });
      return;
    }

    // pass
    b.logs.push({ ts: stamp, type: 'system', message: `${p.name}이(가) 행동하지 않음` });
  }

  /** 1시간 제한: 생존 HP 합산 승부 */
  function tickAll() {
    const LIMIT = 60 * 60 * 1000;
    const nowMs = now();
    for (const b of battles.values()) {
      if (b.status !== 'active') continue;
      const elapsed = nowMs - (b.createdAt || nowMs);
      if (elapsed < LIMIT) continue;

      const sumHp = (team) =>
        b.players.filter(p => p.team === team && p.hp > 0).reduce((acc, p) => acc + p.hp, 0);
      const aHp = sumHp('A');
      const bHp = sumHp('B');

      b.status = 'ended';
      b.phase = 'waiting';
      const winner = aHp > bHp ? 'A' : bHp > aHp ? 'B' : 'Draw';
      b.logs.push({
        ts: now(),
        type: 'result',
        message: `시간 만료 — 최종 생존 HP 합산 결과 ${winner}팀 승리 (A:${aHp}, B:${bHp})`
      });
    }
  }

  return {
    create,
    get,
    size,
    snapshot,
    start,
    end,
    addPlayer,
    removePlayer,
    authByToken,
    markReady,
    playerAction,
    tickAll
  };
}
