/**
 * PYXIS Battle Server (PM2-ready, single file)
 * 경로: packages/battle-server/index.js
 * Node.js 18+ 권장
 */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// ========================== 기본 경로/폴더 ==========================
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// ========================== 서버/소켓 기본 ==========================
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  path: '/socket.io',
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '1d',
}));

// ========================== 유틸 ==========================
const rnd = (n) => Math.floor(Math.random() * n) + 1;        // 1..n
const d10 = () => rnd(10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = () => new Date();

function tstr(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function roomOf(battleId) {
  return `battle:${battleId}`;
}

function baseUrlOf(req) {
  // admin 페이지가 보내는 x-base-url 헤더 있으면 우선 사용
  const hinted = req.get('x-base-url');
  if (hinted) return hinted.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// ========================== 전역 상태 ==========================
/**
 * 메모리 배틀 저장소
 * 구조:
 * {
 *   id, mode, status, createdAt,
 *   players: [ {id,name,team,hp,maxHp,avatar,stats{attack,defense,agility,luck},items{dittany,attackBooster,defenseBooster}} ],
 *   tokenMap: Map(token -> playerId),
 *   spectatorOtp: string,
 *   turn: {
 *     number: 1,
 *     currentTeam: 'A'|'B'|null,
 *     currentPlayerId: string|null,
 *     timeLeftSec: number
 *   },
 *   firstTeam: 'A'|'B',
 *   half: 1|2,           // 라운드 내 A/B 턴 구분
 *   idxA: number,        // A팀 순환 인덱스
 *   idxB: number,        // B팀 순환 인덱스
 *   turnDurationSec: 300,
 *   tickTimer: NodeTimer|null,
 *   roundBreakTimer: NodeTimer|null,
 *   roundBufferA: string[],
 *   roundBufferB: string[],
 *   logs: [{ts:Date,type,message}]
 * }
 */
const battles = new Map();

// ========================== 업로드 ==========================
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `${Date.now()}_${uuidv4()}${ext}`);
    }
  })
});

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
    const rel = `/uploads/avatars/${req.file.filename}`;
    return res.json({ ok: true, url: rel });
  } catch (e) {
    console.error('upload error', e);
    return res.status(500).json({ ok: false, error: 'UPLOAD_FAIL' });
  }
});

