// packages/battle-server/index.js
// PYXIS Battle Server (ESM) - drop-in replacement
// - ESM only: no require()
// - In-memory battle state
// - Endpoints used by admin/player/spectator UIs
// - Socket events with dual names for compatibility

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';

// ===== Runtime & Paths =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..'); // /root/battle-system
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(path.join(PUBLIC_DIR, 'uploads', 'avatars'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'uploads'), { recursive: true });

// ===== Env =====
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const corsOrigins = (() => {
  const raw = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
  if (raw.includes('*')) return '*';
  return raw;
})();

// ===== App & IO =====
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.static(PUBLIC_DIR));

// ===== Upload (ESM + multer) =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PUBLIC_DIR, 'uploads', 'avatars');
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = (file.originalname || 'avatar.png').replace(/[^\w.-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

// ===== Utils =====
const uid = (len = 8) => crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
const d10 = () => (Math.floor(Math.random() * 10) + 1);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const now = () => new Date();

// ===== Battle Store (in-memory) =====
/**
 * battle: {
 *   id, mode, status: 'waiting'|'active'|'ended',
 *   createdAt,
 *   players: [ { id, team:'A'|'B', name, avatar, hp, maxHp, stats:{attack,defense,agility,luck}, items:{dittany,attackBooster,defenseBooster}, token } ]
 *   spectator: { otp },
 *   currentTurn: { turnNumber, currentTeam, currentPlayer, timeLeftSec },
 *   timers: { turnInterval?: NodeJS.Timer, lastTickAt?: number },
 * }
 */
const battles = new Map();

// ===== Combat / Rules (요청된 규칙 반영) =====
// - 기본 행동: 공격, 방어(스탠스), 회피(스탠스), 패스, 아이템(디터니/공격보정/방어보정)
// - 회피/방어를 선택하지 않으면 자동 적용 없음
// - 아이템 성공 확률 90% (실패 확률 10% 표기)
// - 공격 계수: 최종공격력 = 공격스탯 × (공격보정기면 2, 아니면 1) + d10
// - 치명타: d10 ≥ (10 − luck/2) → 피해 *2
// - 회피 판정: (대상 민첩 + d10) ≥ 공격자의 최종공격력 → 피해 0, 실패시 방어차감 없이 정면 피해
// - 방어 판정: 방어값 = 방어스탯 × (보정기면 2) + d10; 최종피해 = max(0, (치명 포함 공격) − 방어값)
// - 아무 행동 없이 시간 초과 시: 기본 '공격' (랜덤 적 대상)
// - 팀 전원 사망 시 즉시 종료

function basePlayer(p) {
  const stats = p.stats || {};
  return {
    id: p.id || `p_${uid(10)}`,
    team: p.team || 'A',
    name: p.name || '이름없음',
    avatar: p.avatar || '/uploads/avatars/default.svg',
    hp: Number(p.hp ?? 100),
    maxHp: Number(p.maxHp ?? p.hp ?? 100),
    stats: {
      attack: Number(stats.attack ?? 1),
      defense: Number(stats.defense ?? 1),
      agility: Number(stats.agility ?? 1),
      luck: Number(stats.luck ?? 1)
    },
    items: {
      dittany: Number(p.items?.dittany ?? 0),
      attackBooster: Number(p.items?.attackBooster ?? 0),
      defenseBooster: Number(p.items?.defenseBooster ?? 0)
    },
    stance: 'none', // 'none'|'defend'|'dodge'
    token: p.token || uid(16)
  };
}

function livingPlayers(b, team) {
  return b.players.filter(p => p.team === team && p.hp > 0);
}

function anyTeamDead(b) {
  const aAlive = livingPlayers(b, 'A').length > 0;
  const bAlive = livingPlayers(b, 'B').length > 0;
  if (!aAlive) return 'A';
  if (!bAlive) return 'B';
  return null;
}

function chooseNextPlayer(b, team) {
  const alive = livingPlayers(b, team);
  if (alive.length === 0) return null;
  // round-robin by id order for simplicity
  const prevId = b.currentTurn?.currentPlayer?.id;
  const idx = Math.max(0, alive.findIndex(p => p.id === prevId));
  const next = alive[(idx + 1) % alive.length];
  return next;
}

function calcCritical(luckStat) {
  const roll = d10();
  const threshold = 10 - Math.floor(luckStat / 2);
  return { crit: roll >= threshold, roll, threshold };
}

function performAttack({ attacker, defender, useAttackBooster = false }) {
  const atkStat = Number(attacker.stats.attack || 1);
  const luck = Number(attacker.stats.luck || 1);
  const atkRoll = d10();
  const atkMult = useAttackBooster ? 2 : 1;
  const finalAtk = atkStat * atkMult + atkRoll;

  const { crit, roll: critRoll, threshold } = calcCritical(luck);
  let baseDmg = finalAtk;
  if (crit) baseDmg = finalAtk * 2;

  let resultText = [];

  // Defender stance
  if (defender.stance === 'dodge') {
    const check = Number(defender.stats.agility || 1) + d10();
    if (check >= finalAtk) {
      // 완전 회피
      resultText.push(`${attacker.name}의 공격을 ${defender.name}이(가) 완전 회피! (민첩+d10=${check} ≥ 공격 ${finalAtk})`);
      defender.stance = 'none';
      return { damage: 0, crit, details: resultText.join(' | '), finalAtk, critRoll, threshold };
    } else {
      resultText.push(`${defender.name} 회피 실패 (민첩+d10=${check} < 공격 ${finalAtk}) → 정면 피해`);
      defender.stance = 'none';
      // 방어 차감 없이 정면 피해 (baseDmg)
      return { damage: baseDmg, crit, details: resultText.join(' | '), finalAtk, critRoll, threshold };
    }
  } else if (defender.stance === 'defend') {
    const defMult = defender._defenseBoostThisTurn ? 2 : 1;
    const defenseVal = Number(defender.stats.defense || 1) * defMult + d10();
    const dmg = Math.max(0, baseDmg - defenseVal);
    resultText.push(
      `${defender.name} 방어: 방어값=${defenseVal} | 공격=${baseDmg} → 피해 ${dmg}`
    );
    defender.stance = 'none';
    defender._defenseBoostThisTurn = false;
    return { damage: dmg, crit, details: resultText.join(' | '), finalAtk, critRoll, threshold };
  }

  // No stance: 정면 피해 (방어 차감 없음)
  return { damage: baseDmg, crit, details: resultText.join(' | '), finalAtk, critRoll, threshold };
}

function healTarget(target, amount) {
  const prev = target.hp;
  target.hp = clamp(target.hp + amount, 0, target.maxHp);
  return { healed: target.hp - prev, to: target.hp };
}

// ===== Logs & Emits =====
function pushLog(io, battle, type, message) {
  const log = { type, message, ts: Date.now() };
  io.to(battle.id).emit('battle:log', log);
  // 구버전 호환 이벤트명(있으면)
  io.to(battle.id).emit('battleLog', log);
}

function emitUpdate(io, battle) {
  const payload = sanitizeBattle(battle);
  io.to(battle.id).emit('battleUpdate', payload);
  io.to(battle.id).emit('battle:update', payload);
}

function sanitizeBattle(b) {
  // 민감정보 제거(token 등)
  const players = b.players.map(p => ({
    id: p.id, team: p.team, name: p.name, avatar: p.avatar,
    hp: p.hp, maxHp: p.maxHp, stats: p.stats, items: p.items
  }));
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    players,
    currentTurn: {
      turnNumber: b.currentTurn?.turnNumber || 1,
      currentTeam: b.currentTurn?.currentTeam || null,
      currentPlayer: b.currentTurn?.currentPlayer
        ? {
            id: b.currentTurn.currentPlayer.id,
            name: b.currentTurn.currentPlayer.name,
            team: b.currentTurn.currentPlayer.team,
            avatar: b.currentTurn.currentPlayer.avatar
          }
        : null,
      timeLeftSec: b.currentTurn?.timeLeftSec ?? 0
    }
  };
}

// ===== Turn Engine =====
const TURN_SECONDS = 30;

function startBattle(io, battle) {
  if (battle.status === 'active') return;
  battle.status = 'active';
  battle.currentTurn = battle.currentTurn || { turnNumber: 1, currentTeam: 'A', currentPlayer: null, timeLeftSec: TURN_SECONDS };

  // 선공 결정: d10 + 팀 평균 민첩 (요청은 명확치 않지만 민첩 반영 느낌 유지)
  const aAg = avg(livingPlayers(battle, 'A').map(p => p.stats.agility || 1));
  const bAg = avg(livingPlayers(battle, 'B').map(p => p.stats.agility || 1));
  const aRoll = d10(), bRoll = d10();
  const aScore = aAg + aRoll, bScore = bAg + bRoll;

  pushLog(io, battle, 'battle', `선공 결정: A팀(${aAg}+${aRoll}=${aScore}) vs B팀(${bAg}+${bRoll}=${bScore})`);
  battle.currentTurn.currentTeam = (bScore > aScore) ? 'B' : 'A';
  pushLog(io, battle, 'battle', `${battle.currentTurn.currentTeam}팀이 선공입니다!`);
  pushLog(io, battle, 'battle', '전투가 시작되었습니다!');

  const cp = chooseNextPlayer(battle, battle.currentTurn.currentTeam);
  battle.currentTurn.currentPlayer = cp;
  battle.currentTurn.timeLeftSec = TURN_SECONDS;
  startTurnTimer(io, battle);
  emitUpdate(io, battle);
}

function endBattle(io, battle, winnerTeam = null) {
  if (battle.status === 'ended') return;
  battle.status = 'ended';
  stopTurnTimer(battle);
  const msg = winnerTeam ? `${winnerTeam}팀 승리!` : '전투 종료';
  pushLog(io, battle, 'battle', msg);
  emitUpdate(io, battle);
}

function startTurnTimer(io, battle) {
  stopTurnTimer(battle);
  battle.timers = battle.timers || {};
  battle.timers.lastTickAt = Date.now();
  battle.timers.turnInterval = setInterval(() => {
    if (battle.status !== 'active') return stopTurnTimer(battle);
    if (!battle.currentTurn) return;

    const elapsed = Math.floor((Date.now() - (battle.timers.lastTickAt || Date.now())) / 1000);
    if (elapsed > 0) {
      battle.timers.lastTickAt = Date.now();
      battle.currentTurn.timeLeftSec = Math.max(0, (battle.currentTurn.timeLeftSec ?? TURN_SECONDS) - elapsed);
      emitUpdate(io, battle);
      if (battle.currentTurn.timeLeftSec <= 0) {
        // 시간초과: 기본 공격
        autoAttackOnTimeout(io, battle);
        nextTurn(io, battle);
      }
    }
  }, 1000);
}

function stopTurnTimer(battle) {
  if (battle.timers?.turnInterval) clearInterval(battle.timers.turnInterval);
  if (battle.timers) battle.timers.turnInterval = null;
}

function nextTurn(io, battle) {
  if (battle.status !== 'active') return;

  // 팀 전원 사망 체크
  const deadTeam = anyTeamDead(battle);
  if (deadTeam) {
    const winner = deadTeam === 'A' ? 'B' : 'A';
    endBattle(io, battle, winner);
    return;
  }

  // 팀 교대
  const nextTeam = battle.currentTurn.currentTeam === 'A' ? 'B' : 'A';
  battle.currentTurn.currentTeam = nextTeam;
  battle.currentTurn.currentPlayer = chooseNextPlayer(battle, nextTeam);
  battle.currentTurn.turnNumber = (battle.currentTurn.turnNumber || 1) + 1;
  battle.currentTurn.timeLeftSec = TURN_SECONDS;

  emitUpdate(io, battle);
}

function autoAttackOnTimeout(io, battle) {
  const attacker = battle.currentTurn?.currentPlayer;
  if (!attacker) return;
  if (attacker.hp <= 0) return;

  const enemies = livingPlayers(battle, attacker.team === 'A' ? 'B' : 'A');
  if (enemies.length === 0) return;
  const target = pick(enemies);

  resolveAction(io, battle, {
    playerId: attacker.id,
    type: 'attack',
    targetId: target.id
  }, true);
}

function resolveAction(io, battle, action, isAuto = false) {
  const actor = battle.players.find(p => p.id === action.playerId);
  if (!actor || actor.hp <= 0) return;

  const side = actor.team;
  const opp = (side === 'A') ? 'B' : 'A';

  const labelTeam = `${side}팀`;
  const targetById = (id) => battle.players.find(p => p.id === id);

  // Action routing
  switch (action.type) {
    case 'attack': {
      const target = action.targetId ? targetById(action.targetId) : pick(livingPlayers(battle, opp));
      if (!target || target.hp <= 0) break;

      const usedBoost = !!action.useAttackBooster;
      const { damage, crit, details, finalAtk, critRoll, threshold } =
        performAttack({ attacker: actor, defender: target, useAttackBooster: usedBoost });

      target.hp = clamp(target.hp - damage, 0, target.maxHp);

      if (crit && target.hp <= 0) {
        pushLog(io, battle, 'battle',
          `${actor.name}의 ${usedBoost ? '강화된 ' : ''}치명타 공격으로 ${target.name} 사망! (피해 ${damage})`);
      } else if (damage > 0) {
        pushLog(io, battle, 'battle',
          `${actor.name}이(가) ${target.name}에게 ${usedBoost ? '강화된 ' : ''}공격 (피해 ${damage}) → HP ${target.hp} ${details ? `| ${details}` : ''}`);
      } else {
        pushLog(io, battle, 'battle',
          `${actor.name}의 ${usedBoost ? '강화된 ' : ''}공격이 ${target.name}에게 빗나감${details ? ` | ${details}` : ''}`);
      }

      // 사망 팀 판정
      const deadTeam = anyTeamDead(battle);
      if (deadTeam) {
        const winner = deadTeam === 'A' ? 'B' : 'A';
        endBattle(io, battle, winner);
        return;
      }

      break;
    }

    case 'defend': {
      actor.stance = 'defend';
      actor._defenseBoostThisTurn = false; // 아이템으로 올릴 때만 true
      pushLog(io, battle, 'battle', `${actor.name}이(가) 방어 태세`);
      break;
    }

    case 'dodge': {
      actor.stance = 'dodge';
      pushLog(io, battle, 'battle', `${actor.name}이(가) 회피 태세`);
      break;
    }

    case 'pass': {
      pushLog(io, battle, 'battle', `${actor.name}이(가) 행동 패스`);
      break;
    }

    case 'item': {
      const item = action.item;
      if (item === 'dittany') {
        const target = action.targetId ? targetById(action.targetId) : actor;
        if (!target || target.hp <= 0) {
          pushLog(io, battle, 'battle', `${actor.name}의 디터니 사용 실패 (사망자)`);
          break;
        }
        if ((actor.items.dittany || 0) <= 0) {
          pushLog(io, battle, 'battle', `${actor.name} 디터니 없음`);
          break;
        }
        const ok = Math.random() < 0.9;
        if (!ok) {
          actor.items.dittany -= 1; // 사용은 소모
          pushLog(io, battle, 'battle', `${actor.name}의 ${target.name}에게 디터니 사용 실패 (실패확률 10%)`);
          break;
        }
        actor.items.dittany -= 1;
        const amount = 15 + d10(); // 기본 힐 값 (임의)
        const { healed, to } = healTarget(target, amount);
        pushLog(io, battle, 'battle', `${actor.name}이(가) ${target.name} 치유 (+${healed}) → HP ${to}`);
        break;
      }

      if (item === 'attackBooster') {
        if ((actor.items.attackBooster || 0) <= 0) {
          pushLog(io, battle, 'battle', `${actor.name} 공격 보정기 없음`);
          break;
        }
        const target = action.targetId ? targetById(action.targetId) : pick(livingPlayers(battle, opp));
        if (!target || target.hp <= 0) break;

        const ok = Math.random() < 0.9;
        actor.items.attackBooster -= 1;
        if (!ok) {
          pushLog(io, battle, 'battle', `${actor.name} 공격 보정기 사용 실패 (실패확률 10%)`);
          break;
        }
        // 성공 시, 즉시 강화 공격
        const { damage, crit, details } =
          performAttack({ attacker: actor, defender: target, useAttackBooster: true });
        target.hp = clamp(target.hp - damage, 0, target.maxHp);

        if (crit && target.hp <= 0) {
          pushLog(io, battle, 'battle',
            `${actor.name}의 강화된 치명타 공격으로 ${target.name} 사망! (피해 ${damage})`);
        } else if (damage > 0) {
          pushLog(io, battle, 'battle',
            `${actor.name}이(가) ${target.name}에게 강화된 공격 (피해 ${damage}) → HP ${target.hp}${details ? ` | ${details}` : ''}`);
        } else {
          pushLog(io, battle, 'battle',
            `${actor.name}의 강화된 공격이 ${target.name}에게 빗나감${details ? ` | ${details}` : ''}`);
        }

        const deadTeam = anyTeamDead(battle);
        if (deadTeam) {
          const winner = deadTeam === 'A' ? 'B' : 'A';
          endBattle(io, battle, winner);
          return;
        }
        break;
      }

      if (item === 'defenseBooster') {
        if ((actor.items.defenseBooster || 0) <= 0) {
          pushLog(io, battle, 'battle', `${actor.name} 방어 보정기 없음`);
          break;
        }
        const ok = Math.random() < 0.9;
        actor.items.defenseBooster -= 1;
        if (!ok) {
          pushLog(io, battle, 'battle', `${actor.name} 방어 보정기 사용 실패 (실패확률 10%)`);
          break;
        }
        actor.stance = 'defend';
        actor._defenseBoostThisTurn = true;
        pushLog(io, battle, 'battle', `${actor.name}이(가) 방어 보정기 사용 → 방어 태세(강화)`);
        break;
      }

      break;
    }

    default:
      break;
  }

  emitUpdate(io, battle);
  if (!isAuto) {
    // 수동 액션 후 턴 종료
    nextTurn(io, battle);
  }
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}

// ===== REST APIs =====

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Create battle
app.post('/api/battles', (req, res) => {
  const mode = (req.body?.mode || '2v2');
  const id = `battle_${Date.now()}_${uid(6)}`;
  const battle = {
    id, mode, status: 'waiting', createdAt: now().toISOString(),
    players: [],
    spectator: { otp: uid(8) },
    currentTurn: { turnNumber: 1, currentTeam: null, currentPlayer: null, timeLeftSec: 0 },
    timers: {}
  };
  battles.set(id, battle);
  console.log(`[battle] created ${id}`);
  res.json({ ok: true, id, battle: sanitizeBattle(battle) });
});

// Upload avatar
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
  const rel = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok: true, url: rel });
});

