// Socket.IO 배틀 이벤트 핸들러
module.exports = function(io, battleEngine) {
  const socketMap = new Map(); // 소켓 상태 저장

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
    }, 5 * 60 * 1000);

    return otp;
  }

  // Socket 연결 처리
  io.on('connection', (socket) => {
    console.log(`소켓 연결됨: ${socket.id}`);

    // 소켓 정보 저장
    socketMap.set(socket.id, {
      id: socket.id,
      authenticated: false,
      role: null,
      battleId: null,
      playerId: null,
      connectedAt: Date.now()
    });

    // 예시 인증 이벤트
    socket.on('auth', (data) => {
      const { otp } = data;
      const otpData = otpStore.get(otp);

      if (!otpData || otpData.used) {
        socket.emit('authError', '유효하지 않은 OTP입니다.');
        return;
      }

      otpData.used = true;
      const socketInfo = socketMap.get(socket.id);
      socketInfo.authenticated = true;
      socketInfo.role = otpData.role;
      socketInfo.battleId = otpData.battleId;
      socketInfo.playerId = otpData.playerName || null;

      socket.join(otpData.battleId);
      socket.emit('authSuccess', { role: otpData.role, battleId: otpData.battleId });
    });

    // 예시 전투 동기화 요청
    socket.on('syncBattle', () => {
      const socketInfo = socketMap.get(socket.id);
      if (!socketInfo || !socketInfo.authenticated) return;

      const battle = battleEngine.getBattle(socketInfo.battleId);
      if (!battle) return;

      const sanitized = sanitizeBattleForRole(battle, socketInfo.role, socketInfo.playerId);
      socket.emit('battleSync', { battle: sanitized });
    });

    // 연결 해제 처리
    socket.on('disconnect', () => {
      console.log(`소켓 해제됨: ${socket.id}`);
      socketMap.delete(socket.id);
    });
  });

  // 아래 함수들은 내부 유틸 함수로 사용 가능

  /**
   * 전투별 브로드캐스트 (강화된 안전성)
   */
  function broadcastToBattle(io, sockets, battleId, event, data = null, excludeSocketId = null) {
    const room = io.sockets.adapter.rooms.get(battleId);
    if (!room) return;

    const stats = { total: 0, admins: 0, players: 0, spectators: 0 };

    for (const socketId of room) {
      if (excludeSocketId && socketId === excludeSocketId) continue;

      const socketInfo = sockets.get(socketId);
      if (!socketInfo || !socketInfo.authenticated) continue;

      const socket = io.sockets.sockets.get(socketId);
      if (!socket || socket.disconnected) continue;

      stats.total++;
      if (socketInfo.role === 'admin') stats.admins++;
      else if (socketInfo.role === 'player') stats.players++;
      else if (socketInfo.role === 'spectator') stats.spectators++;

      socket.emit(event, data);
    }

    console.log(`[broadcastToBattle] 전투 ${battleId} | 이벤트: ${event} | 대상: ${stats.total}명 (관리자: ${stats.admins}, 플레이어: ${stats.players}, 관전자: ${stats.spectators})`);
  }

  /**
   * 역할별 전투 정보 필터링
   */
  function sanitizeBattleForRole(battle, role, playerId = null) {
    const base = {
      id: battle.id,
      mode: battle.mode,
      status: battle.status,
      currentTeam: battle.currentTeam,
      roundNumber: battle.roundNumber,
      turnNumber: battle.turnNumber,
      turnStartTime: battle.turnStartTime,
      battleLog: battle.battleLog?.slice(-50) || [],
      chatLog: battle.chatLog?.slice(-30) || [],
      winner: battle.winner,
      endReason: battle.endReason
    };

    if (role === 'admin') {
      return {
        ...base,
        teams: battle.teams,
        actionHistory: battle.actionHistory,
        finalStats: battle.finalStats,
        otps: battle.otps
      };
    }

    if (role === 'player') {
      const sanitizedTeams = {};
      for (const teamKey of Object.keys(battle.teams)) {
        sanitizedTeams[teamKey] = {
          ...battle.teams[teamKey],
          players: battle.teams[teamKey].players.map(p => ({
            ...p,
            inventory: p.id === playerId ? p.inventory : undefined
          }))
        };
      }
      return { ...base, teams: sanitizedTeams };
    }

    if (role === 'spectator') {
      const sanitizedTeams = {};
      for (const teamKey of Object.keys(battle.teams)) {
        sanitizedTeams[teamKey] = {
          name: battle.teams[teamKey].name,
          players: battle.teams[teamKey].players.map(p => ({
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
        };
      }
      return { ...base, teams: sanitizedTeams };
    }

    return base;
  }

  /**
   * 관전자 기준 브로드캐스트용 전투 정보
   */
  function sanitizeBattleForBroadcast(battle) {
    return sanitizeBattleForRole(battle, 'spectator');
  }

  // 필요한 경우 외부로 유틸 내보내기
  module.exports.utils = {
    broadcastToBattle: (battleId, event, data, excludeSocketId) =>
      broadcastToBattle(io, socketMap, battleId, event, data, excludeSocketId),
    sanitizeBattleForBroadcast
  };
};
