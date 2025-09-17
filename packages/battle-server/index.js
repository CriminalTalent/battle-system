// /server/index.js
// PYXIS Battle Server (Team-turn engine, v2 D10 rules)
// Dependencies: express, socket.io, multer, cors
// Run: npm i express socket.io multer cors
// Start: node server/index.js

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static (for avatar files)
const PUBLIC_DIR = path.join(__dirname, 'public');
const AVATAR_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads')));

// file upload (avatar)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = (file.originalname || 'avatar.png').replace(/[^\w.-]+/g, '_');
    cb(null, `${ts}__${safe}`);
  }
});
const upload = multer({ storage });

// ===== In-memory store =====
const battles = new Map();  // battleId -> battle
const socketsInBattle = new Map(); // socketId -> battleId

// ===== Helpers =====
const D10 = () => 1 + Math.floor(Math.random() * 10);
const id = (p='id') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const nowTs = () => Date.now();

// 90% success (10% fail)
const boosterSuccess = () => D10() !== 1;

// sanitize snapshot to client
function snapshot(b) {
  return {
    id: b.id,
    mode: b.mode,
    status: b.status,
    round: b.round,
    spectatorOtp: b.spectatorOtp || null, // ok to show
    players: b.players.map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      maxHp: p.maxHp,
      avatar: p.avatar || null,
      stats: p.stats,
      items: {            // counts만
        dittany: p.items.dittany,
        attackBooster: p.items.attackBooster,
        defenseBooster: p.items.defenseBooster
      },
      ready: !!p.ready
    })),
    currentTurn: b.currentTurn ? {
      turnNumber: b.currentTurn.turnNumber,
      currentTeam: b.currentTurn.currentTeam,
      currentPlayer: null, // 팀턴: 개별 플레이어 없음(클라에서 검은 화면 표시)
      timeLeftSec: Math.max(0, Math.ceil((b.currentTurn.endsAt - Date.now())/1000))
    } : null,
  };
}

function emitUpdate(b) {
  io.to(roomOf(b.id)).emit('battleUpdate', snapshot(b));
}

function emitLog(b, message, type='system') {
  const log = { ts: nowTs(), type, message };
  io.to(roomOf(b.id)).emit('battle:log', log);
}

function roomOf(battleId){ return `battle:${battleId}`; }

function livingTeam(b, team){
  return b.players.filter(p => p.team === team && p.hp > 0);
}
function enemiesOf(b, team){
  return b.players.filter(p => p.team !== team && p.hp > 0);
}
function playerById(b, pid){
  return b.players.find(p => p.id === pid);
}
function alive(b){ return b.players.filter(p => p.hp > 0); }
function checkVictory(b){
  const aAlive = livingTeam(b, 'A').length;
  const bAlive = livingTeam(b, 'B').length;
  if(aAlive === 0 && bAlive === 0) return 'draw';
  if(aAlive === 0) return 'B';
  if(bAlive === 0) return 'A';
  return null;
}

function createBattle(mode='2v2'){
  const battle = {
    id: id('battle'),
    mode,
    status: 'waiting',
    round: 0,
    currentTurn: null,
    players: [],
    spectatorOtp: null,
    // action buffers (per round)
    actions: { A: new Map(), B: new Map() },
    timers: { turn: null, ticker: null, cooldown: null }
  };
  battles.set(battle.id, battle);
  return battle;
}

function clearTimers(b){
  const t = b.timers;
  if(t.turn) clearTimeout(t.turn);
  if(t.ticker) clearInterval(t.ticker);
  if(t.cooldown) clearTimeout(t.cooldown);
  b.timers = { turn: null, ticker: null, cooldown: null };
}

function resetActions(b){
  b.actions = { A: new Map(), B: new Map() };
}

function startTicker(b){
  // 1s ticker for timeLeft
  if(b.timers.ticker) clearInterval(b.timers.ticker);
  b.timers.ticker = setInterval(() => emitUpdate(b), 1000);
}

