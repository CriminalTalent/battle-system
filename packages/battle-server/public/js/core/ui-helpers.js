/* packages/battle-server/public/js/core/ui-helpers.js
 * ─────────────────────────────────────────────────────────────
 * PYXIS UI Helpers - Enhanced Design Version
 * - DOM 셀렉터/이벤트/클래스/표시/렌더 보일러플레이트
 * - 포맷터(시간/숫자/HP바) + 게임적 효과
 * - 토스트/로딩 인디케이터(PYXIS 테마)
 * - 쿼리스트링 파서, 로컬스토리지 헬퍼
 * - 디바운스/스로틀 + 게임 효과
 * - 알림 훅(notifications.js 연동)
 * - 향상된 접근성 및 애니메이션 효과
 * ─────────────────────────────────────────────────────────────
 */

/* =========================
 * DOM 기본 (강화된 버전)
 * ========================= */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, evt, handler, opts) {
  if (!el) return () => {};
  el.addEventListener(evt, handler, opts);
  return () => el.removeEventListener(evt, handler, opts);
}

// 이벤트 위임 (강화된 에러 처리)
export function delegate(root, evt, selector, handler) {
  if (!root) return () => {};
  return on(root, evt, (e) => {
    try {
      const target = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (target && root.contains(target)) handler(e, target);
    } catch (error) {
      console.warn('[UI] Event delegation error:', error);
    }
  });
}

export const addClass = (el, ...cls) => el && el.classList.add(...cls);
export const removeClass = (el, ...cls) => el && el.classList.remove(...cls);
export const toggleClass = (el, cls, force) => el && el.classList.toggle(cls, force);

// 향상된 표시/숨김 (애니메이션 지원)
export function show(el, display = '', animated = false) {
  if (!el) return;
  
  if (animated) {
    el.style.display = display;
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  } else {
    el.style.display = display;
  }
}

export function hide(el, animated = false) {
  if (!el) return;
  
  if (animated) {
    el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
      el.style.display = 'none';
    }, 300);
  } else {
    el.style.display = 'none';
  }
}

export function visible(el, isShow, display = '', animated = false) {
  if (!el) return;
  isShow ? show(el, display, animated) : hide(el, animated);
}

// 텍스트/HTML (타이핑 효과 지원)
export function text(el, value = '', typewriter = false) {
  if (!el) return;
  
  if (typewriter && value.length > 0) {
    el.textContent = '';
    let i = 0;
    const interval = setInterval(() => {
      el.textContent += value[i];
      i++;
      if (i >= value.length) {
        clearInterval(interval);
      }
    }, 50);
  } else {
    el.textContent = String(value);
  }
}

export function html(el, value = '') {
  if (!el) return;
  el.innerHTML = value;
}

export function clear(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

// 요소 생성 (PYXIS 테마 지원)
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null) return;
    if (k === 'class') node.className = v;
    else if (k === 'dataset' && typeof v === 'object') {
      Object.entries(v).forEach(([dk, dv]) => (node.dataset[dk] = dv));
    } else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

/* =========================
 * PYXIS 테마 토스트 시스템
 * ========================= */
const TOAST_CONTAINER_ID = '__pyxis_toast_container__';

function ensureToastContainer() {
  let box = document.getElementById(TOAST_CONTAINER_ID);
  if (box) return box;
  
  box = el('div', {
    id: TOAST_CONTAINER_ID,
    class: 'pyxis-toasts',
    style: `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
      max-width: 400px;
    `,
  });
  document.body.appendChild(box);
  return box;
}

