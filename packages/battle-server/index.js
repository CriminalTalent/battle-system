/* packages/battle-server/index.js (ESM) */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import { Server as IOServer } from 'socket.io';

/* ─────────────────────────── 기본 설정 ─────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 배포용 기본 도메인 폴백(환경변수 없고/프록시 감지 실패 시 사용)
const HARDCODED_PUBLIC_BASE = 'https://pyxisbattlesystem.monster';
const ENV_PUBLIC_BASE = (process.env.BASE_URL || '').replace(/\/+$/,'') || '';

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: '/socket.io',
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', true); // 프록시 환경에서 proto/host 신뢰

/* ───────────────────── 정적 라우팅 + 별칭 (/admin 등) ───────────────────── */
const PUBLIC_DIR = path.resolve(__dirname, 'public');

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

const send = file => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/', send('admin.html'));          // 루트 → 관리자
app.get('/admin', send('admin.html'));
app.get('/player', send('player.html'));
app.get('/spectator', send('spectator.html'));

/* ─────────────────────────── 공용 유틸 ─────────────────────────── */
const battles = new Map(); // id -> battle state

const now = () => Date.now();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const d10 = () => randInt(1, 10);  // D10으로 통일
const uid = (p = '') => `${p}${Math.random().toString(16).slice(2, 10)}`;

// 팀 페이즈 제한시간 (5분)
const teamPhaseSeconds = Number(process.env.TEAM_PHASE_SECONDS || 300);
// 라운드 간 짧은 인터벌
const interRoundSeconds = Number(process.env.INTER_ROUND_SECONDS || 5);
// 전체 전투 제한시간 (1시간)
const battleTimeLimit = Number(process.env.BATTLE_TIME_LIMIT || 3600000); // 1시간 = 3,600,000ms

/* ────────────────── 업로드 (아바타) : /api/upload/avatar ────────────────── */
const uploadDir = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.png') || '.png';
    cb(null, `${Date.now()}_${uid('')}${ext}`);
  }
});
const upload = multer({ storage });

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
  res.json({ url: `/uploads/avatars/${req.file.filename}` });
});

/* ──────────────────────── API 라우트 ──────────────────────── */
app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: now() }));

