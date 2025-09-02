// packages/battle-server/public/assets/js/pages/player.js
// PYXIS 플레이어 시스템 - 몰입감 있는 전투 인터페이스 (디자인/컬러/레이아웃 변경 없음)
// 변경사항: 스탯 최대치 5로 클램프, 키보드 단축키 제거

class PyxisPlayerInterface {
  constructor() {
    // 플레이어 상태
    this.playerData = {
      id: null,
      name: '',
      team: null,
      battleId: null,
      otp: null,
      isAuthenticated: false,
      isConnected: false,
    };

    // 전투 상태
    this.battleState = {
      isActive: false,
      currentTurn: null,
      phase: 'waiting', // waiting|active|ended
      myTurn: false,
      canAct: false,
    };

    // 캐릭터 정보
    this.character = {
      stats: { attack: 0, defense: 0, agility: 0, luck: 0 },
      status: { hp: 100, maxHp: 100, isAlive: true, effects: [] },
      items: { dittany: 0, attackBoost: 0, defenseBoost: 0 }, // 디터니/공격보정/방어보정
      combat: { actions: 0, damageDealt: 0, damageTaken: 0 },
    };

    // UI 상태
    this.uiState = {
      selectedAction: null,
      targetSelectionMode: false,
      availableTargets: [],
    };

    this.resizeHandler = null;

    this.init();
  }

  // 초기화
  init() {
    this.cacheEls();
    this.bindUI();
    this.bindSocket();
    this.initFromUrl();
    this.handleWindowResize();
    this.resizeHandler = () => this.handleWindowResize();
    window.addEventListener('resize', this.resizeHandler);

    // 전역 전투 타이머(1시간) 표시 (이미 돌고 있으면 무시)
    try { PyxisFX.startBattleTimer(60 * 60 * 1000); } catch (_) {}
  }

  // DOM 캐시
  cacheEls() {
    // 인증
    this.authForm = document.querySelector('#authForm');
    this.inputBattleId = document.querySelector('#battleId');
    this.inputPlayerId = document.querySelector('#playerId');
    this.inputPlayerName = document.querySelector('#playerName');
    this.inputPlayerOtp = document.querySelector('#playerOtp');

    // 연결 상태
    this.connectionDot = document.querySelector('#connDot');
    this.connectionText = document.querySelector('#connText');

    // 턴/타이머
    this.turnText = document.querySelector('#turnText');
    this.turnIndicator = document.querySelector('#turnIndicator');
    this.turnTimerAnchor = document.querySelector('#turnTimerAnchor');

    // 내 HP 표시
    this.myPlayerHpFill = document.querySelector('#myHpFill');
    this.myPlayerHpText = document.querySelector('#myHpText');

    // 액션 버튼
    this.actionAttack = document.querySelector('#btnAttack');
    this.actionDefend = document.querySelector('#btnDefend');
    this.actionDodge = document.querySelector('#btnDodge');
    this.actionItem = document.querySelector('#btnItem');
    this.actionPass = document.querySelector('#btnPass');

    // 타겟 선택 패널(폴백용)
    this.targetSelection = document.querySelector('#targetSelection');
    this.targetList = document.querySelector('#targetList');

    // 로그/채팅
    this.battleLog = document.querySelector('#battleLog');
    this.chatMessages = document.querySelector('#chatMessages');
    this.chatInput = document.querySelector('#chatInput');
    this.chatSend = document.querySelector('#chatSend');
  }

