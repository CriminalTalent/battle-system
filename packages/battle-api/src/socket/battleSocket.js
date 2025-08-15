// packages/battle-api/src/socket/battleSocket.js
const Battle = require('../models/Battle');
const Character = require('../models/Character');
const BattleLog = require('../models/BattleLog');
const BattleEngine = require('../services/BattleEngine');
const logger = require('../config/logger');

class BattleSocketHandler {
  constructor(io) {
    this.io = io;
    this.activeBattles = new Map(); // roomId -> battle 상태 캐시
    this.playerSockets = new Map(); // socketId -> player 정보
  }

  // 소켓 연결 처리
  handleConnection(socket) {
    logger.info(`Socket connected: ${socket.id}`);

    // 전투 참가
    socket.on('join_battle', async (data) => {
      await this.handleJoinBattle(socket, data);
    });

    // 플레이어 준비
    socket.on('player_ready', async (data) => {
      await this.handlePlayerReady(socket, data);
    });

    // 전투 액션
    socket.on('battle_action', async (data) => {
      await this.handleBattleAction(socket, data);
    });

    // 대사 전송
    socket.on('send_dialogue', async (data) => {
      await this.handleSendDialogue(socket, data);
    });

    // 대사 프리셋 사용
    socket.on('use_dialogue_preset', async (data) => {
      await this.handleUseDialoguePreset(socket, data);
    });

    // 턴 패스
    socket.on('pass_turn', async (data) => {
      await this.handlePassTurn(socket, data);
    });

    // 전투 포기
    socket.on('surrender', async (data) => {
      await this.handleSurrender(socket, data);
    });

    // 관람자 참가
    socket.on('join_spectate', async (data) => {
      await this.handleJoinSpectate(socket, data);
    });

    // 연결 해제
    socket.on('disconnect', () => {
      this.handleDisconnect(socket);
    });

    // 핑/퐁 (연결 상태 확인)
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
  }

  // 전투 타입별 참가 처리
  async handleJoinBattle(socket, data) {
    try {
      const { token, playerId } = data;
      
      if (!token || !playerId) {
        socket.emit('error', { message: '토큰과 플레이어 ID가 필요합니다.' });
        return;
      }

      // 전투 찾기
      const battle = await this.findAndPopulateBattle(token);

      if (!battle) {
        socket.emit('error', { message: '전투를 찾을 수 없습니다.' });
        return;
      }

      if (battle.status === 'finished' || battle.status === 'cancelled') {
        socket.emit('error', { message: '이미 종료된 전투입니다.' });
        return;
      }

      // 팀전 vs 1v1 처리
      const joinResult = battle.battleType === '1v1' 
        ? await this.handleJoin1v1(battle, playerId, socket.id)
        : await this.handleJoinTeam(battle, playerId, socket.id);

      if (!joinResult.success) {
        socket.emit('error', { message: joinResult.message });
        return;
      }

      await battle.save();

      // 소켓을 방에 추가
      socket.join(battle.roomId);
      
      // 플레이어 정보 저장
      this.playerSockets.set(socket.id, {
        playerId,
        battleId: battle._id,
        roomId: battle.roomId,
        ...joinResult.playerInfo
      });

      // 캐시 업데이트
      this.activeBattles.set(battle.roomId, battle);

      // 플레이어에게 전투 상태 전송
      socket.emit('battle_joined', {
        battle: this.formatBattleForClient(battle),
        myRole: joinResult.playerInfo.team || joinResult.playerInfo.playerSlot,
        myPosition: joinResult.playerInfo.position,
        myUserId: playerId,
        canSendDialogue: this.canPlayerSendDialogue(battle, joinResult.playerInfo)
      });

      // 다른 참가자들에게 알림
      socket.to(battle.roomId).emit('player_joined', {
        playerId,
        playerInfo: joinResult.playerInfo,
        characterName: joinResult.characterName
      });

      // 로그 기록
      await this.createJoinLog(battle, joinResult.characterName);

      logger.info(`Player ${playerId} joined battle ${battle.roomId} as ${JSON.stringify(joinResult.playerInfo)}`);

    } catch (error) {
      logger.error('Join battle error:', error);
      socket.emit('error', { message: '전투 참가 중 오류가 발생했습니다.' });
    }
  }

