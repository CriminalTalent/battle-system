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
  pingInterval: 25000
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

const BATTLE_DURATION = 60 * 60 * 1000; // 1시간
const TURN_TIMEOUT   = 5  * 60 * 1000;  // 5분
const BASE_HP  = 100;
const STAT_MIN = 1;
const STAT_MAX = 5;

const BATTLE_MODES = {
  '1v1': { teamsCount: 2, playersPerTeam: 1 },
  '2v2': { teamsCount: 2, playersPerTeam: 2 },
  '3v3': { teamsCount: 2, playersPerTeam: 3 },
  '4v4': { teamsCount: 2, playersPerTeam: 4 }
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
  defensive_stance: (name)=>`${name}는 방어 태세를 취합니다.`,
  miss: (a,b)=>`${a}가 ${b}를 공격했지만 빗나갔습니다!`,
  attack: (a,b,damage,crit,elim)=>`${a}가 ${b}에게 ${damage} 피해를 입혔습니다${crit?' (치명타)':''}${elim?' (처치)':''}`,
  item_used: (name,item)=>`${name}가 ${item}을(를) 사용했습니다.`,
  item_not_found: '보유하지 않은 아이템입니다.',
  dodge_ready: (name)=>`${name}는 회피 태세를 취했습니다.`,
  dodge_success: (a,b)=>`${b}가 ${a}의 공격을 회피했습니다!`,
  dodge_fail: (a,b)=>`${b}의 회피가 실패했습니다.`,
  heal: (name,amount)=>`${name}가 ${amount} HP를 회복했습니다.`,
  buff_attack: (name)=>`${name}의 공격력이 강화되었습니다.`,
  buff_defense: (name)=>`${name}의 방어력이 강화되었습니다.`,
  team_wins: (team)=>`${team} 승리!`,
  turn_started: (team)=>`${team} 턴이 시작되었습니다.`,
  turn_ended: (team)=>`${team} 턴이 종료되었습니다.`,
  battle_timeout: '전투 시간 초과로 무승부입니다.',
  turn_timeout: (name)=>`${name}의 턴 시간이 초과되었습니다.`
};

function normalizeStats(stats = {}) {
  const out = { ...stats };
  out.attack  = Math.min(Math.max(out.attack  ?? 1, STAT_MIN), STAT_MAX);
  out.defense = Math.min(Math.max(out.defense ?? 1, STAT_MIN), STAT_MAX);
  out.agility = Math.min(Math.max(out.agility ?? 1, STAT_MIN), STAT_MAX);
  out.luck   = Math.min(Math.max(out.luck   ?? 1, STAT_MIN), STAT_MAX);
  return out;
}

function createCharacter(playerId, name, stats, teamId, imageUrl = null, items = {}, customHp = null) {
  const maxHp = customHp ? Math.min(Math.max(customHp, 1), 100) : BASE_HP;
  
  // 아이템을 개수 형태로 처리
  const inventory = [];
  if (items['공격 보정기'] > 0) {
    for (let i = 0; i < items['공격 보정기']; i++) {
      inventory.push('공격 보정기');
    }
  }
  if (items['방어 보정기'] > 0) {
    for (let i = 0; i < items['방어 보정기']; i++) {
      inventory.push('방어 보정기');
    }
  }
  if (items['디터니'] > 0) {
    for (let i = 0; i < items['디터니']; i++) {
      inventory.push('디터니');
    }
  }
  
  return {
    id: playerId,
    name,
    teamId,
    hp: maxHp,
    maxHp: maxHp,
    stats: normalizeStats(stats),
    alive: true,
    hasActed: false,
    imageUrl: imageUrl || null,
    inventory: inventory,
    buffs: { attackBonus: 0, defendBonus: 0, forceCrit: false, dodge: false }
  };
}

