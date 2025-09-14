// packages/battle-server/src/socket/events.js
// PYXIS WebSocket Event Handlers - 브로드캐스트 강화
// 실시간 통신 이벤트 처리 + 권한별 룸 관리

import { 
  handlePlayerAction, 
  handleTurnTimeout,
  startBattle,
  canPlayerAct,
  validateTarget,
  getRandomSpectatorComment,
  initializeBroadcastManager
} from '../engine/battle-handlers.js';

// 전역 전투 저장소 (실제 환경에서는 Redis 등 사용)
const battles = new Map();

// 브로드캐스트 관리자
let broadcastManager = null;

/**
 * Socket.IO 이벤트 등록 - 기존 HTML과 호환성 유지 + 브로드캐스트 강화
 */
export function registerSocketEvents(io) {
  // 브로드캐스트 관리자 초기화
  broadcastManager = initializeBroadcastManager(io);
  
  io.on('connection', (socket) => {
    console.log(`[SOCKET] Client connected: ${socket.id}`);
    
    // === 연결 즉시 처리 ===
    socket.emit('socket:connected', { 
      socketId: socket.id, 
      timestamp: Date.now(),
      serverVersion: '3.0.2'
    });
    
    // 기존 이벤트명들과 신규 이벤트명 모두 지원
    
    // ===== 방 참가 (기존 HTML 호환) =====
    socket.on('join', (data) => handleJoinBattle.call(socket, data));
    socket.on('join_battle', (data) => handleJoinBattle.call(socket, data));
    
    // ===== 전투 생성 (기존 HTML 호환) =====
    socket.on('createBattle', (data, callback) => handleCreateBattle.call(socket, data, callback));
    socket.on('create_battle', (data, callback) => handleCreateBattle.call(socket, data, callback));
    
    // ===== 전투 제어 (기존 HTML 호환) =====
    socket.on('startBattle', (data) => handleStartBattle.call(socket, data));
    socket.on('admin_start_battle', (data) => handleStartBattle.call(socket, data));
    
    socket.on('endBattle', (data) => handleEndBattle.call(socket, data));
    socket.on('admin_end_battle', (data) => handleEndBattle.call(socket, data));
    
    socket.on('pauseBattle', (data) => handlePauseBattle.call(socket, data));
    socket.on('resumeBattle', (data) => handleResumeBattle.call(socket, data));
    
    // ===== 플레이어 관리 (기존 HTML 호환) =====
    socket.on('addPlayer', (data) => handleAddPlayer.call(socket, data));
    socket.on('admin_add_player', (data) => handleAddPlayer.call(socket, data));
    
    socket.on('removePlayer', (data) => handleRemovePlayer.call(socket, data));
    socket.on('admin_remove_player', (data) => handleRemovePlayer.call(socket, data));
    
    socket.on('updatePlayer', (data) => handleUpdatePlayer.call(socket, data));
    
    // ===== 플레이어 행동 (기존 HTML 호환) =====
    socket.on('action', (data) => handlePlayerAction.call(socket, data));
    socket.on('player_action', (data) => handlePlayerAction.call(socket, data));
    socket.on('playerAction', (data) => handlePlayerAction.call(socket, data));
    
    // ===== 채팅 (기존 HTML 호환) =====
    socket.on('chatMessage', (data) => handleChatMessage.call(socket, data));
    socket.on('chat_message', (data) => handleChatMessage.call(socket, data));
    socket.on('chat:send', (data) => handleChatMessage.call(socket, data));
    
    // ===== 관전자 응원 =====
    socket.on('cheer:send', (data) => handleCheerMessage.call(socket, data));
    socket.on('cheerMessage', (data) => handleCheerMessage.call(socket, data));
    socket.on('spectator:cheer', (data) => handleCheerMessage.call(socket, data));
    
    // ===== 실시간 상태 요청 =====
    socket.on('request:battle:state', (data) => handleStateRequest.call(socket, data));
    socket.on('getBattleState', (data) => handleStateRequest.call(socket, data));
    
    // ===== 재연결 처리 =====
    socket.on('reconnect:restore', (data) => handleReconnectRestore.call(socket, data));
    
    // ===== 핑퐁 =====
    socket.on('ping', () => socket.emit('pong', { ts: Date.now(), socketId: socket.id }));
    
    // ===== 연결 해제 =====
    socket.on('disconnect', () => handleDisconnect.call(socket));
    
    // ===== 에러 핸들링 =====
    socket.on('error', (error) => {
      console.error(`[SOCKET] Error from ${socket.id}:`, error);
      socket.emit('socket:error', { error: error.message, timestamp: Date.now() });
    });
  });
  
  // === 전역 타이머들 ===
  
  // 턴 타임아웃 처리 (30초마다 체크)
  setInterval(() => {
    checkTurnTimeouts(io);
  }, 30000);
  
  // 연결 상태 동기화 (1분마다)
  setInterval(() => {
    synchronizeConnections(io);
  }, 60000);
  
  // 방 상태 정리 (5분마다)
  setInterval(() => {
    cleanupEmptyRooms(io);
  }, 300000);
}

