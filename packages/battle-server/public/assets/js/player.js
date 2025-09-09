/* PYXIS Player Client
   - 상태키: waiting | active | paused | ended
   - 소켓 이벤트:
     emit:   playerAuth, player:ready, player:action, chat:send
     on:     auth:success, authError, battle:update, battle:chat, battle:log
   - 의존(있으면 사용, 없어도 동작):
     window.PyxisNotify.init({ socket })
     window.PYXISTargetSelector.open({ players, onPick })
     window.PyxisSocket.url (소켓 엔드포인트 커스터마이즈)
   - 코드 내 이모지 사용 금지
*/

(function () {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 필수 DOM (player.html의 고정 아이디 규격)
  const el = {
    // 인증/메인
    viewAuth: $("#authView"),
    viewMain: $("#mainView"),

    // 인증 입력
    authBattle: $("#authBattle"),
    authName: $("#authName"),
    authToken: $("#authToken"),
    btnAuth: $("#btnAuth"),

    // 상태/정보
    statusPill: $("#statusPill"),
    turnHint: $("#turnHint"),
    myPanel: $("#myPanel"),

    // 팀 로스터
    rosterPhoenix: $("#rosterPhoenix"),
    rosterEaters: $("#rosterEaters"),

    // 로그/채팅
    battleLog: $("#battleLog"),
    chatMessages: $("#chatMessages"),
    chatInput: $("#chatInput"),
    btnChat: $("#btnChat"),

    // 액션 버튼
    btnReady: $("#btnReady"),
    btnAtk: $("#btnAtk"),
    btnDef: $("#btnDef"),
    btnDodge: $("#btnDodge"),
    btnItemAtk: $("#btnItemAtk"),
    btnItemDef: $("#btnItemDef"),
    btnItemHeal: $("#btnItemHeal"),
    btnPass: $("#btnPass"),

    // 선택 타깃 안내(선택 사항)
    targetHint: $("#targetHint")
  };

  // -----------------------------
  // 상태
  // -----------------------------
  const state = {
    socket: null,
    battleId: null,
    playerId: null,
    status: "waiting", // waiting | active | paused | ended
    current: null,     // teamKey 또는 playerId
    roster: [],
    log: []
  };

  // -----------------------------
  // 초기화
  // -----------------------------
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
      if (p.role !== "player") return;
      state.battleId = p.battleId;
      state.playerId = p.playerId;
      // 내 전투 참여자 ID를 알림 모듈에서 활용할 수 있도록 노출
      window.__PYXIS_PLAYER_ID = p.playerId;
      showMain();
      // 서버 최신 상태 요청을 위해 룸 조인
      s.emit("join", { battleId: state.battleId });
    });

    s.on("battle:update", (b) => {
      state.status = b.status || "waiting";
      state.current = b.current || null;
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
  }

  // -----------------------------
  // UI 바인딩
  // -----------------------------
  function bindUI() {
    if (el.btnAuth) el.btnAuth.addEventListener("click", onAuth);
    if (el.btnReady) el.btnReady.addEventListener("click", onReady);

    // 전투 액션
    if (el.btnAtk) el.btnAtk.addEventListener("click", onAttack);
    if (el.btnDef) el.btnDef.addEventListener("click", () => sendAction("defend"));
    if (el.btnDodge) el.btnDodge.addEventListener("click", () => sendAction("dodge"));
    if (el.btnItemAtk) el.btnItemAtk.addEventListener("click", () => sendAction("item", { itemType: "attack_booster" }));
    if (el.btnItemDef) el.btnItemDef.addEventListener("click", () => sendAction("item", { itemType: "defense_booster" }));
    if (el.btnItemHeal) el.btnItemHeal.addEventListener("click", () => {
      // 기본은 자기 자신 대상, 필요 시 타깃 선택 UI 연동
      maybePickTargetThenSend("item", { itemType: "dittany" }, /*allowSelf*/ true, /*allowAlly*/ true, /*allowEnemy*/ false);
    });
    if (el.btnPass) el.btnPass.addEventListener("click", () => sendAction("pass"));

    // 채팅
    if (el.btnChat) el.btnChat.addEventListener("click", sendChat);
    if (el.chatInput) el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }

  // -----------------------------
  // 인증 / 자동 채우기
  // -----------------------------
  function autoFillFromURL() {
    const params = new URLSearchParams(location.search);
    const battle = params.get("battle");
    const name = params.get("name");
    const token = params.get("token");
    if (battle) el.authBattle && (el.authBattle.value = battle);
    if (name) el.authName && (el.authName.value = name);
    if (token) el.authToken && (el.authToken.value = token);
    // 자동 인증
    if (battle && name && token) onAuth();
  }

  function onAuth() {
    const params = new URLSearchParams(location.search);
    const battleId = (el.authBattle && el.authBattle.value || "").trim() || params.get("battle");
    const name = (el.authName && el.authName.value || "").trim() || params.get("name");
    const token = (el.authToken && el.authToken.value || "").trim() || params.get("token");
    if (!battleId || !name || !token) { alert("전투 ID, 이름, 비밀번호를 모두 입력하세요."); return; }
    state.socket.emit("playerAuth", { battleId, name, token });
  }

  function onReady() {
    if (!state.battleId || !state.playerId) { alert("인증이 필요합니다."); return; }
    state.socket.emit("player:ready", { battleId: state.battleId, playerId: state.playerId });
  }

  // -----------------------------
  // 액션 전송
  // -----------------------------
  function ensureTurn() {
    if (state.status !== "active") { alert("전투 진행 중이 아닙니다."); return false; }
    if (!isMyTurn()) { alert("지금은 당신의 턴이 아닙니다."); return false; }
    return true;
  }

  function onAttack() {
    // 공격은 기본적으로 적 대상 필요. 타깃 선택 UI가 있으면 사용.
    maybePickTargetThenSend("attack", {}, /*allowSelf*/ false, /*allowAlly*/ false, /*allowEnemy*/ true);
  }

  function sendAction(kind, extra) {
    if (!ensureTurn()) return;
    if (!state.battleId || !state.playerId) return;
    state.socket.emit("player:action", {
      battleId: state.battleId,
      playerId: state.playerId,
      action: { type: kind, ...(extra || {}) }
    });
  }

  // 선택 UI가 있을 때만 타깃을 고르게 하고, 없으면 규칙에 맞는 기본값으로 보냄
  function maybePickTargetThenSend(kind, extra, allowSelf, allowAlly, allowEnemy) {
    if (!ensureTurn()) return;

    // 타깃 선택기가 없는 경우: 규칙에 맞는 기본값만
    if (!(window.PYXISTargetSelector && typeof window.PYXISTargetSelector.open === "function")) {
      // 아이템: 힐은 자기 자신, 공격은 서버에서 기본 적 1명 자동 선택
      if (kind === "item" && extra && extra.itemType === "dittany") {
        sendAction("item", { ...extra, targetId: state.playerId });
      } else {
        sendAction(kind, extra);
      }
      return;
    }

    const me = getMe();
    const players = state.roster || [];
    const candidates = players.filter((p) => {
      if (p.hp <= 0) return false; // 사망자 제외
      if (p.id === state.playerId) return !!allowSelf;
      if (p.team === me.team) return !!allowAlly;
      return !!allowEnemy;
    });

    window.PYXISTargetSelector.open({
      players: candidates,
      onPick: (targetId) => {
        sendAction(kind, { ...(extra || {}), targetId });
      }
    });
  }

  // -----------------------------
  // 렌더링
  // -----------------------------
  function renderAll() {
    renderStatus();
    renderMyPanel();
    renderRoster();
    renderLog();
    updateActionEnables();
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

    if (el.turnHint) {
      el.turnHint.textContent = s === "active" ? (isMyTurn() ? "당신의 턴" : "상대 턴") : "-";
    }
  }

  function renderMyPanel() {
    if (!el.myPanel) return;
    const me = getMe();
    if (!me) {
      el.myPanel.innerHTML = "<div class=\"my-info\">전투 참여자 인증 대기</div>";
      return;
    }
    el.myPanel.innerHTML = [
      `<div class="my-info">이름: ${escapeHtml(me.name)}</div>`,
      `<div class="my-hp">HP ${Number(me.hp || 0)}</div>`,
      `<div class="my-stats">STR ${safeStat(me, "str")} / DEX ${safeStat(me, "agi")} / INT ${safeStat(me, "int")} / WIL ${safeStat(me, "wil")} / CHA ${safeStat(me, "cha")} / MAG ${safeStat(me, "mag")}</div>`
    ].join("");
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

  function renderLog() {
    if (!el.battleLog) return;
    el.battleLog.innerHTML = "";
    const list = Array.isArray(state.log) ? state.log.slice(-150) : [];
    for (const l of list) {
      const line = document.createElement("div");
      line.className = `log-line log-${l.type || "system"}`;
      line.textContent = l.message || "";
      el.battleLog.appendChild(line);
    }
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function updateActionEnables() {
    const enable = state.status === "active" && isMyTurn();
    $$(".action-btn").forEach((b) => { b.disabled = !enable; });
  }

  // -----------------------------
  // 채팅 / 로그
  // -----------------------------
  function sendChat() {
    if (!state.battleId) return;
    const name = (el.authName && el.authName.value) || "";
    const msg = (el.chatInput && el.chatInput.value || "").trim();
    if (!msg) return;
    state.socket.emit("chat:send", { battleId: state.battleId, name, message: msg });
    el.chatInput.value = "";
  }

  function appendChat(name, message) {
    if (!el.chatMessages) return;
    const li = document.createElement("div");
    li.className = "chat-line";
    li.textContent = `${name}: ${message}`;
    el.chatMessages.appendChild(li);
    trimChildren(el.chatMessages, 200);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function appendLog(type, message) {
    if (!el.battleLog) return;
    const li = document.createElement("div");
    li.className = `log-line log-${type}`;
    li.textContent = message;
    el.battleLog.appendChild(li);
    trimChildren(el.battleLog, 150);
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function trimChildren(box, max) {
    const cs = box.children;
    while (cs.length > max) cs[0].remove();
  }

  // -----------------------------
  // 턴 판단
  // -----------------------------
  function isMyTurn() {
    const me = getMe();
    if (!me) return false;
    // 서버가 teamKey로 current를 보낼 수 있으므로 둘 다 체크
    if (state.current === me.id) return true;
    if (state.current === me.team) return true;
    return false;
  }

  function getMe() {
    return (state.roster || []).find(p => p.id === state.playerId) || null;
  }

  function safeStat(p, key) {
    const n = p && p.stats && typeof p.stats[key] === "number" ? p.stats[key] : 0;
    return Math.max(0, Math.min(5, n));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // -----------------------------
  // 화면 전환
  // -----------------------------
  function showMain() {
    if (el.viewAuth) el.viewAuth.classList.add("hidden");
    if (el.viewMain) el.viewMain.classList.remove("hidden");
  }
})();
