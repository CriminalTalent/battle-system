const { v4: uuidv4 } = require('uuid');

class BattleEngine {
  constructor() {
    this.battles = new Map();
    this.turnTimers = new Map();
  }

  /**
   * 새로운 전투 생성
   */
  createBattle(config = {}) {
    const battleId = `battle_${uuidv4()}`;
    
    const battle = {
      id: battleId,
      mode: config.mode || '1v1',
      status: 'waiting',
      teams: {
        team1: {
          name: '불사조 기사단',
          players: []
        },
        team2: {
          name: '죽음을 먹는자들',
          players: []
        }
      },
      config: {
        playersPerTeam: this.getPlayersPerTeam(config.mode),
        turnTimeLimit: config.turnTimeLimit || 300000, // 5분
        maxTurns: config.maxTurns || 50,
        itemsEnabled: config.itemsEnabled !== false,
        autoStart: config.autoStart !== false
      },
      currentTeam: 'team1',
      currentPlayerIndex: 0,
      turnOrder: [],
      turnNumber: 0,
      roundNumber: 1,
      battleLog: [],
      chatLog: [],
      createdAt: Date.now(),
      turnStartTime: null,
      winner: null,
      endReason: null
    };

    this.battles.set(battleId, battle);
    this.addBattleLog(battleId, 'system', `${battle.mode} 전투가 생성되었습니다`);
    
    return battle;
  }

  /**
   * 모드별 팀당 플레이어 수 반환
   */
  getPlayersPerTeam(mode) {
    const modes = {
      '1v1': 1,
      '2v2': 2,
      '3v3': 3,
      '4v4': 4
    };
    return modes[mode] || 1;
  }

  /**
   * 전투에 플레이어 참가
   */
  joinBattle(battleId, playerData, team = null) {
    const battle = this.battles.get(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }

    if (battle.status !== 'waiting') {
      throw new Error('이미 시작된 전투입니다');
    }

    // 자동 팀 배정
    if (!team) {
      const team1Count = battle.teams.team1.players.length;
      const team2Count = battle.teams.team2.players.length;
      team = team1Count <= team2Count ? 'team1' : 'team2';
    }

    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam) {
      throw new Error('해당 팀이 가득 찼습니다');
    }

    // 플레이어 데이터 생성
    const player = {
      id: playerData.id || uuidv4(),
      name: playerData.name || `플레이어${Date.now()}`,
      team: team,
      hp: playerData.maxHp || 100,
      maxHp: playerData.maxHp || 100,
      stats: {
        attack: playerData.attack || 50,
        defense: playerData.defense || 30,
        agility: playerData.agility || 50,
        luck: playerData.luck || 30
      },
      inventory: playerData.inventory || [],
      buffs: {},
      alive: true,
      connected: true,
      isReady: false,
      hasActed: false,
      isDefending: false,
      isDodging: false,
      imageUrl: playerData.imageUrl || null
    };

    targetTeam.players.push(player);
    this.addBattleLog(battleId, 'system', `${player.name}님이 ${targetTeam.name}에 참가했습니다`);

    // 모든 팀이 가득 찼는지 확인
    if (this.isAllTeamsFull(battle) && battle.config.autoStart) {
      this.startBattle(battleId);
    }

