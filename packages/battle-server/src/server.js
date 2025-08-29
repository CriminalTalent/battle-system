// packages/battle-server/src/server.js
// ─────────────────────────────────────────────────────────────────────────────
// PYXIS Battle Server (Unified, KR)
// - 팀 이름 고정: "불사조 기사단"(A) / "죽음을 먹는 자들"(B)
// - 관리자: 로스터 추가(스탯/아이템/아바타 업로드) + 플레이어별 링크
// - 아바타 업로드: POST /api/upload/avatar (multer; form-data: battleId, adminOtp, avatar)
//   + 호환: POST /api/battles/:id/avatar (JSON dataUrl)
// - 플레이어: 이름(name) 또는 ID(pid) + OTP로 인증(둘 중 하나 제공, OTP 필수)
// - 관전자: 별도 OTP + 자유 닉네임 (최대 30명 동시)
// - 채팅: 기본 전체 / "/t " 프리픽스 팀채팅 (관리자 채팅은 항상 전체)
// - 전체 진행시간 1시간: 1초마다 timer:sync 브로드캐스트
// - 5분 미응답: "자동 패스"(행동 없이 턴 넘김) 처리
// - A팀 전원→B팀 전원→라운드 증가, 전원 사망 또는 시간만료 시 종료
// - 프론트 호환: 이벤트/엔드포인트 신규/레거시 모두 지원
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const multer = require('multer');

const DEBUG = process.env.DEBUG?.includes('pyxis');
const log = (...a)=> DEBUG && console.log('[pyxis]', ...a);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 30000,
  allowEIO3: true,
  perMessageDeflate: { threshold: 1024 },
  httpCompression: true
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
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
  const playerOTPSeed = makeOTP(30);   // (정보용)
  const watcherOTPPool = new Map();    // token -> exp (관전자 30분)
  const spectatorLimit = 30;

  // 생성 시 기본 관전자 OTP 1개 제공(편의)
  const initialWatcher = makeOTP(30);
  watcherOTPPool.set(initialWatcher.token, initialWatcher.exp);

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
    sockets: new Map(),     // socket.id -> {role, battleId, pid, team, nickname}
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

  return { state, initialWatcher };
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
          io.to(state.id).emit('phase:change', { phase: 'team2', round: state.round });
          armPhaseInactivity(state);
        } else {
          state.phase = 'A';
          state.round += 1;
          state.queueActed.A.clear();
          io.to(state.id).emit('phase:change', { phase: 'team1', round: state.round });
          armPhaseInactivity(state);
        }
        emitState(state);
      }
      return;
    }
  }
}

// 선공 결정
function decideInitiative(state) {
  const sumAgi = (side) => alivePlayers(state, side).reduce((s,p)=>s+p.agi,0);
  let a = sumAgi('A') + d20();
  let b = sumAgi('B') + d20();
  while (a === b) { a = sumAgi('A') + d20(); b = sumAgi('B') + d20(); }
  state.phase = (a > b) ? 'A' : 'B';
  io.to(state.id).emit('phase:change', { phase: (state.phase==='A'?'team1':'team2'), round: state.round, initiative: {A:a, B:b} });
}

// 종료 체크
function checkEnd(state) {
  const deadA = alivePlayers(state, 'A').length === 0;
  const deadB = alivePlayers(state, 'B').length === 0;
  const timeup = now() >= state.timerEnd;
  if (deadA || deadB || timeup) {
    state.status = 'ended';
    clearBattleTimer(state);
    for (const to of state.inactivity.values()) clearTimeout(to);
    state.inactivity.clear();

    const sumHP = side => state.teams[side].players.reduce((s,p)=>s+Math.max(0,p.hp),0);
    const scoreA = sumHP('A');
    const scoreB = sumHP('B');
    const winner = scoreA === scoreB ? 'draw' : (scoreA > scoreB ? 'A' : 'B');
    io.to(state.id).emit('battle:end', { winner: (winner==='draw'?'draw':(winner==='A'?'team1':'team2')), scoreA, scoreB, timeup, deadA, deadB });
    emitState(state);
    return true;
  }
  return false;
}

