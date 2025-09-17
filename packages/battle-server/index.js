// ==========================
// PYXIS Battle Server (all-in-one)
// ==========================
/*
필수 설치:
npm i express http socket.io multer cors uuid

실행:
node server/index.js
(환경변수 PORT 가 없으면 3000 포트)
*/

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  path: '/socket.io',
  cors: { origin: true, credentials: true }
});

// --------------------------
// 기본 설정
// --------------------------
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 정적 리소스/페이지 서빙
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads')));

// 라우팅 페이지(정적 파일을 직접 서빙)
app.get('/admin', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/player', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/spectator', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'spectator.html')));

// 헬스체크
app.get('/healthz', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// --------------------------
// 업로드 (아바타)
// --------------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^\w.-]+/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
  const url = `/uploads/avatars/${req.file.filename}`;
  res.json({ ok: true, url });
});

// --------------------------
// 메모리 저장소
// --------------------------
/*
Battle 구조:
{
  id, mode, status, createdAt,
  players: [{
    id, name, team, avatar,
    hp, maxHp,
    stats: { attack, defense, agility, luck },
    items: { dittany, attackBooster, defenseBooster },
    token,                       // 플레이어 로그인 토큰
    _alive: true
  }],
  spectatorOtp, spectatorUrl,
  currentTurn: {
    turnNumber, currentTeam,      // 'A' | 'B'
    currentPlayer,                // {id,name,avatar,team}
    timeLeftSec, turnEndsAtMs
  },
  pending: { A: null, B: null }, // 팀별 이번 라운드 액션
  roundStarter: 'A'|'B',         // 이번 라운드 선공 팀
  turnIdx: { A:0, B:0 },         // 팀별 다음 지목 인덱스(순환)
  _timer: null,
}
*/
const battles = new Map();

// --------------------------
// 유틸
// --------------------------
const now = () => Date.now();
const d = (n) => Math.floor(Math.random() * n) + 1; // 1..n
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

function toPublicPlayer(p) {
  return {
    id: p.id, name: p.name, team: p.team, avatar: p.avatar,
    hp: p.hp, maxHp: p.maxHp,
    stats: p.stats,
    items: p.items
  };
}

function alivePlayers(b, team) {
  return b.players.filter(p => p.team === team && p.hp > 0);
}
function allDead(b, team) {
  return b.players.filter(p => p.team === team && p.hp > 0).length === 0;
}
function otherTeam(t) { return t === 'A' ? 'B' : 'A'; }

function pickNextPlayer(battle, team) {
  const alive = alivePlayers(battle, team);
  if (alive.length === 0) return null;
  const idx = battle.turnIdx[team] % alive.length;
  const p = alive[idx];
  battle.turnIdx[team] = (battle.turnIdx[team] + 1) % alive.length;
  return p;
}

function broadcastState(battleId) {
  const b = battles.get(battleId);
  if (!b) return;
  const payload = {
    id: b.id,
    status: b.status,
    mode: b.mode,
    players: b.players.map(toPublicPlayer),
    currentTurn: b.currentTurn ? {
      turnNumber: b.currentTurn.turnNumber,
      currentTeam: b.currentTurn.currentTeam,
      currentPlayer: b.currentTurn.currentPlayer ? toPublicPlayer(b.players.find(p => p.id === b.currentTurn.currentPlayer.id) || b.currentTurn.currentPlayer) : null,
      timeLeftSec: Math.max(0, Math.ceil((b.currentTurn.turnEndsAtMs - now()) / 1000))
    } : null
  };
  io.to(battleId).emit('battle:update', payload);
}

function log(battleId, type, message) {
  io.to(battleId).emit('battle:log', { ts: now(), type, message });
}

function setTurn(battle, team, secs) {
  const player = pickNextPlayer(battle, team);
  battle.currentTurn = {
    turnNumber: battle.currentTurn ? battle.currentTurn.turnNumber : 1,
    currentTeam: team,
    currentPlayer: player ? { id: player.id } : null,
    timeLeftSec: secs,
    turnEndsAtMs: now() + secs * 1000
  };
  broadcastState(battle.id);
}

