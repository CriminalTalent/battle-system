// packages/battle-server/src/server.js
// ─────────────────────────────────────────────────────────────────────────────
// PYXIS Battle Server (final KR edition)
// - 팀 이름 고정: "불사조 기사단" / "죽음을 먹는 자들"
// - 관리자: 로스터 추가(스탯/아이템/아바타 URL) + 플레이어별 링크
// - 아바타 업로드: POST /api/upload/avatar (multer, form-data: battleId, adminOtp, avatar)
// - 플레이어: 이름(name) 또는 ID(pid) + OTP로 인증(둘 중 하나 제공, OTP 필수)
// - 관전자: 별도 OTP + 자유 닉네임 (최대 30명 동시)
// - 채팅: 기본 전체 / "/t " 프리픽스 팀채팅 (관리자 채팅은 항상 전체)
// - 전체 진행시간 1시간: 1초마다 timer:sync 브로드캐스트 + REST 조회 제공
// - 5분 미응답: "자동 패스"(행동 없이 턴 넘김) 처리
// - A팀 전원→B팀 전원→라운드 증가, 전원 사망 또는 시간만료 시 종료
// 디자인/색상/정적파일은 public/ 그대로 사용
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 30000,
  allowEIO3: true
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1m' }));

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store (단일 프로세스 가정)
// ─────────────────────────────────────────────────────────────────────────────
const BATTLES = new Map(); // battleId -> battleState

// ── 유틸
const now = () => Date.now();
const d20 = () => Math.floor(Math.random() * 20) + 1;
const rid = (p='') => (p ? p + '_' : '') + crypto.randomBytes(6).toString('hex');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const slug = s => String(s||'').trim();

// ── OTP
const makeOTP = (mins) => ({ token: crypto.randomBytes(8).toString('hex'), exp: now() + mins*60*1000 });
const validOTP = (otp) => otp && otp.exp > now();