/**
 * 전투 참가 처리 - 기존 HTML 호환 + 강화된 룸 관리
 */
function handleJoinBattle(data) {
  const socket = this;
  
  // 기존 HTML 형식과 신규 형식 모두 지원
  let { battleId, playerId, playerType, otp, token, role, name, team } = data;
  
  // 기존 HTML에서는 다른 필드명 사용할 수 있음
  battleId = battleId || data.battleId;
  otp = otp || token;
  playerType = playerType || role;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      const errorResponse = { error: '전투를 찾을 수 없습니다' };
      socket.emit('join_error', errorResponse);
      socket.emit('authError', errorResponse);
      socket.emit('auth:error', errorResponse);
      return;
    }
    
    // === 권한별 룸 참가 (강화된 룸 관리) ===
    const baseRoom = battleId;
    const mainRoom = String(battleId);
    const legacyRoom = `battle-${battleId}`;
    
    // 기본 룸들 참가
    [baseRoom, mainRoom, legacyRoom].forEach(room => socket.join(room));
    
    // 권한별 전용 룸 참가
    if (playerType === 'admin') {
      socket.join(`${battleId}:admin`);
      socket.join(`admin:${battleId}`);
    } else if (playerType === 'player' && playerId) {
      socket.join(`${battleId}:player`);
      socket.join(`player:${battleId}`);
      socket.join(`${battleId}:player:${playerId}`);
      
      // 플레이어 소켓 ID 업데이트
      const player = battle.players.find(p => p.id === playerId);
      if (player) {
        player.socketId = socket.id;
        player.connected = true;
        player.lastConnected = Date.now();
        
        // 플레이어 연결 상태 브로드캐스트
        if (broadcastManager) {
          broadcastManager.broadcastPlayerConnection(battleId, playerId, true);
        }
      }
    } else if (playerType === 'spectator') {
      socket.join(`${battleId}:spectator`);
      socket.join(`spectator:${battleId}`);
      
      // 관전자 수 업데이트
      updateSpectatorCount(battleId);
    }
    
    // 소켓 메타데이터 저장
    socket.battleId = battleId;
    socket.playerId = playerId;
    socket.playerType = playerType || 'player';
    socket.playerName = name;
    socket.team = team;
    socket.connectedAt = Date.now();
    
    // === 성공 응답 (다중 호환) ===
    const successResponse = { 
      ok: true,
      battle: battle, 
      role: socket.playerType,
      battleId: battleId,
      playerId: playerId,
      timestamp: Date.now()
    };
    
    socket.emit('join_success', successResponse);
    socket.emit('authSuccess', successResponse);
    socket.emit('auth:success', successResponse);
    
    // === 현재 전투 상태 전송 ===
    if (broadcastManager) {
      // 브로드캐스트 매니저를 통한 권한별 데이터 전송
      broadcastManager.sendCurrentState(socket, battleId);
    } else {
      // 폴백: 기본 상태 전송
      socket.emit('battleUpdate', battle);
      socket.emit('battle:update', battle);
      socket.emit('battleState', battle);
    }
    
    // === 다른 참가자들에게 알림 ===
    const joinNotification = {
      type: 'player_joined',
      playerId: playerId,
      playerName: name,
      playerType: playerType,
      team: team,
      timestamp: Date.now()
    };
    
    // 자신 제외하고 브로드캐스트
    socket.to(mainRoom).emit('player_connected', joinNotification);
    socket.to(mainRoom).emit('player:joined', joinNotification);
    
    console.log(`[BATTLE] ${playerType} ${playerId || 'anonymous'} joined battle ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Join battle error:', error);
    const errorResponse = { error: '전투 참가 중 오류가 발생했습니다' };
    socket.emit('join_error', errorResponse);
    socket.emit('authError', errorResponse);
    socket.emit('auth:error', errorResponse);
  }
}

/**
 * 전투 생성 처리 - 기존 HTML 호환 + 강화
 */
function handleCreateBattle(data, callback) {
  const socket = this;
  const { mode, title, options } = data || {};
  
  try {
    const battleId = crypto.randomUUID();
    const battle = {
      id: battleId,
      title: title || `PYXIS ${mode || '2v2'} 전투`,
      mode: mode || '2v2',
      status: 'waiting',
      players: [],
      effects: [],
      logs: [],
      createdAt: Date.now(),
      createdBy: socket.id,
      actionCount: 0,
      criticalHits: 0,
      itemsUsed: 0,
      // 턴 시스템 초기화
      turn: {
        round: 1,
        order: ['A', 'B'],
        phaseIndex: 0,
        acted: { A: new Set(), B: new Set() },
        maxTurns: options?.maxTurns || 100,
        actions: [],
        lastPhaseStart: Date.now()
      }
    };
    
    battles.set(battleId, battle);
    
    // 생성자는 자동으로 관리자 룸에 참가
    [battleId, String(battleId), `battle-${battleId}`, `${battleId}:admin`].forEach(room => {
      socket.join(room);
    });
    
    socket.battleId = battleId;
    socket.playerType = 'admin';
    socket.connectedAt = Date.now();
    
    const result = {
      ok: true,
      battleId: battleId,
      battle: battle,
      timestamp: Date.now()
    };
    
    // === 다중 응답 (기존 HTML 호환) ===
    if (typeof callback === 'function') callback(result);
    socket.emit('battle:created', result);
    socket.emit('battleCreated', result);
    socket.emit('admin:created', result);
    
    // === 브로드캐스트 ===
    if (broadcastManager) {
      broadcastManager.broadcastSystemLog(battleId, {
        type: 'system',
        message: `전투가 생성되었습니다 (모드: ${mode || '2v2'})`
      });
    }
    
    console.log(`[BATTLE] Created: ${battleId} (${mode || '2v2'}) by ${socket.id}`);
    
  } catch (error) {
    console.error('[SOCKET] Create battle error:', error);
    const errorResult = { ok: false, error: '전투 생성 중 오류가 발생했습니다' };
    if (typeof callback === 'function') callback(errorResult);
    socket.emit('battleError', errorResult);
    socket.emit('battle:error', errorResult);
  }
}

/**
 * 전투 시작 처리 - 기존 HTML 호환 + 강화
 */
function handleStartBattle(data) {
  const socket = this;
  const { battleId } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      const error = { error: '전투를 찾을 수 없습니다' };
      socket.emit('battleError', error);
      socket.emit('battle:error', error);
      return;
    }
    
    if (battle.status !== 'waiting') {
      const error = { error: '이미 시작된 전투입니다' };
      socket.emit('battleError', error);
      return;
    }
    
    // 전투 검증
    const validation = validateBattleState(battle);
    if (!validation.valid) {
      const error = { error: validation.error };
      socket.emit('battleError', error);
      return;
    }
    
    // 전투 시작
    const startResult = startBattle(socket.server, battle);
    
    // === 다중 응답 (기존 HTML 호환) ===
    socket.emit('battleStarted', { ok: true, battle: battle });
    socket.emit('battle:started', startResult);
    socket.emit('admin:battle:started', startResult);
    
    console.log(`[BATTLE] Started: ${battleId} by ${socket.id}`);
    
  } catch (error) {
    console.error('[SOCKET] Start battle error:', error);
    socket.emit('battleError', { error: '전투 시작 중 오류가 발생했습니다' });
    socket.emit('battle:error', { error: '전투 시작 중 오류가 발생했습니다' });
  }
}

/**
 * 재연결 복원 처리
 */
function handleReconnectRestore(data) {
  const socket = this;
  const { battleId, playerId, playerType } = data;
  
  if (!battleId) return;
  
  const battle = battles.get(battleId);
  if (!battle) return;
  
  // 기존 연결 정보 복원
  socket.battleId = battleId;
  socket.playerId = playerId;
  socket.playerType = playerType;
  
  // 룸 재참가
  handleJoinBattle.call(socket, { battleId, playerId, playerType });
  
  socket.emit('reconnect:success', {
    battleId,
    battle,
    timestamp: Date.now()
  });
}

/**
 * 상태 요청 처리
 */
function handleStateRequest(data) {
  const socket = this;
  const { battleId } = data || { battleId: socket.battleId };
  
  if (!battleId) return;
  
  const battle = battles.get(battleId);
  if (!battle) {
    socket.emit('state:error', { error: '전투를 찾을 수 없습니다' });
    return;
  }
  
  if (broadcastManager) {
    broadcastManager.sendCurrentState(socket, battleId);
  } else {
    socket.emit('battleState', battle);
    socket.emit('battle:state', battle);
  }
}

/**
 * 관전자 수 업데이트
 */
function updateSpectatorCount(battleId) {
  if (!broadcastManager) return;
  
  const spectatorRoom = `${battleId}:spectator`;
  const room = battles.get(battleId)?.io?.sockets?.adapter?.rooms?.get(spectatorRoom);
  const count = room ? room.size : 0;
  
  broadcastManager.broadcastSpectatorCount(battleId, count);
}

/**
 * 턴 타임아웃 체크 - 강화
 */
function checkTurnTimeouts(io) {
  const now = Date.now();
  const timeoutDuration = 5 * 60 * 1000; // 5분
  
  for (const [battleId, battle] of battles) {
    if (battle.status === 'active' && battle.turn && battle.turn.lastPhaseStart) {
      const elapsed = now - battle.turn.lastPhaseStart;
      
      if (elapsed >= timeoutDuration) {
        console.log(`[BATTLE] Turn timeout for battle ${battleId}`);
        handleTurnTimeout(io, battle);
        
        // 타임아웃 시점 업데이트
        battle.turn.lastPhaseStart = now;
      }
    }
  }
}

/**
 * 연결 상태 동기화
 */
function synchronizeConnections(io) {
  for (const [battleId, battle] of battles) {
    for (const player of battle.players || []) {
      if (player.socketId) {
        const socket = io.sockets.sockets.get(player.socketId);
        const isConnected = socket && socket.connected;
        
        if (player.connected !== isConnected) {
          player.connected = isConnected;
          
          if (broadcastManager) {
            broadcastManager.broadcastPlayerConnection(battleId, player.id, isConnected);
          }
        }
      }
    }
  }
}

/**
 * 빈 방 정리
 */
function cleanupEmptyRooms(io) {
  const now = Date.now();
  const inactiveThreshold = 30 * 60 * 1000; // 30분
  
  for (const [battleId, battle] of battles) {
    const room = io.sockets.adapter.rooms.get(String(battleId));
    const socketCount = room ? room.size : 0;
    const isInactive = (now - (battle.lastActivity || battle.createdAt)) > inactiveThreshold;
    
    if (socketCount === 0 && (battle.status === 'ended' || isInactive)) {
      battles.delete(battleId);
      console.log(`[CLEANUP] Removed inactive battle: ${battleId}`);
      
      if (broadcastManager) {
        broadcastManager.roomStates.delete(battleId);
      }
    }
  }
}

// 전투 저장소 내보내기 (API에서 사용)
export { battles };

export default {
  registerSocketEvents,
  battles
};// packages/battle-server/src/socket/events.js
// PYXIS WebSocket Event Handlers
// 실시간 통신 이벤트 처리

import { 
  handlePlayerAction, 
  handleTurnTimeout,
  startBattle,
  canPlayerAct,
  validateTarget,
  getRandomSpectatorComment
} from '../engine/battle-handlers.js';

// 전역 전투 저장소 (실제 환경에서는 Redis 등 사용)
const battles = new Map();

/**
 * Socket.IO 이벤트 등록
 */
export function registerSocketEvents(io) {
  io.on('connection', (socket) => {
    console.log(`[SOCKET] Client connected: ${socket.id}`);
    
    // 전투 참가
    socket.on('join_battle', handleJoinBattle);
    
    // 플레이어 행동
    socket.on('player_action', handlePlayerActionEvent);
    
    // 관리자 전투 제어
    socket.on('admin_start_battle', handleAdminStartBattle);
    socket.on('admin_end_battle', handleAdminEndBattle);
    socket.on('admin_add_player', handleAdminAddPlayer);
    socket.on('admin_remove_player', handleAdminRemovePlayer);
    
    // 채팅
    socket.on('chat_message', handleChatMessage);
    
    // 연결 해제
    socket.on('disconnect', handleDisconnect);
  });
  
}

/**
 * 전투 참가 처리 - 기존 HTML 호환
 */
function handleJoinBattle(data) {
  const socket = this;
  
  // 기존 HTML 형식과 신규 형식 모두 지원
  let { battleId, playerId, playerType, otp, token, role, name, team } = data;
  
  // 기존 HTML에서는 다른 필드명 사용할 수 있음
  battleId = battleId || data.battleId;
  otp = otp || token;
  playerType = playerType || role;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('join_error', { error: '전투를 찾을 수 없습니다' });
      socket.emit('authError', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    // 소켓을 전투 룸에 참가
    socket.join(battleId);
    socket.join(String(battleId)); // 문자열로도 참가
    socket.battleId = battleId;
    socket.playerId = playerId;
    socket.playerType = playerType || 'player';
    
    // 기존 HTML 호환 응답
    socket.emit('join_success', { battle: battle });
    socket.emit('authSuccess', { 
      ok: true, 
      battle: battle, 
      role: socket.playerType,
      battleId: battleId,
      playerId: playerId
    });
    socket.emit('auth:success', { 
      ok: true, 
      battle: battle, 
      role: socket.playerType,
      battleId: battleId,
      playerId: playerId
    });
    
    // 전투 상태 전송 (기존 HTML이 기대하는 이벤트들)
    socket.emit('battleUpdate', battle);
    socket.emit('battle:update', battle);
    socket.emit('battleState', battle);
    
    console.log(`[BATTLE] ${socket.playerType} joined battle ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Join battle error:', error);
    socket.emit('join_error', { error: '전투 참가 중 오류가 발생했습니다' });
    socket.emit('authError', { error: '전투 참가 중 오류가 발생했습니다' });
  }
}

