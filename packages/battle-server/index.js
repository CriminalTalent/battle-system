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
app.use(express.urlencoded({ extended: true }));

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
const publicPath = path.join(__dirname, 'public');
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
    effect: { attack: 1.5 }
  },
  '방어 보정기': {
    name: '방어 보정기', 
    description: '이번 1턴 동안 방어력 1.5배',
    type: 'defense_buff',
    duration: 1,
    effect: { defense: 1.5 }
  },
  '디터니': {
    name: '디터니',
    description: 'HP 10 즉시 회복',
    type: 'heal',
    effect: { heal: 10 }
  }
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
    roundNumber: 1,
    turnNumber: 1,
    
    // 로그
    battleLog: [],
    chatLog: [],
    
    // 설정
    config,
    teamsCount: config.teamsCount,
    playersPerTeam: config.playersPerTeam,
    
    // 승리 정보
    winner: null,
    endReason: null,
    
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
  if (battle.status !== 'waiting') throw new Error('이미 전투가 시작되었습니다.');
  
  const { name, team, stats, inventory = [], imageUrl = '' } = playerData;
  
  if (!['team1', 'team2'].includes(team)) {
    throw new Error('잘못된 팀입니다.');
  }
  
  const targetTeam = battle.teams[team];
  if (targetTeam.players.length >= battle.config.playersPerTeam) {
    throw new Error('해당 팀이 가득 찼습니다.');
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
    isReady: false,
    isDefending: false,
    isDodging: false,
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

// 전투 시작 함수
function startBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('존재하지 않는 전투입니다.');
  if (battle.status !== 'waiting') throw new Error('이미 시작된 전투입니다.');
  
  // 팀별 최소 인원 체크
  const team1Count = battle.teams.team1.players.length;
  const team2Count = battle.teams.team2.players.length;
  
  if (team1Count === 0 || team2Count === 0) {
    throw new Error('각 팀에 최소 1명의 플레이어가 필요합니다.');
  }
  
  battle.status = 'ongoing';
  battle.turnStartTime = Date.now();
  
  // 선공 결정 (민첩성 기반)
  determineFirstTeam(battle);
  
  addBattleLog(battleId, 'system', '전투가 시작되었습니다!');
  broadcastBattleState(battleId);
  
  return battle;
}

// 선공 결정 함수
function determineFirstTeam(battle) {
  const team1Total = battle.teams.team1.players.reduce((sum, p) => {
    const roll = rollDice();
    const total = p.stats.agility + roll;
    addBattleLog(battle.id, 'system', `${p.name}: 민첩 ${p.stats.agility} + 주사위 ${roll} = ${total}`);
    return sum + total;
  }, 0);
  
  const team2Total = battle.teams.team2.players.reduce((sum, p) => {
    const roll = rollDice();
    const total = p.stats.agility + roll;
    addBattleLog(battle.id, 'system', `${p.name}: 민첩 ${p.stats.agility} + 주사위 ${roll} = ${total}`);
    return sum + total;
  }, 0);
  
  addBattleLog(battle.id, 'system', `${battle.teams.team1.name} 총합: ${team1Total}`);
  addBattleLog(battle.id, 'system', `${battle.teams.team2.name} 총합: ${team2Total}`);
  
  if (team1Total > team2Total) {
    battle.currentTeam = 'team1';
    addBattleLog(battle.id, 'system', `${battle.teams.team1.name}이 선공합니다!`);
  } else if (team2Total > team1Total) {
    battle.currentTeam = 'team2';
    addBattleLog(battle.id, 'system', `${battle.teams.team2.name}이 선공합니다!`);
  } else {
    // 동점시 다시 굴림
    addBattleLog(battle.id, 'system', '동점입니다! 다시 굴립니다...');
    determineFirstTeam(battle);
  }
  
  // 턴 타이머 설정
  setTurnTimer(battle.id);
}

// 턴 타이머 설정
function setTurnTimer(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  
  // 기존 타이머 제거
  if (battle.turnTimeouts.has('main')) {
    clearTimeout(battle.turnTimeouts.get('main'));
  }
  
  const timer = setTimeout(() => {
    if (battle.status === 'ongoing') {
      addBattleLog(battleId, 'system', '턴 시간 초과! 다음 팀으로 넘어갑니다.');
      endTeamTurn(battleId);
    }
  }, TURN_TIMEOUT);
  
  battle.turnTimeouts.set('main', timer);
}

