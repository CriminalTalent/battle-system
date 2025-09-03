// packages/battle-server/src/engine/BattleEngine.js
// 규칙 엔진: 요청하신 공식/아이템/치명타/회피/방어/패스 반영

const TEAM_A = 'phoenix';
const TEAM_B = 'death';

function d20() { return Math.floor(Math.random() * 20) + 1; }
function d100() { return Math.floor(Math.random() * 100) + 1; }
function now() { return Date.now(); }

exports.BattleEngine = function BattleEngine(battle) {
  const b = battle;

  function currentTeam() { return b.order.team; }

  function alivePlayers(team) {
    return Object.values(b.players).filter(p => p.team === team && p.alive);
  }

  function nextTeam(team) { return team === TEAM_A ? TEAM_B : TEAM_A; }

  function advanceTurn() {
    b.order.team = nextTeam(b.order.team);
    b.logs.push({ t: now(), type: 'turn', msg: `turn=${b.order.team}` });
  }

  function getPlayer(id) { return b.players[id]; }

  function markDeath(p) {
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false;
      b.logs.push({ t: now(), type: 'death', msg: `down=${p.name}` });
    }
  }

  function teamWiped(team) {
    return alivePlayers(team).length === 0;
  }

  function winnerIfAny() {
    if (teamWiped(TEAM_A)) return TEAM_B;
    if (teamWiped(TEAM_B)) return TEAM_A;
    return null;
  }

  function consumeItem(p, key) {
    if (!p.items[key] || p.items[key] <= 0) return false;
    p.items[key] -= 1;
    return true;
  }

  function pushLog(msg) {
    b.logs.push({ t: now(), type: 'action', msg });
  }

  function processAction(playerId, action) {
    const actor = getPlayer(playerId);
    if (!actor || !actor.alive) return { ok: false, error: 'invalid actor' };

    // 턴 팀 확인
    if (actor.team !== currentTeam()) {
      return { ok: false, error: 'not your team turn' };
    }

    actor.lastActionAt = now();

    switch (action.type) {
      case 'attack': {
        const target = getPlayer(action.targetId);
        if (!target || !target.alive || target.team === actor.team) {
          return { ok: false, error: 'invalid target' };
        }
        const roll = d20();
        const crit = roll >= (20 - actor.stats.luk / 2);

        // 회피 체크: 대상이 직전 턴에 회피 대기중이면
        let dodged = false;
        if (target.status.pending?.dodge) {
          const droll = d20();
          const dodgeScore = target.stats.agi + droll;
          if (dodgeScore >= actor.stats.atk) {
            dodged = true;
          }
          // 회피 소모
          delete target.status.pending.dodge;
        }

        if (dodged) {
          pushLog(`attack miss by ${actor.name} to ${target.name}`);
        } else {
          // 방어 보정(효과) 확인
          let defenderDef = target.stats.def;
          const hasDefBoost = popEffect(target, 'defense_boost');
          if (hasDefBoost) defenderDef = Math.floor(defenderDef * 1.5);

          let dmg = actor.stats.atk + roll - defenderDef;
          if (crit) dmg = Math.floor(dmg * 2);
          if (dmg < 0) dmg = 0;

          // 공격 보정(효과) 확인
          const hasAtkBoost = popEffect(actor, 'attack_boost');
          if (hasAtkBoost) dmg = Math.floor(dmg * 1.5);

          target.hp -= dmg;
          if (target.hp < 0) target.hp = 0;

          pushLog(`attack ${actor.name} -> ${target.name} roll=${roll} crit=${crit ? 1 : 0} dmg=${dmg}`);
          markDeath(target);
        }

        // 팀 전체 행동 규칙(한 팀 전원 행동 후 상대 팀): 여기서는 팀 단위 턴으로 해석 → 한 액션 끝나면 즉시 턴 교대
        advanceTurn();

        const w = winnerIfAny();
        if (w) {
          b.logs.push({ t: now(), type: 'system', msg: `winner=${w}` });
        }

        return { advancedTurn: true };
      }

      case 'defend': {
        // 다음 방어에만 적용되는 보정 효과(아이템과 별개)
        // 기본 방어는 수치로 이미 반영되므로 여기서는 대기 상태만 기록
        actor.status.pending.defend = true;
        pushLog(`defend ready ${actor.name}`);
        advanceTurn();
        return { advancedTurn: true };
      }

      case 'dodge': {
        actor.status.pending.dodge = true;
        pushLog(`dodge ready ${actor.name}`);
        advanceTurn();
        return { advancedTurn: true };
      }

      case 'useItem': {
        const key = String(action.item || '').toLowerCase();
        if (key === 'diterney') {
          if (!consumeItem(actor, 'diterney')) {
            return { ok: false, error: 'no item' };
          }
          actor.hp = Math.min(100, actor.hp + 10);
          pushLog(`use diterney ${actor.name} +10`);
          advanceTurn();
          return { advancedTurn: true };
        }
        if (key === 'attack_boost') {
          if (!consumeItem(actor, 'attack_boost')) {
            return { ok: false, error: 'no item' };
          }
          const ok = d100() <= 10;
          if (ok) addEffect(actor, 'attack_boost');
          pushLog(`use attack_boost ${actor.name} success=${ok ? 1 : 0}`);
          advanceTurn();
          return { advancedTurn: true };
        }
        if (key === 'defense_boost') {
          if (!consumeItem(actor, 'defense_boost')) {
            return { ok: false, error: 'no item' };
          }
          const ok = d100() <= 10;
          if (ok) addEffect(actor, 'defense_boost');
          pushLog(`use defense_boost ${actor.name} success=${ok ? 1 : 0}`);
          advanceTurn();
          return { advancedTurn: true };
        }
        return { ok: false, error: 'unknown item' };
      }

      case 'pass': {
        pushLog(`pass ${actor.name}`);
        advanceTurn();
        return { advancedTurn: true };
      }

      default:
        return { ok: false, error: 'unknown action' };
    }
  }

  function addEffect(p, type) {
    p.status.effects.push({ type, duration: 1, ts: now() });
  }

  function popEffect(p, type) {
    const idx = p.status.effects.findIndex(e => e.type === type);
    if (idx >= 0) {
      p.status.effects.splice(idx, 1);
      return true;
    }
    return false;
  }

  function autoPassIfInactive(thresholdMs) {
    if (!b.startedAt) return false;
    // 현재 팀의 임의 플레이어 중 가장 최근 액션 경과 시간 확인
    const team = b.order.team;
    const members = alivePlayers(team);
    if (members.length === 0) {
      // 전멸 시 승부 처리
      const w = team === TEAM_A ? TEAM_B : TEAM_A;
      b.logs.push({ t: now(), type: 'system', msg: `winner=${w}` });
      return true;
    }
    const last = Math.min(...members.map(p => p.lastActionAt || b.startedAt));
    if (now() - last >= thresholdMs) {
      b.logs.push({ t: now(), type: 'system', msg: `auto-pass team=${team}` });
      // 팀 패스(팀 단위 턴이므로 한 번에 턴 넘김)
      b.order.team = team === TEAM_A ? TEAM_B : TEAM_A;
      // 다음 턴 시작 시각 갱신
      members.forEach(p => p.lastActionAt = now());
      return true;
    }
    return false;
  }

  return {
    processAction,
    autoPassIfInactive,
  };
};
