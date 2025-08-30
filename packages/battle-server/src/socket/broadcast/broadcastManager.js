// PYXIS Broadcast Manager - 체계적인 브로드캐스트 관리
class BroadcastManager {
  constructor() {
    this.io = null;
    this.roomPrefix = 'battle';
  }

  // 초기화
  init(io) {
    this.io = io;
    console.log('[BroadcastManager] Initialized');
  }

  // === 룸 이름 생성 헬퍼 ===
  
  // 전체 전투룸
  getBattleRoom(battleId) {
    return `${this.roomPrefix}_${battleId}`;
  }

  // 역할별 룸
  getAdminRoom(battleId) {
    return `${this.roomPrefix}_${battleId}_admin`;
  }

  getPlayerRoom(battleId) {
    return `${this.roomPrefix}_${battleId}_player`;
  }

  getSpectatorRoom(battleId) {
    return `${this.roomPrefix}_${battleId}_spectator`;
  }

  // 팀별 룸
  getTeamRoom(battleId, teamKey) {
    return `${this.roomPrefix}_${battleId}_${teamKey}`;
  }

  // === 기본 브로드캐스트 메서드 ===

  // 전투 전체에게 브로드캐스트
  toAll(battleId, event, data) {
    if (!this.io) return;
    
    const room = this.getBattleRoom(battleId);
    this.io.to(room).emit(event, data);
    console.log(`[Broadcast] ${event} to all in ${battleId}`);
  }

  // 역할별 브로드캐스트
  toAdmins(battleId, event, data) {
    if (!this.io) return;
    
    const room = this.getAdminRoom(battleId);
    this.io.to(room).emit(event, data);
    console.log(`[Broadcast] ${event} to admins in ${battleId}`);
  }

  toPlayers(battleId, event, data) {
    if (!this.io) return;
    
    const room = this.getPlayerRoom(battleId);
    this.io.to(room).emit(event, data);
    console.log(`[Broadcast] ${event} to players in ${battleId}`);
  }

  toSpectators(battleId, event, data) {
    if (!this.io) return;
    
    const room = this.getSpectatorRoom(battleId);
    this.io.to(room).emit(event, data);
    console.log(`[Broadcast] ${event} to spectators in ${battleId}`);
  }

  // 팀별 브로드캐스트
  toTeam(battleId, teamKey, event, data) {
    if (!this.io) return;
    
    const room = this.getTeamRoom(battleId, teamKey);
    this.io.to(room).emit(event, data);
    console.log(`[Broadcast] ${event} to ${teamKey} in ${battleId}`);
  }

  // 특정 룸에 브로드캐스트
  toRoom(roomName, event, data) {
    if (!this.io) return;
    
    this.io.to(roomName).emit(event, data);
    console.log(`[Broadcast] ${event} to room ${roomName}`);
  }

  // === 게임 상태 브로드캐스트 ===

  // 전투 상태 동기화
  broadcastBattleState(battleId, state) {
    if (!battleId || !state) return;

    // 다중 이벤트명 지원 (호환성)
    const events = ['state:update', 'state', 'battleUpdate'];
    
    events.forEach(event => {
      this.toAll(battleId, event, state);
    });

    console.log(`[Broadcast] Battle state updated for ${battleId}`);
  }

  // 전투 시작/종료 이벤트
  broadcastBattleEvent(battleId, eventType, data = {}) {
    const eventMap = {
      'created': 'battle:created',
      'started': 'battle:started', 
      'paused': 'battle:paused',
      'resumed': 'battle:resumed',
      'ended': 'battle:ended'
    };

    const event = eventMap[eventType] || `battle:${eventType}`;
    
    this.toAll(battleId, event, {
      battleId,
      timestamp: Date.now(),
      ...data
    });

    // 레거시 지원
    if (eventType === 'ended') {
      this.toAll(battleId, 'battle:end', data);
    }

    console.log(`[Broadcast] Battle event ${eventType} for ${battleId}`);
  }

  // 턴/페이즈 변경
  broadcastPhaseChange(battleId, phaseData) {
    this.toAll(battleId, 'phase:change', phaseData);
    console.log(`[Broadcast] Phase change for ${battleId}:`, phaseData);
  }

  broadcastTurnEvent(battleId, eventType, turnData) {
    this.toAll(battleId, `turn:${eventType}`, turnData);
    console.log(`[Broadcast] Turn ${eventType} for ${battleId}:`, turnData);
  }

