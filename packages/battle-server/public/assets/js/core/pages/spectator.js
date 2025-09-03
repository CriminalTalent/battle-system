// packages/battle-server/public/assets/js/pages/spectator.js
// PYXIS Spectator Page - 관전자 페이지 로직 (디자인/스타일 변경 없음)

class PyxisSpectator {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.joined = false;

    this.init();
  }

  init() {
    console.log('[Spectator] Initializing');
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    // 소켓 연결 (자동 재시도 포함)
    PyxisSocket.init({
      reconnect: true,               // 자동 재연결
      maxRetries: 10,                // 최대 재시도 횟수
      retryInterval: 3000            // 재시도 간격(ms)
    }).catch(err => {
      console.error('[Spectator] Socket init failed:', err);
      UI?.toast?.('서버 연결에 실패했습니다', 'danger');
    });
  }

  // DOM 요소 참조
  setupElements() {
    this.authForm      = UI.$('#authForm');
    this.authBattleId  = UI.$('#authBattleId');
    this.authToken     = UI.$('#authToken');
    this.authName      = UI.$('#authName');

    this.playerList    = UI.$('#playerList');
    this.battleLog     = UI.$('#battleLog');
    this.chatMessages  = UI.$('#chatMessages');

    this.cheerButtons  = document.querySelectorAll('.cheer-btn');
  }

  // 이벤트 바인딩
  setupEventListeners() {
    if (this.authForm) {
      this.authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.authenticate();
      });
    }

    this.cheerButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.cheer || '';
        this.sendCheer(msg);
      }, { passive: true });
    });
  }

    // 소켓 이벤트 설정
  setupSocketEvents() {
    PyxisSocket.on('auth:ok', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('auth:error', ({ message }) => {
      UI?.toast?.(`인증 실패: ${message || '알 수 없는 오류'}`, 'danger');
    });

    PyxisSocket.on('state', (state) => this.handleStateUpdate(state));
    PyxisSocket.on('chat', (payload) => this.handleChat(payload));
    PyxisSocket.on('log', (e) => {
      if (e?.text) this.addLogEntry(e.text, 'system');
    });

    PyxisSocket.on('battle', ({ event }) => {
      if (event === 'battle:started') {
        UI?.toast?.('전투가 시작되었습니다', 'success');
      } else if (event === 'battle:ended' || event === 'battle:end') {
        UI?.toast?.('전투가 종료되었습니다', 'info');
      }
    });

    PyxisSocket.on('phase', (phase) => {
      if (phase?.phase && phase?.round != null) {
        const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들';
        this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
      }
    });
  }

  // URL에서 battle/token/name 파라미터 가져와 자동 인증
  initFromUrl() {
    const url = new URL(window.location.href);
    const b = url.searchParams.get('battle');
    const t = url.searchParams.get('token');
    const n = url.searchParams.get('name');
    if (b && t && n) {
      if (this.authBattleId) this.authBattleId.value = b;
      if (this.authToken)    this.authToken.value = t;
      if (this.authName)     this.authName.value = decodeURIComponent(n);
      setTimeout(() => this.authenticate(), 400);
    }
  }

  // 인증 요청
  async authenticate() {
    const battleId = (this.authBattleId?.value || '').trim();
    const token    = (this.authToken?.value || '').trim();
    const name     = (this.authName?.value || '').trim();

    if (!battleId || !token || !name) {
      UI?.toast?.('전투 ID / 관전자 OTP / 이름을 모두 입력하세요', 'warning');
      return;
    }

    try {
      await PyxisSocket.authAsSpectator({
        battleId,
        otp: token,
        spectatorName: name
      });
    } catch (e) {
      console.error('[Spectator] auth error:', e);
      UI?.toast?.(e.message || '인증 실패', 'danger');
    }
  }

  handleAuthSuccess(data) {
    this.joined = true;
    this.currentBattleId = data?.battleId || data?.state?.battleId || this.currentBattleId;
    this.battleState     = data?.state || data?.battle || this.battleState;

    UI?.toast?.('관전 입장 완료', 'success');
    this.render();
  }

  handleStateUpdate(state) {
    this.battleState = state;
    this.render();
  }
  // 응원 메시지 보내기
  sendCheer(text) {
    const msg = (text || '').trim();
    if (!msg || !this.currentBattleId) return;

    PyxisSocket.sendChat({
      text: msg,
      channel: 'all',
      sender: this.authName?.value || '관전자',
      battleId: this.currentBattleId
    });
  }

  // 채팅 메시지 렌더링
  handleChat(m) {
    const nickname = (m?.from?.nickname) || m?.nickname || '익명';
    const text = m?.text || m?.message || '';
    if (!text) return;

    const el = document.createElement('div');
    el.className = `chat-message ${m?.type || (m?.scope === 'team' ? 'team' : '')}`;

    const timeStr = this._formatTime(m?.ts || Date.now());
    el.innerHTML = `
      <span class="chat-time">${timeStr}</span>
      <span class="chat-content">${nickname}: ${text}</span>
    `;
    this.chatMessages?.appendChild(el);
    this._scrollToBottom(this.chatMessages);
  }

  // 로그 메시지 렌더링
  addLogEntry(content, type = 'info') {
    if (!content || !this.battleLog) return;
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerHTML = `
      <span class="log-time">${this._formatTime(Date.now())}</span>
      <span class="log-content">${content}</span>
    `;
    this.battleLog.appendChild(el);
    this._scrollToBottom(this.battleLog);
  }

  // 플레이어 목록 렌더링
  render() {
    if (!this.battleState || !this.playerList) return;
    this.playerList.innerHTML = '';

    const players = Object.values(this.battleState.players || {});
    players.forEach((p) => {
      const d = document.createElement('div');
      d.className = `spectator-player ${p.alive === false ? 'defeated' : ''}`;
      d.innerHTML = `
        <div class="player-name">${p.name || '-'}</div>
        <div class="player-team">${this._teamName(p.team)}</div>
        <div class="player-hp">HP: ${p.hp}/${p.maxHp || 100}</div>
      `;
      this.playerList.appendChild(d);
    });
  }

  // 시간 포맷 유틸
  _formatTime(ts) {
    if (typeof UI?.formatTime === 'function') return UI.formatTime(ts);
    try {
      return new Date(ts).toLocaleTimeString('ko-KR', { hour12: false });
    } catch {
      return '';
    }
  }

  // 스크롤 유틸
  _scrollToBottom(el) {
    if (!el) return;
    try { el.scrollTop = el.scrollHeight; } catch (_) {}
  }

  // 팀 이름 변환 유틸
  _teamName(code) {
    if (typeof UI?.getTeamName === 'function') return UI.getTeamName(code);
    const a = (code === 'A' || code === 'team1');
    return a ? '불사조 기사단' : '죽음을 먹는 자들';
  }

  // 정리
  cleanup() {
    try { PyxisSocket.destroy(); } catch (_) {}
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.spectator = new PyxisSpectator();
});
window.addEventListener('beforeunload', () => {
  if (window.spectator) window.spectator.cleanup();
});

