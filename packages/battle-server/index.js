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
const d100 = () => randInt(1, 100);
const uid = (p = '') => `${p}${Math.random().toString(16).slice(2, 10)}`;

/* === 제한시간: 개인 턴 5분 === */
const turnSeconds = 300;
const interRoundSeconds = 5;

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
  io.to(battle.id).emit('battleUpdate', payload); // 레거시 이벤트도 병행
}
function emitLog(battle, message, type = 'battle') {
  const log = { ts: now(), type, message };
  io.to(battle.id).emit('battle:log', log);
  battle.roundEvents.push(log); // 라운드 요약용
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
    spectatorOtp: uid('').slice(0, 8),
    _startingTeam: 'A'
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
  do {
    battle.turnIndex += 1;
    if (battle.turnIndex >= battle.turnOrder.length) {
      if (!opts.newRoundIfNeeded) {
        battle.currentPlayer = null;
        battle.currentTeam = null;
        return;
      }
      emitLog(battle, '=== 라운드 결과 ===');
      emitLog(battle, `${battle.turnNumber}라운드 종료`);
      emitLog(battle, '5초 후 다음 라운드 시작...', 'notice');

      battle.status = 'active';
      battle.turnNumber += 1;
      battle.currentPlayer = null;
      battle.currentTeam = null;
      battle.turnDeadline = now() + interRoundSeconds * 1000;
      emitUpdate(battle);

      setTimeout(() => startRound(battle), interRoundSeconds * 1000);
      return;
    }
    battle.currentPlayer = battle.turnOrder[battle.turnIndex] || null;
  } while (!battle.currentPlayer || battle.currentPlayer.hp <= 0);

  battle.currentTeam = battle.currentPlayer.team;
  battle.turnDeadline = now() + turnSeconds * 1000;

  clearEphemeralOnTurnStart(battle.currentPlayer);

  const headerKey = `header_${battle.currentTeam}_${battle.turnNumber}`;
  if (!battle[headerKey]) {
    battle[headerKey] = true;
    emitLog(battle, `=== ${battle.currentTeam}팀 행동 ===`);
  }

  emitUpdate(battle);
}

function startRound(battle) {
  if (battle.status !== 'active') battle.status = 'active';

  const firstTeam = battle.turnNumber % 2 === 1 ? battle._startingTeam : (battle._startingTeam === 'A' ? 'B' : 'A');
  buildTurnOrder(battle, firstTeam);

  battle[`header_A_${battle.turnNumber}`] = false;
  battle[`header_B_${battle.turnNumber}`] = false;

  battle.roundEvents = [];

  // 라운드 시작 시, 지난 라운드의 방어 보정 잔여분 정리
  for (const p of battle.players) {
    if (p.temp?.defenseBoostRound !== battle.turnNumber) {
      if (p.temp) { delete p.temp.defenseBoostRound; delete p.temp.defenseBoostCount; }
    }
  }

  battle.currentPlayer = null;
  battle.currentTeam = null;
  battle.turnIndex = -1;
  advanceTurn(battle);
}

function startBattle(battle) {
  if (battle.status === 'active') return;

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
      if (battle.currentPlayer && battle.currentPlayer.hp > 0) {
        const target = pickRandomEnemy(battle, battle.currentPlayer.team);
        resolveAction(battle, battle.currentPlayer, { type: 'attack', targetId: target?.id, auto: true });
      } else {
        advanceTurn(battle);
      }
    } else {
      emitUpdate(battle);
    }
  }, 1000);
}

/* ───────────────────────── 행동 처리(룰) ───────────────────────── */
function clearEphemeralOnTurnStart(p) {
  // 자신의 턴 시작 시, 태세만 초기화 (자동 방/회피 없음 유지)
  p.stance = 'none';
  p.temp = p.temp || {};
  // 방어 보정은 라운드 한정/1회 소모형이므로 여기선 만료 처리하지 않음
}

function pickRandomEnemy(battle, myTeam) {
  const enemies = livingPlayers(battle, myTeam === 'A' ? 'B' : 'A');
  if (!enemies.length) return null;
  return enemies[randInt(0, enemies.length - 1)];
}

// 치명타: d10 ≥ (10 − luck/2)
const isCrit = (attacker) => d10() >= (10 - Number(attacker.stats?.luck || 0) / 2);