// 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode } = req.body;
    const b = createBattle(mode);
    res.json({ ok: true, battleId: b.id, battle: battleSnapshot(b) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 링크 생성 (관리자)
app.post('/api/admin/battles/:id/links', async (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const baseUrl = resolvePublicBase(req);
    const out = await generateLinks(b, baseUrl);
    // 클라이언트가 기대하는 평평한 형태로 반환
    res.json({ ok: true, spectator: out.spectator, playerLinks: out.players });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 링크 생성 (호환 경로)
app.post('/api/battles/:id/links', async (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const baseUrl = resolvePublicBase(req);
    const out = await generateLinks(b, baseUrl);
    res.json({ ok: true, spectator: out.spectator, playerLinks: out.players });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ─────────────────────────── 배틀 관련 함수들 ─────────────────────────── */
function createBattle(mode = '2v2') {
  const id = `battle_${Date.now()}_${uid('')}`;
  const battle = {
    id, mode,
    status: 'waiting',
    phase: null,               // 'A_select' | 'B_select' | 'resolve' | 'inter'
    currentTeam: null,
    players: [],
    logs: [],
    turnNumber: 1,

    selectionQueue: [],
    selectorIndex: 0,
    currentPlayer: null,

    phaseDeadline: 0,
    roundEvents: [],

    _timer: null,
    _battleTimer: null,

    _startingTeam: 'A',
    spectatorOtp: uid('').slice(0, 8),
    createdAt: now()
  };
  battles.set(id, battle);
  startTick(battle);
  return battle;
}

function getBattle(id) {
  const b = battles.get(id);
  if (!b) throw new Error('NOT_FOUND');
  return b;
}

function battleSnapshot(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    phase: b.phase,
    createdAt: b.createdAt,
    players: (b.players || []).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      stats: p.stats,
      items: p.items,
      avatar: p.avatar,
      ready: !!p.ready,
      joinedAt: p.joinedAt
    })),
    currentTurn: {
      turnNumber: b.turnNumber,
      currentTeam: b.currentTeam,
      currentPlayer: b.currentPlayer ? {
        id: b.currentPlayer.id,
        name: b.currentPlayer.name,
        avatar: b.currentPlayer.avatar,
        team: b.currentPlayer.team
      } : null,
      timeLeftSec: Math.max(0, Math.floor((b.phaseDeadline - now()) / 1000))
    },
    logs: b.logs || []
  };
}

/* ────────────────────────── 라운드/페이즈 제어 ────────────────────────── */
function livingPlayers(battle, team = null) {
  return battle.players.filter(p => p.hp > 0 && (!team || p.team === team));
}

function setPhase(battle, phase, team, seconds) {
  battle.phase = phase;
  battle.currentTeam = team || null;
  battle.phaseDeadline = now() + Math.max(0, Number(seconds || 0)) * 1000;
  emitUpdate(battle);
}

function startTeamSelect(battle, team) {
  battle.selectionQueue = livingPlayers(battle, team);
  battle.selectorIndex = 0;
  battle.currentTeam = team || null;

  if (battle.selectionQueue.length === 0) {
    emitLog(battle, `${team}팀 생존자 없음 — 선택 스킵`, 'notice');
    if (team === 'A') enterBSelect(battle);
    else enterResolve(battle);
    return;
  }

  emitLog(battle, `=== ${team}팀 선택 페이즈 시작 ===`, 'battle');
  battle.currentPlayer = battle.selectionQueue[battle.selectorIndex] || null;
  setPhase(battle, `${team}_select`, team, teamPhaseSeconds);
}

function advanceSelector(battle) {
  let moved = false;
  while (true) {
    battle.selectorIndex += 1;
    if (battle.selectorIndex >= battle.selectionQueue.length) {
      battle.currentPlayer = null;
      moved = false;
      break;
    }
    const cand = battle.selectionQueue[battle.selectorIndex];
    if (cand && cand.hp > 0) {
      battle.currentPlayer = cand;
      moved = true;
      break;
    }
  }
  emitUpdate(battle);
  return moved;
}

function enterASelect(battle) {
  startTeamSelect(battle, battle._startingTeam || 'A');
}

function enterBSelect(battle) {
  const other = (battle._startingTeam === 'A') ? 'B' : 'A';
  startTeamSelect(battle, other);
}

function enterResolve(battle) {
  setPhase(battle, 'resolve', null, 1);
  emitLog(battle, '라운드 해석', 'battle');

  emitLog(battle, `=== ${battle.turnNumber}라운드 종료 ===`, 'battle');
  emitLog(battle, `${interRoundSeconds}초 후 다음 라운드 시작...`, 'notice');

  for (const p of battle.players) {
    if (p?.temp) {
      delete p.temp.attackBoostOneShot;
      delete p.temp.defenseBoostOneShot;
    }
    p.stance = 'none';
  }

  setTimeout(() => {
    setPhase(battle, 'inter', null, interRoundSeconds);
    setTimeout(() => startRound(battle), interRoundSeconds * 1000);
  }, 1000);
}

function startRound(battle) {
  if (battle.status !== 'active') return;

  emitLog(battle, `${battle.turnNumber}라운드 시작`, 'battle');
  battle.roundEvents = [];

  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    const winner = aliveA > 0 ? 'A' : 'B';
    endBattle(battle, winner);
    return;
  }

  const elapsed = now() - battle.createdAt;
  if (elapsed >= battleTimeLimit) {
    endBattleByTimeLimit(battle);
    return;
  }

  const firstTeam = battle.turnNumber % 2 === 1 ? battle._startingTeam : (battle._startingTeam === 'A' ? 'B' : 'A');
  battle._startingTeam = firstTeam;

  enterASelect(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

  const sumAgilityA = livingPlayers(battle, 'A').reduce((sum, p) => sum + (p.stats?.agility || 1), 0);
  const sumAgilityB = livingPlayers(battle, 'B').reduce((sum, p) => sum + (p.stats?.agility || 1), 0);
  
  let aTotal, bTotal;
  do {
    const aRoll = d10();
    const bRoll = d10();
    aTotal = sumAgilityA + aRoll;
    bTotal = sumAgilityB + bRoll;
    emitLog(battle, `선공 결정: A팀(민첩 ${sumAgilityA} + ${aRoll} = ${aTotal}) vs B팀(민첩 ${sumAgilityB} + ${bRoll} = ${bTotal})`, 'notice');
  } while (aTotal === bTotal);

  battle._startingTeam = aTotal > bTotal ? 'A' : 'B';
  emitLog(battle, `${battle._startingTeam}팀이 선공입니다!`, 'notice');

  battle.status = 'active';
  emitLog(battle, '전투가 시작되었습니다!', 'notice');
  battle.turnNumber = 1;

  battle._battleTimer = setTimeout(() => endBattleByTimeLimit(battle), battleTimeLimit);
  startRound(battle);
}

function endBattleByTimeLimit(battle) {
  if (battle.status === 'ended') return;

  const aliveA = livingPlayers(battle, 'A');
  const aliveB = livingPlayers(battle, 'B');
  const hpSumA = aliveA.reduce((sum, p) => sum + p.hp, 0);
  const hpSumB = aliveB.reduce((sum, p) => sum + p.hp, 0);

  emitLog(battle, '1시간 제한 시간 만료!', 'notice');
  emitLog(battle, `A팀 총 HP: ${hpSumA} vs B팀 총 HP: ${hpSumB}`, 'notice');

  let winner;
  if (hpSumA > hpSumB) winner = 'A';
  else if (hpSumB > hpSumA) winner = 'B';
  else if (aliveA.length > aliveB.length) winner = 'A';
  else if (aliveB.length > aliveA.length) winner = 'B';
  else winner = battle._startingTeam;

  endBattle(battle, winner);
}

function endBattle(battle, winner) {
  if (battle.status === 'ended') return;
  battle.status = 'ended';

  if (battle._timer) { clearInterval(battle._timer); battle._timer = null; }
  if (battle._battleTimer) { clearTimeout(battle._battleTimer); battle._battleTimer = null; }

  emitLog(battle, `${winner}팀 승리!`, 'notice');
  emitLog(battle, '전투가 종료되었습니다.', 'notice');

  io.to(battle.id).emit('battle:ended', { winner, message: '전투가 종료되었습니다.' });
  io.to(battle.id).emit('battleEnded',   { winner, message: '전투가 종료되었습니다.' });

  emitUpdate(battle);
}

/* ────────────────────────── 플레이어 관리 ────────────────────────── */
function addPlayer(battle, inp) {
  if (!inp?.name || !inp?.team) throw new Error('BAD_PLAYER');
  
  const p = {
    id: `p_${uid('')}`,
    team: (inp.team === 'B' ? 'B' : 'A'),
    name: String(inp.name),
    avatar: inp.avatar || '/uploads/avatars/default.svg',
    hp: Number(inp.hp || inp.maxHp || 100),
    maxHp: Number(inp.maxHp || inp.hp || 100),
    stats: {
      attack: Number(inp.stats?.attack ?? 1),
      defense: Number(inp.stats?.defense ?? 1),
      agility: Number(inp.stats?.agility ?? 1),
      luck: Number(inp.stats?.luck ?? 1)
    },
    items: {
      dittany: Number(inp.items?.dittany ?? inp.items?.ditany ?? 0),
      attackBooster: Number(inp.items?.attackBooster ?? inp.items?.attack_boost ?? 0),
      defenseBooster: Number(inp.items?.defenseBooster ?? inp.items?.defense_boost ?? 0)
    },
    ready: false,
    stance: 'none',
    temp: {},
    joinedAt: now()
  };
  
  battle.players.push(p);
  return p;
}

/* ────────────────────────── 전투 액션 ────────────────────────── */
function success60() { return Math.random() < 0.60; }

function isCriticalHit(luckStat) {
  const roll = d10();
  const threshold = 10 - Math.floor(luckStat / 2);
  return roll >= threshold;
}

function findRandomOpponent(battle, attacker) {
  const enemies = battle.players.filter(p => p.hp > 0 && p.team !== attacker.team);
  if (!enemies.length) return null;
  return enemies[randInt(0, enemies.length - 1)];
}

function rollFinalAttack(attacker, { attackBoostOnce = false } = {}) {
  const atkStat = Number(attacker.stats?.attack || 1);
  let final = atkStat + d10();
  const crit = isCriticalHit(attacker.stats?.luck || 1);
  if (crit) final *= 2;
  if (attackBoostOnce) final *= 2;
  return { final, crit };
}

function rollDefense(defender) {
  const defStat = Number(defender.stats?.defense || 1);
  let val = defStat + d10();
  if (defender?.temp?.defenseBoostOneShot) {
    val *= 2;
    defender.temp.defenseBoostOneShot = false;
  }
  return val;
}

function checkDodge(defender, attackerFinal) {
  const agi = Number(defender.stats?.agility || 1);
  return (agi + d10()) >= attackerFinal;
}

function applyDamage(battle, defender, dmg, attacker, isCrit) {
  const before = defender.hp;
  defender.hp = clamp(defender.hp - Math.max(0, Math.floor(dmg)), 0, defender.maxHp);
  const after = defender.hp;

  if (defender.hp <= 0) {
    emitLog(battle, `→ ${attacker.name}의 ${isCrit ? '치명타 ' : ''}공격으로 ${defender.name} 사망! (피해 ${before - after})`, 'battle');
  } else {
    emitLog(battle, `→ ${attacker.name}이(가) ${defender.name}에게 ${isCrit ? '치명타 ' : ''}공격 (피해 ${before - after}) → HP ${after}`, 'battle');
  }
}

function performAttack(battle, attacker, target, { attackBoostOnce = false } = {}) {
  const { final: finalAtk, crit } = rollFinalAttack(attacker, { attackBoostOnce });

  if (target.stance === 'dodge') {
    if (checkDodge(target, finalAtk)) emitLog(battle, `→ ${target.name}이(가) 회피 성공! 피해 0`, 'battle');
    else applyDamage(battle, target, finalAtk, attacker, crit);
  } else if (target.stance === 'defend') {
    const defVal = rollDefense(target);
    const remained = finalAtk - defVal;
    if (remained <= 0) emitLog(battle, `→ ${target.name}이(가) 방어 성공! 피해 0`, 'battle');
    else applyDamage(battle, target, remained, attacker, crit);
  } else {
    applyDamage(battle, target, finalAtk, attacker, crit);
  }
}

function resolveAction(battle, actor, payload) {
  const { type = 'pass' } = payload;

  switch (type) {
    case 'pass':
      emitLog(battle, `${actor.name} 패스`, 'battle');
      break;
    case 'defend':
      actor.stance = 'defend';
      emitLog(battle, `${actor.name}이(가) 방어 자세`, 'battle');
      break;
    case 'dodge':
      actor.stance = 'dodge';
      emitLog(battle, `${actor.name}이(가) 회피 자세`, 'battle');
      break;
    case 'attack': {
      const target = payload?.targetId 
        ? battle.players.find(p => p.id === payload.targetId && p.hp > 0)
        : findRandomOpponent(battle, actor);

      if (!target) { emitLog(battle, `${actor.name}의 공격 대상을 찾을 수 없습니다`, 'battle'); break; }
      if (target.team === actor.team) { emitLog(battle, `${actor.name}이(가) 아군을 공격할 수 없습니다`, 'battle'); break; }

      performAttack(battle, actor, target);
      break;
    }
    case 'item': {
      const item = payload?.item || '';
      if (item === 'dittany' || item === 'ditany') {
        if ((actor.items?.dittany || 0) <= 0) { emitLog(battle, `${actor.name}의 디터니가 없습니다`, 'battle'); break; }
        actor.items.dittany -= 1;
        const target = payload?.targetId ? battle.players.find(p => p.id === payload.targetId && p.hp > 0) : actor;
        if (!target) { emitLog(battle, `${actor.name}의 디터니 사용 실패 (사망자)`, 'battle'); break; }
        const before = target.hp;
        const heal = 10;
        target.hp = clamp(target.hp + heal, 0, target.maxHp || 100);
        emitLog(battle, `${actor.name}이(가) ${target.name}에게 디터니 사용 (+${target.hp - before}) → HP ${target.hp}`, 'battle');
      } else if (item === 'attackBooster') {
        if ((actor.items?.attackBooster || 0) <= 0) { emitLog(battle, `${actor.name}의 공격 보정기가 없습니다`, 'battle'); break; }
        actor.items.attackBooster -= 1;
        const target = payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0);
        if (!target) { emitLog(battle, `${actor.name}의 공격 보정기 사용 실패 (대상 없음)`, 'battle'); break; }
        if (!success60()) emitLog(battle, `${actor.name}의 공격 보정기 사용 실패 (확률)`, 'battle');
        else { emitLog(battle, `${actor.name}이(가) 공격 보정기 사용 성공 — ${target.name} 대상 즉시 강화 공격`, 'battle'); performAttack(battle, actor, target, { attackBoostOnce: true }); }
      } else if (item === 'defenseBooster') {
        if ((actor.items?.defenseBooster || 0) <= 0) { emitLog(battle, `${actor.name}의 방어 보정기가 없습니다`, 'battle'); break; }
        actor.items.defenseBooster -= 1;
        const ally = payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0 && p.team === actor.team);
        if (!ally) { emitLog(battle, `${actor.name}의 방어 보정기 사용 실패 (아군 대상 없음)`, 'battle'); break; }
        if (!success60()) emitLog(battle, `${actor.name}의 방어 보정기 사용 실패 (확률)`, 'battle');
        else { ally.temp = ally.temp || {}; ally.temp.defenseBoostOneShot = true; emitLog(battle, `${actor.name}이(가) ${ally.name}에게 방어 보정기 적용 (이번 턴 방어 1회 2배)`, 'battle'); }
      } else {
        emitLog(battle, `${actor.name}의 알 수 없는 아이템 사용`, 'battle');
      }
      break;
    }
    default:
      emitLog(battle, `${actor.name}의 알 수 없는 행동 (패스 처리)`, 'battle');
  }

  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) { endBattle(battle, aliveA > 0 ? 'A' : 'B'); return; }

  if (!advanceSelector(battle)) {
    emitLog(battle, `[${battle.currentTeam}] ${battle.currentTeam}팀 선택 완료`, 'battle');
    if (battle.currentTeam === 'A') enterBSelect(battle);
    else enterResolve(battle);
  }
}

