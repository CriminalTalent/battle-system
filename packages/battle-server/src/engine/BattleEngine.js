// packages/battle-server/src/engine/BattleEngine.js
// ESM

/* BattleEngine
   - 선/후공 교대
   - 선택 단계(A_select/B_select)에서 "선택 로그"만 남김
   - 양 팀 모두 선택 완료 후 resolve 단계에서 순차적 데미지/회복 및 상세 로그
   - 동일 민첩은 이름(ABC) 순
   - 1시간 제한 종료 시 팀 HP 합계로 승자 (서든데스 없음)
*/

function uid(n = 8) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

export function createBattleStore(){
  const battles = new Map();

  function pushLog(id, type, message){
    const b = battles.get(id); if(!b) return;
    b.logs.push({ ts: Date.now(), type, message });
  }
  function sumTeamHp(b, team){
    return b.players.filter(p=>p.team===team).reduce((a,p)=>a+Math.max(0,p.hp|0),0);
  }
  function livingTeamPlayers(b, team){
    return b.players.filter(p=>p.team===team && p.hp>0);
  }
  function sortByAgilityThenName(list){
    return list.sort((a,b)=>{
      const aA=a.stats?.agility||0, bA=b.stats?.agility||0;
      if(aA!==bA) return bA-aA;
      return (a.name||'').localeCompare(b.name||'', 'ko');
    });
  }
  function findPlayer(b, id){ return b.players.find(p=>p.id===id)||null; }

  function makeSnapshot(b){
    return {
      id: b.id, mode: b.mode, status: b.status, round: b.round,
      currentTeam: b.currentTeam, phase: b.phase,
      currentTurn: deepClone(b.currentTurn),
      players: deepClone(b.players),
      logs: deepClone(b.logs.slice(-200)),
      winner: b.winner || null
    };
  }

  function checkTimeLimitAndMaybeEnd(id){
    const b = battles.get(id); if(!b) return false;
    if (!b.deadlineAt || b.status!=='active') return false;
    if (Date.now() < b.deadlineAt) return false;

    const aHp=sumTeamHp(b,'A'), bHp=sumTeamHp(b,'B');
    let winner;
    if (aHp!==bHp) winner = aHp>bHp ? 'A' : 'B';
    else {
      const aAlive = b.players.filter(p=>p.team==='A'&&p.hp>0).length;
      const bAlive = b.players.filter(p=>p.team==='B'&&p.hp>0).length;
      winner = (aAlive!==bAlive) ? (aAlive>bAlive?'A':'B') : 'A';
    }
    b.status='ended'; b.winner=winner;
    pushLog(id,'result',`시간 종료 – 승자: ${winner}팀 (A:${aHp} / B:${bHp})`);
    return true;
  }

  function eligibleActorsForTeam(b, team){
    return sortByAgilityThenName(livingTeamPlayers(b, team)).map(p=>p.id);
  }

  function create(mode='2v2'){
    const id=uid(8);
    const b={
      id, mode,
      status:'waiting',
      round:0,
      currentTeam:'A',
      phase:'inter',
      currentTurn:{ turnNumber:0, currentTeam:'A', timeLeftSec:0, currentPlayer:null },
      players:[],
      logs:[],
      actions:{ A:[], B:[] },
      spectatorOtp:null,
      winner:null,
      startedAt:null,
      deadlineAt:null,
    };
    battles.set(id,b);
    return b;
  }
  function get(id){ return battles.get(id)||null; }
  function size(){ return battles.size; }
  function snapshot(id){ const b=battles.get(id); return b?makeSnapshot(b):null; }

  function start(id){
    const b=battles.get(id); if(!b) return null;
    if (!b.players.length) return null;
    b.status='active';
    b.round=1;
    b.currentTeam='A';
    b.phase='A_select';
    b.currentTurn={ turnNumber:1, currentTeam:'A', timeLeftSec:0, currentPlayer:null };
    b.actions={A:[],B:[]};
    b.startedAt=Date.now();
    b.deadlineAt=b.startedAt + 60*60*1000;
    pushLog(id,'notice','라운드 1 시작 (선공: A팀)');
    pushLog(id,'system','제한시간 60분: 종료 시 남은 HP 합계로 승자 결정');
    return { ok:true, b };
  }
  function pause(id){ const b=battles.get(id); if(!b||b.status!=='active') return null; b.status='paused'; pushLog(id,'system','전투가 일시정지되었습니다'); return b; }
  function resume(id){ const b=battles.get(id); if(!b||b.status!=='paused') return null; b.status='active'; pushLog(id,'system','전투가 재개되었습니다'); return b; }
  function end(id){ const b=battles.get(id); if(!b) return null; b.status='ended'; return b; }

  function addPlayer(id, player){
    const b=battles.get(id); if(!b) return null;
    const pid=uid(8);
    const p={
      id:pid,
      name:String(player?.name || `Player_${pid}`),
      team:(player?.team==='B'?'B':'A'),
      hp:clamp(Number(player?.hp ?? 100),1,100000),
      maxHp:clamp(Number(player?.maxHp ?? player?.hp ?? 100),1,100000),
      stats:{
        attack:clamp(Number(player?.stats?.attack ?? 1),0,999),
        defense:clamp(Number(player?.stats?.defense ?? 1),0,999),
        agility:clamp(Number(player?.stats?.agility ?? 1),0,999),
        luck:clamp(Number(player?.stats?.luck ?? 1),0,999),
      },
      items:{
        dittany: Number(player?.items?.dittany ?? player?.items?.ditany ?? 0) | 0,
        attackBooster: Number(player?.items?.attackBooster ?? player?.items?.attack_boost ?? 0) | 0,
        defenseBooster: Number(player?.items?.defenseBooster ?? player?.items?.defense_boost ?? 0) | 0,
      },
      token: player?.token || null,
      avatar: player?.avatar || null,
      ready: !!player?.ready
    };
    b.players.push(p);
    return p;
  }
  function removePlayer(id, pid){
    const b=battles.get(id); if(!b) return false;
    const i=b.players.findIndex(p=>p.id===pid); if(i<0) return false;
    b.players.splice(i,1); return true;
  }
  function markReady(id,pid,ready=true){
    const b=battles.get(id); if(!b) return false;
    const p=findPlayer(b,pid); if(!p) return false;
    p.ready=!!ready; return true;
  }
  function authByToken(id, token){
    const b=battles.get(id); if(!b) return null;
    return b.players.find(p=>p.token && p.token===token) || null;
  }

  function normalizeAction(a){
    if(!a||typeof a!=='object') return { type:'pass' };
    const t=String(a.type||'pass');
    if (t==='attack') return { type:'attack', targetId:a.targetId||null };
    if (t==='defend') return { type:'defend' };
    if (t==='dodge')  return { type:'dodge'  };
    if (t==='item')   return { type:'item', item:a.item||'', targetId:a.targetId||null };
    if (t==='pass')   return { type:'pass' };
    return { type:'pass' };
  }

  // 선택 로그(해석 전)
  function logChoice(b, actor, action){
    if (!actor) return;
    const t = action?.type;
    if (t==='attack'){
      const tgt = b.players.find(x=>x.id===action.targetId);
      const name = tgt ? tgt.name : '대상';
      pushLog(b.id,'notice',`${actor.name}이(가) ${name}에게 공격을 선택`);
      return;
    }
    if (t==='defend'){ pushLog(b.id,'notice',`${actor.name}이(가) 방어를 선택`); return; }
    if (t==='dodge'){  pushLog(b.id,'notice',`${actor.name}이(가) 회피를 선택`); return; }
    if (t==='item'){
      const label =
        action.item==='dittany' || action.item==='ditany' ? '디터니' :
        action.item==='attackBooster' ? '공격 보정기' :
        action.item==='defenseBooster' ? '방어 보정기' : '아이템';
      const tgt = b.players.find(x=>x.id===action.targetId);
      const name = tgt ? tgt.name : '자신';
      pushLog(b.id,'notice',`${actor.name}이(가) ${label} 사용을 선택 (${name})`);
      return;
    }
    pushLog(b.id,'notice',`${actor.name}이(가) 패스를 선택`);
  }

  // 실제 적용(해석 단계)
  function computeAction(b, actor, action){
    function say(txt){ pushLog(b.id,'battle',txt); }
    if (!actor || actor.hp<=0) return;

    const type = action?.type;
    if (type==='pass'){ say(`${actor.name} 패스`); return; }
    if (type==='defend'){ actor._defending = true; say(`${actor.name} 방어 자세`); return; }
    if (type==='dodge'){  actor._dodging  = true; say(`${actor.name} 회피 준비`); return; }

    if (type==='attack'){
      const target = findPlayer(b, action.targetId);
      if (!target || target.hp<=0){ say(`${actor.name} 공격했으나 대상이 없음`); return; }

      const atk0 = actor.stats?.attack || 0;
      const atk = actor._atkBoost ? atk0*2 : atk0;
      const def0 = target.stats?.defense || 0;
      const def = target._defBoost ? def0*2 : def0;

      let dmg = Math.max(1, atk - (target._defending ? def*2 : def));
      const crit = Math.random() < (0.15 + (actor.stats?.luck||0)*0.005);
      if (crit) dmg = Math.round(dmg*1.5);

      if (target._dodging && Math.random()<0.4){
        say(`${actor.name} → ${target.name} 공격 (회피됨)`);
        return;
      }

      target.hp = clamp(target.hp - dmg, 0, target.maxHp);
      say(`→ ${actor.name}이(가) ${target.name}에게 공격 (피해 ${dmg}) → HP ${target.hp}`);
      if (target.hp<=0) say(`${target.name} 전투불능`);
      return;
    }

    if (type==='item'){
      const item = action?.item;
      if (item==='dittany' || item==='ditany'){
        const target = findPlayer(b, action.targetId) || actor;
        const left = (actor.items?.dittany ?? actor.items?.ditany ?? 0);
        if (left>0 && target.hp>0){
          const heal=10;
          target.hp = clamp(target.hp + heal, 0, target.maxHp);
          if (actor.items.dittany != null) actor.items.dittany -= 1;
          else actor.items.ditany = (actor.items.ditany||1) - 1;
          say(`→ ${actor.name}이(가) ${target.name}에게 디터니 사용 (+${heal}) → HP ${target.hp}`);
        }else{
          say(`${actor.name} 디터니 사용 실패`);
        }
        return;
      }
      if (item==='attackBooster'){
        const left = (actor.items?.attackBooster ?? actor.items?.attack_boost ?? 0);
        if (left>0){
          actor._atkBoost = true;
          actor.items.attackBooster = (actor.items.attackBooster || actor.items.attack_boost || 1) - 1;
          say(`${actor.name} 공격 보정기 사용`);
        } else say(`${actor.name} 공격 보정기 없음`);
        return;
      }
      if (item==='defenseBooster'){
        const left = (actor.items?.defenseBooster ?? actor.items?.defense_boost ?? 0);
        if (left>0){
          actor._defBoost = true;
          actor.items.defenseBooster = (actor.items.defenseBooster || actor.items.defense_boost || 1) - 1;
          say(`${actor.name} 방어 보정기 사용`);
        } else say(`${actor.name} 방어 보정기 없음`);
        return;
      }
      pushLog(b.id,'system',`${actor.name} 알 수 없는 아이템 시도`);
      return;
    }
  }

  // 라운드 해석 (선공 → 후공 순, 다음 라운드 교대)
  function resolveRound(id){
    const b=battles.get(id); if(!b || b.status!=='active') return;

    b.phase='resolve';
    pushLog(id,'round',`라운드 ${b.round} 해석 시작`);

    // 라운드 일시 플래그 초기화
    b.players.forEach(p=>{ p._defending=false; p._dodging=false; p._atkBoost=!!p._atkBoost; p._defBoost=!!p._defBoost; });

    const order = (b.currentTeam==='A') ? ['A','B'] : ['B','A'];

    for (const team of order){
      const acts = b.actions[team] || [];
      // 액터 정렬(민첩 desc, 이름 asc) — 같은 배우의 중복 제출은 마지막 것으로
      const latest = new Map();
      for (const a of acts) latest.set(a.playerId, a.action);
      const actors = sortByAgilityThenName(
        [...latest.keys()].map(pid=>findPlayer(b, pid)).filter(p=>p&&p.hp>0)
      );
      for (const actor of actors){
        const act = normalizeAction(latest.get(actor.id));
        // 보정기 원스텝 반영은 computeAction 내부가 처리(필요 시 스탯 임시 2배)
        computeAction(b, actor, act);
      }
    }

    // 요약
    const aLeft=sumTeamHp(b,'A'), bLeft=sumTeamHp(b,'B');
    pushLog(id,'round',`라운드 ${b.round} 종료 (A:${aLeft} / B:${bLeft})`);

    // 승부 체크
    const aAlive=b.players.some(p=>p.team==='A'&&p.hp>0);
    const bAlive=b.players.some(p=>p.team==='B'&&p.hp>0);
    if (!aAlive || !bAlive){
      b.status='ended'; b.winner = aAlive ? 'A' : (bAlive ? 'B' : 'A');
      pushLog(id,'result',`승자: ${b.winner}팀`);
      return;
    }

    if (checkTimeLimitAndMaybeEnd(id)) return;

    // 다음 라운드로 — 선/후공 교대
    b.actions={A:[],B:[]};
    b.round += 1;
    b.currentTeam = (b.currentTeam==='A') ? 'B' : 'A';
    b.phase = (b.currentTeam==='A') ? 'A_select' : 'B_select';
    b.currentTurn={ turnNumber:b.round, currentTeam:b.currentTeam, timeLeftSec:0, currentPlayer:null };
    pushLog(id,'notice',`라운드 ${b.round} 시작 (${b.currentTeam}팀 선택)`);
  }

  function playerAction(id, playerId, action){
    const b=battles.get(id); if(!b || b.status!=='active') return null;

    if (checkTimeLimitAndMaybeEnd(id)) return { ok:false, error:'time over', b };

    const actor=findPlayer(b, playerId);
    if (!actor || actor.hp<=0) return { ok:false, error:'invalid actor', b };

    const team=actor.team;
    const isATurn=(b.phase==='A_select' && team==='A');
    const isBTurn=(b.phase==='B_select' && team==='B');
    if (!isATurn && !isBTurn){
      pushLog(id,'system',`${actor.name}의 차례가 아닙니다`);
      return { ok:false, error:'not your turn', b };
    }

    // 이 팀의 행동 가능자 목록(라운드 동안 고정)
    const requiredIds = eligibleActorsForTeam(b, team);
    if (!requiredIds.includes(actor.id)){
      pushLog(id,'system',`${actor.name} 행동 불가(사망/비활성)`);
      return { ok:false, error:'ineligible', b };
    }

    const normalized = normalizeAction(action);
    // 선택 로그(해석 전)
    logChoice(b, actor, normalized);

    // 저장(마지막 선택으로 유지)
    const arr=b.actions[team];
    const idx=arr.findIndex(x=>x.playerId===actor.id);
    if (idx>=0) arr[idx] = { playerId: actor.id, action: normalized };
    else arr.push({ playerId: actor.id, action: normalized });

    // 현재 팀이 모두 제출했는지?
    const submittedAll = requiredIds.every(pid => arr.some(a => a.playerId===pid));

    // 둘 다 모였는지 판단
    if (submittedAll){
      if ((b.phase==='A_select' && b.currentTeam==='A') ||
          (b.phase==='B_select' && b.currentTeam==='B')){
        // 선공 팀 완료 → 후공 팀 선택 단계로 전환
        const other = (team==='A') ? 'B' : 'A';
        b.phase = (other==='A') ? 'A_select' : 'B_select';
        b.currentTeam = other;
        b.currentTurn.currentTeam = other;
        pushLog(id,'notice',`${other}팀 선택 단계`);
      } else {
        // 후공 팀까지 완료 → 해석
        resolveRound(id);
      }
    }

    checkTimeLimitAndMaybeEnd(id);
    return { ok:true, b, result:{ submitted: b.actions[team].length, required: requiredIds.length } };
  }

  return {
    create, get, size, snapshot,
    start, pause, resume, end,
    addPlayer, removePlayer, markReady, authByToken,
    playerAction,
  };
}
