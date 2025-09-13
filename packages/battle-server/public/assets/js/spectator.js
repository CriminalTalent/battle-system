// packages/battle-server/public/assets/js/spectator.js
// PYXIS Spectator View (개선 통짜)
// - 관전자 인증: spectatorAuth / spectator:auth (양쪽 호환) + join
// - URL ?battle= & (otp|token|password)= 인식, 이름은 선택
// - 팀 표기는 항상 A/B만 사용(수신 스냅샷도 정규화)
// - 로스터(HP/스탯/아이템), 현재 순서 큐 & 초상화 교체, 팀 제한 타이머
// - 로그 타입별 스타일/이펙트 적용(critical/damage/heal/cheer/chat/battle/system)
// - 채팅은 보기 전용, 응원 버튼은 양쪽 이벤트 전송(spectator:cheer / cheerMessage / cheer:send)

(function () {
  "use strict";

  /* ========== DOM 헬퍼 ========== */
  const $  = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => [...root.querySelectorAll(q)];
  const el = {
    authView:   $("#authView"),
    mainView:   $("#mainView"),

    authBattle: $("#authBattle"),
    authOtp:    $("#authOtp") || $("#authToken") || $("#passwordInput"),
    authName:   $("#authName") || $("#nameInput"),
    btnAuth:    $("#btnAuth")  || $("#authBtn"),

    // 상단 상태/턴
    statusPill: $("#statusPill"),
    turnTeam:   $("#turnTeam"),
    turnImg:    $("#turnImg") || $("#currentCharacterImg"),
    queue:      $("#queue"),
    turnTimer:  $("#turnTimer"),   // 선택 (없어도 동작)

    // 좌/우 팀 로스터
    rosterA: $("#rosterA") || $("#rosterPhoenix"),
    rosterB: $("#rosterB") || $("#rosterEaters"),

    // 로그/채팅
    timeline: $("#timelineFeed") || $("#battleLog") || $("#log"),
    chatBox:  $("#chatMessages") || $("#chat"),

    // 응원 버튼
    cheerButtons: $$(".cheer-btn"),

    // 토스트
    toast: $("#toast"),
  };

  /* ========== 상태 ========== */
  const state = {
    socket: null,
    battleId: null,
    otp: null,
    name: "관전자",
    status: "waiting",
    players: [],
    // 턴 구조(order는 항상 2개, phaseIndex 0|1 가정)
    teamOrder: ["A", "B"],
    phaseIndex: 0,
    turnStartedAt: null,   // ms
    teamTimeLimitMs: 5 * 60 * 1000,
    timerHandle: null,
  };

  /* ========== 유틸 ========== */
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }
  function toAB(team) {
    const s = String(team || "").toLowerCase();
    if (["phoenix","a","team_a","team-a"].includes(s)) return "A";
    if (["eaters","b","death","team_b","team-b"].includes(s)) return "B";
    return "-";
  }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function now(){ return Date.now(); }
  function normalizeTeamWords(str){
    return String(str||"").replace(/\bphoenix\b/gi,"A팀").replace(/\beaters\b/gi,"B팀");
  }

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
          transports: ["websocket","polling"],
          withCredentials: true,
          timeout: 20000,
        })
      : null;
    if (!socket) { alert("Socket.IO 로드 실패"); return; }
    state.socket = socket;
    bindSocket();
  }

  function bindUI() {
    el.btnAuth?.addEventListener("click", onAuth);

    // 응원 버튼
    el.cheerButtons.forEach((b) => {
      b.addEventListener("click", () => {
        const cheer = b.dataset.cheer || b.textContent.trim();
        sendCheer(cheer);
        try { b.classList.add("shimmer"); setTimeout(()=>b.classList.remove("shimmer"), 900); } catch (_) {}
      });
    });
  }

  function autofillFromURL() {
    const p = new URLSearchParams(location.search);
    const battle = p.get("battle");
    const otp = p.get("otp") || p.get("token") || p.get("password");
    const name = p.get("name");

    if (battle) el.authBattle && (el.authBattle.value = battle);
    if (otp)    el.authOtp    && (el.authOtp.value    = otp);
    if (name)   el.authName   && (el.authName.value   = name);

    if (battle && otp) onAuth();
  }

  /* ========== 인증 ========== */
  function onAuth() {
    const battleId = (el.authBattle?.value || "").trim();
    const otp      = (el.authOtp?.value    || "").trim();
    const name     = (el.authName?.value   || "").trim();

    if (!battleId || !otp) return toast("전투 ID와 비밀번호를 입력하세요","error");

    state.battleId = battleId;
    state.otp = otp;
    state.name = name || state.name;

    const s = state.socket;
    // 양쪽 이벤트 전송
    s.emit("spectatorAuth", { battleId, otp, name: state.name });
    s.emit("spectator:auth", { battleId, otp, name: state.name });
    // 룸 조인
    s.emit("join", { battleId });
  }

  /* ========== 소켓 바인딩 ========== */
  function bindSocket() {
    const s = state.socket;

    // 인증 성공
    s.on("auth:success", (payload) => {
      showMain();
      if (payload?.battle) applySnapshot(payload.battle);
      renderAll();
      toast("접속 완료","success");
    });
    // 구 이벤트 리레이
    s.on("authSuccess", (payload) => s.emit("auth:success", payload));

    // 인증 실패
    const onAuthErr = (e) => toast("인증 실패: " + (e?.error || e?.message || "오류"), "error");
    s.on("authError", onAuthErr);
    s.on("auth:error", onAuthErr);

    // 스냅샷
    const onSnap = (snap) => { applySnapshot(snap); renderAll(); };
    s.on("battle:update", onSnap);
    s.on("battleUpdate", onSnap);
    s.on("battleState", onSnap);
    s.on("state:update", onSnap);

    // 턴/전투 상태
    s.on("battle:started", (b) => {
      toast("전투가 시작되었습니다");
      window.PyxisEffects?.showBanner?.("전투 시작", "info");
    });
    s.on("battle:ended", (b) => {
      const w = (b?.winner || b?.winnerTeam || "").toString().toUpperCase();
      const winText = w==="A" ? "A팀 승리" : w==="B" ? "B팀 승리" : "전투 종료";
      window.PyxisEffects?.showResultBanner?.(winText, "win", 2000);
      stopTeamTimer();
    });

    // 로그 (신/구)
    s.on("battle:log", onServerLog);
    s.on("battleLog",  (line) => {
      // 문자열/객체 모두 수용
      if (typeof line === "string") onServerLog({ type: inferTypeFromText(line), message: line, ts: now() });
      else onServerLog(line);
    });

    // 채팅(보기 전용)
    s.on("battle:chat", ({ name, message }) => appendChat(name || "플레이어", message || ""));
    s.on("chat:message", (payload) => appendChat(payload?.senderName || payload?.name || "플레이어", payload?.message || ""));
    s.on("chatMessage",  (payload) => {
      if (typeof payload === "string") appendChat("플레이어", payload);
      else appendChat(payload?.name || payload?.senderName || "플레이어", payload?.message || "");
    });

    // 응원(수신 → 로그 표시)
    s.on("spectator:cheer", ({ name, message }) => addLogEntry(`[응원] ${name||"관전자"}: ${message}`, "cheer"));
    s.on("cheerMessage",   ({ name, message }) => addLogEntry(`[응원] ${name||"관전자"}: ${message}`, "cheer"));
  }

  /* ========== 서버 로그 처리 ========== */
  function onServerLog(payload) {
    const type = (payload?.type || "").toLowerCase();
    const message = normalizeTeamWords(payload?.message || "");
    const ts = payload?.ts || now();

    // 타입 매핑
    const mapped =
      type.includes("crit")     ? "critical" :
      type.includes("damage")   ? "damage"   :
      type.includes("heal")     ? "heal"     :
      type.includes("cheer")    ? "cheer"    :
      type.includes("chat")     ? "chat"     :
      type.includes("system")   ? "system"   :
      type.includes("battle")   ? "battle"   :
      type.includes("info")     ? "system"   :
      inferTypeFromText(message);

    addLogEntry(message, mapped, ts);

    // 선택: 이펙트 훅
    try {
      if (mapped === "critical") window.PyxisEffects?.sparkle?.();
      else if (mapped === "damage") window.PyxisEffects?.shake?.();
      else if (mapped === "heal") window.PyxisEffects?.pulse?.();
    } catch (_) {}
  }

  function inferTypeFromText(text) {
    const s = String(text||"");
    if (/치명타|크리티컬/i.test(s)) return "critical";
    if (/피해|데미지|타격/i.test(s)) return "damage";
    if (/회복|치유|힐/i.test(s))     return "heal";
    if (/응원|cheer/i.test(s))       return "cheer";
    if (/시작|종료|라운드|선공|후공/i.test(s)) return "battle";
    if (/말함|: /.test(s))           return "chat";
    return "system";
  }

  /* ========== 스냅샷 반영(정규화) ========== */
  function applySnapshot(b) {
    if (!b) return;
    state.status = b.status || "waiting";

    // 플레이어
    const players = Array.isArray(b.players) ? b.players : [];
    state.players = players.map((p) => ({ ...p, teamAB: toAB(p.team) }));

    // 턴 정보
    const orderRaw = (b.turn && Array.isArray(b.turn.order) && b.turn.order.length===2) ? b.turn.order : ["A","B"];
    const orderAB = orderRaw.map(toAB);
    state.teamOrder = (orderAB[0]==="B") ? ["B","A"] : ["A","B"];
    state.phaseIndex = (typeof b.turn?.phaseIndex === "number" && b.turn.phaseIndex===1) ? 1 : 0;

    // 팀 제한 타이머
    state.turnStartedAt = Number(b.turnStartTime || b.turn?.startedAt || b.turn?.started_at || b.turn?.ts) || now();
    ensureTeamTimer();
  }

  /* ========== 렌더 ========== */
  function renderAll() {
    // 상태표시
    if (el.statusPill) {
      el.statusPill.textContent = ({ waiting:"대기 중", active:"진행 중", paused:"일시정지", ended:"종료" }[state.status]) || "대기 중";
    }

    // 현재 순서팀
    const phaseAB = currentPhaseAB();
    el.turnTeam && (el.turnTeam.textContent = `현재 순서팀: ${phaseAB}`);

    // 로스터
    renderRoster();

    // 순서 큐 & 메인 이미지
    renderQueue();
    updateMainImageByQueue();
  }

  function currentPhaseAB() {
    return state.teamOrder[state.phaseIndex] || "A";
  }

  function renderRoster() {
    const A = [], B = [];
    (state.players || []).forEach(p => (p.teamAB==="A" ? A : B).push(p));

    const build = (p) => {
      const maxHp = p.maxHp ?? 100;
      const hp = Math.max(0, p.hp || 0);
      const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      const st = p.stats || {};
      const it = p.items || {};
      const atk = st.attack ?? st.공격 ?? "-";
      const def = st.defense ?? st.방어 ?? "-";
      const agi = st.agility ?? st.민첩 ?? "-";
      const luk = st.luck ?? st.행운 ?? "-";
      const dit = +it.dittany || 0;
      const iAtk= +it.attack_boost || 0;
      const iDef= +it.defense_boost || 0;

      const row = document.createElement("div");
      row.className = "member";
      row.innerHTML = `
        <div class="ava">${p.avatar ? `<img src="${p.avatar}" alt="">` : ""}</div>
        <div class="body">
          <div class="name">${escapeHtml(p.name || "-")} · 팀 ${p.teamAB}</div>
          <div class="sub">공 ${atk} · 방 ${def} · 민 ${agi} · 운 ${luk}</div>
          <div class="hpbar" style="margin-top:6px"><i style="width:${hpPct}%"></i></div>
          <div class="sub">HP ${hp}/${maxHp}</div>
          <div class="sub">아이템(1회용): 디터니 ${dit} · 공보 ${iAtk} · 방보 ${iDef}</div>
        </div>
      `;
      return row;
    };

    if (el.rosterA) { el.rosterA.innerHTML=""; A.forEach(p=> el.rosterA.appendChild(build(p))); }
    if (el.rosterB) { el.rosterB.innerHTML=""; B.forEach(p=> el.rosterB.appendChild(build(p))); }
  }

  function renderQueue() {
    if (!el.queue) return;
    el.queue.innerHTML = "";
    const phaseAB = currentPhaseAB();
    const alive = (state.players || []).filter(p => (p.hp||0) > 0 && p.teamAB === phaseAB);
    alive.forEach((p,i) => {
      const q = document.createElement("div");
      q.className = "qitem" + (i===0 ? " active" : "");
      q.innerHTML = `<img src="${p.avatar||""}" alt=""><div class="name">${escapeHtml(p.name||"")}</div>`;
      el.queue.appendChild(q);
    });
  }

  function updateMainImageByQueue() {
    if (!el.turnImg || !el.queue) return;
    const first = el.queue.querySelector(".qitem img");
    el.turnImg.src = first ? (first.getAttribute("src") || "") : "";
  }

  /* ========== 팀 제한 타이머 ========== */
  function ensureTeamTimer() {
    if (!el.turnTimer) return;
    stopTeamTimer();
    tickTimer(); // 즉시 1회 갱신
    state.timerHandle = setInterval(tickTimer, 500);
  }
  function stopTeamTimer() {
    if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
  }
  function tickTimer() {
    const base = state.turnStartedAt || now();
    const remain = Math.max(0, state.teamTimeLimitMs - (now() - base));
    const m = Math.floor(remain/60000);
    const s = Math.floor((remain%60000)/1000);
    el.turnTimer.textContent = `팀 제한 시간 ${m}:${pad2(s)}`;
  }

  /* ========== 응원/채팅/로그 ========== */
  function sendCheer(message) {
    if (!state.socket || !state.battleId) return;
    const payload = { battleId: state.battleId, name: state.name || "관전자", message };
    // 신규 + 레거시 모두 발사(서버 어떤 쪽이든 수신하도록)
    state.socket.emit("cheer:send", payload);
    state.socket.emit("spectator:cheer", payload);
    state.socket.emit("cheerMessage", payload);
    addLogEntry(`[응원] ${payload.name}: ${message}`, "cheer");
  }

  function appendChat(sender, text) {
    if (!el.chatBox) return;
    const d = document.createElement("div");
    d.textContent = `${sender}: ${text}`;
    el.chatBox.appendChild(d);
    el.chatBox.scrollTop = el.chatBox.scrollHeight;
  }

  function addLogEntry(message, type="system", ts=now()) {
    if (!el.timeline || !message) return;

    // 타입별 CSS 클래스 매핑 (spectator.html의 스타일에 맞춤)
    const cls =
      type === "critical" ? "critical" :
      type === "damage"   ? "damage"   :
      type === "heal"     ? "heal"     :
      type === "cheer"    ? "cheer"    :
      type === "chat"     ? "chat"     :
      type === "battle"   ? "battle"   :
                            "system";

    const wrap = document.createElement("div");
    wrap.className = `log-entry ${cls} new`;
    const time = new Date(ts);
    const hh = pad2(time.getHours());
    const mm = pad2(time.getMinutes());
    const ss = pad2(time.getSeconds());

    wrap.innerHTML = `
      <div class="log-timestamp">${hh}:${mm}:${ss}</div>
      <div class="log-content">${escapeHtml(normalizeTeamWords(message))}</div>
    `;
    el.timeline.appendChild(wrap);
    el.timeline.scrollTop = el.timeline.scrollHeight;

    // 진입 이펙트
    setTimeout(()=> wrap.classList.remove("new"), 100);

    // 선택: 외부 이펙트 훅
    try {
      if (cls==="critical") window.PyxisEffects?.sparkle?.();
      else if (cls==="damage") window.PyxisEffects?.shake?.();
      else if (cls==="heal") window.PyxisEffects?.pulse?.();
    } catch (_) {}
  }

  /* ========== 화면 전환/토스트 ========== */
  function showMain() {
    if (el.authView) el.authView.style.display = "none";
    if (el.mainView) el.mainView.style.display = "";
  }
  function toast(msg, kind) {
    if (!el.toast) return;
    el.toast.className = "toast" + (kind ? ` ${kind}` : "");
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    setTimeout(()=> el.toast.classList.remove("show"), 1600);
  }
})();