// ─────────────────────────────────────────────────────────────────────────────
// 전투 규칙(요구 그대로)
// ─────────────────────────────────────────────────────────────────────────────
function calcHit(att, def) {
  const hitRoll = att.luk + d20();
  const dodgeRoll = def.agi + d20();
  return hitRoll >= dodgeRoll; // true면 명중
}
function calcCrit(att) {
  const roll = d20();
  return roll >= (20 - att.luk / 2); // 치명타
}
function baseDamage(att, def, atkBoost=1, defBoost=1) {
  const roll = d20();
  const atk = Math.round(att.atk * atkBoost);
  const dfs = Math.round(def.def * defBoost);
  const raw = atk + roll - dfs;
  return Math.max(1, raw);
}
function applyDamage(target, amount, attacker) {
  // guard: 추가 피해감소
  if (target.stance === 'guard') {
    const guardRoll = target.agi + d20() - attacker.atk;
    const reduce = Math.max(0, Math.floor(guardRoll));
    amount = Math.max(0, amount - reduce);
  }
  // evade: 완전 회피 가능
  if (target.stance === 'evade') {
    const success = (target.agi + d20()) >= attacker.atk;
    if (success) amount = 0;
  }
  target.hp = clamp(target.hp - amount, 0, 1000);
  return amount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 배틀 상태
// ─────────────────────────────────────────────────────────────────────────────
function newBattle({ mode='1v1' }) {
  const id = rid('battle');
  const adminOTP = makeOTP(60);        // 관리자 60분
  const playerOTPSeed = makeOTP(30);   // 표기용
  const watcherOTPPool = new Set();    // 관전자 30분
  const spectatorLimit = 30;

  const state = {
    id, mode,
    createdAt: now(),
    status: 'lobby', // lobby|active|ended
    round: 1,
    phase: 'A',      // A(불사조) → B(죽먹)
    timerEnd: now() + 60 * 60 * 1000, // 총 1시간
    teams: {
      A: { name: '불사조 기사단', players: [] },
      B: { name: '죽음을 먹는 자들', players: [] }
    },
    queueActed: { A: new Set(), B: new Set() },
    sockets: new Map(),     // socket.id -> {role, battleId, pid}
    adminOTP,
    playerOTPSeed,          // 정보용
    playerTokens: new Map(),// pid -> {token, exp}
    watcherOTPPool,
    spectatorLimit,
    chat: [],
    logs: [],
    inactivity: new Map(),  // pid -> timeoutId (5분)
    _timer: null            // 1초 주기 타이머 interval 핸들
  };
  BATTLES.set(id, state);
  return state;
}

function getPlayer(state, pid) {
  for (const side of ['A','B']) {
    const p = state.teams[side].players.find(x => x.id === pid);
    if (p) return p;
  }
  return null;
}
function findPlayerByName(state, name) {
  const key = slug(name).toLowerCase();
  for (const side of ['A','B']) {
    const p = state.teams[side].players.find(x => slug(x.name).toLowerCase() === key);
    if (p) return p;
  }
  return null;
}
function alivePlayers(state, side) {
  return state.teams[side].players.filter(p => p.hp > 0);
}
const currentSide = (state) => state.phase;

// ── 페이즈 완료 체크 및 전환
function markActed(state, pid) {
  for (const side of ['A','B']) {
    const ps = state.teams[side].players;
    if (ps.some(p => p.id === pid)) {
      state.queueActed[side].add(pid);
      const aliveCount = alivePlayers(state, side).length;
      if (state.queueActed[side].size >= aliveCount) {
        if (state.phase === 'A') {
          state.phase = 'B';
          state.queueActed.B.clear();
          io.to(state.id).emit('phase:change', { phase: 'B', round: state.round });
          armPhaseInactivity(state); // B팀 대기자 타이머 재설정
        } else {
          state.phase = 'A';
          state.round += 1;
          state.queueActed.A.clear();
          io.to(state.id).emit('phase:change', { phase: 'A', round: state.round });
          armPhaseInactivity(state); // A팀 대기자 타이머 재설정
        }
      }
      return;
    }
  }
}

// ── 선공 결정
function decideInitiative(state) {
  const sumAgi = (side) => alivePlayers(state, side).reduce((s,p)=>s+p.agi,0);
  let a = sumAgi('A') + d20();
  let b = sumAgi('B') + d20();
  while (a === b) { a = sumAgi('A') + d20(); b = sumAgi('B') + d20(); }
  state.phase = (a > b) ? 'A' : 'B';
  io.to(state.id).emit('phase:change', { phase: state.phase, round: state.round, initiative: {A:a, B:b} });
}

// ── 종료 체크
function checkEnd(state) {
  const deadA = alivePlayers(state, 'A').length === 0;
  const deadB = alivePlayers(state, 'B').length === 0;
  const timeup = now() >= state.timerEnd;
  if (deadA || deadB || timeup) {
    state.status = 'ended';
    clearBattleTimer(state);
    const sumHP = side => state.teams[side].players.reduce((s,p)=>s+Math.max(0,p.hp),0);
    const scoreA = sumHP('A');
    const scoreB = sumHP('B');
    const winner = scoreA === scoreB ? 'draw' : (scoreA > scoreB ? 'A' : 'B');
    io.to(state.id).emit('battle:end', { winner, scoreA, scoreB, timeup, deadA, deadB });
    return true;
  }
  return false;
}

// ── 라운드/페이즈별 5분 미응답 타이머: "자동 패스"
function armInactivityTimer(state, pid) {
  clearInactivity(state, pid);
  const to = setTimeout(() => {
    const actor = getPlayer(state, pid);
    if (!actor || actor.hp<=0 || state.status!=='active') return;
    // 자동 패스(행동 없이 턴 넘김)
    const line = { ts:now(), type:'auto', text:`${actor.name} (자동 패스)`, actor: actor.id };
    state.logs.unshift(line);
    io.to(state.id).emit('log:new', line);
    markActed(state, pid);
    checkEnd(state);
  }, 5 * 60 * 1000);
  state.inactivity.set(pid, to);
}
function clearInactivity(state, pid) {
  const to = state.inactivity.get(pid);
  if (to) clearTimeout(to);
  state.inactivity.delete(pid);
}
function armPhaseInactivity(state) {
  // 현재 페이즈 팀의 "아직 행동하지 않은 생존자" 모두 5분 타이머 장착
  const side = currentSide(state);
  alivePlayers(state, side)
    .filter(p=>!state.queueActed[side].has(p.id))
    .forEach(p=>armInactivityTimer(state, p.id));
}

// ── 전투 타이머(1초 주기 브로드캐스트)
function startBattleTimer(state) {
  clearBattleTimer(state);
  state._timer = setInterval(() => {
    if (state.status !== 'active') return;
    const remainMs = Math.max(0, state.timerEnd - now());
    io.to(state.id).emit('timer:sync', { now: now(), timerEnd: state.timerEnd, remainMs });
    if (remainMs <= 0) {
      checkEnd(state);
    }
  }, 1000);
}
function clearBattleTimer(state) {
  if (state._timer) { clearInterval(state._timer); state._timer = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multer 설정: 아바타 업로드 -> public/avatars/<battleId>/<filename>
// ─────────────────────────────────────────────────────────────────────────────
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const battleId = slug(req.body.battleId || req.query.battleId);
    const base = path.join(__dirname, '..', 'public', 'avatars', battleId || 'misc');
    ensureDir(base); cb(null, base);
  },
  filename: function(req, file, cb) {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, crypto.randomBytes(6).toString('hex') + '_' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => cb(/image\/(png|jpeg|jpg|webp|gif)/i.test(file.mimetype) ? null : new Error('INVALID_FILETYPE'), /image\/(png|jpeg|jpg|webp|gif)/i.test(file.mimetype))
});

// ─────────────────────────────────────────────────────────────────────────────
// REST API (모두 한글 응답)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req,res)=>res.json({ ok:true, ts:now() }));

// 전투 생성
app.post('/api/admin/battles', (req, res) => {
  const mode = String(req.body.mode || '1v1');
  const st = newBattle({ mode });
  res.json({
    ok: true,
    battleId: st.id,
    adminOTP: st.adminOTP.token,
    playerOTPSeed: st.playerOTPSeed.token,
    msg: '전투가 생성되었습니다.'
  });
});

// 아바타 업로드(관리자)
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    const battleId = slug(req.body.battleId || req.query.battleId);
    const adminOtp = slug(req.body.adminOtp || req.query.adminOtp);
    const st = BATTLES.get(battleId);
    if (!st) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
    }
    if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP)) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });
    }
    const rel = `/avatars/${battleId}/${req.file.filename}`;
    return res.json({ ok:true, url: rel, msg:'아바타가 업로드되었습니다.' });
  } catch {
    return res.status(500).json({ ok:false, error:'upload_failed', msg:'업로드에 실패했습니다.' });
  }
});

