// packages/battle-server/src/socket/broadcast.js
'use strict';

/**
 * 브로드캐스트 유틸 모음 (전투 로직 없음)
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
 * battle 상태 전체 브로드캐스트
 * - 신: "battle:update"
 * - 구: "battleUpdate"
 */
export function broadcastBattle(io, battle, extra = {}) {
  if (!io || !battle || !battle.id) return;
  const payload = { ...battle, ...extra };
  room(io, battle.id).emit('battle:update', payload);
  room(io, battle.id).emit('battleUpdate', payload);
}

/**
 * 관리자 패널 전용 메타/델타
 * - 신: "admin:update"
 */
export function broadcastAdmin(io, battleId, data) {
  if (!io || !battleId) return;
  room(io, battleId).emit('admin:update', data);
}

/**
 * 전투 종료 알림
 * - 신: "battle:ended"
 */
export function broadcastEnded(io, battleId, result) {
  if (!io || !battleId) return;
  room(io, battleId).emit('battle:ended', result || {});
}

/* =========================
 *  로그/채팅/관전자 카운트
 * ========================= */
/**
 * 전투 로그 1건
 * - 신: "battle:log"
 * - 구: "battleLog"
 */
export function broadcastLog(io, battleId, entry) {
  if (!io || !battleId || !entry) return;
  room(io, battleId).emit('battle:log', entry);
  room(io, battleId).emit('battleLog', entry);
}

/**
 * 채팅 메시지
 * - 신: "battle:chat"
 * - 구: "chatMessage"
 *  (양쪽 모두 송신해서 socket-manager / 기존 admin.js 둘 다 호환)
 */
export function broadcastChat(io, battleId, msg) {
  if (!io || !battleId || !msg || !msg.message) return;

  const payload = {
    name: msg.name || msg.senderName || '익명',
    senderName: msg.senderName || msg.name || '익명',
    message: msg.message,
    timestamp: msg.timestamp || Date.now()
  };

  // 새 클라이언트용
  room(io, battleId).emit('battle:chat', payload);
  // 레거시 호환
  room(io, battleId).emit('chatMessage', payload);
}

/**
 * 관전자 수 갱신
 * - 신: "spectator:count"    ← socket-manager가 청취
 * - 보조: "spectator:count_update", "spectatorCountUpdate" (레거시 호환)
 */
export function broadcastSpectatorCount(io, battleId, count) {
  if (!io || !battleId || typeof count !== 'number') return;
  const payload = { count: Number(count) || 0 };
  room(io, battleId).emit('spectator:count', payload);           // 신
  room(io, battleId).emit('spectator:count_update', payload);    // 구(신규 구형 혼재)
  room(io, battleId).emit('spectatorCountUpdate', payload);      // 구
}

/* =========================
 *  턴/페이즈 힌트(선택)
 * ========================= */
/**
 * 현재 턴 시작 힌트
 * - 신: "turn:start"
 */
export function broadcastTurnStart(io, battleId, data) {
  if (!io || !battleId) return;
  room(io, battleId).emit('turn:start', data || {});
}

/**
 * 턴 종료 힌트
 * - 신: "turn:end"
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
