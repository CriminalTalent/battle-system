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
const rootDir    = path.resolve(__dirname);
const publicDir  = path.join(rootDir, "public");
const uploadsDir = path.join(rootDir, "uploads");
const PORT       = Number(process.env.PORT || 3001);
const HOST       = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = "/socket.io";

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

// SPA 엔드포인트(불변) - 정적 파일보다 먼저
app.get("/admin",     (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/player",    (_req,res)=> res.sendFile(path.join(publicDir, "player.html")));
app.get("/spectator", (_req,res)=> res.sendFile(path.join(publicDir, "spectator.html")));

// 정적 파일 제공 - SPA 라우트 이후에 배치
app.use("/", express.static(publicDir));

// 헬스체크(불변)
app.get("/api/health", (_req,res)=> res.json({ ok:true, status:"healthy" }));

// -----------------------------------------------
// 유틸/상태 - D10으로 변경
// -----------------------------------------------
const now   = () => Date.now();
const d10   = () => Math.floor(Math.random()*10)+1;  // D20 → D10
const clone = (o) => JSON.parse(JSON.stringify(o));
const BATTLES = new Map();
const ROUND_TIMERS = new Map();

const byAgilityThenName = (a,b)=>{
  const ag = (b.stats?.agility||1) - (a.stats?.agility||1);
  if (ag !== 0) return ag;
  return String(a.name||"").localeCompare(String(b.name||""), "ko-KR");
};
const firstAliveOrder = (b,team)=> b.players.filter(p=>p.team===team && p.hp>0).sort(byAgilityThenName).map(p=>p.id);
const nextUnactedPlayerId = (b,team)=>{
  const ord = firstAliveOrder(b,team);
  for(const pid of ord){
    if(!(pid in b.round.selections[team])) return pid;
  }
  return null;
};

function hydrateCurrentPlayer(b){
  if(!b.currentTurn.currentPlayerId){ b.currentTurn.currentPlayer=null; return; }
  const cur = b.players.find(x=>x.id===b.currentTurn.currentPlayerId);
  if(cur) b.currentTurn.currentPlayer = { id:cur.id, name:cur.name, avatar:cur.avatar||null, team:cur.team };
  else b.currentTurn.currentPlayer=null;
}

function completeTeamIfTimeout(b){
  const elapsed = now() - (b.currentTurn.turnDeadline - 5*60*1000);
  if(elapsed < 5*60*1000) return false;
  // 타임아웃: 미행동 참가자는 패스 처리
  const team = b.round.phaseTeam;
  const ord = firstAliveOrder(b,team);
  for(const pid of ord){
    if(!(pid in b.round.selections[team])){
      b.round.selections[team][pid] = { type:"pass" };
    }
  }
  return true;
}

function startPhase(b,team){
  b.round.phaseTeam = team;
  b.currentTurn.currentTeam = team;
  b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, team);
  hydrateCurrentPlayer(b);
  b.currentTurn.turnDeadline = now() + 5*60*1000;
}

function pushLog(battleId, typ, msg, data){
  const b = BATTLES.get(battleId); if(!b) return;
  const log = { ts: now(), type: typ||"info", message: String(msg||"") };
  if(data) log.data=data;
  b.logs.push(log);
  if(b.logs.length>500) b.logs.shift();
  io.to(battleId).emit("battle:log", log);  // 하나만 emit
}

function emitUpdate(battleId){
  const b = BATTLES.get(battleId);
  if(!b) return;
  
  // 스냅샷 구성 - 데이터 계약 준수
  const snap = {
    id: b.id,
    mode: b.mode,
    status: b.status,
    createdAt: b.createdAt,
    players: b.players.map(p => {
      const items = {};
      items.dittany = p.items?.dittany || p.items?.ditany || 0;
      items.ditany = items.dittany; // 호환
      items.attackBooster = p.items?.attackBooster || p.items?.attack_boost || 0;
      items.attack_boost = items.attackBooster; // 호환
      items.defenseBooster = p.items?.defenseBooster || p.items?.defense_boost || 0;
      items.defense_boost = items.defenseBooster; // 호환
      
      return {
        id: p.id,
        name: p.name,
        team: p.team,
        hp: p.hp || 0,
        maxHp: p.maxHp || 100,
        stats: p.stats || {attack:1,defense:1,agility:1,luck:1},
        items: items,
        avatar: p.avatar || null,
        ready: p.ready || false,
        joinedAt: p.joinedAt
      };
    }),
    currentTurn: {
      turnNumber: b.currentTurn?.turnNumber || 1,
      currentTeam: b.currentTurn?.currentTeam || "A",
      currentPlayer: b.currentTurn?.currentPlayer || null,
      timeLeftSec: Math.max(0, Math.floor((b.currentTurn?.turnDeadline - now())/1000))
    },
    logs: b.logs.slice(-100) // 최근 100개만
  };
  
  io.to(battleId).emit("battleUpdate", snap);
  io.to(battleId).emit("battle:update", snap);
}

function startNextRound(battleId){
  const b = BATTLES.get(battleId);
  if(!b || b.status !== "active") return;
  
  // 승리 조건 체크
  const aliveA = b.players.filter(p=>p.team==="A" && p.hp>0).length;
  const aliveB = b.players.filter(p=>p.team==="B" && p.hp>0).length;
  
  if(aliveA === 0 || aliveB === 0){
    b.status = "ended";
    const winner = aliveA > 0 ? "A팀" : "B팀";
    pushLog(battleId, "battle", `전투 종료 - ${winner} 승리!`);
    emitUpdate(battleId);
    return;
  }
  
  if(b.currentTurn.turnNumber >= 100){
    b.status = "ended";
    const hpA = b.players.filter(p=>p.team==="A").reduce((sum,p)=>sum+(p.hp||0), 0);
    const hpB = b.players.filter(p=>p.team==="B").reduce((sum,p)=>sum+(p.hp||0), 0);
    const winner = hpA > hpB ? "A팀" : hpA < hpB ? "B팀" : "무승부";
    pushLog(battleId, "battle", `최대 턴 도달 - ${winner}`);
    emitUpdate(battleId);
    return;
  }
  
  // 다음 라운드 시작
  b.currentTurn.turnNumber++;
  
  // 홀수 라운드: 첫 선공팀, 짝수 라운드: 반대팀
  const nextTeam = (b.currentTurn.turnNumber % 2 === 1) ? b.firstTeam : (b.firstTeam === "A" ? "B" : "A");
  
  pushLog(battleId, "battle", `${b.currentTurn.turnNumber}라운드 시작 - ${nextTeam}팀 선공`);
  
  b.round = {
    phaseTeam: nextTeam,
    selections: { A:{}, B:{} },
    order: { A: firstAliveOrder(b,"A"), B: firstAliveOrder(b,"B") },
    defendToken: {}, dodgeToken: {}, 
    attackBoosters: {}, // 공격 보정기 추적
    defenseBoosters: {} // 방어 보정기 추적
  };
  
  b.currentTurn.currentTeam = nextTeam;
  b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, nextTeam);
  hydrateCurrentPlayer(b);
  b.currentTurn.turnDeadline = now() + 5*60*1000;
  
  emitUpdate(battleId);
}

