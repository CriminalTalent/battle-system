// 비밀번호 생성 응답 (수정된 이벤트명)
      socket.on('playerPasswordGenerated', (data) => {
        if (data.success) {
          this.displayPlayerLinks(/* PYXIS Admin - 우아한 전투 관리 시스템 */
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
    
    // 링크 생성 (수정된 ID)
    btnGenPlayerPassword: $('#btnGenPlayerPassword'),
    btnGenSpectatorPassword: $('#btnGenSpectatorPassword'),
    playerPassword: $('#playerPassword'),
    spectatorPassword: $('#spectatorPassword'),
    adminUrl: $('#adminUrl'),
    playerUrl: $('#playerUrl'),
    spectatorUrl: $('#spectatorUrl'),
    
    // 전투 참가자 추가
    pName: $('#pName'),
    pTeam: $('#pTeam'),
    pAvatar: $('#pAvatar'),
    pAvatarPreview: $('#pAvatarPreview'),
    pAvatarImg: $('#pAvatarImg'),
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
    
    // 모니터링
    currentBattleId: $('#currentBattleId'),
    currentMode: $('#currentMode'),
    currentTurn: $('#currentTurn'),
    currentTeam: $('#currentTeam'),
    playerCount: $('#playerCount'),
    spectatorCount: $('#spectatorCount'),
    
    // 로그 & 채팅
    battleLog: $('#battleLog'),
    chatView: $('#chatView'),
    chatText: $('#chatText'),
    btnChatSend: $('#btnChatSend'),
    
    // 상태
    statusPill: $('#statusPill'),
    toastContainer: $('#toastContainer')
  };

  // 상태 관리
  const state = {
    socket: null,
    isConnected: false,
    battleId: null,
    isAuthenticated: false,
    currentBattleData: null,
    players: []
  };

  // PyxisAdmin 객체
  const PyxisAdmin = {
    state,
    
    init() {
      this.connectSocket();
      this.bindEvents();
      this.setupStatCalculator();
      this.setupFileUpload();
      this.autoAuth();
      console.log('[PYXIS Admin] 초기화 완료');
    },

    connectSocket() {
      try {
        const socketUrl = window.PyxisSocket?.url || undefined;
        this.state.socket = window.io ? window.io(socketUrl, {
          transports: ['websocket', 'polling'],
          withCredentials: true
        }) : null;

        if (!this.state.socket) {
          throw new Error('Socket.IO를 로드할 수 없습니다');
        }

        this.bindSocketEvents();
        console.log('[PYXIS Admin] 소켓 연결 시도');
      } catch (error) {
        console.error('[PYXIS Admin] 소켓 연결 실패:', error);
        this.showToast('소켓 연결 실패', 'error');
      }
    },

    bindEvents() {
      // 전투 제어
      elements.btnCreateBattle?.addEventListener('click', () => {
        const mode = elements.battleMode?.value || '1v1';
        this.createBattle(mode);
      });

      elements.btnStart?.addEventListener('click', () => this.startBattle());
      elements.btnPause?.addEventListener('click', () => this.pauseBattle());
      elements.btnResume?.addEventListener('click', () => this.resumeBattle());
      elements.btnEnd?.addEventListener('click', () => this.endBattle());

      // 링크 생성 (수정된 이벤트)
      elements.btnGenPlayerPassword?.addEventListener('click', () => this.generatePlayerPassword());
      elements.btnGenSpectatorPassword?.addEventListener('click', () => this.generateSpectatorPassword());

      // 전투 참가자 추가
      elements.btnAddPlayer?.addEventListener('click', () => this.addPlayer());

      // 채팅
      elements.btnChatSend?.addEventListener('click', () => this.sendChat());
      elements.chatText?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });

      // 링크 복사 이벤트
      [elements.adminUrl, elements.playerUrl, elements.spectatorUrl].forEach(el => {
        el?.addEventListener('click', () => this.copyToClipboard(el.textContent));
      });

      console.log('[PYXIS Admin] 이벤트 바인딩 완료');
    },

    bindSocketEvents() {
      const socket = this.state.socket;
      if (!socket) return;

      socket.on('connect', () => {
        this.state.isConnected = true;
        this.updateConnectionStatus('connected', '연결됨');
        console.log('[PYXIS Admin] 소켓 연결됨');
      });

      socket.on('disconnect', () => {
        this.state.isConnected = false;
        this.updateConnectionStatus('disconnected', '연결 끊어짐');
        console.log('[PYXIS Admin] 소켓 연결 끊어짐');
      });

      // 인증 응답
      socket.on('auth:success', (data) => {
        this.state.isAuthenticated = true;
        this.state.battleId = data.battleId;
        this.showToast('관리자 인증 성공', 'success');
        this.updateBattleId(data.battleId);
      });

      socket.on('authError', (data) => {
        this.showToast(`인증 실패: ${data.error}`, 'error');
      });

      // 전투 생성 응답
      socket.on('battleCreated', (data) => {
        if (data.success) {
          this.state.battleId = data.battleId;
          this.updateBattleId(data.battleId);
          this.updateAdminUrl(data.adminUrl);
          this.showToast('전투 생성 완료', 'success');
        } else {
          this.showToast(`전투 생성 실패: ${data.error}`, 'error');
        }
      });

      // 전투 시작/종료 응답
      socket.on('battle:started', (battle) => {
        this.updateStatusPill('active');
        this.showToast('전투 시작', 'success');
      });

      socket.on('battle:paused', (battle) => {
        this.updateStatusPill('paused');
        this.showToast('전투 일시정지', 'warning');
      });

      socket.on('battle:resumed', (battle) => {
        this.updateStatusPill('active');
        this.showToast('전투 재개', 'info');
      });

      socket.on('battle:ended', (battle) => {
        this.updateStatusPill('ended');
        this.showToast('전투 종료', 'info');
      });

      // 전투 참가자 관련 (수정된 이벤트명)
      socket.on('playerAdded', (data) => {
        if (data.success) {
          this.addPlayerToRoster(data.player);
          this.showToast(`전투 참가자 추가: ${data.player.name}`, 'success');
          this.resetPlayerForm();
          this.updatePlayerCount();
        } else {
          this.showToast(`전투 참가자 추가 실패: ${data.error}`, 'error');
        }
      });

      // 비밀번호 생성 응답 (수정된 이벤트명)
      socket.on('playerPasswordGenerated', (data) => {
        if (data.success) {
          this.displayPlayerLinks(data.playerLinks);
          this.showToast('전투 참가자 링크 생성 완료', 'success');
        } else {
          this.showToast(`링크 생성 실패: ${data.error}`, 'error');
        }
      });

      socket.on('spectatorPasswordGenerated', (data) => {
        if (data.success) {
          elements.spectatorUrl.textContent = data.spectatorUrl;
          this.showToast('관전자 링크 생성 완료', 'success');
        } else {
          this.showToast(`관전자 링크 생성 실패: ${data.error}`, 'error');
        }
      });

      // 에러 핸들링
      socket.on('battleError', (data) => {
        this.showToast(`오류: ${data.error}`, 'error');
        console.error('전투 오류:', data.error);
      });

      // 전투 업데이트
      socket.on('battle:update', (battle) => {
        if (battle) {
          this.state.currentBattleData = battle;
          this.updateBattleDisplay(battle);
          this.updateStatusFromBattle(battle);
        }
      });

      // 채팅
      socket.on('battle:chat', (data) => {
        this.displayChatMessage(data);
      });

      // 로그
      socket.on('battle:log', (data) => {
        this.displayLogMessage(data);
      });

      // 관전자 수
      socket.on('spectator:count', (data) => {
        this.updateSpectatorCount(data.count);
      });
    },

    setupStatCalculator() {
      const statInputs = [elements.sATK, elements.sDEF, elements.sDEX, elements.sLUK];
      
      statInputs.forEach(input => {
        input?.addEventListener('input', () => {
          const total = statInputs.reduce((sum, inp) => sum + (parseInt(inp.value) || 0), 0);
          if (elements.statTotal) {
            elements.statTotal.textContent = total;
            elements.statTotal.style.color = total === 12 ? 'var(--success)' : 'var(--warning)';
          }
        });
      });
    },

    setupFileUpload() {
      elements.pAvatar?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
          this.showToast('파일 크기는 5MB 이하여야 합니다', 'error');
          e.target.value = '';
          return;
        }

        if (!file.type.startsWith('image/')) {
          this.showToast('이미지 파일만 업로드 가능합니다', 'error');
          e.target.value = '';
          return;
        }

        // 미리보기
        const reader = new FileReader();
        reader.onload = (e) => {
          if (elements.pAvatarImg) {
            elements.pAvatarImg.src = e.target.result;
            elements.pAvatarPreview.style.display = 'block';
          }
        };
        reader.readAsDataURL(file);

        // 메타 정보
        if (elements.pAvatarMeta) {
          elements.pAvatarMeta.textContent = `${file.name} (${(file.size / 1024).toFixed(1)}KB)`;
        }
      });
    },

    autoAuth() {
      const params = new URLSearchParams(window.location.search);
      const battleId = params.get('battle');
      const token = params.get('token');

      if (battleId && token) {
        this.state.socket?.emit('adminAuth', { battleId, token });
      }
    },

    // 전투 관리 메서드들
    createBattle(mode) {
      if (!this.state.socket) {
        this.showToast('소켓이 연결되지 않았습니다', 'error');
        return;
      }

      this.state.socket.emit('createBattle', { mode });
      this.showToast('전투 생성 중...', 'info');
    },

    startBattle() {
      if (!this.state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'error');
        return;
      }

      this.state.socket?.emit('startBattle', { battleId: this.state.battleId });
    },

    pauseBattle() {
      if (!this.state.battleId) return;
      this.state.socket?.emit('pauseBattle', { battleId: this.state.battleId });
    },

    resumeBattle() {
      if (!this.state.battleId) return;
      this.state.socket?.emit('resumeBattle', { battleId: this.state.battleId });
    },

    endBattle() {
      if (!this.state.battleId) return;
      if (confirm('정말 전투를 종료하시겠습니까?')) {
        this.state.socket?.emit('endBattle', { battleId: this.state.battleId });
      }
    },

    // 링크 생성 메서드들 (수정된 이벤트명)
    generatePlayerPassword() {
      if (!this.state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'error');
        return;
      }

      this.state.socket?.emit('generatePlayerPassword', { battleId: this.state.battleId });
    },

    generateSpectatorPassword() {
      if (!this.state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'error');
        return;
      }

      this.state.socket?.emit('generateSpectatorPassword', { battleId: this.state.battleId });
    },

    // 전투 참가자 관리
    async addPlayer() {
      if (!this.state.battleId) {
        this.showToast('먼저 전투를 생성하세요', 'error');
        return;
      }

      // 스탯 총합 체크
      const totalStats = parseInt(elements.sATK.value) + parseInt(elements.sDEF.value) + 
                        parseInt(elements.sDEX.value) + parseInt(elements.sLUK.value);
      
      if (totalStats !== 12) {
        this.showToast(`스탯 총합은 12포인트여야 합니다 (현재: ${totalStats})`, 'error');
        return;
      }

      let avatarUrl = null;

      // 아바타 업로드
      if (elements.pAvatar.files[0]) {
        try {
          avatarUrl = await this.uploadAvatar(elements.pAvatar.files[0]);
        } catch (error) {
          this.showToast('아바타 업로드 실패', 'error');
          return;
        }
      }

      const playerData = {
        name: elements.pName.value.trim(),
        team: elements.pTeam.value,
        hp: parseInt(elements.pHP.value),
        stats: {
          attack: parseInt(elements.sATK.value),
          defense: parseInt(elements.sDEF.value),
          agility: parseInt(elements.sDEX.value),
          luck: parseInt(elements.sLUK.value)
        },
        items: {
          dittany: parseInt(elements.itemDittany.value),
          attack_booster: parseInt(elements.itemAtkBoost.value),
          defense_booster: parseInt(elements.itemDefBoost.value)
        },
        avatar: avatarUrl
      };

      this.state.socket?.emit('addPlayer', {
        battleId: this.state.battleId,
        playerData
      });
    },

    async uploadAvatar(file) {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch('/api/upload/avatar', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.error);
      }

      return result.avatarUrl;
    },

    resetPlayerForm() {
      if (elements.pName) elements.pName.value = '';
      if (elements.pTeam) elements.pTeam.value = 'phoenix';
      if (elements.pHP) elements.pHP.value = '100';
      if (elements.sATK) elements.sATK.value = '3';
      if (elements.sDEF) elements.sDEF.value = '3';
      if (elements.sDEX) elements.sDEX.value = '3';
      if (elements.sLUK) elements.sLUK.value = '3';
      if (elements.itemDittany) elements.itemDittany.value = '1';
      if (elements.itemAtkBoost) elements.itemAtkBoost.value = '1';
      if (elements.itemDefBoost) elements.itemDefBoost.value = '1';
      if (elements.pAvatar) elements.pAvatar.value = '';
      if (elements.pAvatarPreview) elements.pAvatarPreview.style.display = 'none';
      if (elements.pAvatarMeta) elements.pAvatarMeta.textContent = '';
    },

    // 채팅
    sendChat() {
      const message = elements.chatText?.value.trim();
      if (!message || !this.state.battleId) return;

      this.state.socket?.emit('chat:send', {
        battleId: this.state.battleId,
        name: '관리자',
        message,
        role: 'admin'
      });

      elements.chatText.value = '';
    },

    // UI 업데이트 메서드들
    updateConnectionStatus(status, message) {
      const indicator = $('#connectionIndicator');
      if (indicator) {
        indicator.className = `connection-indicator ${status}`;
        indicator.textContent = message;
      }
    },

    updateBattleId(battleId) {
      if (elements.battleId) {
        elements.battleId.textContent = battleId || '-';
      }
      if (elements.currentBattleId) {
        elements.currentBattleId.textContent = battleId || '-';
      }
    },

    updateAdminUrl(url) {
      if (elements.adminUrl) {
        elements.adminUrl.textContent = url || '-';
      }
    },

    updateStatusPill(status) {
      if (!elements.statusPill) return;

      const statusMap = {
        waiting: { text: '전투 대기 중', class: 'waiting' },
        active: { text: '전투 진행 중', class: 'active' },
        paused: { text: '일시정지', class: 'paused' },
        ended: { text: '전투 종료', class: 'ended' }
      };

      const statusInfo = statusMap[status] || statusMap.waiting;
      elements.statusPill.textContent = statusInfo.text;
      elements.statusPill.className = `status-pill ${statusInfo.class}`;
    },

    updateBattleDisplay(battle) {
      if (elements.currentMode) elements.currentMode.textContent = battle.mode || '-';
      if (elements.currentTurn) elements.currentTurn.textContent = battle.turn || '0';
      if (elements.currentTeam) elements.currentTeam.textContent = battle.currentTeam || '-';
      
      this.updatePlayerCount();
      this.updateRoster(battle.players || []);
    },

    updateStatusFromBattle(battle) {
      if (battle.status) {
        this.updateStatusPill(battle.status);
      }
    },

    updatePlayerCount() {
      const count = this.state.currentBattleData?.players?.length || 0;
      if (elements.playerCount) {
        elements.playerCount.textContent = count;
      }
    },

    updateSpectatorCount(count) {
      if (elements.spectatorCount) {
        elements.spectatorCount.textContent = count || 0;
      }
    },

    updateRoster(players) {
      if (!elements.rosterPhoenix || !elements.rosterEaters) return;

      const phoenixPlayers = players.filter(p => p.team === 'phoenix');
      const eatersPlayers = players.filter(p => p.team === 'eaters');

      elements.rosterPhoenix.innerHTML = phoenixPlayers.map(p => this.createPlayerCard(p)).join('');
      elements.rosterEaters.innerHTML = eatersPlayers.map(p => this.createPlayerCard(p)).join('');
    },

    addPlayerToRoster(player) {
      const rosterEl = player.team === 'phoenix' ? elements.rosterPhoenix : elements.rosterEaters;
      if (rosterEl) {
        rosterEl.insertAdjacentHTML('beforeend', this.createPlayerCard(player));
      }
    },

    createPlayerCard(player) {
      return `
        <div class="player-card" data-player-id="${player.id}">
          <div class="player-header">
            <div class="player-name">${player.name}</div>
            <div class="player-hp">
              <div class="hp-bar">
                <div class="hp-fill" style="width: ${(player.hp / player.maxHp) * 100}%"></div>
                <span class="hp-text">${player.hp}/${player.maxHp}</span>
              </div>
            </div>
          </div>
          <div class="player-stats">
            <span class="stat-value">공격: ${player.stats.attack}</span>
            <span class="stat-value">방어: ${player.stats.defense}</span>
            <span class="stat-value">민첩: ${player.stats.agility}</span>
            <span class="stat-value">행운: ${player.stats.luck}</span>
          </div>
          <div class="items">
            ${Object.entries(player.items).map(([key, count]) => 
              count > 0 ? `<span class="item">${this.getItemName(key)}: ${count}</span>` : ''
            ).join('')}
          </div>
          <button class="remove-player-btn" onclick="PyxisAdmin.removePlayer('${player.id}')">제거</button>
        </div>
      `;
    },

    getItemName(key) {
      const names = {
        dittany: '디터니',
        attack_booster: '공격 보정기',
        defense_booster: '방어 보정기'
      };
      return names[key] || key;
    },

    removePlayer(playerId) {
      if (confirm('정말 이 전투 참가자를 제거하시겠습니까?')) {
        this.state.socket?.emit('removePlayer', {
          battleId: this.state.battleId,
          playerId
        });
      }
    },

    displayPlayerLinks(playerLinks) {
      if (!elements.playerPassword) return;

      const linksHtml = playerLinks.map(link => `
        <div class="player-link">
          <strong>${link.name} (${link.team}팀)</strong><br>
          <a href="${link.url}" target="_blank" title="클릭하여 복사" onclick="PyxisAdmin.copyToClipboard('${link.url}')">${link.url}</a>
        </div>
      `).join('');

      elements.playerPassword.innerHTML = linksHtml;
    },

    displayChatMessage(data) {
      if (!elements.chatView) return;

      const messageEl = document.createElement('div');
      messageEl.className = 'chat-message';
      messageEl.innerHTML = `
        <span class="chat-name">${data.name}</span>
        <span class="chat-text">${data.message}</span>
        <span class="chat-time">${new Date(data.timestamp).toLocaleTimeString()}</span>
      `;

      elements.chatView.appendChild(messageEl);
      elements.chatView.scrollTop = elements.chatView.scrollHeight;

      // 메시지 수 제한
      if (elements.chatView.children.length > 100) {
        elements.chatView.removeChild(elements.chatView.firstChild);
      }
    },

    displayLogMessage(data) {
      if (!elements.battleLog) return;

      const logEl = document.createElement('div');
      logEl.className = `log-entry ${data.type}`;
      logEl.innerHTML = `
        <span class="log-time">${new Date(data.timestamp).toLocaleTimeString()}</span>
        <span class="log-text">${data.message}</span>
      `;

      elements.battleLog.appendChild(logEl);
      elements.battleLog.scrollTop = elements.battleLog.scrollHeight;

      // 로그 수 제한
      if (elements.battleLog.children.length > 200) {
        elements.battleLog.removeChild(elements.battleLog.firstChild);
      }
    },

    // 유틸리티 메서드들
    showToast(message, type = 'info', duration = 3000) {
      if (!elements.toastContainer) return;

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;

      elements.toastContainer.appendChild(toast);

      // 애니메이션
      setTimeout(() => toast.classList.add('show'), 100);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },

    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.showToast('클립보드에 복사됨', 'success');
      } catch (error) {
        // 폴백: 텍스트 선택
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.showToast('클립보드에 복사됨', 'success');
      }
    },

    getDebugInfo() {
      return {
        state: this.state,
        isConnected: this.state.isConnected,
        isAuthenticated: this.state.isAuthenticated,
        battleId: this.state.battleId,
        battleData: this.state.currentBattleData
      };
    }
  };

  // 전역으로 노출
  window.PyxisAdmin = PyxisAdmin;

})();
