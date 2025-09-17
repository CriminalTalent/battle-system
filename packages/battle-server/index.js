/**
 * PYXIS Battle System - Server Entry (Express + Socket.IO)
 * - 기존 프론트(관리자/참가자/관전자)와 완전 호환
 * - 세밀 브로드캐스트 보강: 스냅샷/로그/타이머/턴·라운드 이벤트를
 *   다중 이벤트명으로 동시에 중계 (누락 방지)
 *
 * 규칙/로직/디자인은 변경하지 않았고, '방어/공격 보정기·디터니' 1턴 한정 효과,
 * 타이머/OTP/정리 유틸은 그대로 유지한다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Server as IOServer } from 'socket.io';

// 유틸/미들웨어 (별도 파일)
import { createAvatarUploadMiddleware, ensureDirs } from './middleware/avatar-upload.js';
import { OTPManager } from './lib/OTPManager.js';
import { TimerManager } from './lib/TimerManager.js';
import { BattleCleanup } from './lib/battleCleanup.js';

// ===== 경로/환경 =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR    = path.resolve(__dirname);
const PUBLIC_DIR  = path.join(ROOT_DIR, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const AVATAR_DIR  = path.join(UPLOADS_DIR, 'avatars');

ensureDirs([PUBLIC_DIR, UPLOADS_DIR, AVATAR_DIR]);

const HOST      = process.env.HOST || '0.0.0.0';
const PORT      = Number(process.env.PORT || 3001);
const NODE_ENV  = process.env.NODE_ENV || 'development';
const CORS_LIST = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ===== 앱/서버/소켓 =====
const app    = express();
const server = http.createServer(app);
const io     = new IOServer(server, {
  path: '/socket.io',
  cors: { origin: CORS_LIST.length ? CORS_LIST : '*', credentials: true }
});

// ===== 미들웨어 =====
app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CORS_LIST.length === 0 || CORS_LIST.includes('*')) return cb(null, true);
    return cb(null, CORS_LIST.includes(origin));
  },
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({
  windowMs: 30_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false
}));

// 정적
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true }));

// ===== 인메모리 상태 =====
/**
 * battles: Map<battleId, Battle>
 * Battle = {
 *   id, mode, status, createdAt,
 *   players: [ { id,name,team,hp,maxHp,stats,items,avatar,token } ],
 *   turn: { turnNumber, currentTeam, currentPlayerId, timeLeftSec },
 *   tempEffects: {
 *     defenseBooster: { [playerId]: { by, expiresTurn } },
 *     attackBooster : { [applierId]: { targetId, expiresTurn } }
 *   },
 *   spectator: { otp, url },
 *   timer: TimerManager
 * }
 */
const battles    = new Map();
const otpManager = new OTPManager();
const cleanup    = new BattleCleanup({ battles, ttlMin: 180 });

// ===== 공통 유틸 =====
const now = () => Date.now();
const uid = (p = '') => `${p}${Math.random().toString(36).slice(2, 10)}`;

function safeBaseUrl(req) {
  const fromHeader = req.get('x-base-url');
  if (fromHeader) return fromHeader;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http');
  const host  = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}
const roomOf = (battleId) => `battle:${battleId}`;

function initTempEffects(b) {
  if (!b.tempEffects) b.tempEffects = { defenseBooster: {}, attackBooster: {} };
}

// ====== 브로드캐스트 (다중 이벤트명으로 동시 송신) ======
const SNAPSHOT_EVENTS = ['battleUpdate','battle:update','battle:state','state','snapshot','game:update'];
const LOG_EVENTS_ALL  = ['battle:log','battleLog','log','game:log'];
const LOG_EVENTS_IMPORTANT = ['importantLog'];
const TICK_EVENTS     = ['timer:tick','battle:tick','countdown','tick'];
const TURN_START_EVENTS  = ['turn:start','round:start'];
const TURN_END_EVENTS    = ['turn:end','round:end'];

function emitToAll(eventNames, room, payload) {
  for (const ev of eventNames) io.to(room).emit(ev, payload);
}

