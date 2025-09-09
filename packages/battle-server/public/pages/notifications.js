/* PYXIS Notifications (browser-only)
   - 실제 알림(토스트) 기능 구현
   - 관리자/플레이어/관전자 공용
   - 이모지 금지

   사용법:
     <script src="/socket.io/socket.io.js"></script>
     <script src="/notifications.js"></script>
     <script>
       const socket = io();
       // 페이지 진입 시 한 번 초기화
       PyxisNotify.init({
         socket,                       // Socket.IO 인스턴스 (필수)
         role: "admin" | "player" | "spectator",
         battleId: new URLSearchParams(location.search).get("battle") || null,
         // 어떤 이벤트를 알림으로 띄울지 제어
         listen: {
           chat: true,                 // battle:chat
           cheer: true,                // battle:log(type:"cheer")
           system: true,               // battle:log(type:"system")
           action: false,              // battle:log(type:"action")
           status: true,               // battleUpdate의 상태 전환 감지
           turn: true,                 // turn:tick 60s, 30s, 10s, 0s 마일스톤
         },
       });

       // 임의로 알림 호출도 가능
       PyxisNotify.toast("테스트 알림", { tone:"info" });
     </script>
*/

(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.PyxisNotify = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // ───────────────────────────────────────────────────────────
  // 스타일 주입
  // ───────────────────────────────────────────────────────────
  const CSS = `
  :root{
    --pyx-gold-1:#DCC7A2; --pyx-gold-2:#D4BA8D;
    --pyx-ink:#EEE6D6; --pyx-ink-d:#BEB49A;
    --pyx-bg:rgba(0,20,36,.75); --pyx-border:rgba(220,199,162,.25);
    --pyx-ok:#7BD389; --pyx-warn:#F6D37A; --pyx-err:#FF7B7B; --pyx-info:#5AA9E6;
  }
  .pyx-toast-wrap{
    position:fixed; right:14px; top:14px; z-index:2147483000;
    display:flex; flex-direction:column; gap:10px; pointer-events:none;
  }
  @media (max-width:720px){
    .pyx-toast-wrap{ left:14px; right:14px; top:10px }
  }
  .pyx-toast{
    pointer-events:auto;
    display:grid; grid-template-columns: 1fr auto; align-items:flex-start; gap:10px;
    min-width:280px; max-width:380px;
    color:var(--pyx-ink);
    background:linear-gradient(180deg, rgba(0,30,53,.65), rgba(0,35,65,.85));
    border:1px solid var(--pyx-border);
    border-radius:12px; padding:12px 12px 10px;
    box-shadow:0 10px 28px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04);
    backdrop-filter: blur(10px) saturate(1.1);
    transform: translateY(-8px);
    opacity:0;
    animation: pyx-fade-in .18s ease forwards;
  }
  .pyx-toast-title{
    font-weight:700; letter-spacing:.02em;
    background:linear-gradient(90deg,var(--pyx-gold-1),var(--pyx-gold-2));
    -webkit-background-clip:text; background-clip:text; color:transparent;
    font-size:14px; line-height:1.2; margin-bottom:4px;
  }
  .pyx-toast-msg{ font-size:13px; color:var(--pyx-ink); opacity:.9; }
  .pyx-toast-meta{ font-size:11px; color:var(--pyx-ink-d); margin-top:6px }
  .pyx-toast-close{
    margin-left:auto; align-self:start; border:1px solid var(--pyx-border);
    border-radius:8px; background:rgba(0,0,0,.2); color:var(--pyx-ink);
    padding:6px 8px; cursor:pointer;
  }
  .pyx-toast-close:hover{ background:rgba(255,255,255,.05) }
  .pyx-tone-info   { border-color: rgba(90,169,230,.35) }
  .pyx-tone-ok     { border-color: rgba(123,211,137,.35) }
  .pyx-tone-warn   { border-color: rgba(246,211,122,.35) }
  .pyx-tone-err    { border-color: rgba(255,123,123,.35) }
  .pyx-prog{ height:3px; border-radius:999px; overflow:hidden; margin-top:8px; background:rgba(255,255,255,.08) }
  .pyx-prog > i{ display:block; height:100%; width:0%; background:linear-gradient(90deg,var(--pyx-gold-2),var(--pyx-gold-1)) }
  @keyframes pyx-fade-in{ to{ transform:translateY(0); opacity:1 } }
  @keyframes pyx-fade-out{ to{ transform:translateY(-6px); opacity:0 } }
  `;

  function injectCSSOnce() {
    if (document.getElementById("pyx-toast-style")) return;
    const style = document.createElement("style");
    style.id = "pyx-toast-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ───────────────────────────────────────────────────────────
  // 유틸
  // ───────────────────────────────────────────────────────────
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fmtTime = () => new Date().toLocaleTimeString();
  const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (a) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[a]));

  // 중복 방지용 간단 해시
  function hash(str) {
    let h = 0, i, chr;
    for (i = 0; i < str.length; i++) { chr = str.charCodeAt(i); h = (h << 5) - h + chr; h |= 0; }
    return h.toString(16);
  }

  // ───────────────────────────────────────────────────────────
  // 토스트 매니저
  // ───────────────────────────────────────────────────────────
  const Queue = [];
  let WRAP = null;
  let RECENT = new Map(); // key -> ts

  function ensureWrap() {
    if (WRAP) return WRAP;
    WRAP = document.createElement("div");
    WRAP.className = "pyx-toast-wrap";
    document.body.appendChild(WRAP);
    return WRAP;
  }

  function toast(msg, opts = {}) {
    injectCSSOnce();
    ensureWrap();

    const now = Date.now();
    const dedupKey = opts.dedupKey || hash((opts.title || "") + "|" + msg);
    const last = RECENT.get(dedupKey) || 0;
    if (now - last < (opts.dedupWindowMs || 1500)) {
      return; // 너무 잦은 동일 알림 방지
    }
    RECENT.set(dedupKey, now);

    const tone = opts.tone || "info"; // info | ok | warn | err
    const life = clamp(opts.durationMs || 4200, 1500, 15000);

    const el = document.createElement("div");
    el.className = `pyx-toast pyx-tone-${tone}`;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    const title = document.createElement("div");
    title.className = "pyx-toast-title";
    title.textContent = opts.title || "알림";

    const body = document.createElement("div");
    body.className = "pyx-toast-msg";
    body.innerHTML = escapeHtml(msg);

    const meta = document.createElement("div");
    meta.className = "pyx-toast-meta";
    meta.textContent = opts.meta || fmtTime();

    const close = document.createElement("button");
    close.className = "pyx-toast-close";
    close.textContent = "닫기";

    const prog = document.createElement("div");
    prog.className = "pyx-prog";
    const fill = document.createElement("i");
    prog.appendChild(fill);

    const left = document.createElement("div");
    left.appendChild(title);
    left.appendChild(body);
    left.appendChild(meta);
    left.appendChild(prog);

    el.appendChild(left);
    el.appendChild(close);

    let startTs = Date.now();
    let rafId = null;
    let leftMs = life;
    let paused = false;

    function tick() {
      if (paused) { rafId = requestAnimationFrame(tick); return; }
      const elapsed = Date.now() - startTs;
      leftMs = life - elapsed;
      fill.style.width = clamp(((elapsed / life) * 100), 0, 100) + "%";
      if (leftMs <= 0) return vanish();
      rafId = requestAnimationFrame(tick);
    }

    function vanish() {
      cancelAnimationFrame(rafId);
      el.style.animation = "pyx-fade-out .16s ease forwards";
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 160);
    }

    close.addEventListener("click", vanish);
    el.addEventListener("mouseenter", () => { paused = true; });
    el.addEventListener("mouseleave", () => { paused = false; startTs = Date.now() - (life - leftMs); });

    WRAP.appendChild(el);
    rafId = requestAnimationFrame(tick);
    Queue.push(el);
    return el;
  }

  // ───────────────────────────────────────────────────────────
  // 소켓 연동
  // ───────────────────────────────────────────────────────────
  const STATE = {
    initialized: false,
    opts: null,
    lastStatus: null,
    lastTurnSecs: null,
  };

  function init(opts = {}) {
    if (!opts.socket) {
      console.warn("[PyxisNotify] socket missing");
      return;
    }
    injectCSSOnce();
    ensureWrap();

    STATE.initialized = true;
    STATE.opts = Object.assign({
      role: null,
      battleId: null,
      listen: { chat: true, cheer: true, system: true, action: false, status: true, turn: true },
    }, opts || {});

    const { socket } = STATE.opts;

    // 채팅
    socket.on("battle:chat", ({ name, msg }) => {
      if (!STATE.opts.listen.chat) return;
      toast(`${name}: ${msg}`, { title: "채팅", tone: "info", dedupKey: "chat|" + hash(name + msg) });
    });

    // 로그: 시스템/응원/액션
    socket.on("battle:log", ({ type, msg }) => {
      if (type === "system" && STATE.opts.listen.system) {
        toast(msg, { title: "시스템", tone: "info", dedupKey: "sys|" + hash(msg) });
      } else if (type === "cheer" && STATE.opts.listen.cheer) {
        toast(msg, { title: "응원", tone: "ok", dedupKey: "cheer|" + hash(msg) });
      } else if (type === "action" && STATE.opts.listen.action) {
        toast(msg, { title: "행동", tone: "warn", dedupKey: "act|" + hash(msg) });
      }
    });

    // 상태 변화 감지
    socket.on("battleUpdate", (b) => {
      if (!STATE.opts.listen.status) return;
      const prev = STATE.lastStatus;
      const cur = b?.status || null;
      if (cur && cur !== prev) {
        STATE.lastStatus = cur;
        const tone = cur === "live" ? "ok" : (cur === "ended" ? "err" : "info");
        const label = cur === "live" ? "전투 시작" : (cur === "ended" ? "전투 종료" : "대기");
        toast(`상태: ${label}`, { title: "전투 상태", tone, dedupKey: "status|" + cur });
      }
    });

    // 턴 타이머 마일스톤 알림
    socket.on("turn:tick", ({ remaining }) => {
      if (!STATE.opts.listen.turn) return;
      const secs = Math.ceil((remaining || 0) / 1000);
      // 300, 120, 60, 30, 10, 0초 시점 알림
      const milestones = [300, 120, 60, 30, 10, 0];
      if (milestones.includes(secs) && STATE.lastTurnSecs !== secs) {
        STATE.lastTurnSecs = secs;
        const label = secs > 0 ? `${secs}초 남음` : "턴 종료";
        const tone = secs === 0 ? "warn" : "info";
        toast(label, { title: "턴 타이머", tone, dedupKey: "turn|" + secs, durationMs: secs === 0 ? 3000 : 2000 });
      }
    });
  }

  // 편의 메서드
  function info(msg, title = "알림") { return toast(msg, { title, tone:"info" }); }
  function ok(msg, title = "성공")   { return toast(msg, { title, tone:"ok" }); }
  function warn(msg, title = "주의") { return toast(msg, { title, tone:"warn" }); }
  function err(msg, title = "오류")  { return toast(msg, { title, tone:"err" }); }

  return { init, toast, info, ok, warn, err };
});
