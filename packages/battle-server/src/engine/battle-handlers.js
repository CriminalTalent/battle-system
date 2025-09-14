
// battle-handlers_a.js
// Minimal, syntax-clean handlers that delegate to BattleEngine and use BroadcastManager.
// Path-safe for project root (no src/.. assumptions).

import BattleEngine from './BattleEngine (1).js';
import { BroadcastManager } from './broadcast.js';

let broadcastManager = null;

export function initializeBroadcastManager(io){
  broadcastManager = new BroadcastManager(io);
  return broadcastManager;
}

export function handlePlayerAction(io, battle, action){
  const engine = new BattleEngine(battle);
  const logs = [];
  const updates = { hp:{}, items:{}, effects:{} };
  const { playerId, type, targetId, itemType } = action || {};

  const player = (battle.players || []).find(p => p.id === playerId);
  if (!player) return { success:false, error:'플레이어를 찾을 수 없습니다', logs:[{type:'error', message:'유효하지 않은 플레이어입니다'}] };
  if (battle.status !== 'active') return { success:false, error:'전투가 진행 중이 아닙니다', logs:[{type:'error', message:'전투가 진행 중이 아닙니다'}] };

  const activeTeam = engine.getCurrentActiveTeam();
  if (player.team !== activeTeam){
    return { success:false, error:'현재 당신의 팀 턴이 아닙니다', logs:[{type:'error', message:`현재는 ${activeTeam}팀 턴입니다`}] };
  }
  if (player.hp <= 0){
    return { success:false, error:'쓰러진 플레이어는 행동할 수 없습니다', logs:[{type:'error', message:'쓰러진 플레이어는 행동할 수 없습니다'}] };
  }

  let ok = false;
  const t = String(type || '').toLowerCase();
  if (t === 'attack'){
    if (!targetId){ logs.push({type:'error', message:'공격 대상을 선택해주세요'}); }
    else ok = engine.processAttack(playerId, targetId, logs, updates);
  } else if (t === 'defend'){
    ok = engine.processDefend(playerId, logs);
  } else if (t === 'dodge'){
    ok = engine.processDodge ? engine.processDodge(playerId, logs) : engine.processPass(playerId, logs);
  } else if (t === 'item'){
    if (!itemType){ logs.push({type:'error', message:'사용할 아이템을 선택해주세요'}); }
    else {
      ok = engine.processItem(playerId, itemType, targetId, logs, updates);
      updates.items[playerId] = player.items || {};
    }
  } else if (t === 'pass'){
    ok = engine.processPass(playerId, logs);
  } else {
    logs.push({type:'error', message:'알 수 없는 행동입니다'});
  }

  if (!ok){
    return { success:false, error:'행동 처리에 실패했습니다', logs };
  }

  engine.recordPlayerAction(playerId);
  const phaseResult = engine.advancePhase();
  const battleState = engine.getBattleStats();

  if (broadcastManager){
    broadcastManager.broadcastActionResult(battle, { playerId, playerName: player.name, type, targetId, itemType }, { actor: player, logs, updates });
    if (logs.length) broadcastManager.broadcastCombatLog(battle.id, logs);
    if (phaseResult.phaseComplete) broadcastManager.broadcastPhaseComplete(battle, {
      round: battleState.round, phase: battleState.phase, activeTeam: battleState.activeTeam, turnComplete: phaseResult.turnComplete
    });
    if (phaseResult.turnComplete) broadcastManager.broadcastTurnChange(battle, {
      round: battleState.round, activeTeam: battleState.activeTeam, previousTeam: battleState.activeTeam === 'A' ? 'B' : 'A'
    });
    broadcastManager.broadcastBattleUpdate(battle, { immediate:true });
  }

  if (engine.isBattleOver()){
    const winner = engine.determineWinner();
    handleBattleEnd(io, battle, winner);
  }

  return { success:true, logs, updates, battleState, phaseResult };
}

export function handleTurnTimeout(io, battle){
  const engine = new BattleEngine(battle);
  const activeTeam = engine.getCurrentActiveTeam();
  const alivePlayers = engine.getAlivePlayersInTeam(activeTeam);
  const acted = (battle.turn?.acted?.[activeTeam]) || new Set();

  const logs = [];
  for (const p of alivePlayers){
    if (!acted.has(p.id)){
      logs.push({ type:'timeout', message:`${p.name}이(가) 시간 초과로 자동 패스되었습니다` });
      engine.recordPlayerAction(p.id);
    }
  }
  if (!logs.length) return;

  const phaseResult = engine.advancePhase();
  const battleState = engine.getBattleStats();

  if (broadcastManager){
    logs.forEach(l => broadcastManager.broadcastSystemLog(battle.id, l));
    if (phaseResult.phaseComplete) broadcastManager.broadcastPhaseComplete(battle, { round:battleState.round, phase:battleState.phase, activeTeam:battleState.activeTeam, turnComplete:phaseResult.turnComplete, reason:'timeout' });
    if (phaseResult.turnComplete) broadcastManager.broadcastTurnChange(battle, { round:battleState.round, activeTeam:battleState.activeTeam, reason:'timeout' });
    broadcastManager.broadcastBattleUpdate(battle);
  }

  if (engine.isBattleOver()){
    const w = engine.determineWinner();
    handleBattleEnd(io, battle, w);
  }
}

