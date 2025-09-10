/* PYXIS Admin - 관리자 클라이언트 (통짜 JS)
   - 새로고침/닫기 방지 완전 해제 포함
   - 서버(index.js)와 이벤트 1:1 매칭
   - emit:   createBattle, startBattle, pauseBattle, resumeBattle, endBattle,
             addPlayer, removePlayer, generatePlayerPassword, generateSpectatorOtp,
             chat:send, join, adminAuth
   - on:     battleCreated, battle:update, battle:started, battle:paused, battle:resumed,
             battle:ended, playerAdded, playerRemoved, playerPasswordGenerated,
             spectatorOtpGenerated, battle:chat, battle:log, auth:success, authError
   - 이모지 금지
*/

(function () {
  "use strict";

  // ──────────────────────────────────────────────
  // 0) 새로고침/닫기 방지 완전 해제 (최상단에서 실행)
  // ──────────────────────────────────────────────
  (function unlockRefresh() {
    try {
      window.onbeforeunload = null;
      try { delete window.onbeforeunload; } catch (_) {}
      const _add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, opts) {
        if (type === "beforeunload") return;
        return _add.call(this, type, listener, opts);
      };
      window.addEventListener("beforeunload", function (e) {
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      }, true);
      window.addEventListener("keydown", function (e) {
        const k = e.key || "";
        const isF5 = k === "F5";
        const isReloadCombo = (k.toLowerCase() === "r" && (e.ctrlKey || e.metaKey));
        if (isF5 || isReloadCombo) {
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        }
      }, true);
    } catch (err) {
      console.warn("[admin-refresh-unlock] fail", err);
    }
  })();

  // ──────────────────────────────────────────────
  // 1) DOM helpers
  // ──────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const TEAM_LABEL = { phoenix: "불사조 기사단", eaters: "죽음을 먹는 자" };

  function capChildren(container, max) {
    if (!container) return;
    const nodes = container.querySelectorAll(":scope > *");
    const over = nodes.length - max;
    if (over > 0) {
      for (let i = 0; i < over; i++) nodes[i].remove();
    }
  }

  function appendLog(type, message) {
    const box = $("battleLog");
    if (!box) return;
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message || ""}`;
    box.appendChild(line);
    capChildren(box, 400);
    box.scrollTop = box.scrollHeight;
  }

  function addChat(name, msg) {
    const box = $("chatView");
    if (!box) return;
    const line = document.createElement("div");
    line.textContent = `${name}: ${msg}`;
    box.appendChild(line);
    capChildren(box, 200);
    box.scrollTop = box.scrollHeight;
  }

  function renderCopyList(items) {
    const list = $("issueList");
    if (!list) return;
    list.innerHTML = "";
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      const row = document.createElement("div");
      row.className = "copy-row";
      row.innerHTML = `<span class="copy-label">-</span><code class="copy-value">-</code>`;
      list.appendChild(row);
      return;
    }
    rows.forEach(({ label, value }) => {
      const row = document.createElement("div");
      row.className = "copy-row";
      const lab = document.createElement("span");
      lab.className = "copy-label";
      lab.textContent = label || "정보";
      const val = document.createElement("code");
      val.className = "copy-value";
      val.textContent = value || "-";
      val.dataset.copy = value || "";
      val.addEventListener("click", () => {
        const text = val.dataset.copy;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          const orig = val.textContent;
          val.textContent = `${orig} (복사됨)`;
          setTimeout(() => (val.textContent = orig), 1000);
        });
      });
      row.appendChild(lab);
      row.appendChild(val);
      list.appendChild(row);
    });
  }

  function setConn(ok) {
    const dot = $("connDot"), txt = $("connText");
    if (!dot || !txt) return;
    dot.classList.remove("ok", "bad");
    dot.classList.add(ok ? "ok" : "bad");
    txt.textContent = ok ? "연결됨" : "해제됨";
  }

  function updateHeader() {
    $("currentBattleId").textContent = state.battleId || "-";
    $("currentMode").textContent = state.mode || "-";
  }

  // ──────────────────────────────────────────────
  // 2) State
  // ──────────────────────────────────────────────
  const state = {
    socket: null,
    connected: false,
    battleId: null,
    token: null, // admin-<battleId>
    mode: "1v1",
    players: []
  };

  // ──────────────────────────────────────────────
  // 3) URL helpers
  // ──────────────────────────────────────────────
  function parseQuery() {
    const u = new URL(location.href);
    state.battleId = u.searchParams.get("battle");
    state.token = u.searchParams.get("token");
    updateHeader();
  }

  function setQuery(battleId, token) {
    const u = new URL(location.href);
    if (battleId) u.searchParams.set("battle", battleId);
    if (token) u.searchParams.set("token", token);
    history.replaceState({}, "", u.toString());
  }

  // ──────────────────────────────────────────────
  // 4) Roster rendering
  // ──────────────────────────────────────────────
  function renderRoster() {
    const px = $("rosterPhoenix");
    const et = $("rosterEaters");
    if (!px || !et) return;
    px.innerHTML = "";
    et.innerHTML = "";

    const roster = Array.isArray(state.players) ? state.players : [];
    roster.forEach((p) => {
      const card = document.createElement("div");
      card.className = "player";
      card.innerHTML = `
        <div class="top">
          <div>
            <div><strong>${p.name}</strong> <span class="mono">(${p.id})</span></div>
            <div class="muted">${TEAM_LABEL[p.team] || p.team}</div>
            <div>HP ${Math.max(0, p.hp || 0)} / ${Math.max(1, p.maxHp || 100)}</div>
          </div>
          <div>
            <button class="btn danger btnRemove" data-player="${p.id}" title="제거">제거</button>
          </div>
        </div>
        <details>
          <summary>상세</summary>
          <div class="row">공격 ${p.stats?.attack ?? "-"} / 방어 ${p.stats?.defense ?? "-"} / 민첩 ${p.stats?.agility ?? "-"} / 행운 ${p.stats?.luck ?? "-"}</div>
          <div class="row">아이템: 디터니 ${p.items?.dittany ?? 0}, 공격보정기 ${p.items?.attack_booster ?? 0}, 방어보정기 ${p.items?.defense_booster ?? 0}</div>
        </details>
      `;
      (p.team === "phoenix" ? px : et).appendChild(card);
    });

    // 제거 버튼 위임
    [px, et].forEach((root) => {
      root.addEventListener("click", (e) => {
        const btn = e.target.closest(".btnRemove");
        if (!btn) return;
        const pid = btn.getAttribute("data-player");
        if (!pid || !state.battleId) return;
        if (!confirm("해당 전투 참가자를 제거할까요?")) return;
        state.socket.emit("removePlayer", { battleId: state.battleId, playerId: pid });
      }, { once: true }); // 렌더링마다 한 번 바인딩
    });
  }

  // ──────────────────────────────────────────────
  // 5) Avatar 업로드
  // ──────────────────────────────────────────────
  async function uploadAvatar(file) {
    if (!file) return null;
    const fd = new FormData();
    fd.append("avatar", file);
    const res = await fetch("/api/upload/avatar", { method: "POST", body: fd });
    if (!res.ok) throw new Error("아바타 업로드 실패");
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "아바타 업로드 오류");
    return j.avatarUrl; // /uploads/...
  }

  // ──────────────────────────────────────────────
  // 6) Socket wiring
  // ──────────────────────────────────────────────
  function connectSocket() {
    const url = undefined; // 동일 오리진
    const socket = window.io ? window.io(url, { transports: ["websocket"], withCredentials: true }) : null;
    if (!socket) {
      alert("Socket.IO가 로드되지 않았습니다.");
      return;
    }
    state.socket = socket;

    socket.on("connect", () => {
      state.connected = true;
      setConn(true);
      appendLog("system", "서버에 연결됨");
      // 기존 배틀 룸 조인 + 관리자 인증
      if (state.battleId) socket.emit("join", { battleId: state.battleId });
      if (state.battleId && state.token) socket.emit("adminAuth", { battleId: state.battleId, token: state.token });
    });

    socket.on("disconnect", () => {
      state.connected = false;
      setConn(false);
      appendLog("system", "서버 연결 해제");
    });

    // 인증
    socket.on("auth:success", (p) => {
      if (p.role !== "admin") return;
      appendLog("system", "관리자 인증 성공");
      if (p.battleId) {
        state.battleId = p.battleId;
        updateHeader();
      }
    });
    socket.on("authError", (e) => {
      console.error("authError", e);
      alert("관리자 인증 실패: " + (e?.error || "오류"));
    });

    // 전투 생성
    socket.on("battleCreated", (res) => {
      if (res?.success === false) {
        renderCopyList([{ label: "오류", value: res.error || "전투 생성 실패" }]);
        appendLog("system", "전투 생성 실패: " + (res.error || "-"));
        return;
      }
      // index.js: { success, battleId, mode, adminUrl, playerBase, spectatorBase }
      state.battleId = res.battleId;
      state.mode = res.mode || state.mode;
      state.token = `admin-${state.battleId}`;
      updateHeader();

      // 룸 조인 + 관리자 인증
      state.socket.emit("join", { battleId: state.battleId });
      state.socket.emit("adminAuth", { battleId: state.battleId, token: state.token });

      // URL 갱신
      setQuery(state.battleId, state.token);

      // 발급 안내 보드
      renderCopyList([
        { label: "관리자 페이지", value: res.adminUrl },
        { label: "플레이어 베이스 URL", value: res.playerBase },
        { label: "관전자 베이스 URL", value: res.spectatorBase }
      ]);
      appendLog("system", `전투 생성됨: ${state.battleId} (${state.mode})`);
    });

    // 상태 업데이트
    socket.on("battle:update", (b) => {
      if (!b || !b.id) return;
      state.battleId = b.id;
      state.mode = b.mode || state.mode;
      state.players = Array.isArray(b.players) ? b.players : [];
      updateHeader();
      renderRoster();

      if (Array.isArray(b.log)) {
        $("battleLog").innerHTML = "";
        b.log.forEach((entry) => appendLog(entry.type || "system", entry.message || ""));
      }
    });

    socket.on("battle:started", () => appendLog("system", "전투 시작"));
    socket.on("battle:paused", () => appendLog("system", "전투 일시정지"));
    socket.on("battle:resumed", () => appendLog("system", "전투 재개"));
    socket.on("battle:ended", () => appendLog("system", "전투 종료"));

    // 참가자
    socket.on("playerAdded", (payload) => {
      if (payload?.success) {
        const p = payload.player;
        const exists = state.players.find((x) => x.id === p.id);
        if (!exists) state.players.push(p);
        renderRoster();
        appendLog("system", `전투 참가자 추가됨: ${p.name}`);
      } else {
        alert("전투 참가자 추가 실패: " + (payload?.error || "오류"));
      }
    });

    socket.on("playerRemoved", (payload) => {
      if (payload?.success) {
        const id = payload.playerId;
        state.players = state.players.filter((p) => p.id !== id);
        renderRoster();
        appendLog("system", `전투 참가자 제거됨: ${id}`);
      } else {
        alert("전투 참가자 제거 실패: " + (payload?.error || "오류"));
      }
    });

    // 발급
    socket.on("playerPasswordGenerated", (res) => {
      if (!res?.success) {
        return renderCopyList([{ label: "오류", value: "전투 참가자 링크 발급 실패: " + (res?.error || "알 수 없는 오류") }]);
      }
      const items = (res.playerLinks || []).map((p) => ({
        label: `전투 참가자 링크 (${TEAM_LABEL[p.team] || p.team} - ${p.name})`,
        value: p.url
      }));
      renderCopyList(items.length ? items : [{ label: "알림", value: "발급된 전투 참가자 링크가 없습니다." }]);
    });

    socket.on("spectatorOtpGenerated", (res) => {
      if (!res?.success) {
        return renderCopyList([{ label: "오류", value: "관전자 링크 발급 실패: " + (res?.error || "알 수 없는 오류") }]);
      }
      renderCopyList([{ label: "관전자 링크", value: res.spectatorUrl }]);
    });

    // 채팅/로그
    socket.on("battle:chat", (msg) => addChat(msg.name || "익명", msg.message || ""));
    socket.on("battle:log", (entry) => appendLog(entry.type || "system", entry.message || ""));
  }

  // ──────────────────────────────────────────────
  // 7) UI bindings
  // ──────────────────────────────────────────────
  function bindUI() {
    // 전투 컨트롤
    $("btnCreateBattle")?.addEventListener("click", () => {
      const mode = $("battleMode").value || "1v1";
      state.socket?.emit("createBattle", { mode });
      renderCopyList([{ label: "상태", value: `전투 생성 요청: ${mode}` }]);
    });

    $("btnStartBattle")?.addEventListener("click", () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      state.socket.emit("startBattle", { battleId: state.battleId });
    });

    $("btnPauseBattle")?.addEventListener("click", () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      state.socket.emit("pauseBattle", { battleId: state.battleId });
    });

    $("btnResumeBattle")?.addEventListener("click", () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      state.socket.emit("resumeBattle", { battleId: state.battleId });
    });

    $("btnEndBattle")?.addEventListener("click", () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      if (!confirm("전투를 종료할까요?")) return;
      state.socket.emit("endBattle", { battleId: state.battleId });
    });

    // 참가자 추가
    $("btnAddPlayer")?.addEventListener("click", async () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      const name = $("pName").value.trim();
      const team = $("pTeam").value || "phoenix";
      const hp = Math.max(1, parseInt($("pHP").value || "100", 10));
      const stats = {
        attack: clamp($("sATK").value, 1, 10),
        defense: clamp($("sDEF").value, 1, 10),
        agility: clamp($("sDEX").value, 1, 10),
        luck: clamp($("sLUK").value, 1, 10)
      };
      const items = {
        dittany: Math.max(0, parseInt($("itemDittany").value || "0", 10)),
        attack_booster: Math.max(0, parseInt($("itemAtkBoost").value || "0", 10)),
        defense_booster: Math.max(0, parseInt($("itemDefBoost").value || "0", 10))
      };

      let avatar = null;
      const file = $("pImage").files?.[0] || null;
      try {
        if (file) avatar = await uploadAvatar(file);
      } catch (e) {
        console.warn("아바타 업로드 실패:", e);
        alert("아바타 업로드 실패: " + (e?.message || e));
        return;
      }

      state.socket.emit("addPlayer", {
        battleId: state.battleId,
        playerData: { name, team, hp, stats, items, avatar }
      });
    });

    // 링크 발급
    $("btnIssuePlayerLinks")?.addEventListener("click", () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      state.socket.emit("generatePlayerPassword", { battleId: state.battleId });
    });

    $("btnIssueSpectatorLink")?.addEventListener("click", () => {
      if (!state.battleId) return alert("전투 ID가 없습니다.");
      state.socket.emit("generateSpectatorOtp", { battleId: state.battleId });
    });

    // 채팅
    $("btnChatSend")?.addEventListener("click", () => {
      if (!state.battleId) return;
      const message = ($("chatText").value || "").trim();
      if (!message) return;
      state.socket.emit("chat:send", { battleId: state.battleId, name: "관리자", message, role: "admin" });
      $("chatText").value = "";
    });
    $("chatText")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("btnChatSend").click();
    });
  }

  function clamp(v, min, max) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // ──────────────────────────────────────────────
  // 8) Boot
  // ──────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    parseQuery();
    bindUI();
    connectSocket();
  });
})();
