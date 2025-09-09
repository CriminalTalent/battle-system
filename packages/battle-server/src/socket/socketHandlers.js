// Socket 핸들러 모듈
// - index.js 에서 import 후 useSocketHandlers(io, stores) 로 등록
// - 상태키: waiting | active | paused | ended
// - stores: { battles: Map<string, Battle>, startBattle, endBattle, nextTurn, isBattleOver, pushLog, broadcastState, onSpectatorCount? }

const { 
  broadcastBattleState, 
  broadcastBattleLog, 
  broadcastChat, 
  broadcastSpectatorCount, 
  initBroadcast 
} = require("./broadcast.js");

function useSocketHandlers(io, stores) {
  if (!io) {
    throw new Error('Socket.IO instance is required');
  }

  if (!stores) {
    throw new Error('Stores object is required');
  }

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

  // 검증
  if (!battles || typeof battles.get !== 'function') {
    throw new Error('battles must be a Map instance');
  }

  io.on("connection", (socket) => {
    let isConnected = true;
    
    // 연결 정리 헬퍼
    const cleanup = () => {
      isConnected = false;
    };

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
    socket.on("adminAuth", ({ battleId, token }) => {
      if (!isConnected || !battleId || !token) return;
      
      try {
        const b = battles.get(battleId);
        if (!b || token !== b.adminToken) {
          socket.emit("authError", { error: "unauthorized" });
          return;
        }
        
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "admin", battleId });
        broadcastBattleState(b);
      } catch (error) {
        console.error('[SocketHandlers] adminAuth error:', error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    // 관전자 인증(간이)
    socket.on("spectatorAuth", ({ battleId, otp }) => {
      if (!isConnected || !battleId || !otp) return;
      
      try {
        const b = battles.get(battleId);
        if (!b || otp !== b.spectatorOtp) {
          socket.emit("authError", { error: "unauthorized" });
          return;
        }
        
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "spectator", battleId });
        
        const roomInfo = io.sockets.adapter.rooms.get(String(battleId));
        const count = roomInfo ? roomInfo.size : 1;
        broadcastSpectatorCount(battleId, count);
        broadcastBattleState(b);
      } catch (error) {
        console.error('[SocketHandlers] spectatorAuth error:', error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    // 플레이어 인증(이름 매칭)
    socket.on("playerAuth", ({ battleId, name }) => {
      if (!isConnected || !battleId || !name) return;
      
      try {
        const b = battles.get(battleId);
        if (!b) {
          socket.emit("authError", { error: "notfound" });
          return;
        }
        
        const players = Array.isArray(b.players) ? b.players : [];
        const playerName = String(name).trim();
        const p = players.find(v => 
          v && String(v.name || "").trim() === playerName
        );
        
        if (!p) {
          socket.emit("authError", { error: "player-notfound" });
          return;
        }
        
        p.socketId = socket.id;
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "player", battleId, playerId: p.id });
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
        
        // 로그
        if (Array.isArray(result.logs) && typeof pushLog === 'function') {
          for (const l of result.logs) {
            pushLog(b, { 
              type: l.type || "system", 
              message: l.message || "" 
            });
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
        
        if (typeof isBattleOver === 'function' && isBattleOver(b) && typeof endBattle === 'function') {
          endBattle(b);
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
      // 정리 작업
      console.log('[SocketHandlers] Cleaning up socket handlers');
    }
  };
}

module.exports = {
  useSocketHandlers
};dMessage.trim()) {
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
        
        if (sanitize
