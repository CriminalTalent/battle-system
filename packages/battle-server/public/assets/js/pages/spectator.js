/* spectator.js */
(() => {
  "use strict";

  /* ================= URL / State ================= */
  const qs = new URLSearchParams(location.search);
  const battleCode = qs.get("battle") || "";
  const otp = qs.get("otp") || "";

  // DOM refs
  const $leftGrid   = byId("leftGrid");
  const $rightGrid  = byId("rightGrid");
  const $leftCount  = byId("leftCount");
  const $rightCount = byId("rightCount");
  const $turnPill   = byId("turnPill");
  const $log        = byId("battleLog");

  // socket
  let socket = null;
  let pollTimer = null;

  /* ================= Fetch helpers ================= */
  async function fetchJSON(url, opt){
    const res = await fetch(url, { headers: { "Content-Type":"application/json" }, ...opt });
    if(!res.ok) throw new Error(res.status + " " + res.statusText);
    try { return await res.json(); } catch { return {}; }
  }

  async function fetchState(){
    if(!battleCode) return;
    const s = await fetchJSON(`/api/battles/${encodeURIComponent(battleCode)}`);
    renderState(s);
  }

  /* ================= Render ================= */
  function renderState(state){
    if(!state || !state.players) return;
    const left  = teamArray(state, "phoenix", "A");
    const right = teamArray(state, "eaters",  "B");

    renderTeam($leftGrid, left);
    renderTeam($rightGrid, right);
    if ($leftCount)  $leftCount.textContent  = String(left.length);
    if ($rightCount) $rightCount.textContent = String(right.length);

    const turnName = state?.turn?.currentName || state?.turn?.currentPlayerName || "";
    if ($turnPill) $turnPill.textContent = turnName ? "현재 턴: " + turnName : "대기중";
  }

  function renderTeam(container, arr){
    if(!container) return;
    container.innerHTML = "";
    arr.forEach(p => {
      const item = el("div", "roster-item");
      const top = el("div", "ri-top");
      const name = el("div", "ri-name");
      name.textContent = p.name || p.id || "-";
      const hp = el("div", "ri-hp");
      const bar = el("div", "ri-hpbar");
      const fill = el("i"); fill.style.width = Math.max(0, Math.min(100, p.hp || 0)) + "%";
      bar.appendChild(fill); hp.appendChild(bar);
      top.appendChild(name);
      item.appendChild(top); item.appendChild(hp);
      container.appendChild(item);
    });
  }

  function teamArray(state, primaryKey, altKey){
    if (Array.isArray(state.players)) {
      const px = state.players.filter(p => isPhoenix(p.team));
      const ex = state.players.filter(p => isEaters(p.team));
      return primaryKey === "phoenix" ? px : ex;
    }
    const teams = state.teams || {};
    return teams[primaryKey] || teams[altKey] || [];
  }

  function isPhoenix(v){
    const s = String(v||"").toLowerCase();
    return ["phoenix","left","team1","a"].includes(s);
  }
  function isEaters(v){
    const s = String(v||"").toLowerCase();
    return ["eaters","right","team2","b","death","deatheaters"].includes(s);
  }

  /* ================= Socket ================= */
  function startPolling(){
    if (pollTimer) return;
    pollTimer = setInterval(() => { fetchState().catch(()=>{}); }, 3000);
  }

  async function connectSocket(){
    if (!window.io) {
      const s = document.createElement("script");
      s.src = "/socket.io/socket.io.js";
      document.head.appendChild(s);
      await new Promise(r => s.onload = r);
    }
    // eslint-disable-next-line no-undef
    socket = io("/", {
      transports: ["websocket","polling"],
      auth: { role:"spectator", battle: battleCode, battleCode, otp }
    });

    socket.on("connect", () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      // 일부 서버는 명시적 join 요구
      try { socket.emit("spectator:join", { battle: battleCode, battleCode, otp }); } catch(e){}
      try { socket.emit("joinBattle", { battleId: battleCode, role: "spectator", otp }); } catch(e){}
    });

    // joinSuccess(신규 서버) 호환
    socket.on("joinSuccess", (payload) => {
      try { addLog("시스템", "관전 인증 완료"); } catch(e){}
      try { fetchState(); } catch(e){}
    });

    socket.on("disconnect", (reason) => {
      addLog("연결", "끊김: " + reason);
      startPolling();
    });

    // 상태 이벤트 다양한 네이밍 호환
    socket.on("battle:update", (s) => renderState(s || {}));
    socket.on("battleUpdate",  (s) => renderState(s || {}));
    socket.on("state:full",    (s) => renderState(s || {}));
    socket.on("state:delta",   ()  => fetchState().catch(()=>{}));

    // 로그 네이밍 호환
    socket.on("log",         (m) => addLog("로그", (m && (m.text||m.msg)) || String(m)));
    socket.on("battle:log",  (m) => addLog("로그", (m && (m.text||m.msg)) || String(m)));
  }

  // 초기 연결 시도
  (battleCode ? connectSocket() : Promise.resolve())
    .catch(() => startPolling());
  // Prime once
  fetchState().catch(() => {});

  /* ================= Utilities ================= */
  function byId(id){ return document.getElementById(id); }
  function el(tag, cls){ const n = document.createElement(tag); if(cls) n.className = cls; return n; }
  function esc(v){ const d = document.createElement("div"); d.textContent = String(v ?? ""); return d.textContent; }

  function addLog(source, text){
    if (!$log) return;
    const row = el("div","log-item");
    const t = el("span","log-time");
    const x = el("div","log-text");
    const now = new Date();
    t.textContent = formatTime(now);
    x.textContent = `[${source || "알림"}] ${text}`;
    row.appendChild(t); row.appendChild(x);
    $log.appendChild(row);
    $log.scrollTop = $log.scrollHeight;
  }
  function formatTime(d){
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    const ss = String(d.getSeconds()).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }
})();
