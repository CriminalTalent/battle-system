/* PYXIS Admin – 참가자 추가 다중 호환(HTTP/Socket), 라벨/아이템 표기 정정, 드롭다운 가독성 유지 */
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
  const nonEmpty = v => v !== undefined && v !== null && v !== '';
  function toastMsg(text, timeout=1600){ if(!toast) return; toast.textContent = text; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), timeout); }
  function linkFor(pathname, params){ const u = new URL(origin()+pathname); Object.entries(params||{}).forEach(([k,v])=>{ if(nonEmpty(v)) u.searchParams.set(k,v); }); return u.toString(); }
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
  });

  // ===== 서버 호환 스탯/아이템 =====
  function serverStatPayload(){
    // 서버가 INT/MAG을 요구하는 스키마를 사용할 수 있어 0으로 채워 보냄
    return {
      STR: clamp(sATK.value,0,5),   // 공격
      WIL: clamp(sDEF.value,0,5),   // 방어
      DEX: clamp(sDEX.value,0,5),   // 민첩
      CHA: clamp(sLUK.value,0,5),   // 행운
      INT: 0,
      MAG: 0
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
    const ATK = stats.ATK ?? stats.STR ?? 0;
    const DEF = stats.DEF ?? stats.WIL ?? 0;
    const DEX = stats.DEX ?? 0;
    const LUK = stats.LUK ?? stats.CHA ?? 0;
    return { ATK, DEF, DEX, LUK };
  }

  // ===== 참여자 추가 (다중 HTTP 후보 + 소켓 대체) =====
  async function addPlayer(){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return; }
    const name = (pName.value||'').trim();
    if(!name){ toastMsg('이름을 입력하세요'); pName.focus(); return; }

    const base = {
      name,
      team: pTeam.value === 'phoenix' ? 'phoenix' : 'death_eaters',
      teamKey: pTeam.value === 'phoenix' ? 'phoenix' : 'death_eaters',
      teamName: pTeam.value === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들',
      hp: clamp(pHP.value,1,999),
      stats: serverStatPayload(),
      items: itemPayload()
    };
    // avatar는 있을 때만 보냄(일부 서버에서 알 수 없는 필드 거부 방지)
    if(avatarDataUrl){
      base.avatar = { dataUrl: avatarDataUrl, mime: avatarMime, name: avatarName };
    }

    const candidates = [
      // REST (배틀별 players)
      { url: `/api/battles/${encodeURIComponent(currentBattleId)}/players`, body: base },
      { url: `/api/battles/${encodeURIComponent(currentBattleId)}/players`, body: { player: base } },
      // REST (배틀별 participants)
      { url: `/api/battles/${encodeURIComponent(currentBattleId)}/participants`, body: base },
      { url: `/api/battles/${encodeURIComponent(currentBattleId)}/participants`, body: { participant: base } },
      // REST (전역 players)
      { url: `/api/players`, body: { battleId: currentBattleId, ...base } },
      { url: `/api/participants`, body: { battleId: currentBattleId, ...base } },
    ];

    let created = null, ok = false, errText = '';

    // 다중 시도
    for(const c of candidates){
      try{
        const res = await fetch(c.url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(c.body) });
        if(res.ok){
          let data=null; try{ data = await res.json(); }catch{}
          created = normalizeCreated(data);
          if(created){ ok = true; break; }
        }else{
          // 읽을 수 있는 에러를 한번 저장
          try{ errText = await res.text(); }catch{}
        }
      }catch(e){
        errText = e?.message || errText;
      }
    }

    // 소켓 대체
    if(!ok && socket?.connected){
      const socketCandidates = [
        { ev:'admin:addPlayer', key:'player' },
        { ev:'battle:addPlayer', key:'player' },
        { ev:'player:add', key:'player' },
        { ev:'participant:add', key:'participant' }
      ];
      for(const sc of socketCandidates){
        const payload = (sc.key === 'participant') ? { battleId: currentBattleId, participant: base } : { battleId: currentBattleId, player: base };
        const got = await emitAck(sc.ev, payload);
        if(got?.ok && (got.player || got.participant || got.data)){
          created = normalizeCreated(got);
          ok = true; break;
        }
      }
    }

    if(ok){
      finalize(created);
    }else{
      fail(errText);
    }

    function normalizeCreated(data){
      if(!data) return null;
      if(data.player) return data.player;
      if(data.participant) return data.participant;
      if(data.data) return data.data;
      return data;
    }

    function finalize(createdPlayer){
      toastMsg('전투 참여자가 추가되었습니다');
      const pid = (createdPlayer && createdPlayer.id) ? createdPlayer.id : ('P_' + Math.random().toString(36).slice(2,8));
      const disp = toDisplayStats(createdPlayer?.stats || base.stats);
      addRosterItem({
        id: pid,
        name: base.name,
        team: base.team,
        hp: base.hp,
        stats: disp,
        items: base.items,
        avatar: (createdPlayer && createdPlayer.avatar) ? createdPlayer.avatar : base.avatar
      });
      // reset
      pName.value=''; itemDeterni.value=0; itemAtkBoost.value=0; itemDefBoost.value=0;
      sATK.value=0; sDEF.value=0; sDEX.value=0; sLUK.value=0; pHP.value=100;
      avatarDataUrl=''; avatarMime=''; avatarName=''; if(pAvatar){ pAvatar.value=''; }
      pAvatarPreview.src=''; pAvatarMeta.textContent='';
      addPlayerMsg.textContent='';
    }
    function fail(msg){
      addPlayerMsg.textContent = '추가 실패' + (msg ? `: ${msg}` : '');
      setTimeout(()=> addPlayerMsg.textContent='', 2500);
      toastMsg('전투 참여자 추가 실패');
    }
  }

  // 소켓 ACK 유틸
  function emitAck(event, payload){
    return new Promise(resolve=>{
      try{
        socket.emit(event, payload, (resp)=> resolve(resp));
        // 일부 서버는 콜백을 안 주므로 타임아웃 보정
        setTimeout(()=> resolve(null), 1200);
      }catch{ resolve(null); }
    });
  }

  // ===== 로스터 표시 =====
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

    // 아이템 표기는 개수 없이 이름만, 없으면 '없음'
    const items = player.items || {};
    const itemNames = [];
    if((items.deterni|0) > 0) itemNames.push('디터니');
    if((items.attack_boost|0) > 0) itemNames.push('공격 보정기');
    if((items.defense_boost|0) > 0) itemNames.push('방어 보정기');
    const itemLine = `아이템: ${itemNames.length ? itemNames.join(', ') : '없음'}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = [
      `팀: ${player.team === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들'}`,
      `HP: ${player.hp}`,
      `공:${player.stats.ATK} 방:${player.stats.DEF} 민:${player.stats.DEX} 행:${player.stats.LUK}`,
      itemLine
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

  // ===== 삭제 =====
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
