// packages/battle-api/src/socket/spectatorSocket.js
const logger = require('../config/logger');

class SpectatorSocketHandler {
  constructor(io, battleEngine) {
    this.io = io;
    this.battleEngine = battleEngine;
    this.spectators = new Map(); // spectatorId -> { battleId, socketId, info }
  }

  handleConnection(socket) {
    logger.info(`Spectator connected: ${socket.id}`);

    // 관전자로 배틀 참여
    socket.on('join_as_spectator', async (data) => {
      try {
        const { battleId, spectatorInfo } = data;
        
        const battle = this.battleEngine.getBattle(battleId);
        if (!battle) {
          socket.emit('error', { message: '존재하지 않는 배틀입니다.' });
          return;
        }

        // 관전자 정보 저장
        const spectatorId = `spectator_${socket.id}`;
        this.spectators.set(spectatorId, {
          battleId,
          socketId: socket.id,
          info: {
            name: spectatorInfo?.name || '관전자',
            joinedAt: Date.now()
          }
        });

        // 배틀에 관전자 추가
        if (!battle.spectators) {
          battle.spectators = new Map();
        }
        battle.spectators.set(spectatorId, {
          id: spectatorId,
          name: spectatorInfo?.name || '관전자',
          socketId: socket.id,
          joinedAt: Date.now()
        });

        // 관전자용 룸 입장
        socket.join(`battle_${battleId}`);
        socket.join(`spectators_${battleId}`);

        // 현재 배틀 상태 전송 (관전자용)
        const spectatorBattleState = this.getSpectatorBattleState(battle);
        socket.emit('spectator_joined', {
          battleId,
          spectatorId,
          battle: spectatorBattleState,
          spectatorCount: battle.spectators.size
        });

        // 다른 관전자들에게 새 관전자 알림
        socket.to(`spectators_${battleId}`).emit('spectator_update', {
          type: 'joined',
          spectator: {
            id: spectatorId,
            name: spectatorInfo?.name || '관전자'
          },
          spectatorCount: battle.spectators.size
        });

        // 배틀 참가자들에게 관전자 수 업데이트
        socket.to(`battle_${battleId}`).emit('spectator_count_updated', {
          spectatorCount: battle.spectators.size
        });

        logger.info(`Spectator ${spectatorId} joined battle ${battleId}`);

      } catch (error) {
        logger.error('Error joining as spectator:', error);
        socket.emit('error', { message: '관전 참여 중 오류가 발생했습니다.' });
      }
    });

    // 관전자 채팅 (관전자들끼리만)
    socket.on('spectator_chat', (data) => {
      try {
        const spectator = this.getSpectatorBySocketId(socket.id);
        if (!spectator) return;

        const message = {
          id: `msg_${Date.now()}`,
          spectatorId: spectator.id,
          spectatorName: spectator.info.name,
          text: data.text,
          timestamp: Date.now(),
          type: 'spectator'
        };

        // 같은 배틀의 관전자들에게만 전송
        socket.to(`spectators_${spectator.battleId}`).emit('spectator_chat_message', message);
        socket.emit('spectator_chat_message', message);

      } catch (error) {
        logger.error('Error handling spectator chat:', error);
      }
    });

    // 배틀 상태 요청
    socket.on('get_spectator_battle_state', (data) => {
      try {
        const { battleId } = data;
        const battle = this.battleEngine.getBattle(battleId);
        
        if (!battle) {
          socket.emit('error', { message: '존재하지 않는 배틀입니다.' });
          return;
        }

        const spectatorBattleState = this.getSpectatorBattleState(battle);
        socket.emit('spectator_battle_state', spectatorBattleState);

      } catch (error) {
        logger.error('Error getting spectator battle state:', error);
        socket.emit('error', { message: '배틀 상태 조회 중 오류가 발생했습니다.' });
      }
    });

    // 관전자 연결 해제
    socket.on('disconnect', () => {
      this.handleSpectatorDisconnect(socket.id);
    });
  }