/* ────────────────────────── 링크 생성 ────────────────────────── */
function resolvePublicBase(req) {
  // 1순위: BASE_URL (환경)
  if (ENV_PUBLIC_BASE) return ENV_PUBLIC_BASE;

  // 2순위: 프록시 헤더/요청 기반
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host  = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const derived = `${proto}://${host}`;

  // 로컬호스트로 감지되면 하드코딩 도메인으로 폴백
  if (!host || /localhost|127\.0\.0\.1/i.test(host)) return HARDCODED_PUBLIC_BASE;
  return derived.replace(/\/+$/,'');
}

async function generateLinks(battle, baseUrl) {
  const spectatorOtp = battle.spectatorOtp;
  const spectatorUrl = `${baseUrl}/spectator?battle=${battle.id}&otp=${spectatorOtp}`;

  const playerLinks = battle.players.map(p => {
    const token = `${p.id}_${uid('')}`;
    const playerUrl = `${baseUrl}/player?battle=${battle.id}&token=${token}`;
    return { name: p.name, team: p.team, token, url: playerUrl };
  });

  return {
    spectator: { otp: spectatorOtp, url: spectatorUrl },
    players: playerLinks
  };
}

/* ────────────────────────── 브로드캐스트/로그 ────────────────────────── */
function emitUpdate(battle) {
  const snapshot = battleSnapshot(battle);
  io.to(battle.id).emit('battle:update', snapshot);
  io.to(battle.id).emit('battleUpdate', snapshot);
}