/**
 * 전투 생성 처리 - 기존 HTML 호환
 */
function handleCreateBattle(data, callback) {
  const socket = this;
  const { mode } = data || {};
  
  try {
    const battleId = crypto.randomUUID();
    const battle = {
      id: battleId,
      mode: mode || '2v2',
      status: 'waiting',
      players: [],
      effects: [],
      createdAt: Date.now(),
      turn: {
        round: 1,
        order: ['A', 'B'],
        phaseIndex: 0,
        acted: { A: new Set(), B: new Set() },
        maxTurns: 100,
        actions: []
      }
    };
    
    battles.set(battleId, battle);
    socket.join(battleId);
    socket.battleId = battleId;
    
    const result = {
      ok: true,
      battleId: battleId,
      battle: battle
    };
    
    // 기존 HTML 호환 응답들
    if (typeof callback === 'function') callback(result);
    socket.emit('battle:created', result);
    socket.emit('battleCreated', result);
    socket.emit('admin:created', result);
    
    console.log(`[BATTLE] Created: ${battleId} (${mode})`);
    
  } catch (error) {
    console.error('[SOCKET] Create battle error:', error);
    const errorResult = { ok: false, error: '전투 생성 중 오류가 발생했습니다' };
    if (typeof callback === 'function') callback(errorResult);
    socket.emit('battleError', errorResult);
  }
}

