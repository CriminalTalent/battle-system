// packages/battle-server/index.js
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io";
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: "*", credentials: true },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== 전투 상태 저장소 =====
const battles = {}; // { battleId: { id, mode, players: [], status } }

// ===== 유틸 =====
function generateId(len = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: len })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join("");
}

// ===== 소켓 이벤트 =====
io.on("connection", (socket) => {
  console.log("새 클라이언트 연결:", socket.id);

  // 배틀 생성
  socket.on("createBattle", ({ mode }, cb) => {
    const id = `battle_${generateId(8)}`;
    battles[id] = {
      id,
      mode: mode || "1v1",
      players: [],
      status: "waiting",
    };
    cb({ battleId: id, battle: battles[id] });
    io.emit("battleUpdate", battles[id]);
  });

  // 배틀 제어
  socket.on("startBattle", ({ battleId }) => {
    if (battles[battleId]) {
      battles[battleId].status = "active";
      io.to(battleId).emit("battleUpdate", battles[battleId]);
    }
  });

  socket.on("pauseBattle", ({ battleId }) => {
    if (battles[battleId]) {
      battles[battleId].status = "paused";
      io.to(battleId).emit("battleUpdate", battles[battleId]);
    }
  });

  socket.on("resumeBattle", ({ battleId }) => {
    if (battles[battleId]) {
      battles[battleId].status = "active";
      io.to(battleId).emit("battleUpdate", battles[battleId]);
    }
  });

  socket.on("endBattle", ({ battleId }) => {
    if (battles[battleId]) {
      battles[battleId].status = "ended";
      io.to(battleId).emit("battleUpdate", battles[battleId]);
    }
  });

  // 참가자 추가
  socket.on("addPlayer", ({ battleId, player }, cb) => {
    const battle = battles[battleId];
    if (!battle) return cb({ error: "Battle not found" });

    const otp = generateId(6);
    const newPlayer = {
      ...player,
      otp,
      status: "대기",
    };
    battle.players.push(newPlayer);

    io.to(battleId).emit("battleUpdate", battle);
    cb({ success: true, player: newPlayer });
  });

  // 참가자 삭제
  socket.on("removePlayer", ({ battleId, playerName }, cb) => {
    const battle = battles[battleId];
    if (!battle) return cb({ error: "Battle not found" });

    battle.players = battle.players.filter((p) => p.name !== playerName);
    io.to(battleId).emit("battleUpdate", battle);
    cb({ success: true });
  });

  // 참가자 링크 생성
  socket.on("genPlayerLinks", ({ battleId }, cb) => {
    const battle = battles[battleId];
    if (!battle) return cb({ error: "Battle not found" });

    const links = battle.players.map((p) => ({
      name: p.name,
      otp: p.otp,
      url: `${BASE_URL}/player.html?battle=${battleId}&player=${encodeURIComponent(
        p.name
      )}&otp=${p.otp}`,
    }));

    cb({ success: true, playerLinks: links });
  });

  // 관전자 OTP 발급
  socket.on("genSpectatorOtp", ({ battleId }, cb) => {
    const otp = generateId(6);
    cb({ success: true, spectatorOtp: otp });
  });

  // 방 참가
  socket.on("join", ({ battleId }) => {
    socket.join(battleId);
    if (battles[battleId]) {
      socket.emit("battleUpdate", battles[battleId]);
    }
  });

  // 채팅
  socket.on("chatMessage", ({ battleId, message, name }) => {
    io.to(battleId).emit("chatMessage", { name, message });
  });
});

// ===== 서버 시작 =====
server.listen(PORT, () => {
  console.log(`PYXIS server running on http://127.0.0.1:${PORT}`);
});
