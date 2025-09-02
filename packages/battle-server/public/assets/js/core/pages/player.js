// packages/battle-server/public/assets/js/core/pages/player.js
// PYXIS 플레이어 인터페이스 - 몰입감 있는 실시간 전투 시스템

class PyxisPlayerInterface {
  constructor() {
    // 상태 관리
    this.state = {
      // 인증 정보
      battleId: null,
      playerId: null,
      playerName: null,
      playerOtp: null,
      team: null,
      role: 'player',
      isAuthenticated: false,
      
      // 전투 상태
      battleStatus: 'waiting', // waiting, active, paused, ended
      currentTurn: 1,
      currentTeam: null,
      currentPhase: 'waiting',
      isMyTurn: false,
      canAct: false,
      turnTimeLimit: 5 * 60 * 1000, // 5분
      turnStartTime: null,
      
      // 플레이어 데이터
      myPlayer: null,
      allPlayers: [],
      teammates: [],
      enemies: [],
      
      // UI 상태
      selectedAction: null,
      targetSelectionMode: false,
      availableTargets: [],
      actionInProgress: false
    };

    // DOM 캐시
    this.elements = {};
    
    // 타이머
    this.turnTimer = null;
    this.battleTimer = null;
    
    // Socket 연결
    this.socket = null;
    
    // 초기화
    this.init();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 초기화
  // ═══════════════════════════════════════════════════════════════════════
  
  async init() {
    this.cacheElements();
    this.bindEvents();
    this.setupKeyboardShortcuts();
    await this.initFromUrl();
    await this.connectSocket();
  }

  cacheElements() {
    // 인증 관련
    this.elements.authSection = document.querySelector('#authSection');
    this.elements.battleSection = document.querySelector('#battleSection');
    this.elements.authForm = document.querySelector('#authForm');
    this.elements.battleIdInput = document.querySelector('#battleId');
    this.elements.playerNameInput = document.querySelector('#playerName');
    this.elements.playerOtpInput = document.querySelector('#playerOtp');
    this.elements.authMessage = document.querySelector('#authMessage');

    // 플레이어 정보
    this.elements.myPlayerCard = document.querySelector('#myPlayerCard');
    this.elements.myAvatar = document.querySelector('#myAvatar');
    this.elements.myName = document.querySelector('#myName');
    this.elements.myTeam = document.querySelector('#myTeam');
    this.elements.myHp = document.querySelector('#myHp');
    this.elements.myHpBar = document.querySelector('#myHpBar');
    this.elements.myStats = document.querySelector('#myStats');

    // 팀 정보
    this.elements.teammatesList = document.querySelector('#teammatesList');
    
    // 전투 정보
    this.elements.battleInfo = document.querySelector('#battleInfo');
    this.elements.turnIndicator = document.querySelector('#turnIndicator');
    this.elements.turnTimer = document.querySelector('#turnTimer');
    this.elements.battleTimer = document.querySelector('#battleTimer');
    this.elements.currentPhase = document.querySelector('#currentPhase');

    // 액션 패널
    this.elements.actionPanel = document.querySelector('#actionPanel');
    this.elements.actionButtons = document.querySelectorAll('.action-btn');
    this.elements.attackBtn = document.querySelector('#attackBtn');
    this.elements.defendBtn = document.querySelector('#defendBtn');
    this.elements.dodgeBtn = document.querySelector('#dodgeBtn');
    this.elements.itemBtn = document.querySelector('#itemBtn');
    this.elements.passBtn = document.querySelector('#passBtn');

    // 타겟 선택
    this.elements.targetModal = document.querySelector('#targetModal');
    this.elements.targetList = document.querySelector('#targetList');
    this.elements.targetConfirm = document.querySelector('#targetConfirm');
    this.elements.targetCancel = document.querySelector('#targetCancel');

    // 아이템
    this.elements.itemModal = document.querySelector('#itemModal');
    this.elements.itemList = document.querySelector('#itemList');
    this.elements.dittanyBtn = document.querySelector('#dittanyBtn');
    this.elements.attackBoostBtn = document.querySelector('#attackBoostBtn');
    this.elements.defenseBoostBtn = document.querySelector('#defenseBoostBtn');

    // 로그 & 채팅
    this.elements.battleLog = document.querySelector('#battleLog');
    this.elements.chatMessages = document.querySelector('#chatMessages');
    this.elements.chatInput = document.querySelector('#chatInput');
    this.elements.chatSend = document.querySelector('#chatSend');
    this.elements.channelBtns = document.querySelectorAll('.channel-btn');
  }

  bindEvents() {
    // 인증
    if (this.elements.authForm) {
      this.elements.authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAuth();
      });
    }