// 5분 미응답 타이머
function armInactivityTimer(state, pid) {
  clearInactivity(state, pid);
  const to = setTimeout(() => {
    const actor = getPlayer(state, pid);
    if (!actor || actor.hp<=0 || state.status!=='active') return;
    const line = { ts:now(), type:'auto', text:`${actor.name} (자동 패스)`, actor: actor.id };
    state.logs.unshift(line);
    io.to(state.id).emit('log:new', line);
    markActed(state, pid);
    emitState(state);
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
  const side = currentSide(state);
  alivePlayers(state, side)
    .filter(p=>!state.queueActed[side].has(p.id))
    .forEach(p=>armInactivityTimer(state, p.id));
}

// 전투 타이머(1초 주기 브로드캐스트)
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

function isProbablyImage(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const sig = buffer.slice(0,4).toString('hex');
  return sig.startsWith('ffd8') /*jpg*/ || sig==='89504e47' /*png*/ || sig==='47494638' /*gif*/ || sig==='52494646' /*webp riff*/;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST API (모두 한글 응답, 호환 필드 포함)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req,res)=>res.json({ ok:true, ts:now() }));

// 전투 생성
app.post('/api/admin/battles', (req, res) => {
  const mode = String(req.body.mode || '1v1');
  const { state: st, initialWatcher } = newBattle({ mode });
  const base = process.env.PUBLIC_BASE_URL || '';
  const watchURL = `${base}/watch.html?battle=${st.id}&token=${initialWatcher.token}`;
  // 호환/편의 형태 모두 제공
  res.json({
    ok: true,
    // 신규 프론트 기대
    battle: { id: st.id, mode: st.mode },
    otps: { admin: st.adminOTP.token, spectator: initialWatcher.token },
    urls: { watch: watchURL },
    // 간단형(레거시/스크립트용)
    battleId: st.id,
    adminOTP: st.adminOTP.token,
    spectatorOTP: initialWatcher.token,
    playerOTPSeed: st.playerOTPSeed.token,
    watchURL,
    msg: '전투가 생성되었습니다.'
  });
});

// 전투 조회(프론트 초기 불러오기 용)
app.get('/api/battles/:id', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  return res.json({ ok:true, state: publicState(st) });
});

// 아바타 업로드(관리자·multer)
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
    // 매직넘버 간단 검증
    if (req.file?.path) {
      const fd = fs.openSync(req.file.path, 'r');
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      if (!isProbablyImage(buf)) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ ok:false, msg:'이미지 파일이 아닙니다.' });
      }
    }
    const rel = `/avatars/${battleId}/${req.file.filename}`;
    return res.json({ ok:true, url: rel, msg:'아바타가 업로드되었습니다.' });
  } catch {
    return res.status(500).json({ ok:false, error:'upload_failed', msg:'업로드에 실패했습니다.' });
  }
});

// 호환: dataUrl 업로드(관리자, 선택 API)
app.post('/api/battles/:id/avatar', async (req,res)=>{
  try {
    const st = BATTLES.get(req.params.id);
    if (!st) return res.status(404).json({ ok:false, msg:'전투를 찾을 수 없습니다.' });
    const { adminOtp, pid, dataUrl } = req.body || {};
    if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
      return res.status(403).json({ ok:false, msg:'관리자 인증 실패(OTP).' });
    const m = String(dataUrl||'').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!m) return res.status(400).json({ ok:false, msg:'dataUrl 형식 오류' });
    const ext = m[1].toLowerCase()==='jpeg'?'jpg':m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 10) return res.status(400).json({ ok:false, msg:'이미지 데이터가 비어있습니다.' });
    if (!isProbablyImage(buf)) return res.status(400).json({ ok:false, msg:'이미지 파일이 아닙니다.' });

    const base = path.join(__dirname, '..', 'public', 'avatars', st.id);
    ensureDir(base);
    const filename = crypto.randomBytes(6).toString('hex') + '_' + Date.now() + '.' + ext;
    fs.writeFileSync(path.join(base, filename), buf);
    const url = `/avatars/${st.id}/${filename}`;
    if (pid) {
      const p = getPlayer(st, pid);
      if (p) p.avatar = url;
      emitState(st);
    }
    return res.json({ ok:true, url });
  } catch {
    return res.status(500).json({ ok:false, msg:'업로드 실패' });
  }
});

