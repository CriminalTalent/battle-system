// public/assets/js/pages/player.js
// PYXIS Player Page - Enhanced Design Version (stabilized)
// - 이모지 미사용
// - 팀/아이템/스탯/HP 정규화 지원 (서버 스키마 차이를 최대한 흡수)
// - 1시간 전투 타이머, 5분 자동 패스, 액션 이펙트 및 반응형 인터랙션 유지
// - 소켓 브로드캐스트(state / state:update / actionSuccess 등) 다중 호환 수신
// - 안전한 널가드와 렌더링 방어

class PyxisPlayer {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.myPlayerId = null;
    this.myPlayerData = null;
    this.joined = false;
    this.battleTimerStarted = false;
    this.uiAnimations = new Map();

    // 내부 상태
    this.lowHpPulseActive = false;

    this.init();
  }

  /* ========================= Boot ========================= */

  init() {
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initializeDesignEnhancements();
    this.initFromUrl();

    // 외부 유틸 존재 가정(프로젝트 내 공용 레이어)
    PyxisSocket.init();
    PyxisFX.mount();
    PyxisFX.enhanceClicks(document);
  }

  setupElements() {
    // 연결 상태
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    // 인증 섹션
    this.authSection = UI.$('#authSection');
    this.authForm = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken = UI.$('#authToken');
    this.authName = UI.$('#authName');

    // 플레이어 정보
    this.playerInfo = UI.$('#playerInfo');
    this.myNameEl = UI.$('#myName');
    this.myTeamEl = UI.$('#myTeam');
    this.statAttack = UI.$('#statAttack');
    this.statDefense = UI.$('#statDefense');
    this.statAgility = UI.$('#statAgility');
    this.statLuck = UI.$('#statLuck');
    this.myHpFill = UI.$('#myHpFill');
    this.myHpText = UI.$('#myHpText');

    // 아이템
    this.itemDittany = UI.$('#itemDittany .item-count');
    this.itemAtkBoost = UI.$('#itemAttackBoost .item-count');
    this.itemDefBoost = UI.$('#itemDefenseBoost .item-count');

    // 액션 버튼
    this.btnAttack = UI.$('#btnAttack');
    this.btnDefend = UI.$('#btnDefend');
    this.btnDodge = UI.$('#btnDodge');
    this.btnUseItem = UI.$('#btnUseItem');
    this.btnPass = UI.$('#btnPass');
    this.actionArea = UI.$('#actionArea');

    // 채팅 & 로그
    this.chatMessages = UI.$('#chatMessages');
    this.chatInput = UI.$('#chatInput');
    this.chatSendBtn = UI.$('#chatSendBtn');
    this.logViewer = UI.$('#logViewer');

    // 타겟 선택기
    this.targetSelector = window.PyxisTarget;

    // 헤더/타이머/턴 표시
    this.gameHeader = UI.$('#gameHeader') || document.querySelector('.pyxis-header');
    this.battleTimer = UI.$('#battleTimer') || document.querySelector('.battle-timer');
    this.turnIndicator = UI.$('#turnIndicator') || document.querySelector('.turn-indicator');
  }

  /* ========================= Design FX ========================= */

  initializeDesignEnhancements() {
    this.addPageFadeIn();
    this.addStarField();
    this.enhanceButtonEffects();
    this.addCardLiftEffects();
    this.enhanceInputEffects();
    this.customizeScrollbars();
  }

  addPageFadeIn() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.8s ease-out';
    setTimeout(() => { document.body.style.opacity = '1'; }, 100);
  }

  addStarField() {
    const starField = document.createElement('div');
    starField.className = 'star-field';
    starField.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: -1; overflow: hidden;
    `;
    for (let i = 0; i < 50; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.cssText = `
        position: absolute; width: 2px; height: 2px;
        background: var(--gold-bright); border-radius: 50%;
        left: ${Math.random() * 100}%; top: ${Math.random() * 100}%;
        animation: twinkle ${2 + Math.random() * 3}s infinite;
        box-shadow: 0 0 6px var(--gold-bright);
      `;
      starField.appendChild(star);
    }
    document.body.appendChild(starField);

    if (!document.getElementById('twinkle-style')) {
      const style = document.createElement('style');
      style.id = 'twinkle-style';
      style.textContent = `
        @keyframes twinkle {
          0%, 100% { opacity: .3; transform: scale(1) }
          50% { opacity: 1; transform: scale(1.2) }
        }
      `;
      document.head.appendChild(style);
    }
  }

  enhanceButtonEffects() {
    const buttons = document.querySelectorAll('.btn, button');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => this.createRippleEffect(e, btn));
      btn.addEventListener('mouseenter', () => {
        btn.style.boxShadow = '0 0 20px rgba(220,199,162,.4), 0 4px 15px rgba(0,0,0,.3)';
        btn.style.transform = 'translateY(-2px)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.boxShadow = '';
        btn.style.transform = '';
      });
    });
  }

  createRippleEffect(e, element) {
    const ripple = document.createElement('span');
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    ripple.style.cssText = `
      position:absolute; width:${size}px; height:${size}px; left:${x}px; top:${y}px;
      background: radial-gradient(circle, rgba(220,199,162,.3) 0%, transparent 70%);
      border-radius:50%; pointer-events:none; animation:ripple .6s ease-out;
    `;
    element.style.position = 'relative';
    element.style.overflow = 'hidden';
    element.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);

    if (!document.getElementById('ripple-style')) {
      const style = document.createElement('style');
      style.id = 'ripple-style';
      style.textContent = `
        @keyframes ripple {
          from { transform: scale(0); opacity: 1 }
          to   { transform: scale(4); opacity: 0 }
        }
      `;
      document.head.appendChild(style);
    }
  }

  addCardLiftEffects() {
    const cards = document.querySelectorAll('.card, .info-card, .player-card');
    cards.forEach(card => {
      card.style.transition = 'transform .3s ease, box-shadow .3s ease';
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-5px) scale(1.02)';
        card.style.boxShadow = '0 10px 30px rgba(0,0,0,.4), 0 0 20px rgba(220,199,162,.2)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
        card.style.boxShadow = '';
      });
    });
  }

  enhanceInputEffects() {
    const inputs = document.querySelectorAll('input, textarea');
    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        input.style.boxShadow = '0 0 0 2px rgba(220,199,162,.5), 0 0 15px rgba(220,199,162,.3)';
        input.style.borderColor = 'var(--gold-bright)';
      });
      input.addEventListener('blur', () => {
        input.style.boxShadow = '';
        input.style.borderColor = '';
      });
    });
  }

  customizeScrollbars() {
    if (!document.getElementById('scrollbar-style')) {
      const style = document.createElement('style');
      style.id = 'scrollbar-style';
      style.textContent = `
        ::-webkit-scrollbar { width: 8px; height: 8px }
        ::-webkit-scrollbar-track { background: var(--surface-1); border-radius:4px }
        ::-webkit-scrollbar-thumb {
          background: linear-gradient(45deg, var(--gold-bright), var(--gold-warm));
          border-radius:4px; box-shadow: 0 0 5px rgba(220,199,162,.3)
        }
        ::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(45deg, var(--gold-warm), var(--gold-bright));
          box-shadow: 0 0 10px rgba(220,199,162,.5)
        }
      `;
      document.head.appendChild(style);
    }
  }

  /* ========================= Events ========================= */

  setupEventListeners() {
    if (this.authForm) {
      this.authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.authenticate();
      });
    }

    // 액션 버튼
    this.btnAttack?.addEventListener('click', () => {
      this.addButtonPressEffect(this.btnAttack, 'attack');
      this.doAttack();
    });
    this.btnDefend?.addEventListener('click', () => {
      this.addButtonPressEffect(this.btnDefend, 'defend');
      this.sendAction('defend');
    });
    this.btnDodge?.addEventListener('click', () => {
      this.addButtonPressEffect(this.btnDodge, 'dodge');
      this.sendAction('evade');
    });
    this.btnUseItem?.addEventListener('click', () => {
      this.addButtonPressEffect(this.btnUseItem, 'item');
      this.doUseItem();
    });
    this.btnPass?.addEventListener('click', () => {
      this.addButtonPressEffect(this.btnPass, 'pass');
      this.confirmPass();
    });

    // 채팅
    this.chatSendBtn?.addEventListener('click', () => this.sendChat());
    this.chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // 단축키 (내 턴 + 타겟 선택기 미오픈일 때)
    document.addEventListener('keydown', (e) => {
      if (!this.isMyTurn()) return;
      if (this.targetSelector?.isShown()) return;

      const map = {
        '1': () => { this.addKeyPressEffect('1'); this.doAttack(); },
        '2': () => { this.addKeyPressEffect('2'); this.sendAction('defend'); },
        '3': () => { this.addKeyPressEffect('3'); this.sendAction('evade'); },
        '4': () => { this.addKeyPressEffect('4'); this.doUseItem(); },
        '5': () => { this.addKeyPressEffect('5'); this.confirmPass(); }
      };

      if (map[e.key]) {
        e.preventDefault();
        map[e.key]();
      }
    });

    // 보이는 순간 상태 동기화
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.joined && this.currentBattleId) {
        PyxisSocket.socket?.emit('requestState', { battleId: this.currentBattleId });
      }
    });

    // 언로드 정리
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  addButtonPressEffect(button, actionType) {
    button.style.transform = 'scale(.95)';
    button.style.filter = 'brightness(1.2)';
    setTimeout(() => {
      button.style.transform = '';
      button.style.filter = '';
    }, 150);

    const colors = {
      attack: '#F87171',
      defend: '#60A5FA',
      dodge:  '#4ADE80',
      item:   '#FBBF24',
      pass:   '#9CA3AF'
    };
    if (colors[actionType]) this.addActionFlash(button, colors[actionType]);
  }

  addKeyPressEffect(key) {
    const indicator = document.createElement('div');
    indicator.textContent = key;
    indicator.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: var(--gold-bright); color: var(--deep-navy);
      padding: 10px 20px; border-radius: 50%; font-size: 24px; font-weight: 700;
      z-index: 10000; pointer-events: none; animation: keyPulse .5s ease-out;
      box-shadow: 0 0 20px var(--gold-bright);
    `;
    document.body.appendChild(indicator);

    if (!document.getElementById('key-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'key-pulse-style';
      style.textContent = `
        @keyframes keyPulse {
          0% { transform: translate(-50%, -50%) scale(0); opacity:1 }
          50% { transform: translate(-50%, -50%) scale(1.2); opacity:1 }
          100% { transform: translate(-50%, -50%) scale(1); opacity:0 }
        }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => indicator.remove(), 500);
  }

  addActionFlash(element, color) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:absolute; inset:0; background:${color}; opacity:.3; border-radius:inherit;
      pointer-events:none; animation: actionFlash .3s ease-out;
    `;
    element.style.position = 'relative';
    element.appendChild(flash);

    if (!document.getElementById('action-flash-style')) {
      const style = document.createElement('style');
      style.id = 'action-flash-style';
      style.textContent = `
        @keyframes actionFlash { 0% { opacity:.5 } 100% { opacity:0 } }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => flash.remove(), 300);
  }

  /* ========================= Socket ========================= */

  setupSocketEvents() {
    PyxisSocket.on('connection:success', () => {
      this.connectionDot?.classList.add('active');
      if (this.connectionText) this.connectionText.textContent = '연결됨';
      this.addConnectionPulse(true);
    });

    PyxisSocket.on('connection:disconnect', () => {
      this.connectionDot?.classList.remove('active');
      if (this.connectionText) this.connectionText.textContent = '연결 끊김';
      this.addConnectionPulse(false);
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (msg) => {
      UI.error(`인증 실패: ${msg}`);
      this.addErrorPulse();
    });

    // 상태 업데이트(서버 이벤트 다양성 흡수)
    PyxisSocket.on('state', (s) => this.handleStateUpdate(s));
    PyxisSocket.on('state:update', (s) => this.handleStateUpdate(s));
    PyxisSocket.on('battleUpdate', (s) => this.handleStateUpdate(s)); // 일부 서버 구현 호환

    // 페이즈 변경
    PyxisSocket.on('phase:change', (phase) => {
      const teamName = this.normalizeTeamName(phase?.phase) === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addLog(`[턴 전환] ${teamName} (라운드 ${phase?.round ?? '-'})`, 'system');
      this.addPhaseChangeEffect(teamName);
      if (this.isMyTurn()) this.startMyTurnTimer();
      else PyxisFX.stopTurnTimer();
    });

    // 액션 결과
    PyxisSocket.on('action:success', (result) => this.handleActionFX(result));
    PyxisSocket.on('actionSuccess', (result) => this.handleActionFX(result));

    // 로그 & 채팅
    PyxisSocket.on('log:new', (ev) => {
      if (ev?.text) this.addLog(ev.text, ev.type || 'action');
    });
    PyxisSocket.on('chat:new', (msg) => {
      this.renderChat(msg);
      this.addChatNotification();
    });
    // 서버가 'chatMessage' 만 쓰는 경우 호환
    PyxisSocket.on('chatMessage', (msg) => {
      const normalized = {
        ts: Date.now(),
        text: msg?.message || msg?.text || '',
        nickname: msg?.sender || msg?.nickname || '익명',
        scope: msg?.channel === 'team' ? 'team' : 'all',
        type: msg?.type === 'system' ? 'system' : ''
      };
      this.renderChat(normalized);
      this.addChatNotification();
    });
  }

  addConnectionPulse(connected) {
    const pulse = document.createElement('div');
    pulse.style.cssText = `
      position:absolute; width:20px; height:20px; border-radius:50%;
      top:50%; left:50%; transform: translate(-50%,-50%);
      background:${connected ? 'var(--success)' : 'var(--danger)'};
      animation: connectionPulse 1s ease-out; pointer-events:none;
    `;
    if (!this.connectionDot) return;
    this.connectionDot.style.position = 'relative';
    this.connectionDot.appendChild(pulse);

    if (!document.getElementById('connection-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'connection-pulse-style';
      style.textContent = `
        @keyframes connectionPulse {
          0% { transform: translate(-50%,-50%) scale(1); opacity:.8 }
          100% { transform: translate(-50%,-50%) scale(3); opacity:0 }
        }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => pulse.remove(), 1000);
  }

  /* ========================= Auth & State ========================= */

  initFromUrl() {
    const q = new URLSearchParams(location.search);
    const b = q.get('battle');
    const t = q.get('token') || q.get('otp');
    const n = q.get('name');
    if (b && t && n) {
      if (this.authBattleId) this.authBattleId.value = b;
      if (this.authToken) this.authToken.value = t;
      if (this.authName) this.authName.value = decodeURIComponent(n);
      PyxisSocket.on('connection:success', () => setTimeout(() => this.authenticate(), 300));
    } else {
      UI.show(this.authSection);
    }
  }

  async authenticate() {
    const v = UI.validateForm(this.authForm, {
      authBattleId: { required: true, label: '전투 ID' },
      authToken:    { required: true, label: '플레이어 OTP' },
      authName:     { required: true, label: '플레이어 이름' }
    });
    if (!v.valid) {
      UI.error(v.errors[0]);
      this.addErrorPulse();
      return;
    }
    try {
      this.currentBattleId = v.data.authBattleId;
      await PyxisSocket.authenticate({
        role: 'player',
        battleId: v.data.authBattleId,
        token: v.data.authToken,
        name: v.data.authName,
        playerId: v.data.authName, // 서버가 name 기반 식별을 허용하는 케이스 호환
        otp: v.data.authToken
      });
    } catch (e) {
      UI.error(`인증 실패: ${e.message}`);
      this.addErrorPulse();
    }
  }

  handleAuthSuccess(data) {
    this.joined = true;

    // 상태/플레이어 정규화
    const incomingState = data?.state || data?.battle || {};
    const normalized = this.normalizeState(incomingState);
    this.battleState = normalized;

    this.myPlayerId = data?.selfPid || data?.playerId || data?.player?.id || this.findMyPidByName(data?.player?.name || this.authName?.value);
    if (this.myPlayerId && this.battleState?.players) {
      this.myPlayerData = this.battleState.players[this.myPlayerId] || null;
    }

    UI.hide(this.authSection);
    UI.success('전투 입장 완료!');
    this.addSuccessEffect();
    this.renderAll();

    if (!this.battleTimerStarted) {
      PyxisFX.startBattleTimer(60 * 60 * 1000);
      this.battleTimerStarted = true;
    }
    if (this.isMyTurn()) this.startMyTurnTimer();
  }

  handleStateUpdate(state) {
    const normalized = this.normalizeState(state);
    this.battleState = normalized;
    if (this.myPlayerId && this.battleState?.players) {
      this.myPlayerData = this.battleState.players[this.myPlayerId] || this.myPlayerData;
    }
    this.renderAll();
    if (this.isMyTurn()) this.startMyTurnTimer();
    else PyxisFX.stopTurnTimer();
  }

  findMyPidByName(name) {
    if (!name || !this.battleState?.players) return null;
    for (const [pid, p] of Object.entries(this.battleState.players)) {
      if ((p?.name || '').trim() === (name || '').trim()) return pid;
    }
    return null;
  }

  /* ========================= Normalizers ========================= */

  normalizeState(raw) {
    if (!raw) return { players: {} };

    // players 표준화: 배열/오브젝트 모두 허용
    let players = {};
    if (Array.isArray(raw.players)) {
      raw.players.forEach(p => {
        const id = p?.id || p?.pid || p?.playerId || p?.name || Math.random().toString(36).slice(2);
        players[id] = this.normalizePlayer(p, id);
      });
    } else if (raw.players && typeof raw.players === 'object') {
      for (const [pid, p] of Object.entries(raw.players)) {
        const id = p?.id || pid;
        players[id] = this.normalizePlayer(p, id);
      }
    }

    // status/state 문자열 정규화
    const statusRaw = raw.status || raw.state || 'waiting';
    const status = /live|running|in_progress/i.test(statusRaw) ? 'live'
                : /end|ended|finished/i.test(statusRaw)       ? 'end'
                : 'wait';

    // turn 표준화
    const turn = raw.turn || {};
    if (Array.isArray(turn?.pending)) {
      // 그대로
    } else if (turn?.actor) {
      turn.pending = [turn.actor];
    } else {
      turn.pending = turn.pending || [];
    }

    return {
      id: raw.id || raw.battleId || raw._id || null,
      status,
      turn,
      players,
      log: Array.isArray(raw.log) ? raw.log : []
    };
  }

  normalizePlayer(p, id) {
    const name = p?.name || p?.nickname || `플레이어-${String(id).slice(-4)}`;

    // 팀 정규화: phoenix/death, A/B, team1/team2, 한글 팀명 모두 수용
    const teamCode = this.normalizeTeamName(p?.team);

    // 스탯: 다양한 키 허용
    const stats = {
      attack:  p?.stats?.attack ?? p?.stats?.atk ?? p?.attack ?? p?.atk ?? 0,
      defense: p?.stats?.defense ?? p?.stats?.def ?? p?.defense ?? p?.def ?? 0,
      agility: p?.stats?.agility ?? p?.stats?.agi ?? p?.agility ?? p?.agi ?? 0,
      luck:    p?.stats?.luck ?? p?.stats?.luk ?? p?.luck ?? p?.luk ?? 0
    };

    // HP
    const maxHp = p?.maxHp ?? p?.max_hp ?? 100;
    const hp = Math.max(0, Math.min(maxHp, p?.hp ?? maxHp));

    // 아이템 정규화
    const itemsRaw = p?.items || {};
    const items = {
      // 디터니
      dittany: itemsRaw.dittany ?? itemsRaw.Dittany ?? itemsRaw.diterni ?? itemsRaw.ditany ?? 0,
      // 공격/방어 보정기
      atkBoost: itemsRaw.atkBoost ?? itemsRaw.attackBoost ?? itemsRaw['attack_boost'] ?? 0,
      defBoost: itemsRaw.defBoost ?? itemsRaw.defenseBoost ?? itemsRaw['defense_boost'] ?? 0
    };

    return {
      id, name,
      team: teamCode, // 'A' | 'B'
      stats, hp, maxHp,
      items,
      alive: p?.alive !== false // 기본 true
    };
  }

  // 입력값이 무엇이든 팀을 'A' 또는 'B' 로 정규화
  normalizeTeamName(teamVal) {
    const t = (teamVal || '').toString().toLowerCase().trim();
    if (['a', 'team1', 'phoenix', '불사조', '불사조 기사단', 'phoenixes'].includes(t)) return 'A';
    if (['b', 'team2', 'death', '죽음', '죽음을 먹는 자들', 'death eaters', 'deatheaters'].includes(t)) return 'B';
    // 숫자/불리언/기타 처리
    if (t.includes('phoenix') || t.includes('불사조')) return 'A';
    if (t.includes('death')   || t.includes('죽음'))   return 'B';
    // 알 수 없으면 A로 보수 처리(공격/아군 판단에 치명적이므로 A/B 중 하나로 고정)
    return t === 'team-a' ? 'A' : t === 'team-b' ? 'B' : 'A';
  }

  /* ========================= Rendering ========================= */

  renderAll() {
    if (!this.battleState || !this.myPlayerData) return;

    // 기본 정보
    if (this.myNameEl) this.myNameEl.textContent = this.myPlayerData.name || '-';
    if (this.myTeamEl) {
      this.myTeamEl.textContent = this.myPlayerData.team === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
    }

    // 스탯
    const s = this.myPlayerData.stats || {};
    this.animateStatUpdate(this.statAttack,  s.attack ?? 0);
    this.animateStatUpdate(this.statDefense, s.defense ?? 0);
    this.animateStatUpdate(this.statAgility, s.agility ?? 0);
    this.animateStatUpdate(this.statLuck,    s.luck ?? 0);

    // HP
    const hpPct = UI.calculateHpPercent(this.myPlayerData.hp, this.myPlayerData.maxHp || 100);
    this.animateHpBar(hpPct);
    if (this.myHpText) this.myHpText.textContent = `${this.myPlayerData.hp}/${this.myPlayerData.maxHp || 100}`;

    // 아이템
    const items = this.myPlayerData.items || {};
    this.animateItemCount(this.itemDittany, items.dittany ?? 0);
    this.animateItemCount(this.itemAtkBoost, items.atkBoost ?? 0);
    this.animateItemCount(this.itemDefBoost, items.defBoost ?? 0);

    // 액션 버튼 활성화
    const canAct = this.isMyTurn() && this.myPlayerData.alive !== false;
    [this.btnAttack, this.btnDefend, this.btnDodge, this.btnUseItem, this.btnPass].forEach(b => {
      if (!b) return;
      b.disabled = !canAct;
      b.classList.toggle('action-ready', !!canAct);
    });
  }

  animateStatUpdate(element, newValue) {
    if (!element) return;
    const oldValue = parseInt(element.textContent) || 0;
    if (oldValue !== newValue) {
      element.style.transform = 'scale(1.2)';
      element.style.color = 'var(--warning)';
      element.textContent = newValue;
      setTimeout(() => {
        element.style.transform = '';
        element.style.color = '';
      }, 300);
    } else {
      element.textContent = newValue;
    }
  }

  animateHpBar(percentage) {
    if (!this.myHpFill) return;
    const currentWidth = parseFloat(this.myHpFill.style.width) || 0;
    const pct = Math.max(0, Math.min(100, percentage || 0));
    if (Math.abs(currentWidth - pct) > 0.1) {
      this.myHpFill.style.transition = 'width .5s ease-out';
      this.myHpFill.style.width = `${pct}%`;
      if (pct < 30) {
        this.myHpFill.style.boxShadow = '0 0 10px var(--danger)';
        this.addLowHpPulse();
      } else {
        this.myHpFill.style.boxShadow = '';
      }
    }
  }

  addLowHpPulse() {
    if (this.lowHpPulseActive || !this.myHpFill) return;
    this.lowHpPulseActive = true;
    if (!document.getElementById('low-hp-pulse')) {
      const pulseStyle = document.createElement('style');
      pulseStyle.id = 'low-hp-pulse';
      pulseStyle.textContent = `
        @keyframes lowHpPulse {
          0%, 100% { background-color: var(--danger) }
          50% { background-color: #FF6B6B }
        }
      `;
      document.head.appendChild(pulseStyle);
    }
    this.myHpFill.style.animation = 'lowHpPulse 1s infinite';
    setTimeout(() => {
      this.lowHpPulseActive = false;
      if (this.myHpFill) this.myHpFill.style.animation = '';
    }, 5000);
  }

  animateItemCount(element, newValue) {
    if (!element) return;
    const oldValue = parseInt(element.textContent) || 0;
    if (oldValue !== newValue) {
      if (newValue < oldValue) {
        element.style.color = 'var(--danger)';
        element.style.transform = 'scale(.8)';
      } else {
        element.style.color = 'var(--success)';
        element.style.transform = 'scale(1.3)';
      }
      element.textContent = newValue;
      setTimeout(() => {
        element.style.color = '';
        element.style.transform = '';
      }, 300);
    } else {
      element.textContent = newValue;
    }
  }

  /* ========================= Logs & Chat ========================= */

  renderChat(message) {
    if (!this.chatMessages || !message) return;
    const el = document.createElement('div');
    el.className = `chat-message ${message.type || (message.scope === 'team' ? 'team' : '')}`;
    el.innerHTML = `
      <span class="chat-time">${UI.formatTime(message.ts || Date.now())}</span>
      <span class="chat-content">${
        message.type === 'system'
          ? `[시스템] ${UI.escape(message.text)}`
          : `${message.scope === 'team' ? '[팀] ' : '[전체] '}${UI.escape(message.nickname || '익명')}: ${UI.escape(message.text || '')}`
      }</span>
    `;
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    this.chatMessages.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, 10);
    UI.scrollToBottom(this.chatMessages);
    while (this.chatMessages.children.length > 100) this.chatMessages.removeChild(this.chatMessages.firstChild);
  }

  addLog(text, type = 'info') {
    if (!this.logViewer) return;
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    row.innerHTML = `
      <span class="time">${UI.formatTime(Date.now())}</span>
      <span class="content">${UI.escape(text)}</span>
    `;
    const typeColors = {
      system: 'var(--info)',
      action: 'var(--text)',
      damage: 'var(--danger)',
      heal:   'var(--success)',
      info:   'var(--text-dim)'
    };
    if (typeColors[type]) row.style.borderLeft = `3px solid ${typeColors[type]}`;
    row.style.opacity = '0';
    row.style.transform = 'translateX(-20px)';
    this.logViewer.appendChild(row);
    setTimeout(() => {
      row.style.transition = 'opacity .3s ease, transform .3s ease';
      row.style.opacity = '1';
      row.style.transform = 'translateX(0)';
    }, 10);
    UI.scrollToBottom(this.logViewer);
    while (this.logViewer.children.length > 100) this.logViewer.removeChild(this.logViewer.firstChild);
  }

  addChatNotification() {
    const chatContainer = this.chatMessages?.parentElement;
    if (!chatContainer) return;
    chatContainer.style.boxShadow = '0 0 15px rgba(220,199,162,.5)';
    setTimeout(() => { chatContainer.style.boxShadow = ''; }, 1000);
  }

  addErrorPulse() {
    document.body.style.boxShadow = 'inset 0 0 50px rgba(248,113,113,.3)';
    setTimeout(() => { document.body.style.boxShadow = ''; }, 500);
  }

  addSuccessEffect() {
    const effect = document.createElement('div');
    effect.style.cssText = `
      position:fixed; inset:0; background: radial-gradient(circle, rgba(74,222,128,.2) 0%, transparent 70%);
      pointer-events:none; z-index:9999; animation: successWave 1s ease-out;
    `;
    document.body.appendChild(effect);
    if (!document.getElementById('success-wave-style')) {
      const style = document.createElement('style');
      style.id = 'success-wave-style';
      style.textContent = `
        @keyframes successWave {
          0% { opacity:0; transform: scale(0) }
          50%{ opacity:1; transform: scale(1) }
          100%{ opacity:0; transform: scale(1.5) }
        }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => effect.remove(), 1000);
  }

  /* ========================= Turn & Actions ========================= */

  isMyTurn() {
    const cur = this.battleState?.turn?.pending?.[0] || this.battleState?.turn?.actor;
    return !!(cur && cur === this.myPlayerId && this.myPlayerData?.alive !== false);
  }

  startMyTurnTimer() {
    PyxisFX.attachTurnTimer(this.actionArea, () => this.autoPass());
    PyxisFX.startTurnTimer(5 * 60 * 1000);
    PyxisFX.vibrate([40, 40, 40]);
    this.addMyTurnEffect();
    UI.info('당신의 턴입니다! (5분 제한)');
  }

  addMyTurnEffect() {
    if (!this.actionArea) return;
    this.actionArea.style.boxShadow = '0 0 30px rgba(220,199,162,.6)';
    this.actionArea.style.borderColor = 'var(--gold-bright)';

    const pulseOverlay = document.createElement('div');
    pulseOverlay.className = 'turn-pulse-overlay';
    pulseOverlay.style.cssText = `
      position:absolute; inset:0; border:2px solid var(--gold-bright);
      border-radius:inherit; pointer-events:none; animation: turnPulse 2s infinite;
    `;
    this.actionArea.style.position = 'relative';
    this.actionArea.appendChild(pulseOverlay);

    if (!document.getElementById('turn-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'turn-pulse-style';
      style.textContent = `
        @keyframes turnPulse {
          0%, 100% { opacity:.3; transform: scale(1) }
          50% { opacity:1; transform: scale(1.02) }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => {
      pulseOverlay.remove();
      this.actionArea.style.boxShadow = '';
      this.actionArea.style.borderColor = '';
    }, 5 * 60 * 1000);
  }

  async autoPass() {
    if (!this.isMyTurn()) return;
    UI.warning('5분 경과로 자동 패스됩니다');
    this.addTimeoutEffect();
    await this.sendAction('pass');
  }

  addTimeoutEffect() {
    const timeout = document.createElement('div');
    timeout.textContent = '시간 초과!';
    timeout.style.cssText = `
      position:fixed; top:40%; left:50%; transform: translate(-50%,-50%);
      background: var(--danger); color:#fff; padding:20px 40px; border-radius: var(--radius);
      font-size:1.5rem; font-weight:700; z-index:10000; animation: timeoutAlert 2s ease-out;
      box-shadow: 0 0 30px var(--danger);
    `;
    document.body.appendChild(timeout);

    if (!document.getElementById('timeout-alert-style')) {
      const style = document.createElement('style');
      style.id = 'timeout-alert-style';
      style.textContent = `
        @keyframes timeoutAlert {
          0% { transform: translate(-50%,-50%) scale(0) rotate(-15deg); opacity:0 }
          20%{ transform: translate(-50%,-50%) scale(1.1) rotate(5deg);  opacity:1 }
          80%{ transform: translate(-50%,-50%) scale(1)   rotate(0);     opacity:1 }
          100%{transform: translate(-50%,-50%) scale(.9)  rotate(0);     opacity:0 }
        }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => timeout.remove(), 2000);
  }

  confirmPass() {
    if (confirm('정말로 턴을 넘기시겠습니까?')) this.sendAction('pass');
  }

  async sendAction(type, extra = {}) {
    if (!PyxisSocket.isConnected()) {
      UI.error('서버에 연결되어 있지 않습니다');
      return;
    }
    try {
      await PyxisSocket.sendPlayerAction(
        type,
        extra.targetPid || null,
        this.currentBattleId,
        this.myPlayerId
      );
    } catch (e) {
      UI.error(`행동 실패: ${e.message}`);
      this.addErrorPulse();
    }
  }

  doAttack() {
    const enemies = this.getEnemies();
    if (enemies.length === 0) {
      UI.error('공격할 대상이 없습니다');
      return;
    }
    window.PyxisTarget.show('공격 대상 선택', enemies, (t) => {
      this.sendAction('attack', { targetPid: t.id });
    });
  }

  doUseItem() {
    const items = this.myPlayerData?.items || {};
    const menu = [];
    if ((items.dittany ?? 0) > 0) menu.push('디터니');
    if ((items.atkBoost ?? 0) > 0) menu.push('공격 보정기');
    if ((items.defBoost ?? 0) > 0) menu.push('방어 보정기');

    if (menu.length === 0) {
      UI.error('사용 가능한 아이템이 없습니다');
      return;
    }

    const pick = prompt(`사용할 아이템을 입력하세요:\n${menu.join(', ')}`);
    if (!pick) return;

    if (pick === '디터니') {
      const allies = this.getAllies().filter(p => p.alive !== false);
      if (allies.length === 0) {
        UI.error('회복 대상이 없습니다');
        return;
      }
      window.PyxisTarget.show('회복 대상 선택', allies, (t) => {
        this.sendAction('useItem', { item: '디터니', targetPid: t.id });
      });
    } else if (pick === '공격 보정기' || pick === '방어 보정기') {
      this.sendAction('useItem', { item: pick, targetPid: this.myPlayerId });
    } else {
      UI.error('알 수 없는 아이템입니다.');
    }
  }

  getEnemies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    return Object.values(this.battleState.players).filter(p => {
      return this.normalizeTeamName(p.team) !== this.normalizeTeamName(this.myPlayerData.team) && p.alive !== false;
    });
  }

  getAllies() {
    if (!this.battleState?.players || !this.myPlayerData) return [];
    return Object.values(this.battleState.players).filter(p => {
      return this.normalizeTeamName(p.team) === this.normalizeTeamName(this.myPlayerData.team) && p.alive !== false;
    });
  }

  handleActionFX(result) {
    if (!result) return;
    const tpid = result.targetPid || result.target || result.pid;
    const targetEl =
      document.querySelector(`.unit[data-player-id="${tpid}"]`) ||
      document.querySelector(`.player-card[data-player-id="${tpid}"]`) ||
      this.playerInfo;

    if (result.type === 'attack') {
      if (result.dodge) {
        PyxisFX.showDodge(targetEl);
        this.addCombatText(targetEl, '회피', 'var(--text-dim)');
      } else {
        PyxisFX.showHit(targetEl, result.damage || 0, { crit: !!result.crit, blocked: !!result.block });
        const color = result.crit ? 'var(--warning)' : (result.block ? 'var(--info)' : 'var(--danger)');
        const text  = result.crit ? `${result.damage} 치명타!`
                    : result.block ? `${result.damage} 막음` : `${result.damage}`;
        this.addCombatText(targetEl, text, color);
        if ((result.damage || 0) > 15) this.addScreenShake();
      }
    } else if (result.type === 'useItem') {
      if (result.item === '디터니') {
        PyxisFX.showHeal(targetEl, result.healed || 10);
        this.addCombatText(targetEl, `+${result.healed || 10} HP`, 'var(--success)');
      } else {
        PyxisFX.sparkAt(targetEl, { ring: true });
        this.addCombatText(targetEl, `${result.item} 사용`, 'var(--warning)');
      }
    } else if (result.type === 'defend') {
      PyxisFX.sparkAt(targetEl, { ring: true });
      this.addCombatText(targetEl, '방어 태세', 'var(--info)');
    } else if (result.type === 'evade') {
      PyxisFX.showDodge(targetEl);
      this.addCombatText(targetEl, '회피 태세', 'var(--success)');
    }
  }

  addCombatText(element, text, color) {
    if (!element) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      position:absolute; top:50%; left:50%; transform: translate(-50%,-50%);
      color:${color}; font-size:1.5rem; font-weight:700; z-index:1000; pointer-events:none;
      text-shadow: 0 0 10px ${color}; animation: combatTextFloat 2s ease-out forwards;
    `;
    element.style.position = 'relative';
    element.appendChild(el);

    if (!document.getElementById('combat-text-style')) {
      const style = document.createElement('style');
      style.id = 'combat-text-style';
      style.textContent = `
        @keyframes combatTextFloat {
          0% { transform: translate(-50%,-50%) scale(0); opacity:0 }
          20%{ transform: translate(-50%,-50%) scale(1.2); opacity:1 }
          100%{transform: translate(-50%,-200%) scale(1);   opacity:0 }
        }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => el.remove(), 2000);
  }

  addPhaseChangeEffect(teamName) {
    const announcement = document.createElement('div');
    announcement.textContent = `${teamName}의 턴!`;
    announcement.style.cssText = `
      position:fixed; top:30%; left:50%; transform: translate(-50%,-50%);
      font-family: var(--font-display); font-size:3rem; font-weight:700;
      color: var(--gold-bright); text-shadow: 0 0 20px rgba(220,199,162,.8);
      z-index:10000; pointer-events:none; animation: phaseAnnouncement 2s ease-out;
    `;
    document.body.appendChild(announcement);

    if (!document.getElementById('phase-announcement-style')) {
      const style = document.createElement('style');
      style.id = 'phase-announcement-style';
      style.textContent = `
        @keyframes phaseAnnouncement {
          0% { transform: translate(-50%,-50%) scale(0) rotate(-10deg); opacity:0 }
          20%{ transform: translate(-50%,-50%) scale(1.2) rotate(0);     opacity:1 }
          80%{ transform: translate(-50%,-50%) scale(1)   rotate(0);     opacity:1 }
          100%{transform: translate(-50%,-50%) scale(.8)  rotate(0);     opacity:0 }
        }
      `;
      document.head.appendChild(style);
    }
    setTimeout(() => announcement.remove(), 2000);
  }

  addScreenShake() {
    const id = 'screen-shake-style';
    if (!document.getElementById(id)) {
      const shake = document.createElement('style');
      shake.id = id;
      shake.textContent = `
        @keyframes screenShake {
          0%,100%{ transform: translateX(0) }
          10%{ transform: translateX(-5px) }
          20%{ transform: translateX(5px) }
          30%{ transform: translateX(-3px) }
          40%{ transform: translateX(3px) }
          50%{ transform: translateX(-2px) }
          60%{ transform: translateX(2px) }
          70%{ transform: translateX(-1px) }
          80%{ transform: translateX(1px) }
          90%{ transform: translateX(0) }
        }
        body.shake { animation: screenShake .5s ease-out }
      `;
      document.head.appendChild(shake);
    }
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 500);
  }

  /* ========================= Chat ========================= */

  sendChat() {
    const msg = this.chatInput?.value?.trim();
    if (!msg || !this.currentBattleId) return;

    let scope = 'all', text = msg;
    if (msg.startsWith('/t ')) {
      scope = 'team';
      text = msg.slice(3).trim();
    }
    PyxisSocket.sendChat({
      battleId: this.currentBattleId,
      text,
      nickname: this.myPlayerData?.name || '플레이어',
      role: 'player',
      scope
    });
    this.chatInput.value = '';
    this.chatInput.style.borderColor = 'var(--success)';
    setTimeout(() => { this.chatInput.style.borderColor = ''; }, 300);
  }

  /* ========================= Cleanup ========================= */

  cleanup() {
    document.querySelectorAll('[id$="-style"]').forEach(s => s.remove());
    this.uiAnimations.clear();
    PyxisSocket.cleanup();
  }
}

/* ========================= Mount ========================= */

document.addEventListener('DOMContentLoaded', () => {
  window.player = new PyxisPlayer();
});
