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
['admin.html','play.html','watch.html'].forEach(f=>{
  const p = path.join(publicPath,f);
  console.log(fs.existsSync(p) ? `[전투서버] 파일 확인: ${f}` : `[전투서버] 파일 누락: ${f} - ${p}`);
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
app.get('/', (_req, res) => res.redirect('/admin.html'));
app.get('/admin', (_req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/play',  (_req, res) => res.sendFile(path.join(publicPath, 'play.html')));
app.get('/watch', (_req, res) => res.sendFile(path.join(publicPath, 'watch.html')));

app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: true }));

// 저장소 및 상수
const battles = new Map();
const playerSockets = new Map();
const spectatorConnections = new Map();
const adminConnections = new Map();
const connectionHeartbeats = new Map();

const BATTLE_DURATION = 60 * 60 * 1000; // 1시간
const TURN_TIMEOUT   = 5 * 60 * 1000;   // 5분
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
  attack: (a, b, damage, crit, elim) => `${a}가 ${b}에게 ${damage} 피해를 입혔습니다${crit ? ' (치명타)' : ''}${elim ? ' (처치)' : ''}`,
  item_used: (name, item) => `${name}가 ${item}을(를) 사용했습니다.`,
  item_not_found: '보유하지 않은 아이템입니다.',
  item_failed: (name, item) => `${name}의 ${item} 사용이 실패했습니다.`,
  dodge_ready: (name) => `${name}는 회피 태세를 취했습니다.`,
  dodge_success: (a, b) => `${b}가 ${a}의 공격을 회피했습니다!`,
  dodge_fail: (a, b) => `${b}의 회피가 실패했습니다.`,
  heal: (name, amount) => `${name}가 ${amount} HP를 회복했습니다.`,
  buff_attack: (name) => `${name}의 공격력이 강화되었습니다.`,
  buff_defense: (name) => `${name}의 방어력이 강화되었습니다.`,
  team_wins: (team) => `${team} 승리!`,
  turn_started: (team) => `${team} 턴이 시작되었습니다.`,
  turn_ended: (team) => `${team} 턴이 종료되었습니다.`,
  battle_timeout: '전투 시간 초과',
  turn_timeout: (team) => `${team}의 턴이 시간 초과되어 자동 방어가 적용됩니다.`,
  initiative_roll: (team, roll) => `${team} 민첩성 굴림: ${roll}`,
  team_goes_first: (team) => `${team}가 선공합니다!`,
  all_ready: '모든 플레이어가 준비 완료했습니다.',
  passed: (name) => `${name}는 행동을 패스했습니다.`
};

// 스탯 정규화
function normalizeStats(stats = {}) {
  const out = { ...stats };
  out.attack  = Math.min(Math.max(out.attack  ?? 3, STAT_MIN), STAT_MAX);
  out.defense = Math.min(Math.max(out.defense ?? 3, STAT_MIN), STAT_MAX);
  out.agility = Math.min(Math.max(out.agility ?? 3, STAT_MIN), STAT_MAX);
  out.luck    = Math.min(Math.max(out.luck    ?? 3, STAT_MIN), STAT_MAX);
  return out;
}
function rollDice() { return Math.floor(Math.random() * 20) + 1; } // 1-20
function pct(n){ return Math.random() < n; } // n in [0..1]

// 캐릭터 생성
function createCharacter(playerId, name, stats, teamId, imageUrl = null, items = {}, customHp = null) {
  const maxHp = customHp ? parseInt(customHp) : BASE_HP;
  const normalizedStats = normalizeStats(stats);

  // 아이템 배열
  const inventory = [];
  if (items['공격 보정기'] > 0) { for (let i=0;i<items['공격 보정기'];i++) inventory.push('공격 보정기'); }
  if (items['방어 보정기'] > 0) { for (let i=0;i<items['방어 보정기'];i++) inventory.push('방어 보정기'); }
  if (items['디터니'] > 0)     { for (let i=0;i<items['디터니'];i++)     inventory.push('디터니'); }

  return {
    id: playerId,
    name,
    maxHp,
    hp: maxHp,
    stats: normalizedStats,
    teamId,
    imageUrl,
    inventory,
    alive: true,
    hasActed: false,
    defensiveBonus: 0,
    evasionReady: false,
    tempBuffs: {},
    lastAction: null,
    ready: false,
    joinedAt: Date.now()
  };
}

