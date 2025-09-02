// packages/battle-server/src/socket/socketHandlers.js
// PYXIS Socket.IO 핸들러 - 실시간 전투 통신

const BattleEngine = require('../engine/BattleEngine');

class SocketHandlers {
  constructor(io) {
    this.io = io;
    this.battles = new Map(); // battleId -> BattleEngine
    this.connections = new Map(); // socketId -> connectionInfo
    this.battleConnections = new Map(); // battleId -> Set<socketId>
    
    this.setupHandlers();
  }

  setupHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[Socket] New connection: ${socket.id}`);
      
      // 연결 정보 초기화
      this.connections.set(socket.id, {
        socket,
        role: null, // admin, player, spectator
        battleId: null,
        playerId: null,
        playerName: null,
        spectatorName: null,
        team: null,
        authenticated: false,
        connectedAt: Date.now()
      });

      // ═══════════════════════════════════════════════════════════════════
      // 인증 및 세션 관리
      // ═══════════════════════════════════════════════════════════════════
      
      socket.on('auth:login', async (data) => {
        try {
          await this.handleAuth(socket, data);
        } catch (error) {
          socket.emit('auth:error', { message: error.message });
        }
      });

      socket.on('session:init', async (data) => {
        try {
          await this.handleSessionInit(socket, data);
        } catch (error) {
          socket.emit('session:error', { message: error.message });
        }
      });

      // ═══════════════════════════════════════════════════════════════════
      // 관리자 기능
      // ═══════════════════════════════════════════════════════════════════
      
      socket.on('admin:create_battle', (data) => {
        try {
          this.handleCreateBattle(socket, data);
        } catch (error) {
          socket.emit('admin:error', { message: error.message });
        }
      });

      socket.on('admin:add_player', (data) => {
        try {
          this.handleAddPlayer(socket, data);
        } catch (error) {
          socket.emit('admin:error', { message: error.message });
        }
      });

      socket.on('admin:start_battle', (data) => {
        try {
          this.handleStartBattle(socket, data);
        } catch (error) {
          socket.emit('admin:error', { message: error.message });
        }
      });

      socket.on('admin:end_battle', (data) => {
        try {
          this.handleEndBattle(socket, data);
        } catch (error) {
          socket.emit('admin:error', { message: error.message });
        }
      });

      socket.on('admin:remove_player', (data) => {
        try {
          this.handleRemovePlayer(socket, data);
        } catch (error) {
          socket.emit('admin:error', { message: error.message });
        }
      });

      // ═══════════════════════════════════════════════════════════════════
      // 플레이어 액션
      // ═══════════════════════════════════════════════════════════════════
      
      socket.on('player:action', (data) => {
        try {
          this.handlePlayerAction(socket, data);
        } catch (error) {
          socket.emit('player:error', { message: error.message });
        }
      });

      socket.on('player:get_targets', (data) => {
        try {
          this.handleGetTargets(socket, data);
        } catch (error) {
          socket.emit('player:error', { message: error.message });
        }
      });

      // ═══════════════════════════════════════════════════════════════════
      // 채팅 및 소통
      // ═══════════════════════════════════════════════════════════════════
      
      socket.on('chat:send', (data) => {
        try {
          this.handleChatMessage(socket, data);
        } catch (error) {
          socket.emit('chat:error', { message: error.message });
        }
      });

      socket.on('spectator:cheer', (data) => {
        try {
          this.handleSpectatorCheer(socket, data);
        } catch (error) {
          socket.emit('spectator:error', { message: error.message });
        }
      });

      // ═══════════════════════════════════════════════════════════════════
      // 연결 해제
      // ═══════════════════════════════════════════════════════════════════
      
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 인증 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  async handleAuth(socket, data) {
    const { role, battleId, otp, playerName, spectatorName } = data;
    const conn = this.connections.get(socket.id);
    
    if (!conn) {
      throw new Error('Connection not found');
    }

    // OTP 검증 (실제로는 데이터베이스나 캐시에서 확인)
    // 여기서는 간단히 시뮬레이션
    if (!this.validateOTP(battleId, otp, role)) {
      throw new Error('Invalid OTP or expired');
    }

    conn.role = role;
    conn.battleId = battleId;
    conn.authenticated = true;

    if (role === 'player') {
      conn.playerName = playerName;
      // 플레이어 ID는 전투 엔진에서 찾아야 함
      const battle = this.battles.get(battleId);
      if (battle) {
        const player = battle.getAllPlayers().find(p => p.name === playerName);
        if (player) {
          conn.playerId = player.id;
          conn.team = player.team;
        }
      }
    } else if (role === 'spectator') {
      conn.spectatorName = spectatorName || `관전자${Date.now()}`;
    }

    // 전투별 연결 추가
    if (!this.battleConnections.has(battleId)) {
      this.battleConnections.set(battleId, new Set());
    }
    this.battleConnections.get(battleId).add(socket.id);

    // 방 참여
    socket.join(`battle:${battleId}`);
    socket.join(`battle:${battleId}:${role}`);

    socket.emit('auth:success', {
      role,
      battleId,
      playerId: conn.playerId,
      playerName: conn.playerName,
      spectatorName: conn.spectatorName,
      team: conn.team
    });

    // 초기 데이터 전송
    this.sendInitialData(socket, battleId, role);
  }

  async handleSessionInit(socket, data) {
    // URL 파라미터에서 자동 인증
    await this.handleAuth(socket, data);
  }

  validateOTP(battleId, otp, role) {
    // 실제로는 Redis나 DB에서 OTP 검증
    // 여기서는 간단히 시뮬레이션
    return otp && otp.length >= 6;
  }

  sendInitialData(socket, battleId, role) {
    const battle = this.battles.get(battleId);
    if (!battle) return;

    // 게임 상태 전송
    socket.emit('state:update', battle.getGameState());
    
    // 로그 전송
    socket.emit('log:bootstrap', battle.getLogs(100));
    
    // 역할별 추가 데이터
    if (role === 'admin') {
      // 관리자용 상세 정보
      socket.emit('admin:battle_details', {
        connections: this.getConnectionStats(battleId),
        systemInfo: this.getSystemInfo()
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 관리자 기능 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  handleCreateBattle(socket, data) {
    const { mode = '2v2' } = data;
    const battleId = this.generateBattleId();
    
    const battle = new BattleEngine(battleId, mode);
    this.battles.set(battleId, battle);
    
    // 전투 엔진 이벤트 리스너 설정
    this.setupBattleEngineEvents(battle);
    
    const conn = this.connections.get(socket.id);
    if (conn) {
      conn.battleId = battleId;
      conn.role = 'admin';
      conn.authenticated = true;
    }

    if (!this.battleConnections.has(battleId)) {
      this.battleConnections.set(battleId, new Set());
    }
    this.battleConnections.get(battleId).add(socket.id);

    socket.join(`battle:${battleId}`);
    socket.join(`battle:${battleId}:admin`);

    socket.emit('admin:battle_created', {
      battleId,
      mode,
      status: battle.status,
      settings: battle.settings
    });

    console.log(`[Battle] Created battle ${battleId} (${mode})`);
  }

  handleAddPlayer(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'admin' || !conn.battleId) {
      throw new Error('Unauthorized');
    }

    const battle = this.battles.get(conn.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    const player = battle.addPlayer(data);
    
    // 모든 참가자에게 업데이트 브로드캐스트
    this.broadcastToRoom(`battle:${conn.battleId}`, 'state:update', battle.getGameState());
    
    socket.emit('admin:player_added', { player });
  }

  handleStartBattle(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'admin' || !conn.battleId) {
      throw new Error('Unauthorized');
    }

    const battle = this.battles.get(conn.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    battle.startBattle();
    
    socket.emit('admin:battle_started', { battleId: conn.battleId });
  }

  handleEndBattle(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'admin' || !conn.battleId) {
      throw new Error('Unauthorized');
    }

    const battle = this.battles.get(conn.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    const result = battle.endBattle('admin_ended');
    
    socket.emit('admin:battle_ended', { result });
  }

  handleRemovePlayer(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'admin' || !conn.battleId) {
      throw new Error('Unauthorized');
    }

    const battle = this.battles.get(conn.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    const removed = battle.removePlayer(data.playerId);
    if (removed) {
      this.broadcastToRoom(`battle:${conn.battleId}`, 'state:update', battle.getGameState());
      socket.emit('admin:player_removed', { playerId: data.playerId });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 플레이어 액션 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  handlePlayerAction(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'player' || !conn.authenticated || !conn.playerId) {
      throw new Error('Unauthorized');
    }

    const battle = this.battles.get(conn.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    const result = battle.submitAction(conn.playerId, data);
    
    socket.emit('player:action_result', result);
    
    // 상태 업데이트 브로드캐스트
    this.broadcastToRoom(`battle:${conn.battleId}`, 'state:update', battle.getGameState());
  }

  handleGetTargets(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'player' || !conn.playerId) {
      throw new Error('Unauthorized');
    }

    const battle = this.battles.get(conn.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    const player = battle.getPlayer(conn.playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    let targets = [];
    
    switch (data.actionType) {
      case 'attack':
        // 적팀 생존자들
        targets = battle.getAlivePlayers().filter(p => p.team !== player.team);
        break;
      case 'defend':
        // 적팀 생존자들 (역공격 대상)
        targets = battle.getAlivePlayers().filter(p => p.team !== player.team);
        break;
      case 'item':
        if (data.itemType === 'dittany') {
          // 아군만 (자신 포함)
          targets = battle.getAlivePlayers().filter(p => p.team === player.team);
        }
        break;
    }

    socket.emit('player:targets', {
      actionType: data.actionType,
      targets: targets.map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        hp: p.status.hp,
        maxHp: p.status.maxHp,
        isAlive: p.status.isAlive
      }))
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 채팅 및 소통
  // ═══════════════════════════════════════════════════════════════════════
  
  handleChatMessage(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || !conn.authenticated) {
      throw new Error('Unauthorized');
    }

    const { text, channel = 'all' } = data;
    
    if (!text || text.trim().length === 0) {
      throw new Error('Empty message');
    }

    if (text.length > 200) {
      throw new Error('Message too long');
    }

    const message = {
      id: this.generateMessageId(),
      text: text.trim(),
      channel,
      sender: {
        role: conn.role,
        name: conn.playerName || conn.spectatorName || '익명',
        playerId: conn.playerId,
        team: conn.team
      },
      timestamp: Date.now()
    };

    // 채널별 브로드캐스트
    switch (channel) {
      case 'team':
        if (conn.role === 'player' && conn.team) {
          // 같은 팀 + 관리자에게만
          this.broadcastToTeam(conn.battleId, conn.team, 'chat:message', message);
          this.broadcastToRole(conn.battleId, 'admin', 'chat:message', message);
        }
        break;
      case 'all':
      default:
        // 전체에게
        this.broadcastToRoom(`battle:${conn.battleId}`, 'chat:message', message);
        break;
    }

    // 로그에 추가
    const battle = this.battles.get(conn.battleId);
    if (battle) {
      battle.addLog('chat', `[${channel.toUpperCase()}] ${message.sender.name}: ${text}`, message);
    }
  }

  handleSpectatorCheer(socket, data) {
    const conn = this.connections.get(socket.id);
    if (!conn || conn.role !== 'spectator' || !conn.authenticated) {
      throw new Error('Unauthorized');
    }

    const { message, type = 'custom' } = data;
    
    if (!message || message.trim().length === 0) {
      throw new Error('Empty cheer message');
    }

    if (message.length > 100) {
      throw new Error('Cheer message too long');
    }

    const cheer = {
      id: this.generateMessageId(),
      message: message.trim(),
      type,
      spectator: conn.spectatorName,
      timestamp: Date.now()
    };

    // 전체에게 브로드캐스트
    this.broadcastToRoom(`battle:${conn.battleId}`, 'spectator:cheer', cheer);

    // 로그에 추가
    const battle = this.battles.get(conn.battleId);
    if (battle) {
      battle.addLog('cheer', `[응원] ${conn.spectatorName}: ${message}`, cheer);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 전투 엔진 이벤트 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  setupBattleEngineEvents(battle) {
    const battleId = battle.battleId;

    battle.on('battle:started', (data) => {
      this.broadcastToRoom(`battle:${battleId}`, 'battle:started', data);
    });

    battle.on('battle:ended', (data) => {
      this.broadcastToRoom(`battle:${battleId}`, 'battle:ended', data);
    });

    battle.on('turn:started', (data) => {
      this.broadcastToRoom(`battle:${battleId}`, 'turn:started', data);
      this.broadcastToRoom(`battle:${battleId}`, 'state:update', battle.getGameState());
    });

    battle.on('turn:ended', (data) => {
      this.broadcastToRoom(`battle:${battleId}`, 'turn:ended', data);
    });

    battle.on('action:submitted', (data) => {
      this.broadcastToRoom(`battle:${battleId}`, 'action:submitted', data);
    });

    battle.on('log:new', (log) => {
      this.broadcastToRoom(`battle:${battleId}`, 'log:new', log);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 브로드캐스트 헬퍼
  // ═══════════════════════════════════════════════════════════════════════
  
  broadcastToRoom(room, event, data) {
    this.io.to(room).emit(event, data);
  }

  broadcastToRole(battleId, role, event, data) {
    this.io.to(`battle:${battleId}:${role}`).emit(event, data);
  }

  broadcastToTeam(battleId, team, event, data) {
    const connections = this.battleConnections.get(battleId);
    if (!connections) return;

    connections.forEach(socketId => {
      const conn = this.connections.get(socketId);
      if (conn && conn.team === team) {
        conn.socket.emit(event, data);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 연결 해제 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  handleDisconnect(socket) {
    const conn = this.connections.get(socket.id);
    if (!conn) return;

    console.log(`[Socket] Disconnection: ${socket.id} (${conn.role})`);

    // 전투별 연결에서 제거
    if (conn.battleId) {
      const battleConnections = this.battleConnections.get(conn.battleId);
      if (battleConnections) {
        battleConnections.delete(socket.id);
        
        // 연결이 없으면 전투 정리 (관리자가 없는 경우)
        if (battleConnections.size === 0) {
          setTimeout(() => {
            this.cleanupBattle(conn.battleId);
          }, 30000); // 30초 후 정리
        }
      }
    }

    // 플레이어 연결 해제 알림
    if (conn.role === 'player' && conn.battleId && conn.playerName) {
      this.broadcastToRoom(`battle:${conn.battleId}`, 'player:disconnected', {
        playerId: conn.playerId,
        playerName: conn.playerName,
        team: conn.team
      });
    }

    // 연결 정보 제거
    this.connections.delete(socket.id);
  }

  cleanupBattle(battleId) {
    const battle = this.battles.get(battleId);
    if (battle) {
      battle.destroy();
      this.battles.delete(battleId);
      this.battleConnections.delete(battleId);
      console.log(`[Battle] Cleaned up battle ${battleId}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 유틸리티
  // ═══════════════════════════════════════════════════════════════════════
  
