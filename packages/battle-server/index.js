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
  else cb(new Error('이미지 형식만 허용됩니다.'));
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
  dodge_fail: (a,b)=>`${b}의 회피가 실패했습니다. 공격이 적중합니다.`
};

const ITEMS = {
  '공격 보정기': { code: 'ATK_MOD', desc: '다음 공격 피해 +2' },
  '방어 보정기': { code: 'DEF_MOD', desc: '다음으로 받는 공격 피해 -2' },
  '디터니':     { code: 'DESTINY', desc: '다음 공격 적중 시 치명타 확정' }
};

// 주사위 및 스탯 유틸리티
function rollD20() { return Math.floor(Math.random() * 20) + 1; }
function rollDamage(attack) { return (Math.floor(Math.random() * 6) + 1) + attack; }
function calculateInitiative(agility) { return rollD20() + agility; }
function checkHit(attackerLuck, defenderAgility) {
  const attackRoll = rollD20() + attackerLuck;
  const dodgeTarget = 10 + defenderAgility;
  return attackRoll >= dodgeTarget;
}
function checkCritical(luck) { return rollD20() >= (20 - Math.floor(luck / 2)); }

function normalizeStats(stats) {
  const s = stats || {};
  const map = { 공격력:'attack', 방어:'defense', 민첩:'agility', 행운:'luck',
                attack:'attack', defense:'defense', agility:'agility', luck:'luck' };
  const out = { attack: 1, defense: 1, agility: 1, luck: 1 };
  Object.keys(s).forEach(k => { const key = map[k]; if (key) out[key] = s[k]; });
  out.attack = Math.min(Math.max(out.attack ?? 1, STAT_MIN), STAT_MAX);
  out.defense = Math.min(Math.max(out.defense ?? 1, STAT_MIN), STAT_MAX);
  out.agility = Math.min(Math.max(out.agility ?? 1, STAT_MIN), STAT_MAX);
  out.luck   = Math.min(Math.max(out.luck   ?? 1, STAT_MIN), STAT_MAX);
  return out;
}

