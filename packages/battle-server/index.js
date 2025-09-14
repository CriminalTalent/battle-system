// packages/battle-server/index.js
// PYXIS Battle System - 메인 서버 진입점

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import multer from 'multer';
import crypto from 'crypto';

// 내부 모듈
import { registerSocketEvents } from './src/socket/events.js';
import { battles } from './src/socket/events.js';

// 환경변수 기본값
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// 파일 경로 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Express 앱 생성
const app = express();
const server = createServer(app);

// Socket.IO 설정
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:3001", "http://127.0.0.1:3001"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// 미들웨어 설정
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS 설정
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:3001", "http://127.0.0.1:3001"],
  credentials: true
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: NODE_ENV === 'production' ? 100 : 1000,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }
});
app.use(limiter);

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 정적 파일 서빙
app.use(express.static(join(__dirname, 'public')));
app.use('/uploads', express.static(join(__dirname, 'public/uploads')));

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, join(__dirname, 'public/uploads/avatars'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `avatar-${crypto.randomUUID()}-${Date.now()}${getFileExtension(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다'), false);
    }
  }
});

function getFileExtension(filename) {
  return filename.substring(filename.lastIndexOf('.'));
}

/* ═══════════════════════════════════════════════════════════════
 * API 라우트 - 기존 HTML 호환성 추가
 * ═══════════════════════════════════════════════════════════════ */

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    ok: true, // 기존 HTML 호환
    timestamp: new Date().toISOString(),
    ts: Date.now(), // 기존 HTML 호환
    uptime: process.uptime(),
    version: '3.0.2',
    battles: battles.size,
    memory: process.memoryUsage()
  });
});

// 전투 생성 (기존 HTML 호환)
app.post('/api/battles', (req, res) => {
  try {
    const { mode, title, adminOtp } = req.body;
    
    if (!mode || !['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ 
        ok: false, // 기존 HTML 호환
        error: '유효하지 않은 전투 모드입니다' 
      });
    }
    
    const battleId = crypto.randomUUID();
    const adminPassword = adminOtp || crypto.randomBytes(4).toString('hex').toUpperCase();
    const playerPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
    const spectatorPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    const battle = {
      id: battleId,
      title: title || `PYXIS ${mode} 전투`,
      mode,
      status: 'waiting',
      players: [],
      effects: [],
      logs: [], // 기존 HTML 호환 (log -> logs)
      createdAt: Date.now(),
      adminOtp: adminPassword,
      playerOtp: playerPassword,
      spectatorOtp: spectatorPassword,
      otpExpiry: {
        admin: Date.now() + (60 * 60 * 1000), // 60분
        player: Date.now() + (30 * 60 * 1000), // 30분
        spectator: Date.now() + (30 * 60 * 1000) // 30분
      },
      urls: {
        admin: `/admin?battle=${battleId}&otp=${adminPassword}`,
        player: `/player?battle=${battleId}&otp=${playerPassword}`,
        spectator: `/spectator?battle=${battleId}&otp=${spectatorPassword}`
      },
      // 기존 HTML이 기대하는 필드들
      currentTurn: null
    };
    
    battles.set(battleId, battle);
    
    res.json({
      ok: true, // 기존 HTML 호환
      battleId,
      battle: {
        id: battle.id,
        title: battle.title,
        mode: battle.mode,
        status: battle.status,
        urls: battle.urls,
        passwords: {
          admin: adminPassword,
          player: playerPassword,
          spectator: spectatorPassword
        }
      }
    });
    
    console.log(`[API] Battle created: ${battleId} (${mode})`);
    
  } catch (error) {
    console.error('[API] Create battle error:', error);
    res.status(500).json({ 
      ok: false, // 기존 HTML 호환
      error: '전투 생성 중 오류가 발생했습니다' 
    });
  }
});

// ===== 기존 HTML이 사용하는 링크 생성 API =====
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    const base = `${req.protocol}://${req.get('host')}`;
    
    // 관전자 OTP
    const spectatorOtp = battle.spectatorOtp;
    
    // 플레이어 개별 링크 생성
    const links = [];
    (battle.players || []).forEach((p, idx) => {
      const otp = battle.playerOtp;
      const url = `${base}/player?battle=${battleId}&otp=${otp}&playerId=${p.id}&name=${encodeURIComponent(p.name)}&team=${p.team}`;
      links.push({
        id: idx + 1,
        playerId: p.id,
        playerName: p.name,
        team: p.team,
        otp,
        url,
      });
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator?battle=${battleId}&otp=${spectatorOtp}`,
      playerLinks: links,
    });
    
  } catch (error) {
    console.error('[API] Create links error:', error);
    res.status(500).json({ ok: false, error: 'link_create_failed' });
  }
});

// 기존 HTML 호환용 별칭
app.post('/api/battles/:id/links', (req, res) => {
  req.url = `/api/admin/battles/${req.params.id}/links`;
  req.method = 'POST';
  return app._router.handle(req, res);
});
app.post('/api/battles', (req, res) => {
  try {
    const { mode, title, adminOtp } = req.body;
    
    if (!mode || !['1v1', '2v2', '3v3', '4v4'].includes(mode)) {
      return res.status(400).json({ error: '유효하지 않은 전투 모드입니다' });
    }
    
    const battleId = crypto.randomUUID();
    const adminPassword = adminOtp || crypto.randomBytes(4).toString('hex').toUpperCase();
    const playerPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
    const spectatorPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    const battle = {
      id: battleId,
      title: title || `PYXIS ${mode} 전투`,
      mode,
      status: 'waiting',
      players: [],
      effects: [],
      createdAt: Date.now(),
      adminOtp: adminPassword,
      playerOtp: playerPassword,
      spectatorOtp: spectatorPassword,
      otpExpiry: {
        admin: Date.now() + (60 * 60 * 1000), // 60분
        player: Date.now() + (30 * 60 * 1000), // 30분
        spectator: Date.now() + (30 * 60 * 1000) // 30분
      },
      urls: {
        admin: `/admin?battle=${battleId}&otp=${adminPassword}`,
        player: `/player?battle=${battleId}&otp=${playerPassword}`,
        spectator: `/spectator?battle=${battleId}&otp=${spectatorPassword}`
      }
    };
    
    battles.set(battleId, battle);
    
    res.json({
      battleId,
      battle: {
        id: battle.id,
        title: battle.title,
        mode: battle.mode,
        status: battle.status,
        urls: battle.urls,
        passwords: {
          admin: adminPassword,
          player: playerPassword,
          spectator: spectatorPassword
        }
      }
    });
    
    console.log(`[API] Battle created: ${battleId} (${mode})`);
    
  } catch (error) {
    console.error('[API] Create battle error:', error);
    res.status(500).json({ error: '전투 생성 중 오류가 발생했습니다' });
  }
});

// 전투 목록 조회
app.get('/api/battles', (req, res) => {
  try {
    const battleList = Array.from(battles.values()).map(battle => ({
      id: battle.id,
      title: battle.title,
      mode: battle.mode,
      status: battle.status,
      playerCount: battle.players.length,
      createdAt: battle.createdAt,
      startedAt: battle.startedAt,
      endedAt: battle.endedAt
    }));
    
    res.json({ battles: battleList });
    
  } catch (error) {
    console.error('[API] Get battles error:', error);
    res.status(500).json({ error: '전투 목록 조회 중 오류가 발생했습니다' });
  }
});

// 특정 전투 조회
app.get('/api/battles/:battleId', (req, res) => {
  try {
    const { battleId } = req.params;
    const { otp, type } = req.query;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }
    
    // OTP 검증
    const now = Date.now();
    let isValidOtp = false;
    
    if (type === 'admin' && battle.adminOtp === otp && now < battle.otpExpiry.admin) {
      isValidOtp = true;
    } else if (type === 'player' && battle.playerOtp === otp && now < battle.otpExpiry.player) {
      isValidOtp = true;
    } else if (type === 'spectator' && battle.spectatorOtp === otp && now < battle.otpExpiry.spectator) {
      isValidOtp = true;
    }
    
    if (!isValidOtp) {
      return res.status(401).json({ error: '유효하지 않은 비밀번호이거나 만료되었습니다' });
    }
    
    // 타입별 데이터 필터링
    let responseData = { ...battle };
    
    if (type === 'player') {
      // 플레이어는 민감한 정보 제외
      delete responseData.adminOtp;
      delete responseData.playerOtp;
      delete responseData.spectatorOtp;
      delete responseData.otpExpiry;
    } else if (type === 'spectator') {
      // 관전자는 더 제한적
      delete responseData.adminOtp;
      delete responseData.playerOtp;
      delete responseData.spectatorOtp;
      delete responseData.otpExpiry;
      responseData.players = responseData.players.map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        hp: p.hp,
        maxHp: p.maxHp,
        stats: p.stats,
        connected: p.connected
      }));
    }
    
    res.json({ battle: responseData });
    
  } catch (error) {
    console.error('[API] Get battle error:', error);
    res.status(500).json({ error: '전투 조회 중 오류가 발생했습니다' });
  }
});

// 플레이어 추가
app.post('/api/battles/:battleId/players', (req, res) => {
  try {
    const { battleId } = req.params;
    const { player, otp } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }
    
    // 관리자 권한 확인
    if (battle.adminOtp !== otp || Date.now() > battle.otpExpiry.admin) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다' });
    }
    
    if (battle.status !== 'waiting') {
      return res.status(400).json({ error: '대기 중인 전투에만 플레이어를 추가할 수 있습니다' });
    }
    
    // 플레이어 검증
    if (!player.name || !player.team || !player.stats) {
      return res.status(400).json({ error: '플레이어 정보가 불완전합니다' });
    }
    
    if (!['A', 'B'].includes(player.team)) {
      return res.status(400).json({ error: '팀은 A 또는 B여야 합니다' });
    }
    
    // 스탯 검증
    const { attack, defense, agility, luck } = player.stats;
    if ([attack, defense, agility, luck].some(stat => 
      !Number.isInteger(stat) || stat < 1 || stat > 5
    )) {
      return res.status(400).json({ error: '모든 스탯은 1-5 범위의 정수여야 합니다' });
    }
    
    // 중복 ID 확인
    if (battle.players.find(p => p.id === player.id)) {
      return res.status(400).json({ error: '이미 존재하는 플레이어 ID입니다' });
    }
    
    // 팀 인원 제한 확인
    const maxPerTeam = parseInt(battle.mode.charAt(0));
    const teamCount = battle.players.filter(p => p.team === player.team).length;
    
    if (teamCount >= maxPerTeam) {
      return res.status(400).json({ error: `${player.team}팀이 가득 찼습니다 (최대 ${maxPerTeam}명)` });
    }
    
    const newPlayer = {
      id: player.id || crypto.randomUUID(),
      name: player.name,
      team: player.team,
      stats: player.stats,
      hp: 100,
      maxHp: 100,
      items: player.items || { dittany: 0, attack_boost: 0, defense_boost: 0 },
      avatar: player.avatar || null,
      connected: false,
      socketId: null,
      joinedAt: Date.now()
    };
    
    battle.players.push(newPlayer);
    
    // 실시간 업데이트 전송
    io.to(`battle-${battleId}`).emit('player_added', {
      player: newPlayer
    });
    
    res.json({
      message: '플레이어가 추가되었습니다',
      player: newPlayer
    });
    
    console.log(`[API] Player added: ${newPlayer.name} to battle ${battleId}`);
    
  } catch (error) {
    console.error('[API] Add player error:', error);
    res.status(500).json({ error: '플레이어 추가 중 오류가 발생했습니다' });
  }
});

// 플레이어 제거
app.delete('/api/battles/:battleId/players/:playerId', (req, res) => {
  try {
    const { battleId, playerId } = req.params;
    const { otp } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }
    
    // 관리자 권한 확인
    if (battle.adminOtp !== otp || Date.now() > battle.otpExpiry.admin) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다' });
    }
    
    const playerIndex = battle.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      return res.status(404).json({ error: '플레이어를 찾을 수 없습니다' });
    }
    
    const removedPlayer = battle.players[playerIndex];
    battle.players.splice(playerIndex, 1);
    
    // 해당 플레이어 소켓 연결 해제
    if (removedPlayer.socketId) {
      const playerSocket = io.sockets.sockets.get(removedPlayer.socketId);
      if (playerSocket) {
        playerSocket.emit('player_removed', { reason: '관리자에 의해 제거됨' });
        playerSocket.leave(`battle-${battleId}`);
      }
    }
    
    // 실시간 업데이트 전송
    io.to(`battle-${battleId}`).emit('player_removed', {
      playerId: playerId,
      playerName: removedPlayer.name
    });
    
    res.json({
      message: '플레이어가 제거되었습니다',
      playerId: playerId
    });
    
    console.log(`[API] Player removed: ${playerId} from battle ${battleId}`);
    
  } catch (error) {
    console.error('[API] Remove player error:', error);
    res.status(500).json({ error: '플레이어 제거 중 오류가 발생했습니다' });
  }
});

// 아바타 업로드
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다' });
    }
    
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    
    res.json({
      message: '아바타가 업로드되었습니다',
      avatarUrl: avatarUrl
    });
    
    console.log(`[API] Avatar uploaded: ${req.file.filename}`);
    
  } catch (error) {
    console.error('[API] Avatar upload error:', error);
    res.status(500).json({ error: '아바타 업로드 중 오류가 발생했습니다' });
  }
});

// 전투 삭제 (관리자만)
app.delete('/api/battles/:battleId', (req, res) => {
  try {
    const { battleId } = req.params;
    const { otp } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: '전투를 찾을 수 없습니다' });
    }
    
    // 관리자 권한 확인
    if (battle.adminOtp !== otp || Date.now() > battle.otpExpiry.admin) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다' });
    }
    
    // 모든 참가자에게 알림
    io.to(`battle-${battleId}`).emit('battle_deleted', {
      message: '전투가 삭제되었습니다'
    });
    
    battles.delete(battleId);
    
    res.json({ message: '전투가 삭제되었습니다' });
    
    console.log(`[API] Battle deleted: ${battleId}`);
    
  } catch (error) {
    console.error('[API] Delete battle error:', error);
    res.status(500).json({ error: '전투 삭제 중 오류가 발생했습니다' });
  }
});

/* ═══════════════════════════════════════════════════════════════
 * 정적 페이지 라우트
 * ═══════════════════════════════════════════════════════════════ */

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// 관리자 페이지
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

// 플레이어 페이지
app.get('/player', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'player.html'));
});

// 관전자 페이지
app.get('/spectator', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'spectator.html'));
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: '페이지를 찾을 수 없습니다' });
});

// 에러 핸들러
app.use((error, req, res, next) => {
  console.error('[ERROR]', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '파일 크기가 너무 큽니다 (최대 5MB)' });
    }
  }
  
  res.status(500).json({ 
    error: NODE_ENV === 'production' ? '서버 오류가 발생했습니다' : error.message 
  });
});

/* ═══════════════════════════════════════════════════════════════
 * Socket.IO 이벤트 등록 및 서버 시작
 * ═══════════════════════════════════════════════════════════════ */

// Socket.IO 이벤트 등록
registerSocketEvents(io);

// 정리 작업 (만료된 전투 제거)
setInterval(() => {
  const now = Date.now();
  const expiredBattles = [];
  
  for (const [battleId, battle] of battles) {
    // 24시간 이상된 대기중인 전투나 12시간 이상된 종료된 전투 제거
    const waitingExpiry = battle.status === 'waiting' && (now - battle.createdAt) > 24 * 60 * 60 * 1000;
    const endedExpiry = battle.status === 'ended' && (now - (battle.endedAt || battle.createdAt)) > 12 * 60 * 60 * 1000;
    
    if (waitingExpiry || endedExpiry) {
      expiredBattles.push(battleId);
    }
  }
  
  for (const battleId of expiredBattles) {
    battles.delete(battleId);
    console.log(`[CLEANUP] Removed expired battle: ${battleId}`);
  }
}, 60 * 60 * 1000); // 1시간마다 실행

// 서버 시작
server.listen(PORT, HOST, () => {
  console.log(`
  ═══════════════════════════════════════════════════════
  ✨ PYXIS Battle System v3.0.2
  🌟 Environment: ${NODE_ENV}
  🚀 Server: http://${HOST}:${PORT}
  ⚡ Socket.IO: ${HOST}:${PORT}/socket.io
  📊 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB
  ⏰ Started: ${new Date().toLocaleString('ko-KR')}
  ═══════════════════════════════════════════════════════
  `);
  
  if (NODE_ENV === 'development') {
    console.log(`
  📋 API Endpoints:
     GET  /api/health           - 헬스 체크
     POST /api/battles          - 전투 생성
     GET  /api/battles          - 전투 목록
     GET  /api/battles/:id      - 전투 조회
     POST /api/battles/:id/players - 플레이어 추가
     DELETE /api/battles/:id/players/:pid - 플레이어 제거
     POST /api/upload/avatar    - 아바타 업로드
     DELETE /api/battles/:id    - 전투 삭제
    
  📄 Pages:
     GET  /                     - 메인 페이지
     GET  /admin                - 관리자 페이지
     GET  /player               - 플레이어 페이지
     GET  /spectator            - 관전자 페이지
    `);
  }
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('\n[SERVER] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[SERVER] Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n[SERVER] SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('[SERVER] Process terminated');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught Exception:', error);
  process.exit(1);
});

export default app;
