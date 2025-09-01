/* ═══════════════════════════════════════════════════════════════════════
   PYXIS 플레이어 시스템 - 몰입감 있는 전투 인터페이스
   ─────────────────────────────────────────────────────────────────────
   실시간 턴제 전투의 핵심 플레이어 경험
   Socket.IO 기반 실시간 동기화 및 전투 액션
   
   색상 테마: 짙은 네이비(#00080D) + 골드(#DCC7A2)
   디자인: 게임적 감각, 직관적 UI, 실시간 반응성
   ═══════════════════════════════════════════════════════════════════════ */

class PyxisPlayerInterface {
  constructor() {
    // 플레이어 상태
    this.playerData = {
      id: null,
      name: '',
      team: null,
      battleId: null,
      isAuthenticated: false,
      isConnected: false
    };

    // 전투 상태
    this.battleState = {
      isActive: false,
      currentTurn: null,
      turnTimer: null,
      phase: 'waiting', // waiting, ongoing, selecting, ended
      myTurn: false,
      canAct: false
    };

    // 캐릭터 정보
    this.character = {
      stats: { attack: 0, defense: 0, agility: 0, luck: 0 },
      status: { hp: 100, maxHp: 100, isAlive: true, effects: [] },
      items: { dittany: 0, attackBoost: 0, defenseBoost: 0 },
      combat: { actions: 0, damageDealt: 0, damageTaken: 0 }
    };

    // UI 상태
    this.uiState = {
      selectedAction: null,
      targetSelectionMode: false,
      availableTargets: [],
      animationQueue: [],
      notifications: []
    };

    // 소켓 연결
    this.socket = null;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;

    this.initializeInterface();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 시스템 초기화
  // ═══════════════════════════════════════════════════════════════════════

  initializeInterface() {
    console.log('PYXIS 플레이어 인터페이스 초기화 중...');
    
    this.setupDOMElements();
    this.setupEventHandlers();
    this.setupKeyboardShortcuts();
    this.initializeAnimations();
    this.checkUrlAuthentication();
    this.establishSocketConnection();
    
    this.logBattleEvent('전투 인터페이스에 연결되었습니다', 'system');
    console.log('PYXIS 플레이어 시스템 준비 완료');
  }

  setupDOMElements() {
    // 인증 관련
    this.authSection = this.getElement('#authSection');
    this.authForm = this.getElement('#authForm');
    this.playerNameInput = this.getElement('#playerName');
    this.playerTokenInput = t기',
        rarity: 'rare'
      }
    ];
    
    this.itemsList.innerHTML = '';
    