function createCharacter(playerId, name, stats, teamId, imageUrl = null, items = [], customHp = null) {
  const maxHp = customHp ? Math.min(Math.max(customHp, 1), 100) : BASE_HP;
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
    inventory: Array.isArray(items) ? items.slice() : [],
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
    }, 2 * 60 * 60 * 1000);
  }

  addPlayer(playerId, name, teamId, stats, imageUrl, items, customHp) {
    if (this.phase !== 'lobby') return { success: false, error: MSG.battle_already_started };
    const team = this.teams[teamId];
    if (!team) return { success: false, error: MSG.invalid_team };
    if (team.length >= this.config.playersPerTeam) return { success: false, error: MSG.team_full };
    const character = createCharacter(playerId, name, stats, teamId, imageUrl, items, customHp);
    team.push(character);
    return { success: true, character };
  }

  canStart() {
    return this.teams.team1.length === this.config.playersPerTeam &&
           this.teams.team2.length === this.config.playersPerTeam;
  }

  start() {
    if (!this.canStart()) return { success: false, error: MSG.not_enough_players };
    this.phase = 'battle';
    this.startTime = Date.now();
    this.endTime = this.startTime + BATTLE_DURATION;

    const all = [...this.teams.team1, ...this.teams.team2];
    const initiatives = all.map(p => ({ player: p, initiative: calculateInitiative(p.stats.agility) }))
                           .sort((a,b)=>b.initiative - a.initiative);
    this.turnOrder = initiatives.map(i => i.player);

    this.battleLog.push({
      type: 'battle_start',
      timestamp: Date.now(),
      initiatives: initiatives.map(i => ({ player: i.player.name, roll: i.initiative }))
    });

    this.startTeamTurn();

    setTimeout(() => {
      if (this.phase === 'battle' || this.phase === 'paused') this.endBattleByTimeout();
    }, BATTLE_DURATION);

    return { success: true };
  }

  startTeamTurn() {
    const current = this.teams[this.currentTeam];
    current.forEach(p => { if (p.alive) p.hasActed = false; });
    this.turnStartTime = Date.now();
    this.turnEndTime = this.turnStartTime + TURN_TIMEOUT;
    
    const timeoutId = setTimeout(() => { this.autoEndTurn(); }, TURN_TIMEOUT);
    this.turnTimeouts.set(this.currentTeam, timeoutId);
    
    const teamName = this.currentTeam === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
    this.addChatMessage('전투 시스템', `${teamName} 턴 시작 (5분)`, 'system');
  }

  executeAction(playerId, action) {
    if (this.phase !== 'battle') return { success: false, error: '현재 전투 진행 단계가 아닙니다.' };
    const player = this.findPlayer(playerId);
    if (!player) return { success: false, error: '플레이어를 찾을 수 없습니다.' };
    if (player.teamId !== this.currentTeam) return { success: false, error: MSG.not_your_teams_turn };
    if (!player.alive) return { success: false, error: MSG.player_dead };
    if (player.hasActed) return { success: false, error: MSG.player_already_acted };

    let result = null;
    switch (action.type) {
      case 'attack':   result = this.executeAttack(player, action.targetId); break;
      case 'defend':   result = this.executeDefend(player); break;
      case 'use_item': result = this.executeUseItem(player, action.itemName); break;
      case 'dodge':    result = this.executeDodge(player); break;
      case 'pass':     result = { success: true, description: `${player.name}는 행동을 패스했습니다.` }; break;
      default: return { success: false, error: MSG.invalid_action };
    }

    if (result.success) {
      player.hasActed = true;
      this.battleLog.push({ type: action.type, timestamp: Date.now(), actor: player.name,
        target: action.targetId, result: result.description, damage: result.damage });

      if (this.checkBattleEnd()) return { ...result, battleEnded: true, winner: this.winner };
      if (this.checkTeamTurnComplete()) this.endTeamTurn();
    }
    return result;
  }

  executeAttack(attacker, targetId) {
    const target = this.findPlayer(targetId);
    if (!target) return { success: false, error: MSG.target_not_found };
    if (!target.alive) return { success: false, error: MSG.target_dead };
    if (target.teamId === attacker.teamId) return { success: false, error: MSG.cannot_attack_teammate };

    if (target.buffs.dodge) {
      target.buffs.dodge = false;
      const atkRoll = rollD20() + attacker.stats.attack;
      const defRoll = rollD20() + target.stats.agility;
      if (defRoll >= atkRoll) {
        attacker.buffs.attackBonus = 0;
        attacker.buffs.forceCrit = false;
        return { success: true, description: MSG.dodge_success(attacker.name, target.name), damage: 0, hit: false };
      }
    }

    const hit = checkHit(attacker.stats.luck, target.stats.agility);
    if (!hit) {
      attacker.buffs.attackBonus = 0;
      attacker.buffs.forceCrit = false;
      return { success: true, description: MSG.miss(attacker.name, target.name), damage: 0, hit: false };
    }

    let damage = rollDamage(attacker.stats.attack);
    if (attacker.buffs.attackBonus) damage += attacker.buffs.attackBonus;
    let isCritical = attacker.buffs.forceCrit ? true : checkCritical(attacker.stats.luck);
    if (isCritical) damage *= 2;

    if (target.buffs.defendBonus) {
      damage = Math.max(0, damage - target.buffs.defendBonus);
      target.buffs.defendBonus = 0;
    }

    damage = Math.max(1, damage - target.stats.defense);

    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) target.alive = false;

    attacker.buffs.attackBonus = 0;
    attacker.buffs.forceCrit = false;

    return {
      success: true,
      description: MSG.attack(attacker.name, target.name, damage, isCritical, !target.alive),
      damage, hit: true, critical: isCritical, targetEliminated: !target.alive
    };
  }

  executeDefend(player) {
    player.buffs.defendBonus = Math.max(player.buffs.defendBonus, 1);
    return { success: true, description: MSG.defensive_stance(player.name) };
  }

  executeUseItem(player, itemName) {
    if (!Array.isArray(player.inventory) || !player.inventory.length)
      return { success: false, error: MSG.item_not_found };
    const idx = player.inventory.findIndex(n => n === itemName);
    if (idx === -1) return { success: false, error: MSG.item_not_found };

    player.inventory.splice(idx, 1);
    const item = ITEMS[itemName];
    if (!item) return { success: false, error: '알 수 없는 아이템입니다.' };

    switch (item.code) {
      case 'ATK_MOD':  player.buffs.attackBonus += 2; break;
      case 'DEF_MOD':  player.buffs.defendBonus += 2; break;
      case 'DESTINY':  player.buffs.forceCrit = true; break;
      default: return { success: false, error: '아이템 효과가 정의되지 않았습니다.' };
    }
    return { success: true, description: MSG.item_used(player.name, itemName) };
  }

  executeDodge(player) {
    player.buffs.dodge = true;
    return { success: true, description: MSG.dodge_ready(player.name) };
  }

  checkTeamTurnComplete() {
    const current = this.teams[this.currentTeam];
    return current.filter(p => p.alive).every(p => p.hasActed);
  }

  endTeamTurn() {
    const timeoutId = this.turnTimeouts.get(this.currentTeam);
    if (timeoutId) { clearTimeout(timeoutId); this.turnTimeouts.delete(this.currentTeam); }
    this.currentTeam = this.currentTeam === 'team1' ? 'team2' : 'team1';
    this.startTeamTurn();
  }

  addChatMessage(sender, message, senderType = 'system') {
    const chatEntry = {
      id: crypto.randomBytes(8).toString('hex'),
      sender,
      message,
      senderType,
      timestamp: Date.now()
    };
    this.chatLog.push(chatEntry);
    
    if (this.chatLog.length > 100) {
      this.chatLog = this.chatLog.slice(-100);
    }
    
    io.to(this.id).emit('chat-message', { battleId: this.id, message: chatEntry });
    
    return chatEntry;
  }

  getRemainingTurnTime() {
    if (!this.turnStartTime || this.phase !== 'battle') return 0;
    const elapsed = Date.now() - this.turnStartTime;
    return Math.max(0, TURN_TIMEOUT - elapsed);
  }

  autoEndTurn() {
    const current = this.teams[this.currentTeam];
    current.forEach(p => {
      if (p.alive && !p.hasActed) {
        p.hasActed = true;
        this.battleLog.push({ type: 'auto_pass', timestamp: Date.now(), actor: p.name, reason: 'timeout' });
      }
    });
    this.endTeamTurn();
  }

  checkBattleEnd() {
    const team1Alive = this.teams.team1.some(p => p.alive);
    const team2Alive = this.teams.team2.some(p => p.alive);

    if (!team1Alive || !team2Alive) {
      this.phase = 'ended';
      this.winner = team1Alive ? 'team1' : team2Alive ? 'team2' : 'draw';
      this.endTime = Date.now();
      this.battleLog.push({ type: 'ended_by_elimination', timestamp: Date.now(), winner: this.winner });
      
      const winnerName = this.winner === 'team1' ? '불사조 기사단' : 
                        this.winner === 'team2' ? '죽음을 먹는 자들' : '무승부';
      this.addChatMessage('전투 시스템', `전투 종료! 승자: ${winnerName}`, 'system');
      
      io.to(this.id).emit('battle-ended', { winner: this.winner, state: this.getState() });
      return true;
    }
    return false;
  }

  endBattleByTimeout() {
    const team1HP = this.teams.team1.reduce((sum, p) => sum + (p.alive ? p.hp : 0), 0);
    const team2HP = this.teams.team2.reduce((sum, p) => sum + (p.alive ? p.hp : 0), 0);

    this.phase = 'ended';
    this.endTime = Date.now();

    if (team1HP > team2HP) this.winner = 'team1';
    else if (team2HP > team1HP) this.winner = 'team2';
    else this.winner = 'draw';

    this.battleLog.push({ type: 'battle_timeout', timestamp: Date.now(), team1HP, team2HP, winner: this.winner });
    
    const winnerName = this.winner === 'team1' ? '불사조 기사단' : 
                      this.winner === 'team2' ? '죽음을 먹는 자들' : '무승부';
    this.addChatMessage('전투 시스템', `시간 초과! HP로 승부 결정: ${winnerName}`, 'system');
    
    io.to(this.id).emit('battle-ended', { winner: this.winner, state: this.getState() });
    return this.winner;
  }

  forceEnd(winner = null) {
    if (this.phase === 'ended') return { success: false, error: '이미 종료된 전투입니다.' };

    this.phase = 'ended';
    this.endTime = Date.now();

    if (winner && ['team1','team2','draw'].includes(winner)) {
      this.winner = winner;
    } else {
      const team1HP = this.teams.team1.reduce((s,p)=>s+(p.alive?p.hp:0),0);
      const team2HP = this.teams.team2.reduce((s,p)=>s+(p.alive?p.hp:0),0);
      if (team1HP > team2HP) this.winner = 'team1';
      else if (team2HP > team1HP) this.winner = 'team2';
      else this.winner = 'draw';
    }

    this.battleLog.push({ type: 'force_end', timestamp: Date.now(), winner: this.winner });
    
    const winnerName = this.winner === 'team1' ? '불사조 기사단' : 
                      this.winner === 'team2' ? '죽음을 먹는 자들' : '무승부';
    this.addChatMessage('전투 시스템', `관리자에 의해 전투가 강제 종료되었습니다. 승자: ${winnerName}`, 'system');
    
    io.to(this.id).emit('battle-ended', { winner: this.winner, state: this.getState() });
    return { success: true, winner: this.winner };
  }

  findPlayer(playerId) {
    const all = [...this.teams.team1, ...this.teams.team2];
    return all.find(p => p.id === playerId);
  }

  getState() {
    return {
      id: this.id,
      mode: this.mode,
      phase: this.phase,
      teams: this.teams,
      currentTeam: this.currentTeam,
      turnOrder: this.turnOrder.map(p => ({ id: p.id, name: p.name })),
      startTime: this.startTime,
      endTime: this.endTime,
      turnStartTime: this.turnStartTime,
      turnEndTime: this.turnEndTime,
      remainingTurnTime: this.getRemainingTurnTime(),
      winner: this.winner,
      battleLog: this.battleLog,
      chatLog: this.chatLog,
      tokens: this.tokens ? { ...this.tokens } : undefined,
      spectatorCount: this.logged.spectators.size || 0
    };
  }
}

