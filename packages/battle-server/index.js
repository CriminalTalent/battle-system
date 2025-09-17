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
const d10 = () => randInt(1, 10);
const d100 = () => randInt(1, 100);
const uid = (p = '') => `${p}${Math.random().toString(16).slice(2, 10)}`;

// 팀 페이즈 제한시간 (5분)
const teamPhaseSeconds = Number(process.env.TEAM_PHASE_SECONDS || 300);
// 라운드 간 짧은 인터벌
const interRoundSeconds = Number(process.env.INTER_ROUND_SECONDS || 5);

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
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
  const rel = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok: true, url: rel });
});

/* ─────────────────────────── 전송 헬퍼 ─────────────────────────── */
function emitUpdate(battle) {
  const payload = publicBattle(battle);
  io.to(battle.id).emit('battle:update', payload);
  io.to(battle.id).emit('battleUpdate', payload); // 레거시 병행
}
function emitLog(battle, message, type = 'battle') {
  const log = { ts: now(), type, message };
  io.to(battle.id).emit('battle:log', log);
  // 라운드 요약 수집용(결과 탭에서 사용)
  battle.roundEvents.push(log);
}
function emitChat(battleId, msg) {
  io.to(battleId).emit('chatMessage', msg);
}

/* ───────────────────────── 상태 스냅샷 ───────────────────────── */
function publicBattle(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,           // waiting | active | paused | ended
    phase: b.phase,             // A_select | B_select | resolve | inter
    currentTeam: b.currentTeam, // 현 페이즈 팀
    players: b.players.map(p => ({
      id: p.id, team: p.team, name: p.name,
      avatar: p.avatar || '/uploads/avatars/default.svg',
      hp: p.hp, maxHp: p.maxHp,
      stats: p.stats, items: { ...p.items },
      ready: !!p.ready
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
    }
  };
}

/* ───────────────────────── 배틀 생성/조회 ───────────────────────── */
function createBattle(mode = '2v2') {
  const id = `battle_${Date.now()}_${uid('')}`;
  const battle = {
    id, mode,
    status: 'waiting',
    phase: null,               // 'A_select' | 'B_select' | 'resolve' | 'inter'
    currentTeam: null,
    players: [],
    turnNumber: 1,

    // 팀 선택용 큐
    selectionQueue: [],
    selectorIndex: 0,

    // UI 호환용(현재 선택 중 플레이어)
    currentPlayer: null,

    // 페이즈 타이머
    phaseDeadline: 0,

    // 라운드 요약(로그)
    roundEvents: [],

    // 내부 타이머
    _timer: null,

    // 선공/후공
    _startingTeam: 'A',

    // 관전자 OTP
    spectatorOtp: uid('').slice(0, 8)
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
  // 팀 생존자 기준으로 큐 구성(참가 순서 유지)
  battle.selectionQueue = livingPlayers(battle, team);
  battle.selectorIndex = 0;
  battle.currentTeam = team || null;

  if (battle.selectionQueue.length === 0) {
    emitLog(battle, `${team}팀 생존자 없음 — 선택 스킵`, 'notice');
    // 다음 페이즈로 이동
    if (team === 'A') enterBSelect(battle);
    else enterResolve(battle);
    return;
  }

  // 팀 헤더 한 번
  emitLog(battle, `=== ${team}팀 선택 페이즈 시작 ===`, 'battle');

  // 현 선택자 지정 + 5분 타이머
  battle.currentPlayer = battle.selectionQueue[battle.selectorIndex] || null;
  setPhase(battle, `${team}_select`, team, teamPhaseSeconds);
}

function advanceSelector(battle) {
  // 다음 유효 플레이어로 이동(사망자는 스킵)
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
  // 해석 단계(현재 룰은 즉시 적용이라 요약만 표시)
  setPhase(battle, 'resolve', null, 1);
  emitLog(battle, '라운드 해석', 'battle');

  // 요약 라인
  emitLog(battle, `=== ${battle.turnNumber}라운드 종료 ===`, 'battle');
  emitLog(battle, `${interRoundSeconds}초 후 다음 라운드 시작...`, 'notice');

  // 인터 라운드 페이즈로 전환
  setTimeout(() => {
    setPhase(battle, 'inter', null, interRoundSeconds);
    // 다음 라운드
    setTimeout(() => startRound(battle), interRoundSeconds * 1000);
  }, 1000);
}

function startRound(battle) {
  if (battle.status !== 'active') battle.status = 'active';

  // 라운드 증가(첫 라운드는 startBattle에서 1로 세팅)
  if (battle.phase === 'inter' || battle.phase === 'resolve' || battle.phase == null) {
    battle.turnNumber = Number(battle.turnNumber || 1);
  }

  // 라운드 시작 로그
  emitLog(battle, `${battle.turnNumber}라운드 시작`, 'battle');

  // 이벤트 버퍼 초기화
  battle.roundEvents = [];

  // 전멸 체크
  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    endBattle(battle, aliveA > 0 ? 'A' : (aliveB > 0 ? 'B' : null));
    return;
  }

  // 선공/후공 교대(라운드마다 선공 교대)
  const firstTeam = battle.turnNumber % 2 === 1 ? battle._startingTeam : (battle._startingTeam === 'A' ? 'B' : 'A');
  battle._startingTeam = firstTeam;

  // A_select(선공 팀)부터 시작
  enterASelect(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

  // 선공 결정 로그(주사위 1~10 두 번 합)
  const aRoll1 = d10(), aRoll2 = d10();
  const bRoll1 = d10(), bRoll2 = d10();
  const aSum = aRoll1 + aRoll2;
  const bSum = bRoll1 + bRoll2;

  emitLog(battle, `선공 결정: A팀(${aRoll1}+${aRoll2}=${aSum}) vs B팀(${bRoll1}+${bRoll2}=${bSum})`, 'notice');

  battle._startingTeam = aSum >= bSum ? 'A' : 'B';
  emitLog(battle, `${battle._startingTeam}팀이 선공입니다!`, 'notice');

  battle.status = 'active';
  emitLog(battle, '전투가 시작되었습니다!', 'notice');

  battle.turnNumber = 1;
  startRound(battle);
}

function endBattle(battle, winner = null) {
  battle.status = 'ended';
  emitLog(battle, '게임이 종료되었습니다', 'result');
  if (winner) emitLog(battle, `${winner}팀 승리!`, 'result');
  battle.currentPlayer = null;
  battle.currentTeam = null;
  battle.phase = null;
  battle.phaseDeadline = now();
  emitUpdate(battle);
}

/* ───────────────────────── 내부 타이머 틱 ───────────────────────── */
function startTick(battle) {
  if (battle._timer) clearInterval(battle._timer);
  battle._timer = setInterval(() => {
    if (battle.status !== 'active') return;
    if (!battle.phaseDeadline) return;

    const left = Math.max(0, Math.floor((battle.phaseDeadline - now()) / 1000));
    if (left === 0) {
      // 페이즈 시간 종료
      if (battle.phase === 'A_select' || battle.phase === 'B_select') {
        // 남은 선택자들은 자동행동(랜덤 공격)으로 채우고 페이즈 종료
        autoFinishPhaseSelections(battle);
        if (battle.phase === 'A_select') enterBSelect(battle);
        else if (battle.phase === 'B_select') enterResolve(battle);
      } else if (battle.phase === 'inter') {
        // 인터는 startRound에서 스케줄 함
      } else if (battle.phase === 'resolve') {
        // resolve → inter로 전환은 enterResolve에서 스케줄
      }
    } else {
      // 남은 시간 갱신 브로드캐스트(1초마다)
      emitUpdate(battle);
    }
  }, 1000);
}

function autoFinishPhaseSelections(battle) {
  const team = battle.currentTeam;
  const leftList = (battle.selectionQueue || []).slice(battle.selectorIndex); // 현재 포함
  for (const p of leftList) {
    if (!p || p.hp <= 0) continue;
    // 기본 자동행동: 랜덤 공격
    const target = pickRandomEnemy(battle, team);
    if (!target) continue;
    resolveAction(battle, p, { type: 'attack', targetId: target.id, auto: true }, { silentAdvance: true });
  }
  emitLog(battle, `${team}팀 선택 시간 종료 — 남은 인원 자동 처리`, 'notice');
  // 선택자 없음으로 세팅
  battle.currentPlayer = null;
  battle.selectorIndex = (battle.selectionQueue || []).length;
  emitUpdate(battle);
}

/* ───────────────────────── 행동 처리(룰) ───────────────────────── */
function clearEphemeralOnNewRound(p) {
  // 라운드 시작 혹은 자신의 선택 직전 초기화 규칙이 필요하면 여기에
  p.stance = 'none';
  p.temp = {}; // { attackBoost:bool, defenseBoost:bool }
}

function pickRandomEnemy(battle, myTeam) {
  const enemies = livingPlayers(battle, myTeam === 'A' ? 'B' : 'A');
  if (!enemies.length) return null;
  return enemies[randInt(0, enemies.length - 1)];
}

function resolveAction(battle, actor, payload, opts = {}) {
  if (!actor || actor.hp <= 0) {
    emitUpdate(battle);
    return;
  }
  const type = payload?.type || 'attack';
  const enemyTeam = actor.team === 'A' ? 'B' : 'A';

  const logLine = (txt) => emitLog(battle, `→ ${txt}`, 'battle');

  // (기존 서버 룰 유지) 아이템 성공 확률 90%
  const itemSucceeds = () => d100() <= 90;

  // 최종 공격력(치명타 플래그 포함) 계산
  const rollFinalAttack = (attacker) => {
    const atkStat = Number(attacker.stats?.attack || 1);
    const coeff = attacker?.temp?.attackBoost ? 2 : 1; // 보정기 사용 시 x2
    const base = atkStat * coeff + d10();
    const crit = (d10() >= (10 - Math.floor((attacker.stats?.luck || 0) / 2)));
    return { final: crit ? base * 2 : base, crit };
  };

  // 방어값 계산
  const rollDefense = (defender) => {
    const defStat = Number(defender.stats?.defense || 1);
    const coeff = defender?.temp?.defenseBoost ? 2 : 1;
    return defStat * coeff + d10();
  };

  // 회피 판정
  const checkDodge = (defender, attackerFinal) => {
    const agi = Number(defender.stats?.agility || 1);
    return (agi + d10()) >= attackerFinal; // 성공 시 완전 회피
  };

  // 피해 적용
  const applyDamage = (defender, dmg, attacker, isCrit) => {
    const before = defender.hp;
    defender.hp = clamp(defender.hp - Math.max(0, Math.floor(dmg)), 0, defender.maxHp);
    const after = defender.hp;

    if (defender.hp <= 0) {
      logLine(`${attacker.name}의 ${isCrit ? '강화된 ' : ''}치명타 공격으로 ${defender.name} 사망! (피해 ${before})`);
    } else {
      logLine(`${attacker.name}이(가) ${defender.name}에게 ${isCrit ? '강화된 공격 ' : '공격 '} (피해 ${before - after}) → HP ${after}`);
    }
  };

  // 팀 행동 라인(선택 페이즈 내 세밀 중계)
  if (battle.phase === `${actor.team}_select`) {
    const hdrKey = `header_${actor.team}_${battle.turnNumber}`;
    if (!battle[hdrKey]) {
      battle[hdrKey] = true;
      emitLog(battle, `=== ${actor.team}팀 선택 진행 ===`, 'battle');
    }
  }

  switch (type) {
    case 'attack': {
      // 공격 대상(없다면 랜덤)
      const target = (payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0))
        || pickRandomEnemy(battle, actor.team);

      if (!target) {
        logLine(`${actor.name}이(가) 공격할 대상이 없습니다 (모두 사망)`);
        break;
      }

      const { final: finalAtk, crit } = rollFinalAttack(actor);

      // 방어/회피 처리
      if (target.stance === 'dodge') {
        if (checkDodge(target, finalAtk)) {
          logLine(`${target.name}이(가) 회피 성공! 피해 0`);
        } else {
          applyDamage(target, finalAtk, actor, crit);
        }
      } else if (target.stance === 'defend') {
        const defVal = rollDefense(target);
        const base = finalAtk;
        const remained = base - defVal;
        if (remained <= 0) {
          logLine(`${target.name}이(가) 방어 성공! 피해 없음`);
        } else {
          applyDamage(target, remained, actor, crit);
        }
      } else {
        // 아무 태세도 없으면 정면으로 공격 적용
        applyDamage(target, finalAtk, actor, crit);
      }

      logLine(`${actor.name}이(가) ${target.name}을(를) 공격`);
      break;
    }

    case 'defend': {
      actor.stance = 'defend';
      logLine(`${actor.name}이(가) 방어 태세`);
      break;
    }

    case 'dodge': {
      actor.stance = 'dodge';
      logLine(`${actor.name}이(가) 회피 태세`);
      break;
    }

    case 'pass': {
      logLine(`${actor.name}이(가) 행동 패스`);
      break;
    }

    case 'item': {
      const item = payload?.item;
      if (!item) {
        logLine(`${actor.name}의 아이템 사용 실패(지정 안됨)`);
        break;
      }
      if (item === 'dittany') {
        const tgt = (payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0))
          || actor; // 기본 자기 자신
        if (!tgt || tgt.hp <= 0) {
          logLine(`${actor.name}의 ${tgt ? tgt.name : '대상'}에게 디터니 사용 실패 (사망자)`);
          break;
        }
        if (!itemSucceeds()) {
          logLine(`${actor.name}의 ${tgt.name}에게 디터니 사용 실패 (확률)`);
          break;
        }
        const heal = 10 + d10();
        const before = tgt.hp;
        tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp || 100);
        logLine(`${actor.name}이(가) ${tgt.name}에게 디터니 사용 (+${tgt.hp - before}) → HP ${tgt.hp}`);
      } else if (item === 'attackBooster') {
        if (!itemSucceeds()) {
          logLine(`${actor.name}이(가) 공격 보정기 사용 실패`);
        } else {
          actor.temp = actor.temp || {};
          actor.temp.attackBoost = true; // 이번 선택에만 적용
          logLine(`${actor.name}이(가) 공격 보정기 사용 성공`);
        }
      } else if (item === 'defenseBooster') {
        if (!itemSucceeds()) {
          logLine(`${actor.name}이(가) 방어 보정기 사용 실패`);
        } else {
          actor.temp = actor.temp || {};
          actor.temp.defenseBoost = true; // 이번 선택에만 적용
          logLine(`${actor.name}이(가) 방어 보정기 사용 성공`);
        }
      } else {
        logLine(`${actor.name}의 알 수 없는 아이템 사용`);
      }
      break;
    }

    default:
      logLine(`${actor.name}의 알 수 없는 행동 (패스 처리)`);
  }

  // 팀 전멸 체크
  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    endBattle(battle, aliveA > 0 ? 'A' : (aliveB > 0 ? 'B' : null));
    return;
  }

  // 세밀 중계: 현재 배우자 선택 종료
  emitLog(battle, `[${actor.team}] ${actor.name} 선택 완료`, 'battle');

  emitUpdate(battle);

  // 선택 페이즈라면 다음 선택자로 진행
  if (battle.phase === `${actor.team}_select`) {
    const hasNext = advanceSelector(battle);
    if (!hasNext) {
      emitLog(battle, `${actor.team}팀 선택 완료`, 'battle');
      if (battle.phase === 'A_select') enterBSelect(battle);
      else if (battle.phase === 'B_select') enterResolve(battle);
    }
  }

  // 임시 보정은 “자신 선택 1회” 후 제거
  actor.temp = {};
  actor.stance = 'none';

  if (!opts.silentAdvance) emitUpdate(battle);
}

