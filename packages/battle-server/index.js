// /packages/battle-server/index.js
// Node ≥18, ESM

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ────────────────────────────────────────────────────────────
// Battle Engine (내장 스토어)
// ────────────────────────────────────────────────────────────
function createId(prefix = '') {
  return (
    prefix +
    Math.random().toString(36).slice(2, 6) +
    Date.now().toString(36).slice(-6)
  );
}

function createBattleStore(io) {
  const battles = new Map();                  // battleId -> battle
  const playerTokens = new Map();             // token -> { battleId, playerId }

  const broadcast = (battleId, event, payload) => {
    io.to(roomOf(battleId)).emit(event, payload);
  };
  const roomOf = (battleId) => `battle:${battleId}`;

  function snapshot(b) {
    const { timers, ...rest } = b;
    return JSON.parse(JSON.stringify(rest));
  }

  function ensureTimer(b) {
    if (b.timers.tick) clearInterval(b.timers.tick);
    b.timers.tick = setInterval(() => {
      if (b.status !== 'active') return;
      // 매초 타이머 감소
      if (b.currentTurn.timeLeftSec > 0) {
        b.currentTurn.timeLeftSec -= 1;
      }
      // 0이면 자동 패스 처리
      if (b.currentTurn.timeLeftSec <= 0) {
        addLog(b.id, 'notice', '시간 초과로 자동 패스 처리됩니다.');
        nextTurn(b);
      }
      broadcast(b.id, 'battle:update', snapshot(b));
    }, 1000);
  }

  function stopTimer(b) {
    if (b?.timers?.tick) {
      clearInterval(b.timers.tick);
      b.timers.tick = null;
    }
  }

  function addLog(battleId, type, message) {
    const b = battles.get(battleId);
    if (!b) return;
    const item = { ts: Date.now(), type, message };
    b.logs.push(item);
    broadcast(battleId, 'battle:log', item);
  }

  function reorderPlayers(b) {
    // 팀 A → 팀 B 순으로 턴 큐 간단 구성
    const A = b.players.filter(p => p.team === 'A');
    const B = b.players.filter(p => p.team === 'B');
    b.turnOrder = [...A, ...B].map(p => p.id);
  }

  function nextTurn(b) {
    if (!b.turnOrder.length) reorderPlayers(b);
    b.turnIndex = (b.turnIndex + 1) % b.turnOrder.length;
    const pid = b.turnOrder[b.turnIndex];
    const currentPlayer = b.players.find(p => p.id === pid) || null;
    b.currentTurn = {
      currentPlayer,
      timeLeftSec: b.turnDurationSec
    };
    addLog(b.id, 'notice', `${currentPlayer?.name || '플레이어'} 차례입니다.`);
  }

  // ── 공개 API ─────────────────────────────
  const api = {
    get battles() { return battles; },
    get playerTokens() { return playerTokens; },

    createBattle(mode = '2v2') {
      const battleId = createId('b_');
      const battle = {
        id: battleId,
        mode,
        status: 'waiting',                 // waiting | active | paused | ended
        phase: 'waiting',
        round: 1,
        players: [],
        logs: [],
        createdAt: Date.now(),
        turnDurationSec: 300,              // 5분
        currentTurn: { currentPlayer: null, timeLeftSec: 300 },
        turnOrder: [],
        turnIndex: -1,
        timers: { tick: null }
      };
      battles.set(battleId, battle);
      addLog(battleId, 'notice', `${mode} 전투가 생성되었습니다 (ID: ${battleId})`);
      return battle;
    },

    addPlayer(battleId, playerLike) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const p = {
        id: createId('p_'),
        name: playerLike.name || '플레이어',
        team: playerLike.team === 'B' ? 'B' : 'A',
        maxHp: Number(playerLike.maxHp || playerLike.hp || 100),
        hp: Number(playerLike.hp || 100),
        ready: false,
        avatar: playerLike.avatar || '',
        stats: {
          attack: Number(playerLike.stats?.attack || 1),
          defense: Number(playerLike.stats?.defense || 1),
          agility: Number(playerLike.stats?.agility || 1),
          luck: Number(playerLike.stats?.luck || 1),
        },
        items: {
          dittany: Number(playerLike.items?.dittany || playerLike.items?.ditany || 0),
          attackBooster: Number(playerLike.items?.attackBooster || playerLike.items?.attack_boost || 0),
          defenseBooster: Number(playerLike.items?.defenseBooster || playerLike.items?.defense_boost || 0),
        }
      };
      b.players.push(p);
      reorderPlayers(b);
      addLog(battleId, 'notice', `${p.name}이(가) ${p.team}팀에 합류했습니다.`);
      return p;
    },

    deletePlayer(battleId, playerId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const idx = b.players.findIndex(p => p.id === playerId);
      if (idx >= 0) {
        const [removed] = b.players.splice(idx, 1);
        addLog(battleId, 'notice', `${removed.name}이(가) 제거되었습니다.`);
        reorderPlayers(b);
      }
    },

    setReady(battleId, playerId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const p = b.players.find(p => p.id === playerId);
      if (p) {
        p.ready = true;
        addLog(battleId, 'notice', `${p.name}이(가) 준비 완료`);
      }
    },

    start(battleId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      if (!b.players.length) throw new Error('플레이어가 없습니다.');
      b.status = 'active';
      b.phase = 'A_select';
      b.round = 1;
      b.turnIndex = -1;
      reorderPlayers(b);
      nextTurn(b);
      ensureTimer(b);
      addLog(battleId, 'notice', '전투 시작');
      return b;
    },

    pause(battleId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      b.status = 'paused';
      stopTimer(b);
      addLog(battleId, 'notice', '일시정지됨');
    },

    resume(battleId) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      b.status = 'active';
      ensureTimer(b);
      addLog(battleId, 'notice', '재개됨');
    },

    end(battleId, winner = null) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      b.status = 'ended';
      stopTimer(b);
      addLog(battleId, 'result', `전투 종료${winner ? ` - ${winner}팀 승리` : ''}`);
      io.to(roomOf(battleId)).emit('battle:ended', { winner });
    },

    act(battleId, playerId, action) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');
      const p = b.players.find(x => x.id === playerId);
      if (!p) throw new Error('Player not found');

      // 간단한 로그만 남기고 다음 턴
      const msgBase =
        action.type === 'attack' ? '공격' :
        action.type === 'defend' ? '방어' :
        action.type === 'dodge'  ? '회피' :
        action.type === 'item'   ? `아이템(${action.item})` :
        '패스';
      addLog(battleId, 'notice', `${p.name} - ${msgBase}`);

      nextTurn(b);
      broadcast(battleId, 'battle:update', snapshot(b));
    },

    // 링크/토큰
    makeLinks(battleId, publicBase) {
      const b = battles.get(battleId);
      if (!b) throw new Error('Battle not found');

      const players = b.players.map(p => {
        const token = createId('t_');
        playerTokens.set(token, { battleId, playerId: p.id });
        const url = new URL('/player', publicBase);
        url.searchParams.set('battle', battleId);
        url.searchParams.set('token', token);
        url.searchParams.set('name', p.name);
        return {
          playerId: p.id,
          team: p.team,
          playerName: p.name,
          url: url.toString()
        };
      });

      const sp = new URL('/spectator', publicBase);
      sp.searchParams.set('battle', battleId);

      return {
        spectator: { url: sp.toString() },
        players
      };
    },

    authByToken(token) {
      const info = playerTokens.get(token);
      if (!info) return null;
      const b = battles.get(info.battleId);
      if (!b) return null;
      const player = b.players.find(p => p.id === info.playerId);
      if (!player) return null;
      return { battleId: info.battleId, playerId: info.playerId };
    }
  };

  return api;
}