function ensureToastStyles() {
  if (document.querySelector('#pyxis-toast-styles')) return;
  
  const style = el('style', { id: 'pyxis-toast-styles' }, `
    .pyxis-toast {
      background: linear-gradient(135deg, rgba(0, 30, 53, 0.95), rgba(0, 42, 75, 0.95));
      backdrop-filter: blur(12px);
      border: 1px solid rgba(220, 199, 162, 0.3);
      border-radius: 12px;
      padding: 16px 20px;
      color: #E2E8F0;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 8px 32px rgba(0, 8, 13, 0.5);
      pointer-events: auto;
      cursor: pointer;
      transition: all 0.3s ease;
      animation: pyxisToastIn 0.4s ease-out;
      position: relative;
      overflow: hidden;
    }
    
    .pyxis-toast::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--accent-color, #DCC7A2);
      border-radius: 12px 12px 0 0;
    }
    
    .pyxis-toast:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 40px rgba(0, 8, 13, 0.6);
    }
    
    .pyxis-toast.success::before {
      background: #22C55E;
    }
    
    .pyxis-toast.warning::before {
      background: #F59E0B;
    }
    
    .pyxis-toast.danger::before {
      background: #EF4444;
    }
    
    .pyxis-toast.info::before {
      background: #3B82F6;
    }
    
    .pyxis-toast-title {
      font-weight: 700;
      color: #DCC7A2;
      margin-bottom: 4px;
      text-shadow: 0 0 8px rgba(220, 199, 162, 0.5);
    }
    
    .pyxis-toast-message {
      color: #CBD5E1;
    }
    
    @keyframes pyxisToastIn {
      0% {
        opacity: 0;
        transform: translateX(100%) scale(0.8);
      }
      100% {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }
    
    @keyframes pyxisToastOut {
      0% {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateX(100%) scale(0.8);
      }
    }
  `);
  document.head.appendChild(style);
}

export function toast(message, type = 'info', timeout = 3000) {
  ensureToastStyles();
  const box = ensureToastContainer();
  
  const typeConfig = {
    info: { title: '알림', icon: 'ℹ' },
    success: { title: '성공', icon: '✓' },
    warning: { title: '주의', icon: '⚠' },
    danger: { title: '오류', icon: '✕' },
  };
  
  const config = typeConfig[type] || typeConfig.info;
  
  const item = el('div', {
    class: `pyxis-toast ${type}`,
    style: '--accent-color: ' + {
      info: '#3B82F6',
      success: '#22C55E', 
      warning: '#F59E0B',
      danger: '#EF4444'
    }[type] || '#3B82F6'
  }, [
    el('div', { class: 'pyxis-toast-title' }, config.title),
    el('div', { class: 'pyxis-toast-message' }, message)
  ]);
  
  box.appendChild(item);
  
  let hideTimer = setTimeout(remove, timeout);

  function remove() {
    if (!item.parentNode) return;
    item.style.animation = 'pyxisToastOut 0.3s ease-in forwards';
    setTimeout(() => item.remove(), 300);
  }

  on(item, 'click', () => {
    clearTimeout(hideTimer);
    remove();
  });
  
  // 호버시 타이머 일시정지
  on(item, 'mouseenter', () => clearTimeout(hideTimer));
  on(item, 'mouseleave', () => hideTimer = setTimeout(remove, 2000));
  
  return remove;
}

// 편의 메서드들
export const success = (msg, timeout) => toast(msg, 'success', timeout);
export const warning = (msg, timeout) => toast(msg, 'warning', timeout);
export const error = (msg, timeout) => toast(msg, 'danger', timeout);
export const info = (msg, timeout) => toast(msg, 'info', timeout);

/* =========================
 * PYXIS 테마 로딩 인디케이터
 * ========================= */
function ensureLoadingStyles() {
  if (document.querySelector('#pyxis-loading-styles')) return;
  
  const style = el('style', { id: 'pyxis-loading-styles' }, `
    .pyxis-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      font-family: 'Inter', sans-serif;
    }
    
    .pyxis-loading.overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 8, 13, 0.8);
      backdrop-filter: blur(4px);
      border-radius: 12px;
      z-index: 1000;
    }
    
    .pyxis-spinner {
      width: 24px;
      height: 24px;
      border: 3px solid rgba(220, 199, 162, 0.3);
      border-top: 3px solid #DCC7A2;
      border-radius: 50%;
      animation: pyxisSpinner 1s linear infinite;
      box-shadow: 0 0 10px rgba(220, 199, 162, 0.3);
    }
    
    .pyxis-loading-label {
      color: #DCC7A2;
      font-weight: 600;
      font-size: 14px;
      text-shadow: 0 0 8px rgba(220, 199, 162, 0.5);
    }
    
    .pyxis-loading-dots {
      color: #DCC7A2;
      animation: pyxisDots 1.5s infinite;
    }
    
    @keyframes pyxisSpinner {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    @keyframes pyxisDots {
      0%, 20% { opacity: 0; }
      50% { opacity: 1; }
      100% { opacity: 0; }
    }
  `);
  document.head.appendChild(style);
}