function stopTicker(b){
  if(b.timers.ticker) clearInterval(b.timers.ticker);
  b.timers.ticker = null;
}

// ===== Rules (v2, D10) =====
function finalAttack(attacker, useAttackBooster, logsOut){
  const boostOk = useAttackBooster ? boosterSuccess() : false;
  if(useAttackBooster){
    logsOut && logsOut.push(`→ ${attacker.name}이(가) 공격 보정기 사용 ${boostOk?'성공':'실패'}`);
  }
  const coef = (useAttackBooster && boostOk) ? 2 : 1;
  const val = attacker.stats.attack * coef + D10();
  return { val, boosted: (coef===2) };
}
function isCrit(attacker){
  // d10 ≥ (10 − luck/2)
  const r = D10();
  const need = 10 - (attacker.stats.luck||0)/2;
  return r >= need;
}
function defenseValue(defender, useDefenseBooster, logsOut){
  const boostOk = useDefenseBooster ? boosterSuccess() : false;
  if(useDefenseBooster){
    logsOut && logsOut.push(`→ ${defender.name}이(가) 방어 보정기 사용 ${boostOk?'성공':'실패'}`);
  }
  const coef = (useDefenseBooster && boostOk) ? 2 : 1;
  return { val: defender.stats.defense * coef + D10(), boosted:(coef===2) };
}
function applyDodge(defender, attackerFinalAttack){
  // 성공: 민첩 + d10 ≥ 공격자의 최종공격력
  return (defender.stats.agility + D10()) >= attackerFinalAttack;
}

// ===== Round engine (Team turn: A -> B -> Resolve) =====
const TURN_SECONDS = 20;  // per team input window
const COOLDOWN_SECONDS = 5;

function startBattle(b){
  if(b.status === 'active') return;
  clearTimers(b);
  resetActions(b);
  b.status = 'active';
  b.round = 1;

  // decide initiative (log style as before)
  const aRoll = D10(); const aStat = 1;
  const bRoll = D10(); const bStat = 1;
  const aTot = aRoll + aStat;
  const bTot = bRoll + bStat;
  emitLog(b, `선공 결정: A팀(${aStat}+${aRoll}=${aTot}) vs B팀(${bStat}+${bRoll}=${bTot})`);
  const firstTeam = (aTot >= bTot) ? 'A' : 'B';
  emitLog(b, `${firstTeam}팀이 선공입니다!`);
  emitLog(b, `전투가 시작되었습니다!`, 'battle');

  // Start team turn
  teamTurn(b, firstTeam);
}

function teamTurn(b, team){
  if(b.status !== 'active') return;

  // skip fully-dead team (auto pass)
  if(livingTeam(b, team).length === 0){
    emitLog(b, `${team}팀 생존자가 없습니다(자동 패스)`);
    if(team === 'A') return teamTurn(b, 'B');
    else return resolveRound(b);
  }

  b.currentTurn = {
    turnNumber: b.round,
    currentTeam: team,
    currentPlayer: null,
    endsAt: Date.now() + TURN_SECONDS*1000
  };
  emitLog(b, `${team}팀의 턴입니다`);
  emitUpdate(b);
  startTicker(b);

  // schedule end of team turn
  if(b.timers.turn) clearTimeout(b.timers.turn);
  b.timers.turn = setTimeout(() => {
    endTeamTurn(b, team);
  }, TURN_SECONDS*1000);
}

function endTeamTurn(b, team){
  if(b.status !== 'active') return;
  stopTicker(b);
  // ensure team turn moves to next
  if(team === 'A'){
    emitLog(b, 'A팀 선택 완료');
    return teamTurn(b, 'B');
  }else{
    emitLog(b, 'B팀 선택 완료');
    return resolveRound(b);
  }
}