// 팀 턴 종료
function endTeamTurn(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  const currentTeam = battle.teams[battle.currentTeam];
  
  // 모든 플레이어 행동 완료 체크
  const alivePlayers = currentTeam.players.filter(p => p.alive);
  const allActed = alivePlayers.every(p => p.hasActed);
  
  if (!allActed) {
    // 시간 초과로 인한 강제 턴 종료 시 미행동 플레이어들 자동 방어
    alivePlayers.forEach(player => {
      if (!player.hasActed) {
        player.hasActed = true;
        player.isDefending = true;
        addBattleLog(battleId, 'system', `${player.name}의 시간 초과로 자동 방어합니다.`);
      }
    });
  }
  
  addBattleLog(battleId, 'system', `${currentTeam.name} 팀 턴이 종료되었습니다.`);
  
  // 버프 정리 (1턴 지속 효과들)
  currentTeam.players.forEach(player => {
    if (player.buffs.attack_buff) {
      player.buffs.attack_buff = false;
      addBattleLog(battleId, 'system', `${player.name}의 공격력 강화가 종료되었습니다.`);
    }
    if (player.buffs.defense_buff) {
      player.buffs.defense_buff = false;
      addBattleLog(battleId, 'system', `${player.name}의 방어력 강화가 종료되었습니다.`);
    }
  });
  
  // 타이머 정리
  battle.turnTimeouts.forEach(timeout => clearTimeout(timeout));
  battle.turnTimeouts.clear();
  
  // 승리 조건 체크
  const winner = checkVictoryCondition(battle);
  if (winner) {
    endBattle(battleId, winner);
    return;
  }
  
  // 상대팀으로 전환
  battle.currentTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
  battle.turnNumber++;
  
  // 새 팀 턴 시작
  startTeamTurn(battleId);
}

// 팀 턴 시작
function startTeamTurn(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  const currentTeam = battle.teams[battle.currentTeam];
  const alivePlayers = currentTeam.players.filter(p => p.alive);
  
  if (alivePlayers.length === 0) {
    // 현재 팀에 생존자가 없으면 상대팀 승리
    const winnerTeam = battle.currentTeam === 'team1' ? 'team2' : 'team1';
    endBattle(battleId, winnerTeam);
    return;
  }
  
  // 팀 턴 시작
  addBattleLog(battleId, 'system', `${currentTeam.name} 팀 턴이 시작되었습니다.`);
  
  // 모든 플레이어의 행동 플래그 초기화
  alivePlayers.forEach(player => {
    player.hasActed = false;
    player.isDefending = false;
    player.isDodging = false;
  });
  
  battle.turnStartTime = Date.now();
  setTurnTimer(battleId);
  
  broadcastBattleState(battleId);
}

// 승리 조건 체크
function checkVictoryCondition(battle) {
  const team1Alive = battle.teams.team1.players.filter(p => p.alive).length;
  const team2Alive = battle.teams.team2.players.filter(p => p.alive).length;
  
  if (team1Alive === 0) {
    return 'team2';
  }
  
  if (team2Alive === 0) {
    return 'team1';
  }
  
  // 최대 턴 수 체크 (50턴)
  if (battle.turnNumber >= 50) {
    // HP 총합으로 승자 결정
    const team1Hp = battle.teams.team1.players.reduce((sum, p) => sum + p.hp, 0);
    const team2Hp = battle.teams.team2.players.reduce((sum, p) => sum + p.hp, 0);
    
    if (team1Hp > team2Hp) {
      battle.endReason = '최대 턴 수 도달 - HP 총합으로 승부 결정';
      return 'team1';
    } else if (team2Hp > team1Hp) {
      battle.endReason = '최대 턴 수 도달 - HP 총합으로 승부 결정';
      return 'team2';
    } else {
      battle.endReason = '최대 턴 수 도달 - HP 동일로 무승부';
      return null; // 무승부
    }
  }
  
  return null;
}

// 플레이어 액션 실행
function executePlayerAction(battle, player, actionData) {
  const { type, targetId, itemType } = actionData;
  
  switch (type) {
    case 'attack':
      return executeAttack(battle, player, targetId);
    case 'defend':
      return executeDefend(battle, player);
    case 'dodge':
      return executeDodge(battle, player);
    case 'item':
      return executeItem(battle, player, itemType, targetId);
    case 'pass':
      return executePass(battle, player);
    default:
      throw new Error('알 수 없는 액션 타입입니다.');
  }
}

