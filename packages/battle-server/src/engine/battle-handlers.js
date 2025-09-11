// Battle 경량 핸들러: 인메모리 상태 관리와 보조 유틸
// - index.js 또는 socketHandlers.js에서 사용
// - 상태키: waiting | active | paused | ended
// - 규정 준수: 선공 → 후공 = 결과(1라운드), 다음 라운드는 직전 후공이 선공
// - 선공 결정: 팀별 (민첩 + d20) 합계 비교, 동점 시 자동 재굴림

"use strict";

// 간단한 d20 주사위
function d20() { return Math.floor(Math.random() * 20) + 1; }

function createBattle({ id, mode = "2v2", adminToken, spectatorOtp }) {
  if (!id) {
    throw new Error("Battle ID is required");
  }

  return {
    id,
    mode,
    adminToken,
    spectatorOtp,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,

    // 라운드/페이즈 기반
    turn: {
      round: 0,                 // 실제 시작 시 1로 세팅
      order: ["A", "B"],        // ["A","B"] = A가 선공, ["B","A"] = B가 선공
      phaseIndex: 0,            // 0=선공 페이즈, 1=후공 페이즈
      acted: { A: new Set(), B: new Set() } // 각 페이즈 내 “행동 완료 플레이어 ID”
    },

    // 레거시 호환 필드(필요 시 사용)
    turnMs: 5 * 60 * 1000,
    current: null,          // 현재 페이즈 팀키("phoenix"/"eaters")를 외부에서 기대한다면 매핑 제공
    firstTeamKey: null,     // 첫 라운드 선공 팀("phoenix"/"eaters")

    players: [],            // { id, name, team: "phoenix"|"eaters", stats:{atk,def,agi,luk}, hp, ready, avatarUrl }
    log: [],                // { type, message, ts }
    effects: []             // 일회성 보정들(defenseBoost/dodgePrep 등)
  };
}

/* ---------- 로그 ---------- */
function pushLog(battle, entry) {
  if (!battle || !entry) return;

  const logEntry = {
    type: entry.type || "system",
    message: entry.message || "",
    ts: Date.now(),
    ...entry
  };

  battle.log = battle.log || [];
  battle.log.push(logEntry);

  // 메모리 제한
  if (battle.log.length > 500) {
    battle.log.splice(0, battle.log.length - 500);
  }
}

/* ---------- 종료/승패 ---------- */
function isBattleOver(battle) {
  if (!battle || !Array.isArray(battle.players)) return true;
  if (battle.status === "ended") return true;

  const aliveA = battle.players.some(p => p && p.team === "phoenix" && (p.hp || 0) > 0);
  const aliveB = battle.players.some(p => p && p.team === "eaters"  && (p.hp || 0) > 0);
  return !(aliveA && aliveB);
}

function winnerByHpSum(battle) {
  if (!battle || !Array.isArray(battle.players)) return null;

  const sum = (teamKey) =>
    battle.players
      .filter(p => p && p.team === teamKey)
      .reduce((s, p) => s + (p?.hp || 0), 0);

  const sumA = sum("phoenix");
  const sumB = sum("eaters");

  if (sumA === sumB) return null;
  return sumA > sumB ? "phoenix" : "eaters";
}

/* ---------- 선공 결정(규정 준수) ---------- */
// 규정: 팀별 (민첩 + d20) 합계를 비교, 동점 시 자동 재굴림
function decideLeadingOrder(players) {
  const rollTeam = (teamKey) => {
    return players
      .filter(p => p && p.team === teamKey)
      .reduce((tot, p) => {
        const agi = Number(p?.stats?.agi || 0);
        return tot + agi + d20();
      }, 0);
  };

  // 동점 재굴림
  while (true) {
    const a = rollTeam("phoenix");
    const b = rollTeam("eaters");
    if (a > b) return ["A", "B"]; // A=phoenix 선공
    if (b > a) return ["B", "A"]; // B=eaters 선공
  }
}

/* ---------- 시작/종료 ---------- */
function startBattle(battle) {
  if (!battle || battle.status === "active") return;

  battle.status = "active";
  battle.startedAt = Date.now();

  if (!Array.isArray(battle.players)) battle.players = [];

  // 선공 결정 (민첩+d20 합, 동점 재굴림)
  const order = decideLeadingOrder(battle.players); // ["A","B"] or ["B","A"]
  battle.turn.order = order;
  battle.turn.phaseIndex = 0;
  battle.turn.round = 1;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  // 레거시 호환: firstTeamKey/current을 팀 문자열로 제공
  const leadTeam = order[0] === "A" ? "phoenix" : "eaters";
  battle.firstTeamKey = leadTeam;
  battle.current = leadTeam;

  pushLog(battle, { type: "system", message: `전투 시작 (1턴 선공: ${leadTeam === "phoenix" ? "A팀" : "B팀"})` });
}

function endBattle(battle) {
  if (!battle) return;
  battle.status = "ended";
  battle.endedAt = Date.now();
}

/* ---------- 내부 유틸: 팀/생존자/매핑 ---------- */
function _phaseTeamLetter(battle) {
  return battle.turn.order[battle.turn.phaseIndex]; // "A" | "B"
}
function _letterToTeamKey(letter) { return letter === "A" ? "phoenix" : "eaters"; }
function _teamKeyToLetter(teamKey) { return teamKey === "phoenix" ? "A" : "B"; }
function _otherLetter(letter) { return letter === "A" ? "B" : "A"; }

function _aliveIdsOfTeam(battle, teamKey) {
  return (battle.players || [])
    .filter(p => p && p.team === teamKey && (p.hp || 0) > 0)
    .map(p => p.id);
}