function broadcastSnapshot(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return;
  const room = roomOf(battleId);

  const snap = {
    id: battle.id,
    status: battle.status,
    mode: battle.mode,
    players: battle.players.map(p => ({
      id: p.id, name: p.name, team: p.team,
      hp: p.hp, maxHp: p.maxHp, stats: p.stats, avatar: p.avatar
    })),
    currentTurn: {
      turnNumber: battle?.turn?.turnNumber || 1,
      currentTeam: battle?.turn?.currentTeam || 'A',
      currentPlayer: battle.players.find(p => p.id === battle?.turn?.currentPlayerId) || null,
      timeLeftSec: battle?.turn?.timeLeftSec || 0
    }
  };

  emitToAll(SNAPSHOT_EVENTS, room, snap);
}

function logToRoom(battleId, message, type = 'info') {
  const room = roomOf(battleId);
  const payload = { message, type, ts: Date.now() };
  emitToAll(LOG_EVENTS_ALL, room, payload);
  if (type === 'battle') {
    emitToAll(LOG_EVENTS_IMPORTANT, room, payload);
  }
}

function broadcastTick(battleId, secondsLeft, meta = {}) {
  const room = roomOf(battleId);
  const payload = { secondsLeft, sec: secondsLeft, timeLeftSec: secondsLeft, remain: secondsLeft, ...meta };
  emitToAll(TICK_EVENTS, room, payload);
}

function broadcastTurnStart(battle) {
  const room = roomOf(battle.id);
  const player = battle.players.find(p => p.id === battle.turn.currentPlayerId) || null;
  const payload = {
    turnNumber: battle.turn.turnNumber,
    team: battle.turn.currentTeam,
    player,
    ts: Date.now()
  };
  emitToAll(TURN_START_EVENTS, room, payload);
}

function broadcastTurnEnd(battle, actorId) {
  const room = roomOf(battle.id);
  const actor = battle.players.find(p => p.id === actorId) || null;
  const payload = {
    turnNumber: battle.turn.turnNumber,
    team: battle.turn.currentTeam,
    player: actor,
    ts: Date.now()
  };
  emitToAll(TURN_END_EVENTS, room, payload);
}

// ===== 턴/타이머 =====
function startTurnTimer(battle) {
  if (!battle.turn) battle.turn = { turnNumber: 1, currentTeam: 'A', timeLeftSec: 30 };
  if (battle.timer) battle.timer.stop();

  battle.timer = new TimerManager({
    totalSec: battle.turn.timeLeftSec || 30,
    onTick: (sec) => {
      battle.turn.timeLeftSec = sec;
      broadcastTick(battle.id, sec, { team: battle.turn.currentTeam });
    },
    onEnd: () => {
      logToRoom(battle.id, '턴 시간 종료 - 자동 패스', 'battle');
      // 시간이 끝나면 자동 패스
      resolveAction(battle.id, { type: 'pass', auto: true });
    }
  });

  battle.timer.start();
}

function beginBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return false;
  if (battle.status === 'active') return true;

  battle.status = 'active';

  // 첫 플레이어 (A팀 우선)
  const first = (battle.players.find(p => p.team === 'A' && p.hp > 0)
              || battle.players.find(p => p.hp > 0) || null);

  battle.turn = {
    turnNumber: 1,
    currentTeam: first?.team || 'A',
    currentPlayerId: first?.id || null,
    timeLeftSec: 30
  };

  initTempEffects(battle);

  logToRoom(battleId, '전투 진행 상태: active', 'battle');
  logToRoom(battleId, '1라운드 시작', 'battle');

  broadcastSnapshot(battleId);
  broadcastTurnStart(battle);
  startTurnTimer(battle);
  return true;
}

function pauseBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'active') return false;
  battle.status = 'paused';
  battle.timer?.pause();
  broadcastSnapshot(battleId);
  logToRoom(battleId, '전투 진행 상태: paused', 'battle');
  return true;
}

function resumeBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'paused') return false;
  battle.status = 'active';
  battle.timer?.resume();
  broadcastSnapshot(battleId);
  logToRoom(battleId, '전투 진행 상태: active', 'battle');
  return true;
}

function endBattle(battleId) {
  const battle = battles.get(battleId);
  if (!battle) return false;
  battle.status = 'ended';
  battle.timer?.stop();
  broadcastSnapshot(battleId);
  logToRoom(battleId, '전투 진행 상태: ended', 'battle');
  return true;
}

