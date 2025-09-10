// ESM Entry for PYXIS Battle Server
// - Loads .env
// - Serves static files
// - Adds /admin /player /spectator routes
// - Exposes /healthz
// - Wires Socket.IO channels used by UI (auth/join/chat/cheer/log/update)

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
const envRoot  = path.join(__dirname, '..', '..', '.env');
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
console.log(`- 환경변수 PUBLIC_BASE_URL: ${process.env.PUBLIC_BASE_URL || '설정되지 않음'}`);

// --------------------------------------------------
// Ensure directories
// --------------------------------------------------
['uploads', 'logs', 'public/uploads/avatars'].forEach((dir) => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[PYXIS] 디렉토리 생성: ${dir}`);
  }
});

// --------------------------------------------------
// Game constants & utils
// --------------------------------------------------
const GAME_DURATION = 60 * 60 * 1000; // 1h
const TURN_TIMEOUT  = 5 * 60 * 1000;  // 5m
const MAX_TURNS     = 100;

const now = () => Date.now();
const roll = (sides = 20) => Math.floor(Math.random() * sides) + 1;
const chance = (p) => Math.random() < p;
const clampStat = (v, max = 10) => Math.max(1, Math.min(max, parseInt(v) || 1));

const calculateCritical = (luck, dice) => dice >= (20 - Math.floor(luck / 2));
const calculateHit      = (luck, dice) => (luck + dice) >= 12;

// --------------------------------------------------
// State (in-memory)
// --------------------------------------------------
const battles = new Map();

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
      currentPlayer: null, // (선택) 개별 턴 운영 시 사용
      currentTeam: null,   // 팀 턴 운영
      turnStartTime: null,
      winner: null,
      // 새로 추가: 판정 보조
      lastActionTeam: null,        // 마지막 유효 액션을 수행한 팀 (무승부 방지용)
      lastActionAt: null,
      // timers
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
    type, // 'system' | 'chat' | 'cheer' | 'attack' | 'defend' | 'evade' | 'item' ...
    message
  };
  battle.log.push(item);
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
  return item;
}

function serializeBattle(battle) {
  return {
    id: battle.id,
    mode: battle.mode,
    status: battle.status,
    players: battle.players.map(p => ({ ...p })),
    log: battle.log.slice(-100),
    turn: battle.turn,
    currentPlayer: battle.currentPlayer,
    currentTeam: battle.currentTeam,
    // 클라이언트 호환성(Notifications/Player)
    current: battle.currentPlayer || battle.currentTeam,
    turnStartTime: battle.turnStartTime,
    createdAt: battle.createdAt,
    startedAt: battle.startedAt,
    endedAt: battle.endedAt,
    spectatorCount: battle.spectators.size,
    winner: battle.winner
  };
}

// --------------------------------------------------
// Battle creation / roster
// --------------------------------------------------
function createNewBattle(mode = '1v1') {
  const battleId = `battle_${Math.random().toString(36).slice(2, 10)}`;
  const battle   = ensureBattle(battleId);
  battle.mode    = mode;
  battle.status  = 'waiting';
  pushLog(battle, 'system', `전투 생성됨 - 모드: ${mode}`);

  const adminUrl      = `${PUBLIC_BASE_URL}/admin?battle=${battleId}&token=admin-${battleId}`;
  const playerBase    = `${PUBLIC_BASE_URL}/player?battle=${battleId}`;
  const spectatorBase = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}`;

  return { battleId, battle, adminUrl, playerBase, spectatorBase };
}