function genToken(prefix){ return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function genOTP(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }

// 관리자 토큰 검증 미들웨어
function verifyAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];
  const battleId = req.params.id;
  const battle = battles.get(battleId);
  
  if (!battle) {
    return res.status(404).json({ error: 'Battle not found' });
  }
  
  if (!token || token !== battle.tokens?.admin) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
  
  req.battle = battle;
  next();
}

// Battle 클래스
class Battle {
  constructor(id, mode = '1v1') {
    this.id = id;
    this.mode = mode;
    this.config = BATTLE_MODES[mode];
    this.phase = 'lobby';
    this.teams = { team1: [], team2: [] };
    this.currentTeam = 'team1';
    this.turnOrder = [];
    this.turnIndex = 0;
    this.startTime = null;
    this.endTime = null;
    this.turnStartTime = null;
    this.turnEndTime = null;
    this.turnTimeouts = new Map();
    this.battleLog = [];
    this.chatLog = [];
    this.winner = null;

    this.tokens = { admin: null, player: null, spectator: null };
    this.otps = { admin: null, players: new Map(), spectators: new Set() };
    this.logged = { admin: false, players: new Set(), spectators: new Map() };
    
    this.scheduleCleanup();
  }

  scheduleCleanup() {
    setTimeout(() => {
      if (battles.has(this.id)) {
        battles.delete(this.id);
        console.log(`[전투서버] 전투 자동 정리: ${this.id}`);
      }
    }, BATTLE_DURATION);
  }

  findPlayer(playerId) {
    return [...this.teams.team1, ...this.teams.team2].find(p => p.id === playerId);
  }

  getCurrentPlayer() {
    if (this.phase !== 'battle' || this.turnOrder.length === 0) return null;
    return this.turnOrder[this.turnIndex] || null;
  }

  addPlayer(playerId, name, stats, teamId, imageUrl = null, items = {}, customHp = null) {
    if (this.phase !== 'lobby') return { success: false, error: MSG.battle_already_started };
    if (!['team1', 'team2'].includes(teamId)) return { success: false, error: MSG.invalid_team };
    if (this.teams[teamId].length >= this.config.playersPerTeam) return { success: false, error: MSG.team_full };

    const character = createCharacter(playerId, name, stats, teamId, imageUrl, items, customHp);
    this.teams[teamId].push(character);
    
    this.addChatMessage('시스템', `${name}이 ${teamId === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들'}에 참가했습니다`, 'system');
    
    return { success: true, character, state: this.getState() };
  }

  start() {
    if (this.phase !== 'lobby') return { success: false, error: '이미 시작된 전투입니다' };

    const totalRequired = this.config.teamsCount * this.config.playersPerTeam;
    const totalPlayers = this.teams.team1.length + this.teams.team2.length;
    
    if (totalPlayers < totalRequired) {
      return { success: false, error: MSG.not_enough_players };
    }

    this.phase = 'battle';
    this.startTime = Date.now();
    
    // 턴 순서 결정 (민첩성 + 주사위)
    const allPlayers = [...this.teams.team1, ...this.teams.team2];
    this.turnOrder = allPlayers.sort((a, b) => {
      const aRoll = (a.stats.agility * 2) + Math.floor(Math.random() * 20) + 1;
      const bRoll = (b.stats.agility * 2) + Math.floor(Math.random() * 20) + 1;
      return bRoll - aRoll;
    });

    this.turnIndex = 0;
    this.resetAllActed();
    this.startTurn();

    return { success: true, state: this.getState() };
  }