/* ───────────────────────── 소켓 핸들러 ───────────────────────── */
io.on('connection', (socket) => {
  socket.on('join', ({ battleId }) => {
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    const b = getBattle(battleId);
    emitLog(b, '새 연결이 입장했습니다', 'notice');
    emitUpdate(b);
  });

  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !battles.has(battleId) || !message) return;
    emitChat(battleId, { name: name || '익명', message });
  });

  socket.on('spectator:cheer', ({ battleId, name, message }) => {
    if (!battleId || !battles.has(battleId) || !message) return;
    emitChat(battleId, { name: name ? `[응원] ${name}` : '[응원]', message });
  });

  // 플레이어 토큰 인증
  socket.on('playerAuth', ({ battleId, token }, cb) => {
    try {
      const b = getBattle(battleId);
      const p = b.players.find(x => x.token === token);
      if (!p) return cb?.({ ok: false, error: 'AUTH_FAIL' });
      cb?.({ ok: true, player: p });
      socket.emit('authSuccess', { player: p });
      socket.emit('auth:success', { player: p });
    } catch {
      cb?.({ ok: false, error: 'NOT_FOUND' });
    }
  });

  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    try {
      const b = getBattle(battleId);
      const p = b.players.find(x => x.id === playerId);
      if (!p) return cb?.({ ok: false });
      p.ready = true;
      emitChat(battleId, { name: p.name, message: '[준비 완료]' });
      emitLog(b, `${p.name}이(가) 준비 완료했습니다`, 'notice');
      emitUpdate(b);
      cb?.({ ok: true });
    } catch {
      cb?.({ ok: false });
    }
  });

  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    try {
      const b = getBattle(battleId);
      if (b.status !== 'active') return cb?.({ ok: false, error: 'NOT_ACTIVE' });

      const actor = b.players.find(x => x.id === playerId);
      if (!actor || actor.hp <= 0) return cb?.({ ok: false, error: 'DEAD' });

      // 팀 선택 페이즈 + 현재 선택자만 허용
      if (!(b.phase === `${actor.team}_select` && b.currentPlayer && b.currentPlayer.id === actor.id)) {
        return cb?.({ ok: false, error: 'NOT_YOUR_TURN' });
      }

      // 명시하지 않으면 기본 공격
      const payload = action || { type: 'attack' };
      resolveAction(b, actor, payload);

      cb?.({ ok: true });
      socket.emit('actionSuccess');
      socket.emit('player:action:success');
    } catch (e) {
      cb?.({ ok: false, error: e?.message || 'ERR' });
    }
  });

  /* ─ 관리자용 소켓(선택) - 페이지가 HTTP 폴백도 쓰니 둘 다 지원 ─ */
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
      endBattle(b);
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
});

