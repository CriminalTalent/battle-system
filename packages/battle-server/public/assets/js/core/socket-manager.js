// PYXIS Spectator Interface - Enhanced Gaming Viewer
// 게임다운 관전자 인터페이스, 실시간 응원 시스템, 전투 분석
class PyxisSpectatorInterface {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.spectatorName = '';
    this.battleId = null;
    this.battleData = null;
    this.players = [];
    this.battleLog = [];
    this.spectatorCount = 0;
    this.lastCheerTime = 0;
    this.cheerCooldown = 1000; // 1초 쿨타임
    
    // 응원 메시지 개선 - 더 게임다운 표현
    this.cheerMessages = {
      1: ['힘내라!', '파이팅!', '할 수 있다!', '버텨라!'],
      2: ['최고야!', '잘한다!', '멋지다!', '그렇지!'],
      3: ['역전이다!', '뒤집어라!', '반격 시작!', '기회다!'],
      4: ['집중해라!', '침착하게!', '정신 차려!', '꾸준히!'],
      5: ['치명타!', '크리티컬!', '완벽해!', '대박!'],
      6: ['방어해라!', '막아내라!', '버텨내자!', '견뎌라!'],
      7: ['회피해라!', '피해라!', '빠져라!', '조심해!'],
      8: ['아이템 써라!', '디터니다!', '회복해라!', '치료해!'],
      9: ['마지막이다!', '끝장내라!', '결정타!', '승부처!'],
      0: ['응원한다!', '화이팅!', '열심히!', '계속 가자!']
    };

    // 팀별 응원 메시지
    this.teamCheerMessages = {
      phoenix: [
        '불사조 기사단 화이팅!',
        '기사단의 영광을!',
        '불멸의 용기로!',
        '명예로운 승리를!'
      ],
      eaters: [
        '죽음을 먹는 자들 파이팅!',
        '어둠의 힘으로!',
        '공포를 선사하라!',
        '절망을 뿌려라!'
      ]
    };

    // 전투 상황별 자동 응원
    this.situationMessages = {
      lowHp: ['위험해!', '체력 조심!', '회복해라!'],
      critical: ['치명타다!', '대박!', '완벽해!'],
      miss: ['아쉽다!', '다음엔 맞춰!', '괜찮아!'],
      victory: ['승리다!', '완승!', '최고야!'],
      defeat: ['아쉽다...', '다음엔 이긴다!', '고생했어!']
    };

