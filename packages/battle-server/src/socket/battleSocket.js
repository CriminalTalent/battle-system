// Socket.IO 배틀 이벤트 핸들러
module.exports = function(io, battleEngine) {
  
  // OTP 저장소 (실제 환경에서는 Redis 사용 권장)
  const otpStore = new Map();
  const authTokens = new Map();
  
  /**
   * OTP 생성
   */
  function generateOTP() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  
  /**
   * OTP 발급 (관리자 API에서 호출)
   */
  function issueOTP(battleId, role, playerName = null) {
    const otp = generateOTP();
    const otpData = {
      battleId,
      role,
      playerName,
      createdAt: Date.now(),
      used: false
    };
    
    otpStore.set(otp, otpData);
    
    // 5분 후 자동 삭제
    setTimeout(() => {
      otpStore.delete(otp);
    }, 300000);
    
    return otp;
  }
  
  /**
   * OTP 검증
   */
  function verifyOTP(otp, battleId) {
    const otpData = otpStore.get(otp);
    
    if (!otpData) {
      return { valid: false, error: 'Invalid OTP' };
    }
    
    if (otpData.battleId !== battleId) {
      return { valid: false, error: 'OTP not for this battle' };
    }
    
    if (otpData.used) {
      return { valid: false, error: 'OTP already used' };
    }
    
    if (Date.now() - otpData.createdAt > 300000) { // 5분 만료
      otpStore.delete(otp);
      return { valid: false, error: 'OTP expired' };
    }
    
    return { valid: true, data: otpData };
  }

  // 소켓 연결 처리
  io.on('connection', (socket) => {
    console.log('소켓 연결:', socket.id);
    
    // 소켓별 상태 저장
    socket.battleId = null;
    socket.playerId = null;
    socket.role = null; // 'player', 'spectator', 'admin'
    socket.authenticated = false;

    // ===== 인증 이벤트 =====
    
    // 플레이어 인증
    socket.on('playerAuth', async (data) => {
      try {
        const { battleId, otp, playerId } = data;
        
        // OTP 검증
        const otpResult = verifyOTP(otp, battleId);
        if (!otpResult.valid) {
          socket.emit('authError', otpResult.error);
          return;
        }
        
        // 전투 확인
        const battle = battleEngine.getBattle(battleId);
        if (!battle) {
          socket.emit('authError', '전투를 찾을 수 없습니다');
          return;
        }
        
        // 플레이어 확인
        const player = battleEngine.findPlayer(battle, playerId);
        if (!player) {
          socket.emit('authError', '플레이어를 찾을 수 없습니다');
          return;
        }
        
        // OTP 사용 처리
        otpResult.data.used = true;
        
        // 소켓 정보 설정
        socket.battleId = battleId;
        socket.playerId = playerId;
        socket.role = 'player';
        socket.authenticated = true;
        
        // 배틀 룸 입장
        socket.join(battleId);
        socket.join(`${battleId}-players`);
        
        // 연결 상태 업데이트
        battleEngine.updatePlayerConnection(battleId, playerId, true);
        
        socket.emit('authSuccess', {
          role: 'player',
          playerId: playerId,
          battle: serializeBattleForPlayer(battle, playerId)
        });
        
        // 다른 플레이어들에게 알림
        socket.to(battleId).emit('battleUpdate', serializeBattleForAll(battle));
        
      } catch (error) {
        console.error('플레이어 인증 오류:', error);
        socket.emit('authError', error.message);
      }
    });
    
    // 관전자 인증
    socket.on('spectatorAuth', async (data) => {
      try {
        const { battleId, otp, spectatorName } = data;
        
        // OTP 검증
        const otpResult = verifyOTP(otp, battleId);
        if (!otpResult.valid) {
          socket.emit('authError', otpResult.error);
          return;
        }
        
        // 전투 확인
        const battle = battleEngine.getBattle(battleId);
        if (!battle) {
          socket.emit('authError', '전투를 찾을 수 없습니다');
          return;
        }
        
        // OTP 사용 처리
        otpResult.data.used = true;
        
        // 소켓 정보 설정
        socket.battleId = battleId;
        socket.role = 'spectator';
        socket.spectatorName = spectatorName || `관전자${Date.now()}`;
        socket.authenticated = true;
        
        // 배틀 룸 입장 (관전자 전용)
        socket.join(battleId);
        socket.join(`${battleId}-spectators`);
        
        socket.emit('authSuccess', {
          role: 'spectator',
          battle: serializeBattleForSpectator(battle)
        });
        
        // 관전자 수 업데이트
        const spectatorCount = io.sockets.adapter.rooms.get(`${battleId}-spectators`)?.size || 0;
        io.to(battleId).emit('connectionStatus', {
          battleId: battleId,
          spectatorCount: spectatorCount
        });
        
      } catch (error) {
        console.error('관전자 인증 오류:', error);
        socket.emit('authError', error.message);
      }
    });
    
    // 관리자 인증
    socket.on('adminAuth', async (data) => {
      try {
        const { battleId, otp } = data;
        
        // OTP 검증 (관리자는 재사용 가능)
        const otpData = otpStore.get(otp);
        if (!otpData || otpData.battleId !== battleId || otpData.role !== 'admin') {
          socket.emit('authError', '관리자 인증 실패');
          return;
        }
        
        // 전투 확인
        const battle = battleEngine.getBattle(battleId);
        if (!battle) {
          socket.emit('authError', '전투를 찾을 수 없습니다');
          return;
        }
        
        // 소켓 정보 설정
        socket.battleId = battleId;
        socket.role = 'admin';
        socket.authenticated = true;
        
        // 모든 룸 입장
        socket.join(battleId);
        socket.join(`${battleId}-admin`);
        
        socket.emit('authSuccess', {
          role: 'admin',
          battle: battle // 관리자는 모든 정보 접근 가능
        });
        
      } catch (error) {
        console.error('관리자 인증 오류:', error);
        socket.emit('authError', error.message);
      }
    });

    // ===== 플레이어 액션 이벤트 =====
    
    // 플레이어 준비
    socket.on('playerReady', () => {
      if (!socket.authenticated || socket.role !== 'player') {
        socket.emit('error', '권한이 없습니다');
        return;
      }
      
      const battle = battleEngine.getBattle(socket.battleId);
      if (!battle) return;
      
      const isReady = battleEngine.togglePlayerReady(socket.battleId, socket.playerId);
      
      socket.emit('readySuccess', { isReady });
      
      // 모든 클라이언트에게 업데이트
      io.to(socket.battleId).emit('battleUpdate', serializeBattleForAll(battle));
    });
    
    // 플레이어 액션
    socket.on('playerAction', (data) => {
      try {
        if (!socket.authenticated || socket.role !== 'player') {
          socket.emit('actionError', '권한이 없습니다');
          return;
        }
        
        const { type, targetId, itemType, itemTargetId } = data;
        
        const result = battleEngine.executeAction(socket.battleId, socket.playerId, {
          type: type,
          targetId: targetId || itemTargetId,
          itemType: itemType
        });
        
        socket.emit('actionSuccess');
        
        const battle = battleEngine.getBattle(socket.battleId);
        io.to(socket.battleId).emit('battleUpdate', serializeBattleForAll(battle));
        
      } catch (error) {
        console.error('액션 오류:', error);
        socket.emit('actionError', error.message);
      }
    });

    // ===== 채팅 이벤트 =====
    
    // 채팅 메시지
    socket.on('chatMessage', (data) => {
      if (!socket.authenticated) return;
      
      const { message } = data;
      if (!message || message.trim().length === 0) return;
      
      let senderName = '알 수 없음';
      let senderType = socket.role;
      
      if (socket.role === 'player') {
        const battle = battleEngine.getBattle(socket.battleId);
        const player = battleEngine.findPlayer(battle, socket.playerId);
        senderName = player ? player.name : '플레이어';
      } else if (socket.role === 'spectator') {
        senderName = socket.spectatorName;
      } else if (socket.role === 'admin') {
        senderName = '관리자';
      }
      
      battleEngine.addChatMessage(
        socket.battleId,
        senderName,
        message.trim(),
        senderType
      );
      
      const battle = battleEngine.getBattle(socket.battleId);
      io.to(socket.battleId).emit('battleUpdate', serializeBattleForAll(battle));
    });
    
    // 응원 메시지 (관전자 전용)
    socket.on('cheerMessage', (data) => {
      if (!socket.authenticated || socket.role !== 'spectator') return;
      
      const { message } = data;
      const allowedCheers = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
      
      if (!allowedCheers.includes(message)) {
        socket.emit('chatError', '허용되지 않은 응원 메시지입니다');
        return;
      }
      
      battleEngine.addChatMessage(
        socket.battleId,
        socket.spectatorName,
        message,
        'spectator'
      );
      
      const battle = battleEngine.getBattle(socket.battleId);
      io.to(socket.battleId).emit('battleUpdate', serializeBattleForAll(battle));
    });

    // ===== 연결 관리 이벤트 =====
    
    // 하트비트
    socket.on('heartbeat', () => {
      socket.emit('heartbeat', { timestamp: Date.now() });
    });
    
    // 연결 해제
    socket.on('disconnect', () => {
      console.log('소켓 연결 해제:', socket.id);
      
      if (socket.authenticated) {
        if (socket.role === 'player' && socket.playerId) {
          // 플레이어 연결 상태 업데이트
          battleEngine.updatePlayerConnection(socket.battleId, socket.playerId, false);
          
          const battle = battleEngine.getBattle(socket.battleId);
          if (battle) {
            socket.to(socket.battleId).emit('battleUpdate', serializeBattleForAll(battle));
          }
        } else if (socket.role === 'spectator') {
          // 관전자 수 업데이트
          const spectatorCount = io.sockets.adapter.rooms.get(`${socket.battleId}-spectators`)?.size || 0;
          io.to(socket.battleId).emit('connectionStatus', {
            battleId: socket.battleId,
            spectatorCount: spectatorCount
          });
        }
      }
    });
  });

  // ===== 직렬화 함수들 =====
  
  // 플레이어용 직렬화 (자신의 정보만 상세)
  function serializeBattleForPlayer(battle, playerId) {
    const player = battleEngine.findPlayer(battle, playerId);
    const myTeam = player ? player.team : null;
    
    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      teams: {
        team1: {
          name: battle.teams.team1.name,
          players: battle.teams.team1.players.map(p => ({
            ...p,
            inventory: p.id === playerId ? p.inventory : undefined // 자신의 인벤토리만
          }))
        },
        team2: {
          name: battle.teams.team2.name,
          players: battle.teams.team2.players.map(p => ({
            ...p,
            inventory: p.id === playerId ? p.inventory : undefined
          }))
        }
      },
      currentTeam: battle.currentTeam,
      currentPlayerIndex: battle.currentPlayerIndex,
      roundNumber: battle.roundNumber,
      turnNumber: battle.turnNumber,
      battleLog: battle.battleLog.slice(-30),
      chatLog: battle.chatLog.slice(-30),
      turnStartTime: battle.turnStartTime,
      winner: battle.winner,
      endReason: battle.endReason
    };
  }
  
  // 관전자용 직렬화 (민감한 정보 제외)
  function serializeBattleForSpectator(battle) {
    return {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      teams: {
        team1: {
          name: battle.teams.team1.name,
          players: battle.teams.team1.players.map(p => ({
            id: p.id,
            name: p.name,
            team: p.team,
            hp: p.hp,
            maxHp: p.maxHp,
            stats: p.stats,
            alive: p.alive,
            connected: p.connected,
            isReady: p.isReady,
            hasActed: p.hasActed,
            isDefending: p.isDefending,
            isDodging: p.isDodging,
            imageUrl: p.imageUrl,
            buffs: p.buffs
            // inventory 제외
          }))
        },
        team2: {
          name: battle.teams.team2.name,
          players: battle.teams.team2.players.map(p => ({
            id: p.id,
            name: p.name,
            team: p.team,
            hp: p.hp,
            maxHp: p.maxHp,
            stats: p.stats,
            alive: p.alive,
            connected: p.connected,
            isReady: p.isReady,
            hasActed: p.hasActed,
            isDefending: p.isDefending,
            isDodging: p.isDodging,
            imageUrl: p.imageUrl,
            buffs: p.buffs
          }))
        }
      },
      currentTeam: battle.currentTeam,
      currentPlayerIndex: battle.currentPlayerIndex,
      roundNumber: battle.roundNumber,
      turnNumber: battle.turnNumber,
      battleLog: battle.battleLog.slice(-30),
      chatLog: battle.chatLog.slice(-30),
      turnStartTime: battle.turnStartTime,
      winner: battle.winner,
      endReason: battle.endReason
    };
  }
  
  // 모든 클라이언트용 직렬화
  function serializeBattleForAll(battle) {
    // 기본적으로 관전자용 직렬화 사용
    return serializeBattleForSpectator(battle);
  }
  
  // 외부에서 사용할 수 있도록 export
  return {
    issueOTP,
    verifyOTP,
    otpStore,
    authTokens
  };
};
