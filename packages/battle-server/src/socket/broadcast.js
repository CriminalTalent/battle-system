// packages/battle-server/src/socket/broadcast.js
'use strict';

/**
 * 브로드캐스트 유틸 모음 (전투 로직 없음)
 * - 소켓 이벤트만 내보냅니다.
 * - 신/구 이벤트명을 모두 지원합니다.
 *
 * 사용 예)
 *   import { broadcastBattle, broadcastLog, broadcastEnded } from './broadcast.js';
 *   broadcastBattle(io, battle); // 상태 전체
 *   broadcastLog(io, battle.id, { type:'system', message:'라운드 시작' });
 *   broadcastEnded(io, battle.id, { winner:'A' });
 */

/* =========================
 *  공통: 방(배틀) 단위 송신
 * ========================= */
function room(io, battleId) {
  return io.to(String(battleId));
}

/* =========================
 *  상태/진행 브로드캐스트
 * ========================= */
/**
 * battle 상태 전체를 브로드캐스트합니다.
 * - 신: "battle:update"
 * - 구: "battleUpdate"
 * @param {import('socket.io').Server} io
 * @param {Object} battle  전체 배틀 객체(직렬화 가능한 형태)
 * @param {Object} [extra] 추가로 붙여 보낼 메타(예: { turn })
 */
export function broadcastBattle(io, battle, extra = {}) {
  if (!io || !battle || !battle.id) return;
  const payload = { ...battle, ...extra };
  room(io, battle.id).emit('battle:update', payload);
  room(io, battle.id).emit('battleUpdate', payload);
}

/**
 * 관리자 패널에만 델타/메타를 전송합니다.
 * - 신: "admin:update"
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {Object} data  { battle?, ... }
 */
export function broadcastAdmin(io, battleId, data) {
  if (!io || !battleId) return;
  room(io, battleId).emit('admin:update', data);
}

/**
 * 전투 종료 알림 (승자/무승부)
 * - 신: "battle:ended"
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {Object} result  { winner: "A" | "B" | "draw" | null, reason?: string }
 */
export function broadcastEnded(io, battleId, result) {
  if (!io || !battleId) return;
  room(io, battleId).emit('battle:ended', result || {});
}

/* =========================
 *  로그/채팅/관전자 카운트
 * ========================= */
/**
 * 전투 로그 1건 브로드캐스트
 * - 신: "battle:log"
 * - 구: "battleLog"
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {Object} entry { type, message, ts, ... }
 */
export function broadcastLog(io, battleId, entry) {
  if (!io || !battleId || !entry) return;
  room(io, battleId).emit('battle:log', entry);
  room(io, battleId).emit('battleLog', entry);
}

/**
 * 채팅 메시지 브로드캐스트
 * - 구: "chatMessage" (클라이언트 호환용 유지)
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {Object} msg { senderName, message, timestamp? }
 */
export function broadcastChat(io, battleId, msg) {
  if (!io || !battleId || !msg || !msg.message) return;
  room(io, battleId).emit('chatMessage', {
    senderName: msg.senderName || '익명',
    message: msg.message,
    timestamp: msg.timestamp || Date.now()
  });
}

/**
 * 관전자 수 갱신
 * - 신: "spectator:count_update"
 * - 구: "spectatorCountUpdate"
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {number} count
 */
export function broadcastSpectatorCount(io, battleId, count) {
  if (!io || !battleId || typeof count !== 'number') return;
  const payload = { count };
  room(io, battleId).emit('spectator:count_update', payload);
  room(io, battleId).emit('spectatorCountUpdate', payload);
}

/* =========================
 *  턴/페이즈 힌트(선택)
 * ========================= */
/**
 * 현재 턴(행동자/팀) 힌트
 * - 신: "turn:start"
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {Object} data { playerId?: string, phaseTeam?: "A"|"B", round?: number, order?: ["A"|"B","A"|"B"] }
 */
export function broadcastTurnStart(io, battleId, data) {
  if (!io || !battleId) return;
  room(io, battleId).emit('turn:start', data || {});
}

/**
 * 턴 종료 알림
 * - 신: "turn:end"
 * @param {import('socket.io').Server} io
 * @param {string} battleId
 * @param {Object} data { teamPhaseCompleted?: boolean, roundCompleted?: boolean, currentTeam?: "A"|"B" }
 */
export function broadcastTurnEnd(io, battleId, data) {
  if (!io || !battleId) return;
  room(io, battleId).emit('turn:end', data || {});
}

export default {
  broadcastBattle,
  broadcastAdmin,
  broadcastEnded,
  broadcastLog,
  broadcastChat,
  broadcastSpectatorCount,
  broadcastTurnStart,
  broadcastTurnEnd
};
