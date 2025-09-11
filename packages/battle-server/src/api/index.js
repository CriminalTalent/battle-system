"use strict";

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

/**
 * 이 라우터는 전투 로직에 직접 의존하지 않습니다.
 * 서버 부트스트랩(index.js)에서 아래 형태로 주입하세요:
 *
 *   const stores = {
 *     createBattle(mode, options) -> { battleId, adminOtp, spectatorOtp }
 *     getBattle(battleId) -> battle
 *     addPlayerToBattle(battleId, playerData) -> player
 *     removePlayerFromBattle(battleId, playerId) -> void
 *     deleteBattle(battleId) -> void
 *     listBattles() -> Battle[]
 *   }
 *
 *   app.set('stores', stores)
 *
 * battle 객체는 최소한 다음 접근자를 제공해야 합니다:
 *   battle.getSnapshot?.() || battle.getBattleState?.()
 *   battle.getPlayer?.(playerId)
 *   battle.adminOtp / battle.spectatorOtp
 */

function getStores(req) {
  const stores = req.app.get("stores");
  if (!stores) throw new Error("서버 전투 핸들러가 초기화되지 않았습니다(stores 미정의).");
  return stores;
}

/* ─────────────────────────────────────────────
 * 로깅/응답/검증 유틸
 * ────────────────────────────────────────────*/
