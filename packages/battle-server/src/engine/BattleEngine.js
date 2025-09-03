// packages/battle-server/src/engine/BattleEngine.js
// PYXIS 전투 시스템 - 핵심 게임 로직 엔진

class BattleEngine {
  constructor(battleId, mode = '2v2') {
    this.battleId = battleId;
    this.mode = mode; // '1v1', '2v2', '3v3', '4v4'
    this.status = 'waiting'; // waiting, active, paused, ended
    this.created = Date.now();
    this.started = null;
    this.ended = null;
    
    // 게임 설정
    this.settings = {
      battleDuration: 60 * 60 * 1000, // 1시간
      turnTimeLimit: 5 * 60 * 1000,   // 5분
      maxTurns: 100,                  // 최대 턴 수
      maxPlayersPerTeam: parseInt(mode.charAt(0))
    };
    
    // 팀 구성
    this.teams = {
      A: { name: '불사조 기사단', players: [], color: '#DCC7A2' },
      B: { name: '죽음을 먹는 자들', players: [], color: '#DCC7A2' }
    };
    
    // 전투 상태
    this.currentTurn = 1;
    this.currentTeam = 'A'; // 선공팀
    this.currentPhase = 'team_action'; // team_action, resolution, end_turn
    this.turnStartTime = null;
    this.turnTimer = null;
    
    // 로그 시스템
    this.logs = [];
    this.maxLogs = 1000;
    
    // 이벤트 시스템
    this.eventHandlers = new Map();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 플레이어 관리
  // ═══════════════════════════════════════════════════════════════════════
  
  addPlayer(playerData) {
    const { name, team, stats, items = [] } = playerData;
    
    // 팀 인원 제한 확인
    if (this.teams[team].players.length >= this.settings.maxPlayersPerTeam) {
      throw new Error(`팀 ${team}는 이미 가득 참 (${this.settings.maxPlayersPerTeam}명)`);
    }
    
    // 이름 중복 확인
    const allPlayers = [...this.teams.A.players, ...this.teams.B.players];
    if (allPlayers.some(p => p.name === name)) {
      throw new Error(`이름 "${name}"은 이미 사용 중입니다`);
    }
    
    // 스탯 검증 (총 12포인트, 각 스탯 1-10)
    const totalStats = Object.values(stats).reduce((sum, val) => sum + val, 0);
    if (totalStats !== 12) {
      throw new Error(`스탯 총합은 12여야 합니다 (현재: ${totalStats})`);
    }
    
    for (const [statName, value] of Object.entries(stats)) {
      if (value < 1 || value > 10) {
        throw new Error(`${statName} 스탯은 1-10 사이여야 합니다 (현재: ${value})`);
      }
    }
    
    // 플레이어 생성
    const player = {
      id: this.generatePlayerId(),
      name,
      team,
      stats: {
        attack: stats.attack || 3,
        defense: stats.defense || 3,
        agility: stats.agility || 3,
        luck: stats.luck || 3
      },
      status: {
        hp: 100,
        maxHp: 100,
        isAlive: true,
        effects: [], // 상태효과
        actionThisTurn: null // 이번 턴 액션
      },
      items: {
        dittany: 0,        // 디터니 (회복)
        attackBoost: 0,    // 공격 보정기
        defenseBoost: 0    // 방어 보정기
      },
      combat: {
        totalActions: 0,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        criticalHits: 0,
        successfulDefenses: 0,
        successfulDodges: 0
      },
      avatar: null // 아바타 파일 경로
    };
    
    // 아이템 파싱 및 추가
    if (Array.isArray(items)) {
      items.forEach(item => {
        if (typeof item === 'string') {
          const [itemName, count] = item.split(':');
          const itemCount = parseInt(count) || 1;
          
          switch (itemName) {
            case '디터니':
            case 'dittany':
              player.items.dittany = Math.max(0, Math.min(5, itemCount));
              break;
            case '공격보정':
            case 'attackBoost':
              player.items.attackBoost = Math.max(0, Math.min(3, itemCount));
              break;
            case '방어보정':
            case 'defenseBoost':
              player.items.defenseBoost = Math.max(0, Math.min(3, itemCount));
              break;
          }
        }
      });
    }
    
    // 팀에 추가
    this.teams[team].players.push(player);
    
    this.addLog('system', `플레이어 "${name}"이 ${this.teams[team].name}에 합류했습니다.`, {
      playerId: player.id,
      team,
      stats: player.stats,
      items: player.items
    });
    
    return player;
  }
  
  removePlayer(playerId) {
    for (const teamKey of ['A', 'B']) {
      const index = this.teams[teamKey].players.findIndex(p => p.id === playerId);
      if (index !== -1) {
        const player = this.teams[teamKey].players.splice(index, 1)[0];
        this.addLog('system', `플레이어 "${player.name}"이 전투에서 떠났습니다.`);
        return player;
      }
    }
    return null;
  }
  
  getPlayer(playerId) {
    for (const team of Object.values(this.teams)) {
      const player = team.players.find(p => p.id === playerId);
      if (player) return player;
    }
    return null;
  }
  
  getAllPlayers() {
    return [...this.teams.A.players, ...this.teams.B.players];
  }
  
  getAlivePlayers(teamKey = null) {
    if (teamKey) {
      return this.teams[teamKey].players.filter(p => p.status.isAlive);
    }
    return this.getAllPlayers().filter(p => p.status.isAlive);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 전투 시작/종료
  // ═══════════════════════════════════════════════════════════════════════
  
  canStartBattle() {
    const teamASizeOk = this.teams.A.players.length > 0;
    const teamBSizeOk = this.teams.B.players.length > 0;
    const statusOk = this.status === 'waiting';
    
    return teamASizeOk && teamBSizeOk && statusOk;
  }
  
  startBattle() {
    if (!this.canStartBattle()) {
      throw new Error('전투를 시작할 수 없습니다. 각 팀에 최소 1명의 플레이어가 필요합니다.');
    }
    
    this.status = 'active';
    this.started = Date.now();
    
    // 선공 결정 (민첩성 합계 vs 민첩성 합계)
    const teamAAgi = this.teams.A.players.reduce((sum, p) => sum + p.stats.agility, 0);
    const teamBAgi = this.teams.B.players.reduce((sum, p) => sum + p.stats.agility, 0);
    
    // 동점시 랜덤
    if (teamAAgi === teamBAgi) {
      this.currentTeam = Math.random() < 0.5 ? 'A' : 'B';
    } else {
      this.currentTeam = teamAAgi > teamBAgi ? 'A' : 'B';
    }
    
    this.addLog('system', `전투가 시작되었습니다!`, {
      teamAAgi,
      teamBAgi,
      firstTeam: this.currentTeam,
      firstTeamName: this.teams[this.currentTeam].name
    });
    
    this.addLog('system', `${this.teams[this.currentTeam].name}이 선공합니다. (민첩성 합계: ${this.currentTeam === 'A' ? teamAAgi : teamBAgi})`);
    
    // 첫 턴 시작
    this.startTurn();
    
    // 전체 게임 타이머 시작
    setTimeout(() => {
      if (this.status === 'active') {
        this.endBattle('timeout');
      }
    }, this.settings.battleDuration);
    
    this.emit('battle:started', {
      battleId: this.battleId,
      currentTeam: this.currentTeam,
      teams: this.getTeamsSnapshot()
    });
  }
  
  endBattle(reason = 'finished') {
    if (this.status === 'ended') return;
    
    this.status = 'ended';
    this.ended = Date.now();
    
    // 턴 타이머 정리
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    
    // 승부 결정
    const result = this.determineWinner(reason);
    
    this.addLog('system', `전투가 종료되었습니다. 승자: ${result.winner ? this.teams[result.winner].name : '무승부'}`, {
      reason,
      winner: result.winner,
      finalScore: result.score,
      duration: this.ended - this.started
    });
    
    this.emit('battle:ended', {
      battleId: this.battleId,
      reason,
      winner: result.winner,
      score: result.score,
      duration: this.ended - this.started,
      totalTurns: this.currentTurn
    });
    
    return result;
  }
  
  determineWinner(reason) {
    const aliveA = this.getAlivePlayers('A');
    const aliveB = this.getAlivePlayers('B');
    
    // 한 팀이 전멸한 경우
    if (aliveA.length === 0 && aliveB.length > 0) {
      return { winner: 'B', score: { A: 0, B: aliveB.reduce((sum, p) => sum + p.status.hp, 0) } };
    }
    if (aliveB.length === 0 && aliveA.length > 0) {
      return { winner: 'A', score: { A: aliveA.reduce((sum, p) => sum + p.status.hp, 0), B: 0 } };
    }
    
    // 시간 초과 또는 턴 제한 - HP 합계로 결정
    const scoreA = this.teams.A.players.reduce((sum, p) => sum + p.status.hp, 0);
    const scoreB = this.teams.B.players.reduce((sum, p) => sum + p.status.hp, 0);
    
    if (scoreA > scoreB) {
      return { winner: 'A', score: { A: scoreA, B: scoreB } };
    } else if (scoreB > scoreA) {
      return { winner: 'B', score: { A: scoreA, B: scoreB } };
    } else {
      return { winner: null, score: { A: scoreA, B: scoreB } }; // 무승부
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 턴 관리
  // ═══════════════════════════════════════════════════════════════════════
  
  startTurn() {
    this.turnStartTime = Date.now();
    this.currentPhase = 'team_action';
    
    // 현재 팀의 모든 생존 플레이어 액션 초기화
    this.getAlivePlayers(this.currentTeam).forEach(player => {
      player.status.actionThisTurn = null;
    });
    
    this.addLog('system', `턴 ${this.currentTurn}: ${this.teams[this.currentTeam].name}의 차례`, {
      turn: this.currentTurn,
      team: this.currentTeam,
      teamName: this.teams[this.currentTeam].name
    });
    
    // 5분 자동 패스 타이머
    this.turnTimer = setTimeout(() => {
      this.autoPassTurn();
    }, this.settings.turnTimeLimit);
    
    this.emit('turn:started', {
      turn: this.currentTurn,
      team: this.currentTeam,
      teamName: this.teams[this.currentTeam].name,
      alivePlayers: this.getAlivePlayers(this.currentTeam).map(p => p.id)
    });
  }
  
  autoPassTurn() {
    const alivePlayers = this.getAlivePlayers(this.currentTeam);
    const pendingPlayers = alivePlayers.filter(p => !p.status.actionThisTurn);
    
    if (pendingPlayers.length > 0) {
      pendingPlayers.forEach(player => {
        player.status.actionThisTurn = { type: 'pass', target: null, timestamp: Date.now() };
      });
      
      this.addLog('system', `시간 초과로 ${pendingPlayers.map(p => p.name).join(', ')}이(가) 자동 패스되었습니다.`);
    }
    
    this.processTurnActions();
  }
  
  canEndTurn() {
    const alivePlayers = this.getAlivePlayers(this.currentTeam);
    return alivePlayers.every(player => player.status.actionThisTurn !== null);
  }
  
  processTurnActions() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    
    this.currentPhase = 'resolution';
    
    // 현재 팀의 모든 액션 처리
    const alivePlayers = this.getAlivePlayers(this.currentTeam);
    const actions = alivePlayers
      .filter(p => p.status.actionThisTurn)
      .map(p => ({ player: p, action: p.status.actionThisTurn }))
      .sort((a, b) => {
        // 민첩성 순으로 정렬 (높은 순)
        const agiA = a.player.stats.agility;
        const agiB = b.player.stats.agility;
        return agiB - agiA;
      });
    
    // 액션 실행
    actions.forEach(({ player, action }) => {
      this.executeAction(player, action);
    });
    
    // 턴 종료 체크
    if (this.checkBattleEnd()) {
      return;
    }
    
    this.endTurn();
  }
  
  endTurn() {
    this.currentPhase = 'end_turn';
    
    // 팀 교체
    this.currentTeam = this.currentTeam === 'A' ? 'B' : 'A';
    this.currentTurn++;
    
    // 턴 제한 체크
    if (this.currentTurn > this.settings.maxTurns) {
      this.endBattle('max_turns_reached');
      return;
    }
    
    this.emit('turn:ended', {
      turn: this.currentTurn - 1,
      nextTeam: this.currentTeam,
      nextTeamName: this.teams[this.currentTeam].name
    });
    
    // 다음 턴 시작
    setTimeout(() => {
      if (this.status === 'active') {
        this.startTurn();
      }
    }, 1000); // 1초 간격으로 턴 진행
  }
  
  checkBattleEnd() {
    const aliveA = this.getAlivePlayers('A');
    const aliveB = this.getAlivePlayers('B');
    
    if (aliveA.length === 0 || aliveB.length === 0) {
      this.endBattle('elimination');
      return true;
    }
    
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 액션 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  executeAction(player, action) {
    if (!player.status.isAlive) return;
    
    player.combat.totalActions++;
    
    switch (action.type) {
      case 'attack':
        this.processAttack(player, action.target);
        break;
      case 'defend':
        this.processDefend(player, action.target);
        break;
      case 'dodge':
        this.processDodge(player);
        break;
      case 'item':
        this.processItem(player, action.itemType, action.target);
        break;
      case 'pass':
        this.processPass(player);
        break;
      default:
        this.addLog('error', `알 수 없는 액션 타입: ${action.type}`);
    }
  }
  
  processAttack(attacker, targetId) {
    const target = this.getPlayer(targetId);
    if (!target || !target.status.isAlive) {
      this.addLog('action', `${attacker.name}의 공격이 빗나갔습니다. (대상을 찾을 수 없음)`);
      return;
    }
    
    // 기본 공격력 계산: 공격력 + 주사위(1-20)
    const attackRoll = this.rollDice(20);
    const totalAttack = attacker.stats.attack + attackRoll;
    
    // 치명타 확인: 주사위(1-20) >= (20 - 행운/2)
    const critRoll = this.rollDice(20);
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCritical = critRoll >= critThreshold;
    
    // 명중률 체크: 행운 + 주사위(1-20)
    const hitRoll = this.rollDice(20);
    const hitChance = attacker.stats.luck + hitRoll;
    
    // 회피 체크: 민첩성 + 주사위(1-20) >= 공격수치
    const dodgeRoll = this.rollDice(20);
    const dodgeChance = target.stats.agility + dodgeRoll;
    
    if (dodgeChance >= totalAttack) {
      // 완전 회피
      this.addLog('action', `${target.name}이 ${attacker.name}의 공격을 회피했습니다! (회피: ${dodgeChance} vs 공격: ${totalAttack})`);
      target.combat.successfulDodges++;
      return;
    }
    
    // 대미지 계산: 공격력 - 방어력
    let baseDamage = Math.max(1, totalAttack - target.stats.defense);
    
    if (isCritical) {
      baseDamage *= 2;
      attacker.combat.criticalHits++;
      this.addLog('action', `💥 ${attacker.name}이 ${target.name}에게 치명타 공격! (${baseDamage} 대미지)`, {
        attacker: attacker.id,
        target: target.id,
        damage: baseDamage,
        critical: true,
        attackRoll,
        critRoll
      });
    } else {
      this.addLog('action', `${attacker.name}이 ${target.name}을 공격했습니다. (${baseDamage} 대미지)`, {
        attacker: attacker.id,
        target: target.id,
        damage: baseDamage,
        critical: false,
        attackRoll
      });
    }
    
    // HP 감소
    target.status.hp = Math.max(0, target.status.hp - baseDamage);
    attacker.combat.totalDamageDealt += baseDamage;
    target.combat.totalDamageTaken += baseDamage;
    
    // 사망 처리
    if (target.status.hp === 0 && target.status.isAlive) {
      target.status.isAlive = false;
      this.addLog('system', `💀 ${target.name}이 쓰러졌습니다!`, {
        playerId: target.id,
        killer: attacker.id
      });
    }
  }
  
  processDefend(defender, targetId) {
    const target = targetId ? this.getPlayer(targetId) : null;
    
    if (target && target.status.isAlive) {
      // 방어 역공격: 민첩 + 주사위(1-20) - 상대 공격수치
      const defenseRoll = this.rollDice(20);
      const defenseValue = defender.stats.agility + defenseRoll;
      const targetAttack = target.stats.attack + this.rollDice(20);
      
      if (defenseValue >= targetAttack) {
        // 방어 성공 + 역공격
        const counterDamage = Math.max(1, Math.floor(defender.stats.defense / 2));
        target.status.hp = Math.max(0, target.status.hp - counterDamage);
        defender.combat.successfulDefenses++;
        
        this.addLog('action', `🛡️ ${defender.name}이 ${target.name}의 공격을 막고 역공격했습니다! (${counterDamage} 대미지)`, {
          defender: defender.id,
          target: target.id,
          counterDamage,
          defenseRoll
        });
        
        if (target.status.hp === 0 && target.status.isAlive) {
          target.status.isAlive = false;
          this.addLog('system', `💀 ${target.name}이 역공격으로 쓰러졌습니다!`);
        }
      } else {
        this.addLog('action', `${defender.name}이 방어 태세를 취했습니다. (방어실패: ${defenseValue} vs ${targetAttack})`);
      }
    } else {
      this.addLog('action', `${defender.name}이 방어 태세를 취했습니다.`);
    }
  }
  
  processDodge(player) {
    // 회피는 다음 공격에 대한 회피율 상승 효과
    player.status.effects.push({
      type: 'dodge_boost',
      value: 5, // 회피 +5 보너스
      duration: 1, // 1턴간 지속
      timestamp: Date.now()
    });
    
    this.addLog('action', `${player.name}이 회피 태세를 취했습니다. (다음 회피 +5)`);
  }
  
  processItem(player, itemType, targetId) {
    if (player.items[itemType] <= 0) {
      this.addLog('error', `${player.name}은 ${itemType} 아이템이 없습니다.`);
      return;
    }
    
    const target = targetId ? this.getPlayer(targetId) : player;
    if (!target || !target.status.isAlive) {
      this.addLog('error', `아이템 사용 실패: 대상을 찾을 수 없습니다.`);
      return;
    }
    
    player.items[itemType]--;
    
    switch (itemType) {
      case 'dittany':
        // 디터니: 10 고정 회복
        const healAmount = 10;
        target.status.hp = Math.min(target.status.maxHp, target.status.hp + healAmount);
        this.addLog('action', `💚 ${player.name}이 ${target.name}에게 디터니를 사용했습니다. (${healAmount} 회복)`, {
          user: player.id,
          target: target.id,
          healAmount
        });
        break;
        
      case 'attackBoost':
        // 공격 보정기: 성공확률 10%
        const attackBoostRoll = this.rollDice(100);
        if (attackBoostRoll <= 10) {
          player.status.effects.push({
            type: 'attack_boost',
            value: 1.5, // 1.5배
            duration: 1,
            timestamp: Date.now()
          });
          this.addLog('action', `⚔️ ${player.name}의 공격 보정기가 성공했습니다! (다음 공격 1.5배)`, {
            user: player.id,
            success: true
          });
        } else {
          this.addLog('action', `${player.name}의 공격 보정기가 실패했습니다. (${attackBoostRoll}%)`, {
            user: player.id,
            success: false,
            roll: attackBoostRoll
          });
        }
        break;
        
      case 'defenseBoost':
        // 방어 보정기: 성공확률 10%
        const defenseBoostRoll = this.rollDice(100);
        if (defenseBoostRoll <= 10) {
          player.status.effects.push({
            type: 'defense_boost',
            value: 1.5, // 1.5배
            duration: 1,
            timestamp: Date.now()
          });
          this.addLog('action', `${player.name}의 방어 보정기가 성공했습니다! (다음 방어 1.5배)`, {
            user: player.id,
            success: true
          });
        } else {
          this.addLog('action', `${player.name}의 방어 보정기가 실패했습니다. (${defenseBoostRoll}%)`, {
            user: player.id,
            success: false,
            roll: defenseBoostRoll
          });
        }
        break;
    }
  }
  
  processPass(player) {
    this.addLog('action', `${player.name}이 턴을 넘겼습니다.`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 액션 검증 및 실행
  // ═══════════════════════════════════════════════════════════════════════
  
  submitAction(playerId, actionData) {
    const player = this.getPlayer(playerId);
    if (!player) {
      throw new Error('플레이어를 찾을 수 없습니다');
    }
    
    if (!player.status.isAlive) {
      throw new Error('사망한 플레이어는 액션을 수행할 수 없습니다');
    }
    
    if (this.status !== 'active') {
      throw new Error('전투가 진행 중이 아닙니다');
    }
    
    if (player.team !== this.currentTeam) {
      throw new Error('현재 턴이 아닙니다');
    }
    
    if (player.status.actionThisTurn) {
      throw new Error('이미 이번 턴에 액션을 수행했습니다');
    }
    
    // 액션 타입별 검증
    this.validateAction(player, actionData);
    
    // 액션 저장
    player.status.actionThisTurn = {
      ...actionData,
      timestamp: Date.now()
    };