  // === 채팅 브로드캐스트 ===

  // 전체 채팅
  broadcastChat(battleId, messageData) {
    const events = ['chat:new', 'chat', 'chat-message'];
    
    events.forEach(event => {
      if (event === 'chat-message') {
        // 레거시 형식
        this.toAll(battleId, event, { message: messageData });
      } else {
        this.toAll(battleId, event, messageData);
      }
    });

    console.log(`[Broadcast] Chat message to all in ${battleId}`);
  }

  // 팀 채팅
  broadcastTeamChat(battleId, teamKey, messageData) {
    const events = ['chat:new', 'chat', 'chat-message'];
    
    events.forEach(event => {
      if (event === 'chat-message') {
        // 팀원에게
        this.toTeam(battleId, teamKey, event, { message: messageData });
        // 관리자에게도
        this.toAdmins(battleId, event, { message: messageData });
      } else {
        this.toTeam(battleId, teamKey, event, messageData);
        this.toAdmins(battleId, event, messageData);
      }
    });

    console.log(`[Broadcast] Team chat to ${teamKey} in ${battleId}`);
  }

  // 관전자 응원
  broadcastCheer(battleId, cheerData) {
    this.toAll(battleId, 'spectator:cheer', cheerData);
    
    // 채팅으로도 브로드캐스트
    const chatMessage = {
      ...cheerData,
      message: `[응원] ${cheerData.cheer}`,
      sender: cheerData.spectator,
      type: 'cheer',
      timestamp: Date.now()
    };
    
    this.broadcastChat(battleId, chatMessage);
    console.log(`[Broadcast] Cheer from ${cheerData.spectator} in ${battleId}`);
  }

  // === 플레이어 이벤트 ===

  // 플레이어 추가/제거
  broadcastPlayerEvent(battleId, eventType, playerData) {
    this.toAll(battleId, `player:${eventType}`, playerData);
    console.log(`[Broadcast] Player ${eventType} in ${battleId}:`, playerData);
  }

  // 액션 결과
  broadcastActionResult(battleId, result, isSuccess = true) {
    const event = isSuccess ? 'action:success' : 'action:error';
    
    this.toAll(battleId, event, result);
    
    // 레거시 지원
    const legacyEvent = isSuccess ? 'actionSuccess' : 'actionError';
    this.toAll(battleId, legacyEvent, result);
    
    console.log(`[Broadcast] Action result (${isSuccess ? 'success' : 'error'}) in ${battleId}`);
  }

  // === 관전자 이벤트 ===

  // 관전자 입장/퇴장
  broadcastSpectatorEvent(battleId, eventType, spectatorData) {
    this.toAll(battleId, `spectator:${eventType}`, spectatorData);
    console.log(`[Broadcast] Spectator ${eventType} in ${battleId}:`, spectatorData);
  }

  // === 로그 및 알림 ===

  // 게임 로그
  broadcastLog(battleId, logData) {
    this.toAll(battleId, 'log:new', logData);
    console.log(`[Broadcast] Log entry in ${battleId}:`, logData.text?.substring(0, 50));
  }

  // 공지사항
  broadcastNotice(battleId, noticeData) {
    this.toAll(battleId, 'notice:update', noticeData);
    
    // 레거시 지원
    this.toAll(battleId, 'noticeUpdate', noticeData);
    
    console.log(`[Broadcast] Notice update in ${battleId}`);
  }

  // 타이머 동기화
  broadcastTimer(battleId, timerData) {
    this.toAll(battleId, 'timer:sync', timerData);
    console.log(`[Broadcast] Timer sync in ${battleId}`);
  }

  // === 특별 브로드캐스트 ===

  // 관리자에게만 알림
  notifyAdmins(battleId, message, data = {}) {
    this.toAdmins(battleId, 'admin:notification', {
      message,
      timestamp: Date.now(),
      ...data
    });
  }

  // 시스템 메시지
  broadcastSystemMessage(battleId, message, level = 'info') {
    const systemData = {
      type: 'system',
      level: level,  // 'info', 'warning', 'error', 'success'
      message: message,
      timestamp: Date.now()
    };

    this.toAll(battleId, 'system:message', systemData);
    
    // 로그로도 기록
    this.broadcastLog(battleId, {
      text: `[시스템] ${message}`,
      type: 'system',
      timestamp: Date.now()
    });
  }