/* ───────────────────────── 플레이어 추가/링크 ───────────────────────── */
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
      dittany: Number(inp.items?.dittany ?? 0),
      attackBooster: Number(inp.items?.attackBooster ?? 0),
      defenseBooster: Number(inp.items?.defenseBooster ?? 0)
    },
    ready: false,
    stance: 'none',
    temp: {},
    token: uid('')
  };
  clearEphemeralOnNewRound(p);
  battle.players.push(p);
  return p;
}

function buildLinks(battle, baseUrl) {
  const base = baseUrl?.replace(/\/+$/, '') || '';
  const spectator = {
    otp: battle.spectatorOtp,
    url: `${base}/spectator?battle=${encodeURIComponent(battle.id)}&otp=${encodeURIComponent(battle.spectatorOtp)}`
  };
  const playerLinks = battle.players.map(p => ({
    id: p.id,
    playerId: p.id,
    playerName: p.name,
    team: p.team,
    otp: p.token,
    token: p.token,
    url: `${base}/player?battle=${encodeURIComponent(battle.id)}&playerId=${encodeURIComponent(p.id)}&token=${encodeURIComponent(p.token)}`
  }));
  return { spectator, playerLinks };
}

/* ─────────────────────────── HTTP API ─────────────────────────── */
// 건강 체크
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  const b = createBattle(req.body?.mode || '2v2');
  res.json({ ok: true, id: b.id, battle: publicBattle(b) });
});

