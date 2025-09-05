// PYXIS Notifications - Enhanced Design Version
// 브라우저 알림 + 토스트 + 게임적 효과 연동
(function () {
  class PyxisNotifications {
    constructor() {
      this.permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
      this.sounds = {};
      this.enabled = true;        // 전체 알림 on/off
      this.muted = false;         // 사운드 on/off
      this.gameEffects = true;    // 게임 효과 on/off
      this.notificationQueue = [];
      this.isPlayingQueue = false;
      this._initSounds();
      this._initGameEffects();
    }

    // 다양한 효과음 초기화
    _initSounds() {
      const soundMap = {
        general: '/assets/sounds/notify.mp3',
        battle: '/assets/sounds/battle.mp3',
        victory: '/assets/sounds/victory.mp3',
        defeat: '/assets/sounds/defeat.mp3',
        turn: '/assets/sounds/turn.mp3',
        damage: '/assets/sounds/damage.mp3',
        heal: '/assets/sounds/heal.mp3',
        critical: '/assets/sounds/critical.mp3',
        levelup: '/assets/sounds/levelup.mp3'
      };

      Object.entries(soundMap).forEach(([key, path]) => {
        try {
          const audio = new Audio(path);
          audio.volume = 0.6;
          audio.preload = 'auto';
          this.sounds[key] = audio;
        } catch (_) {
          // 파일이 없으면 조용히 무시
        }
      });
    }

    // 게임적 시각 효과 초기화
    _initGameEffects() {
      this._createNotificationStyles();
      this._setupVisibilityHandler();
    }

    _createNotificationStyles() {
      if (document.querySelector('#pyxis-notification-styles')) return;

      const style = document.createElement('style');
      style.id = 'pyxis-notification-styles';
      style.textContent = `
        /* PYXIS 알림 효과 스타일 */
        .pyxis-notification-flash {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          z-index: 99999;
          animation: pyxisFlash 0.8s ease-out;
        }

        .pyxis-notification-flash.battle {
          background: radial-gradient(circle, rgba(220, 199, 162, 0.3) 0%, transparent 70%);
        }

        .pyxis-notification-flash.victory {
          background: radial-gradient(circle, rgba(34, 197, 94, 0.4) 0%, transparent 70%);
        }

        .pyxis-notification-flash.defeat {
          background: radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, transparent 70%);
        }

        .pyxis-notification-flash.damage {
          background: radial-gradient(circle, rgba(248, 113, 113, 0.3) 0%, transparent 70%);
        }

        .pyxis-notification-flash.heal {
          background: radial-gradient(circle, rgba(74, 222, 128, 0.3) 0%, transparent 70%);
        }

        .pyxis-notification-flash.critical {
          background: radial-gradient(circle, rgba(245, 158, 11, 0.5) 0%, transparent 70%);
        }

        @keyframes pyxisFlash {
          0% {
            opacity: 0;
            transform: scale(0.8);
          }
          30% {
            opacity: 1;
            transform: scale(1.1);
          }
          100% {
            opacity: 0;
            transform: scale(1);
          }
        }

        .pyxis-screen-shake {
          animation: pyxisShake 0.5s ease-out;
        }

        @keyframes pyxisShake {
          0%, 100% { transform: translateX(0); }
          10% { transform: translateX(-5px); }
          20% { transform: translateX(5px); }
          30% { transform: translateX(-3px); }
          40% { transform: translateX(3px); }
          50% { transform: translateX(-2px); }
          60% { transform: translateX(2px); }
          70% { transform: translateX(-1px); }
          80% { transform: translateX(1px); }
        }

        .pyxis-notification-particles {
          position: fixed;
          pointer-events: none;
          z-index: 99998;
        }

        .pyxis-particle {
          position: absolute;
          width: 4px;
          height: 4px;
          background: var(--gold-bright, #DCC7A2);
          border-radius: 50%;
          animation: pyxisParticle 2s ease-out forwards;
        }

        @keyframes pyxisParticle {
          0% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: scale(0) rotate(360deg);
            opacity: 0;
          }
        }

        .pyxis-notification-glow {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, 
            transparent 0%, 
            var(--gold-bright, #DCC7A2) 25%, 
            var(--gold-warm, #D4BA8D) 50%, 
            var(--gold-bright, #DCC7A2) 75%, 
            transparent 100%);
          pointer-events: none;
          z-index: 99997;
          animation: pyxisGlow 1.5s ease-out;
        }

        @keyframes pyxisGlow {
          0% {
            opacity: 0;
            transform: scaleX(0);
          }
          50% {
            opacity: 1;
            transform: scaleX(1);
          }
          100% {
            opacity: 0;
            transform: scaleX(1);
          }
        }

        .pyxis-notification-bubble {
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, rgba(0, 30, 53, 0.95), rgba(0, 42, 75, 0.95));
          backdrop-filter: blur(12px);
          border: 1px solid rgba(220, 199, 162, 0.3);
          border-radius: 12px;
          padding: 16px 20px;
          max-width: 350px;
          box-shadow: 0 8px 32px rgba(0, 8, 13, 0.5);
          z-index: 99996;
          animation: pyxisBubbleIn 0.5s ease-out;
          color: #E2E8F0;
          font-family: 'Inter', sans-serif;
        }

        .pyxis-notification-bubble.closing {
          animation: pyxisBubbleOut 0.3s ease-in forwards;
        }

        @keyframes pyxisBubbleIn {
          0% {
            opacity: 0;
            transform: translateX(100%) scale(0.8);
          }
          100% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }

        @keyframes pyxisBubbleOut {
          0% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateX(100%) scale(0.8);
          }
        }

        .pyxis-notification-bubble .title {
          font-size: 14px;
          font-weight: 700;
          color: var(--gold-bright, #DCC7A2);
          margin-bottom: 4px;
          text-shadow: 0 0 8px rgba(220, 199, 162, 0.5);
        }

        .pyxis-notification-bubble .body {
          font-size: 13px;
          line-height: 1.4;
          color: #CBD5E1;
        }

        .pyxis-notification-bubble .close-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 20px;
          height: 20px;
          border: none;
          background: transparent;
          color: #94A3B8;
          cursor: pointer;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          transition: all 0.2s ease;
        }

        .pyxis-notification-bubble .close-btn:hover {
          background: rgba(220, 199, 162, 0.2);
          color: var(--gold-bright, #DCC7A2);
        }
      `;
      document.head.appendChild(style);
    }

    _setupVisibilityHandler() {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this._onPageHidden();
        } else {
          this._onPageVisible();
        }
      });
    }

    _onPageHidden() {
      // 페이지가 숨겨질 때 대기 중인 알림들 처리
      if (this.notificationQueue.length > 0) {
        this._processQueuedNotifications();
      }
    }

    _onPageVisible() {
      // 페이지가 다시 보일 때 게임 효과 리셋
      this._clearActiveEffects();
    }

    _processQueuedNotifications() {
      if (this.isPlayingQueue || this.notificationQueue.length === 0) return;
      
      this.isPlayingQueue = true;
      const processNext = () => {
        if (this.notificationQueue.length === 0) {
          this.isPlayingQueue = false;
          return;
        }
        
        const { title, options } = this.notificationQueue.shift();
        this._showBrowserNotification(title, options);
        
        setTimeout(processNext, 500); // 0.5초 간격으로 처리
      };
      
      processNext();
    }

    _clearActiveEffects() {
      document.querySelectorAll('.pyxis-notification-flash, .pyxis-notification-particles, .pyxis-notification-glow').forEach(el => {
        el.remove();
      });
      document.body.classList.remove('pyxis-screen-shake');
    }

    // 권한 요청 (게임적 UI 강화)
    async requestPermission() {
      if (typeof Notification === 'undefined') {
        this._showCustomBubble('브라우저 알림 미지원', {
          body: '현재 브라우저는 알림을 지원하지 않습니다',
          type: 'warning'
        });
        return 'denied';
      }

      if (Notification.permission === 'default') {
        try {
          // 권한 요청 전 사용자에게 안내
          this._showCustomBubble('알림 권한 요청', {
            body: '전투 상황을 실시간으로 알려드릴게요!',
            type: 'info'
          });

          const res = await Notification.requestPermission();
          this.permission = res;
          
          if (res === 'granted') {
            this._playSound('levelup');
            this._addFlashEffect('victory');
            this._showCustomBubble('알림 활성화!', {
              body: '이제 탭 밖에서도 전투 알림을 받을 수 있어요',
              type: 'success'
            });
          } else {
            this._showCustomBubble('알림 비활성화', {
              body: '언제든지 브라우저 설정에서 변경할 수 있어요',
              type: 'info'
            });
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

    // 알림 가능 여부
    canNotify() {
      if (typeof Notification === 'undefined') return false;
      this.permission = Notification.permission;
      return this.permission === 'granted' && this.enabled;
    }

    // 메인 알림 메서드 (강화된 게임 효과)
    notify(title, options = {}) {
      const {
        body = '',
        icon = '/assets/images/pyxis-icon.png',
        tag,
        silent = false,
        requireInteraction = false,
        onClick = null,
        type = 'general', // general, battle, victory, defeat, turn, damage, heal, critical
        gameEffect = true,
        priority = 'normal' // low, normal, high, urgent
      } = options;

      // 게임 효과 먼저 실행 (즉시 피드백)
      if (this.gameEffects && gameEffect) {
        this._addGameEffects(type, priority);
      }

      // 커스텀 버블 알림 (항상 표시)
      this._showCustomBubble(title, { body, type });

      // 브라우저 알림 (권한이 있을 때만)
      if (this.canNotify()) {
        if (document.hidden || priority === 'urgent') {
          // 페이지가 숨겨져 있거나 긴급한 알림은 즉시 표시
          return this._showBrowserNotification(title, options);
        } else {
          // 페이지가 보일 때는 큐에 추가
          this.notificationQueue.push({ title, options });
        }
      }

      // 사운드 재생
      if (!silent && !this.muted) {
        this._playSound(type);
      }

      return null;
    }

    _showBrowserNotification(title, options) {
      const {
        body = '',
        icon = '/assets/images/pyxis-icon.png',
        tag,
        silent = false,
        requireInteraction = false,
        onClick = null,
      } = options;

      try {
        const notifOptions = { 
          body, 
          icon, 
          requireInteraction, 
          silent: silent || this.muted,
          badge: '/assets/images/pyxis-badge.png' // 작은 배지 아이콘
        };
        
        if (typeof tag !== 'undefined') notifOptions.tag = tag;

        const n = new Notification(title, notifOptions);

        if (onClick) {
          n.onclick = (e) => {
            try { onClick(e); } catch {}
            window.focus?.();
            n.close?.();
          };
        } else {
          n.onclick = () => { 
            window.focus?.(); 
            n.close?.(); 
          };
        }

        // 자동 닫기 (긴급하지 않은 알림)
        if (!requireInteraction) {
          setTimeout(() => {
            n.close?.();
          }, 5000);
        }

        return n;
      } catch (e) {
        console.warn('브라우저 알림 실패:', e.message);
        return null;
      }
    }

    _showCustomBubble(title, options = {}) {
      const { body = '', type = 'info' } = options;
      
      const bubble = document.createElement('div');
      bubble.className = 'pyxis-notification-bubble';
      
      bubble.innerHTML = `
        <button class="close-btn" title="닫기">×</button>
        <div class="title">${title}</div>
        ${body ? `<div class="body">${body}</div>` : ''}
      `;

      // 타입별 스타일 조정
      if (type === 'success') {
        bubble.style.borderColor = 'rgba(34, 197, 94, 0.5)';
      } else if (type === 'warning') {
        bubble.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      } else if (type === 'error') {
        bubble.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      }

      // 닫기 버튼 이벤트
      bubble.querySelector('.close-btn').addEventListener('click', () => {
        this._closeBubble(bubble);
      });

      document.body.appendChild(bubble);

      // 자동 닫기
      setTimeout(() => {
        this._closeBubble(bubble);
      }, 4000);

      return bubble;
    }

    _closeBubble(bubble) {
      if (!bubble || !bubble.parentNode) return;
      
      bubble.classList.add('closing');
      setTimeout(() => {
        if (bubble.parentNode) {
          bubble.parentNode.removeChild(bubble);
        }
      }, 300);
    }

    _addGameEffects(type, priority) {
      // 플래시 효과
      this._addFlashEffect(type);
      
      // 화면 상단 글로우
      this._addGlowEffect();
      
      // 파티클 효과 (중요한 알림에만)
      if (priority === 'high' || priority === 'urgent') {
        this._addParticleEffect(type);
      }
      
      // 화면 흔들림 (긴급 알림에만)
      if (priority === 'urgent') {
        this._addShakeEffect();
      }
    }

    _addFlashEffect(type) {
      const flash = document.createElement('div');
      flash.className = `pyxis-notification-flash ${type}`;
      document.body.appendChild(flash);
      
      setTimeout(() => {
        if (flash.parentNode) {
          flash.parentNode.removeChild(flash);
        }
      }, 800);
    }

    _addGlowEffect() {
      const glow = document.createElement('div');
      glow.className = 'pyxis-notification-glow';
      document.body.appendChild(glow);
      
      setTimeout(() => {
        if (glow.parentNode) {
          glow.parentNode.removeChild(glow);
        }
      }, 1500);
    }

    _addParticleEffect(type) {
      const container = document.createElement('div');
      container.className = 'pyxis-notification-particles';
      
      // 화면 중앙에서 파티클 생성
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      
      container.style.left = `${centerX}px`;
      container.style.top = `${centerY}px`;
      
      // 16개 파티클 생성
      for (let i = 0; i < 16; i++) {
        const particle = document.createElement('div');
        particle.className = 'pyxis-particle';
        
        const angle = (Math.PI * 2 * i) / 16;
        const distance = 60 + Math.random() * 40;
        const endX = Math.cos(angle) * distance;
        const endY = Math.sin(angle) * distance;
        
        particle.style.setProperty('--end-x', `${endX}px`);
        particle.style.setProperty('--end-y', `${endY}px`);
        
        // 타입별 색상
        if (type === 'victory' || type === 'heal') {
          particle.style.background = '#22C55E';
        } else if (type === 'defeat' || type === 'damage') {
          particle.style.background = '#EF4444';
        } else if (type === 'critical') {
          particle.style.background = '#F59E0B';
        }
        
        container.appendChild(particle);
      }
      
      document.body.appendChild(container);
      
      setTimeout(() => {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }, 2000);
    }

    _addShakeEffect() {
      document.body.classList.add('pyxis-screen-shake');
      setTimeout(() => {
        document.body.classList.remove('pyxis-screen-shake');
      }, 500);
    }

    _playSound(type) {
      const sound = this.sounds[type] || this.sounds.general;
      if (sound) {
        try {
          sound.currentTime = 0;
          sound.play().catch(() => {
            // 자동재생 정책으로 실패해도 조용히 처리
          });
        } catch {}
      }
    }

    // 탭이 백그라운드일 때만 알림
    notifyWhenHidden(title, options = {}) {
      if (document.hidden) {
        return this.notify(title, { ...options, priority: 'high' });
      }
      return null;
    }

    // 일정 시간 뒤 알림
    schedule(title, options = {}, delayMs = 1000) {
      return setTimeout(() => this.notify(title, options), delayMs);
    }

    // 전투 관련 특화 메서드들
    notifyBattleStart(battleInfo) {
      this.notify('⚔️ 전투 시작!', {
        body: `${battleInfo.mode} 전투가 시작되었습니다`,
        type: 'battle',
        priority: 'high',
        requireInteraction: true
      });
    }

    notifyTurnChange(playerName, isMyTurn = false) {
      this.notify(isMyTurn ? '🎯 당신의 턴!' : '⏰ 턴 변경', {
        body: `${playerName}의 턴입니다`,
        type: 'turn',
        priority: isMyTurn ? 'urgent' : 'normal',
        requireInteraction: isMyTurn
      });
    }

    notifyDamage(damage, target, isCritical = false) {
      this.notify(isCritical ? '💥 치명타!' : '⚔️ 공격!', {
        body: `${target}이(가) ${damage} 데미지를 받았습니다`,
        type: isCritical ? 'critical' : 'damage',
        priority: isCritical ? 'high' : 'normal'
      });
    }

    notifyHeal(amount, target) {
      this.notify('💚 회복!', {
        body: `${target}이(가) ${amount} HP 회복했습니다`,
        type: 'heal',
        priority: 'normal'
      });
    }

    notifyBattleEnd(winner, isVictory = false) {
      this.notify(isVictory ? '🏆 승리!' : '💀 패배', {
        body: `${winner}이(가) 승리했습니다!`,
        type: isVictory ? 'victory' : 'defeat',
        priority: 'urgent',
        requireInteraction: true
      });
    }

    notifyPlayerDeath(playerName) {
      this.notify('💀 플레이어 사망', {
        body: `${playerName}이(가) 쓰러졌습니다`,
        type: 'defeat',
        priority: 'high'
      });
    }

    notifyConnectionLost() {
      this.notify('⚠️ 연결 끊김', {
        body: '서버와의 연결이 끊어졌습니다. 재연결 중...',
        type: 'warning',
        priority: 'urgent',
        silent: false
      });
    }

    notifyConnectionRestored() {
      this.notify('✅ 연결 복구', {
        body: '서버 연결이 복구되었습니다',
        type: 'success',
        priority: 'high'
      });
    }

    // 설정 메서드들
    setEnabled(enabled) { 
      this.enabled = !!enabled;
      if (enabled) {
        this._showCustomBubble('알림 활성화', {
          body: '게임 알림이 활성화되었습니다',
          type: 'success'
        });
      }
    }

    setMuted(muted) { 
      this.muted = !!muted;
      this._showCustomBubble(muted ? '🔇 음소거' : '🔊 음성 활성화', {
        body: `알림 사운드가 ${muted ? '비활성화' : '활성화'}되었습니다`,
        type: 'info'
      });
    }

    setGameEffects(enabled) {
      this.gameEffects = !!enabled;
      this._showCustomBubble(enabled ? '✨ 효과 활성화' : '📱 심플 모드', {
        body: `게임 효과가 ${enabled ? '활성화' : '비활성화'}되었습니다`,
        type: 'info'
      });
    }

    // 테스트 메서드
    test() {
      this.notify('🧪 테스트 알림', {
        body: 'PYXIS 알림 시스템이 정상 작동 중입니다!',
        type: 'general',
        priority: 'normal'
      });
    }

    // 정리
    destroy() {
      this._clearActiveEffects();
      document.querySelectorAll('.pyxis-notification-bubble').forEach(bubble => {
        this._closeBubble(bubble);
      });
      this.notificationQueue = [];
      this.isPlayingQueue = false;
    }
  }

  // 전역 인스턴스 생성
  window.PyxisNotify = new PyxisNotifications();

  // 초기화
  document.addEventListener('DOMContentLoaded', () => {
    // 첫 방문시 알림 권한 안내 (부드럽게)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      setTimeout(() => {
        window.PyxisNotify._showCustomBubble('🔔 알림 설정', {
          body: '전투 상황을 놓치지 않으려면 브라우저 알림을 허용해주세요!',
          type: 'info'
        });
      }, 3000); // 3초 후 안내
    }

    // 개발 모드에서 테스트 단축키
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'N') {
          e.preventDefault();
          window.PyxisNotify.test();
        }
      });
    }
  });

  // 페이지 언로드시 정리
  window.addEventListener('beforeunload', () => {
    if (window.PyxisNotify) {
      window.PyxisNotify.destroy();
    }
  });

})();
