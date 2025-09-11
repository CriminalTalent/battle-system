// /public/assets/js/spectator.js
// - 관전자 인증: spectatorAuth / spectator:auth (양쪽 호환) + join
// - URL ?battle= & (otp|token)= 인식, 이름은 선택
// - 좌우 A/B팀 로스터(HP바+스탯), 중앙 현재 순서 인물 이미지, 아래 응원 버튼/로그/채팅(보기 전용)
// - 이모지 금지, 기존 표기/스타일 유지

(function(){
  "use strict";

  const $  = (q,root=document)=>root.querySelector(q);
  const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

  // --- 요소(양쪽 ID 일부 호환)
  const el = {
    authView: $('#authView'),
    mainView: $('#mainView'),

    authBattle: $('#authBattle'),
    authOtp: $('#authOtp') || $('#authToken'),
    authName: $('#authName'),
    btnAuth: $('#btnAuth'),

    statusPill: $('#statusPill'),
    turnTeam: $('#turnTeam'),
    turnImg: $('#turnImg'),
    queue: $('#queue'),

    rosterA: $('#rosterPhoenix') || $('#rosterA'),
    rosterB: $('#rosterEaters') || $('#rosterB'),

    timeline: $('#timelineFeed') || $('#battleLog'),
    chatMessages: $('#chatMessages'),

    cheerButtons: $$('.cheer-btn'),
    toast: $('#toast'),
  };

  const state = {
    socket:null,
    battleId:null,
    otp:null,
    name:'',
    status:'waiting',
    players:[],
    currentTeam:'phoenix',
    phase:'',
    teamOrder:['A','B'],
    phaseIndex:0
  };

  // --- 초기화
  document.addEventListener('DOMContentLoaded', ()=>{
    connect();
    autofillFromURL();
    bindUI();
  });

  function connect(){
    const socket = window.io ? window.io(window.location.origin, {
      path:'/socket.io',
      transports:['websocket','polling'],
      withCredentials:true,
      timeout:20000,
    }) : null;
    if(!socket){ alert('Socket.IO 로드 실패'); return; }
    state.socket = socket;
    bindSocket();
  }

  function bindUI(){
    el.btnAuth?.addEventListener('click', onAuth);

    // 응원 버튼(6개 고정)
    el.cheerButtons.forEach((b)=>{
      b.addEventListener('click', ()=>{
        const cheer = b.textContent.trim();
        sendCheer(cheer);
        try{ b.classList.add('shimmer'); setTimeout(()=>b.classList.remove('shimmer'), 1000); }catch(_){}
      });
    });
  }

  function autofillFromURL(){
    const p = new URLSearchParams(location.search);
    const battle = p.get('battle');
    const otp = p.get('otp') || p.get('token');
    const name = p.get('name') || '';

    if(battle) el.authBattle.value = battle;
    if(otp) el.authOtp.value = otp;
    if(name) el.authName.value = name;

    if(battle && otp){
      // 자동 인증
      onAuth();
    }
  }

  // --- 인증
  function onAuth(){
    const battleId = (el.authBattle.value||'').trim();
    const otp = (el.authOtp.value||'').trim();
    const name = (el.authName.value||'').trim();
    if(!battleId || !otp){ showToast('전투 ID와 비밀번호를 입력하세요'); return; }

    state.battleId = battleId; state.otp = otp; state.name = name;

    const s = state.socket;
    s.emit('spectatorAuth', { battleId, otp, name });
    s.emit('spectator:auth', { battleId, otp, name });

    // 룸 합류(상태 동기화)
    s.emit('join', { battleId });
  }

  function bindSocket(){
    const s = state.socket;
    s.on('auth:success', (payload)=>{
      // 관전자 인증 성공 시 메인 뷰 표시
      showMain();
      if(payload?.battle) applySnapshot(payload.battle);
      renderAll();
      showToast('접속 완료');
    });

    s.on('authError', (e)=> showToast('인증 실패: ' + (e?.error||e?.message||'오류'), 'error'));
    s.on('auth:error', (e)=> showToast('인증 실패: ' + (e?.error||e?.message||'오류'), 'error'));

    s.on('battle:update', (snap)=>{
      applySnapshot(snap);
      renderAll();
    });

    // 채팅(보기 전용)
    s.on('battle:chat', ({name,message})=> appendChat(name||'플레이어', message||''));
    s.on('chat:message', (payload)=>{
      const name = payload?.senderName || payload?.name || '플레이어';
      const message = payload?.message || '';
      appendChat(name, message);
    });

    // 로그/타임라인
    s.on('battle:log', ({type,message,ts})=>{
      appendLog(type||'info', message||'', ts||Date.now());
    });

    // 관전자 수(옵션)
    s.on('spectator:count', ({count})=>{/* 필요 시 표시용 엘리먼트에 적용 */});
    s.on('spectator:count_update', ({count})=>{/* 동일 */});
  }

  // --- 스냅샷 반영
  function applySnapshot(b){
    if(!b) return;
    state.status = b.status || 'waiting';
    state.players = Array.isArray(b.players) ? b.players : [];
    state.currentTeam = b.currentTeam || 'phoenix';
    state.phase = b.phase || '';
    state.teamOrder = (b.turn && b.turn.order) ? b.turn.order : ['A','B'];
    state.phaseIndex = (b.turn && typeof b.turn.phaseIndex==='number') ? b.turn.phaseIndex : 0;
  }

  // --- 렌더
  function renderAll(){
    // 상태표시
    el.statusPill && (el.statusPill.textContent = {
      waiting:'대기 중', active:'진행 중', paused:'일시정지', ended:'종료'
    }[state.status] || '대기 중');

    // 현재 순서팀
    const phaseAB = (state.teamOrder[state.phaseIndex] || 'A');
    el.turnTeam && (el.turnTeam.textContent = `현재 순서팀: ${phaseAB}`);

    // 현재 선택자 프리뷰(대표 이미지)
    updateMainImageByQueue();

    // 좌/우 로스터
    renderRoster();

    // 순서 큐
    renderQueue();
  }

  function teamAB(team){
    const s = String(team||'').toLowerCase();
    if(s==='phoenix'||s==='a') return 'A';
    if(s==='eaters'||s==='b') return 'B';
    return '-';
  }
  function teamKey(team){ return teamAB(team)==='A' ? 'phoenix' : 'eaters'; }

  function renderRoster(){
    const listA = []; const listB = [];
    (state.players||[]).forEach(p=>{
      const ab = teamAB(p.team);
      (ab==='A' ? listA : listB).push(p);
    });

    const build = (p)=>{
      const maxHp = p.maxHp ?? 100;
      const hpPct = Math.max(0, Math.min(100, ((p.hp||0)/maxHp)*100));
      const atk = p.stats?.attack ?? p.stats?.공격 ?? '-';
      const def = p.stats?.defense?? p.stats?.방어 ?? '-';
      const agi = p.stats?.agility?? p.stats?.민첩 ?? '-';
      const luk = p.stats?.luck   ?? p.stats?.행운 ?? '-';
      const row = document.createElement('div');
      row.className='member';
      row.innerHTML = `
        <div class="ava">${p.avatar?`<img src="${p.avatar}">`:''}</div>
        <div class="body">
          <div class="name">${escapeHtml(p.name||'-')} · 팀 ${teamAB(p.team)}</div>
          <div class="sub">공 ${atk} · 방 ${def} · 민 ${agi} · 운 ${luk}</div>
          <div class="hpbar" style="margin-top:6px"><i style="width:${hpPct}%"></i></div>
          <div class="sub">HP ${p.hp}/${maxHp}</div>
        </div>
      `;
      return row;
    };

    if(el.rosterA){ el.rosterA.innerHTML=''; listA.forEach(p=> el.rosterA.appendChild(build(p))); }
    if(el.rosterB){ el.rosterB.innerHTML=''; listB.forEach(p=> el.rosterB.appendChild(build(p))); }
  }

  function renderQueue(){
    if(!el.queue) return;
    el.queue.innerHTML='';
    const phaseAB = (state.teamOrder[state.phaseIndex] || 'A');
    const curKey = (phaseAB==='A') ? 'phoenix':'eaters';
    const alive = (state.players||[]).filter(p=>(p.hp||0)>0 && teamKey(p.team)===curKey);
    alive.forEach((p,i)=>{
      const q = document.createElement('div');
      q.className = 'qitem' + (i===0 ? ' active':'');
      q.innerHTML = `<img src="${p.avatar||''}" alt=""><div class="name">${escapeHtml(p.name||'')}</div>`;
      el.queue.appendChild(q);
    });
  }

  function updateMainImageByQueue(){
    if(!el.turnImg || !el.queue) return;
    const first = el.queue.querySelector('.qitem img');
    const src = first ? first.getAttribute('src') : '';
    el.turnImg.src = src || '';
  }

  // --- 응원/채팅(보기 전용)
  function sendCheer(message){
    if(!state.socket || !state.battleId) return;
    // 관전자 응원 전용 경로(양쪽 호환)
    state.socket.emit('spectator:cheer', { battleId: state.battleId, message });
    state.socket.emit('cheer:send', { battleId: state.battleId, name: state.name || '관전자', message });
    appendLog('cheer', `관전자 응원: ${message}`);
  }

  function appendChat(sender, text){
    if(!el.chatMessages) return;
    const d = document.createElement('div');
    d.textContent = `${sender}: ${text}`;
    el.chatMessages.appendChild(d);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function appendLog(type, message, ts){
    if(!el.timeline) return;
    const d = document.createElement('div');
    d.textContent = message;
    el.timeline.appendChild(d);
    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  // --- 화면 전환/유틸
  function showMain(){
    el.authView.style.display='none';
    el.mainView.style.display='';
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }
  function showToast(msg, kind){
    if(!el.toast) return;
    el.toast.className = 'toast' + (kind?(' '+kind):'');
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    setTimeout(()=> el.toast.classList.remove('show'), 1600);
  }
})();
