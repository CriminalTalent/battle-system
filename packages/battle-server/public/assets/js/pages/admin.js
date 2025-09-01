/**
 * PYXIS Admin Interface - 수정된 기능 연결
 */

class AdminInterface {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.currentBattleId = null;
    this.battleData = null;
    this.playerList = [];
    
    this.init();
  }

  init() {
    console.log('[Admin] 시스템 초기화 시작');
    this.initElements();
    this.setupEventListeners();
    this.updateStatTotals(); // 스탯 총합 초기화
    this.addLog('system', '관리자 시스템이 준비되었습니다');
  }

  initElements() {
    // 전투 생성 폼
    this.battleCreateForm = document.getElementById('battleCreateForm');
    this.battleMode = document.getElementById('battleMode');
    this.battleInfo = document.getElementById('battleInfo');
    this.battleIdDisplay = document.getElementById('battleIdDisplay');
    this.adminOtpDisplay = document.getElementById('adminOtpDisplay');
    this.createTimeDisplay = document.getElementById('createTimeDisplay');

    // 제어 버튼들
    this.btnConnect = document.getElementById('btnConnect');
    this.btnStartBattle = document.getElementById('btnStartBattle');
    this.btnPauseBattle = document.getElementById('btnPauseBattle');
    this.btnEndBattle = document.getElementById('btnEndBattle');

    // 플레이어 추가 폼
    this.playerForm = document.getElementById('playerForm');
    this.btnAddPlayer = document.getElementById('btnAddPlayer');

    // 스탯 관련
    this.statAttack = document.getElementById('statAttack');
    this.statDefense = document.getElementById('statDefense');
    this.statAgility = document.getElementById('statAgility');
    this.statLuck = document.getElementById('statLuck');

    // 링크 관리
    this.linksSection = document.getElementById('linksSection');
    this.btnGenerateLinks = document.getElementById('btnGenerateLinks');
    this.linksList = document.getElementById('linksList');

    // 로그 및 채팅
    this.logViewer = document.getElementById('logViewer');
    this.chatInput = document.getElementById('chatInput');
    this.btnSendChat = document.getElementById('btnSendChat');

    // 팀 로스터
    this.rosterCard = document.getElementById('rosterCard');
    this.team1Roster = document.getElementById('team1Roster');
    this.team2Roster = document.getElementById('team2Roster');
    this.teamACount = document.getElementById('teamACount');
    this.teamBCount = document.getElementById('teamBCount');
  }

  setupEventListeners() {
    // 전투 생성 폼
    if (this.battleCreateForm) {
      this.battleCreateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createBattle();
      });
    }

    // 제어 버튼들
    if (this.btnConnect) {
      this.btnConnect.addEventListener('click', () => this.connectAsAdmin());
    }
    if (this.btnStartBattle) {
      this.btnStartBattle.addEventListener('click', () => this.startBattle());
    }
    if (this.btnPauseBattle) {
      this.btnPauseBattle.addEventListener('click', () => this.pauseBattle());
    }
    if (this.btnEndBattle) {
      this.btnEndBattle.addEventListener('click', () => this.endBattle());
    }

    // 플레이어 추가
    if (this.btnAddPlayer) {
      this.btnAddPlayer.addEventListener('click', () => this.addPlayer());
    }

    // 스탯 입력들
    this.setupStatInputs();

    // 링크 생성
    if (this.btnGenerateLinks) {
      this.btnGenerateLinks.addEventListener('click', () => this.generateLinks());
    }

    // 채팅
    if (this.btnSendChat) {
      this.btnSendChat.addEventListener('click', () => this.sendChat());
    }
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }
  }

  // 스탯 입력 설정 (숫자 입력으로 변경)
  setupStatInputs() {
    const inputs = [this.statAttack, this.statDefense, this.statAgility, this.statLuck];

    inputs.forEach(input => {
      if (input) {
        // 입력 제한 이벤트
        input.addEventListener('input', (e) => {
          let value = parseInt(e.target.value);
          if (isNaN(value) || value < 1) value = 1;
          if (value > 5) value = 5;
          e.target.value = value;
        });

        // 키보드 이벤트 (위/아래 화살표)
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            let value = parseInt(e.target.value) || 1;
            if (value < 5) e.target.value = value + 1;
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            let value = parseInt(e.target.value) || 1;
            if (value > 1) e.target.value = value - 1;
          }
        });
      }
    });
  }

  // 스탯 총합 계산 (사용 안함 - HTML에서 제거됨)
  updateStatTotals() {
    // 더 이상 사용하지 않음
  }

  // 전투 생성
  async createBattle() {
    const mode = this.battleMode?.value;
    if (!mode) {
      this.showToast('전투 모드를 선택해주세요', 'error');
      return;
    }

    try {
      this.addLog('system', '전투를 생성하는 중...');

      // 시뮬레이션
      await this.delay(1000);

      const battleId = this.generateBattleId();
      const adminOtp = this.generateOtp();
      const createTime = new Date().toLocaleString('ko-KR');

      this.currentBattleId = battleId;
      this.battleData = {
        id: battleId,
        mode: mode,
        adminOtp: adminOtp,
        createdAt: new Date(),
        status: 'waiting'
      };

      // UI 업데이트
      if (this.battleIdDisplay) this.battleIdDisplay.textContent = battleId;
      if (this.adminOtpDisplay) this.adminOtpDisplay.textContent = adminOtp;
      if (this.createTimeDisplay) this.createTimeDisplay.textContent = createTime;

      // 전투 정보 표시
      if (this.battleInfo) {
        this.battleInfo.style.display = 'block';
      }

      // 링크 섹션 표시
      if (this.linksSection) {
        this.linksSection.style.display = 'block';
      }

      // 로스터 카드 표시
      if (this.rosterCard) {
        this.rosterCard.style.display = 'block';
      }

      this.addLog('system', `전투가 생성되었습니다 (ID: ${battleId})`);
      this.showToast('전투가 성공적으로 생성되었습니다!', 'success');

    } catch (error) {
      this.addLog('error', '전투 생성 실패: ' + error.message);
      this.showToast('전투 생성에 실패했습니다', 'error');
    }
  }

  // 관리자 연결
  async connectAsAdmin() {
    if (!this.currentBattleId) {
      this.showToast('먼저 전투를 생성해주세요', 'error');
      return;
    }

    try {
      this.addLog('system', '관리자로 연결하는 중...');

      // 연결 시뮬레이션
      await this.delay(1500);

      this.isConnected = true;
      this.addLog('system', '관리자 연결 완료!');

      // 버튼 상태 업데이트
      if (this.btnConnect) {
        this.btnConnect.textContent = '연결됨';
        this.btnConnect.disabled = true;
        this.btnConnect.classList.add('btn-success');
      }
      if (this.btnStartBattle) {
        this.btnStartBattle.disabled = false;
      }
      if (this.btnEndBattle) {
        this.btnEndBattle.disabled = false;
      }

      this.showToast('관리자로 연결되었습니다!', 'success');

    } catch (error) {
      this.addLog('error', '관리자 연결 실패: ' + error.message);
      this.showToast('관리자 연결에 실패했습니다', 'error');
    }
  }

  // 전투 시작
  async startBattle() {
    if (!this.isConnected) {
      this.showToast('먼저 관리자 연결을 해주세요', 'error');
      return;
    }

    if (this.playerList.length < 2) {
      this.showToast('최소 2명의 플레이어가 필요합니다', 'error');
      return;
    }

    try {
      this.addLog('system', '전투를 시작합니다...');

      await this.delay(1000);

      if (this.battleData) {
        this.battleData.status = 'active';
      }

      // 버튼 상태 업데이트
      if (this.btnStartBattle) {
        this.btnStartBattle.textContent = '진행 중';
        this.btnStartBattle.disabled = true;
      }
      if (this.btnPauseBattle) {
        this.btnPauseBattle.disabled = false;
      }

      this.addLog('system', '전투가 시작되었습니다!');
      this.showToast('전투가 시작되었습니다!', 'success');

    } catch (error) {
      this.addLog('error', '전투 시작 실패: ' + error.message);
      this.showToast('전투 시작에 실패했습니다', 'error');
    }
  }

  // 일시정지
  pauseBattle() {
    this.addLog('system', '전투가 일시정지되었습니다');
    this.showToast('전투가 일시정지되었습니다', 'warning');
  }

  // 전투 종료
  async endBattle() {
    try {
      this.addLog('system', '전투를 종료합니다...');

      await this.delay(1000);

      if (this.battleData) {
        this.battleData.status = 'ended';
      }

      // 버튼 초기화
      if (this.btnStartBattle) {
        this.btnStartBattle.textContent = '전투 시작';
        this.btnStartBattle.disabled = true;
      }
      if (this.btnPauseBattle) {
        this.btnPauseBattle.disabled = true;
      }
      if (this.btnEndBattle) {
        this.btnEndBattle.disabled = true;
      }

      this.addLog('system', '전투가 종료되었습니다');
      this.showToast('전투가 종료되었습니다', 'info');

    } catch (error) {
      this.addLog('error', '전투 종료 실패: ' + error.message);
    }
  }

  // 플레이어 추가
  addPlayer() {
    if (!this.currentBattleId) {
      this.showToast('먼저 전투를 생성해주세요', 'error');
      return;
    }

    const name = document.getElementById('playerName')?.value?.trim();
    const team = document.getElementById('playerTeam')?.value;

    if (!name || !team) {
      this.showToast('플레이어 이름과 팀을 모두 입력해주세요', 'error');
      return;
    }

    // 중복 이름 체크
    if (this.playerList.find(p => p.name === name)) {
      this.showToast('이미 존재하는 플레이어 이름입니다', 'error');
      return;
    }

    // 플레이어 데이터 생성
    const player = {
      id: this.generateId(),
      name: name,
      team: team,
      stats: {
        attack: parseInt(this.statAttack?.value || 3),
        defense: parseInt(this.statDefense?.value || 3),
        agility: parseInt(this.statAgility?.value || 3),
        luck: parseInt(this.statLuck?.value || 3)
      },
      items: {
        dittany: parseInt(document.getElementById('itemDittany')?.value || 0),
        attackBoost: parseInt(document.getElementById('itemAttackBoost')?.value || 0),
        defenseBoost: parseInt(document.getElementById('itemDefenseBoost')?.value || 0)
      },
      hp: 100,
      maxHp: 100
    };

    this.playerList.push(player);
    this.updateTeamRoster();
    this.resetPlayerForm();

    this.addLog('system', `플레이어 '${name}'이 ${team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'}에 추가되었습니다`);
    this.showToast(`${name}이 추가되었습니다!`, 'success');
  }

  // 팀 로스터 업데이트
  updateTeamRoster() {
    const teamA = this.playerList.filter(p => p.team === 'A');
    const teamB = this.playerList.filter(p => p.team === 'B');

    // 팀 카운트 업데이트
    if (this.teamACount) this.teamACount.textContent = `${teamA.length}/4`;
    if (this.teamBCount) this.teamBCount.textContent = `${teamB.length}/4`;

    // 팀 A 로스터
    if (this.team1Roster) {
      this.team1Roster.innerHTML = teamA.length ? 
        teamA.map(p => this.createPlayerCard(p)).join('') : 
        '<div class="empty-slot">빈 자리</div>';
    }

    // 팀 B 로스터
    if (this.team2Roster) {
      this.team2Roster.innerHTML = teamB.length ? 
        teamB.map(p => this.createPlayerCard(p)).join('') : 
        '<div class="empty-slot">빈 자리</div>';
    }
  }

  // 플레이어 카드 생성
  createPlayerCard(player) {
    return `
      <div class="player-card" data-player-id="${player.id}">
        <div class="player-avatar">${player.name.charAt(0)}</div>
        <div class="player-info">
          <div class="player-name">${player.name}</div>
          <div class="player-stats">
            공격: ${player.stats.attack} | 방어: ${player.stats.defense} | 
            민첩: ${player.stats.agility} | 행운: ${player.stats.luck}
          </div>
          <div class="player-items">
            디터니: ${player.items.dittany} | 
            공격보정: ${player.items.attackBoost} | 
            방어보정: ${player.items.defenseBoost}
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="adminInterface.removePlayer('${player.id}')">
          제거
        </button>
      </div>
    `;
  }

  // 플레이어 제거
  removePlayer(playerId) {
    const index = this.playerList.findIndex(p => p.id === playerId);
    if (index > -1) {
      const player = this.playerList[index];
      this.playerList.splice(index, 1);
      this.updateTeamRoster();
      this.addLog('system', `플레이어 '${player.name}'이 제거되었습니다`);
      this.showToast(`${player.name}이 제거되었습니다`, 'info');
    }
  }

  // 플레이어 폼 초기화
  resetPlayerForm() {
    const form = document.getElementById('playerForm');
    if (form) {
      form.reset();
    }
    // 스탯 입력 초기화
    [this.statAttack, this.statDefense, this.statAgility, this.statLuck].forEach(input => {
      if (input) {
        input.value = 3;
      }
    });
  }

  // 링크 생성
  generateLinks() {
    if (!this.currentBattleId || this.playerList.length === 0) {
      this.showToast('플레이어를 먼저 추가해주세요', 'error');
      return;
    }

    const baseUrl = window.location.origin;
    let linksHtml = '<div class="links-grid">';

    // 플레이어 링크들
    this.playerList.forEach(player => {
      const playerUrl = `${baseUrl}/play?name=${encodeURIComponent(player.name)}&token=${this.generateToken()}&battle=${this.currentBattleId}`;
      linksHtml += `
        <div class="link-item">
          <div class="link-label">${player.name} (${player.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'})</div>
          <div class="link-url">${playerUrl}</div>
          <button class="btn btn-sm btn-primary" onclick="navigator.clipboard.writeText('${playerUrl}')">복사</button>
        </div>
      `;
    });

    // 관전자 링크
    const spectatorUrl = `${baseUrl}/spectator?battle=${this.currentBattleId}&otp=${this.generateOtp()}`;
    linksHtml += `
      <div class="link-item spectator-link">
        <div class="link-label">관전자 링크</div>
        <div class="link-url">${spectatorUrl}</div>
        <button class="btn btn-sm btn-primary" onclick="navigator.clipboard.writeText('${spectatorUrl}')">복사</button>
      </div>
    `;

    linksHtml += '</div>';

    if (this.linksList) {
      this.linksList.innerHTML = linksHtml;
    }

    this.addLog('system', '링크가 생성되었습니다');
    this.showToast('링크가 생성되었습니다!', 'success');
  }

  // 채팅 전송
  sendChat() {
    const message = this.chatInput?.value?.trim();
    if (!message) return;

    const channel = document.getElementById('chatChannel')?.value || 'all';
    
    this.addLog('admin', `[${channel}] ${message}`);
    
    if (this.chatInput) {
      this.chatInput.value = '';
    }
  }

  // 로그 추가
  addLog(type, message) {
    if (!this.logViewer) return;

    const time = new Date().toLocaleTimeString('ko-KR');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `
      <div class="log-time">${time}</div>
      <div class="log-content">${this.escapeHtml(message)}</div>
    `;

    this.logViewer.appendChild(logEntry);
    this.logViewer.scrollTop = this.logViewer.scrollHeight;

    // 로그 개수 제한
    const entries = this.logViewer.querySelectorAll('.log-entry');
    if (entries.length > 100) {
      entries[0].remove();
    }
  }

  // 토스트 알림
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // 애니메이션
    setTimeout(() => toast.classList.add('show'), 100);

    // 자동 제거
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 유틸리티 함수들
  generateBattleId() {
    return 'B' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
  }

  generateOtp() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  generateToken() {
    return Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 전역 인스턴스 생성
let adminInterface;

document.addEventListener('DOMContentLoaded', () => {
  adminInterface = new AdminInterface();
});

// 전역 함수들 (onclick 이벤트용)
window.adminInterface = null;
window.addEventListener('load', () => {
  window.adminInterface = adminInterface;
});
