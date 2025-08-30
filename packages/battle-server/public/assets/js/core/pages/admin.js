// PYXIS Admin Page - 관리자 페이지 로직 (알림 + 호환 보강)
class PyxisAdmin {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.isConnected = false;
    this.adminOtp = null;
    
    this.init();
  }

  // 초기화
  init() {
    console.log('[Admin] Initializing admin page');
    
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();
    
    // 소켓 연결
    PyxisSocket.init();

    // 알림 안내(선호 시 클릭 시점에 요청하도록 유지)
    UI?.info?.('브라우저 알림을 허용하면 탭 밖에서도 전투 알림을 받을 수 있어요.');
  }

  // DOM 요소 설정
  setupElements() {
    // 폼 요소들
    this.battleCreateForm = UI.$('#battleCreateForm');
    this.battleMode = UI.$('#battleMode');
    this.playerAddForm = UI.$('#playerAddForm');
    
    // 정보 표시
    this.battleInfo = UI.$('#battleInfo');
    this.battleIdDisplay = UI.$('#battleIdDisplay');
    this.adminOtpDisplay = UI.$('#adminOtpDisplay');
    this.spectatorOtpDisplay = UI.$('#spectatorOtpDisplay');
    
    // 상태 표시 (admin.html 구조에 맞게 보정)
    this.battleStatus = UI.$('#battleStatus');
    this.statusDot = this.battleStatus?.querySelector('.status-dot');
    this.statusText = this.battleStatus?.querySelector('span');
    
    // 제어 버튼
    this.controlActions = UI.$('#controlActions');
    this.btnConnect = UI.$('#btnConnect');
    this.btnStartBattle = UI.$('#btnStartBattle');
    this.btnPauseBattle = UI.$('#btnPauseBattle');
    this.btnEndBattle = UI.$('#btnEndBattle');
    
    // 링크 섹션
    this.linksSection = UI.$('#linksSection');
    this.linksList = UI.$('#linksList');
    this.btnGenerateLinks = UI.$('#btnGenerateLinks');
    
    // 로그 및 채팅
    this.logViewer = UI.$('#logViewer');
    this.chatChannel = UI.$('#chatChannel');
    this.chatInput = UI.$('#chatInput');
    this.btnSendChat = UI.$('#btnSendChat');
    
    // 플레이어 관리 (HTML id에 맞춰 보정)
    this.playerName = UI.$('#playerName');
    this.playerTeam = UI.$('#playerTeam');
    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');
    // 항목 id: itemDittany / itemAttackBoost / itemDefenseBoost
    this.itemHealing = UI.$('#itemDittany');
    this.itemAttackBoost = UI.$('#itemAttackBoost');
    this.itemDefenseBoost = UI.$('#itemDefenseBoost');
    
    // 로스터
    this.team1Roster = UI.$('#team1Roster');
    this.team2Roster = UI.$('#team2Roster');
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 전투 생성 폼
    this.battleCreateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createBattle();
    });

    // 제어 버튼들
    this.btnConnect.addEventListener('click', async () => {
      // 최초 클릭 시 알림 권한 요청 시도(UX 배려)
      await PyxisNotify?.requestPermission?.();
      this.connectAsAdmin();
    });
    this.btnStartBattle.addEventListener('click', () => this.startBattle());
    this.btnPauseBattle.addEventListener('click', () => this.pauseBattle());
    this.btnEndBattle.addEventListener('click', () => this.endBattle());
    
    // 링크 생성
    this.btnGenerateLinks.addEventListener('click', () => this.generateLinks());

    // 플레이어 추가 폼
    this.playerAddForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addPlayer();
    });

    // 채팅
    this.btnSendChat.addEventListener('click', () => this.sendChat());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // URL 변경 감지
    window.addEventListener('popstate', () => this.initFromUrl());
  }

  // 소켓 이벤트 설정
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      UI.success('서버에 연결되었습니다');
      PyxisNotify?.notify?.('서버 연결됨', { body: '실시간 제어가 활성화되었습니다.' });
    });

    PyxisSocket.on('connection:disconnect', ({ reason }) => {
      UI.error('서버 연결이 끊어졌습니다');
      PyxisNotify?.notifyWhenHidden?.('연결 끊김', { body: reason || '네트워크 상태를 확인하세요.' });
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      UI.error(`연결 실패: ${error?.message || '알 수 없는 오류'}`);
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      UI.info(`재연결 성공 (${attemptNumber}회 시도)`);
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => {
      this.handleAuthSuccess(data);
    });

    PyxisSocket.on('authError', (message) => {
      UI.error(`인증 실패: ${message}`);
      UI.setLoading(this.btnConnect, false);
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
      // 백그라운드 시 알림
      const preview = (message?.text || message?.message || '').slice(0, 40);
      PyxisNotify?.notifyWhenHidden?.('새 채팅', { body: `${message?.from?.nickname || message?.name || '익명'}: ${preview}` });
    });

    PyxisSocket.on('log:new', (event) => {
      this.addLogEntry(event.text || '', 'system');
      // 인상적인 키워드면 백그라운드 알림
      const t = String(event?.text || '');
      if (/치명타|격파|KO|역전/.test(t)) {
        PyxisNotify?.notifyWhenHidden?.('핵심 이벤트!', { body: t });
      }
    });

    PyxisSocket.on('phase:change', (phase) => {
      const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
    });

    PyxisSocket.on('battle:started', (data) => {
      this.addLogEntry('◆ 전투 시작', 'system');
      PyxisNotify?.notify?.('전투 시작', { body: `전투ID: ${data?.battleId || this.currentBattleId || ''}` });
    });

    PyxisSocket.on('battle:end', (result) => {
      const winnerText = result?.winner === 'draw'
        ? '무승부'
        : ((result?.winner === 'A' || result?.winner === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들');
      this.addLogEntry(`◆ 전투 종료: ${winnerText}`, 'system');
      this.updateStatus('ended');
      PyxisNotify?.notify?.('전투 종료', { body: winnerText });
    });

    // 공지
    PyxisSocket.on('notice:update', ({ text }) => {
      if (text) {
        this.addLogEntry(`공지: ${text}`, 'system');
        PyxisNotify?.notifyWhenHidden?.('공지 업데이트', { body: text });
      }
    });
  }

  // URL 파라미터에서 초기화
  initFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const battleParam = urlParams.get('battle');
    const tokenParam = urlParams.get('token');
    
    if (battleParam && tokenParam) {
      this.currentBattleId = battleParam;
      this.adminOtp = tokenParam;
      
      this.battleIdDisplay.textContent = battleParam;
      this.adminOtpDisplay.textContent = tokenParam;
      
      UI.show(this.battleInfo);
      UI.show(this.controlActions);
      UI.show(this.linksSection);
      
      // 자동 연결 시도
      setTimeout(() => this.connectAsAdmin(), 400);
    }
  }

  // 전투 생성
  async createBattle() {
    const mode = this.battleMode.value;
    
    UI.setLoading(this.battleCreateForm.querySelector('button[type="submit"]'), true);
    
    try {
      const result = await PyxisSocket.apiCall('/api/admin/battles', {
        method: 'POST',
        body: JSON.stringify({ mode })
      });
      
      if (!result?.ok) {
        throw new Error(result?.msg || '전투 생성 실패');
      }

      this.currentBattleId = result.battleId;
      // 서버 응답 키 보정(adminOtp / spectatorOtp)
      this.adminOtp = result.adminOtp || result.adminOTP;
      
      this.battleIdDisplay.textContent = result.battleId;
      this.adminOtpDisplay.textContent = this.adminOtp || '-';
      this.spectatorOtpDisplay.textContent = result.spectatorOtp || result.spectatorOTP || '';
      
      UI.show(this.battleInfo);
      UI.show(this.controlActions);
      UI.show(this.linksSection);
      
      this.addLogEntry('전투가 성공적으로 생성되었습니다', 'system');
      UI.success('전투가 생성되었습니다!');
      
      // URL 업데이트
      const url = new URL(window.location);
      url.searchParams.set('battle', result.battleId);
      if (this.adminOtp) url.searchParams.set('token', this.adminOtp);
      window.history.pushState({}, '', url);

      // 권한 요청 유도(클릭 이벤트에서 한 번 더 시도됨)
      await PyxisNotify?.requestPermission?.();
      
    } catch (error) {
      console.error('[Admin] Battle creation failed:', error);
      UI.error(error.message || '전투 생성 실패');
    } finally {
      UI.setLoading(this.battleCreateForm.querySelector('button[type="submit"]'), false);
    }
  }

  // 관리자로 연결
  async connectAsAdmin() {
    if (!this.currentBattleId || !this.adminOtp) {
      UI.error('전투 ID와 관리자 OTP가 필요합니다');
      return;
    }

    UI.setLoading(this.btnConnect, true);

    try {
      // 소켓 매니저 호환: authenticateAsAdmin 사용
      await PyxisSocket.authenticateAsAdmin(this.currentBattleId, this.adminOtp);
      // 성공 처리는 authSuccess 이벤트에서
    } catch (error) {
      console.error('[Admin] Auth failed:', error);
      UI.error(`관리자 로그인 실패: ${error.message}`);
      UI.setLoading(this.btnConnect, false);
    }
  }

  // 인증 성공 처리
  handleAuthSuccess(data) {
    console.log('[Admin] Auth success:', data);
    
    this.isConnected = true;
    this.battleState = data.state || data.battle;
    
    UI.setLoading(this.btnConnect, false);
    UI.showFeedback(this.btnConnect, 'success');
    
    this.btnConnect.textContent = '로그인 완료';
    this.addLogEntry('관리자 권한으로 로그인되었습니다', 'system');
    UI.success('관리자 로그인 성공!');
    
    this.renderBattleState();
  }

  // 상태 업데이트 처리
  handleStateUpdate(state) {
    // console.log('[Admin] State update:', state);
    this.battleState = state || this.battleState;
    this.renderBattleState();
  }

  // 전투 상태 렌더링
  renderBattleState() {
    if (!this.battleState) return;

    this.updateStatus(this.battleState.status);
    this.renderRoster();
  }

  // 상태 업데이트
  updateStatus(status) {
    const statusMap = {
      'lobby': { text: '대기중', class: 'waiting' },
      'waiting': { text: '대기중', class: 'waiting' },
      'active': { text: '진행중', class: 'active' },
      'ongoing': { text: '진행중', class: 'active' },
      'ended': { text: '종료됨', class: 'ended' }
    };

    const info = statusMap[status] || statusMap.waiting;
    if (this.statusText) this.statusText.textContent = info.text;
    if (this.statusDot) this.statusDot.className = `status-dot ${info.class}`;
  }

  // 로스터 렌더링
  renderRoster() {
    if (!this.battleState?.teams) return;

    this.team1Roster.innerHTML = '';
    this.team2Roster.innerHTML = '';

    // 팀 A (불사조 기사단)
    const teamA = this.battleState.teams.find(t => t.side === 'A' || t.side === 'team1');
    if (teamA?.players) {
      teamA.players.forEach(player => {
        this.team1Roster.appendChild(this.createPlayerCard(player));
      });
    }

    // 팀 B (죽음을 먹는 자들)
    const teamB = this.battleState.teams.find(t => t.side === 'B' || t.side === 'team2');
    if (teamB?.players) {
      teamB.players.forEach(player => {
        this.team2Roster.appendChild(this.createPlayerCard(player));
      });
    }
  }

  // 플레이어 카드 생성
  createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card enhance-hover';
    
    const maxHp = player.maxHp || 1000 || 100;
    const hpPercent = UI.calculateHpPercent(player.hp, maxHp);
    
    // 상태 키 호환(atk/def/agi/luk or stats)
    const atk = player.atk ?? player.stats?.attack ?? 0;
    const def = player.def ?? player.stats?.defense ?? 0;
    const agi = player.agi ?? player.stats?.agility ?? 0;
    const luk = player.luk ?? player.stats?.luck ?? 0;

    const items = player.items || {};
    const dittany = items.dittany ?? 0;
    const atkBoost = items.atkBoost ?? 0;
    const defBoost = items.defBoost ?? 0;
    
    card.innerHTML = `
      <div class="player-avatar" ${player.avatar ? `style="background-image:url(${player.avatar})"` : ''}></div>
      <div class="player-info">
        <div class="player-name">${player.name}${(player.hp ?? 1) <= 0 ? ' (불능)' : ''}</div>
        <div class="player-stats">공격 ${atk} · 방어 ${def} · 민첩 ${agi} · 행운 ${luk}</div>
        <div class="player-hp">
          <div class="player-hp-fill" style="width:${hpPercent}%"></div>
        </div>
        <div class="player-items">아이템: 디터니 ${dittany}, 공격보정 ${atkBoost}, 방어보정 ${defBoost}</div>
      </div>
      <div class="player-actions">
        <button class="btn btn-danger" onclick="admin.removePlayer('${player.id}')" ${this.battleState?.status !== 'waiting' ? 'disabled' : ''}>제거</button>
      </div>
    `;
    
    return card;
  }

  // 전투 시작
  async startBattle() {
    if (!this.currentBattleId || !this.adminOtp) {
      UI.error('전투를 먼저 생성하고 로그인하세요');
      return;
    }

    UI.setLoading(this.btnStartBattle, true);

    try {
      const result = await PyxisSocket.apiCall(`/api/admin/battles/${this.currentBattleId}/start`, {
        method: 'POST',
        body: JSON.stringify({ adminOtp: this.adminOtp })
      });

      if (!result?.ok) {
        throw new Error(result?.msg || '전투 시작 실패');
      }

      UI.showFeedback(this.btnStartBattle, 'success');
      this.addLogEntry('전투가 시작되었습니다', 'system');
      UI.success('전투가 시작되었습니다!');
      PyxisNotify?.notify?.('전투 시작', { body: `전투ID: ${this.currentBattleId}` });

    } catch (error) {
      console.error('[Admin] Start battle failed:', error);
      UI.error(error.message || '전투 시작 실패');
    } finally {
      UI.setLoading(this.btnStartBattle, false);
    }
  }

  // 일시정지
  pauseBattle() {
    UI.info('일시정지는 현재 서버에서 미지원입니다');
  }

  // 전투 종료
  endBattle() {
    UI.info('전투 종료는 시간만료/전멸 시 자동 처리됩니다');
  }

  // 플레이어 추가
  async addPlayer() {
    const formData = UI.getFormData(this.playerAddForm);
    
    // 폼 검증
    const validation = UI.validateForm(this.playerAddForm, {
      playerName: { required: true, label: '플레이어 이름', minLength: 1, maxLength: 20 },
      playerTeam: { required: true, label: '팀' }
    });

    if (!validation.valid) {
      UI.error(validation.errors[0]);
      return;
    }

    if (!this.currentBattleId || !this.adminOtp) {
      UI.error('전투를 먼저 생성하고 관리자 로그인하세요');
      return;
    }

    const submitBtn = this.playerAddForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true);

    try {
      const playerData = {
        adminOtp: this.adminOtp,
        name: formData.playerName,
        team: formData.playerTeam, // 'team1' | 'team2'
        atk: parseInt(this.statAttack.value) || 3,
        def: parseInt(this.statDefense.value) || 3,
        agi: parseInt(this.statAgility.value) || 3,
        luk: parseInt(this.statLuck.value) || 3,
        items: {
          dittany: Math.max(0, parseInt(this.itemHealing.value) || 0),
          atkBoost: Math.max(0, parseInt(this.itemAttackBoost.value) || 0),
          defBoost: Math.max(0, parseInt(this.itemDefenseBoost.value) || 0)
        }
      };

      // 참고: 서버 라우트는 환경에 따라 다를 수 있음.
      // 여기서는 기존 admin API 형식을 유지 (필요 시 /api/battles/:id/players 로 교체)
      const result = await PyxisSocket.apiCall(`/api/admin/battles/${this.currentBattleId}/players`, {
        method: 'POST',
        body: JSON.stringify(playerData)
      });

      if (!result?.ok) {
        throw new Error(result?.msg || '플레이어 추가 실패');
      }

      // 접속 링크를 링크 섹션에 추가 (응답이 제공하는 경우)
      if (result.joinURL) {
        this.addPlayerLink(formData.playerName, result.joinURL);
      }

      UI.showFeedback(submitBtn, 'success');
      this.addLogEntry(`플레이어 '${formData.playerName}' 추가됨 (${formData.playerTeam === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들'})`, 'system');
      UI.success(`${formData.playerName} 플레이어가 추가되었습니다!`);

      // 폼 리셋
      this.resetPlayerForm();

    } catch (error) {
      console.error('[Admin] Add player failed:', error);
      UI.error(error.message || '플레이어 추가 실패');
    } finally {
      UI.setLoading(submitBtn, false);
    }
  }

  // 플레이어 링크 추가
  addPlayerLink(playerName, url) {
    const linkItem = document.createElement('div');
    linkItem.className = 'link-item enhance-hover';
    
    linkItem.innerHTML = `
      <label style="min-width: 80px; font-weight: 600; color: var(--gold);">${playerName}:</label>
      <input class="input link-input" readonly value="${url}">
      <button class="btn copy-btn" onclick="UI.copyToClipboard('${url}', this)">복사</button>
    `;
    
    this.linksList.appendChild(linkItem);
  }

  // 플레이어 폼 리셋
  resetPlayerForm() {
    this.playerName.value = '';
    this.statAttack.value = '3';
    this.statDefense.value = '3';
    this.statAgility.value = '3';
    this.statLuck.value = '3';
    this.itemHealing.value = '0';
    this.itemAttackBoost.value = '0';
    this.itemDefenseBoost.value = '0';
  }

  // 링크 생성
  generateLinks() {
    if (!this.battleState?.teams) {
      UI.info('플레이어를 먼저 추가해주세요');
      return;
    }

    const allPlayers = [
      ...(this.battleState.teams.find(t => t.side === 'A' || t.side === 'team1')?.players || []),
      ...(this.battleState.teams.find(t => t.side === 'B' || t.side === 'team2')?.players || [])
    ];

    if (allPlayers.length === 0) {
      UI.info('추가된 플레이어가 없습니다');
      return;
    }

    UI.info(`${allPlayers.length}명의 플레이어 링크가 이미 생성되어 있습니다`);
  }

  // 플레이어 제거
  async removePlayer(playerId) {
    if (!confirm('정말로 이 플레이어를 제거하시겠습니까?')) {
      return;
    }

    try {
      const result = await PyxisSocket.apiCall(`/api/admin/battles/${this.currentBattleId}/players/${playerId}`, {
        method: 'DELETE',
        body: JSON.stringify({ adminOtp: this.adminOtp })
      });

      if (!result?.ok) {
        throw new Error(result?.msg || '플레이어 제거 실패');
      }

      this.addLogEntry(`플레이어가 제거되었습니다`, 'system');
      UI.success('플레이어가 제거되었습니다');

    } catch (error) {
      console.error('[Admin] Remove player failed:', error);
      UI.error(error.message || '플레이어 제거 실패');
    }
  }

  // 채팅 전송
  sendChat() {
    const message = this.chatInput.value.trim();
    if (!message || !this.currentBattleId) return;

    const channel = this.chatChannel.value === 'team' ? 'team' : 'all';
    // 소켓 매니저의 통합 시그니처에 맞춰 전송
    PyxisSocket
      .sendChat(message, channel, this.currentBattleId)
      .catch(() => {/* 무시: 레거시 fallback 내부처리 */});

    this.chatInput.value = '';
  }

  // 채팅 메시지 처리
  handleChatMessage(message) {
    const scope = message.scope === 'team' || message.channel === 'team' ? '[팀] ' : '[전체] ';
    const nickname = message.from?.nickname || message.nickname || message.name || '익명';
    const text = message.text || message.message || '';
    const content = `${scope}${nickname}: ${text}`;
    
    this.addLogEntry(content, message.from?.role === 'admin' ? 'admin' : 'info');
  }

  // 로그 엔트리 추가
  addLogEntry(content, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = UI.formatTime(Date.now());
    
    const contentSpan = document.createElement('span');
    contentSpan.className = 'log-content';
    contentSpan.textContent = content;
    
    entry.appendChild(timeSpan);
    entry.appendChild(contentSpan);
    this.logViewer.appendChild(entry);
    
    // 스크롤 최하단으로
    UI.scrollToBottom(this.logViewer);
    
    // 최대 100개 엔트리 유지
    while (this.logViewer.children.length > 100) {
      this.logViewer.removeChild(this.logViewer.firstChild);
    }
  }

  // 정리
  cleanup() {
    PyxisSocket.cleanup();
  }
}

// 페이지 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.admin = new PyxisAdmin();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (window.admin) {
    window.admin.cleanup();
  }
});
