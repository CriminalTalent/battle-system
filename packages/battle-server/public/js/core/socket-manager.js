/* PYXIS Socket Manager (browser)
   - Node/Server 이벤트 규격에 맞춘 래퍼
   - 이 파일은 기존 socket-manager.js를 전면 교체한다 (이모지 금지)

   서버 이벤트 정리
   emit:
     adminAuth                   { battleId, token }
     player:auth                 { battleId, otp, name }
     spectator:join              { battleId, otp, name }
     player:ready                { battleId, playerId }
     player:action               { battleId, playerId, action }
     chat:send                   { battleId, name, msg }
     chatMessage (legacy)        { role, message, battleId }
     spectator:cheer             { battleId, name, msg }
     battle:start|pause|resume|end { battleId }

   on:
     connect / disconnect / connect_error
     authSuccess | authError               (관리자 auth)
     auth:success | auth:fail              (플레이어 auth)
     spectator:join_ok | authError         (관전자 auth)
     battleUpdate
     battle:chat
     battle:log
     turn:tick
*/

(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.SocketManager = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const DEFAULTS = {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    withCredentials: true,
  };

  function noop() {}

  class PyxisSocket {
    constructor(opts = {}) {
      this.opts = { ...DEFAULTS, ...(opts || {}) };
      this.socket = null;
      this.connected = false;

      // 사용자 콜백 저장소
      this.handlers = {
        connect: new Set(),
        disconnect: new Set(),
        connect_error: new Set(),
        // 인증
        adminAuthSuccess: new Set(),
        adminAuthError: new Set(),
        playerAuthSuccess: new Set(),
        playerAuthFail: new Set(),
        spectatorJoinOK: new Set(),
        spectatorAuthError: new Set(),
        // 전투/로그/채팅
        battleUpdate: new Set(),
        battleChat: new Set(),
        battleLog: new Set(),
        turnTick: new Set(),
      };

      // 메모
      this.state = {
        battleId: null,
        role: null,      // "admin"|"player"|"spectator"
        playerId: null,  // player only
        name: null,      // spectator/player friendly name
      };
    }

    // ────────────────────────────────────────────────────────
    // 연결
    // ────────────────────────────────────────────────────────
    connect() {
      if (this.socket) return this.socket;
      // eslint-disable-next-line no-undef
      const s = (this.socket = io(undefined, this.opts));
      this._wireSocket(s);
      return s;
    }

    disconnect() {
      if (!this.socket) return;
      try { this.socket.disconnect(); } catch {}
      this.socket = null;
      this.connected = false;
    }

    _wireSocket(s) {
      s.on("connect", () => {
        this.connected = true;
        this._emitLocal("connect");
      });

      s.on("disconnect", () => {
        this.connected = false;
        this._emitLocal("disconnect");
      });

      s.on("connect_error", (e) => {
        this._emitLocal("connect_error", e);
      });

      // 관리자 인증
      s.on("authSuccess", (payload) => {
        this.state.role = "admin";
        this._emitLocal("adminAuthSuccess", payload);
      });
      s.on("authError", (err) => {
        // 관리자 에러/관전자 에러 채널이 동일 이름(authError)이므로 분기
        if (this.state.role === "spectator") {
          this._emitLocal("spectatorAuthError", err);
        } else {
          this._emitLocal("adminAuthError", err);
        }
      });

      // 플레이어 인증
      s.on("auth:success", (payload) => {
        this.state.role = "player";
        this.state.playerId = payload?.player?.id || null;
        this.state.name = payload?.player?.name || null;
        this._emitLocal("playerAuthSuccess", payload);
      });
      s.on("auth:fail", (payload) => {
        this._emitLocal("playerAuthFail", payload);
      });

      // 관전자 인증
      s.on("spectator:join_ok", () => {
        this.state.role = "spectator";
        this._emitLocal("spectatorJoinOK");
      });

      // 전투/로그/채팅
      s.on("battleUpdate", (b) => this._emitLocal("battleUpdate", b));
      s.on("battle:chat", (p) => this._emitLocal("battleChat", p));
      s.on("battle:log", (p) => this._emitLocal("battleLog", p));
      s.on("turn:tick", (p) => this._emitLocal("turnTick", p));
    }

    // ────────────────────────────────────────────────────────
    // 이벤트 리스너 관리
    // ────────────────────────────────────────────────────────
    on(name, fn) {
      const set = this.handlers[name];
      if (set) set.add(fn || noop);
      return () => this.off(name, fn);
    }

    off(name, fn) {
      const set = this.handlers[name];
      if (!set) return;
      if (fn) set.delete(fn);
      else set.clear();
    }

    _emitLocal(name, payload) {
      const set = this.handlers[name];
      if (!set || set.size === 0) return;
      set.forEach((fn) => {
        try { fn(payload); } catch {}
      });
    }

    // ────────────────────────────────────────────────────────
    // 인증
    // ────────────────────────────────────────────────────────
    /**
     * 관리자 인증
     * @param {{ battleId:string, token?:string, otp?:string }} p
     */
    authAsAdmin(p) {
      const battleId = String(p?.battleId || "").trim();
      // 서버는 token 필드를 받음. 기존 파일에서 otp로 넘기던 버그를 교정.
      const token = String((p?.token ?? p?.otp) || "").trim();
      if (!this.socket) this.connect();
      this.state.battleId = battleId;
      this.state.role = "admin";
      this.socket.emit("adminAuth", { battleId, token });
    }

    /**
     * 플레이어 인증
     * @param {{ battleId:string, otp:string, name:string }} p
     */
    authAsPlayer(p) {
      const battleId = String(p?.battleId || "").trim();
      const otp = String(p?.otp || "").trim();
      const name = String(p?.name || "").trim();
      if (!this.socket) this.connect();
      this.state.battleId = battleId;
      this.state.role = "player";
      this.state.name = name;
      this.socket.emit("player:auth", { battleId, otp, name });
    }

    /**
     * 관전자 인증
     * @param {{ battleId:string, otp:string, name:string }} p
     */
    authAsSpectator(p) {
      const battleId = String(p?.battleId || "").trim();
      const otp = String(p?.otp || "").trim();
      const name = String(p?.name || "").trim();
      if (!this.socket) this.connect();
      this.state.battleId = battleId;
      this.state.role = "spectator";
      this.state.name = name;
      this.socket.emit("spectator:join", { battleId, otp, name });
    }

    // ────────────────────────────────────────────────────────
    // 전투 제어
    // ────────────────────────────────────────────────────────
    startBattle() { this._emitCtl("battle:start"); }
    pauseBattle() { this._emitCtl("battle:pause"); }
    resumeBattle() { this._emitCtl("battle:resume"); }
    endBattle()   { this._emitCtl("battle:end"); }

    _emitCtl(evt) {
      if (!this.socket || !this.state.battleId) return;
      this.socket.emit(evt, { battleId: this.state.battleId });
    }

    // ────────────────────────────────────────────────────────
    // 플레이어 상호작용
    // ────────────────────────────────────────────────────────
    /**
     * 준비 완료
     */
    ready() {
      if (!this.socket || !this.state.battleId || !this.state.playerId) return;
      this.socket.emit("player:ready", { battleId: this.state.battleId, playerId: this.state.playerId });
    }

    /**
     * 액션 전송
     * @param {{ type:string, target?:string, itemType?:string }} action
     */
    action(action) {
      if (!this.socket || !this.state.battleId || !this.state.playerId) return;
      this.socket.emit("player:action", {
        battleId: this.state.battleId,
        playerId: this.state.playerId,
        action,
      });
    }

    // ────────────────────────────────────────────────────────
    // 채팅/응원
    // ────────────────────────────────────────────────────────
    /**
     * 채팅 전송(정규)
     * @param {string} msg
     * @param {string=} name 표시 이름(생략 시 현재 세션 이름)
     */
    sendChat(msg, name) {
      if (!this.socket || !this.state.battleId) return;
      const who = String(name || this.state.name || (this.state.role === "admin" ? "관리자" : "전투 참여자"));
      const payload = { battleId: this.state.battleId, name: who, msg: String(msg || "") };
      if (!payload.msg) return;
      this.socket.emit("chat:send", payload);
      // 레거시 브리지(서버가 여전히 받는 환경을 위해 동시 전송)
      const role = this.state.role === "admin" ? "admin" : "player";
      this.socket.emit("chatMessage", { role, message: payload.msg, battleId: this.state.battleId });
    }

    /**
     * 응원 전송(관전자)
     * @param {string} msg
     */
    cheer(msg) {
      if (!this.socket || !this.state.battleId) return;
      const who = String(this.state.name || "관전자");
      const payload = { battleId: this.state.battleId, name: who, msg: String(msg || "") };
      if (!payload.msg) return;
      this.socket.emit("spectator:cheer", payload);
    }
  }

  return PyxisSocket;
});
