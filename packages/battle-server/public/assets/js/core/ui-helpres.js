(function(global) {
  'use strict';

  const UI = {
    $: (selector, context = document) => context.querySelector(selector),
    $$: (selector, context = document) => Array.from(context.querySelectorAll(selector)),

    createElement: (tag, attrs = {}, children = []) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'className' || key === 'class') el.className = value;
        else if (key === 'textContent' || key === 'innerText') el.textContent = value;
        else if (key === 'innerHTML') el.innerHTML = value;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value);
      });
      (Array.isArray(children) ? children : [children]).forEach(child => {
        if (child != null) el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
      return el;
    },

    show: (el) => { if (el) { el.style.display = ''; el.classList.remove('hidden'); } },
    hide: (el) => { if (el) { el.style.display = 'none'; el.classList.add('hidden'); } },
    toggle: (el, force) => {
      if (!el) return;
      const isHidden = el.style.display === 'none' || el.classList.contains('hidden');
      if (typeof force === 'boolean') force ? UI.show(el) : UI.hide(el);
      else isHidden ? UI.show(el) : UI.hide(el);
    }
  };

  // Toast Notification
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
        transition: all 0.3s ease;
        cursor: pointer;
        max-width: 100%;
        word-break: break-word;
      `,
      textContent: message
    });
    container.appendChild(toast);
    setTimeout(() => { toast.style.transform = 'translateX(0)'; }, 50);
    const remove = () => {
      if (!toast.parentNode) return;
      toast.style.transform = 'translateX(100%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', remove);
    if (timeout > 0) setTimeout(remove, timeout);
    return { remove };
  };

  UI.success = (msg, t) => UI.toast(msg, 'success', t);
  UI.error = (msg, t) => UI.toast(msg, 'error', t);
  UI.warning = (msg, t) => UI.toast(msg, 'warning', t);
  UI.info = (msg, t) => UI.toast(msg, 'info', t);
  UI.system = (msg, t) => UI.toast(msg, 'system', t);

  // Loading
  UI.startLoading = function(target, opts = {}) {
    if (!target) return () => {};
    const options = { overlay: true, text: '로딩 중...', ...opts };
    const loadingId = `__loading_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const spinner = UI.createElement('div', {
      id: loadingId,
      style: options.overlay ?
        `
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(13,27,42,0.8);
          backdrop-filter: blur(4px);
          color: #DCC7A2;
          font-family: Inter, system-ui, sans-serif;
          font-weight: 600;
          z-index: 1000;
          border-radius: inherit;
        ` : `
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #DCC7A2;
          font-family: Inter, system-ui, sans-serif;
          font-size: 14px;
          font-weight: 500;
        `
    });
    const spinnerIcon = UI.createElement('div', {
      style: `
        width: 20px; height: 20px;
        border: 2px solid rgba(220, 199, 162, 0.3);
        border-top: 2px solid #DCC7A2;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 8px;
      `
    });

    if (!document.getElementById('pyxis-spinner-styles')) {
      const style = UI.createElement('style', {
        id: 'pyxis-spinner-styles',
        textContent: `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`
      });
      document.head.appendChild(style);
    }

    spinner.appendChild(spinnerIcon);
    if (options.text) spinner.appendChild(document.createTextNode(options.text));
    if (options.overlay && getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }
    target.appendChild(spinner);

    return () => {
      const el = document.getElementById(loadingId);
      if (el && el.parentNode) el.remove();
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

  UI.validateForm = function(form, rules = {}) {
    if (!form) return { valid: false, errors: ['폼을 찾을 수 없습니다'] };
    const data = {};
    const errors = [];
    const formData = new FormData(form);

    for (const [name, value] of formData.entries()) {
      data[name] = value;
    }

    for (const [field, rule] of Object.entries(rules)) {
      const value = data[field];
      const label = rule.label || field;

      if (rule.required && (!value || value.trim() === '')) {
        errors.push(`${label}은(는) 필수입니다.`);
        continue;
      }
      if (value && rule.minLength && value.length < rule.minLength) {
        errors.push(`${label}은 최소 ${rule.minLength}자 이상이어야 합니다.`);
      }
      if (value && rule.maxLength && value.length > rule.maxLength) {
        errors.push(`${label}은 최대 ${rule.maxLength}자 이하여야 합니다.`);
      }
      if (value && rule.pattern && !rule.pattern.test(value)) {
        errors.push(`${label} 형식이 올바르지 않습니다.`);
      }
    }

    return { valid: errors.length === 0, data, errors };
  };

  UI.copyToClipboard = async function(text, btn = null) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '복사됨';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }
      UI.success('클립보드에 복사됨');
      return true;
    } catch (err) {
      console.warn('클립보드 복사 실패', err);
      return false;
    }
  };

  UI.fadeIn = function(el, duration = 300) {
    if (!el) return;
    el.style.opacity = '0';
    UI.show(el);
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration, fill: 'forwards', easing: 'ease-in-out'
    });
  };

  UI.fadeOut = function(el, duration = 300) {
    if (!el) return;
    return el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration, fill: 'forwards', easing: 'ease-in-out'
    }).finished.then(() => UI.hide(el));
  };

  if (typeof global.UI === 'undefined') {
    global.UI = UI;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => UI);
  }

})(typeof window !== 'undefined' ? window : this);