// 전투 제어
app.post('/api/battles/:id/start', (req, res) => {
  try { const b = getBattle(req.params.id); startBattle(b); res.json({ ok: true }); }
  catch { res.status(404).json({ ok: false }); }
});
app.post('/api/battles/:id/pause', (req, res) => {
  try { const b = getBattle(req.params.id); b.status = 'paused'; emitUpdate(b); res.json({ ok: true }); }
  catch { res.status(404).json({ ok: false }); }
});
app.post('/api/battles/:id/resume', (req, res) => {
  try { const b = getBattle(req.params.id); b.status = 'active'; emitUpdate(b); res.json({ ok: true }); }
  catch { res.status(404).json({ ok: false }); }
});
app.post('/api/battles/:id/end', (req, res) => {
  try { const b = getBattle(req.params.id); endBattle(b); res.json({ ok: true }); }
  catch { res.status(404).json({ ok: false }); }
});

// 플레이어 추가(여러 경로 호환)
const addPlayerHttp = (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const p = addPlayer(b, req.body?.player || req.body);
    emitLog(b, `${p.name}이(가) ${p.team}팀으로 참가했습니다`, 'notice');
    emitUpdate(b);
    res.json({ ok: true, player: p, battle: publicBattle(b) });
  } catch (e) {
    res.status(404).json({ ok: false, error: e?.message || 'ERR' });
  }
};
app.post('/api/battles/:id/player', addPlayerHttp);
app.post('/api/battles/:id/players', addPlayerHttp);
app.post('/api/admin/battles/:id/player', addPlayerHttp);
app.post('/api/admin/battles/:id/players', addPlayerHttp);
app.post('/admin/battles/:id/players', addPlayerHttp);
app.post('/battles/:id/players', addPlayerHttp);

// 링크 생성(여러 경로 호환)
const linksHttp = (req, res) => {
  try {
    const b = getBattle(req.params.id);
    const out = buildLinks(b, req.headers['x-base-url']);
    res.json({ ok: true, ...out, players: b.players });
  } catch {
    res.status(404).json({ ok: false });
  }
};
app.post('/api/battles/:id/links', linksHttp);
app.post('/api/admin/battles/:id/links', linksHttp);

// CORS (마지막에 허용)
app.use(cors({ origin: CORS_ORIGIN }));

/* ───────────────────────── 서버 시작 ───────────────────────── */
server.listen(PORT, HOST, () => {
  console.log(`[server] listening on ${HOST}:${PORT} (ESM)`);
});
