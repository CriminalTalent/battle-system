// PYXIS Spectator Interface - Fixed 6 Cheers (HTML 버튼 연동, 단축키 없음)
// - HTML에 이미 존재하는 #cheerBtns .cbtn 6개 버튼을 그대로 사용
// - 단축키 전면 비활성
// - 보안(XSS 방지), 회복력(요소 미존재 시 안전), 알림/이펙트 연동 유지
// - 타임라인(로그) 출력, 쿨타임 표시, 접속/재접속 UX 포함

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
    this.cheerCooldown = 1000; // ms
    this.loadingToastId = null;

    // 초기화
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
    this.cacheElements();
    this.bindEvents();

    // URL 파라미터에서 battle/otp 자동 안내
    const qs = new URLSearchParams(window.location.search);
    const otp = qs.get('otp');
    const battleId = qs.get('battle');
    if (otp && battleId) {
      this.battleId = battleId;
      this.showAutoLogin(otp);
    }

    // 클릭 이펙트 강화(있는 경우)
    if (window.PyxisFX) window.PyxisFX.enhanceClicks();
  }

  /* ========== Styles(필수 최소치) ========== */
  injectStyles() {
    if (document.getElementById('pyxis-spectator-styles')) return;
    const s = document.createElement('style');
    s.id = 'pyxis-spectator-styles';
    s.textContent = `
      .cheer-cooldown-indicator{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,30,53,.95);border:2px solid #F59E0B;border-radius:12px;padding:12px 20px;color:#F59E0B;font-weight:600;font-size:14px;z-index:10000;opacity:0;animation:cooldownPulse 1s ease-out forwards}
      @keyframes cooldownPulse{0%{opacity:0;transform:translate(-50%,-50%) scale(.8)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1)}}
      .log-entry{margin-bottom:8px;padding:8px 12px;border-radius:8px;border-left:3px solid transparent;transition:all .2s}
      .log-system{color:#94A3B8;border-left-color:#3B82F6;background:rgba(59,130,246,.05)}
      .log-cheer{color:#DCC7A2;border-left-color:#F59E0B;background:rgba(245,158,11,.05)}
      .log-battle{color:#22C55E;border-left-color:#22C55E;background:rgba(34,197,94,.05)}
      .log-result{color:#EF4444;border-left-color:#EF4444;background:rgba(239,68,68,.05);font-weight:600}
      .log-timestamp{color:#64748B;font-size:11px;margin-right:8px}
      .quick-cheer-btn.cooldown, .cbtn.cooldown{opacity:.5;cursor:not-allowed;pointer-events:none}
    `;
    document.head.appendChild(s);
  }

  /* ========== Cache Elements ========== */
  cacheElements() {
    // 관전자 이름 입력/입장 버튼
    this.spectatorNameInput = document.querySelector('#spectatorName') || document.querySelector('#viewerName') || document.querySelector('#name');
    this.loginBtn = document.querySelector('#loginBtn') || document.querySelector('#btnJoin') || document.querySelector('#btnLogin');

    // 연결 상태/로그
    this.connectionStatus = document.querySelector('#connectionStatus');
    this.battleLogViewer = document.querySelector('#battleLogViewer') || document.querySelector('#timelineFeed') || document.querySelector('#battleLog');

    // 응원 버튼: HTML에 이미 존재하는 6개
    this.cheerButtons = document.querySelectorAll('#cheerBtns .cbtn');

    // 커스텀 응원 입력/전송(있으면 사용)
    this.customCheerInput = document.querySelector('#customCheerInput') || document.querySelector('#cheerInput');
    this.sendCheerBtn = document.querySelector('#sendCheerBtn') || document.querySelector('#btnSendCheer');

    // 상태 표기
    this.spectatorCountEl = document.querySelector('#spectatorCount');
    this.battleStatusEl = document.querySelector('#battleStatus');
    this.teamCheerBtns = document.querySelectorAll('.team-cheer-btn');
    this.autoLoginInfo = document.querySelector('#autoLoginInfo');
  }

  /* ========== Bind Events ========== */
  bindEvents() {
    // 입장
    this.loginBtn?.addEventListener('click', () => this.login());
    this.spectatorNameInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // 고정 응원 6개: data-msg 그대로 전송
    this.cheerButtons?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.msg || btn.textContent.trim();
        this.sendFixedCheer(msg);
      });
    });

    // 팀 응원 버튼(있을 경우)
    this.teamCheerBtns?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const team = btn.classList.contains('phoenix')
          ? 'phoenix'
          : btn.classList.contains('eaters')
          ? 'eaters'
          : 'death';
        this.sendTeamCheer(team);
      });
    });

    // 커스텀 응원
    this.sendCheerBtn?.addEventListener('click', () => this.sendCustomCheer());
    this.customCheerInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendCustomCheer();
    });

    // 종료 정리
    window.addEventListener('beforeunload', () => this.cleanup());
  }

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
      const qs = new URLSearchParams(window.location.search);
      const otp = qs.get('otp');
      const battleId = this.battleId || qs.get('battle');
      if (!otp || !battleId) {
        reject(new Error('비밀번호 또는 전투 ID가 없습니다.'));
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

    // 스냅샷/업데이트
    this.socket.on('battle:update', (data) => {
      this.battleData = data?.battleData || data || {};
      this.players = data?.players || [];
      this.updateBattleInfo();
      this.addLog('system', '전투 정보 갱신됨');
    });

    // 상태
    this.socket.on('battle:status', (status) => {
      this.updateBattleStatus(status);
      this.addLog('battle', `전투 상태: ${status}`);
    });

    // 응원 브로드캐스트
    this.socket.on('cheer:broadcast', (cheerData) => {
      const spectatorName = cheerData?.spectatorName || '관전자';
      const message = cheerData?.message || '';
      const type = cheerData?.type || 'cheer';
      this.addLog('cheer', `${spectatorName}: ${message}`, type);
      if (window.PyxisFX && spectatorName !== this.spectatorName) {
        window.PyxisFX.playSound('button', 500, 0.1, 0.2);
      }
    });

    // 전투 액션
    this.socket.on('battle:action', (actionData) => {
      const { player, action, result, damage } = actionData || {};
      let logMessage = `${player || '플레이어'}의 ${action || '행동'}`;
      if (result === 'hit' && damage) logMessage += ` → ${damage} 대미지`;
      else if (result === 'critical' && damage) logMessage += ` → 치명타 ${damage} 대미지!`;
      else if (result === 'miss') logMessage += ' → 빗나감';
      else if (result === 'dodge') logMessage += ' → 회피됨';
      this.addLog('battle', logMessage);
    });

    // 종료
    this.socket.on('battle:end', (result) => {
      const winner = result?.winnerTeam || result?.winner || '승리팀';
      const reason = result?.reason;
      this.addLog('result', `전투 종료! 승리팀: ${winner}`);
      if (reason) this.addLog('result', `종료 사유: ${reason}`);
      window.PyxisNotify?.victoryNotification?.(winner, reason || '');
      if (window.PyxisFX) {
        window.PyxisFX.screenFlash('rgba(220, 199, 162, 0.3)');
        window.PyxisFX.playSound('victory', 800, 0.8, 0.4);
      }
    });

    // 관전자 수
    this.socket.on('spectator:count', (count) => {
      this.spectatorCount = Number(count) || 0;
      this.updateSpectatorCount();
    });

    // 참가/이탈
    this.socket.on('player:joined', (playerData) => {
      const { name, team } = playerData || {};
      this.addLog('system', `${name || '플레이어'}님이 ${team || '팀'}에 참가했습니다`);
    });
    this.socket.on('player:left', (playerData) => {
      const { name } = playerData || {};
      this.addLog('system', `${name || '플레이어'}님이 전투를 떠났습니다`);
    });

    // 에러
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
  sendFixedCheer(msg) {
    if (!this.canSendCheer()) return;
    this.sendCheer(msg, 'quick');
    this.applyCooldown();
  }

  sendTeamCheer(teamKey) {
    if (!this.canSendCheer()) return;
    const key = teamKey === 'death' ? 'death' : teamKey === 'eaters' ? 'eaters' : 'phoenix';
    const pack =
      key === 'phoenix'
        ? ['불사조 기사단 파이팅!', '멋지다!', '이겨라!', '살아서 돌아와!']
        : ['죽음을 먹는 자들 파이팅!', '파이팅!', '죽으면 나한테 죽어!', '힘내요!'];
    const message = pack[Math.floor(Math.random() * pack.length)];
    this.sendCheer(message, 'team', key);
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
    // 서버 합의: spectator:cheer 사용
    this.socket.emit('spectator:cheer', cheerData);

    // 자기 자신도 즉시 로그에 반영
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
    // 고정 6개 버튼에 쿨다운 표시
    this.cheerButtons?.forEach((btn) => btn.classList.add('cooldown'));
    this.teamCheerBtns?.forEach((btn) => btn.classList.add('cooldown'));
    if (this.sendCheerBtn) this.sendCheerBtn.disabled = true;

    setTimeout(() => {
      this.cheerButtons?.forEach((btn) => btn.classList.remove('cooldown'));
      this.teamCheerBtns?.forEach((btn) => btn.classList.remove('cooldown'));
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

    const row = document.createElement('div');
    row.className = `log-entry log-${type}`;
    if (subType) row.classList.add(`log-${subType}`);

    const tsSpan = document.createElement('span');
    tsSpan.className = 'log-timestamp';
    tsSpan.textContent = `[${timestamp}]`;

    const content = document.createElement('span');
    content.className = 'log-content';
    content.textContent = message;

    row.appendChild(tsSpan);
    row.appendChild(content);
    this.battleLogViewer.appendChild(row);
    this.battleLogViewer.scrollTop = this.battleLogViewer.scrollHeight;

    // 메모리/DOM 관리
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
    const { mode = '2v2,', currentTurn = 1, status = 'waiting' } = this.battleData;

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
      default: break;
    }
  }

  getStatusText(status) {
    const map = { waiting: '대기 중', active: '진행 중', paused: '일시정지', ended: '종료됨' };
    return map[status] || '알 수 없음';
  }

  showAutoLogin() {
    if (!this.autoLoginInfo) return;
    this.autoLoginInfo.innerHTML = `
      <div class="auto-login-notice">
        <div class="notice-title">관전자 비밀번호 확인됨</div>
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
    return bad.some((w) => lower.includes(w));
  }

  isInappropriateMessage(message) {
    const bad = ['욕설', '비방', '광고'];
    return bad.some((w) => String(message).includes(w));
  }

  /* ========== Cleanup / Debug ========== */
  cleanup() {
    if (this.socket) {
      try { this.socket.removeAllListeners && this.socket.removeAllListeners(); } catch {}
      try { this.socket.disconnect(); } catch {}
      this.socket = null;
    }
    this.isConnected = false;
    this.players = [];
    this.battleData = null;
    // 로그 DOM은 그대로 두어도 무방
  }

  // 디버그 헬퍼
  testFeatures() {
    console.log('PYXIS Spectator Interface 테스트 중...');
    setTimeout(() => this.addLog('system', '테스트 시스템 메시지'), 0);
    setTimeout(() => this.addLog('cheer', '테스트관전자: 멋지다!'), 500);
    setTimeout(() => this.addLog('battle', '테스트플레이어의 공격 → 15 대미지'), 1000);
    setTimeout(() => this.addLog('result', '테스트: 불사조 기사단 승리!'), 1500);
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

// 전역 노출
window.PyxisSpectatorInterface = PyxisSpectatorInterface;

// DOM 로드 후 인스턴스 생성
document.addEventListener('DOMContentLoaded', () => {
  window.spectatorInterface = new PyxisSpectatorInterface();
  console.log('PYXIS Spectator Interface initialized');
});

// 호환 별칭
window.SpectatorInterface = PyxisSpectatorInterface;
