// packages/battle-server/public/assets/js/core/pages/player.js
// PYXIS 플레이어 인터페이스 - 몰입감 있는 실시간 전투 시스템

class PyxisPlayerInterface {
  constructor() {
    this.state = {
      battleId: null,
      playerId: null,
      playerName: null,
      playerOtp: null,
      team: null,
      role: 'player',
      isAuthenticated: false,
      battleStatus: 'waiting',
      currentTurn: 1,
      currentTeam: null,
      currentPhase: 'waiting',
      isMyTurn: false,
      canAct: false,
      turnTimeLimit: 5 * 60 * 1000,
      turnStartTime: null,
      myPlayer: null,
      allPlayers: [],
      teammates: [],
      enemies: [],
      selectedAction: null,
      targetSelectionMode: false,
      availableTargets: [],
      actionInProgress: false
    };

    this.elements = {};
    this.turnTimer = null;
    this.battleTimer = null;
    this.socket = null;

    // WebSocket reconnect 관련
    this.reconnectAttempts = 0;
    this.reconnectDelay = 2000;

    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    this.setupKeyboardShortcuts();
    await this.initFromUrl();
    await this.connectSocket();
  }

  cacheElements() {
    this.elements = {
      authSection: document.querySelector('#authSection'),
      battleSection: document.querySelector('#battleSection'),
      authForm: document.querySelector('#authForm'),
      battleIdInput: document.querySelector('#battleId'),
      playerNameInput: document.querySelector('#playerName'),
      playerOtpInput: document.querySelector('#playerOtp'),
      authMessage: document.querySelector('#authMessage'),
      myPlayerCard: document.querySelector('#myPlayerCard'),
      myAvatar: document.querySelector('#myAvatar'),
      myName: document.querySelector('#myName'),
      myTeam: document.querySelector('#myTeam'),
      myHp: document.querySelector('#myHp'),
      myHpBar: document.querySelector('#myHpBar'),
      myStats: document.querySelector('#myStats'),
      teammatesList: document.querySelector('#teammatesList'),
      battleInfo: document.querySelector('#battleInfo'),
      turnIndicator: document.querySelector('#turnIndicator'),
      turnTimer: document.querySelector('#turnTimer'),
      battleTimer: document.querySelector('#battleTimer'),
      currentPhase: document.querySelector('#currentPhase'),
      actionPanel: document.querySelector('#actionPanel'),
      actionButtons: document.querySelectorAll('.action-btn'),
      attackBtn: document.querySelector('#attackBtn'),
      defendBtn: document.querySelector('#defendBtn'),
      dodgeBtn: document.querySelector('#dodgeBtn'),
      itemBtn: document.querySelector('#itemBtn'),
      passBtn: document.querySelector('#passBtn'),
      targetModal: document.querySelector('#targetModal'),
      targetList: document.querySelector('#targetList'),
      targetConfirm: document.querySelector('#targetConfirm'),
      targetCancel: document.querySelector('#targetCancel'),
      itemModal: document.querySelector('#itemModal'),
      itemList: document.querySelector('#itemList'),
      dittanyBtn: document.querySelector('#dittanyBtn'),
      attackBoostBtn: document.querySelector('#attackBoostBtn'),
      defenseBoostBtn: document.querySelector('#defenseBoostBtn'),
      battleLog: document.querySelector('#battleLog'),
      chatMessages: document.querySelector('#chatMessages'),
      chatInput: document.querySelector('#chatInput'),
      chatSend: document.querySelector('#chatSend'),
      channelBtns: document.querySelectorAll('.channel-btn')
    };
  }