function addPlayerToBattle(battleId, playerData) {
  const battle = ensureBattle(battleId);

  const nameRaw = (playerData.name || '').trim();
  if (!nameRaw) throw new Error('이름을 입력해주세요');
  if (nameRaw.length > 20) throw new Error('이름은 20글자 이하로 입력해주세요');

  const duplicate = battle.players.find(
    p => p.name.toLowerCase().trim() === nameRaw.toLowerCase()
  );
  if (duplicate) throw new Error(`이미 등록된 이름입니다: ${playerData.name}`);

  const maxPlayersPerTeam = parseInt(String(battle.mode).charAt(0), 10) || 1;
  const teamKey = playerData.team === 'eaters' ? 'eaters' : 'phoenix';
  const teamCount = battle.players.filter(p => p.team === teamKey).length;
  if (teamCount >= maxPlayersPerTeam) {
    throw new Error(`${teamKey} 팀이 이미 가득 찼습니다 (${maxPlayersPerTeam}명)`);
  }

  const stats = {
    attack:  clampStat(playerData.stats?.attack  ?? 3),
    defense: clampStat(playerData.stats?.defense ?? 3),
    agility: clampStat(playerData.stats?.agility ?? 3),
    luck:    clampStat(playerData.stats?.luck    ?? 3)
  };

  const hp = parseInt(playerData.hp || 100, 10);
  const player = {
    id: `player_${Math.random().toString(36).slice(2, 10)}`,
    name: nameRaw,
    team: teamKey,
    hp,
    maxHp: hp,
    stats,
    items: {
      dittany:        parseInt(playerData.items?.dittany         || 1, 10),
      attack_booster: parseInt(playerData.items?.attack_booster  || 1, 10),
      defense_booster:parseInt(playerData.items?.defense_booster || 1, 10)
    },
    avatar: playerData.avatar || null,
    isReady: false,
    isAlive: true,
    effects: [],             // { type, factor|bonus, turns }
    lastAction: null,
    actionHistory: []
  };

  battle.players.push(player);
  pushLog(battle, 'system', `전투 참가자 추가: ${player.name} (${player.team}팀)`);
  return player;
}

// --------------------------------------------------
// Turn & effect helpers
// --------------------------------------------------
function setTurnTimer(battle) {
  if (battle.turnTimer) clearTimeout(battle.turnTimer);
  battle.turnTimer = setTimeout(() => handleTurnTimeout(battle), TURN_TIMEOUT);
}

function handleTurnTimeout(battle) {
  if (battle.status !== 'active') return;
  pushLog(battle, 'system', `턴 시간 초과 - 자동 패스`);
  nextTurn(battle);
}

function decayEffects(battle) {
  battle.players.forEach(p => {
    if (!Array.isArray(p.effects) || p.effects.length === 0) return;
    p.effects = p.effects
      .map(e => (e.turns != null ? { ...e, turns: e.turns - 1 } : e))
      .filter(e => (e.turns == null || e.turns > 0));
  });
}

// --------------------------------------------------
// Battle flow
// --------------------------------------------------
function startBattle(battleId) {
  const battle = ensureBattle(battleId);
  if (battle.players.length < 2) throw new Error('최소 2명의 전투 참가자가 필요합니다');

  const teamNames = [...new Set(battle.players.map(p => p.team))];
  if (teamNames.length !== 2) throw new Error('정확히 2팀이 필요합니다');

  // 선공: 팀별 민첩 + d20 합
  const agiSum = {};
  teamNames.forEach(team => {
    agiSum[team] = battle.players
      .filter(p => p.team === team)
      .reduce((sum, p) => sum + p.stats.agility + roll(20), 0);
  });
  const firstTeam = agiSum[teamNames[0]] >= agiSum[teamNames[1]] ? teamNames[0] : teamNames[1];

  battle.status = 'active';
  battle.startedAt = new Date().toISOString();
  battle.currentTeam = firstTeam;
  battle.turn = 1;
  battle.turnStartTime = now();
  battle.lastActionTeam = null;
  battle.lastActionAt   = null;

  // 게임 타이머
  if (battle.gameTimer) clearTimeout(battle.gameTimer);
  battle.gameTimer = setTimeout(() => endBattleByTime(battleId), GAME_DURATION);

  setTurnTimer(battle);

  pushLog(
    battle,
    'system',
    `전투 시작! ${firstTeam} 팀 선공 (민첩성: ${Object.entries(agiSum).map(([t, a]) => `${t}=${a}`).join(', ')})`
  );

  return battle;
}

