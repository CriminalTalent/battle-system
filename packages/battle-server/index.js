// ===============================================
// PYXIS Battle Server (all-in-one / inline fallbacks)
// ===============================================
// npm i express http socket.io multer cors uuid

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  path: '/socket.io',
  cors: { origin: true, credentials: true }
});

// -----------------------------
// 기본 미들웨어 & 경로
// -----------------------------
const ROOT = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads'), { fallthrough: true }));
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

// -----------------------------
// 폴백 HTML (정적파일이 없어도 /admin, /player, /spectator 가 떠야 함)
// 디자인은 최소 골드/네이비 톤 유지 + 소켓 연결 상태/간단 조작만 넣음.
// 실제 완성 UI 파일이 있을 경우 public/*.html 이 우선 서빙됨.
// -----------------------------
const inlineStyle = `
  <style>
  :root{--deep:#000813;--gold:#DCC7A2;--br:#D4BA8D;--text:#fff;--muted:#a9b1bb}
  *{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,var(--deep),#001122);color:var(--text);font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial}
  .wrap{max-width:1100px;margin:0 auto;padding:16px}
  .hero{font-family:Cinzel,serif;text-align:center;color:var(--gold);letter-spacing:.1em;font-size:28px;margin:10px 0 14px}
  .grid{display:grid;gap:12px;grid-template-columns:1fr 1fr 1fr}
  .card{background:rgba(0,0,0,.6);border:1px solid rgba(220,199,162,.3);border-radius:12px;padding:12px}
  .title{font-family:Cinzel,serif;color:var(--gold);font-weight:700;letter-spacing:.08em;margin-bottom:8px}
  .btn{background:linear-gradient(135deg,var(--gold),var(--br));color:#111;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}
  .row{display:flex;gap:8px;align-items:center}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cbd5e1}
  .log{height:260px;overflow:auto;background:rgba(255,255,255,.03);border:1px solid rgba(220,199,162,.15);border-radius:8px;padding:8px}
  .pill{display:inline-block;background:var(--gold);color:#111;border-radius:10px;padding:2px 8px;font-weight:700;font-size:12px}
  input,select{background:#071522;border:1px solid rgba(220,199,162,.3);color:var(--text);border-radius:8px;padding:8px;width:100%}
  .muted{color:var(--muted)}
  .hp{height:6px;background:#0b0b0b;border:1px solid rgba(220,199,162,.3);border-radius:999px;overflow:hidden}
  .hp>span{display:block;height:100%;background:linear-gradient(90deg,#4ade80,#22c55e)}
  </style>
`;

const adminInline = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PYXIS - 전투 관리자 (fallback)</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet"/>
${inlineStyle}
</head><body>
<div class="wrap">
  <div class="hero">PYXIS</div>
  <div class="grid">
    <div class="card">
      <div class="title">전투 제어</div>
      <div class="row" style="margin-bottom:8px">
        <select id="mode"><option value="1v1">1v1</option><option value="2v2" selected>2v2</option><option value="3v3">3v3</option><option value="4v4">4v4</option></select>
        <button id="create" class="btn">전투 생성</button>
      </div>
      <div style="margin-bottom:6px"><span class="muted">전투 ID</span><input id="bid" readonly placeholder="생성 후 표시"/></div>
      <div class="row">
        <button id="start" class="btn">시작</button>
        <button id="pause" class="btn">일시정지</button>
        <button id="resume" class="btn">재개</button>
        <button id="end" class="btn">종료</button>
      </div>
      <div style="margin-top:10px"><button id="gen" class="btn" style="width:100%">참가자 링크/관전자 비번 생성</button></div>
      <div style="margin-top:8px"><div class="muted">관전자 비밀번호</div><input id="sotp" readonly/></div>
      <div style="margin-top:6px"><div class="muted">관전자 URL</div><input id="surl" readonly/></div>
      <div id="plink" style="margin-top:8px" class="mono"></div>
    </div>
    <div class="card">
      <div class="title">전투 참가자 관리</div>
      <div class="row"><input id="pname" placeholder="이름"/><select id="pteam"><option value="A">A</option><option value="B">B</option></select></div>
      <div class="row" style="margin-top:6px"><input id="php" type="number" value="100" min="1" max="999"/></div>
      <div class="row" style="margin-top:6px"><input id="avatar" type="file" accept="image/*"/></div>
      <div class="row" style="margin-top:6px">
        <input id="atk" type="number" value="1" min="1" max="5" title="공격"/>
        <input id="def" type="number" value="1" min="1" max="5" title="방어"/>
        <input id="agi" type="number" value="1" min="1" max="5" title="민첩"/>
      </div>
      <div class="row" style="margin-top:6px">
        <input id="dit" type="number" value="0" min="0" max="9" title="디터니"/>
        <input id="ab" type="number" value="0" min="0" max="9" title="공격보정"/>
        <input id="db" type="number" value="0" min="0" max="9" title="방어보정"/>
      </div>
      <button id="add" class="btn" style="margin-top:8px;width:100%">전투 참가자 추가</button>
      <div class="title" style="margin-top:10px">팀 목록</div>
      <div class="row"><div style="flex:1"><b>A</b><div id="A"></div></div><div style="flex:1"><b>B</b><div id="B"></div></div></div>
    </div>
    <div class="card">
      <div class="title">실시간 로그</div>
      <div id="logs" class="log"></div>
      <div class="title" style="margin-top:10px">채팅</div>
      <div id="chat" class="log"></div>
      <div class="row" style="margin-top:6px"><input id="chatMsg" placeholder="메시지 입력.."/><button id="send" class="btn">전송</button></div>
    </div>
  </div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const ioopt={path:'/socket.io'};