function turnTimerStart(battle, secs = 30) {
  clearInterval(battle._timer);
  setTurn(battle, battle.currentTurn?.currentTeam || battle.roundStarter, secs);
  battle._timer = setInterval(() => {
    if (!battle.currentTurn) return;
    const left = Math.max(0, Math.ceil((battle.currentTurn.turnEndsAtMs - now()) / 1000));
    if (left <= 0) {
      // 시간초과 = 패스 처리
      const team = battle.currentTurn.currentTeam;
      if (!battle.pending[team]) {
        battle.pending[team] = { type: 'pass', playerId: battle.currentTurn.currentPlayer?.id || null };
        log(battle.id, 'battle', `${team}팀 시간 초과 → 패스 처리`);
      }
      goNextPhase(battle);
    } else {
      broadcastState(battle.id);
    }
  }, 1000);
}

function endBattle(battle, winner) {
  clearInterval(battle._timer);
  battle.status = 'ended';
  log(battle.id, 'battle', `전투 종료! 승리: ${winner}팀`);
  broadcastState(battle.id);
}

// --------------------------
// 규칙 계산 (최신 규격 반영)
//  - 행동: 공격 / 방어 / 회피 / 패스
//  - 치명타: d10 ≥ (10 − 민첩/2)  (사용자 지시: '행운'이 아니라 '민첩')
//  - 회피:  수비자(민첩 + d10) ≥ 공격자의 최종공격력  → 피해 0, 실패 시 방어 무시 정면피해
//  - 방어:  방어값 = 방어스탯 * (보정기 있으면 2) + d10
//           기본피해 = (치명타? 최종공격력*2 : 최종공격력) − 방어값
//           방어값 ≥ 공격이면 0, 그렇지 않으면 기본피해(하한 0)
//  - 보정기/디터니: 성공확률 90%(실패 10%), 성공 시 "해당 턴"에만 적용
//  - 방어나 회피를 "선택하지 않으면" 자동 적용 없음 (방어/회피 수치 차감 금지)
// --------------------------
function resolveRound(battle) {
  const actA = battle.pending.A;
  const actB = battle.pending.B;

  const getPlayer = (id) => battle.players.find(p => p.id === id);
  const getTarget = (id) => battle.players.find(p => p.id === id);

  // 1) 행동 로그(요청 포맷)
  if (actA) {
    log(battle.id, 'battle', '=== A팀 행동 ===');
    emitActionNarration(battle, 'A', actA);
    log(battle.id, 'battle', 'A팀 선택 완료');
  } else {
    log(battle.id, 'battle', '=== A팀 행동 ===');
    log(battle.id, 'battle', '→ 행동 없음');
    log(battle.id, 'battle', 'A팀 선택 완료');
  }
  if (actB) {
    log(battle.id, 'battle', '=== B팀 행동 ===');
    emitActionNarration(battle, 'B', actB);
    log(battle.id, 'battle', 'B팀 선택 완료');
  } else {
    log(battle.id, 'battle', '=== B팀 행동 ===');
    log(battle.id, 'battle', '→ 행동 없음');
    log(battle.id, 'battle', 'B팀 선택 완료');
  }

  // 2) 전투 계산
  const results = [];

  const applyItemHeal = (actorAction) => {
    if (!actorAction || actorAction.type !== 'item' || actorAction.item !== 'dittany') return;
    const user = getPlayer(actorAction.playerId);
    const tgt = getTarget(actorAction.targetId);
    if (!user || !tgt) return;
    // 성공확률 90%
    const ok = d(10) !== 1;
    if (tgt.hp <= 0) {
      results.push(`${user.name}의 ${tgt.name}에게 디터니 사용 실패 (사망자)`);
      return;
    }
    if (!ok) {
      results.push(`${user.name}의 ${tgt.name} 치유 시도 실패 (디터니)`);
      return;
    }
    const heal = 10;
    tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp);
    results.push(`${user.name}이(가) ${tgt.name} 치유 (+${heal}) → HP ${tgt.hp}`);
  };

  const attackDamage = (atkAction, defAction) => {
    // atkAction: type 'attack' or null(=없으면 공격 안 함)
    if (!atkAction || atkAction.type !== 'attack') return null;
    const attacker = getPlayer(atkAction.playerId);
    let target = getTarget(atkAction.targetId);
    if (!attacker) return null;
    if (!target || target.hp <= 0) {
      // 대상 없으면 상대 팀 임의 생존자 지정
      const opp = otherTeam(attacker.team);
      const candidates = alivePlayers(battle, opp);
      if (candidates.length === 0) return null;
      target = candidates[0];
    }

    // 아이템(보정기) 사용 여부: 이 턴에만 적용
    const atkBoostUsed = (atkAction.temp && atkAction.temp.attackBoost) || false;

    // 최종공격력 = 공격스탯*(보정기?2:1) + d10
    const rollAtk = d(10);
    const finalAtk = attacker.stats.attack * (atkBoostUsed ? 2 : 1) + rollAtk;

    // 치명타: d10 ≥ (10 − 민첩/2)
    const critRoll = d(10);
    const critNeed = Math.max(1, Math.ceil(10 - (attacker.stats.agility || 0) / 2));
    const isCrit = critRoll >= critNeed;

    // 수비자 행동 확인 (선택한 경우에만 적용)
    const defType = defAction && defAction.playerId === target.id ? defAction.type : null;

    // 회피 우선 처리
    if (defType === 'dodge') {
      const rollDodge = d(10);
      const dodgeTotal = (target.stats.agility || 0) + rollDodge;
      const dodgeSuccess = dodgeTotal >= finalAtk;
      if (dodgeSuccess) {
        return {
          target,
          dmg: 0,
          text: `${target.name}이(가) 회피 성공! (민첩 ${target.stats.agility}+D10=${dodgeTotal} ≥ 공격 ${finalAtk})`
        };
      }
      // 실패 → 방어값 차감 없이 정면 피해 (치명타 2배 반영)
      const baseDmg = isCrit ? finalAtk * 2 : finalAtk;
      return {
        target,
        dmg: baseDmg,
        text: `${target.name} 회피 실패(정면 피해) → 피해 ${baseDmg}`
      };
    }

    // 방어 선택 시에만 방어 계산
    if (defType === 'defend') {
      const defBoostUsed = (defAction.temp && defAction.temp.defenseBoost) || false;
      const rollDef = d(10);
      const defenseVal = (target.stats.defense || 0) * (defBoostUsed ? 2 : 1) + rollDef;
      const base = isCrit ? finalAtk * 2 : finalAtk;
      const dmg = Math.max(0, base - defenseVal);
      const detail = dmg === 0
        ? `${target.name} 완벽 방어! (방어 ${defenseVal} ≥ 공격 ${base})`
        : `${target.name} 방어 후 피해 ${dmg} (공격 ${base} - 방어 ${defenseVal})`;
      return { target, dmg, text: detail };
    }

    // 수비 행동이 없으면 '그냥 맞음' (방어/회피 자동 적용 금지)
    const baseDmg = isCrit ? finalAtk * 2 : finalAtk;
    return {
      target,
      dmg: baseDmg,
      text: `${target.name} 수비 없음 → 피해 ${baseDmg}`
    };
  };

  // 아이템 성공/실패(보정기) 처리: 공격/방어 보정기는 '행동 시점'에 성공 판정만 기록 → 데미지 계산 때 참조
  const attachTempItemUse = (action) => {
    if (!action || action.type !== 'item') return;
    const ok = d(10) !== 1; // 90%
    action._success = ok;
  };

  attachTempItemUse(actA);
  attachTempItemUse(actB);

  // 디터니 먼저 적용(동시)
  applyItemHeal(actA);
  applyItemHeal(actB);

  // 보정기 플래그(이 턴만) 세팅
  if (actA && actA.type === 'item' && actA._success) {
    actA.temp = actA.temp || {};
    if (actA.item === 'attackBooster') actA.temp.attackBoost = true;
    if (actA.item === 'defenseBooster') actA.temp.defenseBoost = true;
  }
  if (actB && actB.type === 'item' && actB._success) {
    actB.temp = actB.temp || {};
    if (actB.item === 'attackBooster') actB.temp.attackBoost = true;
    if (actB.item === 'defenseBooster') actB.temp.defenseBoost = true;
  }

  // 공격 계산(양쪽)
  const dmgA = attackDamage(actA && actA.type === 'attack' ? actA : (actA && actA.type === 'pass' ? null : actA?.type === 'defend' || actA?.type === 'dodge' ? null : actA), actB);
  const dmgB = attackDamage(actB && actB.type === 'attack' ? actB : (actB && actB.type === 'pass' ? null : actB?.type === 'defend' || actB?.type === 'dodge' ? null : actB), actA);

  // HP 적용 + 결과 문구(요청 포맷과 최대한 유사)
  log(battle.id, 'battle', '=== 라운드 결과 ===');

  const pushAttackText = (actorAction, dmgObj) => {
    if (!actorAction || actorAction.type !== 'attack' || !dmgObj) return;
    const attacker = getPlayer(actorAction.playerId);
    const target = dmgObj.target;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - dmgObj.dmg);
    const after = target.hp;

    if (dmgObj.dmg === 0) {
      results.push(`${attacker.name}의 공격이 ${target.name}에게 빗나감/무효`);
    } else {
      if (after <= 0) {
        results.push(`${attacker.name}의 강화된 치명타 공격으로 ${target.name} 사망! (피해 ${dmgObj.dmg})`);
      } else {
        results.push(`${attacker.name}이(가) ${target.name}에게 공격 (피해 ${dmgObj.dmg}) → HP ${after}`);
      }
    }
    results.push(dmgObj.text);
  };

  // 아이템 실패/성공 텍스트(보정기)
  const boosterText = (act) => {
    if (!act || act.type !== 'item' || (act.item !== 'attackBooster' && act.item !== 'defenseBooster')) return;
    const user = getPlayer(act.playerId);
    const kind = act.item === 'attackBooster' ? '공격 보정기' : '방어 보정기';
    results.push(`${user.name}이(가) ${kind} 사용 ${act._success ? '성공' : '실패'}`);
  };
  boosterText(actA);
  boosterText(actB);

  pushAttackText(actA, dmgA);
  pushAttackText(actB, dmgB);

  // 치유/실패 텍스트는 위에서 results에 이미 누적됨
  results.forEach(t => log(battle.id, 'battle', `→ ${t}`));

  // 종료 판정
  const aDead = allDead(battle, 'A');
  const bDead = allDead(battle, 'B');
  if (aDead || bDead) {
    const winner = aDead && bDead ? '무승부' : (aDead ? 'B' : 'A');
    endBattle(battle, winner);
    return;
  }

  // 라운드 종료 안내 및 다음 라운드
  log(battle.id, 'battle', `${battle.currentTurn?.turnNumber || 1}라운드 종료`);
  log(battle.id, 'battle', '5초 후 다음 라운드 시작...');

  // 다음 라운드 설정
  battle.currentTurn.turnNumber += 1;
  battle.roundStarter = otherTeam(battle.roundStarter);
  battle.pending.A = null; battle.pending.B = null;

  // 5초 후 다음 라운드 시작 + 선공 팀 턴으로 전환
  setTimeout(() => {
    log(battle.id, 'battle', `=== 제${battle.currentTurn.turnNumber}라운드 시작 ===`);
    log(battle.id, 'battle', `${battle.roundStarter}팀의 턴입니다`);
    battle.currentTurn.currentTeam = battle.roundStarter;
    battle.currentTurn.currentPlayer = pickNextPlayer(battle, battle.roundStarter);
    battle.currentTurn.turnEndsAtMs = now() + 30 * 1000;
    turnTimerStart(battle, 30);
  }, 5000);
}

