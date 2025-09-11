// public/assets/js/admin.js
const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>[...root.querySelectorAll(q)];

const socket = io(window.location.origin, {
  path: '/socket.io',
  transports: ['websocket','polling'],
  withCredentials: true,
  timeout: 20000,
});

const connDot = $('#connDot');

// 전투 컨트롤
const btnCreate = $('#btnCreate');
const btnStart  = $('#btnStart');
const btnPause  = $('#btnPause');
const btnResume = $('#btnResume');
const btnEnd    = $('#btnEnd');
const modeSel   = $('#mode');
const battleMeta= $('#battleMeta');

// 링크/OTP
const btnGenPlayer = $('#btnGenPlayer');
const playerLinksWrap = $('#playerLinks');
const btnBuildSpectator = $('#btnBuildSpectator');
const btnGenSpectator = $('#btnGenSpectator');
const spectatorUrlInput = $('#spectatorUrl');
const spectatorOtpInput = $('#spectatorOtp');
const btnCopySpectator = $('#btnCopySpectator');
const btnCopyOtp = $('#btnCopyOtp');

// 참가자 입력
const elName = $('#pName'), elTeam = $('#pTeam'), elHp = $('#pHp');
const sAtk = $('#sAtk'), sDef = $('#sDef'), sLuk = $('#sLuk'), sAgi = $('#sAgi');
const iDit = $('#iDit'), iAtkB = $('#iAtkB'), iDefB = $('#iDefB');
const elAvatar = $('#pAvatar'), preview = $('#preview'), btnAdd = $('#btnAdd');

// 목록/로그/채팅
const listA = $('#listA tbody'), listB = $('#listB tbody');
const logBox = $('#log');
const chatBox = $('#chat'); const chatMsg = $('#chatMsg'); const btnSend = $('#btnSend');

let connected=false, currentBattleId=null, currentMode=modeSel?.value||'1v1', tmpAvatarUrl="", lastSnap=null;

const recentOutChats = new Set();
function rememberOut(key){ recentOutChats.add(key); setTimeout(()=>recentOutChats.delete(key), 3000); }

// 연결
socket.on('connect', ()=>{ connected=true; markConn(true); setCtrlEnabled(true); appendLogPlain('서버 연결 성공'); });
socket.on('disconnect', (r)=>{ connected=false; markConn(false); setCtrlEnabled(false); appendLogPlain('서버 연결 해제: '+r); });
socket.on('connect_error', (e)=> appendLogPlain('서버 연결 실패: '+(e?.message||e)));
function markConn(ok){ connDot?.classList.toggle('ok', !!ok); }
function setCtrlEnabled(on){
  [btnCreate,btnStart,btnPause,btnResume,btnEnd,btnGenPlayer,btnBuildSpectator,btnGenSpectator,btnSend].forEach(b=>{ if(b) b.disabled=!on; });
}

// 컨트롤
modeSel?.addEventListener('change', e=> currentMode = e.target.value);
btnCreate?.addEventListener('click', ()=> connected && socket.emit('createBattle', { mode: currentMode }));
btnStart ?.addEventListener('click', ()=> currentBattleId && socket.emit('startBattle',  { battleId: currentBattleId }));
btnPause ?.addEventListener('click', ()=> currentBattleId && socket.emit('pauseBattle',  { battleId: currentBattleId }));
btnResume?.addEventListener('click', ()=> currentBattleId && socket.emit('resumeBattle', { battleId: currentBattleId }));
btnEnd   ?.addEventListener('click', ()=> currentBattleId && socket.emit('endBattle',    { battleId: currentBattleId }));

