// 채팅
    if (this.elements.chatSend) {
      this.elements.chatSend.addEventListener('click', () => this.sendMessage());
    }
    if (this.elements.chatInput) {
      this.elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Ctrl/Cmd + 단축키들
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'n':
            e.preventDefault();
            this.createBattle();
            break;
          case 's':
            e.preventDefault();
            if (this.state.battleStatus === 'waiting') this.startBattle();
            break;
          case 'e':
            e.preventDefault();
            if (this.state.battleStatus === 'active') this.endBattle();
            break;
        }
      }
    });
  }

  setupFormValidation() {
    // 실시간 폼 검증
    if (this.elements.playerName) {
      this.elements.playerName.addEventListener('blur', (e) => {
        this.validatePlayerName(e.target.value);
      });
      
      this.elements.playerName.addEventListener('input', (e) => {
        this.clearFieldError('playerName');
      });
    }

    // 스탯 검증
    Object.entries(this.elements.statInputs).forEach(([key, input]) => {
      if (input) {
        input.addEventListener('change', (e) => {
          this.validateStat(key, e.target.value);
        });
      }
    });
  }

  initializeUI() {
    // 기본 모드 선택
    this.selectMode('2v2');
    
    // 초기 스탯 설정
    Object.values(this.elements.statInputs).forEach(input => {
      if (input && !input.value) input.value = '3';
    });
    this.updateStatRemaining();

    // 아이템 기본값 설정
    Object.values(this.elements.itemInputs).forEach(input => {
      if (input && !input.value) input.value = '1';
    });
  }

  // Socket 연결
  async connectSocket() {
    if (typeof io === 'undefined') {
      this.showMessage('Socket.IO가 로드되지 않았습니다', 'error');
      return;
    }

    try {
      this.socket = io('/', {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      this.socket.on('connect', () => {
        console.log('Admin Socket connected');
        this.state.isAuthenticated = true;
        this.showMessage('서버에 연결되었습니다', 'success');
        
        // 인증
        this.socket.emit('admin:authenticate', {
          role: 'admin',
          timestamp: Date.now()
        });
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Admin Socket disconnected:', reason);
        this.showMessage('서버 연결이 끊어졌습니다', 'warning');
        this.state.isAuthenticated = false;
      });

      this.socket.on('reconnect', () => {
        console.log('Admin Socket reconnected');
        this.showMessage('서버에 다시 연결되었습니다', 'info');
      });

      // 관리자 이벤트 등록
      this.registerSocketEvents();

    } catch (error) {
      console.error('Socket connection error:', error);
      this.showMessage('서버 연결 실패: ' + error.message, 'error');
    }
  }

  registerSocketEvents() {
    if (!this.socket) return;

    // 관리자 이벤트
    this.socket.on('admin:battle_created', (data) => {
      this.handleBattleCreated(data);
    });

    this.socket.on('admin:player_added', (data) => {
      this.handlePlayerAdded(data);
    });

    this.socket.on('admin:player_removed', (data) => {
      this.handlePlayerRemoved(data);
    });

    this.socket.on('admin:battle_started', (data) => {
      this.handleBattleStarted(data);
    });

    this.socket.on('admin:battle_ended', (data) => {
      this.handleBattleEnded(data);
    });

    this.socket.on('admin:battle_paused', (data) => {
      this.handleBattlePaused(data);
    });

    this.socket.on('admin:error', (data) => {
      this.showMessage(data.message, 'error');
      console.error('Admin error:', data);
    });

    // 게임 상태 업데이트
    this.socket.on('game:state_update', (state) => {
      this.updateGameState(state);
    });

    this.socket.on('game:action_performed', (action) => {
      this.updateBattleStats(action);
    });

    // 로그 시스템
    this.socket.on('log:battle', (log) => {
      this.addLogEntry(log, 'battle');
    });

    this.socket.on('log:system', (log) => {
      this.addLogEntry(log, 'system');
    });

    this.socket.on('log:error', (log) => {
      this.addLogEntry(log, 'error');
    });

    // 채팅 시스템
    this.socket.on('chat:message', (message) => {
      this.addChatMessage(message);
    });

    this.socket.on('spectator:cheer', (cheer) => {
      this.addCheerMessage(cheer);
    });

    // 연결 통계
    this.socket.on('admin:connection_stats', (stats) => {
      this.updateConnectionStats(stats);
    });

    this.socket.on('admin:system_stats', (stats) => {
      this.updateSystemStats(stats);
    });
  }

  // 전투 생성 관리
  selectMode(mode) {
    this.state.battleMode = mode;
    this.state.maxPlayersPerTeam = parseInt(mode.charAt(0));

    // UI 업데이트
    this.elements.modeButtons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });

    // 팀 구성 초기화
    this.state.teams = { A: [], B: [] };
    this.state.players = [];
    this.updateTeamComposition();

    console.log(`Mode selected: ${mode} (${this.state.maxPlayersPerTeam} vs ${this.state.maxPlayersPerTeam})`);
    
    // 사운드 효과
    if (window.PyxisFX) {
      window.PyxisFX.playSound('soft', 600, 0.1, 0.2);
    }
  }

  async createBattle() {
    if (this.state.battleId) {
      this.showMessage('이미 전투가 생성되어 있습니다', 'warning');
      return;
    }

    if (!this.state.isAuthenticated) {
      this.showMessage('서버에 연결되지 않았습니다', 'error');
      return;
    }

    try {
      this.setButtonLoading(this.elements.createBattleBtn, true);
      
      this.socket.emit('admin:create_battle', {
        mode: this.state.battleMode,
        maxPlayersPerTeam: this.state.maxPlayersPerTeam,
        settings: {
          turnTimeLimit: 300000, // 5분
          battleTimeLimit: 3600000, // 1시간
          maxTurns: 100
        }
      });
      
    } catch (error) {
      this.showMessage('전투 생성 실패: ' + error.message, 'error');
      this.setButtonLoading(this.elements.createBattleBtn, false);
    }
  }

  handleBattleCreated(data) {
    console.log('Battle created:', data);
    
    this.state.battleId = data.battleId;
    this.state.battleStatus = data.status || 'waiting';
    this.state.battleStartTime = data.startTime;
    
    this.showMessage(`전투가 생성되었습니다! (ID: ${data.battleId})`, 'success');
    
    // UI 업데이트
    this.updateBattleInfo();
    this.setButtonLoading(this.elements.createBattleBtn, false);
    
    // 플레이어 추가 섹션 활성화
    this.enablePlayerManagement();
    
    // 사운드 효과
    if (window.PyxisFX) {
      window.PyxisFX.playSound('heal', 800, 0.3, 0.3);
    }
  }

  updateBattleInfo() {
    if (!this.elements.battleInfo) return;

    if (this.state.battleId) {
      const statusText = this.getBattleStatusText();
      const statusClass = `status-${this.state.battleStatus}`;
      
      this.elements.battleInfo.innerHTML = `
        <div class="battle-info-grid">
          <div class="info-card">
            <div class="info-label">전투 ID</div>
            <div class="info-value">${this.state.battleId}</div>
          </div>
          <div class="info-card">
            <div class="info-label">모드</div>
            <div class="info-value">${this.state.battleMode}</div>
          </div>
          <div class="info-card">
            <div class="info-label">상태</div>
            <div class="info-value ${statusClass}">${statusText}</div>
          </div>
        </div>
      `;
    } else {
      this.elements.battleInfo.innerHTML = `
        <div class="info-card">
          <div class="info-label">상태</div>
          <div class="info-value">전투를 생성하세요</div>
        </div>
      `;
    }
  }

  getBattleStatusText() {
    const statusMap = {
      waiting: '대기중',
      active: '진행중',
      paused: '일시중지',
      ended: '종료됨'
    };
    return statusMap[this.state.battleStatus] || this.state.battleStatus;
  }

  enablePlayerManagement() {
    // 플레이어 추가 폼 활성화
    if (this.elements.playerForm) {
      this.elements.playerForm.style.opacity = '1';
      this.elements.playerForm.style.pointerEvents = 'all';
    }

    // 버튼 상태 업데이트
    if (this.elements.addPlayerBtn) {
      this.elements.addPlayerBtn.disabled = false;
    }
  }

  // 플레이어 관리
  selectTeam(team) {
    this.state.selectedTeam = team;
    
    this.elements.teamSelect.forEach(option => {
      if (option.dataset.team === team) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });

    // 사운드 효과
    if (window.PyxisFX) {
      window.PyxisFX.playSound('soft', 500, 0.1, 0.2);
    }
  }

  updateStatRemaining() {
    const totalAllocated = Object.values(this.elements.statInputs)
      .reduce((sum, input) => {
        const value = parseInt(input?.value) || 0;
        return sum + Math.max(0, Math.min(10, value)); // 1-10 범위로 제한
      }, 0);
    
    const remaining = 12 - totalAllocated;
    
    if (this.elements.statRemaining) {
      this.elements.statRemaining.textContent = `남은 포인트: ${remaining}`;
      
      if (remaining < 0) {
        this.elements.statRemaining.classList.add('over-limit');
      } else {
        this.elements.statRemaining.classList.remove('over-limit');
      }
    }

    return remaining;
  }

  validateStatInput(input) {
    const value = parseInt(input.value);
    const min = 1, max = 10;
    
    if (isNaN(value) || value < min || value > max) {
      input.value = Math.max(min, Math.min(max, value || 3));
    }
    
    this.updateStatRemaining();
  }

  validatePlayerName(name) {
    if (!name || name.trim().length === 0) {
      this.showFieldError('playerName', '이름을 입력해주세요');
      return false;
    }

    if (name.length > 20) {
      this.showFieldError('playerName', '이름은 20글자 이하로 입력해주세요');
      return false;
    }

    // 중복 체크
    if (this.state.players.some(p => p.name === name.trim())) {
      this.showFieldError('playerName', '이미 사용중인 이름입니다');
      return false;
    }

    // 부적절한 이름 체크
    const inappropriate = ['관리자', 'admin', 'system', 'bot'];
    if (inappropriate.some(word => name.toLowerCase().includes(word))) {
      this.showFieldError('playerName', '사용할 수 없는 이름입니다');
      return false;
    }

    this.clearFieldError('playerName');
    return true;
  }

  validateStat(statName, value) {
    const num = parseInt(value);
    
    if (isNaN(num) || num < 1 || num > 10) {
      this.showFieldError(`stat${statName.charAt(0).toUpperCase() + statName.slice(1)}`, '1-10 사이의 값을 입력해주세요');
      return false;
    }

    this.clearFieldError(`stat${statName.charAt(0).toUpperCase() + statName.slice(1)}`);
    return true;
  }

  async addPlayer() {
    if (!this.state.battleId) {
      this.showMessage('전투를 먼저 생성해주세요', 'error');
      return;
    }

    // 폼 검증
    const name = this.elements.playerName.value.trim();
    if (!this.validatePlayerName(name)) return;

    if (!this.state.selectedTeam) {
      this.showMessage('팀을 선택해주세요', 'warning');
      return;
    }

    const statRemaining = this.updateStatRemaining();
    if (statRemaining !== 0) {
      this.showMessage(`스탯 포인트를 정확히 12포인트 분배해주세요 (현재: ${12 - statRemaining}/12)`, 'warning');
      return;
    }

    // 팀 인원 제한 체크
    const teamCount = this.state.teams[this.state.selectedTeam].length;
    if (teamCount >= this.state.maxPlayersPerTeam) {
      const teamName = this.state.selectedTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.showMessage(`${teamName}이 가득 찼습니다 (최대 ${this.state.maxPlayersPerTeam}명)`, 'error');
      return;
    }

    // 플레이어 데이터 수집
    const playerData = {
      name,
      team: this.state.selectedTeam,
      stats: {
        attack: parseInt(this.elements.statInputs.attack.value) || 3,
        defense: parseInt(this.elements.statInputs.defense.value) || 3,
        agility: parseInt(this.elements.statInputs.agility.value) || 3,
        luck: parseInt(this.elements.statInputs.luck.value) || 3
      },
      items: {
        dittany: parseInt(this.elements.itemInputs.dittany.value) || 0,
        attackBoost: parseInt(this.elements.itemInputs.attackBoost.value) || 0,
        defenseBoost: parseInt(this.elements.itemInputs.defenseBoost.value) || 0
      },
      maxHp: 100,
      hp: 100
    };

    try {
      this.setButtonLoading(this.elements.addPlayerBtn, true);
      
      this.socket.emit('admin:add_player', {
        battleId: this.state.battleId,
        playerData
      });
      
    } catch (error) {
      this.showMessage('플레이어 추가 실패: ' + error.message, 'error');
      this.setButtonLoading(this.elements.addPlayerBtn, false);
    }
  }

  handlePlayerAdded(data) {
    console.log('Player added:', data);
    
    const player = data.player;
    this.state.players.push(player);
    this.state.teams[player.team].push(player);
    this.state.totalPlayers++;
    
    this.showMessage(`플레이어 "${player.name}" 추가 완료`, 'success');
    
    // 폼 초기화
    this.resetPlayerForm();
    this.updateTeamComposition();
    this.setButtonLoading(this.elements.addPlayerBtn, false);
    
    // 아바타 업로드 처리
    this.handleAvatarUpload(player.id);
    
    // 사운드 효과
    if (window.PyxisFX) {
      window.PyxisFX.playSound('heal', 700, 0.2, 0.3);
    }
  }

  async handleAvatarUpload(playerId) {
    const fileInput = this.elements.avatarUpload;
    if (!fileInput || !fileInput.files[0]) return;

    const file = fileInput.files[0];
    
    // 파일 검증
    if (!file.type.startsWith('image/')) {
      this.showMessage('이미지 파일만 업로드 가능합니다', 'warning');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.showMessage('파일 크기는 5MB 이하여야 합니다', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('playerId', playerId);
    formData.append('battleId', this.state.battleId);

    try {
      const response = await fetch(`/api/battles/${this.state.battleId}/avatar`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        this.showMessage('아바타 업로드 완료', 'success');
      } else {
        this.showMessage('아바타 업로드 실패: ' + (result.error || '알 수 없는 오류'), 'warning');
      }
    } catch (error) {
      console.error('Avatar upload error:', error);
      this.showMessage('아바타 업로드 중 오류가 발생했습니다', 'error');
    }
  }

  resetPlayerForm() {
    if (this.elements.playerName) this.elements.playerName.value = '';
    
    // 스탯 초기화 (기본값 3)
    Object.values(this.elements.statInputs).forEach(input => {
      if (input) input.value = '3';
    });
    
    // 아이템 초기화
    Object.values(this.elements.itemInputs).forEach(input => {
      if (input) input.value = '1';
    });
    
    // 아바타 초기화
    if (this.elements.avatarUpload) this.elements.avatarUpload.value = '';
    
    // 팀 선택 해제
    this.elements.teamSelect.forEach(option => option.classList.remove('selected'));
    this.state.selectedTeam = null;
    
    // 에러 메시지 정리
    this.clearAllFieldErrors();
    
    this.updateStatRemaining();
  }

  updateTeamComposition() {
    this.updateTeamDisplay('A', this.elements.teamAPlayers, this.elements.teamACount, '불사조 기사단');
    this.updateTeamDisplay('B', this.elements.teamBPlayers, this.elements.teamBCount, '죽음을 먹는 자들');
  }

  updateTeamDisplay(team, playersElement, countElement, teamName) {
    const players = this.state.teams[team];
    
    if (countElement) {
      countElement.textContent = `${players.length}/${this.state.maxPlayersPerTeam}`;
    }

    if (playersElement) {
      playersElement.innerHTML = '';
      
      if (players.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-team';
        emptyState.style.cssText = `
          padding: 20px;
          text-align: center;
          color: #64748B;
          font-style: italic;
          border: 2px dashed rgba(220, 199, 162, 0.2);
          border-radius: 8px;
        `;
        emptyState.textContent = '플레이어를 추가하세요';
        playersElement.appendChild(emptyState);
        return;
      }
      
      players.forEach((player, index) => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-card';
        playerEl.innerHTML = `
          <div class="player-header">
            <div class="player-name">${player.name}</div>
            <button class="player-remove" onclick="adminInterface.removePlayer('${player.id}')" title="플레이어 제거">×</button>
          </div>
          <div class="player-stats">
            <div class="stat-item">
              <div class="stat-name">공격</div>
              <div class="stat-value">${player.stats.attack}</div>
            </div>
            <div class="stat-item">
              <div class="stat-name">방어</div>
              <div class="stat-value">${player.stats.defense}</div>
            </div>
            <div class="stat-item">
              <div class="stat-name">민첩</div>
              <div class="stat-value">${player.stats.agility}</div>
            </div>
            <div class="stat-item">
              <div class="stat-name">행운</div>
              <div class="stat-value">${player.stats.luck}</div>
            </div>
          </div>
          <div class="player-items">
            ${this.formatPlayerItems(player.items)}
          </div>
        `;
        
        playersElement.appendChild(playerEl);
      });
    }
  }

  formatPlayerItems(items) {
    if (!items || Object.values(items).every(count => count === 0)) {
      return '<span class="no-items">아이템 없음</span>';
    }

    const itemTexts = [];
    if (items.dittany > 0) itemTexts.push(`디터니 ${items.dittany}개`);
    if (items.attackBoost > 0) itemTexts.push(`공격보정 ${items.attackBoost}개`);
    if (items.defenseBoost > 0) itemTexts.push(`방어보정 ${items.defenseBoost}개`);
    
    return itemTexts.map(text => `<span class="item-tag">${text}</span>`).join('');
  }

  removePlayer(playerId) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return;

    if (!confirm(`정말로 "${player.name}" 플레이어를 제거하시겠습니까?`)) return;

    this.socket.emit('admin:remove_player', { 
      battleId: this.state.battleId,
      playerId 
    });
  }

  handlePlayerRemoved(data) {
    console.log('Player removed:', data);
    
    const { playerId } = data;
    const playerIndex = this.state.players.findIndex(p => p.id === playerId);
    
    if (playerIndex > -1) {
      const player = this.state.players[playerIndex];
      this.state.players.splice(playerIndex, 1);
      
      const teamIndex = this.state.teams[player.team].findIndex(p => p.id === playerId);
      if (teamIndex > -1) {
        this.state.teams[player.team].splice(teamIndex, 1);
      }
      
      this.state.totalPlayers--;
      this.showMessage(`플레이어 "${player.name}" 제거됨`, 'info');
      this.updateTeamComposition();
    }
  }

  // 전투 제어
  async startBattle() {
    if (this.state.battleStatus !== 'waiting') {
      this.showMessage('이미 시작된 전투입니다', 'warning');
      return;
    }

    if (this.state.teams.A.length === 0 || this.state.teams.B.length === 0) {
      this.showMessage('양 팀에 최소 1명씩 플레이어가 있어야 합니다', 'error');
      return;
    }

    const teamACount = this.state.teams.A.length;
    const teamBCount = this.state.teams.B.length;
    
    if (teamACount !== teamBCount) {
      if (!confirm(`팀 인원이 다릅니다 (불사조: ${teamACount}명, 죽음을먹는자: ${teamBCount}명). 계속하시겠습니까?`)) {
        return;
      }
    }

    if (!confirm('전투를 시작하시겠습니까? 시작 후에는 플레이어를 추가할 수 없습니다.')) {
      return;
    }

    try {
      this.setButtonLoading(this.elements.startBattleBtn, true);
      
      this.socket.emit('admin:start_battle', {
        battleId: this.state.battleId,
        settings: {
          turnTimeLimit: 300000,
          battleTimeLimit: 3600000,
          maxTurns: 100
        }
      });
      
    } catch (error) {
      this.showMessage('전투 시작 실패: ' + error.message, 'error');
      this.setButtonLoading(this.elements.startBattleBtn, false);
    }
  }

  handleBattleStarted(data) {
    console.log('Battle started:', data);
    
    this.state.battleStatus = 'active';
    this.state.battleStartTime = Date.now();
    
    this.showMessage('전투가 시작되었습니다!', 'success');
    
    this.updateBattleInfo();
    this.setButtonLoading(this.elements.startBattleBtn, false);
    
    // UI 상태 업데이트
    if (this.elements.startBattleBtn) this.elements.startBattleBtn.disabled = false;
    if (this.elements.endBattleBtn) this.elements.endBattleBtn.disabled = true;
    if (this.elements.pauseBattleBtn) this.elements.pauseBattleBtn.disabled = true;
    
    // 플레이어 폼 다시 활성화
    if (this.elements.playerForm) {
      this.elements.playerForm.style.opacity = '1';
      this.elements.playerForm.style.pointerEvents = 'all';
    }
    if (this.elements.addPlayerBtn) this.elements.addPlayerBtn.disabled = false;
  }

  handleBattlePaused(data) {
    console.log('Battle paused:', data);
    
    this.state.battleStatus = 'paused';
    this.showMessage('전투가 일시정지되었습니다', 'info');
    this.updateBattleInfo();
  }

  // OTP 및 링크 관리
  async generateOTPs() {
    if (!this.state.battleId || this.state.players.length === 0) {
      this.showMessage('플레이어를 먼저 추가해주세요', 'error');
      return;
    }

    try {
      this.setButtonLoading(this.elements.generateOtpBtn, true);
      
      const otps = [];
      const baseUrl = window.location.origin;
      
      // 플레이어별 OTP 생성
      for (const player of this.state.players) {
        const otpResponse = await fetch('/api/otp/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'player',
            battleId: this.state.battleId,
            playerId: player.id,
            playerName: player.name,
            team: player.team,
            expiresIn: 3600 // 1시간
          })
        });

        const otpResult = await otpResponse.json();
        
        if (otpResult.success) {
          otps.push({
            playerId: player.id,
            playerName: player.name,
            team: player.team,
            otp: otpResult.otp,
            url: `${baseUrl}/play?battleId=${this.state.battleId}&playerName=${encodeURIComponent(player.name)}&otp=${otpResult.otp}`
          });
        } else {
          console.error(`Failed to generate OTP for ${player.name}:`, otpResult.error);
        }
      }

      // 관전자 링크 생성
      const spectatorResponse = await fetch('/api/otp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'spectator',
          battleId: this.state.battleId,
          expiresIn: 3600,
          maxUses: 30 // 최대 30명
        })
      });

      const spectatorResult = await spectatorResponse.json();
      
      if (spectatorResult.success) {
        this.state.spectatorLink = `${baseUrl}/watch?battleId=${this.state.battleId}&otp=${spectatorResult.otp}`;
      }

      // 관리자 링크 생성
      const adminResponse = await fetch('/api/otp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'admin',
          battleId: this.state.battleId,
          expiresIn: 3600,
          maxUses: 5 // 최대 5명
        })
      });

      const adminResult = await adminResponse.json();
      
      if (adminResult.success) {
        this.state.adminLinks.push(`${baseUrl}/admin?battleId=${this.state.battleId}&otp=${adminResult.otp}`);
      }

      this.state.otpList = otps;
      this.displayOTPs();
      this.showMessage(`${otps.length}개의 플레이어 링크가 생성되었습니다`, 'success');
      
    } catch (error) {
      this.showMessage('링크 생성 실패: ' + error.message, 'error');
      console.error('OTP generation error:', error);
    } finally {
      this.setButtonLoading(this.elements.generateOtpBtn, false);
    }
  }

  displayOTPs() {
    if (!this.elements.otpList) return;

    this.elements.otpList.innerHTML = '';

    // 플레이어 링크들
    this.state.otpList.forEach(item => {
      const otpEl = document.createElement('div');
      otpEl.className = 'otp-item';
      
      const teamName = item.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      const teamClass = item.team === 'A' ? 'phoenix' : 'eaters';
      
      otpEl.innerHTML = `
        <div class="otp-player">
          <span class="player-name">${item.playerName}</span>
          <span class="team-badge ${teamClass}">${teamName}</span>
        </div>
        <div class="otp-url">${item.url}</div>
        <button class="otp-copy" onclick="adminInterface.copyToClipboard('${item.url}', this)">복사</button>
      `;
      
      this.elements.otpList.appendChild(otpEl);
    });

    // 관전자 링크 표시
    if (this.state.spectatorLink && this.elements.spectatorSection) {
      this.elements.spectatorSection.style.display = 'block';
      
      if (this.elements.spectatorLink) {
        this.elements.spectatorLink.innerHTML = `
          <div class="spectator-info">
            <div class="info-label">관전자 링크 (최대 30명)</div>
            <div class="spectator-url">${this.state.spectatorLink}</div>
            <button class="otp-copy" onclick="adminInterface.copyToClipboard('${this.state.spectatorLink}', this)">복사</button>
          </div>
        `;
      }
    }

    // 관리자 링크 표시
    if (this.state.adminLinks.length > 0) {
      const adminSection = document.querySelector('#adminLinksSection');
      if (adminSection) {
        adminSection.style.display = 'block';
        const adminLinksEl = adminSection.querySelector('#adminLinks');
        if (adminLinksEl) {
          adminLinksEl.innerHTML = this.state.adminLinks.map(link => `
            <div class="admin-link-item">
              <div class="admin-url">${link}</div>
              <button class="otp-copy" onclick="adminInterface.copyToClipboard('${link}', this)">복사</button>
            </div>
          `).join('');
        }
      }
    }
  }

  async copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      
      const originalText = button.textContent;
      button.textContent = '복사됨!';
      button.classList.add('copied');
      
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);
      
      // 사운드 효과
      if (window.PyxisFX) {
        window.PyxisFX.playSound('soft', 800, 0.1, 0.2);
      }
      
    } catch (error) {
      console.error('Clipboard copy failed:', error);
      this.showMessage('복사 실패', 'error');
    }
  }

  // 실시간 모니터링
  updateGameState(gameState) {
    // 플레이어 상태 업데이트
    if (gameState.teams) {
      this.state.teams.A = gameState.teams.A || [];
      this.state.teams.B = gameState.teams.B || [];
      this.state.players = [...this.state.teams.A, ...this.state.teams.B];
    }
    
    if (gameState.status) {
      this.state.battleStatus = gameState.status;
    }
    
    // UI 업데이트
    this.updateBattleInfo();
    this.updateTeamComposition();
    this.updateBattleMonitor(gameState);
  }

  updateBattleMonitor(gameState) {
    const monitorPanel = document.querySelector('#battleMonitor');
    if (!monitorPanel) return;
    
    const currentTeamName = gameState.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    const aliveA = gameState.teams?.A?.filter(p => p.status?.isAlive).length || 0;
    const aliveB = gameState.teams?.B?.filter(p => p.status?.isAlive).length || 0;
    
    monitorPanel.innerHTML = `
      <div class="monitor-grid">
        <div class="monitor-card">
          <div class="monitor-label">현재 턴</div>
          <div class="monitor-value">${gameState.currentTurn || 1}</div>
        </div>
        <div class="monitor-card">
          <div class="monitor-label">진행 팀</div>
          <div class="monitor-value">${currentTeamName}</div>
        </div>
        <div class="monitor-card">
          <div class="monitor-label">생존자</div>
          <div class="monitor-value">${aliveA} vs ${aliveB}</div>
        </div>
      </div>
    `;
  }

  updateBattleStats(action) {
    if (!action) return;
    
    // 통계 업데이트
    this.state.battleStats.actionsCount++;
    
    switch (action.type) {
      case 'attack':
        if (action.result === 'critical') {
          this.state.battleStats.criticalHits++;
        }
        if (action.damage) {
          this.state.battleStats.damageDealt += action.damage;
        }
        break;
      case 'heal':
        if (action.amount) {
          this.state.battleStats.healsUsed++;
        }
        break;
    }
    
    this.updateBattleStatsDisplay();
  }

  updateBattleStatsDisplay() {
    if (!this.elements.battleStatsEl) return;
    
    const stats = this.state.battleStats;
    
    this.elements.battleStatsEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">${stats.actionsCount}</div>
          <div class="stat-label">총 액션</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.damageDealt}</div>
          <div class="stat-label">총 대미지</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.criticalHits}</div>
          <div class="stat-label">치명타</div>
        </div>
      </div>
    `;
  }

  startSystemMonitoring() {
    // 시스템 통계 업데이트 (10초마다)
    this.statsInterval = setInterval(() => {
      this.updateSystemStatsDisplay();
    }, 10000);

    // 연결 상태 업데이트 (5초마다)
    this.connectionInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('admin:request_stats');
      }
    }, 5000);
  }

  updateSystemStatsDisplay() {
    if (!this.elements.systemStats) return;

    const uptime = this.state.battleStartTime ? 
      this.formatDuration(Date.now() - this.state.battleStartTime) : 
      this.formatDuration(performance.now());

    const memoryUsage = performance.memory ? 
      Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + 'MB' : 
      'N/A';

    this.elements.systemStats.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">${uptime}</div>
          <div class="stat-label">업타임</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${this.state.connections.total}</div>
          <div class="stat-label">연결 수</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${memoryUsage}</div>
          <div class="stat-label">메모리</div>
        </div>
      </div>
    `;
  }

  updateConnectionStats(stats) {
    this.state.connections = stats;
    
    if (this.elements.connectionStats) {
      this.elements.connectionStats.innerHTML = `
        <div class="connection-breakdown">
          <div class="conn-item">
            <span class="conn-label">관리자</span>
            <span class="conn-count">${stats.byRole.admin || 0}</span>
          </div>
          <div class="conn-item">
            <span class="conn-label">플레이어</span>
            <span class="conn-count">${stats.byRole.player || 0}</span>
          </div>
          <div class="conn-item">
            <span class="conn-label">관전자</span>
            <span class="conn-count">${stats.byRole.spectator || 0}</span>
          </div>
        </div>
      `;
    }
  }

  // 채팅 및 로그
  sendMessage() {
    const input = this.elements.chatInput;
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    if (text.length > 200) {
      this.showMessage('메시지는 200자 이하로 입력해주세요', 'warning');
      return;
    }

    this.socket.emit('chat:admin_message', { 
      text, 
      channel: 'all',
      battleId: this.state.battleId
    });
    
    input.value = '';
  }

  addChatMessage(message) {
    if (!this.elements.chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${message.channel || 'general'}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const senderName = message.sender?.name || '시스템';
    const roleText = message.sender?.role === 'spectator' ? ' [관전]' : 
                    message.sender?.role === 'admin' ? ' [관리자]' : '';

    messageEl.innerHTML = `
      <span class="chat-time">${time}</span>
      <span class="chat-sender">${senderName}${roleText}</span>
      <span class="chat-text">${this.escapeHtml(message.text)}</span>
    `;

    this.elements.chatMessages.appendChild(messageEl);
    this.scrollToBottom(this.elements.chatMessages);
    this.limitChildren(this.elements.chatMessages, 100);
  }

  addCheerMessage(cheer) {
    this.addChatMessage({
      text: `[응원] ${cheer.message}`,
      sender: { name: cheer.spectatorName || cheer.spectator, role: 'spectator' },
      channel: 'cheer',
      timestamp: cheer.timestamp || Date.now()
    });
  }

  addLogEntry(log, type = 'system') {
    if (!this.elements.battleLog) return;

    const logEl = document.createElement('div');
    logEl.className = `log-entry log-${type}`;
    
    const time = new Date(log.timestamp || Date.now()).toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });

    const message = typeof log === 'string' ? log : log.message || log.text || '';

    logEl.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-content">${this.escapeHtml(message)}</span>
    `;

    this.elements.battleLog.appendChild(logEl);
    this.scrollToBottom(this.elements.battleLog);
    this.limitChildren(this.elements.battleLog, 200);
  }

  // 유틸리티 함수
  showMessage(message, type = 'info') {
    // PyxisUI 토스트 사용
    if (window.PyxisUI) {
      const typeMap = {
        success: 'success',
        error: 'error',
        warning: 'warning',
        info: 'info'
      };
      window.PyxisUI.toast(message, typeMap[type] || 'info');
    } else {
      // 폴백: 기본 alert
      alert(`[${type.toUpperCase()}] ${message}`);
    }
  }

  setButtonLoading(button, isLoading) {
    if (!button) return;
    
    if (isLoading) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = '처리중...';
      button.classList.add('loading');
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || '완료';
      button.classList.remove('loading');
      delete button.dataset.originalText;
    }
  }

  showFieldError(fieldName, message) {
    const field = document.querySelector(`#${fieldName}`);
    if (!field) return;
    
    field.classList.add('error');
    
    let errorEl = field.parentNode.querySelector('.field-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'field-error';
      field.parentNode.appendChild(errorEl);
    }
    
    errorEl.textContent = message;
  }

  clearFieldError(fieldName) {
    const field = document.querySelector(`#${fieldName}`);
    if (!field) return;
    
    field.classList.remove('error');
    
    const errorEl = field.parentNode.querySelector('.field-error');
    if (errorEl) {
      errorEl.remove();
    }
  }

  clearAllFieldErrors() {
    document.querySelectorAll('.field-error').forEach(el => el.remove());
    document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom(element) {
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }

  limitChildren(element, limit) {
    while (element.children.length > limit) {
      element.removeChild(element.firstChild);
    }
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}시간`;
    } else if (minutes > 0) {
      return `${minutes}분`;
    } else {
      return `${seconds}초`;
    }
  }

  // 데이터 내보내기
  exportBattleData() {
    const battleData = {
      battleId: this.state.battleId,
      mode: this.state.battleMode,
      status: this.state.battleStatus,
      players: this.state.players,
      teams: this.state.teams,
      stats: this.state.battleStats,
      exportTime: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(battleData, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pyxis-battle-${this.state.battleId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showMessage('전투 데이터가 다운로드되었습니다', 'success');
  }

  // 상태 정보
  getStatus() {
    return {
      authenticated: this.state.isAuthenticated,
      battleId: this.state.battleId,
      battleStatus: this.state.battleStatus,
      totalPlayers: this.state.totalPlayers,
      connections: this.state.connections,
      socketConnected: this.socket?.connected || false
    };
  }

  // 정리
  destroy() {
    // 타이머 정리
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    if (this.connectionInterval) {
      clearInterval(this.connectionInterval);
      this.connectionInterval = null;
    }

    // 소켓 연결 해제
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    // 상태 초기화
    this.state = {
      isAuthenticated: false,
      battleId: null,
      players: [],
      teams: { A: [], B: [] }
    };
    
    console.log('PYXIS Admin Interface destroyed');
  }
}

// 전역 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.adminInterface = new PyxisAdminInterface();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (window.adminInterface) {
    window.adminInterface.destroy();
  }
});

// 전역 함수로 노출 (HTML onclick에서 사용)
window.copyToClipboard = (text, button) => {
  if (window.adminInterface) {
    window.adminInterface.copyToClipboard(text, button);
  }
};.elements.startBattleBtn) this.elements.startBattleBtn.disabled = true;
    if (this.elements.endBattleBtn) this.elements.endBattleBtn.disabled = false;
    if (this.elements.pauseBattleBtn) this.elements.pauseBattleBtn.disabled = false;
    if (this.elements.addPlayerBtn) this.elements.addPlayerBtn.disabled = true;
    
    // 플레이어 폼 비활성화
    if (this.elements.playerForm) {
      this.elements.playerForm.style.opacity = '0.5';
      this.elements.playerForm.style.pointerEvents = 'none';
    }
    
    // 이펙트
    if (window.PyxisFX) {
      window.PyxisFX.screenFlash('rgba(220, 199, 162, 0.2)');
      window.PyxisFX.playSound('victory', 1000, 0.4, 0.4);
    }
  }

  async endBattle() {
    if (this.state.battleStatus !== 'active' && this.state.battleStatus !== 'paused') {
      this.showMessage('진행중인 전투가 없습니다', 'warning');
      return;
    }

    if (!confirm('전투를 강제 종료하시겠습니까?')) {
      return;
    }

    try {
      this.socket.emit('admin:end_battle', {
        battleId: this.state.battleId,
        reason: 'admin_termination'
      });
      
    } catch (error) {
      this.showMessage('전투 종료 실패: ' + error.message, 'error');
    }
  }

  async pauseBattle() {
    if (this.state.battleStatus !== 'active') {
      this.showMessage('진행중인 전투가 없습니다', 'warning');
      return;
    }

    try {
      this.socket.emit('admin:pause_battle', {
        battleId: this.state.battleId
      });
      
    } catch (error) {
      this.showMessage('전투 일시정지 실패: ' + error.message, 'error');
    }
  }

  handleBattleEnded(data) {
    console.log('Battle ended:', data);
    
    this.state.battleStatus = 'ended';
    this.showMessage(`전투가 종료되었습니다. 승리: ${data.winner || '무승부'}`, 'info');
    
    this.updateBattleInfo();
    
    // UI 상태 업데이트
    if (this// PYXIS Admin Interface - Enhanced Gaming Control Panel
// 게임다운 관리자 인터페이스, 실시간 전투 관리, 통계 모니터링
class PyxisAdminInterface {
  constructor() {
    // 상태 관리
    this.state = {
      // 인증
      isAuthenticated: false,
      role: 'admin',
      
      // 전투 정보
      battleId: null,
      battleMode: '2v2',
      battleStatus: 'waiting',
      battleStartTime: null,
      
      // 플레이어 관리
      players: [],
      teams: { A: [], B: [] },
      maxPlayersPerTeam: 2,
      totalPlayers: 0,
      
      // OTP 및 링크
      otpList: [],
      spectatorLink: null,
      adminLinks: [],
      
      // 연결 상태
      connections: { total: 0, byRole: {} },
      
      // 실시간 통계
      battleStats: {
        turnsPlayed: 0,
        actionsCount: 0,
        damageDealt: 0,
        healsUsed: 0,
        criticalHits: 0
      }
    };

    // DOM 캐시
    this.elements = {};
    
    // Socket 연결
    this.socket = null;
    
    // 통계 업데이트 타이머
    this.statsInterval = null;
    this.connectionInterval = null;
    
    // 초기화
    this.init();
  }

  // 초기화
  async init() {
    this.injectStyles();
    this.cacheElements();
    this.bindEvents();
    this.setupFormValidation();
    await this.connectSocket();
    this.startSystemMonitoring();
    this.initializeUI();

    // PyxisUI 연동
    if (window.PyxisUI) {
      window.PyxisUI.enhanceClicks && window.PyxisUI.enhanceClicks();
    }

    console.log('PYXIS Admin Interface initialized');
  }

  // 스타일 주입
  injectStyles() {
    if (document.getElementById('pyxis-admin-styles')) return;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'pyxis-admin-styles';
    styleSheet.textContent = `
      /* PYXIS Admin Interface Enhancements */
      
      .admin-container {
        min-height: 100vh;
        background: linear-gradient(135deg, #00080D 0%, #001E35 100%);
        color: #E2E8F0;
        font-family: 'Inter', sans-serif;
      }

      .admin-header {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.9), 
          rgba(0, 42, 75, 0.8));
        backdrop-filter: blur(12px);
        border-bottom: 2px solid rgba(220, 199, 162, 0.3);
        padding: 20px 24px;
        box-shadow: 0 4px 20px rgba(0, 8, 13, 0.5);
        position: sticky;
        top: 0;
        z-index: 100;
      }

      .admin-title {
        font-family: 'Cinzel', serif;
        font-size: 36px;
        font-weight: 600;
        color: #DCC7A2;
        text-align: center;
        margin-bottom: 8px;
        text-shadow: 0 2px 8px rgba(220, 199, 162, 0.3);
      }

      .admin-subtitle {
        text-align: center;
        color: #94A3B8;
        font-size: 16px;
        font-weight: 500;
      }

      .admin-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        padding: 24px;
        max-width: 1400px;
        margin: 0 auto;
      }

      .admin-section {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.8), 
          rgba(0, 42, 75, 0.7));
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 16px;
        padding: 24px;
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 32px rgba(0, 8, 13, 0.6);
        transition: all 0.3s ease;
      }

      .admin-section:hover {
        border-color: rgba(220, 199, 162, 0.4);
        box-shadow: 0 12px 40px rgba(0, 8, 13, 0.7);
      }

      .section-title {
        font-family: 'Cinzel', serif;
        font-size: 24px;
        font-weight: 600;
        color: #DCC7A2;
        margin-bottom: 20px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(220, 199, 162, 0.2);
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .section-icon {
        width: 28px;
        height: 28px;
        background: linear-gradient(145deg, #DCC7A2, #D4BA8D);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        color: #00080D;
        font-size: 16px;
      }

      /* 전투 생성 섹션 */
      .mode-selector {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 20px;
      }

      .mode-btn {
        padding: 16px 12px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #DCC7A2;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        backdrop-filter: blur(4px);
      }

      .mode-btn:hover {
        border-color: #DCC7A2;
        background: rgba(220, 199, 162, 0.15);
        transform: translateY(-2px);
      }

      .mode-btn.selected {
        border-color: #DCC7A2;
        background: linear-gradient(145deg, 
          rgba(220, 199, 162, 0.2), 
          rgba(212, 183, 126, 0.15));
        box-shadow: 0 4px 12px rgba(220, 199, 162, 0.3);
      }

      .battle-info-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-top: 20px;
      }

      .info-card {
        background: rgba(0, 30, 53, 0.6);
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 12px;
        padding: 16px;
        text-align: center;
      }

      .info-label {
        font-size: 12px;
        color: #64748B;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }

      .info-value {
        font-size: 18px;
        font-weight: 700;
        color: #DCC7A2;
      }

      .status-waiting { color: #F59E0B; }
      .status-active { color: #22C55E; }
      .status-paused { color: #3B82F6; }
      .status-ended { color: #EF4444; }

      /* 플레이어 관리 섹션 */
      .player-form {
        display: grid;
        gap: 20px;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: end;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .form-label {
        font-weight: 600;
        color: #DCC7A2;
        font-size: 14px;
      }

      .form-input {
        padding: 12px 16px;
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #E2E8F0;
        font-size: 14px;
        backdrop-filter: blur(4px);
        transition: all 0.3s ease;
      }

      .form-input:focus {
        outline: none;
        border-color: #DCC7A2;
        box-shadow: 0 0 0 3px rgba(220, 199, 162, 0.1);
      }

      .form-input.error {
        border-color: #EF4444;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
      }

      .field-error {
        color: #EF4444;
        font-size: 12px;
        margin-top: 4px;
      }

      .team-selector {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .team-option {
        padding: 16px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        font-weight: 600;
      }

      .team-option.phoenix {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.1);
      }

      .team-option.eaters {
        border-color: rgba(34, 197, 94, 0.5);
        background: rgba(34, 197, 94, 0.1);
      }

      .team-option.selected {
        border-color: #DCC7A2;
        background: rgba(220, 199, 162, 0.2);
        box-shadow: 0 4px 12px rgba(220, 199, 162, 0.3);
      }

      .stat-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
      }

      .stat-input-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }

      .stat-input {
        width: 60px;
        padding: 8px;
        text-align: center;
        font-weight: 600;
        font-size: 16px;
      }

      .stat-remaining {
        font-size: 18px;
        font-weight: 700;
        color: #DCC7A2;
        text-align: center;
        margin-top: 12px;
      }

      .stat-remaining.over-limit {
        color: #EF4444;
        animation: shake 0.5s ease-in-out;
      }

      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-4px); }
        75% { transform: translateX(4px); }
      }

      .item-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }

      .item-input-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }

      .item-input {
        width: 50px;
        padding: 6px;
        text-align: center;
        font-weight: 600;
      }

      /* 팀 구성 표시 */
      .team-composition {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      .team-panel {
        background: rgba(0, 30, 53, 0.6);
        border: 2px solid rgba(220, 199, 162, 0.2);
        border-radius: 12px;
        padding: 16px;
      }

      .team-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(220, 199, 162, 0.2);
      }

      .team-name {
        font-weight: 600;
        color: #DCC7A2;
        font-size: 16px;
      }

      .team-count {
        background: rgba(220, 199, 162, 0.2);
        color: #DCC7A2;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
      }

      .player-card {
        background: rgba(0, 8, 13, 0.5);
        border: 1px solid rgba(220, 199, 162, 0.15);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        transition: all 0.2s ease;
      }

      .player-card:hover {
        border-color: rgba(220, 199, 162, 0.3);
        background: rgba(0, 8, 13, 0.7);
      }

      .player-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .player-name {
        font-weight: 600;
        color: #E2E8F0;
      }

      .player-remove {
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #EF4444;
        border-radius: 4px;
        padding: 2px 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
      }

      .player-remove:hover {
        background: rgba(239, 68, 68, 0.3);
      }

      .player-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 8px;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .stat-name {
        font-size: 10px;
        color: #64748B;
        text-transform: uppercase;
      }

      .stat-value {
        font-size: 14px;
        font-weight: 600;
        color: #DCC7A2;
      }

      .player-items {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .item-tag {
        background: rgba(220, 199, 162, 0.2);
        color: #DCC7A2;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
      }

      .no-items {
        color: #64748B;
        font-size: 10px;
        font-style: italic;
      }

      /* 버튼 스타일 */
      .admin-btn {
        padding: 12px 24px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #DCC7A2;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        position: relative;
        overflow: hidden;
      }

      .admin-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(220, 199, 162, 0.2) 50%,
          transparent 100%
        );
        transition: left 0.5s ease;
      }

      .admin-btn:hover::before {
        left: 100%;
      }

      .admin-btn:hover:not(:disabled) {
        border-color: #DCC7A2;
        background: rgba(220, 199, 162, 0.15);
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(220, 199, 162, 0.2);
      }

      .admin-btn.primary {
        background: linear-gradient(145deg, #DCC7A2, #D4BA8D);
        color: #00080D;
        border-color: #DCC7A2;
      }

      .admin-btn.primary:hover:not(:disabled) {
        background: linear-gradient(145deg, #D4BA8D, #DCC7A2);
        box-shadow: 0 8px 16px rgba(220, 199, 162, 0.3);
      }

      .admin-btn.success {
        background: linear-gradient(145deg, #22C55E, #16A34A);
        border-color: #22C55E;
      }

      .admin-btn.danger {
        background: linear-gradient(145deg, #EF4444, #DC2626);
        border-color: #EF4444;
      }

      .admin-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
        box-shadow: none !important;
      }

      .admin-btn.loading {
        pointer-events: none;
      }

      /* OTP 및 링크 섹션 */
      .otp-list {
        max-height: 300px;
        overflow-y: auto;
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 8px;
        background: rgba(0, 8, 13, 0.3);
      }

      .otp-item {
        padding: 12px;
        border-bottom: 1px solid rgba(220, 199, 162, 0.1);
        display: flex;
        align-items: center;
        gap: 12px;
        transition: background 0.2s ease;
      }

      .otp-item:hover {
        background: rgba(220, 199, 162, 0.05);
      }

      .otp-player {
        flex: 1;
        font-weight: 600;
        color: #E2E8F0;
      }

      .otp-url {
        flex: 2;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: #94A3B8;
        word-break: break-all;
      }

      .otp-copy {
        background: rgba(220, 199, 162, 0.2);
        border: 1px solid rgba(220, 199, 162, 0.3);
        color: #DCC7A2;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
      }

      .otp-copy:hover {
        background: rgba(220, 199, 162, 0.3);
      }

      .otp-copy.copied {
        background: rgba(34, 197, 94, 0.3);
        border-color: #22C55E;
        color: #22C55E;
      }

      /* 모니터링 섹션 */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 20px;
      }

      .stat-card {
        background: rgba(0, 30, 53, 0.6);
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 12px;
        padding: 16px;
        text-align: center;
        transition: all 0.3s ease;
      }

      .stat-card:hover {
        border-color: rgba(220, 199, 162, 0.4);
        transform: translateY(-2px);
      }

      .stat-number {
        font-size: 28px;
        font-weight: 700;
        color: #DCC7A2;
        margin-bottom: 8px;
      }

      .stat-label {
        font-size: 12px;
        color: #64748B;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      /* 로그 및 채팅 */
      .log-container {
        height: 300px;
        overflow-y: auto;
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 8px;
        background: rgba(0, 8, 13, 0.3);
        padding: 12px;
        margin-bottom: 16px;
      }

      .log-entry {
        margin-bottom: 8px;
        padding: 8px 12px;
        border-radius: 6px;
        border-left: 3px solid transparent;
        font-size: 13px;
        line-height: 1.4;
      }

      .log-system {
        border-left-color: #3B82F6;
        background: rgba(59, 130, 246, 0.05);
        color: #94A3B8;
      }

      .log-battle {
        border-left-color: #22C55E;
        background: rgba(34, 197, 94, 0.05);
        color: #E2E8F0;
      }

      .log-error {
        border-left-color: #EF4444;
        background: rgba(239, 68, 68, 0.05);
        color: #FCA5A5;
      }

      .log-time {
        color: #64748B;
        font-size: 11px;
        margin-right: 8px;
      }

      .chat-input-container {
        display: flex;
        gap: 8px;
      }

      .chat-input {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 8px;
        background: rgba(0, 30, 53, 0.6);
        color: #E2E8F0;
        font-size: 14px;
      }

      .chat-input:focus {
        outline: none;
        border-color: #DCC7A2;
      }

      /* 모바일 최적화 */
      @media (max-width: 1200px) {
        .admin-grid {
          grid-template-columns: 1fr;
          gap: 20px;
        }
      }

      @media (max-width: 768px) {
        .admin-title {
          font-size: 28px;
        }

        .mode-selector {
          grid-template-columns: repeat(2, 1fr);
        }

        .form-row {
          grid-template-columns: 1fr;
        }

        .team-composition {
          grid-template-columns: 1fr;
        }

        .stat-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .battle-info-grid {
          grid-template-columns: 1fr;
        }

        .stats-grid {
          grid-template-columns: 1fr;
        }
      }

      /* 접근성 */
      @media (prefers-reduced-motion: reduce) {
        .admin-btn,
        .mode-btn,
        .team-option,
        .player-card,
        .stat-card {
          transition: none !important;
          animation: none !important;
        }
      }
    `;

    document.head.appendChild(styleSheet);
  }

  cacheElements() {
    // 전투 생성
    this.elements.battleCreationForm = document.querySelector('#battleCreationForm');
    this.elements.modeButtons = document.querySelectorAll('.mode-btn');
    this.elements.createBattleBtn = document.querySelector('#createBattleBtn');
    this.elements.battleInfo = document.querySelector('#battleInfo');
    this.elements.battleStatus = document.querySelector('#battleStatus');

    // 플레이어 관리
    this.elements.playerForm = document.querySelector('#playerForm');
    this.elements.playerName = document.querySelector('#playerName');
    this.elements.teamSelect = document.querySelectorAll('.team-option');
    this.elements.statInputs = {
      attack: document.querySelector('#statAttack'),
      defense: document.querySelector('#statDefense'),
      agility: document.querySelector('#statAgility'),
      luck: document.querySelector('#statLuck')
    };
    this.elements.statRemaining = document.querySelector('#statRemaining');
    this.elements.itemInputs = {
      dittany: document.querySelector('#itemDittany'),
      attackBoost: document.querySelector('#itemAttackBoost'),
      defenseBoost: document.querySelector('#itemDefenseBoost')
    };
    this.elements.avatarUpload = document.querySelector('#avatarUpload');
    this.elements.addPlayerBtn = document.querySelector('#addPlayerBtn');

    // 팀 구성
    this.elements.teamComposition = document.querySelector('#teamComposition');
    this.elements.teamAPlayers = document.querySelector('#teamAPlayers');
    this.elements.teamBPlayers = document.querySelector('#teamBPlayers');
    this.elements.teamACount = document.querySelector('#teamACount');
    this.elements.teamBCount = document.querySelector('#teamBCount');

    // 전투 제어
    this.elements.startBattleBtn = document.querySelector('#startBattleBtn');
    this.elements.endBattleBtn = document.querySelector('#endBattleBtn');
    this.elements.pauseBattleBtn = document.querySelector('#pauseBattleBtn');

    // OTP 및 링크
    this.elements.generateOtpBtn = document.querySelector('#generateOtpBtn');
    this.elements.otpList = document.querySelector('#otpList');
    this.elements.spectatorSection = document.querySelector('#spectatorSection');
    this.elements.spectatorLink = document.querySelector('#spectatorLink');

    // 로그 & 채팅
    this.elements.battleLog = document.querySelector('#battleLog');
    this.elements.chatMessages = document.querySelector('#chatMessages');
    this.elements.chatInput = document.querySelector('#chatInput');
    this.elements.chatSend = document.querySelector('#chatSend');

    // 모니터링
    this.elements.systemStats = document.querySelector('#systemStats');
    this.elements.connectionStats = document.querySelector('#connectionStats');
    this.elements.battleStatsEl = document.querySelector('#battleStats');
  }

  bindEvents() {
    // 전투 모드 선택
    this.elements.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => this.selectMode(btn.dataset.mode));
    });

    // 전투 생성
    if (this.elements.createBattleBtn) {
      this.elements.createBattleBtn.addEventListener('click', () => this.createBattle());
    }

    // 플레이어 추가
    if (this.elements.playerForm) {
      this.elements.playerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.addPlayer();
      });
    }

    // 팀 선택
    this.elements.teamSelect.forEach(option => {
      option.addEventListener('click', () => this.selectTeam(option.dataset.team));
    });

    // 스탯 입력 (실시간 업데이트)
    Object.values(this.elements.statInputs).forEach(input => {
      if (input) {
        input.addEventListener('input', () => {
          this.updateStatRemaining();
          this.validateStatInput(input);
        });
      }
    });

    // 전투 제어
    if (this.elements.startBattleBtn) {
      this.elements.startBattleBtn.addEventListener('click', () => this.startBattle());
    }
    if (this.elements.endBattleBtn) {
      this.elements.endBattleBtn.addEventListener('click', () => this.endBattle());
    }
    if (this.elements.pauseBattleBtn) {
      this.elements.pauseBattleBtn.addEventListener('click', () => this.pauseBattle());
    }

    // OTP 생성
    if (this.elements.generateOtpBtn) {
      this.elements.generateOtpBtn.addEventListener('click', () => this.generateOTPs());
    }

    // 채팅
    if (this.elements.chat
