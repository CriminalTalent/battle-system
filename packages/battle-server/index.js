<!-- =============================== -->
// 수명주기
// ───────────────────────────────────
function startBattle(battle) {
if (!battle) return;
battle.status = "active";
battle.startedAt = now();


const sumA = battle.players.filter(p => p.team === "phoenix").reduce((s,p)=>s+(p.stats?.agi||0),0);
const sumB = battle.players.filter(p => p.team === "eaters").reduce((s,p)=>s+(p.stats?.agi||0),0);
battle.firstTeamKey = sumA >= sumB ? "phoenix" : "eaters";
battle.current = battle.firstTeamKey;
battle.turn = 1;
battle.turnEndsAt = now() + (battle.turnMs || 5*60*1000);


pushLog(battle, { type: "system", message: `전투 시작 (선공: ${battle.firstTeamKey === "phoenix" ? "불사조" : "죽먹자"})` });
broadcastState(battle);
}


function endBattle(battle) {
if (!battle) return;
battle.status = "ended";
battle.endedAt = now();
const w = winnerByHpSum(battle);
pushLog(battle, { type: "result", message: `전투 종료: ${w || "무승부"}` });
broadcastState(battle);
}


function pushLog(battle, entry) {
battle.log.push({ ...entry, ts: now() });
if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
}


function appendEngineResult(battle, result){
for (const l of (result.logs||[])) battle.log.push({ ...l, ts: now() });
if (battle.log.length > 500) battle.log.splice(0, battle.log.length - 500);
const hpUpd = result.updates?.hp || {};
battle.players.forEach(p => { if (hpUpd[p.id] != null) p.hp = Math.max(0, hpUpd[p.id]); });
}


function broadcastState(battle){
const payload = {
id: battle.id,
status: battle.status,
turn: battle.turn,
current: battle.current,
startedAt: battle.startedAt,
endedAt: battle.endedAt,
turnEndsAt: battle.turnEndsAt,
players: battle.players.map(p=>({ id:p.id, name:p.name, team:p.team, hp:p.hp, ready:!!p.ready, avatarUrl:p.avatarUrl, stats:p.stats })),
log: battle.log.slice(-200)
};
io.to(`admin:${battle.id}`).emit("battle:update", payload);
io.to(`player:${battle.id}`).emit("battle:update", payload);
io.to(`spectator:${battle.id}`).emit("battle:update", payload);
}


// 서버 시작
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
console.log(`[PYXIS] Server listening on ${HOST}:${PORT}`);
});
</script>
