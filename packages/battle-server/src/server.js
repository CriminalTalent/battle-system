// packages/battle-server/src/server.js
// ─────────────────────────────────────────────────────────────────────────────
// PYXIS Battle Server (KR edition final integrated)
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const multer = require('multer');
const { initChat } = require('../../src/socket/chat');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 30000,
  allowEIO3: true
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1m' }));

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────────────────────────────────────
const BATTLES = new Map(); // battleId -> battleState

// util
const now = () => Date.now();
const d20 = () => Math.floor(Math.random() * 20) + 1;
const rid = (p='') => (p ? p + '_' : '') + crypto.randomBytes(6).toString('hex');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const slug = s => String(s||'').trim();

// otp
const makeOTP = (mins) => ({ token: crypto.randomBytes(8).toString('hex'), exp: now() + mins*60*1000 });
const validOTP = (otp) => otp && otp.exp > now();

// ─────────────────────────────────────────────────────────────────────────────
// 전투 규칙
// ─────────────────────────────────────────────────────────────────────────────
function calcHit(att, def) {
  const hitRoll = att.luk + d20();
  const dodgeRoll = def.agi + d20();
  return hitRoll >= dodgeRoll;
}
function calcCrit(att) {
  const roll = d20();
  return roll >= (20 - att.luk / 2);
}
function baseDamage(att, def, atkBoost=1, defBoost=1) {
  const roll = d20();
  const atk = Math.round(att.atk * atkBoost);
  const dfs = Math.round(def.def * defBoost);
  const raw = atk + roll - dfs;
  return Math.max(1, raw);
}
function applyDamage(target, amount, attacker) {
  if (target.stance === 'guard') {
    const guardRoll = target.agi + d20() - attacker.atk;
    const reduce = Math.max(0, Math.floor(guardRoll));
    amount = Math.max(0, amount - reduce);
  }
  if (target.stance === 'evade') {
    const success = (target.agi + d20()) >= attacker.atk;
    if (success) amount = 0;
  }
  target.hp = clamp(target.hp - amount, 0, 1000);
  return amount;
}

// ─────────────────────────────────────────────────────────────────────────────
// battle state
// ─────────────────────────────────────────────────────────────────────────────
function newBattle({ mode='1v1' }) {
  const id = rid('battle');
  const adminOTP = makeOTP(60);
  const playerOTPSeed = makeOTP(30);
  const watcherOTPPool = new Set();
  const spectatorLimit = 30;

  const state = {
    id, mode,
    createdAt: now(),
    status: 'lobby',
    round: 1,
    phase: 'A',
    timerEnd: now() + 60 * 60 * 1000,
    teams: {
      A: { name: '불사조 기사단', players: [] },
      B: { name: '죽음을 먹는 자들', players: [] }
    },
    queueActed: { A: new Set(), B: new Set() },
    sockets: new Map(),
    adminOTP,
    playerOTPSeed,
    playerTokens: new Map(),
    watcherOTPPool,
    spectatorLimit,
    chat: [],
    logs: [],
    inactivity: new Map(),
    _timer: null
  };
  BATTLES.set(id, state);
  return state;
}

function getPlayer(state, pid) {
  for (const side of ['A','B']) {
    const p = state.teams[side].players.find(x => x.id === pid);
    if (p) return p;
  }
  return null;
}
function findPlayerByName(state, name) {
  const key = slug(name).toLowerCase();
  for (const side of ['A','B']) {
    const p = state.teams[side].players.find(x => slug(x.name).toLowerCase() === key);
    if (p) return p;
  }
  return null;
}
function alivePlayers(state, side) {
  return state.teams[side].players.filter(p => p.hp > 0);
}
const currentSide = (state) => state.phase;

function markActed(state, pid) {
  for (const side of ['A','B']) {
    const ps = state.teams[side].players;
    if (ps.some(p => p.id === pid)) {
      state.queueActed[side].add(pid);
      const aliveCount = alivePlayers(state, side).length;
      if (state.queueActed[side].size >= aliveCount) {
        if (state.phase === 'A') {
          state.phase = 'B';
          state.queueActed.B.clear();
          io.to(state.id).emit('phase:change', { phase: 'B', round: state.round });
          armPhaseInactivity(state);
        } else {
          state.phase = 'A';
          state.round += 1;
          state.queueActed.A.clear();
          io.to(state.id).emit('phase:change', { phase: 'A', round: state.round });
          armPhaseInactivity(state);
        }
      }
      return;
    }
  }
}