function emitLog(battle, message, type = 'system') {
  const logEntry = { ts: now(), type, message: String(message) };
  battle.logs = battle.logs || [];
  battle.logs.push(logEntry);
  if (battle.logs.length > 500) battle.logs = battle.logs.slice(-500);
  io.to(battle.id).emit('battle:log', logEntry);
  io.to(battle.id).emit('battleLog', logEntry);
}

/* ────────────────────────── 타이머 ────────────────────────── */
function startTick(battle) {
  if (battle._timer) return;
  battle._timer = setInterval(() => {
    if (battle.status !== 'active') return;
    if (battle.phaseDeadline > 0 && now() >= battle.phaseDeadline) handlePhaseTimeout(battle);
    emitUpdate(battle);
  }, 1000);
}

function handlePhaseTimeout(battle) {
  if (battle.phase?.endsWith('_select')) {
    const team = battle.currentTeam;
    emitLog(battle, `${team}팀 선택 시간 초과 - 자동 패스 처리`, 'notice');
    if (battle.currentPlayer) resolveAction(battle, battle.currentPlayer, { type: 'pass' });
    while (advanceSelector(battle)) {
      if (battle.currentPlayer) resolveAction(battle, battle.currentPlayer, { type: 'pass' });
    }
    if (team === 'A') enterBSelect(battle);
    else enterResolve(battle);
  }
}