// 공격 실행
function executeAttack(battle, attacker, targetId) {
  const target = findPlayerInBattle(battle, targetId);
  if (!target) {
    throw new Error('대상을 찾을 수 없습니다.');
  }
  
  if (!target.alive) {
    throw new Error('이미 죽은 대상입니다.');
  }
  
  if (attacker.team === target.team) {
    throw new Error('같은 팀은 공격할 수 없습니다.');
  }
  
  // 공격력 계산: 공격력 + 주사위(1-20)
  const attackRoll = rollDice();
  let attackPower = attacker.stats.attack + attackRoll;
  
  // 공격 버프 적용
  if (attacker.buffs.attack_buff) {
    attackPower = Math.floor(attackPower * 1.5);
    addBattleLog(battle.id, 'action', `${attacker.name}의 공격력이 강화되었습니다!`);
  }
  
  addBattleLog(
    battle.id, 
    'action', 
    `${attacker.name}이(가) ${target.name}을(를) 공격합니다! (공격력 ${attacker.stats.attack} + 주사위 ${attackRoll} = ${attackPower})`
  );
  
  // 회피 체크 (회피 중인 경우)
  if (target.isDodging) {
    const dodgeRoll = rollDice();
    const dodgeValue = target.stats.agility + dodgeRoll;
    
    addBattleLog(
      battle.id,
      'action',
      `${target.name}의 회피 시도! (민첩성 ${target.stats.agility} + 주사위 ${dodgeRoll} = ${dodgeValue})`
    );
    
    if (dodgeValue >= attackPower) {
      addBattleLog(battle.id, 'action', `${target.name}이(가) 공격을 완전히 회피했습니다!`);
      return { hit: false, dodged: true };
    } else {
      addBattleLog(battle.id, 'action', `${target.name}의 회피가 실패했습니다.`);
    }
  }
  
  // 방어 중인 경우 방어값만큼 차감
  let finalDamage = attackPower;
  if (target.isDefending) {
    let defenseValue = target.stats.defense;
    
    // 방어 버프 적용
    if (target.buffs.defense_buff) {
      defenseValue = Math.floor(defenseValue * 1.5);
      addBattleLog(battle.id, 'action', `${target.name}의 방어력이 강화되었습니다!`);
    }
    
    finalDamage = Math.max(1, attackPower - defenseValue);
    
    addBattleLog(
      battle.id,
      'action',
      `${target.name}이(가) 방어 중입니다! (방어력 ${defenseValue}로 ${attackPower - finalDamage} 데미지 차감)`
    );
  }
  
  // 치명타 체크
  const critRoll = rollDice();
  const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
  const isCritical = critRoll >= critThreshold;
  
  if (isCritical) {
    finalDamage *= 2;
    addBattleLog(battle.id, 'action', `치명타! 데미지가 2배가 됩니다!`);
  }
  
  // 데미지 적용
  target.hp = Math.max(0, target.hp - finalDamage);
  
  addBattleLog(
    battle.id,
    'action',
    `${target.name}이(가) ${finalDamage} 데미지를 받았습니다! (남은 HP: ${target.hp}/${target.maxHp})`
  );
  
  // 사망 체크
  if (target.hp <= 0) {
    target.alive = false;
    addBattleLog(battle.id, 'system', `${target.name}이(가) 전투불능 상태가 되었습니다!`);
  }
  
  // 역공격 기회 제공 (방어했을 때만)
  if (target.isDefending && target.alive) {
    executeCounterAttack(battle, target, attacker);
  }
  
  return {
    hit: true,
    damage: finalDamage,
    isCritical: isCritical,
    targetHp: target.hp,
    targetAlive: target.alive
  };
}

// 역공격 실행
function executeCounterAttack(battle, defender, originalAttacker) {
  addBattleLog(battle.id, 'system', `${defender.name}에게 역공격 기회가 주어집니다!`);
  
  // 역공격 실행 (자동)
  const counterRoll = rollDice();
  const counterPower = defender.stats.attack + counterRoll;
  
  addBattleLog(
    battle.id,
    'action',
    `${defender.name}의 역공격! (공격력 ${defender.stats.attack} + 주사위 ${counterRoll} = ${counterPower})`
  );
  
  // 역공격 데미지 적용 (방어 불가)
  originalAttacker.hp = Math.max(0, originalAttacker.hp - counterPower);
  
  addBattleLog(
    battle.id,
    'action',
    `${originalAttacker.name}이(가) ${counterPower} 역공격 데미지를 받았습니다! (남은 HP: ${originalAttacker.hp}/${originalAttacker.maxHp})`
  );
  
  // 역공격으로 사망 체크
  if (originalAttacker.hp <= 0) {
    originalAttacker.alive = false;
    addBattleLog(battle.id, 'system', `${originalAttacker.name}이(가) 역공격으로 전투불능 상태가 되었습니다!`);
  }
}

