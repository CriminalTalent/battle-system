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

// 업로드 라우터(불변)
import avatarUploadRouter from "./src/routes/avatar-upload.js";

dotenv.config();

// -----------------------------------------------
// 경로/서버 기본
// -----------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const rootDir    = path.resolve(__dirname);              // packages/battle-server
const publicDir  = path.join(rootDir, "public");
const uploadsDir = path.join(rootDir, "uploads");
const PORT        = Number(process.env.PORT || 3001);
const HOST        = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = "/socket.io"; // 불변

// 디렉토리 보장
fs.mkdirSync(path.join(uploadsDir, "avatars"), { recursive: true });

// 앱/소켓
const app    = express();
const server = http.createServer(app);
const io     = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// 정적 제공(불변)
app.use("/uploads", express.static(uploadsDir));
app.use("/api/upload", avatarUploadRouter);

// SPA 엔드포인트(불변)
app.get("/admin",     (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/player",    (_req,res)=> res.sendFile(path.join(publicDir, "player.html")));
app.get("/spectator", (_req,res)=> res.sendFile(path.join(publicDir, "spectator.html")));
app.use("/", express.static(publicDir));

// 헬스체크(불변)
app.get("/api/health", (_req,res)=> res.json({ ok:true, status:"healthy" }));

// -----------------------------------------------
/** 유틸/엔진 (D20 기반 규칙 준수) */
// -----------------------------------------------
const now   = () => Date.now();
const d20   = () => Math.floor(Math.random()*20)+1;
const genId = (p="") => p + Math.random().toString(36).slice(2,8).toUpperCase();
const clone = (o) => JSON.parse(JSON.stringify(o));

const BATTLES = new Map(); // battleId -> state

function firstAliveId(b, team){
  const p = (b.players||[]).find(x=>x.team===team && x.hp>0);
  return p ? p.id : null;
}

function makeBattle(mode="2v2"){
  return {
    id: `battle_${genId()}`,
    mode: String(mode || "2v2"),
    status: "waiting", // waiting|active|paused|ended
    createdAt: now(),
    players: [],
    currentTurn: {
      turnNumber: 0,
      currentTeam: null,      // "A"|"B"
      currentPlayerId: null,  // 진행 중 플레이어 id (선택)
    },
    timers: {
      turnDeadline: null, // epoch ms
    },
    logs: [],
    spectator: { otp: null },
  };
}

function pushLog(battleId, type, message){
  const b = BATTLES.get(battleId); if(!b) return;
  const entry = { ts: now(), type, message };
  b.logs.push(entry);
  // 브로드캐스트는 한 번만 (불변)
  io.to(battleId).emit("battle:log", entry);
}

function initiative(b){
  const sumA = b.players.filter(p=>p.team==="A").reduce((s,p)=>s+(p.stats?.agility||1),0);
  const sumB = b.players.filter(p=>p.team==="B").reduce((s,p)=>s+(p.stats?.agility||1),0);
  let a = sumA + d20();
  let bb = sumB + d20();
  while (a === bb) { a = sumA + d20(); bb = sumB + d20(); }
  const first = (a > bb) ? "A" : "B";
  pushLog(b.id, "battle", `선공 판정: A팀(${sumA}+D20=${a}) / B팀(${sumB}+D20=${bb}) → 선공: ${first}팀`);
  return first;
}

const turnDeadline5m = () => now() + 5*60*1000;

// 스냅샷(불변 데이터 계약 준수 + timeLeftSec + currentPlayer)
function snapshot(battleId){
  const b = BATTLES.get(battleId);
  if(!b) return null;

  const snap = clone(b);
  const dl = b.timers?.turnDeadline || null;

  snap.currentTurn = snap.currentTurn || {};
  snap.currentTurn.timeLeftSec = dl ? Math.max(0, Math.floor((dl - now())/1000)) : null;

  // 현재 진행자 정보 보강
  const cpid = b.currentTurn?.currentPlayerId || null;
  if (cpid) {
    const cp = (b.players||[]).find(p=>p.id===cpid) || null;
    snap.currentTurn.currentPlayer = cp ? { id: cp.id, avatar: cp.avatar || null } : null;
  } else {
    snap.currentTurn.currentPlayer = null;
  }

  return snap;
}

function emitUpdate(battleId){
  const snap = snapshot(battleId);
  if(!snap) return;
  io.to(battleId).emit("battleUpdate", snap); // emit은 한 번
}

// -----------------------------------------------
// HTTP: 전투 생성 (HTTP 폴백용 - 불변)
// -----------------------------------------------
app.post("/api/battles", (req,res)=>{
  const mode = (req.body?.mode || "2v2");
  const b = makeBattle(mode);
  BATTLES.set(b.id, b);
  res.json({ ok:true, id:b.id, battleId:b.id, battle: snapshot(b.id) });
});

// -----------------------------------------------
// HTTP: 링크 발급 (신·구 키 동시 제공 - 불변)
//  - /api/admin/battles/:id/links  (우선)
//  - /api/battles/:id/links       (호환)
// -----------------------------------------------
const makeOtp = (len=6) => Array.from({length:len}, ()=>Math.floor(Math.random()*10)).join("");
const baseUrlFrom = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

function buildLinksResponse(req, res){
  try{
    const battleId = String(req.params.id || "");
    const b = BATTLES.get(battleId);
    if(!b) return res.status(404).json({ ok:false, error:"BATTLE_NOT_FOUND" });

    const base = baseUrlFrom(req);

    // 관전자 OTP/URL
    if(!b.spectator) b.spectator = {};
    if(!b.spectator.otp) b.spectator.otp = makeOtp();
    const spectatorOtp = b.spectator.otp;
    const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(spectatorOtp)}`;

    // 전투 참가자 개별 링크 (플레이어 토큰 보장)
    const players = (b.players||[]).map(p=>{
      if(!p.token) p.token = makeOtp();
      const url = `${base}/player?battle=${encodeURIComponent(battleId)}&playerId=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}&team=${p.team}&token=${encodeURIComponent(p.token)}`;
      return { playerId:p.id, name:p.name, team:p.team, token:p.token, url };
    });

    // 서버 로그(운영 확인용)
    players.forEach(pl => console.log(`[LINK] ${pl.name} -> ${pl.url}`));

    // 신·구 동시 제공(불변)
    const payload = {
      ok: true,
      spectator: { otp: spectatorOtp, url: spectatorUrl },
      players,
      // 호환 키
      spectatorOtp: spectatorOtp,
      spectatorUrl: spectatorUrl,
      playerLinks: players.map(pl=>({ playerName:pl.name, team:pl.team, otp:pl.token, url:pl.url })),
    };
    return res.json(payload);
  }catch(e){
    console.error("links error", e);
    return res.status(500).json({ ok:false, error:"LINKS_INTERNAL_ERROR" });
  }
}
app.post("/api/admin/battles/:id/links", buildLinksResponse);
app.post("/api/battles/:id/links",      buildLinksResponse);

// -----------------------------------------------
// 소켓 이벤트
// -----------------------------------------------
io.on("connection", (socket)=>{

  // 방 참여
  socket.on("join", ({ battleId })=>{
    if(!battleId) return;
    socket.join(String(battleId));
    const snap = snapshot(String(battleId));
    if(snap) socket.emit("battleUpdate", snap);
  });

  // 전투 생성
  socket.on("createBattle", ({ mode }, cb = ()=>{} )=>{
    const b = makeBattle(mode || "2v2");
    BATTLES.set(b.id, b);
    pushLog(b.id, "system", `전투가 생성되었습니다: ${b.id}`);
    emitUpdate(b.id);
    cb({ ok:true, id:b.id, battleId:b.id, battle: snapshot(b.id) });
  });

  // 참가자 추가 (관리자에서 보낸 값 그대로 반영)
  socket.on("addPlayer", (payload, cb = ()=>{})=>{
    const { battleId, name, team, hp, avatar, stats, items } = payload || {};
    const b = BATTLES.get(String(battleId));
    if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });

    const p = {
      id: `p_${genId()}`,
      name: String(name || "무명"),
      team: (team === "A" ? "A" : "B"),
      hp: Number(hp || 100),
      maxHp: 100,
      avatar: avatar || null,
      stats: {
        attack:  Number(stats?.attack  ?? 1),
        defense: Number(stats?.defense ?? 1),
        agility: Number(stats?.agility ?? 1),
        luck:    Number(stats?.luck    ?? 1),
      },
      items: {
        dittany:        Number(items?.dittany        ?? items?.ditany        ?? 0),
        attackBooster:  Number(items?.attackBooster  ?? items?.attack_boost  ?? 0),
        defenseBooster: Number(items?.defenseBooster ?? items?.defense_boost ?? 0),
      },
      ready: false,
      joinedAt: now(),
    };

    b.players.push(p);
    pushLog(battleId, "admin", `전투 참가자 추가: ${p.name} (${p.team}팀)`);
    emitUpdate(battleId);
    cb({ ok:true, player:p, battle: snapshot(battleId) });
  });

  function _removePlayer({ battleId, playerId }, cb = ()=>{}){
    const b = BATTLES.get(String(battleId));
    if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    const idx = b.players.findIndex(p=>p.id===playerId);
    if(idx>=0){
      const [p] = b.players.splice(idx,1);
      pushLog(battleId, "admin", `전투 참가자 제거: ${p.name} (${p.team}팀)`);
      emitUpdate(battleId);
      return cb({ ok:true });
    }
    cb({ ok:false, error:"PLAYER_NOT_FOUND" });
  }
  socket.on("deletePlayer", _removePlayer);
  socket.on("removePlayer", _removePlayer); // 호환

  // 인증(전투 참가자 자동 로그인) – 호환 이벤트 모두 송신
  socket.on("playerAuth", ({ battleId, token, password, otp, playerName }, cb = ()=>{} )=>{
    const b = BATTLES.get(String(battleId));
    if(!b) { const err={ ok:false, error:"BATTLE_NOT_FOUND" }; cb(err); socket.emit("authError", err); return; }
    const t = token || password || otp || "";
    const p = b.players.find(x=> (x.token===t) || (playerName && x.name===playerName) );
    if(p){
      const result = { ok:true, playerId:p.id, name:p.name, team:p.team, avatar:p.avatar, battle: snapshot(battleId) };
      socket.emit("authSuccess", result);
      socket.emit("auth:success", result); // 호환
      cb(result);
      pushLog(battleId, "system", `${p.name} 입장`);
      emitUpdate(battleId);
      return;
    }
    const err = { ok:false, error:"AUTH_FAILED" };
    socket.emit("authError", err);
    cb(err);
  });

  // 준비 완료(서버는 player:ready/playerReady 둘 다 수신)
  function onReady({ battleId, playerId }, ack){
    const b = BATTLES.get(String(battleId)); if(!b) return ack?.({ ok:false, error:"BATTLE_NOT_FOUND" });
    const p = b.players.find(x=>x.id===playerId); if(!p) return ack?.({ ok:false, error:"PLAYER_NOT_FOUND" });
    p.ready = true;
    pushLog(battleId, "battle", `${p.name} 준비 완료`);
    emitUpdate(battleId);
    ack?.({ ok:true });
  }
  socket.on("player:ready", onReady);
  socket.on("playerReady",  onReady); // 호환

  // 전투 제어
  socket.on("startBattle", ({ battleId }, cb = ()=>{} )=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    if(b.status!=="waiting" && b.status!=="paused") return cb({ ok:false, error:"INVALID_STATE" });
    if(b.players.length===0) return cb({ ok:false, error:"NO_PLAYERS" });

    if(b.currentTurn.turnNumber===0){
      const first = initiative(b);
      b.currentTurn.currentTeam = first;
      b.currentTurn.turnNumber  = 1;
      b.currentTurn.currentPlayerId = firstAliveId(b, first);
    }
    b.status = "active";
    b.timers.turnDeadline = turnDeadline5m();
    emitUpdate(battleId);
    cb({ ok:true });
  });

  socket.on("pauseBattle", ({ battleId }, cb = ()=>{} )=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    b.status = "paused";
    emitUpdate(battleId);
    cb({ ok:true });
  });

  socket.on("resumeBattle", ({ battleId }, cb = ()=>{} )=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    b.status = "active";
    b.timers.turnDeadline = turnDeadline5m();
    emitUpdate(battleId);
    cb({ ok:true });
  });

  socket.on("endBattle", ({ battleId }, cb = ()=>{} )=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    b.status = "ended";
    emitUpdate(battleId);
    cb({ ok:true });
  });

  // 행동(서버는 player:action & playerAction 둘 다 수신, 결과는 단일 이벤트 발신)
  function onAction({ battleId, playerId, action }, cb = ()=>{} ){
    const b = BATTLES.get(String(battleId)); if(!b) { cb({ ok:false, error:"BATTLE_NOT_FOUND" }); return; }
    if(b.status!=="active"){ cb({ ok:false, error:"NOT_ACTIVE" }); return; }
    const p = b.players.find(x=>x.id===playerId); if(!p){ cb({ ok:false, error:"PLAYER_NOT_FOUND" }); return; }

    const enemyTeam = (p.team==="A") ? "B" : "A";
    const target = b.players.find(x=>x.team===enemyTeam && x.hp>0) || null;

    let msg = "";
    if(action?.type==="attack" && target){
      const atkRoll   = (p.stats?.attack||1) + d20();
      const dodgeRoll = (target.stats?.agility||1) + d20();
      if(atkRoll >= dodgeRoll){
        const base = (p.stats?.attack||1) + d20();
        const def  = (target.stats?.defense||1);
        let dmg = Math.max(1, base - def);
        // 치명(20 - 행운/2) 판정
        const critThreshold = Math.max(1, 20 - Math.floor((p.stats?.luck||1)/2));
        const isCrit = (d20() >= critThreshold);
        if(isCrit) dmg *= 2;
        target.hp = Math.max(0, target.hp - dmg);
        msg = `${p.name}의 공격! ${target.name}에게 ${dmg} 피해${isCrit?"(치명타)":""}`;
      }else{
        msg = `${p.name}의 공격 빗나감`;
      }
    }else if(action?.type==="defend"){
      msg = `${p.name} 방어 태세`;
    }else if(action?.type==="dodge"){
      msg = `${p.name} 회피 시도`;
    }else if(action?.type==="item"){
      const item = action?.item;
      if(item==="dittany" || item==="ditany"){
        if(p.items.dittany>0){ p.items.dittany--; p.hp = Math.min(p.maxHp, p.hp+10); msg = `${p.name} 디터니 사용(+10)`; }
        else msg = `${p.name} 디터니 없음`;
      }else if(item==="attackBooster" || item==="attack_boost"){
        if(p.items.attackBooster>0){ p.items.attackBooster--; msg = `${p.name} 공격 보정기 사용`; }
        else msg = `${p.name} 공격 보정기 없음`;
      }else if(item==="defenseBooster" || item==="defense_boost"){
        if(p.items.defenseBooster>0){ p.items.defenseBooster--; msg = `${p.name} 방어 보정기 사용`; }
        else msg = `${p.name} 방어 보정기 없음`;
      }else{
        msg = `${p.name} 아이템 사용 실패`;
      }
    }else{
      msg = `${p.name} 패스`;
    }

    pushLog(battleId, "battle", msg);

    // 턴 교대(간단 모델): 팀만 교대, 진행자 갱신
    const curTeam = b.currentTurn.currentTeam || "A";
    const nextTeam = (curTeam==="A") ? "B" : "A";
    b.currentTurn.currentTeam = nextTeam;
    b.currentTurn.turnNumber = (b.currentTurn.turnNumber || 1) + 1;
    b.currentTurn.currentPlayerId = firstAliveId(b, nextTeam);
    b.timers.turnDeadline = turnDeadline5m();

    emitUpdate(battleId);
    cb({ ok:true });
    socket.emit("actionSuccess", { ok:true });
  }
  socket.on("player:action", onAction);
  socket.on("playerAction",  onAction); // 호환

  // 채팅(보낼 때는 chatMessage 단일, 브로드캐스트도 단일)
  socket.on("chatMessage", ({ battleId, name, message })=>{
    if(!battleId || !message) return;
    io.to(String(battleId)).emit("chatMessage", { name: String(name || "전투 참가자"), message: String(message).slice(0,500) });
  });

  // 관전자 응원(브로드캐스트는 채팅으로만, 로그 X)
  socket.on("spectator:cheer", ({ battleId, name, message })=>{
    if(!battleId) return;
    io.to(String(battleId)).emit("chatMessage", { name: String(name || "관전자"), message: `[응원] ${String(message||"").slice(0,200)}` });
  });
});

// 에러 핸들링
app.use((err,_req,res,_next)=>{
  console.error(err);
  res.status(500).json({ ok:false, error:"internal" });
});

server.listen(PORT, HOST, ()=>{
  console.log("======================================");
  console.log("PYXIS Battle Server");
  console.log(`Server : http://${HOST}:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log("======================================");
});
