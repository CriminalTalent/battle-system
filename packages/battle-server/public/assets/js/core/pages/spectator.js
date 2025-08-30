// PYXIS Spectator Page - 관전자 페이지 로직
class PyxisSpectator {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.joined = false;

    this.init();
  }

  init() {
    console.log('[Spectator] Initializing');
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    PyxisSocket.init();
  }

  // DOM 요소
  setupElements() {
    this.authForm = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken = UI.$('#authToken');
    this.authName = UI.$('#authName');

    this.playerList = UI.$('#playerList');
    this.battleLog = UI.$('#battleLog');
    this.chatMessages = UI.$('#chatMessages');

    this.cheerButtons = document.querySelectorAll('.cheer-btn');
  }

  // 이벤트
  setupEventListeners() {
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.authenticate();
    });

    this.cheerButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sendCheer(btn.dataset.cheer);
      });
    });
  }

  // 소켓 이벤트
  setupSocketEvents() {
    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (m) => UI.error(`인증 실패: ${m}`));

    PyxisSocket.on('state:update', (s) => this.handleStateUpdate(s));

    PyxisSocket.on('chat:new', (m) => this.handleChat(m));
    PyxisSocket.on('log:new', (e) => this.addLogEntry(e.text, 'system'));
  }

  // URL 자동 인증
  initFromUrl() {
    const url = new URL(window.location.href);
    const b = url.searchParams.get('battle');
    const t = url.searchParams.get('token');
    const n = url.searchParams.get('name');
    if (b && t && n) {
      this.authBattleId.value = b;
      this.authToken.value = t;
      this.authName.value = decodeURIComponent(n);
      setTimeout(() => this.authenticate(), 300);
    }
  }

  // 인증
  async authenticate() {
    const battleId = this.authBattleId.value.trim();
    const token = this.authToken.value.trim();
    const name = this.authName.value.trim();
    if (!battleId || !token || !name) {
      UI.error('모든 항목을 입력하세요');
      return;
    }
    try {
      await PyxisSocket.authenticate('spectator', {
        battleId, otp: token, name, spectatorId: name
      });
    } catch (e) {
      UI.error(e.message);
    }
  }

  handleAuthSuccess(data) {
    this.joined = true;
    this.currentBattleId = data.battleId;
    this.battleState = data.state;
    UI.success('관전 입장 성공');
    this.render();
  }

  handleStateUpdate(state) {
    this.battleState = state;
    this.render();
  }

  // 응원 전송
  sendCheer(text) {
    if (!this.currentBattleId) return;
    PyxisSocket.sendChat({
      battleId: this.currentBattleId,
      text,
      nickname: this.authName.value || '관전자',
      role: 'spectator',
      type: 'cheer',
      scope: 'all'
    });
  }

  // 채팅 출력
  handleChat(m) {
    const el = document.createElement('div');
    el.className = `chat-message ${m.type || ''}`;
    el.innerHTML = `<span class="chat-time">${UI.formatTime(Date.now())}</span>
      <span class="chat-content">${m.type === 'cheer' ? '[응원] ' : ''}${m.nickname}: ${m.text}</span>`;
    this.chatMessages.appendChild(el);
    UI.scrollToBottom(this.chatMessages);
  }

  // 로그 출력
  addLogEntry(content, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerHTML = `<span class="log-time">${UI.formatTime(Date.now())}</span>
      <span class="log-content">${content}</span>`;
    this.battleLog.appendChild(el);
    UI.scrollToBottom(this.battleLog);
  }

  // 렌더링
  render() {
    if (!this.battleState) return;
    this.playerList.innerHTML = '';

    Object.values(this.battleState.players || {}).forEach((p) => {
      const d = document.createElement('div');
      d.className = `spectator-player ${p.alive === false ? 'defeated' : ''}`;
      d.innerHTML = `
        <div class="player-name">${p.name}</div>
        <div class="player-team">${UI.getTeamName(p.team)}</div>
        <div class="player-hp">HP: ${p.hp}/${p.maxHp || 100}</div>`;
      this.playerList.appendChild(d);
    });
  }

  cleanup() { PyxisSocket.cleanup(); }
}

document.addEventListener('DOMContentLoaded', () => { window.spectator = new PyxisSpectator(); });
window.addEventListener('beforeunload', () => { if (window.spectator) window.spectator.cleanup(); });
