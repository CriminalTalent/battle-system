// packages/battle-server/src/utils/TimerManager.js
// PYXIS Timer Manager - Enhanced Design Version
// 정밀한 시간 관리, 이벤트 시스템, 상태 추적, 자동 백업(옵션), pause/resume 정확도 개선

'use strict';

const EventEmitter = require('events');

class TimerManager extends EventEmitter {
  /**
   * @param {string} battleId
   * @param {object} callbacks
   * @param {object} options
   */
  constructor(battleId, callbacks = {}, options = {}) {
    super();

    this.battleId = battleId;

    // 콜백(필요한 것만 넣어도 됨)
    this.callbacks = {
      onBattleEnd: callbacks.onBattleEnd || (() => {}),
      onPlayerTimeout: callbacks.onPlayerTimeout || (() => {}),
      onTurnWarning: callbacks.onTurnWarning || (() => {}),
      onBattleWarning: callbacks.onBattleWarning || (() => {}),
      onAutoSave: callbacks.onAutoSave || null, // (state) => {}
      ...callbacks,
    };

    // 설정
    this.config = {
      battleDuration: 60 * 60 * 1000,   // 1시간
      playerTurnTimeout: 5 * 60 * 1000, // 5분
      warningThreshold: 0.8,            // 80% 경과 시 1회 경고
      warningPercents: [],              // 추가 경고 지점(예: [0.5, 0.9])
      tickInterval: 1000,               // 1초마다 tick
      enableWarnings: true,
      enableAutoSave: true,
      autoSaveIntervalMs: 30 * 1000,    // 30초마다 자동 백업 이벤트
      precision: 'millisecond',         // 'second' | 'millisecond'
      unrefTimers: true,                // 타임아웃/인터벌이 종료를 막지 않도록
      ...options,
    };

    // ── Battle 타이머 상태 (deadline 기반으로 일관 계산)
    this._battle = {
      startAt: null,           // number | null
      endAt: null,             // number | null (종료 시점)
      deadlineAt: null,        // number | null (종료 예정 시각)
      paused: false,
      pauseStartedAt: null,    // number | null
      remainingAtPauseMs: 0,
      totalPlannedMs: null,    // 시작 시 duration 스냅샷(연장 시 가산)
      warnedPercents: new Set()
    };

    // ── Player 타이머 상태 (playerId -> timerInfo)
    // timerInfo: { startAt, deadlineAt, totalMs, warned, timer, paused?, pauseStartedAt?, remainingAtPauseMs? }
    this.playerTimers = new Map();
    // 별도 호환용(기존 코드에서 사용): pause된 타이머 목록
    // pausedTimers: playerId -> { remaining, duration, warned }
    this.pausedTimers = new Map();

    // 통계
    this.stats = {
      battleTimeouts: 0,
      playerTimeouts: 0,
      warningsIssued: 0,
      pauseCount: 0,
      totalPausedTime: 0
    };

    // 틱/오토세이브 인터벌
    this.tickTimer = null;
    this.autoSaveTimer = null;
    if (this.config.tickInterval > 0) this._startTicker();
    if (this.config.enableAutoSave && this.callbacks.onAutoSave) this._startAutoSave();

    this.log('TimerManager 초기화 완료', 'INFO', { battleId, config: this.config });
  }

  // ─────────────────────────────────────────────
  // 로깅/유틸
  // ─────────────────────────────────────────────

