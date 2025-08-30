/**
 * PYXIS Battle Server — index.js (FULL)
 * - 디자인/클라이언트 파일은 건드리지 않음
 * - 브로드캐스트 모듈(src/socket/broadcast.js) 연결
 * - REST 엔드포인트: 전투 생성, 플레이어 추가, 링크 생성
 * - 정적 파일 제공: /pages/* -> /admin, /play, /watch
 */

"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const bodyParser = require("body-parser");
const cors = require("cors");

// ────────────────────────────────────────────────────────────────
// 0) 경로/상수
// ────────────────────────────────────────────────────────────────
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PAGES_DIR = path.join(PUBLIC_DIR, "pages");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 파일 업로드(multer)
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ────────────────────────────────────────────────────────────────
// 1) 유틸
// ────────────────────────────────────────────────────────────────
function newId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function now() {
  return Date.now();
}
function randomToken(len = 24) {
  // URL-safe 토큰
  return [...cryptoRandom(len)].join("");
}
function cryptoRandom(len) {
  // base62
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const out = [];
  for (let i = 0; i < len; i++) out.push(chars[Math.floor(Math.random() * chars.length)]);
  return out;
}

// ────────────────────────────────────────────────────────────────
// 2) 앱/미들웨어
// ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서비스
app.use(express.static(PUBLIC_DIR, { index: false }));

// ────────────────────────────────────────────────────────────────
/**
 * 3) 소켓 브로드캐스트 허브 부착
 *    /src/socket/broadcast.js 의 attach(app, server?) 사용
 */
// ────────────────────────────────────────────────────────────────
const { attach, battles } = require("./src/socket/broadcast");
const { server, io } = attach(app); // app.listen 대신 attach가 만든 server 사용

// ────────────────────────────────────────────────────────────────
/**
 * 4) 인메모리 전투 관리 (REST와 소켓이 공용으로 사용하는 최소 상태)
 *    - 실제 엔진/DB가 있다면 여기 로직을 교체/연동하세요.
 */
// ────────────────────────────────────────────────────────────────
/**
 * battle 구조(메모리):
 * {
 *   status: 'idle' | 'started' | 'paused' | 'ended',
 *   turn: number,
 *   players: Map<playerId, {
 *     id, name, team: 'phoenix' | 'eaters',
 *     hp: number,
 *     stats: { atk, def, dex, luk },
 *     avatar?: string (url path),
 *     token?: string (player OTP)
 *   }>,
 *   logs: string[],
 *   spectatorToken?: string
 * }
 */

// ────────────────────────────────────────────────────────────────
// 5) REST API
// ────────────────────────────────────────────────────────────────

/**
 * 헬스체크
 */
app.get("/healthz", (req, res) => {
  res.json({ ok: true, ts: now() });
});

/**
 * 전투 생성 (관리자)
 * POST /api/admin/battles
 * body: { mode: '1v1'|'2v2'|'3v3'|'4v4' }  // 현재는 메타 정보로만 저장
 * resp: { id, status, spectatorToken }
 */
app.post("/api/admin/battles", (req, res) => {
  try {
    const { mode = "1v1" } = req.body || {};
    const id = newId("battle");
    const spectatorToken = randomToken(16);

    battles.set(id, {
      status: "idle",
      turn: 1,
      mode,
      players: new Map(),
      logs: [],
      spectatorToken,
      createdAt: now(),
    });

    res.json({ id, status: "idle", spectatorToken });
  } catch (err) {
    console.error("create battle error:", err);
    res.status(500).json({ error: "FAILED_TO_CREATE_BATTLE" });
  }
});

/**
 * 플레이어 추가
 * POST /api/battles/:id/players
 * form-data:
 *  - name (string)
 *  - team ('phoenix'|'eaters')
 *  - stats (json string: {atk,def,dex,luk})
 *  - items (json string: ['포션', ...])  // 현재 서버는 저장만, 디테일은 엔진에서 사용
 *  - avatar (file, optional)
 * resp: player 객체
 */
