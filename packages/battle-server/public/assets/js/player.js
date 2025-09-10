/* packages/battle-server/public/assets/js/player.js
   - HP/로그/타이머 확실한 반영
   - 중앙 큰 라운드 스퀘어 턴 이미지
   - 이벤트 스펙: playerAuth, battle:update, battle:log, battle:chat 등 유지
*/
(function () {
  "use strict";

  // ===== 설정/상수 =====
  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
  const TURN_TIMEOUT_MS = 5 * 60 * 1000; // 서버 기본 5분과 일치 (index.js 직렬화 참조)  :contentReference[oaicite:4]{index=4}

  // ===== 유틸 =====
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

  // ===== 상태 =====
  const state = {
    socket: null,
    battleId: null,
    playerId: null,
    battle: null,       // 마지막 수신 스냅샷
    players: [],
    currentTeam: null,
    status: "waiting",
    // 타이머
    turnStartTime: 0,
    turnEndsAt: 0,
    intervalId: 0
  };

  // ===== 요소 =====
  const el = {
    // 인증
    viewAuth: $("#authView"),
    viewMain: $("#mainView"),
    inpBattle: $("#battleId"),
    inpName: $("#playerName"),
    inpToken: $("#authToken"),
    btnAuth: $("#btnAuth"),

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

  // ===== 초기화 =====
  document.addEventListener("DOMContentLoaded", () => {
    connect();
    bindUI();
    autofill();
  });

  function socketURL() {
    if (typeof window.PYXIS_SERVER_URL === "string" && window.PYXIS_SERVER_URL) return window.PYXIS_SERVER_URL;
    return undefined; // same-origin
  }

  function connect() {
    if (!window.io) { alert("Socket.IO 로드 실패"); return; }
    const s = window.io(socketURL(), { transports: ["websocket","polling"], withCredentials: true });
    state.socket = s;

    s.on("connect", () => {});
    s.on("disconnect", () => {});
    s.on("authError", (e) => alert("인증 실패: " + (e?.error || "")));

    // 인증 성공
    s.on("auth:success", (p) => {
      if (p?.role !== "player") return;
      state.battleId = p.battleId || p.battle?.id || null;
      state.playerId = p.playerId || p.player?.id || null;
      showMain();
      if (state.battleId) s.emit("join", { battleId: state.battleId });

      // 최초 스냅샷이 오면 바로 반영
      if (p.battle) applyBattle(p.battle, true);
    });

    // 전체 스냅샷
    s.on("battle:update", (b) => applyBattle(b, true));

    // 로그/채팅 스트림
    s.on("battle:log", (entry) => appendLog(entry?.type || "system", entry?.message || ""));
    s.on("battle:chat", ({ name, message }) => appendChat(name || "익명", message || ""));

    // 호환 이벤트
    s.on("battle:started", (b) => applyBattle(b, true));
  }

  function bindUI() {
    el.btnAuth?.addEventListener("click", onAuth);

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

  function autofill() {
    const q = new URLSearchParams(location.search);
    const b = q.get("battle"); const n = q.get("name"); const t = q.get("token");
    if (b) el.inpBattle.value = b;
    if (n) el.inpName.value = n;
    if (t) el.inpToken.value = t;
    if (b && n && t) onAuth();
  }

  function onAuth() {
    const battleId = norm(el.inpBattle?.value || "");
    const name = norm(el.inpName?.value || "");
    const token = norm(el.inpToken?.value || "");
    if (!battleId || !name || !token) { alert("전투 ID/이름/비밀번호를 모두 입력하세요."); return; }
    state.socket.emit("playerAuth", { battleId, name, token });
  }

  function showMain() {
    el.viewAuth.classList.add("hidden");
    el.viewMain.classList.remove("hidden");
  }

  // ===== 전투 스냅샷 반영 =====
  function applyBattle(b, rebuildLog = false) {
    if (!b) return;
    state.battle = b;
    state.players = Array.isArray(b.players) ? b.players.slice() : [];
    state.status = b.status || "waiting";
    state.currentTeam = b.currentTeam || b.current || null;

    // 턴 타이머 계산 (turnTimeLeft 우선)
    if (typeof b.turnTimeLeft === "number") {
      startTurnTimer(b.turnTimeLeft);
    } else if (b.turnStartTime) {
      const passed = Date.now() - Number(b.turnStartTime);
      const left = Math.max(0, TURN_TIMEOUT_MS - passed);
      startTurnTimer(left);
    } else {
      stopTurnTimer();
      renderTurnTime("--");
    }

    renderMe();
    renderTurnCard();
    updateActionEnables();

    if (rebuildLog) renderLog(b.log || []);
  }

  // ===== 내 정보 렌더 =====
  function getMe() {
    return state.players.find(p => p.id === state.playerId) || null;
  }

  function renderMe() {
    const me = getMe();
    if (!me) return;

    // 아바타
    const src = resolveAvatar(me.avatar);
    el.myAvatar.src = src;
    el.myAvatar.onerror = () => { el.myAvatar.src = DEFAULT_AVATAR; };

    // 텍스트
    el.myName.textContent = me.name || "전투 참가자";
    el.myTeam.textContent = teamLabel(me.team);

    // 스탯
    el.statATK.textContent = me.stats?.attack ?? 0;
    el.statDEF.textContent = me.stats?.defense ?? 0;
    el.statAGI.textContent = me.stats?.agility ?? 0;
    el.statLUK.textContent = me.stats?.luck ?? 0;

    // HP
    const hp = clamp(me.hp || 0, 0, me.maxHp || 1);
    const pct = Math.round((hp / (me.maxHp || 1)) * 100);
    el.hpFill.style.width = pct + "%";
    el.hpText.textContent = `${hp} / ${me.maxHp || 0}`;

    // 아이템
    el.itemD.textContent = me.items?.dittany ?? 0;
    el.itemA.textContent = me.items?.attack_booster ?? 0;
    el.itemF.textContent = me.items?.defense_booster ?? 0;
  }

  // ===== 턴 카드/버튼 =====
  function renderTurnCard() {
    const isActive = state.status === "active";
    const team = state.currentTeam;

    // 현재 턴 팀의 첫 생존자 대표 아바타
    let cur = null;
    if (isActive && team) {
      cur = state.players.find(p => p.team === team && (p.hp || 0) > 0) || null;
    }
    const turnSrc = resolveAvatar(cur?.avatar);
    el.turnAvatar.src = turnSrc;
    el.turnAvatar.onerror = () => { el.turnAvatar.src = DEFAULT_AVATAR; };

    el.turnName.textContent = isActive
      ? (isMyTurn() ? "당신의 팀 차례" : "상대 팀 차례")
      : (state.status === "paused" ? "일시정지" : state.status === "ended" ? "전투 종료" : "대기 중");
  }

  function isMyTurn() {
    const me = getMe();
    return !!(state.status === "active" && me && state.currentTeam && state.currentTeam === me.team);
  }

  function updateActionEnables() {
    const me = getMe();
    const live = !!me && (me.hp || 0) > 0;
    const myTurn = isMyTurn();

    toggle(el.btnAttack,  myTurn && live);
    toggle(el.btnDefend,  myTurn && live);
    toggle(el.btnDodge,   myTurn && live);
    toggle(el.btnPass,    myTurn && live);
    toggle(el.btnItemDittany, myTurn && live && (me?.items?.dittany > 0));
    toggle(el.btnItemAttack,  myTurn && live && (me?.items?.attack_booster > 0));
    toggle(el.btnItemDefense, myTurn && live && (me?.items?.defense_booster > 0));
  }

  function toggle(btn, on) { if (btn) btn.disabled = !on; }

  // ===== 로그/채팅 =====
  function renderLog(list) {
    if (!el.log) return;
    el.log.innerHTML = "";
    (list || []).forEach((e) => {
      appendLog(e?.type || "system", e?.message || "", /*appendOnly*/true);
    });
    el.log.scrollTop = el.log.scrollHeight;
  }

  function appendLog(type, msg, appendOnly = false) {
    if (!el.log) return;
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
    });
    el.chatInput.value = "";
  }

  // ===== 액션 =====
  function ensureTurn() {
    if (state.status !== "active") { alert("전투가 진행 중이 아닙니다."); return false; }
    if (!isMyTurn()) { alert("지금은 당신의 턴이 아닙니다."); return false; }
    const me = getMe();
    if (!me || me.hp <= 0) { alert("행동할 수 없습니다."); return false; }
    return true;
  }

  function sendAction(type, extra) {
    if (!ensureTurn()) return;
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

  // ===== 턴 타이머 =====
  function startTurnTimer(ms) {
    stopTurnTimer();
    const base = Date.now();
    state.turnEndsAt = base + (Number(ms) || 0);
    tickTurnTimer(); // 즉시 1회 반영
    state.intervalId = window.setInterval(tickTurnTimer, 1000);
  }

  function stopTurnTimer() {
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = 0;
    }
  }

  function tickTurnTimer() {
    const left = Math.max(0, state.turnEndsAt - Date.now());
    const mm = String(Math.floor(left / 60000)).padStart(2, "0");
    const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    renderTurnTime(`${mm}:${ss}`);
    if (left <= 0) stopTurnTimer();
  }

  function renderTurnTime(text) {
    if (el.turnTimer) el.turnTimer.textContent = `턴 시간: ${text}`;
  }
})();
