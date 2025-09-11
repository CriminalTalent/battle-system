// packages/battle-server/index.js
// ESM 서버 (package.json "type":"module")
// 하드가드 준수: 룰/전투 로직 변경 없음

import express from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';

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

// 라우팅 바로가기
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pages', 'admin.html'));
});
app.get('/player', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'player.html'));
});
app.get('/spectator', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'spectator.html'));
});

// REST: 헬스
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'battle-server' });
});

// REST: 아바타 업로드
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
  // 1v1,2v2,3v3,4v4 → 팀 당 인원
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
    winnerTeam: b.winnerTeam || null
  };
}

// ===== 전투 생성 =====
function createBattle(mode='4v4'){
  const id = uid('battle');
  const battle = {
    id, mode, status: 'waiting',
    players: [],
    phase: 'commitA',
    commitFirstTeam: 'phoenix', // A팀 시작(게임 시작 시 선공 계산으로 갱신)
    currentTeam: 'phoenix',
    turnStartTime: now(),
    readyCount: 0,
    winnerTeam: null,
    commitBox: { phoenix: {}, eaters: {} }, // { playerId: action }
    spectatorOtp: `spectator-${id}`
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
  const { name, team, hp=100, stats={}, items={}, avatar='' } = payload;
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

// ===== 선공 계산 =====
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

// ===== 라운드 해석 =====
function resolveRound(battle){
  // 규칙(하드가드) 준수:
  // - 공격: 공격스탯 + d20
  // - 방어 선택 시: 피해 = 최종공격력 − 방어력 (최소 1), 이후 역공격(방어 불가)
  // - 회피: 민첩 + d20 ≥ 상대 최종 공격력 → 완전 회피, 실패 시 방어력 차감 없이 정면 피해
  // - 치명타: d20 ≥ (20 − 행운/2) → 피해 2배
  // - 아이템: 공격/방어 보정기 ×1.5(1턴), 디터니 +10

  const alive = (p)=> p.hp>0;
  const playersById = Object.fromEntries(battle.players.map(p=>[p.id,p]));

  // 1턴 한정 버프 적용값 준비
  const turnBuff = new Map(); // pid -> { atkMul, defMul }
  const markAtkBoost = (pid)=>{ const o=turnBuff.get(pid)||{atkMul:1,defMul:1}; o.atkMul=1.5; turnBuff.set(pid,o); };
  const markDefBoost = (pid)=>{ const o=turnBuff.get(pid)||{atkMul:1,defMul:1}; o.defMul=1.5; turnBuff.set(pid,o); };

  // 아이템/스킬 선언부
  for (const [team,box] of Object.entries(battle.commitBox)){
    for (const [pid, action] of Object.entries(box)){
      const p = playersById[pid]; if (!p || !alive(p)) continue;
      if (action?.type==='item'){
        if (action.itemType==='attack_booster' && p.items.attack_booster>0){
          markAtkBoost(pid);
          p.items.attack_booster -= 1;
          io.to(battle.id).emit('battle:log', { message: `${p.name} 공격 보정기 사용` });
        } else if (action.itemType==='defense_booster' && p.items.defense_booster>0){
          markDefBoost(pid);
          p.items.defense_booster -= 1;
          io.to(battle.id).emit('battle:log', { message: `${p.name} 방어 보정기 사용` });
        } else if (action.itemType==='dittany' && p.items.dittany>0){
          const target = playersById[action.targetId] || p;
          if (target && alive(target)){
            const before = target.hp;
            target.hp = clamp(target.hp + 10, 0, target.maxHp);
            p.items.dittany -= 1;
            io.to(battle.id).emit('battle:log', { message: `${p.name} 디터니 사용 → ${target.name} HP ${before}→${target.hp} (+${target.hp-before})` });
          }
        }
      }
    }
  }

  // 전투 해석: 공격/방어/회피
  const getFinalAttack = (p)=>{
    const mul = (turnBuff.get(p.id)?.atkMul||1);
    return Math.floor((p.stats.attack * mul)) + d20();
  };
  const getFinalDefense = (p)=>{
    const mul = (turnBuff.get(p.id)?.defMul||1);
    return Math.floor((p.stats.defense * mul));
  };
  const isCrit = (p)=> {
    const r = d20();
    const need = 20 - (p.stats.luck/2);
    return r >= need;
  };

  // 선수팀/후수팀 관계 없이 일괄 처리
  const boxes = [battle.commitBox.phoenix, battle.commitBox.eaters];

  // 방어/회피 상태 캐시
  const state = new Map(); // pid -> { defend:bool, dodge:bool }
  for (const box of boxes){
    for (const [pid, action] of Object.entries(box)){
      state.set(pid, {
        defend: action?.type==='defend',
        dodge : action?.type==='dodge'
      });
    }
  }

  // 공격 처리
  for (const box of boxes){
    for (const [pid, action] of Object.entries(box)){
      const atk = playersById[pid]; if (!atk || !alive(atk)) continue;
      if (action?.type!=='attack') continue;

      const tgt = playersById[action.targetId]; if (!tgt || !alive(tgt)) continue;

      const atkPower = getFinalAttack(atk);
      const crit = isCrit(atk);
      let damage = 0;
      let logHead = `${atk.name}의 공격`;

      if (state.get(tgt.id)?.dodge){
        // 회피: 민첩 + d20 vs 상대 최종공격력
        const ev = tgt.stats.agility + d20();
        if (ev >= atkPower){
          io.to(battle.id).emit('battle:log', { message: `${tgt.name} 회피 성공 → ${atk.name}의 공격 무효` });
          continue;
        } else {
          // 실패: 방어력 차감 없이 정면 피해
          damage = (crit ? atkPower*2 : atkPower);
          logHead += ' (회피 실패)';
          const before = tgt.hp;
          tgt.hp = clamp(tgt.hp - damage, 0, tgt.maxHp);
          io.to(battle.id).emit('battle:log', { message: `${logHead} → ${tgt.name} HP ${before}→${tgt.hp} (-${before-tgt.hp})` });
          if (tgt.hp<=0) io.to(battle.id).emit('battle:log', { message: `${tgt.name} 사망` });
          continue;
        }
      }

      if (state.get(tgt.id)?.defend){
        // 방어: 피해 = 공격 - 방어(보정 포함), 최소 1
        const defVal = getFinalDefense(tgt);
        damage = Math.max(1, (crit ? atkPower*2 : atkPower) - defVal);
        const before = tgt.hp;
        tgt.hp = clamp(tgt.hp - damage, 0, tgt.maxHp);
        io.to(battle.id).emit('battle:log', { message: `${atk.name}의 공격 명중(방어 중) → ${tgt.name} HP ${before}→${tgt.hp} (-${before-tgt.hp})` });
        if (tgt.hp<=0){ io.to(battle.id).emit('battle:log', { message: `${tgt.name} 사망` }); continue; }

        // 역공격(방어 불가): 공격스탯 + d20
        const counter = atk.stats.attack + d20();
        const b2 = atk.hp;
        atk.hp = clamp(atk.hp - counter, 0, atk.maxHp);
        io.to(battle.id).emit('battle:log', { message: `${tgt.name} 역공격 → ${atk.name} HP ${b2}→${atk.hp} (-${b2-atk.hp})` });
        if (atk.hp<=0) io.to(battle.id).emit('battle:log', { message: `${atk.name} 사망` });
      } else {
        // 일반 맞기(방어/회피 아님)
        damage = (crit ? atkPower*2 : atkPower);
        const before = tgt.hp;
        tgt.hp = clamp(tgt.hp - damage, 0, tgt.maxHp);
        io.to(battle.id).emit('battle:log', { message: `${atk.name}의 공격 명중 → ${tgt.name} HP ${before}→${tgt.hp} (-${before-tgt.hp})` });
        if (tgt.hp<=0) io.to(battle.id).emit('battle:log', { message: `${tgt.name} 사망` });
      }
    }
  }

  // 라운드 종료/승패 판정
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

  // 커밋 박스 초기화
  battle.commitBox = { phoenix:{}, eaters:{} };
}

// ===== 페이즈 전환 =====
function flipCommitPhase(battle){
  if (battle.phase==='commitA'){
    battle.phase='commitB'; battle.currentTeam='eaters';
  } else if (battle.phase==='commitB'){
    battle.phase='resolve'; battle.currentTeam='eaters'; // resolve 직전 표시용
  } else {
    // resolve → 다음 턴 시작
    battle.phase = (battle.commitFirstTeam==='phoenix') ? 'commitB' : 'commitA';
    battle.commitFirstTeam = (battle.commitFirstTeam==='phoenix') ? 'eaters' : 'phoenix';
    battle.currentTeam = battle.commitFirstTeam;
  }
  battle.turnStartTime = now();
}

function broadcastUpdate(battle){
  io.to(battle.id).emit('battle:update', sanitizeBattle(battle));
}

// ===== 소켓 =====
io.on('connection', (socket) => {
  console.log('[SOCKET] 새 연결:', socket.id);

  socket.on('disconnect', (reason)=> {
    console.log('[SOCKET] 연결 해제:', socket.id, '(이유:', reason, ')');
  });

  // join (룸 참여)
  socket.on('join', (battleId)=>{
    socket.join(battleId);
    console.log('[SOCKET] join 이벤트:', battleId);
  });

  // 전투 생성
  socket.on('createBattle', ({ mode })=>{
    const battle = createBattle(mode||'4v4');
    console.log('[SOCKET] createBattle:', battle.mode, '→', battle.id);
    socket.join(battle.id);
    io.to(battle.id).emit('battle:update', sanitizeBattle(battle));
  });

  // 참가자 추가
  socket.on('addPlayer', (payload)=>{
    try{
      const battle = battles.get(payload.battleId);
      if (!battle) throw new Error('전투를 찾을 수 없습니다.');
      const p = addPlayerToBattle(battle, payload);
      console.log('[SOCKET] 전투 참가자 추가 완료:', p.name);
      io.to(battle.id).emit('battle:update', sanitizeBattle(battle));
    }catch(e){
      console.error('[SOCKET] 전투 참가자 추가 오류:', e);
      socket.emit('battle:log', { message: String(e.message||e) });
    }
  });

  // 준비 완료
  socket.on('player:ready', ({ battleId, playerId })=>{
    const b = battles.get(battleId); if (!b) return;
    const p = b.players.find(x=>x.id===playerId); if (!p) return;
    p.ready = true;
    io.to(b.id).emit('battle:update', sanitizeBattle(b));
  });

  // 전투 시작
  socket.on('startBattle', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    if (b.status!=='waiting') return;
    b.status = 'active';
    decideFirstTeam(b);
    io.to(b.id).emit('battle:update', sanitizeBattle(b));
    console.log('[SOCKET] 전투 시작:', b.id);
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

  // 참여자 링크 생성(옵션) — 현재 등록된 플레이어 이름으로 링크 빌드
  socket.on('generatePlayerLinks', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    const origin = process.env.PUBLIC_ORIGIN || '';
    const links = b.players.map(p=>{
      const t = `player-${encodeURIComponent(p.name)}-${b.id}`;
      return { name: p.name, url: `${origin}/player?battle=${b.id}&token=${t}&name=${encodeURIComponent(p.name)}` };
    });
    socket.emit('playerLinks', { links });
  });

  // 관전자 OTP 생성
  socket.on('generateSpectatorOtp', ({ battleId })=>{
    const b = battles.get(battleId); if (!b) return;
    // spectator-<battleId> 기본 형식 유지
    b.spectatorOtp = `spectator-${b.id}`;
    socket.emit('spectatorOtp', { otp: b.spectatorOtp });
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
      io.to(battleId).emit('battle:update', sanitizeBattle(b));
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

    // 저장
    b.commitBox[team][playerId] = action || { type:'pass' };
    io.to(battleId).emit('actionSuccess', { battleId, playerId, message: `${p.name} 액션 선택` });

    // 팀 내 생존자 모두 커밋했는지
    const aliveTeam = b.players.filter(x=>x.team===team && x.hp>0).map(x=>x.id);
    const committed = Object.keys(b.commitBox[team]);
    const allCommitted = aliveTeam.every(id => committed.includes(id));

    if (allCommitted){
      if (b.phase==='commitA'){
        b.phase='commitB'; b.currentTeam='eaters'; b.turnStartTime = now();
      } else if (b.phase==='commitB'){
        b.phase='resolve'; b.turnStartTime = now();
        // 해석
        io.to(battleId).emit('battle:log', { message:'라운드 해석 시작' });
        resolveRound(b);
        // 다음 턴 교대
        b.phase='commitA'; // 임시
        // 직전 후공이 선공으로 전환
        b.commitFirstTeam = (b.commitFirstTeam==='phoenix') ? 'eaters' : 'phoenix';
        b.currentTeam = b.commitFirstTeam;
        b.phase = (b.currentTeam==='phoenix') ? 'commitA' : 'commitB';
        b.turnStartTime = now();
      }
      io.to(battleId).emit('battle:update', sanitizeBattle(b));
    } else {
      io.to(battleId).emit('battle:update', sanitizeBattle(b));
    }
  });
});

// ===== 시작 =====
const PORT = process.env.PORT || 3001;
server.listen(PORT, ()=> {
  console.log(`[PYXIS] battle-server listening on :${PORT}`);
});
