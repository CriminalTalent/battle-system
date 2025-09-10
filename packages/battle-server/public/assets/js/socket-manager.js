// PYXIS Battle System - 완전 수정된 소켓 핸들러
// 채팅 기능, 플레이어 데이터 동기화, 실시간 업데이트 완전 구현

const socketIo = require('socket.io');

class PyxisSocketManager {
  constructor(server, battleManager) {
    this.battleManager = battleManager;
    this.io = socketIo(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.connections = new Map(); // socket.id -> connection info
    this.playerSockets = new Map(); // playerId -> socket
    this.adminSockets = new Map(); // battleId -> Set<socket>
    this.spectatorSockets = new Map(); // battleId -> Set<socket>

    this.setupEventHandlers();
    console.log('PYXIS Socket Manager 초기화 완료');
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`소켓 연결: ${socket.id}`);
      
      // 연결 정보 저장
      this.connections.set(socket.id, {
        type: 'unknown',
        battleId: null,
        playerId: null,
        playerName: null,
        connectedAt: new Date()
      });

      // 관리자 인증
      socket.on('admin:auth', (data) => {
        this.handleAdminAuth(socket, data);
      });

      // 플레이어 인증
      socket.on('player:auth', (data) => {
        this.handlePlayerAuth(socket, data);
      });

      // 관전자 인증
      socket.on('spectator:auth', (data) => {
        this.handleSpectatorAuth(socket, data);
      });

      // 플레이어 액션들
      socket.on('player:ready', (data) => {
        this.handlePlayerReady(socket, data);
      });

      socket.on('player:action', (data) => {
        this.handlePlayerAction(socket, data);
      });

      socket.on('player:chat', (data) => {
        this.handlePlayerChat(socket, data);
      });

      // 관리자 액션들
      socket.on('admin:create_battle', (data) => {
        this.handleCreateBattle(socket, data);
      });

      socket.on('admin:add_player', (data) => {
        this.handleAddPlayer(socket, data);
      });

      socket.on('admin:start_battle', (data) => {
        this.handleStartBattle(socket, data);
      });

      socket.on('admin:end_battle', (data) => {
        this.handleEndBattle(socket, data);
      });

      socket.on('admin:chat', (data) => {
        this.handleAdminChat(socket, data);
      });

      // 관전자 액션들
      socket.on('spectator:cheer', (data) => {
        this.handleSpectatorCheer(socket, data);
      });

      socket.on('spectator:chat', (data) => {
        this.handleSpectatorChat(socket, data);
      });

      // 연결 해제
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // 에러 처리
      socket.on('error', (error) => {
        console.error(`소켓 에러 [${socket.id}]:`, error);
      });
    });
  }

  // 관리자 인증
  handleAdminAuth(socket, data) {
    try {
      const { battleId } = data;
      
      if (!battleId) {
        socket.emit('auth:error', { message: '전투 ID가 필요합니다' });
        return;
      }

      const battle = this.battleManager.getBattle(battleId);
      if (!battle) {
        socket.emit('auth:error', { message: '존재하지 않는 전투입니다' });
        return;
      }

      // 관리자 소켓 등록
      if (!this.adminSockets.has(battleId)) {
        this.adminSockets.set(battleId, new Set());
      }
      this.adminSockets.get(battleId).add(socket);

      // 연결 정보 업데이트
      const connection = this.connections.get(socket.id);
      connection.type = 'admin';
      connection.battleId = battleId;

      // 소켓을 관리자 룸에 추가
      socket.join(`admin:${battleId}`);
      socket.join(`battle:${battleId}`);

      console.log(`관리자 인증 성공: ${socket.id} -> ${battleId}`);

      socket.emit('auth:success', {
        type: 'admin',
        battle: this.sanitizeBattleForAdmin(battle)
      });

      // 실시간 업데이트 시작
      this.sendAdminUpdate(battleId);

    } catch (error) {
      console.error('관리자 인증 에러:', error);
      socket.emit('auth:error', { message: '인증 중 오류가 발생했습니다' });
    }
  }

  // 플레이어 인증
  handlePlayerAuth(socket, data) {
    try {
      const { battleId, playerName, token } = data;

      if (!battleId || !playerName || !token) {
        socket.emit('auth:error', { message: '모든 필드를 입력해주세요' });
        return;
      }

      const battle = this.battleManager.getBattle(battleId);
      if (!battle) {
        socket.emit('auth:error', { message: '존재하지 않는 전투입니다' });
        return;
      }

      // 플레이어 찾기 및 토큰 검증
      const player = battle.players.find(p => 
        p.name === playerName && p.token === token
      );

      if (!player) {
        socket.emit('auth:error', { message: '잘못된 인증 정보입니다' });
        return;
      }

      if (player.isConnected) {
        socket.emit('auth:error', { message: '이미 접속 중인 플레이어입니다' });
        return;
      }

      // 기존 연결 해제 (재접속의 경우)
      if (this.playerSockets.has(player.id)) {
        const oldSocket = this.playerSockets.get(player.id);
        oldSocket.disconnect();
      }

      // 플레이어 소켓 등록
      this.playerSockets.set(player.id, socket);
      player.isConnected = true;
      player.lastConnectedAt = new Date();

      // 연결 정보 업데이트
      const connection = this.connections.get(socket.id);
      connection.type = 'player';
      connection.battleId = battleId;
      connection.playerId = player.id;
      connection.playerName = playerName;

      // 소켓을 룸에 추가
      socket.join(`player:${player.id}`);
      socket.join(`team:${battleId}:${player.team}`);
      socket.join(`battle:${battleId}`);

      console.log(`플레이어 인증 성공: ${playerName} (${player.id}) -> ${battleId}`);

      socket.emit('auth:success', {
        type: 'player',
        player: this.sanitizePlayerData(player),
        battle: this.sanitizeBattleForPlayer(battle, player)
      });

      // 다른 참가자들에게 알림
      this.broadcastToRoom(`battle:${battleId}`, 'player:connected', {
        playerId: player.id,
        playerName: player.name,
        team: player.team
      }, socket.id);

      // 관리자에게 업데이트
      this.sendAdminUpdate(battleId);

    } catch (error) {
      console.error('플레이어 인증 에러:', error);
      socket.emit('auth:error', { message: '인증 중 오류가 발생했습니다' });
    }
  }

  // 관전자 인증
  handleSpectatorAuth(socket, data) {
    try {
      const { battleId, spectatorName, token } = data;

      if (!battleId || !spectatorName) {
        socket.emit('auth:error', { message: '전투 ID와 닉네임이 필요합니다' });
        return;
      }

      const battle = this.battleManager.getBattle(battleId);
      if (!battle) {
        socket.emit('auth:error', { message: '존재하지 않는 전투입니다' });
        return;
      }

      // 관전자 토큰 검증 (있는 경우)
      if (token && battle.spectatorToken && battle.spectatorToken !== token) {
        socket.emit('auth:error', { message: '잘못된 관전자 토큰입니다' });
        return;
      }

      // 관전자 소켓 등록
      if (!this.spectatorSockets.has(battleId)) {
        this.spectatorSockets.set(battleId, new Set());
      }
      this.spectatorSockets.get(battleId).add(socket);

      // 연결 정보 업데이트
      const connection = this.connections.get(socket.id);
      connection.type = 'spectator';
      connection.battleId = battleId;
      connection.spectatorName = spectatorName;

      // 소켓을 룸에 추가
      socket.join(`spectator:${battleId}`);
      socket.join(`battle:${battleId}`);

      console.log(`관전자 인증 성공: ${spectatorName} -> ${battleId}`);

      socket.emit('auth:success', {
        type: 'spectator',
        spectatorName,
        battle: this.sanitizeBattleForSpectator(battle)
      });

      // 관전자 수 업데이트
      this.updateSpectatorCount(battleId);

    } catch (error) {
      console.error('관전자 인증 에러:', error);
      socket.emit('auth:error', { message: '인증 중 오류가 발생했습니다' });
    }
  }

  // 플레이어 준비
  handlePlayerReady(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'player') return;

      const battle = this.battleManager.getBattle(connection.battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === connection.playerId);
      if (!player) return;

      player.isReady = data.ready;

      console.log(`플레이어 준비 상태 변경: ${player.name} -> ${player.isReady}`);

      // 전투 참가자들에게 업데이트
      this.broadcastToRoom(`battle:${connection.battleId}`, 'player:ready_update', {
        playerId: player.id,
        playerName: player.name,
        isReady: player.isReady
      });

      // 관리자에게 업데이트
      this.sendAdminUpdate(connection.battleId);

      // 모든 플레이어가 준비되었는지 확인
      const allReady = battle.players.every(p => p.isReady);
      if (allReady && battle.status === 'waiting') {
        this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:all_ready', {
          message: '모든 플레이어가 준비 완료되었습니다!'
        });
      }

    } catch (error) {
      console.error('플레이어 준비 에러:', error);
    }
  }

  // 플레이어 액션
  handlePlayerAction(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'player') return;

      const battle = this.battleManager.getBattle(connection.battleId);
      if (!battle || battle.status !== 'active') return;

      const player = battle.players.find(p => p.id === connection.playerId);
      if (!player || !player.isAlive) return;

      // 현재 턴인지 확인
      if (battle.currentPlayerId !== player.id) {
        socket.emit('action:error', { message: '현재 당신의 턴이 아닙니다' });
        return;
      }

      console.log(`플레이어 액션: ${player.name} -> ${data.type}`);

      // 액션 실행
      const result = this.battleManager.executeAction(connection.battleId, player.id, data);

      if (result.success) {
        // 액션 로그 브로드캐스트
        if (result.logs) {
          result.logs.forEach(log => {
            this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:log', log);
          });
        }

        // 플레이어 상태 업데이트
        if (result.updates) {
          Object.keys(result.updates).forEach(playerId => {
            const updateData = result.updates[playerId];
            this.broadcastToRoom(`battle:${connection.battleId}`, 'player:update', {
              playerId,
              updates: updateData
            });
          });
        }

        // 턴 종료 확인
        if (result.turnEnded) {
          this.handleTurnEnd(connection.battleId);
        }

        // 전투 종료 확인
        if (result.battleEnded) {
          this.handleBattleEnd(connection.battleId, result.winner);
        }

      } else {
        socket.emit('action:error', { message: result.error || '액션을 실행할 수 없습니다' });
      }

    } catch (error) {
      console.error('플레이어 액션 에러:', error);
      socket.emit('action:error', { message: '액션 처리 중 오류가 발생했습니다' });
    }
  }

  // 플레이어 채팅
  handlePlayerChat(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'player') return;

      const { message } = data;
      if (!message || typeof message !== 'string') return;

      const cleanMessage = message.trim().substring(0, 200);
      if (!cleanMessage) return;

      const battle = this.battleManager.getBattle(connection.battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === connection.playerId);
      if (!player) return;

      const chatData = {
        type: 'player',
        senderId: player.id,
        senderName: player.name,
        senderTeam: player.team,
        message: cleanMessage,
        timestamp: new Date().toISOString()
      };

      console.log(`플레이어 채팅: ${player.name} -> ${cleanMessage}`);

      // 전체 전투 참가자에게 브로드캐스트
      this.broadcastToRoom(`battle:${connection.battleId}`, 'chat:message', chatData);

      // 채팅 로그에도 추가
      this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:log', {
        type: 'chat',
        message: `${player.name}: ${cleanMessage}`
      });

    } catch (error) {
      console.error('플레이어 채팅 에러:', error);
    }
  }

  // 관리자 채팅
  handleAdminChat(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'admin') return;

      const { message } = data;
      if (!message || typeof message !== 'string') return;

      const cleanMessage = message.trim().substring(0, 200);
      if (!cleanMessage) return;

      const chatData = {
        type: 'admin',
        senderId: 'admin',
        senderName: '관리자',
        message: cleanMessage,
        timestamp: new Date().toISOString()
      };

      console.log(`관리자 채팅: ${cleanMessage}`);

      // 전체 전투 참가자에게 브로드캐스트
      this.broadcastToRoom(`battle:${connection.battleId}`, 'chat:message', chatData);

      // 채팅 로그에도 추가
      this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:log', {
        type: 'chat',
        message: `관리자: ${cleanMessage}`
      });

    } catch (error) {
      console.error('관리자 채팅 에러:', error);
    }
  }

  // 관전자 응원
  handleSpectatorCheer(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'spectator') return;

      const { message } = data;
      if (!message || typeof message !== 'string') return;

      const cleanMessage = message.trim().substring(0, 100);
      if (!cleanMessage) return;

      const cheerData = {
        type: 'cheer',
        senderId: socket.id,
        senderName: connection.spectatorName || '관전자',
        message: cleanMessage,
        timestamp: new Date().toISOString()
      };

      console.log(`관전자 응원: ${connection.spectatorName} -> ${cleanMessage}`);

      // 전체 전투 참가자에게 브로드캐스트
      this.broadcastToRoom(`battle:${connection.battleId}`, 'spectator:cheer', cheerData);

      // 응원 로그에도 추가
      this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:log', {
        type: 'system',
        message: `${connection.spectatorName}: ${cleanMessage}`
      });

    } catch (error) {
      console.error('관전자 응원 에러:', error);
    }
  }

  // 관전자 채팅
  handleSpectatorChat(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'spectator') return;

      const { message } = data;
      if (!message || typeof message !== 'string') return;

      const cleanMessage = message.trim().substring(0, 200);
      if (!cleanMessage) return;

      const chatData = {
        type: 'spectator',
        senderId: socket.id,
        senderName: connection.spectatorName || '관전자',
        message: cleanMessage,
        timestamp: new Date().toISOString()
      };

      console.log(`관전자 채팅: ${connection.spectatorName} -> ${cleanMessage}`);

      // 관전자들에게만 브로드캐스트
      this.broadcastToRoom(`spectator:${connection.battleId}`, 'chat:message', chatData);

    } catch (error) {
      console.error('관전자 채팅 에러:', error);
    }
  }

  // 전투 생성
  handleCreateBattle(socket, data) {
    try {
      const { mode } = data;
      const battleId = this.battleManager.createBattle(mode);
      
      console.log(`전투 생성: ${battleId} (${mode})`);

      socket.emit('battle:created', { battleId });

      // 관리자 인증 자동 처리
      this.handleAdminAuth(socket, { battleId });

    } catch (error) {
      console.error('전투 생성 에러:', error);
      socket.emit('battle:error', { message: '전투 생성 중 오류가 발생했습니다' });
    }
  }

  // 플레이어 추가
  handleAddPlayer(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'admin') return;

      const player = this.battleManager.addPlayer(connection.battleId, data);
      
      console.log(`플레이어 추가: ${player.name} -> ${connection.battleId}`);

      // 관리자에게 업데이트
      this.sendAdminUpdate(connection.battleId);

      socket.emit('player:added', { player: this.sanitizePlayerData(player) });

    } catch (error) {
      console.error('플레이어 추가 에러:', error);
      socket.emit('player:error', { message: error.message || '플레이어 추가 중 오류가 발생했습니다' });
    }
  }

  // 전투 시작
  handleStartBattle(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'admin') return;

      const result = this.battleManager.startBattle(connection.battleId);
      
      console.log(`전투 시작: ${connection.battleId}`);

      // 전체 참가자에게 알림
      this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:started', {
        battle: this.sanitizeBattleForPlayer(result.battle),
        firstTeam: result.firstTeam,
        message: `전투가 시작되었습니다! ${result.firstTeam} 팀이 선공입니다.`
      });

      // 첫 턴 시작
      this.startNextTurn(connection.battleId);

      // 관리자에게 업데이트
      this.sendAdminUpdate(connection.battleId);

    } catch (error) {
      console.error('전투 시작 에러:', error);
      socket.emit('battle:error', { message: error.message || '전투 시작 중 오류가 발생했습니다' });
    }
  }

  // 전투 종료
  handleEndBattle(socket, data) {
    try {
      const connection = this.connections.get(socket.id);
      if (connection.type !== 'admin') return;

      this.battleManager.endBattle(connection.battleId);
      
      console.log(`전투 종료: ${connection.battleId}`);

      // 전체 참가자에게 알림
      this.broadcastToRoom(`battle:${connection.battleId}`, 'battle:ended', {
        reason: 'admin',
        message: '관리자에 의해 전투가 종료되었습니다.'
      });

      // 관리자에게 업데이트
      this.sendAdminUpdate(connection.battleId);

    } catch (error) {
      console.error('전투 종료 에러:', error);
      socket.emit('battle:error', { message: '전투 종료 중 오류가 발생했습니다' });
    }
  }

  // 턴 종료 처리
  handleTurnEnd(battleId) {
    try {
      const battle = this.battleManager.getBattle(battleId);
      if (!battle || battle.status !== 'active') return;

      // 현재 턴 종료 이벤트
      this.broadcastToRoom(`battle:${battleId}`, 'turn:end', {
        playerId: battle.currentPlayerId
      });

      // 다음 턴 시작
      setTimeout(() => {
        this.startNextTurn(battleId);
      }, 1000);

    } catch (error) {
      console.error('턴 종료 처리 에러:', error);
    }
  }

  // 다음 턴 시작
  startNextTurn(battleId) {
    try {
      const battle = this.battleManager.getBattle(battleId);
      if (!battle || battle.status !== 'active') return;

      const nextPlayer = this.battleManager.getNextPlayer(battleId);
      if (!nextPlayer) {
        console.log('다음 플레이어를 찾을 수 없음');
        return;
      }

      battle.currentPlayerId = nextPlayer.id;
      battle.turnStartTime = Date.now();
      battle.turnNumber = (battle.turnNumber || 0) + 1;

      console.log(`다음 턴 시작: ${nextPlayer.name} (턴 ${battle.turnNumber})`);

      // 턴 시작 이벤트
      this.broadcastToRoom(`battle:${battleId}`, 'turn:start', {
        playerId: nextPlayer.id,
        playerName: nextPlayer.name,
        playerTeam: nextPlayer.team,
        turnNumber: battle.turnNumber,
        timeLimit: 300000, // 5분
        timeLeft: 300000
      });

      // 턴 타이머 설정 (5분)
      if (battle.turnTimer) {
        clearTimeout(battle.turnTimer);
      }

      battle.turnTimer = setTimeout(() => {
        this.handleTurnTimeout(battleId, nextPlayer.id);
      }, 300000); // 5분

      // 관리자에게 업데이트
      this.sendAdminUpdate(battleId);

    } catch (error) {
      console.error('다음 턴 시작 에러:', error);
    }
  }

  // 턴 타임아웃 처리
  handleTurnTimeout(battleId, playerId) {
    try {
      const battle = this.battleManager.getBattle(battleId);
      if (!battle || battle.currentPlayerId !== playerId) return;

      console.log(`턴 타임아웃: ${playerId}`);

      // 자동 패스 처리
      this.broadcastToRoom(`battle:${battleId}`, 'battle:log', {
        type: 'system',
        message: '시간 초과로 자동 패스되었습니다.'
      });

      // 턴 종료
      this.handleTurnEnd(battleId);

    } catch (error) {
      console.error('턴 타임아웃 처리 에러:', error);
    }
  }

  // 전투 종료 처리
  handleBattleEnd(battleId, winner) {
    try {
      const battle = this.battleManager.getBattle(battleId);
      if (!battle) return;

      battle.status = 'ended';
      battle.endedAt = new Date();
      battle.winner = winner;

      if (battle.turnTimer) {
        clearTimeout(battle.turnTimer);
        battle.turnTimer = null;
      }

      console.log(`전투 종료: ${battleId}, 승자: ${winner}`);

      // 전체 참가자에게 알림
      this.broadcastToRoom(`battle:${battleId}`, 'battle:ended', {
        winner,
        battle: this.sanitizeBattleForPlayer(battle),
        message: winner ? `${winner} 팀의 승리입니다!` : '무승부입니다!'
      });

      // 관리자에게 업데이트
      this.sendAdminUpdate(battleId);

    } catch (error) {
      console.error('전투 종료 처리 에러:', error);
    }
  }

  // 연결 해제 처리
  handleDisconnect(socket) {
    try {
      const connection = this.connections.get(socket.id);
      if (!connection) return;

      console.log(`소켓 연결 해제: ${socket.id} (${connection.type})`);

      if (connection.type === 'player' && connection.playerId) {
        // 플레이어 연결 해제
        this.playerSockets.delete(connection.playerId);
        
        const battle = this.battleManager.getBattle(connection.battleId);
        if (battle) {
          const player = battle.players.find(p => p.id === connection.playerId);
          if (player) {
            player.isConnected = false;
            player.lastDisconnectedAt = new Date();

            // 다른 참가자들에게 알림
            this.broadcastToRoom(`battle:${connection.battleId}`, 'player:disconnected', {
              playerId: player.id,
              playerName: player.name
            });

            // 관리자에게 업데이트
            this.sendAdminUpdate(connection.battleId);
          }
        }

      } else if (connection.type === 'admin' && connection.battleId) {
        // 관리자 연결 해제
        const adminSockets = this.adminSockets.get(connection.battleId);
        if (adminSockets) {
          adminSockets.delete(socket);
          if (adminSockets.size === 0) {
            this.adminSockets.delete(connection.battleId);
          }
        }

      } else if (connection.type === 'spectator' && connection.battleId) {
        // 관전자 연결 해제
        const spectatorSockets = this.spectatorSockets.get(connection.battleId);
        if (spectatorSockets) {
          spectatorSockets.delete(socket);
          if (spectatorSockets.size === 0) {
            this.spectatorSockets.delete(connection.battleId);
          }
        }
        this.updateSpectatorCount(connection.battleId);
      }

      // 연결 정보 제거
      this.connections.delete(socket.id);

    } catch (error) {
      console.error('연결 해제 처리 에러:', error);
    }
  }

  // 브로드캐스트 헬퍼
  broadcastToRoom(room, event, data, excludeSocketId = null) {
    try {
      const sockets = this.io.to(room);
      if (excludeSocketId) {
        sockets.except(excludeSocketId);
      }
      sockets.emit(event, data);
    } catch (error) {
      console.error('브로드캐스트 에러:', error);
    }
  }

  // 관리자 업데이트 전송
  sendAdminUpdate(battleId) {
    try {
      const battle = this.battleManager.getBattle(battleId);
      if (!battle) return;

      const adminSockets = this.adminSockets.get(battleId);
      if (!adminSockets || adminSockets.size === 0) return;

      const updateData = {
        battle: this.sanitizeBattleForAdmin(battle),
        statistics: this.getStatistics(battleId)
      };

      adminSockets.forEach(socket => {
        socket.emit('admin:update', updateData);
      });

    } catch (error) {
      console.error('관리자 업데이트 전송 에러:', error);
    }
  }

  // 관전자 수 업데이트
  updateSpectatorCount(battleId) {
    try {
      const spectatorSockets = this.spectatorSockets.get(battleId);
      const count = spectatorSockets ? spectatorSockets.size : 0;

      this.broadcastToRoom(`battle:${battleId}`, 'spectator:count_update', { count });

    } catch (error) {
      console.error('관전자 수 업데이트 에러:', error);
    }
  }

  // 데이터 정리 함수들
  sanitizeBattleForAdmin(battle) {
    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      players: battle.players.map(p => this.sanitizePlayerData(p)),
      currentPlayerId: battle.currentPlayerId,
      currentTeam: battle.currentTeam,
      turnNumber: battle.turnNumber || 0,
      turnStartTime: battle.turnStartTime,
      createdAt: battle.createdAt,
      startedAt: battle.startedAt,
      endedAt: battle.endedAt,
      winner: battle.winner,
      logs: battle.logs || []
    };
  }

  sanitizeBattleForPlayer(battle, player = null) {
    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      players: battle.players.map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        hp: p.hp,
        maxHp: p.maxHp,
        isAlive: p.isAlive,
        isConnected: p.isConnected,
        isReady: p.isReady,
        avatar: p.avatar,
        stats: p.stats
      })),
      currentPlayerId: battle.currentPlayerId,
      currentTeam: battle.currentTeam,
      turnNumber: battle.turnNumber || 0,
      winner: battle.winner
    };
  }

  sanitizeBattleForSpectator(battle) {
    return this.sanitizeBattleForPlayer(battle);
  }

  sanitizePlayerData(player) {
    return {
      id: player.id,
      name: player.name,
      team: player.team,
      hp: player.hp,
      maxHp: player.maxHp,
      stats: player.stats,
      items: player.items,
      avatar: player.avatar,
      isAlive: player.isAlive,
      isConnected: player.isConnected,
      isReady: player.isReady,
      token: player.token,
      effects: player.effects || []
    };
  }

  // 통계 수집
  getStatistics(battleId) {
    try {
      const battle = this.battleManager.getBattle(battleId);
      if (!battle) return {};

      const playerSockets = this.playerSockets.size;
      const spectatorSockets = this.spectatorSockets.get(battleId)?.size || 0;
      const adminSockets = this.adminSockets.get(battleId)?.size || 0;

      return {
        connectedPlayers: battle.players.filter(p => p.isConnected).length,
        totalPlayers: battle.players.length,
        spectators: spectatorSockets,
        admins: adminSockets,
        turnNumber: battle.turnNumber || 0,
        uptime: battle.startedAt ? Date.now() - new Date(battle.startedAt).getTime() : 0
      };

    } catch (error) {
      console.error('통계 수집 에러:', error);
      return {};
    }
  }

  // 서버 상태 조회
  getServerStatus() {
    return {
      totalConnections: this.connections.size,
      playerConnections: Array.from(this.connections.values()).filter(c => c.type === 'player').length,
      adminConnections: Array.from(this.connections.values()).filter(c => c.type === 'admin').length,
      spectatorConnections: Array.from(this.connections.values()).filter(c => c.type === 'spectator').length,
      activeBattles: this.battleManager.getActiveBattles().length,
      totalBattles: this.battleManager.getAllBattles().length
    };
  }
}

module.exports = PyxisSocketManager;
