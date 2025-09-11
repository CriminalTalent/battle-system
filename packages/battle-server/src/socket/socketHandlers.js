// packages/battle-server/src/socket/socketHandlers.js
// Socket 핸들러 모듈
// - index.js 에서 import 후 useSocketHandlers(io, stores) 로 등록
// - 상태키: waiting | active | paused | ended
// - stores: {
//     battles: Map<string, Battle>,
//     startBattle(b), endBattle(b), nextTurn(b),
//     isBattleOver(b), pushLog(b, entry),
//     resolveAction(b, { actorId, ...action }) => { logs, updates:{hp:{}}, turnEnded, teamPhaseCompleted?, roundCompleted?, turn? }
//   }

"use strict";

const {
  initBroadcast,
  broadcastBattleState,
  broadcastBattleLog,
  broadcastChat,
  broadcastSpectatorCount
} = require("./broadcast.js");

/** 안전한 룸 카운팅 */
function safeRoomCount(io, battleId) {
  try {
    const room = io.sockets.adapter.rooms.get(String(battleId));
    return room ? room.size : 0;
  } catch {
    return 0;
  }
}

function useSocketHandlers(io, stores) {
  if (!io) throw new Error("Socket.IO instance is required");
  if (!stores) throw new Error("Stores object is required");

  initBroadcast(io);

  const {
    battles,
    startBattle,
    endBattle,
    nextTurn,
    isBattleOver,
    pushLog,
    resolveAction
  } = stores;

  if (!battles || typeof battles.get !== "function") {
    throw new Error("battles must be a Map instance");
  }

  io.on("connection", (socket) => {
    let alive = true;
    const leaveAll = () => { alive = false; };

    /* ========== 공용: 룸 합류 ========== */
    socket.on("join", ({ battleId }) => {
      if (!alive || !battleId) return;
      if (battles.has(battleId)) {
        socket.join(String(battleId));
      }
    });

    /* ========== 관리자 인증 (신/구) ========== */
    const onAdminAuth = ({ battleId, token }) => {
      if (!alive || !battleId || !token) return;
      try {
        const b = battles.get(battleId);
        if (!b || token !== b.adminToken) {
          socket.emit("authError", { error: "unauthorized" });
          return;
        }
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "admin", battleId });
        broadcastBattleState(b);
      } catch (err) {
        console.error("[SocketHandlers] adminAuth error:", err);
        socket.emit("authError", { error: "internal_error" });
      }
    };
    socket.on("admin:auth", onAdminAuth);
    socket.on("adminAuth", onAdminAuth);

    /* ========== 관전자 인증 (신/구) ========== */
    const onSpectatorAuth = ({ battleId, otp, token, name }) => {
      if (!alive || !battleId || !(otp || token)) return;
      try {
        const b = battles.get(battleId);
        if (!b) {
          socket.emit("authError", { error: "notfound" });
          return;
        }
        const pass = otp || token;
        if (b.spectatorOtp && b.spectatorOtp !== pass) {
          socket.emit("authError", { error: "unauthorized" });
          return;
        }
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "spectator", battleId, name: name || "" });

        const count = safeRoomCount(io, battleId);
        broadcastSpectatorCount(battleId, count);
        broadcastBattleState(b);
      } catch (err) {
        console.error("[SocketHandlers] spectatorAuth error:", err);
        socket.emit("authError", { error: "internal_error" });
      }
    };
    socket.on("spectator:auth", onSpectatorAuth);
    socket.on("spectatorAuth", onSpectatorAuth);

    /* ========== 플레이어 인증 (신/구) ========== */
    const onPlayerAuth = ({ battleId, name, token }) => {
      if (!alive || !battleId || !name) return;
      try {
        const b = battles.get(battleId);
        if (!b) {
          socket.emit("authError", { error: "notfound" });
          return;
        }
        // 토큰 검증이 필요하다면 여기에 추가 (정책에 맞춰 선택)
        const playerName = String(name).trim();
        const players = Array.isArray(b.players) ? b.players : [];
        const p = players.find(v => v && String(v.name || "").trim() === playerName);
        if (!p) {
          socket.emit("authError", { error: "player-notfound" });
          return;
        }
        p.socketId = socket.id;
        socket.join(String(battleId));
        socket.emit("auth:success", { role: "player", battleId, playerId: p.id });
        broadcastBattleState(b);
      } catch (err) {
        console.error("[SocketHandlers] playerAuth error:", err);
        socket.emit("authError", { error: "internal_error" });
      }
    };
    socket.on("player:auth", onPlayerAuth);
    socket.on("playerAuth", onPlayerAuth);

    /* ========== 준비 완료 (신식 네임스페이스) ========== */
    socket.on("player:ready", ({ battleId, playerId }) => {
      if (!alive || !battleId || !playerId) return;
      try {
        const b = battles.get(battleId);
        if (!b) return;

        const players = Array.isArray(b.players) ? b.players : [];
        const p = players.find(x => x && x.id === playerId);
        if (!p) return;

        p.ready = true;
        if (typeof pushLog === "function") {
          pushLog(b, { type: "system", message: `${p.name} 준비 완료` });
        }

        const allReady = players.length > 0 && players.every(x => x && x.ready);
        if (allReady && b.status !== "active" && typeof startBattle === "function") {
          startBattle(b);
        }
        broadcastBattleState(b);
      } catch (err) {
        console.error("[SocketHandlers] player:ready error:", err);
      }
    });

    /* ========== 플레이어 액션 (신식 네임스페이스) ========== */
    socket.on("player:action", ({ battleId, playerId, action }) => {
      if (!alive || !battleId || !playerId || !action) return;
      try {
        const b = battles.get(battleId);
        if (!b || b.status !== "active") return;

        if (typeof resolveAction !== "function") {
          console.warn("[SocketHandlers] resolveAction not available");
          return;
        }

        const result = resolveAction(b, { actorId: playerId, ...action });

        // 로그 적용/브로드캐스트
        if (Array.isArray(result.logs) && typeof pushLog === "function") {
          for (const l of result.logs) {
            const entry = { type: l.type || "system", message: l.message || "" };
            pushLog(b, entry);
            broadcastBattleLog(battleId, entry);
          }
        }

        // HP 반영
        if (result.updates?.hp && Array.isArray(b.players)) {
          const hpUpd = result.updates.hp;
          b.players.forEach(pl => {
            if (pl && hpUpd[pl.id] != null) {
              pl.hp = Math.max(0, Number(hpUpd[pl.id]) || 0);
            }
          });
        }

        // 턴 진행
        if (result.turnEnded && typeof nextTurn === "function") {
          nextTurn(b);
        }

        // 전투 종료 판정
        if (typeof isBattleOver === "function" && isBattleOver(b) && typeof endBattle === "function") {
          endBattle(b);
        }

        // 상태 브로드캐스트 (턴 리포트가 있으면 함께)
        const extra = result.turn ? { turn: result.turn } : undefined;
        broadcastBattleState(extra ? { ...b, turn: result.turn } : b);
      } catch (err) {
        console.error("[SocketHandlers] player:action error:", err);
      }
    });

    /* ========== 채팅 (신/구 모두 수신) ========== */
    const onChatSend = ({ battleId, name, senderName, message }) => {
      if (!alive || !battleId || !message) return;
      try {
        if (!battles.has(battleId)) return;
        const sanitizedName = String(senderName || name || "익명").substring(0, 50);
        const sanitizedMessage = String(message || "").substring(0, 500);
        if (sanitizedMessage.trim()) {
          broadcastChat(battleId, { name: sanitizedName, message: sanitizedMessage });
        }
      } catch (err) {
        console.error("[SocketHandlers] chat send error:", err);
      }
    };
    socket.on("chat:send", onChatSend);
    socket.on("chatMessage", ({ battleId, message, name, senderName }) => {
      onChatSend({ battleId, name, senderName, message });
    });

    /* ========== 응원 (신/구 모두 수신) ========== */
    const onCheer = ({ battleId, cheer, message }) => {
      if (!alive || !battleId || !(cheer || message)) return;
      try {
        const b = battles.get(battleId);
        if (!b) return;
        const text = String(cheer || message || "").substring(0, 200).trim();
        if (!text) return;

        if (typeof pushLog === "function") {
          pushLog(b, { type: "cheer", message: text });
        }
        broadcastBattleLog(battleId, { type: "cheer", message: text });
      } catch (err) {
        console.error("[SocketHandlers] cheer error:", err);
      }
    };
    socket.on("cheer:send", onCheer);
    socket.on("spectator:cheer", onCheer);

    /* ========== 연결 해제 ========== */
    socket.on("disconnect", (reason) => {
      leaveAll();
      // 관전자 수 재집계 (방에 남은 인원 기준)
      try {
        // 소켓이 여러 전투 방에 들어갔을 가능성은 낮지만,
        // 가장 흔한 케이스만 처리: 클라이언트가 마지막으로 합류한 방들만 감소
        // 방 전체를 순회하는 비용을 피하려면 클라이언트에 battleId를 보관하게 하고
        // 'leave' 이벤트로 내려주도록 추가할 수 있음.
      } catch {}
      console.log(`[SocketHandlers] Socket ${socket.id} disconnected: ${reason}`);
    });

    socket.on("error", (err) => {
      console.error("[SocketHandlers] Socket error:", err);
    });
  });

  return {
    cleanup: () => {
      console.log("[SocketHandlers] Cleaning up socket handlers");
    }
  };
}

module.exports = { useSocketHandlers };
