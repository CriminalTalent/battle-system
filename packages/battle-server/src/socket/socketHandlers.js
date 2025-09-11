// Socket 핸들러 모듈
// - index.js 에서 import 후 useSocketHandlers(io, stores) 로 등록
// - 상태키: waiting | active | paused | ended
// - stores: { battles: Map<string, Battle>, startBattle, endBattle, nextTurn, isBattleOver, pushLog, resolveAction }

"use strict";

const { wireBroadcast } = require("./broadcast"); // 앞서 정리한 broadcast.js 버전 사용

function roomId(battleId) {
  return `battle:${battleId}`;
}

function useSocketHandlers(io, stores) {
  if (!io) throw new Error("Socket.IO instance is required");
  if (!stores) throw new Error("Stores object is required");

  const {
    battles,
    startBattle,
    endBattle,
    nextTurn,
    isBattleOver,
    pushLog,
    resolveAction, // (battle, { actorId, ...action }) => { logs, updates:{hp:{}}, turnEnded, teamPhaseCompleted?, roundCompleted?, turn? }
  } = stores;

  if (!battles || typeof battles.get !== "function") {
    throw new Error("battles must be a Map instance");
  }

  // 브로드캐스트 유틸
  const bc = wireBroadcast(io);

  io.on("connection", (socket) => {
    let isConnected = true;

    const cleanup = () => {
      isConnected = false;
    };

    /* ========== 공용: 룸 합류 ========== */
    socket.on("join", ({ battleId }) => {
      if (!isConnected || !battleId) return;
      try {
        if (battles.has(battleId)) {
          bc.join(socket, battleId);
        }
      } catch (error) {
        console.error("[SocketHandlers] join error:", error);
      }
    });

    /* ========== 관리자 인증 ========== */
    socket.on("adminAuth", ({ battleId, token }) => {
      if (!isConnected || !battleId || !token) return;
      try {
        const b = battles.get(battleId);
        if (!b || token !== b.adminToken) {
          socket.emit("authError", { error: "unauthorized" });
          return;
        }
        bc.join(socket, battleId);
        socket.emit("authSuccess", { role: "admin", battleId });
        bc.emitBattleUpdate(b);
      } catch (error) {
        console.error("[SocketHandlers] adminAuth error:", error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    /* ========== 관전자 인증(간이) ========== */
    socket.on("spectatorAuth", ({ battleId, otp }) => {
      if (!isConnected || !battleId || !otp) return;
      try {
        const b = battles.get(battleId);
        if (!b || otp !== b.spectatorOtp) {
          socket.emit("authError", { error: "unauthorized" });
          return;
        }
        bc.join(socket, battleId);
        socket.emit("authSuccess", { role: "spectator", battleId });

        const info = io.sockets.adapter.rooms.get(roomId(battleId));
        const count = info ? info.size : 1;
        bc.emitSystem(battleId, { message: `관전자 입장 (${count})` });
        io.to(roomId(battleId)).emit("spectator:count", { count, ts: Date.now() });

        bc.emitBattleUpdate(b);
      } catch (error) {
        console.error("[SocketHandlers] spectatorAuth error:", error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    /* ========== 플레이어 인증(이름 매칭) ========== */
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
        const p = players.find((v) => v && String(v.name || "").trim() === playerName);
        if (!p) {
          socket.emit("authError", { error: "player-notfound" });
          return;
        }
        p.socketId = socket.id;
        bc.join(socket, battleId);
        socket.emit("authSuccess", { role: "player", battleId, playerId: p.id });
        bc.emitBattleUpdate(b);
      } catch (error) {
        console.error("[SocketHandlers] playerAuth error:", error);
        socket.emit("authError", { error: "internal_error" });
      }
    });

    /* ========== 플레이어 준비 ========== */
    socket.on("player:ready", ({ battleId, playerId }) => {
      if (!isConnected || !battleId || !playerId) return;
      try {
        const b = battles.get(battleId);
        if (!b) return;

        const players = Array.isArray(b.players) ? b.players : [];
        const p = players.find((x) => x && x.id === playerId);
        if (!p) return;

        p.ready = true;
        if (typeof pushLog === "function") {
          pushLog(b, { type: "system", message: `${p.name} 준비 완료` });
          bc.pushLogAndBroadcast(b, { type: "system", message: `${p.name} 준비 완료` });
        }

        const allReady = players.length > 0 && players.every((x) => x && x.ready);
        if (allReady && b.status !== "active" && typeof startBattle === "function") {
          startBattle(b); // 내부에서 선공/후공 결정
        }
        bc.emitBattleUpdate(b);
      } catch (error) {
        console.error("[SocketHandlers] player:ready error:", error);
      }
    });

    /* ========== 행동 처리 ========== */
    socket.on("player:action", ({ battleId, playerId, action }) => {
      if (!isConnected || !battleId || !playerId || !action) return;
      try {
        const b = battles.get(battleId);
        if (!b || b.status !== "active") return;
        if (typeof resolveAction !== "function") {
          console.warn("[SocketHandlers] resolveAction not available");
          return;
        }

        const result = resolveAction(b, { actorId: playerId, ...action });
        // 로그 브로드캐스트
        if (Array.isArray(result.logs) && typeof pushLog === "function") {
          for (const l of result.logs) {
            const entry = { type: l.type || "system", message: l.message || "" };
            pushLog(b, entry);
            bc.pushLogAndBroadcast(b, entry);
          }
        }

        // HP 반영
        if (result.updates?.hp && Array.isArray(b.players)) {
          const hpUpd = result.updates.hp;
          b.players.forEach((pl) => {
            if (pl && hpUpd[pl.id] != null) {
              pl.hp = Math.max(0, hpUpd[pl.id]);
            }
          });
        }

        // 턴/페이즈 전개
        if (result.turnEnded && typeof nextTurn === "function") {
          try {
            // 신규 시그니처(nextTurn(battle, { actorId })) 지원
            nextTurn.length >= 2 ? nextTurn(b, { actorId: playerId }) : nextTurn(b);
          } catch (e) {
            console.error("[SocketHandlers] nextTurn error:", e);
          }
        }

        // 종료 판단
        if (typeof isBattleOver === "function" && isBattleOver(b) && typeof endBattle === "function") {
          endBattle(b);
          bc.emitSystem(b.id, { message: "전투 종료" });
        }

        // 상태 브로드캐스트
        bc.emitBattleUpdate(b);

        // 선택: 라운드 완료 힌트가 있으면 별도 알림
        if (result.roundCompleted) {
          bc.emitSystem(b.id, { message: `라운드 ${b?.turn?.round - 1 || ""} 종료` });
        }
      } catch (error) {
        console.error("[SocketHandlers] player:action error:", error);
        bc.emitError(battleId, error);
      }
    });

    /* ========== 채팅 ========== */
    socket.on("chat:send", ({ battleId, name, message }) => {
      if (!isConnected || !battleId || message == null) return;
      try {
        if (!battles.has(battleId)) return;
        const sanitizedName = String(name || "익명").substring(0, 50);
        const sanitizedMessage = String(message || "").substring(0, 500);
        if (sanitizedMessage.trim()) {
          bc.emitChat(battleId, { senderRole: "player", senderName: sanitizedName, text: sanitizedMessage });
        }
      } catch (error) {
        console.error("[SocketHandlers] chat:send error:", error);
      }
    });

    /* ========== 응원 ========== */
    socket.on("cheer:send", ({ battleId, cheer }) => {
      if (!isConnected || !battleId || cheer == null) return;
      try {
        const b = battles.get(battleId);
        if (!b) return;
        const sanitizedCheer = String(cheer || "").substring(0, 200).trim();
        if (sanitizedCheer) {
          pushLog?.(b, { type: "cheer", message: sanitizedCheer });
          bc.pushLogAndBroadcast(b, { type: "cheer", message: sanitizedCheer });
          bc.emitCheer(battleId, { spectatorName: "관전자", cheerText: sanitizedCheer });
        }
      } catch (error) {
        console.error("[SocketHandlers] cheer:send error:", error);
      }
    });

    /* ========== 연결 해제/에러 ========== */
    socket.on("disconnect", (reason) => {
      cleanup();
      console.log(`[SocketHandlers] Socket ${socket.id} disconnected: ${reason}`);
    });

    socket.on("error", (error) => {
      console.error("[SocketHandlers] Socket error:", error);
    });
  });

  return {
    cleanup: () => {
      console.log("[SocketHandlers] Cleaning up socket handlers");
    },
  };
}

module.exports = { useSocketHandlers };
