/**
 * PYXIS Battle System - Spectator Interface
 * 실시간 전투 관전 시스템
 * 
 * 기능:
 * - 실시간 전투 상황 관전
 * - 응원 메시지 시스템
 * - 전투 상황 모니터링
 * - 플레이어 상태 실시간 표시
 * - 채팅 및 응원 기능
 * - 키보드 단축키 (1-0번 응원)
 */

/**
 * UI 유틸리티 헬퍼
 */
const UI = {
  // 안전한 DOM 선택자
  $(selector) {
    return document.querySelector(selector);
  },

  $all(selector) {
    return Array.from(document.querySelectorAll(selector));
  },

  // 토스트 알림
  toast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // 애니메이션
    setTimeout(() => toast.classList.add('show'), 100);
    
    // 자동 제거
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // 상태 메시지
  success(message) { this.toast(message, 'success'); },
  error(message) { this.toast(message, 'error'); },
  info(message) { this.toast(message, 'info'); },
  warning(message) { this.toast(message, 'warning'); },

  // 요소 표시/숨김
  show(element) {
    if (element) element.style.display = 'block';
  },

  hide(element) {
    if (element) element.style.display = 'none';
  },

  toggle(element) {
    if (!element) return;
    element.style.display = element.style.display === 'none' ? 'block' : 'none';
  },

  // 텍스트 업데이트
  updateText(element, text) {
    if (element) element.textContent = text;
  },

  // HTML 업데이트
  updateHTML(element, html) {
    if (element) element.innerHTML = html;
  }
};

/**
 * 관전자 메인 클래스
 */
class SpectatorInterface {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.spectatorName = '';
    this.battleId = null;
    this.battleData = null;
    this.currentTurn = null;
    this.players = [];
    this.battleLog = [];
    
    // 응원 메시지 템플릿
    this.cheerMessages = {
      1: ['화이팅!', '잘하고 있어요!', '멋져요!', '최고!'],
      2: ['좋은 작전이에요!', '완벽해요!', '대단해요!', '훌륭해요!'],
      3: ['집중하세요!', '힘내세요!', '할 수 있어요!', '포기하지 마세요!'],
      4: ['이길 거예요!', '승리는 우리 것!', '가능해요!', '믿어요!'],
      5: ['오늘 운이 좋네요', '별자리가 좋아 보여요', '기운이 느껴져요'],
      6: ['전략적인 플레이네요', '고수의 냄새가...', '프로급 실력이에요'],
      7: ['긴장감이 최고조에요', '손에 땀이 나요', '심장이 뛰어요'],
      8: ['역전의 기회가 왔어요', '이제부터가 진짜예요', '아직 끝나지 않았어요'],
      9: ['전투의 신이 미소짓네요', '운명이 움직이는 소리가...', '승부사의 혼이 보여요'],
      0: ['전설이 탄생하는 순간', '역사에 남을 전투', '이런 전투는 처음이에요']
    };

    // 응원 효과음 (시각적 효과로 대체)
    this.cheerEffects = {
      1: 'sparkle',
      2: 'shine',
      3: 'glow',
      4: 'burst',
      5: 'twinkle'
    };

