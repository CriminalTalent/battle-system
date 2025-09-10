// PYXIS Spectator Interface - Enhanced Gaming Viewer (Revised)
// - 단축키(키보드) 응원 기능 제거
// - 빠른 응원 메시지 → 버튼 고정 6개, 멘트: "멋지다!", "이겨라!", "살아서 돌아와!", "화이팅!", "죽으면 나한테 죽어!", "힘내요!"
// - UI: 좌측 불사조 기사단, 우측 죽음을 먹는 자, 중앙 턴 플레이어 이미지, 하단 넓은 로그+채팅

class PyxisSpectatorInterface {
  constructor() {
    // 연결/상태
    this.socket = null;
    this.isConnected = false;
    this.spectatorName = '';
    this.battleId = null;
    this.battleData = null;
    this.players = [];
    this.battleLog = [];
    this.spectatorCount = 0;

    // 응원
    this.lastCheerTime = 0;
    this.cheerCooldown = 1000; // 1초
    this.loadingToastId = null;

    // 고정 응원 메시지 (버튼 6개)
    this.fixedCheerMessages = [
      '멋지다!',
      '이겨라!',
      '살아서 돌아와!',
      '화이팅!',
      '죽으면 나한테 죽어!',
      '힘내요!'
    ];

    // 부트스트랩
    this._bootstrap();
  }

