// packages/battle-server/index.js
// PYXIS Battle Server - Express + Socket.IO

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

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: SOCKET_PATH,
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 기본 디렉토리 설정
const publicDir = path.join(__dirname, "public");
const uploadDir = path.join(__dirname, "uploads");

// 정적 파일 서비스
app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadDir));

// 업로드 라우터 (없으면 더미 처리)
let uploadRouter;
try {
  const mod = await import("./src/routes/avatar-upload.js");
  uploadRouter = mod.default || express.Router();
} catch {
  uploadRouter = express.Router();
  uploadRouter.post("/avatar", (_req, res) =>
    res.status(200).json({ ok: true, filename: "", url: "" })
  );
}
app.use("/api/upload", uploadRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// === 중요: SPA 캐치올, socket.io 및 정적 파일은 제외 ===
app.use((req, res, next) => {
  const isGet = req.method === "GET";
  const acceptsHtml = req.accepts("html");
  const isSocketIO = req.path.startsWith("/socket.io/");
  const hasExt = path.extname(req.path) !== ""; // 확장자 있는 요청(js, css, png 등)

  if (isGet && acceptsHtml && !isSocketIO && !hasExt) {
    return res.sendFile(path.join(publicDir, "admin.html"));
  }
  next();
});

// Socket.IO 이벤트
io.on("connection", (socket) => {
  console.log("[SOCKET] Connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("[SOCKET] Disconnected:", socket.id);
  });

  // 채팅 이벤트 예시
  socket.on("chat", (msg) => {
    io.emit("chat", msg);
  });
});

// 서버 실행
server.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("PYXIS Battle System");
  console.log(`Server : http://0.0.0.0:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadDir}`);
  console.log("Ready for battle!");
  console.log("======================================");
});
