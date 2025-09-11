// public/assets/js/player.js
// - 팀 타이머(5분)만 표시
// - 좌측 상단 본인 아바타 표시(4:3, 둥근 사각형, contain)
// - 팀원 목록 하단 '준비 완료' 버튼: 1회 누르면 비활성화, 서버에 player:ready emit
// - 타깃 선택 오버레이 유지, 버튼 스타일 유지(금색 테두리/글자 + 검은 배경)

const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

const params = new URLSearchParams(location.search);
const battleId = params.get('battle') || '';
const name     = params.get('name')   || '';
const token    = params.get('token')  || '';

const socket = io(window.location.origin, {
  path: '/socket.io',
  transports: ['websocket','polling'],
  withCredentials: true,
  timeout: 20000,
});

// 오버레이/뷰
const authOverlay = $('#authOverlay');

const meAvatar = $('#meAvatar');
const meName = $('#meName');
const meTeam = $('#meTeam');
const meHp   = $('#meHp');
const meHpBar= $('#meHpBar');

const statAtk = $('#sAtk');
const statDef = $('#sDef');
const statLuk = $('#sLuk');
const statAgi = $('#sAgi');

const teamList = $('#teamList');
const btnReady = $('#btnReady');

const turnTeam = $('#turnTeam');
const turnImg  = $('#turnImg');
const turnTimer= $('#turnTimer');

const queueEl  = $('#queue');

const btnAttack= $('#btnAttack');
const btnDefend= $('#btnDefend');
const btnDodge = $('#btnDodge');
const btnItem  = $('#btnItem');
const btnPass  = $('#btnPass');

const chatBox  = $('#chat');
const chatMsg  = $('#chatMsg');
const btnSend  = $('#btnSend');

const logBox   = $('#log');

// 타깃 오버레이
const targetOverlay = $('#targetOverlay');
const targetTitle   = $('#targetTitle');
const targetList    = $('#targetList');
const btnCancelTarget = $('#btnCancelTarget');

let me = null;               // 내 플레이어
let lastSnap = null;         // 최신 스냅샷
let teamTimerHandle = null;  // 팀 5분 타이머 인터벌

// ── 연결 및 인증
socket.on('connect', ()=>{
  if(battleId && name && token){
    socket.emit('playerAuth', { battleId, name, token });
  }
});

socket.on('auth:success', ({ battle, player })=>{
  me = player;
  authOverlay?.classList.add('hidden');
  renderMe(player);
  renderAll(battle);
});

socket.on('authError', ({error})=>{
  authOverlay?.classList.remove('hidden');
  authOverlay.querySelector('.sheet').innerHTML = `<div>인증 실패</div><div style="color:#9aa4b2; font-size:12px; margin-top:6px">${error||'오류'}</div>`;
});

// ── 업데이트/로그/채팅
socket.on('battle:update', (snap)=>{
  lastSnap = snap;
  const newerMe = (snap.players||[]).find(p=>p.id===me?.id);
  if(newerMe){ me = newerMe; renderMe(me); }
  renderAll(snap);
});
socket.on('battle:log', (m)=> appendLog(m.message));
socket.on('battle:chat', ({name,message})=>{
  const p = document.createElement('div'); p.textContent = `${name}: ${message}`;
  chatBox.appendChild(p); chatBox.scrollTop = chatBox.scrollHeight;
});

// ── 채팅 전송
btnSend?.addEventListener('click', ()=>{
  if(!battleId) return;
  const msg = chatMsg.value.trim(); if(!msg) return;
  socket.emit('chat:send', { battleId, name: me?.name || name || '전투 참가자', message: msg, role:'player' });
  chatMsg.value='';
});

// ── 준비 완료
btnReady?.addEventListener('click', ()=>{
  if(!battleId || !me || btnReady.disabled) return;
  socket.emit('player:ready', { battleId, playerId: me.id });
  btnReady.disabled = true;
});

// ── 액션 버튼
btnAttack?.addEventListener('click', ()=>{
  if(!canAct()) return;
  openTargetPicker('attack'); // 적 선택
});
btnDefend?.addEventListener('click', ()=>{
  if(!canAct()) return;
  emitAction({ type:'defend' });
});
btnDodge?.addEventListener('click', ()=>{
  if(!canAct()) return;
  emitAction({ type:'dodge' });
});
btnItem?.addEventListener('click', ()=>{
  if(!canAct()) return;
  const items = me?.items || {};
  if((items.dittany|0)>0){ openTargetPicker('dittany'); return; }
  if((items.attack_booster|0)>0){ emitAction({ type:'item', itemType:'attack_booster' }); return; }
  if((items.defense_booster|0)>0){ emitAction({ type:'item', itemType:'defense_booster' }); return; }
  appendLog('사용 가능한 아이템이 없습니다.');
});
btnPass?.addEventListener('click', ()=>{
  if(!canAct()) return;
  emitAction({ type:'pass' });
});

// ── 타깃 선택
btnCancelTarget?.addEventListener('click', ()=> hideTargetPicker());

