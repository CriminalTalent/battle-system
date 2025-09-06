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
    //
