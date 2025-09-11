// public/assets/js/admin.js
const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

const socket = io({ transports:['websocket','polling'] });

// 연결 상태에 따라 버튼 활성/비활성
const btnCreate = $('#btnCreate');
const btnStart  = $('#btnStart');
const btnPause  = $('#btnPause');
const btnResume = $('#btnResume');
const btnEnd    = $('#btnEnd');
const modeSel   = $('#mode');

let connected = false;
socket.on('connect', ()=>{ connected = true; setBtns(); });
socket.on('disconnect', ()=>{ connected = false; setBtns(); });

function setBtns(){
  const off = !connected;
  [btnCreate,btnStart,btnPause,btnResume,btnEnd].forEach(b=> b.disabled = off);
}

let currentBattleId = null;
let currentMode = modeSel?.value || '1v1';

// 입력 refs
const elName = $('#pName'), elTeam = $('#pTeam'), elHp = $('#pHp');
const sAtk = $('#sAtk'), sDef = $('#sDef'), sLuk = $('#sLuk'), sAgi = $('#sAgi');
const iDit = $('#iDit'), iAtkB = $('#iAtkB'), iDefB = $('#iDefB');
const elAvatar = $('#pAvatar'), preview = $('#preview'), btnAdd = $('#btnAdd');

const listA = $('#listA tbody'), listB = $('#listB tbody');
const logBox = $('#log'), chatBox = $('#chat'), chatMsg = $('#chatMsg'), btnSend = $('#btnSend');
const battleMeta = $('#battleMeta');

let tmpAvatarUrl = "";

// 이벤트 바인딩
modeSel.addEventListener('change', e => currentMode = e.target.value);

btnCreate.addEventListener('click', ()=>{
  if(!connected) { appendLog('서버 연결 대기 중'); return; }
  socket.emit('createBattle', { mode: currentMode });
});

btnStart.addEventListener('click', ()=> currentBattleId && socket.emit('startBattle', { battleId: currentBattleId }));
btnPause.addEventListener('click', ()=> currentBattleId && socket.emit('pauseBattle', { battleId: currentBattleId }));
btnResume.addEventListener('click',()=> currentBattleId && socket.emit('resumeBattle',{ battleId: currentBattleId }));
btnEnd.addEventListener('click',   ()=> currentBattleId && socket.emit('endBattle',   { battleId: currentBattleId }));

btnAdd.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLog('전투 생성부터 진행하세요.'); return; }
  const name = (elName.value||'').trim(); if(!name){ elName.focus(); return; }
  const payload = {
    battleId: currentBattleId,
    playerData: {
      name,
      team: elTeam.value,
      hp: clampNum(elHp.value, 1, 100),
      stats: {
        attack: clampNum(sAtk.value, 1, 5),
        defense: clampNum(sDef.value, 1, 5),
        luck:    clampNum(sLuk.value, 1, 5),
        agility: clampNum(sAgi.value, 1, 5),
      },
      items: {
        dittany:         clampNum(iDit.value, 0, 99),
        attack_booster:  clampNum(iAtkB.value, 0, 99),
        defense_booster: clampNum(iDefB.value, 0, 99),
      },
      avatar: tmpAvatarUrl || "",
    }
  };
  socket.emit('addPlayer', payload);
});

// 이미지 업로드/미리보기
elAvatar.addEventListener('change', async ()=>{
  const f = elAvatar.files?.[0];
  if(!f){ tmpAvatarUrl = ""; preview.textContent='미리보기'; preview.style.background=''; return; }
  const form = new FormData(); form.append('avatar', f);
  try{
    const r = await fetch('/api/upload/avatar', { method:'POST', body:form });
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'업로드 실패');
    tmpAvatarUrl = j.avatarUrl;
    preview.textContent = '';
    preview.style.backgroundImage = `url(${tmpAvatarUrl})`;
    preview.style.backgroundSize = 'contain';
    preview.style.backgroundPosition = 'center';
    preview.style.backgroundRepeat = 'no-repeat';
  }catch(e){
    tmpAvatarUrl = ""; preview.textContent='업로드 실패';
  }
});

// 소켓 수신
socket.on('battleCreated', ({success,battleId,mode,error})=>{
  if(!success){ appendLog(`전투 생성 실패: ${error || '오류'}`); return; }
  currentBattleId = battleId;
  appendLog(`전투 생성: ${battleId} / ${mode}`);
  battleMeta.textContent = `ID: ${battleId} · 모드: ${mode}`;
  socket.emit('join', { battleId });
});
socket.on('battle:update', (snap)=>{
  renderLists(snap);
  battleMeta.textContent = `ID: ${snap.id} · 모드: ${snap.mode} · 상태: ${snap.status} · 턴: ${snap.turn}`;
});
socket.on('battle:log', (m)=> appendLog(m.message));
socket.on('battle:chat', ({name,message})=>{
  const p = document.createElement('div'); p.textContent = `${name}: ${message}`;
  chatBox.appendChild(p); chatBox.scrollTop = chatBox.scrollHeight;
});
btnSend.addEventListener('click', ()=>{
  if(!currentBattleId) return;
  const msg = chatMsg.value.trim(); if(!msg) return;
  socket.emit('chat:send', { battleId: currentBattleId, name:'관리자', message:msg, role:'admin' });
  chatMsg.value='';
});

// 렌더/유틸
function renderLists(snap){
  listA.innerHTML=''; listB.innerHTML='';
  (snap.players||[]).forEach(p=>{
    const tr = document.createElement('tr');
    const stat = `공${p.stats.attack}/방${p.stats.defense}/행${p.stats.luck}/민${p.stats.agility}`;
    const items = `디터니${p.items?.dittany||0}·공보${p.items?.attack_booster||0}·방보${p.items?.defense_booster||0}`;
    tr.innerHTML = `<td>${p.name}</td><td>${p.hp}/${p.maxHp}</td><td>${stat}</td><td>${items}</td>`;
    (p.team==='phoenix'?listA:listB).appendChild(tr);
  });
}
function appendLog(t){ const d=document.createElement('div'); d.textContent=t; logBox.appendChild(d); logBox.scrollTop=logBox.scrollHeight; }
function clampNum(v,min,max){ return Math.max(min, Math.min(max, parseInt(v,10)||0)); }
