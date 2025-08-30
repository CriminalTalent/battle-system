// PYXIS Spectator Page - 관전자 전용 로직
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
    PyxisSocket.init();
  }

  // DOM 요소
  setupElements() {
    // 연결 상태
    this.connectionDot = document.getElementById('connectionDot');
    this.connectionText = document.getElementById('connectionText');

    // 로그인 폼/필드
    this.loginFormCard = document.getElementById('loginForm');
    this.spectatorLoginForm = document.getElementById('spectatorLoginForm');
    this.spectatorNameInput = document.getElementById('spectatorName');

    // 관전자 영역
    this.spectatorArea = document.getElementById('spectatorArea');

    // 팀 패널
    this.phoenixScore = document.getElementById('phoenixScore');
    this.deathScore   = document.getElementById('deathScore');
    this.phoenixMembers = document.getElementById('phoenixMembers');
    this.deathMembers   = document.getElementById('deathMembers');

    // 전투 상태/로그
    this.battlePhase = document.getElementById('battlePhase');
    this.battleInfo  = document.getElementById('battleInfo');
    this.currentTurn = document.getElementById('currentTurn');
    this.battleLog   = document.getElementById('battleLog');

    // 응원 버튼 컨테이너
    this.cheerSection = document.querySelector('.cheer-section');
  }

  // 이벤트 리스너
  setupEventListeners() {
    // 로그인 제출 (이름만 입력, battle/token은 URL에서 받음)
    this.spectatorLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.spectatorName = (this.spectatorNameInput.value || '').trim();
      if (!this.spectatorName) {
        UI?.error?.('이름을 입력하세요');
        return;
      }
      this.authenticate();
    });

    // 응원 버튼 클릭
    if (this.cheerSection) {
      this.cheerSection.addEventListener('click', (e) => {
        const btn = e.target.closest('.cheer-btn');
        if (!btn) return;
        this.sendCheer(btn.dataset.cheer);
      });
    }

    // 숫자 키(1–8)로 응원
    document.addEventListener('keydown', (e) => {
      if (!this.joined) return;
      const idx = parseInt(e.key, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > 9) return;

      const btns = Array.from(this.cheerSection?.querySelectorAll('.cheer-btn') || []);
      const target = btns[idx - 1];
      if (target) {
        e.preventDefault();
        target.classList.add('active');
        setTimeout(() => target.classList.remove('active'), 150);
        this.sendCheer(target.dataset.cheer);
      }
    });

    // 화면 복귀 시 새 상태 요청
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.joined && this.currentBattleId) {
        this.requestStateUpdate();
      }
    });
  }

  // 소켓 이벤트
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.setConn('connected', '연결됨');
      if (this.joined) {
        UI?.success?.('서버에 재연결되었습니다');
        this.requestStateUpdate();
      } else {
        UI?.success?.('서버에 연결되었습니다');
      }
    });
    PyxisSocket.on('connection:disconnect', ({ reason }) => {
      this.setConn('disconnected', '연결 끊김');
      if (this.joined) {
        UI?.error?.(reason === 'io server disconnect' ? '서버와의 연결이 종료되었습니다' : '연결이 끊어졌습니다. 재연결 시도 중...');
      }
    });
    PyxisSocket.on('connection:error', ({ error }) => {
      this.setConn('disconnected', '연결 실패');
      if (this.joined) UI?.error?.(`연결 오류: ${error?.message || '알 수 없는 오류'}`);
    });
    PyxisSocket.on('connection:attempting', ({ attemptNumber }) => {
      this.setConn('connecting', `재연결 중... (${attemptNumber}회)`);
    });
    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.setConn('connected', '재연결됨');
      UI?.success?.(`서버에 재연결되었습니다 (시도 ${attemptNumber}회)`);
      this.requestStateUpdate();
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (msg) => {
      UI?.error?.(`인증 실패: ${msg || '알 수 없는 오류'}`);
      this.showLogin();
    });

    // 상태 업데이트
    PyxisSocket.on('state:update', (state) => this.updateState(state));
    PyxisSocket.on('state', (state) => this.updateState(state));

    // 페이즈/배틀
    PyxisSocket.on('phase:change', (phase) => {
      const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addLog(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
      this.renderPhase(phase);
      PyxisNotify?.notifyWhenHidden?.('턴 전환', { body: `${teamName} 페이즈` });
    });

    PyxisSocket.on('battle:started', () => {
      this.addLog('◆ 전투 시작', 'system');
      PyxisNotify?.notify?.('전투 시작', { body: `전투ID: ${this.currentBattleId || ''}` });
    });

    PyxisSocket.on('battle:end', (result) => {
      const winnerText = result?.winner === 'draw'
        ? '무승부'
        : ((result?.winner === 'A' || result?.winner === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들');
      this.addLog(`◆ 전투 종료: ${winnerText}`, 'system');
      UI?.info?.('전투가 종료되었습니다');
      PyxisNotify?.notify?.('전투 종료', { body: winnerText });
    });

    // 로그/채팅
    PyxisSocket.on('log:new', (event) => {
      if (!event?.text) return;
      this.addLog(event.text, event.type || 'system');

      // 전투 강조 이벤트는 백그라운드 알림
      if (/치명타|피해|격파|KO/i.test(event.text)) {
        PyxisNotify?.notifyWhenHidden?.('전투 이벤트', { body: event.text });
      }
    });

    PyxisSocket.on('chat:new', (msg) => {
      // 관전자 페이지는 채팅 표시 대신 주요 로그만 유지 (원하면 여기서 표시 로직 추가 가능)
      if (msg?.type === 'system') {
        this.addLog(`[시스템] ${msg.text}`, 'system');
      }
    });

    // 응원 에코(서버가 방송해주면)
    PyxisSocket.on('spectator:cheer:sent', (data) => {
      if (!data?.cheer) return;
      this.addLog(`응원: ${data.spectator || '관전자'} - ${data.cheer}`, 'cheer');
    });
  }

  // 연결 상태 UI
  setConn(state, text) {
    if (this.connectionDot) this.connectionDot.className = `connection-dot ${state}`;
    if (this.connectionText) this.connectionText.textContent = text;
  }

  // URL 파라미터 처리
  initFromUrl() {
    const q = new URLSearchParams(window.location.search);
    this.currentBattleId = q.get('battle') || null;
    this.spectatorOtp = q.get('token') || q.get('otp') || null;

    if (!this.currentBattleId || !this.spectatorOtp) {
      this.showLogin();
      this.battlePhase.textContent = '전투 대기 중';
      this.battleInfo.textContent  = '관전 링크(battle, token)가 필요합니다';
      return;
    }

    // 링크로 진입했으면 이름만 입력받고 인증
    this.showLogin();
  }

  // 로그인 폼 보여주기
  showLogin() {
    UI?.show?.(this.loginFormCard);
    UI?.hide?.(this.spectatorArea);
  }

  // 관전자 인증
  async authenticate() {
    if (!this.currentBattleId || !this.spectatorOtp) {
      UI?.error?.('관전 링크가 올바르지 않습니다 (battle, token 필요)');
      return;
    }
    if (!this.spectatorName) {
      UI?.error?.('이름을 입력하세요');
      return;
    }

    try {
      // 알림 권한
      PyxisNotify?.requestPermission?.();

      await PyxisSocket.authenticate('spectator', {
        battleId: this.currentBattleId,
        otp: this.spectatorOtp,
        spectatorName: this.spectatorName
      });
    } catch (err) {
      console.error('[Spectator] Auth failed:', err);
      UI?.error?.(`인증 실패: ${err.message}`);
    }
  }

  // 인증 성공
  handleAuthSuccess(data) {
    this.joined = true;
    this.battleState = data.state || data.battle || null;

    // UI 전환
    UI?.hide?.(this.loginFormCard);
    UI?.show?.(this.spectatorArea);

    // 첫 렌더
    this.renderAll();

    UI?.success?.('관전 시작!');
    this.addLog(`관전자 '${this.spectatorName}' 입장`, 'system');
  }

  // 상태 갱신
  updateState(state) {
    if (!state) return;
    this.battleState = state;
    this.renderAll();
  }

  requestStateUpdate() {
    if (!PyxisSocket.isConnected() || !this.currentBattleId) return;
    PyxisSocket.socket.emit('spectator:requestState', { battleId: this.currentBattleId });
    PyxisSocket.socket.emit('requestState', { battleId: this.currentBattleId });
  }

  // ───────────────── 렌더링 ─────────────────
  renderAll() {
    this.renderPhase();
    this.renderTeams();
    this.renderScores();
    // 로그는 push 기반
  }

  renderPhase(phaseOverride = null) {
    const phaseKey = phaseOverride?.phase ?? this.battleState?.phase;
    const round    = phaseOverride?.round  ?? this.battleState?.round ?? 1;

    const phaseName =
      (phaseKey === 'A' || phaseKey === 'team1') ? '불사조 기사단'
      : (phaseKey === 'B' || phaseKey === 'team2') ? '죽음을 먹는 자들'
      : '전투 대기 중';

    this.battlePhase.textContent = `라운드 ${round} · ${phaseName} 페이즈`;

    // 현재 차례(가능하다면 pending 첫 번째 플레이어 표시)
    const pending = this.battleState?.turn?.pending || [];
    if (pending.length && this.battleState?.players) {
      const actor = this.battleState.players[pending[0]];
      this.currentTurn.style.display = '';
      this.currentTurn.textContent = actor ? `현재 차례: ${actor.name}` : '현재 차례';
    } else {
      this.currentTurn.style.display = 'none';
    }

    // 보조 설명
    if (this.battleState?.status === 'ongoing') {
      this.battleInfo.textContent = '관전 중';
    } else if (this.battleState?.status === 'waiting') {
      this.battleInfo.textContent = '플레이어들이 입장하기를 기다리는 중';
    } else if (this.battleState?.status === 'ended') {
      this.battleInfo.textContent = '전투 종료';
    } else {
      this.battleInfo.textContent = '전투 대기 중';
    }
  }

  renderTeams() {
    this.renderTeamSide(this.phoenixMembers, true);
    this.renderTeamSide(this.deathMembers, false);
  }

  renderTeamSide(container, isPhoenix) {
    container.innerHTML = '';

    const players = this.collectTeamPlayers(isPhoenix);
    if (players.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = '플레이어를 불러오는 중...';
      container.appendChild(empty);
      return;
    }

    players.forEach(p => {
      container.appendChild(this.createPlayerRow(p));
    });
  }

  collectTeamPlayers(isPhoenix) {
    if (!this.battleState) return [];
    // 우선순위: publicState.teams -> players 맵
    if (Array.isArray(this.battleState.teams) && this.battleState.teams.length) {
      const side = isPhoenix ? 'A' : 'B';
      const team = this.battleState.teams.find(t => t.side === side);
      if (team?.players?.length) return team.players;
    }

    // fallback: players 맵에서 팀 키로 분류
    const all = Object.values(this.battleState.players || {});
    return all.filter(p => {
      const t1 = (p.team === 'A' || p.team === 'team1');
      return isPhoenix ? t1 : !t1;
    });
  }

  createPlayerRow(p) {
    const row = document.createElement('div');
    row.className = `player-row ${p.alive === false ? 'dead' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    if (p.avatar) avatar.style.backgroundImage = `url(${p.avatar})`;

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = p.name + (p.alive === false ? ' (불능)' : '');

    const hp = document.createElement('div');
    hp.className = 'player-hp';
    const hpFill = document.createElement('div');
    hpFill.className = 'player-hp-fill';
    const maxHp = p.maxHp || 1000;
    hpFill.style.width = `${UI.calculateHpPercent(p.hp, maxHp)}%`;
    hp.appendChild(hpFill);

    row.appendChild(avatar);
    row.appendChild(name);
    row.appendChild(hp);
    return row;
    }

  renderScores() {
    const sumHP = (list) => list.reduce((s, x) => s + Math.max(0, x.hp || 0), 0);

    const phoenix = this.collectTeamPlayers(true);
    const death   = this.collectTeamPlayers(false);

    this.phoenixScore.textContent = String(sumHP(phoenix));
    this.deathScore.textContent   = String(sumHP(death));
  }

  // ───────────────── 응원/로그 ─────────────────
  sendCheer(text) {
    if (!text) return;
    if (!this.joined) {
      UI?.info?.('먼저 관전을 시작해주세요');
      return;
    }
    PyxisSocket.sendCheer(text, this.currentBattleId)
      .then(() => {
        UI?.success?.('응원을 보냈습니다!');
        this.addLog(`응원 전송: ${text}`, 'cheer');
      })
      .catch(() => {
        // socket-manager 내부에서 레거시 fallback 있으므로 실패해도 조용히 처리
        this.addLog(`응원 전송: ${text}`, 'cheer');
      });
  }

  addLog(text, type = 'info') {
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;

    const ts = document.createElement('div');
    ts.className = 'log-timestamp';
    ts.textContent = UI.formatTime(Date.now());

    const content = document.createElement('div');
    content.className = 'log-content';
    content.textContent = text;

    row.appendChild(ts);
    row.appendChild(content);
    this.battleLog.appendChild(row);

    UI.scrollToBottom(this.battleLog);

    while (this.battleLog.children.length > 200) {
      this.battleLog.removeChild(this.battleLog.firstChild);
    }
  }

  // 정리
  cleanup() {
    PyxisSocket.cleanup();
  }
}

// 부트스트랩
document.addEventListener('DOMContentLoaded', () => {
  window.spectator = new PyxisSpectator();
});

window.addEventListener('beforeunload', () => {
  window.spectator?.cleanup?.();
});
