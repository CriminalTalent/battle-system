// ESM Entry for PYXIS Battle Server
// - Loads .env
// - Serves static files
// - Adds /admin /player /spectator routes
// - Exposes /healthz
// - Wires minimal Socket.IO channels expected by the UI (auth/join/chat/cheer/log/update)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import { Server as IOServer } from 'socket.io';
import multer from 'multer';

// --------------------------------------------------
// Env & Paths
// --------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from packages/battle-server/.env (preferred) or fallback to repo root
const envLocal = path.join(__dirname, '.env');
const envRoot = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
else if (fs.existsSync(envRoot)) dotenv.config({ path: envRoot });
else dotenv.config();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
if (!Number.isFinite(PORT) || PORT <= 0 || PORT >= 65536) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://pyxisbattlesystem.monster';

console.log(`[PYXIS] 서버 시작 중...`);
console.log(`- 환경: ${process.env.NODE_ENV || 'development'}`);
console.log(`- 포트: ${PORT}`);
console.log(`- 호스트: ${HOST}`);
console.log(`- 기본 URL: ${PUBLIC_BASE_URL}`);

// --------------------------------------------------
// 디렉토리 생성
// --------------------------------------------------
const directories = ['uploads', 'logs', 'public/uploads/avatars'];
directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[PYXIS] 디렉토리 생성: ${dir}`);
  }
});

// --------------------------------------------------
// 게임 상수 및 유틸리티
// --------------------------------------------------
const GAME_DURATION = 60 * 60 * 1000; // 1시간
const TURN_TIMEOUT = 5 * 60 * 1000;   // 5분
const MAX_TURNS = 100;

// 주사위 함수
function roll(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
}

// 확률 체크
function chance(probability) {
  return Math.random() < probability;
}

// 스탯 제한 (1-10)
function clampStat(value, max = 10) {
  return Math.max(1, Math.min(max, parseInt(value) || 1));
}

// 치명타 계산
function calculateCritical(luck, diceRoll) {
  return diceRoll >= (20 - Math.floor(luck / 2));
}

// 명중 계산
function calculateHit(luck, diceRoll) {
  return (luck + diceRoll) >= 12;
}

// --------------------------------------------------
// 전투 상태 관리 (In-Memory)
// --------------------------------------------------
const battles = new Map();

const now = () => Date.now();

function ensureBattle(battleId) {
  if (!battles.has(battleId)) {
    battles.set(battleId, {
      id: battleId,
      mode: '1v1',
      status: 'waiting', // waiting | active | paused | ended
      players: [],
      log: [],
      spectators: new Set(),
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      turn: 0,
      currentPlayer: null,
      currentTeam: null,
      turnStartTime: null,
      effects: [], // 상태 효과 (버프/디버프)
      winner: null,
      gameTimer: null,
      turnTimer: null
    });
  }
  return battles.get(battleId);
}

function pushLog(battle, type, message) {
  const item = { 
    ts: new Date().toISOString(), 
    timestamp: now(),
    type, 
    message 
  };
  battle.log.push(item);
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
  return item;
}

// 전투 직렬화 (클라이언트 전송용)
function serializeBattle(battle) {
  return {
    id: battle.id,
    mode: battle.mode,
    status: battle.status,
    players: battle.players.map(p => ({
      ...p,
      // 민감한 정보 제거 또는 변환
    })),
    log: battle.log.slice(-100), // 최근 100개만
    turn: battle.turn,
    currentPlayer: battle.currentPlayer,
    currentTeam: battle.currentTeam,
    turnStartTime: battle.turnStartTime,
    createdAt: battle.createdAt,
    startedAt: battle.startedAt,
    endedAt: battle.endedAt,
    spectatorCount: battle.spectators.size,
    winner: battle.winner
  };
}

// --------------------------------------------------
// 전투 생성
// --------------------------------------------------
function createNewBattle(mode = '1v1') {
  const battleId = `battle_${Math.random().toString(36).slice(2, 10)}`;
  const battle = ensureBattle(battleId);
  battle.mode = mode;
  battle.status = 'waiting';
  pushLog(battle, 'system', `전투 생성됨 - 모드: ${mode}`);
  
  const adminUrl = `${PUBLIC_BASE_URL}/admin?battle=${battleId}&token=admin-${battleId}`;
  const playerBase = `${PUBLIC_BASE_URL}/player?battle=${battleId}`;
  const spectatorBase = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}`;
  
  return {
    battleId,
    battle,
    adminUrl,
    playerBase,
    spectatorBase
  };
}

