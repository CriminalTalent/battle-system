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
const STAT_MAX = 10;
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
    description: '1턴 동안 공격력 2배',
    type: 'attack_buff',
    duration: 1,
    effect: { attack: 2.0 },
    successRate: 0.1 // 10% 성공률
  },
  '방어 보정기': {
    name: '방어 보정기', 
    description: '1턴 동안 방어력 2배',
    type: 'defense_buff',
    duration: 1,
    effect: { defense: 2.0 },
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
  out.attack = Math.min(Math.max(out.attack ?? 3, STAT_MIN), STAT_MAX);
  out.defense = Math.min(Math.max(out.defense ?? 3, STAT_MIN), STAT_MAX);
  out.agility = Math.min(Math.max(out.agility ?? 3, STAT_MIN), STAT_MAX);
  out.luck = Math.min(Math.max(out.luck ?? 3, STAT_MIN), STAT_MAX);
  return out;
}

// 주사위 굴리기 (1-20)
function rollDice() {
  return Math.floor(Math.random() * 20) + 1;
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
      team1: { name: '팀 1', players: [] },
      team2: { name: '팀 2', players: [] }
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

// OTP 생성
function generateOTP() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
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

// 전투 시작
function startBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('존재하지 않는 전투입니다.');
  if (battle.status !== 'waiting') throw new Error('전투가 이미 시작되었거나 종료되었습니다.');
  
  // 플레이어 수 체크
  const team1Count = battle.teams.team1.players.length;
  const team2Count = battle.teams.team2.players.length;
  const requiredPerTeam = battle.config.playersPerTeam;
  
  if (team1Count < requiredPerTeam || team2Count < requiredPerTeam) {
    throw new Error(MSG.not_enough_players);
  }
  
  battle.status = 'ongoing';
  battle.lastActivity = Date.now();
  
  // 선공 결정 (팀별 민첩성 합계 + 주사위)
  const team1Agility = battle.teams.team1.players.reduce((sum, p) => sum + p.stats.agility, 0);
  const team2Agility = battle.teams.team2.players.reduce((sum, p) => sum + p.stats.agility, 0);
  
  const team1Roll = rollDice();
  const team2Roll = rollDice();
  const team1Total = team1Agility + team1Roll;
  const team2Total = team2Agility + team2Roll;
  
  addBattleLog(battleId, 'system', MSG.initiative_roll('팀 1', `${team1Agility} + ${team1Roll} = ${team1Total}`));
  addBattleLog(battleId, 'system', MSG.initiative_roll('팀 2', `${team2Agility} + ${team2Roll} = ${team2Total}`));
  
  // 동점 처리
  let firstTeam;
  if (team1Total > team2Total) {
    firstTeam = 'team1';
  } else if (team2Total > team1Total) {
    firstTeam = 'team2';
  } else {
    // 재굴림
    const reroll1 = rollDice();
    const reroll2 = rollDice();
    addBattleLog(battleId, 'system', `동점! 재굴림 - 팀 1: ${reroll1}, 팀 2: ${reroll2}`);
    firstTeam = reroll1 >= reroll2 ? 'team1' : 'team2';
  }
  
  battle.currentTeam = firstTeam;
  battle.currentPlayerIndex = 0;
  battle.turnStartTime = Date.now();
  
  addBattleLog(battleId, 'system', MSG.team_goes_first(battle.teams[firstTeam].name));
  addBattleLog(battleId, 'system', MSG.turn_started(battle.teams[firstTeam].name));
  
  // 턴 타이머 설정
  setupTurnTimer(battleId);
  
  console.log(`[전투시작] ID: ${battleId}, 선공: ${firstTeam}`);
  broadcastBattleState(battleId);
}

// 턴 타이머 설정
function setupTurnTimer(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  // 기존 타이머 해제
  if (battle.turnTimeouts.has(battle.currentTeam)) {
    clearTimeout(battle.turnTimeouts.get(battle.currentTeam));
  }
  
  // 새 타이머 설정
  const timeout = setTimeout(() => {
    handleTurnTimeout(battleId);
  }, TURN_TIMEOUT);
  
  battle.turnTimeouts.set(battle.currentTeam, timeout);
}

