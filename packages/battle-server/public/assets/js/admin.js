/* PYXIS Admin – 인터페이스 보완판
   - 링크: location.origin 기반으로 생성 (IP 표기 문제 제거)
   - 플레이어/관전자 비밀번호(OTP) UI 추가 (서버 API 실패 시 로컬 임시 생성)
   - 참여자 추가(스탯/HP/아이템) 및 삭제 로직 추가
   - 드롭다운 가독성은 admin.css에서 처리
   - 룰/테마/출력 의미 변경 없음
*/
(function(){
  'use strict';

  // DOM helpers
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

  // State
  let socket = null;
  let currentBattleId = null;
  let playerOtp = '';
  let spectatorOtp = '';

  // Utils
  function origin(){ return window.location.origin; }

  function toastMsg(text, timeout=1600){
    if(!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'), timeout);
  }

  function clamp(v, min, max){
    v = Number(v);
    if(Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  function genLocalOtp(){
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for(let i=0;i<6;i++) s += pool[Math.floor(Math.random()*pool.length)];
    return s;
  }

  function updateStatusPill(state){
    const map = {
      waiting: '전투 대기 중',
      active: '전투 진행 중',
      paused: '전투 일시정지',
      ended: '전투 종료'
    };
    statusPill.textContent = map[state] || '전투 대기 중';
    statusPill.className = 'status-pill ' + (state || 'waiting');
  }

  function linkFor(pathname, params){
    const url = new URL(origin() + pathname);
    Object.entries(params || {}).forEach(([k,v])=>{
      if(v!=null && v!=='') url.searchParams.set(k, v);
    });
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
    toastMsg('복사되었습니다');
  }

  function statPayload(){
    return {
      INT: clamp(sINT.value, 0, 5),
      WIL: clamp(sWIL.value, 0, 5),
      CHA: clamp(sCHA.value, 0, 5),
      DEX: clamp(sDEX.value, 0, 5),
      STR: clamp(sSTR.value, 0, 5),
      MAG: clamp(sMAG.value, 0, 5)
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
    btn.addEventListener('click', ()=>{
      removePlayer(player.id);
    });

    li.appendChild(left);
    li.appendChild(btn);

    if(player.team === 'phoenix') rosterPhoenix.appendChild(li);
    else rosterDE.appendChild(li);
  }

  function clearRosters(){
    rosterPhoenix.innerHTML = '';
    rosterDE.innerHTML = '';
  }

  function rebuildRoster(players){
    clearRosters();
    (players || []).forEach(addRosterItem);
  }

  // Socket
  function connectSocket(){
    socket = io(origin(), { transports:['websocket','polling'] });

    socket.on('connect', ()=>{
      logLine('system', '관리자 연결됨');
      if(currentBattleId){
        socket.emit('admin:join', { battleId: currentBattleId });
      }
    });

    socket.on('battle:state', (state)=>{
      updateStatusPill(state || 'waiting');
    });

    socket.on('battle:players', (players)=>{
      rebuildRoster(players);
    });

    socket.on('log', (line)=>{
      logLine('event', line);
    });

    socket.on('disconnect', ()=>{
      logLine('system', '연결 해제됨');
    });
  }

  // REST+Socket fallback helpers
  async function createBattle(){
    const mode = battleMode.value || '1v1';
    try{
      const res = await fetch('/api/battles', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ mode })
      });
      if(res.ok){
        const data = await res.json();
        currentBattleId = data.id || data.battleId || null;
      } else {
        throw new Error('REST create failed');
      }
    }catch(e){
      currentBattleId = 'B_' + Math.random().toString(36).slice(2, 8).toUpperCase();
      if(socket && socket.connected){
        socket.emit('admin:createBattle', { mode, battleId: currentBattleId });
      }
    }

    battleIdEl.value = currentBattleId || '';
    refreshAllLinks();

    if(socket && socket.connected && currentBattleId){
      socket.emit('admin:join', { battleId: currentBattleId });
    }

    toastMsg('전투가 생성되었습니다');
    updateStatusPill('waiting');
  }

  async function generateOtp(role){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return ''; }
    try{
      const res = await fetch(`/api/otp?role=${encodeURIComponent(role)}&battle=${encodeURIComponent(currentBattleId)}`, { method:'POST' });
      if(res.ok){
        const data = await res.json();
        if(data && data.otp) return String(data.otp);
      } else {
        throw new Error('OTP api not ok');
      }
    }catch(e){
      return genLocalOtp();
    }
    return genLocalOtp();
  }

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
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(player)
      });
      if(res.ok){
        const data = await res.json();
        created = data.player || data;
        ok = true;
      }
    }catch(e){}

    if(!ok && socket && socket.connected){
      socket.emit('admin:addPlayer', { battleId: currentBattleId, player }, (resp)=>{
        if(resp && resp.ok){
          created = resp.player;
          finalize();
        }else{
          addPlayerMsg.textContent = '추가 실패';
          setTimeout(()=>addPlayerMsg.textContent='', 1500);
        }
      });
    }else if(ok){
      finalize();
    }else{
      addPlayerMsg.textContent = '추가 실패';
      setTimeout(()=>addPlayerMsg.textContent='', 1500);
    }

    function finalize(){
      toastMsg('플레이어가 추가되었습니다');
      const pid = (created && created.id) ? created.id : ('P_' + Math.random().toString(36).slice(2,8));
      addRosterItem({
        id: pid,
        name: player.name,
        team: player.team,
        hp: player.hp,
        stats: player.stats,
        items: player.items
      });
      pName.value = '';
      itemDeterni.value = 0; itemAtkBoost.value = 0; itemDefBoost.value = 0;
      addPlayerMsg.textContent = '';
    }
  }

  function removePlayer(playerId){
    if(!currentBattleId) return;

    fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/players/${encodeURIComponent(playerId)}`, {
      method:'DELETE'
    }).then(res=>{
      if(res.ok){ onRemoved(); return; }
      if(socket && socket.connected){
        socket.emit('admin:removePlayer', { battleId: currentBattleId, playerId }, (resp)=>{
          if(resp && resp.ok) onRemoved();
        });
      }
    }).catch(()=>{
      if(socket && socket.connected){
        socket.emit('admin:removePlayer', { battleId: currentBattleId, playerId }, (resp)=>{
          if(resp && resp.ok) onRemoved();
        });
      }
    });

    function onRemoved(){
      const el = document.querySelector(`.roster-item[data-pid="${playerId}"]`);
      if(el) el.remove();
      toastMsg('플레이어가 삭제되었습니다');
    }
  }

  // Log & Chat
  function logLine(type, text){
    if(!battleLog) return;
    const line = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
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

  // Controls
  function ctl(kind){
    if(!currentBattleId){ toastMsg('전투를 먼저 생성하세요'); return; }
    fetch(`/api/battles/${encodeURIComponent(currentBattleId)}/${kind}`, { method:'POST' })
      .then(res=>{
        if(res.ok){
          toastMsg('처리되었습니다');
        }else{
          if(socket && socket.connected){
            socket.emit('admin:control', { battleId: currentBattleId, action: kind });
            toastMsg('처리되었습니다');
          }
        }
      })
      .catch(()=>{
        if(socket && socket.connected){
          socket.emit('admin:control', { battleId: currentBattleId, action: kind });
          toastMsg('처리되었습니다');
        }
      });
  }

  // Events
  btnCreateBattle.addEventListener('click', createBattle);

  btnStart.addEventListener('click', ()=>ctl('start'));
  btnPause.addEventListener('click', ()=>ctl('pause'));
  btnResume.addEventListener('click', ()=>ctl('resume'));
  btnEnd.addEventListener('click', ()=>ctl('end'));

  btnGenPlayerOtp.addEventListener('click', async()=>{
    playerOtp = await generateOtp('player');
    playerOtpEl.value = playerOtp;
    refreshAllLinks();
    toastMsg('플레이어 비밀번호가 발급되었습니다');
  });

  btnGenSpectatorOtp.addEventListener('click', async()=>{
    spectatorOtp = await generateOtp('spectator');
    spectatorOtpEl.value = spectatorOtp;
    refreshAllLinks();
    toastMsg('관전자 비밀번호가 발급되었습니다');
  });

  $$('.btn-copy').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sel = btn.getAttribute('data-copy');
      copyBySelector(sel);
    });
  });

  btnAddPlayer.addEventListener('click', addPlayer);

  chatText.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendChat();
    }
  });
  btnChatSend.addEventListener('click', sendChat);

  // Init
  connectSocket();
  updateStatusPill('waiting');
})();
