// packages/battle-server/src/socket/broadcast.js
// 디자인/클라이언트 UI 건드리지 않고, 소켓 브로드캐스트만 담당하는 허브 모듈
// attach(app, server)로 붙이면 io가 초기화되고, 방/스냅샷/브로드캐스트 이벤트가 동작합니다.

"use strict";

const http = require("http");
const { Server } = require("socket.io");

/**
 * 내부 전투 스토어(임시 메모리). 기존 엔진/DB가 있다면 교체해도 됩니다.
 * battles: Map<battleId, { status, turn, players: Map<playerId, {...}>, logs: string[] }>
 */
const battles = new Map();

function ensureBattle(id) {
  if (!battles.has(id)) {
    battles.set(id, {
      status: "idle",
      turn: 1,
      players: new Map(), // player: { id, name, team, hp, stats, avatar }
      logs: [],
    });
  }
  return battles.get(id);
}

function roomId(id) {
  return `battle:${id}`;
}

function makeSnapshot(id) {
  const b = battles.get(id);
  if (!b) return null;
  return {
    id,
    status: b.status,
    turn: b.turn,
    roster: [...b.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      stats: p.stats,
      avatar: p.avatar,
    })),
    logs: b.logs.slice(-200),
  };
}

/**
 * attach — 앱(및 서버)에 Socket.IO 브로드캐스트 허브를 부착
 * @param {import('express').Express} app
 * @param {import('http').Server} [serverFromCaller] - 이미 app.listen으로 만든 서버가 있으면 전달
 * @returns {{ io: import('socket.io').Server, battles: Map, broadcast: Function, snapshot: Function, server: import('http').Server }}
 */
function attach(app, serverFromCaller) {
  const server =
    serverFromCaller ||
    http.createServer(app); // app.listen 대신 이 server를 사용 가능

  const io = new Server(server, {
    cors: { origin: true },
    transports: ["websocket"],
  });

  // 공용 브로드캐스트 도우미
  function broadcast(id, evt, data) {
    io.to(roomId(id)).emit(evt, data);
  }

  io.on("connection", (socket) => {
    // --- 참여(방 합류) ---
    socket.on("admin:join", ({ battleId }) => {
      if (!battleId) return;
      ensureBattle(battleId);
      socket.join(roomId(battleId));
      socket.data.battleId = battleId;
      socket.emit("state:snapshot", makeSnapshot(battleId));
    });

    socket.on("player:join", ({ battleId, playerId }) => {
      if (!battleId) return;
      ensureBattle(battleId);
      socket.join(roomId(battleId));
      socket.data.battleId = battleId;
      socket.data.playerId = playerId;
      socket.emit("state:snapshot", makeSnapshot(battleId));
    });

    socket.on("spectator:join", ({ battleId }) => {
      if (!battleId) return;
      ensureBattle(battleId);
      socket.join(roomId(battleId));
      socket.data.battleId = battleId;
      socket.emit("state:snapshot", makeSnapshot(battleId));
    });

    // --- 스냅샷 당겨오기 ---
    socket.on("state:pull", () => {
      const id = socket.data.battleId;
      if (id) socket.emit("state:snapshot", makeSnapshot(id));
    });

    // --- 채팅 브로드캐스트 ---
    socket.on("chat:send", (msg) => {
      const id = socket.data.battleId;
      if (!id) return;
      const safe = {
        text: String(msg?.text ?? "").slice(0, 500),
        scope: msg?.scope === "team" ? "team" : "all",
        name: msg?.name || "",
      };
      broadcast(id, "chat:new", safe);
    });

    // --- 로그 추가 브로드캐스트 ---
    socket.on("log:append", ({ text }) => {
      const id = socket.data.battleId;
      if (!id) return;
      const b = battles.get(id);
      if (!b) return;
      const line = String(text ?? "").slice(0, 500);
      b.logs.push(line);
      broadcast(id, "log:new", line);
    });

    // --- 엔진 구동 브로드캐스트 (턴/상태) ---
    socket.on("turn:update", (payload) => {
      const id = socket.data.battleId;
      if (!id) return;
      const b = battles.get(id);
      if (b && typeof payload?.turn === "number") b.turn = payload.turn;
      broadcast(id, "turn:update", payload);
    });

    socket.on("battle:status", (payload) => {
      const id = socket.data.battleId;
      if (!id) return;
      const b = battles.get(id);
      if (b && payload?.status) b.status = payload.status;
      broadcast(id, "battle:status", payload);
    });

    // --- 로스터/HP 동기화 (서버 검증/권한 체크는 실제 구현에 맞게 추가) ---
    socket.on("roster:update", ({ players }) => {
      const id = socket.data.battleId;
      if (!id) return;
      const b = battles.get(id);
      if (!b) return;
      if (Array.isArray(players)) {
        players.forEach((p) => {
          if (!p?.id) return;
          b.players.set(p.id, p);
        });
      }
      broadcast(id, "roster:update", { players: [...b.players.values()] });
    });

    socket.on("hp:update", ({ pid, hp }) => {
      const id = socket.data.battleId;
      if (!id) return;
      const b = battles.get(id);
      if (!b) return;
      const p = b.players.get(pid);
      if (p) p.hp = hp;
      broadcast(id, "hp:update", { pid, hp });
    });
  });

  // 내보내기
  return {
    server,
    io,
    battles,
    broadcast,
    snapshot: makeSnapshot,
  };
}

module.exports = { attach, battles };