export function startLoading(elTarget, { overlay = true, text: label = '로딩 중', animated = true } = {}) {
  if (!elTarget) return () => {};
  
  ensureLoadingStyles();
  
  const holder = el('div', {
    class: `pyxis-loading ${overlay ? 'overlay' : ''}`,
  }, [
    el('div', { class: 'pyxis-spinner' }),
    el('div', { class: 'pyxis-loading-label' }, label),
    animated ? el('span', { class: 'pyxis-loading-dots' }, '...') : null
  ].filter(Boolean));

  const prevPos = getComputedStyle(elTarget).position;
  if (overlay && (!prevPos || prevPos === 'static')) {
    elTarget.style.position = 'relative';
  }
  elTarget.appendChild(holder);

  return () => {
    try { 
      if (holder.parentNode) {
        holder.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => holder.remove(), 300);
      }
    } catch (e) {
      console.warn('[UI] Loading cleanup error:', e);
    }
  };
}

/* =========================
 * 포맷터 (게임적 요소 추가)
 * ========================= */
export const fmtInt = (n) => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString('ko-KR') : '0';
};

export function fmtMs(ms) {
  const t = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 향상된 HP 바 (애니메이션 및 색상 변화)
export function setHpBar(fillEl, hp, maxHp, animated = true) {
  if (!fillEl) return;
  
  const percentage = Math.max(0, Math.min(100, Math.round((hp / Math.max(1, maxHp)) * 100)));
  
  if (animated) {
    fillEl.style.transition = 'width 0.5s ease, background-color 0.3s ease';
  }
  
  fillEl.style.width = `${percentage}%`;
  
  // 동적 색상 변경
  if (percentage <= 25) {
    fillEl.style.backgroundColor = '#EF4444'; // 위험 (빨간색)
    fillEl.classList.add('hp-critical');
    fillEl.classList.remove('hp-low', 'hp-mid', 'hp-high');
  } else if (percentage <= 50) {
    fillEl.style.backgroundColor = '#F59E0B'; // 낮음 (주황색)
    fillEl.classList.add('hp-low');
    fillEl.classList.remove('hp-critical', 'hp-mid', 'hp-high');
  } else if (percentage <= 75) {
    fillEl.style.backgroundColor = '#FBBF24'; // 중간 (노란색)
    fillEl.classList.add('hp-mid');
    fillEl.classList.remove('hp-critical', 'hp-low', 'hp-high');
  } else {
    fillEl.style.backgroundColor = '#22C55E'; // 높음 (초록색)
    fillEl.classList.add('hp-high');
    fillEl.classList.remove('hp-critical', 'hp-low', 'hp-mid');
  }
  
  // 위험 상태일 때 펄스 효과
  if (percentage <= 25 && animated) {
    fillEl.style.animation = 'hpCriticalPulse 1s infinite';
    
    if (!document.querySelector('#hp-critical-style')) {
      const style = el('style', { id: 'hp-critical-style' }, `
        @keyframes hpCriticalPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `);
      document.head.appendChild(style);
    }
  } else {
    fillEl.style.animation = '';
  }
  
  return percentage;
}

// 전투 점수 포맷터
export function fmtBattleScore(score) {
  if (score >= 1000000) return `${(score / 1000000).toFixed(1)}M`;
  if (score >= 1000) return `${(score / 1000).toFixed(1)}K`;
  return fmtInt(score);
}

// 시간 기반 포맷터 (상대적 시간)
export function fmtTimeAgo(timestamp) {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);
  
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

/* =========================
 * 페이지·상태 헬퍼 (강화된 애니메이션)
 * ========================= */
export function setConnectionStatus({ dotEl, textEl, ok, message, animated = true }) {
  if (dotEl) {
    removeClass(dotEl, 'ok', 'bad', 'idle');
    const newClass = ok == null ? 'idle' : ok ? 'ok' : 'bad';
    addClass(dotEl, newClass);
    
    if (animated) {
      dotEl.style.transition = 'all 0.3s ease';
      
      // 연결 상태별 효과
      if (ok === true) {
        dotEl.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.6)';
      } else if (ok === false) {
        dotEl.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
        dotEl.style.animation = 'connectionError 0.5s ease-out';
      } else {
        dotEl.style.animation = 'connectionPulse 2s infinite';
      }
    }
  }
  
  if (textEl) {
    const statusText = message ?? (ok ? '연결됨' : ok == null ? '연결 중...' : '연결 끊김');
    
    if (animated) {
      textEl.style.transition = 'color 0.3s ease';
      text(textEl, statusText, false);
    } else {
      text(textEl, statusText);
    }
  }
  
  // 애니메이션 스타일 추가
  if (animated && !document.querySelector('#connection-status-style')) {
    const style = el('style', { id: 'connection-status-style' }, `
      @keyframes connectionError {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-3px); }
        75% { transform: translateX(3px); }
      }
      
      @keyframes connectionPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `);
    document.head.appendChild(style);
  }
}

