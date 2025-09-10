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
    // 우선순위: 명시적 전역 → 서버 도메인 → 현재 호스트
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

    // 선택 알림 모듈
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
      // 서버 포맷 호환 처리
      const role = payload.role || "player";
      if (role !== "player") return;

      state.battleId = payload.battleId || payload.battle?.id || null;
      state.playerId = payload.playerId || payload.player?.id || null;

      // 전역 노출(선택)
      window.__PYXIS_PLAYER_ID = state.playerId;

      showMainView();
      // 방 참가 후 최신 상태 수신
      if (state.battleId) s.emit("join", { battleId: state.battleId });

      // 최초 렌더링 보강
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

    // 선택: 턴 이벤트/개별 플레이어 갱신을 보내는 서버 대비
    s.on("turn:start", (data) => {
      // data: { playerId?, team?, timeLeft?ms }
      // 팀 턴제에 맞춰 team 우선 사용
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
      // 다음 업데이트는 battle:update로 온다고 가정
      updateActionEnables();
    });

    s.on("player:update", (pupd) => {
      // { playerId, updates }
      if (!pupd || !Array.isArray(state.players)) return;
      const idx = state.players.findIndex((p) => p.id === pupd.playerId);
      if (idx >= 0) {
        state.players[idx] = { ...state.players[idx], ...(pupd.updates || {}) };
        if (pupd.playerId === state.playerId) {
          renderMe();
        }
        renderTeammates();
        renderRosters(); // 필요 시
      }
    });
  }

  function applyBattle(b) {
    if (!b) return;
    state.status = b.status || "waiting";
    // 서버가 currentTeam/current/playerId 등 다양한 키를 보낼 수 있으므로 모두 흡수
    state.current =
      b.current ||
      b.currentTeam ||
      b.turnTeam ||
      b.currentPlayerId ||
      null;
    state.players = Array.isArray(b.players) ? b.players.slice() : [];
    state.log = Array.isArray(b.log) ? b.log.slice(-MAX_LOG) : state.log;

    // 가능하면 턴 타이머 추정
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
    // 자동 인증
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

  function onAttack() {
    // 공격은 적 대상 필요
    maybePickTargetThenSend("attack", {}, false, false, true);
  }

  function sendAction(type, extra) {
    if (!ensureTurn()) return;
    if (!state.socket || !state.battleId || !state.playerId) return;
    state.socket.emit("player:action", {
      battleId: state.battleId,
      playerId: state.playerId,
      action: { type, ...(extra || {}) }
    });
  }

  // 타깃 선택기 연동(선택), 없으면 규칙 기본값
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

    // 선택기가 없으면 기본값: 힐은 자기 자신, 공격은 첫 적
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
      // 나머지는 대상 없이 전송
      sendAction(kind, extra);
      return;
    }

    // 선택기가 있는 경우
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
    if (el.myAvatar) el.myAvatar.src = me.avatar || DEFAULT_AVATAR;

    const teamKey = normalizeTeam(me.team);
    if (el.myTeam) {
      el.myTeam.textContent = TEAM_LABEL[teamKey] || teamKey;
      el.myTeam.className = `team-badge team-${teamKey}`;
    }

    // 스탯(각 1~5)
    const s = me.stats || {};
    if (el.statATK) el.statATK.textContent = clamp(num(s.attack ?? s.atk, 3), 1, 5);
    if (el.statDEF) el.statDEF.textContent = clamp(num(s.defense ?? s.def, 3), 1, 5);
    if (el.statAGI) el.statAGI.textContent = clamp(num(s.agility ?? s.dex, 3), 1, 5);
    if (el.statLUK) el.statLUK.textContent = clamp(num(s.luck ?? s.luk, 3), 1, 5);

    // HP
    const hp = num(me.hp, 100);
    const maxHp = num(me.maxHp, 100);
    const pct = clamp(Math.round((hp / Math.max(maxHp, 1)) * 100), 0, 100);
    if (el.myHpBar) el.myHpBar.style.width = pct + "%";
    if (el.myHpText) el.myHpText.textContent = `${hp} / ${maxHp}`;

    // 아이템
    if (el.itemDittany) el.itemDittany.textContent = num(me.items?.dittany, 0);
    if (el.itemAttack) el.itemAttack.textContent = num(me.items?.attack_booster, 0);
    if (el.itemDefense) el.itemDefense.textContent = num(me.items?.defense_booster, 0);
  }

  function renderTeammates() {
    if (!el.teammateList) return;
    const me = getMe();
    if (!me) {
      el.teammateList.innerHTML = `<div class="teammate-item">팀원이 없습니다</div>`;
      return;
    }
    const mates = (state.players || []).filter((p) => p.team === me.team && p.id !== me.id);
    if (!mates.length) {
      el.teammateList.innerHTML = `<div class="teammate-item">팀원이 없습니다</div>`;
      return;
    }
    el.teammateList.innerHTML = "";
    for (const t of mates) {
      const cur = clamp(Math.round((num(t.hp, 0) / Math.max(num(t.maxHp, 100), 1)) * 100), 0, 100);
      const div = document.createElement("div");
      div.className = "teammate-item";
      div.innerHTML = `
        <img class="teammate-avatar" src="${t.avatar || DEFAULT_AVATAR}" alt="${escapeHtml(t.name || "")}">
        <div class="teammate-info">
          <div class="teammate-name">${escapeHtml(t.name || "")}</div>
          <div class="teammate-hp">HP: ${num(t.hp, 0)}/${num(t.maxHp, 100)} (${cur}%)</div>
        </div>
      `;
      el.teammateList.appendChild(div);
    }
  }

  function renderRosters() {
    if (el.rosterPhoenix) el.rosterPhoenix.innerHTML = "";
    if (el.rosterDeath) el.rosterDeath.innerHTML = "";
    const roster = Array.isArray(state.players) ? state.players : [];
    for (const p of roster) {
      const card = document.createElement("div");
      card.className = "player-card";
      const hp = num(p.hp, 0);
      card.innerHTML = `
        <div class="pc-name">${escapeHtml(p.name || "")}</div>
        <div class="pc-hp">HP ${hp}</div>
      `;
      const teamKey = normalizeTeam(p.team);
      (teamKey === "phoenix" ? el.rosterPhoenix : el.rosterDeath)?.appendChild(card);
    }
  }

  function renderLog() {
    if (!el.battleLog) return;
    el.battleLog.innerHTML = "";
    const list = Array.isArray(state.log) ? state.log.slice(-MAX_LOG) : [];
    for (const l of list) {
      const line = document.createElement("div");
      line.className = `log-entry ${l.type || "system"}`;
      line.textContent = l.message || "";
      el.battleLog.appendChild(line);
    }
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function renderTurnBanner() {
    if (!el.turnName && !el.turnAvatar && !el.turnTimer) return;

    // 현재 턴 표시: 팀 이름 우선
    const teamKey = inferCurrentTeamKey();
    if (el.turnName) {
      el.turnName.textContent =
        state.status === "active"
          ? (TEAM_LABEL[teamKey] || (isMyTurn() ? "내 팀 턴" : "상대 팀 턴"))
          : "대기 중";
    }
    if (el.turnAvatar) {
      // 팀 대표 이미지가 없다면 기본 아바타
      el.turnAvatar.src = DEFAULT_AVATAR;
    }
    if (el.turnTimer) {
      if (state.turnEndsAt > Date.now()) {
        // 타이머가 돌고 있으면 계속 업데이트됨
      } else {
        el.turnTimer.textContent = "턴 시간: --";
      }
    }
  }

  function updateActionEnables() {
    const me = getMe();
    const alive = !!me && me.hp > 0;
    const can = state.status === "active" && isMyTurn() && alive;

    const toggle = (btn, on) => btn && (btn.disabled = !on);
    toggle(el.btnAttack, can);
    toggle(el.btnDefend, can);
    toggle(el.btnDodge, can);
    toggle(el.btnPass, can);

    // 아이템은 수량까지 체크
    toggle(el.btnItemAttack, can && num(me?.items?.attack_booster, 0) > 0);
    toggle(el.btnItemDefense, can && num(me?.items?.defense_booster, 0) > 0);
    toggle(el.btnItemDittany, can && num(me?.items?.dittany, 0) > 0);

    // 준비 버튼: 전투 시작 전만
    if (el.btnReady) el.btnReady.disabled = state.status === "active";
  }

  // -----------------------------
  // 채팅/로그
  // -----------------------------
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

  function appendLog(type, message) {
    if (!el.battleLog) return;
    const li = document.createElement("div");
    li.className = `log-entry ${type || "system"}`;
    li.textContent = message || "";
    el.battleLog.appendChild(li);
    trimChildren(el.battleLog, MAX_LOG);
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function trimChildren(box, max) {
    if (!box) return;
    const cs = box.children;
    while (cs.length > max) cs[0].remove();
  }

  // -----------------------------
  // 턴/도우미
  // -----------------------------
  function isMyTurn() {
    const me = getMe();
    if (!me) return false;
    // 서버가 팀키나 playerId로 보낼 수 있으므로 둘 다 검사
    if (state.current === me.id) return true;
    const teamKey = normalizeTeam(me.team);
    if (state.current === teamKey) return true;
    if (state.current && typeof state.current === "string") {
      // currentTeam이 "phoenix"|"death"|"eaters" 변형일 수 있음
      if (normalizeTeam(state.current) === teamKey) return true;
    }
    return false;
    // 주의: 개인 턴제가 아니라도 서버가 개인 id를 줄 수 있어 보수적으로 대응
  }

  function inferCurrentTeamKey() {
    // state.current가 팀키면 그대로 사용, playerId면 그 플레이어의 팀을 찾아서 반환
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
    if (left <= 0) {
      clearTurnTimer();
      return;
    }
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
})();
