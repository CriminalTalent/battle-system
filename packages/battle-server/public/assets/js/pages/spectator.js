(() => {
  const qs = new URLSearchParams(location.search);
  const battleCode = qs.get("battle") || "";
  const otp = qs.get("otp") || "";

  // DOM refs
  const $leftGrid = byId("leftGrid");
  const $rightGrid = byId("rightGrid");
  const $leftCount = byId("leftCount");
  const $rightCount = byId("rightCount");
  const $turnPill = byId("turnPill");
  const $log = byId("battleLog");
  const $cheer = byId("cheerButtons");

  // State
  let socket = null;
  let lastState = null;
  let pollTimer = null;

  // Guard
  if (!battleCode) {
    addLog("시스템", "관전자 URL의 battle 파라미터가 없습니다.");
  }

  // Init
  setupCheerButtons();
  connectSocket().catch(() => {
    startPolling();
  });
  // First load
  fetchState().catch(() => {});

  // Utilities
  function byId(id){ return document.getElementById(id); }
  function el(tag, cls){ const n = document.createElement(tag); if(cls) n.className = cls; return n; }

  function addLog(timeOrSource, text){
    const row = el("div","log-item");
    const t = el("span","log-time");
    const x = el("div","log-text");
    const now = typeof timeOrSource === "string" ? new Date() : new Date();
    t.textContent = formatTime(now);
    x.textContent = `[${typeof timeOrSource === "string" ? timeOrSource : "알림"}] ${text}`;
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
    const headers = Object.assign(
      { "Content-Type":"application/json" },
      otp ? { "x-otp": otp } : {}
    );
    const res = await fetch(url, Object.assign({ headers }, opts));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchState(){
    if (!battleCode) return;
    const data = await fetchJSON(`/api/battles/${battleCode}/state`, { method:"GET" });
    renderState(data);
    return data;
  }

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      fetchState().catch(()=>{});
    }, 2000);
  }

  async function connectSocket(){
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Use socket.io if available
    if (typeof io !== "function") throw new Error("socket.io not found");

    socket = io("/", {
      transports: ["websocket","polling"],
      auth: { role:"spectator", battleCode, otp },
      timeout: 7000
    });

    socket.on("connect", () => {
      addLog("시스템", "실시간 연결됨");
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      // join room if server expects explicit join
      try { socket.emit("spectator:join", { battleCode, otp }); } catch(e){}
    });

    socket.on("disconnect", (reason) => {
      addLog("시스템", `연결 해제됨: ${reason}`);
      startPolling();
    });

    // Server side event names may vary; we handle a few common ones
    socket.on("battle:update", (payload) => {
      renderState(payload);
    });
    socket.on("battle:log", (entry) => {
      if (entry && entry.text) addLog("전투", entry.text);
    });

    // Fallback resolve even if server ignores
    return true;
  }

  function renderState(state){
    if (!state) return;

    // Cache and shallow equal guard to reduce reflows
    lastState = state;

    // Teams
    const left = (state.teams && (state.teams.phoenix || state.teams.left)) || [];
    const right = (state.teams && (state.teams.eaters || state.teams.right)) || [];

    renderTeam($leftGrid, $leftCount, left, "phoenix");
    renderTeam($rightGrid, $rightCount, right, "eaters");

    // Turn label
    let pillText = "대기중";
    if (state.phase === "running") {
      const side = state.turn && state.turn.team ? state.turn.team : "";
      if (side === "phoenix" || side === "left") pillText = "불사조 팀의 턴";
      else if (side === "eaters" || side === "right") pillText = "죽음을 먹는 자 팀의 턴";
      else pillText = "진행중";
    } else if (state.phase === "finished") {
      pillText = "전투 종료";
    }
    $turnPill.textContent = pillText;

    // Optional center avatar based on state icon or emblem
    const $hero = byId("arenaHero");
    if (state.arenaAvatar && typeof state.arenaAvatar === "string") {
      $hero.style.background = `center/cover no-repeat url("${state.arenaAvatar}")`;
      $hero.style.border = "1px solid rgba(220,199,162,0.35)";
      $hero.style.boxShadow = "0 12px 32px rgba(0,0,0,0.35), inset 0 0 24px rgba(212,186,141,0.12)";
    }
  }

  function renderTeam($grid, $count, players, theme){
    $grid.innerHTML = "";
    if (!Array.isArray(players)) players = [];

    $count.textContent = `${players.length}명`;

    players.forEach(p => {
      const card = el("div","card " + (theme === "phoenix" ? "phoenix":"eaters"));
      const av = el("div","avatar");
      const initials = (p.name || "플레이어").substring(0,2);
      av.textContent = initials;
      if (p.avatar && typeof p.avatar === "string") {
        av.style.background = `center/cover no-repeat url("${p.avatar}")`;
        av.style.border = "1px solid rgba(220,199,162,0.35)";
      }

      const info = el("div","info");
      const name = el("div","name");
      name.textContent = p.name || "플레이어";
      const meta = el("div","meta");
      const hpTxt = typeof p.hp === "number" ? p.hp : (p.stats && p.stats.hp);
      const status = p.status || (p.alive === false ? "down" : "ok");
      meta.textContent = `HP ${hpTxt ?? "?"} • 상태 ${status}`;

      const hp = el("div","hpbar"); const bar = el("i");
      const maxHp = (p.maxHp || 100);
      const curHp = Math.max(0, Math.min(maxHp, Number(hpTxt ?? maxHp)));
      bar.style.width = `${(curHp / maxHp) * 100}%`;
      if (curHp <= maxHp * 0.3) bar.style.background = `linear-gradient(90deg, #f87272, #dc5b5b, #b53e3e)`;
      hp.appendChild(bar);

      info.appendChild(name);
      info.appendChild(meta);
      info.appendChild(hp);

      card.appendChild(av);
      card.appendChild(info);
      $grid.appendChild(card);
    });
  }

  function setupCheerButtons(){
    if (!$cheer) return;
    $cheer.addEventListener("click", async (e) => {
      const btn = e.target.closest("button.btn");
      if (!btn) return;
      const msg = btn.getAttribute("data-msg") || "";

      // Local feedback
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "전송됨";
      setTimeout(() => { btn.disabled = false; btn.textContent = prev; }, 900);

      // Try send to server (optional endpoint)
      try {
        await fetchJSON(`/api/battles/${battleCode}/cheer`, {
          method:"POST",
          body: JSON.stringify({ msg, role:"spectator" })
        });
      } catch(e) {
        // If endpoint absent, just log locally
      }
      addLog("응원", msg);
    });
  }

  // Expose for debug
  window.__PYXIS_SPECTATOR__ = {
    fetchState, renderState
  };
})();