const socket=io(ioopt);
let battleId=new URL(location.href).searchParams.get('battle')||'';
function esc(t){return String(t||'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function logit(s,t='info'){const el=document.createElement('div');el.innerHTML='<span class="pill">'+new Date().toLocaleTimeString('ko-KR')+'</span> '+esc(s);document.getElementById('logs').appendChild(el);document.getElementById('logs').scrollTop=1e9;}
function renderTeams(players){const A=document.getElementById('A'),B=document.getElementById('B');A.innerHTML='';B.innerHTML='';players.filter(p=>p.team==='A').forEach(p=>A.appendChild(row(p)));players.filter(p=>p.team==='B').forEach(p=>B.appendChild(row(p)));function row(p){const d=document.createElement('div');d.style='margin:6px 0;padding:6px;border:1px solid rgba(220,199,162,.2);border-radius:8px';d.innerHTML='<div>'+esc(p.name)+'</div><div class="hp"><span style="width:'+Math.max(0,Math.min(100,p.hp/(p.maxHp||100)*100))+'%"></span></div>';return d;}}
function updateBattleId(id){battleId=id;document.getElementById('bid').value=id;const u=new URL(location.href);u.searchParams.set('battle',id);history.replaceState(null,'',u.toString());socket.emit('join',{battleId:id});logit('전투 방에 참여: '+id);}
socket.on('connect',()=>logit('소켓 연결됨: '+socket.id));
socket.on('battle:update',(snap)=>{ renderTeams(snap.players||[]); });
socket.on('battle:log',(m)=>logit(m.message,m.type));
socket.on('chatMessage',(m)=>{const el=document.createElement('div');el.innerHTML='<b>'+esc(m.name)+':</b> '+esc(m.message);document.getElementById('chat').appendChild(el);document.getElementById('chat').scrollTop=1e9;});
document.getElementById('create').onclick=async()=>{const mode=document.getElementById('mode').value;const r=await fetch('/api/battles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});const j=await r.json();if(j?.id){updateBattleId(j.id);logit('전투 생성 완료: '+j.id);}else logit('전투 생성 실패','error');};
document.getElementById('start').onclick=()=>socket.emit('startBattle',{battleId},r=>logit(r?.ok?'전투 시작':'전투 시작 실패','error'));
document.getElementById('pause').onclick=()=>socket.emit('pauseBattle',{battleId},r=>logit(r?.ok?'일시정지':'일시정지 실패','error'));
document.getElementById('resume').onclick=()=>socket.emit('resumeBattle',{battleId},r=>logit(r?.ok?'재개':'재개 실패','error'));
document.getElementById('end').onclick=()=>socket.emit('endBattle',{battleId},r=>logit(r?.ok?'전투 종료':'전투 종료 실패','error'));
document.getElementById('gen').onclick=async()=>{if(!battleId) return; const base=location.origin; try{const r=await fetch('/api/admin/battles/'+battleId+'/links',{method:'POST',headers:{'Content-Type':'application/json','x-base-url':base},body:'{}'});const j=await r.json();document.getElementById('sotp').value=j?.spectator?.otp||'';document.getElementById('surl').value=j?.spectator?.url||'';const box=document.getElementById('plink');box.innerHTML='';(j.playerLinks||[]).forEach(pl=>{const d=document.createElement('div');d.className='mono';d.style.margin='6px 0';d.textContent=pl.playerName+' ['+pl.team+'] '+pl.url;box.appendChild(d);});logit('링크/비밀번호 생성 완료');}catch(e){logit('링크 생성 실패: '+e.message,'error')}}
document.getElementById('add').onclick=async()=>{if(!battleId) return; let avatarUrl=null; const file=document.getElementById('avatar').files[0]; if(file){const fd=new FormData();fd.append('avatar',file);try{const up=await fetch('/api/upload/avatar',{method:'POST',body:fd});const jd=await up.json();if(jd?.ok) avatarUrl=jd.url; logit('이미지 업로드 '+(jd?.ok?'성공: '+avatarUrl:'실패'),'error');}catch(e){logit('이미지 업로드 오류: '+e.message,'error');}}
 const payload={ battleId, player:{ name:document.getElementById('pname').value.trim()||'noname', team:document.getElementById('pteam').value, hp:+document.getElementById('php').value||100, avatar:avatarUrl, stats:{ attack:+document.getElementById('atk').value||1, defense:+document.getElementById('def').value||1, agility:+document.getElementById('agi').value||1, }, items:{ dittany:+document.getElementById('dit').value||0, attackBooster:+document.getElementById('ab').value||0, defenseBooster:+document.getElementById('db').value||0 } } };
 socket.emit('addPlayer',payload,(r)=>{logit(r?.ok?'참가자 추가 완료':'소켓(addPlayer) 실패','error')});
 try{ // REST 호환 경로(404 방지)
   const routes=['/api/admin/battles/'+battleId+'/player','/api/admin/battles/'+battleId+'/players','/api/battles/'+battleId+'/player','/api/battles/'+battleId+'/players','/admin/battles/'+battleId+'/players','/battles/'+battleId+'/players'];
   let ok=false; for(const u of routes){const rr=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload.player)}); if(rr.ok){ok=true; break;} }
   logit(ok?'HTTP(호환) 추가 성공':'참가자 추가 실패(모든 경로 시도 실패)', ok?'info':'error');
 }catch(e){logit('HTTP 실패: '+e.message,'error')}
};
document.getElementById('send').onclick=()=>{const msg=document.getElementById('chatMsg').value.trim(); if(!msg||!battleId) return; socket.emit('chatMessage',{battleId,name:'관리자',message:msg}); document.getElementById('chatMsg').value='';};
if(battleId) updateBattleId(battleId); logit('관리자 페이지 시작');
</script>
</body></html>`;

const playerInline = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PYXIS - 전투 참가자 (fallback)</title>${inlineStyle}
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
</head><body>
<div class="wrap">
  <div class="hero">PYXIS 전투 시스템</div>
  <div class="grid">
    <div class="card"><div class="title">A팀</div><div id="teamA"></div><div class="title" style="margin-top:10px">실시간 로그</div><div id="log" class="log"></div></div>
    <div class="card">
      <div class="title">내 정보</div>
      <div class="row" style="margin-bottom:6px">
        <div class="pill" id="myTeam">-</div><div id="myName" class="mono">대기중...</div>
      </div>
      <div class="row"><div class="hp" style="flex:1"><span id="myHp" style="width:100%"></span></div><div class="muted" id="myHpText">100/100</div></div>
      <div class="mono" id="myStats" style="margin-top:6px">공1 방1 민1</div>
      <button id="ready" class="btn" style="margin-top:8px;width:100%">준비 완료</button>
      <div class="title" style="margin-top:10px">현재 턴</div>
      <div id="turnInfo" class="mono muted">대기 중...</div>
      <div style="font-size:22px;color:var(--gold);margin:8px 0" id="timer">--:--</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button id="attack" class="btn">공격</button>
        <button id="defend" class="btn">방어</button>
        <button id="dodge" class="btn">회피</button>
        <button id="itemAtk" class="btn">공격보정</button>
        <button id="itemDef" class="btn">방어보정</button>
        <button id="itemHeal" class="btn">디터니</button>
        <button id="pass" class="btn">패스</button>
      </div>
      <div class="title" style="margin-top:10px">채팅</div>
      <div id="chat" class="log"></div>
      <div class="row" style="margin-top:6px"><input id="chatMsg" placeholder="메시지 입력.."/><button id="send" class="btn">전송</button></div>
    </div>
    <div class="card"><div class="title">B팀</div><div id="teamB"></div></div>
  </div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const ioopt={path:'/socket.io'}; const socket=io(ioopt);
const q=new URLSearchParams(location.search);
const battleId=q.get('battle'); const token=q.get('token');
let my=null, state=null, timer=null,lastLeft=0,lastSync=0;
function esc(t){return String(t||'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function logit(s){const el=document.createElement('div');el.innerHTML='<span class="pill">'+new Date().toLocaleTimeString('ko-KR')+'</span> '+esc(s);const box=document.getElementById('log');box.appendChild(el);box.scrollTop=1e9;}
function renderTeams(){['A','B'].forEach(T=>{const box=document.getElementById('team'+T);box.innerHTML='';(state?.players||[]).filter(p=>p.team===T).forEach(p=>{const d=document.createElement('div');d.style='margin:6px 0;padding:6px;border:1px solid rgba(220,199,162,.2);border-radius:8px';const hpPct=Math.max(0,Math.min(100,(p.hp/(p.maxHp||100))*100));d.innerHTML='<div>'+esc(p.name)+'</div><div class="hp"><span style="width:'+hpPct+'%"></span></div>';box.appendChild(d);});});}
function setMy(p){if(!p) return; my=p; document.getElementById('myName').textContent=p.name; document.getElementById('myTeam').textContent=p.team+'팀'; const hpPct=Math.max(0,Math.min(100,(p.hp/(p.maxHp||100))*100)); document.getElementById('myHp').style.width=hpPct+'%'; document.getElementById('myHpText').textContent=p.hp+'/'+p.maxHp; const s=p.stats||{}; document.getElementById('myStats').textContent='공'+(s.attack||1)+' 방'+(s.defense||1)+' 민'+(s.agility||1);}
function setTurn(){ if(!state||!state.currentTurn){document.getElementById('turnInfo').textContent='대기 중...'; document.getElementById('timer').textContent='--:--'; return;}
 const cur=state.currentTurn; const name=(cur.currentPlayer && (state.players||[]).find(x=>x.id===cur.currentPlayer.id))?.name || '대기중'; document.getElementById('turnInfo').textContent=cur.turnNumber+'라운드 - '+cur.currentTeam+'팀 ('+name+')';
 lastLeft=Math.max(0,cur.timeLeftSec||0); lastSync=Date.now(); tick(); if(timer) clearInterval(timer); timer=setInterval(tick,1000);
 function tick(){ const left=Math.max(0, lastLeft - Math.floor((Date.now()-lastSync)/1000)); const m=Math.floor(left/60), s=String(left%60).padStart(2,'0'); document.getElementById('timer').textContent=m+':'+s; }
}
socket.on('connect',()=>logit('소켓 연결됨'));
socket.emit('join',{battleId});
socket.emit('playerAuth',{battleId,token},(r)=>{ if(r?.ok){ my=r.player; setMy(my); logit(my.name+'이(가) 로그인했습니다'); } else { logit('인증 실패','error'); }});
socket.on('authSuccess',(d)=>{ my=d.player; setMy(my);});
socket.on('battle:update',(snap)=>{ state=snap; // 내 최신 상태 갱신
 const mine=(state.players||[]).find(p=>my&&p.id===my.id); if(mine) setMy(mine);
 renderTeams(); setTurn();
});
socket.on('battle:log',(m)=>logit(m.message));
socket.on('chatMessage',(m)=>{const el=document.createElement('div');el.innerHTML='<b>'+esc(m.name)+':</b> '+esc(m.message);const box=document.getElementById('chat');box.appendChild(el);box.scrollTop=1e9;});
document.getElementById('ready').onclick=()=>socket.emit('player:ready',{battleId,playerId:my?.id},()=>{ socket.emit('chatMessage',{battleId,name:my?.name||'전투 참가자',message:'[준비 완료]'}); });
function choose(type, extra){ if(!state||!my) return; const cur=state.currentTurn; if(!(cur && cur.currentTeam===my.team && cur.currentPlayer && cur.currentPlayer.id===my.id)) return;
 socket.emit('player:action',{battleId,playerId:my.id,action:Object.assign({type},extra||{})});
}
document.getElementById('attack').onclick=()=>{ // 대상 자동 선택: 적팀 생존자 중 첫번째
  const enemy=(state.players||[]).find(p=>p.team!==(my?.team)&&p.hp>0); choose('attack',{targetId:enemy?.id});
};
document.getElementById('defend').onclick=()=>choose('defend');
document.getElementById('dodge').onclick=()=>choose('dodge');
document.getElementById('itemAtk').onclick=()=>choose('item',{item:'attackBooster'});
document.getElementById('itemDef').onclick=()=>choose('item',{item:'defenseBooster'});
document.getElementById('itemHeal').onclick=()=>{ const ally=(state.players||[]).filter(p=>p.team===my.team && p.hp>0).sort((a,b)=>a.hp-b.hp)[0]; choose('item',{item:'dittany',targetId:ally?.id});};
document.getElementById('pass').onclick=()=>choose('pass');
document.getElementById('send').onclick=()=>{const msg=document.getElementById('chatMsg').value.trim(); if(!msg) return; socket.emit('chatMessage',{battleId,name:my?.name||'전투 참가자',message:msg}); document.getElementById('chatMsg').value='';};
</script>
</body></html>`;

const spectatorInline = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PYXIS - 관전자 (fallback)</title>${inlineStyle}
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
</head><body>
<div class="wrap">
  <div class="hero">PYXIS 전투 관전</div>
  <div class="grid">
    <div class="card"><div class="title">A팀</div><div id="teamA"></div><div class="title" style="margin-top:10px">실시간 로그</div><div id="log" class="log"></div></div>
    <div class="card">
      <div class="title">전투 상태</div>
      <div id="turnInfo" class="mono muted">대기 중...</div>
      <div style="font-size:22px;color:var(--gold);margin:8px 0" id="timer">--:--</div>
      <div class="title" style="margin-top:10px">응원하기</div>
      <div class="row"><input id="nick" placeholder="입력이름 : [응원]" style="flex:1"/><button id="cheer1" class="btn">멋지다!</button><button id="cheer2" class="btn">이겨라!</button></div>
    </div>
    <div class="card"><div class="title">B팀</div><div id="teamB"></div><div class="title" style="margin-top:10px">채팅</div><div id="chat" class="log"></div></div>
  </div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const ioopt={path:'/socket.io'}; const socket=io(ioopt);
const q=new URLSearchParams(location.search); const battleId=q.get('battle'); const otp=q.get('otp');
let state=null,timer=null,lastLeft=0,lastSync=0, nameTag='';
function esc(t){return String(t||'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function logit(s){const el=document.createElement('div');el.innerHTML='<span class="pill">'+new Date().toLocaleTimeString('ko-KR')+'</span> '+s;const box=document.getElementById('log');box.appendChild(el);box.scrollTop=1e9;}
function renderTeams(){['A','B'].forEach(T=>{const box=document.getElementById('team'+T);box.innerHTML='';(state?.players||[]).filter(p=>p.team===T).forEach(p=>{const d=document.createElement('div');d.style='margin:6px 0;padding:6px;border:1px solid rgba(220,199,162,.2);border-radius:8px';const hpPct=Math.max(0,Math.min(100,(p.hp/(p.maxHp||100))*100));d.innerHTML='<div>'+esc(p.name)+'</div><div class="hp"><span style="width:'+hpPct+'%"></span></div>';box.appendChild(d);});});}
function setTurn(){ if(!state||!state.currentTurn){document.getElementById('turnInfo').textContent='대기 중...'; document.getElementById('timer').textContent='--:--'; return;}
 const cur=state.currentTurn; const name=(cur.currentPlayer && (state.players||[]).find(x=>x.id===cur.currentPlayer.id))?.name || '대기중'; document.getElementById('turnInfo').textContent=cur.turnNumber+'라운드 - '+cur.currentTeam+'팀 ('+name+')';
 lastLeft=Math.max(0,cur.timeLeftSec||0); lastSync=Date.now(); tick(); if(timer) clearInterval(timer); timer=setInterval(tick,1000);
 function tick(){ const left=Math.max(0, lastLeft - Math.floor((Date.now()-lastSync)/1000)); const m=Math.floor(left/60), s=String(left%60).padStart(2,'0'); document.getElementById('timer').textContent=m+':'+s; }
}
socket.on('connect',()=>logit('소켓 연결됨'));
socket.emit('join',{battleId});
socket.on('battle:update',(snap)=>{state=snap; renderTeams(); setTurn();});
socket.on('battle:log',(m)=>logit(esc(m.message)));
socket.on('chatMessage',(m)=>{const el=document.createElement('div');el.innerHTML='<b>'+esc(m.name)+':</b> '+esc(m.message);const box=document.getElementById('chat');box.appendChild(el);box.scrollTop=1e9;});
function sendCheer(msg){const name=document.getElementById('nick').value.trim(); socket.emit('spectator:cheer',{battleId,name, message:msg});}
document.getElementById('cheer1').onclick=()=>sendCheer('멋지다!');
document.getElementById('cheer2').onclick=()=>sendCheer('이겨라!');
</script>
</body></html>`;

// 정적 파일이 있으면 그걸, 없으면 폴백 HTML을 반환
function serveOrFallback(res, file, fallbackHtml) {
  const p = path.join(PUBLIC_DIR, file);
  fs.access(p, fs.constants.R_OK, (err) => {
    if (err) return res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(fallbackHtml);
    res.sendFile(p);
  });
}
app.get('/admin', (req, res) => serveOrFallback(res, 'admin.html', adminInline));
app.get('/player', (req, res) => serveOrFallback(res, 'player.html', playerInline));
app.get('/spectator', (req, res) => serveOrFallback(res, 'spectator.html', spectatorInline));

// 헬스체크
app.get('/healthz', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// -----------------------------
// 업로드
// -----------------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.-]+/g,'_')}`)
});
const upload = multer({ storage });
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
  res.json({ ok: true, url: `/uploads/avatars/${req.file.filename}` });
});

