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
  const $cheer      = byId("cheerButtons");
  const $arenaHero  = byId("arenaHero");

  // State
  let socket = null;
  let pollTimer = null;
  let lastState = null;

  // Fixed neutral cheers (6)
  const FIXED_CHEERS = [
    "멋지다!",
    "이겨라!",
    "살아서 돌아와!",
    "화이팅!",
    "죽으면 나한테 죽어!",
    "힘내요!"
  ];

  // Guard
  if (!battleCode) {
    addLog("시스템", "관전자 URL의 battle 파라미터가 없습니다.");
  }

  /* ================= Init ================= */
  // Build cheer buttons if empty
  buildCheerButtons();
  // Try socket first, else polling
  ensureSocket()
    .then(connectSocket)
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

  async function fetchJSON(url, opts={}){
    const baseHeaders = { "Content-Type":"application/json" };
    const headers = otp ? { ...baseHeaders, "x-otp": otp } : baseHeaders;
    const res = await fetch(url, { headers, ...opts });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return { raw:text }; }
  }

  /* ================= Data fetch / polling ================= */
  async function fetchState(){
    if (!battleCode) return;
    // 다양한 엔드포인트 이름 호환
    const url = `/api/battles/${encodeURIComponent(battleCode)}/state`;
    const data = await fetchJSON(url, { method:"GET" });
    renderState(data);
    return data;
  }

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      fetchState().catch(()=>{});
    }, 2000);
    addLog("시스템","실시간 연결 실패 – 폴링으로 전환");
  }

  /* ================= Socket ================= */
  function ensureSocket(){
    return new Promise((resolve, reject) => {
      if (typeof window.io === "function") return resolve(true);
      const s = document.createElement("script");
      s.src = "/socket.io/socket.io.js";
      s.onload = () => resolve(true);
      s.onerror = () => {
        const cdn = document.createElement("script");
        cdn.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
        cdn.onload = () => resolve(true);
        cdn.onerror = () => reject(new Error("socket.io not found"));
        document.head.appendChild(cdn);
      };
      document.head.appendChild(s);
    });
  }

  async function connectSocket(){
    // eslint-disable-next-line no-undef
    socket = io("/", {
      transports: ["websocket","polling"],
      auth: { role:"spectator", battle: battleCode, battleCode, otp },
      timeout: 8000
    });

    socket.on("connect", () => {
      addLog("시스템", "실시간 연결됨");
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      // 일부 서버는 명시적 join 요구
      try { socket.emit("spectator:join", { battle: battleCode, battleCode, otp }); } catch(e){}
    });

    socket.on("disconnect", (reason) => {
      addLog("시스템", `연결 해제됨: ${reason}`);
      startPolling();
    });

    // ---- State events (호환 핸들링) ----
    const onState = (payload) => renderState(payload);
    socket.on("battle:update", onState);
    socket.on("battleUpdate",  onState);
    socket.on("state:full",    onState);
    socket.on("state:delta",   (delta) => applyDelta(delta));

    // ---- Log events ----
    socket.on("log", (line) => {
      const msg = typeof line === "string" ? line : (line?.message || line?.text || "");
      if (msg) addLog("전투", msg);
    });
    socket.on("battle:log", (entry) => {
      const msg = entry?.text || entry?.message;
      if (msg) addLog("전투", msg);
    });

    return true;
  }

  /* ================= Render ================= */
  function renderState(state){
    if (!state) return;
    lastState = state;

    // Teams
    const left  = pickTeamArray(state, "phoenix", "left");
    const right = pickTeamArray(state, "eaters",  "right");

    renderTeam($leftGrid,  $leftCount,  left,  "phoenix");
    renderTeam($rightGrid, $rightCount, right, "eaters");

    // Turn pill
    let pillText = "대기중";
    const phase = state.phase || state.status;
    if (phase === "running" || phase === "active") {
      const side = (state.turn && (state.turn.team || state.turn.side)) || "";
      if (isPhoenix(side)) pillText = "불사조 팀의 턴";
      else if (isEaters(side)) pillText = "죽음을 먹는 자 팀의 턴";
      else pillText = "진행중";
    } else if (phase === "finished" || phase === "ended") {
      pillText = "전투 종료";
    }
    if ($turnPill) $turnPill.textContent = pillText;

    // Center avatar / emblem
    const heroUrl = state.arenaAvatar || state.centerAvatar || state.emblem;
    if ($arenaHero && typeof heroUrl === "string" && heroUrl) {
      $arenaHero.style.background = `center/cover no-repeat url("${heroUrl}")`;
      $arenaHero.style.border = "1px solid rgba(220,199,162,0.35)";
      $arenaHero.style.boxShadow = "0 12px 32px rgba(0,0,0,0.35), inset 0 0 24px rgba(212,186,141,0.12)";
    }
  }

  function applyDelta(delta){
    if (!delta) return;
    // 간단 병합: players/teams, turn, logs
    const merged = Object.assign({}, lastState || {}, delta);

    // 팀 배열이 조각으로 왔을 수 있으니 보수적으로 병합
    if (delta.players || delta.teams) {
      merged.players = delta.players || (lastState && lastState.players) || [];
      merged.teams   = Object.assign({}, (lastState && lastState.teams) || {}, delta.teams || {});
    }
    renderState(merged);
  }

  function renderTeam($grid, $count, players, theme){
    if (!$grid) return;
    $grid.innerHTML = "";
    if (!Array.isArray(players)) players = [];

    if ($count) $count.textContent = `${players.length}명`;

    players.forEach(p => {
      const card = el("div","card " + (theme === "phoenix" ? "phoenix":"eaters"));

      // Avatar
      const av = el("div","avatar");
      const initials = (p.name || "플레이어").trim().substring(0,2);
      av.textContent = initials || "플";
      if (p.avatar && typeof p.avatar === "string") {
        av.style.background = `center/cover no-repeat url("${p.avatar}")`;
        av.style.border = "1px solid rgba(220,199,162,0.35)";
      }

      // Info
      const info = el("div","info");
      const name = el("div","name");
      name.textContent = p.name || "플레이어";

      const meta = el("div","meta");
      const maxHp = numberOr(p.maxHp, numberOr(p.stats?.maxHp, 100));
      const hpNow = clamp(numberOr(p.hp, numberOr(p.stats?.hp, maxHp)), 0, maxHp);
      const status = (p.status || (p.alive === false ? "down" : "ok"));
      meta.textContent = `HP ${hpNow}/${maxHp} • 상태 ${status}`;

      // HP bar
      const hp = el("div","hpbar"); const bar = el("i");
      bar.style.width = `${(hpNow / (maxHp || 1)) * 100}%`;
      if (hpNow <= maxHp * 0.3) bar.style.background = `linear-gradient(90deg, #f87272, #dc5b5b, #b53e3e)`;
      hp.appendChild(bar);

      // Items (관리자 지정 반영)
      const itemsWrap = el("div","items");
      const items = Array.isArray(p.items) ? p.items
                   : (Array.isArray(p.inventory) ? p.inventory
                   : (typeof p.item === "string" ? [p.item] : []));
      items.slice(0,5).forEach(it => {
        const tag = el("span","item");
        tag.textContent = String(it);
        itemsWrap.appendChild(tag);
      });

      info.appendChild(name);
      info.appendChild(meta);
      info.appendChild(hp);
      if (items.length) info.appendChild(itemsWrap);

      card.appendChild(av);
      card.appendChild(info);
      $grid.appendChild(card);
    });
  }

  function pickTeamArray(state, primaryKey, altKey){
    if (!state) return [];
    if (Array.isArray(state.players) && !state.teams) {
      // players에 team 필드가 있는 타입: 분리
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
  function numberOr(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  /* ================= Cheer ================= */
  function buildCheerButtons(){
    if (!$cheer) return;
    if ($cheer.children.length > 0) { bindCheerHandler(); return; }

    const frag = document.createDocumentFragment();
    FIXED_CHEERS.forEach(msg => {
      const b = el("button","btn");
      b.type = "button";
      b.setAttribute("data-msg", msg);
      b.textContent = msg;
      frag.appendChild(b);
    });
    $cheer.appendChild(frag);
    bindCheerHandler();
  }

  function bindCheerHandler(){
    $cheer.addEventListener("click", async (e) => {
      const btn = e.target.closest("button.btn");
      if (!btn) return;
      const msg = btn.getAttribute("data-msg") || "";

      // Local feedback
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "전송됨";
      setTimeout(() => { btn.disabled = false; btn.textContent = prev; }, 900);

      // Try send to server (optional)
      try {
        await fetchJSON(`/api/battles/${encodeURIComponent(battleCode)}/cheer`, {
          method:"POST",
          body: JSON.stringify({ msg, role:"spectator" })
        });
      } catch(e) { /* endpoint 없으면 무시 */ }
      addLog("응원", msg);
    });
  }

  /* ================= Expose (debug) ================= */
  window.__PYXIS_SPECTATOR__ = {
    fetchState, renderState
  };
})();
