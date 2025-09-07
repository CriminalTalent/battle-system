// spectator.js
(function(){
  "use strict";

  const $ = (s)=>document.querySelector(s);
  const qs = new URLSearchParams(location.search);

  // 가능한 ID들 폭넓게 매칭
  const elBattle = $("#authBattleId") || $("#battleId") || $("#battle");
  const elOtp    = $("#authOtp") || $("#otp") || $("#spectatorOtp");
  const elName   = $("#sname") || $("#authName") || $("#name") || $("#nick");

  const btnJoin  = $("#btnJoin") || $("#btnAuth") || $("#btnLogin");
  const infoMsg  = $("#authMsg") || $("#joinMsg") || $("#infoMsg");
  const elLog    = $("#battleLog") || null;

  // 쿼리 자동 채움
  const qBattle = qs.get("battle") || qs.get("b") || "";
  const qOtp    = qs.get("otp") || "";
  const qName   = qs.get("name") || qs.get("nick") || "";
  if (qBattle && elBattle) elBattle.value = qBattle;
  if (qOtp && elOtp)       elOtp.value    = qOtp;
  if (qName && elName)     elName.value   = qName;

  // 소켓
  let socket = null;
  function ensureSocket(){
    if (socket) return socket;
    // eslint-disable-next-line no-undef
    socket = io();

    // 성공
    socket.on("joinSuccess", ({ battleId, role, state })=>{
      if (role !== "spectator") return;
      renderState(state);
      hideAuth();
      showMsg("관전 입장 완료");
      logLine(`관전 입장: battle=${battleId}`);
    });
    // 스냅샷/업데이트 (허브 브로드캐스트) :contentReference[oaicite:10]{index=10}
    socket.on("state:snapshot", (state)=> renderState(state));
    socket.on("state:update",   (state)=> renderState(state));
    socket.on("battleUpdate",   (state)=> renderState(state));

    // 에러
    socket.on("error", (e)=>{
      const msg = (e && (e.message || e.code)) ? `${e.message} (${e.code||''})` : (typeof e==='string'? e : '입장 실패');
      showMsg(msg);
      logLine(`ERROR: ${msg}`);
    });

    return socket;
  }

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
    const modal = $("#loginModal") || $("#authModal");
    if (modal) modal.style.display = "none";
    const main  = $("#mainUI");
    if (main) main.style.display = "";
  }
  function renderState(state){
    // 관전자 화면에서 필요한 최소 렌더 (원본 레이아웃 유지)
    // state.players, state.turn 등은 서버 스냅샷 구조 참조 :contentReference[oaicite:11]{index=11}
  }

  // 버튼
  if (btnJoin) {
    btnJoin.addEventListener("click", ()=>{
      const battleId = (elBattle?.value||"").trim();
      const otp      = (elOtp?.value||"").trim();     // 관전자 OTP 필수 :contentReference[oaicite:12]{index=12}
      const name     = (elName?.value||"").trim() || "관전자";
      if (!battleId || !otp) { showMsg("battle / otp(관전자) 입력"); return; }
      const s = ensureSocket();
      s.emit("joinBattle", { battleId, role:"spectator", otp, playerId: name });
      showMsg("입장 시도 중…");
    });
  }

  // 자동 입장
  window.addEventListener('DOMContentLoaded', ()=>{
    if (qBattle && qOtp) {
      const s = ensureSocket();
      s.emit("joinBattle", { battleId:qBattle, role:"spectator", otp:qOtp, playerId: qName || "관전자" });
      showMsg("자동 입장 시도 중…");
    }
  });
})();
