class SpectatorInterface {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.spectatorName = '';
    this.battleId = null;
    this.battleData = null;
    this.players = [];
    this.battleLog = [];

    this.cheerMessages = {
      1: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      2: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      3: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      4: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      5: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      6: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      7: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      8: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      9: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!'],
      0: ['힘내라!', '최고야!', '역전 가자!', '죽으면 죽어!']
    };

    this.init();
  }

  init() {
    document.addEventListener('DOMContentLoaded', () => {
      this.initElements();
      this.setupEventListeners();

      const urlParams = new URLSearchParams(window.location.search);
      const otp = urlParams.get('otp');
      const battleId = urlParams.get('battle');
      if (otp && battleId) {
        this.battleId = battleId;
        this.showAutoLogin(otp);
      }
    });
  }

  initElements() {
    this.spectatorNameInput = document.querySelector('#spectatorName');
    this.loginBtn = document.querySelector('#loginBtn');
    this.connectionStatus = document.querySelector('#connectionStatus');
    this.battleLogViewer = document.querySelector('#battleLogViewer');
    this.quickCheerBtns = document.querySelectorAll('.quick-cheer-btn');
    this.customCheerInput = document.querySelector('#customCheerInput');
    this.sendCheerBtn = document.querySelector('#sendCheerBtn');
  }

  setupEventListeners() {
    this.loginBtn?.addEventListener('click', () => this.login());
    this.spectatorNameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    this.quickCheerBtns?.forEach((btn, index) => {
      btn.addEventListener('click', () => this.sendQuickCheer(index + 1));
    });

    this.sendCheerBtn?.addEventListener('click', () => this.sendCustomCheer());
    this.customCheerInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendCustomCheer();
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        this.sendQuickCheer(parseInt(e.key));
      } else if (e.key === '0') {
        e.preventDefault();
        this.sendQuickCheer(0);
      }
    });

    window.addEventListener('beforeunload', () => this.cleanup());
  }

  async login() {
    const name = this.spectatorNameInput?.value?.trim();
    if (!name || name.length < 2 || name.length > 12) {
      alert('관전자 이름은 2~12자 사이로 입력해주세요.');
      return;
    }

    this.spectatorName = name;

    try {
      await this.connectToServer();
      this.updateConnectionStatus(true);
    } catch (err) {
      this.updateConnectionStatus(false);
      alert('서버 연결 실패: ' + err.message);
    }
  }

  async connectToServer() {
    return new Promise((resolve, reject) => {
      const urlParams = new URLSearchParams(window.location.search);
      const otp = urlParams.get('otp');
      const battleId = this.battleId || urlParams.get('battle');

      const socket = io('/', {
        query: {
          otp,
          name: this.spectatorName,
          battleId
        },
        transports: ['websocket'],
        timeout: 5000
      });

      this.socket = socket;

      socket.on('connect', () => {
        this.isConnected = true;
        this.registerSocketEvents();
        resolve();
      });

      socket.on('connect_error', (err) => {
        this.isConnected = false;
        reject(err);
      });

      socket.on('disconnect', () => {
        this.isConnected = false;
        this.updateConnectionStatus(false);
      });
    });
  }

  registerSocketEvents() {
    this.socket.on('battle:update', (data) => {
      this.battleData = data.battleData;
      this.players = data.players;
      this.addLog('system', '전투 정보 갱신됨');
    });

    this.socket.on('cheer:broadcast', (cheerData) => {
      const { spectatorName, message } = cheerData;
      this.addLog('cheer', `${spectatorName}: ${message}`);
    });

    this.socket.on('battle:end', (result) => {
      this.addLog('system', '전투 종료');
      this.addLog('result', `승리팀: ${result.winner}`);
    });

    this.socket.on('spectator:count', (count) => {
      const el = document.querySelector('#spectatorCount');
      if (el) el.textContent = `${count}명 관전 중`;
    });
  }

  sendQuickCheer(number) {
    if (!this.isConnected) return;
    const messages = this.cheerMessages[number] || this.cheerMessages[1];
    const message = messages[Math.floor(Math.random() * messages.length)];
    this.sendCheer(message, 'quick', number);
  }

  sendCustomCheer() {
    const message = this.customCheerInput?.value?.trim();
    if (!message) return;
    this.sendCheer(message, 'custom');
    this.customCheerInput.value = '';
  }

  sendCheer(message, type, number) {
    if (this.socket?.connected) {
      const cheerData = {
        spectatorName: this.spectatorName,
        message,
        type,
        number,
        timestamp: Date.now()
      };
      this.socket.emit('spectator:cheer', cheerData);
    }

    this.addLog('cheer', `${this.spectatorName}: ${message}`);
  }

  addLog(type, message) {
    const logEl = document.createElement('div');
    logEl.className = `log-entry log-${type}`;
    logEl.textContent = message;
    if (this.battleLogViewer) {
      this.battleLogViewer.appendChild(logEl);
      this.battleLogViewer.scrollTop = this.battleLogViewer.scrollHeight;
    }
  }

  updateConnectionStatus(connected) {
    if (!this.connectionStatus) return;
    this.connectionStatus.textContent = connected ? '연결됨' : '연결 끊김';
    this.connectionStatus.className = connected ? 'status-connected' : 'status-disconnected';
  }

  showAutoLogin(otp) {
    const autoLoginInfo = document.querySelector('#autoLoginInfo');
    if (autoLoginInfo) {
      autoLoginInfo.innerHTML = `
        <div class="auto-login-notice">
          <div class="notice-title">관전자 OTP 확인됨</div>
          <div class="notice-text">관전자 이름을 입력하고 입장해주세요.</div>
        </div>
      `;
    }
  }

  cleanup() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

window.SpectatorInterface = SpectatorInterface;
document.addEventListener('DOMContentLoaded', () => {
  window.spectatorInterface = new SpectatorInterface();
});