// 참가자 추가
btnAdd?.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLogPlain('전투 생성부터 진행하세요.'); return; }
  const name = (elName.value||'').trim(); if(!name){ elName.focus(); return; }
  const payload = {
    battleId: currentBattleId,
    playerData: {
      name, team: elTeam.value, hp: clampNum(elHp.value, 1, 100),
      stats: { attack: clampNum(sAtk.value,1,5), defense: clampNum(sDef.value,1,5), luck:clampNum(sLuk.value,1,5), agility:clampNum(sAgi.value,1,5) },
      items: { dittany:clampNum(iDit.value,0,99), attack_booster:clampNum(iAtkB.value,0,99), defense_booster:clampNum(iDefB.value,0,99) },
      avatar: tmpAvatarUrl || "",
    }
  };
  socket.emit('addPlayer', payload);
});
elAvatar?.addEventListener('change', async ()=>{
  const f = elAvatar.files?.[0];
  if(!f){ tmpAvatarUrl = ""; preview.textContent='미리보기'; preview.style.background=''; return; }
  const form = new FormData(); form.append('avatar', f);
  try{
    const r = await fetch('/api/upload/avatar', { method:'POST', body:form });
    const j = await r.json(); if(!j.ok) throw new Error(j.error||'업로드 실패');
    tmpAvatarUrl = j.avatarUrl;
    preview.textContent=''; preview.style.backgroundImage=`url(${tmpAvatarUrl})`;
    preview.style.backgroundSize='contain'; preview.style.backgroundPosition='center'; preview.style.backgroundRepeat='no-repeat';
  }catch(e){ tmpAvatarUrl=""; preview.textContent='업로드 실패'; }
});

// 링크(플레이어)
btnGenPlayer?.addEventListener('click', async ()=>{
  if(!currentBattleId){ appendLogPlain('전투 생성 후 사용하세요.'); return; }
  if(!lastSnap){
    try{ const r = await fetch(`/api/battles/${currentBattleId}`); const j = await r.json(); if(!j.ok) throw new Error(j.error||'조회 실패'); lastSnap=j.battle; }
    catch(e){ appendLogPlain('플레이어 링크 생성 실패: '+(e?.message||e)); return; }
  }
  renderPlayerLinks(lastSnap);
  appendLogPlain('플레이어 링크 생성 완료');
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

// 링크(관전자)
btnBuildSpectator?.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLogPlain('전투 생성 후 사용하세요.'); return; }
  const base = window.location.origin;
  const otp  = (spectatorOtpInput?.value||'').trim();
  const url  = otp ? `${base}/spectator?battle=${currentBattleId}&otp=${encodeURIComponent(otp)}`
                   : `${base}/spectator?battle=${currentBattleId}`;
  spectatorUrlInput.value = url;
  appendLogPlain('관전자 링크 생성 완료');
});
btnGenSpectator?.addEventListener('click', ()=>{
  if(!currentBattleId){ appendLogPlain('전투 생성 후 사용하세요.'); return; }
  socket.emit('generateSpectatorOtp', { battleId: currentBattleId });
});
socket.on('spectatorOtpGenerated', ({success, spectatorUrl, otp, error})=>{
  if(!success){ appendLogPlain('관전자 비밀번호 발급 실패: '+(error||'오류')); return; }
  spectatorOtpInput.value = otp || '';
  spectatorUrlInput.value = makeAbsolute(spectatorUrl) || '';
  appendLogPlain('관전자 비밀번호 발급 완료');
});

// 채팅
btnSend?.addEventListener('click', sendChat);
chatMsg?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
function sendChat(){
  if(!currentBattleId) return;
  const msg = chatMsg.value.trim(); if(!msg) return;
  const name = '관리자'; const key = `${name}|${msg}`;
  optimisticChatAppend(name, msg); rememberOut(key);
  socket.emit('chat:send', { battleId: currentBattleId, name, message:msg, role:'admin' });
  chatMsg.value='';
}
socket.on('battle:chat', ({name,message})=>{
  const key = `${name}|${message}`; if(recentOutChats.has(key)) return;
  optimisticChatAppend(name, message);
});
function optimisticChatAppend(n,m){ const p=document.createElement('div'); p.textContent=`${n}: ${m}`; chatBox.appendChild(p); chatBox.scrollTop=chatBox.scrollHeight; }

