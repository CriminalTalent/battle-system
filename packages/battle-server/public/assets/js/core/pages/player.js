// PYXIS Player Page - 플레이어 페이지 로직
class PyxisPlayer {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.myPlayerId = null;
    this.myPlayerData = null;
    this.joined = false;

    this.init();
  }

  // 초기화
  init() {
    console.log('[Player] Initializing');
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

    this.playerInfoBar = UI.$('#playerInfoBar');
    this.playerNameEl = UI.$('#playerName');
    this.playerTeamEl = UI.$('#playerTeam');
    this.turnStatus = UI.$('#turnStatus');
    this.gameHint = UI.$('#gameHint');

    this.btnAttack = UI.$('#btnAttack');
    this.btnDefend = UI.$('#btnDefend');
    this.btnDodge = UI.$('#btnDodge');
    this.btnUseItem = UI.$('#btnUseItem');
    this.btnPass = UI.$('#btnPass');

    this.battleLog = UI.$('#battleLog');
    this.chatInput = UI.$('#chatInput');
    this.btnChatSend = UI.$('#chatSend');
    this.chatMessages = UI.$('#chatMessages');

    this.targetOverlay = UI.$('#targetOverlay');
    this.targetTitle = UI.$('#targetTitle');
    this.targetList = UI.$('#targetList');
    this.cancelTarget = UI.$('#cancelTarget');

    this.allyUnits = UI.$('#allyUnits');
  }

  // 이벤트 리스너
  setupEventListeners() {
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.authenticate();
    });

    this.btnAttack.addEventListener('click', () => this.doAttack());
    this.btnDefend.addEventListener('click', () => this.doDefend());
    this.btnDodge.addEventListener('click', () => this.doDodge());
    this.btnUseItem.addEventListener('click', () => this.doUseItem());
    this.btnPass.addEventListener('click', () => this.doPass());

    this.btnChatSend.addEventListener('click', () => this.sendChat());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    this.cancelTarget.addEventListener('click', () => this.hideTargets());

    // 단축키
    document.addEventListener('keydown', (e) => {
      if (!this.isMyTurn()) return;
      if (this.targetOverlay.style.display === 'flex') return;
      switch (e.key) {
        case '1': this.doAttack(); break;
        case '2': this.doDefend(); break;
        case '3': this.doDodge(); break;
        case '4': this.doUseItem(); break;
        case '5': this.doPass(); break;
      }
    });
  }

  // 소켓 이벤트
  setupSocketEvents() {
    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (m) => UI.error(`인증 실패: ${m}`));
    PyxisSocket.on('state:update', (s) => this.handleStateUpdate(s));
    PyxisSocket.on('chat:new', (m) => this.handleChat(m));
    PyxisSocket.on('log:new', (e) => this.addLogEntry(e.text, 'system'));
    PyxisSocket.on('actionError', (m) => UI.error(`행동 실패: ${m}`));
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
      await PyxisSocket.authenticate('player', {
        battleId, otp: token, name, playerId: name
      });
    } catch (e) {
      UI.error(e.message);
    }
  }

  handleAuthSuccess(data) {
    this.joined = true;
    this.currentBattleId = data.battleId;
    this.myPlayerId = data.selfPid || data.playerId;
    this.battleState = data.state;
    this.myPlayerData = this.battleState?.players?.[this.myPlayerId] || null;
    UI.success('전투 입장 성공');
    this.render();
  }

  handleStateUpdate(state) {
    this.battleState = state;
    if (this.myPlayerId) {
      this.myPlayerData = state.players?.[this.myPlayerId] || this.myPlayerData;
    }
    this.render();
  }

  // 턴 확인
  isMyTurn() {
    const actor = this.battleState?.turn?.actor;
    return actor === this.myPlayerId && this.myPlayerData?.alive !== false;
  }

  // 행동 전송
  async sendAction(type, payload = {}) {
    try {
      await PyxisSocket.sendAction({ type, ...payload }, this.currentBattleId, this.myPlayerId);
    } catch (e) {
      UI.error(`행동 실패: ${e.message}`);
    }
  }

  // 공격
  doAttack() {
    const enemies = this.getEnemies();
    if (!enemies.length) return UI.error('공격 대상 없음');
    this.showTargets('공격 대상 선택', enemies, (t) =>
      this.sendAction('attack', { targetPid: t.id })
    );
  }

  doDefend() { this.sendAction('defend'); }
  doDodge() { this.sendAction('evade'); }

  doUseItem() {
    const items = ['디터니', '공격 보정기', '방어 보정기'];
    const pick = prompt(`아이템 선택:\n${items.join(', ')}`);
    if (!pick) return;
    if (pick === '디터니') {
      const allies = this.getAllies();
      if (!allies.length) return UI.error('아군 없음');
      this.showTargets('회복 대상', allies, (t) =>
        this.sendAction('useItem', { item: '디터니', targetPid: t.id })
      );
    } else if (pick === '공격 보정기' || pick === '방어 보정기') {
      this.sendAction('useItem', { item: pick, targetPid: this.myPlayerId });
    }
  }

  doPass() {
    if (confirm('턴을 넘기시겠습니까?')) this.sendAction('pass');
  }

  // 타겟 UI
  showTargets(title, list, cb) {
    this.targetTitle.textContent = title;
    this.targetList.innerHTML = '';
    list.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'target-card';
      d.innerHTML = `<div>${p.name}</div><div>HP ${p.hp}/${p.maxHp || 100}</div>`;
      d.onclick = () => {
        this.hideTargets();
        cb(p);
      };
      this.targetList.appendChild(d);
    });
    this.targetOverlay.style.display = 'flex';
  }
  hideTargets() { this.targetOverlay.style.display = 'none'; }

  getEnemies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    return Object.values(this.battleState.players).filter((p) => {
      const myTeamA = this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1';
      const pTeamA = p.team === 'A' || p.team === 'team1';
      return myTeamA !== pTeamA && p.alive !== false;
    });
  }

  getAllies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    return Object.values(this.battleState.players).filter((p) => {
      const myTeamA = this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1';
      const pTeamA = p.team === 'A' || p.team === 'team1';
      return myTeamA === pTeamA && p.alive !== false;
    });
  }

  // 채팅
  sendChat() {
    const text = this.chatInput.value.trim();
    if (!text) return;
    PyxisSocket.sendChat({
      battleId: this.currentBattleId,
      text,
      nickname: this.myPlayerData?.name || '플레이어',
      role: 'player',
      scope: 'all'
    });
    this.chatInput.value = '';
  }

  handleChat(m) {
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `<span class="chat-time">${UI.formatTime(Date.now())}</span>
      <span class="chat-content">[${m.scope || '전체'}] ${m.nickname}: ${m.text}</span>`;
    this.chatMessages.appendChild(el);
    UI.scrollToBottom(this.chatMessages);
  }

  addLogEntry(content, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerHTML = `<span class="log-time">${UI.formatTime(Date.now())}</span>
      <span class="log-content">${content}</span>`;
    this.battleLog.appendChild(el);
    UI.scrollToBottom(this.battleLog);
  }

  render() {
    if (!this.battleState || !this.myPlayerData) return;
    this.playerNameEl.textContent = this.myPlayerData.name;
    this.playerTeamEl.textContent = UI.getTeamName(this.myPlayerData.team);
    this.turnStatus.textContent = this.isMyTurn() ? '내 턴' : '대기';
    this.turnStatus.classList.toggle('active', this.isMyTurn());
  }

  cleanup() { PyxisSocket.cleanup(); }
}

document.addEventListener('DOMContentLoaded', () => { window.player = new PyxisPlayer(); });
window.addEventListener('beforeunload', () => { if (window.player) window.player.cleanup(); });