// ========================== 정적/라우팅 ==========================
app.get('/', (_req, res) => {
  res.redirect('/admin');
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});
app.get('/player', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'player.html'));
});
app.get('/spectator', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'spectator.html'));
});
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ========================== 전투 생성/링크 ==========================
app.post('/api/battles', (req, res) => {
  try {
    const mode = String(req.body?.mode || '2v2');
    const id = `battle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const battle = {
      id,
      mode,
      status: 'waiting',
      createdAt: Date.now(),
      players: [],
      tokenMap: new Map(),
      spectatorOtp: '',
      turn: { number: 1, currentTeam: null, currentPlayerId: null, timeLeftSec: 0 },
      firstTeam: 'A',
      half: 1,
      idxA: 0,
      idxB: 0,
      turnDurationSec: 300,
      tickTimer: null,
      roundBreakTimer: null,
      roundBufferA: [],
      roundBufferB: [],
      logs: []
    };
    battles.set(id, battle);
    log(battle, 'system', `전투 생성 완료: ${id}`);
    res.json({ ok: true, id, battle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'CREATE_FAIL' });
  }
});

// 링크/비번 생성 (두 경로 다 제공)
app.post(['/api/admin/battles/:id/links', '/api/battles/:id/links'], (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  if (!battle.spectatorOtp) {
    battle.spectatorOtp = Math.random().toString(36).slice(2, 10);
  }
  const base = baseUrlOf(req);

  const playerLinks = battle.players.map(p => {
    // 토큰 없으면 발급
    let token = null;
    for (const [tk, pid] of battle.tokenMap.entries()) {
      if (pid === p.id) { token = tk; break; }
    }
    if (!token) {
      token = `${uuidv4().replace(/-/g, '')}${Math.random().toString(36).slice(2, 6)}`;
      battle.tokenMap.set(token, p.id);
    }
    const url = `${base}/player?battle=${encodeURIComponent(battle.id)}&token=${encodeURIComponent(token)}`;
    return {
      playerId: p.id,
      playerName: p.name,
      team: p.team,
      otp: token,
      url
    };
  });

  const spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(battle.id)}&otp=${encodeURIComponent(battle.spectatorOtp)}`;

  res.json({
    ok: true,
    spectator: { otp: battle.spectatorOtp, url: spectatorUrl },
    spectatorOtp: battle.spectatorOtp,
    spectatorUrl,
    players: battle.players,
    playerLinks
  });
});

// ========================== 룰/계산 ==========================
// 피해 계산 규칙 요약:
//
// 최종공격력 = 공격스탯 × (공격보정기 있으면 2, 없으면 1) + d10
// 치명타 = (d10 ≥ 10 − 행운/2) 이면 피해 2배
// 회피성공 = (민첩 + d10) ≥ 공격자의 최종공격력 → 피해 0
// 방어값 = 방어스탯 × (방보정 있으면 2) + d10
// 방어 적용 피해 = (치명 반영된 최종공격력) − 방어값  (≤0이면 0)
//
// ※ 회피/방어를 선택하지 않으면 자동으로 적용되지 않음.
// ※ 아이템은 사용한 턴에만 적용, 성공확률 90% (실패 10%). 실패 시 효과 미적용·소모 안함.

function rollCrit(luck) {
  const roll = d10();
  const need = 10 - (Number(luck || 0) / 2);
  const isCrit = roll >= need;
  return { isCrit, roll, need: Math.max(1, need) };
}

function applyAttackFormula(attacker, useAtkBooster) {
  const stat = Number(attacker.stats?.attack || 1);
  const mult = useAtkBooster ? 2 : 1;
  return stat * mult + d10();
}

function defenseValue(defender, useDefBooster) {
  const stat = Number(defender.stats?.defense || 1);
  const mult = useDefBooster ? 2 : 1;
  return stat * mult + d10();
}

function dodgeSuccess(defender, attackerFinalAtk) {
  const agi = Number(defender.stats?.agility || 1);
  return (agi + d10()) >= attackerFinalAtk;
}

function tryItem(successRate = 0.9) {
  return Math.random() < successRate;
}

// ========================== 로깅/브로드캐스트 ==========================
function log(battle, type, message) {
  const entry = { ts: Date.now(), type, message };
  battle.logs.push(entry);
  io.to(roomOf(battle.id)).emit('battle:log', entry);
}

function snapshot(battle) {
  const currentPlayer = battle.players.find(p => p.id === battle.turn.currentPlayerId) || null;
  return {
    id: battle.id,
    status: battle.status,
    mode: battle.mode,
    players: battle.players.map(p => ({
      id: p.id, name: p.name, team: p.team,
      hp: p.hp, maxHp: p.maxHp, avatar: p.avatar,
      stats: p.stats, items: p.items
    })),
    currentTurn: {
      turnNumber: battle.turn.number,
      currentTeam: battle.turn.currentTeam,
      currentPlayer: currentPlayer ? {
        id: currentPlayer.id,
        name: currentPlayer.name,
        team: currentPlayer.team,
        avatar: currentPlayer.avatar
      } : null,
      timeLeftSec: battle.turn.timeLeftSec
    }
  };
}

function broadcast(battle) {
  const snap = snapshot(battle);
  io.to(roomOf(battle.id)).emit('battleUpdate', snap);
  // 구형 호환
  io.to(roomOf(battle.id)).emit('battle:update', snap);
}

// ========================== 턴/전투 제어 ==========================
function alivePlayersOf(battle, team) {
  return battle.players.filter(p => p.team === team && p.hp > 0);
}
function allDead(battle, team) {
  return alivePlayersOf(battle, team).length === 0;
}
function endBattle(battle, reason = '전투 종료') {
  battle.status = 'ended';
  clearTimers(battle);
  log(battle, 'battle', reason);
  broadcast(battle);
}

function clearTimers(battle) {
  if (battle.tickTimer) clearInterval(battle.tickTimer);
  battle.tickTimer = null;
  if (battle.roundBreakTimer) clearTimeout(battle.roundBreakTimer);
  battle.roundBreakTimer = null;
}

function chooseFirstTeam(battle) {
  // d10 + 팀 평균 민첩으로 선공 결정
  const avgAgi = (arr) => {
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((s, p) => s + Number(p.stats?.agility || 1), 0) / arr.length);
  };
  const aList = alivePlayersOf(battle, 'A');
  const bList = alivePlayersOf(battle, 'B');
  const aRoll = d10() + avgAgi(aList);
  const bRoll = d10() + avgAgi(bList);
  log(battle, 'battle', `선공 결정: A팀(${aRoll}) vs B팀(${bRoll})`);
  battle.firstTeam = (bRoll > aRoll) ? 'B' : 'A';
  log(battle, 'battle', `${battle.firstTeam}팀이 선공입니다!`);
}