function logWithTimestamp(message, level = "INFO", data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}][API][${level}] ${message}`;
  if (level === "ERROR") console.error(logMessage, data || "");
  else if (level === "WARN") console.warn(logMessage, data || "");
  else console.log(logMessage, data || "");
}

function sendSuccess(res, data = {}, message = null) {
  const response = { ok: true, timestamp: Date.now(), ...data };
  if (message) response.message = message;
  res.json(response);
}

function sendError(res, statusCode, error, details = null) {
  const response = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
  if (details && process.env.NODE_ENV === "development") response.details = details;
  res.status(statusCode).json(response);
}

function validateRequired(data, fields) {
  const missing = [];
  for (const f of fields) {
    const v = data[f];
    if (v == null || (typeof v === "string" && !v.trim())) missing.push(f);
  }
  if (missing.length) throw new Error(`필수 필드가 누락되었습니다: ${missing.join(", ")}`);
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== "string") return "";
  return str.trim().substring(0, maxLength);
}

/* ─────────────────────────────────────────────
 * 미들웨어/레이트리밋
 * ────────────────────────────────────────────*/
router.use(express.json({ limit: "10mb" }));
router.use(express.urlencoded({ extended: true, limit: "10mb" }));

router.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - start;
    logWithTimestamp(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
      res.statusCode >= 400 ? "WARN" : "INFO"
    );
    originalSend.call(this, data);
  };
  next();
});

const createRateLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { ok: false, error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });

const battleCreationLimit = createRateLimit(60 * 1000, 5, "전투 생성 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
const generalLimit = createRateLimit(60 * 1000, 60, "API 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
const uploadLimit = createRateLimit(60 * 1000, 10, "파일 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");

/* ─────────────────────────────────────────────
 * 전투 생성
 * POST /api/battles
 * ────────────────────────────────────────────*/
router.post("/battles", battleCreationLimit, (req, res) => {
  try {
    const stores = getStores(req);
    logWithTimestamp("전투 생성 요청 수신", "INFO", { body: req.body });

    const { mode, options = {} } = req.body;
    const validModes = ["1v1", "2v2", "3v3", "4v4"];
    const battleMode = mode || "2v2";
    if (!validModes.includes(battleMode)) {
      throw new Error(`지원되지 않는 전투 모드입니다. 사용 가능한 모드: ${validModes.join(", ")}`);
    }

    const battleOptions = {
      timeLimit: Math.min(Math.max(options.timeLimit || 3600, 600), 7200),       // 10분~2시간(초)
      turnTimeLimit: Math.min(Math.max(options.turnTimeLimit || 300, 30), 600),  // 30초~10분(초)
      maxSpectators: Math.min(Math.max(options.maxSpectators || 30, 1), 100),
      allowReconnect: options.allowReconnect !== false,
      privateMode: !!options.privateMode,
      ...options,
    };

    if (typeof stores.createBattle !== "function") {
      throw new Error("서버 전투 핸들러가 초기화되지 않았습니다(createBattle 미정의).");
    }

    // stores 구현체가 반드시 { battleId, adminOtp, spectatorOtp } 반환하도록 맞춰주세요.
    const { battleId, adminOtp, spectatorOtp } = stores.createBattle(battleMode, battleOptions);

    logWithTimestamp("전투 생성 성공", "INFO", { battleId, mode: battleMode });

    sendSuccess(
      res,
      {
        battleId,
        adminOtp,
        spectatorOtp,
        mode: battleMode,
        options: battleOptions,
        urls: {
          admin: `/admin?battle=${battleId}&otp=${adminOtp}`,
          spectator: `/spectator?battle=${battleId}&token=${spectatorOtp}`,
          status: `/api/battles/${battleId}`,
        },
      },
      "전투가 성공적으로 생성되었습니다"
    );
  } catch (err) {
    logWithTimestamp("전투 생성 실패", "ERROR", err);
    sendError(res, 500, err);
  }
});

/* ─────────────────────────────────────────────
 * 플레이어 추가
 * POST /api/battles/:battleId/players
 * ────────────────────────────────────────────*/
router.post("/battles/:battleId/players", generalLimit, (req, res) => {
  try {
    const stores = getStores(req);
    const { battleId } = req.params;
    const playerData = req.body;

    logWithTimestamp("플레이어 추가 요청", "INFO", { battleId, playerName: playerData?.name });

    validateRequired(playerData, ["name", "team"]);

    const battle = stores.getBattle?.(battleId);
    if (!battle) throw new Error("전투를 찾을 수 없습니다");

    const normalizedTeam = (() => {
      const t = sanitizeString(playerData.team, 10).toLowerCase();
      if (t === "a" || t === "phoenix") return "phoenix";
      if (t === "b" || t === "eaters" || t === "death") return "eaters";
      return t; // 이미 키로 들어왔다면 그대로
    })();

    const sanitizedData = {
      name: sanitizeString(playerData.name, 20),
      team: normalizedTeam,
      stats: validatePlayerStats(playerData.stats),
      items: validatePlayerItems(playerData.items),
      avatar: playerData.avatar ? sanitizeString(playerData.avatar, 200) : null,
    };

    // 이름 중복 검사 (스냅샷 기준)
    const snapshot = battle.getSnapshot?.() || battle.getBattleState?.() || {};
    const existingNames = (snapshot.players || []).map((p) => (p.name || "").toLowerCase());
    if (existingNames.includes(sanitizedData.name.toLowerCase())) {
      throw new Error("이미 같은 이름의 플레이어가 존재합니다");
    }

    if (typeof stores.addPlayerToBattle !== "function") {
      throw new Error("플레이어 추가 기능이 비활성화되어 있습니다(addPlayerToBattle 미정의).");
    }

    const player = stores.addPlayerToBattle(battleId, sanitizedData);

    logWithTimestamp("플레이어 추가 성공", "INFO", {
      battleId,
      playerId: player.id,
      playerName: player.name,
    });

    sendSuccess(
      res,
      {
        player: {
          id: player.id,
          name: player.name,
          team: player.team,
          token: player.token,
          stats: player.stats,
          items: player.items,
          url: `/play?battle=${battleId}&token=${player.token}&name=${encodeURIComponent(player.name)}`,
        },
      },
      "플레이어가 성공적으로 추가되었습니다"
    );
  } catch (err) {
    logWithTimestamp("플레이어 추가 실패", "ERROR", err);
    sendError(res, 400, err);
  }
});

/* 플레이어 스탯 검증(1~5) */
function validatePlayerStats(stats) {
  if (!stats || typeof stats !== "object") {
    return { attack: 3, defense: 3, agility: 3, luck: 3 };
  }
  const { attack = 3, defense = 3, agility = 3, luck = 3 } = stats;
  const labels = ["공격력", "방어력", "민첩성", "행운"];
  const values = [attack, defense, agility, luck];
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`${labels[i]}은 1~5 범위의 정수여야 합니다`);
    }
  });
  return { attack, defense, agility, luck };
}

/* 아이템 검증(0~9) */
function validatePlayerItems(items) {
  if (!items || typeof items !== "object") {
    return { dittany: 1, attackBoost: 1, defenseBoost: 1 };
  }
  const cfg = {
    dittany: { min: 0, max: 9, def: 1 },
    attackBoost: { min: 0, max: 9, def: 1 },
    defenseBoost: { min: 0, max: 9, def: 1 },
  };
  const out = {};
  for (const k of Object.keys(cfg)) {
    const raw = items[k];
    const val = Number.isInteger(raw) ? raw : cfg[k].def;
    if (val < cfg[k].min || val > cfg[k].max) {
      throw new Error(`${k} 아이템은 ${cfg[k].min}~${cfg[k].max} 범위여야 합니다`);
    }
    out[k] = val;
  }
  return out;
}

/* ─────────────────────────────────────────────
 * OTP 발급
 * POST /api/otp
 * ────────────────────────────────────────────*/
router.post("/otp", generalLimit, (req, res) => {
  try {
    const stores = getStores(req);
    const { role, battleId, playerId } = req.body;
    logWithTimestamp("OTP 발급 요청", "INFO", { role, battleId, playerId: playerId ? "***" : null });

    validateRequired({ role, battleId }, ["role", "battleId"]);

    const battle = stores.getBattle?.(battleId);
    if (!battle) throw new Error("전투를 찾을 수 없습니다");

    const snapshot = battle.getSnapshot?.() || battle.getBattleState?.() || {};
    let otp, url, expiresIn;

    switch (role) {
      case "admin": {
        otp = battle.adminOtp || snapshot.adminOtp;
        url = `/admin?battle=${battleId}&otp=${otp}`;
        expiresIn = null;
        break;
      }
      case "spectator": {
        const spectatorOtp = battle.spectatorOtp || snapshot.spectatorOtp;
        if (!spectatorOtp) throw new Error("관전자 OTP를 생성할 수 없습니다");
        otp = spectatorOtp;
        // spectator.html은 ?battle=..&name=..&token=.. 을 인식
        url = `/spectator?battle=${battleId}&token=${otp}`;
        expiresIn = 30 * 60 * 1000;
        break;
      }
      case "player": {
        validateRequired({ playerId }, ["playerId"]);
        const player = battle.getPlayer?.(playerId);
        if (!player) throw new Error("플레이어를 찾을 수 없습니다");
        otp = player.token;
        url = `/play?battle=${battleId}&token=${otp}&name=${encodeURIComponent(player.name)}`;
        expiresIn = 60 * 60 * 2 * 1000; // 2시간
        break;
      }
      default:
        throw new Error("지원되지 않는 역할입니다. 사용 가능한 역할: admin, player, spectator");
    }

    logWithTimestamp("OTP 발급 성공", "INFO", { role, battleId });

    sendSuccess(
      res,
      { otp, url, role, expiresIn, qrCode: generateQRCodeUrl(url) },
      `${role} OTP가 성공적으로 발급되었습니다`
    );
  } catch (err) {
    logWithTimestamp("OTP 발급 실패", "ERROR", err);
    sendError(res, 400, err);
  }
});

function generateQRCodeUrl(urlPath) {
  const baseUrl = process.env.BASE_URL || "https://pyxisbattlesystem.monster";
  const fullUrl = urlPath.startsWith("http") ? urlPath : `${baseUrl}${urlPath}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullUrl)}`;
}

/* ─────────────────────────────────────────────
 * 아바타 업로드
 * POST /api/battles/:battleId/avatar
 * ────────────────────────────────────────────*/
const uploadDir = path.join(__dirname, "../../public/uploads");
fs.mkdirSync(uploadDir, { recursive: true });

function validateImageFile(file) {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
  const maxSize = 5 * 1024 * 1024;
  if (!allowed.includes(file.mimetype)) throw new Error("지원되지 않는 파일 형식입니다. JPG, PNG, GIF, WebP만 업로드 가능합니다");
  if (file.size > maxSize) throw new Error("파일 크기가 너무 큽니다. 최대 5MB까지 업로드 가능합니다");
}

function generateSafeFilename(originalName, playerId) {
  const ext = path.extname(originalName).toLowerCase();
  const ts = Date.now();
  const rnd = Math.random().toString(36).substring(2, 8);
  return `avatar-${playerId}-${ts}-${rnd}${ext}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    try {
      validateImageFile(file);
      const safe = generateSafeFilename(file.originalname, req.body.playerId || "unknown");
      cb(null, safe);
    } catch (e) {
      cb(e);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    try {
      validateImageFile(file);
      cb(null, true);
    } catch (e) {
      cb(e, false);
    }
  },
});