  startTurn() {
    this.turnStartTime = Date.now();
    
    // 모든 플레이어가 행동했으면 새 라운드
    if (this.turnOrder.every(p => p.hasActed || !p.alive)) {
      this.resetAllActed();
      this.turnIndex = 0;
    }

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && currentPlayer.alive) {
      // 턴 타임아웃 설정
      if (this.turnTimeouts.has(currentPlayer.id)) {
        clearTimeout(this.turnTimeouts.get(currentPlayer.id));
      }
      
      const timeout = setTimeout(() => {
        this.addBattleLog('턴 시간 초과', MSG.turn_timeout(currentPlayer.name));
        this.executeAction(currentPlayer.id, { type: 'pass' });
      }, TURN_TIMEOUT);
      
      this.turnTimeouts.set(currentPlayer.id, timeout);
      this.addBattleLog('턴 시작', `${currentPlayer.name}의 턴이 시작되었습니다`);
    }
  }

  resetAllActed() {
    this.turnOrder.forEach(p => p.hasActed = false);
  }

  nextTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
    
    // 살아있는 플레이어 찾기
    let attempts = 0;
    while (attempts < this.turnOrder.length) {
      const currentPlayer = this.getCurrentPlayer();
      if (currentPlayer && currentPlayer.alive && !currentPlayer.hasActed) {
        this.startTurn();
        return;
      }
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      attempts++;
    }
    
    // 모든 플레이어가 행동했거나 죽었으면 새 라운드
    this.resetAllActed();
    this.turnIndex = 0;
    this.startTurn();
  }

  executeAction(playerId, action) {
    if (this.phase !== 'battle') return { success: false, error: '전투가 시작되지 않았습니다' };

    const player = this.findPlayer(playerId);
    if (!player) return { success: false, error: MSG.target_not_found };
    if (!player.alive) return { success: false, error: MSG.player_dead };
    if (player.hasActed) return { success: false, error: MSG.player_already_acted };

    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== playerId) {
      return { success: false, error: MSG.not_your_teams_turn };
    }

    // 턴 타임아웃 해제
    if (this.turnTimeouts.has(playerId)) {
      clearTimeout(this.turnTimeouts.get(playerId));
      this.turnTimeouts.delete(playerId);
    }

    let result = { success: false, error: MSG.invalid_action };

    switch (action.type) {
      case 'attack':
        result = this.handleAttack(player, action.targetId);
        break;
      case 'defend':
        result = this.handleDefend(player);
        break;
      case 'dodge':
        result = this.handleDodge(player);
        break;
      case 'item':
        result = this.handleItem(player, action.itemName);
        break;
      case 'pass':
        result = this.handlePass(player);
        break;
    }

    if (result.success) {
      player.hasActed = true;
      this.nextTurn();
      
      // 승부 판정
      const battleResult = this.checkWinner();
      if (battleResult.ended) {
        this.endBattle(battleResult.winner);
        return { ...result, battleEnded: true, winner: battleResult.winner };
      }
    }

    return result;
  }

  handleAttack(attacker, targetId) {
    const target = this.findPlayer(targetId);
    if (!target) return { success: false, error: MSG.target_not_found };
    if (!target.alive) return { success: false, error: MSG.target_dead };
    if (attacker.teamId === target.teamId) return { success: false, error: MSG.cannot_attack_teammate };

    // 회피 체크
    if (target.buffs.dodge) {
      const dodgeRoll = Math.random() * 100;
      const dodgeChance = target.stats.agility * 10 + target.stats.luck * 5;
      
      if (dodgeRoll < dodgeChance) {
        target.buffs.dodge = false;
        this.addBattleLog('회피 성공', MSG.dodge_success(attacker.name, target.name));
        return { success: true, result: '회피 성공' };
      } else {
        target.buffs.dodge = false;
        this.addBattleLog('회피 실패', MSG.dodge_fail(attacker.name, target.name));
      }
    }

    // 명중 체크
    const hitRoll = Math.random() * 100;
    const hitChance = 85 + (attacker.stats.agility - target.stats.agility) * 2;
    
    if (hitRoll >= hitChance) {
      this.addBattleLog('공격 빗나감', MSG.miss(attacker.name, target.name));
      return { success: true, result: '공격 빗나감' };
    }

    // 데미지 계산
    let damage = Math.max(1, attacker.stats.attack + attacker.buffs.attackBonus - target.stats.defense + target.buffs.defendBonus);
    
    // 치명타 체크
    const critRoll = Math.random() * 100;
    const critChance = attacker.stats.luck * 2 + (attacker.buffs.forceCrit ? 100 : 0);
    const isCrit = critRoll < critChance || attacker.buffs.forceCrit;
    
    if (isCrit) {
      damage = Math.floor(damage * 1.5);
      attacker.buffs.forceCrit = false;
    }

    // 방어 태세 보너스
    if (target.buffs.defendBonus > 0) {
      damage = Math.max(1, damage - target.buffs.defendBonus);
      target.buffs.defendBonus = 0;
    }

    // 데미지 적용
    target.hp = Math.max(0, target.hp - damage);
    const eliminated = target.hp === 0;
    if (eliminated) target.alive = false;

    // 공격 버프 리셋
    attacker.buffs.attackBonus = 0;

    this.addBattleLog('공격', MSG.attack(attacker.name, target.name, damage, isCrit, eliminated));
    return { success: true, result: `${damage} 데미지${isCrit ? ' (치명타)' : ''}${eliminated ? ' (처치)' : ''}` };
  }

  handleDefend(player) {
    player.buffs.defendBonus = Math.floor(player.stats.defense / 2) + 2;
    this.addBattleLog('방어', MSG.defensive_stance(player.name));
    return { success: true, result: '방어 태세' };
  }

  handleDodge(player) {
    player.buffs.dodge = true;
    this.addBattleLog('회피 준비', MSG.dodge_ready(player.name));
    return { success: true, result: '회피 준비' };
  }

  handleItem(player, itemName) {
    const itemIndex = player.inventory.indexOf(itemName);
    if (itemIndex === -1) return { success: false, error: MSG.item_not_found };

    player.inventory.splice(itemIndex, 1);

    switch (itemName) {
      case '공격 보정기':
        player.buffs.attackBonus = 3;
        break;
      case '방어 보정기':
        player.buffs.defendBonus = 3;
        break;
      case '디터니':
        const healAmount = 20;
        player.hp = Math.min(player.maxHp, player.hp + healAmount);
        this.addBattleLog('회복', MSG.heal(player.name, healAmount));
        break;
    }

    this.addBattleLog('아이템 사용', MSG.item_used(player.name, itemName));
    return { success: true, result: `${itemName} 사용` };
  }

  handlePass(player) {
    this.addBattleLog('턴 패스', `${player.name}이 턴을 넘겼습니다`);
    return { success: true, result: '턴 패스' };
  }

  checkWinner() {
    const team1Alive = this.teams.team1.filter(p => p.alive);
    const team2Alive = this.teams.team2.filter(p => p.alive);

    if (team1Alive.length === 0 && team2Alive.length === 0) {
      return { ended: true, winner: 'draw' };
    } else if (team1Alive.length === 0) {
      return { ended: true, winner: 'team2' };
    } else if (team2Alive.length === 0) {
      return { ended: true, winner: 'team1' };
    }

    return { ended: false, winner: null };
  }

  endBattle(winner) {
    this.phase = 'ended';
    this.winner = winner;
    this.endTime = Date.now();
    
    // 모든 타임아웃 정리
    this.turnTimeouts.forEach(timeout => clearTimeout(timeout));
    this.turnTimeouts.clear();

    let winnerText = '';
    switch (winner) {
      case 'team1':
        winnerText = '불사조 기사단';
        break;
      case 'team2':
        winnerText = '죽음을 먹는 자들';
        break;
      case 'draw':
        winnerText = '무승부';
        break;
    }

    this.addBattleLog('전투 종료', MSG.team_wins(winnerText));
    this.addChatMessage('시스템', `전투가 종료되었습니다. 승자: ${winnerText}`, 'system');
  }

  forceEnd(winner = null) {
    if (winner) {
      this.endBattle(winner);
    } else {
      // 자동 승부 판정 (HP 합계 기준)
      const team1Hp = this.teams.team1.reduce((sum, p) => sum + (p.alive ? p.hp : 0), 0);
      const team2Hp = this.teams.team2.reduce((sum, p) => sum + (p.alive ? p.hp : 0), 0);
      
      if (team1Hp > team2Hp) {
        this.endBattle('team1');
      } else if (team2Hp > team1Hp) {
        this.endBattle('team2');
      } else {
        this.endBattle('draw');
      }
    }
    return { success: true, winner: this.winner };
  }

  addBattleLog(type, message) {
    this.battleLog.push({
      id: crypto.randomBytes(4).toString('hex'),
      type,
      message,
      timestamp: Date.now()
    });
    
    // 로그 제한 (최근 100개)
    if (this.battleLog.length > 100) {
      this.battleLog = this.battleLog.slice(-100);
    }
  }

  addChatMessage(sender, message, senderType = 'player') {
    const chatMessage = {
      id: crypto.randomBytes(4).toString('hex'),
      sender,
      message,
      senderType,
      timestamp: Date.now()
    };
    
    this.chatLog.push(chatMessage);
    
    // 채팅 제한 (최근 200개)
    if (this.chatLog.length > 200) {
      this.chatLog = this.chatLog.slice(-200);
    }
    
    return chatMessage;
  }

  getState() {
    const currentPlayer = this.getCurrentPlayer();
    return {
      id: this.id,
      mode: this.mode,
      phase: this.phase,
      teams: this.teams,
      currentTeam: currentPlayer ? currentPlayer.teamId : null,
      currentPlayer: currentPlayer,
      turnOrder: this.turnOrder,
      turnIndex: this.turnIndex,
      startTime: this.startTime,
      endTime: this.endTime,
      turnStartTime: this.turnStartTime,
      battleLog: this.battleLog.slice(-50), // 최근 50개만
      chatLog: this.chatLog.slice(-100), // 최근 100개만
      winner: this.winner
    };
  }
}