/* ────────────────────────── 소켓 이벤트 ────────────────────────── */
io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);

  socket.on('join', ({ battleId }, cb) => {
    try {
      const battle = getBattle(battleId);
      socket.join(battleId);
      socket.emit('battle:update', battleSnapshot(battle));
      socket.emit('battleUpdate', battleSnapshot(battle));
      if (battle.logs?.length) {
        battle.logs.slice(-10).forEach(log => {
          socket.emit('battle:log', log);
          socket.emit('battleLog', log);
        });
      }
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('playerAuth', ({ battleId, token }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => token.startsWith(p.id + '_'));
      if (!player) { cb?.({ ok: false, error: 'INVALID_TOKEN' }); return; }
      socket.join(battleId);
      cb?.({ ok: true, player });
      socket.emit('auth:success', { role: 'player', battleId, playerId: player.id, team: player.team, name: player.name });
      socket.emit('authSuccess',  { role: 'player', battleId, playerId: player.id, team: player.team, name: player.name });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
      socket.emit('authError', { error: e.message });
      socket.emit('auth:error', { error: e.message });
    }
  });

  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      if (!player) { cb?.({ ok: false, error: 'PLAYER_NOT_FOUND' }); return; }
      player.ready = true;
      emitLog(battle, `${player.name}이(가) 준비 완료했습니다`, 'notice');
      emitUpdate(battle);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    try {
      const battle = getBattle(battleId);
      if (battle.status !== 'active') { cb?.({ ok: false, error: 'NOT_ACTIVE' }); return; }
      const actor = battle.players.find(x => x.id === playerId);
      if (!actor || actor.hp <= 0) { cb?.({ ok: false, error: 'DEAD' }); return; }
      if (!(battle.phase === `${actor.team}_select` && battle.currentPlayer?.id === actor.id)) {
        cb?.({ ok: false, error: 'NOT_YOUR_TURN' }); return;
      }
      resolveAction(battle, actor, action || { type: 'pass' });
      cb?.({ ok: true });
      socket.emit('actionSuccess');
      socket.emit('player:action:success');
    } catch (e) { cb?.({ ok: false, error: e?.message || 'ERR' }); }
  });

  socket.on('createBattle', ({ mode }, cb) => {
    try { const battle = createBattle(mode || '2v2'); cb?.({ ok: true, battleId: battle.id }); }
    catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('startBattle', ({ battleId }, cb) => {
    try { const b = getBattle(battleId); startBattle(b); cb?.({ ok: true }); }
    catch { cb?.({ ok: false }); }
  });

  socket.on('pauseBattle', ({ battleId }, cb) => {
    try { const b = getBattle(battleId); b.status = 'paused'; emitLog(b, '일시정지', 'notice'); emitUpdate(b); cb?.({ ok: true }); }
    catch { cb?.({ ok: false }); }
  });

  socket.on('resumeBattle', ({ battleId }, cb) => {
    try { const b = getBattle(battleId); b.status = 'active'; emitLog(b, '재개', 'notice'); emitUpdate(b); cb?.({ ok: true }); }
    catch { cb?.({ ok: false }); }
  });

  socket.on('endBattle', ({ battleId }, cb) => {
    try { const b = getBattle(battleId); endBattle(b, 'MANUAL'); cb?.({ ok: true }); }
    catch { cb?.({ ok: false }); }
  });

  socket.on('addPlayer', ({ battleId, player }, cb) => {
    try {
      const b = getBattle(battleId);
      const p = addPlayer(b, player);
      emitLog(b, `${p.name}이(가) ${p.team}팀으로 참가했습니다`, 'notice');
      emitUpdate(b);
      cb?.({ ok: true, player: p });
    } catch (e) { cb?.({ ok: false, error: e?.message || 'ERR' }); }
  });

  socket.on('deletePlayer', ({ battleId, playerId }, cb) => {
    try {
      const b = getBattle(battleId);
      const idx = b.players.findIndex(p => p.id === playerId);
      if (idx >= 0) {
        const name = b.players[idx].name;
        b.players.splice(idx, 1);
        emitLog(b, `${name}이(가) 전투에서 제거되었습니다`, 'notice');
        emitUpdate(b);
      }
      cb?.({ ok: true });
    } catch { cb?.({ ok: false }); }
  });

  socket.on('removePlayer', ({ battleId, playerId }, cb) => {
    socket.emit('deletePlayer', { battleId, playerId }, cb);
  });

  socket.on('chatMessage', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const chatData = { name: name || '익명', message: String(message || '').slice(0, 500) };
      io.to(battleId).emit('chatMessage', chatData);
      io.to(battleId).emit('battle:chat', chatData);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('spectator:cheer', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const cheerData = { name: `[응원] ${name || '관전자'}`, message: String(message || '').trim() };
      if (cheerData.message) {
        io.to(battleId).emit('chatMessage', cheerData);
        io.to(battleId).emit('battle:chat', cheerData);
        io.to(battleId).emit('spectator:cheer', cheerData);
        io.to(battleId).emit('cheerMessage', cheerData);
      }
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] 연결 해제:', socket.id);
  });
});

/* ────────────────────────── 서버 시작 ────────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS Battle Server running on http://${HOST}:${PORT}`);
  console.log(`Admin: http://${HOST}:${PORT}/admin`);
  console.log(`Player: http://${HOST}:${PORT}/player`);
  console.log(`Spectator: http://${HOST}:${PORT}/spectator`);
});