    items.forEach(item => {
      const itemElement = this.createItemElement(item);
      this.itemsList.appendChild(itemElement);
    });
  }

  createItemElement(item) {
    const itemEl = document.createElement('div');
    itemEl.className = `item-card rarity-${item.rarity} ${item.count === 0 ? 'item-depleted' : ''}`;
    
    itemEl.innerHTML = `
      <div class="item-icon">${item.icon}</div>
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-description">${item.description}</div>
        <div class="item-count">${item.count}개</div>
      </div>
    `;
    
    // 아이템 사용 가능 시 클릭 이벤트
    if (item.count > 0 && this.battleState.myTurn) {
      itemEl.classList.add('item-usable');
      itemEl.addEventListener('click', () => this.useItem(item.name));
    }
    
    return itemEl;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 액션 시스템
  // ═══════════════════════════════════════════════════════════════════════

  selectAttackAction() {
    if (!this.canPerformAction()) return;
    
    this.uiState.selectedAction = 'attack';
    this.highlightActionButton(this.actionAttack);
    this.showTargetSelection('attack');
    
    this.logBattleEvent('공격 대상을 선택하세요', 'info');
  }

  selectDefenseAction() {
    if (!this.canPerformAction()) return;
    
    this.executeAction('defend', null);
  }

  selectDodgeAction() {
    if (!this.canPerformAction()) return;
    
    this.executeAction('dodge', null);
  }

  selectItemAction() {
    if (!this.canPerformAction()) return;
    
    this.showItemSelection();
  }

  selectPassAction() {
    if (!this.canPerformAction()) return;
    
    if (confirm('정말로 이번 턴을 넘기시겠습니까?')) {
      this.executeAction('pass', null);
    }
  }

  canPerformAction() {
    if (!this.battleState.myTurn) {
      this.showNotification('당신의 턴이 아닙니다', 'warning');
      return false;
    }
    
    if (!this.battleState.canAct) {
      this.showNotification('현재 행동할 수 없습니다', 'warning');
      return false;
    }
    
    if (!this.character.status.isAlive) {
      this.showNotification('전투 불능 상태입니다', 'warning');
      return false;
    }
    
    return true;
  }

  showTargetSelection(actionType) {
    this.uiState.targetSelectionMode = true;
    
    // 가능한 대상 목록 생성 (시뮬레이션)
    const targets = this.generateAvailableTargets(actionType);
    this.uiState.availableTargets = targets;
    
    this.renderTargetList(targets);
    this.showElement(this.targetSelection);
  }

  generateAvailableTargets(actionType) {
    // 실제 환경에서는 서버에서 받아올 데이터
    const enemies = [
      { id: 'enemy1', name: '적 플레이어 1', hp: 85, maxHp: 100, team: 'enemy' },
      { id: 'enemy2', name: '적 플레이어 2', hp: 92, maxHp: 100, team: 'enemy' }
    ];
    
    return enemies.filter(target => target.hp > 0);
  }

  renderTargetList(targets) {
    if (!this.targetList) return;
    
    this.targetList.innerHTML = '';
    
    if (targets.length === 0) {
      this.targetList.innerHTML = '<div class="no-targets">선택 가능한 대상이 없습니다</div>';
      return;
    }
    
    targets.forEach(target => {
      const targetElement = this.createTargetElement(target);
      this.targetList.appendChild(targetElement);
    });
    
    // 취소 버튼
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary target-cancel';
    cancelBtn.textContent = '취소';
    cancelBtn.addEventListener('click', () => this.cancelTargetSelection());
    this.targetList.appendChild(cancelBtn);
  }

  createTargetElement(target) {
    const targetEl = document.createElement('div');
    targetEl.className = 'target-option';
    
    const hpPercentage = (target.hp / target.maxHp) * 100;
    
    targetEl.innerHTML = `
      <div class="target-info">
        <div class="target-name">${target.name}</div>
        <div class="target-hp">
          <div class="hp-bar">
            <div class="hp-fill" style="width: ${hpPercentage}%;"></div>
          </div>
          <span class="hp-text">${target.hp}/${target.maxHp}</span>
        </div>
      </div>
    `;
    
    targetEl.addEventListener('click', () => this.selectTarget(target));
    
    return targetEl;
  }

  selectTarget(target) {
    this.executeAction(this.uiState.selectedAction, target.id);
    this.cancelTargetSelection();
  }

  cancelTargetSelection() {
    this.uiState.targetSelectionMode = false;
    this.uiState.selectedAction = null;
    this.uiState.availableTargets = [];
    
    this.hideElement(this.targetSelection);
    this.clearActionHighlights();
  }

  cancelAction() {
    if (this.uiState.targetSelectionMode) {
      this.cancelTargetSelection();
    }
    
    this.clearActionHighlights();
    this.uiState.selectedAction = null;
  }

  executeAction(actionType, targetId = null) {
    const actionData = {
      type: actionType,
      playerId: this.playerData.id,
      battleId: this.playerData.battleId,
      targetId: targetId,
      timestamp: Date.now()
    };
    
    // 서버로 액션 전송 (시뮬레이션)
    this.sendActionToServer(actionData);
    
    // 로컬 UI 업데이트
    this.disableActionButtons();
    this.logPlayerAction(actionType, targetId);
    
    this.battleState.canAct = false;
    this.updateTurnStatus('행동 완료 - 다른 플레이어를 기다리는 중...');
  }

  async sendActionToServer(actionData) {
    // 실제 환경에서는 Socket.IO로 서버에 전송
    console.log('액션 전송:', actionData);
    
    // 시뮬레이션: 서버 응답 대기
    await this.delay(500);
    
    this.logBattleEvent(`${actionData.type} 액션이 서버에 전송되었습니다`, 'info');
  }

  logPlayerAction(actionType, targetId) {
    const actionNames = {
      attack: '공격',
      defend: '방어',
      dodge: '회피',
      item: '아이템 사용',
      pass: '패스'
    };
    
    const actionName = actionNames[actionType] || actionType;
    let message = `${this.playerData.name}이(가) ${actionName}을(를) 선택했습니다`;
    
    if (targetId) {
      message += ` (대상: ${targetId})`;
    }
    
    this.logBattleEvent(message, 'action');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI 상태 관리
  // ═══════════════════════════════════════════════════════════════════════

  highlightActionButton(button) {
    this.clearActionHighlights();
    if (button) {
      button.classList.add('btn-selected');
    }
  }

  clearActionHighlights() {
    [this.actionAttack, this.actionDefend, this.actionDodge, this.actionItem, this.actionPass]
      .forEach(btn => btn?.classList.remove('btn-selected'));
  }

  enableActionButtons() {
    [this.actionAttack, this.actionDefend, this.actionDodge, this.actionItem, this.actionPass]
      .forEach(btn => {
        if (btn) btn.disabled = false;
      });
  }

  disableActionButtons() {
    [this.actionAttack, this.actionDefend, this.actionDodge, this.actionItem, this.actionPass]
      .forEach(btn => {
        if (btn) btn.disabled = true;
      });
  }

  updateTurnStatus(message, type = 'info') {
    if (this.turnText) {
      this.turnText.textContent = message;
      this.turnText.className = `turn-text ${type}`;
    }
    
    if (this.turnIndicator) {
      this.turnIndicator.className = `turn-indicator ${type}`;
    }
  }

  updateConnectionStatus(isConnected = false) {
    if (this.connectionDot) {
      this.connectionDot.style.backgroundColor = isConnected ? 
        'var(--success)' : 'var(--warning)';
    }
    
    if (this.connectionText) {
      this.connectionText.textContent = isConnected ? 
        '전투 서버 연결됨' : '연결 중...';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 소켓 통신 시스템
  // ═══════════════════════════════════════════════════════════════════════

  establishSocketConnection() {
    try {
      // Socket.IO 연결 시뮬레이션
      this.simulateSocketConnection();
      
    } catch (error) {
      console.error('소켓 연결 실패:', error);
      this.handleConnectionError(error);
    }
  }

  async simulateSocketConnection() {
    this.updateConnectionStatus(false);
    this.logBattleEvent('전투 서버에 연결하는 중...', 'info');
    
    await this.delay(1500);
    
    this.playerData.isConnected = true;
    this.updateConnectionStatus(true);
    this.logBattleEvent('전투 서버에 성공적으로 연결되었습니다', 'success');
    
    this.startHeartbeat();
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      // 연결 상태 확인
      if (this.playerData.isConnected) {
        console.log('헤트비트');
      }
    }, 30000); // 30초마다
  }

  handleConnectionError(error) {
    this.playerData.isConnected = false;
    this.updateConnectionStatus(false);
    this.logBattleEvent('연결 오류: ' + error.message, 'error');
    
    // 재연결 시도
    setTimeout(() => {
      if (this.reconnectAttempts < 5) {
        this.reconnectAttempts++;
        this.logBattleEvent(`재연결 시도 중... (${this.reconnectAttempts}/5)`, 'warning');
        this.establishSocketConnection();
      }
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 로그 및 메시징 시스템
  // ═══════════════════════════════════════════════════════════════════════

  logBattleEvent(message, type = 'info') {
    if (!this.battleLog) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `
      <span class="log-time">[${timestamp}]</span>
      <span class="log-message">${this.escapeHtml(message)}</span>
    `;
    
    this.battleLog.appendChild(logEntry);
    this.battleLog.scrollTop = this.battleLog.scrollHeight;
    
    // 로그 항목이 너무 많으면 오래된 것 제거
    while (this.battleLog.children.length > 100) {
      this.battleLog.removeChild(this.battleLog.firstChild);
    }
  }

  sendChatMessage() {
    if (!this.chatInput) return;
    
    const message = this.chatInput.value.trim();
    if (!message) return;
    
    const chatData = {
      playerId: this.playerData.id,
      playerName: this.playerData.name,
      message: message,
      channel: 'all', // all, team, system
      timestamp: Date.now()
    };
    
    // 서버로 채팅 메시지 전송
    this.sendChatToServer(chatData);
    
    // 로컬 채팅창에 추가
    this.displayChatMessage(chatData);
    
    // 입력창 초기화
    this.chatInput.value = '';
  }

  async sendChatToServer(chatData) {
    // 실제 환경에서는 Socket.IO로 서버에 전송
    console.log('채팅 전송:', chatData);
    
    // 시뮬레이션
    await this.delay(100);
  }

  displayChatMessage(chatData) {
    if (!this.chatMessages) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message channel-${chatData.channel}`;
    
    const time = new Date(chatData.timestamp).toLocaleTimeString();
    const teamClass = this.playerData.team === 'phoenix' ? 'team-phoenix' : 'team-deathEater';
    
    messageEl.innerHTML = `
      <span class="chat-time">[${time}]</span>
      <span class="chat-sender ${teamClass}">${chatData.playerName}:</span>
      <span class="chat-text">${this.escapeHtml(chatData.message)}</span>
    `;
    
    this.chatMessages.appendChild(messageEl);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    
    // 채팅 항목이 너무 많으면 오래된 것 제거
    while (this.chatMessages.children.length > 50) {
      this.chatMessages.removeChild(this.chatMessages.firstChild);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 알림 시스템
  // ═══════════════════════════════════════════════════════════════════════

  showNotification(message, type = 'info', duration = 4000) {
    const notification = this.createNotification(message, type);
    document.body.appendChild(notification);
    
    // 애니메이션으로 표시
    requestAnimationFrame(() => {
      notification.classList.add('notification-show');
    });
    
    // 자동 제거
    setTimeout(() => {
      notification.classList.add('notification-hide');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, duration);
  }

  createNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    };
    
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <span class="notification-message">${this.escapeHtml(message)}</span>
        <button class="notification-close" onclick="this.parentNode.parentNode.remove()">×</button>
      </div>
    `;
    
    return notification;
  }

  showSuccessNotification(message) {
    this.showNotification(message, 'success');
  }

  showWarningNotification(message) {
    this.showNotification(message, 'warning');
  }

  showErrorNotification(message) {
    this.showNotification(message, 'error');
  }

  showInfoNotification(message) {
    this.showNotification(message, 'info');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 아이템 시스템
  // ═══════════════════════════════════════════════════════════════════════

  showItemSelection() {
    const availableItems = this.getUsableItems();
    
    if (availableItems.length === 0) {
      this.showWarningNotification('사용 가능한 아이템이 없습니다');
      return;
    }
    
    this.createItemSelectionModal(availableItems);
  }

  getUsableItems() {
    const i기',
        count: this.character.items.defenseBoost
      });
    }
    
    return items;
  }

  createItemSelectionModal(items) {
    const modal = document.createElement('div');
    modal.className = 'item-selection-modal';
    
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>아이템 선택</h3>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="item-selection-grid">
            ${items.map(item => `
              <div class="item-option" data-item-type="${item.type}">
                <div class="item-icon">${item.icon}</div>
                <div class="item-details">
                  <div class="item-name">${item.name}</div>
                  <div class="item-description">${item.description}</div>
                  <div class="item-count">보유: ${item.count}개</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary modal-cancel">취소</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 이벤트 리스너
    modal.querySelector('.modal-close').addEventListener('click', () => this.closeItemModal(modal));
    modal.querySelector('.modal-cancel').addEventListener('click', () => this.closeItemModal(modal));
    modal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeItemModal(modal));
    
    items.forEach(item => {
      const itemOption = modal.querySelector(`[data-item-type="${item.type}"]`);
      itemOption.addEventListener('click', () => {
        this.useItem(item.type);
        this.closeItemModal(modal);
      });
    });
    
    // 애니메이션
    requestAnimationFrame(() => {
      modal.classList.add('modal-show');
    });
  }

  closeItemModal(modal) {
    modal.classList.add('modal-hide');
    setTimeout(() => {
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
    }, 300);
  }

  useItem(itemType) {
    if (this.character.items[itemType] <= 0) {
      this.showWarningNotification('해당 아이템이 없습니다');
      return;
    }
    
    // 아이템 사용
    this.character.items[itemType]--;
    this.executeAction('item', itemType);
    
    // UI 업데이트
    this.updateItemsDisplay();
    
    const itemNames = {
      dittany: '디터니',
      attackBoost: '공격 보정기',
      defenseBoost: '방어 보정기'
    };
    
    this.logBattleEvent(`${itemNames[itemType]}을(를) 사용했습니다`, 'action');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 애니메이션 시스템
  // ═══════════════════════════════════════════════════════════════════════

  initializeAnimations() {
    // 페이지 로드 애니메이션
    this.animatePageLoad();
    
    // 주기적 UI 애니메이션
    this.startUIAnimations();
  }

  animatePageLoad() {
    // 헤더 애니메이션
    const header = document.querySelector('.header');
    if (header) {
      header.style.opacity = '0';
      header.style.transform = 'translateY(-20px)';
      
      setTimeout(() => {
        header.style.transition = 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
        header.style.opacity = '1';
        header.style.transform = 'translateY(0)';
      }, 200);
    }
    
    // 인증 섹션 애니메이션
    if (this.authSection) {
      this.authSection.style.opacity = '0';
      this.authSection.style.transform = 'scale(0.9)';
      
      setTimeout(() => {
        this.authSection.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        this.authSection.style.opacity = '1';
        this.authSection.style.transform = 'scale(1)';
      }, 600);
    }
  }

  startUIAnimations() {
    // 연결 상태 점멸 애니메이션
    if (this.connectionDot) {
      setInterval(() => {
        if (this.playerData.isConnected) {
          this.connectionDot.style.animation = 'pulse 2s infinite';
        } else {
          this.connectionDot.style.animation = 'blink 1s infinite';
        }
      }, 1000);
    }
    
    // 턴 표시 애니메이션
    this.setupTurnAnimations();
  }

  setupTurnAnimations() {
    if (!this.turnIndicator) return;
    
    const observer = new MutationObserver(() => {
      if (this.battleState.myTurn) {
        this.turnIndicator.classList.add('my-turn-active');
        this.pulseActionButtons();
      } else {
        this.turnIndicator.classList.remove('my-turn-active');
      }
    });
    
    observer.observe(this.turnIndicator, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  pulseActionButtons() {
    [this.actionAttack, this.actionDefend, this.actionDodge, this.actionItem, this.actionPass]
      .forEach(btn => {
        if (btn && !btn.disabled) {
          btn.classList.add('btn-pulse');
          setTimeout(() => btn.classList.remove('btn-pulse'), 2000);
        }
      });
  }

  animateHPChange(oldHP, newHP) {
    const hpElement = this.myPlayerHp;
    if (!hpElement) return;
    
    // HP 변화 애니메이션
    const change = newHP - oldHP;
    
    if (change !== 0) {
      const changeElement = document.createElement('div');
      changeElement.className = `hp-change ${change > 0 ? 'hp-heal' : 'hp-damage'}`;
      changeElement.textContent = change > 0 ? `+${change}` : `${change}`;
      
      hpElement.parentNode.appendChild(changeElement);
      
      setTimeout(() => {
        changeElement.remove();
      }, 2000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 유틸리티 함수들
  // ═══════════════════════════════════════════════════════════════════════

  getElement(selector) {
    return document.querySelector(selector);
  }

  showElement(element) {
    if (element) {
      element.style.display = 'block';
    }
  }

  hideElement(element) {
    if (element) {
      element.style.display = 'none';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  showLoadingState(message = '로딩 중...') {
    // 로딩 오버레이 표시
    let loadingOverlay = document.querySelector('.loading-overlay');
    if (!loadingOverlay) {
      loadingOverlay = document.createElement('div');
      loadingOverlay.className = 'loading-overlay';
      loadingOverlay.innerHTML = `
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">${message}</div>
        </div>
      `;
      document.body.appendChild(loadingOverlay);
    } else {
      loadingOverlay.querySelector('.loading-text').textContent = message;
    }
    
    loadingOverlay.style.display = 'flex';
  }

  hideLoadingState() {
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
  }

  handleWindowResize() {
    // 모바일 대응 및 UI 조정
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
      document.body.classList.add('mobile-layout');
    } else {
      document.body.classList.remove('mobile-layout');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 정리 및 종료
  // ═══════════════════════════════════════════════════════════════════════

  cleanup() {
    // 타이머 정리
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.battleState.turnTimer) {
      clearTimeout(this.battleState.turnTimer);
    }
    
    // 소켓 연결 해제
    if (this.socket) {
      this.socket.disconnect();
    }
    
    // 이벤트 리스너 정리
    document.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('resize', this.resizeHandler);
    
    console.log('PYXIS 플레이어 시스템 정리 완료');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 디버깅 및 개발자 도구
  // ═══════════════════════════════════════════════════════════════════════

  enableDebugMode() {
    if (window.location.hostname !== 'localhost') return;
    
    window.PyxisPlayerDebug = {
      player: this,
      simulateTurn: () => {
        this.battleState.myTurn = true;
        this.battleState.canAct = true;
        this.enableActionButtons();
        this.updateTurnStatus('디버그: 당신의 턴입니다', 'success');
      },
      simulateHPChange: (newHP) => {
        const oldHP = this.character.status.hp;
        this.character.status.hp = Math.max(0, Math.min(newHP, this.character.status.maxHp));
        this.updatePlayerInfo();
        this.animateHPChange(oldHP, this.character.status.hp);
      },
      addTestMessage: (message) => {
        this.logBattleEvent(message, 'info');
      }
    };
    
    console.log('디버그 모드 활성화: window.PyxisPlayerDebug 사용 가능');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 전역 초기화 및 이벤트 바인딩
// ═══════════════════════════════════════════════════════════════════════

// 전역 플레이어 인스턴스 생성
let playerInterface = null;

// DOM 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => {
  playerInterface = new PyxisPlayerInterface();
  
  // 개발 환경에서 디버그 모드 활성화
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    playerInterface.enableDebugMode();
  }
  
  console.log('PYXIS 플레이어 인터페이스 로드 완료');
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (playerInterface) {
    playerInterface.cleanup();
  }
});

// 전역 접근을 위한 익스포트
window.PyxisPlayer = {
  getInstance: () => playerInterface,
  version: '2.0.0',
  build: 'PYXIS-PLAYER-REFINED'
};