/* ---------- 턴/페이즈 관리 핵심 ---------- */
// actorId가 정상적으로 한 번 행동을 끝냈을 때 호출하세요.
// 반환값:
// - { teamPhaseCompleted: boolean, roundCompleted: boolean, currentTeamKey: "phoenix"|"eaters" }
function nextTurn(battle, { actorId } = {}) {
  if (!battle || battle.status !== "active") {
    return { teamPhaseCompleted: false, roundCompleted: false, currentTeamKey: null };
  }

  // 현재 페이즈의 팀 레터(“A”|“B”)와 키(“phoenix”|“eaters”)
  const phaseLetter = _phaseTeamLetter(battle);
  const phaseTeamKey = _letterToTeamKey(phaseLetter);

  // 행동자 체크: 같은 팀만 카운트
  if (actorId) {
    // actor가 현재 페이즈 팀 소속인지 검증
    const actor = (battle.players || []).find(p => p && p.id === actorId);
    if (actor && actor.team === phaseTeamKey && (actor.hp || 0) > 0) {
      battle.turn.acted[phaseLetter].add(actorId);
    }
  }

  // 페이즈 종료 조건: 현재 페이즈 팀의 "생존자 전원"이 1회 행동을 마쳤는가
  const aliveIds = _aliveIdsOfTeam(battle, phaseTeamKey);
  const actedSet = battle.turn.acted[phaseLetter];

  let teamPhaseCompleted = true;
  for (const id of aliveIds) {
    if (!actedSet.has(id)) { teamPhaseCompleted = false; break; }
  }

  if (!teamPhaseCompleted) {
    // 아직 같은 페이즈 계속
    battle.current = phaseTeamKey; // 레거시 호환
    return { teamPhaseCompleted: false, roundCompleted: false, currentTeamKey: battle.current };
  }

  // 페이즈가 끝났다면: 선공(phaseIndex=0) → 후공(1) 전환
  if (battle.turn.phaseIndex === 0) {
    battle.turn.phaseIndex = 1;
    // 다음 페이즈 카운터 초기화
    const nextLetter = _phaseTeamLetter(battle);
    battle.turn.acted[nextLetter] = new Set();

    // 레거시 호환: current 업데이트
    battle.current = _letterToTeamKey(nextLetter);

    pushLog(battle, { type: "system", message: "후공 페이즈로 전환" });
    return { teamPhaseCompleted: true, roundCompleted: false, currentTeamKey: battle.current };
  }

  // 후공 페이즈까지 끝났다면: 라운드 종료
  // 다음 라운드는 “직전 후공팀이 선공”이 되도록 order 스왑
  const oldLead = battle.turn.order[0];
  const oldLag  = battle.turn.order[1];
  battle.turn.order = [oldLag, oldLead];
  battle.turn.round += 1;
  battle.turn.phaseIndex = 0;
  battle.turn.acted.A = new Set();
  battle.turn.acted.B = new Set();

  // 레거시 호환: current 갱신
  const newLeadTeamKey = _letterToTeamKey(battle.turn.order[0]);
  battle.current = newLeadTeamKey;
  battle.firstTeamKey = newLeadTeamKey; // 필요시 참고

  pushLog(battle, { type: "system", message: `라운드 종료 → ${battle.turn.round}턴 시작 준비 (선공: ${newLeadTeamKey === "phoenix" ? "A팀" : "B팀"})` });

  return { teamPhaseCompleted: true, roundCompleted: true, currentTeamKey: battle.current };
}

/* ---------- 유효성/클린업 ---------- */
function validateBattleState(battle) {
  if (!battle) throw new Error("Battle object is required");
  if (!battle.id) throw new Error("Battle ID is required");

  if (!Array.isArray(battle.players)) battle.players = [];
  if (!Array.isArray(battle.log)) battle.log = [];
  if (!Array.isArray(battle.effects)) battle.effects = [];

  const validStatuses = ["waiting", "active", "paused", "ended"];
  if (!validStatuses.includes(battle.status)) {
    battle.status = "waiting";
  }

  // turn 구조 보정
  if (!battle.turn) {
    battle.turn = {
      round: 0,
      order: ["A", "B"],
      phaseIndex: 0,
      acted: { A: new Set(), B: new Set() }
    };
  } else {
    if (!Array.isArray(battle.turn.order) || battle.turn.order.length !== 2) {
      battle.turn.order = ["A", "B"];
    }
    if (typeof battle.turn.phaseIndex !== "number") battle.turn.phaseIndex = 0;
    if (!battle.turn.acted) battle.turn.acted = { A: new Set(), B: new Set() };
    if (!(battle.turn.acted.A instanceof Set)) battle.turn.acted.A = new Set(Array.from(battle.turn.acted.A || []));
    if (!(battle.turn.acted.B instanceof Set)) battle.turn.acted.B = new Set(Array.from(battle.turn.acted.B || []));
    if (typeof battle.turn.round !== "number") battle.turn.round = 0;
  }

  return battle;
}

function cleanupBattle(battle) {
  if (!battle) return;

  if (Array.isArray(battle.log) && battle.log.length > 1000) {
    battle.log = battle.log.slice(-500);
  }
  if (Array.isArray(battle.effects)) {
    battle.effects = battle.effects.filter(effect => effect && (effect.charges || 0) > 0);
  }
}

module.exports = {
  createBattle,
  pushLog,
  isBattleOver,
  winnerByHpSum,
  startBattle,
  endBattle,
  nextTurn,            // 이제 라운드/페이즈 규칙에 맞게 동작
  validateBattleState,
  cleanupBattle
};