    return battle;
  }

  /**
   * 모든 팀이 가득 찼는지 확인
   */
  isAllTeamsFull(battle) {
    const team1Full = battle.teams.team1.players.length === battle.config.playersPerTeam;
    const team2Full = battle.teams.team2.players.length === battle.config.playersPerTeam;
    return team1Full && team2Full;
  }

  /**
   * 전투 시작
   */
  startBattle(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }

    if (battle.status !== 'waiting') {
      throw new Error('이미 시작된 전투입니다');
    }

    // 턴 순서 결정 (민첩성 기반)
    this.determineInitiative(battle);

    battle.status = 'ongoing';
    battle.turnStartTime = Date.now();
    
    this.addBattleLog(battleId, 'system', '전투가 시작되었습니다!');
    this.addBattleLog(battleId, 'system', `턴 순서가 결정되었습니다`);

    // 첫 턴 시작
    this.startNextTurn(battleId);

    return battle;
  }

  /**
   * 민첩성 기반 이니셔티브 결정
   */
  determineInitiative(battle) {
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players
    ];

    // 각 플레이어의 이니셔티브 굴림
    const initiatives = allPlayers.map(player => {
      let roll, total;
      do {
        roll = this.rollDice(20);
        total = player.stats.agility + roll;
      } while (initiatives.some(i => i && i.total === total)); // 동점 방지

      return {
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        agility: player.stats.agility,
        roll: roll,
        total: total
      };
    });

    // 총합 기준 내림차순 정렬
    initiatives.sort((a, b) => b.total - a.total);

    // 턴 순서 로그
    initiatives.forEach((init, index) => {
      this.addBattleLog(
        battle.id, 
        'system',
        `${index + 1}번째: ${init.playerName} (민첩 ${init.agility} + 주사위 ${init.roll} = ${init.total})`
      );
    });

    // 라운드별 팀 교대 방식
    battle.turnOrder = initiatives;
    battle.initiativeRolls = initiatives;
  }

  /**
   * 다음 턴 시작
   */
  startNextTurn(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== 'ongoing') return;

    // 승리 조건 체크
    if (this.checkVictoryCondition(battle)) {
      this.endBattle(battleId);
      return;
    }

    // 다음 플레이어 찾기
    const currentTeam = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeam.players.filter(p => p.alive);

    if (alivePlayers.length === 0) {
      // 현재 팀에 생존자가 없으면 다른 팀으로
      battle.currentTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
      battle.currentPlayerIndex = 0;
      this.startNextTurn(battleId);
      return;
    }

    // 현재 플레이어가 이미 행동했거나 죽었으면 다음 플레이어로
    if (battle.currentPlayerIndex >= alivePlayers.length) {
      // 팀 전환
      battle.currentTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
      battle.currentPlayerIndex = 0;
      battle.turnNumber++;

      // 라운드 증가 체크
      if (battle.turnNumber % 2 === 0) {
        battle.roundNumber++;
        this.addBattleLog(battleId, 'system', `===== 라운드 ${battle.roundNumber} 시작 =====`);
        this.resetTurnFlags(battle);
      }

      this.startNextTurn(battleId);
      return;
    }

    const currentPlayer = alivePlayers[battle.currentPlayerIndex];
    battle.turnStartTime = Date.now();

    this.addBattleLog(
      battleId, 
      'system',
      `${currentPlayer.name}의 턴입니다 (${currentTeam.name})`
    );

    // 턴 타이머 설정
    this.setTurnTimer(battleId);

    return battle;
  }

  /**
   * 턴 플래그 초기화
   */
  resetTurnFlags(battle) {
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players
    ];

    allPlayers.forEach(player => {
      player.hasActed = false;
      player.isDefending = false;
      player.isDodging = false;
    });
  }

  /**
   * 턴 타이머 설정
   */
  setTurnTimer(battleId) {
    // 기존 타이머 제거
    if (this.turnTimers.has(battleId)) {
      clearTimeout(this.turnTimers.get(battleId));
    }

    const timer = setTimeout(() => {
      const battle = this.battles.get(battleId);
      if (battle && battle.status === 'ongoing') {
        this.addBattleLog(battleId, 'system', '시간 초과! 턴을 넘깁니다.');
        this.endCurrentTurn(battleId);
      }
    }, 300000); // 5분

    this.turnTimers.set(battleId, timer);
  }

  /**
   * 현재 턴 종료
   */
  endCurrentTurn(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    // 현재 플레이어의 버프 제거 (1턴 지속)
    const currentTeam = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeam.players.filter(p => p.alive);
    const currentPlayer = alivePlayers[battle.currentPlayerIndex];
    
    if (currentPlayer) {
      // 1턴 버프 제거
      if (currentPlayer.buffs.attack_buff) {
        currentPlayer.buffs.attack_buff = false;
        this.addBattleLog(battleId, 'system', `${currentPlayer.name}의 공격력 강화가 종료되었습니다`);
      }
      if (currentPlayer.buffs.defense_buff) {
        currentPlayer.buffs.defense_buff = false;
        this.addBattleLog(battleId, 'system', `${currentPlayer.name}의 방어력 강화가 종료되었습니다`);
      }
    }

    // 타이머 정리
    if (this.turnTimers.has(battleId)) {
      clearTimeout(this.turnTimers.get(battleId));
      this.turnTimers.delete(battleId);
    }

    // 다음 플레이어로
    battle.currentPlayerIndex++;
    this.startNextTurn(battleId);
  }

  /**
   * 액션 실행
   */
  executeAction(battleId, playerId, action) {
    const battle = this.battles.get(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }

    if (battle.status !== 'ongoing') {
      throw new Error('진행 중인 전투가 아닙니다');
    }

    const player = this.findPlayer(battle, playerId);
    if (!player) {
      throw new Error('플레이어를 찾을 수 없습니다');
    }

    if (!player.alive) {
      throw new Error('죽은 플레이어는 행동할 수 없습니다');
    }

    // 현재 턴인지 확인
    const currentTeam = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeam.players.filter(p => p.alive);
    const currentPlayer = alivePlayers[battle.currentPlayerIndex];

    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error('당신의 턴이 아닙니다');
    }

    let result = {};

    switch (action.type) {
      case 'attack':
        result = this.executeAttack(battle, player, action.targetId);
        break;
      case 'defend':
        result = this.executeDefend(battle, player);
        break;
      case 'dodge':
        result = this.executeDodge(battle, player);
        break;
      case 'item':
        result = this.executeItem(battle, player, action.itemType, action.targetId);
        break;
      case 'pass':
        result = this.executePass(battle, player);
        break;
      default:
        throw new Error('알 수 없는 액션입니다');
    }

    player.hasActed = true;
    this.endCurrentTurn(battleId);

    return result;
  }

  /**
   * 공격 실행
   */
  executeAttack(battle, attacker, targetId) {
    const target = this.findPlayer(battle, targetId);
    if (!target) {
      throw new Error('대상을 찾을 수 없습니다');
    }

    if (!target.alive) {
      throw new Error('이미 죽은 대상입니다');
    }

    if (attacker.team === target.team) {
      throw new Error('같은 팀은 공격할 수 없습니다');
    }

    // 공격 굴림
    const attackRoll = this.rollDice(20);
    let attackPower = attacker.stats.attack + attackRoll;

    // 공격 버프 적용
    if (attacker.buffs.attack_buff) {
      attackPower = Math.floor(attackPower * 1.5);
      this.addBattleLog(battle.id, 'action', `${attacker.name}의 공격력이 강화되었습니다!`);
    }

    // 명중률 계산
    const hitRoll = attacker.stats.luck + this.rollDice(20);
    const dodgeRoll = target.stats.agility + this.rollDice(20);

    // 회피 상태 체크
    if (target.isDodging && dodgeRoll >= attackPower) {
      this.addBattleLog(
        battle.id,
        'action',
        `${attacker.name}의 공격을 ${target.name}이(가) 완벽하게 회피했습니다!`
      );
      return { hit: false, damage: 0 };
    }

    // 명중 실패
    if (hitRoll < dodgeRoll) {
      this.addBattleLog(
        battle.id,
        'action',
        `${attacker.name}의 공격이 빗나갔습니다!`
      );
      return { hit: false, damage: 0 };
    }

    // 방어 상태 체크
    let finalDamage = 0;
    if (target.isDefending) {
      const defenseRoll = target.stats.agility + this.rollDice(20);
      let defenseValue = target.stats.defense;
      
      if (target.buffs.defense_buff) {
        defenseValue = Math.floor(defenseValue * 1.5);
      }

      const damageReduction = Math.max(0, defenseValue - attacker.stats.attack);
      finalDamage = Math.max(1, attackPower - defenseValue - damageReduction);
      
      this.addBattleLog(
        battle.id,
        'action',
        `${target.name}이(가) 방어 자세로 데미지를 ${damageReduction} 감소시켰습니다`
      );
    } else {
      finalDamage = Math.max(1, attackPower - target.stats.defense);
    }

    // 치명타 체크
    const critRoll = this.rollDice(20);
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCritical = critRoll >= critThreshold;

    if (isCritical) {
      finalDamage *= 2;
      this.addBattleLog(
        battle.id,
        'action',
        `치명타! ${attacker.name}의 공격이 급소를 명중시켰습니다!`
      );
    }

    // 데미지 적용
    target.hp = Math.max(0, target.hp - finalDamage);
    
    this.addBattleLog(
      battle.id,
      'action',
      `${attacker.name}이(가) ${target.name}에게 ${finalDamage}의 데미지를 입혔습니다 (남은 HP: ${target.hp}/${target.maxHp})`
    );

    if (target.hp <= 0) {
      target.alive = false;
      this.addBattleLog(
        battle.id,
        'system',
        `${target.name}이(가) 전투불능 상태가 되었습니다!`
      );
    }

    return {
      hit: true,
      damage: finalDamage,
      isCritical: isCritical,
      targetHp: target.hp,
      targetAlive: target.alive
    };
  }

  /**
   * 방어 실행
   */
  executeDefend(battle, player) {
    player.isDefending = true;
    player.isDodging = false;
    
    this.addBattleLog(
      battle.id,
      'action',
      `${player.name}이(가) 방어 자세를 취했습니다`
    );

    return {
      action: 'defend',
      success: true
    };
  }

  /**
   * 회피 실행
   */
  executeDodge(battle, player) {
    player.isDodging = true;
    player.isDefending = false;
    
    this.addBattleLog(
      battle.id,
      'action',
      `${player.name}이(가) 회피 준비를 했습니다`
    );

    return {
      action: 'dodge',
      success: true
    };
  }

  /**
   * 아이템 사용
   */
  executeItem(battle, player, itemType, targetId) {
    // 인벤토리에서 아이템 확인
    const itemIndex = player.inventory.findIndex(item => item === itemType);
    if (itemIndex === -1) {
      throw new Error('해당 아이템을 보유하고 있지 않습니다');
    }

    // 아이템 제거
    player.inventory.splice(itemIndex, 1);

    let result = {};

    switch (itemType) {
      case '공격 보정기':
        player.buffs.attack_buff = true;
        this.addBattleLog(
          battle.id,
          'action',
          `${player.name}이(가) 공격 보정기를 사용했습니다 (공격력 1.5배)`
        );
        result = { success: true, effect: 'attack_buff' };
        break;

      case '방어 보정기':
        player.buffs.defense_buff = true;
        this.addBattleLog(
          battle.id,
          'action',
          `${player.name}이(가) 방어 보정기를 사용했습니다 (방어력 1.5배)`
        );
        result = { success: true, effect: 'defense_buff' };
        break;

      case '디터니':
        const healTarget = targetId ? this.findPlayer(battle, targetId) : player;
        if (!healTarget || !healTarget.alive) {
          throw new Error('유효하지 않은 대상입니다');
        }
        
        const healAmount = 10;
        const previousHp = healTarget.hp;
        healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healAmount);
        const actualHeal = healTarget.hp - previousHp;
        
        this.addBattleLog(
          battle.id,
          'action',
          `${player.name}이(가) ${healTarget.name}에게 디터니를 사용했습니다 (HP +${actualHeal})`
        );
        result = { success: true, effect: 'heal', healAmount: actualHeal };
        break;

      default:
        throw new Error('알 수 없는 아이템입니다');
    }

    return result;
  }

  /**
   * 패스 실행
   */
  executePass(battle, player) {
    this.addBattleLog(
      battle.id,
      'action',
      `${player.name}이(가) 턴을 넘겼습니다`
    );

    return {
      action: 'pass',
      success: true
    };
  }

  /**
   * 승리 조건 체크
   */
  checkVictoryCondition(battle) {
    const team1Alive = battle.teams.team1.players.filter(p => p.alive).length;
    const team2Alive = battle.teams.team2.players.filter(p => p.alive).length;

    if (team1Alive === 0) {
      battle.winner = 'team2';
      return true;
    }

    if (team2Alive === 0) {
      battle.winner = 'team1';
      return true;
    }

    // 최대 턴 수 체크
    if (battle.turnNumber >= battle.config.maxTurns) {
      // HP 총합으로 승자 결정
      const team1Hp = battle.teams.team1.players.reduce((sum, p) => sum + p.hp, 0);
      const team2Hp = battle.teams.team2.players.reduce((sum, p) => sum + p.hp, 0);
      
      if (team1Hp > team2Hp) {
        battle.winner = 'team1';
      } else if (team2Hp > team1Hp) {
        battle.winner = 'team2';
      } else {
        battle.winner = null; // 무승부
      }
      
      battle.endReason = '최대 턴 수 도달';
      return true;
    }

    return false;
  }

  /**
   * 전투 종료
   */
  endBattle(battleId, forcedWinner = null) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    battle.status = 'ended';
    
    if (forcedWinner) {
      battle.winner = forcedWinner;
      battle.endReason = '관리자 종료';
    }

    // 타이머 정리
    if (this.turnTimers.has(battleId)) {
      clearTimeout(this.turnTimers.get(battleId));
      this.turnTimers.delete(battleId);
    }

    if (battle.winner) {
      const winnerTeam = battle.teams[battle.winner];
      this.addBattleLog(
        battleId,
        'system',
        `===== 전투 종료! ${winnerTeam.name} 승리! =====`
      );
    } else {
      this.addBattleLog(
        battleId,
        'system',
        `===== 전투 종료! 무승부! =====`
      );
    }

    return battle;
  }

  /**
   * 플레이어 찾기
   */
  findPlayer(battle, playerId) {
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players
    ];
    return allPlayers.find(p => p.id === playerId);
  }

  /**
   * 전투 로그 추가
   */
  addBattleLog(battleId, type, message) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    const logEntry = {
      type: type,
      message: message,
      timestamp: Date.now()
    };

    battle.battleLog.push(logEntry);
    
    // 로그 크기 제한 (최대 100개)
    if (battle.battleLog.length > 100) {
      battle.battleLog.shift();
    }
  }

  /**
   * 채팅 메시지 추가
   */
  addChatMessage(battleId, sender, message, senderType = 'player') {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    const chatEntry = {
      sender: sender,
      message: message,
      senderType: senderType,
      timestamp: Date.now()
    };

    battle.chatLog.push(chatEntry);
    
    // 채팅 크기 제한 (최대 50개)
    if (battle.chatLog.length > 50) {
      battle.chatLog.shift();
    }
  }

  /**
   * 주사위 굴림
   */
  rollDice(sides = 20) {
    return Math.floor(Math.random() * sides) + 1;
  }

  /**
   * 전투 가져오기
   */
  getBattle(battleId) {
    return this.battles.get(battleId);
  }

  /**
   * 플레이어 연결 상태 업데이트
   */
  updatePlayerConnection(battleId, playerId, connected) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    const player = this.findPlayer(battle, playerId);
    if (player) {
      player.connected = connected;
      this.addBattleLog(
        battleId,
        'system',
        `${player.name}의 연결이 ${connected ? '복구' : '끊어'}졌습니다`
      );
    }
  }

  /**
   * 플레이어 준비 상태 토글
   */
  togglePlayerReady(battleId, playerId) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== 'waiting') return false;

    const player = this.findPlayer(battle, playerId);
    if (!player) return false;

    player.isReady = !player.isReady;
    
    this.addBattleLog(
      battleId,
      'system',
      `${player.name}이(가) ${player.isReady ? '준비 완료' : '준비 취소'}했습니다`
    );

    // 모든 플레이어가 준비되었는지 확인
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players
    ];
    
    const allReady = allPlayers.length > 0 && allPlayers.every(p => p.isReady);
    
    if (allReady && this.isAllTeamsFull(battle)) {
      this.startBattle(battleId);
    }

    return player.isReady;
  }
}

module.exports = BattleEngine;
