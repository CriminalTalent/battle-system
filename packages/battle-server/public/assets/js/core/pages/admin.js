// PYXIS Admin Page - 관리자 페이지 로직
class PyxisAdmin {
  constructor() {
    this.currentBattleId = null;
    this.adminOtp = null;
    this.spectatorOtp = null;
    this.battleState = null;
    this.isConnected = false;

    this.init();
  }

  // 초기화
  init() {
    console.log('[Admin] Initializing admin page');
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    if (!window.PyxisSocket) {
      console.error('[Admin] PyxisSocket not found');
      UI.error('소켓 초기화 실패');
      return;
    }
    PyxisSocket.init();
  }

  // DOM 요소
  setupElements() {
    this.battleCreateForm = UI.$('#battleCreateForm');
    this.battleMode = UI.$('#battleMode'); // 토글
    this.battleInfo = UI.$('#battleInfo');
    this.battleIdDisplay = UI.$('#battleIdDisplay');
    this.adminOtpDisplay = UI.$('#adminOtpDisplay');
    this.spectatorOtpDisplay = UI.$('#spectatorOtpDisplay');

    this.statusDot = UI.$('#statusDot');
    this.statusText = UI.$('#statusText');

    this.btnConnect = UI.$('#btnConnect');
    this.btnStartBattle = UI.$('#btnStartBattle');
    this.btnEndBattle = UI.$('#btnEndBattle');

    this.linksSection = UI.$('#linksSection');
    this.linksList = UI.$('#linksList');

    this.playerAddForm = UI.$('#playerAddForm');
    this.playerName = UI.$('#playerName');
    this.playerTeam = UI.$('#playerTeam');
    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');
    this.itemHealing = UI.$('#itemHealing');
    this.itemAttackBoost = UI.$('#itemAttackBoost');
    this.itemDefenseBoost = UI.$('#itemDefenseBoost');

    this.team1Roster = UI.$('#team1Roster');
    this.team2Roster = UI.$('#team2Roster');

    this.logViewer = UI.$('#logViewer');
    this.chatInput = UI.$('#chatInput');
    this.btnSendChat = UI.$('#btnSendChat');
  }

