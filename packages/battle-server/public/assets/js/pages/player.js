// player.js
(function(){
  "use strict";

  // ===== Helpers =====
  const $ = (s)=>document.querySelector(s);
  const qs = new URLSearchParams(location.search);

  // 가능한 ID들을 폭넓게 지원(기존 마크업 유지)
  const elBattle = $("#authBattleId") || $("#battleId") || $("#battle");
  const elOtp    = $("#otp") || $("#authOtp") || $("#playerOtp");
  const elName   = $("#pname") || $("#playerName") || $("#name");

  const btnJoin  = $("#btnAuth") || $("#btnJoin") || $("#btnLogin");
  const infoMsg  = $("#authMsg") || $("#joinMsg") || $("#infoMsg");

  // 상태/표시용 (마크업에 없으면 무시)
  const elMyName = $("#playerNameValue") || $("#playerName") || null;
  const elMyTeam = $("#playerTeam") || null;
  const elMyHp   = $("#playerHp") || null;
  const elHpFill = $("#hpFill") || null;
  const elLog    = $("#battleLog") || null;

  // ===== Query autofill =====
  const qBattle  = qs.get("battle")   || qs.get("b") || "";
  const qOtp     = qs.get("otp")      || "";
  const qPlayer  = qs.get("playerId") || qs.get("pid") || qs.get("player") || "";
  if (qBattle && elBattle) elBattle.value = qBattle;
  if (qOtp && elOtp)       elOtp.value    = qOtp;
  if (qPlayer && elName)   elName.value   = qPlayer;

  // ===== Socket =====
  let socket = null;
  function ensureSocket(){
    if (socket) return socket;
    // eslint-disable-next-line no-undef
    socket = io();
    // 성공: 서버 표준 응답
    socket.on("joinSuccess", ({ battleId, role, playerId, state })=>{
      if (role !== "player") return; // 내가 플레이어로 들어간 경우만 처리
      renderState(state);
      showMsg("입장 성공");
      hideAuth();
      logLine(`플레이어 ${playerId} 입장 완료. 전투 ${battleId}`);
    });
    // 스냅샷/업데이트 (서버 브로드캐스트 허브, 레거시 호환) :contentReference[oaicite:6]{index=6}
    socket.on("state:snapshot", (state)=> renderState(state));
    socket.on("state:update",   (state)=> renderState(state));
    socket.on("battleUpdate",   (state)=> renderState(state));

    // 실패: 서버는 'error' 채널로 사유/코드 전달 :contentReference[oaicite:7]{index=7}
    socket.on("error", (e)=>{
      const msg = (e && (e.message || e.code)) ? `${e.message} (${e.code||''})` : (typeof e==='string'? e : '입장 실패');
      showMsg(msg);
      logLine(`ERROR: ${msg}`);
    });

    return socket;
  }

  // ===== UI helpers =====
  function showMsg(msg){ if(infoMsg) infoMsg.textContent = msg; }
  function logLine(text){
    if(!elLog) return;
    const d = document.createElement("div");
    d.className = "logline";
    d.textContent = text;
    elLog.appendChild(d);
    elLog.scrollTop = elLog.scrollHeight;
  }
  function hideAuth(){
    const modal = $("#authModal") || $("#loginModal");
    if (modal) modal.style.display = "none";
    const main  = $("#mainUI");
    if (main) main.style.display = "";
  }
  function renderState(state){
    if (!state || !state.players) return;
    // 내 정보 갱신(가능하면)
    const pid = (elName && elName.value) || qPlayer;
    const me = state.players.find(p => p.id === pid || p.name === pid);
    if (me) {
      if (elMyName) elMyName.textContent = me.name || me.id || "-";
      if (elMyTeam) elMyTeam.textContent = (me.team === "A" ? "불사조" : (me.team === "B" ? "죽먹" : me.team));
      if (elMyHp)   elMyHp.textContent   = String(me.hp);
      if (elHpFill) elHpFill.style.width = `${Math.max(0, Math.min(100, me.hp))}%`;
    }
  }

  // ===== Join button =====
  if (btnJoin) {
    btnJoin.addEventListener("click", ()=>{
      const battleId = (elBattle?.value||"").trim();
      const otp      = (elOtp?.value||"").trim();        // 플레이어 토큰 필요 :contentReference[oaicite:8]{index=8}
      const playerId = (elName?.value||"").trim();       // 서버는 playerId로 식별/검증
      if (!battleId || !otp || !playerId) { showMsg("battle / otp / playerId 모두 입력"); return; }
      const s = ensureSocket();
      s.emit("joinBattle", { battleId, role:"player", playerId, otp });
    });
  }

  // ===== Auto join by query =====
  window.addEventListener('DOMContentLoaded', ()=>{
    if (qBattle && qOtp && qPlayer) {
      const s = ensureSocket();
      s.emit("joinBattle", { battleId:qBattle, role:"player", playerId:qPlayer, otp:qOtp });
      showMsg("자동 입장 시도 중…");
    }
  });

  // (선택) 액션 전송: 서버 표준은 playerAction({battleId,playerId,action}) :contentReference[oaicite:9]{index=9}
  function sendAction(type, extras={}) {
    const battleId = (elBattle?.value||qBattle||"").trim();
    const playerId = (elName?.value||qPlayer||"").trim();
    if (!battleId || !playerId) return showMsg("전투/플레이어 식별 필요");
    ensureSocket().emit("playerAction", { battleId, playerId, action: { type, ...extras } });
  }
  // 버튼 바인딩(있을 때만)
  $("#btnAttack")?.addEventListener("click", ()=> sendAction("attack")); 
  $("#btnDefend")?.addEventListener("click", ()=> sendAction("defend"));
  $("#btnDodge") ?.addEventListener("click", ()=> sendAction("dodge"));
  $("#btnItem")  ?.addEventListener("click", ()=> sendAction("item"));
  $("#btnPass")  ?.addEventListener("click", ()=> sendAction("pass"));
})();
