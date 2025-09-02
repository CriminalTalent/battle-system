// PYXIS Target Selector Component - 타겟 선택 컴포넌트
class PyxisTargetSelector {
  constructor(options = {}) {
    this.options = {
      showStats: true,
      showHp: true,
      allowMultiSelect: false,
      ...options
    };

    this.isVisible = false;
    this.targets = [];
    this.selectedTargets = [];
    this.callback = null;

    // 바인딩(전역/중복 방지용)
    this._onEscKey = this._onEscKey.bind(this);
    this._onOverlayClick = this._onOverlayClick.bind(this);

    this._listenersBound = false;

    this.init();
  }

  // 초기화
  init() {
    this.createOverlay();
    this.setupEventListeners();
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

    this.overlay.innerHTML = `
      <div class="target-panel sparkle-effect">
        <div class="target-title" id="targetTitle">대상 선택</div>
        <div class="target-list" id="targetList"></div>
        <div class="target-actions">
          <button class="btn enhance-hover" id="cancelTarget">취소</button>
          ${this.options.allowMultiSelect ? '<button class="btn btn-gold" id="confirmTarget" disabled>확인</button>' : ''}
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // 요소 참조 저장
    this.titleEl = this.overlay.querySelector('#targetTitle');
    this.listEl = this.overlay.querySelector('#targetList');
    this.cancelBtn = this.overlay.querySelector('#cancelTarget');
    this.confirmBtn = this.overlay.querySelector('#confirmTarget');
  }

  // 이벤트 리스너 설정(중복 방지)
  setupEventListeners() {
    // 먼저 기존 리스너 해제
    this.teardownEventListeners();

    // 취소 버튼
    if (this.cancelBtn) {
      this._cancelClickOff = this._addDomListener(this.cancelBtn, 'click', () => this.hide());
    }

    // 확인 버튼 (다중 선택 모드)
    if (this.confirmBtn) {
      this._confirmClickOff = this._addDomListener(this.confirmBtn, 'click', () => this.confirm());
    }

    // ESC 키로 닫기 (전역)
    document.addEventListener('keydown', this._onEscKey);

    // 오버레이 클릭으로 닫기
    this.overlay.addEventListener('click', this._onOverlayClick);

    this._listenersBound = true;
  }

  // 리스너 해제
  teardownEventListeners() {
    if (!this._listenersBound) return;

    // 버튼 핸들러 해제
    if (this._cancelClickOff) {
      try { this._cancelClickOff(); } catch {}
      this._cancelClickOff = null;
    }
    if (this._confirmClickOff) {
      try { this._confirmClickOff(); } catch {}
      this._confirmClickOff = null;
    }

    // 전역/오버레이 해제
    try { document.removeEventListener('keydown', this._onEscKey); } catch {}
    try { this.overlay.removeEventListener('click', this._onOverlayClick); } catch {}

    this._listenersBound = false;
  }

  // 내부 유틸: 안전한 addEventListener (해제 함수 반환)
  _addDomListener(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    return () => el.removeEventListener(type, fn, opts);
  }

  // ESC 핸들러
  _onEscKey(e) {
    if (e.key === 'Escape' && this.isVisible) {
      e.preventDefault();
      this.hide();
    }
  }

  // 오버레이 영역 클릭 시 닫기
  _onOverlayClick(e) {
    if (e.target === this.overlay) {
      this.hide();
    }
  }

  // 타겟 선택 표시
  show(title, targets, callback) {
    this.titleEl.textContent = title || '대상 선택';
    this.targets = Array.isArray(targets) ? targets : [];
    this.callback = callback;
    this.selectedTargets = [];

    this.renderTargets();
    this.overlay.style.display = 'flex';
    this.isVisible = true;

    // 접근성: 첫 번째 타겟 카드에 포커스
    const firstCard = this.listEl.querySelector('.target-card:not(.disabled)');
    if (firstCard) {
      firstCard.focus();
    }
  }

  // 타겟 목록 렌더링
  renderTargets() {
    this.listEl.innerHTML = '';

    if (this.targets.length === 0) {
      this.listEl.innerHTML = '<div class="no-targets">선택할 대상이 없습니다</div>';
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
    card.className = `target-card enhance-hover ${target.alive === false ? 'disabled' : ''}`;
    card.tabIndex = target.alive === false ? -1 : 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${target.name || `대상 ${index + 1}`} 선택`);

    // 이름
    const nameEl = document.createElement('div');
    nameEl.className = 'target-name';
    nameEl.textContent = target.name || `대상 ${index + 1}`;
    card.appendChild(nameEl);

    // HP 정보
    if (this.options.showHp && target.hp !== undefined) {
      const hpEl = document.createElement('div');
      hpEl.className = 'target-hp';
      hpEl.textContent = `HP ${target.hp}/${target.maxHp || 100}`;
      card.appendChild(hpEl);

      // HP 바
      const hpBarContainer = document.createElement('div');
      hpBarContainer.className = 'target-hp-bar-container';
      hpBarContainer.style.cssText = `
        width: 100%;
        height: 6px;
        background: rgba(26,31,42,.9);
        border-radius: 3px;
        overflow: hidden;
        margin-top: 8px;
      `;

      const hpBar = document.createElement('div');
      hpBar.className = 'target-hp-bar';
      const hpPercent = Math.max(0, Math.min(100, (target.hp / (target.maxHp || 100)) * 100));
      hpBar.style.cssText = `
        width: ${hpPercent}%;
        height: 100%;
        background: linear-gradient(90deg, #c9a96e, #e6d3aa);
        transition: width 0.3s ease;
      `;

      hpBarContainer.appendChild(hpBar);
      card.appendChild(hpBarContainer);
    }