function nextTurn(battle) {
  if (battle.status !== 'active') return;

  // 승패 확인(액션 결과 반영 직후)
  const verdict = checkBattleEnd(battle);
  if (verdict.ended) {
    endBattle(battle.id, verdict.reason, verdict.winner);
    return;
  }

  // 턴 전환
  const teams = [...new Set(battle.players.map(p => p.team))];
  const curIdx = teams.indexOf(battle.currentTeam);
  battle.currentTeam = teams[(curIdx + 1) % teams.length];

  if (battle.currentTeam === teams[0]) battle.turn += 1;

  // 효과 지속 턴 감소
  decayEffects(battle);

  battle.turnStartTime = now();
  setTurnTimer(battle);

  if (battle.turn > MAX_TURNS) {
    endBattleByTime(battle.id);
    return;
  }

  pushLog(battle, 'system', `턴 ${battle.turn}: ${battle.currentTeam} 팀 차례`);
}

// 무승부 방지 포함
function checkBattleEnd(battle) {
  const aliveByTeam = {};
  let aliveCount = 0;

  battle.players.forEach(p => {
    if (p.hp > 0) {
      aliveByTeam[p.team] = (aliveByTeam[p.team] || 0) + 1;
      aliveCount += 1;
    }
  });

  const aliveTeams = Object.keys(aliveByTeam).filter(t => aliveByTeam[t] > 0);

  if (aliveTeams.length === 1) {
    return { ended: true, winner: aliveTeams[0], reason: '전멸' };
  }

  // 모든 인원이 0인 “그 순간” ⇒ 마지막 유효 액션 팀을 승자로
  if (aliveCount === 0) {
    const winner = battle.lastActionTeam || battle.currentTeam || null;
    return { ended: true, winner, reason: '동시 전멸(무승부 방지 규칙)' };
  }

  return { ended: false };
}

function endBattle(battleId, reason = '시간 종료', winner = null) {
  const battle = ensureBattle(battleId);
  if (battle.gameTimer) clearTimeout(battle.gameTimer);
  if (battle.turnTimer) clearTimeout(battle.turnTimer);

  battle.status = 'ended';
  battle.endedAt = new Date().toISOString();
  battle.winner  = winner;

  pushLog(battle, 'system', `전투 종료 - ${reason} ${winner ? `승자: ${winner}팀` : ''}`);
  return battle;
}

function endBattleByTime(battleId) {
  const battle = ensureBattle(battleId);
  const hpByTeam = {};
  battle.players.forEach(p => {
    hpByTeam[p.team] = (hpByTeam[p.team] || 0) + Math.max(0, p.hp);
  });

  const teams = Object.keys(hpByTeam);
  let winner = null;
  if (hpByTeam[teams[0]] > hpByTeam[teams[1]]) winner = teams[0];
  else if (hpByTeam[teams[0]] < hpByTeam[teams[1]]) winner = teams[1];
  // 동률이면 여기서는 그대로 무승부 처리 (요청사항은 "전원 0시"만 무승부 금지)
  endBattle(battleId, '시간 종료', winner);
}

// --------------------------------------------------
// Action processing (+effects)
// --------------------------------------------------
function handlePlayerAction(battleId, playerId, action) {
  const battle = ensureBattle(battleId);
  const actor  = battle.players.find(p => p.id === playerId);

  if (!actor || battle.status !== 'active') return { success: false, error: '잘못된 전투 상태' };
  if (actor.team !== battle.currentTeam)     return { success: false, error: '아직 당신의 턴이 아닙니다' };
  if (actor.hp <= 0)                         return { success: false, error: '사망한 전투 참가자는 행동할 수 없습니다' };

  let result;
  try {
    switch (action.type) {
      case 'attack': result = handleAttack(battle, actor, action); break;
      case 'defend': result = handleDefend(battle, actor); break;
      case 'dodge':  result = handleDodge(battle, actor); break;
      case 'item':   result = handleItem(battle, actor, action); break;
      case 'pass':   result = handlePass(battle, actor); break;
      default:       result = { success: false, error: '알 수 없는 액션' };
    }
  } catch (err) {
    console.error('[COMBAT] 액션 처리 오류:', err);
    result = { success: false, error: '액션 처리 중 오류 발생' };
  }

  if (result.success) {
    actor.lastAction = action.type;
    actor.actionHistory.push({ turn: battle.turn, action: action.type, target: action.targetId, timestamp: now() });
    battle.lastActionTeam = actor.team;
    battle.lastActionAt   = now();
    nextTurn(battle);
  }

  return result;
}

