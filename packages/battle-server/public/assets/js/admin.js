// public/assets/js/admin.js
const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

const socket = io(window.location.origin, {
  path: '/socket.io',
  transports: ['websocket','polling'],
  withCredentials: true,
  timeout: 20000,
});

let connected = false;
socket.on('connect', ()=>{ connected=true; setBtns(); appendLog('서버 연결 성공'); });
socket.on('disconnect', (r)=>{ connected=false; setBtns(); appendLog('서버 연결 해제: '+r); });
socket.on('connect_error', (e)=> appendLog('서버 연결 실패: '+(e?.message||e)));

const btnCreate = $('#btnCreate');
const btnStart  = $('#btnStart');
const btnPause  = $('#btnPause');
const btnResume = $('#btnResume');
const btnEnd    = $('#btnEnd');
const modeSel   = $('#mode');

function setBtns(){ const off=!connected; [btnCreate,btnStart,btnPause,btnResume,btnEnd].forEach(b=> b.disabled=off); }

let currentBattleId = null;
let currentMode = modeSel?.value || '1v1';
modeSel.addEventListener('change', e=> currentMode = e.target.value);

// 입력 refs
const elName = $('#pName'), elTeam = $('#pTeam'), elHp = $('#pHp');
const sAtk = $('#sAtk'), sDef = $('#sDef'), sLuk = $('#sLuk'), sAgi = $('#sAgi');
const iDit = $('#iDit'), iAtkB = $('#iAtkB'), iDefB = $('#iDefB');
const elAvatar = $('#pAvatar'), preview = $('#preview'), btnAdd = $('#btnAdd');

const listA = $('#listA tbody'), listB = $('#listB tbody');
const logBox = $('#log'), chatBox = $('#chat'), chatMsg = $('#chatMsg'), btnSend = $('#btnSend');
const battleMeta = $('#battleMeta');

// 링크 생성 섹션
const playerLinksWrap   = $('#playerLinks');
const btnGenPlayer      = $('#btnGenPlayer');       // ← 추가된 버튼
const btnGenSpectator   = $('#btnGenSpectator');
const spectatorUrlInput = $('#spectatorUrl');
const btnCopySpectator  = $('#btnCopySpectator');

let tmpAvatarUrl = "";
let lastSnap = null; // 마지막 battle:update 스냅샷 저장

// 버튼 이벤트
btnCreate.addEventListener('click', ()=> connected && socket.emit('createBattle', { mode: currentMode }));
btnStart .addEventListener('click', ()=> currentBattleId && socket.emit('startBattle',  { battleId: currentBattleId }));
btnPause .addEventListener('click', ()=> currentBattleId && socket.emit('pauseBattle',  { battleId: currentBattleId }));
btnResume.addEventListener('click', ()=> currentBattleId && socket.emit('resumeBattle', { battleId: currentBattleId }));
btnEnd   .addEventListener('click', ()=> currentBattleId && socket.emit('endBattle',    { battleId: currentBattleId }));

// 플레이어 링크 생성 버튼
btnGenPlayer.addEventListener('click', async ()=>{
  if(!currentBattleId){ appendLog('전투 생성 후 사용하세요.'); return; }
  if(lastSnap){ renderPlayerLinks(lastSnap); return; }
  // 스냅샷이 없으면 API로 가져와서 생성
  try{
    const r = await fetch(`/api/battles/${currentBattleId}`);
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'조회 실패');
    lastSnap = j.battle;
    renderPlayerLinks(lastSnap);
  }catch(e){
    appendLog('플레이어 링크 생성 실패: '+(e?.message||e));
  }
});

// 참가자 추가
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

// 채팅
btnSend.addEventListener('click', ()=>{
  if(!currentBattleId) return;
  const msg = chatMsg.value.trim(); if(!msg) return;
  socket.emit('chat:send', { battleId: currentBattleId, name:'관리자', message:msg, role:'admin' });
  chatMsg.value='';
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
  lastSnap = snap;
  renderLists(snap);
  battleMeta.textContent = `ID: ${snap.id} · 모드: ${snap.mode} · 상태: ${snap.status} · 턴: ${snap.turn}`;
});

socket.on('battle:log', (m)=> appendLog(m.message));

// 관전자 OTP 생성
btnGenSpectator.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLog('전투 생성 후 사용하세요.'); return; }
  socket.emit('generateSpectatorOtp', { battleId: currentBattleId });
});
socket.on('spectatorOtpGenerated', ({success, spectatorUrl, error})=>{
  if(!success){ appendLog('관전자 비밀번호 생성 실패: ' + (error||'오류')); return; }
  const url = makeAbsolute(spectatorUrl);
  spectatorUrlInput.value = url;
  appendLog('관전자 링크 생성 완료');
});
btnCopySpectator.addEventListener('click', ()=> copyToClipboard(spectatorUrlInput.value));

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

// 플레이어 자동 로그인 링크 생성
function renderPlayerLinks(snap){
  playerLinksWrap.innerHTML = '';
  if(!snap?.id) return;
  const base = window.location.origin;
  (snap.players||[]).forEach(p=>{
    const token = `player-${encodeURIComponent(p.name)}-${snap.id}`;
    const url   = `${base}/player?battle=${snap.id}&token=${token}&name=${encodeURIComponent(p.name)}`;

    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `
      <div class="label">참가자</div>
      <input class="input" value="${url}" readonly>
      <button class="btn" data-link="${url}">복사</button>
    `;
    row.querySelector('button').addEventListener('click', ()=> copyToClipboard(url));
    playerLinksWrap.appendChild(row);
  });
  appendLog('플레이어 링크 생성 완료');
}

function copyToClipboard(text){
  if(!text) return;
  navigator.clipboard?.writeText(text).then(()=> appendLog('복사 완료')).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); try{ document.execCommand('copy'); appendLog('복사 완료'); }catch(e){ appendLog('복사 실패'); }
    ta.remove();
  });
}

function makeAbsolute(url){
  if(!url) return '';
  if(/^https?:\/\//i.test(url)) return url;
  return window.location.origin + url;
}

function appendLog(t){ const d=document.createElement('div'); d.textContent=t; logBox.appendChild(d); logBox.scrollTop=logBox.scrollHeight; }
function clampNum(v,min,max){ return Math.max(min, Math.min(max, parseInt(v,10)||0)); }
