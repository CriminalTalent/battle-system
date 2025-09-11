// packages/battle-server/index.js
// ESM (package.json "type":"module")

import express from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  path: '/socket.io',
  cors: { origin: true, credentials: true }
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 제공
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

// 페이지 라우팅
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pages', 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// 헬스
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'battle-server' }));

// 업로드
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`);
  }
});
const upload = multer({ storage });
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '파일 누락' });
  res.json({ ok: true, avatarUrl: `/uploads/${req.file.filename}` });
});

// ===== 인메모리 상태 =====
const battles = new Map();

// 유틸
const d20 = () => Math.floor(Math.random() * 20) + 1;
const now = () => Date.now();
const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,10)}`;
const teamAB = (t) => (t==='phoenix' ? 'A팀' : 'B팀');
const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));

function maxTeamSizeByMode(mode){
  const m = String(mode||'4v4').toLowerCase();
  if (m==='1v1') return 1;
  if (m==='2v2') return 2;
  if (m==='3v3') return 3;
  return 4;
}

function sanitizePlayer(p){
  return {
    id: p.id, name: p.name, team: p.team,
    hp: p.hp, maxHp: p.maxHp,
    stats: p.stats, items: p.items,
    avatar: p.avatar || '',
    ready: !!p.ready
  };
}
function sanitizeBattle(b){
  return {
    id: b.id, mode: b.mode, status: b.status,
    players: b.players.map(sanitizePlayer),
    phase: b.phase, currentTeam: b.currentTeam,
    commitFirstTeam: b.commitFirstTeam,
    turnStartTime: b.turnStartTime,
    winnerTeam: b.winnerTeam || null,
    spectatorOtp: b.spectatorOtp || `spectator-${b.id}`,
    turn: b.turn || 1
  };
}

// ===== 전투 생성/조회/시작 =====
function createBattle(mode='4v4'){
  const id = uid('battle');
  const battle = {
    id, mode, status: 'waiting',
    players: [],
    phase: 'commitA',
    commitFirstTeam: 'phoenix',
    currentTeam: 'phoenix',
    turnStartTime: now(),
    readyCount: 0,
    winnerTeam: null,
    commitBox: { phoenix: {}, eaters: {} },
    spectatorOtp: `spectator-${id}`,
    turn: 1
  };
  battles.set(id, battle);
  return battle;
}

function findBattlePlayerByName(battle, name){
  return battle.players.find(p => String(p.name)===String(name));
}

function teamCounts(battle){
  const a = battle.players.filter(p=>p.team==='phoenix').length;
  const b = battle.players.filter(p=>p.team==='eaters').length;
  return { phoenix:a, eaters:b };
}

function addPlayerToBattle(battle, payload){
  // admin.js는 payload.playerData로 보냄. 둘 다 허용.
  const data = payload.playerData ? payload.playerData : payload;

  const { name, team, hp=100, stats={}, items={}, avatar='' } = data;
  if (!name) throw new Error('이름은 필수입니다.');
  const exists = findBattlePlayerByName(battle, name);
  if (exists) throw new Error(`이미 등록된 이름입니다: ${name}`);

  const maxPerTeam = maxTeamSizeByMode(battle.mode);
  const cnt = teamCounts(battle);
  if (team==='phoenix' && cnt.phoenix >= maxPerTeam) throw new Error(`phoenix 팀이 이미 가득 찼습니다 (${maxPerTeam}명)`);
  if (team==='eaters'  && cnt.eaters  >= maxPerTeam) throw new Error(`eaters 팀이 이미 가득 찼습니다 (${maxPerTeam}명)`);

  const p = {
    id: uid('player'),
    name,
    team: (team==='eaters'?'eaters':'phoenix'),
    maxHp: 100,
    hp: clamp(+hp||100, 1, 100),
    stats: {
      attack: clamp(+stats.attack||1, 1, 5),
      defense: clamp(+stats.defense||1, 1, 5),
      luck: clamp(+stats.luck||1, 1, 5),
      agility: clamp(+stats.agility||1, 1, 5),
    },
    items: {
      dittany: +items.dittany||0,
      attack_booster: +items.attack_booster||0,
      defense_booster: +items.defense_booster||0,
    },
    avatar,
    ready: false,
    socketId: null,
  };
  battle.players.push(p);
  return p;
}

