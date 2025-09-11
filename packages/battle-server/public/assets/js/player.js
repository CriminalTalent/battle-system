/* PYXIS 전투 참가자 클라이언트
   - 자동 로그인: 소켓 connect 이후 인증 emit
   - 팀 표기 A/B 치환, 로그 꼬리표 제거
   - 현재 턴 이미지(라운드 사각형, 4:3, contain)
   - 턴 타이머(5분) 표시
   - 내 턴에만 액션 버튼 활성화
*/
(() => {
  const $ = (s, r=document)=>r.querySelector(s);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
  const TURN_MS = 5 * 60 * 1000;

  const el = {
    // 뷰/오버레이
    viewAuth: $('#authView'),
    viewMain: $('#mainView'),
    overlay: $('#loadingOverlay'),
    // 인증
    inBattle: $('#battleId'),
    inName: $('#playerName'),
    inToken: $('#authToken'),
    btnAuth: $('#btnAuth'),
    // 내 정보
    myAvatar: $('#myAvatar'), myName: $('#myName'), myTeam: $('#myTeam'),
    statATK: $('#statATK'), statDEF: $('#statDEF'), statAGI: $('#statAGI'), statLUK: $('#statLUK'),
    hpBar: $('#myHpBar'), hpText: $('#myHpText'),
    // 중앙
    turnAvatar: $('#turnAvatar'), turnName: $('#turnName'), turnTimer: $('#turnTimer'), logBox: $('#battleLog'),
    // 액션
    btnReady: $('#btnReady'),
    btnAttack: $('#btnAttack'), btnDefend: $('#btnDefend'), btnDodge: $('#btnDodge'), btnPass: $('#btnPass'),
    btnItemDittany: $('#btnItemDittany'), btnItemAttack: $('#btnItemAttack'), btnItemDefense: $('#btnItemDefense'),
    // 채팅
    chatBox: $('#chatMessages'), chatInput: $('#chatInput'), btnChat: $('#btnChat')
  };

  const state = {
    socket: null, battle: null, meId: null,
    pendingAuth: null,
    turnEndsAt: 0, turnTimerId: 0
  };

  // 팀 유틸
  const normTeam = (t)=>{
    const k = String(t||'').toLowerCase();
    if (k==='phoenix' || k==='a') return 'phoenix';
    if (k==='eaters' || k==='death' || k==='b') return 'eaters';
    return 'phoenix';
  };
  const teamShort = (t)=> normTeam(t)==='eaters' ? 'B팀' : 'A팀';

  function showOverlay(on){ el.overlay?.classList.toggle('show', !!on); }
  function showMain(){ el.viewAuth.style.display='none'; el.viewMain.style.display=''; }

  // 연결
  function connect(){
    if (!window.io) return alert('Socket.IO 로드 실패');
    state.socket = window.io({ transports:['websocket','polling'], withCredentials:true });

    state.socket.on('connect', ()=>{
      if (state.pendingAuth){
        state.socket.emit('playerAuth', state.pendingAuth);
        state.pendingAuth = null;
      }
    });

    state.socket.on('auth:success', (p)=>{
      if (p.role!=='player') return;
      state.meId = p.playerId || p.player?.id || null;
      if (p.battle) state.battle = p.battle;
      showOverlay(false); showMain();
      state.socket.emit('join', { battleId: p.battleId || p.battle?.id });
      renderAll();
    });

    state.socket.on('authError', (e)=>{ showOverlay(false); alert('인증 실패: ' + (e?.error||'')); });

    state.socket.on('battle:update', (b)=>{ state.battle = b; renderAll(); });
    state.socket.on('battle:log', (e)=> appendLog(e?.type||'system', e?.message||''));
    state.socket.on('battle:chat', ({name,message})=> appendLog('chat', `[채팅] ${name||'익명'}: ${message||''}`));
  }

  // 자동 로그인
  function autoFromURL(){
    const q = new URLSearchParams(location.search);
    const battle = q.get('battle'); const name = q.get('name'); const token = q.get('token');
    if (battle) el.inBattle.value = battle;
    if (name) el.inName.value = name;
    if (token) el.inToken.value = token;
    if (battle && name && token){
      showOverlay(true);
      state.pendingAuth = { battleId:battle, name, token }; // connect 이후 emit
    }
  }

  // 수동 인증
  el.btnAuth?.addEventListener('click', ()=>{
    const battleId = (el.inBattle.value||'').trim();
    const name = (el.inName.value||'').trim();
    const token = (el.inToken.value||'').trim();
    if (!battleId || !name || !token) return alert('전투 ID/이름/비밀번호를 모두 입력하세요.');
    showOverlay(true);
    if (!state.socket || state.socket.disconnected){
      state.pendingAuth = { battleId, name, token };
      return;
    }
    state.socket.emit('playerAuth', { battleId, name, token });
  });

  // 렌더링
  function me(){ const id=state.meId; return (state.battle?.players||[]).find(p=>p.id===id)||null; }
  function renderAll(){ if(!state.battle) return; renderMe(); renderTurn(); renderLog(); updateActions(); }

  function renderMe(){
    const m = me(); if(!m) return;
    el.myName.textContent = m.name || '전투 참가자';
    el.myTeam.textContent = teamShort(m.team);
    el.myAvatar.src = m.avatar || DEFAULT_AVATAR;

    const s = m.stats||{};
    el.statATK.textContent = clamp(Number(s.attack||3),1,10);
    el.statDEF.textContent = clamp(Number(s.defense||3),1,10);
    el.statAGI.textContent = clamp(Number(s.agility||3),1,10);
    el.statLUK.textContent = clamp(Number(s.luck||3),1,10);

    const maxHp = Math.max(Number(m.maxHp||100),1);
    const hp = clamp(Number(m.hp||0),0,maxHp);
    el.hpBar.style.width = Math.round(hp/maxHp*100) + '%';
    el.hpText.textContent = `${hp} / ${maxHp}`;
  }

  function renderTurn(){
    const b = state.battle || {};
    const curTeam = normTeam(b.currentTeam || b.current || b.turnTeam || 'phoenix');

    // 이름
    el.turnName.textContent = b.status==='active' ? (curTeam==='eaters'?'B팀':'A팀') + ' 턴' : '대기 중';

    // 대표 이미지(해당 팀의 생존자 중 첫 번째)
    let avatar = DEFAULT_AVATAR;
    if (Array.isArray(b.players)){
      const cand = b.players.find(p=>normTeam(p.team)===curTeam && Number(p.hp)>0 && p.avatar);
      if (cand && cand.avatar) avatar = cand.avatar;
    }
    if (!avatar) avatar = DEFAULT_AVATAR;
    el.turnAvatar.src = avatar;

    // 턴 타이머
    if (b.turnStartTime){
      const left = Math.max(0, TURN_MS - (Date.now() - Number(b.turnStartTime)));
      startTurnTimer(left);
    } else {
      clearTurnTimer();
    }
  }

  // 로그
  function cleanLog(msg){
    let s = String(msg||'');
    s = s.replace(/\bphoenix\b/gi,'A팀').replace(/\b(eaters|death)\b/gi,'B팀');
    s = s.replace(/\s*\((민첩성|행운|주사위|공격력|방어력)[^)]+\)/g,'');
    return s.trim();
  }
  function renderLog(){
    const list = Array.isArray(state.battle?.log) ? state.battle.log : [];
    el.logBox.innerHTML = '';
    list.slice(-200).forEach(l=> appendLog(l.type||'system', l.message||'', true));
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }
  function appendLog(type,msg,appendOnly=false){
    const div=document.createElement('div');
    div.className='entry mono' + (type==='chat'?' chat':'');
    div.textContent = cleanLog(msg);
    el.logBox.appendChild(div);
    if(!appendOnly) el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  // 액션 활성화: 내 팀 턴에만
  function isMyTurn(){
    const b = state.battle||{}; const m = me(); if(!m || b.status!=='active') return false;
    const curTeam = normTeam(b.currentTeam || b.current || b.turnTeam || 'phoenix');
    return normTeam(m.team) === curTeam && m.hp > 0;
  }
  function updateActions(){
    const en = isMyTurn();
    [el.btnAttack,el.btnDefend,el.btnDodge,el.btnPass,el.btnItemDittany,el.btnItemAttack,el.btnItemDefense]
      .forEach(btn=>{ if(btn) btn.disabled = !en; });
  }

  // 턴 타이머
  function startTurnTimer(ms){
    clearTurnTimer();
    const end = Date.now() + Math.max(0, ms);
    tick();
    state.turnTimerId = setInterval(tick, 500);
    function tick(){
      const left = end - Date.now();
      if (left <= 0){ clearTurnTimer(); return; }
      el.turnTimer.textContent = `남은 시간: ${Math.ceil(left/1000)}초`;
    }
  }
  function clearTurnTimer(){
    if (state.turnTimerId){ clearInterval(state.turnTimerId); state.turnTimerId = 0; }
    el.turnTimer.textContent = '턴 시간: --';
  }

  // 채팅
  function sendChat(){
    const msg = (el.chatInput.value||'').trim(); if(!msg) return;
    const b = state.battle; if(!b?.id) return;
    const my = me();
    state.socket.emit('chat:send', { battleId:b.id, name: my?.name || '익명', message: msg, role:'player' });
    el.chatInput.value='';
  }
  el.btnChat?.addEventListener('click', sendChat);
  el.chatInput?.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

  // 준비
  el.btnReady?.addEventListener('click', ()=>{
    const b = state.battle; const id = state.meId;
    if (!b?.id || !id) return alert('인증이 필요합니다.');
    state.socket.emit('player:ready', { battleId: b.id, playerId: id });
  });

  // 기본 액션(간단 타깃팅)
  el.btnDefend?.addEventListener('click', ()=> sendAction('defend'));
  el.btnDodge ?.addEventListener('click', ()=> sendAction('dodge'));
  el.btnPass  ?.addEventListener('click', ()=> sendAction('pass'));
  el.btnItemAttack ?.addEventListener('click', ()=> sendAction('item', { itemType:'attack_booster' }));
  el.btnItemDefense?.addEventListener('click', ()=> sendAction('item', { itemType:'defense_booster' }));
  el.btnItemDittany?.addEventListener('click', ()=> sendAction('item', { itemType:'dittany', targetId: state.meId }));
  el.btnAttack?.addEventListener('click', ()=>{
    const b = state.battle||{}; const m = me(); if(!m) return;
    const target = (b.players||[]).find(p=>normTeam(p.team)!==normTeam(m.team) && p.hp>0);
    if (!target) return alert('공격 대상 없음');
    sendAction('attack', { targetId: target.id });
  });

  function sendAction(type, extra={}){
    const b = state.battle; const id = state.meId;
    if (!b?.id || !id) return alert('인증이 필요합니다.');
    if (!isMyTurn()) return alert('지금은 당신의 턴이 아닙니다.');
    state.socket.emit('player:action', { battleId:b.id, playerId:id, action:{ type, ...extra } });
  }

  // 시작
  document.addEventListener('DOMContentLoaded', ()=>{
    connect();
    autoFromURL();
  });
})();