function nextAliveId(battle, team, startIdx) {
  const teamList = alivePlayersOf(battle, team);
  if (teamList.length === 0) return { id: null, nextIdx: startIdx };
  const loop = teamList.map(p => p.id);
  const i = clamp(startIdx, 0, loop.length - 1);
  return { id: loop[i % loop.length], nextIdx: (i + 1) % loop.length };
}

function setTurnForTeam(battle, team) {
  if (allDead(battle, team)) {
    endBattle(battle, `${team}팀 전원이 사망했습니다. ${team === 'A' ? 'B' : 'A'}팀의 승리!`);
    return;
  }
  battle.turn.currentTeam = team;

  if (team === 'A') {
    const { id, nextIdx } = nextAliveId(battle, 'A', battle.idxA);
    battle.idxA = nextIdx;
    battle.turn.currentPlayerId = id;
  } else {
    const { id, nextIdx } = nextAliveId(battle, 'B', battle.idxB);
    battle.idxB = nextIdx;
    battle.turn.currentPlayerId = id;
  }

  battle.turn.timeLeftSec = battle.turnDurationSec;
  log(battle, 'battle', `${team}팀의 턴입니다`);
  broadcast(battle);

  // 틱 타이머 시작/재시작
  clearInterval(battle.tickTimer);
  battle.tickTimer = setInterval(() => {
    if (battle.status !== 'active') return;
    battle.turn.timeLeftSec = Math.max(0, battle.turn.timeLeftSec - 1);
    if (battle.turn.timeLeftSec % 3 === 0) broadcast(battle); // 부하 줄이기
    if (battle.turn.timeLeftSec <= 0) {
      clearInterval(battle.tickTimer);
      // 시간초과 → 자동 패스
      const pid = battle.turn.currentPlayerId;
      if (pid) resolveAction(battle, pid, { type: 'pass' }, true);
    }
  }, 1000);
}

function startBattle(battle) {
  if (!battle) return;
  if (battle.status === 'active') return;
  if (battle.players.filter(p => p.team === 'A').length === 0 ||
      battle.players.filter(p => p.team === 'B').length === 0) {
    log(battle, 'error', '두 팀 모두 최소 1명 이상 필요합니다');
    return;
  }
  battle.status = 'active';
  battle.turn.number = 1;
  battle.half = 1;
  battle.roundBufferA = [];
  battle.roundBufferB = [];
  chooseFirstTeam(battle);
  const first = battle.firstTeam;
  log(battle, 'battle', '전투가 시작되었습니다!');
  setTurnForTeam(battle, first);
}

function pauseBattle(battle) {
  if (!battle || battle.status !== 'active') return;
  battle.status = 'paused';
  clearTimers(battle);
  log(battle, 'system', '전투가 일시정지되었습니다');
  broadcast(battle);
}

function resumeBattle(battle) {
  if (!battle || battle.status !== 'paused') return;
  battle.status = 'active';
  log(battle, 'system', '전투가 재개되었습니다');
  // 남은 팀/시간 그대로 진행
  setTurnForTeam(battle, battle.turn.currentTeam || 'A');
}

