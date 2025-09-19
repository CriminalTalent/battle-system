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

// 도메인은 환경변수로 강제(요청하신 https://pyxisbattlesystem.monster/ 사용)
// .env 등에 BASE_URL=https://pyxisbattlesystem.monster 로 설정해 주세요.
const PUBLIC_BASE_URL =
  process.env.BASE_URL?.trim() ||
  process.env.PUBLIC_BASE_URL?.trim() ||
  `http://localhost:${PORT}`;

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: '/socket.io',
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));

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
app.get('/', send('admin.html'));
app.get('/admin', send('admin.html'));
app.get('/player', send('player.html'));
app.get('/spectator', send('spectator.html'));

/* ─────────────────────────── 공용 유틸 ─────────────────────────── */
const battles = new Map(); // id -> battle state
const now = () => Date.now();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const d10 = () => randInt(1, 10);
const uid = (p = '') => `${p}${Math.random().toString(16).slice(2, 10)}`;

// 팀 페이즈 제한시간 (5분)
const teamPhaseSeconds = Number(process.env.TEAM_PHASE_SECONDS || 300);
// 라운드 간 짧은 인터벌
const interRoundSeconds = Number(process.env.INTER_ROUND_SECONDS || 5);
// 전체 전투 제한시간 (1시간)
const battleTimeLimit = Number(process.env.BATTLE_TIME_LIMIT || 3600000);

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

