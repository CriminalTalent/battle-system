// packages/battle-server/public/assets/js/socket-manager.js
// PYXIS Battle System - Socket.IO 서버 매니저 (무승부 금지 + 동시 전멸 즉시 종료 버전)
// - 관리자 인증 없이도 관리 액션 허용(배틀 ID만 있으면 동작)
// - 플레이어/관전자/관리자 이벤트명 호환
// - 이모지 사용 금지

const socketIo = require("socket.io");
const crypto = require("crypto");

// 간단한 랜덤 토큰
function genToken(len = 24) {
  return crypto.randomBytes(len).toString("base64url");
}

// 접속 오리진으로 절대 URL 구성
function buildBaseURL(socket) {
  const h = socket?.handshake?.headers || {};
  const xfHost = h["x-forwarded-host"];
  const xfProto = h["x-forwarded-proto"] || "https";
  const origin = h.origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "");
  if (xfHost) return `${xfProto}://${String(xfHost).replace(/\/+$/, "")}`;
  if (h.host) return `https://${String(h.host).replace(/\/+$/, "")}`;
  return "";
}

// 링크 경로 후보
const PATHS = {
  player: ["/play", "/player"],
  spectator: ["/watch", "/spectator"]
};

class PyxisSocketManager {
  constructor(server, battleManager) {
    this.battleManager = battleManager;
    this.io = socketIo(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket", "polling"]
    });

    // 연결 상태
    this.connections = new Map(); // socket.id -> { type, battleId, playerId, ... }
    this.playerSockets = new Map(); // playerId -> socket
    this.adminSockets = new Map(); // battleId -> Set<socket>
    this.spectatorSockets = new Map(); // battleId -> Set<socket>

