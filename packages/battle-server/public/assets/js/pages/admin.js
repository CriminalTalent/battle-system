// PYXIS Admin Page - 관리자 페이지 로직 (서버 엔드포인트에 딱 맞게 정리)
class PyxisAdmin {
  constructor() {
    this.currentBattleId = null;
    this.adminOtp = null;
    this.spectatorOtp = null;

    this.battleState = 'waiting'; // 'waiting' | 'ongoing' | 'ended' (표시용)
    this.lastLinks = null;

    this.init();
  }

  // 초기화
  init() {
    console.log('[Admin] init');
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    // 소켓 연결(있으면 연결, 없어도 API 위주로 정상 동작)
    if (window.PyxisSocket?.init) {
      PyxisSocket.init();
    }
  }

  // DOM 요소 수집 (기존 마크업에 맞춰 query 보정)
  setupElements() {
    // 폼
    this.battleCreateForm = UI.$('#battleCreateForm');
    this.battleMode = UI.$('#battleMode');
    this.playerAddForm = UI.$('#playerAddForm');

    // 정보/상태
    this.battleInfo = UI.$('#battleInfo');
    this.battleIdDisplay = UI.$('#battleIdDisplay');
    this.adminOtpDisplay = UI.$('#adminOtpDisplay');
    this.spectatorOtpDisplay = UI.$('#spectatorOtpDisplay');

    // 상태 인디케이터: id가 아닌 내부 요소로 잡기
    this.battleStatus = UI.$('#battleStatus');
    this.statusDot = this.battleStatus?.querySelector('.status-dot');
    this.statusText = this.battleStatus?.querySelector('span');

    // 제어 버튼
    this.controlActions = UI.$('#controlActions');
    this.btnConnect = UI.$('#btnConnect');
    this.btnStartBattle = UI.$('#btnStartBattle');
    this.btnPauseBattle = UI.$('#btnPauseBattle'); // 현재 서버 미지원 안내
    this.btnEndBattle = UI.$('#btnEndBattle');

    // 링크 섹션
    this.linksSection = UI.$('#linksSection');
    this.linksList = UI.$('#linksList');
    this.btnGenerateLinks = UI.$('#btnGenerateLinks');

    // 로그/채팅
    this.logViewer = UI.$('#logViewer');
    this.chatChannel = UI.$('#chatChannel');
    this.chatInput = UI.$('#chatInput');
    this.btnSendChat = UI.$('#btnSendChat');

    // 플레이어 폼 필드 (id 이름 맞춤)
    this.playerName = UI.$('#playerName');
    this.playerTeam = UI.$('#playerTeam');
    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');

    // 아이템 id: HTML은 itemDittany / itemAttackBoost / itemDefenseBoost
    this.itemDittany = UI.$('#itemDittany');
    this.itemAttackBoost = UI.$('#itemAttackBoost');
    this.itemDefenseBoost = UI.$('#itemDefenseBoost');

    // 로스터
    this.rosterCard = UI.$('#rosterCard');
    this.team1Roster = UI.$('#team1Roster');
    this.team2Roster = UI.$('#team2Roster');
  }

