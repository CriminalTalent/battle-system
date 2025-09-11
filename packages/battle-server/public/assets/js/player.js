// public/assets/js/player.js
// - token/password 폴백
// - A/B 팀 표기 정규화
// - 채팅 Enter 전송, 낙관 반영
// - 액션 커밋 후 버튼 잠금/다음 선택자 강조
// - "현재 순서팀" 표기/배너 유지
// - 팀 타이머 5분

const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

const params = new URLSearchParams(location.search);
const battleId = params.get('battle') || '';
const name     = params.get('name')   || '';
// token 우선, 없으면 password 폴백 (관리자 UI에서 "비밀번호"로 보낼 때 대비)
const token    = params.get('token') || params.get('password') || '';

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

const targetOverlay = $('#targetOverlay');
const targetTitle   = $('#targetTitle');
const targetList    = $('#targetList');
const btnCancelTarget = $('#btnCancelTarget');

// 상태
let me = null;
let lastSnap = null;
let teamTimerHandle = null;

// 커밋(서버 개념) 로컬 안내 상태
let committedSet = new Set();
let iCommittedThisPhase = false;
let prevPhase = '';
let prevTeam  = '';

// 채팅 낙관 반영 중복 방지
const recentOutChats = new Set();
function rememberOut(key){ recentOutChats.add(key); setTimeout(()=>recentOutChats.delete(key), 3000); }

// ── 연결/인증
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

// ── 전투 업데이트/로그/채팅
socket.on('battle:update', (snap)=>{
  // 페이즈 전환 배너
  if(prevPhase && (prevPhase!==snap.phase || prevTeam!==snap.currentTeam)){
    if(prevPhase.startsWith('commit') && snap.phase==='resolve'){
      window.PyxisEffects?.showResultBanner('라운드 해석', 'resolve');
    }
    if(prevPhase==='resolve' && (snap.phase==='commitA' || snap.phase==='commitB')){
      const t = snap.currentTeam==='phoenix' ? 'A' : 'B';
      window.PyxisEffects?.showResultBanner(`순서 시작: ${t}팀`, 'commit');
    }
  }

  lastSnap = snap;

  // 페이즈/팀 변경 시 로컬 커밋 상태 리셋
  if(prevPhase !== snap.phase || prevTeam !== snap.currentTeam){
    committedSet.clear();
    iCommittedThisPhase = false;
    prevPhase = snap.phase;
    prevTeam  = snap.currentTeam;
  }

  const newerMe = (snap.players||[]).find(p=>p.id===me?.id);
  if(newerMe){ me = newerMe; renderMe(me); }
  renderAll(snap);

  // 승리 배너
  if(snap.status==='ended'){
    const winTeam = (snap.winnerTeam==='eaters' ? 'B' : 'A');
    window.PyxisEffects?.showResultBanner(`${winTeam}팀 승리`, 'win', 2000);
  }
});
socket.on('battle:log', (m)=> appendLogRich(m.message));

// 채팅: 낙관 반영 + Enter
btnSend?.addEventListener('click', sendChat);
chatMsg?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
function sendChat(){
  if(!battleId) return;
  const msg = chatMsg.value.trim(); if(!msg) return;
  const nm = me?.name || name || '전투 참가자';
  const key = `${nm}|${msg}`;
  optimisticChatAppend(nm, msg);
  rememberOut(key);
  socket.emit('chat:send', { battleId, name: nm, message: msg, role:'player' });
  chatMsg.value='';
}
socket.on('battle:chat', ({name:from,message})=>{
  const key = `${from}|${message}`;
  if(recentOutChats.has(key)) return;
  optimisticChatAppend(from, message);
});
function optimisticChatAppend(n,m){
  const p = document.createElement('div'); p.textContent = `${n}: ${m}`;
  chatBox.appendChild(p); chatBox.scrollTop = chatBox.scrollHeight;
}

// ── 준비 완료
btnReady?.addEventListener('click', ()=>{
  if(!battleId || !me || btnReady.disabled) return;
  socket.emit('player:ready', { battleId, playerId: me.id });
  btnReady.disabled = true;
});