    this.setup();
    console.log("PYXIS Socket Manager 초기화 완료");
  }

  // -----------------------------
  // 공통 유틸
  // -----------------------------
  getBattle(battleId) {
    if (!battleId) return null;
    try { return this.battleManager.getBattle(battleId); } catch (_) { return null; }
  }

  ensureAdminSet(battleId) {
    if (!this.adminSockets.has(battleId)) this.adminSockets.set(battleId, new Set());
    return this.adminSockets.get(battleId);
  }

  ensureSpectatorSet(battleId) {
    if (!this.spectatorSockets.has(battleId)) this.spectatorSockets.set(battleId, new Set());
    return this.spectatorSockets.get(battleId);
  }

  joinCommonRooms(socket, battleId) {
    socket.join(`battle:${battleId}`);
  }

  attachAdminSocket(socket, battleId) {
    const set = this.ensureAdminSet(battleId);
    set.add(socket);
    const c = this.connections.get(socket.id) || { connectedAt: new Date() };
    c.type = "admin";
    c.battleId = battleId;
    this.connections.set(socket.id, c);
    socket.join(`admin:${battleId}`);
    this.joinCommonRooms(socket, battleId);
  }

  // 팀 수집
  collectTeams(b) {
    return Array.from(new Set((b.players || []).map(p => p.team))).filter(Boolean);
  }

  // 팀별 생존자 수
  countAliveByTeam(b) {
    const out = {};
    (b.players || []).forEach(p => {
      const alive = p.isAlive !== undefined ? !!p.isAlive : (p.hp > 0);
      if (!out[p.team]) out[p.team] = 0;
      if (alive) out[p.team] += 1;
    });
    return out;
  }

  // 팀별 HP 합
  sumHpByTeam(b) {
    const out = {};
    (b.players || []).forEach(p => {
      if (!out[p.team]) out[p.team] = 0;
      out[p.team] += Math.max(0, Number(p.hp || 0));
    });
    return out;
  }

  // 무승부 금지 승자 결정기
  decideWinnerNoDraw(b, lastActorTeam) {
    const teams = this.collectTeams(b);
    const alive = this.countAliveByTeam(b);
    const hpSum = this.sumHpByTeam(b);

    // 1) 생존자 비교
    const alivePairs = teams.map(t => [t, alive[t] || 0]).sort((a,b2) => b2[1]-a[1]);
    if (alivePairs[0][1] !== alivePairs[1]?.[1]) {
      return alivePairs[0][0];
    }

    // 2) HP 합 비교
    const hpPairs = teams.map(t => [t, hpSum[t] || 0]).sort((a,b2) => b2[1]-a[1]);
    if (hpPairs[0][1] !== hpPairs[1]?.[1]) {
      return hpPairs[0][0];
    }

    // 3) 최근 공격자 우선
    if (lastActorTeam) return lastActorTeam;

    // 4) 현재 턴 팀 우선
    if (b.currentTeam) return b.currentTeam;

    // 5) 선공 팀 우선(전투 시작 시 세팅되어 있어야 함)
    if (b.firstTeam) return b.firstTeam;

    // 6) 민첩 합(초기) 비교가 저장되어 있다면 사용
    if (b.initAgility && b.initAgility.a != null && b.initAgility.b != null) {
      return b.initAgility.a >= b.initAgility.b ? teams[0] : teams[1];
    }

    // 7) 마지막 수단: 알파벳 순
    return teams.sort()[0];
  }

  // 동시 전멸 즉시 종료 체크
  applyNoDrawCheck(battleId, lastActorTeam) {
    const b = this.getBattle(battleId);
    if (!b || b.status === "ended") return false;

    const alive = this.countAliveByTeam(b);
    const teams = this.collectTeams(b);
    const allZero = teams.every(t => (alive[t] || 0) === 0);

    if (allZero) {
      // 동시 전멸: 마지막 액터 팀 승리로 확정
      const winner = this.decideWinnerNoDraw(b, lastActorTeam);
      this.handleBattleEnd(battleId, winner);
      return true;
    }
    return false;
  }

  // -----------------------------
  // 이벤트 바인딩
  // -----------------------------
  setup() {
    this.io.on("connection", (socket) => {
      this.connections.set(socket.id, {
        type: "unknown",
        battleId: null,
        playerId: null,
        connectedAt: new Date()
      });

      // ---- 공통 ----
      socket.on("join", ({ battleId }) => this.onJoin(socket, battleId));

      // ---- 관리자: 인증(호환) ----
      socket.on("admin:auth", (d) => this.onAdminAuth(socket, d));
      socket.on("adminAuth", (d) => this.onAdminAuth(socket, d)); // 호환

      // ---- 관리자: 전투 생성/제어(호환) ----
      socket.on("admin:create_battle", (d) => this.onCreateBattle(socket, d));
      socket.on("createBattle", (d) => this.onCreateBattle(socket, d)); // 호환

      socket.on("admin:add_player", (d) => this.onAddPlayer(socket, d));
      socket.on("addPlayer", (d) => this.onAddPlayer(socket, d)); // 호환

      socket.on("admin:start_battle", (d) => this.onStartBattle(socket, d));
      socket.on("startBattle", (d) => this.onStartBattle(socket, d)); // 호환

      socket.on("admin:end_battle", (d) => this.onEndBattle(socket, d));
      socket.on("endBattle", (d) => this.onEndBattle(socket, d)); // 호환

      socket.on("pauseBattle", (d) => this.onPauseBattle(socket, d));
      socket.on("resumeBattle", (d) => this.onResumeBattle(socket, d));

      // 비밀번호/링크 발급
      socket.on("generatePlayerPassword", (d) => this.onGeneratePlayerPassword(socket, d));
      socket.on("generateSpectatorOtp", (d) => this.onGenerateSpectatorOtp(socket, d));

      // 관리자 채팅(호환)
      socket.on("admin:chat", (d) => this.onAdminChat(socket, d));
      // 공통 채팅(역할에 따라 분기)
      socket.on("chat:send", (d) => this.onGenericChat(socket, d));

      // ---- 전투 참가자: 인증(호환) ----
      socket.on("player:auth", (d) => this.onPlayerAuth(socket, d));
      socket.on("playerAuth", (d) => this.onPlayerAuth(socket, d)); // 호환

      // 상태/액션
      socket.on("player:ready", (d) => this.onPlayerReady(socket, d));
      socket.on("player:action", (d) => this.onPlayerAction(socket, d));
      socket.on("player:chat", (d) => this.onPlayerChat(socket, d)); // 호환

      // ---- 관전자: 인증/응원/채팅(호환) ----
      socket.on("spectator:auth", (d) => this.onSpectatorAuth(socket, d));
      socket.on("spectatorAuth", (d) => this.onSpectatorAuth(socket, d)); // 호환
      socket.on("spectator:cheer", (d) => this.onSpectatorCheer(socket, d));
      socket.on("spectator:chat", (d) => this.onSpectatorChat(socket, d));

      // ---- 연결 관리 ----
      socket.on("disconnect", () => this.onDisconnect(socket));
      socket.on("error", (e) => console.error(`소켓 에러 [${socket.id}]`, e));
    });
  }

  // -----------------------------
  // 핸들러: 공통
  // -----------------------------
  onJoin(socket, battleId) {
    const b = this.getBattle(battleId);
    if (!b) return;
    this.joinCommonRooms(socket, battleId);
    const c = this.connections.get(socket.id) || {};
    c.battleId = battleId;
    this.connections.set(socket.id, c);
  }

  // -----------------------------
  // 핸들러: 관리자
  // -----------------------------
  onAdminAuth(socket, data = {}) {
    const { battleId } = data || {};
    const b = this.getBattle(battleId);
    if (!b) {
      socket.emit("auth:error", { message: "존재하지 않는 전투입니다" });
      return;
    }
    this.attachAdminSocket(socket, battleId);
    socket.emit("auth:success", { type: "admin", battle: this.sanitizeBattleForAdmin(b) });
    this.sendAdminUpdate(battleId);
  }

  onCreateBattle(socket, data = {}) {
    try {
      const mode = String(data?.mode || "1v1");
      const battleId = this.battleManager.createBattle(mode);
      const b = this.getBattle(battleId);

      // 선공 팀 보조 저장(배틀 매니저가 세팅해줄 수도 있음)
      if (!b.firstTeam) b.firstTeam = null;

      this.attachAdminSocket(socket, battleId);

      socket.emit("battle:created", { battleId, mode });
      socket.emit("battleCreated", { battleId, mode });

      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("전투 생성 에러:", e);
      socket.emit("battle:error", { message: "전투 생성 중 오류가 발생했습니다" });
    }
  }

  onAddPlayer(socket, payload = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = payload?.battleId || c.battleId;
      if (!battleId) return socket.emit("player:error", { message: "전투 ID가 없습니다." });
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("player:error", { message: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      const pd = payload?.playerData || payload;
      if (!pd || !pd.name || !pd.team || !pd.stats) {
        return socket.emit("player:error", { message: "필수 정보가 누락되었습니다." });
      }

      ["attack", "defense", "agility", "luck"].forEach((k) => {
        if (typeof pd.stats[k] !== "number") pd.stats[k] = 3;
        if (pd.stats[k] < 1) pd.stats[k] = 1;
        if (pd.stats[k] > 5) pd.stats[k] = 5;
      });
      if (typeof pd.hp !== "number") pd.hp = 100;
      if (pd.hp > 100) pd.hp = 100;
      if (typeof pd.maxHp !== "number") pd.maxHp = 100;

      pd.items = pd.items || { dittany: 1, attack_booster: 1, defense_booster: 1 };

      const player = this.battleManager.addPlayer(battleId, pd);

      socket.emit("player:added", { success: true, player: this.sanitizePlayerData(player) });
      this.broadcastToRoom(`battle:${battleId}`, "battle:log", {
        type: "system",
        message: `전투 참가자 추가: ${player.name} (${player.team})`
      });
      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("플레이어 추가 에러:", e);
      socket.emit("player:error", { message: e?.message || "플레이어 추가 중 오류가 발생했습니다" });
    }
  }

  onStartBattle(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = data?.battleId || c.battleId;
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("battle:error", { message: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      const result = this.battleManager.startBattle(battleId);
      const firstTeam = result?.firstTeam || result?.battle?.currentTeam || b.currentTeam;
      if (!b.firstTeam && firstTeam) b.firstTeam = firstTeam;

      this.broadcastToRoom(`battle:${battleId}`, "battle:started", {
        battle: this.sanitizeBattleForPlayer(result.battle || b),
        firstTeam,
        message: `전투가 시작되었습니다! ${firstTeam} 팀이 선공입니다.`
      });

      this.startNextTurn(battleId);
      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("전투 시작 에러:", e);
      socket.emit("battle:error", { message: e?.message || "전투 시작 중 오류가 발생했습니다" });
    }
  }

  onEndBattle(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = data?.battleId || c.battleId;
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("battle:error", { message: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      // 명시적 종료에서도 무승부 금지: 승자 강제 산정
      const winner = this.decideWinnerNoDraw(b, b.lastActorTeam || b.currentTeam || b.firstTeam);
      this.handleBattleEnd(battleId, winner);
    } catch (e) {
      console.error("전투 종료 에러:", e);
      socket.emit("battle:error", { message: "전투 종료 중 오류가 발생했습니다" });
    }
  }

  onPauseBattle(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = data?.battleId || c.battleId;
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("battle:error", { message: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      if (typeof this.battleManager.pauseBattle === "function") {
        this.battleManager.pauseBattle(battleId);
      } else {
        b.status = "paused";
      }
      this.broadcastToRoom(`battle:${battleId}`, "battle:update", this.sanitizeBattleForPlayer(b));
      this.broadcastToRoom(`battle:${battleId}`, "battle:log", { type: "system", message: "전투 일시정지" });
      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("일시정지 에러:", e);
    }
  }

  onResumeBattle(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = data?.battleId || c.battleId;
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("battle:error", { message: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      if (typeof this.battleManager.resumeBattle === "function") {
        this.battleManager.resumeBattle(battleId);
      } else {
        b.status = "active";
      }
      this.broadcastToRoom(`battle:${battleId}`, "battle:update", this.sanitizeBattleForPlayer(b));
      this.broadcastToRoom(`battle:${battleId}`, "battle:log", { type: "system", message: "전투 재개" });
      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("재개 에러:", e);
    }
  }

  // 비밀번호/링크 발급
  onGeneratePlayerPassword(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = data?.battleId || c.battleId;
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("playerPasswordGenerated", { success: false, error: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      const base = buildBaseURL(socket);
      const links = [];
      for (const p of b.players || []) {
        if (!p.token) p.token = genToken(18);
        const path = PATHS.player[0];
        const url = `${base}${path}?battle=${encodeURIComponent(battleId)}&name=${encodeURIComponent(p.name)}&token=${encodeURIComponent(p.token)}`;
        links.push({ name: p.name, team: p.team, url });
      }

      socket.emit("playerPasswordGenerated", { success: true, playerLinks: links });
    } catch (e) {
      console.error("전투 참가자 링크 발급 에러:", e);
      socket.emit("playerPasswordGenerated", { success: false, error: "링크 발급 중 오류가 발생했습니다." });
    }
  }

  onGenerateSpectatorOtp(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id) || {};
      const battleId = data?.battleId || c.battleId;
      const b = this.getBattle(battleId);
      if (!b) return socket.emit("spectatorOtpGenerated", { success: false, error: "존재하지 않는 전투입니다." });

      this.attachAdminSocket(socket, battleId);

      b.spectatorToken = genToken(16);
      b.spectatorTokenExpiresAt = Date.now() + 30 * 60 * 1000;

      const base = buildBaseURL(socket);
      const path = PATHS.spectator[0];
      const url = `${base}${path}?battle=${encodeURIComponent(battleId)}&token=${encodeURIComponent(b.spectatorToken)}`;

      socket.emit("spectatorOtpGenerated", { success: true, spectatorUrl: url });
    } catch (e) {
      console.error("관전자 링크 발급 에러:", e);
      socket.emit("spectatorOtpGenerated", { success: false, error: "관전자 링크 발급 중 오류가 발생했습니다." });
    }
  }

  onAdminChat(socket, data = {}) {
    const c = this.connections.get(socket.id) || {};
    const battleId = data?.battleId || c.battleId;
    if (!battleId) return;

    const message = String(data?.message || "").trim().slice(0, 200);
    if (!message) return;

    const chatData = {
      type: "admin",
      senderId: "admin",
      senderName: "관리자",
      message,
      timestamp: new Date().toISOString()
    };

    this.broadcastToRoom(`battle:${battleId}`, "chat:message", chatData);
    this.broadcastToRoom(`battle:${battleId}`, "battle:log", { type: "chat", message: `관리자: ${message}` });
  }

  // -----------------------------
  // 핸들러: 전투 참가자
  // -----------------------------
  onPlayerAuth(socket, data = {}) {
    try {
      const { battleId, name, playerName, token } = data;
      const bId = battleId || data?.battleID || data?.id;
      const pName = name || playerName;

      if (!bId || !pName || !token) {
        socket.emit("auth:error", { message: "모든 필드를 입력해주세요" });
        return;
      }
      const b = this.getBattle(bId);
      if (!b) return socket.emit("auth:error", { message: "존재하지 않는 전투입니다" });

      const player = (b.players || []).find((p) => p.name === pName && p.token === token);
      if (!player) return socket.emit("auth:error", { message: "잘못된 인증 정보입니다" });

      if (this.playerSockets.has(player.id)) {
        try { this.playerSockets.get(player.id).disconnect(true); } catch (_) {}
      }

      this.playerSockets.set(player.id, socket);
      const c = this.connections.get(socket.id) || {};
      c.type = "player";
      c.battleId = bId;
      c.playerId = player.id;
      c.playerName = player.name;
      this.connections.set(socket.id, c);

      player.isConnected = true;
      player.lastConnectedAt = new Date();

      socket.join(`player:${player.id}`);
      socket.join(`team:${bId}:${player.team}`);
      this.joinCommonRooms(socket, bId);

      socket.emit("auth:success", {
        role: "player",
        battleId: bId,
        playerId: player.id,
        player: this.sanitizePlayerData(player),
        battle: this.sanitizeBattleForPlayer(b, player)
      });

      this.broadcastToRoom(`battle:${bId}`, "player:connected", {
        playerId: player.id,
        playerName: player.name,
        team: player.team
      });

      this.sendAdminUpdate(bId);
    } catch (e) {
      console.error("플레이어 인증 에러:", e);
      socket.emit("auth:error", { message: "인증 중 오류가 발생했습니다" });
    }
  }

  onPlayerReady(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id);
      if (!c || c.type !== "player") return;

      const b = this.getBattle(c.battleId);
      if (!b) return;

      const player = (b.players || []).find((p) => p.id === c.playerId);
      if (!player) return;

      const ready = !!data.ready;
      player.isReady = ready;

      this.broadcastToRoom(`battle:${c.battleId}`, "player:ready_update", {
        playerId: player.id,
        playerName: player.name,
        isReady: ready
      });

      const allReady = (b.players || []).length > 0 && (b.players || []).every((p) => p.isReady);
      if (allReady && b.status === "waiting") {
        this.broadcastToRoom(`battle:${c.battleId}`, "battle:all_ready", { message: "모든 전투 참가자가 준비 완료되었습니다." });
      }

      this.sendAdminUpdate(c.battleId);
    } catch (e) {
      console.error("플레이어 준비 에러:", e);
    }
  }

  onPlayerAction(socket, data = {}) {
    try {
      const c = this.connections.get(socket.id);
      if (!c || c.type !== "player") return;

      const b = this.getBattle(c.battleId);
      if (!b || b.status !== "active") {
        return socket.emit("action:error", { message: "전투가 진행 중이 아닙니다" });
      }

      const me = (b.players || []).find((p) => p.id === c.playerId);
      if (!me || !me.isAlive) return;

      if (b.currentPlayerId && b.currentPlayerId !== me.id) {
        return socket.emit("action:error", { message: "현재 당신의 턴이 아닙니다" });
      }
      if (b.currentTeam && me.team !== b.currentTeam) {
        return socket.emit("action:error", { message: "현재 당신의 팀 턴이 아닙니다" });
      }

      // 마지막 액터 팀 기록(동시 전멸 시 승자 결정용)
      b.lastActorTeam = me.team;

      const result = this.battleManager.executeAction(c.battleId, me.id, data);

      if (!result?.success) {
        return socket.emit("action:error", { message: result?.error || "액션을 실행할 수 없습니다" });
      }

      (result.logs || []).forEach((log) => {
        this.broadcastToRoom(`battle:${c.battleId}`, "battle:log", log);
      });

      if (result.updates) {
        Object.keys(result.updates).forEach((pid) => {
          this.broadcastToRoom(`battle:${c.battleId}`, "player:update", {
            playerId: pid,
            updates: result.updates[pid]
          });
        });
      }

      // 1) 배틀 매니저가 종료 판단을 줬으면, 승자 미지정 시 강제 산정
      if (result.battleEnded) {
        const winner = result.winner || this.decideWinnerNoDraw(b, b.lastActorTeam || b.currentTeam || b.firstTeam);
        this.handleBattleEnd(c.battleId, winner);
        return;
      }

      // 2) 동시 전멸 즉시 종료(무승부 금지)
      if (this.applyNoDrawCheck(c.battleId, b.lastActorTeam)) return;

      // 3) 일반 턴 종료
      if (result.turnEnded) {
        this.handleTurnEnd(c.battleId);
      }
    } catch (e) {
      console.error("플레이어 액션 에러:", e);
      socket.emit("action:error", { message: "액션 처리 중 오류가 발생했습니다" });
    }
  }

  onPlayerChat(socket, data = {}) {
    const c = this.connections.get(socket.id);
    if (!c || c.type !== "player") return;

    const msg = String(data?.message || "").trim().slice(0, 200);
    if (!msg) return;

    const b = this.getBattle(c.battleId);
    if (!b) return;

    const p = (b.players || []).find((x) => x.id === c.playerId);
    if (!p) return;

    const chat = {
      type: "player",
      senderId: p.id,
      senderName: p.name,
      senderTeam: p.team,
      message: msg,
      timestamp: new Date().toISOString()
    };

    this.broadcastToRoom(`battle:${c.battleId}`, "chat:message", chat);
    this.broadcastToRoom(`battle:${c.battleId}`, "battle:log", { type: "chat", message: `${p.name}: ${msg}` });
  }

  // 공통 채팅 엔드포인트
  onGenericChat(socket, data = {}) {
    const c = this.connections.get(socket.id);
    if (!c || !c.battleId) return;
    const msg = String(data?.message || "").trim().slice(0, 200);
    if (!msg) return;

    let name = "익명";
    let kind = c.type;
    if (c.type === "admin") name = "관리자";
    if (c.type === "player") name = c.playerName || "전투 참가자";
    if (c.type === "spectator") name = c.spectatorName || "관전자";

    const chat = {
      type: kind,
      senderId: c.playerId || socket.id,
      senderName: name,
      message: msg,
      timestamp: new Date().toISOString()
    };

    if (c.type === "spectator") {
      this.broadcastToRoom(`spectator:${c.battleId}`, "chat:message", chat);
    } else {
      this.broadcastToRoom(`battle:${c.battleId}`, "chat:message", chat);
      this.broadcastToRoom(`battle:${c.battleId}`, "battle:log", { type: "chat", message: `${name}: ${msg}` });
    }
  }

  // -----------------------------
  // 핸들러: 관전자
  // -----------------------------
  onSpectatorAuth(socket, data = {}) {
    try {
      const { battleId, name, spectatorName, token } = data;
      const bId = battleId;
      const sName = spectatorName || name || "관전자";
      if (!bId) return socket.emit("auth:error", { message: "전투 ID와 닉네임이 필요합니다" });

      const b = this.getBattle(bId);
      if (!b) return socket.emit("auth:error", { message: "존재하지 않는 전투입니다" });

      if (token && b.spectatorToken && b.spectatorToken !== token) {
        return socket.emit("auth:error", { message: "잘못된 관전자 비밀번호입니다" });
      }
      if (b.spectatorTokenExpiresAt && Date.now() > b.spectatorTokenExpiresAt) {
        return socket.emit("auth:error", { message: "관전자 비밀번호가 만료되었습니다" });
        }

      this.ensureSpectatorSet(bId).add(socket);

      const c = this.connections.get(socket.id) || {};
      c.type = "spectator";
      c.battleId = bId;
      c.spectatorName = sName;
      this.connections.set(socket.id, c);

      socket.join(`spectator:${bId}`);
      this.joinCommonRooms(socket, bId);

      socket.emit("auth:success", { type: "spectator", spectatorName: sName, battle: this.sanitizeBattleForSpectator(b) });
      this.updateSpectatorCount(bId);
    } catch (e) {
      console.error("관전자 인증 에러:", e);
      socket.emit("auth:error", { message: "인증 중 오류가 발생했습니다" });
    }
  }

  onSpectatorCheer(socket, data = {}) {
    const c = this.connections.get(socket.id);
    if (!c || c.type !== "spectator") return;

    const msg = String(data?.message || "").trim().slice(0, 100);
    if (!msg) return;

    const cheer = {
      type: "cheer",
      senderId: socket.id,
      senderName: c.spectatorName || "관전자",
      message: msg,
      timestamp: new Date().toISOString()
    };

    this.broadcastToRoom(`battle:${c.battleId}`, "spectator:cheer", cheer);
    this.broadcastToRoom(`battle:${c.battleId}`, "battle:log", { type: "system", message: `${c.spectatorName}: ${msg}` });
  }

  onSpectatorChat(socket, data = {}) {
    const c = this.connections.get(socket.id);
    if (!c || c.type !== "spectator") return;

    const msg = String(data?.message || "").trim().slice(0, 200);
    if (!msg) return;

    const chat = {
      type: "spectator",
      senderId: socket.id,
      senderName: c.spectatorName || "관전자",
      message: msg,
      timestamp: new Date().toISOString()
    };

    this.broadcastToRoom(`spectator:${c.battleId}`, "chat:message", chat);
  }

  // -----------------------------
  // 턴/전투 진행
  // -----------------------------
  handleTurnEnd(battleId) {
    try {
      const b = this.getBattle(battleId);
      if (!b || b.status !== "active") return;

      this.broadcastToRoom(`battle:${battleId}`, "turn:end", { playerId: b.currentPlayerId });

      setTimeout(() => this.startNextTurn(battleId), 1000);
    } catch (e) {
      console.error("턴 종료 처리 에러:", e);
    }
  }

  startNextTurn(battleId) {
    try {
      const b = this.getBattle(battleId);
      if (!b || b.status !== "active") return;

      // 동시 전멸 검사를 턴 시작 전에도 한 번 더
      if (this.applyNoDrawCheck(battleId, b.lastActorTeam || b.currentTeam || b.firstTeam)) return;

      const next = this.battleManager.getNextPlayer(battleId);
      if (!next) return;

      b.currentPlayerId = next.id;
      b.currentTeam = next.team; // 팀 턴 처리 호환
      b.turnStartTime = Date.now();
      b.turnNumber = (b.turnNumber || 0) + 1;

      const timeLimitMs = 5 * 60 * 1000;

      this.broadcastToRoom(`battle:${battleId}`, "turn:start", {
        playerId: next.id,
        playerName: next.name,
        playerTeam: next.team,
        turnNumber: b.turnNumber,
        timeLimit: timeLimitMs,
        timeLeft: timeLimitMs
      });

      if (b.turnTimer) clearTimeout(b.turnTimer);
      b.turnTimer = setTimeout(() => this.handleTurnTimeout(battleId, next.id), timeLimitMs);

      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("다음 턴 시작 에러:", e);
    }
  }

  handleTurnTimeout(battleId, playerId) {
    try {
      const b = this.getBattle(battleId);
      if (!b || b.currentPlayerId !== playerId || b.status !== "active") return;

      this.broadcastToRoom(`battle:${battleId}`, "battle:log", { type: "system", message: "시간 초과로 자동 패스되었습니다." });

      // 시간 초과로도 동시 전멸 확인
      if (this.applyNoDrawCheck(battleId, b.currentTeam || b.lastActorTeam || b.firstTeam)) return;

      this.handleTurnEnd(battleId);
    } catch (e) {
      console.error("턴 타임아웃 처리 에러:", e);
    }
  }

  handleBattleEnd(battleId, winner) {
    try {
      const b = this.getBattle(battleId);
      if (!b) return;

      // 무승부 금지: 승자 비어 있으면 강제 산정
      const finalWinner = winner || this.decideWinnerNoDraw(b, b.lastActorTeam || b.currentTeam || b.firstTeam);

      b.status = "ended";
      b.endedAt = new Date();
      b.winner = finalWinner;

      if (b.turnTimer) {
        clearTimeout(b.turnTimer);
        b.turnTimer = null;
      }

      this.broadcastToRoom(`battle:${battleId}`, "battle:ended", {
        winner: finalWinner,
        battle: this.sanitizeBattleForPlayer(b),
        message: `${finalWinner} 팀의 승리입니다!`
      });

      this.sendAdminUpdate(battleId);
    } catch (e) {
      console.error("전투 종료 처리 에러:", e);
    }
  }

  // -----------------------------
  // 연결 해제
  // -----------------------------
  onDisconnect(socket) {
    const c = this.connections.get(socket.id);
    if (!c) return;

    try {
      if (c.type === "player" && c.playerId && c.battleId) {
        const b = this.getBattle(c.battleId);
        if (b) {
          const p = (b.players || []).find((x) => x.id === c.playerId);
          if (p) {
            p.isConnected = false;
            p.lastDisconnectedAt = new Date();

            this.playerSockets.delete(c.playerId);
            this.broadcastToRoom(`battle:${c.battleId}`, "player:disconnected", {
              playerId: p.id,
              playerName: p.name
            });
            this.sendAdminUpdate(c.battleId);
          }
        }
      }

      if (c.type === "admin" && c.battleId) {
        const set = this.adminSockets.get(c.battleId);
        if (set) {
          set.delete(socket);
          if (set.size === 0) this.adminSockets.delete(c.battleId);
        }
      }

      if (c.type === "spectator" && c.battleId) {
        const set = this.spectatorSockets.get(c.battleId);
        if (set) {
          set.delete(socket);
          if (set.size === 0) this.spectatorSockets.delete(c.battleId);
        }
        this.updateSpectatorCount(c.battleId);
      }
    } catch (e) {
      console.error("연결 해제 처리 에러:", e);
    } finally {
      this.connections.delete(socket.id);
    }
  }

  // -----------------------------
  // 브로드캐스트/상태
  // -----------------------------
  broadcastToRoom(room, event, data) {
    try {
      this.io.to(room).emit(event, data);
    } catch (e) {
      console.error("브로드캐스트 에러:", e);
    }
  }

  sendAdminUpdate(battleId) {
    try {
      const b = this.getBattle(battleId);
      if (!b) return;
      const set = this.adminSockets.get(battleId);
      if (!set || set.size === 0) return;

      const update = {
        battle: this.sanitizeBattleForAdmin(b),
        statistics: this.getStatistics(battleId)
      };
      set.forEach((s) => s.emit("admin:update", update));
    } catch (e) {
      console.error("관리자 업데이트 전송 에러:", e);
    }
  }

  updateSpectatorCount(battleId) {
    try {
      const set = this.spectatorSockets.get(battleId);
      const count = set ? set.size : 0;
      this.broadcastToRoom(`battle:${battleId}`, "spectator:count_update", { count });
    } catch (e) {
      console.error("관전자 수 업데이트 에러:", e);
    }
  }

  // -----------------------------
  // 데이터 정리
  // -----------------------------
  sanitizeBattleForAdmin(b) {
    return {
      id: b.id,
      mode: b.mode,
      status: b.status,
      players: (b.players || []).map((p) => this.sanitizePlayerData(p)),
      currentPlayerId: b.currentPlayerId,
      currentTeam: b.currentTeam,
      firstTeam: b.firstTeam || null,
      turnNumber: b.turnNumber || 0,
      turnStartTime: b.turnStartTime,
      createdAt: b.createdAt,
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      winner: b.winner,
      logs: b.logs || []
    };
  }

  sanitizeBattleForPlayer(b) {
    return {
      id: b.id,
      mode: b.mode,
      status: b.status,
      players: (b.players || []).map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        hp: p.hp,
        maxHp: p.maxHp,
        isAlive: p.isAlive,
        isConnected: p.isConnected,
        isReady: p.isReady,
        avatar: p.avatar,
        stats: p.stats
      })),
      currentPlayerId: b.currentPlayerId,
      currentTeam: b.currentTeam,
      firstTeam: b.firstTeam || null,
      turnNumber: b.turnNumber || 0,
      winner: b.winner
    };
  }

  sanitizeBattleForSpectator(b) {
    return this.sanitizeBattleForPlayer(b);
  }

  sanitizePlayerData(p) {
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      stats: p.stats,
      items: p.items,
      avatar: p.avatar,
      isAlive: p.isAlive,
      isConnected: p.isConnected,
      isReady: p.isReady,
      token: p.token,
      effects: p.effects || []
    };
  }

  getStatistics(battleId) {
    try {
      const b = this.getBattle(battleId);
      if (!b) return {};
      const spectators = this.spectatorSockets.get(battleId)?.size || 0;
      const admins = this.adminSockets.get(battleId)?.size || 0;
      return {
        connectedPlayers: (b.players || []).filter((p) => p.isConnected).length,
        totalPlayers: (b.players || []).length,
        spectators,
        admins,
        turnNumber: b.turnNumber || 0,
        uptime: b.startedAt ? Date.now() - new Date(b.startedAt).getTime() : 0
      };
    } catch (e) {
      console.error("통계 수집 에러:", e);
      return {};
    }
  }

  // -----------------------------
  // 서버 상태
  // -----------------------------
  getServerStatus() {
    return {
      totalConnections: this.connections.size,
      playerConnections: Array.from(this.connections.values()).filter((c) => c.type === "player").length,
      adminConnections: Array.from(this.connections.values()).filter((c) => c.type === "admin").length,
      spectatorConnections: Array.from(this.connections.values()).filter((c) => c.type === "spectator").length,
      activeBattles: this.battleManager.getActiveBattles().length,
      totalBattles: this.battleManager.getAllBattles().length
    };
  }
}

module.exports = PyxisSocketManager;