// REST API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Pyxis 전투 서버 가동 중', 
    battles: battles.size, 
    connections: io.engine.clientsCount,
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const publicUrl = `/uploads/${req.file.filename}`;
  console.log(`[전투서버] 이미지 업로드: ${req.file.filename}`);
  res.json({ ok: true, url: publicUrl, filename: req.file.filename });
});

app.post('/api/battles', (req, res) => {
  const { mode = '1v1' } = req.body || {};
  if (!BATTLE_MODES[mode]) return res.status(400).json({ error: '잘못된 전투 모드입니다. (1v1|2v2|3v3|4v4)' });
  const battleId = Math.random().toString(36).substring(7).toUpperCase();
  const battle = new Battle(battleId, mode);
  battles.set(battleId, battle);
  console.log(`[전투서버] 전투 생성: ${battleId} (${mode})`);
  res.json({ battleId, mode, state: battle.getState() });
});

app.get('/api/battles', (_req, res) => {
  const list = Array.from(battles.values()).map(b => ({
    id: b.id, mode: b.mode, phase: b.phase, winner: b.winner,
    team1: b.teams.team1.length, team2: b.teams.team2.length,
    created: b.startTime || Date.now()
  }));
  res.json({ battles: list });
});

app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json(battle.getState());
});

// 플레이어/관전자용 상태 조회 (토큰 없이)
app.get('/api/battles/:id/state', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json(battle.getState());
});