function breakThenNextRound(battle) {
  clearTimers(battle);
  battle.turn.currentPlayerId = null;
  battle.turn.timeLeftSec = 0;
  broadcast(battle);

  log(battle, 'notice', '5초 후 다음 라운드 시작...');
  battle.roundBreakTimer = setTimeout(() => {
    battle.turn.number += 1;
    battle.half = 1;
    battle.roundBufferA = [];
    battle.roundBufferB = [];
    log(battle, 'battle', `=== 제${battle.turn.number}라운드 시작 ===`);
    setTurnForTeam(battle, 'A'); // 라운드 시작은 A팀부터
  }, 5000);
}

function finalizeHalfAndMaybeRound(battle, actedTeam) {
  // 한 팀의 행동이 끝날 때 호출
  if (actedTeam === 'A') {
    battle.half = 2;
    if (!allDead(battle, 'B')) setTurnForTeam(battle, 'B');
    else endBattle(battle, 'B팀 전원이 사망했습니다. A팀의 승리!');
  } else {
    // B가 끝났으면 라운드 결과 집계
    log(battle, 'battle', '=== 라운드 결과 ===');
    const out = [...battle.roundBufferA, ...battle.roundBufferB];
    if (out.length === 0) log(battle, 'battle', '→ 공격 없음');
    else out.forEach(m => log(battle, 'battle', m));
    log(battle, 'battle', `${battle.turn.number}라운드 종료`);
    breakThenNextRound(battle);
  }
}

// ========================== 액션 처리 ==========================
function getBattlePlayer(battle, pid) {
  return battle.players.find(p => p.id === pid) || null;
}

function firstAliveEnemy(battle, team) {
  const enemy = team === 'A' ? 'B' : 'A';
  return alivePlayersOf(battle, enemy)[0] || null;
}