// Generate spectator & player links
app.post(['/api/admin/battles/:id/links', '/api/battles/:id/links'], (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  // Spectator
  if (!b.spectator?.otp) b.spectator = { otp: uid(8) };

  const base = req.headers['x-base-url'] || `${req.protocol}://${req.get('host')}`;
  const spectatorUrl = `${base}/spectator.html?battle=${encodeURIComponent(b.id)}&otp=${encodeURIComponent(b.spectator.otp)}`;

  // Ensure tokens for players
  b.players.forEach(p => { if (!p.token) p.token = uid(16); });

  const playerLinks = b.players.map(p => ({
    id: p.id,
    playerId: p.id,
    playerName: p.name,
    team: p.team,
    otp: p.token,
    token: p.token,
    url: `${base}/player.html?battle=${encodeURIComponent(b.id)}&playerId=${encodeURIComponent(p.id)}&token=${encodeURIComponent(p.token)}`
  }));

  res.json({
    ok: true,
    spectator: { otp: b.spectator.otp, url: spectatorUrl },
    playerLinks
  });
});

// Fallback HTTP add player (when socket fails)
app.post(
  [
    '/api/battles/:id/player',
    '/api/battles/:id/players',
    '/api/admin/battles/:id/player',
    '/api/admin/battles/:id/players'
  ],
  (req, res) => {
    const b = battles.get(req.params.id);
    if (!b) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    const p = basePlayer(req.body?.player || req.body || {});
    b.players.push(p);
    console.log(`[battle ${b.id}] player added via HTTP: ${p.name} (${p.team})`);
    res.json({ ok: true, player: p, battle: sanitizeBattle(b) });
  }
);

