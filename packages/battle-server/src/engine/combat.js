<!-- =========================================== -->
return { logs, updates, turnEnded:true };
}


if (kind === "item") {
const target = action.targetId ? findAny(battle, action.targetId) : actor;
const key = normalizeItemKey(action.itemType);
if (!target) return { logs:[{type:"system", message:"대상이 유효하지 않음"}], updates, turnEnded:true };
if (key === "dittany" && target.hp <= 0) return { logs:[{type:"system", message:"사망자에게는 회복 불가"}], updates, turnEnded:true };
const { logs: ls, updates: up } = applyItemEffect(battle, { actor, target, itemType: key });
ls.forEach(l=>logs.push(l));
Object.assign(updates.hp, up.hp||{});
return { logs, updates, turnEnded:true };
}


if (kind === "attack") {
const target = findAliveOpponent(battle, actor);
if (!target) return { logs:[{ type:"system", message:"공격 대상이 없음" }], updates, turnEnded:false };


const atkScore = computeAttackScore(actor, battle);


let evasionBonus = 0;
if (hasDodgePrep(battle, target)) { evasionBonus = 4; consumeDodge(battle, target); }


const hit = computeHit({ attacker: actor, defender: target, evasionBonus });


if (!hit) {
logs.push({ type:"battle", message:`${actor.name}의 공격이 빗나감` });
return { logs, updates, turnEnded:true };
}


const defMul = applyDefenseBoostFactor(battle, target);
const { dmg, crit } = computeDamage({ attacker: actor, defender: target, attackScore: atkScore, defenseMultiplier: defMul });


updates.hp[target.id] = Math.max(0, (target.hp || 0) - dmg);


logs.push({ type:"battle", message: crit ? `${actor.name}의 치명타 적중! ${target.name}에게 ${dmg} 피해` : `${actor.name}가 ${target.name}에게 ${dmg} 피해` });


consumeAttackMultiplier(battle, actor);
consumeDefenseMultiplierOnHit(battle, target);


return { logs, updates, turnEnded:true };
}


return { logs:[{type:"system", message:"알 수 없는 행동"}], updates, turnEnded:false };
}
</script>