// 방어 실행
function executeDefend(battle, player) {
  player.isDefending = true;
  player.isDodging = false;
  
  addBattleLog(
    battle.id,
    'action',
    `${player.name}이(가) 방어 자세를 취했습니다. (방어력: ${player.stats.defense}${player.buffs.defense_buff ? ' x1.5' : ''})`
  );
  
  return { action: 'defend', success: true };
}

// 회피 실행
function executeDodge(battle, player) {
  player.isDodging = true;
  player.isDefending = false;
  
  addBattleLog(battle.id, 'action', `${player.name}이(가) 회피 준비를 했습니다.`);
  
  return { action: 'dodge', success: true };
}

// 아이템 사용
function executeItem(battle, player, itemType, targetId) {
  // 인벤토리에서 아이템 확인
  const itemIndex = player.inventory.findIndex(item => item === itemType);
  if (itemIndex === -1) {
    throw new Error('해당 아이템을 보유하고 있지 않습니다.');
  }
  
  // 아이템 제거 (1회용)
  player.inventory.splice(itemIndex, 1);
  
  let result = {};
  
  switch (itemType) {
    case '공격 보정기':
      player.buffs.attack_buff = true;
      addBattleLog(
        battle.id,
        'action',
        `${player.name}이(가) 공격 보정기를 사용했습니다! (다음 공격력 1.5배)`
      );
      result = { success: true, effect: 'attack_buff' };
      break;
      
    case '방어 보정기':
      player.buffs.defense_buff = true;
      addBattleLog(
        battle.id,
        'action',
        `${player.name}이(가) 방어 보정기를 사용했습니다! (다음 방어력 1.5배)`
      );
      result = { success: true, effect: 'defense_buff' };
      break;
      
    case '디터니':
      const healTarget = targetId ? findPlayerInBattle(battle, targetId) : player;
      if (!healTarget || !healTarget.alive) {
        throw new Error('유효하지 않은 대상입니다.');
      }
      
      const healAmount = 10;
      const previousHp = healTarget.hp;
      healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healAmount);
      const actualHeal = healTarget.hp - previousHp;
      
      addBattleLog(
        battle.id,
        'action',
        `${player.name}이(가) ${healTarget.name}에게 디터니를 사용했습니다! (HP +${actualHeal})`
      );
      result = { success: true, effect: 'heal', healAmount: actualHeal };
      break;
      
    default:
      throw new Error('알 수 없는 아이템입니다.');
  }
  
  return result;
}

// 패스 실행
function executePass(battle, player) {
  addBattleLog(battle.id, 'action', `${player.name}이(가) 턴을 넘겼습니다.`);
  return { action: 'pass', success: true };
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
  
  // 실시간 브로드캐스트는 호출하는 곳에서 처리
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
    addBattleLog(battleId, 'system', `${winnerTeam.name} 팀이 승리했습니다!`);
  } else {
    addBattleLog(battleId, 'system', reason || '전투가 무승부로 종료되었습니다.');
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

// 팀 턴 종료 체크
function checkTeamTurnEnd(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'ongoing') return;
  
  const currentTeam = battle.teams[battle.currentTeam];
  const alivePlayers = currentTeam.players.filter(p => p.alive);
  const allActed = alivePlayers.every(p => p.hasActed);
  
  if (allActed) {
    endTeamTurn(battleId);
  }
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
    roundNumber: battle.roundNumber,
    turnNumber: battle.turnNumber,
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

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: '전투 서버가 정상 작동 중입니다.',
    timestamp: Date.now(),
    battles: battles.size
  });
});

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

