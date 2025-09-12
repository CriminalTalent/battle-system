// packages/battle-server/src/api/index.js
// PYXIS API Routes - ESM Enhanced Design Version
// 강화된 에러 처리, 보안, 로깅, 검증
// 용어: 전투참여자(Player), 비밀번호(OTP), A팀/B팀 분류

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 로깅 헬퍼
function logWithTimestamp(message, level = 'INFO', data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}][API][${level}] ${message}`;
  
  if (level === 'ERROR') {
    console.error(logMessage, data || '');
  } else if (level === 'WARN') {
    console.warn(logMessage, data || '');
  } else {
    console.log(logMessage, data || '');
  }
}

// 공통 응답 헬퍼
function sendSuccess(res, data = {}, message = null) {
  const response = {
    ok: true,
    timestamp: Date.now(),
    ...data
  };
  if (message) response.message = message;
  res.json(response);
}

function sendError(res, statusCode, error, details = null) {
  const response = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    timestamp: Date.now()
  };
  if (details && process.env.NODE_ENV === 'development') {
    response.details = details;
  }
  res.status(statusCode).json(response);
}

// 입력 검증 헬퍼
function validateRequired(data, fields) {
  const missing = [];
  fields.forEach(field => {
    if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
      missing.push(field);
    }
  });
  if (missing.length > 0) {
    throw new Error(`필수 필드가 누락되었습니다: ${missing.join(', ')}`);
  }
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

// ─────────────────────────────────────────────
// 미들웨어 설정
// ─────────────────────────────────────────────

router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 요청 로깅 미들웨어
router.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - start;
    logWithTimestamp(
      `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
      res.statusCode >= 400 ? 'WARN' : 'INFO'
    );
    originalSend.call(this, data);
  };
  next();
});

// Rate Limiting
const createRateLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { ok: false, error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });

const battleCreationLimit = createRateLimit(
  60 * 1000,
  5,
  '전투 생성 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
);

const generalLimit = createRateLimit(
  60 * 1000,
  60,
  'API 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
);

const uploadLimit = createRateLimit(
  60 * 1000,
  10,
  '파일 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
);

// ─────────────────────────────────────────────
// 전투 생성 API
// POST /api/battles
// ─────────────────────────────────────────────

