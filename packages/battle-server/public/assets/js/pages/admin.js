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
    this.battleCreateForm = document.getElementById('battleCreateForm');
    this.battleMode = document.getElementById('battleMode');
    this.battleInfo = document.getElementById('battleInfo');
    this.battleIdDisplay = document.getElementById('battleIdDisplay');
    this.adminOtpDisplay = document.getElementById('adminOtpDisplay');
    this.createTimeDisplay = document.getElementById('createTimeDisplay');

    // 제어
    this.btnConnect = document.getElementById('btnConnect');
    this.btnStartBattle = document.getElementById('btnStartBattle');
    this.btnPauseBattle = document.getElementById('btnPauseBattle');
    this.btnEndBattle = document.getElementById('btnEndBattle');

    // 플레이어 추가
    this.playerForm = document.getElementById('playerForm');
    this.btnAddPlayer = document.getElementById('btnAddPlayer');
    this.statAttack = document.getElementById('statAttack');
    this.statDefense = document.getElementById('statDefense');
    this.statAgility = document.getElementById('statAgility');
    this.statLuck = document.getElementById('statLuck');
    this.playerHp = document.getElementById('playerHp');
    this.playerAvatar = document.getElementById('playerAvatar');

    // 링크/OTP
    this.linksSection = document.getElementById('linksSection');
    this.btnGeneratePlayerOTP = document.getElementById('btnGeneratePlayerOTP');
    this.btnGenerateSpectatorOTP = document.getElementById('btnGenerateSpectatorOTP');
    this.otpDisplay = document.getElementById('otpDisplay');
    this.playerOtpList = document.getElementById('playerOtpList');
    this.spectatorOtpDisplay = document.getElementById('spectatorOtpDisplay');

    // 로스터
    this.rosterCard = document.getElementById('rosterCard');
    this.team1Roster = document.getElementById('team1Roster');
    this.team2Roster = document.getElementById('team2Roster');
    this.teamACount = document.getElementById('teamACount');
    this.teamBCount = document.getElementById('teamBCount');

    // 로그/채팅
    this.logViewer = document.getElementById('logViewer');
    this.chatInput = document.getElementById('chatInput');
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
    if (this.btnConnect) this.btnConnect.addEventListener('click', () => this.connectAsAdmin());
    if (this.btnStartBattle) this.btnStartBattle.addEventListener('click', () => this.startBattle());
    if (this.btnPauseBattle) this.btnPauseBattle.addEventListener('click', () => this.pauseBattle());
    if (this.btnEndBattle) this.btnEndBattle.addEventListener('click', () => this.endBattle());

    if (this.btnAddPlayer) this.btnAddPlayer.addEventListener('click', () => this.addPlayer());

    if (this.btnGeneratePlayerOTP) this.btnGeneratePlayerOTP.addEventListener('click', () => this.generatePlayerOTPs());
    if (this.btnGenerateSpectatorOTP) this.btnGenerateSpectatorOTP.addEventListener('click', () => this.generateSpectatorOTP());

    if (this.btnSendChat) this.btnSendChat.addEventListener('click', () => this.sendChat());
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }
  }

  // ===== API 연동 =====
  async createBattle() {
    const mode = this.battleMode?.value;
    if (!mode) return this.showToast('전투 모드를 선택하세요', 'error');

    try {
      const r = await fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ mode })
      }).then(r=>r.json());
      if (!r.ok) throw new Error(r.error || 'CREATE_FAILED');

      this.currentBattleId = r.battleId;

      const otpRes = await fetch('/api/otp', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ role:'admin', battleId: this.currentBattleId, name:'관리' })
      }).then(r=>r.json());
      if (!otpRes.ok) throw new Error(otpRes.error || 'OTP_FAILED');
      this.currentAdminOtp = otpRes.otp;

      this.battleIdDisplay.textContent = this.currentBattleId;
      this.adminOtpDisplay.textContent = this.currentAdminOtp;
      this.createTimeDisplay.textContent = new Date().toLocaleString('ko-KR');

      this.battleInfo.style.display = 'block';
      this.linksSection.style.display = 'block';
      this.rosterCard.style.display = 'block';

      this.btnGeneratePlayerOTP.disabled = false;
      this.btnGenerateSpectatorOTP.disabled = false;

      this.addLog('system', `전투가 생성되었습니다 (ID: ${this.currentBattleId})`);
      this.addLog('system', `관리자 OTP: ${this.currentAdminOtp}`);
      this.showToast('전투 생성 완료', 'success');
    } catch (e) {
      this.addLog('error', `전투 생성 실패: ${e.message}`);
      this.showToast('전투 생성 실패', 'error');
    }
  }

  async connectAsAdmin() {
    if (!this.currentBattleId || !this.currentAdminOtp) return this.showToast('전투 생성/OTP 발급 후 연결하세요', 'error');
    if (this.socket) try{ this.socket.disconnect(); }catch(_){}
    this.addLog('system','관리자로 연결 중…');

    // REST 로그인 먼저
    try {
      await fetch(`/api/battles/${this.currentBattleId}/admin/connect`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ battleId:this.currentBattleId, otp:this.currentAdminOtp, name:'관리' })
      });
    } catch(e) {
      this.addLog('error', `관리자 REST 로그인 실패: ${e.message}`);
    }

    // 소켓 연결
    this.socket = io();
    this.socket.on('connect', () => {
      this.addLog('system', '소켓 연결됨');
      this.socket.emit('session:init', { role:'admin', battleId:this.currentBattleId, otp:this.currentAdminOtp, name:'관리' });
    });

    this.socket.on('log:bootstrap', (logs=[]) => {
      logs.forEach((l)=>this.addLog('system', l.text));
      this.isConnected = true;
      this.btnConnect.textContent = '연결됨';
      this.btnConnect.disabled = true;
      this.btnStartBattle.disabled = false;
      this.btnEndBattle.disabled = false;
      this.showToast('관리자 연결 성공', 'success');
    });

    this.socket.on('log:append', (entry)=> this.addLog('system', entry.text));
    this.socket.on('roster:update', (p)=> this.syncRoster(p?.players||[]));
    this.socket.on('chat:message', (m)=> this.addLog('chat', `${m.name}: ${m.text}`));

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.btnConnect.textContent = '관리자로 연결';
      this.btnConnect.disabled = false;
      this.showToast('연결 종료', 'info');
    });
  }

  // 플레이어 추가 (REST → 소켓 폴백)
  async addPlayer() {
    if (!this.currentBattleId) return this.showToast('먼저 전투를 생성하세요', 'error');

    const name = document.getElementById('playerName')?.value?.trim();
    const teamSel = document.getElementById('playerTeam')?.value;
    const hp = Number(this.playerHp?.value || 100);

    if (!name || !teamSel) return this.showToast('이름/팀 필수', 'error');

    const attack = Number(this.statAttack?.value || 3);
    const defense = Number(this.statDefense?.value || 3);
    const agility = Number(this.statAgility?.value || 3);
    const luck = Number(this.statLuck?.value || 3);
    const stats = { attack, defense, agility, luck };
    const team = (teamSel === 'A' ? '불사조 기사단' : '죽음을 먹는 자들');

    const items = {
      dittany: Number(document.getElementById('itemDittany')?.value || 1),
      attackBoost: Number(document.getElementById('itemAttackBoost')?.value || 1),
      defenseBoost: Number(document.getElementById('itemDefenseBoost')?.value || 1)
    };

    try {
      const r = await fetch(`/api/battles/${this.currentBattleId}/players`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ name, team, stats, items, hp })
      }).then(r=>r.json());

      if (!r.ok) throw new Error(r.error || 'ADD_FAILED');

      const player = r.player;
      this.addLog('system', `플레이어 "${player.name}" 등록 (HP:${hp}, 공격:${stats.attack}, 방어:${stats.defense}, 민첩:${stats.agility}, 행운:${stats.luck})`);

      this.playerForm?.reset();
      this.updateStatDisplay();

      this.playerList = this.uniqueById([...this.playerList, player]);
      this.updateTeamRoster();
      this.showToast(`${player.name} 등록 완료`, 'success');
    } catch(e) {
      this.addLog('error', `플레이어 등록 실패(REST): ${e.message}`);
      this.showToast('플레이어 등록 실패, 소켓 폴백 시도', 'error');

      try {
        this.socket.emit('addPlayer', { battleId:this.currentBattleId, name, team, stats, items, hp });
      } catch(err) {
        this.addLog('error', `소켓 폴백도 실패: ${err.message}`);
      }
    }
  }

  // ===== 이하 로스터/로그/채팅 등 기존 메서드 유지 =====
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
      this.team1Roster.innerHTML = a.map(p => this.createPlayerCard(p)).join('') || '<div class="empty-slot">빈 자리</div>';
    }
    if (this.team2Roster) {
      this.team2Roster.innerHTML = b.map(p => this.createPlayerCard(p)).join('') || '<div class="empty-slot">빈 자리</div>';
    }
  }

  createPlayerCard(p) {
    const statsDisplay = p.stats ? `공:${p.stats.attack} 방:${p.stats.defense} 민:${p.stats.agility} 행:${p.stats.luck}` : '';
    return `
      <div class="player-card">
        <div class="player-name">${this.escapeHtml(p.name)}</div>
        <div class="player-team">${this.escapeHtml(p.team)}</div>
        <div class="player-stats">${statsDisplay}</div>
        <div class="player-hp">HP: ${p.hp || 100}</div>
      </div>`;
  }

  addLog(type, message) {
    if (!this.logViewer) return;
    const time = new Date().toLocaleTimeString('ko-KR');
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerHTML = `<div class="log-time">${time}</div><div class="log-content">${this.escapeHtml(message)}</div>`;
    this.logViewer.appendChild(div);
    this.logViewer.scrollTop = this.logViewer.scrollHeight;
  }

  showToast(message, type='info') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = message;
    c.appendChild(t);
    setTimeout(()=>t.classList.add('show'),50);
    setTimeout(()=>{t.classList.remove('show'); setTimeout(()=>t.remove(),300)},3000);
  }

  escapeHtml(s) { const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }
  uniqueById(arr){ const m=new Map(); (arr||[]).forEach(p=>{if(p&&p.id)m.set(p.id,p)}); return [...m.values()]; }
}

let adminInterface;
document.addEventListener('DOMContentLoaded',()=>{ adminInterface=new AdminInterface(); });
window.adminInterface=null;
window.addEventListener('load',()=>{ window.adminInterface=adminInterface; });
