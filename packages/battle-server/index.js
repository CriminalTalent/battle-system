// /packages/battle-server/index.js
// Node >= 18, ESM

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import multer from 'multer';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────
function createId(prefix = '') {
  return (
    prefix +
    Math.random().toString(36).slice(2, 6) +
    Date.now().toString(36).slice(-6)
  );
}

// ─────────────────────────────────────────
// 내장 엔진(폴백) - 간단 규칙
// ─────────────────────────────────────────
function createBuiltinEngine(io) {
  const battles = new Map();
  const playerTokens = new Map();
  const roomOf = (b) => `battle:${b}`;
  const snap = (b) => {
    const { timers, ...rest } = b;
    return JSON.parse(JSON.stringify(rest));
  };
  const log = (id, type, message) => {
    const b = battles.get(id);
    if (!b) return;
    const item = { ts: Date.now(), type, message };
    b.logs.push(item);
    io.to(roomOf(id)).emit('battle:log', item);
  };

  function reorder(b) {
    const A = b.players.filter(p => p.team === 'A');
    const B = b.players.filter(p => p.team === 'B');
    b.turnOrder = [...A, ...B].map(p => p.id);
  }
  function nextTurn(b) {
    if (!b.turnOrder.length) reorder(b);
    b.turnIndex = (b.turnIndex + 1) % b.turnOrder.length;
    const pid = b.turnOrder[b.turnIndex];
    const currentPlayer = b.players.find(p => p.id === pid) || null;
    b.currentTurn = { currentPlayer, timeLeftSec: b.turnDurationSec };
    log(b.id, 'notice', `${currentPlayer?.name || '플레이어'} 차례입니다.`);
  }
  function ensureTimer(b) {
    if (b.timers.tick) clearInterval(b.timers.tick);
    b.timers.tick = setInterval(() => {
      if (b.status !== 'active') return;
      b.currentTurn.timeLeftSec = Math.max(0, b.currentTurn.timeLeftSec - 1);
      if (b.currentTurn.timeLeftSec === 0) {
        log(b.id, 'notice', '시간 초과로 자동 패스');
        nextTurn(b);
      }
      io.to(roomOf(b.id)).emit('battle:update', snap(b));
    }, 1000);
  }
  function stopTimer(b) {
    if (b?.timers?.tick) {
      clearInterval(b.timers.tick);
      b.timers.tick = null;
    }
  }

  const api = {
    battles,
    createBattle(mode = '2v2') {
      const id = createId('b_');
      const b = {
        id, mode,
        status: 'waiting',
        phase: 'waiting',
        round: 1,
        players: [],
        logs: [],
        createdAt: Date.now(),
        turnDurationSec: 300, // 5분
        currentTurn: { currentPlayer: null, timeLeftSec: 300 },
        turnOrder: [], turnIndex: -1,
        timers: { tick: null }
      };
      battles.set(id, b);
      log(id, 'notice', `${mode} 전투가 생성되었습니다 (ID: ${id})`);
      return b;
    },
    addPlayer(battleId, pLike) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const p = {
        id: createId('p_'),
        name: pLike.name || '플레이어',
        team: pLike.team === 'B' ? 'B' : 'A',
        maxHp: Number(pLike.maxHp || pLike.hp || 100),
        hp: Number(pLike.hp || 100),
        ready: false,
        avatar: pLike.avatar || '',
        stats: {
          attack: Number(pLike.stats?.attack || 1),
          defense: Number(pLike.stats?.defense || 1),
          agility: Number(pLike.stats?.agility || 1),
          luck: Number(pLike.stats?.luck || 1),
        },
        items: {
          dittany: Number(pLike.items?.dittany || pLike.items?.ditany || 0),
          attackBooster: Number(pLike.items?.attackBooster || pLike.items?.attack_boost || 0),
          defenseBooster: Number(pLike.items?.defenseBooster || pLike.items?.defense_boost || 0),
        }
      };
      b.players.push(p); reorder(b);
      log(battleId, 'notice', `${p.name}이(가) ${p.team}팀에 합류했습니다.`);
      return p;
    },
    deletePlayer(battleId, playerId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const i = b.players.findIndex(p => p.id === playerId);
      if (i >= 0) {
        const [r] = b.players.splice(i, 1);
        log(battleId, 'notice', `${r.name}이(가) 제거되었습니다.`);
        reorder(b);
      }
    },
    setReady(battleId, playerId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const p = b.players.find(p => p.id === playerId);
      if (p) { p.ready = true; log(battleId, 'notice', `${p.name}이(가) 준비 완료`); }
    },
    start(battleId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      if (!b.players.length) throw new Error('플레이어가 없습니다.');
      b.status = 'active'; b.phase = 'A_select'; b.round = 1;
      b.turnIndex = -1; reorder(b); nextTurn(b); ensureTimer(b);
      log(battleId, 'notice', '전투 시작'); return b;
    },
    pause(battleId) { const b = battles.get(battleId); if (!b) throw new Error('Battle not found'); b.status = 'paused'; stopTimer(b); log(battleId,'notice','일시정지'); },
    resume(battleId) { const b = battles.get(battleId); if (!b) throw new Error('Battle not found'); b.status = 'active'; ensureTimer(b); log(battleId,'notice','재개'); },
    end(battleId, winner = null) { const b = battles.get(battleId); if (!b) throw new Error('Battle not found'); b.status='ended'; stopTimer(b); log(battleId,'result',`전투 종료${winner?` - ${winner}팀 승리`:''}`); io.to(roomOf(battleId)).emit('battle:ended',{winner}); },
    act(battleId, playerId, action) {
      const b = battles.get(battleId); if (!b) throw new Error('Battle not found');
      const p = b.players.find(x => x.id === playerId); if (!p) throw new Error('Player not found');
      const label =
        action?.type === 'attack' ? '공격' :
        action?.type === 'defend' ? '방어' :
        action?.type === 'dodge'  ? '회피' :
        action?.type === 'item'   ? `아이템(${action?.item})` : '패스';
      log(battleId, 'notice', `${p.name} - ${label}`);
      nextTurn(b); io.to(roomOf(battleId)).emit('battle:update', snap(b));
    },
    // 토큰/링크
    makeLinks(battleId, publicBase) {
      const b = battles.get(battleId); if (!b) throw new Error('Battle not found');
      const players = b.players.map(p => {
        const token = createId('t_');
        playerTokens.set(token, { battleId, playerId: p.id });
        const url = new URL('/player', publicBase);
        url.searchParams.set('battle', battleId);
        url.searchParams.set('token', token);
        url.searchParams.set('name', p.name);
        return { playerId: p.id, team: p.team, playerName: p.name, url: url.toString() };
      });
      const sp = new URL('/spectator', publicBase); sp.searchParams.set('battle', battleId);
      return { spectator:{ url: sp.toString() }, players };
    },
    authByToken(token) {
      const info = playerTokens.get(token); if (!info) return null;
      const b = battles.get(info.battleId); if (!b) return null;
      const p = b.players.find(x => x.id === info.playerId); if (!p) return null;
      return { battleId: info.battleId, playerId: info.playerId };
    },
  };
  return api;
}