// 로그/업데이트
socket.on('battle:log', (m)=> appendLogRich(m.message));
socket.on('battleCreated', ({success,battleId,mode,error})=>{
  if(!success){ appendLogRich(`전투 생성 실패: ${error||'오류'}`); return; }
  currentBattleId = battleId;
  appendLogPlain(`전투 생성: ${battleId} / ${mode}`);
  battleMeta.textContent = `ID: ${battleId} · 모드: ${mode}`;
  socket.emit('join', { battleId });
});
socket.on('battle:update', (snap)=>{
  // 페이즈 전환 배너
  if(lastSnap && (lastSnap.phase!==snap.phase || lastSnap.currentTeam!==snap.currentTeam)){
    if((lastSnap.phase||'').startsWith('commit') && snap.phase==='resolve'){
      window.PyxisEffects?.bannerResolve();
    }
    if(lastSnap.phase==='resolve' && (snap.phase==='commitA' || snap.phase==='commitB')){
      const t = snap.currentTeam==='phoenix' ? 'A' : 'B';
      window.PyxisEffects?.bannerCommit(t);
    }
  }

  lastSnap = snap;
  renderLists(snap);
  battleMeta.textContent = `ID: ${snap.id} · 모드: ${snap.mode} · 상태: ${snap.status} · 턴: ${snap.turn}`;

  if(snap.status==='ended'){
    const winTeam = (snap.winnerTeam==='eaters' ? 'B' : 'A');
    window.PyxisEffects?.bannerWin(winTeam);
  }
});

// 렌더
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

// 로그 보조
function appendLogPlain(t){
  const d=document.createElement('div'); d.textContent=normalizeLog(t); d.classList.add('log-item');
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

// 유틸
function normalizeLog(msg){
  if(!msg) return '';
  let s = String(msg);
  s = s.replace(/\bphoenix\b/gi, 'A팀').replace(/\beaters\b/gi, 'B팀');
  s = s.replace(/phoenix팀/gi, 'A팀').replace(/eaters팀/gi, 'B팀');
  s = s.replace(/선공:\s*([A-Z]+)?\s*eaters팀/gi, '선공: B팀').replace(/선공:\s*([A-Z]+)?\s*phoenix팀/gi, '선공: A팀');
  return s;
}
function classifyLog(raw){
  let s=String(raw||''); const out={ text:s, klass:'', banner:null };
  if(/선공/i.test(s)){
    const teamAB = /eaters/i.test(s) ? 'B' : /phoenix/i.test(s) ? 'A' : (/\bB팀\b/.test(s)?'B':'A');
    out.klass='log-first'; out.banner={ text:`선공: ${teamAB}팀`, type:'first' }; return out;
  }
  if(/사망|죽었|HP\s*0/i.test(s)){
    const name = (s.match(/([^:\s]+)\s*(사망|죽었)/) || [,''])[1] || '플레이어';
    out.klass='log-kill'; out.banner={ text:`${name} 사망`, type:'kill' }; return out;
  }
  if(/승리|우승|패배/i.test(s)){
    const teamAB = /eaters|B팀/i.test(s) ? 'B' : 'A';
    out.klass='log-win'; out.banner={ text:`${teamAB}팀 승리`, type:'win' }; return out;
  }
  if(/치명타|회피|방어/i.test(s)) out.klass='log-info';
  return out;
}
function copyToClipboard(text){
  if(!text) return;
  navigator.clipboard?.writeText(text).then(()=> appendLogPlain('복사 완료')).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); try{ document.execCommand('copy'); appendLogPlain('복사 완료'); }catch(e){ appendLogPlain('복사 실패'); }
    ta.remove();
  });
}
function makeAbsolute(url){ if(!url) return ''; if(/^https?:\/\//i.test(url)) return url; return window.location.origin + url; }
function clampNum(v,min,max){ return Math.max(min, Math.min(max, parseInt(v,10)||0)); }
