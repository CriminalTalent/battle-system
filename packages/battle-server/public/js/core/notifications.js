// PYXIS Notifications - 브라우저 알림 + 토스트 연동
(function () {
  class PyxisNotifications {
    constructor() {
      this.permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
      this.sound = null;
      this.enabled = true;        // 전체 알림 on/off
      this.muted = false;         // 사운드 on/off
      this._initSound();
    }

    // 간단한 효과음 (선택)
    _initSound() {
      try {
        this.sound = new Audio('/assets/sounds/notify.mp3'); // 없으면 조용히 무시됨
        this.sound.volume = 0.5;
      } catch (_) {}
    }

    // 권한 요청
    async requestPermission() {
      if (typeof Notification === 'undefined') {
        UI?.warning?.('브라우저가 알림을 지원하지 않습니다');
        return 'denied';
      }
      if (Notification.permission === 'default') {
        try {
          const res = await Notification.requestPermission();
          this.permission = res;
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

    // 알림 가능 여부 (권한 최신값 반영)
    canNotify() {
      if (typeof Notification === 'undefined') return false;
      this.permission = Notification.permission; // 최신 권한 상태로 동기화
      return this.permission === 'granted' && this.enabled;
    }

    // 알림 보내기 (브라우저 알림 + 토스트 fallback)
    notify(title, options = {}) {
      const {
        body = '',
        icon = '/assets/images/favicon.svg', // 프로젝트 경로에 맞춤
        tag,
        silent = false,
        requireInteraction = false, // true면 클릭 전까지 남아있음
        onClick = null,
      } = options;

      // UI 토스트는 항상 같이 (가시성 보장)
      UI?.info?.(`${title}${body ? ' — ' + body : ''}`);

      if (!this.canNotify()) return null;

      try {
        const notifOptions = { body, icon, requireInteraction, silent: silent || this.muted };
        if (typeof tag !== 'undefined') notifOptions.tag = tag;

        const n = new Notification(title, notifOptions);

        if (!silent && !this.muted && this.sound) {
          this.sound.currentTime = 0;
          this.sound.play().catch(() => {});
        }
        if (onClick) {
          n.onclick = (e) => {
            try { onClick(e); } catch {}
            window.focus?.();
            n.close?.();
          };
        } else {
          n.onclick = () => { window.focus?.(); n.close?.(); };
        }
        return n;
      } catch (e) {
        // 권한 이슈 등으로 실패 시 조용히 무시
        return null;
      }
    }

    // 탭이 background일 때만 알림 보내기
    notifyWhenHidden(title, options = {}) {
      if (document.hidden) {
        return this.notify(title, options);
      }
      return null;
    }

    // 일정 시간 뒤 알림 (간단 스케줄)
    schedule(title, options = {}, delayMs = 1000) {
      return setTimeout(() => this.notify(title, options), delayMs);
    }

    // 토글
    setEnabled(v) { this.enabled = !!v; }
    setMuted(v) { this.muted = !!v; }
  }

  window.PyxisNotify = new PyxisNotifications();

  // 첫 진입 시 권한 한번 물어보기 (원치 않으면 주석 처리)
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // 요청은 사용자 동작 이후에 트리거하는 게 UX에 더 좋습니다.
      // 여기서는 안내만 띄움.
      UI?.info?.('브라우저 알림을 허용하면 탭 밖에서도 전투 알림을 받을 수 있어요.');
    }
  });
})();