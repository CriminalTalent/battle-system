// packages/battle-server/public/assets/js/pages/spectator.js
// PYXIS Spectator Page - Enhanced Design (No emojis, Korean labels)
// - 이모지 전부 한글로 교체
// - 팀/턴/로그/채팅/응원 이펙트 강화
// - 스타일 중복 주입 방지, DOM/변수 충돌 수정
// - 다양한 서버 이벤트명(state/state:update/battleUpdate/action:success 등) 호환
// - 공용 유틸/소켓/FX 폴백 제공(프로덕션 환경에서는 프로젝트 제공 객체가 우선 사용됨)

(function () {
  'use strict';

  /* ========================= Safe Fallbacks ========================= */

  const UI = window.UI || {
    $: (sel) => document.querySelector(sel),
    show: (el) => { if (el) el.style.display = ''; },
    hide: (el) => { if (el) el.style.display = 'none'; },
    info: (msg) => console.info(msg),
    warning: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
    success: (msg) => console.log(msg),
    escape: (s) => String(s || '').replace(/[&<>"']/g, (m) =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])),
  };

  const PyxisSocket = window.PyxisSocket || {
    socket: null,
    _listeners: {},
    init() { this.socket = { connected: true, emit: () => {} }; this._emit('connection:success'); },
    on(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
    _emit(ev, data) { (this._listeners[ev] || []).forEach(fn => fn(data)); },
    authenticate: async (payload) => { setTimeout(() => PyxisSocket._emit('authSuccess', { state: demoState(payload?.battleId) }), 80); },
    sendChat: () => {},
    cleanup() { this._listeners = {}; }
  };

  const PyxisFX = window.PyxisFX || {
    mount() {},
  };

  function demoState(battleId) {
    return {
      id: battleId || 'demo',
      status: 'live',
      round: 1,
      turnCount: 1,
      turn: { pending: [] },
      players: {}
    };
  }

  /* ========================= Spectator ========================= */

  class PyxisSpectator {
    constructor() {
      this.battleId = null;
      this.battleState = null;
      this.isAuthenticated = false;
      this.spectatorName = '';
      this.phoenixPlayers = [];
      this.eatersPlayers = [];
      this.lastUpdateTime = Date.now();
      this.battleTimer = null;
      this.uiAnimations = new Map();
      this.cheerCooldown = false;

      this.init();
    }

    /* ========================= Boot ========================= */

    init() {
      this.setupElements();
      this.createChatInterface();      // 채팅 UI 먼저 구성
      this.setupEventListeners();
      this.setupSocketEvents();
      this.initializeDesignEnhancements();
      this.checkUrlParams();

      if (PyxisSocket.init) PyxisSocket.init();
      if (PyxisFX.mount) PyxisFX.mount();
    }

    setupElements() {
      // 연결 상태
      this.connectionDot  = UI.$('#connectionDot');
      this.connectionText = UI.$('#connectionText');

      // 인증 요소
      this.loginForm            = UI.$('#loginForm');
      this.spectatorLoginForm   = UI.$('#spectatorLoginForm');
      this.spectatorNameInput   = UI.$('#spectatorName');

      // 관전 화면
      this.spectatorArea = UI.$('#spectatorArea');
      this.battlePhase   = UI.$('#battlePhase');
      this.battleInfo    = UI.$('#battleInfo');
      this.currentTurn   = UI.$('#currentTurn');

      // 팀 표시
      this.phoenixMembers = UI.$('#phoenixMembers');
      this.deathMembers   = UI.$('#deathMembers');

      // 응원 버튼
      this.cheerButtons = Array.from(document.querySelectorAll('.cheer-btn'));

      // 로그
      this.battleLog = UI.$('#battleLog');

      // 채팅 참조는 createChatInterface에서 설정
      this.chatMessages = null;
      this.chatInput    = null;
      this.chatSend     = null;
    }

    /* ========================= UI Enhancements ========================= */

    initializeDesignEnhancements() {
      this.addPageFadeIn();
      this.addSpectatorStarField();
      this.enhanceButtonEffects();
      this.addCardEffects();
      this.setupTypingEffects();
      this.customizeScrollbars();
    }

    addPageFadeIn() {
      if (!document.body) return;
      document.body.style.opacity = '0';
      document.body.style.transition = 'opacity 1s ease-out';
      setTimeout(() => { document.body.style.opacity = '1'; }, 100);
    }

    addSpectatorStarField() {
      const starField = document.createElement('div');
      starField.className = 'spectator-star-field';
      starField.style.cssText = `
        position: fixed; inset: 0;
        pointer-events: none; z-index: -1; overflow: hidden;
      `;
      for (let i = 0; i < 75; i++) {
        const star = document.createElement('div');
        const size = (Math.random() * 3 + 1).toFixed(1);
        const blur = Math.random() * 8 + 4;
        const dur  = (2 + Math.random() * 4).toFixed(2);
        const opac = (Math.random() * 0.8 + 0.2).toFixed(2);
        star.className = 'spectator-star';
        star.style.cssText = `
          position:absolute; width:${size}px; height:${size}px;
          background: var(--gold-bright); border-radius:50%;
          left:${Math.random()*100}%; top:${Math.random()*100}%;
          animation: spectatorTwinkle ${dur}s infinite;
          box-shadow: 0 0 ${blur}px var(--gold-bright);
          opacity:${opac};
        `;
        starField.appendChild(star);
      }
      document.body.appendChild(starField);

      // 키프레임 일괄 주입(중복 방지)
      this.injectStyleOnce('spectator-anim-style', `
        @keyframes spectatorTwinkle {
          0%, 100% { opacity:.2; transform: scale(1) }
          25%      { opacity:.8; transform: scale(1.3) }
          75%      { opacity:.4; transform: scale(.8) }
        }
        @keyframes phaseAnnouncement {
          0%   { transform: translate(-50%,-50%) scale(0) rotate(-10deg); opacity:0 }
          20%  { transform: translate(-50%,-50%) scale(1.1) rotate(5deg);  opacity:1 }
          80%  { transform: translate(-50%,-50%) scale(1)   rotate(0);     opacity:1 }
          100% { transform: translate(-50%,-50%) scale(.9)  rotate(0);     opacity:0 }
        }
        @keyframes phaseBackground {
          0%   { opacity:0; transform: scale(0) }
          50%  { opacity:1; transform: scale(1) }
          100% { opacity:0; transform: scale(1.5) }
        }
        @keyframes turnAnnouncement {
          0%   { transform: translate(-50%,-50%) scale(0); opacity:0 }
          30%  { transform: translate(-50%,-50%) scale(1.1); opacity:1 }
          70%  { transform: translate(-50%,-50%) scale(1);   opacity:1 }
          100% { transform: translate(-50%,-50%) scale(.8);  opacity:0 }
        }
      `);
    }

    enhanceButtonEffects() {
      // 응원 버튼 특화
      this.cheerButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.createRippleEffect(e, btn);
          this.addCheerParticleEffect(btn);
        });
        btn.addEventListener('mouseenter', () => {
          btn.style.transform = 'translateY(-3px) scale(1.05)';
          btn.style.boxShadow = '0 8px 25px rgba(220,199,162,.4)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.transform = '';
          btn.style.boxShadow = '';
        });
      });

      // 일반 버튼 리플
      document.querySelectorAll('button:not(.cheer-btn)').forEach(btn => {
        btn.addEventListener('click', (e) => this.createRippleEffect(e, btn));
      });

      this.injectStyleOnce('spectator-ripple-style', `
        @keyframes spectatorRipple { from { transform: scale(0); opacity:1 } to { transform: scale(4); opacity:0 } }
        @keyframes cheerParticle  { 0% { transform: translate(0,0) scale(1); opacity:1 } 100% { transform: translate(var(--end-x),var(--end-y)) scale(0); opacity:0 } }
      `);
    }

    createRippleEffect(e, element) {
      if (!element) return;
      const ripple = document.createElement('span');
      const rect = element.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top  - size / 2;
      ripple.style.cssText = `
        position:absolute; width:${size}px; height:${size}px; left:${x}px; top:${y}px;
        background: radial-gradient(circle, rgba(220,199,162,.4) 0%, transparent 70%);
        border-radius:50%; pointer-events:none; animation: spectatorRipple .8s ease-out;
      `;
      element.style.position = 'relative';
      element.style.overflow = 'hidden';
      element.appendChild(ripple);
      setTimeout(() => ripple.remove(), 800);
    }

    addCheerParticleEffect(button) {
      const rect = button.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top  + rect.height/2;
      for (let i=0;i<8;i++){
        const particle = document.createElement('div');
        const angle = (Math.PI * 2 * i) / 8;
        const distance = 50 + Math.random()*30;
        particle.style.cssText = `
          position:fixed; left:${cx}px; top:${cy}px; width:6px; height:6px;
          background: var(--gold-bright); border-radius:50%; pointer-events:none; z-index:1000;
          animation: cheerParticle 1.5s ease-out forwards;
        `;
        particle.style.setProperty('--end-x', `${Math.cos(angle)*distance}px`);
        particle.style.setProperty('--end-y', `${Math.sin(angle)*distance}px`);
        document.body.appendChild(particle);
        setTimeout(()=>particle.remove(),1500);
      }
    }

    addCardEffects() {
      const cards = document.querySelectorAll('.team-wrap, .cheer-section, .log-section, .battle-meta');
      cards.forEach(card => {
        card.style.transition = 'transform .3s ease, box-shadow .3s ease';
        card.addEventListener('mouseenter', () => {
          card.style.transform = 'translateY(-2px)';
          card.style.boxShadow = '0 8px 25px rgba(0,0,0,.3), 0 0 15px rgba(220,199,162,.2)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.transform = '';
          card.style.boxShadow = '';
        });
      });
    }

    setupTypingEffects() {
      this.typewriterQueue = [];
      this.isTyping = false;
    }

    customizeScrollbars() {
      this.injectStyleOnce('spectator-scrollbar-style', `
        .spectator-container ::-webkit-scrollbar{ width:8px; height:8px }
        .spectator-container ::-webkit-scrollbar-track{ background:var(--surface-1); border-radius:4px }
        .spectator-container ::-webkit-scrollbar-thumb{
          background: linear-gradient(45deg, var(--gold-bright), var(--gold-warm));
          border-radius:4px; box-shadow: 0 0 5px rgba(220,199,162,.3)
        }
        .spectator-container ::-webkit-scrollbar-thumb:hover{
          background: linear-gradient(45deg, var(--gold-warm), var(--gold-bright));
          box-shadow: 0 0 10px rgba(220,199,162,.5)
        }
      `);
    }

    /* ========================= Chat UI (Tabs) ========================= */

    createChatInterface() {
      const logSection = document.querySelector('.log-section');
      if (!logSection) return;

      // 로그 영역 존재 안 하면 생성
      this.battleLog = this.battleLog || (() => {
        const div = document.createElement('div');
        div.id = 'battleLog';
        div.className = 'battle-log';
        logSection.appendChild(div);
        return div;
      })();

      // 탭 버튼
      const tabContainer = document.createElement('div');
      tabContainer.className = 'log-tabs';
      tabContainer.innerHTML = `
        <button class="log-tab active" data-tab="log">전투 로그</button>
        <button class="log-tab" data-tab="chat">채팅</button>
      `;
      logSection.insertBefore(tabContainer, this.battleLog);

      // 채팅 컨테이너
      const chatContainer = document.createElement('div');
      chatContainer.id = 'chatContainer';
      chatContainer.className = 'chat-container';
      chatContainer.style.display = 'none';
      chatContainer.innerHTML = `
        <div id="chatMessages" class="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chatInput" placeholder="메시지 입력... (Enter로 전송)" maxlength="200">
          <button id="chatSend" class="chat-send-btn">전송</button>
        </div>
      `;
      logSection.appendChild(chatContainer);

      // 참조
      this.chatMessages = UI.$('#chatMessages');
      this.chatInput    = UI.$('#chatInput');
      this.chatSend     = UI.$('#chatSend');

      // 탭 이벤트
      document.querySelectorAll('.log-tab').forEach(tab=>{
        tab.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab));
      });

      // 채팅 이벤트
      this.chatSend?.addEventListener('click', () => this.sendChat());
      this.chatInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.sendChat(); });

      // 새 메시지 탭 효과
      this.injectStyleOnce('new-message-pulse-style', `
        @keyframes newMessagePulse {
          0%,100%{ transform: scale(1); box-shadow:none }
          50%    { transform: scale(1.1); box-shadow: 0 0 15px rgba(220,199,162,.5) }
        }
      `);
    }

    switchTab(tabName) {
      document.querySelectorAll('.log-tab').forEach(tab=>{
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });
      const chatWrap = UI.$('#chatContainer');
      if (!this.battleLog || !chatWrap) return;

      if (tabName === 'log') {
        this.battleLog.style.display = 'block';
        chatWrap.style.display = 'none';
      } else {
        this.battleLog.style.display = 'none';
        chatWrap.style.display = 'block';
      }
    }

    /* ========================= Events ========================= */

    setupEventListeners() {
      // 인증 폼
      this.spectatorLoginForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.authenticate();
      });

      // 응원 버튼 -> 메시지 전송
      this.cheerButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const cheerMsg = btn.dataset.cheer || '응원합니다';
          this.sendCheer(cheerMsg);
        });
      });

      // 단축키
      document.addEventListener('keydown', (e) => {
        const tag = (e.target?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        switch (e.key) {
          case '1': e.preventDefault(); this.switchTab('log');  break;
          case '2': e.preventDefault(); this.switchTab('chat'); break;
          case 'Enter':
            if (!['chatInput','spectatorName'].includes(e.target?.id)) this.chatInput?.focus();
            break;
          case 'Escape': this.chatInput?.blur(); break;
          case 'c':
            if (e.ctrlKey) return;
            e.preventDefault();
            this.cheerButtons[0]?.click();
            break;
        }
      });

      // 페이지 재진입 시 동기화
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.isAuthenticated && this.battleId) {
          PyxisSocket.socket?.emit?.('requestState', { battleId: this.battleId });
        }
      });

      // 언로드 정리
      window.addEventListener('beforeunload', () => this.cleanup());
    }

    setupSocketEvents() {
      // 연결
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
        this.addErrorShake();
      });

      // 상태 업데이트
      const onState = (s) => this.handleStateUpdate(s);
      PyxisSocket.on('state', onState);
      PyxisSocket.on('state:update', onState);
      PyxisSocket.on('battleUpdate', onState);

      // 페이즈
      PyxisSocket.on('phase:change', (phase) => {
        const teamName = this.normalizeTeamName(phase?.phase) === 'A' ? '불사조 기사단' : '죽음을 먹는 자들';
        this.addPhaseChangeAnnouncement(teamName, phase?.round);
        this.addLogEntry(`[턴 전환] ${teamName} 턴 시작 (라운드 ${phase?.round ?? '-'})`, 'system');
      });

      // 액션 결과
      const onAction = (r) => this.handleActionResult(r);
      PyxisSocket.on('action:success', onAction);
      PyxisSocket.on('actionSuccess',  onAction);

      // 전투 종료
      PyxisSocket.on('battle:end', (result) => this.handleBattleEnd(result));

      // 로그 & 채팅
      PyxisSocket.on('log:new',  (ev) => ev?.text && this.addLogEntry(ev.text, ev.type || 'action'));
      PyxisSocket.on('chat:new', (msg) => this.renderChatMessage(msg));

      // 응원 수신
      PyxisSocket.on('cheer:new', (msg) => this.showCheerMessage(msg));
    }

    addConnectionPulse(connected) {
      const pulse = document.createElement('div');
      pulse.style.cssText = `
        position:absolute; width:20px; height:20px; border-radius:50%;
        top:50%; left:50%; transform: translate(-50%,-50%);
        background:${connected ? 'var(--success)' : 'var(--danger)'};
        animation: connectionPulse 1.5s ease-out; pointer-events:none;
      `;
      if (!this.connectionDot) return;
      this.connectionDot.style.position = 'relative';
      this.connectionDot.appendChild(pulse);
      this.injectStyleOnce('connection-pulse-style', `
        @keyframes connectionPulse {
          0% { transform: translate(-50%,-50%) scale(1); opacity:.8 }
          100%{ transform: translate(-50%,-50%) scale(3); opacity:0 }
        }
      `);
      setTimeout(() => pulse.remove(), 1500);
    }

    addErrorShake() {
      if (!this.loginForm) return;
      this.loginForm.style.animation = 'errorShake .5s ease-out';
      this.injectStyleOnce('error-shake-style', `
        @keyframes errorShake {
          0%,100%{ transform: translateX(0) }
          20%    { transform: translateX(-10px) }
          40%    { transform: translateX(10px) }
          60%    { transform: translateX(-5px) }
          80%    { transform: translateX(5px) }
        }
      `);
      setTimeout(() => { this.loginForm.style.animation = ''; }, 500);
    }

    /* ========================= URL / Auth ========================= */

    checkUrlParams() {
      const params = new URLSearchParams(location.search);
      const battleId  = params.get('battle');
      const spectatorOtp = params.get('otp') || params.get('token');
      if (battleId && spectatorOtp) {
        this.battleId = battleId;
        PyxisSocket.on('connection:success', () => {
          setTimeout(() => {
            if (this.spectatorNameInput?.value) this.authenticate();
          }, 300);
        });
      }
    }

    async authenticate() {
      const name = (this.spectatorNameInput?.value || '').trim();
      if (!name) {
        UI.error('관전자 이름을 입력해주세요');
        this.addErrorShake();
        return;
      }
      if (name.length > 20) {
        UI.error('이름은 20글자 이하로 입력해주세요');
        this.addErrorShake();
        return;
      }
      try {
        const params = new URLSearchParams(location.search);
        const battleId = params.get('battle') || 'demo';
        const otp      = params.get('otp') || params.get('token') || 'spectator';

        await PyxisSocket.authenticate({
          role: 'spectator',
          battleId, name, otp
        });

        this.battleId = battleId;
        this.spectatorName = name;
      } catch (e) {
        UI.error(`인증 실패: ${e.message}`);
        this.addErrorShake();
      }
    }

    handleAuthSuccess(data) {
      this.isAuthenticated = true;
      this.battleState = data?.state || data?.battle || null;

      UI.hide(this.loginForm);
      UI.show(this.spectatorArea);

      this.addSuccessEffect();
      UI.success(`${this.spectatorName}님, 관전을 시작합니다`);

      this.renderBattleState();
      this.startBattleTimer();
    }

    addSuccessEffect() {
      const effect = document.createElement('div');
      effect.style.cssText = `
        position:fixed; inset:0;
        background: radial-gradient(circle, rgba(34,197,94,.3) 0%, transparent 70%);
        pointer-events:none; z-index:9999; animation: successWave 1.5s ease-out;
      `;
      this.injectStyleOnce('success-wave-style', `
        @keyframes successWave {
          0%{ opacity:0; transform: scale(0) }
          50%{opacity:1; transform: scale(1) }
          100%{opacity:0; transform: scale(1.5) }
        }
      `);
      document.body.appendChild(effect);
      setTimeout(()=>effect.remove(),1500);
    }

    /* ========================= Normalizers ========================= */

    normalizeTeamName(teamVal) {
      const t = (teamVal || '').toString().toLowerCase().trim();
      if (['a','team1','phoenix','불사조','불사조 기사단','phoenixes'].includes(t)) return 'A';
      if (['b','team2','death','죽음','죽음을 먹는 자들','death eaters','deatheaters'].includes(t)) return 'B';
      if (t.includes('phoenix') || t.includes('불사조')) return 'A';
      if (t.includes('death')   || t.includes('죽음'))   return 'B';
      return 'A';
    }

    /* ========================= State & Rendering ========================= */

    handleStateUpdate(state) {
      this.battleState = state;
      this.lastUpdateTime = Date.now();
      this.renderBattleState();
    }

    renderBattleState() {
      if (!this.battleState) return;
      this.updateBattleInfo();
      this.updateTeamMembers();
      this.updateCurrentTurn();
    }

    updateBattleInfo() {
      const phase = this.battleState.phase || this.battleState.status || 'waiting';
      const round = this.battleState.round || 1;
      const turnCount = this.battleState.turnCount || 0;

      const phaseText = {
        waiting: '전투 대기중',
        active:  '전투 진행중',
        live:    '전투 진행중',
        ended:   '전투 종료',
        end:     '전투 종료'
      };

      if (this.battlePhase) {
        this.battlePhase.textContent = phaseText[phase] || '알 수 없음';
        this.battlePhase.className = `battle-phase phase-${phase}`;
      }
      if (this.battleInfo) {
        this.battleInfo.textContent = `라운드 ${round} | 턴 ${turnCount}`;
      }
    }

    updateTeamMembers() {
      if (!this.battleState?.players) return;

      this.phoenixPlayers = [];
      this.eatersPlayers  = [];

      Object.values(this.battleState.players).forEach(p => {
        const code = this.normalizeTeamName(p.team);
        if (code === 'A') this.phoenixPlayers.push(p);
        else this.eatersPlayers.push(p);
      });

      this.renderTeam(this.phoenixMembers, this.phoenixPlayers);
      this.renderTeam(this.deathMembers,   this.eatersPlayers);
    }

    renderTeam(container, players) {
      if (!container) return;
      container.innerHTML = '';
      players.forEach((player, idx) => {
        const card = document.createElement('div');
        card.className = `spectator-player-card ${player.alive === false ? 'dead' : 'alive'}`;

        const maxHp = player.maxHp || 100;
        const hp = Math.max(0, Math.min(maxHp, player.hp ?? maxHp));
        const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
        const statusClass = hpPercent > 60 ? 'healthy' : hpPercent > 30 ? 'wounded' : 'critical';

        const atk = player.stats?.attack  ?? player.atk ?? 0;
        const def = player.stats?.defense ?? player.def ?? 0;
        const agi = player.stats?.agility ?? player.agi ?? 0;
        const luk = player.stats?.luck    ?? player.luk ?? 0;

        card.innerHTML = `
          <div class="player-avatar">${player.avatar ? `<img src="${player.avatar}" alt="${UI.escape(player.name||'플레이어')}">` : '<span class="avatar-fallback">플</span>'}</div>
          <div class="player-info">
            <div class="player-name">${UI.escape(player.name || '플레이어')}</div>
            <div class="player-hp ${statusClass}">
              <div class="hp-bar"><div class="hp-fill" style="width:${hpPercent}%"></div></div>
              <div class="hp-text">${hp}/${maxHp}</div>
            </div>
            <div class="player-stats">
              <span>공격 ${atk}</span>
              <span>방어 ${def}</span>
              <span>민첩 ${agi}</span>
              <span>행운 ${luk}</span>
            </div>
          </div>
        `;

        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        container.appendChild(card);
        setTimeout(() => {
          card.style.transition = 'opacity .5s ease, transform .5s ease';
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        }, idx * 100);
      });
    }

    updateCurrentTurn() {
      const curPid = this.battleState?.turn?.pending?.[0] || this.battleState?.turn?.actor;
      if (curPid && this.battleState?.players?.[curPid]) {
        const player = this.battleState.players[curPid];
        if (this.currentTurn) {
          this.currentTurn.textContent = `현재 턴: ${player.name}`;
          this.currentTurn.className = 'current-turn active';
        }
        this.addTurnChangeEffect(player.name);
      } else {
        if (this.currentTurn) {
          this.currentTurn.textContent = '현재 턴: 대기중';
          this.currentTurn.className = 'current-turn';
        }
      }
    }

    addTurnChangeEffect(playerName) {
      if (!playerName) return;
      const el = document.createElement('div');
      el.textContent = `${playerName}의 턴`;
      el.style.cssText = `
        position:fixed; top:20%; left:50%; transform: translate(-50%,-50%);
        font-family: var(--font-display); font-size:2.5rem; font-weight:700;
        color: var(--gold-bright); text-shadow: 0 0 20px rgba(220,199,162,.8);
        z-index:10000; pointer-events:none; animation: turnAnnouncement 2s ease-out;
      `;
      document.body.appendChild(el);
      setTimeout(()=>el.remove(),2000);
    }

    addPhaseChangeAnnouncement(teamName, round) {
      const announcement = document.createElement('div');
      announcement.textContent = `${teamName} 턴 시작`;
      announcement.style.cssText = `
        position:fixed; top:25%; left:50%; transform: translate(-50%,-50%);
        font-family: var(--font-display); font-size:3rem; font-weight:700;
        color: var(--gold-bright); text-shadow: 0 0 30px rgba(220,199,162,.9);
        z-index:10000; pointer-events:none; animation: phaseAnnouncement 3s ease-out;
      `;
      document.body.appendChild(announcement);

      const bgEffect = document.createElement('div');
      bgEffect.style.cssText = `
        position:fixed; inset:0;
        background: radial-gradient(circle, rgba(220,199,162,.1) 0%, transparent 70%);
        pointer-events:none; z-index:9999; animation: phaseBackground 3s ease-out;
      `;
      document.body.appendChild(bgEffect);

      setTimeout(()=>announcement.remove(),3000);
      setTimeout(()=>bgEffect.remove(),3000);
    }

    /* ========================= Actions & Effects ========================= */

    handleActionResult(result) {
      if (!result) return;
      this.showActionEffect(result);

      const logText = this.formatActionResult(result);
      if (logText) this.addLogEntry(logText, 'action');
    }

    showActionEffect(result) {
      const box = document.createElement('div');
      box.className = 'action-effect-container';
      box.style.cssText = `
        position:fixed; top:50%; left:50%; transform: translate(-50%,-50%);
        z-index:9999; pointer-events:none; text-align:center;
      `;

      let text = '';
      let color = 'var(--text-bright)';

      switch (result.type) {
        case 'attack':
          if (result.dodge) {
            text = '회피 성공';
            color = 'var(--text-dim)';
          } else {
            text = result.crit ? `${result.damage} 치명타` : `${result.damage} 피해`;
            color = result.crit ? 'var(--warning)' : 'var(--danger)';
          }
          break;
        case 'useItem':
          if (result.item === '디터니') {
            text = `체력 +${result.healed || 10}`;
            color = 'var(--success)';
          } else {
            text = `${result.item} 사용`;
            color = 'var(--warning)';
          }
          break;
        case 'defend':
          text = '방어 태세';
          color = 'var(--info)';
          break;
        case 'evade':
          text = '회피 태세';
          color = 'var(--success)';
          break;
        default:
          text = '행동 수행';
          color = 'var(--text-bright)';
      }

      box.innerHTML = `
        <div style="
          font-size:2.2rem; font-weight:700; color:${color};
          text-shadow:0 0 20px ${color}; animation: actionEffectMain 2s ease-out;
        ">${text}</div>
      `;
      document.body.appendChild(box);

      this.injectStyleOnce('action-effect-style', `
        @keyframes actionEffectMain {
          0%  { transform: scale(0) rotate(-10deg); opacity:0 }
          20% { transform: scale(1.3) rotate(5deg);  opacity:1 }
          80% { transform: scale(1) rotate(0);       opacity:1 }
          100%{ transform: scale(.8) rotate(0);      opacity:0 }
        }
        @keyframes screenFlash {
          0%{ opacity:.5 } 50%{ opacity:.2 } 100%{ opacity:0 }
        }
      `);

      setTimeout(()=>box.remove(),2000);

      if (result.type === 'attack' && (result.damage > 15 || result.crit)) {
        this.addScreenFlash(result.crit ? 'var(--warning)' : 'var(--danger)');
      }
    }

    addScreenFlash(color) {
      const flash = document.createElement('div');
      flash.style.cssText = `
        position:fixed; inset:0; background:${color};
        opacity:.3; pointer-events:none; z-index:9998; animation: screenFlash .5s ease-out;
      `;
      document.body.appendChild(flash);
      setTimeout(()=>flash.remove(),500);
    }

    formatActionResult(result) {
      const actor  = this.battleState?.players?.[result.actorPid];
      const target = this.battleState?.players?.[result.targetPid];
      if (!actor) return null;

      const a = actor.name;
      const t = target?.name || '대상';

      switch (result.type) {
        case 'attack':
          if (result.dodge) return `${a}의 공격을 ${t}이(가) 회피했습니다`;
          return `${a}이(가) ${t}에게 ${result.damage} 피해를 입혔습니다`
                 + (result.crit ? ' (치명타)' : '')
                 + (result.block ? ' (일부 방어됨)' : '');
        case 'useItem':
          if (result.item === '디터니') return `${a}이(가) ${t}의 체력을 ${result.healed || 10} 회복시켰습니다`;
          return `${a}이(가) ${result.item}을(를) 사용했습니다`;
        case 'defend': return `${a}이(가) 방어 태세를 취했습니다`;
        case 'evade':  return `${a}이(가) 회피 태세를 취했습니다`;
        case 'pass':   return `${a}이(가) 턴을 넘겼습니다`;
        default:       return `${a}이(가) ${result.type} 행동을 수행했습니다`;
      }
    }

    handleBattleEnd(result) {
      this.addBattleEndEffect(result || {});
      this.addLogEntry(`[전투 종료] ${(result && result.winner) || '승리 팀'} 승리`, 'system');

      this.cheerButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
      });
    }

    addBattleEndEffect(result) {
      const wrap = document.createElement('div');
      wrap.style.cssText = `
        position:fixed; inset:0;
        background: linear-gradient(135deg, rgba(0,8,13,.9), rgba(0,30,53,.9));
        display:flex; flex-direction:column; justify-content:center; align-items:center;
        z-index:10000; animation: battleEndFadeIn 1s ease-out;
      `;
      wrap.innerHTML = `
        <div style="
          font-family: var(--font-display); font-size:4rem; font-weight:700;
          color: var(--gold-bright); text-shadow: 0 0 30px rgba(220,199,162,.8);
          margin-bottom:2rem; animation: battleEndTitle 2s ease-out;
        ">전투 종료</div>
        <div style="
          font-size:2.2rem; font-weight:600; color: var(--text-bright);
          margin-bottom:3rem; animation: battleEndWinner 2s ease-out .5s both;
        ">${UI.escape(result.winner || '승리 팀')} 승리</div>
        <div style="display:flex; gap:2rem; animation: battleEndButtons 2s ease-out 1s both;">
          <button id="btnEndReload" style="
            padding:1rem 2rem; background: linear-gradient(135deg, var(--gold-bright), var(--gold-warm));
            color: var(--deep-navy); border:none; border-radius:8px; font-size:1.1rem; font-weight:700; cursor:pointer; transition: transform .3s ease;
          ">새로고침</button>
          <button id="btnEndClose" style="
            padding:1rem 2rem; background: var(--surface-1); color: var(--text-bright);
            border:1px solid var(--border-subtle); border-radius:8px; font-size:1.1rem; font-weight:600; cursor:pointer; transition: transform .3s ease;
          ">닫기</button>
        </div>
      `;
      document.body.appendChild(wrap);

      this.injectStyleOnce('battle-end-style', `
        @keyframes battleEndFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes battleEndTitle {
          0%{ transform: scale(0) rotate(-10deg); opacity:0 }
          50%{transform: scale(1.2) rotate(5deg);  opacity:1 }
          100%{transform: scale(1)   rotate(0);    opacity:1 }
        }
        @keyframes battleEndWinner {
          0%{ transform: translateY(50px); opacity:0 }
          100%{transform: translateY(0);   opacity:1 }
        }
        @keyframes battleEndButtons {
          0%{ transform: translateY(30px); opacity:0 }
          100%{transform: translateY(0);   opacity:1 }
        }
      `);

      wrap.querySelector('#btnEndReload')?.addEventListener('mouseover', e => e.currentTarget.style.transform = 'scale(1.07)');
      wrap.querySelector('#btnEndReload')?.addEventListener('mouseout',  e => e.currentTarget.style.transform = '');
      wrap.querySelector('#btnEndClose') ?.addEventListener('mouseover', e => e.currentTarget.style.transform = 'scale(1.07)');
      wrap.querySelector('#btnEndClose') ?.addEventListener('mouseout',  e => e.currentTarget.style.transform = '');
      wrap.querySelector('#btnEndReload')?.addEventListener('click', () => location.reload());
      wrap.querySelector('#btnEndClose') ?.addEventListener('click', () => window.close());
    }

    /* ========================= Log & Chat ========================= */

    addLogEntry(text, type='info') {
      if (!this.battleLog) return;

      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;

      const ts = new Date().toLocaleTimeString('ko-KR', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });

      entry.innerHTML = `
        <span class="log-time">${ts}</span>
        <span class="log-content">${UI.escape(text)}</span>
      `;

      const cfg = {
        system: { label: '[시스템]', color:'var(--info)' },
        action: { label: '[행동]',   color:'var(--text-normal)' },
        damage: { label: '[피해]',   color:'var(--danger)' },
        heal:   { label: '[치유]',   color:'var(--success)' },
        info:   { label: '[정보]',   color:'var(--text-dim)' }
      }[type] || { label: '[정보]', color:'var(--text-dim)' };

      entry.style.borderLeft = `3px solid ${cfg.color}`;
      const label = document.createElement('span');
      label.textContent = cfg.label + ' ';
      label.style.marginRight = '0.5rem';
      label.style.color = cfg.color;
      entry.querySelector('.log-content').prepend(label);

      entry.style.opacity = '0';
      entry.style.transform = 'translateX(-20px)';
      this.battleLog.appendChild(entry);
      setTimeout(() => {
        entry.style.transition = 'opacity .5s ease, transform .5s ease';
        entry.style.opacity = '1';
        entry.style.transform = 'translateX(0)';
      }, 10);

      this.battleLog.scrollTop = this.battleLog.scrollHeight;
      while (this.battleLog.children.length > 150) this.battleLog.removeChild(this.battleLog.firstChild);
    }

    renderChatMessage(message) {
      if (!this.chatMessages) return;

      const row = document.createElement('div');
      row.className = `chat-message ${message?.type || (message?.scope === 'team' ? 'team' : '')}`;

      const ts = new Date(message?.ts || Date.now()).toLocaleTimeString('ko-KR', { hour12:false, hour:'2-digit', minute:'2-digit' });
      const sender = message?.from?.nickname || message?.nickname || '익명';
      const scope  = message?.scope === 'team' ? '[팀]' : '[전체]';

      row.innerHTML = `
        <div class="chat-header">
          <span class="chat-sender">${scope} ${UI.escape(sender)}</span>
          <span class="chat-time">${ts}</span>
        </div>
        <div class="chat-text">${UI.escape(message?.text || '')}</div>
      `;

      row.style.opacity = '0';
      row.style.transform = 'translateY(20px)';
      this.chatMessages.appendChild(row);

      setTimeout(() => {
        row.style.transition = 'opacity .3s ease, transform .3s ease';
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';
      }, 10);

      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      while (this.chatMessages.children.length > 100) this.chatMessages.removeChild(this.chatMessages.firstChild);

      // 탭 알림
      const chatTab = document.querySelector('[data-tab="chat"]');
      if (chatTab && !chatTab.classList.contains('active')) {
        chatTab.style.animation = 'newMessagePulse 1s ease-out';
        setTimeout(()=> chatTab.style.animation = '', 1000);
      }
    }

    sendChat() {
      if (!this.chatInput || !this.isAuthenticated) return;
      const text = this.chatInput.value.trim();
      if (!text) return;

      PyxisSocket.sendChat({
        battleId: this.battleId,
        text,
        nickname: this.spectatorName,
        role: 'spectator',
        scope: 'all'
      });

      this.chatInput.value = '';
      this.chatInput.style.borderColor = 'var(--success)';
      setTimeout(()=> this.chatInput.style.borderColor = '', 300);
    }

    sendCheer(cheerMessage) {
      if (!this.isAuthenticated || this.cheerCooldown) return;

      // 3초 쿨다운
      this.cheerCooldown = true;
      setTimeout(()=> this.cheerCooldown = false, 3000);

      // 응원 메시지 전송 (이모지 대신 한글 라벨)
      PyxisSocket.sendChat({
        battleId: this.battleId,
        text: `[응원] ${cheerMessage}`,
        nickname: this.spectatorName,
        role: 'spectator',
        scope: 'all',
        type: 'cheer'
      });

      // 버튼 쿨다운 표시
      this.cheerButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
      });
      setTimeout(() => {
        this.cheerButtons.forEach(btn => {
          btn.disabled = false;
          btn.style.opacity = '1';
        });
      }, 3000);
    }

    showCheerMessage(message) {
      const cheer = document.createElement('div');
      cheer.textContent = message?.text || '[응원]';
      cheer.style.cssText = `
        position:fixed; top:70%; left:50%; transform: translate(-50%,-50%);
        font-size:2rem; font-weight:700; color: var(--warning);
        text-shadow: 0 0 15px rgba(245,158,11,.8); z-index:9999; pointer-events:none;
        animation: cheerEffect 3s ease-out;
      `;
      this.injectStyleOnce('cheer-effect-style', `
        @keyframes cheerEffect {
          0%  { transform: translate(-50%,-50%) scale(0);   opacity:0 }
          20% { transform: translate(-50%,-50%) scale(1.2); opacity:1 }
          80% { transform: translate(-50%,-50%) scale(1);   opacity:1 }
          100%{ transform: translate(-50%,-50%) scale(.8);  opacity:0 }
        }
      `);
      document.body.appendChild(cheer);
      setTimeout(()=>cheer.remove(),3000);
    }

    /* ========================= Timer & Cleanup ========================= */

    startBattleTimer() {
      const duration = 60 * 60 * 1000; // 1시간
      const start = Date.now();
      this.battleTimer = setInterval(() => {
        const elapsed = Date.now() - start;
        const remain = Math.max(0, duration - elapsed);
        if (remain === 0) {
          clearInterval(this.battleTimer);
          this.addLogEntry('[시간 종료] 전투 시간이 만료되었습니다', 'system');
          return;
        }
        const el = document.querySelector('.battle-timer');
        if (el) {
          const h = Math.floor(remain / 3600000);
          const m = Math.floor((remain % 3600000) / 60000).toString().padStart(2,'0');
          const s = Math.floor((remain % 60000) / 1000).toString().padStart(2,'0');
          el.textContent = `${h}:${m}:${s}`;
        }
      }, 1000);
    }

    cleanup() {
      if (this.battleTimer) clearInterval(this.battleTimer);
      this.uiAnimations.clear();
      PyxisSocket.cleanup && PyxisSocket.cleanup();
    }

    /* ========================= Helpers ========================= */

    injectStyleOnce(id, css) {
      if (document.getElementById(id)) return;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  /* ========================= Mount ========================= */

  document.addEventListener('DOMContentLoaded', () => {
    try {
      window.spectator = new PyxisSpectator();
    } catch (e) {
      console.error('[PYXIS Spectator] init error:', e);
    }
  });
})();
