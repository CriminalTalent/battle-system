/* PYXIS Spectator Client
   - 상태키: waiting | active | paused | ended
   - 고정 응원 버튼 6개, 단축키 없음
   - 타임라인 최대 200라인 유지
   - 인증 입력: 전투 ID + 비밀번호(내부 키는 otp)
   - socket:
     emit: spectatorAuth({ battleId, otp, name }), join({ battleId }), chat:send, cheer:send
     on:   auth:success, authError, battle:update, battle:chat, battle:log, spectator:count
   - 이모지 사용 금지
*/

(function () {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // -----------------------------
  // Elements
  // -----------------------------
  const el = {
    // 인증
    viewAuth: $("#authView"),
    authBattle: $("#authBattle"),
    authOtp: $("#authOtp"),      // 화면엔 '비밀번호'로 표기되지만 내부 키는 otp
    authName: $("#authName"),
    btnAuth: $("#btnAuth"),

    // 메인
    viewMain: $("#mainView"),
    statusPill: $("#statusPill"),
    spectatorCount: $("#spectatorCount"),

    // 로스터
    rosterPhoenix: $("#rosterPhoenix"),
    rosterEaters: $("#rosterEaters"),

    // 타임라인
    timeline: $("#timelineFeed"),

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
      btn.textContent = CHEER_MENT[idx] || "";
      btn.setAttribute("data-cheer", CHEER_MENT[idx] || "");
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
  // Socket events
  // -----------------------------
  function bindSocket() {
    const s = state.socket;
    if (!s) return;

    s.on("connect", () => { /* noop */ });
    s.on("disconnect", () => { /* noop */ });

    s.on("authError", (e) => {
      alert("인증 실패: " + (e && e.error ? e.error : ""));
    });

    s.on("auth:success", (p) => {
      if (p.role !== "spectator") return;
      state.battleId = p.battleId;
      showMain();
      // 상태 동기화를 위해 룸 합류
      s.emit("join", { battleId: state.battleId });
    });

    s.on("battle:update", (b) => {
      state.status = b.status || "waiting";
      state.roster = Array.isArray(b.players) ? b.players : [];
      state.log = Array.isArray(b.log) ? b.log : [];
      renderAll();
    });

    s.on("battle:chat", ({ name, message }) => {
      appendChat(name, message);
    });

    s.on("battle:log", ({ type, message }) => {
      appendLog(type, message);
    });

    s.on("spectator:count", ({ count }) => {
      state.spectatorCount = Number(count) || 0;
      if (el.spectatorCount) el.spectatorCount.textContent = String(state.spectatorCount);
    });
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
          setTimeout(() => btn.classList.remove("shimmer"), 1500);
        } catch (_) {}
      });
    });
  }

  function autoFillFromURL() {
    const params = new URLSearchParams(location.search);
    const battle = params.get("battle");
    const otp = params.get("otp");     // 내부 키는 여전히 otp
    const name = params.get("name");

    if (battle) el.authBattle && (el.authBattle.value = battle);
    if (otp) el.authOtp && (el.authOtp.value = otp);
    if (name) el.authName && (el.authName.value = name);

    if (battle && otp) onAuth(); // 이름은 선택 입력
  }

  function onAuth() {
    const params = new URLSearchParams(location.search);
    const battleId =
      (el.authBattle && el.authBattle.value || "").trim() || params.get("battle");
    const otp =
      (el.authOtp && el.authOtp.value || "").trim() || params.get("otp");
    const name =
      (el.authName && el.authName.value || "").trim() || params.get("name");

    if (!battleId || !otp) {
      alert("전투 ID와 비밀번호를 입력하세요.");
      return;
    }
    state.socket.emit("spectatorAuth", { battleId, otp, name });
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
    el.timeline.innerHTML = "";

    const list = Array.isArray(state.log) ? state.log.slice(-200) : [];
    for (const l of list) {
      const line = document.createElement("div");
      line.className = `tl-line tl-${l.type || "system"}`;
      const ts = new Date(l.ts || Date.now());
      line.textContent = `[${ts.toLocaleTimeString()}] ${l.message || ""}`;
      el.timeline.appendChild(line);
    }

    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  // -----------------------------
  // Chat & Cheer
  // -----------------------------
  function sendChat() {
    if (!state.battleId) return;
    const message = (el.chatInput && el.chatInput.value || "").trim();
    const name = (el.authName && el.authName.value) || "";
    if (!message) return;
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
    state.socket.emit("cheer:send", { battleId: state.battleId, cheer });
  }

  function appendLog(type, message) {
    if (!el.timeline) return;
    const line = document.createElement("div");
    line.className = `tl-line tl-${type || "system"}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message || ""}`;
    el.timeline.appendChild(line);
    capChildren(el.timeline, 200);
    el.timeline.scrollTop = el.timeline.scrollHeight;
    // 시각효과: 새 줄 강조
    try {
      line.classList.add("tl-flash");
      setTimeout(() => line.classList.remove("tl-flash"), 1200);
    } catch (_) {}
  }

  function capChildren(container, max) {
    const nodes = container.querySelectorAll(":scope > *");
    if (nodes.length > max) {
      for (let i = 0; i < nodes.length - max; i++) nodes[i].remove();
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
})();
