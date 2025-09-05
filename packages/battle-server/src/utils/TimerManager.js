// packages/battle-server/src/utils/TimerManager.js
// PYXIS Timer Manager - Enhanced Design Version
// 정밀한 시간 관리, 이벤트 시스템, 상태 추적, 자동 백업

const EventEmitter = require('events');

class TimerManager extends EventEmitter {
  constructor(battleId, callbacks = {}, options = {}) {
    super();
    
    this.battleId = battleId;
    this.callbacks = {
      onBattleEnd: callbacks.onBattleEnd || (() => {}),
      onPlayerTimeout: callbacks.onPlayerTimeout || (() => {}),
      onTurnWarning: callbacks.onTurnWarning || (() => {}),
      onBattleWarning: callbacks.onBattleWarning || (() => {}),
      ...callbacks
    };
    
    // 설정 옵션
    this.config = {
      battleDuration: 60 * 60 * 1000,      // 1시간
      playerTurnTimeout: 5 * 60 * 1000,    // 5분
      warningThreshold: 0.8,               // 80% 경과시 경고
      tickInterval: 1000,                  // 1초마다 업데이트
      enableWarnings: true,
      enableAutoSave: true,
      precision: 'millisecond',            // 'second' | 'millisecond'
      ...options
    };
    
    // 타이머 상태
    this.battleTimer = null;
    this.playerTimers = new Map(); // playerId -> { timer, startTime, duration, warned }
    this.pausedTimers = new Map();  // 일시정지된 타이머들
    
    // 전투 시간 추적
    this.battleStartTime = null;
    this.battleEndTime = null;
    this.battlePaused = false;
    this.battlePausedDuration = 0;
    
    // 통계
    this.stats = {
      battleTimeouts: 0,
      playerTimeouts: 0,
      warningsIssued: 0,
      pauseCount: 0,
      totalPausedTime: 0
    };
    
    // 틱 타이머 (실시간 업데이트용)
    this.tickTimer = null;
    if (this.config.tickInterval > 0) {
      this.startTicker();
    }
    
    this.log('TimerManager 초기화 완료', 'INFO', { battleId, config: this.config });
  }

  // ─────────────────────────────────────────────
  // 로깅 헬퍼
  // ─────────────────────────────────────────────
  
