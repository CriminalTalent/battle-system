/* PYXIS 전투 참가자 클라이언트 (자동 로그인 개선)
   - 소켓 연결 후(player connect) 자동 인증 emit
   - URL 파라미터 battle/name/token 인식
   - 기존 이벤트명(playerAuth/join/battle:update/chat)을 그대로 사용
*/
(() => {
  const $ = (s, r=document)=>r.querySelector(s);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";

  const el = {
    // 뷰/오버레이
    viewAuth: $('#authView'),
    viewMain: $('#mainView'),
    overlay: $('#loadingOverlay'),
    // 인증
    authBattle: $('#battleId'),
    authName: $('#playerName'),
    authToken: $('#authToken'),
    btnAuth: $('#btnAuth'),
    // 내 정보
    myAvatar: $('#myAvatar'), myName: $('#myName'), myTeam: $('#myTeam'),
    statATK: $('#statATK'), statDEF: $('#statDEF'), statAGI: $('#statAGI'), statLUK: $('#statLUK'),
    myHpBar: $('#myHpBar'), myHpText: $('#myHpText'),
    // 턴/로그/채팅
    turnAvatar: $('#turnAvatar'), turnName: $('#turnName'), turnTimer: $('#turnTimer'),
    logBox: $('#battleLog'),
    chatBox: $('#chatMessages'), chatInput: $('#chatInput'), btnChat: $('#btnChat'),
    // 액션
    btnReady: $('#btnReady'),
    btnAttack: $('#btnAttack'), btnDefend: $('#btnDefend'), btnDodge: $('#btnDodge'), btnPass: $('#btnPass'),
    btnItemDittany: $('#btnItemDittany'), btnItemAttack: $('#btnItemAttack'), btnItemDefense: $('#btnItemDefense')
  };

  const state = {
    socket:null, battle:null, meId:null,
    pendingAuth:null,        // ← 소켓 연결 후 자동 인증에 사용
    turnEndsAt:0, turnTimerId:0
  };

  // 팀 표시: 화면은 A/B로만
  const teamShort = (t)=> String(t).toLowerCase()==='eaters' ? 'B팀' : 'A팀';

  // 오버레이
  const showOverlay = (on)=> el.overlay?.classList.toggle('show', !!on);
  const showMain = ()=>{ el.viewAuth.style.display='none'; el.viewMain.style.display=''; };

  // 소켓 연결
  function getSocketURL(){
    if (typeof window.PYXIS_SERVER_URL==='string' && window.PYXIS_SERVER_URL) return window.PYXIS_SERVER_URL;
    return undefined;
  }
  function connect(){
    if (!window.io) return alert('Socket.IO 로드 실패');
    state.socket = window.io(getSocketURL(), { transports:['websocket','polling'], withCredentials:true });

    // 연결 후: 대기 중인 자동 인증 있으면 즉시 전송
    state.socket.on('connect', ()=>{
      if (state.pendingAuth){
        state.socket.emit('playerAuth', state.pendingAuth);
        state.pendingAuth = null;
      }
    });

    // 인증 성공
    state.socket.on('auth:success', (p)=>{
      if (p.role!=='player') return;
      state.meId = p.playerId || p.player?.id || null;
      if (p.battle) state.battle = p.battle;
      showOverlay(false);
      showMain();
      state.socket.emit('join', { battleId: p.battleId || p.battle?.id });
      renderAll();
    });

    state.socket.on('authError', (e)=>{ showOverlay(false); alert('인증 실패: ' + (e?.error||'')); });

    // 상태/로그/채팅
    state.socket.on('battle:update', (b)=>{ state.battle=b; renderAll(); });
    state.socket.on('battle:log', (entry)=> appendLog(entry?.type||'system', entry?.message||''));
    state.socket.on('battle:chat', ({name,message})=> appendLog('chat', `[채팅] ${name||'익명'}: ${message||''}`));
  }

  // URL 자동 채우기 + 자동 인증 예약(소켓 연결 후 실행)
  function autoFromURL(){
    const q = new URLSearchParams(location.search);
    const battle = q.get('battle'); const name = q.get('name'); const token = q.get('token');
    if (battle) el.authBattle.value = battle;
    if (name) el.authName.value = name;
    if (token) el.authToken.value = token;
    if (battle && name && token){
      showOverlay(true);
      state.pendingAuth = { battleId:battle, name, token }; // connect 이후 emit
    }
  }

  // 수동 인증 버튼
  el.btnAuth?.addEventListener('click', ()=>{
    const battleId = (el.authBattle.value||'').trim();
    const name = (el.authName.value||'').trim();
    const token = (el.authToken.value||'').trim();
    if (!battleId || !name || !token) return alert('전투 ID/이름/비밀번호를 모두 입력하세요.');
    showOverlay(true);
    // 연결되어 있지 않으면 예약
    if (!state.socket || state.socket.disconnected){
      state.pendingAuth = { battleId, name, token };
      return;
    }
    state.socket.emit('playerAuth', { battleId, name, token });
  });

  // 렌더링(요약)
  function renderAll(){ if(!state.battle) return; renderMe(); renderTurn(); renderLog(); updateActions(); }
  function me(){ const id=state.meId; return (state.battle?.players||[]).find(p=>p.id===id)||null; }

  function renderMe(){
    const m = me(); if(!m) return;
    el.myName.textContent = m.name || '전투 참가자';
    el.myTeam.textContent = teamShort(m.team);
    el.myAvatar.src = m.avatar || DEFAULT_AVATAR;
    const s = m.stats||{};
    el.statATK.textContent = clamp(Number(s.attack||3),1,10);
    el.statDEF.textContent = clamp(Number(s.defense||3),1,10);
    el.statAGI.textContent = clamp(Number(s.agility||3),1,10);
    el.statLUK.textContent = clamp(Number(s.luck||3),1,10);
    const maxHp = Math.max(Number(m.maxHp||100),1);
    const hp = clamp(Number(m.hp||0),0,maxHp);
    el.myHpBar.style.width = Math.round(hp/maxHp*100) + '%';
    el.myHpText.textContent = `${hp} / ${maxHp}`;
  }

  function renderTurn(){
    const b = state.battle||{};
    const team = String(b.currentTeam||b.current||'phoenix').toLowerCase()==='eaters'?'eaters':'phoenix';
    el.turnName.textContent = b.status==='active' ? (team==='eaters'?'B팀':'A팀') + ' 턴' : '대기 중';
    let avatar = DEFAULT_AVATAR;
    if (Array.isArray(b.players)){
      const cand = b.players.find(p=>String(p.team).toLowerCase()===team && p.hp>0 && p.avatar);
      if (cand?.avatar) avatar=cand.avatar;
    }
    el.turnAvatar.src = avatar;

    // 서버가 turnStartTime을 주므로 남은 시간 표시(5분 규칙) :contentReference[oaicite:3]{index=3}
    if (b.turnStartTime){
      const TURN_MS = 5*60*1000;
      const left = Math.max(0, TURN_MS - (Date.now() - Number(b.turnStartTime)));
      startTurnTimer(left);
    } else {
      clearTurnTimer();
    }
  }

  function renderLog(){
    const list = Array.isArray(state.battle?.log) ? state.battle.log : [];
    el.logBox.innerHTML = '';
    list.slice(-200).forEach(l=> appendLog(l.type||'system', l.message||'', true));
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }
  function appendLog(type,msg,appendOnly=false){
    // phoenix/eaters → A/B, 괄호 내 부가정보 제거 :contentReference[oaicite:4]{index=4}
    let s = String(msg||'').replace(/\bphoenix\b/gi,'A팀').replace(/\b(eaters|death)\b/gi,'B팀').replace(/\s*\((민첩성|행운|주사위|공격력|방어력)[^)]+\)/g,'').trim();
    const div=document.createElement('div'); div.className='entry mono' + (type==='chat'?' chat':''); div.textContent=s;
    el.logBox.appendChild(div); if(!appendOnly) el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  // 액션 활성화: 내 팀 턴일 때만
  function isMyTurn(){
    const b = state.battle||{}; const m = me(); if(!m || b.status!=='active') return false;
    const curTeam = String(b.currentTeam||b.current||'phoenix').toLowerCase();
    return (curTeam==='eaters'?'eaters':'phoenix') === String(m.team).toLowerCase();
  }
  function updateActions(){
    const en = isMyTurn() && (me()?.hp>0);
    [el.btnAttack,el.btnDefend,el.btnDodge,el.btnPass,el.btnItemDittany,el.btnItemAttack,el.btnItemDefense].forEach(btn=>{ if(btn) btn.disabled=!en; });
  }

  // 턴 타이머
  function startTurnTimer(ms){
    clearTurnTimer();
    const end = Date.now()+Math.max(0,ms);
    el.turnTimer.textContent = '남은 시간: ' + Math.ceil(ms/1000) + '초';
    state.turnTimerId = setInterval(()=>{
      const left = end - Date.now();
      if (left<=0){ clearTurnTimer(); return; }
      el.turnTimer.textContent = '남은 시간: ' + Math.ceil(left/1000) + '초';
    }, 500);
  }
  function clearTurnTimer(){ if(state.turnTimerId){ clearInterval(state.turnTimerId); state.turnTimerId=0; } el.turnTimer.textContent='턴 시간: --'; }

  // 채팅 전송
  function sendChat(){
    const msg = (el.chatInput.value||'').trim(); if(!msg) return;
    const b = state.battle; if(!b?.id) return;
    state.socket.emit('chat:send', { battleId:b.id, name: me()?.name || '익명', message: msg, role:'player' }); // 서버 채널과 일치 :contentReference[oaicite:5]{index=5} :contentReference[oaicite:6]{index=6}
    el.chatInput.value='';
  }
  el.btnChat?.addEventListener('click', sendChat);
  el.chatInput?.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

  // 시작
  document.addEventListener('DOMContentLoaded', ()=>{ connect(); autoFromURL(); });
})();