  generateBattleId() {
    return 'B' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  generateMessageId() {
    return 'M' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  getConnectionStats(battleId) {
    const connections = this.battleConnections.get(battleId);
    if (!connections) return { total: 0, byRole: {} };

    const stats = { total: connections.size, byRole: {} };
    
    connections.forEach(socketId => {
      const conn = this.connections.get(socketId);
      if (conn) {
        stats.byRole[conn.role] = (stats.byRole[conn.role] || 0) + 1;
      }
    });

    return stats;
  }

  getSystemInfo() {
    return {
      totalBattles: this.battles.size,
      totalConnections: this.connections.size,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 관리자 전용 기능
  // ═══════════════════════════════════════════════════════════════════════
  
  getBattleList() {
    return Array.from(this.battles.values()).map(battle => ({
      battleId: battle.battleId,
      mode: battle.mode,
      status: battle.status,
      created: battle.created,
      started: battle.started,
      playerCount: battle.getAllPlayers().length,
      connections: this.getConnectionStats(battle.battleId)
    }));
  }

  getBattleDetails(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return null;

    return {
      ...battle.getGameState(),
      logs: battle.getLogs(50),
      connections: this.getConnectionStats(battleId)
    };
  }

  // 강제로 플레이어 액션 처리 (디버깅용)
  forcePlayerAction(battleId, playerId, action) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error('Battle not found');

    return battle.submitAction(playerId, action);
  }

  // 전투 상태 강제 변경 (디버깅용)
  forceBattleState(battleId, newState) {
    const battle = this.battles.get(battleId);
    if (!battle) throw new Error('Battle not found');

    Object.assign(battle, newState);
    
    this.broadcastToRoom(`battle:${battleId}`, 'state:update', battle.getGameState());
    
    return battle.getGameState();
  }
}

module.exports = SocketHandlers;
