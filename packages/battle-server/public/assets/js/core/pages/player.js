// PYXIS Player Page - 플레이어 페이지 로직 (play.html 구조 호환 + 알림)
class PyxisPlayer {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;

    this.myPlayerId = null;
    this.myPlayerData = null;

    this.joined = false;
    this.currentChatChannel = 'all'; // 'all' | 'team'

    this.init();
  }

  // 초기화
  init() {
    console.log('[Player] Initializing player page');

    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    // 소켓 연결
    PyxisSocket.init();
  }

  // DOM 요소 설정
  setupElements() {
    // 연결 상태
    this.connectionStatus = UI.$('#connectionStatus');
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    // 인증
    this.authSection = UI.$('#authSection');
    this.authForm = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken = UI.$('#authToken');
    this.authName = UI.$('#authName');

    // 메인 레이아웃 컨테이너
    this.gameplayArea = UI.$('#gameplayArea');

    // 좌측 팀 패널
    this.allyTeamTitle = UI.$('#allyTeamTitle');
    this.allyMembers = UI.$('#allyMembers');

    // 플레이어 정보 카드
    this.myAvatar = UI.$('#myAvatar');
    this.myName = UI.$('#myName');
    this.myTeam = UI.$('#myTeam');

    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');

    this.myHpFill = UI.$('#myHpFill');
    this.myHpText = UI.$('#myHpText');

    // 아이템 카운트
    this.itemDittany = UI.$('#itemDittany');           // .item-count 하위
    this.itemAttackBoost = UI.$('#itemAttackBoost');   // .item-count 하위
    this.itemDefenseBoost = UI.$('#itemDefenseBoost'); // .item-count 하위

    // 턴 정보
    this.turnPhase = UI.$('#turnPhase');
    this.turnDescription = UI.$('#turnDescription');

    // 액션 버튼
    this.btnAttack = UI.$('#btnAttack');
    this.btnDefend = UI.$('#btnDefend');
    this.btnDodge = UI.$('#btnDodge'); // 회피
    this.btnUseItem = UI.$('#btnUseItem');
    this.btnPass = UI.$('#btnPass');

    // 타겟 선택(컴포넌트 사용: window.PyxisTarget)
    // play.html에 /assets/js/components/target-selector.js 포함되어 있어 전역 PyxisTarget 사용 가능

    // 채팅 & 로그
    this.chatTabs = UI.$('#chatTabs');
    this.chatMessages = UI.$('#chatMessages');
    this.chatInput = UI.$('#chatInput');
    this.chatSendBtn = UI.$('#chatSendBtn');

    this.logViewer = UI.$('#logViewer');
  }

  // 이벤트 리스너
  setupEventListeners() {
    // 인증 폼
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.authenticate();
    });

    // 액션 버튼
    this.btnAttack.addEventListener('click', () => this.doAttack());
    this.btnDefend.addEventListener('click', () => this.doDefend());
    this.btnDodge.addEventListener('click', () => this.doEvade());
    this.btnUseItem.addEventListener('click', () => this.doUseItem());
    this.btnPass.addEventListener('click', () => this.doPass());

    // 단축키 (타겟 선택 오버레이가 떠 있으면 무시)
    document.addEventListener('keydown', (e) => {
      if (window.PyxisTarget?.isShown?.()) return;
      if (!this.isMyTurn()) return;

      switch (e.key) {
        case '1': e.preventDefault(); this.doAttack(); break;
        case '2': e.preventDefault(); this.doDefend(); break;
        case '3': e.preventDefault(); this.doEvade(); break;
        case '4': e.preventDefault(); this.doUseItem(); break;
        case '5': e.preventDefault(); this.doPass(); break;
        default: break;
      }
    });

    // 채팅
    if (this.chatSendBtn) {
      this.chatSendBtn.addEventListener('click', () => this.sendChat());
    }
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }

    // 채팅 탭
    if (this.chatTabs) {
      this.chatTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.chat-tab');
        if (!btn) return;
        this.chatTabs.querySelectorAll('.chat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentChatChannel = btn.dataset.channel === 'team' ? 'team' : 'all';
      });
    }

    // 화면 복귀/리사이즈 시 재렌더
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.joined && this.battleState && this.render(), 200);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.joined && this.currentBattleId) {
        this.requestStateUpdate();
        this.render();
      }
    });
  }

  // 소켓 이벤트
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.setConnection('connected', '연결됨');
      UI.success('서버에 연결되었습니다');
    });

    PyxisSocket.on('connection:disconnect', ({ reason }) => {
      this.setConnection('disconnected', '연결 끊김');
      if (this.joined) {
        UI.error(reason === 'io server disconnect' ? '서버와의 연결이 종료되었습니다' : '연결이 끊어졌습니다. 재연결 시도 중...');
      }
    });

    PyxisSocket.on('connection:error', ({ error }) => {
      this.setConnection('disconnected', '연결 실패');
      if (this.joined) UI.error(`연결 오류: ${error?.message || '알 수 없는 오류'}`);
    });

    PyxisSocket.on('connection:reconnect', ({ attemptNumber }) => {
      this.setConnection('connected', '재연결됨');
      UI.success(`서버에 재연결되었습니다 (시도 ${attemptNumber}회)`);
      if (this.joined) this.requestStateUpdate();
    });

    PyxisSocket.on('connection:attempting', ({ attemptNumber }) => {
      this.setConnection('connecting', `재연결 중... (${attemptNumber}회)`);
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (message) => {
      UI.error(`인증 실패: ${message || '알 수 없는 오류'}`);
      UI.setLoading(this.authForm.querySelector('button[type="submit"]'), false);
    });

    // 상태
    PyxisSocket.on('state:update', (state) => this.handleStateUpdate(state));
    PyxisSocket.on('state', (state) => this.handleStateUpdate(state));

    // 페이즈/배틀
    PyxisSocket.on('phase:change', (phase) => {
      const teamName = (phase.phase === 'A' || phase.phase === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addLog(`▶︎ 턴 전환: ${teamName} (라운드 ${phase.round})`, 'system');
      this.renderTurnInfo(phase);
      // 내 차례 들어오면 알림
      if (this.isMyTurnFromPhase(phase)) {
        PyxisNotify?.notifyWhenHidden?.('내 팀 페이즈!', { body: '지금 행동할 수 있어요.' });
      }
    });

    PyxisSocket.on('battle:started', () => {
      this.addLog('◆ 전투 시작', 'system');
      PyxisNotify?.notify?.('전투 시작', { body: `전투ID: ${this.currentBattleId || ''}` });
    });

    PyxisSocket.on('battle:end', (result) => {
      const winnerText = result?.winner === 'draw'
        ? '무승부'
        : ((result?.winner === 'A' || result?.winner === 'team1') ? '불사조 기사단' : '죽음을 먹는 자들');
      this.addLog(`◆ 전투 종료: ${winnerText}`, 'system');
      UI.info('전투가 종료되었습니다');
      PyxisNotify?.notify?.('전투 종료', { body: winnerText });
    });

    // 액션 응답
    PyxisSocket.on('action:success', (payload) => {
      if (payload?.message) UI.success(payload.message);
    });
    PyxisSocket.on('action:error', (msg) => {
      UI.error(`행동 실패: ${msg || '알 수 없는 오류'}`);
    });

    // 로그/채팅
    PyxisSocket.on('log:new', (event) => {
      if (event?.text) {
        this.addLog(event.text, event.type || 'system');
        // 공격/치명타 등 강조 이벤트는 백그라운드 알림
        if (/치명타|피해|격파|KO/i.test(event.text)) {
          PyxisNotify?.notifyWhenHidden?.('전투 이벤트', { body: event.text });
        }
      }
    });

    PyxisSocket.on('chat:new', (message) => this.handleChat(message));
  }

  // 연결 상태 표시
  setConnection(state, text) {
    this.connectionDot.className = `connection-dot ${state}`;
    this.connectionText.textContent = text;
  }

  // URL 파라미터로 자동 채우기
  initFromUrl() {
    const q = new URLSearchParams(window.location.search);
    const battle = q.get('battle');
    const token = q.get('token');
    const name = q.get('name');

    if (battle) this.authBattleId.value = battle;
    if (token) this.authToken.value = token;
    if (name) this.authName.value = decodeURIComponent(name);

    if (battle && token && name) {
      if (PyxisSocket.isConnected()) {
        setTimeout(() => this.authenticate(), 400);
      } else {
        PyxisSocket.on('connection:success', () => setTimeout(() => this.authenticate(), 400));
      }
    } else {
      UI.show(this.authSection);
    }
  }

  // 인증
  async authenticate() {
    const validation = UI.validateForm(this.authForm, {
      authBattleId: { required: true, label: '전투 ID' },
      authToken: { required: true, label: '플레이어 OTP' },
      authName: { required: true, label: '플레이어 이름' }
    });
    if (!validation.valid) {
      UI.error(validation.errors[0]); return;
    }

    const submitBtn = this.authForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true);

    try {
      this.currentBattleId = validation.data.authBattleId;

      // 이름 기반 인증을 위해 general authenticate 사용
      await PyxisSocket.authenticate('player', {
        battleId: validation.data.authBattleId,
        otp: validation.data.authToken,
        name: validation.data.authName
      });
    } catch (err) {
      console.error('[Player] Auth failed:', err);
      UI.error(`인증 실패: ${err.message}`);
      UI.setLoading(submitBtn, false);
    }
  }

  // 인증 성공 처리
  handleAuthSuccess(data) {
    this.joined = true;

    this.battleState = data.state || data.battle;
    this.myPlayerId = data.selfPid || data.playerId;
    this.myPlayerData = (this.myPlayerId && this.battleState?.players)
      ? this.battleState.players[this.myPlayerId]
      : null;

    UI.hide(this.authSection);
    UI.show(this.gameplayArea);

    const submitBtn = this.authForm.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, false);

    this.addLog('전투에 성공적으로 참가했습니다!', 'system');
    UI.success('전투 입장 완료!');

    // 알림 권한 요청(UX: 인증 성공 시 1회)
    PyxisNotify?.requestPermission?.();

    this.renderAll();
  }

  // 상태 업데이트 수신
  handleStateUpdate(state) {
    this.battleState = state || this.battleState;
    if (this.myPlayerId && this.battleState?.players) {
      this.myPlayerData = this.battleState.players[this.myPlayerId] || this.myPlayerData;
    }
    this.renderAll();
  }

  requestStateUpdate() {
    // 서버에 구현된 이벤트 명세가 환경마다 다를 수 있어 안전하게 여러 이름을 시도
    const bid = this.currentBattleId;
    if (!PyxisSocket.isConnected() || !bid) return;
    const payload = { battleId: bid, playerId: this.myPlayerId };

    PyxisSocket.socket.emit('player:requestState', payload);
    PyxisSocket.socket.emit('requestState', payload);
  }

  // ───────────── 렌더링 ─────────────
  renderAll() {
    if (!this.battleState) return;

    this.renderMe();
    this.renderAllyPanel();
    this.renderTurnInfo();
    // 로그는 서버에서 push되므로 수동 렌더는 생략
  }

  renderMe() {
    if (!this.myPlayerData) return;

    const me = this.myPlayerData;
    const stats = me.stats || {
      attack: me.atk, defense: me.def, agility: me.agi, luck: me.luk
    };

    this.myName.textContent = me.name || '플레이어';
    this.myTeam.textContent = UI.getTeamName(me.team);

    // 스탯
    this.statAttack.textContent = stats.attack ?? me.atk ?? 0;
    this.statDefense.textContent = stats.defense ?? me.def ?? 0;
    this.statAgility.textContent = stats.agility ?? me.agi ?? 0;
    this.statLuck.textContent = stats.luck ?? me.luk ?? 0;

    // HP
    const maxHp = me.maxHp || 1000;
    const hpPct = UI.calculateHpPercent(me.hp, maxHp);
    this.myHpFill.style.width = `${hpPct}%`;
    this.myHpText.textContent = `${me.hp}/${maxHp}`;

    // 아이템
    const items = me.items || {};
    const setCount = (root, n) => {
      const el = root?.querySelector?.('.item-count');
      if (el) el.textContent = Number(n ?? 0);
    };
    setCount(this.itemDittany, items.dittany ?? 0);
    setCount(this.itemAttackBoost, items.atkBoost ?? 0);
    setCount(this.itemDefenseBoost, items.defBoost ?? 0);

    // 아바타
    if (me.avatar) this.myAvatar.src = me.avatar;

    // 버튼 활성/비활성
    const myTurn = this.isMyTurn();
    [this.btnAttack, this.btnDefend, this.btnDodge, this.btnUseItem, this.btnPass].forEach(b => (b.disabled = !myTurn));

    // 내 턴 진입 알림 (탭이 숨겨있을 때만)
    if (myTurn && document.hidden) {
      PyxisNotify?.notifyWhenHidden?.('당신의 차례!', { body: '지금 행동하세요.' });
    }
  }

  renderAllyPanel() {
    if (!this.battleState?.players || !this.myPlayerData) return;

    const myTeam1 = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
    this.allyTeamTitle.textContent = myTeam1 ? '우리 팀 (불사조 기사단)' : '우리 팀 (죽음을 먹는 자들)';

    this.allyMembers.innerHTML = '';

    const allies = Object.values(this.battleState.players)
      .filter(p => {
        const t1 = (p.team === 'A' || p.team === 'team1');
        return (t1 === myTeam1);
      });

    if (allies.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-roster';
      empty.textContent = '플레이어가 없습니다';
      this.allyMembers.appendChild(empty);
      return;
    }

    allies.forEach(p => {
      const card = document.createElement('div');
      card.className = 'player-row';

      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      if (p.avatar) avatar.style.backgroundImage = `url(${p.avatar})`;

      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = p.name + (p.alive === false ? ' (불능)' : '');

      const hp = document.createElement('div');
      hp.className = 'player-hp small';
      const hpFill = document.createElement('div');
      hpFill.className = 'player-hp-fill';
      hpFill.style.width = `${UI.calculateHpPercent(p.hp, p.maxHp || 1000)}%`;
      hp.appendChild(hpFill);

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(hp);

      this.allyMembers.appendChild(card);
    });
  }

  renderTurnInfo(phaseOverride = null) {
    const round = phaseOverride?.round ?? this.battleState?.round ?? 1;
    const phaseKey = phaseOverride?.phase ?? this.battleState?.phase;
    const phaseName = (phaseKey === 'A' || phaseKey === 'team1') ? '불사조 기사단' : (phaseKey === 'B' || phaseKey === 'team2') ? '죽음을 먹는 자들' : '대기';
    this.turnPhase.textContent = `라운드 ${round} · ${phaseName} 페이즈`;

    // 내 차례 여부 설명
    if (this.isMyTurn()) {
      this.turnDescription.textContent = '내 차례입니다. 행동을 선택하세요!';
    } else {
      const pending = this.battleState?.turn?.pending || [];
      this.turnDescription.textContent = pending.length
        ? `대기 중 · 남은 팀원 ${pending.length}명`
        : '전투가 시작되기를 기다리는 중입니다';
    }
  }

  // ───────────── 도우미 ─────────────
  getCurrentActor() {
    // 엔진 정책상 같은 페이즈 내에서는 pending 목록에 있으면 행동 가능
    const pending = this.battleState?.turn?.pending || [];
    return pending[0] || null;
  }

  isMyTurn() {
    const pending = this.battleState?.turn?.pending || [];
    return !!(this.myPlayerId && pending.includes(this.myPlayerId) && (this.myPlayerData?.alive !== false));
  }

  isMyTurnFromPhase(phase) {
    // 단순히 페이즈만 보고 내 팀 페이즈인지 판단 (참고용)
    if (!this.myPlayerData) return false;
    const myTeam1 = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
    const phaseIsTeam1 = (phase.phase === 'A' || phase.phase === 'team1');
    return myTeam1 === phaseIsTeam1;
  }

  getEnemies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    const myTeam1 = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
    return Object.values(this.battleState.players)
      .filter(p => (p.alive !== false) && ((p.team === 'A' || p.team === 'team1') !== myTeam1));
  }

  getAllies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    const myTeam1 = (this.myPlayerData.team === 'A' || this.myPlayerData.team === 'team1');
    return Object.values(this.battleState.players)
      .filter(p => (p.alive !== false) && ((p.team === 'A' || p.team === 'team1') === myTeam1));
  }

  // ───────────── 액션 ─────────────
  async sendAction(action) {
    if (!PyxisSocket.isConnected()) {
      UI.error('서버에 연결되어 있지 않습니다');
      return;
    }
    try {
      // socket-manager 통합 API
      await PyxisSocket.sendPlayerAction(action, null, this.currentBattleId, this.myPlayerId);
    } catch (err) {
      console.error('[Player] Action error:', err);
      UI.error(`행동 실패: ${err.message || '알 수 없는 오류'}`);
    }
  }

  doAttack() {
    const enemies = this.getEnemies();
    if (enemies.length === 0) {
      UI.error('공격할 대상이 없습니다!');
      return;
    }

    window.PyxisTarget?.show?.('공격 대상 선택', enemies.map(p => ({
      id: p.id, name: p.name, hp: p.hp, maxHp: p.maxHp, alive: p.alive !== false,
      stats: p.stats || { attack: p.atk, defense: p.def, agility: p.agi, luck: p.luk }
    })), (target) => {
      this.sendAction({ type: 'attack', targetPid: target.id });
    });
  }

  doDefend() {
    this.sendAction({ type: 'defend' });
  }

  doEvade() {
    this.sendAction({ type: 'evade' });
  }

  doUseItem() {
    const itemsList = ['디터니', '공격 보정기', '방어 보정기'];
    const pick = prompt(`사용할 아이템을 입력하세요:\n${itemsList.join(', ')}`);
    if (!pick) return;

    if (pick === '디터니') {
      const allies = this.getAllies();
      if (allies.length === 0) {
        UI.error('회복 대상이 없습니다!');
        return;
      }
      window.PyxisTarget?.show?.('회복 대상 선택', allies.map(p => ({
        id: p.id, name: p.name, hp: p.hp, maxHp: p.maxHp, alive: p.alive !== false,
        stats: p.stats || { attack: p.atk, defense: p.def, agility: p.agi, luck: p.luk }
      })), (target) => {
        this.sendAction({ type: 'useItem', item: '디터니', targetPid: target.id });
      });
    } else if (pick === '공격 보정기' || pick === '방어 보정기') {
      this.sendAction({ type: 'useItem', item: pick, targetPid: this.myPlayerId });
    } else {
      UI.error('알 수 없는 아이템입니다.');
    }
  }

  doPass() {
    if (confirm('정말로 턴을 넘기시겠습니까?')) {
      this.sendAction({ type: 'pass' });
    }
  }

  // ───────────── 채팅/로그 ─────────────
  sendChat() {
    const raw = this.chatInput.value.trim();
    if (!raw || !this.currentBattleId) return;

    let channel = this.currentChatChannel;
    let text = raw;

    // /t 접두사
    if (raw.startsWith('/t ')) {
      channel = 'team';
      text = raw.slice(3).trim();
      if (!text) return;
    }

    // socket-manager의 통합 채팅 API 사용
    PyxisSocket.sendChat(text, channel, this.currentBattleId)
      .catch(() => {}); // 내부 fallback 있음

    this.chatInput.value = '';
  }

  handleChat(message) {
    const container = this.chatMessages;
    const row = document.createElement('div');
    row.className = `chat-message ${message.type || (message.scope === 'team' || message.channel === 'team' ? 'team' : '')}`;

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = UI.formatTime(message.ts || Date.now());

    const contentEl = document.createElement('span');
    contentEl.className = 'chat-content';

    if (message.type === 'system') {
      contentEl.textContent = `[시스템] ${message.text}`;
    } else if (message.type === 'cheer') {
      contentEl.textContent = `[응원] ${message.from?.nickname || message.spectator || '익명'}: ${message.text || message.cheer}`;
    } else {
      const scope = (message.scope === 'team' || message.channel === 'team') ? '[팀] ' : '[전체] ';
      const nickname = message.from?.nickname || message.nickname || message.name || '익명';
      const text = message.text || message.message || '';
      contentEl.textContent = `${scope}${nickname}: ${text}`;
    }

    row.appendChild(timeEl);
    row.appendChild(contentEl);
    container.appendChild(row);

    UI.scrollToBottom(container);

    // 100개 유지
    while (container.children.length > 100) container.removeChild(container.firstChild);

    // 백그라운드 알림
    if (document.hidden) {
      const preview = (message.text || message.message || '').slice(0, 40);
      PyxisNotify?.notifyWhenHidden?.('새 채팅', {
        body: `${message.from?.nickname || message.nickname || '익명'}: ${preview}`
      });
    }
  }

  addLog(text, type = 'info') {
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;

    const t = document.createElement('div');
    t.className = 'log-timestamp';
    t.textContent = UI.formatTime(Date.now());

    const c = document.createElement('div');
    c.className = 'log-content';
    c.textContent = text;

    row.appendChild(t);
    row.appendChild(c);
    this.logViewer.appendChild(row);

    UI.scrollToBottom(this.logViewer);

    while (this.logViewer.children.length > 100) {
      this.logViewer.removeChild(this.logViewer.firstChild);
    }
  }

  // 정리
  cleanup() {
    PyxisSocket.cleanup();
  }
}

// 페이지 로드
document.addEventListener('DOMContentLoaded', () => {
  window.player = new PyxisPlayer();
});

// 페이지 언로드
window.addEventListener('beforeunload', () => {
  window.player?.cleanup?.();
});

// 전역 에러 로그
window.addEventListener('error', (e) => console.error('[Global Error]', e.error));
window.addEventListener('unhandledrejection', (e) => console.error('[Unhandled Rejection]', e.reason));
