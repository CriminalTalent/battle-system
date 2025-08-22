import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 미들웨어
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 파일 업로드 설정
const UPLOAD_DIR = path.join(__dirname, '../uploads');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `character-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  cb(null, allowed.includes(file.mimetype));
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

// 유틸리티 함수들
const pick = (obj, keys) => keys.reduce((acc, key) => { if (key in obj) acc[key] = obj[key]; return acc; }, {});
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
const newId = (p = 'battle') => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const genToken = (prefix = 'tok') => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// 주사위 굴리기
function rollD20() { 
  return Math.floor(Math.random() * 20) + 1; 
}

// 이니셔티브 계산 (동점 시 다시 굴리기)
function calculateInitiativeWithTiebreaker(players) {
  const initiatives = [];
  
  for (const player of players) {
    let initiative, rolls = 0;
    let isUnique = false;
    
    do {
      const diceRoll = rollD20();
      initiative = player.stats.agility + diceRoll;
      rolls++;
      
      // 동점 체크
      isUnique = !initiatives.some(init => init.initiative === initiative);
      
      // 무한루프 방지 (매우 드문 경우)
      if (rolls > 10) {
        initiative += Math.random() * 0.01; // 미세 조정으로 강제 구분
        isUnique = true;
      }
      
    } while (!isUnique);
    
    initiatives.push({
      player,
      initiative,
      agilityBase: player.stats.agility,
      finalRoll: Math.floor(initiative - player.stats.agility),
      rollCount: rolls
    });
  }
  
  return initiatives.sort((a, b) => b.initiative - a.initiative);
}

// 배틀 클래스
class Battle {
  constructor(mode = '1v1') {
    this.id = newId('battle');
    this.mode = mode;
    this.config = BATTLE_MODES[mode] || BATTLE_MODES['1v1'];
    this.phase = 'lobby';
    this.teams = { team1: [], team2: [] };
    this.currentTeam = 'team1';
    this.turnOrder = [];
    this.turnIndex = 0;
    this.startTime = null;
    this.endTime = null;
    this.turnStartTime = null;
    this.battleLog = [];
    this.chatLog = [];
    this.winner = null;
    this.settings = {
      turnTimeLimit: 300000, // 5분
      maxTurns: 50
    };
    
    // 인증 관련
    this.tokens = {
      admin: '',
      player: '',
      spectator: ''
    };
    this.otps = {
      admin: null,
      players: new Map(), // name -> otp
      spectators: new Set() // otp set
    };
  }

  createCharacter(playerId, name, stats, teamId, imageUrl = null, items = {}, customHp = null) {
    const maxHp = customHp ? clamp(customHp, 1, 100) : 100;
    
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
      stats: this.normalizeStats(stats),
      alive: true,
      hasActed: false,
      imageUrl: imageUrl || null,
      inventory: inventory,
      buffs: { 
        attackMultiplier: 1, 
        defenseMultiplier: 1, 
        buffTurnsLeft: 0 
      }
    };
  }

  normalizeStats(stats) {
    const s = stats || {};
    const map = { 
      '공격력': 'attack', '방어력': 'defense', '민첩성': 'agility', '행운': 'luck',
      'attack': 'attack', 'defense': 'defense', 'agility': 'agility', 'luck': 'luck' 
    };
    const out = { attack: 1, defense: 1, agility: 1, luck: 1 };
    Object.keys(s).forEach(k => { 
      const key = map[k]; 
      if (key) out[key] = s[k]; 
    });
    out.attack = clamp(out.attack ?? 1, 1, 5);
    out.defense = clamp(out.defense ?? 1, 1, 5);
    out.agility = clamp(out.agility ?? 1, 1, 5);
    out.luck = clamp(out.luck ?? 1, 1, 5);
    return out;
  }

  addCharacter(name, teamId, stats, imageUrl, items, customHp) {
    const team = this.teams[teamId];
    if (!team) throw new Error('잘못된 팀입니다');
    if (team.length >= this.config.playersPerTeam) {
      throw new Error('팀이 가득 찼습니다');
    }
    
    const playerId = `p_${crypto.randomBytes(6).toString('hex')}`;
    const character = this.createCharacter(playerId, name, stats, teamId, imageUrl, items, customHp);
    team.push(character);
    
    this.addBattleLog(`${name}이 ${teamId === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들'}에 추가되었습니다`);
    
    return { success: true, character };
  }

  join(playerId, name, teamId, stats, imageUrl, items, customHp) {
    if (this.phase !== 'lobby') throw new Error('이미 전투가 시작되었습니다');
    
    // 1순위: 기존 캐릭터 찾기
    const existingResult = this.findAndAssignCharacter(playerId, name, teamId);
    if (existingResult.success) {
      console.log(`기존 캐릭터 매칭 성공: ${name} -> ${teamId} (${this.id})`);
      return existingResult;
    }
    
    // 2순위: 이름으로 기존 캐릭터 찾기
    const allPlayers = [...this.teams.team1, ...this.teams.team2];
    const existingByName = allPlayers.find(p => p.name === name);
    if (existingByName) {
      existingByName.id = playerId;
      console.log(`이름 매칭 성공: ${name} -> ${existingByName.teamId} (${this.id})`);
      return { success: true, character: existingByName, existing: true };
    }
    
    // 3순위: 새 캐릭터 생성
    const team = this.teams[teamId];
    if (!team) throw new Error('잘못된 팀입니다');
    if (team.length >= this.config.playersPerTeam) {
      throw new Error('팀이 가득 찼습니다. 관리자가 등록한 캐릭터와 같은 이름으로 로그인해보세요.');
    }
    
    const character = this.createCharacter(playerId, name, stats, teamId, imageUrl, items, customHp);
    team.push(character);
    
    return { success: true, character };
  }

  findAndAssignCharacter(playerId, playerName, teamId) {
    const team = this.teams[teamId];
    if (!team) return { success: false, error: "잘못된 팀입니다" };
    
    const existingChar = team.find(char => char.name === playerName);
    if (existingChar) {
      if (existingChar.id !== playerId && existingChar.id.startsWith("p_")) {
        return { success: false, error: "해당 캐릭터는 이미 다른 플레이어가 사용 중입니다." };
      }
      
      existingChar.id = playerId;
      return { success: true, character: existingChar, existing: true };
    }
    
    return { success: false, error: "해당 이름의 캐릭터를 찾을 수 없습니다." };
  }

  start() {
    if (this.phase !== 'lobby') throw new Error('전투가 준비되지 않았습니다');
    
    const team1Count = this.teams.team1.length;
    const team2Count = this.teams.team2.length;
    const requiredPerTeam = this.config.playersPerTeam;
    
    if (team1Count < requiredPerTeam || team2Count < requiredPerTeam) {
      throw new Error('플레이어 수가 부족합니다');
    }
    
    this.phase = 'battle';
    this.startTime = Date.now();
    
    // 동점 처리가 포함된 이니셔티브 계산
    const allPlayers = [...this.teams.team1, ...this.teams.team2];
    const initiatives = calculateInitiativeWithTiebreaker(allPlayers);
    
    this.turnOrder = initiatives.map(i => i.player);
    this.turnIndex = 0;
    
    this.addBattleLog('전투가 시작되었습니다!');
    
    // 이니셔티브 결과 로그
    initiatives.forEach(init => {
      const tieMsg = init.rollCount > 1 ? ` (${init.rollCount}번째 굴림)` : '';
      this.addBattleLog(
        `${init.player.name}: 민첩성(${init.agilityBase}) + 주사위(${init.finalRoll}) = ${Math.floor(init.initiative)}${tieMsg}`
      );
    });
    
    this.startPlayerTurn();
    return { success: true };
  }

  executeAction(playerId, action) {
    if (this.phase !== 'battle') throw new Error('전투가 진행 중이 아닙니다');
    
    const currentPlayer = this.turnOrder[this.turnIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) throw new Error('당신의 턴이 아닙니다');
    if (!currentPlayer.alive) throw new Error('사망한 플레이어는 행동할 수 없습니다');
    if (currentPlayer.hasActed) throw new Error('이미 이번 턴에 행동했습니다');
    
    let result = null;
    
    switch (action.type) {
      case 'attack':
        result = this.executeAttack(currentPlayer, action.targetId, action.actionType);
        break;
      case 'use_item':
        result = this.executeUseItem(currentPlayer, action.itemName);
        break;
      case 'pass':
        result = { success: true, description: `${currentPlayer.name}이 턴을 패스했습니다.` };
        break;
      default:
        throw new Error('잘못된 행동 타입입니다');
    }
    
    if (result.success) {
      currentPlayer.hasActed = true;
      
      this.addBattleLog(result.description);
      
      if (this.checkBattleEnd()) {
        this.endBattle(this.winner);
        return { ...result, battleEnded: true, winner: this.winner };
      }
      
      this.nextTurn();
    }
    
    return result;
  }

  executeAttack(attacker, targetId, actionType) {
    const target = this.findPlayer(targetId);
    if (!target) throw new Error('대상을 찾을 수 없습니다');
    if (!target.alive) throw new Error('대상이 이미 사망했습니다');
    if (target.teamId === attacker.teamId) throw new Error('아군은 공격할 수 없습니다');
    
    // 공격자 수치 계산
    const attackerLuckRoll = rollD20();
    const attackerHitValue = attacker.stats.luck + attackerLuckRoll; // 명중율
    
    const attackerAttackRoll = rollD20();
    const attackerAttackValue = (attacker.stats.attack * attacker.buffs.attackMultiplier) + attackerAttackRoll; // 공격력
    
    let result;
    
    if (actionType === 'dodge') {
      // 회피 시도: 민첩성 + 주사위(1-20) vs 공격자 명중력
      const defenderAgilityRoll = rollD20();
      const defenderDodgeValue = target.stats.agility + defenderAgilityRoll;
      
      if (defenderDodgeValue >= attackerHitValue) {
        // 완전 회피 성공
        result = {
          success: true,
          description: `${target.name}이 ${attacker.name}의 공격을 완전히 회피했습니다! (회피: ${defenderDodgeValue} vs 명중: ${attackerHitValue})`,
          damage: 0,
          hit: false,
          dodged: true,
          attackerRolls: { luck: attackerLuckRoll, attack: attackerAttackRoll },
          defenderRolls: { agility: defenderAgilityRoll }
        };
      } else {
        // 회피 실패 - 정면으로 맞음 (방어력 적용 안됨)
        let damage = attackerAttackValue;
        
        // 치명타 체크: 주사위(1-20) ≥ (20 - 행운/2)
        const criticalRoll = rollD20();
        const criticalThreshold = 20 - Math.floor(attacker.stats.luck / 2);
        const isCritical = criticalRoll >= criticalThreshold;
        
        if (isCritical) damage *= 2;
        
        target.hp = Math.max(0, target.hp - damage);
        if (target.hp === 0) target.alive = false;
        
        result = {
          success: true,
          description: `${target.name}의 회피 실패! ${attacker.name}이 ${damage} 데미지를 입혔습니다!${isCritical ? ' (치명타!)' : ''} (회피: ${defenderDodgeValue} vs 명중: ${attackerHitValue})`,
          damage,
          hit: true,
          critical: isCritical,
          targetEliminated: !target.alive,
          attackerRolls: { luck: attackerLuckRoll, attack: attackerAttackRoll, critical: criticalRoll },
          defenderRolls: { agility: defenderAgilityRoll }
        };
      }
    } else {
      // 기본 방어: 방어력으로 데미지 감소
      const targetDefense = target.stats.defense * target.buffs.defenseMultiplier;
      
      // 방어는 공격력 - 방어력 = 데미지 (최소 1)
      let damage = Math.max(1, attackerAttackValue - targetDefense);
      
      // 치명타 체크
      const criticalRoll = rollD20();
      const criticalThreshold = 20 - Math.floor(attacker.stats.luck / 2);
      const isCritical = criticalRoll >= criticalThreshold;
      
      if (isCritical) damage *= 2;
      
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) target.alive = false;
      
      result = {
        success: true,
        description: `${attacker.name}이 ${target.name}에게 ${damage} 데미지를 입혔습니다!${isCritical ? ' (치명타!)' : ''} (공격력: ${Math.floor(attackerAttackValue)} vs 방어력: ${Math.floor(targetDefense)})`,
        damage,
        hit: true,
        critical: isCritical,
        targetEliminated: !target.alive,
        attackerRolls: { luck: attackerLuckRoll, attack: attackerAttackRoll, critical: criticalRoll },
        defenderRolls: { defense: targetDefense }
      };
    }
    
    return result;
  }

  executeUseItem(player, itemName) {
    if (!Array.isArray(player.inventory) || !player.inventory.length) {
      throw new Error('보유한 아이템이 없습니다.');
    }
    
    const idx = player.inventory.findIndex(n => n === itemName);
    if (idx === -1) throw new Error('보유하지 않은 아이템입니다.');
    
    // 아이템 소모 (1회성)
    player.inventory.splice(idx, 1);
    
    let description = '';
    
    switch (itemName) {
      case '공격 보정기':
        player.buffs.attackMultiplier = 2; // 공격력 ×2
        player.buffs.buffTurnsLeft = 1;    // 1턴
        description = `${player.name}이 공격 보정기를 사용했습니다. 다음 공격의 위력이 2배가 됩니다!`;
        break;
        
      case '방어 보정기':
        player.buffs.defenseMultiplier = 2; // 방어력 ×2
        player.buffs.buffTurnsLeft = 1;     // 1턴
        description = `${player.name}이 방어 보정기를 사용했습니다. 다음 턴까지 방어력이 2배가 됩니다!`;
        break;
        
      case '디터니':
        const healAmount = 10; // 고정 10 회복
        const oldHp = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + healAmount);
        const actualHeal = player.hp - oldHp;
        description = `${player.name}이 디터니를 사용했습니다. HP가 ${actualHeal} 회복되었습니다! (${oldHp} → ${player.hp})`;
        break;
        
      default:
        throw new Error('알 수 없는 아이템입니다.');
    }
    
    return { 
      success: true, 
      description 
    };
  }

  findPlayer(playerId) {
    const all = [...this.teams.team1, ...this.teams.team2];
    return all.find(p => p.id === playerId);
  }

  nextTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
    
    // 생존한 플레이어 찾기
    while (!this.turnOrder[this.turnIndex].alive) {
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
    }
    
    this.startPlayerTurn();
  }

  // 버프 턴 감소 처리 개선
  startPlayerTurn() {
    const currentPlayer = this.turnOrder[this.turnIndex];
    this.currentTeam = currentPlayer.teamId;
    
    // 버프 턴 감소 (턴 시작 시)
    if (currentPlayer.buffs.buffTurnsLeft > 0) {
      currentPlayer.buffs.buffTurnsLeft--;
      if (currentPlayer.buffs.buffTurnsLeft === 0) {
        const oldAttack = currentPlayer.buffs.attackMultiplier;
        const oldDefense = currentPlayer.buffs.defenseMultiplier;
        
        currentPlayer.buffs.attackMultiplier = 1;
        currentPlayer.buffs.defenseMultiplier = 1;
        
        if (oldAttack > 1 || oldDefense > 1) {
          this.addBattleLog(`${currentPlayer.name}의 아이템 효과가 만료되었습니다.`);
        }
      }
    }
    
    currentPlayer.hasActed = false;
    this.turnStartTime = Date.now();
    
    console.log(`턴 시작: ${currentPlayer.name} (${this.currentTeam})`);
  }

  checkBattleEnd() {
    const team1Alive = this.teams.team1.some(p => p.alive);
    const team2Alive = this.teams.team2.some(p => p.alive);
    
    if (!team1Alive || !team2Alive) {
      this.phase = 'ended';
      this.winner = team1Alive ? 'team1' : team2Alive ? 'team2' : 'draw';
      this.endTime = Date.now();
      
      this.addBattleLog(`전투 종료 - 승자: ${this.getTeamName(this.winner)}`);
      
      return true;
    }
    return false;
  }

  endBattle(winner) {
    this.phase = 'ended';
    this.winner = winner;
    this.endTime = Date.now();
    
    this.addBattleLog(`전투가 강제 종료되었습니다 - 승자: ${this.getTeamName(winner)}`);
    
    return { success: true, winner: winner };
  }

  getTeamName(teamId) {
    if (teamId === 'team1') return '불사조 기사단';
    if (teamId === 'team2') return '죽음을 먹는 자들';
    if (teamId === 'draw') return '무승부';
    return '알 수 없음';
  }

  addBattleLog(message) {
    const logEntry = {
      timestamp: Date.now(),
      message: message
    };
    this.battleLog.push(logEntry);
    return logEntry;
  }

  addChatMessage(sender, message, senderType = 'player') {
    const chatEntry = {
      timestamp: Date.now(),
      sender: sender,
      message: message,
      senderType: senderType
    };
    this.chatLog.push(chatEntry);
    
    // Socket.IO로 실시간 채팅 브로드캐스트
    io.to(this.id).emit('chat-message', chatEntry);
    
    return chatEntry;
  }

  getState() {
    return {
      id: this.id,
      mode: this.mode,
      phase: this.phase,
      teams: this.teams,
      currentTeam: this.currentTeam,
      turnOrder: this.turnOrder,
      turnIndex: this.turnIndex,
      battleLog: this.battleLog,
      chatLog: this.chatLog,
      winner: this.winner,
      settings: this.settings,
      startTime: this.startTime,
      endTime: this.endTime
    };
  }

  getPublicState() {
    return pick(this.getState(), [
      'id', 'mode', 'phase', 'teams', 'currentTeam', 'turnOrder', 
      'turnIndex', 'battleLog', 'chatLog', 'winner', 'settings'
    ]);
  }
}

