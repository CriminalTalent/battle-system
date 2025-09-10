// PYXIS Spectator Interface - Enhanced Gaming Viewer (Revised)
// - 단축키(키보드) 응원 기능 제거
// - 빠른 응원 메시지 → 버튼 고정 6개, 멘트: "멋지다!", "이겨라!", "살아서 돌아와!", "화이팅!", "죽으면 나한테 죽어!", "힘내요!"
// - 버튼 내 멘트 고정, 랜덤 메시지/번호 매핑 제거

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

    // 팀별 응원/상황별 자동응원 등은 사용하지 않음

    // 부트스트랩: DOM 준비 상태에 따라 즉시 실행/대기
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
    // 단축키 제거: this.setupKeyboardShortcuts();

    const urlParams = new URLSearchParams(window.location.search);
    const otp = urlParams.get('otp');
    const battleId = urlParams.get('battle');

    if (otp && battleId) {
      this.battleId = battleId;
      this.showAutoLogin(otp);
    }

    if (window.PyxisFX) {
      window.PyxisFX.enhanceClicks();
    }
  }

  /* ========== Styles ========== */
  injectStyles() {
    if (document.getElementById('pyxis-spectator-styles')) return;
    const styleSheet = document.createElement('style');
    styleSheet.id = 'pyxis-spectator-styles';
    styleSheet.textContent = `
      /* PYXIS Spectator Interface Enhancements */
      .spectator-container{min-height:100vh;background:linear-gradient(135deg,#00080D 0%,#001E35 100%);color:#E2E8F0;font-family:Inter,system-ui,sans-serif}
      .spectator-header{background:linear-gradient(145deg,rgba(0,30,53,.9),rgba(0,42,75,.8));backdrop-filter:blur(12px);border-bottom:2px solid rgba(220,199,162,.3);padding:20px 24px;box-shadow:0 4px 20px rgba(0,8,13,.5)}
      .spectator-title{font-family:Cinzel,serif;font-size:32px;font-weight:600;color:#DCC7A2;text-align:center;margin-bottom:8px;text-shadow:0 2px 8px rgba(220,199,162,.3)}
      .spectator-subtitle{text-align:center;color:#94A3B8;font-size:14px;font-weight:500}
      .login-section{background:linear-gradient(145deg,rgba(0,30,53,.8),rgba(0,42,75,.7));border:2px solid rgba(220,199,162,.25);border-radius:16px;padding:24px;margin:24px;box-shadow:0 8px 32px rgba(0,8,13,.6);backdrop-filter:blur(8px)}
      .login-form{display:flex;flex-direction:column;gap:16px;max-width:400px;margin:0 auto}
      .form-group{display:flex;flex-direction:column;gap:8px}
      .form-label{font-weight:600;color:#DCC7A2;font-size:14px}
      .form-input{padding:12px 16px;border:2px solid rgba(220,199,162,.25);border-radius:12px;background:rgba(0,30,53,.6);color:#E2E8F0;font-size:14px;backdrop-filter:blur(4px);transition:all .3s}
      .form-input:focus{outline:none;border-color:#DCC7A2;box-shadow:0 0 0 3px rgba(220,199,162,.1);background:rgba(0,30,53,.8)}
      .btn-primary{padding:12px 24px;border:2px solid #DCC7A2;border-radius:12px;background:linear-gradient(145deg,#DCC7A2,#D4BA8D);color:#00080D;font-weight:600;font-size:14px;cursor:pointer;transition:all .3s;text-transform:uppercase;letter-spacing:.5px}
      .btn-primary:hover{background:linear-gradient(145deg,#D4BA8D,#DCC7A2);box-shadow:0 8px 16px rgba(220,199,162,.3);transform:translateY(-2px)}
      .connection-status{display:flex;align-items:center;gap:8px;justify-content:center;margin-top:16px;font-size:14px;font-weight:500}
      .status-indicator{width:12px;height:12px;border-radius:50%;animation:pulse 2s infinite}
      .status-connected .status-indicator{background:#22C55E}
      .status-disconnected .status-indicator{background:#EF4444}
      .spectator-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:24px}
      .info-card{background:linear-gradient(145deg,rgba(0,30,53,.8),rgba(0,42,75,.7));border:2px solid rgba(220,199,162,.25);border-radius:16px;padding:20px;backdrop-filter:blur(8px);box-shadow:0 4px 20px rgba(0,8,13,.5)}
      .info-card-title{font-weight:600;color:#DCC7A2;font-size:16px;margin-bottom:12px}
      .info-card-content{color:#94A3B8;font-size:14px;line-height:1.5}
      .cheer-section{margin:24px;background:linear-gradient(145deg,rgba(0,30,53,.8),rgba(0,42,75,.7));border:2px solid rgba(220,199,162,.25);border-radius:16px;padding:24px;backdrop-filter:blur(8px);box-shadow:0 8px 32px rgba(0,8,13,.6)}
      .cheer-title{font-family:Cinzel,serif;font-size:24px;font-weight:600;color:#DCC7A2;text-align:center;margin-bottom:20px}
      .quick-cheer-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
      .quick-cheer-btn{padding:12px 8px;border:2px solid rgba(220,199,162,.3);border-radius:12px;background:rgba(0,30,53,.6);color:#DCC7A2;font-size:12px;font-weight:600;cursor:pointer;transition:all .3s;text-align:center;backdrop-filter:blur(4px);position:relative;overflow:hidden}
      .quick-cheer-btn::before{content:attr(data-key);position:absolute;top:4px;right:6px;font-size:10px;color:#64748B;font-weight:400}
      .quick-cheer-btn:hover{border-color:#DCC7A2;background:rgba(220,199,162,.15);transform:translateY(-2px);box-shadow:0 4px 12px rgba(220,199,162,.2)}
      .quick-cheer-btn:active{transform:translateY(0);box-shadow:0 2px 8px rgba(220,199,162,.3)}
      .quick-cheer-btn.cooldown{opacity:.5;cursor:not-allowed;pointer-events:none}
      .custom-cheer{display:flex;gap:12px;margin-top:16px}
      .custom-cheer-input{flex:1;padding:12px 16px;border:2px solid rgba(220,199,162,.25);border-radius:12px;background:rgba(0,30,53,.6);color:#E2E8F0;font-size:14px;backdrop-filter:blur(4px);transition:all .3s}
      .custom-cheer-input:focus{outline:none;border-color:#DCC7A2;box-shadow:0 0 0 3px rgba(220,199,162,.1)}
      .team-cheer-section{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}
      .team-cheer-btn{padding:12px 16px;border:2px solid rgba(220,199,162,.3);border-radius:12px;background:rgba(0,30,53,.6);color:#DCC7A2;font-size:14px;font-weight:600;cursor:pointer;transition:all .3s;text-align:center}
      .team-cheer-btn.phoenix{border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.1)}
      .team-cheer-btn.phoenix:hover{border-color:#EF4444;background:rgba(239,68,68,.2);color:#FF6B6B}
      .team-cheer-btn.eaters{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.1)}
      .team-cheer-btn.eaters:hover{border-color:#22C55E;background:rgba(34,197,94,.2);color:#4ADE80}
      .battle-log-section{margin:24px;background:linear-gradient(145deg,rgba(0,30,53,.8),rgba(0,42,75,.7));border:2px solid rgba(220,199,162,.25);border-radius:16px;padding:24px;backdrop-filter:blur(8px);box-shadow:0 8px 32px rgba(0,8,13,.6)}
      .log-title{font-family:Cinzel,serif;font-size:24px;font-weight:600;color:#DCC7A2;margin-bottom:16px}
      .battle-log-viewer{height:300px;overflow-y:auto;border:1px solid rgba(220,199,162,.2);border-radius:12px;padding:16px;background:rgba(0,8,13,.6);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;scrollbar-width:thin;scrollbar-color:#DCC7A2 transparent}
      .battle-log-viewer::-webkit-scrollbar{width:8px}
      .battle-log-viewer::-webkit-scrollbar-track{background:rgba(0,30,53,.3);border-radius:4px}
      .battle-log-viewer::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#DCC7A2,#D4BA8D);border-radius:4px}
      .log-entry{margin-bottom:8px;padding:8px 12px;border-radius:8px;border-left:3px solid transparent;transition:all .2s}
      .log-entry:hover{background:rgba(220,199,162,.05)}
      .log-system{color:#94A3B8;border-left-color:#3B82F6;background:rgba(59,130,246,.05)}
      .log-cheer{color:#DCC7A2;border-left-color:#F59E0B;background:rgba(245,158,11,.05)}
      .log-battle{color:#22C55E;border-left-color:#22C55E;background:rgba(34,197,94,.05)}
      .log-result{color:#EF4444;border-left-color:#EF4444;background:rgba(239,68,68,.05);font-weight:600}
      .log-timestamp{color:#64748B;font-size:11px;margin-right:8px}
      .auto-login-notice{background:linear-gradient(145deg,rgba(34,197,94,.1),rgba(34,197,94,.05));border:2px solid rgba(34,197,94,.3);border-radius:12px;padding:16px;margin-bottom:20px;text-align:center}
      .notice-title{font-weight:600;color:#22C55E;font-size:16px;margin-bottom:8px}
      .notice-text{color:#94A3B8;font-size:14px}
      .spectator-stats{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid rgba(220,199,162,.2)}
      .stat-item{text-align:center}.stat-value{font-size:18px;font-weight:700;color:#DCC7A2}.stat-label{font-size:12px;color:#64748B;margin-top:4px}
      .cheer-cooldown-indicator{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,30,53,.95);border:2px solid #F59E0B;border-radius:12px;padding:12px 20px;color:#F59E0B;font-weight:600;font-size:14px;z-index:10000;opacity:0;animation:cooldownPulse 1s ease-out forwards}
      @keyframes cooldownPulse{0%{opacity:0;transform:translate(-50%,-50%) scale(.8)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
      @media (max-width:768px){.spectator-title{font-size:24px}.quick-cheer-grid{grid-template-columns:repeat(2,1fr);gap:8px}.team-cheer-section{grid-template-columns:1fr}.spectator-info{grid-template-columns:1fr}.custom-cheer{flex-direction:column}.battle-log-viewer{height:200px;font-size:12px}}
      @media (prefers-reduced-motion:reduce){.quick-cheer-btn,.team-cheer-btn,.btn-primary{transition:none}}
    `;
    document.head.appendChild(styleSheet);
  }

  /* ========== Elements & Events ========== */
  initElements() {
    this.spectatorNameInput = document.querySelector('#spectatorName');
    this.loginBtn = document.querySelector('#loginBtn');
    this.connectionStatus = document.querySelector('#connectionStatus');
    this.battleLogViewer = document.querySelector('#battleLogViewer');
    this.quickCheerBtns = document.querySelectorAll('.quick-cheer-btn');
    this.customCheerInput = document.querySelector('#customCheerInput');
    this.sendCheerBtn = document.querySelector('#sendCheerBtn');

    this.spectatorCountEl = document.querySelector('#spectatorCount');
    this.battleStatusEl = document.querySelector('#battleStatus');
    this.teamCheerBtns = document.querySelectorAll('.team-cheer-btn');
    this.autoLoginInfo = document.querySelector('#autoLoginInfo');

    // 버튼 내 멘트 고정
    if (this.quickCheerBtns?.length) {
      this.quickCheerBtns.forEach((btn, idx) => {
        btn.textContent = this.fixedCheerMessages[idx] || '';
        btn.removeAttribute('data-key');
      });
    }
  }

  setupEventListeners() {
    this.loginBtn?.addEventListener('click', () => this.login());
    this.spectatorNameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // 고정 응원 버튼 클릭
    this.quickCheerBtns?.forEach((btn, idx) => {
      btn.addEventListener('click', () => this.sendFixedCheer(idx));
    });

    // 팀 응원/커스텀 응원 등은 필요시 유지
    this.teamCheerBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        const team = btn.classList.contains('phoenix') ? 'phoenix' : (btn.classList.contains('eaters') ? 'eaters' : 'death');
        this.sendTeamCheer(team);
      });
    });

    this.sendCheerBtn?.addEventListener('click', () => this.sendCustomCheer());
    this.customCheerInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendCustomCheer();
    });

    window.addEventListener('beforeunload', () => this.cleanup());
  }

  // 단축키 기능 완전 제거
  // setupKeyboardShortcuts() { ... }
  // _handleKeydown(e) { ... }

  /* ========== Login / Socket ========== */
  async login() {
    const name = (this.spectatorNameInput?.value || '').trim();
    if (!name || name.length < 2 || name.length > 20) {
      return this.showError('관전자 이름은 2~20자 사이로 입력해주세요.');
    }
    if (this.isInappropriateName(name)) {
      return this.showError('적절하지 않은 이름입니다. 다른 이름을 사용해주세요.');
    }
    this.spectatorName = name;

    try {
      this.showLoading('서버에 연결 중...');
      await this.connectToServer();
      this.hideLoading();
      this.updateConnectionStatus(true);

      window.PyxisNotify?.showToast('관전 시작', `${this.spectatorName}님, 관전을 시작합니다`, 'info');
      window.PyxisFX?.playSound('button', 600, 0.15, 0.25);
    } catch (err) {
      this.hideLoading();
      this.updateConnectionStatus(false);
      this.showError('서버 연결 실패: ' + (err?.message || '알 수 없는 오류'));
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
        query: { otp, name: this.spectatorName, battleId, type: 'spectator' },
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
        reject(new Error('연결 실패: ' + (err?.message || '알 수 없는 오류')));
      });

      socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.addLog('system', `연결 끊김: ${reason}`);
        window.PyxisNotify?.showToast('연결 끊김', '서버와의 연결이 끊어졌습니다', 'warning');
      });

      socket.on('reconnect', () => {
        this.isConnected = true;
        this.updateConnectionStatus(true);
        this.addLog('system', '서버에 다시 연결되었습니다');
        window.PyxisNotify?.showToast('연결 복구', '서버와의 연결이 복구되었습니다', 'info');
      });
    });
  }

  registerSocketEvents() {
    if (!this.socket) return;

    this.socket.on('battle:update', (data) => {
      this.battleData = data?.battleData || data || {};
      this.players = data?.players || [];
      this.updateBattleInfo();
      this.addLog('system', '전투 정보 갱신됨');
    });

    this.socket.on('battle:status', (status) => {
      this.updateBattleStatus(status);
      this.addLog('battle', `전투 상태: ${status}`);
    });

    this.socket.on('cheer:broadcast', (cheerData) => {
      const spectatorName = cheerData?.spectatorName || '관전자';
      const message = cheerData?.message || '';
      const type = cheerData?.type || 'cheer';
      this.addLog('cheer', `${spectatorName}: ${message}`, type);
      if (window.PyxisFX && spectatorName !== this.spectatorName) {
        window.PyxisFX.playSound('button', 500, 0.1, 0.2);
      }
    });

    this.socket.on('battle:action', (actionData) => {
      const { player, action, result, damage } = actionData || {};
      let logMessage = `${player || '플레이어'}의 ${action || '행동'}`;
      if (result === 'hit' && damage) logMessage += ` → ${damage} 대미지`;
      else if (result === 'critical' && damage) logMessage += ` → 치명타 ${damage} 대미지!`;
      else if (result === 'miss') logMessage += ' → 빗나감';
      else if (result === 'dodge') logMessage += ' → 회피됨';

      this.addLog('battle', logMessage);
      // 자동 응원 기능 제거
    });

    this.socket.on('battle:end', (result) => {
      const winner = result?.winnerTeam || result?.winner || '승리팀';
      const reason = result?.reason;
      this.addLog('result', `전투 종료! 승리팀: ${winner}`);
      if (reason) this.addLog('result', `종료 사유: ${reason}`);

      window.PyxisNotify?.victoryNotification(winner, reason || '');
      if (window.PyxisFX) {
        window.PyxisFX.screenFlash('rgba(220, 199, 162, 0.3)');
        window.PyxisFX.playSound('victory', 800, 0.8, 0.4);
      }
    });

    this.socket.on('spectator:count', (count) => {
      this.spectatorCount = Number(count) || 0;
      this.updateSpectatorCount();
    });

    this.socket.on('player:joined', (playerData) => {
      const { name, team } = playerData || {};
      this.addLog('system', `${name || '플레이어'}님이 ${team || '팀'}에 참가했습니다`);
    });

    this.socket.on('player:left', (playerData) => {
      const { name } = playerData || {};
      this.addLog('system', `${name || '플레이어'}님이 전투를 떠났습니다`);
    });

    this.socket.on('server:error', (errorData) => {
      const msg = errorData?.message || '알 수 없는 오류';
      this.addLog('system', `오류: ${msg}`);
      this.showError(msg);
    });

    this.socket.on('error', (errorData) => {
      const msg = (typeof errorData === 'string') ? errorData : (errorData?.message || '알 수 없는 오류');
      this.addLog('system', `오류: ${msg}`);
      this.showError(msg);
    });
  }

  /* ========== Cheers ========== */
  sendFixedCheer(idx) {
    if (!this.canSendCheer()) return;
    const message = this.fixedCheerMessages[idx] || '';
    if (!message) return;
    this.sendCheer(message, 'fixed', idx);
    this.applyCooldown();
  }

  sendTeamCheer(teamKey) {
    if (!this.canSendCheer()) return;
    // 팀 응원 메시지 고정(옵션)
    const message = teamKey === 'phoenix' ? '불사조 기사단 화이팅!' : '죽음을 먹는 자들 파이팅!';
    this.sendCheer(message, 'team', teamKey);
    this.applyCooldown();
  }

  sendCustomCheer() {
    if (!this.canSendCheer()) return;
    const message = (this.customCheerInput?.value || '').trim();
    if (!message || message.length > 100) return this.showError('응원 메시지는 1~100자 사이로 입력해주세요.');
    if (this.isInappropriateMessage(message)) return this.showError('적절하지 않은 메시지입니다.');

    this.sendCheer(message, 'custom');
    if (this.customCheerInput) this.customCheerInput.value = '';
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
    this.socket.emit('spectator:cheer', cheerData);
    this.addLog('cheer', `${this.spectatorName}: ${message}`, type);

    window.PyxisFX?.playSound('button', 700, 0.15, 0.25);
    window.PyxisFX?.vibrate(20);

    this.lastCheerTime = Date.now();
  }

  canSendCheer() {
    if (!this.isConnected) {
      this.showError('서버에 연결되지 않았습니다.');
      return false;
    }
    const elapsed = Date.now() - this.lastCheerTime;
    if (elapsed < this.cheerCooldown) {
      this.showCooldownIndicator();
      return false;
    }
    return true;
  }

  applyCooldown() {
    this.quickCheerBtns?.forEach(btn => btn.classList.add('cooldown'));
    this.teamCheerBtns?.forEach(btn => btn.classList.add('cooldown'));
    if (this.sendCheerBtn) this.sendCheerBtn.disabled = true;

    setTimeout(() => {
      this.quickCheerBtns?.forEach(btn => btn.classList.remove('cooldown'));
      this.teamCheerBtns?.forEach(btn => btn.classList.remove('cooldown'));
      if (this.sendCheerBtn) this.sendCheerBtn.disabled = false;
    }, this.cheerCooldown);
  }

  showCooldownIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'cheer-cooldown-indicator';
    indicator.textContent = '응원 쿨타임 중...';
    document.body.appendChild(indicator);
    setTimeout(() => indicator.remove(), 1000);
  }

  /* ========== UI / Logs ========== */
  addLog(type, message, subType = null) {
    if (!this.battleLogViewer) return;

    const ts = new Date();
    const timestamp = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`;

    const logEl = document.createElement('div');
    logEl.className = `log-entry log-${type}`;
    if (subType) logEl.classList.add(`log-${subType}`);

    const tsSpan = document.createElement('span');
    tsSpan.className = 'log-timestamp';
    tsSpan.textContent = `[${timestamp}]`;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'log-content';
    contentSpan.textContent = message; // XSS-safe

    logEl.appendChild(tsSpan);
    logEl.appendChild(contentSpan);
    this.battleLogViewer.appendChild(logEl);
    this.battleLogViewer.scrollTop = this.battleLogViewer.scrollHeight;

    const logs = this.battleLogViewer.querySelectorAll('.log-entry');
    if (logs.length > 200) logs[0].remove();

    this.battleLog.push({ type, message, timestamp: Date.now(), subType });
  }

  updateConnectionStatus(connected) {
    if (!this.connectionStatus) return;
    const statusText = connected ? '연결됨' : '연결 끊김';
    const statusClass = connected ? 'status-connected' : 'status-disconnected';

    this.connectionStatus.className = `connection-status ${statusClass}`;
    this.connectionStatus.innerHTML = '';
    const dot = document.createElement('div');
    dot.className = 'status-indicator';
    const txt = document.createElement('span');
    txt.textContent = statusText;

    this.connectionStatus.appendChild(dot);
    this.connectionStatus.appendChild(txt);
  }

  updateSpectatorCount() {
    if (this.spectatorCountEl) {
      this.spectatorCountEl.textContent = `${this.spectatorCount}명 관전 중`;
    }
  }

  updateBattleInfo() {
    if (!this.battleData || !this.battleStatusEl) return;
    const { mode = '2v2', currentTurn = 1, status = 'waiting' } = this.battleData;

    this.battleStatusEl.innerHTML = '';
    const modeEl = document.createElement('div');
    modeEl.className = 'battle-mode';
    modeEl.textContent = `${mode} 전투`;

    const turnEl = document.createElement('div');
    turnEl.className = 'battle-turn';
    turnEl.textContent = `턴 ${currentTurn}`;

    const statusEl = document.createElement('div');
    statusEl.className = 'battle-status';
    statusEl.textContent = this.getStatusText(status);

    this.battleStatusEl.appendChild(modeEl);
    this.battleStatusEl.appendChild(turnEl);
    this.battleStatusEl.appendChild(statusEl);
  }

  updateBattleStatus(status) {
    switch (status) {
      case 'waiting': this.addLog('system', '전투 대기 중...'); break;
      case 'active':  this.addLog('system', '전투 진행 중');   break;
      case 'paused':  this.addLog('system', '전투 일시정지');   break;
      case 'ended':   this.addLog('system', '전투 종료');       break;
    }
  }

  getStatusText(status) {
    const map = { waiting: '대기 중', active: '진행 중', paused: '일시정지', ended: '종료됨' };
    return map[status] || '알 수 없음';
  }

  showAutoLogin(/*otp*/) {
    if (!this.autoLoginInfo) return;
    this.autoLoginInfo.innerHTML = `
      <div class="auto-login-notice">
        <div class="notice-title">관전자 OTP 확인됨</div>
        <div class="notice-text">관전자 이름을 입력하고 입장해주세요</div>
      </div>
    `;
  }

  showError(message) {
    if (window.PyxisNotify) {
      window.PyxisNotify.showToast('오류', String(message || '오류가 발생했습니다'), 'error');
    } else {
      alert('오류: ' + message);
    }
  }

  showLoading(message) {
    if (window.PyxisNotify) {
      this.loadingToastId = window.PyxisNotify.showToast('로딩', String(message || ''), 'info', {
        persistent: true,
        closable: false,
        tag: 'spectator-loading'
      });
    }
  }

  hideLoading() {
    if (this.loadingToastId && window.PyxisNotify) {
      window.PyxisNotify.removeToast(this.loadingToastId);
      this.loadingToastId = null;
    }
  }

  /* ========== Utils ========== */
  isInappropriateName(name) {
    const bad = ['관리자', 'admin', 'root', 'system', 'bot'];
    const lower = String(name).toLowerCase();
    return bad.some(w => lower.includes(w));
  }

  isInappropriateMessage(message) {
    // 간단 필터(서버 측 검증 권장)
    const bad = ['욕설', '비방', '광고'];
    return bad.some(w => String(message).includes(w));
  }

  /* ========== Export/Settings ========== */
  exportLog() {
    const logData = {
      spectatorName: this.spectatorName,
      battleId: this.battleId,
      logs: this.battleLog,
      exportTime: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pyxis-spectator-log-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    window.PyxisNotify?.showToast('로그 내보내기', '관전 로그가 다운로드되었습니다', 'info');
  }

  getSettings() {
    return {
      spectatorName: this.spectatorName,
      cheerCooldown: this.cheerCooldown,
      autoCheerEnabled: true,
      soundEnabled: !!window.PyxisFX?.soundEnabled,
      notificationsEnabled: !!window.PyxisNotify?.enabled
    };
  }

  updateSettings(settings = {}) {
    if (settings.cheerCooldown) {
      this.cheerCooldown = Math.max(500, Math.min(5000, Number(settings.cheerCooldown)));
    }
    if (settings.soundEnabled !== undefined && window.PyxisFX) {
      window.PyxisFX.setSoundEnabled(!!settings.soundEnabled);
    }
    if (settings.notificationsEnabled !== undefined && window.PyxisNotify) {
      window.PyxisNotify.setEnabled(!!settings.notificationsEnabled);
    }
  }

  /* ========== Cleanup / Debug ========== */
  cleanup() {
    // 단축키 제거
    // try { document.removeEventListener('keydown', this._onKeyDown); } catch {}

    if (this.socket) {
      try { this.socket.removeAllListeners && this.socket.removeAllListeners(); } catch {}
      try { this.socket.disconnect(); } catch {}
      this.socket = null;
    }

    this.isConnected = false;
    this.players = [];
    this.battleData = null;

    console.log('PYXIS Spectator Interface cleaned up');
  }

  testFeatures() {
    console.log('PYXIS Spectator Interface 테스트 중...');
    setTimeout(() => this.addLog('system', '테스트 시스템 메시지'), 0);
    setTimeout(() => this.addLog('cheer', '테스트관전자: 힘내라!'), 500);
    setTimeout(() => this.addLog('battle', '테스트플레이어의 공격 → 15 대미지'), 1000);
    setTimeout(() => this.addLog('result', '테스트: 불사조 기사단 승리!'), 1500);
    setTimeout(() => { this.updateConnectionStatus(false); setTimeout(() => this.updateConnectionStatus(true), 1000); }, 2000);
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

// 전역 노출(클래스)
window.PyxisSpectatorInterface = PyxisSpectatorInterface;

// DOM 로드 후 인스턴스 생성(클래스 내부에서 DOM 준비 처리도 수행)
document.addEventListener('DOMContentLoaded', () => {
  window.spectatorInterface = new PyxisSpectatorInterface();
  console.log('PYXIS Spectator Interface initialized');
});

// 호환 별칭
window.SpectatorInterface = PyxisSpectatorInterface;
