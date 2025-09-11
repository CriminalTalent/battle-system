// /public/assets/js/admin.js
// - 전투 생성/컨트롤, 링크 생성, 참가자 추가
// - 버튼 활성화에 btnAdd 포함
// - 숫자 입력 NaN 가드
// - 참가자 추가 후 즉시 onBattleUpdate 반영 (브로드캐스트 지연 대비)
// - 표기/디자인/룰 변경 없음

(function(){
  "use strict";

  // ===== DOM =====
  const byId = (id)=>document.getElementById(id);

  const els = {
    mode: byId('mode'),
    battleMeta: byId('battleMeta'),
    connDot: byId('connDot'),
    // 컨트롤
    btnCreate: byId('btnCreate'),
    btnStart: byId('btnStart'),
    btnPause: byId('btnPause'),
    btnResume: byId('btnResume'),
    btnEnd: byId('btnEnd'),
    // 링크
    btnGenPlayer: byId('btnGenPlayer'),
    playerLinks: byId('playerLinks'),
    spectatorOtp: byId('spectatorOtp'),
    spectatorUrl: byId('spectatorUrl'),
    btnGenSpectator: byId('btnGenSpectator'),
    btnBuildSpectator: byId('btnBuildSpectator'),
    // 추가
    pName: byId('pName'),
    pTeam: byId('pTeam'),
    pHp: byId('pHp'),
    sAtk: byId('sAtk'), sDef: byId('sDef'), sLuk: byId('sLuk'), sAgi: byId('sAgi'),
    iDit: byId('iDit'), iAtkB: byId('iAtkB'), iDefB: byId('iDefB'),
    btnAdd: byId('btnAdd'),
    // 테이블
    listA: byId('listA').querySelector('tbody'),
    listB: byId('listB').querySelector('tbody'),
    // 로그/채팅
    log: byId('log'),
    chat: byId('chat'),
    chatMsg: byId('chatMsg'),
    btnSend: byId('btnSend'),
    // 토스트
    toast: byId('toast'),
  };

  // ===== 상태 =====
  let socket = null;
  let API = ''; // 동일 오리진 사용
  let battleId = null;
  let lastSnap = null;

  // ===== 유틸 =====
  const safeNum = (v, d=0)=>{ const n = Number(v); return (Number.isNaN(n) ? d : n); };
  const clampNum = (n, min, max)=> Math.max(min, Math.min(max, n));
  const toast = (msg)=>{ if(!els.toast) return; els.toast.textContent = msg; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 1600); };
  async function copyToClipboard(text){ try{ await navigator.clipboard.writeText(text); toast('복사 완료'); } catch{ toast('복사 실패'); } }
  const makeAbsolute = (path)=> new URL(path, window.location.origin).toString();

  function setConn(on){ if(!els.connDot) return; els.connDot.classList.toggle('ok', !!on); }

  function setCtrlEnabled(on){
    // btnAdd 포함(중요)
    [els.btnCreate, els.btnStart, els.btnPause, els.btnResume, els.btnEnd, els.btnGenPlayer, els.btnBuildSpectator, els.btnGenSpectator, els.btnSend, els.btnAdd]
      .forEach(b=>{ if(b) b.disabled = !on; });
    // 시작/일시정지/재개는 상태에 따라 onBattleUpdate에서 다시 세부 토글
  }

  function renderBattleMeta(snap){
    if(!els.battleMeta) return;
    if(!snap){
      els.battleMeta.textContent = '대기 중';
      return;
    }
    const st = snap.status || 'waiting';
    const mode = snap.mode || '-';
    els.battleMeta.textContent = `상태 ${st} · 모드 ${mode} · ID ${snap.id || '-'}`;
  }

  // ===== 초기화 =====
  function init(){
    bindUI();
    connect();
  }

  function bindUI(){
    els.btnCreate.addEventListener('click', onCreateBattle);
    els.btnStart.addEventListener('click', ()=> adminAction('start'));
    els.btnPause.addEventListener('click', ()=> adminAction('pause'));
    els.btnResume.addEventListener('click',()=> adminAction('resume'));
    els.btnEnd.addEventListener('click',   ()=> adminAction('end'));

    els.btnGenPlayer.addEventListener('click', onGeneratePlayerLinks);
    els.btnGenSpectator.addEventListener('click', onGenerateSpectatorOtp);
    els.btnBuildSpectator.addEventListener('click', onBuildSpectatorUrl);

    els.btnAdd.addEventListener('click', onAddPlayer);

    els.btnSend.addEventListener('click', sendChat);
    els.chatMsg.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
  }

  function connect(){
    socket = io(window.location.origin, { path:'/socket.io', transports:['websocket','polling'], withCredentials:true, timeout:20000 });

    socket.on('connect', ()=> setConn(true));
    socket.on('disconnect', ()=> setConn(false));

    // 관리자 인증(서버가 요구하면 여기에 구현)
    // socket.emit('adminAuth', { token: '...' });

    // 상태 업데이트(신/구 호환)
    socket.on('battleUpdate', onBattleUpdate);
    socket.on('battle:update', onBattleUpdate);

    // 로그/채팅
    socket.on('battle:log', ({message})=> appendLog(message||''));
    socket.on('battle:chat', ({name, message})=> appendChat(name||'전투 참가자', message||''));
  }

  // ===== 전투 생성/제어 =====
  async function onCreateBattle(){
    try{
      const mode = els.mode.value || '4v4';
      const res = await fetch(`${API}/api/battles`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ mode })
      });
      if(!res.ok) throw new Error('전투 생성 실패');
      const battle = await res.json();
      battleId = battle?.id || battle?.battleId || null;
      toast('전투가 생성되었습니다');

      // 소켓 룸 합류/업데이트 요청
      socket.emit('join', { battleId });

      // UI 업데이트
      onBattleUpdate(battle);
      setCtrlEnabled(true);
      els.btnStart.disabled = false;
      els.btnAdd.disabled = false;
      els.btnGenPlayer.disabled = false;
      els.btnGenSpectator.disabled = false;
      els.btnBuildSpectator.disabled = false;
    }catch(e){
      alert(e.message||'전투 생성 실패');
    }
  }

  function adminAction(kind){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    // 소켓 이벤트(신/구 호환)
    if(kind==='start'){
      socket.emit('startBattle', { battleId });
      socket.emit('battle:start', { battleId });
    }else if(kind==='pause'){
      socket.emit('pauseBattle', { battleId });
      socket.emit('battle:pause', { battleId });
    }else if(kind==='resume'){
      socket.emit('resumeBattle', { battleId });
      socket.emit('battle:resume', { battleId });
    }else if(kind==='end'){
      socket.emit('endBattle', { battleId });
      socket.emit('battle:end', { battleId });
    }
  }

  function onBattleUpdate(snap){
    if(!snap) return;
    lastSnap = snap;
    battleId = snap.id || battleId;

    renderBattleMeta(snap);

    // 컨트롤 상태
    const st = snap.status || 'waiting';
    els.btnStart.disabled  = !(st==='waiting' || st==='paused');
    els.btnPause.disabled  = !(st==='active');
    els.btnResume.disabled = !(st==='paused');
    els.btnEnd.disabled    = (st==='ended');

    // 링크/추가 활성화
    const linkEnabled = !!battleId && st!=='ended';
    els.btnGenPlayer.disabled = !linkEnabled;
    els.btnGenSpectator.disabled = !linkEnabled;
    els.btnBuildSpectator.disabled = !linkEnabled;
    els.btnAdd.disabled = !linkEnabled;

    // 팀 테이블 그리기
    renderLists(snap);
  }

  // ===== 링크 생성 =====
  async function onGeneratePlayerLinks(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      // 서버에 OTP/링크 묶음 요청(엔드포인트가 다를 경우 맞춰 주세요)
      // 표준: POST /api/admin/battles/:id/links
      const res = await fetch(`${API}/api/admin/battles/${battleId}/links`, { method:'POST' });
      if(!res.ok) throw new Error('링크 생성 실패');
      const data = await res.json();
      const links = data?.playerLinks || data?.links || []; // [{name, url, token}] 등

      els.playerLinks.innerHTML = '';
      links.forEach((ln, idx)=>{
        const row = document.createElement('div');
        row.className = 'link-row';
        row.innerHTML = `
          <div class="label">${idx+1}</div>
          <input type="text" value="${ln.url || ''}" readonly/>
          <button class="btn">복사</button>
        `;
        const input = row.querySelector('input');
        row.querySelector('button').addEventListener('click', ()=> copyToClipboard(input.value));
        els.playerLinks.appendChild(row);
      });

      toast('참여자 링크가 생성되었습니다');
    }catch(e){
      alert(e.message||'링크 생성 실패');
    }
  }

  async function onGenerateSpectatorOtp(){
    if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
    try{
      const res = await fetch(`${API}/api/admin/battles/${battleId}/links`, { method:'POST' });
      if(!res.ok) throw new Error('관전자 비밀번호 발급 실패');
      const data = await res.json();
      // 서버가 반환하는 필드명에 맞춰 사용
      const otp = data?.spectatorOtp || data?.spectator?.otp || data?.otp || '';
      els.spectatorOtp.value = otp || '';
      toast('관전자 비밀번호가 발급되었습니다');
    }catch(e){
      alert(e.message||'관전자 비밀번호 발급 실패');
    }
  }

  function onBuildSpectatorUrl(){
    if(!battleId || !els.spectatorOtp.value){ toast('전투 ID/비밀번호를 확인하세요'); return; }
    const url = makeAbsolute(`/watch?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(els.spectatorOtp.value)}`);
    els.spectatorUrl.value = url;
    toast('관전자 링크가 생성되었습니다');
  }

  // ===== 참가자 추가 =====
  async function onAddPlayer(){
    if(!battleId){ toast('전투 생성부터 진행하세요.'); return; }
    try{
      const body = {
        name: (els.pName.value||'').trim(),
        team: els.pTeam.value,
        hp: clampNum(safeNum(els.pHp.value,100), 1, 100),
        stats:{
          attack:  clampNum(safeNum(els.sAtk.value,3), 1, 5),
          defense: clampNum(safeNum(els.sDef.value,3), 1, 5),
          luck:    clampNum(safeNum(els.sLuk.value,2), 1, 5),
          agility: clampNum(safeNum(els.sAgi.value,3), 1, 5),
        },
        items:{
          dittany:       clampNum(safeNum(els.iDit.value,0), 0, 99),
          attack_boost:  clampNum(safeNum(els.iAtkB.value,0), 0, 99),
          defense_boost: clampNum(safeNum(els.iDefB.value,0), 0, 99),
        },
        avatar: '' // 업로드 별도
      };
      if(!body.name){ toast('이름을 입력하세요'); return; }

      const res = await fetch(`${API}/api/battles/${battleId}/players`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
      });
      if(!res.ok) throw new Error('참가자 추가 실패');
      const data = await res.json();

      toast('참가자 추가 완료');

      // 즉시 화면 갱신(브로드캐스트 지연 대비)
      if(data?.battle){
        onBattleUpdate(data.battle);
      }else{
        // 없으면 상태 GET으로 갱신
        try{
          const r2 = await fetch(`${API}/api/battles/${battleId}`);
          if(r2.ok){ const snap = await r2.json(); onBattleUpdate(snap); }
        }catch(_){}
      }

      // 입력 초기화
      els.pName.value='';
    }catch(e){
      alert(e.message||'참가자 추가 실패');
    }
  }

  // ===== 테이블 렌더 =====
  function renderLists(snap){
    if(!snap) return;
    const players = snap.players || [];
    const A = players.filter(p=> toAB(p.team)==='A');
    const B = players.filter(p=> toAB(p.team)==='B');

    const drawRow = (p)=>{
      const maxHp = p.maxHp ?? 100;
      const stat = p.stats || {};
      const items = p.items || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.name||'-')}</td>
        <td>${p.hp}/${maxHp}</td>
        <td>공 ${stat.attack ?? '-'} · 방 ${stat.defense ?? '-'} · 민 ${stat.agility ?? '-'} · 운 ${stat.luck ?? '-'}</td>
        <td>디터니 ${items.dittany ?? 0} · 공보 ${items.attack_boost ?? 0} · 방보 ${items.defense_boost ?? 0}</td>
        <td>${p.ready ? '준비' : '-'}</td>
      `;
      return tr;
    };

    els.listA.innerHTML = ''; A.forEach(p=> els.listA.appendChild(drawRow(p)));
    els.listB.innerHTML = ''; B.forEach(p=> els.listB.appendChild(drawRow(p)));
  }

  function toAB(team){
    const s = String(team||'').toLowerCase();
    if(s==='phoenix' || s==='a') return 'A';
    if(s==='eaters'  || s==='b' || s==='death') return 'B';
    return '-';
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }

  // ===== 로그/채팅 =====
  function appendLog(msg){
    const d = document.createElement('div');
    d.textContent = msg;
    els.log.appendChild(d);
    els.log.scrollTop = els.log.scrollHeight;
  }
  function appendChat(sender, text){
    const d = document.createElement('div');
    d.textContent = `${sender}: ${text}`;
    els.chat.appendChild(d);
    els.chat.scrollTop = els.chat.scrollHeight;
  }
  function sendChat(){
    const text = (els.chatMsg.value||'').trim();
    if(!text || !battleId) return;
    socket.emit('chatMessage', { battleId, message: text });
    socket.emit('chat:send', { battleId, name: '관리자', message: text, role:'admin' });
    els.chatMsg.value='';
  }

  // ===== 시작 =====
  document.addEventListener('DOMContentLoaded', init);
})();