// 선공 결정
function decideFirstTeam(battle){
  const sumTeam = (team) => battle.players
    .filter(p=>p.team===team && p.hp>0)
    .reduce((acc,p)=> acc + p.stats.agility + d20(), 0);

  let a = sumTeam('phoenix');
  let b = sumTeam('eaters');
  while (a===b){ a = sumTeam('phoenix'); b = sumTeam('eaters'); }

  battle.commitFirstTeam = (a>b) ? 'phoenix' : 'eaters';
  battle.currentTeam     = battle.commitFirstTeam;
  battle.phase           = (battle.currentTeam==='phoenix') ? 'commitA' : 'commitB';
  battle.turnStartTime   = now();

  io.to(battle.id).emit('battle:log', { message: `선공: ${teamAB(battle.currentTeam)}` });
}

// 라운드 해석(룰 변경 없음)
function resolveRound(battle){
  const alive = (p)=> p.hp>0;
  const playersById = Object.fromEntries(battle.players.map(p=>[p.id,p]));

  const turnBuff = new Map(); // pid -> { atkMul, defMul }
  const markAtkBoost = (pid)=>{ const o=turnBuff.get(pid)||{atkMul:1,defMul:1}; o.atkMul=1.5; turnBuff.set(pid,o); };
  const markDefBoost = (pid)=>{ const o=turnBuff.get(pid)||{atkMul:1,defMul:1}; o.defMul=1.5; turnBuff.set(pid,o); };

  // 아이템 처리
  for (const [team,box] of Object.entries(battle.commitBox)){
    for (const [pid, action] of Object.entries(box)){
      const p = playersById[pid]; if (!p || !alive(p)) continue;
      if (action?.type==='item'){
        if (action.itemType==='attack_booster' && p.items.attack_booster>0){
          markAtkBoost(pid); p.items.attack_booster -= 1;
          io.to(battle.id).emit('battle:log', { message: `${p.name} 공격 보정기 사용` });
        } else if (action.itemType==='defense_booster' && p.items.defense_booster>0){
          markDefBoost(pid); p.items.defense_booster -= 1;
          io.to(battle.id).emit('battle:log', { message: `${p.name} 방어 보정기 사용` });
        } else if (action.itemType==='dittany' && p.items.dittany>0){
          const target = playersById[action.targetId] || p;
          if (target && alive(target)){
            const before = target.hp;
            target.hp = Math.min(target.maxHp, target.hp + 10);
            p.items.dittany -= 1;
            io.to(battle.id).emit('battle:log', { message: `${p.name} 디터니 사용 → ${target.name} HP ${before}→${target.hp} (+${target.hp-before})` });
          }
        }
      }
    }
  }

  // 파생 값
  const getFinalAttack = (p)=> Math.floor((p.stats.attack * (turnBuff.get(p.id)?.atkMul||1))) + d20();
  const getFinalDefense = (p)=> Math.floor((p.stats.defense * (turnBuff.get(p.id)?.defMul||1)));
  const isCrit = (p)=> { const r=d20(); const need=20 - (p.stats.luck/2); return r>=need; };

  const boxes = [battle.commitBox.phoenix, battle.commitBox.eaters];
  const state = new Map(); // pid -> { defend, dodge }
  for (const box of boxes){
    for (const [pid, action] of Object.entries(box)){
      state.set(pid, { defend: action?.type==='defend', dodge: action?.type==='dodge' });
    }
  }

  for (const box of boxes){
    for (const [pid, action] of Object.entries(box)){
      const atk = playersById[pid]; if (!atk || !alive(atk)) continue;
      if (action?.type!=='attack') continue;

      const tgt = playersById[action.targetId]; if (!tgt || !alive(tgt)) continue;

      const atkPower = getFinalAttack(atk);
      const crit = isCrit(atk);
      let damage = 0;
      let head = `${atk.name}의 공격`;

      // 회피
      if (state.get(tgt.id)?.dodge){
        const ev = tgt.stats.agility + d20();
        if (ev >= atkPower){
          io.to(battle.id).emit('battle:log', { message: `${tgt.name} 회피 성공 → ${atk.name}의 공격 무효` });
          continue;
        } else {
          damage = (crit ? atkPower*2 : atkPower);
          head += ' (회피 실패)';
          const before = tgt.hp;
          tgt.hp = Math.max(0, tgt.hp - damage);
          io.to(battle.id).emit('battle:log', { message: `${head} → ${tgt.name} HP ${before}→${tgt.hp} (-${before-tgt.hp})` });
          if (tgt.hp<=0) io.to(battle.id).emit('battle:log', { message: `${tgt.name} 사망` });
          continue;
        }
      }

      // 방어
      if (state.get(tgt.id)?.defend){
        const defVal = getFinalDefense(tgt);
        damage = Math.max(1, (crit ? atkPower*2 : atkPower) - defVal);
        const before = tgt.hp;
        tgt.hp = Math.max(0, tgt.hp - damage);
        io.to(battle.id).emit('battle:log', { message: `${atk.name}의 공격 명중(방어 중) → ${tgt.name} HP ${before}→${tgt.hp} (-${before-tgt.hp})` });
        if (tgt.hp<=0){ io.to(battle.id).emit('battle:log', { message: `${tgt.name} 사망` }); continue; }

        // 역공격(방어 불가)
        const counter = atk.stats.attack + d20();
        const b2 = atk.hp;
        atk.hp = Math.max(0, atk.hp - counter);
        io.to(battle.id).emit('battle:log', { message: `${tgt.name} 역공격 → ${atk.name} HP ${b2}→${atk.hp} (-${b2-atk.hp})` });
        if (atk.hp<=0) io.to(battle.id).emit('battle:log', { message: `${atk.name} 사망` });
      } else {
        // 일반 피격
        damage = (crit ? atkPower*2 : atkPower);
        const before = tgt.hp;
        tgt.hp = Math.max(0, tgt.hp - damage);
        io.to(battle.id).emit('battle:log', { message: `${atk.name}의 공격 명중 → ${tgt.name} HP ${before}→${tgt.hp} (-${before-tgt.hp})` });
        if (tgt.hp<=0) io.to(battle.id).emit('battle:log', { message: `${tgt.name} 사망` });
      }
    }
  }

  // 승패
  const aAlive = battle.players.some(p=>p.team==='phoenix' && p.hp>0);
  const bAlive = battle.players.some(p=>p.team==='eaters'  && p.hp>0);
  if (!aAlive || !bAlive){
    battle.status = 'ended';
    battle.winnerTeam = aAlive ? 'phoenix' : bAlive ? 'eaters' : null;
    if (battle.winnerTeam){
      io.to(battle.id).emit('battle:log', { message: `전투 종료: ${teamAB(battle.winnerTeam)} 승리` });
    } else {
      io.to(battle.id).emit('battle:log', { message: `전투 종료: 무승부` });
    }
  }

  // 턴 증가 및 초기화
  battle.turn = (battle.turn||1) + 1;
  battle.commitBox = { phoenix:{}, eaters:{} };
}

