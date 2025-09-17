// packages/battle-server/index.js
// PYXIS Battle Server (ESM)
// - 단일 이벤트명으로 통일: addPlayer / deletePlayer / chatMessage / battleUpdate / battle:log
// - HTML 캐시 무효화(정적 서빙 시 no-store) → 브라우저 구버전 표시 방지
// - 링크 생성 시 /admin, /player, /spectator 별칭 지원(.html 없이도 접속 가능)
// - 아이템 효과는 "사용 턴"에만 적용, 기본 확률: 성공 90% (표시: 실패확률 10%)
// - 회피 미선택 시 자동 방어나 회피 적용하지 않음 (공격만 적용)

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: CORS_ORIGIN, methods: ['GET','POST'] },
  serveClient: true
});

// ──────────────────────────────────────────────────────────────
// 미들웨어
// ──────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// 정적 파일: HTML은 무조건 no-store, 나머지는 캐시 허용
const publicDir = path.join(__dirname, 'public');
app.use((req, res, next) => {
  res.setHeader('x-pyxis-server', 'battle');
  next();
});
app.use(express.static(publicDir, {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// 별칭 라우팅: /admin, /player, /spectator → 각 html
app.get(['/','/admin'], (req,res)=> res.sendFile(path.join(publicDir,'admin.html')));
app.get('/player', (req,res)=> res.sendFile(path.join(publicDir,'player.html')));
app.get('/spectator', (req,res)=> res.sendFile(path.join(publicDir,'spectator.html')));

// 업로드 준비
const uploadBase = path.join(publicDir, 'uploads', 'avatars');
fs.mkdirSync(uploadBase, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb)=> cb(null, uploadBase),
  filename: (_req, file, cb)=>{
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
  }
});
const upload = multer({ storage });

// 헬스체크
app.get('/api/health', (_req, res)=> res.json({ ok:true, time: new Date().toISOString() }));

// 아바타 업로드
app.post('/api/upload/avatar', upload.single('avatar'), (req, res)=>{
  if(!req.file){
    return res.status(400).json({ ok:false, error:'NO_FILE' });
  }
  // 정적 루트 기준 URL
  const rel = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok:true, url: rel });
});

// ──────────────────────────────────────────────────────────────
// 배틀 상태 (메모리)
// ──────────────────────────────────────────────────────────────
const battles = new Map(); // battleId -> Battle
const randId  = (p='p') => `${p}_${Math.random().toString(16).slice(2,10)}`;
const d10     = () => Math.floor(Math.random()*10)+1;

const DEF_TURN_SECONDS = 30;
const ITEM_SUCCESS_RATE = 0.9; // 90%

/**
 * Battle 구조:
 * {
 *   id, mode, status: 'waiting'|'active'|'paused'|'ended',
 *   players: [ { id, team:'A'|'B', name, avatar, hp, maxHp, stats{attack,defense,agility,luck}, items{...}, token, ready, stance } ],
 *   currentTurn: { turnNumber, currentTeam:'A'|'B'|null, currentPlayer: {id,name,avatar,team}|null, timeLeftSec },
 *   turnTimer: NodeJS.Timer|null,
 *   attackerIdx: number, // 현재 턴인 플레이어 index
 * }
 */

// 유틸
const cloneBattleForClient = (b) => ({
  id: b.id,
  mode: b.mode,
  status: b.status,
  players: b.players.map(p => ({
    id: p.id, team: p.team, name: p.name,
    avatar: p.avatar || '/uploads/avatars/default.svg',
    hp: p.hp, maxHp: p.maxHp,
    stats: p.stats,
    items: { ...p.items },
    ready: !!p.ready
  })),
  currentTurn: b.currentTurn ? {
    turnNumber: b.currentTurn.turnNumber,
    currentTeam: b.currentTurn.currentTeam,
    currentPlayer: b.currentTurn.currentPlayer ? {
      id: b.currentTurn.currentPlayer.id,
      name: b.currentTurn.currentPlayer.name,
      team: b.currentTurn.currentPlayer.team,
      avatar: b.currentTurn.currentPlayer.avatar || '/uploads/avatars/default.svg'
    } : null,
    timeLeftSec: b.currentTurn.timeLeftSec|0
  } : { turnNumber: 1, currentTeam: null, currentPlayer: null, timeLeftSec: 0 }
});

