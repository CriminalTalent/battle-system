<!-- =================================================== -->


function trimChildren(el, max){
const list = el.children;
while (list.length > max) list[0].remove();
}


function render(){
// 상태 뱃지
const pill = $("#statusPill");
pill.textContent = state.status === "active" ? "전투 진행 중" : (state.status === "ended" ? "전투 종료" : "전투 대기 중");
pill.className = `status-pill ${state.status}`;


// 내 턴 표시
$("#turnHint").textContent = state.status === "active" ? (isMyTurn()? "당신의 턴" : "상대 턴") : "-";


// 로스터
const a = $("#rosterPhoenix");
const b = $("#rosterEaters");
a.innerHTML = ""; b.innerHTML = "";
for (const p of state.roster) {
const card = document.createElement("div");
card.className = "player-card";
card.innerHTML = `<div class="pc-name">${p.name}</div><div class="pc-hp">HP ${p.hp}</div>`;
(p.team === "phoenix" ? a : b).appendChild(card);
}


// 로그
const logBox = $("#battleLog");
logBox.innerHTML = "";
for (const l of state.log) {
const ln = document.createElement("div");
ln.className = `log-line log-${l.type}`;
ln.textContent = l.message;
logBox.appendChild(ln);
}
trimChildren(logBox, 150);
logBox.scrollTop = logBox.scrollHeight;


// 버튼 활성
const enable = state.status === "active" && isMyTurn();
$$(".action-btn").forEach(btn=>{ btn.disabled = !enable; });
}


// 이벤트 바인딩
window.addEventListener("DOMContentLoaded", ()=>{
connect();
$("#btnAuth").addEventListener("click", auth);
$("#btnReady").addEventListener("click", ready);
$("#btnAtk").addEventListener("click", ()=>sendAction("attack"));
$("#btnDef").addEventListener("click", ()=>sendAction("defend"));
$("#btnDodge").addEventListener("click", ()=>sendAction("dodge"));
$("#btnItemAtk").addEventListener("click", ()=>sendAction("item", { itemType:"attack_booster" }));
$("#btnItemDef").addEventListener("click", ()=>sendAction("item", { itemType:"defense_booster" }));
$("#btnItemHeal").addEventListener("click", ()=>sendAction("item", { itemType:"dittany" }));
$("#btnPass").addEventListener("click", ()=>sendAction("pass"));
$("#btnChat").addEventListener("click", chat);
});
})();
</script>
