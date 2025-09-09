<script type="text/plain" data-filename="packages/battle-server/public/assets/js/notifications.js">
(function(){
"use strict";


const S = { lastStatus: null };


function toast(msg, { title = "알림", tone = "info", dedupKey } = {}){
// 간단 토스트(실서비스에서는 디자인 토스트와 교체 가능)
const id = `toast-${Date.now()}`;
const el = document.createElement("div");
el.className = `toast toast-${tone}`;
el.id = id;
el.innerHTML = `<strong>${title}</strong><div class="t-msg">${msg}</div>`;
document.body.appendChild(el);
setTimeout(()=>{ el.classList.add("show"); }, 10);
setTimeout(()=>{ el.classList.remove("show"); el.remove(); }, 3000);
}


function init({ socket }){
if (!socket) return;
socket.on("battle:update", (b)=>{
const cur = b?.status || "waiting";
if (S.lastStatus !== cur) {
S.lastStatus = cur;
const tone = cur === "active" ? "ok" : (cur === "ended" ? "err" : "info");
const label = cur === "active" ? "전투 시작" : (cur === "ended" ? "전투 종료" : "대기");
toast(`상태: ${label}`, { title: "전투 상태", tone });
}
});
}


window.PyxisNotify = { init };
})();
</script>