// ─────────────────────────────────────────
// 외부 엔진 자동 로드 (있으면 우선 사용)
// ─────────────────────────────────────────
async function tryLoadExternalEngine(io) {
  const candidate = path.join(__dirname, 'src/engine/BattleEngine.js');
  try {
    await fs.promises.access(candidate, fs.constants.R_OK);
  } catch {
    return null;
  }
  try {
    const mod = await import(pathToFileURL(candidate).href);
    if (typeof mod.createBattleStore !== 'function') return null;

    // 외부 엔진 인스턴스 생성(필요시 io 전달)
    const ext = mod.createBattleStore(io) || mod.createBattleStore({ io }) || mod.createBattleStore();

    // 메서드 이름이 다를 수 있으므로 어댑터 구성
    const pick = (...names) => {
      for (const n of names) {
        const fn = ext?.[n];
        if (typeof fn === 'function') return fn.bind(ext);
      }
      return null;
    };

    const adapter = {
      battles: ext.battles || ext.store || new Map(),
      createBattle: pick('createBattle', 'create'),
      addPlayer: pick('addPlayer', 'addPlayerToBattle'),
      deletePlayer: pick('deletePlayer', 'removePlayer'),
      setReady: pick('setReady', 'readyPlayer', 'playerReady'),
      start: pick('start', 'startBattle'),
      pause: pick('pause', 'pauseBattle'),
      resume: pick('resume', 'resumeBattle'),
      end: pick('end', 'endBattle'),
      act: pick('act', 'applyAction', 'resolveAction'),
      // 토큰/링크 관련은 서버에서 처리(외부 엔진이 제공할 수도 있으나 표준화가 어려워 여기서 유지)
      makeLinks: null,
      authByToken: ext.authByToken ? ext.authByToken.bind(ext) : null,
      __ext: ext
    };

    console.log('[ENGINE] External BattleEngine.js 로드됨');
    return adapter;
  } catch (e) {
    console.log('[ENGINE] External 로드 실패:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────
// Express/Socket.IO
// ─────────────────────────────────────────
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });

app.use(express.json());

// 정적 파일
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

// 명시 라우트
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// 업로드
const upload = multer({ dest: UPLOAD_DIR });
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'no_file' });
    const rel = `/uploads/avatars/${req.file.filename}`;
    return res.json({ ok:true, url: rel });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// 링크 생성(관리자)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const publicBase = process.env.PUBLIC_BASE || `${req.protocol}://${req.get('host')}`;
    const links = (battleEngine.makeLinks
      ? battleEngine.makeLinks(battleId, publicBase)
      : builtinMakeLinks(battleId, publicBase));
    return res.json({ ok:true, links });
  } catch (e) {
    return res.status(400).json({ ok:false, error: e.message });
  }
});