class Battle {
  constructor(battleId, mode) {
    this.id = battleId;
    this.mode = mode;
    this.status = 'waiting'; // waiting, ongoing, ended
    this.teams = {
      team1: { players: [], name: '불사조 기사단' },
      team2: { players: [], name: '죽음을 먹는 자들' }
    };
    this.currentTeam = 'team1';
    this.currentTurn = 1;
    this.turnTimeoutId = null;
    this.battleTimeoutId = null;
    this.battleLog = [];
    this.chatLog = [];
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.winner = null;
    this.initiativeRolls = {};
    this.maxPlayers = BATTLE_MODES[mode]?.teamsCount * BATTLE_MODES[mode]?.playersPerTeam || 2;
    this.spectatorCount = 0;
  }

  addPlayer(playerId, name, stats, teamId, imageUrl, items, customHp) {
    if (this.status !== 'waiting') throw new Error(MSG.battle_already_started);
    if (!['team1','team2'].includes(teamId)) throw new Error(MSG.invalid_team);

    const team = this.teams[teamId];
    const maxPerTeam = BATTLE_MODES[this.mode]?.playersPerTeam || 1;
    if (team.players.length >= maxPerTeam) throw new Error(MSG.team_full);

    const all = [...this.teams.team1.players, ...this.teams.team2.players];
    if (all.some(p => p.name === name)) throw new Error('같은 이름의 플레이어가 이미 존재합니다.');

    const ch = createCharacter(playerId, name, stats, teamId, imageUrl, items, customHp);
    team.players.push(ch);
    this.addLog('system', `${name}님이 ${team.name}에 참가했습니다.`);
    return ch;
  }

  rollTeamInitiative() {
    const t1 = this.teams.team1.players.reduce((s,p)=>s+p.stats.agility,0) + rollDice();
    const t2 = this.teams.team2.players.reduce((s,p)=>s+p.stats.agility,0) + rollDice();
    this.addLog('system', MSG.initiative_roll(this.teams.team1.name, t1));
    this.addLog('system', MSG.initiative_roll(this.teams.team2.name, t2));
    this.initiativeRolls = { team1: t1, team2: t2 };
    if (t1 >= t2) { this.currentTeam = 'team1'; this.addLog('system', MSG.team_goes_first(this.teams.team1.name)); }
    else          { this.currentTeam = 'team2'; this.addLog('system', MSG.team_goes_first(this.teams.team2.name)); }
  }

  allPlayersReady() {
    const all = [...this.teams.team1.players, ...this.teams.team2.players];
    return all.length >= 2 && all.every(p => p.ready);
  }

  startBattle() {
    const n = this.teams.team1.players.length + this.teams.team2.players.length;
    if (n < 2) throw new Error(MSG.not_enough_players);

    this.status = 'ongoing';
    this.startedAt = Date.now();
    this.rollTeamInitiative();
    this.addLog('system', '전투가 시작되었습니다!');
    this.addLog('system', MSG.turn_started(this.teams[this.currentTeam].name));

    // 전투 제한 시간(타임업 시 총 HP 합산 승패)
    this.battleTimeoutId = setTimeout(() => {
      const res = this.decideWinnerByHp();
      const message = res.type === 'draw'
        ? `${MSG.battle_timeout}로 무승부입니다.`
        : `${MSG.battle_timeout}. 총 HP 합산 결과 ${this.teams[res.winner].name} 승리!`;
      this.endBattle(res.type === 'draw' ? null : res.winner, message);
    }, BATTLE_DURATION);

    this.startTurn();
  }