    this.init();
  }

  /**
   * 초기화
   */
  async init() {
    try {
      this.initElements();
      this.setupEventListeners();
      this.addLog('system', '관전자 시스템이 준비되었습니다');
      
      // URL 파라미터에서 OTP 확인
      const urlParams = new URLSearchParams(window.location.search);
      const otp = urlParams.get('otp');
      const battleId = urlParams.get('battle');
      
      if (otp && battleId) {
        this.battleId = battleId;
        this.showAutoLogin(otp);
      }
      
    } catch (error) {
      console.error('관전자 시스템 초기화 실패:', error);
      UI.error('관전자 시스템 초기화에 실패했습니다');
    }
  }

  /**
   * DOM 요소 초기화
   */
  initElements() {
    // 로그인 섹션
    this.loginSection = UI.$('#loginSection');
    this.spectatorNameInput = UI.$('#spectatorName');
    this.loginBtn = UI.$('#loginBtn');
    this.autoLoginInfo = UI.$('#autoLoginInfo');

    // 메인 인터페이스
    this.spectatorInterface = UI.$('#spectatorInterface');
    this.battleStatus = UI.$('#battleStatus');
    this.battleTimer = UI.$('#battleTimer');
    this.currentTurnInfo = UI.$('#currentTurnInfo');

    // 플레이어 상태
    this.team1Players = UI.$('#team1Players');
    this.team2Players = UI.$('#team2Players');
    this.playerStatsModal = UI.$('#playerStatsModal');

    // 전투 로그
    this.battleLogViewer = UI.$('#battleLogViewer');

    // 응원 패널
    this.cheerPanel = UI.$('#cheerPanel');
    this.quickCheerBtns = UI.$all('.quick-cheer-btn');
    this.customCheerInput = UI.$('#customCheerInput');
    this.sendCheerBtn = UI.$('#sendCheerBtn');

    // 연결 상태
    this.connectionStatus = UI.$('#connectionStatus');
    this.spectatorCount = UI.$('#spectatorCount');
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // 로그인
    this.loginBtn?.addEventListener('click', () => this.login());
    this.spectatorNameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // 응원 버튼
    this.quickCheerBtns?.forEach((btn, index) => {
      btn.addEventListener('click', () => this.sendQuickCheer(index + 1));
    });

    // 커스텀 응원
    this.sendCheerBtn?.addEventListener('click', () => this.sendCustomCheer());
    this.customCheerInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendCustomCheer();
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      
      const key = e.key;
      if (key >= '1' && key <= '9') {
        e.preventDefault();
        this.sendQuickCheer(parseInt(key));
      } else if (key === '0') {
        e.preventDefault();
        this.sendQuickCheer(10);
      }
    });

    // 플레이어 카드 클릭
    document.addEventListener('click', (e) => {
      if (e.target.closest('.player-card')) {
        const playerId = e.target.closest('.player-card').dataset.playerId;
        this.showPlayerStats(playerId);
      }
    });

    // 모달 닫기
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        UI.hide(e.target);
      }
    });

    // 연결 상태 체크
    setInterval(() => this.checkConnection(), 5000);
  }

  /**
   * 자동 로그인 정보 표시
   */
  showAutoLogin(otp) {
    if (this.autoLoginInfo) {
      this.autoLoginInfo.style.display = 'block';
      this.autoLoginInfo.innerHTML = `
        <div class="auto-login-notice">
          <div class="notice-icon">★</div>
          <div class="notice-content">
            <div class="notice-title">관전자 초대</div>
            <div class="notice-text">OTP가 확인되었습니다. 원하시는 관전자 이름을 입력하고 입장해주세요.</div>
          </div>
        </div>
      `;
    }
    
    // 미리 추천 이름 설정
    const suggestedNames = ['관전왕', '응원단장', '전투분석가', '별보는자', '운명지킴이'];
    const randomName = suggestedNames[Math.floor(Math.random() * suggestedNames.length)];
    
    if (this.spectatorNameInput) {
      this.spectatorNameInput.placeholder = `예: ${randomName}`;
    }
  }

  /**
   * 관전자 로그인
   */
  async login() {
    const name = this.spectatorNameInput?.value?.trim();
    
    if (!name) {
      UI.error('관전자 이름을 입력해주세요');
      this.spectatorNameInput?.focus();
      return;
    }

    if (name.length < 2 || name.length > 12) {
      UI.error('이름은 2-12글자 사이로 입력해주세요');
      return;
    }

    try {
      this.spectatorName = name;
      this.addLog('system', `'${name}'으로 관전 시작...`);
      
      // Socket.IO 연결 시뮬레이션 (실제 구현 시 Socket.IO 사용)
      await this.connectToServer();
      
      UI.hide(this.loginSection);
      UI.show(this.spectatorInterface);
      
      this.addLog('system', '관전자 모드로 연결되었습니다');
      this.updateConnectionStatus(true);
      
      // 배경 음악 및 효과 시작
      this.startSpectatorMode();
      
    } catch (error) {
      console.error('관전자 로그인 실패:', error);
      UI.error('로그인에 실패했습니다: ' + error.message);
    }
  }

  /**
   * 서버 연결
   */
  async connectToServer() {
    await this.delay(1000);
    
    // 실제 Socket.IO 연결 코드로 교체 필요
    this.isConnected = true;
    this.socket = { connected: true }; // Mock socket
    
    // 전투 데이터 로드
    await this.loadBattleData();
    
    // 실시간 업데이트 시작
    this.startRealTimeUpdates();
  }

  /**
   * 전투 데이터 로드
   */
  async loadBattleData() {
    // 실제 서버에서 데이터를 받아오는 코드로 교체
    this.battleData = {
      id: this.battleId || 'demo-battle',
      status: 'active',
      mode: '2v2',
      startTime: new Date(Date.now() - 600000), // 10분 전 시작
      teams: {
        A: { name: '불사조 기사단', color: '#DCC7A2' },
        B: { name: '죽음을 먹는 자들', color: '#8B7355' }
      },
      currentTurn: 'A',
      turnCount: 5
    };

    this.players = [
      {
        id: 'p1',
        name: '아르투스',
        team: 'A',
        hp: 85,
        maxHp: 100,
        stats: { attack: 8, defense: 6, agility: 7, luck: 5 },
        status: 'active'
      },
      {
        id: 'p2',
        name: '갈라하드',
        team: 'A', 
        hp: 92,
        maxHp: 100,
        stats: { attack: 6, defense: 8, agility: 6, luck: 6 },
        status: 'active'
      },
      {
        id: 'p3',
        name: '말포이',
        team: 'B',
        hp: 78,
        maxHp: 100,
        stats: { attack: 9, defense: 5, agility: 8, luck: 4 },
        status: 'active'
      },
      {
        id: 'p4',
        name: '벨라트릭스',
        team: 'B',
        hp: 66,
        maxHp: 100,
        stats: { attack: 7, defense: 6, agility: 9, luck: 7 },
        status: 'active'
      }
    ];

    this.updateBattleDisplay();
  }

  /**
   * 전투 화면 업데이트
   */
  updateBattleDisplay() {
    // 전투 상태 업데이트
    if (this.battleStatus) {
      const statusText = this.getBattleStatusText();
      UI.updateText(this.battleStatus, statusText);
    }

    // 타이머 업데이트
    this.updateBattleTimer();

    // 현재 턴 정보
    this.updateCurrentTurn();

    // 플레이어 상태 업데이트
    this.updatePlayerCards();

    // 관전자 수 업데이트 (임시)
    if (this.spectatorCount) {
      UI.updateText(this.spectatorCount, '3명 관전 중');
    }
  }

  /**
   * 전투 상태 텍스트 생성
   */
  getBattleStatusText() {
    if (!this.battleData) return '전투 정보 로딩 중...';
    
    const { status, mode } = this.battleData;
    const statusMap = {
      'waiting': '대기 중',
      'active': '진행 중',
      'paused': '일시정지',
      'ended': '종료'
    };

    return `${mode} 전투 ${statusMap[status] || status}`;
  }

  /**
   * 전투 타이머 업데이트
   */
  updateBattleTimer() {
    if (!this.battleData?.startTime || !this.battleTimer) return;
    
    const elapsed = Date.now() - this.battleData.startTime.getTime();
    const remaining = Math.max(0, 3600000 - elapsed); // 1시간 제한
    
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    UI.updateText(this.battleTimer, `${minutes}:${seconds.toString().padStart(2, '0')}`);
  }

  /**
   * 현재 턴 정보 업데이트
   */
  updateCurrentTurn() {
    if (!this.currentTurnInfo || !this.battleData) return;
    
    const { currentTurn, teams, turnCount } = this.battleData;
    const teamName = teams[currentTurn]?.name || '알 수 없음';
    
    UI.updateHTML(this.currentTurnInfo, `
      <div class="turn-info">
        <div class="turn-team">${teamName}</div>
        <div class="turn-number">턴 ${turnCount}</div>
      </div>
    `);
  }

  /**
   * 플레이어 카드 업데이트
   */
  updatePlayerCards() {
    const teamAPlayers = this.players.filter(p => p.team === 'A');
    const teamBPlayers = this.players.filter(p => p.team === 'B');

    if (this.team1Players) {
      UI.updateHTML(this.team1Players, this.generateTeamHTML(teamAPlayers, 'A'));
    }

    if (this.team2Players) {
      UI.updateHTML(this.team2Players, this.generateTeamHTML(teamBPlayers, 'B'));
    }
  }

  /**
   * 팀 HTML 생성
   */
  generateTeamHTML(players, team) {
    const teamName = this.battleData?.teams[team]?.name || `팀 ${team}`;
    const teamColor = this.battleData?.teams[team]?.color || '#DCC7A2';
    
    return `
      <div class="team-header" style="border-color: ${teamColor}">
        <h3 class="team-name">${teamName}</h3>
        <div class="team-stats">
          생존: ${players.filter(p => p.hp > 0).length}/${players.length}
        </div>
      </div>
      <div class="team-players">
        ${players.map(player => this.generatePlayerCardHTML(player, teamColor)).join('')}
      </div>
    `;
  }

  /**
   * 플레이어 카드 HTML 생성
   */
  generatePlayerCardHTML(player, teamColor) {
    const hpPercent = (player.hp / player.maxHp) * 100;
    const statusClass = player.hp > 0 ? 'alive' : 'dead';
    const isCurrentTurn = this.battleData?.currentTurn === player.team;

    return `
      <div class="player-card ${statusClass} ${isCurrentTurn ? 'active-turn' : ''}" 
           data-player-id="${player.id}">
        <div class="player-avatar">
          <div class="avatar-circle" style="border-color: ${teamColor}">
            ${player.name.charAt(0)}
          </div>
          ${player.status === 'action' ? '<div class="action-indicator">●</div>' : ''}
        </div>
        <div class="player-info">
          <div class="player-name">${player.name}</div>
          <div class="player-hp">
            <div class="hp-bar">
              <div class="hp-fill" style="width: ${hpPercent}%"></div>
            </div>
            <div class="hp-text">${player.hp}/${player.maxHp}</div>
          </div>
          <div class="player-stats-preview">
            공격 ${player.stats.attack} | 방어 ${player.stats.defense}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 실시간 업데이트 시작
   */
  startRealTimeUpdates() {
    // 1초마다 타이머 업데이트
    setInterval(() => {
      if (this.isConnected && this.battleData?.status === 'active') {
        this.updateBattleTimer();
      }
    }, 1000);

    // 5초마다 전투 상태 체크 (실제로는 Socket.IO 이벤트 사용)
    setInterval(() => {
      if (this.isConnected) {
        this.checkBattleUpdates();
      }
    }, 5000);
  }

  /**
   * 전투 업데이트 체크
   */
  async checkBattleUpdates() {
    // 실제로는 서버에서 실시간 이벤트를 받아 처리
    // 여기서는 시뮬레이션
    const randomEvent = Math.random();
    
    if (randomEvent < 0.3) {
      this.simulateBattleEvent();
    }
  }

  /**
   * 전투 이벤트 시뮬레이션
   */
  simulateBattleEvent() {
    const events = [
      '아르투스가 말포이를 공격했습니다!',
      '벨라트릭스가 방어 태세를 취했습니다',
      '갈라하드가 디터니를 사용했습니다',
      '말포이가 치명타를 가했습니다!',
      '턴이 변경되었습니다'
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    this.addBattleLog('action', event);

    // HP 변경 시뮬레이션
    if (Math.random() < 0.4) {
      const player = this.players[Math.floor(Math.random() * this.players.length)];
      const hpChange = Math.floor(Math.random() * 20) - 10;
      player.hp = Math.max(0, Math.min(player.maxHp, player.hp + hpChange));
      this.updatePlayerCards();
    }
  }

  /**
   * 빠른 응원 보내기
   */
  sendQuickCheer(number) {
    if (!this.isConnected) {
      UI.error('서버에 연결되지 않았습니다');
      return;
    }

    const messages = this.cheerMessages[number] || this.cheerMessages[1];
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    this.sendCheer(message, 'quick', number);
  }

  /**
   * 커스텀 응원 보내기
   */
  sendCustomCheer() {
    const message = this.customCheerInput?.value?.trim();
    
    if (!message) {
      UI.error('응원 메시지를 입력해주세요');
      return;
    }

    if (message.length > 100) {
      UI.error('응원 메시지는 100글자 이하로 입력해주세요');
      return;
    }

    this.sendCheer(message, 'custom');
    
    if (this.customCheerInput) {
      this.customCheerInput.value = '';
    }
  }

  /**
   * 응원 메시지 전송
   */
  sendCheer(message, type, number) {
    // 서버로 응원 메시지 전송 (Socket.IO)
    const cheerData = {
      spectatorName: this.spectatorName,
      message,
      type,
      number,
      timestamp: Date.now()
    };

    // 실제로는 socket.emit('spectator:cheer', cheerData);
    console.log('응원 전송:', cheerData);

    // 로컬에 표시
    this.addLog('cheer', `${this.spectatorName}: ${message}`);
    
    // 응원 효과 표시
    this.showCheerEffect(type, number);
    
    UI.success('응원 메시지를 보냈습니다!');
  }

  /**
   * 응원 효과 표시
   */
  showCheerEffect(type, number) {
    if (type === 'quick' && number) {
      const effectClass = this.cheerEffects[number % 5 + 1] || 'sparkle';
      
      // 시각적 효과 생성
      const effect = document.createElement('div');
      effect.className = `cheer-effect ${effectClass}`;
      effect.style.left = Math.random() * window.innerWidth + 'px';
      effect.style.top = Math.random() * window.innerHeight + 'px';
      
      document.body.appendChild(effect);
      
      setTimeout(() => effect.remove(), 2000);
    }
  }

  /**
   * 플레이어 상세 정보 표시
   */
  showPlayerStats(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    const modal = this.playerStatsModal;
    if (!modal) return;

    const teamName = this.battleData?.teams[player.team]?.name || `팀 ${player.team}`;
    
    UI.updateHTML(modal, `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${player.name} 상세 정보</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="player-details">
            <div class="detail-section">
              <h3>기본 정보</h3>
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="detail-label">소속팀</span>
                  <span class="detail-value">${teamName}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">체력</span>
                  <span class="detail-value">${player.hp}/${player.maxHp}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">상태</span>
                  <span class="detail-value ${player.hp > 0 ? 'alive' : 'dead'}">
                    ${player.hp > 0 ? '생존' : '사망'}
                  </span>
                </div>
              </div>
            </div>
            
            <div class="detail-section">
              <h3>능력치</h3>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">공격</span>
                  <div class="stat-bar">
                    <div class="stat-fill" style="width: ${player.stats.attack * 10}%"></div>
                  </div>
                  <span class="stat-value">${player.stats.attack}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">방어</span>
                  <div class="stat-bar">
                    <div class="stat-fill" style="width: ${player.stats.defense * 10}%"></div>
                  </div>
                  <span class="stat-value">${player.stats.defense}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">민첩</span>
                  <div class="stat-bar">
                    <div class="stat-fill" style="width: ${player.stats.agility * 10}%"></div>
                  </div>
                  <span class="stat-value">${player.stats.agility}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">행운</span>
                  <div class="stat-bar">
                    <div class="stat-fill" style="width: ${player.stats.luck * 10}%"></div>
                  </div>
                  <span class="stat-value">${player.stats.luck}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    UI.show(modal);

    // 닫기 버튼 이벤트
    modal.querySelector('.modal-close')?.addEventListener('click', () => {
      UI.hide(modal);
    });
  }

  /**
   * 관전자 모드 시작
   */
  startSpectatorMode() {
    // 배경 효과 시작 (CSS 애니메이션)
    document.body.classList.add('spectator-mode');
    
    // 환영 메시지
    setTimeout(() => {
      UI.success(`${this.spectatorName}님, 관전을 즐기세요!`);
    }, 1000);

    // 도움말 표시
    setTimeout(() => {
      UI.info('키보드 1-0번 키로 빠른 응원이 가능합니다');
    }, 3000);
  }

  /**
   * 연결 상태 업데이트
   */
  updateConnectionStatus(connected) {
    if (!this.connectionStatus) return;
    
    this.connectionStatus.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
    UI.updateText(this.connectionStatus, connected ? '연결됨' : '연결 끊김');
  }

  /**
   * 연결 상태 체크
   */
  checkConnection() {
    const connected = this.socket && this.socket.connected;
    if (connected !== this.isConnected) {
      this.isConnected = connected;
      this.updateConnectionStatus(connected);
      
      if (!connected) {
        UI.warning('서버 연결이 끊어졌습니다. 재연결을 시도합니다...');
        this.reconnect();
      }
    }
  }

  /**
   * 재연결 시도
   */
  async reconnect() {
    let attempts = 0;
    const maxAttempts = 5;
    
    while (attempts < maxAttempts && !this.isConnected) {
      attempts++;
      this.addLog('system', `재연결 시도 중... (${attempts}/${maxAttempts})`);
      
      try {
        await this.delay(2000);
        await this.connectToServer();
        UI.success('서버에 다시 연결되었습니다!');
        break;
      } catch (error) {
        if (attempts === maxAttempts) {
          UI.error('서버 재연결에 실패했습니다. 페이지를 새로고침해주세요.');
        }
      }
    }
  }

  /**
   * 로그 추가
   */
  addLog(type, message) {
    this.battleLog.push({
      type,
      message,
      timestamp: new Date()
    });

    this.updateLogViewer();
  }

  /**
   * 전투 로그 추가
   */
  addBattleLog(type, message) {
    this.addLog(type, message);
  }

  /**
   * 로그 뷰어 업데이트
   */
  updateLogViewer() {
    if (!this.battleLogViewer) return;

    const recentLogs = this.battleLog.slice(-50); // 최근 50개만 표시
    
    const logHTML = recentLogs.map(log => {
      const timeStr = log.timestamp.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      return `
        <div class="log-entry log-${log.type}">
          <div class="log-time">${timeStr}</div>
          <div class="log-message">${this.escapeHtml(log.message)}</div>
        </div>
      `;
    }).join('');

    UI.updateHTML(this.battleLogViewer, logHTML);

    // 스크롤을 맨 아래로
    this.battleLogViewer.scrollTop = this.battleLogViewer.scrollHeight;
  }

  /**
   * HTML 이스케이프
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 지연 함수
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 전투 종료 처리
   */
  handleBattleEnd(result) {
    this.addLog('system', '전투가 종료되었습니다!');
    this.addLog('result', `승리팀: ${result.winner}`);
    
    UI.success('전투가 종료되었습니다!');
    
    // 결과 모달 표시 등의 후속 처리
    setTimeout(() => {
      this.showBattleResults(result);
    }, 2000);
  }

  /**
   * 전투 결과 표시
   */
  showBattleResults(result) {
    // 전투 결과 모달이나 페이지 구현
    const resultHTML = `
      <div class="battle-results">
        <h2>전투 결과</h2>
        <div class="winner">승리: ${result.winner}</div>
        <div class="final-stats">
          <!-- 최종 통계 정보 -->
        </div>
      </div>
    `;
    
    console.log('전투 결과:', result);
  }

  /**
   * 키보드 단축키 도움말
   */
  showKeyboardHelp() {
    const helpHTML = `
      <div class="keyboard-help">
        <h3>키보드 단축키</h3>
        <div class="help-grid">
          <div class="help-item"><kbd>1-4</kbd> 기본 응원</div>
          <div class="help-item"><kbd>5-9</kbd> 재치있는 응원</div>
          <div class="help-item"><kbd>0</kbd> 특별 응원</div>
        </div>
      </div>
    `;
    
    UI.info(helpHTML);
  }

  /**
   * 관전자 통계
   */
  updateSpectatorStats() {
    // 관전 시간, 응원 횟수 등 통계 업데이트
    const spectatingTime = Date.now() - this.joinTime;
    const minutes = Math.floor(spectatingTime / 60000);
    
    console.log(`관전 시간: ${minutes}분`);
  }

  /**
   * 정리 작업
   */
  cleanup() {
    // 연결 종료, 이벤트 리스너 제거 등
    if (this.socket) {
      this.socket.disconnect();
    }
    
    document.body.classList.remove('spectator-mode');
  }
}