// 플레이어 추가(관리자)
app.post('/api/admin/battles/:id/players', (req, res) => {
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp, name, team, atk, def, agi, luk, items, avatar } = req.body;
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });

  const side = team === 'B' ? 'B' : 'A';
  const pid = rid('p');
  const p = {
    id: pid, name: String(name||'플레이어'),
    team: side, hp: 100,
    atk: clamp(Number(atk)||3,1,5),
    def: clamp(Number(def)||3,1,5),
    agi: clamp(Number(agi)||3,1,5),
    luk: clamp(Number(luk)||3,1,5),
    items: {
      atkBoost: Number(items?.atkBoost||0),
      defBoost: Number(items?.defBoost||0),
      dittany: Number(items?.dittany||0),
    },
    avatar: typeof avatar === 'string' ? avatar : '',
    stance: null,
    effects: { atkBoostTurns:0, defBoostTurns:0 }
  };
  st.teams[side].players.push(p);

  // 개인 참가 OTP 30분
  const tok = makeOTP(30);
  st.playerTokens.set(pid, tok);
  const base = process.env.PUBLIC_BASE_URL || '';
  res.json({
    ok:true,
    pid,
    joinURL: `${base}/play.html?battle=${st.id}&pid=${pid}&token=${tok.token}`,
    msg:'플레이어가 추가되었습니다.'
  });
});

