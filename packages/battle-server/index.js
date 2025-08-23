// packages/battle-server/index.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/socket.io",
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(cors());
app.use(express.json());

// 업로드 설정
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const fileFilter = (_, file, cb) => {
  const ok = ['image/png','image/jpeg','image/webp','image/gif'].includes(file.mimetype);
  if (ok) cb(null, true);
  else cb(new Error('이미지 형식만 허용됩니다'));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_UPLOAD_BYTES } });

// 정적 파일 서빙
const publicPath = path.join(__dirname, '../battle-web/public');
console.log(`[전투서버] 정적 파일 경로: ${publicPath}`);

const checkFiles = ['admin.html', 'play.html', 'watch.html'];
checkFiles.forEach(file => {
  const filePath = path.join(publicPath, file);
  if (fs.existsSync(filePath)) {
    console.log(`[전투서버] 파일 확인: ${file}`);
  } else {
    console.log(`[전투서버] 파일 누락: ${file} - ${filePath}`);
  }
});

app.use(express.static(publicPath, {
  cacheControl: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// 루트 경로 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/admin.html');
});

// HTML 파일 직접 라우팅
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicPath, 'admin.html'));
});
app.get('/play', (req, res) => {
  res.sendFile(path.join(publicPath, 'play.html'));
});
app.get('/watch', (req, res) => {
  res.sendFile(path.join(publicPath, 'watch.html'));
});

app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: true }));

// 저장소 및 상수
const battles = new Map();
const playerSockets = new Map();
const spectatorConnections = new Map();
const adminConnections = new Map();
const connectionHeartbeats = new Map();

const BATTLE_DURATION = 60 * 60 * 1000; // 1시간
const TURN_TIMEOUT = 5 * 60 * 1000;  // 5분
const BASE_HP = 100;
const STAT_MIN = 1;
const STAT_MAX = 5;
const HEARTBEAT_INTERVAL = 30000; // 30초마다 연결 확인

const BATTLE_MODES = {
  '1v1': { teamsCount: 2, playersPerTeam: 1 },
  '2v2': { teamsCount: 2, playersPerTeam: 2 },
  '3v3': { teamsCount: 2, playersPerTeam: 3 },
  '4v4': { teamsCount: 2, playersPerTeam: 4 }
};

// 아이템 정보
const ITEM_INFO = {
  '공격 보정기': {
    name: '공격 보정기',
    description: '이번 1턴 동안 공격력 1.5배',
    type: 'attack_buff',
    duration: 1,
    effect: { attack: 1.5 },
    successRate: 0.1 // 10% 성공률
  },
  '방어 보정기': {
    name: '방어 보정기', 
    description: '이번 1턴 동안 방어력 1.5배',
    type: 'defense_buff',
    duration: 1,
    effect: { defense: 1.5 },
    successRate: 0.1 // 10% 성공률
  },
  '디터니': {
    name: '디터니',
    description: 'HP 10 즉시 회복',
    type: 'heal',
    effect: { heal: 10 },
    successRate: 1.0 // 100% 확정 회복
  }
};

const MSG = {
  battle_already_started: '이미 전투가 시작되었습니다.',
  invalid_team: '잘못된 팀입니다.',
  team_full: '해당 팀이 가득 찼습니다.',
  not_enough_players: '플레이어 수가 부족합니다.',
  not_your_teams_turn: '현재 당신의 팀 차례가 아닙니다.',
  player_dead: '해당 플레이어는 이미 사망했습니다.',
  player_already_acted: '이 턴에 이미 행동했습니다.',
  invalid_action: '잘못된 행동 타입입니다.',
  target_not_found: '대상을 찾을 수 없습니다.',
  target_dead: '대상이 이미 사망했습니다.',
  cannot_attack_teammate: '아군은 공격할 수 없습니다.',
  defensive_stance: (name) => `${name}는 방어 태세를 취합니다.`,
  miss: (a, b) => `${a}가 ${b}를 공격했지만 빗나갔습니다!`,
  attack: (a, b, damage, crit, elim) => `${a}가 ${b}에게 ${damage} 피해를 입혔습니다${crit ? ' (치명타!)' : ''}${elim ? ' (처치!)' : ''}`,
  item_used: (name, item) => `${name}가 ${item}을(를) 사용했습니다.`,
  item_not_found: '보유하지 않은 아이템입니다.',
  dodge_ready: (name) => `${name}는 회피 태세를 취했습니다.`,
  dodge_success: (a, b) => `${b}가 ${a}의 공격을 회피했습니다!`,
  dodge_fail: (a, b) => `${b}의 회피가 실패했습니다.`,
  heal: (name, amount) => `${name}가 ${amount} HP를 회복했습니다.`,
  buff_attack: (name) => `${name}의 공격력이 강화되었습니다.`,
  buff_defense: (name) => `${name}의 방어력이 강화되었습니다.`,
  item_success: (name, item) => `${name}의 ${item} 사용이 성공했습니다!`,
  item_fail: (name, item) => `${name}의 ${item} 사용이 실패했습니다!`,
  team_wins: (team) => `${team} 팀 승리!`,
  turn_started: (team) => `${team} 팀 턴이 시작되었습니다.`,
  turn_ended: (team) => `${team} 팀 턴이 종료되었습니다.`,
  battle_timeout: '전투 시간 초과로 무승부입니다.',
  turn_timeout: (name) => `${name}의 턴 시간이 초과되어 자동으로 방어합니다.`,
  initiative_roll: (team, roll) => `${team} 팀 민첩성 굴림: ${roll}`,
  team_goes_first: (team) => `${team} 팀이 선공합니다!`,
  pass_action: (name) => `${name}가 턴을 패스합니다.`
};

