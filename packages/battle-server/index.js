<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Pyxis 전투 시스템 - 관리자 콘솔</title>
<style>
:root {
  --deep-navy: #0a0f1a;
  --navy: #0f1419;
  --navy-light: #1a1f26;
  --gold: #E5C88A;
  --gold-light: #F5E6B8;
  --gold-dark: #C8A882;
  --accent: #2a3441;
  --text-primary: #F5E6B8;
  --text-secondary: #D4C39A;
  --border: rgba(229, 200, 138, 0.3);
  --border-light: rgba(229, 200, 138, 0.15);
  --shadow: rgba(229, 200, 138, 0.2);
  --glass: rgba(15, 20, 25, 0.85);
  --glass-dark: rgba(10, 15, 26, 0.9);
  --timer-warning: #e74c3c;
  --timer-critical: #c0392b;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{
  background:linear-gradient(135deg,var(--deep-navy) 0%,var(--navy) 50%,var(--navy-light) 100%);
  color:var(--text-primary);font-family:'Cinzel','Times New Roman',serif;min-height:100vh;overflow-x:hidden;position:relative;font-size:16px}
body::before{content:'';position:fixed;top:0;left:0;width:100%;height:100%;background:
radial-gradient(circle at 20% 20%,rgba(229,200,138,.05) 0%,transparent 50%),
radial-gradient(circle at 80% 80%,rgba(229,200,138,.05) 0%,transparent 50%),
radial-gradient(circle at 40% 60%,rgba(229,200,138,.03) 0%,transparent 50%);pointer-events:none;z-index:-1}
.main-container{max-width:1400px;margin:0 auto;padding:15px;display:flex;flex-direction:column;gap:15px}
.header{background:var(--glass-dark);border:2px solid var(--border);border-radius:16px;padding:20px 25px;text-align:center;backdrop-filter:blur(20px);box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(229,200,138,.1)}
.header h1{font-size:clamp(1.8rem,4vw,2.5rem);color:var(--gold);text-shadow:0 0 20px rgba(229,200,138,.5);letter-spacing:2px;margin-bottom:8px}
.header .subtitle{font-size:1.1rem;color:var(--text-secondary);font-style:italic}
.card{background:var(--glass);border:1px solid var(--border-light);border-radius:12px;padding:20px;backdrop-filter:blur(10px);box-shadow:0 4px 20px rgba(0,0,0,.2);transition:.3s}
.card:hover{border-color:var(--border);box-shadow:0 6px 25px rgba(0,0,0,.3)}
.card-title{font-size:1.4rem;color:var(--gold);margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:12px}
.card-title::before{content:'';width:4px;height:20px;background:linear-gradient(to bottom,var(--gold),var(--gold-dark));border-radius:2px}
.form-grid{display:grid;gap:16px}
.form-grid.cols-2{grid-template-columns:1fr 1fr}
.form-grid.cols-3{grid-template-columns:1fr 1fr 1fr}
.form-grid.cols-4{grid-template-columns:repeat(4,1fr)}
.form-grid.cols-5{grid-template-columns:repeat(5,1fr)}
.form-group{display:flex;flex-direction:column;gap:6px}
.form-label{font-size:.9rem;color:var(--gold);font-weight:600}
.form-input,.form-select{background:rgba(10,15,26,.8);border:1px solid var(--border-light);border-radius:8px;padding:12px 16px;color:var(--text-primary);font-size:.95rem;transition:.3s;min-height:45px}
.form-input:focus,.form-select:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 2px rgba(229,200,138,.2)}
.btn{background:linear-gradient(135deg,var(--gold-dark),var(--gold));border:1px solid var(--gold);border-radius:8px;padding:12px 20px;color:var(--deep-navy);font-weight:600;cursor:pointer;transition:.3s;text-transform:uppercase;letter-spacing:.5px;font-size:.9rem;min-height:45px;display:flex;align-items:center;justify-content:center}
.btn:hover,.btn:active{background:linear-gradient(135deg,var(--gold),var(--gold-light));transform:translateY(-1px);box-shadow:0 4px 15px rgba(229,200,138,.3)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-secondary{background:linear-gradient(135deg,var(--accent),var(--navy-light));border-color:var(--accent);color:var(--text-primary)}
.btn-secondary:hover,.btn-secondary:active{background:linear-gradient(135deg,var(--navy-light),var(--accent))}
.btn-danger{background:linear-gradient(135deg,#8b2635,#c1392f);border-color:#c1392f;color:#fff}
.btn-danger:hover,.btn-danger:active{background:linear-gradient(135deg,#c1392f,#e74c3c)}
.pill{display:inline-block;background:rgba(229,200,138,.15);border:1px solid var(--border-light);border-radius:20px;padding:6px 14px;font-size:.85rem;color:var(--gold)}
.code-display{background:rgba(10,15,26,.9);border:1px solid var(--border-light);border-radius:6px;padding:8px 12px;font-family:'Monaco','Consolas',monospace;font-size:.8rem;color:var(--gold-light);cursor:pointer;transition:.3s;word-break:break-all}
.code-display:hover{background:rgba(10,15,26,1);border-color:var(--gold)}
.team-builder{display:grid;grid-template-columns:1fr;gap:20px}
.team-panel{background:var(--glass-dark);border:2px solid var(--border);border-radius:12px;padding:20px}
.team-panel.team-phoenix{border-color:var(--gold);box-shadow:0 0 20px rgba(229,200,138,.1)}
.team-panel.team-death{border-color:var(--gold-dark);box-shadow:0 0 20px rgba(200,168,130,.1)}
.team-header{text-align:center;font-size:1.2rem;margin-bottom:16px;padding:12px;border-radius:8px;font-weight:600}
.team-phoenix .team-header{background:linear-gradient(135deg,rgba(229,200,138,.2),rgba(229,200,138,.1));color:var(--gold)}
.team-death .team-header{background:linear-gradient(135deg,rgba(200,168,130,.2),rgba(200,168,130,.1));color:var(--gold-dark)}
.player-list{display:grid;grid-template-columns:1fr;gap:12px;margin-top:16px}
.player-card{background:rgba(10,15,26,.6);border:1px solid var(--border-light);border-radius:8px;padding:12px;transition:.3s}
.player-card:hover{border-color:var(--gold);transform:translateY(-2px)}
.player-name{font-weight:600;color:var(--gold);margin-bottom:8px}
.player-status{font-size:.8rem;color:var(--text-secondary);margin-bottom:8px}
.health-bar{background:rgba(10,15,26,.8);border-radius:10px;height:8px;overflow:hidden;margin-bottom:8px}
.health-fill{height:100%;background:linear-gradient(90deg,var(--gold-light),var(--gold),var(--gold-dark));transition:width .5s}
.player-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:.75rem}
.stat-item{text-align:center;padding:2px}
.battle-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.status-display{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.timer-display{font-size:1.1rem;font-weight:bold;padding:8px 16px;border-radius:8px;background:rgba(42,52,65,.8);border:2px solid var(--gold);color:var(--gold)}
.timer-display.warning{border-color:var(--timer-warning);color:var(--timer-warning);background:rgba(231,76,60,.2)}
.timer-display.critical{border-color:var(--timer-critical);color:var(--timer-critical);background:rgba(192,57,43,.3);animation:pulse 1s infinite}
.logs-section{display:grid;grid-template-columns:1fr;gap:20px}
.log-panel{background:rgba(10,15,26,.8);border:1px solid var(--border-light);border-radius:8px;padding:16px;height:300px;overflow-y:auto}
.log-panel::-webkit-scrollbar{width:8px}
.log-panel::-webkit-scrollbar-track{background:rgba(10,15,26,.5)}
.log-panel::-webkit-scrollbar-thumb{background:var(--gold);border-radius:4px}
.chat-area{background:var(--glass);border:1px solid var(--border-light);border-radius:12px;padding:20px}
.chat-messages{background:rgba(10,15,26,.8);border:1px solid var(--border-light);border-radius:8px;padding:16px;height:350px;overflow-y:auto;margin-bottom:16px;font-size:.9rem;line-height:1.5}
.chat-messages::-webkit-scrollbar{width:8px}
.chat-messages::-webkit-scrollbar-track{background:transparent}
.chat-messages::-webkit-scrollbar-thumb{background:var(--accent);border-radius:4px}
.chat-input-area{display:flex;gap:12px}
.chat-input{flex:1;min-height:50px}
.error-notifications{position:fixed;bottom:20px;right:20px;z-index:1000;max-width:400px}
.error-alert{background:linear-gradient(135deg,#c0392b,#e74c3c);border:1px solid #e74c3c;border-radius:8px;padding:12px 16px;margin-bottom:8px;color:#fff;box-shadow:0 4px 15px rgba(231,76,60,.3);animation:slideIn .3s ease;font-size:.9rem}
.success-alert{background:linear-gradient(135deg,#27ae60,#2ecc71);border:1px solid #2ecc71;border-radius:8px;padding:12px 16px;margin-bottom:8px;color:#fff;box-shadow:0 4px 15px rgba(46,204,113,.3);animation:slideIn .3s ease;font-size:.9rem}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.success-state{color:var(--gold);background:rgba(229,200,138,.1)}
.loading{opacity:.7;pointer-events:none}
.otp-section{background:linear-gradient(135deg,rgba(229,200,138,.1),rgba(200,168,130,.1));border:1px solid var(--gold);border-radius:12px;padding:20px}
.url-display{margin-top:16px}
.url-item{display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.url-label{min-width:120px;font-weight:600;color:var(--gold)}
/* 반응형 */
@media (max-width:768px){
  .main-container{padding:10px}
  .form-grid.cols-2,.form-grid.cols-3,.form-grid.cols-4,.form-grid.cols-5{grid-template-columns:1fr}
  .team-builder{grid-template-columns:1fr}
  .logs-section{grid-template-columns:1fr}
  .battle-controls{flex-direction:column;align-items:stretch}
  .battle-controls>*{width:100%}
  .url-item{flex-direction:column;align-items:stretch;gap:8px}
  .url-label{min-width:auto}
  .player-list{grid-template-columns:1fr}
  .chat-messages{height:300px}
  .header h1{font-size:1.8rem}
  .card{padding:15px}
}
@media (min-width:769px) and (max-width:1024px){
  .team-builder{grid-template-columns:1fr 1fr}
  .logs-section{grid-template-columns:1fr 1fr}
  .player-list{grid-template-columns:1fr}
}
@media (min-width:1025px){
  .main-container{padding:24px}
  .team-builder{grid-template-columns:1fr 1fr}
  .logs-section{grid-template-columns:1fr 1fr}
  .player-list{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
  .chat-messages{height:400px}
}
@media (hover:none) and (pointer:coarse){
  .btn:hover{transform:none;box-shadow:none}
  .btn:active{transform:scale(.98)}
  .form-input,.form-select{min-height:50px;font-size:16px}
}
</style>
<script src="/socket.io/socket.io.js"></script>
</head>
<body>
<div class="main-container">
  <header class="header">
    <h1>Pyxis 전투 시스템</h1>
    <div class="subtitle">관리자 콘솔</div>
  </header>

  <!-- 전투 구성 -->
  <section class="card">
    <div class="card-title">전투 구성</div>
    <div class="form-grid cols-3">
      <div class="form-group">
        <label class="form-label">전투 ID</label>
        <input id="battleId" class="form-input" placeholder="전투 ID">
      </div>
      <div class="form-group">
        <label class="form-label">전투 모드</label>
        <select id="mode" class="form-select">
          <option>1v1</option><option>2v2</option><option>3v3</option><option>4v4</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">동작</label>
        <div class="form-grid cols-3">
          <button class="btn" id="btnCreate">전투 생성</button>
          <button class="btn btn-secondary" id="btnLinks">링크 생성</button>
          <button class="btn btn-secondary" id="btnFetch">상태 갱신</button>
        </div>
      </div>
    </div>
    <div class="url-display">
      <div class="url-item"><span class="url-label">관리자 URL:</span><code id="adminUrl" class="code-display">-</code></div>
      <div class="url-item"><span class="url-label">플레이어 URL:</span><code id="playerUrl" class="code-display">-</code></div>
      <div class="url-item"><span class="url-label">관전자 URL:</span><code id="spectUrl" class="code-display">-</code></div>
    </div>
  </section>

  <!-- OTP -->
  <section class="card otp-section">
    <div class="card-title">인증 및 접근 제어</div>
    <div class="form-grid cols-2">
      <div>
        <div class="form-grid cols-4" style="margin-bottom:16px;">
          <button id="btnIssueAdmin" class="btn btn-secondary">관리자 OTP</button>
          <span class="pill" id="adminOtp">-</span>
          <input id="adminOtpInput" class="form-input" placeholder="관리자 OTP 입력">
          <button class="btn" id="btnAdminLogin">관리자 로그인</button>
        </div>
        <div class="pill" id="adminLoginState">인증되지 않음</div>
      </div>
      <div>
        <div class="form-grid cols-3" style="margin-bottom:16px;">
          <input id="playerNameForOtp" class="form-input" placeholder="플레이어 이름">
          <button id="btnIssuePlayer" class="btn btn-secondary">플레이어 OTP</button>
          <span class="pill" id="playerOtp">-</span>
        </div>
        <div class="form-grid cols-2">
          <button id="btnIssueSpect" class="btn btn-secondary">관전자 OTP</button>
          <span class="pill" id="spectOtp">-</span>
        </div>
      </div>
    </div>
  </section>

  <!-- 전투 관리 -->
  <section class="card">
    <div class="card-title">전투 관리</div>
    <div class="battle-controls">
      <button class="btn" id="btnStart">전투 시작</button>
      <select id="winnerSel" class="form-select" style="min-width:200px;">
        <option value="">승자: 자동 (HP 합계)</option>
        <option value="team1">불사조 기사단 승리</option>
        <option value="team2">죽음을 먹는 자들 승리</option>
        <option value="draw">무승부</option>
      </select>
      <button id="btnForceEnd" class="btn btn-danger">강제 종료</button>
      <button id="btnDelete" class="btn btn-danger">전투 삭제</button>
    </div>
  </section>

  <!-- 팀 구성 -->
  <section class="card">
    <div class="card-title">팀 구성</div>
    <div class="team-builder">
      <!-- 불사조 기사단 -->
      <div class="team-panel team-phoenix">
        <div class="team-header">불사조 기사단</div>
        <div class="form-grid cols-2" style="margin-bottom:16px;">
          <input id="t1_name" class="form-input" placeholder="캐릭터 이름">
          <input type="file" id="t1_img" accept="image/*" class="form-input">
        </div>
        <div class="form-grid cols-5" style="margin-bottom:16px;">
          <div class="form-group"><label class="form-label">체력</label><input type="number" id="t1_hp" class="form-input" min="1" max="100" value="100"></div>
          <div class="form-group"><label class="form-label">공격</label><input type="number" id="t1_atk" class="form-input" min="1" max="5" value="3"></div>
          <div class="form-group"><label class="form-label">방어</label><input type="number" id="t1_def" class="form-input" min="1" max="5" value="3"></div>
          <div class="form-group"><label class="form-label">민첩</label><input type="number" id="t1_agi" class="form-input" min="1" max="5" value="3"></div>
          <div class="form-group"><label class="form-label">행운</label><input type="number" id="t1_luk" class="form-input" min="1" max="5" value="3"></div>
        </div>
        <!-- 아이템 수량 -->
        <div class="form-grid cols-5" style="margin-bottom:16px;">
          <div class="form-group"><label class="form-label">공격 보정기</label><input type="number" id="t1_item_atk" class="form-input" min="0" value="0"></div>
          <div class="form-group"><label class="form-label">방어 보정기</label><input type="number" id="t1_item_def" class="form-input" min="0" value="0"></div>
          <div class="form-group"><label class="form-label">디터니</label><input type="number" id="t1_item_det" class="form-input" min="0" value="0"></div>
          <div class="form-group"><label class="form-label">기타(쉼표)</label><input id="t1_items_extra" class="form-input" placeholder="기타 아이템,쉼표로"></div>
          <div class="form-group"><label class="form-label">추가</label><button id="btnAddT1" class="btn">팀에 추가</button></div>
        </div>
        <div id="t1_list" class="player-list"></div>
      </div>

      <!-- 죽음을 먹는 자들 -->
      <div class="team-panel team-death">
        <div class="team-header">죽음을 먹는 자들</div>
        <div class="form-grid cols-2" style="margin-bottom:16px;">
          <input id="t2_name" class="form-input" placeholder="캐릭터 이름">
          <input type="file" id="t2_img" accept="image/*" class="form-input">
        </div>
        <div class="form-grid cols-5" style="margin-bottom:16px;">
          <div class="form-group"><label class="form-label">체력</label><input type="number" id="t2_hp" class="form-input" min="1" max="100" value="100"></div>
          <div class="form-group"><label class="form-label">공격</label><input type="number" id="t2_atk" class="form-input" min="1" max="5" value="3"></div>
          <div class="form-group"><label class="form-label">방어</label><input type="number" id="t2_def" class="form-input" min="1" max="5" value="3"></div>
          <div class="form-group"><label class="form-label">민첩</label><input type="number" id="t2_agi" class="form-input" min="1" max="5" value="3"></div>
          <div class="form-group"><label class="form-label">행운</label><input type="number" id="t2_luk" class="form-input" min="1" max="5" value="3"></div>
        </div>
        <!-- 아이템 수량 -->
        <div class="form-grid cols-5" style="margin-bottom:16px;">
          <div class="form-group"><label class="form-label">공격 보정기</label><input type="number" id="t2_item_atk" class="form-input" min="0" value="0"></div>
          <div class="form-group"><label class="form-label">방어 보정기</label><input type="number" id="t2_item_def" class="form-input" min="0" value="0"></div>
          <div class="form-group"><label class="form-label">디터니</label><input type="number" id="t2_item_det" class="form-input" min="0" value="0"></div>
          <div class="form-group"><label class="form-label">기타(쉼표)</label><input id="t2_items_extra" class="form-input" placeholder="기타 아이템,쉼표로"></div>
          <div class="form-group"><label class="form-label">추가</label><button id="btnAddT2" class="btn">팀에 추가</button></div>
        </div>
        <div id="t2_list" class="player-list"></div>
      </div>
    </div>
  </section>

  <!-- 전투 상태/채팅 -->
  <section class="card">
    <div class="card-title">전투 상태 및 커뮤니케이션</div>
    <div class="status-display" style="margin-bottom:20px;"><div id="state" class="status-display"></div></div>
    <div class="logs-section">
      <div><label class="form-label" style="margin-bottom:8px;">전투 로그</label><div id="log" class="log-panel"></div></div>
      <div>
        <label class="form-label" style="margin-bottom:8px;">실시간 채팅</label>
        <div id="chatLog" class="chat-messages"></div>
        <div class="chat-input-area">
          <input id="chatInput" class="chat-input form-input" placeholder="관리자 메시지 (최대 200자)" maxlength="200">
          <button id="chatSend" class="btn">전송</button>
        </div>
      </div>
    </div>
  </section>
</div>

<div id="errorLog" class="error-notifications"></div>

<script>
window.addEventListener('DOMContentLoaded', () => {
  const $ = s => document.querySelector(s);
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  const qs = new URLSearchParams(location.search);
  const ioSock = io({ path:'/socket.io', timeout:10000, transports:['websocket','polling'] });

  let BATTLE = qs.get('battle') || '';
  $('#battleId').value = BATTLE;
  let TOK = { admin: qs.get('token') || '' };
  let lastStateUpdate = 0;
  let retryCount = 0;

  function showError(msg){const d=document.createElement('div');d.className='error-alert';d.textContent=msg;$('#errorLog').appendChild(d);setTimeout(()=>{if(d.parentNode){d.style.opacity='0';d.style.transform='translateY(20px)';setTimeout(()=>d.remove(),300)}},5000);console.error(msg)}
  function showSuccess(msg){const d=document.createElement('div');d.className='success-alert';d.textContent=msg;$('#errorLog').appendChild(d);setTimeout(()=>{if(d.parentNode){d.style.opacity='0';d.style.transform='translateY(20px)';setTimeout(()=>d.remove(),300)}},3000)}

  async function api(url,{method='GET',json,body}={}){try{const h={};if(url.startsWith('/api/admin')&&TOK.admin)h['x-admin-token']=TOK.admin;if(json)h['Content-Type']='application/json';const r=await fetch(url,{method,headers:h,body});if(!r.ok){const t=await r.text();let m;try{m=(JSON.parse(t)).error||`HTTP ${r.status}`}catch{m=t||`HTTP ${r.status}`}throw new Error(m)}const txt=await r.text();try{return JSON.parse(txt)}catch{return txt}}catch(e){showError(`API 오류: ${e.message}`);throw e}}

  // ===== 렌더러 =====
  const renderTeam=(list,el)=>{el.innerHTML='';(list||[]).forEach(p=>{const d=document.createElement('div');d.className='player-card';const hp=p.maxHp?Math.round((p.hp/p.maxHp)*100):0;d.innerHTML=`
      <div class="player-name">${p.name}</div>
      <div class="player-status">${p.alive?'활성':'전사'}</div>
      <div class="health-bar"><div class="health-fill" style="width:${hp}%"></div></div>
      <div class="player-stats">
        <div class="stat-item">공격 ${p.stats?.attack ?? '-'}</div>
        <div class="stat-item">방어 ${p.stats?.defense ?? '-'}</div>
        <div class="stat-item">민첩 ${p.stats?.agility ?? '-'}</div>
        <div class="stat-item">행운 ${p.stats?.luck ?? '-'}</div>
      </div>`;el.appendChild(d)})};

  const renderLog=(log,el)=>{const entries=(log||[]).slice(-25);el.innerHTML=entries.map(e=>`<div style="padding:6px 0;border-bottom:1px solid rgba(229,200,138,.1);font-size:.85rem;line-height:1.4;">
      <strong style="color:var(--gold);">${e.type}</strong> - <span style="color:var(--text-primary);">${e.result||''}</span>
      <br><small style="color:var(--text-secondary);">${new Date(e.timestamp).toLocaleTimeString()}</small></div>`).join('');el.scrollTop=el.scrollHeight};

  function appendChatMessage(m){
    const el = $('#chatLog');
    const time = new Date(m.timestamp || Date.now()).toLocaleTimeString();
    const senderColor = m.senderType==='system' ? '#E5C88A' :
                        m.senderType==='admin' ? '#C8A882' :
                        m.senderType==='spectator' ? '#F5E6B8' : '#D4C39A';
    const div = document.createElement('div');
    div.style.cssText = "padding:6px 0;border-bottom:1px dashed rgba(229,200,138,0.1);line-height:1.4;";
    div.innerHTML = `<span style="color:${senderColor};font-weight:600;font-size:.8rem;">[${time}] ${m.sender}:</span>
                     <span style="color:#F5E6B8;margin-left:6px;font-size:.85rem;">${m.message || m.text || ''}</span>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  const renderChat=(chat,el)=>{el.innerHTML='';(chat||[]).slice(-30).forEach(appendChatMessage)};

  const draw=s=>{
    const phaseText={lobby:'대기실',battle:'전투 중',ended:'종료'};
    const teamText={team1:'불사조 기사단 턴',team2:'죽음을 먹는 자들 턴'};
    let html=`<span class="pill">ID: ${s.id}</span><span class="pill">모드: ${s.mode}</span><span class="pill">단계: ${phaseText[s.phase]||s.phase}</span><span class="pill">현재: ${teamText[s.currentTeam]||'-'}</span>`;
    if(s.remainingTurnTime && s.phase==='battle'){const rem=Math.max(0,s.remainingTurnTime);const m=Math.floor(rem/60000);const sc=Math.floor((rem%60000)/1000);let cls='timer-display';if(rem<30000)cls+=' critical';else if(rem<60000)cls+=' warning';html+=`<div class="${cls}">${m}:${sc.toString().padStart(2,'0')}</div>`}
    html+=`<span class="pill">승자: ${s.winner==='team1'?'불사조 기사단':s.winner==='team2'?'죽음을 먹는 자들':s.winner==='draw'?'무승부':'미정'}</span>`;
    $('#state').innerHTML=html;
    renderTeam(s.teams.team1,$('#t1_list')); renderTeam(s.teams.team2,$('#t2_list'));
    renderLog(s.battleLog,$('#log')); renderChat(s.chatLog,$('#chatLog'));
    lastStateUpdate=Date.now();
  };

  const refresh=async()=>{if(!BATTLE)return;try{const s=await api(`/api/battles/${BATTLE}`);draw(s);retryCount=0}catch(err){retryCount++;if(retryCount<3)setTimeout(refresh,2000*retryCount)}};

  // ===== 소켓 =====
  ioSock.on('connect',()=>{if(BATTLE) ioSock.emit('join-battle',{battleId:BATTLE,role:'admin'});showSuccess('실시간 연결 성공')});
  ioSock.on('disconnect',()=>showError('실시간 연결이 끊어졌습니다'));
  ioSock.on('reconnect',()=>{showSuccess('실시간 연결 재연결됨');if(BATTLE) ioSock.emit('join-battle',{battleId:BATTLE,role:'admin'})});
  ['battle-state','player-joined','battle-started','action-executed','battle-ended'].forEach(ev=>ioSock.on(ev,({state})=>{if(state) draw(state)}));
  // 채팅 즉시 반영
  ioSock.on('chat-message',({message})=>{ if(message) appendChatMessage(message) });

  // ===== 버튼/행동 =====
  on('#btnCreate','click',async()=>{try{const j=await api('/api/battles',{method:'POST',json:true,body:JSON.stringify({mode:$('#mode').value})});BATTLE=j.battleId;$('#battleId').value=BATTLE;history.replaceState(null,'',`/admin?token=${TOK.admin||''}&battle=${BATTLE}`);showSuccess('전투 생성 완료');await refresh()}catch(e){}});
  on('#btnLinks','click',async()=>{if(!BATTLE)return showError('전투 ID가 필요합니다');try{const j=await api(`/api/admin/battles/${BATTLE}/links`,{method:'POST'});TOK=j.tokens||TOK;$('#adminUrl').textContent=location.origin+`/admin?token=${TOK.admin}&battle=${BATTLE}`;$('#playerUrl').textContent=location.origin+`/play?token=${TOK.player}&battle=${BATTLE}`;$('#spectUrl').textContent=location.origin+`/watch?token=${TOK.spectator}&battle=${BATTLE}`;showSuccess('링크 생성 완료')}catch(e){}});
  on('#btnFetch','click',refresh);
  on('#btnIssueAdmin','click',async()=>{if(!BATTLE)return showError('전투 ID가 필요합니다');try{const j=await api(`/api/admin/battles/${BATTLE}/issue-otp`,{method:'POST',json:true,body:JSON.stringify({role:'admin'})});$('#adminOtp').textContent=j.otp||'-';showSuccess('관리자 OTP 발급 완료')}catch(e){}});
  on('#btnAdminLogin','click',async()=>{const otp=$('#adminOtpInput').value.trim();if(!otp||!BATTLE)return showError('OTP와 전투 ID가 필요합니다');try{await api('/api/auth/login',{method:'POST',json:true,body:JSON.stringify({battleId:BATTLE,role:'admin',otp,token:TOK.admin||''})});$('#adminLoginState').textContent='인증됨';$('#adminLoginState').className='pill success-state';showSuccess('관리자 로그인 성공')}catch(e){}});
  on('#btnIssuePlayer','click',async()=>{const name=$('#playerNameForOtp').value.trim();if(!name||!BATTLE)return showError('플레이어 이름과 전투 ID가 필요합니다');try{const j=await api(`/api/admin/battles/${BATTLE}/issue-otp`,{method:'POST',json:true,body:JSON.stringify({role:'player',name})});$('#playerOtp').textContent=j.otp||'-';showSuccess(`플레이어 OTP 발급 완료: ${name}`)}catch(e){}});
  on('#btnIssueSpect','click',async()=>{if(!BATTLE)return showError('전투 ID가 필요합니다');try{const j=await api(`/api/admin/battles/${BATTLE}/issue-otp`,{method:'POST',json:true,body:JSON.stringify({role:'spectator'})});$('#spectOtp').textContent=j.otp||'-';showSuccess('관전자 OTP 발급 완료 (다중 사용 가능)')}catch(e){}});

  const upload=async(el)=>{const f=el.files?.[0];if(!f)return null;if(f.size>10*1024*1024)throw new Error('이미지 최대 10MB');const fd=new FormData();fd.append('image',f);const r=await fetch('/api/upload',{method:'POST',body:fd});if(!r.ok)throw new Error(await r.text());return (await r.json()).url};

  function buildItems(pre){
    const rep=(id,label)=>Array.from({length:Math.max(0,parseInt($(pre+id).value||'0',10))},()=>label);
    const extra=($(pre+'items_extra').value||'').split(',').map(s=>s.trim()).filter(Boolean);
    return [...rep('item_atk','공격 보정기'), ...rep('item_def','방어 보정기'), ...rep('item_det','디터니'), ...extra];
  }

  async function add(team){
    if(!BATTLE)return showError('전투 ID가 필요합니다');
    try{
      const pre = team==='team1' ? '#t1_' : '#t2_';
      const name = $(pre+'name').value.trim();
      if(!name) return showError('이름이 필요합니다');
      const stats={attack:+$(pre+'atk').value, defense:+$(pre+'def').value, agility:+$(pre+'agi').value, luck:+$(pre+'luk').value};
      const customHp=+$(pre+'hp').value;
      const items = buildItems(pre);
      let imageUrl=null; try{imageUrl=await upload($(pre+'img'))}catch(e){if(e&&e.message)showError(`이미지 업로드 실패: ${e.message}`)}
      const body={playerId:'p_'+Math.random().toString(36).slice(2,8),playerName:name,teamId:team,stats,imageUrl,items,customHp};
      const r=await api(`/api/admin/battles/${BATTLE}/join`,{method:'POST',json:true,body:JSON.stringify(body)});
      if(!r.success) return showError(r.error||'추가 실패');
      // reset
      $(pre+'name').value=''; $(pre+'img').value=''; $(pre+'hp').value='100';
      $(pre+'item_atk').value='0'; $(pre+'item_def').value='0'; $(pre+'item_det').value='0'; $(pre+'items_extra').value='';
      showSuccess(`${name} 추가 완료`); await refresh();
    }catch(e){}
  }
  on('#btnAddT1','click',()=>add('team1'));
  on('#btnAddT2','click',()=>add('team2'));

  on('#btnStart','click',async()=>{if(!BATTLE)return showError('전투 ID가 필요합니다');try{const r=await api(`/api/battles/${BATTLE}/start`,{method:'POST',json:true,body:'{}'});if(!r.success)showError(r.error||'시작 실패');else showSuccess('전투 시작!')}catch(e){}});
  on('#btnForceEnd','click',async()=>{if(!BATTLE)return showError('전투 ID가 필요합니다');if(!confirm('정말로 전투를 강제 종료하시겠습니까?'))return;try{const w=$('#winnerSel').value||undefined;await api(`/api/admin/battles/${BATTLE}/force-end`,{method:'POST',json:true,body:JSON.stringify({winner:w})});showSuccess('전투 강제 종료됨')}catch(e){}});
  on('#btnDelete','click',async()=>{if(!BATTLE)return showError('전투 ID가 필요합니다');if(!confirm('정말로 이 전투를 삭제하시겠습니까?'))return;try{await api(`/api/admin/battles/${BATTLE}`,{method:'DELETE'});showSuccess('전투 삭제됨');setTimeout(()=>location.href='/admin',1000)}catch(e){}});

  // URL 복사
  ['adminUrl','playerUrl','spectUrl'].forEach(id=>on('#'+id,'click',async()=>{const t=$('#'+id).textContent;if(t&&t!=='-'){try{await navigator.clipboard.writeText(t);const el=$('#'+id);const bg=el.style.background;el.style.background='rgba(46,204,113,.3)';showSuccess('클립보드에 복사됨');setTimeout(()=>el.style.background=bg,1000)}catch(e){showError('클립보드 복사 실패')}}}));

  // 채팅: 즉시 반영 + 송신
  on('#chatSend','click',()=>{const message=$('#chatInput').value.trim();if(!message||!BATTLE)return; if(message.length>200){showError('메시지는 200자 이하여야 합니다');return;}
    const localMsg={battleId:BATTLE,sender:'Administrator',message, senderType:'admin', timestamp:Date.now()};
    appendChatMessage(localMsg); // 즉시 반영
    ioSock.emit('send-chat', localMsg); // 서버로 송신
    $('#chatInput').value='';
  });
  on('#chatInput','keypress',e=>{if(e.key==='Enter')$('#chatSend').click()});

  // 자동 새로고침 보조
  setInterval(()=>{if(BATTLE && (Date.now()-lastStateUpdate>30000)) refresh()},15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && BATTLE) refresh()});
  setInterval(()=>{if(!ioSock.connected && BATTLE) ioSock.connect()},20000);

  if(BATTLE) refresh();
});
</script>
</body>
</html>