// 턴 타임아웃 처리
function handleTurnTimeout(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  const currentTeam = battle.teams[battle.currentTeam];
  const currentPlayer = currentTeam.players[battle.currentPlayerIndex];
  
  if (currentPlayer && currentPlayer.alive && !currentPlayer.hasActed) {
    // 자동으로 방어 행동
    addBattleLog(battleId, 'action', MSG.turn_timeout(currentPlayer.name));
    executeAction(battleId, currentPlayer.id, { type: 'defend' });
  } else {
    // 다음 플레이어로 넘어가기
    nextTurn(battleId);
  }
}

// 다음 턴으로 진행
function nextTurn(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  const currentTeam = battle.teams[battle.currentTeam];
  
  // 현재 팀의 다음 플레이어로 이동
  let nextPlayerIndex = battle.currentPlayerIndex + 1;
  let nextPlayer = null;
  
  // 현재 팀에서 아직 행동하지 않은 살아있는 플레이어 찾기
  while (nextPlayerIndex < currentTeam.players.length) {
    const player = currentTeam.players[nextPlayerIndex];
    if (player.alive && !player.hasActed) {
      nextPlayer = player;
      battle.currentPlayerIndex = nextPlayerIndex;
      break;
    }
    nextPlayerIndex++;
  }
  
  if (nextPlayer) {
    // 같은 팀의 다음 플레이어
    battle.turnStartTime = Date.now();
    setupTurnTimer(battleId);
  } else {
    // 팀 턴 종료, 다른 팀으로 교대
    switchTeams(battleId);
  }
  
  broadcastBattleState(battleId);
}

// 팀 교대
function switchTeams(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  const currentTeamName = battle.teams[battle.currentTeam].name;
  addBattleLog(battleId, 'system', MSG.turn_ended(currentTeamName));
  
  // 현재 팀의 모든 플레이어 행동 초기화
  battle.teams[battle.currentTeam].players.forEach(player => {
    player.hasActed = false;
    player.actionType = null;
  });
  
  // 다음 팀으로 교대
  battle.currentTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
  battle.currentPlayerIndex = 0;
  battle.turnStartTime = Date.now();
  
  const newTeamName = battle.teams[battle.currentTeam].name;
  addBattleLog(battleId, 'system', MSG.turn_started(newTeamName));
  
  // 버프 지속시간 감소
  decreaseBuffDuration(battleId);
  
  setupTurnTimer(battleId);
  
  // 승부 체크
  checkBattleEnd(battleId);
}

// 버프 지속시간 감소
function decreaseBuffDuration(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  Object.values(battle.teams).forEach(team => {
    team.players.forEach(player => {
      Object.keys(player.buffs).forEach(buffType => {
        if (player.buffs[buffType].duration > 0) {
          player.buffs[buffType].duration--;
          if (player.buffs[buffType].duration <= 0) {
            delete player.buffs[buffType];
          }
        }
      });
    });
  });
}

// 액션 실행
function executeAction(battleId, playerId, action) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('존재하지 않는 전투입니다.');
  if (battle.status !== 'ongoing') throw new Error('전투가 진행 중이 아닙니다.');
  
  const player = findPlayerInBattle(battle, playerId);
  if (!player) throw new Error('플레이어를 찾을 수 없습니다.');
  if (!player.alive) throw new Error(MSG.player_dead);
  if (player.hasActed) throw new Error(MSG.player_already_acted);
  
  // 현재 플레이어 턴 체크
  const currentTeam = battle.teams[battle.currentTeam];
  const currentPlayer = currentTeam.players[battle.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    throw new Error('현재 당신의 차례가 아닙니다.');
  }
  
  player.hasActed = true;
  player.actionType = action.type;
  battle.lastActivity = Date.now();
  
  switch (action.type) {
    case 'attack':
      handleAttack(battleId, player, action.targetId);
      break;
    case 'defend':
      handleDefend(battleId, player);
      break;
    case 'dodge':
      handleDodge(battleId, player);
      break;
    case 'item':
      handleItemUse(battleId, player, action.itemName, action.targetId);
      break;
    case 'pass':
      handlePass(battleId, player);
      break;
    default:
      throw new Error(MSG.invalid_action);
  }
  
  // 다음 턴으로 진행
  setTimeout(() => nextTurn(battleId), 1000);
  broadcastBattleState(battleId);
}

