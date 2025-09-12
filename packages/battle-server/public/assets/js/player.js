// packages/battle-server/public/assets/js/player.js
// 전투 참가자 화면 전용 스크립트(표기 고정: 플레이어→전투 참가자, OTP→비밀번호, 커밋→순서)
// - 아군/상대 모두 HP바 + 스탯(공/방/민/운) 노출
// - 신/구 소켓 이벤트 동시 지원(playerAction / player:action 등)
// - 채팅 Enter 전송 + 기본 발신자 "전투 참가자"
// - URL ?token= OR ?password= 폴백 지원
// - 팀 표기는 항상 A/B로만 노출
// - 아이템 키 정규화: attack_boost / defense_boost / dittany (모두 1회용)

"use strict";

/* ========== DOM 헬퍼 ========== */
const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];
const el = (t,c)=>{ const n=document.createElement(t); if(c) n.className=c; return n; };
const escapeHtml = (s)=> String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));

/* ========== URL 파라미터 ========== */
const params   = new URLSearchParams(location.search);
let battleId   = params.get('battle') || '';
let myName     = params.get('name')   || '';
let otp        = params.get('token')  || params.get('password') || ''; // 비밀번호 폴백
let myTeamAB   = (params.get('team') || 'A').toUpperCase()==='B' ? 'B' : 'A';

/* ========== 전역 상태 ========== */
let socket=null, me=null, lastSnap=null;
let teamTimerHandle=null;
const committedSet = new Set(); // 내 팀 현재 페이즈 순서(커밋) 표시
let iCommittedThisPhase=false;
let prevPhase='', prevTeamKey='';

/* ========== UI 참조 ========== */
const authOverlay = $('#authOverlay');
const toastEl     = $('#toast');

const meAvatar = $('#meAvatar');
const meNameEl = $('#meName');
const meTeamEl = $('#meTeam');
const meHpEl   = $('#meHp');
const meHpBar  = $('#meHpBar');

const sAtk = $('#sAtk'), sDef = $('#sDef'), sLuk = $('#sLuk'), sAgi = $('#sAgi');

const allyList  = $('#allyList') || $('#teamList'); // 구버전 폴백
const enemyList = $('#enemyList');

const btnReady  = $('#btnReady');

const turnTeam  = $('#turnTeam');
const queueEl   = $('#queue');
const turnImg   = $('#turnImg');
const turnTimer = $('#turnTimer');

const btnAttack = $('#btnAttack');
const btnDefend = $('#btnDefend');
const btnDodge  = $('#btnDodge');
const btnItem   = $('#btnItem');
const btnPass   = $('#btnPass');

const chatBox   = $('#chat');
const chatMsg   = $('#chatMsg');
const btnSend   = $('#btnSend');

const logBox    = $('#log');

const targetOverlay  = $('#targetOverlay');
const targetTitle    = $('#targetTitle');
const targetList     = $('#targetList');
const btnCancelTarget= $('#btnCancelTarget');

/* ========== 공용 유틸 ========== */
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), 1600);
}
// 팀 키를 A/B로만 정규화
function toAB(t){
  const s = String(t||'').toLowerCase();
  if(s==='phoenix' || s==='a' || s==='team_a' || s==='team-a') return 'A';
  if(s==='eaters'  || s==='b' || s==='death'  || s==='team_b' || s==='team-b') return 'B';
  return '';
}
function setEnabled(node, on){ if(node) node.disabled = !on; }