  // 관전자용 배틀 상태 생성 (민감한 정보 제외)
  getSpectatorBattleState(battle) {
    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      currentTurn: battle.currentTurn,
      currentPlayerIndex: battle.currentPlayerIndex,
      currentTeam: battle.currentTeam,
      
      // 팀 정보 (공개 정보만)
      teams: {
        team1: {
          players: battle.teams.team1.players.map(player => ({
            id: player.id,
            name: player.name,
            characterImage: player.characterImage,
            hp: player.hp,
            maxHp: player.maxHp,
            attack: player.attack,
            defense: player.defense,
            agility: player.agility,
            isAlive: player.isAlive,
            activeEffects: player.activeEffects || {},
            // 아이템 정보는 제외 (비밀)
          })),
          name: battle.teams.team1.name
        },
        team2: {
          players: battle.teams.team2.players.map(player => ({
            id: player.id,
            name: player.name,
            characterImage: player.characterImage,
            hp: player.hp,
            maxHp: player.maxHp,
            attack: player.attack,
            defense: player.defense,
            agility: player.agility,
            isAlive: player.isAlive,
            activeEffects: player.activeEffects || {},
            // 아이템 정보는 제외 (비밀)
          })),
          name: battle.teams.team2.name
        }
      },

      // 공개 로그 (아이템 사용 로그는 일부 숨김)
      logs: (battle.logs || []).map(log => {
        if (log.type === 'item_use') {
          return {
            ...log,
            text: `${log.playerName}이(가) 아이템을 사용했습니다.` // 구체적인 아이템명 숨김
          };
        }
        return log;
      }),

      // 설정 정보
      settings: {
        turnTimeLimit: battle.settings?.turnTimeLimit,
        maxTurns: battle.settings?.maxTurns,
        itemsEnabled: battle.settings?.itemsEnabled,
        characterImagesEnabled: battle.settings?.characterImagesEnabled
      },

      // 관전자 정보
      spectatorCount: battle.spectators?.size || 0,
      
      winner: battle.winner,
      createdAt: battle.createdAt,
      startedAt: battle.startedAt,
      finishedAt: battle.finishedAt
    };
  }

  // 소켓 ID로 관전자 찾기
  getSpectatorBySocketId(socketId) {
    for (const [spectatorId, spectator] of this.spectators.entries()) {
      if (spectator.socketId === socketId) {
        return {
          id: spectatorId,
          ...spectator
        };
      }
    }
    return null;
  }

  // 관전자 연결 해제 처리
  handleSpectatorDisconnect(socketId) {
    const spectator = this.getSpectatorBySocketId(socketId);
    if (!spectator) return;

    try {
      const battle = this.battleEngine.getBattle(spectator.battleId);
      
      if (battle && battle.spectators) {
        // 배틀에서 관전자 제거
        battle.spectators.delete(spectator.id);

        // 다른 관전자들에게 알림
        this.io.to(`spectators_${spectator.battleId}`).emit('spectator_update', {
          type: 'left',
          spectator: {
            id: spectator.id,
            name: spectator.info.name
          },
          spectatorCount: battle.spectators.size
        });

        // 배틀 참가자들에게 관전자 수 업데이트
        this.io.to(`battle_${spectator.battleId}`).emit('spectator_count_updated', {
          spectatorCount: battle.spectators.size
        });
      }

      // 메모리에서 관전자 제거
      this.spectators.delete(spectator.id);

      logger.info(`Spectator ${spectator.id} disconnected from battle ${spectator.battleId}`);

    } catch (error) {
      logger.error('Error handling spectator disconnect:', error);
    }
  }

  // 배틀 업데이트를 관전자들에게 브로드캐스트
  broadcastToSpectators(battleId, event, data) {
    try {
      const battle = this.battleEngine.getBattle(battleId);
      if (!battle) return;

      // 관전자용 데이터 생성
      let spectatorData = data;
      
      // 배틀 상태 업데이트의 경우 민감한 정보 제거
      if (event === 'battle_updated' && data.battle) {
        spectatorData = {
          ...data,
          battle: this.getSpectatorBattleState(data.battle)
        };
      }

      // 액션 결과에서 민감한 정보 제거
      if (event === 'action_result' && data.result?.type === 'use_item') {
        spectatorData = {
          ...data,
          result: {
            ...data.result,
            item: {
              name: '아이템', // 구체적인 아이템명 숨김
              type: 'hidden'
            }
          }
        };
      }

      this.io.to(`spectators_${battleId}`).emit(`spectator_${event}`, spectatorData);

    } catch (error) {
      logger.error('Error broadcasting to spectators:', error);
    }
  }

  // 특정 배틀의 관전자 목록 조회
  getSpectatorsByBattleId(battleId) {
    const spectators = [];
    for (const [spectatorId, spectator] of this.spectators.entries()) {
      if (spectator.battleId === battleId) {
        spectators.push({
          id: spectatorId,
          name: spectator.info.name,
          joinedAt: spectator.info.joinedAt
        });
      }
    }
    return spectators;
  }

  // 통계 정보
  getStats() {
    const battleSpectatorCounts = new Map();
    
    for (const [spectatorId, spectator] of this.spectators.entries()) {
      const count = battleSpectatorCounts.get(spectator.battleId) || 0;
      battleSpectatorCounts.set(spectator.battleId, count + 1);
    }

    return {
      totalSpectators: this.spectators.size,
      battleSpectatorCounts: Object.fromEntries(battleSpectatorCounts),
      averageSpectatorsPerBattle: this.spectators.size / Math.max(battleSpectatorCounts.size, 1)
    };
  }
}

module.exports = SpectatorSocketHandler;
