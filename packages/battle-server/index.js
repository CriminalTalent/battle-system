// packages/battle-server/index.js
// PYXIS Battle System - Main Server Entry

import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";

// ==== 환경설정 ====
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
    methods: ["GET", "POST"]
  }
});

// ==== 미들웨어 ====
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==== 업로드 라우터 (없을 경우 더미) ====
let uploadRouter;
try {
  const mod = await import("./src/routes/avatar-upload.js");
  uploadRouter = mod.default || express.Router();
} catch {
  uploadRouter = express.Router();
  uploadRouter.post("/avatar", (_req, res) => {
    res.status(200).json({ ok: true, filename: "", url: "" });
  });
}
app.use("/api/upload", uploadRouter);

// ==== API 라우터 ====
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok\n");
});

// ==== 정적 파일 ====
const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(__dirname, "uploads");

// public 디렉토리 없으면 생성
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// 기본 index.html 없으면 자동 생성
const indexFile = path.join(publicDir, "index.html");
if (!fs.existsSync(indexFile)) {
  fs.writeFileSync(
    indexFile,
    `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>PYXIS Battle</title></head>
<body>
<h1>PYXIS Battle System</h1>
<p><a href="/admin.html">관리자 페이지로 이동</a></p>
</body>
</html>`
  );
}

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));

// ==== 소켓 이벤트 ====
io.on("connection", (socket) => {
  console.log("[SOCKET] Connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("[SOCKET] Disconnected:", socket.id);
  });

  // 필요한 커스텀 이벤트들 추가
  socket.on("ping-test", () => {
    socket.emit("pong-test", { ts: Date.now() });
  });
});

// ==== 에러 핸들링 ====
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("[SERVER ERROR]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ==== 서버 시작 ====
server.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("PYXIS Battle System");
  console.log(`Server : http://0.0.0.0:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log("Ready for battle!");
  console.log("======================================");
});
