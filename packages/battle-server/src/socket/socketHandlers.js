// packages/battle-server/src/socket/socketHandlers.js

const BattleEngine = require('../engine/BattleEngine');
const OTPManager = require('../utils/OTPManager');

const otpManager = new OTPManager();
const activeBattles = new Map(); // battleId -> BattleEngine

function socketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('연결됨:', socket.id);

    socket.on('createBattle', ({ players, battleId }) => {
      const engine = new BattleEngine(battleId, players, io, () => {
        activeBattles.delete(battleId);
      });
      activeBattles.set(battleId, engine);

      socket.join(battleId);
      socket.emit('battleCreated', { battleId });
    });

    socket.on('joinBattle', ({ battleId, playerId }) => {
      socket.join(battleId);
      socket.to(battleId).emit('playerJoined', { playerId });
    });

    socket.on('playerAction', ({ battleId, playerId, action }) => {
      const engine = activeBattles.get(battleId);
      if (!engine) return;
      engine.performAction(playerId, action);
    });

    socket.on('validateSpectator', ({ otp }, callback) => {
      const valid = otpManager.validateOTP(otp);
      if (valid) {
        const nickname = otpManager.getNickname(otp);
        callback({ valid: true, nickname });
      } else {
        callback({ valid: false });
      }
    });

    socket.on('generateSpectatorOtp', ({ nickname }, callback) => {
      const otp = otpManager.generateOTP(nickname);
      if (!otp) {
        callback({ success: false, reason: '최대 30명 초과' });
        return;
      }
      callback({ success: true, otp });
    });

    socket.on('disconnect', () => {
      console.log('연결 종료:', socket.id);
    });
  });
}

module.exports = socketHandlers;
