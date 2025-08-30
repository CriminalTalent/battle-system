// PYXIS Spectator Page - 관전자 페이지 로직
class PyxisSpectator {
  constructor() {
    this.currentBattleId = null;
    this.spectatorOtp = null;
    this.spectatorName = null;

    this.battleState = null;
    this.joined = false;

    this.init();
  }

  // 초기화
  init() {
    console.log('[Spectator] Initializing spectator page');

    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    // 소켓 연결
    if (!window.PyxisSocket) {
      console.error('[Spectator] PyxisSocket not found');
      UI?.error?.('소켓 초기화 실패');
      return;
    }
    PyxisSocket.init();
  }

  // DOM 요소 매핑
  setupElements() {
    // 연결 상태
    this.connectionStatus = UI.$('#connectionStatus');
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    // 로그인
    this.loginFormWrap = UI.$('#loginForm');
    this.loginForm = UI.$('#spectatorLoginForm');
    this.nameInput = UI.$('#spectatorName');

    // 관전자 영역
    this.spectatorArea = UI.$('#spectatorArea');

    // 팀 패널
    this.phoenixMembers = UI.$('#phoenixMembers');
    this.deathMembers = UI.$('#deathMembers');
    this.phoenixScore = UI.$('#phoenixScore');
    this.deathScore = UI.$('#deathScore');

    // 전투 상태/로그
    this.battlePhase = UI.$('#battlePhase');
    this.battleInfo = UI.$('#battleInfo');
    this.currentTurn = UI.$('#currentTurn');
    this.battleLog = UI.$('#battleLog');

    // 응원 버튼 컨테이너
    this.cheerSection = document.querySelector('.cheer-section');
  }