// 구형 호환 링크
app.get('/api/link/participant', (req, res) => {
  const battleId = req.query.battleId || req.query.id;
  if (!battleId) return res.status(400).send('battleId required');
  const url = new URL('/player', `${req.protocol}://${req.get('host')}`);
  url.searchParams.set('battle', battleId);
  url.searchParams.set('id', battleId);
  return res.json({ ok:true, url: url.toString(), battleId, role:'player' });
});
app.get('/api/link/spectator', (req, res) => {
  const battleId = req.query.battleId || req.query.id;
  if (!battleId) return res.status(400).send('battleId required');
  const url = new URL('/spectator', `${req.protocol}://${req.get('host')}`);
  url.searchParams.set('battle', battleId);
  url.searchParams.set('id', battleId);
  return res.json({ ok:true, url: url.toString(), battleId, role:'spectator' });
});

// 링크 생성 헬퍼(외부 엔진 사용 시에도 서버에서 토큰 발급 유지)
const _tokens = new Map(); // token -> { battleId, playerId }
function builtinMakeLinks(battleId, publicBase) {
  const b = battleEngine.battles.get(battleId);
  if (!b) throw new Error('Battle not found');
  const players = (b.players || []).map(p => {
    const token = createId('t_');
    _tokens.set(token, { battleId, playerId: p.id });
    const url = new URL('/player', publicBase);
    url.searchParams.set('battle', battleId);
    url.searchParams.set('token', token);
    url.searchParams.set('name', p.name);
    return { playerId: p.id, team: p.team, playerName: p.name, url: url.toString() };
  });
  const sp = new URL('/spectator', publicBase); sp.searchParams.set('battle', battleId);
  return { spectator: { url: sp.toString() }, players };
}
function builtinAuthByToken(token) {
  const info = _tokens.get(token);
  if (!info) return null;
  const b = battleEngine.battles.get(info.battleId);
  if (!b) return null;
  const p = (b.players || []).find(x => x.id === info.playerId);
  if (!p) return null;
  return { battleId: info.battleId, playerId: info.playerId };
}

