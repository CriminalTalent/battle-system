// /public/assets/js/admin.js
// - 참가자 추가: 이미지 업로드(/api/upload) → URL을 avatar에 반영
// - 파일 선택 즉시 미리보기 표시
// - btnAdd 활성화 포함, NaN 가드, 추가 직후 즉시 갱신
(function(){
  "use strict";

  const byId = (id)=>document.getElementById(id);

  const els = {
    mode: byId('mode'),
    battleMeta: byId('battleMeta'),
    connDot: byId('connDot'),

    // 컨트롤
    btnCreate: byId('btnCreate'),
    btnStart: byId('btnStart'),
    btnPause: byId('btnPause'),
    btnResume: byId('btnResume'),
    btnEnd: byId('btnEnd'),

    // 링크
    btnGenPlayer: byId('btnGenPlayer'),
    playerLinks: byId('playerLinks'),
    spectatorOtp: byId('spectatorOtp'),
    spectatorUrl: byId('spectatorUrl'),
    btnGenSpectator: byId('btnGenSpectator'),
    btnBuildSpectator: byId('btnBuildSpectator'),

    // 참가자 추가
    pName: byId('pName'),
    pTeam: byId('pTeam'),
    pHp: byId('pHp'),
    sAtk: byId('sAtk'), sDef: byId('sDef'), sLuk: byId('sLuk'), sAgi: byId('sAgi'),
    iDit: byId('iDit'), iAtkB: byId('iAtkB'), iDefB: byId('iDefB'),
    pAvatar: byId('pAvatar'),
    preview: byId('preview'),
    btnAdd: byId('btnAdd'),

    // 테이블
    listA: byId('listA').querySelector('tbody'),
    listB: byId('listB').querySelector('tbody'),

    // 로그/채팅
    log: byId('log'),
    chat: byId('chat'),
    chatMsg: byId('chatMsg'),
    btnSend: byId('btnSend'),

    // 토스트
    toast: byId('toast'),
  };

  let socket = null;
  let API = ''; // same-origin
  let battleId = null;
  let lastSnap = null;

  const safeNum = (v, d=0)=>{ const n=Number(v); return Number.isNaN(n)?d:n; };
  const clampNum = (n, min, max)=> Math.max(min, Math.min(max, n));
  const toast = (msg)=>{ if(!els.toast) return; els.toast.textContent=msg; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'),1600); };
  async function copyToClipboard(text){ try{ await navigator.clipboard.writeText(text); toast('복사 완료'); }catch{ toast('복사 실패'); } }
  const makeAbsolute = (p)=> new URL(p, window.location.origin).toString();
  const escapeHtml = (s)=> String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));

  function setConn(on){ els.connDot?.classList.toggle('ok', !!on); }

  function setCtrlEnabled(on){
    [els.btnCreate, els.btnStart, els.btnPause, els.btnResume, els.btnEnd, els.btnGenPlayer, els.btnBuildSpectator, els.btnGenSpectator, els.btnSend, els.btnAdd]
      .forEach(b=>{ if(b) b.disabled=!on; });
  }

  function renderBattleMeta(snap){
    if(!els.battleMeta) return;
    if(!snap){ els.battleMeta.textContent='대기 중'; return; }
    const st = snap.status||'waiting';
    const mode = snap.mode||'-';
    els.battleMeta.textContent = `상태 ${st} · 모드 ${mode} · ID ${snap.id||'-'}`;
  }

  function init(){
    bindUI();
    connect();
  }

  function bindUI(){
    els.btnCreate.addEventListener('click', onCreateBattle);
    els.btnStart.addEventListener('click',  ()=> adminAction('start'));
    els.btnPause.addEventListener('click',  ()=> adminAction('pause'));
    els.btnResume.addEventListener('click', ()=> adminAction('resume'));
    els.btnEnd.addEventListener('click',    ()=> adminAction('end'));

    els.btnGenPlayer.addEventListener('click', onGeneratePlayerLinks);
    els.btnGenSpectator.addEventListener('click', onGenerateSpectatorOtp);
    els.btnBuildSpectator.addEventListener('click', onBuildSpectatorUrl);

    els.btnAdd.addEventListener('click', onAddPlayer);

    els.btnSend.addEventListener('click', sendChat);
    els.chatMsg.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });

    // 파일 선택 시 미리보기
    els.pAvatar.addEventListener('change', onPreviewAvatar);
  }

  function connect(){
    socket = io(window.location.origin, { path:'/socket.io', transports:['websocket','polling'], withCredentials:true, timeout:20000 });
    socket.on('connect', ()=> setConn(true));
    socket.on('disconnect', ()=> setConn(false));

    // 상태 업데이트(신/구 호환)
    socket.on('battleUpdate', onBattleUpdate);
    socket.on('battle:update', onBattleUpdate);

    // 로그/채팅
    socket.on('battle:log', ({message})=> appendLog(message||''));
    socket.on('battle:chat', ({name, message})=> appendChat(name||'전투 참가자', message||''));
  }

  // ---------- 전투 컨트롤 ----------
  async function onCreateBattle(){
    try{
      const mode = els.mode.value || '4v4';
      const res = await fetch(`${API}/api/battles`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ mode })
      });
      if(!res.ok) throw new Error('전투 생성 실패');
      const battle = await res.json();
      battleId = battle?.id || battle?.battleId || null;
      toast('전투가 생성되었습니다');

      socket.emit('join', { battleId });

      onBattleUpdate(battle);
      setCtrlEnabled(true);
      els.btnStart.disabled = false;
      els.btnAdd.disabled = false;
      els.btnGenPlayer.disabled = false;
      els.btnGenSpectator.disabled = false;
      els.btnBuildSpectator.disabled = false;
    }catch(e){
      alert(e.message||'전투 생성 실패');
    }
  }

  function adminAction(kind){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    if(kind==='start'){  socket.emit('startBattle', { battleId });  socket.emit('battle:start',  { battleId }); }
    if(kind==='pause'){  socket.emit('pauseBattle', { battleId });  socket.emit('battle:pause',  { battleId }); }
    if(kind==='resume'){ socket.emit('resumeBattle',{ battleId });  socket.emit('battle:resume', { battleId }); }
    if(kind==='end'){    socket.emit('endBattle',   { battleId });  socket.emit('battle:end',    { battleId }); }
  }

  function onBattleUpdate(snap){
    if(!snap) return;
    lastSnap = snap;
    battleId = snap.id || battleId;

    renderBattleMeta(snap);

    const st = snap.status || 'waiting';
    els.btnStart.disabled  = !(st==='waiting' || st==='paused');
    els.btnPause.disabled  = !(st==='active');
    els.btnResume.disabled = !(st==='paused');
    els.btnEnd.disabled    = (st==='ended');

    const linkEnabled = !!battleId && st!=='ended';
    els.btnGenPlayer.disabled = !linkEnabled;
    els.btnGenSpectator.disabled = !linkEnabled;
    els.btnBuildSpectator.disabled = !linkEnabled;
    els.btnAdd.disabled = !linkEnabled;

    renderLists(snap);
  }

  // ---------- 링크 ----------
  async function onGeneratePlayerLinks(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      const res = await fetch(`${API}/api/admin/battles/${battleId}/links`, { method:'POST' });
      if(!res.ok) throw new Error('링크 생성 실패');
      const data = await res.json();
      const links = data?.playerLinks || data?.links || [];

      els.playerLinks.innerHTML='';
      links.forEach((ln, idx)=>{
        const row = document.createElement('div');
        row.className = 'link-row';
        row.innerHTML = `
          <div class="label">${idx+1}</div>
          <input type="text" value="${ln.url||''}" readonly/>
          <button class="btn">복사</button>
        `;
        const input = row.querySelector('input');
        row.querySelector('button').addEventListener('click', ()=> copyToClipboard(input.value));
        els.playerLinks.appendChild(row);
      });

      toast('참여자 링크가 생성되었습니다');
    }catch(e){
      alert(e.message||'링크 생성 실패');
    }
  }

  async function onGenerateSpectatorOtp(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      const res = await fetch(`${API}/api/admin/battles/${battleId}/links`, { method:'POST' });
      if(!res.ok) throw new Error('관전자 비밀번호 발급 실패');
      const data = await res.json();
      const otp = data?.spectatorOtp || data?.spectator?.otp || data?.otp || '';
      els.spectatorOtp.value = otp || '';
      toast('관전자 비밀번호가 발급되었습니다');
    }catch(e){
      alert(e.message||'관전자 비밀번호 발급 실패');
    }
  }

  function onBuildSpectatorUrl(){
    if(!battleId || !els.spectatorOtp.value){ toast('전투 ID/비밀번호를 확인하세요'); return; }
    const url = makeAbsolute(`/watch?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(els.spectatorOtp.value)}`);
    els.spectatorUrl.value = url;
    toast('관전자 링크가 생성되었습니다');
  }

  // ---------- 참가자 추가 ----------
  async function onAddPlayer(){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    try{
      // 1) 파일 업로드(선택)
      let avatarUrl = '';
      const file = els.pAvatar.files?.[0];
      if(file){
        const fd = new FormData();
        fd.append('file', file);
        // 서버 라우터 표준: POST /api/upload -> { url } 또는 { path }
        const up = await fetch(`${API}/api/upload`, { method:'POST', body: fd });
        if(up.ok){
          const j = await up.json();
          avatarUrl = j.url || j.path || '';
        }else{
          toast('이미지 업로드 실패(계속 진행합니다)');
        }
      }

      // 2) 본문 구성
      const body = {
        name: (els.pName.value||'').trim(),
        team: els.pTeam.value,
        hp: clampNum(safeNum(els.pHp.value,100), 1, 100),
        stats:{
          attack:  clampNum(safeNum(els.sAtk.value,3), 1, 5),
          defense: clampNum(safeNum(els.sDef.value,3), 1, 5),
          luck:    clampNum(safeNum(els.sLuk.value,2), 1, 5),
          agility: clampNum(safeNum(els.sAgi.value,3), 1, 5),
        },
        items:{
          dittany:       clampNum(safeNum(els.iDit.value,0), 0, 99),
          attack_boost:  clampNum(safeNum(els.iAtkB.value,0), 0, 99),
          defense_boost: clampNum(safeNum(els.iDefB.value,0), 0, 99),
        },
        avatar: avatarUrl
      };
      if(!body.name){ toast('이름을 입력하세요'); return; }

      // 3) 등록
      const res = await fetch(`${API}/api/battles/${battleId}/players`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
      });
      if(!res.ok) throw new Error('참가자 추가 실패');
      const data = await res.json();

      toast('참가자 추가 완료');

      // 4) 즉시 갱신(브로드캐스트 지연 대비)
      if(data?.battle){
        onBattleUpdate(data.battle);
      }else{
        try{
          const r2 = await fetch(`${API}/api/battles/${battleId}`);
          if(r2.ok){ const snap = await r2.json(); onBattleUpdate(snap); }
        }catch(_){}
      }

      // 5) 입력 초기화
      els.pName.value='';
      els.pAvatar.value='';
      resetPreview();

    }catch(e){
      alert(e.message||'참가자 추가 실패');
    }
  }

  // ---------- 미리보기 ----------
  function onPreviewAvatar(){
    const file = els.pAvatar.files?.[0];
    if(!file){ resetPreview(); return; }
    const okTypes = ['image/png','image/jpeg','image/gif','image/webp'];
    if(!okTypes.includes(file.type)){ toast('지원하지 않는 이미지 형식'); els.pAvatar.value=''; resetPreview(); return; }
    const r = new FileReader();
    r.onload = ()=>{ els.preview.style.backgroundImage = `url('${r.result}')`; els.preview.textContent=''; };
    r.readAsDataURL(file);
  }
  function resetPreview(){
    els.preview.style.backgroundImage = 'none';
    els.preview.textContent = '미리보기';
  }

  // ---------- 테이블 ----------
  function renderLists(snap){
    if(!snap) return;
    const players = snap.players || [];
    const A = players.filter(p=> toAB(p.team)==='A');
    const B = players.filter(p=> toAB(p.team)==='B');

    const drawRow = (p)=>{
      const maxHp = p.maxHp ?? 100;
      const st = p.stats || {};
      const it = p.items || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.name||'-')}</td>
        <td>${p.hp}/${maxHp}</td>
        <td>공 ${st.attack ?? '-'} · 방 ${st.defense ?? '-'} · 민 ${st.agility ?? '-'} · 운 ${st.luck ?? '-'}</td>
        <td>디터니 ${it.dittany ?? 0} · 공보 ${it.attack_boost ?? 0} · 방보 ${it.defense_boost ?? 0}</td>
        <td>${p.ready ? '준비' : '-'}</td>
      `;
      return tr;
    };

    els.listA.innerHTML=''; A.forEach(p=> els.listA.appendChild(drawRow(p)));
    els.listB.innerHTML=''; B.forEach(p=> els.listB.appendChild(drawRow(p)));
  }

  function toAB(team){
    const s = String(team||'').toLowerCase();
    if(s==='phoenix'||s==='a') return 'A';
    if(s==='eaters' ||s==='b'||s==='death') return 'B';
    return '-';
  }

  // ---------- 로그/채팅 ----------
  function appendLog(msg){
    const d = document.createElement('div');
    d.textContent = msg;
    els.log.appendChild(d);
    els.log.scrollTop = els.log.scrollHeight;
  }
  function appendChat(sender, text){
    const d = document.createElement('div');
    d.textContent = `${sender}: ${text}`;
    els.chat.appendChild(d);
    els.chat.scrollTop = els.chat.scrollHeight;
  }
  function sendChat(){
    const text = (els.chatMsg.value||'').trim();
    if(!text || !battleId) return;
    socket.emit('chatMessage', { battleId, message: text });
    socket.emit('chat:send', { battleId, name: '관리자', message: text, role:'admin' });
    els.chatMsg.value='';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
