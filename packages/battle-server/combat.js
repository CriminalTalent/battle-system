// packages/battle-server/src/combat.js
// PYXIS Combat Resolver (ESM) - 수정판
// - 규칙 요약
//   • 공격치 = 공격력 + d20
//   • 회피: 수비측 (민첩 + d20) ≥ 공격치 ⇒ 0 피해
//   • 방어: "곱하기" 없음. 최종피해 = max(0, (공격치 - 방어력(+보정)) × (치명타?2:1))
//   • 아이템은 전부 1회용(사용 시 수량 즉시 -1, 성공 여부와 무관)
//     - 디터니: +10 HP, 대상은 본인 또는 아군, 사망자 회복 불가
//     - 공격 보정기: 10% 성공 시 그 ‘행동’에 한해 공격력 ×2로 계산해 즉시 공격
//     - 방어 보정기: 10% 성공 시 “다음 피격 1회” 방어력 +2(가산, 곱연산 아님)
//
// - 지원 액션: attack, defend, dodge, item, pass

/* =========================
 * 유틸
 * ========================= */
function d20() { return Math.floor(Math.random() * 20) + 1; }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function readStats(p){
  const s = p?.stats || {};
  const cv = (v, d)=> clamp(Number.isFinite(+v)? Math.floor(+v): d, 1, 5);
  return {
    attack:  cv(s.attack, 3),
    defense: cv(s.defense, 3),
    agility: cv(s.agility, 3),
    luck:    cv(s.luck,   2),
  };
}

/* effects 보장 */
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
function alliesOf(battle, actor) {
  return (battle.players || []).filter(p => p && p.team === actor.team && p.hp > 0 && p.id !== actor.id);
}

/* 방어 보정(가산) 확인/소모: +2 가산 1회 */
function getDefenseFlatAndConsumeIfHit(battle, defenderId){
  ensureEffects(battle);
  let flat = 0;
  for(const fx of battle.effects){
    if (fx && fx.ownerId === defenderId && fx.type === 'defenseBoost' && (fx.charges||0) > 0){
      flat += (fx.flat ?? 2);
      fx.charges -= 1;
      break; // 1개만 가정
    }
  }
  battle.effects = battle.effects.filter(e => (e?.charges || 0) > 0);
  return flat;
}

/* =========================
 * 공개 API
 * ========================= */