export function determineInitiative(battle){
  const engine = new BattleEngine(battle);
  const a = engine.getAlivePlayersInTeam('A');
  const b = engine.getAlivePlayersInTeam('B');
  const sumA = a.reduce((s,p)=> s + engine._readStats(p).agility, 0);
  const sumB = b.reduce((s,p)=> s + engine._readStats(p).agility, 0);
  const roll = ()=> Math.floor(Math.random()*20)+1;
  let rA = roll(), rB = roll();
  let tA = sumA + rA, tB = sumB + rB;
  let reroll=0;
  while(tA===tB && reroll<10){ rA=roll(); rB=roll(); tA=sumA+rA; tB=sumB+rB; reroll++; }
  const leadingTeam = tA>tB ? 'A' : 'B';
  battle.leadingTeam = leadingTeam;
  return {
    leadingTeam,
    teamA: { agility: sumA, roll: rA, total: tA },
    teamB: { agility: sumB, roll: rB, total: tB },
    rerollCount: reroll,
    logs: [
      { type:'initiative', message:`선공 결정: A팀 ${tA} vs B팀 ${tB}` },
      { type:'initiative', message:`${leadingTeam}팀이 선공권을 획득했습니다!` }
    ]
  };
}

export function startBattle(io, battle){
  const initiative = determineInitiative(battle);
  battle.status = 'active';
  battle.startedAt = Date.now();
  const engine = new BattleEngine(battle);

  if (broadcastManager){
    broadcastManager.broadcastBattleStart(battle, initiative);
    initiative.logs.forEach(l=> broadcastManager.broadcastSystemLog(battle.id, l));
    broadcastManager.broadcastSystemLog(battle.id, { type:'turn_start', message:`1라운드 시작. ${initiative.leadingTeam}팀부터 행동!` });
  }
  return { ok:true, initiative, battleState: engine.getBattleStats() };
}

export function canPlayerAct(battle, playerId){
  const engine = new BattleEngine(battle);
  const p = (battle.players||[]).find(x=> x.id===playerId);
  if (!p) return { canAct:false, reason:'플레이어를 찾을 수 없습니다' };
  if (p.hp<=0) return { canAct:false, reason:'쓰러진 플레이어는 행동할 수 없습니다' };
  if (battle.status!=='active') return { canAct:false, reason:'전투가 진행 중이 아닙니다' };
  const activeTeam = engine.getCurrentActiveTeam();
  if (p.team!==activeTeam) return { canAct:false, reason:`현재는 ${activeTeam}팀 턴입니다` };
  const acted = battle.turn?.acted?.[p.team];
  if (acted && acted.has?.(playerId)) return { canAct:false, reason:'이번 턴에 이미 행동했습니다' };
  return { canAct:true };
}

export function validateTarget(battle, actorId, targetId, actionType){
  const engine = new BattleEngine(battle);
  const a = (battle.players||[]).find(x=> x.id===actorId);
  const t = (battle.players||[]).find(x=> x.id===targetId);
  if (!a) return { valid:false, error:'행동 주체가 유효하지 않습니다' };
  if (!t) return { valid:false, error:'대상이 유효하지 않습니다' };
  const type = String(actionType||'').toLowerCase();
  if (type==='attack'){
    if (a.team===t.team) return { valid:false, error:'같은 팀 멤버는 공격할 수 없습니다' };
    if (t.hp<=0) return { valid:false, error:'쓰러진 대상은 공격할 수 없습니다' };
  } else if (type==='heal' || type==='dittany'){
    if (a.team!==t.team) return { valid:false, error:'적 팀 멤버는 치료할 수 없습니다' };
    if (t.hp<=0) return { valid:false, error:'쓰러진 대상은 치료할 수 없습니다' };
  }
  return { valid:true };
}

export function getRandomSpectatorComment(){
  const arr = ["멋지다!","이겨라!","살아서 돌아와!","화이팅!","죽으면 나한테 죽어!","힘내요!"];
  return arr[Math.floor(Math.random()*arr.length)];
}

function handleBattleEnd(io, battle, winner){
  battle.status = 'ended';
  battle.endedAt = Date.now();
  const endData = { type:'battle_end', winner, winnerName: winner==='A'?'불사조 기사단': winner==='B'?'죽음을 먹는 자들':'무승부' };
  if (broadcastManager){
    broadcastManager.broadcastBattleEnd(battle, endData);
    broadcastManager.broadcastSystemLog(battle.id, { type:'victory', message: winner==='draw'?'무승부!': `${endData.winnerName} 승리!` });
  }
}
