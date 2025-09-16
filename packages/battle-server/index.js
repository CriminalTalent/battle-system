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
const PORT       = Number(process.env.PORT || 3001);
const HOST       = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = "/socket.io"; // 불변

// 디렉토리 보장
fs.mkdirSync(path.join(uploadsDir, "avatars"), { recursive: true });

// 앱/소켓
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
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
// 유틸/상태
// -----------------------------------------------
const now   = () => Date.now();
const d20   = () => Math.floor(Math.random()*20)+1;
const clone = (o) => JSON.parse(JSON.stringify(o));
const BATTLES = new Map(); // battleId -> state

const byAgilityThenName = (a,b)=>{
  const ag = (b.stats?.agility||1) - (a.stats?.agility||1);
  if (ag !== 0) return ag;
  return String(a.name||"").localeCompare(String(b.name||""), "ko-KR");
};
const firstAliveOrder = (b, team) =>
  (b.players||[]).filter(p=>p.team===team && p.hp>0).sort(byAgilityThenName).map(p=>p.id);

function makeBattle(mode="2v2"){
  return {
    id: `battle_${Math.random().toString(36).slice(2,10)}`,
    mode, status:"waiting", createdAt: now(),
    players: [],
    logs: [],
    currentTurn: {
      turnNumber: 0,
      currentTeam: null,
      currentPlayerId: null,
      currentPlayer: null,
      turnDeadline: null
    },
    round: {
      phaseTeam: null,              // "A"|"B"
      selections: { A:{}, B:{} },   // playerId -> { type, targetId, item }
      order: { A:[], B:[] },
      defendToken: {},
      dodgeToken: {},
    }
  };
}

function pushLog(battleId, type, message){
  const b = BATTLES.get(battleId); if(!b) return;
  const entry = { ts: now(), type, message };
  b.logs.push(entry);
  io.to(battleId).emit("battle:log", entry);
}

function mmssLeft(ms){
  if(!ms) return null;
  const s = Math.max(0, Math.floor((ms - now())/1000));
  return s;
}

function hydrateCurrentPlayer(b){
  const pid = b.currentTurn?.currentPlayerId;
  if(!pid) { b.currentTurn.currentPlayer = null; return; }
  const p = b.players.find(x=>x.id===pid) || null;
  b.currentTurn.currentPlayer = p ? { id:p.id, avatar: p.avatar || null } : null;
}

function emitUpdate(battleId){
  const b = BATTLES.get(battleId); if(!b) return;
  const snap = clone(b);
  snap.currentTurn = snap.currentTurn || {};
  snap.currentTurn.timeLeftSec = b.currentTurn?.turnDeadline ? mmssLeft(b.currentTurn.turnDeadline) : null;
  hydrateCurrentPlayer(snap);
  io.to(battleId).emit("battleUpdate", snap);
}

