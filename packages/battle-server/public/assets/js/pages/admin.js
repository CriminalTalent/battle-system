// public/assets/js/pages/admin.js
// Compact/robust Admin Interface (총합 제한 제거, HP 포함, HTTP+Socket 하이브리드, 한글 메시지 강화)

class AdminInterface {
  constructor() {
    // 소켓/세션 상태
    this.socket = null;
    this.isConnected = false;

    // 전투/관리 세션
    this.currentBattleId = null;
    this.currentAdminOtp = null;

    // 기본 HP (페이지에 입력란이 있으면 그 값을 우선 사용)
    this.baseHp = 100;

    // UI 상태
    this.playerList = [];

    // 초기화
    this.init();
  }

  /* =========================
   * 초기화 루틴
   * =======================*/
  init() {
    this.initElements();
    this.readInitialBaseHp();
    this.setupEventListeners();
    this.setupStatInputs();
    this.addLog('system', '관리자 시스템이 준비되었습니다');
  }

  initElements() {
    // 전투 생성
    this.battleCreateForm   = document.getElementById('battleCreateForm');
    this.battleMode         = document.getElementById('battleMode');
    this.battleInfo         = document.getElementById('battleInfo');
    this.battleIdDisplay    = document.getElementById('battleIdDisplay');
    this.adminOtpDisplay    = document.getElementById('adminOtpDisplay');
    this.createTimeDisplay  = document.getElementById('createTimeDisplay');

    // 제어
    this.btnConnect      = document.getElementById('btnConnect');
    this.btnStartBattle  = document.getElementById('btnStartBattle');
    this.btnPauseBattle  = document.getElementById('btnPauseBattle');
    this.btnEndBattle    = document.getElementById('btnEndBattle');

    // 플레이어 추가
    this.playerForm   = document.getElementById('playerForm');
    this.btnAddPlayer = document.getElementById('btnAddPlayer');

    // 스탯 입력
    this.statAttack   = document.getElementById('statAttack');
    this.statDefense  = document.getElementById('statDefense');
    this.statAgility  = document.getElementById('statAgility');
    this.statLuck     = document.getElementById('statLuck');

    // HP 입력 (있으면 사용 / 없으면 기본 HP로 대체)
    this.playerHpInput = document.getElementById('playerHp') || document.getElementById('hpValue');

    // 아바타
    this.playerAvatar = document.getElementById('playerAvatar');

    // 총합 표시(이제 사용 안함)
    this.statTotal = document.getElementById('statTotal');

    // 링크/OTP
    this.linksSection           = document.getElementById('linksSection');
    this.btnGeneratePlayerOTP   = document.getElementById('btnGeneratePlayerOTP');
    this.btnGenerateSpectatorOTP= document.getElementById('btnGenerateSpectatorOTP');
    this.otpDisplay             = document.getElementById('otpDisplay');
    this.playerOtpList          = document.getElementById('playerOtpList');
    this.spectatorOtpDisplay    = document.getElementById('spectatorOtpDisplay');

    // 로스터
    this.rosterCard  = document.getElementById('rosterCard');
    this.team1Roster = document.getElementById('team1Roster');
    this.team2Roster = document.getElementById('team2Roster');
    this.teamACount  = document.getElementById('teamACount');
    this.teamBCount  = document.getElementById('teamBCount');

    // 로그/채팅
    this.logViewer   = document.getElementById('logViewer');
    this.chatInput   = document.getElementById('chatInput');
    this.btnSendChat = document.getElementById('btnSendChat');
    this.chatChannel = document.getElementById('chatChannel');

    // 기본 HP 입력(관리 설정 섹션에 있을 수 있음)
    this.baseHpInput = document.getElementById('baseHpInput');
    this.baseHpView  = document.getElementById('baseHpView');
    this.applySettingsBtn = document.getElementById('applySettingsBtn');
  }

  readInitialBaseHp() {
    const v = parseInt(this.baseHpInput?.value ?? '', 10);
    if (Number.isFinite(v) && v > 0 && v <= 9999) this.baseHp = v;
    if (this.baseHpView) this.baseHpView.textContent = String(this.baseHp);
    if (this.playerHpInput && !this.playerHpInput.value) this.playerHpInput.value = String(this.baseHp);
  }