export function setIndicator(indicatorEl, status, animated = true) {
  if (!indicatorEl) return;
  
  const dot = indicatorEl.querySelector('.status-dot');
  const label = indicatorEl.querySelector('span');
  
  removeClass(indicatorEl, 'waiting', 'active', 'ended', 'paused');
  addClass(indicatorEl, status);
  
  if (label) {
    const statusMap = {
      waiting: '대기중',
      active: '진행중',
      ended: '종료',
      paused: '일시정지',
    };
    
    const statusText = statusMap[status] || status || '';
    
    if (animated) {
      label.style.transition = 'color 0.3s ease';
    }
    
    text(label, statusText);
  }
  
  if (dot && animated) {
    removeClass(dot, 'waiting', 'active', 'ended', 'paused');
    addClass(dot, status);
    
    // 상태별 애니메이션
    if (status === 'active') {
      dot.style.animation = 'statusActive 2s infinite';
    } else if (status === 'waiting') {
      dot.style.animation = 'statusWaiting 1.5s infinite';
    } else {
      dot.style.animation = '';
    }
    
    if (!document.querySelector('#status-indicator-style')) {
      const style = el('style', { id: 'status-indicator-style' }, `
        @keyframes statusActive {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.8; }
        }
        
        @keyframes statusWaiting {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `);
      document.head.appendChild(style);
    }
  }
}

/* =========================
 * 렌더 유틸 (향상된 로그/채팅)
 * ========================= */
export function appendLog(viewEl, { text: line, type = 'system', ts, animated = true } = {}) {
  if (!viewEl || !line) return;
  
  const timestamp = ts ? new Date(ts).toLocaleTimeString('ko-KR') : new Date().toLocaleTimeString('ko-KR');
  
  const row = el('div', { 
    class: `log-entry log-${type}`,
    style: animated ? 'opacity: 0; transform: translateY(10px); transition: opacity 0.3s ease, transform 0.3s ease;' : ''
  }, [
    el('div', { class: 'log-timestamp' }, timestamp),
    el('div', { class: 'log-content' }, line),
  ]);
  
  // 타입별 아이콘 추가
  const icons = {
    system: '⚙',
    action: '⚔',
    damage: '💥',
    heal: '💚',
    info: 'ℹ',
    warning: '⚠',
    error: '✕'
  };
  
  if (icons[type]) {
    const icon = el('span', { class: 'log-icon', style: 'margin-right: 8px;' }, icons[type]);
    row.querySelector('.log-content').prepend(icon);
  }
  
  viewEl.appendChild(row);
  
  if (animated) {
    requestAnimationFrame(() => {
      row.style.opacity = '1';
      row.style.transform = 'translateY(0)';
    });
  }
  
  // 자동 스크롤
  viewEl.scrollTop = viewEl.scrollHeight;
  
  // 로그 수 제한
  while (viewEl.children.length > 100) {
    viewEl.removeChild(viewEl.firstChild);
  }
}