function resolveRound(b){
  if(b.status !== 'active') return;

  // === 라운드 해결 ===
  emitLog(b, '=== 라운드 해결 시작 ===', 'battle');

  // 1) 행동 요약(요청 포맷)
  // A팀
  const Aacts = b.actions.A;
  const Bacts = b.actions.B;

  // 팀 행동 요약
  summarizeTeamActions(b, 'A', Aacts);
  summarizeTeamActions(b, 'B', Bacts);

  // 2) 실제 해석
  emitLog(b, '=== 라운드 결과 ===', 'battle');
  const resultLogs = [];

  // 순서: 공격/아이템/패스 등은 동시 개념.
  // 먼저 아이템(디터니) 처리 → 이어서 타격 처리
  // (보정기는 각 본인 행동 시 처리되므로 공격/방어/회피 해석 시에 반영)
  processHealing(b, resultLogs, Aacts);
  processHealing(b, resultLogs, Bacts);

  // 공격 해석 (공격 대상이 방어나 회피 선택했을 때만 해당 판정)
  processAttacks(b, resultLogs, Aacts, Bacts);
  processAttacks(b, resultLogs, Bacts, Aacts);

  // 결과 로그 출력
  resultLogs.forEach(line => emitLog(b, line, 'battle'));

  // 승패 판정
  const winner = checkVictory(b);
  if(winner){
    if(winner === 'draw') emitLog(b, `양 팀 전원 사망. 무승부로 종료됩니다.`, 'battle');
    else emitLog(b, `${winner}팀 승리! 게임이 종료되었습니다`, 'battle');
    b.status = 'ended';
    b.currentTurn = null;
    clearTimers(b);
    emitUpdate(b);
    return;
  }

  // 라운드 종료, 다음 라운드 예고
  emitLog(b, `${b.round}라운드 종료`, 'battle');
  emitLog(b, `${COOLDOWN_SECONDS}초 후 다음 라운드 시작...`, 'battle');

  // 쿨다운 후 다음 라운드
  b.timers.cooldown = setTimeout(() => {
    b.round += 1;
    resetActions(b);
    teamTurn(b, 'A'); // 라운드마다 A 선공 → 원래 룰 유지 원하면 여기서 선공 토글 가능
  }, COOLDOWN_SECONDS*1000);
  emitUpdate(b);
}

// 행동 요약 (요청한 포맷으로 팀별)
function summarizeTeamActions(b, team, actsMap){
  emitLog(b, `=== ${team}팀 행동 ===`, 'battle');
  const aliveTeam = livingTeam(b, team);
  if(aliveTeam.length === 0){
    emitLog(b, `→ 생존자 없음`, 'battle');
    emitLog(b, `${team}팀 선택 완료`, 'battle');
    return;
  }
  aliveTeam.forEach(p => {
    const act = actsMap.get(p.id);
    if(!act){ emitLog(b, `→ ${p.name}이(가) 행동 패스`, 'battle'); return; }
    switch(act.type){
      case 'attack': {
        const tgt = playerById(b, act.targetId);
        const tname = tgt ? tgt.name : '(대상 없음)';
        emitLog(b, `→ ${p.name}이(가) ${tname}을(를) 공격`, 'battle');
        if(act.useAttackBooster) emitLog(b, `→ ${p.name}이(가) 공격 보정기 사용 시도`, 'battle');
      } break;
      case 'defend':
        emitLog(b, `→ ${p.name}이(가) 방어 태세`, 'battle');
        if(act.useDefenseBooster) emitLog(b, `→ ${p.name}이(가) 방어 보정기 사용 시도`, 'battle');
        break;
      case 'dodge':
        emitLog(b, `→ ${p.name}이(가) 회피 태세`, 'battle');
        break;
      case 'item':
        if(act.item === 'dittany'){
          const tgt = playerById(b, act.targetId);
          const tname = tgt ? tgt.name : '(대상 없음)';
          emitLog(b, `→ ${p.name}이(가) ${tname}에게 디터니 사용`, 'battle');
        }else if(act.item === 'attackBooster'){
          emitLog(b, `→ ${p.name}이(가) 공격 보정기 사용`, 'battle');
        }else if(act.item === 'defenseBooster'){
          emitLog(b, `→ ${p.name}이(가) 방어 보정기 사용`, 'battle');
        }
        break;
      case 'pass':
      default:
        emitLog(b, `→ ${p.name}이(가) 행동 패스`, 'battle');
        break;
    }
  });
  emitLog(b, `${team}팀 선택 완료`, 'battle');
}