// 관전자 OTP 발급(30분, 최대 30명)
app.post('/api/admin/battles/:id/watcher-otp', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body;
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });
  if (st.watcherOTPPool.size >= st.spectatorLimit)
    return res.status(429).json({ ok:false, error:'limit', msg:'관전자 한도(30명)에 도달했습니다.' });

  const otp = makeOTP(30);
  st.watcherOTPPool.add(otp.token);
  const base = process.env.PUBLIC_BASE_URL || '';
  res.json({
    ok:true,
    otp: otp.token,
    watchURL: `${base}/watch.html?battle=${st.id}&otp=${otp.token}`,
    msg:'관전자 링크가 발급되었습니다.'
  });
});

// 전투 시작
app.post('/api/admin/battles/:id/start', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body;
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });

  st.status = 'active';
  st.round = 1;
  st.phase = 'A';
  st.queueActed.A.clear(); st.queueActed.B.clear();
  // 1시간 타이머 재설정
  st.timerEnd = now() + 60*60*1000;
  decideInitiative(st);
  startBattleTimer(st);
  armPhaseInactivity(st);
  io.to(st.id).emit('battle:start', { battleId: st.id, round: st.round, phase: st.phase, timerEnd: st.timerEnd });
  res.json({ ok:true, msg:'전투가 시작되었습니다.' });
});

