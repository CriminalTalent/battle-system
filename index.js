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
  path: "/socket.io"
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
  cb(ok ? null : new Error('이미지 형식만 허용됩니다.'), ok);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_UPLOAD_BYTES } });

// 정적 파일(프런트)
app.use(express.static(path.join(__dirname, '../battle-web/public')));
// 업로드 파일 정적 제공
app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: true }));

// 저장소
const battles = new Map();
const playerSockets = new Map();

// 상수
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

// 메시지
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

// 아이템
const ITEMS = {
  '공격 보정기': { code: 'ATK_MOD', desc: '다음 공격 피해 +2' },
  '방어 보정기': { code: 'DEF_MOD', desc: '다음으로 받는 공격 피해 -2' },
  '디터니':     { code: 'DESTINY', desc: '다음 공격 적중 시 치명타 확정' }
};

// 주사위
function rollD20() { return Math.floor(Math.random() * 20) + 1; }
function rollDamage(attack) { return (Math.floor(Math.random() * 6) + 1) + attack; }
function calculateInitiative(agility) { return rollD20() + agility; }
function checkHit(attackerLuck, defenderAgility) {
  const attackRoll = rollD20() + attackerLuck;
  const dodgeTarget = 10 + defenderAgility;
  return attackRoll >= dodgeTarget;
}
function checkCritical(luck) { return rollD20() >= (20 - Math.floor(luck / 2)); }

// 스탯 정규화
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

// 캐릭터
function createCharacter(playerId, name, stats, teamId, imageUrl = null, items = []) {
  return {
    id: playerId,
    name,
    teamId,
    hp: BASE_HP,
    maxHp: BASE_HP,
    stats: normalizeStats(stats),
    alive: true,
    hasActed: false,
    imageUrl: imageUrl || null,
    inventory: Array.isArray(items) ? items.slice() : [],
    buffs: { attackBonus: 0, defendBonus: 0, forceCrit: false, dodge: false }
  };
}

// 유틸
function genToken(prefix){ return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function genOTP(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }

// 전투
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
    this.turnTimeouts = new Map();
    this.battleLog = [];
    this.winner = null;

    this.tokens = { admin: null, player: null, spectator: null };
    this.otps = { admin: null, players: new Map(), spectators: new Set() };
    this.logged = { admin: false, players: new Set(), spectators: 0 };
  }

  addPlayer(playerId, name, teamId, stats, imageUrl, items) {
    if (this.phase !== 'lobby') return { success: false, error: MSG.battle_already_started };
    const team = this.teams[teamId];
    if (!team) return { success: false, error: MSG.invalid_team };
    if (team.length >= this.config.playersPerTeam) return { success: false, error: MSG.team_full };
    const character = createCharacter(playerId, name, stats, teamId, imageUrl, items);
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
    const timeoutId = setTimeout(() => { this.autoEndTurn(); }, TURN_TIMEOUT);
    this.turnTimeouts.set(this.currentTeam, timeoutId);
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

    // 회피 태세: d20+공격력 vs d20+민첩
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
    io.to(this.id).emit('battle-ended', { winner: this.winner, state: this.getState() });
    return this.winner;
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
      winner: this.winner,
      battleLog: this.battleLog,
      tokens: this.tokens ? { ...this.tokens } : undefined
    };
  }
}

// -------------------- REST API --------------------

// 상태
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', battles: battles.size, connections: io.engine.clientsCount });
});

// 이미지 업로드
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const publicUrl = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url: publicUrl, filename: req.file.filename });
});

// 배틀 생성
app.post('/api/battles', (req, res) => {
  const { mode = '1v1' } = req.body || {};
  if (!BATTLE_MODES[mode]) return res.status(400).json({ error: '잘못된 전투 모드입니다. (1v1|2v2|3v3|4v4)' });
  const battleId = Math.random().toString(36).substring(7).toUpperCase();
  const battle = new Battle(battleId, mode);
  battles.set(battleId, battle);
  res.json({ battleId, mode, state: battle.getState() });
});

// 조회
app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json(battle.getState());
});

// 팀 참가
app.post('/api/battles/:id/join', (req, res) => {
  const { playerId, playerName, teamId, stats, imageUrl, items } = req.body || {};
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const result = battle.addPlayer(playerId, playerName, teamId, stats, imageUrl, items);
  if (result.success) {
    io.to(req.params.id).emit('player-joined', { battleId: req.params.id, player: result.character, state: battle.getState() });
  }
  res.json(result);
});

// 전투 시작
app.post('/api/battles/:id/start', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  const result = battle.start();
  if (result.success) io.to(req.params.id).emit('battle-started', { battleId: req.params.id, state: battle.getState() });
  res.json(result);
});

// 액션
app.post('/api/battles/:id/action', (req, res) => {
  const { playerId, action } = req.body || {};
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  const result = battle.executeAction(playerId, action);
  if (result.success) {
    io.to(req.params.id).emit('action-executed', { battleId: req.params.id, action, result, state: battle.getState() });
    if (result.battleEnded) io.to(req.params.id).emit('battle-ended', { battleId: req.params.id, winner: result.winner, state: battle.getState() });
  }
  res.json(result);
});

// ---------- 링크/로그인(OTP) ----------
app.post('/api/admin/battles/:id/links', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  battle.tokens.admin     = genToken('adm');
  battle.tokens.player    = genToken('ply');
  battle.tokens.spectator = genToken('spc');
  battle.otps.admin = null;
  battle.otps.players = new Map();
  battle.otps.spectators = new Set();

  res.json({
    battleId: battle.id,
    adminUrl:     `/admin?token=${battle.tokens.admin}&battle=${battle.id}`,
    playerUrl:    `/play?token=${battle.tokens.player}&battle=${battle.id}`,
    spectatorUrl: `/watch?token=${battle.tokens.spectator}&battle=${battle.id}`,
    tokens: battle.tokens
  });
});

app.post('/api/admin/battles/:id/issue-otp', (req, res) => {
  const { role, name } = req.body || {};
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (!['admin','player','spectator'].includes(role)) return res.status(400).json({ error:'role은 admin|player|spectator' });

  const otp = genOTP();
  if (role === 'admin') battle.otps.admin = otp;
  else if (role === 'player') {
    if (!name) return res.status(400).json({ error:'player OTP는 name이 필요합니다.' });
    battle.otps.players.set(name, otp);
  } else battle.otps.spectators.add(otp);

  res.json({ ok:true, role, name: name || undefined, otp });
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
    battle.otps.admin = null; battle.logged.admin = true;
  } else if (role === 'player') {
    const v = battle.otps.players.get(name);
    if (!v || v !== otp) return res.status(401).json({ error:'OTP가 유효하지 않습니다.' });
    battle.otps.players.delete(name); battle.logged.players.add(name);
  } else {
    if (!battle.otps.spectators.has(otp)) return res.status(401).json({ error:'OTP가 유효하지 않습니다.' });
    battle.otps.spectators.delete(otp); battle.logged.spectators += 1;
  }

  res.json({ ok:true, role, name: name || undefined });
});

// -------------------- Socket.IO --------------------
io.on('connection', (socket) => {
  socket.on('join-battle', (data = {}) => {
    const { battleId, playerId } = data;
    if (!battleId) return;
    socket.join(battleId);
    if (playerId) playerSockets.set(playerId, socket.id);
    const battle = battles.get(battleId);
    if (battle) socket.emit('battle-state', battle.getState());
  });
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`Battle server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
