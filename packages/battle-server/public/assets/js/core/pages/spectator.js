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

    // 소켓 연결
    PyxisSocket.init().catch(err => {
      console.error('[Spectator] Socket init failed:', err);
      UI?.toast?.('서버 연결에 실패했습니다', 'danger');
    });
  }

  // DOM 요소
  setupElements() {
    this.authForm   = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken  = UI.$('#authToken');
    this.authName   = UI.$('#authName');

    this.playerList   = UI.$('#playerList');
    this.battleLog    = UI.$('#battleLog');
    this.chatMessages = UI.$('#chatMessages');

    this.cheerButtons = document.querySelectorAll('.cheer-btn');
  }

  // 이벤트
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

  // 소켓 이벤트 (통합 소켓 매니저의 표준 이벤트명 사용)
  setupSocketEvents() {
    // 인증 결과
    PyxisSocket.on('auth:ok', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('auth:error', ({ message }) => {
      UI?.toast?.(`인증 실패: ${message || '알 수 없는 오류'}`, 'danger');
    });

    // 상태 스냅샷/업데이트
    PyxisSocket.on('state', (state) => this.handleStateUpdate(state));

    // 채팅/로그
    PyxisSocket.on('chat', (payload) => this.handleChat(payload));
    PyxisSocket.on('log',  (e) => e?.text && this.addLogEntry(e.text, 'system'));

    // 배틀/페이즈(선택)
    PyxisSocket.on('battle', ({ event, data }) => {
      if (event === 'battle:started') {
        UI?.toast?.('전투가 시작되었습니다', 'success');
      } else if (event === 'battle:ended' || event === 'battle:end') {
        UI?.toast?.('전투가 종료되었습니다', 'info');
      }
    });
    PyxisSocket.on('phase', (phase) => {
      // 필요시 로그에 남김
      if (phase?.phase && phase?.round != null) {
        const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들';
        this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
      }
    });
  }

  // URL 자동 인증
  initFromUrl() {
    const url = new URL(window.location.href);
    const b = url.searchParams.get('battle');
    const t = url.searchParams.get('token');
    const n = url.searchParams.get('name');
    if (b && t && n) {
      if (this.authBattleId) this.authBattleId.value = b;
      if (this.authToken)    this.authToken.value = t;
      if (this.authName)     this.authName.value = decodeURIComponent(n);
      // 소켓 연결 이후 살짝 지연 후 인증
      setTimeout(() => this.authenticate(), 400);
    }
  }

  // 인증 (통합 매니저 시그니처 사용)
  async authenticate() {
    const battleId = (this.authBattleId?.value || '').trim();
    const token    = (this.authToken?.value || '').trim();
    const name     = (this.authName?.value || '').trim();

    if (!battleId || !token || !name) {
      UI?.toast?.('전투 ID / 관전자 OTP / 이름을 모두 입력하세요', 'warning');
      return;
    }

    try {
      await PyxisSocket.authAsSpectator({ battleId, otp: token, spectatorName: name });
    } catch (e) {
      console.error('[Spectator] auth error:', e);
      UI?.toast?.(e.message || '인증 실패', 'danger');
    }
  }

  // 인증 성공 처리
  handleAuthSuccess(data) {
    this.joined = true;
    this.currentBattleId = data?.battleId || data?.state?.battleId || this.currentBattleId;
    this.battleState     = data?.state || data?.battle || this.battleState;

    UI?.toast?.('관전 입장 완료', 'success');
    this.render();
  }

  // 상태 업데이트 처리
  handleStateUpdate(state) {
    this.battleState = state;
    this.render();
  }

  // 응원 전송 (표준 sendChat 사용)
  sendCheer(text) {
    const msg = (text || '').trim();
    if (!msg || !this.currentBattleId) return;

    PyxisSocket.sendChat({
      text: msg,                 // 본문
      channel: 'all',            // 관전자는 전체
      sender: this.authName?.value || '관전자',
      battleId: this.currentBattleId
    });
  }

  // 채팅 출력 (소켓 매니저가 표준화한 페이로드 사용)
  handleChat(m) {
    // 표준화된 형태: { text, scope, from: { nickname }, ts }
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

  // 로그 출력
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

  // 렌더링
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

  // 유틸
  _formatTime(ts) {
    // UI.formatTime 이 있으면 사용
    if (typeof UI?.formatTime === 'function') return UI.formatTime(ts);
    try {
      return new Date(ts).toLocaleTimeString('ko-KR', { hour12: false });
    } catch {
      return '';
    }
  }
  _scrollToBottom(el) {
    if (!el) return;
    try { el.scrollTop = el.scrollHeight; } catch (_) {}
  }
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

document.addEventListener('DOMContentLoaded', () => {
  window.spectator = new PyxisSpectator();
});
window.addEventListener('beforeunload', () => {
  if (window.spectator) window.spectator.cleanup();
});