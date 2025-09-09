/* PYXIS Admin Client
   - 상태키: waiting | active | paused | ended
   - 소켓 이벤트:
     emit:   adminAuth
     on:     auth:success, authError, battle:update, battle:chat, battle:log, spectator:count
   - REST:
     POST /api/battles                 -> 전투 생성 (mode: 1v1|2v2|3v3|4v4, 기본 1v1)
     POST /api/battles/:id/start       -> 전투 시작
   - 고정된 DOM 아이디 규격에 의존:
     #authView, #mainView, #authBattle, #authToken, #btnAuth
     #statusPill, #rosterPhoenix, #rosterEaters, #timelineFeed
     선택: #btnStart, #btnCreate, #battleMode, #adminUrl, #playerBase, #spectatorBase,
           #btnCopyAdmin, #btnCopyPlayer, #btnCopySpectator, #spectatorCount, #chatInput, #btnChat, #chatMessages
   - 코드 내 이모지 금지
*/

(function () {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 필수 DOM
  const el = {
    viewAuth: $("#authView"),
    viewMain: $("#mainView"),

    authBattle: $("#authBattle"),
    authToken: $("#authToken"),
    btnAuth: $("#btnAuth"),

    statusPill: $("#statusPill"),
    rosterPhoenix: $("#rosterPhoenix"),
    rosterEaters: $("#rosterEaters"),
    timeline: $("#timelineFeed"),

    // 선택 요소들 (있으면 사용)
    btnStart: $("#btnStart"),
    btnCreate: $("#btnCreate"),
    battleMode: $("#battleMode"),
    adminUrl: $("#adminUrl"),
    playerBase: $("#playerBase"),
    spectatorBase: $("#spectatorBase"),
    btnCopyAdmin: $("#btnCopyAdmin"),
    btnCopyPlayer: $("#btnCopyPlayer"),
    btnCopySpectator: $("#btnCopySpectator"),
    spectatorCount: $("#spectatorCount"),

    // 채팅
    chatInput: $("#chatInput"),
    btnChat: $("#btnChat"),
    chatMessages: $("#chatMessages")
  };

  // -----------------------------
  // 상태
  // -----------------------------
  const state = {
    socket: null,
    battleId: null,
    token: null,
    status: "waiting",
    roster: [],
    log: [],
    spectatorCount: 0
  };

  // -----------------------------
  // 초기화
  // -----------------------------
  window.addEventListener("DOMContentLoaded", () => {
    connectSocket();
    autoAuthFromURL();
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

    // 알림 모듈(Optional)
    if (window.PyxisNotify && typeof window.PyxisNotify.init === "function") {
      window.PyxisNotify.init({ socket });
    }

    bindSocketEvents();
  }

  function bindSocketEvents() {
    const s = state.socket;
    if (!s) return;

    s.on("connect", () => { /* noop */ });
    s.on("disconnect", () => { /* noop */ });

    s.on("authError", (e) => {
      alert("인증 실패: " + (e && e.error ? e.error : ""));
    });

    s.on("auth:success", (p) => {
      if (p.role !== "admin") return;
      state.battleId = p.battleId;
      showMain();
      // 최초 상태 동기화를 위해 join
      s.emit("join", { battleId: state.battleId });
    });

    s.on("battle:update", (b) => {
      state.status = b.status || "waiting";
      state.roster = Array.isArray(b.players) ? b.players : [];
      state.log = Array.isArray(b.log) ? b.log : [];
      renderAll();
    });

    s.on("battle:chat", ({ name, message }) => {
      appendTimeline("chat", name ? `${name}: ${message}` : message);
    });

    s.on("battle:log", ({ type, message }) => {
      appendTimeline(type || "system", message || "");
    });

    s.on("spectator:count", ({ count }) => {
      state.spectatorCount = Number(count) || 0;
      renderSpectatorCount();
    });
  }

  // -----------------------------
  // UI 바인딩
  // -----------------------------
  function bindUI() {
    if (el.btnAuth) el.btnAuth.addEventListener("click", onAdminAuth);

    if (el.btnStart) el.btnStart.addEventListener("click", onStartBattle);

    if (el.btnCreate) el.btnCreate.addEventListener("click", onCreateBattle);

    if (el.btnCopyAdmin) el.btnCopyAdmin.addEventListener("click", () => copyField(el.adminUrl));
    if (el.btnCopyPlayer) el.btnCopyPlayer.addEventListener("click", () => copyField(el.playerBase));
    if (el.btnCopySpectator) el.btnCopySpectator.addEventListener("click", () => copyField(el.spectatorBase));

    if (el.btnChat) el.btnChat.addEventListener("click", sendChat);
    if (el.chatInput) el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }

  // -----------------------------
  // 자동 인증 URL 파라미터
  // -----------------------------
  function autoAuthFromURL() {
    const params = new URLSearchParams(location.search);
    const battle = params.get("battle");
    const token = params.get("token");

    if (battle) el.authBattle && (el.authBattle.value = battle);
    if (token) el.authToken && (el.authToken.value = token);

    if (battle && token) onAdminAuth();
  }

  // -----------------------------
  // 관리자 인증
  // -----------------------------
  function onAdminAuth() {
    const battleId =
      (el.authBattle && el.authBattle.value || "").trim() ||
      new URLSearchParams(location.search).get("battle");
    const token =
      (el.authToken && el.authToken.value || "").trim() ||
      new URLSearchParams(location.search).get("token");
    if (!battleId || !token) {
      alert("전투 ID와 비밀번호를 입력하세요.");
      return;
    }
    state.token = token;
    state.socket.emit("adminAuth", { battleId, token });
  }

  // -----------------------------
  // 전투 생성 (기본 1v1, 드롭다운으로 2v2/3v3/4v4 선택 가능)
  // -----------------------------
  async function onCreateBattle() {
    try {
      const modeSel = el.battleMode;
      const mode = (modeSel && modeSel.value) || "1v1";

      const res = await fetch("/api/battles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const json = await res.json();

      if (!json || !json.ok) {
        alert("전투 생성에 실패했습니다.");
        return;
      }
      // 링크 표출
      if (el.adminUrl) el.adminUrl.value = json.adminUrl || "";
      if (el.playerBase) el.playerBase.value = json.playerBase || "";
      if (el.spectatorBase) el.spectatorBase.value = json.spectatorBase || "";

      // 인증창에 자동 채움
      if (el.authBattle) el.authBattle.value = json.id || "";
      if (el.authToken) {
        const u = new URL(json.adminUrl, location.origin);
        el.authToken.value = u.searchParams.get("token") || "";
      }

      appendTimeline("system", `전투가 생성되었습니다. 모드: ${mode}`);
    } catch (e) {
      console.error(e);
      alert("전투 생성 중 오류가 발생했습니다.");
    }
  }

  // -----------------------------
  // 전투 시작
  // -----------------------------
  async function onStartBattle() {
    if (!state.battleId) {
      alert("관리자 인증 후 사용할 수 있습니다.");
      return;
    }
    try {
      const res = await fetch(`/api/battles/${state.battleId}/start`, { method: "POST" });
      if (!res.ok) {
        alert("전투 시작에 실패했습니다.");
        return;
      }
      appendTimeline("system", "전투를 시작했습니다.");
    } catch (e) {
      console.error(e);
      alert("전투 시작 중 오류가 발생했습니다.");
    }
  }

  // -----------------------------
  // 채팅
  // -----------------------------
  function sendChat() {
    const msg = (el.chatInput && el.chatInput.value || "").trim();
    if (!msg) return;
    // 채팅은 현재 관리자 클라이언트에서만 전송하므로 이름은 공백 처리
    state.socket.emit("chat:send", { battleId: state.battleId, name: "관리자", message: msg });
    el.chatInput.value = "";
  }

  // -----------------------------
  // 렌더링
  // -----------------------------
  function renderAll() {
    renderStatus();
    renderRoster();
    renderTimelineFromState();
    renderSpectatorCount();
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

  function renderTimelineFromState() {
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
    capTimeline(200);
    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  function appendTimeline(type, message) {
    if (!el.timeline) return;
    const line = document.createElement("div");
    line.className = `tl-line tl-${type || "system"}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message || ""}`;
    el.timeline.appendChild(line);
    capTimeline(200);
    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  function capTimeline(max) {
    if (!el.timeline) return;
    const lines = el.timeline.querySelectorAll(".tl-line");
    if (lines.length > max) {
      for (let i = 0; i < lines.length - max; i++) lines[i].remove();
    }
  }

  function renderSpectatorCount() {
    if (!el.spectatorCount) return;
    el.spectatorCount.textContent = String(state.spectatorCount || 0);
  }

  // -----------------------------
  // 복사 도우미
  // -----------------------------
  async function copyField(inputEl) {
    if (!inputEl) return;
    const value = (inputEl.value || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      flashCopied(inputEl);
    } catch {
      // 폴백
      inputEl.select();
      document.execCommand("copy");
      flashCopied(inputEl);
    }
  }

  function flashCopied(elm) {
    elm.classList.add("copied");
    setTimeout(() => elm.classList.remove("copied"), 800);
  }

  // -----------------------------
  // 화면 전환
  // -----------------------------
  function showMain() {
    if (el.viewAuth) el.viewAuth.classList.add("hidden");
    if (el.viewMain) el.viewMain.classList.remove("hidden");
  }
})();
