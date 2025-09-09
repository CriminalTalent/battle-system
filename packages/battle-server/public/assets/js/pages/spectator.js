/* PYXIS Spectator Client (external JS)
   - 이벤트 규격:
     emit:   spectator:join, spectator:cheer
     on:     spectator:join_ok, authError, battleUpdate, battle:chat, battle:log, turn:tick
   - UI: spectator.html 과 동일한 id 사용 (authModal/app/cheerBtns/chatLog 등)
   - 이 파일은 기존 spectator.js를 전면 교체한다 (이모지 금지)
*/
(() => {
  "use strict";

  // ───────────────────────────────────────────────────────────
  // DOM
  // ───────────────────────────────────────────────────────────
  const $ = (s, r = document) => r.querySelector(s);

  // 인증 모달 / 앱
  const authModal = $("#authModal");
  const app       = $("#app");

  // 인증 입력
  const inpBattle = $("#inpBattle");
  const inpOTP    = $("#inpOTP");
  const inpName   = $("#inpName");
  const btnJoin   = $("#btnJoin");
  const authErr   = $("#authErr");

  // 상단 Pill
  const pillBattle = $("#pillBattle");
  const pillStatus = $("#pillStatus");
  const pillTurn   = $("#pillTurn");

  // 중앙(턴/타이머/초상)
  const turnName     = $("#turnName");
  const turnPortrait = $("#turnPortrait");
  const timerFill    = $("#timerFill");

  // 좌우 팀 리스트
  const phoenixList = $("#phoenixList");
  const eatersList  = $("#eatersList");

  // 타임라인(채팅+로그)
  const chatLog = $("#chatLog");

  // 응원 버튼 래퍼
  const cheerBtns = $("#cheerBtns");

  // ───────────────────────────────────────────────────────────
  // 상태
  // ───────────────────────────────────────────────────────────
  const qs = new URLSearchParams(location.search);
  let battleId = qs.get("battle") || "";
  let myName = "";

  // ───────────────────────────────────────────────────────────
  // 소켓
  // ───────────────────────────────────────────────────────────
  // eslint-disable-next-line no-undef
  const socket = io();

  socket.on("connect", () => pushLine(`<span class="log-sys">시스템</span> · 연결됨`, "log-sys"));
  socket.on("disconnect", () => pushLine(`<span class="log-sys">시스템</span> · 연결 해제됨`, "log-sys"));
  socket.on("connect_error", (e) => setAuthErr(e?.message || "네트워크 오류"));

  // ───────────────────────────────────────────────────────────
  // 인증
  // ───────────────────────────────────────────────────────────
  if (battleId) inpBattle.value = battleId;

  btnJoin?.addEventListener("click", tryJoin);

  function tryJoin() {
    battleId = (inpBattle.value || "").trim();
    const otp = (inpOTP.value || "").trim();
    myName = (inpName.value || "").trim();

    if (!battleId) return setAuthErr("전투 ID를 입력하세요.");
    if (!otp)      return setAuthErr("비밀번호를 입력하세요.");
    if (!myName)   return setAuthErr("표시할 이름을 입력하세요.");

    socket.emit("spectator:join", { battleId, otp, name: myName });
  }

  socket.on("spectator:join_ok", () => {
    if (authModal) authModal.style.display = "none";
    if (app) app.style.display = "";
    if (pillBattle) pillBattle.textContent = "전투: " + battleId;
    pushLine(`<span class="log-sys">시스템</span> · 관전 시작`, "log-sys");
    bindCheers();
  });

  socket.on("authError", ({ error }) => {
    setAuthErr(mapAuthError(error));
  });

  // ───────────────────────────────────────────────────────────
  // 전투/턴/로그 수신
  // ───────────────────────────────────────────────────────────
  socket.on("battleUpdate", (b) => renderBattle(b));

  socket.on("battle:chat", ({ name, msg }) => {
    pushLine(`<span class="who">${escapeHtml(name)}:</span> ${escapeHtml(msg)}`);
  });

  socket.on("battle:log", ({ type, msg }) => {
    const cls = type === "system" ? "log-sys"
             : type === "cheer"   ? "log-cheer"
             : type === "action"  ? "log-dmg"
             : "";
    pushLine(`<span class="${cls}">${escapeHtml(msg)}</span>`, cls);
  });

  socket.on("turn:tick", ({ remaining }) => updateTimer(remaining || 0));

  // ───────────────────────────────────────────────────────────
  // 렌더링
  // ───────────────────────────────────────────────────────────
  function renderBattle(b) {
    // 상단 상태
    pillStatus.textContent = "상태: " + (b.status || "-");

    // 현재 턴
    const cur = b.turn?.current ? (b.players || []).find(p => p.id === b.turn.current) : null;
    const curName = cur ? cur.name : "-";
    pillTurn.textContent = "턴: " + curName;
    turnName.textContent = curName;
    turnPortrait.src = cur?.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=active";

    // 팀 분할
    const phoenix = (b.players || []).filter(p => toTeamKey(p.team) === "phoenix");
    const eaters  = (b.players || []).filter(p => toTeamKey(p.team) === "eaters");

    renderTeam(phoenixList, phoenix);
    renderTeam(eatersList, eaters);

    // 요약(체력 합)
    // 우측 박스는 spectator.html에서 #statusBox로 표현되므로 여기서는 battleUpdate만 유지
    const sumA = phoenix.reduce((s, p) => s + Math.max(0, p.hp || 0), 0);
    const sumB = eaters.reduce((s, p) => s + Math.max(0, p.hp || 0), 0);
    pushDebug(`체력 합 · 불사조 ${sumA} / 죽음을 먹는 자들 ${sumB}`);
  }

  function renderTeam(wrap, list) {
    if (!wrap) return;
    wrap.innerHTML = "";
    list.forEach(p => {
      const el = document.createElement("div");
      el.className = "pitem";
      el.innerHTML = `
        <img class="pava" src="${p.avatar || ""}" alt="">
        <div>
          <div style="font-weight:700">${escapeHtml(p.name || "-")}</div>
          <div class="pmeta">HP ${p.hp}/${p.maxHp || 100} · 공격력 ${p.stats?.atk ?? 0} · 방어력 ${p.stats?.def ?? 0}</div>
        </div>
        <div class="status ${p.alive === false || p.hp <= 0 ? "dead" : "alive"}">${(p.alive === false || p.hp <= 0) ? "사망" : "생존"}</div>
      `;
      wrap.appendChild(el);
    });
  }

  // ───────────────────────────────────────────────────────────
  // 응원
  // ───────────────────────────────────────────────────────────
  function bindCheers() {
    if (!cheerBtns) return;
    cheerBtns.querySelectorAll(".cbtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const msg = btn.dataset.msg;
        socket.emit("spectator:cheer", { battleId, name: myName, msg });
      });
    });
  }

  // ───────────────────────────────────────────────────────────
  // 타이머
  // ───────────────────────────────────────────────────────────
  function updateTimer(remainingMs) {
    const total = 5 * 60 * 1000; // 5분
    const pct = Math.max(0, Math.min(100, Math.round((remainingMs / total) * 100)));
    timerFill.style.width = pct + "%";
  }

  // ───────────────────────────────────────────────────────────
  // 타임라인 출력
  // ───────────────────────────────────────────────────────────
  function pushLine(html, cls = "") {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "line " + cls;
    div.innerHTML = html;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function pushDebug(text) {
    // 필요 시 디버그 출력 활성화
    // pushLine(`<span class="log-sys">${escapeHtml(text)}</span>`, "log-sys");
  }

  // ───────────────────────────────────────────────────────────
  // 유틸
  // ───────────────────────────────────────────────────────────
  function setAuthErr(msg) {
    if (authErr) authErr.textContent = msg || "";
  }

  function mapAuthError(code) {
    switch (code) {
      case "OTP_INVALID": return "비밀번호가 유효하지 않습니다.";
      case "BATTLE_NOT_FOUND": return "전투를 찾을 수 없습니다.";
      default: return "인증 실패";
    }
  }

  function toTeamKey(serverTeam) {
    return (serverTeam === "A" || serverTeam === "phoenix") ? "phoenix" : "eaters";
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, a => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[a]));
  }

  // 쿼리스트링으로 자동 채움(관전용은 자동 조인까지는 하지 않음)
  (function seedFromQS(){
    const o = qs.get("otp") || "";
    const n = qs.get("name") || "";
    if (o) inpOTP.value = o;
    if (n) inpName.value = n;
  })();
})();