// ── 액션 버튼
btnAttack?.addEventListener('click', ()=>{ if(canAct()) openTargetPicker('attack'); });
btnDefend?.addEventListener('click', ()=>{ if(canAct()) doCommitAndLock({ type:'defend' }); });
btnDodge ?.addEventListener('click', ()=>{ if(canAct()) doCommitAndLock({ type:'dodge'  }); });
btnItem  ?.addEventListener('click', ()=>{
  if(!canAct()) return;
  const items = me?.items || {};
  if((items.dittany|0)>0){ openTargetPicker('dittany'); return; }
  if((items.attack_booster|0)>0){ doCommitAndLock({ type:'item', itemType:'attack_booster' }); return; }
  if((items.defense_booster|0)>0){ doCommitAndLock({ type:'item', itemType:'defense_booster' }); return; }
  appendLogPlain('사용 가능한 아이템이 없습니다.');
});
btnPass  ?.addEventListener('click', ()=>{ if(canAct()) doCommitAndLock({ type:'pass' }); });

// 액션 성공/실패 반영(다음 선택자 이미지 변경)
socket.on('actionSuccess', ({ battleId:bid, playerId, message })=>{
  if(!lastSnap || !me || bid!==lastSnap.id) return;
  committedSet.add(playerId);
  advanceQueueHighlight();
  if(message) appendLogRich(message);
});
socket.on('actionError', ({ battleId:bid, playerId, error })=>{
  if(!lastSnap || !me || bid!==lastSnap.id) return;
  if(playerId===me.id){
    iCommittedThisPhase = false;
    updateActionButtons();
    appendLogPlain(`액션 오류: ${error||'오류'}`);
  }
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
    if(enemies.length===0){ targetList.innerHTML = `<div class="label">대상이 없습니다.</div>`; return; }
    enemies.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'target';
      row.innerHTML = `<div>${p.name} · HP ${p.hp}/${p.maxHp}</div><button class="btn">선택</button>`;
      row.querySelector('button').addEventListener('click', ()=>{
        hideTargetPicker();
        doCommitAndLock({ type:'attack', targetId: p.id });
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
        hideTargetPicker();
        doCommitAndLock({ type:'item', itemType:'dittany', targetId: p.id });
      });
      targetList.appendChild(row);
    });
    return;
  }
}
function hideTargetPicker(){ targetOverlay.classList.add('hidden'); targetList.innerHTML=''; }

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

  if(btnReady){
    if(p.ready){ btnReady.disabled = true; btnReady.textContent = '준비 완료됨'; }
    else { btnReady.disabled = false; btnReady.textContent = '준비 완료'; }
  }
}

function renderAll(snap){
  // 팀원 목록
  teamList.innerHTML='';
  const myTeam = teamKey(me?.team);
  (snap.players||[]).filter(p=>teamKey(p.team)===myTeam).forEach(p=>{
    const d = document.createElement('div');
    d.className='target';
    d.innerHTML = `<div>${p.name}</div><div>HP ${p.hp}/${p.maxHp}</div>`;
    teamList.appendChild(d);
  });

  // 현재 팀 표기 + 버튼 활성(표기 문구: "현재 순서팀")
  const isCommit = (snap.phase==='commitA' || snap.phase==='commitB') && snap.status==='active';
  const myTurn = myTeam===snap.currentTeam && isCommit && (me?.hp||0)>0 && !iCommittedThisPhase;
  [btnAttack,btnDefend,btnDodge,btnItem,btnPass].forEach(b=> b.disabled = !myTurn);

  const isATeam = snap.currentTeam==='phoenix';
  turnTeam.textContent = `현재 순서팀: ${isATeam?'A':'B'}`;

  // 큐와 메인 이미지
  renderQueue(snap);
  updateMainImageByQueue();

  // 팀 5분 타이머
  setupTeamTimer(snap.turnStartTime);

  // 대기 상태에서만 준비 버튼
  if(btnReady){ btnReady.disabled = (snap.status!=='waiting') || (me?.ready===true); }
}

function renderQueue(snap){
  queueEl.innerHTML = '';
  const curTeam = snap.currentTeam;
  const alive = (snap.players||[]).filter(p=> p.hp>0 && teamKey(p.team)===curTeam);

  alive.forEach((p)=>{
    const q = document.createElement('div');
    q.className = 'qitem';
    q.dataset.pid = p.id;
    q.innerHTML = `<img src="${p.avatar||''}" alt=""><div class="name">${p.name}</div>`;
    queueEl.appendChild(q);
  });

  // 첫 번째 미커밋 대상만 active
  advanceQueueHighlight();
}

