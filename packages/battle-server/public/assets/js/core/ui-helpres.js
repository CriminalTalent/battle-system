/* packages/battle-server/public/assets/js/core/ui-helpers.js
 * ────────────────────────────────────────────────────────────────────
 * PYXIS UI Helpers - 공통 유틸리티 라이브러리
 * - DOM 조작 헬퍼 (선택자, 이벤트)
 * - 토스트 알림 시스템
 * - 로딩 상태 관리
 * - 폼 검증
 * - 클립보드 복사
 * - 파일 처리
 * - 디자인 시스템 유지 (네이비+골드)
 * ────────────────────────────────────────────────────────────────────
 */

(function(global) {
  'use strict';

  // ════════════════════════════════════════════════════════════════════
  // DOM Helpers
  // ════════════════════════════════════════════════════════════════════
  
  const UI = {
    // 단일 요소 선택
    $: (selector, context = document) => {
      return context.querySelector(selector);
    },

    // 다중 요소 선택
    $$: (selector, context = document) => {
      return Array.from(context.querySelectorAll(selector));
    },

    // 요소 생성 헬퍼
    createElement: (tag, attrs = {}, children = []) => {
      const el = document.createElement(tag);
      
      Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'className' || key === 'class') {
          el.className = value;
        } else if (key === 'textContent' || key === 'innerText') {
          el.textContent = value;
        } else if (key === 'innerHTML') {
          el.innerHTML = value;
        } else if (key.startsWith('on')) {
          el.addEventListener(key.slice(2), value);
        } else {
          el.setAttribute(key, value);
        }
      });

      (Array.isArray(children) ? children : [children]).forEach(child => {
        if (child == null) return;
        el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });

      return el;
    },

    // 요소 표시/숨김
    show: (element) => {
      if (!element) return;
      element.style.display = '';
      element.classList.remove('hidden');
    },

    hide: (element) => {
      if (!element) return;
      element.style.display = 'none';
      element.classList.add('hidden');
    },

    toggle: (element, force) => {
      if (!element) return;
      const isHidden = element.style.display === 'none' || element.classList.contains('hidden');
      
      if (typeof force === 'boolean') {
        force ? UI.show(element) : UI.hide(element);
      } else {
        isHidden ? UI.show(element) : UI.hide(element);
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // Toast Notification System
  // ════════════════════════════════════════════════════════════════════
  
  const TOAST_CONTAINER_ID = '__pyxis_toast_container__';
  
  function ensureToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) return container;
    
    container = UI.createElement('div', {
      id: TOAST_CONTAINER_ID,
      style: `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
        max-width: 400px;
      `
    });
    
    document.body.appendChild(container);
    return container;
  }

  UI.toast = function(message, type = 'info', timeout = 3000) {
    const container = ensureToastContainer();
    
    const colors = {
      info: { bg: 'rgba(52, 152, 219, 0.95)', border: '#3498DB' },
      success: { bg: 'rgba(39, 174, 96, 0.95)', border: '#27AE60' },
      warning: { bg: 'rgba(243, 156, 18, 0.95)', border: '#F39C12' },
      error: { bg: 'rgba(231, 76, 60, 0.95)', border: '#E74C3C' },
      system: { bg: 'rgba(220, 199, 162, 0.95)', border: '#DCC7A2' }
    };
    
    const color = colors[type] || colors.info;
    
    const toast = UI.createElement('div', {
      style: `
        background: ${color.bg};
        border-left: 4px solid ${color.border};
        color: white;
        padding: 14px 18px;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(8px);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 14px;
        font-weight: 500;
        line-height: 1.4;
        pointer-events: auto;
        transform: translateX(100%);
        transition: all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
        cursor: pointer;
        max-width: 100%;
        word-break: break-word;
      `,
      textContent: message
    });

    container.appendChild(toast);
    
    // 애니메이션 시작
    setTimeout(() => {
      toast.style.transform = 'translateX(0)';
    }, 50);

    const remove = () => {
      if (!toast.parentNode) return;
      toast.style.transform = 'translateX(100%)';
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    };

    // 클릭으로 제거
    toast.addEventListener('click', remove);

    // 자동 제거
    if (timeout > 0) {
      setTimeout(remove, timeout);
    }

    return { remove };
  };

  // 편의 메소드들
  UI.success = (msg, timeout) => UI.toast(msg, 'success', timeout);
  UI.error = (msg, timeout) => UI.toast(msg, 'error', timeout);
  UI.warning = (msg, timeout) => UI.toast(msg, 'warning', timeout);
  UI.info = (msg, timeout) => UI.toast(msg, 'info', timeout);
  UI.system = (msg, timeout) => UI.toast(msg, 'system', timeout);

  // ════════════════════════════════════════════════════════════════════
  // Loading System
  // ════════════════════════════════════════════════════════════════════
  
  UI.startLoading = function(target, options = {}) {
    if (!target) return () => {};
    
    const opts = {
      overlay: true,
      text: '로딩 중...',
      ...options
    };

    const loadingId = `__loading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const spinner = UI.createElement('div', {
      id: loadingId,
      style: opts.overlay ? 
        `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(13, 27, 42, 0.8);
          backdrop-filter: blur(4px);
          color: #DCC7A2;
          font-family: 'Inter', system-ui, sans-serif;
          font-weight: 600;
          z-index: 1000;
          border-radius: inherit;
        ` : 
        `
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #DCC7A2;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 14px;
          font-weight: 500;
        `
    });

    const spinnerIcon = UI.createElement('div', {
      style: `
        width: 20px;
        height: 20px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-top: 2px solid #DCC7A2;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 8px;
      `
    });

    // CSS 애니메이션 추가
    if (!document.getElementById('pyxis-spinner-styles')) {
      const style = UI.createElement('style', {
        id: 'pyxis-spinner-styles',
        textContent: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `
      });
      document.head.appendChild(style);
    }

    spinner.appendChild(spinnerIcon);
    if (opts.text) {
      spinner.appendChild(document.createTextNode(opts.text));
    }

    if (opts.overlay) {
      const rect = target.getBoundingClientRect();
      if (getComputedStyle(target).position === 'static') {
        target.style.position = 'relative';
      }
    }

    target.appendChild(spinner);

    return function stopLoading() {
      const el = document.getElementById(loadingId);
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    };
  };

  UI.setLoading = function(button, isLoading) {
    if (!button) return;
    
    if (isLoading) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      
      const spinner = UI.createElement('div', {
        style: `
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top: 2px solid currentColor;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 6px;
        `
      });
      
      button.innerHTML = '';
      button.appendChild(spinner);
      button.appendChild(document.createTextNode('처리중...'));
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || '완료';
      delete button.dataset.originalText;
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // Form Validation
  // ════════════════════════════════════════════════════════════════════
  
  UI.validateForm = function(form, rules = {}) {
    if (!form) return { valid: false, errors: ['폼을 찾을 수 없습니다'] };

    const data = {};
    const errors = [];
    
    // FormData로 모든 필드 수집
    const formData = new FormData(form);
    
    for (const [name, value] of formData.entries()) {
      data[name] = value;
    }

    // 규칙 검증
    Object.entries(rules).forEach(([fieldName, rule]) => {
      const value = data[fieldName];
      const label = rule.label || fieldName;

      if (rule.required && (!value || value.trim() === '')) {
        errors.push(`${label}은(는) 필수입니다.`);
        return;
      }

      if (value && rule.minLength && value.length < rule.minLength) {
        errors.push(`${label}은(는) 최소 ${rule.minLength}자 이상이어야 합니다.`);
      }

      if (value && rule.maxLength && value.length > rule.maxLength) {
        errors.push(`${label}은(는) 최대 ${rule.maxLength}자 이하여야 합니다.`);
      }

      if (value && rule.pattern && !rule.pattern.test(value)) {
        errors.push(`${label}의 형식이 올바르지 않습니다.`);
      }

      if (value && rule.min && parseInt(value) < rule.min) {
        errors.push(`${label}은(는) 최소 ${rule.min} 이상이어야 합니다.`);
      }

      if (value && rule.max && parseInt(value) > rule.max) {
        errors.push(`${label}은(는) 최대 ${rule.max} 이하여야 합니다.`);
      }
    });

    return {
      valid: errors.length === 0,
      data,
      errors
    };
  };

  // ════════════════════════════════════════════════════════════════════
  // Clipboard Utilities
  // ════════════════════════════════════════════════════════════════════
  
  UI.copyToClipboard = async function(text, button = null) {
    try {
      await navigator.clipboard.writeText(text);
      
      if (button) {
        const original = button.textContent;
        button.textContent = '복사됨!';
        button.classList.add('copied');
        
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove('copied');
        }, 2000);
      }
      
      UI.success('클립보드에 복사되었습니다');
      return true;
    } catch (error) {
      console.error('클립보드 복사 실패:', error);
      
      // 폴백: 텍스트 선택 방식
      try {
        const textArea = UI.createElement('textarea', {
          value: text,
          style: 'position: fixed; left: -9999px; top: -9999px;'
        });
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        UI.success('클립보드에 복사되었습니다');
        return true;
      } catch (fallbackError) {
        UI.error('클립보드 복사에 실패했습니다');
        return false;
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // File Utilities
  // ════════════════════════════════════════════════════════════════════
  
  UI.handleFileUpload = function(file, options = {}) {
    const opts = {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      ...options
    };

    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('파일이 선택되지 않았습니다'));
        return;
      }

      if (file.size > opts.maxSize) {
        reject(new Error(`파일 크기가 ${Math.round(opts.maxSize / 1024 / 1024)}MB를 초과합니다`));
        return;
      }

      if (opts.allowedTypes.length > 0 && !opts.allowedTypes.includes(file.type)) {
        reject(new Error('지원하지 않는 파일 형식입니다'));
        return;
      }

      const reader = new FileReader();
      
      reader.onload = (e) => {
        resolve({
          file,
          data: e.target.result,
          name: file.name,
          type: file.type,
          size: file.size
        });
      };
      
      reader.onerror = () => {
        reject(new Error('파일 읽기에 실패했습니다'));
      };
      
      reader.readAsDataURL(file);
    });
  };

  // ════════════════════════════════════════════════════════════════════
  // Visual Feedback
  // ════════════════════════════════════════════════════════════════════
  
  UI.showFeedback = function(element, type = 'success', duration = 2000) {
    if (!element) return;

    const colors = {
      success: '#27AE60',
      error: '#E74C3C',
      warning: '#F39C12',
      info: '#3498DB'
    };

    const originalBorder = element.style.border;
    const originalBoxShadow = element.style.boxShadow;
    
    const color = colors[type] || colors.success;
    
    element.style.border = `2px solid ${color}`;
    element.style.boxShadow = `0 0 0 3px ${color}33`;
    element.style.transition = 'all 0.3s ease';

    setTimeout(() => {
      element.style.border = originalBorder;
      element.style.boxShadow = originalBoxShadow;
    }, duration);
  };

  // ════════════════════════════════════════════════════════════════════
  // Debounce & Throttle
  // ════════════════════════════════════════════════════════════════════
  
  UI.debounce = function(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        timeout = null;
        if (!immediate) func.apply(this, args);
      };
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(this, args);
    };
  };

  UI.throttle = function(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  };

  // ════════════════════════════════════════════════════════════════════
  // Animation Helpers
  // ════════════════════════════════════════════════════════════════════
  
  UI.animate = function(element, keyframes, options = {}) {
    if (!element || !element.animate) {
      console.warn('Web Animations API not supported');
      return Promise.resolve();
    }

    const defaultOptions = {
      duration: 300,
      easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
      fill: 'forwards'
    };

    return element.animate(keyframes, { ...defaultOptions, ...options });
  };

  UI.fadeIn = function(element, duration = 300) {
    if (!element) return Promise.resolve();
    
    element.style.opacity = '0';
    UI.show(element);
    
    return UI.animate(element, [
      { opacity: 0 },
      { opacity: 1 }
    ], { duration });
  };

  UI.fadeOut = function(element, duration = 300) {
    if (!element) return Promise.resolve();
    
    return UI.animate(element, [
      { opacity: 1 },
      { opacity: 0 }
    ], { duration }).then(() => {
      UI.hide(element);
    });
  };

  // ════════════════════════════════════════════════════════════════════
  // Keyboard Shortcuts
  // ════════════════════════════════════════════════════════════════════
  
  const shortcuts = new Map();
  
  UI.addShortcut = function(combination, callback, description = '') {
    const key = combination.toLowerCase();
    shortcuts.set(key, { callback, description });
  };

  UI.removeShortcut = function(combination) {
    shortcuts.delete(combination.toLowerCase());
  };

  // 키보드 이벤트 리스너 설정
  document.addEventListener('keydown', (e) => {
    const combo = [];
    
    if (e.ctrlKey) combo.push('ctrl');
    if (e.altKey) combo.push('alt');
    if (e.shiftKey) combo.push('shift');
    if (e.metaKey) combo.push('meta');
    
    const key = e.key.toLowerCase();
    combo.push(key);
    
    const combination = combo.join('+');
    const shortcut = shortcuts.get(combination);
    
    if (shortcut) {
      e.preventDefault();
      shortcut.callback(e);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Global Export
  // ════════════════════════════════════════════════════════════════════
  
  // 전역 객체에 UI 헬퍼 등록
  if (typeof global.UI === 'undefined') {
    global.UI = UI;
  }

  // CommonJS/AMD 호환성
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => UI);
  }

})(typeof window !== 'undefined' ? window : this);