/* ========== 소켓 연결/인증 ========== */
function connect(){
  if(socket){ try{ socket.disconnect(); }catch(_){} }
  socket = io(window.location.origin, {
    path:'/socket.io', transports:['websocket','polling'], withCredentials:true, timeout:20000
  });

  socket.on('connect', ()=>{
    // 신/구 인증 이벤트 모두 지원
    socket.emit('playerAuth', { battleId, name: myName, token: otp, team: myTeamAB });
  });

  // 인증 성공(신/구 이벤트)
  socket.on('authSuccess', (p)=>{
    me = p?.player || { id: p?.playerId, name: myName, team: myTeamAB };
    authOverlay?.classList.add('hidden');
    toast('접속 완료');
  });
  socket.on('auth:success', ({ battle, player })=>{
    me = player || me;
    authOverlay?.classList.add('hidden');
    toast('접속 완료');
    if(battle) renderAll(battle);
  });

  // 인증 에러
  socket.on('authError', ({error})=>{
    authOverlay?.classList.remove('hidden');
    authOverlay.querySelector('.sheet').innerHTML =
      `<div>인증 실패</div><div style="color:#9aa4b2; font-size:12px; margin-top:6px">${escapeHtml(error||'오류')}</div>`;
  });

  // 상태 갱신(신/구 채널)
  socket.on('battleUpdate', renderAll);
  socket.on('battle:update', (snap)=>{
    // 페이즈 전환 감지 → 순서(커밋) 상태 초기화
    if(prevPhase!==snap.phase || prevTeamKey!==snap.currentTeam){
      committedSet.clear();
      iCommittedThisPhase=false;
      prevPhase=snap.phase;
      prevTeamKey=snap.currentTeam;
    }
    lastSnap=snap;

    // me 최신화
    const newerMe = (snap.players||[]).find(p=>p.id===me?.id);
    if(newerMe) me=newerMe;

    renderAll(snap);

    // 종료 배너
    if(snap.status==='ended'){
      const winAB = toAB(snap.winnerTeam) || (snap.winnerTeam==='eaters' ? 'B' : 'A');
      window.PyxisEffects?.showResultBanner(`${winAB}팀 승리`, 'win', 2000);
    }
  });

  // 액션 응답(신/구)
  socket.on('actionSuccess', ({ battleId:bid, playerId, message })=>{
    if(!lastSnap || !me || bid!==lastSnap.id) return;
    committedSet.add(playerId);
    advanceQueueHighlight();
    if(message) appendLog(message);
  });
  socket.on('actionError', ({ battleId:bid, playerId, error })=>{
    if(!lastSnap || !me || bid!==lastSnap.id) return;
    if(playerId===me.id){
      iCommittedThisPhase=false;
      updateActionButtons();
      appendLog(`액션 오류: ${error||'오류'}`);
    }
  });

  // 채팅(신/구)
  socket.on('chatMessage', (m)=> appendChat(m?.name || m?.senderName || '전투 참가자', m?.message || '') );
  socket.on('battle:chat', ({name:from,message})=> appendChat(from||'전투 참가자', message||'') );

  // 기타 로그
  socket.on('cheerMessage', (m)=> appendLog(`[응원] ${m?.name || '관전자'}: ${m?.message || ''}`) );
  socket.on('battle:log', (m)=> appendLog(m?.message||'') );
}