  // 이벤트
  setupEventListeners() {
    // 전투 생성
    this.battleCreateForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createBattle();
    });

    // 제어 버튼
    this.btnConnect?.addEventListener('click', () => this.connectAsAdmin());
    this.btnStartBattle?.addEventListener('click', () => this.startBattle());
    this.btnPauseBattle?.addEventListener('click', () => UI.info('일시정지는 현재 서버에서 미지원입니다'));
    this.btnEndBattle?.addEventListener('click', () => this.endBattle());

    // 링크 생성
    this.btnGenerateLinks?.addEventListener('click', () => this.generateLinks());

    // 플레이어 추가(현재 서버엔 플레이어 등록 API가 없으므로, 링크 발급을 통해 대체)
    this.playerAddForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.createPlayerLinkFromForm();
    });

    // 채팅(서버 채팅 모듈이 붙어있는 경우에만 동작)
    this.btnSendChat?.addEventListener('click', () => this.sendChat());
    this.chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // URL 변경
    window.addEventListener('popstate', () => this.initFromUrl());
  }

  // 소켓 이벤트(있으면 사용, 없어도 API로 동작)
  setupSocketEvents() {
    if (!window.PyxisSocket) return;

    PyxisSocket.on('connection:success', () => UI.success('서버에 연결되었습니다'));
    PyxisSocket.on('connection:error', ({ error }) =>
      UI.error(`연결 실패: ${error?.message || '알 수 없는 오류'}`),
    );
    PyxisSocket.on('connection:disconnect', () => UI.error('서버 연결이 끊어졌습니다'));

    // 인증 피드백
    PyxisSocket.on('authSuccess', () => {
      UI.setLoading(this.btnConnect, false);
      this.btnConnect.textContent = '로그인 완료';
      UI.showFeedback(this.btnConnect, 'success');
      this.addLogEntry('관리자 인증 성공', 'system');
    });
    PyxisSocket.on('authError', (message) => {
      UI.setLoading(this.btnConnect, false);
      UI.error(`인증 실패: ${message}`);
    });

    // 상태/페이즈/종료 로그 (있을 때만)
    PyxisSocket.on('phase:change', (phase) => {
      const teamName = phase.phase === 'team1' || phase.phase === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addLogEntry(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
    });
    PyxisSocket.on('battle:end', (result) => {
      const winnerText =
        result.winner === 'draw'
          ? '무승부'
          : result.winner === 'team1' || result.winner === 'A'
          ? '불사조 기사단'
          : '죽음을 먹는 자들';
      this.addLogEntry(`◆ 전투 종료: ${winnerText}`, 'system');
      this.renderStatus('ended');
    });
  }

  // URL 파라미터로 초기화
  initFromUrl() {
    const url = new URL(window.location.href);
    const battle = url.searchParams.get('battle');
    const token = url.searchParams.get('token');

    if (battle) {
      this.currentBattleId = battle;
      this.battleIdDisplay.textContent = battle;
      UI.show(this.battleInfo);
      UI.show(this.controlActions);
      UI.show(this.linksSection);
    }
    if (token) {
      this.adminOtp = token;
      this.adminOtpDisplay.textContent = token;
    }
  }

  // ──────────────────────────────────────────────
  // API Helpers
  // ──────────────────────────────────────────────
  async api(path, body = null, method = 'POST') {
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return await res.json();
    } catch (e) {
      console.error('[Admin] API error', e);
      return { ok: false, message: '네트워크 오류' };
    }
  }

  // ──────────────────────────────────────────────
  // Battle: Create / Start / End
  // ──────────────────────────────────────────────
  async createBattle() {
    const btn = this.battleCreateForm.querySelector('button[type="submit"]');
    UI.setLoading(btn, true);
    try {
      const mode = this.battleMode.value;
      const result = await this.api('/api/admin/battles', { mode });

      if (!result?.ok) throw new Error(result?.message || '전투 생성 실패');

      const { battleId, adminOtp, spectatorOtp } = result;

      this.currentBattleId = battleId;
      this.adminOtp = adminOtp;
      this.spectatorOtp = spectatorOtp;

      // 표시
      this.battleIdDisplay.textContent = battleId;
      this.adminOtpDisplay.textContent = adminOtp;
      this.spectatorOtpDisplay.textContent = spectatorOtp || '-';

      UI.show(this.battleInfo);
      UI.show(this.controlActions);
      UI.show(this.linksSection);

      // URL 업데이트
      const url = new URL(window.location.href);
      url.searchParams.set('battle', battleId);
      url.searchParams.set('token', adminOtp);
      window.history.pushState({}, '', url);

      this.addLogEntry('전투가 성공적으로 생성되었습니다', 'system');
      UI.success('전투가 생성되었습니다!');
      this.renderStatus('waiting');
    } catch (err) {
      UI.error(err.message || '전투 생성 실패');
    } finally {
      UI.setLoading(btn, false);
    }
  }

  async startBattle() {
    if (!this.currentBattleId) return UI.error('전투 ID가 없습니다');
    const btn = this.btnStartBattle;
    UI.setLoading(btn, true);
    try {
      const result = await this.api(`/api/admin/battles/${this.currentBattleId}/start`, {});
      if (!result?.ok) throw new Error(result?.message || '전투 시작 실패');

      this.addLogEntry('전투가 시작되었습니다', 'system');
      UI.success('전투 시작!');
      this.renderStatus('ongoing');
    } catch (e) {
      UI.error(e.message || '전투 시작 실패');
    } finally {
      UI.setLoading(btn, false);
    }
  }

  async endBattle() {
    if (!this.currentBattleId) return UI.error('전투 ID가 없습니다');
    const btn = this.btnEndBattle;
    UI.setLoading(btn, true);
    try {
      const result = await this.api(`/api/admin/battles/${this.currentBattleId}/end`, {});
      if (!result?.ok) throw new Error(result?.message || '전투 종료 실패');

      this.addLogEntry('전투가 종료되었습니다', 'system');
      UI.info('전투 종료');
      this.renderStatus('ended');
    } catch (e) {
      UI.error(e.message || '전투 종료 실패');
    } finally {
      UI.setLoading(btn, false);
    }
  }

  // ──────────────────────────────────────────────
  // Admin Auth (소켓 있을 때만)
  // ──────────────────────────────────────────────
  async connectAsAdmin() {
    if (!window.PyxisSocket) {
      return UI.info('소켓 서버 연결 없이도 전투 생성/링크 발급은 사용 가능합니다');
    }
    if (!this.currentBattleId || !this.adminOtp) {
      return UI.error('전투 ID와 관리자 OTP가 필요합니다');
    }

    UI.setLoading(this.btnConnect, true);
    try {
      // socket-manager는 admin 역할에 'adminAuth' 이벤트를 emit하도록 구현되어 있음
      await PyxisSocket.authenticate('admin', {
        battleId: this.currentBattleId,
        otp: this.adminOtp,
        token: this.adminOtp,
      });
      // 성공 처리는 authSuccess 리스너에서
    } catch (e) {
      UI.setLoading(this.btnConnect, false);
      UI.error(e.message || '관리자 인증 실패');
    }
  }

  // ──────────────────────────────────────────────
  // Links
  // ──────────────────────────────────────────────
  async generateLinks() {
    if (!this.currentBattleId) return UI.error('전투 ID가 없습니다');

    const btn = this.btnGenerateLinks;
    UI.setLoading(btn, true);
    try {
      const result = await this.api(`/api/admin/battles/${this.currentBattleId}/links`, {});
      if (!result?.ok) throw new Error(result?.message || '링크 발급 실패');

      this.lastLinks = result;
      this.renderLinks(result);

      UI.success('링크가 생성되었습니다');
      this.addLogEntry('플레이/관전/관리 링크가 생성되었습니다', 'system');
    } catch (e) {
      UI.error(e.message || '링크 생성 실패');
    } finally {
      UI.setLoading(btn, false);
    }
  }

  renderLinks({ play, watch, admin }) {
    if (!this.linksList) return;
    this.linksList.innerHTML = '';

    const makeItem = (label, url) => {
      const el = document.createElement('div');
      el.className = 'link-item enhance-hover';
      el.innerHTML = `
        <label style="min-width: 80px; font-weight: 600; color: var(--gold);">${label}:</label>
        <input class="input link-input" readonly value="${url}">
        <button class="btn copy-btn">복사</button>
      `;
      el.querySelector('.copy-btn').addEventListener('click', () => UI.copyToClipboard(url, el.querySelector('.copy-btn')));
      return el;
    };

    if (play) this.linksList.appendChild(makeItem('플레이', play));
    if (watch) this.linksList.appendChild(makeItem('관전', watch));
    if (admin) this.linksList.appendChild(makeItem('관리', admin));
  }

  // 플레이어 추가 폼 → 현재 서버는 개별 플레이어 등록 API가 없음
  // => 링크 발급 API를 호출해서 1명분의 플레이 링크를 만들고, URL의 name 파라미터만 교체해 준다.
  async createPlayerLinkFromForm() {
    if (!this.currentBattleId) return UI.error('전투를 먼저 생성하세요');

    // 기본 검증: 이름 필수, 스탯 1~10
    const name = (this.playerName?.value || '').trim();
    if (!name) return UI.error('플레이어 이름을 입력하세요');

    const clamp = (n) => Math.max(1, Math.min(10, Number(n || 1)));
    const atk = clamp(this.statAttack?.value);
    const def = clamp(this.statDefense?.value);
    const agi = clamp(this.statAgility?.value);
    const luk = clamp(this.statLuck?.value);

    // 아이템 수량(지금은 서버에 전달할 데가 없어 표시용/참고용)
    const dittany = Math.max(0, Number(this.itemDittany?.value || 0));
    const atkBoost = Math.max(0, Number(this.itemAttackBoost?.value || 0));
    const defBoost = Math.max(0, Number(this.itemDefenseBoost?.value || 0));

    // 서버 링크 발급
    const result = await this.api(`/api/admin/battles/${this.currentBattleId}/links`, {});
    if (!result?.ok) return UI.error(result?.message || '플레이어 링크 생성 실패');

    // 발급된 플레이 URL의 name 파라미터만 바꿔서 노출 (토큰/ pid는 서버가 생성)
    const playUrl = new URL(result.play);
    playUrl.searchParams.set('name', encodeURIComponent(name));

    // 화면에 추가
    this.addPlayerLink(name, playUrl.toString());

    // 폼 리셋/피드백
    UI.showFeedback(this.playerAddForm.querySelector('button[type="submit"]'), 'success');
    UI.success(`'${name}' 플레이어 링크가 생성되었습니다 (스탯: ${atk}/${def}/${agi}/${luk} · 아이템: H${dittany}/A${atkBoost}/D${defBoost})`);
    this.playerName.value = '';
  }

  addPlayerLink(playerName, url) {
    const linkItem = document.createElement('div');
    linkItem.className = 'link-item enhance-hover';

    linkItem.innerHTML = `
      <label style="min-width: 80px; font-weight: 600; color: var(--gold);">${playerName}:</label>
      <input class="input link-input" readonly value="${url}">
      <button class="btn copy-btn">복사</button>
    `;

    const btn = linkItem.querySelector('.copy-btn');
    btn.addEventListener('click', () => UI.copyToClipboard(url, btn));

    this.linksList.appendChild(linkItem);
  }

  // ──────────────────────────────────────────────
  // 채팅(있을 때만)
  // ──────────────────────────────────────────────
  sendChat() {
    if (!window.PyxisSocket) return UI.info('채팅은 소켓 서버가 활성화된 경우에만 동작합니다');

    const message = (this.chatInput?.value || '').trim();
    if (!message) return;

    PyxisSocket.sendChat({
      battleId: this.currentBattleId,
      text: message,
      nickname: '관리자',
      role: 'admin',
      scope: this.chatChannel?.value === 'team' ? 'team' : 'all',
    });

    this.chatInput.value = '';
  }

  // ──────────────────────────────────────────────
  // 상태/로그 표시
  // ──────────────────────────────────────────────
  renderStatus(state) {
    this.battleState = state;

    const map = {
      waiting: { text: '대기중', cls: 'waiting' },
      ongoing: { text: '진행중', cls: 'active' },
      ended: { text: '종료됨', cls: 'ended' },
    };
    const info = map[state] || map.waiting;

    if (this.statusDot) {
      this.statusDot.classList.remove('waiting', 'active', 'ended');
      this.statusDot.classList.add(info.cls);
    }
    if (this.statusText) this.statusText.textContent = info.text;

    // 버튼 상태
    if (state === 'waiting') {
      this.btnStartBattle?.removeAttribute('disabled');
      this.btnEndBattle?.setAttribute('disabled', 'true');
    } else if (state === 'ongoing') {
      this.btnStartBattle?.setAttribute('disabled', 'true');
      this.btnEndBattle?.removeAttribute('disabled');
    } else {
      this.btnStartBattle?.setAttribute('disabled', 'true');
      this.btnEndBattle?.setAttribute('disabled', 'true');
    }
  }

  addLogEntry(content, type = 'info') {
    if (!this.logViewer) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = UI.formatTime(Date.now());

    const contentSpan = document.createElement('span');
    contentSpan.className = 'log-content';
    contentSpan.textContent = content;

    entry.appendChild(timeSpan);
    entry.appendChild(contentSpan);
    this.logViewer.appendChild(entry);

    UI.scrollToBottom(this.logViewer);
    while (this.logViewer.children.length > 200) this.logViewer.removeChild(this.logViewer.firstChild);
  }

  // 정리
  cleanup() {
    if (window.PyxisSocket?.cleanup) PyxisSocket.cleanup();
  }
}

// 로드/언로드
document.addEventListener('DOMContentLoaded', () => {
  window.admin = new PyxisAdmin();
});
window.addEventListener('beforeunload', () => {
  if (window.admin) window.admin.cleanup();
});
