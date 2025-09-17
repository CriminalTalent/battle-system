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

const turnSeconds = 30;
const interRoundSeconds = 5;

/* ─────────────── 패치 1 상수: 레거시 add 라우팅 + 쿨다운 ─────────────── */
const ADD_COOLDOWN_MS = 1500;
const LEGACY_ADD_EVENTS = ['admin:addPlayer', 'battle:addPlayer', 'player:add'];

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
    status: b.status,
    players: b.players.map(p => ({
      id: p.id, team: p.team, name: p.name, avatar: p.avatar || '/uploads/avatars/default.svg',
      hp: p.hp, maxHp: p.maxHp,
      stats: p.stats, items: { ...p.items },
      ready: !!p.ready
    })),
    currentTurn: {
      turnNumber: b.turnNumber,
      currentTeam: b.currentTeam,
      currentPlayer: b.currentPlayer ? {
        id: b.currentPlayer.id, name: b.currentPlayer.name, avatar: b.currentPlayer.avatar, team: b.currentPlayer.team
      } : null,
      timeLeftSec: Math.max(0, Math.floor((b.turnDeadline - now()) / 1000))
    }
  };
}

/* ───────────────────────── 배틀 생성/조회 ───────────────────────── */
function createBattle(mode = '2v2') {
  const id = `battle_${Date.now()}_${uid('')}`;
  const battle = {
    id, mode,
    status: 'waiting',
    players: [],
    turnNumber: 1,
    currentTeam: null,
    currentPlayer: null,
    turnDeadline: 0,
    turnOrder: [],
    turnIndex: 0,
    roundEvents: [],
    _timer: null,
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

/* ────────────────────────── 라운드/턴 제어 ────────────────────────── */
function livingPlayers(battle, team = null) {
  return battle.players.filter(p => p.hp > 0 && (!team || p.team === team));
}

function buildTurnOrder(battle, firstTeam) {
  const A = livingPlayers(battle, 'A');
  const B = livingPlayers(battle, 'B');
  const order = [];
  const longer = Math.max(A.length, B.length);
  for (let i = 0; i < longer; i++) {
    if (firstTeam === 'A') {
      if (A[i]) order.push(A[i]);
      if (B[i]) order.push(B[i]);
    } else {
      if (B[i]) order.push(B[i]);
      if (A[i]) order.push(A[i]);
    }
  }
  battle.turnOrder = order;
  battle.turnIndex = 0;
}

function advanceTurn(battle, opts = { newRoundIfNeeded: true }) {
  // 다음 유효 플레이어로 이동
  do {
    battle.turnIndex += 1;
    if (battle.turnIndex >= battle.turnOrder.length) {
      if (!opts.newRoundIfNeeded) {
        battle.currentPlayer = null;
        battle.currentTeam = null;
        return;
      }
      // 라운드 종료 → 결과 요약 + 다음 라운드 5초 예고
      emitLog(battle, '=== 라운드 결과 ===', 'battle');
      // 결과 요약: roundEvents 안의 공격/치유/사망 메시지 등은 이미 실시간으로 기록됨
      emitLog(battle, `${battle.turnNumber}라운드 종료`, 'battle');
      emitLog(battle, '5초 후 다음 라운드 시작...', 'notice');

      battle.status = 'active';
      battle.turnNumber += 1;
      battle.currentPlayer = null;
      battle.currentTeam = null;
      battle.turnDeadline = now() + interRoundSeconds * 1000;
      emitUpdate(battle);

      // 5초 후 새 라운드 시작
      setTimeout(() => {
        startRound(battle);
      }, interRoundSeconds * 1000);
      return;
    }
    battle.currentPlayer = battle.turnOrder[battle.turnIndex] || null;
  } while (!battle.currentPlayer || battle.currentPlayer.hp <= 0);

  battle.currentTeam = battle.currentPlayer.team;
  battle.turnDeadline = now() + turnSeconds * 1000;

  // 플레이어가 이전 턴에 설정한 일시적 상태(보정기 사용, 방어/회피 지속)는
  // "자신이 새로운 턴을 시작하면" 해제된다.
  clearEphemeralOnTurnStart(battle.currentPlayer);

  // 팀별 행동 헤더 표시(첫 액션 전에 1회)
  const headerKey = `header_${battle.currentTeam}_${battle.turnNumber}`;
  if (!battle[headerKey]) {
    battle[headerKey] = true;
    emitLog(battle, `=== ${battle.currentTeam}팀 행동 ===`, 'battle');
  }

  emitUpdate(battle);
}

function startRound(battle) {
  if (battle.status !== 'active') battle.status = 'active';

  // 선공은 라운드마다 교대
  const firstTeam = battle.turnNumber % 2 === 1 ? battle._startingTeam : (battle._startingTeam === 'A' ? 'B' : 'A');
  buildTurnOrder(battle, firstTeam);

  // 라운드 시작 시 팀 헤더 리셋용 플래그 초기화
  battle[`header_A_${battle.turnNumber}`] = false;
  battle[`header_B_${battle.turnNumber}`] = false;

  // 라운드 이벤트 버퍼 초기화
  battle.roundEvents = [];

  // 첫 턴으로 이동
  battle.currentPlayer = null;
  battle.currentTeam = null;
  battle.turnIndex = -1;
  advanceTurn(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

  // 선공 결정 로그(주사위 1~10)
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
  battle.turnDeadline = now();
  emitUpdate(battle);
}

function startTick(battle) {
  if (battle._timer) clearInterval(battle._timer);
  battle._timer = setInterval(() => {
    if (battle.status !== 'active') return;
    if (!battle.turnDeadline) return;

    const left = Math.max(0, Math.floor((battle.turnDeadline - now()) / 1000));
    if (left === 0) {
      // 시간 초과 → 기본 행동: 공격(랜덤 대상)
      if (battle.currentPlayer && battle.currentPlayer.hp > 0) {
        const target = pickRandomEnemy(battle, battle.currentPlayer.team);
        resolveAction(battle, battle.currentPlayer, { type: 'attack', targetId: target?.id, auto: true });
      } else {
        advanceTurn(battle);
      }
    } else {
      // 매초 UI에 남은 시간 반영
      emitUpdate(battle);
    }
  }, 1000);
}

/* ───────────────────────── 행동 처리(룰) ───────────────────────── */
function clearEphemeralOnTurnStart(p) {
  // 자신의 턴이 시작되면 이전 턴에 선택한 방어/회피/보정 사용 상태는 초기화
  p.stance = 'none';
  p.temp = {}; // { attackBoost:bool, defenseBoost:bool, lastUsed:'attackBooster'|'defenseBooster'|'dittany' }
}

function pickRandomEnemy(battle, myTeam) {
  const enemies = livingPlayers(battle, myTeam === 'A' ? 'B' : 'A');
  if (!enemies.length) return null;
  return enemies[randInt(0, enemies.length - 1)];
}

function resolveAction(battle, actor, payload) {
  if (!actor || actor.hp <= 0) {
    advanceTurn(battle);
    return;
  }
  const type = payload?.type || 'attack';
  const enemyTeam = actor.team === 'A' ? 'B' : 'A';

  const logLine = (txt) => emitLog(battle, `→ ${txt}`, 'battle');

  // 아이템 성공 확률(90%)
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

  // 팀 행동 라인
  const teamHeaderKey = `header_${actor.team}_${battle.turnNumber}`;
  if (!battle[teamHeaderKey]) {
    battle[teamHeaderKey] = true;
    emitLog(battle, `=== ${actor.team}팀 행동 ===`, 'battle');
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
          // 회피 실패 → 방어 차감 없이 정면 피해
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
      // 아무 행동 없이 자신의 순서 종료
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
          logLine(`${actor.name}이(가) 공격 보정기 사용 실패 (실패확률 10%)`);
        } else {
          actor.temp = actor.temp || {};
          actor.temp.attackBoost = true; // 이번 턴에만 적용
          logLine(`${actor.name}이(가) 공격 보정기 사용 성공`);
        }
      } else if (item === 'defenseBooster') {
        if (!itemSucceeds()) {
          logLine(`${actor.name}이(가) 방어 보정기 사용 실패 (실패확률 10%)`);
        } else {
          actor.temp = actor.temp || {};
          actor.temp.defenseBoost = true; // 이번 턴에만 적용
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

  // 팀 선택 완료 여부: 이번 라운드에서 이 팀의 생존자들이 모두 1회 이상 행동했는지
  const aliveThisTeam = livingPlayers(battle, actor.team);
  const actedSetKey = `_acted_${actor.team}_${battle.turnNumber}`;
  battle[actedSetKey] = battle[actedSetKey] || new Set();
  battle[actedSetKey].add(actor.id);
  const allActed = aliveThisTeam.every(p => battle[actedSetKey].has(p.id));
  if (allActed) {
    emitLog(battle, `${actor.team}팀 선택 완료`, 'battle');
  }

  // 팀 전멸 체크
  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    endBattle(battle, aliveA > 0 ? 'A' : (aliveB > 0 ? 'B' : null));
    return;
  }

  emitUpdate(battle);
  advanceTurn(battle);
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

  /* ───────────────────────── 패치 1: addPlayer 라우팅/쿨다운 ───────────────────────── */
  function routeAddPlayer(payload, cb) {
    try {
      const battleId = payload?.battleId;
      if (!battleId || !battles.has(battleId)) return cb?.({ ok: false, error: 'NOT_FOUND' });

      // 소켓별 쿨다운(중복 클릭/중복 호출 방지)
      const t = now();
      socket._lastAddAt = socket._lastAddAt || 0;
      if (t - socket._lastAddAt < ADD_COOLDOWN_MS) {
        return cb?.({ ok: false, error: 'COOLDOWN' });
      }
      socket._lastAddAt = t;

      const b = getBattle(battleId);
      const inp = payload?.player || payload; // {name, team, ...} 또는 {player:{...}}
      const p = addPlayer(b, inp);
      emitLog(b, `${p.name}이(가) ${p.team}팀으로 참가했습니다`, 'notice');
      emitUpdate(b);
      cb?.({ ok: true, player: p });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || 'ERR' });
    }
  }

  // 표준 이벤트
  socket.on('addPlayer', routeAddPlayer);
  // 레거시 이벤트들을 표준 경로로 라우팅
  for (const ev of LEGACY_ADD_EVENTS) {
    socket.on(ev, (payload, cb) => routeAddPlayer(payload, cb));
  }

  /* ───────────────────────── 기존 deletePlayer 그대로 ───────────────────────── */
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
    token: uid('')
  };
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