app.post("/api/battles/:id/players", upload.single("avatar"), (req, res) => {
  const { id } = req.params;
  const battle = battles.get(id);
  if (!battle) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: "BATTLE_NOT_FOUND" });
  }

  try {
    const name = String(req.body.name || "").trim();
    const team = req.body.team === "phoenix" ? "phoenix" : "eaters";
    const statsRaw = req.body.stats || "{}";
    const itemsRaw = req.body.items || "[]";

    if (!name) throw new Error("NAME_REQUIRED");

    let stats = {};
    try { stats = JSON.parse(statsRaw); } catch {}
    const { atk = 3, def = 3, dex = 3, luk = 3 } = stats;

    // 검증: 각 1~5, 총합 <= 30
    const sum = (+atk) + (+def) + (+dex) + (+luk);
    if ([atk, def, dex, luk].some((v) => v < 1 || v > 5)) {
      throw new Error("STATS_RANGE_1_5");
    }
    if (sum > 30) throw new Error("STATS_SUM_MAX_30");

    let items = [];
    try { items = JSON.parse(itemsRaw); } catch {}

    // 아바타 파일 경로 -> 정적 서빙 가능하도록 /uploads 상대경로 제공
    let avatarUrl = "";
    if (req.file) {
      const rel = path.relative(PUBLIC_DIR, req.file.path); // ../uploads/abcd
      // public 외부라면 직접 매핑: /uploads 경로 노출
      avatarUrl = `/uploads/${path.basename(req.file.path)}`;
      // /uploads 정적 노출(최초 1회)
      if (!app._uploadsMounted) {
        app.use("/uploads", express.static(UPLOAD_DIR, { index: false }));
        app._uploadsMounted = true;
      }
    }

    const pid = newId("player");
    const token = randomToken(20);

    const player = {
      id: pid,
      name,
      team,
      hp: 100,
      stats: { atk: +atk, def: +def, dex: +dex, luk: +luk },
      avatar: avatarUrl,
      items,
      token,
      createdAt: now(),
    };

    battle.players.set(pid, player);

    res.json(player);
  } catch (err) {
    console.error("add player error:", err);
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: String(err.message || "INVALID_PLAYER") });
  }
});

/**
 * 플레이어별 링크 생성
 * GET /api/battles/:id/links
 * resp: [ { id, name, token, player } ]
 *  - 클라이언트는 `${origin}/play?battle=${id}&token=${token}&name=${encodeURIComponent(name)}`
 *    형태로 링크를 만들어 사용
 */
app.get("/api/battles/:id/links", (req, res) => {
  const { id } = req.params;
  const battle = battles.get(id);
  if (!battle) return res.status(404).json({ error: "BATTLE_NOT_FOUND" });

  const out = [];
  for (const p of battle.players.values()) {
    // 플레이어 토큰이 없으면 새로 부여(안전)
    if (!p.token) p.token = randomToken(20);
    out.push({ id: p.id, name: p.name, token: p.token, player: p });
  }
  res.json(out);
});

// ────────────────────────────────────────────────────────────────
// 6) 페이지 라우팅 (정적 파일 그대로 사용; 디자인 불변)
//    - /admin -> /public/pages/admin.html
//    - /play  -> /public/pages/player.html
//    - /watch -> /public/pages/spectator.html
// ────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.redirect("/admin");
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PAGES_DIR, "admin.html"));
});

app.get("/play", (req, res) => {
  res.sendFile(path.join(PAGES_DIR, "player.html"));
});

app.get("/watch", (req, res) => {
  res.sendFile(path.join(PAGES_DIR, "spectator.html"));
});

// ────────────────────────────────────────────────────────────────
// 7) 서버 시작
//    attach(app) 가 만든 server를 사용. 포트만 정하면 됨.
// ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[PYXIS] server listening on :${PORT}`);
});
