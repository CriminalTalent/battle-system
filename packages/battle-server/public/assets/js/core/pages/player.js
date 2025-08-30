// PYXIS Player Page - 플레이어 페이지 로직
class PyxisPlayer {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.myPlayerId = null;
    this.myPlayerData = null;
    this.isConnected = false;
    this.joined = false;
    
    this.init();
  }

  // 초기화
  init() {
    console.log('[Player] Initializing player page');
    
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
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

    // 인증
    this.authSection = UI.$('#authSection');
    this.authForm = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken = UI.$('#authToken');
    this.authName = UI.$('#authName');

    // 게임 UI
    this.allyUnits = UI.$('#allyUnits');
    this.playerInfoBar = UI.$('#playerInfoBar');
    this.playerNameEl = UI.$('#playerName');
    this.playerTeamEl = UI.$('#playerTeam');
    this.turnStatus = UI.$('#turnStatus');
    this.gameHint = UI.$('#gameHint');

    // 액션 버튼
    this.actionBar = UI.$('#actionBar');
    this.btnAttack = UI.$('#btnAttack');
    this.btnDefend = UI.$('#btnDefend');
    this.btnDodge = UI.$('#btnDodge');
    this.btnUseItem = UI.$('#btnUseItem');
    this.btnPass = UI.$('#btnPass');

    // 초상화/로그/채팅
    this.battlePortrait = UI.$('#battlePortrait');
    this.portraitChar = UI.$('#portraitChar');
    this.portraitStats = UI.$('#portraitStats');
    this.battleLogCard = UI.$('#battleLogCard');
    this.battleLog = UI.$('#battleLog');
    this.chatPanel = UI.$('#chatPanel');
    this.chatChannel = UI.$('#chatChannel');
    this.chatInput = UI.$('#chatInput');
    this.chatSend = UI.$('#chatSend');
    this.chatMessages = UI.$('#chatMessages');

    // 타겟 선택
    this.targetOverlay = UI.$('#targetOverlay');
    this.targetTitle = UI.$('#targetTitle');
    this.targetList = UI.$('#targetList');
    this.cancelTarget = UI.$('#cancelTarget');
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 인증 폼
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.authenticate();
    });

    // 액션 버튼들
    this.btnAttack.addEventListener('click', () => this.doAttack());
    this.btnDefend.addEventListener('click', () => this.doDefend());
    this.btnDodge.addEventListener('click', () => this.doEvade());
    this.btnUseItem.addEventListener('click', () => this.doUseItem());
    this.btnPass.addEventListener('click', () => this.doPass());

    // 채팅
    this.chatSend.addEventListener('click', () => this.sendChat());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // 타겟 선택
    this.cancelTarget.addEventListener('click', () => this.hideTargets());

    // 단축키
    document.addEventListener('keydown', (e) => {
      if (this.targetOverlay.style.display === 'flex') return;
      if (!this.isMyTurn()) return;
      
      switch (e.key) {
        case '1':
          e.preventDefault();
          this.doAttack();
          break;
        case '2':
          e.preventDefault();
          this.doDefend();
          break;
        case '3':
          e.preventDefault();
          this.doEvade();
          break;
        case '4':
          e.preventDefault();
          this.doUseItem();
          break;
        case '5':
          e.preventDefault();
          this.doPass();
          break;
      }
    });

    // ESC 키로 타겟 선택 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.targetOverlay.style.display === 'flex') {
        this.hideTargets();
      }
    });

    // 윈도우 이벤트
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (this.joined && this.battleState) this.render();
      }, 250);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.joined && this.battleState) {
        this.render();
        this.requestStateUpdate();
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

    PyxisSocket.on('connection:disconnect', ({ reason }) => {
      this.updateConnectionStatus('disconnected', '연결 끊김');
      if (this.joined) {
        if (reason === 'io server disconnect') {
          UI.error('서버와의 연결이 종료되었습니다');
        } else {
          UI.error('연결이 끊어졌습니다. 재연결 시도 중...');
        }
      }
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      this.updateConnectionStatus('disconnected', '연결 실패');
      if (this.joined) {
        UI.error(`연결 오류: ${error.message || '알 수 없는 오류'}`);
      }
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.updateConnectionStatus('connected', '재연결됨');
      UI.success(`서버에 재연결되었습니다 (시도 ${attemptNumber}회)`);
      
      if (this.joined && this.currentBattleId) {
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

    // 채팅 및 로그
    PyxisSocket.on('chat:new', (message) => {
      this.handleChatMessage(message);
    });

    PyxisSocket.on('chat', (message) => {
      this.handleChatMessage(message);
    });

    PyxisSocket.on('log:new', (event) => {
      if (event?.text) {
        this.addLogEntry(event.text, 'system');
      }
    });

    PyxisSocket.on('phase:change', (phase) => {
      const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
      
      if (this.battleState) {
        this.battleState.turn = { 
          ...this.battleState.turn, 
          actor: null, 
          pending: [], 
          phase: phase.phase, 
          round: phase.round 
        };
        this.battleState.phase = phase.phase;
        this.battleState.round = phase.round;
      }
      
      this.render();
    });

    PyxisSocket.on('battle:end', (result) => {
      const winnerText = result.winner === 'draw' ? '무승부' : 
                        (result.winner === 'A' || result.winner === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들');
      this.addLogEntry(`◆ 전투 종료: ${winnerText}`, 'system');
      UI.info('전투가 종료되었습니다');
    });

    // 액션 응답
    PyxisSocket.on('actionSuccess', (result) => {
      if (result?.message) {
        UI.success(result.message);
      }
    });

    PyxisSocket.on('actionError', (message) => {
      UI.error(`행동 실패: ${message || '알 수 없는 오류'}`);
    });

    // 채팅 오류
    PyxisSocket.on('chatError', (error) => {
      UI.error(`채팅 오류: ${error}`);
    });
  }

  // 연결 상태 업데이트
  updateConnectionStatus(status, text) {
    this.connectionDot.className = `connection-dot ${status}`;
    this.connectionText.textContent = text;
  }

  // URL 파라미터에서 초기화
  initFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const battleParam = urlParams.get('battle');
    const tokenParam = urlParams.get('token');
    const nameParam = urlParams.get('name');
    
    if (battleParam && tokenParam && nameParam) {
      this.authBattleId.value = battleParam;
      this.authToken.value = tokenParam;
      this.authName.value = decodeURIComponent(nameParam);
      
      // 소켓 연결 후 자동 인증
      if (PyxisSocket.isConnected()) {
        setTimeout(() => this.authenticate(), 500);
      } else {
        PyxisSocket.on('connection:success', () => {
          setTimeout(() => this.authenticate(), 500);
        });
      }
    } else {
      UI.show(this.authSection);
    }
  }

  // 인증
  async authenticate() {
    const validation = UI.validateForm(this.authForm, {
      authBattleId: { required: true, label: '전투 ID' },
      authToken: { required: true, label: '플레이어 OTP' },
      authName: { required: true, label: '플레이어 이름' }
    });

    if (!validation.valid) {
      UI.error(validation.errors[0]);
      return;
    }

    const submitBtn = this.authForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true);

    try {
      this.currentBattleId = validation.data.authBattleId;
      
      const authData = {
        role: 'player',
        battleId: validation.data.authBattleId,
        token: validation.data.authToken,
        name: validation.data.authName,
        playerId: validation.data.authName,
        otp: validation.data.authToken
      };

      await PyxisSocket.authenticate(authData);
      
    } catch (error) {
      console.error('[Player] Auth failed:', error);
      UI.error(`인증 실패: ${error.message}`);
      UI.setLoading(submitBtn, false);
    }
  }

  // 인증 성공 처리
  handleAuthSuccess(data) {
    console.log('[Player] Auth success:', data);
    
    this.joined = true;
    this.battleState = data.state || data.battle;
    this.myPlayerId = data.selfPid || data.playerId;
    this.myPlayerData = this.myPlayerId && this.battleState?.players ? 
                      this.battleState.players[this.myPlayerId] : null;
    
    UI.hide(this.authSection);
    UI.show(this.playerInfoBar);
    UI.show(this.battlePortrait);
    UI.show(this.battleLogCard);
    UI.show(this.chatPanel);
    
    const submitBtn = this.authForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, false);
    UI.showFeedback(submitBtn, 'success');
    
    this.addLogEntry('전투에 성공적으로 참가했습니다!', 'system');
    UI.success('전투 입장 완료!');
    
    this.render();
  }

  // 상태 업데이트 처리
  handleStateUpdate(state) {
    console.log('[Player] State update:', state);
    
    this.battleState = state;
    this.myPlayerData = this.myPlayerId && state?.players ? 
                      state.players[this.myPlayerId] : this.myPlayerData;
    
    this.render();
  }

  // 상태 업데이트 요청
  requestStateUpdate() {
    if (PyxisSocket.isConnected() && this.currentBattleId) {
      PyxisSocket.socket.emit('requestState', { battleId: this.currentBattleId });
    }
  }

  // 렌더링
  render() {
    try {
      if (!this.battleState) return;
      
      this.renderPlayerInfo();
      this.renderPortrait();
      this.renderTeam();
      this.renderBattleLog();
    } catch (error) {
      console.error('[Player] Render error:', error);
    }
  }

  // 플레이어 정보 렌더링
  renderPlayerInfo() {
    if (!this.myPlayerData) return;
    
    this.playerNameEl.textContent = this.myPlayerData.name || '-';
    this.playerTeamEl.textContent = UI.getTeamName(this.myPlayerData.team);
    
    const isMyTurn = this.isMyTurn();
    this.turnStatus.textContent = isMyTurn ? '내 차례!' : '대기중';
    this.turnStatus.classList.toggle('active', isMyTurn);
    
    // 행동 버튼 활성화/비활성화
    [this.btnAttack, this.btnDefend, this.btnDodge, this.btnUseItem, this.btnPass].forEach(btn => {
      btn.disabled = !isMyTurn;
    });
    
    if (isMyTurn) {
      this.gameHint.textContent = '행동을 선택하세요!';
      this.gameHint.classList.add('active');
    } else {
      this.gameHint.textContent = '내 턴을 기다리는 중...';
      this.gameHint.classList.remove('active');
    }
  }

  // 초상화 렌더링
  renderPortrait() {
    const currentActorId = this.getCurrentActor();
    const currentPlayer = currentActorId && this.battleState?.players?.[currentActorId];
    
    if (currentPlayer) {
      UI.show(this.portraitChar);
      this.portraitChar.style.backgroundImage = currentPlayer.avatar ? `url(${currentPlayer.avatar})` : '';
      this.portraitChar.classList.remove('left', 'right');
      
      const isEnemy = (currentPlayer.team === 'B' || currentPlayer.team === 'team2');
      this.portraitChar.classList.add(isEnemy ? 'right' : 'left');
      this.portraitChar.classList.toggle('active', currentActorId === this.myPlayerId);

      const stats = currentPlayer.stats || { 
        attack: currentPlayer.atk, 
        defense: currentPlayer.def, 
        agility: currentPlayer.agi, 
        luck: currentPlayer.luk 
      };
      
      UI.show(this.portraitStats);
      this.portraitStats.innerHTML = `
        <div class="stat-item"><span class="stat-label">이름:</span><span class="stat-value">${currentPlayer.name}</span></div>
        <div class="stat-item"><span class="stat-label">팀:</span><span class="stat-value">${UI.getTeamName(currentPlayer.team)}</span></div>
        <div class="stat-item"><span class="stat-label">HP:</span><span class="stat-value">${currentPlayer.hp}/${currentPlayer.maxHp || 100}</span></div>
        <div class="stat-item"><span class="stat-label">공격:</span><span class="stat-value">${stats.attack ?? currentPlayer.atk}</span></div>
        <div class="stat-item"><span class="stat-label">방어:</span><span class="stat-value">${stats.defense ?? currentPlayer.def}</span></div>
        <div class="stat-item"><span class="stat-label">민첩:</span><span class="stat-value">${stats.agility ?? currentPlayer.agi}</span></div>
        <div class="stat-item"><span class="stat-label">행운:</span><span class="stat-value">${stats.luck ?? currentPlayer.luk}</span></div>
      `;
    } else {
      UI.hide(this.portraitChar);
      UI.hide(this.portraitStats);
    }
  }

  // 팀원 렌더링
  renderTeam() {
    if (!this.battleState?.players || !this.myPlayerData) return;
    
    this.allyUnits.innerHTML = '';
    const allies = Object.values(this.battleState.players).filter(player => {
      const myTeamA = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
      const playerTeamA = (player.team === 'A' || player.team === 'team1');
      return myTeamA === playerTeamA;
    });
    
    allies.forEach(player => {
      this.allyUnits.appendChild(this.createUnitCard(player));
    });
  }

  // 유닛 카드 생성
  createUnitCard(player) {
    const card = document.createElement('div');
    const currentActorId = this.getCurrentActor();
    card.className = `unit enhance-hover ${currentActorId === player.id ? 'active' : ''} ${player.alive === false ? 'dead' : ''}`;
    card.dataset.playerId = player.id;
    
    const avatar = document.createElement('div');
    avatar.className = 'unit-avatar';
    if (player.avatar) avatar.style.backgroundImage = `url(${player.avatar})`;
    
    const info = document.createElement('div');
    info.className = 'unit-info';
    
    const name = document.createElement('div');
    name.className = `unit-name ${player.alive === false ? 'dead' : ''}`;
    name.textContent = player.name;
    
    const hp = document.createElement('div');
    hp.className = 'unit-hp';
    const hpBar = document.createElement('span');
    hpBar.className = 'unit-hp-bar';
    hpBar.style.width = `${UI.calculateHpPercent(player.hp, player.maxHp)}%`;
    hp.appendChild(hpBar);
    
    const stats = document.createElement('div');
    stats.className = 'unit-stats';
    const s = player.stats || { attack: player.atk, defense: player.def, agility: player.agi, luck: player.luk };
    stats.textContent = `공격 ${s.attack ?? player.atk} · 방어 ${s.defense ?? player.def} · 민첩 ${s.agility ?? player.agi} · 행운 ${s.luck ?? player.luk}`;
    
    info.appendChild(name);
    info.appendChild(hp);
    info.appendChild(stats);
    card.appendChild(avatar);
    card.appendChild(info);
    
    return card;
  }

  // 전투 로그 렌더링
  renderBattleLog() {
    if (!this.battleState?.chat) return;
    
    this.battleLog.innerHTML = '';
    this.battleState.chat.slice(-50).forEach(entry => {
      if (entry.type === 'system' || entry.type === 'action') {
        this.addLogEntry(entry.text, entry.type);
      }
    });
  }

  // 현재 행동자 ID 가져오기
  getCurrentActor() {
    return this.battleState?.turn?.pending?.[0] || 
           this.battleState?.turn?.actor || 
           null;
  }

  // 내 턴인지 확인
  isMyTurn() {
    const currentActor = this.getCurrentActor();
    return (currentActor === this.myPlayerId) && 
           (this.myPlayerData?.alive !== false);
  }

  // 적 플레이어들 가져오기
  getEnemies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    
    return Object.values(this.battleState.players).filter(player => {
      const myTeamA = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
      const playerTeamA = (player.team === 'A' || player.team === 'team1');
      return myTeamA !== playerTeamA && player.alive !== false;
    });
  }

  // 아군 플레이어들 가져오기
  getAllies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    
    return Object.values(this.battleState.players).filter(player => {
      const myTeamA = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
      const playerTeamA = (player.team === 'A' || player.team === 'team1');
      return myTeamA === playerTeamA && player.alive !== false;
    });
  }

  // 액션 전송
  async sendAction(actionType, payload = {}) {
    if (!PyxisSocket.isConnected()) {
      UI.error('서버에 연결되어 있지 않습니다');
      return;
    }

    const actionData = { type: actionType, ...payload };
    console.log('[Player] Sending action:', actionData);

    try {
      await PyxisSocket.sendAction(actionData, this.currentBattleId, this.myPlayerId);
    } catch (error) {
      console.error('[Player] Action failed:', error);
      UI.error(`행동 실패: ${error.message}`);
    }
  }

  // 공격
  doAttack() {
    const enemies = this.getEnemies();
    if (enemies.length === 0) {
      UI.error('공격할 대상이 없습니다!');
      return;
    }
    this.showTargets('공격 대상 선택', enemies, (target) => {
      this.sendAction('attack', { targetPid: target.id });
    });
  }

  // 방어
  doDefend() {
    this.sendAction('defend');
  }

  // 회피
  doEvade() {
    this.sendAction('evade');
  }

  // 아이템 사용
  doUseItem() {
    const itemsList = ['디터니', '공격 보정기', '방어 보정기'];
    const pick = prompt(`사용할 아이템을 입력하세요:\n${itemsList.join(', ')}`);
    if (!pick) return;
    
    if (pick === '디터니') {
      const allies = this.getAllies();
      if (allies.length === 0) {
        UI.error('회복 대상이 없습니다!');
        return;
      }
      this.showTargets('회복 대상 선택', allies, (target) => {
        this.sendAction('useItem', { item: '디터니', targetPid: target.id });
      });
    } else if (pick === '공격 보정기' || pick === '방어 보정기') {
      this.sendAction('useItem', { item: pick, targetPid: this.myPlayerId });
    } else {
      UI.error('알 수 없는 아이템입니다.');
    }
  }

  // 패스
  doPass() {
    if (confirm('정말로 턴을 넘기시겠습니까?')) {
      this.sendAction('pass');
    }
  }

  // 타겟 선택 표시
  showTargets(title, targets, callback) {
    this.targetTitle.textContent = title;
    this.targetList.innerHTML = '';
    
    targets.forEach(target => {
      const card = document.createElement('div');
      card.className = `target-card enhance-hover ${target.alive === false ? 'disabled' : ''}`;
      
      const nameEl = document.createElement('div');
      nameEl.className = 'target-name';
      nameEl.textContent = target.name;
      
      const hpEl = document.createElement('div');
      hpEl.className = 'target-hp';
      hpEl.textContent = `HP ${target.hp}/${target.maxHp || 100}`;
      
      card.appendChild(nameEl);
      card.appendChild(hpEl);
      
      if (target.alive !== false) {
        card.onclick = () => {
          this.hideTargets();
          callback(target);
        };
      }
      
      this.targetList.appendChild(card);
    });
    
    this.targetOverlay.style.display = 'flex';
  }

  // 타겟 선택 숨기기
  hideTargets() {
    this.targetOverlay.style.display = 'none';
  }

  // 채팅 전송
  sendChat() {
    const message = this.chatInput.value.trim();
    if (!message || !this.currentBattleId) return;
    
    if (!PyxisSocket.isConnected()) {
      UI.error('서버에 연결되어 있지 않습니다');
      return;
    }
    
    // /t 접두사 처리
    let scope = (this.chatChannel.value === 'team') ? 'team' : 'all';
    let text = message;
    if (message.startsWith('/t ')) {
      scope = 'team';
      text = message.slice(3).trim();
      if (!text) return;
    }
    
    const nickname = this.myPlayerData?.name || '플레이어';
    
    const chatData = {
      battleId: this.currentBattleId,
      text,
      nickname,
      role: 'player',
      scope
    };
    
    PyxisSocket.sendChat(chatData);
    this.chatInput.value = '';
  }

  // 채팅 메시지 처리
  handleChatMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${message.type || (message.scope === 'team' ? 'team' : '')}`;
    
    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = UI.formatTime(message.ts || Date.now());
    
    const contentEl = document.createElement('span');
    contentEl.className = 'chat-content';
    
    if (message.type === 'system') {
      contentEl.textContent = `[시스템] ${message.text}`;
    } else if (message.type === 'cheer') {
      contentEl.textContent = `[응원] ${message.from?.nickname || message.from || '익명'}: ${message.text}`;
    } else {
      const scope = (message.scope === 'team' || message.channel === 'team') ? '[팀] ' : '[전체] ';
      const nickname = message.from?.nickname || message.from || message.nickname || '익명';
      contentEl.textContent = `${scope}${nickname}: ${message.text}`;
    }
    
    messageEl.appendChild(timeEl);
    messageEl.appendChild(contentEl);
    this.chatMessages.appendChild(messageEl);
    
    UI.scrollToBottom(this.chatMessages);
    
    // 최대 100개 메시지 유지
    while (this.chatMessages.children.length > 100) {
      this.chatMessages.removeChild(this.chatMessages.firstChild);
    }
  }

  // 로그 엔트리 추가
  addLogEntry(content, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = UI.formatTime(Date.now());
    
    const contentSpan = document.createElement('span');
    contentSpan.className = 'content';
    contentSpan.textContent = content;
    
    entry.appendChild(timeSpan);
    entry.appendChild(contentSpan);
    this.battleLog.appendChild(entry);
    
    UI.scrollToBottom(this.battleLog);
    
    // 최대 100개 엔트리 유지
    while (this.battleLog.children.length > 100) {
      this.battleLog.removeChild(this.battleLog.firstChild);
    }
  }

  // 정리
  cleanup() {
    PyxisSocket.cleanup();
  }
}

// 페이지 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.player = new PyxisPlayer();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (window.player) {
    window.player.cleanup();
  }
});

// 전역 오류 처리
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
});