function resolveAction(battle, playerId, action, isAuto = false) {
  if (!battle || battle.status !== 'active') return;
  const actor = getBattlePlayer(battle, playerId);
  if (!actor || actor.hp <= 0) return;

  const team = actor.team;
  const other = team === 'A' ? 'B' : 'A';

  // 현재 턴 체크
  if (battle.turn.currentPlayerId !== actor.id || battle.turn.currentTeam !== team) {
    return; // 자기 턴 아님
  }

  clearInterval(battle.tickTimer); // 행동 시 타이머 정지

  const aBuf = (team === 'A') ? battle.roundBufferA : battle.roundBufferB;

  // 액션 타입
  const type = String(action?.type || 'attack');

  // 아이템 적용(해당 턴만 유효)
  let useAtkBoost = false;
  let useDefBoost = false;

  // 공격/방어 보정기 액션이면 90% 성공
  if (type === 'item') {
    const key = String(action.item || '').toLowerCase();
    if (key === 'attackbooster') {
      if ((actor.items?.attackBooster || 0) > 0) {
        if (tryItem(0.9)) {
          useAtkBoost = true;
          actor.items.attackBooster -= 1; // 성공시에만 소모
          aBuf.push(`→ ${actor.name}이(가) 공격 보정기 사용 성공`);
          log(battle, 'battle', `→ ${actor.name}이(가) 공격 보정기 사용 성공`);
        } else {
          aBuf.push(`→ ${actor.name}이(가) 공격 보정기 사용 실패`);
          log(battle, 'battle', `→ ${actor.name}이(가) 공격 보정기 사용 실패`);
        }
      } else {
        aBuf.push(`→ ${actor.name}이(가) 공격 보정기를 보유하지 않음`);
      }
    } else if (key === 'defensebooster') {
      if ((actor.items?.defenseBooster || 0) > 0) {
        if (tryItem(0.9)) {
          useDefBoost = true;
          actor.items.defenseBooster -= 1;
          aBuf.push(`→ ${actor.name}이(가) 방어 보정기 사용 성공`);
          log(battle, 'battle', `→ ${actor.name}이(가) 방어 보정기 사용 성공`);
        } else {
          aBuf.push(`→ ${actor.name}이(가) 방어 보정기 사용 실패`);
          log(battle, 'battle', `→ ${actor.name}이(가) 방어 보정기 사용 실패`);
        }
      } else {
        aBuf.push(`→ ${actor.name}이(가) 방어 보정기를 보유하지 않음`);
      }
    } else if (key === 'dittany') {
      // 치유 아이템 (90% 성공). 대상은 같은 팀
      const tgt = getBattlePlayer(battle, action.targetId) || firstAliveTeammate(battle, actor);
      if (!tgt) {
        aBuf.push(`→ ${actor.name}의 디터니 사용 실패 (대상 없음)`);
      } else if (tgt.hp <= 0) {
        aBuf.push(`→ ${actor.name}의 ${tgt.name}에게 디터니 사용 실패 (사망자)`);
      } else if ((actor.items?.dittany || 0) <= 0) {
        aBuf.push(`→ ${actor.name}이(가) 디터니를 보유하지 않음`);
      } else {
        if (tryItem(0.9)) {
          const heal = 25; // 고정 25
          const before = tgt.hp;
          tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp || 100);
          actor.items.dittany -= 1;
          const after = tgt.hp;
          const gained = after - before;
          const msg = `→ ${actor.name}이(가) ${tgt.name} 치유 (+${gained}) → HP ${after}`;
          aBuf.push(msg);
          log(battle, 'battle', msg);
          // 행동 종료 처리
          broadcast(battle);
          log(battle, 'battle', `${team}팀 선택 완료`);
          finalizeHalfAndMaybeRound(battle, team);
          return;
        } else {
          aBuf.push(`→ ${actor.name}의 ${tgt.name}에게 디터니 사용 실패`);
          log(battle, 'battle', `→ ${actor.name}의 ${tgt.name}에게 디터니 사용 실패`);
        }
      }
      // 아이템만 쓰고 종료
      broadcast(battle);
      log(battle, 'battle', `${team}팀 선택 완료`);
      finalizeHalfAndMaybeRound(battle, team);
      return;
    }
    // 보정기만 켰다면 이어서 (공/방 선택이 있어야 효과)
    // 여기서 바로 종료하지 않음 → 사용 직후 공격/방어/회피/패스 중 하나를 클라가 보냄
  }

  // 공격/방어/회피/패스 처리
  if (type === 'pass') {
    aBuf.push(`→ ${actor.name}이(가) 행동 패스`);
    log(battle, 'battle', `→ ${actor.name}이(가) 행동 패스`);
    broadcast(battle);
    log(battle, 'battle', `${team}팀 선택 완료`);
    finalizeHalfAndMaybeRound(battle, team);
    return;
  }

  if (type === 'defend') {
    // 방어 선택 시 방어값으로 피해 경감 (상대가 공격했을 때를 가정)
    // 이번 턴에는 실제 피격/역공 없음 → 설명 메시지
    const defVal = defenseValue(actor, useDefBoost);
    const msg = `→ ${actor.name}이(가) 방어 태세 (방어값 ${defVal})`;
    aBuf.push(msg);
    log(battle, 'battle', msg);
    broadcast(battle);
    log(battle, 'battle', `${team}팀 선택 완료`);
    finalizeHalfAndMaybeRound(battle, team);
    return;
  }

  if (type === 'dodge') {
    // 회피 태세만 표기 (실제 공격을 받지 않으면 의미 없음)
    const msg = `→ ${actor.name}이(가) 회피 태세`;
    aBuf.push(msg);
    log(battle, 'battle', msg);
    broadcast(battle);
    log(battle, 'battle', `${team}팀 선택 완료`);
    finalizeHalfAndMaybeRound(battle, team);
    return;
  }

  // 기본: 공격 (명시 안하면 공격)
  const target =
    getBattlePlayer(battle, action.targetId) ||
    firstAliveEnemy(battle, team);

  if (!target || target.hp <= 0) {
    aBuf.push(`→ ${actor.name}이(가) 공격할 대상이 없습니다`);
    log(battle, 'battle', `→ ${actor.name}이(가) 공격할 대상이 없습니다`);
    broadcast(battle);
    log(battle, 'battle', `${team}팀 선택 완료`);
    finalizeHalfAndMaybeRound(battle, team);
    return;
  }

  const attackerFinalAtk = applyAttackFormula(actor, useAtkBoost);
  const critInfo = rollCrit(Number(actor.stats?.luck || 1));
  const base = critInfo.isCrit ? attackerFinalAtk * 2 : attackerFinalAtk;

  // 대상이 '회피' 혹은 '방어'를 선택했는지는 서버에선 알 수 없으므로
  // 이 전 라운드 로그로 추정할 수 없고, 현재 스펙에선 "선택했을 때만 유효"이니
  // 클라이언트 측에서 실제로 해당 선택을 보냈을 때만 방어/회피 문구가 남았을 것.
  // 따라서 여기서는 **회피/방어를 선택하지 않았다고 가정**하고 순수 공격 처리.
  // (요구사항: 회피를 고르지 않으면 단순 공격으로 들어간다)
  // 만약 방어/회피 상태를 서버가 기억하고 싶다면 actor/tgt에 플래그를 둬서 직전 선택을 기록하면 됨.

  // 회피는 선택했을 때만 성공 판정하므로 여기선 스킵
  // 방어 또한 선택했을 때만 적용하므로 여기선 스킵
  let damage = base;
  damage = Math.max(0, Math.round(damage));

  // 실제 적용
  const before = target.hp;
  target.hp = clamp(target.hp - damage, 0, target.maxHp || 100);
  const after = target.hp;

  // 메시지
  if (critInfo.isCrit && after <= 0) {
    const msg = `→ ${actor.name}의 강화된 치명타 공격으로 ${target.name} 사망! (피해 ${damage})`;
    aBuf.push(msg); log(battle, 'battle', msg);
  } else if (after <= 0) {
    const msg = `→ ${actor.name}의 공격으로 ${target.name} 사망! (피해 ${damage})`;
    aBuf.push(msg); log(battle, 'battle', msg);
  } else {
    const msg = critInfo.isCrit
      ? `→ ${actor.name}이(가) ${target.name}에게 강화된 공격 (피해 ${damage}) → HP ${after}`
      : `→ ${actor.name}이(가) ${target.name}에게 공격 (피해 ${damage}) → HP ${after}`;
    aBuf.push(msg); log(battle, 'battle', msg);
  }

  // 팀 전멸 체크
  if (allDead(battle, 'A')) return endBattle(battle, 'A팀 전원이 사망했습니다. B팀의 승리!');
  if (allDead(battle, 'B')) return endBattle(battle, 'B팀 전원이 사망했습니다. A팀의 승리!');

  broadcast(battle);
  log(battle, 'battle', `${team}팀 선택 완료`);
  finalizeHalfAndMaybeRound(battle, team);
}