    // 액션 버튼들
    if (this.elements.attackBtn) {
      this.elements.attackBtn.addEventListener('click', () => this.selectAction('attack'));
    }
    if (this.elements.defendBtn) {
      this.elements.defendBtn.addEventListener('click', () => this.selectAction('defend'));
    }
    if (this.elements.dodgeBtn) {
      this.elements.dodgeBtn.addEventListener('click', () => this.selectAction('dodge'));
    }
    if (this.elements.itemBtn) {
      this.elements.itemBtn.addEventListener('click', () => this.showItemSelection());
    }
    if (this.elements.passBtn) {
      this.elements.passBtn.addEventListener('click', () => this.selectAction('pass'));
    }

    // 타겟 선택
    if (this.elements.targetConfirm) {
      this.elements.targetConfirm.addEventListener('click', () => this.confirmAction());
    }
    if (this.elements.targetCancel) {
      this.elements.targetCancel.addEventListener('click', () => this.cancelTargetSelection());
    }

    // 채팅
    if (this.elements.chatSend) {
      this.elements.chatSend.addEventListener('click', () => this.sendChatMessage());
    }
    if (this.elements.chatInput) {
      this.elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage();
        }
      });
    }

    // 채널 버튼들
    this.elements.channelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.channelBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 모달 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (e.target === this.elements.targetModal) {
        this.cancelTargetSelection();
      }
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // 채팅 입력 중이면 무시
      if (document.activeElement === this.elements.chatInput) return;
      
      // 모달 열려있으면 무시
      if (this.state.targetSelectionMode) return;

      switch (e.key) {
        case '1':
          e.preventDefault();
          this.selectAction('attack');
          break;
        case '2':
          e.preventDefault();
          this.selectAction('defend');
          break;
        case '3':
          e.preventDefault();
          this.selectAction('dodge');
          break;
        case '4':
          e.preventDefault();
          this.showItemSelection();
          break;
        case '5':
          e.preventDefault();
          this.selectAction('pass');
          break;
        case 'Escape':
          e.preventDefault();
          this.cancelTargetSelection();
          break;
      }
    });
  }

  async initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    
    this.state.battleId = params.get('battleId');
    this.state.playerName = params.get('name');
    this.state.playerOtp = params.get('otp');

    if (this.state.battleId && this.state.playerName && this.state.playerOtp) {
      // URL에서 자동 인증
      await this.authenticatePlayer();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Socket 연결 및 이벤트
  // ═══════════════════════════════════════════════════════════════════════
  
  async connectSocket() {
    if (typeof io === 'undefined') {
      console.error('[Player] Socket.IO not loaded');
      return;
    }

    this.socket = io();

    this.socket.on('connect', () => {
      console.log('[Player] Socket connected');
      if (this.state.isAuthenticated) {
        this.initSession();
      }
    });

    this.socket.on('disconnect', () => {
      console.log('[Player] Socket disconnected');
      this.showMessage('연결이 끊어졌습니다. 재연결 중...', 'error');
    });

    // 인증 관련
    this.socket.on('auth:success', (data) => {
      this.handleAuthSuccess(data);
    });

    this.socket.on('auth:error', (data) => {
      this.showMessage(data.message || '인증 실패', 'error');
    });

    // 게임 상태
    this.socket.on('state:update', (state) => {
      this.updateGameState(state);
    });

    this.socket.on('log:bootstrap', (logs) => {
      this.loadInitialLogs(logs);
    });

    this.socket.on('log:new', (log) => {
      this.addLogEntry(log);
    });

    // 전투 이벤트
    this.socket.on('battle:started', (data) => {
      this.handleBattleStart(data);
    });

    this.socket.on('battle:ended', (data) => {
      this.handleBattleEnd(data);
    });

    this.socket.on('turn:started', (data) => {
      this.handleTurnStart(data);
    });

    this.socket.on('turn:ended', (data) => {
      this.handleTurnEnd(data);
    });

    // 플레이어 액션
    this.socket.on('player:action_result', (result) => {
      this.handleActionResult(result);
    });

    this.socket.on('player:targets', (data) => {
      this.handleTargetsReceived(data);
    });

    this.socket.on('player:error', (data) => {
      this.showMessage(data.message || '액션 실패', 'error');
      this.state.actionInProgress = false;
      this.updateActionButtons();
    });

    // 채팅
    this.socket.on('chat:message', (message) => {
      this.addChatMessage(message);
    });

    this.socket.on('spectator:cheer', (cheer) => {
      this.addCheerMessage(cheer);
    });

    // 연결 상태
    this.socket.on('player:disconnected', (data) => {
      this.handlePlayerDisconnected(data);
    });
  }

  initSession() {
    this.socket.emit('session:init', {
      role: 'player',
      battleId: this.state.battleId,
      otp: this.state.playerOtp,
      playerName: this.state.playerName
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 인증 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  async handleAuth() {
    const battleId = this.elements.battleIdInput?.value?.trim();
    const playerName = this.elements.playerNameInput?.value?.trim();
    const playerOtp = this.elements.playerOtpInput?.value?.trim();

    if (!battleId || !playerName || !playerOtp) {
      this.showMessage('모든 필드를 입력해주세요', 'error');
      return;
    }

    this.state.battleId = battleId;
    this.state.playerName = playerName;
    this.state.playerOtp = playerOtp;

    await this.authenticatePlayer();
  }

  async authenticatePlayer() {
    if (!this.socket) {
      this.showMessage('소켓 연결 중...', 'info');
      return;
    }

    this.showMessage('인증 중...', 'info');

    this.socket.emit('auth:login', {
      role: 'player',
      battleId: this.state.battleId,
      otp: this.state.playerOtp,
      playerName: this.state.playerName
    });
  }

  handleAuthSuccess(data) {
    console.log('[Player] Auth success:', data);
    
    this.state.isAuthenticated = true;
    this.state.playerId = data.playerId;
    this.state.team = data.team;
    
    this.showMessage('인증 성공!', 'success');
    
    // UI 전환
    if (this.elements.authSection) {
      this.elements.authSection.style.display = 'none';
    }
    if (this.elements.battleSection) {
      this.elements.battleSection.style.display = 'block';
    }

    // 초기 상태 요청
    this.initSession();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 게임 상태 업데이트
  // ═══════════════════════════════════════════════════════════════════════
  
  updateGameState(gameState) {
    console.log('[Player] State update:', gameState);

    // 기본 상태 업데이트
    this.state.battleStatus = gameState.status;
    this.state.currentTurn = gameState.currentTurn;
    this.state.currentTeam = gameState.currentTeam;
    this.state.currentPhase = gameState.currentPhase;
    this.state.turnStartTime = gameState.turnStartTime;

    // 플레이어 데이터 업데이트
    this.updatePlayers(gameState.teams);
    
    // 내 턴 여부 확인
    const isMyTeamTurn = this.state.currentTeam === this.state.team;
    const myPlayer = this.state.myPlayer;
    const canAct = isMyTeamTurn && myPlayer && myPlayer.status.isAlive && !myPlayer.status.actionThisTurn;
    
    this.state.isMyTurn = isMyTeamTurn;
    this.state.canAct = canAct;

    // UI 업데이트
    this.updateBattleInfo();
    this.updatePlayerInfo();
    this.updateTeammates();
    this.updateActionButtons();
    this.updateTurnTimer();
  }

  updatePlayers(teams) {
    this.state.allPlayers = [...teams.A.players, ...teams.B.players];
    
    // 내 플레이어 찾기
    this.state.myPlayer = this.state.allPlayers.find(p => p.id === this.state.playerId);
    
    if (this.state.myPlayer) {
      // 팀원과 적 구분
      this.state.teammates = this.state.allPlayers.filter(p => 
        p.team === this.state.team && p.id !== this.state.playerId
      );
      this.state.enemies = this.state.allPlayers.filter(p => 
        p.team !== this.state.team
      );
    }
  }

  updateBattleInfo() {
    // 턴 표시
    if (this.elements.turnIndicator) {
      const teamName = this.state.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.elements.turnIndicator.textContent = `턴 ${this.state.currentTurn}: ${teamName}`;
      
      if (this.state.isMyTurn) {
        this.elements.turnIndicator.classList.add('my-turn');
      } else {
        this.elements.turnIndicator.classList.remove('my-turn');
      }
    }

    // 페이즈 표시
    if (this.elements.currentPhase) {
      let phaseText = '';
      switch (this.state.currentPhase) {
        case 'team_action':
          phaseText = this.state.isMyTurn ? '액션 선택' : '상대방 턴';
          break;
        case 'resolution':
          phaseText = '액션 처리 중';
          break;
        case 'end_turn':
          phaseText = '턴 종료';
          break;
        default:
          phaseText = this.state.battleStatus;
      }
      this.elements.currentPhase.textContent = phaseText;
    }
  }

  updatePlayerInfo() {
    const player = this.state.myPlayer;
    if (!player) return;

    // 이름과 팀
    if (this.elements.myName) {
      this.elements.myName.textContent = player.name;
    }
    if (this.elements.myTeam) {
      const teamName = player.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.elements.myTeam.textContent = teamName;
    }

    // HP
    if (this.elements.myHp) {
      this.elements.myHp.textContent = `${player.status.hp}/${player.status.maxHp}`;
    }
    if (this.elements.myHpBar) {
      const hpPercent = (player.status.hp / player.status.maxHp) * 100;
      this.elements.myHpBar.style.width = `${hpPercent}%`;
      
      // HP에 따른 색상 변경
      if (hpPercent <= 25) {
        this.elements.myHpBar.classList.add('critical');
      } else {
        this.elements.myHpBar.classList.remove('critical');
      }
    }

    // 스탯
    if (this.elements.myStats) {
      this.elements.myStats.innerHTML = `
        <div class="stat-item">
          <span class="stat-label">공격</span>
          <span class="stat-value">${player.stats.attack}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">방어</span>
          <span class="stat-value">${player.stats.defense}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">민첩</span>
          <span class="stat-value">${player.stats.agility}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">행운</span>
          <span class="stat-value">${player.stats.luck}</span>
        </div>
      `;
    }

    // 아바타
    if (this.elements.myAvatar && player.avatar) {
      this.elements.myAvatar.src = player.avatar;
    }
  }

  updateTeammates() {
    if (!this.elements.teammatesList) return;

    this.elements.teammatesList.innerHTML = '';

    this.state.teammates.forEach(teammate => {
      const teammateEl = document.createElement('div');
      teammateEl.className = `teammate ${teammate.status.isAlive ? 'alive' : 'dead'}`;
      
      const hpPercent = (teammate.status.hp / teammate.status.maxHp) * 100;
      
      teammateEl.innerHTML = `
        <div class="teammate-info">
          <div class="teammate-name">${teammate.name}</div>
          <div class="teammate-hp">
            <div class="hp-bar">
              <div class="hp-fill" style="width: ${hpPercent}%"></div>
            </div>
            <span class="hp-text">${teammate.status.hp}/${teammate.status.maxHp}</span>
          </div>
        </div>
      `;

      this.elements.teammatesList.appendChild(teammateEl);
    });
  }

  updateActionButtons() {
    const canAct = this.state.canAct && !this.state.actionInProgress;
    
    this.elements.actionButtons.forEach(btn => {
      btn.disabled = !canAct;
      if (canAct) {
        btn.classList.remove('disabled');
      } else {
        btn.classList.add('disabled');
      }
    });

    // 아이템 개수 업데이트
    if (this.state.myPlayer) {
      const items = this.state.myPlayer.items;
      
      // 아이템 버튼 활성화 체크
      const hasItems = items.dittany > 0 || items.attackBoost > 0 || items.defenseBoost > 0;
      if (!hasItems && this.elements.itemBtn) {
        this.elements.itemBtn.classList.add('no-items');
      } else if (this.elements.itemBtn) {
        this.elements.itemBtn.classList.remove('no-items');
      }
    }
  }

  updateTurnTimer() {
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }

    if (this.state.isMyTurn && this.state.turnStartTime) {
      this.turnTimer = setInterval(() => {
        const elapsed = Date.now() - this.state.turnStartTime;
        const remaining = Math.max(0, this.state.turnTimeLimit - elapsed);
        
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        if (this.elements.turnTimer) {
          this.elements.turnTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          // 30초 미만일 때 경고
          if (remaining < 30000) {
            this.elements.turnTimer.classList.add('warning');
          } else {
            this.elements.turnTimer.classList.remove('warning');
          }
        }
        
        // 시간 종료
        if (remaining === 0) {
          clearInterval(this.turnTimer);
          this.turnTimer = null;
          this.showMessage('시간 초과! 자동으로 패스됩니다.', 'warning');
        }
      }, 1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 액션 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  selectAction(actionType) {
    if (!this.state.canAct || this.state.actionInProgress) {
      this.showMessage('지금은 액션을 수행할 수 없습니다', 'warning');
      return;
    }

    this.state.selectedAction = { type: actionType };

    switch (actionType) {
      case 'attack':
      case 'defend':
        // 타겟 선택 필요
        this.requestTargets(actionType);
        break;
      case 'dodge':
      case 'pass':
        // 즉시 실행
        this.executeAction();
        break;
    }
  }

  requestTargets(actionType) {
    this.socket.emit('player:get_targets', { actionType });
  }

  handleTargetsReceived(data) {
    this.state.availableTargets = data.targets;
    this.showTargetSelection(data.actionType);
  }

  showTargetSelection(actionType) {
    if (!this.elements.targetModal || !this.elements.targetList) return;

    this.state.targetSelectionMode = true;
    
    // 타겟 리스트 생성
    this.elements.targetList.innerHTML = '';
    
    this.state.availableTargets.forEach(target => {
      const targetEl = document.createElement('div');
      targetEl.className = 'target-option';
      targetEl.dataset.targetId = target.id;
      
      const hpPercent = (target.hp / target.maxHp) * 100;
      const teamName = target.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      
      targetEl.innerHTML = `
        <div class="target-info">
          <div class="target-name">${target.name}</div>
          <div class="target-team">${teamName}</div>
          <div class="target-hp">
            <div class="hp-bar">
              <div class="hp-fill" style="width: ${hpPercent}%"></div>
            </div>
            <span class="hp-text">${target.hp}/${target.maxHp}</span>
          </div>
        </div>
      `;
      
      targetEl.addEventListener('click', () => {
        this.elements.targetList.querySelectorAll('.target-option').forEach(el => {
          el.classList.remove('selected');
        });
        targetEl.classList.add('selected');
        this.state.selectedAction.target = target.id;
      });
      
      this.elements.targetList.appendChild(targetEl);
    });

    // 모달 표시
    this.elements.targetModal.classList.add('active');
  }

  showItemSelection() {
    if (!this.state.canAct || this.state.actionInProgress) {
      this.showMessage('지금은 아이템을 사용할 수 없습니다', 'warning');
      return;
    }

    const player = this.state.myPlayer;
    if (!player) return;

    // 간단한 아이템 선택 (실제로는 모달로 구현)
    const items = [];
    if (player.items.dittany > 0) {
      items.push({ type: 'dittany', name: '디터니', count: player.items.dittany, desc: 'HP 10 회복' });
    }
    if (player.items.attackBoost > 0) {
      items.push({ type: 'attackBoost', name: '공격 보정기', count: player.items.attackBoost, desc: '다음 공격 1.5배 (10% 확률)' });
    }
    if (player.items.defenseBoost > 0) {
      items.push({ type: 'defenseBoost', name: '방어 보정기', count: player.items.defenseBoost, desc: '다음 방어 1.5배 (10% 확률)' });
    }

    if (items.length === 0) {
      this.showMessage('사용할 수 있는 아이템이 없습니다', 'warning');
      return;
    }

    // 첫 번째 아이템 자동 선택 (실제로는 사용자 선택)
    const selectedItem = items[0];
    this.state.selectedAction = { 
      type: 'item', 
      itemType: selectedItem.type 
    };

    // 디터니는 타겟 선택 필요
    if (selectedItem.type === 'dittany') {
      this.requestTargets('item');
    } else {
      this.executeAction();
    }
  }

  confirmAction() {
    if (!this.state.selectedAction) return;
    
    this.cancelTargetSelection();
    this.executeAction();
  }

  cancelTargetSelection() {
    this.state.targetSelectionMode = false;
    this.state.selectedAction = null;
    
    if (this.elements.targetModal) {
      this.elements.targetModal.classList.remove('active');
    }
  }

  executeAction() {
    if (!this.state.selectedAction || this.state.actionInProgress) return;

    this.state.actionInProgress = true;
    this.updateActionButtons();

    console.log('[Player] Executing action:', this.state.selectedAction);

    this.socket.emit('player:action', this.state.selectedAction);
  }

  handleActionResult(result) {
    console.log('[Player] Action result:', result);
    
    this.state.actionInProgress = false;
    this.state.selectedAction = null;
    
    if (result.success) {
      this.showMessage(result.message || '액션이 성공했습니다!', 'success');
    } else {
      this.showMessage(result.message || '액션이 실패했습니다', 'error');
    }
    
    this.updateActionButtons();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 전투 이벤트 처리
  // ═══════════════════════════════════════════════════════════════════════
  
  handleBattleStart(data) {
    this.showMessage('전투가 시작되었습니다!', 'success');
    this.addLogEntry({
      type: 'system',
      message: '전투 시작!',
      timestamp: Date.now()
    });
  }

  handleBattleEnd(data) {
    const winnerName = data.winner === 'A' ? '불사조 기사단' : 
                      data.winner === 'B' ? '죽음을 먹는 자들' : 
                      null;
    
    if (winnerName) {
      const isWinner = data.winner === this.state.team;
      this.showMessage(`전투 종료! ${winnerName} 승리!`, isWinner ? 'success' : 'error');
    } else {
      this.showMessage('전투 종료! 무승부!', 'info');
    }

    // 타이머 정리
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
  }

  handleTurnStart(data) {
    const isMyTeamTurn = data.team === this.state.team;
    
    if (isMyTeamTurn) {
      this.showMessage('우리 팀의 턴입니다!', 'success');
    } else {
      const teamName = data.teamName || '상대 팀';
      this.showMessage(`${teamName}의 턴입니다`, 'info');
    }
  }

  handleTurnEnd(data) {
    // 턴 종료 처리
    this.state.actionInProgress = false;
    this.state.selectedAction = null;
    this.updateActionButtons();
  }

  handlePlayerDisconnected(data) {
    const message = `${data.playerName}님이 접속을 종료했습니다`;
    this.addLogEntry({
      type: 'system',
      message,
      timestamp: Date.now()
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 채팅 시스템
  // ═══════════════════════════════════════════════════════════════════════
  
  sendChatMessage() {
    const input = this.elements.chatInput;
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    // 채널 확인
    const activeChannel = document.querySelector('.channel-btn.active');
    const channel = activeChannel ? activeChannel.dataset.channel : 'all';

    this.socket.emit('chat:send', { text, channel });
    
    input.value = '';
  }

  addChatMessage(message) {
    if (!this.elements.chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${message.channel || 'all'}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const senderName = message.sender.name || '익명';
    const teamIndicator = message.sender.team ? ` [${message.sender.team === 'A' ? '불사조' : '죽음을'}]` : '';

    messageEl.innerHTML = `
      <span class="chat-time">${time}</span>
      <span class="chat-sender">${senderName}${teamIndicator}</span>
      <span class="chat-text">${this.escapeHtml(message.text)}</span>
    `;

    this.elements.chatMessages.appendChild(messageEl);
    this.scrollToBottom(this.elements.chatMessages);

    // 메시지 제한
    const messages = this.elements.chatMessages.children;
    if (messages.length > 100) {
      messages[0].remove();
    }
  }

  addCheerMessage(cheer) {
    this.addChatMessage({
      text: `[응원] ${cheer.message}`,
      sender: { name: cheer.spectator },
      channel: 'spectator',
      timestamp: cheer.timestamp
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 로그 시스템
  // ═══════════════════════════════════════════════════════════════════════
  
  loadInitialLogs(logs) {
    if (!this.elements.battleLog) return;
    
    this.elements.battleLog.innerHTML = '';
    logs.forEach(log => this.addLogEntry(log));
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

    // 로그 제한
    const entries = this.elements.battleLog.children;
    if (entries.length > 200) {
      entries[0].remove();
    }

    // 중요한 로그는 토스트로도 표시
    if (log.type === 'system' && log.message.includes(this.state.playerName)) {
      this.showMessage(log.message, 'info');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI 헬퍼
  // ═══════════════════════════════════════════════════════════════════════
  
  showMessage(message, type = 'info') {
    // 간단한 토스트 메시지
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
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

    // 애니메이션
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 10);

    // 자동 제거
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  scrollToBottom(element) {
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 정리
  // ═══════════════════════════════════════════════════════════════════════
  
  destroy() {
    // 타이머 정리
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.battleTimer) {
      clearInterval(this.battleTimer);
      this.battleTimer = null;
    }

    // 소켓 연결 해제
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    console.log('[Player] Interface destroyed');
  }
}

// 전역 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.pyxisPlayer = new PyxisPlayerInterface();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (window.pyxisPlayer) {
    window.pyxisPlayer.destroy();
  }
});
