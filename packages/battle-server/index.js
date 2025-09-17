// PYXIS Battle System - 강화 서버 (ESM)
// 디자인/이벤트명/호환성 유지 + 링크/OTP/아이템 룰 보강

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== ENV =====
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ===== App / IO =====
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  path: '/socket.io',
  cors: { origin: CORS_ORIGIN, methods: ['GET','POST'], credentials: true }
});

// ===== Middlewares =====
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (origin, cb) => cb(null, true), credentials: true }));
app.use(express.json({ limit: '512kb' }));
app.use(compression());
app.use(rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));

// ===== Public =====
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', etag: true }));

// ===== In-memory store =====
const battles = new Map(); // id -> battle

function now(){ return Date.now(); }
function d10(){ return Math.floor(Math.random()*10)+1; }
function randId(prefix='battle'){
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2,10)}`;
}

// ===== Battle Model =====
function createBattle(mode='2v2'){
  const b = {
    id: randId('battle'),
    createdAt: now(),
    updatedAt: now(),
    status: 'waiting', // waiting|active|paused|ended
    phase: null,       // 선택 페이즈 등이 필요하면 활용 가능(관전자/관리자 화면 호환)
    mode,              // '2v2' 등
    players: [],       // {id,name,team,avatar,hp,maxHp,stats:{attack,defense,agility,luck},items:{dittany,attackBooster,defenseBooster},token?,temp?}
    spectatorOtp: null,
    currentTurn: {     // UI 호환용 필드 유지
      turnNumber: 0,
      currentTeam: 'A',
      currentPlayer: null,
      timeLeftSec: 0
    },
    roundEvents: [],
    timers: { running: false, deadline: 0, durationSec: 0 }
  };
  battles.set(b.id, b);
  return b;
}

// ===== Utils: emit update/log (신/구 이벤트 동시 브로드캐스트) =====
function emitUpdate(battle){
  battle.updatedAt = now();
  io.to(battle.id).emit('battle:update', toSnapshot(battle));
  io.to(battle.id).emit('battleUpdate', toSnapshot(battle));
}
function emitLog(battle, message, type='battle'){
  const log = { ts: now(), type, message };
  io.to(battle.id).emit('battle:log', log);
  if (/(라운드|승리|종료|===|턴 시작|턴 종료)/.test(message)) {
    io.to(battle.id).emit('importantLog', log);
  }
  battle.roundEvents.push(log);
}
function toSnapshot(b){
  const curId = b.currentTurn?.currentPlayer?.id;
  const curPlayer = curId ? b.players.find(p=>p.id===curId) || null : null;
  return {
    id: b.id,
    status: b.status,
    phase: b.phase,
    currentTeam: b.currentTurn?.currentTeam || null,
    currentTurn: {
      turnNumber: b.currentTurn?.turnNumber || 0,
      currentTeam: b.currentTurn?.currentTeam || null,
      currentPlayer: curPlayer ? {
        id: curPlayer.id, name: curPlayer.name, team: curPlayer.team, avatar: curPlayer.avatar
      } : null,
      timeLeftSec: Math.max(0, Math.floor((b.timers.deadline - now())/1000))
    },
    players: b.players.map(p=>({
      id: p.id, name: p.name, team: p.team,
      avatar: p.avatar || null,
      hp: p.hp|0, maxHp: p.maxHp|0,
      stats: p.stats,
      items: p.items
    }))
  };
}

// ===== Turn Timer =====
function setTurn(battle, player){
  battle.currentTurn.currentPlayer = player ? { id: player.id } : null;
  battle.currentTurn.currentTeam = player ? player.team : (battle.currentTurn.currentTeam || 'A');
}
function startTimer(battle, sec=30){
  battle.timers.running = true;
  battle.timers.durationSec = sec|0;
  battle.timers.deadline = now() + (sec*1000);
}
function stopTimer(battle){
  battle.timers.running = false;
  battle.timers.durationSec = 0;
  battle.timers.deadline = 0;
}

setInterval(()=>{
  for(const b of battles.values()){
    if(b.status!=='active' || !b.timers.running) continue;
    const remain = Math.max(0, Math.floor((b.timers.deadline - now())/1000));
    // 선택적 브로드캐스트(관/플 UI가 따라 잡도록)
    io.to(b.id).emit('timer:tick', {
      secondsLeft: remain,
      phase: b.phase,
      team: b.currentTurn?.currentTeam
    });
    if(remain<=0){
      // 시간 초과 → 자동 패스 처리
      const curPlayer = b.players.find(p=> p.id === b.currentTurn?.currentPlayer?.id);
      if(curPlayer){
        emitLog(b, `시간 초과: ${curPlayer.name}의 턴 자동 패스`, 'notice');
      }
      endTurnAndNext(b);
    }
  }
}, 1000);

// ===== Player helpers =====
function alivePlayers(b, team){ return b.players.filter(p=>p.team===team && p.hp>0); }
function nextPlayerInTeam(b, team){
  const list = alivePlayers(b, team);
  if(list.length===0) return null;
  const curId = b.currentTurn?.currentPlayer?.id;
  const idx = list.findIndex(p=>p.id===curId);
  if(idx<0) return list[0];
  return list[(idx+1) % list.length];
}
function pickFirstAlive(b, team){
  return alivePlayers(b, team)[0] || null;
}
function switchTeam(team){ return team==='A' ? 'B' : 'A'; }

// ===== Combat helpers (아이템 룰 보강 포함) =====
function isAttackBoostOn(attacker, defender, battle){
  return !!(attacker?.temp
    && attacker.temp.attackBoostTurn === battle.currentTurn?.turnNumber
    && attacker.temp.attackBoostTargetId === defender.id);
}
function consumeAttackBoost(attacker){
  if(!attacker?.temp) return;
  delete attacker.temp.attackBoostTurn;
  delete attacker.temp.attackBoostTargetId;
}
function isDefenseBoostOn(defender, battle){
  return !!(defender?.temp && defender.temp.defenseBoostTurn === battle.currentTurn?.turnNumber);
}

function computeAttackFinal(attacker, boosted=false){
  const base = Number(attacker.stats?.attack || 1) + d10();
  const crit = (Math.random() < (0.05 + (Number(attacker.stats?.luck||0)*0.02))); // 행운 보정(대충)
  let val = base + (crit ? 5 : 0);
  if(boosted) val *= 2; // 공격 보정 성공 → 2배
  return { final: Math.floor(val), crit };
}
function computeDefenseVal(b, defender){
  const base = Number(defender.stats?.defense || 1) + d10();
  return isDefenseBoostOn(defender, b) ? base*2 : base;
}
function tryDodge(defender){
  const ag = Number(defender.stats?.agility || 1);
  const chance = Math.min(0.5, 0.1 + ag*0.05); // 최대 50%
  return Math.random() < chance;
}

// ===== Turn flow =====
function startBattle(b){
  b.status = 'active';
  b.currentTurn.turnNumber = 1;
  // 첫 팀: A
  const first = pickFirstAlive(b, 'A') || pickFirstAlive(b, 'B') || null;
  setTurn(b, first);
  startTimer(b, 30);
  emitLog(b, `1라운드 시작`, 'battle');
  if(first) emitLog(b, `턴 시작: ${first.name} (${first.team}팀)`, 'battle');
  emitUpdate(b);
}
function pauseBattle(b){ b.status='paused'; stopTimer(b); emitUpdate(b); }
function resumeBattle(b){
  b.status='active';
  startTimer(b, Math.max(5, b.timers.durationSec || 30));
  emitUpdate(b);
}
function endBattle(b){
  b.status='ended'; stopTimer(b);
  emitLog(b, `=== 전투 종료 ===`, 'battle');
  emitUpdate(b);
}
function endTurnAndNext(b){
  stopTimer(b);
  // 다음 플레이어 선택: 같은 팀의 다음 → 상대 팀으로 체인지
  const curTeam = b.currentTurn.currentTeam || 'A';
  const nxtTeam = switchTeam(curTeam);

  // 같은 팀에서 다음이 남았더라도, 간단히 A/B 턴 교대로 처리 (UI 호환)
  const nextP = pickFirstAlive(b, nxtTeam) || pickFirstAlive(b, curTeam) || null;
  if(!nextP){
    // 전부 사망 → 종료
    const aAlive = alivePlayers(b,'A').length;
    const bAlive = alivePlayers(b,'B').length;
    if(aAlive===0 && bAlive===0) emitLog(b, `무승부`, 'battle');
    else if(aAlive>0) emitLog(b, `A팀 승리!`, 'battle');
    else emitLog(b, `B팀 승리!`, 'battle');
    return endBattle(b);
  }

  b.currentTurn.turnNumber += 1;
  b.currentTurn.currentTeam = nextP.team;
  setTurn(b, nextP);
  startTimer(b, 30);
  emitLog(b, `${b.currentTurn.turnNumber}라운드 시작`, 'battle');
  emitLog(b, `턴 시작: ${nextP.name} (${nextP.team}팀)`, 'battle');
  emitUpdate(b);
}

// ===== API =====

// 전투 생성
app.post('/api/battles', (req, res)=>{
  const mode = (req.body?.mode || '2v2');
  const b = createBattle(mode);
  res.json({ ok:true, id:b.id, battleId:b.id, battle:b });
});

// 아바타 업로드(강화)
const uploadDir = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(uploadDir, { recursive: true });
const ALLOWED = new Set(['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/svg+xml']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.png').toLowerCase();
    const safe = (Date.now() + '_' + Math.random().toString(16).slice(2,10)).replace(/[^\w.-]+/g,'_');
    cb(null, safe + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('INVALID_MIME'));
    cb(null, true);
  }
});
app.post('/api/upload/avatar', upload.single('avatar'), (req, res)=>{
  if(!req.file) return res.status(400).json({ ok:false, error:'NO_FILE' });
  const rel = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok:true, url: rel });
});

// 링크/OTP 생성 (관리자 핫픽스/페이지 호환)
function _baseUrl(req){
  const h = (req.headers['x-base-url'] || req.headers.origin || '').toString();
  if (h) return h.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
  const host  = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  return host ? `${proto}://${host}` : '';
}
function _buildSpectatorUrl(base, battleId, otp){
  if(!base) return '';
  const u = new URL('/spectator', base);
  u.searchParams.set('battle', battleId);
  if(otp) u.searchParams.set('otp', otp);
  return u.toString();
}
function _buildPlayerUrl(base, battleId, p){
  if(!base) return '';
  const u = new URL('/player', base);
  u.searchParams.set('battle', battleId);
  if (p.id)   u.searchParams.set('playerId', p.id);
  if (p.name) u.searchParams.set('name', p.name);
  if (p.team) u.searchParams.set('team', p.team);
  if (p.token) u.searchParams.set('token', p.token);
  return u.toString();
}
app.post('/api/admin/battles/:id/links', (req, res)=>{
  const id = req.params.id;
  const b = battles.get(id);
  if(!b) return res.status(404).json({ ok:false, error:'NOT_FOUND' });

  b.spectatorOtp ||= Math.random().toString(36).slice(2,10);
  for(const p of b.players) p.token ||= Math.random().toString(16).slice(2,10);

  const base = _baseUrl(req);
  res.json({
    spectator: { otp: b.spectatorOtp, url: _buildSpectatorUrl(base, id, b.spectatorOtp) },
    players: b.players.map(p=>({
      playerId: p.id, name: p.name, team: p.team, token: p.token,
      url: _buildPlayerUrl(base, id, p)
    }))
  });
});
app.post('/api/battles/:id/links', (req, res)=>{
  req.url = `/api/admin/battles/${req.params.id}/links`;
  app._router.handle(req, res);
});