// -----------------------------
// 메모리 상태
// -----------------------------
/*
Battle:
  id, mode, status(waiting|active|paused|ended), players[], spectatorOtp, spectatorUrl,
  currentTurn{turnNumber,currentTeam,currentPlayer{id},timeLeftSec,turnEndsAtMs},
  pending{A,B}, roundStarter, turnIdx{A,B}, _timer
*/
const battles = new Map();

// 유틸
const now = () => Date.now();
const d = (n) => Math.floor(Math.random() * n) + 1;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const otherTeam = (t) => (t === 'A' ? 'B' : 'A');
const alive = (b, t) => b.players.filter(p => p.team === t && p.hp > 0);
const toPub = (p) => ({ id:p.id,name:p.name,team:p.team,avatar:p.avatar,hp:p.hp,maxHp:p.maxHp,stats:p.stats,items:p.items });

function log(bid, type, message) { io.to(bid).emit('battle:log', { ts: now(), type, message }); }
function broadcast(bid) {
  const b = battles.get(bid); if (!b) return;
  const cur = b.currentTurn;
  io.to(bid).emit('battle:update', {
    id: b.id, status: b.status, mode: b.mode,
    players: b.players.map(toPub),
    currentTurn: cur ? {
      turnNumber: cur.turnNumber, currentTeam: cur.currentTeam,
      currentPlayer: cur.currentPlayer ? { id: cur.currentPlayer.id } : null,
      timeLeftSec: Math.max(0, Math.ceil((cur.turnEndsAtMs - now())/1000))
    } : null
  });
}
function pickNext(b, team) {
  const list = alive(b, team);
  if (list.length === 0) return null;
  const idx = b.turnIdx[team] % list.length;
  const p = list[idx];
  b.turnIdx[team] = (b.turnIdx[team] + 1) % list.length;
  return p;
}