  log(message, level = 'INFO', data = null) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}][TimerManager][${this.battleId}][${level}] ${message}`;
    if (level === 'ERROR') console.error(line, data || '');
    else if (level === 'WARN') console.warn(line, data || '');
    else console.log(line, data || '');
    this.emit('log', { message, level, data, timestamp, battleId: this.battleId });
  }

  _now() {
    return Date.now();
  }

  _applyPrecision(ms) {
    if (this.config.precision === 'second') {
      return Math.max(0, Math.round(ms / 1000) * 1000);
    }
    return Math.max(0, ms);
  }

  _setTimeout(handler, ms) {
    const t = setTimeout(handler, ms);
    if (this.config.unrefTimers && t.unref) t.unref();
    return t;
  }

  _setInterval(handler, ms) {
    const t = setInterval(handler, ms);
    if (this.config.unrefTimers && t.unref) t.unref();
    return t;
  }

  // ─────────────────────────────────────────────
  // Ticker / AutoSave
  // ─────────────────────────────────────────────

  _startTicker() {
    if (this.tickTimer) return;
    this.tickTimer = this._setInterval(() => this._tick(), this.config.tickInterval);
  }

  _stopTicker() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  _startAutoSave() {
    if (this.autoSaveTimer || !this.callbacks.onAutoSave) return;
    this.autoSaveTimer = this._setInterval(() => {
      try {
        const state = this.exportState();
        this.callbacks.onAutoSave(state);
        this.emit('autosave', { battleId: this.battleId, state });
      } catch (err) {
        this.log('자동 백업(onAutoSave) 오류', 'ERROR', err);
      }
    }, this.config.autoSaveIntervalMs);
  }

  _stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  _tick() {
    const now = this._now();

    // 전투 틱
    if (this.isBattleActive() && !this.isBattlePaused()) {
      const remaining = this.getBattleRemainingTime();
      const elapsed = this.getBattleElapsedTime();
      const total = this._battle.totalPlannedMs || this.config.battleDuration;

      // 경고 체크(한 번만 발화) — warningThreshold + 추가 퍼센트
      if (this.config.enableWarnings && total > 0 && remaining > 0) {
        const progress = elapsed / total; // 0~1
        const marks = [this.config.warningThreshold, ...(this.config.warningPercents || [])]
          .filter((x) => typeof x === 'number' && x > 0 && x < 1);

        for (const p of marks) {
          if (progress >= p && !this._battle.warnedPercents.has(p)) {
            this._battle.warnedPercents.add(p);
            this._issueBattleWarning(remaining, p);
          }
        }
      }

      this.emit('tick', {
        type: 'battle',
        elapsed: this._applyPrecision(elapsed),
        remaining: this._applyPrecision(remaining),
        progress: total ? Math.min(1, elapsed / total) : 0
      });
    }

    // 플레이어 틱
    for (const [playerId, info] of this.playerTimers.entries()) {
      if (!info.startAt || !info.deadlineAt) continue;
      const remaining = info.deadlineAt - now;
      const elapsed = info.totalMs - Math.max(0, remaining);
      const progress = info.totalMs ? Math.min(1, elapsed / info.totalMs) : 0;

      if (this.config.enableWarnings && remaining > 0 && !info.warned) {
        if (progress >= this.config.warningThreshold) {
          this._issuePlayerWarning(playerId, remaining);
          info.warned = true;
        }
      }

      this.emit('tick', {
        type: 'player',
        playerId,
        elapsed: this._applyPrecision(elapsed),
        remaining: this._applyPrecision(Math.max(0, remaining)),
        progress
      });
    }
  }

  // ─────────────────────────────────────────────
  // 전투 타이머
  // ─────────────────────────────────────────────

  startBattleTimer(duration = null) {
    const d = typeof duration === 'number' && duration > 0 ? duration : this.config.battleDuration;
    this._clearBattleTimeout(); // 기존 타임아웃만 제거(상태는 새로 세팅)

    const now = this._now();
    this._battle.startAt = now;
    this._battle.endAt = null;
    this._battle.deadlineAt = now + d;
    this._battle.paused = false;
    this._battle.pauseStartedAt = null;
    this._battle.remainingAtPauseMs = 0;
    this._battle.totalPlannedMs = d;
    this._battle.warnedPercents.clear();

    this._battle.timer = this._setTimeout(() => this._handleBattleTimeout(), d);

    this.log('전투 타이머 시작', 'INFO', {
      duration: d,
      endsAt: new Date(this._battle.deadlineAt).toISOString()
    });

    this.emit('battleTimer:started', {
      duration: d,
      startTime: this._battle.startAt,
      endsAt: this._battle.deadlineAt
    });

    return this._battle.startAt;
  }

  _clearBattleTimeout() {
    if (this._battle?.timer) {
      clearTimeout(this._battle.timer);
      this._battle.timer = null;
    }
  }

  clearBattleTimer() {
    // 완전 정리(종료) — 외부에서 명시적으로 호출할 때 사용
    this._clearBattleTimeout();
    if (this._battle.startAt && !this._battle.endAt) {
      this._battle.endAt = this._now();
    }
    this.log('전투 타이머 정리', 'INFO');
  }

  pauseBattleTimer() {
    if (!this.isBattleActive() || this.isBattlePaused()) return false;

    const now = this._now();
    const remaining = this.getBattleRemainingTime(); // deadlineAt - now

    this._battle.paused = true;
    this._battle.pauseStartedAt = now;
    this._battle.remainingAtPauseMs = remaining;

    // 타임아웃만 제거 (endAt은 건드리지 않는다!)
    this._clearBattleTimeout();

    this.stats.pauseCount++;

    this.log('전투 타이머 일시정지', 'INFO', { remaining });
    this.emit('battleTimer:paused', { pausedAt: now, remaining });

    return true;
  }

  resumeBattleTimer() {
    if (!this.isBattlePaused()) return false;

    const now = this._now();
    const pausedDuration = now - (this._battle.pauseStartedAt || now);
    this.stats.totalPausedTime += pausedDuration;

    // 남은 시간 기준으로 deadline 재설정
    const remaining = Math.max(0, this._battle.remainingAtPauseMs || 0);
    this._battle.deadlineAt = now + remaining;

    this._battle.paused = false;
    this._battle.pauseStartedAt = null;
    this._battle.remainingAtPauseMs = 0;
    this._battle.endAt = null; // 재가동 시 종료타임 리셋

    if (remaining > 0) {
      this._battle.timer = this._setTimeout(() => this._handleBattleTimeout(), remaining);
    }

    this.log('전투 타이머 재개', 'INFO', {
      pausedDuration,
      remaining,
      totalPausedTime: this.stats.totalPausedTime
    });

    this.emit('battleTimer:resumed', {
      pausedDuration,
      remaining,
      totalPausedTime: this.stats.totalPausedTime
    });

    return true;
  }

  _handleBattleTimeout() {
    this._battle.endAt = this._now();
    this.stats.battleTimeouts++;

    this.log('전투 시간 만료', 'WARN', {
      duration: this.getBattleElapsedTime()
    });

    this.emit('battleTimer:timeout', {
      battleId: this.battleId,
      duration: this.getBattleElapsedTime()
    });

    try {
      this.callbacks.onBattleEnd(this.battleId, 'timeout');
    } catch (err) {
      this.log('전투 종료 콜백 오류', 'ERROR', err);
    }
  }

  _issueBattleWarning(remaining, atPercent) {
    this.stats.warningsIssued++;
    this.log('전투 시간 경고', 'WARN', { remaining, atPercent });

    this.emit('battleTimer:warning', {
      battleId: this.battleId,
      remaining,
      percentage: atPercent * 100
    });

    try {
      this.callbacks.onBattleWarning(this.battleId, remaining);
    } catch (err) {
      this.log('전투 경고 콜백 오류', 'ERROR', err);
    }
  }

  // ─────────────────────────────────────────────
  // 플레이어 타이머
  // ─────────────────────────────────────────────

  startPlayerTimer(playerId, timeout = null) {
    const total = typeof timeout === 'number' && timeout > 0 ? timeout : this.config.playerTurnTimeout;

    this.clearPlayerTimer(playerId);

    const now = this._now();
    const deadlineAt = now + total;
    const timer = this._setTimeout(() => this._handlePlayerTimeout(playerId), total);

    this.playerTimers.set(playerId, {
      startAt: now,
      deadlineAt,
      totalMs: total,
      warned: false,
      timer
    });

    this.log('플레이어 타이머 시작', 'INFO', {
      playerId,
      duration: total,
      endsAt: new Date(deadlineAt).toISOString()
    });

    this.emit('playerTimer:started', {
      playerId,
      duration: total,
      startTime: now,
      endsAt: deadlineAt
    });

    return now;
  }

  clearPlayerTimer(playerId) {
    const info = this.playerTimers.get(playerId);
    if (info?.timer) clearTimeout(info.timer);

    this.playerTimers.delete(playerId);
    this.pausedTimers.delete(playerId); // 호환 맵도 같이 정리

    this.emit('playerTimer:cleared', { playerId });
  }

  pausePlayerTimer(playerId) {
    const info = this.playerTimers.get(playerId);
    if (!info) return false;

    const now = this._now();
    const remaining = Math.max(0, info.deadlineAt - now);

    if (info.timer) clearTimeout(info.timer);

    // 내부 상태에 paused 반영
    info.paused = true;
    info.pauseStartedAt = now;
    info.remainingAtPauseMs = remaining;
    info.timer = null;

    // 호환용 맵 갱신
    this.pausedTimers.set(playerId, {
      remaining,
      duration: info.totalMs,
      warned: info.warned
    });

    // 활성 맵에서는 제거(기존 동작과 동일)
    this.playerTimers.delete(playerId);

    this.log('플레이어 타이머 일시정지', 'INFO', { playerId, remaining });
    this.emit('playerTimer:paused', { playerId, remaining });

    return true;
  }

  resumePlayerTimer(playerId) {
    const pausedInfo = this.pausedTimers.get(playerId);
    if (!pausedInfo) return false;

    const now = this._now();
    const remaining = Math.max(0, pausedInfo.remaining);
    const deadlineAt = now + remaining;
    const timer = this._setTimeout(() => this._handlePlayerTimeout(playerId), remaining);

    this.playerTimers.set(playerId, {
      startAt: now - (pausedInfo.duration - remaining), // 총 진행률 유지
      deadlineAt,
      totalMs: pausedInfo.duration,
      warned: pausedInfo.warned,
      timer
    });

    this.pausedTimers.delete(playerId);

    this.log('플레이어 타이머 재개', 'INFO', { playerId, remaining });
    this.emit('playerTimer:resumed', { playerId, remaining, startTime: now });

    return true;
  }

  extendPlayerTimer(playerId, additionalTime) {
    const add = Number(additionalTime) || 0;
    if (add <= 0) return false;

    // 실행 중
    const info = this.playerTimers.get(playerId);
    if (info) {
      const now = this._now();
      info.deadlineAt += add;
      info.totalMs += add;

      if (info.timer) clearTimeout(info.timer);
      const newRemaining = Math.max(0, info.deadlineAt - now);
      info.timer = this._setTimeout(() => this._handlePlayerTimeout(playerId), newRemaining);

      this.log('플레이어 타이머 연장', 'INFO', {
        playerId,
        additionalTime: add,
        newRemaining
      });

      this.emit('playerTimer:extended', { playerId, additionalTime: add, newRemaining });
      return true;
    }

    // 일시정지 중
    const p = this.pausedTimers.get(playerId);
    if (p) {
      p.remaining += add;
      p.duration += add;

      this.log('일시정지된 플레이어 타이머 연장', 'INFO', {
        playerId,
        additionalTime: add,
        newRemaining: p.remaining
      });

      this.emit('playerTimer:extended', { playerId, additionalTime: add, newRemaining: p.remaining });
      return true;
    }

    return false;
    }

  _handlePlayerTimeout(playerId) {
    this.clearPlayerTimer(playerId);
    this.stats.playerTimeouts++;

    this.log('플레이어 시간 만료', 'WARN', { playerId });

    this.emit('playerTimer:timeout', { playerId });

    try {
      this.callbacks.onPlayerTimeout(playerId);
    } catch (err) {
      this.log('플레이어 타임아웃 콜백 오류', 'ERROR', err);
    }
  }

  _issuePlayerWarning(playerId, remaining) {
    this.stats.warningsIssued++;
    this.log('플레이어 시간 경고', 'WARN', { playerId, remaining });

    this.emit('playerTimer:warning', { playerId, remaining });

    try {
      this.callbacks.onTurnWarning(playerId, remaining);
    } catch (err) {
      this.log('플레이어 경고 콜백 오류', 'ERROR', err);
    }
  }

  clearAllPlayerTimers() {
    for (const [, info] of this.playerTimers) {
      if (info.timer) clearTimeout(info.timer);
    }
    const clearedCount = this.playerTimers.size;
    this.playerTimers.clear();
    this.pausedTimers.clear();

    this.log('모든 플레이어 타이머 정리', 'INFO', { clearedCount });
    this.emit('playerTimers:cleared', { clearedPlayers: clearedCount });
  }

  // ─────────────────────────────────────────────
  // 상태 조회
  // ─────────────────────────────────────────────

  isBattleActive() {
    return !!(this._battle.startAt && !this._battle.endAt);
  }

  isBattlePaused() {
    return !!this._battle.paused;
  }

  getBattleRemainingTime() {
    if (!this.isBattleActive()) return 0;
    if (this.isBattlePaused()) return Math.max(0, this._battle.remainingAtPauseMs || 0);
    return Math.max(0, (this._battle.deadlineAt || 0) - this._now());
  }

  getBattleElapsedTime() {
    if (!this._battle.startAt) return 0;
    const total = this._battle.totalPlannedMs || this.config.battleDuration;
    const remaining = this.getBattleRemainingTime();
    const elapsed = Math.max(0, total - remaining);
    return elapsed;
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

  getPlayerRemainingTime(playerId) {
    const info = this.playerTimers.get(playerId);
    if (!info) return this.pausedTimers.get(playerId)?.remaining || 0;
    return Math.max(0, (info.deadlineAt || 0) - this._now());
  }

  getPlayerElapsedTime(playerId) {
    const info = this.playerTimers.get(playerId);
    if (info) {
      const remaining = Math.max(0, (info.deadlineAt || 0) - this._now());
      return Math.max(0, info.totalMs - remaining);
    }
    const paused = this.pausedTimers.get(playerId);
    if (paused) return Math.max(0, paused.duration - paused.remaining);
    return 0;
  }

  // ─────────────────────────────────────────────
  // 통계/리포트
  // ─────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      battle: {
        isActive: this.isBattleActive(),
        isPaused: this.isBattlePaused(),
        elapsed: this.getBattleElapsedTime(),
        remaining: this.getBattleRemainingTime(),
        startTime: this._battle.startAt,
        endTime: this._battle.endAt,
        plannedDuration: this._battle.totalPlannedMs || this.config.battleDuration
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
    const total = this._battle.totalPlannedMs || this.config.battleDuration;
    const elapsed = this.getBattleElapsedTime();
    const remaining = this.getBattleRemainingTime();

    const status = {
      battleId: this.battleId,
      config: this.config,
      stats: this.getStats(),
      timers: {
        battle: this.isBattleActive()
          ? {
              startTime: this._battle.startAt,
              duration: total,
              elapsed,
              remaining,
              isPaused: this.isBattlePaused(),
              progress: total ? elapsed / total : 0,
              endsAt: this.isBattlePaused()
                ? null
                : (this._battle.deadlineAt || null)
            }
          : null,
        players: []
      }
    };

    for (const [playerId, info] of this.playerTimers.entries()) {
      const rem = Math.max(0, (info.deadlineAt || 0) - this._now());
      const el = Math.max(0, info.totalMs - rem);
      status.timers.players.push({
        playerId,
        startTime: info.startAt,
        duration: info.totalMs,
        elapsed: el,
        remaining: rem,
        warned: info.warned,
        isPaused: false,
        progress: info.totalMs ? el / info.totalMs : 0,
        endsAt: info.deadlineAt
      });
    }

    for (const [playerId, paused] of this.pausedTimers.entries()) {
      status.timers.players.push({
        playerId,
        duration: paused.duration,
        remaining: paused.remaining,
        warned: paused.warned,
        isPaused: true,
        progress: paused.duration ? (paused.duration - paused.remaining) / paused.duration : 0,
        endsAt: null
      });
    }

    return status;
  }

  // ─────────────────────────────────────────────
  // 정리/소멸자
  // ─────────────────────────────────────────────

  clearAll() {
    this._stopTicker();
    this._stopAutoSave();

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

  // ─────────────────────────────────────────────
  // 상태 백업/복원
  // ─────────────────────────────────────────────

  exportState() {
    return {
      battleId: this.battleId,
      config: this.config,
      battle: {
        startAt: this._battle.startAt,
        endAt: this._battle.endAt,
        deadlineAt: this._battle.deadlineAt,
        paused: this._battle.paused,
        remainingAtPauseMs: this._battle.remainingAtPauseMs,
        totalPlannedMs: this._battle.totalPlannedMs,
        warnedPercents: Array.from(this._battle.warnedPercents || [])
      },
      stats: this.stats,
      activeTimers: Array.from(this.playerTimers.entries()).map(([playerId, i]) => ({
        playerId,
        startAt: i.startAt,
        deadlineAt: i.deadlineAt,
        totalMs: i.totalMs,
        warned: i.warned
      })),
      pausedTimers: Array.from(this.pausedTimers.entries()).map(([playerId, p]) => ({
        playerId,
        remaining: p.remaining,
        duration: p.duration,
        warned: p.warned
      }))
    };
  }

  importState(state) {
    if (!state || state.battleId !== this.battleId) {
      throw new Error('배틀 ID가 일치하지 않습니다');
    }

    // 기존 정리
    this.clearAll();

    // 설정/통계 복원(필요 시 일부만)
    this.stats = { ...this.stats, ...(state.stats || {}) };

    // 배틀 복원
    if (state.battle) {
      const b = state.battle;
      this._battle.startAt = b.startAt || null;
      this._battle.endAt = b.endAt || null;
      this._battle.deadlineAt = b.deadlineAt || null;
      this._battle.paused = !!b.paused;
      this._battle.pauseStartedAt = null;
      this._battle.remainingAtPauseMs = b.remainingAtPauseMs || 0;
      this._battle.totalPlannedMs = b.totalPlannedMs || this.config.battleDuration;
      this._battle.warnedPercents = new Set(b.warnedPercents || []);

      if (this.isBattleActive()) {
        if (this.isBattlePaused()) {
          // paused 상태면 타임아웃 예약하지 않음
        } else {
          const remaining = this.getBattleRemainingTime();
          if (remaining > 0) {
            this._battle.timer = this._setTimeout(() => this._handleBattleTimeout(), remaining);
          }
        }
      }
    }

    // 플레이어 복원
    if (Array.isArray(state.activeTimers)) {
      for (const t of state.activeTimers) {
        const now = this._now();
        const remaining = Math.max(0, (t.deadlineAt || now) - now);
        if (remaining > 0) {
          const timer = this._setTimeout(() => this._handlePlayerTimeout(t.playerId), remaining);
          this.playerTimers.set(t.playerId, {
            startAt: t.startAt || (now - ((t.totalMs || 0) - remaining)),
            deadlineAt: t.deadlineAt || (now + remaining),
            totalMs: t.totalMs || remaining,
            warned: !!t.warned,
            timer
          });
        }
      }
    }

    if (Array.isArray(state.pausedTimers)) {
      for (const p of state.pausedTimers) {
        this.pausedTimers.set(p.playerId, {
          remaining: p.remaining,
          duration: p.duration,
          warned: !!p.warned
        });
      }
    }

    // 틱/오토세이브 재가동
    if (this.config.tickInterval > 0) this._startTicker();
    if (this.config.enableAutoSave && this.callbacks.onAutoSave) this._startAutoSave();

    this.log('상태 복원 완료', 'INFO', {
      activeTimers: this.playerTimers.size,
      pausedTimers: this.pausedTimers.size
    });
  }
}

module.exports = TimerManager;
