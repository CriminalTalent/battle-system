// PYXIS UI Library - Enhanced Gaming Interface
// 게임다운 UI 컴포넌트 라이브러리, PYXIS 디자인 시스템 통합
(function(global) {
  'use strict';

  const PyxisUI = {
    // DOM 유틸리티
    $: (selector, context = document) => context.querySelector(selector),
    $$: (selector, context = document) => Array.from(context.querySelectorAll(selector)),

    // 향상된 엘리먼트 생성 (aria/dataset/unsafeHTML 지원, 이벤트명 소문자 정규화)
    createElement: (tag, attrs = {}, children = []) => {
      const el = document.createElement(tag);

      const { aria, dataset, unsafeHTML, ...rest } = attrs || {};

      // dataset shorthand: { dataset: { key: 'val' } }
      if (dataset && typeof dataset === 'object') {
        Object.entries(dataset).forEach(([k, v]) => (el.dataset[k] = v));
      }

      // aria shorthand: { aria: { role:'...', label:'...', live:'polite', modal:'true', ... } }
      if (aria && typeof aria === 'object') {
        const map = {
          role: 'role',
          label: 'aria-label',
          labelledby: 'aria-labelledby',
          describedby: 'aria-describedby',
          live: 'aria-live',
          modal: 'aria-modal',
          hidden: 'aria-hidden',
          expanded: 'aria-expanded',
          controls: 'aria-controls',
          selected: 'aria-selected',
          pressed: 'aria-pressed'
        };
        Object.entries(aria).forEach(([k, v]) => {
          el.setAttribute(map[k] || k, v);
        });
      }

      Object.entries(rest).forEach(([key, value]) => {
        if (key === 'className' || key === 'class') {
          el.className = value;
        } else if (key === 'textContent' || key === 'innerText') {
          el.textContent = value;
        } else if (key === 'innerHTML' || key === 'html') {
          // 명시적으로 unsafeHTML 옵션을 켠 경우에만 innerHTML 허용
          if (unsafeHTML) el.innerHTML = value;
          else el.textContent = String(value ?? '');
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(el.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
          // onClick, onclick → 'click'
          el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key.startsWith('data-')) {
          el.setAttribute(key, value);
        } else if (key === 'ariaLabel') {
          el.setAttribute('aria-label', value);
        } else if (key === 'ariaRole') {
          el.setAttribute('role', value);
        } else {
          el.setAttribute(key, value);
        }
      });

      (Array.isArray(children) ? children : [children]).forEach(child => {
        if (child == null) return;
        if (typeof child === 'string') el.appendChild(document.createTextNode(child));
        else if (child instanceof Node) el.appendChild(child);
      });

      return el;
    },

    // 가시성 제어 (CSS 클래스 .pyxis-hidden 사용으로 일관화)
    show: (el) => {
      if (el) {
        el.style.display = '';
        el.classList.remove('pyxis-hidden');
        el.setAttribute('aria-hidden', 'false');
      }
    },

    hide: (el) => {
      if (el) {
        el.style.display = 'none';
        el.classList.add('pyxis-hidden');
        el.setAttribute('aria-hidden', 'true');
      }
    },

    toggle: (el, force) => {
      if (!el) return;
      const isHidden = el.style.display === 'none' || el.classList.contains('pyxis-hidden');
      if (typeof force === 'boolean') {
        force ? PyxisUI.show(el) : PyxisUI.hide(el);
      } else {
        isHidden ? PyxisUI.show(el) : PyxisUI.hide(el);
      }
    },

    // 클래스 유틸리티
    addClass: (el, className) => el?.classList.add(className),
    removeClass: (el, className) => el?.classList.remove(className),
    toggleClass: (el, className, force) => el?.classList.toggle(className, force),
    hasClass: (el, className) => el?.classList.contains(className) || false
  };

  // 스타일 주입
  PyxisUI.injectStyles = function() {
    if (document.getElementById('pyxis-ui-styles')) return;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'pyxis-ui-styles';
    styleSheet.textContent = `
      /* PYXIS UI Library Styles */
      
      .pyxis-hidden {
        display: none !important;
      }

      .pyxis-body-locked {
        overflow: hidden !important;
      }

      .pyxis-fade-in {
        animation: pyxisFadeIn 0.3s ease-in-out forwards;
      }

      .pyxis-fade-out {
        animation: pyxisFadeOut 0.3s ease-in-out forwards;
      }

      .pyxis-slide-up {
        animation: pyxisSlideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      .pyxis-slide-down {
        animation: pyxisSlideDown 0.3s ease-in forwards;
      }

      .pyxis-pulse {
        animation: pyxisPulse 2s ease-in-out infinite;
      }

      .pyxis-glow {
        animation: pyxisGlow 2s ease-in-out infinite alternate;
      }

      @keyframes pyxisFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes pyxisFadeOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-10px); }
      }

      @keyframes pyxisSlideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes pyxisSlideDown {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(20px); }
      }

      @keyframes pyxisPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      @keyframes pyxisGlow {
        0% { box-shadow: 0 0 20px rgba(220, 199, 162, 0.3); }
        100% { box-shadow: 0 0 40px rgba(220, 199, 162, 0.6); }
      }

      /* 모달 오버레이 */
      .pyxis-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 8, 13, 0.8);
        backdrop-filter: blur(8px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        animation: pyxisFadeIn 0.3s ease-out forwards;
      }

      .pyxis-modal {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.95), 
          rgba(0, 42, 75, 0.9));
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 16px;
        padding: 24px;
        max-width: 90vw;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(20px);
        transform: scale(0.9);
        animation: pyxisSlideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      .pyxis-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(220, 199, 162, 0.2);
      }

      .pyxis-modal-title {
        font-family: 'Cinzel', serif;
        font-size: 24px;
        font-weight: 600;
        color: #DCC7A2;
        margin: 0;
      }

      .pyxis-modal-close {
        background: rgba(220, 199, 162, 0.1);
        border: 1px solid rgba(220, 199, 162, 0.3);
        border-radius: 8px;
        color: #94A3B8;
        cursor: pointer;
        padding: 8px 12px;
        font-size: 18px;
        line-height: 1;
        transition: all 0.2s ease;
      }

      .pyxis-modal-close:hover {
        background: rgba(220, 199, 162, 0.2);
        color: #DCC7A2;
      }

      /* 폼 스타일 */
      .pyxis-form-group {
        margin-bottom: 20px;
      }

      .pyxis-form-label {
        display: block;
        font-weight: 600;
        color: #DCC7A2;
        font-size: 14px;
        margin-bottom: 8px;
      }

      .pyxis-form-input {
        width: 100%;
        padding: 12px 16px;
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #E2E8F0;
        font-size: 14px;
        font-family: inherit;
        backdrop-filter: blur(4px);
        transition: all 0.3s ease;
      }

      .pyxis-form-input:focus {
        outline: none;
        border-color: #DCC7A2;
        box-shadow: 0 0 0 3px rgba(220, 199, 162, 0.1);
        background: rgba(0, 30, 53, 0.8);
      }

      .pyxis-form-input.error {
        border-color: #EF4444;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
      }

      .pyxis-form-error {
        color: #EF4444;
        font-size: 12px;
        margin-top: 6px;
        display: block;
      }

      /* 버튼 스타일 */
      .pyxis-btn {
        padding: 12px 24px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-radius: 12px;
        background: rgba(0, 30, 53, 0.6);
        color: #DCC7A2;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-family: inherit;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        position: relative;
        overflow: hidden;
      }

      .pyxis-btn:hover:not(:disabled) {
        border-color: #DCC7A2;
        background: rgba(220, 199, 162, 0.15);
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(220, 199, 162, 0.2);
      }

      .pyxis-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .pyxis-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
        box-shadow: none !important;
      }

      .pyxis-btn.primary {
        background: linear-gradient(145deg, #DCC7A2, #D4BA8D);
        color: #00080D;
        border-color: #DCC7A2;
      }

      .pyxis-btn.primary:hover:not(:disabled) {
        background: linear-gradient(145deg, #D4BA8D, #DCC7A2);
        box-shadow: 0 8px 16px rgba(220, 199, 162, 0.3);
      }

      .pyxis-btn.success {
        background: linear-gradient(145deg, #22C55E, #16A34A);
        color: white;
        border-color: #22C55E;
      }

      .pyxis-btn.warning {
        background: linear-gradient(145deg, #F59E0B, #D97706);
        color: white;
        border-color: #F59E0B;
      }

      .pyxis-btn.danger {
        background: linear-gradient(145deg, #EF4444, #DC2626);
        color: white;
        border-color: #EF4444;
      }

      /* 카드 스타일 */
      .pyxis-card {
        background: linear-gradient(145deg, 
          rgba(0, 30, 53, 0.8), 
          rgba(0, 42, 75, 0.7));
        border: 2px solid rgba(220, 199, 162, 0.25);
        border-radius: 16px;
        padding: 20px;
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 32px rgba(0, 8, 13, 0.6);
        transition: all 0.3s ease;
      }

      .pyxis-card:hover {
        border-color: rgba(220, 199, 162, 0.4);
        box-shadow: 0 12px 40px rgba(0, 8, 13, 0.7);
        transform: translateY(-2px);
      }

      .pyxis-card-header {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(220, 199, 162, 0.2);
      }

      .pyxis-card-title {
        font-family: 'Cinzel', serif;
        font-size: 20px;
        font-weight: 600;
        color: #DCC7A2;
        margin: 0;
      }

      .pyxis-card-subtitle {
        color: #94A3B8;
        font-size: 14px;
        margin-top: 4px;
      }

      /* 접근성 */
      @media (prefers-reduced-motion: reduce) {
        .pyxis-fade-in,
        .pyxis-fade-out,
        .pyxis-slide-up,
        .pyxis-slide-down,
        .pyxis-pulse,
        .pyxis-glow,
        .pyxis-btn,
        .pyxis-card {
          animation: none !important;
          transition: none !important;
        }
      }

      /* 고대비 모드 */
      @media (prefers-contrast: high) {
        .pyxis-card,
        .pyxis-modal,
        .pyxis-form-input {
          border-width: 3px;
        }
      }
    `;

    document.head.appendChild(styleSheet);
  };

  // Toast 알림 시스템
  const TOAST_CONTAINER_ID = '__pyxis_toast_container__';

  function ensureToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) return container;

    container = PyxisUI.createElement('div', {
      id: TOAST_CONTAINER_ID,
      style: {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '9999',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        pointerEvents: 'none',
        maxWidth: '420px',
        width: '100%'
      },
      aria: { role: 'region', label: '알림 영역' }
    });

    document.body.appendChild(container);
    return container;
  }

  PyxisUI.toast = function(message, type = 'info', options = {}) {
    const {
      timeout = 4000,
      closable = true,
      persistent = false,
      onClick = null,
      actions = []
    } = options;

    const container = ensureToastContainer();
    
    const colors = {
      info: { bg: 'rgba(59, 130, 246, 0.95)', border: '#3B82F6', icon: 'i' },
      success: { bg: 'rgba(34, 197, 94, 0.95)', border: '#22C55E', icon: '✓' },
      warning: { bg: 'rgba(245, 158, 11, 0.95)', border: '#F59E0B', icon: '!' },
      error: { bg: 'rgba(239, 68, 68, 0.95)', border: '#EF4444', icon: '✕' },
      system: { bg: 'rgba(220, 199, 162, 0.95)', border: '#DCC7A2', icon: 'S' },
      battle: { bg: 'rgba(220, 199, 162, 0.95)', border: '#DCC7A2', icon: 'B' }
    };

    const color = colors[type] || colors.info;
    
    const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const toast = PyxisUI.createElement('div', {
      id: toastId,
      className: 'pyxis-slide-up',
      aria: { role: 'alert', live: (type === 'error' ? 'assertive' : 'polite') },
      style: {
        background: `linear-gradient(145deg, ${color.bg}, ${color.bg}dd)`,
        border: `2px solid ${color.border}`,
        borderLeft: `4px solid ${color.border}`,
        color: 'white',
        padding: '16px 20px',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(12px)',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: '14px',
        fontWeight: '500',
        lineHeight: '1.5',
        pointerEvents: 'auto',
        transform: 'translateX(100%)',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        cursor: onClick || closable ? 'pointer' : 'default',
        maxWidth: '100%',
        wordBreak: 'break-word',
        position: 'relative',
        overflow: 'hidden'
      }
    });

    // 토스트 내용 구성
    const content = PyxisUI.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px'
      }
    });

    // 아이콘
    const icon = PyxisUI.createElement('div', {
      style: {
        width: '24px',
        height: '24px',
        borderRadius: '6px',
        background: 'rgba(255, 255, 255, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: '700',
        flexShrink: '0'
      },
      textContent: color.icon
    });

    // 메시지
    const messageEl = PyxisUI.createElement('div', {
      style: { flex: '1', minWidth: '0' },
      textContent: message
    });

    content.appendChild(icon);
    content.appendChild(messageEl);

    // 액션 버튼들
    if (actions.length > 0) {
      const actionsEl = PyxisUI.createElement('div', {
        style: {
          display: 'flex',
          gap: '8px',
          marginTop: '12px',
          justifyContent: 'flex-end'
        }
      });

      actions.forEach(action => {
        const btn = PyxisUI.createElement('button', {
          className: 'pyxis-btn',
          style: {
            padding: '6px 12px',
            fontSize: '12px',
            minHeight: 'auto',
            background: action.primary ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: 'white'
          },
          textContent: action.label,
          onClick: (e) => {
            e.stopPropagation();
            if (action.callback) action.callback();
            if (action.closeOnClick !== false) remove();
          }
        });
        actionsEl.appendChild(btn);
      });

      content.appendChild(actionsEl);
    }

    // 닫기 버튼
    if (closable) {
      const closeBtn = PyxisUI.createElement('button', {
        style: {
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'rgba(255, 255, 255, 0.2)',
          border: 'none',
          borderRadius: '4px',
          color: 'white',
          cursor: 'pointer',
          padding: '4px 6px',
          fontSize: '12px',
          lineHeight: '1',
          opacity: '0.7',
          transition: 'opacity 0.2s ease'
        },
        textContent: '×',
        onClick: (e) => {
          e.stopPropagation();
          remove();
        },
        onMouseenter: (e) => { e.target.style.opacity = '1'; },
        onMouseleave: (e) => { e.target.style.opacity = '0.7'; }
      });
      toast.appendChild(closeBtn);
    }

    toast.appendChild(content);

    // 프로그레스 바 (자동 제거시)
    if (!persistent && timeout > 0) {
      const progressBar = PyxisUI.createElement('div', {
        style: {
          position: 'absolute',
          bottom: '0',
          left: '0',
          height: '3px',
          background: 'rgba(255, 255, 255, 0.3)',
          borderRadius: '0 0 10px 10px',
          width: '100%',
          transition: `width ${timeout}ms linear`
        }
      });
      toast.appendChild(progressBar);

      setTimeout(() => {
        progressBar.style.width = '0%';
      }, 100);
    }

    container.appendChild(toast);

    // 슬라이드 인 애니메이션
    setTimeout(() => {
      toast.style.transform = 'translateX(0)';
    }, 50);

    // 클릭 이벤트
    if (onClick || closable) {
      toast.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        if (onClick) onClick(e);
        if (closable) remove();
      });
    }

    // 제거 함수
    const remove = () => {
      if (!toast.parentNode) return;
      
      toast.style.transform = 'translateX(100%)';
      toast.style.opacity = '0';
      
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 400);
    };

    // 자동 제거
    if (!persistent && timeout > 0) {
      setTimeout(remove, timeout);
    }

    // 사운드 효과 (PyxisFX 연동)
    if (window.PyxisFX) {
      const soundMap = {
        info: 'soft',
        success: 'heal',
        warning: 'alert',
        error: 'error',
        system: 'soft',
        battle: 'battle'
      };
      window.PyxisFX.playSound(soundMap[type] || 'soft', 600, 0.1, 0.2);
    }

    return { remove, element: toast };
  };

  // 단축 메서드들
  PyxisUI.success = (msg, options = {}) => PyxisUI.toast(msg, 'success', options);
  PyxisUI.error   = (msg, options = {}) => PyxisUI.toast(msg, 'error', options);
  PyxisUI.warning = (msg, options = {}) => PyxisUI.toast(msg, 'warning', options);
  PyxisUI.info    = (msg, options = {}) => PyxisUI.toast(msg, 'info', options);
  PyxisUI.system  = (msg, options = {}) => PyxisUI.toast(msg, 'system', options);
  PyxisUI.battle  = (msg, options = {}) => PyxisUI.toast(msg, 'battle', options);

  // 모달 시스템 (focus trap, body scroll lock, a11y)
  PyxisUI.modal = function(options = {}) {
    const {
      title = '알림',
      content = '',
      closable = true,
      size = 'medium',
      onClose = null,
      className = ''
    } = options;

    const previousActive = document.activeElement;

    // 오버레이 생성
    const overlay = PyxisUI.createElement('div', {
      className: 'pyxis-modal-overlay',
      onClick: (e) => {
        if (e.target === overlay && closable) closeModal();
      }
    });

    // 모달 생성
    const modal = PyxisUI.createElement('div', {
      className: `pyxis-modal ${className}`,
      aria: { role: 'dialog', modal: 'true' },
      style: {
        width: size === 'small' ? '400px' : size === 'large' ? '800px' : '600px'
      }
    });

    // 헤더
    const header = PyxisUI.createElement('div', { className: 'pyxis-modal-header' });
    const titleId = `pyxis-modal-title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const titleEl = PyxisUI.createElement('h2', {
      id: titleId,
      className: 'pyxis-modal-title',
      textContent: title
    });

    modal.setAttribute('aria-labelledby', titleId);
    header.appendChild(titleEl);

    if (closable) {
      const closeBtn = PyxisUI.createElement('button', {
        className: 'pyxis-modal-close',
        textContent: '×',
        onClick: closeModal,
        aria: { label: '닫기' }
      });
      header.appendChild(closeBtn);
    }

    // 컨텐츠
    const contentEl = PyxisUI.createElement('div', { className: 'pyxis-modal-content' });
    if (typeof content === 'string') {
      contentEl.innerHTML = content;
    } else if (content instanceof Node) {
      contentEl.appendChild(content);
    }

    modal.appendChild(header);
    modal.appendChild(contentEl);
    overlay.appendChild(modal);

    // Body scroll lock
    document.body.classList.add('pyxis-body-locked');
    document.body.appendChild(overlay);

    // Focusable elements & focus trap
    const focusSelectors =
      'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
      'textarea:not([disabled]), button:not([disabled]), iframe, object, embed, ' +
      '[contenteditable], [tabindex]:not([tabindex="-1"])';

    let focusables = Array.from(modal.querySelectorAll(focusSelectors));
    if (focusables.length === 0) {
      // 포커스 가능한 요소가 없으면 닫기 버튼을 포커스 타겟으로 보장
      if (closable) {
        const fallbackBtn = header.querySelector('.pyxis-modal-close');
        if (fallbackBtn) focusables = [fallbackBtn];
      } else {
        // 모달 자체에 tabindex로 포커스 가능
        modal.setAttribute('tabindex', '-1');
        focusables = [modal];
      }
    }

    // 최초 포커스
    setTimeout(() => {
      (focusables[0] || modal).focus();
    }, 0);

    const onKeydown = (e) => {
      if (e.key === 'Escape' && closable) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key === 'Tab') {
        // focus trap
        focusables = Array.from(modal.querySelectorAll(focusSelectors));
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !modal.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !modal.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', onKeydown);

    // 모달 닫기
    function closeModal() {
      document.removeEventListener('keydown', onKeydown);
      overlay.style.opacity = '0';
      modal.style.transform = 'scale(0.9)';

      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
        document.body.classList.remove('pyxis-body-locked');
        if (onClose) onClose();
        if (previousActive && typeof previousActive.focus === 'function') {
          previousActive.focus();
        }
      }, 300);
    }

    return {
      close: closeModal,
      element: modal,
      overlay: overlay
    };
  };

  // 확인 다이얼로그
  PyxisUI.confirm = function(message, options = {}) {
    const {
      title = '확인',
      confirmText = '확인',
      cancelText = '취소',
      onConfirm = null,
      onCancel = null
    } = options;

    return new Promise((resolve) => {
      const content = PyxisUI.createElement('div', {
        style: { textAlign: 'center', padding: '20px 0' }
      });

      const messageEl = PyxisUI.createElement('p', {
        style: {
          color: '#E2E8F0',
          fontSize: '16px',
          lineHeight: '1.5',
          marginBottom: '24px'
        },
        textContent: message
      });

      const actions = PyxisUI.createElement('div', {
        style: {
          display: 'flex',
          gap: '12px',
          justifyContent: 'center'
        }
      });

      const cancelBtn = PyxisUI.createElement('button', {
        className: 'pyxis-btn',
        textContent: cancelText,
        onClick: () => {
          modal.close();
          if (onCancel) onCancel();
          resolve(false);
        }
      });

      const confirmBtn = PyxisUI.createElement('button', {
        className: 'pyxis-btn primary',
        textContent: confirmText,
        onClick: () => {
          modal.close();
          if (onConfirm) onConfirm();
          resolve(true);
        }
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      content.appendChild(messageEl);
      content.appendChild(actions);

      const modal = PyxisUI.modal({
        title,
        content,
        closable: true,
        onClose: () => resolve(false)
      });

      // 확인 버튼에 포커스
      setTimeout(() => confirmBtn.focus(), 100);
    });
  };

  // 로딩 시스템
  PyxisUI.startLoading = function(target, options = {}) {
    if (!target) return () => {};

    const {
      overlay = true,
      text = '로딩 중...',
      size = 'medium',
      color = '#DCC7A2'
    } = options;

    const loadingId = `__pyxis_loading_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const spinner = PyxisUI.createElement('div', {
      id: loadingId,
      style: overlay ? {
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 8, 13, 0.8)',
        backdropFilter: 'blur(4px)',
        color: color,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: '600',
        zIndex: '1000',
        borderRadius: 'inherit',
        flexDirection: 'column',
        gap: '12px'
      } : {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        color: color,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: '14px',
        fontWeight: '500'
      }
    });

    // 스피너 아이콘
    const spinnerSize = size === 'small' ? '16px' : size === 'large' ? '32px' : '24px';
    const spinnerIcon = PyxisUI.createElement('div', {
      style: {
        width: spinnerSize,
        height: spinnerSize,
        border: `3px solid rgba(220, 199, 162, 0.3)`,
        borderTop: `3px solid ${color}`,
        borderRadius: '50%',
        animation: 'pyxisSpin 1s linear infinite'
      }
    });

    // 스핀 애니메이션 스타일 추가
    if (!document.getElementById('pyxis-spinner-animation')) {
      const style = PyxisUI.createElement('style', {
        id: 'pyxis-spinner-animation',
        textContent: '@keyframes pyxisSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'
      });
      document.head.appendChild(style);
    }

    spinner.appendChild(spinnerIcon);
    
    if (text) {
      const textEl = PyxisUI.createElement('div', {
        textContent: text,
        style: {
          fontSize: overlay ? '14px' : '13px',
          fontWeight: overlay ? '500' : '400'
        }
      });
      spinner.appendChild(textEl);
    }

    // 타겟에 상대 위치 설정
    if (overlay && getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }

    target.appendChild(spinner);

    return () => {
      const el = document.getElementById(loadingId);
      if (el && el.parentNode) {
        el.remove();
      }
    };
  };

  // 버튼 로딩 상태 (a11y: aria-busy/aria-disabled)
  PyxisUI.setLoading = function(button, isLoading, loadingText = '처리중...') {
    if (!button) return;

    if (isLoading) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
      button.dataset.originalText = button.textContent;
      button.dataset.originalHTML = button.innerHTML;
      
      const spinner = PyxisUI.createElement('div', {
        style: {
          display: 'inline-block',
          width: '14px',
          height: '14px',
          border: '2px solid rgba(255, 255, 255, 0.3)',
          borderTop: '2px solid currentColor',
          borderRadius: '50%',
          animation: 'pyxisSpin 1s linear infinite',
          marginRight: '6px'
        }
      });

      button.innerHTML = '';
      button.appendChild(spinner);
      button.appendChild(document.createTextNode(loadingText));
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-disabled');
      
      if (button.dataset.originalHTML) {
        button.innerHTML = button.dataset.originalHTML;
        delete button.dataset.originalHTML;
      } else {
        button.textContent = button.dataset.originalText || '완료';
      }
      
      delete button.dataset.originalText;
    }
  };

  // 폼 검증 시스템 (라디오/체크박스 개선, a11y 속성)
  PyxisUI.validateForm = function(form, rules = {}) {
    if (!form) return { valid: false, errors: ['폼을 찾을 수 없습니다'], data: {} };

    const data = {};
    const errors = [];
    const formData = new FormData(form);

    // 기본 값 채우기
    for (const [name, value] of formData.entries()) {
      if (data.hasOwnProperty(name)) {
        // 같은 이름의 필드가 여러 개인 경우(checkbox 등) 배열로 수집
        if (Array.isArray(data[name])) data[name].push(value);
        else data[name] = [data[name], value];
      } else {
        data[name] = value;
      }
    }

    // 체크박스 그룹 처리 (단일 체크박스는 boolean, 복수는 값 배열)
    const checkboxNames = new Set(Array.from(form.querySelectorAll('input[type="checkbox"]')).map(i => i.name).filter(Boolean));
    checkboxNames.forEach(name => {
      const boxes = Array.from(form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`));
      if (boxes.length === 1) {
        data[name] = boxes[0].checked ? (boxes[0].value || true) : false;
      } else if (boxes.length > 1) {
        const checkedVals = boxes.filter(b => b.checked).map(b => b.value || 'on');
        data[name] = checkedVals; // 빈 배열 허용
      }
    });

    // 라디오 그룹 처리 (선택된 값 또는 빈 문자열)
    const radioNames = new Set(Array.from(form.querySelectorAll('input[type="radio"]')).map(i => i.name).filter(Boolean));
    radioNames.forEach(name => {
      const selected = form.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
      data[name] = selected ? selected.value : '';
    });

    // 규칙 검증
    for (const [field, rule] of Object.entries(rules)) {
      const value = data[field];
      const label = rule.label || field;
      const element = form.querySelector(`[name="${CSS.escape(field)}"]`);

      const markError = (el, msg) => {
        if (!el) return;
        el.classList.add('error');
        PyxisUI.showFieldError(el, msg);
      };

      // 필수
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'boolean' && value === false && rule.requiredStrictBoolean);

      if (rule.required && isEmpty) {
        const msg = `${label}은(는) 필수입니다.`;
        errors.push(msg);
        if (element) markError(element, msg);
        continue;
      }

      // 값이 없으면 이후 검증 생략
      if (isEmpty) {
        if (element) {
          element.classList.remove('error');
          PyxisUI.clearFieldError(element);
        }
        continue;
      }

      // 길이
      if (typeof value === 'string') {
        if (rule.minLength && value.length < rule.minLength) {
          const msg = `${label}은 최소 ${rule.minLength}자 이상이어야 합니다.`;
          errors.push(msg);
          if (element) markError(element, msg);
          continue;
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          const msg = `${label}은 최대 ${rule.maxLength}자 이하여야 합니다.`;
          errors.push(msg);
          if (element) markError(element, msg);
          continue;
        }
      }

      // 패턴
      if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
        const msg = rule.message || `${label} 형식이 올바르지 않습니다.`;
        errors.push(msg);
        if (element) markError(element, msg);
        continue;
      }

      // 커스텀
      if (rule.validator && typeof rule.validator === 'function') {
        const result = rule.validator(value, data);
        if (result !== true) {
          const msg = typeof result === 'string' ? result : `${label}이(가) 유효하지 않습니다.`;
          errors.push(msg);
          if (element) markError(element, msg);
          continue;
        }
      }

      // 통과
      if (element) {
        element.classList.remove('error');
        PyxisUI.clearFieldError(element);
      }
    }

    return {
      valid: errors.length === 0,
      data,
      errors
    };
  };

  // 필드 에러 표시 (a11y: aria-invalid, aria-describedby 관리)
  PyxisUI.showFieldError = function(element, message) {
    if (!element) return;

    // 기존 에러 제거
    PyxisUI.clearFieldError(element);

    const baseId = element.id || element.name || `pyxis-field-${Math.random().toString(36).slice(2, 8)}`;
    const errId = `pyxis-err-${baseId}-${Date.now()}`;

    const errorEl = PyxisUI.createElement('span', {
      id: errId,
      className: 'pyxis-form-error',
      textContent: message
    });

    // aria 속성
    element.setAttribute('aria-invalid', 'true');
    const currentDesc = (element.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    currentDesc.push(errId);
    element.setAttribute('aria-describedby', Array.from(new Set(currentDesc)).join(' '));
    element.dataset.pyxisErrId = errId;

    // 에러 메시지를 필드 다음에 삽입
    if (element.parentNode) {
      element.parentNode.insertBefore(errorEl, element.nextSibling);
    }
  };

  // 필드 에러 제거
  PyxisUI.clearFieldError = function(element) {
    if (!element) return;

    // 형제 에러 엘리먼트 제거
    const nextSibling = element.nextElementSibling;
    if (nextSibling && nextSibling.classList.contains('pyxis-form-error')) {
      nextSibling.remove();
    }

    // aria 속성 정리
    element.removeAttribute('aria-invalid');
    const errId = element.dataset.pyxisErrId;
    if (errId) {
      const currentDesc = (element.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      const filtered = currentDesc.filter(id => id !== errId);
      if (filtered.length > 0) element.setAttribute('aria-describedby', filtered.join(' '));
      else element.removeAttribute('aria-describedby');
      delete element.dataset.pyxisErrId;
    }
  };

  // 클립보드 복사
  PyxisUI.copyToClipboard = async function(text, button = null) {
    try {
      await navigator.clipboard.writeText(text);
      
      if (button) {
        const original = button.textContent;
        button.textContent = '복사됨!';
        button.classList.add('success');
        
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove('success');
        }, 2000);
      }

      PyxisUI.success('클립보드에 복사되었습니다');
      
      // 사운드 효과
      if (window.PyxisFX) {
        window.PyxisFX.playSound('soft', 800, 0.1, 0.2);
      }

      return true;
    } catch (err) {
      console.warn('클립보드 복사 실패:', err);
      
      // 폴백: 텍스트 선택
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          PyxisUI.success('클립보드에 복사되었습니다');
          return true;
        }
      } catch (fallbackErr) {
        console.warn('폴백 복사도 실패:', fallbackErr);
      }

      PyxisUI.error('클립보드 복사에 실패했습니다');
      return false;
    }
  };

  // 애니메이션 유틸리티
  PyxisUI.fadeIn = function(element, duration = 300) {
    if (!element) return Promise.resolve();

    element.style.opacity = '0';
    PyxisUI.show(element);

    return element.animate([
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], {
      duration,
      fill: 'forwards',
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    }).finished;
  };

  PyxisUI.fadeOut = function(element, duration = 300) {
    if (!element) return Promise.resolve();

    return element.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-10px)' }
    ], {
      duration,
      fill: 'forwards',
      easing: 'ease-in-out'
    }).finished.then(() => {
      PyxisUI.hide(element);
    });
  };

  PyxisUI.slideUp = function(element, duration = 400) {
    if (!element) return Promise.resolve();

    element.style.opacity = '0';
    element.style.transform = 'translateY(20px)';
    PyxisUI.show(element);

    return element.animate([
      { opacity: 0, transform: 'translateY(20px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], {
      duration,
      fill: 'forwards',
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    }).finished;
  };

  PyxisUI.slideDown = function(element, duration = 300) {
    if (!element) return Promise.resolve();

    return element.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(20px)' }
    ], {
      duration,
      fill: 'forwards',
      easing: 'ease-in'
    }).finished.then(() => {
      PyxisUI.hide(element);
    });
  };

  // 유틸리티 함수들
  PyxisUI.debounce = function(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  PyxisUI.throttle = function(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  };

  // 폼 생성 헬퍼
  PyxisUI.createForm = function(fields, options = {}) {
    const {
      onSubmit = null,
      className = 'pyxis-form',
      submitText = '제출',
      cancelText = '취소',
      showCancel = false
    } = options;

    const form = PyxisUI.createElement('form', {
      className,
      onSubmit: (e) => {
        e.preventDefault();
        if (onSubmit) onSubmit(e, form);
      }
    });

    fields.forEach(field => {
      const group = PyxisUI.createElement('div', {
        className: 'pyxis-form-group'
      });

      if (field.label) {
        const label = PyxisUI.createElement('label', {
          className: 'pyxis-form-label',
          textContent: field.label,
          for: field.name
        });
        group.appendChild(label);
      }

      const isTextarea = field.type === 'textarea';
      const input = PyxisUI.createElement(isTextarea ? 'textarea' : 'input', {
        className: 'pyxis-form-input',
        name: field.name,
        id: field.name,
        type: isTextarea ? undefined : (field.type || 'text'),
        placeholder: field.placeholder || '',
        required: field.required || false,
        value: isTextarea ? undefined : (field.value || '')
      });

      if (isTextarea && field.value) input.textContent = field.value;

      if (field.attributes) {
        Object.entries(field.attributes).forEach(([key, value]) => {
          input.setAttribute(key, value);
        });
      }

      group.appendChild(input);
      form.appendChild(group);
    });

    // 버튼 그룹
    const buttonGroup = PyxisUI.createElement('div', {
      style: {
        display: 'flex',
        gap: '12px',
        justifyContent: 'flex-end',
        marginTop: '20px'
      }
    });

    if (showCancel) {
      const cancelBtn = PyxisUI.createElement('button', {
        type: 'button',
        className: 'pyxis-btn',
        textContent: cancelText
      });
      buttonGroup.appendChild(cancelBtn);
    }

    const submitBtn = PyxisUI.createElement('button', {
      type: 'submit',
      className: 'pyxis-btn primary',
      textContent: submitText
    });
    buttonGroup.appendChild(submitBtn);

    form.appendChild(buttonGroup);

    return form;
  };

  // 카드 생성 헬퍼
  PyxisUI.createCard = function(options = {}) {
    const {
      title = '',
      subtitle = '',
      content = '',
      actions = [],
      className = '',
      onClick = null
    } = options;

    const card = PyxisUI.createElement('div', {
      className: `pyxis-card ${className}`,
      onClick: onClick
    });

    if (title || subtitle) {
      const header = PyxisUI.createElement('div', {
        className: 'pyxis-card-header'
      });

      if (title) {
        const titleEl = PyxisUI.createElement('h3', {
          className: 'pyxis-card-title',
          textContent: title
        });
        header.appendChild(titleEl);
      }

      if (subtitle) {
        const subtitleEl = PyxisUI.createElement('div', {
          className: 'pyxis-card-subtitle',
          textContent: subtitle
        });
        header.appendChild(subtitleEl);
      }

      card.appendChild(header);
    }

    if (content) {
      const contentEl = PyxisUI.createElement('div', {
        className: 'pyxis-card-content'
      });

      if (typeof content === 'string') {
        contentEl.innerHTML = content;
      } else if (content instanceof Node) {
        contentEl.appendChild(content);
      }

      card.appendChild(contentEl);
    }

    if (actions.length > 0) {
      const actionsEl = PyxisUI.createElement('div', {
        className: 'pyxis-card-actions',
        style: {
          display: 'flex',
          gap: '8px',
          justifyContent: 'flex-end',
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid rgba(220, 199, 162, 0.2)'
        }
      });

      actions.forEach(action => {
        const btn = PyxisUI.createElement('button', {
          className: `pyxis-btn ${action.variant || ''}`,
          textContent: action.label,
          onClick: action.onClick
        });
        actionsEl.appendChild(btn);
      });

      card.appendChild(actionsEl);
    }

    return card;
  };

  // 초기화
  PyxisUI.init = function() {
    PyxisUI.injectStyles();
    
    // PyxisFX 연동
    if (window.PyxisFX) {
      window.PyxisFX.enhanceClicks();
    }

    console.log('PYXIS UI Library initialized');
  };

  // DOM 로드시 자동 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', PyxisUI.init);
  } else {
    PyxisUI.init();
  }

  // 전역 등록
  if (typeof global.UI === 'undefined') {
    global.UI = PyxisUI;
    global.PyxisUI = PyxisUI;
  }

  // 모듈 시스템 지원
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PyxisUI;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => PyxisUI);
  }

})(typeof window !== 'undefined' ? window : this);