  // 1v1 전투 참가 처리
  async handleJoin1v1(battle, playerId, socketId) {
    let playerSlot = null;
    let characterName = '';

    if (!battle.characters.player1.playerId) {
      playerSlot = 'player1';
      battle.characters.player1.playerId = playerId;
      battle.characters.player1.socketId = socketId;
      battle.characters.player1.joinedAt = new Date();
      characterName = battle.characters.player1.characterId.name;
    } else if (!battle.characters.player2.playerId) {
      playerSlot = 'player2';
      battle.characters.player2.playerId = playerId;
      battle.characters.player2.socketId = socketId;
      battle.characters.player2.joinedAt = new Date();
      characterName = battle.characters.player2.characterId.name;
    } else if (battle.characters.player1.playerId === playerId) {
      playerSlot = 'player1';
      battle.characters.player1.socketId = socketId;
      characterName = battle.characters.player1.characterId.name;
    } else if (battle.characters.player2.playerId === playerId) {
      playerSlot = 'player2';
      battle.characters.player2.socketId = socketId;
      characterName = battle.characters.player2.characterId.name;
    } else {
      return { success: false, message: '전투가 이미 가득 찼습니다.' };
    }

    return {
      success: true,
      playerInfo: { playerSlot },
      characterName
    };
  }

  // 팀전 참가 처리
  async handleJoinTeam(battle, playerId, socketId) {
    const maxPlayersPerTeam = this.getMaxPlayersPerTeam(battle.battleType);
    
    // 기존 플레이어인지 확인 (재연결)
    const existingPlayer = this.findExistingTeamPlayer(battle, playerId);
    if (existingPlayer) {
      // 소켓 ID 업데이트 (재연결)
      battle.teams[existingPlayer.team][existingPlayer.position].socketId = socketId;
      return {
        success: true,
        playerInfo: existingPlayer,
        characterName: battle.teams[existingPlayer.team][existingPlayer.position].characterId.name
      };
    }

    // 새 플레이어 슬롯 찾기
    const availableSlot = this.findAvailableTeamSlot(battle, maxPlayersPerTeam);
    if (!availableSlot) {
      return { success: false, message: '전투가 이미 가득 찼습니다.' };
    }

    // 플레이어 추가
    battle.teams[availableSlot.team][availableSlot.position] = {
      playerId,
      socketId,
      joinedAt: new Date(),
      isReady: false,
      characterId: battle.teams[availableSlot.team][availableSlot.position].characterId,
      currentHp: battle.teams[availableSlot.team][availableSlot.position].characterId.hp,
      currentMp: battle.teams[availableSlot.team][availableSlot.position].characterId.mp || 0,
      statusEffects: [],
      stats: { ...battle.teams[availableSlot.team][availableSlot.position].characterId.stats },
      status: 'alive'
    };

    return {
      success: true,
      playerInfo: {
        team: availableSlot.team,
        position: availableSlot.position
      },
      characterName: battle.teams[availableSlot.team][availableSlot.position].characterId.name
    };
  }

  // 팀당 최대 플레이어 수 계산
  getMaxPlayersPerTeam(battleType) {
    switch (battleType) {
      case '2v2': return 2;
      case '3v3': return 3;
      case '4v4': return 4;
      default: return 1;
    }
  }

  // 기존 팀 플레이어 찾기
  findExistingTeamPlayer(battle, playerId) {
    for (const teamName of ['team1', 'team2']) {
      const team = battle.teams[teamName];
      if (team) {
        for (let i = 0; i < team.length; i++) {
          if (team[i] && team[i].playerId === playerId) {
            return { team: teamName, position: i };
          }
        }
      }
    }
    return null;
  }

  // 사용 가능한 팀 슬롯 찾기
  findAvailableTeamSlot(battle, maxPlayersPerTeam) {
    for (const teamName of ['team1', 'team2']) {
      const team = battle.teams[teamName];
      if (team) {
        for (let i = 0; i < maxPlayersPerTeam; i++) {
          if (!team[i] || !team[i].playerId) {
            return { team: teamName, position: i };
          }
        }
      }
    }
    return null;
  }

  // 전투 찾기 및 populate
  async findAndPopulateBattle(token) {
    const battle = await Battle.findByToken(token);
    if (!battle) return null;

    if (battle.battleType === '1v1') {
      return await battle.populate('characters.player1.characterId characters.player2.characterId');
    } else {
      // 팀전의 경우 모든 팀 멤버 populate
      const populatePaths = [];
      const maxPlayers = this.getMaxPlayersPerTeam(battle.battleType);
      
      for (let i = 0; i < maxPlayers; i++) {
        populatePaths.push(`teams.team1.${i}.characterId`);
        populatePaths.push(`teams.team2.${i}.characterId`);
      }
      
      return await battle.populate(populatePaths.join(' '));
    }
  }