/**
 * 전투 시작 처리 - 기존 HTML 호환
 */
function handleStartBattle(data) {
  const socket = this;
  const { battleId } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('battleError', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    if (battle.status !== 'waiting') {
      socket.emit('battleError', { error: '이미 시작된 전투입니다' });
      return;
    }
    
    // 전투 시작
    const startResult = startBattle(socket.server, battle);
    
    // 기존 HTML 호환 응답들
    socket.emit('battleStarted', { ok: true, battle: battle });
    socket.emit('battle:started', battle);
    socket.server.to(battleId).emit('battle:started', battle);
    socket.server.to(battleId).emit('battleUpdate', battle);
    socket.server.to(battleId).emit('battle:update', battle);
    
    console.log(`[BATTLE] Started: ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Start battle error:', error);
    socket.emit('battleError', { error: '전투 시작 중 오류가 발생했습니다' });
  }
}

/**
 * 전투 종료 처리 - 기존 HTML 호환
 */
function handleEndBattle(data) {
  const socket = this;
  const { battleId, reason } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('battleError', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    battle.status = 'ended';
    battle.endedAt = Date.now();
    battle.endReason = reason || 'manual_stop';
    
    const endData = {
      type: 'battle_end',
      reason: reason || '수동 종료',
      battle: battle
    };
    
    // 기존 HTML 호환 응답들
    socket.server.to(battleId).emit('battle:ended', endData);
    socket.server.to(battleId).emit('battle_end', endData);
    socket.server.to(battleId).emit('battleUpdate', battle);
    
    console.log(`[BATTLE] Ended: ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] End battle error:', error);
    socket.emit('battleError', { error: '전투 종료 중 오류가 발생했습니다' });
  }
}

