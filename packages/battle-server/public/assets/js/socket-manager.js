/* PYXIS Socket Manager (browser)
   - 서버(index.js) 이벤트와 1:1 매칭
   - 관리자 새로고침 방지(leave confirm) 강제 해제
   - Admin/Player/Spectator 공용 래퍼
   - 이모지 금지, 콘솔 로깅 강화
*/

(function (root) {
  "use strict";

  // ──────────────────────────────────────────────
  // 강제: 새로고침/탭닫기 경고(leave confirm) 해제
  // ──────────────────────────────────────────────
  try {
    // 가장 흔한 패턴 제거
    window.onbeforeunload = null;
    // 캡처 단계에서 다른 beforeunload 핸들러가 동작하기 전에 차단
    window.addEventListener(
      "beforeunload",
      function (e) {
        // 어떤 스크립트가 preventDefault를 하더라도 여기서 막아 경고창 비표시
        // (일부 브라우저는 beforeunload에서 stopImmediatePropagation을 허용)
        if (e && typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }
        // 절대 preventDefault/returnValue 설정하지 않음 → 경고창 미노출
      },
      true
    );
    // 인기 라이브러리들이 남겨둔 흔적들 추가 방지
    delete window.onbeforeunload;
  } catch (_) {}

  // ──────────────────────────────────────────────
  // 유틸
  // ──────────────────────────────────────────────
  const NOOP = () => {};
  const LOGPFX = "[PYXIS/socket]";

  function clampLen(str, n) {
    str = String(str == null ? "" : str);
    return str.length > n ? str.slice(0, n) : str;
  }

  function isFn(fn) {
    return typeof fn === "function";
  }

  // ──────────────────────────────────────────────
  // 소켓 매니저
  // ──────────────────────────────────────────────
  class SocketManager {
    constructor() {
      this.socket = null;
      this.url = undefined;

      // 이벤트 리스너 레지스트리
      this.handlers = new Map();

      // 마지막 battleId/role 캐시
      this.ctx = {
        role: "guest", // admin | player | spectator | guest
        battleId: null,
        playerId: null,
        name: null,
      };
    }

    // -----------------------------
    // 연결
    // -----------------------------
    connect(url) {
      this.url = url || (root.PyxisSocket && root.PyxisSocket.url) || undefined;

      if (!root.io) {
        console.error(LOGPFX, "Socket.IO가 로드되지 않았습니다.");
        return;
      }

      // 재연결 옵션은 서버 ping/pong과 잘 맞음
      const socket = root.io(this.url, {
        transports: ["websocket", "polling"],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 20000,
      });

      this.socket = socket;
      this._bindCore();

      return socket;
    }

    // 내부 바인딩
    _bindCore() {
      const s = this.socket;
      if (!s) return;

      s.on("connect", () => {
        console.log(LOGPFX, "connected:", s.id);
        this._emitLocal("connect");
      });

      s.on("disconnect", (reason) => {
        console.log(LOGPFX, "disconnect:", reason);
        this._emitLocal("disconnect", reason);
      });

      s.on("error", (err) => {
        console.error(LOGPFX, "socket error:", err);
        this._emitLocal("error", err);
      });

      // ----- 인증/오류 -----
      s.on("auth:success", (payload) => {
        console.log(LOGPFX, "auth success:", payload);
        if (payload?.role) this.ctx.role = payload.role;
        if (payload?.battleId) this.ctx.battleId = payload.battleId;
        if (payload?.playerId) this.ctx.playerId = payload.playerId;
        this._emitLocal("auth:success", payload);
      });

      s.on("authError", (e) => {
        console.warn(LOGPFX, "auth error:", e);
        this._emitLocal("auth:error", e);
      });

      // ----- 전투 상태 -----
      s.on("battle:update", (b) => {
        this._emitLocal("battle:update", b);
      });
      s.on("battle:started", (b) => {
        this._emitLocal("battle:started", b);
      });
      s.on("battle:paused", (b) => {
        this._emitLocal("battle:paused", b);
      });
      s.on("battle:resumed", (b) => {
        this._emitLocal("battle:resumed", b);
      });
      s.on("battle:ended", (b) => {
        this._emitLocal("battle:ended", b);
      });

      // ----- 채팅/로그 -----
      s.on("battle:chat", (msg) => {
        this._emitLocal("battle:chat", msg);
      });
      s.on("battle:log", (line) => {
        this._emitLocal("battle:log", line);
      });

      // ----- 관전자 -----
      s.on("spectator:count", ({ count }) => {
        this._emitLocal("spectator:count", { count: Number(count) || 0 });
      });

      // ----- 생성/시작 응답 (서버 이벤트명에 맞춤) -----
      s.on("battleCreated", (res) => {
        // { success, battleId, mode, adminUrl, playerBase, spectatorBase, error? }
        this._emitLocal("battle:created", res);

        if (res?.success && res.battleId) {
          // 생성 직후 자동 관리자 인증
          this.adminAuth(res.battleId, `admin-${res.battleId}`);
        }
      });

      s.on("battleStarted", (res) => {
        this._emitLocal("battle:started:ack", res);
      });

      // 개별 액션 응답
      s.on("playerAdded", (res) => this._emitLocal("player:added:ack", res));
      s.on("playerRemoved", (res) => this._emitLocal("player:removed:ack", res));
      s.on("playerUpdated", (res) => this._emitLocal("player:updated:ack", res));
      s.on("action:success", (res) => this._emitLocal("action:success", res));
      s.on("action:error", (res) => this._emitLocal("action:error", res));

      // 기타
      s.on("battleError", (e) => this._emitLocal("battle:error", e));
      s.on("pong", () => this._emitLocal("pong"));
    }

    // 로컬 이벤트 방출(구독자 통지)
    _emitLocal(evt, payload) {
      const list = this.handlers.get(evt);
      if (list && list.length) {
        list.forEach((fn) => {
          try { fn(payload); } catch (e) { console.error(LOGPFX, "handler error", evt, e); }
        });
      }
    }

    on(evt, handler) {
      if (!this.handlers.has(evt)) this.handlers.set(evt, []);
      this.handlers.get(evt).push(handler);
      return () => {
        const arr = this.handlers.get(evt) || [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    }

    // -----------------------------
    // 공통
    // -----------------------------
    join(battleId) {
      const id = battleId || this.ctx.battleId;
      if (!this.socket || !id) return;
      this.socket.emit("join", { battleId: id });
    }

    sendChat(message, opt = {}) {
      if (!this.socket) return;
      const payload = {
        battleId: opt.battleId || this.ctx.battleId,
        name: clampLen(opt.name || this.ctx.name || "", 30),
        message: clampLen(message || "", 200),
        team: opt.team || null,
        role: opt.role || this.ctx.role || "player",
      };
      if (!payload.battleId || !payload.message) return;
      this.socket.emit("chat:send", payload);
    }

    sendCheer(cheer, opt = {}) {
      if (!this.socket) return;
      const payload = {
        battleId: opt.battleId || this.ctx.battleId,
        cheer: clampLen(cheer || "", 100),
        name: clampLen(opt.name || this.ctx.name || "", 30),
      };
      if (!payload.battleId || !payload.cheer) return;
      this.socket.emit("cheer:send", payload);
    }

    ping() {
      if (!this.socket) return;
      this.socket.emit("ping");
    }

    // -----------------------------
    // 관리자
    // -----------------------------
    adminAuth(battleId, token) {
      if (!this.socket) return;
      this.ctx.role = "admin";
      this.ctx.battleId = battleId;
      this.socket.emit("adminAuth", { battleId, token });
    }

    createBattle(mode = "1v1") {
      if (!this.socket) return;
      // 서버 이벤트명: createBattle
      this.socket.emit("createBattle", { mode });
    }

    startBattle(battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("startBattle", { battleId: id });
    }

    pauseBattle(battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("pauseBattle", { battleId: id });
    }

    resumeBattle(battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("resumeBattle", { battleId: id });
    }

    endBattle(battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("endBattle", { battleId: id });
    }

    addPlayer(battleId, playerData) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("addPlayer", { battleId: id, playerData });
    }

    removePlayer(battleId, playerId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id || !playerId) return;
      this.socket.emit("removePlayer", { battleId: id, playerId });
    }

    updatePlayer(battleId, playerId, updates) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id || !playerId) return;
      this.socket.emit("updatePlayer", { battleId: id, playerId, updates });
    }

    generatePlayerLinks(battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("generatePlayerPassword", { battleId: id });
    }

    generateSpectatorUrl(battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id) return;
      this.socket.emit("generateSpectatorOtp", { battleId: id });
    }

    // -----------------------------
    // 플레이어
    // -----------------------------
    playerAuth({ battleId, name, token }) {
      if (!this.socket) return;
      this.ctx.role = "player";
      this.ctx.battleId = battleId;
      this.ctx.name = name || null;
      this.socket.emit("playerAuth", { battleId, name, token });
    }

    playerReady(playerId, battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id || !playerId) return;
      this.socket.emit("player:ready", { battleId: id, playerId });
    }

    playerAction(playerId, action, battleId) {
      if (!this.socket) return;
      const id = battleId || this.ctx.battleId;
      if (!id || !playerId || !action) return;
      this.socket.emit("player:action", { battleId: id, playerId, action });
    }

    // -----------------------------
    // 관전자
    // -----------------------------
    spectatorAuth({ battleId, otp, name }) {
      if (!this.socket) return;
      this.ctx.role = "spectator";
      this.ctx.battleId = battleId;
      this.ctx.name = name || null;
      this.socket.emit("spectatorAuth", { battleId, otp, name });
    }
  }

  // 싱글턴 제공
  root.PyxisSocketManager = new SocketManager();

  // 편의 노출
  root.PyxisSocketAPI = {
    connect: (url) => root.PyxisSocketManager.connect(url),

    // 공통
    join: (id) => root.PyxisSocketManager.join(id),
    sendChat: (msg, opt) => root.PyxisSocketManager.sendChat(msg, opt),
    sendCheer: (msg, opt) => root.PyxisSocketManager.sendCheer(msg, opt),
    on: (evt, fn) => root.PyxisSocketManager.on(evt, fn),
    ping: () => root.PyxisSocketManager.ping(),

    // 관리자
    adminAuth: (id, token) => root.PyxisSocketManager.adminAuth(id, token),
    createBattle: (mode) => root.PyxisSocketManager.createBattle(mode),
    startBattle: (id) => root.PyxisSocketManager.startBattle(id),
    pauseBattle: (id) => root.PyxisSocketManager.pauseBattle(id),
    resumeBattle: (id) => root.PyxisSocketManager.resumeBattle(id),
    endBattle: (id) => root.PyxisSocketManager.endBattle(id),
    addPlayer: (id, data) => root.PyxisSocketManager.addPlayer(id, data),
    removePlayer: (id, pid) => root.PyxisSocketManager.removePlayer(id, pid),
    updatePlayer: (id, pid, up) => root.PyxisSocketManager.updatePlayer(id, pid, up),
    generatePlayerLinks: (id) => root.PyxisSocketManager.generatePlayerLinks(id),
    generateSpectatorUrl: (id) => root.PyxisSocketManager.generateSpectatorUrl(id),

    // 플레이어
    playerAuth: (args) => root.PyxisSocketManager.playerAuth(args),
    playerReady: (pid, id) => root.PyxisSocketManager.playerReady(pid, id),
    playerAction: (pid, action, id) => root.PyxisSocketManager.playerAction(pid, action, id),

    // 관전자
    spectatorAuth: (args) => root.PyxisSocketManager.spectatorAuth(args),
  };
})(typeof window !== "undefined" ? window : this);
