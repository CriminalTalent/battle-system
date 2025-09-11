"use strict";

/* ========= 의존 ========= */
const { Server } = require("socket.io");

// 경량 전투 유틸(시작/라운드 스왑/로그 등): 규정 준수
const {
  startBattle,
  endBattle,
  nextTurn,
  validateBattleState,
  cleanupBattle,
  pushLog,
  isBattleOver,
  winnerByHpSum,
} = require("../engine/BattleLite"); // ← 파일명/경로는 프로젝트에 맞춰 조정 (예시)

/* 고급 전투 엔진: resolve(action)로 1행동 처리 + 라운드/페이즈 자동 전환 */
const { BattleEngine } = require("../engine/BattleEngine");

/* ========= 인메모리 저장소(예시) ========= */
const battles = new Map(); // battleId -> battle object

/* ========= 도우미 ========= */
function applyHpUpdates(battle, updates) {
  if (!updates || !updates.hp) return;
  const byId = new Map((battle.players || []).map(p => [p.id, p]));
  for (const [pid, hp] of Object.entries(updates.hp)) {
    const p = byId.get(pid);
    if (p) p.hp = Math.max(0, Math.min(100, Number(hp) || 0));
  }
}

function broadcastBattle(io, battle, extra = {}) {
  const payload = { ...battle, ...extra };
  io.emit("battleUpdate", payload);
  io.emit("battle:update", payload);
}

function emitLog(io, entry) {
  io.emit("battleLog", entry);
  io.emit("battle:log", entry);
}

/* ========= 메인: 소켓 바인딩 ========= */
function initBattleSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    // ---------- 인증 (관리자/플레이어/관전자) ----------
    socket.on("admin:auth", ({ battleId, token }, ack) => {
      const b = battles.get(battleId);
      if (!b || (b.adminToken && b.adminToken !== token)) {
        ack && ack({ ok: false });
        socket.emit("auth:error", { message: "관리자 인증 실패" });
        return;
      }
      socket.join(battleId);
      ack && ack({ ok: true, battle: b });
      socket.emit("auth:success", { battle: b });
    });
    socket.on("adminAuth", (p) => socket.emit("authError", { message: "신규 이벤트 사용 요망" }));

    socket.on("playerAuth", ({ battleId, token, name, team }, ack) => {
      const b = battles.get(battleId);
      if (!b) return socket.emit("authError", { message: "전투 없음" });
      // 토큰 검증은 프로젝트 정책에 맞게 (여기선 생략/예시)
      const player = (b.players || []).find(p => p.name === name);
      if (!player) {
        socket.emit("authError", { message: "플레이어 없음" });
        return;
      }
      socket.join(battleId);
      ack && ack({ ok: true, playerId: player.id, battle: b });
      socket.emit("authSuccess", { playerId: player.id, battle: b });
      broadcastBattle(io, b);
    });

    socket.on("spectator:auth", ({ battleId, name, token }, ack) => {
      const b = battles.get(battleId);
      if (!b) return socket.emit("auth:error", { message: "전투 없음" });
      // 토큰 검증 로직은 프로젝트 정책에 맞게
      socket.join(battleId);
      ack && ack({ ok: true, spectator: { name }, battle: b });
      socket.emit("auth:success", { spectator: { name }, battle: b });
    });
    socket.on("spectatorAuth", (p) => socket.emit("authError", { message: "신규 이벤트 사용 요망" }));

    // ---------- 준비 완료 ----------
    socket.on("playerReady", ({ battleId, playerId, ready }) => {
      const b = battles.get(battleId); if (!b) return;
      const p = (b.players || []).find(x => x.id === playerId);
      if (p) p.ready = !!ready;
      pushLog(b, { type: "system", message: `${p?.name || "플레이어"} 준비 ${ready ? "완료" : "해제"}` });
      broadcastBattle(io, b);
    });

    // ---------- 전투 컨트롤 ----------
    socket.on("admin:start", ({ battleId }, ack) => {
      const b = battles.get(battleId); if (!b) return;
      validateBattleState(b);
      startBattle(b); // 선공 결정 + 1턴 시작
      pushLog(b, { type: "system", message: "전투 시작" });
      ack && ack({ ok: true });
      broadcastBattle(io, b);
    });
    socket.on("startBattle", ({ battleId }) => socket.emit("battle:started"));

    socket.on("admin:pause", ({ battleId }, ack) => {
      const b = battles.get(battleId); if (!b) return;
      b.status = "paused";
      pushLog(b, { type: "system", message: "일시정지" });
      ack && ack({ ok: true });
      broadcastBattle(io, b);
    });
    socket.on("admin:resume", ({ battleId }, ack) => {
      const b = battles.get(battleId); if (!b) return;
      b.status = "active";
      pushLog(b, { type: "system", message: "재개" });
      ack && ack({ ok: true });
      broadcastBattle(io, b);
    });
    socket.on("admin:end", ({ battleId }, ack) => {
      const b = battles.get(battleId); if (!b) return;
      endBattle(b);
      const winner = winnerByHpSum(b);
      pushLog(b, { type: "system", message: `전투 종료 (${winner ? (winner === "phoenix" ? "A팀" : "B팀") : "무승부"})` });
      ack && ack({ ok: true });
      io.to(battleId).emit("battle:ended", { winner });
      broadcastBattle(io, b);
    });

    // ---------- 액션 처리(핵심) ----------
    socket.on("playerAction", ({ battleId, actorId, type, targetId, itemType }) => {
      const b = battles.get(battleId); if (!b) return;
      if (b.status !== "active") return;

      // 1행동 해석
      const engine = new BattleEngine(b);
      const result = engine.resolve({ actorId, type, targetId, itemType });

      // HP 반영
      applyHpUpdates(b, result.updates);

      // 로그 반영/전송
      (result.logs || []).forEach(entry => {
        pushLog(b, entry);
        emitLog(io, entry);
      });

      // 종료 체크
      if (isBattleOver(b)) {
        b.status = "ended";
        const winner = winnerByHpSum(b);
        pushLog(b, { type: "system", message: `전투 종료 (${winner ? (winner === "phoenix" ? "A팀" : "B팀") : "무승부"})` });
        io.to(battleId).emit("battle:ended", { winner });
      }

      // 상태 정리
      cleanupBattle(b);

      // 상태 브로드캐스트(+턴 리포트 동봉)
      broadcastBattle(io, b, { turn: result.turn });
    });

    // ---------- 채팅/응원 ----------
    socket.on("chatMessage", ({ battleId, message, name }) => {
      if (!battleId || !message) return;
      io.to(battleId).emit("chatMessage", { senderName: name || "익명", message });
    });
    socket.on("spectator:cheer", ({ message }, ack) => {
      if (!message) { ack && ack({ ok: false }); return; }
      io.emit("cheerMessage", { name: "관전자", message });
      ack && ack({ ok: true });
    });

  });

  return io;
}