// 스탯 정규화
function normalizeStats(stats = {}) {
  const out = { ...stats };
  out.attack = Math.min(Math.max(out.attack ?? 2, STAT_MIN), STAT_MAX);
  out.defense = Math.min(Math.max(out.defense ?? 2, STAT_MIN), STAT_MAX);
  out.agility = Math.min(Math.max(out.agility ?? 2, STAT_MIN), STAT_MAX);
  out.luck = Math.min(Math.max(out.luck ?? 2, STAT_MIN), STAT_MAX);
  return out;
}

// 주사위 굴리기 (1-20)
function rollDice() {
  return Math.floor(Math.random() * 20) + 1;
}

// OTP 생성
function generateOTP() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

// 전투 생성
function createBattle(mode = '1v1', adminId = null) {
  const id = crypto.randomBytes(16).toString('hex');
  const config = BATTLE_MODES[mode] || BATTLE_MODES['1v1'];
  
  const battle = {
    id,
    mode,
    status: 'waiting', // waiting, ongoing, ended
    createdAt: Date.now(),
    lastActivity: Date.now(),
    adminId,
    
    // 팀 구조
    teams: {
      team1: { name: '불사조 기사단', players: [] },
      team2: { name: '죽음을 먹는자들', players: [] }
    },
    
    // 전투 상태
    currentTeam: null,
    currentPlayerIndex: 0,
    turnStartTime: null,
    turnTimeouts: new Map(),
    
    // 로그
    battleLog: [],
    chatLog: [],
    
    // 설정
    config,
    teamsCount: config.teamsCount,
    playersPerTeam: config.playersPerTeam,
    
    // OTP 시스템
    otps: {
      admin: generateOTP(),
      player: generateOTP(), 
      spectator: generateOTP()
    }
  };
  
  battles.set(id, battle);
  console.log(`[전투생성] ID: ${id}, 모드: ${mode}`);
  
  // 1시간 후 자동 종료
  setTimeout(() => {
    if (battles.has(id)) {
      const b = battles.get(id);
      if (b.status === 'ongoing') {
        endBattle(id, null, '시간 초과');
      }
      deleteBattle(id);
    }
  }, BATTLE_DURATION);
  
  return battle;
}

// 플레이어 추가
function addPlayer(battleId, playerData) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('존재하지 않는 전투입니다.');
  if (battle.status !== 'waiting') throw new Error(MSG.battle_already_started);
  
  const { name, team, stats, inventory = [], imageUrl = '' } = playerData;
  
  if (!['team1', 'team2'].includes(team)) {
    throw new Error(MSG.invalid_team);
  }
  
  const targetTeam = battle.teams[team];
  if (targetTeam.players.length >= battle.config.playersPerTeam) {
    throw new Error(MSG.team_full);
  }
  
  // 중복 이름 체크
  const allPlayers = [
    ...battle.teams.team1.players,
    ...battle.teams.team2.players
  ];
  if (allPlayers.some(p => p.name === name)) {
    throw new Error('이미 존재하는 플레이어 이름입니다.');
  }
  
  const player = {
    id: crypto.randomBytes(8).toString('hex'),
    name: name || `플레이어${Date.now()}`,
    team,
    stats: normalizeStats(stats),
    inventory: Array.isArray(inventory) ? inventory : [],
    buffs: {}, // 버프 효과 저장
    imageUrl: imageUrl || '',
    
    // 전투 상태
    hp: BASE_HP,
    maxHp: BASE_HP,
    alive: true,
    hasActed: false,
    actionType: null,
    
    // 연결 정보
    socketId: null,
    connected: false,
    lastSeen: Date.now()
  };
  
  targetTeam.players.push(player);
  battle.lastActivity = Date.now();
  
  addBattleLog(battleId, 'system', `${player.name}이(가) ${targetTeam.name}에 참가했습니다.`);
  console.log(`[플레이어추가] 전투: ${battleId}, 플레이어: ${name}, 팀: ${team}`);
  
  return player;
}

