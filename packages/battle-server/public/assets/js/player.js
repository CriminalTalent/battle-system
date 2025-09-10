/* packages/battle-server/public/assets/js/player.js
   PYXIS 전투 참가자 클라이언트 (한글화/이모지 금지/팀 턴제)
   - emit:   playerAuth, player:ready, player:action, chat:send
   - on:     auth:success, authError, battle:update, battle:chat, battle:log
   - 추가 지원(있으면 사용):
       on:   turn:start, turn:end, player:update
       win:  PyxisNotify.init({ socket }), PYXISTargetSelector.open({ players, onPick })
       win:  PyxisSocket.url (소켓 엔드포인트), PYXIS_SERVER_URL (절대 URL)
*/

(function () {
  "use strict";

  // -----------------------------
  // 유틸
  // -----------------------------
  const pick = (...ids) => {
    for (const id of ids) {
      if (!id) continue;
      const n = document.getElementById(id);
      if (n) return n;
    }
    return null;
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const escapeHtml = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // -----------------------------
  // 요소 바인딩 (구/신 HTML 호환)
  // -----------------------------
  const el = {
    // 뷰
    viewAuth: pick("authView"),
    viewMain: pick("mainView"),

    // 인증 입력
    authBattle: pick("authBattle", "battleId"),
    authName: pick("authName", "playerName"),
    authToken: pick("authToken"),
    btnAuth: pick("btnAuth"),

    // 내 정보
    myAvatar: pick("myAvatar"),
    myName: pick("myName"),
    myTeam: pick("myTeam"),
    statATK: pick("statATK"),
    statDEF: pick("statDEF"),
    statAGI: pick("statAGI"),
    statLUK: pick("statLUK"),
    myHpBar: pick("myHpBar"),
    myHpText: pick("myHpText"),
    itemDittany: pick("itemDittany"),
    itemAttack: pick("itemAttack"),
    itemDefense: pick("itemDefense"),

    // 팀 정보
    teammateList: pick("teammateList"),
    rosterPhoenix: pick("rosterPhoenix"),
    rosterDeath: pick("rosterEaters", "rosterDeath"),

    // 턴 정보
    turnAvatar: pick("turnAvatar"),
    turnName: pick("turnName"),
    turnTimer: pick("turnTimer"),
    statusPill: pick("statusPill"),
    turnHint: pick("turnHint"),

    // 로그/채팅
    battleLog: pick("battleLog"),
    chatMessages: pick("chatMessages"),
    chatInput: pick("chatInput"),
    btnChat: pick("btnChat"),

    // 액션
    btnReady: pick("btnReady"),
    btnAttack: pick("btnAttack", "btnAtk"),
    btnDefend: pick("btnDefend", "btnDef"),
    btnDodge: pick("btnDodge"),
    btnPass: pick("btnPass"),
    btnItemDittany: pick("btnItemDittany", "btnItemHeal"),
    btnItemAttack: pick("btnItemAttack", "btnItemAtk"),
    btnItemDefense: pick("btnItemDefense", "btnItemDef")
  };

  // -----------------------------
  // 라벨/설정
  // -----------------------------
  const TEAM_LABEL = {
    phoenix: "불사조 기사단",
    death: "죽음을 먹는자들",
    eaters: "죽음을 먹는자들" // 과거 키 호환
  };
  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
  const MAX_LOG = 150;
  const MAX_CHAT = 200;

  // -----------------------------
  // 상태
  // -----------------------------
  const state = {
    socket: null,
    battleId: null,
    playerId: null,
    status: "waiting", // waiting | active | paused | ended
    current: null, // 서버가 보내는 현재 턴 식별자 (팀키 또는 playerId)
    players: [],
    log: [],
    // 타이머
    turnEndsAt: 0,
    turnTimerId: 0
  };

  // -----------------------------
  // 초기화
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    connectSocket();
    bindUI();
    autoFillFromURL();
  });

  function getSocketURL() {
    if (typeof window.PyxisSocket === "object" && window.PyxisSocket.url) {
      return window.PyxisSocket.url;
    }
    if (typeof window.PYXIS_SERVER_URL === "string" && window.PYXIS_SERVER_URL) {
      return window.PYXIS_SERVER_URL;
    }
    return undefined; // io()가 현재 호스트를 사용
  }

  function connectSocket() {
    if (!window.io) {
      alert("Socket.IO가 로드되지 않았습니다.");
      return;
    }
    const url = getSocketURL();
    const socket = window.io(url, { transports: ["websocket", "polling"], withCredentials: true });
    state.socket = socket;

    if (window.PyxisNotify && typeof window.PyxisNotify.init === "function") {
      window.PyxisNotify.init({ socket });
    }

    bindSocketEvents(socket);
  }

  function bindSocketEvents(s) {
    s.on("connect", () => { /* 연결됨 */ });
    s.on("disconnect", () => { /* 끊김 */ });

    s.on("authError", (e) => {
      alert("인증 실패: " + (e && e.error ? e.error : ""));
    });

    // 인증 성공
    s.on("auth:success", (payload) => {
      const role = payload.role || "player";
      if (role !== "player") return;

      state.battleId = payload.battleId || payload.battle?.id || null;
      state.playerId = payload.playerId || payload.player?.id || null;
      window.__PYXIS_PLAYER_ID = state.playerId;

      showMainView();
      if (state.battleId) s.emit("join", { battleId: state.battleId });

      if (payload.battle) {
        applyBattle(payload.battle);
        renderAll();
      }
    });

    // 전체 전투 스냅샷
    s.on("battle:update", (b) => {
      applyBattle(b);
      renderAll();
    });

    // 전투 로그
    s.on("battle:log", (entry) => {
      if (!entry) return;
      appendLog(entry.type || "system", entry.message || "");
    });

    // 채팅
    s.on("battle:chat", ({ name, message }) => {
      appendChat(name, message);
    });

    // 선택: 턴 이벤트
    s.on("turn:start", (data) => {
      if (data && (data.team || data.playerId)) {
        state.current = data.team || data.playerId;
      }
      if (typeof data?.timeLeft === "number") {
        startTurnTimer(data.timeLeft);
      } else {
        clearTurnTimer();
      }
      renderTurnBanner();
      updateActionEnables();
    });

    s.on("turn:end", () => {
      clearTurnTimer();
      updateActionEnables();
    });

    s.on("player:update", (pupd) => {
      if (!pupd || !Array.isArray(state.players)) return;
      const idx = state.players.findIndex((p) => p.id === pupd.playerId);
      if (idx >= 0) {
        state.players[idx] = { ...state.players[idx], ...(pupd.updates || {}) };
        if (pupd.playerId === state.playerId) {
          renderMe();
        }
        renderTeammates();
        renderRosters();
      }
    });
  }

  function applyBattle(b) {
    if (!b) return;
    state.status = b.status || "waiting";
    state.current =
      b.current ||
      b.currentTeam ||
      b.turnTeam ||
      b.currentPlayerId ||
      null;
    state.players = Array.isArray(b.players) ? b.players.slice() : [];
    state.log = Array.isArray(b.log) ? b.log.slice(-MAX_LOG) : state.log;

    if (typeof b.turnTimeLeft === "number") {
      startTurnTimer(b.turnTimeLeft);
    }
  }

  // -----------------------------
  // UI 바인딩
  // -----------------------------
  function bindUI() {
    // 인증
    el.btnAuth && el.btnAuth.addEventListener("click", onAuth);

    // 준비
    el.btnReady && el.btnReady.addEventListener("click", onReady);

    // 전투 액션
    el.btnAttack && el.btnAttack.addEventListener("click", () => onAttack());
    el.btnDefend && el.btnDefend.addEventListener("click", () => sendAction("defend"));
    el.btnDodge && el.btnDodge.addEventListener("click", () => sendAction("dodge"));
    el.btnPass && el.btnPass.addEventListener("click", () => sendAction("pass"));

    // 아이템
    el.btnItemDittany &&
      el.btnItemDittany.addEventListener("click", () =>
        maybePickTargetThenSend("item", { itemType: "dittany" }, true, true, false)
      );
    el.btnItemAttack &&
      el.btnItemAttack.addEventListener("click", () =>
        sendAction("item", { itemType: "attack_booster" })
      );
    el.btnItemDefense &&
      el.btnItemDefense.addEventListener("click", () =>
        sendAction("item", { itemType: "defense_booster" })
      );

    // 채팅
    el.btnChat && el.btnChat.addEventListener("click", sendChat);
    el.chatInput &&
      el.chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendChat();
      });
  }

  // -----------------------------
  // 인증/자동 채우기
  // -----------------------------
  function autoFillFromURL() {
    const q = new URLSearchParams(location.search);
    const battle = q.get("battle");
       const name = q.get("name");
    const token = q.get("token");
    if (battle && el.authBattle) el.authBattle.value = battle;
    if (name && el.authName) el.authName.value = name;
    if (token && el.authToken) el.authToken.value = token;
    if (battle && name && token) onAuth();
  }

  function onAuth() {
    if (!state.socket) return;
    const q = new URLSearchParams(location.search);
    const battleId = (el.authBattle?.value || "").trim() || q.get("battle");
    const name = (el.authName?.value || "").trim() || q.get("name");
    const token = (el.authToken?.value || "").trim() || q.get("token");
    if (!battleId || !name || !token) {
      alert("전투 ID, 이름, 비밀번호를 모두 입력하세요.");
      return;
    }
    state.socket.emit("playerAuth", { battleId, name, token });
  }

  function onReady() {
    if (!state.socket || !state.battleId || !state.playerId) {
      alert("인증이 필요합니다.");
      return;
    }
    state.socket.emit("player:ready", { battleId: state.battleId, playerId: state.playerId });
  }

  // -----------------------------
  // 액션 전송
  // -----------------------------
  function ensureTurn() {
    if (state.status !== "active") {
      alert("전투가 진행 중이 아닙니다.");
      return false;
    }
    if (!isMyTurn()) {
      alert("지금은 당신의 턴이 아닙니다.");
      return false;
    }
    const me = getMe();
    if (!me || me.hp <= 0) {
      alert("행동할 수 없습니다.");
      return false;
    }
    return true;
  }

  function onAttack() { maybePickTargetThenSend("attack", {}, false, false, true); }

  function sendAction(type, extra) {
    if (!ensureTurn()) return;
    if (!state.socket || !state.battleId || !state.playerId) return;
    state.socket.emit("player:action", {
      battleId: state.battleId,
      playerId: state.playerId,
      action: { type, ...(extra || {}) }
    });
  }

  function maybePickTargetThenSend(kind, extra, allowSelf, allowAlly, allowEnemy) {
    if (!ensureTurn()) return;

    const me = getMe();
    const roster = Array.isArray(state.players) ? state.players : [];

    const candidates = roster.filter((p) => {
      if (!p || p.hp <= 0) return false;
      if (p.id === state.playerId) return !!allowSelf;
      if (p.team === me.team) return !!allowAlly;
      return !!allowEnemy;
    });

    if (!(window.PYXISTargetSelector && typeof window.PYXISTargetSelector.open === "function")) {
      if (kind === "item" && extra?.itemType === "dittany") {
        sendAction("item", { ...extra, targetId: state.playerId });
        return;
      }
      if (kind === "attack") {
        const target = candidates.find((p) => p.team !== me.team);
        if (target) {
          sendAction("attack", { targetId: target.id });
        } else {
          alert("공격 대상이 없습니다.");
        }
        return;
      }
      sendAction(kind, extra);
      return;
    }

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
    renderMe();
    renderTeammates();
    renderRosters();
    renderLog();
    renderTurnBanner();
    updateActionEnables();
  }

  function renderStatus() {
    if (!el.statusPill) return;
    const s = state.status;
    el.statusPill.textContent =
      s === "active" ? "전투 진행 중" :
      s === "paused" ? "전투 일시정지" :
      s === "ended" ? "전투 종료" :
      "전투 대기 중";
    el.statusPill.className = `status-pill ${s}`;

    if (el.turnHint) {
      el.turnHint.textContent = s === "active" ? (isMyTurn() ? "당신의 턴" : "상대 턴") : "-";
    }
  }

  function renderMe() {
    const me = getMe();
    if (!me) return;

    if (el.myName) el.myName.textContent = me.name || "전투 참가자";
    if (el.myTeam) el.myTeam.textContent = teamBadgeText(me.team);
    if (el.myTeam) el.myTeam.className = `team-badge ${teamBadgeClass(me.team)}`;

    if (el.myAvatar) el.myAvatar.src = me.avatar || DEFAULT_AVATAR;

    const s = me.stats || {};
    if (el.statATK) el.statATK.textContent = clampInt(s.attack, 1, 5, 3);
    if (el.statDEF) el.statDEF.textContent = clampInt(s.defense, 1, 5, 3);
    if (el.statAGI) el.statAGI.textContent = clampInt(s.agility, 1, 5, 3);
    if (el.statLUK) el.statLUK.textContent = clampInt(s.luck,   1, 5, 3);

    renderMyHp(me);
    renderItems(me);
  }

  function renderMyHp(me) {
    const hp = Math.max(0, me.hp | 0);
    const maxHp = Math.max(hp, me.maxHp | 0) || 100;
    const pct = clamp((hp / maxHp) * 100, 0, 100);
    if (el.myHpBar) el.myHpBar.style.width = `${pct}%`;
    if (el.myHpText) el.myHpText.textContent = `${hp} / ${maxHp}`;
  }

  function renderItems(me) {
    const it = me.items || {};
    if (el.itemDittany) el.itemDittany.textContent = parseInt(it.dittany || 0, 10);
    if (el.itemAttack) el.itemAttack.textContent = parseInt(it.attack_booster || 0, 10);
    if (el.itemDefense) el.itemDefense.textContent = parseInt(it.defense_booster || 0, 10);
  }

  function renderTeammates() {
    if (!el.teammateList) return;
    const me = getMe();
    const mates = (state.players || []).filter(p => p.id !== state.playerId && normalizeTeam(p.team) === normalizeTeam(me?.team));
    el.teammateList.innerHTML = "";
    if (!mates.length) {
      const d = document.createElement("div");
      d.className = "teammate-item";
      d.textContent = "팀원이 없습니다";
      el.teammateList.appendChild(d);
      return;
    }
    for (const t of mates) {
      const row = document.createElement("div");
      row.className = "teammate-item";
      row.innerHTML = `
        <img class="teammate-avatar" src="${t.avatar || DEFAULT_AVATAR}" alt="${escapeHtml(t.name)}">
        <div style="flex:1">
          <div class="teammate-name">${escapeHtml(t.name)} <span style="color:var(--text-muted);font-weight:600">(${teamBadgeText(t.team)})</span></div>
          <div class="teammate-hp">HP ${Math.max(0, t.hp|0)} / ${Math.max(1, t.maxHp|0)}</div>
        </div>
      `;
      el.teammateList.appendChild(row);
    }
  }

  function renderRosters() { /* 선택 구현: 필요 시 팀별 목록 그리기 */ }

  // === 로그/채팅 ===

  // 팀키 → A/B 텍스트
  function teamBadgeText(k) {
    const key = normalizeTeam(k);
    return key === "phoenix" ? "A팀" : "B팀";
  }

  // 로그 메시지 정리:
  //  1) phoenix/eaters/death → A팀/B팀
  //  2) 불필요한 괄호 정보 제거: (행운: ...), (주사위: ...), (치명타: ...), (명중: ...), (민첩성: ...)
  //  3) 공백 정리
  function cleanLogMessage(raw) {
    let msg = String(raw || "");

    // 팀키를 A/B 표기로 치환
    msg = msg
      .replace(/\bphoenix\b/gi, "A팀")
      .replace(/\b(eaters|death)\b/gi, "B팀")
      .replace(/\((?:\s*A팀|\s*B팀)\s*팀\)/gi, ""); // "(phoenix팀)" 같은 꼬리표 제거 호환

    // 턴/선공 문구에 포함된 팀키도 정리 (예: "턴 1: phoenix 팀 차례" → "턴 1: A팀 차례")
    msg = msg
      .replace(/팀\s*차례/gi, "팀 차례") // 안전
      .replace(/A팀\s*팀\s*차례/gi, "A팀 차례")
      .replace(/B팀\s*팀\s*차례/gi, "B팀 차례");

    // 괄호 속 부가정보 제거
    msg = msg.replace(/\s*\((?:행운|주사위|치명타|명중|민첩성)[^)]*\)/gi, "");

    // 다중 공백/쉼표 조정
    msg = msg.replace(/\s{2,}/g, " ").trim();
    return msg;
  }

  function renderLog() {
    if (!el.battleLog) return;
    el.battleLog.innerHTML = "";
    const list = Array.isArray(state.log) ? state.log.slice(-MAX_LOG) : [];
    for (const l of list) {
      const line = document.createElement("div");
      line.className = `log-entry ${l.type || "system"}`;
      line.textContent = cleanLogMessage(l.message || "");
      el.battleLog.appendChild(line);
    }
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function appendLog(type, message) {
    if (!el.battleLog) return;
    const div = document.createElement("div");
    div.className = `log-entry ${type || "system"}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${cleanLogMessage(message || "")}`;
    el.battleLog.appendChild(div);
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
    trimChildren(el.battleLog, MAX_LOG);
  }

  function sendChat() {
    if (!state.socket || !state.battleId) return;
    const name = (el.authName && el.authName.value) || "";
    const msg = (el.chatInput && el.chatInput.value || "").trim();
    if (!msg) return;
    state.socket.emit("chat:send", { battleId: state.battleId, name, message: msg });
    el.chatInput.value = "";
  }

  function appendChat(name, message) {
    if (!el.chatMessages) return;
    const li = document.createElement("div");
    li.className = "chat-message";
    li.textContent = `${name}: ${message}`;
    el.chatMessages.appendChild(li);
    trimChildren(el.chatMessages, MAX_CHAT);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  // -----------------------------
  // 턴/도우미
  // -----------------------------
  function isMyTurn() {
    const me = getMe();
    if (!me) return false;
    if (state.current === me.id) return true;
    const teamKey = normalizeTeam(me.team);
    if (state.current === teamKey) return true;
    if (state.current && typeof state.current === "string") {
      if (normalizeTeam(state.current) === teamKey) return true;
    }
    return false;
  }

  function inferCurrentTeamKey() {
    if (!state.current) return null;
    const normalized = normalizeTeam(state.current);
    if (normalized === "phoenix" || normalized === "death") return normalized;
    const p = (state.players || []).find((x) => x.id === state.current);
    return p ? normalizeTeam(p.team) : null;
  }

  function normalizeTeam(t) {
    const k = String(t || "").toLowerCase();
    if (k === "phoenix" || k === "a" || k === "team_a") return "phoenix";
    if (k === "death" || k === "eaters" || k === "b" || k === "team_b") return "death";
    return k || "phoenix";
  }

  function getMe() {
    return (state.players || []).find((p) => p.id === state.playerId) || null;
  }

  function num(x, fb) {
    const n = parseInt(x, 10);
    return Number.isNaN(n) ? (fb ?? 0) : n;
  }

  function startTurnTimer(ms) {
    clearTurnTimer();
    state.turnEndsAt = Date.now() + Math.max(0, ms | 0);
    tickTurnTimer();
    state.turnTimerId = window.setInterval(tickTurnTimer, 500);
  }

  function clearTurnTimer() {
    if (state.turnTimerId) {
      clearInterval(state.turnTimerId);
      state.turnTimerId = 0;
    }
    state.turnEndsAt = 0;
    if (el.turnTimer) el.turnTimer.textContent = "턴 시간: --";
  }

  function tickTurnTimer() {
    if (!el.turnTimer || state.turnEndsAt <= 0) return;
    const left = state.turnEndsAt - Date.now();
    if (left <= 0) { clearTurnTimer(); return; }
    const sec = Math.ceil(left / 1000);
    el.turnTimer.textContent = `남은 시간: ${sec}초`;
  }

  // -----------------------------
  // 화면 전환
  // -----------------------------
  function showMainView() {
    el.viewAuth && el.viewAuth.classList.add("hidden");
    el.viewMain && el.viewMain.classList.remove("hidden");
  }

  // -----------------------------
  // 헬퍼
  // -----------------------------
  function trimChildren(box, max) {
    if (!box) return;
    const cs = box.children;
    while (cs.length > max) cs[0].remove();
  }

  function clampInt(v, min, max, fb = 0) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fb;
    return Math.max(min, Math.min(max, n));
  }
})();