  // 총 HP 합산 승부
  decideWinnerByHp() {
    const sumHp = teamKey => this.teams[teamKey].players.reduce((s,p)=>s + Math.max(0,p.hp), 0);
    const h1 = sumHp('team1'), h2 = sumHp('team2');
    if (h1 === h2) return { type:'draw' };
    return { type:'win', winner: h1 > h2 ? 'team1' : 'team2' };
  }

  startTurn() {
    if (this.status !== 'ongoing') return;
    if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId);

    this.teams[this.currentTeam].players.forEach(player => {
      player.hasActed = false;
      player.defensiveBonus = 0;
      player.evasionReady = false;
      Object.keys(player.tempBuffs).forEach(k => {
        if (player.tempBuffs[k] <= 0) delete player.tempBuffs[k];
        else player.tempBuffs[k]--;
      });
    });

    // 5분 타임아웃 → 미행동자 자동 방어 후 턴 진행
    this.turnTimeoutId = setTimeout(() => this.handleTurnTimeout(), TURN_TIMEOUT);
  }

  handleTurnTimeout() {
    this.addLog('system', MSG.turn_timeout(this.teams[this.currentTeam].name));
    const teamPlayers = this.teams[this.currentTeam].players.filter(p=>p.alive && !p.hasActed);
    teamPlayers.forEach(p => {
      // 자동 방어 적용
      p.hasActed = true;
      p.lastAction = 'defend';
      p.defensiveBonus = p.stats.defense;
      this.addLog('action', MSG.defensive_stance(p.name));
    });
    this.nextTurn();
  }

  nextTurn() {
    if (this.status !== 'ongoing') return;
    this.addLog('system', MSG.turn_ended(this.teams[this.currentTeam].name));
    this.currentTeam = this.currentTeam === 'team1' ? 'team2' : 'team1';
    this.currentTurn++;

    if (this.checkWinCondition()) return;

    this.addLog('system', MSG.turn_started(this.teams[this.currentTeam].name));
    this.startTurn();
  }

  checkWinCondition() {
    const alive1 = this.teams.team1.players.filter(p => p.alive).length;
    const alive2 = this.teams.team2.players.filter(p => p.alive).length;

    if (alive1 === 0 && alive2 === 0) {
      this.endBattle(null, '무승부입니다.');
      return true;
    } else if (alive1 === 0) {
      this.endBattle('team2', MSG.team_wins(this.teams.team2.name));
      return true;
    } else if (alive2 === 0) {
      this.endBattle('team1', MSG.team_wins(this.teams.team1.name));
      return true;
    }
    return false;
  }

  endBattle(winner, message) {
    this.status = 'ended';
    this.winner = winner;
    this.endedAt = Date.now();
    if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId);
    if (this.battleTimeoutId) clearTimeout(this.battleTimeoutId);
    this.addLog('system', message);
  }

  executeAction(playerId, action, targetId = null, item = null) {
    if (this.status !== 'ongoing') throw new Error('전투가 진행 중이 아닙니다.');

    const player = this.findPlayer(playerId);
    if (!player) throw new Error('플레이어를 찾을 수 없습니다.');
    if (!player.alive) throw new Error(MSG.player_dead);
    if (player.teamId !== this.currentTeam) throw new Error(MSG.not_your_teams_turn);
    if (player.hasActed) throw new Error(MSG.player_already_acted);

    switch (action) {
      case 'attack': return this.executeAttack(player, targetId);
      case 'defend': return this.executeDefend(player);
      case 'evade':  return this.executeEvade(player);
      case 'item':   return this.executeItem(player, item);
      case 'pass':   return this.executePass(player);
      default: throw new Error(MSG.invalid_action);
    }
  }

  executeAttack(attacker, targetId) {
    const target = this.findPlayer(targetId);
    if (!target) throw new Error(MSG.target_not_found);
    if (!target.alive) throw new Error(MSG.target_dead);
    if (target.teamId === attacker.teamId) throw new Error(MSG.cannot_attack_teammate);

    attacker.hasActed = true;
    attacker.lastAction = 'attack';

    // 공격 계산: 공격력 + 주사위(1-20) - 상대 방어력
    const attackPower = attacker.stats.attack + (attacker.tempBuffs.attack || 0);
    const attackRoll  = rollDice();
    const totalAttack = attackPower + attackRoll;

    // 명중/회피
    const hitRoll   = attacker.stats.luck   + rollDice();
    const evadeRoll = target.stats.agility  + rollDice();

    if (target.evasionReady && evadeRoll >= hitRoll) {
      this.addLog('action', MSG.dodge_success(attacker.name, target.name));
      return { success: true, dodged: true };
    } else if (target.evasionReady) {
      this.addLog('action', MSG.dodge_fail(attacker.name, target.name));
    }
    if (!target.evasionReady && hitRoll < evadeRoll) {
      this.addLog('action', MSG.miss(attacker.name, target.name));
      return { success: true, missed: true };
    }

    // 방어력
    const defensePower = target.stats.defense + target.defensiveBonus + (target.tempBuffs.defense || 0);
    let damage = Math.max(1, totalAttack - defensePower);

    // 치명타: 주사위(1-20) ≥ (20 - 행운/2)
    const critRoll = rollDice();
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCritical = critRoll >= critThreshold;
    if (isCritical) damage *= 2;

    // 적용
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) target.alive = false;

    const eliminated = !target.alive;
    this.addLog('action', MSG.attack(attacker.name, target.name, damage, isCritical, eliminated));

    setTimeout(() => this.checkWinCondition(), 50);
    return { success: true, damage, isCritical, eliminated, targetHp: target.hp };
  }

  executeDefend(player) {
    player.hasActed = true;
    player.lastAction = 'defend';
    // 방어: 민첩 + 주사위(1-20) - 상대 공격수치 → 기본 방어
    // 효과는 1턴 방어력 2배(=기본 방어력 추가)로 단순화
    player.defensiveBonus = player.stats.defense; // 1턴 2배 효과
    this.addLog('action', MSG.defensive_stance(player.name));
    return { success: true };
  }

  executeEvade(player) {
    player.hasActed = true;
    player.lastAction = 'evade';
    player.evasionReady = true;
    this.addLog('action', MSG.dodge_ready(player.name));
    return { success: true };
  }

  executePass(player) {
    player.hasActed = true;
    player.lastAction = 'pass';
    this.addLog('action', MSG.passed(player.name));
    return { success: true };
  }

  executeItem(player, itemName) {
    if (!itemName) throw new Error('아이템을 선택해주세요.');
    const idx = player.inventory.indexOf(itemName);
    if (idx === -1) throw new Error(MSG.item_not_found);

    player.hasActed = true;
    player.lastAction = 'item';
    // 사용 시도하면 즉시 소모
    player.inventory.splice(idx, 1);

    switch (itemName) {
      case '공격 보정기': {
        // 성공확률 10% (실패해도 소모)
        const ok = pct(0.10);
        this.addLog('action', MSG.item_used(player.name, itemName));
        if (ok) {
          player.tempBuffs.attack = (player.tempBuffs.attack || 0) + player.stats.attack;
          this.addLog('action', MSG.buff_attack(player.name));
          return { success: true, item: itemName, applied: true };
        } else {
          this.addLog('action', MSG.item_failed(player.name, itemName));
          return { success: true, item: itemName, applied: false };
        }
      }
      case '방어 보정기': {
        const ok = pct(0.10);
        this.addLog('action', MSG.item_used(player.name, itemName));
        if (ok) {
          player.tempBuffs.defense = (player.tempBuffs.defense || 0) + player.stats.defense;
          this.addLog('action', MSG.buff_defense(player.name));
          return { success: true, item: itemName, applied: true };
        } else {
          this.addLog('action', MSG.item_failed(player.name, itemName));
          return { success: true, item: itemName, applied: false };
        }
      }
      case '디터니': {
        // 확정 회복 10
        const heal = 10;
        player.hp = Math.min(player.maxHp, player.hp + heal);
        this.addLog('action', MSG.item_used(player.name, itemName));
        this.addLog('action', MSG.heal(player.name, heal));
        return { success: true, item: itemName, healed: heal, hp: player.hp };
      }
      default:
        throw new Error('알 수 없는 아이템입니다.');
    }
  }

  markReady(playerId) {
    const p = this.findPlayer(playerId);
    if (!p) throw new Error('플레이어를 찾을 수 없습니다.');
    p.ready = true;
    this.addLog('system', `${p.name} 준비 완료`);
    return p;
  }

  findPlayer(playerId) {
    for (const team of Object.values(this.teams)) {
      const player = team.players.find(p => p.id === playerId);
      if (player) return player;
    }
    return null;
  }

  addLog(type, message) { this.battleLog.push({ type, message, timestamp: Date.now(), turn: this.currentTurn }); }
  addChatMessage(sender, message, senderType = 'player') {
    const chatEntry = { sender, message, senderType, timestamp: Date.now() };
    this.chatLog.push(chatEntry);
    return chatEntry;
  }

  getState() {
    return {
      id: this.id,
      mode: this.mode,
      status: this.status,
      teams: this.teams,
      currentTeam: this.currentTeam,
      currentTurn: this.currentTurn,
      battleLog: this.battleLog,
      chatLog: this.chatLog,
      initiativeRolls: this.initiativeRolls,
      maxPlayers: this.maxPlayers,
      winner: this.winner,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt
    };
  }
  getSpectatorState() {
    const state = this.getState();
    ['team1','team2'].forEach(k => state.teams[k].players.forEach(p => { delete p.inventory; }));
    return state;
  }
}