// --------------------------------------------------
// 전투 참가자 관리
// --------------------------------------------------
function addPlayerToBattle(battleId, playerData) {
  const battle = ensureBattle(battleId);
  
  // 중복 확인
  const existing = battle.players.find(p => p.name === playerData.name);
  if (existing) {
    throw new Error(`이미 등록된 이름입니다: ${playerData.name}`);
  }
  
  // 팀별 인원수 체크
  const teamPlayers = battle.players.filter(p => p.team === playerData.team);
  const maxPlayersPerTeam = parseInt(battle.mode.charAt(0));
  
  if (teamPlayers.length >= maxPlayersPerTeam) {
    throw new Error(`${playerData.team} 팀이 이미 가득 찼습니다 (${maxPlayersPerTeam}명)`);
  }
  
  // 스탯 총합 검증 (총 12포인트)
  const totalStats = (playerData.stats?.attack || 3) + 
                    (playerData.stats?.defense || 3) + 
                    (playerData.stats?.agility || 3) + 
                    (playerData.stats?.luck || 3);
  
  if (totalStats !== 12) {
    throw new Error(`스탯 총합은 12포인트여야 합니다 (현재: ${totalStats})`);
  }
  
  const player = {
    id: `player_${Math.random().toString(36).slice(2, 10)}`,
    name: playerData.name.trim(),
    team: playerData.team || 'phoenix',
    hp: parseInt(playerData.hp || 100),
    maxHp: parseInt(playerData.hp || 100),
    stats: {
      attack: clampStat(playerData.stats?.attack || 3, 10),
      defense: clampStat(playerData.stats?.defense || 3, 10),
      agility: clampStat(playerData.stats?.agility || 3, 10),
      luck: clampStat(playerData.stats?.luck || 3, 10)
    },
    items: {
      dittany: parseInt(playerData.items?.dittany || 1),
      attack_booster: parseInt(playerData.items?.attack_booster || 1),
      defense_booster: parseInt(playerData.items?.defense_booster || 1)
    },
    avatar: playerData.avatar || null,
    isReady: false,
    isAlive: true,
    effects: [], // 개별 효과
    lastAction: null,
    actionHistory: []
  };
  
  battle.players.push(player);
  pushLog(battle, 'system', `전투 참가자 추가: ${player.name} (${player.team}팀)`);
  
  return player;
}

// --------------------------------------------------
// 전투 로직
// --------------------------------------------------
function startBattle(battleId) {
  const battle = ensureBattle(battleId);
  
  if (battle.players.length < 2) {
    throw new Error('최소 2명의 전투 참가자가 필요합니다');
  }
  
  // 팀별 인원 확인
  const teams = {};
  battle.players.forEach(p => {
    teams[p.team] = (teams[p.team] || 0) + 1;
  });
  
  const teamNames = Object.keys(teams);
  if (teamNames.length !== 2) {
    throw new Error('정확히 2팀이 필요합니다');
  }
  
  // 선공 결정 (팀별 민첩성 합계)
  const teamAgility = {};
  teamNames.forEach(team => {
    teamAgility[team] = battle.players
      .filter(p => p.team === team)
      .reduce((sum, p) => sum + p.stats.agility + roll(20), 0);
  });
  
  const firstTeam = teamAgility[teamNames[0]] >= teamAgility[teamNames[1]] ? teamNames[0] : teamNames[1];
  
  battle.status = 'active';
  battle.startedAt = new Date().toISOString();
  battle.currentTeam = firstTeam;
  battle.turn = 1;
  battle.turnStartTime = now();
  
  // 게임 타이머 설정 (1시간)
  battle.gameTimer = setTimeout(() => {
    endBattleByTime(battleId);
  }, GAME_DURATION);
  
  // 첫 턴 타이머 설정
  setTurnTimer(battle);
  
  pushLog(battle, 'system', `전투 시작! ${firstTeam} 팀 선공 (민첩성: ${Object.entries(teamAgility).map(([team, agility]) => `${team}=${agility}`).join(', ')})`);
  
  return battle;
}

function setTurnTimer(battle) {
  if (battle.turnTimer) {
    clearTimeout(battle.turnTimer);
  }
  
  battle.turnTimer = setTimeout(() => {
    handleTurnTimeout(battle);
  }, TURN_TIMEOUT);
}

function handleTurnTimeout(battle) {
  if (battle.status !== 'active') return;
  
  pushLog(battle, 'system', `턴 시간 초과 - 자동으로 패스됨`);
  nextTurn(battle);
}

