/* PYXIS Notifications
   - Desktop Notification + 사운드 재생
   - 호출 방식: window.PyxisNotify.init({ socket })
   - socket 이벤트: battle:update, battle:log
   - 이모지 사용 금지
*/

(function () {
  "use strict";

  const Notify = {
    socket: null,
    audio: null,
    enabled: true
  };

  // -----------------------------
  // 초기화
  // -----------------------------
  Notify.init = function ({ socket }) {
    this.socket = socket;
    if (!("Notification" in window)) {
      console.warn("[PYXIS Notify] Notification API not supported.");
      this.enabled = false;
      return;
    }

    // 권한 요청
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    // 알림 사운드 미리 준비
    try {
      this.audio = new Audio("/assets/notify.mp3");
      this.audio.volume = 0.6;
    } catch (e) {
      console.warn("[PYXIS Notify] Audio init failed", e);
    }

    bindSocket(socket);
  };

  // -----------------------------
  // 소켓 바인딩
  // -----------------------------
  function bindSocket(socket) {
    if (!socket) return;

    socket.on("battle:update", (b) => {
      if (!b || b.status !== "active") return;
      // 내 턴 알림
      const meId = window.__PYXIS_PLAYER_ID || null;
      if (meId && (b.current === meId)) {
        Notify.show("당신의 턴입니다!", "지금 행동하세요.");
      }
    });

    socket.on("battle:log", ({ type, message }) => {
      if (type === "cheer") {
        Notify.show("응원", message);
      }
    });
  }

  // -----------------------------
  // 표시
  // -----------------------------
  Notify.show = function (title, body) {
    if (!this.enabled) return;

    if (Notification.permission === "granted") {
      const n = new Notification(title, {
        body: body || "",
        icon: "/assets/icon.png"
      });
      setTimeout(() => n.close(), 4000);
    }

    if (this.audio) {
      try {
        this.audio.currentTime = 0;
        this.audio.play();
      } catch (e) {
        // ignore
      }
    }
  };

  window.PyxisNotify = Notify;
})();