export function appendChat(viewEl, { name, message, teamOnly, timestamp, isAdmin, animated = true } = {}) {
  if (!viewEl || !message) return;
  
  const meta = [
    name ? String(name) : '익명',
    teamOnly ? '[팀]' : '',
    isAdmin ? '[관리]' : '',
  ].filter(Boolean).join(' ');
  
  const time = timestamp ? new Date(timestamp).toLocaleTimeString('ko-KR') : new Date().toLocaleTimeString('ko-KR');
  
  const row = el('div', { 
    class: `chat-row ${teamOnly ? 'team-chat' : 'global-chat'}`,
    style: animated ? 'opacity: 0; transform: translateX(-10px); transition: opacity 0.3s ease, transform 0.3s ease;' : ''
  }, [
    el('div', { class: 'chat-meta' }, meta),
    el('div', { class: 'chat-text' }, message),
    el('div', { class: 'chat-time' }, time),
  ]);
  
  viewEl.appendChild(row);
  
  if (animated) {
    requestAnimationFrame(() => {
      row.style.opacity = '1';
      row.style.transform = 'translateX(0)';
    });
  }
  
  viewEl.scrollTop = viewEl.scrollHeight;
  
  // 채팅 수 제한
  while (viewEl.children.length > 50) {
    viewEl.removeChild(viewEl.firstChild);
  }
}

// 스크롤 유틸리티
export function scrollToBottom(element, smooth = true) {
  if (!element) return;
  
  if (smooth) {
    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'smooth'
    });
  } else {
    element.scrollTop = element.scrollHeight;
  }
}

export function isScrolledToBottom(element, threshold = 50) {
  if (!element) return true;
  return element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;
}

/* =========================
 * 쿼리스트링/저장소 (향상된 버전)
 * ========================= */
export function parseQuery(qs = window.location.search) {
  const out = {};
  try {
    const sp = new URLSearchParams(qs);
    for (const [k, v] of sp.entries()) {
      // 타입 추론
      if (v === 'true') out[k] = true;
      else if (v === 'false') out[k] = false;
      else if (/^\d+$/.test(v)) out[k] = parseInt(v, 10);
      else if (/^\d*\.\d+$/.test(v)) out[k] = parseFloat(v);
      else out[k] = v;
    }
  } catch (e) {
    console.warn('[UI] Query parsing error:', e);
  }
  return out;
}

const STORE_PREFIX = 'pyxis::';
const STORE_VERSION = 'v1';

export const store = {
  get(key, defVal = null) {
    try {
      const raw = localStorage.getItem(`${STORE_PREFIX}${STORE_VERSION}::${key}`);
      if (raw == null) return defVal;
      const parsed = JSON.parse(raw);
      
      // 만료 시간 체크
      if (parsed._expires && Date.now() > parsed._expires) {
        this.remove(key);
        return defVal;
      }
      
      return parsed._value !== undefined ? parsed._value : parsed;
    } catch {
      return defVal;
    }
  },
  
  set(key, val, ttlMs = null) {
    try {
      const data = ttlMs ? {
        _value: val,
        _expires: Date.now() + ttlMs
      } : val;
      
      localStorage.setItem(`${STORE_PREFIX}${STORE_VERSION}::${key}`, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },
  
  remove(key) {
    try {
      localStorage.removeItem(`${STORE_PREFIX}${STORE_VERSION}::${key}`);
    } catch {}
  },
  
  clear() {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(STORE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch {}
  },
  
  // 사용량 체크
  getUsage() {
    try {
      let total = 0;
      for (const key in localStorage) {
        if (key.startsWith(STORE_PREFIX)) {
          total += localStorage[key].length;
        }
      }
      return { used: total, limit: 5 * 1024 * 1024 }; // 5MB 추정
    } catch {
      return { used: 0, limit: 0 };
    }
  }
};

/* =========================
 * 디바운스/스로틀 (강화된 버전)
 * ========================= */
export function debounce(fn, wait = 200, immediate = false) {
  let timeout;
  let result;
  
  const debounced = function (...args) {
    const callNow = immediate && !timeout;
    
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      if (!immediate) result = fn.apply(this, args);
    }, wait);
    
    if (callNow) result = fn.apply(this, args);
    return result;
  };
  
  debounced.cancel = () => {
    clearTimeout(timeout);
    timeout = null;
  };
  
  debounced.flush = function (...args) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      return fn.apply(this, args);
    }
  };
  
  return debounced;
}

