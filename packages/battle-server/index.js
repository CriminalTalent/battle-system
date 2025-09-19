// index.js — PYXIS battle-server (ESM)
// - battle:update / battleUpdate 두 이벤트 모두로 스냅샷 브로드캐스트
// - battle:log / battleLog 실시간 로그 브로드캐스트(1초 주기 플러시)
// - 스냅샷에 최근 로그 포함(최대 200개) -> 프런트가 스냅샷만 받아도 로그 렌더 가능
// - 매 1초 스냅샷 재전송 -> 프런트가 클라이언트 타이머 없이도 1초 단위 갱신
// - 엔진은 ./src/engine/BattleEngine.js (선택 5분/해석에서만 적용 버전 추천)

import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBattleStore } from './src/engine/BattleEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// Server bootstrap
// ----------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 정적 파일(필요 시)
const pubDir = path.join(__dirname, 'public');
app.use(express.static(pubDir));

// 헬스체크
app.get('/health', (_req, res) => res.json({ ok: true }));

// ----------------------------------------------------------------------------
// Battle Engine
// ----------------------------------------------------------------------------
const battleEngine = createBattleStore();

// 활성 배틀 추적(주기적 브로드캐스트/로그 플러시용)
const activeBattles = new Set();     // Set<battleId>
const lastLogIdx = new Map();        // Map<battleId, number>

// 스냅샷 빌더(최근 로그 포함)
function buildSnapshotWithLogs(battleId, logLimit = 200) {
  const snap = battleEngine.snapshot(battleId);
  if (!snap) return null;
  const b = battleEngine.get(battleId);
  const logs = Array.isArray(b?.logs) ? b.logs.slice(-logLimit) : [];
  return { ...snap, logs };
}

// 스냅샷 브로드캐스트(이벤트 이름 호환)
function emitUpdate(io, battleId) {
  const payload = buildSnapshotWithLogs(battleId);
  if (!payload) return;
  const room = `battle_${battleId}`;
  io.to(room).emit('battle:update', payload);
  io.to(room).emit('battleUpdate', payload); // 구버전 호환
}

// 신규 로그 플러시(증분)
function flushLogs(io, battleId) {
  const b = battleEngine.get(battleId);
  if (!b) return;
  const room = `battle_${battleId}`;
  const start = lastLogIdx.get(battleId) ?? 0;
  const end = b.logs.length;
  if (end <= start) return;
  for (let i = start; i < end; i++) {
    const entry = b.logs[i];
    io.to(room).emit('battle:log', entry);
    io.to(room).emit('battleLog', entry); // 구버전 호환
  }
  lastLogIdx.set(battleId, end);
}

// 매 1초 전체 배틀 스냅샷/로그 브로드캐스트(타이머/로그 실시간 보장)
setInterval(() => {
  for (const battleId of activeBattles) {
    emitUpdate(io, battleId); // timeLeftSec/phaseEndsAt 기반 1초 갱신
    flushLogs(io, battleId);  // 새 로그만 푸시
  }
}, 1000);

// ----------------------------------------------------------------------------
// Socket.io
// ----------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('[Socket] 새 연결:', socket.id);

  socket.on('disconnect', () => {
    console.log('[Socket] 연결 해제:', socket.id);
  });

  // 방 참가
  socket.on('join', ({ battleId }, cb = () => {}) => {
    try {
      if (!battleId) return cb({ ok: false, error: 'battleId 필요' });

      // 존재하지 않으면 새 배틀 생성(운영 정책에 맞게 필요 시 에러로 변경)
      let b = battleEngine.get(battleId);
      if (!b) {
        b = battleEngine.create('custom');
        // 새로 만든 battle의 id를 클라이언트가 넘긴 battleId로 강제 맞추고 싶다면
        // 엔진을 수정해야 한다. 여기서는 존재하지 않을 경우 에러로 처리한다.
        return cb({ ok: false, error: '존재하지 않는 전투입니다' });
      }

      socket.join(`battle_${battleId}`);
      activeBattles.add(battleId);
      lastLogIdx.set(battleId, b.logs.length);

      emitUpdate(io, battleId); // 현재 상태/로그 전달
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 새 배틀 생성
  socket.on('createBattle', ({ mode = '2v2' } = {}, cb = () => {}) => {
    try {
      const b = battleEngine.create(mode);
      activeBattles.add(b.id);
      lastLogIdx.set(b.id, 0);
      emitUpdate(io, b.id);
      cb({ ok: true, battleId: b.id });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 플레이어 추가
  socket.on('addPlayer', ({ battleId, player }, cb = () => {}) => {
    try {
      const added = battleEngine.addPlayer(battleId, player);
      if (!added) return cb({ ok: false, error: '플레이어 추가 실패' });

      // 입장 시스템 로그(엔진 로그와 별개로 즉시 전파)
      const b = battleEngine.get(battleId);
      if (b) {
        b.logs.push({ ts: Date.now(), type: 'system', message: `${added.name}이(가) ${added.team}팀에 입장했습니다` });
      }
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true, player: added });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 플레이어 제거
  socket.on('removePlayer', ({ battleId, playerId }, cb = () => {}) => {
    try {
      const b = battleEngine.get(battleId);
      const p = b?.players?.find(x => x.id === playerId);
      const ok = battleEngine.removePlayer(battleId, playerId);
      if (!ok) return cb({ ok: false, error: '플레이어 제거 실패' });

      if (b && p) {
        b.logs.push({ ts: Date.now(), type: 'system', message: `${p.name}이(가) 전투에서 나갔습니다` });
      }
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 준비 토글
  socket.on('markReady', ({ battleId, playerId, ready = true }, cb = () => {}) => {
    try {
      const ok = battleEngine.markReady(battleId, playerId, ready);
      if (!ok) return cb({ ok: false, error: '준비 상태 변경 실패' });
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId }, cb = () => {}) => {
    try {
      const result = battleEngine.start(battleId);
      if (!result) return cb({ ok: false, error: '전투를 시작할 수 없습니다' });

      activeBattles.add(battleId);
      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 플레이어 행동(선택 페이즈 의도 큐잉)
  socket.on('player:action', ({ battleId, playerId, action }, cb = () => {}) => {
    try {
      const res = battleEngine.playerAction(battleId, playerId, action);
      if (!res) return cb({ ok: false, error: '행동 처리 실패' });

      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  // 전투 종료
  socket.on('endBattle', ({ battleId }, cb = () => {}) => {
    try {
      const b = battleEngine.end(battleId);
      if (!b) return cb({ ok: false, error: '전투 종료 실패' });

      emitUpdate(io, battleId);
      flushLogs(io, battleId);
      activeBattles.delete(battleId);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });
});

// ----------------------------------------------------------------------------
// Launch
// ----------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[PYXIS] listening on http://0.0.0.0:${PORT}`);
});