// -----------------------------
// 규칙(최신 명세)
// - 행동: 공격/방어/회피/패스 (회피를 선택하지 않으면 자동 회피/방어 적용 금지)
// - 최종공격력 = 공격스탯*(공격보정기?2:1) + d10
// - 치명타 = d10 ≥ (10 − 민첩/2)  → 피해 2배
// - 방어 = 방어스탯*(방어보정기?2:1) + d10;  완벽 방어(피해0) 혹은 (공격-방어) 하한0
// - 회피 = (민첩 + d10) ≥ 공격자의 최종공격력 → 피해 0, 실패 시 방어 무시 정면피해
// - 보정기/디터니 성공확률 90%(실패 10%), 효과는 '사용한 턴'에만 일시 적용
// -----------------------------
function narrateAction(b, team, act) {
  if (!act) return;
  const P = id => b.players.find(p=>p.id===id) || {name:'??'};
  const me = P(act.playerId), tgt = act.targetId ? P(act.targetId) : null;
  if (team === 'A') log(b.id,'battle','=== A팀 행동 ==='); else log(b.id,'battle','=== B팀 행동 ===');
  switch (act.type) {
    case 'attack': log(b.id,'battle',`→ ${me.name}이(가) ${tgt?tgt.name:'상대'}을(를) 공격`); break;
    case 'defend': log(b.id,'battle',`→ ${me.name}이(가) 방어 태세`); break;
    case 'dodge' : log(b.id,'battle',`→ ${me.name}이(가) 회피 태세`); break;
    case 'item'  :
      if (act.item==='dittany') log(b.id,'battle',`→ ${me.name}이(가) ${tgt?tgt.name:'대상'}에게 디터니 사용`);
      if (act.item==='attackBooster') log(b.id,'battle',`→ ${me.name}이(가) 공격 보정기 사용 시도`);
      if (act.item==='defenseBooster') log(b.id,'battle',`→ ${me.name}이(가) 방어 보정기 사용 시도`);
      break;
    case 'pass'  : log(b.id,'battle',`→ ${me.name}이(가) 행동 패스`); break;
    default: log(b.id,'battle','→ 알 수 없는 행동');
  }
  if (team === 'A') log(b.id,'battle','A팀 선택 완료'); else log(b.id,'battle','B팀 선택 완료');
}