export function throttle(fn, wait = 200, options = {}) {
  let timeout;
  let previous = 0;
  let result;
  
  const { leading = true, trailing = true } = options;
  
  const throttled = function (...args) {
    const now = Date.now();
    
    if (!previous && !leading) previous = now;
    
    const remaining = wait - (now - previous);
    
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = fn.apply(this, args);
    } else if (!timeout && trailing) {
      timeout = setTimeout(() => {
        previous = leading ? Date.now() : 0;
        timeout = null;
        result = fn.apply(this, args);
      }, remaining);
    }
    
    return result;
  };
  
  throttled.cancel = () => {
    clearTimeout(timeout);
    previous = 0;
    timeout = null;
  };
  
  return throttled;
}

/* =========================
 * 폼 검증 유틸리티
 * ========================= */
export function validateForm(formEl, rules = {}) {
  if (!formEl) return { valid: false, errors: ['폼을 찾을 수 없습니다'] };
  
  const data = {};
  const errors = [];
  
  Object.entries(rules).forEach(([fieldName, rule]) => {
    const field = formEl.querySelector(`[name="${fieldName}"], #${fieldName}`);
    if (!field) {
      if (rule.required) errors.push(`${rule.label || fieldName} 필드를 찾을 수 없습니다`);
      return;
    }
    
    const value = field.value.trim();
    data[fieldName] = value;
    
    // 필수 체크
    if (rule.required && !value) {
      errors.push(`${rule.label || fieldName}은(는) 필수입니다`);
      field.classList.add('error');
      return;
    }
    
    // 최소/최대 길이
    if (value && rule.minLength && value.length < rule.minLength) {
      errors.push(`${rule.label || fieldName}은(는) 최소 ${rule.minLength}자 이상이어야 합니다`);
      field.classList.add('error');
    }
    
    if (value && rule.maxLength && value.length > rule.maxLength) {
      errors.push(`${rule.label || fieldName}은(는) 최대 ${rule.maxLength}자까지 입력 가능합니다`);
      field.classList.add('error');
    }
    
    // 패턴 체크
    if (value && rule.pattern && !rule.pattern.test(value)) {
      errors.push(`${rule.label || fieldName} 형식이 올바르지 않습니다`);
      field.classList.add('error');
    }
    
    // 성공시 에러 클래스 제거
    if (errors.length === 0) {
      field.classList.remove('error');
    }
  });
  
  return { valid: errors.length === 0, data, errors };
}

/* =========================
 * 게임 효과 유틸리티
 * ========================= */
export function addRippleEffect(element, event) {
  if (!element || !event) return;
  
  const rect = element.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;
  
  const ripple = el('span', {
    style: `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x}px;
      top: ${y}px;
      background: radial-gradient(circle, rgba(220, 199, 162, 0.3) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      animation: rippleEffect 0.6s ease-out;
    `
  });
  
  element.style.position = element.style.position || 'relative';
  element.style.overflow = 'hidden';
  element.appendChild(ripple);
  
  if (!document.querySelector('#ripple-effect-style')) {
    const style = el('style', { id: 'ripple-effect-style' }, `
      @keyframes rippleEffect {
        from {
          transform: scale(0);
          opacity: 1;
        }
        to {
          transform: scale(4);
          opacity: 0;
        }
      }
    `);
    document.head.appendChild(style);
  }
  
  setTimeout(() => ripple.remove(), 600);
}

export function calculateHpPercent(hp, maxHp) {
  return Math.max(0, Math.min(100, Math.round((hp / Math.max(1, maxHp)) * 100)));
}