// -----------------------------------------------
// 라운드/턴 제어 (필요 최소만)
// -----------------------------------------------
function startPhase(b, team){
  b.round.phaseTeam = team;
  b.round.order[team] = firstAliveOrder(b, team);
  b.currentTurn.currentTeam = team;
  b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, team);
  hydrateCurrentPlayer(b);
  b.currentTurn.turnDeadline = now() + 5*60*1000; // 팀 제한 5분
}
function nextUnactedPlayerId(b, team){
  const order = b.round.order[team] || [];
  for(const pid of order){
    if(!(pid in b.round.selections[team])) return pid;
  }
  return null;
}
function completeTeamIfTimeout(b){
  if(b.status!=="active") return false;
  const dl = b.currentTurn?.turnDeadline;
  if(!dl || now() <= dl) return false;
  const team = b.round.phaseTeam;
  const order = b.round.order[team] || [];
  for(const pid of order){
    if(!(pid in b.round.selections[team])){
      b.round.selections[team][pid] = { type:"pass" };
    }
  }
  return true;
}
function resolveRound(b){
  const dmgLogs = [];
  const healLogs = [];
  b.round.defendToken = {};
  b.round.dodgeToken  = {};
  const byId = Object.fromEntries(b.players.map(p=>[p.id,p]));
  const seq = (team)=> (b.round.order[team]||[]).map(pid => ({ pid, sel: b.round.selections[team][pid] || {type:"pass"} }));

  const attacks = [];
  const heals   = [];
  for(const side of ["A","B"]){
    for(const {pid, sel} of seq(side)){
      if(!sel) continue;
      const me = byId[pid]; if(!me || me.hp<=0) continue;
      if(sel.type==="attack"){
        attacks.push({ attacker: me, target: byId[sel.targetId] || null, side });
      }else if(sel.type==="defend"){
        b.round.defendToken[pid] = true;
      }else if(sel.type==="dodge"){
        b.round.dodgeToken[pid] = true;
      }else if(sel.type==="item" && (sel.item==="dittany" || sel.item==="ditany")){
        heals.push({ who: me, target: byId[sel.targetId] || me });
      }
    }
  }

  for(const act of attacks){
    const a = act.attacker, t = act.target;
    if(!t || a.hp<=0 || t.hp<=0) continue;
    const atkRoll = (a.stats?.attack||1) + d20();
    const tgtDodgeBase = (t.stats?.agility||1);
    const dodgeBonus = b.round.dodgeToken[t.id] ? d20() : 0;
    const dodgeRoll = tgtDodgeBase + d20() + (dodgeBonus>0 ? Math.floor(dodgeBonus/2) : 0);
    if(atkRoll < dodgeRoll){
      dmgLogs.push(`${a.name}이(가) ${t.name}에게 공격(빗나감)`);
      if(b.round.dodgeToken[t.id]) delete b.round.dodgeToken[t.id];
      continue;
    }
    const critThreshold = Math.max(2, 20 - Math.floor((a.stats?.luck||1)/2));
    const isCrit = d20() >= critThreshold;
    const baseAtk = (a.stats?.attack||1) + d20();
    const baseDef = (t.stats?.defense||1);
    let defendExtra = 0;
    if(b.round.defendToken[t.id]){ defendExtra = d20(); delete b.round.defendToken[t.id]; }
    let dmg = Math.max( (baseAtk - (baseDef + defendExtra)), 1 );
    if(isCrit) dmg *= 2;
    t.hp = Math.max(0, t.hp - dmg);
    dmgLogs.push(`${a.name}이(가) ${t.name}에게 공격`);
  }

  for(const h of heals){
    const target = h.target;
    if(!target || target.hp<=0) continue;
    target.hp = Math.min(target.maxHp||100, (target.hp||0) + 10);
    healLogs.push(`${h.who.name}이(가) ${target.name}을(를) 치유(+10)`);
  }

  if(dmgLogs.length===0 && healLogs.length===0){
    pushLog(b.id, "battle", "라운드 결과 없음");
  }else{
    for(const L of dmgLogs) pushLog(b.id, "battle", L);
    for(const L of healLogs) pushLog(b.id, "battle", L);
  }

  b.currentTurn.turnNumber = (b.currentTurn.turnNumber||0) + 1;
  b.currentTurn.currentTeam  = (b.currentTurn.currentTeam==="A") ? "B" : "A";

  b.round = {
    phaseTeam: b.currentTurn.currentTeam,
    selections: { A:{}, B:{} },
    order: { A: firstAliveOrder(b,"A"), B: firstAliveOrder(b,"B") },
    defendToken: {}, dodgeToken: {}
  };
  b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, b.round.phaseTeam);
  hydrateCurrentPlayer(b);
  b.currentTurn.turnDeadline = now() + 5*60*1000;
}

// -----------------------------------------------
// HTTP: 전투 생성 (HTTP 폴백용 - 불변)
// -----------------------------------------------
app.post("/api/battles", (req,res)=>{
  const mode = String(req.body?.mode || "2v2");
  const b = makeBattle(mode);
  BATTLES.set(b.id, b);
  console.log("[HTTP] create battle ->", b.id, "mode:", mode);
  return res.json({ ok:true, id:b.id, battleId:b.id, battle: clone(b) });
});

// -----------------------------------------------
// HTTP: 링크 발급 (신·구 동시 제공 - 불변)
// -----------------------------------------------
function makeOtp(len=6){ return Array.from({length:len}, ()=>Math.floor(Math.random()*10)).join(""); }
function baseUrlFrom(req){ return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`; }

async function buildLinksResponse(req,res){
  try{
    const battleId = String(req.params.id||"");
    const b = BATTLES.get(battleId);
    if(!b) return res.status(404).json({ ok:false, error:"BATTLE_NOT_FOUND" });

    if(!b.spectator) b.spectator = {};
    if(!b.spectator.otp) b.spectator.otp = makeOtp();

    const base = baseUrlFrom(req);
    const spectatorOtp = b.spectator.otp;
    const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(spectatorOtp)}`;

    const players = b.players.map(p=>{
      if(!p.token) p.token = makeOtp();
      const url = `${base}/player?battle=${encodeURIComponent(battleId)}&playerId=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}&team=${p.team}&token=${encodeURIComponent(p.token)}`;
      return { playerId:p.id, name:p.name, team:p.team, token:p.token, url };
    });

    console.log("[HTTP] links for", battleId, "players:", players.length);
    return res.json({
      ok:true,
      spectator: { otp: spectatorOtp, url: spectatorUrl },
      spectatorOtp, spectatorUrl,
      players,
      playerLinks: players.map(pl=>({ playerName:pl.name, team:pl.team, otp:pl.token, url:pl.url }))
    });
  }catch(e){
    console.error("links error", e);
    return res.status(500).json({ ok:false, error:"LINKS_INTERNAL_ERROR" });
  }
}
app.post("/api/admin/battles/:id/links", buildLinksResponse);
app.post("/api/battles/:id/links",      buildLinksResponse);

