// packages/battle-server/src/combat.js
// PYXIS Combat Resolver (ESM) - D10/자동방어·회피 제거/방어보정기 조건 반영판
//
// 변경점(요청 반영)
// - 모든 주사위 D10(1~10)
// - 공격/방어 보정기 성공률 60%
// - “피격 시 자동 방어/회피 없음” → 공격 시 회피 판정 제거, 방어는 기본 방어력만 적용
// - 방어보정기: 해당 ‘턴’에 방어(defend)했을 때만 효과 부여(그 외에는 소모만 되고 효과 없음)
//
// 규칙 요약
// - 공격치 = 공격력 + d10
// - 최종피해 = max(0, (공격치 - (방어력 + 방어태세/보정 합산)) × (치명타?2:1))
// - defend 액션: “해당 턴” 방어태세 1회 부여(가산 +2)
// - defense_boost 아이템: 성공 시 방어태세가 있는 경우 그 방어태세에 +2 추가(없으면 효과 없음; 소모는 됨)
// - attack_boost 아이템: 성공 시 그 즉시 1회 공격(공격력 ×2 + d10)
// - 아이템은 1회용(성공/실패/조건불충분과 무관하게 소모)
//
// 지원 액션: attack, defend, dodge, item, pass
//
// 호환 보강
// - 아이템 키: attack_boost/defense_boost 와 attackBooster/defenseBooster 모두 인식

/* =========================
 * 유틸
 * ========================= */
function d10() { return Math.floor(Math.random() * 10) + 1; }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function readStats(p){
  const s = p?.stats || {};
  const cv = (v, d)=> clamp(Number.isFinite(+v)? Math.floor(+v): d, 1, 5);
  return {
    attack:  cv(s.attack, 3),
    defense: cv(s.defense, 3),
    agility: cv(s.agility, 3), // 현재 회피 미사용이지만 필드 유지
    luck:    cv(s.luck,   2),
  };
}

function ensureEffects(battle) {
  if (!Array.isArray(battle.effects)) battle.effects = [];
}

/* 탐색 */
function findAny(battle, id) {
  return (battle.players || []).find(p => p && p.id === id) || null;
}
function findAlive(battle, id) {
  const p = findAny(battle, id);
  return p && p.hp > 0 ? p : null;
}
function opponentsOf(battle, actor) {
  return (battle.players || []).filter(p => p && p.team !== actor.team && p.hp > 0);
}
function findAliveOpponent(battle, actor) {
  return opponentsOf(battle, actor)[0] || null;
}

/* 방어태세(flat) 확인/소모
 * - defend 액션 시 생성되는 효과: type='defendPosture', flat=2, charges=1
 * - defense_boost 성공 시, 현재 존재하는 defendPosture.flat += 2
 * - 피격 시 1회 소모
 */
function getDefendFlatAndConsumeIfAny(battle, defenderId){
  ensureEffects(battle);
  for (const fx of battle.effects) {
    if (fx && fx.ownerId === defenderId && fx.type === 'defendPosture' && (fx.charges||0) > 0){
      const flat = Number(fx.flat || 0);
      fx.charges -= 1;
      return flat;
    }
  }
  return 0;
}
function hasDefendPosture(battle, ownerId){
  ensureEffects(battle);
  return battle.effects.some(fx => fx && fx.ownerId === ownerId && fx.type === 'defendPosture' && (fx.charges||0) > 0);
}
function addOrBoostDefendPosture(battle, ownerId, addFlat){
  ensureEffects(battle);
  const fx = battle.effects.find(e => e && e.ownerId === ownerId && e.type === 'defendPosture' && (e.charges||0) > 0);
  if (fx) {
    fx.flat = Number(fx.flat || 0) + Number(addFlat || 0);
    return true;
  }
  return false;
}