function resolveRound(b) {
  const A = b.pending.A, B = b.pending.B;

  // 행동 내레이션
  narrateAction(b,'A',A);
  narrateAction(b,'B',B);

  // 아이템 성공 판정(보정기/디터니) — 90%
  const flagItem = (act) => { if(act && act.type==='item') act._success = (d(10) !== 1); };
  flagItem(A); flagItem(B);

  // 디터니(치유) 즉시 적용
  const applyDittany = (act) => {
    if (!act || act.type!=='item' || act.item!=='dittany' || !act._success) return;
    const user = b.players.find(p=>p.id===act.playerId);
    const tgt  = b.players.find(p=>p.id===act.targetId);
    if (!user || !tgt) return;
    if (tgt.hp <= 0) { log(b.id,'battle',`→ ${user.name}의 ${tgt.name}에게 디터니 사용 실패 (사망자)`); return; }
    const heal = 10; tgt.hp = clamp(tgt.hp + heal, 0, tgt.maxHp);
    log(b.id,'battle',`→ ${user.name}이(가) ${tgt.name} 치유 (+${heal}) → HP ${tgt.hp}`);
  };
  applyDittany(A); applyDittany(B);

  // 보정기 플래그 (해당 턴만)
  if (A && A.type==='item' && A._success) { A.temp = A.temp||{}; if (A.item==='attackBooster') A.temp.attackBoost = true; if (A.item==='defenseBooster') A.temp.defenseBoost = true; }
  if (B && B.type==='item' && B._success) { B.temp = B.temp||{}; if (B.item==='attackBooster') B.temp.attackBoost = true; if (B.item==='defenseBooster') B.temp.defenseBoost = true; }

  const attackCalc = (atkAct, oppAct) => {
    if (!atkAct || atkAct.type!=='attack') return null;
    const atk = b.players.find(p=>p.id===atkAct.playerId);
    let tgt  = b.players.find(p=>p.id===atkAct.targetId);
    if (!atk) return null;
    if (!tgt || tgt.hp<=0) {
      const cands = alive(b, otherTeam(atk.team));
      if (cands.length===0) return null;
      tgt = cands[0];
    }
    const atkBoost = !!(atkAct.temp && atkAct.temp.attackBoost);
    const rollAtk = d(10);
    const finalAtk = (atk.stats.attack||0) * (atkBoost?2:1) + rollAtk;

    const critRoll = d(10);
    const critNeed = Math.max(1, Math.ceil(10 - (atk.stats.agility||0)/2));
    const isCrit = critRoll >= critNeed;

    const defType = (oppAct && oppAct.playerId===tgt.id) ? oppAct.type : null;
    if (defType === 'dodge') {
      const dodgeTotal = (tgt.stats.agility||0) + d(10);
      if (dodgeTotal >= finalAtk) return { tgt, dmg:0, txt: `${tgt.name}이(가) 회피 성공! (민첩+d10=${dodgeTotal} ≥ 공격 ${finalAtk})` };
      const dmg = isCrit ? finalAtk*2 : finalAtk;
      return { tgt, dmg, txt: `${tgt.name} 회피 실패(정면 피해) → 피해 ${dmg}` };
    }
    if (defType === 'defend') {
      const defBoost = !!(oppAct.temp && oppAct.temp.defenseBoost);
      const defVal = (tgt.stats.defense||0) * (defBoost?2:1) + d(10);
      const base = isCrit ? finalAtk*2 : finalAtk;
      const dmg = Math.max(0, base - defVal);
      return { tgt, dmg, txt: dmg===0 ? `${tgt.name} 완벽 방어! (방어 ${defVal} ≥ 공격 ${base})` : `${tgt.name} 방어 후 피해 ${dmg} (공격 ${base} - 방어 ${defVal})` };
    }
    const base = isCrit ? finalAtk*2 : finalAtk;
    return { tgt, dmg:base, txt:`${tgt.name} 수비 없음 → 피해 ${base}` };
  };

  const resA = attackCalc(A, B);
  const resB = attackCalc(B, A);

  log(b.id,'battle','=== 라운드 결과 ===');

  const applyDmg = (act, out) => {
    if (!act || act.type!=='attack' || !out) return;
    const atk = b.players.find(p=>p.id===act.playerId);
    const tgt = out.tgt;
    const before = tgt.hp;
    tgt.hp = Math.max(0, tgt.hp - out.dmg);
    if (out.dmg===0) {
      log(b.id,'battle',`→ ${atk.name}의 공격이 ${tgt.name}에게 빗나감/무효`);
    } else {
      if (tgt.hp<=0) log(b.id,'battle',`→ ${atk.name}의 강화된 치명타 공격으로 ${tgt.name} 사망! (피해 ${out.dmg})`);
      else log(b.id,'battle',`→ ${atk.name}이(가) ${tgt.name}에게 공격 (피해 ${out.dmg}) → HP ${tgt.hp}`);
    }
    log(b.id,'battle',`→ ${out.txt}`);
  };

  // 보정기 결과 텍스트(성공/실패)
  const boosterNote = (act) => {
    if (!act || act.type!=='item') return;
    if (act.item==='attackBooster' || act.item==='defenseBooster') {
      const user = b.players.find(p=>p.id===act.playerId);
      const name = act.item==='attackBooster'?'공격 보정기':'방어 보정기';
      log(b.id,'battle',`→ ${user.name}이(가) ${name} 사용 ${act._success?'성공':'실패'}`);
    }
  };
  boosterNote(A); boosterNote(B);

  applyDmg(A, resA);
  applyDmg(B, resB);

  // 승패
  const deadA = alive(b,'A').length===0;
  const deadB = alive(b,'B').length===0;
  if (deadA || deadB) {
    const winner = deadA && deadB ? '무승부' : (deadA ? 'B' : 'A');
    endBattle(b, winner);
    return;
  }

  log(b.id,'battle',`${b.currentTurn.turnNumber}라운드 종료`);
  log(b.id,'battle','5초 후 다음 라운드 시작...');

  b.currentTurn.turnNumber += 1;
  b.roundStarter = otherTeam(b.roundStarter);
  b.pending.A = null; b.pending.B = null;
  setTimeout(() => {
    log(b.id,'battle',`=== 제${b.currentTurn.turnNumber}라운드 시작 ===`);
    log(b.id,'battle',`${b.roundStarter}팀의 턴입니다`);
    b.currentTurn.currentTeam = b.roundStarter;
    b.currentTurn.currentPlayer = pickNext(b, b.roundStarter);
    b.currentTurn.turnEndsAtMs = now() + 30*1000;
    startTurnTimer(b, 30);
  }, 5000);
}

