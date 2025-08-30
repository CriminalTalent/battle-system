// packages/battle-server/src/socket/broadcast.js
// 소켓 브로드캐스트 전용 허브 모듈
// - attach(app, server?) 호출 시 io 초기화
// - 방 구조: battle:<id> / 팀 서브룸: battle:<id>:phoenix|eaters
// - 안정화: CORS/핑/버퍼 한도/레이트리밋/입력 정제/스냅샷 최소화

"use strict";

const http = require("http");
const { Server } = require("socket.io");

// ────────────────────────────────────────────────────────────────
// In-memory battle store (교체 가능)
// battles: Map<battleId, { status, turn, players: Map<playerId, {...}>, logs: string[] }>
// player: { id, name, team: 'phoenix'|'eaters', hp, stats, avatar }
// ────────────────────────────────────────────────────────────────
const battles = new Map();

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────
function ensureBattle(id) {
  if (!battles.has(id)) {
    battles.set(id, {
      status: "idle",
      turn: 1,
      players: new Map(),
      logs: [],
      createdAt: Date.now(),
    });
  }
  return battles.get(id);
}
function roomId(id) { return `battle:${id}`; }
function teamRoomId(id, team) { return `${roomId(id)}:${team}`; }

function sanitizeString(v, max = 500) {
  const s = String(v ?? "");
  // 제어문자 제거 후 길이 제한
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

function makeSnapshot(id) {
  const b = battles.get(id);
  if (!b) return null;
  return {
    id,
    status: b.status,
    turn: b.turn,
    roster: [...b.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp,
      stats: p.stats, avatar: p.avatar
    })),
    logs: b.logs.slice(-200)
  };
}

// 레이트리밋: 소켓 단위 최소 간격
const RATE_LIMIT_MS = 300;        // 일반 이벤트(저빈도): 0.3s
const CHAT_LIMIT_MS = 3000;       // 채팅 전용: 3s

// 소켓별 최근 호출 시각 기록
const lastEmitAt = new Map();     // key: `${socket.id}:${event}`

// ────────────────────────────────────────────────────────────────
// attach
// ────────────────────────────────────────────────────────────────
/**
 * attach — 앱(및 서버)에 Socket.IO 브로드캐스트 허브를 부착
 * @param {import('express').Express} app
 * @param {import('http').Server} [serverFromCaller] - 이미 app.listen으로 만든 서버가 있으면 전달
 * @returns {{ io: import('socket.io').Server, battles: Map, broadcast: Function, snapshot: Function, server: import('http').Server }}
 */
