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

  setupStatInputs() {
    const inputs = [this.statAttack, this.statDefense, this.statAgility, this.statLuck];
    inputs.forEach(input => {
      if (!input) return;
      input.addEventListener('input', (e) => {
        let v = parseInt(e.target.value);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 5) v = 5;
        e.target.value = v;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); let v = parseInt(e.target.value)||1; if (v<5) e.target.value=v+1; }
        if (e.key === 'ArrowDown') { e.preventDefault(); let v = parseInt(e.target.value)||1; if (v>1) e.target.value=v-1; }
      });
    });
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

      this.currentBattleId = r.id;

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

      const btn = document.querySelector('.btn-create');
      if (btn) { btn.classList.replace('btn-primary','btn-success'); btn.textContent='전투 생성됨'; btn.disabled = true; }

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

  connectAsAdmin() {
    if (!this.currentBattleId || !this.currentAdminOtp) return this.showToast('전투 생성/OTP 발급 후 연결하세요', 'error');
    if (this.socket) try{ this.socket.disconnect(); }catch(_){}
    this.addLog('system','관리자로 연결 중…');

    this.socket = io();
    this.socket.on('connect', () => {
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
    this.socket.on('chat:message', (m)=> this.addLog('admin', `${m.name}: ${m.text}`));

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.btnConnect.textContent = '관리자로 연결';
      this.btnConnect.disabled = false;
      this.showToast('연결 종료', 'info');
    });
  }

  // 플레이어 추가(+이미지 업로드)
  async addPlayer() {
    if (!this.currentBattleId) return this.showToast('먼저 전투를 생성하세요', 'error');
    const name = document.getElementById('playerName')?.value?.trim();
    const teamSel = document.getElementById('playerTeam')?.value; // A|B
    if (!name || !teamSel) return this.showToast('이름/팀 필수', 'error');

    const team = (teamSel==='A' ? '불사조 기사단' : '죽음을 먹는 자들');
    const stats = {
      atk: Number(this.statAttack?.value || 3),
      def: Number(this.statDefense?.value || 3),
      agi: Number(this.statAgility?.value || 3),
      luk: Number(this.statLuck?.value || 3)
    };
    const items = [];
    const d = Number(document.getElementById('itemDittany')?.value || 0);
    const ab = Number(document.getElementById('itemAttackBoost')?.value || 0);
    const db = Number(document.getElementById('itemDefenseBoost')?.value || 0);
    if (d>0) items.push(`디터니:${d}`);
    if (ab>0) items.push(`공격보정:${ab}`);
    if (db>0) items.push(`방어보정:${db}`);

    try {
      const r = await fetch(`/api/battles/${this.currentBattleId}/players`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ name, team, stats, items })
      }).then(r=>r.json());
      if (!r.ok) throw new Error(r.error || 'ADD_FAILED');
      const player = r.player;
      this.addLog('system', `플레이어 "${player.name}" 등록`);

      const file = this.playerAvatar?.files?.[0];
      if (file) {
        const fd = new FormData();
        fd.append('avatar', file);
        fd.append('playerId', player.id);
        const up = await fetch(`/api/battles/${this.currentBattleId}/avatar`, { method:'POST', body: fd }).then(r=>r.json());
        if (!up.ok) this.addLog('error', `이미지 업로드 실패: ${up.error||''}`);
        else this.addLog('system', `플레이어 "${player.name}" 아바타 업로드 완료`);
      }

      this.playerForm?.reset();
      ['statAttack','statDefense','statAgility','statLuck'].forEach(id=>{ const el=document.getElementById(id); if (el) el.value=3; });
      if (this.playerAvatar) this.playerAvatar.value='';

      // 즉시 반영 (소켓도 곧 동기화됨)
      this.playerList = this.uniqueById([ ...this.playerList, player ]);
      this.updateTeamRoster();
      this.showToast(`${player.name} 등록 완료`, 'success');
    } catch(e) {
      this.addLog('error', `플레이어 등록 실패: ${e.message}`);
      this.showToast('플레이어 등록 실패', 'error');
    }
  }

  // 플레이어 OTP 생성 (중복 제거 + 예쁜 라벨)
  async generatePlayerOTPs() {
    if (!this.currentBattleId || this.playerList.length===0) return this.showToast('플레이어를 먼저 추가하세요', 'error');
    try {
      const roster = this.uniqueById(this.playerList);
      const items = [];
      for (const p of roster) {
        const r = await fetch('/api/otp', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ role:'player', battleId:this.currentBattleId, playerId:p.id, name:p.name })
        }).then(r=>r.json());
        if (!r.ok) throw new Error(r.error||'OTP_FAILED');
        const url = `${location.origin}/play?battleId=${encodeURIComponent(this.currentBattleId)}&otp=${encodeURIComponent(r.otp)}&name=${encodeURIComponent(p.name)}&role=player`;
        items.push({ name:p.name, team:p.team, otp:r.otp, url });
      }
      this.renderPlayerOtpList(items);
      this.otpDisplay.style.display = 'block';
      this.showToast('플레이어 OTP 생성 완료','success');
      this.addLog('system', `플레이어 OTP ${items.length}개 생성`);
    } catch(e) {
      this.addLog('error', `플레이어 OTP 생성 실패: ${e.message}`);
      this.showToast('플레이어 OTP 생성 실패','error');
    }
  }

  // 관전자 OTP 생성
  async generateSpectatorOTP() {
    if (!this.currentBattleId) return this.showToast('전투를 먼저 생성하세요','error');
    try {
      const r = await fetch('/api/otp', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ role:'spectator', battleId:this.currentBattleId, name:'관객' })
      }).then(r=>r.json());
      if (!r.ok) throw new Error(r.error||'OTP_FAILED');

      const url = `${location.origin}/watch?battleId=${encodeURIComponent(this.currentBattleId)}&otp=${encodeURIComponent(r.otp)}`;
      this.spectatorOtpDisplay.innerHTML = `
        <div class="otp-item">
          <span class="team-badge">관전자</span>
          <span class="code">${r.otp}</span>
          <button class="otp-copy" onclick="navigator.clipboard.writeText('${url}')">링크 복사</button>
        </div>`;
      this.otpDisplay.style.display = 'block';
      this.showToast('관전자 OTP 생성 완료','success');
      this.addLog('system', '관전자 OTP 생성됨');
    } catch(e) {
      this.addLog('error', `관전자 OTP 생성 실패: ${e.message}`);
      this.showToast('관전자 OTP 생성 실패','error');
    }
  }

  sendChat() {
    const text = this.chatInput?.value?.trim();
    if (!text || !this.socket) return;
    this.socket.emit('chat:message', { text });
    this.chatInput.value = '';
  }

  // ===== 표시/로스터/로그 =====
  syncRoster(players) {
    this.playerList = this.uniqueById(players || []);
    this.updateTeamRoster();
  }

  updateTeamRoster() {
    const a = this.playerList.filter(p => p.team === '불사조 기사단');
    const b = this.playerList.filter(p => p.team === '죽음을 먹는 자들');
    if (this.teamACount) this.teamACount.textContent = `${a.length}/4`;
    if (this.teamBCount) this.teamBCount.textContent = `${b.length}/4`;
    if (this.team1Roster) this.team1Roster.innerHTML = a.map(p=>this.createPlayerCard(p)).join('') || '<div class="empty-slot">빈 자리</div>';
    if (this.team2Roster) this.team2Roster.innerHTML = b.map(p=>this.createPlayerCard(p)).join('') || '<div class="empty-slot">빈 자리</div>';
  }

  createPlayerCard(p) {
    const initial = (p.name||'?').charAt(0);
    return `
      <div class="player-card">
        <div class="player-avatar">${initial}</div>
        <div class="player-info">
          <div class="player-name">${this.escapeHtml(p.name)}</div>
          <div class="player-stats">${this.escapeHtml(p.team)} | HP ${p.hp}</div>
        </div>
      </div>`;
  }

  renderPlayerOtpList(list) {
    const html = list.map((it, idx) => {
      const teamShort = it.team.includes('불사조') ? '불사조' : (it.team.includes('죽음') ? '죽먹자' : it.team);
      const label = `플레이어${idx+1}`;
      return `
        <div class="otp-item">
          <span class="otp-player">${this.escapeHtml(label)}</span>
          <span class="team-badge">${this.escapeHtml(teamShort)}</span>
          <span class="code">${this.escapeHtml(it.otp)}</span>
          <button class="otp-copy" onclick="navigator.clipboard.writeText('${it.url}')">복사</button>
        </div>
      `;
    }).join('');
    this.playerOtpList.classList.add('otp-list');
    this.playerOtpList.innerHTML = html;
  }

  // ===== 유틸 =====
  uniqueById(arr){ const m=new Map(); (arr||[]).forEach(p=>{ if(p&&p.id) m.set(p.id,p); }); return [...m.values()]; }
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
    if (!c) { c = document.createElement('div'); c.id='toastContainer'; c.className='toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = message;
    c.appendChild(t); setTimeout(()=>t.classList.add('show'), 50);
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3000);
  }
  escapeHtml(s){ const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }
}

let adminInterface;
document.addEventListener('DOMContentLoaded', () => { adminInterface = new AdminInterface(); });
window.adminInterface = null;
window.addEventListener('load', () => { window.adminInterface = adminInterface; });