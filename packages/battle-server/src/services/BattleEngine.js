// packages/battle-api/src/services/BattleEngine.js
class BattleEngine {
  constructor() {
    this.battles = new Map();
    this.turnTimers = new Map();
  }

  /**
   * 전투 생성
   */
  createBattle(mode = '1v1', adminId = null) {
    const battleId = require('crypto').randomBytes(16).toString('hex');
    const config = this.getBattleConfig(mode);
    
    const battle = {
      id: battleId,
      mode: mode,
      status: 'waiting', // waiting, ongoing, ended
      createdAt: Date.now(),
      adminId: adminId,
      
      // 팀 구조
      teams: {
        team1: { name: '불사조 기사단', players: [] },
        team2: { name: '죽음을 먹는자들', players: [] }
      },
      
      // 전투 상태
      currentTeam: null, // 'team1' 또는 'team2'
      roundNumber: 1,
      turnNumber: 1,
      turnStartTime: null,
      
      // 로그
      battleLog: [],
      chatLog: [],
      
      // 설정
      config: config,
      
      // OTP 시스템 (30분 만료)
      otps: {
        admin: this.generateOTP(),
        player: this.generateOTP(),
        spectator: this.generateOTP()
      },
      otpExpiry: {
        admin: Date.now() + (60 * 60 * 1000), // 1시간
        player: Date.now() + (60 * 60 * 1000), // 1시간  
        spectator: Date.now() + (30 * 60 * 1000) // 30분
      }
    };
    
    this.battles.set(battleId, battle);
    console.log(`[전투생성] ID: ${battleId}, 모드: ${mode}`);
    
    return battle;
  }

  /**
   * 전투 설정 가져오기
   */
  getBattleConfig(mode) {
    const configs = {
      '1v1': { playersPerTeam: 1 },
      '2v2': { playersPerTeam: 2 },
      '3v3': { playersPerTeam: 3 },
      '4v4': { playersPerTeam: 4 }
    };
    return configs[mode] || configs['1v1'];
  }

  /**
   * OTP 생성
   */
  generateOTP() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * 플레이어 추가
   */
  addPlayer(battleId, playerData) {
    const battle = this.battles.get(battleId);
    if (!battle) {
      throw new Error('존재하지 않는 전투입니다');
    }
    
    if (battle.status !== 'waiting') {
      throw new Error('이미 시작된 전투입니다');
    }

    const { name, team, stats, inventory = [], imageUrl = '' } = playerData;
    
    if (!['team1', 'team2'].includes(team)) {
      throw new Error('잘못된 팀입니다');
    }

    const targetTeam = battle.teams[team];
    if (targetTeam.players.length >= battle.config.playersPerTeam) {
      throw new Error('해당 팀이 가득 찼습니다');
    }

    // 중복 이름 체크
    const allPlayers = [
      ...battle.teams.team1.players,
      ...battle.teams.team2.players
    ];
    if (allPlayers.some(p => p.name === name)) {
      throw new Error('이미 존재하는 플레이어 이름입니다');
    }

    const player = {
      id: require('crypto').randomBytes(8).toString('hex'),
      name: name,
      team: team,
      stats: this.normalizeStats(stats),
      inventory: [...inventory],
      buffs: {},
      
      // 전투 상태
      hp: 100,
      maxHp: 100,
      alive: true,
      hasActed: false,
      isDefending: false,
      isDodging: false,
      
      // 추가 정보
      imageUrl: imageUrl,
      connected: false,
      socketId: null
    };

    targetTeam.players.push(player);
    this.addBattleLog(battleId, 'system', `${player.name}이(가) ${targetTeam.name}에 참가했습니다`);
    
    return player;
  }

  /**
   * 스탯 정규화 (최소 1, 최대 5)
   */
  normalizeStats(stats = {}) {
    return {
      attack: Math.max(1, Math.min(5, stats.attack || 2)),
      defense: Math.max(1, Math.min(5, stats.defense || 2)),
      agility: Math.max(1, Math.min(5, stats.agility || 2)),
      luck: Math.max(1, Math.min(5, stats.luck || 2))
    };
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

    // 팀별 민첩성 총합으로 선공 결정
    this.determineFirstTeam(battle);
    
    battle.status = 'ongoing';
    battle.turnStartTime = Date.now();
    
    this.addBattleLog(battleId, 'system', '전투가 시작되었습니다!');
    this.startTeamTurn(battleId);

    return battle;
  }

