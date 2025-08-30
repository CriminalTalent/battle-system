// PYXIS Spectator Page - 관전자 페이지 로직
class PyxisSpectator {
  constructor() {
    this.currentBattleId = null;
    this.spectatorName = null;
    this.spectatorCode = null;
    this.battleState = null;
    this.isConnected = false;
    this.isLoggedIn = false;
    this.cheerCooldown = new Set();
    
    this.init();
  }

  // 초기화
  init() {
    console.log('[Spectator] Initializing spectator page');
    
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.setupKeyboardShortcuts();
    this.initFromUrl();
    
    // 소켓 연결
    PyxisSocket.init();
  }

  // DOM 요소 설정
  setupElements() {
    // 연결 상태
    this.connectionStatus = UI.$('#connectionStatus');
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    // 로그인 폼
    this.loginForm = UI.$('#loginForm');
    this.spectatorLoginForm = UI.$('#spectatorLoginForm');
    this.spectatorNameInput = UI.$('#spectatorName');

    // 관전자 영역
    this.spectatorArea = UI.$('#spectatorArea');
    
    // 팀 정보
    this.phoenixMembers = UI.$('#phoenixMembers');
    this.deathMembers = UI.$('#deathMembers');
    this.phoenixScore = UI.$('#phoenixScore');
    this.deathScore = UI.$('#deathScore');
    
    // 전투 상태
    this.battlePhase = UI.$('#battlePhase');
    this.battleInfo = UI.$('#battleInfo');
    this.currentTurn = UI.$('#currentTurn');
    
    // 로그
    this.battleLog = UI.$('#battleLog');
    
    // 응원 버튼들
    this.cheerButtons = document.querySelectorAll('.cheer-btn');
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 로그인 폼
    this.spectatorLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSpectatorLogin();
    });

    // 응원 버튼들
    this.cheerButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const cheer = btn.dataset.cheer;
        if (cheer) {
          this.sendCheer(cheer, btn);
        }
      });
      
      // 단축키 표시
      if (index < 10) {
        const shortcut = document.createElement('span');
        shortcut.className = 'shortcut';
        shortcut.textContent = index + 1;
        btn.appendChild(shortcut);
      }
    });
  }

  // 소켓 이벤트 설정
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.updateConnectionStatus('connected', '연결됨');
      UI.success('서버에 연결되었습니다');
    });

    PyxisSocket.on('connection:disconnect', () => {
      this.updateConnectionStatus('disconnected', '연결 끊어짐');
      if (this.isLoggedIn) {
        UI.warning('서버 연결이 끊어졌습니다. 재연결 시도 중...');
      }
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      this.updateConnectionStatus('disconnected', '연결 실패');
      if (this.isLoggedIn) {
        UI.error(`연결 오류: ${error.message || '알 수 없는 오류'}`);
      }
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.updateConnectionStatus('connected', '재연결됨');
      UI.success(`서버에 재연결되었습니다 (시도 ${attemptNumber}회)`);
      
      if (this.isLoggedIn && this.currentBattleId) {
        this.requestStateUpdate();
      }
    });

    PyxisSocket.on('connection:attempting', ({ attemptNumber }) => {
      this.updateConnectionStatus('connecting', `재연결 중... (${attemptNumber}회)`);
    });

    // 관전자 인증
    PyxisSocket.on('spectator:joined', (data) => {
      if (data.success) {
        this.currentBattleId = data.battleId;
        this.isLoggedIn = true;
        this.showSpectatorArea();
        
        // 환영 메시지 표시
        this.addLogEntry(`관전자 "${this.spectatorName}"님이 입장했습니다!`, 'system');
        UI.success('관전자로 입장했습니다!');
      } else {
        UI.error(data.message || '관전자 입장에 실패했습니다');
      }
    });

    PyxisSocket.on('authError', (message) => {
      UI.error(`인증 실패: ${message || '알 수 없는 오류'}`);
      UI.setLoading(this.spectatorLoginForm.querySelector('button[type="submit"]'), false);
    });

    // 게임 상태 업데이트
    PyxisSocket.on('state:update', (state) => {
      this.handleBattleState(state);
    });

    PyxisSocket.on('state', (state) => {
      this.handleBattleState(state);
    });

    // 로그 및 이벤트
    PyxisSocket.on('log:new', (event) => {
      if (event?.text) {
        this.addLogEntry(event.text, event.type || 'system');
      }
    });

    PyxisSocket.on('phase:change', (phase) => {
      const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? 
        '불사조 기사단' : '죽음을 먹는 자들';
      this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
      
      if (this.battleState) {
        this.battleState.phase = phase.phase;
        this.battleState.round = phase.round;
        this.updateBattleDisplay(this.battleState);
      }
    });

    PyxisSocket.on('battle:end', (result) => {
      const winnerText = result.winner === 'draw' ? '무승부' : 
                        (result.winner === 'A' || result.winner === 'team1' ?
                         '불사조 기사단 승리!' : '죽음을 먹는 자들 승리!');
      this.addLogEntry(`🏆 전투 종료: ${winnerText}`, 'system');
      UI.success(`전투가 종료되었습니다! ${winnerText}`);
    });

    // 응원 피드백
    PyxisSocket.on('spectator:cheer:sent', () => {
      // 응원 전송 성공 피드백은 sendCheer에서 처리
    });

    // 에러 처리
    PyxisSocket.on('error', (error) => {
      console.error('[Spectator] Socket error:', error);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'log-entry system';
      errorDiv.innerHTML = `
        <div class="log-timestamp">${new Date().toLocaleTimeString('ko-KR')}</div>
        <div class="log-content">⚠️ 오류: ${error.message || '알 수 없는 오류'}</div>
      `;
      
      if (this.battleLog && this.isLoggedIn) {
        this.battleLog.appendChild(errorDiv);
        this.battleLog.scrollTop = this.battleLog.scrollHeight;
      }
    });
  }

  // 키보드 단축키 설정
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!this.isLoggedIn || e.target.tagName === 'INPUT') return;
      
      const key = e.key;
      
      // 숫자 키 1-0으로 응원 버튼 실행
      if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1;
        if (this.cheerButtons[index]) {
          e.preventDefault();
          this.cheerButtons[index].click();
        }
      } else if (key === '0') {
        const index = 9;
        if (this.cheerButtons[index]) {
          e.preventDefault();
          this.cheerButtons[index].click();
        }
      }
    });
  }

  // URL에서 초기값 설정
  initFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    this.currentBattleId = urlParams.get('battle');
    this.spectatorCode = urlParams.get('token') || urlParams.get('code');
    
    const spectatorName = urlParams.get('name');
    if (spectatorName) {
      this.spectatorNameInput.value = spectatorName;
    }
    
    // URL에 전투 정보가 있으면 자동으로 해당 전투 관전 시도
    if (this.currentBattleId && this.spectatorCode) {
      console.log('[Spectator] Auto-joining battle from URL:', this.currentBattleId);
    }
  }

  // 연결 상태 업데이트
  updateConnectionStatus(status, text) {
    this.isConnected = status === 'connected';
    
    if (this.connectionStatus) {
      this.connectionStatus.className = `connection-status ${status}`;
    }
    if (this.connectionText) {
      this.connectionText.textContent = text;
    }
  }

  // 관전자 로그인 처리
  handleSpectatorLogin() {
    const name = this.spectatorNameInput.value.trim();
    if (!name) {
      UI.error('관전자 이름을 입력해주세요');
      return;
    }

    this.spectatorName = name;
    const submitBtn = this.spectatorLoginForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true);

    if (this.currentBattleId && this.spectatorCode) {
      // URL에 battleId가 있으면 해당 전투에 관전자로 참가
      PyxisSocket.emit('spectator:join', {
        battleId: this.currentBattleId,
        spectatorName: name,
        code: this.spectatorCode
      });
    } else {
      // 일반적인 관전자 로그인
      PyxisSocket.emit('spectator:login', { name });
    }
  }

  // 관전자 영역 표시
  showSpectatorArea() {
    if (this.loginForm) {
      this.loginForm.style.display = 'none';
    }
    if (this.spectatorArea) {
      this.spectatorArea.style.display = 'block';
      this.spectatorArea.classList.add('fade-in');
    }
  }

  // 전투 상태 처리
  handleBattleState(data) {
    if (!this.isLoggedIn && data.success) {
      this.isLoggedIn = true;
      if (data.battle) {
        this.battleState = data.battle;
      }
      this.showSpectatorArea();
    }

    if (data.battle) {
      this.battleState = data.battle;
      this.updateBattleDisplay(data.battle);
    }
  }

  // 전투 화면 업데이트
  updateBattleDisplay(battle) {
    // 전투 상태 업데이트
    this.updateBattleStatus(battle);
    
    // 팀 정보 업데이트
    this.updateTeamDisplay('team1', this.getTeamPlayers(battle, 'team1'), this.phoenixMembers);
    this.updateTeamDisplay('team2', this.getTeamPlayers(battle, 'team2'), this.deathMembers);
    
    // 점수 업데이트 (필요시)
    if (battle.score) {
      if (this.phoenixScore) this.phoenixScore.textContent = battle.score.team1 || 0;
      if (this.deathScore) this.deathScore.textContent = battle.score.team2 || 0;
    }
  }

  // 전투 상태 업데이트
  updateBattleStatus(battle) {
    const phase = battle.status || battle.phase || 'waiting';
    const turn = battle.turn || {};
    
    switch (phase) {
      case 'waiting':
        this.setBattleStatus('전투 대기 중', '플레이어들이 입장하기를 기다리고 있습니다');
        this.hideTurnInfo();
        break;
        
      case 'ready':
        this.setBattleStatus('전투 준비', '모든 플레이어가 입장했습니다. 전투 시작을 기다리는 중...');
        this.hideTurnInfo();
        break;
        
      case 'ongoing':
        const currentTeam = battle.phase === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
        const roundText = battle.round ? `라운드 ${battle.round}` : '';
        this.setBattleStatus('전투 진행 중', `${roundText} - 현재 턴: ${currentTeam}`);
        this.showTurnInfo(`${currentTeam}의 턴`);
        break;
        
      case 'ended':
        const winner = this.getWinnerText(battle.winner);
        this.setBattleStatus('전투 종료', `승부 결과: ${winner}`);
        this.hideTurnInfo();
        break;
        
      default:
        this.setBattleStatus('알 수 없는 상태', '전투 상태를 확인하는 중...');
        this.hideTurnInfo();
    }
  }

  // 전투 상태 텍스트 설정
  setBattleStatus(title, info) {
    if (this.battlePhase) {
      this.battlePhase.textContent = title;
    }
    if (this.battleInfo) {
      this.battleInfo.textContent = info;
    }
  }

  // 턴 정보 표시
  showTurnInfo(text) {
    if (this.currentTurn) {
      this.currentTurn.textContent = text;
      this.currentTurn.style.display = 'block';
    }
  }

  // 턴 정보 숨기기
  hideTurnInfo() {
    if (this.currentTurn) {
      this.currentTurn.style.display = 'none';
    }
  }

  // 승자 텍스트 얻기
  getWinnerText(winner) {
    switch (winner) {
      case 'team1':
      case 'A':
        return '불사조 기사단 승리!';
      case 'team2':
      case 'B':
        return '죽음을 먹는 자들 승리!';
      case 'draw':
        return '무승부';
      default:
        return '결과 미확정';
    }
  }

  // 팀 플레이어 목록 얻기
  getTeamPlayers(battle, team) {
    if (!battle.players) return [];
    
    return Object.values(battle.players).filter(player => player.team === team);
  }

  // 팀 화면 업데이트
  updateTeamDisplay(teamId, players, container) {
    if (!container) return;

    container.innerHTML = '';

    if (!players || players.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'loading';
      emptyDiv.textContent = '플레이어가 없습니다';
      container.appendChild(emptyDiv);
      return;
    }

    players.forEach(player => {
      const playerCard = this.createPlayerCard(player);
      container.appendChild(playerCard);
    });
  }

  // 플레이어 카드 생성
  createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card';
    
    // 현재 턴 플레이어 하이라이트
    if (this.battleState && this.battleState.turn && 
        this.battleState.turn.actor === player.id) {
      card.classList.add('current-player');
    }
    
    // 사망한 플레이어 스타일
    if (!player.alive || player.hp <= 0) {
      card.classList.add('defeated');
    }

    // 아바타
    const avatar = document.createElement('img');
    avatar.className = 'player-avatar';
    avatar.src = player.avatar || '/assets/default-avatar.png';
    avatar.alt = player.name;
    avatar.onerror = () => {
      avatar.style.background = 'linear-gradient(135deg, var(--midnight), var(--navy-mist))';
      avatar.style.display = 'block';
    };

    // 플레이어 정보
    const info = document.createElement('div');
    info.className = 'player-info';

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;

    const stats = document.createElement('div');
    stats.className = 'player-stats';
    stats.innerHTML = `
      공격 ${player.atk || 0} | 방어 ${player.def || 0} | 
      민첩 ${player.agi || 0} | 행운 ${player.luk || 0}
    `;

    const hpBar = document.createElement('div');
    hpBar.className = 'player-hp';
    
    const hpFill = document.createElement('div');
    hpFill.className = 'player-hp-fill';
    const hpPercent = Math.max(0, Math.min(100, (player.hp || 0) / (player.maxHp || 1000) * 100));
    hpFill.style.width = `${hpPercent}%`;
    
    hpBar.appendChild(hpFill);

    const items = document.createElement('div');
    items.className = 'player-items';
    if (player.items) {
      const itemText = [];
      if (player.items.dittany > 0) itemText.push(`디터니 ${player.items.dittany}`);
      if (player.items.atkBoost > 0) itemText.push(`공격보정 ${player.items.atkBoost}`);
      if (player.items.defBoost > 0) itemText.push(`방어보정 ${player.items.defBoost}`);
      items.textContent = itemText.join(' | ') || '아이템 없음';
    } else {
      items.textContent = '아이템 정보 없음';
    }

    info.appendChild(name);
    info.appendChild(stats);
    info.appendChild(hpBar);
    info.appendChild(items);

    card.appendChild(avatar);
    card.appendChild(info);

    return card;
  }

  // 응원 전송
  sendCheer(cheer, button) {
    if (!this.isLoggedIn || !this.currentBattleId) {
      UI.warning('전투에 참여한 후 응원할 수 있습니다');
      return;
    }

    // 쿨다운 체크
    if (this.cheerCooldown.has(cheer)) {
      UI.warning('잠시 후에 다시 응원해주세요');
      return;
    }

    // 쿨다운 설정 (3초)
    this.cheerCooldown.add(cheer);
    setTimeout(() => {
      this.cheerCooldown.delete(cheer);
    }, 3000);

    // 버튼 상태 변경
    if (button) {
      button.classList.add('sent');
      button.disabled = true;
      setTimeout(() => {
        button.classList.remove('sent');
        button.disabled = false;
      }, 1000);
    }

    // 소켓으로 응원 전송
    PyxisSocket.emit('spectator:cheer', {
      battleId: this.currentBattleId,
      spectator: this.spectatorName,
      cheer: cheer
    });

    // 로컬 로그 추가
    this.addLogEntry(`📣 ${this.spectatorName}: ${cheer}`, 'spectator');

    UI.success(`응원을 보냈습니다: ${cheer}`);
  }

  // 로그 엔트리 추가
  addLogEntry(text, type = 'system') {
    if (!this.battleLog) return;

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'log-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString('ko-KR');
    
    const content = document.createElement('div');
    content.className = 'log-content';
    content.textContent = text;
    
    entry.appendChild(timestamp);
    entry.appendChild(content);
    
    this.battleLog.appendChild(entry);
    this.battleLog.scrollTop = this.battleLog.scrollHeight;

    // 로그 항목이 너무 많으면 오래된 것 제거
    const entries = this.battleLog.querySelectorAll('.log-entry');
    if (entries.length > 100) {
      entries[0].remove();
    }
  }

  // 상태 요청
  requestStateUpdate() {
    if (this.currentBattleId) {
      PyxisSocket.emit('spectator:requestState', {
        battleId: this.currentBattleId
      });
    }
  }

  // 정리
  destroy() {
    if (this.currentBattleId && this.spectatorName) {
      PyxisSocket.emit('spectator:leave', {
        battleId: this.currentBattleId,
        spectator: this.spectatorName
      });
    }
    PyxisSocket.disconnect();
  }
}

// 전역 인스턴스 생성
let spectatorApp;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  spectatorApp = new PyxisSpectator();
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (spectatorApp) {
    spectatorApp.destroy();
  }
});

// 전역 접근을 위한 export
window.PyxisSpectator = PyxisSpectator;