function nextTurn(battle) {
  if (battle.status !== 'active') return;
  
  // 승부 확인
  const result = checkBattleEnd(battle);
  if (result.ended) {
    endBattle(battle.id, result.reason, result.winner);
    return;
  }
  
  // 다음 팀으로 턴 이동
  const teams = [...new Set(battle.players.map(p => p.team))];
  const currentIndex = teams.indexOf(battle.currentTeam);
  battle.currentTeam = teams[(currentIndex + 1) % teams.length];
  
  // 새 팀의 턴이 시작되면 turn 증가
  if (battle.currentTeam === teams[0]) {
    battle.turn++;
  }
  
  battle.turnStartTime = now();
  setTurnTimer(battle);
  
  // 최대 턴 수 체크
  if (battle.turn > MAX_TURNS) {
    endBattleByTime(battle.id);
    return;
  }
  
  pushLog(battle, 'system', `턴 ${battle.turn}: ${battle.currentTeam} 팀 차례`);
}

function checkBattleEnd(battle) {
  const teams = {};
  let aliveCount = 0;
  
  battle.players.forEach(p => {
    if (p.hp > 0) {
      teams[p.team] = (teams[p.team] || 0) + 1;
      aliveCount++;
    }
  });
  
  const aliveTeams = Object.keys(teams).filter(team => teams[team] > 0);
  
  if (aliveTeams.length === 1) {
    return { ended: true, winner: aliveTeams[0], reason: '전멸' };
  }
  
  if (aliveCount === 0) {
    return { ended: true, winner: null, reason: '무승부' };
  }
  
  return { ended: false };
}

function endBattle(battleId, reason = '시간 종료', winner = null) {
  const battle = ensureBattle(battleId);
  
  if (battle.gameTimer) clearTimeout(battle.gameTimer);
  if (battle.turnTimer) clearTimeout(battle.turnTimer);
  
  battle.status = 'ended';
  battle.endedAt = new Date().toISOString();
  battle.winner = winner;
  
  pushLog(battle, 'system', `전투 종료 - ${reason} ${winner ? `승자: ${winner}팀` : ''}`);
  
  return battle;
}

function endBattleByTime(battleId) {
  const battle = ensureBattle(battleId);
  
  // 팀별 총 HP 계산
  const teamHP = {};
  battle.players.forEach(p => {
    teamHP[p.team] = (teamHP[p.team] || 0) + Math.max(0, p.hp);
  });
  
  const teams = Object.keys(teamHP);
  const winner = teamHP[teams[0]] > teamHP[teams[1]] ? teams[0] : 
                teamHP[teams[0]] < teamHP[teams[1]] ? teams[1] : null;
  
  endBattle(battleId, '시간 종료', winner);
}

// --------------------------------------------------
// 전투 액션 처리
// --------------------------------------------------
function handlePlayerAction(battleId, playerId, action) {
  const battle = ensureBattle(battleId);
  const player = battle.players.find(p => p.id === playerId);
  
  if (!player || battle.status !== 'active') {
    return { success: false, error: '잘못된 전투 상태' };
  }
  
  if (player.team !== battle.currentTeam) {
    return { success: false, error: '아직 당신의 턴이 아닙니다' };
  }
  
  if (player.hp <= 0) {
    return { success: false, error: '사망한 전투 참가자는 행동할 수 없습니다' };
  }
  
  const result = processAction(battle, player, action);
  
  if (result.success) {
    player.lastAction = action.type;
    player.actionHistory.push({
      turn: battle.turn,
      action: action.type,
      target: action.targetId,
      timestamp: now()
    });
    
    nextTurn(battle);
  }
  
  return result;
}

function processAction(battle, actor, action) {
  const logs = [];
  const updates = { hp: {}, effects: [] };
  
  try {
    switch (action.type) {
      case 'attack':
        return handleAttack(battle, actor, action, logs, updates);
      case 'defend':
        return handleDefend(battle, actor, action, logs, updates);
      case 'dodge':
        return handleDodge(battle, actor, action, logs, updates);
      case 'item':
        return handleItem(battle, actor, action, logs, updates);
      case 'pass':
        return handlePass(battle, actor, action, logs, updates);
      default:
        return { success: false, error: '알 수 없는 액션' };
    }
  } catch (error) {
    console.error('[COMBAT] 액션 처리 오류:', error);
    return { success: false, error: '액션 처리 중 오류 발생' };
  }
}