/* 아이템 키 호환 */
function normalizeItemKey(name){
  const n = String(name || '').toLowerCase().replace(/\s|-/g, '');
  if (n === 'attackboost' || n === 'attack_boost' || n === 'attackbooster') return 'attack_boost';
  if (n === 'defenseboost' || n === 'defense_boost' || n === 'defensebooster') return 'defense_boost';
  if (n === 'dittany') return 'dittany';
  return n;
}
function getItemCount(inv, snake, camel){
  return Number(inv?.[snake] || inv?.[camel] || 0);
}
function consumeItem(inv, snake, camel){
  if (!inv) return;
  if (typeof inv[snake] === 'number') inv[snake] = Math.max(0, inv[snake] - 1);
  if (typeof inv[camel] === 'number') inv[camel] = Math.max(0, inv[camel] - 1);
  if (inv[snake] === undefined && inv[camel] === undefined) inv[snake] = 0;
}

/* 치명타(D10)
 * 임계 = 10 - floor(luck/2), 공격 주사위 ≥ 임계면 치명타 */
function isCrit(luckStat, attackRoll){
  const th = 10 - Math.floor(luckStat / 2);
  return attackRoll >= th;
}

/* =========================
 * 공개 API
 * ========================= */
/**
 * @param {Object} battle - 서버 배틀 상태
 * @param {Object} action - { actorId, type, targetId?, itemType? }
 * @returns {{ logs: Array<{type:string,message:string}>, updates: {hp: Record<string,number>}, turnEnded: boolean }}
 */
