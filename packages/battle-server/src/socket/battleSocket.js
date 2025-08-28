// Socket.IO 배틀 이벤트 핸들러
module.exports = function(io, battleEngine) {

  const optStore = new Map();
  const authTokens = new Map();
  const socketMap = new Map(); // socketId -> { battleId, role, authenticated, playerName }

  // === 내부 유틸 ===

  function generateOTP() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  function issueOTP(battleId, role, playerName = null) {
    const otp = generateOTP();
    const otpData = {
      battleId,
      role,
      playerName,
      createdAt: Date.now(),
      used: false
    };

    optStore.set(otp, otpData);

    setTimeout(() => {
      optStore.delete(otp);
    }, 5 * 60 * 1000); // 5분 뒤 삭제

    return otp;
  }

  function validateOTP(otp, expectedRole) {
    const data = optStore.get(otp);
    if (!data || data.role !== expectedRole || data.used) return null;
    data.used = true;
    return data;
  }

  // === 소켓 연결 ===

  io.on('connection', (socket) => {
    console.log(`[소켓 연결됨] ${socket.id}`);

    socket.on('adminAuth', ({ battleId, otp }) => {
      const data = validateOTP(otp, 'admin');
      if (!data || data.battleId !== battleId) {
        socket.emit('authError', '유효하지 않은 OTP 또는 배틀 ID');
        return;
      }

      socket.join(battleId);
      socketMap.set(socket.id, {
        battleId,
        role: 'admin',
        authenticated: true
      });

      const battle = battleEngine.getBattleById(battleId);
      if (!battle) {
        socket.emit('authError', '배틀을 찾을 수 없습니다');
        return;
      }

      socket.emit('authSuccess', {
        role: 'admin',
        battle: sanitizeBattleForRole(battle, 'admin')
      });

      broadcastToBattle(io, socketMap, battleId, 'playerConnected', {
        playerName: '관리자'
      });
    });

    socket.on('disconnect', () => {
      const info = socketMap.get(socket.id);
      if (info) {
        console.log(`[소켓 연결 해제됨] ${socket.id} (${info.role})`);
        socketMap.delete(socket.id);

        broadcastToBattle(io, socketMap, info.battleId, 'playerDisconnected', {
          playerName: info.playerName || info.role
        });
      }
    });

    // ... 여기에 필요한 다른 socket.on 이벤트 추가 가능
  });

  /**
   * 안전하고 인증된 브로드캐스트 함수
   */
  function broadcastToBattle(io, sockets, battleId, event, data = null, excludeSocketId = null) {
    const room = io.sockets.adapter.rooms.get(battleId);
    if (!room) return;

    const stats = {
      total: 0, players: 0, spectators: 0, admins: 0
    };

    for (const socketId of room) {
      if (excludeSocketId && socketId === excludeSocketId) continue;

      const info = sockets.get(socketId);
      if (!info || !info.authenticated || info.battleId !== battleId) continue;

      const socket = io.sockets.sockets.get(socketId);
      if (!socket || socket.disconnected) continue;

      switch (info.role) {
        case 'player': stats.players++; break;
        case 'spectator': stats.spectators++; break;
        case 'admin': stats.admins++; break;
      }

      stats.total++;

      socket.emit(event, data);
    }

    console.log(`[broadcast] 전투 ${battleId} | ${event} | 대상 ${stats.total}명 (관리자: ${stats.admins}, 플레이어: ${stats.players}, 관전자: ${stats.spectators})`);
  }

  /**
   * 역할에 따른 배틀 정보 필터링
   */
  function sanitizeBattleForRole(battle, role, playerId = null) {
    const base = {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      roundNumber: battle.roundNumber,
      turnNumber: battle.turnNumber,
      turnStartTime: battle.turnStartTime,
      currentTeam: battle.currentTeam,
      battleLog: battle.battleLog?.slice(-50) || [],
      chatLog: battle.chatLog?.slice(-30) || [],
      winner: battle.winner,
      endReason: battle.endReason
    };

    if (role === 'admin') {
      return {
        ...base,
        teams: battle.teams,
        otps: battle.otps,
        actionHistory: battle.actionHistory || [],
        finalStats: battle.finalStats || {}
      };
    }

    if (role === 'player') {
      const teams = {};
      for (const teamKey in battle.teams) {
        teams[teamKey] = {
          name: battle.teams[teamKey].name,
          players: battle.teams[teamKey].players.map(player => ({
            id: player.id,
            name: player.name,
            team: player.team,
            hp: player.hp,
            maxHp: player.maxHp,
            alive: player.alive,
            connected: player.connected,
            isReady: player.isReady,
            hasActed: player.hasActed,
            imageUrl: player.imageUrl,
            isDefending: player.isDefending,
            isDodging: player.isDodging,
            buffs: player.buffs,
            inventory: player.id === playerId ? player.inventory : undefined
          }))
        };
      }
      return { ...base, teams };
    }

    if (role === 'spectator') {
      const teams = {};
      for (const teamKey in battle.teams) {
        teams[teamKey] = {
          name: battle.teams[teamKey].name,
          players: battle.teams[teamKey].players.map(player => ({
            id: player.id,
            name: player.name,
            team: player.team,
            hp: player.hp,
            maxHp: player.maxHp,
            alive: player.alive,
            connected: player.connected,
            imageUrl: player.imageUrl,
            isDefending: player.isDefending,
            isDodging: player.isDodging,
            hasActed: player.hasActed,
            isReady: player.isReady,
            buffs: player.buffs
          }))
        };
      }
      return { ...base, teams };
    }

    return base;
  }

};
