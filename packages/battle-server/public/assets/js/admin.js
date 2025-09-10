/* PYXIS Admin Client (no refresh blockers)
   - 팀 표기: 화면엔 A/B만 노출 (내부 team key: phoenix / eaters)
   - 전투 생성/시작/일시정지/재개/종료
   - 참가자 추가(+아바타 업로드)
   - 로그/채팅
   - 참가자/관전자 링크·비밀번호 발급
*/

(function () {
  "use strict";

  // -----------------------------
  // DOM
  // -----------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const el = {
    // 상태 표시
    connText: $("#connText"),
    connDot: $("#connDot"),
    currentBattleId: $("#currentBattleId"),
    currentMode: $("#currentMode"),
    turnInfo: $("#turnInfo"),

    // 전투 컨트롤
    battleMode: $("#battleMode"),
    btnCreateBattle: $("#btnCreateBattle"),
    btnStartBattle: $("#btnStartBattle"),
    btnPauseBattle: $("#btnPauseBattle"),
    btnResumeBattle: $("#btnResumeBattle"),
    btnEndBattle: $("#btnEndBattle"),

    // 참가자 추가
    pName: $("#pName"),
    pTeam: $("#pTeam"),
    pHP: $("#pHP"),
    sATK: $("#sATK"),
    sDEF: $("#sDEF"),
    sDEX: $("#sDEX"),
    sLUK: $("#sLUK"),
    itemDittany: $("#itemDittany"),
    itemAtkBoost: $("#itemAtkBoost"),
    itemDefBoost: $("#itemDefBoost"),
    pImage: $("#pImage"),
    btnAddPlayer: $("#btnAddPlayer"),

    // 인원 목록
    rosterA: $("#rosterPhoenix"),
    rosterB: $("#rosterEaters"),

    // 로그/채팅
    battleLog: $("#battleLog"),
    chatView: $("#chatView"),
    chatText: $("#chatText"),
    btnChatSend: $("#btnChatSend"),

    // 발급 도구(공용 리스트)
    issueList: $("#issueList"),
    btnIssuePlayerPw: $("#btnIssuePlayerPw"),
    btnIssueSpectatorPw: $("#btnIssueSpectatorPw"),
    btnIssuePlayerLinks: $("#btnIssuePlayerLinks"),
    btnIssueSpectatorLink: $("#btnIssueSpectatorLink"),

    // 관전자 OTP(로그 아래 전용 섹션)
    btnGenSpect: $("#btnGenSpect"),
    spectUrl: $("#spectUrl"),
    btnCopySpect: $("#btnCopySpect"),
    spectatorIssueStatus: $("#spectatorIssueStatus"),
    spectatorResult: $("#spectatorResult"),
  };

  // -----------------------------
  // 상태
  // -----------------------------
  const state = {
    socket: null,
    battleId: null,
    mode: "1v1",
    players: [],
    status: "waiting",
    currentTeam: null,
    turn: 0,
  };

  // -----------------------------
  // 유틸
  // -----------------------------
  function toast(msg) {
    try {
      window.UIHelpers?.toast?.(msg);
    } catch {
      console.log(msg);
    }
  }
  function success(msg) {
    try {
      window.UIHelpers?.success?.(msg);
    } catch {
      console.log(msg);
    }
  }
  function errorToast(msg) {
    try {
      window.UIHelpers?.error?.(msg);
    } catch {
      console.error(msg);
    }
  }
  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return "";
    }
  }
  function teamLabel(teamKey) {
    return teamKey === "phoenix" ? "A" : "B";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function qs(key) {
    return new URLSearchParams(location.search).get(key);
  }
  function setConn(ok) {
    if (el.connDot) {
      el.connDot.classList.toggle("ok", !!ok);
      el.connDot.classList.toggle("bad", !ok);
    }
    if (el.connText) el.connText.textContent = ok ? "연결됨" : "연결 끊김";
  }
  function setSpectStatus(text, show = true) {
    if (!el.spectatorIssueStatus) return;
    el.spectatorIssueStatus.textContent = text || "대기";
    el.spectatorIssueStatus.style.display = show ? "" : "none";
  }

  // -----------------------------
  // 초기화
  // -----------------------------
  window.addEventListener("DOMContentLoaded", () => {
    connectSocket();
    bindUI();
    autoAttachIfQueryHasBattle();
  });

  function connectSocket() {
    const url = (window.PyxisSocket && window.PyxisSocket.url) || undefined;
    const socket = window.io ? window.io(url, { transports: ["websocket", "polling"], withCredentials: true }) : null;
    if (!socket) {
      alert("Socket.IO 로드 실패");
      return;
    }
    state.socket = socket;
    window.socket = socket; // 외부 스크립트 호환

    // 알림 모듈(Optional)
    if (window.PyxisNotify && typeof window.PyxisNotify.init === "function") {
      window.PyxisNotify.init({ socket });
    }

    bindSocket(socket);
  }

  // -----------------------------
  // 소켓 바인딩
  // -----------------------------
  function bindSocket(s) {
    s.on("connect", () => setConn(true));
    s.on("disconnect", () => setConn(false));

    // 생성 결과
    s.on("battleCreated", (res) => {
      if (!res || res.success === false) {
        errorToast(res?.error || "전투 생성 실패");
        return;
      }
      const { battleId, mode } = res;
      state.battleId = battleId;
      state.mode = mode || state.mode;
      updateHeader();
      success(`전투 생성: ${battleId}`);
      // 관리자 인증(자동)
      s.emit("adminAuth", { battleId, token: `admin-${battleId}` });
    });

    // 관리자 인증
    s.on("auth:success", (p) => {
      if (p?.role !== "admin") return;
      success("관리자 인증 성공");
    });

    s.on("authError", (e) => errorToast(e?.error || "인증 오류"));

    // 전투 갱신
    s.on("battle:update", (b) => {
      if (!b) return;
      applyBattleUpdate(b);
    });

    // 상태 이벤트 (보조)
    ["battle:started", "battle:paused", "battle:resumed", "battle:ended"].forEach((evt) => {
      s.on(evt, (b) => b && applyBattleUpdate(b));
    });

    // 로그/채팅
    s.on("battle:log", ({ type, message, timestamp }) => {
      appendLog(type || "system", message, timestamp);
    });
    s.on("battle:chat", ({ name, message, timestamp }) => {
      appendChat(name || "익명", message, timestamp);
    });

    // 참가자 추가/수정/삭제
    s.on("playerAdded", (res) => {
      if (!res?.success) return errorToast(res?.error || "참가자 추가 실패");
      success(`참가자 추가: ${res.player?.name || ""}`);
    });
    s.on("playerRemoved", (res) => {
      if (!res?.success) return errorToast(res?.error || "참가자 제거 실패");
      success(`참가자 제거 완료`);
    });
    s.on("playerUpdated", (res) => {
      if (!res?.success) return errorToast(res?.error || "참가자 수정 실패");
      success(`참가자 수정 완료`);
    });

    // 발급(서버)
    s.on("playerPasswordGenerated", (res) => {
      if (!res || res.success === false) {
        return errorToast(res?.error || "참가자 링크 발급 실패");
      }
      renderIssueList(
        res.playerLinks.map((p) => ({
          label: `플레이어 ${p.name} (${teamLabel(p.team)})`,
          value: p.url,
        }))
      );
      success("참가자 링크 발급 완료");
    });

    s.on("spectatorOtpGenerated", (res) => {
      if (!res || res.success === false) {
        setSpectStatus("실패");
        return errorToast(res?.error || "관전자 링크 발급 실패");
      }
      if (el.spectUrl) el.spectUrl.value = res.spectatorUrl || "";
      if (el.spectatorResult) el.spectatorResult.style.display = "";
      setSpectStatus("발급 완료");
      success("관전자 링크 발급 완료");
    });

    s.on("battleError", (res) => errorToast(res?.error || "요청 실패"));
  }

  // -----------------------------
  // UI 바인딩
  // -----------------------------
  function bindUI() {
    if (el.btnCreateBattle) el.btnCreateBattle.addEventListener("click", onCreateBattle);
    if (el.btnStartBattle) el.btnStartBattle.addEventListener("click", onStartBattle);
    if (el.btnPauseBattle) el.btnPauseBattle.addEventListener("click", onPauseBattle);
    if (el.btnResumeBattle) el.btnResumeBattle.addEventListener("click", onResumeBattle);
    if (el.btnEndBattle) el.btnEndBattle.addEventListener("click", onEndBattle);

    if (el.btnAddPlayer) el.btnAddPlayer.addEventListener("click", onAddPlayer);

    if (el.btnChatSend) el.btnChatSend.addEventListener("click", sendChat);
    if (el.chatText)
      el.chatText.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendChat();
      });

    // 발급(클라이언트 계산)
    if (el.btnIssuePlayerPw) el.btnIssuePlayerPw.addEventListener("click", issuePlayerPwClient);
    if (el.btnIssueSpectatorPw) el.btnIssueSpectatorPw.addEventListener("click", issueSpectatorPwClient);

    // 발급(서버)
    if (el.btnIssuePlayerLinks) el.btnIssuePlayerLinks.addEventListener("click", () => {
      if (!state.battleId) return toast("전투 ID가 없습니다");
      state.socket.emit("generatePlayerPassword", { battleId: state.battleId });
    });
    if (el.btnIssueSpectatorLink) el.btnIssueSpectatorLink.addEventListener("click", () => {
      if (!state.battleId) return toast("전투 ID가 없습니다");
      state.socket.emit("generateSpectatorOtp", { battleId: state.battleId });
    });

    // 관전자 OTP(전용)
    if (el.btnGenSpect) {
      el.btnGenSpect.addEventListener("click", () => {
        if (!state.battleId) return toast("전투 ID가 없습니다");
        if (el.spectatorResult) el.spectatorResult.style.display = "none";
        if (el.spectUrl) el.spectUrl.value = "";
        setSpectStatus("발급 요청 중...");
        state.socket.emit("generateSpectatorOtp", { battleId: state.battleId });
      });
    }
    if (el.btnCopySpect) {
      el.btnCopySpect.addEventListener("click", () => {
        const v = el.spectUrl?.value || "";
        if (!v) return;
        navigator.clipboard.writeText(v).then(() => toast("관전자 링크 복사됨"));
      });
    }
  }

  // -----------------------------
  // 자동 관리자 인증(쿼리)
  // -----------------------------
  function autoAttachIfQueryHasBattle() {
    const battle = qs("battle");
    // token 쿼리가 없어도 서버는 admin-${battleId} 형식만 허용하므로 직접 계산해서 인증
    if (battle && state.socket) {
      state.battleId = battle;
      state.socket.emit("adminAuth", { battleId: battle, token: `admin-${battle}` });
      updateHeader();
    }
  }

  // -----------------------------
  // 이벤트 핸들러
  // -----------------------------
  function onCreateBattle() {
    const mode = el.battleMode?.value || "1v1";
    state.mode = mode;
    state.socket.emit("createBattle", { mode });
  }

  function onStartBattle() {
    if (!state.battleId) return toast("전투 ID가 없습니다");
    state.socket.emit("startBattle", { battleId: state.battleId });
  }

  function onPauseBattle() {
    if (!state.battleId) return toast("전투 ID가 없습니다");
    state.socket.emit("pauseBattle", { battleId: state.battleId });
  }

  function onResumeBattle() {
    if (!state.battleId) return toast("전투 ID가 없습니다");
    state.socket.emit("resumeBattle", { battleId: state.battleId });
  }

  function onEndBattle() {
    if (!state.battleId) return toast("전투 ID가 없습니다");
    state.socket.emit("endBattle", { battleId: state.battleId });
  }

  async function onAddPlayer() {
    try {
      if (!state.battleId) {
        toast("전투 ID가 없습니다");
        return;
      }
      const name = (el.pName?.value || "").trim();
      const team = el.pTeam?.value || "phoenix"; // 내부키
      const hp = parseInt(el.pHP?.value || "100", 10);

      if (!name) return toast("이름을 입력하세요");

      // 아바타 업로드(선택)
      let avatar = null;
      const file = el.pImage?.files?.[0];
      if (file) {
        const fd = new FormData();
        fd.append("avatar", file);
        const res = await fetch("/api/upload/avatar", { method: "POST", body: fd });
        const js = await res.json();
        if (!js?.ok) throw new Error(js?.error || "아바타 업로드 실패");
        avatar = js.avatarUrl;
      }

      const playerData = {
        name,
        team,
        hp,
        stats: {
          attack: parseInt(el.sATK?.value || "3", 10),
          defense: parseInt(el.sDEF?.value || "3", 10),
          agility: parseInt(el.sDEX?.value || "3", 10),
          luck: parseInt(el.sLUK?.value || "3", 10),
        },
        items: {
          dittany: parseInt(el.itemDittany?.value || "1", 10),
          attack_booster: parseInt(el.itemAtkBoost?.value || "1", 10),
          defense_booster: parseInt(el.itemDefBoost?.value || "1", 10),
        },
        avatar,
      };

      state.socket.emit("addPlayer", { battleId: state.battleId, playerData });
    } catch (e) {
      errorToast(e?.message || "참가자 추가 중 오류");
    }
  }

  function sendChat() {
    const msg = (el.chatText?.value || "").trim();
    if (!state.battleId || !msg) return;
    state.socket.emit("chat:send", {
      battleId: state.battleId,
      name: "관리자",
      role: "admin",
      message: msg,
    });
    el.chatText.value = "";
  }

  // -----------------------------
  // 발급(클라이언트 계산)
  // -----------------------------
  function issuePlayerPwClient() {
    if (!state.battleId) return toast("전투 ID가 없습니다");
    const items = state.players.map((p) => ({
      label: `플레이어 ${p.name} (${teamLabel(p.team)})`,
      value: `player-${p.name}-${state.battleId}`,
    }));
    renderIssueList(items);
  }

  function issueSpectatorPwClient() {
    if (!state.battleId) return toast("전투 ID가 없습니다");
    renderIssueList([{ label: "관전자 비밀번호(otp)", value: `spectator-${state.battleId}` }]);
  }

  // -----------------------------
  // 렌더링
  // -----------------------------
  function applyBattleUpdate(b) {
    state.battleId = b.id || state.battleId;
    state.mode = b.mode || state.mode;
    state.status = b.status || state.status;
    state.players = Array.isArray(b.players) ? b.players : state.players;
    state.currentTeam = b.currentTeam || b.currentPlayer || null; // 호환
    state.turn = b.turn || b.turnNumber || state.turn;

    updateHeader();
    renderRosters();
    renderLogsSnapshot(b.log);
  }

  function updateHeader() {
    if (el.currentBattleId) el.currentBattleId.textContent = state.battleId || "-";
    if (el.currentMode) el.currentMode.textContent = state.mode || "-";
    if (el.turnInfo) {
      const s =
        state.status === "active"
          ? `턴 ${state.turn || 1} • 팀 ${state.currentTeam ? teamLabel(state.currentTeam) : "-"} 차례`
          : state.status === "paused"
          ? "일시정지"
          : state.status === "ended"
          ? "전투 종료"
          : "대기 중";
      el.turnInfo.textContent = s;
    }
  }

  function renderRosters() {
    if (el.rosterA) el.rosterA.innerHTML = "";
    if (el.rosterB) el.rosterB.innerHTML = "";

    const players = state.players || [];
    players.forEach((p) => {
      const card = document.createElement("div");
      card.className = "player";

      const lines = [];
      lines.push(`<div><strong>${esc(p.name)}</strong> <span class="badge">팀 ${teamLabel(p.team)}</span></div>`);
      lines.push(
        `<div class="mono">HP ${Math.max(0, p.hp || 0)} / ${Math.max(1, p.maxHp || p.hp || 100)}</div>`
      );
      if (p.stats) {
        lines.push(
          `<div class="mono">ATK ${p.stats.attack ?? "-"} | DEF ${p.stats.defense ?? "-"} | DEX ${p.stats.agility ?? "-"} | LUK ${p.stats.luck ?? "-"}</div>`
        );
      }
      card.innerHTML = lines.join("");
      (p.team === "phoenix" ? el.rosterA : el.rosterB).appendChild(card);
    });
  }

  function renderLogsSnapshot(list) {
    if (!el.battleLog) return;
    if (!Array.isArray(list)) return;
    const sliced = list.slice(-150);
    el.battleLog.innerHTML = "";
    sliced.forEach((l) => appendLog(l.type || "system", l.message || "", l.ts || l.timestamp));
  }

  function appendLog(type, message, ts) {
    if (!el.battleLog) return;
    const div = document.createElement("div");
    div.textContent = `[${fmtTime(ts || Date.now())}] ${message || ""}`;
    el.battleLog.appendChild(div);
    el.battleLog.scrollTop = el.battleLog.scrollHeight;
  }

  function appendChat(who, msg, ts) {
    if (!el.chatView) return;
    const div = document.createElement("div");
    div.innerHTML = `<span class="mono">${esc(who)}</span>: ${esc(msg)}`;
    el.chatView.appendChild(div);
    el.chatView.scrollTop = el.chatView.scrollHeight;
  }

  function renderIssueList(items) {
    if (!el.issueList) return;
    el.issueList.innerHTML = "";
    (items || []).forEach(({ label, value }) => {
      const row = document.createElement("div");
      row.className = "copy-row";
      row.innerHTML = `
        <div class="copy-label">${esc(label)}</div>
        <div class="flex">
          <div class="copy-value mono">${esc(value)}</div>
          <button class="btn">복사</button>
        </div>
      `;
      const btn = row.querySelector("button");
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(value).then(() => toast("복사됨"));
      });
      el.issueList.appendChild(row);
    });
  }
})();
