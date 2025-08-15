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

    // 대사 전송 (새로 추가)
    socket.on('send_dialogue', async (data) => {
      await this.handleSendDialogue(socket, data);
    });

    // 대사 프리셋 사용 (새로 추가)
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

  // 전투 참가 처리
  async handleJoinBattle(socket, data) {
    try {
      const { token, playerId } = data;
      
      if (!token || !playerId) {
        socket.emit('error', { message: '토큰과 플레이어 ID가 필요합니다.' });
        return;
      }

      // 전투 찾기
      const battle = await Battle.findByToken(token)
        .populate('characters.player1.characterId')
        .populate('characters.player2.characterId');

      if (!battle) {
        socket.emit('error', { message: '전투를 찾을 수 없습니다.' });
        return;
      }

      if (battle.status === 'finished' || battle.status === 'cancelled') {
        socket.emit('error', { message: '이미 종료된 전투입니다.' });
        return;
      }

      // 플레이어 슬롯 확인 및 할당
      let playerSlot = null;
      if (!battle.characters.player1.playerId) {
        playerSlot = 'player1';
        battle.characters.player1.playerId = playerId;
        battle.characters.player1.socketId = socket.id;
        battle.characters.player1.joinedAt = new Date();
      } else if (!battle.characters.player2.playerId) {
        playerSlot = 'player2';
        battle.characters.player2.playerId = playerId;
        battle.characters.player2.socketId = socket.id;
        battle.characters.player2.joinedAt = new Date();
      } else if (battle.characters.player1.playerId === playerId) {
        playerSlot = 'player1';
        battle.characters.player1.socketId = socket.id;
      } else if (battle.characters.player2.playerId === playerId) {
        playerSlot = 'player2';
        battle.characters.player2.socketId = socket.id;
      } else {
        socket.emit('error', { message: '전투가 이미 가득 찼습니다.' });
        return;
      }

      await battle.save();

      // 소켓을 방에 추가
      socket.join(battle.roomId);
      
      // 플레이어 정보 저장
      this.playerSockets.set(socket.id, {
        playerId,
        playerSlot,
        roomId: battle.roomId,
        battleId: battle._id
      });

      // 캐시 업데이트
      this.activeBattles.set(battle.roomId, battle);

      // 플레이어에게 전투 상태 전송
      socket.emit('battle_joined', {
        battle: this.formatBattleForClient(battle),
        playerSlot,
        canSendDialogue: this.canPlayerSendDialogue(battle, playerSlot)
      });

      // 다른 참가자들에게 알림
      socket.to(battle.roomId).emit('player_joined', {
        playerSlot,
        playerId,
        characterName: battle.characters[playerSlot].characterId.name
      });

      // 로그 기록
      await BattleLog.createSystemLog(
        battle._id,
        battle.roomId,
        battle.turnNumber,
        await this.getNextSequence(battle._id, battle.turnNumber),
        'player_join',
        `${battle.characters[playerSlot].characterId.name}이(가) 전투에 참가했습니다.`
      );

      logger.info(`Player ${playerId} joined battle ${battle.roomId} as ${playerSlot}`);

    } catch (error) {
      logger.error('Join battle error:', error);
      socket.emit('error', { message: '전투 참가 중 오류가 발생했습니다.' });
    }
  }

  // 대사 전송 처리 (새로 추가)
  async handleSendDialogue(socket, data) {
    try {
      const { message, category = 'general' } = data;
      const playerInfo = this.playerSockets.get(socket.id);

      if (!playerInfo) {
        socket.emit('error', { message: '전투에 참가하지 않은 상태입니다.' });
        return;
      }

      // 대사 길이 검증
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        socket.emit('error', { message: '유효한 대사를 입력해주세요.' });
        return;
      }

      if (message.length > 140) {
        socket.emit('error', { message: '대사는 140자를 초과할 수 없습니다.' });
        return;
      }

      // 전투 상태 확인
      const battle = await Battle.findById(playerInfo.battleId)
        .populate('characters.player1.characterId')
        .populate('characters.player2.characterId');

      if (!battle || battle.status !== 'active') {
        socket.emit('error', { message: '활성 상태의 전투가 아닙니다.' });
        return;
      }

      // 대사 전송 권한 확인
      const canSend = this.canPlayerSendDialogue(battle, playerInfo.playerSlot);
      if (!canSend.allowed) {
        socket.emit('error', { message: canSend.reason });
        return;
      }

      // 대사 추가
      const characterName = battle.characters[playerInfo.playerSlot].characterId.name;
      const dialogueEntry = battle.addDialogue(
        playerInfo.playerSlot,
        characterName,
        message.trim(),
        category
      );

      await battle.save();

      // 시퀀스 번호 생성
      const sequence = await this.getNextSequence(battle._id, battle.turnNumber);

      // 로그 기록
      await BattleLog.createDialogueLog(
        battle._id,
        battle.roomId,
        battle.turnNumber,
        sequence,
        {
          type: playerInfo.playerSlot,
          characterName,
          playerId: playerInfo.playerId
        },
        {
          message: message.trim(),
          category,
          isPreset: false
        }
      );

      // 모든 참가자에게 대사 브로드캐스트
      this.io.to(battle.roomId).emit('dialogue_received', {
        turn: battle.turnNumber,
        player: playerInfo.playerSlot,
        characterName,
        message: message.trim(),
        category,
        isPreset: false,
        timestamp: dialogueEntry.timestamp,
        timeRemaining: Math.max(0, Math.floor(battle.turnTimeRemaining))
      });

      // 대사 사용자에게 확인 전송
      socket.emit('dialogue_sent', {
        success: true,
        canSendMore: false, // 턴당 1회 제한
        nextTurnIn: Math.max(0, Math.floor(battle.turnTimeRemaining))
      });

      logger.info(`Dialogue sent in battle ${battle.roomId} by ${playerInfo.playerSlot}: "${message.trim()}"`);

    } catch (error) {
      logger.error('Send dialogue error:', error);
      
      if (error.message.includes('140자')) {
        socket.emit('error', { message: error.message });
      } else if (error.message.includes('이미 대사를 사용')) {
        socket.emit('error', { message: '이번 턴에 이미 대사를 사용했습니다.' });
      } else {
        socket.emit('error', { message: '대사 전송 중 오류가 발생했습니다.' });
      }
    }
  }

  // 대사 프리셋 사용 처리 (새로 추가)
  async handleUseDialoguePreset(socket, data) {
    try {
      const { presetIndex, category = 'general' } = data;
      const playerInfo = this.playerSockets.get(socket.id);

      if (!playerInfo) {
        socket.emit('error', { message: '전투에 참가하지 않은 상태입니다.' });
        return;
      }

      // 전투 및 캐릭터 정보 가져오기
      const battle = await Battle.findById(playerInfo.battleId)
        .populate('characters.player1.characterId')
        .populate('characters.player2.characterId');

      if (!battle || battle.status !== 'active') {
        socket.emit('error', { message: '활성 상태의 전투가 아닙니다.' });
        return;
      }

      // 대사 전송 권한 확인
      const canSend = this.canPlayerSendDialogue(battle, playerInfo.playerSlot);
      if (!canSend.allowed) {
        socket.emit('error', { message: canSend.reason });
        return;
      }

      // 캐릭터의 대사 프리셋 확인
      const character = battle.characters[playerInfo.playerSlot].characterId;
      const presets = character.getDialoguesByCategory(category);

      if (!presets || presets.length === 0) {
        socket.emit('error', { message: '해당 카테고리의 프리셋 대사가 없습니다.' });
        return;
      }

      if (presetIndex < 0 || presetIndex >= presets.length) {
        socket.emit('error', { message: '유효하지 않은 프리셋 인덱스입니다.' });
        return;
      }

      const presetMessage = presets[presetIndex];

      // 대사 추가
      const dialogueEntry = battle.addDialogue(
        playerInfo.playerSlot,
        character.name,
        presetMessage,
        category
      );

      await battle.save();

      // 시퀀스 번호 생성
      const sequence = await this.getNextSequence(battle._id, battle.turnNumber);

      // 로그 기록
      await BattleLog.createDialogueLog(
        battle._id,
        battle.roomId,
        battle.turnNumber,
        sequence,
        {
          type: playerInfo.playerSlot,
          characterName: character.name,
          playerId: playerInfo.playerId
        },
        {
          message: presetMessage,
          category,
          isPreset: true,
          presetIndex
        }
      );

      // 모든 참가자에게 대사 브로드캐스트
      this.io.to(battle.roomId).emit('dialogue_received', {
        turn: battle.turnNumber,
        player: playerInfo.playerSlot,
        characterName: character.name,
        message: presetMessage,
        category,
        isPreset: true,
        presetIndex,
        timestamp: dialogueEntry.timestamp,
        timeRemaining: Math.max(0, Math.floor(battle.turnTimeRemaining))
      });

      // 대사 사용자에게 확인 전송
      socket.emit('dialogue_sent', {
        success: true,
        canSendMore: false,
        nextTurnIn: Math.max(0, Math.floor(battle.turnTimeRemaining))
      });

      logger.info(`Preset dialogue used in battle ${battle.roomId} by ${playerInfo.playerSlot}: "${presetMessage}"`);

    } catch (error) {
      logger.error('Use dialogue preset error:', error);
      socket.emit('error', { message: '프리셋 대사 사용 중 오류가 발생했습니다.' });
    }
  }

  // 전투 액션 처리
  async handleBattleAction(socket, data) {
    try {
      const { actionType, target, skillName, extra } = data;
      const playerInfo = this.playerSockets.get(socket.id);

      if (!playerInfo) {
        socket.emit('error', { message: '전투에 참가하지 않은 상태입니다.' });
        return;
      }

      const battle = await Battle.findById(playerInfo.battleId)
        .populate('characters.player1.characterId')
        .populate('characters.player2.characterId');

      if (!battle || battle.status !== 'active') {
        socket.emit('error', { message: '활성 상태의 전투가 아닙니다.' });
        return;
      }

      // 턴 확인
      if (battle.currentTurn !== playerInfo.playerSlot) {
        socket.emit('error', { message: '당신의 턴이 아닙니다.' });
        return;
      }

      // 시간 초과 확인
      if (battle.isTurnTimeExpired()) {
        socket.emit('error', { message: '턴 시간이 초과되었습니다.' });
        await this.handleTurnTimeout(battle);
        return;
      }

      // BattleEngine을 통해 액션 처리
      const engine = new BattleEngine(battle);
      const result = await engine.processAction(playerInfo.playerSlot, {
        type: actionType,
        target,
        skillName,
        extra
      });

      // 결과 저장
      await battle.save();

      // 액션 로그 기록
      const sequence = await this.getNextSequence(battle._id, battle.turnNumber);
      await BattleLog.createActionLog(
        battle._id,
        battle.roomId,
        battle.turnNumber,
        sequence,
        {
          type: playerInfo.playerSlot,
          characterName: battle.characters[playerInfo.playerSlot].characterId.name,
          playerId: playerInfo.playerId
        },
        {
          type: target === playerInfo.playerSlot ? playerInfo.playerSlot : 
                (playerInfo.playerSlot === 'player1' ? 'player2' : 'player1'),
          characterName: battle.characters[target === playerInfo.playerSlot ? playerInfo.playerSlot : 
                        (playerInfo.playerSlot === 'player1' ? 'player2' : 'player1')].characterId.name
        },
        {
          type: actionType,
          name: skillName,
          ...extra
        },
        result
      );

      // 모든 참가자에게 액션 결과 브로드캐스트
      this.io.to(battle.roomId).emit('action_result', {
        turn: battle.turnNumber,
        actor: playerInfo.playerSlot,
        action: {
          type: actionType,
          target,
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
      battle.nextTurn();
      await battle.save();

      // 턴 변경 알림
      this.io.to(battle.roomId).emit('turn_changed', {
        currentTurn: battle.currentTurn,
        turnNumber: battle.turnNumber,
        turnStartTime: battle.turnStartTime,
        timeLimit: battle.turnTimeLimit,
        canSendDialogue: {
          player1: this.canPlayerSendDialogue(battle, 'player1'),
          player2: this.canPlayerSendDialogue(battle, 'player2')
        }
      });

      // 턴 타이머 시작
      this.startTurnTimer(battle);

    } catch (error) {
      logger.error('Battle action error:', error);
      socket.emit('error', { message: '액션 처리 중 오류가 발생했습니다.' });
    }
  }

  // 대사 전송 권한 확인
  canPlayerSendDialogue(battle, playerSlot) {
    // 전투가 활성 상태인지 확인
    if (battle.status !== 'active') {
      return { allowed: false, reason: '전투가 활성 상태가 아닙니다.' };
    }

    // 해당 플레이어의 턴인지 확인
    if (battle.currentTurn !== playerSlot) {
      return { allowed: false, reason: '당신의 턴이 아닙니다.' };
    }

    // 시간이 남아있는지 확인
    if (battle.isTurnTimeExpired()) {
      return { allowed: false, reason: '턴 시간이 초과되었습니다.' };
    }

    // 이번 턴에 이미 대사를 사용했는지 확인
    if (battle.hasUsedDialogueThisTurn(playerSlot)) {
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

  // 턴 타이머 시작
  startTurnTimer(battle) {
    const timeoutId = setTimeout(async () => {
      try {
        // 전투 상태 재확인
        const currentBattle = await Battle.findById(battle._id);
        if (!currentBattle || currentBattle.status !== 'active') {
          return;
        }

        // 아직 해당 턴이고 시간이 초과되었는지 확인
        if (currentBattle.turnNumber === battle.turnNumber && 
            currentBattle.currentTurn === battle.currentTurn &&
            currentBattle.isTurnTimeExpired()) {
          
          await this.handleTurnTimeout(currentBattle);
        }
      } catch (error) {
        logger.error('Turn timer error:', error);
      }
    }, battle.turnTimeLimit * 1000);

    // 타이머 ID 저장 (필요시 취소를 위해)
    if (!this.turnTimers) {
      this.turnTimers = new Map();
    }
    this.turnTimers.set(`${battle._id}_${battle.turnNumber}`, timeoutId);
  }

  // 턴 시간 초과 처리
  async handleTurnTimeout(battle) {
    try {
      logger.info(`Turn timeout in battle ${battle.roomId}, turn ${battle.turnNumber}`);

      // 시간 초과 로그 기록
      const sequence = await this.getNextSequence(battle._id, battle.turnNumber);
      await BattleLog.createSystemLog(
        battle._id,
        battle.roomId,
        battle.turnNumber,
        sequence,
        'turn_timeout',
        `${battle.currentTurn}의 턴 시간이 초과되었습니다.`
      );

      // 자동으로 패스 처리
      battle.nextTurn();
      await battle.save();

      // 모든 참가자에게 알림
      this.io.to(battle.roomId).emit('turn_timeout', {
        timeoutPlayer: battle.currentTurn === 'player1' ? 'player2' : 'player1',
        newTurn: battle.currentTurn,
        turnNumber: battle.turnNumber,
        turnStartTime: battle.turnStartTime
      });

      // 새로운 턴 타이머 시작
      this.startTurnTimer(battle);

    } catch (error) {
      logger.error('Turn timeout handler error:', error);
    }
  }

  // 플레이어 준비 처리
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

      battle.setPlayerReady(playerInfo.playerSlot, true);
      await battle.save();

      // 모든 참가자에게 알림
      this.io.to(battle.roomId).emit('player_ready', {
        player: playerInfo.playerSlot,
        bothReady: battle.bothPlayersReady
      });

      // 양쪽 플레이어가 모두 준비되면 전투 시작
      if (battle.bothPlayersReady) {
        await this.startBattle(battle);
      }

    } catch (error) {
      logger.error('Player ready error:', error);
      socket.emit('error', { message: '준비 처리 중 오류가 발생했습니다.' });
    }
  }

  // 전투 시작
  async startBattle(battle) {
    try {
      battle.status = 'active';
      battle.turnStartTime = new Date();
      await battle.save();

      // 시작 로그 기록
      await BattleLog.createSystemLog(
        battle._id,
        battle.roomId,
        1,
        1,
        'battle_start',
        '전투가 시작되었습니다!'
      );

      // 모든 참가자에게 전투 시작 알림
      this.io.to(battle.roomId).emit('battle_started', {
        battleState: this.formatBattleForClient(battle),
        currentTurn: battle.currentTurn,
        turnNumber: battle.turnNumber,
        turnStartTime: battle.turnStartTime,
        timeLimit: battle.turnTimeLimit
      });

      // 첫 번째 턴 타이머 시작
      this.startTurnTimer(battle);

      logger.info(`Battle started: ${battle.roomId}`);

    } catch (error) {
      logger.error('Start battle error:', error);
    }
  }

  // 전투 종료 처리
  async handleBattleEnd(battle, winner, reason) {
    try {
      battle.endBattle(winner, reason);
      await battle.save();

      // 종료 로그 기록
      await BattleLog.createSystemLog(
        battle._id,
        battle.roomId,
        battle.turnNumber,
        await this.getNextSequence(battle._id, battle.turnNumber),
        'battle_end',
        `전투가 종료되었습니다. 승자: ${winner}`
      );

      // 모든 참가자에게 전투 종료 알림
      this.io.to(battle.roomId).emit('battle_ended', {
        winner,
        reason,
        finalStats: battle.result.finalStats,
        endedAt: battle.result.endedAt
      });

      // 캐시에서 제거
      this.activeBattles.delete(battle.roomId);

      logger.info(`Battle ended: ${battle.roomId}, winner: ${winner}, reason: ${reason}`);

    } catch (error) {
      logger.error('Battle end error:', error);
    }
  }

  // 연결 해제 처리
  handleDisconnect(socket) {
    const playerInfo = this.playerSockets.get(socket.id);
    
    if (playerInfo) {
      // 전투에서 플레이어 제거 또는 일시정지 처리
      this.handlePlayerDisconnect(playerInfo);
      this.playerSockets.delete(socket.id);
    }

    logger.info(`Socket disconnected: ${socket.id}`);
  }

  // 플레이어 연결 해제 처리
  async handlePlayerDisconnect(playerInfo) {
    try {
      const battle = await Battle.findById(playerInfo.battleId);
      if (battle && battle.status === 'active') {
        // 연결 해제 로그 기록
        await BattleLog.createSystemLog(
          battle._id,
          battle.roomId,
          battle.turnNumber,
          await this.getNextSequence(battle._id, battle.turnNumber),
          'player_disconnect',
          `${playerInfo.playerSlot}이(가) 연결을 해제했습니다.`
        );

        // 다른 참가자들에게 알림
        this.io.to(playerInfo.roomId).emit('player_disconnected', {
          player: playerInfo.playerSlot,
          playerId: playerInfo.playerId
        });

        // 필요시 전투 일시정지 또는 종료
        battle.status = 'paused';
        await battle.save();
      }
    } catch (error) {
      logger.error('Player disconnect handler error:', error);
    }
  }

  // 관람자 참가 처리
  async handleJoinSpectate(socket, data) {
    try {
      const { roomId, nickname = 'Anonymous' } = data;

      const battle = await Battle.findByRoomId(roomId)
        .populate('characters.player1.characterId')
        .populate('characters.player2.characterId');

      if (!battle) {
        socket.emit('error', { message: '전투를 찾을 수 없습니다.' });
        return;
      }

      if (!battle.settings.allowSpectators) {
        socket.emit('error', { message: '이 전투는 관람이 허용되지 않습니다.' });
        return;
      }

      // 관람자 추가
      battle.addSpectator(socket.id, nickname);
      await battle.save();

      // 소켓을 방에 추가
      socket.join(roomId);

      // 관람자에게 전투 상태 전송
      socket.emit('spectate_joined', {
        battle: this.formatBattleForClient(battle),
        dialogueHistory: battle.dialogueHistory.slice(-20) // 최근 20개 대사
      });

      // 다른 참가자들에게 알림
      socket.to(roomId).emit('spectator_joined', {
        nickname,
        spectatorCount: battle.spectators.length
      });

      logger.info(`Spectator ${nickname} joined battle ${roomId}`);

    } catch (error) {
      logger.error('Join spectate error:', error);
      socket.emit('error', { message: '관람 참가 중 오류가 발생했습니다.' });
    }
  }

  // 클라이언트용 전투 데이터 포맷팅
  formatBattleForClient(battle) {
    return {
      roomId: battle.roomId,
      title: battle.title,
      status: battle.status,
      currentTurn: battle.currentTurn,
      turnNumber: battle.turnNumber,
      turnStartTime: battle.turnStartTime,
      turnTimeLimit: battle.turnTimeLimit,
      turnTimeRemaining: Math.max(0, Math.floor(battle.turnTimeRemaining)),
      characters: {
        player1: {
          ...battle.characters.player1.characterId.toObject(),
          isReady: battle.characters.player1.isReady,
          playerId: battle.characters.player1.playerId
        },
        player2: battle.characters.player2.characterId ? {
          ...battle.characters.player2.characterId.toObject(),
          isReady: battle.characters.player2.isReady,
          playerId: battle.characters.player2.playerId
        } : null
      },
      spectatorCount: battle.spectators.length,
      settings: battle.settings
    };
  }

  // 시퀀스 번호 생성
  async getNextSequence(battleId, turn) {
    const count =