  // 이벤트 리스너
  setupEventListeners() {
    this.battleCreateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createBattle();
    });

    this.btnConnect.addEventListener('click', () => this.connectAsAdmin());
    this.btnStartBattle.addEventListener('click', () => this.startBattle());
    this.btnEndBattle.addEventListener('click', () => this.endBattle());

    this.playerAddForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addPlayer();
    });

    this.btnSendChat.addEventListener('click', () => this.sendChat());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    window.addEventListener('popstate', () => this.initFromUrl());
  }

  // 소켓 이벤트
  setupSocketEvents() {
    PyxisSocket.on('connection:success', () => UI.success('서버에 연결됨'));
    PyxisSocket.on('connection:disconnect', () => UI.error('서버 연결 끊김'));
    PyxisSocket.on('connection:error', ({ error }) => UI.error(`연결 실패: ${error.message}`));

    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (msg) => UI.error(`인증 실패: ${msg}`));

    PyxisSocket.on('state:update', (s) => this.handleStateUpdate(s));
    PyxisSocket.on('state', (s) => this.handleStateUpdate(s));

    PyxisSocket.on('chat:new', (m) => this.handleChatMessage(m));
    PyxisSocket.on('log:new', (e) => this.addLogEntry(e.text, 'system'));
  }

  // URL 파라미터
  initFromUrl() {
    const url = new URL(window.location.href);
    const battle = url.searchParams.get('battle');
    const token = url.searchParams.get('token');
    if (battle && token) {
      this.currentBattleId = battle;
      this.adminOtp = token;
      this.battleIdDisplay.textContent = battle;
      this.adminOtpDisplay.textContent = token;
      UI.show(this.battleInfo);
    }
  }

  // 전투 생성
  async createBattle() {
    const mode = this.battleMode.value; // 1v1 / 2v2 / 3v3 / 4v4
    try {
      const result = await PyxisSocket.apiCall('/api/admin/battles', {
        method: 'POST',
        body: JSON.stringify({ mode })
      });
      if (!result?.ok) throw new Error(result?.msg || '전투 생성 실패');

      this.currentBattleId = result.battleId;
      this.adminOtp = result.adminOtp;
      this.spectatorOtp = result.spectatorOtp;

      this.battleIdDisplay.textContent = result.battleId;
      this.adminOtpDisplay.textContent = this.adminOtp;
      this.spectatorOtpDisplay.textContent = this.spectatorOtp;

      UI.show(this.battleInfo);
      UI.show(this.linksSection);
      this.addLogEntry('전투 생성 완료', 'system');
    } catch (e) {
      console.error('[Admin] createBattle', e);
      UI.error(e.message);
    }
  }

  // 관리자로 인증
  async connectAsAdmin() {
    if (!this.currentBattleId || !this.adminOtp) {
      UI.error('전투 ID/관리자 OTP 없음');
      return;
    }
    try {
      await PyxisSocket.authenticate('admin', {
        battleId: this.currentBattleId,
        otp: this.adminOtp
      });
    } catch (e) {
      UI.error(`관리자 로그인 실패: ${e.message}`);
    }
  }

  // 인증 성공
  handleAuthSuccess(data) {
    this.isConnected = true;
    this.battleState = data.state;
    this.addLogEntry('관리자 로그인 성공', 'system');
    this.renderBattleState();
  }

  // 상태 업데이트
  handleStateUpdate(state) {
    this.battleState = state;
    this.renderBattleState();
  }

  renderBattleState() {
    if (!this.battleState) return;
    this.renderRoster();
  }

  // 플레이어 추가
  async addPlayer() {
    const name = this.playerName.value.trim();
    if (!name) {
      UI.error('플레이어 이름 필요');
      return;
    }
    const data = {
      adminOtp: this.adminOtp,
      name,
      team: this.playerTeam.value,
      atk: Math.min(5, parseInt(this.statAttack.value) || 3),
      def: Math.min(5, parseInt(this.statDefense.value) || 3),
      agi: Math.min(5, parseInt(this.statAgility.value) || 3),
      luk: Math.min(5, parseInt(this.statLuck.value) || 3),
      items: {
        dittany: parseInt(this.itemHealing.value) || 0,
        atkBoost: parseInt(this.itemAttackBoost.value) || 0,
        defBoost: parseInt(this.itemDefenseBoost.value) || 0
      }
    };
    try {
      const res = await PyxisSocket.apiCall(`/api/admin/battles/${this.currentBattleId}/players`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      if (!res?.ok) throw new Error(res?.msg || '플레이어 추가 실패');
      this.addLogEntry(`플레이어 ${name} 추가됨`, 'system');
      this.playerAddForm.reset();
    } catch (e) {
      UI.error(e.message);
    }
  }

  renderRoster() {
    this.team1Roster.innerHTML = '';
    this.team2Roster.innerHTML = '';
    const teamA = this.battleState?.teams?.find((t) => t.side === 'A');
    const teamB = this.battleState?.teams?.find((t) => t.side === 'B');
    if (teamA) teamA.players.forEach((p) => this.team1Roster.appendChild(this.createPlayerCard(p)));
    if (teamB) teamB.players.forEach((p) => this.team2Roster.appendChild(this.createPlayerCard(p)));
  }

  createPlayerCard(player) {
    const div = document.createElement('div');
    div.className = 'player-card';
    div.innerHTML = `
      <div class="player-name">${player.name}</div>
      <div class="player-stats">공격 ${player.atk} · 방어 ${player.def} · 민첩 ${player.agi} · 행운 ${player.luk}</div>
    `;
    return div;
  }

  // 전투 시작
  async startBattle() {
    try {
      const res = await PyxisSocket.apiCall(`/api/admin/battles/${this.currentBattleId}/start`, {
        method: 'POST',
        body: JSON.stringify({ adminOtp: this.adminOtp })
      });
      if (!res?.ok) throw new Error(res?.msg || '전투 시작 실패');
      this.addLogEntry('전투 시작됨', 'system');
    } catch (e) {
      UI.error(e.message);
    }
  }

  endBattle() {
    UI.info('전투 종료는 서버 자동 처리');
  }

  // 채팅
  sendChat() {
    const text = this.chatInput.value.trim();
    if (!text) return;
    PyxisSocket.sendChat({
      battleId: this.currentBattleId,
      text,
      nickname: '관리자',
      role: 'admin',
      scope: 'all'
    });
    this.chatInput.value = '';
  }

  handleChatMessage(m) {
    const content = `[${m.scope === 'team' ? '팀' : '전체'}] ${m.nickname || '익명'}: ${m.text}`;
    this.addLogEntry(content, m.role === 'admin' ? 'admin' : 'info');
  }

  addLogEntry(content, type = 'info') {
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = UI.formatTime(Date.now());
    const span = document.createElement('span');
    span.className = 'log-content';
    span.textContent = content;
    row.appendChild(time);
    row.appendChild(span);
    this.logViewer.appendChild(row);
    UI.scrollToBottom(this.logViewer);
  }

  cleanup() {
    PyxisSocket.cleanup();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.admin = new PyxisAdmin();
});
window.addEventListener('beforeunload', () => {
  if (window.admin) window.admin.cleanup();
});