/* ========== 렌더링 ========== */
function renderAll(state){
  if(!state) return;
  lastSnap = state;

  // 내 카드
  const my = findMe(state);
  if(my){
    meAvatar && (meAvatar.src = my.avatar || '');
    meNameEl.textContent = my.name || '-';
    meTeamEl.textContent = toAB(my.team) || '-';
    const maxHp = my.maxHp ?? 100;
    meHpEl.textContent = `${my.hp ?? 0}/${maxHp}`;
    meHpBar.style.width = `${Math.max(0, Math.min(100, ((my.hp||0)/maxHp)*100))}%`;

    sAtk.textContent = my.stats?.attack  ?? my.stats?.공격  ?? '-';
    sDef.textContent = my.stats?.defense ?? my.stats?.방어  ?? '-';
    sAgi.textContent = my.stats?.agility ?? my.stats?.민첩  ?? '-';
    sLuk.textContent = my.stats?.luck    ?? my.stats?.행운  ?? '-';
  }

  // 아군 / 상대 목록(HP바 + 스탯 노출)
  if(allyList) allyList.innerHTML='';
  if(enemyList) enemyList.innerHTML='';

  const [A,B] = getTeams(state);
  const myAB = toAB(my?.team) || myTeamAB;
  const allies  = (myAB==='A') ? A : B;
  const enemies = (myAB==='A') ? B : A;

  const makeRow = (p)=>{
    const atk = p.stats?.attack  ?? p.stats?.공격  ?? '-';
    const def = p.stats?.defense ?? p.stats?.방어  ?? '-';
    const agi = p.stats?.agility ?? p.stats?.민첩  ?? '-';
    const luk = p.stats?.luck    ?? p.stats?.행운  ?? '-';
    const maxHp = p.maxHp ?? 100;
    const hpPct = Math.max(0, Math.min(100, ((p.hp||0)/maxHp)*100));
    const row = el('div','target');
    row.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center">
        <div style="width:28px;height:28px;border:1px solid var(--border);border-radius:6px;background:#0c0f14;overflow:hidden">
          ${p.avatar ? `<img src="${p.avatar}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}
        </div>
        <div>
          <div style="font-weight:700">${escapeHtml(p.name)}</div>
          <div class="label">팀 ${toAB(p.team)} · HP ${p.hp}/${maxHp}</div>
          <div class="label">공 ${atk} · 방 ${def} · 민 ${agi} · 운 ${luk}</div>
        </div>
      </div>
      <div class="hpbar" style="width:140px"><i style="width:${hpPct}%"></i></div>
    `;
    return row;
  };

  allies.forEach(p=> allyList && allyList.appendChild(makeRow(p)));
  enemies.forEach(p=> enemyList && enemyList.appendChild(makeRow(p)));

  // 현재 순서팀 표기(커밋→순서 용어 반영) — 항상 A/B로만
  const phaseAB =
    state.phaseTeam ? toAB(state.phaseTeam) :
    (state.turn && state.turn.order ? (state.turn.order[state.turn.phaseIndex||0]||'A') : 'A');
  turnTeam.textContent = `현재 순서팀: ${phaseAB}`;

  // 버튼 활성화(내가 살아 있고, 상태 active, 내 팀 순서)
  const active  = (state.status==='active');
  const alive   = my && (my.hp||0)>0;
  const myTurn  = (phaseAB === toAB(my?.team));
  const enable  = active && alive && myTurn && !iCommittedThisPhase;

  [btnAttack,btnDefend,btnDodge,btnItem,btnPass].forEach(b=> setEnabled(b, enable));

  // 순서 큐(현재팀 생존자)
  renderQueue(state, phaseAB);

  // 팀 제한 타이머(5분)
  setupTeamTimer(state.turnStartTime || state.turn?.startedAt || Date.now());

  // 마지막 이벤트만 제공하는 서버 호환
  if(state.lastEvent) appendLog(state.lastEvent);

  // 준비 버튼 상태
  if(btnReady){
    if(state.status==='waiting'){
      btnReady.disabled = !!my?.ready;
      btnReady.textContent = my?.ready ? '준비 완료됨' : '준비 완료';
    }else{
      btnReady.disabled = true;
    }
  }
}

function renderQueue(state, phaseAB){
  queueEl.innerHTML='';
  const [A,B] = getTeams(state);
  const cur = (phaseAB==='A') ? A : B;
  const alive = cur.filter(p=>(p.hp||0)>0);
  alive.forEach(p=>{
    const q = el('div','qitem');
    q.dataset.pid = p.id;
    q.innerHTML = `<img src="${p.avatar||''}" alt=""><div class="name">${escapeHtml(p.name)}</div>`;
    queueEl.appendChild(q);
  });
  advanceQueueHighlight();
  updateMainImageByQueue();
}
function advanceQueueHighlight(){
  const items = $$('.qitem', queueEl);
  let firstActive=false;
  items.forEach(el=>{
    const pid = el.dataset.pid;
    const done = committedSet.has(pid);
    if(done){ el.classList.remove('active'); return; }
    if(!firstActive){ el.classList.add('active'); firstActive=true; }
    else{ el.classList.remove('active'); }
  });
}
function updateMainImageByQueue(){
  const first = $('.qitem.active', queueEl) || $('.qitem', queueEl);
  const img = first?.querySelector('img')?.getAttribute('src') || '';
  if(turnImg) turnImg.src = img;
}

function setupTeamTimer(turnStartTime){
  if(teamTimerHandle) clearInterval(teamTimerHandle);
  const limitMs = 5*60*1000;
  const base = Number(turnStartTime)||Date.now();
  const tick = ()=>{
    const remain = Math.max(0, limitMs - (Date.now() - base));
    const m = Math.floor(remain/60000);
    const s = Math.floor((remain%60000)/1000);
    turnTimer.textContent = `팀 제한 시간 ${String(m)}:${String(s).padStart(2,'0')}`;
  };
  tick();
  teamTimerHandle = setInterval(tick, 500);
}

/* ========== 준비/액션 ========== */
btnReady?.addEventListener('click', ()=>{
  if(!battleId || !me || btnReady.disabled) return;
  // 신/구 이벤트 동시 전송
  socket?.emit('playerReady', { battleId, playerId: me.id, ready:true });
  socket?.emit('player:ready', { battleId, playerId: me.id });
  btnReady.disabled = true;
  btnReady.textContent = '준비 완료됨';
  toast('준비 완료 전송');
});

btnAttack?.addEventListener('click', ()=>{
  if(!canAct()) return;
  const enemies = getEnemiesAlive();
  openTargetPicker('attack', enemies);
});
btnDefend?.addEventListener('click', ()=>{
  if(!canAct()) return;
  // 방어: 단순 방어(다음 피격에 강화 효과가 있을 수 있음). 실제 계산은 서버 처리.
  commitAction({ type:'defend' });
});
btnDodge ?.addEventListener('click', ()=>{
  if(!canAct()) return;
  // 회피: 서버가 민첩+d20 규칙으로 판정
  commitAction({ type:'dodge' });
});
btnItem  ?.addEventListener('click', ()=>{
  if(!canAct()) return;
  openItemPicker();
});
btnPass  ?.addEventListener('click', ()=>{
  if(!canAct()) return;
  commitAction({ type:'pass' });
});

function canAct(){
  if(!lastSnap || !me) return false;
  const phaseAB =
    lastSnap.phaseTeam ? toAB(lastSnap.phaseTeam) :
    (lastSnap.turn && lastSnap.turn.order ? (lastSnap.turn.order[lastSnap.turn.phaseIndex||0]||'A') : 'A');
  const myTurn = (phaseAB === toAB(me.team));
  return lastSnap.status==='active' && (me.hp||0)>0 && myTurn && !iCommittedThisPhase;
}

function commitAction(action){
  if(!battleId || !me) return;
  iCommittedThisPhase=true;
  updateActionButtons();
  // 신/구 이벤트 동시 전송
  if(action.type==='attack'){
    socket?.emit('playerAction', { battleId, actorId: me.id, type:'attack', targetId: action.targetId });
    socket?.emit('player:action', { battleId, playerId: me.id, action:{ type:'attack', targetId: action.targetId }});
  }else if(action.type==='item'){
    // 아이템: attack_boost / defense_boost / dittany — 모두 1회용, 서버에서 판정 및 소모
    const payload = { battleId, actorId: me.id, type:'item', itemType: action.itemType, targetId: action.targetId };
    socket?.emit('playerAction', payload);
    socket?.emit('player:action', { battleId, playerId: me.id, action:{ type:'item', itemType: action.itemType, targetId: action.targetId }});
  }else{
    socket?.emit('playerAction', { battleId, actorId: me.id, type: action.type });
    socket?.emit('player:action', { battleId, playerId: me.id, action:{ type: action.type }});
  }
  // 낙관 처리로 본인 커밋 완료 → 큐 진행
  committedSet.add(me.id);
  advanceQueueHighlight();
}

function updateActionButtons(){
  const on = canAct();
  [btnAttack,btnDefend,btnDodge,btnItem,btnPass].forEach(b=> setEnabled(b, on));
}

/* ========== 타깃/아이템 선택 ========== */
btnCancelTarget?.addEventListener('click', ()=> hideTargetPicker());

function openTargetPicker(kind, list){
  targetList.innerHTML='';
  targetTitle.textContent = (kind==='attack') ? '공격 대상 선택' : '대상 선택';
  if(!list || list.length===0){
    const d=el('div'); d.textContent='대상이 없습니다';
    targetList.appendChild(d);
  }else{
    list.forEach(p=>{
      const maxHp = p.maxHp ?? 100;
      const hpPct = Math.max(0, Math.min(100, ((p.hp||0)/maxHp)*100));
      const row = el('div','target');
      row.innerHTML = `
        <div>
          <div style="font-weight:700">${escapeHtml(p.name)}</div>
          <div class="label">팀 ${toAB(p.team)} · HP ${p.hp}/${maxHp}</div>
        </div>
        <div class="hpbar" style="width:160px"><i style="width:${hpPct}%"></i></div>
      `;
      row.addEventListener('click', ()=>{
        hideTargetPicker();
        if(kind==='attack') commitAction({ type:'attack', targetId: p.id });
        else commitAction({ type:'item', itemType:'dittany', targetId: p.id });
      });
      targetList.appendChild(row);
    });
  }
  targetOverlay.classList.remove('hidden');
}
function hideTargetPicker(){ targetOverlay.classList.add('hidden'); targetList.innerHTML=''; }

function openItemPicker(){
  targetList.innerHTML='';
  targetTitle.textContent = '아이템 사용';
  const mkBtn=(label, handler)=>{
    const row=el('div','target');
    row.innerHTML = `<div>${label}</div><button class="btn">사용</button>`;
    row.querySelector('.btn').addEventListener('click', handler);
    return row;
  };
  // 공격 보정기(1회용, 10% 성공 시 즉시 2배 피해 공격)
  targetList.appendChild(mkBtn('공격 보정기 (1회용, 10% 성공 시 즉시 2배 피해)', ()=>{
    hideTargetPicker(); commitAction({ type:'item', itemType:'attack_boost' });
  }));
  // 방어 보정기(1회용, 10% 성공 시 다음 피격에 방어 2배 적용)
  targetList.appendChild(mkBtn('방어 보정기 (1회용, 10% 성공 시 다음 피격 방어 2배)', ()=>{
    hideTargetPicker(); commitAction({ type:'item', itemType:'defense_boost' });
  }));
  // 디터니(1회용, HP +10, 대상 선택)
  const allies = getAlliesAlive();
  targetList.appendChild(mkBtn('디터니 (1회용, HP +10 · 대상 선택)', ()=>{
    openTargetPicker('dittany', allies);
  }));
  targetOverlay.classList.remove('hidden');
}

function getEnemiesAlive(){
  if(!lastSnap || !me) return [];
  const [A,B] = getTeams(lastSnap);
  const mineAB = toAB(me.team);
  const enemies = (mineAB==='A') ? B : A;
  return enemies.filter(p=>(p.hp||0)>0);
}
function getAlliesAlive(){
  if(!lastSnap || !me) return [];
  const [A,B] = getTeams(lastSnap);
  const mineAB = toAB(me.team);
  const allies = (mineAB==='A') ? A : B;
  return allies.filter(p=>(p.hp||0)>0);
}

/* ========== 팀/플레이어 조회 ========== */
function getTeams(state){
  // teams.A/B 혹은 players[team=phoenix/eaters] 호환 → 항상 A/B로 변환
  if(state?.teams) return [ (state.teams.A?.players)||[], (state.teams.B?.players)||[] ];
  const arr = state?.players || [];
  return [ arr.filter(p=>toAB(p.team)==='A'), arr.filter(p=>toAB(p.team)==='B') ];
}
function findMe(state){
  const [A,B] = getTeams(state||lastSnap||{});
  const all = [...A,...B];
  return all.find(p=>p.id===me?.id) || all.find(p=>p.name===myName && toAB(p.team)===myTeamAB) || me;
}

/* ========== 로그/채팅 ========== */
function appendLog(msg){
  const d=document.createElement('div');
  d.textContent = normalizeLog(String(msg||''));
  logBox.appendChild(d);
  logBox.scrollTop = logBox.scrollHeight;
}
function normalizeLog(s){
  // 팀 키워드 통일(A/B로만)
  return s.replace(/\bphoenix\b/gi,'A팀').replace(/\beaters\b/gi,'B팀');
}
function appendChat(sender, text){
  const row = document.createElement('div');
  row.textContent = `${sender}: ${text}`;
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// 채팅 전송(버튼 + Enter)
btnSend?.addEventListener('click', sendChat);
chatMsg?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
function sendChat(){
  const text = chatMsg.value.trim(); if(!text) return;
  const nm = me?.name || myName || '전투 참가자';
  appendChat(nm, text); // 낙관 반영
  // 신/구 이벤트 동시 전송
  socket?.emit('chatMessage', { battleId, message: text });
  socket?.emit('chat:send', { battleId, name: nm, message: text, role:'player' });
  chatMsg.value='';
}

/* ========== 수동 로그인 폼(HTML 오버레이) ========== */
$('#btnAuth')?.addEventListener('click', ()=>{
  const b = $('#authBattle').value.trim();
  const n = $('#authName').value.trim();
  const t = $('#authToken').value.trim(); // 비밀번호 표기
  const tm = ($('#authTeam').value || 'A').toUpperCase()==='B' ? 'B':'A';
  if(!b || !n || !t){ toast('모두 입력하세요'); return; }
  battleId=b; myName=n; otp=t; myTeamAB=tm;
  connect();
});

// URL 파라미터로 자동 접속
(function tryAutoAuth(){
  if(battleId && myName && otp){
    $('#authForm')?.classList.add('hidden');
    $('#authPending')?.classList.remove('hidden');
    connect();
  }
})();