// ===== Socket =====
io.on('connection', (socket)=>{
  // console.log('새 연결', socket.id);

  socket.on('join', ({ battleId })=>{
    if(!battleId) return;
    socket.join(battleId);
    socket.emit('battle:update', toSnapshot(battles.get(battleId) || {}));
  });

  // 플레이어 추가 (여러 이벤트명 호환)
  const addPlayerImpl = ({ battleId, player }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });

    const id = randId('p');
    const hp = Math.max(1, Number(player?.hp || 100));
    const maxHp = hp;
    const stats = {
      attack : Math.max(1, Number(player?.stats?.attack || 1)),
      defense: Math.max(1, Number(player?.stats?.defense || 1)),
      agility: Math.max(1, Number(player?.stats?.agility || 1)),
      luck   : Math.max(1, Number(player?.stats?.luck || 1))
    };
    const items = {
      dittany       : Number(player?.items?.dittany || player?.items?.ditany || 0),
      attackBooster : Number(player?.items?.attackBooster || player?.items?.attack_boost || 0),
      defenseBooster: Number(player?.items?.defenseBooster || player?.items?.defense_boost || 0)
    };

    const obj = {
      id,
      name: String(player?.name || `Player_${id.slice(-4)}`),
      team: String(player?.team || 'A'),
      avatar: player?.avatar || null,
      hp, maxHp, stats, items,
      token: player?.token || null,
      temp: {}
    };
    b.players.push(obj);
    emitLog(b, `${obj.name}이(가) ${obj.team}팀으로 참가했습니다`, 'notice');
    emitUpdate(b);
    ack?.({ ok:true, id: obj.id });
  };
  ['admin:addPlayer','battle:addPlayer','player:add','addPlayer','battle:player:add','player:addToBattle','admin:player:add','add:player']
    .forEach(ev => socket.on(ev, (pay, ack)=> addPlayerImpl(pay, ack)));

  // 플레이어 삭제
  socket.on('deletePlayer', ({ battleId, playerId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });
    const idx = b.players.findIndex(p=>p.id===playerId);
    if(idx<0) return ack?.({ ok:false, error:'NO_PLAYER' });
    const [rm] = b.players.splice(idx,1);
    emitLog(b, `${rm.name} 퇴장`, 'notice');
    emitUpdate(b);
    ack?.({ ok:true });
  });

  // 인증 (토큰 기준, 없으면 ok)
  socket.on('playerAuth', ({ battleId, token }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });
    const p = b.players.find(pp => !token || pp.token===token) || b.players[0];
    if(!p) return ack?.({ ok:false, error:'NO_PLAYER' });
    ack?.({ ok:true, player: p });
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message })=>{
    if(!battleId || !message) return;
    const payload = { name: String(name||'익명'), message: String(message), timestamp: now() };
    io.to(battleId).emit('chatMessage', payload);
    io.to(battleId).emit('battle:chat', payload);
  });

  // 관전자 응원
  socket.on('spectator:cheer', (data)=>{
    const { battleId } = data||{};
    if(!battleId) return;
    io.to(battleId).emit('spectator:cheer', { ...data, timestamp: now() });
  });

  // 전투 제어
  socket.on('startBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });
    if(b.status==='active') return ack?.({ ok:true });
    startBattle(b);
    ack?.({ ok:true });
  });
  socket.on('pauseBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });
    pauseBattle(b);
    emitLog(b, `전투 진행 상태: paused`, 'battle');
    ack?.({ ok:true });
  });
  socket.on('resumeBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });
    resumeBattle(b);
    emitLog(b, `전투 진행 상태: active`, 'battle');
    ack?.({ ok:true });
  });
  socket.on('endBattle', ({ battleId }, ack)=>{
    const b = battles.get(battleId);
    if(!b) return ack?.({ ok:false, error:'NOT_FOUND' });
    endBattle(b);
    ack?.({ ok:true });
  });

  // 플레이어 액션(아이템 룰 보강 반영)
  socket.on('player:action', ({ battleId, playerId, action }, ack)=>{
    const b = battles.get(battleId);
    if(!b || b.status!=='active') return ack?.({ ok:false });
    const actor = b.players.find(p=>p.id===playerId);
    if(!actor || actor.hp<=0) return ack?.({ ok:false });

    // 내 차례?
    const isMyTurn = (b.currentTurn?.currentPlayer?.id === actor.id);
    if(!isMyTurn) return ack?.({ ok:false, error: 'NOT_YOUR_TURN' });

    const type = action?.type;

    if(type==='attack'){
      const target = b.players.find(p=>p.id===action.targetId);
      if(!target || target.team===actor.team || target.hp<=0) return ack?.({ ok:false, error:'BAD_TARGET' });

      const boosted = isAttackBoostOn(actor, target, b);
      const { final: atkFinal, crit } = computeAttackFinal(actor, boosted);
      const defVal = computeDefenseVal(b, target);

      // 회피?
      if(tryDodge(target)){
        emitLog(b, `${actor.name} ▶ ${target.name} 공격 → 회피됨`, 'notice');
        if(boosted) consumeAttackBoost(actor); // 1회 소모
        emitUpdate(b);
        return ack?.({ ok:true });
      }

      const rawDmg = Math.max(1, Math.floor(atkFinal - defVal/2));
      target.hp = Math.max(0, target.hp - rawDmg);

      emitLog(b, `${actor.name} ▶ ${target.name} 공격${crit?'(치명타)':''} : ${rawDmg} 피해 (HP ${target.hp})`, 'notice');
      if(boosted){
        emitLog(b, `공격 보정기(1회 2배) 소모`, 'notice');
        consumeAttackBoost(actor);
      }
      emitUpdate(b);

      // 타깃 사망 시 체크
      if(target.hp<=0){
        emitLog(b, `${target.name} 전투불능`, 'battle');
        const aAlive = alivePlayers(b,'A').length;
        const bAlive = alivePlayers(b,'B').length;
        if(aAlive===0 || bAlive===0){
          endBattle(b);
          return ack?.({ ok:true });
        }
      }

      // 공격 후 턴 종료 → 다음
      endTurnAndNext(b);
      return ack?.({ ok:true });
    }

    if(type==='defend'){
      emitLog(b, `${actor.name} 방어 태세`, 'notice');
      emitUpdate(b);
      endTurnAndNext(b);
      return ack?.({ ok:true });
    }

    if(type==='dodge'){
      emitLog(b, `${actor.name} 회피 태세`, 'notice');
      emitUpdate(b);
      endTurnAndNext(b);
      return ack?.({ ok:true });
    }

    if(type==='pass'){
      emitLog(b, `${actor.name} 패스`, 'notice');
      emitUpdate(b);
      endTurnAndNext(b);
      return ack?.({ ok:true });
    }

    if(type==='item'){
      const item = action.item;
      const target = b.players.find(p=>p.id===action.targetId);
      if(!target) return ack?.({ ok:false, error:'NO_TARGET' });
      actor.items ||= {};

      if(item==='dittany'){
        const n = Number(actor.items.dittany || actor.items.ditany || 0);
        if(n<=0) return ack?.({ ok:false, error:'NO_ITEM' });
        actor.items.dittany = n - 1;
        target.hp = Math.min(target.maxHp, (target.hp||0) + 10);
        emitLog(b, `${actor.name} ▶ 디터니: ${target.name} HP +10 (${target.hp}/${target.maxHp})`, 'notice');
        emitUpdate(b);
        endTurnAndNext(b);
        return ack?.({ ok:true });
      }

      if(item==='attackBooster'){
        const n = Number(actor.items.attackBooster || actor.items.attack_boost || 0);
        if(n<=0) return ack?.({ ok:false, error:'NO_ITEM' });
        if(actor.team===target.team) return ack?.({ ok:false, error:'NEED_ENEMY' });
        actor.items.attackBooster = n - 1;

        if(Math.random()<0.6){
          actor.temp ||= {};
          actor.temp.attackBoostTurn = b.currentTurn?.turnNumber;
          actor.temp.attackBoostTargetId = target.id;
          emitLog(b, `공격 보정기 성공(60%): ${actor.name} → ${target.name} (이번 공격 1회 2배)`, 'notice');
        }else{
          emitLog(b, `공격 보정기 실패(40%): ${actor.name} → ${target.name}`, 'notice');
        }
        emitUpdate(b);
        endTurnAndNext(b);
        return ack?.({ ok:true });
      }

      if(item==='defenseBooster'){
        const n = Number(actor.items.defenseBooster || actor.items.defense_boost || 0);
        if(n<=0) return ack?.({ ok:false, error:'NO_ITEM' });
        if(actor.team!==target.team) return ack?.({ ok:false, error:'NEED_ALLY' });
        actor.items.defenseBooster = n - 1;

        if(Math.random()<0.6){
          target.temp ||= {};
          target.temp.defenseBoostTurn = b.currentTurn?.turnNumber;
          emitLog(b, `방어 보정기 성공(60%): ${actor.name} → ${target.name} (이번 턴 방어 2배)`, 'notice');
        }else{
          emitLog(b, `방어 보정기 실패(40%): ${actor.name} → ${target.name}`, 'notice');
        }
        emitUpdate(b);
        endTurnAndNext(b);
        return ack?.({ ok:true });
      }

      return ack?.({ ok:false, error:'UNKNOWN_ITEM' });
    }

    return ack?.({ ok:false, error:'UNKNOWN_ACTION' });
  });

});

// ===== Routes: simple landing (선택) =====
app.get('/', (req,res)=>{
  res.type('html').send(`<meta charset="utf-8"><style>body{font-family:system-ui;padding:30px;background:#000;color:#DCC7A2}</style><h1>PYXIS Battle Server</h1><ul><li><a href="/admin" style="color:#DCC7A2">/admin</a></li><li><a href="/player" style="color:#DCC7A2">/player</a></li><li><a href="/spectator" style="color:#DCC7A2">/spectator</a></li></ul>`);
});

// ===== Start =====
server.listen(PORT, HOST, ()=>{
  console.log(`[PYXIS] listening on http://${HOST}:${PORT}`);
});
