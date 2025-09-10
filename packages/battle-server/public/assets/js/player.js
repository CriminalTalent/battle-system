/* packages/battle-server/public/assets/js/player.js
   - 자동 로그인 대기 오버레이(불투명 배경 + 스피너) 복구
   - auth:success / authError / disconnect 시 오버레이 자동 해제
   - 나머지(HP/로그/턴/채팅/큰 턴 이미지)는 기존 유지
*/
(function () {
  "use strict";

  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
  const TURN_TIMEOUT_MS = 5 * 60 * 1000;

  const $ = (sel, r = document) => r.querySelector(sel);
  const norm = (s) => String(s ?? "").trim();
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const resolveAvatar = (src) => {
    const s = String(src || "").trim();
    if (!s) return DEFAULT_AVATAR;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("/")) return s;
    return "/uploads/" + s.replace(/^\/+/, "");
  };
  const teamLabel = (key) => (key === "eaters" ? "B팀" : "A팀");

  const state = {
    socket: null,
    battleId: null,
    playerId: null,
    battle: null,
    players: [],
    currentTeam: null,
    status: "waiting",
    // 타이머
    turnStartTime: 0,
    turnEndsAt: 0,
    intervalId: 0
  };

  const el = {
    viewAuth: $("#authView"),
    viewMain: $("#mainView"),
    inpBattle: $("#battleId"),
    inpName: $("#playerName"),
    inpToken: $("#authToken"),
    btnAuth: $("#btnAuth"),

    // overlay
    overlay: $("#loadingOverlay"),

    // 내 정보
    myAvatar: $("#myAvatar"),
    myName: $("#myName"),
    myTeam: $("#myTeam"),
    statATK: $("#statATK"),
    statDEF: $("#statDEF"),
    statAGI: $("#statAGI"),
    statLUK: $("#statLUK"),
    hpFill: $("#hpFill"),
    hpText: $("#hpText"),
    itemD: $("#itemDittany"),
    itemA: $("#itemAttack"),
    itemF: $("#itemDefense"),

    // 중앙
    turnAvatar: $("#turnAvatar"),
    turnName: $("#turnName"),
    turnTimer: $("#turnTimer"),
    log: $("#battleLog"),

    // 액션/채팅
    btnReady: $("#btnReady"),
    btnAttack: $("#btnAttack"),
    btnDefend: $("#btnDefend"),
    btnDodge:  $("#btnDodge"),
    btnPass:   $("#btnPass"),
    btnItemDittany: $("#btnItemDittany"),
    btnItemAttack:  $("#btnItemAttack"),
    btnItemDefense: $("#btnItemDefense"),
    chatList: $("#chatList"),
    chatInput: $("#chatInput"),
    btnChat: $("#btnChat")
  };

  document.addEventListener("DOMContentLoaded", () => {
    connect();
    bindUI();
    autofillAndAutoAuth(); // 자동 로그인 + 오버레이
  });

  function socketURL() {
    if (typeof window.PYXIS_SERVER_URL === "string" && window.PYXIS_SERVER_URL) return window.PYXIS_SERVER_URL;
    return undefined;
  }

  function showOverlay(on) {
    if (!el.overlay) return;
    el.overlay.classList[on ? "remove" : "add"]("hidden");
  }

  function connect() {
    if (!window.io) { alert("Socket.IO 로드 실패"); return; }
    const s = window.io(socketURL(), { transports: ["websocket","polling"], withCredentials: true });
    state.socket = s;

    s.on("connect", () => {});
    s.on("disconnect", () => { showOverlay(false); }); // 연결 끊길 때 오버레이 제거
    s.on("authError", (e) => { showOverlay(false); alert("인증 실패: " + (e?.error || "")); });

    s.on("auth:success", (p) => {
      showOverlay(false);
      if (p?.role !== "player") return;
      state.battleId = p.battleId || p.battle?.id || null;
      state.playerId = p.playerId || p.player?.id || null;
      showMain();
      if (state.battleId) s.emit("join", { battleId: state.battleId });
      if (p.battle) applyBattleAndRender(p.battle, true);
    });

    s.on("battle:started", (b) => applyBattleAndRender(b, true));
    s.on("battle:update",  (b) => applyBattleAndRender(b, true));

    s.on("battle:log", (entry) => appendLog(entry?.type || "system", entry?.message || ""));
    s.on("battle:chat", ({ name, message }) => appendChat(name || "익명", message || ""));
  }

  function bindUI() {
    el.btnAuth?.addEventListener("click", () => {
      onAuth(true); // 수동 접속도 로딩 표시
    });

    el.btnReady?.addEventListener("click", () => {
      if (!state.socket || !state.battleId || !state.playerId) return;
      state.socket.emit("player:ready", { battleId: state.battleId, playerId: state.playerId });
      el.btnReady.disabled = true;
      el.btnReady.textContent = "준비 완료";
    });

    el.btnAttack?.addEventListener("click", () => pickTargetAndAction("attack"));
    el.btnDefend?.addEventListener("click", () => sendAction("defend"));
    el.btnDodge ?.addEventListener("click", () => sendAction("dodge"));
    el.btnPass  ?.addEventListener("click", () => sendAction("pass"));

    el.btnItemDittany?.addEventListener("click", () => sendAction("item", { itemType: "dittany", targetId: state.playerId }));
    el.btnItemAttack ?.addEventListener("click", () => sendAction("item", { itemType: "attack_booster" }));
    el.btnItemDefense?.addEventListener("click", () => sendAction("item", { itemType: "defense_booster" }));

    el.btnChat?.addEventListener("click", sendChat);
    el.chatInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  }

  function autofillAndAutoAuth() {
    const q = new URLSearchParams(location.search);
    const b = q.get("battle"); const n = q.get("name"); const t = q.get("token");
    if (b) el.inpBattle.value = b;
    if (n) el.inpName.value = n;
    if (t) el.inpToken.value = t;

    // 파라미터 3종이 모두 있으면 자동 인증 + 오버레이 표시
    if (b && n && t) {
      showOverlay(true);
      onAuth(false); // 이미 값 세팅됨
    }
  }

  function onAuth(useInputs) {
    const q = new URLSearchParams(location.search);
    const battleId = useInputs ? norm(el.inpBattle?.value || "") : (q.get("battle") || norm(el.inpBattle?.value || ""));
    const name     = useInputs ? norm(el.inpName?.value || "")   : (q.get("name")   || norm(el.inpName?.value || ""));
    const token    = useInputs ? norm(el.inpToken?.value || "")  : (q.get("token")  || norm(el.inpToken?.value || ""));
    if (!battleId || !name || !token) { showOverlay(false); alert("전투 ID/이름/비밀번호를 모두 입력하세요."); return; }
    showOverlay(true);
    state.socket.emit("playerAuth", { battleId, name, token }); // 서버 이벤트와 1:1 매칭됨 (index.js / socket-manager) :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
  }

  function showMain() {
    el.viewAuth.classList.add("hidden");
    el.viewMain.classList.remove("hidden");
  }

  // ---- 전투 반영/렌더 ----
  function applyBattleAndRender(b, rebuildLog) {
    if (!b) return;
    state.status = b.status || "waiting";
    state.currentTeam = b.currentTeam || b.current || null;
    state.players = Array.isArray(b.players) ? b.players.slice() : [];
    // 타이머
    if (typeof b.turnTimeLeft === "number") {
      startTurnTimer(b.turnTimeLeft);
    } else if (b.turnStartTime) {
      const left = Math.max(0, TURN_TIMEOUT_MS - (Date.now() - Number(b.turnStartTime)));
      startTurnTimer(left);
    } else {
      stopTurnTimer(); renderTurnTime("--");
    }
    renderMe();
    renderTurn();
    renderButtons();
    if (rebuildLog) renderLog(b.log || []);
  }

  function getMe() {
    return state.players.find(p => p.id === state.playerId) || null;
  }

  function renderMe() {
    const me = getMe(); if (!me) return;
    el.myAvatar.src = resolveAvatar(me.avatar); el.myAvatar.onerror = () => { el.myAvatar.src = DEFAULT_AVATAR; };
    el.myName.textContent = me.name || "전투 참가자";
    el.myTeam.textContent = teamLabel(me.team);
    el.statATK.textContent = me.stats?.attack ?? 0;
    el.statDEF.textContent = me.stats?.defense ?? 0;
    el.statAGI.textContent = me.stats?.agility ?? 0;
    el.statLUK.textContent = me.stats?.luck ?? 0;
    const hp = clamp(me.hp || 0, 0, me.maxHp || 1);
    const pct = Math.round((hp / (me.maxHp || 1)) * 100);
    el.hpFill.style.width = pct + "%";
    el.hpText.textContent = `${hp} / ${me.maxHp || 0}`;
    el.itemD.textContent = me.items?.dittany ?? 0;
    el.itemA.textContent = me.items?.attack_booster ?? 0;
    el.itemF.textContent = me.items?.defense_booster ?? 0;
  }

  function renderTurn() {
    const isActive = state.status === "active";
    const my = getMe();
    const isMine = isActive && my && state.currentTeam === my.team;

    let cur = null;
    if (isActive && state.currentTeam) {
      cur = state.players.find(p => p.team === state.currentTeam && p.hp > 0) || null;
    }
    el.turnAvatar.src = resolveAvatar(cur?.avatar); el.turnAvatar.onerror = () => { el.turnAvatar.src = DEFAULT_AVATAR; };
    el.turnName.textContent = isActive ? (isMine ? "당신의 팀 차례" : "상대 팀 차례") : (state.status === "paused" ? "일시정지" : state.status === "ended" ? "전투 종료" : "대기 중");
  }

  function renderButtons() {
    const me = getMe();
    const isActive = state.status === "active";
    const isAlive = !!me && (me.hp || 0) > 0;
    const myTurn = isActive && !!me && (state.currentTeam === me.team);
    const en = (b, on)=>{ if (b) b.disabled = !on; };
    en(el.btnAttack, myTurn && isAlive);
    en(el.btnDefend, myTurn && isAlive);
    en(el.btnDodge,  myTurn && isAlive);
    en(el.btnPass,   myTurn && isAlive);
    en(el.btnItemDittany, myTurn && isAlive && (me?.items?.dittany > 0));
    en(el.btnItemAttack,  myTurn && isAlive && (me?.items?.attack_booster > 0));
    en(el.btnItemDefense, myTurn && isAlive && (me?.items?.defense_booster > 0));
  }

  function renderLog(list) {
    if (!el.log) return;
    el.log.innerHTML = "";
    (list || []).forEach((e) => appendLog(e?.type || "system", e?.message || "", true));
    el.log.scrollTop = el.log.scrollHeight;
  }

  function appendLog(type, msg) {
    const div = document.createElement("div");
    div.className = "line " + (type || "system");
    div.textContent = String(msg || "");
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function appendChat(name, message) {
    const div = document.createElement("div");
    div.className = "msg";
    div.textContent = `${name}: ${message}`;
    el.chatList.appendChild(div);
    el.chatList.scrollTop = el.chatList.scrollHeight;
  }

  function sendChat() {
    const text = norm(el.chatInput?.value || "");
    if (!text) return;
    state.socket.emit("chat:send", {
      battleId: state.battleId,
      name: getMe()?.name || "전투 참가자",
      message: text,
      role: "player"
    }); // socket-manager/index.js의 chat:send와 동일 스펙 :contentReference[oaicite:4]{index=4} :contentReference[oaicite:5]{index=5}
    el.chatInput.value = "";
  }

  function sendAction(type, extra) {
    const me = getMe();
    if (!me) return;
    if (state.status !== "active") { alert("전투가 진행 중이 아닙니다."); return; }
    if (state.currentTeam !== me.team) { alert("지금은 당신의 턴이 아닙니다."); return; }
    if (me.hp <= 0) { alert("행동할 수 없습니다."); return; }
    state.socket.emit("player:action", {
      battleId: state.battleId,
      playerId: state.playerId,
      action: { type, ...(extra || {}) }
    });
  }

  function pickTargetAndAction(kind) {
    const me = getMe();
    const enemy = (state.players || []).find(p => p.team !== me.team && p.hp > 0);
    if (!enemy) { alert("공격 대상이 없습니다."); return; }
    sendAction(kind, { targetId: enemy.id });
  }

  // ---- 턴 타이머 ----
  function startTurnTimer(ms) {
    stopTurnTimer();
    const base = Date.now();
    state.turnEndsAt = base + (Number(ms) || 0);
    tickTurnTimer();
    state.intervalId = window.setInterval(tickTurnTimer, 1000);
  }
  function stopTurnTimer() {
    if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = 0; }
  }
  function tickTurnTimer() {
    const left = Math.max(0, state.turnEndsAt - Date.now());
    const mm = String(Math.floor(left / 60000)).padStart(2, "0");
    const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    renderTurnTime(`${mm}:${ss}`);
    if (left <= 0) stopTurnTimer();
  }
  function renderTurnTime(text) { if (el.turnTimer) el.turnTimer.textContent = `턴 시간: ${text}`; }
})();