/**
 * DOM이 로드되면 관전자 인터페이스 시작
 */
document.addEventListener('DOMContentLoaded', () => {
  try {
    window.spectatorInterface = new SpectatorInterface();
  } catch (error) {
    console.error('관전자 인터페이스 시작 실패:', error);
    
    // 간단한 fallback UI
    document.body.innerHTML = `
      <div style="
        display: flex; 
        align-items: center; 
        justify-content: center; 
        height: 100vh; 
        background: linear-gradient(135deg, #00080D, #001E35);
        color: #DCC7A2;
        font-family: 'Segoe UI', sans-serif;
        text-align: center;
      ">
        <div>
          <h1 style="margin-bottom: 20px; font-size: 3rem;">PYXIS</h1>
          <p style="font-size: 1.2rem; margin-bottom: 20px;">관전자 시스템 로딩 실패</p>
          <p style="color: #C4B599;">페이지를 새로고침하거나 관리자에게 문의해주세요.</p>
          <button onclick="location.reload()" style="
            margin-top: 30px;
            padding: 15px 30px;
            background: linear-gradient(45deg, #DCC7A2, #D4BA8D);
            color: #00080D;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
          ">새로고침</button>
        </div>
      </div>
    `;
  }
});

/**
 * 페이지 언로드 시 정리
 */
window.addEventListener('beforeunload', () => {
  if (window.spectatorInterface) {
    window.spectatorInterface.cleanup();
  }
});