// 전투 로그 추가
function addBattleLog(battleId, type, message) {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  const logEntry = {
    type,
    message,
    timestamp: Date.now()
  };
  
  battle.battleLog.push(logEntry);
  
  // 로그 개수 제한 (최근 100개만 보관)
  if (battle.battleLog.length > 100) {
    battle.battleLog = battle.battleLog.slice(-100);
  }
  
  // 실시간 브로드캐스트
  broadcastBattleState(battleId);
}

// 채팅 로그 추가  
function addChatLog(battleId, sender, message, senderType = 'player') {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  const chatEntry = {
    sender,
    message,
    senderType, // player, spectator, admin, system
    timestamp: Date.now()
  };
  
  battle.chatLog.push(chatEntry);
  
  // 채팅 개수 제한 (최근 50개만 보관)
  if (battle.chatLog.length > 50) {
    battle.chatLog = battle.chatLog.slice(-50);
  }
  
  // 실시간 브로드캐스트
  broadcastBattleState(battleId);
}

// 전투 종료
function endBattle(battleId, winner = null, reason = '') {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  battle.status = 'ended';
  battle.winner = winner;
  battle.endReason = reason;
  battle.endTime = Date.now();
  
  // 모든 타이머 해제
  battle.turnTimeouts.forEach(timeout => clearTimeout(timeout));
  battle.turnTimeouts.clear();
  
  if (winner) {
    const winnerTeam = battle.teams[winner];
    addBattleLog(battleId, 'system', MSG.team_wins(winnerTeam.name));
  } else {
    addBattleLog(battleId, 'system', reason || MSG.battle_timeout);
  }
  
  console.log(`[전투종료] ID: ${battleId}, 승자: ${winner || '무승부'}`);
  broadcastBattleState(battleId);
}

// 전투 삭제
function deleteBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  // 모든 연결 해제
  battle.teams.team1.players.concat(battle.teams.team2.players).forEach(player => {
    if (player.socketId) {
      playerSockets.delete(player.socketId);
    }
  });
  
  battles.delete(battleId);
  console.log(`[전투삭제] ID: ${battleId}`);
}

// 플레이어 찾기
function findPlayerInBattle(battle, playerId) {
  const allPlayers = [
    ...battle.teams.team1.players,
    ...battle.teams.team2.players
  ];
  return allPlayers.find(p => p.id === playerId);
}

// 전투 상태 브로드캐스트
function broadcastBattleState(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  const state = {
    id: battle.id,
    mode: battle.mode,
    status: battle.status,
    teams: battle.teams,
    currentTeam: battle.currentTeam,
    currentPlayerIndex: battle.currentPlayerIndex,
    turnStartTime: battle.turnStartTime,
    battleLog: battle.battleLog,
    chatLog: battle.chatLog,
    winner: battle.winner,
    endReason: battle.endReason
  };
  
  // 관리자들에게 전송
  adminConnections.forEach((conn, socketId) => {
    if (conn.battleId === battleId) {
      io.to(socketId).emit('battleUpdate', state);
    }
  });
  
  // 플레이어들에게 전송
  playerSockets.forEach((player, socketId) => {
    if (player.battleId === battleId) {
      io.to(socketId).emit('battleUpdate', state);
    }
  });
  
  // 관전자들에게 전송
  spectatorConnections.forEach((conn, socketId) => {
    if (conn.battleId === battleId) {
      io.to(socketId).emit('battleUpdate', state);
    }
  });
}