/**
 * 전투 일시정지 - 기존 HTML 호환
 */
function handlePauseBattle(data) {
  const socket = this;
  const { battleId } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) return;
    
    battle.status = 'paused';
    battle.pausedAt = Date.now();
    
    socket.server.to(battleId).emit('battle:paused', battle);
    socket.server.to(battleId).emit('battleUpdate', battle);
    
  } catch (error) {
    console.error('[SOCKET] Pause battle error:', error);
  }
}

/**
 * 전투 재개 - 기존 HTML 호환
 */
function handleResumeBattle(data) {
  const socket = this;
  const { battleId } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) return;
    
    battle.status = 'active';
    battle.resumedAt = Date.now();
    
    socket.server.to(battleId).emit('battle:resumed', battle);
    socket.server.to(battleId).emit('battleUpdate', battle);
    
  } catch (error) {
    console.error('[SOCKET] Resume battle error:', error);
  }
}

/**
 * 플레이어 추가 - 기존 HTML 호환
 */
function handleAddPlayer(data) {
  const socket = this;
  const { battleId, player } = data || { battleId: socket.battleId, player: data };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('battleError', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    // 플레이어 기본값 설정
    const newPlayer = {
      id: player.id || crypto.randomUUID(),
      name: player.name,
      team: player.team,
      stats: player.stats,
      hp: player.hp || 100,
      maxHp: 100,
      items: player.items || { dittany: 0, attack_boost: 0, defense_boost: 0 },
      avatar: player.avatar || null,
      connected: false,
      socketId: null,
      joinedAt: Date.now()
    };
    
    battle.players.push(newPlayer);
    
    // 기존 HTML 호환 응답들
    socket.emit('playerAdded', { ok: true, player: newPlayer });
    socket.emit('player:added:ack', { ok: true, player: newPlayer });
    socket.server.to(battleId).emit('player_added', { player: newPlayer });
    socket.server.to(battleId).emit('battleUpdate', battle);
    
    console.log(`[BATTLE] Player added: ${newPlayer.name} to ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Add player error:', error);
    socket.emit('battleError', { error: '플레이어 추가 중 오류가 발생했습니다' });
  }
}

/**
 * 플레이어 제거 - 기존 HTML 호환
 */
function handleRemovePlayer(data) {
  const socket = this;
  const { battleId, playerId } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) return;
    
    const playerIndex = battle.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    const removedPlayer = battle.players[playerIndex];
    battle.players.splice(playerIndex, 1);
    
    // 기존 HTML 호환 응답들
    socket.emit('playerRemoved', { ok: true, playerId });
    socket.server.to(battleId).emit('player_removed', { playerId, playerName: removedPlayer.name });
    socket.server.to(battleId).emit('battleUpdate', battle);
    
  } catch (error) {
    console.error('[SOCKET] Remove player error:', error);
  }
}

/**
 * 플레이어 업데이트 - 기존 HTML 호환
 */
function handleUpdatePlayer(data) {
  const socket = this;
  const { battleId, playerId, updates } = data || { battleId: socket.battleId };
  
  try {
    const battle = battles.get(battleId);
    if (!battle) return;
    
    const player = battle.players.find(p => p.id === playerId);
    if (!player) return;
    
    Object.assign(player, updates);
    
    socket.emit('playerUpdated', { ok: true, player });
    socket.server.to(battleId).emit('battleUpdate', battle);
    
  } catch (error) {
    console.error('[SOCKET] Update player error:', error);
  }
}

/**
 * 플레이어 행동 처리 - 기존 HTML 호환
 */
function handlePlayerAction(data) {
  const socket = this;
  let { battleId, playerId, type, targetId, itemType, action } = data;
  
  // 기존 HTML에서 action 객체로 보낼 수 있음
  if (action && typeof action === 'object') {
    type = type || action.type;
    targetId = targetId || action.targetId;
    itemType = itemType || action.itemType;
  }
  
  battleId = battleId || socket.battleId;
  playerId = playerId || socket.playerId;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('action_error', { error: '전투를 찾을 수 없습니다' });
      socket.emit('action:error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    // 행동 처리
    const result = handlePlayerAction(socket.server, battle, {
      playerId,
      type,
      targetId,
      itemType
    });
    
    if (!result.success) {
      socket.emit('action_error', { error: result.error });
      socket.emit('action:error', { error: result.error });
      return;
    }
    
    // 기존 HTML 호환 응답들
    socket.emit('action_success', { ok: true, logs: result.logs });
    socket.emit('action:success', { ok: true, logs: result.logs });
    
  } catch (error) {
    console.error('[SOCKET] Player action error:', error);
    socket.emit('action_error', { error: '행동 처리 중 오류가 발생했습니다' });
    socket.emit('action:error', { error: '행동 처리 중 오류가 발생했습니다' });
  }
}

/**
 * 채팅 메시지 처리 - 기존 HTML 호환
 */
function handleChatMessage(data) {
  const socket = this;
  let { battleId, message, name, role, team, senderName } = data;
  
  // 기존 HTML 호환 필드명들
  battleId = battleId || socket.battleId;
  name = name || senderName || socket.playerName || '플레이어';
  role = role || socket.playerType || 'player';
  
  try {
    const battle = battles.get(battleId);
    if (!battle) return;
    
    const chatData = {
      type: 'chat_message',
      message: message,
      name: name,
      senderName: name, // 기존 HTML 호환
      role: role,
      team: team,
      timestamp: Date.now()
    };
    
    // 기존 HTML 호환 이벤트들
    socket.server.to(battleId).emit('chatMessage', chatData);
    socket.server.to(battleId).emit('chat_message', chatData);
    socket.server.to(battleId).emit('battle:chat', chatData);
    socket.server.to(battleId).emit('chat:message', chatData);
    
  } catch (error) {
    console.error('[SOCKET] Chat message error:', error);
  }
}

/**
 * 관전자 응원 메시지 처리
 */
function handleCheerMessage(data) {
  const socket = this;
  const { battleId, message, cheer, name } = data;
  
  try {
    const finalMessage = cheer || message || getRandomSpectatorComment();
    
    const cheerData = {
      type: 'spectator_cheer',
      message: finalMessage,
      cheer: finalMessage,
      name: name || '관전자',
      timestamp: Date.now()
    };
    
    socket.server.to(battleId || socket.battleId).emit('spectator:cheer', cheerData);
    socket.server.to(battleId || socket.battleId).emit('cheerMessage', cheerData);
    
  } catch (error) {
    console.error('[SOCKET] Cheer message error:', error);
  }

/**
 * 전투 참가 처리
 */
function handleJoinBattle(data) {
  const { battleId, playerId, playerType, otp } = data;
  const socket = this;
  
  try {
    // OTP 검증 (실제 구현에서는 서버에서 검증)
    if (!otp) {
      socket.emit('join_error', { error: '비밀번호가 필요합니다' });
      return;
    }
    
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('join_error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    // 소켓을 전투 룸에 참가
    socket.join(`battle-${battleId}`);
    socket.battleId = battleId;
    socket.playerId = playerId;
    socket.playerType = playerType;
    
    // 플레이어 타입별 처리
    if (playerType === 'player') {
      const player = battle.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('join_error', { error: '등록된 참가자가 아닙니다' });
        return;
      }
      
      player.socketId = socket.id;
      player.connected = true;
      
      socket.emit('join_success', {
        battle: sanitizeBattleForPlayer(battle, playerId),
        player: player
      });
      
    } else if (playerType === 'admin') {
      socket.emit('join_success', {
        battle: battle
      });
      
    } else if (playerType === 'spectator') {
      socket.emit('join_success', {
        battle: sanitizeBattleForSpectator(battle)
      });
    }
    
    // 다른 클라이언트에게 참가 알림
    socket.to(`battle-${battleId}`).emit('player_connected', {
      playerId,
      playerType
    });
    
    console.log(`[BATTLE] ${playerType} ${playerId} joined battle ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Join battle error:', error);
    socket.emit('join_error', { error: '전투 참가 중 오류가 발생했습니다' });
  }
}

/**
 * 플레이어 행동 이벤트 처리
 */
function handlePlayerActionEvent(data) {
  const socket = this;
  const { battleId, playerId, action } = data;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('action_error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    // 행동 가능 여부 확인
    const canAct = canPlayerAct(battle, playerId);
    if (!canAct.canAct) {
      socket.emit('action_error', { error: canAct.reason });
      return;
    }
    
    // 타겟 검증
    if (action.targetId) {
      const targetValidation = validateTarget(battle, playerId, action.targetId, action.type);
      if (!targetValidation.valid) {
        socket.emit('action_error', { error: targetValidation.error });
        return;
      }
    }
    
    // 행동 처리
    const result = handlePlayerAction(socket.server, battle, {
      playerId,
      type: action.type,
      targetId: action.targetId,
      itemType: action.itemType
    });
    
    if (!result.success) {
      socket.emit('action_error', { error: result.error });
      return;
    }
    
    socket.emit('action_success', {
      logs: result.logs,
      battleState: result.battleState
    });
    
  } catch (error) {
    console.error('[SOCKET] Player action error:', error);
    socket.emit('action_error', { error: '행동 처리 중 오류가 발생했습니다' });
  }
}

/**
 * 관리자 전투 시작
 */
function handleAdminStartBattle(data) {
  const socket = this;
  const { battleId } = data;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('admin_error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    if (battle.status !== 'waiting') {
      socket.emit('admin_error', { error: '이미 시작된 전투입니다' });
      return;
    }
    
    // 전투 시작
    const startResult = startBattle(socket.server, battle);
    
    socket.emit('admin_success', {
      message: '전투가 시작되었습니다',
      battle: battle
    });
    
    console.log(`[BATTLE] Admin started battle ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Admin start battle error:', error);
    socket.emit('admin_error', { error: '전투 시작 중 오류가 발생했습니다' });
  }
}

/**
 * 관리자 전투 종료
 */
function handleAdminEndBattle(data) {
  const socket = this;
  const { battleId, reason } = data;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('admin_error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    battle.status = 'ended';
    battle.endedAt = Date.now();
    battle.endReason = reason || 'admin_stop';
    
    socket.server.to(`battle-${battleId}`).emit('battle_end', {
      type: 'admin_end',
      reason: reason || '관리자에 의해 종료됨',
      battle: battle
    });
    
    socket.emit('admin_success', { message: '전투가 종료되었습니다' });
    
    console.log(`[BATTLE] Admin ended battle ${battleId}: ${reason}`);
    
  } catch (error) {
    console.error('[SOCKET] Admin end battle error:', error);
    socket.emit('admin_error', { error: '전투 종료 중 오류가 발생했습니다' });
  }
}

/**
 * 관리자 플레이어 추가
 */
function handleAdminAddPlayer(data) {
  const socket = this;
  const { battleId, player } = data;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('admin_error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    // 플레이어 유효성 검사
    if (!player.name || !player.team || !player.stats) {
      socket.emit('admin_error', { error: '플레이어 정보가 불완전합니다' });
      return;
    }
    
    // 중복 ID 검사
    if (battle.players.find(p => p.id === player.id)) {
      socket.emit('admin_error', { error: '이미 존재하는 플레이어 ID입니다' });
      return;
    }
    
    // 플레이어 기본값 설정
    const newPlayer = {
      ...player,
      hp: player.hp || 100,
      maxHp: 100,
      items: player.items || { dittany: 0, attack_boost: 0, defense_boost: 0 },
      connected: false,
      socketId: null
    };
    
    battle.players.push(newPlayer);
    
    // 클라이언트에게 업데이트 알림
    socket.server.to(`battle-${battleId}`).emit('player_added', {
      player: newPlayer
    });
    
    socket.emit('admin_success', { 
      message: '플레이어가 추가되었습니다',
      player: newPlayer 
    });
    
    console.log(`[BATTLE] Admin added player ${player.name} to battle ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Admin add player error:', error);
    socket.emit('admin_error', { error: '플레이어 추가 중 오류가 발생했습니다' });
  }
}

/**
 * 관리자 플레이어 제거
 */
function handleAdminRemovePlayer(data) {
  const socket = this;
  const { battleId, playerId } = data;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('admin_error', { error: '전투를 찾을 수 없습니다' });
      return;
    }
    
    const playerIndex = battle.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      socket.emit('admin_error', { error: '플레이어를 찾을 수 없습니다' });
      return;
    }
    
    const removedPlayer = battle.players[playerIndex];
    battle.players.splice(playerIndex, 1);
    
    // 해당 플레이어의 소켓 연결 해제
    if (removedPlayer.socketId) {
      const playerSocket = socket.server.sockets.sockets.get(removedPlayer.socketId);
      if (playerSocket) {
        playerSocket.emit('player_removed', { reason: '관리자에 의해 제거됨' });
        playerSocket.leave(`battle-${battleId}`);
      }
    }
    
    socket.server.to(`battle-${battleId}`).emit('player_removed', {
      playerId: playerId,
      playerName: removedPlayer.name
    });
    
    socket.emit('admin_success', { 
      message: '플레이어가 제거되었습니다',
      playerId 
    });
    
    console.log(`[BATTLE] Admin removed player ${playerId} from battle ${battleId}`);
    
  } catch (error) {
    console.error('[SOCKET] Admin remove player error:', error);
    socket.emit('admin_error', { error: '플레이어 제거 중 오류가 발생했습니다' });
  }
}