  setupEventListeners() {
    // 전투 생성
    if (this.battleCreateForm) {
      this.battleCreateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createBattle();
      });
    }

    // 전투 제어
    if (this.btnConnect)     this.btnConnect.addEventListener('click', () => this.connectAsAdmin());
    if (this.btnStartBattle) this.btnStartBattle.addEventListener('click', () => this.startBattle());
    if (this.btnPauseBattle) this.btnPauseBattle.addEventListener('click', () => this.pauseBattle());
    if (this.btnEndBattle)   this.btnEndBattle.addEventListener('click', () => this.endBattle());

    // 플레이어
    if (this.btnAddPlayer) this.btnAddPlayer.addEventListener('click', () => this.addPlayer());

    // OTP/링크
    if (this.btnGeneratePlayerOTP)   this.btnGeneratePlayerOTP.addEventListener('click', () => this.generatePlayerOTPs());
    if (this.btnGenerateSpectatorOTP)this.btnGenerateSpectatorOTP.addEventListener('click', () => this.generateSpectatorOTP());

    // 채팅
    if (this.btnSendChat) this.btnSendChat.addEventListener('click', () => this.sendChat());
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }

    // 기본 HP 적용 버튼
    if (this.applySettingsBtn) {
      this.applySettingsBtn.addEventListener('click', () => this.applyBaseHpSettings());
    }
  }

  /* =========================
   * 스탯 입력: 1~5, 총합 제한 없음
   * =======================*/
  setupStatInputs() {
    const inputs = [this.statAttack, this.statDefense, this.statAgility, this.statLuck];
    inputs.forEach(input => {
      if (!input) return;

      input.addEventListener('input', (e) => {
        let v = parseInt(e.target.value, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v > 5) v = 5;
        e.target.value = v;
        this.updateStatDisplay();
      });

      input.addEventListener('keydown', (e) => {
        let v = parseInt(e.target.value, 10) || 1;
        if (e.key === 'ArrowUp')  { e.preventDefault(); if (v < 5) e.target.value = v + 1; }
        if (e.key === 'ArrowDown'){ e.preventDefault(); if (v > 1) e.target.value = v - 1; }
        this.updateStatDisplay();
      });
    });

    this.updateStatDisplay();
  }

  updateStatDisplay() {
    // 총합 요소 숨김
    if (this.statTotal) this.statTotal.style.display = 'none';

    const inputs = [this.statAttack, this.statDefense, this.statAgility, this.statLuck];
    let allValid = true;

    inputs.forEach(input => {
      if (!input) return;
      const v = parseInt(input.value, 10);
      const ok = Number.isFinite(v) && v >= 1 && v <= 5;
      input.classList.toggle('error', !ok);
      if (!ok) allValid = false;
    });

    if (this.btnAddPlayer) this.btnAddPlayer.disabled = !allValid;
  }

  /* =========================
   * 공통 HTTP 유틸
   * =======================*/
  async _json(url, opt) {
    const res = await fetch(url, opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  /* =========================
   * 전투 생성
   * =======================*/
  async createBattle() {
    const mode = this.battleMode?.value;
    if (!mode) return this.showToast('전투 모드를 선택하세요', 'error');

    try {
      const r = await this._json('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ mode })
      });

      // 서버가 직접 결과를 반환 (ok 필드 없을 수 있음)
      this.currentBattleId = r.battleId || r.id || null;
      if (!this.currentBattleId) throw new Error('전투 ID를 받지 못했습니다');

      // 관리자 OTP 발급 (엔드포인트 제공 시)
      let otp = null;
      try {
        const otpRes = await this._json('/api/otp', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ role:'admin', battleId: this.currentBattleId, name:'관리' })
        });
        otp = otpRes.otp || null;
      } catch (_) {
        // 서버에 OTP 엔드포인트가 없을 수도 있음 → 생략 가능
      }
      this.currentAdminOtp = otp;

      // UI 반영
      if (this.battleIdDisplay)    this.battleIdDisplay.textContent = this.currentBattleId;
      if (this.adminOtpDisplay)    this.adminOtpDisplay.textContent = this.currentAdminOtp || '-';
      if (this.createTimeDisplay)  this.createTimeDisplay.textContent = new Date().toLocaleString('ko-KR');
      if (this.battleInfo)         this.battleInfo.style.display = 'block';
      if (this.linksSection)       this.linksSection.style.display = 'block';
      if (this.rosterCard)         this.rosterCard.style.display = 'block';

      const btn = document.querySelector('.btn-create');
      if (btn) { btn.classList.replace('btn-primary','btn-success'); btn.textContent='전투 생성됨'; btn.disabled = true; }
      if (this.btnGeneratePlayerOTP)   this.btnGeneratePlayerOTP.disabled = false;
      if (this.btnGenerateSpectatorOTP) this.btnGenerateSpectatorOTP.disabled = false;

      this.addLog('system', `전투가 생성되었습니다 (ID: ${this.currentBattleId})`);
      if (otp) this.addLog('system', `관리자 OTP: ${otp}`);
      this.showToast('전투 생성 완료', 'success');
    } catch (e) {
      this.addLog('error', `전투 생성 실패: ${e.message}`);
      this.showToast('전투 생성 실패', 'error');
    }
  }

  /* =========================
   * 관리자 연결 (HTTP 시도 → Socket 세션 초기화)
   * =======================*/
  async connectAsAdmin() {
    if (!this.currentBattleId) return this.showToast('전투를 먼저 생성하세요', 'error');

    // 기존 소켓 정리
    if (this.socket) {
      try { this.socket.disconnect(); } catch(_) {}
      this.socket = null;
    }

    this.addLog('system','관리자로 연결 중…');

    // HTTP 기반 연결 시도(있으면)
    let httpConnected = false;
    if (this.currentAdminOtp) {
      const payload = { battleId: this.currentBattleId, otp: this.currentAdminOtp, name:'관리' };
      const candidates = [
        `/api/battles/${encodeURIComponent(this.currentBattleId)}/admin/connect`,
        `/api/admin/connect`
      ];
      for (const url of candidates) {
        try {
          await this._json(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          httpConnected = true;
          break;
        } catch(_){}
      }
    }

    // Socket 연결
    this.socket = io();
    this._bindSocketEvents();

    this.socket.on('connect', () => {
      // 서버가 세션:init 패턴을 쓴다면…
      this.socket.emit('session:init', { role:'admin', battleId:this.currentBattleId, otp:this.currentAdminOtp, name:'관리' });
    });

    // 연결 수립은 log:bootstrap 수신 시점으로 판단
  }

  _bindSocketEvents() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.addLog('system', '소켓 연결됨');
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      if (this.btnConnect) { this.btnConnect.textContent = '관리자로 연결'; this.btnConnect.disabled = false; }
      this.showToast('연결 종료', 'info');
    });

    // 초기 로그 & 연결 OK
    this.socket.on('log:bootstrap', (logs = []) => {
      logs.forEach(l => this.addLog('system', l?.text ?? ''));
      this.isConnected = true;
      if (this.btnConnect) { this.btnConnect.textContent = '연결됨'; this.btnConnect.disabled = true; }
      if (this.btnStartBattle) this.btnStartBattle.disabled = false;
      if (this.btnEndBattle)   this.btnEndBattle.disabled = false;
      this.showToast('관리자 연결 성공', 'success');
    });

    // 실시간
    this.socket.on('log:append', (entry) => this.addLog('system', entry?.text ?? ''));
    this.socket.on('roster:update', (p)   => this.syncRoster(p?.players || []));
    this.socket.on('chat:message', (m)    => this.addLog('admin', `${m?.name ?? '익명'}: ${m?.text ?? ''}`));
  }

  /* =========================
   * 전투 제어
   * =======================*/
  async startBattle() {
    if (!this.socket || !this.isConnected) return this.showToast('먼저 관리자로 연결하세요', 'error');

    try {
      this.socket.emit('battle:start');
      this.addLog('system', '전투 시작 요청');
      this.showToast('전투 시작', 'success');
    } catch (e) {
      this.addLog('error', `전투 시작 실패: ${e.message}`);
      this.showToast('전투 시작 실패', 'error');
    }
  }

  async pauseBattle() {
    if (!this.socket || !this.isConnected) return this.showToast('먼저 관리자로 연결하세요', 'error');

    try {
      this.socket.emit('battle:pause');
      this.addLog('system', '전투 일시정지 요청');
      this.showToast('전투 일시정지', 'info');
    } catch (e) {
      this.addLog('error', `전투 일시정지 실패: ${e.message}`);
      this.showToast('전투 일시정지 실패', 'error');
    }
  }

  async endBattle() {
    if (!this.socket || !this.isConnected) return this.showToast('먼저 관리자로 연결하세요', 'error');

    const confirmed = confirm('전투를 강제 종료하시겠습니까?');
    if (!confirmed) return;

    try {
      this.socket.emit('battle:end');
      this.addLog('system', '전투 종료 요청');
      this.showToast('전투 종료', 'info');
    } catch (e) {
      this.addLog('error', `전투 종료 실패: ${e.message}`);
      this.showToast('전투 종료 실패', 'error');
    }
  }

  /* =========================
   * 기본 HP 설정 적용 (옵션)
   * =======================*/
  async applyBaseHpSettings() {
    const v = parseInt(this.baseHpInput?.value ?? '', 10);
    if (!Number.isFinite(v) || v < 1 || v > 9999) return this.showToast('기본 체력은 1~9999 사이여야 합니다', 'error');

    this.baseHp = v;
    if (this.baseHpView) this.baseHpView.textContent = String(this.baseHp);
    if (this.playerHpInput) this.playerHpInput.value = String(this.baseHp);

    // 서버 반영 시도 (엔드포인트가 있을 경우)
    if (this.currentBattleId) {
      const payload = { baseHp: this.baseHp };
      const candidates = [
        `/api/battles/${encodeURIComponent(this.currentBattleId)}/settings`,
        `/api/settings`
      ];
      let ok = false;
      for (const url of candidates) {
        try {
          await this._json(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          ok = true; break;
        } catch(_) {}
      }
      this.showToast(ok ? '기본 체력 적용 완료' : '서버 반영 실패(로컬만 반영)', ok ? 'success' : 'info');
    } else {
      this.showToast('기본 체력(로컬) 적용 완료', 'success');
    }
  }

  /* =========================
   * 플레이어 추가 (HP 포함)
   * =======================*/
  async addPlayer() {
    if (!this.currentBattleId) return this.showToast('먼저 전투를 생성하세요', 'error');

    const name    = document.getElementById('playerName')?.value?.trim();
    const teamSel = document.getElementById('playerTeam')?.value; // 'A' | 'B' 기대
    if (!name || !teamSel) return this.showToast('이름/팀 필수', 'error');

    // 스탯 (1~5)
    const attack  = Number(this.statAttack?.value ?? 3);
    const defense = Number(this.statDefense?.value ?? 3);
    const agility = Number(this.statAgility?.value ?? 3);
    const luck    = Number(this.statLuck?.value ?? 3);
    if ([attack, defense, agility, luck].some(s => !Number.isFinite(s) || s < 1 || s > 5)) {
      return this.showToast('각 스탯은 1~5 범위여야 합니다', 'error');
    }

    // 팀명 매핑
    const team = (teamSel === 'A' ? '불사조 기사단' : '죽음을 먹는 자들');
    const stats = { attack, defense, agility, luck };

    // HP
    let hp = parseInt(this.playerHpInput?.value ?? '', 10);
    if (!Number.isFinite(hp) || hp < 1 || hp > 9999) hp = this.baseHp;

    // 아이템 (없으면 0 디폴트)
    const items = {
      dittany:     Number(document.getElementById('itemDittany')?.value ?? 0) || 0,
      attackBoost: Number(document.getElementById('itemAttackBoost')?.value ?? 0) || 0,
      defenseBoost:Number(document.getElementById('itemDefenseBoost')?.value ?? 0) || 0,
    };

    // HTTP → Socket 순으로 시도
    try {
      const r = await this._json(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ name, team, stats, items, hp })
      });

      // 서버가 반환한 player
      const player = r.player || r;
      this.addLog('system', `플레이어 "${player.name}" 등록 (공:${stats.attack} 방:${stats.defense} 민:${stats.agility} 행:${stats.luck} / HP:${hp})`);

      // 아바타 업로드
      const file = this.playerAvatar?.files?.[0];
      if (file && player?.id) {
        try {
          const fd = new FormData();
          fd.append('avatar', file);
          fd.append('playerId', player.id);
          const up = await this._json(`/api/battles/${encodeURIComponent(this.currentBattleId)}/avatar`, { method:'POST', body: fd });
          if (!up?.ok) this.addLog('error', `이미지 업로드 실패: ${up?.error || ''}`);
          else this.addLog('system', `플레이어 "${player.name}" 아바타 업로드 완료`);
        } catch (e) {
          this.addLog('error', `이미지 업로드 실패: ${e.message}`);
        }
      }

      // 폼 리셋
      this.playerForm?.reset();
      ['statAttack','statDefense','statAgility','statLuck'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 3;
      });
      if (this.playerAvatar) this.playerAvatar.value = '';
      if (this.playerHpInput) this.playerHpInput.value = String(this.baseHp);
      this.updateStatDisplay();

      // 즉시 반영
      this.playerList = this.uniqueById([...this.playerList, player]);
      this.updateTeamRoster();
      this.showToast(`${player.name} 등록 완료`, 'success');

    } catch (e) {
      // HTTP 실패 → Socket 이벤트로 폴백
      try {
        if (!this.socket) throw new Error('소켓 연결 없음');
        this.socket.emit('player:add', { name, team, stats, items, hp });
        this.addLog('system', `플레이어 추가 요청(소켓): ${name}`);
        this.showToast('플레이어 추가 요청 전송(소켓)', 'info');
      } catch (ee) {
        this.addLog('error', `플레이어 등록 실패: ${e.message}`);
        this.showToast('플레이어 등록 실패', 'error');
      }
    }
  }

  /* =========================
   * OTP/링크 생성
   * =======================*/
  async generatePlayerOTPs() {
    if (!this.currentBattleId || this.playerList.length === 0) return this.showToast('플레이어를 먼저 추가하세요', 'error');

    try {
      const roster = this.uniqueById(this.playerList);
      const items = [];

      for (const p of roster) {
        const r = await this._json('/api/otp', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ role:'player', battleId:this.currentBattleId, playerId:p.id, name:p.name })
        });

        const otp = r.otp;
        const url = `${location.origin}/play?battle=${encodeURIComponent(this.currentBattleId)}&player=${encodeURIComponent(p.id)}&otp=${encodeURIComponent(otp)}`;
        items.push({ name:p.name, team:p.team, otp, url });
      }

      this.renderPlayerOtpList(items);
      if (this.otpDisplay) this.otpDisplay.style.display = 'block';
      this.showToast('플레이어 OTP 생성 완료','success');
      this.addLog('system', `플레이어 OTP ${items.length}개 생성`);
    } catch(e) {
      this.addLog('error', `플레이어 OTP 생성 실패: ${e.message}`);
      this.showToast('플레이어 OTP 생성 실패','error');
    }
  }

  async generateSpectatorOTP() {
    if (!this.currentBattleId) return this.showToast('전투를 먼저 생성하세요','error');

    try {
      const r = await this._json('/api/otp', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ role:'spectator', battleId:this.currentBattleId, name:'관객' })
      });

      const url = `${location.origin}/spectator?battle=${encodeURIComponent(this.currentBattleId)}&token=${encodeURIComponent(r.otp)}`;
      if (this.spectatorOtpDisplay) {
        this.spectatorOtpDisplay.innerHTML = `
          <div class="otp-item">
            <span class="team-badge">관전자</span>
            <span class="code">${this.escapeHtml(r.otp)}</span>
            <button class="otp-copy" onclick="navigator.clipboard.writeText('${url}').then(()=>this.textContent='복사됨!').finally(()=>setTimeout(()=>this.textContent='링크 복사',1000))">링크 복사</button>
          </div>`;
      }

      if (this.otpDisplay) this.otpDisplay.style.display = 'block';
      this.showToast('관전자 OTP 생성 완료','success');
      this.addLog('system', '관전자 OTP 생성됨');
    } catch(e) {
      this.addLog('error', `관전자 OTP 생성 실패: ${e.message}`);
      this.showToast('관전자 OTP 생성 실패','error');
    }
  }

  /* =========================
   * 채팅 (HTTP 폴백 포함)
   * =======================*/
  async sendChat() {
    const text = this.chatInput?.value?.trim();
    if (!text) return;

    // HTTP 먼저
    if (this.currentBattleId) {
      const payload = { battleId:this.currentBattleId, text, name:'관리자' };
      const candidates = [
        `/api/battles/${encodeURIComponent(this.currentBattleId)}/chat`,
        `/api/chat`
      ];
      for (const url of candidates) {
        try {
          await this._json(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          this.addLog('admin', `관리자: ${text}`);
          this.chatInput.value = '';
          return;
        } catch(_) {}
      }
    }

    // 소켓 폴백
    if (this.socket) {
      this.socket.emit('chat:message', { text, name:'관리자' });
      this.addLog('admin', `관리자: ${text}`);
      this.chatInput.value = '';
    } else {
      this.showToast('채팅 전송 실패(연결 없음)','error');
    }
  }

  /* =========================
   * 로스터/표시
   * =======================*/
  syncRoster(players) {
    this.playerList = this.uniqueById(players || []);
    this.updateTeamRoster();
  }

  updateTeamRoster() {
    const a = this.playerList.filter(p => p.team === '불사조 기사단');
    const b = this.playerList.filter(p => p.team === '죽음을 먹는 자들');

    if (this.teamACount) this.teamACount.textContent = `${a.length}/4`;
    if (this.teamBCount) this.teamBCount.textContent = `${b.length}/4`;

    if (this.team1Roster) {
      this.team1Roster.innerHTML = a.length
        ? a.map(p => this.createPlayerCard(p)).join('')
        : '<div class="empty-slot">빈 자리</div>';
    }
    if (this.team2Roster) {
      this.team2Roster.innerHTML = b.length
        ? b.map(p => this.createPlayerCard(p)).join('')
        : '<div class="empty-slot">빈 자리</div>';
    }
  }

  createPlayerCard(p) {
    const initial = (p.name || '?').charAt(0);
    const statsDisplay = p.stats
      ? `공:${p.stats.attack} 방:${p.stats.defense} 민:${p.stats.agility} 행:${p.stats.luck}`
      : '스탯 없음';
    const hp = Number.isFinite(p.hp) ? p.hp : this.baseHp;

    return `
      <div class="player-card">
        <div class="player-avatar">${this.escapeHtml(initial)}</div>
        <div class="player-info">
          <div class="player-name">${this.escapeHtml(p.name || '')}</div>
          <div class="player-team">${this.escapeHtml(p.team || '')}</div>
          <div class="player-stats">${this.escapeHtml(statsDisplay)}</div>
          <div class="player-hp">HP: ${hp}</div>
        </div>
      </div>`;
  }

  renderPlayerOtpList(list) {
    if (!this.playerOtpList) return;
    const html = list.map((it) => {
      const teamShort = it.team?.includes('불사조') ? '불사조'
                      : (it.team?.includes('죽음') ? '죽먹자' : (it.team || ''));
      const label = `${it.name}`;
      return `
        <div class="otp-item">
          <span class="otp-player">${this.escapeHtml(label)}</span>
          <span class="team-badge">${this.escapeHtml(teamShort)}</span>
          <span class="code">${this.escapeHtml(it.otp)}</span>
          <button class="otp-copy" onclick="navigator.clipboard.writeText('${it.url}').then(()=>this.textContent='복사됨!').finally(()=>setTimeout(()=>this.textContent='복사',1000))">복사</button>
        </div>
      `;
    }).join('');

    this.playerOtpList.classList.add('otp-list');
    this.playerOtpList.innerHTML = html;
  }

  /* =========================
   * 로그/토스트/유틸
   * =======================*/
  uniqueById(arr) {
    const m = new Map();
    (arr || []).forEach(p => { if (p && p.id) m.set(p.id, p); });
    return [...m.values()];
  }

  addLog(type, message) {
    if (!this.logViewer) return;
    const time = new Date().toLocaleTimeString('ko-KR');
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerHTML = `<div class="log-time">${time}</div><div class="log-content">${this.escapeHtml(message)}</div>`;
    this.logViewer.appendChild(div);
    this.logViewer.scrollTop = this.logViewer.scrollHeight;

    const entries = this.logViewer.querySelectorAll('.log-entry');
    if (entries.length > 200) entries[0]?.remove();
  }

  showToast(message, type = 'info') {
    let c = document.getElementById('toastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toastContainer';
      c.className = 'toast-container';
      document.body.appendChild(c);
    }

    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    c.appendChild(t);

    setTimeout(() => t.classList.add('show'), 50);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }
}

let adminInterface;
document.addEventListener('DOMContentLoaded', () => {
  adminInterface = new AdminInterface();
});

// 디버깅용 전역 참조
window.adminInterface = null;
window.addEventListener('load', () => {
  window.adminInterface = adminInterface;
});