// -----------------------------------------------
// 소켓
// -----------------------------------------------
io.on("connection", (socket)=>{
  console.log("[SOCKET] Connected:", socket.id);

  socket.on("disconnect", ()=> console.log("[SOCKET] Disconnected:", socket.id));

  socket.on("join", ({ battleId })=>{
    if(!battleId) return;
    socket.join(battleId);
    console.log("[SOCKET] join <-", { battleId, sid: socket.id });
    emitUpdate(battleId);
  });

  socket.on("createBattle", ({ mode }, cb=()=>{})=>{
    const b = makeBattle(String(mode||"2v2"));
    BATTLES.set(b.id, b);
    console.log("[SOCKET] createBattle <-", { mode, sid: socket.id });
    pushLog(b.id, "system", `전투 생성 (${b.mode})`);
    emitUpdate(b.id);
    cb({ ok:true, battleId:b.id, battle: clone(b) });
  });

  socket.on("addPlayer", ({ battleId, name, team, hp, avatar, stats, items }, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    const p = {
      id: "p_"+Math.random().toString(36).slice(2,10),
      name: String(name||"이름"),
      team: (team==="A" ? "A" : "B"),
      hp: Number(hp ?? 100), maxHp: 100,
      avatar: avatar || null,
      stats: {
        attack:  Number(stats?.attack  ?? 1),
        defense: Number(stats?.defense ?? 1),
        agility: Number(stats?.agility ?? 1),
        luck:    Number(stats?.luck    ?? 1),
      },
      items: {
        dittany:        Number(items?.dittany        ?? items?.ditany         ?? 0),
        attackBooster:  Number(items?.attackBooster  ?? items?.attack_boost   ?? 0),
        defenseBooster: Number(items?.defenseBooster ?? items?.defense_boost  ?? 0),
      },
      ready:false, joinedAt: now()
    };
    b.players.push(p);
    pushLog(battleId, "system", `전투 참가자 추가: ${p.name} (${p.team}팀)`);
    emitUpdate(battleId);
    cb({ ok:true, player:p, battle: clone(b) });
  });

  function _removePlayer({ battleId, playerId }, cb=()=>{}){
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false });
    const i = b.players.findIndex(x=>x.id===playerId);
    if(i>=0){
      const [p] = b.players.splice(i,1);
      pushLog(battleId, "system", `전투 참가자 삭제: ${p.name}`);
      emitUpdate(battleId);
      return cb({ ok:true });
    }
    cb({ ok:false });
  }
  socket.on("deletePlayer", _removePlayer);
  socket.on("removePlayer", _removePlayer);

  // 자동 로그인(이름/토큰/ID)
  socket.on("playerAuth", ({ battleId, token, password, otp, playerId, playerName }, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ const e={ ok:false, error:"battle_not_found"}; cb(e); socket.emit("authError", e); return; }

    const t = token || password || otp || "";
    let p = null;
    if(t) p = b.players.find(x=>x.token===t) || null;
    if(!p && playerId)   p = b.players.find(x=>x.id===playerId) || null;
    if(!p && playerName) p = b.players.find(x=>x.name===playerName) || null;

    if(!p){ const e={ ok:false, error:"auth_failed"}; cb(e); socket.emit("authError", e); return; }

    socket.join(battleId);
    socket.battleId = battleId;
    socket.playerId = p.id;
    socket.role     = "player";

    const result = { ok:true, playerId:p.id, name:p.name, team:p.team, avatar:p.avatar, battle: clone(b) };
    socket.emit("authSuccess", result);
    socket.emit("auth:success", result); // 호환
    cb(result);
    pushLog(battleId, "system", `${p.name} 입장`);
    emitUpdate(battleId);
  });

  // 준비 완료(호환 수신)
  function onReady({ battleId, playerId }, cb=()=>{}){
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false });
    const p = b.players.find(x=>x.id===playerId); if(!p) return cb({ ok:false });
    p.ready = true;
    pushLog(battleId, "battle", `${p.name} 준비 완료`);
    emitUpdate(battleId);
    cb({ ok:true });
  }
  socket.on("player:ready", onReady);
  socket.on("playerReady",  onReady);

  // 전투 시작/일시정지/재개/종료
  function decideFirst(b){
    const sum = t=>b.players.filter(p=>p.team===t).reduce((s,p)=>s+(p.stats?.agility||1),0);
    let a = sum("A")+d20(), bb = sum("B")+d20();
    while(a===bb){ a = sum("A")+d20(); bb = sum("B")+d20(); }
    return (a>bb) ? "A" : "B";
  }

  socket.on("startBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false });
    if(b.status!=="waiting" && b.status!=="paused") return cb({ ok:false });

    b.status = "active";
    if(b.currentTurn.turnNumber===0){
      const first = decideFirst(b);
      pushLog(battleId, "battle", `선공 판정: ${first}팀`);
      b.currentTurn.turnNumber = 1;
      startPhase(b, first);
    }else{
      startPhase(b, b.currentTurn.currentTeam || "A");
    }
    emitUpdate(battleId);
    cb({ ok:true });
  });

  socket.on("pauseBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false });
    b.status = "paused"; emitUpdate(battleId); cb({ ok:true });
  });

  socket.on("resumeBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false });
    b.status = "active";
    b.currentTurn.turnDeadline = now() + 5*60*1000;
    emitUpdate(battleId); cb({ ok:true });
  });

  socket.on("endBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); if(!b) return cb({ ok:false });
    b.status = "ended"; emitUpdate(battleId); cb({ ok:true });
  });

  // 행동 수신(호환)
  function onAction({ battleId, playerId, action }, cb=()=>{}){
    const b = BATTLES.get(String(battleId)); if(!b) { cb({ ok:false }); return; }
    if(b.status!=="active"){ cb({ ok:false, error:"NOT_ACTIVE" }); return; }

    if(completeTeamIfTimeout(b)){
      if(b.round.phaseTeam==="A"){
        startPhase(b,"B"); emitUpdate(battleId); cb({ ok:true, timeout:true }); return;
      }else{
        resolveRound(b); emitUpdate(battleId); cb({ ok:true, timeout:true }); return;
      }
    }

    const p = b.players.find(x=>x.id===playerId); if(!p || p.hp<=0){ cb({ ok:false, error:"player_invalid" }); return; }
    if(p.team !== b.round.phaseTeam){ cb({ ok:false, error:"NOT_YOUR_TEAM_TURN" }); return; }
    if(b.currentTurn.currentPlayerId && b.currentTurn.currentPlayerId !== playerId){
      cb({ ok:false, error:"NOT_YOUR_SLOT" }); return;
    }

    const t = String(action?.type||"pass");
    const rec = { type:t };
    if(t==="attack") rec.targetId = String(action?.targetId||"");
    if(t==="item"){
      const it = action?.item;
      if(it==="dittany" || it==="ditany" || it==="attackBooster" || it==="attack_boost" || it==="defenseBooster" || it==="defense_boost"){
        rec.item = it;
        if(it==="dittany" || it==="ditany") rec.targetId = String(action?.targetId||p.id);
      }else{
        rec.item = "unknown";
      }
    }
    b.round.selections[p.team][playerId] = rec;

    b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, p.team);
    hydrateCurrentPlayer(b);

    if(!b.currentTurn.currentPlayerId){
      if(b.round.phaseTeam === "A"){
        startPhase(b,"B");
        pushLog(battleId, "battle", "후공 선택 시작");
      }else{
        resolveRound(b);
      }
    }

    emitUpdate(battleId);
    cb({ ok:true });
  }
  socket.on("player:action", onAction);
  socket.on("playerAction",  onAction);

  // 채팅(단일 이벤트)
  socket.on("chatMessage", ({ battleId, name, message })=>{
    if(!battleId || !message) return;
    io.to(battleId).emit("chatMessage", { name: String(name||"전투 참가자"), message: String(message||"") });
  });

  // 응원(채팅에만)
  socket.on("spectator:cheer", ({ battleId, name, message })=>{
    if(!battleId) return;
    io.to(battleId).emit("chatMessage", { name: String(name||"관전자"), message: `[응원] ${String(message||"")}` });
  });
});

// 기본 라우팅(직접 접근도 허용)
app.get("/",            (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/admin.html",  (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/player.html", (_req,res)=> res.sendFile(path.join(publicDir, "player.html")));
app.get("/spectator.html",(_req,res)=> res.sendFile(path.join(publicDir, "spectator.html")));

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