app.post('/api/battles/:id/join', (req, res) => {
  const { playerId, playerName, teamId, stats, imageUrl, items, customHp } = req.body || {};
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const result = battle.addPlayer(playerId, playerName, teamId, stats, imageUrl, items, customHp);
  if (result.success) {
    console.log(`[전투서버] 플레이어 참가: ${playerName} -> ${teamId} (${req.params.id})`);
    battle.addChatMessage('전투 시스템', `${playerName}이 ${teamId === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들'}에 참가했습니다`, 'system');
    io.to(req.params.id).emit('player-joined', { battleId: req.params.id, player: result.character, state: battle.getState() });
  }
  res.json(result);
});

app.post('/api/battles/:id/start', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  const result = battle.start();
  if (result.success) {
    console.log(`[전투서버] 전투 시작: ${req.params.id}`);
    battle.addChatMessage('전투 시스템', '전투가 시작되었습니다! 전사들이여, 전투에 임하라!', 'system');
    io.to(req.params.id).emit('battle-started', { battleId: req.params.id, state: battle.getState() });
  }
  res.json(result);
});

app.post('/api/battles/:id/chat', (req, res) => {
  const { sender, message, senderType } = req.body || {};
  const battle = battles.get(req.params.id);
  
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (!sender || !message) return res.status(400).json({ error: 'sender와 message가 필요합니다' });
  if (message.length > 200) return res.status(400).json({ error: '메시지는 200자 이하여야 합니다' });
  
  const chatEntry = battle.addChatMessage(sender, message, senderType || 'player');
  res.json({ success: true, message: chatEntry });
});