router.post("/battles/:battleId/avatar", uploadLimit, upload.single("avatar"), (req, res) => {
  try {
    const stores = getStores(req);
    const { battleId } = req.params;
    const { playerId } = req.body;
    logWithTimestamp("아바타 업로드 요청", "INFO", {
      battleId,
      playerId,
      filename: req.file?.filename,
    });

    if (!req.file) throw new Error("업로드된 파일이 없습니다");
    validateRequired({ playerId }, ["playerId"]);

    const battle = stores.getBattle?.(battleId);
    if (!battle) {
      fs.unlink(req.file.path, () => {});
      throw new Error("전투를 찾을 수 없습니다");
    }

    const player = battle.getPlayer?.(playerId);
    if (!player) {
      fs.unlink(req.file.path, () => {});
      throw new Error("플레이어를 찾을 수 없습니다");
    }

    // 기존 서버-로컬 파일만 삭제
    if (player.avatar && player.avatar.startsWith("/uploads/")) {
      const old = path.join(uploadDir, path.basename(player.avatar));
      fs.unlink(old, () => {});
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    player.avatar = fileUrl;

    logWithTimestamp("아바타 업로드 성공", "INFO", { battleId, playerId, fileUrl });

    sendSuccess(
      res,
      {
        url: fileUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
      "아바타가 성공적으로 업로드되었습니다"
    );
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    logWithTimestamp("아바타 업로드 실패", "ERROR", err);
    sendError(res, 500, err);
  }
});

/* ─────────────────────────────────────────────
 * 전투 상태 확인
 * GET /api/battles/:battleId
 * ────────────────────────────────────────────*/
router.get("/battles/:battleId", generalLimit, (req, res) => {
  try {
    const stores = getStores(req);
    const { battleId } = req.params;
    const { detailed = "false" } = req.query;

    logWithTimestamp("전투 상태 조회", "INFO", { battleId, detailed });

    const battle = stores.getBattle?.(battleId);
    if (!battle) throw new Error("전투를 찾을 수 없습니다");

    const snapshot = battle.getSnapshot?.() || battle.getBattleState?.() || {};
    const baseData = {
      id: battleId,
      mode: snapshot.options?.mode || battle.mode || "unknown",
      status: snapshot.status || battle.status || "unknown",
      playerCount: (snapshot.players || []).length,
      spectatorCount: snapshot.spectatorCount || 0,
      createdAt: snapshot.created || battle.createdAt || null,
      startedAt: snapshot.battleStartTime || battle.startedAt || null,
      endedAt: snapshot.battleEndTime || battle.endedAt || null,
      currentTurn: snapshot.currentTurn || snapshot.turn?.round || null,
      currentTeam: snapshot.currentTeam || snapshot.turn?.phaseTeam || null,
    };

    if (String(detailed) === "true") {
      sendSuccess(res, {
        ...baseData,
        state: snapshot,
        statistics: {
          totalTurns: snapshot.currentTurn || snapshot.turn?.round || 0,
          totalActions: snapshot.stats?.totalActions || 0,
          criticalHits: snapshot.stats?.criticalHits || 0,
          totalDamage: snapshot.stats?.totalDamage || 0,
          totalHealing: snapshot.stats?.totalHealing || 0,
          battleDuration: snapshot.battleEndTime
            ? snapshot.battleEndTime - (snapshot.battleStartTime || snapshot.created || Date.now())
            : Date.now() - (snapshot.battleStartTime || snapshot.created || Date.now()),
        },
      });
    } else {
      sendSuccess(res, baseData);
    }
  } catch (err) {
    logWithTimestamp("전투 상태 조회 실패", "ERROR", err);
    sendError(res, 404, err);
  }
});

/* ─────────────────────────────────────────────
 * 전투 목록
 * GET /api/battles
 * ────────────────────────────────────────────*/
router.get("/battles", generalLimit, (req, res) => {
  try {
    const stores = getStores(req);
    const { status, mode, limit = 20, offset = 0, sortBy = "created", sortOrder = "desc" } = req.query;

    logWithTimestamp("전투 목록 조회", "INFO", { status, mode, limit, offset });

    let allBattles = [];
    if (typeof stores.listBattles === "function") {
      allBattles = stores.listBattles();
    }

    const normalized = allBattles.map((b) => {
      const snap = b.getSnapshot?.() || b.getBattleState?.() || {};
      return {
        id: b.id || snap.battleId,
        mode: snap.options?.mode || b.mode || "unknown",
        status: snap.status || b.status || "unknown",
        created: snap.created || b.createdAt || null,
        playerCount: (snap.players || []).length,
      };
    });

    const filtered = normalized
      .filter((x) => (!status ? true : x.status === status))
      .filter((x) => (!mode ? true : x.mode === mode))
      .sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        return sortOrder === "desc" ? (bVal > aVal ? 1 : -1) : aVal > bVal ? 1 : -1;
      });

    const off = parseInt(offset, 10);
    const lim = parseInt(limit, 10);
    const page = filtered.slice(off, off + lim);

    sendSuccess(res, {
      battles: page,
      pagination: {
        total: filtered.length,
        limit: lim,
        offset: off,
        hasMore: off + lim < filtered.length,
      },
    });
  } catch (err) {
    logWithTimestamp("전투 목록 조회 실패", "ERROR", err);
    sendError(res, 500, err);
  }
});

