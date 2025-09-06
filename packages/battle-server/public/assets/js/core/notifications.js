// PYXIS Notifications - Enhanced Gaming Alert System (Revised)
// - 브라우저 알림 + 토스트 + 사운드 + 햅틱 통합
// - ⚠️ Fix: 잘못된 중괄호/괄호 정리(구문 오류 제거), DOM 준비 전 body 접근 방지
// - 개선: 토스트 아이콘을 SVG로 표시(이모지 제거), 중복(tag) 알림 억제, 설정 로컬 스토리지 유지
// - 개선: 오디오 자동재생 정책 대응(첫 재생 시 resume 시도), 안전한 AudioContext 생성

(function () {
  'use strict';

  const LS_KEYS = {
    enabled:       'pyxis_notify_enabled',
    soundEnabled:  'pyxis_notify_sound_enabled',
    hapticEnabled: 'pyxis_notify_haptic_enabled',
    toastEnabled:  'pyxis_notify_toast_enabled',
    volume:        'pyxis_notify_master_volume'
  };

  class PyxisNotifications {
    constructor() {
      this.permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';

      // Audio
      this.audioContext = null;
      this.masterGain = null;
      this.soundBuffers = new Map();
      this.masterVolume = 0.6;

      // Flags
      this.enabled = true;
      this.soundEnabled = true;
      this.hapticEnabled = true;
      this.toastEnabled = true;

      // Toast
      this.toastContainer = null;
      this.activeToasts = new Set();

      // Queue
      this.notificationQueue = [];
      this.isProcessing = false;

      // Dedup
      this.activeTags = new Map(); // tag -> Notification or toastId

      // 알림 타입별 설정
      this.notificationTypes = {
        battle:  { icon: '/assets/icons/sword.svg',     color: '#DCC7A2', sound: 'battle',  priority: 'high',   vibration: [100, 50, 100] },
        turn:    { icon: '/assets/icons/hourglass.svg', color: '#F59E0B', sound: 'urgent',  priority: 'medium', vibration: [50, 100, 50, 100] },
        victory: { icon: '/assets/icons/crown.svg',     color: '#22C55E', sound: 'victory', priority: 'high',   vibration: [200, 100, 200, 100, 300] },
        defeat:  { icon: '/assets/icons/skull.svg',     color: '#EF4444', sound: 'defeat',  priority: 'high',   vibration: [300, 200, 300] },
        info:    { icon: '/assets/icons/info.svg',      color: '#3B82F6', sound: 'soft',    priority: 'low',    vibration: [30] },
        warning: { icon: '/assets/icons/warning.svg',   color: '#F59E0B', sound: 'alert',   priority: 'medium', vibration: [50, 50, 100] },
        error:   { icon: '/assets/icons/error.svg',     color: '#EF4444', sound: 'error',   priority: 'high',   vibration: [100, 100, 100, 100] }
      };

      this.init();
    }

    /* ===================== Init ===================== */
    async init() {
      this.restorePrefs();
      this.injectStyles();

      // AudioContext는 생성 실패 시 사운드 비활성화
      this.initAudioContext();

      // 사운드 버퍼(합성) 준비
      await this.loadSounds();

      // 토스트 컨테이너
      this.createToastContainer();

      // 이벤트
      this.setupEventListeners();
    }

    restorePrefs() {
      try {
        const e  = localStorage.getItem(LS_KEYS.enabled);
        const s  = localStorage.getItem(LS_KEYS.soundEnabled);
        const h  = localStorage.getItem(LS_KEYS.hapticEnabled);
        const t  = localStorage.getItem(LS_KEYS.toastEnabled);
        const mv = localStorage.getItem(LS_KEYS.volume);

        if (e !== null)  this.enabled       = e === '1';
        if (s !== null)  this.soundEnabled  = s === '1';
        if (h !== null)  this.hapticEnabled = h === '1';
        if (t !== null)  this.toastEnabled  = t === '1';
        if (mv !== null) this.masterVolume  = Math.max(0, Math.min(1, Number(mv)));
      } catch { /* ignore */ }
    }
    persistPrefs() {
      try {
        localStorage.setItem(LS_KEYS.enabled,       this.enabled ? '1' : '0');
        localStorage.setItem(LS_KEYS.soundEnabled,  this.soundEnabled ? '1' : '0');
        localStorage.setItem(LS_KEYS.hapticEnabled, this.hapticEnabled ? '1' : '0');
        localStorage.setItem(LS_KEYS.toastEnabled,  this.toastEnabled ? '1' : '0');
        localStorage.setItem(LS_KEYS.volume,        String(this.masterVolume));
      } catch { /* ignore */ }
    }

    /* ===================== Audio ===================== */
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

    async loadSounds() {
      if (!this.soundEnabled || !this.audioContext) return;
      const soundFiles = {
        battle:  this.generateTone(800, 0.3, 'sine'),
        urgent:  this.generateTone(1000, 0.2, 'triangle'),
        victory: this.generateChord([523, 659, 784], 0.8, 'sine'),
        defeat:  this.generateTone(200, 0.6, 'sawtooth'),
        soft:    this.generateTone(600, 0.15, 'sine'),
        alert:   this.generateTone(900, 0.25, 'square'),
        error:   this.generateTone(300, 0.4, 'sawtooth')
      };
      for (const [name, audioBuffer] of Object.entries(soundFiles)) {
        if (audioBuffer) this.soundBuffers.set(name, audioBuffer);
      }
    }

    generateTone(frequency, duration, type = 'sine') {
      if (!this.audioContext) return null;
      const sampleRate = this.audioContext.sampleRate;
      const length = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = this.audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        let sample = 0;
        switch (type) {
          case 'sine':     sample = Math.sin(2 * Math.PI * frequency * t); break;
          case 'triangle': sample = 2 * Math.abs(2 * (t * frequency - Math.floor(t * frequency + 0.5))) - 1; break;
          case 'square':   sample = Math.sign(Math.sin(2 * Math.PI * frequency * t)); break;
          case 'sawtooth': sample = 2 * (t * frequency - Math.floor(t * frequency + 0.5)); break;
        }
        // fade in/out
        const fade = Math.min(0.1, duration / 4);
        let amp = 1;
        if (t < fade) amp *= t / fade;
        if (t > duration - fade) amp *= (duration - t) / fade;
        data[i] = sample * 0.35 * amp;
      }
      return buffer;
    }

    generateChord(frequencies, duration, type = 'sine') {
      if (!this.audioContext) return null;
      const sampleRate = this.audioContext.sampleRate;
      const length = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = this.audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        let sample = 0;
        for (const f of frequencies) sample += Math.sin(2 * Math.PI * f * t);
        sample /= frequencies.length;
        const fade = Math.min(0.15, duration / 3);
        let amp = 1;
        if (t < fade) amp *= t / fade;
        if (t > duration - fade) amp *= (duration - t) / fade;
        data[i] = sample * 0.45 * amp;
      }
      return buffer;
    }

    playSound(soundName) {
      if (!this.soundEnabled || !this.audioContext || !this.soundBuffers.has(soundName)) return;
      try {
        if (this.audioContext.state === 'suspended') {
          // 사용자 제스처 이후 resume 성공 가능
          this.audioContext.resume().catch(()=>{});
        }
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        source.buffer = this.soundBuffers.get(soundName);
        source.connect(gainNode);
        gainNode.connect(this.masterGain);
        gainNode.gain.value = Math.max(0, Math.min(1, this.masterVolume));
        source.start(0);
      } catch (error) {
        console.warn('Sound playback failed:', error);
      }
    }

    vibrate(pattern) {
      if (!this.hapticEnabled || !navigator.vibrate) return;
      try { navigator.vibrate(pattern); } catch (error) { console.warn('Vibration failed:', error); }
    }

    /* ===================== Toast ===================== */
    createToastContainer() {
      const build = () => {
        if (this.toastContainer || !document.body) return;
        const el = document.createElement('div');
        el.id = 'pyxis-toast-container';
        el.className = 'toast-container';
        document.body.appendChild(el);
        this.toastContainer = el;
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build, { once: true });
      } else {
        build();
      }
    }

    showToast(title, message = '', type = 'info', options = {}) {
      if (!this.toastEnabled) return null;

      const {
        duration   = type === 'error' ? 8000 : 5000,
        actions    = [],
        onClick    = null,
        closable   = true,
        persistent = false,
        priority   = (this.notificationTypes[type]?.priority) || 'medium',
        tag        = undefined // 동일 tag면 기존 토스트 제거 후 대체
      } = options;

      // dedup by tag for toasts
      if (tag && this.activeTags.has(tag)) {
        const prev = this.activeTags.get(tag);
        if (typeof prev === 'string') this.removeToast(prev);
      }

      const typeCfg = this.notificationTypes[type] || this.notificationTypes.info;
      const toast = document.createElement('div');
      const toastId = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);

      toast.id = toastId;
      toast.className = `pyxis-toast ${type} priority-${priority}`;
      toast.style.setProperty('--toast-color', typeCfg.color);

      // SVG 아이콘 사용(이모지 제거)
      const iconHTML = `<img alt="" src="${typeCfg.icon}" class="toast-icon-img" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 6px rgba(0,0,0,.3))">`;

      toast.innerHTML = `
        <div class="toast-icon" aria-hidden="true">${iconHTML}</div>
        <div class="toast-content">
          <div class="toast-title">${this.escape(title)}</div>
          ${message ? `<div class="toast-message">${this.escape(message)}</div>` : ''}
        </div>
        ${actions.length ? `
          <div class="toast-actions">
            ${actions.map((a,i)=>`
              <button class="toast-btn ${a.primary ? 'primary' : ''}" data-action="${i}" type="button">${this.escape(a.label || 'OK')}</button>
            `).join('')}
          </div>` : ''}
        ${closable ? '<button class="toast-close" title="닫기" type="button">×</button>' : ''}
        ${!persistent ? '<div class="toast-progress"></div>' : ''}
      `;

      // 클릭 핸들러
      if (onClick) {
        toast.addEventListener('click', (e) => {
          const t = e.target;
          if (t.classList.contains('toast-btn') || t.classList.contains('toast-close')) return;
          try { onClick(e); } catch {}
        });
      }

      // 액션
      actions.forEach((action, i) => {
        const btn = toast.querySelector(`[data-action="${i}"]`);
        if (btn) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            try { action.callback && action.callback(); } catch {}
            if (action.closeOnClick !== false) this.removeToast(toastId);
          });
        }
      });

      // 닫기
      const closeBtn = toast.querySelector('.toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeToast(toastId);
        });
      }

      // 컨테이너 추가
      this.toastContainer || this.createToastContainer();
      this.toastContainer.appendChild(toast);
      this.activeToasts.add(toastId);
      if (tag) this.activeTags.set(tag, toastId);

      // 사운드/햅틱
      this.playSound(typeCfg.sound);
      this.vibrate(typeCfg.vibration);

      // 프로그레스/자동 제거
      if (!persistent) {
        const bar = toast.querySelector('.toast-progress');
        if (bar) {
          // next frame to trigger transition
          requestAnimationFrame(() => {
            bar.style.width = '100%';
            requestAnimationFrame(() => {
              bar.style.transition = `width ${duration}ms linear`;
              bar.style.width = '0%';
            });
          });
        }
        setTimeout(() => this.removeToast(toastId), duration);
      }

      return toastId;
    }

    removeToast(toastId) {
      const toast = document.getElementById(toastId);
      if (!toast) return;
      toast.classList.add('removing');
      this.activeToasts.delete(toastId);
      // tag 정리
      for (const [tag, val] of this.activeTags.entries()) {
        if (val === toastId) this.activeTags.delete(tag);
      }
      setTimeout(() => { toast.remove(); }, 300);
    }

    clearAllToasts() {
      [...this.activeToasts].forEach(id => this.removeToast(id));
    }

    /* ===================== Browser Notifications ===================== */
    async requestPermission() {
      if (typeof Notification === 'undefined') {
        this.showToast('브라우저가 알림을 지원하지 않습니다', '', 'error', { tag: 'notify-perm' });
        return 'denied';
      }
      if (Notification.permission === 'default') {
        try {
          const res = await Notification.requestPermission();
          this.permission = res;
          if (res === 'granted') {
            this.showToast('알림 권한 허용', '탭 밖에서도 전투 알림을 받을 수 있어요', 'info', { tag: 'notify-perm' });
          } else {
            this.showToast('알림 권한 거부', '토스트 알림만 표시됩니다', 'warning', { tag: 'notify-perm' });
          }
          return res;
        } catch {
          this.permission = 'denied';
          return 'denied';
        }
      } else {
        this.permission = Notification.permission;
        return this.permission;
      }
    }

    canNotify() {
      return (typeof Notification !== 'undefined') && this.permission === 'granted' && this.enabled;
    }

    notify(title, message = '', type = 'info', options = {}) {
      const {
        requireInteraction = false,
        onClick = null,
        tag = undefined,
        showToastFallback = true
      } = options;

      const cfg = this.notificationTypes[type] || this.notificationTypes.info;

      // 토스트는 항상(옵션 허용 시) 표시 — 가시성 보장
      if (showToastFallback) {
        this.showToast(title, message, type, { ...options, priority: cfg.priority });
      }

      if (!this.canNotify()) return null;

      // dedup by tag for browser notifications
      if (tag && this.activeTags.has(tag)) {
        const prev = this.activeTags.get(tag);
        if (prev && prev.close) { try { prev.close(); } catch {} }
      }

      try {
        const n = new Notification(title, {
          body: message,
          icon: cfg.icon,
          tag,
          requireInteraction,
          silent: !this.soundEnabled
        });
        if (onClick) {
          n.onclick = (e) => {
            try { onClick(e); } catch {}
            window.focus();
            n.close();
          };
        } else {
          n.onclick = () => { window.focus(); n.close(); };
        }
        if (tag) this.activeTags.set(tag, n);
        return n;
      } catch (error) {
        console.warn('Browser notification failed:', error);
        return null;
      }
    }

    notifyWhenHidden(title, message = '', type = 'info', options = {}) {
      if (document.hidden) {
        return this.notify(title, message, type, options);
      } else {
        return this.showToast(title, message, type, options);
      }
    }

    schedule(title, message = '', type = 'info', delayMs = 1000, options = {}) {
      const id = setTimeout(() => { this.notify(title, message, type, options); }, delayMs);
      return id;
    }

    /* ===================== Game helpers ===================== */
    battleStart(battleMode = '2v2') {
      return this.notify('전투 시작!', `${battleMode} 전투가 시작되었습니다`, 'battle', { requireInteraction: false, tag: 'battle-start' });
    }
    turnNotification(playerName, timeLeft = '05:00') {
      return this.notifyWhenHidden(`${playerName}의 차례`, `남은 시간: ${timeLeft}`, 'turn', { requireInteraction: true, tag: 'turn' });
    }
    victoryNotification(teamName, details = '') {
      return this.notify(`${teamName} 승리!`, details, 'victory', { requireInteraction: true, onClick: () => window.focus(), tag: 'result' });
    }
    defeatNotification(reason = '') {
      return this.notify('전투 패배', reason, 'defeat', { requireInteraction: true, tag: 'result' });
    }
    playerJoined(playerName, team) {
      return this.showToast('플레이어 참가', `${this.escape(playerName)}이 ${this.escape(team)}에 참가했습니다`, 'info', { tag: `join-${playerName}` });
    }
    playerLeft(playerName) {
      return this.showToast('플레이어 이탈', `${this.escape(playerName)}이 전투를 떠났습니다`, 'warning', { tag: `left-${playerName}` });
    }
    connectionIssue(message = '연결 문제가 발생했습니다') {
      return this.showToast('연결 오류', message, 'error', {
        persistent: true,
        actions: [{ label: '재연결', primary: true, callback: () => window.location.reload(), closeOnClick: true }],
        tag: 'conn-issue'
      });
    }

    /* ===================== Queue ===================== */
    addToQueue(notification) {
      this.notificationQueue.push(notification);
      if (!this.isProcessing) this.processNotificationQueue();
    }
    processNotificationQueue() {
      if (!this.notificationQueue.length) { this.isProcessing = false; return; }
      this.isProcessing = true;
      const n = this.notificationQueue.shift();
      this.notify(n.title, n.message, n.type, n.options);
      setTimeout(() => this.processNotificationQueue(), 500);
    }
    clearQueuedNotifications() {
      this.notificationQueue.length = 0;
      this.isProcessing = false;
    }

    /* ===================== Events/Styles ===================== */
    setupEventListeners() {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.processNotificationQueue();
      });
      window.addEventListener('focus', () => this.clearQueuedNotifications());
    }

    injectStyles() {
      if (document.getElementById('pyxis-notifications-styles')) return;
      const styleSheet = document.createElement('style');
      styleSheet.id = 'pyxis-notifications-styles';
      styleSheet.textContent = `
        /* PYXIS Notifications - Gaming Alert System */
        .toast-container{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:10000;pointer-events:none;display:flex;flex-direction:column;gap:12px;max-width:480px;width:90vw}
        .pyxis-toast{
          background:linear-gradient(145deg, rgba(0,30,53,.95), rgba(0,42,75,.9));
          backdrop-filter:blur(16px);
          border:2px solid rgba(220,199,162,.3);
          border-radius:16px;padding:16px 20px;box-shadow:0 8px 32px rgba(0,8,13,.6),0 0 0 1px rgba(220,199,162,.1),inset 0 1px 0 rgba(220,199,162,.2);
          color:#E2E8F0;font-family:Inter,sans-serif;font-size:14px;font-weight:500;display:flex;align-items:center;gap:12px;pointer-events:all;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);
          transform:translateY(-20px);opacity:0;animation:toastSlideIn .4s cubic-bezier(.34,1.56,.64,1) forwards;position:relative;overflow:hidden
        }
        .pyxis-toast::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg, transparent 0%, var(--toast-color,#DCC7A2) 50%, transparent 100%);opacity:.8}
        .pyxis-toast:hover{transform:translateY(-2px);border-color:rgba(220,199,162,.5);box-shadow:0 12px 40px rgba(0,8,13,.7),0 0 0 1px rgba(220,199,162,.2),0 0 20px rgba(220,199,162,.2)}
        @keyframes toastSlideIn{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes toastSlideOut{from{transform:translateY(0);opacity:1}to{transform:translateY(-20px);opacity:0}}
        .pyxis-toast.removing{animation:toastSlideOut .3s ease-in forwards}
        .toast-icon{width:24px;height:24px;border-radius:8px;background:var(--toast-color,#DCC7A2);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.3)}
        .toast-content{flex:1;min-width:0}
        .toast-title{font-weight:600;font-size:15px;color:#DCC7A2;margin-bottom:2px;line-height:1.3}
        .toast-message{color:#94A3B8;font-size:13px;line-height:1.4;opacity:.9}
        .toast-actions{display:flex;gap:8px;flex-shrink:0}
        .toast-btn{padding:6px 12px;border:1px solid rgba(220,199,162,.3);border-radius:8px;background:rgba(220,199,162,.1);color:#DCC7A2;font-size:12px;font-weight:500;cursor:pointer;transition:all .2s ease;text-transform:uppercase;letter-spacing:.3px}
        .toast-btn:hover{background:rgba(220,199,162,.2);border-color:rgba(220,199,162,.5);transform:translateY(-1px)}
        .toast-btn.primary{background:linear-gradient(145deg,#DCC7A2,#D4BA8D);color:#00080D;border-color:#DCC7A2}
        .toast-btn.primary:hover{background:linear-gradient(145deg,#D4BA8D,#DCC7A2);box-shadow:0 4px 12px rgba(220,199,162,.3)}
        .toast-close{position:absolute;top:8px;right:8px;width:20px;height:20px;border:none;background:rgba(220,199,162,.1);color:#94A3B8;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all .2s ease;opacity:.7}
        .toast-close:hover{background:rgba(220,199,162,.2);color:#DCC7A2;opacity:1}
        .toast-progress{position:absolute;bottom:0;left:0;height:3px;background:var(--toast-color,#DCC7A2);border-radius:0 0 14px 14px;transition:width .1s linear;opacity:.6}
        .pyxis-toast.battle{--toast-color:#DCC7A2}
        .pyxis-toast.turn{--toast-color:#F59E0B}
        .pyxis-toast.victory{--toast-color:#22C55E}
        .pyxis-toast.defeat{--toast-color:#EF4444}
        .pyxis-toast.info{--toast-color:#3B82F6}
        .pyxis-toast.warning{--toast-color:#F59E0B}
        .pyxis-toast.error{--toast-color:#EF4444}
        .pyxis-toast.priority-high{border-width:3px;box-shadow:0 12px 40px rgba(0,8,13,.8),0 0 30px rgba(220,199,162,.3)}
        .pyxis-toast.priority-high::before{height:3px;opacity:1}
        @media (max-width:768px){.toast-container{top:16px;width:95vw}.pyxis-toast{padding:14px 16px;font-size:13px}.toast-icon{width:20px;height:20px}.toast-title{font-size:14px}.toast-message{font-size:12px}}
        @media (prefers-reduced-motion: reduce){.pyxis-toast{animation:none !important;transition:opacity .2s ease !important}.pyxis-toast.removing{animation:none !important}}
        @media (prefers-contrast: high){.pyxis-toast{border-width:3px;background:rgba(0,30,53,1)}}
      `;
      document.head.appendChild(styleSheet);
    }

    /* ===================== State/Config ===================== */
    setEnabled(v)       { this.enabled = !!v; this.persistPrefs(); }
    setSoundEnabled(v)  { this.soundEnabled = !!v; this.persistPrefs(); }
    setHapticEnabled(v) { this.hapticEnabled = !!v; this.persistPrefs(); }
    setToastEnabled(v)  { this.toastEnabled = !!v; this.persistPrefs(); }
    setMasterVolume(v)  {
      this.masterVolume = Math.max(0, Math.min(1, v));
      if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
      this.persistPrefs();
    }

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

    testNotifications() {
      console.log('Testing PYXIS Notifications...');
      setTimeout(() => this.battleStart('2v2'), 0);
      setTimeout(() => this.turnNotification('테스트 플레이어', '04:30'), 1000);
      setTimeout(() => this.playerJoined('새로운 전사', '불사조 기사단'), 2000);
      setTimeout(() => this.showToast('아이템 사용', '디터니로 체력을 회복했습니다', 'info'), 3000);
      setTimeout(() => this.showToast('경고', '턴 시간이 1분 남았습니다', 'warning'), 4000);
      setTimeout(() => this.victoryNotification('불사조 기사단', '압도적인 승리!'), 5000);
    }

    configure(cfg = {}) {
      if (cfg.enabled !== undefined)       this.setEnabled(cfg.enabled);
      if (cfg.soundEnabled !== undefined)  this.setSoundEnabled(cfg.soundEnabled);
      if (cfg.hapticEnabled !== undefined) this.setHapticEnabled(cfg.hapticEnabled);
      if (cfg.toastEnabled !== undefined)  this.setToastEnabled(cfg.toastEnabled);
      if (cfg.masterVolume !== undefined)  this.setMasterVolume(cfg.masterVolume);
    }

    /* ===================== Utils/Cleanup ===================== */
    escape(s) {
      const div = document.createElement('div');
      div.textContent = s == null ? '' : String(s);
      return div.innerHTML;
    }

    destroy() {
      // clear queue
      this.notificationQueue.forEach(item => { if (item?.timeoutId) clearTimeout(item.timeoutId); });
      this.notificationQueue.length = 0;
      this.isProcessing = false;

      // toasts
      this.clearAllToasts();
      if (this.toastContainer) { try { this.toastContainer.remove(); } catch {} this.toastContainer = null; }

      // audio
      if (this.audioContext) { try { this.audioContext.close(); } catch {} this.audioContext = null; }
      this.soundBuffers.clear();

      // styles
      const styleSheet = document.getElementById('pyxis-notifications-styles');
      if (styleSheet) { try { styleSheet.remove(); } catch {} }

      // tags
      this.activeTags.clear();

      console.log('PYXIS 알림 시스템이 정리되었습니다');
    }
  }

  // 전역 인스턴스
  window.PyxisNotify = new PyxisNotifications();
  // 별칭
  window.Notifications = window.PyxisNotify;

  // DOM 로드 완료 후 초기화 안내/권한 유도(강제 아님)
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      window.PyxisNotify.showToast(
        '알림 설정',
        '브라우저 알림을 허용하면 탭 밖에서도 전투 상황을 확인할 수 있습니다',
        'info',
        {
          duration: 8000,
          actions: [
            { label: '허용', primary: true, callback: () => window.PyxisNotify.requestPermission() },
            { label: '나중에', callback: () => {} }
          ],
          tag: 'notify-hint'
        }
      );
    }
    console.log('PYXIS 알림 시스템이 초기화되었습니다');
  });

  // 페이지 언로드시 정리
  window.addEventListener('beforeunload', () => {
    window.PyxisNotify.destroy();
  });

})();