function resolveRound(b){
  const battleId = b.id;
  
  // 라운드 시작 선언
  pushLog(battleId, "battle", `${b.currentTurn.turnNumber}라운드 결과 처리 시작`);
  
  b.round.defendToken = b.round.defendToken || {};
  b.round.dodgeToken  = b.round.dodgeToken || {};
  b.round.attackBoosters = b.round.attackBoosters || {};
  b.round.defenseBoosters = b.round.defenseBoosters || {};
  
  const byId = Object.fromEntries(b.players.map(p=>[p.id,p]));
  const seq = (team)=> (b.round.order[team]||[]).map(pid => ({ pid, sel: b.round.selections[team][pid] || {type:"pass"} }));

  const attacks = [];
  const heals   = [];
  const deadPlayers = new Set(); // 사망자 추적
  
  // 1단계: A팀 행동 수집 및 로깅
  pushLog(battleId, "battle", "=== A팀 행동 ===");
  let aTeamHasAction = false;
  for(const {pid, sel} of seq("A")){
    if(!sel) continue;
    const me = byId[pid]; 
    if(!me || me.hp<=0) continue;
    
    if(sel.type==="attack"){
      const target = byId[sel.targetId];
      if(target) {
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}을(를) 공격`);
        aTeamHasAction = true;
      }
      attacks.push({ attacker: me, target: target || null, side: "A" });
    }else if(sel.type==="defend"){
      pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 태세`);
      b.round.defendToken[pid] = true;
      aTeamHasAction = true;
    }else if(sel.type==="dodge"){
      pushLog(battleId, "battle", `→ ${me.name}이(가) 회피 태세`);
      b.round.dodgeToken[pid] = true;
      aTeamHasAction = true;
    }else if(sel.type==="item"){
      if(sel.item==="dittany" || sel.item==="ditany"){
        const target = byId[sel.targetId] || me;
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}에게 디터니 사용`);
        heals.push({ who: me, target: target });
        aTeamHasAction = true;
      }else if(sel.item==="attackBooster" || sel.item==="attack_boost"){
        const success = d10() === 10; // 10% 확률
        if(success){
          b.round.attackBoosters[pid] = sel.targetId;
          const target = byId[sel.targetId];
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 성공! (대상: ${target?.name})`);
        }else{
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 실패`);
        }
        if(me.items.attackBooster > 0) me.items.attackBooster--;
        if(me.items.attack_boost > 0) me.items.attack_boost--;
        aTeamHasAction = true;
      }else if(sel.item==="defenseBooster" || sel.item==="defense_boost"){
        const success = d10() === 10; // 10% 확률
        const target = byId[sel.targetId];
        if(success){
          b.round.defenseBoosters[sel.targetId] = true;
          pushLog(battleId, "battle", `→ ${me.name}이(가) ${target?.name}에게 방어 보정기 사용 성공!`);
        }else{
          pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 보정기 사용 실패`);
        }
        if(me.items.defenseBooster > 0) me.items.defenseBooster--;
        if(me.items.defense_boost > 0) me.items.defense_boost--;
        aTeamHasAction = true;
      }
    }else if(sel.type==="pass"){
      pushLog(battleId, "battle", `→ ${me.name}이(가) 행동 패스`);
      aTeamHasAction = true;
    }
  }
  
  if(!aTeamHasAction) {
    pushLog(battleId, "battle", "→ A팀 행동 없음");
  }
  pushLog(battleId, "battle", "A팀 선택 완료");
  
  // B팀 행동 수집 및 로깅
  pushLog(battleId, "battle", "=== B팀 행동 ===");
  let bTeamHasAction = false;
  for(const {pid, sel} of seq("B")){
    if(!sel) continue;
    const me = byId[pid]; 
    if(!me || me.hp<=0) continue;
    
    if(sel.type==="attack"){
      const target = byId[sel.targetId];
      if(target) {
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}을(를) 공격`);
        bTeamHasAction = true;
      }
      attacks.push({ attacker: me, target: target || null, side: "B" });
    }else if(sel.type==="defend"){
      pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 태세`);
      b.round.defendToken[pid] = true;
      bTeamHasAction = true;
    }else if(sel.type==="dodge"){
      pushLog(battleId, "battle", `→ ${me.name}이(가) 회피 태세`);
      b.round.dodgeToken[pid] = true;
      bTeamHasAction = true;
    }else if(sel.type==="item"){
      if(sel.item==="dittany" || sel.item==="ditany"){
        const target = byId[sel.targetId] || me;
        pushLog(battleId, "battle", `→ ${me.name}이(가) ${target.name}에게 디터니 사용`);
        heals.push({ who: me, target: target });
        bTeamHasAction = true;
      }else if(sel.item==="attackBooster" || sel.item==="attack_boost"){
        const success = d10() === 10; // 10% 확률
        if(success){
          b.round.attackBoosters[pid] = sel.targetId;
          const target = byId[sel.targetId];
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 성공! (대상: ${target?.name})`);
        }else{
          pushLog(battleId, "battle", `→ ${me.name}이(가) 공격 보정기 사용 실패`);
        }
        if(me.items.attackBooster > 0) me.items.attackBooster--;
        if(me.items.attack_boost > 0) me.items.attack_boost--;
        bTeamHasAction = true;
      }else if(sel.item==="defenseBooster" || sel.item==="defense_boost"){
        const success = d10() === 10; // 10% 확률
        const target = byId[sel.targetId];
        if(success){
          b.round.defenseBoosters[sel.targetId] = true;
          pushLog(battleId, "battle", `→ ${me.name}이(가) ${target?.name}에게 방어 보정기 사용 성공!`);
        }else{
          pushLog(battleId, "battle", `→ ${me.name}이(가) 방어 보정기 사용 실패`);
        }
        if(me.items.defenseBooster > 0) me.items.defenseBooster--;
        if(me.items.defense_boost > 0) me.items.defense_boost--;
        bTeamHasAction = true;
      }
    }else if(sel.type==="pass"){
      pushLog(battleId, "battle", `→ ${me.name}이(가) 행동 패스`);
      bTeamHasAction = true;
    }
  }
  
  if(!bTeamHasAction) {
    pushLog(battleId, "battle", "→ B팀 행동 없음");
  }
  pushLog(battleId, "battle", "B팀 선택 완료");
  
  // 2단계: 결과 계산 로그
  pushLog(battleId, "battle", "=== 라운드 결과 ===");
  
  // 공격 처리 (즉시 사망 처리)
  if(attacks.length === 0) {
    pushLog(battleId, "battle", "→ 공격 없음");
  } else {
    for(const act of attacks){
      const a = act.attacker, t = act.target;
      if(!t || a.hp<=0 || t.hp<=0 || deadPlayers.has(t.id)) continue;
      
      let atkRoll = (a.stats?.attack||1) + d10();
      
      // 공격 보정기 확인
      let boosted = false;
      if(b.round.attackBoosters[a.id] === t.id){
        atkRoll *= 2;
        boosted = true;
      }
      
      const tgtDodgeBase = (t.stats?.agility||1);
      const dodgeBonus = b.round.dodgeToken[t.id] ? d10() : 0;
      const dodgeRoll = tgtDodgeBase + d10() + (dodgeBonus>0 ? d10() : 0);

      if(dodgeRoll >= atkRoll){
        pushLog(battleId, "battle", `→ ${a.name}의 ${boosted?'강화된 ':''}공격이 ${t.name}에게 빗나감 (HP ${t.hp})`);
        continue;
      }

      let defRoll = (t.stats?.defense||1) + d10();
      if(b.round.defendToken[t.id]){
        defRoll += d10();
      }
      
      // 방어 보정기 확인
      if(b.round.defenseBoosters[t.id]){
        defRoll *= 2;
      }

      const dmg = Math.max(0, atkRoll - defRoll);
      
      // 치명타 확률 D10 기반
      const critRoll = d10();
      const critThreshold = 10 - Math.floor((a.stats?.luck||1)/2);
      const isCrit = critRoll >= critThreshold;
      const finalDmg = isCrit ? dmg*2 : dmg;

      t.hp = Math.max(0, t.hp - finalDmg);
      
      // 즉시 사망 처리
      if(t.hp === 0){
        deadPlayers.add(t.id);
        pushLog(battleId, "battle", `→ ${a.name}의 ${boosted?'강화된 ':''}${isCrit?"치명타 ":""}공격으로 ${t.name} 사망! (피해 ${finalDmg})`);
      }else{
        pushLog(battleId, "battle", `→ ${a.name}이(가) ${t.name}에게 ${boosted?'강화된 ':''}${isCrit?"치명타 ":""}공격 (피해 ${finalDmg}) → HP ${t.hp}`);
      }
    }
  }

  // 치유 처리 (사망자는 무효)
  if(heals.length === 0) {
    pushLog(battleId, "battle", "→ 치유 없음");
  } else {
    for(const h of heals){
      const t = h.target;
      if(!t || deadPlayers.has(t.id)){
        pushLog(battleId, "battle", `→ ${h.who.name}의 ${t?.name}에게 디터니 사용 실패 (사망자)`);
        // 아이템 소모
        if(h.who.items.dittany > 0) h.who.items.dittany--;
        if(h.who.items.ditany > 0) h.who.items.ditany--;
        continue;
      }
      
      const before = t.hp;
      t.hp = Math.min(t.maxHp || 100, t.hp + 10);
      pushLog(battleId, "battle", `→ ${h.who.name}이(가) ${t.name} 치유 (+${t.hp - before}) → HP ${t.hp}`);
      
      // 아이템 소모
      if(h.who.items.dittany > 0) h.who.items.dittany--;
      if(h.who.items.ditany > 0) h.who.items.ditany--;
    }
  }
  
  pushLog(battleId, "battle", `${b.currentTurn.turnNumber}라운드 종료`);

  // 5초 후 다음 라운드
  pushLog(battleId, "battle", "5초 후 다음 라운드 시작...");
  setTimeout(()=> {
    startNextRound(battleId);
  }, 5000);
} 0) h.who.items.ditany--;
  }

  // 4단계: 모든 결과 로그 출력
  for(const l of dmgLogs) pushLog(battleId, "battle", l);
  for(const l of healLogs) pushLog(battleId, "battle", l);
  
  pushLog(battleId, "battle", `${b.currentTurn.turnNumber}라운드 종료`);

  // 5초 후 다음 라운드
  pushLog(battleId, "battle", "5초 후 다음 라운드 시작...");
  setTimeout(()=> {
    startNextRound(battleId);
  }, 5000);
}
}

// -----------------------------------------------
// HTTP 라우트
// -----------------------------------------------
app.post("/api/battles", (req,res)=>{
  const mode = req.body?.mode || "2v2";
  const battleId = `battle_${Math.random().toString(36).slice(2,10)}`;
  const snap = {
    id: battleId, mode, status:"waiting", createdAt: now(),
    players:[], logs:[], otp: new Set(), tokens: new Map(),
    currentTurn:{ turnNumber:1, currentTeam:"A", currentPlayer:null },
    round:{ phaseTeam:"A", selections:{A:{},B:{}}, order:{A:[],B:[]}, defendToken:{}, dodgeToken:{} }
  };
  BATTLES.set(battleId, snap);
  pushLog(battleId, "system", `전투 생성됨: ${mode}`);
  res.json({ ok:true, battleId, battle:snap });
});

app.post("/api/admin/battles/:id/links", (req,res)=>{
  const battleId = req.params.id;
  const b = BATTLES.get(battleId);
  if(!b) return res.status(404).json({ok:false, error:"NOT_FOUND"});

  const otp = Math.random().toString(36).slice(2,8).toUpperCase();
  b.otp.add(otp);
  const baseURL = req.body?.baseURL || `http://${req.get("host")}`;
  const spectatorURL = `${baseURL}/spectator?battle=${battleId}&otp=${otp}`;

  const playerLinks = b.players.map(p=>{
    const token = Math.random().toString(36).slice(2,10).toUpperCase();
    b.tokens.set(token, p.id);
    return { playerId:p.id, name:p.name, team:p.team, token, url:`${baseURL}/player?battle=${battleId}&token=${token}` };
  });

  res.json({
    ok:true,
    spectator:{ otp, url:spectatorURL },
    players: playerLinks
  });
});

// 호환성: /api/battles/:id/links
app.post("/api/battles/:id/links", (req,res)=>{
  req.params.id = req.params.id;
  return app._router.handle(req, res);
});

// -----------------------------------------------
// Socket.IO
// -----------------------------------------------
io.on("connection", (socket)=>{
  socket.on("join", ({battleId})=>{
    socket.join(String(battleId));
    emitUpdate(String(battleId));
  });

  socket.on("createBattle", ({mode}, cb=()=>{})=>{
    const battleId = `battle_${Math.random().toString(36).slice(2,10)}`;
    const snap = {
      id:battleId, mode:mode||"2v2", status:"waiting", createdAt:now(),
      players:[], logs:[], otp:new Set(), tokens:new Map(),
      currentTurn:{ turnNumber:1, currentTeam:"A", currentPlayer:null },
      round:{ phaseTeam:"A", selections:{A:{},B:{}}, order:{A:[],B:[]}, defendToken:{}, dodgeToken:{} }
    };
    BATTLES.set(battleId, snap);
    pushLog(battleId, "system", `전투 생성됨: ${mode||"2v2"}`);
    socket.join(battleId);
    emitUpdate(battleId);
    cb({ ok:true, battleId });
  });

  socket.on("startBattle", ({battleId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); 
    if(!b){ cb({ok:false, error:"NOT_FOUND"}); return; }
    if(b.status!=="waiting"){ cb({ok:false, error:"ALREADY_STARTED"}); return; }

    // 선공 결정 - D10으로 변경
    const sumA = b.players.filter(p=>p.team==="A" && p.hp>0).reduce((s,p)=>s+(p.stats?.agility||1),0);
    const sumB = b.players.filter(p=>p.team==="B" && p.hp>0).reduce((s,p)=>s+(p.stats?.agility||1),0);
    const rollA = d10(); // D10으로 변경
    const rollB = d10(); // D10으로 변경
    const totalA = sumA + rollA;
    const totalB = sumB + rollB;
    
    let first = totalA > totalB ? "A" : totalB > totalA ? "B" : (d10() >= d10() ? "A" : "B"); // D10으로 변경

    b.status = "active";
    b.firstTeam = first;
    b.currentTurn.turnNumber = 1;
    b.currentTurn.currentTeam = first;
    b.round.phaseTeam = first;
    b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, first);
    hydrateCurrentPlayer(b);
    b.currentTurn.turnDeadline = now() + 5*60*1000;

    pushLog(battleId, "battle", `전투 시작`);
    pushLog(battleId, "battle", `${first}팀 선공 (민첩 합계 + 주사위: A팀 ${totalA}, B팀 ${totalB})`);
    
    emitUpdate(battleId);
    cb({ ok:true });
  });

  socket.on("pauseBattle", ({battleId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); 
    if(!b){ cb({ok:false}); return; }
    b.status = "paused";
    pushLog(battleId, "system", "전투 일시정지");
    emitUpdate(battleId);
    cb({ok:true});
  });

  socket.on("resumeBattle", ({battleId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); 
    if(!b){ cb({ok:false}); return; }
    b.status = "active";
    pushLog(battleId, "system", "전투 재개");
    emitUpdate(battleId);
    cb({ok:true});
  });

  socket.on("endBattle", ({battleId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId)); 
    if(!b){ cb({ok:false}); return; }
    b.status = "ended";
    pushLog(battleId, "system", "전투 종료됨");
    emitUpdate(battleId);
    cb({ok:true});
  });

  socket.on("addPlayer", ({battleId, player}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ cb({ok:false, error:"NOT_FOUND"}); return; }
    
    const playerId = `p_${Math.random().toString(36).slice(2,8)}`;
    
    // player 객체의 team 값을 그대로 사용 (admin.html에서 정확히 전달됨)
    const newPlayer = {
      id: playerId,
      name: String(player?.name||"전투 참가자"),
      team: player?.team || "A", // admin.html에서 선택한 팀 값 사용
      hp: Number(player?.hp) || 100,
      maxHp: 100,
      stats: {
        attack: Math.min(5, Math.max(1, Number(player?.stats?.attack)||1)),
        defense: Math.min(5, Math.max(1, Number(player?.stats?.defense)||1)),
        agility: Math.min(5, Math.max(1, Number(player?.stats?.agility)||1)),
        luck: Math.min(5, Math.max(1, Number(player?.stats?.luck)||1))
      },
      items: {
        dittany: Number(player?.items?.dittany||player?.items?.ditany)||0,
        ditany: Number(player?.items?.dittany||player?.items?.ditany)||0,
        attackBooster: Number(player?.items?.attackBooster||player?.items?.attack_boost)||0,
        attack_boost: Number(player?.items?.attackBooster||player?.items?.attack_boost)||0,
        defenseBooster: Number(player?.items?.defenseBooster||player?.items?.defense_boost)||0,
        defense_boost: Number(player?.items?.defenseBooster||player?.items?.defense_boost)||0
      },
      avatar: player?.avatar || null,
      ready: false,
      joinedAt: now()
    };
    
    b.players.push(newPlayer);
    pushLog(battleId, "system", `${newPlayer.name}이(가) ${newPlayer.team}팀으로 참가`);
    emitUpdate(battleId);
    cb({ok:true, playerId});
  });

  socket.on("deletePlayer", ({battleId, playerId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ cb({ok:false}); return; }
    const idx = b.players.findIndex(p=>p.id===playerId);
    if(idx>=0){
      const p = b.players[idx];
      b.players.splice(idx,1);
      pushLog(battleId, "system", `${p.name}이(가) 퇴장`);
      emitUpdate(battleId);
    }
    cb({ok:true});
  });

  // 호환성: removePlayer
  socket.on("removePlayer", ({battleId, playerId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ cb({ok:false}); return; }
    const idx = b.players.findIndex(p=>p.id===playerId);
    if(idx>=0){
      const p = b.players[idx];
      b.players.splice(idx,1);
      pushLog(battleId, "system", `${p.name}이(가) 퇴장`);
      emitUpdate(battleId);
    }
    cb({ok:true});
  });

  socket.on("playerAuth", ({battleId, token}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ cb({ok:false, error:"NOT_FOUND"}); return; }
    const playerId = b.tokens.get(String(token));
    if(!playerId){ cb({ok:false, error:"INVALID_TOKEN"}); return; }
    const p = b.players.find(x=>x.id===playerId);
    if(!p){ cb({ok:false, error:"PLAYER_NOT_FOUND"}); return; }
    
    socket.join(battleId);
    
    // 양쪽 이벤트로 응답
    socket.emit("authSuccess", {ok:true, player:p, battleId});
    socket.emit("auth:success", {ok:true, player:p, battleId});
    
    pushLog(battleId, "system", `${p.name}이(가) 접속함`);
    emitUpdate(battleId);
    cb({ok:true, player:p});
  });

  socket.on("player:ready", ({battleId, playerId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ cb({ok:false}); return; }
    const p = b.players.find(x=>x.id===playerId);
    if(!p){ cb({ok:false}); return; }
    
    p.ready = true;
    pushLog(battleId, "system", `${p.name}이(가) 준비 완료`);
    emitUpdate(battleId);
    cb({ok:true});
  });

  // 호환성: playerReady
  socket.on("playerReady", ({battleId, playerId}, cb=()=>{})=>{
    const b = BATTLES.get(String(battleId));
    if(!b){ cb({ok:false}); return; }
    const p = b.players.find(x=>x.id===playerId);
    if(!p){ cb({ok:false}); return; }
    
    p.ready = true;
    pushLog(battleId, "system", `${p.name}이(가) 준비 완료`);
    emitUpdate(battleId);
    cb({ok:true});
  });

  // 전투자 연결 해제 감지
  socket.on("disconnect", ()=>{
    // 모든 전투를 확인하여 해당 소켓이 전투 참가자인지 확인
    for(const [battleId, b] of BATTLES.entries()){
      if(b.status === "active"){
        const player = b.players.find(p => p.socketId === socket.id);
        if(player){
          pushLog(battleId, "error", `${player.name}이(가) 연결 해제됨 - 게임 종료`);
          b.status = "ended";
          emitUpdate(battleId);
        }
      }
    }
  });

  function onAction({ battleId, playerId, action }, cb=()=>{}){
    const b = BATTLES.get(String(battleId)); 
    if(!b) { cb({ ok:false }); return; }
    if(b.status!=="active"){ cb({ ok:false, error:"NOT_ACTIVE" }); return; }

    if(completeTeamIfTimeout(b)){
      if(b.round.phaseTeam==="A"){
        pushLog(battleId, "battle", "A팀 타임아웃 - B팀으로 전환");
        startPhase(b,"B"); 
        emitUpdate(battleId); 
        cb({ ok:true, timeout:true }); 
        return;
      }else{
        pushLog(battleId, "battle", "B팀 타임아웃 - 라운드 종료");
        pushLog(battleId, "battle", `${b.currentTurn.turnNumber}라운드 선택 완료`);
        resolveRound(b); 
        emitUpdate(battleId); 
        cb({ ok:true, timeout:true }); 
        return;
      }
    }

    const p = b.players.find(x=>x.id===playerId); 
    if(!p || p.hp<=0){ 
      cb({ ok:false, error:"player_invalid" }); 
      return; 
    }
    
    if(p.team !== b.round.phaseTeam){ 
      cb({ ok:false, error:"NOT_YOUR_TEAM_TURN" }); 
      return; 
    }
    
    if(b.currentTurn.currentPlayerId && b.currentTurn.currentPlayerId !== playerId){
      cb({ ok:false, error:"NOT_YOUR_SLOT" }); 
      return;
    }

    const t = String(action?.type||"pass");
    const rec = { type:t };
    
    if(t==="attack") {
      rec.targetId = String(action?.targetId||"");
    }
    
    if(t==="item"){
      const it = action?.item;
      if(it==="dittany" || it==="ditany" || it==="attackBooster" || it==="attack_boost" || it==="defenseBooster" || it==="defense_boost"){
        rec.item = it;
        if(it==="dittany" || it==="ditany") {
          rec.targetId = String(action?.targetId||p.id);
        }
        if(it==="attackBooster" || it==="attack_boost") {
          rec.targetId = String(action?.targetId||""); // 상대팀 1인 지정
        }
        if(it==="defenseBooster" || it==="defense_boost") {
          rec.targetId = String(action?.targetId||""); // 아군 1인 지정
        }
      }else{
        rec.item = "unknown";
      }
    }
    
    b.round.selections[p.team][playerId] = rec;

    b.currentTurn.currentPlayerId = nextUnactedPlayerId(b, p.team);
    hydrateCurrentPlayer(b);

    if(!b.currentTurn.currentPlayerId){
      if(b.round.phaseTeam==="A"){
        startPhase(b,"B");
        pushLog(battleId, "battle", "A팀 선택 완료 - B팀 선택 시작");
      }else{
        pushLog(battleId, "battle", `${b.currentTurn.turnNumber}라운드 선택 완료`);
        resolveRound(b);
      }
    }

    emitUpdate(battleId);
    
    // 양쪽 이벤트로 응답
    socket.emit("actionSuccess", { ok:true });
    socket.emit("player:action:success", { ok:true });
    
    cb({ ok:true });
  }
  
  socket.on("player:action", onAction);
  socket.on("playerAction", onAction);

  socket.on("chatMessage", ({ battleId, name, message })=>{
    if(!battleId || !message) return;
    const msg = { name: String(name||"전투 참가자"), message: String(message||"") };
    
    // 양쪽 이벤트로 브로드캐스트
    io.to(battleId).emit("chatMessage", msg);
    io.to(battleId).emit("battle:chat", msg);
  });

  socket.on("spectator:cheer", ({ battleId, name, message })=>{
    if(!battleId) return;
    const msg = { name: String(name||"관전자"), message: `[응원] ${String(message||"")}` };
    
    // 채팅에만 표시, 로그 X
    io.to(battleId).emit("chatMessage", msg);
    io.to(battleId).emit("battle:chat", msg);
  });
});

// -----------------------------------------------
// SPA 라우트
// -----------------------------------------------
app.get("/",            (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/admin.html",  (_req,res)=> res.sendFile(path.join(publicDir, "admin.html")));
app.get("/player.html", (_req,res)=> res.sendFile(path.join(publicDir, "player.html")));
app.get("/spectator.html",(_req,res)=> res.sendFile(path.join(publicDir, "spectator.html")));

// -----------------------------------------------
// 에러 핸들러
// -----------------------------------------------
app.use((err,_req,res,_next)=>{ 
  console.error(err); 
  res.status(500).json({ ok:false, error:"internal" }); 
});

// -----------------------------------------------
// 서버 시작
// -----------------------------------------------
server.listen(PORT, HOST, ()=>{
  console.log("======================================");
  console.log("PYXIS Battle Server");
  console.log(`Server : http://${HOST}:${PORT}`);
  console.log(`Socket : path=${SOCKET_PATH}`);
  console.log(`Static : ${publicDir}`);
  console.log(`Uploads: ${uploadsDir}`);
  console.log("======================================");
});
