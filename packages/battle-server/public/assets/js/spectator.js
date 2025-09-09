/* PYXIS Spectator Client
   - 상태키: waiting | active | paused | ended
   - 고정 응원 버튼 6개, 단축키 없음
   - 타임라인 최대 200라인 유지
   - socket:
     emit: spectatorAuth, join, chat:send, cheer:send
     on:   auth:success, authError, battle:update, battle:chat, battle:log, spectator:count
*/

(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const el = {
    // 인증
    viewAuth: $("#authView"),
    authBattle: $("#authBattle"),
    authOtp: $("#authOtp"),
    authName: $("#authName"),
    btnAuth: $("#btnAuth"),

    // 메인
    viewMain: $("#mainView"),
    statusPill: $("#statusPill"),
    spectatorCount: $("#spectatorCount"),

    rosterPhoenix: $("#rosterPhoenix"),
    rosterEaters: $("#rosterEaters"),

    timeline: $("#timelineFeed"),

    chatMessages: $("#chatMessages"),
    chatInput: $("#chatInput"),
    btnChat: $("#btnChat"),

    cheerButtons: $$(".cheer-btn"),
  };

  const state = {
    socket: null,
    battleId: null,
    status: "waiting",
    roster: [],
    log: []
  };

  window.addEventListener("DOMContentLoaded", () => {
    connectSocket();
    autoFillFromURL();
    bindUI();
  });

  function connectSocket() {
    const url = (window.PyxisSocket && window.PyxisSocket.url) || undefined;
    const socket = window.io ? window.io(url, { transports: ["websocket"], withCredentials: true }) : null;
    if (!socket) {
      alert("Socket.IO가 로드되지 않았습니다.");
      return;
    }
    state.socket = socket;

    // 공용 알림(선택)
    if (window.PyxisNotify && typeof window.PyxisNotify.init === "function") {
      window.PyxisNotify.init({ socket });
    }

    bindSocket();
  }

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
      if (el.spectatorCount) el.spectatorCount.textContent = String(Number(count) || 0);
    });
  }

  function bindUI() {
    if (el.btnAuth) el.btnAuth.addEventListener("click", onAuth);

    if (el.btnChat) el.btnChat.addEventListener("click", sendChat);
    if (el.chatInput) el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });

    // 고정 6개 응원 버튼
    el.cheerButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const cheer = btn.getAttribute("data-cheer") || btn.textContent || "";
        sendCheer(cheer);
      });
    });

    // 단축키 없음: 의도적으로 keydown 바인딩을 추가하지 않음
  }

  function autoFillFromURL() {
    const params = new URLSearchParams(location.search);
    const battle = params.get("battle");
    const otp = params.get("otp");
    const name = params.get("name");

    if (battle) el.authBattle && (el.authBattle.value = battle);
    if (otp) el.authOtp && (el.authOtp.value = otp);
    if (name) el.authName && (el.authName.value = name);

    if (battle && otp) onAuth();
  }

  function onAuth() {
    const battleId = (el.authBattle && el.authBattle.value || "").trim() || new URLSearchParams(location.search).get("battle");
    const otp = (el.authOtp && el.authOtp.value || "").trim() || new URLSearchParams(location.search).get("otp");
    const name = (el.authName && el.authName.value || "").trim() || new URLSearchParams(location.search).get("name");
    if (!battleId || !otp) {
      alert("Battle ID와 OTP를 입력하세요.");
      return;
    }
    state.socket.emit("spectatorAuth", { battleId, otp, name });
  }

  function sendChat() {
    if (!state.battleId) return;
    const message = (el.chatInput && el.chatInput.value || "").trim();
    const name = (el.authName && el.authName.value) || "";
    if (!message) return;
    state.socket.emit("chat:send", { battleId: state.battleId, name, message });
    el.chatInput.value = "";
  }

  function sendCheer(cheer) {
    if (!state.battleId) return;
    state.socket.emit("cheer:send", { battleId: state.battleId, cheer });
  }

  // 렌더링
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
        `<div class="pc-name">${p.name}</div>`,
        `<div class="pc-hp">HP ${p.hp}</div>`
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

  // 화면 전환
  function showMain() {
    if (el.viewAuth) el.viewAuth.classList.add("hidden");
    if (el.viewMain) el.viewMain.classList.remove("hidden");
  }
})();