// REST API
app.post('/api/battles', (req, res) => {
  try {
    const battleId = crypto.randomBytes(6).toString('hex').toUpperCase();
    const { mode = '1v1' } = req.body;
    if (!BATTLE_MODES[mode]) return res.status(400).json({ error: '지원하지 않는 전투 모드입니다.' });
    const battle = new Battle(battleId, mode);
    battles.set(battleId, battle);
    console.log(`[전투서버] 새 전투 생성: ${battleId} (${mode})`);
    res.json({ success: true, battleId, mode, maxPlayers: battle.maxPlayers });
  } catch (error) {
    console.error('[전투서버] 전투 생성 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  res.json({ success: true, state: battle.getState() });
});

app.post('/api/battles/:id/players', upload.single('image'), (req, res) => {
  try {
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

    const stats = { attack: parseInt(attack), defense: parseInt(defense), agility: parseInt(agility), luck: parseInt(luck) };
    const character = battle.addPlayer(playerId, name, stats, team, imageUrl, items, customHp);

    broadcastBattleUpdate(req.params.id);
    res.json({ success: true, playerId, character });
  } catch (error) {
    console.error('[전투서버] 플레이어 추가 실패:', error);
    res.status(400).json({ error: error.message });
  }
});

// 플레이어 준비 완료
app.post('/api/battles/:id/ready', (req, res) => {
  try {
    const { playerId } = req.body || {};
    const battle = battles.get(req.params.id);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });

    const p = battle.markReady(playerId);
    broadcastBattleUpdate(req.params.id);

    if (battle.allPlayersReady()) {
      battle.addLog('system', MSG.all_ready);
      broadcastBattleUpdate(req.params.id);
    }
    res.json({ success: true, ready: true, player: { id: p.id, name: p.name } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/battles/:id/actions', (req, res) => {
  try {
    const { action, playerId, targetId, item } = req.body;
    const battle = battles.get(req.params.id);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });

    const result = battle.executeAction(playerId, action, targetId, item);
    broadcastBattleUpdate(req.params.id);

    const currentTeamPlayers = battle.teams[battle.currentTeam].players.filter(p => p.alive);
    const actedPlayers = currentTeamPlayers.filter(p => p.hasActed);
    if (actedPlayers.length === currentTeamPlayers.length) {
      setTimeout(() => {
        battle.nextTurn();
        broadcastBattleUpdate(req.params.id);
      }, 1000);
    }

    res.json({ success: true, result, battleState: battle.getState() });
  } catch (error) {
    console.error('[전투서버] 액션 실행 실패:', error);
    res.status(400).json({ error: error.message });
  }
});

// 관리자 API
app.post('/api/admin/battles/:id/start', (req, res) => {
  try {
    const battle = battles.get(req.params.id);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });
    battle.startBattle();
    broadcastBattleUpdate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post('/api/admin/battles/:id/end', (req, res) => {
  try {
    const { winner } = req.body;
    const battle = battles.get(req.params.id);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });

    const winnerName = winner ? battle.teams[winner]?.name : null;
    battle.endBattle(winner, winnerName ? MSG.team_wins(winnerName) : '관리자에 의해 종료되었습니다.');
    broadcastBattleUpdate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post('/api/admin/battles/:id/next-turn', (req, res) => {
  try {
    const battle = battles.get(req.params.id);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });
    battle.nextTurn();
    broadcastBattleUpdate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 토큰/OTP (간단)
const tokens = new Map();
const otps = new Map();

app.post('/api/admin/battles/:id/links', (req, res) => {
  const battleId = req.params.id;
  const adminToken = crypto.randomBytes(16).toString('hex');
  const playerToken = crypto.randomBytes(16).toString('hex');
  const spectatorToken = crypto.randomBytes(16).toString('hex');

  tokens.set(adminToken, { type: 'admin', battleId });
  tokens.set(playerToken, { type: 'player', battleId });
  tokens.set(spectatorToken, { type: 'spectator', battleId });

  res.json({ success: true, tokens: { admin: adminToken, player: playerToken, spectator: spectatorToken } });
});

app.post('/api/admin/battles/:id/issue-otp', (req, res) => {
  const { role, playerName } = req.body;
  const otp = Math.random().toString(36).substring(2, 8).toUpperCase();
  otps.set(otp, { role, battleId: req.params.id, playerName, expiresAt: Date.now() + 10*60*1000 });
  res.json({ success: true, otp });
});

app.post('/api/auth/login', (req, res) => {
  const { battleId, otp, role, playerName } = req.body;
  const o = otps.get(otp);
  if (!o || o.expiresAt < Date.now() || o.battleId !== battleId || o.role !== role) {
    return res.status(401).json({ error: '유효하지 않은 OTP입니다.' });
  }
  otps.delete(otp);
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, { type: role, battleId, playerName, createdAt: Date.now() });
  res.json({ success: true, token });
});

// 실시간 브로드캐스트
function broadcastBattleUpdate(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  const state = battle.getState();
  const spectatorState = battle.getSpectatorState();

  io.to(`battle_${battleId}_players`).emit('battle-state', { battleId, state });
  io.to(`battle_${battleId}_admin`).emit('battle-state', { battleId, state });
  io.to(`battle_${battleId}_spectators`).emit('battle-state', { battleId, state: spectatorState });

  io.to(battleId).emit('battle-update', { battleId, state: spectatorState });
}
function broadcastToRoom(battleId, event, data) {
  io.to(battleId).emit(event, { battleId, ...data });
}

// 관전자 응원 화이트리스트
const SPECTATOR_CHEERS = new Set([
  '응원합니다', '힘내세요', '잘 싸웠다', '다음 턴 기대합니다', '최고예요'
]);

// Socket.IO
io.on('connection', (socket) => {
  console.log(`[전투서버] 소켓 연결: ${socket.id}`);
  connectionHeartbeats.set(socket.id, Date.now());

  socket.on('heartbeat', () => {
    connectionHeartbeats.set(socket.id, Date.now());
    socket.emit('heartbeat-ack', { timestamp: Date.now() });
  });

  // 관리자
  socket.on('join-admin', (data) => {
    const { battleId } = data || {};
    if (!battleId) return;
    socket.join(battleId);
    socket.join(`battle_${battleId}_admin`);
    socket.battleId = battleId;
    socket.role = 'admin';
    adminConnections.set(socket.id, { battleId });
    const battle = battles.get(battleId);
    if (battle) socket.emit('battle-state', { battleId, state: battle.getState() });
  });

  // 플레이어
  socket.on('join-player', (data) => {
    const { battleId, playerId, name } = data || {};
    if (!battleId || !playerId) return;
    socket.join(battleId);
    socket.join(`battle_${battleId}_players`);
    socket.battleId = battleId;
    socket.playerId = playerId;
    socket.userName = name;
    socket.role = 'player';
    playerSockets.set(socket.id, { battleId, playerId, name });
    const battle = battles.get(battleId);
    if (battle) {
      socket.emit('battle-state', { battleId, state: battle.getState() });
      socket.to(battleId).emit('player-connected', { playerId, name, message: `${name}님이 연결되었습니다.` });
    }
  });

  // 관전자
  socket.on('join-spectator', (data) => {
    const { battleId, name } = data || {};
    if (!battleId) return;
    socket.join(battleId);
    socket.join(`battle_${battleId}_spectators`);
    socket.battleId = battleId;
    socket.userName = name || '익명';
    socket.role = 'spectator';

    if (!spectatorConnections.has(battleId)) spectatorConnections.set(battleId, new Set());
    spectatorConnections.get(battleId).add(socket.id);

    const battle = battles.get(battleId);
    if (battle) {
      battle.spectatorCount = spectatorConnections.get(battleId).size;
      socket.emit('battle-state', { battleId, state: battle.getSpectatorState() });
      socket.to(battleId).emit('spectator-joined', { name: socket.userName, count: battle.spectatorCount, message: `관전자 ${socket.userName}님이 입장했습니다.` });
      broadcastBattleUpdate(battleId);
    }
  });

  // 채팅
  socket.on('send-chat', (data) => {
    const { battleId, message, senderType = 'player' } = data || {};
    const battle = battles.get(battleId);
    if (!battle || !message || message.length > 200) return;

    // 관전자 제한: 화이트리스트 멘트만 허용
    if (senderType === 'spectator') {
      if (!SPECTATOR_CHEERS.has(message)) return;
    }

    const filteredMessage = message.replace(/[욕설패턴]/g, '***');
    const chatEntry = battle.addChatMessage(socket.userName || '익명', filteredMessage, senderType);
    io.to(battleId).emit('chat-message', { battleId, message: chatEntry });
  });

  // 액션
  socket.on('execute-action', (data) => {
    try {
      const { battleId, action, playerId, targetId, item } = data;
      const battle = battles.get(battleId);
      if (!battle) return socket.emit('error', { message: 'Battle not found' });

      const result = battle.executeAction(playerId, action, targetId, item);
      broadcastToRoom(battleId, 'action-result', { playerId, action, result, timestamp: Date.now() });
      broadcastBattleUpdate(battleId);

      const currentTeamPlayers = battle.teams[battle.currentTeam].players.filter(p => p.alive);
      const actedPlayers = currentTeamPlayers.filter(p => p.hasActed);
      if (actedPlayers.length === currentTeamPlayers.length) {
        setTimeout(() => {
          battle.nextTurn();
          broadcastBattleUpdate(battleId);
          broadcastToRoom(battleId, 'turn-changed', { newTeam: battle.currentTeam, turn: battle.currentTurn, message: MSG.turn_started(battle.teams[battle.currentTeam].name) });
        }, 1200);
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // 상태 동기화
  socket.on('sync-state', (data) => {
    const { battleId } = data || {};
    const battle = battles.get(battleId);
    if (battle) {
      if (socket.role === 'spectator') socket.emit('battle-state', { battleId, state: battle.getSpectatorState() });
      else socket.emit('battle-state', { battleId, state: battle.getState() });
    }
  });

  socket.on('disconnect', () => {
    connectionHeartbeats.delete(socket.id);
    const battleId = socket.battleId;

    if (playerSockets.has(socket.id)) {
      const info = playerSockets.get(socket.id);
      playerSockets.delete(socket.id);
      if (battleId) socket.to(battleId).emit('player-disconnected', { playerId: socket.playerId, name: socket.userName, message: `${socket.userName}님이 연결을 해제했습니다.` });
    }

    if (battleId && spectatorConnections.has(battleId)) {
      const spectators = spectatorConnections.get(battleId);
      if (spectators.has(socket.id)) {
        spectators.delete(socket.id);
        if (spectators.size === 0) spectatorConnections.delete(battleId);
        const battle = battles.get(battleId);
        if (battle) {
          battle.spectatorCount = spectators.size;
          socket.to(battleId).emit('spectator-left', { name: socket.userName, count: battle.spectatorCount, message: `관전자 ${socket.userName}님이 퇴장했습니다.` });
          broadcastBattleUpdate(battleId);
        }
      }
    }

    if (adminConnections.has(socket.id)) adminConnections.delete(socket.id);
  });
});

// 주기적 정리
setInterval(() => {
  const now = Date.now();
  for (const [otp, data] of otps.entries()) if (data.expiresAt < now) otps.delete(otp);
  for (const [token, data] of tokens.entries()) if (now - (data.createdAt || 0) > 24 * 60 * 60 * 1000) tokens.delete(token);
  for (const [socketId, last] of connectionHeartbeats.entries()) if (now - last > 2 * HEARTBEAT_INTERVAL) connectionHeartbeats.delete(socketId);
  for (const [battleId, battle] of battles.entries()) if (now - battle.createdAt > 24 * 60 * 60 * 1000) { battles.delete(battleId); console.log(`[전투서버] 오래된 전투 삭제: ${battleId}`); }
}, 60000);

// 하트비트 브로드캐스트
setInterval(() => { io.emit('heartbeat-request', { timestamp: Date.now() }); }, HEARTBEAT_INTERVAL);

// 서버 시작
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[전투서버] 서버 시작됨 - 포트 ${PORT}`);
  console.log(`[전투서버] 관리자 페이지: http://localhost:${PORT}/admin`);
  console.log(`[전투서버] 플레이어 페이지: http://localhost:${PORT}/play`);
  console.log(`[전투서버] 관전자 페이지: http://localhost:${PORT}/watch`);
  console.log('[전투서버] 실시간 스트리밍 시스템 활성화');
});

// 우아한 종료
process.on('SIGTERM', () => {
  console.log('[전투서버] SIGTERM 신호 수신, 서버 종료 중...');
  for (const [battleId, battle] of battles.entries()) {
    if (battle.status === 'ongoing') {
      const res = battle.decideWinnerByHp();
      const message = res.type === 'draw' ? '서버 점검, 총 HP 동률로 무승부' : `서버 점검, 총 HP 합산 결과 ${battle.teams[res.winner].name} 승리`;
      battle.endBattle(res.type === 'draw' ? null : res.winner, message);
      broadcastBattleUpdate(battleId);
    }
  }
  io.emit('server-shutdown', { message: '서버 점검이 시작됩니다.' });
  setTimeout(() => {
    httpServer.close(() => {
      console.log('[전투서버] 서버 종료 완료');
      process.exit(0);
    });
  }, 5000);
});
process.on('SIGINT', () => {
  console.log('[전투서버] SIGINT 신호 수신, 서버 종료 중...');
  process.exit(0);
});
