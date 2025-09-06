<script>
/* PYXIS Notifications - Enhanced Design Version (이모지 제거) */
(function () {
  class PyxisNotifications {
    constructor() {
      this.permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
      this.sounds = {};
      this.enabled = true;
      this.muted = false;
      this.gameEffects = true;
      this.notificationQueue = [];
      this.isPlayingQueue = false;
      this._initSounds();
      this._initGameEffects();
    }

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
        } catch (_) {}
      });
    }

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
          position: fixed; inset: 0;
          pointer-events: none; z-index: 99999;
          animation: pyxisFlash 0.8s ease-out;
        }
        .pyxis-notification-flash.battle { background: radial-gradient(circle, rgba(220,199,162,.3) 0%, transparent 70%); }
        .pyxis-notification-flash.victory { background: radial-gradient(circle, rgba(34,197,94,.4) 0%, transparent 70%); }
        .pyxis-notification-flash.defeat { background: radial-gradient(circle, rgba(239,68,68,.4) 0%, transparent 70%); }
        .pyxis-notification-flash.damage { background: radial-gradient(circle, rgba(248,113,113,.3) 0%, transparent 70%); }
        .pyxis-notification-flash.heal { background: radial-gradient(circle, rgba(74,222,128,.3) 0%, transparent 70%); }
        .pyxis-notification-flash.critical { background: radial-gradient(circle, rgba(245,158,11,.5) 0%, transparent 70%); }

        @keyframes pyxisFlash {
          0% { opacity: 0; transform: scale(.8); }
          30% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1); }
        }

        .pyxis-screen-shake { animation: pyxisShake .5s ease-out; }
        @keyframes pyxisShake {
          0%,100% { transform: translateX(0); }
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
          position: fixed; pointer-events: none; z-index: 99998;
          left: 50%; top: 50%; transform: translate(-50%, -50%);
          width: 0; height: 0;
        }
        .pyxis-particle {
          position: absolute; width: 4px; height: 4px;
          left: 0; top: 0;
          background: var(--gold-bright, #DCC7A2);
          border-radius: 50%;
          animation: pyxisParticle 1.2s ease-out forwards;
        }
        /* FIX: CSS 변수로 실제 이동 */
        @keyframes pyxisParticle {
          0% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--end-x, 0), var(--end-y, 0)) scale(0) rotate(360deg); opacity: 0; }
        }

        .pyxis-notification-glow {
          position: fixed; top: 0; left: 0; right: 0; height: 3px;
          background: linear-gradient(90deg, transparent 0%, var(--gold-bright,#DCC7A2) 25%, var(--gold-warm,#D4BA8D) 50%, var(--gold-bright,#DCC7A2) 75%, transparent 100%);
          pointer-events: none; z-index: 99997; animation: pyxisGlow 1.5s ease-out;
        }
        @keyframes pyxisGlow { 0% {opacity:0;transform:scaleX(0);} 50% {opacity:1;transform:scaleX(1);} 100% {opacity:0;transform:scaleX(1);} }

        .pyxis-notification-bubble {
          position: fixed; right: 20px;
          background: linear-gradient(135deg, rgba(0,30,53,.95), rgba(0,42,75,.95));
          backdrop-filter: blur(12px);
          border: 1px solid rgba(220,199,162,.3);
          border-radius: 12px; padding: 16px 20px; max-width: 350px;
          box-shadow: 0 8px 32px rgba(0,8,13,.5); z-index: 99996;
          animation: pyxisBubbleIn .5s ease-out; color: #E2E8F0; font-family: 'Inter', sans-serif;
        }
        .pyxis-notification-bubble.closing { animation: pyxisBubbleOut .3s ease-in forwards; }
        @keyframes pyxisBubbleIn { 0% {opacity:0;transform:translateX(100%) scale(.8);} 100% {opacity:1;transform:translateX(0) scale(1);} }
        @keyframes pyxisBubbleOut { 0% {opacity:1;transform:translateX(0) scale(1);} 100% {opacity:0;transform:translateX(100%) scale(.8);} }
        .pyxis-notification-bubble .title { font-size:14px; font-weight:700; color:var(--gold-bright,#DCC7A2); margin-bottom:4px; text-shadow:0 0 8px rgba(220,199,162,.5); }
        .pyxis-notification-bubble .body { font-size:13px; line-height:1.4; color:#CBD5E1; }
        .pyxis-notification-bubble .close-btn {
          position:absolute; top:8px; right:8px; width:20px; height:20px; border:none; background:transparent;
          color:#94A3B8; cursor:pointer; border-radius:50%; display:flex; align-items:center; justify-content:center;
          font-size:12px; transition:all .2s ease;
        }
        .pyxis-notification-bubble .close-btn:hover { background:rgba(220,199,162,.2); color:var(--gold-bright,#DCC7A2); }
      `;
      document.head.appendChild(style);
    }

    _setupVisibilityHandler() {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this._processQueuedNotifications();
        else this._clearActiveEffects();
      });
    }

    _processQueuedNotifications() {
      if (this.isPlayingQueue || this.notificationQueue.length === 0) return;
      this.isPlayingQueue = true;
      const processNext = () => {
        if (this.notificationQueue.length === 0) { this.isPlayingQueue = false; return; }
        const { title, options } = this.notificationQueue.shift();
        this._showBrowserNotification(title, options);
        setTimeout(processNext, 500);
      };
      processNext();
    }

    _clearActiveEffects() {
      document.querySelectorAll('.pyxis-notification-flash, .pyxis-notification-particles, .pyxis-notification-glow').forEach(el => el.remove());
      document.body.classList.remove('pyxis-screen-shake');
    }

    async requestPermission() {
      if (typeof Notification === 'undefined') {
        this._showCustomBubble('브라우저 알림 미지원', { body: '현재 브라우저는 알림을 지원하지 않습니다', type: 'warning' });
        return 'denied';
      }
      if (Notification.permission === 'default') {
        try {
          this._showCustomBubble('알림 권한 요청', { body: '전투 상황을 실시간으로 알려드릴게요!', type: 'info' });
          const res = await Notification.requestPermission();
          this.permission = res;
          if (res === 'granted') {
            this._playSound('levelup');
            this._addFlashEffect('victory');
            this._showCustomBubble('알림 활성화!', { body: '이제 탭 밖에서도 전투 알림을 받을 수 있어요', type: 'success' });
          } else {
            this._showCustomBubble('알림 비활성화', { body: '언제든지 브라우저 설정에서 변경할 수 있어요', type: 'info' });
          }
          return res;
        } catch { this.permission = 'denied'; return 'denied'; }
      } else {
        this.permission = Notification.permission;
        return this.permission;
      }
    }

    canNotify() {
      if (typeof Notification === 'undefined') return false;
      this.permission = Notification.permission;
      return this.permission === 'granted' && this.enabled;
    }

    notify(title, options = {}) {
      const {
        body = '',
        icon = '/assets/images/pyxis-icon.png',
        tag, silent = false, requireInteraction = false,
        onClick = null, type = 'general', gameEffect = true, priority = 'normal'
      } = options;

      if (this.gameEffects && gameEffect) this._addGameEffects(type, priority);
      this._showCustomBubble(title, { body, type });

      if (this.canNotify()) {
        if (document.hidden || priority === 'urgent') {
          this._showBrowserNotification(title, options);
        } else {
          this.notificationQueue.push({ title, options });
        }
      }

      if (!silent && !this.muted) this._playSound(type);
      return null;
    }

    _showBrowserNotification(title, options) {
      const { body = '', icon = '/assets/images/pyxis-icon.png', tag, silent = false, requireInteraction = false, onClick = null } = options;
      try {
        const notifOptions = { body, icon, requireInteraction, silent: silent || this.muted, badge: '/assets/images/pyxis-badge.png' };
        if (typeof tag !== 'undefined') notifOptions.tag = tag;
        const n = new Notification(title, notifOptions);
        n.onclick = (e) => { try { onClick?.(e); } catch {} window.focus?.(); n.close?.(); };
        if (!requireInteraction) setTimeout(() => n.close?.(), 5000);
        return n;
      } catch (e) { console.warn('브라우저 알림 실패:', e.message); return null; }
    }

    _showCustomBubble(title, options = {}) {
      const { body = '', type = 'info' } = options;
      const bubble = document.createElement('div');
      bubble.className = 'pyxis-notification-bubble';
      // FIX: 겹치지 않게 스택 오프셋
      const opened = document.querySelectorAll('.pyxis-notification-bubble').length;
      bubble.style.top = `${20 + opened * 72}px`;

      bubble.innerHTML = `
        <button class="close-btn" title="닫기">×</button>
        <div class="title">${title}</div>
        ${body ? `<div class="body">${body}</div>` : ''}
      `;
      if (type === 'success') bubble.style.borderColor = 'rgba(34, 197, 94, 0.5)';
      else if (type === 'warning') bubble.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      else if (type === 'error') bubble.style.borderColor = 'rgba(239, 68, 68, 0.5)';

      bubble.querySelector('.close-btn').addEventListener('click', () => this._closeBubble(bubble));
      document.body.appendChild(bubble);
      setTimeout(() => this._closeBubble(bubble), 4000);
      return bubble;
    }

    _closeBubble(bubble) {
      if (!bubble || !bubble.parentNode) return;
      bubble.classList.add('closing');
      setTimeout(() => bubble.parentNode?.removeChild(bubble), 300);
    }

    _addGameEffects(type, priority) {
      this._addFlashEffect(type);
      this._addGlowEffect();
      if (priority === 'high' || priority === 'urgent') this._addParticleEffect(type);
      if (priority === 'urgent') this._addShakeEffect();
    }

    _addFlashEffect(type) {
      const flash = document.createElement('div');
      flash.className = `pyxis-notification-flash ${type}`;
      document.body.appendChild(flash);
      setTimeout(() => flash.parentNode && flash.parentNode.removeChild(flash), 800);
    }

    _addGlowEffect() {
      const glow = document.createElement('div');
      glow.className = 'pyxis-notification-glow';
      document.body.appendChild(glow);
      setTimeout(() => glow.parentNode && glow.parentNode.removeChild(glow), 1500);
    }

    _addParticleEffect(type) {
      const container = document.createElement('div');
      container.className = 'pyxis-notification-particles';
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
        if (type === 'victory' || type === 'heal') particle.style.background = '#22C55E';
        else if (type === 'defeat' || type === 'damage') particle.style.background = '#EF4444';
        else if (type === 'critical') particle.style.background = '#F59E0B';
        container.appendChild(particle);
      }
      document.body.appendChild(container);
      setTimeout(() => container.parentNode && container.parentNode.removeChild(container), 1200);
    }

    _addShakeEffect() {
      document.body.classList.add('pyxis-screen-shake');
      setTimeout(() => document.body.classList.remove('pyxis-screen-shake'), 500);
    }

    _playSound(type) {
      const sound = this.sounds[type] || this.sounds.general;
      if (!sound) return;
      try {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      } catch {}
    }

    notifyWhenHidden(title, options = {}) {
      if (document.hidden) return this.notify(title, { ...options, priority: 'high' });
      return null;
    }

    schedule(title, options = {}, delayMs = 1000) {
      return setTimeout(() => this.notify(title, options), delayMs);
    }

    // 전투 특화
    notifyBattleStart(battleInfo) {
      this.notify('전투 시작!', { body: `${battleInfo.mode} 전투가 시작되었습니다`, type: 'battle', priority: 'high', requireInteraction: true });
    }
    notifyTurnChange(playerName, isMyTurn = false) {
      this.notify(isMyTurn ? '당신의 턴!' : '턴 변경', { body: `${playerName}의 턴입니다`, type: 'turn', priority: isMyTurn ? 'urgent' : 'normal', requireInteraction: isMyTurn });
    }
    notifyDamage(damage, target, isCritical = false) {
      this.notify(isCritical ? '치명타!' : '공격!', { body: `${target}이(가) ${damage} 데미지를 받았습니다`, type: isCritical ? 'critical' : 'damage', priority: isCritical ? 'high' : 'normal' });
    }
    notifyHeal(amount, target) {
      this.notify('회복!', { body: `${target}이(가) ${amount} HP 회복했습니다`, type: 'heal', priority: 'normal' });
    }
    notifyBattleEnd(winner, isVictory = false) {
      this.notify(isVictory ? '승리!' : '패배', { body: `${winner}이(가) 승리했습니다!`, type: isVictory ? 'victory' : 'defeat', priority: 'urgent', requireInteraction: true });
    }
    notifyPlayerDeath(playerName) {
      this.notify('플레이어 사망', { body: `${playerName}이(가) 쓰러졌습니다`, type: 'defeat', priority: 'high' });
    }
    notifyConnectionLost() {
      this.notify('연결 끊김', { body: '서버와의 연결이 끊어졌습니다. 재연결 중...', type: 'warning', priority: 'urgent', silent: false });
    }
    notifyConnectionRestored() {
      this.notify('연결 복구', { body: '서버 연결이 복구되었습니다', type: 'success', priority: 'high' });
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (enabled) this._showCustomBubble('알림 활성화', { body: '게임 알림이 활성화되었습니다', type: 'success' });
    }
    setMuted(muted) {
      this.muted = !!muted;
      this._showCustomBubble(muted ? '음소거' : '음성 활성화', { body: `알림 사운드가 ${muted ? '비활성화' : '활성화'}되었습니다`, type: 'info' });
    }
    setGameEffects(enabled) {
      this.gameEffects = !!enabled;
      this._showCustomBubble(enabled ? '효과 활성화' : '심플 모드', { body: `게임 효과가 ${enabled ? '활성화' : '비활성화'}되었습니다`, type: 'info' });
    }

    test() {
      this.notify('테스트 알림', { body: 'PYXIS 알림 시스템이 정상 작동 중입니다!', type: 'general', priority: 'normal' });
    }

    destroy() {
      this._clearActiveEffects();
      document.querySelectorAll('.pyxis-notification-bubble').forEach(b => this._closeBubble(b));
      this.notificationQueue = [];
      this.isPlayingQueue = false;
    }
  }

  window.PyxisNotify = new PyxisNotifications();

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      setTimeout(() => {
        window.PyxisNotify._showCustomBubble('알림 설정', { body: '전투 상황을 놓치지 않으려면 브라우저 알림을 허용해주세요!', type: 'info' });
      }, 3000);
    }
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'N') {
          e.preventDefault(); window.PyxisNotify.test();
        }
      });
    }
  });

  window.addEventListener('beforeunload', () => { window.PyxisNotify?.destroy(); });
})();
</script>