app.post('/api/battles/:id/action', (req, res) => {
  const { playerId, action } = req.body || {};
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const result = battle.executeAction(playerId, action);
  if (result.success) {
    console.log(`[전투서버] 행동 실행: ${action.type} by ${playerId} (${req.params.id})`);
    io.to(req.params.id).emit('action-executed', { battleId: req.params.id, action, result, state: battle.getState() });
    if (result.battleEnded) {
      console.log(`[전투서버] 전투 종료: ${req.params.id}, 승자: ${result.winner}`);
      io.to(req.params.id).emit('battle-ended', { battleId: req.params.id, winner: result.winner, state: battle.getState() });
    }
  }
  res.json(result);
});

app.post('/api/admin/battles/:id/links', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  battle.tokens.admin     = genToken('adm');
  battle.tokens.player    = genToken('ply');
  battle.tokens.spectator = genToken('spc');
  battle.otps.admin = null;
  battle.otps.players = new Map();
  battle.otps.spectators = new Set();

  console.log(`[전투서버] 링크 생성: ${req.params.id}`);

  res.json({
    battleId: battle.id,
    adminUrl:     `/admin?token=${battle.tokens.admin}&battle=${battle.id}`,
    playerUrl:    `/play?token=${battle.tokens.player}&battle=${battle.id}`,
    spectatorUrl: `/watch?token=${battle.tokens.spectator}&battle=${battle.id}`,
    tokens: battle.tokens
  });
});

app.post('/api/admin/battles/:id/issue-otp', verifyAdminToken, (req, res) => {
  const { role, name } = req.body || {};
  const battle = req.battle;
  
  if (!['admin','player','spectator'].includes(role)) {
    return res.status(400).json({ error: 'role은 admin|player|spectator' });
  }

  const otp = genOTP();
  
  if (role === 'admin') {
    battle.otps.admin = otp;
  } else if (role === 'player') {
    if (!name) return res.status(400).json({ error: 'player OTP는 name이 필요합니다.' });
    battle.otps.players.set(name, otp);
  } else {
    battle.otps.spectators.add(otp);
  }

  console.log(`[전투서버] OTP 발급: ${role} (${name || 'N/A'}) - ${battle.id}`);
  res.json({ ok: true, role, name: name || undefined, otp });
});

app.post('/api/admin/battles/:id/join', verifyAdminToken, (req, res) => {
  const { playerId, playerName, teamId, stats, imageUrl, items, customHp } = req.body || {};
  const battle = req.battle;
  
  const result = battle.addPlayer(playerId, playerName, teamId, stats, imageUrl, items, customHp);
  if (result.success) {
    console.log(`[전투서버] 관리자 플레이어 추가: ${playerName} -> ${teamId} (${battle.id})`);
    battle.addChatMessage('전투 시스템', `${playerName}이 관리자에 의해 ${teamId === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들'}에 추가되었습니다`, 'system');
    io.to(req.params.id).emit('player-joined', { 
      battleId: req.params.id, 
      player: result.character, 
      state: battle.getState() 
    });
  }
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { battleId, role, name, otp, token } = req.body || {};
  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (!['admin','player','spectator'].includes(role)) return res.status(400).json({ error:'role은 admin|player|spectator' });

  const want = battle.tokens[role];
  if (!want || token !== want) return res.status(401).json({ error:'링크 토큰이 유효하지 않습니다.' });

  if (role === 'admin') {
    if (!battle.otps.admin || otp !== battle.otps.admin) return res.status(401).json({ error:'OTP가 유효하지 않습니다.' });
    battle.otps.admin = null; 
    battle.logged.admin = true;
    console.log(`[전투서버] 관리자 로그인: ${battleId}`);
  } else if (role === 'player') {
    if (!name) return res.status(400).json({ error: 'player 로그인은 name이 필요합니다.' });
    const v = battle.otps.players.get(name);
    if (!v || v !== otp) return res.status(401).json({ error:'OTP가 유효하지 않습니다.' });
    battle.otps.players.delete(name); 
    battle.logged.players.add(name);
    console.log(`[전투서버] 플레이어 로그인: ${name} (${battleId})`);
  } else {
    if (!battle.otps.spectators.has(otp)) return res.status(401).json({ error:'OTP가 유효하지 않습니다.' });
    const spectatorName = name || `관전자${Math.random().toString(36).slice(2,6)}`;
    battle.logged.spectators.set(spectatorName, { loginTime: Date.now(), otp });
    console.log(`[전투서버] 관전자 로그인: ${spectatorName} (${battleId})`);
  }

  res.json({ ok:true, role, name: name || undefined });
});