// 공격 처리
function handleAttack(battleId, attacker, targetId) {
  const battle = battles.get(battleId);
  const target = findPlayerInBattle(battle, targetId);
  
  if (!target) throw new Error(MSG.target_not_found);
  if (!target.alive) throw new Error(MSG.target_dead);
  if (attacker.team === target.team) throw new Error(MSG.cannot_attack_teammate);
  
  // 공격력 계산 (버프 적용)
  let attackPower = attacker.stats.attack;
  if (attacker.buffs.attack_buff) {
    attackPower *= attacker.buffs.attack_buff.effect.attack;
  }
  
  const attackRoll = rollDice();
  const totalAttack = attackPower + attackRoll;
  
  // 타겟이 회피 상태인지 체크
  if (target.actionType === 'dodge') {
    const dodgeRoll = rollDice();
    const totalDodge = target.stats.agility + dodgeRoll;
    
    if (totalDodge >= totalAttack) {
      addBattleLog(battleId, 'action', MSG.dodge_success(attacker.name, target.name));
      return;
    } else {
      addBattleLog(battleId, 'action', MSG.dodge_fail(attacker.name, target.name));
    }
  }
  
  // 명중 체크
  const hitRoll = rollDice();
  const hitChance = attacker.stats.luck + hitRoll;
  
  if (hitChance < 10) { // 기본 명중 임계값
    addBattleLog(battleId, 'action', MSG.miss(attacker.name, target.name));
    return;
  }
  
  // 치명타 체크
  const critRoll = rollDice();
  const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
  const isCritical = critRoll >= critThreshold;
  
  // 방어력 계산 (버프 적용)
  let defense = target.stats.defense;
  if (target.buffs.defense_buff) {
    defense *= target.buffs.defense_buff.effect.defense;
  }
  
  // 대미지 계산
  let baseDamage = Math.max(1, totalAttack - defense);
  if (isCritical) baseDamage *= 2;
  
  // 방어 상태 보너스
  if (target.actionType === 'defend') {
    baseDamage = Math.max(1, Math.floor(baseDamage * 0.5));
  }
  
  // 대미지 적용
  target.hp = Math.max(0, target.hp - baseDamage);
  const isEliminated = target.hp <= 0;
  if (isEliminated) {
    target.alive = false;
  }
  
  addBattleLog(battleId, 'action', MSG.attack(attacker.name, target.name, baseDamage, isCritical, isEliminated));
}

// 방어 처리
function handleDefend(battleId, player) {
  addBattleLog(battleId, 'action', MSG.defensive_stance(player.name));
}

// 회피 처리
function handleDodge(battleId, player) {
  addBattleLog(battleId, 'action', MSG.dodge_ready(player.name));
}

// 패스 처리
function handlePass(battleId, player) {
  addBattleLog(battleId, 'action', MSG.pass_action(player.name));
}