/**
 * 채팅 메시지 처리
 */
function handleChatMessage(data) {
  const socket = this;
  const { battleId, message, sender, senderType } = data;
  
  try {
    const battle = battles.get(battleId);
    if (!battle) return;
    
    // 관전자의 경우 랜덤 고정 멘트 사용
    let finalMessage = message;
    if (senderType === 'spectator') {
      finalMessage = getRandomSpectatorComment();
    }
    
    const chatData = {
      type: 'chat_message',
      message: finalMessage,
      sender: sender,
      senderType: senderType,
      timestamp: Date.now()
    };
    
    // 전투 참가자들에게 브로드캐스트
    socket.server.to(`battle-${battleId}`).emit('chat_message', chatData);
    
  } catch (error) {
    console.error('[SOCKET] Chat message error:', error);
  }
}

/**
 * 연결 해제 처리
 */
function handleDisconnect() {
  const socket = this;
  
  try {
    if (socket.battleId && socket.playerId) {
      const battle = battles.get(socket.battleId);
      if (battle) {
        const player = battle.players.find(p => p.id === socket.playerId);
        if (player) {
          player.connected = false;
          player.socketId = null;
        }
        
        socket.to(`battle-${socket.battleId}`).emit('player_disconnected', {
          playerId: socket.playerId,
          playerType: socket.playerType
        });
      }
    }
    
    console.log(`[SOCKET] Client disconnected: ${socket.id}`);
    
  } catch (error) {
    console.error('[SOCKET] Disconnect error:', error);
  }
}

