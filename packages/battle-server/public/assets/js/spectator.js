// spectator.js — PYXIS 관전자 클라이언트
(() => {
  /* ============ 유틸 ============ */
  const $ = (s) => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const battleId = qs.get("battle") || "";
  const urlOtp   = qs.get("otp") || qs.get("token") || qs.get("password") || qs.get("pwd") || qs.get("auth") || "";
  const urlName  = qs.get("name") || "";

  const DEFAULT_AVATAR =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
        <rect width="100%" height="100%" fill="#0b0b0b"/>
        <circle cx="80" cy="58" r="30" fill="#2b2b2b"/>
        <rect x="35" y="100" width="90" height="45" rx="12" fill="#2b2b2b"/>
      </svg>`
    );
  function setImg(el, url) {
    if (!el) return;
    el.onerror = null;
    el.src = url || DEFAULT_AVATAR;
    el.onerror = () => { el.onerror = null; el.src = DEFAULT_AVATAR; };
  }
  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function fmtTime(sec) {
    const s = Math.max(0, +sec|0);
    const m = (s/60)|0, r = s%60;
    return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
  }
  const getStat = (obj, ...keys) => {
    for (const k of keys) if (obj && obj[k] != null) return obj[k];
    return "-";
  };

  /* ============ 상태/DOM ============ */
  let socket = null;
  let snap = null;
  let spectatorName = "";

  const overlay = $("#overlay");
  const nameInput = $("#nameInput");
  const pwdInput  = $("#passwordInput");
  const authBtn   = $("#authBtn");
  const layout    = $("#layout");

  const teamAList = $("#teamAList");
  const teamBList = $("#teamBList");

  const roundEl   = $("#round");
  const turnTeamEl= $("#turnTeam");
  const turnTimer = $("#turnTimer");
  const curPortrait = $("#curPortrait");

  const battleLog = $("#battleLog");
  const chatView  = $("#chatView");

  /* ============ 렌더 ============ */
  function addLog(msg, type="sys") {
    if (!battleLog) return;
    const t = new Date().toLocaleTimeString("ko-KR", {hour12:false,hour:"2-digit",minute:"2-digit"});
    const div = document.createElement("div");
    div.className = "entry "+type;
    div.innerHTML = `<span class="t">${t}</span>${escapeHtml(msg)}`;
    battleLog.appendChild(div);
    battleLog.scrollTop = battleLog.scrollHeight;
    while (battleLog.children.length > 500) battleLog.removeChild(battleLog.firstChild);
  }
  function addChat(name, msg) {
    if (!chatView) return;
    const t = new Date().toLocaleTimeString("ko-KR", {hour12:false,hour:"2-digit",minute:"2-digit"});
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = `<span class="t">${t}</span><b>${escapeHtml(name||"익명")}</b>: ${escapeHtml(msg||"")}`;
    chatView.appendChild(div);
    chatView.scrollTop = chatView.scrollHeight;
    while (chatView.children.length > 500) chatView.removeChild(chatView.firstChild);
  }

  function mkRow(p) {
    const cur = +p.hp || 0, mx = +p.maxHp || 100;
    const st = p.stats || {};
    const atk = getStat(st, "attack","atk");
    const def = getStat(st, "defense","def");
    const agi = getStat(st, "agility","agi");
    const luk = getStat(st, "luck","luk");

    const row = document.createElement("div");
    row.className = "mini";
    row.innerHTML = `
      <img alt="${escapeHtml(p.name||'초상화')}"/>
      <div>
        <div class="nm">${escapeHtml(p.name||"-")}</div>
        <div class="hp">HP ${cur}/${mx}</div>
        <div class="hp" style="margin-top:2px">공${atk} 방${def} 민${agi} 행${luk}</div>
      </div>
    `;
    setImg(row.querySelector("img"), p.avatar);
    return row;
  }

  function renderTeams() {
    if (!snap) return;
    teamAList && (teamAList.innerHTML = "");
    teamBList && (teamBList.innerHTML = "");
    (snap.players||[]).forEach(p => {
      (p.team==="B" ? teamBList : teamAList).appendChild(mkRow(p));
    });
  }
  function renderTurn() {
    if (!snap) return;
    roundEl   && (roundEl.textContent    = snap.currentTurn?.turnNumber || snap.turn?.round || 1);
    turnTeamEl&& (turnTeamEl.textContent = (snap.currentTurn?.currentTeam || snap.currentTeam || "-") + "팀");
    turnTimer && (turnTimer.textContent  = fmtTime(snap.timeLeft ?? 0));

    const cur = snap.currentTurn?.currentPlayer || null;
    const curP = cur?.avatar ? cur : (snap.players||[]).find(p=>p.id===cur?.id);
    setImg(curPortrait, curP?.avatar);
  }

  /* ============ 소켓 ============ */
  function bindSocket() {
    socket = io();

    socket.on("connect", () => {
      addLog("서버 연결됨","sys");
      if (!battleId) { addLog("battle 파라미터가 없습니다.","sys"); return; }
      // 관전은 join만
      socket.emit("join", { battleId });
    });

    const onUpdate = (b) => { snap = b; renderTeams(); renderTurn(); };
    socket.on("battleUpdate", onUpdate);
    socket.on("battle:update", onUpdate);

    const onLog = (ev) => addLog(ev?.message || "로그", ev?.type === "rule" ? "hit" : "sys");
    socket.on("battleLog", onLog);
    socket.on("battle:log", onLog);

    // 채팅/응원 수신(응원은 채팅으로만)
    socket.on("chatMessage", (d)=> addChat(d?.name||"익명", d?.message||""));
    socket.on("battle:chat",  (d)=> addChat(d?.name||d?.senderName||"익명", d?.message||""));
    socket.on("cheerMessage", (d)=> addChat(d?.name||"관전자", d?.message||""));
    socket.on("spectator:cheer", (d)=> addChat(d?.name||"관전자", d?.message||""));
  }

  /* ============ 인증/응원 인터랙션 ============ */
  function validateAuth() {
    const hasName = !!(nameInput.value||"").trim();
    const hasPwd  = !!(pwdInput.value||"").trim() || !!urlOtp;
    authBtn && (authBtn.disabled = !(hasName && hasPwd));
  }
  nameInput && nameInput.addEventListener("input", validateAuth);
  pwdInput  && pwdInput.addEventListener("input", validateAuth);

  // URL 자동 채움
  if (urlOtp && pwdInput) pwdInput.value = urlOtp;
  if (urlName && nameInput) nameInput.value = urlName;
  validateAuth();

  authBtn && authBtn.addEventListener("click", () => {
    spectatorName = (nameInput.value || "").trim();
    if (!spectatorName) return;
    overlay && (overlay.style.display = "none");
    layout  && (layout.style.display = "grid");
    addLog(`관전자 입장: ${spectatorName}`, "sys");
    bindSocket();
  });

  // 응원 버튼(한 번만 emit — 중복 방지)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".cheer");
    if (!btn) return;
    if (!socket || !battleId) return;
    if (!spectatorName) { addLog("이름이 필요합니다.","sys"); return; }
    const msg = btn.getAttribute("data-msg") || btn.textContent || "";
    const text = `[응원] ${msg}`;
    socket.emit("spectator:cheer", { battleId, name: spectatorName, message: text });
    addChat(spectatorName, text); // 로컬 에코
  });
})();