// 브로드캐스트
function broadcastUpdate(battle){ io.to(battle.id).emit('battle:update', sanitizeBattle(battle)); }

// ===== REST =====
app.post('/api/battles', (req, res) => {
  try{
    const mode = String(req.body?.mode || '4v4');
    const battle = createBattle(mode);
    return res.json({ ok: true, battle: sanitizeBattle(battle) });
  }catch(e){
    console.error('[REST] POST /api/battles', e);
    return res.status(500).json({ ok:false, error:'서버 오류' });
  }
});

app.get('/api/battles/:id', (req, res) => {
  try{
    const battle = battles.get(req.params.id);
    if(!battle) return res.status(404).json({ ok:false, error:'전투를 찾을 수 없습니다.' });
    return res.json({ ok:true, battle: sanitizeBattle(battle) });
  }catch(e){
    console.error('[REST] GET /api/battles/:id', e);
    return res.status(500).json({ ok:false, error:'서버 오류' });
  }
});

app.post('/api/battles/:id/start', (req, res) => {
  try{
    const b = battles.get(req.params.id);
    if(!b) return res.status(404).json({ ok:false, error:'전투를 찾을 수 없습니다.' });
    if(b.status!=='waiting') return res.status(400).json({ ok:false, error:'대기 상태가 아닙니다.' });
    b.status='active';
    decideFirstTeam(b);
    broadcastUpdate(b);
    return res.json({ ok:true, battle: sanitizeBattle(b) });
  }catch(e){
    console.error('[REST] POST /api/battles/:id/start', e);
    return res.status(500).json({ ok:false, error:'서버 오류' });
  }
});