// 공격 최종 수치 계산
// 기본: base = (공격스탯 + d10)
// 보정 성공시: base × 2 → 이후 치명타 반영(×2)
const computeAttackFinal = (attacker, boosted = false) => {
  const base = Number(attacker.stats?.attack || 1) + d10();
  const boostedVal = boosted ? base * 2 : base;
  const crit = isCrit(attacker);
  return { final: crit ? boostedVal * 2 : boostedVal, crit };
};

// 방어값 계산
// 기본: (방어스탯 + d10)
// 보정(해당 라운드 1회 부여) 활성 시: 위 값을 ×2 하고 즉시 1회 소모
const computeDefenseVal = (battle, defender) => {
  const base = Number(defender.stats?.defense || 1) + d10();
  const canBoost =
    defender.stance === 'defend' && // 반드시 방어 태세를 선택해야 적용
    defender.temp?.defenseBoostRound === battle.turnNumber &&
    (defender.temp?.defenseBoostCount || 0) > 0;

  if (canBoost) {
    defender.temp.defenseBoostCount -= 1;
    if (defender.temp.defenseBoostCount <= 0) {
      delete defender.temp.defenseBoostCount;
      delete defender.temp.defenseBoostRound;
    }
    emitLog(battle, `${defender.name}의 방어 보정기 효과 적용`, 'battle');
    return base * 2;
  }
  return base;
};

// 회피 판정 (회피 태세일 때만)
const checkDodge = (defender, attackerFinal) => {
  const agi = Number(defender.stats?.agility || 1);
  return (agi + d10()) >= attackerFinal;
};

// 피해 적용
function applyDamage(battle, defender, dmg, attacker, isCritFlag) {
  const before = defender.hp;
  const delta = Math.max(0, Math.floor(dmg));
  defender.hp = clamp(defender.hp - delta, 0, defender.maxHp);
  const after = defender.hp;

  if (defender.hp <= 0) {
    emitLog(battle, `${attacker.name}의 ${isCritFlag ? '강화된 ' : ''}치명타 공격으로 ${defender.name} 사망! (피해 ${before})`);
  } else {
    emitLog(battle, `${attacker.name}이(가) ${defender.name}에게 ${isCritFlag ? '강화된 공격 ' : '공격 '} (피해 ${before - after}) → HP ${after}`);
  }
}

// 공통 공격 수행(보정 여부 인자로)
function performAttack(battle, attacker, explicitTarget, { boost = false } = {}) {
  const target = explicitTarget && explicitTarget.hp > 0
    ? explicitTarget
    : pickRandomEnemy(battle, attacker.team);
  if (!target) {
    emitLog(battle, `${attacker.name}이(가) 공격할 대상이 없습니다 (모두 사망)`);
    return;
  }

  const { final: atkFinal, crit } = computeAttackFinal(attacker, boost);

  if (target.stance === 'dodge') {
    if (checkDodge(target, atkFinal)) {
      emitLog(battle, `${target.name}이(가) 회피 성공! 피해 0`);
    } else {
      applyDamage(battle, target, atkFinal, attacker, crit);
    }
  } else if (target.stance === 'defend') {
    const defVal = computeDefenseVal(battle, target);
    const remained = atkFinal - defVal;
    if (remained <= 0) {
      emitLog(battle, `${target.name}이(가) 방어 성공! 피해 없음`);
    } else {
      applyDamage(battle, target, remained, attacker, crit);
    }
  } else {
    // 태세 선택 안 했으면 자동 방/회피 없음 → 정면타
    applyDamage(battle, target, atkFinal, attacker, crit);
  }

  emitLog(battle, `${attacker.name}이(가) ${target.name}을(를) 공격`);
}

