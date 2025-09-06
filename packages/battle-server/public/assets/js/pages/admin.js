// public/assets/js/pages/admin.js
// Enhanced PYXIS Admin Interface - 강화된 Socket.IO 연결 및 브로드캐스트 시스템
// - 연결 안정성/재연결, 브로드캐스트 처리, 실시간 동기화, 에러 복구
// - 초기 HP는 100으로 등록하되, 입력된 목표 HP는 전투 시작 직후 보정 적용
// - 이 파일은 단독으로 동작하며, 기존 HTML의 ID 유무에 따라 안전하게 기능을 비활성화/대체합니다.

class EnhancedAdminInterface {
  constructor() {
    /** Socket / Connection */
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;

    /** Battle & Admin */
    const url = new URL(location.href);
    this.currentBattleId = url.searchParams.get('battle') || '';
    this.currentAdminOtp = url.searchParams.get('token') || ''; // 서버에서 token 사용 시
    this.playerList = [];

    /** Connection & Heartbeat */
    this.connectionState = 'disconnected';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // ms (exponential backoff 시작 값)
    this.heartbeatInterval = null;
    this.heartbeatEvery = 15000; // ms
    this.lastPongAt = 0;
    this.connectionTimeout = null;
    this.connectionTimeoutMs = 12000;

    /** Message Queue */
    this.messageQueue = [];
    this.isProcessingQueue = false;

    /** Sync */
    this.lastSyncTime = 0;
    this.syncInterval = null;
    this.syncEvery = 5000; // ms

    /** Metrics */
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      reconnects: 0,
      startTime: Date.now()
    };

    /** 목표 HP 관리 (등록시 100, 시작 직후 보정) */
    this.desiredHpMap = new Map();

