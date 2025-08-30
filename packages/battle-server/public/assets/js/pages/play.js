// PYXIS Player Page - 완전히 새로운 플레이어 페이지 로직
class PyxisPlayer {
  constructor() {
    // 상태 관리
    this.currentBattleId = null;
    this.playerToken = null;
    this.playerName = null;
    this.playerId = null;
    this.battleState = null;
    this.myPlayerData = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    
    // UI 상태
    this.currentAction = null;
    this.selectedTarget = null;
    this.chatChannel = 'all';
    
    this.init();
  }

  // 초기화
  init() {
    console.log('[Player] Initializing new player page');
    
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.setupKeyboardShortcuts();
    this.initFromUrl();
    
    // 소켓 연결
    PyxisSocket.init();
  }

  // DOM 요소 설정
  setupElements() {
    // 연결 상태
    this.connectionStatus = UI.$('#connectionStatus');
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    // 인증 폼
    this.authSection = UI.$('#authSection');
    this.authForm = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken = UI.$('#authToken');
    this.authName = UI.$('#authName');

    // 게임플레이 영역
    this.gameplayArea = UI.$('#gameplayArea');
    
    // 플레이어 정보
    this.playerInfo = UI.$('#playerInfo');
    this.myAvatar = UI.$('#myAvatar');
    this.myName = UI.$('#myName');
    this.myTeam = UI.$('#myTeam');
    this.myStats = UI.$('#myStats');
    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');
    this.myHpFill = UI.$('#myHpFill');
    this.myHpText = UI.$('#myHpText');
    this.myItems = UI.$('#myItems');
    
    // 팀 정보
    this.allyPanel = UI.$('#allyPanel');
    this.allyTeamTitle = UI.$('#allyTeamTitle');
    this.teamStatus = UI.$('#teamStatus');
    this.allyMembers = UI.$('#allyMembers');
    
    // 턴 정보
    this.turnInfo = UI.$('#turnInfo');
    this.turnPhase = UI.$('#turnPhase');
    this.turnDescription = UI.$('#turnDescription');
    
    // 액션
    this.actionArea = UI.$('#actionArea');
    this.actionButtons = UI.$('#actionButtons');
    this.btnAttack = UI.$('#btnAttack');
    this.btnDefend = UI.$('#btnDefend');
    this.btnDodge = UI.$('#btnDodge');
    this.btnUseItem = UI.$('#btnUseItem');
    this.btnPass = UI.$('#btnPass');
    
    // 타겟 선택
    this.targetSelector = UI.$('#targetSelector');
    this.targetOptions = UI.$('#targetOptions');
    this.btnConfirmTarget = UI.$('#btnConfirmTarget');
    this.btnCancelTarget = UI.$('#btnCancelTarget');
    
    // 채팅
    this.chatContainer = UI.$('#chatContainer');
    this.chatTabs = UI.$('#chatTabs');
    this.chatMessages = UI.$('#chatMessages');
    this.chatInput = UI.$('#chatInput');
    this.chatSendBtn = UI.$('#chatSendBtn');
    
    // 로그
    this.logViewer = UI.$('#logViewer');
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 인증 폼
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAuthentication();
    });

    // 액션 버튼들
    const actionBtns = this.actionButtons.querySelectorAll('.action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action) {
          this.handleAction(action);
        }
      });
    });

    // 타겟 선택
    this.btnConfirmTarget.addEventListener('click', () => this.confirmTarget());
    this.btnCancelTarget.addEventListener('click', () => this.cancelTargetSelection());

    // 채팅 탭
    this.chatTabs.addEventListener('click', (e) => {
      if (e.target.classList.contains('chat-tab')) {
        this.switchChatChannel(e.target.dataset.channel);
      }
    });

    // 채팅 전송
    this.chatSendBtn.addEventListener('click', () => this.sendChatMessage());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendChatMessage();
      }
    });
  }

  // 소켓 이벤트 설정
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.updateConnectionStatus('connected', '연결됨');
      UI.success('서버에 연결되었습니다');
    });

    PyxisSocket.on('connection:disconnect', () => {
      this.updateConnectionStatus('disconnected', '연결 끊어짐');
      if (this.isAuthenticated) {
        UI.warning('서버 연결이 끊어졌습니다. 재연결 시도 중...');
      }
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      this.updateConnectionStatus('disconnected', '연결 실패');
      if (this.isAuthenticated) {
        UI.error(`연결 오류: ${error.message || '알 수 없는 오류'}`);
      }
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.updateConnectionStatus('connected', '재연결됨');
      UI.success(`서버에 재연결되었습니다 (시도 ${attemptNumber}회)`);
      
      if (this.isAuthenticated) {
        this.requestStateUpdate();
      }
    });

    PyxisSocket.on('connection:attempting', ({ attemptNumber }) => {
      this.updateConnectionStatus('connecting', `재연결 중... (${attemptNumber}회)`);
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => {
      this.handleAuthSuccess(data);
    });

    PyxisSocket.on('authError', (message) => {
      UI.error(`인증 실패: ${message || '알 수 없는 오류'}`);
      UI.setLoading(this.authForm.querySelector('button[type="submit"]'), false);
    });

    // 게임 상태
    PyxisSocket.on('state:update', (state) => {
      this.handleStateUpdate(state);
    });

    PyxisSocket.on('state', (state) => {
      this.handleStateUpdate(state);
    });

    // 턴 관리
    PyxisSocket.on('turn:start', (data) => {
      this.handleTurnStart(data);
    });

    PyxisSocket.on('turn:end', (data) => {
      this.handleTurnEnd(data);
    });

    PyxisSocket.on('phase:change', (phase) => {
      this.handlePhaseChange(phase);
    });

    // 액션 결과
    PyxisSocket.on('action:success', (data) => {
      this.handleActionSuccess(data);
    });

    PyxisSocket.on('action:error', (message) => {
      UI.error(`액션 실패: ${message}`);
      this.resetActionState();
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

    // 전투 종료
    PyxisSocket.on('battle:end', (result) => {
      this.handleBattleEnd(result);
    });

    // 에러 처리
    PyxisSocket.on('error', (error) => {
      console.error('[Player] Socket error:', error);
      UI.error(`오류: ${error.message || '알 수 없는 오류'}`);
    });
  }

  // 키보드 단축키 설정
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // 입력 필드에 포커스가 있으면 단축키 비활성화
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key;
      
      // 액션 단축키 (1-5)
      if (key >= '1' && key <= '5' && this.isMyTurn()) {
        e.preventDefault();
        const actions = ['attack', 'defend', 'dodge', 'item', 'pass'];
        const actionIndex = parseInt(key) - 1;
        if (actions[actionIndex]) {
          this.handleAction(actions[actionIndex]);
        }
      }
      
      // 채팅 포커스 (Enter)
      if (key === 'Enter') {
        e.preventDefault();
        this.chatInput.focus();
      }
    });
  }

  // URL에서 초기값 설정
  initFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // URL 파라미터에서 값 설정
    const battleId = urlParams.get('battle');
    const token = urlParams.get('token');
    const name = urlParams.get('name');
    
    if (battleId) {
      this.authBattleId.value = battleId;
      this.currentBattleId = battleId;
    }
    
    if (token) {
      this.authToken.value = token;
      this.playerToken = token;
    }
    
    if (name) {
      this.authName.value = name;
      this.playerName = name;
    }
    
    // 모든 정보가 있으면 자동 로그인 시도
    if (battleId && token && name) {
      console.log('[Player] Auto-authenticating from URL parameters');
      setTimeout(() => {
        this.handleAuthentication();
      }, 1000);
    } else {
      // 인증 폼 표시
      this.authSection.style.display = 'block';
    }
  }

  // 연결 상태 업데이트
  updateConnectionStatus(status, text) {
    this.isConnected = status === 'connected';
    
    if (this.connectionStatus) {
      this.connectionStatus.className = `connection-status ${status}`;
    }
    if (this.connectionText) {
      this.connectionText.textContent = text;
    }
  }

  // 인증 처리
  handleAuthentication() {
    const battleId = this.authBattleId.value.trim();
    const token = this.authToken.value.trim();
    const name = this.authName.value.trim();

    if (!battleId || !token || !name) {
      UI.error('모든 필드를 입력해주세요');
      return;
    }

    this.currentBattleId = battleId;
    this.playerToken = token;
    this.playerName = name;

    const submitBtn = this.authForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true);

    // 소켓으로 인증 요청
    PyxisSocket.emit('playerAuth', {
      battleId: battleId,
      otp: token,
      playerId: null // 서버에서 결정
    });
  }

  // 인증 성공 처리
  handleAuthSuccess(data) {
    console.log('[Player] Authentication successful:', data);
    
    this.isAuthenticated = true;
    this.playerId = data.player?.id;
    this.myPlayerData = data.player;
    
    if (data.battle) {
      this.battleState = data.battle;
    }

    UI.success('전투에 성공적으로 참가했습니다!');
    
    // UI 전환
    this.showGameplayArea();
    this.updatePlayerInfo();
    this.updateGameState();
  }

  // 게임플레이 영역 표시
  showGameplayArea() {
    if (this.authSection) {
      this.authSection.style.display = 'none';
    }
    if (this.gameplayArea) {
      this.gameplayArea.style.display = 'block';
      this.gameplayArea.classList.add('fade-in');
    }
  }

  // 플레이어 정보 업데이트
  updatePlayerInfo() {
    if (!this.myPlayerData) return;

    const player = this.myPlayerData;
    
    // 기본 정보
    if (this.myName) this.myName.textContent = player.name || '알 수 없음';
    if (this.myTeam) {
      const teamName = player.team === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.myTeam.textContent = teamName;
    }
    
    // 아바타
    if (this.myAvatar && player.avatar) {
      this.myAvatar.src = player.avatar;
    }
    
    // 스탯
    if (this.statAttack) this.statAttack.textContent = player.atk || 0;
    if (this.statDefense) this.statDefense.textContent = player.def || 0;
    if (this.statAgility) this.statAgility.textContent = player.agi || 0;
    if (this.statLuck) this.statLuck.textContent = player.luk || 0;
    
    // HP
    this.updateHpDisplay(player.hp, player.maxHp);
    
    // 아이템
    this.updateItemsDisplay(player.items);
  }

  // HP 표시 업데이트
  updateHpDisplay(hp, maxHp) {
    const currentHp = Math.max(0, hp || 0);
    const maximumHp = maxHp || 1000;
    const percentage = (currentHp / maximumHp) * 100;
    
    if (this.myHpFill) {
      this.myHpFill.style.width = `${percentage}%`;
    }
    
    if (this.myHpText) {
      this.myHpText.textContent = `${currentHp} / ${maximumHp}`;
    }
  }

  // 아이템 표시 업데이트
  updateItemsDisplay(items) {
    if (!items) return;
    
    const itemDittany = UI.$('#itemDittany .item-count');
    const itemAttackBoost = UI.$('#itemAttackBoost .item-count');
    const itemDefenseBoost = UI.$('#itemDefenseBoost .item-count');
    
    if (itemDittany) itemDittany.textContent = items.dittany || 0;
    if (itemAttackBoost) itemAttackBoost.textContent = items.atkBoost || 0;
    if (itemDefenseBoost) itemDefenseBoost.textContent = items.defBoost || 0;
    
    // 아이템이 있으면 슬롯 활성화
    const slots = ['itemDittany', 'itemAttackBoost', 'itemDefenseBoost'];
    const counts = [items.dittany, items.atkBoost, items.defBoost];
    
    slots.forEach((slotId, index) => {
      const slot = UI.$(`#${slotId}`);
      if (slot) {
        if (counts[index] > 0) {
          slot.classList.add('has-item');
        } else {
          slot.classList.remove('has-item');
        }
      }
    });
  }

  // 게임 상태 업데이트
  handleStateUpdate(state) {
    if (!state) return;
    
    this.battleState = state;
    
    // 내 플레이어 정보 업데이트
    if (state.players && this.playerId && state.players[this.playerId]) {
      this.myPlayerData = state.players[this.playerId];
      this.updatePlayerInfo();
    }
    
    // 게임 상태 업데이트
    this.updateGameState();
    this.updateTeamDisplay();
    this.updateTurnInfo();
    this.updateActionButtons();
  }

  // 게임 상태 업데이트
  updateGameState() {
    if (!this.battleState) return;
    
    // 팀 상태 업데이트
    if (this.teamStatus) {
      const statusDot = this.teamStatus.querySelector('.status-dot');
      const statusText = this.teamStatus.querySelector('span');
      
      switch (this.battleState.status) {
        case 'waiting':
          this.teamStatus.className = 'status-indicator waiting';
          if (statusText) statusText.textContent = '대기중';
          break;
        case 'ongoing':
          this.teamStatus.className = 'status-indicator ongoing';
          if (statusText) statusText.textContent = '전투중';
          break;
        case 'ended':
          this.teamStatus.className = 'status-indicator ended';
          if (statusText) statusText.textContent = '종료됨';
          break;
      }
    }
  }

  // 팀 표시 업데이트
  updateTeamDisplay() {
    if (!this.battleState || !this.myPlayerData) return;
    
    const myTeam = this.myPlayerData.team;
    const teamPlayers = Object.values(this.battleState.players || {})
      .filter(p => p.team === myTeam);
    
    // 팀 제목 설정
    const teamName = myTeam === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
    if (this.allyTeamTitle) {
      this.allyTeamTitle.textContent = teamName;
    }
    
    // 팀원 표시
    this.displayTeamMembers(teamPlayers);
  }

  // 팀원 표시
  displayTeamMembers(players) {
    if (!this.allyMembers) return;
    
    this.allyMembers.innerHTML = '';
    
    if (!players || players.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'loading';
      emptyDiv.textContent = '팀원이 없습니다';
      this.allyMembers.appendChild(emptyDiv);
      return;
    }
    
    players.forEach(player => {
      const memberCard = this.createMemberCard(player);
      this.allyMembers.appendChild(memberCard);
    });
  }

  // 팀원 카드 생성
  createMemberCard(player) {
    const card = document.createElement('div');
    card.className = 'unit-card';
    
    // 현재 턴 플레이어 하이라이트
    if (this.isPlayerTurn(player.id)) {
      card.classList.add('current-turn');
    }
    
    // 사망한 플레이어
    if (!player.alive || player.hp <= 0) {
      card.classList.add('defeated');
    }
    
    // 아바타
    const avatar = document.createElement('img');
    avatar.className = 'unit-avatar';
    avatar.src = player.avatar || '/assets/default-avatar.png';
    avatar.alt = player.name;
    
    // 정보
    const info = document.createElement('div');
    info.className = 'unit-info';
    
    const name = document.createElement('div');
    name.className = 'unit-name';
    name.textContent = player.name;
    
    const hpBar = document.createElement('div');
    hpBar.className = 'unit-hp';
    
    const hpFill = document.createElement('div');
    hpFill.className = 'unit-hp-fill';
    const hpPercent = Math.max(0, Math.min(100, (player.hp || 0) / (player.maxHp || 1000) * 100));
    hpFill.style.width = `${hpPercent}%`;
    
    hpBar.appendChild(hpFill);
    
    const stats = document.createElement('div');
    stats.className = 'unit-stats';
    stats.innerHTML = `공격 ${player.atk || 0} | 방어 ${player.def || 0}`;
    
    info.appendChild(name);
    info.appendChild(hpBar);
    info.appendChild(stats);
    
    card.appendChild(avatar);
    card.appendChild(info);
    
    return card;
  }

  // 턴 정보 업데이트
  updateTurnInfo() {
    if (!this.battleState) return;
    
    const isMyTurn = this.isMyTurn();
    const currentPhase = this.battleState.phase;
    const round = this.battleState.round || 1;
    
    let phaseText = '대기 중';
    let descriptionText = '전투가 시작되기를 기다리는 중입니다';
    
    switch (this.battleState.status) {
      case 'waiting':
        phaseText = '전투 대기';
        descriptionText = '다른 플레이어들이 입장하기를 기다리는 중입니다';
        break;
        
      case 'ongoing':
        const currentTeam = currentPhase === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
        phaseText = `라운드 ${round}`;
        
        if (isMyTurn) {
          descriptionText = '당신의 턴입니다! 액션을 선택하세요';
        } else {
          descriptionText = `${currentTeam}의 턴입니다. 기다려주세요`;
        }
        break;
        
      case 'ended':
        phaseText = '전투 종료';
        descriptionText = '전투가 완료되었습니다';
        break;
    }
    
    if (this.turnPhase) this.turnPhase.textContent = phaseText;
    if (this.turnDescription) this.turnDescription.textContent = descriptionText;
  }

  // 액션 버튼 상태 업데이트
  updateActionButtons() {
    const isMyTurn = this.isMyTurn();
    const canAct = isMyTurn && this.battleState?.status === 'ongoing';
    
    const actionBtns = this.actionButtons.querySelectorAll('.action-btn');
    actionBtns.forEach(btn => {
      btn.disabled = !canAct;
      
      if (canAct) {
        btn.classList.remove('disabled');
      } else {
        btn.classList.add('disabled');
      }
    });
    
    // 아이템 버튼은 아이템이 있을 때만 활성화
    if (this.btnUseItem && this.myPlayerData?.items) {
      const hasItems = (this.myPlayerData.items.dittany || 0) > 0 ||
                      (this.myPlayerData.items.atkBoost || 0) > 0 ||
                      (this.myPlayerData.items.defBoost || 0) > 0;
      
      if (!hasItems) {
        this.btnUseItem.disabled = true;
        this.btnUseItem.classList.add('disabled');
      }
    }
  }

  // 내 턴인지 확인
  isMyTurn() {
    if (!this.battleState || !this.playerId) return false;
    
    // 현재 액터가 나인지 확인
    return this.battleState.turn?.actor === this.playerId ||
           this.isPlayerTurn(this.playerId);
  }

  // 특정 플레이어의 턴인지 확인
  isPlayerTurn(playerId) {
    if (!this.battleState) return false;
    
    return this.battleState.turn?.actor === playerId;
  }

  // 액션 처리
  handleAction(action) {
    if (!this.isMyTurn()) {
      UI.warning('당신의 턴이 아닙니다');
      return;
    }
    
    if (this.currentAction) {
      UI.warning('이미 액션을 처리 중입니다');
      return;
    }
    
    this.currentAction = action;
    
    console.log('[Player] Action selected:', action);
    
    // 타겟이 필요한 액션인지 확인
    if (this.requiresTarget(action)) {
      this.showTargetSelection(action);
    } else {
      this.executeAction(action, null);
    }
  }

  // 타겟이 필요한 액션인지 확인
  requiresTarget(action) {
    return action === 'attack';
  }

  // 타겟 선택 표시
  showTargetSelection(action) {
    if (!this.battleState) return;
    
    this.targetSelector.style.display = 'block';
    this.targetOptions.innerHTML = '';
    
    const availableTargets = this.getAvailableTargets(action);
    
    availableTargets.forEach(target => {
      const option = this.createTargetOption(target);
      this.targetOptions.appendChild(option);
    });
  }

  // 사용 가능한 타겟 목록 얻기
  getAvailableTargets(action) {
    if (!this.battleState || !this.myPlayerData) return [];
    
    const allPlayers = Object.values(this.battleState.players || {});
    const myTeam = this.myPlayerData.team;
    
    if (action === 'attack') {
      // 공격: 적팀 생존자만
      return allPlayers.filter(p => 
        p.team !== myTeam && 
        p.alive && 
        (p.hp > 0)
      );
    }
    
    return [];
  }

  // 타겟 옵션 생성
  createTargetOption(target) {
    const option = document.createElement('div');
    option.className = 'target-option';
    option.dataset.targetId = target.id;
    
    option.addEventListener('click', () => {
      // 이전 선택 해제
      this.targetOptions.querySelectorAll('.target-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      
      // 현재 선택
      option.classList.add('selected');
      this.selectedTarget = target.id;
    });
    
    const avatar = document.createElement('img');
    avatar.className = 'target-avatar';
    avatar.src = target.avatar || '/assets/default-avatar.png';
    avatar.alt = target.name;
    
    const info = document.createElement('div');
    info.className = 'target-info';
    
    const name = document.createElement('div');
    name.className = 'target-name';
    name.textContent = target.name;
    
    const hp = document.createElement('div');
    hp.className = 'target-hp';
    hp.textContent = `HP: ${target.hp}/${target.maxHp}`;
    
    info.appendChild(name);
    info.appendChild(hp);
    
    option.appendChild(avatar);
    option.appendChild(info);
    
    return option;
  }

  // 타겟 확인
  confirmTarget() {
    if (!this.selectedTarget) {
      UI.warning('타겟을 선택해주세요');
      return;
    }
    
    this.executeAction(this.currentAction, this.selectedTarget);
    this.hideTargetSelection();
  }

  // 타겟 선택 취소
  cancelTargetSelection() {
    this.hideTargetSelection();
    this.resetActionState();
  }

  // 타겟 선택 숨기기
  hideTargetSelection() {
    this.targetSelector.style.display = 'none';
    this.selectedTarget = null;
  }

  // 액션 실행
  executeAction(action, targetId) {
    if (!this.currentBattleId || !this.playerId) {
      UI.error('게임 상태가 올바르지 않습니다');
      return;
    }
    
    console.log('[Player] Executing action:', action, 'target:', targetId);
    
    // 버튼 로딩 상태
    const actionBtn = this.actionButtons.querySelector(`[data-action="${action}"]`);
    if (actionBtn) {
      UI.setLoading(actionBtn, true);
    }
    
    // 소켓으로 액션 전송
    const actionData = {
      battleId: this.currentBattleId,
      playerId: this.playerId,
      action: action
    };
    
    if (targetId) {
      actionData.targetId = targetId;
    }
    
    PyxisSocket.emit('player:action', actionData);
  }

  // 액션 성공 처리
  handleActionSuccess(data) {
    console.log('[Player] Action success:', data);
    
    UI.success(`액션이 성공적으로 실행되었습니다!`);
    this.resetActionState();
    
    // 상태 요청
    this.requestStateUpdate();
  }

  // 액션 상태 초기화
  resetActionState() {
    this.currentAction = null;
    this.selectedTarget = null;
    
    // 로딩 상태 제거
    const actionBtns = this.actionButtons.querySelectorAll('.action-btn');
    actionBtns.forEach(btn => {
      UI.setLoading(btn, false);
    });
  }

  // 턴 시작 처리
  handleTurnStart(data) {
    console.log('[Player] Turn start:', data);
    
    if (data.playerId === this.playerId) {
      UI.info('당신의 턴입니다!');
    }
    
    this.updateTurnInfo();
    this.updateActionButtons();
  }

  // 턴 종료 처리
  handleTurnEnd(data) {
    console.log('[Player] Turn end:', data);
    
    this.resetActionState();
    this.updateTurnInfo();
    this.updateActionButtons();
  }

  // 페이즈 변경 처리
  handlePhaseChange(phase) {
    const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? 
      '불사조 기사단' : '죽음을 먹는 자들';
    
    this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
    
    if (this.battleState) {
      this.battleState.phase = phase.phase;
      this.battleState.round = phase.round;
    }
    
    this.updateTurnInfo();
    this.updateActionButtons();
  }

  // 채팅 채널 전환
  switchChatChannel(channel) {
    this.chatChannel = channel;
    
    // 탭 활성화
    this.chatTabs.querySelectorAll('.chat-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    const activeTab = this.chatTabs.querySelector(`[data-channel="${channel}"]`);
    if (activeTab) {
      activeTab.classList.add('active');
    }
    
    // 플레이스홀더 변경
    if (this.chatInput) {
      this.chatInput.placeholder = channel === 'team' ? 
        '팀 채팅 입력...' : '전체 채팅 입력... (/t 팀 채팅)';
    }
  }

  // 채팅 메시지 전송
  sendChatMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;
    
    let channel = this.chatChannel;
    let actualMessage = message;
    
    // /t 명령어 처리
    if (message.startsWith('/t ')) {
      channel = 'team';
      actualMessage = message.substring(3);
    }
    
    if (!actualMessage.trim()) return;
    
    // 소켓으로 전송
    PyxisSocket.emit('chat:send', {
      battleId: this.currentBattleId,
      playerId: this.playerId,
      channel: channel,
      message: actualMessage
    });
    
    // 입력창 클리어
    this.chatInput.value = '';
  }

  // 채팅 메시지 처리
  handleChatMessage(messageData) {
    if (!this.chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${messageData.channel || 'all'}`;
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const sender = document.createElement('span');
    sender.className = 'message-sender';
    sender.textContent = messageData.sender || '알 수 없음';
    
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date(messageData.timestamp || Date.now()).toLocaleTimeString('ko-KR');
    
    header.appendChild(sender);
    header.appendChild(time);
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = messageData.message;
    
    messageDiv.appendChild(header);
    messageDiv.appendChild(content);
    
    this.chatMessages.appendChild(messageDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    
    // 메시지 개수 제한
    const messages = this.chatMessages.querySelectorAll('.chat-message');
    if (messages.length > 50) {
      messages[0].remove();
    }
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

  // 전투 종료 처리
  handleBattleEnd(result) {
    const winnerText = this.getWinnerText(result.winner);
    
    this.addLogEntry(`🏆 전투 종료: ${winnerText}`, 'system');
    UI.success(`전투가 종료되었습니다! ${winnerText}`);
    
    // 모든 액션 버튼 비활성화
    const actionBtns = this.actionButtons.querySelectorAll('.action-btn');
    actionBtns.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
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

  // 상태 요청
  requestStateUpdate() {
    if (this.currentBattleId) {
      PyxisSocket.emit('player:requestState', {
        battleId: this.currentBattleId,
        playerId: this.playerId
      });
    }
  }

  // 정리
  destroy() {
    if (this.currentBattleId && this.playerId) {
      PyxisSocket.emit('player:leave', {
        battleId: this.currentBattleId,
        playerId: this.playerId
      });
    }
    PyxisSocket.disconnect();
  }
}

// 전역 인스턴스 생성
let playerApp;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  playerApp = new PyxisPlayer();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (playerApp) {
    playerApp.destroy();
  }
});

// 전역 접근을 위한 export
window.PyxisPlayer = PyxisPlayer;