  // 전투 액션 처리 (팀전 지원)
  async handleBattleAction(socket, data) {
    try {
      const { actionType, targets, skillName, extra } = data;
      const playerInfo = this.playerSockets.get(socket.id);

      if (!playerInfo) {
        socket.emit('error', { message: '전투에 참가하지 않은 상태입니다.' });
        return;
      }

      const battle = await this.findAndPopulateBattle(battle.token);
      if (!battle || battle.status !== 'active') {
        socket.emit('error', { message: '활성 상태의 전투가 아닙니다.' });
        return;
      }

      // 턴 확인 (팀전 vs 1v1)
      if (!this.isPlayerTurn(battle, playerInfo)) {
        socket.emit('error', { message: '당신의 턴이 아닙니다.' });
        return;
      }

      // 시간 초과 확인
      if (battle.isTurnTimeExpired()) {
        socket.emit('error', { message: '턴 시간이 초과되었습니다.' });
        await this.handleTurnTimeout(battle);
        return;
      }

      // 대상 유효성 검증
      const validationResult = this.validateTargets(battle, playerInfo, actionType, targets);
      if (!validationResult.valid) {
        socket.emit('error', { message: validationResult.message });
        return;
      }

      // BattleEngine을 통해 액션 처리
      const engine = new BattleEngine(battle);
      const result = await engine.processAction(playerInfo, {
        type: actionType,
        targets: targets || [], // 배열로 전달
        skillName,
        extra
      });

      // 결과 저장
      await battle.save();

      // 액션 로그 기록
      await this.createActionLog(battle, playerInfo, actionType, targets, result);

      // 모든 참가자에게 액션 결과 브로드캐스트
      this.io.to(battle.roomId).emit('action_result', {
        turn: battle.turnNumber,
        actor: playerInfo,
        action: {
          type: actionType,
          targets,
          skillName,
          extra
        },
        result,
        battleState: this.formatBattleForClient(battle)
      });

      // 전투 종료 확인
      if (result.battleEnded) {
        await this.handleBattleEnd(battle, result.winner, result.reason);
        return;
      }

      // 다음 턴으로 이동
      this.moveToNextTurn(battle);
      await battle.save();

      // 턴 변경 알림
      this.io.to(battle.roomId).emit('turn_changed', {
        currentTurn: battle.currentTurn,
        turnNumber: battle.turnNumber,
        turnStartTime: battle.turnStartTime,
        timeLimit: battle.turnTimeLimit,
        canSendDialogue: this.getDialoguePermissions(battle)
      });

      // 턴 타이머 시작
      this.startTurnTimer(battle);

    } catch (error) {
      logger.error('Battle action error:', error);
      socket.emit('error', { message: '액션 처리 중 오류가 발생했습니다.' });
    }
  }

  // 플레이어 턴 확인
  isPlayerTurn(battle, playerInfo) {
    if (battle.battleType === '1v1') {
      return battle.currentTurn === playerInfo.playerSlot;
    } else {
      return battle.currentTurn.team === playerInfo.team && 
             battle.currentTurn.position === playerInfo.position;
    }
  }

  // 대상 유효성 검증
  validateTargets(battle, playerInfo, actionType, targets) {
    if (!targets || targets.length === 0) {
      return { valid: false, message: '대상을 선택해주세요.' };
    }

    for (const target of targets) {
      // 대상이 존재하는지 확인
      if (!this.isValidTarget(battle, target)) {
        return { valid: false, message: '유효하지 않은 대상입니다.' };
      }

      // 액션 타입별 대상 확인
      const canTarget = this.canTargetPlayer(battle, playerInfo, target, actionType);
      if (!canTarget.valid) {
        return { valid: false, message: canTarget.message };
      }
    }

    return { valid: true };
  }

  // 유효한 대상인지 확인
  isValidTarget(battle, target) {
    if (battle.battleType === '1v1') {
      return target === 'player1' || target === 'player2';
    } else {
      return target.team && 
             (target.team === 'team1' || target.team === 'team2') &&
             typeof target.position === 'number' &&
             target.position >= 0 &&
             battle.teams[target.team] &&
             battle.teams[target.team][target.position];
    }
  }

