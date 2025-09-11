"use strict";

/**
 * broadcast.js
 * - 소켓 브로드캐스트 전용 유틸
 * - 전투 상태 계산/턴 로직은 엔진에서 처리하고, 이 모듈은 "보내기"만 담당
 *
 * 사용 예:
 *   const { wireBroadcast } = require("./broadcast");
 *   const bc = wireBroadcast(io);
 *   bc.join(socket, battle.id);
 *   bc.emitBattleUpdate(battle);
 *   bc.emitChat(battle.id, { sender, message });
 *   bc.pushLogAndBroadcast(battle, { type:"system", message:"라운드 종료" });
 */

function roomId(battleId) {
  return `battle:${battleId}`;
}

/** 공개용으로 정제된 플레이어 필드만 노출 */
function pickPlayerPublic(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    team: p.team,          // "phoenix" | "eaters"
    stats: {
      atk: p?.stats?.atk,
      def: p?.stats?.def,
      agi: p?.stats?.agi,
      luk: p?.stats?.luk,
    },
    hp: p.hp,
    ready: !!p.ready,
    avatarUrl: p.avatarUrl || null,
    // 필요 시 클라이언트에서만 쓰는 필드는 추가 금지 (토큰/OTP 등 민감정보 제외)
  };
}

/** 공개용 배틀 스냅샷 정제 */
function pickBattlePublic(battle) {
  if (!battle) return null;
  return {
    id: battle.id,
    mode: battle.mode,
    status: battle.status,            // waiting | active | paused | ended
    startedAt: battle.startedAt || null,
    endedAt: battle.endedAt || null,

    // 라운드/페이즈 기반이라면 그대로 전달 (UI가 참고)
    turn: battle.turn,
    current: battle.current,          // 레거시 호환(현재 페이즈 팀용)

    // 플레이어 목록은 공개 필드만
    players: (battle.players || []).map(pickPlayerPublic),

    // 최근 로그만 일부 전송(클라 부담 줄이기)
    log: Array.isArray(battle.log)
      ? battle.log.slice(-100)
      : [],
  };
}

/** 안전 로그 기록기 (엔진/핸들러에서 이미 pushLog가 있으면 그걸 쓰세요) */
function pushLog(battle, entry) {
  if (!battle || !entry) return;
  const logEntry = {
    type: entry.type || "system",
    message: entry.message || "",
    ts: Date.now(),
    ...entry,
  };
  battle.log = battle.log || [];
  battle.log.push(logEntry);
  if (battle.log.length > 500) {
    battle.log.splice(0, battle.log.length - 500);
  }
  return logEntry;
}

/** 브로드캐스트 유틸 묶음 */
function wireBroadcast(io) {
  if (!io) throw new Error("io instance is required");

  return {
    /** 소켓을 해당 배틀 룸에 참여시킴 */
    join(socket, battleId) {
      if (!socket || !battleId) return;
      socket.join(roomId(battleId));
    },

    /** 소켓을 해당 배틀 룸에서 퇴장 */
    leave(socket, battleId) {
      if (!socket || !battleId) return;
      socket.leave(roomId(battleId));
    },

    /** 배틀 전체 상태 스냅샷 브로드캐스트 */
    emitBattleUpdate(battle) {
      if (!battle) return;
      const pub = pickBattlePublic(battle);
      io.to(roomId(battle.id)).emit("battleUpdate", pub);
    },

    /** 특정 알림(시스템) */
    emitSystem(battleId, payload) {
      io.to(roomId(battleId)).emit("systemMessage", {
        ts: Date.now(),
        ...payload,
      });
    },

    /** 전투 로그를 새로 추가하고 브로드캐스트 */
    pushLogAndBroadcast(battle, entry) {
      const saved = pushLog(battle, entry);
      io.to(roomId(battle.id)).emit("logMessage", saved);
    },

    /** 채팅 메시지 브로드캐스트 (관리자/플레이어/관전자 공통) */
    emitChat(battleId, message) {
      // message: { senderRole:"admin|player|spectator", senderName, text }
      io.to(roomId(battleId)).emit("chatMessage", {
        ts: Date.now(),
        ...message,
      });
    },

    /** 응원 메시지(관전자 버튼 전용) */
    emitCheer(battleId, payload) {
      // payload: { spectatorName, cheerText }
      io.to(roomId(battleId)).emit("cheerMessage", {
        ts: Date.now(),
        ...payload,
      });
    },

    /** 라운드 결과/요약 브로드캐스트 */
    emitRoundResult(battle, summary) {
      // summary 예: { round: n, damageMatrix, koList, notes }
      io.to(roomId(battle.id)).emit("roundResult", {
        ts: Date.now(),
        ...summary,
      });
    },

    /** 에러/경고 */
    emitError(battleId, error) {
      io.to(roomId(battleId)).emit("errorMessage", {
        ts: Date.now(),
        message: (error && error.message) || String(error),
      });
    },
  };
}

module.exports = {
  wireBroadcast,
  roomId,
  pickBattlePublic,
  pickPlayerPublic,
  // pushLog는 엔진/핸들러에도 있을 수 있으므로 옵션으로 export
  pushLog,
};