// 이미지 업로드 엔드포인트
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }
    
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
    console.log(`[이미지업로드] 파일: ${req.file.filename}`);
  } catch (error) {
    console.error(`[이미지업로드오류] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// REST API 엔드포인트들

// 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode = '1v1', adminId } = req.body;
    const battle = createBattle(mode, adminId);
    res.json({
      success: true,
      battleId: battle.id,
      battle: {
        id: battle.id,
        mode: battle.mode,
        status: battle.status,
        otps: battle.otps,
        createdAt: battle.createdAt
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 목록 조회
app.get('/api/battles', (req, res) => {
  const battleList = Array.from(battles.values()).map(battle => ({
    id: battle.id,
    mode: battle.mode,
    status: battle.status,
    createdAt: battle.createdAt,
    playerCount: battle.teams.team1.players.length + battle.teams.team2.players.length,
    maxPlayers: battle.config.playersPerTeam * 2
  }));
  
  res.json({ battles: battleList });
});

// 전투 상태 조회
app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) {
    return res.status(404).json({ error: '전투를 찾을 수 없습니다.' });
  }
  
  res.json(battle);
});

// 관리자 API 엔드포인트들

// 링크 생성
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    // 새로운 OTP 생성
    battle.otps = {
      admin: generateOTP(),
      player: generateOTP(),
      spectator: generateOTP()
    };
    
    res.json({
      success: true,
      tokens: battle.otps,
      urls: {
        admin: `/admin?token=${battle.otps.admin}&battle=${battleId}`,
        player: `/play?token=${battle.otps.player}&battle=${battleId}`,
        spectator: `/watch?token=${battle.otps.spectator}&battle=${battleId}`
      }
    });
    
    console.log(`[링크생성] 전투: ${battleId}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// OTP 발급
app.post('/api/admin/battles/:id/issue-otp', (req, res) => {
  try {
    const battleId = req.params.id;
    const { role, playerName } = req.body;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    const otp = generateOTP();
    battle.otps[role] = otp;
    
    res.json({
      success: true,
      otp: otp,
      role: role
    });
    
    console.log(`[OTP발급] 전투: ${battleId}, 역할: ${role}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 관리자 인증
app.post('/api/admin/battles/:id/auth', (req, res) => {
  try {
    const battleId = req.params.id;
    const { otp, role } = req.body;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    if (battle.otps[role] !== otp) {
      return res.status(401).json({ error: '잘못된 OTP입니다.' });
    }
    
    const token = crypto.randomBytes(16).toString('hex');
    
    res.json({
      success: true,
      token: token,
      role: role
    });
    
    console.log(`[${role}인증] 전투: ${battleId}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 플레이어 추가 (FormData 지원)
app.post('/api/admin/battles/:id/add-player', upload.single('image'), (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    const { name, team, attack, defense, agility, luck } = req.body;
    
    // 스탯 파싱
    const stats = {
      attack: parseInt(attack) || 2,
      defense: parseInt(defense) || 2,
      agility: parseInt(agility) || 2,
      luck: parseInt(luck) || 2
    };
    
    // 아이템 인벤토리 구성
    const inventory = [];
    const attackItems = parseInt(req.body['공격 보정기']) || 0;
    const defenseItems = parseInt(req.body['방어 보정기']) || 0;
    const healItems = parseInt(req.body['디터니']) || 0;
    
    for (let i = 0; i < attackItems; i++) inventory.push('공격 보정기');
    for (let i = 0; i < defenseItems; i++) inventory.push('방어 보정기');
    for (let i = 0; i < healItems; i++) inventory.push('디터니');
    
    // 이미지 URL
    let imageUrl = '';
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }
    
    const player = addPlayer(battleId, {
      name: name || `플레이어${Date.now()}`,
      team,
      stats,
      inventory,
      imageUrl
    });
    
    res.json({
      success: true,
      message: `${player.name}이(가) ${battle.teams[team].name}에 추가되었습니다.`,
      player
    });
    
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 시작
app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    battle.status = 'ongoing';
    addBattleLog(battleId, 'system', '전투가 시작되었습니다!');
    
    res.json({ success: true, message: '전투가 시작되었습니다!' });
    console.log(`[전투시작] ID: ${battleId}`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 전투 종료
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const battleId = req.params.id;
    const { winner } = req.body;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    let message = '전투가 종료되었습니다.';
    if (winner) {
      const teamName = battle.teams[winner].name;
      message = `${teamName} 승리로 전투가 종료되었습니다!`;
      endBattle(battleId, winner, `관리자에 의한 강제 종료 - ${teamName} 승리`);
    } else {
      endBattle(battleId, null, '관리자에 의한 강제 종료');
    }
    
    res.json({ success: true, message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 다음 턴
app.post('/api/admin/battles/:id/next-turn', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    addBattleLog(battleId, 'system', '관리자가 다음 턴으로 진행했습니다.');
    
    res.json({ success: true, message: '다음 턴으로 진행되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 관리자 채팅
app.post('/api/admin/battles/:id/chat', (req, res) => {
  try {
    const battleId = req.params.id;
    const { message, sender, senderType } = req.body;
    
    addChatLog(battleId, sender || '관리자', message, senderType || 'admin');
    
    res.json({ success: true, message: '채팅 전송 완료' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log(`[소켓연결] ID: ${socket.id}`);
  
  // 연결 유지
  connectionHeartbeats.set(socket.id, Date.now());
  
  // 관리자 인증
  socket.on('adminAuth', ({ battleId, otp }) => {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('authError', '존재하지