function getEffectFactor(effects, type, def = 1) {
  const eff = Array.isArray(effects) ? effects.find(e => e.type === type) : null;
  return eff && typeof eff.factor === 'number' ? eff.factor : def;
}
function getEffectBonus(effects, type, def = 0) {
  const eff = Array.isArray(effects) ? effects.find(e => e.type === type) : null;
  return eff && typeof eff.bonus === 'number' ? eff.bonus : def;
}

function handleAttack(battle, actor, action) {
  const target = battle.players.find(p => p.id === action.targetId && p.hp > 0);
  if (!target) return { success: false, error: '유효한 대상이 없습니다' };
  if (target.team === actor.team) return { success: false, error: '같은 팀을 공격할 수 없습니다' };

  // 명중 체크(행운)
  const hitRoll = roll(20);
  if (!calculateHit(actor.stats.luck, hitRoll)) {
    pushLog(battle, 'attack', `${actor.name}의 공격이 빗나감 (행운 ${actor.stats.luck}, d20=${hitRoll})`);
    return { success: true };
  }

  // 회피 체크(상대 민첩 + 회피 보너스)
  const dodgeBonus = getEffectBonus(target.effects, 'dodge', 0);
  const evadeRoll  = roll(20);
  const attackRoll = roll(20);

  const evaded = (target.stats.agility + dodgeBonus + evadeRoll) >= (actor.stats.attack + attackRoll);
  if (evaded) {
    pushLog(battle, 'evade', `${target.name}이 ${actor.name}의 공격을 회피 (민첩 ${target.stats.agility}${dodgeBonus?`+${dodgeBonus}`:''}, d20=${evadeRoll})`);
    return { success: true };
  }

  // 피해 계산(버프/자세 반영)
  const atkFactor = Math.max(
    getEffectFactor(actor.effects, 'attack_boost', 1),
    getEffectFactor(actor.effects, 'attack_boost_once', 1)
  );
  const defFactor = Math.max(
    getEffectFactor(target.effects, 'defense_boost', 1),
    getEffectFactor(target.effects, 'defend', 1)
  );

  const rawAtk = (actor.stats.attack + attackRoll) * atkFactor;
  const rawDef = (target.stats.defense) * defFactor;
  let damage   = Math.max(0, Math.round(rawAtk - rawDef)); // 최소 0, "방어 시 최소 1 대미지" 규칙 없음

  // 치명타
  const critRoll = roll(20);
  if (calculateCritical(actor.stats.luck, critRoll)) {
    damage *= 2;
    pushLog(battle, 'attack', `${actor.name}의 치명타! ${target.name}에게 ${damage} 피해 (공격 ${actor.stats.attack}+${attackRoll}×${atkFactor.toFixed(2)}, 치명 d20=${critRoll})`);
  } else {
    pushLog(battle, 'attack', `${actor.name}이 ${target.name}에게 ${damage} 피해 (공격 ${actor.stats.attack}+${attackRoll}×${atkFactor.toFixed(2)})`);
  }

  // HP 적용
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp === 0 && target.isAlive) {
    target.isAlive = false;
    pushLog(battle, 'attack', `${target.name} 전투불능`);
  }

  return { success: true };
}

function handleDefend(battle, actor) {
  actor.effects = actor.effects || [];
  actor.effects.push({ type: 'defend', factor: 1.5, turns: 1 });
  pushLog(battle, 'defend', `${actor.name}이 방어 태세를 취함 (방어 ×1.5, 1턴)`);
  return { success: true };
}

function handleDodge(battle, actor) {
  actor.effects = actor.effects || [];
  actor.effects.push({ type: 'dodge', bonus: 5, turns: 1 });
  pushLog(battle, 'evade', `${actor.name}이 회피 자세를 취함 (민첩 +5, 1턴)`);
  return { success: true };
}

