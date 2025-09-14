// packages/battle-server/src/socket/events.js
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