const emitBattle = (b) => {
  io.to(b.id).emit('battleUpdate', cloneBattleForClient(b));
};
const logBattle = (b, type, message) => {
  io.to(b.id).emit('battle:log', { type, message, ts: Date.now() });
  // 콘솔에도 가볍게
  if (type === 'error') {
    console.error(`[battle ${b.id}] ${message}`);
  } else {
    console.log(`[battle ${b.id}] ${message}`);
  }
};

// ──────────────────────────────────────────────────────────────
// 전투 API
// ──────────────────────────────────────────────────────────────
app.post('/api/battles', (req, res)=>{
  const mode = String(req.body?.mode || '2v2');
  const id = `battle_${Date.now()}_${Math.random().toString(16).slice(2,8)}`;
  const battle = {
    id, mode,
    status: 'waiting',
    players: [],
    currentTurn: { turnNumber: 1, currentTeam: null, currentPlayer: null, timeLeftSec: 0 },
    turnTimer: null,
    attackerIdx: 0
  };
  battles.set(id, battle);
  console.log('[battle] created', id);
  return res.json({ id, battle: cloneBattleForClient(battle) });
});

app.post('/api/battles/:id/player', (req, res)=>{
  const b = battles.get(req.params.id);
  if(!b) return res.status(404).json({ ok:false, error:'BATTLE_NOT_FOUND' });

  const raw = req.body?.player || {};
  const player = {
    id: raw.id || randId('p'),
    team: raw.team === 'B' ? 'B' : 'A',
    name: String(raw.name || '이름없음').slice(0,30),
    avatar: raw.avatar || '/uploads/avatars/default.svg',
    hp: Number.isFinite(raw.hp) ? Math.max(1, Math.min(999, Number(raw.hp))) : 100,
    maxHp: 100,
    stats: {
      attack:  Math.max(1, Math.min(5, Number(raw.stats?.attack  || 1))),
      defense: Math.max(1, Math.min(5, Number(raw.stats?.defense || 1))),
      agility: Math.max(1, Math.min(5, Number(raw.stats?.agility || 1))),
      luck:    Math.max(1, Math.min(5, Number(raw.stats?.luck    || 1))),
    },
    items: {
      dittany:        Math.max(0, Math.min(5, Number(raw.items?.dittany        || 0))),
      attackBooster:  Math.max(0, Math.min(5, Number(raw.items?.attackBooster  || 0))),
      defenseBooster: Math.max(0, Math.min(5, Number(raw.items?.defenseBooster || 0))),
    },
    token: (Math.random().toString().slice(2,10)),
    ready: false,
    stance: 'none'
  };

  // 중복(이름+팀) 방지
  const exists = b.players.find(p => p.name === player.name && p.team === player.team);
  if (exists) {
    return res.json({ ok:true, player: exists, battle: cloneBattleForClient(b) });
  }

  b.players.push(player);
  emitBattle(b);
  logBattle(b, 'notice', `${player.name}이(가) ${player.team}팀으로 참가했습니다`);
  return res.json({ ok:true, player, battle: cloneBattleForClient(b) });
});

app.post('/api/battles/:id/links', (req, res)=>{
  const b = battles.get(req.params.id);
  if(!b) return res.status(404).json({ ok:false, error:'BATTLE_NOT_FOUND' });

  const base = (req.get('x-base-url') || `${req.protocol}://${req.get('host')}`).replace(/\/+$/,'');
  const spectatorOtp = Math.random().toString(16).slice(2,10);
  b.spectatorOtp = spectatorOtp;

  const playerLinks = b.players.map(p => ({
    id: p.id,
    playerId: p.id,
    playerName: p.name,
    team: p.team,
    otp: p.token,
    token: p.token,
    url: `${base}/player?battle=${encodeURIComponent(b.id)}&playerId=${encodeURIComponent(p.id)}&token=${encodeURIComponent(p.token)}`
  }));

  return res.json({
    ok: true,
    spectator: {
      otp: spectatorOtp,
      url: `${base}/spectator?battle=${encodeURIComponent(b.id)}&otp=${encodeURIComponent(spectatorOtp)}`
    },
    playerLinks,
    players: b.players.map(p => ({ ...p, token: p.token })) // 디버깅 편의
  });
});