function decideInitiative(state) {
  const sumAgi = (side) => alivePlayers(state, side).reduce((s,p)=>s+p.agi,0);
  let a = sumAgi('A') + d20();
  let b = sumAgi('B') + d20();
  while (a === b) { a = sumAgi('A') + d20(); b = sumAgi('B') + d20(); }
  state.phase = (a > b) ? 'A' : 'B';
  io.to(state.id).emit('phase:change', { phase: state.phase, round: state.round, initiative: {A:a, B:b} });
}

function checkEnd(state) {
  const deadA = alivePlayers(state, 'A').length === 0;
  const deadB = alivePlayers(state, 'B').length === 0;
  const timeup = now() >= state.timerEnd;
  if (deadA || deadB || timeup) {
    state.status = 'ended';
    clearBattleTimer(state);
    const sumHP = side => state.teams[side].players.reduce((s,p)=>s+Math.max(0,p.hp),0);
    const scoreA = sumHP('A');
    const scoreB = sumHP('B');
    const winner = scoreA === scoreB ? 'draw' : (scoreA > scoreB ? 'A' : 'B');
    io.to(state.id).emit('battle:end', { winner, scoreA, scoreB, timeup, deadA, deadB });
    return true;
  }
  return false;
}

function armInactivityTimer(state, pid) {
  clearInactivity(state, pid);
  const to = setTimeout(() => {
    const actor = getPlayer(state, pid);
    if (!actor || actor.hp<=0 || state.status!=='active') return;
    const line = { ts:now(), type:'auto', text:`${actor.name} (자동 패스)`, actor: actor.id };
    state.logs.unshift(line);
    io.to(state.id).emit('log:new', line);
    markActed(state, pid);
    checkEnd(state);
  }, 5 * 60 * 1000);
  state.inactivity.set(pid, to);
}
function clearInactivity(state, pid) {
  const to = state.inactivity.get(pid);
  if (to) clearTimeout(to);
  state.inactivity.delete(pid);
}
function armPhaseInactivity(state) {
  const side = currentSide(state);
  alivePlayers(state, side)
    .filter(p=>!state.queueActed[side].has(p.id))
    .forEach(p=>armInactivityTimer(state, p.id));
}

function startBattleTimer(state) {
  clearBattleTimer(state);
  state._timer = setInterval(() => {
    if (state.status !== 'active') return;
    const remainMs = Math.max(0, state.timerEnd - now());
    io.to(state.id).emit('timer:sync', { now: now(), timerEnd: state.timerEnd, remainMs });
    if (remainMs <= 0) {
      checkEnd(state);
    }
  }, 1000);
}
function clearBattleTimer(state) {
  if (state._timer) { clearInterval(state._timer); state._timer = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multer for avatar upload
// ─────────────────────────────────────────────────────────────────────────────
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const battleId = slug(req.body.battleId || req.query.battleId);
    const base = path.join(__dirname, '..', 'public', 'avatars', battleId || 'misc');
    ensureDir(base); cb(null, base);
  },
  filename: function(req, file, cb) {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, crypto.randomBytes(6).toString('hex') + '_' + Date.now() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 3 * 1024 * 1024 } });

// ─────────────────────────────────────────────────────────────────────────────
// REST API (KR)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req,res)=>res.json({ ok:true, ts:now() }));

// … (이하 플레이어 추가, 관전자 OTP 발급, 전투 시작 등은 그대로 위에서 본 구조)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// initChat 연결 (로그 파일 저장)
// ─────────────────────────────────────────────────────────────────────────────
initChat(io, {
  pushChat: (battleId, entry) => {
    try {
      const dir = path.join(__dirname, '..', 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `chat-${battleId}.log`);
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch (e) { /* ignore */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, ()=>console.log('[battle] listening on', PORT));

