// packages/battle-server/src/utils/battleCleanup.js
// ESM 모드
// - 전투 관련 OTP 일괄 정리 유틸리티
// - app.get('otp') 에서 OTPManager 인스턴스를 가져와 battleId 기준으로 폐기
// - 예외 상황을 한국어 사유로 반환

'use strict';

/**
 * 특정 전투에 발급된 OTP를 모두 정리합니다.
 * @param {import('express').Express} app Express 앱 인스턴스 (app.get('otp') 필요)
 * @param {string} battleId 전투 ID
 * @returns {{ ok: boolean, removed: number, reason?: string }}
 */
export function cleanupOTPsForBattle(app, battleId) {
  try {
    if (!app || typeof app.get !== 'function' || !battleId) {
      return { ok: false, removed: 0, reason: '유효하지 않은 인자입니다' };
    }

    const otpMgr = app.get('otp');
    if (!otpMgr || typeof otpMgr.clearByBattle !== 'function') {
      return { ok: false, removed: 0, reason: 'OTP 관리자 미초기화' };
    }

    const removed = Number(otpMgr.clearByBattle(battleId)) || 0;
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, removed: 0, reason: e?.message || '정리 중 오류 발생' };
  }
}

/**
 * 전투 종료 시 후처리를 한 번에 수행합니다.
 * 현재는 OTP 정리만 수행하지만, 필요 시 로그/타이머/소켓 등 추가 정리 로직을 확장할 수 있습니다.
 * @param {import('express').Express} app
 * @param {string} battleId
 * @returns {{ ok: boolean, steps: { otp: { ok: boolean, removed: number, reason?: string } } }}
 */
export function cleanupBattleResources(app, battleId) {
  const otp = cleanupOTPsForBattle(app, battleId);
  return {
    ok: otp.ok,
    steps: { otp }
  };
}

export default {
  cleanupOTPsForBattle,
  cleanupBattleResources
};