function emitActionNarration(battle, team, action) {
  if (!action) return;
  const getP = (id) => (battles.get(battle.id).players.find(p => p.id === id) || { name: '??' });
  const me = getP(action.playerId);
  const tgt = action.targetId ? getP(action.targetId) : null;

  switch (action.type) {
    case 'attack':
      log(battle.id, 'battle', `→ ${me.name}이(가) ${tgt ? tgt.name : '상대'}를 공격`);
      break;
    case 'defend':
      log(battle.id, 'battle', `→ ${me.name}이(가) 방어 태세`);
      break;
    case 'dodge':
      log(battle.id, 'battle', `→ ${me.name}이(가) 회피 태세`);
      break;
    case 'item':
      if (action.item === 'dittany') {
        log(battle.id, 'battle', `→ ${me.name}이(가) ${tgt ? tgt.name : '대상'}에게 디터니 사용`);
      } else if (action.item === 'attackBooster') {
        log(battle.id, 'battle', `→ ${me.name}이(가) 공격 보정기 사용 시도`);
      } else if (action.item === 'defenseBooster') {
        log(battle.id, 'battle', `→ ${me.name}이(가) 방어 보정기 사용 시도`);
      }
      break;
    case 'pass':
      log(battle.id, 'battle', `→ ${me.name}이(가) 행동 패스`);
      break;
    default:
      log(battle.id, 'battle', '→ 알 수 없는 행동');
  }
}