// 미들웨어 함수들
function verifyAdminToken(req, res, next) {
  const battleId = req.params.id;
  const battle = battles.get(battleId);
  
  if (!battle) {
    return res.status(404).json({ error: 'Battle not found' });
  }
  
  req.battle = battle;
  next();
}

// API 엔드포인트들

// 이미지 업로드
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '이미지 파일이 필요합니다' });
  }
  
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  const { mode = '1v1' } = req.body;
  const battle = new Battle(mode);
  battles.set(battle.id, battle);
  
  console.log(`[전투서버] 새 전투 생성: ${battle.id} (${mode})`);
  
  res.json({
    battleId: battle.id,
    mode: battle.mode,
    phase: battle.phase
  });
});

// 전투 상태 조회
app.get('/api/battles/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  
  res.json(battle.getPublicState());
});

// 캐릭터 추가 (관리자)
app.post('/api/admin/battles/:id/add-character', verifyAdminToken, (req, res) => {
  const { name, teamId, stats, items, customHp, imageUrl } = req.body;
  const battle = req.battle;
  
  if (!name || !teamId) {
    return res.status(400).json({ error: '이름과 팀이 필요합니다' });
  }
  
  try {
    const result = battle.addCharacter(name, teamId, stats, imageUrl, items, customHp);
    console.log(`[전투서버] 캐릭터 추가: ${name} -> ${teamId} (${req.params.id})`);
    io.to(req.params.id).emit('character-added', { battleId: req.params.id, character: result.character, state: battle.getState() });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 참가
app.post('/api/battles/:id/join', (req, res) => {
  const { playerId, name, teamId, stats, imageUrl, items, customHp } = req.body;
  const battle = battles.get(req.params.id);
  
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  
  try {
    const result = battle.join(playerId, name, teamId, stats, imageUrl, items, customHp);
    console.log(`[전투서버] 플레이어 참가: ${name} -> ${teamId} (${req.params.id})`);
    battle.addChatMessage('전투 시스템', `${name}이 ${teamId === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들'}에 참가했습니다`, 'system');
    io.to(req.params.id).emit('player-joined', { battleId: req.params.id, player: result.character, state: battle.getState() });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 전투 시작
app.post('/api/battles/:id/start', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  
  try {
    const result = battle.start();
    console.log(`[전투서버] 전투 시작: ${req.params.id}`);
    battle.addChatMessage('전투 시스템', '전투가 시작되었습니다! 전사들이여, 전투에 임하라!', 'system');
    io.to(req.params.id).emit('battle-started', { battleId: req.params.id, state: battle.getState() });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 채팅 메시지
app.post('/api/battles/:id/chat', (req, res) => {
  const { sender, message, senderType } = req.body || {};
  const battle = battles.get(req.params.id);
  
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (!sender || !message) return res.status(400).json({ error: 'sender와 message가 필요합니다' });
  if (message.length > 200) return res.status(400).json({ error: '메시지는 200자 이하여야 합니다' });
  
  const chatEntry = battle.addChatMessage(sender, message, senderType || 'player');
  res.json({ success: true, message: chatEntry });
});

// 액션 실행
app.post('/api/battles/:id/action', (req, res) => {
  const { playerId, action } = req.body || {};
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });

  try {
    const result = battle.executeAction(playerId, action);
    console.log(`[전투서버] 행동 실행: ${action.type} by ${playerId} (${req.params.id})`);
    io.to(req.params.id).emit('action-executed', { battleId: req.params.id, action, result, state: battle.getState() });
    if (result.battleEnded) {
      console.log(`[전투서버] 전투 종료: ${req.params.id}, 승자: ${result.winner}`);
      io.to(req.params.id).emit('battle-ended', { battleId: req.params.id, winner: result.winner, state: battle.getState() });
    }
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 관리자 링크 생성
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

// OTP 발급
app.post('/api/admin/battles/:id/issue-otp', verifyAdminToken, (req, res) => {
  const { role, name } = req.body || {};
  const battle = req.battle;
  
  if (!role || !['admin', 'player', 'spectator'].includes(role)) {
    return res.status(400).json({ error: '유효하지 않은 역할입니다' });
  }
  
  const otp = Math.random().toString(36).substr(2, 6).toUpperCase();
  
  if (role === 'admin') {
    battle.otps.admin = otp;
  } else if (role === 'player') {
    if (!name) return res.status(400).json({ error: '플레이어 이름이 필요합니다' });
    battle.otps.players.set(name, otp);
  } else if (role === 'spectator') {
    battle.otps.spectators.add(otp);
  }
  
  console.log(`[전투서버] ${role} OTP 발급: ${otp} (${req.params.id})`);
  
  res.json({ otp });
});

// 인증
app.post('/api/auth/login', (req, res) => {
  const { battleId, role, name, otp, token } = req.body || {};
  const battle = battles.get(battleId);
  
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (!role || !otp) return res.status(400).json({ error: '역할과 OTP가 필요합니다' });
  
  let isValid = false;
  
  if (role === 'admin') {
    isValid = battle.otps.admin === otp;
  } else if (role === 'player') {
    if (!name) return res.status(400).json({ error: '플레이어 이름이 필요합니다' });
    isValid = battle.otps.players.get(name) === otp;
  } else if (role === 'spectator') {
    isValid = battle.otps.spectators.has(otp);
  }
  
  if (!isValid) {
    return res.status(401).json({ error: '유효하지 않은 인증 정보입니다' });
  }
  
  console.log(`[전투서버] ${role} 인증 성공: ${name || 'unnamed'} (${battleId})`);
  
  res.json({ success: true, role, battleId });
});

// 전투 강제 종료
app.post('/api/admin/battles/:id/force-end', verifyAdminToken, (req, res) => {
  const { winner } = req.body || {};
  const battle = req.battle;
  
  const result = battle.endBattle(winner || 'draw');
  console.log(`[전투서버] 강제 종료: ${req.params.id}, 승자: ${winner || 'draw'}`);
  io.to(req.params.id).emit('battle-ended', { battleId: req.params.id, winner: winner || 'draw', state: battle.getState() });
  
  res.json(result);
});

// 전투 삭제
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
  
  socket.on('chat-message', (data = {}) => {
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

// 에러 핸들링
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
  console.log('=== PYXIS 전투 시스템 규칙 ===');
  console.log('1. 이니셔티브: 민첩성 + 주사위(1-20), 동점 시 다시 굴림');
  console.log('2. 공격력: 공격력 + 주사위(1-20) - 상대 방어력 = 기본 데미지');
  console.log('3. 명중율: 행운 + 주사위(1-20)');
  console.log('4. 회피율: 민첩성 + 주사위(1-20)');
  console.log('5. 치명타: 주사위(1-20) ≥ (20 - 행운/2) → 2배 데미지');
  console.log('6. 방어: 방어력으로 데미지 감소');
  console.log('7. 회피: 완전회피 vs 정면으로 맞음');
  console.log('8. 아이템: 공격/방어 보정기(1턴, ×2), 디터니(10 회복, 1회성)');
  console.log('===============================');
});