  bindEvents() {
    this.elements.authForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAuth();
    });

    this.elements.attackBtn?.addEventListener('click', () => this.selectAction('attack'));
    this.elements.defendBtn?.addEventListener('click', () => this.selectAction('defend'));
    this.elements.dodgeBtn?.addEventListener('click', () => this.selectAction('dodge'));
    this.elements.itemBtn?.addEventListener('click', () => this.showItemSelection());
    this.elements.passBtn?.addEventListener('click', () => this.selectAction('pass'));

    this.elements.targetConfirm?.addEventListener('click', () => this.confirmAction());
    this.elements.targetCancel?.addEventListener('click', () => this.cancelTargetSelection());

    this.elements.chatSend?.addEventListener('click', () => this.sendChatMessage());
    this.elements.chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChatMessage();
      }
    });

    this.elements.channelBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.elements.channelBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.addEventListener('click', (e) => {
      if (e.target === this.elements.targetModal) {
        this.cancelTargetSelection();
      }
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (document.activeElement === this.elements.chatInput) return;
      if (this.state.targetSelectionMode) return;

      switch (e.key) {
        case '1': e.preventDefault(); this.selectAction('attack'); break;
        case '2': e.preventDefault(); this.selectAction('defend'); break;
        case '3': e.preventDefault(); this.selectAction('dodge'); break;
        case '4': e.preventDefault(); this.showItemSelection(); break;
        case '5': e.preventDefault(); this.selectAction('pass'); break;
        case 'Escape': e.preventDefault(); this.cancelTargetSelection(); break;
      }
    });
  }

  async initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    this.state.battleId = params.get('battleId');
    this.state.playerName = params.get('name');
    this.state.playerOtp = params.get('otp');

    if (this.state.battleId && this.state.playerName && this.state.playerOtp) {
      await this.authenticatePlayer();
    }
  }

  async connectSocket() {
    if (typeof io === 'undefined') {
      console.error('[Player] Socket.IO not loaded');
      return;
    }

    const connect = () => {
      this.socket = io({ reconnection: false });

      this.socket.on('connect', () => {
        console.log('[Player] Socket connected');
        this.reconnectAttempts = 0;
        if (this.state.isAuthenticated) {
          this.initSession();
        }
      });

      this.socket.on('disconnect', () => {
        console.warn('[Player] Socket disconnected');
        this.showMessage('연결이 끊어졌습니다. 재연결 시도 중...', 'warning');
        this.scheduleReconnect();
      });

      // ... 기존 socket.on 핸들러들 (auth, state, log, battle, turn, chat 등) 그대로 유지 ...
    };

    this.scheduleReconnect = () => {
      if (this.reconnectAttempts >= 10) {
        console.error('[Player] 최대 재연결 시도 초과');
        this.showMessage('재연결 실패. 페이지를 새로고침 해주세요.', 'error');
        return;
      }

      this.reconnectAttempts += 1;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(`[Player] 재연결 시도 #${this.reconnectAttempts} (delay ${delay}ms)`);

      setTimeout(() => {
        connect();
      }, delay);
    };

    connect();
  }

  initSession() {
    this.socket.emit('session:init', {
      role: 'player',
      battleId: this.state.battleId,
      otp: this.state.playerOtp,
      playerName: this.state.playerName
    });
  }

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
    this.state.isAuthenticated = true;
    this.state.playerId = data.playerId;
    this.state.team = data.team;
    this.showMessage('인증 성공!', 'success');

    this.elements.authSection?.classList.add('hidden');
    this.elements.battleSection?.classList.remove('hidden');

    this.initSession();
  }

  // ... 이하 기존 기능들 그대로 유지 (updateGameState, updatePlayerInfo, updateBattleInfo, actions, log, chat 등) ...

  destroy() {
    if (this.turnTimer) clearInterval(this.turnTimer);
    if (this.battleTimer) clearInterval(this.battleTimer);
    if (this.socket) this.socket.disconnect();
    console.log('[Player] Interface destroyed');
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.pyxisPlayer = new PyxisPlayerInterface();
});

window.addEventListener('beforeunload', () => {
  window.pyxisPlayer?.destroy();
});