  log(message, level = 'INFO', data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}][TimerManager][${this.battleId}][${level}] ${message}`;
    
    if (level === 'ERROR') {
      console.error(logMessage, data || '');
    } else if (level === 'WARN') {
      console.warn(logMessage, data || '');
    } else {
      console.log(logMessage, data || '');
    }
    
    // 이벤트 발생
    this.emit('log', { message, level, data, timestamp, battleId: this.battleId });
  }

  // ─────────────────────────────────────────────
  // 틱 시스템 (실시간 업데이트)
  // ─────────────────────────────────────────────
  
  startTicker() {
    if (this.tickTimer) return;
    
    this.tickTimer = setInterval(() => {
      this.tick();
    }, this.config.tickInterval);
  }
  
  stopTicker() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
  
  tick() {
    const now = Date.now();
    
    // 전투 시간 체크
    if (this.battleStartTime && !this.battlePaused && !this.battleEndTime) {
      const elapsed = this.getBattleElapsedTime();
      const remaining = this.config.battleDuration - elapsed;
      
      // 경고 체크
      if (this.config.enableWarnings && remaining > 0) {
        const progress = elapsed / this.config.battleDuration;
        if (progress >= this.config.warningThreshold && !this.battleWarningIssued) {
          this.issueBattleWarning(remaining);
        }
      }
      
      // 이벤트 발생 (매 틱)
      this.emit('tick', {
        type: 'battle',
        elapsed,
        remaining: Math.max(0, remaining),
        progress: Math.min(1, elapsed / this.config.battleDuration)
      });
    }
    
    // 플레이어 타이머 체크
    for (const [playerId, timerInfo] of this.playerTimers.entries()) {
      if (timerInfo.startTime) {
        const elapsed = now - timerInfo.startTime;
        const remaining = timerInfo.duration - elapsed;
        
        // 경고 체크
        if (this.config.enableWarnings && remaining > 0 && !timerInfo.warned) {
          const progress = elapsed / timerInfo.duration;
          if (progress >= this.config.warningThreshold) {
            this.issuePlayerWarning(playerId, remaining);
            timerInfo.warned = true;
          }
        }
        
        // 이벤트 발생
        this.emit('tick', {
          type: 'player',
          playerId,
          elapsed,
          remaining: Math.max(0, remaining),
          progress: Math.min(1, elapsed / timerInfo.duration)
        });
      }
    }
  }

  // ─────────────────────────────────────────────
  // 전투 타이머 관리
  // ─────────────────────────────────────────────
  
  startBattleTimer(duration = null) {
    const battleDuration = duration || this.config.battleDuration;
    
    this.clearBattleTimer();
    
    this.battleStartTime = Date.now();
    this.battleEndTime = null;
    this.battlePaused = false;
    this.battleWarningIssued = false;
    
    this.battleTimer = setTimeout(() => {
      this.handleBattleTimeout();
    }, battleDuration);
    
    this.log('전투 타이머 시작', 'INFO', { 
      duration: battleDuration,
      endsAt: new Date(Date.now() + battleDuration).toISOString()
    });
    
    // 이벤트 발생
    this.emit('battleTimer:started', {
      duration: battleDuration,
      startTime: this.battleStartTime,
      endsAt: this.battleStartTime + battleDuration
    });
    
    return this.battleStartTime;
  }
  
  clearBattleTimer() {
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
      this.battleTimer = null;
    }
    
    if (this.battleStartTime && !this.battleEndTime) {
      this.battleEndTime = Date.now();
    }
  }
  
  pauseBattleTimer() {
    if (!this.battleStartTime || this.battlePaused || this.battleEndTime) {
      return false;
    }
    
    this.battlePaused = true;
    this.battlePauseStartTime = Date.now();
    
    // 기존 타이머 정지
    this.clearBattleTimer();
    
    this.stats.pauseCount++;
    
    this.log('전투 타이머 일시정지', 'INFO');
    this.emit('battleTimer:paused', { pausedAt: this.battlePauseStartTime });
    
    return true;
  }
  
  resumeBattleTimer() {
    if (!this.battlePaused || !this.battlePauseStartTime) {
      return false;
    }
    
    // 일시정지 시간 누적
    const pausedDuration = Date.now() - this.battlePauseStartTime;
    this.battlePausedDuration += pausedDuration;
    this.stats.totalPausedTime += pausedDuration;
    
    this.battlePaused = false;
    this.battlePauseStartTime = null;
    
    // 남은 시간 계산하여 타이머 재시작
    const elapsed = this.getBattleElapsedTime();
    const remaining = this.config.battleDuration - elapsed;
    
    if (remaining > 0) {
      this.battleTimer = setTimeout(() => {
        this.handleBattleTimeout();
      }, remaining);
    }
    
    this.log('전투 타이머 재개', 'INFO', { 
      pausedDuration,
      remaining,
      totalPausedTime: this.battlePausedDuration
    });
    
    this.emit('battleTimer:resumed', { 
      pausedDuration,
      remaining,
      totalPausedTime: this.battlePausedDuration
    });
    
    return true;
  }
  
  handleBattleTimeout() {
    this.battleEndTime = Date.now();
    this.stats.battleTimeouts++;
    
    this.log('전투 시간 만료', 'WARN', { 
      duration: this.getBattleElapsedTime(),
      pausedTime: this.battlePausedDuration
    });
    
    // 이벤트 발생
    this.emit('battleTimer:timeout', {
      battleId: this.battleId,
      duration: this.getBattleElapsedTime(),
      pausedTime: this.battlePausedDuration
    });
    
    // 콜백 실행
    try {
      this.callbacks.onBattleEnd(this.battleId, 'timeout');
    } catch (error) {
      this.log('전투 종료 콜백 오류', 'ERROR', error);
    }
  }
  
  issueBattleWarning(remaining) {
    this.battleWarningIssued = true;
    this.stats.warningsIssued++;
    
    this.log('전투 시간 경고', 'WARN', { remaining });
    
    this.emit('battleTimer:warning', {
      battleId: this.battleId,
      remaining,
      percentage: (remaining / this.config.battleDuration) * 100
    });
    
    try {
      this.callbacks.onBattleWarning(this.battleId, remaining);
    } catch (error) {
      this.log('전투 경고 콜백 오류', 'ERROR', error);
    }
  }

  // ─────────────────────────────────────────────
  // 플레이어 타이머 관리
  // ─────────────────────────────────────────────
  
  startPlayerTimer(playerId, timeout = null) {
    const duration = timeout || this.config.playerTurnTimeout;
    
    this.clearPlayerTimer(playerId);
    
    const startTime = Date.now();
    const timer = setTimeout(() => {
      this.handlePlayerTimeout(playerId);
    }, duration);
    
    this.playerTimers.set(playerId, {
      timer,
      startTime,
      duration,
      warned: false
    });
    
    this.log('플레이어 타이머 시작', 'INFO', { 
      playerId,
      duration,
      endsAt: new Date(startTime + duration).toISOString()
    });
    
    // 이벤트 발생
    this.emit('playerTimer:started', {
      playerId,
      duration,
      startTime,
      endsAt: startTime + duration
    });
    
    return startTime;
  }
  
  clearPlayerTimer(playerId) {
    const timerInfo = this.playerTimers.get(playerId);
    if (timerInfo) {
      clearTimeout(timerInfo.timer);
      this.playerTimers.delete(playerId);
      
      // 이벤트 발생
      this.emit('playerTimer:cleared', { playerId });
    }
  }
  
  pausePlayerTimer(playerId) {
    const timerInfo = this.playerTimers.get(playerId);
    if (!timerInfo || !timerInfo.startTime) {
      return false;
    }
    
    // 현재 진행 상황 저장
    const elapsed = Date.now() - timerInfo.startTime;
    const remaining = timerInfo.duration - elapsed;
    
    clearTimeout(timerInfo.timer);
    
    this.pausedTimers.set(playerId, {
      remaining,
      duration: timerInfo.duration,
      warned: timerInfo.warned
    });
    
    this.playerTimers.delete(playerId);
    
    this.log('플레이어 타이머 일시정지', 'INFO', { playerId, remaining });
    this.emit('playerTimer:paused', { playerId, remaining });
    
    return true;
  }
  
  resumePlayerTimer(playerId) {
    const pausedInfo = this.pausedTimers.get(playerId);
    if (!pausedInfo) {
      return false;
    }
    
    const startTime = Date.now();
    const timer = setTimeout(() => {
      this.handlePlayerTimeout(playerId);
    }, pausedInfo.remaining);
    
    this.playerTimers.set(playerId, {
      timer,
      startTime,
      duration: pausedInfo.remaining, // 남은 시간이 새로운 duration
      warned: pausedInfo.warned
    });
    
    this.pausedTimers.delete(playerId);
    
    this.log('플레이어 타이머 재개', 'INFO', { 
      playerId, 
      remaining: pausedInfo.remaining 
    });
    
    this.emit('playerTimer:resumed', { 
      playerId, 
      remaining: pausedInfo.remaining,
      startTime
    });
    
    return true;
  }
  
  extendPlayerTimer(playerId, additionalTime) {
    const timerInfo = this.playerTimers.get(playerId);
    if (!timerInfo) {
      return false;
    }
    
    // 현재 타이머 중지
    clearTimeout(timerInfo.timer);
    
    // 남은 시간 계산
    const elapsed = Date.now() - timerInfo.startTime;
    const currentRemaining = timerInfo.duration - elapsed;
    const newRemaining = currentRemaining + additionalTime;
    
    // 새 타이머 시작
    const timer = setTimeout(() => {
      this.handlePlayerTimeout(playerId);
    }, newRemaining);
    
    timerInfo.timer = timer;
    timerInfo.duration = elapsed + newRemaining; // 전체 duration 업데이트
    
    this.log('플레이어 타이머 연장', 'INFO', { 
      playerId, 
      additionalTime,
      newRemaining
    });
    
    this.emit('playerTimer:extended', { 
      playerId, 
      additionalTime,
      newRemaining
    });
    
    return true;
  }
  
  handlePlayerTimeout(playerId) {
    this.clearPlayerTimer(playerId);
    this.stats.playerTimeouts++;
    
    this.log('플레이어 시간 만료', 'WARN', { playerId });
    
    // 이벤트 발생
    this.emit('playerTimer:timeout', { playerId });
    
    // 콜백 실행
    try {
      this.callbacks.onPlayerTimeout(playerId);
    } catch (error) {
      this.log('플레이어 타임아웃 콜백 오류', 'ERROR', error);
    }
  }
  
  issuePlayerWarning(playerId, remaining) {
    this.stats.warningsIssued++;
    
    this.log('플레이어 시간 경고', 'WARN', { playerId, remaining });
    
    this.emit('playerTimer:warning', { playerId, remaining });
    
    try {
      this.callbacks.onTurnWarning(playerId, remaining);
    } catch (error) {
      this.log('플레이어 경고 콜백 오류', 'ERROR', error);
    }
  }
  
  clearAllPlayerTimers() {
    const clearedPlayers = Array.from(this.playerTimers.keys());
    
    for (const [playerId, timerInfo] of this.playerTimers.entries()) {
      clearTimeout(timerInfo.timer);
    }
    
    this.playerTimers.clear();
    this.pausedTimers.clear();
    
    this.log('모든 플레이어 타이머 정리', 'INFO', { 
      clearedCount: clearedPlayers.length 
    });
    
    this.emit('playerTimers:cleared', { clearedPlayers });
  }

  // ─────────────────────────────────────────────
  // 상태 조회
  // ─────────────────────────────────────────────
  
  getBattleElapsedTime() {
    if (!this.battleStartTime) return 0;
    
    const endTime = this.battleEndTime || Date.now();
    const totalTime = endTime - this.battleStartTime;
    const actualTime = totalTime - this.battlePausedDuration;
    
    return Math.max(0, actualTime);
  }
  
  getBattleRemainingTime() {
    if (!this.battleStartTime || this.battleEndTime) return 0;
    
    const elapsed = this.getBattleElapsedTime();
    return Math.max(0, this.config.battleDuration - elapsed);
  }
  
  getPlayerElapsedTime(playerId) {
    const timerInfo = this.playerTimers.get(playerId);
    if (!timerInfo || !timerInfo.startTime) return 0;
    
    return Date.now() - timerInfo.startTime;
  }
  
  getPlayerRemainingTime(playerId) {
    const timerInfo = this.playerTimers.get(playerId);
    if (!timerInfo) return 0;
    
    const elapsed = this.getPlayerElapsedTime(playerId);
    return Math.max(0, timerInfo.duration - elapsed);
  }
  
  isBattleActive() {
    return !!(this.battleStartTime && !this.battleEndTime);
  }
  
  isBattlePaused() {
    return this.battlePaused;
  }
  
  isPlayerTimerActive(playerId) {
    return this.playerTimers.has(playerId);
  }
  
  isPlayerTimerPaused(playerId) {
    return this.pausedTimers.has(playerId);
  }
  
  getActivePlayerTimers() {
    return Array.from(this.playerTimers.keys());
  }
  
  getPausedPlayerTimers() {
    return Array.from(this.pausedTimers.keys());
  }

  // ─────────────────────────────────────────────
  // 통계 및 상태
  // ─────────────────────────────────────────────
  
  getStats() {
    return {
      ...this.stats,
      battle: {
        isActive: this.isBattleActive(),
        isPaused: this.isBattlePaused(),
        elapsed: this.getBattleElapsedTime(),
        remaining: this.getBattleRemainingTime(),
        startTime: this.battleStartTime,
        endTime: this.battleEndTime,
        pausedDuration: this.battlePausedDuration
      },
      players: {
        active: this.playerTimers.size,
        paused: this.pausedTimers.size,
        activeList: this.getActivePlayerTimers(),
        pausedList: this.getPausedPlayerTimers()
      }
    };
  }
  
  getDetailedStatus() {
    const status = {
      battleId: this.battleId,
      config: this.config,
      stats: this.getStats(),
      timers: {
        battle: null,
        players: []
      }
    };
    
    // 전투 타이머 상세 정보
    if (this.isBattleActive()) {
      status.timers.battle = {
        startTime: this.battleStartTime,
        duration: this.config.battleDuration,
        elapsed: this.getBattleElapsedTime(),
        remaining: this.getBattleRemainingTime(),
        isPaused: this.isBattlePaused(),
        pausedDuration: this.battlePausedDuration,
        progress: this.getBattleElapsedTime() / this.config.battleDuration
      };
    }
    
    // 플레이어 타이머 상세 정보
    for (const [playerId, timerInfo] of this.playerTimers.entries()) {
      const elapsed = this.getPlayerElapsedTime(playerId);
      const remaining = this.getPlayerRemainingTime(playerId);
      
      status.timers.players.push({
        playerId,
        startTime: timerInfo.startTime,
        duration: timerInfo.duration,
        elapsed,
        remaining,
        warned: timerInfo.warned,
        progress: elapsed / timerInfo.duration
      });
    }
    
    // 일시정지된 플레이어 타이머
    for (const [playerId, pausedInfo] of this.pausedTimers.entries()) {
      status.timers.players.push({
        playerId,
        duration: pausedInfo.duration,
        remaining: pausedInfo.remaining,
        warned: pausedInfo.warned,
        isPaused: true,
        progress: (pausedInfo.duration - pausedInfo.remaining) / pausedInfo.duration
      });
    }
    
    return status;
  }

  // ─────────────────────────────────────────────
  // 정리 및 소멸자
  // ─────────────────────────────────────────────
  
  clearAll() {
    this.stopTicker();
    this.clearBattleTimer();
    this.clearAllPlayerTimers();
    
    this.log('모든 타이머 정리 완료', 'INFO');
    this.emit('timers:cleared', { battleId: this.battleId });
  }
  
  destroy() {
    this.clearAll();
    this.removeAllListeners();
    
    this.log('TimerManager 종료', 'INFO');
  }
  
  // 백업용 상태 내보내기
  exportState() {
    return {
      battleId: this.battleId,
      config: this.config,
      battleStartTime: this.battleStartTime,
      battleEndTime: this.battleEndTime,
      battlePaused: this.battlePaused,
      battlePausedDuration: this.battlePausedDuration,
      stats: this.stats,
      activeTimers: Array.from(this.playerTimers.entries()).map(([playerId, info]) => ({
        playerId,
        startTime: info.startTime,
        duration: info.duration,
        warned: info.warned
      })),
      pausedTimers: Array.from(this.pausedTimers.entries()).map(([playerId, info]) => ({
        playerId,
        remaining: info.remaining,
        duration: info.duration,
        warned: info.warned
      }))
    };
  }
  
  // 백업에서 상태 복원
  importState(state) {
    if (state.battleId !== this.battleId) {
      throw new Error('배틀 ID가 일치하지 않습니다');
    }
    
    // 기존 타이머 정리
    this.clearAll();
    
    // 상태 복원
    this.battleStartTime = state.battleStartTime;
    this.battleEndTime = state.battleEndTime;
    this.battlePaused = state.battlePaused;
    this.battlePausedDuration = state.battlePausedDuration || 0;
    this.stats = { ...this.stats, ...state.stats };
    
    // 전투 타이머 복원
    if (state.battleStartTime && !state.battleEndTime) {
      const elapsed = this.getBattleElapsedTime();
      const remaining = this.config.battleDuration - elapsed;
      
      if (remaining > 0 && !state.battlePaused) {
        this.battleTimer = setTimeout(() => {
          this.handleBattleTimeout();
        }, remaining);
      }
    }
    
    // 플레이어 타이머 복원
    if (state.activeTimers) {
      state.activeTimers.forEach(timerData => {
        const elapsed = Date.now() - timerData.startTime;
        const remaining = timerData.duration - elapsed;
        
        if (remaining > 0) {
          this.startPlayerTimer(timerData.playerId, remaining);
          const timerInfo = this.playerTimers.get(timerData.playerId);
          if (timerInfo) {
            timerInfo.warned = timerData.warned;
          }
        }
      });
    }
    
    // 일시정지된 타이머 복원
    if (state.pausedTimers) {
      state.pausedTimers.forEach(pausedData => {
        this.pausedTimers.set(pausedData.playerId, {
          remaining: pausedData.remaining,
          duration: pausedData.duration,
          warned: pausedData.warned
        });
      });
    }
    
    this.log('상태 복원 완료', 'INFO', { 
      activeTimers: this.playerTimers.size,
      pausedTimers: this.pausedTimers.size
    });
  }
}

module.exports = TimerManager;
