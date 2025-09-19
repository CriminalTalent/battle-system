// PYXIS 배틀 엔진 - 개선된 턴 시스템 및 로그
// (오탈자/문법/중복/누락만 점검하여 보수, 로직·룰 흐름은 그대로 유지)

class BattleEngine {
  constructor() {
    this.battles = new Map();
    this.timers = new Map();
  }

  // 전투 생성
  create(mode = '2v2') {
    const battleId = `battle_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const battle = {
      id: battleId,
      mode,
      status: 'waiting',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      players: [],
      currentTurn: {
        turnNumber: 0,
        currentTeam: null,
        currentPlayer: null,
        timeLeftSec: 0,
        phase: 'waiting', // waiting, team_action, processing, switching
      },
      turnActions: [], // 현재 턴의 행동들
      roundResults: [], // 라운드 결과들
      logs: [],
      options: {
        timeLimit: 3600 * 1000,     // 1시간
        turnTimeLimit: 300 * 1000,  // 5분
        maxTurns: 100,
        phaseDelay: 5000,           // 5초 페이즈 딜레이
      },
    };

    this.battles.set(battleId, battle);
    return battle;
  }

  // 전투 참가자 추가
  addPlayer(battleId, playerData) {
    const battle = this.battles.get(battleId);
    if (!battle) return null;

    const player = {
      id: `p_${Math.random().toString(36).slice(2, 10)}`,
      name: playerData.name || '익명',
      team: playerData.team === 'B' ? 'B' : 'A',
      hp: playerData.hp || 100,
      maxHp: playerData.maxHp || 100,
      stats: {
        attack: Math.max(1, Math.min(5, playerData.stats?.attack || 1)),
        defense: Math.max(1, Math.min(5, playerData.stats?.defense || 1)),
        agility: Math.max(1, Math.min(5, playerData.stats?.agility || 1)),
        luck: Math.max(1, Math.min(5, playerData.stats?.luck || 1)),
      },
      items: {
        dittany: playerData.items?.dittany || playerData.items?.ditany || 0,
        attackBooster: playerData.items?.attackBooster || playerData.items?.attack_boost || 0,
        defenseBooster: playerData.items?.defenseBooster || playerData.items?.defense_boost || 0,
      },
      avatar: playerData.avatar || '/uploads/avatars/default.svg',
      ready: false,
      stance: 'normal',
      effects: [],
      joinedAt: Date.now(),
    };

    battle.players.push(player);
    return player;
  }

  // 전투 참가자 제거
  removePlayer(battleId, playerId) {
    const battle = this.battles.get(battleId);
    if (!battle) return false;

    const index = battle.players.findIndex((p) => p.id === playerId);
    if (index === -1) return false;

    const removedPlayer = battle.players.splice(index, 1)[0];
    return removedPlayer;
  }

  // 준비 완료 표시
  markReady(battleId, playerId, ready = true) {
    const battle = this.battles.get(battleId);
    if (!battle) return false;

    const player = battle.players.find((p) => p.id === playerId);
    if (!player) return false;

    player.ready = ready;
    return true;
  }

  // 전투 시작
  start(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== 'waiting') return false;

    battle.status = 'active';
    battle.startedAt = Date.now();

    // 선공 결정
    this.determineFirstTeam(battle);

    // 첫 턴 시작
    this.startTurn(battle);

    return true;
  }

  // 선공 결정
  determineFirstTeam(battle) {
    const teamA = battle.players.filter((p) => p.team === 'A');
    const teamB = battle.players.filter((p) => p.team === 'B');

    const agilityA = teamA.reduce((sum, p) => sum + p.stats.agility, 0);
    const agilityB = teamB.reduce((sum, p) => sum + p.stats.agility, 0);

    let rollA;
    let rollB;
    do {
      rollA = agilityA + this.rollDice(20);
      rollB = agilityB + this.rollDice(20);
    } while (rollA === rollB);

    const firstTeam = rollA > rollB ? 'A' : 'B';
    battle.firstTeam = firstTeam;

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message: `선공 결정: A팀 ${agilityA}+${rollA - agilityA}=${rollA}, B팀 ${agilityB}+${rollB - agilityB}=${rollB} → ${firstTeam}팀 선공`,
    });

    return firstTeam;
  }

  // 턴 시작
  startTurn(battle) {
    battle.currentTurn.turnNumber += 1;

    // 턴 순서 결정 (홀수 턴: 선공팀 먼저, 짝수 턴: 후공팀 먼저)
    const isOddTurn = battle.currentTurn.turnNumber % 2 === 1;
    const currentTeam = isOddTurn ? battle.firstTeam : (battle.firstTeam === 'A' ? 'B' : 'A');

    battle.currentTurn.currentTeam = currentTeam;
    battle.currentTurn.phase = 'team_action';
    battle.currentTurn.timeLeftSec = 300; // 5분
    battle.turnActions = [];

    // 현재 팀의 첫 번째 플레이어 설정 (민첩 내림차순, 이름 오름차순)
    const teamPlayers = this.getTeamPlayers(battle, currentTeam);
    if (teamPlayers.length > 0) {
      teamPlayers.sort((a, b) => {
        if (a.stats.agility !== b.stats.agility) {
          return b.stats.agility - a.stats.agility;
        }
        return a.name.localeCompare(b.name);
      });

      // ❗ 누락 보수: name/team 도 함께 전달 (UI에서 사용)
      battle.currentTurn.currentPlayer = {
        id: teamPlayers[0].id,
        name: teamPlayers[0].name,
        team: teamPlayers[0].team,
        avatar: teamPlayers[0].avatar,
      };
    } else {
      battle.currentTurn.currentPlayer = null;
    }

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message: `${battle.currentTurn.turnNumber}턴 시작 - ${currentTeam}팀 행동 페이즈`,
    });

    // 타이머 시작
    this.startTurnTimer(battle);
  }

  // 팀 플레이어 가져오기
  getTeamPlayers(battle, team) {
    return battle.players.filter((p) => p.team === team && p.hp > 0);
  }

  // 턴 타이머 시작
  startTurnTimer(battle) {
    const timerId = `turn_${battle.id}`;

    // 기존 타이머 제거
    if (this.timers.has(timerId)) {
      clearInterval(this.timers.get(timerId));
    }

    const timer = setInterval(() => {
      battle.currentTurn.timeLeftSec -= 1;

      if (battle.currentTurn.timeLeftSec <= 0) {
        // 시간 초과 - 미행동 플레이어들 자동 패스
        this.handleTimeOut(battle);
      }
    }, 1000);

    this.timers.set(timerId, timer);
  }

  // 시간 초과 처리
  handleTimeOut(battle) {
    const currentTeam = battle.currentTurn.currentTeam;
    const teamPlayers = this.getTeamPlayers(battle, currentTeam);

    // 미행동 플레이어들을 자동 패스 처리
    teamPlayers.forEach((player) => {
      const hasAction = battle.turnActions.some((action) => action.playerId === player.id);
      if (!hasAction) {
        battle.turnActions.push({
          playerId: player.id,
          playerName: player.name,
          type: 'pass',
          timestamp: Date.now(),
        });

        battle.logs.push({
          ts: Date.now(),
          type: 'system',
          message: `${player.name} 시간 초과로 자동 패스`,
        });
      }
    });

    // 팀 행동 완료 처리
    this.completeTeamAction(battle);
  }

  // 플레이어 행동 처리
  playerAction(battleId, playerId, action) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== 'active') {
      throw new Error('유효하지 않은 전투 상태');
    }

    const player = battle.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('플레이어를 찾을 수 없음');
    }

    if (player.hp <= 0) {
      throw new Error('사망한 플레이어는 행동할 수 없음');
    }

    if (player.team !== battle.currentTurn.currentTeam) {
      throw new Error('현재 팀의 차례가 아님');
    }

    // 이미 행동했는지 확인
    const hasActed = battle.turnActions.some((a) => a.playerId === playerId);
    if (hasActed) {
      throw new Error('이미 행동을 완료함');
    }

    // 행동 처리 및 로그
    const actionResult = this.processAction(battle, player, action);

    battle.turnActions.push({
      playerId: player.id,
      playerName: player.name,
      type: action.type || 'pass',
      target: action.targetId,
      targetName: action.targetId ? this.getPlayerName(battle, action.targetId) : null,
      item: action.item,
      result: actionResult,
      timestamp: Date.now(),
    });

    // 행동 로그 추가
    this.addActionLog(battle, player, action, actionResult);

    // 팀 전원 행동 완료 확인
    const currentTeam = battle.currentTurn.currentTeam;
    const teamPlayers = this.getTeamPlayers(battle, currentTeam);
    const actedPlayers = battle.turnActions.filter((a) =>
      teamPlayers.some((p) => p.id === a.playerId),
    );

    if (actedPlayers.length >= teamPlayers.length) {
      // 팀 행동 완료
      this.completeTeamAction(battle);
    }

    return { b: battle, result: actionResult };
  }

  // 행동 처리
  processAction(battle, player, action) {
    switch (action.type) {
      case 'attack':
        return this.processAttack(battle, player, action);
      case 'defend':
        return this.processDefend(battle, player, action);
      case 'dodge':
        return this.processDodge(battle, player, action);
      case 'item':
        return this.processItem(battle, player, action);
      case 'pass':
      default:
        return { success: true, type: 'pass' };
    }
  }

  // 공격 처리
  processAttack(battle, attacker, action) {
    const target = battle.players.find((p) => p.id === action.targetId);
    if (!target || target.hp <= 0) {
      throw new Error('유효하지 않은 대상');
    }

    // 공격 보정기 사용 체크
    let attackPower = attacker.stats.attack;
    let boosterUsed = false;

    if (action.useAttackBooster && attacker.items.attackBooster > 0) {
      const success = this.rollDice(100) <= 10; // 10% 성공률
      attacker.items.attackBooster -= 1;
      boosterUsed = true;

      if (success) {
        attackPower *= 2;
      }
    }

    const attackRoll = this.rollDice(20);
    const totalAttack = attackPower + attackRoll;

    // 명중률 계산(정보용)
    const hitRoll = attacker.stats.luck + this.rollDice(20);

    // 치명타 계산
    const criticalRoll = this.rollDice(20);
    const isCritical = criticalRoll >= (20 - Math.floor(attacker.stats.luck / 2));

    return {
      type: 'attack',
      attackPower,
      attackRoll,
      totalAttack,
      hitRoll,
      isCritical,
      boosterUsed,
      boosterSuccess: boosterUsed && attackPower > attacker.stats.attack,
    };
  }

  // 방어 처리
  processDefend(battle, defender, action) {
    let defensePower = defender.stats.defense;
    let boosterUsed = false;

    if (action.useDefenseBooster && defender.items.defenseBooster > 0) {
      const success = this.rollDice(100) <= 10; // 10% 성공률
      defender.items.defenseBooster -= 1;
      boosterUsed = true;

      if (success) {
        defensePower *= 2;
      }
    }

    // 방어 효과는 다음 피격 시 적용
    defender.effects.push({
      type: 'defense_boost',
      value: defensePower + this.rollDice(20),
      duration: 1,
    });

    return {
      type: 'defend',
      defensePower,
      boosterUsed,
      boosterSuccess: boosterUsed && defensePower > defender.stats.defense,
    };
  }

  // 회피 처리
  processDodge(battle, player, action) {
    // 회피 효과는 다음 피격 시 적용
    const dodgeValue = player.stats.agility + this.rollDice(20);

    player.effects.push({
      type: 'dodge_ready',
      value: dodgeValue,
      duration: 1,
    });

    return {
      type: 'dodge',
      dodgeValue,
    };
  }

  // 아이템 사용 처리
  processItem(battle, player, action) {
    if (action.item === 'dittany' || action.item === 'ditany') {
      if ((player.items.dittany || player.items.ditany || 0) <= 0) {
        throw new Error('디터니가 없습니다');
      }

      if (player.items.dittany) player.items.dittany -= 1;
      if (player.items.ditany) player.items.ditany -= 1;

      const healAmount = 10;
      player.hp = Math.min(player.maxHp, player.hp + healAmount);

      return {
        type: 'item',
        item: 'dittany',
        healAmount,
      };
    }

    throw new Error('알 수 없는 아이템');
  }

  // 행동 로그 추가
  addActionLog(battle, player, action, result) {
    let message = '';

    switch (action.type) {
      case 'attack': {
        const target = battle.players.find((p) => p.id === action.targetId);
        if (result.boosterUsed) {
          message = `${player.name}이(가) 공격 보정기를 사용하여 ${target?.name || '대상'}에게 공격 (${result.boosterSuccess ? '성공' : '실패'})`;
        } else {
          message = `${player.name}이(가) ${target?.name || '대상'}에게 공격`;
        }
        break;
      }
      case 'defend':
        if (result.boosterUsed) {
          message = `${player.name}이(가) 방어 보정기를 사용하여 방어 자세 (${result.boosterSuccess ? '성공' : '실패'})`;
        } else {
          message = `${player.name}이(가) 방어 자세`;
        }
        break;
      case 'dodge':
        message = `${player.name}이(가) 회피 자세`;
        break;
      case 'item':
        if (action.item === 'dittany' || action.item === 'ditany') {
          message = `${player.name}이(가) 디터니 사용 (+${result.healAmount} HP)`;
        } else {
          message = `${player.name}이(가) 아이템 사용`;
        }
        break;
      case 'pass':
        message = `${player.name}이(가) 행동 패스`;
        break;
      default:
        message = `${player.name}이(가) 알 수 없는 행동`;
    }

    battle.logs.push({
      ts: Date.now(),
      type: 'info',
      message,
    });
  }

  // 팀 행동 완료
  completeTeamAction(battle) {
    const currentTeam = battle.currentTurn.currentTeam;
    const otherTeam = currentTeam === 'A' ? 'B' : 'A';

    // 타이머 정리
    const timerId = `turn_${battle.id}`;
    if (this.timers.has(timerId)) {
      clearInterval(this.timers.get(timerId));
      this.timers.delete(timerId);
    }

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message: `${currentTeam}팀 행동 완료`,
    });

    // 상대팀 생존자 확인
    const otherTeamPlayers = this.getTeamPlayers(battle, otherTeam);
    if (otherTeamPlayers.length === 0) {
      // 상대팀 전멸 → 라운드 즉시 처리
      this.processRound(battle);
      return;
    }

    // 라운드의 두 번째 팀인지 확인(다른 팀이 이미 행동했는가)
    const isSecondTeam = this.hasTeamActed(battle, otherTeam);

    if (isSecondTeam) {
      // 양팀 모두 행동 완료 → 라운드 처리
      this.processRound(battle);
    } else {
      // 상대팀 턴으로 전환 (5초 딜레이)
      this.switchToOtherTeam(battle, otherTeam);
    }
  }

  // 다른 팀이 이미 행동했는지 확인
  hasTeamActed(battle, team) {
    const teamPlayers = this.getTeamPlayers(battle, team);
    return battle.turnActions.some((action) => teamPlayers.some((p) => p.id === action.playerId));
  }

  // 상대팀으로 전환 (5초 딜레이)
  switchToOtherTeam(battle, nextTeam) {
    battle.currentTurn.phase = 'switching';
    battle.currentTurn.timeLeftSec = 5; // 5초 대기

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message: `5초 후 ${nextTeam}팀 행동 페이즈 시작`,
    });

    setTimeout(() => {
      if (battle.status !== 'active') return;

      battle.currentTurn.currentTeam = nextTeam;
      battle.currentTurn.phase = 'team_action';
      battle.currentTurn.timeLeftSec = 300; // 5분

      // 다음 팀의 첫 번째 플레이어 설정 (민첩 내림차순, 이름 오름차순)
      const teamPlayers = this.getTeamPlayers(battle, nextTeam);
      if (teamPlayers.length > 0) {
        teamPlayers.sort((a, b) => {
          if (a.stats.agility !== b.stats.agility) {
            return b.stats.agility - a.stats.agility;
          }
          return a.name.localeCompare(b.name);
        });

        // ❗ 누락 보수: name/team 포함
        battle.currentTurn.currentPlayer = {
          id: teamPlayers[0].id,
          name: teamPlayers[0].name,
          team: teamPlayers[0].team,
          avatar: teamPlayers[0].avatar,
        };
      } else {
        battle.currentTurn.currentPlayer = null;
      }

      battle.logs.push({
        ts: Date.now(),
        type: 'battle',
        message: `${nextTeam}팀 행동 페이즈 시작`,
      });

      this.startTurnTimer(battle);
    }, 5000);
  }

  // 라운드 처리
  processRound(battle) {
    battle.currentTurn.phase = 'processing';

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message: '라운드 결과 처리 중...',
    });

    // 공격 결과 먼저 처리
    const attacks = battle.turnActions.filter((action) => action.type === 'attack');

    attacks.forEach((attackAction) => {
      const attacker = battle.players.find((p) => p.id === attackAction.playerId);
      const target = battle.players.find((p) => p.id === attackAction.target);
      if (!attacker || !target || target.hp <= 0) return;

      this.resolveAttack(battle, attacker, target, attackAction.result);
    });

    // 치유 효과 처리(이미 processItem에서 HP 적용됨)

    // 효과 지속시간 감소
    battle.players.forEach((player) => {
      player.effects = player.effects.filter((effect) => {
        effect.duration -= 1;
        return effect.duration > 0;
      });
    });

    // 승리 조건 확인
    const teamA = battle.players.filter((p) => p.team === 'A' && p.hp > 0);
    const teamB = battle.players.filter((p) => p.team === 'B' && p.hp > 0);

    if (teamA.length === 0 || teamB.length === 0) {
      this.endBattle(battle, teamA.length > 0 ? 'A' : 'B');
      return;
    }

    // 턴 제한 확인
    if (battle.currentTurn.turnNumber >= battle.options.maxTurns) {
      const totalHpA = teamA.reduce((sum, p) => sum + p.hp, 0);
      const totalHpB = teamB.reduce((sum, p) => sum + p.hp, 0);
      const winner = totalHpA > totalHpB ? 'A' : (totalHpB > totalHpA ? 'B' : 'Draw');
      this.endBattle(battle, winner);
      return;
    }

    // 다음 턴 시작 (5초 딜레이)
    setTimeout(() => {
      if (battle.status === 'active') {
        this.startTurn(battle);
      }
    }, 5000);
  }

  // 공격 해결
  resolveAttack(battle, attacker, target, attackResult) {
    let damage = 0;
    let dodged = false;
    let blocked = false;
    const critical = attackResult.isCritical;

    // 회피 체크
    const dodgeEffect = target.effects.find((e) => e.type === 'dodge_ready');
    if (dodgeEffect) {
      if (dodgeEffect.value >= attackResult.totalAttack) {
        dodged = true;
        target.effects = target.effects.filter((e) => e !== dodgeEffect);
      }
    }

    if (!dodged) {
      // 방어 체크
      const defenseEffect = target.effects.find((e) => e.type === 'defense_boost');
      let defense = target.stats.defense;

      if (defenseEffect) {
        defense = Math.max(defense, defenseEffect.value);
        target.effects = target.effects.filter((e) => e !== defenseEffect);
        blocked = true;
      }

      // 데미지 계산
      damage = Math.max(0, attackResult.totalAttack - defense);
      if (critical) damage *= 2;

      target.hp = Math.max(0, target.hp - damage);
    }

    // 결과 로그
    let message;
    if (dodged) {
      message = `${target.name}이(가) ${attacker.name}의 공격을 회피했습니다`;
    } else if (damage === 0) {
      message = `${attacker.name}의 공격이 ${target.name}에게 막혔습니다 (0 데미지)`;
    } else {
      const critText = critical ? ' (치명타!)' : '';
      const blockText = blocked ? ' (방어 효과 적용)' : '';
      message = `${attacker.name}이(가) ${target.name}에게 ${damage} 데미지${critText}${blockText}`;
      if (target.hp <= 0) {
        message += ` - ${target.name} 사망`;
      }
    }

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message,
    });
  }

  // 전투 종료
  endBattle(battle, winner) {
    battle.status = 'ended';
    battle.endedAt = Date.now();

    // 모든 타이머 정리
    const timerId = `turn_${battle.id}`;
    if (this.timers.has(timerId)) {
      clearInterval(this.timers.get(timerId));
      this.timers.delete(timerId);
    }

    const message =
      winner === 'Draw' ? '전투가 무승부로 종료되었습니다' : `전투 종료 - ${winner}팀 승리!`;

    battle.logs.push({
      ts: Date.now(),
      type: 'battle',
      message,
    });
  }

  // 주사위 굴리기
  rollDice(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  // 플레이어 이름 가져오기
  getPlayerName(battle, playerId) {
    const player = battle.players.find((p) => p.id === playerId);
    return player ? player.name : '알 수 없음';
  }

  // 전투 가져오기
  get(battleId) {
    return this.battles.get(battleId);
  }

  // 전투 스냅샷
  snapshot(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return null;

    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      createdAt: battle.createdAt,
      players: battle.players.map((p) => ({ ...p })),
      currentTurn: { ...battle.currentTurn },
      logs: [...battle.logs],
    };
  }
}

module.exports = BattleEngine;