function handleItem(battle, actor, action) {
  const itemKey = action.itemType;
  if (!actor.items[itemKey] || actor.items[itemKey] <= 0) {
    return { success: false, error: '해당 아이템을 보유하고 있지 않습니다' };
  }
  actor.items[itemKey]--;

  switch (itemKey) {
    case 'dittany':         return handleDittany(battle, actor, action);
    case 'attack_booster':  return handleAttackBooster(battle, actor);
    case 'defense_booster': return handleDefenseBooster(battle, actor);
    default: return { success: false, error: '알 수 없는 아이템' };
  }
}

function handleDittany(battle, actor, action) {
  const target = battle.players.find(p => p.id === action.targetId);
  if (!target) return { success: false, error: '대상을 찾을 수 없습니다' };

  const healAmount = 10;
  const oldHp = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + healAmount);
  const actual = target.hp - oldHp;

  if (target.hp > 0) target.isAlive = true;

  pushLog(battle, 'item', `${actor.name}이 ${target.name}에게 디터니 사용 (+${actual} HP)`);
  return { success: true };
}

function handleAttackBooster(battle, actor) {
  const ok = chance(0.1);
  if (ok) {
    actor.effects = actor.effects || [];
    actor.effects.push({ type: 'attack_boost', factor: 1.5, turns: 1 });
    pushLog(battle, 'item', `${actor.name}의 공격 보정기 성공! 다음 공격 ×1.5`);
  } else {
    pushLog(battle, 'item', `${actor.name}의 공격 보정기 실패`);
  }
  return { success: true };
}

function handleDefenseBooster(battle, actor) {
  const ok = chance(0.1);
  if (ok) {
    actor.effects = actor.effects || [];
    actor.effects.push({ type: 'defense_boost', factor: 1.5, turns: 1 });
    pushLog(battle, 'item', `${actor.name}의 방어 보정기 성공! 다음 방어 ×1.5`);
  } else {
    pushLog(battle, 'item', `${actor.name}의 방어 보정기 실패`);
  }
  return { success: true };
}

function handlePass(battle, actor) {
  pushLog(battle, 'system', `${actor.name}이 턴을 넘김`);
  return { success: true };
}

// --------------------------------------------------
// Express + Multer
// --------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  if (req.method === 'OPTIONS') res.sendStatus(200);
  else next();
});

// Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('이미지 파일만 업로드 가능합니다'))
});

// Static
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Pages
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin',     (req, res) => res.sendFile(path.join(publicDir, 'pages', 'admin.html')));
app.get('/player',    (req, res) => res.sendFile(path.join(publicDir, 'pages', 'player.html')));
app.get('/spectator', (req, res) => res.sendFile(path.join(publicDir, 'pages', 'spectator.html')));

// APIs
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    battles: battles.size,
    activeBattles: Array.from(battles.values()).filter(b => b.status === 'active').length,
    totalPlayers: Array.from(battles.values()).reduce((sum, b) => sum + b.players.length, 0),
    environment: { NODE_ENV: process.env.NODE_ENV, HOST, PORT, PUBLIC_BASE_URL },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});
app.get('/healthz', (req, res) => res.redirect('/api/health'));