// API 엔드포인트들
app.post('/api/battles', (req, res) => {
  const { mode = '1v1' } = req.body || {};
  if (!BATTLE_MODES[mode]) return res.status(400).json({ error: '지원하지 않는 모드입니다' });

  const battleId = crypto.randomBytes(3).toString('hex').toUpperCase();
  const battle = new Battle(battleId, mode);
  battles.set(battleId, battle);
  
  console.log(`[전투서버] 전투 생성: ${battleId} (${mode})`);
  res.json({ success: true, battleId, state: battle.getState() });
});

app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json({ success: true, state: battle.getState() });
});

app.post('/api/battles/:id/players', upload.single('image'), (req, res) => {
  const { name, attack = 3, defense = 3, agility = 3, luck = 3, team, hp } = req.body || {};
  const items = {
    '공격 보정기': parseInt(req.body['공격 보정기'] || 0),
    '방어 보정기': parseInt(req.body['방어 보정기'] || 0),
    '디터니': parseInt(req.body['디터니'] || 0)
  };
  
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const playerId = crypto.randomBytes(4).toString('hex');
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const customHp = hp ? parseInt(hp) : null;
  const stats = { 
    attack: parseInt(attack), 
    defense: parseInt(defense), 
    agility: parseInt(agility), 
    luck: parseInt(luck) 
  };

  const result = battle.addPlayer(playerId, name, stats, team, imageUrl, items, customHp);
  
  if (result.success) {
    console.log(`[전투서버] 플레이어 추가: ${name} → ${team} (${req.params.id})`);
    io.to(req.params.id).emit('player-joined', { battleId: req.params.id, player: result.character, state: battle.getState() });
  }
  res.json(result);
});

// 임시 호환성 라우트 - admin.html의 잘못된 API 호출 처리
app.post('/api/admin/battles/:id/join', upload.single('image'), (req, res) => {
  const { name, attack = 3, defense = 3, agility = 3, luck = 3, team, hp } = req.body || {};
  const items = {
    '공격 보정기': parseInt(req.body['공격 보정기'] || 0),
    '방어 보정기': parseInt(req.body['방어 보정기'] || 0),
    '디터니': parseInt(req.body['디터니'] || 0)
  };
  
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const playerId = crypto.randomBytes(
