/* ═══════════════════════════════════════════════════════════════════════
   PYXIS Admin JavaScript
   ─────────────────────────────────────────────────────────────────────
   관리자 페이지 핵심 로직 및 UI 제어
   Socket.IO 연동 및 실시간 전투 관리
   ═══════════════════════════════════════════════════════════════════════ */

class PyxisAdmin {
  constructor() {
    this.currentBattleId = null;
    this.adminOtp = null;
    this.spectatorOtp = null;
    this.playerList = [];
    this.battleState = 'waiting';
    this.socket = null;
    this.isConnected = false;

    this.init();
  }

  init() {
    console.log('[PYXIS Admin] Initializing...');
    this.setupEventListeners();
    this.addLog('system', '관리자 시스템이 시작되었습니다.');
    
    // URL 파라미터 확인
    this.checkUrlParameters();
  }

  checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const battleId = urlParams.get('battleId');
    const otp = urlParams.get('otp');
    
    if (battleId && otp) {
      this.currentBattleId = battleId;
      this.adminOtp = otp;
      this.addLog('system', `URL에서 전투 정보를 가져왔습니다: ${battleId}`);
      this.showBattleInfo();
    }
  }

  setupEventListeners() {
    // 전투 생성 폼
    const battleCreateForm = document.getElementById('battleCreateForm');
    if (battleCreateForm) {
      battleCreateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createBattle();
      });
    }

    // 제어 버튼들
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    const startBattleBtn = document.getElementById('startBattleBtn');
    const endBattleBtn = document.getElementById('endBattleBtn');

    if (adminLoginBtn) {
      adminLoginBtn.addEventListener('click', () => this.connectAsAdmin());
    }
    if (startBattleBtn) {
      startBattleBtn.addEventListener('click', () => this.startBattle());
    }
    if (endBattleBtn) {
      endBattleBtn.addEventListener('click', () => this.endBattle());
    }

    // 플레이어 추가 폼
    const playerForm = document.getElementById('playerForm');
    if (playerForm) {
      playerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.addPlayer();
      });
    }

    // 링크 생성 버튼
    const generateLinksBtn = document.getElementById('generateLinksBtn');
    if (generateLinksBtn) {
      generateLinksBtn.addEventListener('click', () => this.generateLinks());
    }

    // 채팅 전송
    const chatSendBtn = document.getElementById('chatSendBtn');
    const chatInput = document.getElementById('chatInput');
    
    if (chatSendBtn) {
      chatSendBtn.addEventListener('click', () => this.sendChat());
    }
    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
      // Ctrl + Enter로 전투 시작
      if (e.ctrlKey && e.key === 'Enter') {
        const startBtn = document.getElementById('startBattleBtn');
        if (startBtn && !startBtn.disabled) {
          this.startBattle();
        }
      }
      
      // Escape으로 전투 종료
      if (e.key === 'Escape') {
        const endBtn = document.getElementById('endBattleBtn');
        if (endBtn && !endBtn.disabled) {
          this.endBattle();
        }
      }
    });
  }

  async createBattle() {
    try {
      const formData = new FormData(document.getElementById('battleCreateForm'));
      const battleMode = formData.get('battleSize');
      
      this.addLog('system', `${battleMode} 전투를 생성하는 중...`);

      // API 호출
      const response = await fetch('/api/admin/battles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode: battleMode })
      });

      if (!response.ok) {
        throw new Error(`API 오류: ${response.status}`);
      }

      const data = await response.json();
      
      this.currentBattleId = data.battleId;
      this.adminOtp = data.adminOtp;
      this.spectatorOtp = data.spectatorOtp;
      
      this.showBattleInfo();
      this.addLog('system', `전투가 생성되었습니다! ID: ${this.currentBattleId}`);
      
    } catch (error) {
      console.error('전투 생성 실패:', error);
      this.addLog('error', '전투 생성에 실패했습니다: ' + error.message);
      
      // 개발 환경에서는 시뮬레이션
      if (window.location.hostname === 'localhost') {
        await this.delay(1000);
        this.currentBattleId = this.generateBattleId();
        this.adminOtp = this.generateOtp();
        this.spectatorOtp = this.generateOtp();
        this.showBattleInfo();
        this.addLog('system', `[개발모드] 전투가 생성되었습니다! ID: ${this.currentBattleId}`);
      }
    }
  }

  showBattleInfo() {
    const battleInfoCard = document.getElementById('battleInfoCard');
    const linksSection = document.getElementById('linksSection');
    const rosterCard = document.getElementById('rosterCard');
    
    // 전투 정보 표시
    document.getElementById('battleIdDisplay').textContent = this.currentBattleId;
    document.getElementById('adminOtpDisplay').textContent = this.adminOtp;
    document.getElementById('spectatorOtpDisplay').textContent = this.spectatorOtp;
    
    // 카드들 보이기
    if (battleInfoCard) battleInfoCard.classList.remove('hidden');
    if (linksSection) linksSection.classList.remove('hidden');
    if (rosterCard) rosterCard.classList.remove('hidden');

    // 버튼 활성화
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    if (adminLoginBtn) {
      adminLoginBtn.disabled = false;
      adminLoginBtn.textContent = '관리자 로그인';
    }
  }

  async connectAsAdmin() {
    if (!this.currentBattleId || !this.adminOtp) {
      this.addLog('error', '먼저 전투를 생성해주세요.');
      return;
    }

    try {
      this.addLog('system', '관리자로 연결하는 중...');
      
      // Socket.IO 연결 시뮬레이션 (실제 구현 시 Socket.IO 사용)
      await this.delay(1500);
      
      this.isConnected = true;
      this.addLog('system', '관리자 연결 완료!');
      
      // 버튼 상태 업데이트
      const adminLoginBtn = document.getElementById('adminLoginBtn');
      const startBattleBtn = document.getElementById('startBattleBtn');
      
      if (adminLoginBtn) {
        adminLoginBtn.textContent = '연결됨';
        adminLoginBtn.disabled = true;
      }
      if (startBattleBtn) {
        startBattleBtn.disabled = false;
      }

    } catch (error) {
      console.error('관리자 연결 실패:', error);
      this.addLog('error', '관리자 연결에 실패했습니다: ' + error.message);
    }
  }

  async addPlayer() {
    if (!this.currentBattleId) {
      this.addLog('error', '먼저 전투를 생성해주세요.');
      return;
    }

    try {
      const formData = new FormData(document.getElementById('playerForm'));
      const playerData = {
        id: this.generatePlayerId(),
        name: formData.get('playerName').trim(),
        team: formData.get('playerTeam'),
        stats: {
          attack: parseInt(formData.get('statAtk')),
          defense: parseInt(formData.get('statDef')),
          agility: parseInt(formData.get('statAgi')),
          luck: parseInt(formData.get('statLck'))
        },
        items: {
          dittany: parseInt(formData.get('itemDittany') || 0),
          attackBoost: parseInt(formData.get('itemAttackBoost') || 0),
          defenseBoost: parseInt(formData.get('itemDefenseBoost') || 0)
        },
        hp: 100,
        maxHp: 100,
        avatar: null
      };

      if (!playerData.name || !playerData.team) {
        this.addLog('error', '플레이어 이름과 팀을 선택해주세요.');
        return;
      }

      // 중복 이름 체크
      if (this.playerList.find(p => p.name === playerData.name)) {
        this.addLog('error', '이미 존재하는 플레이어 이름입니다.');
        return;
      }

      // 팀 정원 체크
      const battleMode = document.querySelector('input[name="battleSize"]:checked')?.value || '2v2';
      const maxPerTeam = parseInt(battleMode.charAt(0));
      const currentTeamSize = this.playerList.filter(p => p.team === playerData.team).length;
      
      if (currentTeamSize >= maxPerTeam) {
        this.addLog('error', `${playerData.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'}이 이미 가득 찼습니다.`);
        return;
      }

      // 아바타 파일 처리
      const avatarFile = formData.get('avatarImage');
      if (avatarFile && avatarFile.size > 0) {
        playerData.avatar = await this.processAvatarFile(avatarFile);
      }

      this.playerList.push(playerData);
      this.updateTeamRoster();
      this.addLog('system', `플레이어 '${playerData.name}'이 ${playerData.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'}에 추가되었습니다.`);
      
      // 폼 리셋
      this.resetPlayerForm();

    } catch (error) {
      console.error('플레이어 추가 실패:', error);
      this.addLog('error', '플레이어 추가에 실패했습니다: ' + error.message);
    }
  }

  async processAvatarFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  resetPlayerForm() {
    document.getElementById('playerForm').reset();
    document.getElementById('statAtk').value = '1';
    document.getElementById('statDef').value = '1';
    document.getElementById('statAgi').value = '1';
    document.getElementById('statLck').value = '1';
    document.getElementById('itemDittany').value = '1';
    document.getElementById('itemAttackBoost').value = '1';
    document.getElementById('itemDefenseBoost').value = '1';
  }

  updateTeamRoster() {
    const phoenixRoster = document.getElementById('phoenixRoster');
    const deathEaterRoster = document.getElementById('deathEaterRoster');
    
    if (!phoenixRoster || !deathEaterRoster) return;

    const phoenixPlayers = this.playerList.filter(p => p.team === 'A');
    const deathEaterPlayers = this.playerList.filter(p => p.team === 'B');

    phoenixRoster.innerHTML = '';
    deathEaterRoster.innerHTML = '';

    phoenixPlayers.forEach(player => {
      phoenixRoster.appendChild(this.createPlayerCard(player));
    });

    deathEaterPlayers.forEach(player => {
      deathEaterRoster.appendChild(this.createPlayerCard(player));
    });
  }

  createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card';
    
    const statsText = `공격:${player.stats.attack} 방어:${player.stats.defense} 민첩:${player.stats.agility} 행운:${player.stats.luck}`;
    const itemsText = `디터니:${player.items.dittany} 공격강화:${player.items.attackBoost} 방어강화:${player.items.defenseBoost}`;
    
    const avatarContent = player.avatar 
      ? `<img src="${player.avatar}" alt="${player.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`
      : player.name.charAt(0);
    
    card.innerHTML = `
      <div class="player-avatar">${avatarContent}</div>
      <div class="player-info">
        <div class="player-name">${player.name}</div>
        <div class="player-stats">
          <div>HP: ${player.hp}/${player.maxHp}</div>
          <div>${statsText}</div>
          <div>${itemsText}</div>
        </div>
      </div>
      <div class="player-actions">
        <button class="btn btn-danger" onclick="admin.removePlayer('${player.id}')" style="padding: 8px 16px; font-size: 12px;">제거</button>
      </div>
    `;
    
    return card;
  }

  removePlayer(playerId) {
    const playerIndex = this.playerList.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      const player = this.playerList[playerIndex];
      this.playerList.splice(playerIndex, 1);
      this.updateTeamRoster();
      this.addLog('system', `플레이어 '${player.name}'이 제거되었습니다.`);
    }
  }

  async generateLinks() {
    if (!this.currentBattleId) {
      this.addLog('error', '먼저 전투를 생성해주세요.');
      return;
    }

    try {
      this.addLog('system', '참여자 링크를 생성하는 중...');
      
      await this.delay(800);
      
      const baseUrl = window.location.origin;
      
      // 기존 링크 제거
      this.clearLinks();
      
      // 각 플레이어별 개별 링크 생성
      this.playerList.forEach(player => {
        const playerToken = this.generateToken();
        const playerUrl = `${baseUrl}/play?battleId=${this.currentBattleId}&playerId=${player.id}&otp=${playerToken}`;
        this.addLink(`${player.name} (${player.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'})`, playerUrl);
      });
      
      // 관전자 링크
      const spectatorUrl = `${baseUrl}/watch?battleId=${this.currentBattleId}&otp=${this.spectatorOtp}`;
      this.addLink('관전자', spectatorUrl);
      
      // 관리자 링크
      const adminUrl = `${baseUrl}/admin?battleId=${this.currentBattleId}&otp=${this.adminOtp}`;
      this.addLink('관리자', adminUrl);
      
      this.addLog('system', `총 ${this.playerList.length + 2}개의 링크가 생성되었습니다.`);
      
    } catch (error) {
      console.error('링크 생성 실패:', error);
      this.addLog('error', '링크 생성에 실패했습니다: ' + error.message);
    }
  }

  clearLinks() {
    const linksList = document.getElementById('linksList');
    if (linksList) {
      linksList.innerHTML = '';
    }
  }

  addLink(label, url) {
    const linksList = document.getElementById('linksList');
    if (!linksList) return;

    const linkItem = document.createElement('div');
    linkItem.className = 'link-item';
    
    const linkId = 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    
    linkItem.innerHTML = `
      <label style="min-width: 140px; font-weight: 600; color: var(--gold-bright);">${label}:</label>
      <input id="${linkId}" class="link-input" readonly value="${url}" />
      <button class="copy-btn" onclick="admin.copyToClipboard('${linkId}', this)">복사</button>
    `;
    
    linksList.appendChild(linkItem);
  }

  async copyToClipboard(inputId, button) {
    try {
      const input = document.getElementById(inputId);
      const text = input.value;
      
      await navigator.clipboard.writeText(text);
      button.textContent = '복사됨!';
      button.classList.add('copied');
      
      setTimeout(() => {
        button.textContent = '복사';
        button.classList.remove('copied');
      }, 2000);
      
    } catch (error) {
      console.error('클립보드 복사 실패:', error);
      // 대체 방법
      const input = document.getElementById(inputId);
      input.select();
      input.setSelectionRange(0, 99999);
      document.execCommand('copy');
      
      button.textContent = '복사됨!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = '복사';
        button.classList.remove('copied');
      }, 2000);
    }
  }

  async startBattle() {
    if (!this.isConnected) {
      this.addLog('error', '먼저 관리자로 로그인해주세요.');
      return;
    }

    if (this.playerList.length < 2) {
      this.addLog('error', '최소 2명의 플레이어가 필요합니다.');
      return;
    }

    const teamA = this.playerList.filter(p => p.team === 'A');
    const teamB = this.playerList.filter(p => p.team === 'B');

    if (teamA.length === 0 || teamB.length === 0) {
      this.addLog('error', '각 팀에 최소 1명의 플레이어가 있어야 합니다.');
      return;
    }

    try {
      this.addLog('system', '전투를 시작하는 중...');
      
      await this.delay(2000);
      
      this.battleState = 'ongoing';
      
      // 선공 계산
      const teamAAgi = teamA.reduce((sum, p) => sum + p.stats.agility, 0);
      const teamBAgi = teamB.reduce((sum, p) => sum + p.stats.agility, 0);
      const firstTeam = teamAAgi >= teamBAgi ? '불사조 기사단' : '죽음을 먹는 자들';
      
      this.addLog('system', `전투가 시작되었습니다!`);
      this.addLog('system', `불사조 기사단 민첩성 합계: ${teamAAgi}, 죽음을 먹는 자들 민첩성 합계: ${teamBAgi}`);
      this.addLog('system', `${firstTeam}이 선공합니다!`);
      
      // 버튼 상태 업데이트
      const startBattleBtn = document.getElementById('startBattleBtn');
      const endBattleBtn = document.getElementById('endBattleBtn');
      
      if (startBattleBtn) {
        startBattleBtn.disabled = true;
        startBattleBtn.textContent = '진행 중';
      }
      if (endBattleBtn) {
        endBattleBtn.disabled = false;
      }

    } catch (error) {
      console.error('전투 시작 실패:', error);
      this.addLog('error', '전투 시작에 실패했습니다: ' + error.message);
    }
  }

  async endBattle() {
    if (!this.isConnected) {
      this.addLog('error', '먼저 관리자로 로그인해주세요.');
      return;
    }

    try {
      this.addLog('system', '전투를 종료하는 중...');
      
      await this.delay(1000);
      
      this.battleState = 'ended';
      this.addLog('system', '관리자에 의해 전투가 종료되었습니다.');
      
      // 버튼 상태 업데이트
      const startBattleBtn = document.getElementById('startBattleBtn');
      const endBattleBtn = document.getElementById('endBattleBtn');
      
      if (startBattleBtn) {
        startBattleBtn.disabled = false;
        startBattleBtn.textContent = '전투 시작';
      }
      if (endBattleBtn) {
        endBattleBtn.disabled = true;
        endBattleBtn.textContent = '종료됨';
      }

    } catch (error) {
      console.error('전투 종료 실패:', error);
      this.addLog('error', '전투 종료에 실패했습니다: ' + error.message);
    }
  }

  sendChat() {
    const chatInput = document.getElementById('chatInput');
    const chatChannel = document.getElementById('chatChannel');
    
    if (!chatInput || !chatChannel) return;
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    const channel = chatChannel.value;
    
    // 채팅 메시지 표시
    this.addChatMessage('관리자', message, channel);
    
    // 입력 필드 초기화
    chatInput.value = '';
  }

  addChatMessage(sender, message, channel = 'all') {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const messageElement = document.createElement('div');
    messageElement.className = 'log-entry';
    messageElement.innerHTML = `
      <strong>[${channel.toUpperCase()}] ${sender}:</strong> ${this.escapeHtml(message)}
      <span style="font-size: 11px; color: var(--text-muted); margin-left: 8px;">${new Date().toLocaleTimeString()}</span>
    `;

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  addLog(type, message, data = {}) {
    const battleLog = document.getElementById('battleLog');
    if (!battleLog) return;

    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `
      ${this.escapeHtml(message)}
      <span style="font-size: 11px; color: var(--text-muted); margin-left: 8px;">${new Date().toLocaleTimeString()}</span>
    `;

    battleLog.appendChild(logEntry);
    battleLog.scrollTop = battleLog.scrollHeight;

    console.log(`[${type.toUpperCase()}] ${message}`, data);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 유틸리티 함수들
  generateBattleId() {
    return 'B' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  generateOtp() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  generateToken() {
    return Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  }

  generatePlayerId() {
    return 'P' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 전역 초기화 및 이벤트 바인딩
// ═══════════════════════════════════════════════════════════════════════

// 전역 admin 인스턴스 생성
const admin = new PyxisAdmin();

// 페이지 로드 완료 후 추가 초기화
document.addEventListener('DOMContentLoaded', () => {
  console.log('[PYXIS] Admin page loaded successfully');
});

// 연결 상태 모니터링
setInterval(() => {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');
  
  if (admin.isConnected) {
    if (statusDot) statusDot.style.background = '#22C55E';
    if (statusText) statusText.textContent = '관리자 연결됨';
  } else if (admin.currentBattleId) {
    if (statusDot) statusDot.style.background = '#F39C12';
    if (statusText) statusText.textContent = '전투 생성됨';
  } else {
    if (statusDot) statusDot.style.background = '#3498DB';
    if (statusText) statusText.textContent = '시스템 준비됨';
  }
}, 1000);

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  if (admin.socket && admin.socket.connected) {
    admin.socket.disconnect();
  }
});

// 개발자 도구 (개발 환경에서만)
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.PYXIS = {
    admin: admin,
    generateTestPlayers: () => {
      const testPlayers = [
        { name: '해리 포터', team: 'A', stats: { attack: 7, defense: 5, agility: 8, luck: 9 } },
        { name: '헤르미온느', team: 'A', stats: { attack: 6, defense: 7, agility: 6, luck: 8 } },
        { name: '볼드모트', team: 'B', stats: { attack: 10, defense: 6, agility: 7, luck: 5 } },
        { name: '벨라트릭스', team: 'B', stats: { attack: 8, defense: 5, agility: 9, luck: 6 } }
      ];
      
      testPlayers.forEach(player => {
        document.getElementById('playerName').value = player.name;
        document.getElementById('playerTeam').value = player.team;
        document.getElementById('statAtk').value = player.stats.attack;
        document.getElementById('statDef').value = player.stats.defense;
        document.getElementById('statAgi').value = player.stats.agility;
        document.getElementById('statLck').value = player.stats.luck;
        
        admin.addPlayer();
      });
      
      console.log('테스트 플레이어 4명이 추가되었습니다.');
    }
  };
  console.log('개발자 모드: window.PYXIS 객체를 사용할 수 있습니다.');
  console.log('- PYXIS.generateTestPlayers() : 테스트 플레이어 자동 생성');
}
