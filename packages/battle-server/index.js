// packages/battle-server/index.js
// 포트/소켓 경로 고정: 3001 / /socket.io
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server as IOServer } from "socket.io";

import avatarUploadRouter from "./src/routes/avatar-upload.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const HOST        = process.env.HOST || "0.0.0.0";
const PORT        = Number(process.env.PORT || 3001);
const SOCKET_PATH = "/socket.io";

// 정적 경로
const publicDir  = path.join(__dirname, "public");
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(path.join(uploadsDir, "avatars"), { recursive: true });

// 앱/소켓
const app    = express();
const server = http.createServer(app);
const io     = new IOServer(server, { path: SOCKET_PATH, cors: { origin: "*", methods: ["GET","POST"] } });

// 미들웨어
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(publicDir));
app.use("/api/upload", avatarUploadRouter); // 불변

// 인메모리 상태
const battles    = new Map(); // battleId -> battle
const tokenStore = new Map(); // token    -> { type:'player'|'spectator', battleId, playerId|null, expires }

// 유틸
const now   = () => Date.now();
const d20   = () => Math.floor(Math.random()*20)+1;
const genId = () => Math.random().toString(36).slice(2,6).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
const clone = (o) => JSON.parse(JSON.stringify(o));

function firstAliveId(b, team){
  const p = (b.players||[]).find(x=>x.team===team && x.hp>0);
  return p ? p.id : null;
}

// 로그: 보낼 때는 1회만
function pushLog(battleId, type, message){
  const b = battles.get(battleId); if(!b) return;
  const entry = { ts: now(), type, message };
  b.logs.push(entry);
  io.to(battleId).emit("battle:log", entry);
}

// 스냅샷 브로드캐스트(보낼 때는 1회만)
function emitBattleUpdate(battleId){
  const b = battles.get(battleId); if(!b) return;
  const payload = clone(b);

  // 남은 시간
  const dl = b.currentTurn?.turnDeadline || null;
  payload.currentTurn = payload.currentTurn || {};
  payload.currentTurn.timeLeftSec = dl ? Math.max(0, Math.floor((dl - now())/1000)) : null;

  // 현재 진행자(아이디/아바타)
  const cpid = b.currentTurn?.currentPlayerId || null;
  payload.currentTurn.currentPlayerId = cpid;
  if (cpid) {
    const cp = (b.players||[]).find(p=>p.id===cpid) || null;
    payload.currentTurn.currentPlayer = cp ? { id: cp.id, avatar: cp.avatar || null } : null;
  } else {
    payload.currentTurn.currentPlayer = null;
  }

  io.to(battleId).emit("battleUpdate", payload);
}

// --- API (불변) ---
app.get("/api/health", (_req,res)=> res.json({ ok:true, uptime:process.uptime(), battles: battles.size }) );

app.post("/api/battles", (req,res)=>{
  const id   = genId();
  const mode = String(req.body?.mode || "1v1");
  const battle = {
    id, mode, status:"waiting", createdAt: now(),
    players: [], logs: [],
    currentTurn: { turnNumber:0, currentTeam:null, currentPlayer:null, currentPlayerId:null, turnDeadline:null }
  };
  battles.set(id, battle);
  pushLog(id, "system", `전투 생성 (${mode})`);
  res.json({ ok:true, battleId:id, battle: clone(battle) });
});

// 링크 발급(관리자) + 호환 경로
app.post(["/api/admin/battles/:id/links", "/api/battles/:id/links"], (req,res)=>{
  const id = String(req.params.id||"");
  const b  = battles.get(id);
  if(!b) return res.status(404).json({ ok:false, error:"not_found" });

  const base = req.headers["x-base-url"] || `${req.protocol}://${req.get("host")}`;

  // 관전자 OTP
  const specOTP = genId();
  tokenStore.set(specOTP, { type:"spectator", battleId:id, playerId:null, expires: now()+24*60*60*1000 });

  // 전투 참가자 개별 링크(token + playerId)
  const players = b.players.map(p=>{
    const t = genId()+genId();
    tokenStore.set(t, { type:"player", battleId:id, playerId:p.id, expires: now()+24*60*60*1000 });
    return {
      playerId: p.id, name: p.name, team: p.team, token: t,
      url: `${base}/player.html?battle=${id}&token=${t}&playerId=${p.id}&name=${encodeURIComponent(p.name)}&team=${p.team}`
    };
  });

  res.json({
    ok:true,
    spectator: { otp: specOTP, url: `${base}/spectator.html?battle=${id}&otp=${specOTP}` },
    players
  });
});

