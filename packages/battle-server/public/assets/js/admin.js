// /public/assets/js/admin.js
// 소켓 연결 견고화: 여러 호스트/경로 조합 시도 + 재연결 + 연결 전 emit 금지 + 상세 로그
// 전투 생성/참가자 추가/채팅은 기존 동작 유지(룰/표기/디자인 변경 없음)

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
    listA: byId('listA')?.querySelector('tbody'),
    listB: byId('listB')?.querySelector('tbody'),

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

  function appendLog(msg){
    if(!els.log) return;
    const d = document.createElement('div');
    d.textContent = msg;
    els.log.appendChild(d);
    els.log.scrollTop = els.log.scrollHeight;
  }
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
  document.addEventListener('DOMContentLoaded', init);

  function init(){
    bindUI();
    connectSequence().then((ok)=>{
      if(!ok){
        appendLog('서버 연결 실패: 전투 생성 불가');
        return;
      }
      autoJoinFromURL(); // 연결 이후에 처리
    });
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

  // -------- 견고한 소켓 연결 시퀀스 --------
  async function connectSequence(){
    const origin = window.location.origin;
    const fallbacks = [
      { base: origin, path: '/socket.io'  },
      { base: origin, path: '/socket.io/' },
      { base: 'https://pyxisbattlesystem.monster', path: '/socket.io'  },
      { base: 'https://pyxisbattlesystem.monster', path: '/socket.io/' },
    ];

    appendLog('서버 연결 대기 중...');

    for(let i=0;i<fallbacks.length;i++){
      const opt = fallbacks[i];
      const ok = await tryConnect(opt.base, opt.path);
      if(ok){
        appendLog(`소켓 연결 성공: ${opt.base}${opt.path}`);
        return true;
      }else{
        appendLog(`소켓 연결 실패: ${opt.base}${opt.path}`);
      }
    }
    setConn(false);
    return false;
  }

  function tryConnect(base, path){
    return new Promise((resolve)=>{
      // 이전 소켓 정리
      try{ socket?.off(); socket?.close(); }catch(_){}
      socket = null;

      // io 옵션
      const ioOpts = {
        path,
        transports: ['websocket', 'polling'],
        withCredentials: true,
        timeout: 20000,
        reconnection: true,
        reconnectionAttempts: 12,
        reconnectionDelay: 400,
        reconnectionDelayMax: 3000,
        forceNew: true,
        query: { role: 'admin' }
      };

      // 전역 io 사용
      try{
        socket = io(base, ioOpts);
      }catch(e){
        appendLog(`소켓 생성 에러: ${e.message||e}`);
        return resolve(false);
      }

      let settled = false;
      const done = (ok)=>{ if(!settled){ settled = true; resolve(ok); } };

      socket.once('connect', ()=>{
        setConn(true);
        // 공통 리스너 등록
        bindSocketEvents();
        done(true);
      });

      socket.once('connect_error', (err)=>{
        setConn(false);
        appendLog(`connect_error: ${err?.message||err}`);
        // 여기서 바로 실패 처리하지 않고 타임아웃까지 대기(일부 환경에서 polling 전환까지 시간이 필요)
      });

      setTimeout(()=>{
        if(socket?.connected){ return; }
        done(false);
        try{ socket?.off(); socket?.close(); }catch(_){}
      }, 2500);
    });
  }

  function bindSocketEvents(){
    if(!socket) return;

    ['battleUpdate','battle:update','battleState','state:update'].forEach(ev=>{
      socket.on(ev, onBattleUpdate);
    });

    socket.on('disconnect', ()=> setConn(false));
    socket.on('battleLog', (m)=> appendLog(typeof m==='string'? m : (m?.message||JSON.stringify(m))));
    socket.on('battle:log', ({message})=> appendLog(message||''));
    socket.on('actionSuccess', (m)=> appendLog(formatActionLog('성공', m)));
    socket.on('actionError',   (m)=> appendLog(formatActionLog('오류', m)));
    socket.on('playerReady',   (m)=> appendLog(formatActionLog('준비', m)));
    socket.on('player:ready',  (m)=> appendLog(formatActionLog('준비', m)));
    socket.on('playerAction',  (m)=> appendLog(formatActionLog('행동', m)));
    socket.on('player:action', (m)=> appendLog(formatActionLog('행동', m)));

    socket.on('chatMessage', (payload)=>{
      if(typeof payload==='string'){ appendChat('플레이어', payload); }
      else { appendChat(payload?.name||payload?.senderName||'플레이어', payload?.message||''); }
    });
    socket.on('chat:message', (payload)=> appendChat(payload?.name||payload?.senderName||'플레이어', payload?.message||''));
    socket.on('battle:chat',  ({name,message})=> appendChat(name||'플레이어', message||''));    

    socket.on('battle:created', (battle)=> onBattleCreatedViaSocket(battle));
    socket.on('admin:created',  (payload)=> onBattleCreatedViaSocket(payload?.battle));
  }

  // -------- URL 파라미터 기반 자동 조인/인증 --------
  function autoJoinFromURL(){
    const p = new URLSearchParams(location.search);
    const b = p.get('battle');
    const t = p.get('token') || p.get('otp');

    if(!socket || !socket.connected) return;

    if(b){
      battleId = b;
      socket.emit('join', { battleId });
    }
    if(b && t){
      // 서버가 adminAuth를 요구하는 경우 자동 수행
      socket.emit('adminAuth', { battleId, otp: t, token: t }, (ack)=>{
        if(ack?.error){ appendLog(`adminAuth 실패: ${ack.error}`); }
        else { appendLog('adminAuth 성공'); }
      });
    }

    if(b){
      fetch(`/api/battles/${encodeURIComponent(battleId)}`, { credentials:'include' })
        .then(r=>r.ok?r.json():null)
        .then(snap=>{ if(snap){ onBattleUpdate(snap); activateControls(); }})
        .catch(()=>{});
    }
  }

  // -------- 전투 생성 --------
  function modePayload(){
    const m = (els.mode.value || '4v4').trim();
    const size = ({'1v1':1,'2v2':2,'3v3':3,'4v4':4}[m]) || 4;
    return { mode: m, size };
  }

  async function onCreateBattle(){
    if(!socket || !socket.connected){
      appendLog('서버 연결 대기 중...');
      return;
    }

    const payload = modePayload();
    appendLog(`전투 생성 요청(소켓): 모드 ${payload.mode}`);

    const ok = await createViaSocket(payload);
    if(ok){ activateControls(); toast('전투가 생성되었습니다'); return; }

    appendLog('전투 생성 실패: 소켓 응답 없음');
    alert('전투 생성 실패');
  }

  function createViaSocket(payload){
    return new Promise((resolve)=>{
      if(!socket || !socket.connected) return resolve(false);

      let settled=false;
      const done=(ok)=>{ if(!settled){ settled=true; resolve(ok); }};

      const ack = (res)=>{
        try{
          if(!res) return;
          if(res.error || res.err){
            appendLog(`전투 생성 오류(ack): ${res.error||res.err}`);
            return;
          }
          const b = res.battle || res;
          if(b && (b.id || b.battleId)){
            battleId = b.id || b.battleId;
            socket.emit('join', { battleId });
            onBattleUpdate(b);
            done(true);
          }
        }catch(_){}
      };

      try{ socket.emit('createBattle', payload, ack); }catch(_){}
      try{ socket.emit('battle:create', payload, ack); }catch(_){}
      try{ socket.emit('admin:createBattle', payload, ack); }catch(_){}
      try{ socket.emit('create:battle', payload, ack); }catch(_){}

      waitForUpdate(1500).then((u)=>{ if(u) done(true); });
      setTimeout(()=> done(false), 2200);
    });
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
    if(!socket || !socket.connected){ toast('서버 연결을 확인하세요'); return; }

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
      if(!socket) return resolve(false);
      let hit=false;
      const h = (snap)=>{ if(hit) return; if(snap?.id){ hit=true; off(); battleId=snap.id; onBattleUpdate(snap); resolve(true); } };
      const off = ()=>{ ['battleUpdate','battle:update','battleState','state:update'].forEach(ev=> socket.off(ev, h)); };
      ['battleUpdate','battle:update','battleState','state:update'].forEach(ev=> socket.on(ev, h));
      setTimeout(()=>{ if(!hit){ off(); resolve(false); } }, ms);
    });
  }

  // -------- 링크 생성 --------
  async function onGeneratePlayerLinks(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      let res = await fetch(`/api/admin/battles/${battleId}/links`, { method:'POST', credentials:'include' });
      if(!res.ok){ res = await fetch(`/api/battles/${battleId}/links`, { method:'POST', credentials:'include' }); }
      if(!res.ok) throw new Error();
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
        row.querySelector('button').addEventListener('click', ()=> navigator.clipboard.writeText(input.value).catch(()=>{}));
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
      if(!res.ok){ res = await fetch(`/api/battles/${battleId}/links`, { method:'POST', credentials:'include' }); }
      if(!res.ok) throw new Error();
      const data = await res.json();
      const otp = data?.spectatorOtp || data?.spectator?.otp || data?.otp || '';
      els.spectatorOtp.value = otp || '';
      toast('관전자 비밀번호가 발급되었습니다');
    }catch(_){
      alert('관전자 비밀번호 발급 실패');
    }
  }

  // -------- 관전자 URL 생성 --------
  async function onBuildSpectatorUrl(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    const otp = (els.spectatorOtp.value||'').trim();
    if(!otp){ toast('관전자 비밀번호 발급 후 이용하세요'); return; }

    // spectator 페이지 경로는 프로젝트 구조에 맞게 조정
    const base = makeAbsolute('/spectator.html');
    const url = `${base}?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(otp)}`;
    els.spectatorUrl.value = url;

    try{
      await navigator.clipboard.writeText(url);
      toast('관전자 URL이 복사되었습니다');
    }catch(_){
      toast('관전자 URL이 생성되었습니다');
    }
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

  // -------- 이미지 업로드: /api/upload/avatar (field=avatar 고정) --------
  async function uploadAvatar(file){
    if(!file) return '';
    const okTypes = ['image/png','image/jpeg','image/gif','image/webp'];
    if(!okTypes.includes(file.type)) throw new Error('지원하지 않는 이미지 형식');

    const fd = new FormData();
    fd.append('avatar', file, file.name);

    try{
      const r = await fetch('/api/upload/avatar', { method:'POST', body: fd, credentials:'include' });
      const text = await r.text();
      if(!r.ok){
        appendLog(`업로드 실패 /api/upload/avatar[avatar] → ${r.status} ${text}`);
        return '';
      }
      let j = {};
      try{ j = JSON.parse(text); } catch{ appendLog('업로드 응답 JSON 파싱 실패, 원문 사용 시도'); }

      const url   = j.url || j.imageUrl || j.avatarUrl || j.fileUrl;
      const path  = j.path || j.publicPath;
      const fname = j.filename || j.fileName;

      let resolved = '';
      if(url) resolved = new URL(url, window.location.origin).toString();
      else if(path) resolved = new URL(path, window.location.origin).toString();
      else if(fname) resolved = new URL(`/uploads/${fname}`, window.location.origin).toString();

      if(!resolved){
        appendLog('업로드 응답에 사용 가능한 url/path/filename이 없습니다.');
        return '';
      }
      return resolved;
    }catch(e){
      appendLog(`업로드 예외 /api/upload/avatar → ${e.message||e}`);
      return '';
    }
  }

  // -------- 참가자 추가: 소켓 전용(+ack) --------
  async function onAddPlayer(){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    if(!socket || !socket.connected){ toast('서버 연결을 확인하세요'); return; }

    const v = validateInputs();
    if(!v.ok) return;

    let avatarUrl = '';
    const file = els.pAvatar.files?.[0];
    if(file){
      const u = await uploadAvatar(file);
      if(!u) appendLog('이미지 업로드 실패(등록은 계속 진행)');
      else avatarUrl = u;
    }

    const player = {
      name: v.name,
      team: els.pTeam.value,
      hp: v.hp,
      maxHp: 100,
      stats: { attack: v.atk, defense: v.def, agility: v.agi, luck: v.luk },
      items: {
        dittany:       clampNum(safeNum(els.iDit.value,0), 0, 99),
        attack_boost:  clampNum(safeNum(els.iAtkB.value,0), 0, 99),
        defense_boost: clampNum(safeNum(els.iDefB.value,0), 0, 99),
      },
      avatar: avatarUrl
    };

    const payload = { battleId, player };

    const ok = await new Promise((resolve)=>{
      let settled=false; const done=(v)=>{ if(!settled){ settled=true; resolve(v); } };

      const ack = (res)=>{
        if(!res) return;
        if(res.error || res.err){
          appendLog(`참가자 추가 오류(ack): ${res.error||res.err}`);
          return;
        }
        const b = res.battle || null;
        if(b) onBattleUpdate(b);
        done(true);
      };

      try{ socket.emit('addPlayer', payload, ack); }catch(_){}
      try{ socket.emit('admin:addPlayer', payload, ack); }catch(_){}

      waitForUpdate(1200).then(u=>{ if(u) done(true); });
      setTimeout(async ()=>{
        if(settled) return;
        try{
          const r3 = await fetch(`/api/battles/${battleId}`, { credentials:'include' });
          if(r3.ok){
            const snap = await r3.json();
            onBattleUpdate(snap); done(true);
          }else{
            const t = await r3.text();
            appendLog(`상태 재조회 실패: ${r3.status} ${t}`);
            done(false);
          }
        }catch(e){
          appendLog(`상태 재조회 예외: ${e.message||e}`);
          done(false);
        }
      }, 2000);
    });

    if(ok) toast('참가자 추가 완료'); else appendLog('참가자 추가 실패 또는 응답 지연');
    els.pName.value=''; els.pAvatar.value=''; resetPreview();
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
    if(socket && socket.connected){
      socket.emit('chatMessage', { battleId, message: text, role:'admin', name:'관리자' });
      socket.emit('chat:send',   { battleId, message: text, role:'admin', name:'관리자' });
    }
    els.chatMsg.value='';
  }

})();
