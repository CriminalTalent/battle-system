/* PYXIS Admin – 관전자 30인 제한 & 전투 생성 안정화 (전투 참여자 표기) */
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
  const sINT = $('#sINT');
  const sWIL = $('#sWIL');
  const sCHA = $('#sCHA');
  const sDEX = $('#sDEX');
  const sSTR = $('#sSTR');
  const sMAG = $('#sMAG');
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
  let spectatorConnected = 0;   // 서버가 보내주면 갱신
  let spectatorIssuedLocal = 0; // 서버 미지원 시 발급 기준 보수 계산

  // Utils
  const origin = () => window.location.origin;
  const clamp = (v, min, max) => { v = Number(v); if(Number.isNaN(v)) return min; return Math.max(min, Math.min(max, v)); };

  function toastMsg(text, timeout=1800){
    if(!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'), timeout);
  }

  function genLocalOtp(){
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for(let i=0;i<6;i++) s += pool[Math.floor(Math.random()*pool.length)];
    return s;
  }

  function updateStatusPill(state){
    const map = { waiting:'전투 대기 중', active:'전투 진행 중', paused:'전투 일시정지', ended:'전투 종료' };
    statusPill.textContent = map[state] || '전투 대기 중';
    statusPill.className = 'status-pill ' + (state || 'waiting');
  }

  function linkFor(pathname, params){
    const url = new URL(origin() + pathname);
    Object.entries(params || {}).forEach(([k,v])=>{ if(v!=null && v!=='') url.searchParams.set(k, v); });
    return url.toString();
  }

  function refreshAllLinks(){
    if(!currentBattleId) return;
    adminUrlEl.value = linkFor('/admin', { battle: currentBattleId });
    playerUrlEl.value = linkFor('/play', { battle: currentBattleId, otp: playerOtp || '' });
    spectatorUrlEl.value = linkFor('/spectator', { battle: currentBattleId, otp: spectatorOtp || '' });
  }

  function copyBySelector(sel){
    const el = document.querySelector(sel);
    if(!el) return;
    el.select();
    el.setSelectionRange(0, el.value.length);
    document.execCommand('copy');
    const btn = document.querySelector(`[data-copy="${sel}"]`);
    if(btn){ btn.classList.add('copied'); setTimeout(()=>btn.classList.remove('copied'), 900); }
    toastMsg('복사되었습니다');
  }

  function statPayload(){
    return {
      INT: clamp(sINT.value, 0, 5), WIL: clamp(sWIL.value, 0, 5), CHA: clamp(sCHA.value, 0, 5),
      DEX: clamp(sDEX.value, 0, 5), STR: clamp(sSTR.value, 0, 5), MAG: clamp(sMAG.value, 0, 5)
    };
  }

  function itemPayload(){
    return {
      deterni: clamp(itemDeterni.value, 0, 99),
      attack_boost: clamp(itemAtkBoost.value, 0, 99),
      defense_boost: clamp(itemDefBoost.value, 0, 99)
    };
  }

  function addRosterItem(player){
    const li = document.createElement('li');
    li.className = 'roster-item';
    li.dataset.pid = player.id;

    const left = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = player.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = [
      `팀: ${player.team === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들'}`,
      `HP: ${player.hp}`,
      `INT:${player.stats.INT} WIL:${player.stats.WIL} CHA:${player.stats.CHA}`,
      `DEX:${player.stats.DEX} STR:${player.stats.STR} MAG:${player.stats.MAG}`,
      `아이템: D(${player.items.deterni}) A(${player.items.attack_boost}) Df(${player.items.defense_boost})`
    ].join(' | ');

    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-remove';
    btn.textContent = '삭제';
    btn.addEventListener('click', ()=> removePlayer(player.id));

    li.appendChild(left);
    li.appendChild(btn);

    if(player.team === 'phoenix') rosterPhoenix.appendChild(li);
    else rosterDE.appendChild(li);
  }

  function clearRosters(){ rosterPhoenix.innerHTML = ''; rosterDE.innerHTML = ''; }
  function rebuildRoster(players){ clearRosters(); (players || []).forEach(addRosterItem); }

  // ===== Socket =====
  function connectSocket(){
    socket = io(origin(), { transports: ['websocket','polling'] });

    socket.on('connect', ()=>{
      logLine('system', '관리자 연결됨');
      if(currentBattleId){
        socket.emit('admin:join', { battleId: currentBattleId });
      }
    });

    socket.on('battle:state', (state)=> updateStatusPill(state || 'waiting'));
    socket.on('battle:players', (players)=> rebuildRoster(players));

    // 서버가 관전자 수를 브로드캐스트해 주는 경우 사용
    socket.on('spectator:count', (data)=>{
      if(typeof data?.count === 'number'){
        spectatorConnected = clamp(data.count, 0, SPECTATOR_CAP);
        updateSpectatorCounters();
      }
    });

    socket.on('log', (line)=> logLine('event', line));
    socket.on('disconnect', ()=> logLine('system', '연결 해제됨'));
  }

  // ===== Spectator Cap =====
  function updateSpectatorCounters(){
    const used = spectatorConnected || spectatorIssuedLocal;
    if(spectatorCountEl) spectatorCountEl.textContent = String(used);
    if(spectatorCapEl) spectatorCapEl.textContent = String(SPECTATOR_CAP);
    const reached = used >= SPECTATOR_CAP;
    // 한도 도달 시 관전자 OTP/URL 복사 제한
    btnGenSpectatorOtp.disabled = reached;
  }

  async function generateOtp(role){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return ''; }

    // 관전자 한도 체크
    if(role === 'spectator'){
      const used = spectatorConnected || spectatorIssuedLocal;
      if(used >= SPECTATOR_CAP){
        toastMsg('관전자 한도(30명)에 도달했습니다');
        return '';
      }
    }

    // 서버 시도: cap 전달 (서버가 지원하면 한도 서버에서도 강제)
    try{
      const url = role === 'spectator'
        ? `/api/otp?role=${encodeURIComponent(role)}&battle=${encodeURIComponent(currentBattleId)}&cap=${SPECTATOR_CAP}`
        : `/api/otp?role=${encodeURIComponent(role)}&battle=${encodeURIComponent(currentBattleId)}`;
      const res = await fetch(url, { method:'POST' });
      if(res.ok){
        const data = await res.json();
        if(data && data.otp){
          if(role === 'spectator') {
            spectatorIssuedLocal = clamp((spectatorConnected || spectatorIssuedLocal) + 1, 0, SPECTATOR_CAP);
            updateSpectatorCounters();
          }
          return String(data.otp);
        }
      } else {
        throw new Error('OTP API not ok');
      }
    }catch(e){
      // 로컬 대체
      if(role === 'spectator'){
        const used = spectatorConnected || spectatorIssuedLocal;
        if(used >= SPECTATOR_CAP){
          toastMsg('관전자 한도(30명)에 도달했습니다');
          return '';
        }
        spectatorIssuedLocal = clamp(used + 1, 0, SPECTATOR_CAP);
        updateSpectatorCounters();
      }
      return genLocalOtp();
    }
    // 비정상 응답 시 로컬 대체
    if(role === 'spectator'){
      const used = spectatorConnected || spectatorIssuedLocal;
      if(used >= SPECTATOR_CAP){
        toastMsg('관전자 한도(30명)에 도달했습니다');
        return '';
      }
      spectatorIssuedLocal = clamp(used + 1, 0, SPECTATOR_CAP);
      updateSpectatorCounters();
    }
    return genLocalOtp();
  }

  // ===== Battle Create (hardened) =====
  async function createBattle(){
    if(btnCreateBattle.dataset.busy === '1') return;
    btnCreateBattle.dataset.busy = '1';
    const prevLabel = btnCreateBattle.textContent;
    btnCreateBattle.textContent = '생성 중...';
    btnCreateBattle.disabled = true;

    const mode = battleMode?.value || '1v1';

    try{
      const res = await fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ mode })
      });

      if(res.ok){
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        currentBattleId = (data && (data.id || data.battleId)) ? (data.id || data.battleId) : genLocalBattleId();
      }else{
        // 서버가 4xx/5xx면 소켓 대체
        currentBattleId = genLocalBattleId();
        if(socket && socket.connected){
          socket.emit('admin:createBattle', { mode, battleId: currentBattleId });
        }
      }
    }catch(e){
      // 네트워크/프록시 오류 → 소켓 대체
      currentBattleId = genLocalBattleId();
      if(socket && socket.connected){
        socket.emit('admin:createBattle', { mode, battleId: currentBattleId });
      }
    }

    finalizeCreate();
    function genLocalBattleId(){ return 'B_' + Math.random().toString(36).slice(2,8).toUpperCase(); }
    function finalizeCreate(){
      if(!currentBattleId){
        toastMsg('전투 생성 실패');
      }else{
        battleIdEl.value = currentBattleId;
        refreshAllLinks();
        if(socket && socket.connected){
          socket.emit('admin:join', { battleId: currentBattleId });
        }
        updateStatusPill('waiting');
        toastMsg('전투가 생성되었습니다');
      }
      btnCreateBattle.dataset.busy = '0';
      btnCreateBattle.textContent = prevLabel;
      btnCreateBattle.disabled = false;
    }
  }

  // ===== Player/Participant CRUD =====
  async function addPlayer(){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return; }
    const name = (pName.value || '').trim();
    if(!name){ toastMsg('이름을 입력하세요'); pName.focus(); return; }

    const player = {
      name,
      team: pTeam.value === 'phoenix' ? 'phoenix' : 'death_eaters',
      hp: clamp(pHP.value, 1, 999),
      stats: statPayload(),
      items: itemPayload()
    };

    let ok = false, created = null;
    try{
      const res = await fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/players`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(player)
      });
      if(res.ok){ const data = await res.json(); created = data.player || data; ok = true; }
    }catch(e){ /* fallthrough */ }

    if(!ok && socket && socket.connected){
      socket.emit('admin:addPlayer', { battleId: currentBattleId, player }, (resp)=>{
        if(resp && resp.ok){ created = resp.player; finalize(); }
        else{ fail(); }
      });
    }else if(ok){ finalize(); }
    else{ fail(); }

    function finalize(){
      toastMsg('전투 참여자가 추가되었습니다');
      addRosterItem({
        id: (created && created.id) ? created.id : ('P_' + Math.random().toString(36).slice(2,8)),
        name: player.name, team: player.team, hp: player.hp, stats: player.stats, items: player.items
      });
      pName.value=''; itemDeterni.value=0; itemAtkBoost.value=0; itemDefBoost.value=0; addPlayerMsg.textContent='';
    }
    function fail(){
      addPlayerMsg.textContent = '추가 실패';
      setTimeout(()=> addPlayerMsg.textContent='', 1500);
    }
  }

  function removePlayer(playerId){
    if(!currentBattleId) return;

    fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/players/${encodeURIComponent(playerId)}`, { method:'DELETE' })
      .then(res=>{
        if(res.ok){ onRemoved(); return; }
        if(socket && socket.connected){
          socket.emit('admin:removePlayer', { battleId: currentBattleId, playerId }, (resp)=>{ if(resp && resp.ok) onRemoved(); });
        }
      })
      .catch(()=>{
        if(socket && socket.connected){
          socket.emit('admin:removePlayer', { battleId: currentBattleId, playerId }, (resp)=>{ if(resp && resp.ok) onRemoved(); });
        }
      });

    function onRemoved(){
      const el = document.querySelector(`.roster-item[data-pid="${playerId}"]`);
      if(el) el.remove();
      toastMsg('전투 참여자가 삭제되었습니다');
    }
  }

  // ===== Log & Chat =====
  function logLine(type, text){
    if(!battleLog) return;
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${text}`;
    battleLog.appendChild(line);
    battleLog.scrollTop = battleLog.scrollHeight;
  }

  function sendChat(){
    const msg = (chatText.value || '').trim();
    if(!msg) return;
    if(socket && socket.connected && currentBattleId){
      socket.emit('admin:chat', { battleId: currentBattleId, text: msg });
      chatText.value = '';
    }
  }

  // ===== Controls =====
  function ctl(kind){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return; }
    fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/${kind}`, { method:'POST' })
      .then(res=>{
        if(res.ok){ toastMsg('처리되었습니다'); }
        else if(socket && socket.connected){
          socket.emit('admin:control', { battleId: currentBattleId, action: kind });
          toastMsg('처리되었습니다');
        }
      })
      .catch(()=>{
        if(socket && socket.connected){
          socket.emit('admin:control', { battleId: currentBattleId, action: kind });
          toastMsg('처리되었습니다');
        }
      });
  }

  // ===== Events =====
  btnCreateBattle.addEventListener('click', createBattle);

  btnStart.addEventListener('click', ()=> ctl('start'));
  btnPause.addEventListener('click', ()=> ctl('pause'));
  btnResume.addEventListener('click', ()=> ctl('resume'));
  btnEnd.addEventListener('click', ()=> ctl('end'));

  btnGenPlayerOtp.addEventListener('click', async ()=>{
    const otp = await generateOtp('player');
    if(otp){
      playerOtp = otp;
      playerOtpEl.value = otp;
      refreshAllLinks();
      toastMsg('전투 참여자 비밀번호가 발급되었습니다');
    }
  });

  btnGenSpectatorOtp.addEventListener('click', async ()=>{
    const otp = await generateOtp('spectator');
    if(otp){
      spectatorOtp = otp;
      spectatorOtpEl.value = otp;
      refreshAllLinks();
      toastMsg('관전자 비밀번호가 발급되었습니다');
    }
  });

  $$('.btn-copy').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      // 관전자 URL 복사 가드 (상한 도달)
      const sel = btn.getAttribute('data-copy');
      if(sel === '#spectatorUrl'){
        const used = spectatorConnected || spectatorIssuedLocal;
        if(used >= SPECTATOR_CAP){
          toastMsg('관전자 한도(30명)에 도달했습니다');
          return;
        }
      }
      copyBySelector(sel);
    });
  });

  btnAddPlayer.addEventListener('click', addPlayer);

  chatText.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); }
  });
  btnChatSend.addEventListener('click', sendChat);

  // ===== Init =====
  connectSocket();
  updateStatusPill('waiting');
  spectatorConnected = 0; spectatorIssuedLocal = 0; updateSpectatorCounters();
})();