/* ───────────────────────── 액션 해석 ───────────────────────── */
function resolveAction(battle, actor, payload) {
  if (!actor || actor.hp <= 0) {
    advanceTurn(battle);
    return;
  }
  const type = payload?.type || 'attack';

  const logLine = (txt) => emitLog(battle, `→ ${txt}`, 'battle');
  const boosterSucceeds = () => d100() <= 60; // 성공률 60%

  // 팀 헤더(라운드당 최초 1회)
  const teamHeaderKey = `header_${actor.team}_${battle.turnNumber}`;
  if (!battle[teamHeaderKey]) {
    battle[teamHeaderKey] = true;
    emitLog(battle, `=== ${actor.team}팀 행동 ===`);
  }

  switch (type) {
    case 'attack': {
      const target = (payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0))
        || pickRandomEnemy(battle, actor.team);
      performAttack(battle, actor, target, { boost: false });
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
      if (!item) { logLine(`${actor.name}의 아이템 사용 실패(지정 안됨)`); break; }
      actor.items = actor.items || { dittany: 0, attackBooster: 0, defenseBooster: 0 };

      if (item === 'dittany') {
        // 아군(본인 포함) 고정 10 회복, 100% 성공
        if ((actor.items.dittany || 0) <= 0) { logLine(`${actor.name}의 디터니 사용 실패 (수량 부족)`); break; }
        const tgt = (payload?.targetId && battle.players.find(p => p.id === payload.targetId)) || actor;
        if (!tgt || tgt.hp <= 0) { logLine(`${actor.name}의 ${tgt ? tgt.name : '대상'}에게 디터니 사용 실패 (사망자)`); break; }
        actor.items.dittany = Math.max(0, (actor.items.dittany || 0) - 1);

        const before = tgt.hp;
        const heal = 10;
        tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp || 100);
        logLine(`${actor.name}이(가) ${tgt.name} 치유 (+${tgt.hp - before}) → HP ${tgt.hp}`);
        break;
      }

      if (item === 'attackBooster') {
        // 적군 대상 지정 필수, 이 액션으로 즉시 그 대상에게 공격 1회 수행
        if ((actor.items.attackBooster || 0) <= 0) { logLine(`${actor.name}의 공격 보정기 사용 실패 (수량 부족)`); break; }
        const target = (payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0)) || null;
        if (!target || target.team === actor.team) { logLine(`${actor.name}의 공격 보정기 사용 실패 (적군 대상 필요)`); break; }

        actor.items.attackBooster = Math.max(0, (actor.items.attackBooster || 0) - 1);

        const ok = boosterSucceeds();
        logLine(`${actor.name}이(가) 공격 보정기 ${ok ? '사용 성공' : '사용 실패(확률)'}`);
        performAttack(battle, actor, target, { boost: ok });
        break;
      }

      if (item === 'defenseBooster') {
        // 아군 대상 지정 필수, 성공 시 해당 라운드 동안 방어 태세의 첫 방어 1회 ×2
        if ((actor.items.defenseBooster || 0) <= 0) { logLine(`${actor.name}의 방어 보정기 사용 실패 (수량 부족)`); break; }
        const tgt = (payload?.targetId && battle.players.find(p => p.id === payload.targetId && p.hp > 0)) || null;
        if (!tgt || tgt.team !== actor.team) { logLine(`${actor.name}의 방어 보정기 사용 실패 (아군 대상 필요)`); break; }

        actor.items.defenseBooster = Math.max(0, (actor.items.defenseBooster || 0) - 1);

        const ok = boosterSucceeds();
        if (ok) {
          tgt.temp = tgt.temp || {};
          tgt.temp.defenseBoostRound = battle.turnNumber; // 이번 라운드 한정
          tgt.temp.defenseBoostCount = 1; // 1회 소모
          logLine(`${actor.name}이(가) ${tgt.name}에게 방어 보정기 부여 (이번 라운드 1회)`);
          // 자동 방어나 회피는 없음. 대상이 '방어'를 선택했을 때만 적용됨.
        } else {
          logLine(`${actor.name}의 ${tgt.name}에게 방어 보정기 사용 실패(확률)`);
        }
        break;
      }

      logLine(`${actor.name}의 알 수 없는 아이템 사용`);
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

  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    try {
      const b = getBattle(battleId);
      if (b.status !== 'active') return cb?.({ ok: false, error: 'NOT_ACTIVE' });

      const actor = b.players.find(x => x.id === playerId);
      if (!actor || actor.hp <= 0) return cb?.({ ok: false, error: 'DEAD' });
      if (!b.currentPlayer || b.currentPlayer.id !== actor.id) {
        return cb?.({ ok: false, error: 'NOT_YOUR_TURN' });
      }

      resolveAction(b, actor, action || { type: 'attack' });

      cb?.({ ok: true });
      socket.emit('actionSuccess');
      socket.emit('player:action:success');
    } catch (e) {
      cb?.({ ok: false, error: e?.message || 'ERR' });
    }
  });

  /* ─ 관리자용 소켓 ─ */
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
    try { const b = getBattle(battleId); endBattle(b); cb?.({ ok: true }); }
    catch { cb?.({ ok: false }); }
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
    token: uid(''),
    temp: {}
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
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/battles', (req, res) => {
  const b = createBattle(req.body?.mode || '2v2');
  res.json({ ok: true, id: b.id, battle: publicBattle(b) });
});

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