// 남은 시간 조회(REST) - 페이지에서 폴링용으로 쓸 수 있음
app.get('/api/battles/:id/time', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  res.json({ ok:true, now: now(), timerEnd: st.timerEnd, remainMs: Math.max(0, st.timerEnd - now()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // 방 참가 (admin | player | watcher)
  socket.on('join', (payload, cb)=>{
    try {
      const { role, battleId, pid, name, token, otp, nickname } = payload || {};
      const st = BATTLES.get(battleId);
      if (!st) return cb?.({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });

      let playerObj = null;

      if (role === 'admin') {
        if (token !== st.adminOTP.token || !validOTP(st.adminOTP))
          return cb?.({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });
      } else if (role === 'player') {
        // 이름 또는 ID + OTP
        if (pid) playerObj = getPlayer(st, pid);
        else if (name) playerObj = findPlayerByName(st, name);
        if (!playerObj) return cb?.({ ok:false, error:'player_not_found', msg:'플레이어를 찾을 수 없습니다.' });

        const t = st.playerTokens.get(playerObj.id);
        if (!t || t.token !== token || !validOTP(t))
          return cb?.({ ok:false, error:'forbidden', msg:'플레이어 인증 실패(OTP).' });
      } else if (role === 'watcher') {
        if (!st.watcherOTPPool.has(otp))
          return cb?.({ ok:false, error:'forbidden', msg:'관전자 OTP가 유효하지 않습니다.' });
      } else {
        return cb?.({ ok:false, error:'bad_role', msg:'역할(role)이 올바르지 않습니다.' });
      }

      socket.join(battleId);
      if (playerObj) socket.join(`${battleId}:${playerObj.team}`); // 팀채팅용 룸
      st.sockets.set(socket.id, { role, battleId, pid: playerObj?.id || pid || null, nickname: (nickname||'관전자').slice(0,24) });

      // 조인 응답 + 즉시 타이머 동기화 1회
      cb?.({ ok:true, state: publicState(st) });
      io.to(socket.id).emit('timer:sync', { now: now(), timerEnd: st.timerEnd, remainMs: Math.max(0, st.timerEnd - now()) });
      io.to(battleId).emit('presence:update', { count: io.sockets.adapter.rooms.get(battleId)?.size || 0 });
    } catch {
      cb?.({ ok:false, error:'exception', msg:'예기치 못한 오류입니다.' });
    }
  });

  // 채팅
  // - 기본: 전체 브로드캐스트
  // - "/t " 프리픽스: 팀채팅(플레이어만, 같은 팀 룸으로)
  // - 관리자 채팅은 항상 전체
  socket.on('chat:send', ({ battleId, text, nickname, role }) => {
    const st = BATTLES.get(battleId);
    if (!st || !text) return;

    const safeNick = String(nickname||'').slice(0,24) || (role==='admin'?'관리자': role==='player'?'플레이어':'관전자');
    const fromInfo = st.sockets.get(socket.id) || { role };
    const msg = {
      battleId,
      from: { nickname: safeNick, role: role || fromInfo.role },
      text: String(text).slice(0,500),
      ts: now(),
      scope: 'all'
    };

    if (role === 'admin') {
      st.chat.unshift(msg); st.chat = st.chat.slice(0,300);
      return io.to(battleId).emit('chat:new', msg);
    }

    const isTeamPrefix = /^\s*\/t\s+/i.test(msg.text);
    if (isTeamPrefix && fromInfo.role === 'player') {
      const pid = fromInfo.pid;
      const player = getPlayer(st, pid);
      if (player) {
        msg.text = msg.text.replace(/^\s*\/t\s+/i, '');
        msg.scope = 'team';
        st.chat.unshift(msg); st.chat = st.chat.slice(0,300);
        return io.to(`${battleId}:${player.team}`).emit('chat:new', msg);
      }
    }

    st.chat.unshift(msg); st.chat = st.chat.slice(0,300);
    io.to(battleId).emit('chat:new', msg);
  });

  // 행동: attack / defend / evade / item / pass
  socket.on('action', (data, cb)=>{
    const { battleId, pid, name, kind, targetId, item } = data || {};
    const st = BATTLES.get(battleId);
    if (!st || st.status!=='active') return cb?.({ ok:false, error:'bad_state', msg:'전투가 활성 상태가 아닙니다.' });

    let actor = null;
    if (pid) actor = getPlayer(st, pid);
    if (!actor && name) actor = findPlayerByName(st, name);
    if (!actor || actor.hp<=0) return cb?.({ ok:false, error:'actor_invalid', msg:'행동 주체가 올바르지 않습니다.' });

    // 페이즈 팀 체크
    if (currentSide(st) !== actor.team) return cb?.({ ok:false, error:'not_your_phase', msg:'현재 당신의 팀 차례가 아닙니다.' });
    if (st.queueActed[actor.team].has(actor.id)) return cb?.({ ok:false, error:'already_acted', msg:'이미 이 라운드에 행동했습니다.' });

    // 미응답 타이머 해제
    clearInactivity(st, actor.id);

    let logLine = null;

    // 보정기 지속 턴 감소
    if (actor.effects.atkBoostTurns>0) actor.effects.atkBoostTurns--;
    if (actor.effects.defBoostTurns>0) actor.effects.defBoostTurns--;

    if (kind === 'attack') {
      const defender = getPlayer(st, targetId);
      if (!defender || defender.hp<=0) return cb?.({ ok:false, error:'bad_target', msg:'대상이 올바르지 않습니다.' });

      const hit = calcHit(actor, defender);
      if (!hit) {
        logLine = { ts:now(), type:'attack', attacker: actor.name, defender: defender.name, hit:false, text:`${actor.name}의 공격을 ${defender.name}이(가) 회피!` };
      } else {
        const crit = calcCrit(actor);
        const atkMul = (actor.effects.atkBoostTurns>0) ? 1.5 : 1.0;
        const defMul = (defender.effects.defBoostTurns>0) ? 1.5 : 1.0;
        let dmg = baseDamage(actor, defender, atkMul, defMul);
        if (crit) dmg *= 2;
        dmg = Math.round(dmg);
        const dealt = applyDamage(defender, dmg, actor);
        logLine = { ts:now(), type:'attack', attacker: actor.name, defender: defender.name, hit:true, critical: crit, damage: dealt, text:`${actor.name} → ${defender.name} : ${dealt} 피해${crit?' (치명타)':''}` };
      }
    }
    else if (kind === 'defend') {
      actor.stance = 'guard';
      actor.effects.defBoostTurns = 1; // 1턴
      logLine = { ts:now(), type:'defend', actor: actor.name, text:`${actor.name} 방어 태세` };
    }
    else if (kind === 'evade') {
      actor.stance = 'evade';
      logLine = { ts:now(), type:'evade', actor: actor.name, text:`${actor.name} 회피 태세` };
    }
    else if (kind === 'item') {
      if (!item) return cb?.({ ok:false, error:'no_item', msg:'아이템이 지정되지 않았습니다.' });
      if (item === 'atkBoost') {
        if (actor.items.atkBoost<=0) return cb?.({ ok:false, error:'no_stock', msg:'공격 보정기 재고가 없습니다.' });
        actor.items.atkBoost--;
        const success = (Math.random() < 0.10);
        if (success) actor.effects.atkBoostTurns = 1;
        logLine = { ts:now(), type:'item', actor: actor.name, text:`${actor.name} 공격 보정기 사용 → ${success?'성공(1턴 ×1.5)':'실패(소모됨)'}` };
      } else if (item === 'defBoost') {
        if (actor.items.defBoost<=0) return cb?.({ ok:false, error:'no_stock', msg:'방어 보정기 재고가 없습니다.' });
        actor.items.defBoost--;
        const success = (Math.random() < 0.10);
        if (success) actor.effects.defBoostTurns = 1;
        logLine = { ts:now(), type:'item', actor: actor.name, text:`${actor.name} 방어 보정기 사용 → ${success?'성공(1턴 ×1.5)':'실패(소모됨)'}` };
      } else if (item === 'dittany') {
        if (actor.items.dittany<=0) return cb?.({ ok:false, error:'no_stock', msg:'디터니 재고가 없습니다.' });
        actor.items.dittany--;
        const heal = 10;
        actor.hp = clamp(actor.hp + heal, 0, 1000);
        logLine = { ts:now(), type:'item', actor: actor.name, text:`${actor.name} 디터니 사용 → ${heal} 회복` };
      } else {
        return cb?.({ ok:false, error:'bad_item', msg:'알 수 없는 아이템입니다.' });
      }
    }
    else if (kind === 'pass') {
      logLine = { ts:now(), type:'pass', actor: actor.name, text:`${actor.name} 패스` };
    }
    else {
      return cb?.({ ok:false, error:'bad_kind', msg:'알 수 없는 행동입니다.' });
    }

    // 로그/턴 처리
    actor.stance = actor.stance || null;
    st.logs.unshift(logLine);
    io.to(st.id).emit('log:new', logLine);
    cb?.({ ok:true, msg:'행동이 처리되었습니다.' });

    markActed(st, actor.id);
    if (!checkEnd(st)) armPhaseInactivity(st);
  });

  socket.on('disconnect', ()=>{
    const entry = [...BATTLES.values()].find(b => b.sockets.has(socket.id));
    if (!entry) return;
    entry.sockets.delete(socket.id);
    io.to(entry.id).emit('presence:update', { count: io.sockets.adapter.rooms.get(entry.id)?.size || 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 공개 상태(클라이언트 동기화용)
// ─────────────────────────────────────────────────────────────────────────────
function publicState(st) {
  return {
    id: st.id,
    mode: st.mode,
    status: st.status,
    round: st.round,
    phase: st.phase,
    timerEnd: st.timerEnd,
    teams: ['A','B'].map(s=>({
      side: s,
      name: st.teams[s].name,
      players: st.teams[s].players.map(p=>({
        id:p.id, name:p.name, hp:p.hp, atk:p.atk, def:p.def, agi:p.agi, luk:p.luk, avatar:p.avatar||''
      }))
    })),
    chat: st.chat.slice(0,30),
    logs: st.logs.slice(0,30),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, ()=>console.log('[battle] listening on', PORT));