export function getTeamName(team) {
  const teamMap = {
    'A': '불사조 기사단',
    'team1': '불사조 기사단',
    'phoenix': '불사조 기사단',
    'B': '죽음을 먹는 자들',
    'team2': '죽음을 먹는 자들',
    'eaters': '죽음을 먹는 자들'
  };
  return teamMap[team] || team || '알 수 없음';
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/* =========================
 * 알림 훅 (PyxisNotify 연동)
 * ========================= */
export async function notify(title, body, options = {}) {
  try {
    if (window.PyxisNotify && typeof window.PyxisNotify.notify === 'function') {
      window.PyxisNotify.notify(title, { body, ...options });
      return;
    }
    
    // 폴백: 기본 토스트
    toast(`${title}: ${body}`, options.type || 'info');
  } catch (e) {
    console.warn('[UI] Notification error:', e);
    toast(`${title}: ${body}`, 'info');
  }
}

/* =========================
 * 접근성 보조 (강화된 버전)
 * ========================= */
export function focusTrap(container, firstSelector, lastSelector) {
  if (!container) return () => {};
  
  const first = $(firstSelector, container) || container.querySelector('[tabindex]:not([tabindex="-1"]), button, input, select, textarea');
  const last = $(lastSelector, container) || Array.from(container.querySelectorAll('[tabindex]:not([tabindex="-1"]), button, input, select, textarea')).pop();

  function trap(e) {
    if (e.key !== 'Tab') return;
    
    const active = document.activeElement;
    
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last?.focus?.();
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first?.focus?.();
      }
    }
  }
  
  // ESC 키로 포커스 트랩 해제
  function escape(e) {
    if (e.key === 'Escape') {
      const event = new CustomEvent('focustrap:escape', { detail: { container } });
      container.dispatchEvent(event);
    }
  }
  
  document.addEventListener('keydown', trap);
  document.addEventListener('keydown', escape);
  
  return () => {
    document.removeEventListener('keydown', trap);
    document.removeEventListener('keydown', escape);
  };
}

// 키보드 네비게이션 도우미
export function enableKeyboardNav(container, itemSelector) {
  if (!container) return () => {};
  
  function navigate(e) {
    const items = $(itemSelector, container);
    const currentIndex = items.indexOf(document.activeElement);
    
    let nextIndex = currentIndex;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case 'ArrowUp':
        e.preventDefault();
        nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        break;
      case 'Home':
        e.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    
    items[nextIndex]?.focus();
  }
  
  on(container, 'keydown', navigate);
  return () => container.removeEventListener('keydown', navigate);
}

/* =========================
 * 네임스페이스로 묶어서도 제공
 * ========================= */
const UiHelpers = {
  // DOM 기본
  $, $, on, delegate,
  addClass, removeClass, toggleClass,
  show, hide, visible, text, html, clear, el,
  
  // 토스트/로딩
  toast, success, warning, error, info, startLoading,
  
  // 포맷터
  fmtInt, fmtMs, setHpBar, fmtBattleScore, fmtTimeAgo,
  
  // 상태 헬퍼
  setConnectionStatus, setIndicator,
  
  // 렌더 유틸
  appendLog, appendChat, scrollToBottom, isScrolledToBottom,
  
  // 쿼리/스토리지
  parseQuery, store,
  
  // 성능
  debounce, throttle,
  
  // 폼 검증
  validateForm,
  
  // 게임 효과
  addRippleEffect, calculateHpPercent, getTeamName, formatTime,
  
  // 알림
  notify,
  
  // 접근성
  focusTrap, enableKeyboardNav,
};

export default UiHelpers;

/* =========================
 * 전역 노출 (기존 코드 호환용)
 * ========================= */
try {
  if (typeof window !== 'undefined') {
    window.UiHelpers = UiHelpers;
    window.UI = UiHelpers;
    
    // 전역 이벤트 리스너 등록
    document.addEventListener('DOMContentLoaded', () => {
      // 전역 리플 효과
      document.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn') || e.target.classList.contains('ripple-effect')) {
          addRippleEffect(e.target, e);
        }
      });
      
      // 폼 실시간 검증
      document.addEventListener('input', debounce((e) => {
        if (e.target.classList.contains('error')) {
          e.target.classList.remove('error');
        }
      }, 300));
    });
  }
} catch (_) {}