// --- 소켓 ---
io.on("connection", (socket)=>{

  socket.on("join", ({ battleId })=>{
    if(!battleId) return;
    socket.join(String(battleId));
    emitBattleUpdate(String(battleId));
  });

  // 전투 참가자 자동 로그인 (토큰/ID/이름 호환 + 콜백 ack 지원)
  socket.on("playerAuth", ({ battleId, password, token, otp, playerId, playerName }, cb = ()=>{})=>{
    const id = String(battleId||"");
    const b  = battles.get(id);
    if(!id || !b){
      const err = { ok:false, error:"battle_not_found" };
      cb(err); socket.emit("authError", err); return;
    }

    let p = null;

    // 1) 토큰 매칭
    const t = password || token || otp || "";
    if (t && tokenStore.has(t)) {
      const rec = tokenStore.get(t);
      if (rec && rec.type==="player" && rec.battleId===id && (!rec.expires || now()<rec.expires)) {
        p = b.players.find(x=>x.id===rec.playerId) || null;
      }
    }
    // 2) 실패 시 playerId → playerName
    if (!p && playerId)   p = b.players.find(x=>x.id===playerId) || null;
    if (!p && playerName) p = b.players.find(x=>x.name===playerName) || null;

    if(!p){
      const err = { ok:false, error:"auth_failed" };
      cb(err); socket.emit("authError", err); return;
    }

    socket.join(id);
    socket.battleId = id;
    socket.playerId = p.id;
    socket.role     = "player";

    const result = { ok:true, playerId:p.id, name:p.name, team:p.team, avatar:p.avatar, battle: clone(b) };
    socket.emit("authSuccess", result);
    socket.emit("auth:success", result); // 호환
    cb(result);

    pushLog(id, "system", `${p.name} 입장`);
    emitBattleUpdate(id);
  });

  // 준비 완료 (emit은 player:ready 또는 playerReady 중 하나, 서버는 둘 다 수신)
  function handleReady({ battleId, playerId }, cb){
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb && cb({ ok:false, error:"not_found" });
    const p  = b.players.find(x=>x.id===playerId); if(!p) return cb && cb({ ok:false, error:"player_not_found" });
    p.ready = true;
    pushLog(id, "battle", `${p.name} 준비 완료`);
    emitBattleUpdate(id);
    cb && cb({ ok:true });
  }
  socket.on("player:ready", handleReady);
  socket.on("playerReady",  handleReady);

  // 전투 생성/제어
  socket.on("createBattle", ({ mode }, cb=()=>{})=>{
    const id = genId();
    const b  = { id, mode:String(mode||"1v1"), status:"waiting", createdAt:now(),
      players:[], logs:[], currentTurn:{ turnNumber:0, currentTeam:null, currentPlayer:null, currentPlayerId:null, turnDeadline:null } };
    battles.set(id,b); pushLog(id,"system",`전투 생성 (${b.mode})`); cb({ ok:true, battleId:id, battle: clone(b) });
  });

  socket.on("startBattle", ({ battleId }, cb=()=>{})=>{
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb({ ok:false, error:"not_found" });

    // 선공: 팀 민첩 합 + D20 (동점 재굴림)
    const sum = (team)=> (b.players||[]).filter(p=>p.team===team).reduce((s,p)=>s+(p.stats?.agility||0),0);
    const aS=sum("A"), bS=sum("B"), rA=d20(), rB=d20();
    let first = (aS+rA) > (bS+rB) ? "A" : (aS+rA) < (bS+rB) ? "B" : (d20()>=d20()?"A":"B");

    b.status="active";
    b.currentTurn = {
      turnNumber: 1,
      currentTeam: first,
      currentPlayer: null,
      currentPlayerId: firstAliveId(b, first),
      turnDeadline: now()+5*60*1000
    };

    pushLog(id, "battle", `선공 판정: A팀(${aS} + D20=${rA}) / B팀(${bS} + D20=${rB}) → 선공: ${first}팀`);
    emitBattleUpdate(id);
    cb({ ok:true });
  });

  socket.on("pauseBattle", ({ battleId }, cb=()=>{})=>{
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb({ ok:false, error:"not_found" });
    b.status="paused"; emitBattleUpdate(id); cb({ ok:true });
  });

  socket.on("resumeBattle", ({ battleId }, cb=()=>{})=>{
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb({ ok:false, error:"not_found" });
    b.status="active";
    if (b.currentTurn) b.currentTurn.turnDeadline = now()+5*60*1000;
    emitBattleUpdate(id); cb({ ok:true });
  });

  socket.on("endBattle", ({ battleId }, cb=()=>{})=>{
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb({ ok:false, error:"not_found" });
    b.status="ended"; emitBattleUpdate(id); cb({ ok:true });
  });

  // 참가자 추가/삭제
  socket.on("addPlayer", ({ battleId, player }, cb=()=>{})=>{
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb({ ok:false, error:"not_found" });
    const p = {
      id: "p_"+Math.random().toString(36).slice(2,10),
      name: String(player?.name || "이름"),
      team: (player?.team==="B" ? "B" : "A"),
      hp:100, maxHp:100,
      stats: {
        attack:  Number(player?.stats?.attack  || 1),
        defense: Number(player?.stats?.defense || 1),
        agility: Number(player?.stats?.agility || 1),
        luck:    Number(player?.stats?.luck    || 1),
      },
      items: {
        dittany:        Number(player?.items?.dittany        || player?.items?.ditany        || 0),
        attackBooster:  Number(player?.items?.attackBooster  || player?.items?.attack_boost  || 0),
        defenseBooster: Number(player?.items?.defenseBooster || player?.items?.defense_boost || 0),
      },
      avatar: player?.avatar || null,
      ready:false, joinedAt: now(),
    };
    b.players.push(p);
    pushLog(id,"system",`전투 참가자 추가: ${p.name} (${p.team}팀)`);
    emitBattleUpdate(id);
    cb({ ok:true, player:p, battle: clone(b) });
  });

  function removePlayerInternal({ battleId, playerId }, cb){
    const id = battleId || socket.battleId;
    const b  = battles.get(id); if(!b) return cb({ ok:false, error:"not_found" });
    const idx = b.players.findIndex(x=>x.id===playerId);
    const nm  = idx>=0 ? b.players[idx].name : playerId;
    if(idx>=0) b.players.splice(idx,1);
    pushLog(id,"system",`전투 참가자 삭제: ${nm}`); emitBattleUpdate(id); cb({ ok:true });
  }
  socket.on("deletePlayer", removePlayerInternal);
  socket.on("removePlayer", removePlayerInternal); // 호환

  // 채팅: 보낼 때 1회, 수신은 호환
  socket.on("chatMessage", ({ battleId, name, message })=>{
    const id = battleId || socket.battleId; if(!id) return;
    const payload = { name: String(name||"전투 참가자"), message: String(message||"").slice(0,500) };
    io.to(id).emit("chatMessage", payload);
  });

  // 응원: 채팅에만(로그 X) / 구호환 수신 변환
  socket.on("spectator:cheer", ({ battleId, name, message })=>{
    const id = battleId || socket.battleId; if(!id) return;
    const payload = { name: String(name||"관전자"), message: `[응원] ${String(message||"").slice(0,200)}` };
    io.to(id).emit("chatMessage", payload);
  });
  socket.on("cheerMessage", (p)=> socket.emit("spectator:cheer", p));
});

// SPA 라우팅
app.get("/",          (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/admin",     (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/player",    (_req,res)=> res.sendFile(path.join(publicDir, "player.html")));
app.get("/spectator", (_req,res)=> res.sendFile(path.join(publicDir, "spectator.html")));

app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({ ok:false, error:"internal" }); });

server.listen(PORT, HOST, ()=>{
  console.log("======================================");
  console.log("PYXIS Battle Server");
  console.log(`Server : http://${HOST}:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log("======================================");
});