function proceedOrResolve(b) {
  const curr = b.currentTurn.currentTeam;
  const other = otherTeam(curr);
  if (!b.pending[other]) {
    if (alive(b, other).length === 0) { resolveRound(b); return; }
    // 상대 턴
    b.currentTurn.currentTeam = other;
    b.currentTurn.currentPlayer = pickNext(b, other);
    b.currentTurn.turnEndsAtMs = now() + 30*1000;
    log(b.id,'battle',`${other}팀의 턴입니다`);
    broadcast(b.id);
    return;
  }
  // 양쪽 완료 → 라운드 해석
  resolveRound(b);
}

function startTurnTimer(b, secs) {
  clearInterval(b._timer);
  b._timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((b.currentTurn.turnEndsAtMs - now())/1000));
    if (left<=0) {
      const team = b.currentTurn.currentTeam;
      if (!b.pending[team]) {
        b.pending[team] = { type:'pass', playerId: b.currentTurn.currentPlayer?.id || null };
        log(b.id,'battle',`${team}팀 시간 초과 → 패스 처리`);
      }
      proceedOrResolve(b);
    } else {
      broadcast(b.id);
    }
  }, 1000);
}

function endBattle(b, winner) {
  clearInterval(b._timer);
  b.status = 'ended';
  log(b.id,'battle',`전투 종료! 승리: ${winner}팀`);
  broadcast(b.id);
}

