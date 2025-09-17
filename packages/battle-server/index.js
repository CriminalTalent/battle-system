/* packages/battle-server/index.js (ESM) — Team-Phase Engine (D10 규칙, 팀당 5분) */

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

// 팀 선택 시간(초) = 5분
const TEAM_SELECT_SECONDS = Number(process.env.TEAM_SELECT_SECONDS || 300);
// 라운드 사이 숨 고르기(초)
const INTER_SECONDS = Number(process.env.INTER_SECONDS || 5);

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

const send = file => (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
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
// d20/d100은 사용하지 않음(D10 규칙 고정)
const uid = (p = '') => `${p}${Math.random().toString(16).slice(2, 10)}`;

/* ────────────────── 업로드 (아바타) : /api/upload/avatar ────────────────── */
const uploadDir = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
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
    status: b.status,          // 'waiting' | 'active' | 'paused' | 'ended'
    phase: b.phase,            // 'A_select' | 'B_select' | 'resolve' | 'inter' | null
    players: b.players.map(p => ({
      id: p.id, team: p.team, name: p.name, avatar: p.avatar || '/uploads/avatars/default.svg',
      hp: p.hp, maxHp: p.maxHp,
      stats: p.stats, items: { ...p.items },
      ready: !!p.ready
    })),
    currentTurn: {
      turnNumber: b.turnNumber,
      currentTeam: b.currentTeam,          // 현재 선택 중인 팀
      currentPlayer: null,                 // 팀 페이즈 구조에서는 항상 null
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
    phase: null,
    players: [],
    turnNumber: 1,
    currentTeam: null,
    turnDeadline: 0,
    roundEvents: [],
    _timer: null,
    spectatorOtp: uid('').slice(0, 8),
    _startingTeam: null,           // 경기 시작 시 선공(A/B)
    _roundFirstTeam: null,         // 이번 라운드 선공(A/B)
    // 팀별 행동 보관: playerId -> action
    pending: { A: new Map(), B: new Map() }
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

/* ───────────────────────── 유틸(룰 공통) ───────────────────────── */
function livingPlayers(battle, team = null) {
  return battle.players.filter(p => p.hp > 0 && (!team || p.team === team));
}
function pickRandomEnemy(battle, myTeam) {
  const enemies = livingPlayers(battle, myTeam === 'A' ? 'B' : 'A');
  if (!enemies.length) return null;
  return enemies[randInt(0, enemies.length - 1)];
}
function clearRoundEphemeral(battle) {
  battle.players.forEach(p => {
    p.stance = 'none';
    p.temp = {}; // { attackBoost:true, defenseBoost:true } (그 턴 한정)
  });
}
const success90 = () => d10() !== 1; // d10에서 1만 실패(10%)

/* ───────────────────────── 페이즈/라운드 제어 ───────────────────────── */
function beginTeamSelect(battle, team) {
  battle.phase = `${team}_select`;
  battle.currentTeam = team;
  battle.turnDeadline = now() + TEAM_SELECT_SECONDS * 1000;
  battle.roundEvents = battle.roundEvents || [];
  emitLog(battle, `=== ${team}팀 행동 ===`, 'battle');
  emitUpdate(battle);
}

function startRound(battle) {
  if (battle.status !== 'active') battle.status = 'active';

  // 이번 라운드 선공 (라운드마다 교대)
  const firstTeam = battle.turnNumber % 2 === 1
    ? battle._startingTeam
    : (battle._startingTeam === 'A' ? 'B' : 'A');
  battle._roundFirstTeam = firstTeam;

  // 라운드 시작: 임시 상태/선택 초기화
  clearRoundEphemeral(battle);
  battle.pending = { A: new Map(), B: new Map() };

  emitLog(battle, `— ${battle.turnNumber} 라운드 시작 —`, 'battle');
  beginTeamSelect(battle, firstTeam);
}

function closeTeamSelect(battle, team) {
  // 선택 안한 인원은 기본 공격으로 채움
  const alive = livingPlayers(battle, team);
  const store = battle.pending[team];
  alive.forEach(p => {
    if (!store.has(p.id)) {
      store.set(p.id, { type: 'attack' });
    }
  });
  emitLog(battle, `${team}팀 선택 완료`, 'battle');
}

function allActed(battle, team) {
  const alive = livingPlayers(battle, team);
  const store = battle.pending[team];
  if (alive.length === 0) return true;
  return alive.every(p => store.has(p.id));
}

function advancePhase(battle) {
  if (battle.phase === 'A_select' || battle.phase === 'B_select') {
    const cur = battle.currentTeam;
    const other = cur === 'A' ? 'B' : 'A';
    closeTeamSelect(battle, cur);
    // 현재가 라운드 선공이면 → 상대팀 선택으로, 아니면 → 해석으로
    if (cur === battle._roundFirstTeam) {
      beginTeamSelect(battle, other);
    } else {
      resolveRound(battle);
    }
    return;
  }
  if (battle.phase === 'inter') {
    startRound(battle);
  }
}

/* ───────────────────────── 라운드 해석(결과 집계, D10 규칙) ───────────────────────── */
function resolveRound(battle) {
  battle.phase = 'resolve';
  battle.currentTeam = null;
  battle.turnDeadline = now() + 2000; // 짧게 표시
  emitLog(battle, `=== 라운드 결과 ===`, 'battle');

  const logLine = (txt) => emitLog(battle, `→ ${txt}`, 'battle');

  // 공격 굴림: (공 × (부스터 2배 or 1)) + d10, 치명타면 x2
  const rollFinalAttack = (attacker, boostActive) => {
    const atkStat = Number(attacker.stats?.attack || 1);
    const coeff = boostActive ? 2 : 1;
    const base = atkStat * coeff + d10();
    // 치명타: d10 ≥ (10 - luck/2)  (소수점 내림 금지)
    const crit = (d10() >= (10 - (Number(attacker.stats?.luck || 0) / 2)));
    return { value: crit ? base * 2 : base, crit };
  };

  // 방어값: (방어 × (부스터 2배 or 1)) + d10
  const rollDefense = (defender, boostActive) => {
    const defStat = Number(defender.stats?.defense || 1);
    const coeff = boostActive ? 2 : 1;
    return defStat * coeff + d10();
  };

  // 회피: (민첩 + d10) ≥ 공격자의 최종공격력
  const checkDodge = (defender, attackerFinal) => {
    const agi = Number(defender.stats?.agility || 1);
    return (agi + d10()) >= attackerFinal;
  };

  // 피해 적용 + 메시지
  const applyDamage = (defender, dmg, attacker, isCrit, boosted) => {
    if (!defender || defender.hp <= 0) return;
    const before = defender.hp;
    const delta = Math.max(0, Math.floor(dmg));
    defender.hp = clamp(defender.hp - delta, 0, defender.maxHp);
    const after = defender.hp;
    const boostedTag = boosted ? '강화된 ' : '';
    if (defender.hp <= 0) {
      logLine(`${attacker.name}의 ${boostedTag}${isCrit ? '치명타 ' : ''}공격으로 ${defender.name} 사망! (피해 ${before})`);
    } else {
      logLine(`${attacker.name}이(가) ${defender.name}에게 ${boostedTag}${isCrit ? '치명타 ' : ''}공격 (피해 ${before - after}) → HP ${after}`);
    }
  };

  // 프리패스: 방어/회피 태세, 디터니 처리(사망자 회복 불가), 아이템형 부스터(선택 시)
  const prepass = (team) => {
    battle.pending[team].forEach((action, pid) => {
      const actor = battle.players.find(p => p.id === pid);
      if (!actor || actor.hp <= 0) return;
      switch (action?.type) {
        case 'defend':
          actor.stance = 'defend';
          logLine(`${actor.name}이(가) 방어 태세`);
          break;
        case 'dodge':
          actor.stance = 'dodge';
          logLine(`${actor.name}이(가) 회피 태세`);
          break;
        case 'item': {
          const item = action?.item;
          if (item === 'attackBooster') {
            if (success90()) {
              actor.temp.attackBoost = true;
              logLine(`${actor.name}이(가) 공격 보정기 사용 성공`);
            } else {
              logLine(`${actor.name}이(가) 공격 보정기 사용 실패 (실패확률 10%)`);
            }
          } else if (item === 'defenseBooster') {
            if (success90()) {
              actor.temp.defenseBoost = true;
              logLine(`${actor.name}이(가) 방어 보정기 사용 성공`);
            } else {
              logLine(`${actor.name}이(가) 방어 보정기 사용 실패 (실패확률 10%)`);
            }
          } else if (item === 'dittany') {
            const tgt = (action?.targetId && battle.players.find(p => p.id === action.targetId && p.hp > 0)) || actor;
            if (!tgt || tgt.hp <= 0) {
              logLine(`${actor.name}의 ${tgt ? tgt.name : '대상'}에게 디터니 사용 실패 (사망자)`);
            } else if (!success90()) {
              logLine(`${actor.name}의 ${tgt.name}에게 디터니 사용 실패 (확률)`);
            } else {
              const heal = 15 + d10();
              const before = tgt.hp;
              tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp || 100);
              logLine(`${actor.name}이(가) ${tgt.name} 치유 (+${tgt.hp - before}) → HP ${tgt.hp}`);
            }
          } else {
            logLine(`${actor.name}의 알 수 없는 아이템 사용`);
          }
          break;
        }
        default:
          // attack/pass 등은 해석 단계에서 처리
          break;
      }
    });
  };

  prepass('A');
  prepass('B');

  // 공격 해석 유틸(선공 → 후공 순으로)
  const resolveAttacksFor = (team) => {
    battle.pending[team].forEach((action, pid) => {
      const actor = battle.players.find(p => p.id === pid);
      if (!actor || actor.hp <= 0) return;

      const type = action?.type || 'attack';
      if (type === 'pass' || type === 'defend' || type === 'dodge' || type === 'item') {
        if (type === 'pass') logLine(`${actor.name}이(가) 행동 패스`);
        return; // 공격만 여기서 처리
      }

      // 대상 선택 (없으면 랜덤)
      let target = (action?.targetId && battle.players.find(p => p.id === action.targetId && p.hp > 0))
        || pickRandomEnemy(battle, actor.team);
      if (!target) {
        logLine(`${actor.name}이(가) 공격할 대상이 없습니다 (모두 사망)`);
        return;
      }

      // 공격 부스터: (1) 액션 플래그(useAttackBooster) 또는 (2) 아이템형 사전 사용(temp.attackBoost)
      let atkBoostActive = false;
      if (action?.useAttackBooster === true) {
        if (success90()) {
          atkBoostActive = true;
          logLine(`${actor.name}이(가) 공격 보정기 사용 성공`);
        } else {
          logLine(`${actor.name}이(가) 공격 보정기 사용 실패 (실패확률 10%)`);
        }
      } else if (actor?.temp?.attackBoost) {
        atkBoostActive = true;
      }

      const { value: finalAtk, crit } = rollFinalAttack(actor, atkBoostActive);

      // 방어/회피 검사: 방어나 회피를 **선택하지 않았다면** 자동 적용 없음(stance='none')
      if (target.stance === 'dodge') {
        if (checkDodge(target, finalAtk)) {
          const boostedTag = atkBoostActive ? '강화된 ' : '';
          logLine(`${actor.name}의 ${boostedTag}공격이 ${target.name}에게 빗나감`);
          return;
        }
        // 실패 시 방어 차감 없이 정면 피해
        applyDamage(target, finalAtk, actor, crit, atkBoostActive);
        return;
      }

      if (target.stance === 'defend') {
        // 수비자 부스터: 액션 플래그(useDefenseBooster) 또는 아이템형(temp.defenseBoost)
        const defStore = battle.pending[target.team];
        const defAction = defStore?.get(target.id);
        let defBoostActive = false;
        if (defAction?.useDefenseBooster === true) {
          if (success90()) {
            defBoostActive = true;
            logLine(`${target.name}이(가) 방어 보정기 사용 성공`);
          } else {
            logLine(`${target.name}이(가) 방어 보정기 사용 실패 (실패확률 10%)`);
          }
        } else if (target?.temp?.defenseBoost) {
          defBoostActive = true;
        }

        const defVal = rollDefense(target, defBoostActive);
        const remained = finalAtk - defVal;
        if (remained <= 0) {
          logLine(`${target.name}이(가) 방어 성공! 피해 없음`);
        } else {
          applyDamage(target, remained, actor, crit, atkBoostActive);
        }
        return;
      }

      // 방어/회피를 선택하지 않은 대상: 최종공격력(치명타 반영) 그대로 적용
      applyDamage(target, finalAtk, actor, crit, atkBoostActive);
    });
  };

  // 선공 팀 → 후공 팀 순서로 공격 해석
  resolveAttacksFor(battle._roundFirstTeam);
  resolveAttacksFor(battle._roundFirstTeam === 'A' ? 'B' : 'A');

  // 전멸/종료 체크
  const aliveA = livingPlayers(battle, 'A').length;
  const aliveB = livingPlayers(battle, 'B').length;
  if (aliveA === 0 || aliveB === 0) {
    endBattle(battle, aliveA > 0 ? 'A' : (aliveB > 0 ? 'B' : null));
    return;
  }

  // 인터라운드 대기
  emitLog(battle, `${battle.turnNumber}라운드 종료`, 'battle');
  emitLog(battle, `${INTER_SECONDS}초 후 다음 라운드 시작...`, 'notice');

  battle.phase = 'inter';
  battle.turnNumber += 1;
  battle.turnDeadline = now() + INTER_SECONDS * 1000;
  battle.currentTeam = null;
  emitUpdate(battle);
}

/* ───────────────────────── 전투 시작/종료 ───────────────────────── */
function startBattle(battle) {
  if (battle.status === 'active') return;

  // 선공 결정: d10 두 번 합(동점 시 A 우선)
  const a1 = d10(), a2 = d10();
  const b1 = d10(), b2 = d10();
  const aSum = a1 + a2, bSum = b1 + b2;

  emitLog(battle, `선공 결정: A팀(${a1}+${a2}=${aSum}) vs B팀(${b1}+${b2}=${bSum})`, 'notice');

  battle._startingTeam = aSum >= bSum ? 'A' : 'B';
  emitLog(battle, `${battle._startingTeam}팀이 선공입니다!`, 'notice');

  battle.status = 'active';
  battle.turnNumber = 1;
  emitLog(battle, '전투가 시작되었습니다!', 'notice');

  startRound(battle);
}

function endBattle(battle, winner = null) {
  battle.status = 'ended';
  battle.phase = null;
  if (winner) {
    emitLog(battle, `${winner}팀 승리!`, 'result');
  } else {
    emitLog(battle, '무승부 또는 동시 전멸', 'result');
  }
  battle.currentTeam = null;
  battle.turnDeadline = now();
  emitUpdate(battle);
}

/* ───────────────────────── 타이머 틱 ───────────────────────── */
function startTick(battle) {
  if (battle._timer) clearInterval(battle._timer);
  battle._timer = setInterval(() => {
    if (battle.status !== 'active') return;
    if (!battle.turnDeadline) return;

    const left = Math.max(0, Math.floor((battle.turnDeadline - now()) / 1000));
    if (left === 0) {
      // 페이즈 타임아웃 처리
      if (battle.phase === 'A_select' || battle.phase === 'B_select') {
        advancePhase(battle); // 미제출자 자동 공격 채우고 다음 페이즈/해석
      } else if (battle.phase === 'inter') {
        startRound(battle);
      }
    } else {
      // 매초 UI에 잔여시간 반영
      emitUpdate(battle);
    }
  }, 1000);
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

  // 팀 선택 페이즈에서만 액션 제출 허용
  // action 예시:
  //  - { type:'attack', targetId, useAttackBooster:true }
  //  - { type:'defend', useDefenseBooster:true }
  //  - { type:'dodge' } | { type:'pass' }
  //  - { type:'item', item:'dittany', targetId } | { type:'item', item:'attackBooster'|'defenseBooster' }
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    try {
      const b = getBattle(battleId);
      if (b.status !== 'active') return cb?.({ ok: false, error: 'NOT_ACTIVE' });
      if (!(b.phase === 'A_select' || b.phase === 'B_select'))
        return cb?.({ ok: false, error: 'NOT_SELECTION_PHASE' });

      const actor = b.players.find(x => x.id === playerId);
      if (!actor || actor.hp <= 0) return cb?.({ ok: false, error: 'DEAD' });

      if (actor.team !== b.currentTeam)
        return cb?.({ ok: false, error: 'NOT_YOUR_TEAM_TURN' });

      const store = b.pending[actor.team];
      const payload = action || { type: 'attack' };

      // 기본 유효성만 체크(세부 검증은 해석 단계)
      store.set(actor.id, payload);

      // 팀 전원 완료 시 페이즈 전환
      if (allActed(b, actor.team)) {
        advancePhase(b);
      } else {
        emitUpdate(b);
      }

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
// 건강 체크
app.get('/api/health', (_req, res) => {
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