function firstAliveTeammate(battle, actor) {
  const teamMates = alivePlayersOf(battle, actor.team).filter(p => p.id !== actor.id);
  return teamMates[0] || actor; // 자기 자신 치유 허용
}

// ========================== 소켓 핸들러 ==========================
io.on('connection', (socket) => {
  socket.on('join', ({ battleId }) => {
    if (!battleId) return;
    socket.join(roomOf(battleId));
    const b = battles.get(battleId);
    if (b) {
      socket.emit('battleUpdate', snapshot(b));
      socket.emit('battle:update', snapshot(b)); // 호환
      log(b, 'system', '새 연결이 입장했습니다');
    }
  });

  socket.on('chatMessage', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    io.to(roomOf(battleId)).emit('chatMessage', {
      ts: Date.now(),
      name: String(name || '익명'),
      message: String(message || ''),
    });
  });

  // 관전자 응원 → 채팅 형식 요구: "이름 : [응원]" + "(버튼 내용)"
  socket.on('spectator:cheer', ({ battleId, name, message }) => {
    if (!battleId || !message) return;
    const cheerName = `${String(name || '관전자')} : [응원]`;
    const content = `(${String(message)})`;
    io.to(roomOf(battleId)).emit('chatMessage', {
      ts: Date.now(), name: cheerName, message: content
    });
  });

  // 플레이어 인증 (토큰 → 플레이어)
  socket.on('playerAuth', ({ battleId, token }, cb) => {
    const b = battles.get(battleId);
    if (!b) return cb && cb({ ok: false, error: 'NOT_FOUND' });
    const pid = b.tokenMap.get(String(token || ''));
    if (!pid) return cb && cb({ ok: false, error: 'INVALID_TOKEN' });
    const player = getBattlePlayer(b, pid);
    if (!player) return cb && cb({ ok: false, error: 'PLAYER_NOT_FOUND' });
    cb && cb({ ok: true, player });
    socket.emit('authSuccess', { player });
    socket.emit('auth:success', { player }); // 호환
  });

  // 참가자 추가
  socket.on('addPlayer', (payload, cb) => {
    try {
      const battle = battles.get(payload?.battleId);
      if (!battle) return cb && cb({ ok: false, error: 'NOT_FOUND' });

      const p = payload.player || {};
      const id = p.id || `p_${uuidv4().slice(0, 8)}`;
      const player = {
        id,
        name: String(p.name || '이름없음'),
        team: (p.team === 'B') ? 'B' : 'A',
        hp: Number(p.hp ?? p.maxHp ?? 100),
        maxHp: Number(p.maxHp ?? p.hp ?? 100),
        avatar: p.avatar || '/uploads/avatars/default.svg',
        stats: {
          attack: Number(p.stats?.attack ?? 1),
          defense: Number(p.stats?.defense ?? 1),
          agility: Number(p.stats?.agility ?? 1),
          luck: Number(p.stats?.luck ?? 1)
        },
        items: {
          dittany: Number(p.items?.dittany ?? 0),
          attackBooster: Number(p.items?.attackBooster ?? 0),
          defenseBooster: Number(p.items?.defenseBooster ?? 0)
        }
      };
      battle.players.push(player);
      log(battle, 'battle', `${player.name}이(가) ${player.team}팀으로 참가했습니다`);

      // 토큰도 즉시 발급
      const token = `${uuidv4().replace(/-/g, '')}${Math.random().toString(36).slice(2, 6)}`;
      battle.tokenMap.set(token, id);

      broadcast(battle);
      cb && cb({ ok: true, playerId: id, token });
    } catch (e) {
      console.error(e);
      cb && cb({ ok: false, error: 'ADD_FAIL' });
    }
  });

  // 참가자 삭제
  socket.on('deletePlayer', ({ battleId, playerId }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    const before = battle.players.length;
    battle.players = battle.players.filter(p => p.id !== playerId);
    // 토큰도 제거
    for (const [tk, pid] of battle.tokenMap.entries()) {
      if (pid === playerId) battle.tokenMap.delete(tk);
    }
    const after = battle.players.length;
    if (after < before) log(battle, 'notice', `${playerId}가 전투에서 제거되었습니다`);
    broadcast(battle);
    cb && cb({ ok: true });
  });

  // 준비완료
  socket.on('player:ready', ({ battleId, playerId }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    const p = getBattlePlayer(battle, playerId);
    if (!p) return cb && cb({ ok: false });
    log(battle, 'battle', `${p.name}이(가) 준비 완료했습니다`);
    cb && cb({ ok: true });
  });

  // 행동
  socket.on('player:action', ({ battleId, playerId, action }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    resolveAction(battle, playerId, action);
    cb && cb({ ok: true });
  });

  // 전투 제어
  socket.on('startBattle', ({ battleId }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    startBattle(battle);
    cb && cb({ ok: true });
  });

  socket.on('pauseBattle', ({ battleId }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    pauseBattle(battle);
    cb && cb({ ok: true });
  });

  socket.on('resumeBattle', ({ battleId }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    resumeBattle(battle);
    cb && cb({ ok: true });
  });

  socket.on('endBattle', ({ battleId }, cb) => {
    const battle = battles.get(battleId);
    if (!battle) return cb && cb({ ok: false });
    endBattle(battle, '게임이 종료되었습니다');
    cb && cb({ ok: true });
  });
});

// ========================== 서버 시작 ==========================
server.listen(PORT, HOST, () => {
  console.log(`[PYXIS] Battle server running on http://${HOST}:${PORT}`);
});
