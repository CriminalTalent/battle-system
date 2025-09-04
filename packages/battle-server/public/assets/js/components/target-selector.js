// PYXIS Target Selector Component - Enhanced Gaming Edition
// 우아한 천체 테마의 실시간 전투 타겟 선택 시스템
class PyxisTargetSelector {
  constructor(options = {}) {
    this.options = {
      showStats: true,
      showHp: true,
      showTeam: true,
      showAvatar: true,
      allowMultiSelect: false,
      theme: 'default', // default, combat, selection
      battleMode: '2v2',
      enableSoundEffects: false,
      enableAnimations: true,
      ...options
    };

    this.isVisible = false;
    this.targets = [];
    this.selectedTargets = [];
    this.callback = null;
    this.battleData = null;

    // 바인딩
    this._onEscKey = this._onEscKey.bind(this);
    this._onOverlayClick = this._onOverlayClick.bind(this);
    this._onKeyboardNav = this._onKeyboardNav.bind(this);

    this._listenersBound = false;
    this._focusedIndex = 0;

    this.init();
  }

  // 초기화
  init() {
    this.createOverlay();
    this.setupEventListeners();
    this.injectStyles();
  }

  // 스타일 주입
  injectStyles() {
    if (document.getElementById('pyxis-target-selector-enhanced-styles')) return;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'pyxis-target-selector-enhanced-styles';
    styleSheet.textContent = `
      :root {
        --pyxis-deep-navy: #00080D;
        --pyxis-navy-light: #001E35;
        --pyxis-gold-bright: #DCC7A2;
        --pyxis-gold-warm: #D4BA8D;
        --pyxis-border-subtle: rgba(220, 199, 162, 0.2);
        --pyxis-glass-light: rgba(0, 30, 53, 0.8);
        --pyxis-combat-red: #C73E1D;
        --pyxis-success-green: #2D5A27;
        --pyxis-warning-amber: #B8860B;
      }

      .target-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: linear-gradient(
          135deg,
          rgba(0, 8, 13, 0.95) 0%,
          rgba(0, 30, 53, 0.9) 50%,
          rgba(0, 8, 13, 0.95) 100%
        );
        backdrop-filter: blur(12px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        opacity: 0;
        animation: fadeInOverlay 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }

      @keyframes fadeInOverlay {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .target-panel {
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.95) 0%,
          rgba(42, 52, 65, 0.9) 100%
        );
        backdrop-filter: blur(20px);
        border: 2px solid var(--pyxis-border-subtle);
        border-radius: 20px;
        padding: 32px;
        max-width: 90vw;
        max-height: 85vh;
        width: 100%;
        max-width: 900px;
        box-shadow: 
          0 25px 50px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(220, 199, 162, 0.1),
          inset 0 1px 0 rgba(220, 199, 162, 0.2);
        position: relative;
        overflow: hidden;
        transform: scale(0.9) translateY(20px);
        animation: slideInPanel 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @keyframes slideInPanel {
        to {
          transform: scale(1) translateY(0);
        }
      }

      .target-panel::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(
          90deg,
          transparent 0%,
          var(--pyxis-gold-bright) 50%,
          transparent 100%
        );
        opacity: 0.6;
      }

      .target-title {
        font-family: 'Cinzel', serif;
        font-size: clamp(24px, 4vw, 32px);
        font-weight: 600;
        color: var(--pyxis-gold-bright);
        text-align: center;
        margin-bottom: 24px;
        text-shadow: 0 2px 8px rgba(220, 199, 162, 0.3);
        position: relative;
      }

      .target-title::before,
      .target-title::after {
        content: '✦';
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        color: var(--pyxis-gold-warm);
        font-size: 16px;
        animation: twinkle 2s ease-in-out infinite alternate;
      }

      .target-title::before {
        left: -40px;
      }

      .target-title::after {
        right: -40px;
        animation-delay: 1s;
      }

      @keyframes twinkle {
        0% { opacity: 0.4; transform: translateY(-50%) scale(0.8); }
        100% { opacity: 1; transform: translateY(-50%) scale(1.2); }
      }

      .target-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        max-height: 60vh;
        overflow-y: auto;
        padding: 8px;
        margin-bottom: 24px;
        scrollbar-width: thin;
        scrollbar-color: var(--pyxis-gold-warm) transparent;
      }

      .target-list::-webkit-scrollbar {
        width: 8px;
      }

      .target-list::-webkit-scrollbar-track {
        background: rgba(0, 30, 53, 0.3);
        border-radius: 4px;
      }

      .target-list::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, var(--pyxis-gold-bright), var(--pyxis-gold-warm));
        border-radius: 4px;
      }

      .target-card {
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.9) 0%,
          rgba(42, 52, 65, 0.8) 100%
        );
        backdrop-filter: blur(10px);
        border: 1.5px solid var(--pyxis-border-subtle);
        border-radius: 16px;
        padding: 20px;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        transform: translateY(0);
      }

      .target-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent 0%,
          var(--pyxis-gold-bright) 50%,
          transparent 100%
        );
        opacity: 0.3;
      }

      .target-card:hover:not(.disabled) {
        transform: translateY(-4px);
        border-color: var(--pyxis-gold-bright);
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.95) 0%,
          rgba(42, 52, 65, 0.9) 100%
        );
        box-shadow: 
          0 12px 24px rgba(0, 0, 0, 0.3),
          0 0 0 1px var(--pyxis-gold-bright),
          0 0 20px rgba(220, 199, 162, 0.2);
      }

      .target-card.focused {
        border-color: var(--pyxis-gold-bright);
        box-shadow: 
          0 8px 16px rgba(0, 0, 0, 0.2),
          0 0 0 2px var(--pyxis-gold-bright),
          0 0 20px rgba(220, 199, 162, 0.3);
      }

      .target-card.selected {
        border-color: var(--pyxis-gold-bright) !important;
        background: linear-gradient(
          145deg,
          rgba(220, 199, 162, 0.15) 0%,
          rgba(212, 183, 126, 0.1) 100%
        ) !important;
        box-shadow: 
          0 8px 16px rgba(0, 0, 0, 0.2), 
          0 0 0 2px var(--pyxis-gold-bright),
          inset 0 0 20px rgba(220, 199, 162, 0.1) !important;
      }

      .target-card.disabled {
        opacity: 0.4;
        cursor: not-allowed;
        filter: grayscale(0.8);
        background: linear-gradient(
          145deg,
          rgba(42, 52, 65, 0.5) 0%,
          rgba(26, 31, 42, 0.6) 100%
        );
      }

      .target-card.disabled:hover {
        transform: none !important;
        border-color: var(--pyxis-border-subtle) !important;
        box-shadow: none !important;
      }

      .target-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .target-avatar {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: linear-gradient(145deg, var(--pyxis-gold-warm), var(--pyxis-gold-bright));
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 18px;
        color: var(--pyxis-deep-navy);
        border: 2px solid var(--pyxis-border-subtle);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .target-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
      }

      .target-info {
        flex: 1;
        min-width: 0;
      }

      .target-name {
        font-family: 'Inter', sans-serif;
        font-size: 18px;
        font-weight: 600;
        color: var(--pyxis-gold-bright);
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .target-team {
        font-size: 12px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 8px;
        display: inline-block;
        margin-bottom: 8px;
      }

      .target-team.phoenix {
        background: rgba(199, 62, 29, 0.2);
        color: #FF6B4A;
        border: 1px solid rgba(199, 62, 29, 0.3);
      }

      .target-team.eaters {
        background: rgba(45, 90, 39, 0.2);
        color: #66BB6A;
        border: 1px solid rgba(45, 90, 39, 0.3);
      }

      .target-hp {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .target-hp-text {
        font-size: 14px;
        font-weight: 500;
        color: var(--pyxis-gold-warm);
        min-width: fit-content;
      }

      .target-hp-bar-container {
        flex: 1;
        height: 8px;
        background: rgba(0, 30, 53, 0.8);
        border-radius: 4px;
        border: 1px solid var(--pyxis-border-subtle);
        overflow: hidden;
        position: relative;
      }

      .target-hp-bar {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        background: linear-gradient(90deg, 
          var(--pyxis-success-green) 0%,
          var(--pyxis-gold-warm) 50%,
          var(--pyxis-gold-bright) 100%
        );
      }

      .target-hp-bar.low {
        background: linear-gradient(90deg, 
          var(--pyxis-combat-red) 0%,
          var(--pyxis-warning-amber) 100%
        );
      }

      .target-hp-bar::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.3) 50%,
          transparent 100%
        );
        animation: shimmer 2s infinite;
      }

      @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }

      .target-stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        font-size: 11px;
        color: rgba(220, 199, 162, 0.8);
        margin-bottom: 12px;
      }

      .target-stat {
        display: flex;
        justify-content: space-between;
        padding: 4px 8px;
        background: rgba(0, 30, 53, 0.5);
        border-radius: 6px;
        border: 1px solid var(--pyxis-border-subtle);
      }

      .target-status {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .status-pill {
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .status-pill.alive {
        background: rgba(45, 90, 39, 0.3);
        color: #66BB6A;
        border: 1px solid rgba(45, 90, 39, 0.5);
      }

      .status-pill.dead {
        background: rgba(199, 62, 29, 0.3);
        color: #FF6B4A;
        border: 1px solid rgba(199, 62, 29, 0.5);
      }

      .status-pill.boosted {
        background: rgba(184, 134, 11, 0.3);
        color: var(--pyxis-warning-amber);
        border: 1px solid rgba(184, 134, 11, 0.5);
      }

      .target-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        align-items: center;
        margin-top: 24px;
      }

      .btn {
        padding: 12px 24px;
        border: 2px solid var(--pyxis-border-subtle);
        border-radius: 12px;
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.9) 0%,
          rgba(42, 52, 65, 0.8) 100%
        );
        color: var(--pyxis-gold-bright);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        position: relative;
        overflow: hidden;
        min-width: 100px;
      }

      .btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(220, 199, 162, 0.2) 50%,
          transparent 100%
        );
        transition: left 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .btn:hover::before {
        left: 100%;
      }

      .btn:hover:not(:disabled) {
        border-color: var(--pyxis-gold-bright);
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.95) 0%,
          rgba(42, 52, 65, 0.9) 100%
        );
        box-shadow: 
          0 8px 16px rgba(0, 0, 0, 0.2),
          0 0 20px rgba(220, 199, 162, 0.2);
        transform: translateY(-2px);
      }

      .btn.btn-gold {
        background: linear-gradient(
          145deg,
          var(--pyxis-gold-warm) 0%,
          var(--pyxis-gold-bright) 100%
        );
        color: var(--pyxis-deep-navy);
        border-color: var(--pyxis-gold-bright);
      }

      .btn.btn-gold:hover:not(:disabled) {
        background: linear-gradient(
          145deg,
          var(--pyxis-gold-bright) 0%,
          var(--pyxis-gold-warm) 100%
        );
        box-shadow: 
          0 8px 16px rgba(0, 0, 0, 0.3),
          0 0 20px rgba(220, 199, 162, 0.4);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
        box-shadow: none !important;
      }

      .no-targets {
        text-align: center;
        color: rgba(220, 199, 162, 0.6);
        font-style: italic;
        padding: 60px 20px;
        font-size: 18px;
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.5) 0%,
          rgba(42, 52, 65, 0.3) 100%
        );
        border: 2px dashed var(--pyxis-border-subtle);
        border-radius: 16px;
        margin: 20px 0;
      }

      .battle-info {
        text-align: center;
        margin-bottom: 20px;
        padding: 16px;
        background: linear-gradient(
          145deg,
          rgba(0, 30, 53, 0.7) 0%,
          rgba(42, 52, 65, 0.5) 100%
        );
        border: 1px solid var(--pyxis-border-subtle);
        border-radius: 12px;
      }

      .battle-mode {
        font-size: 14px;
        color: var(--pyxis-gold-warm);
        font-weight: 500;
        margin-bottom: 8px;
      }

      .turn-info {
        font-size: 12px;
        color: rgba(220, 199, 162, 0.7);
      }

      /* 모바일 최적화 */
      @media (max-width: 768px) {
        .target-panel {
          margin: 16px;
          padding: 20px;
          max-height: 90vh;
        }

        .target-list {
          grid-template-columns: 1fr;
          max-height: 50vh;
        }

        .target-card {
          padding: 16px;
        }

        .target-title {
          font-size: 24px;
          margin-bottom: 16px;
        }

        .target-title::before,
        .target-title::after {
          display: none;
        }

        .target-actions {
          flex-direction: column;
          gap: 8px;
        }

        .btn {
          width: 100%;
          min-width: unset;
        }
      }

      /* 접근성 */
      @media (prefers-reduced-motion: reduce) {
        * {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }

      /* 고대비 모드 */
      @media (prefers-contrast: high) {
        .target-card {
          border-width: 3px;
        }
        
        .btn {
          border-width: 3px;
        }
      }
    `;

    document.head.appendChild(styleSheet);
  }