app.post('/api/battles', (req, res) => {
  try {
    const mode = String(req.body?.mode || '1v1');
    const valid = ['1v1', '2v2', '3v3', '4v4'];
    if (!valid.includes(mode)) {
      return res.status(400).json({ ok: false, error: `잘못된 모드입니다. 사용 가능: ${valid.join(', ')}` });
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
  } catch (e) {
    console.error('[API] 전투 생성 오류:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/battles/:id/start', (req, res) => {
  try {
    const battle = startBattle(req.params.id);
    io.to(battle.id).emit('battle:started', serializeBattle(battle));
    io.to(battle.id).emit('battle:update',  serializeBattle(battle));
    res.json({ ok: true, battleId: battle.id, startedAt: battle.startedAt, currentTeam: battle.currentTeam });
  } catch (e) {
    console.error('[API] 전투 시작 오류:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: '파일이 업로드되지 않았습니다' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    res.json({ ok: true, avatarUrl, filename: req.file.filename, size: req.file.size });
  } catch (e) {
    console.error('[API] 아바타 업로드 오류:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/battles/:id', (req, res) => {
  try {
    const battle = battles.get(req.params.id);
    if (!battle) return res.status(404).json({ ok: false, error: '전투를 찾을 수 없습니다' });
    res.json({ ok: true, battle: serializeBattle(battle) });
  } catch (e) {
    console.error('[API] 전투 조회 오류:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --------------------------------------------------
// HTTP + Socket.IO
// --------------------------------------------------
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// --------------------------------------------------
// Socket handlers (match frontend events)
// --------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[SOCKET] 새 연결: ${socket.id}`);

  // Common: join a battle room for sync
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const battle = ensureBattle(battleId);
    socket.emit('battle:update', serializeBattle(battle));
    console.log(`[SOCKET] 룸 참여: ${socket.id} -> ${battleId}`);
  });

  // ===== Admin =====
  socket.on('adminAuth', ({ battleId, token }) => {
    if (!battleId || !token) return socket.emit('authError', { error: 'Missing credentials' });
    const battle = ensureBattle(battleId);
    if (token !== `admin-${battleId}`) return socket.emit('authError', { error: 'Invalid token' });

    socket.join(battleId);
    socket.emit('auth:success', { role: 'admin', battleId });
    socket.emit('battle:update', serializeBattle(battle));
  });

  socket.on('createBattle', ({ mode }) => {
    try {
      const { battleId, battle, adminUrl, playerBase, spectatorBase } = createNewBattle(mode || '1v1');
      socket.emit('battleCreated', { success: true, battleId, mode: battle.mode, adminUrl, playerBase, spectatorBase });
      socket.emit('battle:update', serializeBattle(battle));
    } catch (e) {
      console.error('[SOCKET] 전투 생성 오류:', e);
      socket.emit('battleCreated', { success: false, error: e.message });
    }
  });

  socket.on('startBattle', ({ battleId }) => {
    try {
      if (!battleId) return socket.emit('battleError', { error: '전투 ID가 필요합니다' });
      const battle = startBattle(battleId);
      io.to(battleId).emit('battle:started', serializeBattle(battle));
      io.to(battleId).emit('battle:update',  serializeBattle(battle));
      socket.emit('battleStarted', { success: true, battleId });
    } catch (e) {
      console.error('[SOCKET] 전투 시작 오류:', e);
      socket.emit('battleError', { error: e.message });
    }
  });

  socket.on('pauseBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      if (battle.gameTimer) clearTimeout(battle.gameTimer);
      if (battle.turnTimer) clearTimeout(battle.turnTimer);
      battle.status = 'paused';
      pushLog(battle, 'system', '전투 일시정지');
      io.to(battleId).emit('battle:paused', serializeBattle(battle));
      io.to(battleId).emit('battle:update',  serializeBattle(battle));
    } catch (e) {
      console.error('[SOCKET] 전투 일시정지 오류:', e);
      socket.emit('battleError', { error: e.message });
    }
  });

  socket.on('resumeBattle', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      battle.status = 'active';
      setTurnTimer(battle);
      pushLog(battle, 'system', '전투 재개');
      io.to(battleId).emit('battle:resumed', serializeBattle(battle));
      io.to(battleId).emit('battle:update',  serializeBattle(battle));
    } catch (e) {
      console.error('[SOCKET] 전투 재개 오류:', e);
      socket.emit('battleError', { error: e.message });
    }
  });

  socket.on('endBattle', ({ battleId }) => {
    try {
      const battle = endBattle(battleId, '관리자 종료');
      io.to(battleId).emit('battle:ended', serializeBattle(battle));
      io.to(battleId).emit('battle:update',  serializeBattle(battle));
    } catch (e) {
      console.error('[SOCKET] 전투 종료 오류:', e);
      socket.emit('battleError', { error: e.message });
    }
  });

  socket.on('addPlayer', ({ battleId, playerData }) => {
    try {
      const player = addPlayerToBattle(battleId, playerData);
      const battle = ensureBattle(battleId);
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerAdded', { success: true, player });
    } catch (e) {
      console.error('[SOCKET] 전투 참가자 추가 오류:', e);
      socket.emit('playerAdded', { success: false, error: e.message });
    }
  });

  socket.on('removePlayer', ({ battleId, playerId }) => {
    try {
      const battle = ensureBattle(battleId);
      const idx = battle.players.findIndex(p => p.id === playerId);
      if (idx === -1) return socket.emit('playerRemoved', { success: false, error: '전투 참가자를 찾을 수 없습니다' });
      const removed = battle.players.splice(idx, 1)[0];
      pushLog(battle, 'system', `전투 참가자 제거: ${removed?.name || playerId}`);
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerRemoved', { success: true, playerId });
    } catch (e) {
      console.error('[SOCKET] 전투 참가자 제거 오류:', e);
      socket.emit('playerRemoved', { success: false, error: e.message });
    }
  });

  socket.on('updatePlayer', ({ battleId, playerId, updates }) => {
    try {
      const battle = ensureBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      if (!player) return socket.emit('playerUpdated', { success: false, error: '전투 참가자를 찾을 수 없습니다' });

      const allowed = ['hp', 'maxHp', 'stats', 'items', 'avatar'];
      Object.keys(updates || {}).forEach((k) => {
        if (!allowed.includes(k)) return;
        if (k === 'stats' && updates[k]) {
          player.stats = {
            attack:  clampStat(updates[k].attack  ?? player.stats.attack),
            defense: clampStat(updates[k].defense ?? player.stats.defense),
            agility: clampStat(updates[k].agility ?? player.stats.agility),
            luck:    clampStat(updates[k].luck    ?? player.stats.luck)
          };
        } else {
          player[k] = updates[k];
        }
      });

      pushLog(battle, 'system', `전투 참가자 정보 수정: ${player.name}`);
      io.to(battleId).emit('battle:update', serializeBattle(battle));
      socket.emit('playerUpdated', { success: true, player });
    } catch (e) {
      console.error('[SOCKET] 전투 참가자 수정 오류:', e);
      socket.emit('playerUpdated', { success: false, error: e.message });
    }
  });

  socket.on('generatePlayerPassword', ({ battleId }) => {
    try {
      const battle = ensureBattle(battleId);
      if (battle.players.length === 0) {
        return socket.emit('playerPasswordGenerated', { success: false, error: '먼저 전투 참가자를 추가하세요' });
      }
      const links = battle.players.map((p) => ({
        playerId: p.id,
        name: p.name,
        team: p.team,
        url: `${PUBLIC_BASE_URL}/player?battle=${battleId}&token=player-${encodeURIComponent(p.name)}-${battleId}&name=${encodeURIComponent(p.name)}`
      }));
      socket.emit('playerPasswordGenerated', { success: true, playerLinks: links });
    } catch (e) {
      console.error('[SOCKET] 전투 참가자 링크 생성 오류:', e);
      socket.emit('playerPasswordGenerated', { success: false, error: e.message });
    }
  });

  socket.on('generateSpectatorOtp', ({ battleId }) => {
    try {
      const url = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}&otp=spectator-${battleId}`;
      socket.emit('spectatorOtpGenerated', { success: true, spectatorUrl: url });
    } catch (e) {
      console.error('[SOCKET] 관전자 링크 생성 오류:', e);
      socket.emit('spectatorOtpGenerated', { success: false, error: e.message });
    }
  });

  // ===== Player =====
  socket.on('playerAuth', ({ battleId, name, token }) => {
    if (!battleId || !name || !token) return socket.emit('authError', { error: 'Missing credentials' });
    const battle = ensureBattle(battleId);
    if (token !== `player-${name}-${battleId}`) return socket.emit('authError', { error: 'Invalid token' });

    const player = battle.players.find(p => p.name === name);
    if (!player) return socket.emit('authError', { error: '등록되지 않은 전투 참가자입니다' });

    socket.join(battleId);
    socket.emit('auth:success', { role: 'player', battleId, playerId: player.id, playerData: player });
    socket.emit('battle:update', serializeBattle(battle));
  });

  socket.on('player:ready', ({ battleId, playerId }) => {
    try {
      const battle = ensureBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      if (player) {
        player.isReady = true;
        pushLog(battle, 'system', `${player.name} 준비완료`);
        io.to(battleId).emit('battle:update', serializeBattle(battle));
      }
    } catch (e) {
      console.error('[SOCKET] 전투 참가자 준비 오류:', e);
    }
  });

  socket.on('player:action', ({ battleId, playerId, action }) => {
    try {
      const result = handlePlayerAction(battleId, playerId, action);
      const battle = ensureBattle(battleId);
      if (result.success) {
        io.to(battleId).emit('battle:update', serializeBattle(battle));
        socket.emit('action:success', { action: action.type });
      } else {
        socket.emit('action:error', { error: result.error });
      }
    } catch (e) {
      console.error('[SOCKET] 전투 참가자 액션 오류:', e);
      socket.emit('action:error', { error: '액션 처리 중 오류 발생' });
    }
  });

  // ===== Spectator =====
  socket.on('spectatorAuth', ({ battleId, otp, name }) => {
    if (!battleId || !otp) return socket.emit('authError', { error: 'Missing credentials' });
    const battle = ensureBattle(battleId);
    if (otp !== `spectator-${battleId}`) return socket.emit('authError', { error: 'Invalid password' });

    battle.spectators.add(socket.id);
    socket.join(battleId);
    socket.emit('auth:success', { role: 'spectator', battleId });
    socket.emit('battle:update', serializeBattle(battle));
    io.to(battleId).emit('spectator:count', { count: battle.spectators.size });
  });

  // ===== Common =====
  socket.on('chat:send', ({ battleId, name, message, team, role }) => {
    if (!battleId || !message || !message.trim()) return;
    const msg = message.trim().slice(0, 200);
    const chat = { name: name || '익명', message: msg, team: team || null, role: role || 'player', timestamp: new Date().toISOString() };
    io.to(battleId).emit('battle:chat', chat);

    const battle = ensureBattle(battleId);
    pushLog(battle, 'chat', `[채팅] ${chat.name}: ${msg}`);
    io.to(battle.id).emit('battle:log', { type: 'chat', message: `[채팅] ${chat.name}: ${msg}`, timestamp: new Date().toISOString() });
  });

  socket.on('cheer:send', ({ battleId, cheer, name }) => {
    if (!battleId || !cheer || !cheer.trim()) return;
    const msg = cheer.trim().slice(0, 100);
    const line = name ? `${name}: ${msg}` : msg;
    io.to(battleId).emit('battle:log', { type: 'cheer', message: line, timestamp: new Date().toISOString() });
  });

  socket.on('disconnect', (reason) => {
    // spectator count update
    for (const battle of battles.values()) {
      if (battle.spectators.delete(socket.id)) {
        io.to(battle.id).emit('spectator:count', { count: battle.spectators.size });
        break;
      }
    }
    console.log(`[SOCKET] 연결 해제: ${socket.id} (${reason})`);
  });

  socket.on('error', (err) => console.error(`[SOCKET] 소켓 오류 ${socket.id}:`, err));
  socket.on('ping', () => socket.emit('pong'));
});

// --------------------------------------------------
// Start server
// --------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] 서버 실행 중: http://${HOST}:${PORT}`);
  console.log(`[PYXIS] 공개 URL: ${PUBLIC_BASE_URL}`);
  console.log(`[PYXIS] 관리자: ${PUBLIC_BASE_URL}/admin`);
  console.log(`[PYXIS] 전투 참가자: ${PUBLIC_BASE_URL}/player`);
  console.log(`[PYXIS] 관전자: ${PUBLIC_BASE_URL}/spectator`);
  console.log(`[PYXIS] 헬스체크: ${PUBLIC_BASE_URL}/api/health`);
});

// --------------------------------------------------
// Graceful shutdown
// --------------------------------------------------
function gracefulShutdown(signal) {
  console.log(`[PYXIS] ${signal} 수신, 서버 종료 중...`);
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
  setTimeout(() => {
    console.error('[PYXIS] 강제 종료 실행');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (e) => { console.error('[PYXIS] 처리되지 않은 예외:', e); gracefulShutdown('UNCAUGHT_EXCEPTION'); });
process.on('unhandledRejection', (r, p) => { console.error('[PYXIS] 처리되지 않은 Promise 거부:', r, p); gracefulShutdown('UNHANDLED_REJECTION'); });