  // UI 이벤트 바인딩 (키보드 단축키 없음)
  bindUI() {
    if (this.authForm) {
      this.authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.authenticate();
      });
    }

    this.actionAttack?.addEventListener('click', () => this.selectAttack());
    this.actionDefend?.addEventListener('click', () => this.executeAction('defend'));
    this.actionDodge?.addEventListener('click', () => this.executeAction('dodge'));
    this.actionItem?.addEventListener('click', () => this.openItemModal());
    this.actionPass?.addEventListener('click', () => this.confirmPass());

    this.chatSend?.addEventListener('click', () => this.sendChat());
    this.chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // 버튼 터치/클릭 이펙트
    try { PyxisFX.enhanceClicks(); } catch (_) {}
  }

  // 소켓 바인딩
  bindSocket() {
    PyxisSocket.on('socket:connect', () => this.setConnection(true));
    PyxisSocket.on('socket:disconnect', () => this.setConnection(false));
    PyxisSocket.on('socket:error', () => this.setConnection(false));

    // 인증
    PyxisSocket.on('auth:ok', (payload) => {
      this.playerData.isAuthenticated = true;
      this.playerData.battleId = payload?.battleId || this.playerData.battleId;
      this.updateTurnBanner('입장 완료', 'success');
      this.log(`전투방(${this.playerData.battleId})에 입장했습니다`, 'system');

      // 5분 턴 타이머 앵커 부착
      try { PyxisFX.attachTurnTimer(this.turnTimerAnchor, () => this.autoPass()); } catch (_) {}
    });
    PyxisSocket.on('auth:error', ({ message }) => {
      this.playerData.isAuthenticated = false;
      this.updateTurnBanner(`인증 실패: ${message || '오류'}`, 'error');
      this.log(`인증 실패: ${message || '오류'}`, 'error');
    });

    // 상태/턴/배틀
    PyxisSocket.on('state', (state) => this.applyState(state));
    PyxisSocket.on('phase', (p) => this.onPhase(p));
    PyxisSocket.on('turn', (t) => this.onTurnUpdate(t));
    PyxisSocket.on('battle', ({ event }) => {
      if (event === 'battle:started') this.updateTurnBanner('전투 시작', 'success');
      if (event === 'battle:ended' || event === 'battle:end') this.updateTurnBanner('전투 종료', 'info');
    });

    // 액션 응답
    PyxisSocket.on('action:ok', (res) => this.onActionResult(res));
    PyxisSocket.on('action:error', (err) => this.onActionError(err));

    // 채팅
    PyxisSocket.on('chat', (m) => this.onChat(m));

    // 연결 시작
    PyxisSocket.init().catch((e) => {
      this.setConnection(false);
      this.log('서버 연결 실패: ' + (e?.message || e), 'error');
    });
  }

  // URL 파라미터로 자동 인증 (?battle= & player= & otp= & name=)
  initFromUrl() {
    const sp = new URLSearchParams(location.search);
    const battleId = sp.get('battle');
    const playerId = sp.get('player');
    const otp = sp.get('otp');
    const name = sp.get('name');

    if (battleId) this.inputBattleId && (this.inputBattleId.value = battleId);
    if (playerId) this.inputPlayerId && (this.inputPlayerId.value = playerId);
    if (otp) this.inputPlayerOtp && (this.inputPlayerOtp.value = otp);
    if (name) this.inputPlayerName && (this.inputPlayerName.value = decodeURIComponent(name));

    if (battleId && playerId && otp) {
      setTimeout(() => this.authenticate(), 300);
    }
  }

  // 인증
  async authenticate() {
    const battleId = (this.inputBattleId?.value || '').trim();
    const playerId = (this.inputPlayerId?.value || '').trim();
    const otp = (this.inputPlayerOtp?.value || '').trim();
    const name = (this.inputPlayerName?.value || '').trim();

    if (!battleId || !playerId || !otp) {
      this.toast('전투 ID / 플레이어 ID / OTP를 모두 입력하세요', 'warning');
      return;
    }

    this.playerData.battleId = battleId;
    this.playerData.id = playerId;
    this.playerData.name = name || `Player-${playerId}`;
    this.playerData.otp = otp;

    try {
      await PyxisSocket.authAsPlayer({ battleId, playerId, otp });
      this.toast('플레이어 인증 성공', 'success');
    } catch (e) {
      this.toast('인증 실패: ' + (e?.message || '오류'), 'danger');
    }
  }

  // 상태 반영 (스탯 최대치 5로 클램프)
  applyState(state) {
    if (!state) return;

    // 내 플레이어
    const me = state.players?.[this.playerData.id];
    if (me) {
      this.playerData.team = me.team || this.playerData.team;
      this.character.status.hp = Number(me.hp ?? this.character.status.hp);
      this.character.status.maxHp = Number(me.maxHp ?? this.character.status.maxHp || 100);
      this.character.status.isAlive = me.alive !== false;

      // 스탯(최대치 5 고정)
      const s = me.stats || me;
      const clamp5 = (v) => Math.max(0, Math.min(5, Number(v ?? 0)));
      this.character.stats.attack  = clamp5(s.attack ?? s.atk);
      this.character.stats.defense = clamp5(s.defense ?? s.def);
      this.character.stats.agility = clamp5(s.agility ?? s.agi);
      this.character.stats.luck    = clamp5(s.luck);

      // HP UI
      this.updateHpUI();
    }

    // 페이즈/턴
    this.battleState.currentTurn = state.turn || this.battleState.currentTurn;
    this.battleState.isActive = state.status === 'active' || state.started === true;
    this.battleState.phase = state.phase || this.battleState.phase;

    // 내 턴 여부
    const myTurn = state.currentPlayerId
      ? state.currentPlayerId === this.playerData.id
      : !!state.turn?.queue?.length && state.turn.queue[0] === this.playerData.id;

    this.setMyTurn(myTurn);
    this.renderTargetsFromState(state);
    window.lastBattleState = state; // 타겟 폴백용
  }

  onPhase(phase) {
    if (!phase) return;
    this.battleState.phase = phase.phase || this.battleState.phase;
    this.updateTurnBanner(
      phase.phase === 'A' || phase.phase === 'team1' ? '불사조 기사단 차례' : '죽음을 먹는 자들 차례',
      'info'
    );
  }

  onTurnUpdate(data) {
    // 서버가 턴 시작 신호를 주면 5분 타이머 시작
    const isMyTurn = data?.currentPlayerId === this.playerData.id || data?.playerId === this.playerData.id;
    this.setMyTurn(!!isMyTurn);
    if (isMyTurn) {
      try { PyxisFX.startTurnTimer(5 * 60 * 1000); } catch (_) {}
      this.toast('당신의 턴입니다', 'success');
    } else {
      try { PyxisFX.stopTurnTimer(); } catch (_) {}
    }
  }

  // 자동 패스(5분 반응 없음)
  autoPass() {
    if (!this.battleState.myTurn) return;
    this.executeAction('pass');
    this.toast('반응 시간 초과로 패스되었습니다', 'warning');
  }

  // 내 턴/버튼 상태
  setMyTurn(v) {
    this.battleState.myTurn = !!v;
    this.battleState.canAct = !!v && this.character.status.isAlive;
    this.updateActionButtons();
    this.updateTurnBanner(this.battleState.myTurn ? '당신의 턴입니다' : '상대의 턴', this.battleState.myTurn ? 'success' : 'info');

    if (this.battleState.myTurn) {
      try { PyxisFX.startTurnTimer(5 * 60 * 1000); } catch (_) {}
    } else {
      try { PyxisFX.stopTurnTimer(); } catch (_) {}
    }
  }

  updateActionButtons() {
    const enabled = !!(this.battleState.myTurn && this.character.status.isAlive);
    [this.actionAttack, this.actionDefend, this.actionDodge, this.actionItem, this.actionPass].forEach((b) => {
      if (b) b.disabled = !enabled;
    });
  }

  // 공격 선택 → 타겟 선택 오버레이
  selectAttack() {
    if (!this.battleState.myTurn || !this.character.status.isAlive) return;
    const targets = this.collectEnemyTargets();
    if (!targets.length) {
      this.toast('공격 가능한 대상이 없습니다', 'warning');
      return;
    }
    try {
      window.PyxisTarget.updateOptions({ allowMultiSelect: false });
      window.PyxisTarget.show('공격 대상 선택', targets, (target) => {
        if (target) this.executeAction('attack', target.id);
      });
    } catch {
      // 폴백: 간단 리스트
      this.renderTargetList(targets);
      this.show(this.targetSelection);
    }
  }

  // 서버 상태에서 적 타겟 수집
  collectEnemyTargets() {
    const state = this.battleStateSnapshot || window.lastBattleState || {};
    const players = (state.players && Object.values(state.players)) || [];
    const myTeam = this.playerData.team;
    return players
      .filter((p) => p.alive !== false && p.team && myTeam && p.team !== myTeam)
      .map((p) => ({
        id: p.id || p.playerId,
        name: p.name || `플레이어 ${p.id || ''}`,
        hp: Number(p.hp ?? 0),
        maxHp: Number(p.maxHp ?? 100),
        alive: p.alive !== false,
        stats: p.stats || {},
      }));
  }

  // (폴백용) 간단 타겟 리스트 렌더
  renderTargetList(list) {
    if (!this.targetList) return;
    this.targetList.innerHTML = '';
    if (!list.length) {
      this.targetList.innerHTML = '<div class="no-targets">선택 가능한 대상이 없습니다</div>';
      return;
    }
    list.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'target-option';
      const pct = Math.max(0, Math.min(100, Math.round((t.hp / Math.max(1, t.maxHp)) * 100)));
      row.innerHTML = `
        <div class="target-info">
          <div class="target-name">${t.name}</div>
          <div class="target-hp">
            <div class="hp-bar"><div class="hp-fill" style="width:${pct}%"></div></div>
            <span class="hp-text">${t.hp}/${t.maxHp}</span>
          </div>
        </div>`;
      row.addEventListener('click', () => {
        this.executeAction('attack', t.id);
        this.hide(this.targetSelection);
      });
      this.targetList.appendChild(row);
    });
  }

  // 서버로 액션 전송
  async executeAction(type, targetId = null, itemType = null) {
    if (!this.playerData.isAuthenticated || !this.battleState.myTurn) return;

    try {
      const payload = { type, targetId };
      if (type === 'item' && itemType) payload.item = itemType;

      const res = await PyxisSocket.sendAction(payload, this.playerData.battleId, this.playerData.id);
      if (res && res.ok) {
        this.battleState.canAct = false;
        this.updateActionButtons();
        this.log(`${this.playerData.name || '플레이어'}: ${this.actionLabel(type, itemType)} 실행`, 'action');
      }
    } catch (e) {
      this.toast('액션 실패: ' + (e?.message || '오류'), 'danger');
    }
  }

  actionLabel(type, itemType) {
    if (type === 'attack') return '공격';
    if (type === 'defend') return '방어';
    if (type === 'dodge') return '회피';
    if (type === 'pass') return '패스';
    if (type === 'item') {
      return itemType === 'dittany' ? '디터니' :
             itemType === 'attackBoost' ? '공격 보정기' :
             itemType === 'defenseBoost' ? '방어 보정기' : '아이템';
    }
    return type;
  }

  // 액션 결과 반영(이펙트)
  onActionResult(res) {
    const tEl = document.querySelector(`[data-player-id="${res?.targetId}"]`) || null;
    if (res?.effect === 'heal' && typeof res.amount === 'number') {
      try { PyxisFX.showHeal(tEl || document.body, res.amount); } catch (_) {}
    }
    if (res?.effect === 'hit' && typeof res.damage === 'number') {
      try { PyxisFX.showHit(tEl || document.body, res.damage, { crit: !!res.crit, blocked: !!res.blocked }); } catch (_) {}
    }
    if (res?.effect === 'miss') {
      try { PyxisFX.showDodge(tEl || document.body); } catch (_) {}
    }
  }
  onActionError(err) {
    this.toast('행도 처리 실패: ' + (err?.message || '오류'), 'danger');
  }

  // 패스 확인
  confirmPass() {
    if (!this.battleState.myTurn) return;
    if (confirm('이번 턴을 넘기시겠습니까?')) this.executeAction('pass');
  }

  // 아이템 사용 (간단 모달 대체: 프롬프트)
  openItemModal() {
    if (!this.battleState.myTurn) return;
    const items = this.usableItems();
    if (!items.length) {
      this.toast('사용 가능한 아이템이 없습니다', 'warning');
      return;
    }
    const picked = prompt(
      '아이템 선택: ' +
      items.map((i) => `${i.type}(${i.label}) x${i.count}`).join(', ') +
      '\n입력: dittany | attackBoost | defenseBoost'
    );
    if (!picked) return;
    const ok = items.find((i) => i.type === picked);
    if (!ok) return this.toast('잘못된 아이템', 'warning');

    // 1회성 사용 규칙: 즉시 차감 후 서버에 전송
    this.character.items[picked] = Math.max(0, (this.character.items[picked] || 0) - 1);
    this.executeAction('item', null, picked);
  }

  usableItems() {
    const out = [];
    const dict = {
      dittany: '디터니(회복 10, 1턴 소비)',
      attackBoost: '공격 보정기(1턴, ×1.5, 성공확률10%)',
      defenseBoost: '방어 보정기(1턴, ×1.5, 성공확률10%)',
    };
    Object.entries(this.character.items).forEach(([k, v]) => {
      if (v > 0) out.push({ type: k, count: v, label: dict[k] || k });
    });
    return out;
  }

  // 채팅
  sendChat() {
    const text = (this.chatInput?.value || '').trim();
    if (!text || !this.playerData.battleId) return;

    PyxisSocket.sendChat({
      text,
      channel: 'all',
      sender: this.playerData.name || '플레이어',
      battleId: this.playerData.battleId,
    });
    this.chatInput.value = '';
  }

  onChat(m) {
    const nickname = (m?.from?.nickname) || m?.nickname || '익명';
    const text = m?.text || m?.message || '';
    if (!text) return;

    const el = document.createElement('div');
    el.className = `chat-message ${m?.scope === 'team' ? 'team' : ''}`;
    const t = new Date(m?.ts || Date.now()).toLocaleTimeString('ko-KR', { hour12: false });
    el.innerHTML = `<span class="chat-time">${t}</span><span class="chat-content">${nickname}: ${this.escape(text)}</span>`;
    this.chatMessages?.appendChild(el);
    this.chatMessages && (this.chatMessages.scrollTop = this.chatMessages.scrollHeight);
  }

  // HP UI
  updateHpUI() {
    const hp = this.character.status.hp;
    const max = this.character.status.maxHp || 100;
    const pct = Math.max(0, Math.min(100, Math.round((hp / Math.max(1, max)) * 100)));
    if (this.myPlayerHpFill) this.myPlayerHpFill.style.width = `${pct}%`;
    if (this.myPlayerHpText) this.myPlayerHpText.textContent = `${hp}/${max}`;
  }

  // 서버 상태에서 타겟 렌더(데이터만 확보; 실 UI는 타겟 선택 시 사용)
  renderTargetsFromState(state) {
    this.battleStateSnapshot = state;
  }

  // 연결 상태
  setConnection(ok) {
    this.playerData.isConnected = !!ok;
    if (this.connectionDot) {
      this.connectionDot.classList.remove('ok', 'bad', 'idle');
      this.connectionDot.classList.add(ok ? 'ok' : 'bad');
    }
    if (this.connectionText) {
      this.connectionText.textContent = ok ? '전투 서버 연결됨' : '연결 끊김';
    }
  }

  // 배너/로그/토스트
  updateTurnBanner(message, type = 'info') {
    if (this.turnText) {
      this.turnText.textContent = message;
      this.turnText.className = `turn-text ${type}`;
    }
    if (this.turnIndicator) {
      this.turnIndicator.className = `turn-indicator ${type}`;
    }
  }

  log(msg, type = 'info') {
    if (!this.battleLog || !msg) return;
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    row.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString('ko-KR', { hour12: false })}</span>
    <span class="log-message">${this.escape(msg)}</span>`;
    this.battleLog.appendChild(row);
    this.battleLog.scrollTop = this.battleLog.scrollHeight;
    while (this.battleLog.children.length > 100) {
      this.battleLog.removeChild(this.battleLog.firstChild);
    }
  }

  toast(message, level = 'info') {
    try { UI.toast(message, level); } catch { console.log('[Toast]', level, message); }
  }

  escape(s) {
    const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML;
  }

  // 반응형
  handleWindowResize() {
    const isMobile = window.innerWidth <= 768;
    document.body.classList.toggle('mobile-layout', isMobile);
  }

  // 정리
  cleanup() {
    try { PyxisSocket.destroy(); } catch (_) {}
    try { window.removeEventListener('resize', this.resizeHandler); } catch (_) {}
    try { PyxisFX.stopTurnTimer(); } catch (_) {}
  }

  // 디버그(키보드 단축키 없음, 도우미만 유지)
  enableDebugMode() {
    if (window.location.hostname !== 'localhost') return;
    window.PyxisPlayerDebug = {
      simulateMyTurn: () => this.setMyTurn(true),
      addItem: (k, n = 1) => (this.character.items[k] = (this.character.items[k] || 0) + n),
      state: () => this.battleStateSnapshot,
    };
    console.log('Debug: window.PyxisPlayerDebug 사용 가능');
  }
}

// 부가 유틸 (보조 show/hide)
PyxisPlayerInterface.prototype.show = function (el) { if (el) el.style.display = ''; };
PyxisPlayerInterface.prototype.hide = function (el) { if (el) el.style.display = 'none'; };

// 전역 초기화
let playerInterface = null;
document.addEventListener('DOMContentLoaded', () => {
  playerInterface = new PyxisPlayerInterface();
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    playerInterface.enableDebugMode();
  }
});
window.addEventListener('beforeunload', () => playerInterface?.cleanup());
window.PyxisPlayer = { getInstance: () => playerInterface, version: '2.0.0', build: 'PYXIS-PLAYER-REFINED' };