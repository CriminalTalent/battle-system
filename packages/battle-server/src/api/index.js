// packages/battle-server/src/api/index.js
// PYXIS API Routes - ESM Enhanced Design Version
// 강화된 에러 처리, 보안, 로깅, 검증
// 용어: 전투참여자(Player), OTP(비밀번호), A팀/B팀 분류

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─────────────────────────────────────────────
// 로깅 헬퍼
// ─────────────────────────────────────────────
function logWithTimestamp(message, level = 'INFO', data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}][API][${level}] ${message}`;

  if (level === 'ERROR') console.error(logMessage, data || '');
  else if (level === 'WARN') console.warn(logMessage, data || '');
  else console.log(logMessage, data || '');
}

// 응답 헬퍼
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
  if (details && process.env.NODE_ENV === 'development') response.details = details;
  res.status(statusCode).json(response);
}

// 입력 검증
function validateRequired(data, fields) {
  const missing = [];
  fields.forEach(field => {
    if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
      missing.push(field);
    }
  });
  if (missing.length > 0) throw new Error(`필수 필드 누락: ${missing.join(', ')}`);
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

// ─────────────────────────────────────────────
// 미들웨어
// ─────────────────────────────────────────────
router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 요청 로깅
router.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - start;
    logWithTimestamp(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
      res.statusCode >= 400 ? 'WARN' : 'INFO');
    originalSend.call(this, data);
  };
  next();
});

// Rate limiting
const createRateLimit = (windowMs, max, message) =>
  rateLimit({ windowMs, max, message: { ok: false, error: message }, standardHeaders: true, legacyHeaders: false });

const battleCreationLimit = createRateLimit(60000, 5, '전투 생성 요청이 너무 많습니다.');
const generalLimit = createRateLimit(60000, 60, 'API 요청이 너무 많습니다.');
const uploadLimit = createRateLimit(60000, 10, '파일 업로드 요청이 너무 많습니다.');

// ─────────────────────────────────────────────
// 전투 생성
// ─────────────────────────────────────────────
router.post('/battles', battleCreationLimit, (req, res) => {
  try {
    const { mode, options = {} } = req.body;
    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    const battleMode = validModes.includes(mode) ? mode : '2v2';

    const battleOptions = {
      timeLimit: (options.timeLimit || 3600) * 1000, // 초 → ms
      turnTimeLimit: (options.turnTimeLimit || 300) * 1000,
      maxSpectators: 30,
    };

    const battles = req.app.get('battles');
    const generateId = () => 'battle_' + Math.random().toString(36).slice(2, 10);
    const generateOTP = (length = 8) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    };

    const battleId = generateId();
    const adminOtp = generateOTP(8);

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
      options: battleOptions,
    };

    battles.set(battleId, battle);

    const passwordStore = req.app.get('passwordStore');
    passwordStore.set(`admin_${battleId}`, {
      password: adminOtp,
      battleId,
      role: 'admin',
      expires: Date.now() + 30 * 60 * 1000,
    });

    sendSuccess(res, {
      battleId,
      adminOtp,
      mode: battleMode,
      urls: {
        admin: `/admin?battle=${battleId}&otp=${adminOtp}`,
        status: `/api/battles/${battleId}`,
      },
    }, '전투가 성공적으로 생성되었습니다.');
  } catch (err) {
    logWithTimestamp('전투 생성 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 전투참여자 추가
// ─────────────────────────────────────────────
router.post('/battles/:battleId/players', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const data = req.body;
    validateRequired(data, ['name', 'team']);

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const player = {
      id: `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: sanitizeString(data.name, 20),
      team: data.team === 'B' ? 'B' : 'A',
      hp: 100,
      maxHp: 100,
      stats: validatePlayerStats(data.stats),
      items: validatePlayerItems(data.items),
      avatar: data.avatar ? sanitizeString(data.avatar, 200) : null,
      status: 'ready',
      joinedAt: Date.now(),
    };

    battle.players.push(player);

    const passwordStore = req.app.get('passwordStore');
    const otp = Math.random().toString(36).slice(2, 8).toUpperCase();
    passwordStore.set(`player_${battleId}_${player.id}`, {
      password: otp, battleId, playerId: player.id, role: 'player',
      expires: Date.now() + 2 * 60 * 60 * 1000,
    });

    sendSuccess(res, {
      player: { ...player, otp },
    }, '전투참여자가 추가되었습니다.');
  } catch (err) {
    logWithTimestamp('전투참여자 추가 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

// 스탯 검증
function validatePlayerStats(stats) {
  const { attack = 3, defense = 3, agility = 3, luck = 3 } = stats || {};
  [attack, defense, agility, luck].forEach(v => {
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error('스탯은 1~5 정수여야 합니다');
  });
  return { attack, defense, agility, luck };
}

// 아이템 검증
function validatePlayerItems(items) {
  const cfg = { dittany: 1, attack_boost: 1, defense_boost: 1 };
  const out = {};
  for (const k in cfg) out[k] = Number.isInteger(items?.[k]) ? items[k] : cfg[k];
  return out;
}

// ─────────────────────────────────────────────
// 비밀번호 발급
// ─────────────────────────────────────────────
router.post('/password', generalLimit, (req, res) => {
  try {
    const { role, battleId, playerId } = req.body;
    validateRequired({ role, battleId }, ['role', 'battleId']);

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const passwordStore = req.app.get('passwordStore');
    const generateOTP = (length = 6) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    };

    let password, url, expiresIn;
    switch (role) {
      case 'admin':
        password = generateOTP(8);
        passwordStore.set(`admin_${battleId}`, {
          password, battleId, role: 'admin', expires: Date.now() + 60 * 60 * 1000,
        });
        url = `/admin?battle=${battleId}&otp=${password}`;
        expiresIn = 60 * 60 * 1000;
        break;
      case 'spectator':
        password = generateOTP(6);
        passwordStore.set(`spectator_${battleId}_${Date.now()}`, {
          password, battleId, role: 'spectator', expires: Date.now() + 30 * 60 * 1000,
        });
        url = `/watch?battle=${battleId}&token=${password}`;
        expiresIn = 30 * 60 * 1000;
        break;
      case 'player':
        validateRequired({ playerId }, ['playerId']);
        const player = battle.players.find(p => p.id === playerId);
        if (!player) throw new Error('전투참여자를 찾을 수 없습니다');
        password = generateOTP(6);
        passwordStore.set(`player_${battleId}_${playerId}`, {
          password, battleId, playerId, role: 'player', expires: Date.now() + 2 * 60 * 60 * 1000,
        });
        url = `/player?battle=${battleId}&token=${password}&name=${encodeURIComponent(player.name)}`;
        expiresIn = 2 * 60 * 60 * 1000;
        break;
      default:
        throw new Error('지원되지 않는 역할입니다');
    }

    sendSuccess(res, { password, url, role, expiresIn }, `${role} OTP가 발급되었습니다`);
  } catch (err) {
    logWithTimestamp('비밀번호 발급 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

// ─────────────────────────────────────────────
// 아바타 업로드
// ─────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function validateImageFile(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.mimetype)) throw new Error('지원되지 않는 파일 형식입니다');
  if (file.size > 5 * 1024 * 1024) throw new Error('파일 크기가 너무 큽니다');
}

function generateSafeFilename(originalName, playerId) {
  const ext = path.extname(originalName).toLowerCase();
  return `avatar-${playerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    try {
      validateImageFile(file);
      cb(null, generateSafeFilename(file.originalname, req.body.playerId || 'unknown'));
    } catch (e) { cb(e); }
  },
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.post('/battles/:battleId/avatar', uploadLimit, upload.single('avatar'), (req, res) => {
  try {
    const { battleId } = req.params;
    const { playerId } = req.body;
    if (!req.file) throw new Error('업로드된 파일이 없습니다');
    validateRequired({ playerId }, ['playerId']);

    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const player = battle.players.find(p => p.id === playerId);
    if (!player) throw new Error('전투참여자를 찾을 수 없습니다');

    const fileUrl = `/uploads/${req.file.filename}`;
    player.avatar = fileUrl;

    sendSuccess(res, { url: fileUrl }, '아바타 업로드 성공');
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    logWithTimestamp('아바타 업로드 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 전투 상태 확인
// ─────────────────────────────────────────────
router.get('/battles/:battleId', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const { detailed } = req.query;
    const battles = req.app.get('battles');
    const battle = battles.get(battleId);
    if (!battle) throw new Error('전투를 찾을 수 없습니다');

    const baseData = {
      id: battleId, mode: battle.mode, status: battle.status,
      playerCount: battle.players.length, createdAt: battle.createdAt,
      startedAt: battle.startedAt, endedAt: battle.endedAt,
      currentTurn: battle.currentTurn,
    };

    if (String(detailed) === 'true') {
      sendSuccess(res, {
        ...baseData,
        players: battle.players.map(p => ({ id: p.id, name: p.name, team: p.team, hp: p.hp })),
      });
    } else sendSuccess(res, baseData);
  } catch (err) {
    logWithTimestamp('전투 상태 조회 실패', 'ERROR', err);
    sendError(res, 404, err);
  }
});

// ─────────────────────────────────────────────
// 서버 상태 확인
// ─────────────────────────────────────────────
router.get('/health', (req, res) => {
  sendSuccess(res, {
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─────────────────────────────────────────────
// 전역 에러 핸들러
// ─────────────────────────────────────────────
router.use((err, req, res, next) => {
  logWithTimestamp('전역 에러 발생', 'ERROR', { message: err.message, stack: err.stack });
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 400, '파일 크기가 너무 큽니다');
  }
  sendError(res, 500, '서버 내부 오류');
});

export default router;
