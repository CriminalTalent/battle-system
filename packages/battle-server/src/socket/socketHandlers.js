// packages/battle-server/src/socket/socketHandlers.js
// Socket 핸들러 모듈
// - index.js 에서 import 후 useSocketHandlers(io, stores) 로 등록
// - 상태키: waiting | active | paused | ended
// - stores: { battles: Map<string, Battle>, startBattle, endBattle, nextTurn, isBattleOver, pushLog, resolveAction }

const { 
  broadcastBattleState, 
  broadcastBattleLog, 
  broadcastChat, 
  broadcastSpectatorCount, 
  initBroadcast 
} = require("./broadcast.js");

const { cleanupOTPsForBattle } = require("../utils/battleCleanup");

/**
 * 인증 유틸: OTPManager가 있으면 우선 사용하고, 없으면 battle 스냅샷 기반으로 비교.
 */
function makeAuthHelpers(io, battles) {
  return {
    /**
     * 관리자 인증
     * payload: { battleId, otp? }
     */
    adminAuth: (socket, payload) => {
      const { battleId, otp } = payload || {};
      if (!battleId) return { ok: false, reason: "invalid" };

      const app = socket.request?.app;
      const otpMgr = app?.get?.("otp");

      // 1) OTPManager 우선
      if (otpMgr && otp) {
        const v = otpMgr.validateOTP(otp, { ip: socket.handshake?.address });
        if (!v.valid || v.type !== "admin" || v.data?.battleId !== battleId) {
          return { ok: false, reason: "unauthorized" };
        }
        return { ok: true, via: "otp", battleId };
      }

      // 2) Fallback: battle.adminToken/adminOtp 비교
      const b = battles.get(battleId);
      if (!b) return { ok: false, reason: "notfound" };
      const snapshot = b.getSnapshot?.() || b.getBattleState?.() || {};
      const adminToken = b.adminToken || snapshot.adminOtp || snapshot.adminToken;
      if (!adminToken || adminToken !== otp) return { ok: false, reason: "unauthorized" };
      return { ok: true, via: "fallback", battleId };
    },

    /**
     * 관전자 인증
     * payload: { battleId, token? , otp? }
     */
    spectatorAuth: (socket, payload) => {
      const { battleId, token, otp } = payload || {};
      if (!battleId) return { ok: false, reason: "invalid" };

      const app = socket.request?.app;
      const otpMgr = app?.get?.("otp");

      // 1) OTPManager 우선 (token/otp 중 아무 키나 허용)
      const candidate = token || otp;
      if (otpMgr && candidate) {
        const v = otpMgr.validateOTP(candidate, { ip: socket.handshake?.address });
        if (!v.valid || v.type !== "spectator" || v.data?.battleId !== battleId) {
          return { ok: false, reason: "unauthorized" };
        }
        return { ok: true, via: "otp", battleId };
      }

      // 2) Fallback: battle.spectatorOtp 비교
      const b = battles.get(battleId);
      if (!b) return { ok: false, reason: "notfound" };
      const snapshot = b.getSnapshot?.() || b.getBattleState?.() || {};
      const spectatorOtp = b.spectatorOtp || snapshot.spectatorOtp;
      if (!spectatorOtp || spectatorOtp !== candidate) return { ok: false, reason: "unauthorized" };
      return { ok: true, via: "fallback", battleId };
    },

    /**
     * 플레이어 인증
     * payload: { battleId, name?, token? }
     * - OTPManager를 사용하면 token(=player OTP)만으로 인증하고, playerId는 data에서 가져옴
     * - Fallback은 이름 매칭 후, 필요 시 player.token 확인
     */
    playerAuth: (socket, payload) => {
      const { battleId, name, token } = payload || {};
      if (!battleId) return { ok: false, reason: "invalid" };

      const app = socket.request?.app;
      const otpMgr = app?.get?.("otp");

      // 1) OTPManager 우선
      if (otpMgr && token) {
        const v = otpMgr.validateOTP(token, { ip: socket.handshake?.address });
        if (!v.valid || v.type !== "player" || v.data?.battleId !== battleId) {
          return { ok: false, reason: "unauthorized" };
        }
        const playerId = v.data?.playerId;
        if (!playerId) return { ok: false, reason: "unauthorized" };
        return { ok: true, via: "otp", battleId, playerId };
      }

      // 2) Fallback: 이름 매칭(필수)
      if (!name) return { ok: false, reason: "invalid" };
      const b = battles.get(battleId);
      if (!b) return { ok: false, reason: "notfound" };

      const players = Array.isArray(b.players) ? b.players : [];
      const playerName = String(name).trim();
      const p = players.find(v => v && String(v.name || "").trim() === playerName);
      if (!p) return { ok: false, reason: "player-notfound" };

      // token이 있다면 추가 검증(선택)
      if (token && p.token && p.token !== token) {
        return { ok: false, reason: "unauthorized" };
      }

      return { ok: true, via: "fallback", battleId, playerId: p.id };
    }
  };
}

