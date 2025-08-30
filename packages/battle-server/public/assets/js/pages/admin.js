// PYXIS Admin Page - 완전히 새로운 관리자 페이지 로직
class PyxisAdmin {
  constructor() {
    // 상태 관리
    this.currentBattleId = null;
    this.adminOtp = null;
    this.spectatorOtp = null;
    this.battleState = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    
    // 데이터
    this.playersList = new Map();
    this.generatedLinks = new Map();
    
    this.init();
  }

  // 초기화
  init() {
    console.log('[Admin] Initializing new admin page');
    
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();
    
    // 소켓 연결
    PyxisSocket.init();
  }

  // DOM 요소 설정
  setupElements() {
    // 전투 제어
    this.battleCreateForm = UI.$('#battleCreateForm');
    this.battleMode = UI.$('#battleMode');
    this.battleStatus = UI.$('#battleStatus');
    
    // 전투 정보
    this.battleInfo = UI.$('#battleInfo');
    this.battleIdDisplay = UI.$('#battleIdDisplay');
    this.adminOtpDisplay = UI.$('#adminOtpDisplay');
    this.spectatorOtpDisplay = UI.$('#spectatorOtpDisplay');
    
    // 제어 버튼
    this.controlActions = UI.$('#controlActions');
    this.btnConnect = UI.$('#btnConnect');
    this.btnStartBattle = UI.$('#btnStartBattle');
    this.btnPauseBattle = UI.$('#btnPauseBattle');
    this.btnEndBattle = UI.$('#btnEndBattle');
    
    // 링크 섹션
    this.linksSection = UI.$('#linksSection');
    this.btnGenerateLinks = UI.$('#btnGenerateLinks');
    this.linksList = UI.$('#linksList');
    
    // 플레이어 관리
    this.playerAddForm = UI.$('#playerAddForm');
    this.playerName = UI.$('#playerName');
    this.playerTeam = UI.$('#playerTeam');
    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');
    this.itemDittany = UI.$('#itemDittany');
    this.itemAttackBoost = UI.$('#itemAttackBoost');
    this.itemDefenseBoost = UI.$('#itemDefenseBoost');
    this.avatarFile = UI.$('#avatarFile');
    this.avatarPreview = UI.$('#avatarPreview');
    
    // 로스터
    this.rosterCard = UI.$('#rosterCard');
    this.team1Roster = UI.$('#team1Roster');
    this.team2Roster = UI.$('#team2Roster');
    
    // 로그 & 채팅
    this.logViewer = UI.$('#logViewer');
    this.chatChannel = UI.$('#chatChannel');
    this.chatInput = UI.$('#chatInput');
    this.btnSendChat = UI.$('#btnSendChat');
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 전투 생성
    this.battleCreateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createBattle();
    });

    // 제어 버튼들
    this.btnConnect.addEventListener('click', () => this.connectAsAdmin());
    this.btnStartBattle.addEventListener('click', () => this.startBattle());
    this.btnPauseBattle.addEventListener('click', () => this.pauseBattle());
    this.btnEndBattle.addEventListener('click', () => this.endBattle());
    
    // 링크 생성
    this.btnGenerateLinks.addEventListener('click', () => this.generateLinks());

    // 플레이어 추가
    this.playerAddForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addPlayer();
    });

    // 아바타 미리보기
    this.avatarFile.addEventListener('change', (e) => this.handleAvatarPreview(e));

    // 채팅
    this.btnSendChat.addEventListener('click', () => this.sendChatMessage());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendChatMessage();
      }
    });

    // URL 변경 감지
    window.addEventListener('popstate', () => this.initFromUrl());
  }

  // 소켓 이벤트 설정
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.isConnected = true;
      UI.success('서버에 연결되었습니다');
    });

    PyxisSocket.on('connection:disconnect', () => {
      this.isConnected = false;
      if (this.isAuthenticated) {
        UI.warning('서버 연결이 끊어졌습니다. 재연결 시도 중...');
      }
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      this.isConnected = false;
      UI.error(`연결 오류: ${error.message || '알 수 없는 오류'}`);
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.isConnected = true;
      UI.success(`서버에 재연결되었습니다 (시도 ${attemptNumber}회)`);
      
      if (this.isAuthenticated) {
        this.requestStateUpdate();
      }
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => {
      this.handleAuthSuccess(data);
    });

    PyxisSocket.on('authError', (message) => {
      UI.error(`인증 실패: ${message || '알 수 없는 오류'}`);
      UI.setLoading(this.btnConnect, false);
    });

    // 게임 상태
    PyxisSocket.on('state:update', (state) => {
      this.handleStateUpdate(state);
    });

    PyxisSocket.on('state', (state) => {
      this.handleStateUpdate(state);
    });

    // 채팅
    PyxisSocket.on('chat:new', (message) => {
      this.handleChatMessage(message);
    });

    // 로그
    PyxisSocket.on('log:new', (event) => {
      if (event?.text) {
        this.addLogEntry(event.text, event.type || 'system');
      }
    });

    // 전투 이벤트
    PyxisSocket.on('battle:created', (data) => {
      this.handleBattleCreated(data);
    });

    PyxisSocket.on('battle:started', (data) => {
      this.handleBattleStarted(data);
    });

    PyxisSocket.on('battle:ended', (result) => {
      this.handleBattleEnded(result);
    });

    PyxisSocket.on('player:added', (data) => {
      this.handlePlayerAdded(data);
    });

    PyxisSocket.on('player:removed', (data) => {
      this.handlePlayerRemoved(data);
    });

    // 에러 처리
    PyxisSocket.on('error', (error) => {
      console.error('[Admin] Socket error:', error);
      UI.error(`오류: ${error.message || '알 수 없는 오류'}`);
    });
  }

  // URL에서 초기값 설정
  initFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const battleId = urlParams.get('battle');
    
    if (battleId) {
      this.currentBattleId = battleId;
      // 기존 전투 정보 요청
      this.requestBattleInfo(battleId);
    }
  }

  // 전투 생성
  async createBattle() {
    const mode = this.battleMode.value;
    const submitBtn = this.battleCreateForm.querySelector('button[type="submit"]');
    
    UI.setLoading(submitBtn, true);
    
    try {
      const response = await fetch('/api/admin/battles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode })
      });
      
      const data = await response.json();
      
      if (data.ok && data.battle) {
        this.currentBattleId = data.battle.id;
        this.adminOtp = data.battle.otp?.admin?.value;
        this.spectatorOtp = data.battle.otp?.spectatorPool ? 
          Array.from(data.battle.otp.spectatorPool.keys())[0] : null;
        
        this.updateBattleInfo();
        this.showBattleControls();
        
        UI.success(`전투가 생성되었습니다: ${this.currentBattleId}`);
        this.addLogEntry(`전투 생성: ${mode} 모드`, 'system');
        
        // URL 업데이트
        const url = new URL(window.location);
        url.searchParams.set('battle', this.currentBattleId);
        window.history.pushState({}, '', url);
      } else {
        throw new Error(data.message || '전투 생성 실패');
      }
    } catch (error) {
      console.error('[Admin] Battle creation error:', error);
      UI.error(`전투 생성 실패: ${error.message}`);
    } finally {
      UI.setLoading(submitBtn, false);
    }
  }

  // 전투 정보 업데이트
  updateBattleInfo() {
    if (this.battleIdDisplay) {
      this.battleIdDisplay.textContent = this.currentBattleId || '-';
    }
    if (this.adminOtpDisplay) {
      this.adminOtpDisplay.textContent = this.adminOtp || '-';
    }
    if (this.spectatorOtpDisplay) {
      this.spectatorOtpDisplay.textContent = this.spectatorOtp || '-';
    }
  }

  // 전투 제어 UI 표시
  showBattleControls() {
    if (this.battleInfo) {
      this.battleInfo.style.display = 'block';
    }
    if (this.controlActions) {
      this.controlActions.style.display = 'grid';
    }
    if (this.linksSection) {
      this.linksSection.style.display = 'block';
    }
    if (this.rosterCard) {
      this.rosterCard.style.display = 'block';
    }
  }

  // 관리자 연결
  connectAsAdmin() {
    if (!this.currentBattleId || !this.adminOtp) {
      UI.error('전투를 먼저 생성해주세요');
      return;
    }

    UI.setLoading(this.btnConnect, true);

    PyxisSocket.emit('adminAuth', {
      battleId: this.currentBattleId,
      otp: this.adminOtp
    });
  }

  // 인증 성공 처리
  handleAuthSuccess(data) {
    console.log('[Admin] Authentication successful:', data);
    
    this.isAuthenticated = true;
    this.battleState = data.battle || data;
    
    UI.success('관리자로 인증되었습니다!');
    UI.setLoading(this.btnConnect, false);
    
    this.updateControlButtons();
    this.updateRoster();
    this.addLogEntry('관리자 인증 완료', 'system');
  }

  // 제어 버튼 상태 업데이트
  updateControlButtons() {
    if (!this.battleState) return;
    
    const status = this.battleState.status;
    const hasPlayers = this.getPlayersCount() > 0;
    
    // 상태 인디케이터 업데이트
    this.updateStatusIndicator(status);
    
    // 버튼 활성화 상태
    if (this.btnStartBattle) {
      this.btnStartBattle.disabled = !(status === 'waiting' && hasPlayers && this.isAuthenticated);
    }
    if (this.btnPauseBattle) {
      this.btnPauseBattle.disabled = !(status === 'ongoing' && this.isAuthenticated);
    }
    if (this.btnEndBattle) {
      this.btnEndBattle.disabled = !(status === 'ongoing' && this.isAuthenticated);
    }
  }

  // 상태 인디케이터 업데이트
  updateStatusIndicator(status) {
    if (!this.battleStatus) return;
    
    const statusDot = this.battleStatus.querySelector('.status-dot');
    const statusText = this.battleStatus.querySelector('span');
    
    let statusClass = 'waiting';
    let statusLabel = '대기중';
    
    switch (status) {
      case 'waiting':
        statusClass = 'waiting';
        statusLabel = '대기중';
        break;
      case 'ongoing':
        statusClass = 'ongoing';
        statusLabel = '전투중';
        break;
      case 'ended':
        statusClass = 'ended';
        statusLabel = '종료됨';
        break;
    }
    
    this.battleStatus.className = `status-indicator ${statusClass}`;
    if (statusText) {
      statusText.textContent = statusLabel;
    }
  }

  // 플레이어 수 얻기
  getPlayersCount() {
    return this.playersList.size;
  }

  // 전투 시작
  startBattle() {
    if (!this.isAuthenticated) {
      UI.error('먼저 관리자 인증을 완료해주세요');
      return;
    }

    UI.setLoading(this.btnStartBattle, true);

    PyxisSocket.emit('admin:startBattle', {
      battleId: this.currentBattleId
    });
  }

  // 전투 일시정지
  pauseBattle() {
    if (!this.isAuthenticated) {
      UI.error('먼저 관리자 인증을 완료해주세요');
      return;
    }

    UI.setLoading(this.btnPauseBattle, true);

    PyxisSocket.emit('admin:pauseBattle', {
      battleId: this.currentBattleId
    });
  }

  // 전투 종료
  endBattle() {
    if (!this.isAuthenticated) {
      UI.error('먼저 관리자 인증을 완료해주세요');
      return;
    }

    if (!confirm('정말로 전투를 종료하시겠습니까?')) {
      return;
    }

    UI.setLoading(this.btnEndBattle, true);

    PyxisSocket.emit('admin:endBattle', {
      battleId: this.currentBattleId
    });
  }

  // 플레이어 추가
  addPlayer() {
    if (!this.currentBattleId) {
      UI.error('먼저 전투를 생성해주세요');
      return;
    }

    const playerData = {
      name: this.playerName.value.trim(),
      team: this.playerTeam.value,
      stats: {
        attack: parseInt(this.statAttack.value),
        defense: parseInt(this.statDefense.value),
        agility: parseInt(this.statAgility.value),
        luck: parseInt(this.statLuck.value)
      },
      items: {
        dittany: parseInt(this.itemDittany.value),
        atkBoost: parseInt(this.itemAttackBoost.value),
        defBoost: parseInt(this.itemDefenseBoost.value)
      }
    };

    // 유효성 검사
    if (!playerData.name) {
      UI.error('플레이어 이름을 입력해주세요');
      return;
    }

    if (this.playersList.has(playerData.name)) {
      UI.error('이미 존재하는 플레이어 이름입니다');
      return;
    }

    // 스탯 합계 체크 (예: 최대 30)
    const statSum = playerData.stats.attack + playerData.stats.defense + 
                   playerData.stats.agility + playerData.stats.luck;
    
    if (statSum > 30) {
      UI.error('스탯 총합은 30을 초과할 수 없습니다');
      return;
    }

    const submitBtn = this.playerAddForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true);

    // 아바타 파일이 있으면 업로드
    if (this.avatarFile.files.length > 0) {
      this.uploadAvatarAndAddPlayer(playerData, submitBtn);
    } else {
      this.submitPlayerData(playerData, submitBtn);
    }
  }

  // 아바타 업로드 및 플레이어 추가
  async uploadAvatarAndAddPlayer(playerData, submitBtn) {
    try {
      const formData = new FormData();
      formData.append('avatar', this.avatarFile.files[0]);

      const response = await fetch(`/api/battles/${this.currentBattleId}/avatar`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (result.ok && result.avatarUrl) {
        playerData.avatar = result.avatarUrl;
      }

      this.submitPlayerData(playerData, submitBtn);
    } catch (error) {
      console.error('[Admin] Avatar upload error:', error);
      UI.warning('아바타 업로드에 실패했습니다. 플레이어는 기본 아바타로 추가됩니다.');
      this.submitPlayerData(playerData, submitBtn);
    }
  }

  // 플레이어 데이터 제출
  submitPlayerData(playerData, submitBtn) {
    PyxisSocket.emit('admin:addPlayer', {
      battleId: this.currentBattleId,
      player: playerData
    });

    // 성공 시 폼 리셋은 handlePlayerAdded에서
    // 실패 시 로딩 해제는 에러 핸들러에서
  }

  // 플레이어 추가 성공 처리
  handlePlayerAdded(data) {
    console.log('[Admin] Player added:', data);
    
    if (data.ok && data.player) {
      this.playersList.set(data.player.name, data.player);
      
      UI.success(`플레이어 "${data.player.name}"이 추가되었습니다`);
      this.addLogEntry(`플레이어 추가: ${data.player.name} (${this.getTeamName(data.player.team)})`, 'system');
      
      this.resetPlayerForm();
      this.updateRoster();
      this.updateControlButtons();
    } else {
      UI.error(data.message || '플레이어 추가 실패');
    }

    const submitBtn = this.playerAddForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, false);
  }

  // 플레이어 폼 리셋
  resetPlayerForm() {
    this.playerName.value = '';
    this.statAttack.value = '5';
    this.statDefense.value = '5';
    this.statAgility.value = '5';
    this.statLuck.value = '5';
    this.itemDittany.value = '2';
    this.itemAttackBoost.value = '1';
    this.itemDefenseBoost.value = '1';
    this.avatarFile.value = '';
    this.avatarPreview.innerHTML = '';
  }

  // 팀 이름 얻기
  getTeamName(teamId) {
    return teamId === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
  }

  // 로스터 업데이트
  updateRoster() {
    this.updateTeamRoster('team1', this.team1Roster);
    this.updateTeamRoster('team2', this.team2Roster);
  }

  // 팀별 로스터 업데이트
  updateTeamRoster(teamId, container) {
    if (!container) return;

    const teamPlayers = Array.from(this.playersList.values())
      .filter(player => player.team === teamId);

    container.innerHTML = '';

    if (teamPlayers.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-roster';
      emptyDiv.textContent = '플레이어가 없습니다';
      container.appendChild(emptyDiv);
      return;
    }

    teamPlayers.forEach(player => {
      const playerCard = this.createPlayerCard(player);
      container.appendChild(playerCard);
    });
  }

  // 플레이어 카드 생성
  createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.playerId = player.id || player.name;

    // 아바타
    const avatar = document.createElement('img');
    avatar.className = 'player-avatar';
    avatar.src = player.avatar || '/assets/default-avatar.png';
    avatar.alt = player.name;
    avatar.onerror = () => {
      avatar.style.background = 'linear-gradient(135deg, var(--midnight), var(--navy-mist))';
      avatar.style.display = 'block';
    };

    // 정보
    const info = document.createElement('div');
    info.className = 'player-info';

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;

    const stats = document.createElement('div');
    stats.className = 'player-stats';
    stats.innerHTML = `
      공격 ${player.stats?.attack || player.atk || 0} | 
      방어 ${player.stats?.defense || player.def || 0} | 
      민첩 ${player.stats?.agility || player.agi || 0} | 
      행운 ${player.stats?.luck || player.luk || 0}
    `;

    const hp = document.createElement('div');
    hp.className = 'player-hp';
    
    const hpFill = document.createElement('div');
    hpFill.className = 'player-hp-fill';
    const hpPercent = Math.max(0, Math.min(100, (player.hp || 1000) / (player.maxHp || 1000) * 100));
    hpFill.style.width = `${hpPercent}%`;
    
    hp.appendChild(hpFill);

    const items = document.createElement('div');
    items.className = 'player-items';
    if (player.items) {
      const itemText = [];
      if (player.items.dittany > 0) itemText.push(`디터니 ${player.items.dittany}`);
      if (player.items.atkBoost > 0) itemText.push(`공격보정 ${player.items.atkBoost}`);
      if (player.items.defBoost > 0) itemText.push(`방어보정 ${player.items.defBoost}`);
      items.textContent = itemText.join(' | ') || '아이템 없음';
    } else {
      items.textContent = '아이템 정보 없음';
    }

    info.appendChild(name);
    info.appendChild(stats);
    info.appendChild(hp);
    info.appendChild(items);

    // 액션 버튼들
    const actions = document.createElement('div');
    actions.className = 'player-actions';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-sm';
    removeBtn.textContent = '제거';
    removeBtn.onclick = () => this.removePlayer(player.name);

    actions.appendChild(removeBtn);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(actions);

    return card;
  }

  // 플레이어 제거
  removePlayer(playerName) {
    if (!confirm(`플레이어 "${playerName}"을 제거하시겠습니까?`)) {
      return;
    }

    PyxisSocket.emit('admin:removePlayer', {
      battleId: this.currentBattleId,
      playerId: playerName // 또는 실제 ID
    });
  }

  // 플레이어 제거 성공 처리
  handlePlayerRemoved(data) {
    console.log('[Admin] Player removed:', data);
    
    if (data.ok) {
      this.playersList.delete(data.playerId);
      
      UI.success(`플레이어가 제거되었습니다`);
      this.addLogEntry(`플레이어 제거: ${data.playerId}`, 'system');
      
      this.updateRoster();
      this.updateControlButtons();
    } else {
      UI.error(data.message || '플레이어 제거 실패');
    }
  }

  // 아바타 미리보기 처리
  handleAvatarPreview(event) {
    const file = event.target.files[0];
    if (!file) {
      this.avatarPreview.innerHTML = '';
      return;
    }

    if (!file.type.startsWith('image/')) {
      UI.error('이미지 파일만 업로드할 수 있습니다');
      event.target.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) { // 2MB
      UI.error('파일 크기는 2MB를 초과할 수 없습니다');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.avatarPreview.innerHTML = `
        <img src="${e.target.result}" alt="아바타 미리보기" class="avatar-preview-img">
      `;
    };
    reader.readAsDataURL(file);
  }

  // 링크 생성
  async generateLinks() {
    if (!this.currentBattleId) {
      UI.error('먼저 전투를 생성해주세요');
      return;
    }

    if (this.playersList.size === 0) {
      UI.error('먼저 플레이어를 추가해주세요');
      return;
    }

    UI.setLoading(this.btnGenerateLinks, true);

    try {
      const response = await fetch(`/api/admin/battles/${this.currentBattleId}/links`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.ok) {
        this.displayGeneratedLinks(data);
        UI.success('링크가 생성되었습니다');
        this.addLogEntry('플레이어별 링크 생성 완료', 'system');
      } else {
        throw new Error(data.message || '링크 생성 실패');
      }
    } catch (error) {
      console.error('[Admin] Link generation error:', error);
      UI.error(`링크 생성 실패: ${error.message}`);
    } finally {
      UI.setLoading(this.btnGenerateLinks, false);
    }
  }

  // 생성된 링크 표시
  displayGeneratedLinks(data) {
    if (!this.linksList) return;

    this.linksList.innerHTML = '';

    // 플레이어 링크들
    if (data.playerLinks) {
      Object.entries(data.playerLinks).forEach(([playerName, url]) => {
        const linkItem = this.createLinkItem(`${playerName} (플레이어)`, url);
        this.linksList.appendChild(linkItem);
      });
    }

    // 관전자 링크
    if (data.spectatorLink) {
      const linkItem = this.createLinkItem('관전자', data.spectatorLink);
      this.linksList.appendChild(linkItem);
    }

    // 관리자 링크
    if (data.adminLink) {
      const linkItem = this.createLinkItem('관리자', data.adminLink);
      this.linksList.appendChild(linkItem);
    }
  }

  // 링크 아이템 생성
  createLinkItem(label, url) {
    const item = document.createElement('div');
    item.className = 'link-item';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'link-label';
    labelSpan.textContent = label;

    const urlInput = document.createElement('input');
    urlInput.className = 'link-input';
    urlInput.type = 'text';
    urlInput.value = url;
    urlInput.readOnly = true;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-info btn-sm copy-btn';
    copyBtn.textContent = '복사';
    copyBtn.onclick = () => this.copyToClipboard(url, copyBtn);

    item.appendChild(labelSpan);
    item.appendChild(urlInput);
    item.appendChild(copyBtn);

    return item;
  }

  // 클립보드 복사
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
      
      UI.success('링크가 클립보드에 복사되었습니다');
    } catch (error) {
      console.error('[Admin] Copy to clipboard error:', error);
      UI.error('클립보드 복사에 실패했습니다');
    }
  }

  // 채팅 메시지 전송
  sendChatMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;

    if (!this.isAuthenticated) {
      UI.warning('먼저 관리자 인증을 완료해주세요');
      return;
    }

    let channel = this.chatChannel.value;
    let actualMessage = message;

    // /t 명령어 처리
    if (message.startsWith('/t ')) {
      channel = 'team';
      actualMessage = message.substring(3);
    }

    if (!actualMessage.trim()) return;

    PyxisSocket.emit('admin:chat', {
      battleId: this.currentBattleId,
      channel: channel,
      message: actualMessage
    });

    this.chatInput.value = '';
  }

  // 채팅 메시지 처리
  handleChatMessage(messageData) {
    const prefix = messageData.channel === 'team' ? '[팀] ' : '[전체] ';
    const sender = messageData.sender || messageData.from?.name || '익명';
    const content = `${prefix}${sender}: ${messageData.message}`;
    
    this.addLogEntry(content, 'chat');
  }

  // 로그 엔트리 추가
  addLogEntry(text, type = 'system') {
    if (!this.logViewer) return;

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const timestamp = document.createElement('div');
    timestamp.className = 'log-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString('ko-KR');

    const content = document.createElement('div');
    content.className = 'log-content';
    content.textContent = text;

    entry.appendChild(timestamp);
    entry.appendChild(content);

    this.logViewer.appendChild(entry);
    this.logViewer.scrollTop = this.logViewer.scrollHeight;

    // 로그 항목 개수 제한
    const entries = this.logViewer.querySelectorAll('.log-entry');
    if (entries.length > 100) {
      entries[0].remove();
    }
  }

  // 상태 업데이트 처리
  handleStateUpdate(state) {
    if (!state) return;

    this.battleState = state;

    // 플레이어 목록 업데이트
    if (state.players) {
      this.playersList.clear();
      Object.values(state.players).forEach(player => {
        this.playersList.set(player.name, player);
      });
      this.updateRoster();
    }

    this.updateControlButtons();
  }

  // 전투 생성 완료 처리
  handleBattleCreated(data) {
    console.log('[Admin] Battle created:', data);
    this.addLogEntry(`전투 생성 완료: ${data.battleId}`, 'system');
  }

  // 전투 시작 처리
  handleBattleStarted(data) {
    console.log('[Admin] Battle started:', data);
    
    UI.success('전투가 시작되었습니다!');
    this.addLogEntry('전투 시작!', 'system');
    
    UI.setLoading(this.btnStartBattle, false);
    this.updateControlButtons();
  }

  // 전투 종료 처리
  handleBattleEnded(result) {
    console.log('[Admin] Battle ended:', result);
    
    const winnerText = this.getWinnerText(result.winner);
    UI.success(`전투가 종료되었습니다! ${winnerText}`);
    this.addLogEntry(`전투 종료: ${winnerText}`, 'system');
    
    UI.setLoading(this.btnPauseBattle, false);
    UI.setLoading(this.btnEndBattle, false);
    this.updateControlButtons();
  }

  // 승자 텍스트 얻기
  getWinnerText(winner) {
    switch (winner) {
      case 'team1':
      case 'A':
        return '불사조 기사단 승리!';
      case 'team2':
      case 'B':
        return '죽음을 먹는 자들 승리!';
      case 'draw':
        return '무승부';
      default:
        return '결과 미확정';
    }
  }

  // 전투 정보 요청
  requestBattleInfo(battleId) {
    fetch(`/api/admin/battles/${battleId}`)
      .then(response => response.json())
      .then(data => {
        if (data.ok && data.battle) {
          this.currentBattleId = data.battle.id;
          this.adminOtp = data.battle.otp?.admin?.value;
          this.spectatorOtp = data.battle.otp?.spectatorPool ?
            Array.from(data.battle.otp.spectatorPool.keys())[0] : null;
          
          this.updateBattleInfo();
          this.showBattleControls();
          
          // 플레이어 목록 로드
          if (data.battle.players) {
            Object.values(data.battle.players).forEach(player => {
              this.playersList.set(player.name, player);
            });
            this.updateRoster();
          }
        }
      })
      .catch(error => {
        console.error('[Admin] Battle info request error:', error);
        UI.error('전투 정보를 불러올 수 없습니다');
      });
  }

  // 상태 요청
  requestStateUpdate() {
    if (this.currentBattleId && this.isAuthenticated) {
      PyxisSocket.emit('admin:requestState', {
        battleId: this.currentBattleId
      });
    }
  }

  // 정리
  destroy() {
    if (this.currentBattleId && this.isAuthenticated) {
      PyxisSocket.emit('admin:disconnect', {
        battleId: this.currentBattleId
      });
    }
    PyxisSocket.disconnect();
  }
}

// 전역 인스턴스 생성
let adminApp;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  adminApp = new PyxisAdmin();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (adminApp) {
    adminApp.destroy();
  }
});

// 전역 접근을 위한 export
window.PyxisAdmin = PyxisAdmin;
