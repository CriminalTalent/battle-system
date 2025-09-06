// packages/battle-server/index.js
"use strict";

/**
 * PYXIS Battle Server – Unified (Express + Socket.IO)
 * - In-memory battle store (for demo/prototype)
 * - REST routes:
 *    POST   /api/battles                                   -> create battle
 *    GET    /api/battles/:id                                -> get battle
 *    POST   /api/battles/:id/players                        -> add player
 *    DELETE /api/battles/:id/players/:playerId              -> remove player
 *    POST   /api/admin/battles/:id/start                    -> start (or restart)
 *    POST   /api/admin/battles/:id/pause                    -> pause
 *    POST   /api/admin/battles/:id/end                      -> end
 *    POST   /api/admin/battles/:id/command                  -> admin command (heal_partial, damage)
 *    POST   /api/admin/battles/:id/links                    -> generate links (admin, player, spectator)
 *    POST   /api/admin/battles/:id/otp                      -> issue OTP(s) for player/spectator
 *    GET    /api/otp/:token                                 -> validate OTP
 *
 * - Socket.IO events:
 *    adminAuth  -> {battleId, token}
 *    playerAuth -> {battleId, token, name?}
 *    admin:ping
 *    admin:requestState
 *    battle:start
 *    chatMessage -> {role:'admin'|'player', message, battleId}
 *    player:action -> {battleId, playerId, action}
 *    admin:generateLinks (optional fallback) -> ack {ok, adminUrl, playerUrl, spectatorUrl}
 *
 * Pages:
 *   - /admin       -> public/pages/admin.html
 *   - /play        -> public/pages/player.html
 *   - /spectator   -> public/pages/spectator.html
 *
 * Notes:
 * - This file is self-contained and safe to drop in. Adjust the OTPManager require path if needed.
 * - PUBLIC_BASE_URL environment variable is used when building absolute URLs for links.
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Server } = require("socket.io");

// Adjust the path to your OTPManager if different.
// Example placements tried here: ./OTPManager.js or ./src/utils/OTPManager.js
let OTPManager;
try {
  OTPManager = require("./OTPManager");
} catch {
  OTPManager = require("./src/utils/OTPManager");
}
const otpManager = new OTPManager();

// ----------------------------------------------------------------------------
// App setup
// ----------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3001);
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  null; // if null, will be inferred from request scheme+host

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] },
});

app.use(cors());
app.use(bodyParser.json());
app.use(
  "/",
  express.static(path.join(__dirname, "public"), {
    fallthrough: true,
    index: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);

// Shortcut page routes
app.get("/admin", (_, res) =>
  res.sendFile(path.join(__dirname, "public/pages/admin.html"))
);
app.get("/play", (_, res) =>
  res.sendFile(path.join(__dirname, "public/pages/player.html"))
);
app.get("/spectator", (_, res) =>
  res.sendFile(path.join(__dirname, "public/pages/spectator.html"))
);

// ----------------------------------------------------------------------------
// In-memory store (prototype)
// ----------------------------------------------------------------------------
const battles = new Map(); // id -> battle

function makeId(n = 8) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function nowTs() {
  return Date.now();
}

function ensureBattle(id) {
  const b = battles.get(id);
  if (!b) return null;
  return b;
}

function createBattle({ mode = "2v2" } = {}) {
  const id = makeId(10);
  const battle = {
    id,
    mode,
    status: "waiting", // waiting | live | ended
    createdAt: nowTs(),
    startedAt: null,
    endedAt: null,
    // Basic turn state: current -> player id or name
    turn: { current: null, lastChange: null },
    // Minimal admin token for auth simulation
    adminToken: makeId(16),
    // Players
    players: [],
    // Log lines
    log: [],
  };
  battles.set(id, battle);
  return battle;
}

function addLog(battle, type, message) {
  battle.log.push({ t: nowTs(), type, message });
  // Limit log growth
  if (battle.log.length > 1000) battle.log.splice(0, battle.log.length - 1000);
}

function playerById(battle, playerId) {
  return battle.players.find((p) => p.id === playerId);
}

function teamKey(v) {
  const s = String(v || "").toLowerCase();
  if (["phoenix", "a", "team1"].includes(s)) return "phoenix";
  if (["eaters", "b", "team2", "death", "deatheaters"].includes(s))
    return "eaters";
  return "phoenix";
}

function toAbsBase(req) {
  return (
    PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "")
  );
}

// ----------------------------------------------------------------------------
// REST: Battles
// ----------------------------------------------------------------------------
app.post("/api/battles", (req, res) => {
  const { mode } = req.body || {};
  const battle = createBattle({ mode: mode || "2v2" });
  addLog(battle, "system", `Battle created with mode ${battle.mode}`);
  res.json({ id: battle.id, token: battle.adminToken, battle });
});

app.get("/api/battles/:id", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });
  res.json(battle);
});

app.post("/api/battles/:id/players", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });

  const { name, team, stats, items } = req.body || {};
  if (!name) return res.status(400).json({ error: "invalid_name" });

  const p = {
    id: makeId(12),
    name: String(name),
    team: teamKey(team),
    stats: {
      atk: Number(stats?.atk || 3),
      def: Number(stats?.def || 3),
      agi: Number(stats?.agi || 3),
      luk: Number(stats?.luk || 3),
    },
    items: Array.isArray(items) ? items.slice(0, 4) : [],
    hp: 100,
    maxHp: 100,
  };
  battle.players.push(p);
  addLog(battle, "system", `Player joined: ${p.name} [${p.team}]`);
  io.to(battle.id).emit("battleUpdate", battle);
  res.json({ ok: true, player: p });
});

app.delete("/api/battles/:id/players/:playerId", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });

  const pid = req.params.playerId;
  const before = battle.players.length;
  battle.players = battle.players.filter((p) => p.id !== pid);
  if (battle.players.length === before)
    return res.status(404).json({ error: "player_not_found" });

  addLog(battle, "system", `Player removed: ${pid}`);
  io.to(battle.id).emit("battleUpdate", battle);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// REST: Admin controls
// ----------------------------------------------------------------------------
app.post("/api/admin/battles/:id/start", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });

  battle.status = "live";
  battle.startedAt = battle.startedAt || nowTs();
  addLog(battle, "system", "Battle started");

  // First turn seed: choose first player by team agility sum vs other
  if (!battle.turn.current) {
    const sumAgi = (team) =>
      battle.players
        .filter((p) => p.team === team)
        .reduce((acc, p) => acc + (Number(p.stats?.agi) || 0), 0);
    const agiA = sumAgi("phoenix");
    const agiB = sumAgi("eaters");
    const firstTeam = agiA === agiB ? "phoenix" : agiA > agiB ? "phoenix" : "eaters";
    const first = battle.players.find((p) => p.team === firstTeam);
    battle.turn.current = first ? first.id : battle.players[0]?.id || null;
    battle.turn.lastChange = nowTs();
  }

  io.to(battle.id).emit("battleUpdate", battle);
  res.json({ ok: true, battle });
});

app.post("/api/admin/battles/:id/pause", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });
  battle.status = "waiting";
  addLog(battle, "system", "Battle paused");
  io.to(battle.id).emit("battleUpdate", battle);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/end", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });
  battle.status = "ended";
  battle.endedAt = nowTs();
  addLog(battle, "system", "Battle ended");
  io.to(battle.id).emit("battleUpdate", battle);
  res.json({ ok: true });
});

app.post("/api/admin/battles/:id/command", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });

  const { action, playerIds, value } = req.body || {};
  if (!Array.isArray(playerIds) || !playerIds.length)
    return res.status(400).json({ error: "invalid_players" });

  const val = Math.max(0, Number(value) || 0);

  for (const pid of playerIds) {
    const p = playerById(battle, pid);
    if (!p) continue;
    if (action === "heal_partial") {
      p.hp = Math.min(p.maxHp, p.hp + val);
      addLog(battle, "system", `Heal ${p.name} +${val} -> ${p.hp}`);
    } else if (action === "damage") {
      p.hp = Math.max(0, p.hp - val);
      addLog(battle, "system", `Damage ${p.name} -${val} -> ${p.hp}`);
    }
  }

  io.to(battle.id).emit("battleUpdate", battle);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// REST: Links/OTP issuance
// ----------------------------------------------------------------------------
app.post("/api/admin/battles/:id/links", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });

  const base = toAbsBase(req);
  const id = battle.id;

  // spectator OTP (multi-use with TTL), player needs per-user OTP
  const spectatorOtp = otpManager.generateOTP("spectator", { battleId: id });

  const adminUrl = `${base}/admin?battle=${encodeURIComponent(
    id
  )}&token=${encodeURIComponent(battle.adminToken)}`;
  const playerUrl = `${base}/play?battle=${encodeURIComponent(
    id
  )}&token={playerOtp}`;
  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(
    id
  )}&token=${encodeURIComponent(spectatorOtp)}`;

  res.json({
    admin: adminUrl,
    player: playerUrl,
    spectator: spectatorUrl,
    links: { admin: adminUrl, player: playerUrl, spectator: spectatorUrl },
  });
});

app.post("/api/admin/battles/:id/otp", (req, res) => {
  const battle = ensureBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });

  const role = String(req.body?.role || "player").toLowerCase();
  if (!["player", "spectator"].includes(role))
    return res.status(400).json({ error: "invalid_role" });

  const count = role === "player" ? Math.max(1, Math.min(100, Number(req.body?.count || 1))) : 1;
  const otps = [];
  for (let i = 0; i < count; i++) {
    const otp = otpManager.generateOTP(role, { battleId: battle.id });
    if (otp) otps.push(otp);
  }

  res.json({ ok: true, role, otps });
});

app.get("/api/otp/:token", (req, res) => {
  const token = req.params.token;
  const result = otpManager.validateOTP(token, { ip: req.ip });
  if (!result.valid) return res.status(400).json(result);
  res.json(result);
});

// ----------------------------------------------------------------------------
// Socket.IO
// ----------------------------------------------------------------------------
io.on("connection", (socket) => {
  let scope = { role: null, battleId: null, playerId: null };

  function safeBattle() {
    return scope.battleId ? battles.get(scope.battleId) : null;
  }

  socket.on("adminAuth", ({ battleId, token }) => {
    const b = battles.get(battleId);
    if (!b || token !== b.adminToken) {
      socket.emit("authError", { error: "unauthorized" });
      return;
    }
    scope = { role: "admin", battleId, playerId: null };
    socket.join(battleId);
    socket.emit("authSuccess", { ok: true, battle: b });
  });

  socket.on("playerAuth", ({ battleId, token, name }) => {
    // validate OTP
    const v = otpManager.validateOTP(token, { ip: socket.handshake.address });
    if (!v.valid || v.data?.battleId !== battleId || v.role !== "player") {
      socket.emit("authError", { error: "invalid_token" });
      return;
    }
    const b = battles.get(battleId);
    if (!b) {
      socket.emit("authError", { error: "battle_not_found" });
      return;
    }

    // If name is present and not in roster, attach this token to that player, else attach to first unnamed
    let me =
      (name &&
        b.players.find(
          (p) => p.name && p.name.toLowerCase() === String(name).toLowerCase()
        )) ||
      b.players.find((p) => !p._claimed);

    if (!me) {
      // create a placeholder player
      me = {
        id: makeId(12),
        name: name || "Player",
        team: "phoenix",
        stats: { atk: 3, def: 3, agi: 3, luk: 3 },
        items: [],
        hp: 100,
        maxHp: 100,
      };
      b.players.push(me);
      addLog(b, "system", `Player auto-added: ${me.name}`);
    }

    me._claimed = true;
    me.token = token; // bind for client convenience

    scope = { role: "player", battleId, playerId: me.id };
    socket.join(battleId);
    socket.emit("authSuccess", {
      ok: true,
      self: { id: me.id, name: me.name, team: me.team, stats: me.stats, hp: me.hp, maxHp: me.maxHp },
      players: b.players,
      status: b.status,
      turn: b.turn,
      log: b.log.slice(-30),
    });

    io.to(battleId).emit("battleUpdate", b);
  });

  socket.on("admin:ping", () => {
    socket.emit("pong", { t: Date.now() });
  });

  socket.on("admin:requestState", ({ battleId }) => {
    const b = battles.get(battleId);
    if (b) socket.emit("battleUpdate", b);
  });

  socket.on("battle:start", ({ battleId }, ack) => {
    const b = battles.get(battleId);
    if (!b) return typeof ack === "function" && ack({ success: false });
    b.status = "live";
    b.startedAt = b.startedAt || nowTs();
    addLog(b, "system", "Battle started");
    if (!b.turn.current && b.players.length) {
      b.turn.current = b.players[0].id;
      b.turn.lastChange = nowTs();
    }
    io.to(battleId).emit("battleUpdate", b);
    typeof ack === "function" && ack({ success: true });
  });

  socket.on("chatMessage", ({ role, message, battleId }) => {
    const b = battles.get(battleId);
    if (!b) return;
    const sender = role === "admin" ? "관리자" : "플레이어";
    addLog(b, "chat", `${sender}: ${String(message || "").slice(0, 500)}`);
    io.to(battleId).emit("chatMessage", { sender, message });
  });

  // Minimal action handler: rotate turn and write log
  socket.on("player:action", ({ battleId, playerId, action }, ack) => {
    const b = battles.get(battleId);
    if (!b) return typeof ack === "function" && ack({ success: false });

    const me = playerById(b, playerId);
    if (!me) return typeof ack === "function" && ack({ success: false });

    addLog(b, "event", `${me.name} acted: ${action}`);

    // naive turn rotation among same team then the other team
    const order = b.players.map((p) => p.id);
    const curIdx = order.indexOf(b.turn.current);
    const nextIdx = (curIdx + 1 + order.length) % order.length;
    b.turn.current = order[nextIdx];
    b.turn.lastChange = nowTs();

    io.to(battleId).emit("battleUpdate", b);
    typeof ack === "function" && ack({ success: true });
  });

  // Optional socket fallback for link generation
  socket.on("admin:generateLinks", ({ battleId }, ack) => {
    const b = battles.get(battleId);
    if (!b) return typeof ack === "function" && ack({ ok: false, error: "not_found" });

    const base =
      PUBLIC_BASE_URL ||
      (socket.handshake.headers.origin ||
        "").replace(/\/+$/, "") ||
      null;

    // If we cannot infer base from env/origin, return relative links
    const mk = (p) => (base ? `${base}${p}` : p);

    const spectatorOtp = otpManager.generateOTP("spectator", { battleId: b.id });
    const adminUrl = mk(`/admin?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.adminToken)}`);
    const playerUrl = mk(`/play?battle=${encodeURIComponent(b.id)}&token={playerOtp}`);
    const spectatorUrl = mk(`/spectator?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(spectatorOtp)}`);

    typeof ack === "function" && ack({ ok: true, adminUrl, playerUrl, spectatorUrl });
  });

  socket.on("disconnect", () => {
    // no-op; could track presence
  });
});

// ----------------------------------------------------------------------------
// Start server
// ----------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`PYXIS server listening on ${PORT}`);
});
