/* PYXIS Admin - 우아한 전투 관리 시스템 */
(function() {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // DOM 요소들
  const elements = {
    // 전투 제어
    battleMode: $('#battleMode'),
    btnCreateBattle: $('#btnCreateBattle'),
    battleId: $('#battleId'),
    
    // 제어 버튼
    btnStart: $('#btnStart'),
    btnPause: $('#btnPause'),
    btnResume: $('#btnResume'),
    btnEnd: $('#btnEnd'),
    
    // 링크 생성
    btnGenPlayerOtp: $('#btnGenPlayerOtp'),
    btnGenSpectatorOtp: $('#btnGenSpectatorOtp'),
    playerOtp: $('#playerOtp'),
    spectatorOtp: $('#spectatorOtp'),
    adminUrl: $('#adminUrl'),
    playerUrl: $('#playerUrl'),
    spectatorUrl: $('#spectatorUrl'),
    
    // 전투 참가자 추가
    pName: $('#pName'),
    pTeam: $('#pTeam'),
    pAvatar: $('#pAvatar'),
    pAvatarPreview: $('#pAvatarPreview'),
    pAvatarMeta: $('#pAvatarMeta'),
    
    // 스탯
    sATK: $('#sATK'),
    sDEF: $('#sDEF'),
    sDEX: $('#sDEX'),
    sLUK: $('#sLUK'),
    pHP: $('#pHP'),
    statTotal: $('#statTotal'),
    
    // 아이템
    itemDittany: $('#itemDittany'),
    itemAtkBoost: $('#itemAtkBoost'),
    itemDefBoost: $('#itemDefBoost'),
    
    btnAddPlayer: $('#btnAddPlayer'),
    addPlayerMsg: $('#addPlayerMsg'),
    
    // 로스터
    rosterPhoenix: $('#rosterPhoenix'),
    rosterEaters: $('#rosterEaters'),
    
    // 로그 & 채팅
    battleLog: $('#battleLog'),
    chatView: $('#chatView'),
    chatText: $('#chatText'),
    btnChatSend: $('#btnChatSend'),
    
    // 상태
    statusPill: $('#statusPill'),
    spectatorCount: $('#spectatorCount'),
    playerCount: $('#playerCount')
  };

  // 상태 관리
  let state = {
    battleId: null,
    battleStatus: 'waiting',
    socket: null,
    currentBattleData: null,
    spectators: 0,
    players: 0,
    avatarFile: null,
    isConnected: false
  };

  // 메인 관리자 객체
  window.PyxisAdmin = {
    init() {
      this.setupSocket();
      this.bindEvents();
      this.updateStatTotal();
      this.autoAuth();
      console.log('PYXIS 관리자 시스템 초기화 완료');
    },

    setupSocket() {
      if (!window.io) {
        console.error('Socket.IO가 로드되지 않았습니다');
        this.showToast('Socket.IO 로드 실패', 'error');
        return;
      }

      state.socket = window.io({
        transports: ['websocket', 'polling'],
        upgrade: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 20000
      });

      this.setupSocketListeners();
    },

    setupSocketListeners() {
      if (!state.socket) return;

      // 연결 이벤트
      state.socket.on('connect', () => {
        console.log('관리자 소켓 연결됨');
        state.isConnected = true;
        this.updateConnectionStatus(true);
        this.showToast('서버 연결됨', 'success');
      });

      state.socket.on('disconnect', () => {
        console.log('관리자 소켓 연결 해제됨');
        state.isConnected = false;
        this.updateConnectionStatus(false);
        this.showToast('서버 연결 해제됨', 'warning');
      });

      state.socket.on('connect_error', (error) => {
        console.error('소켓 연결 오류:', error);
        this.showToast('서버 연결 실패', 'error');
      });

      // 인증 이벤트
      state.socket.on('auth:success', (data) => {
        console.log('관리자 인증 성공:', data);
        this.showToast('관리자 인증 완료', 'success');
      });

      state.socket.on('authError', (data) => {
        console.error('인증 오류:', data);
        this.showToast(`인증 실패: ${data.error}`, 'error');
      });

      // 전투 생성 응답
      state.socket.on('battleCreated', (data) => {
        if (data.success) {
          state.battleId = data.battleId;
          elements.battleId.textContent = data.battleId;
          
          // URL 업데이트
          elements.adminUrl.textContent = data.adminUrl || '';
          elements.playerUrl.textContent = data.playerBase || '';
          elements.spectatorUrl.textContent = data.spectatorBase || '';
          
          this.showToast(`전투 생성 완료: ${data.battleId}`, 'success');
          this.updateStatusPill('waiting');
          
          console.log('전투 생성 완료:', data);
        } else {
          this.showToast(`전투 생성 실패: ${data.error}`, 'error');
          console.error('전투 생성 실패:', data.error);
        }
      });

      // 전투 시작 응답
      state.socket.on('battleStarted', (data) => {
        if (data.success) {
          this.showToast('전투가 시작되었습니다', 'success');
          this.updateStatusPill('active');
        }
      });

      // 전투 상태 업데이트
      state.socket.on('battle:started', (battle) => {
        this.updateStatusPill('active');
        this.showToast('전투 시작!', 'success');
      });

      state.socket.on('battle:paused', (battle) => {
        this.updateStatusPill('paused');
        this.showToast('전투 일시정지', 'warning');
      });

      state.socket.on('battle:resumed', (battle) => {
        this.updateStatusPill('active');
        this.showToast('전투 재개', 'info');
      });

      state.socket.on('battle:ended', (battle) => {
        this.updateStatusPill('ended');
        this.showToast('전투 종료', 'info');
      });

      // 전투 참가자 관련
      state.socket.on('playerAdded', (data) => {
        if (data.success) {
          this.addPlayerToRoster(data.player);
          this.showToast(`전투 참가자 추가: ${data.player.name}`, 'success');
          this.resetPlayerForm();
          this.updatePlayerCount();
        } else {
          this.showToast(`전투 참가자 추가 실패: ${data.error}`, 'error');
        }
      });

      // 비밀번호 생성 응답
      state.socket.on('playerOtpGenerated', (data) => {
        if (data.success) {
          this.displayPlayerLinks(data.playerLinks);
          this.showToast('전투 참가자 링크 생성 완료', 'success');
        } else {
          this.showToast(`링크 생성 실패: ${data.error}`, 'error');
        }
      });

      state.socket.on('spectatorOtpGenerated', (data) => {
        if (data.success) {
          elements.spectatorUrl.textContent = data.spectatorUrl;
          this.showToast('관전자 링크 생성 완료', 'success');
        } else {
          this.showToast(`관전자 링크 생성 실패: ${data.error}`, 'error');
        }
      });

      // 에러 핸들링
      state.socket.on('battleError', (data) => {
        this.showToast(`오류: ${data.error}`, 'error');
        console.error('전투 오류:', data.error);
      });

      // 전투 업데이트
      state.socket.on('battle:update', (battle) => {
        if (battle) {
          state.currentBattleData = battle;
          this.updateBattleDisplay(battle);
          this.updateStatusFromBattle(battle);
        }
      });

      // 로그 & 채팅
      state.socket.on('battle:log', (data) => {
        this.addBattleLog(data);
      });

      state.socket.on('battle:chat', (data) => {
        this.addChatMessage(data);
      });

      // 관전자 수
      state.socket.on('spectator:count', (data) => {
        state.spectators = data.count || 0;
        if (elements.spectatorCount) {
          elements.spectatorCount.textContent = state.spectators;
        }
      });
    },

    // 자동 인증 (URL 파라미터 감지)
    autoAuth() {
      const urlParams = new URLSearchParams(window.location.search);
      const battleId = urlParams.get('battle');
      const token = urlParams.get('token');

      if (battleId && token && state.socket) {
        console.log('자동 인증 시도:', { battleId, token });
        state.socket.emit('adminAuth', { battleId, token });
        state.battleId = battleId;
        elements.battleId.textContent = battleId;
      }
    },

    bindEvents() {
      // 전투 생성
      elements.btnCreateBattle?.addEventListener('click', () => {
        const mode = elements.battleMode?.value || '1v1';
        this.createBattle(mode);
      });

      // 전투 제어
      elements.btnStart?.addEventListener('click', () => this.startBattle());
      elements.btnPause?.addEventListener('click', () => this.pauseBattle());
      elements.btnResume?.addEventListener('click', () => this.resumeBattle());
      elements.btnEnd?.addEventListener('click', () => this.endBattle());

      // 링크 생성
      elements.btnGenPlayerOtp?.addEventListener('click', () => this.generatePlayerOtp());
      elements.btnGenSpectatorOtp?.addEventListener('click', () => this.generateSpectatorOtp());

      // 이미지 업로드
      elements.pAvatar?.addEventListener('change', (e) => this.handleAvatarUpload(e));

      // 스탯 변경 감지 (12포인트 제한 제거)
      [elements.sATK, elements.sDEF, elements.sDEX, elements.sLUK].forEach(el => {
        el?.addEventListener('input', () => this.updateStatTotal());
      });

      // 전투 참가자 추가
      elements.btnAddPlayer?.addEventListener('click', () => this.addPlayer());

      // 채팅
      elements.btnChatSend?.addEventListener('click', () => this.sendChat());
      elements.chatText?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });

      // 클립보드 복사 (링크 요소 클릭시)
      [elements.adminUrl, elements.playerUrl, elements.spectatorUrl].forEach(el => {
        el?.addEventListener('click', () => {
          if (el.textContent && el.textContent !== '-') {
            this.copyToClipboard(el.textContent);
          }
        });
      });
    },

    // 전투 생성
    createBattle(mode) {
      if (!state.socket || !state.isConnected) {
        this.showToast('서버 연결이 필요합니다', 'error');
        return;
      }
      
      console.log('전투 생성 요청:', mode);
      state.socket.emit('createBattle', { mode });
      this.showToast('전투 생성 중...', 'info');
    },

    // 전투 제어
    startBattle() {
      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }
      
      if (!state.socket || !state.isConnected) {
        this.showToast('서버 연결이 필요합니다', 'error');
        return;
      }
      
      state.socket.emit('startBattle', { battleId: state.battleId });
      this.showToast('전투 시작 중...', 'info');
    },

    pauseBattle() {
      if (!state.battleId || !state.socket) return;
      state.socket.emit('pauseBattle', { battleId: state.battleId });
    },

    resumeBattle() {
      if (!state.battleId || !state.socket) return;
      state.socket.emit('resumeBattle', { battleId: state.battleId });
    },

    endBattle() {
      if (!state.battleId || !state.socket) return;
      
      if (confirm('정말로 전투를 종료하시겠습니까?')) {
        state.socket.emit('endBattle', { battleId: state.battleId });
      }
    },

    // 비밀번호 생성
    generatePlayerOtp() {
      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }
      
      if (!state.socket || !state.isConnected) {
        this.showToast('서버 연결이 필요합니다', 'error');
        return;
      }
      
      state.socket.emit('generatePlayerOtp', { battleId: state.battleId });
      this.showToast('전투 참가자 링크 생성 중...', 'info');
    },

    generateSpectatorOtp() {
      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }
      
      if (!state.socket || !state.isConnected) {
        this.showToast('서버 연결이 필요합니다', 'error');
        return;
      }
      
      state.socket.emit('generateSpectatorOtp', { battleId: state.battleId });
      this.showToast('관전자 링크 생성 중...', 'info');
    },

    // 아바타 업로드
    handleAvatarUpload(e) {
      const file = e.target.files[0];
      if (!file) {
        state.avatarFile = null;
        elements.pAvatarPreview.style.display = 'none';
        elements.pAvatarMeta.textContent = '';
        return;
      }

      // 파일 크기 체크 (5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('파일 크기는 5MB 이하여야 합니다', 'error');
        e.target.value = '';
        return;
      }

      // 이미지 타입 체크
      if (!file.type.startsWith('image/')) {
        this.showToast('이미지 파일만 업로드 가능합니다', 'error');
        e.target.value = '';
        return;
      }

      state.avatarFile = file;
      
      // 미리보기 생성
      const reader = new FileReader();
      reader.onload = (e) => {
        elements.pAvatarPreview.src = e.target.result;
        elements.pAvatarPreview.style.display = 'block';
        elements.pAvatarMeta.textContent = `${file.name} (${(file.size/1024).toFixed(1)}KB)`;
      };
      reader.readAsDataURL(file);
    },

    // 스탯 합계 업데이트 (12포인트 제한 제거)
    updateStatTotal() {
      // HP는 수동으로 설정 가능하도록 변경
      // 더 이상 스탯 총합을 체크하지 않음
    },

    clearStats() {
      [elements.sATK, elements.sDEF, elements.sDEX, elements.sLUK].forEach(el => {
        if (el) el.value = 3;
      });
      if (elements.pHP) elements.pHP.value = 100;
    },

    // 전투 참가자 추가
    async addPlayer() {
      const name = elements.pName?.value?.trim();
      const team = elements.pTeam?.value;
      
      if (!name) {
        this.showToast('전투 참가자 이름을 입력하세요', 'warning');
        return;
      }

      if (!state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'warning');
        return;
      }

      const stats = {
        attack: parseInt(elements.sATK?.value || 3),
        defense: parseInt(elements.sDEF?.value || 3),
        agility: parseInt(elements.sDEX?.value || 3),
        luck: parseInt(elements.sLUK?.value || 3)
      };

      // 스탯 유효성 검증 (1-10 범위)
      for (const [key, value] of Object.entries(stats)) {
        if (value < 1 || value > 10) {
          this.showToast(`${key} 스탯은 1-10 사이여야 합니다`, 'warning');
          return;
        }
      }

      const items = {
        dittany: parseInt(elements.itemDittany?.value || 1),
        attack_booster: parseInt(elements.itemAtkBoost?.value || 1),
        defense_booster: parseInt(elements.itemDefBoost?.value || 1)
      };

      const playerData = {
        name,
        team,
        stats,
        items,
        avatar: null
      };

      try {
        // 아바타가 있으면 먼저 업로드
        if (state.avatarFile) {
          const formData = new FormData();
          formData.append('avatar', state.avatarFile);
          
          const uploadResponse = await fetch('/api/upload/avatar', {
            method: 'POST',
            body: formData
          });
          
          const uploadData = await uploadResponse.json();
          if (uploadData.ok) {
            playerData.avatar = uploadData.avatarUrl;
          } else {
            this.showToast('아바타 업로드 실패', 'warning');
          }
        }

        // 소켓으로 전투 참가자 추가
        if (state.socket && state.isConnected) {
          state.socket.emit('addPlayer', { battleId: state.battleId, playerData });
        } else {
          this.showToast('서버 연결이 필요합니다', 'error');
        }
        
      } catch (error) {
        console.error('전투 참가자 추가 오류:', error);
        this.showToast('전투 참가자 추가 중 오류 발생', 'error');
      }
    },

    resetPlayerForm() {
      if (elements.pName) elements.pName.value = '';
      if (elements.pAvatar) elements.pAvatar.value = '';
      if (elements.pAvatarPreview) elements.pAvatarPreview.style.display = 'none';
      if (elements.pAvatarMeta) elements.pAvatarMeta.textContent = '';
      state.avatarFile = null;
      this.clearStats();
    },

    // 로스터에 전투 참가자 추가
    addPlayerToRoster(player) {
      const rosterEl = player.team === 'phoenix' ? elements.rosterPhoenix : elements.rosterEaters;
      if (!rosterEl) return;

      const playerCard = document.createElement('div');
      playerCard.className = 'player-card';
      playerCard.dataset.playerId = player.id;
      playerCard.innerHTML = `
        <div class="player-header">
          ${player.avatar ? `<img src="${player.avatar}" class="player-avatar" alt="${player.name}">` : '<div class="player-avatar-placeholder">사용자</div>'}
          <div class="player-info">
            <h4 class="player-name">${this.escapeHtml(player.name)}</h4>
            <div class="player-stats">
              <span class="stat">공격: ${player.stats.attack}</span>
              <span class="stat">방어: ${player.stats.defense}</span>
              <span class="stat">민첩: ${player.stats.agility}</span>
              <span class="stat">행운: ${player.stats.luck}</span>
            </div>
          </div>
        </div>
        <div class="player-details">
          <div class="hp-bar">
            <span class="hp-text">HP: ${player.hp}/${player.maxHp || 100}</span>
            <div class="hp-fill" style="width: ${((player.hp || 100) / (player.maxHp || 100)) * 100}%"></div>
          </div>
          <div class="items">
            ${(player.items.dittany || 0) > 0 ? `<span class="item">디터니 x${player.items.dittany}</span>` : ''}
            ${(player.items.attack_booster || 0) > 0 ? `<span class="item">공격 보정기 x${player.items.attack_booster}</span>` : ''}
            ${(player.items.defense_booster || 0) > 0 ? `<span class="item">방어 보정기 x${player.items.defense_booster}</span>` : ''}
          </div>
        </div>
        <button class="remove-player-btn" onclick="PyxisAdmin.removePlayer('${player.id}')">제거</button>
      `;
      
      rosterEl.appendChild(playerCard);
      this.updatePlayerCount();
    },

    // 전투 참가자 제거
    removePlayer(playerId) {
      if (confirm('이 전투 참가자를 제거하시겠습니까?')) {
        if (state.socket && state.isConnected) {
          state.socket.emit('removePlayer', { playerId, battleId: state.battleId });
        }
        
        // UI에서 바로 제거
        const playerCard = document.querySelector(`[data-player-id="${playerId}"]`);
        if (playerCard) {
          playerCard.remove();
          this.updatePlayerCount();
        }
      }
    },

    // 전투 참가자 수 업데이트
    updatePlayerCount() {
      const phoenixCount = elements.rosterPhoenix?.children.length || 0;
      const eatersCount = elements.rosterEaters?.children.length || 0;
      state.players = phoenixCount + eatersCount;
      
      if (elements.playerCount) {
        elements.playerCount.textContent = state.players;
      }
    },

    // 채팅 전송
    sendChat() {
      const message = elements.chatText?.value?.trim();
      if (!message || !state.socket || !state.battleId) return;
      
      state.socket.emit('chat:send', {
        battleId: state.battleId,
        name: '관리자',
        message
      });
      
      elements.chatText.value = '';
    },

    // 전투 참가자 링크 표시
    displayPlayerLinks(playerLinks) {
      if (!elements.playerOtp || !Array.isArray(playerLinks)) return;
      
      elements.playerOtp.innerHTML = playerLinks.map(link => 
        `<div class="otp-item">
          <span class="otp-player">${this.escapeHtml(link.name)}</span>
          <span class="otp-code" onclick="PyxisAdmin.copyToClipboard('${link.url}')" title="클릭하여 복사">링크 복사</span>
        </div>`
      ).join('');
    },

    // 상태 업데이트 헬퍼 함수들
    updateStatusPill(status) {
      const statusPill = elements.statusPill;
      if (!statusPill) return;
      
      // 기존 클래스 제거
      statusPill.classList.remove('waiting', 'active', 'paused', 'ended');
      
      // 새 상태 적용
      statusPill.classList.add(status);
      
      const statusTexts = {
        waiting: '전투 대기 중',
        active: '전투 진행 중',
        paused: '전투 일시정지',
        ended: '전투 종료'
      };
      
      statusPill.textContent = statusTexts[status] || '알 수 없음';
    },

    updateStatusFromBattle(battle) {
      if (battle && battle.status) {
        this.updateStatusPill(battle.status);
      }
    },

    updateBattleDisplay(battle) {
      // 전투 ID 표시
      if (battle.id && elements.battleId) {
        elements.battleId.textContent = battle.id;
        state.battleId = battle.id;
      }
      
      // 전투 참가자 목록 업데이트
      if (battle.players) {
        this.updatePlayerRoster(battle.players);
      }
      
      // 로그 업데이트
      if (battle.log) {
        this.updateLogDisplay(battle.log);
      }
    },

    updatePlayerRoster(players) {
      // 기존 로스터 클리어
      if (elements.rosterPhoenix) elements.rosterPhoenix.innerHTML = '';
      if (elements.rosterEaters) elements.rosterEaters.innerHTML = '';
      
      // 새 전투 참가자들 추가
      players.forEach(player => {
        this.addPlayerToRoster(player);
      });
    },

    updateLogDisplay(logs) {
      if (!elements.battleLog || !Array.isArray(logs)) return;
      
      elements.battleLog.innerHTML = logs.slice(-50).map(log => {
        const timestamp = new Date(log.ts || Date.now()).toLocaleTimeString();
        return `<div class="log-entry log-${log.type}">
          <span class="log-time">${timestamp}</span>
          <span class="log-message">${this.escapeHtml(log.message)}</span>
        </div>`;
      }).join('');
      
      // 스크롤을 맨 아래로
      elements.battleLog.scrollTop = elements.battleLog.scrollHeight;
    },

    addBattleLog(data) {
      if (!elements.battleLog) return;
      
      const timestamp = new Date(data.timestamp || Date.now()).toLocaleTimeString();
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry log-${data.type || 'system'}`;
      logEntry.innerHTML = `
        <span class="log-time">${timestamp}</span>
        <span class="log-message">${this.escapeHtml(data.message)}</span>
      `;
      
      elements.battleLog.appendChild(logEntry);
      
      // 로그 개수 제한 (최대 100개)
      while (elements.battleLog.children.length > 100) {
        elements.battleLog.removeChild(elements.battleLog.firstChild);
      }
      
      // 스크롤을 맨 아래로
      elements.battleLog.scrollTop = elements.battleLog.scrollHeight;
    },

    addChatMessage(data) {
      if (!elements.chatView) return;
      
      const timestamp = new Date(data.timestamp || Date.now()).toLocaleTimeString();
      const chatEntry = document.createElement('div');
      chatEntry.className = 'chat-entry';
      chatEntry.innerHTML = `
        <span class="chat-time">${timestamp}</span>
        <span class="chat-name">${this.escapeHtml(data.name)}</span>
        <span class="chat-message">${this.escapeHtml(data.message)}</span>
      `;
      
      elements.chatView.appendChild(chatEntry);
      
      // 채팅 개수 제한 (최대 50개)
      while (elements.chatView.children.length > 50) {
        elements.chatView.removeChild(elements.chatView.firstChild);
      }
      
      // 스크롤을 맨 아래로
      elements.chatView.scrollTop = elements.chatView.scrollHeight;
    },

    updateConnectionStatus(isConnected) {
      // 연결 상태에 따른 UI 업데이트
      const buttons = [
        elements.btnCreateBattle,
        elements.btnStart,
        elements.btnPause,
        elements.btnResume,
        elements.btnEnd,
        elements.btnGenPlayerOtp,
        elements.btnGenSpectatorOtp,
        elements.btnAddPlayer
      ];
      
      buttons.forEach(btn => {
        if (btn) {
          btn.disabled = !isConnected;
          if (isConnected) {
            btn.classList.remove('disabled');
          } else {
            btn.classList.add('disabled');
          }
        }
      });
    },

    // 토스트 메시지 표시
    showToast(message, type = 'info') {
      // 기존 토스트 제거
      const existingToast = document.querySelector('.toast');
      if (existingToast) {
        existingToast.remove();
      }
      
      // 새 토스트 생성
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      
      // 스타일 적용
      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 20px',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '500',
        zIndex: '10000',
        animation: 'slideInRight 0.3s ease-out',
        minWidth: '200px',
        textAlign: 'center',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
      });
      
      // 타입별 배경색
      const colors = {
        success: '#059669',
        error: '#DC2626',
        warning: '#D97706',
        info: '#2563EB'
      };
      toast.style.backgroundColor = colors[type] || colors.info;
      
      document.body.appendChild(toast);
      
      // 3초 후 자동 제거
      setTimeout(() => {
        if (toast.parentNode) {
          toast.style.animation = 'slideOutRight 0.3s ease-in';
          setTimeout(() => toast.remove(), 300);
        }
      }, 3000);
      
      console.log(`[${type.toUpperCase()}] ${message}`);
    },

    // 클립보드 복사
    async copyToClipboard(text) {
      if (!text || text === '-') {
        this.showToast('복사할 내용이 없습니다', 'warning');
        return;
      }

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // 폴백 방법
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        
        this.showToast('클립보드에 복사되었습니다', 'success');
      } catch (error) {
        console.error('클립보드 복사 실패:', error);
        this.showToast('복사에 실패했습니다', 'error');
      }
    },

    // HTML 이스케이프
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    // 디버그 정보
    getDebugInfo() {
      return {
        state: { ...state },
        elements: Object.keys(elements).reduce((acc, key) => {
          acc[key] = elements[key] ? 'found' : 'missing';
          return acc;
        }, {}),
        socket: {
          connected: state.socket?.connected || false,
          id: state.socket?.id || 'none'
        }
      };
    }
  };

  // CSS 애니메이션 추가
  const addToastStyles = () => {
    const styleId = 'pyxis-toast-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }

      .toast {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: transform 0.2s ease;
      }

      .toast:hover {
        transform: translateY(-2px);
      }

      .player-card {
        background: rgba(0, 30, 53, 0.8);
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        backdrop-filter: blur(10px);
      }

      .player-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }

      .player-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid var(--gold);
      }

      .player-avatar-placeholder {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(220, 199, 162, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--gold);
        font-size: 12px;
        border: 2px solid var(--gold);
      }

      .player-name {
        color: var(--gold);
        margin: 0 0 4px 0;
        font-size: 14px;
        font-weight: 600;
      }

      .player-stats {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .stat {
        font-size: 11px;
        color: #94a3b8;
        background: rgba(0, 0, 0, 0.3);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .hp-bar {
        position: relative;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 4px;
        height: 20px;
        margin-bottom: 8px;
        overflow: hidden;
      }

      .hp-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 11px;
        font-weight: 600;
        color: white;
        z-index: 2;
      }

      .hp-fill {
        height: 100%;
        background: linear-gradient(90deg, #059669, #10b981);
        transition: width 0.3s ease;
      }

      .items {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .item {
        font-size: 10px;
        color: var(--gold);
        background: rgba(220, 199, 162, 0.1);
        padding: 2px 6px;
        border-radius: 3px;
        border: 1px solid rgba(220, 199, 162, 0.3);
      }

      .remove-player-btn {
        background: #dc2626;
        color: white;
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        margin-top: 8px;
        transition: background 0.2s ease;
      }

      .remove-player-btn:hover {
        background: #b91c1c;
      }

      .otp-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(0, 30, 53, 0.6);
        border-radius: 6px;
        margin-bottom: 4px;
        border: 1px solid rgba(220, 199, 162, 0.2);
      }

      .otp-player {
        color: var(--gold);
        font-weight: 500;
        font-size: 13px;
      }

      .otp-code {
        color: #10b981;
        font-family: monospace;
        cursor: pointer;
        padding: 4px 8px;
        background: rgba(16, 185, 129, 0.1);
        border-radius: 4px;
        font-size: 12px;
        transition: background 0.2s ease;
      }

      .otp-code:hover {
        background: rgba(16, 185, 129, 0.2);
      }

      .log-entry {
        padding: 4px 8px;
        margin-bottom: 2px;
        border-radius: 4px;
        font-size: 12px;
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }

      .log-time {
        color: #64748b;
        font-size: 10px;
        min-width: 60px;
      }

      .log-message {
        flex: 1;
        color: #e2e8f0;
      }

      .log-system {
        background: rgba(59, 130, 246, 0.1);
        border-left: 3px solid #3b82f6;
      }

      .log-battle {
        background: rgba(16, 185, 129, 0.1);
        border-left: 3px solid #10b981;
      }

      .log-cheer {
        background: rgba(245, 158, 11, 0.1);
        border-left: 3px solid #f59e0b;
      }

      .chat-entry {
        padding: 6px 8px;
        margin-bottom: 4px;
        border-radius: 4px;
        font-size: 12px;
        background: rgba(0, 0, 0, 0.2);
      }

      .chat-time {
        color: #64748b;
        font-size: 10px;
        margin-right: 8px;
      }

      .chat-name {
        color: var(--gold);
        font-weight: 600;
        margin-right: 8px;
      }

      .chat-message {
        color: #e2e8f0;
      }

      button.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  };

  // 초기화
  document.addEventListener('DOMContentLoaded', () => {
    addToastStyles();
    window.PyxisAdmin.init();
  });

  // 전역 함수로 노출 (HTML onclick 등에서 사용)
  window.PyxisAdmin = window.PyxisAdmin || {};

})();
