const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class TokenService {
  constructor(options = {}) {
    this.secret = options.secret || process.env.JWT_SECRET || this.generateSecret();
    this.usedTokens = new Set(); // 1회용 토큰 추적
    this.blacklistedTokens = new Set(); // 블랙리스트 토큰
    this.logger = options.logger || console;
    
    // 토큰 만료 시간 설정
    this.expirationTimes = {
      participant: options.participantExpiry || '15m',
      spectator: options.spectatorExpiry || '2h', 
      admin: options.adminExpiry || '24h',
      invite: options.inviteExpiry || '30m'
    };

    // 자동 정리 시작
    this.startCleanupProcess();
  }

  /**
   * 비밀 키 생성 (환경변수가 없는 경우)
   */
  generateSecret() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * 참가자용 초대 토큰 생성 (1회용)
   */
  generateParticipantToken(battleId, participantId, role, options = {}) {
    const tokenId = uuidv4();
    const payload = {
      type: 'participant',
      battleId,
      participantId,
      role, // 'A' or 'B'
      tokenId,
      isOneTime: true,
      iat: Math.floor(Date.now() / 1000),
      metadata: options.metadata || {}
    };

    const token = jwt.sign(payload, this.secret, { 
      expiresIn: options.expiresIn || this.expirationTimes.participant,
      issuer: options.issuer || 'battle-system',
      audience: options.audience || 'battle-participant'
    });

    this.logger.info(`Generated participant token for battle ${battleId}, role ${role}`);
    
    return {
      token,
      tokenId,
      expiresAt: this.calculateExpiration(options.expiresIn || this.expirationTimes.participant),
      url: this.generateParticipantUrl(token, options.baseUrl)
    };
  }

  /**
   * 관리자용 토큰 생성
   */
  generateAdminToken(adminId, permissions = [], options = {}) {
    const payload = {
      type: 'admin',
      adminId,
      permissions,
      isOneTime: false,
      iat: Math.floor(Date.now() / 1000),
      metadata: options.metadata || {}
    };

    const token = jwt.sign(payload, this.secret, { 
      expiresIn: options.expiresIn || this.expirationTimes.admin,
      issuer: options.issuer || 'battle-system',
      audience: options.audience || 'battle-admin'
    });

    this.logger.info(`Generated admin token for ${adminId}`);
    
    return {
      token,
      expiresAt: this.calculateExpiration(options.expiresIn || this.expirationTimes.admin)
    };
  }

  /**
   * 토큰 검증 및 디코드
   */
  verifyToken(token, options = {}) {
    try {
      // 블랙리스트 체크
      if (this.blacklistedTokens.has(token)) {
        return { 
          valid: false, 
          error: 'Token is blacklisted',
          code: 'TOKEN_BLACKLISTED'
        };
      }

      // JWT 검증
      const decoded = jwt.verify(token, this.secret, {
        issuer: options.issuer || 'battle-system',
        audience: options.audience
      });
      
      // 1회용 토큰 체크
      if (decoded.isOneTime && decoded.tokenId) {
        if (this.usedTokens.has(decoded.tokenId)) {
          return { 
            valid: false, 
            error: 'Token already used',
            code: 'TOKEN_ALREADY_USED'
          };
        }
        
        // 사용 표시 (실제 사용은 markTokenAsUsed에서)
        if (options.markAsUsed) {
          this.markTokenAsUsed(decoded.tokenId);
        }
      }

      // 추가 검증 로직
      const customValidation = this.customValidation(decoded, options);
      if (!customValidation.valid) {
        return customValidation;
      }

      return { 
        valid: true, 
        payload: decoded,
        tokenType: decoded.type
      };
      
    } catch (error) {
      let errorCode = 'TOKEN_INVALID';
      let errorMessage = 'Invalid token';
      
      if (error.name === 'TokenExpiredError') {
        errorCode = 'TOKEN_EXPIRED';
        errorMessage = 'Token expired';
      } else if (error.name === 'JsonWebTokenError') {
        errorCode = 'TOKEN_MALFORMED';
        errorMessage = 'Malformed token';
      } else if (error.name === 'NotBeforeError') {
        errorCode = 'TOKEN_NOT_ACTIVE';
        errorMessage = 'Token not active yet';
      }

      return { 
        valid: false, 
        error: errorMessage,
        code: errorCode,
        details: error.message
      };
    }
  }

  /**
   * 커스텀 검증 로직
   */
  customValidation(decoded, options = {}) {
    // 토큰 타입별 추가 검증
    switch (decoded.type) {
      case 'participant':
        if (!decoded.battleId || !decoded.participantId || !decoded.role) {
          return { 
            valid: false, 
            error: 'Missing required participant fields',
            code: 'INVALID_PARTICIPANT_TOKEN'
          };
        }
        break;
        
      case 'spectator':
        if (!decoded.battleId) {
          return { 
            valid: false, 
            error: 'Missing battle ID',
            code: 'INVALID_SPECTATOR_TOKEN'
          };
        }
        break;
        
      case 'admin':
        if (!decoded.adminId) {
          return { 
            valid: false, 
            error: 'Missing admin ID',
            code: 'INVALID_ADMIN_TOKEN'
          };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * 토큰을 사용 완료로 표시
   */
  markTokenAsUsed(tokenId) {
    this.usedTokens.add(tokenId);
    this.logger.debug(`Token marked as used: ${tokenId}`);
  }

  /**
   * 토큰을 블랙리스트에 추가
   */
  blacklistToken(token) {
    this.blacklistedTokens.add(token);
    this.logger.info(`Token blacklisted`);
  }

  /**
   * 토큰 만료 시간 계산
   */
  calculateExpiration(expiryString) {
    const now = Date.now();
    const match = expiryString.match(/^(\d+)([smhd])$/);
    
    if (!match) {
      return new Date(now + 15 * 60 * 1000); // 기본 15분
    }
    
    const [, amount, unit] = match;
    const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    
    return new Date(now + parseInt(amount) * multipliers[unit]);
  }

  /**
   * 참가자 URL 생성
   */
  generateParticipantUrl(token, baseUrl = '') {
    return `${baseUrl}/battle/${token}`;
  }

  /**
   * 관람자 URL 생성
   */
  generateSpectatorUrl(battleId, token = '', baseUrl = '') {
    if (token) {
      return `${baseUrl}/watch/${battleId}?token=${token}`;
    }
    return `${baseUrl}/watch/${battleId}`;
  }

  /**
   * 배치 토큰 생성 (관리자용)
   */
  generateBattleTokens(battleId, participantA, participantB, options = {}) {
    const tokens = {
      participantA: this.generateParticipantToken(
        battleId, 
        participantA.id, 
        'A', 
        { ...options, metadata: { name: participantA.name } }
      ),
      participantB: this.generateParticipantToken(
        battleId, 
        participantB.id, 
        'B', 
        { ...options, metadata: { name: participantB.name } }
      ),
      spectator: this.generateSpectatorToken(battleId, options)
    };

    this.logger.info(`Generated all tokens for battle ${battleId}`);
    return tokens;
  }

  /**
   * 정리 프로세스 시작
   */
  startCleanupProcess() {
    // 1시간마다 정리 실행
    const cleanupInterval = 60 * 60 * 1000;
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, cleanupInterval);

    this.logger.info('Token cleanup process started');
  }

  /**
   * 정리 프로세스 중지
   */
  stopCleanupProcess() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.logger.info('Token cleanup process stopped');
    }
  }

  /**
   * 메모리 정리 (오래된 토큰 ID 제거)
   */
  cleanup() {
    const beforeUsed = this.usedTokens.size;
    const beforeBlacklisted = this.blacklistedTokens.size;
    
    // 사용된 토큰 정리 (6시간 후)
    this.usedTokens.clear();
    
    // 블랙리스트 토큰 정리 (24시간 후)
    if (this.blacklistedTokens.size > 10000) {
      this.blacklistedTokens.clear();
    }
    
    this.lastCleanup = new Date();
    
    this.logger.debug(`Token cleanup completed. Used: ${beforeUsed} -> ${this.usedTokens.size}, Blacklisted: ${beforeBlacklisted} -> ${this.blacklistedTokens.size}`);
  }

  /**
   * 서비스 종료 시 정리
   */
  destroy() {
    this.stopCleanupProcess();
    this.usedTokens.clear();
    this.blacklistedTokens.clear();
    this.logger.info('TokenService destroyed');
  }
}

module.exports = TokenService;