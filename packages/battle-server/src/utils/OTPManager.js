// === PATCH: config 기본값만 수정 ===
this.config = {
  maxSpectators: options.maxSpectators || 30,
  maxPlayers: options.maxPlayers || 8,
  maxAdmins: options.maxAdmins || 3,
  otpLength: options.otpLength || 6,
  cleanupInterval: options.cleanupInterval || 5 * 60 * 1000, // 5분

  // 가이드 정합: TTL
  defaultTTL: {
    spectator: 30 * 60 * 1000, // 30분
    player:    30 * 60 * 1000, // 30분
    admin:     60 * 60 * 1000  // 60분
  },

  // 가이드 정합: 재사용/재발급 정책
  // - 관리자: 재사용 가능 → 사실상 무제한 사용(만료 전까지)
  // - 플레이어/관전자: 재발급 가능 → 사용횟수 제한 불필요
  defaultMaxUses: {
    spectator: Number.MAX_SAFE_INTEGER,
    player:    Number.MAX_SAFE_INTEGER,
    admin:     Number.MAX_SAFE_INTEGER
  },

  rateLimiting: {
    maxAttemptsPerIP: 10,
    windowMs: 15 * 60 * 1000 // 15분
  },
  ...options
};
