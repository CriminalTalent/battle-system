// public/assets/js/pages/admin.js
// Enhanced PYXIS Admin Interface - 강화된 Socket.IO 연결 및 브로드캐스트 시스템
// - 향상된 연결 안정성 및 재연결 로직
// - 강화된 브로드캐스트 이벤트 처리
// - 실시간 상태 동기화
// - 에러 핸들링 및 복구 메커니즘

class EnhancedAdminInterface {
  constructor() {
    // 핵심 상태
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.currentBattleId = null;
    this.currentAdminOtp = null;
    this.playerList = [];
    
    // 연결 관리
    this.connectionState = 'disconnected'; // disconnected, connecting, connected, authenticated
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.connectionTimeout = null;
    
    // 브로드캐스트 큐
    this.messageQueue = [];
    this.isProcessingQueue = false;
    
    // 상태 동기화
    this.lastSyncTime = 0;
    this.syncInterval = null;
    
    // 메트릭스
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      reconnects: 0,
      startTime: Date.now()
    };
    
    this.init();
  }

  /* ========================== 초기화 및 설정 ========================== */

  init() {
    this.initElements();
    this.setupEventListeners();
    this.setupStatInputs();
    this.startMetricsCollection();
    this.addLog('system', '강화된 관리자 시스템이 준비되었습니다');
    
    // 기본 체력 설정 카드 제거 (개별 HP 입력 사용)
    document.getElementById('settingsCard')?.remove();
    
    // 페이지 언로드 시 정리
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  initElements() {
    // 전투 생성 요소
    this.battleCreateForm = document.getElementById('battleCreateForm');
    this.battleMode = document.getElementById('battleMode');
    this.battleInfo = document.getElementById('battleInfo');
    this.battleIdDisplay = document.getElementById('battleIdDisplay');
    this.adminOtpDisplay = document.getElementById('adminOtpDisplay');
    this.createTimeDisplay = document.getElementById('createTimeDisplay');

    // 연결 및 제어 요소
    this.btnConnect = document.getElementById('btnConnect');
    this.btnStartBattle = document.getElementById('btnStartBattle');
    this.btnPauseBattle = document.getElementById('btnPauseBattle');
    this.btnEndBattle = document.getElementById('btnEndBattle');
    this.connectionStatusIcon = document.getElementById('connectionStatus');

    // 플레이어 관리 요소
    this.playerForm = document.getElementById('playerForm');
    this.btnAddPlayer = document.getElementById('btnAddPlayer');
    this.statAttack = document.getElementById('statAttack');
    this.statDefense = document.getElementById('statDefense');
    this.statAgility = document.getElementById('statAgility');
    this.statLuck = document.getElementById('statLuck');
    this.playerHp = document.getElementById('playerHp');
    this.playerAvatar = document.getElementById('playerAvatar');

    // OTP 및 링크 요소
    this.linksSection = document.getElementById('linksSection');
    this.btnGeneratePlayerOTP = document.getElementById('btnGeneratePlayerOTP');
    this.btnGenerateSpectatorOTP = document.getElementById('btnGenerateSpectatorOTP');
    this.otpDisplay = document.getElementById('otpDisplay');
    this.playerOtpList = document.getElementById('playerOtpList');
    this.spectatorOtpDisplay = document.getElementById('spectatorOtpDisplay');

    // 로스터 및 팀 관리
    this.rosterCard = document.getElementById('rosterCard');
    this.team1Roster = document.getElementById('team1Roster');
    this.team2Roster = document.getElementById('team2Roster');
    this.teamACount = document.getElementById('teamACount');
    this.teamBCount = document.getElementById('teamBCount');

    // 로그 및 채팅
    this.logViewer = document.getElementById('logViewer');
    this.chatInput = document.getElementById('chatInput');
    this.btnSendChat = document.getElementById('btnSendChat');
    this.chatChannel = document.getElementById('chatChannel');
    
    // 연결 상태 표시 요소 추가
    this.createConnectionStatusDisplay();
  }

  setupEventListeners() {
    // 전투 생성
    this.battleCreateForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createBattle();
    });

    // 연결 및 제어 버튼
    this.btnConnect?.addEventListener('click', () => this.connectAsAdmin());
    this.btnStartBattle?.addEventListener('click', () => this.startBattle());
    this.btnPauseBattle?.addEventListener('click', () => this.pauseBattle());
    this.btnEndBattle?.addEventListener('click', () => this.endBattle());

    // 플레이어 관리
    this.btnAddPlayer?.addEventListener('click', () => this.addPlayer());

    // OTP 생성
    this.btnGeneratePlayerOTP?.addEventListener('click', () => this.generatePlayerOTPs());
    this.btnGenerateSpectatorOTP?.addEventListener('click', () => this.generateSpectatorOTP());

    // 채팅
    this.btnSendChat?.addEventListener('click', () => this.sendChat());
    this.chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChat();
      }
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 's':
            e.preventDefault();
            this.startBattle();
            break;
          case 'p':
            e.preventDefault();
            this.pauseBattle();
            break;
          case 'e':
            e.preventDefault();
            this.endBattle();
            break;
        }
      }
    });
  }

  /* ======================= 소켓 연결 및 관리 ======================= */

  async connectAsAdmin() {
    if (!this.currentBattleId) {
      this.showToast('전투 생성 후 연결하세요', 'error');
      return;
    }
    
    if (!this.currentAdminOtp) {
      this.showToast('관리자 OTP가 없습니다', 'error');
      return;
    }

    if (this.connectionState === 'connecting') {
      this.addLog('system', '이미 연결 시도 중입니다');
      return;
    }

    this.connectionState = 'connecting';
    this.updateConnectionUI();
    
    // 기존 연결 정리
    this.cleanup();
    
    try {
      await this.establishSocketConnection();
    } catch (error) {
      this.addLog('error', `연결 실패: ${error.message}`);
      this.showToast('연결 실패', 'error');
      this.connectionState = 'disconnected';
      this.updateConnectionUI();
    }
  }

  async establishSocketConnection() {
    return new Promise((resolve, reject) => {
      this.addLog('system', '관리자 소켓 연결 시도...');
      
      // Socket.IO 인스턴스 생성
      this.socket = io('/', {
        transports: ['websocket', 'polling'],
        timeout: 15000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        reconnectionDelayMax: 5000,
        maxReconnectionAttempts: this.maxReconnectAttempts,
        randomizationFactor: 0.5,
        forceNew: true
      });

      // 연결 타임아웃 설정
      this.connectionTimeout = setTimeout(() => {
        reject(new Error('연결 시간 초과'));
        this.socket?.disconnect();
      }, 20000);

      // 소켓 이벤트 등록
      this.registerSocketEvents(resolve, reject);
    });
  }

  registerSocketEvents(connectResolve, connectReject) {
    if (!this.socket) return;

    // 기본 연결 이벤트
    this.socket.on('connect', () => {
      this.connectionState = 'connected';
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      this.addLog('system', '소켓 연결 성공');
      this.updateConnectionUI();
      
      // 관리자 인증 시도
      this.authenticateAsAdmin(connectResolve, connectReject);
    });

    this.socket.on('connect_error', (error) => {
      this.metrics.errors++;
      this.addLog('error', `연결 오류: ${error.message}`);
      
      if (connectReject && this.connectionState === 'connecting') {
        connectReject(error);
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.handleDisconnection(reason);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      this.metrics.reconnects++;
      this.addLog('system', `재연결 성공 (시도: ${attemptNumber})`);
      this.updateConnectionUI();
      
      // 재인증 필요
      if (this.currentBattleId && this.currentAdminOtp) {
        this.authenticateAsAdmin();
      }
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      this.addLog('system', `재연결 시도 ${attemptNumber}/${this.maxReconnectAttempts}`);
    });

    this.socket.on('reconnect_failed', () => {
      this.addLog('error', '재연결 실패 - 수동 연결 필요');
      this.showToast('재연결 실패', 'error');
      this.connectionState = 'disconnected';
      this.updateConnectionUI();
    });

    // 관리자 전용 이벤트 등록
    this.registerAdminEvents();
    
    // 브로드캐스트 이벤트 등록
    this.registerBroadcastEvents();
    
    // 에러 핸들링
    this.socket.on('error', (error) => {
      this.metrics.errors++;
      this.addLog('error', `소켓 에러: ${error.message || error}`);
    });
  }

  authenticateAsAdmin(connectResolve, connectReject) {
    this.addLog('system', '관리자 인증 중...');
    
    const authData = {
      battleId: this.currentBattleId,
      role: 'admin',
      otp: this.currentAdminOtp,
      timestamp: Date.now()
    };

    this.socket.emit('joinBattle', authData, (response) => {
      clearTimeout(this.connectionTimeout);
      
      if (response?.success) {
        this.connectionState = 'authenticated';
        this.isAuthenticated = true;
        this.updateConnectionUI();
        
        this.addLog('system', '관리자 인증 완료');
        this.showToast('관리자 연결 성공', 'success');
        
        // UI 상태 업데이트
        this.btnConnect && (this.btnConnect.textContent = '연결됨');
        this.btnConnect && (this.btnConnect.disabled = true);
        this.btnStartBattle && (this.btnStartBattle.disabled = false);
        this.btnEndBattle && (this.btnEndBattle.disabled = false);
        
        // 상태 동기화 시작
        this.startStateSynchronization();
        
        // 메시지 큐 처리
        this.processMessageQueue();
        
        connectResolve && connectResolve();
      } else {
        const errorMsg = response?.error || '인증 실패';
        this.addLog('error', `인증 실패: ${errorMsg}`);
        this.showToast('관리자 인증 실패', 'error');
        
        this.connectionState = 'connected';
        this.isAuthenticated = false;
        
        connectReject && connectReject(new Error(errorMsg));
      }
    });
  }

  registerAdminEvents() {
    if (!this.socket) return;

    // 전투 상태 이벤트
    this.socket.on('battle:status', (data) => {
      this.handleBattleStatusUpdate(data);
    });

    this.socket.on('battle:started', (data) => {
      this.addLog('battle', '전투가 시작되었습니다');
      this.showToast('전투 시작', 'success');
      this.updateBattleControls('started');
    });

    this.socket.on('battle:paused', (data) => {
      this.addLog('battle', '전투가 일시정지되었습니다');
      this.showToast('전투 일시정지', 'info');
      this.updateBattleControls('paused');
    });

    this.socket.on('battle:ended', (data) => {
      this.addLog('battle', `전투가 종료되었습니다. 승리: ${data.winner || '무승부'}`);
      this.showToast('전투 종료', 'info');
      this.updateBattleControls('ended');
    });

    // 플레이어 관리 이벤트
    this.socket.on('player:joined', (data) => {
      this.handlePlayerJoined(data);
    });

    this.socket.on('player:left', (data) => {
      this.handlePlayerLeft(data);
    });

    this.socket.on('player:updated', (data) => {
      this.handlePlayerUpdated(data);
    });

    // 인증 및 권한 이벤트
    this.socket.on('auth:expired', () => {
      this.addLog('error', '인증이 만료되었습니다. 재연결이 필요합니다');
      this.showToast('인증 만료', 'warning');
      this.isAuthenticated = false;
      this.connectionState = 'connected';
      this.updateConnectionUI();
    });

    this.socket.on('admin:kicked', (reason) => {
      this.addLog('error', `관리자 권한이 박탈되었습니다: ${reason}`);
      this.showToast('권한 박탈', 'error');
      this.disconnect();
    });
  }

  registerBroadcastEvents() {
    if (!this.socket) return;

    // 상태 동기화 이벤트
    this.socket.on('state:snapshot', (snapshot) => {
      this.handleStateSnapshot(snapshot);
    });

    this.socket.on('state:update', (update) => {
      this.handleStateUpdate(update);
    });

    // 로스터 업데이트
    this.socket.on('roster:update', (data) => {
      this.syncRoster(data?.players || []);
      this.metrics.messagesReceived++;
    });

    this.socket.on('battleState', (state) => {
      this.addLog('system', `전투 상태 갱신: 플레이어 ${state?.players?.length || 0}명`);
      this.syncRoster(state?.players || []);
      this.metrics.messagesReceived++;
    });

    // 채팅 및 로그 이벤트
    this.socket.on('chatMessage', (msg) => {
      this.handleChatMessage(msg);
    });

    this.socket.on('log:battle', (log) => {
      this.addLogEntry(log, 'battle');
    });

    this.socket.on('log:system', (log) => {
      this.addLogEntry(log, 'system');
    });

    // 연결 통계 이벤트
    this.socket.on('connection:stats', (stats) => {
      this.updateConnectionStats(stats);
    });

    // 브로드캐스트 확인 이벤트
    this.socket.on('broadcast:ack', (data) => {
      this.addLog('debug', `브로드캐스트 확인: ${data.type} (${data.recipients}명)`);
    });
  }

  /* ======================= 연결 상태 관리 ======================= */

  handleDisconnection(reason) {
    this.isConnected = false;
    this.isAuthenticated = false;
    this.connectionState = 'disconnected';
    
    this.addLog('system', `연결 끊김: ${reason}`);
    this.updateConnectionUI();
    
    // 상태 동기화 중단
    this.stopStateSynchronization();
    
    // 자동 재연결이 아닌 경우 UI 복원
    if (reason === 'io client disconnect' || reason === 'transport close') {
      this.btnConnect && (this.btnConnect.textContent = '관리자로 연결');
      this.btnConnect && (this.btnConnect.disabled = false);
      this.btnStartBattle && (this.btnStartBattle.disabled = true);
      this.btnEndBattle && (this.btnEndBattle.disabled = true);
    }
    
    this.showToast('연결 끊김', 'warning');
  }

  updateConnectionUI() {
    if (!this.connectionStatusIcon) return;
    
    const statusConfig = {
      'disconnected': { color: '#EF4444', text: '연결 끊김', icon: '●' },
      'connecting': { color: '#F59E0B', text: '연결 중', icon: '◐' },
      'connected': { color: '#10B981', text: '연결됨', icon: '●' },
      'authenticated': { color: '#059669', text: '인증됨', icon: '●' }
    };
    
    const config = statusConfig[this.connectionState] || statusConfig.disconnected;
    
    this.connectionStatusIcon.style.color = config.color;
    this.connectionStatusIcon.textContent = config.icon;
    this.connectionStatusIcon.title = config.text;
    
    // 추가 상태 표시
    const statusText = document.getElementById('connectionStatusText');
    if (statusText) {
      statusText.textContent = config.text;
      statusText.style.color = config.color;
    }
  }

  createConnectionStatusDisplay() {
    // 연결 상태 표시 요소가 없으면 생성
    if (!this.connectionStatusIcon) {
      const statusContainer = document.createElement('div');
      statusContainer.className = 'connection-status-container';
      statusContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 8, 13, 0.9);
        border: 1px solid rgba(220, 199, 162, 0.3);
        border-radius: 8px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 1000;
        backdrop-filter: blur(12px);
        font-size: 14px;
        color: #E2E8F0;
      `;
      
      const icon = document.createElement('span');
      icon.id = 'connectionStatus';
      icon.style.cssText = 'font-size: 12px; margin-right: 4px;';
      
      const text = document.createElement('span');
      text.id = 'connectionStatusText';
      text.textContent = '연결 끊김';
      
      statusContainer.appendChild(icon);
      statusContainer.appendChild(text);
      document.body.appendChild(statusContainer);
      
      this.connectionStatusIcon = icon;
    }
  }

  /* ======================= 상태 동기화 ======================= */

  startStateSynchronization() {
    this.stopStateSynchronization();
    
    // 정기적인 상태 동기화
    this.syncInterval = setInterval(() => {
      if (this.isAuthenticated && this.currentBattleId) {
        this.requestStateSync();
      }
    }, 30000); // 30초마다 동기화
    
    // 초기 상태 요청
    this.requestStateSync();
  }

  stopStateSynchronization() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  requestStateSync() {
    if (!this.socket || !this.isAuthenticated) return;
    
    this.socket.emit('admin:requestState', {
      battleId: this.currentBattleId,
      lastSync: this.lastSyncTime
    }, (response) => {
      if (response?.state) {
        this.handleStateSnapshot(response.state);
      }
    });
  }

  handleStateSnapshot(snapshot) {
    if (!snapshot) return;
    
    this.lastSyncTime = Date.now();
    this.addLog('debug', '상태 스냅샷 수신');
    
    // 플레이어 목록 동기화
    if (snapshot.players) {
      this.syncRoster(snapshot.players);
    }
    
    // 전투 상태 동기화
    if (snapshot.battleStatus) {
      this.updateBattleControls(snapshot.battleStatus);
    }
    
    // 연결 통계 업데이트
    if (snapshot.connections) {
      this.updateConnectionStats(snapshot.connections);
    }
  }

  handleStateUpdate(update) {
    if (!update) return;
    
    this.addLog('debug', `상태 업데이트: ${update.type}`);
    
    switch (update.type) {
      case 'player_joined':
        this.handlePlayerJoined(update.data);
        break;
      case 'player_left':
        this.handlePlayerLeft(update.data);
        break;
      case 'battle_status':
        this.handleBattleStatusUpdate(update.data);
        break;
      case 'roster_changed':
        this.syncRoster(update.data.players);
        break;
    }
  }

  /* ======================= 메시지 큐 관리 ======================= */

  queueMessage(event, data, callback) {
    this.messageQueue.push({ event, data, callback, timestamp: Date.now() });
    
    if (this.isAuthenticated) {
      this.processMessageQueue();
    }
  }

  async processMessageQueue() {
    if (this.isProcessingQueue || !this.isAuthenticated || this.messageQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      
      // 5분 이상 오래된 메시지는 무시
      if (Date.now() - message.timestamp > 300000) {
        continue;
      }
      
      try {
        await this.sendSocketMessage(message.event, message.data, message.callback);
        this.metrics.messagesSent++;
        
        // 메시지 간 간격 (과부하 방지)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        this.addLog('error', `큐 메시지 전송 실패: ${error.message}`);
        this.metrics.errors++;
      }
    }
    
    this.isProcessingQueue = false;
  }

  sendSocketMessage(event, data, callback) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('소켓이 연결되지 않음'));
        return;
      }
      
      const timeout = setTimeout(() => {
        reject(new Error('메시지 타임아웃'));
      }, 10000);
      
      this.socket.emit(event, data, (response) => {
        clearTimeout(timeout);
        
        if (callback) {
          callback(response);
        }
        
        resolve(response);
      });
    });
  }

  /* ======================= 전투 제어 ======================= */

  startBattle() {
    if (!this.isAuthenticated) {
      this.showToast('먼저 관리자로 연결하세요', 'error');
      return;
    }
    
    const startData = {
      battleId: this.currentBattleId,
      timestamp: Date.now()
    };
    
    if (this.isAuthenticated) {
      this.sendSocketMessage('battle:start', startData, (response) => {
        if (response?.success) {
          this.addLog('system', '전투 시작 명령 전송');
          this.showToast('전투 시작', 'success');
        } else {
          this.addLog('error', `전투 시작 실패: ${response?.error || '알 수 없는 오류'}`);
          this.showToast('전투 시작 실패', 'error');
        }
      });
    } else {
      this.queueMessage('battle:start', startData);
      this.showToast('전투 시작 명령이 큐에 추가됨', 'info');
    }
  }

  pauseBattle() {
    if (!this.isAuthenticated) {
      this.showToast('먼저 관리자로 연결하세요', 'error');
      return;
    }
    
    const pauseData = {
      battleId: this.currentBattleId,
      timestamp: Date.now()
    };
    
    this.sendSocketMessage('battle:pause', pauseData, (response) => {
      if (response?.success) {
        this.addLog('system', '전투 일시정지 명령 전송');
        this.showToast('전투 일시정지', 'info');
      } else {
        this.addLog('error', `전투 일시정지 실패: ${response?.error || '알 수 없는 오류'}`);
        this.showToast('전투 일시정지 실패', 'error');
      }
    });
  }

  endBattle() {
    if (!this.isAuthenticated) {
      this.showToast('먼저 관리자로 연결하세요', 'error');
      return;
    }
    
    const confirmed = confirm('전투를 강제 종료하시겠습니까?');
    if (!confirmed) return;
    
    const endData = {
      battleId: this.currentBattleId,
      timestamp: Date.now(),
      reason: 'admin_forced'
    };
    
    this.sendSocketMessage('battle:end', endData, (response) => {
      if (response?.success) {
        this.addLog('system', '전투 종료 명령 전송');
        this.showToast('전투 종료', 'info');
      } else {
        this.addLog('error', `전투 종료 실패: ${response?.error || '알 수 없는 오류'}`);
        this.showToast('전투 종료 실패', 'error');
      }
    });
  }

  updateBattleControls(status) {
    if (this.btnStartBattle) {
      this.btnStartBattle.disabled = (status === 'started' || status === 'ended');
    }
    
    if (this.btnPauseBattle) {
      this.btnPauseBattle.disabled = (status === 'waiting' || status === 'ended');
      this.btnPauseBattle.textContent = (status === 'paused') ? '재개' : '일시정지';
    }
    
    if (this.btnEndBattle) {
      this.btnEndBattle.disabled = (status === 'waiting' || status === 'ended');
    }
  }

  /* ======================= 이벤트 핸들러 ======================= */

  handleBattleStatusUpdate(data) {
    if (data.status) {
      this.updateBattleControls(data.status);
      this.addLog('battle', `전투 상태 변경: ${data.status}`);
    }
  }

  handlePlayerJoined(data) {
    this.addLog('system', `플레이어 입장: ${data.player?.name || '익명'}`);
    
    if (data.player) {
      this.playerList = this.uniqueById([...this.playerList, data.player]);
      this.updateTeamRoster();
    }
  }

  handlePlayerLeft(data) {
    this.addLog('system', `플레이어 퇴장: ${data.player?.name || '익명'}`);
    
    if (data.playerId) {
      this.playerList = this.playerList.filter(p => p.id !== data.playerId);
      this.updateTeamRoster();
    }
  }

  handlePlayerUpdated(data) {
    if (data.player) {
      const index = this.playerList.findIndex(p => p.id === data.player.id);
      if (index !== -1) {
        this.playerList[index] = data.player;
        this.updateTeamRoster();
      }
    }
  }

  handleChatMessage(msg) {
    if (!msg) return;
    
    const sender = msg.sender || '시스템';
    const text = msg.message || '';
    const channel = msg.channel || 'all';
    
    this.addLog('chat', `[${channel}] ${sender}: ${text}`);
    this.metrics.messagesReceived++;
  }

  updateConnectionStats(stats) {
    if (!stats) return;
    
    // 연결 통계 UI 업데이트
    const statsDisplay = document.getElementById('connectionStatsDisplay');
    if (statsDisplay) {
      statsDisplay.innerHTML = `
        <div class="stats-item">
          <span class="stats-label">총 연결:</span>
          <span class="stats-value">${stats.total || 0}</span>
        </div>
        <div class="stats-item">
          <span class="stats-label">플레이어:</span>
          <span class="stats-value">${stats.players || 0}</span>
        </div>
        <div class="stats-item">
          <span class="stats-label">관전자:</span>
          <span class="stats-value">${stats.spectators || 0}</span>
        </div>
      `;
    }
  }

  /* ======================= 전투 생성 및 관리 ======================= */

  async createBattle() {
    const mode = this.battleMode?.value;
    if (!mode) {
      this.showToast('전투 모드를 선택하세요', 'error');
      return;
    }

    try {
      this.addLog('system', '전투 생성 중...');
      
      const response = await fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });

      const data = await this._parseResponse(response);
      
      // battleId와 adminOtp 추출
      this.currentBattleId = data.battleId || data.id || data.battle_id;
      this.currentAdminOtp = data.adminOtp || data.adminToken || data.admin_token || data.token;
      
      if (!this.currentBattleId) {
        throw new Error('전투 ID를 받지 못했습니다');
      }

      // OTP 보완 발급 시도
      if (!this.currentAdminOtp) {
        try {
          const otpData = await this._fetchJson('/api/otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              role: 'admin', 
              battleId: this.currentBattleId, 
              name: '관리자' 
            })
          });
          this.currentAdminOtp = otpData.otp || otpData.token || null;
        } catch (otpError) {
          this.addLog('warn', `관리자 OTP 보완 발급 실패: ${otpError.message}`);
        }
      }

      // UI 업데이트
      this.updateBattleInfo();
      this.showUIElements();
      
      this.addLog('system', `전투 생성 완료 (ID: ${this.currentBattleId})`);
      if (this.currentAdminOtp) {
        this.addLog('system', `관리자 OTP: ${this.currentAdminOtp}`);
      }
      
      this.showToast('전투 생성 완료', 'success');
      
      // 자동 연결 옵션
      if (this.currentAdminOtp) {
        const autoConnect = confirm('생성된 전투에 바로 연결하시겠습니까?');
        if (autoConnect) {
          setTimeout(() => this.connectAsAdmin(), 1000);
        }
      }
      
    } catch (error) {
      this.addLog('error', `전투 생성 실패: ${error.message}`);
      this.showToast('전투 생성 실패', 'error');
    }
  }

  updateBattleInfo() {
    if (this.battleIdDisplay) {
      this.battleIdDisplay.textContent = this.currentBattleId || '-';
    }
    
    if (this.adminOtpDisplay) {
      this.adminOtpDisplay.textContent = this.currentAdminOtp || '-';
    }
    
    if (this.createTimeDisplay) {
      this.createTimeDisplay.textContent = new Date().toLocaleString('ko-KR');
    }
  }

  showUIElements() {
    const elements = [
      this.battleInfo,
      this.linksSection, 
      this.rosterCard
    ];
    
    elements.forEach(element => {
      if (element) {
        element.style.display = 'block';
      }
    });
    
    // 버튼 활성화
    if (this.btnGeneratePlayerOTP) this.btnGeneratePlayerOTP.disabled = false;
    if (this.btnGenerateSpectatorOTP) this.btnGenerateSpectatorOTP.disabled = false;
  }

  /* ======================= 플레이어 관리 ======================= */

  async addPlayer() {
    if (!this.currentBattleId) {
      this.showToast('먼저 전투를 생성하세요', 'error');
      return;
    }

    const playerData = this.collectPlayerData();
    if (!playerData) return;

    try {
      this.addLog('system', '플레이어 등록 중...');
      
      const response = await this._fetchJson(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playerData)
      });

      const player = response.player || response.data || response.result || response;
      
      if (!player || !(player.id || player.name)) {
        throw new Error('플레이어 응답 형식을 알 수 없습니다');
      }

      // 아바타 업로드 처리
      await this.uploadPlayerAvatar(player);

      // 성공 처리
      this.handlePlayerAddSuccess(player, playerData);
      
    } catch (error) {
      this.addLog('error', `플레이어 등록 실패: ${error.message}`);
      this.showToast('플레이어 등록 실패', 'error');
    }
  }

  collectPlayerData() {
    const name = document.getElementById('playerName')?.value?.trim();
    const teamSel = document.getElementById('playerTeam')?.value;
    const hp = Number(this.playerHp?.value || 100);
    
    if (!name || !teamSel) {
      this.showToast('이름과 팀을 선택하세요', 'error');
      return null;
    }

    const stats = {
      attack: Number(this.statAttack?.value || 3),
      defense: Number(this.statDefense?.value || 3),
      agility: Number(this.statAgility?.value || 3),
      luck: Number(this.statLuck?.value || 3)
    };

    // 스탯 유효성 검사
    const invalidStats = Object.values(stats).some(v => !Number.isFinite(v) || v < 1 || v > 5);
    if (invalidStats) {
      this.showToast('각 스탯은 1~5 범위여야 합니다', 'error');
      return null;
    }

    if (!Number.isFinite(hp) || hp < 1 || hp > 1000) {
      this.showToast('HP는 1~1000 사이여야 합니다', 'error');
      return null;
    }

    const team = (teamSel === 'A' ? '불사조 기사단' : '죽음을 먹는 자들');
    
    const items = {
      dittany: Number(document.getElementById('itemDittany')?.value || 0) || 0,
      attackBoost: Number(document.getElementById('itemAttackBoost')?.value || 0) || 0,
      defenseBoost: Number(document.getElementById('itemDefenseBoost')?.value || 0) || 0
    };

    return { name, team, stats, items, hp };
  }

  async uploadPlayerAvatar(player) {
    const file = this.playerAvatar?.files?.[0];
    if (!file || !(player.id || player.playerId)) return;

    try {
      const formData = new FormData();
      formData.append('avatar', file);
      formData.append('playerId', String(player.id || player.playerId));
      
      const response = await fetch(`/api/battles/${encodeURIComponent(this.currentBattleId)}/avatar`, {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        this.addLog('system', `플레이어 "${player.name}" 아바타 업로드 완료`);
      } else {
        this.addLog('error', `아바타 업로드 실패: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.addLog('error', `아바타 업로드 실패: ${error.message}`);
    }
  }

  handlePlayerAddSuccess(player, playerData) {
    this.addLog('system', 
      `플레이어 "${player.name}" 등록 완료 ` +
      `(HP:${playerData.hp}, 공:${playerData.stats.attack} 방:${playerData.stats.defense} ` +
      `민:${playerData.stats.agility} 행:${playerData.stats.luck})`
    );

    // 플레이어 목록 업데이트
    this.playerList = this.uniqueById([...this.playerList, player]);
    this.updateTeamRoster();

    // 폼 초기화
    this.resetPlayerForm();
    
    this.showToast(`${player.name} 등록 완료`, 'success');
  }

  resetPlayerForm() {
    this.playerForm?.reset();
    
    // 스탯 기본값 복원
    ['statAttack', 'statDefense', 'statAgility', 'statLuck'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = 3;
    });
    
    if (this.playerHp) this.playerHp.value = 100;
    if (this.playerAvatar) this.playerAvatar.value = '';
    
    this.updateStatDisplay();
  }

  /* ======================= OTP 및 링크 생성 ======================= */

  async generatePlayerOTPs() {
    if (!this.currentBattleId || this.playerList.length === 0) {
      this.showToast('플레이어를 먼저 추가하세요', 'error');
      return;
    }

    try {
      this.addLog('system', '플레이어 OTP 생성 중...');
      
      const roster = this.uniqueById(this.playerList);
      const otpList = [];
      
      for (const player of roster) {
        try {
          const response = await this._fetchJson('/api/otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: 'player',
              battleId: this.currentBattleId,
              playerId: player.id,
              name: player.name
            })
          });
          
          const otp = response.otp || response.token;
          const url = this.createPlayerUrl(player.id, otp);
          
          otpList.push({
            name: player.name,
            team: player.team,
            otp,
            url
          });
        } catch (error) {
          this.addLog('error', `플레이어 "${player.name}" OTP 생성 실패: ${error.message}`);
        }
      }
      
      if (otpList.length > 0) {
        this.renderPlayerOtpList(otpList);
        this.showOtpDisplay();
        this.addLog('system', `플레이어 OTP ${otpList.length}개 생성 완료`);
        this.showToast('플레이어 OTP 생성 완료', 'success');
      } else {
        throw new Error('생성된 OTP가 없습니다');
      }
      
    } catch (error) {
      this.addLog('error', `플레이어 OTP 생성 실패: ${error.message}`);
      this.showToast('플레이어 OTP 생성 실패', 'error');
    }
  }

  async generateSpectatorOTP() {
    if (!this.currentBattleId) {
      this.showToast('전투를 먼저 생성하세요', 'error');
      return;
    }

    try {
      this.addLog('system', '관전자 OTP 생성 중...');
      
      const response = await this._fetchJson('/api/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'spectator',
          battleId: this.currentBattleId,
          name: '관전자'
        })
      });
      
      const otp = response.otp || response.token;
      const url = this.createSpectatorUrl(otp);
      
      this.renderSpectatorOtp(otp, url);
      this.showOtpDisplay();
      
      this.addLog('system', '관전자 OTP 생성 완료');
      this.showToast('관전자 OTP 생성 완료', 'success');
      
    } catch (error) {
      this.addLog('error', `관전자 OTP 생성 실패: ${error.message}`);
      this.showToast('관전자 OTP 생성 실패', 'error');
    }
  }

  createPlayerUrl(playerId, otp) {
    return `${location.origin}/play?battle=${encodeURIComponent(this.currentBattleId)}&player=${encodeURIComponent(playerId)}&otp=${encodeURIComponent(otp)}`;
  }

  createSpectatorUrl(otp) {
    return `${location.origin}/spectator?battle=${encodeURIComponent(this.currentBattleId)}&token=${encodeURIComponent(otp)}`;
  }

  renderPlayerOtpList(otpList) {
    if (!this.playerOtpList) return;
    
    const html = otpList.map(item => {
      const teamShort = this.getTeamShortName(item.team);
      return `
        <div class="otp-item">
          <span class="otp-player">${this.escapeHtml(item.name)}</span>
          <span class="team-badge team-${teamShort.toLowerCase()}">${this.escapeHtml(teamShort)}</span>
          <span class="code">${this.escapeHtml(item.otp)}</span>
          <button class="otp-copy" onclick="window.adminInterface.copyToClipboard('${item.url}', this)">복사</button>
        </div>
      `;
    }).join('');
    
    this.playerOtpList.className = 'otp-list';
    this.playerOtpList.innerHTML = html;
  }

  renderSpectatorOtp(otp, url) {
    if (!this.spectatorOtpDisplay) return;
    
    this.spectatorOtpDisplay.innerHTML = `
      <div class="otp-item">
        <span class="team-badge spectator">관전자</span>
        <span class="code">${this.escapeHtml(otp)}</span>
        <button class="otp-copy" onclick="window.adminInterface.copyToClipboard('${url}', this)">링크 복사</button>
      </div>
    `;
  }

  getTeamShortName(team) {
    if (team?.includes('불사조')) return '불사조';
    if (team?.includes('죽음')) return '죽먹자';
    return team || '';
  }

  showOtpDisplay() {
    if (this.otpDisplay) {
      this.otpDisplay.style.display = 'block';
    }
  }

  async copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const originalText = button.textContent;
      button.textContent = '복사됨!';
      button.style.background = '#059669';
      
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
      }, 1500);
      
      this.showToast('클립보드에 복사됨', 'success');
    } catch (error) {
      this.addLog('error', `클립보드 복사 실패: ${error.message}`);
      this.showToast('클립보드 복사 실패', 'error');
    }
  }

  /* ======================= 채팅 시스템 ======================= */

  sendChat() {
    const text = this.chatInput?.value?.trim();
    if (!text) return;
    
    if (!this.isAuthenticated) {
      this.showToast('먼저 관리자로 연결하세요', 'error');
      return;
    }

    const chatData = {
      battleId: this.currentBattleId,
      message: text,
      channel: this.chatChannel?.value || 'all',
      timestamp: Date.now()
    };

    this.sendSocketMessage('chatMessage', chatData, (response) => {
      if (response?.success) {
        this.addLog('chat', `관리자: ${text}`);
        this.chatInput.value = '';
        this.metrics.messagesSent++;
      } else {
        this.addLog('error', `채팅 전송 실패: ${response?.error || '알 수 없는 오류'}`);
        this.showToast('채팅 전송 실패', 'error');
      }
    });
  }

  /* ======================= 로스터 관리 ======================= */

  syncRoster(players) {
    this.playerList = this.uniqueById(players || []);
    this.updateTeamRoster();
  }

  updateTeamRoster() {
    const teamA = this.playerList.filter(p => p.team === '불사조 기사단');
    const teamB = this.playerList.filter(p => p.team === '죽음을 먹는 자들');
    
    // 팀 카운트 업데이트
    if (this.teamACount) this.teamACount.textContent = `${teamA.length}/4`;
    if (this.teamBCount) this.teamBCount.textContent = `${teamB.length}/4`;
    
    // 팀 로스터 렌더링
    if (this.team1Roster) {
      this.team1Roster.innerHTML = teamA.length > 0 
        ? teamA.map(p => this.createPlayerCard(p)).join('')
        : '<div class="empty-slot">빈 자리</div>';
    }
    
    if (this.team2Roster) {
      this.team2Roster.innerHTML = teamB.length > 0
        ? teamB.map(p => this.createPlayerCard(p)).join('')
        : '<div class="empty-slot">빈 자리</div>';
    }
  }

  createPlayerCard(player) {
    const stats = player.stats ? 
      `공:${player.stats.attack} 방:${player.stats.defense} 민:${player.stats.agility} 행:${player.stats.luck}` : '';
    const hp = Number.isFinite(player.hp) ? player.hp : 100;
    const maxHp = Number.isFinite(player.maxHp) ? player.maxHp : hp;
    const hpPercent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 100;
    
    return `
      <div class="player-card" data-player-id="${player.id || ''}">
        <div class="player-avatar">
          ${player.avatar ? `<img src="${player.avatar}" alt="${player.name}">` : '👤'}
        </div>
        <div class="player-info">
          <div class="player-name">${this.escapeHtml(player.name || '')}</div>
          <div class="player-team">${this.escapeHtml(player.team || '')}</div>
          <div class="player-stats">${this.escapeHtml(stats)}</div>
          <div class="player-hp">
            <div class="hp-bar">
              <div class="hp-fill" style="width: ${hpPercent}%"></div>
            </div>
            <span class="hp-text">HP: ${hp}/${maxHp}</span>
          </div>
        </div>
        <div class="player-actions">
          <button class="btn-small btn-danger" onclick="window.adminInterface.removePlayer('${player.id}')">제거</button>
        </div>
      </div>
    `;
  }

  async removePlayer(playerId) {
    if (!playerId || !this.currentBattleId) return;
    
    const player = this.playerList.find(p => p.id === playerId);
    if (!player) return;
    
    const confirmed = confirm(`플레이어 "${player.name}"을(를) 제거하시겠습니까?`);
    if (!confirmed) return;
    
    try {
      const response = await fetch(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players/${encodeURIComponent(playerId)}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        this.playerList = this.playerList.filter(p => p.id !== playerId);
        this.updateTeamRoster();
        this.addLog('system', `플레이어 "${player.name}" 제거됨`);
        this.showToast('플레이어 제거됨', 'info');
      } else {
        throw new Error(`${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.addLog('error', `플레이어 제거 실패: ${error.message}`);
      this.showToast('플레이어 제거 실패', 'error');
    }
  }

  /* ======================= 스탯 입력 관리 ======================= */

  setupStatInputs() {
    const statInputs = [this.statAttack, this.statDefense, this.statAgility, this.statLuck, this.playerHp];
    
    statInputs.forEach(input => {
      if (!input) return;

      input.addEventListener('input', (e) => {
        this.validateStatInput(e.target);
      });

      input.addEventListener('keydown', (e) => {
        this.handleStatKeydown(e);
      });

      input.addEventListener('focus', (e) => {
        e.target.select();
      });
    });

    // 초기값 설정
    if (this.statAttack) this.statAttack.value = this.statAttack.value || 3;
    if (this.statDefense) this.statDefense.value = this.statDefense.value || 3;
    if (this.statAgility) this.statAgility.value = this.statAgility.value || 3;
    if (this.statLuck) this.statLuck.value = this.statLuck.value || 3;
    if (this.playerHp) this.playerHp.value = this.playerHp.value || 100;
    
    this.updateStatDisplay();
  }

  validateStatInput(input) {
    let value = parseInt(input.value);
    const isHp = input === this.playerHp;
    const min = 1;
    const max = isHp ? 1000 : 5;
    
    if (isNaN(value) || value < min) value = min;
    if (value > max) value = max;
    
    input.value = value;
    this.updateStatDisplay();
  }

  handleStatKeydown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    
    e.preventDefault();
    
    let value = parseInt(e.target.value) || 1;
    const isHp = e.target === this.playerHp;
    const min = 1;
    const max = isHp ? 1000 : 5;
    const step = isHp ? 10 : 1;
    
    if (e.key === 'ArrowUp' && value < max) {
      value = Math.min(value + step, max);
    } else if (e.key === 'ArrowDown' && value > min) {
      value = Math.max(value - step, min);
    }
    
    e.target.value = value;
    this.updateStatDisplay();
  }

  updateStatDisplay() {
    const statInputs = [this.statAttack, this.statDefense, this.statAgility, this.statLuck];
    let allValid = true;
    
    statInputs.forEach(input => {
      if (!input) return;
      
      const value = parseInt(input.value);
      const isValid = Number.isFinite(value) && value >= 1 && value <= 5;
      
      input.classList.toggle('error', !isValid);
      if (!isValid) allValid = false;
    });
    
    if (this.playerHp) {
      const hp = parseInt(this.playerHp.value);
      const isValid = Number.isFinite(hp) && hp >= 1 && hp <= 1000;
      
      this.playerHp.classList.toggle('error', !isValid);
      if (!isValid) allValid = false;
    }
    
    if (this.btnAddPlayer) {
      this.btnAddPlayer.disabled = !allValid;
    }
  }

  /* ======================= 메트릭스 및 모니터링 ======================= */

  startMetricsCollection() {
    setInterval(() => {
      this.updateMetricsDisplay();
    }, 5000); // 5초마다 업데이트
  }

  updateMetricsDisplay() {
    const uptime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const metricsDisplay = document.getElementById('metricsDisplay');
    
    if (metricsDisplay) {
      metricsDisplay.innerHTML = `
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="metric-label">가동시간:</span>
            <span class="metric-value">${this.formatUptime(uptime)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">수신:</span>
            <span class="metric-value">${this.metrics.messagesReceived}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">송신:</span>
            <span class="metric-value">${this.metrics.messagesSent}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">오류:</span>
            <span class="metric-value">${this.metrics.errors}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">재연결:</span>
            <span class="metric-value">${this.metrics.reconnects}</span>
          </div>
        </div>
      `;
    }
  }

  formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}시간 ${minutes}분`;
    } else if (minutes > 0) {
      return `${minutes}분 ${secs}초`;
    } else {
      return `${secs}초`;
    }
  }

  /* ======================= 유틸리티 함수 ======================= */

  async _parseResponse(response) {
    const text = await response.text();
    let data = {};
    
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = {};
    }
    
    if (!response.ok) {
      const message = data?.error || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    
    return data;
  }

  async _fetchJson(url, options) {
    const response = await fetch(url, options);
    return this._parseResponse(response);
  }

  uniqueById(array) {
    const seen = new Map();
    
    (array || []).forEach(item => {
      const key = (item && (item.id || item.playerId || item.name)) || Math.random().toString(36).slice(2);
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    });
    
    return Array.from(seen.values());
  }

  addLog(type, message) {
    if (!this.logViewer) return;
    
    const timestamp = new Date().toLocaleTimeString('ko-KR');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    
    logEntry.innerHTML = `
      <div class="log-time">${timestamp}</div>
      <div class="log-content">${this.escapeHtml(message)}</div>
    `;
    
    this.logViewer.appendChild(logEntry);
    this.logViewer.scrollTop = this.logViewer.scrollHeight;
    
    // 로그 개수 제한 (성능 최적화)
    const entries = this.logViewer.querySelectorAll('.log-entry');
    if (entries.length > 500) {
      entries[0]?.remove();
    }
    
    // 브로드캐스트를 통해 다른 관리자들에게도 로그 전송
    if (this.isAuthenticated && type !== 'debug') {
      this.broadcastLog(type, message);
    }
  }

  addLogEntry(log, type) {
    if (!log) return;
    
    const message = typeof log === 'string' ? log : log.message || log.text || '';
    const logType = log.type || type || 'system';
    
    this.addLog(logType, message);
  }

  broadcastLog(type, message) {
    if (!this.socket || !this.isAuthenticated) return;
    
    const logData = {
      battleId: this.currentBattleId,
      type,
      message,
      timestamp: Date.now(),
      source: 'admin'
    };
    
    this.socket.emit('log:broadcast', logData);
  }

  showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      background: ${this.getToastBackground(type)};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(12px);
      border: 1px solid ${this.getToastBorder(type)};
      opacity: 0;
      transform: translateY(-20px);
      transition: all 0.3s ease;
      pointer-events: auto;
      max-width: 400px;
      text-align: center;
    `;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // 애니메이션
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    
    // 자동 제거
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  getToastBackground(type) {
    const backgrounds = {
      'success': 'linear-gradient(135deg, #059669, #10B981)',
      'error': 'linear-gradient(135deg, #DC2626, #EF4444)',
      'warning': 'linear-gradient(135deg, #D97706, #F59E0B)',
      'info': 'linear-gradient(135deg, #0284C7, #0EA5E9)'
    };
    return backgrounds[type] || backgrounds.info;
  }

  getToastBorder(type) {
    const borders = {
      'success': 'rgba(16, 185, 129, 0.5)',
      'error': 'rgba(239, 68, 68, 0.5)',
      'warning': 'rgba(245, 158, 11, 0.5)',
      'info': 'rgba(14, 165, 233, 0.5)'
    };
    return borders[type] || borders.info;
  }

  escapeHtml(unsafe) {
    const div = document.createElement('div');
    div.textContent = String(unsafe ?? '');
    return div.innerHTML;
  }

  /* ======================= 정리 및 종료 ======================= */

  cleanup() {
    // 타이머 정리
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    // 소켓 연결 정리
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (error) {
        console.error('Socket cleanup error:', error);
      }
      this.socket = null;
    }
    
    // 상태 초기화
    this.isConnected = false;
    this.isAuthenticated = false;
    this.connectionState = 'disconnected';
    this.messageQueue = [];
    this.isProcessingQueue = false;
  }

  disconnect() {
    this.addLog('system', '연결을 종료합니다...');
    this.cleanup();
    this.updateConnectionUI();
    this.showToast('연결 종료', 'info');
    
    // UI 상태 복원
    if (this.btnConnect) {
      this.btnConnect.textContent = '관리자로 연결';
      this.btnConnect.disabled = false;
    }
    
    if (this.btnStartBattle) this.btnStartBattle.disabled = true;
    if (this.btnEndBattle) this.btnEndBattle.disabled = true;
  }

  /* ======================= 고급 기능 ======================= */

  // 배치 명령 실행 (여러 플레이어에게 동시 명령)
  async executeBatchCommand(command, playerIds, data = {}) {
    if (!this.isAuthenticated) {
      this.showToast('관리자 인증이 필요합니다', 'error');
      return;
    }
    
    const batchData = {
      battleId: this.currentBattleId,
      command,
      playerIds,
      data,
      timestamp: Date.now()
    };
    
    try {
      await this.sendSocketMessage('admin:batch_command', batchData);
      this.addLog('system', `배치 명령 실행: ${command} (${playerIds.length}명 대상)`);
      this.showToast('배치 명령 실행됨', 'success');
    } catch (error) {
      this.addLog('error', `배치 명령 실패: ${error.message}`);
      this.showToast('배치 명령 실패', 'error');
    }
  }

  // 전투 상태 강제 동기화
  async forceSyncBattleState() {
    if (!this.isAuthenticated) return;
    
    try {
      await this.sendSocketMessage('admin:force_sync', {
        battleId: this.currentBattleId
      });
      
      this.addLog('system', '전투 상태 강제 동기화 요청');
      this.showToast('상태 동기화 중...', 'info');
    } catch (error) {
      this.addLog('error', `동기화 실패: ${error.message}`);
    }
  }

  // 응급 전투 중단 (모든 플레이어 킥 + 전투 종료)
  async emergencyStop() {
    const confirmed = confirm(
      '응급 전투 중단을 실행하시겠습니까?\n' +
      '모든 플레이어가 연결 해제되고 전투가 강제 종료됩니다.'
    );
    
    if (!confirmed) return;
    
    try {
      await this.sendSocketMessage('admin:emergency_stop', {
        battleId: this.currentBattleId,
        reason: 'admin_emergency'
      });
      
      this.addLog('system', '응급 전투 중단 실행');
      this.showToast('응급 중단 실행됨', 'warning');
    } catch (error) {
      this.addLog('error', `응급 중단 실패: ${error.message}`);
      this.showToast('응급 중단 실패', 'error');
    }
  }

  // 실시간 통계 보기 토글
  toggleStatsPanel() {
    const panel = document.getElementById('statsPanel');
    if (!panel) {
      this.createStatsPanel();
    } else {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }

  createStatsPanel() {
    const panel = document.createElement('div');
    panel.id = 'statsPanel';
    panel.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 300px;
      background: rgba(0, 8, 13, 0.95);
      border: 1px solid rgba(220, 199, 162, 0.3);
      border-radius: 12px;
      padding: 16px;
      backdrop-filter: blur(12px);
      z-index: 1000;
      color: #E2E8F0;
      font-size: 12px;
    `;
    
    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h4 style="margin: 0; color: #DCC7A2;">실시간 통계</h4>
        <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: #DCC7A2; cursor: pointer; font-size: 16px;">&times;</button>
      </div>
      <div id="metricsDisplay"></div>
      <div id="connectionStatsDisplay" style="margin-top: 12px;"></div>
    `;
    
    document.body.appendChild(panel);
    this.updateMetricsDisplay();
  }

  // 플레이어 상태 일괄 수정
  async bulkEditPlayers() {
    const modal = this.createBulkEditModal();
    document.body.appendChild(modal);
  }

  createBulkEditModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    modal.innerHTML = `
      <div style="background: #00080D; border: 2px solid #DCC7A2; border-radius: 12px; padding: 24px; max-width: 500px; width: 90%;">
        <h3 style="color: #DCC7A2; margin-top: 0;">플레이어 일괄 수정</h3>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #E2E8F0;">대상 선택:</label>
          <select id="bulkTarget" style="width: 100%; padding: 8px; background: #001E35; color: #E2E8F0; border: 1px solid #DCC7A2; border-radius: 4px;">
            <option value="all">모든 플레이어</option>
            <option value="team_a">불사조 기사단</option>
            <option value="team_b">죽음을 먹는 자들</option>
          </select>
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #E2E8F0;">수정 작업:</label>
          <select id="bulkAction" style="width: 100%; padding: 8px; background: #001E35; color: #E2E8F0; border: 1px solid #DCC7A2; border-radius: 4px;">
            <option value="heal_full">체력 완전 회복</option>
            <option value="heal_partial">체력 부분 회복</option>
            <option value="damage">피해 적용</option>
            <option value="reset_items">아이템 초기화</option>
            <option value="kick">강제 퇴장</option>
          </select>
        </div>
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #E2E8F0;">값 (필요시):</label>
          <input id="bulkValue" type="number" min="1" max="1000" style="width: 100%; padding: 8px; background: #001E35; color: #E2E8F0; border: 1px solid #DCC7A2; border-radius: 4px;">
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button onclick="this.closest('[style*=\"position: fixed\"]').remove()" style="padding: 8px 16px; background: #374151; color: white; border: none; border-radius: 4px; cursor: pointer;">취소</button>
          <button onclick="window.adminInterface.executeBulkEdit()" style="padding: 8px 16px; background: #DCC7A2; color: #00080D; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">실행</button>
        </div>
      </div>
    `;
    
    return modal;
  }

  async executeBulkEdit() {
    const target = document.getElementById('bulkTarget')?.value;
    const action = document.getElementById('bulkAction')?.value;
    const value = document.getElementById('bulkValue')?.value;
    
    if (!target || !action) return;
    
    // 대상 플레이어 ID 수집
    let targetPlayers = [];
    if (target === 'all') {
      targetPlayers = this.playerList.map(p => p.id);
    } else if (target === 'team_a') {
      targetPlayers = this.playerList.filter(p => p.team === '불사조 기사단').map(p => p.id);
    } else if (target === 'team_b') {
      targetPlayers = this.playerList.filter(p => p.team === '죽음을 먹는 자들').map(p => p.id);
    }
    
    if (targetPlayers.length === 0) {
      this.showToast('대상 플레이어가 없습니다', 'warning');
      return;
    }
    
    const confirmed = confirm(`${targetPlayers.length}명의 플레이어에게 "${action}" 작업을 실행하시겠습니까?`);
    if (!confirmed) return;
    
    try {
      await this.executeBatchCommand(action, targetPlayers, { value: parseInt(value) || 0 });
      
      // 모달 닫기
      document.querySelector('[style*="position: fixed"]')?.remove();
      
    } catch (error) {
      this.addLog('error', `일괄 수정 실패: ${error.message}`);
      this.showToast('일괄 수정 실패', 'error');
    }
  }
}

// 전역 인스턴스 및 초기화
let adminInterface;

document.addEventListener('DOMContentLoaded', () => {
  adminInterface = new EnhancedAdminInterface();
});

window.addEventListener('load', () => {
  window.adminInterface = adminInterface;
});

// 개발자 도구용 헬퍼 함수
if (typeof window !== 'undefined') {
  window.PyxisAdmin = {
    getInstance: () => adminInterface,
    forceSync: () => adminInterface?.forceSyncBattleState(),
    emergencyStop: () => adminInterface?.emergencyStop(),
    showStats: () => adminInterface?.toggleStatsPanel(),
    bulkEdit: () => adminInterface?.bulkEditPlayers(),
    getMetrics: () => adminInterface?.metrics || {},
    getConnectionState: () => adminInterface?.connectionState || 'unknown'
  };
}