function handleAttack(battle, actor, action) {
  const target = battle.players.find(p => p.id === action.targetId && p.hp > 0);
  if (!target) {
    return { success: false, error: '유효한 대상이 없습니다' };
  }
  
  if (target.team === actor.team) {
    return { success: false, error: '같은 팀을 공격할 수 없습니다' };
  }
  
  // 공격 계산
  const attackRoll = roll(20);
  const hitRoll = roll(20);
  const luckCheck = calculateHit(actor.stats.luck, hitRoll);
  
  if (!luckCheck) {
    pushLog(battle, 'battle', `${actor.name}의 공격이 빗나감! (행운: ${actor.stats.luck}, 주사위: ${hitRoll})`);
    return { success: true };
  }
  
  // 회피 체크
  const evadeRoll = roll(20);
  const evadeCheck = (target.stats.agility + evadeRoll) >= (actor.stats.attack + attackRoll);
  
  if (evadeCheck) {
    pushLog(battle, 'battle', `${target.name}이 ${actor.name}의 공격을 회피! (민첩: ${target.stats.agility}, 주사위: ${evadeRoll})`);
    return { success: true };
  }
  
  // 피해 계산
  let damage = Math.max(0, (actor.stats.attack + attackRoll) - target.stats.defense);
  
  // 치명타 체크
  const critRoll = roll(20);
  const isCritical = calculateCritical(actor.stats.luck, critRoll);
  
  if (isCritical) {
    damage *= 2;
    pushLog(battle, 'battle', `${actor.name}의 치명타! ${target.name}에게 ${damage} 피해 (공격: ${actor.stats.attack}+${attackRoll}, 치명: ${critRoll})`);
  } else {
    pushLog(battle, 'battle', `${actor.name}이 ${target.name}에게 ${damage} 피해 (공격: ${actor.stats.attack}+${attackRoll})`);
  }
  
  // HP 적용
  target.hp = Math.max(0, target.hp - damage);
  
  if (target.hp === 0) {
    target.isAlive = false;
    pushLog(battle, 'battle', `${target.name} 사망!`);
  }
  
  return { success: true };
}

function handleDefend(battle, actor, action) {
  // 방어 태세 - 다음 피격시 방어력 1.5배, 성공시 반격
  actor.effects = actor.effects || [];
  actor.effects.push({
    type: 'defend',
    factor: 1.5,
    turns: 1
  });
  
  pushLog(battle, 'battle', `${actor.name}이 방어 태세를 취함`);
  return { success: true };
}

function handleDodge(battle, actor, action) {
  // 회피 준비 - 다음 공격에 대한 회피율 +5 보너스
  actor.effects = actor.effects || [];
  actor.effects.push({
    type: 'dodge',
    bonus: 5,
    turns: 1
  });
  
  pushLog(battle, 'battle', `${actor.name}이 회피 자세를 취함`);
  return { success: true };
}

function handleItem(battle, actor, action) {
  const itemKey = action.itemType;
  
  if (!actor.items[itemKey] || actor.items[itemKey] <= 0) {
    return { success: false, error: '해당 아이템을 보유하고 있지 않습니다' };
  }
  
  actor.items[itemKey]--;
  
  switch (itemKey) {
    case 'dittany':
      return handleDittany(battle, actor, action);
    case 'attack_booster':
      return handleAttackBooster(battle, actor, action);
    case 'defense_booster':
      return handleDefenseBooster(battle, actor, action);
    default:
      return { success: false, error: '알 수 없는 아이템' };
  }
}

function handleDittany(battle, actor, action) {
  const target = battle.players.find(p => p.id === action.targetId);
  if (!target) {
    return { success: false, error: '대상을 찾을 수 없습니다' };
  }
  
  const healAmount = 10;
  const oldHp = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + healAmount);
  const actualHeal = target.hp - oldHp;
  
  pushLog(battle, 'battle', `${actor.name}이 ${target.name}에게 디터니 사용 - ${actualHeal} 회복`);
  return { success: true };
}

function handleAttackBooster(battle, actor, action) {
  const success = chance(0.1); // 10% 성공률
  
  if (success) {
    actor.effects = actor.effects || [];
    actor.effects.push({
      type: 'attack_boost',
      factor: 1.5,
      turns: 1
    });
    pushLog(battle, 'battle', `${actor.name}의 공격 보정기 성공! 다음 공격 1.5배`);
  } else {
    pushLog(battle, 'battle', `${actor.name}의 공격 보정기 실패`);
  }
  
  return { success: true };
}

function handleDefenseBooster(battle, actor, action) {
  const success = chance(0.1); // 10% 성공률
  
  if (success) {
    actor.effects = actor.effects || [];
    actor.effects.push({
      type: 'defense_boost',
      factor: 1.5,
      turns: 1
    });
    pushLog(battle, 'battle', `${actor.name}의 방어 보정기 성공! 다음 방어 1.5배`);
  } else {
    pushLog(battle, 'battle', `${actor.name}의 방어 보정기 실패`);
  }
  
  return { success: true };
}

