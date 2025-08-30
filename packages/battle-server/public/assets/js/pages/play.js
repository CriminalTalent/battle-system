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
    if (!this.battleState) return