// 플레이어 추가(권장 엔드포인트)
app.post('/api/admin/battles/:id/players', (req, res) => {
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp, name, team, stats, inventory, avatar } = req.body || {};
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });

  const side = (team==='team2' || team==='B') ? 'B' : 'A';
  const pid = rid('p');
  const p = buildPlayer(pid, name, side, stats, inventory, avatar);
  st.teams[side].players.push(p);

  const tok = makeOTP(30);
  st.playerTokens.set(pid, tok);
  const base = process.env.PUBLIC_BASE_URL || '';
  const joinURL = `${base}/play.html?battle=${st.id}&pid=${pid}&token=${tok.token}`;

  emitState(st);
  res.json({ ok:true, pid, joinURL, msg:'플레이어가 추가되었습니다.' });
});

// 플레이어 추가(호환, adminOtp 생략 허용 - 개발 편의)
app.post('/api/battles/:id/players', (req, res) => {
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp, name, team, stats, inventory, avatar } = req.body || {};
  // adminOtp 있으면 검증
  if (adminOtp && (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP)))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });

  const side = (team==='team2' || team==='B') ? 'B' : 'A';
  const pid = rid('p');
  const p = buildPlayer(pid, name, side, stats, inventory, avatar);
  st.teams[side].players.push(p);

  const tok = makeOTP(30);
  st.playerTokens.set(pid, tok);
  const base = process.env.PUBLIC_BASE_URL || '';
  const joinURL = `${base}/play.html?battle=${st.id}&pid=${pid}&token=${tok.token}`;

  emitState(st);
  res.json({ ok:true, pid, joinURL, msg:'플레이어가 추가되었습니다.' });
});

function buildPlayer(pid, name, side, stats={}, inventory=[], avatar='') {
  // stats: {attack, defense, agility, luck} from admin UI
  const s = {
    attack: clamp(Number(stats?.attack||3),1,10),
    defense: clamp(Number(stats?.defense||3),1,10),
    agility: clamp(Number(stats?.agility||3),1,10),
    luck: clamp(Number(stats?.luck||3),1,10),
  };
  // inventory: ["디터니","공격 보정기","방어 보정기"] or object counts
  const inv = Array.isArray(inventory) ? inventory : [];
  // 내부 모델
  return {
    id: pid, name: String(name||'플레이어'),
    team: side, hp: 1000, // 내부는 넉넉히, 프론트는 퍼센트로 사용
    atk: s.attack, def: s.defense, agi: s.agility, luk: s.luck,
    items: {
      atkBoost: inv.filter(x=>x==='공격 보정기').length,
      defBoost: inv.filter(x=>x==='방어 보정기').length,
      dittany:   inv.filter(x=>x==='디터니').length,
    },
    avatar: typeof avatar === 'string' ? avatar : '',
    stance: null,
    effects: { atkBoostTurns:0, defBoostTurns:0 }
  };
}

// 플레이어별 링크 생성
app.post('/api/admin/battles/:id/links', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body || {};
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });

  const base = process.env.PUBLIC_BASE_URL || '';
  const links = [];
  for (const side of ['A','B']) {
    for (const p of st.teams[side].players) {
      let tok = st.playerTokens.get(p.id);
      if (!tok || !validOTP(tok)) {
        tok = makeOTP(30);
        st.playerTokens.set(p.id, tok);
      }
      links.push({
        id: p.id,
        name: p.name,
        team: (side==='A'?'team1':'team2'),
        url: `${base}/play.html?battle=${st.id}&pid=${p.id}&token=${tok.token}`
      });
    }
  }
  res.json({ ok:true, playerLinks: links });
});

