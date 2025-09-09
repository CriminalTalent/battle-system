/* PYXIS Player Client (external JS)
   - 관리자/서버 규격에 맞춘 이벤트:
     emit:   player:auth, player:ready, player:action, chat:send, chatMessage
     on:     auth:success, auth:fail, battleUpdate, battle:chat, battle:log, turn:update
   - UI: packages/battle-server/public/pages/player.html 과 동일한 id 사용
   - 이 파일은 기존 player.js를 전면 교체한다 (이모지 금지)
*/
(() => {
  "use strict";

  // ====== DOM ======
  const $ = (s, r = document) => r.querySelector(s);

  // 인증 모달 / 메인
  const authModal = $("#authModal");
  const mainUI    = $("#mainUI");

  // 인증 입력
  const authBattle = $("#authBattle");
  const authOtp    = $("#authOtp");
  const authName   = $("#authName");
  const authMsg    = $("#authMsg");
  const btnJoin    = $("#btnJoin");

  // 내 정보
  const meAvatar = $("#meAvatar");
  const meName   = $("#meName");
  const meTeam   = $("#meTeam");
  const meHP     = $("#meHP");
  const hpFill   = $("#hpFill");
  const sATK     = $("#sATK");
  const sDEF     = $("#sDEF");
  const sAGI     = $("#sAGI");
  const sLUK     = $("#sLUK");

  // 준비/턴/상태
  const btnReady      = $("#btnReady");
  const readyPill     = $("#readyPill");
  const battleStatus  = $("#battleStatus");
  const turnPill      = $("#turnPill");
  const battlePortrait= $("#battlePortrait");

  // 아이템/목록/로그/채팅
  const itemsGrid  = $("#itemsGrid");
  const matesBox   = $("#mates");
  const enemiesBox = $("#enemies");
  const logBox     = $("#logBox");

  const chatMsgs   = $("#chatMsgs");
  const chatInput  = $("#chatInput");
  const chatSend   = $("#chatSend");

  // 타깃 지정
  const targetBox  = $("#targetBox");
  const btnConfirm = $("#btnConfirm");
  const btnCancel  = $("#btnCancel");

  // ====== 상태 ======
  const qs = new URLSearchParams(location.search);
  let battleId = qs.get("battle") || "";
  let me = null;                   // { id, name, team, stats, items, hp, ... }
  let players = [];                // 전체 플레이어
  let status = "waiting";          // waiting | live | ended
  let currentTurnPlayerId = null;  // playerId | teamKey

  let myTeamKey = "phoenix";       // 서버 표준키 정규화 보관
  let pendingAction = null;        // { type, targetId? }
  let selectedTargetId = null;

  // 아이템 라벨 및 서버 키 맵
  const ITEM_LABEL = { heal10:"디터니", atkBoost:"공격 보정기", defBoost:"방어 보정기" };
  const ITEM_TO_SERVER = { heal10:"dittany", atkBoost:"attackBoost", defBoost:"defenseBoost" };

  // ====== 소켓 ======
  // eslint-disable-next-line no-undef
  const socket = io();

  // 연결 상태
  socket.on("connect", () => { pushLog("system", "소켓 연결"); });
  socket.on("disconnect", () => { pushLog("system", "소켓 해제"); });

  // 인증 결과
  socket.on("auth:success", (data) => {
    hideAuth();
    me = data.player;
    players = Array.isArray(data.players) ? data.players : [];
    normalizeMe();
    renderAll(data.snapshot || { status:"waiting", players, log:[] });
    // 초기 동기화는 battleUpdate로도 곧 들어오므로 여기선 최소 렌더만
    pushLog("system", "입장 성공");
  });
  socket.on("auth:fail", (d) => {
    showAuthError(d?.reason || "인증 실패");
  });

  // 전투/턴 업데이트
  socket.on("battleUpdate", (b) => {
    status = b.status || status;
    players = Array.isArray(b.players) ? b.players : players;
    currentTurnPlayerId = b.turn?.current ?? currentTurnPlayerId;
    renderAll(b);
  });
  socket.on("turn:update", (d) => {
    currentTurnPlayerId = d?.currentPlayerId ?? currentTurnPlayerId;
    renderTurn();
  });

  // 채팅/로그 수신
  socket.on("battle:chat", ({ name, msg }) => pushChat(name, msg));
  socket.on("chatMessage", ({ sender, message }) => pushChat(sender, message));
  socket.on("battle:log", ({ msg, type }) => pushLog(type || "system", msg));
  socket.on("log:add", (d) => pushLog(d.type || "system", d.msg || ""));

  // ====== 인증 핸들러 ======
  if (battleId) authBattle.value = battleId;
  btnJoin?.addEventListener("click", tryJoin);
  function tryJoin(){
    const bid  = authBattle.value.trim();
    const otp  = authOtp.value.trim();
    const name = authName.value.trim();
    if (!bid || !otp || !name) {
      showAuthError("전투ID / 비밀번호 / 이름을 입력하세요.");
      return;
    }
    battleId = bid;
    socket.emit("player:auth", { battleId, otp, name });
  }

  socket.on("connect_error", (e) => showAuthError(e?.message || "네트워크 오류"));

  // 쿼리스트링 자동 인증 지원
  (function autoAuthFromQuery(){
    const qb = battleId;
    const qo = qs.get("otp") || "";
    const qn = qs.get("name") || "";
    if (qb) authBattle.value = qb;
    if (qo) authOtp.value = qo;
    if (qn) authName.value = qn;
    if (qb && qo && qn) socket.emit("player:auth", { battleId: qb, otp: qo, name: qn });
  })();

  // ====== 준비 ======
  btnReady?.addEventListener("click", () => {
    if (!battleId || !me) return;
    socket.emit("player:ready", { battleId, playerId: me.id });
    readyPill.textContent = "상태: 준비 완료";
    pushLog("system", `${me.name} 준비 완료`);
  });

  // ====== 기본 액션 버튼 ======
  document.querySelectorAll(".act").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!gateTurn()) return;
      const act = btn.dataset.act;
      if (act === "attack") {
        pendingAction = { type: "attack" };
        enterTargetSelect();
      } else if (act === "defend") {
        sendAction({ type: "defend" });
      } else if (act === "dodge") {
        sendAction({ type: "dodge" });
      } else if (act === "pass") {
        sendAction({ type: "pass" });
      }
    });
  });

  // 아이템 클릭: 모두 1회성, 자기 자신 대상
  itemsGrid?.addEventListener("click", (e) => {
    const cell = e.target.closest(".item");
    if (!cell) return;
    if (!gateTurn()) return;
    const kind = cell.dataset.kind; // heal10 / atkBoost / defBoost
    sendAction({ type: "item", itemType: ITEM_TO_SERVER[kind], target: me.id });
  });

  // 타깃 선택
  enemiesBox?.addEventListener("click", (e) => {
    const row = e.target.closest(".enemy.selectable");
    if (!row) return;
    selectEnemy(row.dataset.pid);
  });
  btnConfirm?.addEventListener("click", () => {
    if (!pendingAction) return;
    if (pendingAction.type === "attack") {
      if (!selectedTargetId) { alert("대상을 선택하세요."); return; }
      sendAction({ type: "attack", target: selectedTargetId });
    }
    exitTargetSelect();
  });
  btnCancel?.addEventListener("click", exitTargetSelect);

  // ====== 채팅 ======
  chatSend?.addEventListener("click", sendChat);
  chatInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  function sendChat(){
    const msg = chatInput.value.trim();
    if (!msg) return;
    socket.emit("chat:send", { battleId, msg, name: me?.name || "전투 참여자" });
    // 레거시 호환
    socket.emit("chatMessage", { role: "player", message: msg, battleId });
    chatInput.value = "";
  }

  // ====== 도우미 ======
  function showAuthError(msg){
    if (authMsg) authMsg.textContent = msg;
  }
  function hideAuth(){
    if (authModal) authModal.style.display = "none";
    if (mainUI) mainUI.style.display = "block";
  }
  function normalizeMe(){
    myTeamKey = (me.team === "phoenix" || me.team === "A") ? "phoenix" : "eaters";
  }
  function isMyTurn(){
    if (!currentTurnPlayerId) return false;
    // 플레이어 단위 턴
    if (typeof currentTurnPlayerId === "string" && !/^(A|B|phoenix|eaters)$/.test(currentTurnPlayerId)) {
      return currentTurnPlayerId === me?.id;
    }
    // 팀 단위 턴
    if (currentTurnPlayerId === "phoenix" || currentTurnPlayerId === "A") return myTeamKey === "phoenix";
    if (currentTurnPlayerId === "eaters"  || currentTurnPlayerId === "B") return myTeamKey === "eaters";
    return false;
  }
  function gateTurn(){
    if (status !== "live") { alert("전투 진행 중이 아닙니다."); return false; }
    if (!isMyTurn())       { alert("지금은 당신의 턴이 아닙니다."); return false; }
    return true;
  }
  function sendAction(payload){
    if (!battleId || !me) return;
    socket.emit("player:action", { battleId, playerId: me.id, action: payload });
    // 서버 반영까지 임시 비활성화
    disableActions();
  }
  function enterTargetSelect(){
    if (targetBox) targetBox.style.display = "flex";
    enemiesBox?.querySelectorAll(".enemy").forEach(el => el.classList.add("selectable"));
    selectedTargetId = null;
    enemiesBox?.querySelectorAll(".enemy.selected").forEach(el => el.classList.remove("selected"));
  }
  function exitTargetSelect(){
    if (targetBox) targetBox.style.display = "none";
    enemiesBox?.querySelectorAll(".enemy").forEach(el => el.classList.remove("selectable", "selected"));
    pendingAction = null;
    selectedTargetId = null;
  }
  function selectEnemy(pid){
    selectedTargetId = pid;
    enemiesBox?.querySelectorAll(".enemy").forEach(el => el.classList.toggle("selected", el.dataset.pid === pid));
  }
  function enableActions(can){ document.querySelectorAll(".act,.item").forEach(b => b.disabled = !can); }
  function disableActions(){ enableActions(false); }

  // ====== 렌더링 ======
  function renderAll(b){
    if (Array.isArray(b.players)) {
      const found = b.players.find(p => p.id === me?.id);
      if (found) me = found;
    }
    status = b.status || status;
    currentTurnPlayerId = b.turn?.current ?? currentTurnPlayerId;

    // 상단 상태
    battleStatus.textContent = status;
    renderTurn();

    // 내 카드
    meName.textContent = me?.name || "-";
    meTeam.textContent = (myTeamKey === "phoenix") ? "불사조 기사단" : "죽음을 먹는 자들";
    meAvatar.src = me?.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=pyxis";
    const curP = getPlayer(currentTurnPlayerId);
    battlePortrait.src = (curP?.avatar) || meAvatar.src;

    sATK.textContent = me?.stats?.atk ?? "-";
    sDEF.textContent = me?.stats?.def ?? "-";
    sAGI.textContent = me?.stats?.agi ?? "-";
    sLUK.textContent = me?.stats?.luk ?? "-";

    const hp = Math.max(0, Number(me?.hp ?? 100));
    meHP.textContent = `${hp}/100`;
    hpFill.style.width = Math.min(100, hp) + "%";

    renderItems(me?.items || []);

    // 팀 분리
    const all = Array.isArray(b.players) ? b.players : players;
    const allies  = all.filter(p => sameTeam(p.team, myTeamKey));
    const enemies = all.filter(p => !sameTeam(p.team, myTeamKey));
    renderMates(allies);
    renderEnemies(enemies);

    // 로그 반영
    if (Array.isArray(b.log)) renderLogs(b.log);

    // 액션 버튼 활성화
    enableActions(status === "live" && isMyTurn());
  }

  function renderTurn(){
    if (status !== "live") { turnPill.textContent = "턴 대기"; return; }
    const cur = getPlayer(currentTurnPlayerId);
    const who = cur?.name || (typeof currentTurnPlayerId === "string" ? currentTurnPlayerId : "-");
    turnPill.textContent = `현재 턴: ${who}`;
  }

  function renderItems(arr){
    itemsGrid.innerHTML = "";
    const counts = {};
    arr.forEach(k => counts[k] = (counts[k] || 0) + 1);
    Object.keys(counts).forEach(k => {
      const cell = document.createElement("button");
      cell.className = "item btn";
      cell.dataset.kind = k;
      cell.innerHTML = `<div>${ITEM_LABEL[k] || "아이템"}</div><div class="cnt">x${counts[k]}</div>`;
      itemsGrid.appendChild(cell);
    });
  }

  function renderMates(list){
    matesBox.innerHTML = "";
    list.forEach(p => {
      const row = document.createElement("div");
      row.className = "mate";
      row.innerHTML = `
        <img src="${p.avatar || ""}" alt="">
        <div>
          <div><b>${p.name}</b></div>
          <div class="hp ${p.hp > 0 ? "alive" : "dead"}">${p.hp}/100</div>
        </div>
      `;
      matesBox.appendChild(row);
    });
  }

  function renderEnemies(list){
    enemiesBox.innerHTML = "";
    list.forEach(p => {
      const row = document.createElement("div");
      row.className = "enemy";
      row.dataset.pid = p.id;
      row.innerHTML = `
        <img src="${p.avatar || ""}" alt="">
        <div style="flex:1">
          <div><b>${p.name}</b></div>
          <div class="muted">${p.hp}/100</div>
        </div>
      `;
      enemiesBox.appendChild(row);
    });
    if (pendingAction?.type === "attack") {
      enemiesBox.querySelectorAll(".enemy").forEach(el => el.classList.add("selectable"));
    }
  }

  function renderLogs(logArr){
    logBox.innerHTML = "";
    logArr.slice(-150).forEach(line => {
      const div = document.createElement("div");
      div.className = `log-entry log-${line.type || "system"}`;
      const ts = new Date(line.t || Date.now()).toLocaleTimeString();
      div.textContent = `[${ts}] ${line.message || ""}`;
      logBox.appendChild(div);
    });
    logBox.scrollTop = logBox.scrollHeight;
  }

  function pushChat(who, msg){
    const line = document.createElement("div");
    line.className = "chat-line";
    line.innerHTML = `<span class="who">${who}:</span> ${msg}`;
    chatMsgs.appendChild(line);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    // 운영진 요청으로 채팅도 타임라인에 합산
    pushLog("system", `${who}: ${msg}`);
  }

  function pushLog(type, msg){
    const div = document.createElement("div");
    div.className = `log-entry log-${type || "system"}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function getPlayer(idOrTeam){
    if (!idOrTeam) return null;
    const p = (players || []).find(p => p.id === idOrTeam);
    if (p) return p;
    const teamKey =
      (idOrTeam === "A" || idOrTeam === "phoenix") ? "phoenix" :
      (idOrTeam === "B" || idOrTeam === "eaters")  ? "eaters"  : null;
    if (!teamKey) return null;
    return (players || []).find(p => sameTeam(p.team, teamKey)) || null;
  }
  function sameTeam(serverTeam, key){
    const t = (serverTeam === "A" || serverTeam === "phoenix") ? "phoenix" : "eaters";
    return t === key;
  }
})();
