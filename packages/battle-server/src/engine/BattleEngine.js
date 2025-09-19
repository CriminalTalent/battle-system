// packages/battle-server/src/engine/BattleEngine.js
// drop-in 교체본: 5분 선택페이즈, 1초 스냅샷, 해석단일적용, STDOUT 로그

// 유틸
const now = () => Date.now();
const rid = (p = '') => (p + Math.random().toString(36).slice(2, 8)).toUpperCase();

function safeInt(n, d = 0) { n = Number(n); return Number.isFinite(n) ? Math.floor(n) : d; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// 콘솔/소켓 동시 로그
function pushLog(battle, message, type = 'system') {
  const entry = { ts: now(), type, message };
  battle.logs.push(entry);

  // STDOUT 방출: pm2 logs 에서 보이도록
  if (process.env.ENGINE_STDOUT === '1' || String(process.env.ENGINE_STDOUT).toLowerCase() === 'true') {
    const t = new Date(entry.ts).toISOString();
    console.log(`[ENGINE] ${t} ${type}: ${message}`);
  }

  // 소켓으로 전달(서버에서 주입)
  if (typeof battle._emitLog === 'function') {
    try { battle._emitLog(entry); } catch { /* noop */ }
  }
}

// 스냅샷 송출
function emitSnapshot(battle) {
  if (typeof battle._emitUpdate === 'function') {
    try { battle._emitUpdate(getSnapshot(battle)); } catch { /* noop */ }
  }
}

// 전투 스냅샷(클라 용)
function getSnapshot(battle) {
  return {
    id: battle.id,
    mode: battle.mode,
    status: battle.status,      // waiting | active | paused | ended
    round: battle.round,
    phase: battle.phase,        // select | resolve | intermission | null
    currentTeamTurn: battle.currentTeamTurn, // 'A' | 'B'
    phaseEndsAt: battle.phaseEndsAt || null,
    createdAt: battle.createdAt,
    players: battle.players.map(p => ({
      id: p.id, name: p.name, team: p.team,
      hp: p.hp, maxHp: p.maxHp,
      avatar: p.avatar || null,
      ready: !!p.ready,
      stats: { ...p.stats },
      items: { ...p.items }
    })),
  };
}

// 선공 결정(동률시 재굴림 로그 포함)
function decideInitiative(battle) {
  const sum = (team) => {
    const base = battle.players.filter(p => p.team === team).reduce((a, p) => a + (p.stats?.agility || 0), 0);
    const roll = 1 + Math.floor(Math.random() * 9); // 1~9
    return { base, roll, total: base + roll };
  };
  let tries = 0;
  while (tries++ < 5) {
    const A1 = sum('A'), B1 = sum('B');
    pushLog(battle, `선공 결정: A팀(민첩 ${A1.base} + ${A1.roll} = ${A1.total}) vs B팀(민첩 ${B1.base} + ${B1.roll} = ${B1.total})`, 'system');
    if (A1.total !== B1.total) {
      battle.currentTeamTurn = A1.total > B1.total ? 'A' : 'B';
      pushLog(battle, `${battle.currentTeamTurn}팀이 선공입니다!`, 'system');
      return;
    }
  }
  // 마지막엔 랜덤
  battle.currentTeamTurn = Math.random() < 0.5 ? 'A' : 'B';
  pushLog(battle, `${battle.currentTeamTurn}팀이 선공입니다!`, 'system');
}

// 라운드 선택 페이즈(5분)
function startSelectPhase(battle) {
  clearTimers(battle);
  battle.phase = 'select';
  battle.phaseEndsAt = now() + 5 * 60 * 1000; // 5분
  const turnTeam = battle.currentTeamTurn || 'A';
  pushLog(battle, `=== ${turnTeam}팀 선택 페이즈 시작 ===`, 'system');

  // 1초마다 스냅샷 갱신(클라 카운트다운)
  battle.timers.tick = setInterval(() => emitSnapshot(battle), 1000);

  // 5분 후 해석
  battle.timers.deadline = setTimeout(() => {
    resolveRound(battle);
  }, battle.phaseEndsAt - now());

  emitSnapshot(battle);
}

function startIntermission(battle) {
  clearTimers(battle);
  battle.phase = 'intermission';
  battle.phaseEndsAt = now() + 5 * 1000; // 라운드 사이 5초 안내
  pushLog(battle, `=== ${battle.round}라운드 종료 ===`, 'system');
  pushLog(battle, `5초 후 다음 라운드 시작...`, 'system');
  battle.timers.tick = setInterval(() => emitSnapshot(battle), 1000);
  battle.timers.deadline = setTimeout(() => {
    battle.round += 1;
    // 선공 교대
    battle.currentTeamTurn = battle.currentTeamTurn === 'A' ? 'B' : 'A';
    pushLog(battle, `${battle.round}라운드 시작`, 'system');
    startSelectPhase(battle);
  }, 5000);
  emitSnapshot(battle);
}

function resolveRound(battle) {
  clearTimers(battle);
  if (battle.status !== 'active') return;

  battle.phase = 'resolve';
  battle.phaseEndsAt = null;
  pushLog(battle, '라운드 해석', 'system');

  // 모아둔 선택지를 해석해서 한 번에 적용(샘플: 양 팀 각각 한 번씩 공격)
  const alive = (team) => battle.players.filter(p => p.team === team && p.hp > 0);
  const A = alive('A'), B = alive('B');

  const dmgOf = (atk, def) => {
    const base = clamp((atk.stats?.attack || 1) + 1 + Math.floor(Math.random() * 4), 1, 12); // 2~5(+)
    const mitig = clamp((def.stats?.defense || 0), 0, 4);
    return clamp(base - Math.floor(mitig / 2), 1, 12);
  };

  const once = (atkTeam, defTeam) => {
    const AT = alive(atkTeam), DT = alive(defTeam);
    if (!AT.length || !DT.length) return;
    const atk = AT[Math.floor(Math.random() * AT.length)];
    const def = DT[Math.floor(Math.random() * DT.length)];
    const crit = Math.random() < ((atk.stats?.luck || 0) * 0.05);
    let dmg = dmgOf(atk, def);
    if (crit) dmg = Math.min(dmg * 3, 30);
    def.hp = clamp(def.hp - dmg, 0, def.maxHp || 100);
    const verb = crit ? '치명타 공격' : '공격';
    pushLog(battle, `→ ${atk.name}이(가) ${def.name}에게 ${verb} (피해 ${dmg}) → HP ${def.hp}`, (atk.team === 'A') ? 'battle' : 'item');
  };

  // 선공-후공 모두 적용
  once(battle.currentTeamTurn, battle.currentTeamTurn === 'A' ? 'B' : 'A');
  once(battle.currentTeamTurn === 'A' ? 'B' : 'A', battle.currentTeamTurn);

  emitSnapshot(battle);
  startIntermission(battle);
}

function clearTimers(battle) {
  if (battle.timers?.tick) clearInterval(battle.timers.tick);
  if (battle.timers?.deadline) clearTimeout(battle.timers.deadline);
  if (battle.timers?.intermission) clearTimeout(battle.timers.intermission);
  battle.timers = { tick: null, deadline: null, intermission: null };
}

// ====== 퍼블릭 스토어 ======
export function createBattleStore() {
  const battles = new Map();

  function create(mode = '2v2') {
    const id = 'B' + Date.now().toString(36).toUpperCase();
    const battle = {
      id, mode,
      createdAt: now(),
      status: 'waiting',
      round: 0,
      phase: null,
      phaseEndsAt: null,
      currentTeamTurn: 'A',
      players: [],
      logs: [],
      timers: { tick: null, deadline: null, intermission: null },
      _emitUpdate: null,
      _emitLog: null,
    };
    battles.set(id, battle);
    pushLog(battle, `[ENGINE LOADED] battle-engine@resolve-only-apply`, 'system');
    return battle;
  }

  function get(battleId) { return battles.get(battleId) || null; }

  function snapshot(battleId) {
    const b = get(battleId);
    return b ? getSnapshot(b) : null;
  }

  function addPlayer(battleId, player) {
    const b = get(battleId);
    if (!b || b.status === 'ended') throw new Error('battle not found/ended');
    const p = {
      id: rid('P'),
      name: String(player?.name || '플레이어'),
      team: (player?.team === 'B') ? 'B' : 'A',
      hp: clamp(safeInt(player?.hp, 100), 1, 1000),
      maxHp: clamp(safeInt(player?.maxHp ?? player?.hp ?? 100, 100), 1, 1000),
      avatar: player?.avatar || null,
      ready: false,
      stats: {
        attack: clamp(safeInt(player?.stats?.attack ?? 1, 1), 0, 10),
        defense: clamp(safeInt(player?.stats?.defense ?? 1, 1), 0, 10),
        agility: clamp(safeInt(player?.stats?.agility ?? 1, 1), 0, 10),
        luck: clamp(safeInt(player?.stats?.luck ?? 1, 1), 0, 10),
      },
      items: {
        dittany: clamp(safeInt(player?.items?.dittany ?? 0, 0), 0, 99),
        attackBooster: clamp(safeInt(player?.items?.attackBooster ?? 0, 0), 0, 99),
        defenseBooster: clamp(safeInt(player?.items?.defenseBooster ?? 0, 0), 0, 99),
      },
    };
    b.players.push(p);
    pushLog(b, `${p.name}이(가) ${p.team}팀에 추가되었습니다`, 'system');
    emitSnapshot(b);
    return p;
  }

  function deletePlayer(battleId, playerId) {
    const b = get(battleId); if (!b) return false;
    const idx = b.players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      const [p] = b.players.splice(idx, 1);
      pushLog(b, `${p?.name || '플레이어'}이(가) 제거되었습니다`, 'system');
      emitSnapshot(b);
      return true;
    }
    return false;
  }

  function startBattle(battleId) {
    const b = get(battleId);
    if (!b) throw new Error('battle not found');
    if (b.status === 'ended') throw new Error('battle ended');
    b.status = 'active';
    b.round = 1;
    pushLog(b, '전투가 시작되었습니다!', 'system');
    pushLog(b, `${b.round}라운드 시작`, 'system');
    decideInitiative(b);
    startSelectPhase(b);
    return getSnapshot(b);
  }

  function pauseBattle(battleId) {
    const b = get(battleId); if (!b) throw new Error('battle not found');
    if (b.status !== 'active') return;
    b.status = 'paused';
    pushLog(b, '전투가 일시정지되었습니다', 'system');
    clearTimers(b);
    emitSnapshot(b);
  }

  function resumeBattle(battleId) {
    const b = get(battleId); if (!b) throw new Error('battle not found');
    if (b.status !== 'paused') return;
    b.status = 'active';
    pushLog(b, '전투가 재개되었습니다', 'system');
    // 재개 시 선택 페이즈를 새로 5분 부여
    startSelectPhase(b);
  }

  function endBattle(battleId) {
    const b = get(battleId); if (!b) return;
    b.status = 'ended';
    clearTimers(b);
    pushLog(b, '전투가 종료되었습니다', 'system');
    emitSnapshot(b);
  }

  return {
    create,
    get,
    snapshot,
    addPlayer,
    deletePlayer,
    startBattle,
    pauseBattle,
    resumeBattle,
    endBattle,
  };
}
