// player.js — PYXIS 전투 참가자 클라이언트
(() => {
  /* ============ 유틸 ============ */
  const $ = (s) => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const battleId = qs.get("battle") || "";
  const myName   = qs.get("name") || "";
  const token    = qs.get("password") || qs.get("token") || qs.get("otp") || "";
  const myTeamQS = (qs.get("team") || "A").toUpperCase() === "B" ? "B" : "A";

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
  // 스탯 폴백
  const getStat = (obj, ...keys) => {
    for (const k of keys) if (obj && obj[k] != null) return obj[k];
    return "-";
  };

  /* ============ 상태 ============ */
  let socket = null;
  let me = null;          // 내 player 오브젝트
  let snap = null;        // battle 스냅샷

  /* ============ 엘리먼트 ============ */
  // 내 카드
  const meAvatar = $("#meAvatar");
  const meNameEl = $("#meName");
  const meTeamEl = $("#meTeam");
  const meHpText = $("#meHpText");
  const meHpBar  = $("#meHpBar");
  const sAtk = $("#sAtk"), sDef = $("#sDef"), sAgi = $("#sAgi"), sLuk = $("#sLuk");
  const iDit = $("#iDit"), iAtkB = $("#iAtkB"), iDefB = $("#iDefB");
  const btnReady = $("#btnReady");

  // 중앙
  const turnPortrait = $("#turnPortrait");
  const roundEl = $("#round");
  const turnTeamEl = $("#turnTeam");
  const turnTimer = $("#turnTimer");

  // 팀 리스트
  const allyList = $("#allyList");
  const enemyList = $("#enemyList");

  // 로그/채팅
  const logEl = $("#log");
  const chatView = $("#chatView");
  const chatMsg = $("#chatMsg");
  const btnSend = $("#btnSend");

  // 액션
  const btnAttack = $("#btnAttack");
  const btnDefend = $("#btnDefend");
  const btnDodge  = $("#btnDodge");
  const btnItem   = $("#btnItem");
  const btnPass   = $("#btnPass");

  /* ============ 렌더 ============ */
  function addLog(msg, type="sys") {
    if (!logEl) return;
    const t = new Date().toLocaleTimeString("ko-KR", {hour12:false,hour:"2-digit",minute:"2-digit"});
    const div = document.createElement("div");
    div.className = "entry "+type;
    div.innerHTML = `<span class="t">${t}</span>${escapeHtml(msg)}`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 300) logEl.removeChild(logEl.firstChild);
  }
  function addChat(name, msg) {
    if (!chatView) return;
    const t = new Date().toLocaleTimeString("ko-KR", {hour12:false,hour:"2-digit",minute:"2-digit"});
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = `<span class="t">${t}</span><b>${escapeHtml(name||"익명")}</b>: ${escapeHtml(msg||"")}`;
    chatView.appendChild(div);
    chatView.scrollTop = chatView.scrollHeight;
    while (chatView.children.length > 300) chatView.removeChild(chatView.firstChild);
  }

  function renderMe() {
    if (!me) return;
    meNameEl && (meNameEl.textContent = me.name || "-");
    meTeamEl && (meTeamEl.textContent = (me.team||"A") + "팀");

    const cur = +me.hp || 0, mx = +me.maxHp || 100;
    meHpText && (meHpText.textContent = `HP ${cur}/${mx}`);
    if (meHpBar) meHpBar.style.width = Math.max(0, Math.min(100, Math.round(cur/mx*100))) + "%";

    // 스탯 폴백
    const st = me.stats || {};
    sAtk && (sAtk.textContent = getStat(st, "attack","atk","ATTACK"));
    sDef && (sDef.textContent = getStat(st, "defense","def","DEFENSE"));
    sAgi && (sAgi.textContent = getStat(st, "agility","agi","AGILITY"));
    sLuk && (sLuk.textContent = getStat(st, "luck","luk","LUCK"));

    // 아이템 폴백
    const it = me.items || {};
    iDit  && (iDit.textContent  = it.dittany ?? it.ditany ?? 0);
    iAtkB && (iAtkB.textContent = it.attack_boost ?? it.attackBooster ?? 0);
    iDefB && (iDefB.textContent = it.defense_boost ?? it.defenseBooster ?? 0);

    // 아바타
    setImg(meAvatar, me.avatar);
  }

  function mkMiniRow(p) {
    const cur = +p.hp || 0, mx = +p.maxHp || 100;
    // 스탯 축약
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
    const img = row.querySelector("img");
    setImg(img, p.avatar);
    return row;
  }

  function renderTeams() {
    if (!snap) return;
    if (allyList) allyList.innerHTML = "";
    if (enemyList) enemyList.innerHTML = "";
    const A = [], B = [];
    (snap.players||[]).forEach(p => (p.team === "B" ? B : A).push(p));
    const myAlly = myTeamQS === "B" ? B : A;
    const enemy  = myTeamQS === "B" ? A : B;
    myAlly.forEach(p => allyList && allyList.appendChild(mkMiniRow(p)));
    enemy.forEach(p  => enemyList && enemyList.appendChild(mkMiniRow(p)));
  }

  function renderTurn() {
    if (!snap) return;
    roundEl && (roundEl.textContent = snap.currentTurn?.turnNumber || snap.turn?.round || 1);
    turnTeamEl && (turnTeamEl.textContent = (snap.currentTurn?.currentTeam || snap.currentTeam || "-") + "팀");
    turnTimer && (turnTimer.textContent = fmtTime(snap.timeLeft ?? 0));

    const cur = snap.currentTurn?.currentPlayer || null;
    const curP = cur?.avatar ? cur : (snap.players||[]).find(p=>p.id===cur?.id);
    setImg(turnPortrait, curP?.avatar || (curP && curP.avatar));

    // 액션 버튼 활성/비활성
    const myTurn = !!(me && snap.currentTurn && snap.currentTurn.currentTeam === me.team);
    const acted = !!(snap?.currentTurn?.playerActions && snap.currentTurn.playerActions[me?.id]);
    const enable = myTurn && !acted && snap.status === "active";
    [btnAttack, btnDefend, btnDodge, btnItem, btnPass].forEach(b => b && (b.disabled = !enable));
  }

  /* ============ 소켓 ============ */
  function bindSocket() {
    socket = io();

    socket.on("connect", () => {
      addLog("서버 연결됨", "sys");
      if (!battleId) { addLog("battle 파라미터가 없습니다.", "sys"); return; }

      // 플레이어 인증
      socket.emit("playerAuth", {
        battleId, token, password: token, otp: token, playerName: myName
      }, (res) => {
        if (!res?.ok) { addLog("인증 실패: " + (res?.message || res?.error || "오류"), "sys"); return; }
        me = res.playerData || null;
        snap = res.battle || null;
        addLog("인증 성공 · 전투 참가 완료", "sys");
        renderMe(); renderTeams(); renderTurn();
      });
    });

    const onUpdate = (b) => {
      snap = b;
      if (me && snap) {
        me = (snap.players||[]).find(p => p.id === me.id) || me;
      }
      renderMe(); renderTeams(); renderTurn();
    };
    socket.on("battleUpdate", onUpdate);
    socket.on("battle:update", onUpdate);

    const onLog = (ev) => addLog(ev?.message || "로그", ev?.type === "rule" ? "hit" : "sys");
    socket.on("battleLog", onLog);
    socket.on("battle:log", onLog);

    // 채팅 수신(응원 포함)
    socket.on("chatMessage", (d) => addChat(d?.name||"익명", d?.message||""));
    socket.on("battle:chat",  (d) => addChat(d?.name||d?.senderName||"익명", d?.message||""));
    socket.on("cheerMessage", (d) => addChat(d?.name||"관전자", d?.message||""));
    socket.on("spectator:cheer", (d) => addChat(d?.name||"관전자", d?.message||""));
  }

  /* ============ 인터랙션 ============ */
  // 채팅
  btnSend && btnSend.addEventListener("click", () => {
    const m = (chatMsg.value||"").trim();
    if (!m || !socket || !battleId) return;
    socket.emit("chatMessage", { battleId, name: myName || "전투 참가자", message: m });
chatMsg.value = "";
  });
  chatMsg && chatMsg.addEventListener("keydown", (e)=>{ if(e.key==="Enter") btnSend.click(); });

  // 준비
  btnReady && btnReady.addEventListener("click", () => {
    if (!socket || !battleId || !me?.id) return;
    btnReady.disabled = true;
    btnReady.textContent = "준비 완료됨";
    btnReady.style.background = "#111"; btnReady.style.color="#555";
    addLog("내 상태: 준비 완료", "sys");
    socket.emit("player:ready", { battleId, playerId: me.id, ready:true });
  });

  // 액션(타깃 선택 UI가 없을 수 있어, 우선 전송만)
  function sendAction(type, targetId=null) {
    if (!socket || !battleId || !me?.id) return;
    const action = targetId ? { type, targetId } : { type };
});
    socket.emit("player:action", { battleId, playerId: me.id, action }); // 호환
  }
  btnAttack && btnAttack.addEventListener("click", ()=> sendAction("attack"));
  btnDefend && btnDefend.addEventListener("click", ()=> sendAction("defend"));
  btnDodge  && btnDodge .addEventListener("click", ()=> sendAction("dodge"));
  btnItem   && btnItem  .addEventListener("click", ()=> sendAction("item"));
  btnPass   && btnPass  .addEventListener("click", ()=> sendAction("pass"));

  document.addEventListener("DOMContentLoaded", bindSocket);
})();
