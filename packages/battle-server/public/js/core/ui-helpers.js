/* packages/battle-server/public/js/core/ui-helpers.js
 * ─────────────────────────────────────────────────────────────
 * PYXIS UI Helpers (브라우저 전용)
 * - DOM 셀렉터/이벤트/클래스/표시/렌더 보일러플레이트
 * - 포맷터(시간/숫자/HP바)
 * - 토스트/로딩 인디케이터(간단)
 * - 쿼리스트링 파서, 로컬스토리지 헬퍼
 * - 디바운스/스로틀
 * - 알림 훅(notifications.js가 있을 때만 사용)
 * ─────────────────────────────────────────────────────────────
 */

/* =========================
 * DOM 기본
 * ========================= */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, evt, handler, opts) {
  el.addEventListener(evt, handler, opts);
  return () => el.removeEventListener(evt, handler, opts);
}

// 이벤트 위임
export function delegate(root, evt, selector, handler) {
  return on(root, evt, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export const addClass = (el, ...cls) => el && el.classList.add(...cls);
export const removeClass = (el, ...cls) => el && el.classList.remove(...cls);
export const toggleClass = (el, cls, force) => el && el.classList.toggle(cls, force);

export function show(el, display = '') {
  if (!el) return;
  el.style.display = display; // '' -> CSS 기본값 사용
}
export function hide(el) {
  if (!el) return;
  el.style.display = 'none';
}
export function visible(el, isShow, display = '') {
  if (!el) return;
  isShow ? show(el, display) : hide(el);
}

export function text(el, value = '') {
  if (!el) return;
  el.textContent = String(value);
}
export function html(el, value = '') {
  if (!el) return;
  el.innerHTML = value;
}

export function clear(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

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
 * 로딩/토스트
 * ========================= */
const TOAST_CONTAINER_ID = '__pyxis_toast_container__';

function ensureToastContainer() {
  let box = document.getElementById(TOAST_CONTAINER_ID);
  if (box) return box;
  box = el('div', {
    id: TOAST_CONTAINER_ID,
    class: 'pyxis-toasts',
    style:
      'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;',
  });
  document.body.appendChild(box);
  return box;
}

export function toast(message, type = 'info', timeout = 2200) {
  const box = ensureToastContainer();
  const colors = {
    info: '#1f6feb',
    success: '#2da44e',
    warning: '#bf8700',
    danger: '#d1242f',
  };
  const item = el('div', {
    class: 'pyxis-toast',
    style:
      `min-width:240px;max-width:420px;background:#111a;backdrop-filter:saturate(150%) blur(6px);` +
      `border:1px solid #333;` +
      `padding:10px 12px;border-radius:8px;color:#fff;` +
      `box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:auto;` +
      `font:500 13px/1.5 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;` +
      `border-left:4px solid ${colors[type] || colors.info};`,
  }, message);
  box.appendChild(item);
  let hideTimer = setTimeout(remove, timeout);

  function remove() {
    if (!item.parentNode) return;
    item.style.transition = 'opacity .2s ease';
    item.style.opacity = '0';
    setTimeout(() => item.remove(), 210);
  }

  on(item, 'click', () => {
    clearTimeout(hideTimer);
    remove();
  });
}

export function startLoading(elTarget, { overlay = true, text: label = '로딩 중' } = {}) {
  if (!elTarget) return () => {};
  const holder = el('div', {
    class: 'pyxis-loading',
    style: overlay
      ? 'position:absolute;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;border-radius:12px;'
      : 'display:inline-flex;align-items:center;gap:8px;',
  }, [
    el('div', {
      class: 'spinner',
      style:
        'width:18px;height:18px;border:2px solid #fff3;border-top-color:#fff;border-radius:50%;' +
        'animation:pyx-spin .8s linear infinite;margin-right:8px;',
    }),
    el('div', { class: 'label', style: 'color:#fff;font-weight:600;' }, label),
  ]);

  // 스피너 키프레임 1회 등록
  if (!document.getElementById('__pyxis_spin_keyframe__')) {
    const style = el('style', { id: '__pyxis_spin_keyframe__' },
      '@keyframes pyx-spin{to{transform:rotate(360deg)}}');
    document.head.appendChild(style);
  }

  const prevPos = getComputedStyle(elTarget).position;
  if (overlay && (!prevPos || prevPos === 'static')) {
    elTarget.style.position = 'relative';
  }
  elTarget.appendChild(holder);

  return () => {
    try { holder.remove(); } catch (e) {}
  };
}

/* =========================
 * 포맷터
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

export function setHpBar(fillEl, hp, maxHp) {
  if (!fillEl) return;
  const v = Math.max(0, Math.min(100, Math.round((hp / Math.max(1, maxHp)) * 100)));
  fillEl.style.width = `${v}%`;
  // 색상은 CSS에 위임(디자인 유지). 여기선 임계치에 따른 클래스만 토글.
  toggleClass(fillEl, 'is-low', v <= 30);
  toggleClass(fillEl, 'is-mid', v > 30 && v <= 65);
  toggleClass(fillEl, 'is-high', v > 65);
}

/* =========================
 * 페이지·상태 헬퍼
 * ========================= */
export function setConnectionStatus({ dotEl, textEl, ok, message }) {
  if (dotEl) {
    removeClass(dotEl, 'ok', 'bad', 'idle');
    addClass(dotEl, ok == null ? 'idle' : ok ? 'ok' : 'bad');
  }
  if (textEl) {
    text(textEl, message ?? (ok ? '연결됨' : ok == null ? '연결 중...' : '연결 끊김'));
  }
}

export function setIndicator(indicatorEl, status) {
  // status: waiting|active|ended|paused 등
  if (!indicatorEl) return;
  const dot = indicatorEl.querySelector('.status-dot');
  const label = indicatorEl.querySelector('span');
  removeClass(indicatorEl, 'waiting', 'active', 'ended', 'paused');
  addClass(indicatorEl, status);
  if (label) {
    const map = {
      waiting: '대기중',
      active: '진행중',
      ended: '종료',
      paused: '일시정지',
    };
    label.textContent = map[status] || status || '';
  }
  if (dot) {
    removeClass(dot, 'waiting', 'active', 'ended', 'paused');
    addClass(dot, status);
  }
}

/* =========================
 * 렌더 유틸(간단한 리스트/로그)
 * ========================= */
export function appendLog(viewEl, { text: line, type = 'system', ts } = {}) {
  if (!viewEl || !line) return;
  const row = el('div', { class: `log-entry ${type}` }, [
    el('div', { class: 'log-timestamp' }, ts ? new Date(ts).toLocaleTimeString('ko-KR') : ''),
    el('div', { class: 'log-content' }, line),
  ]);
  viewEl.prepend(row);
}

export function appendChat(viewEl, { name, message, teamOnly, timestamp, isAdmin } = {}) {
  if (!viewEl || !message) return;
  const meta = [
    name ? String(name) : '익명',
    teamOnly ? '[팀]' : '',
    isAdmin ? '[관리]' : '',
  ].filter(Boolean).join(' ');
  const row = el('div', { class: 'chat-row' }, [
    el('div', { class: 'chat-meta' }, meta),
    el('div', { class: 'chat-text' }, message),
    el('div', { class: 'chat-time' }, timestamp ? new Date(timestamp).toLocaleTimeString('ko-KR') : ''),
  ]);
  viewEl.appendChild(row);
  viewEl.scrollTop = viewEl.scrollHeight;
}

/* =========================
 * 쿼리스트링/저장소
 * ========================= */
export function parseQuery(qs = window.location.search) {
  const out = {};
  try {
    const sp = new URLSearchParams(qs);
    for (const [k, v] of sp.entries()) out[k] = v;
  } catch (_) {}
  return out;
}

const STORE_PREFIX = 'pyxis::';

export const store = {
  get(key, defVal = null) {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      if (raw == null) return defVal;
      return JSON.parse(raw);
    } catch {
      return defVal;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(STORE_PREFIX + key, JSON.stringify(val));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(STORE_PREFIX + key);
    } catch {}
  },
};

/* =========================
 * 디바운스/스로틀
 * ========================= */
export function debounce(fn, wait = 200) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      const remaining = wait - (now - last);
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/* =========================
 * 알림 훅(있으면 사용)
 * ========================= */
export async function notify(title, body) {
  // notifications.js 가 아래 두 함수를 export 한다고 가정(없으면 무시)
  try {
    const mod = await import('./notifications.js').catch(() => null);
    if (!mod) return;
    if (typeof mod.requestNotificationPermission === 'function') {
      await mod.requestNotificationPermission();
    }
    if (typeof mod.sendNotification === 'function') {
      mod.sendNotification(title, body);
    }
  } catch (_) {
    // 무시
  }
}

/* =========================
 * 접근성 보조
 * ========================= */
export function focusTrap(container, firstSelector, lastSelector) {
  if (!container) return () => {};
  const first = $(firstSelector, container) || container.firstElementChild;
  const last = $(lastSelector, container) || container.lastElementChild;

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
  document.addEventListener('keydown', trap);
  return () => document.removeEventListener('keydown', trap);
}

/* =========================
 * 네임스페이스로 묶어서도 제공(선택)
 * ========================= */
const UiHelpers = {
  $, $$, on, delegate,
  addClass, removeClass, toggleClass,
  show, hide, visible, text, html, clear, el,
  toast, startLoading,
  fmtInt, fmtMs, setHpBar,
  setConnectionStatus, setIndicator,
  appendLog, appendChat,
  parseQuery, store,
  debounce, throttle,
  notify,
  focusTrap,
};

export default UiHelpers;