function useSocketHandlers(io, stores) {
  if (!io) throw new Error('Socket.IO instance is required');
  if (!stores) throw new Error('Stores object is required');

  initBroadcast(io);
  
  const {
    battles,
    startBattle,
    endBattle,
    nextTurn,
    isBattleOver,
    pushLog,
    resolveAction // (battle, { actorId, ...action }) => { logs, updates:{hp:{}}, turnEnded }
  } = stores;

  if (!battles || typeof battles.get !== 'function') {
    throw new Error('battles must be a Map instance');
  }

  const auth = makeAuthHelpers(io, battles);

  io.on("connection", (socket) => {
    let isConnected = true;

    const cleanup = () => { isConnected = false; };

    // 공용: 룸 합류
    socket.on("join", ({ battleId }) => {
      if (!isConnected || !battleId) return;
      try {
        if (battles.has(battleId)) {
          socket.join(String(battleId));
        }
      } catch (error) {
        console.error('[SocketHandlers] join error:', error);
      }
    });

    // 관리자 인증
    socket.on("adminAuth", (payload = {}) => {
      if (!isConnected) return;
      try {
        const r = auth.adminAuth(socket, payload);
        if (!r.ok) {
          socket.emit("authError", { error: r.reason || "unauthorized" });
          return;
        }
        const { battleId } = r;
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "admin", battleId });
        const b = battles.get(battleId);
        if (b) broadcastBattleState(b);
      } catch (error) {
        console.error('[SocketHandlers] adminAuth error:', error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    // 관전자 인증
    socket.on("spectatorAuth", (payload = {}) => {
      if (!isConnected) return;
      try {
        const r = auth.spectatorAuth(socket, payload);
        if (!r.ok) {
          socket.emit("authError", { error: r.reason || "unauthorized" });
          return;
        }
        const { battleId } = r;
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "spectator", battleId });

        // 관전자 수 브로드캐스트
        const roomInfo = io.sockets.adapter.rooms.get(String(battleId));
        const count = roomInfo ? roomInfo.size : 1;
        broadcastSpectatorCount(battleId, count);

        const b = battles.get(battleId);
        if (b) broadcastBattleState(b);
      } catch (error) {
        console.error('[SocketHandlers] spectatorAuth error:', error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    // 플레이어 인증
    socket.on("playerAuth", (payload = {}) => {
      if (!isConnected) return;
      try {
        const r = auth.playerAuth(socket, payload);
        if (!r.ok) {
          socket.emit("authError", { error: r.reason || "unauthorized" });
          return;
        }
        const { battleId, playerId } = r;
        const b = battles.get(battleId);
        if (!b) {
          socket.emit("authError", { error: "notfound" });
          return;
        }

        // 소켓-배틀 룸 조인
        socket.join(String(battleId));

        // 플레이어 소켓 ID 저장(선택)
        const players = Array.isArray(b.players) ? b.players : [];
        const p = players.find(x => x && x.id === playerId);
        if (p) p.socketId = socket.id;

        socket.emit("auth:success", { role: "player", battleId, playerId });
        broadcastBattleState(b);
      } catch (error) {
        console.error('[SocketHandlers] playerAuth error:', error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    // 준비
    socket.on("player:ready", ({ battleId, playerId }) => {
      if (!isConnected || !battleId || !playerId) return;
      try {
        const b = battles.get(battleId);
        if (!b) return;

        const players = Array.isArray(b.players) ? b.players : [];
        const p = players.find(x => x && x.id === playerId);
        if (!p) return;

        p.ready = true;

        if (typeof pushLog === 'function') {
          pushLog(b, { type: "system", message: `${p.name} 준비 완료` });
        }

        const allReady = players.length > 0 && players.every(x => x && x.ready);
        if (allReady && b.status !== "active" && typeof startBattle === 'function') {
          startBattle(b);
        } else {
          broadcastBattleState(b);
        }
      } catch (error) {
        console.error('[SocketHandlers] player:ready error:', error);
      }
    });

    // 행동
    socket.on("player:action", ({ battleId, playerId, action }) => {
      if (!isConnected || !battleId || !playerId || !action) return;
      try {
        const b = battles.get(battleId);
        if (!b || b.status !== "active") return;

        if (typeof resolveAction !== 'function') {
          console.warn('[SocketHandlers] resolveAction not available');
          return;
        }

        const result = resolveAction(b, { actorId: playerId, ...action });

        // 로그 반영
        if (Array.isArray(result.logs) && typeof pushLog === 'function') {
          for (const l of result.logs) {
            pushLog(b, { type: l.type || "system", message: l.message || "" });
          }
        }

        // HP 반영
        if (result.updates?.hp && Array.isArray(b.players)) {
          const hpUpd = result.updates.hp;
          b.players.forEach(pl => { 
            if (pl && hpUpd[pl.id] != null) {
              pl.hp = Math.max(0, hpUpd[pl.id]); 
            }
          });
        }

        if (result.turnEnded && typeof nextTurn === 'function') {
          nextTurn(b);
        }

        // 종료 판정 → 종료 및 OTP 정리
        if (typeof isBattleOver === 'function' && isBattleOver(b)) {
          if (typeof endBattle === 'function') endBattle(b);

          // 배틀 OTP 일괄 폐기
          const r = cleanupOTPsForBattle(socket.request?.app, battleId);
          console.log('[SocketHandlers] OTP cleanup on end:', { battleId, removed: r.removed, ok: r.ok });

          // 필요 시 결과 로그
          if (typeof pushLog === 'function') {
            pushLog(b, { type: "system", message: `전투 종료. OTP ${r.removed || 0}건 폐기` });
          }
        }

        broadcastBattleState(b);
      } catch (error) {
        console.error('[SocketHandlers] player:action error:', error);
      }
    });

    // 채팅
    socket.on("chat:send", ({ battleId, name, message }) => {
      if (!isConnected || !battleId || !message) return;
      try {
        if (!battles.has(battleId)) return;
        const sanitizedName = String(name || "익명").substring(0, 50);
        const sanitizedMessage = String(message || "").substring(0, 500);
        if (sanitizedMessage.trim()) {
          broadcastChat(battleId, { 
            name: sanitizedName, 
            message: sanitizedMessage 
          });
        }
      } catch (error) {
        console.error('[SocketHandlers] chat:send error:', error);
      }
    });

    // 응원
    socket.on("cheer:send", ({ battleId, cheer }) => {
      if (!isConnected || !battleId || !cheer) return;
      try {
        const b = battles.get(battleId);
        if (!b) return;
        const sanitizedCheer = String(cheer || "").substring(0, 200);
        if (sanitizedCheer.trim()) {
          if (typeof pushLog === 'function') {
            pushLog(b, { type: "cheer", message: sanitizedCheer });
          }
          broadcastBattleLog(battleId, { type: "cheer", message: sanitizedCheer });
        }
      } catch (error) {
        console.error('[SocketHandlers] cheer:send error:', error);
      }
    });

    // 연결 해제
    socket.on("disconnect", (reason) => {
      cleanup();
      console.log(`[SocketHandlers] Socket ${socket.id} disconnected: ${reason}`);
    });

    // 에러 처리
    socket.on("error", (error) => {
      console.error('[SocketHandlers] Socket error:', error);
    });
  });

  return {
    cleanup: () => {
      console.log('[SocketHandlers] Cleaning up socket handlers');
    }
  };
}

module.exports = {
  useSocketHandlers
};
