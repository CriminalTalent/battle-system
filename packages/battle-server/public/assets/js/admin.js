// public/assets/js/admin.js
// 관리자: 관전자 링크 생성/비밀번호 발급, 채팅/로그 분리, 플레이어 링크 생성
const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

const socket = io(window.location.origin, {
  path: '/socket.io',
  transports: ['websocket','polling'],
  withCredentials: true,
  timeout: 20000,
});

// 연결 점
const connDot = $('#connDot');

// 전투 컨트롤
const btnCreate = $('#btnCreate');
const btnStart  = $('#btnStart');
const btnPause  = $('#btnPause');
const btnResume = $('#btnResume');
const btnEnd    = $('#btnEnd');
const modeSel   = $('#mode');
const battleMeta= $('#battleMeta');

// 링크 생성
const btnGenPlayer      = $('#btnGenPlayer');
const playerLinksWrap   = $('#playerLinks');

const btnBuildSpectator = $('#btnBuildSpectator');
const btnGenSpectator   = $('#btnGenSpectator');
const spectatorUrlInput = $('#spectatorUrl');
const spectatorOtpInput = $('#spectatorOtp');
const btnCopySpectator  = $('#btnCopySpectator');
const btnCopyOtp        = $('#btnCopyOtp');

// 참가자 입력
const elName = $('#pName'), elTeam = $('#pTeam'), elHp = $('#pHp');
const sAtk = $('#sAtk'), sDef = $('#sDef'), sLuk = $('#sLuk'), sAgi = $('#sAgi');
const iDit = $('#iDit'), iAtkB = $('#iAtkB'), iDefB = $('#iDefB');
const elAvatar = $('#pAvatar'), preview = $('#preview'), btnAdd = $('#btnAdd');

// 목록/로그/채팅
const listA = $('#listA tbody'), listB = $('#listB tbody');
const logBox = $('#log');
const chatBox = $('#chat');
const chatMsg = $('#chatMsg');
const btnSend = $('#btnSend');

let connected = false;
let currentBattleId = null;
let currentMode = modeSel?.value || '1v1';
let tmpAvatarUrl = "";
let lastSnap = null;

// ── 연결 상태
socket.on('connect', ()=>{ connected=true; markConn(true); setCtrlEnabled(true); appendLog('서버 연결 성공'); });
socket.on('disconnect', (r)=>{ connected=false; markConn(false); setCtrlEnabled(false); appendLog('서버 연결 해제: '+r); });
socket.on('connect_error', (e)=> appendLog('서버 연결 실패: '+(e?.message||e)));

function markConn(ok){ if(connDot){ connDot.classList.toggle('ok', !!ok); } }
function setCtrlEnabled(on){
  [btnCreate,btnStart,btnPause,btnResume,btnEnd,btnGenPlayer,btnBuildSpectator,btnGenSpectator,btnSend].forEach(b=>{
    if(!b) return; b.disabled = !on;
  });
}

// ── 전투 컨트롤
modeSel?.addEventListener('change', e=> currentMode = e.target.value);
btnCreate?.addEventListener('click', ()=> connected && socket.emit('createBattle', { mode: currentMode }));
btnStart ?.addEventListener('click', ()=> currentBattleId && socket.emit('startBattle',  { battleId: currentBattleId }));
btnPause ?.addEventListener('click', ()=> currentBattleId && socket.emit('pauseBattle',  { battleId: currentBattleId }));
btnResume?.addEventListener('click', ()=> currentBattleId && socket.emit('resumeBattle', { battleId: currentBattleId }));
btnEnd   ?.addEventListener('click', ()=> currentBattleId && socket.emit('endBattle',    { battleId: currentBattleId }));

// ── 참가자 추가
btnAdd?.addEventListener('click', ()=>{
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

// 아바타 업로드/미리보기
elAvatar?.addEventListener('change', async ()=>{
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

// ── 링크 생성: 플레이어
btnGenPlayer?.addEventListener('click', async ()=>{
  if(!currentBattleId){ appendLog('전투 생성 후 사용하세요.'); return; }
  if(!lastSnap){
    try{
      const r = await fetch(`/api/battles/${currentBattleId}`); const j = await r.json();
      if(!j.ok) throw new Error(j.error||'조회 실패'); lastSnap = j.battle;
    }catch(e){ appendLog('플레이어 링크 생성 실패: '+(e?.message||e)); return; }
  }
  renderPlayerLinks(lastSnap);
  appendLog('플레이어 링크 생성 완료');
});

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
}

// ── 링크 생성: 관전자
btnBuildSpectator?.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLog('전투 생성 후 사용하세요.'); return; }
  const base = window.location.origin;
  const otp  = (spectatorOtpInput?.value||'').trim();
  const url  = otp
    ? `${base}/spectator?battle=${currentBattleId}&otp=${encodeURIComponent(otp)}`
    : `${base}/spectator?battle=${currentBattleId}`;
  spectatorUrlInput.value = url;
  appendLog('관전자 링크 생성 완료');
});

btnGenSpectator?.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLog('전투 생성 후 사용하세요.'); return; }
  socket.emit('generateSpectatorOtp', { battleId: currentBattleId });
});

socket.on('spectatorOtpGenerated', ({success, spectatorUrl, otp, error})=>{
  if(!success){ appendLog('관전자 비밀번호 발급 실패: '+(error||'오류')); return; }
  spectatorOtpInput.value = otp || '';
  // 발급과 동시에 링크도 최신화
  spectatorUrlInput.value = makeAbsolute(spectatorUrl) || '';
  appendLog('관전자 비밀번호 발급 완료');
});

btnCopySpectator?.addEventListener('click', ()=> copyToClipboard(spectatorUrlInput.value));
btnCopyOtp?.addEventListener('click', ()=> copyToClipboard(spectatorOtpInput.value));

// ── 채팅(로그와 분리)
btnSend?.addEventListener('click', ()=>{
  if(!currentBattleId) return;
  const msg = chatMsg.value.trim(); if(!msg) return;
  socket.emit('chat:send', { battleId: currentBattleId, name:'관리자', message:msg, role:'admin' });
  chatMsg.value='';
});

socket.on('battle:chat', ({name,message})=>{
  const p = document.createElement('div'); p.textContent = `${name}: ${message}`;
  chatBox.appendChild(p); chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('battle:log', (m)=> appendLog(m.message));

// ── 소켓 수신: 전투 생성/업데이트
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

// ── 렌더/유틸
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
