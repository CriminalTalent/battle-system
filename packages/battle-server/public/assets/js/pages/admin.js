// public/assets/js/pages/admin.js
class AdminInterface {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.currentBattleId = null;
    this.currentAdminOtp = null;
    this.playerList = [];
    this.init();
  }

  init() {
    this.initElements();
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
    this.btnConnect     = document.getElementById('btnConnect');
    this.btnStartBattle = document.getElementById('btnStartBattle');
    this.btnPauseBattle = document.getElementById('btnPauseBattle');
    this.btnEndBattle   = document.getElementById('btnEndBattle');

    // 플레이어 추가
    this.playerForm   = document.getElementById('playerForm');
    this.btnAddPlayer = document.getElementById('btnAddPlayer');
    this.statAttack   = document.getElementById('statAttack');
    this.statDefense  = document.getElementById('statDefense');
    this.statAgility  = document.getElementById('statAgility');
    this.statLuck     = document.getElementById('statLuck');
    this.playerHp     = document.getElementById('playerHp');
    this.playerAvatar = document.getElementById('playerAvatar');

    // OTP/링크
    this.linksSection            = document.getElementById('linksSection');
    this.btnGeneratePlayerOTP    = document.getElementById('btnGeneratePlayerOTP');
    this.btnGenerateSpectatorOTP = document.getElementById('btnGenerateSpectatorOTP');
    this.otpDisplay              = document.getElementById('otpDisplay');
    this.playerOtpList           = document.getElementById('playerOtpList');
    this.spectatorOtpDisplay     = document.getElementById('spectatorOtpDisplay');

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
  }

  setupEventListeners() {
    if (this.battleCreateForm) {
      this.battleCreateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createBattle();
      });
    }
    if (this.btnConnect)      this.btnConnect.addEventListener('click', () => this.connectAsAdmin());
    if (this.btnStartBattle)  this.btnStartBattle.addEventListener('click', () => this.startBattle());
    if (this.btnPauseBattle)  this.btnPauseBattle.addEventListener('click', () => this.pauseBattle());
    if (this.btnEndBattle)    this.btnEndBattle.addEventListener('click', () => this.endBattle());
    if (this.btnAddPlayer)    this.btnAddPlayer.addEventListener('click', () => this.addPlayer());
    if (this.btnSendChat)     this.btnSendChat.addEventListener('click', () => this.sendChat());
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }
    if (this.btnGeneratePlayerOTP)    this.btnGeneratePlayerOTP.addEventListener('click', () => this.generatePlayerOTPs());
    if (this.btnGenerateSpectatorOTP) this.btnGenerateSpectatorOTP.addEventListener('click', () => this.generateSpectatorOTP());
  }

  // ===== 공통 fetch(JSON) + 관대한 파싱 =====
  async _json(url, opt) {
    const res  = await fetch(url, opt);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  // ===== 전투 생성 (/api/battles) =====
  async createBattle() {
    const mode = this.battleMode?.value;
    if (!mode) return this.showToast('전투 모드를 선택하세요', 'error');

    try {
      const r = await this._json('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ mode })
      });

      // battleId 필드 유연 대응
      this.currentBattleId = r.battleId || r.id || r.battle_id || null;
      if (!this.currentBattleId) throw new Error('전투 ID를 받지 못했습니다');

      // 관리자 OTP 발급 (있으면 사용)
      try {
        const otpRes = await this._json('/api/otp', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ role:'admin', battleId: this.currentBattleId, name:'관리' })
        });
        this.currentAdminOtp = otpRes.otp || otpRes.token || null;
      } catch (_) {
        this.currentAdminOtp = null; // OTP 없이도 진행 가능(소켓 조인 시 필요)
      }

      // UI 반영
      if (this.battleIdDisplay)   this.battleIdDisplay.textContent = this.currentBattleId;
      if (this.adminOtpDisplay)   this.adminOtpDisplay.textContent = this.currentAdminOtp || '-';
      if (this.createTimeDisplay) this.createTimeDisplay.textContent = new Date().toLocaleString('ko-KR');
      if (this.battleInfo)        this.battleInfo.style.display = 'block';
      if (this.linksSection)      this.linksSection.style.display = 'block';
      if (this.rosterCard)        this.rosterCard.style.display = 'block';
      if (this.btnGeneratePlayerOTP)    this.btnGeneratePlayerOTP.disabled = false;
      if (this.btnGenerateSpectatorOTP) this.btnGenerateSpectatorOTP.disabled = false;

      this.addLog('system', `전투가 생성되었습니다 (ID: ${this.currentBattleId})`);
      if (this.currentAdminOtp) this.addLog('system', `관리자 OTP: ${this.currentAdminOtp}`);
      this.showToast('전투 생성 완료', 'success');
    } catch (e) {
      this.addLog('error', `전투 생성 실패: ${e.message}`);
      this.showToast('전투 생성 실패', 'error');
    }
  }

  // ===== 관리자 연결 (정답: joinBattle with role:'admin', otp) =====
  connectAsAdmin() {
    if (!this.currentBattleId)     return this.showToast('전투 생성 후 연결하세요', 'error');
    if (!this.currentAdminOtp)     return this.showToast('관리자 OTP가 없습니다(전투 생성 후 OTP 발급 필요)', 'error');

    if (this.socket) { try { this.socket.disconnect(); } catch(_) {} }
    this.addLog('system','관리자로 연결 중…');

    this.socket = io(); // 네임스페이스 별도 사용 안 함(서버 기본 io.on('connection') 매칭)

    // 서버가 초기 인사로 'connected' emit함
    this.socket.on('connected', (info) => {
      this.addLog('system', `소켓 연결됨 (${info?.version || ''})`);
    });

    // 핵심: 서버 이벤트명과 페이로드 정확히 일치
    this.socket.on('connect', () => {
      this.socket.emit('joinBattle', {
        battleId: this.currentBattleId,
        role: 'admin',
        otp: this.currentAdminOtp
      }, (res) => {
        if (res?.success) {
          this.isConnected = true;
          if (this.btnConnect)    { this.btnConnect.textContent = '연결됨'; this.btnConnect.disabled = true; }
          if (this.btnStartBattle) this.btnStartBattle.disabled = false;
          if (this.btnEndBattle)   this.btnEndBattle.disabled = false;
          this.addLog('system','관리자로 인증됨');
          this.showToast('관리자 연결 성공', 'success');
        } else {
          this.showToast('관리자 연결 실패', 'error');
          this.addLog('error', `연결 실패: ${res?.error || '알 수 없는 오류'}`);
        }
      });
    });

    // joinBattle 성공 시 서버가 별도로 보내는 상태 스냅샷
    this.socket.on('joinSuccess', (payload) => {
      this.addLog('system', `전투 상태 동기화: 역할=${payload?.role}`);
      this.syncRoster(payload?.state?.players || []);
    });

    // 상태 갱신 스트림(옵션)
    this.socket.on('battleState', (state) => {
      this.addLog('system', `전투 상태 갱신: 플레이어 ${state?.players?.length || 0}명`);
      this.syncRoster(state?.players || []);
    });

    // 브로드캐스트 갱신(옵션: 서버에서 roster:update를 쏘는 경우)
    this.socket.on('roster:update', (p) => {
      this.syncRoster(p?.players || []);
    });

    // 채팅 수신
    this.socket.on('chatMessage', (msg) => {
      if (!msg) return;
      const sender = msg.sender || '시스템';
      const text   = msg.message || '';
      this.addLog('chat', `${sender}: ${text}`);
    });

    // 서버 표준 에러 이벤트
    this.socket.on('error', (err) => {
      this.addLog('error', `소켓 에러: ${err?.message || err}`);
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      if (this.btnConnect) { this.btnConnect.textContent = '관리자로 연결'; this.btnConnect.disabled = false; }
      this.showToast('연결 종료', 'info');
    });
  }

  // ===== 전투 제어 (소켓 이벤트) =====
  startBattle() {
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

  pauseBattle() {
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

  endBattle() {
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

  // ===== 플레이어 추가 (REST 우선, 실패 시 소켓 폴백) =====
  async addPlayer() {
    if (!this.currentBattleId) return this.showToast('먼저 전투를 생성하세요', 'error');

    const name    = document.getElementById('playerName')?.value?.trim();
    const teamSel = document.getElementById('playerTeam')?.value; // 'A' | 'B'
    const hp      = Number(this.playerHp?.value || 100);
    if (!name || !teamSel) return this.showToast('이름/팀 필수', 'error');

    const attack  = Number(this.statAttack?.value || 3);
    const defense = Number(this.statDefense?.value || 3);
    const agility = Number(this.statAgility?.value || 3);
    const luck    = Number(this.statLuck?.value || 3);
    if ([attack, defense, agility, luck].some(v => !Number.isFinite(v) || v < 1 || v > 5)) {
      return this.showToast('각 스탯은 1~5 범위여야 합니다', 'error');
    }

    const team  = (teamSel === 'A' ? '불사조 기사단' : '죽음을 먹는 자들');
    const stats = { attack, defense, agility, luck };
    const items = {
      dittany:     Number(document.getElementById('itemDittany')?.value || 0) || 0,
      attackBoost: Number(document.getElementById('itemAttackBoost')?.value || 0) || 0,
      defenseBoost:Number(document.getElementById('itemDefenseBoost')?.value || 0) || 0
    };

    // 1) REST 우선
    try {
      const r = await this._json(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ name, team, stats, items, hp })
      });
      const player = r.player || r.data || r.result || r;
      if (!player || !(player.id || player.name)) throw new Error('플레이어 응답 형식을 알 수 없습니다');

      // 아바타 업로드(선택)
      const file = this.playerAvatar?.files?.[0];
      if (file && (player.id || player.playerId)) {
        try {
          const fd = new FormData();
          fd.append('avatar', file);
          fd.append('playerId', String(player.id || player.playerId));
          await this._json(`/api/battles/${encodeURIComponent(this.currentBattleId)}/avatar`, { method:'POST', body: fd });
          this.addLog('system', `플레이어 "${player.name || name}" 아바타 업로드 완료`);
        } catch (e) {
          this.addLog('error', `이미지 업로드 실패: ${e.message}`);
        }
      }

      this.addLog('system', `플레이어 "${player.name || name}" 등록 (HP:${hp}, 공:${attack} 방:${defense} 민:${agility} 행:${luck})`);
      this.playerForm?.reset();
      ['statAttack','statDefense','statAgility','statLuck'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 3; });
      if (this.playerHp) this.playerHp.value = 100;
      if (this.playerAvatar) this.playerAvatar.value = '';
      this.updateStatDisplay();

      this.playerList = this.uniqueById([...this.playerList, player]);
      this.updateTeamRoster();
      this.showToast(`${player.name || name} 등록 완료`, 'success');
      return;
    } catch (e) {
      this.addLog('error', `플레이어 등록 실패(REST): ${e.message}`);
      this.showToast('플레이어 등록 실패, 소켓 폴백 시도', 'error');
    }

    // 2) 소켓 폴백
    try {
      if (!this.socket || !this.isConnected) throw new Error('소켓 미연결');
      this.socket.emit('addPlayer', { battleId:this.currentBattleId, name, team, stats, items, hp });
      this.addLog('system', `플레이어 추가 요청(소켓): ${name}`);
    } catch (err) {
      this.addLog('error', `소켓 폴백도 실패: ${err.message}`);
    }
  }

  // ===== OTP 발급(선택 사항, REST 엔드포인트 있는 경우) =====
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
        const otp = r.otp || r.token;
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
      const otp = r.otp || r.token;
      const url = `${location.origin}/spectator?battle=${encodeURIComponent(this.currentBattleId)}&token=${encodeURIComponent(otp)}`;
      if (this.spectatorOtpDisplay) {
        this.spectatorOtpDisplay.innerHTML = `
          <div class="otp-item">
            <span class="team-badge">관전자</span>
            <span class="code">${this.escapeHtml(otp)}</span>
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

  // ===== 채팅 =====
  sendChat() {
    const text = this.chatInput?.value?.trim();
    if (!text) return;
    if (!this.socket || !this.isConnected) return this.showToast('먼저 관리자로 연결하세요', 'error');

    this.socket.emit('chatMessage', {
      battleId: this.currentBattleId,
      message: text,
      channel: 'all'
    }, (res) => {
      if (res?.success) {
        this.addLog('chat', `관리자: ${text}`);
        this.chatInput.value = '';
      } else {
        this.showToast('채팅 전송 실패','error');
        this.addLog('error', `채팅 실패: ${res?.error || '알 수 없는 오류'}`);
      }
    });
  }

  // ===== 로스터 & 표시 =====
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
    const statsDisplay = p.stats
      ? `공:${p.stats.attack} 방:${p.stats.defense} 민:${p.stats.agility} 행:${p.stats.luck}`
      : '';
    const hp = Number.isFinite(p.hp) ? p.hp : 100;
    return `
      <div class="player-card">
        <div class="player-name">${this.escapeHtml(p.name || '')}</div>
        <div class="player-team">${this.escapeHtml(p.team || '')}</div>
        <div class="player-stats">${this.escapeHtml(statsDisplay)}</div>
        <div class="player-hp">HP: ${hp}</div>
      </div>`;
  }

  // ===== 유틸 =====
  uniqueById(arr) {
    const m = new Map();
    (arr || []).forEach(p => {
      const key = (p && (p.id || p.playerId || p.name)) || Math.random().toString(36).slice(2);
      if (!m.has(key)) m.set(key, p);
    });
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

  showToast(message, type='info') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = message;
    c.appendChild(t);
    setTimeout(()=>t.classList.add('show'),50);
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); },3000);
  }

  escapeHtml(s) { const d=document.createElement('div'); d.textContent=String(s ?? ''); return d.innerHTML; }
}

let adminInterface;
document.addEventListener('DOMContentLoaded',()=>{ adminInterface=new AdminInterface(); });
window.adminInterface=null;
window.addEventListener('load',()=>{ window.adminInterface=adminInterface; });
