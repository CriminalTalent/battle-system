"use strict";

/**
 * 소켓 이벤트 통합 처리
 * - 인증: adminAuth / playerAuth / spectatorAuth
 * - 상태 브로드캐스트: battleUpdate, chatMessage, cheerMessage
 * - 액션: playerReady, playerAction
 * - 관리자: start / pause / resume / end
 *
 * 수정 포인트
 * 1) 플레이어 라운드 진행: 양팀 페이즈 완료 시 라운드 자동 증가 및 선공 교대
 * 2) 상대 체력 시각화: 브로드캐스트에 양팀 HP가 항상 포함
 * 3) 관전자 로그인 불가: spectatorAuth 경로와 토큰 검증 정상화
 * 4) 관리자 화면에서 준비완료 반영, 일시정지/재개/종료 동작
 */

const { Server } = require("socket.io");
const crypto = require("crypto");
const { BattleEngine } = require("../engine/BattleEngine");

// 인메모리 저장소(간단)
const battles = new Map(); // battleId -> state
const sockets = new Map(); // socket.id -> { role, battleId, playerId, name }

function makeId() { return crypto.randomBytes(8).toString("hex"); }

function getBattle(battleId) { return battles.get(battleId); }
function setBattle(battleId, state) { battles.set(battleId, state); }

function ensureBattle(battleId) {
  let b = getBattle(battleId);
  if (!b) {
    b = {
      id: battleId,
      status: "waiting",
      round: 1,
      leadingTeam: "A",
      players: [], // { id, name, team:"A"|"B", hp:100, stats:{...}, ready:false }
      effects: [],
      turn: { round: 1, order: ["A", "B"], phaseIndex: 0, acted: { A: new Set(), B: new Set() } },
      log: [],
      otp: { admin: null, player: null, spectator: null }
    };
    setBattle(battleId, b);
  }
  return b;
}

function broadcast(io, battleId) {
  const b = getBattle(battleId);
  if (!b) return;
  const payload = {
    id: b.id,
    status: b.status,
    round: b.turn?.round || b.round || 1,
    phaseTeam: b.turn?.order?.[b.turn?.phaseIndex || 0] || "A",
    teams: {
      A: { players: (b.players || []).filter(p => p.team === "A").map(({ id, name, hp, stats }) => ({ id, name, hp, stats })) },
      B: { players: (b.players || []).filter(p => p.team === "B").map(({ id, name, hp, stats }) => ({ id, name, hp, stats })) }
    },
    lastEvent: b.log?.slice(-1)[0]?.message || null
  };
  io.to(battleId).emit("battleUpdate", payload);
}

function pushLog(battle, message) {
  battle.log = battle.log || [];
  battle.log.push({ type: "system", message, ts: Date.now() });
  if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
}