// ====== 아이템/행동 룰 ======
// - 공격 보정기: 적군 대상 1명 선택 → 이번 턴 그 타깃에게 가하는 "내 공격" 최종치에 확률 60%로 2배
// - 방어 보정기: 아군 대상 1명 선택 → 이번 턴 그 아군이 받는 피해 계산 시 확률 60%로 방어 2배 적용
// - 디터니: 아군 대상 1명(본인 포함) → 100% 성공, HP +10 고정 (maxHp 초과 불가)
// - 모두 "이번 턴"만 적용
function applyInstantItem(battle, player, action) {
  const me = player;
  const itemBag = me.items || {};
  const target = battle.players.find(p => p.id === action.targetId);
  if (!target) return { ok: false, msg: '대상이 존재하지 않습니다' };

  initTempEffects(battle);

  if (action.item === 'dittany') {
    const count = (itemBag.dittany ?? itemBag.ditany ?? 0);
    if (count <= 0) return { ok: false, msg: '디터니가 없습니다' };
    target.hp = Math.min(target.maxHp, (target.hp || 0) + 10);
    itemBag.dittany = count - 1; if (itemBag.dittany < 0) itemBag.dittany = 0;
    logToRoom(battle.id, `${me.name} → ${target.name}에게 디터니 사용(+10)`, 'battle');
    return { ok: true };
  }

  if (action.item === 'defenseBooster') {
    const count = (itemBag.defenseBooster ?? itemBag.defense_boost ?? 0);
    if (count <= 0) return { ok: false, msg: '방어 보정기가 없습니다' };
    if (target.team !== me.team) return { ok: false, msg: '방어 보정기는 아군에게만 사용' };
    itemBag.defenseBooster = count - 1; if (itemBag.defenseBooster < 0) itemBag.defenseBooster = 0;
    battle.tempEffects.defenseBooster[target.id] = { by: me.id, expiresTurn: battle.turn.turnNumber };
    logToRoom(battle.id, `${me.name} → ${target.name}에게 방어 보정기 시전(이번 턴)`, 'battle');
    return { ok: true };
  }

  if (action.item === 'attackBooster') {
    const count = (itemBag.attackBooster ?? itemBag.attack_boost ?? 0);
    if (count <= 0) return { ok: false, msg: '공격 보정기가 없습니다' };
    if (target.team === me.team) return { ok: false, msg: '공격 보정기는 적에게만 사용' };
    itemBag.attackBooster = count - 1; if (itemBag.attackBooster < 0) itemBag.attackBooster = 0;
    battle.tempEffects.attackBooster[me.id] = { targetId: target.id, expiresTurn: battle.turn.turnNumber };
    logToRoom(battle.id, `${me.name} → ${target.name}에게 공격 보정기 시전(이번 턴)`, 'battle');
    return { ok: true };
  }

  return { ok: false, msg: '알 수 없는 아이템' };
}

// 데미지 계산(보수적으로)
// - base = atk, def = target.defense
// - 방어보정 성공(60%): def *= 2
// - damage = max(1, base - def)
// - 공격보정 성공(60%): damage *= 2 (최종치)
function resolveDamage(battle, attacker, target) {
  const atk = Number(attacker?.stats?.attack || 1);
  let def   = Number(target?.stats?.defense || 1);

  // 방어 보정 (대상 기준)
  const dfx = battle.tempEffects?.defenseBooster?.[target.id];
  if (dfx && dfx.expiresTurn === battle.turn.turnNumber) {
    const ok = Math.random() < 0.6;
    if (ok) {
      def *= 2;
      logToRoom(battle.id, `방어 보정 발동! (${target.name}: 방어 2배)`, 'battle');
    } else {
      logToRoom(battle.id, `방어 보정 실패(60%)`, 'battle');
    }
  }

  let dmg = Math.max(1, atk - def);

  // 공격 보정 (공격자 기준·타깃 일치)
  const ab = battle.tempEffects?.attackBooster?.[attacker.id];
  if (ab && ab.expiresTurn === battle.turn.turnNumber && ab.targetId === target.id) {
    const ok = Math.random() < 0.6;
    if (ok) {
      dmg = Math.max(1, dmg * 2);
      logToRoom(battle.id, `공격 보정 발동! (${attacker.name} → ${target.name}: 최종 2배)`, 'battle');
    } else {
      logToRoom(battle.id, `공격 보정 실패(60%)`, 'battle');
    }
  }

  return dmg;
}