// ===== Socket.IO =====
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: corsOrigins, credentials: true }
});

io.on('connection', (socket) => {
  console.log('[socket] connected', socket.id);

  // join battle room
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(battleId);
    const b = battles.get(battleId);
    if (b) {
      // 알림
      pushLog(io, b, 'system', '새 연결이 입장했습니다');
      emitUpdate(io, b);
    }
  });

  // Admin: start/pause/resume/end
  socket.on('startBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false, error: 'NOT_FOUND' });
    startBattle(io, b);
    cb?.({ ok: true });
  });
  socket.on('pauseBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    if (b.status === 'active') {
      b.status = 'paused';
      stopTurnTimer(b);
      pushLog(io, b, 'battle', '전투 일시정지');
      emitUpdate(io, b);
    }
    cb?.({ ok: true });
  });
  socket.on('resumeBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    if (b.status === 'paused') {
      b.status = 'active';
      pushLog(io, b, 'battle', '전투 재개');
      startTurnTimer(io, b);
      emitUpdate(io, b);
    }
    cb?.({ ok: true });
  });
  socket.on('endBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    endBattle(io, b);
    cb?.({ ok: true });
  });

  // Add / Delete player (다중 이벤트명 수신)
  const addPlayerHandler = (payload, cb) => {
    const b = battles.get(payload?.battleId);
    if (!b) return cb?.({ ok: false, error: 'NOT_FOUND' });
    const p = basePlayer(payload.player || {});
    b.players.push(p);
    pushLog(io, b, 'system', `${p.name}이(가) ${p.team}팀으로 참가했습니다`);
    emitUpdate(io, b);
    cb?.({ ok: true, player: p });
  };
  ['addPlayer', 'battle:addPlayer', 'admin:addPlayer', 'player:add', 'player:addToBattle', 'battle:player:add', 'add:player'].forEach(ev => {
    socket.on(ev, addPlayerHandler);
  });

  socket.on('deletePlayer', ({ battleId, playerId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false, error: 'NOT_FOUND' });
    const idx = b.players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      const [removed] = b.players.splice(idx, 1);
      pushLog(io, b, 'system', `${removed.name} 제거됨`);
      emitUpdate(io, b);
      cb?.({ ok: true });
    } else {
      cb?.({ ok: false, error: 'NO_PLAYER' });
    }
  });

  // Auth (player)
  socket.on('playerAuth', ({ battleId, token }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false, error: 'NOT_FOUND' });
    const p = b.players.find(p => p.token === token);
    if (!p) return cb?.({ ok: false, error: 'BAD_TOKEN' });
    socket.join(battleId);
    cb?.({ ok: true, player: p, battle: sanitizeBattle(b) });
    socket.emit('authSuccess', { player: p });
    socket.emit('auth:success', { player: p });
  });

  // Ready
  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false, error: 'NOT_FOUND' });
    const p = b.players.find(p => p.id === playerId);
    if (!p) return cb?.({ ok: false, error: 'NO_PLAYER' });
    pushLog(io, b, 'system', `${p.name}이(가) 준비 완료했습니다`);
    cb?.({ ok: true });
  });

  // Player action
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    const b = battles.get(battleId);
    if (!b || b.status !== 'active') {
      cb?.({ ok: false, error: 'NOT_ACTIVE' });
      return;
    }
    // 현재 턴/플레이어만 허용
    const cp = b.currentTurn?.currentPlayer;
    if (!cp || cp.id !== playerId) {
      cb?.({ ok: false, error: 'NOT_YOUR_TURN' });
      return;
    }
    // resolve
    resolveAction(io, b, { playerId, ...action }, false);
    socket.emit('actionSuccess');
    socket.emit('player:action:success');
    cb?.({ ok: true });
  });

  // Chat
  socket.on('chatMessage', (msg) => {
    const battleId = msg?.battleId;
    if (!battleId) return;
    io.to(battleId).emit('chatMessage', msg);
    // 구버전 이벤트명도 송출
    io.to(battleId).emit('battle:chat', msg);
  });

  // Spectator cheer -> chat으로도 표시
  socket.on('spectator:cheer', (data) => {
    const battleId = data?.battleId;
    if (!battleId) return;
    const payload = {
      type: 'cheer',
      name: data?.spectatorName || data?.name || '관전자',
      message: data?.message || data?.cheer || ''
    };
    io.to(battleId).emit('cheerMessage', payload);
    io.to(battleId).emit('chatMessage', payload);
  });

  socket.on('disconnect', () => {
    // noop (로그 과다 방지)
  });
});

// ===== Start =====
server.listen(PORT, HOST, () => {
  console.log(`[server] listening on ${HOST}:${PORT} (ESM)`);
});