  /* ========== Bootstrap / Init ========== */
  _bootstrap() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._onReady(), { once: true });
    } else {
      this._onReady();
    }
  }

  _onReady() {
    this.injectStyles();
    this.initElements();
    this.setupEventListeners();

    const urlParams = new URLSearchParams(window.location.search);
    const otp = urlParams.get('otp');
    const battleId = urlParams.get('battle');
    if (otp && battleId) {
      this.battleId = battleId;
      this.showAutoLogin(otp);
    }
  }

  /* ========== Styles ========== */
  injectStyles() {
    if (document.getElementById('pyxis-spectator-styles')) return;
    const styleSheet = document.createElement('style');
    styleSheet.id = 'pyxis-spectator-styles';
    styleSheet.textContent = `
      .pyxis-spectator-main {
        display: grid;
        grid-template-columns: 1.2fr 1fr 1.2fr;
        gap: 24px;
        align-items: stretch;
        margin: 0 auto;
        max-width: 1200px;
        min-height: 540px;
        padding: 24px 0 0 0;
      }
      .pyxis-team-panel {
        background: rgba(30,30,40,0.7);
        border-radius: 14px;
        padding: 18px 12px;
        min-width: 220px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-shadow: 0 2px 16px 0 rgba(0,0,0,0.08);
      }
      .pyxis-team-title {
        font-family: 'Playfair Display', serif;
        font-size: 20px;
        font-weight: bold;
        color: #DCC7A2;
        margin-bottom: 8px;
        letter-spacing: 1px;
        text-align: center;
      }
      .pyxis-player-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .pyxis-player-card {
        background: rgba(44,44,60,0.7);
        border-radius: 8px;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .pyxis-player-avatar {
        width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 2px solid #DCC7A2;
      }
      .pyxis-player-info {
        flex: 1;
      }
      .pyxis-center-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        min-width: 200px;
      }
      .pyxis-turn-avatar {
        width: 96px; height: 96px; border-radius: 50%; object-fit: cover; border: 3px solid #DCC7A2; margin-bottom: 10px;
        box-shadow: 0 0 24px 0 rgba(220,199,162,0.25);
        background: #222;
      }
      .pyxis-turn-name {
        font-size: 18px;
        font-weight: bold;
        color: #DCC7A2;
        margin-bottom: 8px;
        text-align: center;
      }
      .pyxis-battle-status {
        margin-top: 12px;
        color: #D4BA8D;
        font-size: 15px;
        text-align: center;
      }
      .pyxis-bottom-area {
        margin: 32px auto 0 auto;
        max-width: 1200px;
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 24px;
        align-items: stretch;
      }
      .pyxis-log-chat {
        background: rgba(30,30,40,0.7);
        border-radius: 14px;
        padding: 16px;
        min-height: 180px;
        display: flex;
        flex-direction: column;
        height: 260px;
      }
      .pyxis-log-title {
        font-size: 15px;
        color: #DCC7A2;
        margin-bottom: 8px;
        font-weight: bold;
      }
      .pyxis-log-list {
        flex: 1;
        overflow-y: auto;
        font-size: 13px;
        color: #eee;
        margin-bottom: 8px;
      }
      .pyxis-chat-input-row {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
      .pyxis-chat-input {
        flex: 1;
        border-radius: 6px;
        border: 1px solid #DCC7A2;
        padding: 6px 10px;
        background: #222;
        color: #fff;
        font-size: 14px;
      }
      .pyxis-chat-btn {
        background: linear-gradient(90deg,#DCC7A2,#D4BA8D);
        color: #222;
        border: none;
        border-radius: 6px;
        padding: 6px 16px;
        font-weight: bold;
        cursor: pointer;
        transition: box-shadow 0.2s;
      }
      .pyxis-chat-btn:hover { box-shadow: 0 2px 8px 0 rgba(220,199,162,0.15);}
      .pyxis-cheer-panel {
        background: rgba(30,30,40,0.7);
        border-radius: 14px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 260px;
        justify-content: flex-start;
      }
      .pyxis-cheer-title {
        font-size: 15px;
        color: #DCC7A2;
        margin-bottom: 8px;
        font-weight: bold;
      }
      .pyxis-cheer-btns {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .quick-cheer-btn {
        background: #222;
        color: #DCC7A2;
        border: 1px solid #DCC7A2;
        border-radius: 6px;
        padding: 8px 0;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
      }
      .quick-cheer-btn.cooldown { opacity: 0.5; pointer-events: none; }
      @media (max-width: 900px) {
        .pyxis-spectator-main, .pyxis-bottom-area { grid-template-columns: 1fr; max-width: 98vw; }
        .pyxis-center-panel { min-width: 0; }
      }
    `;
    document.head.appendChild(styleSheet);
  }

  /* ========== Elements & Events ========== */
  initElements() {
    // 메인 구조 동적 생성
    if (!document.getElementById('pyxis-spectator-root')) {
      const root = document.createElement('div');
      root.id = 'pyxis-spectator-root';
      root.innerHTML = `
        <div class="pyxis-spectator-main">
          <div class="pyxis-team-panel" id="pyxis-team-left"></div>
          <div class="pyxis-center-panel" id="pyxis-center-panel"></div>
          <div class="pyxis-team-panel" id="pyxis-team-right"></div>
        </div>
        <div class="pyxis-bottom-area">
          <div class="pyxis-log-chat">
            <div class="pyxis-log-title">전투 로그 & 채팅</div>
            <div class="pyxis-log-list" id="pyxis-log-list"></div>
            <div class="pyxis-chat-input-row">
              <input class="pyxis-chat-input" id="pyxis-chat-input" maxlength="100" placeholder="메시지 입력" />
              <button class="pyxis-chat-btn" id="pyxis-chat-btn">전송</button>
            </div>
          </div>
          <div class="pyxis-cheer-panel">
            <div class="pyxis-cheer-title">빠른 응원</div>
            <div class="pyxis-cheer-btns">
              <button class="quick-cheer-btn"></button>
              <button class="quick-cheer-btn"></button>
              <button class="quick-cheer-btn"></button>
              <button class="quick-cheer-btn"></button>
              <button class="quick-cheer-btn"></button>
              <button class="quick-cheer-btn"></button>
            </div>
          </div>
        </div>
      `;
      document.body.prepend(root);
    }

    this.leftPanel = document.getElementById('pyxis-team-left');
    this.rightPanel = document.getElementById('pyxis-team-right');
    this.centerPanel = document.getElementById('pyxis-center-panel');
    this.logList = document.getElementById('pyxis-log-list');
    this.chatInput = document.getElementById('pyxis-chat-input');
    this.chatBtn = document.getElementById('pyxis-chat-btn');
    this.quickCheerBtns = document.querySelectorAll('.quick-cheer-btn');
  }

  setupEventListeners() {
    // 채팅
    this.chatBtn?.addEventListener('click', () => this.sendChat());
    this.chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // 고정 응원 버튼
    if (this.quickCheerBtns?.length) {
      this.quickCheerBtns.forEach((btn, idx) => {
        btn.textContent = this.fixedCheerMessages[idx] || '';
        btn.onclick = () => this.sendFixedCheer(idx);
      });
    }
  }

  /* ========== Socket & Battle Info ========== */
  connect(battleId, otp, spectatorName) {
    this.battleId = battleId;
    this.spectatorName = spectatorName;

    this.socket = io('/', {
      query: { otp, name: spectatorName, battleId, type: 'spectator' },
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    this.registerSocketEvents();
  }

  registerSocketEvents() {
    if (!this.socket) return;

    this.socket.on('battle:update', (data) => {
      this.battleData = data?.battleData || data || {};
      this.players = data?.players || [];
      this.renderTeams();
      this.renderTurnPlayer();
      this.addLog('system', '전투 정보 갱신됨');
    });

    this.socket.on('battle:log', (entry) => {
      this.addLog(entry.type || 'log', entry.message || '');
    });

    this.socket.on('battle:chat', (msg) => {
      this.addLog('chat', `${msg.name || '익명'}: ${msg.message || ''}`);
    });
  }

  /* ========== UI Rendering ========== */
  renderTeams() {
    // 좌측: 불사조 기사단, 우측: 죽음을 먹는 자
    if (!this.leftPanel || !this.rightPanel) return;
    const phoenix = (this.players || []).filter(p => p.team === 'phoenix');
    const eaters = (this.players || []).filter(p => p.team === 'eaters');

    this.leftPanel.innerHTML = `<div class="pyxis-team-title">불사조 기사단</div>
      <div class="pyxis-player-list">
        ${phoenix.map(p => `
          <div class="pyxis-player-card">
            <img class="pyxis-player-avatar" src="${p.avatar || '/assets/default-avatar.png'}" alt="아바타" />
            <div class="pyxis-player-info">
              <div><b>${p.name}</b></div>
              <div style="font-size:12px;color:#D4BA8D;">HP: ${p.hp}</div>
            </div>
          </div>
        `).join('')}
      </div>`;

    this.rightPanel.innerHTML = `<div class="pyxis-team-title">죽음을 먹는 자</div>
      <div class="pyxis-player-list">
        ${eaters.map(p => `
          <div class="pyxis-player-card">
            <img class="pyxis-player-avatar" src="${p.avatar || '/assets/default-avatar.png'}" alt="아바타" />
            <div class="pyxis-player-info">
              <div><b>${p.name}</b></div>
              <div style="font-size:12px;color:#D4BA8D;">HP: ${p.hp}</div>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  renderTurnPlayer() {
    if (!this.centerPanel) return;
    const turnId = this.battleData?.current || this.battleData?.currentTurnPlayerId;
    const turnPlayer = (this.players || []).find(p => p.id === turnId);
    if (!turnPlayer) {
      this.centerPanel.innerHTML = `<div class="pyxis-turn-name">대기 중...</div>`;
      return;
    }
    this.centerPanel.innerHTML = `
      <img class="pyxis-turn-avatar" src="${turnPlayer.avatar || '/assets/default-avatar.png'}" alt="현재 턴" />
      <div class="pyxis-turn-name">${turnPlayer.name}</div>
      <div class="pyxis-battle-status">현재 턴</div>
    `;
  }

  /* ========== 채팅/로그 ========== */
  addLog(type, message) {
    if (!this.logList) return;
    const ts = new Date();
    const timestamp = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
    const logEl = document.createElement('div');
    logEl.className = `log-entry log-${type}`;
    logEl.innerHTML = `<span style="color:#D4BA8D;">[${timestamp}]</span> <span>${message}</span>`;
    this.logList.appendChild(logEl);
    this.logList.scrollTop = this.logList.scrollHeight;
    const logs = this.logList.querySelectorAll('.log-entry');
    if (logs.length > 200) logs[0].remove();
  }

  sendChat() {
    const msg = (this.chatInput?.value || '').trim();
    if (!msg) return;
    if (msg.length > 100) return this.addLog('system', '메시지는 100자 이내로 입력하세요.');
    if (!this.socket?.connected) return this.addLog('system', '서버에 연결되어 있지 않습니다.');
    this.socket.emit('battle:chat', { name: this.spectatorName || '관전자', message: msg });
    this.chatInput.value = '';
  }

  /* ========== 응원 ========== */
  sendFixedCheer(idx) {
    if (!this.socket?.connected) {
      this.addLog('system', '서버에 연결되어 있지 않습니다.');
      return;
    }
    const message = this.fixedCheerMessages[idx] || '';
    if (!message) return;
    this.socket.emit('spectator:cheer', {
      spectatorName: this.spectatorName,
      message,
      type: 'fixed',
      extra: idx,
      timestamp: Date.now()
    });
    this.addLog('cheer', `${this.spectatorName}: ${message}`);
    this.lastCheerTime = Date.now();
    this.applyCooldown();
  }

  applyCooldown() {
    this.quickCheerBtns?.forEach(btn => btn.classList.add('cooldown'));
    setTimeout(() => {
      this.quickCheerBtns?.forEach(btn => btn.classList.remove('cooldown'));
    }, this.cheerCooldown);
  }

  showAutoLogin(/*otp*/) {
    // 관전자 이름 입력 안내 등 필요시 구현
  }
}

// 전역 노출(클래스)
window.PyxisSpectatorInterface = PyxisSpectatorInterface;

// DOM 로드 후 인스턴스 생성
document.addEventListener('DOMContentLoaded', () => {
  window.spectatorInterface = new PyxisSpectatorInterface();
  console.log('PYXIS Spectator Interface initialized');
});

// 호환 별칭
window.SpectatorInterface = PyxisSpectatorInterface;
