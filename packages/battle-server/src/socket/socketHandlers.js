// Socket 핸들러 모듈
// - index.js 에서 import 후 useSocketHandlers(io, stores) 로 등록
// - 상태키: waiting | active | paused | ended
// - stores: { battles: Map<string, Battle>, startBattle, endBattle, nextTurn, isBattleOver, pushLog, broadcastState, onSpectatorCount? }

import { broadcastBattleState, broadcastBattleLog, broadcastChat, broadcastSpectatorCount, initBroadcast } from "./broadcast.js";

export function useSocketHandlers(io, stores) {
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

  io.on("connection", (socket) => {
    // 공용: 룸 합류
    socket.on("join", ({ battleId }) => {
      if (!battleId || !battles.has(battleId)) return;
      socket.join(String(battleId));
    });

    // 관리자 인증
    socket.on("adminAuth", ({ battleId, token }) => {
      const b = battles.get(battleId);
      if (!b || token !== b.adminToken) {
        socket.emit("authError", { error: "unauthorized" });
        return;
      }
      socket.join(String(battleId));
      socket.emit("auth:success", { role: "admin", battleId });
      broadcastBattleState(b);
    });

    // 관전자 인증(간이)
    socket.on("spectatorAuth", ({ battleId, otp }) => {
      const b = battles.get(battleId);
      if (!b || otp !== b.spectatorOtp) {
        socket.emit("authError", { error: "unauthorized" });
        return;
      }
      socket.join(String(battleId));
      socket.emit("auth:success", { role: "spectator", battleId });
      const count = io.sockets.adapter.rooms.get(String(battleId))?.size || 1;
      broadcastSpectatorCount(battleId, count);
      broadcastBattleState(b);
    });

    // 플레이어 인증(이름 매칭)
    socket.on("playerAuth", ({ battleId, name }) => {
      const b = battles.get(battleId);
      if (!b) {
        socket.emit("authError", { error: "notfound" });
        return;
      }
      const p = (b.players || []).find(v => (v.name || "").trim() === (name || "").trim());
      if (!p) {
        socket.emit("authError", { error: "player-notfound" });
        return;
      }
      p.socketId = socket.id;
      socket.join(String(battleId));
      socket.emit("auth:success", { role: "player", battleId, playerId: p.id });
      broadcastBattleState(b);
    });

    // 준비
    socket.on("player:ready", ({ battleId, playerId }) => {
      const b = battles.get(battleId);
      if (!b) return;
      const p = (b.players || []).find(x => x.id === playerId);
      if (!p) return;
      p.ready = true;
      pushLog(b, { type: "system", message: `${p.name} 준비 완료` });
      if (b.players.length > 0 && b.players.every(x => x.ready) && b.status !== "active") {
        startBattle(b);
      } else {
        broadcastBattleState(b);
      }
    });

    // 행동
    socket.on("player:action", ({ battleId, playerId, action }) => {
      const b = battles.get(battleId);
      if (!b || b.status !== "active") return;

      const result = resolveAction(b, { actorId: playerId, ...action });
      // 로그
      for (const l of result.logs || []) pushLog(b, { type: l.type || "system", message: l.message || "" });
      // HP 반영
      const hpUpd = result.updates?.hp || {};
      (b.players || []).forEach(pl => { if (hpUpd[pl.id] != null) pl.hp = Math.max(0, hpUpd[pl.id]); });

      if (result.turnEnded) nextTurn(b);
      if (isBattleOver(b)) endBattle(b);
      broadcastBattleState(b);
    });

    // 채팅
    socket.on("chat:send", ({ battleId, name, message }) => {
      if (!battles.has(battleId)) return;
      const msg = String(message || "").slice(0, 500);
      broadcastChat(battleId, { name, message: msg });
    });

    // 응원
    socket.on("cheer:send", ({ battleId, cheer }) => {
      const b = battles.get(battleId);
      if (!b) return;
      const msg = cheer || "";
      pushLog(b, { type: "cheer", message: msg });
      broadcastBattleLog(battleId, { type: "cheer", message: msg });
    });
  });
}