// ────────────────────────────────────────────────────────────
// App / IO
// ────────────────────────────────────────────────────────────
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, credentials: true }
});

app.use(express.json());

// 정적 파일
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

// 명시 라우트 (404 방지)
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// 업로드
const upload = multer({ dest: UPLOAD_DIR });
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'no_file' });
    // 정적 경로 노출
    const rel = `/uploads/avatars/${req.file.filename}`;
    return res.json({ ok:true, url: rel });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// 링크 생성(관리자용)
app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const publicBase =
      process.env.PUBLIC_BASE ||
      `${req.protocol}://${req.get('host')}`;
    const links = battleEngine.makeLinks(battleId, publicBase);
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

// ────────────────────────────────────────────────────────────
const battleEngine = createBattleStore(io);

// ── Socket.io
io.on('connection', (socket) => {
  console.log(`[Socket] 새 연결: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket] 연결 해제: ${socket.id}`);
  });

  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(`battle:${battleId}`);
    const b = battleEngine.battles.get(battleId);
    if (b) socket.emit('battle:update', JSON.parse(JSON.stringify(b)));
  });

  // 관리자: 배틀 생성
  socket.on('createBattle', (payload, ack = () => {}) => {
    try {
      const mode = payload?.mode || '2v2';
      const b = battleEngine.createBattle(mode);
      socket.join(`battle:${b.id}`);
      io.to(`battle:${b.id}`).emit('battle:update', JSON.parse(JSON.stringify(b)));
      ack({ ok:true, battleId:b.id, battle:b });
    } catch (e) {
      ack({ ok:false, error: e.message || String(e) });
    }
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

  // 플레이어 추가/삭제 (관리자)
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

// ────────────────────────────────────────────────────────────
// Start
// ────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