// 아이템 사용 처리
function handleItemUse(battleId, player, itemName, targetId = null) {
  const battle = battles.get(battleId);
  
  // 아이템 보유 체크
  const itemIndex = player.inventory.indexOf(itemName);
  if (itemIndex === -1) throw new Error(MSG.item_not_found);
  
  const itemInfo = ITEM_INFO[itemName];
  if (!itemInfo) throw new Error('알 수 없는 아이템입니다.');
  
  // 아이템 제거 (1회용)
  player.inventory.splice(itemIndex, 1);
  
  addBattleLog(battleId, 'action', MSG.item_used(player.name, itemName));
  
  // 성공률 체크
  const successRoll = Math.random();
  const isSuccess = successRoll <= itemInfo.successRate;
  
  if (!isSuccess && itemInfo.type !== 'heal') {
    // 회복 아이템은 항상 성공, 다른 아이템은 실패 가능
    addBattleLog(battleId, 'action', MSG.item_fail(player.name, itemName));
    return;
  }
  
  switch (itemInfo.type) {
    case 'attack_buff':
      if (isSuccess) {
        player.buffs.attack_buff = {
          effect: itemInfo.effect,
          duration: itemInfo.duration
        };
        addBattleLog(battleId, 'action', MSG.item_success(player.name, itemName));
        addBattleLog(battleId, 'action', MSG.buff_attack(player.name));
      }
      break;
      
    case 'defense_buff':
      if (isSuccess) {
        player.buffs.defense_buff = {
          effect: itemInfo.effect,
          duration: itemInfo.duration
        };
        addBattleLog(battleId, 'action', MSG.item_success(player.name, itemName));
        addBattleLog(battleId, 'action', MSG.buff_defense(player.name));
      }
      break;
      
    case 'heal':
      const healAmount = itemInfo.effect.heal;
      const actualHeal = Math.min(healAmount, player.maxHp - player.hp);
      player.hp += actualHeal;
      addBattleLog(battleId, 'action', MSG.heal(player.name, actualHeal));
      break;
  }
}

// 전투 종료 체크
function checkBattleEnd(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  const team1Alive = battle.teams.team1.players.filter(p => p.alive).length;
  const team2Alive = battle.teams.team2.players.filter(p => p.alive).length;
  
  if (team1Alive === 0 && team2Alive === 0) {
    endBattle(battleId, null, '무승부');
  } else if (team1Alive === 0) {
    endBattle(battleId, 'team2', '팀 2 승리');
  } else if (team2Alive === 0) {
    endBattle(battleId, 'team1', '팀 1 승리');
  }
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
  
  res.json({ battle });
});

// 플레이어 추가
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const battleId = req.params.id;
    const playerData = req.body;
    const player = addPlayer(battleId, playerData);
    res.json({ success: true, player });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 시작
