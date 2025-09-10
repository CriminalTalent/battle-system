/* packages/battle-server/public/assets/js/spectator.js
   PYXIS Spectator Client
   - 상태키: waiting | active | paused | ended
   - 고정 응원 버튼 6개, 단축키 없음
   - 타임라인 최대 200라인 유지
   - 인증 입력: 전투 ID + 비밀번호(내부 키는 otp)
   - socket (양쪽 호환):
     emit: spectatorAuth({ battleId, otp, name }) 또는 spectator:auth, join({ battleId })
           spectator:chat 또는 chat:send, spectator:cheer 또는 cheer:send
     on:   auth:success, authError 또는 auth:error, battle:update, battle:chat 또는 chat:message,
           battle:log, spectator:count 또는 spectator:count_update
   - 이모지 사용 금지
*/

(function () {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // -----------------------------
  // Elements (양쪽 ID 동시 지원)
  // -----------------------------
  const el = {
    // 인증
    viewAuth: $("#authView"),
    authBattle: $("#authBattle"),
    authOtp: $("#authOtp") || $("#authToken"), // 내부 키는 otp, 페이지에선 token일 수 있음
    authName: $("#authName"),
    btnAuth: $("#btnAuth"),

    // 메인
    viewMain: $("#mainView"),
    statusPill: $("#statusPill"),
    spectatorCount: $("#spectatorCount"), // 없으면 무시

    // 로스터
    rosterPhoenix: $("#rosterPhoenix"),
    rosterEaters: $("#rosterEaters"),

    // 타임라인(둘 중 하나를 사용)
    timeline: $("#timelineFeed") || $("#battleLog"),

    // 채팅
    chatMessages: $("#chatMessages"),
    chatInput: $("#chatInput"),
    btnChat: $("#btnChat"),

    // 응원
    cheerButtons: $$(".cheer-btn")
  };

  // 고정 응원 멘트
  const CHEER_MENT = [
    "멋지다!",
    "이겨라!",
    "살아서 돌아와!",
    "화이팅!",
    "죽으면 나한테 죽어!",
    "힘내요!"
  ];

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    socket: null,
    battleId: null,
    status: "waiting",
    roster: [],
    log: [],
    spectatorCount: 0
  };

  // -----------------------------
  // Init
  // -----------------------------
  window.addEventListener("DOMContentLoaded", () => {
    setCheerButtonLabels();
    connectSocket();
    autoFillFromURL();
    bindUI();
  });

  function setCheerButtonLabels() {
    el.cheerButtons.forEach((btn, idx) => {
      const label = CHEER_MENT[idx] || "";
      btn.textContent = label;
      btn.setAttribute("data-cheer", label);
    });
  }

  function connectSocket() {
    const url = (window.PyxisSocket && window.PyxisSocket.url) || undefined;
    const socket = window.io ? window.io(url, { transports: ["websocket"], withCredentials: true }) : null;
    if (!socket) {
      alert("Socket.IO가 로드되지 않았습니다.");
      return;
    }
    state.socket = socket;

    // 알림 모듈(Optional)
    if (window.PyxisNotify && typeof window.PyxisNotify.init === "function") {
      window.PyxisNotify.init({ socket });
    }

    bindSocket();
  }

  // -----------------------------
  // Socket events (양쪽 호환)
  // -----------------------------
  function bindSocket() {
    const s = state.socket;
    if (!s) return;

    s.on("connect", () => { /* noop */ });
    s.on("disconnect", () => { /* noop */ });

    // 인증 오류 호환
    s.on("authError", (e) => {
      alert("인증 실패: " + (e && (e.error || e.message) ? (e.error || e.message) : ""));
    });
    s.on("auth:error", (e) => {
      alert("인증 실패: " + (e && (e.error || e.message) ? (e.error || e.message) : ""));
    });

    s.on("auth:success", (p) => {
      // 서버에 따라 payload 다름: { type:'spectator', spectatorName, battle } 또는 { role:'spectator', battleId, ... }
      // battleId는 인증 시점 입력값을 그대로 사용
      if ((p.type || p.role) !== "spectator") return;
      showMain();

      // 최초 상태 동기화
      if (p.battle) {
        applyBattleSnapshot(p.battle);
        renderAll();
      }

      // 상태 동기화를 위해 룸 합류
      if (state.battleId) s.emit("join", { battleId: state.battleId });
    });

    s.on("battle:update", (b) => {
      applyBattleSnapshot(b);
      renderAll();
    });

    // 채팅 수신 호환
    s.on("battle:chat", ({ name, message }) => {
      appendChat(name, message);
    });
    s.on("chat:message", (payload) => {
      // payload: { senderName, message, type, ... } 형태 가능
      const name = payload && (payload.senderName || payload.name) ? (payload.senderName || payload.name) : "";
      const message = payload && payload.message ? payload.message : "";
      appendChat(name, message);
    });

    // 로그 수신
    s.on("battle:log", ({ type, message, ts }) => {
      appendLog(type, message, ts);
    });

    // 관전자 수 갱신 호환
    s.on("spectator:count", ({ count }) => {
      updateSpectatorCount(count);
    });
    s.on("spectator:count_update", ({ count }) => {
      updateSpectatorCount(count);
    });
  }

  function applyBattleSnapshot(b) {
    if (!b) return;
    state.status = b.status || "waiting";
    state.roster = Array.isArray(b.players) ? b.players : [];
    // 서버가 로그 배열을 안 줄 수도 있음
    if (Array.isArray(b.logs)) {
      state.log = b.logs;
    }
  }

  function updateSpectatorCount(count) {
    state.spectatorCount = Number(count) || 0;
    if (el.spectatorCount) el.spectatorCount.textContent = String(state.spectatorCount);
  }

  // -----------------------------
  // UI handlers
  // -----------------------------
  function bindUI() {
    if (el.btnAuth) el.btnAuth.addEventListener("click", onAuth);

    if (el.btnChat) el.btnChat.addEventListener("click", sendChat);
    if (el.chatInput) el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });

    // 고정 6개 응원 버튼 (단축키 없음)
    el.cheerButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const cheer = btn.getAttribute("data-cheer") || btn.textContent || "";
        sendCheer(cheer);
        // 시각효과(effects.css/.js가 있으면 shimmer 클래스 적용)
        try {
          btn.classList.add("shimmer");
          setTimeout(() => btn.classList.remove("shimmer"), 1200);
        } catch (_) {}
      });
    });
  }

  function autoFillFromURL() {
    const params = new URLSearchParams(location.search);
    const battle = params.get("battle");
    const otpParam = params.get("otp") || params.get("token"); // 내부 키는 otp, 링크는 token일 수 있음
    const name = params.get("name");

    if (battle) el.authBattle && (el.authBattle.value = battle);
    if (otpParam) el.authOtp && (el.authOtp.value = otpParam);
    if (name) el.authName && (el.authName.value = name);

    if (battle && otpParam) {
      // 이름은 선택 입력
      state.battleId = battle;
      onAuth();
    }
  }

  function onAuth() {
    const params = new URLSearchParams(location.search);
    const battleId = (el.authBattle && el.authBattle.value || "").trim() || params.get("battle");
    const otpInput = (el.authOtp && el.authOtp.value || "").trim() || params.get("otp") || params.get("token");
    const name = (el.authName && el.authName.value || "").trim() || params.get("name") || "";

    if (!battleId || !otpInput) {
      alert("전투 ID와 비밀번호를 입력하세요.");
      return;
    }

    // 내부 상태에 battleId 저장
    state.battleId = battleId;

    // 서버 호환: spectatorAuth / spectator:auth 모두 전송
    const payloadV1 = { battleId, otp: otpInput, name };
    const payloadV2 = { battleId, token: otpInput, spectatorName: name };

    state.socket.emit("spectatorAuth", payloadV1);
    state.socket.emit("spectator:auth", payloadV2);
  }

  // -----------------------------
  // Render
  // -----------------------------
  function renderAll() {
    renderStatus();
    renderRoster();
    renderTimeline();
  }

  function renderStatus() {
    if (!el.statusPill) return;
    const s = state.status;
    el.statusPill.textContent =
      s === "active" ? "전투 진행 중" :
      s === "ended" ? "전투 종료" :
      s === "paused" ? "전투 일시정지" :
      "전투 대기 중";
    el.statusPill.className = `status-pill ${s}`;
  }

  function renderRoster() {
    if (!el.rosterPhoenix || !el.rosterEaters) return;
    el.rosterPhoenix.innerHTML = "";
    el.rosterEaters.innerHTML = "";

    const roster = Array.isArray(state.roster) ? state.roster : [];
    for (const p of roster) {
      const card = document.createElement("div");
      card.className = "player-card";
      card.innerHTML = [
        `<div class="pc-name">${escapeHtml(p.name)}</div>`,
        `<div class="pc-hp">HP ${Number(p.hp || 0)}</div>`
      ].join("");
      (p.team === "phoenix" ? el.rosterPhoenix : el.rosterEaters).appendChild(card);
    }
  }

  function renderTimeline() {
    if (!el.timeline) return;

    // 이미 수신해 둔 state.log가 있으면 사용하고, 없으면 그대로 유지
    if (Array.isArray(state.log) && state.log.length) {
      el.timeline.innerHTML = "";
      const list = state.log.slice(-200);
      for (const l of list) {
        const line = document.createElement("div");
        line.className = `tl-line tl-${l.type || "system"}`;
        const ts = new Date(l.ts || Date.now());
        line.textContent = `[${ts.toLocaleTimeString()}] ${l.message || ""}`;
        el.timeline.appendChild(line);
      }
      el.timeline.scrollTop = el.timeline.scrollHeight;
    }
  }

  // -----------------------------
  // Chat & Cheer
  // -----------------------------
  function sendChat() {
    if (!state.battleId) return;
    const name = (el.authName && el.authName.value) || "";
    const message = (el.chatInput && el.chatInput.value || "").trim();
    if (!message) return;

    // 관전자 전용 라우트 우선, 공용 채널도 호환 전송
    state.socket.emit("spectator:chat", { message });
    state.socket.emit("chat:send", { battleId: state.battleId, name, message });

    el.chatInput.value = "";
  }

  function appendChat(name, message) {
    if (!el.chatMessages) return;
    const line = document.createElement("div");
    line.className = "chat-line";
    line.textContent = name ? `${name}: ${message}` : message;
    el.chatMessages.appendChild(line);
    capChildren(el.chatMessages, 200);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function sendCheer(cheer) {
    if (!state.battleId) return;
    const message = String(cheer || "").trim();
    if (!message) return;

    // 관전자 응원 라우트 우선, 호환 이벤트도 함께 전송
    state.socket.emit("spectator:cheer", { message });
    state.socket.emit("cheer:send", { battleId: state.battleId, cheer: message });
  }

  function appendLog(type, message, ts) {
    if (!el.timeline) return;
    const line = document.createElement("div");
    line.className = `tl-line tl-${type || "system"}`;
    const when = ts ? new Date(ts) : new Date();
    line.textContent = `[${when.toLocaleTimeString()}] ${message || ""}`;
    el.timeline.appendChild(line);
    capChildren(el.timeline, 200);
    el.timeline.scrollTop = el.timeline.scrollHeight;

    // 시각효과: 새 줄 강조 (선택)
    try {
      line.classList.add("tl-flash");
      setTimeout(() => line.classList.remove("tl-flash"), 1200);
    } catch (_) {}
  }

  function capChildren(container, max) {
    const nodes = container ? container.children : null;
    if (!nodes) return;
    while (container.children.length > max) {
      container.removeChild(container.firstElementChild);
    }
  }

  // -----------------------------
  // Utils
  // -----------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // -----------------------------
  // View switch
  // -----------------------------
  function showMain() {
    if (el.viewAuth) el.viewAuth.classList.add("hidden");
    if (el.viewMain) el.viewMain.classList.remove("hidden");
  }

  // 전투 룰 계산 함수는 common-battle-rules.js에서 import하여 사용하세요.
  // <script src="/assets/js/common-battle-rules.js"></script> 를 spectator.html에 추가하면 전역에서 사용 가능합니다.
  // calcAttack(player, target)
  // calcHit(player)
  // calcDodge(player)
  // isCritical(player)
  // calcDefense(player, attacker)
  // calcDamage(attacker, defender)
  // isDodgeSuccess(player, attacker)
  // useAtkItem(player)
  // useDefItem(player)
  // useHealItem(player)
})();
