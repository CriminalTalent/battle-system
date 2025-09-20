// packages/battle-server/src/engine/BattleEngine.js
// PYXIS Battle Engine (ESM)

import { v4 as uuidv4 } from 'uuid';

/**
 * 전투 스토어 생성
 */
export function createBattleStore() {
  const battles = new Map();

  function createBattle({ id, players, rules }) {
    const battleId = id || uuidv4();
    const battle = {
      id: battleId,
      players: players || [],
      phase: 'waiting',
      round: 0,
      status: 'idle',
      currentTurn: null,
      logs: [],
      rules: rules || { mode: 'deathmatch', timeLimitSec: 3600 }, // 총 1시간 제한
    };
    battles.set(battleId, battle);
    return battle;
  }

  function getBattle(id) {
    return battles.get(id);
  }

  function addPlayer(battleId, player) {
    const battle = getBattle(battleId);
    if (!battle) return null;
    battle.players.push({
      ...player,
      hp: player.maxHp || 100,
      ready: false,
      stats: player.stats || { attack: 0, defense: 0, agility: 0, luck: 0 },
      items: player.items || {},
    });
    return battle;
  }

  function markReady(battleId, playerId) {
    const battle = getBattle(battleId);
    if (!battle) return null;
    const p = battle.players.find(x => x.id === playerId);
    if (p) p.ready = true;
    return battle;
  }

  /**
   * 페이즈 타이머 (팀당 5분, 1초마다 카운트다운)
   */
  function startPhaseTimer(battle, seconds = 300, onExpire, onTick) {
    if (battle.currentTurn?.timerId) {
      clearInterval(battle.currentTurn.timerId);
      battle.currentTurn.timerId = null;
    }

    const deadline = Date.now() + seconds * 1000;
    if (!battle.currentTurn) battle.currentTurn = {};
    battle.currentTurn.deadlineAt = deadline;

    const tick = () => {
      const leftMs = Math.max(0, deadline - Date.now());
      const leftSec = Math.ceil(leftMs / 1000);
      battle.currentTurn.timeLeftSec = leftSec;

      if (typeof onTick === 'function') onTick(battle);

      if (leftSec <= 0) {
        clearInterval(battle.currentTurn.timerId);
        battle.currentTurn.timerId = null;
        if (typeof onExpire === 'function') onExpire(battle);
      }
    };

    battle.currentTurn.timerId = setInterval(tick, 1000);
    tick();
  }

  function log(battle, type, message) {
    const entry = { ts: Date.now(), type, message };
    battle.logs.push(entry);
    if (battle.logs.length > 1000) battle.logs.shift();
    return entry;
  }

  // 행동 등록 (세부 계산은 resolvePhase에서)
  function registerAction(battleId, playerId, action) {
    const battle = getBattle(battleId);
    if (!battle) return null;
    if (!battle.actions) battle.actions = [];
    battle.actions.push({ playerId, ...action });
    return battle;
  }

  // 라운드 해석 (피해, 회복 적용)
  function resolveRound(battleId) {
    const battle = getBattle(battleId);
    if (!battle) return null;

    const actions = battle.actions || [];
    actions.forEach(act => {
      const actor = battle.players.find(p => p.id === act.playerId);
      const target = battle.players.find(p => p.id === act.targetId);
      if (!actor) return;

      if (act.type === 'attack' && target) {
        const dmg = Math.max(1, actor.stats.attack - target.stats.defense + (Math.floor(Math.random()*6)));
        target.hp = Math.max(0, target.hp - dmg);
        log(battle, actor.team === 'A' ? 'teamA' : 'teamB',
          `${actor.name}이(가) ${target.name}에게 공격 (피해 ${dmg}) → HP ${target.hp}`);
      }

      if (act.type === 'item' && act.item === 'dittany' && target) {
        const heal = 10;
        target.hp = Math.min(target.maxHp || 100, target.hp + heal);
        log(battle, actor.team === 'A' ? 'teamA' : 'teamB',
          `${actor.name}이(가) ${target.name}에게 디터니 사용 (회복 ${heal}) → HP ${target.hp}`);
      }
    });

    battle.actions = [];
    return battle;
  }

  return {
    createBattle,
    getBattle,
    addPlayer,
    markReady,
    startPhaseTimer,
    log,
    registerAction,
    resolveRound,
  };
}