/* ─────────────────────────────────────────────
 * 플레이어 삭제
 * DELETE /api/battles/:battleId/players/:playerId
 * ────────────────────────────────────────────*/
router.delete("/battles/:battleId/players/:playerId", generalLimit, (req, res) => {
  try {
    const stores = getStores(req);
    const { battleId, playerId } = req.params;
    logWithTimestamp("플레이어 삭제 요청", "INFO", { battleId, playerId });

    const battle = stores.getBattle?.(battleId);
    if (!battle) throw new Error("전투를 찾을 수 없습니다");

    const snapshot = battle.getSnapshot?.() || battle.getBattleState?.() || {};
    const status = snapshot.status || battle.status;
    if (["active", "ongoing"].includes(status)) {
      throw new Error("진행 중인 전투에서는 플레이어를 삭제할 수 없습니다");
    }

    const player = battle.getPlayer?.(playerId);
    if (!player) throw new Error("플레이어를 찾을 수 없습니다");

    if (player.avatar && player.avatar.startsWith("/uploads/")) {
      const filePath = path.join(uploadDir, path.basename(player.avatar));
      fs.unlink(filePath, () => {});
    }

    if (typeof stores.removePlayerFromBattle === "function") {
      stores.removePlayerFromBattle(battleId, playerId);
    } else if (typeof battle.removePlayer === "function") {
      battle.removePlayer(playerId);
    } else {
      throw new Error("플레이어 삭제 기능이 비활성화되어 있습니다");
    }

    logWithTimestamp("플레이어 삭제 성공", "INFO", { battleId, playerId });
    sendSuccess(res, {}, "플레이어가 성공적으로 삭제되었습니다");
  } catch (err) {
    logWithTimestamp("플레이어 삭제 실패", "ERROR", err);
    sendError(res, 400, err);
  }
});