  // 대상 지정 가능 여부 확인
  canTargetPlayer(battle, playerInfo, target, actionType) {
    const isSameTeam = this.isSameTeam(battle, playerInfo, target);
    
    switch (actionType) {
      case 'attack':
        if (isSameTeam) {
          return { valid: false, message: '같은 팀을 공격할 수 없습니다.' };
        }
        break;
      case 'defend':
      case 'heal':
        if (!isSameTeam) {
          return { valid: false, message: '상대 팀을 대상으로 할 수 없습니다.' };
        }
        break;
    }

    // 대상이 살아있는지 확인
    const targetPlayer = this.getTargetPlayer(battle, target);
    if (!targetPlayer || targetPlayer.status === 'dead' || targetPlayer.currentHp <= 0) {
      return { valid: false, message: '죽은 대상을 선택할 수 없습니다.' };
    }

    return { valid: true };
  }

  // 같은 팀인지 확인
  isSameTeam(battle, playerInfo, target) {
    if (battle.battleType === '1v1') {
      return playerInfo.playerSlot === target;
    } else {
      return playerInfo.team === target.team;
    }
  }

  // 대상 플레이어 가져오기
  getTargetPlayer(battle, target) {
    if (battle.battleType === '1v1') {
      return battle.characters[target];
    } else {
      return battle.teams[target.team][target.position];
    }
  }

  // 다음 턴으로 이동
  moveToNextTurn(battle) {
    if (battle.battleType === '1v1') {
      battle.nextTurn();
    } else {
      battle.nextTeamTurn();
    }
  }

  // 대사 전송 권한 확인 (팀전 지원)
  canPlayerSendDialogue(battle, playerInfo) {
    // 전투가 활성 상태인지 확인
    if (battle.status !== 'active') {
      return { allowed: false, reason: '전투가 활성 상태가 아닙니다.' };
    }

    // 해당 플레이어의 턴인지 확인
    if (!this.isPlayerTurn(battle, playerInfo)) {
      return { allowed: false, reason: '당신의 턴이 아닙니다.' };
    }

    // 시간이 남아있는지 확인
    if (battle.isTurnTimeExpired()) {
      return { allowed: false, reason: '턴 시간이 초과되었습니다.' };
    }

    // 이번 턴에 이미 대사를 사용했는지 확인
    if (battle.hasUsedDialogueThisTurn(playerInfo)) {
      return { allowed: false, reason: '이번 턴에 이미 대사를 사용했습니다.' };
    }

    // 대사 기능이 활성화되어 있는지 확인
    if (!battle.settings.ruleset.dialogueEnabled) {
      return { allowed: false, reason: '이 전투에서는 대사 기능이 비활성화되어 있습니다.' };
    }

    return { 
      allowed: true, 
      timeRemaining: Math.max(0, Math.floor(battle.turnTimeRemaining))
    };
  }

  // 모든 플레이어의 대사 권한 확인
  getDialoguePermissions(battle) {
    const permissions = {};
    
    if (battle.battleType === '1v1') {
      permissions.player1 = this.canPlayerSendDialogue(battle, { playerSlot: 'player1' });
      permissions.player2 = this.canPlayerSendDialogue(battle, { playerSlot: 'player2' });
    } else {
      const maxPlayers = this.getMaxPlayersPerTeam(battle.battleType);
      
      for (const teamName of ['team1', 'team2']) {
        permissions[teamName] = {};
        for (let i = 0; i < maxPlayers; i++) {
          const playerInfo = { team: teamName, position: i };
          permissions[teamName][i] = this.canPlayerSendDialogue(battle, playerInfo);
        }
      }
    }
    
    return permissions;
  }

