/* packages/battle-server/public/assets/js/player.js
   - 아바타 URL 강제 보정(onerror 기본 이미지 대체, 캐시버스트)
   - 로그 수신/렌더 보강(battle:update, battle:log, battle:started/paused/resumed/ended)
   - 중앙 턴 아바타/이름 갱신 로직 보강
   - UI 콤팩트 버튼/HP/아이템 그대로 유지
*/
(function () {
  "use strict";

  const pick = (id) => document.getElementById(id);
  const $ = (sel, r = document) => r.querySelector(sel);
  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
  const MAX_LOG = 200, MAX_CHAT = 200;

  const el = {
    // Views
    viewAuth: pick("authView"), viewMain: pick("mainView"),
    // Auth
    authBattle: pick("battleId"), authName: pick("playerName"), authToken: pick("authToken"), btnAuth: pick("btnAuth"),
    // Me
    myAvatar: pick("myAvatar"), myName: pick("myName"), myTeam: pick("myTeam"),
    statATK: pick("statATK"), statDEF: pick("statDEF"), statAGI: pick("statAGI"), statLUK: pick("statLUK"),
    myHpBar: pick("myHpBar"), myHpText: pick("myHpText"),
    itemDittany: pick("itemDittany"), itemAttack: pick("itemAttack"), itemDefense: pick("itemDefense"),
    // Center
    turnAvatar: pick("turnAvatar"), turnName: pick("turnName"), turnTimer: pick("turnTimer"),
    // Lists / Log / Chat
    teammateList: pick("teammateList"), battleLog: pick("battleLog"),
    chatMessages: pick("chatMessages"), chatInput: pick("chatInput"), btnChat: pick("btnChat"),
    // Actions
    btnReady: pick("btnReady"), btnAttack: pick("btnAttack"), btnDefend: pick("btnDefend"),
    btnDodge: pick("btnDodge"), btnPass: pick("btnPass"),
    btnItemDittany: pick("btnItemDittany"), btnItemAttack: pick("btnItemAttack"), btnItemDefense: pick("btnItemDefense")
  };

  const state = {
    socket: null, battleId: null, playerId: null,
    status: "waiting", current: null, players: [], log: [],
    turnEndsAt: 0, turnTimerId: 0
  };

  document.addEventListener("DOMContentLoaded", () => {
    connect(); bindUI(); autoFillFromURL();
  });

  // ---- Socket ----
  function connect() {
    if (!window.io) { alert("Socket.IO가 로드되지 않았습니다."); return; }
    // 현재 오리진 사용(고정 URL 제거)  ← 기존 고정값으로 인한 이벤트 누락 방지 :contentReference[oaicite:6]{index=6}
    const s = window.io(undefined, { transports: ["websocket", "polling"], withCredentials: true });
    state.socket = s;

    s.on("connect", () => {});
    s.on("disconnect", () => {});

    s.on("authError", (e) => alert("인증 실패: " + (e?.error || "")));

    s.on("auth:success", (payload) => {
      if ((payload.role || "player") !== "player") return;
      state.battleId = payload.battleId || payload.battle?.id || null;
      state.playerId = payload.playerId || payload.player?.id || null;
      showMain();
      if (state.battleId) s.emit("join", { battleId: state.battleId });
      if (payload.battle) { applyBattle(payload.battle); renderAll(); }
    });

    // 전체 스냅샷
    s.on("battle:update", (b) => { applyBattle(b); renderAll(); });

    // 단일 로그
    s.on("battle:log", (line) => { if (!line) return; appendLog(line.type || "system", line.message || ""); });

    // 상태 전환 로그(서버가 보낼 경우 표시)  :contentReference[oaicite:7]{index=7}
    ["battle:started","battle:paused","battle:resumed","battle:ended"].forEach(evt=>{
      s.on(evt, (b)=>{ appendLog("system", statusLine(evt, b)); });
    });

    // 채팅
    s.on("battle:chat", ({ name, message }) => appendChat(name, message));
  }

  function statusLine(evt, b){
    switch(evt){
      case "battle:started": return "전투 시작";
      case "battle:paused":  return "전투 일시정지";
      case "battle:resumed": return "전투 재개";
      case "battle:ended":   return "전투 종료";
      default: return "";
    }
  }

  // ---- Apply / Render ----
  function applyBattle(b) {
    if (!b) return;
    state.status = b.status || "waiting";
    state.current = b.currentTeam || b.currentPlayer || b.current || null;
    state.players = Array.isArray(b.players) ? b.players.slice() : [];
    state.log = Array.isArray(b.log) ? b.log.slice(-MAX_LOG) : state.log;
  }

  function renderAll() {
    renderMe(); renderTurn(); renderTeammates(); renderLog(); updateEnables();
  }

  function renderMe() {
    const me = getMe(); if (!me) return;
    if (el.myName) el.myName.textContent = me.name || "전투 참가자";
    if (el.myTeam) {
      const isA = (me.team === "phoenix"); el.myTeam.textContent = isA ? "A팀" : "B팀";
      el.myTeam.className = "team-badge " + (isA ? "team-phoenix" : "team-death");
    }
    setAvatar(el.myAvatar, me.avatar);
    const s = me.stats || {};
    if (el.statATK) el.statATK.textContent = s.attack ?? 3;
    if (el.statDEF) el.statDEF.textContent = s.defense ?? 3;
    if (el.statAGI) el.statAGI.textContent = s.agility ?? 3;
    if (el.statLUK) el.statLUK.textContent = s.luck ?? 3;
    const hp = Math.max(0, me.hp|0), maxHp = Math.max(1, me.maxHp|0) || 100;
    if (el.myHpBar) el.myHpBar.style.width = Math.max(0, Math.min(100, (hp/maxHp)*100)) + "%";
    if (el.myHpText) el.myHpText.textContent = `${hp} / ${maxHp}`;
    const items = me.items || {};
    if (el.itemDittany) el.itemDittany.textContent = items.dittany ?? 0;
    if (el.itemAttack)  el.itemAttack.textContent  = items.attack_booster ?? 0;
    if (el.itemDefense) el.itemDefense.textContent = items.defense_booster ?? 0;
  }

  function renderTurn() {
    const cur = currentTurnPlayer();
    if (el.turnName) el.turnName.textContent = cur ? (cur.name || "진행 중") : "대기 중";
    setAvatar(el.turnAvatar, cur?.avatar);
    // 남은 시간 표시는 서버 쪽 turnTimer 이벤트가 들어오면 갱신(현 서버는 5분 타임아웃 구조) :contentReference[oaicite:8]{index=8}
  }

  function renderTeammates() {
    if (!el.teammateList) return;
    const me = getMe(); const list = (state.players||[]).filter(p=>p.id!==state.playerId && p.team===me?.team);
    el.teammateList.innerHTML = "";
    if (!list.length) { el.teammateList.innerHTML = `<div class="teammate-item">팀원이 없습니다</div>`; return; }
    list.forEach(p=>{
      const row = document.createElement("div");
      row.className = "teammate-item";
      row.innerHTML = `
        <img class="teammate-avatar" src="${safeAvatar(p.avatar)}" onerror="this.src='${DEFAULT_AVATAR}'" alt="${esc(p.name)}">
        <div style="flex:1">
          <div class="teammate-name">${esc(p.name)} <span style="color:var(--text-muted);font-weight:600">(${p.team==='phoenix'?'A팀':'B팀'})</span></div>
          <div class="teammate-hp">HP ${Math.max(0,p.hp|0)} / ${Math.max(1,p.maxHp|0)}</div>
        </div>`;
      el.teammateList.appendChild(row);
    });
  }

  function renderLog() {
    if (!el.battleLog) return;
    el.battleLog.innerHTML = "";
    (state.log||[]).forEach(line=>{
      const d = document.createElement("div");
      d.className = "log-entry " + (line.type || "system");
      d.textContent = cleanLog(line.message || "");
      el.battleLog.appendChild(d);
    });
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function updateEnables() {
    const can = canAct();
    ["btnAttack","btnDefend","btnDodge","btnPass","btnItemDittany","btnItemAttack","btnItemDefense"].forEach(k=>{
      if (el[k]) el[k].disabled = !can;
    });
  }

  // ---- Actions / Chat ----
  el.btnAuth && el.btnAuth.addEventListener("click", onAuth);
  el.btnReady && el.btnReady.addEventListener("click", ()=> {
    if (!state.socket || !state.battleId || !state.playerId) return alert("인증이 필요합니다.");
    state.socket.emit("player:ready", { battleId: state.battleId, playerId: state.playerId });
  });
  el.btnAttack && el.btnAttack.addEventListener("click", ()=> trySend("attack", pickEnemy()?.id));
  el.btnDefend && el.btnDefend.addEventListener("click", ()=> trySend("defend"));
  el.btnDodge  && el.btnDodge .addEventListener("click", ()=> trySend("dodge"));
  el.btnPass   && el.btnPass  .addEventListener("click", ()=> trySend("pass"));
  el.btnItemDittany && el.btnItemDittany.addEventListener("click", ()=> trySend("item", state.playerId, {itemType:"dittany"}));
  el.btnItemAttack  && el.btnItemAttack .addEventListener("click", ()=> trySend("item", null, {itemType:"attack_booster"}));
  el.btnItemDefense && el.btnItemDefense.addEventListener("click", ()=> trySend("item", null, {itemType:"defense_booster"}));

  el.btnChat && el.btnChat.addEventListener("click", sendChat);
  el.chatInput && el.chatInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });

  function onAuth(){
    const battleId = (el.authBattle?.value||"").trim();
    const name = (el.authName?.value||"").trim();
    const token = (el.authToken?.value||"").trim();
    if (!battleId || !name || !token) return alert("전투 ID, 이름, 비밀번호를 모두 입력하세요.");
    state.socket.emit("playerAuth", { battleId, name, token });
  }

  function trySend(type, targetId=null, extra={}){
    if (!canAct()) { alert("지금은 행동할 수 없습니다."); return; }
    state.socket.emit("player:action", {
      battleId: state.battleId, playerId: state.playerId, action: { type, targetId, ...extra }
    });
  }

  function sendChat(){
    const msg = (el.chatInput?.value||"").trim(); if (!msg) return;
    state.socket.emit("chat:send", { battleId: state.battleId, name: getMe()?.name || "", message: msg });
    el.chatInput.value = "";
  }

  // ---- Helpers ----
  function showMain(){ el.viewAuth?.classList.add("hidden"); el.viewMain?.classList.remove("hidden"); }

  function autoFillFromURL(){
    const q = new URLSearchParams(location.search);
    const b=q.get("battle"), n=q.get("name"), t=q.get("token");
    if (b&&el.authBattle) el.authBattle.value=b;
    if (n&&el.authName)   el.authName.value=n;
    if (t&&el.authToken)  el.authToken.value=t;
    if (b&&n&&t) onAuth();
  }

  function getMe(){ return (state.players||[]).find(p=>p.id===state.playerId) || null; }
  function enemies(){ const me=getMe(); return (state.players||[]).filter(p=>p.team!==me?.team && (p.hp|0)>0); }
  function pickEnemy(){ return enemies()[0] || null; }
  function canAct(){
    const me=getMe(); if (state.status!=="active") return false;
    if (!me || (me.hp|0)<=0) return false;
    // 팀 턴제: 내 팀 차례인지 확인  :contentReference[oaicite:9]{index=9}
    return (state.current && (state.current===me.team || state.current===me.id));
  }

  function currentTurnPlayer(){
    // playerId 직접 주는 서버/ team만 주는 서버 모두 대응
    const cur = state.current;
    if (!cur) return null;
    const byId = (state.players||[]).find(p=>p.id===cur);
    if (byId) return byId;
    const team = String(cur).toLowerCase();
    const firstAlive = (state.players||[]).find(p=>String(p.team).toLowerCase()===team && (p.hp|0)>0);
    return firstAlive || null;
  }

  function setAvatar(imgEl, url){
    if (!imgEl) return;
    imgEl.onerror = ()=>{ imgEl.src = DEFAULT_AVATAR; };
    imgEl.src = safeAvatar(url);
  }

  function safeAvatar(url){
    if (!url) return DEFAULT_AVATAR;
    // 이미 http(s) 또는 / 로 시작하면 그대로, 아니면 /uploads/ 접두
    let u = String(url);
    if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) u = "/uploads/" + u.replace(/^\/+/, "");
    // 캐시버스트(업데이트 직후 안 뜨는 문제 방지)
    const sep = u.includes("?") ? "&" : "?";
    return u + sep + "v=" + Date.now();
  }

  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }

  // 로그 정리: A/B 팀 표기, 괄호 부가정보 제거(행운/주사위/치명타/민첩성 등)
  function cleanLog(raw){
    let msg = String(raw||"");
    msg = msg.replace(/\bphoenix\b/gi,"A팀").replace(/\b(eaters|death)\b/gi,"B팀");
    msg = msg.replace(/\s*\((?:행운|주사위|치명타|민첩성|명중)[^)]*\)/gi,"");
    msg = msg.replace(/\((?:phoenix|eaters)\s*팀\)/gi,"").replace(/\s{2,}/g," ").trim();
    return msg;
  }

  function appendLog(type, message){
    if (!el.battleLog) return;
    const d = document.createElement("div");
    d.className = "log-entry " + (type || "system");
    d.textContent = cleanLog(message||"");
    el.battleLog.appendChild(d);
    while (el.battleLog.children.length > MAX_LOG) el.battleLog.children[0]?.remove();
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }
})();
