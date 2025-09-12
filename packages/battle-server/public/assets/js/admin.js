// /public/assets/js/admin.js
// 참여자 추가가 서버 스키마와 달라도 붙도록(필드/형태/엔드포인트 폴백), 업로드 중복로그 억제, 실패 사유 노출 강화
(function(){
  "use strict";

  const byId = (id)=>document.getElementById(id);

  const els = {
    mode: byId('mode'),
    battleMeta: byId('battleMeta'),
    connDot: byId('connDot'),

    // 컨트롤
    btnCreate: byId('btnCreate'),
    btnStart:  byId('btnStart'),
    btnPause:  byId('btnPause'),
    btnResume: byId('btnResume'),
    btnEnd:    byId('btnEnd'),

    // 링크
    btnGenPlayer: byId('btnGenPlayer'),
    playerLinks:  byId('playerLinks'),
    spectatorOtp: byId('spectatorOtp'),
    spectatorUrl: byId('spectatorUrl'),
    btnGenSpectator:  byId('btnGenSpectator'),
    btnBuildSpectator: byId('btnBuildSpectator'),

    // 참가자 추가
    pName: byId('pName'),
    pTeam: byId('pTeam'),
    pHp:   byId('pHp'),
    sAtk:  byId('sAtk'),
    sDef:  byId('sDef'),
    sLuk:  byId('sLuk'),
    sAgi:  byId('sAgi'),
    iDit:  byId('iDit'),
    iAtkB: byId('iAtkB'),
    iDefB: byId('iDefB'),
    pAvatar: byId('pAvatar'),
    preview: byId('preview'),
    btnAdd:  byId('btnAdd'),

    // 테이블
    listA: byId('listA').querySelector('tbody'),
    listB: byId('listB').querySelector('tbody'),

    // 로그/채팅
    log: byId('log'),
    chat: byId('chat'),
    chatMsg: byId('chatMsg'),
    btnSend: byId('btnSend'),

    toast: byId('toast'),
  };

  let socket = null;
  let battleId = null;
  let lastSnap = null;

  // -------- 유틸 --------
  const safeNum = (v, d=0)=>{ const n=Number(v); return Number.isNaN(n)?d:n; };
  const clampNum = (n, min, max)=> Math.max(min, Math.min(max, n));
  const escapeHtml = (s)=> String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));
  const toast = (msg)=>{ if(!els.toast) return; els.toast.textContent=msg; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'),1600); };
  const makeAbsolute = (p)=> new URL(p, window.location.origin).toString();
  async function copyToClipboard(text){ try{ await navigator.clipboard.writeText(text); toast('복사 완료'); } catch{ toast('복사 실패'); } }

  function setConn(on){ els.connDot?.classList.toggle('ok', !!on); }
  function setCtrlEnabled(on){
    [els.btnCreate, els.btnStart, els.btnPause, els.btnResume, els.btnEnd,
     els.btnGenPlayer, els.btnBuildSpectator, els.btnGenSpectator,
     els.btnSend, els.btnAdd].forEach(b=>{ if(b) b.disabled=!on; });
  }

  function renderBattleMeta(snap){
    if(!els.battleMeta) return;
    if(!snap){ els.battleMeta.textContent='대기 중'; return; }
    const st = snap.status || 'waiting';
    const mode = snap.mode || '-';
    els.battleMeta.textContent = `상태 ${st} · 모드 ${mode} · ID ${snap.id||'-'}`;
  }

  // -------- 초기화 --------
  function init(){
    bindUI();
    connect();
    autoJoinFromURL();
  }

  function bindUI(){
    els.btnCreate.addEventListener('click', onCreateBattle);
    els.btnStart .addEventListener('click', ()=> adminAction('start'));
    els.btnPause .addEventListener('click', ()=> adminAction('pause'));
    els.btnResume.addEventListener('click', ()=> adminAction('resume'));
    els.btnEnd   .addEventListener('click', ()=> adminAction('end'));

    els.btnGenPlayer.addEventListener('click', onGeneratePlayerLinks);
    els.btnGenSpectator.addEventListener('click', onGenerateSpectatorOtp);
    els.btnBuildSpectator.addEventListener('click', onBuildSpectatorUrl);

    els.btnAdd.addEventListener('click', onAddPlayer);
    els.pAvatar.addEventListener('change', onPreviewAvatar);

    els.btnSend.addEventListener('click', sendChat);
    els.chatMsg.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
  }

  function connect(){
    socket = io(window.location.origin, { path:'/socket.io', transports:['websocket','polling'], withCredentials:true, timeout:20000 });
    socket.on('connect', ()=> setConn(true));
    socket.on('disconnect', ()=> setConn(false));

    // 상태 업데이트(신/구 호환)
    ['battleUpdate','battle:update','battleState','state:update'].forEach(ev=>{
      socket.on(ev, onBattleUpdate);
    });

    // 로그 수신(여러 네임스페이스 호환)
    socket.on('battleLog', (m)=> appendLog(typeof m==='string'? m : (m?.message||JSON.stringify(m))));
    socket.on('battle:log', ({message})=> appendLog(message||''));
    socket.on('actionSuccess', (m)=> appendLog(formatActionLog('성공', m)));
    socket.on('actionError',   (m)=> appendLog(formatActionLog('오류', m)));
    socket.on('playerReady',   (m)=> appendLog(formatActionLog('준비', m)));
    socket.on('player:ready',  (m)=> appendLog(formatActionLog('준비', m)));
    socket.on('playerAction',  (m)=> appendLog(formatActionLog('행동', m)));
    socket.on('player:action', (m)=> appendLog(formatActionLog('행동', m)));

    // 채팅 수신(여러 네임스페이스 호환)
    socket.on('chatMessage', (payload)=>{
      if(typeof payload==='string'){ appendChat('플레이어', payload); }
      else { appendChat(payload?.name||payload?.senderName||'플레이어', payload?.message||''); }
    });
    socket.on('chat:message', (payload)=> appendChat(payload?.name||payload?.senderName||'플레이어', payload?.message||''));
    socket.on('battle:chat',  ({name,message})=> appendChat(name||'플레이어', message||''));

    // 생성 알림 호환
    socket.on('battle:created', (battle)=> onBattleCreatedViaSocket(battle));
    socket.on('admin:created',  (payload)=> onBattleCreatedViaSocket(payload?.battle));
  }

  function onBattleCreatedViaSocket(battle){
    if(!battle) return;
    battleId = battle.id || battle.battleId || battleId;
    appendLog('전투 생성 완료(소켓)');
    socket.emit('join', { battleId });
    onBattleUpdate(battle);
    activateControls();
  }

  function autoJoinFromURL(){
    const p = new URLSearchParams(location.search);
    const b = p.get('battle');
    const t = p.get('token') || p.get('otp');
    if(b){
      battleId = b;
      socket.emit('join', { battleId });
      if(t){ socket.emit('adminAuth', { battleId, otp: t, token: t }); }
      fetch(`/api/battles/${encodeURIComponent(battleId)}`, { credentials:'include' })
        .then(r=>r.ok?r.json():null)
        .then(snap=>{ if(snap){ onBattleUpdate(snap); activateControls(); }})
        .catch(()=>{});
    }
  }

  // -------- 전투 생성/제어 --------
  async function onCreateBattle(){
    const mode = els.mode.value || '4v4';

    // 1) 소켓 우선(신/구 이벤트 동시 발사)
    try{
      socket.emit('createBattle', { mode });
      socket.emit('battle:create', { mode });
      appendLog(`전투 생성 요청(소켓): 모드 ${mode}`);
      const ok = await waitForUpdate(1800);
      if(ok){ activateControls(); toast('전투가 생성되었습니다'); return; }
    }catch(_){}

    // 2) REST 폴백: /api/admin/battles → /api/battles
    const headers = { 'Content-Type': 'application/json', 'Accept':'application/json' };
    const payload = { mode };

    try{
      const r1 = await fetch(`/api/admin/battles`, { method:'POST', headers, body: JSON.stringify(payload), credentials:'include' });
      if(r1.ok){
        const battle = await r1.json();
        battleId = battle?.id || battle?.battleId || battleId;
        socket.emit('join', { battleId });
        onBattleUpdate(battle);
        activateControls(); toast('전투가 생성되었습니다');
        return;
      }else{
        const t = await r1.text(); appendLog(`전투 생성 실패 /api/admin/battles: ${r1.status} ${t}`);
      }
    }catch(e){ appendLog(`전투 생성 예외 /api/admin/battles: ${e.message||e}`); }

    try{
      const r2 = await fetch(`/api/battles`, { method:'POST', headers, body: JSON.stringify(payload), credentials:'include' });
      if(!r2.ok){
        const t = await r2.text(); appendLog(`전투 생성 실패 /api/battles: ${r2.status} ${t}`);
        throw new Error('REST 생성 실패');
      }
      const battle = await r2.json();
      battleId = battle?.id || battle?.battleId || battleId;
      socket.emit('join', { battleId });
      onBattleUpdate(battle);
      activateControls(); toast('전투가 생성되었습니다');
      return;
    }catch(e){
      appendLog('전투 생성 실패: 소켓/REST 모두 실패');
      alert('전투 생성 실패');
    }
  }

  function activateControls(){
    setCtrlEnabled(true);
    els.btnStart.disabled = false;
    els.btnAdd.disabled = false;
    els.btnGenPlayer.disabled = false;
    els.btnGenSpectator.disabled = false;
    els.btnBuildSpectator.disabled = false;
  }

  function adminAction(kind){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    if(kind==='start'){  socket.emit('startBattle', { battleId });  socket.emit('battle:start',  { battleId }); appendLog('전투 시작 요청'); }
    if(kind==='pause'){  socket.emit('pauseBattle', { battleId });  socket.emit('battle:pause',  { battleId }); appendLog('전투 일시정지 요청'); }
    if(kind==='resume'){ socket.emit('resumeBattle',{ battleId });  socket.emit('battle:resume', { battleId }); appendLog('전투 재개 요청'); }
    if(kind==='end'){    socket.emit('endBattle',   { battleId });  socket.emit('battle:end',    { battleId }); appendLog('전투 종료 요청'); }
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

  function waitForUpdate(ms){
    return new Promise((resolve)=>{
      let hit=false;
      const h = (snap)=>{ if(hit) return; if(snap?.id){ hit=true; off(); battleId=snap.id; onBattleUpdate(snap); resolve(true); } };
      const off = ()=>{ ['battleUpdate','battle:update'].forEach(ev=> socket.off(ev, h)); };
      ['battleUpdate','battle:update'].forEach(ev=> socket.on(ev, h));
      setTimeout(()=>{ if(!hit){ off(); resolve(false); } }, ms);
    });
  }

  // -------- 링크 생성 --------
  async function onGeneratePlayerLinks(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      let res = await fetch(`/api/admin/battles/${battleId}/links`, { method:'POST', credentials:'include' });
      if(!res.ok){
        const t = await res.text(); appendLog(`링크 생성 실패 /api/admin/battles/: ${res.status} ${t}`);
        res = await fetch(`/api/battles/${battleId}/links`, { method:'POST', credentials:'include' });
      }
      if(!res.ok){
        const t = await res.text(); appendLog(`링크 생성 실패 /api/battles/: ${res.status} ${t}`);
        throw new Error();
      }
      const data = await res.json();
      const links = data?.playerLinks || data?.links || [];

      els.playerLinks.innerHTML='';
      links.forEach((ln, idx)=>{
        const row = document.createElement('div');
        row.className='link-row';
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
    }catch(_){
      alert('링크 생성 실패');
    }
  }

  async function onGenerateSpectatorOtp(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      let res = await fetch(`/api/admin/battles/${battleId}/links`, { method:'POST', credentials:'include' });
      if(!res.ok){
        const t = await res.text(); appendLog(`관전자 비밀번호 실패 /api/admin/battles/: ${res.status} ${t}`);
        res = await fetch(`/api/battles/${battleId}/links`, { method:'POST', credentials:'include' });
      }
      if(!res.ok){
        const t = await res.text(); appendLog(`관전자 비밀번호 실패 /api/battles/: ${res.status} ${t}`);
        throw new Error();
      }
      const data = await res.json();
      const otp = data?.spectatorOtp || data?.spectator?.otp || data?.otp || '';
      els.spectatorOtp.value = otp || '';
      toast('관전자 비밀번호가 발급되었습니다');
    }catch(_){
      alert('관전자 비밀번호 발급 실패');
    }
  }

  function onBuildSpectatorUrl(){
    if(!battleId || !els.spectatorOtp.value){ toast('전투 ID/비밀번호를 확인하세요'); return; }
    const url = makeAbsolute(`/watch?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(els.spectatorOtp.value)}`);
    els.spectatorUrl.value = url;
    toast('관전자 링크가 생성되었습니다');
  }

  // -------- 입력 유효성 --------
  function validateInputs(){
    const name = (els.pName.value||'').trim();
    if(!name){ toast('이름을 입력하세요'); els.pName.focus(); return { ok:false }; }

    const hp = clampNum(safeNum(els.pHp.value,100), 1, 100);
    const atk = clampNum(safeNum(els.sAtk.value,3), 1, 5);
    const def = clampNum(safeNum(els.sDef.value,3), 1, 5);
    const luk = clampNum(safeNum(els.sLuk.value,2), 1, 5);
    const agi = clampNum(safeNum(els.sAgi.value,3), 1, 5);

    return { ok:true, name, hp, atk, def, luk, agi };
  }

  // -------- 이미지 업로드(견고) --------
  let uploadLoggedOnce = false;
  async function uploadAvatar(file){
    if(!file) return '';
    const okTypes = ['image/png','image/jpeg','image/gif','image/webp'];
    if(!okTypes.includes(file.type)) throw new Error('지원하지 않는 이미지 형식');

    const tryList = [
      ['/api/upload','file'], ['/api/upload','image'], ['/api/upload','avatar'],
      ['/api/upload/avatar','file'], ['/api/upload/avatar','image'], ['/api/upload/avatar','avatar']
    ];
    for(const [endpoint, field] of tryList){
      const url = await tryUpload(endpoint, field, file);
      if(url) return url;
    }
    if(!uploadLoggedOnce){ appendLog('이미지 업로드 실패(등록은 계속 진행)'); uploadLoggedOnce = true; }
    return '';
  }

  async function tryUpload(endpoint, field, file){
    try{
      const fd = new FormData();
      fd.append(field, file, file.name);
      const r = await fetch(endpoint, { method:'POST', body: fd, credentials:'include' });
      if(!r.ok){
        const t = await r.text();
        if(!uploadLoggedOnce) appendLog(`업로드 실패 ${endpoint}[${field}] → ${r.status} ${t}`);
        return '';
      }
      const j = await r.json().catch(()=> ({}));
      const url = j.url || j.path || j.location || '';
      if(!url){
        if(!uploadLoggedOnce) appendLog(`업로드 응답에 url이 없습니다: ${endpoint}[${field}]`);
      }
      return url;
    }catch(e){
      if(!uploadLoggedOnce) appendLog(`업로드 예외 ${endpoint}[${field}] → ${e.message||e}`);
      return '';
    }
  }

  // -------- 참가자 추가 --------
  async function onAddPlayer(){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    const v = validateInputs();
    if(!v.ok) return;

    try{
      // 1) 이미지 업로드(선택)
      let avatarUrl = '';
      const file = els.pAvatar.files?.[0];
      if(file){
        uploadLoggedOnce = false;
        avatarUrl = await uploadAvatar(file);
      }

      // 2) 본문 구성(서버 호환 필드 동시 제공)
      const base = {
        // 이름 alias
        name: v.name,
        characterName: v.name,
        character: v.name,
        playerName: v.name,
        nickname: v.name,
        // 팀 alias
        team: els.pTeam.value, // 'phoenix' | 'eaters'
        side: els.pTeam.value,
        teamCode: (String(els.pTeam.value).toLowerCase()==='phoenix'?'A':'B'),
        teamId:   (String(els.pTeam.value).toLowerCase()==='phoenix'?'A':'B'),
        // 체력
        hp: v.hp,
        maxHp: 100,
        // 스탯
        stats:{
          attack:  v.atk,
          defense: v.def,
          luck:    v.luk,
          agility: v.agi,
        },
        // 아이템
        items:{
          dittany:       clampNum(safeNum(els.iDit.value,0), 0, 99),
          attack_boost:  clampNum(safeNum(els.iAtkB.value,0), 0, 99),
          defense_boost: clampNum(safeNum(els.iDefB.value,0), 0, 99),
        },
        avatar: avatarUrl
      };

      // 3) 소켓 알림(있으면 처리)
      socket.emit('addPlayer',       { battleId, player: base });
      socket.emit('admin:addPlayer', { battleId, player: base });
      socket.emit('player:add',      { battleId, player: base });

      // 4) REST 시퀀스: 4단계 폴백 × 2형태
      const headers = { 'Content-Type': 'application/json', 'Accept':'application/json' };
      const seq = [
        [`/api/battles/${battleId}/players`, base],
        [`/api/battles/${battleId}/players`, { player: base }],
        [`/api/admin/battles/${battleId}/players`, base],
        [`/api/admin/battles/${battleId}/players`, { player: base }],
      ];

      let restOk = false, lastErr = '';
      for(const [url, payload] of seq){
        try{
          const r = await fetch(url, { method:'POST', headers, credentials:'include', body: JSON.stringify(payload) });
          if(r.ok){
            const data = await r.json().catch(()=>null);
            if(data?.battle) onBattleUpdate(data.battle);
            restOk = true;
            break;
          }else{
            const t = await r.text();
            lastErr = `${url} → ${r.status} ${t}`;
            appendLog(`참가자 추가 실패: ${lastErr}`);
            // 이름 오류 문구를 그대로 보여주기
            if(String(t).includes('이름') || String(t).includes('name')){
              toast(t.trim());
            }
          }
        }catch(e){
          lastErr = `${url} 예외 → ${e.message||e}`;
          appendLog(lastErr);
        }
      }

      // 5) 소켓 브로드캐스트 대기 + 강제 스냅샷 재조회
      const got = await waitForUpdate(1200);
      if(!(restOk || got)){
        try{
          const r3 = await fetch(`/api/battles/${battleId}`, { credentials:'include' });
          if(r3.ok){
            const snap = await r3.json();
            onBattleUpdate(snap);
          }else{
            const t = await r3.text();
            appendLog(`상태 재조회 실패: ${r3.status} ${t}`);
          }
        }catch(e){
          appendLog(`상태 재조회 예외: ${e.message||e}`);
        }
      }

      if(restOk || got) toast('참가자 추가 완료');
      else {
        appendLog('참가자 추가 요청은 전송되었으나 응답이 지연됩니다');
        if(lastErr) toast('추가 실패: ' + lastErr);
      }

      // 입력 초기화
      els.pName.value=''; els.pAvatar.value=''; resetPreview();

    }catch(e){
      alert('참가자 추가 실패');
    }
  }

  // -------- 미리보기 --------
  function onPreviewAvatar(){
    const file = els.pAvatar.files?.[0];
    if(!file){ resetPreview(); return; }
    const okTypes = ['image/png','image/jpeg','image/gif','image/webp'];
    if(!okTypes.includes(file.type)){ toast('지원하지 않는 이미지 형식'); els.pAvatar.value=''; resetPreview(); return; }
    const r = new FileReader();
    r.onload = ()=>{ els.preview.style.backgroundImage = `url('${r.result}')`; els.preview.textContent=''; };
    r.readAsDataURL(file);
  }
  function resetPreview(){ els.preview.style.backgroundImage='none'; els.preview.textContent='미리보기'; }

  // -------- 테이블 --------
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
        <td>${escapeHtml(p.name||p.characterName||p.playerName||p.nickname||'-')}</td>
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

  // -------- 로그/채팅 --------
  function appendLog(msg){
    const d = document.createElement('div');
    d.textContent = msg;
    els.log.appendChild(d);
    els.log.scrollTop = els.log.scrollHeight;
  }
  function formatActionLog(type, payload){
    try{
      const p = payload || {};
      const n = p.name || p.player?.name || p.senderName || '';
      const a = p.action || p.type || '';
      return `[${type}] ${n} ${a ? `- ${a}`:''}`;
    }catch(_){ return `[${type}]`; }
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
    socket.emit('chatMessage', { battleId, message: text, role:'admin', name:'관리자' });
    socket.emit('chat:send',   { battleId, message: text, role:'admin', name:'관리자' });
    els.chatMsg.value='';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