// -----------------------------
// REST: 전투/플레이어/링크
// -----------------------------
app.post('/api/battles', (req, res) => {
  const mode = req.body?.mode || '2v2';
  const id = `battle_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const battle = {
    id, mode, status:'waiting', createdAt: now(),
    players: [],
    spectatorOtp: null, spectatorUrl: null,
    currentTurn: null,
    pending: {A:null,B:null},
    roundStarter: 'A',
    turnIdx: {A:0,B:0},
    _timer: null
  };
  battles.set(id, battle);
  res.json({ ok:true, id });
});

function addPlayer(bid, p) {
  const b = battles.get(bid); if (!b) return { ok:false, error:'not_found' };
  const pid = uuid();
  const maxHp = Number(p.maxHp || p.hp || 100);
  const obj = {
    id: pid,
    name: p.name || 'noname',
    team: p.team==='B'?'B':'A',
    avatar: p.avatar || '/uploads/avatars/default.svg',
    hp: Number(p.hp || maxHp),
    maxHp,
    stats: {
      attack: Number(p.stats?.attack ?? p.attack ?? 1),
      defense: Number(p.stats?.defense ?? p.defense ?? 1),
      agility: Number(p.stats?.agility ?? p.agility ?? 1),
      luck: Number(p.stats?.luck ?? p.luck ?? 1)
    },
    items: {
      dittany: Number(p.items?.dittany ?? p.dittany ?? 0),
      attackBooster: Number(p.items?.attackBooster ?? p.attackBooster ?? p.attack_boost ?? 0),
      defenseBooster: Number(p.items?.defenseBooster ?? p.defenseBooster ?? p.defense_boost ?? 0)
    },
    token: uuid()
  };
  b.players.push(obj);
  return { ok:true, player: obj };
}

// 여러 호환 경로 모두 지원
['/api/admin/battles/:id/player','/api/admin/battles/:id/players','/api/battles/:id/player','/api/battles/:id/players','/admin/battles/:id/players','/battles/:id/players']
.forEach(route => {
  app.post(route, (req,res)=>{
    const bid=req.params.id;
    const r=addPlayer(bid, req.body?.player || req.body);
    if(!r.ok) return res.status(404).json(r);
    log(bid,'battle',`${r.player.name}이(가) ${r.player.team}팀으로 참가했습니다`);
    broadcast(bid);
    res.json({ ok:true, player: toPub(r.player) });
  });
});

app.delete('/api/admin/battles/:id/players/:pid', (req,res)=>{
  const b=battles.get(req.params.id); if(!b) return res.status(404).json({ok:false});
  const idx=b.players.findIndex(p=>p.id===req.params.pid); if(idx<0) return res.status(404).json({ok:false});
  const [p]=b.players.splice(idx,1);
  log(b.id,'battle',`${p.name}이(가) 전투에서 제거되었습니다`);
  broadcast(b.id);
  res.json({ok:true});
});

app.post('/api/admin/battles/:id/links', (req,res)=>{
  const b=battles.get(req.params.id); if(!b) return res.status(404).json({ok:false,error:'not_found'});
  b.spectatorOtp = b.spectatorOtp || Math.random().toString(36).slice(2,10);
  const base = req.get('x-base-url') || `${req.protocol}://${req.get('host')}`;
  b.spectatorUrl = `${base}/spectator?battle=${encodeURIComponent(b.id)}&otp=${encodeURIComponent(b.spectatorOtp)}`;
  const playerLinks = b.players.map(p=>({
    playerId:p.id, playerName:p.name, team:p.team, otp:p.token,
    url:`${base}/player?battle=${encodeURIComponent(b.id)}&token=${encodeURIComponent(p.token)}`
  }));
  res.json({ ok:true, spectator:{otp:b.spectatorOtp,url:b.spectatorUrl}, playerLinks });
});

