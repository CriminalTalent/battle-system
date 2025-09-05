const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const {
  createBattle,
  getBattle,
  addPlayerToBattle,
} = require('../socket/battle-handlers');

// ─────────────────────────────────────────────
// PYXIS API Routes - Enhanced Design Version
// 강화된 에러 처리, 보안, 로깅, 검증
// ─────────────────────────────────────────────

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

// JSON 파싱 미들웨어 (크기 제한)
router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 요청 로깅 미들웨어
router.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
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
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { ok: false, error: message },
  standardHeaders: true,
  legacyHeaders: false,
});

// 전투 생성 제한 (1분에 5개)
const battleCreationLimit = createRateLimit(
  60 * 1000, 
  5, 
  '전투 생성 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
);

// 일반 API 제한 (1분에 60개)
const generalLimit = createRateLimit(
  60 * 1000, 
  60, 
  'API 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
);

// 파일 업로드 제한 (1분에 10개)
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
    
    // 입력 검증
    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    const battleMode = mode || '2v2';
    
    if (!validModes.includes(battleMode)) {
      throw new Error(`지원되지 않는 전투 모드입니다. 사용 가능한 모드: ${validModes.join(', ')}`);
    }
    
    // 옵션 검증 및 기본값
    const battleOptions = {
      timeLimit: Math.min(Math.max(options.timeLimit || 3600, 600), 7200), // 10분~2시간
      turnTimeLimit: Math.min(Math.max(options.turnTimeLimit || 300, 30), 600), // 30초~10분
      maxSpectators: Math.min(Math.max(options.maxSpectators || 30, 1), 100), // 1~100명
      allowReconnect: options.allowReconnect !== false, // 기본값 true
      privateMode: !!options.privateMode, // 기본값 false
      ...options
    };
    
    const { battleId, adminOtp } = createBattle(battleMode, battleOptions);
    
    logWithTimestamp('전투 생성 성공', 'INFO', { battleId, mode: battleMode });
    
    sendSuccess(res, {
      battleId,
      adminOtp,
      mode: battleMode,
      options: battleOptions,
      urls: {
        admin: `/admin?battle=${battleId}&otp=${adminOtp}`,
        status: `/api/battles/${battleId}`
      }
    }, '전투가 성공적으로 생성되었습니다');
    
  } catch (err) {
    logWithTimestamp('전투 생성 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 플레이어 추가 API
// POST /api/battles/:battleId/players
// ─────────────────────────────────────────────

router.post('/battles/:battleId/players', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const playerData = req.body;
    
    logWithTimestamp('플레이어 추가 요청', 'INFO', { battleId, playerName: playerData.name });
    
    // 입력 검증
    validateRequired(playerData, ['name', 'team']);
    
    // 데이터 정리
    const sanitizedData = {
      name: sanitizeString(playerData.name, 20),
      team: sanitizeString(playerData.team, 10),
      stats: validatePlayerStats(playerData.stats),
      items: validatePlayerItems(playerData.items),
      avatar: playerData.avatar ? sanitizeString(playerData.avatar, 200) : null
    };
    
    // 이름 중복 검사
    const battle = getBattle(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }
    
    const existingPlayer = Object.values(battle.players || {}).find(p => p.name === sanitizedData.name);
    if (existingPlayer) {
      throw new Error('이미 같은 이름의 플레이어가 존재합니다');
    }
    
    const player = addPlayerToBattle(battleId, sanitizedData);
    
    logWithTimestamp('플레이어 추가 성공', 'INFO', { 
      battleId, 
      playerId: player.id, 
      playerName: player.name 
    });
    
    sendSuccess(res, {
      player: {
        id: player.id,
        name: player.name,
        team: player.team,
        token: player.token,
        stats: player.stats,
        items: player.items,
        url: `/play?battle=${battleId}&token=${player.token}&name=${encodeURIComponent(player.name)}`
      }
    }, '플레이어가 성공적으로 추가되었습니다');
    
  } catch (err) {
    logWithTimestamp('플레이어 추가 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

// 플레이어 스탯 검증
function validatePlayerStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return { attack: 3, defense: 3, agility: 3, luck: 3 };
  }
  
  const { attack = 3, defense = 3, agility = 3, luck = 3 } = stats;
  const total = attack + defense + agility + luck;
  
  // 총합 12포인트 검증
  if (total !== 12) {
    throw new Error('스탯 총합은 12포인트여야 합니다');
  }
  
  // 각 스탯 1~10 범위 검증
  [attack, defense, agility, luck].forEach((stat, index) => {
    const statNames = ['공격력', '방어력', '민첩성', '행운'];
    if (stat < 1 || stat > 10 || !Number.isInteger(stat)) {
      throw new Error(`${statNames[index]}은 1~10 범위의 정수여야 합니다`);
    }
  });
  
  return { attack, defense, agility, luck };
}

// 플레이어 아이템 검증
function validatePlayerItems(items) {
  if (!items || typeof items !== 'object') {
    return { dittany: 1, atkBoost: 1, defBoost: 1 };
  }
  
  const validatedItems = {};
  const allowedItems = {
    dittany: { min: 0, max: 5, default: 1 },
    atkBoost: { min: 0, max: 3, default: 1 },
    defBoost: { min: 0, max: 3, default: 1 }
  };
  
  Object.entries(allowedItems).forEach(([itemName, config]) => {
    const value = items[itemName] ?? config.default;
    
    if (!Number.isInteger(value) || value < config.min || value > config.max) {
      throw new Error(`${itemName} 아이템은 ${config.min}~${config.max} 범위여야 합니다`);
    }
    
    validatedItems[itemName] = value;
  });
  
  return validatedItems;
}

// ─────────────────────────────────────────────
// OTP 발급 API (보안 강화)
// POST /api/otp
// ─────────────────────────────────────────────

router.post('/otp', generalLimit, (req, res) => {
  try {
    const { role, battleId, playerId, name } = req.body;
    
    logWithTimestamp('OTP 발급 요청', 'INFO', { role, battleId, playerId: playerId ? '***' : null });
    
    // 입력 검증
    validateRequired({ role, battleId }, ['role', 'battleId']);
    
    const battle = getBattle(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }
    
    let otp, url, expiresIn;
    
    switch (role) {
      case 'admin':
        otp = battle.adminOtp;
        url = `/admin?battle=${battleId}&otp=${otp}`;
        expiresIn = null; // 만료 없음
        break;
        
      case 'spectator':
        otp = battle.spectatorOtp;
        url = `/watch?battle=${battleId}&otp=${otp}`;
      case 'spectator':
        otp = battle.spectatorOtp;
        url = `/watch?battle=${battleId}&otp=${otp}`;
        expiresIn = 30 * 60 * 1000; // 30분
        break;
        
      case 'player':
        validateRequired({ playerId }, ['playerId']);
        const player = battle.getPlayer(playerId);
        if (!player) {
          throw new Error('플레이어를 찾을 수 없습니다');
        }
        otp = player.token;
        url = `/play?battle=${battleId}&token=${otp}&name=${encodeURIComponent(player.name)}`;
        expiresIn = 2 * 60 * 60 * 1000; // 2시간
        break;
        
      default:
        throw new Error('지원되지 않는 역할입니다. 사용 가능한 역할: admin, player, spectator');
    }
    
    logWithTimestamp('OTP 발급 성공', 'INFO', { role, battleId });
    
    sendSuccess(res, {
      otp,
      url,
      role,
      expiresIn,
      qrCode: generateQRCodeUrl(url) // QR 코드 URL 생성
    }, `${role} OTP가 성공적으로 발급되었습니다`);
    
  } catch (err) {
    logWithTimestamp('OTP 발급 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

// QR 코드 URL 생성 헬퍼
function generateQRCodeUrl(url) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullUrl)}`;
}

// ─────────────────────────────────────────────
// 아바타 업로드 API (보안 강화)
// POST /api/battles/:battleId/avatar
// ─────────────────────────────────────────────

const uploadDir = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// 파일 검증 헬퍼
function validateImageFile(file) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB
  
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error('지원되지 않는 파일 형식입니다. JPG, PNG, GIF, WebP만 업로드 가능합니다');
  }
  
  if (file.size > maxSize) {
    throw new Error('파일 크기가 너무 큽니다. 최대 5MB까지 업로드 가능합니다');
  }
}

// 안전한 파일명 생성
function generateSafeFilename(originalName, playerId) {
  const ext = path.extname(originalName).toLowerCase();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `avatar-${playerId}-${timestamp}-${random}${ext}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    try {
      validateImageFile(file);
      const safeFilename = generateSafeFilename(file.originalname, req.body.playerId || 'unknown');
      cb(null, safeFilename);
    } catch (error) {
      cb(error);
    }
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    try {
      validateImageFile(file);
      cb(null, true);
    } catch (error) {
      cb(error, false);
    }
  }
});

router.post('/battles/:battleId/avatar', uploadLimit, upload.single('avatar'), (req, res) => {
  try {
    const { battleId } = req.params;
    const { playerId } = req.body;
    
    logWithTimestamp('아바타 업로드 요청', 'INFO', { battleId, playerId, filename: req.file?.filename });
    
    if (!req.file) {
      throw new Error('업로드된 파일이 없습니다');
    }
    
    validateRequired({ playerId }, ['playerId']);
    
    const battle = getBattle(battleId);
    if (!battle) {
      // 업로드된 파일 삭제
      fs.unlink(req.file.path, () => {});
      throw new Error('전투를 찾을 수 없습니다');
    }

    const player = battle.getPlayer(playerId);
    if (!player) {
      // 업로드된 파일 삭제
      fs.unlink(req.file.path, () => {});
      throw new Error('플레이어를 찾을 수 없습니다');
    }

    // 기존 아바타 파일 삭제
    if (player.avatar && player.avatar.startsWith('/uploads/')) {
      const oldFilePath = path.join(uploadDir, path.basename(player.avatar));
      fs.unlink(oldFilePath, (err) => {
        if (err) logWithTimestamp('기존 아바타 삭제 실패', 'WARN', err);
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    player.avatar = fileUrl;
    
    logWithTimestamp('아바타 업로드 성공', 'INFO', { battleId, playerId, fileUrl });

    sendSuccess(res, {
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    }, '아바타가 성공적으로 업로드되었습니다');
    
  } catch (err) {
    // 에러 발생시 업로드된 파일 삭제
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    
    logWithTimestamp('아바타 업로드 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 전투 상태 확인 API (상세 정보 포함)
// GET /api/battles/:battleId
// ─────────────────────────────────────────────

router.get('/battles/:battleId', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const { detailed = false } = req.query;
    
    logWithTimestamp('전투 상태 조회', 'INFO', { battleId, detailed });
    
    const battle = getBattle(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }

    const snapshot = battle.getSnapshot();
    const baseData = {
      id: battleId,
      mode: battle.mode,
      phase: battle.phase,
      status: battle.status,
      playerCount: Object.keys(battle.players || {}).length,
      spectatorCount: battle.spectatorCount || 0,
      createdAt: battle.createdAt,
      updatedAt: battle.updatedAt
    };
    
    if (detailed === 'true') {
      // 상세 정보 포함
      sendSuccess(res, {
        ...baseData,
        state: snapshot,
        statistics: {
          totalTurns: battle.turnCount || 0,
          totalActions: battle.actionCount || 0,
          averageTurnTime: battle.averageTurnTime || 0,
          battleDuration: Date.now() - (battle.startedAt || battle.createdAt || Date.now())
        }
      });
    } else {
      // 기본 정보만
      sendSuccess(res, baseData);
    }
    
  } catch (err) {
    logWithTimestamp('전투 상태 조회 실패', 'ERROR', err);
    sendError(res, 404, err);
  }
});

// ─────────────────────────────────────────────
// 전투 목록 조회 API
// GET /api/battles
// ─────────────────────────────────────────────

router.get('/battles', generalLimit, (req, res) => {
  try {
    const { 
      status, 
      mode, 
      limit = 20, 
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    logWithTimestamp('전투 목록 조회', 'INFO', { status, mode, limit, offset });
    
    // 여기서는 실제 전투 목록을 가져오는 로직이 필요
    // 현재는 예시 응답
    const battles = []; // getBattleList() 함수 필요
    
    const filteredBattles = battles
      .filter(battle => !status || battle.status === status)
      .filter(battle => !mode || battle.mode === mode)
      .sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (sortOrder === 'desc') return bVal > aVal ? 1 : -1;
        return aVal > bVal ? 1 : -1;
      })
      .slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    sendSuccess(res, {
      battles: filteredBattles,
      pagination: {
        total: battles.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < battles.length
      }
    });
    
  } catch (err) {
    logWithTimestamp('전투 목록 조회 실패', 'ERROR', err);
    sendError(res, 500, err);
  }
});

// ─────────────────────────────────────────────
// 플레이어 삭제 API
// DELETE /api/battles/:battleId/players/:playerId
// ─────────────────────────────────────────────

router.delete('/battles/:battleId/players/:playerId', generalLimit, (req, res) => {
  try {
    const { battleId, playerId } = req.params;
    
    logWithTimestamp('플레이어 삭제 요청', 'INFO', { battleId, playerId });
    
    const battle = getBattle(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }
    
    const player = battle.getPlayer(playerId);
    if (!player) {
      throw new Error('플레이어를 찾을 수 없습니다');
    }
    
    // 전투가 진행 중이면 삭제 불가
    if (battle.status === 'active') {
      throw new Error('진행 중인 전투에서는 플레이어를 삭제할 수 없습니다');
    }
    
    // 아바타 파일 삭제
    if (player.avatar && player.avatar.startsWith('/uploads/')) {
      const filePath = path.join(uploadDir, path.basename(player.avatar));
      fs.unlink(filePath, (err) => {
        if (err) logWithTimestamp('아바타 파일 삭제 실패', 'WARN', err);
      });
    }
    
    // 플레이어 삭제 (실제 구현 필요)
    // battle.removePlayer(playerId);
    
    logWithTimestamp('플레이어 삭제 성공', 'INFO', { battleId, playerId });
    
    sendSuccess(res, {}, '플레이어가 성공적으로 삭제되었습니다');
    
  } catch (err) {
    logWithTimestamp('플레이어 삭제 실패', 'ERROR', err);
    sendError(res, 400, err);
  }
});

// ─────────────────────────────────────────────
// 전투 삭제 API
// DELETE /api/battles/:battleId
// ─────────────────────────────────────────────

router.delete('/battles/:battleId', generalLimit, (req, res) => {
  try {
    const { battleId } = req.params;
    const { adminOtp } = req.body;
    
    logWithTimestamp('전투 삭제 요청', 'INFO', { battleId });
    
    const battle = getBattle(battleId);
    if (!battle) {
      throw new Error('전투를 찾을 수 없습니다');
    }
    
    // 관리자 권한 확인
    if (!adminOtp || adminOtp !== battle.adminOtp) {
      throw new Error('관리자 권한이 필요합니다');
    }
    
    // 모든 플레이어의 아바타 파일 삭제
    Object.values(battle.players || {}).forEach(player => {
      if (player.avatar && player.avatar.startsWith('/uploads/')) {
        const filePath = path.join(uploadDir, path.basename(player.avatar));
        fs.unlink(filePath, (err) => {
          if (err) logWithTimestamp('아바타 파일 삭제 실패', 'WARN', err);
        });
      }
    });
    
    // 전투 삭제 (실제 구현 필요)
    // deleteBattle(battleId);
    
    logWithTimestamp('전투 삭제 성공', 'INFO', { battleId });
    
    sendSuccess(res, {}, '전투가 성공적으로 삭제되었습니다');
    
  } catch (err) {
    logWithTimestamp('전투 삭제 실패', 'ERROR', err);
    sendError(res, 403, err);
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
      external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB'
    },
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: Date.now()
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
    method: req.method
  });
  
  // Multer 에러 처리
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
  
  // JSON 파싱 에러
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendError(res, 400, '잘못된 JSON 형식입니다');
  }
  
  // 기본 에러 응답
  sendError(res, 500, '서버 내부 오류가 발생했습니다');
});

module.exports = router;
