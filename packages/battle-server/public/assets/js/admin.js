<script type="text/plain" data-filename="packages/battle-server/public/assets/js/admin.js">
line.className = "tl-line";
const t = document.createElement("span"); t.className = "tl-time"; t.textContent = `[${new Date().toLocaleTimeString()}]`;
const tag = document.createElement("span"); tag.className = `tl-tag tl-${type}`; tag.textContent = type === "sys" ? "시스템" : (type === "admin" ? "관리" : "채팅");
const body = document.createElement("span"); body.className = "tl-msg"; body.textContent = (name && type === "chat") ? `${name}: ${msg}` : msg;
line.appendChild(t); line.appendChild(tag); line.appendChild(body);
this.timeline.appendChild(line);
const lines = this.timeline.querySelectorAll('.tl-line');
if (lines.length > 200) {
for (let i=0;i<lines.length-200;i++) lines[i].remove();
}
}
};


const state = { socket:null, battleId:null, token:null };


function connect(){
const socket = window.io ? window.io(undefined, { transports:["websocket"], withCredentials:true }) : null;
state.socket = socket; bind();
}


function bind(){
const s = state.socket; if (!s) return;
s.on("connect", ()=>{});


s.on("auth:success", (p)=>{
if (p.role!=="admin") return; state.battleId=p.battleId; $("#authView").classList.add("hidden"); $("#mainView").classList.remove("hidden");
});


s.on("authError", (e)=>{ alert("인증 실패: "+(e?.error||"")); });


s.on("battle:update", (b)=>{
renderStatus(b.status);
renderRoster(b.players||[]);
renderLogs(b.log||[]);
});


s.on("battle:chat", ({ name, message })=> UI.append("chat", message, name));
s.on("battle:log", ({ type, message })=> UI.append(type==="system"?"sys":"chat", message));
}


function adminAuth(){
const params = new URLSearchParams(location.search);
const battleId = params.get("battle") || $("#authBattle").value.trim();
const token = params.get("token") || $("#authToken").value.trim();
if (!battleId || !token) { alert("battle, token 입력"); return; }
state.socket.emit("adminAuth", { battleId, token });
}


function startBattle(){ if (state.battleId) fetch(`/api/battles/${state.battleId}/start`, { method:"POST" }); }


function renderStatus(st){
const el = $("#statusPill");
el.textContent = st === "active" ? "전투 진행 중" : (st === "ended" ? "전투 종료" : "전투 대기 중");
el.className = `status-pill ${st}`;
}


function renderRoster(players){
const a = $("#rosterPhoenix"); const b = $("#rosterEaters");
a.innerHTML = ""; b.innerHTML = "";
players.forEach(p=>{
const card = document.createElement("div");
card.className = "player-card";
card.innerHTML = `<div class="pc-name">${p.name}</div><div class="pc-hp">HP ${p.hp}</div>`;
(p.team === "phoenix" ? a : b).appendChild(card);
});
}


function renderLogs(list){
UI.timeline.innerHTML = "";
list.forEach(l=>{
const line = document.createElement("div");
line.className = "tl-line";
line.textContent = l.message;
UI.timeline.appendChild(line);
});
const lines = UI.timeline.querySelectorAll('.tl-line');
if (lines.length > 200) {
for (let i=0;i<lines.length-200;i++) lines[i].remove();
}
}


window.addEventListener("DOMContentLoaded", ()=>{
UI.init();
connect();
$("#btnAuth").addEventListener("click", adminAuth);
$("#btnStart").addEventListener("click", startBattle);
});
})();
</script>