function clearTurnEffects(battle) {
  // 이번 턴 한정 효과만 유지되도록 정리
  initTempEffects(battle);
  const t = battle.turn.turnNumber;
  for (const k of Object.keys(battle.tempEffects.defenseBooster)) {
    if (battle.tempEffects.defenseBooster[k]?.expiresTurn !== t) {
      delete battle.tempEffects.defenseBooster[k];
    }
  }
  for (const k of Object.keys(battle.tempEffects.attackBooster)) {
    if (battle.tempEffects.attackBooster[k]?.expiresTurn !== t) {
      delete battle.tempEffects.attackBooster[k];
    }
  }
}

// 다음 플레이어 선택 (팀 교대 느낌 유지)
function pickNextPlayer(battle) {
  if (!battle.players.length) return null;
  const alive = battle.players.filter(p => p.hp > 0);

  const curIdx = alive.findIndex(p => p.id === battle.turn?.currentPlayerId);
  const nextIdx = (curIdx + 1) % alive.length;

  // 팀이 바뀌도록 시도
  const tryOrder = [alive[nextIdx], ...alive.slice(nextIdx + 1), ...alive.slice(0, nextIdx)];
  const next = tryOrder.find(p => p.team !== battle.turn?.currentTeam) || alive[nextIdx] || alive[0];

  return next || null;
}

function resolveAction(battleId, action) {
  const battle = battles.get(battleId);
  if (!battle || battle.status !== 'active') return { ok: false, error: '전투가 활성 상태가 아닙니다' };

  const actor = battle.players.find(p => p.id === battle.turn.currentPlayerId);
  if (!actor || actor.hp <= 0) return { ok: false, error: '행동 주체가 유효하지 않습니다' };

  // 현재 턴 종료 이벤트(행동 직전 기준 액터로 종료 알림)
  broadcastTurnEnd(battle, actor.id);

  if (action.type === 'defend') {
    logToRoom(battleId, `${actor.name} 방어 태세`, 'battle');
  }
  else if (action.type === 'dodge') {
    logToRoom(battleId, `${actor.name} 회피 시도`, 'battle');
  }
  else if (action.type === 'pass') {
    logToRoom(battleId, `${actor.name} 패스`, 'battle');
  }
  else if (action.type === 'item') {
    const res = applyInstantItem(battle, actor, action);
    if (!res.ok) return { ok: false, error: res.msg || '아이템 사용 실패' };
  }
  else if (action.type === 'attack') {
    const target = battle.players.find(p => p.id === action.targetId);
    if (!target || target.hp <= 0) return { ok: false, error: '공격 대상이 유효하지 않습니다' };

    const dmg = resolveDamage(battle, actor, target);
    target.hp = Math.max(0, (target.hp || 0) - dmg);
    logToRoom(battleId, `${actor.name} → ${target.name} 공격 (${dmg} 피해)`, 'battle');

    // 전투불능 체크
    if (target.hp <= 0) {
      logToRoom(battleId, `${target.name} 전투불능`, 'battle');
      const aliveA = battle.players.some(p => p.team === 'A' && p.hp > 0);
      const aliveB = battle.players.some(p => p.team === 'B' && p.hp > 0);
      if (!aliveA || !aliveB) {
        logToRoom(battleId, `게임 종료 - ${aliveA ? 'A' : 'B'}팀 승리`, 'battle');
        endBattle(battleId);
        broadcastSnapshot(battleId);
        return { ok: true };
      }
    }
  }
  else {
    return { ok: false, error: '알 수 없는 행동' };
  }

  // 턴 마무리: 이번 턴 효과 정리
  actor.lastActedAt = Date.now();
  clearTurnEffects(battle);

  // 다음 플레이어
  const next = pickNextPlayer(battle);
  battle.turn.turnNumber += 1;
  battle.turn.currentTeam = next?.team || (battle.turn.currentTeam === 'A' ? 'B' : 'A');
  battle.turn.currentPlayerId = next?.id || actor.id;
  battle.turn.timeLeftSec = 30;

  // 스냅 & 새 턴 시작 브로드캐스트
  startTurnTimer(battle);
  broadcastSnapshot(battleId);
  broadcastTurnStart(battle);

  return { ok: true };
}

// ===== REST API =====
app.get('/health', (req, res) => {
  res.json({ ok: true, env: NODE_ENV, time: Date.now() });
});