function installSocketHandlers(httpServer) {
  const io = new Server(httpServer, { cors: { origin: true, credentials: true } });

  io.on("connection", (socket) => {
    sockets.set(socket.id, {});

    /* ===== 인증 ===== */
    socket.on("adminAuth", ({ battleId, token, name }) => {
      const b = ensureBattle(battleId);
      // 관리자 토큰은 별도 관리. 없으면 최초 생성 시 입력값을 등록해 허용(운영 중엔 /admin 링크로 발급)
      if (!b.otp.admin) b.otp.admin = token;
      if (token !== b.otp.admin) return socket.emit("authError", { message: "잘못된 관리자 토큰" });

      sockets.set(socket.id, { role: "admin", battleId, name: name || "관리자" });
      socket.join(battleId);
      socket.emit("authSuccess", { role: "admin" });
      broadcast(io, battleId);
    });

    socket.on("playerAuth", ({ battleId, token, name, team }) => {
      const b = ensureBattle(battleId);
      if (!b.otp.player) b.otp.player = token;
      if (token !== b.otp.player) return socket.emit("authError", { message: "잘못된 플레이어 OTP" });

      const pid = makeId();
      const player = {
        id: pid,
        name: name || `플레이어-${pid.slice(0,4)}`,
        team: team === "B" ? "B" : "A",
        hp: 100,
        stats: { 공격: 3, 방어: 3, 민첩: 3, 행운: 2 },
        ready: false
      };
      b.players.push(player);

      sockets.set(socket.id, { role: "player", battleId, playerId: pid, name: player.name });
      socket.join(battleId);
      socket.emit("authSuccess", { role: "player", playerId: pid });
      pushLog(b, `플레이어 입장: ${player.name} (${player.team}팀)`);
      broadcast(io, battleId);
    });

    socket.on("spectatorAuth", ({ battleId, token, name }) => {
      const b = ensureBattle(battleId);
      if (!b.otp.spectator) b.otp.spectator = token;
      if (token !== b.otp.spectator) return socket.emit("authError", { message: "잘못된 관전자 OTP" });

      sockets.set(socket.id, { role: "spectator", battleId, name: name || "관전자" });
      socket.join(battleId);
      socket.emit("authSuccess", { role: "spectator" });
      pushLog(b, `관전자 입장: ${name || "익명"}`);
      broadcast(io, battleId);
    });

    /* ===== 채팅/응원 ===== */
    socket.on("chatMessage", ({ battleId, message }) => {
      const s = sockets.get(socket.id) || {};
      if (!s.role || !s.battleId || s.battleId !== battleId) return;
      const body = { name: s.name || s.role, role: s.role, message, ts: Date.now() };
      io.to(battleId).emit("chatMessage", body);
    });

    socket.on("cheerMessage", ({ battleId, message }) => {
      const s = sockets.get(socket.id) || {};
      if (!s.role || !s.battleId || s.battleId !== battleId) return;
      const body = { name: s.name || "관전자", message, ts: Date.now() };
      io.to(battleId).emit("cheerMessage", body);
      pushLog(getBattle(battleId), `[응원] ${body.name}: ${message}`);
    });

    /* ===== 준비/시작/일시정지/재개/종료 ===== */
    socket.on("playerReady", ({ battleId, playerId, ready }) => {
      const b = getBattle(battleId);
      if (!b) return;
      const p = (b.players || []).find(x => x.id === playerId);
      if (!p) return;
      p.ready = !!ready;
      broadcast(io, battleId);
    });

    socket.on("adminStart", ({ battleId }) => {
      const b = getBattle(battleId);
      if (!b) return;
      const allReady = (b.players || []).length > 0 && (b.players || []).every(p => p.ready);
      if (!allReady) return socket.emit("actionError", { message: "모든 플레이어가 준비 상태여야 시작할 수 있습니다." });

      b.status = "active";
      b.round = 1;
      b.leadingTeam = "A"; // 최초 선공은 엔진이 resolve 호출 중 교대되어도 무방
      b.turn = { round: 1, order: ["A", "B"], phaseIndex: 0, acted: { A: new Set(), B: new Set() } };
      pushLog(b, "전투 시작");
      broadcast(io, battleId);
      socket.emit("actionSuccess", { message: "전투가 시작되었습니다." });
    });

    socket.on("adminPause", ({ battleId }) => {
      const b = getBattle(battleId);
      if (!b || b.status !== "active") return;
      b.status = "paused";
      pushLog(b, "일시정지");
      broadcast(io, battleId);
    });

    socket.on("adminResume", ({ battleId }) => {
      const b = getBattle(battleId);
      if (!b || b.status !== "paused") return;
      b.status = "active";
      pushLog(b, "재개");
      broadcast(io, battleId);
    });

    socket.on("adminEnd", ({ battleId }) => {
      const b = getBattle(battleId);
      if (!b) return;
      b.status = "ended";
      pushLog(b, "전투 종료");
      broadcast(io, battleId);
    });

    /* ===== 플레이어 행동 ===== */
    socket.on("playerAction", (payload) => {
      const { battleId, actorId } = payload || {};
      const b = getBattle(battleId);
      if (!b || b.status !== "active") return;

      // 엔진으로 처리
      const engine = new BattleEngine(b);
      const result = engine.resolve(payload);

      // HP 적용
      if (result?.updates?.hp) {
        for (const [id, hp] of Object.entries(result.updates.hp)) {
          const target = (b.players || []).find(x => x.id === id);
          if (target) target.hp = hp;
        }
      }
      // 로그
      (result?.logs || []).forEach(l => {
        b.log.push({ type: l.type || "system", message: l.message || "", ts: Date.now() });
      });

      // 라운드/페이즈 결과는 battle.turn에 이미 반영됨
      broadcast(io, battleId);
      socket.emit("actionSuccess", { message: "행동 처리 완료" });
    });

    /* ===== 연결 종료 ===== */
    socket.on("disconnect", () => {
      sockets.delete(socket.id);
    });
  });

  return io;
}

module.exports = { installSocketHandlers };