// 플레이어 추가 API
app.post('/api/battles/:id/players', (req, res) => {
  try {
    const battleId = req.params.id;
    const { name, team, stats, inventory, imageUrl } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    const player = addPlayer(battleId, {
      name, team, stats, inventory, imageUrl
    });
    
    res.json({ success: true, player });
    broadcastBattleState(battleId);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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

// 전투 시작 API
app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    if (battle.status !== 'waiting') {
      return res.status(400).json({ error: '이미 시작된 전투입니다.' });
    }
    
    startBattle(battleId);
    res.json({ success: true, battle });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 강제 종료 API
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const battleId = req.params.id;
    const { winner } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({ error: '존재하지 않는 전투입니다.' });
    }
    
    endBattle(battleId, winner, '관리자가 강제 종료했습니다.');
    res.json({ success: true, message: '전투가 종료되었습니다.' });
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
  socket.on('spectatorAuth', ({ battleId, otp, spectatorName }) => {
    const battle = battles.get(battleId);
    if (!battle) {
      socket.emit('authError', '존재하지 않는 전투입니다.');
      return;
    }
    
    if (battle.otps.spectator !== otp) {
      socket.emit('authError', '잘못된 관전자 OTP입니다.');
      return;
    }
    
    spectatorConnections.set(socket.id, { 
      battleId, 
      role: 'spectator', 
      spectatorName: spectatorName || `관전자${Date.now()}` 
    });
    socket.emit('authSuccess', { role: 'spectator', battle });
    console.log(`[관전자인증] 소켓: ${socket.id}, 전투: ${battleId}`);
  });
  
  // 플레이어 준비 상태 토글
  socket.on('playerReady', () => {
    const playerInfo = playerSockets.get(socket.id);
    if (!playerInfo) return;
    
    const battle = battles.get(playerInfo.battleId);
    if (!battle) return;
    
    const player = findPlayerInBattle(battle, playerInfo.playerId);
    if (!player) return;
    
    player.isReady = !player.isReady;
    
    socket.emit('readySuccess', { isReady: player.isReady });
    broadcastBattleState(playerInfo.battleId);
  });
  
  // 플레이어 액션 처리
  socket.on('playerAction', (data) => {
    try {
      const playerInfo = playerSockets.get(socket.id);
      if (!playerInfo) {
        socket.emit('actionError', '인증되지 않은 사용자입니다.');
        return;
      }
      
      const battle = battles.get(playerInfo.battleId);
      if (!battle || battle.status !== 'ongoing') {
        socket.emit('actionError', '진행 중인 전투가 아닙니다.');
        return;
      }
      
      const player = findPlayerInBattle(battle, playerInfo.playerId);
      if (!player || !player.alive) {
        socket.emit('actionError', '행동할 수 없는 상태입니다.');
        return;
      }
      
      if (player.team !== battle.currentTeam) {
        socket.emit('actionError', '현재 당신의 팀 차례가 아닙니다.');
        return;
      }
      
      if (player.hasActed) {
        socket.emit('actionError', '이미 행동했습니다.');
        return;
      }
      
      // 액션 실행
      executePlayerAction(battle, player, data);
      player.hasActed = true;
      
      socket.emit('actionSuccess');
      broadcastBattleState(playerInfo.battleId);
      
      // 팀 턴 종료 체크
      checkTeamTurnEnd(playerInfo.battleId);
      
    } catch (error) {
      socket.emit('actionError', error.message);
    }
  });
  
  // 채팅 메시지
  socket.on('chatMessage', ({ message }) => {
    const playerInfo = playerSockets.get(socket.id);
    const adminInfo = adminConnections.get(socket.id);
    const spectatorInfo = spectatorConnections.get(socket.id);
    
    if (!playerInfo && !adminInfo && !spectatorInfo) return;
    
    let battleId, senderName, senderType;
    
    if (playerInfo) {
      const battle = battles.get(playerInfo.battleId);
      const player = findPlayerInBattle(battle, playerInfo.playerId);
      battleId = playerInfo.battleId;
      senderName = player ? player.name : '플레이어';
      senderType = 'player';
    } else if (adminInfo) {
      battleId = adminInfo.battleId;
      senderName = '관리자';
      senderType = 'admin';
    } else if (spectatorInfo) {
      battleId = spectatorInfo.battleId;
      senderName = spectatorInfo.spectatorName;
      senderType = 'spectator';
    }
    
    if (battleId && message && message.trim().length > 0) {
      addChatLog(battleId, senderName, message.trim(), senderType);
    }
  });
  
  // 응원 메시지 (관전자 전용)
  socket.on('cheerMessage', ({ message }) => {
    const spectatorInfo = spectatorConnections.get(socket.id);
    if (!spectatorInfo) return;
    
    const allowedCheers = ['힘내!', '지지마!', '이길 수 있어!', '포기하지 마!', '화이팅!', '대박!'];
    
    if (!allowedCheers.includes(message)) {
      socket.emit('chatError', '허용되지 않은 응원 메시지입니다.');
      return;
    }
    
    addChatLog(
      spectatorInfo.battleId,
      spectatorInfo.spectatorName,
      message,
      'spectator'
    );
  });
  
  // 하트비트
  socket.on('heartbeat', () => {
    connectionHeartbeats.set(socket.id, Date.now());
    socket.emit('heartbeat', { timestamp: Date.now() });
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
  console.log(`[전투서버] 헬스체크: http://localhost:${PORT}/api/health`);
});