  /**
   * 팀별 민첩성으로 선공 결정
   */
  determineFirstTeam(battle) {
    const team1Total = battle.teams.team1.players.reduce((sum, p) => {
      const roll = this.rollDice(20);
      this.addBattleLog(battle.id, 'system', `${p.name}: 민첩 ${p.stats.agility} + 주사위 ${roll} = ${p.stats.agility + roll}`);
      return sum + p.stats.agility + roll;
    }, 0);

    const team2Total = battle.teams.team2.players.reduce((sum, p) => {
      const roll = this.rollDice(20);
      this.addBattleLog(battle.id, 'system', `${p.name}: 민첩 ${p.stats.agility} + 주사위 ${roll} = ${p.stats.agility + roll}`);
      return sum + p.stats.agility + roll;
    }, 0);

    this.addBattleLog(battle.id, 'system', `${battle.teams.team1.name} 총합: ${team1Total}`);
    this.addBattleLog(battle.id, 'system', `${battle.teams.team2.name} 총합: ${team2Total}`);

    if (team1Total > team2Total) {
      battle.currentTeam = 'team1';
      this.addBattleLog(battle.id, 'system', `${battle.teams.team1.name}이(가) 선공합니다!`);
    } else if (team2Total > team1Total) {
      battle.currentTeam = 'team2';
      this.addBattleLog(battle.id, 'system', `${battle.teams.team2.name}이(가) 선공합니다!`);
    } else {
      // 동점시 다시 굴림
      this.addBattleLog(battle.id, 'system', '동점! 다시 굴립니다...');
      this.determineFirstTeam(battle);
    }
  }

  /**
   * 팀 턴 시작
   */
  startTeamTurn(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.status !== 'ongoing') return;

    // 승리 조건 체크
    if (this.checkVictoryCondition(battle)) {
      this.endBattle(battleId);
      return;
    }

    const currentTeam = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeam.players.filter(p => p.alive);

    if (alivePlayers.length === 0) {
      // 현재 팀에 생존자가 없으면 상대팀 승리
      const winnerTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
      battle.winner = winnerTeam;
      this.endBattle(battleId);
      return;
    }

    // 팀 턴 시작
    this.addBattleLog(battleId, 'system', `===== ${currentTeam.name} 팀 턴 시작 =====`);
    
    // 모든 플레이어의 행동 플래그 초기화
    alivePlayers.forEach(player => {
      player.hasActed = false;
      player.isDefending = false;
      player.isDodging = false;
    });

