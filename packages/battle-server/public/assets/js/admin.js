// packages/battle-server/public/assets/js/admin.js
// PYXIS 관리자 페이지 JavaScript - 자동로그인 링크 생성 개선 버전
(() => {
  'use strict';

  let socket = null;
  let battleId = null;

  // -------- DOM 요소 --------
  const els = {
    // 메타 정보
    metaStatus: document.getElementById('metaStatus'),
    metaMode: document.getElementById('metaMode'),
    metaId: document.getElementById('metaId'),
    
    // 전투 제어
    mode: document.getElementById('mode'),
    btnCreate: document.getElementById('btnCreate'),
    btnStart: document.getElementById('btnStart'),
    btnPause: document.getElementById('btnPause'),
    btnResume: document.getElementById('btnResume'),
    btnEnd: document.getElementById('btnEnd'),
    
    // 링크 생성
    btnGenPlayer: document.getElementById('btnGenPlayer'),
    btnGenSpectator: document.getElementById('btnGenSpectator'),
    btnBuildSpectator: document.getElementById('btnBuildSpectator'),
    spectatorOtp: document.getElementById('spectatorOtp'),
    spectatorUrl: document.getElementById('spectatorUrl'),
    playerLinks: document.getElementById('playerLinks'),
    
    // 플레이어 추가
    pName: document.getElementById('pName'),
    pTeam: document.getElementById('pTeam'),
    pHp: document.getElementById('pHp'),
    pAvatar: document.getElementById('pAvatar'),
    preview: document.getElementById('preview'),
    btnAddPlayer: document.getElementById('btnAddPlayer'),
    
    // 스탯
    sAtk: document.getElementById('sAtk'),
    sDef: document.getElementById('sDef'),
    sAgi: document.getElementById('sAgi'),
    sLuk: document.getElementById('sLuk'),
    
    // 아이템
    iDit: document.getElementById('iDit'),
    iAtkB: document.getElementById('iAtkB'),
    iDefB: document.getElementById('iDefB'),
    
    // 팀 목록
    listA: document.getElementById('listA'),
    listB: document.getElementById('listB'),
    
    // 로그 & 채팅
    log: document.getElementById('log'),
    chat: document.getElementById('chat'),
    chatMsg: document.getElementById('chatMsg'),
    btnSend: document.getElementById('btnSend'),
    
    // 연결 상태
    connText: document.getElementById('connText'),
    connDot: document.getElementById('connDot')
  };

  // -------- 초기화 --------
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    autoJoinFromURL();
    await connectSocket();
  }

  function bindEvents() {
    // 전투 제어 버튼
    els.btnCreate?.addEventListener('click', onCreateBattle);
    els.btnStart?.addEventListener('click', () => adminAction('start'));
    els.btnPause?.addEventListener('click', () => adminAction('pause'));
    els.btnResume?.addEventListener('click', () => adminAction('resume'));
    els.btnEnd?.addEventListener('click', () => adminAction('end'));
    
    // 링크 생성 버튼
    els.btnGenPlayer?.addEventListener('click', onGeneratePlayerLinks);
    els.btnGenSpectator?.addEventListener('click', onGenerateSpectatorOtp);
    els.btnBuildSpectator?.addEventListener('click', onBuildSpectatorUrl);
    
    // 플레이어 추가
    els.btnAddPlayer?.addEventListener('click', onAddPlayer);
    els.pAvatar?.addEventListener('change', onAvatarChange);
    
    // 채팅
    els.btnSend?.addEventListener('click', sendChat);
    els.chatMsg?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChat();
    });
  }

  // -------- 소켓 연결 --------
  async function connectSocket() {
    if (socket?.connected) return true;

    return new Promise((resolve) => {
      const base = window.location.origin;
      const ioOpts = {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        timeout: 20000,
        reconnection: true,
        reconnectionAttempts: 12,
        reconnectionDelay: 400,
        reconnectionDelayMax: 3000,
        forceNew: true,
        query: { role: 'admin' }
      };

      try {
        socket = io(base, ioOpts);
      } catch (e) {
        appendLog(`소켓 생성 에러: ${e.message || e}`);
        return resolve(false);
      }

      let settled = false;
      const done = (ok) => { 
        if (!settled) { 
          settled = true; 
          resolve(ok); 
        } 
      };

      socket.once('connect', () => {
        setConn(true);
        bindSocketEvents();
        done(true);
      });

      socket.once('connect_error', (err) => {
        setConn(false);
        appendLog(`connect_error: ${err?.message || err}`);
      });

      setTimeout(() => {
        if (socket?.connected) return;
        done(false);
        try { 
          socket?.off(); 
          socket?.close(); 
        } catch (_) {}
      }, 2500);
    });
  }

  function bindSocketEvents() {
    if (!socket) return;

    ['battleUpdate', 'battle:update', 'battleState', 'state:update'].forEach(ev => {
      socket.on(ev, onBattleUpdate);
    });

    socket.on('disconnect', () => setConn(false));
    socket.on('battleLog', (m) => appendLog(typeof m === 'string' ? m : (m?.message || JSON.stringify(m))));
    socket.on('battle:log', ({ message }) => appendLog(message || ''));
    socket.on('actionSuccess', (m) => appendLog(formatActionLog('성공', m)));
    socket.on('actionError', (m) => appendLog(formatActionLog('오류', m)));
    socket.on('playerReady', (m) => appendLog(formatActionLog('준비', m)));
    socket.on('player:ready', (m) => appendLog(formatActionLog('준비', m)));
    socket.on('playerAction', (m) => appendLog(formatActionLog('행동', m)));
    socket.on('player:action', (m) => appendLog(formatActionLog('행동', m)));

    socket.on('chatMessage', (payload) => {
      if (typeof payload === 'string') { 
        appendChat('플레이어', payload); 
      } else { 
        appendChat(payload?.name || payload?.senderName || '플레이어', payload?.message || ''); 
      }
    });
    socket.on('chat:message', (payload) => appendChat(payload?.name || payload?.senderName || '플레이어', payload?.message || ''));
    socket.on('battle:chat', ({ name, message }) => appendChat(name || '플레이어', message || ''));

    socket.on('battle:created', (battle) => onBattleCreatedViaSocket(battle));
    socket.on('admin:created', (payload) => onBattleCreatedViaSocket(payload?.battle));
  }

  // -------- 전투 관리 --------
  async function onCreateBattle() {
    const mode = els.mode?.value || '2v2';
    
    if (!socket?.connected) {
      toast('서버 연결을 확인하세요');
      return;
    }

    try {
      socket.emit('createBattle', { mode }, (response) => {
        if (response?.ok) {
          battleId = response.battleId;
          updateMeta(response.battle);
          updateButtons('waiting');
          appendLog(`전투 생성됨: ${battleId} (${mode})`);
          toast('전투가 생성되었습니다');
        } else {
          appendLog(`전투 생성 실패: ${response?.error || '알 수 없는 오류'}`);
          toast('전투 생성에 실패했습니다', 'error');
        }
      });
    } catch (e) {
      appendLog(`전투 생성 에러: ${e.message}`);
      toast('전투 생성 중 오류가 발생했습니다', 'error');
    }
  }

  async function onAddPlayer() {
    if (!validateInputs()) return;
    if (!battleId) {
      toast('전투를 먼저 생성하세요');
      return;
    }

    const player = {
      name: els.pName.value.trim(),
      team: els.pTeam.value || 'A',
      hp: parseInt(els.pHp.value) || 100,
      stats: {
        attack: parseInt(els.sAtk.value) || 1,
        defense: parseInt(els.sDef.value) || 1,
        agility: parseInt(els.sAgi.value) || 1,
        luck: parseInt(els.sLuk.value) || 1
      },
      items: {
        dittany: parseInt(els.iDit.value) || 0,
        attackBooster: parseInt(els.iAtkB.value) || 0,
        defenseBooster: parseInt(els.iDefB.value) || 0
      }
    };

    socket.emit('addPlayer', { battleId, player }, (ack) => {
      if (!ack || ack.error) {
        appendLog(`참가자 추가 실패: ${ack?.error || '응답 없음'}`);
        toast('참가자 추가에 실패했습니다', 'error');
      } else {
        appendLog(`참가자 추가됨: ${player.name} (${player.team}팀)`);
        toast(`${player.name}님이 ${player.team}팀에 추가되었습니다`);
        clearPlayerForm();
      }
    });
  }

  // -------- 링크 생성 (자동로그인 지원) --------
  async function onGeneratePlayerLinks() {
    if (!battleId) { 
      toast('전투 생성 후 이용하세요'); 
      return; 
    }
    
    try {
      let res = await fetch(`/api/admin/battles/${battleId}/links`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      
      if (!res.ok) { 
        res = await fetch(`/api/battles/${battleId}/links`, { 
          method: 'POST', 
          credentials: 'include' 
        }); 
      }
      
      if (!res.ok) throw new Error('링크 생성 실패');
      
      const data = await res.json();
      const links = data?.playerLinks || data?.links || [];

      els.playerLinks.innerHTML = '';
      
      links.forEach((link, i) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '38px 1fr 72px';
        row.style.gap = '6px';
        row.style.marginBottom = '4px';
        
        // 플레이어 정보 표시 개선
        const playerInfo = `${link.playerName || `플레이어${i+1}`} (${link.team}팀)`;
        
        row.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;">
            ${i+1}
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="font-size:12px;color:var(--text-muted);">${playerInfo}</div>
            <input type="text" class="mono" value="${link.url || ''}" readonly style="font-size:11px;"/>
          </div>
          <button class="btn" style="padding:4px 8px;font-size:12px;">복사</button>
        `;
        
        const input = row.querySelector('input');
        const copyBtn = row.querySelector('button');
        
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(input.value);
            toast(`${playerInfo} 링크가 복사되었습니다`);
            
            // 복사 완료 시각적 피드백
            copyBtn.textContent = '완료';
            copyBtn.style.background = 'var(--success)';
            setTimeout(() => {
              copyBtn.textContent = '복사';
              copyBtn.style.background = '';
            }, 1500);
          } catch {
            toast('복사에 실패했습니다', 'error');
          }
        });
        
        els.playerLinks.appendChild(row);
      });
      
      toast('참가자 링크가 생성되었습니다');
    } catch (_) {
      toast('링크 생성에 실패했습니다', 'error');
    }
  }

  async function onGenerateSpectatorOtp() {
    if (!battleId) { 
      toast('전투 생성 후 이용하세요'); 
      return; 
    }
    
    try {
      let res = await fetch(`/api/admin/battles/${battleId}/links`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      
      if (!res.ok) { 
        res = await fetch(`/api/battles/${battleId}/links`, { 
          method: 'POST', 
          credentials: 'include' 
        }); 
      }
      
      if (!res.ok) throw new Error();
      
      const data = await res.json();
      const otp = data?.spectatorOtp || data?.spectator?.otp || data?.otp || '';
      els.spectatorOtp.value = otp || '';
      toast('관전자 비밀번호가 발급되었습니다');
    } catch (_) {
      toast('관전자 비밀번호 발급에 실패했습니다', 'error');
    }
  }

  async function onBuildSpectatorUrl() {
    if (!battleId) { 
      toast('전투 생성 후 이용하세요'); 
      return; 
    }
    
    const otp = (els.spectatorOtp.value || '').trim();
    if (!otp) { 
      toast('관전자 비밀번호 발급 후 이용하세요'); 
      return; 
    }

    const base = makeAbsolute('/spectator.html');
    const url = `${base}?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(otp)}`;
    els.spectatorUrl.value = url;

    try {
      await navigator.clipboard.writeText(url);
      toast('관전자 URL이 복사되었습니다');
    } catch (_) {
      toast('관전자 URL이 생성되었습니다');
    }
  }

  // -------- 유틸리티 --------
  function adminAction(action) {
    if (!battleId) {
      toast('전투를 먼저 생성하세요');
      return;
    }
    if (!socket || !socket.connected) {
      toast('서버 연결을 확인하세요');
      return;
    }

    socket.emit(`${action}Battle`, { battleId });
    appendLog(`${action} 요청`);
  }

  function validateInputs() {
    const name = (els.pName.value || '').trim();
    if (!name) { 
      toast('이름을 입력하세요'); 
      return false; 
    }

    const stats = ['sAtk', 'sDef', 'sAgi', 'sLuk'];
    for (const stat of stats) {
      const value = parseInt(els[stat].value);
      if (value < 1 || value > 5) {
        toast('스탯은 1~5 사이여야 합니다');
        return false;
      }
    }

    return true;
  }

  function clearPlayerForm() {
    els.pName.value = '';
    els.pHp.value = '100';
    els.sAtk.value = '3';
    els.sDef.value = '3';
    els.sAgi.value = '3';
    els.sLuk.value = '2';
    els.iDit.value = '0';
    els.iAtkB.value = '0';
    els.iDefB.value = '0';
    resetPreview();
  }

  function onAvatarChange() {
    const file = els.pAvatar.files[0];
    if (!file) { 
      resetPreview(); 
      return; 
    }
    
    const okTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!okTypes.includes(file.type)) { 
      toast('지원하지 않는 이미지 형식'); 
      els.pAvatar.value = ''; 
      resetPreview(); 
      return; 
    }
    
    const r = new FileReader();
    r.onload = () => { 
      els.preview.style.backgroundImage = `url('${r.result}')`; 
      els.preview.textContent = ''; 
    };
    r.readAsDataURL(file);
  }

  function resetPreview() { 
    els.preview.style.backgroundImage = 'none'; 
    els.preview.textContent = '미리보기'; 
  }

  // -------- UI 업데이트 --------
  function onBattleUpdate(snap) {
    if (!snap) return;
    updateMeta(snap);
    updateButtons(snap.status);
    renderLists(snap);
  }

  function onBattleCreatedViaSocket(battle) {
    if (!battle) return;
    battleId = battle.id;
    updateMeta(battle);
    updateButtons('waiting');
    appendLog(`전투 생성됨 (소켓): ${battle.id}`);
  }

  function updateMeta(battle) {
    if (!battle) return;
    els.metaStatus.textContent = getStatusText(battle.status);
    els.metaMode.textContent = battle.mode || '-';
    els.metaId.textContent = battle.id || '-';
  }

  function updateButtons(status) {
    const isWaiting = status === 'waiting';
    const isActive = status === 'active';
    const isPaused = status === 'paused';

    els.btnCreate.disabled = !isWaiting && battleId;
    els.btnStart.disabled = !isWaiting;
    els.btnPause.disabled = !isActive;
    els.btnResume.disabled = !isPaused;
    els.btnEnd.disabled = isWaiting && !battleId;
  }

  function getStatusText(status) {
    const statusMap = {
      waiting: '대기중',
      active: '진행중',
      paused: '일시정지',
      ended: '종료'
    };
    return statusMap[status] || '알 수 없음';
  }

  function renderLists(snap) {
    if (!snap) return;
    const players = snap.players || [];
    const A = players.filter(p => toAB(p.team) === 'A');
    const B = players.filter(p => toAB(p.team) === 'B');

    const drawRow = (p) => {
      const maxHp = p.maxHp ?? 100;
      const st = p.stats || {};
      const it = p.items || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.name || '-')}</td>
        <td>${p.hp}/${maxHp}</td>
        <td>공 ${st.attack ?? '-'} · 방 ${st.defense ?? '-'} · 민 ${st.agility ?? '-'} · 운 ${st.luck ?? '-'}</td>
        <td>디터니 ${it.dittany ?? 0} · 공보 ${it.attack_boost ?? 0} · 방보 ${it.defense_boost ?? 0}</td>
        <td>${p.ready ? '준비' : '-'}</td>
      `;
      return tr;
    };

    els.listA.innerHTML = '';
    A.forEach(p => els.listA.appendChild(drawRow(p)));
    els.listB.innerHTML = '';
    B.forEach(p => els.listB.appendChild(drawRow(p)));
  }

  // -------- 로그 & 채팅 --------
  function appendLog(msg) {
    const d = document.createElement('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    els.log.appendChild(d);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function appendChat(sender, text) {
    const d = document.createElement('div');
    d.textContent = `${sender}: ${text}`;
    els.chat.appendChild(d);
    els.chat.scrollTop = els.chat.scrollHeight;
  }

  function sendChat() {
    const text = (els.chatMsg.value || '').trim();
    if (!text || !battleId) return;
    
    if (socket && socket.connected) {
      socket.emit('chatMessage', { 
        battleId, 
        message: text, 
        role: 'admin', 
        name: '관리자' 
      });
      socket.emit('chat:send', { 
        battleId, 
        message: text, 
        role: 'admin', 
        name: '관리자' 
      });
    }
    
    els.chatMsg.value = '';
  }

  // -------- 연결 상태 --------
  function setConn(connected) {
    if (els.connText) {
      els.connText.textContent = connected ? '연결됨' : '연결 끊김';
    }
    if (els.connDot) {
      els.connDot.className = connected ? 'dot connected' : 'dot';
    }
  }

  // -------- URL 자동 인증 --------
  function autoJoinFromURL() {
    const p = new URLSearchParams(location.search);
    const b = p.get('battle');
    const t = p.get('token') || p.get('otp');
    
    if (b && t) {
      battleId = b;
      appendLog(`URL에서 자동 인증: ${b}`);
      // 필요시 추가 자동 인증 로직
    }
  }

  // -------- 헬퍼 함수 --------
  function toAB(team) {
    const s = String(team || '').toLowerCase();
    if (s === 'phoenix' || s === 'a' || s === 'team_a' || s === 'team-a') return 'A';
    if (s === 'eaters' || s === 'b' || s === 'death' || s === 'team_b' || s === 'team-b') return 'B';
    return 'A'; // 기본값
  }

  function formatActionLog(type, payload) {
    try {
      const p = payload || {};
      const n = p.name || p.player?.name || p.senderName || '';
      const a = p.action || p.type || '';
      return `[${type}] ${n} ${a ? `- ${a}` : ''}`;
    } catch (_) { 
      return `[${type}]`; 
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function makeAbsolute(path) {
    return new URL(path, window.location.origin).toString();
  }

  function toast(message, type = 'info') {
    // 간단한 토스트 알림 (필요시 구현)
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // 임시 alert 사용 (나중에 개선 가능)
    if (type === 'error') {
      alert(`오류: ${message}`);
    } else {
      // 성공/정보 메시지는 콘솔에만 출력
      appendLog(message);
    }
  }

})();