    /** Bootstrap */
    this.init();
  }

  /* ========================== 초기화 ========================== */
  init() {
    this.initElements();
    this.setupEventListeners();
    this.setupStatInputs();
    this.startMetricsCollection();
    this.addLog('system', '강화된 관리자 시스템이 준비되었습니다');

    // 페이지 떠나기 전 정리
    window.addEventListener('beforeunload', () => this.cleanup());

    // 소켓 자동 연결
    this.connectSocket();

    // URL에 battle이 있으면 표시
    if (this.el.battleId) this.el.battleId.value = this.currentBattleId || '';
  }

  initElements() {
    const $ = (sel, ctx = document) => ctx.querySelector(sel);

    // 좌측 컨트롤
    this.el = {
      battleMode: $('#battleMode'),
      battleId: $('#battleId'),
      btnCreateBattle: $('#createBattleBtn'),
      btnStartBattle: $('#startBattleBtn'),
      btnEndBattle: $('#endBattleBtn'),
      btnRestartBattle: $('#restartBattleBtn'),

      // 연결 상태 표시 (점/텍스트/필)
      connDot: $('#connDot'),
      connText: $('#connText'),
      battleStatePill: $('#battleStatePill'),

      // 링크 생성
      btnGenerateLinks: $('#generateLinksBtn'),
      adminLink: $('#adminLink'),
      playerLink: $('#playerLink'),
      spectatorLink: $('#spectatorLink'),

      // 플레이어 추가
      playerName: $('#playerName'),
      playerTeam: $('#playerTeam'),
      statAtk: $('#statAtk'),
      statDef: $('#statDef'),
      statAgi: $('#statAgi'),
      statLuk: $('#statLuk'),
      playerHp: $('#playerHp'), // 목표 HP 입력용
      itemSelect: $('#itemSelect'),
      btnAddPlayer: $('#addPlayerBtn'),

      // 로스터
      teamPhoenix: $('#teamPhoenix'),
      teamEaters: $('#teamDeathEaters'),

      // 로그 / 채팅
      battleLog: $('#battleLog'),
      chatMessages: $('#chatMessages'),
      chatInput: $('#chatInput'),
      chatSendBtn: $('#chatSendBtn'),

      // 토스트
      toast: $('#toast')
    };

    // 선택적 요소(다른 레이아웃 대응)
    this.optional = {
      // 예: 다른 페이지에서만 존재할 수 있는 버튼들
      btnConnect: $('#btnConnect'),
      btnPauseBattle: $('#btnPauseBattle'),
      // 카운트가 있을 수도 있음
      teamACount: $('#teamACount'),
      teamBCount: $('#teamBCount')
    };
  }

  setupEventListeners() {
    // 전투 생성
    this.el.btnCreateBattle?.addEventListener('click', () => this.createBattle());

    // 전투 시작/종료/재시작
    this.el.btnStartBattle?.addEventListener('click', () => this.startBattle());
    this.el.btnEndBattle?.addEventListener('click', () => this.endBattle());
    this.el.btnRestartBattle?.addEventListener('click', () => this.restartBattle());

    // 링크 생성
    this.el.btnGenerateLinks?.addEventListener('click', () => this.generateLinks());

    // 플레이어 추가
    this.el.btnAddPlayer?.addEventListener('click', () => this.addPlayer());

    // 채팅
    this.el.chatSendBtn?.addEventListener('click', () => this.sendChat());
    this.el.chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChat();
      }
    });

    // 선택적: 수동 연결 버튼(있는 경우만)
    this.optional.btnConnect?.addEventListener('click', () => this.connectSocket());
    this.optional.btnPauseBattle?.addEventListener('click', () => this.pauseBattle());

    // 폼 엔터 방지(채팅은 허용)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const t = e.target;
        if (t && t === this.el.chatInput) return;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes((t?.tagName) || '')) {
          e.preventDefault();
        }
      }
    });
  }

  setupStatInputs() {
    // 숫자 범위 안전 클램프
    const clamp = (v, min, max) => {
      v = Number(v);
      if (Number.isNaN(v)) return min;
      return Math.max(min, Math.min(max, v));
    };
    const bindClamp = (el, min, max) => {
      if (!el) return;
      el.addEventListener('change', () => { el.value = clamp(el.value, min, max); });
      el.addEventListener('blur', () => { el.value = clamp(el.value, min, max); });
    };

    bindClamp(this.el.statAtk, 1, 5);
    bindClamp(this.el.statDef, 1, 5);
    bindClamp(this.el.statAgi, 1, 5);
    bindClamp(this.el.statLuk, 1, 5);
    bindClamp(this.el.playerHp, 1, 1000);
  }

  startMetricsCollection() {
    // 콘솔로만 출력(필요 시 UI에 바인딩)
    this._metricsTimer = setInterval(() => {
      const uptime = ((Date.now() - this.metrics.startTime) / 1000).toFixed(0);
      // 개발 콘솔용
      // console.debug('[metrics] uptime(s):', uptime, JSON.stringify(this.metrics));
    }, 15000);
  }

  /* ======================= 서버 REST 유틸 ======================= */
  async fetchJSON(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('Invalid JSON from ' + url); }
    if (!res.ok) throw new Error(data?.error || ('HTTP ' + res.status));
    return data;
  }

  /* ======================= 소켓 연결 ======================= */
  connectSocket() {
    if (this.socket?.connected) return;

    try {
      // eslint-disable-next-line no-undef
      this.socket = io({ transports: ['websocket', 'polling'] });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.setConn(true, '연결 완료');
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.processQueue();
        this.startHeartbeat();
        this.startSync();

        // 관리자 인증 요청(토큰/battleId가 있을 때)
        if (this.currentBattleId && this.currentAdminOtp) {
          this.socket.emit('adminAuth', { battleId: this.currentBattleId, token: this.currentAdminOtp });
        }
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.setConn(false, '연결 끊김');
        this.connectionState = 'disconnected';
        this.stopHeartbeat();
        this.stopSync();
        this.tryReconnect();
      });

      // 인증 성공/실패
      this.socket.on('authSuccess', (payload) => {
        this.isAuthenticated = true;
        this.addLog('system', '관리자 인증 성공');
        if (payload?.battle) {
          this.currentBattleId = payload.battle?.id || this.currentBattleId;
          if (this.el.battleId) this.el.battleId.value = this.currentBattleId || '';
          this.updateBattleStateByStatus(payload.battle?.status || payload.battle?.state);
          this.renderRoster(payload.battle);
        }
      });

      this.socket.on('authError', (err) => {
        this.isAuthenticated = false;
        this.addLog('error', '관리자 인증 실패');
        this.showToast('관리자 인증 실패', 'error');
      });

      // 상태 브로드캐스트
      this.socket.on('battleUpdate', (state) => {
        this.metrics.messagesReceived++;
        try {
          if (state?.id) this.currentBattleId = state.id;
          if (this.el.battleId) this.el.battleId.value = this.currentBattleId || '';
          this.updateBattleStateByStatus(state?.status || state?.state);
          this.renderRoster(state);
          if (Array.isArray(state?.log)) {
            const last = state.log.slice(-5);
            last.forEach((l) => this.addLog(l.type || 'event', l.message || ''));
          }
        } catch (e) {
          this.addLog('error', '상태 렌더링 오류');
        }
      });

      // 일반 채팅 브로드캐스트
      this.socket.on('chatMessage', (msg) => {
        this.metrics.messagesReceived++;
        const sender = msg?.sender || msg?.role || '채널';
        const text = msg?.message || '';
        this.appendChat(sender, text);
      });

      // Heartbeat pong
      this.socket.on('admin:pong', (data) => {
        this.lastPongAt = Date.now();
      });
    } catch (e) {
      this.metrics.errors++;
      this.addLog('error', '소켓 초기화 실패: ' + e.message);
    }
  }

  tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.addLog('error', '재연결 중단(최대 시도 초과)');
      return;
    }
    this.reconnectAttempts++;
    this.metrics.reconnects++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 15000);
    setTimeout(() => {
      this.addLog('system', `재연결 시도 ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      this.connectSocket();
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatInterval = setInterval(() => {
      if (!this.socket?.connected) return;
      this.socket.emit('admin:ping', { t: Date.now() });
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = setTimeout(() => {
        const since = Date.now() - this.lastPongAt;
        if (since > this.connectionTimeoutMs) {
          // ping 타임아웃으로 판단
          this.socket.disconnect();
        }
      }, this.connectionTimeoutMs + 100);
    }, this.heartbeatEvery);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
    if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
    this.connectionTimeout = null;
  }

  startSync() {
    this.stopSync();
    this.syncInterval = setInterval(() => {
      if (!this.socket?.connected || !this.currentBattleId) return;
      // 서버가 소켓 상태 요청을 지원하는 경우
      this.socket.emit('admin:requestState', { battleId: this.currentBattleId });
      this.lastSyncTime = Date.now();
    }, this.syncEvery);
  }

  stopSync() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = null;
  }

  setConn(ok, msg) {
    if (this.el.connDot) {
      this.el.connDot.classList.remove('ok', 'bad');
      this.el.connDot.classList.add(ok ? 'ok' : 'bad');
    }
    if (this.el.connText) {
      this.el.connText.textContent = msg || (ok ? '연결 완료' : '연결 끊김');
    }
  }

  /* ======================= 메시지 큐 ======================= */
  sendSocketMessage(event, payload = {}, ack) {
    const job = { event, payload, ack };
    if (!this.socket?.connected) {
      this.messageQueue.push(job);
      return;
    }
    try {
      this.metrics.messagesSent++;
      if (typeof ack === 'function') this.socket.emit(event, payload, ack);
      else this.socket.emit(event, payload);
    } catch (e) {
      this.metrics.errors++;
      this.addLog('error', `메시지 전송 실패(${event}): ` + e.message);
    }
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    try {
      while (this.socket?.connected && this.messageQueue.length > 0) {
        const job = this.messageQueue.shift();
        this.sendSocketMessage(job.event, job.payload, job.ack);
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /* ======================= 배틀 컨트롤 ======================= */
  async createBattle() {
    try {
      const mode = this.el.battleMode?.value || '2v2';
      const r = await this.fetchJSON('/api/battles', {
        method: 'POST',
        body: JSON.stringify({ mode })
      });
      const id = r?.id || r?.battleId;
      if (!id) throw new Error('생성 결과에 ID 없음');
      this.currentBattleId = id;
      if (this.el.battleId) this.el.battleId.value = id;

      // URL 업데이트
      const q = new URLSearchParams(location.search);
      q.set('battle', id);
      history.replaceState(null, '', location.pathname + '?' + q.toString());

      this.addLog('system', `전투 생성: ${id}`);
      this.showToast('전투 생성 완료', 'success');
    } catch (e) {
      this.addLog('error', '전투 생성 실패: ' + e.message);
      this.showToast('전투 생성 실패', 'error');
    }
  }

  startBattle() {
    if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');

    // 소켓 Ack 기반 명령 우선 사용, 실패 시 REST로 폴백
    const payload = { battleId: this.currentBattleId, timestamp: Date.now() };
    let acked = false;

    const ack = (res) => {
      acked = true;
      if (res?.success) {
        this.addLog('system', '전투 시작 명령 전송');
        this.updateBattleState('live');
        this.showToast('전투 시작', 'success');
        this.applyDesiredHpAdjustments();
      } else {
        this.addLog('error', `전투 시작 실패: ${res?.error || '알 수 없는 오류'}`);
        this.showToast('전투 시작 실패', 'error');
      }
    };

    this.sendSocketMessage('battle:start', payload, ack);

    // 600ms 내 응답 없으면 REST로 폴백
    setTimeout(async () => {
      if (acked) return;
      try {
        await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/start`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        this.addLog('system', '전투 시작 명령(REST) 전송');
        this.updateBattleState('live');
        this.showToast('전투 시작', 'success');
        this.applyDesiredHpAdjustments();
      } catch (e) {
        this.addLog('error', '전투 시작 실패(REST): ' + e.message);
        this.showToast('전투 시작 실패', 'error');
      }
    }, 600);
  }

  async pauseBattle() {
    if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
    try {
      await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/pause`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      this.updateBattleState('wait');
      this.addLog('system', '전투 일시정지');
      this.showToast('일시정지', 'success');
    } catch (e) {
      this.addLog('error', '일시정지 실패: ' + e.message);
      this.showToast('일시정지 실패', 'error');
    }
  }

  async endBattle() {
    if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
    try {
      await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/end`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      this.updateBattleState('end');
      this.addLog('system', '전투 종료 명령 전송');
      this.showToast('전투 종료', 'success');
    } catch (e) {
      this.addLog('error', '전투 종료 실패: ' + e.message);
      this.showToast('전투 종료 실패', 'error');
    }
  }

  async restartBattle() {
    if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
    try {
      await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/start`, {
        method: 'POST',
        body: JSON.stringify({ restart: true })
      });
      this.updateBattleState('live');
      this.addLog('system', '전투 재시작 명령 전송');
      this.showToast('전투 재시작', 'success');
    } catch (e) {
      this.addLog('error', '전투 재시작 실패: ' + e.message);
      this.showToast('전투 재시작 실패', 'error');
    }
  }

  /* ======================= 전투 시작 후 HP 보정 ======================= */
  async applyDesiredHpAdjustments() {
    // 등록 시 HP 100 기준, 목표 HP(desiredHpMap)에 맞춰 보정
    for (const player of this.playerList) {
      const desiredHp = this.desiredHpMap.get(player.name);
      if (!Number.isFinite(desiredHp)) continue;
      const diff = desiredHp - 100;
      if (diff === 0) continue;

      const action = diff > 0 ? 'heal_partial' : 'damage';
      const value = Math.abs(diff);

      try {
        await this.executeBatchCommand(action, [player.id], { value });
        this.addLog('system', `플레이어 "${player.name}" HP 보정: ${desiredHp}`);
      } catch (e) {
        this.addLog('error', `HP 보정 실패(${player.name}): ${e.message}`);
      }
    }
  }

  async executeBatchCommand(action, playerIds = [], extra = {}) {
    if (!this.currentBattleId) throw new Error('전투 ID 없음');
    // REST 우선
    try {
      await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/command`, {
        method: 'POST',
        body: JSON.stringify({ action, playerIds, ...extra })
      });
      return;
    } catch (e) {
      // 소켓 폴백
      await new Promise((resolve, reject) => {
        const payload = { battleId: this.currentBattleId, action, playerIds, ...extra };
        this.sendSocketMessage('admin:command', payload, (res) => {
          if (res?.success) resolve();
          else reject(new Error(res?.error || 'command failed'));
        });
      });
    }
  }

  /* ======================= 플레이어 추가 ======================= */
  collectPlayerData() {
    const name = (this.el.playerName?.value || '').trim();
    const teamSel = this.el.playerTeam?.value || '';
    const desiredHp = Number(this.el.playerHp?.value || 100);

    if (!name || !teamSel) {
      this.showToast('이름과 팀을 선택하세요', 'error');
      return null;
    }

    // 스탯(1~5)
    const clampStat = (v) => {
      v = Number(v);
      if (!Number.isFinite(v)) return 3;
      return Math.max(1, Math.min(5, v));
    };
    const stats = {
      atk: clampStat(this.el.statAtk?.value || 3),
      def: clampStat(this.el.statDef?.value || 3),
      agi: clampStat(this.el.statAgi?.value || 3),
      luk: clampStat(this.el.statLuk?.value || 3)
    };

    // 등록 시 HP는 항상 100
    const hp = 100;

    // 팀 키 통일
    const team = this._teamKey(teamSel);

    // 아이템 키 통일: dittany / attackBoost / defenseBoost
    const itemKey = this.el.itemSelect?.value || '';
    const items = itemKey ? [itemKey] : [];

    // 목표 HP 저장(전투 시작 후 보정용)
    this.desiredHpMap.set(name, desiredHp);

    return {
      name,
      team,                    // 'phoenix' | 'eaters'
      stats,                   // { atk, def, agi, luk }
      hp,                      // 100으로 등록
      items                    // ["dittany"] 등
    };
  }

  async addPlayer() {
    if (!this.currentBattleId) {
      this.showToast('먼저 전투를 생성하세요', 'error');
      return;
    }
    const data = this.collectPlayerData();
    if (!data) return;

    try {
      this.addLog('system', '플레이어 등록 중...');
      const r = await this.fetchJSON(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      const player = r?.player || r;
      if (!player || !(player.id || player.name)) throw new Error('플레이어 응답 오류');

      // 로컬 목록 업데이트
      this.playerList = this.uniqueById([...this.playerList, player]);
      this.updateTeamRoster();
      this.resetPlayerForm();

      this.addLog('system', `플레이어 "${player.name}" 등록 완료 (HP목표:${this.desiredHpMap.get(player.name)})`);
      this.showToast(`${player.name} 등록 완료`, 'success');
    } catch (e) {
      this.addLog('error', `플레이어 등록 실패: ${e.message}`);
      this.showToast('플레이어 등록 실패', 'error');
    }
  }

  resetPlayerForm() {
    if (this.el.playerName) this.el.playerName.value = '';
    if (this.el.playerTeam) this.el.playerTeam.value = 'phoenix';
    if (this.el.statAtk) this.el.statAtk.value = 3;
    if (this.el.statDef) this.el.statDef.value = 3;
    if (this.el.statAgi) this.el.statAgi.value = 3;
    if (this.el.statLuk) this.el.statLuk.value = 3;
    if (this.el.playerHp) this.el.playerHp.value = 100;
    if (this.el.itemSelect) this.el.itemSelect.value = '';
  }

  /* ======================= 링크/OTP ======================= */
  async generateLinks() {
    if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
    try {
      const r = await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/links`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const admin = r?.admin || r?.links?.admin || '';
      const player = r?.player || r?.links?.player || '';
      const spectator = r?.spectator || r?.links?.spectator || '';

      if (this.el.adminLink) this.el.adminLink.value = admin;
      if (this.el.playerLink) this.el.playerLink.value = player;
      if (this.el.spectatorLink) this.el.spectatorLink.value = spectator;

      this.addLog('system', '링크 생성 완료');
      this.showToast('링크 생성 완료', 'success');
    } catch (e) {
      this.addLog('error', '링크 생성 실패: ' + e.message);
      this.showToast('링크 생성 실패', 'error');
    }
  }

  /* ======================= 렌더링 ======================= */
  updateBattleStateByStatus(st) {
    const s = (st || '').toString().toLowerCase();
    if (/live|running|in_progress/.test(s)) return this.updateBattleState('live');
    if (/end|ended|finished/.test(s)) return this.updateBattleState('end');
    return this.updateBattleState('wait');
  }

  updateBattleState(state, label) {
    if (!this.el.battleStatePill) return;
    this.el.battleStatePill.classList.remove('wait', 'live', 'end');
    const map = { wait: '대기', live: '진행', end: '종료' };
    this.el.battleStatePill.classList.add(state in map ? state : 'wait');
    this.el.battleStatePill.textContent = label || map[state] || map.wait;
  }

  renderRoster(state) {
    const phoenixHost = this.el.teamPhoenix;
    const eatersHost = this.el.teamEaters;
    if (!phoenixHost || !eatersHost) return;

    phoenixHost.innerHTML = '';
    eatersHost.innerHTML = '';

    const players = state?.players || this.playerList || [];
    const list = Array.isArray(players) ? players : [];

    // 캐시 갱신
    this.playerList = this.uniqueById(list);

    const byTeam = { phoenix: [], eaters: [] };
    for (const p of list) {
      const team = this._teamKey(p.team);
      byTeam[team === 'phoenix' ? 'phoenix' : 'eaters'].push(p);
    }

    // 카운트가 있는 경우 업데이트
    if (this.optional.teamACount) this.optional.teamACount.textContent = String(byTeam.phoenix.length);
    if (this.optional.teamBCount) this.optional.teamBCount.textContent = String(byTeam.eaters.length);

    const makeRow = (p) => {
      const hpText = (typeof p.hp === 'number' && typeof p.maxHp === 'number')
        ? ` / HP ${p.hp}/${p.maxHp}`
        : (typeof p.hp === 'number' ? ` / HP ${p.hp}` : '');
      const name = this.escapeHtml(p.name ?? '플레이어');
      const atk = p.stats?.atk ?? p.atk ?? '-';
      const def = p.stats?.def ?? p.def ?? '-';
      const agi = p.stats?.agi ?? p.agi ?? '-';
      const luk = p.stats?.luk ?? p.luk ?? '-';

      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <div>
          <span class="badge">${name}</span>
          <span class="stat">공격 ${this.escapeHtml(atk)} / 방어 ${this.escapeHtml(def)} / 민첩 ${this.escapeHtml(agi)} / 행운 ${this.escapeHtml(luk)}${hpText}</span>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-action="kick" data-id="${this.escapeHtml(p.id || '')}" data-name="${name}">제거</button>
        </div>
      `;
      // 제거 핸들러
      row.querySelector('[data-action="kick"]')?.addEventListener('click', async () => {
        const id = p.id;
        if (!id || !this.currentBattleId) return;
        if (!confirm(`플레이어 "${p.name}"을(를) 제거하시겠습니까?`)) return;
        try {
          await this.fetchJSON(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players/${encodeURIComponent(id)}`, {
            method: 'DELETE'
          });
          this.addLog('system', `플레이어 제거: ${p.name}`);
          this.showToast('플레이어 제거됨', 'success');
        } catch (err) {
          this.addLog('error', '플레이어 제거 실패: ' + err.message);
          this.showToast('플레이어 제거 실패', 'error');
        }
      });
      return row;
    };

    byTeam.phoenix.forEach((p) => phoenixHost.appendChild(makeRow(p)));
    byTeam.eaters.forEach((p) => eatersHost.appendChild(makeRow(p)));
  }

  updateTeamRoster() {
    this.renderRoster({ players: this.playerList });
  }

  appendChat(sender, message) {
    const box = this.el.chatMessages;
    if (!box) return;
    const item = document.createElement('div');
    item.className = 'chat-item';
    const t = new Date();
    const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    item.innerHTML = `<span class="time">${time}</span><span class="type">${this.escapeHtml(sender)}</span><span class="msg">${this.escapeHtml(message)}</span>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  addLog(type, message) {
    const box = this.el.battleLog;
    const t = new Date();
    const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    if (box) {
      const item = document.createElement('div');
      item.className = 'log-item';
      item.innerHTML = `<span class="time">${time}</span><span class="type">${this.escapeHtml(type)}</span><span class="msg">${this.escapeHtml(message)}</span>`;
      box.appendChild(item);
      box.scrollTop = box.scrollHeight;
    } else {
      // 대체: 콘솔
      console.log(`[${time}] [${type}] ${message}`);
    }
  }

  showToast(msg, _type = 'info') {
    const el = this.el.toast;
    if (!el) {
      // 대체: 콘솔
      // console.log('[toast]', msg);
      return;
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  /* ======================= 채팅 ======================= */
  sendChat() {
    const input = this.el.chatInput;
    if (!input) return;
    const v = input.value.trim();
    if (!v) return;

    if (this.socket?.connected && this.isAuthenticated) {
      this.sendSocketMessage('chatMessage', { role: 'admin', message: v, battleId: this.currentBattleId });
    }
    this.appendChat('관리자', v);
    input.value = '';
  }

  /* ======================= Helpers ======================= */
  _teamKey(t) {
    const s = String(t || '').toLowerCase();
    if (['phoenix', 'a', 'team1'].includes(s)) return 'phoenix';
    if (['eaters', 'b', 'death', 'team2'].includes(s)) return 'eaters';
    return s || 'phoenix';
  }

  uniqueById(array) {
    const seen = new Map();
    (array || []).forEach((item) => {
      const key = (item && (item.id || item.playerId || item.name)) || Math.random().toString(36).slice(2);
      if (!seen.has(key)) seen.set(key, item);
    });
    return Array.from(seen.values());
  }

  escapeHtml(unsafe) {
    const div = document.createElement('div');
    div.textContent = String(unsafe ?? '');
    return div.innerHTML;
  }

  /* ======================= 종료/정리 ======================= */
  cleanup() {
    this.stopHeartbeat();
    this.stopSync();
    if (this._metricsTimer) clearInterval(this._metricsTimer);
    if (this.socket) {
      try { this.socket.disconnect(); } catch {}
    }
  }
}

/* ======================= 부트스트랩 ======================= */
let adminInterface;
document.addEventListener('DOMContentLoaded', () => {
  adminInterface = new EnhancedAdminInterface();
});
window.addEventListener('load', () => {
  window.adminInterface = adminInterface;
});