// 전투 생성
app.post('/api/battles', (req, res) => {
  const mode = (req.body?.mode || '2v2').trim();
  const id   = `battle_${Date.now()}_${uid('')}`;

  const battle = {
    id, mode,
    status: 'waiting',
    createdAt: now(),
    players: [],
    turn: { turnNumber: 0, currentTeam: 'A', currentPlayerId: null, timeLeftSec: 0 },
    tempEffects: { defenseBooster: {}, attackBooster: {} },
    spectator: { otp: '', url: '' },
    timer: null
  };
  battles.set(id, battle);

  logToRoom(id, '전투 대기 상태', 'battle');
  // 스냅샷도 넉넉히 송신
  broadcastSnapshot(id);

  res.json({ ok: true, id, battle });
});

// 플레이어 추가 (여러 엔드포인트 허용)
function addPlayerHandler(req, res) {
  const battleId = req.params.id;
  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false, error: '전투 없음' });

  const raw = req.body?.player || req.body || {};
  const player = {
    id: raw.id || uid('p_'),
    name: (raw.name || '플레이어').slice(0, 20),
    team: raw.team === 'B' ? 'B' : 'A',
    hp: Number(raw.hp || 100),
    maxHp: Number(raw.maxHp || raw.hp || 100),
    stats: {
      attack : Number(raw?.stats?.attack  ?? raw.attack  ?? 1),
      defense: Number(raw?.stats?.defense ?? raw.defense ?? 1),
      agility: Number(raw?.stats?.agility ?? raw.agility ?? 1),
      luck   : Number(raw?.stats?.luck    ?? raw.luck    ?? 1)
    },
    items: {
      dittany       : Number(raw?.items?.dittany        ?? raw.dittany        ?? raw.ditany        ?? 0),
      attackBooster : Number(raw?.items?.attackBooster  ?? raw.attackBooster  ?? raw.attack_boost  ?? 0),
      defenseBooster: Number(raw?.items?.defenseBooster ?? raw.defenseBooster ?? raw.defense_boost ?? 0)
    },
    avatar: raw.avatar || '',
    token : otpManager.issuePlayerToken(battleId)
  };

  battle.players.push(player);
  broadcastSnapshot(battleId);
  logToRoom(battleId, `${player.name}이(가) ${player.team}팀으로 참가했습니다`, 'battle');
  res.json({ ok: true, player });
}
app.post('/api/admin/battles/:id/players', addPlayerHandler);
app.post('/api/battles/:id/players',       addPlayerHandler);
app.post('/admin/battles/:id/players',     addPlayerHandler);
app.post('/battles/:id/players',           addPlayerHandler);
app.post('/api/admin/battles/:id/player',  addPlayerHandler);
app.post('/api/battles/:id/player',        addPlayerHandler);

// 플레이어 삭제
function deletePlayerHandler(req, res) {
  const battleId = req.params.id;
  const pid = req.params.pid;
  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false });
  const before = battle.players.length;
  battle.players = battle.players.filter(p => p.id !== pid);
  const ok = battle.players.length < before;
  if (ok) {
    broadcastSnapshot(battleId);
    logToRoom(battleId, `플레이어 제거: ${pid}`);
  }
  res.json({ ok });
}
app.delete('/api/admin/battles/:id/players/:pid', deletePlayerHandler);
app.delete('/api/battles/:id/players/:pid',       deletePlayerHandler);

// 링크/OTP 생성
app.post(['/api/admin/battles/:id/links', '/api/battles/:id/links'], (req, res) => {
  const battleId = req.params.id;
  const battle = battles.get(battleId);
  if (!battle) return res.status(404).json({ ok: false, error: '전투 없음' });

  const otp  = otpManager.issueSpectatorOTP(battleId);
  const base = safeBaseUrl(req);
  const spectatorUrl = `${base}/spectator.html?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(otp)}`;
  battle.spectator = { otp, url: spectatorUrl };

  const playerLinks = battle.players.map(p => {
    const token = p.token || otpManager.issuePlayerToken(battleId);
    const url = `${base}/player.html?battle=${encodeURIComponent(battleId)}&playerId=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(p.team)}&token=${encodeURIComponent(token)}`;
    return { playerId: p.id, playerName: p.name, team: p.team, otp: token, url };
  });

  res.json({ ok: true, spectator: { otp, url: spectatorUrl }, playerLinks });
});