/* ========= REST 예시(필요 시 index.js에 배선) ========= */
async function createBattle(req, res) {
  try {
    const { id, mode = "4v4", adminToken, spectatorOtp } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });

    const battle = {
      id,
      mode,
      adminToken,
      spectatorOtp,
      status: "waiting",
      players: [],
      log: [],
      effects: [],
      turn: { round: 0, order: ["A","B"], phaseIndex: 0, acted: { A:new Set(), B:new Set() } },
    };
    validateBattleState(battle);
    battles.set(id, battle);
    return res.json(battle);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function addPlayer(req, res) {
  const { id } = req.params;
  const b = battles.get(id);
  if (!b) return res.status(404).json({ error: "not found" });

  const body = req.body || {};
  const player = {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    name: body.name,
    team: body.team, // "phoenix" | "eaters"
    stats: {
      attack: Number(body?.stats?.attack || 3),
      defense:Number(body?.stats?.defense|| 3),
      luck:   Number(body?.stats?.luck   || 2),
      agility:Number(body?.stats?.agility|| 3),
    },
    hp: Number(body.hp || 100),
    ready:false,
    avatar: body.avatar || "",
    items: {
      dittany: Number(body?.items?.dittany || 0),
      attack_boost: Number(body?.items?.attack_boost || 0),
      defense_boost: Number(body?.items?.defense_boost || 0),
    }
  };
  b.players.push(player);
  pushLog(b, { type: "system", message: `${player.name} 입장` });
  return res.json(player);
}

module.exports = {
  initBattleSockets,
  createBattle,
  addPlayer,
};
