// packages/battle-server/index.js
// PYXIS Battle Server Entry

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================== 전투 관리 ==================
const battles = {}; // in-memory 전투 저장

function newId(prefix) {
  return prefix + '_' + Math.random().toString(36).substr(2, 9);
}

// ================== 기본 구조 ==================
function createBattle({ name, mode, quick = false }) {
  const id = newId('battle');
  const battle = {
    id,
    name: name || '새 전투',
    mode: mode || 'custom',
    players: {},
    state: {},
    chat: [],
    turn: {},
    phase: 'init',
    round: 1,
    createdAt: Date.now()
  };

  // ✅ 빠른 전투 세팅
  if (quick) {
    let teamSize = 1;
    if (mode === '2v2') teamSize = 2;
    if (mode === '3v3') teamSize = 3;
    if (mode === '4v4') teamSize = 4;

    let pidCounter = 1;
    ['A', 'B'].forEach(team => {
      for (let i = 0; i < teamSize; i++) {
        const pid = `P${pidCounter++}`;
        battle.players[pid] = {
          id: pid,
          name: `${team}${i + 1}`,
          team,
          hp: 100,
          maxHp: 100,
          stats: {
            attack: 3,
            defense: 3,
            agility: 3,
            luck: 3
          },
          alive: true
        };
      }
    });
  }

  battles[id] = battle;
  return battle;
}

// ================== 소켓 연결 ==================
io.on('connection', (socket) => {
  console.log('[Socket] New connection:', socket.id);

  // 관리자 전투 생성
  socket.on('battle:create', (data) => {
    try {
      const battle = createBattle(data);
      console.log('[Battle] Created:', battle.id, battle.mode);

      // 관리자 클라이언트에 전달
      socket.emit('battle:created', battle);

      // 모든 관리자에게 리스트 갱신
      io.emit('battle:list', Object.values(battles));
    } catch (err) {
      console.error('[Battle] Create error:', err);
      socket.emit('battle:error', err.message || '전투 생성 실패');
    }
  });

  // 전투 목록 요청
  socket.on('battle:list', () => {
    socket.emit('battle:list', Object.values(battles));
  });

  // 기본 테스트 이벤트
  socket.on('ping', () => {
    socket.emit('pong', { ts: Date.now() });
  });
});

// ================== 서버 실행 ==================
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