function processHealing(b, logsOut, actsMap){
  // 디터니만 즉시 반영
  for(const [pid, act] of actsMap){
    const healer = playerById(b, pid);
    if(!healer || healer.hp <= 0) continue;
    if(!act || act.type !== 'item' || act.item !== 'dittany') continue;

    const target = playerById(b, act.targetId);
    if(!target){ continue; }
    if(target.hp <= 0){
      logsOut.push(`${healer.name}의 ${target.name}에게 디터니 사용 실패 (사망자)`);
      continue;
    }
    if(healer.items.dittany <= 0){
      logsOut.push(`${healer.name}의 ${target.name} 치유 실패 (디터니 없음)`);
      continue;
    }
    // 사용 그 턴 소비
    healer.items.dittany -= 1;

    const heal = 15 + D10();
    target.hp = Math.min(target.maxHp, target.hp + heal);
    logsOut.push(`${healer.name}이(가) ${target.name} 치유 (+${heal}) → HP ${target.hp}`);
  }
}

function processAttacks(b, logsOut, atkActsMap, defActsMap){
  // 각 공격자에 대해 처리
  for(const [pid, act] of atkActsMap){
    const attacker = playerById(b, pid);
    if(!attacker || attacker.hp <= 0 || !act || act.type !== 'attack') continue;

    // 대상 보정
    let target = playerById(b, act.targetId);
    if(!target || target.hp <= 0){
      const candidates = enemiesOf(b, attacker.team);
      if(candidates.length === 0) continue;
      target = candidates[Math.floor(Math.random()*candidates.length)];
    }

    // 공격자: 최종공격력/치명타
    const tmpLog = [];
    const atkRes = finalAttack(attacker, !!act.useAttackBooster, tmpLog);
    const crit = isCrit(attacker);
    const base = crit ? (atkRes.val*2) : atkRes.val;

    // 수비자의 선택에 따라 처리
    const tAct = defActsMap.get(target.id);
    let dmg = base;
    let descPrefix = '';

    if(tAct && tAct.type === 'defend'){
      const def = defenseValue(target, !!tAct.useDefenseBooster, tmpLog);
      dmg = Math.max(0, base - def.val);
      descPrefix = (atkRes.boosted||def.boosted) ? '강화된 ' : '';
      if(dmg === 0){
        logsOut.push(`${attacker.name}의 ${descPrefix}${crit?'치명타 ':''}공격이 ${target.name}에게 막혔습니다`);
      }else{
        target.hp = Math.max(0, target.hp - dmg);
        if(target.hp === 0){
          logsOut.push(`${attacker.name}의 ${descPrefix}${crit?'치명타 ':''}공격으로 ${target.name} 사망! (피해 ${dmg})`);
        }else{
          logsOut.push(`${attacker.name}이(가) ${target.name}에게 ${descPrefix}${crit?'치명타 ':''}공격 (피해 ${dmg}) → HP ${target.hp}`);
        }
      }
    } else if(tAct && tAct.type === 'dodge'){
      // 회피 판정 (성공: 0 / 실패: 방어 차감 없이 정면)
      const success = applyDodge(target, atkRes.val);
      descPrefix = atkRes.boosted ? '강화된 ' : '';
      if(success){
        logsOut.push(`${attacker.name}의 ${descPrefix}${crit?'치명타 ':''}공격이 ${target.name}에게 빗나감`);
      }else{
        target.hp = Math.max(0, target.hp - dmg);
        if(target.hp === 0){
          logsOut.push(`${attacker.name}의 ${descPrefix}${crit?'치명타 ':''}공격으로 ${target.name} 사망! (피해 ${dmg})`);
        }else{
          logsOut.push(`${attacker.name}이(가) ${target.name}에게 ${descPrefix}${crit?'치명타 ':''}공격 (피해 ${dmg}) → HP ${target.hp}`);
        }
      }
    } else {
      // 방어/회피를 선택하지 않았으면 그대로 정면 피해
      descPrefix = atkRes.boosted ? '강화된 ' : '';
      target.hp = Math.max(0, target.hp - dmg);
      if(target.hp === 0){
        logsOut.push(`${attacker.name}의 ${descPrefix}${crit?'치명타 ':''}공격으로 ${target.name} 사망! (피해 ${dmg})`);
      }else{
        logsOut.push(`${attacker.name}이(가) ${target.name}에게 ${descPrefix}${crit?'치명타 ':''}공격 (피해 ${dmg}) → HP ${target.hp}`);
      }
    }

    // 보조 로그(보정기 성공/실패 등) 붙이기
    tmpLog.forEach(line => logsOut.push(line));
  }
}