app.post('/api/battles/:id/start', (req, res) => {
  try {
    const battleId = req.params.id;
    startBattle(battleId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 종료
app.post('/api/battles/:id/end', (req, res) => {
  try {
    const battleId = req.params.id;
    const { winner, reason } = req.body;
    endBattle(battleId, winner, reason);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 삭제
app.delete('/api/battles/:id', (req, res) => {
  try {
    const battleId = req.params.id;
    deleteBattle(battleId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
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
      socket.emit('authError', '존재하지 않는 전투입니다.');
      return;
    }
    
    if (battle.otps.admin !== otp) {
      socket.emit('authError', '잘못된 관리자 OTP입니다.');
      return;
    }
    
    adminConnections.set(socket.id, { battleId, role: 'admin' });
    socket.emit('authSuccess', { role: 'admin', battle });
    console.log(`[관리자인증] 소켓: ${socket.id}, 전투: ${battleId}`);
  });
  
  // 플레이어 인증
  socket.on('playerAuth', ({ battleId, otp, playerId }) => {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('authError', '존재하지 않는 전투입니다.');
      return;
    }
    
    if (battle.otps.player !== otp) {
      socket.emit('authError', '잘못된 플레이어 OTP입니다.');
      return;
    }
    
    const player = findPlayerInBattle(battle, playerId);
    if (!player) {
      socket.emit('authError', '플레이어를 찾을 수 없습니다.');
      return;
    }
    
    player.socketId = socket.id;
    player.connected = true;
    player.lastSeen = Date.now();
    
    playerSockets.set(socket.id, { battleId, playerId, role: 'player' });
    socket.emit('authSuccess', { role: 'player', battle, player });
    
    broadcastBattleState(battleId);
    console.log(`[플레이어인증] 소켓: ${socket.id}, 플레이어: ${player.name}`);
  });
  
  // 관전자 인증
  socket.on('spectatorAuth', ({ battleId, otp }) => {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('authError', '존재하지 않는 전투입니다.');
      return;
    }
    
    if (battle.otps.spectator !== otp) {
      socket.emit('authError', '잘못된 관전자 OTP입니다.');
      return;
    }
    
    spectatorConnections.set(socket.id, { battleId, role: 'spectator' });
    socket.emit('authSuccess', { role: 'spectator', battle });
    console.log(`[관전자인증] 소켓: ${socket.id}, 전투: ${battleId}`);
  });
  
  // 플레이어 액션
  socket.on('playerAction', (actionData) => {
    try {
      const playerInfo = playerSockets.get(socket.id);
      if (!playerInfo) {
        socket.emit('actionError', '인증되지 않은 플레이어입니다.');
        return;
      }
      
      executeAction(playerInfo.battleId, playerInfo.playerId, actionData);
      socket.emit('actionSuccess');
    } catch (error) {
      socket.emit('actionError', error.message);
    }
  });
  
  // 채팅 메시지
  socket.on('chatMessage', ({ message }) => {
    const adminInfo = adminConnections.get(socket.id);
    const playerInfo = playerSockets.get(socket.id);
    const spectatorInfo = spectatorConnections.get(socket.id);
    
    if (adminInfo) {
      addChatLog(adminInfo.battleId, '관리자', message, 'admin');
    } else if (playerInfo) {
      const battle = battles.get(playerInfo.battleId);
      const player = findPlayerInBattle(battle, playerInfo.playerId);
      if (player) {
        addChatLog(playerInfo.battleId, player.name, message, 'player');
      }
    } else if (spectatorInfo) {
      // 관전자는 채팅 불가 (응원 메시지만 가능)
      socket.emit('chatError', '관전자는 채팅할 수 없습니다.');
    }
  });
  
  // 응원 메시지 (관전자용)
  socket.on('cheerMessage', ({ team }) => {
    const spectatorInfo = spectatorConnections.get(socket.id);
    if (!spectatorInfo) return;
    
    const cheerMessages = [
      `${team} 팀 화이팅!`,
      `${team} 팀 파이팅!`,
      `${team} 팀 응원합니다!`,
      `${team} 팀 최고!`,
      `${team} 팀 힘내세요!`
    ];
    
    const randomMessage = cheerMessages[Math.floor(Math.random() * cheerMessages.length)];
    addChatLog(spectatorInfo.battleId, '관전자', randomMessage, 'spectator');
  });
  
  // 하트비트
  socket.on('heartbeat', () => {
    connectionHeartbeats.set(socket.id, Date.now());
  });
  
  // 연결 해제
  socket.on('disconnect', () => {
    console.log(`[소켓해제] ID: ${socket.id}`);
    
    // 플레이어 연결 상태 업데이트
    const playerInfo = playerSockets.get(socket.id);
    if (playerInfo) {
      const battle = battles.get(playerInfo.battleId);
      if (battle) {
        const player = findPlayerInBattle(battle, playerInfo.playerId);
        if (player) {
          player.connected = false;
          player.socketId = null;
          broadcastBattleState(playerInfo.battleId);
        }
      }
      playerSockets.delete(socket.id);
    }
    
    // 연결 정보 정리
    adminConnections.delete(socket.id);
    spectatorConnections.delete(socket.id);
    connectionHeartbeats.delete(socket.id);
  });
});

// 연결 상태 모니터링
setInterval(() => {
  const now = Date.now();
  connectionHeartbeats.forEach((lastSeen, socketId) => {
    if (now - lastSeen > HEARTBEAT_INTERVAL * 2) {
      console.log(`[연결타임아웃] 소켓: ${socketId}`);
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.disconnect();
      connectionHeartbeats.delete(socketId);
    }
  });
}, HEARTBEAT_INTERVAL);

// 서버 시작
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[전투서버] 포트 ${PORT}에서 실행 중`);
  console.log(`[전투서버] 관리자 페이지: http://localhost:${PORT}/admin`);
  console.log(`[전투서버] 플레이어 페이지: http://localhost:${PORT}/play`);
  console.log(`[전투서버] 관전자 페이지: http://localhost:${PORT}/watch`);
});