// ──────────────────────────────────────────────────────────────
/** 전투 규칙(요약)
 * - 선택지: 공격 / 방어 / 회피 / 패스 (아이템은 별도 버튼/타입)
 * - 회피 미선택 시 자동 방어나 회피가 적용되지 않음 → 공격만 계산
 * - 최종공격력 = 공격스탯 × (공격보정 사용 시 2, 아니면 1) + D10
 * - 치명타: d10 ≥ (10 − 행운/2) → 피해 2배
 * - 회피 판정: (피격자 민첩 + D10) ≥ (공격자 최종공격력) → 성공 시 피해 0, 실패 시 방어 차감 없이 정면 피해
 * - 방어값 = 방어스탯 × (방어보정 사용 시 2, 아니면 1) + D10
 *   → 최종피해 = max(0, (치명타면 공격력×2 else 공격력) − 방어값)
 * - 아이템 성공률 90% (실패확률 10% 표기). 효과는 "사용한 턴에만" 1회 적용.
 */
// ──────────────────────────────────────────────────────────────

// 내부 계산 유틸
function critHappens(luck) {
  const roll = d10();
  const threshold = Math.max(1, 10 - (luck/2));
  return roll >= threshold;
}
function rollAttack(baseAtk, useBooster) {
  const mult = useBooster ? 2 : 1;
  return baseAtk * mult + d10();
}
function rollDefense(baseDef, useBooster) {
  const mult = useBooster ? 2 : 1;
  return baseDef * mult + d10();
}
function tryItemOnce() {
  return Math.random() < ITEM_SUCCESS_RATE;
}

// 다음 플레이어로 포인터 이동
function nextTurnPointer(b) {
  if (!b.players.length) {
    b.currentTurn.currentPlayer = null;
    b.currentTurn.currentTeam = null;
    return;
  }
  // 생존자만
  const alive = b.players.filter(p => p.hp > 0);
  if (!alive.length) {
    b.currentTurn.currentPlayer = null;
    b.currentTurn.currentTeam = null;
    return;
  }
  // 현재 idx에서 다음 생존자
  let idx = b.attackerIdx;
  for (let i=0; i<b.players.length; i++) {
    idx = (idx + 1) % b.players.length;
    if (b.players[idx].hp > 0) {
      b.attackerIdx = idx;
      const p = b.players[idx];
      b.currentTurn.currentPlayer = { id: p.id, name: p.name, team: p.team, avatar: p.avatar };
      b.currentTurn.currentTeam = p.team;
      return;
    }
  }
  // 못 찾으면 null
  b.currentTurn.currentPlayer = null;
  b.currentTurn.currentTeam = null;
}

// 팀 전멸 체크
function checkEnd(b) {
  const aAlive = b.players.some(p => p.team==='A' && p.hp>0);
  const bAlive = b.players.some(p => p.team==='B' && p.hp>0);
  if (aAlive && bAlive) return false;
  b.status = 'ended';
  const winner = aAlive ? 'A' : (bAlive ? 'B' : '무승부');
  logBattle(b, 'battle', `게임 종료 - ${winner}팀 승리`);
  emitBattle(b);
  return true;
}

// 타이머
function clearTurnTimer(b) { if (b.turnTimer) { clearInterval(b.turnTimer); b.turnTimer = null; } }
function startTurnTimer(b, sec=DEF_TURN_SECONDS) {
  clearTurnTimer(b);
  b.currentTurn.timeLeftSec = sec|0;
  b.turnTimer = setInterval(()=>{
    b.currentTurn.timeLeftSec = Math.max(0, b.currentTurn.timeLeftSec-1);
    emitBattle(b);
    if (b.currentTurn.timeLeftSec === 0) {
      clearTurnTimer(b);
      // 시간초과 → 자동 패스
      const pid = b.currentTurn.currentPlayer?.id;
      if (pid) {
        resolveAction(b, pid, { type:'pass' });
      }
    }
  }, 1000);
}