// ===== API =====

// Create battle
app.post('/api/battles', (req,res)=>{
  const mode = String(req.body?.mode || '2v2');
  const b = createBattle(mode);
  return res.json({ ok:true, id:b.id, battle: snapshot(b) });
});

// Generate links (spectator OTP + player links)
// Uses base URL from header 'x-base-url' when present
app.post('/api/admin/battles/:id/links', (req,res)=>{
  const b = battles.get(req.params.id);
  if(!b) return res.status(404).json({ ok:false, error:'not found' });
  if(!b.spectatorOtp) b.spectatorOtp = Math.random().toString(36).slice(2,10);

  const base = (req.headers['x-base-url'] || '').replace(/\/+$/,'');
  const playerLinks = b.players.map(p=>{
    if(!p.token) p.token = Math.random().toString(36).slice(2,10);
    const url = base ? `${base}/player?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(p.token)}`
                     : '';
    return {
      id: p.id, playerId: p.id, playerName: p.name, team: p.team,
      otp: p.token, url
    };
  });

  const spectatorUrl = base ? `${base}/spectator?battle=${encodeURIComponent(b.id)}&otp=${encodeURIComponent(b.spectatorOtp)}` : '';

  return res.json({
    ok:true,
    spectator: { otp: b.spectatorOtp, url: spectatorUrl },
    playerLinks
  });
});

// Add player by HTTP (multiple fallbacks existed before; we support canonical)
app.post('/api/battles/:id/players', (req,res)=>{
  const b = battles.get(req.params.id);
  if(!b) return res.status(404).json({ ok:false, error:'not found' });
  const payload = req.body?.player || req.body;

  const p = {
    id: id('p'),
    name: String(payload.name||'무명'),
    team: (payload.team==='B'?'B':'A'),
    hp: Number(payload.hp||100),
    maxHp: Number(payload.maxHp||100),
    avatar: payload.avatar || '/uploads/avatars/default.svg',
    stats: {
      attack : Number(payload.stats?.attack ?? 1),
      defense: Number(payload.stats?.defense ?? 1),
      agility: Number(payload.stats?.agility ?? 1),
      luck   : Number(payload.stats?.luck ?? 1),
    },
    items: {
      dittany: Number(payload.items?.dittany ?? 0),
      attackBooster: Number(payload.items?.attackBooster ?? 0),
      defenseBooster: Number(payload.items?.defenseBooster ?? 0),
    },
    ready: false,
    token: Math.random().toString(36).slice(2,10),
  };
  b.players.push(p);
  emitLog(b, `${p.name}이(가) ${p.team}팀으로 참가했습니다`);
  emitUpdate(b);
  return res.json({ ok:true, player:p });
});

// Avatar upload
app.post('/api/upload/avatar', upload.single('avatar'), (req,res)=>{
  if(!req.file){
    return res.status(400).json({ ok:false, error:'no file' });
  }
  const rel = `/uploads/avatars/${req.file.filename}`;
  return res.json({ ok:true, url: rel });
});

