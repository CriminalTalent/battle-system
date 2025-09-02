// packages/battle-server/public/assets/js/core/pages/admin.js
// PYXIS 관리자 인터페이스 - 전투 생성 및 관리 시스템

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
      
      // 플레이어 관리
      players: [],
      teams: { A: [], B: [] },
      maxPlayersPerTeam: 2,
      
      // OTP 및 링크
      otpList: [],
      spectatorLink: null,
      
      // 연결 상태
      connections: { total: 0, byRole: {} }
    };

    // DOM 캐시
    this.elements = {};
    
    // Socket 연결
    this.socket = null;
    
    // 통계
    this.stats = {
      actionsCount: 0,
      messagesCount: 0,
      connectionsCount: 0
    };
    
    // 초기화
    this.init();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 초기화
  // ═══════════════════════════════════════════════════════════════════════
  
  async init() {
    this.cacheElements();
    this.bindEvents();
    this.setupFormValidation();
    await this.connectSocket();
    this.startSystemMonitoring();
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

    // 스탯 입력
    Object.values(this.elements.statInputs).forEach(input => {
      if (input) {
        input.addEventListener('input', () => this.updateStatRemaining());
      }
    });

    // 전투 제어
    if (this.elements.startBattleBtn) {
      this.elements.startBattleBtn.addEventListener('click', () => this.startBattle());
    }
    if (this.elements.endBattleBtn) {
      this.elements.endBattleBtn.addEventListener('click', () => this.endBattle());
    }

    // OTP 생성
    if (this.elements.generateOtpBtn) {
      this.elements.generateOtpBtn.addEventListener('click', () => this.generateOTPs());
    }

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
  }

  setupFormValidation() {
    // 실시간 폼 검증
    if (this.elements.playerName) {
      this.elements.playerName.addEventListener('blur', (e) => {
        this.validatePlayerName(e.target.value);
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

  // ═══════════════════════════════════════════════════════════════════════
  // Socket 연결
  // ═══════════════════════════════════════════════════════════════════════
  
  async connectSocket() {
    if (typeof io === 'undefined') {
      console.error('[Admin] Socket.IO not loaded');
      return;
    }

    this.socket = io();

    this.socket.on('connect', () => {
      console.log('[Admin] Socket connected');
      this.state.isAuthenticated = true;
      this.showMessage('서버에 연결되었습니다', 'success');
    });

    this.socket.on('disconnect', () => {
      console.log('[Admin] Socket disconnected');
      this.showMessage('서버 연결이 끊어졌습니다', 'error');
    });

    // 관리자 이벤트
    this.socket.on('admin:battle_created', (data) => {
      this.handleBattleCreated(data);
    });

    this.socket.on('admin:player_added', (data) => {
      this.handlePlayerAdded(data);
    });

    this.socket.on('admin:battle_started', (data) => {
      this.handleBattleStarted(data);
    });

    this.socket.on('admin:battle_ended', (data) => {
      this.handleBattleEnded(data);
    });

    this.socket.on('admin:error', (data) => {
      this.showMessage(data.message, 'error');
    });

    // 게임 상태
    this.socket.on('state:update', (state) => {
      this.updateGameState(state);
    });

    this.socket.on('log:new', (log) => {
      this.addLogEntry(log);
    });

    // 채팅
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
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 전투 생성 관리
  // ═══════════════════════════════════════════════════════════════════════
  
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

    console.log(`[Admin] Mode selected: ${mode}`);
  }

  async createBattle() {
    if (this.state.battleId) {
      this.showMessage('이미 전투가 생성되어 있습니다', 'warning');
      return;
    }

    try {
      this.showLoading(this.elements.createBattleBtn, true);
      
      this.socket.emit('admin:create_battle', {
        mode: this.state.battleMode
      });
      
    } catch (error) {
      this.showMessage('전투 생성 실패: ' + error.message, 'error');
    }
  }

  handleBattleCreated(data) {
    console.log('[Admin] Battle created:', data);
    
    this.state.battleId = data.battleId;
    this.state.battleStatus = data.status;
    
    this.showMessage(`전투가 생성되었습니다! ID: ${data.battleId}`, 'success');
    
    // UI 업데이트
    this.updateBattleInfo();
    this.showLoading(this.elements.createBattleBtn, false);
    
    // 플레이어 추가 섹션 활성화
    this.enablePlayerManagement();
  }

  updateBattleInfo() {
    if (!this.elements.battleInfo) return;

    if (this.state.battleId) {
      this.elements.battleInfo.innerHTML = `
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">전투 ID</span>
            <span class="info-value">${this.state.battleId}</span>
          </div>
          <div class="info-item">
            <span class="info-label">모드</span>
            <span class="info-value">${this.state.battleMode}</span>
          </div>
          <div class="info-item">
            <span class="info-label">상태</span>
            <span class="info-value status-${this.state.battleStatus}">${this.getBattleStatusText()}</span>
          </div>
        </div>
      `;
    } else {
      this.elements.battleInfo.innerHTML = '<p class="no-battle">전투를 먼저 생성하세요</p>';
    }
  }

  getBattleStatusText() {
    switch (this.state.battleStatus) {
      case 'waiting': return '대기중';
      case 'active': return '진행중';
      case 'paused': return '일시중지';
      case 'ended': return '종료됨';
      default: return this.state.battleStatus;
    }
  }

  enablePlayerManagement() {
    // 플레이어 추가 폼 활성화
    if (this.elements.playerForm) {
      this.elements.playerForm.style.display = 'block';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 플레이어 관리
  // ═══════════════════════════════════════════════════════════════════════
  
  selectTeam(team) {
    this.state.selectedTeam = team;
    
    this.elements.teamSelect.forEach(option => {
      if (option.dataset.team === team) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  }

  updateStatRemaining() {
    const totalAllocated = Object.values(this.elements.statInputs)
      .reduce((sum, input) => sum + (parseInt(input.value) || 0), 0);
    
    const remaining = 12 - totalAllocated;
    
    if (this.elements.statRemaining) {
      this.elements.statRemaining.textContent = remaining;
      
      if (remaining < 0) {
        this.elements.statRemaining.classList.add('over-limit');
      } else {
        this.elements.statRemaining.classList.remove('over-limit');
      }
    }

    return remaining;
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
    if (this.state.players.some(p => p.name === name)) {
      this.showFieldError('playerName', '이미 사용중인 이름입니다');
      return false;
    }

    this.clearFieldError('playerName');
    return true;
  }

  validateStat(statName, value) {
    const num = parseInt(value);
    
    if (isNaN(num) || num < 1 || num > 10) {
      this.showFieldError(statName, '1-10 사이의 값을 입력해주세요');
      return false;
    }

    this.clearFieldError(statName);
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
      this.showMessage('팀을 선택해주세요', 'error');
      return;
    }

    const statRemaining = this.updateStatRemaining();
    if (statRemaining !== 0) {
      this.showMessage(`스탯 포인트를 모두 분배해주세요 (남은 포인트: ${statRemaining})`, 'error');
      return;
    }

    // 팀 인원 제한 체크
    const teamCount = this.state.teams[this.state.selectedTeam].length;
    if (teamCount >= this.state.maxPlayersPerTeam) {
      this.showMessage(`${this.state.selectedTeam} 팀이 가득 찼습니다 (${this.state.maxPlayersPerTeam}명 제한)`, 'error');
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
      items: []
    };

    // 아이템 추가
    Object.entries(this.elements.itemInputs).forEach(([itemType, input]) => {
      const count = parseInt(input.value) || 0;
      if (count > 0) {
        playerData.items.push(`${itemType}:${count}`);
      }
    });

    try {
      this.showLoading(this.elements.addPlayerBtn, true);
      
      this.socket.emit('admin:add_player', playerData);
      
    } catch (error) {
      this.showMessage('플레이어 추가 실패: ' + error.message, 'error');
      this.showLoading(this.elements.addPlayerBtn, false);
    }
  }

  handlePlayerAdded(data) {
    console.log('[Admin] Player added:', data);
    
    const player = data.player;
    this.state.players.push(player);
    this.state.teams[player.team].push(player);
    
    this.showMessage(`플레이어 "${player.name}" 추가 완료`, 'success');
    
    // 폼 초기화
    this.resetPlayerForm();
    this.updateTeamComposition();
    this.showLoading(this.elements.addPlayerBtn, false);
    
    // 아바타 업로드
    this.handleAvatarUpload(player.id);
  }

  async handleAvatarUpload(playerId) {
    const fileInput = this.elements.avatarUpload;
    if (!fileInput || !fileInput.files[0]) return;

    const formData = new FormData();
    formData.append('avatar', fileInput.files[0]);
    formData.append('playerId', playerId);

    try {
      const response = await fetch(`/api/battles/${this.state.battleId}/avatar`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (result.ok) {
        this.showMessage('아바타 업로드 완료', 'success');
      } else {
        this.showMessage('아바타 업로드 실패: ' + result.error, 'warning');
      }
    } catch (error) {
      console.error('[Admin] Avatar upload error:', error);
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
      if (input) input.value = '0';
    });
    
    // 아바타 초기화
    if (this.elements.avatarUpload) this.elements.avatarUpload.value = '';
    
    // 팀 선택 해제
    this.elements.teamSelect.forEach(option => option.classList.remove('selected'));
    this.state.selectedTeam = null;
    
    this.updateStatRemaining();
  }

  updateTeamComposition() {
    this.updateTeamDisplay('A', this.elements.teamAPlayers, this.elements.teamACount);
    this.updateTeamDisplay('B', this.elements.teamBPlayers, this.elements.teamBCount);
  }

  updateTeamDisplay(team, playersElement, countElement) {
    const players = this.state.teams[team];
    
    if (countElement) {
      countElement.textContent = `${players.length}/${this.state.maxPlayersPerTeam}`;
    }

    if (playersElement) {
      playersElement.innerHTML = '';
      
      players.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-card';
        playerEl.innerHTML = `
          <div class="player-header">
            <div class="player-name">${player.name}</div>
            <button class="player-remove" onclick="adminInterface.removePlayer('${player.id}')">×</button>
          </div>
          <div class="player-stats">
            <div class="stat-item">
              <span class="stat-name">공격</span>
              <span class="stat-value">${player.stats.attack}</span>
            </div>
            <div class="stat-item">
              <span class="stat-name">방어</span>
              <span class="stat-value">${player.stats.defense}</span>
            </div>
            <div class="stat-item">
              <span class="stat-name">민첩</span>
              <span class="stat-value">${player.stats.agility}</span>
            </div>
            <div class="stat-item">
              <span class="stat-name">행운</span>
              <span class="stat-value">${player.stats.luck}</span>
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
    if (items.dittany > 0) itemTexts.push(`디터니 ${items.dittany}`);
    if (items.attackBoost > 0) itemTexts.push(`공격보정 ${items.attackBoost}`);
    if (items.defenseBoost > 0) itemTexts.push(`방어보정 ${items.defenseBoost}`);
    
    return itemTexts.map(text => `<span class="item-tag">${text}</span>`).join('');
  }

  removePlayer(playerId) {
    if (!confirm('정말로 이 플레이어를 제거하시겠습니까?')) return;

    this.socket.emit('admin:remove_player', { playerId });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 전투 제어
  // ═══════════════════════════════════════════════════════════════════════
  
  async startBattle() {
    if (this.state.battleStatus !== 'waiting') {
      this.showMessage('이미 시작된 전투입니다', 'warning');
      return;
    }

    if (this.state.teams.A.length === 0 || this.state.teams.B.length === 0) {
      this.showMessage('양 팀에 최소 1명씩 플레이어가 있어야 합니다', 'error');
      return;
    }

    if (!confirm('전투를 시작하시겠습니까? 시작 후에는 플레이어를 추가할 수 없습니다.')) {
      return;
    }

    try {
      this.showLoading(this.elements.startBattleBtn, true);
      
      this.socket.emit('admin:start_battle', {
        battleId: this.state.battleId
      });
      
    } catch (error) {
      this.showMessage('전투 시작 실패: ' + error.message, 'error');
      this.showLoading(this.elements.startBattleBtn, false);
    }
  }

  handleBattleStarted(data) {
    console.log('[Admin] Battle started:', data);
    
    this.state.battleStatus = 'active';
    this.showMessage('전투가 시작되었습니다!', 'success');
    
    this.updateBattleInfo();
    this.showLoading(this.elements.startBattleBtn, false);
    
    // UI 업데이트
    if (this.elements.startBattleBtn) this.elements.startBattleBtn.disabled = true;
    if (this.elements.endBattleBtn) this.elements.endBattleBtn.disabled = false;
  }

  async endBattle() {
    if (this.state.battleStatus !== 'active') {
      this.showMessage('진행중인 전투가 없습니다', 'warning');
      return;
    }

    if (!confirm('전투를 강제 종료하시겠습니까?')) {
      return;
    }

    try {
      this.socket.emit('admin:end_battle', {
        battleId: this.state.battleId
      });
      
    } catch (error) {
      this.showMessage('전투 종료 실패: ' + error.message, 'error');
    }
  }

  handleBattleEnded(data) {
    console.log('[Admin] Battle ended:', data);
    
    this.state.battleStatus = 'ended';
    this.showMessage('전투가 종료되었습니다', 'info');
    
    this.updateBattleInfo();
    
    // UI 업데이트
    if (this.elements.startBattleBtn) this.elements.startBattleBtn.disabled = false;
    if (this.elements.endBattleBtn) this.elements.endBattleBtn.disabled = true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OTP 및 링크 관리
  // ═══════════════════════════════════════════════════════════════════════
  
  async generateOTPs() {
    if (!this.state.battleId || this.state.players.length === 0) {
      this.showMessage('플레이어를 먼저 추가해주세요', 'error');
      return;
    }

    try {
      this.showLoading(this.elements.generateOtpBtn, true);
      
      const otps = [];
      
      for (const player of this.state.players) {
        const response = await fetch('/api/otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'player',
            battleId: this.state.battleId,
            playerId: player.id,
            playerName: player.name,
            expiresIn: 3600 // 1시간
          })
        });

        const result = await response.json();
        
        if (result.ok) {
          otps.push({
            playerId: player.id,
            playerName: player.name,
            team: player.team,
            otp: result.otp,
            url: `${window.location.origin}/play?battleId=${this.state.battleId}&name=${encodeURIComponent(player.name)}&otp=${result.otp}`
          });
        }
      }

      // 관전자 링크 생성
      const spectatorResponse = await fetch('/api/otp', {
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
      
      if (spectatorResult.ok) {
        this.state.spectatorLink = `${window.location.origin}/watch?battleId=${this.state.battleId}&otp=${spectatorResult.otp}`;
      }

      this.state.otpList = otps;
      this.displayOTPs();
      this.showMessage(`${otps.length}개의 플레이어 링크가 생성되었습니다`, 'success');
      
    } catch (error) {
      this.showMessage('링크 생성 실패: ' + error.message, 'error');
    } finally {
      this.showLoading(this.elements.generateOtpBtn, false);
    }
  }

  displayOTPs() {
    if (!this.elements.otpList) return;

    this.elements.otpList.innerHTML = '';

    this.state.otpList.forEach(item => {
      const otpEl = document.createElement('div');
      otpEl.className = 'otp-item';
      
      const teamName = item.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      
      otpEl.innerHTML = `
        <div class="otp-player">${item.playerName} (${teamName})</div>
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
          <div class="spectator-url">${this.state.spectatorLink}</div>
          <button class="otp-copy" onclick="adminInterface.copyToClipboard('${this.state.spectatorLink}', this)">복사</button>
        `;
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
      
    } catch (error) {
      this.showMessage('복사 실패', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 실시간 모니터링
  // ═══════════════════════════════════════════════════════════════════════
  
  updateGameState(gameState) {
    // 플레이어 상태 업데이트
    this.state.players = [...gameState.teams.A.players, ...gameState.teams.B.players];
    this.state.teams.A = gameState.teams.A.players;
    this.state.teams.B = gameState.teams.B.players;
    this.state.battleStatus = gameState.status;
    
    // UI 업데이트
    this.updateBattleInfo();
    this.updateTeamComposition();
    
    // 실시간 전투 정보 업데이트
    this.updateBattleMonitor(gameState);
  }

  updateBattleMonitor(gameState) {
    // 현재 턴 정보 표시
    const currentTeamName = gameState.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    
    // 모니터링 패널이 있다면 업데이트
    const monitorPanel = document.querySelector('#battleMonitor');
    if (monitorPanel) {
      monitorPanel.innerHTML = `
        <div class="monitor-info">
          <div class="current-turn">
            <span class="label">현재 턴:</span>
            <span class="value">${gameState.currentTurn} - ${currentTeamName}</span>
          </div>
          <div class="battle-phase">
            <span class="label">페이즈:</span>
            <span class="value">${this.getPhaseText(gameState.currentPhase)}</span>
          </div>
          <div class="alive-count">
            <span class="label">생존자:</span>
            <span class="value">
              A팀: ${gameState.teams.A.players.filter(p => p.status.isAlive).length}명 | 
              B팀: ${gameState.teams.B.players.filter(p => p.status.isAlive).length}명
            </span>
          </div>
        </div>
      `;
    }
  }

  getPhaseText(phase) {
    switch (phase) {
      case 'team_action': return '팀 액션';
      case 'resolution': return '액션 처리';
      case 'end_turn': return '턴 종료';
      default: return phase;
    }
  }

  startSystemMonitoring() {
    setInterval(() => {
      this.updateSystemStats();
    }, 5000); // 5초마다 업데이트
  }

  updateSystemStats() {
    if (!this.elements.systemStats) return;

    const stats = {
      uptime: this.formatUptime(performance.now()),
      memory: this.formatMemory(performance.memory),
      connections: this.state.connections.total,
      battles: 1, // 현재 전투 개수
      messages: this.stats.messagesCount
    };

    this.elements.systemStats.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">업타임</span>
        <span class="stat-value">${stats.uptime}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">연결</span>
        <span class="stat-value">${stats.connections}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">메시지</span>
        <span class="stat-value">${stats.messages}</span>
      </div>
    `;
  }

  updateConnectionStats(stats) {
    this.state.connections = stats;
    
    if (this.elements.connectionStats) {
      this.elements.connectionStats.innerHTML = `
        <div class="connection-breakdown">
          <div class="conn-item">관리자: ${stats.byRole.admin || 0}</div>
          <div class="conn-item">플레이어: ${stats.byRole.player || 0}</div>
          <div class="conn-item">관전자: ${stats.byRole.spectator || 0}</div>
        </div>
      `;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 채팅 및 로그
  // ═══════════════════════════════════════════════════════════════════════
  
  sendMessage() {
    const input = this.elements.chatInput;
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    this.socket.emit('chat:send', { 
      text, 
      channel: 'all' 
    });
    
    input.value = '';
    this.stats.messagesCount++;
  }

  addChatMessage(message) {
    if (!this.elements.chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${message.channel}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const senderName = message.sender.name || '익명';
    const roleText = message.sender.role === 'spectator' ? ' [관전]' : '';

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
      sender: { name: cheer.spectator, role: 'spectator' },
      channel: 'cheer',
      timestamp: cheer.timestamp
    });
  }

  addLogEntry(log) {
    if (!this.elements.battleLog) return;

    const logEl = document.createElement('div');
    logEl.className = `log-entry ${log.type}`;
    
    const time = new Date(log.timestamp).toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });

    logEl.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-content">${this.escapeHtml(log.message)}</span>
    `;

    this.elements.battleLog.appendChild(logEl);
    this.scrollToBottom(this.elements.battleLog);
    
    this.limitChildren(this.elements.battleLog, 200);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 유틸리티 함수
  // ═══════════════════════════════════════════════════════════════════════
  
  showMessage(message, type = 'info') {
    // 토스트 알림 표시
    const toast = document.createElement('div');
    toast.className = `admin-toast toast-${type}`;
    toast.textContent = message;
    
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 24px;
      background: var(--surface-2);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius);
      color: var(--text-bright);
      z-index: 10000;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
      max-width: 400px;
    `;

    // 타입별 색상
    switch (type) {
      case 'success':
        toast.style.borderColor = 'var(--success)';
        break;
      case 'error':
        toast.style.borderColor = 'var(--danger)';
        break;
      case 'warning':
        toast.style.borderColor = 'var(--warning)';
        break;
    }

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 10);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  showLoading(button, isLoading) {
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

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}시간 ${minutes % 60}분`;
    } else if (minutes > 0) {
      return `${minutes}분`;
    } else {
      return `${seconds}초`;
    }
  }

  formatMemory(memory) {
    if (!memory) return 'N/A';
    const mb = Math.round(memory.usedJSHeapSize / 1024 / 1024);
    return `${mb}MB`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 정리
  // ═══════════════════════════════════════════════════════════════════════
  
  destroy() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    console.log('[Admin] Interface destroyed');
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