  // 이벤트 리스너
  setupEventListeners() {
    // 로그인
    this.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.startSpectating();
    });

    // 응원 버튼 클릭
    this.cheerSection?.addEventListener('click', (e) => {
      const btn = e.target.closest('.cheer-btn');
      if (!btn) return;
      const cheer = btn.dataset.cheer;
      this.sendCheer(cheer);
    });

    // 단축키 (1~8)
    document.addEventListener('keydown', (e) => {
      if (!this.joined) return;
      const key = e.key;
      if (!/^[1-8]$/.test(key)) return;

      const idx = Number(key) - 1;
      const buttons = this.cheerSection?.querySelectorAll('.cheer-btn');
      if (!buttons || !buttons[idx]) return;

      e.preventDefault();
      buttons[idx].click();
    });
  }

  // 소켓 이벤트
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.updateConnectionStatus('connected', '연결됨');
      if (this.joined) UI.success('서버에 재연결되었습니다');
    });

    PyxisSocket.on('connection:disconnect', ({ reason }) => {
      this.updateConnectionStatus('disconnected', '연결 끊김');
      if (this.joined) {
        const msg = reason === 'io server disconnect' ? '서버 연결 종료' : '연결 끊김 · 재연결 시도 중';
        UI.warning(msg);
      }
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      this.updateConnectionStatus('disconnected', '연결 실패');
      if (this.joined) {
        UI.error(`연결 오류: ${error?.message || '알 수 없는 오류'}`);
      }
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.updateConnectionStatus('connected', '재연결됨');
      if (this.joined) {
        UI.success(`재연결 완료 (${attemptNumber}회 시도)`);
        this.requestState();
      }
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => this.onAuthSuccess(data));
    PyxisSocket.on('authError', (msg) => UI.error(`인증 실패: ${msg}`));

    // 상태 업데이트
    PyxisSocket.on('state', (state) => this.onStateUpdate(state));
    PyxisSocket.on('state:update', (state) => this.onStateUpdate(state));

    // 페이즈/턴
    PyxisSocket.on('phase:change', (phase) => {
      const teamName =
        phase.phase === 'A' || phase.phase === 'team1'
          ? '불사조 기사단'
          : '죽음을 먹는 자들';
      this.addLog(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');

      if (this.battleState) {
        this.battleState.phase = phase.phase;
        this.battleState.round = phase.round;
      }
      this.renderHeader();
    });

    // 관전자 관련
    PyxisSocket.on('spectator:joined', ({ name }) => {
      this.addLog(`관전자 '${name}'님이 입장했습니다`, 'system');
    });

    PyxisSocket.on('spectator:left', ({ name }) => {
      this.addLog(`관전자 '${name}'님이 퇴장했습니다`, 'system');
    });

    PyxisSocket.on('spectator:cheer:sent', (data) => {
      // 응원 브로드캐스트
      const who = data?.spectator || '관전자';
      if (data?.cheer) this.addLog(`[응원] ${who}: ${data.cheer}`, 'cheer');
    });

    // 일반 로그
    PyxisSocket.on('log:new', (event) => {
      if (event?.text) this.addLog(event.text, event.type || 'info');
    });

    // 전투 종료
    PyxisSocket.on('battle:end', (result) => {
      const winnerText =
        result?.winner === 'draw'
          ? '무승부'
          : result?.winner === 'A' || result?.winner === 'team1'
          ? '불사조 기사단'
          : '죽음을 먹는 자들';
      this.addLog(`◆ 전투 종료: ${winnerText}`, 'system');
      this.battlePhase.textContent = '전투 종료';
    });
  }

  // 연결 상태 UI
  updateConnectionStatus(status, text) {
    this.connectionDot.className = `connection-dot ${status}`;
    this.connectionText.textContent = text;
  }

  // URL 파라미터 처리
  initFromUrl() {
    const url = new URL(window.location.href);
    const battle = url.searchParams.get('battle');
    const token = url.searchParams.get('token');
    const name = url.searchParams.get('name'); // 선택

    if (battle) this.currentBattleId = battle;
    if (token) this.spectatorOtp = token;
    if (name) this.nameInput.value = decodeURIComponent(name);
  }

  // 관전 시작(인증)
  async startSpectating() {
    this.spectatorName = (this.nameInput.value || '').trim();
    if (!this.spectatorName) {
      UI.error('관전자 이름을 입력하세요');
      return;
    }
    if (!this.currentBattleId || !this.spectatorOtp) {
      UI.error('유효한 링크로 접속해야 합니다 (battle/token 누락)');
      return;
    }

    try {
      // socket-manager에 따라 인증 메서드 사용
      // 1) 역할지정 authenticate
      if (typeof PyxisSocket.authenticate === 'function' && PyxisSocket.authenticate.length === 2) {
        await PyxisSocket.authenticate('spectator', {
          battleId: this.currentBattleId,
          otp: this.spectatorOtp,
          spectatorName: this.spectatorName
        });
      } else if (typeof PyxisSocket.authenticateAsSpectator === 'function') {
        // 2) 별도 헬퍼
        await PyxisSocket.authenticateAsSpectator(
          this.currentBattleId,
          this.spectatorOtp,
          this.spectatorName
        );
      } else {
        // 3) 레거시 이벤트 직접 발신
        await new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('인증 타임아웃')), 10000);
          PyxisSocket.once('authSuccess', (d) => {
            clearTimeout(to);
            resolve(d);
          });
          PyxisSocket.once('authError', (m) => {
            clearTimeout(to);
            reject(new Error(m));
          });
          PyxisSocket.socket.emit('spectatorAuth', {
            battleId: this.currentBattleId,
            otp: this.spectatorOtp,
            spectatorName: this.spectatorName
          });
        });
      }
    } catch (e) {
      console.error('[Spectator] Auth error', e);
      UI.error(`관전자 인증 실패: ${e.message || e}`);
    }
  }

  // 인증 성공
  onAuthSuccess(data) {
    this.joined = true;
    this.battleState = data?.state || data?.battle || null;

    UI.hide(this.loginFormWrap);
    UI.show(this.spectatorArea);

    UI.success('관전 입장 완료!');
    this.renderAll();

    // 상태 동기화 요청(안전)
    this.requestState();
  }

  // 상태 요청
  requestState() {
    try {
      if (PyxisSocket?.socket && this.currentBattleId) {
        PyxisSocket.socket.emit('requestState', { battleId: this.currentBattleId });
      }
    } catch (e) {
      console.warn('[Spectator] requestState failed', e);
    }
  }

  // 상태 수신
  onStateUpdate(state) {
    this.battleState = state;
    this.renderAll();
  }

  // 전체 렌더
  renderAll() {
    if (!this.battleState) return;
    this.renderHeader();
    this.renderTeams();
    this.renderLogFromState();
  }

  // 상단 상태
  renderHeader() {
    const status = this.battleState?.status || this.battleState?.state || 'waiting';
    const phase = this.battleState?.phase || '-';
    const round = this.battleState?.round || 1;

    const statusText =
      status === 'active' || status === 'ongoing'
        ? '전투 진행 중'
        : status === 'ended'
        ? '전투 종료'
        : '전투 대기 중';

    this.battlePhase.textContent = statusText;
    this.battleInfo.textContent = `페이즈: ${phase} · 라운드 ${round}`;

    // 현재 턴 표시(가능하면)
    const currentActor =
      this.battleState?.turn?.pending?.[0] || this.battleState?.turn?.actor || null;
    if (currentActor && this.battleState?.players?.[currentActor]) {
      const p = this.battleState.players[currentActor];
      this.currentTurn.style.display = '';
      this.currentTurn.textContent = `현재 차례: ${p.name} (${UI.getTeamName(p.team)})`;
    } else {
      this.currentTurn.style.display = 'none';
    }

    // 스코어(있으면)
    const scoreA = this.battleState?.score?.A ?? this.battleState?.score?.team1 ?? 0;
    const scoreB = this.battleState?.score?.B ?? this.battleState?.score?.team2 ?? 0;
    this.phoenixScore.textContent = scoreA;
    this.deathScore.textContent = scoreB;
  }

  // 팀/플레이어 렌더
  renderTeams() {
    this.phoenixMembers.innerHTML = '';
    this.deathMembers.innerHTML = '';

    const players = this.battleState?.players || {};
    const list = Object.values(players);

    const teamA = list.filter((p) => p.team === 'A' || p.team === 'team1');
    const teamB = list.filter((p) => p.team === 'B' || p.team === 'team2');

    if (teamA.length === 0) {
      this.phoenixMembers.innerHTML = '<div class="loading">플레이어가 없습니다</div>';
    } else {
      teamA.forEach((p) => this.phoenixMembers.appendChild(this.createPlayerRow(p)));
    }

    if (teamB.length === 0) {
      this.deathMembers.innerHTML = '<div class="loading">플레이어가 없습니다</div>';
    } else {
      teamB.forEach((p) => this.deathMembers.appendChild(this.createPlayerRow(p)));
    }
  }

  // 플레이어 카드/행
  createPlayerRow(player) {
    const wrap = document.createElement('div');
    wrap.className = `player-card ${player.alive === false ? 'defeated' : ''}`;

    const hpPct = UI.calculateHpPercent(player.hp, player.maxHp || 100);
    const stats = player.stats || {
      attack: player.atk,
      defense: player.def,
      agility: player.agi,
      luck: player.luk
    };

    wrap.innerHTML = `
      <div class="player">
        <div class="player-row" style="display:flex; gap:14px; align-items:center;">
          <div class="player-avatar" style="${
            player.avatar ? `background-image:url(${player.avatar});` : ''
          }"></div>
          <div style="flex:1;">
            <div class="player-name" style="font-weight:700;">
              ${player.name}${player.alive === false ? ' (불능)' : ''}
            </div>
            <div class="player-stats">
              공격 ${stats.attack ?? player.atk} · 방어 ${stats.defense ?? player.def} · 민첩 ${
      stats.agility ?? player.agi
    } · 행운 ${stats.luck ?? player.luk}
            </div>
            <div class="player-hp" style="margin-top:8px; position:relative;">
              <div class="player-hp-fill" style="width:${hpPct}%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    return wrap;
  }

  // 상태의 로그를 화면에(중복 누적 방지: 마지막 100개만)
  renderLogFromState() {
    if (!this.battleState?.chat) return;
    this.battleLog.innerHTML = '';
    this.battleState.chat.slice(-50).forEach((entry) => {
      if (!entry?.text) return;
      const type =
        entry.type ||
        (entry.scope === 'team' ? 'team' : entry.role === 'system' ? 'system' : 'info');
      this.addLog(entry.text, type, entry.ts);
    });
  }

  // 로그 추가
  addLog(text, type = 'info', ts = Date.now()) {
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = UI.formatTime(ts || Date.now());

    const content = document.createElement('span');
    content.className = 'log-content';
    content.textContent = text;

    row.appendChild(time);
    row.appendChild(content);
    this.battleLog.appendChild(row);

    UI.scrollToBottom(this.battleLog);

    // 100개 유지
    while (this.battleLog.children.length > 100) {
      this.battleLog.removeChild(this.battleLog.firstChild);
    }
  }

  // 응원 전송
  async sendCheer(text) {
    if (!text) return;
    if (!PyxisSocket.isConnected()) {
      UI.error('서버와 연결되어 있지 않습니다');
      return;
    }
    try {
      await PyxisSocket.sendCheer(text, this.currentBattleId);
      UI.success('응원 전달!');
    } catch (e) {
      console.error('[Spectator] sendCheer error', e);
      UI.error('응원 전송 실패');
    }
  }

  // 정리
  cleanup() {
    PyxisSocket?.cleanup?.();
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.spectator = new PyxisSpectator();
});

window.addEventListener('beforeunload', () => {
  if (window.spectator) window.spectator.cleanup();
});