    battle.turnStartTime = Date.now();
    this.setTurnTimer(battleId);
  }

  /**
   * 팀 턴 종료 체크
   */
  checkTeamTurnEnd(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    const currentTeam = battle.teams[battle.currentTeam];
    const alivePlayers = currentTeam.players.filter(p => p.alive);
    const allActed = alivePlayers.every(p => p.hasActed);

    if (allActed) {
      this.endTeamTurn(battleId);
    }
  }

  /**
   * 팀 턴 종료
   */
  endTeamTurn(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    const currentTeam = battle.teams[battle.currentTeam];
    this.addBattleLog(battleId, 'system', `===== ${currentTeam.name} 팀 턴 종료 =====`);

    // 버프 정리 (1턴 지속 효과들)
    currentTeam.players.forEach(player => {
      if (player.buffs.attack_buff) {
        player.buffs.attack_buff = false;
        this.addBattleLog(battleId, 'system', `${player.name}의 공격력 강화가 종료되었습니다`);
      }
      if (player.buffs.defense_buff) {
        player.buffs.defense_buff = false;
        this.addBattleLog(battleId, 'system', `${player.name}의 방어력 강화가 종료되었습니다`);
      }
    });

    // 타이머 정리
    if (this.turnTimers.has(battleId)) {
      clearTimeout(this.turnTimers.get(battleId));
      this.turnTimers.delete(battleId);
    }

    // 상대팀으로 전환
    battle.currentTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
    battle.turnNumber++;

    // 새 팀 턴 시작
    this.startTeamTurn(battleId);
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

    if (player.hasActed) {
      throw new Error('이미 행동했습니다');
    }

    // 현재 팀 턴인지 확인
    if (player.team !== battle.currentTeam) {
      throw new Error('현재 당신의 팀 턴이 아닙니다');
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
    
    // 팀 턴 종료 체크
    this.checkTeamTurnEnd(battleId);

    return result;
  }

  /**
   * 공격 실행 (단순화된 버전)
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

    // 공격력 계산: 공격력 + 주사위(1-20)
    const attackRoll = this.rollDice(20);
    let attackPower = attacker.stats.attack + attackRoll;

    // 공격 버프 적용
    if (attacker.buffs.attack_buff) {
      attackPower = Math.floor(attackPower * 1.5);
      this.addBattleLog(battle.id, 'action', `${attacker.name}의 공격력이 강화되었습니다!`);
    }

    this.addBattleLog(
      battle.id, 
      'action', 
      `${attacker.name}이(가) 공격합니다! (공격력 ${attacker.stats.attack} + 주사위 ${attackRoll} = ${attackPower})`
    );

    // 방어 중인 경우 방어값만큼 차감
    let finalDamage = attackPower;
    if (target.isDefending) {
      let defenseValue = target.stats.defense;
      
      // 방어 버프 적용
      if (target.buffs.defense_buff) {
        defenseValue = Math.floor(defenseValue * 1.5);
        this.addBattleLog(battle.id, 'action', `${target.name}의 방어력이 강화되었습니다!`);
      }

      finalDamage = Math.max(1, attackPower - defenseValue);
      
      this.addBattleLog(
        battle.id,
        'action',
        `${target.name}이(가) 방어 중입니다! (방어력 ${defenseValue}로 ${attackPower - finalDamage} 데미지 차감)`
      );
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
        `치명타! 데미지가 2배가 됩니다!`
      );
    }

    // 데미지 적용
    target.hp = Math.max(0, target.hp - finalDamage);
    
    this.addBattleLog(
      battle.id,
      'action',
      `${target.name}이(가) ${finalDamage} 데미지를 받았습니다! (남은 HP: ${target.hp}/${target.maxHp})`
    );

    // 사망 체크
    if (target.hp <= 0) {
      target.alive = false;
      this.addBattleLog(
        battle.id,
        'system',
        `${target.name}이(가) 전투불능 상태가 되었습니다!`
      );
    }

    // 역공격 기회 제공 (방어했을 때만)
    if (target.isDefending && target.alive) {
      this.offerCounterAttack(battle, target, attacker);
    }

    return {
      hit: true,
      damage: finalDamage,
      isCritical: isCritical,
      targetHp: target.hp,
      targetAlive: target.alive,
      counterAttackAvailable: target.isDefending && target.alive
    };
  }

  /**
   * 역공격 기회 제공
   */
  offerCounterAttack(battle, defender, originalAttacker) {
    this.addBattleLog(
      battle.id,
      'system',
      `${defender.name}에게 역공격 기회가 주어집니다!`
    );

    // 역공격 실행 (자동)
    const counterRoll = this.rollDice(20);
    const counterPower = defender.stats.attack + counterRoll;
    
    this.addBattleLog(
      battle.id,
      'action',
      `${defender.name}의 역공격! (공격력 ${defender.stats.attack} + 주사위 ${counterRoll} = ${counterPower})`
    );

    // 역공격 데미지 적용 (방어 불가)
    originalAttacker.hp = Math.max(0, originalAttacker.hp - counterPower);
    
    this.addBattleLog(
      battle.id,
      'action',
      `${originalAttacker.name}이(가) ${counterPower} 역공격 데미지를 받았습니다! (남은 HP: ${originalAttacker.hp}/${originalAttacker.maxHp})`
    );

    // 역공격으로 사망 체크
    if (originalAttacker.hp <= 0) {
      originalAttacker.alive = false;
      this.addBattleLog(
        battle.id,
        'system',
        `${originalAttacker.name}이(가) 역공격으로 전투불능 상태가 되었습니다!`
      );
    }
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
      `${player.name}이(가) 방어 자세를 취했습니다 (방어력: ${player.stats.defense}${player.buffs.defense_buff ? ' x1.5' : ''})`
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

    // 아이템 제거 (1회용)
    player.inventory.splice(itemIndex, 1);

    let result = {};

    switch (itemType) {
      case '공격 보정기':
        player.buffs.attack_buff = true;
        this.addBattleLog(
          battle.id,
          'action',
          `${player.name}이(가) 공격 보정기를 사용했습니다! (다음 공격력 1.5배)`
        );
        result = { success: true, effect: 'attack_buff' };
        break;

      case '방어 보정기':
        player.buffs.defense_buff = true;
        this.addBattleLog(
          battle.id,
          'action',
          `${player.name}이(가) 방어 보정기를 사용했습니다! (다음 방어력 1.5배)`
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
          `${player.name}이(가) ${healTarget.name}에게 디터니를 사용했습니다! (HP +${actualHeal})`
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
        this.addBattleLog(battleId, 'system', '팀 턴 시간 초과! 다음 팀으로 넘어갑니다');
        this.endTeamTurn(battleId);
      }
    }, 300000); // 5분

    this.turnTimers.set(battleId, timer);
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

    // 최대 턴 수 체크 (50턴)
    if (battle.turnNumber >= 50) {
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
    battle.endTime = Date.now();
    
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
   * 강제 전투 종료 (관리자용)
   */
  forceEndBattle(battleId, winner = null) {
    return this.endBattle(battleId, winner);
  }
}

module.exports = BattleEngine;