function handlePass(battle, actor, action) {
  pushLog(battle, 'battle', `${actor.name}이 턴을 넘김`);
  return { success: true };
}

// --------------------------------------------------
// Express + Multer 설정
// --------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// CORS 설정
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  if (req.method === 'OPTIONS') res.sendStatus(200);
  else next();
});

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다'));
    }
  }
});

// 정적 파일 서빙
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 페이지 라우트
app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'pages', 'admin.html'));
});

app.get('/player', (req, res) => {
  res.sendFile(path.join(publicDir, 'pages', 'player.html'));
});

app.get('/spectator', (req, res) => {
  res.sendFile(path.join(publicDir, 'pages', 'spectator.html'));
});

// API 라우트
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    battles: battles.size,
    activeBattles: Array.from(battles.values()).filter(b => b.status === 'active').length,
    totalPlayers: Array.from(battles.values()).reduce((sum, b) => sum + b.players.length, 0),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      HOST,
      PORT,
      PUBLIC_BASE_URL
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// 호환성을 위한 헬스체크
app.get('/healthz', (req, res) => {
  res.redirect('/api/health');
});

// 전투 생성 API
app.post('/api/battles', (req, res) => {
  try {
    const mode = String(req.body?.mode || '1v1');
    const validModes = ['1v1', '2v2', '3v3', '4v4'];
    
    if (!validModes.includes(mode)) {
      return res.status(400).json({ 
        ok: false, 
        error: `잘못된 모드입니다. 사용 가능: ${validModes.join(', ')}` 
      });
    }
    
    const result = createNewBattle(mode);
    
    res.json({
      ok: true,
      battleId: result.battleId,
      mode: result.battle.mode,
      adminUrl: result.adminUrl,
      playerBase: result.playerBase,
      spectatorBase: result.spectatorBase,
      createdAt: result.battle.createdAt
    });
  } catch (error) {
    console.error('[API] 전투 생성 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 전투 시작 API
app.post('/api/battles/:id/start', (req, res) => {
  try {
    const battle = startBattle(req.params.id);
    
    // 모든 클라이언트에게 알림
    io.to(battle.id).emit('battle:started', serializeBattle(battle));
    io.to(battle.id).emit('battle:update', serializeBattle(battle));
    
    res.json({ 
      ok: true, 
      battleId: battle.id,
      startedAt: battle.startedAt,
      currentTeam: battle.currentTeam
    });
  } catch (error) {
    console.error('[API] 전투 시작 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 아바타 업로드 API
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '파일이 업로드되지 않았습니다' });
    }
    
    const avatarUrl = `/uploads/${req.file.filename}`;
    res.json({ 
      ok: true, 
      avatarUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error('[API] 아바타 업로드 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 전투 정보 조회 API
app.get('/api/battles/:id', (req, res) => {
  try {
    const battle = battles.get(req.params.id);
    if (!battle) {
      return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    }
    
    res.json({
      ok: true,
      battle: serializeBattle(battle)
    });
  } catch (error) {
    console.error('[API] 전투 조회 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --------------------------------------------------
// HTTP + Socket.IO 서버
// --------------------------------------------------
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { 
    origin: true, 
    credentials: true 
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// --------------------------------------------------
// Socket.IO 이벤트 핸들러
// --------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[SOCKET] 새 연결: ${socket.id}`);

  // 공통: 룸 합류
  socket.on('join', ({ battleId }) => {
    console.log(`[SOCKET] join 이벤트: ${battleId}`);
    if (!battleId) return;
    
    socket.join(battleId);
    const battle = ensureBattle(battleId);
    socket.emit('battle:update', serializeBattle(battle));
    console.log(`[SOCKET] 룸 참여 완료: ${socket.id} -> ${battleId}`);
  });

  // ========== 관리자 이벤트 ==========
  
  // 관리자 인증
  socket.on('adminAuth', ({ battleId, token }) => {
    console.log(`[SOCKET] adminAuth 이벤트: battleId=${battleId}`);
    if (!battleId || !token) {
      console.log(`[SOCKET] adminAuth 실패: 필수 데이터 누락`);
      return socket.emit('authError', { error: 'Missing credentials' });
    }
    
    const battle = ensureBattle(battleId);
    if (token !== `admin-${battleId}`) {
      console.log(`[SOCKET] adminAuth 실패: 잘못된 토큰`);
      return socket.emit('authError', { error: 'Invalid token' });
    }
    
    socket.join(battleId);
    socket.emit('auth:success', { role: 'admin', battleId });
    socket.emit('battle:update', serializeBattle(battle));
    console.log(`[SOCKET] 관리자 인증 성공: ${socket.id} -> ${battleId}`);
  });

  // 전투 생성 (Socket 이벤트)
  socket.on('createBattle', ({ mode }) => {
    console.log(`[SOCKET] createBattle 이벤트 수신: mode=${mode}`);
    try {
      const result = createNewBattle(mode || '1v1');
      console.log(`[SOCKET] 전투 생성 완료:`, result.battleId);
      
      const response = {
        success: true,
        battleId: result.battleId,
        mode: result.battle.mode,
        adminUrl: result.adminUrl,
        playerBase: result.playerBase,
        spectatorBase: result.spectatorBase
      };
      
      socket.emit('battleCreated', response);
      socket.emit('battle:update', serializeBattle(result.battle));
      
      console.log(`[SOCKET] 전투 생성 이벤트 처리 완료`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 생성 오류:', error);
      socket.emit('battleCreated', {
        success: false,
        error: error.message
      });
    }
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId }) => {
    try {
      if (!battleId) {
        socket.emit('battleError', { error: '전투 ID가 필요합니다' });
        return;
      }
      
      const battle = startBattle(battleId);
      
      // 모든 클라이언트에게 전투 시작 알림
      io.to(battleId).emit('battle:started', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      
      socket.emit('battleStarted', { success: true, battleId });
      console.log(`[SOCKET] 전투 시작: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 시작 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 일시정지
  socket.on('pauseBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      
      if (battle.gameTimer) clearTimeout(battle.gameTimer);
      if (battle.turnTimer) clearTimeout(battle.turnTimer);
      
      battle.status = 'paused';
      pushLog(battle, 'system', '전투 일시정지');
      
      io.to(battleId).emit('battle:paused', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      console.log(`[SOCKET] 전투 일시정지: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 일시정지 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 재개
  socket.on('resumeBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      battle.status = 'active';
      
      // 타이머 재설정
      setTurnTimer(battle);
      
      pushLog(battle, 'system', '전투 재개');
      
      io.to(battleId).emit('battle:resumed', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      console.log(`[SOCKET] 전투 재개: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 재개 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 종료
  socket.on('endBattle', ({ battleId }) => {
    try {
      const battle = endBattle(battleId, '관리자 종료');
      
      io.to(battleId).emit('battle:ended', serializeBattle(battle));
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      console.log(`[SOCKET] 전투 종료: ${battleId}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 종료 오류:', error);
      socket.emit('battleError', { error: error.message });
    }
  });

  // 전투 참가자 추가
  socket.on('addPlayer', ({ battleId, playerData }) => {
    try {
      console.log(`[SOCKET] 전투 참가자 추가 요청:`, playerData);
      
      const player = addPlayerToBattle(battleId, playerData);
      const battle = ensureBattle(battleId);
      
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerAdded', { success: true, player });
      console.log(`[SOCKET] 전투 참가자 추가 완료: ${player.name}`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 참가자 추가 오류:', error);
      socket.emit('playerAdded', { success: false, error: error.message });
    }
  });

  // 전투 참가자 제거
  socket.on('removePlayer', ({ battleId, playerId }) => {
    try {
      const battle = ensureBattle(battleId);
      const playerIndex = battle.players.findIndex(p => p.id === playerId);
      
      if (playerIndex === -1) {
        socket.emit('playerRemoved', { success: false, error: '전투 참가자를 찾을 수 없습니다' });
        return;
      }
      
      const removedPlayer = battle.players.splice(playerIndex, 1)[0];
      pushLog(battle, 'system', `전투 참가자 제거: ${removedPlayer.name}`);
      
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerRemoved', { success: true, playerId });
      
    } catch (error) {
      console.error('[SOCKET] 전투 참가자 제거 오류:', error);
      socket.emit('playerRemoved', { success: false, error: error.message });
    }
  });

  // 전투 참가자 수정
  socket.on('updatePlayer', ({ battleId, playerId, updates }) => {
    try {
      const battle = ensureBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      
      if (!player) {
        socket.emit('playerUpdated', { success: false, error: '전투 참가자를 찾을 수 없습니다' });
        return;
      }
      
      // 허용된 필드만 업데이트
      const allowedFields = ['hp', 'maxHp', 'stats', 'items', 'avatar'];
      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          if (key === 'stats' && updates[key]) {
            // 스탯 총합 검증
            const totalStats = Object.values(updates[key]).reduce((sum, val) => sum + (parseInt(val) || 0), 0);
            if (totalStats === 12) {
              player[key] = {
                attack: clampStat(updates[key].attack),
                defense: clampStat(updates[key].defense),
                agility: clampStat(updates[key].agility),
                luck: clampStat(updates[key].luck)
              };
            }
          } else {
            player[key] = updates[key];
          }
        }
      });
      
      pushLog(battle, 'system', `전투 참가자 정보 수정: ${player.name}`);
      
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerUpdated', { success: true, player });
      
    } catch (error) {
      console.error('[SOCKET] 전투 참가자 수정 오류:', error);
      socket.emit('playerUpdated', { success: false, error: error.message });
    }
  });

  // 전투 참가자 링크 생성
  socket.on('generatePlayerPassword', ({ battleId }) => {
    try {
      console.log(`[SOCKET] 전투 참가자 링크 생성: ${battleId}`);
      
      const battle = ensureBattle(battleId);
      
      if (battle.players.length === 0) {
        socket.emit('playerPasswordGenerated', { 
          success: false, 
          error: '먼저 전투 참가자를 추가하세요' 
        });
        return;
      }
      
      const playerLinks = battle.players.map(player => ({
        playerId: player.id,
        name: player.name,
        team: player.team,
        url: `${PUBLIC_BASE_URL}/player?battle=${battleId}&token=player-${player.name}-${battleId}&name=${encodeURIComponent(player.name)}`
      }));
      
      socket.emit('playerPasswordGenerated', { success: true, playerLinks });
      console.log(`[SOCKET] 전투 참가자 링크 생성 완료: ${playerLinks.length}개`);
      
    } catch (error) {
      console.error('[SOCKET] 전투 참가자 링크 생성 오류:', error);
      socket.emit('playerPasswordGenerated', { 
        success: false, 
        error: error.message 
      });
    }
  });

  // 관전자 링크 생성
  socket.on('generateSpectatorOtp', ({ battleId }) => {
    try {
      console.log(`[SOCKET] 관전자 링크 생성: ${battleId}`);
      
      const spectatorUrl = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}&otp=spectator-${battleId}`;
      
      socket.emit('spectatorOtpGenerated', { success: true, spectatorUrl });
      console.log(`[SOCKET] 관전자 링크 생성 완료`);
      
    } catch (error) {
      console.error('[SOCKET] 관전자 링크 생성 오류:', error);
      socket.emit('spectatorOtpGenerated', { 
        success: false, 
        error: error.message 
      });
    }
  });

  // ========== 전투 참가자 이벤트 ==========
  
  // 전투 참가자 인증
  socket.on('playerAuth', ({ battleId, name, token }) => {
    console.log(`[SOCKET] 전투 참가자 인증 시도: ${name} -> ${battleId}`);
    
    if (!battleId || !name || !token) {
      return socket.emit('authError', { error: 'Missing credentials' });
    }
    
    const battle = ensureBattle(battleId);
    
    // 토큰 검증
    if (token !== `player-${name}-${battleId}`) {
      return socket.emit('authError', { error: 'Invalid token' });
    }

    // 전투 참가자 찾기
    const player = battle.players.find(p => p.name === name);
    if (!player) {
      return socket.emit('authError', { error: '등록되지 않은 전투 참가자입니다' });
    }

    socket.join(battleId);
    socket.emit('auth:success', { 
      role: 'player', 
      battleId, 
      playerId: player.id,
      playerData: player
    });
    socket.emit('battle:update', serializeBattle(battle));
    console.log(`[SOCKET] 전투 참가자 인증 성공: ${name} -> ${battleId}`);
  });

  // 전투 참가자 준비
  socket.on('player:ready', ({ battleId, playerId }) => {
    try {
      const battle = ensureBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      
      if (player) {
        player.isReady = true;
        pushLog(battle, 'system', `${player.name} 준비완료`);
        io.to(battleId).emit('battle:update', serializeBattle(battle));
        console.log(`[SOCKET] 전투 참가자 준비: ${player.name}`);
      }
    } catch (error) {
      console.error('[SOCKET] 전투 참가자 준비 오류:', error);
    }
  });

  // 전투 참가자 액션
  socket.on('player:action', ({ battleId, playerId, action }) => {
    try {
      console.log(`[SOCKET] 전투 참가자 액션: ${playerId} -> ${action.type}`);
      
      const result = handlePlayerAction(battleId, playerId, action);
      const battle = ensureBattle(battleId);
      
      if (result.success) {
        io.to(battleId).emit('battle:update', serializeBattle(battle));
        socket.emit('action:success', { action: action.type });
      } else {
        socket.emit('action:error', { error: result.error });
      }
      
    } catch (error) {
      console.error('[SOCKET] 전투 참가자 액션 오류:', error);
      socket.emit('action:error', { error: '액션 처리 중 오류 발생' });
    }
  });

  // ========== 관전자 이벤트 ==========
  
  // 관전자 인증
  socket.on('spectatorAuth', ({ battleId, otp, name }) => {
    console.log(`[SOCKET] 관전자 인증 시도: ${name || 'Anonymous'} -> ${battleId}`);
    
    if (!battleId || !otp) {
      return socket.emit('authError', { error: 'Missing credentials' });
    }
    
    const battle = ensureBattle(battleId);
    
    // OTP 검증
    if (otp !== `spectator-${battleId}`) {
      return socket.emit('authError', { error: 'Invalid password' });
    }

    battle.spectators.add(socket.id);
    socket.join(battleId);
    socket.emit('auth:success', { role: 'spectator', battleId });
    socket.emit('battle:update', serializeBattle(battle));
    io.to(battleId).emit('spectator:count', { count: battle.spectators.size });
    console.log(`[SOCKET] 관전자 인증 성공: ${name || 'Anonymous'} -> ${battleId}`);
  });

  // ========== 공통 이벤트 ==========
  
  // 채팅
  socket.on('chat:send', ({ battleId, name, message, team, role }) => {
    if (!battleId || !message || message.trim().length === 0) return;
    
    // 메시지 길이 제한
    const trimmedMessage = message.trim().slice(0, 200);
    
    const chatData = { 
      name: name || '익명', 
      message: trimmedMessage,
      team: team || null,
      role: role || 'player',
      timestamp: new Date().toISOString()
    };
    
    io.to(battleId).emit('battle:chat', chatData);
    console.log(`[SOCKET] 채팅: ${chatData.name} -> ${trimmedMessage}`);
  });

  // 응원
  socket.on('cheer:send', ({ battleId, cheer, name }) => {
    if (!battleId || !cheer || cheer.trim().length === 0) return;
    
    const trimmedCheer = cheer.trim().slice(0, 100);
    const cheerMessage = name ? `${name}: ${trimmedCheer}` : trimmedCheer;
    
    io.to(battleId).emit('battle:log', { 
      type: 'cheer', 
      message: cheerMessage,
      timestamp: new Date().toISOString()
    });
    console.log(`[SOCKET] 응원: ${cheerMessage}`);
  });

  // 연결 종료
  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] 연결 해제: ${socket.id} (이유: ${reason})`);
    
    // 관전자 카운트 정리
    for (const battle of battles.values()) {
      if (battle.spectators.delete(socket.id)) {
        io.to(battle.id).emit('spectator:count', { count: battle.spectators.size });
        break;
      }
    }
  });

  // 에러 핸들링
  socket.on('error', (error) => {
    console.error(`[SOCKET] 소켓 오류 ${socket.id}:`, error);
  });

  // 연결 상태 확인
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// --------------------------------------------------
// 서버 시작
// --------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] 🚀 서버 실행 중: http://${HOST}:${PORT}`);
  console.log(`[PYXIS] 📊 공개 URL: ${PUBLIC_BASE_URL}`);
  console.log(`[PYXIS] 🛡️  관리자: ${PUBLIC_BASE_URL}/admin`);
  console.log(`[PYXIS] ⚔️  전투 참가자: ${PUBLIC_BASE_URL}/player`);
  console.log(`[PYXIS] 👁️  관전자: ${PUBLIC_BASE_URL}/spectator`);
  console.log(`[PYXIS] ❤️  헬스체크: ${PUBLIC_BASE_URL}/api/health`);
});

// --------------------------------------------------
// 우아한 종료 처리
// --------------------------------------------------
function gracefulShutdown(signal) {
  console.log(`[PYXIS] ${signal} 수신, 서버 종료 중...`);
  
  // 모든 전투의 타이머 정리
  for (const battle of battles.values()) {
    if (battle.gameTimer) clearTimeout(battle.gameTimer);
    if (battle.turnTimer) clearTimeout(battle.turnTimer);
  }
  
  server.close(() => {
    console.log('[PYXIS] HTTP 서버 종료 완료');
    
    io.close(() => {
      console.log('[PYXIS] Socket.IO 서버 종료 완료');
      console.log('[PYXIS] 모든 연결이 안전하게 종료되었습니다');
      process.exit(0);
    });
  });
  
  // 강제 종료 방지 (최대 10초 대기)
  setTimeout(() => {
    console.error('[PYXIS] 강제 종료 실행');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 처리되지 않은 예외 캐치
process.on('uncaughtException', (error) => {
  console.error('[PYXIS] 처리되지 않은 예외:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PYXIS] 처리되지 않은 Promise 거부:', reason);
  console.error('[PYXIS] Promise:', promise);
  gracefulShutdown('UNHANDLED_REJECTION');
});