// -----------------------------
// Socket.IO
// -----------------------------
io.on('connection', (socket)=>{
  socket.on('join', ({battleId})=>{
    if(!battleId || !battles.has(battleId)) return;
    socket.join(battleId);
    log(battleId,'system','새 연결이 입장했습니다');
    broadcast(battleId);
  });

  socket.on('startBattle', ({battleId}, cb)=>{
    const b=battles.get(battleId); if(!b) return cb?.({ok:false});
    if(b.status==='active'){ cb?.({ok:true}); return; }
    const aRoll=d(6)+d(6), bRoll=d(6)+d(6);
    log(b.id,'battle',`선공 결정: A팀(${aRoll}) vs B팀(${bRoll})`);
    b.roundStarter = aRoll>=bRoll ? 'A' : 'B';
    log(b.id,'battle',`${b.roundStarter}팀이 선공입니다!`);
    b.status='active';
    b.currentTurn = { turnNumber:1,currentTeam:b.roundStarter,currentPlayer:null,timeLeftSec:30,turnEndsAtMs: now()+30000 };
    b.pending.A=null; b.pending.B=null;
    const first=pickNext(b,b.roundStarter);
    b.currentTurn.currentPlayer = first?{id:first.id}:null;
    log(b.id,'battle','전투가 시작되었습니다!');
    startTurnTimer(b,30); broadcast(b.id);
    cb?.({ok:true});
  });

  socket.on('pauseBattle', ({battleId}, cb)=>{
    const b=battles.get(battleId); if(!b||b.status!=='active') return cb?.({ok:false});
    b.status='paused'; clearInterval(b._timer); log(b.id,'battle','전투 일시정지'); broadcast(b.id); cb?.({ok:true});
  });
  socket.on('resumeBattle', ({battleId}, cb)=>{
    const b=battles.get(battleId); if(!b||b.status!=='paused') return cb?.({ok:false});
    b.status='active'; log(b.id,'battle','전투 재개'); startTurnTimer(b, Math.max(5,Math.ceil((b.currentTurn.turnEndsAtMs-now())/1000))); cb?.({ok:true});
  });
  socket.on('endBattle', ({battleId}, cb)=>{
    const b=battles.get(battleId); if(!b) return cb?.({ok:false});
    const aliveA=alive(b,'A').length, aliveB=alive(b,'B').length;
    const winner = aliveA===aliveB?'무승부':(aliveA>aliveB?'A':'B'); endBattle(b,winner); cb?.({ok:true});
  });

  socket.on('addPlayer', ({battleId,player}, cb)=>{
    const r=addPlayer(battleId,player); if(!r.ok) return cb?.({ok:false,error:r.error});
    log(battleId,'battle',`${r.player.name}이(가) ${r.player.team}팀으로 참가했습니다`);
    broadcast(battleId); cb?.({ok:true,player:toPub(r.player)});
  });

  socket.on('deletePlayer', ({battleId,playerId}, cb)=>{
    const b=battles.get(battleId); if(!b) return cb?.({ok:false});
    const i=b.players.findIndex(p=>p.id===playerId); if(i<0) return cb?.({ok:false});
    const [p]=b.players.splice(i,1); log(battleId,'battle',`${p.name}이(가) 전투에서 제거되었습니다`); broadcast(battleId); cb?.({ok:true});
  });

  socket.on('playerAuth', ({battleId,token}, cb)=>{
    const b=battles.get(battleId); if(!b) return cb?.({ok:false});
    const p=b.players.find(x=>x.token===token); if(!p) return cb?.({ok:false,error:'bad_token'});
    cb?.({ok:true,player:toPub(p)}); // 프론트 호환
    socket.emit('authSuccess',{player:toPub(p)});
  });

  socket.on('player:ready', ({battleId,playerId}, cb)=>{
    const b=battles.get(battleId); if(!b) return cb?.({ok:false});
    const p=b.players.find(x=>x.id===playerId); if(p) log(b.id,'battle',`${p.name}이(가) 준비 완료했습니다`);
    cb?.({ok:true});
  });

  socket.on('chatMessage', ({battleId,name,message})=>{
    io.to(battleId).emit('chatMessage',{name: name||'익명', message, timestamp: now()});
  });

  socket.on('spectator:cheer', ({battleId,name,message})=>{
    io.to(battleId).emit('chatMessage',{name: name?('[응원] '+name):'[응원]', message, timestamp: now(), type:'cheer'});
  });

  // 플레이어 액션
  socket.on('player:action', ({battleId,playerId,action}, cb)=>{
    const b=battles.get(battleId);
    if(!b || b.status!=='active' || !b.currentTurn) return cb?.({ok:false,error:'bad_state'});
    const p=b.players.find(x=>x.id===playerId); if(!p || p.hp<=0) return cb?.({ok:false,error:'no_player'});
    if(b.currentTurn.currentTeam!==p.team || b.currentTurn.currentPlayer?.id!==p.id) return cb?.({ok:false,error:'not_your_turn'});

    b.pending[p.team] = { type:action.type, playerId:p.id, targetId:action.targetId||null, item:action.item||null, temp:{} };

    // 아이템은 시도 즉시 수량 차감
    if(action.type==='item'){
      if(action.item==='dittany' && p.items.dittany>0) p.items.dittany--;
      if(action.item==='attackBooster' && p.items.attackBooster>0) p.items.attackBooster--;
      if(action.item==='defenseBooster' && p.items.defenseBooster>0) p.items.defenseBooster--;
    }

    cb?.({ok:true}); io.to(b.id).emit('player:action:success');
    proceedOrResolve(b);
  });
});

// -----------------------------
// 에러 핸들러
// -----------------------------
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok:false, error:'internal' });
});
process.on('unhandledRejection', e=>console.error('[UNHANDLED REJECTION]', e));
process.on('uncaughtException', e=>console.error('[UNCAUGHT EXCEPTION]', e));

// -----------------------------
// 부트
// -----------------------------
server.listen(PORT, () => {
  console.log(`PYXIS battle-server listening on http://localhost:${PORT}`);
});