/**
 * 액션 해석기
 * @param {Object} battle - 서버 배틀 상태
 * @param {Object} action - { actorId, type, targetId?, itemType? }
 * @returns {Object} - { logs:[], updates:{hp:{}}, turnEnded:boolean }
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

  // 방어: ‘다음 피격 1회’ +2 가산 효과 부여
  if (kind === "defend") {
    ensureEffects(battle);
    battle.effects.push({
      ownerId: actor.id,
      type: "defenseBoost", // 의미: 다음 피격 1회 방어력 +2(가산)
      flat: 2,
      charges: 1,
      appliedAt: Date.now(),
      source: "action:defend"
    });
    logs.push({ type: "system", message: `${actor.name} 방어 태세 (다음 피격 시 방어력 +2)` });
    return { logs, updates, turnEnded: true };
  }

  // 회피: 별도 버프 없이 기본 규칙으로 회피 판정
  if (kind === "dodge") {
    logs.push({ type: "system", message: `${actor.name} 회피 자세` });
    return { logs, updates, turnEnded: true };
  }

  // 아이템(모두 1회용: 사용 시 즉시 차감)
  if (kind === "item") {
    const key = String(itemType || '').toLowerCase();

    // 보유 체크
    const inv = actor.items || (actor.items = { dittany:0, attack_boost:0, defense_boost:0 });
    const have = (k)=> Number(inv[k] || 0) > 0;

    // 사용(성공/실패와 무관하게 즉시 -1)
    const consume = (k)=> { inv[k] = Math.max(0, Number(inv[k]||0) - 1); };

    if (key === "dittany") {
      if (!have("dittany")) {
        logs.push({ type:"system", message:"디터니가 없습니다" });
        return { logs, updates, turnEnded:true };
      }
      consume("dittany");

      // 대상: 기본은 자신, 아군 지정 가능
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

      logs.push({ type:"item", message:`${actor.name} → ${target.name}에게 디터니 사용 (+10 HP)` });
      return { logs, updates, turnEnded:true };
    }

    if (key === "attack_boost") {
      if (!have("attack_boost")) {
        logs.push({ type:"system", message:"공격 보정기가 없습니다" });
        return { logs, updates, turnEnded:true };
      }
      consume("attack_boost");

      if (!targetId) {
        logs.push({ type:"system", message:"공격 보정기는 적 대상이 필요합니다 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }
      const target = findAny(battle, targetId);
      if (!target || target.team === actor.team || target.hp <= 0) {
        logs.push({ type:"system", message:"올바른 적 대상을 선택하세요 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }

      // 10% 성공 판정
      const success = Math.random() < 0.10;
      if (!success) {
        logs.push({ type:"item", message:`공격 보정기 실패 (아이템 소모됨)` });
        return { logs, updates, turnEnded:true };
      }

      // 즉시 ‘보정 공격’ 1회 실행: 공격력 ×2
      const as = readStats(actor);
      const ds = readStats(target);

      const atkRoll = d20();
      const attackScore = Math.floor(as.attack * 2) + atkRoll; // ×2는 공격력에만 적용
      const evadeRoll = d20();
      const evadeScore = ds.agility + evadeRoll;

      if (evadeScore >= attackScore) {
        logs.push({ type:"battle", message:`보정 공격 회피됨: ${target.name} 회피 성공` });
        return { logs, updates, turnEnded:true };
      }

      const crit = (() => {
        const th = 20 - Math.floor(as.luck/2);
        return atkRoll >= th;
      })();

      // 수비측 방어 보정(가산) 적용 & 1회 소비
      const defFlat = getDefenseFlatAndConsumeIfHit(battle, target.id);
      const defenseValue = ds.defense + defFlat;
      let raw = attackScore - defenseValue;
      if (crit) raw *= 2;

      const dmg = Math.max(0, raw);
      const oldHp = target.hp;
      target.hp = clamp(oldHp - dmg, 0, target.maxHp||100);
      updates.hp[target.id] = target.hp;

      logs.push({
        type:"item",
        message:`공격 보정기 성공! ${actor.name} → ${target.name} ${dmg} 피해${crit?' (치명타)':''}${defFlat? ' / 방어 +'+defFlat:''}`
      });
      return { logs, updates, turnEnded:true };
    }

    if (key === "defense_boost") {
      if (!have("defense_boost")) {
        logs.push({ type:"system", message:"방어 보정기가 없습니다" });
        return { logs, updates, turnEnded:true };
      }
      consume("defense_boost");

      const success = Math.random() < 0.10;
      if (!success) {
        logs.push({ type:"item", message:"방어 보정기 실패 (아이템 소모됨)" });
        return { logs, updates, turnEnded:true };
      }

      ensureEffects(battle);
      battle.effects.push({
        ownerId: actor.id,
        type: "defenseBoost",  // 의미: 다음 피격 1회 방어력 +2 가산
        flat: 2,
        charges: 1,
        appliedAt: Date.now(),
        source: "item:defense_boost"
      });
      logs.push({ type:"item", message:`방어 보정기 성공: ${actor.name} 다음 피격 시 방어력 +2` });
      return { logs, updates, turnEnded:true };
    }

    // 알 수 없는 아이템
    logs.push({ type:"system", message:"지원하지 않는 아이템" });
    return { logs, updates, turnEnded:true };
  }

  // 일반 공격
  if (kind === "attack") {
    // 대상 결정
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

    const atkRoll = d20();
    const attackScore = as.attack + atkRoll;

    const evadeRoll = d20();
    const evadeScore = ds.agility + evadeRoll;

    if (evadeScore >= attackScore) {
      logs.push({ type:"battle", message:`${target.name}이(가) ${actor.name}의 공격을 회피!` });
      return { logs, updates, turnEnded:true };
    }

    const crit = (() => {
      const th = 20 - Math.floor(as.luck/2);
      return atkRoll >= th;
    })();

    // 수비측 방어 보정(가산) 적용 & 1회 소비
    const defFlat = getDefenseFlatAndConsumeIfHit(battle, target.id);
    const defenseValue = ds.defense + defFlat;

    let raw = attackScore - defenseValue;
    if (crit) raw *= 2;

    const dmg = Math.max(0, raw);
    const oldHp = target.hp;
    target.hp = clamp(oldHp - dmg, 0, target.maxHp||100);
    updates.hp[target.id] = target.hp;

    logs.push({
      type:"battle",
      message:`${actor.name} → ${target.name} ${dmg} 피해${crit?' (치명타)':''}${defFlat? ' / 방어 +'+defFlat:''}`
    });
    return { logs, updates, turnEnded:true };
  }

  // 그 외
  logs.push({ type:"system", message:"알 수 없는 행동" });
  return { logs, updates, turnEnded:false };
}

export default { resolveAction };