// HTTP: 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode } = req.body;
    const b = createBattle(mode);
    res.json({ ok: true, battleId: b.id, battle: battleSnapshot(b) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// HTTP: 링크 생성 (관리자/호환)
async function handleGenLinks(req, res) {
  try {
    const b = getBattle(req.params.id);
    const links = await generateLinks(b);
    res.json({ ok: true, links });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
app.post('/api/admin/battles/:id/links', handleGenLinks);
app.post('/api/battles/:id/links', handleGenLinks);

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

    // 선택 큐
    selectionQueue: [],
    selectorIndex: 0,

    // UI 호환용
    currentPlayer: null,

    // 타이머
    phaseDeadline: 0,

    // 라운드 요약(해석 단계에서 금색 출력)
    roundEvents: [],

    // 내부 타이머
    _timer: null,
    _battleTimer: null,

    // 선공
    _startingTeam: 'A',

    // 관전자 OTP
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
const livingPlayers = (battle, team = null) =>
  battle.players.filter(p => p.hp > 0 && (!team || p.team === team));

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

  emitLog(battle, `=== ${team}팀 선택 페이즈 시작 ===`, 'notice');

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

const enterASelect = battle =>
  startTeamSelect(battle, battle._startingTeam || 'A');

const enterBSelect = battle => {
  const other = (battle._startingTeam === 'A') ? 'B' : 'A';
  startTeamSelect(battle, other);
};

function enterResolve(battle) {
  setPhase(battle, 'resolve', null, 1);
  emitLog(battle, '라운드 해석', 'notice');

  // 금색 배경으로 순서대로 출력
  for (const ev of battle.roundEvents) {
    emitLog(battle, ev, 'result');
  }

  emitLog(battle, `=== ${battle.turnNumber}라운드 종료 ===`, 'notice');
  emitLog(battle, `${interRoundSeconds}초 후 다음 라운드 시작...`, 'notice');

  // 임시효과 정리
  for (const p of battle.players) {
    if (p?.temp) {
      delete p.temp.attackBoostOneShot;
      delete p.temp.defenseBoostOneShot;
    }
    p.stance = 'none';
  }

  // 다음 라운드
  setTimeout(() => {
    setPhase(battle, 'inter', null, interRoundSeconds);
    setTimeout(() => startRound(battle), interRoundSeconds * 1000);
  }, 1000);
}

function startRound(battle) {
  if (battle.status !== 'active') return;

  emitLog(battle, `${battle.turnNumber}라운드 시작`, 'notice');

  // 라운드 이벤트 초기화
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

  const firstTeam =
    battle.turnNumber % 2 === 1 ? battle._startingTeam :
    (battle._startingTeam === 'A' ? 'B' : 'A');
  battle._startingTeam = firstTeam;

  enterASelect(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

  const sumAgilityA = livingPlayers(battle, 'A').reduce((s, p) => s + (p.stats?.agility || 1), 0);
  const sumAgilityB = livingPlayers(battle, 'B').reduce((s, p) => s + (p.stats?.agility || 1), 0);

  let aTotal, bTotal, aRoll, bRoll;
  do {
    aRoll = d10(); bRoll = d10();
    aTotal = sumAgilityA + aRoll;
    bTotal = sumAgilityB + bRoll;
  } while (aTotal === bTotal);

  battle._startingTeam = aTotal > bTotal ? 'A' : 'B';

  // 요구 포맷: A팀 (팀내민첩 총합+D10) vs B팀 (팀내민첩 총합+D10) → 선공 A팀
  emitLog(
    battle,
    `A팀 (${sumAgilityA}+${aRoll}) vs B팀 (${sumAgilityB}+${bRoll}) → 선공 ${battle._startingTeam}팀`,
    'notice'
  );

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

  const hpSumA = aliveA.reduce((s, p) => s + p.hp, 0);
  const hpSumB = aliveB.reduce((s, p) => s + p.hp, 0);

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
const success60 = () => Math.random() < 0.60;

function isCriticalHit(luckStat) {
  const roll = d10();
  const threshold = 10 - Math.floor((luckStat || 1) / 2);
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

const checkDodge = (defender, attackerFinal) =>
  (Number(defender.stats?.agility || 1) + d10()) >= attackerFinal;

function applyDamage(battle, defender, dmg, attacker, isCrit, pushToSummary = false) {
  const before = defender.hp;
  defender.hp = clamp(defender.hp - Math.max(0, Math.floor(dmg)), 0, defender.maxHp);
  const after = defender.hp;

  const msg = (defender.hp <= 0)
    ? `→ ${attacker.name}의 ${isCrit ? '치명타 ' : ''}공격으로 ${defender.name} 사망! (피해 ${before - after})`
    : `→ ${attacker.name}이(가) ${defender.name}에게 ${isCrit ? '치명타 ' : ''}공격 (피해 ${before - after}) → HP ${after}`;

  if (pushToSummary) battle.roundEvents.push(msg);
  else emitLog(battle, msg, attacker.team === 'A' ? 'teamA' : 'teamB');
}

function performAttack(battle, attacker, target, { attackBoostOnce = false, pushToSummary = false } = {}) {
  const { final: finalAtk, crit } = rollFinalAttack(attacker, { attackBoostOnce });

  if (target.stance === 'dodge') {
    if (checkDodge(target, finalAtk)) {
      const msg = `→ ${target.name}이(가) 회피 성공! 피해 0`;
      if (pushToSummary) battle.roundEvents.push(msg);
      else emitLog(battle, msg, attacker.team === 'A' ? 'teamA' : 'teamB');
      return;
    }
    applyDamage(battle, target, finalAtk, attacker, crit, pushToSummary);
  } else if (target.stance === 'defend') {
    const defVal = rollDefense(target);
    const remained = finalAtk - defVal;
    if (remained <= 0) {
      const msg = `→ ${target.name}이(가) 방어 성공! 피해 0`;
      if (pushToSummary) battle.roundEvents.push(msg);
      else emitLog(battle, msg, attacker.team === 'A' ? 'teamA' : 'teamB');
    } else {
      applyDamage(battle, target, remained, attacker, crit, pushToSummary);
    }
  } else {
    applyDamage(battle, target, finalAtk, attacker, crit, pushToSummary);
  }
}

function resolveAction(battle, actor, payload) {
  const { type = 'pass' } = payload;

  switch (type) {
    case 'pass':
      emitLog(battle, `${actor.name} 패스`, actor.team === 'A' ? 'teamA' : 'teamB');
      break;

    case 'defend':
      actor.stance = 'defend';
      emitLog(battle, `${actor.name}이(가) 방어 자세`, actor.team === 'A' ? 'teamA' : 'teamB');
      break;

    case 'dodge':
      actor.stance = 'dodge';
      emitLog(battle, `${actor.name}이(가) 회피 자세`, actor.team === 'A' ? 'teamA' : 'teamB');
      break;

    case 'attack': {
      // 즉시 간단 로그(팀색) + 실제 피해 로그는 roundEvents에만 저장(해석 단계 금색)
      const target = payload?.targetId
        ? battle.players.find(p => p.id === payload.targetId && p.hp > 0)
        : findRandomOpponent(battle, actor);

      if (!target) { emitLog(battle, `${actor.name}의 공격 대상을 찾을 수 없습니다`, 'notice'); break; }
      if (target.team === actor.team) { emitLog(battle, `${actor.name}이(가) 아군을 공격할 수 없습니다`, 'notice'); break; }

      // 즉시 간단 알림(피해/수치 없음)
      emitLog(battle, `→ ${actor.name}이(가) ${target.name}에게 공격`, actor.team === 'A' ? 'teamA' : 'teamB');

      // 실제 계산/적용은 즉시 하되, 상세 메시지는 roundEvents로 보내 해석 단계에서 금색으로 출력
      performAttack(battle, actor, target, { pushToSummary: true });
      break;
    }

    case 'item': {
      const item = payload?.item || '';

      if (item === 'dittany' || item === 'ditany') {
        if ((actor.items?.dittany || 0) <= 0) { emitLog(battle, `${actor.name}의 디터니가 없습니다`, 'notice'); break; }
        actor.items.dittany -= 1;
        const target = payload?.targetId ? battle.players.find(p => p.id === payload.targetId && p.hp > 0) : actor;
        if (!target) { emitLog(battle, `${actor.name}의 디터니 사용 실패 (사망자)`, 'notice'); break; }
        const before = target.hp;
        const heal = 10;
        target.hp = clamp(target.hp + heal, 0, target.maxHp || 100);
        // 해석 단계에서 금색 출력
        battle.roundEvents.push(`${actor.name}이(가) ${target.name}에게 디터니 사용 (+${target.hp - before}) → HP ${target.hp}`);
        break;
      }

      if (item === 'attackBooster') {
        if ((actor.items?.attackBooster || 0) <= 0) { emitLog(battle, `${actor.name}의 공격 보정기가 없습니다`, 'notice'); break; }
        actor.items.attackBooster -= 1;

        const target = payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0);
        if (!target) { emitLog(battle, `${actor.name}의 공격 보정기 사용 실패 (대상 없음)`, 'notice'); break; }

        if (!success60()) {
          battle.roundEvents.push(`${actor.name}의 공격 보정기 사용 실패 (확률)`);
        } else {
          battle.roundEvents.push(`${actor.name}이(가) 공격 보정기 사용 성공 — ${target.name} 대상 즉시 강화 공격`);
          performAttack(battle, actor, target, { attackBoostOnce: true, pushToSummary: true });
        }
        break;
      }

      if (item === 'defenseBooster') {
        if ((actor.items?.defenseBooster || 0) <= 0) { emitLog(battle, `${actor.name}의 방어 보정기가 없습니다`, 'notice'); break; }
        actor.items.defenseBooster -= 1;

        const ally = payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0 && p.team === actor.team);
        if (!ally) { emitLog(battle, `${actor.name}의 방어 보정기 사용 실패 (아군 대상 없음)`, 'notice'); break; }

        if (!success60()) {
          battle.roundEvents.push(`${actor.name}의 방어 보정기 사용 실패 (확률)`);
        } else {
          ally.temp = ally.temp || {};
          ally.temp.defenseBoostOneShot = true;
          battle.roundEvents.push(`${actor.name}이(가) ${ally.name}에게 방어 보정기 적용 (이번 턴 방어 1회 2배)`);
        }
        break;
      }

      emitLog(battle, `${actor.name}의 알 수 없는 아이템 사용`, 'notice');
      break;
    }

    default:
      emitLog(battle, `${actor.name}의 알 수 없는 행동 (패스 처리)`, 'notice');
  }

  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    const winner = aliveA > 0 ? 'A' : 'B';
    endBattle(battle, winner);
    return;
  }

  if (!advanceSelector(battle)) {
    emitLog(battle, `[${battle.currentTeam}] ${battle.currentTeam}팀 선택 완료`, 'notice');
    if (battle.currentTeam === 'A') enterBSelect(battle);
    else enterResolve(battle);
  }
}

/* ────────────────────────── 링크 생성 ────────────────────────── */
async function generateLinks(battle) {
  const baseUrl = PUBLIC_BASE_URL; // 도메인 고정
  const spectatorOtp = battle.spectatorOtp;
  const spectatorUrl = `${baseUrl}/spectator?battle=${battle.id}&otp=${spectatorOtp}`;

  const playerLinks = battle.players.map(p => {
    const token = `${p.id}_${uid('')}`;
    const playerUrl = `${baseUrl}/player?battle=${battle.id}&token=${token}`;
    return { name: p.name, team: p.team, token, url: playerUrl };
  });

  return { spectator: { otp: spectatorOtp, url: spectatorUrl }, players: playerLinks };
}

/* ────────────────────────── 브로드캐스트 함수 ────────────────────────── */
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

/* ────────────────────────── 타이머 관리 ────────────────────────── */
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

/* ────────────────────────── 소켓 이벤트 핸들링 ────────────────────────── */
io.on('connection', (socket) => {
  // 방 입장
  socket.on('join', ({ battleId }, cb) => {
    try {
      const battle = getBattle(battleId);
      socket.join(battleId);

      socket.emit('battle:update', battleSnapshot(battle));
      socket.emit('battleUpdate', battleSnapshot(battle));

      if (battle.logs && battle.logs.length > 0) {
        battle.logs.slice(-10).forEach(log => {
          socket.emit('battle:log', log);
          socket.emit('battleLog', log);
        });
      }
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // 플레이어 인증
  socket.on('playerAuth', ({ battleId, token, name }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => token.startsWith(p.id + '_'));
      if (!player) return cb?.({ ok: false, error: 'INVALID_TOKEN' });

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

  // 준비 완료
  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      if (!player) return cb?.({ ok: false, error: 'PLAYER_NOT_FOUND' });
      player.ready = true;
      emitLog(battle, `${player.name}이(가) 준비 완료했습니다`, 'notice');
      emitUpdate(battle);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // 플레이어 행동
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    try {
      const battle = getBattle(battleId);
      if (battle.status !== 'active') return cb?.({ ok: false, error: 'NOT_ACTIVE' });

      const actor = battle.players.find(x => x.id === playerId);
      if (!actor || actor.hp <= 0) return cb?.({ ok: false, error: 'DEAD' });

      if (!(battle.phase === `${actor.team}_select` && battle.currentPlayer && battle.currentPlayer.id === actor.id)) {
        return cb?.({ ok: false, error: 'NOT_YOUR_TURN' });
      }

      const payload = action || { type: 'pass' };
      resolveAction(battle, actor, payload);

      cb?.({ ok: true });
      socket.emit('actionSuccess');
      socket.emit('player:action:success');
    } catch (e) {
      cb?.({ ok: false, error: e?.message || 'ERR' });
    }
  });

  // 관리자 제어
  socket.on('createBattle', ({ mode }, cb) => {
    try {
      const battle = createBattle(mode || '2v2');
      cb?.({ ok: true, battleId: battle.id, battle });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('startBattle', ({ battleId }, cb) => {
    try {
      const b = getBattle(battleId);
      startBattle(b);
      cb?.({ ok: true });
    } catch { cb?.({ ok: false }); }
  });

  socket.on('pauseBattle', ({ battleId }, cb) => {
    try {
      const b = getBattle(battleId);
      b.status = 'paused';
      emitLog(b, '일시정지', 'notice');
      emitUpdate(b);
      cb?.({ ok: true });
    } catch { cb?.({ ok: false }); }
  });

  socket.on('resumeBattle', ({ battleId }, cb) => {
    try {
      const b = getBattle(battleId);
      b.status = 'active';
      emitLog(b, '재개', 'notice');
      emitUpdate(b);
      cb?.({ ok: true });
    } catch { cb?.({ ok: false }); }
  });

  socket.on('endBattle', ({ battleId }, cb) => {
    try {
      const b = getBattle(battleId);
      endBattle(b, 'MANUAL');
      cb?.({ ok: true });
    } catch { cb?.({ ok: false }); }
  });

  socket.on('addPlayer', ({ battleId, player }, cb) => {
    try {
      const b = getBattle(battleId);
      const p = addPlayer(b, player);
      emitLog(b, `${p.name}이(가) ${p.team}팀으로 참가했습니다`, 'notice');
      emitUpdate(b);
      cb?.({ ok: true, player: p });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || 'ERR' });
    }
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

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const chatData = {
        name: name || '익명',
        message: String(message || '').slice(0, 500)
      };
      // 하나의 이벤트명만 사용해도 되지만, 호환을 위해 둘 다 송신
      io.to(battleId).emit('chatMessage', chatData);
      io.to(battleId).emit('battle:chat', chatData);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // 관전자 응원
  socket.on('spectator:cheer', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const cheerData = {
        name: `[응원] ${name || '관전자'}`,
        message: String(message || '').trim()
      };
      if (cheerData.message) {
        io.to(battleId).emit('chatMessage', cheerData);
        io.to(battleId).emit('battle:chat', cheerData);
        io.to(battleId).emit('spectator:cheer', cheerData);
        io.to(battleId).emit('cheerMessage', cheerData);
      }
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });
});

/* ────────────────────────── 서버 시작 ────────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS Battle Server running on http://${HOST}:${PORT}`);
  console.log(`Admin: ${PUBLIC_BASE_URL}/admin`);
  console.log(`Player: ${PUBLIC_BASE_URL}/player`);
  console.log(`Spectator: ${PUBLIC_BASE_URL}/spectator`);
});
