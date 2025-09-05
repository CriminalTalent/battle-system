// packages/battle-server/src/utils/OTPManager.js
// PYXIS OTP Manager - Enhanced Design Version
// 보안 강화, 역할별 관리, 자동 정리, 상세 로깅

const crypto = require('crypto');
const EventEmitter = require('events');

class OTPManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 설정 옵션
    this.config = {
      maxSpectators: options.maxSpectators || 30,
      maxPlayers: options.maxPlayers || 8,
      maxAdmins: options.maxAdmins || 3,
      otpLength: options.otpLength || 6,
      cleanupInterval: options.cleanupInterval || 5 * 60 * 1000, // 5분
      defaultTTL: {
        spectator: 30 * 60 * 1000,    // 30분
        player: 2 * 60 * 60 * 1000,   // 2시간
        admin: 24 * 60 * 60 * 1000    // 24시간
      },
      rateLimiting: {
        maxAttemptsPerIP: 10,
        windowMs: 15 * 60 * 1000      // 15분
      },
      ...options
    };
    
    // 저장소
    this.otpStore = new Map(); // otp -> { type, data, expiresAt, createdAt, usage }
    this.ipAttempts = new Map(); // ip -> { attempts, resetAt }
    this.battleOTPs = new Map(); // battleId -> Set<otp>
    this.userOTPs = new Map();   // userId -> Set<otp>
    
    // 통계
    this.stats = {
      generated: 0,
      validated: 0,
      expired: 0,
      failed: 0,
      cleaned: 0
    };
    
    // 자동 정리 타이머
    this.cleanupTimer = setInterval(() => {
      this.clearExpired();
    }, this.config.cleanupInterval);
    
    this.log('OTPManager 초기화 완료', 'INFO', this.config);
  }

  // ─────────────────────────────────────────────
  // 로깅 헬퍼
  // ─────────────────────────────────────────────
  
  log(message, level = 'INFO', data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}][OTPManager][${level}] ${message}`;
    
    if (level === 'ERROR') {
      console.error(logMessage, data || '');
    } else if (level === 'WARN') {
      console.warn(logMessage, data || '');
    } else {
      console.log(logMessage, data || '');
    }
    
    // 이벤트 발생
    this.emit('log', { message, level, data, timestamp });
  }

  // ─────────────────────────────────────────────
  // Rate Limiting
  // ─────────────────────────────────────────────
  
  checkRateLimit(ip) {
    const now = Date.now();
    const attempt = this.ipAttempts.get(ip);
    
    if (!attempt) {
      this.ipAttempts.set(ip, {
        attempts: 1,
        resetAt: now + this.config.rateLimiting.windowMs
      });
      return true;
    }
    
    if (now > attempt.resetAt) {
      // 윈도우 리셋
      attempt.attempts = 1;
      attempt.resetAt = now + this.config.rateLimiting.windowMs;
      return true;
    }
    
    if (attempt.attempts >= this.config.rateLimiting.maxAttemptsPerIP) {
      this.log(`Rate limit 초과`, 'WARN', { ip, attempts: attempt.attempts });
      return false;
    }
    
    attempt.attempts++;
    return true;
  }

  // ─────────────────────────────────────────────
  // OTP 생성 (역할별)
  // ─────────────────────────────────────────────
  
  generateOTP(type, data, options = {}) {
    try {
      // 타입별 개수 제한 확인
      const currentCount = this.getCountByType(type);
      const maxCount = this.getMaxCountByType(type);
      
      if (currentCount >= maxCount) {
        this.log(`OTP 생성 한도 초과`, 'WARN', { type, currentCount, maxCount });
        return null;
      }
      
      // Rate limiting 확인 (IP가 제공된 경우)
      if (options.ip && !this.checkRateLimit(options.ip)) {
        return null;
      }
      
      // 중복되지 않는 OTP 생성
      let otp;
      let attempts = 0;
      const maxAttempts = 10;
      
      do {
        otp = this.generateSecureOTP();
        attempts++;
        
        if (attempts >= maxAttempts) {
          this.log('OTP 생성 최대 시도 횟수 초과', 'ERROR', { attempts });
          return null;
        }
      } while (this.otpStore.has(otp));
      
      // TTL 설정
      const ttl = options.ttl || this.config.defaultTTL[type] || this.config.defaultTTL.spectator;
      const expiresAt = Date.now() + ttl;
      const createdAt = Date.now();
      
      // OTP 저장
      const otpData = {
        type,
        data: { ...data },
        expiresAt,
        createdAt,
        usage: {
          attempts: 0,
          lastUsed: null,
          ip: options.ip || null
        }
      };
      
      this.otpStore.set(otp, otpData);
      
      // 인덱스 업데이트
      this.updateIndexes(otp, otpData);
      
      // 통계 업데이트
      this.stats.generated++;
      
      this.log('OTP 생성 성공', 'INFO', { 
        type, 
        otp: otp.substring(0, 2) + '****', 
        expiresIn: ttl,
        totalCount: this.otpStore.size 
      });
      
      // 이벤트 발생
      this.emit('generated', { type, otp, data, expiresAt });
      
      return otp;
      
    } catch (error) {
      this.log('OTP 생성 실패', 'ERROR', error);
      return null;
    }
  }
  
  // 보안 OTP 생성
  generateSecureOTP() {
    const length = this.config.otpLength;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    
    // crypto.randomBytes 사용하여 안전한 랜덤 생성
    const bytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    
    return result;
  }
  
  // 타입별 최대 개수 반환
  getMaxCountByType(type) {
    switch (type) {
      case 'spectator': return this.config.maxSpectators;
      case 'player': return this.config.maxPlayers;
      case 'admin': return this.config.maxAdmins;
      default: return 0;
    }
  }
  
  // 타입별 현재 개수 반환
  getCountByType(type) {
    let count = 0;
    for (const [otp, data] of this.otpStore.entries()) {
      if (data.type === type && Date.now() <= data.expiresAt) {
        count++;
      }
    }
    return count;
  }

  // ─────────────────────────────────────────────
  // OTP 검증 (강화된 보안)
  // ─────────────────────────────────────────────
  
  validateOTP(otp, options = {}) {
    try {
      // Rate limiting 확인
      if (options.ip && !this.checkRateLimit(options.ip)) {
        this.stats.failed++;
        return { valid: false, reason: 'rate_limit' };
      }
      
      const otpData = this.otpStore.get(otp);
      
      if (!otpData) {
        this.log('존재하지 않는 OTP', 'WARN', { otp: otp.substring(0, 2) + '****' });
        this.stats.failed++;
        return { valid: false, reason: 'not_found' };
      }
      
      // 만료 확인
      if (Date.now() > otpData.expiresAt) {
        this.log('만료된 OTP', 'WARN', { otp: otp.substring(0, 2) + '****' });
        this.otpStore.delete(otp);
        this.removeFromIndexes(otp, otpData);
        this.stats.expired++;
        return { valid: false, reason: 'expired' };
      }
      
      // 사용 횟수 업데이트
      otpData.usage.attempts++;
      otpData.usage.lastUsed = Date.now();
      if (options.ip) otpData.usage.ip = options.ip;
      
      // 통계 업데이트
      this.stats.validated++;
      
      this.log('OTP 검증 성공', 'INFO', { 
        type: otpData.type,
        otp: otp.substring(0, 2) + '****',
        attempts: otpData.usage.attempts 
      });
      
      // 이벤트 발생
      this.emit('validated', { otp, type: otpData.type, data: otpData.data });
      
      return { 
        valid: true, 
        type: otpData.type,
        data: otpData.data,
        usage: otpData.usage
      };
      
    } catch (error) {
      this.log('OTP 검증 오류', 'ERROR', error);
      this.stats.failed++;
      return { valid: false, reason: 'error' };
    }
  }

  // ─────────────────────────────────────────────
  // 데이터 조회
  // ─────────────────────────────────────────────
  
  getData(otp) {
    const otpData = this.otpStore.get(otp);
    return otpData ? { ...otpData.data } : null;
  }
  
  getType(otp) {
    const otpData = this.otpStore.get(otp);
    return otpData ? otpData.type : null;
  }
  
  getUsageInfo(otp) {
    const otpData = this.otpStore.get(otp);
    return otpData ? { ...otpData.usage } : null;
  }
  
  getExpirationTime(otp) {
    const otpData = this.otpStore.get(otp);
    return otpData ? otpData.expiresAt : null;
  }
  
  isExpired(otp) {
    const otpData = this.otpStore.get(otp);
    return otpData ? Date.now() > otpData.expiresAt : true;
  }

  // ─────────────────────────────────────────────
  // 인덱스 관리
  // ─────────────────────────────────────────────
  
  updateIndexes(otp, otpData) {
    // 전투별 인덱스
    if (otpData.data.battleId) {
      if (!this.battleOTPs.has(otpData.data.battleId)) {
        this.battleOTPs.set(otpData.data.battleId, new Set());
      }
      this.battleOTPs.get(otpData.data.battleId).add(otp);
    }
    
    // 사용자별 인덱스
    if (otpData.data.userId || otpData.data.playerId || otpData.data.nickname) {
      const userId = otpData.data.userId || otpData.data.playerId || otpData.data.nickname;
      if (!this.userOTPs.has(userId)) {
        this.userOTPs.set(userId, new Set());
      }
      this.userOTPs.get(userId).add(otp);
    }
  }
  
  removeFromIndexes(otp, otpData) {
    // 전투별 인덱스에서 제거
    if (otpData.data.battleId) {
      const battleOTPs = this.battleOTPs.get(otpData.data.battleId);
      if (battleOTPs) {
        battleOTPs.delete(otp);
        if (battleOTPs.size === 0) {
          this.battleOTPs.delete(otpData.data.battleId);
        }
      }
    }
    
    // 사용자별 인덱스에서 제거
    if (otpData.data.userId || otpData.data.playerId || otpData.data.nickname) {
      const userId = otpData.data.userId || otpData.data.playerId || otpData.data.nickname;
      const userOTPs = this.userOTPs.get(userId);
      if (userOTPs) {
        userOTPs.delete(otp);
        if (userOTPs.size === 0) {
          this.userOTPs.delete(userId);
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  // 조회 메서드
  // ─────────────────────────────────────────────
  
  getOTPsByBattle(battleId) {
    const otps = this.battleOTPs.get(battleId);
    if (!otps) return [];
    
    return Array.from(otps)
      .filter(otp => this.otpStore.has(otp) && !this.isExpired(otp))
      .map(otp => ({
        otp: otp.substring(0, 2) + '****',
        type: this.getType(otp),
        data: this.getData(otp),
        usage: this.getUsageInfo(otp)
      }));
  }
  
  getOTPsByUser(userId) {
    const otps = this.userOTPs.get(userId);
    if (!otps) return [];
    
    return Array.from(otps)
      .filter(otp => this.otpStore.has(otp) && !this.isExpired(otp))
      .map(otp => ({
        otp: otp.substring(0, 2) + '****',
        type: this.getType(otp),
        data: this.getData(otp),
        usage: this.getUsageInfo(otp)
      }));
  }
  
  getOTPsByType(type) {
    const result = [];
    for (const [otp, otpData] of this.otpStore.entries()) {
      if (otpData.type === type && !this.isExpired(otp)) {
        result.push({
          otp: otp.substring(0, 2) + '****',
          data: otpData.data,
          usage: otpData.usage,
          expiresAt: otpData.expiresAt
        });
      }
    }
    return result;
  }

  // ─────────────────────────────────────────────
  // 정리 및 관리
  // ─────────────────────────────────────────────
  
  clearExpired() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [otp, otpData] of this.otpStore.entries()) {
      if (now > otpData.expiresAt) {
        this.otpStore.delete(otp);
        this.removeFromIndexes(otp, otpData);
        cleanedCount++;
      }
    }
    
    // IP 시도 기록도 정리
    for (const [ip, attempt] of this.ipAttempts.entries()) {
      if (now > attempt.resetAt) {
        this.ipAttempts.delete(ip);
      }
    }
    
    if (cleanedCount > 0) {
      this.stats.cleaned += cleanedCount;
      this.log('만료된 OTP 정리 완료', 'INFO', { 
        cleanedCount, 
        remainingCount: this.otpStore.size 
      });
      
      // 이벤트 발생
      this.emit('cleaned', { cleanedCount, remainingCount: this.otpStore.size });
    }
  }
  
  clearByBattle(battleId) {
    const otps = this.battleOTPs.get(battleId);
    if (!otps) return 0;
    
    let cleanedCount = 0;
    for (const otp of otps) {
      const otpData = this.otpStore.get(otp);
      if (otpData) {
        this.otpStore.delete(otp);
        this.removeFromIndexes(otp, otpData);
        cleanedCount++;
      }
    }
    
    this.log('전투별 OTP 정리 완료', 'INFO', { battleId, cleanedCount });
    return cleanedCount;
  }
  
  clearByUser(userId) {
    const otps = this.userOTPs.get(userId);
    if (!otps) return 0;
    
    let cleanedCount = 0;
    for (const otp of otps) {
      const otpData = this.otpStore.get(otp);
      if (otpData) {
        this.otpStore.delete(otp);
        this.removeFromIndexes(otp, otpData);
        cleanedCount++;
      }
    }
    
    this.log('사용자별 OTP 정리 완료', 'INFO', { userId, cleanedCount });
    return cleanedCount;
  }
  
  clearAll() {
    const totalCount = this.otpStore.size;
    this.otpStore.clear();
    this.battleOTPs.clear();
    this.userOTPs.clear();
    this.ipAttempts.clear();
    
    this.log('모든 OTP 정리 완료', 'INFO', { totalCount });
    
    // 이벤트 발생
    this.emit('cleared', { totalCount });
    
    return totalCount;
  }
  
  revokeOTP(otp) {
    const otpData = this.otpStore.get(otp);
    if (!otpData) return false;
    
    this.otpStore.delete(otp);
    this.removeFromIndexes(otp, otpData);
    
    this.log('OTP 취소', 'INFO', { 
      otp: otp.substring(0, 2) + '****',
      type: otpData.type 
    });
    
    // 이벤트 발생
    this.emit('revoked', { otp, type: otpData.type, data: otpData.data });
    
    return true;
  }

  // ─────────────────────────────────────────────
  // 통계 및 모니터링
  // ─────────────────────────────────────────────
  
  getStats() {
    return {
      ...this.stats,
      current: {
        total: this.otpStore.size,
        spectators: this.getCountByType('spectator'),
        players: this.getCountByType('player'),
        admins: this.getCountByType('admin')
      },
      limits: {
        maxSpectators: this.config.maxSpectators,
        maxPlayers: this.config.maxPlayers,
        maxAdmins: this.config.maxAdmins
      },
      memory: {
        otpStore: this.otpStore.size,
        battleOTPs: this.battleOTPs.size,
        userOTPs: this.userOTPs.size,
        ipAttempts: this.ipAttempts.size
      }
    };
  }
  
  getDetailedInfo() {
    const now = Date.now();
    const otps = [];
    
    for (const [otp, otpData] of this.otpStore.entries()) {
      otps.push({
        otp: otp.substring(0, 2) + '****',
        type: otpData.type,
        data: otpData.data,
        createdAt: otpData.createdAt,
        expiresAt: otpData.expiresAt,
        expiresIn: Math.max(0, otpData.expiresAt - now),
        usage: otpData.usage,
        isExpired: now > otpData.expiresAt
      });
    }
    
    return {
      stats: this.getStats(),
      otps: otps.sort((a, b) => b.createdAt - a.createdAt),
      config: this.config
    };
  }

  // ─────────────────────────────────────────────
  // 정리 및 소멸자
  // ─────────────────────────────────────────────
  
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    this.clearAll();
    this.removeAllListeners();
    
    this.log('OTPManager 종료', 'INFO');
  }
}

module.exports = OTPManager;
