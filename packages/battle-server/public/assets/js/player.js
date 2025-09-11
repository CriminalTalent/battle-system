/* PYXIS 전투 참가자 클라이언트
   - 팀 표기: 화면 A/B
   - 현재 턴 이미지(라운드 사각형), 턴 시간 카운트
   - 로그 A/B 치환 및 부가 괄호 제거
   - 내 턴에만 액션 버튼 활성화
   - 자동 로그인 로딩 오버레이
*/
(() => {
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
  const TURN_MS = 5*60*1000; // 서버 규칙 5분 (서버는 turnStartTime을 전송) :contentReference[oaicite:2]{index=2}

  // 요소
  const el = {
    viewAuth: $('#authView'),
    viewMain: $('#mainView'),
    overlay: $('#loadingOverlay'),
    // 인증
    authBattle: $('#battleId'),
    authName: $('#playerName'),
    authToken: $('#authToken'),
    btnAuth: $('#btnAuth'),
    // 내 정보
    myAvatar: $('#myAvatar'), myName: $('#myName'), myTeam: $('#myTeam'),
    statATK: $('#statATK'), statDEF: $('#statDEF'), statAGI: $('#statAGI'), statLUK: $('#statLUK'),
    myHpBar: $('#myHpBar'), myHpText: $('#myHpText'),
    itemDittany: $('#itemDittany'), itemAttack: $('#itemAttack'), itemDefense: $('#itemDefense'),
    // 현재 턴/로그/채팅
    turnAvatar: $('#turnAvatar'), turnName: $('#turnName'), turnTimer: $('#turnTimer'),
    logBox: $('#battleLog'),
    chatBox: $('#chatMessages'), chatInput: $('#chatInput'), btnChat: $('#btnChat'),
    // 액션
    btnReady: $('#btnReady'),
    btnAttack: $('#btnAttack'), btnDefend: $('#btnDefend'), btnDodge: $('#btnDodge'), btnPass: $('#btnPass'),
    btnItemDittany: $('#btnItemDittany'), btnItemAttack: $('#btnItemAttack'), btnItemDefense: $('#btnItemDefense')
  };

  // 상태
  const state = {
    socket:null, battle:null, meId:null,
    turnEndsAt:0, turnTimerId:0
  };

  // 팀 유틸
  const normTeam = (t)=>{
    const k = String(t||'').toLowerCase();
    if (k==='phoenix' || k==='a') return 'phoenix';
    if (k==='eaters' || k==='death' || k==='b') return 'eaters';
    return k||'phoenix';
  };
  const teamShort = (t)=> normTeam(t)==='eaters' ? 'B팀' : 'A팀';
  const teamFromCurrent = (cur, players)=>{
    if (!cur) return null;
    const c = String(cur).toLowerCase();
    if (['phoenix','eaters','death'].includes(c)) return normTeam(c);
    const p = (players||[]).find(x=>x.id===cur);
    return p ? normTeam(p.team) : null;
  };

  // 로그 정리: 팀 A/B 치환 + 괄호부가 제거
  function cleanLog(msg){
    let s = String(msg||'');
    s = s.replace(/\bphoenix\b/gi, 'A팀').replace(/\b(eaters|death)\b/gi, 'B팀');
    s = s.replace(/\s*\((민첩성|행운|주사위|공격력|방어력)[^)]+\)/g, ''); // 부가정보 제거
    return s.trim();
  }

  // 화면 토글
  function showMain(){ el.viewAuth.style.display='none'; el.viewMain.style.display=''; }
  function showOverlay(show){ if(!el.overlay) return; el.overlay.classList.toggle('show', !!show); }

  // 소켓
  function getSocketURL(){
    if (typeof window.PYXIS_SERVER_URL==='string' && window.PYXIS_SERVER_URL) return window.PYXIS_SERVER_URL;
    return undefined;
  }
  function connect(){
    if (!window.io) return alert('Socket.IO 로드 실패');
    state.socket = window.io(getSocketURL(), { transports:['websocket','polling'], withCredentials:true });
    bindSocket(state.socket);
  }

  function bindSocket(s){
    s.on('authError', (e)=>{ showOverlay(false); alert('인증 실패: ' + (e?.error||'')); });

    // 인증 성공 -> 전투 스냅샷 동기화
    s.on('auth:success', (p)=>{
      if (p.role!=='player') return;
      state.meId = p.playerId || p.player?.id || null;
      if (p.battle) state.battle = p.battle;
      showMain();
      s.emit('join', { battleId: p.battleId || p.battle?.id });
      renderAll();
    });

    // 스냅샷
    s.on('battle:update', (b)=>{ state.battle = b; renderAll(); });

    // 로그 / 채팅
    s.on('battle:log', (entry)=> appendLog(entry?.type||'system', entry?.message||''));
    s.on('battle:chat', ({name,message})=> appendChat(name, message));
    // 서버는 chat:send를 수신해 battle:chat을 브로드캐스트함. :contentReference[oaicite:3]{index=3}

    // 선택 이벤트 (있으면 사용)
    s.on('turn:start', (data)=>{
      if (typeof data?.timeLeft === 'number') startTurnTimer(data.timeLeft);
      renderTurn();
      updateActions();
    });
    s.on('turn:end', ()=>{ clearTurnTimer(); updateActions(); });
  }

  // 인증
  function autoFromURL(){
    const q = new URLSearchParams(location.search);
    const b=q.get('battle'), n=q.get('name'), t=q.get('token');
    if (b) el.authBattle.value=b;
    if (n) el.authName.value=n;
    if (t) el.authToken.value=t;
    if (b && n && t){ showOverlay(true); onAuth(); }
  }
  function onAuth(){
    const battleId = (el.authBattle.value||'').trim();
    const name = (el.authName.value||'').trim();
    const token = (el.authToken.value||'').trim();
    if (!battleId || !name || !token) return alert('전투 ID/이름/비밀번호를 모두 입력하세요.');
    state.socket.emit('playerAuth', { battleId, name, token });
  }

  // 렌더링
  function me(){ const id=state.meId; return (state.battle?.players||[]).find(p=>p.id===id)||null; }
  function renderAll(){ if (!state.battle) return;
    renderMe(); renderTurn(); renderLog(); updateActions(); }
  function renderMe(){
    const m = me(); if(!m) return;
    el.myName.textContent = m.name || '전투 참가자';
    el.myTeam.textContent = teamShort(m.team);
    if (m.avatar) el.myAvatar.src = m.avatar;
    const s = m.stats||{};
    el.statATK.textContent = clamp(Number(s.attack||3),1,5);
    el.statDEF.textContent = clamp(Number(s.defense||3),1,5);
    el.statAGI.textContent = clamp(Number(s.agility||3),1,5);
    el.statLUK.textContent = clamp(Number(s.luck||3),1,5);
    const maxHp = Math.max(Number(m.maxHp||100),1);
    const hp = clamp(Number(m.hp||0),0,maxHp);
    const pct = Math.round((hp/maxHp)*100);
    el.myHpBar.style.width = pct + '%';
    el.myHpText.textContent = `${hp} / ${maxHp}`;
    const items = m.items || {};
    el.itemDittany.textContent = Number(items.dittany||0);
    el.itemAttack.textContent = Number(items.attack_booster||0);
    el.itemDefense.textContent = Number(items.defense_booster||0);
  }
  function renderTurn(){
    const b = state.battle || {};
    const team = teamFromCurrent(b.current || b.currentTeam || b.turnTeam || b.currentPlayerId, b.players);
    // 이름
    el.turnName.textContent = b.status==='active' ? (team==='eaters'?'B팀':'A팀') + ' 턴' : '대기 중';
    // 대표 이미지: 현재 턴 팀의 생존자 중 첫 번째 아바타
    let avatar = DEFAULT_AVATAR;
    if (Array.isArray(b.players)){
      const cand = b.players.find(p=>normTeam(p.team)===(team||'phoenix') && Number(p.hp)>0 && p.avatar);
      if (cand && cand.avatar) avatar = cand.avatar;
    }
    el.turnAvatar.src = avatar;

    // 턴 타이머 계산(서버 turnStartTime 기반) :contentReference[oaicite:4]{index=4}
    if (b.turnStartTime){
      const started = new Date(b.turnStartTime).getTime();
      const left = TURN_MS - Math.max(0, Date.now()-started);
      startTurnTimer(left);
    }
  }
  function renderLog(){
    const list = Array.isArray(state.battle?.log) ? state.battle.log : [];
    el.logBox.innerHTML = '';
    for (const l of list.slice(-200)){
      const div = document.createElement('div');
      div.className = 'entry mono' + (l.type==='chat'?' chat':'');
      div.textContent = cleanLog(l.message||'');
      el.logBox.appendChild(div);
    }
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }
  function appendLog(type,msg){
    const div = document.createElement('div');
    div.className = 'entry mono' + (type==='chat'?' chat':'');
    div.textContent = cleanLog(msg);
    el.logBox.appendChild(div);
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }
  function appendChat(name,message){
    appendLog('chat', `[채팅] ${name||'익명'}: ${message||''}`);
  }

  // 액션 활성화
  function isMyTurn(){
    const b = state.battle || {};
    const m = me(); if (!m || b.status!=='active') return false;
    const cur = b.current || b.currentTeam || b.turnTeam || b.currentPlayerId;
    if (String(cur)===String(m.id)) return true;
    const t = teamFromCurrent(cur, b.players);
    return t && t===normTeam(m.team);
  }
  function updateActions(){
    const enable = isMyTurn() && (me()?.hp>0);
    const set = (btn)=>{ if(!btn) return; btn.disabled = !enable; };
    [el.btnAttack,el.btnDefend,el.btnDodge,el.btnPass,el.btnItemDittany,el.btnItemAttack,el.btnItemDefense].forEach(set);
  }

  // 턴 타이머
  function startTurnTimer(ms){
    clearTurnTimer();
    const left = Math.max(0, Math.floor(ms));
    if (!left){ el.turnTimer.textContent='턴 시간: --'; return; }
    state.turnEndsAt = Date.now()+left;
    tickTurn(); state.turnTimerId = setInterval(tickTurn, 500);
  }
  function clearTurnTimer(){
    if (state.turnTimerId){ clearInterval(state.turnTimerId); state.turnTimerId=0; }
    state.turnEndsAt = 0;
    el.turnTimer.textContent = '턴 시간: --';
  }
  function tickTurn(){
    const left = state.turnEndsAt - Date.now();
    if (left<=0){ clearTurnTimer(); return; }
    el.turnTimer.textContent = `남은 시간: ${Math.ceil(left/1000)}초`;
  }

  // 액션 전송 / 준비
  function ensureReady(){ if(!state.battle || !state.battle.id || !state.meId){ alert('인증이 필요합니다.'); return false;} return true; }
  function sendAction(type, extra={}){
    if (!ensureReady()) return;
    if (!isMyTurn()) return alert('당신의 턴이 아닙니다.');
    state.socket.emit('player:action', { battleId: state.battle.id, playerId: state.meId, action: { type, ...extra } });
  }

  // 타겟 없는 기본 전송
  el.btnDefend?.addEventListener('click', ()=> sendAction('defend'));
  el.btnDodge ?.addEventListener('click', ()=> sendAction('dodge'));
  el.btnPass  ?.addEventListener('click', ()=> sendAction('pass'));
  el.btnItemAttack ?.addEventListener('click', ()=> sendAction('item', { itemType:'attack_booster' }));
  el.btnItemDefense?.addEventListener('click', ()=> sendAction('item', { itemType:'defense_booster' }));
  // 공격/디터니는 간단 선택(없으면 기본값)
  el.btnAttack?.addEventListener('click', ()=>{
    const b = state.battle||{}; const m = me(); if(!m) return;
    const enemies = (b.players||[]).filter(p=>normTeam(p.team)!==normTeam(m.team) && p.hp>0);
    const target = enemies[0]; if(!target) return alert('공격 대상 없음');
    sendAction('attack', { targetId: target.id });
  });
  el.btnItemDittany?.addEventListener('click', ()=> sendAction('item', { itemType:'dittany', targetId: state.meId }));

  // 준비
  el.btnReady?.addEventListener('click', ()=>{
    if (!ensureReady()) return;
    state.socket.emit('player:ready', { battleId: state.battle.id, playerId: state.meId });
  });

  // 채팅
  function sendChat(){
    const msg = (el.chatInput.value||'').trim(); if(!msg) return;
    state.socket.emit('chat:send', { battleId: state.battle?.id, name: me()?.name || '익명', message: msg, role: 'player' });
    el.chatInput.value='';
  }
  el.btnChat?.addEventListener('click', sendChat);
  el.chatInput?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(); });

  // 인증 초기화
  el.btnAuth?.addEventListener('click', ()=>{ showOverlay(true); onAuth(); });
  function auto(){
    connect();
    // URL 자동인증(+ 로딩 동그라미)
    autoFromURL();
  }
  document.addEventListener('DOMContentLoaded', auto);
})();
