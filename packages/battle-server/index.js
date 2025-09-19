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
app.get('/', send('admin.html'));          // 루트 → 관리자
app.get('/admin', send('admin.html'));
app.get('/player', send('player.html'));
app.get('/spectator', send('spectator.html'));

/* ─────────────────────────── 공용 유틸 ─────────────────────────── */
const battles = new Map(); // id -> battle state

const now = () => Date.now();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const d10 = () => randInt(1, 10);  // D10
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

// HTTP 폴백: 전투 생성
app.post('/api/battles', (req, res) => {
  try {
    const { mode } = req.body;
    const b = createBattle(mode);
    res.json({ ok: true, battleId: b.id, battle: battleSnapshot(b) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// HTTP 폴백: 링크 생성
app.post('/api/admin/battles/:id/links', async (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const links = await generateLinks(b);
    res.json({ ok: true, links });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 호환 경로
app.post('/api/battles/:id/links', async (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const links = await generateLinks(b);
    res.json({ ok: true, links });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ─────────────────────────── 배틀 관련 함수들 ─────────────────────────── */

function sortTeamOrderForSelection(players) {
  // 민첩 내림차순 → 이름 알파벳(문자) 내림차순
  return [...players].sort((a, b) => {
    const agiDiff = (b.stats?.agility || 0) - (a.stats?.agility || 0);
    if (agiDiff !== 0) return agiDiff;
    // 알파벳/문자 내림차순 (locale 고려)
    return String(b.name || '').localeCompare(String(a.name || ''), 'ko');
  });
}

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

    // 팀 선택 큐 (정렬 적용)
    selectionQueue: [],
    selectorIndex: 0,

    // 현재 선택 중 플레이어(프런트 호환)
    currentPlayer: null,

    // 페이즈 타이머
    phaseDeadline: 0,

    // 라운드 동안 모인 "선언" 이벤트 (나중에 해석에서 순차 적용)
    roundEvents: [],

    // 내부 타이머
    _timer: null,
    _battleTimer: null, // 1시간 전체 제한 타이머

    // 선공/후공
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
      id: p.id, name: p.name, team: p.team,
      hp: p.hp, maxHp: p.maxHp, stats: p.stats, items: p.items,
      avatar: p.avatar, ready: !!p.ready, joinedAt: p.joinedAt
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
  // 팀 생존자 → 정렬(민첩 desc, 이름 desc)
  const base = livingPlayers(battle, team);
  battle.selectionQueue = sortTeamOrderForSelection(base);
  battle.selectorIndex = 0;
  battle.currentTeam = team || null;

  if (battle.selectionQueue.length === 0) {
    emitLog(battle, `${team}팀 생존자 없음 — 선택 스킵`, 'notice');
    if (team === 'A') enterBSelect(battle);
    else enterResolve(battle);
    return;
  }

  // 팀 헤더
  emitLog(battle, `=== ${team}팀 선택 페이즈 시작 ===`, 'battle');

  // 현 선택자 지정 + 타이머
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
  // 해석 단계로 전환 (즉시 피해/회복 계산 시작)
  setPhase(battle, 'resolve', null, 1);
  emitLog(battle, '라운드 해석', 'battle');

  // 선택 동안 쌓인 선언 이벤트를 "선택 순서대로" 적용
  const events = battle.roundEvents || [];

  for (const ev of events) {
    const actor = battle.players.find(p => p.id === ev.actorId);
    if (!actor || actor.hp <= 0) continue;

    if (ev.type === 'defend') {
      actor.stance = 'defend';
      // 방어 자세 자체는 결과 로그 생략(요구안에 피해/회복만 금색 강조)
    } else if (ev.type === 'dodge') {
      actor.stance = 'dodge';
    } else if (ev.type === 'item') {
      if (ev.item === 'dittany' || ev.item === 'ditany') {
        const target = battle.players.find(p => p.id === ev.targetId) || actor;
        if (target && target.hp > 0) {
          const before = target.hp;
          const heal = 10;
          target.hp = clamp(target.hp + heal, 0, target.maxHp || 100);
          emitLog(battle,
            `→ ${actor.name}이(가) ${target.name}에게 디터니 적용 (+${target.hp - before}) → HP ${target.hp}`,
            'battle'); // 아래서 result로 강조
          // 결과 강조(금색)용 별도 라인
          emitLog(battle,
            `${actor.name}이(가) ${target.name}에게 디터니 사용 (회복 ${target.hp - before}) → HP ${target.hp}`,
            'result');
        }
      } else if (ev.item === 'attackBooster') {
        // 성공시 이번 공격 1회 2배 플래그 부여
        const ok = Math.random() < 0.60;
        if (!ok) {
          emitLog(battle, `→ ${actor.name}의 공격 보정기 실패 (확률)`, 'battle');
        } else {
          actor.temp = actor.temp || {};
          actor.temp.attackBoostOneShot = true;
          // 즉시 공격까지는 해석 때 'attack' 이벤트가 따로 있을 수 있음.
          if (ev.targetId) {
            // 공격까지 선언한 케이스라면, 나중에 attack 해석에서 2배가 반영됨
            emitLog(battle, `→ ${actor.name}이(가) 공격 보정기 성공 — 대상 ${ev.targetName || ev.targetId}`, 'battle');
          } else {
            emitLog(battle, `→ ${actor.name}이(가) 공격 보정기 성공 (다음 공격 1회 2배)`, 'battle');
          }
        }
      } else if (ev.item === 'defenseBooster') {
        const ally = battle.players.find(p => p.id === ev.targetId && p.team === actor.team);
        const ok = Math.random() < 0.60;
        if (!ally) {
          emitLog(battle, `→ ${actor.name}의 방어 보정기 실패 (아군 대상 없음)`, 'battle');
        } else if (!ok) {
          emitLog(battle, `→ ${actor.name}의 방어 보정기 실패 (확률)`, 'battle');
        } else {
          ally.temp = ally.temp || {};
          ally.temp.defenseBoostOneShot = true;
          emitLog(battle, `→ ${actor.name}이(가) ${ally.name}에게 방어 보정기 적용 (이번 턴 방어 1회 2배)`, 'battle');
        }
      }
    } else if (ev.type === 'attack') {
      const target = battle.players.find(p => p.id === ev.targetId && p.hp > 0);
      if (!target || target.team === actor.team) continue;

      // 최종 공격치 굴림
      const atkStat = Number(actor.stats?.attack || 1);
      let finalAtk = atkStat + d10();
      const crit = (() => {
        const roll = d10();
        const threshold = 10 - Math.floor((actor.stats?.luck || 1) / 2);
        return roll >= threshold;
      })();
      if (crit) finalAtk *= 2;

      if (actor?.temp?.attackBoostOneShot) {
        finalAtk *= 2;
        actor.temp.attackBoostOneShot = false;
      }

      // 방어/회피
      const doDodge = target.stance === 'dodge' && ((Number(target.stats?.agility || 1) + d10()) >= finalAtk);
      if (doDodge) {
        emitLog(battle, `→ ${target.name}이(가) 회피 성공! 피해 0`, 'result');
      } else if (target.stance === 'defend') {
        const defValBase = Number(target.stats?.defense || 1) + d10();
        const defVal = (target?.temp?.defenseBoostOneShot) ? (target.temp.defenseBoostOneShot = false, defValBase * 2) : defValBase;
        const remained = finalAtk - defVal;
        if (remained <= 0) {
          emitLog(battle, `→ ${target.name}이(가) 방어 성공! 피해 0`, 'result');
        } else {
          const before = target.hp;
          target.hp = clamp(target.hp - Math.max(0, Math.floor(remained)), 0, target.maxHp);
          const after = target.hp;
          emitLog(battle,
            `→ ${actor.name}이(가) ${target.name}에게 ${crit ? '치명타 ' : ''}공격 (피해 ${before - after}) → HP ${after}`,
            'result');
        }
      } else {
        const before = target.hp;
        target.hp = clamp(target.hp - Math.max(0, Math.floor(finalAtk)), 0, target.maxHp);
        const after = target.hp;
        emitLog(battle,
          `→ ${actor.name}이(가) ${target.name}에게 ${crit ? '치명타 ' : ''}공격 (피해 ${before - after}) → HP ${after}`,
          'result');
      }
    }
  }

  // 요약 라인
  emitLog(battle, `=== ${battle.turnNumber}라운드 종료 ===`, 'battle');
  emitLog(battle, `${interRoundSeconds}초 후 다음 라운드 시작...`, 'notice');

  // 턴용 일시효과 초기화
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

  // 이벤트 버퍼 초기화
  battle.roundEvents = [];

  // 전멸 체크
  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    const winner = aliveA > 0 ? 'A' : 'B';
    endBattle(battle, winner);
    return;
  }

  // 1시간 제한 체크
  const elapsed = now() - battle.createdAt;
  if (elapsed >= battleTimeLimit) {
    endBattleByTimeLimit(battle);
    return;
  }

  // 라운드마다 선공 교대
  const firstTeam = battle.turnNumber % 2 === 1 ? battle._startingTeam : (battle._startingTeam === 'A' ? 'B' : 'A');
  battle._startingTeam = firstTeam;

  // 선공 팀부터 선택
  enterASelect(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

  // 선공 결정: 팀별 민첩 합 + D10 (동점시 재굴림)
  const sumAgilityA = livingPlayers(battle, 'A').reduce((s, p) => s + (p.stats?.agility || 1), 0);
  const sumAgilityB = livingPlayers(battle, 'B').reduce((s, p) => s + (p.stats?.agility || 1), 0);

  let aTotal, bTotal, aRoll, bRoll;
  do {
    aRoll = d10();
    bRoll = d10();
    aTotal = sumAgilityA + aRoll;
    bTotal = sumAgilityB + bRoll;
  } while (aTotal === bTotal);

  const starter = aTotal > bTotal ? 'A' : 'B';
  battle._startingTeam = starter;

  emitLog(battle,
    `A팀 (민첩합 ${sumAgilityA} + ${aRoll} = ${aTotal}) vs B팀 (민첩합 ${sumAgilityB} + ${bRoll} = ${bTotal}) → 선공 ${starter}팀`,
    'notice');

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
  else {
    if (aliveA.length > aliveB.length) winner = 'A';
    else if (aliveB.length > aliveA.length) winner = 'B';
    else winner = battle._startingTeam;
  }

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
  io.to(battle.id).emit('battleEnded', { winner, message: '전투가 종료되었습니다.' });

  emitUpdate(battle);
}

/* ────────────────────────── 플레이어 관리 ────────────────────────── */
function addPlayer(battle, inp) {
  if (!inp?.name || !inp?.team) throw new Error('BAD_PLAYER');

  const p = {
    id: `p_${uid('')}`,
    team: (inp.team === 'B' ? 'B' : 'A'),
    name: String(inp.name),
    avatar: inp.avatar || '',
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

/* ────────────────────────── 전투 액션 (선택만 기록) ────────────────────────── */
function resolveAction(battle, actor, payload) {
  const { type = 'pass' } = payload;
  const teamPrefix = actor.team === 'A' ? '[A]' : '[B]';

  switch (type) {
    case 'pass':
      battle.roundEvents.push({ actorId: actor.id, type: 'pass', team: actor.team, ts: now() });
      emitLog(battle, `${teamPrefix} ${actor.name} 패스`, 'battle');
      break;

    case 'defend':
      battle.roundEvents.push({ actorId: actor.id, type: 'defend', team: actor.team, ts: now() });
      emitLog(battle, `${teamPrefix} ${actor.name} 방어 자세 선언`, 'battle');
      break;

    case 'dodge':
      battle.roundEvents.push({ actorId: actor.id, type: 'dodge', team: actor.team, ts: now() });
      emitLog(battle, `${teamPrefix} ${actor.name} 회피 자세 선언`, 'battle');
      break;

    case 'attack': {
      const target = payload?.targetId
        ? battle.players.find(p => p.id === payload.targetId && p.hp > 0)
        : null; // 무작위 지정 없이 선언만

      battle.roundEvents.push({
        actorId: actor.id,
        type: 'attack',
        team: actor.team,
        targetId: target?.id || payload?.targetId || null,
        targetName: target?.name || null,
        ts: now()
      });
      emitLog(battle, `${teamPrefix} ${actor.name} → ${target?.name || '상대'} 공격 선언`, 'battle');
      break;
    }

    case 'item': {
      const item = payload?.item || '';

      if (item === 'dittany' || item === 'ditany') {
        if ((actor.items?.dittany || 0) <= 0) {
          emitLog(battle, `${teamPrefix} ${actor.name}의 디터니 없음`, 'battle');
          break;
        }
        // 실제 소모/회복은 해석 단계에서
        battle.roundEvents.push({
          actorId: actor.id, type: 'item', item: 'dittany',
          team: actor.team, targetId: payload?.targetId || actor.id,
          ts: now()
        });
        emitLog(battle, `${teamPrefix} ${actor.name} 디터니 사용 선언`, 'battle');

      } else if (item === 'attackBooster') {
        if ((actor.items?.attackBooster || 0) <= 0) {
          emitLog(battle, `${teamPrefix} ${actor.name}의 공격 보정기 없음`, 'battle');
          break;
        }
        battle.roundEvents.push({
          actorId: actor.id, type: 'item', item: 'attackBooster',
          team: actor.team, targetId: payload?.targetId || null,
          targetName: (payload?.targetId && battle.players.find(p=>p.id===payload.targetId)?.name) || null,
          ts: now()
        });
        emitLog(battle, `${teamPrefix} ${actor.name} 공격 보정기 사용 선언`, 'battle');

      } else if (item === 'defenseBooster') {
        if ((actor.items?.defenseBooster || 0) <= 0) {
          emitLog(battle, `${teamPrefix} ${actor.name}의 방어 보정기 없음`, 'battle');
          break;
        }
        battle.roundEvents.push({
          actorId: actor.id, type: 'item', item: 'defenseBooster',
          team: actor.team, targetId: payload?.targetId || null,
          ts: now()
        });
        emitLog(battle, `${teamPrefix} ${actor.name} 방어 보정기 사용 선언`, 'battle');

      } else {
        emitLog(battle, `${teamPrefix} ${actor.name}의 알 수 없는 아이템 선언`, 'battle');
      }
      break;
    }

    default:
      emitLog(battle, `${teamPrefix} ${actor.name}의 알 수 없는 행동 선언 (패스 처리)`, 'battle');
      battle.roundEvents.push({ actorId: actor.id, type: 'pass', team: actor.team, ts: now() });
  }

  // 팀 전멸 체크(선택 단계에서 즉시 끝낼 필요 없음) → 해석/라운드 진행에서 처리

  // 다음 선택자로 이동
  if (!advanceSelector(battle)) {
    emitLog(battle, `[${battle.currentTeam}] ${battle.currentTeam}팀 선택 완료`, 'battle');
    if (battle.currentTeam === 'A') enterBSelect(battle);
    else enterResolve(battle);
  }
}

/* ────────────────────────── 링크 생성 ────────────────────────── */
async function generateLinks(battle) {
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL || `http://localhost:${PORT}`;

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

/* ────────────────────────── 브로드캐스트 함수 ────────────────────────── */
function emitUpdate(battle) {
  const snapshot = battleSnapshot(battle);
  io.to(battle.id).emit('battle:update', snapshot);
  io.to(battle.id).emit('battleUpdate', snapshot);
}

function emitLog(battle, message, type = 'system') {
  // type: 'battle' | 'notice' | 'error' | 'result' ...
  const logEntry = { ts: now(), type: type, message: String(message) };
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

    if (battle.phaseDeadline > 0 && now() >= battle.phaseDeadline) {
      handlePhaseTimeout(battle);
    }
    emitUpdate(battle);
  }, 1000);
}

function handlePhaseTimeout(battle) {
  if (battle.phase?.endsWith('_select')) {
    const team = battle.currentTeam;
    emitLog(battle, `${team}팀 선택 시간 초과 - 자동 패스 처리`, 'notice');

    if (battle.currentPlayer) {
      resolveAction(battle, battle.currentPlayer, { type: 'pass' });
    }
    while (advanceSelector(battle)) {
      if (battle.currentPlayer) {
        resolveAction(battle, battle.currentPlayer, { type: 'pass' });
      }
    }
    if (team === 'A') enterBSelect(battle);
    else enterResolve(battle);
  }
}

/* ────────────────────────── 소켓 이벤트 핸들링 ────────────────────────── */
io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);

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
  socket.on('playerAuth', ({ battleId, token }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => token && token.startsWith(p.id + '_'));
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

  // 준비 완료
  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    try {
      const battle = getBattle(battleId);
      const player = battle.players.find(p => p.id === playerId);
      if (!player) { cb?.({ ok: false, error: 'PLAYER_NOT_FOUND' }); return; }
      player.ready = true;
      emitLog(battle, `${player.name}이(가) 준비 완료했습니다`, 'notice');
      emitUpdate(battle);
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // 플레이어 행동 (선언만 기록)
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    try {
      const battle = getBattle(battleId);
      if (battle.status !== 'active') { cb?.({ ok: false, error: 'NOT_ACTIVE' }); return; }

      const actor = battle.players.find(x => x.id === playerId);
      if (!actor || actor.hp <= 0) { cb?.({ ok: false, error: 'DEAD' }); return; }

      if (!(battle.phase === `${actor.team}_select` && battle.currentPlayer && battle.currentPlayer.id === actor.id)) {
        cb?.({ ok: false, error: 'NOT_YOUR_TURN' });
        return;
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

  // 관리자 전투 제어
  socket.on('createBattle', ({ mode }, cb) => {
    try {
      const battle = createBattle(mode || '2v2');
      cb?.({ ok: true, battleId: battle.id });
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

  // 채팅 (★ 한 채널로만 전송: 중복 수신 방지 위해 'chatMessage'만 사용 권장)
  socket.on('chatMessage', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const chatData = { name: name || '익명', message: String(message || '').slice(0, 500) };
      io.to(battleId).emit('chatMessage', chatData);
      // (호환) io.to(battleId).emit('battle:chat', chatData);  // ← 중복 원인이므로 주석 권장
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // 관전자 응원
  socket.on('spectator:cheer', ({ battleId, name, message }, cb) => {
    try {
      const battle = getBattle(battleId);
      const cheerData = { name: `[응원] ${name || '관전자'}`, message: String(message || '').trim() };
      if (cheerData.message) {
        io.to(battleId).emit('chatMessage', cheerData);
        // (호환) io.to(battleId).emit('battle:chat', cheerData); // ← 중복 원인이므로 주석 권장
        io.to(battleId).emit('spectator:cheer', cheerData);
        io.to(battleId).emit('cheerMessage', cheerData);
      }
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
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