/**
 * 턴 타임아웃 체크
 */
function checkTurnTimeouts(io) {
  const now = Date.now();
  const timeoutDuration = 5 * 60 * 1000; // 5분
  
  for (const [battleId, battle] of battles) {
    if (battle.status === 'active' && battle.turn && battle.turn.lastPhaseStart) {
      const elapsed = now - battle.turn.lastPhaseStart;
      
      if (elapsed >= timeoutDuration) {
        console.log(`[BATTLE] Turn timeout for battle ${battleId}`);
        handleTurnTimeout(io, battle);
        
        // 타임아웃 시점 업데이트
        battle.turn.lastPhaseStart = now;
      }
    }
  }
}

/**
 * 플레이어용 전투 정보 필터링
 */
function sanitizeBattleForPlayer(battle, playerId) {
  return {
    id: battle.id,
    status: battle.status,
    mode: battle.mode,
    players: battle.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      stats: p.stats,
      items: p.id === playerId ? p.items : Object.keys(p.items || {}), // 자신의 아이템만 상세 정보
      connected: p.connected
    })),
    turn: battle.turn,
    effects: battle.effects || [],
    startedAt: battle.startedAt,
    leadingTeam: battle.leadingTeam
  };
}

/**
 * 관전자용 전투 정보 필터링
 */
function sanitizeBattleForSpectator(battle) {
  return {
    id: battle.id,
    status: battle.status,
    mode: battle.mode,
    players: battle.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      stats: p.stats,
      connected: p.connected
      // 아이템 정보는 관전자에게 비공개
    })),
    turn: battle.turn,
    startedAt: battle.startedAt,
    leadingTeam: battle.leadingTeam
  };
}

// 전투 저장소 내보내기 (API에서 사용)
export { battles };

export default {
  registerSocketEvents,
  battles
};
