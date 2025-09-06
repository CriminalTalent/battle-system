// public/assets/js/pages/admin.js
// Enhanced PYXIS Admin Interface - 강화된 Socket.IO 연결 및 브로드캐스트 시스템
// - 연결 안정성/재연결, 브로드캐스트 처리, 실시간 동기화, 에러 복구
// - 초기 HP는 100으로 등록하되, 입력된 목표 HP는 전투 시작 직후 보정 적용

class EnhancedAdminInterface {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.currentBattleId = null;
    this.currentAdminOtp = null;
    this.playerList = [];

    this.connectionState = 'disconnected';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.connectionTimeout = null;

    this.messageQueue = [];
    this.isProcessingQueue = false;

    this.lastSyncTime = 0;
    this.syncInterval = null;

    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      reconnects: 0,
      startTime: Date.now()
    };

    // 목표 HP 관리
    this.desiredHpMap = new Map();

    this.init();
  }

  /* ========================== 초기화 ========================== */
  init() {
    this.initElements();
    this.setupEventListeners();
    this.setupStatInputs();
    this.startMetricsCollection();
    this.addLog('system', '강화된 관리자 시스템이 준비되었습니다');
    document.getElementById('settingsCard')?.remove();
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  initElements() {
    this.battleCreateForm = document.getElementById('battleCreateForm');
    this.battleMode = document.getElementById('battleMode');
    this.battleInfo = document.getElementById('battleInfo');
    this.battleIdDisplay = document.getElementById('battleIdDisplay');
    this.adminOtpDisplay = document.getElementById('adminOtpDisplay');
    this.createTimeDisplay = document.getElementById('createTimeDisplay');

    this.btnConnect = document.getElementById('btnConnect');
    this.btnStartBattle = document.getElementById('btnStartBattle');
    this.btnPauseBattle = document.getElementById('btnPauseBattle');
    this.btnEndBattle = document.getElementById('btnEndBattle');
    this.connectionStatusIcon = document.getElementById('connectionStatus');

    this.playerForm = document.getElementById('playerForm');
    this.btnAddPlayer = document.getElementById('btnAddPlayer');
    this.statAttack = document.getElementById('statAttack');
    this.statDefense = document.getElementById('statDefense');
    this.statAgility = document.getElementById('statAgility');
    this.statLuck = document.getElementById('statLuck');
    this.playerHp = document.getElementById('playerHp');
    this.playerAvatar = document.getElementById('playerAvatar');

    this.linksSection = document.getElementById('linksSection');
    this.btnGeneratePlayerOTP = document.getElementById('btnGeneratePlayerOTP');
    this.btnGenerateSpectatorOTP = document.getElementById('btnGenerateSpectatorOTP');
    this.otpDisplay = document.getElementById('otpDisplay');
    this.playerOtpList = document.getElementById('playerOtpList');
    this.spectatorOtpDisplay = document.getElementById('spectatorOtpDisplay');

    this.rosterCard = document.getElementById('rosterCard');
    this.team1Roster = document.getElementById('team1Roster');
    this.team2Roster = document.getElementById('team2Roster');
    this.teamACount = document.getElementById('teamACount');
    this.teamBCount = document.getElementById('teamBCount');

    this.logViewer = document.getElementById('logViewer');
    this.chatInput = document.getElementById('chatInput');
    this.btnSendChat = document.getElementById('btnSendChat');
    this.chatChannel = document.getElementById('chatChannel');

    this.createConnectionStatusDisplay();
  }

  setupEventListeners() {
    this.battleCreateForm?.addEventListener('submit', (e) => {
      e.preventDefault(); this.createBattle();
    });
    this.btnConnect?.addEventListener('click', () => this.connectAsAdmin());
    this.btnStartBattle?.addEventListener('click', () => this.startBattle());
    this.btnPauseBattle?.addEventListener('click', () => this.pauseBattle());
    this.btnEndBattle?.addEventListener('click', () => this.endBattle());
    this.btnAddPlayer?.addEventListener('click', () => this.addPlayer());
    this.btnGeneratePlayerOTP?.addEventListener('click', () => this.generatePlayerOTPs());
    this.btnGenerateSpectatorOTP?.addEventListener('click', () => this.generateSpectatorOTP());
    this.btnSendChat?.addEventListener('click', () => this.sendChat());
    this.chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); this.sendChat();
      }
    });
  }

  /* ======================= 플레이어 추가 ======================= */
  async addPlayer() {
    if (!this.currentBattleId) {
      this.showToast('먼저 전투를 생성하세요', 'error'); return;
    }
    const playerData = this.collectPlayerData();
    if (!playerData) return;

    try {
      this.addLog('system', '플레이어 등록 중...');
      const response = await this._fetchJson(
        `/api/battles/${encodeURIComponent(this.currentBattleId)}/players`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(playerData) }
      );
      const player = response.player || response;
      if (!player || !(player.id || player.name)) throw new Error('플레이어 응답 오류');
      await this.uploadPlayerAvatar(player);
      this.handlePlayerAddSuccess(player, playerData);
    } catch (error) {
      this.addLog('error', `플레이어 등록 실패: ${error.message}`);
      this.showToast('플레이어 등록 실패', 'error');
    }
  }

  collectPlayerData() {
    const name = document.getElementById('playerName')?.value?.trim();
    const teamSel = document.getElementById('playerTeam')?.value;
    const desiredHp = Number(this.playerHp?.value || 100);

    if (!name || !teamSel) {
      this.showToast('이름과 팀을 선택하세요', 'error'); return null;
    }

    const stats = {
      attack: Number(this.statAttack?.value || 3),
      defense: Number(this.statDefense?.value || 3),
      agility: Number(this.statAgility?.value || 3),
      luck: Number(this.statLuck?.value || 3)
    };

    const invalidStats = Object.values(stats).some(v => !Number.isFinite(v) || v < 1 || v > 5);
    if (invalidStats) {
      this.showToast('각 스탯은 1~5 범위여야 합니다', 'error'); return null;
    }

    // 등록 시 HP는 항상 100
    const hp = 100;
    const team = (teamSel === 'A' ? '불사조 기사단' : '죽음을 먹는 자들');
    const items = {
      dittany: Number(document.getElementById('itemDittany')?.value || 0) || 0,
      attackBoost: Number(document.getElementById('itemAttackBoost')?.value || 0) || 0,
      defenseBoost: Number(document.getElementById('itemDefenseBoost')?.value || 0) || 0
    };

    // 목표 HP 저장
    this.desiredHpMap.set(name, desiredHp);
    return { name, team, stats, items, hp };
  }

  handlePlayerAddSuccess(player, playerData) {
    this.addLog('system', `플레이어 "${player.name}" 등록 완료 (HP목표:${this.desiredHpMap.get(player.name)})`);
    this.playerList = this.uniqueById([...this.playerList, player]);
    this.updateTeamRoster();
    this.resetPlayerForm();
    this.showToast(`${player.name} 등록 완료`, 'success');
  }

  /* ======================= 전투 시작 시 HP 보정 ======================= */
  startBattle() {
    if (!this.isAuthenticated) {
      this.showToast('먼저 관리자로 연결하세요', 'error'); return;
    }
    const startData = { battleId: this.currentBattleId, timestamp: Date.now() };
    this.sendSocketMessage('battle:start', startData, (response) => {
      if (response?.success) {
        this.addLog('system', '전투 시작 명령 전송');
        this.showToast('전투 시작', 'success');
        this.applyDesiredHpAdjustments();
      } else {
        this.addLog('error', `전투 시작 실패: ${response?.error}`); this.showToast('전투 시작 실패', 'error');
      }
    });
  }

  async applyDesiredHpAdjustments() {
    for (const player of this.playerList) {
      const desiredHp = this.desiredHpMap.get(player.name);
      if (!desiredHp) continue;
      const diff = desiredHp - 100;
      if (diff === 0) continue;
      const action = diff > 0 ? 'heal_partial' : 'damage';
      const value = Math.abs(diff);
      await this.executeBatchCommand(action, [player.id], { value });
      this.addLog('system', `플레이어 "${player.name}" HP 보정: ${desiredHp}`);
    }
  }

  /* ======================= 렌더링 ======================= */
  createPlayerCard(player) {
    const stats = player.stats ?
      `공:${player.stats.attack} 방:${player.stats.defense} 민:${player.stats.agility} 행:${player.stats.luck}` : '';
    const hp = Number.isFinite(player.hp) ? player.hp : 100;
    const maxHp = Number.isFinite(player.maxHp) ? player.maxHp : hp;
    const hpPercent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 100;

    return `
      <div class="player-card" data-player-id="${player.id || ''}">
        <div class="player-avatar">${player.avatar ? `<img src="${player.avatar}" alt="${player.name}">` : '아바타'}</div>
        <div class="player-info">
          <div class="player-name">${this.escapeHtml(player.name || '')}</div>
          <div class="player-team">${this.escapeHtml(player.team || '')}</div>
          <div class="player-stats">${this.escapeHtml(stats)}</div>
          <div class="player-hp">
            <div class="hp-bar"><div class="hp-fill" style="width: ${hpPercent}%"></div></div>
            <span class="hp-text">HP: ${hp}/${maxHp}</span>
          </div>
        </div>
      </div>`;
  }

  /* ======================= 유틸 함수 ======================= */
  uniqueById(array) {
    const seen = new Map();
    (array || []).forEach(item => {
      const key = (item && (item.id || item.playerId || item.name)) || Math.random().toString(36).slice(2);
      if (!seen.has(key)) seen.set(key, item);
    });
    return Array.from(seen.values());
  }
  escapeHtml(unsafe) {
    const div = document.createElement('div'); div.textContent = String(unsafe ?? ''); return div.innerHTML;
  }
  async _fetchJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text(); let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
    return data;
  }

  /* (나머지: 소켓 연결, 채팅, OTP 등 기존 구현 동일) */
}

// 전역 인스턴스
let adminInterface;
document.addEventListener('DOMContentLoaded', () => { adminInterface = new EnhancedAdminInterface(); });
window.addEventListener('load', () => { window.adminInterface = adminInterface; });