// ===== 소켓 =====
io.on('connection', (socket) => {
  console.log('[SOCKET] 새 연결:', socket.id);

  socket.on('disconnect', (reason)=> console.log('[SOCKET] 연결 해제:', socket.id, '(이유:', reason, ')'));

  // join: 문자열/객체 모두 허용
  socket.on('join', (payload)=>{
    const battleId = (typeof payload === 'string') ? payload : payload?.battleId;
    if(battleId){ socket.join(battleId); console.log('[SOCKET] join:', battleId); }
  });

  // 전투 생성: admin.js가 기대하는 응답으로 송신
  socket.on('createBattle', ({ mode })=>{
    try{
      const battle = createBattle(mode||'4v4');
      socket.join(battle.id);
      socket.emit('battleCreated', { success:true, battleId:battle.id, mode:battle.mode });
      broadcastUpdate(battle);
      console.log('[SOCKET] createBattle:', battle.mode, '→', battle.id);
    }catch(e){
      socket.emit('battleCreated', { success:false, error:String(e.message||e) });
    }
  });

  // 참가자 추가
  socket.on('addPlayer', (payload)=>{
    try{
      const battleId = payload.battleId || payload?.playerData?.battleId; // 혹시라도 들어올 수 있으니
      const battle = battles.get(battleId);
      if (!battle) throw new Error('전투를 찾을 수 없습니다.');
      const p = addPlayerToBattle(battle, payload);
      io.to(battle.id).emit('battle:update', sanitizeBattle(battle));
      console.log('[SOCKET] 전투 참가자 추가:', p.name);
    }catch(e){
      console.error('[SOCKET] addPlayer 오류:', e);
      socket.emit('battle:log', { message: String(e.message||e) });
    }
  });

  // 준비 완료
  socket.on('player:ready', ({ battleId, playerId })=>{
    const b = battles.get(battleId); if (!b) return;
    const p = b.players.find(x=>x.id===playerId); if (!p) return;
    p.ready = true;
    broadcastUpdate(b);
  });

  // 전투 제어
  socket.on('startBattle', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    if (b.status!=='waiting') return;
    b.status='active';
    decideFirstTeam(b);
    broadcastUpdate(b);
  });
  socket.on('pauseBattle', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    if (b.status!=='active') return;
    b.status='paused';
    broadcastUpdate(b);
  });
  socket.on('resumeBattle', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    if (b.status!=='paused') return;
    b.status='active';
    b.turnStartTime = now();
    broadcastUpdate(b);
  });
  socket.on('endBattle', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    b.status='ended';
    broadcastUpdate(b);
  });

  // 관전자 비밀번호 발급(관리자 기대 이벤트명에 맞춤)
  socket.on('generateSpectatorOtp', ({ battleId })=>{
    const b = battles.get(battleId);
    if(!b){ socket.emit('spectatorOtpGenerated', { success:false, error:'전투를 찾을 수 없습니다.' }); return; }
    b.spectatorOtp = `spectator-${b.id}`;
    const origin = process.env.PUBLIC_ORIGIN || '';
    const urlRel = `/spectator?battle=${b.id}&otp=${encodeURIComponent(b.spectatorOtp)}`;
    const spectatorUrl = origin ? `${origin}${urlRel}` : urlRel;
    socket.emit('spectatorOtpGenerated', { success:true, spectatorUrl, otp:b.spectatorOtp });
  });

  // 채팅
  socket.on('chat:send', ({ battleId, name, message, role })=>{
    const b = battles.get(battleId); if (!b) return;
    io.to(b.id).emit('battle:chat', { name, message, role: role||'player' });
  });

  // 플레이어 인증 (token/password 폴백 + 인코딩/비인코딩 허용)
  socket.on('playerAuth', ({ battleId, name, token:rawToken, password })=>{
    try{
      const token = rawToken || password || '';
      if (!battleId || !name || !token){
        return socket.emit('authError', { error: '필수 값이 누락되었습니다(battleId/name/token).' });
      }
      const b = battles.get(battleId);
      if (!b) return socket.emit('authError', { error: '전투를 찾을 수 없습니다.' });

      const p = findBattlePlayerByName(b, name);
      if (!p) return socket.emit('authError', { error: '등록되지 않은 전투 참가자입니다.' });

      const expectedRaw = `player-${name}-${battleId}`;
      const expectedEnc = `player-${encodeURIComponent(name)}-${battleId}`;
      if (token!==expectedRaw && token!==expectedEnc){
        return socket.emit('authError', { error: '비밀번호가 일치하지 않습니다.' });
      }

      p.socketId = socket.id;
      socket.join(battleId);
      socket.emit('auth:success', { battle: sanitizeBattle(b), player: sanitizePlayer(p) });
      broadcastUpdate(b);
      console.log('[SOCKET] 전투 참가자 인증 성공:', name, `(${p.id}) ->`, battleId);
    }catch(e){
      console.error('[SOCKET] 전투 참가자 인증 오류:', e);
      socket.emit('authError', { error: '서버 오류' });
    }
  });

  // 액션 커밋
  socket.on('player:action', ({ battleId, playerId, action })=>{
    const b = battles.get(battleId); if (!b) return;
    if (b.status!=='active') return;

    const p = b.players.find(x=>x.id===playerId); if (!p || p.hp<=0) return;

    const team = p.team; // 'phoenix' or 'eaters'
    if ((b.phase==='commitA' && team!=='phoenix') || (b.phase==='commitB' && team!=='eaters')){
      return socket.emit('actionError', { battleId, playerId, error:'현재 순서팀이 아닙니다.' });
    }

    b.commitBox[team][playerId] = action || { type:'pass' };
    io.to(battleId).emit('actionSuccess', { battleId, playerId, message: `${p.name} 액션 선택` });

    const aliveTeam = b.players.filter(x=>x.team===team && x.hp>0).map(x=>x.id);
    const committed = Object.keys(b.commitBox[team]);
    const allCommitted = aliveTeam.every(id => committed.includes(id));

    if (allCommitted){
      if (b.phase==='commitA'){
        b.phase='commitB'; b.currentTeam='eaters'; b.turnStartTime = now();
      } else if (b.phase==='commitB'){
        b.phase='resolve'; b.turnStartTime = now();
        io.to(battleId).emit('battle:log', { message:'라운드 해석 시작' });
        resolveRound(b);
        // 다음 턴: 직전 후공이 선공으로 전환
        b.commitFirstTeam = (b.commitFirstTeam==='phoenix') ? 'eaters' : 'phoenix';
        b.currentTeam = b.commitFirstTeam;
        b.phase = (b.currentTeam==='phoenix') ? 'commitA' : 'commitB';
        b.turnStartTime = now();
      }
      broadcastUpdate(b);
    } else {
      broadcastUpdate(b);
    }
  });
});

// 시작
const PORT = process.env.PORT || 3001;
server.listen(PORT, ()=> console.log(`[PYXIS] battle-server listening on :${PORT}`));