// 액션 해석 및 적용
function resolveAction(b, playerId, action) {
  if (b.status !== 'active') return;
  const actor = b.players.find(p => p.id === playerId);
  if (!actor || actor.hp <= 0) return;

  const name = actor.name;
  const team = actor.team;

  // 아이템은 성공률 적용 & 해당 턴 1회만
  const items = actor.items || {};

  // 로그 프리픽스
  const teamLabel = team === 'A' ? 'A팀' : 'B팀';

  // 기본 메시지
  const actionLogs = [];

  const getTarget = (id) => b.players.find(p => p.id === id);

  const attackFlow = (targetId, opts={useAtkBoost:false})=>{
    const t = getTarget(targetId);
    if (!t || t.hp<=0) {
      actionLogs.push(`→ ${name}의 공격 대상 없음/사망`);
      return;
    }

    // 회피/방어는 "명시적으로 선택했을 때만" 적용
    const atkVal = rollAttack(actor.stats.attack, !!opts.useAtkBoost);
    const isCrit = critHappens(actor.stats.luck);
    const finalAtk = isCrit ? atkVal*2 : atkVal;

    // 상대가 'dodge', 'defend'를 선택했을 때만 해당 로직을 적용.
    const stance = t.stance || 'none';

    if (stance === 'dodge') {
      const dodgeRoll = t.stats.agility + d10();
      if (dodgeRoll >= finalAtk) {
        actionLogs.push(`→ ${name}의 공격을 ${t.name}이(가) 회피 성공! (피해 0)`);
        return;
      } else {
        // 정면 피해: 방어차감 없이
        t.hp = Math.max(0, t.hp - finalAtk);
        actionLogs.push(isCrit
          ? `→ ${name}의 치명타 공격! ${t.name} 정면 피격 (피해 ${finalAtk}) → HP ${t.hp}`
          : `→ ${name}의 공격! ${t.name} 정면 피격 (피해 ${finalAtk}) → HP ${t.hp}`);
        return;
      }
    }

    if (stance === 'defend') {
      const defVal = rollDefense(t.stats.defense, !!t._defBoostThisTurn);
      const dmg = Math.max(0, finalAtk - defVal);
      if (dmg <= 0) {
        actionLogs.push(`→ ${t.name} 방어 성공! 피해 없음`);
      } else {
        t.hp = Math.max(0, t.hp - dmg);
        actionLogs.push(isCrit
          ? `→ ${name}의 치명타 공격! ${t.name} 방어 후 피해 ${dmg} → HP ${t.hp}`
          : `→ ${name}의 공격! ${t.name} 방어 후 피해 ${dmg} → HP ${t.hp}`);
      }
      return;
    }

    // 방어/회피를 선택하지 않았다면 방어 차감 없이 "공격만" 적용
    t.hp = Math.max(0, t.hp - finalAtk);
    actionLogs.push(isCrit
      ? `→ ${name}의 치명타 공격! ${t.name}에게 피해 ${finalAtk} → HP ${t.hp}`
      : `→ ${name}의 공격! ${t.name}에게 피해 ${finalAtk} → HP ${t.hp}`);
  };

  // 액션 분기
  switch (action.type) {
    case 'attack': {
      const useAtkBoost = (items.attackBooster||0) > 0 && !!action.useBooster;
      if (useAtkBoost) {
        if (tryItemOnce()) {
          actor._atkBoostThisTurn = true;
          items.attackBooster = Math.max(0, items.attackBooster-1);
          actionLogs.push(`→ ${name}이(가) 공격 보정기 사용 성공`);
        } else {
          actionLogs.push(`→ ${name}이(가) 공격 보정기 사용 실패 (실패확률 10%)`);
        }
      }
      attackFlow(action.targetId, { useAtkBoost: !!actor._atkBoostThisTurn });
      break;
    }
    case 'defend': {
      actor.stance = 'defend';
      const useDefBoost = (items.defenseBooster||0) > 0 && !!action.useBooster;
      if (useDefBoost) {
        if (tryItemOnce()) {
          actor._defBoostThisTurn = true;
          items.defenseBooster = Math.max(0, items.defenseBooster-1);
          actionLogs.push(`→ ${name}이(가) 방어 보정기 사용 성공`);
        } else {
          actionLogs.push(`→ ${name}이(가) 방어 보정기 사용 실패 (실패확률 10%)`);
        }
      } else {
        actionLogs.push(`→ ${name}이(가) 방어 태세`);
      }
      break;
    }
    case 'dodge': {
      actor.stance = 'dodge';
      actionLogs.push(`→ ${name}이(가) 회피 태세`);
      break;
    }
    case 'item': {
      // itemKey: 'dittany'|'attackBooster'|'defenseBooster'
      const key = action.item;
      const t = action.targetId ? getTarget(action.targetId) : actor;
      if (!key) { actionLogs.push(`→ ${name} 아이템 선택 없음`); break; }

      if (key === 'dittany') {
        if ((items.dittany||0) <= 0) { actionLogs.push(`→ ${name} 디터니 없음`); break; }
        if (!t || t.hp<=0) { actionLogs.push(`→ ${name} 디터니 사용 실패 (사망자)`); break; }
        if (tryItemOnce()) {
          const heal = 20 + Math.floor(Math.random()*11); // 20~30
          t.hp = Math.min(t.maxHp, t.hp + heal);
          items.dittany = Math.max(0, items.dittany-1);
          actionLogs.push(`→ ${name}이(가) ${t.name} 치유 (+${heal}) → HP ${t.hp}`);
        } else {
          actionLogs.push(`→ ${name} 디터니 사용 실패 (실패확률 10%)`);
        }
      } else if (key === 'attackBooster') {
        if ((items.attackBooster||0) <= 0) { actionLogs.push(`→ ${name} 공격 보정기 없음`); break; }
        if (tryItemOnce()) {
          actor._atkBoostThisTurn = true;
          items.attackBooster = Math.max(0, items.attackBooster-1);
          actionLogs.push(`→ ${name}이(가) 공격 보정기 사용 성공`);
        } else {
          actionLogs.push(`→ ${name}이(가) 공격 보정기 사용 실패 (실패확률 10%)`);
        }
      } else if (key === 'defenseBooster') {
        if ((items.defenseBooster||0) <= 0) { actionLogs.push(`→ ${name} 방어 보정기 없음`); break; }
        if (tryItemOnce()) {
          actor._defBoostThisTurn = true;
          items.defenseBooster = Math.max(0, items.defenseBooster-1);
          actionLogs.push(`→ ${name}이(가) 방어 보정기 사용 성공`);
        } else {
          actionLogs.push(`→ ${name}이(가) 방어 보정기 사용 실패 (실패확률 10%)`);
        }
      }
      break;
    }
    case 'pass': {
      actionLogs.push(`→ ${name}이(가) 행동 패스`);
      break;
    }
    default: {
      actionLogs.push(`→ ${name} 알 수 없는 행동`);
    }
  }

  // 라운드/턴 마무리
  // 선택지가 공격일 때만 실제 피해가 발생하므로, 위 attackFlow에서 HP 변경됨.
  // 사망 처리 로그
  for (const p of b.players) {
    if (p.hp <= 0 && !p._deadAnnounced) {
      p._deadAnnounced = true;
      logBattle(b, 'battle', `${p.name} 사망`);
    }
  }

  // 상세 메시지 출력
  for (const m of actionLogs) logBattle(b, 'battle', m);

  // 턴 이동 준비: 사용한 턴 효과 플래그 제거
  for (const p of b.players) {
    delete p._atkBoostThisTurn;
    delete p._defBoostThisTurn;
    p.stance = 'none';
  }

  if (checkEnd(b)) return;

  // 다음 플레이어
  b.currentTurn.turnNumber += 1;
  nextTurnPointer(b);
  logBattle(b, 'battle', `${b.currentTurn.turnNumber}라운드 시작 - ${b.currentTurn.currentTeam}팀 (${b.currentTurn.currentPlayer?.name||'-'})`);
  startTurnTimer(b, DEF_TURN_SECONDS);
  emitBattle(b);
}

// ──────────────────────────────────────────────────────────────
// 소켓
// ──────────────────────────────────────────────────────────────
io.on('connection', (socket)=>{
  // 단일 이벤트만 사용 (중복 이벤트명 제거)
  socket.onAny((eventName)=> {
    // 디버깅 시 필요하면 풀기: console.debug('[socket:on]', eventName);
  });

  socket.on('join', ({ battleId })=>{
    if(!battleId) return;
    socket.join(battleId);
    const b = battles.get(battleId);
    if (b
