/* ═══════════════════════════════════════════════════════════════════════
   PYXIS Admin JavaScript
   ─────────────────────────────────────────────────────────────────────
   관리자 페이지 핵심 로직 및 UI 제어
   Socket.IO 연동 및 실시간 전투 관리
   변경사항:
   - 키보드 단축키 제거(Ctrl+Enter, Esc)
   - 플레이어 스탯 0~5로 클램프
   - 링크 쿼리키 통일: play/spectator/admin 모두 battle, player, otp/token 사용
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
    this.checkUrlParameters();
  }

  checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const battleId = urlParams.get('battle') || urlParams.get('battleId');
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

    if (adminLoginBtn) adminLoginBtn.addEventListener('click', () => this.connectAsAdmin());
    if (startBattleBtn) startBattleBtn.addEventListener('click', () => this.startBattle());
    if (endBattleBtn) endBattleBtn.addEventListener('click', () => this.endBattle());

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
    if (chatSendBtn) chatSendBtn.addEventListener('click', () => this.sendChat());
    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }

    // (요청에 따라) 키보드 단축키 제거됨
  }

  async createBattle() {
    try {
      const formData = new FormData(document.getElementById('battleCreateForm'));
      const battleMode = formData.get('battleSize'); // '1v1' | '2v2' | '3v3' | '4v4'

      this.addLog('system', `${battleMode} 전투를 생성하는 중...`);

      const response = await fetch('/api/admin/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: battleMode })
      });

      if (!response.ok) throw new Error(`API 오류: ${response.status}`);
      const data = await response.json();

      this.currentBattleId = data.battleId;
      this.adminOtp = data.adminOtp;
      this.spectatorOtp = data.spectatorOtp;

      this.showBattleInfo();
      this.addLog('system', `전투가 생성되었습니다! ID: ${this.currentBattleId}`);

    } catch (error) {
      console.error('전투 생성 실패:', error);
      this.addLog('error', '전투 생성에 실패했습니다: ' + error.message);

      // 개발 모드 시뮬레이션
      if (window.location.hostname === 'localhost') {
        await this.delay(800);
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

    if (battleInfoCard) battleInfoCard.classList.remove('hidden');
    if (linksSection) linksSection.classList.remove('hidden');
    if (rosterCard) rosterCard.classList.remove('hidden');

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
      // (실서버라면 소켓 인증 로직으로 교체)
      await this.delay(800);

      this.isConnected = true;
      this.addLog('system', '관리자 연결 완료!');

      const adminLoginBtn = document.getElementById('adminLoginBtn');
      const startBattleBtn = document.getElementById('startBattleBtn');
      if (adminLoginBtn) { adminLoginBtn.textContent = '연결됨'; adminLoginBtn.disabled = true; }
      if (startBattleBtn) startBattleBtn.disabled = false;

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
      const form = document.getElementById('playerForm');
      const formData = new FormData(form);

      // 스탯 0~5로 클램프
      const clamp5 = (v) => Math.max(0, Math.min(5, parseInt(v ?? 0)));

      const playerData = {
        id: this.generatePlayerId(),
        name: String(formData.get('playerName') || '').trim(),
        team: formData.get('playerTeam'), // 'A' | 'B'
        stats: {
          attack:  clamp5(formData.get('statAtk')),
          defense: clamp5(formData.get('statDef')),
          agility: clamp5(formData.get('statAgi')),
          luck:    clamp5(formData.get('statLck')),
        },
        items: {
          dittany:     clamp5(formData.get('itemDittany') || 0),      // 개수도 0~5 제한
          attackBoost: clamp5(formData.get('itemAttackBoost') || 0),
          defenseBoost:clamp5(formData.get('itemDefenseBoost') || 0),
        },
        hp: 100,
        maxHp: 100,
        avatar: null,
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

      // 팀 정원 체크 (라디오 값 '1v1'..)
      const battleMode = document.querySelector('input[name="battleSize"]:checked')?.value || '2v2';
      const maxPerTeam = parseInt(battleMode.charAt(0), 10);
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
    const f = document.getElementById('playerForm');
    f.reset();
    // 기본값 1로 리셋(0~5 범위 내)
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

    phoenixPlayers.forEach(player => phoenixRoster.appendChild(this.createPlayerCard(player)));
    deathEaterPlayers.forEach(player => deathEaterRoster.appendChild(this.createPlayerCard(player)));
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
    const idx = this.playerList.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      const player = this.playerList[idx];
      this.playerList.splice(idx, 1);
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
      await this.delay(400);

      const baseUrl = window.location.origin;

      this.clearLinks();
     // 각 플레이어별 링크
      this.playerList.forEach(player => {
        const playerToken = this.generateToken();
        const playerUrl = `${baseUrl}/play?battle=${this.currentBattleId}&player=${player.id}&otp=${playerToken}`;
        this.addLink(`${player.name} (${player.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'})`, playerUrl);
      });

      // 관전자 / 관리자
      const spectatorUrl = `${baseUrl}/spectator?battle=${this.currentBattleId}&token=${this.spectatorOtp}`;
      const adminUrl     = `${baseUrl}/admin?battle=${this.currentBattleId}&otp=${this.adminOtp}`;
      this.addLink('관전자', spectatorUrl);
      this.addLink('관리자', adminUrl);

      this.addLog('system', `총 ${this.playerList.length + 2}개의 링크가 생성되었습니다.`);

    } catch (error) {
      console.error('링크 생성 실패:', error);
      this.addLog('error', '링크 생성에 실패했습니다: ' + error.message);
    }
  }

  clearLinks() {
    const linksList = document.getElementById('linksList');
    if (linksList) linksList.innerHTML = '';
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

      setTimeout(() => { button.textContent = '복사'; button.classList.remove('copied'); }, 2000);

    } catch (error) {
      console.error('클립보드 복사 실패:', error);
      const input = document.getElementById(inputId);
      input.select();
      input.setSelectionRange(0, 99999);
      document.execCommand('copy');

      button.textContent = '복사됨!';
      button.classList.add('copied');
      setTimeout(() => { button.textContent = '복사'; button.classList.remove('copied'); }, 2000);
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
      await this.delay(1200);

      this.battleState = 'ongoing';

      // 선공: 민첩 합 비교
      const teamAAgi = teamA.reduce((sum, p) => sum + (p.stats.agility || 0), 0);
      const teamBAgi = teamB.reduce((sum, p) => sum + (p.stats.agility || 0), 0);
      const firstTeam = teamAAgi >= teamBAgi ? '불사조 기사단' : '죽음을 먹는 자들';

      this.addLog('system', `전투가 시작되었습니다!`);
      this.addLog('system', `불사조 기사단 민첩성 합계: ${teamAAgi}, 죽음을 먹는 자들 민첩성 합계: ${teamBAgi}`);
      this.addLog