app.get('/api/admin/battles/:id/state', verifyAdminToken, (req, res) => {
  res.json(req.battle.getState());
});

app.post('/api/admin/battles/:id/force-end', verifyAdminToken, (req, res) => {
  const { winner } = req.body || {};
  const result = req.battle.forceEnd(winner);
  console.log(`[전투서버] 전투 강제 종료: ${req.params.id}, 승자: ${result.winner}`);
  res.status(result.success ? 200 : 400).json(result);
});

app.delete('/api/admin/battles/:id', verifyAdminToken, (req, res) => {
  console.log(`[전투서버] 전투 삭제: ${req.params.id}`);
  battles.delete(req.params.id);
  res.json({ ok: true });
});

// Socket.IO 이벤트 처리
io.on('connection', (socket) => {
  console.log(`[전투서버] 클라이언트 연결: ${socket.id}`);
  
  socket.on('join-battle', (data = {}) => {
    const { battleId, playerId, role } = data;
    if (!battleId) return;
    socket.join(battleId);
    
    if (role === 'spectator') {
      if (!spectatorConnections.has(battleId)) {
        spectatorConnections.set(battleId, new Set());
      }
      spectatorConnections.get(battleId).add(socket.id);
    }
    
    if (playerId) playerSockets.set(playerId, socket.id);
    const battle = battles.get(battleId);
    if (battle) {
      socket.emit('battle-state', battle.getState());
      console.log(`[전투서버] ${role || '클라이언트'} 전투 룸 입장: ${battleId}`);
    }
  });
  
  socket.on('send-chat', (data = {}) => {
    const { battleId, sender, message, senderType } = data;
    const battle = battles.get(battleId);
    if (battle && sender && message && message.length <= 200) {
      battle.addChatMessage(sender, message, senderType || 'player');
    }
  });
  
  socket.on('chat-message', (data = {}) => {
    const { battleId, sender, message, senderType } = data;
    const battle = battles.get(battleId);
    if (battle && sender && message && message.length <= 200) {
      battle.addChatMessage(sender, message, senderType || 'player');
    }
  });
  
  socket.on('send-chat', (data = {}) => {
    const { battleId, sender, message, senderType } = data;
    const battle = battles.get(battleId);
    if (battle && sender && message && message.length <= 200) {
      battle.addChatMessage(sender, message, senderType || 'player');
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`[전투서버] 클라이언트 연결 해제: ${socket.id}`);
    
    for (const [battleId, connections] of spectatorConnections.entries()) {
      if (connections.has(socket.id)) {
        connections.delete(socket.id);
        if (connections.size === 0) {
          spectatorConnections.delete(battleId);
        }
      }
    }
    
    for (const [playerId, socketId] of playerSockets.entries()) {
      if (socketId === socket.id) {
        playerSockets.delete(playerId);
        break;
      }
    }
  });
});

app.use((err, req, res, next) => {
  console.error('[전투서버] API 오류:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log('=====================================');
  console.log('      PYXIS 전투 서버 가동 중        ');
  console.log('=====================================');
  console.log(`서버: http://localhost:${PORT}`);
  console.log(`관리자: http://localhost:${PORT}/admin.html`);
  console.log(`플레이어: http://localhost:${PORT}/play.html`);
  console.log(`관전자: http://localhost:${PORT}/watch.html`);
  console.log('=====================================');
});
