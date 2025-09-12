// packages/battle-server/public/assets/js/spectator.js
// - 관전자 인증: spectatorAuth / spectator:auth (양쪽 호환) + join
// - URL ?battle= & (otp|token)= 인식, 이름은 선택
// - 좌우 A/B팀 로스터(HP바+스탯), 중앙 현재 순서 인물 이미지, 아래 응원 버튼/로그/채팅(보기 전용)
// - 팀 표기는 항상 A/B만 사용(수신 스냅샷도 정규화)
// - 이모지 금지, 기존 표기/스타일 유지

(function () {
  "use strict";

  /* ========== DOM 헬퍼 ========== */
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const escapeHtml = (s) =>
    String(s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  /* ========== 팀 정규화(A/B만) ========== */
  function toAB(team) {
    const s = String(team || "").toLowerCase();
    if (s === "phoenix" || s === "a" || s === "team_a" || s === "team-a") return "A";
    if (s === "eaters" || s === "b" || s === "death" || s === "team_b" || s === "team-b") return "B";
    return "-";
  }
  function fromAB(ab) {
    // 내부 호환용(서버가 phoenix/eaters로 줄 수도 있어도 렌더는 AB만 씀)
    return ab === "A" ? "phoenix" : "eaters";
  }

  /* ========== 요소 ========== */
  const el = {
    authView: $("#authView"),
    mainView: $("#mainView"),

    authBattle: $("#authBattle"),
    authOtp: $("#authOtp") || $("#authToken"),
    authName: $("#authName"),
    btnAuth: $("#btnAuth"),

    statusPill: $("#statusPill"),
    turnTeam: $("#turnTeam"),
    turnImg: $("#turnImg"),
    queue: $("#queue"),

    rosterA: $("#rosterPhoenix") || $("#rosterA"),
    rosterB: $("#rosterEaters") || $("#rosterB"),

    timeline: $("#timelineFeed") || $("#battleLog") || $("#log"),
    chatMessages: $("#chatMessages") || $("#chat"),

    cheerButtons: $$(".cheer-btn"),
    toast: $("#toast"),
  };

  /* ========== 상태 ========== */
  const state = {
    socket: null,
    battleId: null,
    otp: null,
    name: "",
    status: "waiting",
    players: [],
    // 턴 구조는 항상 order=["A","B"] / phaseIndex=0|1 로 정규화
    teamOrder: ["A", "B"],
    phaseIndex: 0,
  };

  /* ========== 초기화 ========== */
  document.addEventListener("DOMContentLoaded", () => {
    connect();
    autofillFromURL();
    bindUI();
  });

  function connect() {
    const socket = window.io
      ? window.io(window.location.origin, {
          path: "/socket.io",
          transports: ["websocket", "polling"],
          withCredentials: true,
          timeout: 20000,
        })
      : null;
    if (!socket) {
      alert("Socket.IO 로드 실패");
      return;
    }
    state.socket = socket;
    bindSocket();
  }

  function bindUI() {
    el.btnAuth?.addEventListener("click", onAuth);

    // 응원 버튼
    el.cheerButtons.forEach((b) => {
      b.addEventListener("click", () => {
        const cheer = b.textContent.trim();
        sendCheer(cheer);
        try {
          b.classList.add("shimmer");
          setTimeout(() => b.classList.remove("shimmer"), 900);
        } catch (_) {}
      });
    });
  }

  function autofillFromURL() {
    const p = new URLSearchParams(location.search);
    const battle = p.get("battle");
    const otp = p.get("otp") || p.get("token");
    const name = p.get("name") || "";

    if (battle) el.authBattle.value = battle;
    if (otp) el.authOtp.value = otp;
    if (name) el.authName.value = name;

    if (battle && otp) onAuth();
  }

  /* ========== 인증 ========== */
  function onAuth() {
    const battleId = (el.authBattle.value || "").trim();
    const otp = (el.authOtp.value || "").trim();
    const name = (el.authName.value || "").trim();
    if (!battleId || !otp) return showToast("전투 ID와 비밀번호를 입력하세요");

    state.battleId = battleId;
    state.otp = otp;
    state.name = name;

    const s = state.socket;
    // 양쪽 호환 이벤트 송신
    s.emit("spectatorAuth", { battleId, otp, name });
    s.emit("spectator:auth", { battleId, otp, name });

    // 룸 합류
    s.emit("join", { battleId });
  }

  /* ========== 소켓 바인딩 ========== */
  function bindSocket() {
    const s = state.socket;

    s.on("auth:success", (payload) => {
      showMain();
      if (payload?.battle) {
        applySnapshot(payload.battle);
      }
      renderAll();
      showToast("접속 완료");
    });

    s.on("authError", (e) => showToast("인증 실패: " + (e?.error || e?.message || "오류"), "error"));
    s.on("auth:error", (e) => showToast("인증 실패: " + (e?.error || e?.message || "오류"), "error"));

    s.on("battle:update", (snap) => {
      applySnapshot(snap);
      renderAll();
    });

    // 턴 힌트(있으면 사용)
    s.on("turn:start", (p) => {
      // 선택적 배너
      try {
        const ab = toAB(p?.phaseTeam) || currentPhaseAB();
        window.PyxisEffects?.bannerCommit(ab);
      } catch (_) {}
    });

    s.on("battle:ended", (p) => {
      try {
        const winnerKey = p?.winner; // "phoenix"|"eaters"|null
        const ab = winnerKey ? toAB(winnerKey) : null;
        if (ab) window.PyxisEffects?.bannerWin(ab);
      } catch (_) {}
    });

    // 채팅(보기 전용)
    s.on("battle:chat", ({ name, message }) => appendChat(name || "플레이어", message || ""));
    s.on("chat:message", (payload) => {
      const name = payload?.senderName || payload?.name || "플레이어";
      const message = payload?.message || "";
      appendChat(name, message);
    });

    // 로그/타임라인
    s.on("battle:log", ({ type, message, ts }) => {
      appendLog(type || "info", normalizeTeamWords(message || ""), ts || Date.now());
    });

    // 관전자 수(옵션)
    s.on("spectator:count", ({ count }) => {
      // 필요 시 UI에 반영
      void count;
    });
    s.on("spectator:count_update", ({ count }) => {
      void count;
    });
  }

  /* ========== 스냅샷 반영(정규화: 팀 A/B 고정) ========== */
  function applySnapshot(b) {
    if (!b) return;

    state.status = b.status || "waiting";

    // players: team 필드를 A/B 로 변환(렌더는 A/B만 사용)
    const players = Array.isArray(b.players) ? b.players : [];
    state.players = players.map((p) => ({
      ...p,
      teamAB: toAB(p.team),
    }));

    // turn.order / phaseIndex 정규화
    const order =
      (b.turn && Array.isArray(b.turn.order) && b.turn.order.length === 2 ? b.turn.order : ["A", "B"]).map(toAB);
    state.teamOrder = order[0] === "B" ? ["B", "A"] : ["A", "B"]; // 안전 보정
    state.phaseIndex = typeof b.turn?.phaseIndex === "number" ? (b.turn.phaseIndex === 1 ? 1 : 0) : 0;
  }

  /* ========== 렌더 ========== */
  function renderAll() {
    // 상태 표기
    el.statusPill &&
      (el.statusPill.textContent =
        { waiting: "대기 중", active: "진행 중", paused: "일시정지", ended: "종료" }[state.status] || "대기 중");

    // 현재 순서팀
    const phaseAB = currentPhaseAB();
    el.turnTeam && (el.turnTeam.textContent = `현재 순서팀: ${phaseAB}`);

    // 로스터
    renderRoster();

    // 순서 큐 & 대표 이미지
    renderQueue();
    updateMainImageByQueue();
  }

  function currentPhaseAB() {
    return state.teamOrder[state.phaseIndex] || "A";
  }

  function renderRoster() {
    const listA = [];
    const listB = [];
    (state.players || []).forEach((p) => {
      (p.teamAB === "A" ? listA : listB).push(p);
    });

    const build = (p) => {
      const maxHp = p.maxHp ?? 100;
      const hp = Math.max(0, p.hp || 0);
      const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      const atk = p.stats?.attack ?? p.stats?.공격 ?? "-";
      const def = p.stats?.defense ?? p.stats?.방어 ?? "-";
      const agi = p.stats?.agility ?? p.stats?.민첩 ?? "-";
      const luk = p.stats?.luck ?? p.stats?.행운 ?? "-";
      const row = document.createElement("div");
      row.className = "member";
      row.innerHTML = `
        <div class="ava">${p.avatar ? `<img src="${p.avatar}" alt="">` : ""}</div>
        <div class="body">
          <div class="name">${escapeHtml(p.name || "-")} · 팀 ${p.teamAB}</div>
          <div class="sub">공 ${atk} · 방 ${def} · 민 ${agi} · 운 ${luk}</div>
          <div class="hpbar" style="margin-top:6px"><i style="width:${hpPct}%"></i></div>
          <div class="sub">HP ${hp}/${maxHp}</div>
        </div>
      `;
      return row;
    };

    if (el.rosterA) {
      el.rosterA.innerHTML = "";
      listA.forEach((p) => el.rosterA.appendChild(build(p)));
    }
    if (el.rosterB) {
      el.rosterB.innerHTML = "";
      listB.forEach((p) => el.rosterB.appendChild(build(p)));
    }
  }

  function renderQueue() {
    if (!el.queue) return;
    el.queue.innerHTML = "";

    const phaseAB = currentPhaseAB();
    const alive = (state.players || []).filter((p) => (p.hp || 0) > 0 && p.teamAB === phaseAB);

    alive.forEach((p, i) => {
      const q = document.createElement("div");
      q.className = "qitem" + (i === 0 ? " active" : "");
      q.innerHTML = `<img src="${p.avatar || ""}" alt=""><div class="name">${escapeHtml(p.name || "")}</div>`;
      el.queue.appendChild(q);
    });
  }

  function updateMainImageByQueue() {
    if (!el.turnImg || !el.queue) return;
    const first = el.queue.querySelector(".qitem img");
    const src = first ? first.getAttribute("src") : "";
    el.turnImg.src = src || "";
  }

  /* ========== 응원/채팅(보기 전용) ========== */
  function sendCheer(message) {
    if (!state.socket || !state.battleId) return;
    // 관전자 응원(양쪽 호환 이벤트)
    state.socket.emit("spectator:cheer", { battleId: state.battleId, message });
    state.socket.emit("cheer:send", { battleId: state.battleId, name: state.name || "관전자", message });
    appendLog("cheer", `관전자 응원: ${message}`);
  }

  function appendChat(sender, text) {
    if (!el.chatMessages) return;
    const d = document.createElement("div");
    d.textContent = `${sender}: ${text}`;
    el.chatMessages.appendChild(d);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function appendLog(_type, message, _ts) {
    if (!el.timeline || !message) return;
    const d = document.createElement("div");
    d.textContent = message;
    el.timeline.appendChild(d);
    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  /* ========== 화면 전환/유틸 ========== */
  function showMain() {
    if (el.authView) el.authView.style.display = "none";
    if (el.mainView) el.mainView.style.display = "";
  }

  function showToast(msg, kind) {
    if (!el.toast) return;
    el.toast.className = "toast" + (kind ? " " + kind : "");
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    setTimeout(() => el.toast.classList.remove("show"), 1600);
  }

  function normalizeTeamWords(s) {
    // 서버에서 phoenix/eaters로 올 수 있는 문자열을 A/B로 변환
    return String(s || "")
      .replace(/\bphoenix\b/gi, "A팀")
      .replace(/\beaters\b/gi, "B팀");
  }
})();