/* ─────────────────────────────────────────────
 * 전투 삭제
 * DELETE /api/battles/:battleId
 * ────────────────────────────────────────────*/
router.delete("/battles/:battleId", generalLimit, (req, res) => {
  try {
    const stores = getStores(req);
    const { battleId } = req.params;
    const { adminOtp } = req.body;

    logWithTimestamp("전투 삭제 요청", "INFO", { battleId });

    const battle = stores.getBattle?.(battleId);
    if (!battle) throw new Error("전투를 찾을 수 없습니다");

    const otp = battle.adminOtp || (battle.getSnapshot?.() || {}).adminOtp;
    if (!adminOtp || adminOtp !== otp) {
      throw new Error("관리자 권한이 필요합니다");
    }

    const snap = battle.getSnapshot?.() || battle.getBattleState?.() || {};
    (snap.players || []).forEach((p) => {
      if (p.avatar && p.avatar.startsWith("/uploads/")) {
        const fp = path.join(uploadDir, path.basename(p.avatar));
        fs.unlink(fp, () => {});
      }
    });

    if (typeof stores.deleteBattle === "function") {
      stores.deleteBattle(battleId);
    } else if (typeof battle.cleanup === "function") {
      battle.cleanup();
    } else {
      throw new Error("전투 삭제 기능이 비활성화되어 있습니다");
    }

    logWithTimestamp("전투 삭제 성공", "INFO", { battleId });
    sendSuccess(res, {}, "전투가 성공적으로 삭제되었습니다");
  } catch (err) {
    logWithTimestamp("전투 삭제 실패", "ERROR", err);
    sendError(res, 403, err);
  }
});