    this.init();
  }

  init() {
    document.addEventListener('DOMContentLoaded', () => {
      this.injectStyles();
      this.initElements();
      this.setupEventListeners();
      this.setupKeyboardShortcuts();

      const urlParams = new URLSearchParams(window.location.search);
      const otp = urlParams.get('otp');
      const battleId = urlParams.get('battle');
      
      if (otp && battleId) {
        this.battleId = battleId;
        this.showAutoLogin(otp);
      }

      // FX 엔진과 알림 시스템 연동
      if (window.PyxisFX) {
        window.PyxisFX.enhanceClicks();
      }
    });
  }

  // 스타일 주입
  injectStyles() {
    if (document.getElementById('pyxis-spectator-styles')) return;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'pyxis-spectator-styles';
    styleSheet.textContent = `
      /* PYXIS Spectator Interface Enhancements */
      
      .spectator-container {
        min-height: 100vh;
        background: linear-gradient(135deg, #00080D 0%, #001E35 100%);
        color: #E2E8F0;
        font-family: 'Inter', sans-serif;
      }

      .spectator-header {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.9), 
          rgba(0, 42, 75, 0.8));
        backdrop-filter: blur(12px);
        border-bottom: 2px solid rgba(220, 199, 162, 0.3);
        padding: 20px 24px;
        box-shadow: 0 4px 20px rgba(0, 8, 13, 0.5);
      }

      .spectator-title {
        font-family: 'Cinzel', serif;
        font-size: 32px;
        font-weight: 600;
        color: #DCC7A2;
        text-align: center;
        margin-bottom: 8px;
        text-shadow: 0 2px 8px rgba(220, 199, 162, 0.3);
      }

      .spectator-subtitle {
        text-align: center;
        color: #94A3B8;
        font-size: 14px;
        font-weight: 500;
      }

      .login-section {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.8), 
          rgba(0, 42, 75, 0.7));
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 16px;
        padding: 24px;
        margin: 24px;
        box-shadow: 0 8px 32px rgba(0, 8, 13, 0.6);
        backdrop-filter: blur(8px);
      }

      .login-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 400px;
        margin: 0 auto;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .form-label {
        font-weight: 600;
        color: #DCC7A2;
        font-size: 14px;
      }

      .form-input {
        padding: 12px 16px;
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #E2E8F0;
        font-size: 14px;
        font-family: inherit;
        backdrop-filter: blur(4px);
        transition: all 0.3s ease;
      }

      .form-input:focus {
        outline: none;
        border-color: #DCC7A2;
        box-shadow: 0 0 0 3px rgba(220, 199, 162, 0.1);
        background: rgba(0, 30, 53, 0.8);
      }

      .btn-primary {
        padding: 12px 24px;
        border: 2px solid #DCC7A2;
        border-radius: 12px;
        background: linear-gradient(145deg, #DCC7A2, #D4BA8D);
        color: #00080D;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .btn-primary:hover {
        background: linear-gradient(145deg, #D4BA8D, #DCC7A2);
        box-shadow: 0 8px 16px rgba(220, 199, 162, 0.3);
        transform: translateY(-2px);
      }

      .connection-status {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        margin-top: 16px;
        font-size: 14px;
        font-weight: 500;
      }

      .status-indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        animation: pulse 2s infinite;
      }

      .status-connected .status-indicator {
        background: #22C55E;
      }

      .status-disconnected .status-indicator {
        background: #EF4444;
      }

      .spectator-info {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin: 24px;
      }

      .info-card {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.8), 
          rgba(0, 42, 75, 0.7));
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 16px;
        padding: 20px;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 20px rgba(0, 8, 13, 0.5);
      }

      .info-card-title {
        font-weight: 600;
        color: #DCC7A2;
        font-size: 16px;
        margin-bottom: 12px;
      }

      .info-card-content {
        color: #94A3B8;
        font-size: 14px;
        line-height: 1.5;
      }

      .cheer-section {
        margin: 24px;
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.8), 
          rgba(0, 42, 75, 0.7));
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 16px;
        padding: 24px;
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 32px rgba(0, 8, 13, 0.6);
      }

      .cheer-title {
        font-family: 'Cinzel', serif;
        font-size: 24px;
        font-weight: 600;
        color: #DCC7A2;
        text-align: center;
        margin-bottom: 20px;
      }

      .quick-cheer-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 12px;
        margin-bottom: 20px;
      }

      .quick-cheer-btn {
        padding: 12px 8px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #DCC7A2;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        backdrop-filter: blur(4px);
        position: relative;
        overflow: hidden;
      }

      .quick-cheer-btn::before {
        content: attr(data-key);
        position: absolute;
        top: 4px;
        right: 6px;
        font-size: 10px;
        color: #64748B;
        font-weight: 400;
      }

      .quick-cheer-btn:hover {
        border-color: #DCC7A2;
        background: rgba(220, 199, 162, 0.15);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(220, 199, 162, 0.2);
      }

      .quick-cheer-btn:active {
        transform: translateY(0);
        box-shadow: 0 2px 8px rgba(220, 199, 162, 0.3);
      }

      .quick-cheer-btn.cooldown {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
      }

      .custom-cheer {
        display: flex;
        gap: 12px;
        margin-top: 16px;
      }

      .custom-cheer-input {
        flex: 1;
        padding: 12px 16px;
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #E2E8F0;
        font-size: 14px;
        backdrop-filter: blur(4px);
        transition: all 0.3s ease;
      }

      .custom-cheer-input:focus {
        outline: none;
        border-color: #DCC7A2;
        box-shadow: 0 0 0 3px rgba(220, 199, 162, 0.1);
      }

      .custom-cheer-input::placeholder {
        color: #64748B;
      }

      .team-cheer-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 20px;
      }

      .team-cheer-btn {
        padding: 12px 16px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #DCC7A2;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
      }

      .team-cheer-btn.phoenix {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.1);
      }

      .team-cheer-btn.phoenix:hover {
        border-color: #EF4444;
        background: rgba(239, 68, 68, 0.2);
        color: #FF6B6B;
      }

      .team-cheer-btn.eaters {
        border-color: rgba(34, 197, 94, 0.5);
        background: rgba(34, 197, 94, 0.1);
      }

      .team-cheer-btn.eaters:hover {
        border-color: #22C55E;
        background: rgba(34, 197, 94, 0.2);
        color: #4ADE80;
      }

      .battle-log-section {
        margin: 24px;
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.8), 
          rgba(0, 42, 75, 0.7));
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 16px;
        padding: 24px;
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 32px rgba(0, 8, 13, 0.6);
      }

      .log-title {
        font-family: 'Cinzel', serif;
        font-size: 24px;
        font-weight: 600;
        color: #DCC7A2;
        margin-bottom: 16px;
      }

      .battle-log-viewer {
        height: 300px;
        overflow-y: auto;
        border: 1px solid rgba(220, 199, 162, 0.2);
        border-radius: 12px;
        padding: 16px;
        background: rgba(0, 8, 13, 0.6);
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        line-height: 1.5;
        scrollbar-width: thin;
        scrollbar-color: #DCC7A2 transparent;
      }

      .battle-log-viewer::-webkit-scrollbar {
        width: 8px;
      }

      .battle-log-viewer::-webkit-scrollbar-track {
        background: rgba(0, 30, 53, 0.3);
        border-radius: 4px;
      }

      .battle-log-viewer::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #DCC7A2, #D4BA8D);
        border-radius: 4px;
      }

      .log-entry {
        margin-bottom: 8px;
        padding: 8px 12px;
        border-radius: 8px;
        border-left: 3px solid transparent;
        transition: all 0.2s ease;
      }

      .log-entry:hover {
        background: rgba(220, 199, 162, 0.05);
      }

      .log-system {
        color: #94A3B8;
        border-left-color: #3B82F6;
        background: rgba(59, 130, 246, 0.05);
      }

      .log-cheer {
        color: #DCC7A2;
        border-left-color: #F59E0B;
        background: rgba(245, 158, 11, 0.05);
      }

      .log-battle {
        color: #22C55E;
        border-left-color: #22C55E;
        background: rgba(34, 197, 94, 0.05);
      }

      .log-result {
        color: #EF4444;
        border-left-color: #EF4444;
        background: rgba(239, 68, 68, 0.05);
        font-weight: 600;
      }

      .log-timestamp {
        color: #64748B;
        font-size: 11px;
        margin-right: 8px;
      }

      .auto-login-notice {
        background: linear-gradient(145deg, 
          rgba(34, 197, 94, 0.1), 
          rgba(34, 197, 94, 0.05));
        border: 2px solid rgba(34, 197, 94, 0.3);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 20px;
        text-align: center;
      }

      .notice-title {
        font-weight: 600;
        color: #22C55E;
        font-size: 16px;
        margin-bottom: 8px;
      }

      .notice-text {
        color: #94A3B8;
        font-size: 14px;
      }

      .spectator-stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(220, 199, 162, 0.2);
      }

      .stat-item {
        text-align: center;
      }

      .stat-value {
        font-size: 18px;
        font-weight: 700;
        color: #DCC7A2;
      }

      .stat-label {
        font-size: 12px;
        color: #64748B;
        margin-top: 4px;
      }

      .cheer-cooldown-indicator {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 30, 53, 0.95);
        border: 2px solid #F59E0B;
        border-radius: 12px;
        padding: 12px 20px;
        color: #F59E0B;
        font-weight: 600;
        font-size: 14px;
        z-index: 10000;
        opacity: 0;
        animation: cooldownPulse 1s ease-out forwards;
      }

      @keyframes cooldownPulse {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* 모바일 최적화 */
      @media (max-width: 768px) {
        .spectator-title {
          font-size: 24px;
        }

        .quick-cheer-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }

        .team-cheer-section {
          grid-template-columns: 1fr;
        }

        .spectator-info {
          grid-template-columns: 1fr;
        }

        .custom-cheer {
          flex-direction: column;
        }

        .battle-log-viewer {
          height: 200px;
          font-size: 12px;
        }
      }

      /* 접근성 */
      @media (prefers-reduced-motion: reduce) {
        .quick-cheer-btn,
        .team-cheer-btn,
        .btn-primary {
          transition: none;
        }

        .cooldownPulse,
        .pulse {
          animation: none;
        }
      }
    `;

    document.head.appendChild(styleSheet);
  }

  initElements() {
    // 기존 요소들
    this.spectatorNameInput = document.querySelector('#spectatorName');
    this.loginBtn = document.querySelector('#loginBtn');
    this.connectionStatus = document.querySelector('#connectionStatus');
    this.battleLogViewer = document.querySelector('#battleLogViewer');
    this.quickCheerBtns = document.querySelectorAll('.quick-cheer-btn');
    this.customCheerInput = document.querySelector('#customCheerInput');
    this.sendCheerBtn = document.querySelector('#sendCheerBtn');

    // 새로운 요소들
    this.spectatorCountEl = document.querySelector('#spectatorCount');
    this.battleStatusEl = document.querySelector('#battleStatus');
    this.teamCheerBtns = document.querySelectorAll('.team-cheer-btn');
    this.autoLoginInfo = document.querySelector('#autoLoginInfo');

    // 키보드 단축키 표시 업데이트
    this.quickCheerBtns?.forEach((btn, index) => {
      const key = index === 9 ? '0' : (index + 1).toString();
      btn.setAttribute('data-key', key);
    });
  }

  setupEventListeners() {
    // 로그인 관련
    this.loginBtn?.addEventListener('click', () => this.login());
    this.spectatorNameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // 빠른 응원 버튼
    this.quickCheerBtns?.forEach((btn, index) => {
      btn.addEventListener('click', () => this.sendQuickCheer(index + 1));
    });

    // 팀별 응원 버튼
    this.teamCheerBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        const team = btn.classList.contains('phoenix') ? 'phoenix' : 'eaters';
        this.sendTeamCheer(team);
      });
    });

    // 커스텀 응원
    this.sendCheerBtn?.addEventListener('click', () => this.sendCustomCheer());
    this.customCheerInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendCustomCheer();
    });

    // 정리
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // 입력 필드에서는 단축키 무시
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // 숫자 키 1-9, 0
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        this.sendQuickCheer(parseInt(e.key));
      } else if (e.key === '0') {
        e.preventDefault();
        this.sendQuickCheer(0);
      }
      // P = 불사조 기사단 응원
      else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.sendTeamCheer('phoenix');
      }
      // E = 죽음을 먹는 자들 응원
      else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        this.sendTeamCheer('eaters');
      }
      // C = 커스텀 응원 입력창 포커스
      else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.customCheerInput?.focus();
      }
    });
  }

  async login() {
    const name = this.spectatorNameInput?.value?.trim();
    if (!name || name.length < 2 || name.length > 20) {
      this.showError('관전자 이름은 2~20자 사이로 입력해주세요.');
      return;
    }

    // 욕설/부적절한 이름 체크
    if (this.isInappropriateName(name)) {
      this.showError('적절하지 않은 이름입니다. 다른 이름을 사용해주세요.');
      return;
    }

    this.spectatorName = name;

    try {
      this.showLoading('서버에 연결 중...');
      await this.connectToServer();
      this.hideLoading();
      this.updateConnectionStatus(true);
      
      // 성공 알림
      if (window.PyxisNotify) {
        window.PyxisNotify.showToast(
          '관전 시작',
          `${this.spectatorName}님, 관전을 시작합니다`,
          'info'
        );
      }

      // 사운드 효과
      if (window.PyxisFX) {
        window.PyxisFX.playSound('soft', 600, 0.2, 0.3);
      }

    } catch (err) {
      this.hideLoading();
      this.updateConnectionStatus(false);
      this.showError('서버 연결 실패: ' + err.message);
    }
  }

  async connectToServer() {
    return new Promise((resolve, reject) => {
      const urlParams = new URLSearchParams(window.location.search);
      const otp = urlParams.get('otp');
      const battleId = this.battleId || urlParams.get('battle');

      if (!otp || !battleId) {
        reject(new Error('OTP 또는 전투 ID가 없습니다.'));
        return;
      }

      const socket = io('/', {
        query: {
          otp,
          name: this.spectatorName,
          battleId,
          type: 'spectator'
        },
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      this.socket = socket;

      socket.on('connect', () => {
        this.isConnected = true;
        this.registerSocketEvents();
        this.addLog('system', '관전을 시작했습니다');
        resolve();
      });

      socket.on('connect_error', (err) => {
        this.isConnected = false;
        reject(new Error('연결 실패: ' + (err.message || '알 수 없는 오류')));
      });

      socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.addLog('system', `연결 끊김: ${reason}`);
        
        if (window.PyxisNotify) {
          window.PyxisNotify.showToast(
            '연결 끊김',
            '서버와의 연결이 끊어졌습니다',
            'warning'
          );
        }
      });

      socket.on('reconnect', () => {
        this.isConnected = true;
        this.updateConnectionStatus(true);
        this.addLog('system', '서버에 다시 연결되었습니다');
        
        if (window.PyxisNotify) {
          window.PyxisNotify.showToast(
            '연결 복구',
            '서버와의 연결이 복구되었습니다',
            'info'
          );
        }
      });
    });
  }

  registerSocketEvents() {
    if (!this.socket) return;

    // 전투 정보 업데이트
    this.socket.on('battle:update', (data) => {
      this.battleData = data.battleData;
      this.players = data.players || [];
      this.updateBattleInfo();
      this.addLog('system', '전투 정보 갱신됨');
    });

    // 전투 상태 변경
    this.socket.on('battle:status', (status) => {
      this.updateBattleStatus(status);
      this.addLog('battle', `전투 상태: ${status}`);
    });

    // 응원 메시지 브로드캐스트
    this.socket.on('cheer:broadcast', (cheerData) => {
      const { spectatorName, message, type, team } = cheerData;
      this.addLog('cheer', `${spectatorName}: ${message}`, type);
      
      // 응원 이펙트
      if (window.PyxisFX && spectatorName !== this.spectatorName) {
        window.PyxisFX.playSound('soft', 500, 0.1, 0.2);
      }
    });

    // 전투 액션 로그
    this.socket.on('battle:action', (actionData) => {
      const { player, action, result, damage } = actionData;
      let logMessage = `${player}의 ${action}`;
      
      if (result === 'hit' && damage) {
        logMessage += ` → ${damage} 대미지`;
      } else if (result === 'critical' && damage) {
        logMessage += ` → 치명타 ${damage} 대미지!`;
      } else if (result === 'miss') {
        logMessage += ` → 빗나감`;
      } else if (result === 'dodge') {
        logMessage += ` → 회피됨`;
      }
      
      this.addLog('battle', logMessage);
      this.triggerAutoCheer(result, damage);
    });

    // 전투 종료
    this.socket.on('battle:end', (result) => {
      const { winner, winnerTeam, reason } = result;
      this.addLog('result', `전투 종료! 승리팀: ${winnerTeam || winner}`);
      
      if (reason) {
        this.addLog('result', `종료 사유: ${reason}`);
      }

      // 승리 축하 알림
      if (window.PyxisNotify) {
        window.PyxisNotify.victoryNotification(winnerTeam || winner, reason);
      }

      // 승리 이펙트
      if (window.PyxisFX) {
        window.PyxisFX.screenFlash('rgba(220, 199, 162, 0.3)');
        window.PyxisFX.playSound('victory', 800, 0.8, 0.4);
      }
    });

    // 관전자 수 업데이트
    this.socket.on('spectator:count', (count) => {
      this.spectatorCount = count;
      this.updateSpectatorCount();
    });

    // 플레이어 참가/이탈
    this.socket.on('player:joined', (playerData) => {
      const { name, team } = playerData;
      this.addLog('system', `${name}님이 ${team}에 참가했습니다`);
    });

    this.socket.on('player:left', (playerData) => {
      const { name } = playerData;
      this.addLog('system', `${name}님이 전투를 떠났습니다`);
    });

    // 턴 변경
    this.socket.on('turn:change', (turnData) => {
      const { currentPlayer, team, turnNumber } = turnData;
      this.addLog('battle', `턴 ${turnNumber}: ${currentPlayer}님의 차례 (${team})`);
    });

    // 에러 처리
    this.socket.on('error', (errorData) => {
      this.addLog('system', `오류: ${errorData.message}`);
      this.showError(errorData.message);
    });
  }

  // 자동 응원 트리거
  triggerAutoCheer(result, damage) {
    if (!this.isConnected || Date.now() - this.lastCheerTime < this.cheerCooldown * 3) return;

    let autoMessage = null;

    switch (result) {
      case 'critical':
        autoMessage = this.getRandomMessage(this.situationMessages.critical);
        break;
      case 'miss':
        autoMessage = this.getRandomMessage(this.situationMessages.miss);
        break;
      case 'lowHp':
        autoMessage = this.getRandomMessage(this.situationMessages.lowHp);
        break;
    }

    if (autoMessage && Math.random() < 0.3) { // 30% 확률로 자동 응원
      setTimeout(() => {
        this.sendCheer(autoMessage, 'auto');
      }, 500 + Math.random() * 1000); // 0.5~1.5초 지연
    }
  }

  sendQuickCheer(number) {
    if (!this.canSendCheer()) return;

    const messages = this.cheerMessages[number] || this.cheerMessages[1];
    const message = this.getRandomMessage(messages);
    this.sendCheer(message, 'quick', number);
    this.applyCooldown();
  }

  sendTeamCheer(team) {
    if (!this.canSendCheer()) return;

    const messages = this.teamCheerMessages[team] || ['팀 응원!'];
    const message = this.getRandomMessage(messages);
    this.sendCheer(message, 'team', team);
    this.applyCooldown();
  }

  sendCustomCheer() {
    if (!this.canSendCheer()) return;

    const message = this.customCheerInput?.value?.trim();
    if (!message || message.length > 100) {
      this.showError('응원 메시지는 1~100자 사이로 입력해주세요.');
      return;
    }

    // 부적절한 내용 체크
    if (this.isInappropriateMessage(message)) {
      this.showError('적절하지 않은 메시지입니다.');
      return;
    }

    this.sendCheer(message, 'custom');
    this.customCheerInput.value = '';
    this.applyCooldown();
  }

  sendCheer(message, type, extra = null) {
    if (!this.socket?.connected) {
      this.showError('서버에 연결되지 않았습니다.');
      return;
    }

    const cheerData = {
      spectatorName: this.spectatorName,
      message,
      type,
      extra,
      timestamp: Date.now()
    };

    // 서버로 전송
    this.socket.emit('spectator:cheer', cheerData);

    // 로컬 로그에 추가
    this.addLog('cheer', `${this.spectatorName}: ${message}`, type);

    // 이펙트
    if (window.PyxisFX) {
      window.PyxisFX.playSound('button', 700, 0.15, 0.25);
      window.PyxisFX.vibrate(20);
    }

    this.lastCheerTime = Date.now();
  }

  canSendCheer() {
    if (!this.isConnected) {
      this.showError('서버에 연결되지 않았습니다.');
      return false;
    }

    const timeSinceLastCheer = Date.now() - this.lastCheerTime;
    if (timeSinceLastCheer < this.cheerCooldown) {
      this.showCooldownIndicator();
      return false;
    }

    return true;
  }

  applyCooldown() {
    // 버튼들에 쿨다운 스타일 적용
    this.quickCheerBtns?.forEach(btn => {
      btn.classList.add('cooldown');
    });

    this.teamCheerBtns?.forEach(btn => {
      btn.classList.add('cooldown');
    });

    if (this.sendCheerBtn) {
      this.sendCheerBtn.disabled = true;
    }

    // 쿨다운 해제
    setTimeout(() => {
      this.quickCheerBtns?.forEach(btn => {
        btn.classList.remove('cooldown');
      });

      this.teamCheerBtns?.forEach(btn => {
        btn.classList.remove('cooldown');
      });

      if (this.sendCheerBtn) {
        this.sendCheerBtn.disabled = false;
      }
    }, this.cheerCooldown);
  }

  showCooldownIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'cheer-cooldown-indicator';
    indicator.textContent = '응원 쿨타임 중...';
    document.body.appendChild(indicator);

    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.remove();
      }
    }, 1000);
  }

  addLog(type, message, subType = null) {
    if (!this.battleLogViewer) return;

    const timestamp = new Date().toLocaleTimeString('ko-KR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const logEl = document.createElement('div');
    logEl.className = `log-entry log-${type}`;
    
    if (subType) {
      logEl.classList.add(`log-${subType}`);
    }

    logEl.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-content">${message}</span>
    `;

    this.battleLogViewer.appendChild(logEl);

    // 스크롤을 맨 아래로
    this.battleLogViewer.scrollTop = this.battleLogViewer.scrollHeight;

    // 로그 개수 제한 (성능 최적화)
    const logs = this.battleLogViewer.querySelectorAll('.log-entry');
    if (logs.length > 200) {
      logs[0].remove();
    }

    // 로그 배열에도 저장
    this.battleLog.push({
      type,
      message,
      timestamp: Date.now(),
      subType
    });
  }

  updateConnectionStatus(connected) {
    if (!this.connectionStatus) return;

    const statusText = connected ? '연결됨' : '연결 끊김';
    const statusClass = connected ? 'status-connected' : 'status-disconnected';

    this.connectionStatus.innerHTML = `
      <div class="status-indicator"></div>
      <span>${statusText}</span>
    `;
    this.connectionStatus.className = `connection-status ${statusClass}`;
  }

  updateSpectatorCount() {
    if (this.spectatorCountEl) {
      this.spectatorCountEl.textContent = `${this.spectatorCount}명 관전 중`;
    }
  }

  updateBattleInfo() {
    if (!this.battleData) return;

    // 전투 상태 업데이트
    this.updateBattleStatus(this.battleData.status || 'waiting');

    // 플레이어 정보 업데이트 등 추가 로직
    if (this.battleStatusEl) {
      const { mode, currentTurn, status } = this.battleData;
      this.battleStatusEl.innerHTML = `
        <div class="battle-mode">${mode || '2v2'} 전투</div>
        <div class="battle-turn">턴 ${currentTurn || 1}</div>
        <div class="battle-status">${this.getStatusText(status)}</div>
      `;
    }
  }

  updateBattleStatus(status) {
    // 상태별 다른 처리 로직
    switch (status) {
      case 'waiting':
        this.addLog('system', '전투 대기 중...');
        break;
      case 'active':
        this.addLog('system', '전투 진행 중');
        break;
      case 'paused':
        this.addLog('system', '전투 일시정지');
        break;
      case 'ended':
        this.addLog('system', '전투 종료');
        break;
    }
  }

  getStatusText(status) {
    const statusMap = {
      waiting: '대기 중',
      active: '진행 중',
      paused: '일시정지',
      ended: '종료됨'
    };
    return statusMap[status] || '알 수 없음';
  }

  showAutoLogin(otp) {
    if (!this.autoLoginInfo) return;

    this.autoLoginInfo.innerHTML = `
      <div class="auto-login-notice">
        <div class="notice-title">관전자 OTP 확인됨</div>
        <div class="notice-text">관전자 이름을 입력하고 입장해주세요</div>
        <div class="notice-text">키보드 단축키: 1-9,0 (빠른응원), P (불사조), E (죽음을먹는자들), C (커스텀응원)</div>
      </div>
    `;
  }

  showError(message) {
    if (window.PyxisNotify) {
      window.PyxisNotify.showToast('오류', message, 'error');
    } else {
      alert('오류: ' + message);
    }
  }

  showLoading(message) {
    if (window.PyxisNotify) {
      this.loadingToastId = window.PyxisNotify.showToast('로딩', message, 'info', {
        persistent: true,
        closable: false
      });
    }
  }

  hideLoading() {
    if (this.loadingToastId && window.PyxisNotify) {
      window.PyxisNotify.removeToast(this.loadingToastId);
      this.loadingToastId = null;
    }
  }

  getRandomMessage(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  isInappropriateName(name) {
    const inappropriate = ['관리자', 'admin', 'root', 'system', 'bot'];
    return inappropriate.some(word => name.toLowerCase().includes(word));
  }

  isInappropriateMessage(message) {
    // 기본적인 부적절한 내용 필터링
    const inappropriate = ['욕설', '비방', '광고'];
    return inappropriate.some(word => message.includes(word));
  }

  // 관전자 통계 내보내기
  exportLog() {
    const logData = {
      spectatorName: this.spectatorName,
      battleId: this.battleId,
      logs: this.battleLog,
      exportTime: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(logData, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pyxis-spectator-log-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.PyxisNotify) {
      window.PyxisNotify.showToast(
        '로그 내보내기',
        '관전 로그가 다운로드되었습니다',
        'info'
      );
    }
  }

  // 설정 관리
  getSettings() {
    return {
      spectatorName: this.spectatorName,
      cheerCooldown: this.cheerCooldown,
      autoCheerEnabled: true,
      soundEnabled: window.PyxisFX?.soundEnabled || false,
      notificationsEnabled: window.PyxisNotify?.enabled || false
    };
  }

  updateSettings(settings) {
    if (settings.cheerCooldown) {
      this.cheerCooldown = Math.max(500, Math.min(5000, settings.cheerCooldown));
    }

    if (settings.soundEnabled !== undefined && window.PyxisFX) {
      window.PyxisFX.setSoundEnabled(settings.soundEnabled);
    }

    if (settings.notificationsEnabled !== undefined && window.PyxisNotify) {
      window.PyxisNotify.setEnabled(settings.notificationsEnabled);
    }
  }

  // 정리
  cleanup() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnected = false;
    this.battleLog = [];
    this.players = [];
    this.battleData = null;

    console.log('PYXIS Spectator Interface cleaned up');
  }

  // 디버그 및 테스트 메서드
  testFeatures() {
    console.log('PYXIS Spectator Interface 테스트 중...');
    
    // 가짜 로그 추가
    setTimeout(() => this.addLog('system', '테스트 시스템 메시지'), 0);
    setTimeout(() => this.addLog('cheer', '테스트관전자: 힘내라!'), 500);
    setTimeout(() => this.addLog('battle', '테스트플레이어의 공격 → 15 대미지'), 1000);
    setTimeout(() => this.addLog('result', '테스트: 불사조 기사단 승리!'), 1500);

    // 연결 상태 토글
    setTimeout(() => {
      this.updateConnectionStatus(false);
      setTimeout(() => this.updateConnectionStatus(true), 1000);
    }, 2000);
  }

  getStatus() {
    return {
      connected: this.isConnected,
      spectatorName: this.spectatorName,
      battleId: this.battleId,
      spectatorCount: this.spectatorCount,
      logCount: this.battleLog.length,
      lastCheerTime: this.lastCheerTime,
      cooldownRemaining: Math.max(0, this.cheerCooldown - (Date.now() - this.lastCheerTime))
    };
  }
}

// 전역 인스턴스 생성
window.PyxisSpectatorInterface = PyxisSpectatorInterface;

// DOM 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.spectatorInterface = new PyxisSpectatorInterface();
  console.log('PYXIS Spectator Interface initialized');
});

// 호환성을 위한 별칭
window.SpectatorInterface = PyxisSpectatorInterface;
