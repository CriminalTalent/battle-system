(() => {
  // ====== DOM Helpers ======
  const $  = (s, r=document) => r.querySelector(s);
  const qp = new URLSearchParams(location.search);

  // ====== UI (통합 타임라인) ======
  const UI = {
    timeline: null,
    init() { this.timeline = $('#timeline'); },
    _append(type, msg, name){
      if(!this.timeline) return;
      const line = document.createElement('div');
      line.className = 'timeline__line';
      const t = document.createElement('span');
      t.className = 'tl__time';
      t.textContent = '['+new Date().toLocaleTimeString()+']';
      const tag = document.createElement('span');
      tag.className = 'tl__tag ' + (type==='sys'?'tag--sys':type==='admin'?'tag--admin':'tag--chat');
      tag.textContent = (type==='sys'?'시스템':(type==='admin'?'관리':'채팅'));
      const body = document.createElement('span');
      body.className = 'tl__msg';
      body.textContent = (name && type==='chat') ? `${name}: ${msg}` : msg;
      line.appendChild(t); line.appendChild(tag); line.appendChild(body);
      this.timeline.appendChild(line);
      this.timeline.scrollTop = this.timeline.scrollHeight;
    },
    admin(m){ this._append('admin', m); },
    sys(m){ this._append('sys', m); },
    chat(m,n){ this._append('chat', m, n); },
    setText(sel, v){ const el=$(sel); if(el) el.textContent=String(v ?? '') }
  };

  // ====== Fetch Helpers ======
  async function jfetch(url,opt={}) {
    const res = await fetch(url, { headers:{'Content-Type':'application/json', ...(opt.headers||{})}, ...opt });
    let body=null; try{ body=await res.json(); }catch{}
    if(!res.ok) throw new Error((body&&(body.message||body.error))||res.statusText||('HTTP '+res.status));
    return body||{};
  }
  async function post(url,data){ return jfetch(url,{ method:'POST', body:JSON.stringify(data||{}) }); }

  // ====== REST API ======
  const API = {
    create:'/api/battles',
    get:(id)=>'/api/battles/'+encodeURIComponent(id),
    start:(id)=>'/api/admin/battles/'+encodeURIComponent(id)+'/start',
    pause:(id)=>'/api/admin/battles/'+encodeURIComponent(id)+'/pause',
    resume:(id)=>'/api/admin/battles/'+encodeURIComponent(id)+'/resume',
    end:(id)=>'/api/admin/battles/'+encodeURIComponent(id)+'/end',
    links:(id)=>'/api/admin/battles/'+encodeURIComponent(id)+'/links',
    otp:(id)=>'/api/admin/battles/'+encodeURIComponent(id)+'/otp',
    addPlayer:(id)=>'/api/battles/'+encodeURIComponent(id)+'/players',
    delPlayer:(id,pid)=>'/api/battles/'+encodeURIComponent(id)+'/players/'+encodeURIComponent(pid),
    uploadAvatar:(id)=>'/api/battles/'+encodeURIComponent(id)+'/avatar',
  };

  // ====== Socket ======
  let socket=null;
  function attachSocketListeners(){
    if(!socket) return;
    socket.on('connect',()=>{ UI.admin('소켓 연결 완료'); tryAdminAuth(); });
    socket.on('disconnect',()=>{ UI.admin('소켓 연결 끊김'); });
    socket.on('authSuccess',()=>{ UI.admin('관리자 인증 성공'); });
    socket.on('authError',(e)=>{ UI.admin('관리자 인증 실패: '+(e&&e.error||'unknown')); });
    socket.on('error',(e)=>{ UI.admin('소켓 오류: '+(e&&e.message||e||'unknown')); });

    socket.on('battleUpdate',(snap)=>{
      UI.sys('상태 업데이트 수신');
      if(snap && typeof snap==='object') renderParticipants(snap);
      else refreshParticipants();
    });
    socket.on('battle:log',(p)=>{ UI.sys(p?.msg||p?.message||''); });
    socket.on('battle:chat',(p)=>{ UI.chat(p?.msg||p?.message||'', p?.name||'익명'); });
  }
  function connectSocket(){
    if(socket && socket.connected) return;
    // eslint-disable-next-line no-undef
    socket = io(undefined,{ path:'/socket.io', transports:['websocket','polling'], withCredentials:true });
    attachSocketListeners();
  }
  async function tryAdminAuth(){
    const battleId = $('#battleId')?.value?.trim();
    const token = $('#adminToken')?.value?.trim();
    if(!socket || !socket.connected) return;
    if(!battleId || !token) return;
    socket.emit('adminAuth',{ battleId, token });
  }

  // ====== 링크 구성 & 복사 ======
  function setLinks(){
    const base = location.origin.replace(/\/+$/,'');
    const bid  = $('#battleId')?.value?.trim() || '';
    const q    = bid ? ('?battle='+encodeURIComponent(bid)) : '';
    const admin = base + '/admin'     + q;
    const play  = base + '/play'      + q;
    const spec  = base + '/spectator' + q;
    $('#linkAdmin')    && ($('#linkAdmin').textContent = admin);
    $('#linkPlayer')   && ($('#linkPlayer').textContent = play);
    $('#linkSpectator')&& ($('#linkSpectator').textContent = spec);
    return { base, bid, admin, play, spec };
  }
  function copyText(t){
    if(!t) return UI.admin('복사할 내용이 없습니다');
    navigator.clipboard.writeText(t).then(
      ()=>UI.admin('클립보드 복사 완료'),
      (e)=>UI.admin('복사 실패: '+e.message)
    );
  }

  // 서버에서 관리자 링크를 통해 토큰 재확보(페이지 새로고침 등)
  async function ensureAdminToken(battleId){
    const cur=$('#adminToken')?.value?.trim();
    if(cur) return cur;
    try{
      const res = await post(API.links(battleId), {});
      const link = res?.admin || res?.adminUrl || $('#linkAdmin')?.textContent || '';
      if(typeof link==='string' && link){
        const u=new URL(link, location.origin);
        const t = u.searchParams.get('token') || u.searchParams.get('admin') || u.searchParams.get('t');
        if(t){ $('#adminToken').value=t; return t; }
      }
    }catch(e){ UI.admin('관리 토큰 확보 실패(links): '+e.message); }
    return '';
  }

  // ====== 전투 제어 ======
  async function createBattle(){
    const mode=$('#selMode')?.value||'2v2';
    try{
      const res = await post(API.create,{mode});
      const id  = res?.id || res?.battle?.id || res?.battleId;
      const tok = res?.token || res?.adminToken;
      if(!id) throw new Error('battle id 없음');
      $('#battleId').value=id;
      if(tok) $('#adminToken').value=tok;
      setLinks();
      UI.admin('전투 생성 완료: '+id);
      connectSocket();
      if(tok) tryAdminAuth();
      refreshParticipants();
      UI.sys('초기 상태 준비 완료');
    }catch(e){ UI.admin('전투 생성 실패: '+e.message); }
  }
  async function ctrlBattle(kind){
    const id=$('#battleId')?.value?.trim();
    if(!id) return UI.admin('전투 ID가 비어 있습니다');
    const map={ start:API.start(id), pause:API.pause(id), resume:API.resume(id), end:API.end(id) };
    if(!$('#adminToken').value) { await ensureAdminToken(id); }
    if(socket && socket.connected){
      await tryAdminAuth();
      await new Promise(r=>setTimeout(r,120));
    }
    try{
      await post(map[kind],{});
      UI.admin('전투 '+kind+' 요청 완료');
      if(socket && socket.connected && $('#adminToken').value){
        socket.emit('battle:'+kind, { battleId:id });
        UI.admin('전투 '+kind+' 소켓 송신');
      }
    }catch(e){ UI.admin('전투 '+kind+' 실패: '+e.message); }
  }

  // ====== 참가자 / 이미지 업로드 ======
  function clamp(n,min,max){ n=Number(n); if(Number.isNaN(n)) n=min; return Math.max(min, Math.min(max, Math.round(n))) }
  async function uploadAvatar(){
    const id=$('#battleId')?.value?.trim(); if(!id) return UI.admin('전투 ID가 비어 있습니다');
    const file=$('#pAvatarFile')?.files?.[0]; if(!file) return UI.admin('업로드할 파일이 없습니다');
    try{
      const fd=new FormData(); fd.append('avatar', file);
      const res=await fetch(API.uploadAvatar(id),{ method:'POST', body:fd });
      const body=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(body?.message||body?.error||res.statusText);
      if(!body?.url) throw new Error('업로드 응답에 url 없음');
      $('#pAvatarUrl').value = body.url;
      UI.admin('이미지 업로드 완료');
    }catch(e){ UI.admin('이미지 업로드 실패: '+e.message); }
  }
  function buildItemsFromCounts(){
    const heal = clamp($('#pHeal10')?.value, 0, 99);
    const atk  = clamp($('#pAtkBoost')?.value, 0, 99);
    const def  = clamp($('#pDefBoost')?.value, 0, 99);
    const arr=[];
    for(let i=0;i<heal;i++) arr.push('heal10');
    for(let i=0;i<atk;i++)  arr.push('atkBoost');
    for(let i=0;i<def;i++)  arr.push('defBoost');
    return arr;
  }
  async function addPlayer(){
    const id=$('#battleId')?.value?.trim(); if(!id) return UI.admin('전투 ID가 비어 있습니다');
    const name=$('#pName')?.value?.trim(); if(!name) return UI.admin('이름을 입력하세요');
    const team=$('#pTeam')?.value||'phoenix';
    const stats={
      atk: clamp($('#pATK')?.value, 0, 5),
      def: clamp($('#pDEF')?.value, 0, 5),
      agi: clamp($('#pAGI')?.value, 0, 5),
      luk: clamp($('#pLUK')?.value, 0, 5),
    };
    const items = buildItemsFromCounts();
    const avatar=($('#pAvatarUrl')?.value||'').trim() || undefined;

    try{
      const payload={ name, team, stats, items, ...(avatar?{avatar}:{}) };
      await post(API.addPlayer(id), payload);
      UI.sys('전투 참가자 추가 완료: '+name);
      $('#pName').value='';
      $('#pHeal10').value='0'; $('#pAtkBoost').value='0'; $('#pDefBoost').value='0';
      $('#pAvatarFile').value='';
      refreshParticipants();
    }catch(e){ UI.sys('전투 참가자 추가 실패: '+e.message); }
  }
  async function removeParticipant(pid){
    const id=$('#battleId')?.value?.trim(); if(!id) return UI.sys('전투 ID가 비어 있습니다');
    try{
      const res=await fetch(API.delPlayer(id,pid),{ method:'DELETE' });
      if(!res.ok){
        const body=await res.json().catch(()=>({}));
        throw new Error(body?.message||body?.error||res.statusText);
      }
      UI.sys('전투 참가자 제거 완료: '+pid);
      refreshParticipants();
    }catch(e){ UI.sys('전투 참가자 제거 실패: '+e.message); }
  }
  async function refreshParticipants(){
    const id=$('#battleId')?.value?.trim(); if(!id) return;
    try{
      const snap=await jfetch(API.get(id));
      renderParticipants(snap);
    }catch(e){
      UI.sys('전투 참가자 목록 갱신 실패: '+e.message);
    }
  }
  function renderParticipants(snap){
    const players = Array.isArray(snap?.players) ? snap.players : [];
    const phoenix = players.filter(p=>p.team==='phoenix');
    const eaters  = players.filter(p=>p.team==='eaters');

    UI.setText('#cntPhoenix', String(phoenix.length)+'명');
    UI.setText('#cntEaters',  String(eaters.length)+'명');

    const lp=$('#listPhoenix'); const le=$('#listEaters');
    if(lp) lp.innerHTML=''; if(le) le.innerHTML='';

    function nodeFor(p){
      const wrap=document.createElement('div'); wrap.className='participant';
      const img=document.createElement('img'); img.className='avatar'; img.src=p.avatar||''; img.alt=p.name||'image'; if(!p.avatar) img.style.opacity='0.35';
      const body=document.createElement('div');
      const nm=document.createElement('div'); nm.className='p-name'; nm.textContent=p.name||'(이름없음)';
      const st=document.createElement('div'); st.className='p-stat';
      const s=p.stats||{};
      const itemStr=(Array.isArray(p.items)&&p.items.length)?` · 아이템 ${p.items.join(', ')}`:'';
      st.textContent=`공격력 ${s.atk??0} / 방어력 ${s.def??0} / 민첩 ${s.agi??0} / 행운 ${s.luk??0}${itemStr}`;
      const actions=document.createElement('div'); actions.className='p-actions';
      const btnDel=document.createElement('button'); btnDel.className='btn'; btnDel.textContent='제거';
      btnDel.addEventListener('click',()=>removeParticipant(p.id));
      body.appendChild(nm); body.appendChild(st);
      wrap.appendChild(img); wrap.appendChild(body); wrap.appendChild(actions);
      actions.appendChild(btnDel);
      return wrap;
    }
    phoenix.forEach(p=>lp && lp.appendChild(nodeFor(p)));
    eaters.forEach(p=>le && le.appendChild(nodeFor(p)));
  }

  // ====== 비밀번호(OTP) 발급 ======
  async function issueSpec(){
    const id=$('#battleId')?.value?.trim(); if(!id) return UI.admin('전투 ID가 비어 있습니다');
    try{
      const r=await post(API.otp(id),{role:'spectator'});
      $('#otpResult') && ($('#otpResult').textContent=JSON.stringify(r,null,2));
      UI.admin('관전자 비밀번호 발급 완료');
    }catch(e1){
      UI.admin('관전자 비밀번호 발급 실패: '+e1.message);
    }
  }
  async function issuePlayer(){
    const id=$('#battleId')?.value?.trim(); if(!id) return UI.admin('전투 ID가 비어 있습니다');
    const count=Math.max(1,Math.min(100, Number($('#optOtpCount')?.value||1)));
    try{
      const r=await post(API.otp(id),{role:'player',count});
      $('#otpResult') && ($('#otpResult').textContent=JSON.stringify(r,null,2));
      UI.admin('전투 참가자 비밀번호 발급 완료');
    }catch(e1){
      UI.admin('전투 참가자 비밀번호 발급 실패: '+e1.message);
    }
  }

  // ====== 채팅 송신 ======
  function sendChat(){
    const msg = $('#chatInput')?.value?.trim();
    const battleId = $('#battleId')?.value?.trim();
    if (!msg) return;
    if (!socket || !socket.connected) { UI.chat('(오프라인) '+msg, '관리자'); return; }
    if (!battleId) { UI.chat('(전투 ID 없음) '+msg, '관리자'); return; }
    try{
      socket.emit('chat:send', { battleId, msg, name: '관리자' });
      $('#chatInput').value='';
    }catch(e){
      UI.admin('채팅 전송 실패: '+(e?.message||e));
    }
  }

  // ====== 이벤트 바인딩 ======
  function wire(){
    $('#btnCreate')   ?.addEventListener('click', createBattle);
    $('#btnStart')    ?.addEventListener('click', ()=>ctrlBattle('start'));
    $('#btnPause')    ?.addEventListener('click', ()=>ctrlBattle('pause'));
    $('#btnResume')   ?.addEventListener('click', ()=>ctrlBattle('resume'));
    $('#btnEnd')      ?.addEventListener('click', ()=>ctrlBattle('end'));

    $('#btnOtpSpec')  ?.addEventListener('click', issueSpec);
    $('#btnOtpPlayer')?.addEventListener('click', issuePlayer);

    $('#battleId')    ?.addEventListener('input', setLinks);

    $('#copyAdmin')   ?.addEventListener('click', ()=>copyText($('#linkAdmin')?.textContent||''));
    $('#copyPlayer')  ?.addEventListener('click', ()=>copyText($('#linkPlayer')?.textContent||''));
    $('#copySpec')    ?.addEventListener('click', ()=>copyText($('#linkSpectator')?.textContent||''));

    $('#btnUploadAvatar')?.addEventListener('click', uploadAvatar);
    $('#btnAddPlayer')   ?.addEventListener('click', addPlayer);

    $('#btnSendChat')?.addEventListener('click', sendChat);
    $('#chatInput')  ?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(); });
  }

  // ====== 초기화 ======
  (function init(){
    UI.init();
    const qb=qp.get('battle'); if(qb) $('#battleId').value=qb;
    const qt=qp.get('token')||qp.get('admin')||qp.get('t'); if(qt) $('#adminToken').value=qt;

    setLinks();
    wire();
    connectSocket();

    if($('#adminToken').value) tryAdminAuth();
    if(!$('#adminToken').value && $('#battleId').value) {
      ensureAdminToken($('#battleId').value).then(t=>{ if(t) tryAdminAuth(); });
    }
    refreshParticipants();

    UI.admin('관리자 콘솔 스크립트 로드 완료');
  })();
})();