router.post('/battles', battleCreationLimit, (req, res) => {
  try {
    logWithTimestamp('전투 생성 요청 수신', 'INFO', { body: req.body });
    const { mode, options = {} } = req.body;

    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    const battleMode = mode || '2v2';
    if (!validModes.includes(battleMode)) {
      throw new Error(
        `지원되지 않는 전투 모드입니다. 사용 가능한 모드: ${validModes.join(', ')}`
      );
    }

    const battleOptions = {
      timeLimit: Math.min(Math.max(options.timeLimit || 3600, 600), 7200), // 10분~2시간 (초)
      turnTimeLimit: Math.min(Math.max(options.turnTimeLimit || 300, 30), 600), // 30초~10분 (초)
      maxSpectators: Math.min(Math.max(options.maxSpectators || 30, 1), 100),
      allowReconnect: options.allowReconnect !== false,
      privateMode: !!options.privateMode,
      ...options,
    };

    // 전투 생성 함수 호출 (index.js에서 정의됨)
    const battles = req.app.get('battles');
    const generateId = () => 'battle_' + Math.random().toString(36).slice(2, 10);
    const generatePassword = (length = 8) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const battleId = generateId();
    const adminPassword = generatePassword(8);

    // 전투 상태 생성
    const battle = {
      id: battleId,
      mode: battleMode,
      status: 'waiting',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      players: [],
      currentTurn: 0,
      currentPlayer: null,
      leadingTeam: null,
      effects: [],
      logs: [],
      options: battleOptions
    };

    battles.set(battleId, battle);

    // 비밀번호 저장
    const passwordStore = req.app.get('passwordStore');
    passwordStore.set(`admin_${battleId}`, {
      password: adminPassword,
      battleId,
      role: 'admin',
      expires: Date.now() + 30 * 60 * 1000 // 30분
    });

    logWithTimestamp('전투 생성 성공', 'INFO', { battleId, mode: battleMode });

    sendSuccess(
      res,
      {
        battleId,
        adminPassword,
        mode: battleMode,
        options: battleOptions,
        urls: {
          admin: `/admin?battle=${battleId}&password=${adminPassword}`,
          status: `/api/battles/${battleId}`,
        },
      },
      '전투가 성공적으로 생성되었습니다'
    );
  } catch (err) {
    logWithTimestamp('전투 생성 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 전투참여자 추가 API
// POST /api/battles/:battleId/players
// ─────────────────────────────────────────────

router.post('/battles/:battleId/players', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const playerData = req.body;

    logWithTimestamp('전투참여자 추가 요청', 'INFO', {
      battleId,
      playerName: playerData?.name,
    });

    validateRequired(playerData, ['name', 'team']);

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const sanitizedData = {
      name: sanitizeString(playerData.name, 20),
      team: playerData.team === 'B' ? 'B' : 'A', // A팀 또는 B팀
      stats: validatePlayerStats(playerData.stats),
      items: validatePlayerItems(playerData.items),
      avatar: playerData.avatar ? sanitizeString(playerData.avatar, 200) : null,
    };

    // 이름 중복 체크
    const existingNames = battle.players.map(p => (p.name || '').toLowerCase());
    if (existingNames.includes(sanitizedData.name.toLowerCase())) {
      throw new Error('이미 같은 이름의 전투참여자가 존재합니다');
    }

    // 최대 인원 체크
    const maxPlayers = parseInt(battle.mode.charAt(0)) * 2;
    if (battle.players.length >= maxPlayers) {
      throw new Error('전투가 가득 찼습니다');
    }

    // 전투참여자 생성
    const player = {
      id: `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: sanitizedData.name,
      team: sanitizedData.team,
      hp: 100,
      maxHp: 100,
      stats: sanitizedData.stats,
      items: sanitizedData.items,
      avatar: sanitizedData.avatar,
      status: 'ready',
      lastAction: null,
      joinedAt: Date.now()
    };

    battle.players.push(player);

    // 전투참여자용 비밀번호 생성
    const passwordStore = req.app.get('passwordStore');
    const playerPassword = Math.random().toString(36).slice(2, 8).toUpperCase();
    passwordStore.set(`player_${battleId}_${player.id}`, {
      password: playerPassword,
      battleId,
      playerId: player.id,
      role: 'player',
      expires: Date.now() + 2 * 60 * 60 * 1000 // 2시간
    });

    logWithTimestamp('전투참여자 추가 성공', 'INFO', {
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
          password: playerPassword,
          stats: player.stats,
          items: player.items,
          url: `/player?battle=${battleId}&token=${playerPassword}&name=${encodeURIComponent(
            player.name
          )}`,
        },
      },
      '전투참여자가 성공적으로 추가되었습니다'
    );
  } catch (err) {
    logWithTimestamp('전투참여자 추가 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

// 전투참여자 스탯 검증 (1-5 범위, 총합 제한 없음)
function validatePlayerStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return { attack: 3, defense: 3, agility: 3, luck: 3 };
  }
  const { attack = 3, defense = 3, agility = 3, luck = 3 } = stats;
  const names = ['공격력', '방어력', '민첩성', '행운'];
  const values = [attack, defense, agility, luck];
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`${names[i]}은 1~5 범위의 정수여야 합니다`);
    }
  });
  return { attack, defense, agility, luck };
}

// 아이템 검증 (0~5 범위)
function validatePlayerItems(items) {
  if (!items || typeof items !== 'object') {
    return { dittany: 1, attack_boost: 1, defense_boost: 1 };
  }
  const cfg = {
    dittany: { min: 0, max: 5, def: 1 },
    attack_boost: { min: 0, max: 5, def: 1 },
    defense_boost: { min: 0, max: 5, def: 1 },
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

// ─────────────────────────────────────────────
// 비밀번호 발급 API
// POST /api/password
// ─────────────────────────────────────────────

router.post('/password', generalLimit, (req, res) => {
  try {
    const { role, battleId, playerId } = req.body;
    logWithTimestamp('비밀번호 발급 요청', 'INFO', {
      role,
      battleId,
      playerId: playerId ? '***' : null,
    });

    validateRequired({ role, battleId }, ['role', 'battleId']);

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const passwordStore = req.app.get('passwordStore');
    const generatePassword = (length = 6) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    let password, url, expiresIn;

    switch (role) {
      case 'admin': {
        const existing = passwordStore.get(`admin_${battleId}`);
        if (existing && existing.expires > Date.now()) {
          password = existing.password;
        } else {
          password = generatePassword(8);
          passwordStore.set(`admin_${battleId}`, {
            password,
            battleId,
            role: 'admin',
            expires: Date.now() + 60 * 60 * 1000 // 1시간
          });
        }
        url = `/admin?battle=${battleId}&password=${password}`;
        expiresIn = 60 * 60 * 1000;
        break;
      }
      case 'spectator': {
        password = generatePassword(6);
        passwordStore.set(`spectator_${battleId}_${Date.now()}`, {
          password,
          battleId,
          role: 'spectator',
          expires: Date.now() + 30 * 60 * 1000 // 30분
        });
        url = `/watch?battle=${battleId}&token=${password}`;
        expiresIn = 30 * 60 * 1000;
        break;
      }
      case 'player': {
        validateRequired({ playerId }, ['playerId']);
        const player = battle.players.find(p => p.id === playerId);
        if (!player) throw new Error('전투참여자를 찾을 수 없습니다');
        
        const existing = passwordStore.get(`player_${battleId}_${playerId}`);
        if (existing && existing.expires > Date.now()) {
          password = existing.password;
        } else {
          password = generatePassword(6);
          passwordStore.set(`player_${battleId}_${playerId}`, {
            password,
            battleId,
            playerId,
            role: 'player',
            expires: Date.now() + 2 * 60 * 60 * 1000 // 2시간
          });
        }
        url = `/player?battle=${battleId}&token=${password}&name=${encodeURIComponent(player.name)}`;
        expiresIn = 2 * 60 * 60 * 1000;
        break;
      }
      default:
        throw new Error('지원되지 않는 역할입니다. 사용 가능한 역할: admin, player, spectator');
    }

    logWithTimestamp('비밀번호 발급 성공', 'INFO', { role, battleId });

    sendSuccess(
      res,
      {
        password,
        url,
        role,
        expiresIn,
        qrCode: generateQRCodeUrl(url),
      },
      `${role} 비밀번호가 성공적으로 발급되었습니다`
    );
  } catch (err) {
    logWithTimestamp('비밀번호 발급 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

function generateQRCodeUrl(urlPath) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${baseUrl}${urlPath}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    fullUrl
  )}`;
}

// ─────────────────────────────────────────────
// 아바타 업로드 API
// POST /api/battles/:battleId/avatar
// ─────────────────────────────────────────────

const uploadDir = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function validateImageFile(file) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 5 * 1024 * 1024;
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error('지원되지 않는 파일 형식입니다. JPG, PNG, GIF, WebP만 업로드 가능합니다');
  }
  if (file.size > maxSize) {
    throw new Error('파일 크기가 너무 큽니다. 최대 5MB까지 업로드 가능합니다');
  }
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
      const safe = generateSafeFilename(file.originalname, req.body.playerId || 'unknown');
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

router.post('/battles/:battleId/avatar', uploadLimit, upload.single('avatar'), (req, res) => {
  try {
    const { battleId } = req.params;
    const { playerId } = req.body;
    logWithTimestamp('아바타 업로드 요청', 'INFO', {
      battleId,
      playerId,
      filename: req.file?.filename,
    });

    if (!req.file) throw new Error('업로드된 파일이 없습니다');
    validateRequired({ playerId }, ['playerId']);

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) {
      fs.unlink(req.file.path, () => {});
      throw new Error('전투를 찾을 수 없습니다');
    }

    const player = battle.players.find(p => p.id === playerId);
    if (!player) {
      fs.unlink(req.file.path, () => {});
      throw new Error('전투참여자를 찾을 수 없습니다');
    }

    // 기존 파일 삭제 (서버 내부 파일만)
    if (player.avatar && player.avatar.startsWith('/uploads/')) {
      const old = path.join(uploadDir, path.basename(player.avatar));
      fs.unlink(old, () => {});
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    player.avatar = fileUrl;

    logWithTimestamp('아바타 업로드 성공', 'INFO', { battleId, playerId, fileUrl });

    sendSuccess(
      res,
      {
        url: fileUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
      '아바타가 성공적으로 업로드되었습니다'
    );
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    logWithTimestamp('아바타 업로드 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 전투 상태 확인 API
// GET /api/battles/:battleId
// ─────────────────────────────────────────────

router.get('/battles/:battleId', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const { detailed = 'false' } = req.query;

    logWithTimestamp('전투 상태 조회', 'INFO', { battleId, detailed });

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const baseData = {
      id: battleId,
      mode: battle.mode || 'unknown',
      status: battle.status || 'unknown',
      playerCount: battle.players.length,
      spectatorCount: 0, // 추후 구현
      createdAt: battle.createdAt,
      startedAt: battle.startedAt,
      endedAt: battle.endedAt,
      currentTurn: battle.currentTurn,
      currentPlayer: battle.currentPlayer,
    };

    if (String(detailed) === 'true') {
      const teamAHp = battle.players
        .filter(p => p.team === 'A')
        .reduce((sum, p) => sum + p.hp, 0);
      const teamBHp = battle.players
        .filter(p => p.team === 'B')
        .reduce((sum, p) => sum + p.hp, 0);

      sendSuccess(res, {
        ...baseData,
        players: battle.players.map(p => ({
          id: p.id,
          name: p.name,
          team: p.team,
          hp: p.hp,
          maxHp: p.maxHp,
          stats: p.stats,
          items: p.items,
          status: p.status
        })),
        statistics: {
          totalTurns: battle.currentTurn || 0,
          teamAHp,
          teamBHp,
          battleDuration: battle.startedAt 
            ? (battle.endedAt || Date.now()) - battle.startedAt
            : 0,
        },
      });
    } else {
      sendSuccess(res, baseData);
    }
  } catch (err) {
    logWithTimestamp('전투 상태 조회 실패', 'ERROR', err);
    sendError(res, 404, err);
  }
});

// ─────────────────────────────────────────────
// 서버 상태 확인 API
// GET /api/health
// ─────────────────────────────────────────────

router.get('/health', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();

  sendSuccess(res, {
    status: 'healthy',
    uptime: Math.floor(uptime),
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
      external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB',
    },
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// 전역 에러 핸들러
// ─────────────────────────────────────────────

router.use((err, req, res, next) => {
  logWithTimestamp('전역 에러 발생', 'ERROR', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 400, '파일 크기가 너무 큽니다');
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return sendError(res, 400, '파일 개수가 너무 많습니다');
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return sendError(res, 400, '예상하지 못한 파일 필드입니다');
    }
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendError(res, 400, '잘못된 JSON 형식입니다');
  }

  sendError(res, 500, '서버 내부 오류가 발생했습니다');
});

export default router;
