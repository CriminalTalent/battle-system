/* PYXIS Admin Client (no separate auth page)
   - 메인 화면만 존재. 전투 생성 → 자동 관리자 인증
   - 기존 전투에 붙기: 상단 "전투 연결" 박스에서 ID/비밀번호 입력 후 [전투 연결]
   - 소켓 채널:
     emit:   adminAuth, join, chat:send
     on:     auth:success, authError, battle:update, battle:chat, battle:log, spectator:count
   - REST:
     POST /api/battles                 -> 전투 생성 (mode: 1v1|2v2|3v3|4v4)
     POST /api/battles/:id/start       -> 전투 시작
   - 이모지 금지
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
    statusPill: $("#statusPill"),
    rosterPhoenix: $("#rosterPhoenix"),
    rosterEaters: $("#rosterEaters"),
    timeline: $("#timelineFeed"),

    // 전투 생성
    battleMode: $("#battleMode"),
    btnCreate: $("#btnCreate"),
    adminUrl: $("#adminUrl"),
    playerBase: $("#playerBase"),
    spectatorBase: $("#spectatorBase"),
    btnCopyAdmin: $("#btnCopyAdmin"),
    btnCopyPlayer: $("#btnCopyPlayer"),
    btnCopySpectator: $("#btnCopySpectator"),

    // 실행
    btnStart: $("#btnStart"),

    // 연결(기존 전투 합류용)
    connectBattle: $("#connectBattle"),
    connectToken: $("#connectToken"),
    btnConnect: $("#btnConnect"),

    // 채팅
    chatMessages: $("#chatMessages"),
    chatInput: $("#chatInput"),
    btnChat: $("#btnChat"),

    spectatorCount: $("#spectatorCount"),
  };

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    socket: null,
    battleId: null,
    token: null,
    status: "waiting",
    roster: [],
    log: [],
    spectatorCount: 0,
    authed: false,
  };

  // -----------------------------
  // Init
  // -----------------------------
  window.addEventListener("DOMContentLoaded", () => {
    connectSocket();
    bindUI();
    autoConnectFromURL();
  });

  function connectSocket() {
    const url = (window.PyxisSocket && window.PyxisSocket.url) || undefined;
    const socket = window.io ? window.io(url, { transports: ["websocket"], withCredentials: true }) : null;
    if (!socket) {
      alert("Socket.IO가 로드되지 않았습니다.");
      return;
    }
    state.socket = socket;

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
      state.authed = false;
      alert("인증 실패: " + (e && e.error ? e.error : ""));
    });

    s.on("auth:success", (p) => {
      if (p.role !== "admin") return;
      state.authed = true;
      state.battleId = p.battleId;
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
  // UI
  // -----------------------------
  function bindUI() {
    if (el.btnCreate) el.btnCreate.addEventListener("click", onCreateBattle);
    if (el.btnStart) el.btnStart.addEventListener("click", onStartBattle);

    if (el.btnCopyAdmin) el.btnCopyAdmin.addEventListener("click", () => copyField(el.adminUrl));
    if (el.btnCopyPlayer) el.btnCopyPlayer.addEventListener("click", () => copyField(el.playerBase));
    if (el.btnCopySpectator) el.btnCopySpectator.addEventListener("click", () => copyField(el.spectatorBase));

    if (el.btnConnect) el.btnConnect.addEventListener("click", onConnectExisting);

    if (el.btnChat) el.btnChat.addEventListener("click", sendChat);
    if (el.chatInput) el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }

  // URL 파라미터로 자동 연결 (?battle=...&token=...)
  function autoConnectFromURL() {
    const params = new URLSearchParams(location.search);
    const battle = params.get("battle");
    const token = params.get("token");
    if (battle && token) {
      state.battleId = battle;
      state.token = token;
      adminAuth(battle, token);
    }
  }

  // -----------------------------
  // Battle ops
  // -----------------------------
  async function onCreateBattle() {
    try {
      const mode = (el.battleMode && el.battleMode.value) || "1v1";

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

      // 링크 채우기
      if (el.adminUrl) el.adminUrl.value = json.adminUrl || "";
      if (el.playerBase) el.playerBase.value = json.playerBase || "";
      if (el.spectatorBase) el.spectatorBase.value = json.spectatorBase || "";

      // 자동 관리자 인증
      try {
        const url = new URL(json.adminUrl);
        const battleId = url.searchParams.get("battle");
        const token = url.searchParams.get("token");
        if (battleId && token) {
          state.battleId = battleId;
          state.token = token;
          if (el.connectBattle) el.connectBattle.value = battleId;
          if (el.connectToken) el.connectToken.value = token;
          adminAuth(battleId, token);
        }
      } catch (e) {
        // ignore
      }

      appendTimeline("system", `전투가 생성되었습니다. 모드: ${mode}`);
    } catch (e) {
      console.error(e);
      alert("전투 생성 중 오류가 발생했습니다.");
    }
  }

  function onConnectExisting() {
    const battleId = (el.connectBattle && el.connectBattle.value || "").trim();
    const token = (el.connectToken && el.connectToken.value || "").trim();
    if (!battleId || !token) {
      alert("전투 ID와 비밀번호를 입력하세요.");
      return;
    }
    state.battleId = battleId;
    state.token = token;
    adminAuth(battleId, token);
  }

  async function onStartBattle() {
    if (!state.battleId) {
      alert("먼저 전투를 생성하거나 연결하세요.");
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
  // Socket helpers
  // -----------------------------
  function adminAuth(battleId, token) {
    state.socket.emit("adminAuth", { battleId, token });
  }

  // -----------------------------
  // Chat & Timeline
  // -----------------------------
  function sendChat() {
    if (!state.battleId) return;
    const msg = (el.chatInput && el.chatInput.value || "").trim();
    if (!msg) return;
    state.socket.emit("chat:send", { battleId: state.battleId, name: "관리자", message: msg });
    el.chatInput.value = "";
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

  // -----------------------------
  // Render
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
        `<div class="pc-name">${escapeHtml(p.name)}</div>`,
        `<div class="pc-hp">HP ${Number(p.hp || 0)}</div>`
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

  function renderSpectatorCount() {
    if (!el.spectatorCount) return;
    el.spectatorCount.textContent = String(state.spectatorCount || 0);
  }

  // -----------------------------
  // Utils
  // -----------------------------
  function copyField(inputEl) {
    if (!inputEl) return;
    const value = (inputEl.value || "").trim();
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {
      inputEl.select();
      document.execCommand("copy");
    });
    flashCopied(inputEl);
  }

  function flashCopied(elm) {
    elm.classList.add("copied");
    setTimeout(() => elm.classList.remove("copied"), 800);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
