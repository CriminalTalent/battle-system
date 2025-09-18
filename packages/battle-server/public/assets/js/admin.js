// packages/battle-server/public/assets/js/admin.js
// PYXIS 관리자 페이지 JavaScript - D10 룰 + 새 턴제 완전 대응판
// - D10 주사위 시스템 지원
// - 팀별 5분 턴제 시스템 지원  
// - 60% 보정기 성공률 지원
// - 게임 종료 오버레이 연동
// - 팀별 로그 컬러링 연동

(function() {
  // DOM 선택자
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // 유틸리티 함수
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));

  const copyToClipboard = (text) => {
    try {
      navigator.clipboard?.writeText(text);
      showToast('클립보드에 복사되었습니다', 'success');
    } catch (e) {
      console.warn('클립보드 복사 실패:', e);
    }
  };

  const showToast = (message, type = 'info') => {
    console.log(`[${type.toUpperCase()}] ${message}`);
    // 향후 토스트 UI 추가 시 여기에 구현
  };

  // 전역 상태
  let socket = null;
  let currentBattleId = null;
  let currentBattleState = null;

  // 소켓 초기화
  function initSocket() {
    if (socket) return socket;
    
    socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    // 연결 이벤트
    socket.on('connect', () => {
      console.log('소켓 연결됨:', socket.id);
      if (currentBattleId) {
        socket.emit('join', { battleId: currentBattleId });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('소켓 연결 해제:', reason);
    });

    // 전투 상태 업데이트
    socket.on('battle:update', handleBattleUpdate);
    socket.on('battleUpdate', handleBattleUpdate);

    // 로그 수신
    socket.on('battle:log', handleBattleLog);
    socket.on('battleLog', handleBattleLog);

    // 채팅 수신
    socket.on('chatMessage', handleChatMessage);
    socket.on('battle:chat', handleChatMessage);

    // 게임 종료 이벤트 (외부에서 정의된 함수 사용)
    socket.on('battle:ended', (data) => {
      if (window.showGameOverOverlay) {
        window.showGameOverOverlay(data.winner);
      }
    });

    socket.on('battleEnded', (data) => {
      if (window.showGameOverOverlay) {
        window.showGameOverOverlay(data.winner);
      }
    });

    return socket;
  }

  // 전투 상태 업데이트 처리
  function handleBattleUpdate(battleState) {
    currentBattleState = battleState;
    renderBattleInfo(battleState);
    renderTeamRosters(battleState);
    updateBattleControls(battleState);
  }

  // 로그 처리 (외부에서 정의된 컬러링 함수 사용)
  function handleBattleLog({ ts, type, message }) {
    const logsContainer = $('#logs');
    if (!logsContainer) return;

    const time = new Date(ts || Date.now()).toLocaleTimeString('ko-KR', { hour12: false });
    const logDiv = document.createElement('div');
    
    // 외부에서 정의된 getLogClass 함수 사용
    const logClass = window.getLogClass ? window.getLogClass(message, type) : 'log-system';
    logDiv.className = `log ${logClass}`;
    
    logDiv.innerHTML = `<span class="tmark">[${time}]</span> ${esc(message)}`;
    
    logsContainer.appendChild(logDiv);
    logsContainer.scrollTop = logsContainer.scrollHeight;

    // 로그가 500개를 넘으면 오래된 것부터 삭제
    while (logsContainer.children.length > 500) {
      logsContainer.removeChild(logsContainer.firstChild);
    }
  }

  // 채팅 처리
  function handleChatMessage({ name, message }) {
    const chatContainer = $('#chat');
    if (!chatContainer) return;

    const chatDiv = document.createElement('div');
    chatDiv.className = 'chat-entry';
    chatDiv.innerHTML = `<span class="chat-name">${esc(name)}</span><span class="chat-sep">:</span> ${esc(message)}`;
    
    chatContainer.appendChild(chatDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // 채팅이 100개를 넘으면 오래된 것부터 삭제
    while (chatContainer.children.length > 100) {
      chatContainer.removeChild(chatContainer.firstChild);
    }
  }

  // 전투 정보 렌더링
  function renderBattleInfo(battleState) {
    if (!battleState) return;

    const battleIdInput = $('#currentBattleId');
    if (battleIdInput) {
      battleIdInput.value = battleState.id || currentBattleId || '';
    }

    // 현재 턴 정보 표시 (필요 시 추가)
    const turnInfo = battleState.currentTurn;
    if (turnInfo) {
      console.log(`현재 턴: ${turnInfo.turnNumber}, 팀: ${turnInfo.currentTeam}, 플레이어: ${turnInfo.currentPlayer?.name || '없음'}, 남은 시간: ${turnInfo.timeLeftSec}초`);
    }
  }

  // 팀 로스터 렌더링
  function renderTeamRosters(battleState) {
    if (!battleState?.players) return;

    const teamAContainer = $('#teamA');
    const teamBContainer = $('#teamB');
    
    if (!teamAContainer || !teamBContainer) return;

    const teamA = battleState.players.filter(p => p.team === 'A');
    const teamB = battleState.players.filter(p => p.team === 'B');

    // A팀 렌더링
    teamAContainer.innerHTML = teamA.map(player => renderPlayerCard(player)).join('');
    
    // B팀 렌더링
    teamBContainer.innerHTML = teamB.map(player => renderPlayerCard(player)).join('');
  }

  // 플레이어 카드 렌더링
  function renderPlayerCard(player) {
    const hpPercent = Math.max(0, Math.min(100, (player.hp / (player.maxHp || 100)) * 100));
    const isAlive = player.hp > 0;
    const readyStatus = player.ready ? '준비완료' : '대기중';

    return `
      <div class="player-card ${isAlive ? '' : 'dead'}" data-player-id="${player.id}">
        <div class="player-info">
          <img src="${player.avatar || '/uploads/avatars/default.svg'}" 
               alt="${esc(player.name)}" 
               onerror="this.src='/uploads/avatars/default.svg'">
          <div class="player-details">
            <div class="name">${esc(player.name)}</div>
            <div class="hp-bar">
              <div class="hp-fill" style="width: ${hpPercent}%"></div>
            </div>
            <div class="hp-text">${player.hp}/${player.maxHp || 100}</div>
            <div class="stats">
              공${player.stats?.attack || 1} 
              방${player.stats?.defense || 1} 
              민${player.stats?.agility || 1} 
              행${player.stats?.luck || 1}
            </div>
            <div class="items" style="font-size: 0.6rem; color: var(--text-muted);">
              ${renderItemsInfo(player.items)}
            </div>
            <div class="status" style="font-size: 0.6rem; color: var(--gold);">
              ${readyStatus}
            </div>
          </div>
        </div>
        <button class="btn small danger" onclick="removePlayer('${player.id}')" 
                style="margin-top: 8px; width: 100%;">
          제거
        </button>
      </div>
    `;
  }

  // 아이템 정보 렌더링
  function renderItemsInfo(items) {
    if (!items) return '아이템 없음';
    
    const itemList = [];
    if (items.dittany > 0) itemList.push(`디터니 ${items.dittany}`);
    if (items.attackBooster > 0) itemList.push(`공격보정 ${items.attackBooster}`);
    if (items.defenseBooster > 0) itemList.push(`방어보정 ${items.defenseBooster}`);
    
    return itemList.length > 0 ? itemList.join(', ') : '아이템 없음';
  }

  // 전투 컨트롤 버튼 상태 업데이트
  function updateBattleControls(battleState) {
    const btnStart = $('#btnStart');
    const btnPause = $('#btnPause');
    const btnResume = $('#btnResume');
    const btnEnd = $('#btnEnd');

    if (!battleState) {
      // 전투가 없는 상태
      [btnStart, btnPause, btnResume, btnEnd].forEach(btn => {
        if (btn) btn.disabled = true;
      });
      return;
    }

    const status = battleState.status;
    
    if (btnStart) btnStart.disabled = status !== 'waiting';
    if (btnPause) btnPause.disabled = status !== 'active';
    if (btnResume) btnResume.disabled = status !== 'paused';
    if (btnEnd) btnEnd.disabled = status === 'ended';
  }

  // HTTP API 호출
  async function apiCall(url, method = 'GET', body = null) {
    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        }
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('API 호출 실패:', error);
      showToast(`API 오류: ${error.message}`, 'error');
      throw error;
    }
  }

  // 전투 생성
  async function createBattle() {
    try {
      const mode = $('#battleMode')?.value || '2v2';
      
      // 소켓으로 전투 생성
      const socket = initSocket();
      socket.emit('createBattle', { mode }, (response) => {
        if (response?.ok) {
          currentBattleId = response.battleId;
          showToast('전투가 생성되었습니다', 'success');
          
          // 방에 입장
          socket.emit('join', { battleId: currentBattleId });
        } else {
          showToast('전투 생성 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
        }
      });
    } catch (error) {
      console.error('전투 생성 실패:', error);
      showToast('전투 생성 중 오류가 발생했습니다', 'error');
    }
  }

  // 전투 제어 함수들
  function startBattle() {
    if (!currentBattleId) return;
    const socket = initSocket();
    socket.emit('startBattle', { battleId: currentBattleId }, (response) => {
      if (!response?.ok) {
        showToast('전투 시작 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
      }
    });
  }

  function pauseBattle() {
    if (!currentBattleId) return;
    const socket = initSocket();
    socket.emit('pauseBattle', { battleId: currentBattleId }, (response) => {
      if (!response?.ok) {
        showToast('일시정지 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
      }
    });
  }

  function resumeBattle() {
    if (!currentBattleId) return;
    const socket = initSocket();
    socket.emit('resumeBattle', { battleId: currentBattleId }, (response) => {
      if (!response?.ok) {
        showToast('재개 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
      }
    });
  }

  function endBattle() {
    if (!currentBattleId) return;
    if (!confirm('정말로 전투를 종료하시겠습니까?')) return;
    
    const socket = initSocket();
    socket.emit('endBattle', { battleId: currentBattleId }, (response) => {
      if (!response?.ok) {
        showToast('전투 종료 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
      }
    });
  }

  // 플레이어 추가
  async function addPlayer() {
    if (!currentBattleId) {
      showToast('먼저 전투를 생성해주세요', 'warning');
      return;
    }

    try {
      // 아바타 업로드 처리
      let avatarUrl = '/uploads/avatars/default.svg';
      const avatarFile = $('#playerAvatar')?.files[0];
      
      if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        
        const uploadResponse = await fetch('/api/upload/avatar', {
          method: 'POST',
          body: formData
        });
        
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          avatarUrl = uploadData.url;
        } else {
          console.warn('아바타 업로드 실패, 기본 아바타 사용');
        }
      }

      // 플레이어 데이터 구성
      const playerData = {
        name: $('#playerName')?.value?.trim() || '',
        team: $('#playerTeam')?.value || 'A',
        avatar: avatarUrl,
        hp: parseInt($('#playerHP')?.value) || 100,
        maxHp: parseInt($('#playerHP')?.value) || 100,
        stats: {
          attack: parseInt($('#playerAttack')?.value) || 1,
          defense: parseInt($('#playerDefense')?.value) || 1,
          agility: parseInt($('#playerAgility')?.value) || 1,
          luck: parseInt($('#playerLuck')?.value) || 1
        },
        items: {
          dittany: parseInt($('#playerDittany')?.value) || 0,
          attackBooster: parseInt($('#playerAttackBooster')?.value) || 0,
          defenseBooster: parseInt($('#playerDefenseBooster')?.value) || 0
        }
      };

      // 유효성 검사
      if (!playerData.name) {
        showToast('플레이어 이름을 입력해주세요', 'warning');
        return;
      }

      // 스탯 범위 검사 (1-5)
      Object.values(playerData.stats).forEach(stat => {
        if (stat < 1 || stat > 5) {
          throw new Error('스탯은 1~5 범위여야 합니다');
        }
      });

      // HP 범위 검사 (1-1000)
      if (playerData.hp < 1 || playerData.hp > 1000) {
        throw new Error('HP는 1~1000 범위여야 합니다');
      }

      // 소켓으로 플레이어 추가
      const socket = initSocket();
      socket.emit('addPlayer', {
        battleId: currentBattleId,
        player: playerData
      }, (response) => {
        if (response?.ok) {
          showToast(`${playerData.name}이(가) ${playerData.team}팀에 추가되었습니다`, 'success');
          clearPlayerForm();
        } else {
          showToast('플레이어 추가 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
        }
      });

    } catch (error) {
      console.error('플레이어 추가 실패:', error);
      showToast('플레이어 추가 중 오류가 발생했습니다: ' + error.message, 'error');
    }
  }

  // 플레이어 제거
  function removePlayer(playerId) {
    if (!currentBattleId || !playerId) return;
    
    const player = currentBattleState?.players?.find(p => p.id === playerId);
    const playerName = player?.name || 'Unknown';
    
    if (!confirm(`${playerName}을(를) 제거하시겠습니까?`)) return;

    const socket = initSocket();
    socket.emit('deletePlayer', {
      battleId: currentBattleId,
      playerId: playerId
    }, (response) => {
      if (response?.ok) {
        showToast(`${playerName}이(가) 제거되었습니다`, 'success');
      } else {
        showToast('플레이어 제거 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
      }
    });
  }

  // 플레이어 폼 초기화
  function clearPlayerForm() {
    const form = document.querySelector('#playerName').closest('.card');
    if (!form) return;

    // 입력 필드들 초기화
    const inputs = form.querySelectorAll('input[type="text"], input[type="number"], input[type="file"], select');
    inputs.forEach(input => {
      if (input.type === 'file') {
        input.value = '';
      } else if (input.type === 'number') {
        const defaultValues = {
          'playerHP': 100,
          'playerAttack': 1, 'playerDefense': 1, 
          'playerAgility': 1, 'playerLuck': 1,
          'playerDittany': 0, 'playerAttackBooster': 0, 
          'playerDefenseBooster': 0
        };
        input.value = defaultValues[input.id] || 0;
      } else {
        input.value = '';
      }
    });

    // 팀 선택 초기화
    const teamSelect = $('#playerTeam');
    if (teamSelect) teamSelect.value = 'A';
  }

  // 링크 생성
  async function generateLinks() {
    if (!currentBattleId) {
      showToast('먼저 전투를 생성해주세요', 'warning');
      return;
    }

    try {
      // HTTP API로 링크 생성 (폴백 지원)
      let response;
      try {
        response = await apiCall(`/api/admin/battles/${currentBattleId}/links`, 'POST');
      } catch (error) {
        // 호환 경로로 재시도
        response = await apiCall(`/api/battles/${currentBattleId}/links`, 'POST');
      }

      if (response?.ok) {
        displayGeneratedLinks(response.links || response);
        showToast('링크가 생성되었습니다', 'success');
      }
    } catch (error) {
      console.error('링크 생성 실패:', error);
      showToast('링크 생성에 실패했습니다', 'error');
    }
  }

  // 생성된 링크 표시
  function displayGeneratedLinks(links) {
    const container = $('#generatedLinks');
    if (!container) return;

    let html = '';

    // 관전자 링크
    if (links.spectator) {
      html += `
        <div class="link-section">
          <h4>관전자 링크</h4>
          <div class="link-item">
            <input type="text" readonly value="${links.spectator.url}" class="link-input">
            <button onclick="copyLink('${links.spectator.url}')" class="btn small">복사</button>
          </div>
          <div class="hint">OTP: ${links.spectator.otp}</div>
        </div>
      `;
    }

    // 플레이어 링크들
    if (links.players && Array.isArray(links.players)) {
      html += '<div class="link-section"><h4>전투 참가자 링크</h4>';
      
      links.players.forEach(player => {
        html += `
          <div class="player-link">
            <strong>${esc(player.name)} (${player.team}팀)</strong>
            <div class="link-item">
              <input type="text" readonly value="${player.url}" class="link-input">
              <button onclick="copyLink('${player.url}')" class="btn small">복사</button>
            </div>
          </div>
        `;
      });
      
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // 링크 복사
  function copyLink(url) {
    copyToClipboard(url);
  }

  // 채팅 전송
  function sendChat() {
    const input = $('#chatMsg');
    const message = input?.value?.trim();
    
    if (!message || !currentBattleId) return;

    const socket = initSocket();
    socket.emit('chatMessage', {
      battleId: currentBattleId,
      name: '관리자',
      message: message
    }, (response) => {
      if (response?.ok) {
        input.value = '';
      }
    });
  }

  // 이벤트 리스너 등록
  function setupEventListeners() {
    // 전투 제어 버튼들
    $('#btnCreate')?.addEventListener('click', createBattle);
    $('#btnStart')?.addEventListener('click', startBattle);
    $('#btnPause')?.addEventListener('click', pauseBattle);
    $('#btnResume')?.addEventListener('click', resumeBattle);
    $('#btnEnd')?.addEventListener('click', endBattle);

    // 플레이어 관리
    $('#btnAddPlayer')?.addEventListener('click', addPlayer);

    // 링크 생성
    $('#btnGenPlayerLinks')?.addEventListener('click', generateLinks);
    $('#btnGenSpectatorLink')?.addEventListener('click', generateLinks);

    // 채팅
    $('#btnSend')?.addEventListener('click', sendChat);
    $('#chatMsg')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChat();
      }
    });
  }

  // 전역 함수로 노출 (HTML에서 호출용)
  window.removePlayer = removePlayer;
  window.copyLink = copyLink;

  // 초기화
  function init() {
    console.log('관리자 페이지 초기화 중...');
    initSocket();
    setupEventListeners();
    
    // URL에서 battleId 확인
    const urlParams = new URLSearchParams(window.location.search);
    const battleIdFromUrl = urlParams.get('battle');
    if (battleIdFromUrl) {
      currentBattleId = battleIdFromUrl;
      $('#currentBattleId').value = battleIdFromUrl;
      socket.emit('join', { battleId: currentBattleId });
    }
    
    console.log('관리자 페이지 초기화 완료');
  }

  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
