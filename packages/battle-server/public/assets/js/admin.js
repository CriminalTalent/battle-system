/* PYXIS Admin – 이미지 필드 표기/팀 구성, 참여자 추가 호환(서버 스키마 유지) */
(function(){
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // Elements
  const battleMode = $('#battleMode');
  const btnCreateBattle = $('#btnCreateBattle');
  const battleIdEl = $('#battleId');

  const btnStart = $('#btnStart');
  const btnPause = $('#btnPause');
  const btnResume = $('#btnResume');
  const btnEnd = $('#btnEnd');

  const playerOtpEl = $('#playerOtp');
  const spectatorOtpEl = $('#spectatorOtp');
  const btnGenPlayerOtp = $('#btnGenPlayerOtp');
  const btnGenSpectatorOtp = $('#btnGenSpectatorOtp');

  const adminUrlEl = $('#adminUrl');
  const playerUrlEl = $('#playerUrl');
  const spectatorUrlEl = $('#spectatorUrl');

  const pName = $('#pName');
  const pTeam = $('#pTeam');

  const pAvatar = $('#pAvatar');
  const pAvatarPreview = $('#pAvatarPreview');
  const pAvatarMeta = $('#pAvatarMeta');

  const sATK = $('#sATK');
  const sDEF = $('#sDEF');
  const sDEX = $('#sDEX');
  const sLUK = $('#sLUK');
  const pHP  = $('#pHP');

  const itemDeterni = $('#itemDeterni');
  const itemAtkBoost = $('#itemAtkBoost');
  const itemDefBoost = $('#itemDefBoost');

  const btnAddPlayer = $('#btnAddPlayer');
  const addPlayerMsg = $('#addPlayerMsg');

  const rosterPhoenix = $('#rosterPhoenix');
  const rosterDE = $('#rosterDE');

  const battleLog = $('#battleLog');
  const chatView = $('#chatView');
  const chatText = $('#chatText');
  const btnChatSend = $('#btnChatSend');

  const statusPill = $('#statusPill');
  const toast = $('#toast');

  const spectatorCountEl = $('#spectatorCount');
  const spectatorCapEl = $('#spectatorCap');

  // State
  let socket = null;
  let currentBattleId = null;
  let playerOtp = '';
  let spectatorOtp = '';
  const SPECTATOR_CAP = 30;
  let spectatorConnected = 0;
  let spectatorIssuedLocal = 0;

  // avatar buffer
  let avatarDataUrl = '';
  let avatarMime = '';
  let avatarName = '';

  // Utils
  const origin = () => window.location.origin;
  const clamp = (v, min, max) => { v = Number(v); if(Number.isNaN(v)) return min; return Math.max(min, Math.min(max, v)); };
  function toastMsg(text, timeout=1600){ if(!toast) return; toast.textContent = text; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), timeout); }
  function linkFor(pathname, params){ const u = new URL(origin()+pathname); Object.entries(params||{}).forEach(([k,v])=>{ if(v!=null&&v!=='') u.searchParams.set(k,v); }); return u.toString(); }
  function refreshAllLinks(){ if(!currentBattleId) return; adminUrlEl.value = linkFor('/admin',{battle:currentBattleId}); playerUrlEl.value = linkFor('/play',{battle:currentBattleId,otp:playerOtp||''}); spectatorUrlEl.value = linkFor('/spectator',{battle:currentBattleId,otp:spectatorOtp||''}); }
  function copyBySelector(sel){ const el = document.querySelector(sel); if(!el) return; el.select(); el.setSelectionRange(0, el.value.length); document.execCommand('copy'); const btn = document.querySelector(`[data-copy="${sel}"]`); if(btn){ btn.classList.add('copied'); setTimeout(()=>btn.classList.remove('copied'), 900); } toastMsg('복사되었습니다'); }
  function logLine(text){ if(!battleLog) return; const ts = new Date().toLocaleTimeString(); const div = document.createElement('div'); div.textContent = `[${ts}] ${text}`; battleLog.appendChild(div); battleLog.scrollTop = battleLog.scrollHeight; }

  // ===== Socket =====
  function connectSocket(){
    socket = io(origin(), { transports:['websocket','polling'] });
    socket.on('connect', ()=>{ logLine('관리자 연결됨'); if(currentBattleId){ socket.emit('admin:join', { battleId: currentBattleId }); } });
    socket.on('battle:state', (state)=> updateStatus(state||'waiting'));
    socket.on('battle:players', (players)=> rebuildRoster(players));
    socket.on('spectator:count', (data)=>{ if(typeof data?.count === 'number'){ spectatorConnected = clamp(data.count,0,SPECTATOR_CAP); updateSpectatorCounters(); } });
    socket.on('log', (line)=> logLine(line));
    socket.on('disconnect', ()=> logLine('연결 해제됨'));
  }

  function updateStatus(state){
    const map = {waiting:'전투 대기 중', active:'전투 진행 중', paused:'전투 일시정지', ended:'전투 종료'};
    statusPill.textContent = map[state] || '전투 대기 중';
    statusPill.className = 'status-pill ' + (state || 'waiting');
  }

  // ===== Battle Create (견고화) =====
  async function createBattle(){
    if(btnCreateBattle.dataset.busy === '1') return;
    btnCreateBattle.dataset.busy = '1';
    const prev = btnCreateBattle.textContent;
    btnCreateBattle.textContent = '생성 중...';
    btnCreateBattle.disabled = true;

    const mode = battleMode?.value || '1v1';

    try{
      const res = await fetch('/api/battles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});
      if(res.ok){
        let data=null; try{ data = await res.json(); }catch{}
        currentBattleId = (data && (data.id||data.battleId)) ? (data.id||data.battleId) : genLocalId();
      }else{
        currentBattleId = genLocalId();
        if(socket?.connected){ socket.emit('admin:createBattle',{mode,battleId:currentBattleId}); }
      }
    }catch{
      currentBattleId = genLocalId();
      if(socket?.connected){ socket.emit('admin:createBattle',{mode,battleId:currentBattleId}); }
    }

    finalize();
    function genLocalId(){ return 'B_' + Math.random().toString(36).slice(2,8).toUpperCase(); }
    function finalize(){
      if(!currentBattleId){ toastMsg('전투 생성 실패'); }
      else{
        battleIdEl.value = currentBattleId;
        refreshAllLinks();
        if(socket?.connected){ socket.emit('admin:join',{battleId:currentBattleId}); }
        updateStatus('waiting');
        toastMsg('전투가 생성되었습니다');
      }
      btnCreateBattle.dataset.busy = '0';
      btnCreateBattle.textContent = prev;
      btnCreateBattle.disabled = false;
    }
  }

  // ===== OTP =====
  async function generateOtp(role){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return ''; }
    if(role==='spectator'){
      const used = spectatorConnected || spectatorIssuedLocal;
      if(used >= 30){ toastMsg('관전자 한도(30명)에 도달했습니다'); return ''; }
    }
    try{
      const url = role==='spectator'
        ? `/api/otp?role=${encodeURIComponent(role)}&battle=${encodeURIComponent(currentBattleId)}&cap=30`
        : `/api/otp?role=${encodeURIComponent(role)}&battle=${encodeURIComponent(currentBattleId)}`;
      const res = await fetch(url,{method:'POST'});
      if(res.ok){
        const data = await res.json();
        if(data?.otp){
          if(role==='spectator'){ spectatorIssuedLocal = clamp((spectatorConnected||spectatorIssuedLocal)+1,0,30); updateSpectatorCounters(); }
          return String(data.otp);
        }
      }
    }catch{}
    // fallback
    if(role==='spectator'){
      const used = spectatorConnected || spectatorIssuedLocal;
      if(used >= 30){ toastMsg('관전자 한도(30명)에 도달했습니다'); return ''; }
      spectatorIssuedLocal = clamp(used+1,0,30); updateSpectatorCounters();
    }
    return genLocalOtp();
  }
  function genLocalOtp(){ const pool='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s+=pool[Math.floor(Math.random()*pool.length)]; return s; }
  function updateSpectatorCounters(){ const used = spectatorConnected || spectatorIssuedLocal; spectatorCountEl && (spectatorCountEl.textContent=String(used)); spectatorCapEl && (spectatorCapEl.textContent='30'); $('#btnGenSpectatorOtp').disabled = used>=30; }

  // ===== 이미지 업로드/미리보기 =====
  pAvatar?.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    avatarDataUrl=''; avatarMime=''; avatarName='';
    pAvatarPreview.src=''; pAvatarMeta.textContent='';
    if(!file) return;
    if(!file.type.startsWith('image/')){ toastMsg('이미지 파일만 선택하세요'); return; }
    if(file.size > 5*1024*1024){ toastMsg('이미지 크기는 5MB 이하 권장'); }
    avatarMime=file.type; avatarName=file.name;
    const reader = new FileReader();
    reader.onload = ()=>{ avatarDataUrl = reader.result; pAvatarPreview.src = avatarDataUrl; const kb = Math.round(file.size/1024); pAvatarMeta.textContent = `${file.name} • ${file.type} • ${kb} KB`; };
    reader.readAsDataURL(file);
    // 서버 업로드 사용 시:
    // const form = new FormData(); form.append('file', file);
    // const res = await fetch('/api/uploads',{method:'POST',body:form}); const data = await res.json();
    // avatarDataUrl = data.url; // 서버 URL
  });

  // ===== 참여자 추가/삭제 =====
  // 서버 호환: 원래 스키마(STR/WIL/CHA/DEX/STR/MAG)로 전송하되 INT/MAG는 0으로 채움
  function serverStatPayload(){
    return {
      STR: clamp(sATK.value,0,5),   // 공격
      WIL: clamp(sDEF.value,0,5),   // 방어
      DEX: clamp(sDEX.value,0,5),   // 민첩
      CHA: clamp(sLUK.value,0,5),   // 행운
      INT: 0,                       // 사용 안 함
      MAG: 0                        // 사용 안 함
    };
  }
  function itemPayload(){
    return {
      deterni: clamp(itemDeterni.value,0,99),
      attack_boost: clamp(itemAtkBoost.value,0,99),
      defense_boost: clamp(itemDefBoost.value,0,99)
    };
  }
  function toDisplayStats(stats){
    // 서버가 돌려준 키(STR/WIL/DEX/CHA/INT/MAG) 또는 클라이언트 키(ATK/DEF/DEX/LUK)를 모두 대응
    const ATK = stats.ATK ?? stats.STR ?? 0;
    const DEF = stats.DEF ?? stats.WIL ?? 0;
    const DEX = stats.DEX ?? 0;
    const LUK = stats.LUK ?? stats.CHA ?? 0;
    return { ATK, DEF, DEX, LUK };
  }

  async function addPlayer(){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return; }
    const name = (pName.value||'').trim();
    if(!name){ toastMsg('이름을 입력하세요'); pName.focus(); return; }

    const payload = {
      name,
      team: pTeam.value === 'phoenix' ? 'phoenix' : 'death_eaters',
      hp: clamp(pHP.value,1,999),
      stats: serverStatPayload(),              // 서버 호환 스키마
      items: itemPayload(),
      avatar: avatarDataUrl ? { dataUrl: avatarDataUrl, mime: avatarMime, name: avatarName } : null
    };

    let created = null, ok = false, errText = '';
    try{
      const res = await fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/players`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      if(res.ok){ const data = await res.json(); created = data.player || data; ok = true; }
      else{ try{ errText = await res.text(); }catch{} }
    }catch(e){ errText = e?.message || 'network error'; }

    if(!ok && socket?.connected){
      socket.emit('admin:addPlayer',{ battleId: currentBattleId, player: payload }, (resp)=>{
        if(resp?.ok){ created = resp.player; finalize(created); }
        else { fail(resp?.error || errText); }
      });
    }else if(ok){
      finalize(created);
    }else{
      fail(errText);
    }

    function finalize(createdPlayer){
      toastMsg('전투 참여자가 추가되었습니다');
      const pid = (createdPlayer && createdPlayer.id) ? createdPlayer.id : ('P_' + Math.random().toString(36).slice(2,8));
      const disp = toDisplayStats(createdPlayer?.stats || payload.stats);
      addRosterItem({
        id: pid,
        name: payload.name,
        team: payload.team,
        hp: payload.hp,
        stats: disp,
        items: payload.items,
        avatar: (createdPlayer && createdPlayer.avatar) ? createdPlayer.avatar : payload.avatar
      });
      // reset
      pName.value=''; itemDeterni.value=0; itemAtkBoost.value=0; itemDefBoost.value=0;
      sATK.value=0; sDEF.value=0; sDEX.value=0; sLUK.value=0; pHP.value=100;
      avatarDataUrl=''; avatarMime=''; avatarName='';
      if(pAvatar){ pAvatar.value=''; } pAvatarPreview.src=''; pAvatarMeta.textContent='';
      addPlayerMsg.textContent='';
    }
    function fail(msg){
      addPlayerMsg.textContent = '추가 실패' + (msg ? `: ${msg}` : '');
      setTimeout(()=> addPlayerMsg.textContent='', 2000);
      toastMsg('전투 참여자 추가 실패');
    }
  }

  function addRosterItem(player){
    const li = document.createElement('li');
    li.className = 'roster-item';
    li.dataset.pid = player.id;

    const left = document.createElement('div');
    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '12px';

    // 이미지
    const img = document.createElement('img');
    img.alt = `${player.name} 이미지`;
    img.style.width='48px'; img.style.height='72px'; img.style.objectFit='cover';
    img.style.borderRadius='8px'; img.style.border='1px solid var(--border-gold)';
    const avatar = player.avatar;
    img.src = (avatar && (avatar.url || avatar.dataUrl)) ? (avatar.url || avatar.dataUrl) : '';

    const textWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = player.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = [
      `팀: ${player.team === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들'}`,
      `HP: ${player.hp}`,
      `공:${player.stats.ATK} 방:${player.stats.DEF} 민:${player.stats.DEX} 행:${player.stats.LUK}`,
      `아이템: D(${player.items.deterni}) A(${player.items.attack_boost}) Df(${player.items.defense_boost})`
    ].join(' | ');

    textWrap.appendChild(name);
    textWrap.appendChild(meta);

    left.appendChild(img);
    left.appendChild(textWrap);

    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-remove';
    btn.textContent = '삭제';
    btn.addEventListener('click', ()=> removePlayer(player.id));

    li.appendChild(left);
    li.appendChild(btn);

    if(player.team === 'phoenix') rosterPhoenix.appendChild(li);
    else rosterDE.appendChild(li);
  }

  function clearRosters(){ rosterPhoenix.innerHTML=''; rosterDE.innerHTML=''; }
  function rebuildRoster(players){
    clearRosters();
    (players||[]).forEach(p=>{
      const disp = toDisplayStats(p.stats||{});
      addRosterItem({
        id: p.id, name: p.name, team: p.team, hp: p.hp,
        stats: disp, items: p.items||{}, avatar: p.avatar||null
      });
    });
  }

  function removePlayer(playerId){
    if(!currentBattleId) return;
    fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/players/${encodeURIComponent(playerId)}`,{method:'DELETE'})
      .then(res=>{
        if(res.ok){ onRemoved(); return; }
        if(socket?.connected){
          socket.emit('admin:removePlayer',{battleId:currentBattleId,playerId},(resp)=>{ if(resp?.ok) onRemoved(); });
        }
      })
      .catch(()=>{
        if(socket?.connected){
          socket.emit('admin:removePlayer',{battleId:currentBattleId,playerId},(resp)=>{ if(resp?.ok) onRemoved(); });
        }
      });

    function onRemoved(){
      const el = document.querySelector(`.roster-item[data-pid="${playerId}"]`);
      if(el) el.remove();
      toastMsg('전투 참여자가 삭제되었습니다');
    }
  }

  // ===== Controls =====
  function ctl(kind){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return; }
    fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/${kind}`,{method:'POST'})
      .then(res=>{
        if(res.ok){ toastMsg('처리되었습니다'); }
        else if(socket?.connected){ socket.emit('admin:control',{battleId:currentBattleId,action:kind}); toastMsg('처리되었습니다'); }
      })
      .catch(()=>{ if(socket?.connected){ socket.emit('admin:control',{battleId:currentBattleId,action:kind}); toastMsg('처리되었습니다'); } });
  }

  // ===== Chat =====
  function sendChat(){
    const msg = (chatText.value||'').trim();
    if(!msg) return;
    if(socket?.connected && currentBattleId){
      socket.emit('admin:chat',{battleId:currentBattleId,text:msg});
      chatText.value='';
    }
  }

  // ===== Events =====
  btnCreateBattle.addEventListener('click', createBattle);
  btnStart.addEventListener('click', ()=>ctl('start'));
  btnPause.addEventListener('click', ()=>ctl('pause'));
  btnResume.addEventListener('click', ()=>ctl('resume'));
  btnEnd.addEventListener('click', ()=>ctl('end'));

  btnGenPlayerOtp.addEventListener('click', async()=>{ const otp = await generateOtp('player'); if(otp){ playerOtp = otp; playerOtpEl.value = otp; refreshAllLinks(); toastMsg('전투 참여자 비밀번호 발급'); }});
  btnGenSpectatorOtp.addEventListener('click', async()=>{ const otp = await generateOtp('spectator'); if(otp){ spectatorOtp = otp; spectatorOtpEl.value = otp; refreshAllLinks(); toastMsg('관전자 비밀번호 발급'); }});

  $$('.btn-copy').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sel = btn.getAttribute('data-copy');
      if(sel==='#spectatorUrl'){ const used = spectatorConnected || spectatorIssuedLocal; if(used>=30){ toastMsg('관전자 한도(30명)에 도달했습니다'); return; } }
      copyBySelector(sel);
    });
  });

  btnAddPlayer.addEventListener('click', addPlayer);

  btnChatSend.addEventListener('click', ()=> sendChat());
  chatText.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); }});

  // Init
  connectSocket();
  updateStatus('waiting');
  spectatorConnected = 0; spectatorIssuedLocal = 0; updateSpectatorCounters();
})();