function updateMainImageByQueue(){
  const first = $('.qitem.active', queueEl) || $('.qitem', queueEl);
  const img = first?.querySelector('img')?.getAttribute('src') || '';
  turnImg.src = img;
}

function advanceQueueHighlight(){
  const items = $$('.qitem', queueEl);
  let firstActiveSet = false;
  items.forEach((el)=>{
    const pid = el.dataset.pid;
    const done = committedSet.has(pid);
    if(done){ el.classList.remove('active'); return; }
    if(!firstActiveSet){ el.classList.add('active'); firstActiveSet = true; }
    else{ el.classList.remove('active'); }
  });
  updateMainImageByQueue();
}

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

// ── 액션 송신 + 버튼 잠금
function doCommitAndLock(action){
  iCommittedThisPhase = true;
  updateActionButtons();
  emitAction(action);
  // 낙관적으로 본인 커밋 처리 → 다음 선택자 안내
  if(me?.id){ committedSet.add(me.id); advanceQueueHighlight(); }
}
function updateActionButtons(){
  const myTeam = teamKey(me?.team);
  const isCommit = lastSnap && (lastSnap.phase==='commitA' || lastSnap.phase==='commitB') && lastSnap.status==='active';
  const myTurn = lastSnap && myTeam===lastSnap.currentTeam && isCommit && (me?.hp||0)>0 && !iCommittedThisPhase;
  [btnAttack,btnDefend,btnDodge,btnItem,btnPass].forEach(b=> b.disabled = !myTurn);
}
function emitAction(a){
  if(!battleId || !me) return;
  socket.emit('player:action', { battleId, playerId: me.id, action: sanitizeAction(a) });
}

// ── 로그 처리(강조/배너)
function appendLogPlain(text){
  const d=document.createElement('div'); d.textContent = normalizeLog(text);
  d.classList.add('log-item');
  logBox.appendChild(d); logBox.scrollTop=logBox.scrollHeight;
}
function appendLogRich(msg){
  const info = classifyLog(msg);
  const d = document.createElement('div');
  d.textContent = normalizeLog(info.text);
  window.PyxisEffects?.tagLog(d, info.klass);
  logBox.appendChild(d); logBox.scrollTop = logBox.scrollHeight;
  if(info.banner){ window.PyxisEffects?.showResultBanner(info.banner.text, info.banner.type); }
}
function classifyLog(raw){
  let s = String(raw||'');
  const out = { text:s, klass:'', banner:null };

  if(/선공/i.test(s)){
    const teamAB = /eaters/i.test(s) ? 'B' : /phoenix/i.test(s) ? 'A' : (/\bB팀\b/.test(s)?'B':'A');
    out.klass='log-first';
    out.banner={ text:`선공: ${teamAB}팀`, type:'first' };
    return out;
  }
  if(/사망|죽었|HP\s*0/i.test(s)){
    const nm = (s.match(/([^:\s]+)\s*(사망|죽었)/) || [,''])[1] || '플레이어';
    out.klass='log-kill';
    out.banner={ text:`${nm} 사망`, type:'kill' };
    return out;
  }
  if(/전투 종료|승리|우승|패배/i.test(s)){
    const teamAB = /eaters|B팀/i.test(s) ? 'B' : 'A';
    out.klass='log-win';
    out.banner={ text:`${teamAB}팀 승리`, type:'win' };
    return out;
  }

  if(/치명타|회피|방어|반격/i.test(s)) out.klass='log-info';
  return out;
}

// ── 유틸
function teamKey(t){ return (String(t).toLowerCase()==='eaters') ? 'eaters':'phoenix'; }
function normalizeLog(msg){
  if(!msg) return '';
  let s = String(msg);
  s = s.replace(/\bphoenix\b/gi, 'A팀').replace(/\beaters\b/gi, 'B팀');
  s = s.replace(/phoenix팀/gi, 'A팀').replace(/eaters팀/gi, 'B팀');
  s = s.replace(/선공:\s*([A-Z]+)?\s*eaters팀/gi, '선공: B팀').replace(/선공:\s*([A-Z]+)?\s*phoenix팀/gi, '선공: A팀');
  return s;
}
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
  return isCommit && myTeam===lastSnap.currentTeam && (me.hp||0)>0 && !iCommittedThisPhase;
}