  // 클라이언트용 전투 데이터 포맷팅 (팀전 지원)
  formatBattleForClient(battle) {
    const base = {
      roomId: battle.roomId,
      title: battle.title,
      status: battle.status,
      battleType: battle.battleType,
      currentTurn: battle.currentTurn,
      turnNumber: battle.turnNumber,
      turnStartTime: battle.turnStartTime,
      turnTimeLimit: battle.turnTimeLimit,
      turnTimeRemaining: Math.max(0, Math.floor(battle.turnTimeRemaining)),
      spectatorCount: battle.spectators.length,
      settings: battle.settings
    };

    if (battle.battleType === '1v1') {
      base.participants = {
        A: battle.characters.player1.characterId ? {
          ...battle.characters.player1.characterId.toObject(),
          ...battle.characters.player1,
          characterId: undefined
        } : null,
        B: battle.characters.player2.characterId ? {
          ...battle.characters.player2.characterId.toObject(),
          ...battle.characters.player2,
          characterId: undefined
        } : null
      };
    } else {
      base.teams = {
        team1: battle.teams.team1.map(member => member ? {
          ...member.characterId.toObject(),
          ...member,
          characterId: undefined
        } : null),
        team2: battle.teams.team2.map(member => member ? {
          ...member.characterId.toObject(),
          ...member,
          characterId: undefined
        } : null)
      };
    }

    return base;
  }

  // 로그 생성 헬퍼 메서드들
  async createJoinLog(battle, characterName) {
    await BattleLog.createSystemLog(
      battle._id,
      battle.roomId,
      battle.turnNumber,
      await this.getNextSequence(battle._id, battle.turnNumber),
      'player_join',
      `${characterName}이(가) 전투에 참가했습니다.`
    );
  }

  async createActionLog(battle, playerInfo, actionType, targets, result) {
    const sequence = await this.getNextSequence(battle._id, battle.turnNumber);
    
    // 액터 정보
    const actor = this.getPlayerCharacterInfo(battle, playerInfo);
    
    // 대상 정보 (첫 번째 대상만 로그에 기록)
    const primaryTarget = targets && targets.length > 0 ? targets[0] : null;
    const target = primaryTarget ? this.getPlayerCharacterInfo(battle, primaryTarget) : null;

    await BattleLog.createActionLog(
      battle._id,
      battle.roomId,
      battle.turnNumber,
      sequence,
      actor,
      target,
      {
        type: actionType,
        targetCount: targets ? targets.length : 0
      },
      result
    );
  }

  // 플레이어 캐릭터 정보 가져오기
  getPlayerCharacterInfo(battle, playerInfo) {
    if (battle.battleType === '1v1') {
      const character = battle.characters[playerInfo.playerSlot || playerInfo];
      return {
        type: playerInfo.playerSlot || playerInfo,
        characterName: character.characterId.name,
        playerId: character.playerId
      };
    } else {
      const character = battle.teams[playerInfo.team][playerInfo.position];
      return {
        type: `${playerInfo.team}-${playerInfo.position}`,
        characterName: character.characterId.name,
        playerId: character.playerId
      };
    }
  }

  // 시퀀스 번호 생성
  async getNextSequence(battleId, turn) {
    const count = await BattleLog.countDocuments({ 
      battleId, 
      turn 
    });
    return count + 1;
  }

  // 기존 메서드들 (handlePlayerReady, startBattle, handleBattleEnd 등)은 그대로 유지
  // 단, 팀전 지원을 위한 수정이 필요한 부분들만 업데이트

  // 플레이어 준비 처리 (팀전 지원)
  async handlePlayerReady(socket, data) {
    try {
      const playerInfo = this.playerSockets.get(socket.id);
      if (!playerInfo) {
        socket.emit('error', { message: '전투에 참가하지 않은 상태입니다.' });
        return;
      }

      const battle = await Battle.findById(playerInfo.battleId);
      if (!battle) {
        socket.emit('error', { message: '전투를 찾을 수 없습니다.' });
        return;
      }

      // 플레이어 준비 상태 설정
      if (battle.battleType === '1v1') {
        battle.setPlayerReady(playerInfo.playerSlot, true);
      } else {
        battle.setTeamPlayerReady(playerInfo.team, playerInfo.position, true);
      }

      await battle.save();

      // 모든 참가자에게 알림
      this.io.to(battle.roomId).emit('player_ready', {
        playerInfo,
        allReady: battle.allPlayersReady
      });

      // 모든 플레이어가 준비되면 전투 시작
      if (battle.allPlayersReady) {
        await this.startBattle(battle);
      }

    } catch (error) {
      logger.error('Player ready error:', error);
      socket.emit('error', { message: '준비 처리 중 오류가 발생했습니다.' });
    }
  }

  // 나머지 메서드들...
  // (handleSendDialogue, handleUseDialoguePreset, startTurnTimer, handleTurnTimeout, 
  //  startBattle, handleBattleEnd, handleDisconnect, handleJoinSpectate 등은 
  //  기존 로직을 유지하되 필요한 부분만 팀전 지원으로 수정)
}
