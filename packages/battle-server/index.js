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
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "avatars"), { recursive: true });

const app    = express();
const server = http.createServer(app);
const io     = new IOServer(server, {
  path: SOCKET_PATH,
  cors: { origin: "*", methods: ["GET","POST"] },
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
/** 유틸/엔진(규칙 준수: D20, 치명타, 방어/회피/아이템) */
// -----------------------------------------------
const now   = () => Date.now();
const d20   = () => Math.floor(Math.random()*20)+1;
const genId = (p="") => p + Math.random().toString(36).slice(2,8);
const clone = (o) => JSON.parse(JSON.stringify(o));

const BATTLES = new Map(); // battleId -> battle state

const agiOf = (p)=> Number(p?.stats?.agility ?? 1);
const nameOfP = (p)=> String(p?.name ?? "");
const koCmp = (a,b)=> a.localeCompare(b, "ko-KR");

function aliveOfTeam(b, team){
  return (b.players||[]).filter(p => p.team===team && p.hp > 0);
}

// 팀 내부 행동 순서: 민첩 내림차순 → 이름 오름차순(ABC) → 합류시간 오름차순
function teamOrder(b, team){
  return aliveOfTeam(b, team)
    .slice()
    .sort((p, q)=>{
      const d = agiOf(q) - agiOf(p);              // agility desc
      if (d) return d;
      const n = koCmp(nameOfP(p), nameOfP(q));    // name asc
      if (n) return n;
      return (p.joinedAt||0) - (q.joinedAt||0);   // joinedAt asc
    })
    .map(p=>p.id);
}

function makeBattle(mode="2v2"){
  return {
    id: `battle_${genId()}`,
    mode,
    status: "waiting", // waiting|active|paused|ended
    createdAt: now(),
    players: [],
    logs: [],
    currentTurn: {
      turnNumber: 0,
      currentTeam: null,         // "A"|"B"
      currentPlayerId: null,     // 현재 지목된 플레이어 (이 사람만 버튼 활성)
      currentPlayer: null,       // {id, avatar} (옵션)
      turnDeadline: null,        // epoch ms (팀 5분 제한)
    },
    round: {
      firstTeam: null,           // 이번 라운드 선공팀
      aOrder: [], bOrder: [],    // 라운드 내 팀별 순서(생존자만)  ← 민첩/이름 기준
      aIdx: 0,   bIdx: 0,        // 현재 팀 인덱스
      selA: {}, selB: {},        // { playerId: Action }
    }
  };
}

function pushLog(battleId, type, message){
  const b = BATTLES.get(battleId); if(!b) return;
  const entry = { ts: now(), type, message };
  b.logs.push(entry);
  // 브로드캐스트는 1회만(불변)
  io.to(battleId).emit("battle:log", entry);
}

function initiative(b){
  const sumA = aliveOfTeam(b,"A").reduce((s,p)=>s+(p.stats?.agility||1),0);
  const sumB = aliveOfTeam(b,"B").reduce((s,p)=>s+(p.stats?.agility||1),0);
  const rA = d20(), rB = d20();
  let first;
  if (sumA+rA > sumB+rB) first = "A";
  else if (sumA+rA < sumB+rB) first = "B";
  else first = (d20() >= d20()) ? "A" : "B";
  pushLog(b.id, "battle", `선공 판정: A팀(${sumA}+D20=${rA}) / B팀(${sumB}+D20=${rB}) → 선공: ${first}팀`);
  return first;
}

function setCurrentPlayerMeta(b){
  const pid = b.currentTurn.currentPlayerId;
  const p = b.players.find(x=>x.id===pid);
  b.currentTurn.currentPlayer = p ? { id:p.id, avatar: p.avatar || null } : null;
}

function setDeadline(b){
  b.currentTurn.turnDeadline = now() + 5*60*1000; // 팀 제한 5분
}

function snapshot(battleId){
  const b = BATTLES.get(battleId);
  if(!b) return null;
  const snap = clone(b);
  const dl = b.currentTurn?.turnDeadline || null;
  snap.currentTurn = snap.currentTurn || {};
  snap.currentTurn.timeLeftSec = dl ? Math.max(0, Math.floor((dl - now())/1000)) : null;
  return snap;
}
function emitUpdate(battleId){
  const snap = snapshot(battleId);
  if(!snap) return;
  io.to(battleId).emit("battleUpdate", snap); // emit은 한 번
}

// -----------------------------------------------
// 라운드/턴 흐름 제어
// -----------------------------------------------
function startRound(b, firstTeam){
  b.round.firstTeam = firstTeam;
  b.round.aOrder = teamOrder(b,"A");
  b.round.bOrder = teamOrder(b,"B");
  b.round.aIdx = 0; b.round.bIdx = 0;
  b.round.selA = {}; b.round.selB = {};

  b.currentTurn.turnNumber = (b.currentTurn.turnNumber||0) + 1;
  b.currentTurn.currentTeam = firstTeam;

  const order = firstTeam==="A" ? b.round.aOrder : b.round.bOrder;
  b.currentTurn.currentPlayerId = order[0] || null;
  setCurrentPlayerMeta(b);
  setDeadline(b);
}

function advanceWithinTeam(b){
  const team = b.currentTurn.currentTeam;
  const isA = (team==="A");
  const order = isA ? b.round.aOrder : b.round.bOrder;
  let idx = isA ? b.round.aIdx : b.round.bIdx;

  // 다음 인원 탐색
  idx++;
  while (idx < order.length) {
    const pid = order[idx];
    const pl = b.players.find(x=>x.id===pid && x.hp>0);
    const sel = (isA ? b.round.selA : b.round.selB)[pid];
    if (pl && !sel) break;
    idx++;
  }

  if (isA) b.round.aIdx = idx; else b.round.bIdx = idx;

  if (idx >= order.length) {
    // 팀 선택 종료
    return false;
  } else {
    b.currentTurn.currentPlayerId = order[idx];
    setCurrentPlayerMeta(b);
    return true;
  }
}

function switchTeamOrResolve(battleId){
  const b = BATTLES.get(battleId); if(!b) return;

  const firstTeam = b.round.firstTeam;
  const otherTeam = firstTeam==="A" ? "B" : "A";

  if (b.currentTurn.currentTeam === firstTeam) {
    // 후공 팀 선택 시작
    b.currentTurn.currentTeam = otherTeam;
    const order = otherTeam==="A" ? b.round.aOrder : b.round.bOrder;
    let idx = 0;
    while (idx < order.length) {
      const pid = order[idx];
      const pl = b.players.find(x=>x.id===pid && x.hp>0);
      const sel = (otherTeam==="A" ? b.round.selA : b.round.selB)[pid];
      if (pl && !sel) break;
      idx++;
    }
    if (otherTeam==="A") b.round.aIdx = idx; else b.round.bIdx = idx;
    b.currentTurn.currentPlayerId = order[idx] || null;
    setCurrentPlayerMeta(b);
    setDeadline(b);
    emitUpdate(battleId);
  } else {
    // 양 팀 모두 선택 완료 → 라운드 해석/적용
    resolveRound(battleId);
  }
}

function resolveRound(battleId){
  const b = BATTLES.get(battleId); if(!b) return;

  // 승리/전멸 체크
  const aliveA = aliveOfTeam(b,"A");
  const aliveB = aliveOfTeam(b,"B");
  if (aliveA.length===0 || aliveB.length===0) {
    b.status = "ended";
    pushLog(battleId, "battle", aliveA.length===0 ? "B팀 승리 (A팀 전멸)" : "A팀 승리 (B팀 전멸)");
    emitUpdate(battleId);
    return;
  }

  // === 동시해석(요청 반영) ===
  // 1) 순서: 팀 내부는 민첩 내림차순 → 이름 ABC, 팀 간은 선공 → 후공
  const firstTeam = b.round.firstTeam;
  const secondTeam = firstTeam==="A" ? "B" : "A";
  const orderFirst  = firstTeam==="A" ? b.round.aOrder : b.round.bOrder;
  const orderSecond = secondTeam==="A" ? b.round.aOrder : b.round.bOrder;

  // 시작 시점 상태 스냅샷
  const startHP  = Object.fromEntries(b.players.map(p=>[p.id, p.hp]));
  const agility  = (id)=> (b.players.find(x=>x.id===id)?.stats?.agility||1);
  const attack   = (id)=> (b.players.find(x=>x.id===id)?.stats?.attack||1);
  const defense  = (id)=> (b.players.find(x=>x.id===id)?.stats?.defense||1);
  const luck     = (id)=> (b.players.find(x=>x.id===id)?.stats?.luck||1);
  const nameOf   = (id)=> (b.players.find(x=>x.id===id)?.name || id);
  const teamOf   = (id)=> (b.players.find(x=>x.id===id)?.team || "?");

  const selA = b.round.selA, selB = b.round.selB;
  const selOf = (id)=> (teamOf(id)==="A" ? selA[id] : selB[id]) || { type:"pass" };

  // 방어/회피/보정/치유 준비
  const defended = new Set();
  const dodgeSet = new Set();
  const defBoost = new Set(); // 방어 보정 성공자
  const atkBoost = new Set(); // 공격 보정 성공자
  const heals = {};           // { pid: +heal } (치유는 나중에 적용)

  // 2) 방어/회피/아이템 소비 및 성공 판정
  for (const p of b.players) {
    if (p.hp<=0) continue;
    const s = selOf(p.id);
    if (s.type==="defend")   defended.add(p.id);
    if (s.type==="dodge")    dodgeSet.add(p.id);
    if (s.type==="item") {
      if (s.item==="defenseBooster" || s.item==="defense_boost") {
        if (Math.random() < 0.10) defBoost.add(p.id);      // 10% 성공
        if (p.items?.defenseBooster>0) p.items.defenseBooster--;
        else if (p.items?.defense_boost>0) p.items.defense_boost--;
      }
      if (s.item==="attackBooster" || s.item==="attack_boost") {
        if (Math.random() < 0.10) atkBoost.add(p.id);
        if (p.items?.attackBooster>0) p.items.attackBooster--;
        else if (p.items?.attack_boost>0) p.items.attack_boost--;
      }
      if (s.item==="dittany" || s.item==="ditany") {
        const tgt = s.targetId || p.id; // 대상 없으면 자기
        heals[tgt] = (heals[tgt]||0) + 10; // 100% +10 (치유는 “피해 이후” 적용)
        if (p.items?.dittany>0) p.items.dittany--;
        else if (p.items?.ditany>0) p.items.ditany--;
      }
    }
  }

  // 3) 피해 누적 계산
  const damage = {}; // { targetId: +dmg }

  function applyAttack(fromId, action, phaseLabel){
    if (!action || action.type!=="attack") return;
    const tgt = action.targetId;
    if (!tgt) return;
    if ((startHP[fromId]||0)<=0 || (startHP[tgt]||0)<=0) return; // 전투불능/타깃 사망 시 무시

    const atkRoll = attack(fromId) + d20();

    // 회피: 민첩 + D20 비교
    if (dodgeSet.has(tgt)){
      const dodgeRoll = agility(tgt) + d20();
      if (dodgeRoll > atkRoll) {
        pushLog(battleId, "battle", `${phaseLabel} ${nameOf(fromId)}이(가) ${nameOf(tgt)}의 회피로 빗나감`);
        return;
      }
    }

    // 피해 산정
    const baseAtk = (attack(fromId) + d20());
    let defTerm = defense(tgt);
    if (defended.has(tgt)) defTerm += d20();   // 방어태세
    if (defBoost.has(tgt)) defTerm *= 2;       // 방어 보정 성공 시 2배
    let dmg = Math.max(1, baseAtk - defTerm);

    // 치명타: 20 - 행운/2
    const critThreshold = Math.max(1, 20 - Math.floor(luck(fromId)/2));
    const critRoll = d20();
    if (critRoll >= critThreshold) dmg *= 2;

    if (atkBoost.has(fromId)) dmg *= 2;        // 공격 보정 성공 시 2배

    damage[tgt] = (damage[tgt]||0) + dmg;

    // 해설 로그(요청: “선공/후공 X이(가) Y에게 공격”)
    pushLog(battleId, "battle", `${phaseLabel} ${nameOf(fromId)}이(가) ${nameOf(tgt)}에게 공격`);
  }

  // 선공팀 → 후공팀, 각 팀 내부는 민첩/이름 순서로 처리
  for (const pid of orderFirst)  applyAttack(pid, selOf(pid),  "선공");
  for (const pid of orderSecond) applyAttack(pid, selOf(pid), "후공");

  // 4) “피해 → 치유” 순서로 일괄 적용 (요청 반영)
  for (const [pid, dmg] of Object.entries(damage)) {
    const p = b.players.find(x=>x.id===pid); if(!p) continue;
    p.hp = Math.max(0, (p.hp||0) - dmg);
  }
  for (const [pid, heal] of Object.entries(heals)) {
    const p = b.players.find(x=>x.id===pid); if(!p) continue;
    p.hp = Math.min(p.maxHp||100, (p.hp||0) + heal);
  }

  // 라운드 종료 중계
  pushLog(battleId, "battle", `라운드 ${b.currentTurn.turnNumber} 종료`);
  emitUpdate(battleId);

  // 전멸/종료 체크
  const aAlive = aliveOfTeam(b,"A").length;
  const bAlive = aliveOfTeam(b,"B").length;
  if (aAlive===0 || bAlive===0) {
    b.status = "ended";
    pushLog(battleId, "battle", aAlive===0 ? "B팀 승리 (A팀 전멸)" : "A팀 승리 (B팀 전멸)");
    emitUpdate(battleId);
    return;
  }

  // 다음 라운드: 선/후공 교대
  const nextFirst = (firstTeam==="A") ? "B" : "A";
  startRound(b, nextFirst);
  emitUpdate(battleId);
}

// 자동 패스(팀 제한 5분 초과 시)
function autopassCurrentTeam(battleId){
  const b = BATTLES.get(battleId); if(!b) return;
  if (b.status!=="active") return;
  const team = b.currentTurn.currentTeam;
  const order = team==="A" ? b.round.aOrder : b.round.bOrder;
  const sel   = team==="A" ? b.round.selA   : b.round.selB;

  for (const pid of order) {
    const pl = b.players.find(x=>x.id===pid && x.hp>0);
    if (pl && !sel[pid]) sel[pid] = { type:"pass" };
  }
  // 팀 종료 처리
  switchTeamOrResolve(battleId);
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
// -----------------------------------------------
function makeOtp(len=6){ return Array.from({length:len}, ()=>Math.floor(Math.random()*10)).join(""); }
function baseUrlFrom(req){ return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`; }

async function buildLinksResponse(req, res){
  try{
    const battleId = req.params.id;
    const b = BATTLES.get(battleId);
    if(!b) return res.status(404).json({ ok:false, error:"BATTLE_NOT_FOUND" });
    const base = baseUrlFrom(req);

    // 관전자 OTP/URL (유지)
    if(!b.spectator) b.spectator = {};
    if(!b.spectator.otp) b.spectator.otp = makeOtp();
    const spectatorOtp = b.spectator.otp;
    const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(spectatorOtp)}`;

    // 전투 참가자 링크
    const players = (b.players||[]).map(p=>{
      if(!p.token) p.token = makeOtp();
      const url = `${base}/player?battle=${encodeURIComponent(battleId)}&playerId=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}&team=${p.team}&token=${encodeURIComponent(p.token)}`;
      return { playerId:p.id, name:p.name, team:p.team, token:p.token, url };
    });

    const payload = {
      ok: true,
      spectator: { otp: spectatorOtp, url: spectatorUrl },
      players,
      // 호환 키
      spectatorOtp, spectatorUrl,
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
    socket.join(battleId);
    const snap = snapshot(battleId);
    if(snap) socket.emit("battleUpdate", snap);
  });

  // 전투 생성 (소켓)
  socket.on("createBattle", ({ mode }, cb=()=>{})=>{
    const b = makeBattle(mode || "2v2");
    BATTLES.set(b.id, b);
    pushLog(b.id, "system", `전투 생성 (${b.mode})`);
    cb({ ok:true, id:b.id, battleId:b.id, battle: snapshot(b.id) });
  });

  // 참가자 추가/삭제
  socket.on("addPlayer", (payload, cb=()=>{})=>{
    const { battleId, name, team, hp, avatar, stats, items } = payload||{};
    const b = BATTLES.get(battleId);
    if(!b) return cb({ ok:false, error:"BATTLE_NOT_FOUND" });
    const p = {
      id: `p_${genId()}`,
      name: String(name || "무명"),
      team: (team==="A" ? "A" : "B"),
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
      ready:false,
      joinedAt: now(),
    };
    b.players.push(p);
    pushLog(battleId, "admin", `전투 참가자 추가: ${p.name} (${p.team}팀)`);
    emitUpdate(battleId);
    cb({ ok:true, player:p });
  });

  function _removePlayer({ battleId, playerId }, cb=()=>{}){
    const b = BATTLES.get(battleId);
    if(!b) return cb({ ok:false });
    const idx = b.players.findIndex(p=>p.id===playerId);
    const nm  = idx>=0 ? b.players[idx].name : playerId;
    if(idx>=0) b.players.splice(idx,1);
    pushLog(battleId, "admin", `전투 참가자 제거: ${nm}`);
    emitUpdate(battleId);
    cb({ ok:true });
  }
  socket.on("deletePlayer", _removePlayer);
  socket.on("removePlayer", _removePlayer); // 호환

  // 인증(전투 참가자 자동 로그인)
  socket.on("playerAuth", ({ battleId, token, password, otp, playerId, playerName }, cb=()=>{})=>{
    const b = BATTLES.get(battleId);
    if(!b){ cb({ ok:false, error:"BATTLE_NOT_FOUND" }); socket.emit("authError",{ ok:false }); return; }
    const t = token || password || otp;
    let p = null;
    if (t) p = b.players.find(x=>x.token===t) || null;
    if (!p && playerId)   p = b.players.find(x=>x.id===playerId) || null;
    if (!p && playerName) p = b.players.find(x=>x.name===playerName) || null;
    if(!p){ cb({ ok:false, error:"AUTH_FAILED" }); socket.emit("authError",{ ok:false }); return; }

    socket.join(battleId);
    socket.battleId = battleId;
    socket.playerId = p.id;
    socket.role     = "player";

    const result = { ok:true, playerId:p.id, name:p.name, team:p.team, avatar:p.avatar, battle: snapshot(battleId) };
    socket.emit("authSuccess", result);
    socket.emit("auth:success", result); // 호환
    cb(result);

    pushLog(battleId, "system", `${p.name} 입장`);
    emitUpdate(battleId);
  });

  // 준비 완료(서버는 player:ready/playerReady 둘 다 수신)
  function onReady({ battleId, playerId }, cb=()=>{}){
    const b = BATTLES.get(battleId); if(!b) return cb({ ok:false });
    const p = b.players.find(x=>x.id===playerId); if(!p) return cb({ ok:false });
    p.ready = true;
    pushLog(battleId, "battle", `${p.name} 준비 완료`);
    emitUpdate(battleId);
    cb({ ok:true });
  }
  socket.on("player:ready", onReady);
  socket.on("playerReady",  onReady); // 호환

  // 전투 제어
  socket.on("startBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(battleId); if(!b) return cb({ ok:false });
    if(b.status!=="waiting" && b.status!=="paused") return cb({ ok:false });
    if(aliveOfTeam(b,"A").length===0 || aliveOfTeam(b,"B").length===0) return cb({ ok:false });

    b.status = "active";
    const first = initiative(b);
    startRound(b, first);
    emitUpdate(battleId);
    cb({ ok:true });
  });
  socket.on("pauseBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(battleId); if(!b) return cb({ ok:false });
    b.status = "paused"; emitUpdate(battleId); cb({ ok:true });
  });
  socket.on("resumeBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(battleId); if(!b) return cb({ ok:false });
    b.status = "active"; b.currentTurn.turnDeadline = now()+5*60*1000; emitUpdate(battleId); cb({ ok:true });
  });
  socket.on("endBattle", ({ battleId }, cb=()=>{})=>{
    const b = BATTLES.get(battleId); if(!b) return cb({ ok:false });
    b.status = "ended"; emitUpdate(battleId); cb({ ok:true });
  });

  // 행동(이번 라운드 선택만 누적; 즉시 피해 X)
  function onAction({ battleId, playerId, action }, cb=()=>{}){
    const b = BATTLES.get(battleId); if(!b) { cb({ ok:false }); return; }
    if(b.status!=="active"){ cb({ ok:false, error:"NOT_ACTIVE" }); return; }

    // 내 차례(현재 지목된 사람)만 허용
    if (b.currentTurn.currentPlayerId !== playerId) { cb({ ok:false, error:"NOT_YOUR_TURN" }); return; }

    const p = b.players.find(x=>x.id===playerId && x.hp>0);
    if(!p){ cb({ ok:false }); return; }

    const box  = (p.team==="A") ? b.round.selA : b.round.selB;
    box[playerId] = {
      type: String(action?.type||"pass"),
      item: action?.item || undefined,
      targetId: action?.targetId || undefined,
    };

    const hasNext = advanceWithinTeam(b);
    if (!hasNext) {
      switchTeamOrResolve(battleId);
    } else {
      setDeadline(b);
      emitUpdate(battleId);
    }

    cb({ ok:true });
    socket.emit("actionSuccess", { ok:true }); // 호환 이벤트 유지
  }
  socket.on("player:action", onAction);
  socket.on("playerAction",  onAction); // 호환

  // 채팅(보낼 때는 chatMessage 단일, 브로드캐스트도 단일)
  socket.on("chatMessage", ({ battleId, name, message })=>{
    if(!battleId || !message) return;
    io.to(battleId).emit("chatMessage", { name: name || "익명", message: String(message).slice(0,500) });
  });

  // 관전자 응원(채팅에만, 로그 X)
  socket.on("spectator:cheer", ({ battleId, name, message })=>{
    if(!battleId) return;
    io.to(battleId).emit("chatMessage", { name: name || "관전자", message: `[응원] ${String(message||"").slice(0,200)}` });
  });
});

// -----------------------------------------------
// 엔진 틱: 팀 제한 시간 초과 시 자동 패스 처리
// -----------------------------------------------
setInterval(()=>{
  for (const [id, b] of BATTLES.entries()){
    if (b.status!=="active") continue;
    const dl = b.currentTurn?.turnDeadline;
    if (dl && now() >= dl) {
      autopassCurrentTeam(id);
    }
  }
}, 1000);

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