// ─────────────────────────────────────────
// 엔진 초기화: 외부→내장 순서
// ─────────────────────────────────────────
let battleEngine = await tryLoadExternalEngine(io);
if (!battleEngine) {
  console.log('[ENGINE] Builtin fallback 로드');
  battleEngine = createBuiltinEngine(io);
}

// makeLinks/authByToken 보완(외부 엔진이 없으면 서버 헬퍼로 처리)
if (!battleEngine.makeLinks) battleEngine.makeLinks = builtinMakeLinks;
if (!battleEngine.authByToken) battleEngine.authByToken = builtinAuthByToken;

// ─────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] 새 연결: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[Socket] 연결 해제: ${socket.id}`));

  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(`battle:${battleId}`);
    const b = battleEngine.battles.get(battleId);
    if (b) socket.emit('battle:update', JSON.parse(JSON.stringify(b)));
  });

  socket.on('createBattle', (payload, ack = () => {}) => {
    try {
      const mode = payload?.mode || '2v2';
      const b = battleEngine.createBattle(mode);
      socket.join(`battle:${b.id}`);
      io.to(`battle:${b.id}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
      ack({ ok:true, battleId:b.id, battle:b });
    } catch (e) { ack({ ok:false, error: e.message || String(e) }); }
  });

  socket.on('startBattle', ({ battleId }, ack = () => {}) => {
    try {
      const b = battleEngine.start(battleId);
      io.to(`battle:${battleId}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
      ack({ ok:true });
    } catch (e) { ack({ ok:false, error:e.message }); }
  });
  socket.on('pauseBattle', ({ battleId }, ack = () => {}) => {
    try { battleEngine.pause(battleId); ack({ ok:true }); }
    catch (e) { ack({ ok:false, error:e.message }); }
  });
  socket.on('resumeBattle', ({ battleId }, ack = () => {}) => {
    try {
      battleEngine.resume(battleId);
      const b = battleEngine.battles.get(battleId);
      io.to(`battle:${battleId}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
      ack({ ok:true });
    } catch (e) { ack({ ok:false, error:e.message }); }
  });
  socket.on('endBattle', ({ battleId, winner }, ack = () => {}) => {
    try { battleEngine.end(battleId, winner); ack({ ok:true }); }
    catch (e) { ack({ ok:false, error:e.message }); }
  });

  socket.on('addPlayer', ({ battleId, player }, ack = () => {}) => {
    try {
      const p = battleEngine.addPlayer(battleId, player || {});
      const b = battleEngine.battles.get(battleId);
      io.to(`battle:${battleId}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
      ack({ ok:true, player:p });
    } catch (e) { ack({ ok:false, error:e.message }); }
  });
  socket.on('deletePlayer', ({ battleId, playerId }, ack = () => {}) => {
    try {
      battleEngine.deletePlayer(battleId, playerId);
      const b = battleEngine.battles.get(battleId);
      io.to(`battle:${battleId}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
      ack({ ok:true });
    } catch (e) { ack({ ok:false, error:e.message }); }
  });

  // 플레이어 인증(토큰)
  socket.on('playerAuth', ({ battleId, token }, ack = () => {}) => {
    try {
      const info = battleEngine.authByToken(token);
      if (!info || info.battleId !== battleId) return ack({ ok:false, error:'invalid_token' });
      ack({ ok:true, playerId: info.playerId });
    } catch (e) { ack({ ok:false, error:e.message }); }
  });

  // 플레이어 준비/행동
  socket.on('player:ready', ({ battleId, playerId }) => {
    try {
      battleEngine.setReady(battleId, playerId);
      const b = battleEngine.battles.get(battleId);
      io.to(`battle:${battleId}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
    } catch {}
  });
  socket.on('player:action', ({ battleId, playerId, action }, ack = () => {}) => {
    try {
      battleEngine.act(battleId, playerId, action || { type:'pass' });
      socket.emit('player:action:success', { ok:true });
      ack({ ok:true });
    } catch (e) { ack({ ok:false, error:e.message }); }
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    io.to(`battle:${battleId}`).emit('chatMessage', { name: name || '익명', message });
  });
});

// ─────────────────────────────────────────
// 서버 기동
// ─────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