export function resolveAction(battle, action) {
  const { actorId, type, targetId, itemType } = action || {};
  const logs = [];
  const updates = { hp: {} };

  const actor = findAlive(battle, actorId);
  if (!actor) {
    logs.push({ type: "system", message: "행동 주체가 유효하지 않음" });
    return { logs, updates, turnEnded: false };
  }

  const kind = String(type || "").toLowerCase();

  // 패스
  if (kind === "pass") {
    logs.push({ type: "system", message: `${actor.name} 턴을 넘김` });
    return { logs, updates, turnEnded: true };
  }

  // 방어: 해당 턴 방어태세(1회, +2)
  if (kind === "defend") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "defendPosture",
      flat: 2,             // 기본 +2
      charges: 1,          // 피격 1회에만 적용
      appliedAt: Date.now(),
      source: "action:defend"
    });
    logs.push({ type: "system", message: `${actor.name} 방어 태세 (해당 턴 1회, 방어 +2)` });
    return { logs, updates, turnEnded: true };
  }

  // 회피: 자동 회피 규칙이 삭제되었으므로 기능적 효과 없음(행동 소모만)
  if (kind === "dodge") {
    logs.push({ type: "system", message: `${actor.name} 회피 행동 (자동 회피 규칙 없음)` });
    return { logs, updates, turnEnded: true };
  }

  // 아이템(모두 1회용)
  if (kind === "item") {
    const key = normalizeItemKey(itemType);
    const inv = actor.items || (actor.items = { dittany:0, attack_boost:0, defense_boost:0, attackBooster:0, defenseBooster:0 });

    if (key === "dittany") {
      if (getItemCount(inv, 'dittany', 'dittany') <= 0) {
        logs.push({ type:"system", message:"디터니가 없습니다" });
        return { logs, updates, turnEnded:true };
      }
      consumeItem(inv, 'dittany', 'dittany');

      // 대상: 기본 자신, 아군 가능(사망자 불가)
      let target = actor;
      if (targetId) {
        const c = findAny(battle, targetId);
        if (c && c.team === actor.team && c.hp > 0) target = c;
      }
      if (target.hp <= 0) {
        logs.push({ type:"system", message:"사망자에게는 사용할 수 없습니다 (디터니 소모됨)" });
        return { logs, updates, turnEnded:true };
      }
      const maxHp = Math.max(1, Number(target.maxHp||100));
      target.hp = clamp((target.hp||0) + 10, 0, maxHp);
      updates.hp[target.id] = target.hp;

      logs.push({ type:"item", message:`${actor.name} → ${target.name} 디터니 사용 (+10 HP)` });
      return { logs, updates, turnEnded:true };
    }

    if (key === "attack_boost") {
      if (getItemCount(inv, 'attack_boost', 'attackBooster') <= 0) {
        logs.push({ type:"system", message:"공격 보정기가 없습니다" });
        return { logs, updates, turnEnded:true };
      }
      consumeItem(inv, 'attack_boost', 'attackBooster');

      if (!targetId) {
        logs.push({ type:"system", message:"공격 보정기는 적 대상이 필요합니다 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }
      const target = findAny(battle, targetId);
      if (!target || target.team === actor.team || target.hp <= 0) {
        logs.push({ type:"system", message:"올바른 적 대상을 선택하세요 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }

      // 성공 60%
      const success = Math.random() < 0.60;
      if (!success) {
        logs.push({ type:"item", message:`공격 보정기 실패 (아이템 소모됨)` });
        return { logs, updates, turnEnded:true };
      }

      // 즉시 1회 ‘보정 공격’: 공격력 ×2 + d10, 회피 판정 없음
      const as = readStats(actor);
      const ds = readStats(target);

      const atkRoll = d10();
      const attackScore = Math.floor(as.attack * 2) + atkRoll;

      // 방어태세 가산 적용(있으면) + 기본 방어력
      const defendFlat = getDefendFlatAndConsumeIfAny(battle, target.id);
      const defenseValue = ds.defense + defendFlat;

      let raw = attackScore - defenseValue;
      if (isCrit(as.luck, atkRoll)) raw *= 2;

      const dmg = Math.max(0, raw);
      const oldHp = target.hp;
      target.hp = clamp(oldHp - dmg, 0, target.maxHp||100);
      updates.hp[target.id] = target.hp;

      logs.push({
        type:"item",
        message:`공격 보정기 성공! ${actor.name} → ${target.name} ${dmg} 피해${defendFlat?` / 방어태세 +${defendFlat}`:''}`
      });
      return { logs, updates, turnEnded:true };
    }

    if (key === "defense_boost") {
      if (getItemCount(inv, 'defense_boost', 'defenseBooster') <= 0) {
        logs.push({ type:"system", message:"방어 보정기가 없습니다" });
        return { logs, updates, turnEnded:true };
      }
      consumeItem(inv, 'defense_boost', 'defenseBooster');

      // “해당 턴 방어했을 때만” 사용 가능(효과 부여)
      if (!hasDefendPosture(battle, actor.id)) {
        logs.push({ type:"item", message:"방어하지 않은 턴에는 방어 보정기를 사용할 수 없습니다 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }

      const success = Math.random() < 0.60;
      if (!success) {
        logs.push({ type:"item", message:"방어 보정기 실패 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }

      // 현재 보유한 방어태세에 +2 추가
      const ok = addOrBoostDefendPosture(battle, actor.id, 2);
      if (ok) logs.push({ type:"item", message:`방어 보정기 성공: 이번 방어태세 +2 추가` });
      else logs.push({ type:"item", message:`방어 보정기 사용 조건 불일치(내부 상태)` });
      return { logs, updates, turnEnded:true };
    }

    logs.push({ type:"system", message:"지원하지 않는 아이템" });
    return { logs, updates, turnEnded:true };
  }

  // 일반 공격(회피 없음)
  if (kind === "attack") {
    let target = null;
    if (targetId) {
      const c = findAny(battle, targetId);
      target = (c && c.hp > 0 && c.team !== actor.team) ? c : null;
    }
    if (!target) target = findAliveOpponent(battle, actor);
    if (!target) {
      logs.push({ type:"system", message:"공격 대상이 없음" });
      return { logs, updates, turnEnded:true };
    }

    const as = readStats(actor);
    const ds = readStats(target);

    const atkRoll = d10();
    const attackScore = as.attack + atkRoll;

    // 방어태세 가산 적용(있으면) + 기본 방어력
    const defendFlat = getDefendFlatAndConsumeIfAny(battle, target.id);
    const defenseValue = ds.defense + defendFlat;

    let raw = attackScore - defenseValue;
    if (isCrit(as.luck, atkRoll)) raw *= 2;

    const dmg = Math.max(0, raw);
    const oldHp = target.hp;
    target.hp = clamp(oldHp - dmg, 0, target.maxHp||100);
    updates.hp[target.id] = target.hp;

    logs.push({
      type:"battle",
      message:`${actor.name} → ${target.name} ${dmg} 피해${defendFlat?` / 방어태세 +${defendFlat}`:''}`
    });
    return { logs, updates, turnEnded:true };
  }

  // 그 외
  logs.push({ type:"system", message:"알 수 없는 행동" });
  return { logs, updates, turnEnded:false };
}

export default { resolveAction };