function openTargetPicker(kind){
  if(!lastSnap || !me) return;
  targetList.innerHTML = '';
  targetOverlay.classList.remove('hidden');

  if(kind==='attack'){
    targetTitle.textContent = '공격 대상 선택';
    const enemies = (lastSnap.players||[]).filter(p=> p.hp>0 && teamKey(p.team)!==teamKey(me.team));
    if(enemies.length===0){
      targetList.innerHTML = `<div class="label">대상이 없습니다.</div>`;
      return;
    }
    enemies.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'target';
      row.innerHTML = `<div>${p.name} · HP ${p.hp}/${p.maxHp}</div><button class="btn">선택</button>`;
      row.querySelector('button').addEventListener('click', ()=>{
        emitAction({ type:'attack', targetId: p.id }); hideTargetPicker();
      });
      targetList.appendChild(row);
    });
    return;
  }

  if(kind==='dittany'){
    targetTitle.textContent = '회복 대상 선택';
    const allies = (lastSnap.players||[]).filter(p=> p.hp>0 && teamKey(p.team)===teamKey(me.team));
    allies.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'target';
      row.innerHTML = `<div>${p.name} · HP ${p.hp}/${p.maxHp}</div><button class="btn">선택</button>`;
      row.querySelector('button').addEventListener('click', ()=>{
        emitAction({ type:'item', itemType:'dittany', targetId: p.id }); hideTargetPicker();
      });
      targetList.appendChild(row);
    });
    return;
  }
}

function hideTargetPicker(){
  targetOverlay.classList.add('hidden');
  targetList.innerHTML = '';
}

// ── 렌더
function renderMe(p){
  meAvatar.src = p.avatar || '';
  meName.textContent = p.name || '-';
  meTeam.textContent = teamKey(p.team)==='phoenix' ? 'A' : 'B';
  meHp.textContent   = `${p.hp}/${p.maxHp}`;
  meHpBar.style.width = `${Math.max(0, Math.min(100, (p.hp/p.maxHp)*100))}%`;
  statAtk.textContent = p.stats?.attack ?? '-';
  statDef.textContent = p.stats?.defense ?? '-';
  statLuk.textContent = p.stats?.luck ?? '-';
  statAgi.textContent = p.stats?.agility ?? '-';

  // 준비 버튼 상태
  if(btnReady){
    if(p.ready){ btnReady.disabled = true; btnReady.textContent = '준비 완료됨'; }
    else { btnReady.disabled = false; btnReady.textContent = '준비 완료'; }
  }
}

function renderAll(snap){
  // 팀원 목록
  teamList.innerHTML='';
  const myTeam = teamKey(me?.team);
  (snap.players||[])
    .filter(p=>teamKey(p.team)===myTeam)
    .forEach(p=>{
      const d = document.createElement('div');
      d.className='target';
      d.innerHTML = `<div>${p.name}</div><div>HP ${p.hp}/${p.maxHp}</div>`;
      teamList.appendChild(d);
    });

  // 현재 팀 표기
  const isCommit = (snap.phase==='commitA' || snap.phase==='commitB') && snap.status==='active';
  const myTurn = myTeam===snap.currentTeam && isCommit && (me?.hp||0)>0;
  [btnAttack,btnDefend,btnDodge,btnItem,btnPass].forEach(b=> b.disabled = !myTurn);

  const isATeam = snap.currentTeam==='phoenix';
  turnTeam.textContent = `현재 커밋팀: ${isATeam?'A':'B'}`;

  // 순서 큐(생존자 나열) 및 메인 이미지(첫 번째)
  renderQueueAndMain(snap);

  // 팀 5분 타이머
  setupTeamTimer(snap.turnStartTime);

  // 준비 버튼은 전투 대기 상태에서만 활성화
  if(btnReady){
    if(snap.status !== 'waiting'){ btnReady.disabled = true; }
    else if(me && !me.ready){ btnReady.disabled = false; }
  }
}

function renderQueueAndMain(snap){
  queueEl.innerHTML = '';
  const curTeam = snap.currentTeam;
  const alive = (snap.players||[]).filter(p=> p.hp>0 && teamKey(p.team)===curTeam);

  alive.forEach((p,i)=>{
    const q = document.createElement('div');
    q.className = 'qitem' + (i===0 ? ' active' : '');
    q.innerHTML = `<img src="${p.avatar||''}" alt=""><div class="name">${p.name}</div>`;
    queueEl.appendChild(q);
  });

  const first = alive[0];
  turnImg.src = first?.avatar || '';
}

// 팀 5분 카운트다운
function setupTeamTimer(turnStartTime){
  if(teamTimerHandle) clearInterval(teamTimerHandle);
  const limitMs = 5*60*1000;
  const tick = ()=>{
    const remain = Math.max(0, limitMs - (Date.now() - (turnStartTime||0)));
    const m = Math.floor(remain/60000);
    const s = Math.floor((remain%60000)/1000);
    turnTimer.textContent = `팀 제한 시간 ${String(m).padStart(1,'0')}:${String(s).padStart(2,'0')}`;
  };
  tick();
  teamTimerHandle = setInterval(tick, 500);
}

// 액션 송신
function emitAction(a){
  if(!battleId || !me) return;
  socket.emit('player:action', { battleId, playerId: me.id, action: sanitizeAction(a) });
}

// 유틸
function teamKey(t){ return (String(t).toLowerCase()==='eaters') ? 'eaters':'phoenix'; }
function appendLog(t){ const d=document.createElement('div'); d.textContent=t; logBox.appendChild(d); logBox.scrollTop=logBox.scrollHeight; }
function sanitizeAction(a){
  const type = String(a?.type||'').toLowerCase();
  if(type==='attack') return { type, targetId: String(a?.targetId||'') };
  if(type==='defend' || type==='dodge' || type==='pass') return { type };
  if(type==='item'){
    const it = String(a?.itemType||'').toLowerCase();
    if(it==='dittany') return { type:'item', itemType:'dittany', targetId: String(a?.targetId||'') };
    if(it==='attack_booster' || it==='defense_booster') return { type:'item', itemType:it };
  }
  return { type:'pass' };
}
function canAct(){
  if(!lastSnap || !me) return false;
  const isCommit = (lastSnap.phase==='commitA' || lastSnap.phase==='commitB') && lastSnap.status==='active';
  const myTeam = teamKey(me.team);
  return isCommit && myTeam===lastSnap.currentTeam && (me.hp||0)>0;
}