function attach(app, serverFromCaller) {
  const server = serverFromCaller || http.createServer(app);

  const io = new Server(server, {
    // 운영 시 CORS 제한 권장: CORS_ORIGIN="https://pyxisbattlesystem.monster"
    cors: { origin: process.env.CORS_ORIGIN || true },
    transports: ["websocket"],             // WebSocket 우선
    pingInterval: 20000,
    pingTimeout: 30000,
    maxHttpBufferSize: 1e6                 // 1MB (도스 방지)
  });

  function broadcast(id, evt, data) {
    io.to(roomId(id)).emit(evt, data);
  }

  // 내부 유틸: 이벤트 레이트리밋
  function allowEvent(socket, ev, limitMs) {
    const key = `${socket.id}:${ev}`;
    const last = lastEmitAt.get(key) || 0;
    const now = Date.now();
    if (now - last < (limitMs || RATE_LIMIT_MS)) return false;
    lastEmitAt.set(key, now);
    return true;
  }

  // 플레이어의 팀을 현재 스토어에서 역추적
  function getTeamOfPlayer(battleId, playerId) {
    const b = battles.get(battleId);
    if (!b) return null;
    const p = b.players.get(playerId);
    return p?.team || null;
  }

  io.on("connection", (socket) => {
    // ── 합류: 관리자/플레이어/관전자
    socket.on("admin:join", ({ battleId } = {}) => {
      if (!battleId) return;
      ensureBattle(battleId);
      socket.join(roomId(battleId));
      socket.data.battleId = battleId;
      socket.data.role = "admin";
      socket.emit("state:snapshot", makeSnapshot(battleId));
    });

    socket.on("player:join", ({ battleId, playerId } = {}) => {
      if (!battleId) return;
      ensureBattle(battleId);
      socket.join(roomId(battleId));
      socket.data.battleId = battleId;
      socket.data.playerId = playerId || null;
      socket.data.role = "player";

      // 이미 로스터가 세팅된 경우 팀 서브룸에도 입장
      const team = playerId ? getTeamOfPlayer(battleId, playerId) : null;
      if (team === "phoenix" || team === "eaters") {
        socket.join(teamRoomId(battleId, team));
        socket.data.team = team;
      }
      socket.emit("state:snapshot", makeSnapshot(battleId));
    });

    socket.on("spectator:join", ({ battleId } = {}) => {
      if (!battleId) return;
      ensureBattle(battleId);
      socket.join(roomId(battleId));
      socket.data.battleId = battleId;
      socket.data.role = "spectator";
      socket.emit("state:snapshot", makeSnapshot(battleId));
    });

    // ── 스냅샷 요청
    socket.on("state:pull", () => {
      const id = socket.data.battleId;
      if (id) socket.emit("state:snapshot", makeSnapshot(id));
    });

    // ── 채팅: 레이트리밋/정제/팀 채팅(/t 프리픽스) + ack 지원
    socket.on("chat:send", (msg = {}, ack) => {
      const id = socket.data.battleId;
      if (!id) return ack?.({ ok: false, error: "no_battle" });
      if (!allowEvent(socket, "chat:send", CHAT_LIMIT_MS)) {
        return ack?.({ ok: false, error: "rate_limited" });
      }

      let text = sanitizeString(msg.text, 500);
      if (!text) return ack?.({ ok: false, error: "empty" });

      const role = socket.data.role || "spectator";
      const name = sanitizeString(msg.name || "", 48) || (role === "admin" ? "관리자" : role === "player" ? "플레이어" : "관전자");

      // /t 프리픽스는 플레이어만 허용
      let scope = "all";
      if (/^\s*\/t\s+/i.test(text) && role === "player") {
        scope = "team";
        text = text.replace(/^\s*\/t\s+/i, "");
      }

      const entry = {
        ts: Date.now(),
        text,
        scope,
        name,
        role,
        team: socket.data.team || null
      };

      if (scope === "team" && entry.team) {
        io.to(teamRoomId(id, entry.team)).emit("chat:new", entry);
      } else {
        broadcast(id, "chat:new", entry);
      }
      ack?.({ ok: true });
    });

    // ── 로그 추가
    socket.on("log:append", ({ text } = {}) => {
      const id = socket.data.battleId;
      if (!id) return;
      if (!allowEvent(socket, "log:append")) return;

      const b = battles.get(id);
      if (!b) return;

      const line = sanitizeString(text, 500);
      if (!line) return;

      b.logs.push(line);
      broadcast(id, "log:new", line);
    });

    // ── 턴/상태
    socket.on("turn:update", (payload = {}) => {
      const id = socket.data.battleId;
      if (!id) return;
      if (!allowEvent(socket, "turn:update")) return;

      const b = battles.get(id);
      if (b && typeof payload.turn === "number") b.turn = payload.turn;
      broadcast(id, "turn:update", {
        turn: Number(payload.turn) || b?.turn || 1,
        hint: sanitizeString(payload.hint || "", 200)
      });
    });

    socket.on("battle:status", (payload = {}) => {
      const id = socket.data.battleId;
      if (!id) return;
      if (!allowEvent(socket, "battle:status")) return;

      const b = battles.get(id);
      const status = sanitizeString(payload.status || "", 24);
      if (b && status) b.status = status;
      broadcast(id, "battle:status", { status: b?.status || status || "idle" });
    });

    // ── 로스터/HP 동기화
    socket.on("roster:update", ({ players } = {}) => {
      const id = socket.data.battleId;
      if (!id) return;
      const b = battles.get(id);
      if (!b) return;

      if (Array.isArray(players)) {
        players.forEach((p) => {
          if (!p || !p.id) return;
          const safe = {
            id: String(p.id),
            name: sanitizeString(p.name, 64),
            team: p.team === "phoenix" ? "phoenix" : (p.team === "eaters" ? "eaters" : "phoenix"),
            hp: Number.isFinite(p.hp) ? Math.max(0, Math.min(1000, Math.trunc(p.hp))) : 100,
            stats: p.stats && typeof p.stats === "object" ? p.stats : { atk: 3, def: 3, dex: 3, luk: 3 },
            avatar: sanitizeString(p.avatar || "", 256)
          };
          b.players.set(safe.id, safe);

          // 본 소켓이 해당 플레이어라면 팀 서브룸 갱신
          if (socket.data.playerId && socket.data.playerId === safe.id) {
            // 이전 팀에서 탈퇴 후 새 팀 입장
            if (socket.data.team && socket.rooms.has(teamRoomId(id, socket.data.team))) {
              socket.leave(teamRoomId(id, socket.data.team));
            }
            socket.join(teamRoomId(id, safe.team));
            socket.data.team = safe.team;
          }
        });
      }

      const roster = [...b.players.values()];
      broadcast(id, "roster:update", { players: roster });
    });

    socket.on("hp:update", ({ pid, hp } = {}) => {
      const id = socket.data.battleId;
      if (!id) return;
      if (!allowEvent(socket, "hp:update")) return;

      const b = battles.get(id);
      if (!b) return;

      const p = b.players.get(String(pid));
      if (!p) return;

      const next = Number.isFinite(hp) ? Math.max(0, Math.min(1000, Math.trunc(hp))) : p.hp;
      p.hp = next;

      broadcast(id, "hp:update", { pid: p.id, hp: p.hp });
    });

    // ── 연결 해제
    socket.on("disconnect", () => {
      // 필요 시 세션 정리 로직 추가 가능
    });
  });

  return {
    server,
    io,
    battles,
    broadcast,
    snapshot: makeSnapshot
  };
}

module.exports = { attach, battles };