/* ─────────────────────────────────────────────
 * 건강 체크
 * GET /api/health
 * ────────────────────────────────────────────*/
router.get("/health", (_req, res) => {
  const uptime = process.uptime();
  const m = process.memoryUsage();
  sendSuccess(res, {
    status: "healthy",
    uptime: Math.floor(uptime),
    memory: {
      used: Math.round(m.heapUsed / 1024 / 1024) + " MB",
      total: Math.round(m.heapTotal / 1024 / 1024) + " MB",
      external: Math.round(m.external / 1024 / 1024) + " MB",
    },
    version: process.env.npm_package_version || "1.0.0",
    environment: process.env.NODE_ENV || "development",
    timestamp: Date.now(),
  });
});

/* ─────────────────────────────────────────────
 * 전역 에러 핸들러
 * ────────────────────────────────────────────*/
router.use((err, req, res, _next) => {
  logWithTimestamp("전역 에러 발생", "ERROR", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return sendError(res, 400, "파일 크기가 너무 큽니다");
    if (err.code === "LIMIT_FILE_COUNT") return sendError(res, 400, "파일 개수가 너무 많습니다");
    if (err.code === "LIMIT_UNEXPECTED_FILE") return sendError(res, 400, "예상하지 못한 파일 필드입니다");
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return sendError(res, 400, "잘못된 JSON 형식입니다");
  }

  sendError(res, 500, "서버 내부 오류가 발생했습니다");
});

module.exports = router;
