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

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: '/socket.io',
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));

/* ───────────────────── 정적 라우팅 + 별칭 ───────────────────── */
const PUBLIC_DIR = path.resolve(__dirname, 'public');

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
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

const teamPhaseSeconds = Number(process.env.TEAM_PHASE_SECONDS || 300);
const interRoundSeconds = Number(process.env.INTER_ROUND_SECONDS || 5);
const battleTimeLimit = Number(process.env.BATTLE_TIME_LIMIT || 3600000);

/* ────────────────── 업로드 (아바타) ────────────────── */
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

app.post('/api/battles', (req, res) => {
  try {
    const { mode } = req.body;
    const b = createBattle(mode);
    res.json({ ok: true, battleId: b.id, battle: battleSnapshot(b) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* 링크 생성: 프론트가 기대하는 형태로 평탄화 */
app.post('/api/admin/battles/:id/links', async (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const links = await generateLinks(b);
    res.json({
      spectator: links.spectator,
      playerLinks: links.players.map(p => ({ playerName: p.name, team: p.team, url: p.url }))
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/battles/:id/links', async (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const links = await generateLinks(b);
    res.json({
      spectator: links.spectator,
      playerLinks: links.players.map(p => ({ playerName: p.name, team: p.team, url: p.url }))
    });
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
    phase: null,                 // 'A_select' | 'B_select' | 'resolve' | 'inter'
    currentTeam: null,
    players: [],
    logs: [],
    turnNumber: 1,

    // 선택 큐
    selectionQueue: [],
    selectorIndex: 0,

    // UI 호환용
    currentPlayer: null,

    // 페이즈 타이머
    phaseDeadline: 0,

    // 라운드 액션/요약
    roundActions: [],  // [{actorId, team, type, payload, ts}]
    roundEvents: [],

    // 내부 타이머
    _timer: null,
    _battleTimer: null,

    _startingTeam: 'A',   // 이번 라운드 선공 팀
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
  // 선택 큐: 생존자만 + 팀 내부 정렬(민첩 내림차순, 동률은 이름 알파벳 내림차순)
  battle.selectionQueue = livingPlayers(battle, team).sort((a, b) => {
    const aA = Number(a.stats?.agility || 1);
    const bA = Number(b.stats?.agility || 1);
    if (bA !== aA) return bA - aA;
    return b.name.localeCompare(a.name, 'ko', { sensitivity: 'base' }); // 알파벳/가나다 정렬
  });
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

  // 순서대로 액션 적용
  for (const act of battle.roundActions) {
    const actor = battle.players.find(p => p.id === act.actorId && p.hp > 0);
    if (!actor) continue;

    switch (act.type) {
      case 'pass':
        emitLog(battle, `${actor.name} 패스 (결과)`, 'battle');
        break;

      case 'defend':
        actor.stance = 'defend';
        emitLog(battle, `${actor.name} 방어 자세 (결과)`, 'battle');
        break;

      case 'dodge':
        actor.stance = 'dodge';
        emitLog(battle, `${actor.name} 회피 자세 (결과)`, 'battle');
        break;

      case 'attack': {
        const target = act.payload?.targetId
          ? battle.players.find(p => p.id === act.payload.targetId && p.hp > 0)
          : findRandomOpponent(battle, actor);

        if (!target || target.team === actor.team) {
          emitLog(battle, `${actor.name}의 공격 대상 없음 (결과)`, 'battle');
        } else {
          performAttack(battle, actor, target, { attackBoostOnce: !!act.payload?.attackBoostOnce, resultLog: true });
        }
        break;
      }

      case 'item': {
        const item = act.payload?.item || '';
        if (item === 'dittany' || item === 'ditany') {
          if ((actor.items?.dittany || 0) <= 0) {
            emitLog(battle, `${actor.name}의 디터니 없음 (결과)`, 'battle');
            break;
          }
          const target = act.payload?.targetId
            ? battle.players.find(p => p.id === act.payload.targetId && p.hp > 0)
            : actor;
          if (!target) {
            emitLog(battle, `${actor.name}의 디터니 사용 실패 (결과)`, 'battle');
            break;
          }
          actor.items.dittany -= 1;
          const before = target.hp;
          const heal = 10;
          target.hp = clamp(target.hp + heal, 0, target.maxHp || 100);
          emitLog(battle, `${actor.name}→${target.name} 디터니 (+${target.hp - before}) → HP ${target.hp} (결과)`, 'battle');

        } else if (item === 'attackBooster') {
          if ((actor.items?.attackBooster || 0) <= 0) {
            emitLog(battle, `${actor.name}의 공격 보정기 없음 (결과)`, 'battle');
            break;
          }
          const target = act.payload?.targetId && battle.players.find(p => p.id === act.payload.targetId && p.hp > 0);
          if (!target) {
            emitLog(battle, `${actor.name}의 공격 보정기 대상 없음 (결과)`, 'battle');
            break;
          }
          actor.items.attackBooster -= 1;
          if (!success60()) {
            emitLog(battle, `${actor.name}의 공격 보정기 실패 (확률) (결과)`, 'battle');
          } else {
            emitLog(battle, `${actor.name} 공격 보정 성공 — ${target.name} 강화공격 (결과)`, 'battle');
            performAttack(battle, actor, target, { attackBoostOnce: true, resultLog: true });
          }

        } else if (item === 'defenseBooster') {
          if ((actor.items?.defenseBooster || 0) <= 0) {
            emitLog(battle, `${actor.name}의 방어 보정기 없음 (결과)`, 'battle');
            break;
          }
          const ally = act.payload?.targetId && battle.players.find(p => p.id === act.payload.targetId && p.hp > 0 && p.team === actor.team);
          if (!ally) {
            emitLog(battle, `${actor.name}의 방어 보정기 대상 없음 (결과)`, 'battle');
            break;
          }
          actor.items.defenseBooster -= 1;
          if (!success60()) {
            emitLog(battle, `${actor.name}의 방어 보정기 실패 (확률) (결과)`, 'battle');
          } else {
            ally.temp = ally.temp || {};
            ally.temp.defenseBoostOneShot = true;
            emitLog(battle, `${actor.name}→${ally.name} 방어 보정 적용 (이번 턴 방어 1회 2배) (결과)`, 'battle');
          }
        } else {
          emitLog(battle, `${actor.name}의 알 수 없는 아이템 (결과)`, 'battle');
        }
        break;
      }
      default:
        emitLog(battle, `${actor.name}의 알 수 없는 행동 (결과)`, 'battle');
    }
  }

  // 요약/마무리
  emitLog(battle, `=== ${battle.turnNumber}라운드 종료 ===`, 'battle');
  emitLog(battle, `${interRoundSeconds}초 후 다음 라운드 시작...`, 'notice');

  // 임시효과 정리
  for (const p of battle.players) {
    if (p?.temp) {
      delete p.temp.attackBoostOneShot;
      delete p.temp.defenseBoostOneShot;
    }
    p.stance = 'none';
  }

  // 다음 라운드 준비
  setTimeout(() => {
    setPhase(battle, 'inter', null, interRoundSeconds);
    setTimeout(() => startRound(battle), interRoundSeconds * 1000);
  }, 1000);
}

function startRound(battle) {
  if (battle.status !== 'active') return;

  emitLog(battle, `${battle.turnNumber}라운드 시작`, 'battle');

  battle.roundEvents = [];
  battle.roundActions = [];

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

  // 선공/후공 결정(라운드마다 재결정)
  const sumAgilityA = livingPlayers(battle, 'A').reduce((s, p) => s + (p.stats?.agility || 1), 0);
  const sumAgilityB = livingPlayers(battle, 'B').reduce((s, p) => s + (p.stats?.agility || 1), 0);

  let aTotal, bTotal, aRoll, bRoll;
  do {
    aRoll = d10();
    bRoll = d10();
    aTotal = sumAgilityA + aRoll;
    bTotal = sumAgilityB + bRoll;
  } while (aTotal === bTotal);

  battle._startingTeam = aTotal > bTotal ? 'A' : 'B';
  emitLog(
    battle,
    `A팀 (${sumAgilityA}+${aRoll}) vs B팀 (${sumAgilityB}+${bRoll}) → 선공 ${battle._startingTeam}팀`,
    'notice'
  );

  enterASelect(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

  battle.status = 'active';
  emitLog(battle, '전투가 시작되었습니다!', 'notice');
  battle.turnNumber = 1;

  battle._battleTimer = setTimeout(() => endBattleByTimeLimit(battle), battleTimeLimit);
  startRound(battle);
}

// 시간 제한으로 종료 - HP 합산으로 승자 결정
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

function applyDamage(battle, defender, dmg, attacker, isCrit, { resultLog = false } = {}) {
  const before = defender.hp;
  defender.hp = clamp(defender.hp - Math.max(0, Math.floor(dmg)), 0, defender.maxHp);
  const after = defender.hp;
  const tag = resultLog ? ' (결과)' : '';

  if (defender.hp <= 0) {
    emitLog(battle, `→ ${attacker.name}의 ${isCrit ? '치명타 ' : ''}공격으로 ${defender.name} 사망! (피해 ${before - after})${tag}`, 'battle');
  } else {
    emitLog(battle, `→ ${attacker.name}이(가) ${defender.name}에게 ${isCrit ? '치명타 ' : ''}공격 (피해 ${before - after}) → HP ${after}${tag}`, 'battle');
  }
}

function performAttack(battle, attacker, target, { attackBoostOnce = false, resultLog = false } = {}) {
  const { final: finalAtk, crit } = rollFinalAttack(attacker, { attackBoostOnce });

  if (target.stance === 'dodge') {
    if (checkDodge(target, finalAtk)) {
      emitLog(battle, `→ ${target.name} 회피 성공! 피해 0${resultLog ? ' (결과)' : ''}`, 'battle');
    } else {
      applyDamage(battle, target, finalAtk, attacker, crit, { resultLog });
    }
  } else if (target.stance === 'defend') {
    const defVal = rollDefense(target);
    const remained = finalAtk - defVal;
    if (remained <= 0) {
      emitLog(battle, `→ ${target.name} 방어 성공! 피해 0${resultLog ? ' (결과)' : ''}`, 'battle');
    } else {
      applyDamage(battle, target, remained, attacker, crit, { resultLog });
    }
  } else {
    applyDamage(battle, target, finalAtk, attacker, crit, { resultLog });
  }
}

/* 선택 처리: 적용은 하지 않고 큐잉만 */
function queueAction(battle, actor, payload) {
  const type = payload?.type || 'pass';
  const entry = {
    actorId: actor.id,
    team: actor.team,
    type,
    payload: { ...payload },
    ts: now()
  };
  battle.roundActions.push(entry);

  // 선택 알림용 로그(팀 색상): 피해/회복 수치 없음
  if (type === 'pass') emitLog(battle, `${actor.name} 패스`, 'battle');
  else if (type === 'defend') emitLog(battle, `${actor.name} 방어 선택`, 'battle');
  else if (type === 'dodge') emitLog(battle, `${actor.name} 회피 선택`, 'battle');
  else if (type === 'attack') {
    const tgtName = (battle.players.find(p => p.id === payload?.targetId)?.name) || '무작위 대상';
    emitLog(battle, `→ ${actor.name}이(가) ${tgtName}에게 공격 선택`, 'battle');
  } else if (type === 'item') {
    const it = payload?.item;
    const tgtName = (battle.players.find(p => p.id === payload?.targetId)?.name) || (it === 'dittany' || it === 'ditany' ? actor.name : '대상');
    if (it === 'dittany' || it === 'ditany') emitLog(battle, `${actor.name}→${tgtName} 디터니 사용 선택`, 'battle');
    else if (it === 'attackBooster') emitLog(battle, `${actor.name} 공격 보정기 사용 선택 → 대상 ${tgtName}`, 'battle');
    else if (it === 'defenseBooster') emitLog(battle, `${actor.name} 방어 보정기 사용 선택 → 대상 ${tgtName}`, 'battle');
    else emitLog(battle, `${actor.name} 알 수 없는 아이템 선택`, 'battle');
  } else {
    emitLog(battle, `${actor.name} 알 수 없는 행동 선택`, 'battle');
  }
}

/* ────────────────────────── 링크 생성 ────────────────────────── */
async function generateLinks(battle) {
  const baseUrl = BASE_URL;

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
  io.to(battle.id).emit('battle:update', snapshot); // 단일 이벤트만
}

function emitLog(battle, message, type = 'system') {
  const logEntry = { ts: now(), type: type, message: String(message) };
  battle.logs = battle.logs || [];
  battle.logs.push(logEntry);
  if (battle.logs.length > 500) battle.logs = battle.logs.slice(-500);
  io.to(battle.id).emit('battle:log', logEntry); // 단일 이벤트만
}

/* ────────────────────────── 타이머 관리 ────────────────────────── */
function startTick(battle) {
  if (battle._timer) return;
  battle._timer = setInterval(() => {
    if (battle.status !== 'active') return;
    if (battle.phaseDeadline > 0 && now() >= battle.phaseDeadline) {
      handlePhaseTimeout(battle);
    }
    emitUpdate(battle); // 1초마다 상태
  }, 1000);
}

function handlePhaseTimeout(battle) {
  if (battle.phase?.endsWith('_select')) {
    const team = battle.currentTeam;
    emitLog(battle, `${team}팀 선택 시간 초과 - 자동 패스 처리`, 'notice');

    if (battle.currentPlayer) queueAction(battle, battle.currentPlayer, { type: 'pass' });
    while (advanceSelector(battle)) {
      if (battle.currentPlayer) queueAction(battle, battle.currentPlayer, { type: 'pass' });
    }

    if (team === 'A') enterBSelect(battle);
    else enterResolve(battle);
  }
}

/* ────────────────────────── 소켓 이벤트 ────────────────────────── */
io.on('connection', (socket) => {
  console.log('[Socket] 연결:', socket.id);

  socket.on('join', ({ battleId }, cb) => {
    try {
      const battle = getBattle(battleId);
      socket.join(battleId);
      socket.emit('battle:update', battleSnapshot(battle));
      if (battle.logs && battle.logs.length > 0) {
        battle.logs.slice(-10).forEach(log => socket.emit('battle:log', log));
      }
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('playerAuth', ({ battleId, token }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => token.startsWith(p.id + '_'));
      if (!player) return cb?.({ ok: false, error: 'INVALID_TOKEN' });
      socket.join(battleId);
      cb?.({ ok: true, player });
      socket.emit('auth:success', { role: 'player', battleId, playerId: player.id, team: player.team, name: player.name });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
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
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  // 플레이어 행동(선택만 큐잉)
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
      queueAction(battle, actor, payload);

      // 다음 선택자로 이동
      if (!advanceSelector(battle)) {
        emitLog(battle, `[${battle.currentTeam}] ${battle.currentTeam}팀 선택 완료`, 'battle');
        if (battle.currentTeam === 'A') enterBSelect(battle);
        else enterResolve(battle);
      }

      cb?.({ ok: true });
      socket.emit('player:action:success'); // 클라 호환용 단일
    } catch (e) { cb?.({ ok: false, error: e?.message || 'ERR' }); }
  });

  // 관리자 전투 제어
  socket.on('createBattle', ({ mode }, cb) => {
    try {
      const battle = createBattle(mode || '2v2');
      cb?.({ ok: true, battleId: battle.id, battle: battleSnapshot(battle) });
      // 생성 직후 상태 브로드캐스트
      io.to(battle.id).emit('battle:update', battleSnapshot(battle));
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('startBattle', ({ battleId }, cb) => {
    try { startBattle(getBattle(battleId)); cb?.({ ok: true }); } catch { cb?.({ ok: false }); }
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
    try { endBattle(getBattle(battleId), 'MANUAL'); cb?.({ ok: true }); }
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

  // 채팅(중복 제거: battle:chat만 송신)
  socket.on('chatMessage', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const chatData = { name: name || '익명', message: String(message || '').slice(0, 500) };
      io.to(battleId).emit('battle:chat', chatData);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  // 관전자 응원(채팅 채널로만 전송)
  socket.on('spectator:cheer', ({ battleId, name, message }, cb) => {
    try {
      const chatData = { name: `[응원] ${name || '관전자'}`, message: String(message || '').trim() };
      if (chatData.message) io.to(battleId).emit('battle:chat', chatData);
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e.message }); }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] 해제:', socket.id);
  });
});

/* ────────────────────────── 서버 시작 ────────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`PYXIS Battle Server running on http://${HOST}:${PORT}`);
  console.log(`Admin: ${BASE_URL}/admin`);
  console.log(`Player: ${BASE_URL}/player`);
  console.log(`Spectator: ${BASE_URL}/spectator`);
});