    // 스탯 정보
    if (this.options.showStats && target.stats) {
      const statsEl = document.createElement('div');
      statsEl.className = 'target-stats';
      statsEl.style.cssText = `
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 8px;
        line-height: 1.3;
      `;

      const s = target.stats;
      statsEl.textContent = `공격 ${s.attack ?? s.atk ?? 0} · 방어 ${s.defense ?? s.def ?? 0} · 민첩 ${s.agility ?? s.agi ?? 0}`;
      card.appendChild(statsEl);
    }

    // 클릭/키보드 이벤트
    if (target.alive !== false) {
      card.addEventListener('click', () => this.selectTarget(target, card));
      card.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.selectTarget(target, card);
        }
      });
    }

    return card;
  }

  // 타겟 선택
  selectTarget(target, cardEl) {
    if (target.alive === false) return;

    if (this.options.allowMultiSelect) {
      // 다중 선택 모드
      const index = this.selectedTargets.findIndex(t => t.id === target.id);

      if (index > -1) {
        // 이미 선택된 경우 제거
        this.selectedTargets.splice(index, 1);
        cardEl.classList.remove('selected');
      } else {
        // 새로 선택
        this.selectedTargets.push(target);
        cardEl.classList.add('selected');
      }

      // 확인 버튼 상태 업데이트
      if (this.confirmBtn) {
        this.confirmBtn.disabled = this.selectedTargets.length === 0;
      }
    } else {
      // 단일 선택 모드: 즉시 실행
      this.hide();
      if (this.callback) {
        this.callback(target);
      }
    }
  }

  // 다중 선택 확인
  confirm() {
    if (this.selectedTargets.length === 0) return;

    this.hide();
    if (this.callback) {
      this.callback(this.options.allowMultiSelect ? this.selectedTargets : this.selectedTargets[0]);
    }
  }

  // 숨기기
  hide() {
    if (!this.overlay) return;
    this.overlay.style.display = 'none';
    this.isVisible = false;
    this.targets = [];
    this.selectedTargets = [];
    this.callback = null;

    // 포커스 복원
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch {}
  }

  // 필터링
  filterTargets(predicate) {
    const filteredTargets = this.targets.filter(predicate);
    this.targets = filteredTargets;
    this.renderTargets();
  }

  // 타겟 업데이트
  updateTargets(targets) {
    this.targets = Array.isArray(targets) ? targets : [];
    this.renderTargets();
  }

  // 타겟 추가
  addTarget(target) {
    this.targets.push(target);
    this.renderTargets();
  }

  // 타겟 제거
  removeTarget(targetId) {
    this.targets = this.targets.filter(t => t.id !== targetId);
    this.selectedTargets = this.selectedTargets.filter(t => t.id !== targetId);
    this.renderTargets();

    // 확인 버튼 상태 업데이트
    if (this.confirmBtn) {
      this.confirmBtn.disabled = this.selectedTargets.length === 0;
    }
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
      });
    }
    if (this.confirmBtn) {
      this.confirmBtn.disabled = true;
    }
  }

  // 옵션 업데이트
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };

    // UI 업데이트가 필요한 경우 다시 생성
    if (newOptions.allowMultiSelect !== undefined) {
      // 기존 리스너 해제 후 DOM 재구성 → 다시 리스너 등록
      this.teardownEventListeners();
      this.createOverlay();
      this.setupEventListeners();
    }
  }

  // 스타일 커스터마이징 (디자인 색상값은 그대로)
  setCustomStyles(styles) {
    if (!styles || typeof styles !== 'object') return;

    Object.entries(styles).forEach(([selector, cssText]) => {
      const elements = this.overlay.querySelectorAll(selector);
      elements.forEach(el => {
        if (typeof cssText === 'string') {
          el.style.cssText += cssText;
        } else if (typeof cssText === 'object') {
          Object.assign(el.style, cssText);
        }
      });
    });
  }

  // 정리
  destroy() {
    // 리스너 해제
    this.teardownEventListeners();

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.targets = [];
    this.selectedTargets = [];
    this.callback = null;
    this.isVisible = false;
  }
}

// CSS 스타일 추가 (한 번만 실행)
if (!document.getElementById('pyxis-target-selector-styles')) {
  const styles = document.createElement('style');
  styles.id = 'pyxis-target-selector-styles';
  styles.textContent = `
    .target-card.selected {
      border-color: var(--gold) !important;
      background: rgba(212,183,126,.2) !important;
      box-shadow: 
        0 8px 16px rgba(0,0,0,.2), 
        0 0 0 2px rgba(212,183,126,.5),
        0 0 20px rgba(212,183,126,.3) !important;
    }
    
    .target-card:focus {
      outline: 2px solid var(--gold);
      outline-offset: 2px;
    }
    
    .no-targets {
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
      padding: 40px 20px;
      font-size: 16px;
    }
    
    .target-card.disabled {
      opacity: 0.5;
      cursor: not-allowed;
      filter: grayscale(0.7);
    }
    
    .target-card.disabled:hover {
      transform: none !important;
      border-color: var(--border-1) !important;
      background: rgba(42,52,65,.8) !important;
      box-shadow: 0 4px 8px rgba(0,0,0,.1) !important;
    }
  `;
  document.head.appendChild(styles);
}

// 전역 접근을 위한 윈도우 객체에 등록
window.PyxisTargetSelector = PyxisTargetSelector;

// 전역 인스턴스 생성 (편의용)
window.PyxisTarget = new PyxisTargetSelector();