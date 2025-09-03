// packages/battle-server/src/utils/otp.js
// 간단한 메모리 기반 OTP 유틸리티

function now() { return Date.now(); }

function generateOtp(minutes = 30) {
  const token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  const exp = now() + minutes * 60 * 1000;
  return { token, exp };
}

function verifyOtp(mapOrSet, token) {
  if (!token) return false;
  if (mapOrSet instanceof Map) {
    const v = mapOrSet.get(token);
    return !!(v && v.exp > now());
  }
  if (mapOrSet instanceof Set) {
    // Set은 verify 후 삭제 사용 권장
    return mapOrSet.has(token);
  }
  return false;
}

function pruneExpired(playerOtpMap) {
  for (const [k, v] of playerOtpMap.entries()) {
    if (!v || v.exp <= now()) playerOtpMap.delete(k);
  }
}

function pruneSpectators(b) {
  // spectator OTP는 Set(token) 구조라 만료 스캔 생략(연결 시 1회용 삭제)
  return b;
}

module.exports = {
  generateOtp,
  verifyOtp,
  pruneExpired,
  pruneSpectators
};