function goNextPhase(battle) {
  // 현재 팀이 행동을 끝냈다면 상대 팀으로 넘김.
  const currTeam = battle.currentTurn.currentTeam;
  const other = otherTeam(currTeam);

  // 다른 팀 액션이 비어있고, 상대 팀 생존자 존재 → 턴 넘김
  if (!battle.pending[other]) {
    // 이미 상대 팀 모두 사망이면 바로 해석
    if (alivePlayers(battle, other).length === 0) {
      resolveRound(battle);
      return;
    }
    // 상대 팀 턴으로 이동
    battle.currentTurn.currentTeam = other;
    battle.currentTurn.currentPlayer = pickNextPlayer(battle, other);
    battle.currentTurn.turnEndsAtMs = now() + 30 * 1000;
    log(battle.id, 'battle', `${other}팀의 턴입니다`);
    broadcastState(battle.id);
    return;
  }

  // 양 팀 모두 선택 끝 → 라운드 해석
  resolveRound(battle);
}

// --------------------------
// REST: 전투 생성/플레이어 관리/링크
// --------------------------
app.post('/api/battles', (req, res) => {
  const mode = req.body?.mode || '2v2';
  const id = `battle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const b = {
    id,
    mode,
    status: 'waiting',
    createdAt: now(),
    players: [],
    spectatorOtp: null,
    spectatorUrl: null,
    currentTurn: null,
    pending: { A: null, B: null },
    roundStarter: 'A',
    turnIdx: { A: 0, B: 0 },
    _timer: null
  };
  battles.set(id, b);
  res.json({ ok: true, id });
});

function addPlayerToBattle(id, payload) {
  const b = battles.get(id);
  if (!b) return { ok: false, error: 'not_found' };
  const p = payload || {};
  const pid = uuid();
  const maxHp = Number(p.maxHp || p.hp || 100);
  const player = {
    id: pid,
    name: p.name || 'noname',
    team: p.team === 'B' ? 'B' : 'A',
    avatar: p.avatar || '/uploads/avatars/default.svg',
    hp: Number(p.hp || maxHp),
    maxHp,
    stats: {
      attack: Number(p.stats?.attack ?? p.attack ?? 1),
      defense: Number(p.stats?.defense ?? p.defense ?? 1),
      agility: Number(p.stats?.agility ?? p.agility ?? 1),
      luck: Number(p.stats?.luck ?? p.luck ?? 1), // (남겨둠, 일부 UI 호환)
    },
    items: {
      dittany: Number(p.items?.dittany ?? p.dittany ?? 0),
      attackBooster: Number(p.items?.attackBooster ?? p.attackBooster ?? p.attack_boost ?? 0),
      defenseBooster: Number(p.items?.defenseBooster ?? p.defenseBooster ?? p.defense_boost ?? 0)
    },
    token: uuid(),
    _alive: true
  };
  b.players.push(player);
  return { ok: true, player };
}

// 여러 호환 경로 모두 지원(404 방지)
const addPlayerHandlers = [
  '/api/admin/battles/:id/player',
  '/api/admin/battles/:id/players',
  '/api/battles/:id/player',
  '/api/battles/:id/players',
  '/admin/battles/:id/players',
  '/battles/:id/players'
];
addPlayerHandlers.forEach(route => {
  app.post(route, (req, res) => {
    const id = req.params.id;
    const r = addPlayerToBattle(id, req.body?.player || req.body);
    if (!r.ok) return res.status(404).json(r);
    broadcastState(id);
    log(id, 'battle', `${r.player.name}이(가) ${r.player.team}팀으로 참가했습니다`);
    res.json({ ok: true, player: toPublicPlayer(r.player) });
  });
});

// 삭제
app.delete('/api/admin/battles/:id/players/:playerId', (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'not_found' });
  const idx = b.players.findIndex(p => p.id === req.params.playerId);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'no_player' });
  const [p] = b.players.splice(idx, 1);
  log(b.id, 'battle', `${p.name}이(가) 전투에서 제거되었습니다`);
  broadcastState(b.id);
  res.json({ ok: true });
});

// 링크/OTP 생성
app.post('/api/admin/battles/:id/links', (req, res) => {
  const b = battles.get(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'not_found' });
  // spectator OTP
  b.spectatorOtp = b.spectatorOtp || Math.random().toString(36).slice(2, 10);
  const base = req.get('x-base-url') || `${req.protocol}://${req.get('host')}`;
  b.spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&otp=${encodeURIComponent(b.spectatorOtp)}`;

  // 플레이어 개별 링크(현재 등록된 플레이어 기준)
  const playerLinks = b.players.map(p => ({
    playerId: p.id,
    playerName: p.name,
    team: p.team,
    otp: p.token,
    url: `${base}/player?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(p.token)}`
  }));

  res.json({
    ok: true,
    spectator: { otp: b.spectatorOtp, url: b.spectatorUrl },
    playerLinks
  });
});

// --------------------------
// Socket.IO
// --------------------------
io.on('connection', (socket) => {
  // 공통 로그
  socket.onAny((e) => {
    // console.log('[SOCKET]', socket.id, e);
  });

  // 방 입장
  socket.on('join', ({ battleId }) => {
    if (!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    log(battleId, 'system', '새 연결이 입장했습니다');
    broadcastState(battleId);
  });

  // 관리자 제어
  socket.on('startBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false, error: 'not_found' });
    if (b.status === 'active') return cb?.({ ok: true });

    // 선공 결정(주사위 합)
    const aRoll = d(6) + d(6);
    const bRoll = d(6) + d(6);
    log(b.id, 'battle', `선공 결정: A팀(${aRoll}) vs B팀(${bRoll})`);
    b.roundStarter = aRoll >= bRoll ? 'A' : 'B';
    log(b.id, 'battle', `${b.roundStarter}팀이 선공입니다!`);

    b.status = 'active';
    b.currentTurn = { turnNumber: 1, currentTeam: b.roundStarter, currentPlayer: null, timeLeftSec: 30, turnEndsAtMs: now() + 30000 };
    b.pending.A = null; b.pending.B = null;

    const first = pickNextPlayer(b, b.roundStarter);
    b.currentTurn.currentPlayer = first ? { id: first.id } : null;
    log(b.id, 'battle', '전투가 시작되었습니다!');
    turnTimerStart(b, 30);
    broadcastState(b.id);
    cb?.({ ok: true });
  });

  socket.on('pauseBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    if (b.status !== 'active') return cb?.({ ok: false });
    b.status = 'paused';
    clearInterval(b._timer);
    log(b.id, 'battle', '전투 일시정지');
    broadcastState(b.id);
    cb?.({ ok: true });
  });

  socket.on('resumeBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    if (b.status !== 'paused') return cb?.({ ok: false });
    b.status = 'active';
    log(b.id, 'battle', '전투 재개');
    turnTimerStart(b, Math.max(5, Math.ceil((b.currentTurn.turnEndsAtMs - now()) / 1000)));
    cb?.({ ok: true });
  });

  socket.on('endBattle', ({ battleId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    const aliveA = alivePlayers(b, 'A').length;
    const aliveB = alivePlayers(b, 'B').length;
    const winner = aliveA === aliveB ? '무승부' : (aliveA > aliveB ? 'A' : 'B');
    endBattle(b, winner);
    cb?.({ ok: true });
  });

  // 플레이어 추가/삭제(소켓)
  socket.on('addPlayer', ({ battleId, player }, cb) => {
    const r = addPlayerToBattle(battleId, player);
    if (!r.ok) return cb?.({ ok: false, error: r.error });
    log(battleId, 'battle', `${r.player.name}이(가) ${r.player.team}팀으로 참가했습니다`);
    broadcastState(battleId);
    cb?.({ ok: true, player: toPublicPlayer(r.player) });
  });

  socket.on('deletePlayer', ({ battleId, playerId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    const idx = b.players.findIndex(p => p.id === playerId);
    if (idx < 0) return cb?.({ ok: false });
    const [p] = b.players.splice(idx, 1);
    log(battleId, 'battle', `${p.name}이(가) 전투에서 제거되었습니다`);
    broadcastState(battleId);
    cb?.({ ok: true });
  });

  // 플레이어 인증(링크 토큰)
  socket.on('playerAuth', ({ battleId, token }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    const player = b.players.find(p => p.token === token);
    if (!player) return cb?.({ ok: false, error: 'bad_token' });
    cb?.({ ok: true, player: toPublicPlayer(player) });
  });

  // 관전자 응원
  socket.on('spectator:cheer', ({ battleId, name, message }) => {
    io.to(battleId).emit('chatMessage', { name: name ? `[응원] ${name}` : '[응원]', message, timestamp: now(), type: 'cheer' });
  });

  // 채팅
  socket.on('chatMessage', ({ battleId, name, message }) => {
    io.to(battleId).emit('chatMessage', { name: name || '익명', message, timestamp: now() });
  });

  // 준비
  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb?.({ ok: false });
    const p = b.players.find(x => x.id === playerId);
    if (p) log(b.id, 'battle', `${p.name}이(가) 준비 완료했습니다`);
    cb?.({ ok: true });
  });

  // 플레이어 행동
  /*
    action = { type: 'attack'|'defend'|'dodge'|'item'|'pass', targetId?, item? }
    - item: 'dittany' | 'attackBooster' | 'defenseBooster'
  */
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    const b = battles.get(battleId);
    if (!b || b.status !== 'active' || !b.currentTurn) return cb?.({ ok: false, error: 'bad_state' });

    const p = b.players.find(x => x.id === playerId);
    if (!p || p.hp <= 0) return cb?.({ ok: false, error: 'no_player' });

    // 턴 확인(해당 팀 + 현재 플레이어)
    if (b.currentTurn.currentTeam !== p.team || b.currentTurn.currentPlayer?.id !== p.id) {
      return cb?.({ ok: false, error: 'not_your_turn' });
    }

    // 액션 기록
    b.pending[p.team] = {
      type: action.type,
      playerId: p.id,
      targetId: action.targetId || null,
      item: action.item || null,
      temp: {}
    };

    // 아이템 소비(보정기/디터니는 시도 시 개수 차감)
    if (action.type === 'item') {
      if (action.item === 'dittany' && p.items.dittany > 0) p.items.dittany -= 1;
      if (action.item === 'attackBooster' && p.items.attackBooster > 0) p.items.attackBooster -= 1;
      if (action.item === 'defenseBooster' && p.items.defenseBooster > 0) p.items.defenseBooster -= 1;
    }

    // 즉시 다음 단계로
    cb?.({ ok: true });
    io.to(b.id).emit('player:action:success');

    // 현재 팀 행동이 끝났으므로 턴 넘김 or 라운드 해석
    goNextPhase(b);
  });
});

// --------------------------
// 에러 핸들러(마지막)
// --------------------------
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'internal' });
});
process.on('unhandledRejection', e => console.error('[UNHANDLED REJECTION]', e));
process.on('uncaughtException', e => console.error('[UNCAUGHT EXCEPTION]', e));

// --------------------------
// 부트
// --------------------------
server.listen(PORT, () => {
  console.log(`PYXIS battle server running on http://localhost:${PORT}`);
});