// 관전자 OTP 발급(30분, 최대 30명)
app.post('/api/admin/battles/:id/watcher-otp', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body||{};
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });
  if (st.watcherOTPPool.size >= st.spectatorLimit)
    return res.status(429).json({ ok:false, error:'limit', msg:'관전자 한도(30명)에 도달했습니다.' });

  const otp = makeOTP(30);
  st.watcherOTPPool.set(otp.token, otp.exp);
  const base = process.env.PUBLIC_BASE_URL || '';
  res.json({
    ok:true,
    otp: otp.token,
    watchURL: `${base}/watch.html?battle=${st.id}&token=${otp.token}`,
    msg:'관전자 링크가 발급되었습니다.'
  });
});

// 전투 시작/일시정지/종료
app.post('/api/admin/battles/:id/start', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body||{};
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });

  st.status = 'active';
  st.round = 1;
  st.phase = 'A';
  st.queueActed.A.clear(); st.queueActed.B.clear();
  st.timerEnd = now() + 60*60*1000;
  decideInitiative(st);
  startBattleTimer(st);
  armPhaseInactivity(st);
  io.to(st.id).emit('battle:start', { battleId: st.id, round: st.round, phase: (st.phase==='A'?'team1':'team2'), timerEnd: st.timerEnd });
  emitState(st);
  res.json({ ok:true, msg:'전투가 시작되었습니다.' });
});

app.post('/api/admin/battles/:id/pause', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body||{};
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });
  // 간단: 타이머만 멈춤
  clearBattleTimer(st);
  io.to(st.id).emit('system', { text:'전투 일시정지' });
  res.json({ ok:true, msg:'일시정지' });
});

app.post('/api/admin/battles/:id/end', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  const { adminOtp } = req.body||{};
  if (st.adminOTP.token !== adminOtp || !validOTP(st.adminOTP))
    return res.status(403).json({ ok:false, error:'forbidden', msg:'관리자 인증 실패(OTP).' });
  st.timerEnd = now(); // 강제 종료
  checkEnd(st);
  res.json({ ok:true, msg:'전투 종료' });
});

