/* packages/battle-server/src/engine/BattleEngine.js (ESM) */
import crypto from 'node:crypto';

export function createBattleStore() {
  const store = new Map(); // battleId -> battle

  function uid(n = 8) { return crypto.randomBytes(n).toString('hex').slice(0, n); }

  function basePlayer(p, team = 'A') {
    const name = (p?.name || 'Player').slice(0, 24);
    const id = p?.id || uid(6);
    const hp = Number(p?.hp ?? 100);
    const maxHp = Number(p?.maxHp ?? hp);
    const stats = {
      attack: Number(p?.stats?.attack ?? 1),
      defense: Number(p?.stats?.defense ?? 1),
      agility: Number(p?.stats?.agility ?? 1),
      luck: Number(p?.stats?.luck ?? 1)
    };
    const items = {
      dittany: Number(p?.items?.dittany ?? p?.items?.ditany ?? 0),
      attackBooster: Number(p?.items?.attackBooster ?? p?.items?.attack_boost ?? 0),
      defenseBooster: Number(p?.items?.defenseBooster ?? p?.items?.defense_boost ?? 0)
    };
    return {
      id, name, team,
      hp, maxHp,
      stats, items,
      avatar: p?.avatar || '',
      ready: false,
      token: p?.token || null
    };
  }

  function create(mode = '2v2') {
    const b = {
      id: uid(8),
      mode,
      status: 'waiting',     // waiting | active | paused | ended
      round: 0,
      currentTeam: 'A',      // 선공
      phase: 'inter',        // inter | A_select | B_select | resolve
      currentTurn: {
        turnNumber: 0,
        currentTeam: 'A',
        timeLeftSec: 0,
        currentPlayer: null
      },
      players: [],
      logs: [],
      actions: { A: [], B: [] }, // 이번 라운드 수집
      spectatorOtp: null,
      winner: null
    };
    store.set(b.id, b);
    return b;
  }

  function get(id) { return store.get(id) || null; }
  function size() { return store.size; }

  function snapshot(id) {
    const b = get(id);
    if (!b) return null;
    return {
      id: b.id,
      mode: b.mode,
      status: b.status,
      round: b.round,
      phase: b.phase,
      currentTurn: {
        turnNumber: b.currentTurn.turnNumber,
        currentTeam: b.currentTeam,
        currentPlayer: b.currentTurn.currentPlayer,
        timeLeftSec: b.currentTurn.timeLeftSec
      },
      players: b.players.map(p => ({
        id: p.id, name: p.name, team: p.team,
        hp: p.hp, maxHp: p.maxHp, ready: p.ready,
        stats: p.stats, items: p.items, avatar: p.avatar
      }))
    };
  }

  function pushLog(battleId, type, message) {
    const b = get(battleId); if (!b) return;
    b.logs.push({ ts: Date.now(), type, message });
  }

  function addPlayer(battleId, player) {
    const b = get(battleId); if (!b) return null;
    const team = player?.team === 'B' ? 'B' : 'A';
    const p = basePlayer(player, team);
    b.players.push(p);
    return p;
  }

  function removePlayer(battleId, playerId) {
    const b = get(battleId); if (!b) return false;
    const i = b.players.findIndex(p => p.id === playerId);
    if (i === -1) return false;
    b.players.splice(i, 1);
    pushLog(battleId, 'system', `플레이어 제거: ${playerId}`);
    return true;
  }

  // 준비 상태
  function markReady(battleId, playerId, ready = true) {
    const b = get(battleId); if (!b) return false;
    const p = b.players.find(x => x.id === playerId); if (!p) return false;
    p.ready = !!ready;
    pushLog(battleId, 'system', `${p.name} 준비완료`);
    // 모두 준비되면 자동 시작
    if (b.status === 'waiting' && b.players.length > 0 && b.players.every(x => x.ready)) start(battleId);
    return true;
  }

  function authByToken(battleId, token) {
    const b = get(battleId); if (!b) return null;
    const t = String(token || '').toLowerCase();
    return b.players.find(p => String(p.token || '').toLowerCase() === t) || null;
  }

  // 라운드 시작
  function start(battleId) {
    const b = get(battleId); if (!b) return { ok: false, error: 'not found' };
    if (b.players.length === 0) return { ok: false, error: 'no players' };
    b.status = 'active';
    b.round = 1;
    b.currentTeam = 'A';                 // 초반 선공
    b.phase = 'A_select';
    b.currentTurn = { turnNumber: 1, currentTeam: 'A', timeLeftSec: 0, currentPlayer: null };
    b.actions = { A: [], B: [] };
    pushLog(battleId, 'notice', `라운드 1 시작 (선공: A팀)`);
    return { ok: true, b };
  }

  function end(battleId) {
    const b = get(battleId); if (!b) return null;
    b.status = 'ended';
    // 간단 승패 판정(잔여 HP 합계)
    const aHp = b.players.filter(p => p.team === 'A').reduce((s, p) => s + Math.max(0, p.hp), 0);
    const bHp = b.players.filter(p => p.team === 'B').reduce((s, p) => s + Math.max(0, p.hp), 0);
    b.winner = aHp === bHp ? 'Draw' : (aHp > bHp ? 'A' : 'B');
    pushLog(battleId, 'result', `전투 종료 – 승자: ${b.winner === 'Draw' ? '무승부' : b.winner + '팀'}`);
    return b;
  }

  // 액션 수집
  function playerAction(battleId, playerId, action) {
    const b = get(battleId); if (!b) return { ok: false, error: 'not found' };
    if (b.status !== 'active') return { ok: false, error: 'inactive' };

    const p = b.players.find(x => x.id === playerId);
    if (!p || p.hp <= 0) return { ok: false, error: 'invalid player' };

    // 이번 라운드 수집 버킷
    const bucket = p.team === 'A' ? b.actions.A : b.actions.B;

    // 이미 제출한 사람은 교체(마지막 제출만 유효)
    const idx = bucket.findIndex(x => x.playerId === p.id);
    const act = normalizeAction(action, p.team);
    if (idx >= 0) bucket[idx] = { playerId: p.id, team: p.team, ...act };
    else bucket.push({ playerId: p.id, team: p.team, ...act });

    // 해당 턴(선/후공 팀)의 간단 중계: 누가 무엇을 함
    pushLog(battleId, 'notice', `${p.name} → ${prettyActionShort(act)}`);

    // 페이즈 전환 조건
    if (b.phase === 'A_select' && allSubmitted(b, 'A')) {
      b.phase = 'B_select';
      pushLog(battleId, 'system', `B팀 선택 대기`);
    } else if (b.phase === 'B_select' && allSubmitted(b, 'B')) {
      // 해석 단계로
      b.phase = 'resolve';
      resolveRound(battleId);
    }

    return { ok: true, result: { accepted: true } };
  }

  function allSubmitted(b, team) {
    const aliveOf = b.players.filter(p => p.team === team && p.hp > 0);
    const acts = team === 'A' ? b.actions.A : b.actions.B;
    // 생존자 중 액션 제출한 사람 수
    return aliveOf.length > 0 && acts.filter(a => aliveOf.some(p => p.id === a.playerId)).length === aliveOf.length;
  }

  function normalizeAction(a, team) {
    const type = (a?.type || '').toLowerCase(); // attack|defend|dodge|item|pass
    const targetId = a?.targetId || null;
    const item = a?.item || null;
    return { type, targetId, item, team };
  }

  function prettyActionShort(a) {
    if (a.type === 'attack') return '공격 준비';
    if (a.type === 'defend') return '방어 준비';
    if (a.type === 'dodge')  return '회피 준비';
    if (a.type === 'item')   return `아이템(${a.item || '?'}) 준비`;
    if (a.type === 'pass')   return '패스';
    return '행동';
    }

  // 라운드 해석(대미지/회복 “순차적” 적용 + 요약중계)
  function resolveRound(battleId) {
    const b = get(battleId); if (!b) return;

    // 선공/후공 결정
    const firstTeam = b.currentTeam;             // 이번 라운드 선공
    const secondTeam = firstTeam === 'A' ? 'B' : 'A';

    // 팀 내 순서: 민첩 desc, 동률이면 이름 asc
    const orderTeam = (team) => {
      const acts = team === 'A' ? b.actions.A : b.actions.B;
      const players = acts
        .map(a => ({ a, p: b.players.find(x => x.id === a.playerId) }))
        .filter(x => x.p && x.p.hp > 0);
      players.sort((x, y) => {
        const d = (y.p.stats.agility || 0) - (x.p.stats.agility || 0);
        if (d !== 0) return d;
        return (x.p.name || '').localeCompare(y.p.name || '', 'ko');
      });
      return players.map(x => x.a);
    };

    const seq = [
      ...orderTeam(firstTeam),
      ...orderTeam(secondTeam)
    ];

    pushLog(battleId, 'battle', `라운드 ${b.round} 해석 시작`);
    // 액션별 개별 시뮬
    const applied = [];

    for (const a of seq) {
      const actor = b.players.find(p => p.id === a.playerId);
      if (!actor || actor.hp <= 0) continue;

      if (a.type === 'attack') {
        const tgt = b.players.find(p => p.id === a.targetId && p.hp > 0);
        if (!tgt) { applied.push(`${actor.name}의 공격은 대상 없음`); continue; }

        const atkMul = (actor.items.attackBooster > 0) ? 2 : 1;
        if (actor.items.attackBooster > 0) actor.items.attackBooster -= 1;

        // 간단한 대미지 식
        let dmg = Math.max(1, (actor.stats.attack * atkMul) - (tgt.stats.defense || 0));
        // 상대가 방어/회피했는지 확인
        const tgtAct = findLastActionOf(b, tgt.id);
        if (tgtAct?.type === 'defend') dmg = Math.max(0, Math.floor(dmg * 0.5));
        if (tgtAct?.type === 'dodge')  dmg = Math.random() < 0.5 ? 0 : dmg;

        tgt.hp = Math.max(0, tgt.hp - dmg);
        applied.push(`${actor.name} → ${tgt.name}에게 공격(${dmg})`);

      } else if (a.type === 'defend') {
        applied.push(`${actor.name} 방어 태세`);

      } else if (a.type === 'dodge') {
        applied.push(`${actor.name} 회피 태세`);

      } else if (a.type === 'item') {
        if (a.item === 'dittany' || a.item === 'ditany') {
          if (actor.items.dittany > 0) {
            const tgt = b.players.find(p => p.id === a.targetId && p.hp > 0 && p.team === actor.team);
            if (tgt) {
              const heal = 10; // 고정 10
              tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
              actor.items.dittany -= 1;
              applied.push(`${actor.name} → ${tgt.name}에게 디터니(+${heal})`);
            } else {
              applied.push(`${actor.name} 디터니 실패(대상없음)`);
            }
          } else {
            applied.push(`${actor.name} 디터니 없음`);
          }
        } else if (a.item === 'defenseBooster') {
          if (actor.items.defenseBooster > 0) {
            actor.items.defenseBooster -= 1;
            actor.stats.defense += 1; // 간단 부스트
            applied.push(`${actor.name} 방어 보정 활성화(+1)`);
          } else applied.push(`${actor.name} 방어 보정기 없음`);
        } else if (a.item === 'attackBooster') {
          if (actor.items.attackBooster > 0) {
            // 사용 처리는 공격 시점에서 차감(1회용 지속)
            applied.push(`${actor.name} 공격 보정 준비(x2)`);
          } else applied.push(`${actor.name} 공격 보정기 없음`);
        } else {
          applied.push(`${actor.name} 아이템(${a.item||'?'}) 실패`);
        }

      } else if (a.type === 'pass') {
        applied.push(`${actor.name} 패스`);
      } else {
        applied.push(`${actor?.name||'누군가'} 알 수 없는 행동`);
      }
    }

    // 라운드 요약 중계(순차 로그)
    for (const line of applied) pushLog(battleId, 'battle', line);

    // 라운드 종료 / 다음 라운드 세팅
    b.round += 1;
    b.currentTeam = (b.currentTeam === 'A') ? 'B' : 'A';  // 선/후공 교대
    b.phase = (b.currentTeam === 'A') ? 'A_select' : 'B_select';
    b.currentTurn = {
      turnNumber: b.currentTurn.turnNumber + 1,
      currentTeam: b.currentTeam,
      timeLeftSec: 0,
      currentPlayer: null
    };
    b.actions = { A: [], B: [] };

    pushLog(battleId, 'notice', `라운드 ${b.round} 시작 준비 (선공: ${b.currentTeam}팀)`);

    // 전투 종료 체크(한 팀 전멸)
    const aAlive = b.players.some(p => p.team === 'A' && p.hp > 0);
    const bAlive = b.players.some(p => p.team === 'B' && p.hp > 0);
    if (!aAlive || !bAlive) {
      end(battleId);
    }
  }

  function findLastActionOf(b, playerId) {
    const a = b.actions.A.findLast?.(x => x.playerId === playerId) ||
              [...b.actions.A].reverse().find(x => x.playerId === playerId);
    const bb = b.actions.B.findLast?.(x => x.playerId === playerId) ||
              [...b.actions.B].reverse().find(x => x.playerId === playerId);
    // 최근 제출을 택함
    return a && bb ? a : (a || bb || null);
  }

  return {
    create, get, size, snapshot,
    addPlayer, removePlayer,
    start, end,
    playerAction, markReady, authByToken,
    pushLog
  };
}