// ===== Socket =====

io.on('connection', (socket)=>{
  // helpful log (server side)
  // console.log('socket connected', socket.id);

  socket.on('join', ({ battleId })=>{
    const b = battles.get(battleId);
    if(!b) return;
    socketsInBattle.set(socket.id, battleId);
    socket.join(roomOf(battleId));
    socket.emit('battleUpdate', snapshot(b));
    emitLog(b, '새 연결이 입장했습니다');
  });

  // unified add-player socket handlers (many legacy names)
  const addPlayerSocket = (payload, ack)=>{
    try{
      const { battleId, player } = payload || {};
      const b = battles.get(battleId);
      if(!b) return ack && ack({ ok:false, error:'not found' });
      const body = player || payload;

      const p = {
        id: id('p'),
        name: String(body.name||'무명'),
        team: (body.team==='B'?'B':'A'),
        hp: Number(body.hp||100),
        maxHp: Number(body.maxHp||100),
        avatar: body.avatar || '/uploads/avatars/default.svg',
        stats: {
          attack : Number(body.stats?.attack ?? 1),
          defense: Number(body.stats?.defense ?? 1),
          agility: Number(body.stats?.agility ?? 1),
          luck   : Number(body.stats?.luck ?? 1),
        },
        items: {
          dittany: Number(body.items?.dittany ?? 0),
          attackBooster: Number(body.items?.attackBooster ?? 0),
          defenseBooster: Number(body.items?.defenseBooster ?? 0),
        },
        ready: false,
        token: Math.random().toString(36).slice(2,10),
      };
      b.players.push(p);
      emitLog(b, `${p.name}이(가) ${p.team}팀으로 참가했습니다`);
      emitUpdate(b);
      ack && ack({ ok:true, player:p });
    }catch(e){
      ack && ack({ ok:false, error: e?.message || 'error' });
    }
  };
  ['addPlayer','battle:addPlayer','admin:addPlayer','player:add','player:addToBattle','battle:player:add','add:player']
    .forEach(ev => socket.on(ev, (pl, ack)=> addPlayerSocket(pl, ack)));

  // delete player
  socket.on('deletePlayer', ({ battleId, playerId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false, error:'not found' });
    const idx = b.players.findIndex(p=>p.id===playerId);
    if(idx>=0){
      const [p] = b.players.splice(idx,1);
      emitLog(b, `${p.name} 제거됨`);
      emitUpdate(b);
      ack && ack({ ok:true });
    }else{
      ack && ack({ ok:false, error:'no player' });
    }
  });

  // player auth (by token in link)
  socket.on('playerAuth', ({ battleId, token }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false, error:'not found' });
    const p = b.players.find(x => x.token === token);
    if(!p) return ack && ack({ ok:false, error:'bad token' });
    ack && ack({ ok:true, player: {
      id: p.id, name: p.name, team: p.team, avatar: p.avatar,
      hp: p.hp, maxHp: p.maxHp, stats: p.stats, items: p.items
    }});
    emitLog(b, `${p.name}이(가) 로그인했습니다`);
  });

  // player ready
  socket.on('player:ready', ({ battleId, playerId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    const p = playerById(b, playerId);
    if(p){ p.ready = true; emitLog(b, `${p.name}이(가) 준비 완료했습니다`); emitUpdate(b); }
    ack && ack({ ok:true });
  });

  // player action (only recorded on own team turn)
  socket.on('player:action', ({ battleId, playerId, action }, ack)=>{
    const b = battles.get(battleId);
    if(!b || b.status!=='active' || !b.currentTurn) return ack && ack({ ok:false, error:'not active' });
    const p = playerById(b, playerId);
    if(!p || p.hp<=0) return ack && ack({ ok:false, error:'dead or no player' });
    if(b.currentTurn.currentTeam !== p.team) return ack && ack({ ok:false, error:'not your team turn' });

    // normalize action
    const a = normalizeAction(action, p, b);
    b.actions[p.team].set(p.id, a);

    // notify
    io.to(roomOf(battleId)).emit('player:action:success', { playerId: p.id });
    emitLog(b, `${p.name}이(가) 행동을 선택했습니다`);

    // if all living team members submitted -> end team turn early
    const aliveCount = livingTeam(b, p.team).length;
    if(b.actions[p.team].size >= aliveCount){
      // end immediately
      if(b.timers.turn){ clearTimeout(b.timers.turn); b.timers.turn=null; }
      endTeamTurn(b, p.team);
    }
    ack && ack({ ok:true });
  });

  function normalizeAction(a, p, b){
    if(!a || !a.type) return { type:'pass' };
    const type = a.type;
    if(type==='attack'){
      // pick target or random enemy
      let tgt = a.targetId && playerById(b, a.targetId);
      if(!tgt || tgt.hp<=0){
        const es = enemiesOf(b, p.team);
        if(es.length) tgt = es[Math.floor(Math.random()*es.length)];
      }
      return { type:'attack', targetId: tgt?.id, useAttackBooster: !!a.useAttackBooster };
    }else if(type==='defend'){
      return { type:'defend', useDefenseBooster: !!a.useDefenseBooster };
    }else if(type==='dodge'){
      return { type:'dodge' };
    }else if(type==='item'){
      // only dittany is immediate; boosters are implicit when do defend/attack
      if(a.item==='dittany'){
        // need a friendly target
        let tgt = a.targetId && playerById(b, a.targetId);
        if(!tgt || tgt.hp<=0 || tgt.team!==p.team){
          const mates = livingTeam(b, p.team);
          if(mates.length) tgt = mates.reduce((lo,cur)=> cur.hp<lo.hp?cur:lo, mates[0]); // lowest hp
        }
        // consume one now (done in healing stage actually)
        if(p.items.dittany<=0) return { type:'pass' };
        return { type:'item', item:'dittany', targetId: tgt?.id };
      }
      return { type:'pass' };
    }else{
      return { type:'pass' };
    }
  }

  // chat & cheer
  socket.on('chatMessage', ({ battleId, name, message }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    io.to(roomOf(battleId)).emit('chatMessage', { name: name||'익명', message, timestamp: nowTs() });
    ack && ack({ ok:true });
  });
  socket.on('battle:chat', (payload, ack)=>{ // legacy
    const b = battles.get(payload?.battleId);
    if(!b) return ack && ack({ ok:false });
    io.to(roomOf(b.id)).emit('chatMessage', {
      name: payload?.name||'익명', message: payload?.message||payload?.text||'', timestamp: nowTs()
    });
    ack && ack({ ok:true });
  });
  socket.on('spectator:cheer', ({ battleId, name, message }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    io.to(roomOf(battleId)).emit('chatMessage', { type:'cheer', name: name||'관전자', message, timestamp: nowTs() });
    ack && ack({ ok:true });
  });

  // admin controls
  socket.on('startBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    startBattle(b);
    ack && ack({ ok:true });
  });
  socket.on('pauseBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    if(b.status==='active'){ b.status='paused'; clearTimers(b); emitUpdate(b); emitLog(b,'전투 일시정지'); }
    ack && ack({ ok:true });
  });
  socket.on('resumeBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    if(b.status==='paused'){ b.status='active'; emitUpdate(b); emitLog(b,'전투 재개'); teamTurn(b, 'A'); }
    ack && ack({ ok:true });
  });
  socket.on('endBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack && ack({ ok:false });
    b.status='ended'; clearTimers(b); b.currentTurn=null; emitUpdate(b); emitLog(b,'전투가 종료되었습니다','battle');
    ack && ack({ ok:true });
  });

  socket.on('disconnect', ()=>{
    const bid = socketsInBattle.get(socket.id);
    socketsInBattle.delete(socket.id);
    // no-op logs (optional)
  });
});

// ===== Start server =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> {
  console.log(`PYXIS battle server running on http://localhost:${PORT}`);
});