// 남은 시간 조회
app.get('/api/battles/:id/time', (req,res)=>{
  const st = BATTLES.get(req.params.id);
  if (!st) return res.status(404).json({ ok:false, error:'not_found', msg:'전투를 찾을 수 없습니다.' });
  res.json({ ok:true, now: now(), timerEnd: st.timerEnd, remainMs: Math.max(0, st.timerEnd - now()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────────────────────────────────────

// 간단 레이트리미터
const RL = new Map(); // socket.id -> { lastWin, chatCount, actionCount }
const rateOk = (id, key, limit=8, winMs=3000) => {
  const t = now();
  const e = RL.get(id) || { lastWin: t, chatCount:0, actionCount:0 };
  if (t - e.lastWin > winMs) { e.lastWin = t; e.chatCount=0; e.actionCount=0; }
  e[key] = (e[key]||0)+1; RL.set(id, e);
  return e[key] <= limit;
};

io.on('connection', (socket) => {
  log('socket connected', socket.id);

  // ── 인증/입장: 신규 'auth' + 레거시 'join'
  const handleJoin = (payload, cb) => {
    try {
      const { role, battle: battleId, battleId: legacyId, pid, name, token, otp, nickname } = payload || {};
      const bid = battleId || legacyId;
      const st = BATTLES.get(bid);
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
      } else if (role === 'spectator' || role === 'watcher') {
        // 관전자: OTP Map 검증 + 동시접속 제한
        const exp = st.watcherOTPPool.get(token || otp);
        if (!exp || exp <= now()) return cb?.({ ok:false, error:'forbidden', msg:'관전자 OTP가 유효하지 않습니다.' });

        const room = io.sockets.adapter.rooms.get(bid);
        const liveSpectators = [...(room||new Set())]
          .map(id => st.sockets.get(id))
          .filter(s => s?.role === 'watcher').length;
        if (liveSpectators >= st.spectatorLimit)
          return cb?.({ ok:false, error:'limit', msg:'관전자 한도(30명)를 초과했습니다.' });

        // 1회용 소모(재사용 방지)
        st.watcherOTPPool.delete(token || otp);
      } else {
        return cb?.({ ok:false, error:'bad_role', msg:'역할(role)이 올바르지 않습니다.' });
      }

      socket.join(bid);
      if (playerObj) socket.join(`${bid}:${playerObj.team}`); // 팀채팅 룸
      st.sockets.set(socket.id, {
        role: (role==='spectator'?'watcher':role),
        battleId: bid,
        pid: playerObj?.id || pid || null,
        team: playerObj?.team || null,
        nickname: (nickname || name || (role==='admin'?'관리자': role==='player'?'플레이어':'관전자')).slice(0,24)
      });
      // socket.data에 아이덴티티 고정 (위조 방지)
      socket.data = {
        role: (role==='spectator'?'watcher':role),
        battleId: bid,
        pid: playerObj?.id || null,
        team: playerObj?.team || null,
        nickname: (nickname || name || (role==='admin'?'관리자': role==='player'?'플레이어':'관전자')).slice(0,24)
      };

      cb?.({ ok:true, state: publicState(st), selfPid: playerObj?.id || null });
      // 타이머 1회 동기화
      io.to(socket.id).emit('timer:sync', { now: now(), timerEnd: st.timerEnd, remainMs: Math.max(0, st.timerEnd - now()) });
      emitPresence(st);
    } catch (e) {
      log('join error', e);
      cb?.({ ok:false, error:'exception', msg:'예기치 못한 오류입니다.' });
    }
  };
  socket.on('auth', handleJoin);
  socket.on('join', handleJoin);

  // 채팅: 신규 'chatMessage' + 레거시 'chat:send'
  const handleChat = (payload, legacy=false) => {
    const ctx = socket.data;
    if (!ctx?.battleId) return;
    const st = BATTLES.get(ctx.battleId);
    if (!st) return;
    const text = legacy ? (payload?.text) : (payload?.message);
    if (!text) return;
    if (!rateOk(socket.id, 'chatCount', 6, 3000)) return; // 3초 6회

    let channel = legacy ? 'all' : (payload?.channel || 'all');
    let msgText = String(text).slice(0,500);
    // /t 프리픽스 팀채팅
    if (/^\s*\/t\s+/i.test(msgText) && ctx.role==='player') {
      channel = 'team';
      msgText = msgText.replace(/^\s*\/t\s+/i, '');
    }

    const nick = ctx.nickname || (ctx.role==='admin'?'관리자': ctx.role==='player'?'플레이어':'관전자');
    const msg = {
      battleId: st.id,
      from: nick,
      role: ctx.role,
      text: msgText,
      ts: now(),
      channel
    };
    st.chat.unshift(msg); st.chat = st.chat.slice(0,300);

    if (channel==='team' && ctx.role==='player') {
      return io.to(`${st.id}:${ctx.team}`).emit('chat', msg);
    }
    io.to(st.id).emit('chat', msg);
  };
  socket.on('chatMessage', (p)=>handleChat(p,false));
  socket.on('chat:send', (p)=>handleChat(p,true));

  // 관전자 응원: 'cheer'
  socket.on('cheer', (payload, cb)=>{
    const ctx = socket.data;
    if (!ctx?.battleId) return cb?.({ ok:false, error:'bad', msg:'연결 정보 없음' });
    const st = BATTLES.get(ctx.battleId);
    if (!st) return cb?.({ ok:false, error:'not_found' });
    const text = String(payload?.text||'').slice(0,200);
    const from = String(payload?.from || ctx.nickname || '관전자').slice(0,24);
    if (!text) return cb?.({ ok:false, error:'empty' });
    const msg = { type:'cheer', from, text, ts: now() };
    st.chat.unshift(msg); st.chat = st.chat.slice(0,300);
    io.to(st.id).emit('chat', msg);
    cb?.({ ok:true });
  });

  // 행동: 신규 'playerAction' + 레거시 'action'
  const handleAction = (data, cb) => {
    const ctx = socket.data;
    const st = BATTLES.get(ctx?.battleId);
    if (!st || st.status!=='active') return cb?.({ ok:false, error:'bad_state', msg:'전투가 활성 상태가 아닙니다.' });
    if (ctx.role!=='player' || !ctx.pid) return cb?.({ ok:false, error:'forbidden', msg:'플레이어만 행동할 수 있습니다.' });
    if (!rateOk(socket.id, 'actionCount', 3, 2000)) return cb?.({ ok:false, error:'rate', msg:'행동이 너무 빠릅니다.' });

    const actor = getPlayer(st, ctx.pid);
    if (!actor || actor.hp<=0) return cb?.({ ok:false, error:'actor_invalid', msg:'행동 주체가 올바르지 않습니다.' });

    if (currentSide(st) !== actor.team) return cb?.({ ok:false, error:'not_your_phase', msg:'현재 당신의 팀 차례가 아닙니다.' });
    if (st.queueActed[actor.team].has(actor.id)) return cb?.({ ok:false, error:'already_acted', msg:'이미 이 라운드에 행동했습니다.' });

    clearInactivity(st, actor.id);

    const kind = data?.type || data?.kind;
    const targetId = data?.targetPid || data?.targetId;
    const item = data?.item;

    // 지속턴 감소(턴 시작 시점 가정)
    if (actor.effects.atkBoostTurns>0) actor.effects.atkBoostTurns--;
    if (actor.effects.defBoostTurns>0) actor.effects.defBoostTurns--;

    let logLine = null;

    if (kind === 'attack') {
      const defender = getPlayer(st, targetId);
      if (!defender || defender.hp<=0) return cb?.({ ok:false, error:'bad_target', msg:'대상이 올바르지 않습니다.' });

      const hit = calcHit(
        { luk:actor.luk, agi:actor.agi, atk:actor.atk, def:actor.def },
        { luk:defender.luk, agi:defender.agi, atk:defender.atk, def:defender.def }
      );
      if (!hit) {
        logLine = { ts:now(), type:'attack', attacker: actor.name, defender: defender.name, hit:false, text:`${actor.name}의 공격을 ${defender.name}이(가) 회피!` };
      } else {
        const crit = calcCrit({ luk:actor.luk });
        const atkMul = (actor.effects.atkBoostTurns>0) ? 1.5 : 1.0;
        const defMul = (defender.effects.defBoostTurns>0) ? 1.5 : 1.0;
        let dmg = baseDamage(
          { atk:actor.atk, def:actor.def, agi:actor.agi, luk:actor.luk },
          { atk:defender.atk, def:defender.def, agi:defender.agi, luk:defender.luk },
          atkMul, defMul
        );
        if (crit) dmg *= 2;
        dmg = Math.round(dmg);
        const dealt = applyDamage(
          { ...defender }, // 내부 계산용 복사
          dmg,
          { atk:actor.atk, agi:actor.agi }
        );
        // 실제 적용
        defender.hp = clamp(defender.hp - dealt, 0, 1000);
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
    else if (kind === 'useItem' || kind === 'item') {
      if (!item) return cb?.({ ok:false, error:'no_item', msg:'아이템이 지정되지 않았습니다.' });
      if (item === '공격 보정기' || item === 'atkBoost') {
        if (actor.items.atkBoost<=0) return cb?.({ ok:false, error:'no_stock', msg:'공격 보정기 재고가 없습니다.' });
        actor.items.atkBoost--;
        const success = (Math.random() < 0.10);
        if (success) actor.effects.atkBoostTurns = 1;
        logLine = { ts:now(), type:'item', actor: actor.name, text:`${actor.name} 공격 보정기 사용 → ${success?'성공(1턴 ×1.5)':'실패(소모됨)'}` };
      } else if (item === '방어 보정기' || item === 'defBoost') {
        if (actor.items.defBoost<=0) return cb?.({ ok:false, error:'no_stock', msg:'방어 보정기 재고가 없습니다.' });
        actor.items.defBoost--;
        const success = (Math.random() < 0.10);
        if (success) actor.effects.defBoostTurns = 1;
        logLine = { ts:now(), type:'item', actor: actor.name, text:`${actor.name} 방어 보정기 사용 → ${success?'성공(1턴 ×1.5)':'실패(소모됨)'}` };
      } else if (item === '디터니' || item === 'dittany') {
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
    emitState(st);
    if (!checkEnd(st)) armPhaseInactivity(st);
  };
  socket.on('playerAction', handleAction);
  socket.on('action', handleAction);

  socket.on('disconnect', ()=>{
    // presence 업데이트
    const st = [...BATTLES.values()].find(b => b.sockets.has(socket.id));
    if (!st) return;
    st.sockets.delete(socket.id);
    emitPresence(st);
    log('socket disconnected', socket.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 공개 상태(클라이언트 동기화용) + 브로드캐스트 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
function publicState(st) {
  // players map (프론트 호환)
  const players = {};
  for (const side of ['A','B']) {
    st.teams[side].players.forEach(p=>{
      players[p.id] = {
        id:p.id, name:p.name,
        team:(side==='A'?'team1':'team2'),
        hp:p.hp, maxHp:1000,
        stats:{ attack:p.atk, defense:p.def, agility:p.agi, luck:p.luk },
        alive: p.hp>0, avatar:p.avatar||''
      };
    });
  }
  const pending = alivePlayers(st, st.phase).filter(p=>!st.queueActed[st.phase].has(p.id)).map(p=>p.id);

  return {
    id: st.id,
    mode: st.mode,
    status: (st.status==='lobby'?'waiting': st.status==='active'?'ongoing':'ended'),
    round: st.round,
    phase: (st.phase==='A'?'team1':'team2'),
    timerEnd: st.timerEnd,
    players,
    turn: { pending },
    // 참고용(구조 유지)
    teams: ['A','B'].map(s=>({
      side:s, name: st.teams[s].name,
      players: st.teams[s].players.map(p=>({ id:p.id, name:p.name, hp:p.hp, atk:p.atk, def:p.def, agi:p.agi, luk:p.luk, avatar:p.avatar||'' }))
    })),
    chat: st.chat.slice(0,30),
    logs: st.logs.slice(0,30),
  };
}
function emitState(st){ io.to(st.id).emit('state', publicState(st)); }
function emitPresence(st){
  const room = io.sockets.adapter.rooms.get(st.id) || new Set();
  let admin=0, player=0, watcher=0;
  for (const sid of room) {
    const s = st.sockets.get(sid);
    if (!s) continue;
    if (s.role==='admin') admin++; else if (s.role==='player') player++; else if (s.role==='watcher') watcher++;
  }
  io.to(st.id).emit('presence:update', { total: room.size, admin, player, watcher });
}

// ─────────────────────────────────────────────────────────────────────────────
// GC(메모리 청소)
// ─────────────────────────────────────────────────────────────────────────────
function teardownBattle(st){
  clearBattleTimer(st);
  for (const to of st.inactivity.values()) clearTimeout(to);
  st.inactivity.clear();
}
setInterval(()=>{
  for (const [id, st] of BATTLES) {
    const stale = (now() - st.createdAt) > 3*60*60*1000; // 3h
    if (st.status==='ended' || stale) {
      teardownBattle(st);
      BATTLES.delete(id);
      log('battle gc', id);
    }
  }
}, 10*60*1000);

// ─────────────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, ()=>console.log('[battle] listening on', PORT));
