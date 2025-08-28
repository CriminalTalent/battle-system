// packages/battle-server/src/socket/battleSocket.js
const {
  getBattleState,
  validatePlayerOTP,
  validateAdminOTP,
  validateSpectatorOTP,
} = require('../logic/battleAccess');
const {
  getBattleById,
  getBattleForBroadcast,
} = require('../logic/battleStore');
const {
  saveChatMessage,
} = require('../logic/chatLogic');

module.exports = function (io) {
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // 인증된 소켓 정보 저장
    socket.auth = {
      battleId: null,
      role: null,
      playerId: null,
    };

    // 공통 룸 이름 생성기
    const getRoomName = (battleId, role) => `${battleId}-${role}`;

    // 내부 브로드캐스트 함수
    const broadcastToBattle = async (
      battleId,
      event,
      data,
      roles = ['admin', 'player', 'spectator']
    ) => {
      if (!battleId || !event) return;
      for (const role of roles) {
        const room = getRoomName(battleId, role);
        io.to(room).emit(event, data);
      }
    };

    // 역할별 인증 핸들러
    socket.on('playerAuth', async ({ battleId, playerId, otp }) => {
      const valid = validatePlayerOTP(battleId, playerId, otp);
      if (!valid) return socket.emit('authError', '플레이어 인증 실패');

      socket.auth = { battleId, playerId, role: 'player' };
      socket.join(getRoomName(battleId, 'player'));

      const state = await getBattleForBroadcast(battleId);
      socket.emit('authSuccess', { battle: state });
    });

    socket.on('adminAuth', async ({ battleId, otp }) => {
      const valid = validateAdminOTP(battleId, otp);
      if (!valid) return socket.emit('authError', '관리자 인증 실패');

      socket.auth = { battleId, role: 'admin' };
      socket.join(getRoomName(battleId, 'admin'));

      const state = await getBattleForBroadcast(battleId);
      socket.emit('authSuccess', { battle: state });
    });

    socket.on('spectatorAuth', async ({ battleId, otp }) => {
      const valid = validateSpectatorOTP(battleId, otp);
      if (!valid) return socket.emit('authError', '관전자 인증 실패');

      socket.auth = { battleId, role: 'spectator' };
      socket.join(getRoomName(battleId, 'spectator'));

      const state = await getBattleForBroadcast(battleId);
      socket.emit('authSuccess', { battle: state });
    });

    // 관리자 전용: 인증 없이도 초기 진입 가능
    socket.on('join-battle', async ({ battleId, role }) => {
      if (!battleId || !['admin', 'player', 'spectator'].includes(role)) return;

      socket.auth = { battleId, role };
      socket.join(getRoomName(battleId, role));

      const state = await getBattleForBroadcast(battleId);
      socket.emit('battle-state', { state });
    });

    // 채팅 메시지 전송
    socket.on('send-chat', async ({ battleId, sender, senderType, message }) => {
      if (
        typeof battleId !== 'string' ||
        typeof sender !== 'string' ||
        typeof message !== 'string' ||
        message.length > 500
      ) {
        return;
      }

      const battle = await getBattleById(battleId);
      if (!battle) return;

      const chatEntry = {
        sender,
        senderType: senderType || 'system',
        message,
        timestamp: Date.now(),
      };

      await saveChatMessage(battleId, chatEntry);
      broadcastToBattle(battleId, 'chat-message', { message: chatEntry });
    });

    // 향후 추가 이벤트 핸들링 가능
    // 예시:
    // socket.on('action-executed', async (...))
    // socket.on('battle-ended', async (...))
  });
};
