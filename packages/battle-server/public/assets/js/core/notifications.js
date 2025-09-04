// PYXIS Notifications - Enhanced Gaming Alert System
// 게임다운 브라우저 알림 + 토스트 + 사운드 + 햅틱 통합 시스템
(function () {
  'use strict';

  class PyxisNotifications {
    constructor() {
      this.permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
      this.audioContext = null;
      this.masterGain = null;
      this.soundBuffers = new Map();
      this.enabled = true;
      this.soundEnabled = true;
      this.hapticEnabled = true;
      this.toastEnabled = true;
      this.masterVolume = 0.6;
      this.toastContainer = null;
      this.activeToasts = new Set();
      this.notificationQueue = [];
      this.isProcessing = false;
      
      // 알림 타입별 설정
      this.notificationTypes = {
        battle: {
          icon: '/assets/icons/sword.svg',
          color: '#DCC7A2',
          sound: 'battle',
          priority: 'high',
          vibration: [100, 50, 100]
        },
        turn: {
          icon: '/assets/icons/hourglass.svg',
          color: '#F59E0B',
          sound: 'urgent',
          priority: 'medium',
          vibration: [50, 100, 50, 100]
        },
        victory: {
          icon: '/assets/icons/crown.svg',
          color: '#22C55E',
          sound: 'victory',
          priority: 'high',
          vibration: [200, 100, 200, 100, 300]
        },
        defeat: {
          icon: '/assets/icons/skull.svg',
          color: '#EF4444',
          sound: 'defeat',
          priority: 'high',
          vibration: [300, 200, 300]
        },
        info: {
          icon: '/assets/icons/info.svg',
          color: '#3B82F6',
          sound: 'soft',
          priority: 'low',
          vibration: [30]
        },
        warning: {
          icon: '/assets/icons/warning.svg',
          color: '#F59E0B',
          sound: 'alert',
          priority: 'medium',
          vibration: [50, 50, 100]
        },
        error: {
          icon: '/assets/icons/error.svg',
          color: '#EF4444',
          sound: 'error',
          priority: 'high',
          vibration: [100, 100, 100, 100]
        }
      };

      this.init();
    }

    async init() {
      this.initAudioContext();
      this.createToastContainer();
      this.injectStyles();
      await this.loadSounds();
      this.setupEventListeners();
    }

    // 오디오 컨텍스트 초기화
    initAudioContext() {
      try {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.masterVolume;
        this.masterGain.connect(this.audioContext.destination);
      } catch (error) {
        console.warn('Audio context initialization failed:', error);
        this.soundEnabled = false;
      }
    }

    // 사운드 파일 로드
    async loadSounds() {
      if (!this.soundEnabled || !this.audioContext) return;

      const soundFiles = {
        battle: this.generateTone(800, 0.3, 'sine'),
        urgent: this.generateTone(1000, 0.2, 'triangle'),
        victory: this.generateChord([523, 659, 784], 0.8, 'sine'),
        defeat: this.generateTone(200, 0.6, 'sawtooth'),
        soft: this.generateTone(600, 0.15, 'sine'),
        alert: this.generateTone(900, 0.25, 'square'),
        error: this.generateTone(300, 0.4, 'sawtooth')
      };

      for (const [name, audioBuffer] of Object.entries(soundFiles)) {
        this.soundBuffers.set(name, audioBuffer);
      }
    }

    // 톤 생성
    generateTone(frequency, duration, type = 'sine') {
      if (!this.audioContext) return null;

      const sampleRate = this.audioContext.sampleRate;
      const length = sampleRate * duration;
      const buffer = this.audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        let sample = 0;

        switch (type) {
          case 'sine':
            sample = Math.sin(2 * Math.PI * frequency * t);
            break;
          case 'triangle':
            sample = 2 * Math.abs(2 * (t * frequency - Math.floor(t * frequency + 0.5))) - 1;
            break;
          case 'square':
            sample = Math.sign(Math.sin(2 * Math.PI * frequency * t));
            break;
          case 'sawtooth':
            sample = 2 * (t * frequency - Math.floor(t * frequency + 0.5));
            break;
        }

        // 페이드 인/아웃
        const fadeTime = 0.05;
        if (t < fadeTime) {
          sample *= t / fadeTime;
        } else if (t > duration - fadeTime) {
          sample *= (duration - t) / fadeTime;
        }

        data[i] = sample * 0.3;
      }

      return buffer;
    }

    // 화음 생성
    generateChord(frequencies, duration, type = 'sine') {
      if (!this.audioContext) return null;

      const sampleRate = this.audioContext.sampleRate;
      const length = sampleRate * duration;
      const buffer = this.audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        let sample = 0;

        frequencies.forEach(freq => {
          sample += Math.sin(2 * Math.PI * freq * t);
        });

        sample /= frequencies.length;

        // 페이드 인/아웃
        const fadeTime = 0.1;
        if (t < fadeTime) {
          sample *= t / fadeTime;
        } else if (t > duration - fadeTime) {
          sample *= (duration - t) / fadeTime;
        }

        data[i] = sample * 0.4;
      }

      return buffer;
    }

    // 토스트 컨테이너 생성
    createToastContainer() {
      if (this.toastContainer) return;

      this.toastContainer = document.createElement('div');
      this.toastContainer.id = 'pyxis-toast-container';
      this.toastContainer.className = 'toast-container';
      document.body.appendChild(this.toastContainer);
    }

    // 스타일 주입
    injectStyles() {
      if (document.getElementById('pyxis-notifications-styles')) return;

      const styleSheet = document.createElement('style');
      styleSheet.id = 'pyxis-notifications-styles';
      styleSheet.textContent = `
        /* PYXIS Notifications - Gaming Alert System */
        
        .toast-container {
          position: fixed;
          top: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10000;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-width: 90vw;
          width: 100%;
          max-width: 480px;
        }

        .pyxis-toast {
          background: linear-gradient(
            145deg,
            rgba(0, 30, 53, 0.95) 0%,
            rgba(0, 42, 75, 0.9) 100%
          );
          backdrop-filter: blur(16px);
          border: 2px solid rgba(220, 199, 162, 0.3);
          border-radius: 16px;
          padding: 16px 20px;
          box-shadow: 
            0 8px 32px rgba(0, 8, 13, 0.6),
            0 0 0 1px rgba(220, 199, 162, 0.1),
            inset 0 1px 0 rgba(220, 199, 162, 0.2);
          color: #E2E8F0;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 12px;
          pointer-events: all;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateY(-20px);
          opacity: 0;
          animation: toastSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          position: relative;
          overflow: hidden;
        }

        .pyxis-toast::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            var(--toast-color, #DCC7A2) 50%,
            transparent 100%
          );
          opacity: 0.8;
        }

        .pyxis-toast:hover {
          transform: translateY(-2px);
          border-color: rgba(220, 199, 162, 0.5);
          box-shadow: 
            0 12px 40px rgba(0, 8, 13, 0.7),
            0 0 0 1px rgba(220, 199, 162, 0.2),
            0 0 20px rgba(220, 199, 162, 0.2);
        }

        @keyframes toastSlideIn {
          from {
            transform: translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes toastSlideOut {
          from {
            transform: translateY(0);
            opacity: 1;
          }
          to {
            transform: translateY(-20px);
            opacity: 0;
          }
        }

        .pyxis-toast.removing {
          animation: toastSlideOut 0.3s ease-in forwards;
        }

        .toast-icon {
          width: 24px;
          height: 24px;
          border-radius: 8px;
          background: var(--toast-color, #DCC7A2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          color: #00080D;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .toast-content {
          flex: 1;
          min-width: 0;
        }

        .toast-title {
          font-weight: 600;
          font-size: 15px;
          color: #DCC7A2;
          margin-bottom: 2px;
          line-height: 1.3;
        }

        .toast-message {
          color: #94A3B8;
          font-size: 13px;
          line-height: 1.4;
          opacity: 0.9;
        }

        .toast-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        .toast-btn {
          padding: 6px 12px;
          border: 1px solid rgba(220, 199, 162, 0.3);
          border-radius: 8px;
          background: rgba(220, 199, 162, 0.1);
          color: #DCC7A2;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .toast-btn:hover {
          background: rgba(220, 199, 162, 0.2);
          border-color: rgba(220, 199, 162, 0.5);
          transform: translateY(-1px);
        }

        .toast-btn.primary {
          background: linear-gradient(145deg, #DCC7A2, #D4BA8D);
          color: #00080D;
          border-color: #DCC7A2;
        }

        .toast-btn.primary:hover {
          background: linear-gradient(145deg, #D4BA8D, #DCC7A2);
          box-shadow: 0 4px 12px rgba(220, 199, 162, 0.3);
        }

        .toast-close {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 20px;
          height: 20px;
          border: none;
          background: rgba(220, 199, 162, 0.1);
          color: #94A3B8;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          opacity: 0.7;
        }

        .toast-close:hover {
          background: rgba(220, 199, 162, 0.2);
          color: #DCC7A2;
          opacity: 1;
        }

        .toast-progress {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 3px;
          background: var(--toast-color, #DCC7A2);
          border-radius: 0 0 14px 14px;
          transition: width 0.1s linear;
          opacity: 0.6;
        }

        /* 타입별 스타일링 */
        .pyxis-toast.battle {
          --toast-color: #DCC7A2;
        }

        .pyxis-toast.turn {
          --toast-color: #F59E0B;
        }

        .pyxis-toast.victory {
          --toast-color: #22C55E;
        }

        .pyxis-toast.defeat {
          --toast-color: #EF4444;
        }

        .pyxis-toast.info {
          --toast-color: #3B82F6;
        }

        .pyxis-toast.warning {
          --toast-color: #F59E0B;
        }

        .pyxis-toast.error {
          --toast-color: #EF4444;
        }

        /* 우선순위별 강조 */
        .pyxis-toast.priority-high {
          border-width: 3px;
          box-shadow: 
            0 12px 40px rgba(0, 8, 13, 0.8),
            0 0 30px rgba(220, 199, 162, 0.3);
        }

        .pyxis-toast.priority-high::before {
          height: 3px;
          opacity: 1;
        }

        /* 모바일 최적화 */
        @media (max-width: 768px) {
          .toast-container {
            top: 16px;
            max-width: 95vw;
          }

          .pyxis-toast {
            padding: 14px 16px;
            font-size: 13px;
          }

          .toast-icon {
            width: 20px;
            height: 20px;
            font-size: 12px;
          }

          .toast-title {
            font-size: 14px;
          }

          .toast-message {
            font-size: 12px;
          }
        }

        /* 애니메이션 감소 설정 */
        @media (prefers-reduced-motion: reduce) {
          .pyxis-toast {
            animation: none !important;
            transition: opacity 0.2s ease !important;
          }

          .pyxis-toast.removing {
            animation: none !important;
          }
        }

        /* 고대비 모드 */
        @media (prefers-contrast: high) {
          .pyxis-toast {
            border-width: 3px;
            background: rgba(0, 30, 53, 1);
          }
        }
      `;

      document.head.appendChild(styleSheet);
    }

    // 이벤트 리스너 설정
    setupEventListeners() {
      // 페이지 가시성 변경 감지
      document.addEventListener('visibilitychange', () => {
        this.handleVisibilityChange();
      });

      // 윈도우 포커스 이벤트
      window.addEventListener('focus', () => {
        this.clearQueuedNotifications();
      });
    }

    // 페이지 가시성 변경 처리
    handleVisibilityChange() {
      if (!document.hidden) {
        // 페이지가 보이게 되면 대기 중인 알림들 처리
        this.processNotificationQueue();
      }
    }

    // 권한 요청
    async requestPermission() {
      if (typeof Notification === 'undefined') {
        this.showToast('브라우저가 알림을 지원하지 않습니다', '', 'error');
        return 'denied';
      }

      if (Notification.permission === 'default') {
        try {
          const result = await Notification.requestPermission();
          this.permission = result;
          
          if (result === 'granted') {
            this.showToast('알림 권한이 허용되었습니다', '이제 탭 밖에서도 전투 알림을 받을 수 있어요', 'info');
          } else {
            this.showToast('알림 권한이 거부되었습니다', '토스트 알림만 표시됩니다', 'warning');
          }
          
          return result;
        } catch (error) {
          this.permission = 'denied';
          return 'denied';
        }
      } else {
        this.permission = Notification.permission;
        return this.permission;
      }
    }

    // 알림 가능 여부 확인
    canNotify() {
      return (typeof Notification !== 'undefined') && 
             this.permission === 'granted' && 
             this.enabled;
    }

    // 사운드 재생
    playSound(soundName) {
      if (!this.soundEnabled || !this.audioContext || !this.soundBuffers.has(soundName)) {
        return;
      }

      try {
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }

        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();

        source.buffer = this.soundBuffers.get(soundName);
        source.connect(gainNode);
        gainNode.connect(this.masterGain);

        gainNode.gain.value = this.masterVolume;
        source.start(0);
      } catch (error) {
        console.warn('Sound playback failed:', error);
      }
    }

    // 햅틱 피드백
    vibrate(pattern) {
      if (!this.hapticEnabled || !navigator.vibrate) return;
      
      try {
        navigator.vibrate(pattern);
      } catch (error) {
        console.warn('Vibration failed:', error);
      }
    }

    // 토스트 표시
    showToast(title, message = '', type = 'info', options = {}) {
      if (!this.toastEnabled) return null;

      const {
        duration = type === 'error' ? 8000 : 5000,
        actions = [],
        onClick = null,
        closable = true,
        persistent = false,
        priority = 'medium'
      } = options;

      const typeConfig = this.notificationTypes[type] || this.notificationTypes.info;
      const toast = document.createElement('div');
      const toastId = 'toast-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      toast.id = toastId;
      toast.className = `pyxis-toast ${type} priority-${priority}`;
      toast.style.setProperty('--toast-color', typeConfig.color);

      // 아이콘 결정
      const iconMap = {
        battle: '⚔️',
        turn: '⏰',
        victory: '👑',
        defeat: '💀',
        info: 'ℹ️',
        warning: '⚠️',
        error: '❌'
      };

      toast.innerHTML = `
        <div class="toast-icon">${iconMap[type] || 'ℹ️'}</div>
        <div class="toast-content">
          <div class="toast-title">${title}</div>
          ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
        ${actions.length > 0 ? `
          <div class="toast-actions">
            ${actions.map((action, index) => `
              <button class="toast-btn ${action.primary ? 'primary' : ''}" data-action="${index}">
                ${action.label}
              </button>
            `).join('')}
          </div>
        ` : ''}
        ${closable ? '<button class="toast-close" title="닫기">×</button>' : ''}
        ${!persistent ? '<div class="toast-progress"></div>' : ''}
      `;

      // 이벤트 리스너
      if (onClick) {
        toast.addEventListener('click', (e) => {
          if (e.target.classList.contains('toast-btn') || e.target.classList.contains('toast-close')) return;
          onClick(e);
        });
      }

      // 액션 버튼 이벤트
      actions.forEach((action, index) => {
        const btn = toast.querySelector(`[data-action="${index}"]`);
        if (btn) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (action.callback) action.callback();
            if (action.closeOnClick !== false) {
              this.removeToast(toastId);
            }
          });
        }
      });

      // 닫기 버튼 이벤트
      const closeBtn = toast.querySelector('.toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeToast(toastId);
        });
      }

      // 컨테이너에 추가
      this.toastContainer.appendChild(toast);
      this.activeToasts.add(toastId);

      // 사운드 및 햅틱
      this.playSound(typeConfig.sound);
      this.vibrate(typeConfig.vibration);

      // 프로그레스 바 애니메이션
      if (!persistent) {
        const progressBar = toast.querySelector('.toast-progress');
        if (progressBar) {
          progressBar.style.width = '100%';
          setTimeout(() => {
            progressBar.style.width = '0%';
            progressBar.style.transition = `width ${duration}ms linear`;
          }, 100);
        }

        // 자동 제거
        setTimeout(() => {
          this.removeToast(toastId);
        }, duration);
      }

      return toastId;
    }

    // 토스트 제거
    removeToast(toastId) {
      const toast = document.getElementById(toastId);
      if (!toast) return;

      toast.classList.add('removing');
      this.activeToasts.delete(toastId);

      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }

    // 모든 토스트 제거
    clearAllToasts() {
      this.activeToasts.forEach(toastId => {
        this.removeToast(toastId);
      });
    }

    // 브라우저 알림 표시
    notify(title, message = '', type = 'info', options = {}) {
      const {
        requireInteraction = false,
        onClick = null,
        tag = undefined,
        showToastFallback = true
      } = options;

      const typeConfig = this.notificationTypes[type] || this.notificationTypes.info;

      // 토스트는 항상 표시 (가시성 보장)
      if (showToastFallback) {
        this.showToast(title, message, type, options);
      }

      // 브라우저 알림
      if (this.canNotify()) {
        try {
          const notification = new Notification(title, {
            body: message,
            icon: typeConfig.icon,
            tag: tag,
            requireInteraction: requireInteraction,
            silent: !this.soundEnabled
          });

          if (onClick) {
            notification.onclick = (e) => {
              try { 
                onClick(e); 
              } catch (error) {
                console.warn('Notification click handler failed:', error);
              }
              window.focus();
              notification.close();
            };
          } else {
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          }

          return notification;
        } catch (error) {
          console.warn('Browser notification failed:', error);
          return null;
        }
      }

      return null;
    }

    // 탭이 숨겨져 있을 때만 알림
    notifyWhenHidden(title, message = '', type = 'info', options = {}) {
      if (document.hidden) {
        return this.notify(title, message, type, options);
      } else {
        // 페이지가 보이는 상태에서는 토스트만
        return this.showToast(title, message, type, options);
      }
    }

    // 지연 알림
    schedule(title, message = '', type = 'info', delayMs = 1000, options = {}) {
      return setTimeout(() => {
        this.notify(title, message, type, options);
      }, delayMs);
    }

    // 게임 특화 알림 메서드들
    battleStart(battleMode = '2v2') {
      return this.notify(
        '전투 시작!',
        `${battleMode} 전투가 시작되었습니다`,
        'battle',
        { requireInteraction: false }
      );
    }

    turnNotification(playerName, timeLeft = '05:00') {
      return this.notifyWhenHidden(
        `${playerName}의 차례`,
        `남은 시간: ${timeLeft}`,
        'turn',
        { requireInteraction: true }
      );
    }

    victoryNotification(teamName, details = '') {
      return this.notify(
        `${teamName} 승리!`,
        details,
        'victory',
        { 
          requireInteraction: true,
          onClick: () => window.focus()
        }
      );
    }

    defeatNotification(reason = '') {
      return this.notify(
        '전투 패배',
        reason,
        'defeat',
        { requireInteraction: true }
      );
    }

    playerJoined(playerName, team) {
      return this.showToast(
        '플레이어 참가',
        `${playerName}이 ${team}에 참가했습니다`,
        'info'
      );
    }

    playerLeft(playerName) {
      return this.showToast(
        '플레이어 이탈',
        `${playerName}이 전투를 떠났습니다`,
        'warning'
      );
    }

    connectionIssue(message = '연결 문제가 발생했습니다') {
      return this.showToast(
        '연결 오류',
        message,
        'error',
        { 
          persistent: true,
          actions: [
            {
              label: '재연결',
              primary: true,
              callback: () => window.location.reload(),
              closeOnClick: true
            }
          ]
        }
      );
    }

    // 대기열 관리
    addToQueue(notification) {
      this.notificationQueue.push(notification);
      if (!this.isProcessing) {
        this.processNotificationQueue();
      }
    }

    processNotificationQueue() {
      if (this.notificationQueue.length === 0) {
        this.isProcessing = false;
        return;
      }

      this.isProcessing = true;
      const notification = this.notificationQueue.shift();
      
      // 알림 실행
      this.notify(notification.title, notification.message, notification.type, notification.options);

      // 다음 알림을 위한 지연
      setTimeout(() => {
        this.processNotificationQueue();
      }, 500);
    }

    clearQueuedNotifications() {
      this.notificationQueue.length = 0;
      this.isProcessing = false;
    }

    // 설정 메서드들
    setEnabled(enabled) {
      this.enabled = !!enabled;
    }

    setSoundEnabled(enabled) {
      this.soundEnabled = !!enabled;
    }

    setHapticEnabled(enabled) {
      this.hapticEnabled = !!enabled;
    }

    setToastEnabled(enabled) {
      this.toastEnabled = !!enabled;
    }

    setMasterVolume(volume) {
      this.masterVolume = Math.max(0, Math.min(1, volume));
      if (this.masterGain) {
        this.masterGain.gain.value = this.masterVolume;
      }
    }

    // 현재 상태 정보
    getStatus() {
      return {
        permission: this.permission,
        enabled: this.enabled,
        soundEnabled: this.soundEnabled,
        hapticEnabled: this.hapticEnabled,
        toastEnabled: this.toastEnabled,
        masterVolume: this.masterVolume,
        activeToasts: this.activeToasts.size,
        queuedNotifications: this.notificationQueue.length,
        audioContextState: this.audioContext?.state || 'unavailable'
      };
    }

    // 테스트 메서드
    testNotifications() {
      console.log('Testing PYXIS Notifications...');
      
      setTimeout(() => this.battleStart('2v2'), 0);
      setTimeout(() => this.turnNotification('테스트 플레이어', '04:30'), 1000);
      setTimeout(() => this.playerJoined('새로운 전사', '불사조 기사단'), 2000);
      setTimeout(() => this.showToast('아이템 사용', '디터니로 체력을 회복했습니다', 'info'), 3000);
      setTimeout(() => this.showToast('경고', '턴 시간이 1분 남았습니다', 'warning'), 4000);
      setTimeout(() => this.victoryNotification('불사조 기사단', '압도적인 승리!'), 5000);
    }

    // 일괄 설정
    configure(config) {
      if (config.enabled !== undefined) this.setEnabled(config.enabled);
      if (config.soundEnabled !== undefined) this.setSoundEnabled(config.soundEnabled);
      if (config.hapticEnabled !== undefined) this.setHapticEnabled(config.hapticEnabled);
      if (config.toastEnabled !== undefined) this.setToastEnabled(config.toastEnabled);
      if (config.masterVolume !== undefined) this.setMasterVolume(config.masterVolume);
    }

    // 정리
    destroy() {
      // 타이머 정리
      this.notificationQueue.forEach(item => {
        if (item.timeoutId) clearTimeout(item.timeoutId);
      });
      this.notificationQueue.length = 0;

      // 토스트 정리
      this.clearAllToasts();
      
      if (this.toastContainer) {
        this.toastContainer.remove();
        this.toastContainer = null;
      }

      // 오디오 정리
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      // 사운드 버퍼 정리
      this.soundBuffers.clear();

      // 스타일시트 제거
      const styleSheet = document.getElementById('pyxis-notifications-styles');
      if (styleSheet) {
        styleSheet.remove();
      }

      console.log('PYXIS 알림 시스템이 정리되었습니다');
    }
  }

  // 전역 인스턴스 생성
  window.PyxisNotify = new PyxisNotifications();

  // 호환성을 위한 별칭
  window.Notifications = window.PyxisNotify;

  // DOM 로드 완료 후 초기화
  document.addEventListener('DOMContentLoaded', () => {
    // 권한 요청 안내 (강제하지 않음)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      window.PyxisNotify.showToast(
        '알림 설정',
        '브라우저 알림을 허용하면 탭 밖에서도 전투 상황을 확인할 수 있습니다',
        'info',
        {
          duration: 8000,
          actions: [
            {
              label: '허용',
              primary: true,
              callback: () => window.PyxisNotify.requestPermission()
            },
            {
              label: '나중에',
              callback: () => {}
            }
          ]
        }
      );
    }

    console.log('PYXIS 알림 시스템이 초기화되었습니다');
  });
  });

  // 페이지 언로드시 정리
  window.addEventListener('beforeunload', () => {
    window.PyxisNotify.destroy();
  });

})();