  // 오버레이 생성
  createOverlay() {
    // 기존 오버레이 제거
    const existing = document.getElementById('pyxis-target-overlay');
    if (existing) {
      existing.remove();
    }

    // 새 오버레이 생성
    this.overlay = document.createElement('div');
    this.overlay.id = 'pyxis-target-overlay';
    this.overlay.className = 'target-overlay';
    this.overlay.style.display = 'none';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'targetTitle');

    this.overlay.innerHTML = `
      <div class="target-panel sparkle-effect">
        <div class="target-title" id="targetTitle">전투 대상 선택</div>
        
        ${this.battleData ? `
          <div class="battle-info">
            <div class="battle-mode">${this.battleData.mode || '2v2'} 전투</div>
            <div class="turn-info">턴 ${this.battleData.currentTurn || 1} • ${this.battleData.currentTeam || '불사조 기사단'} 차례</div>
          </div>
        ` : ''}
        
        <div class="target-list" id="targetList" role="listbox" aria-multiselectable="${this.options.allowMultiSelect}"></div>
        
        <div class="target-actions">
          <button class="btn" id="cancelTarget" type="button">
            취소
          </button>
          ${this.options.allowMultiSelect ? `
            <button class="btn btn-gold" id="confirmTarget" type="button" disabled>
              확인 (<span id="selectedCount">0</span>)
            </button>
          ` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // 요소 참조 저장
    this.titleEl = this.overlay.querySelector('#targetTitle');
    this.listEl = this.overlay.querySelector('#targetList');
    this.cancelBtn = this.overlay.querySelector('#cancelTarget');
    this.confirmBtn = this.overlay.querySelector('#confirmTarget');
    this.selectedCountEl = this.overlay.querySelector('#selectedCount');
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    this.teardownEventListeners();

    // 취소 버튼
    if (this.cancelBtn) {
      this._cancelHandler = () => this.hide();
      this.cancelBtn.addEventListener('click', this._cancelHandler);
    }

    // 확인 버튼
    if (this.confirmBtn) {
      this._confirmHandler = () => this.confirm();
      this.confirmBtn.addEventListener('click', this._confirmHandler);
    }

    // 전역 이벤트
    document.addEventListener('keydown', this._onEscKey);
    document.addEventListener('keydown', this._onKeyboardNav);
    this.overlay.addEventListener('click', this._onOverlayClick);

    this._listenersBound = true;
  }

  // 리스너 해제
  teardownEventListeners() {
    if (!this._listenersBound) return;

    // 버튼 핸들러
    if (this._cancelHandler && this.cancelBtn) {
      this.cancelBtn.removeEventListener('click', this._cancelHandler);
      this._cancelHandler = null;
    }
    if (this._confirmHandler && this.confirmBtn) {
      this.confirmBtn.removeEventListener('click', this._confirmHandler);
      this._confirmHandler = null;
    }

    // 전역 이벤트
    document.removeEventListener('keydown', this._onEscKey);
    document.removeEventListener('keydown', this._onKeyboardNav);
    if (this.overlay) {
      this.overlay.removeEventListener('click', this._onOverlayClick);
    }

    this._listenersBound = false;
  }

  // ESC 키 핸들러
  _onEscKey(e) {
    if (e.key === 'Escape' && this.isVisible) {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    }
  }

  // 키보드 네비게이션
  _onKeyboardNav(e) {
    if (!this.isVisible) return;

    const targetCards = this.listEl.querySelectorAll('.target-card:not(.disabled)');
    if (targetCards.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        this._focusedIndex = Math.min(this._focusedIndex + 1, targetCards.length - 1);
        this.updateFocus(targetCards);
        break;

      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        this._focusedIndex = Math.max(this._focusedIndex - 1, 0);
        this.updateFocus(targetCards);
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (targetCards[this._focusedIndex]) {
          targetCards[this._focusedIndex].click();
        }
        break;

      case 'Home':
        e.preventDefault();
        this._focusedIndex = 0;
        this.updateFocus(targetCards);
        break;

      case 'End':
        e.preventDefault();
        this._focusedIndex = targetCards.length - 1;
        this.updateFocus(targetCards);
        break;
    }
  }

  // 포커스 업데이트
  updateFocus(targetCards) {
    targetCards.forEach((card, index) => {
      card.classList.toggle('focused', index === this._focusedIndex);
    });
    targetCards[this._focusedIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }

  // 오버레이 클릭 핸들러
  _onOverlayClick(e) {
    if (e.target === this.overlay) {
      this.hide();
    }
  }

  // 타겟 선택 표시
  show(title, targets, callback, battleData = null) {
    this.titleEl.textContent = title || '전투 대상 선택';
    this.targets = Array.isArray(targets) ? targets : [];
    this.callback = callback;
    this.battleData = battleData;
    this.selectedTargets = [];
    this._focusedIndex = 0;

    // 배틀 정보가 있으면 UI 업데이트
    if (this.battleData) {
      const battleInfo = this.overlay.querySelector('.battle-info');
      if (battleInfo) {
        battleInfo.querySelector('.battle-mode').textContent = `${this.battleData.mode || '2v2'} 전투`;
        battleInfo.querySelector('.turn-info').textContent = 
          `턴 ${this.battleData.currentTurn || 1} • ${this.battleData.currentTeam || '불사조 기사단'} 차례`;
      }
    }

    this.renderTargets();
    this.overlay.style.display = 'flex';
    this.isVisible = true;

    // 접근성: 첫 번째 유효한 타겟에 포커스
    const firstCard = this.listEl.querySelector('.target-card:not(.disabled)');
    if (firstCard) {
      setTimeout(() => {
        firstCard.focus();
        this.updateFocus([firstCard]);
      }, 100);
    }
  }

  // 타겟 목록 렌더링
  renderTargets() {
    this.listEl.innerHTML = '';

    if (this.targets.length === 0) {
      this.listEl.innerHTML = `
        <div class="no-targets">
          선택할 수 있는 대상이 없습니다
        </div>
      `;
      return;
    }

    this.targets.forEach((target, index) => {
      const card = this.createTargetCard(target, index);
      this.listEl.appendChild(card);
    });
  }

  // 타겟 카드 생성
  createTargetCard(target, index) {
    const card = document.createElement('div');
    const isDisabled = target.alive === false || target.hp <= 0;
    
    card.className = `target-card ${isDisabled ? 'disabled' : ''}`;
    card.tabIndex = isDisabled ? -1 : 0;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', 'false');
    card.setAttribute('aria-label', `${target.name || `대상 ${index + 1}`} 선택`);

    // 헤더 섹션
    const header = document.createElement('div');
    header.className = 'target-header';

    // 아바타
    const avatar = document.createElement('div');
    avatar.className = 'target-avatar';
    if (target.avatar && this.options.showAvatar) {
      const img = document.createElement('img');
      img.src = target.avatar;
      img.alt = target.name || '플레이어';
      img.onerror = () => {
        avatar.innerHTML = (target.name || 'U').charAt(0).toUpperCase();
      };
      avatar.appendChild(img);
    } else {
      avatar.textContent = (target.name || 'U').charAt(0).toUpperCase();
    }

    // 정보 섹션
    const info = document.createElement('div');
    info.className = 'target-info';

    // 이름
    const name = document.createElement('div');
    name.className = 'target-name';
    name.textContent = target.name || `대상 ${index + 1}`;

    // 팀 정보
    if (this.options.showTeam && target.team) {
      const team = document.createElement('div');
      team.className = `target-team ${target.team}`;
      team.textContent = target.team === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들';
      info.appendChild(team);
    }

    info.appendChild(name);
    header.appendChild(avatar);
    header.appendChild(info);
    card.appendChild(header);

    // HP 정보
    if (this.options.showHp && target.hp !== undefined) {
      const hpContainer = document.createElement('div');
      hpContainer.className = 'target-hp';

      const hpText = document.createElement('div');
      hpText.className = 'target-hp-text';
      hpText.textContent = `${Math.max(0, target.hp)}/${target.maxHp || 100}`;

      const hpBarContainer = document.createElement('div');
      hpBarContainer.className = 'target-hp-bar-container';

      const hpBar = document.createElement('div');
      hpBar.className = 'target-hp-bar';
      const hpPercent = Math.max(0, Math.min(100, (target.hp / (target.maxHp || 100)) * 100));
      
      if (hpPercent <= 25) {
        hpBar.classList.add('low');
      }
      
      hpBar.style.width = `${hpPercent}%`;

      hpBarContainer.appendChild(hpBar);
      hpContainer.appendChild(hpText);
      hpContainer.appendChild(hpBarContainer);
      card.appendChild(hpContainer);
    }

    // 스탯 정보
    if (this.options.showStats && target.stats) {
      const statsContainer = document.createElement('div');
      statsContainer.className = 'target-stats';

      const stats = target.stats;
      const statNames = [
        { key: 'attack', label: '공격', alt: 'atk' },
        { key: 'defense', label: '방어', alt: 'def' },
        { key: 'agility', label: '민첩', alt: 'agi' },
        { key: 'luck', label: '행운', alt: 'luk' }
      ];

      statNames.forEach(stat => {
        const statEl = document.createElement('div');
        statEl.className = 'target-stat';
        
        const value = stats[stat.key] ?? stats[stat.alt] ?? 0;
        statEl.innerHTML = `
          <span>${stat.label}</span>
          <span>${value}</span>
        `;
        
        statsContainer.appendChild(statEl);
      });

      card.appendChild(statsContainer);
    }

    // 상태 정보
    const statusContainer = document.createElement('div');
    statusContainer.className = 'target-status';

    // 생존 상태
    const aliveStatus = document.createElement('div');
    aliveStatus.className = `status-pill ${isDisabled ? 'dead' : 'alive'}`;
    aliveStatus.textContent = isDisabled ? '전투불능' : '전투가능';
    statusContainer.appendChild(aliveStatus);

    // 버프/디버프 상태
    if (target.effects && Array.isArray(target.effects)) {
      target.effects.forEach(effect => {
        const effectPill = document.createElement('div');
        effectPill.className = 'status-pill boosted';
        effectPill.textContent = effect.name || effect;
        statusContainer.appendChild(effectPill);
      });
    }

    card.appendChild(statusContainer);

    // 클릭/키보드 이벤트
    if (!isDisabled) {
      const selectHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectTarget(target, card);
      };

      card.addEventListener('click', selectHandler);
      card.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          selectHandler(e);
        }
      });

      // 호버 시 사운드 효과 (옵션)
      if (this.options.enableSoundEffects) {
        card.addEventListener('mouseenter', () => {
          this.playSound('hover');
        });
      }
    }

    return card;
  }

  // 타겟 선택
  selectTarget(target, cardEl) {
    if (target.alive === false || target.hp <= 0) return;

    // 사운드 효과
    if (this.options.enableSoundEffects) {
      this.playSound('select');
    }

    if (this.options.allowMultiSelect) {
      // 다중 선택 모드
      const index = this.selectedTargets.findIndex(t => 
        (t.id && t.id === target.id) || (t.name === target.name)
      );

      if (index > -1) {
        // 이미 선택된 경우 제거
        this.selectedTargets.splice(index, 1);
        cardEl.classList.remove('selected');
        cardEl.setAttribute('aria-selected', 'false');
      } else {
        // 새로 선택
        this.selectedTargets.push(target);
        cardEl.classList.add('selected');
        cardEl.setAttribute('aria-selected', 'true');
      }

      // 확인 버튼 상태 업데이트
      this.updateConfirmButton();
    } else {
      // 단일 선택 모드: 즉시 실행
      this.hide();
      if (this.callback) {
        setTimeout(() => {
          this.callback(target);
        }, 100);
      }
    }
  }

  // 확인 버튼 상태 업데이트
  updateConfirmButton() {
    if (this.confirmBtn && this.selectedCountEl) {
      const count = this.selectedTargets.length;
      this.confirmBtn.disabled = count === 0;
      this.selectedCountEl.textContent = count;
      
      if (count > 0) {
        this.confirmBtn.setAttribute('aria-label', `${count}명의 대상 선택 확인`);
      }
    }
  }

  // 다중 선택 확인
  confirm() {
    if (this.selectedTargets.length === 0) return;

    // 사운드 효과
    if (this.options.enableSoundEffects) {
      this.playSound('confirm');
    }

    this.hide();
    if (this.callback) {
      setTimeout(() => {
        this.callback(this.options.allowMultiSelect ? this.selectedTargets : this.selectedTargets[0]);
      }, 100);
    }
  }

  // 숨기기
  hide() {
    if (!this.overlay) return;

    // 페이드 아웃 애니메이션
    this.overlay.style.opacity = '0';
    this.overlay.querySelector('.target-panel').style.transform = 'scale(0.9) translateY(20px)';

    setTimeout(() => {
      this.overlay.style.display = 'none';
      this.isVisible = false;
      this.targets = [];
      this.selectedTargets = [];
      this.callback = null;
      this.battleData = null;
      this._focusedIndex = 0;

      // 포커스 복원
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    }, 200);
  }

  // 사운드 재생 (옵션)
  playSound(type) {
    if (!this.options.enableSoundEffects) return;

    // Web Audio API를 사용한 간단한 사운드 효과
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      switch (type) {
        case 'hover':
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
          break;
        case 'select':
          oscillator.frequency.setValueAtTime(1200, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          break;
        case 'confirm':
          oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(1200, audioContext.currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
          break;
      }

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.warn('Sound effects not available:', error);
    }
  }

  // 필터링
  filterTargets(predicate) {
    this.targets = this.targets.filter(predicate);
    this.selectedTargets = this.selectedTargets.filter(predicate);
    this.renderTargets();
    this.updateConfirmButton();
  }

  // 타겟 업데이트
  updateTargets(targets) {
    this.targets = Array.isArray(targets) ? targets : [];
    this.selectedTargets = [];
    this.renderTargets();
    this.updateConfirmButton();
  }

  // 특정 타겟 업데이트
  updateTarget(targetId, updates) {
    const targetIndex = this.targets.findIndex(t => 
      (t.id && t.id === targetId) || (t.name === targetId)
    );
    
    if (targetIndex > -1) {
      this.targets[targetIndex] = { ...this.targets[targetIndex], ...updates };
      this.renderTargets();
    }
  }

  // 타겟 추가
  addTarget(target) {
    this.targets.push(target);
    this.renderTargets();
  }

  // 타겟 제거
  removeTarget(targetId) {
    this.targets = this.targets.filter(t => 
      (t.id && t.id !== targetId) && (t.name !== targetId)
    );
    this.selectedTargets = this.selectedTargets.filter(t => 
      (t.id && t.id !== targetId) && (t.name !== targetId)
    );
    this.renderTargets();
    this.updateConfirmButton();
  }

  // 표시 여부 확인
  isShown() {
    return this.isVisible;
  }

  // 선택된 타겟들 가져오기
  getSelectedTargets() {
    return [...this.selectedTargets];
  }

  // 모든 선택 해제
  clearSelection() {
    this.selectedTargets = [];
    if (this.listEl) {
      this.listEl.querySelectorAll('.target-card.selected').forEach(card => {
        card.classList.remove('selected');
        card.setAttribute('aria-selected', 'false');
      });
    }
    this.updateConfirmButton();
  }

  // 옵션 업데이트
  updateOptions(newOptions) {
    const oldMultiSelect = this.options.allowMultiSelect;
    this.options = { ...this.options, ...newOptions };

    // 다중 선택 모드 변경시 UI 재구성
    if (oldMultiSelect !== this.options.allowMultiSelect) {
      this.teardownEventListeners();
      this.createOverlay();
      this.setupEventListeners();
    }
  }

  // 전투 데이터 업데이트
  updateBattleData(battleData) {
    this.battleData = battleData;
    
    const battleInfo = this.overlay?.querySelector('.battle-info');
    if (battleInfo && this.isVisible) {
      battleInfo.querySelector('.battle-mode').textContent = `${battleData.mode || '2v2'} 전투`;
      battleInfo.querySelector('.turn-info').textContent = 
        `턴 ${battleData.currentTurn || 1} • ${battleData.currentTeam || '불사조 기사단'} 차례`;
    }
  }

  // 테마 변경
  setTheme(theme) {
    this.options.theme = theme;
    
    if (this.overlay) {
      this.overlay.className = `target-overlay theme-${theme}`;
    }
  }

  // 스타일 커스터마이징
  setCustomStyles(styles) {
    if (!styles || typeof styles !== 'object') return;

    Object.entries(styles).forEach(([selector, cssText]) => {
      const elements = this.overlay?.querySelectorAll(selector) || [];
      elements.forEach(el => {
        if (typeof cssText === 'string') {
          el.style.cssText += cssText;
        } else if (typeof cssText === 'object') {
          Object.assign(el.style, cssText);
        }
      });
    });
  }

  // 애니메이션 토글
  toggleAnimations(enabled) {
    this.options.enableAnimations = enabled;
    
    if (this.overlay) {
      this.overlay.style.transition = enabled ? '' : 'none';
      const panel = this.overlay.querySelector('.target-panel');
      if (panel) {
        panel.style.transition = enabled ? '' : 'none';
      }
    }
  }

  // 사운드 효과 토글
  toggleSoundEffects(enabled) {
    this.options.enableSoundEffects = enabled;
  }

  // 키보드 단축키 추가
  addKeyboardShortcut(key, callback) {
    const handler = (e) => {
      if (this.isVisible && e.key === key) {
        e.preventDefault();
        callback(e);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }

  // 통계 정보 가져오기
  getStats() {
    return {
      totalTargets: this.targets.length,
      selectedTargets: this.selectedTargets.length,
      aliveTargets: this.targets.filter(t => t.alive !== false && t.hp > 0).length,
      deadTargets: this.targets.filter(t => t.alive === false || t.hp <= 0).length,
      averageHp: this.targets.reduce((sum, t) => sum + (t.hp || 0), 0) / this.targets.length || 0
    };
  }

  // 접근성 향상
  announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    announcement.textContent = message;

    document.body.appendChild(announcement);
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  // 정리
  destroy() {
    this.teardownEventListeners();

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    // 스타일시트 제거
    const styleSheet = document.getElementById('pyxis-target-selector-enhanced-styles');
    if (styleSheet) {
      styleSheet.remove();
    }

    this.targets = [];
    this.selectedTargets = [];
    this.callback = null;
    this.battleData = null;
    this.isVisible = false;
    this._focusedIndex = 0;
  }
}

// 전역 접근을 위한 윈도우 객체에 등록
window.PyxisTargetSelector = PyxisTargetSelector;

// 전역 인스턴스 생성 (편의용)
window.PyxisTarget = new PyxisTargetSelector({
  enableAnimations: true,
  enableSoundEffects: false, // 기본값은 false로 설정
  showStats: true,
  showHp: true,
  showTeam: true,
  showAvatar: true
});

// 사용 예시와 유틸리티 함수들
window.PyxisTargetUtils = {
  // 팀별 타겟 필터링
  filterByTeam: (targets, team) => {
    return targets.filter(target => target.team === team);
  },

  // 생존 타겟만 필터링
  filterAlive: (targets) => {
    return targets.filter(target => target.alive !== false && target.hp > 0);
  },

  // HP가 낮은 순으로 정렬
  sortByHp: (targets, ascending = true) => {
    return [...targets].sort((a, b) => {
      const hpA = a.hp || 0;
      const hpB = b.hp || 0;
      return ascending ? hpA - hpB : hpB - hpA;
    });
  },

  // 스탯 총합으로 정렬
  sortByTotalStats: (targets, ascending = false) => {
    return [...targets].sort((a, b) => {
      const statsA = a.stats ? Object.values(a.stats).reduce((sum, val) => sum + (val || 0), 0) : 0;
      const statsB = b.stats ? Object.values(b.stats).reduce((sum, val) => sum + (val || 0), 0) : 0;
      return ascending ? statsA - statsB : statsB - statsA;
    });
  },

  // 전투 적합성 체크
  isValidTarget: (target) => {
    return target && target.alive !== false && target.hp > 0;
  },

  // 타겟 데이터 정규화
  normalizeTarget: (target) => {
    return {
      id: target.id || target.name || Math.random().toString(36),
      name: target.name || '무명의 전사',
      team: target.team || 'phoenix',
      hp: Math.max(0, target.hp || 100),
      maxHp: target.maxHp || 100,
      stats: {
        attack: target.stats?.attack || target.stats?.atk || 1,
        defense: target.stats?.defense || target.stats?.def || 1,
        agility: target.stats?.agility || target.stats?.agi || 1,
        luck: target.stats?.luck || target.stats?.luk || 1
      },
      alive: target.alive !== false && (target.hp || 100) > 0,
      avatar: target.avatar || null,
      effects: target.effects || []
    };
  }
};