// 아바타 업로드
const avatarUpload = createAvatarUploadMiddleware({ dest: AVATAR_DIR, publicPrefix: '/uploads/avatars' });
app.post('/api/upload/avatar', avatarUpload.single('avatar'), (req, res) => {
  if (!req.file || !req.file._publicUrl) return res.status(400).json({ ok: false, error: '업로드 실패' });
  res.json({ ok: true, url: req.file._publicUrl });
});

// ===== Socket.IO =====
io.on('connection', (socket) => {
  const sid = socket.id;
  console.log('새 연결', sid);

  socket.on('join', ({ battleId, role }) => {
    if (!battleId) return;
    socket.join(roomOf(battleId));
    socket.data = { ...(socket.data || {}), battleId, role: role || 'guest' };
    // 간단한 입장 로그도 여러 이벤트명으로
    emitToAll(LOG_EVENTS_ALL, roomOf(battleId), { message: '새 연결이 입장했습니다', ts: Date.now(), type: 'system' });
  });

  // 플레이어 인증(유연)
  socket.on('playerAuth', ({ battleId, token }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb?.({ ok: false, error: '전투 없음' });
    const player = battle.players[0] || null;
    if (!player) return cb?.({ ok: false, error: '플레이어 없음' });
    cb?.({ ok: true, player });
    socket.emit('authSuccess', { player });
  });

  // 컨트롤
  socket.on('startBattle', ({ battleId }, cb) => cb?.({ ok: beginBattle(battleId) }));
  socket.on('pauseBattle', ({ battleId }, cb) => cb?.({ ok: pauseBattle(battleId) }));
  socket.on('resumeBattle', ({ battleId }, cb) => cb?.({ ok: resumeBattle(battleId) }));
  socket.on('endBattle',   ({ battleId }, cb) => cb?.({ ok: endBattle(battleId) }));

  // 참가자 추가(여러 이벤트명 수용)
  [
    'admin:addPlayer',
    'battle:addPlayer',
    'player:add',
    'addPlayer',
    'battle:player:add',
    'player:addToBattle',
    'admin:player:add',
    'add:player'
  ].forEach(ev => {
    socket.on(ev, ({ battleId, player }, cb) => {
      const req = { params: { id: battleId }, body: { player } };
      const res = {
        status: (code) => ({ json: (d) => cb?.(d) }),
        json: (d) => cb?.(d)
      };
      addPlayerHandler(req, res);
    });
  });

  // 삭제
  socket.on('deletePlayer', ({ battleId, playerId }, cb) => {
    const req = { params: { id: battleId, pid: playerId } };
    const res = {
      status: (code) => ({ json: (d) => cb?.(d) }),
      json: (d) => cb?.(d)
    };
    deletePlayerHandler(req, res);
  });

  // 채팅/응원
  socket.on('chatMessage', (payload) => {
    const battleId = payload?.battleId || socket.data?.battleId;
    if (!battleId) return;
    const msg = {
      name: payload?.name || '익명',
      message: payload?.message || '',
      timestamp: Date.now()
    };
    emitToAll(['chatMessage','battle:chat'], roomOf(battleId), msg);
  });

  socket.on('spectator:cheer', (payload) => {
    const battleId = payload?.battleId || socket.data?.battleId;
    if (!battleId) return;
    const msg = {
      name: payload?.name || payload?.spectatorName || '익명',
      message: payload?.message || payload?.cheer || '',
      timestamp: Date.now()
    };
    emitToAll(['cheerMessage','spectator:cheer'], roomOf(battleId), msg);
  });

  // 플레이어 행동
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb?.({ ok: false, error: '전투 없음' });
    if (battle.turn?.currentPlayerId !== playerId) {
      return cb?.({ ok: false, error: '당신의 턴이 아닙니다' });
    }
    const result = resolveAction(battleId, action || {});
    if (result.ok) {
      // 성공 신호도 중계(호환 이벤트 포함)
      emitToAll(['actionSuccess','player:action:success'], roomOf(battleId), { ok: true });
    }
    cb?.(result);
  });

  socket.on('disconnect', () => { /* no-op */ });
  socket.on('error', (err) => { console.warn('socket error', err?.message || err); });
});

// ===== 서버 시작 =====
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] Server listening on http://${HOST}:${PORT} (${NODE_ENV})`);
});