  // 에러 브로드캐스트
  broadcastError(battleId, error, target = 'all') {
    const errorData = {
      message: typeof error === 'string' ? error : error.message,
      timestamp: Date.now()
    };

    switch (target) {
      case 'admins':
        this.toAdmins(battleId, 'error', errorData);
        break;
      case 'players':
        this.toPlayers(battleId, 'error', errorData);
        break;
      case 'spectators':
        this.toSpectators(battleId, 'error', errorData);
        break;
      default:
        this.toAll(battleId, 'error', errorData);
    }

    console.error(`[Broadcast] Error to ${target} in ${battleId}:`, errorData.message);
  }

  // === 룸 관리 헬퍼 ===

  // 소켓을 적절한 룸에 조인
  joinSocketToRooms(socket, battleId, role, teamKey = null) {
    if (!socket || !battleId || !role) return;

    // 전체 룸 조인
    socket.join(this.getBattleRoom(battleId));
    
    // 역할별 룸 조인
    switch (role) {
      case 'admin':
        socket.join(this.getAdminRoom(battleId));
        // 관리자는 모든 팀 룸에도 조인 (팀 채팅 모니터링)
        socket.join(this.getTeamRoom(battleId, 'team1'));
        socket.join(this.getTeamRoom(battleId, 'team2'));
        break;
      case 'player':
        socket.join(this.getPlayerRoom(battleId));
        if (teamKey) {
          socket.join(this.getTeamRoom(battleId, teamKey));
        }
        break;
      case 'spectator':
        socket.join(this.getSpectatorRoom(battleId));
        break;
    }

    console.log(`[Broadcast] Socket ${socket.id} joined rooms for ${role} in ${battleId}`);
  }

  // 소켓을 룸에서 제거
  leaveSocketFromRooms(socket, battleId, role, teamKey = null) {
    if (!socket || !battleId) return;

    // 전체 룸에서 나가기
    socket.leave(this.getBattleRoom(battleId));
    
    // 역할별 룸에서 나가기
    switch (role) {
      case 'admin':
        socket.leave(this.getAdminRoom(battleId));
        socket.leave(this.getTeamRoom(battleId, 'team1'));
        socket.leave(this.getTeamRoom(battleId, 'team2'));
        break;
      case 'player':
        socket.leave(this.getPlayerRoom(battleId));
        if (teamKey) {
          socket.leave(this.getTeamRoom(battleId, teamKey));
        }
        break;
      case 'spectator':
        socket.leave(this.getSpectatorRoom(battleId));
        break;
    }

    console.log(`[Broadcast] Socket ${socket.id} left rooms for ${role} in ${battleId}`);
  }

  // === 통계 및 디버깅 ===

  // 룸의 클라이언트 수 확인
  getRoomSize(roomName) {
    if (!this.io) return 0;
    
    const room = this.io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  }

  // 전투별 연결 상태 확인
  getBattleStats(battleId) {
    return {
      total: this.getRoomSize(this.getBattleRoom(battleId)),
      admins: this.getRoomSize(this.getAdminRoom(battleId)),
      players: this.getRoomSize(this.getPlayerRoom(battleId)),
      spectators: this.getRoomSize(this.getSpectatorRoom(battleId)),
      team1: this.getRoomSize(this.getTeamRoom(battleId, 'team1')),
      team2: this.getRoomSize(this.getTeamRoom(battleId, 'team2'))
    };
  }

  // 모든 룸 목록
  getAllRooms() {
    if (!this.io) return [];
    
    return Array.from(this.io.sockets.adapter.rooms.keys())
      .filter(room => room.startsWith(this.roomPrefix));
  }

  // === 정리 ===

  // 전투 종료 시 관련 룸 정리
  cleanupBattle(battleId) {
    const rooms = [
      this.getBattleRoom(battleId),
      this.getAdminRoom(battleId),
      this.getPlayerRoom(battleId),
      this.getSpectatorRoom(battleId),
      this.getTeamRoom(battleId, 'team1'),
      this.getTeamRoom(battleId, 'team2')
    ];

    rooms.forEach(room => {
      // 룸의 모든 소켓을 제거
      if (this.io.sockets.adapter.rooms.has(room)) {
        this.io.in(room).disconnectSockets();
      }
    });

    console.log(`[Broadcast] Cleaned up rooms for battle ${battleId}`);
  }
}

// 싱글톤 인스턴스
const broadcastManager = new BroadcastManager();

module.exports = broadcastManager;
