<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>PYXIS Admin – All-in-One</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <!-- =========================
       PYXIS Enhanced Unified Theme
       ========================= -->
  <style>
  /* PYXIS Enhanced Unified Theme - 우아하고 고급스러운 디자인 */
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800;900&display=swap');

  :root{
    /* 핵심 컬러 팔레트 - 짙은 네이비 + 골드 */
    --deep-navy:#0a0f1a; 
    --midnight:#0f1419; 
    --navy-mist:#141a24;
    --navy-light:#1e252f;
    --navy-surface:#252c38;

    /* 골드 그라데이션 시스템 */
    --gold:#d4b77e; 
    --gold-dark:#c9a96e; 
    --gold-light:#dcc7a2;
    --gold-bright:#e6d3aa; 
    --gold-shimmer:#f0e4c5;
    --gold-subtle:#e2d0a8;

    /* 텍스트 색상 */
    --text:#f8f6f0; 
    --text-dim:#e0d5c4; 
    --text-muted:#b8a898;
    --text-accent:var(--gold-bright);

    /* 글래스모피즘 효과 */
    --glass-subtle:rgba(212,183,126,.03);
    --glass-light:rgba(212,183,126,.05);
    --glass-1:rgba(212,183,126,.08);
    --glass-2:rgba(212,183,126,.12);
    --glass-3:rgba(212,183,126,.18);
    --glass-4:rgba(212,183,126,.24);

    /* 테두리 시스템 */
    --border-subtle:rgba(212,183,126,.06);
    --border-light:rgba(212,183,126,.12);
    --border-1:rgba(212,183,126,.18);
    --border-2:rgba(212,183,126,.32);
    --border-bright:rgba(212,183,126,.48);
    --border-gold:rgba(212,183,126,.65);

    /* 그림자 시스템 */
    --shadow-subtle:0 2px 8px rgba(0,0,0,.1);
    --shadow-soft:0 4px 12px rgba(0,0,0,.15);
    --shadow-medium:0 8px 24px rgba(0,0,0,.2);
    --shadow-deep:0 12px 36px rgba(0,0,0,.3);
    --shadow-inset:inset 0 1px 0 rgba(255,255,255,.03);
    --shadow-glow:0 0 20px rgba(212,183,126,.15);

    /* 블러 효과 */
    --blur-subtle:blur(4px);
    --blur-light:blur(8px);
    --blur-medium:blur(12px);
    --blur-strong:blur(16px);

    /* 기하학적 요소 */
    --radius:14px;
    --radius-small:8px;
    --radius-large:18px;
    --radius-xl:24px;
    
    /* 폰트 시스템 */
    --serif:'Cinzel', 'Playfair Display', 'Times New Roman', serif;
    --sans:'Inter', system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", Arial, sans-serif;
    
    /* 상태 색상 */
    --success:#27ae60;
    --success-light:rgba(39,174,96,.15);
    --warning:#f39c12;
    --warning-light:rgba(243,156,18,.15);
    --danger:#e74c3c;
    --danger-light:rgba(231,76,60,.15);
    --info:#3498db;
    --info-light:rgba(52,152,219,.15);

    /* 애니메이션 타이밍 */
    --ease-smooth:cubic-bezier(.4,0,.2,1);
    --ease-bounce:cubic-bezier(.68,-0.55,.265,1.55);
    --transition-fast:.2s var(--ease-smooth);
    --transition-normal:.3s var(--ease-smooth);
    --transition-slow:.4s var(--ease-smooth);
  }

  /* 기본 설정 및 리셋 */
  *{ 
    box-sizing:border-box; 
    -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;
  }

  html,body{ 
    height:100%; 
    margin:0; 
    overflow-x:hidden; 
  }

  body{
    color:var(--text); 
    font-family:var(--sans);
    font-weight:400;
    line-height:1.6;
    background:
      radial-gradient(circle at 15% -10%, rgba(212,183,126,.12) 0%, transparent 50%),
      radial-gradient(circle at 85% 110%, rgba(212,183,126,.08) 0%, transparent 50%),
      radial-gradient(circle at 45% 30%, rgba(212,183,126,.05) 0%, transparent 60%),
      linear-gradient(145deg, var(--deep-navy) 0%, var(--midnight) 35%, var(--navy-mist) 70%, var(--navy-light) 100%);
    background-attachment:fixed;
    background-size:100% 100%, 120% 120%, 80% 80%, 100% 100%;
    position:relative;
  }

  body::before{
    content:'';
    position:fixed;
    top:0; left:0; right:0; bottom:0;
    background:
      radial-gradient(circle at 20% 80%, rgba(212,183,126,.03) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(212,183,126,.02) 0%, transparent 50%);
    pointer-events:none;
    z-index:-1;
  }

  /* 레이아웃 시스템 */
  .container{ 
    max-width:1400px; 
    margin:0 auto; 
    padding:20px; 
  }

  .wrap{ 
    max-width:1280px; 
    margin:0 auto; 
  }

  .row{ 
    display:grid; 
    grid-template-columns:1fr 1fr; 
    gap:18px; 
    align-items:start;
  }

  @media (max-width:1000px){ 
    .row{ 
      grid-template-columns:1fr; 
    } 
  }

  .grid{ 
    display:grid; 
    gap:16px; 
  }

  .hidden{ 
    display:none !important; 
  }

  /* 헤더 및 브랜딩 */
  .hero{ 
    position:relative; 
    text-align:center; 
    padding:48px 20px 20px; 
    overflow:hidden; 
  }

  .hero::before{
    content:''; 
    position:absolute; 
    inset:-60% -25% auto -25%; 
    height:500px;
    background:conic-gradient(
      from 0deg at 50% 50%, 
      rgba(212,183,126,.18) 0deg, 
      rgba(212,183,126,.08) 45deg,
      rgba(212,183,126,.22) 90deg, 
      rgba(212,183,126,.05) 135deg,
      rgba(212,183,126,.18) 180deg, 
      rgba(212,183,126,.08) 225deg,
      rgba(212,183,126,.22) 270deg, 
      rgba(212,183,126,.05) 315deg,
      rgba(212,183,126,.18) 360deg
    );
    filter:blur(80px); 
    animation:celestialRotate 60s linear infinite; 
    opacity:.7; 
    pointer-events:none; 
    z-index:-1;
  }

  @keyframes celestialRotate{ 
    0%{transform:rotate(0deg) scale(1)} 
    25%{transform:rotate(90deg) scale(1.05)} 
    50%{transform:rotate(180deg) scale(.95)} 
    75%{transform:rotate(270deg) scale(1.08)} 
    100%{transform:rotate(360deg) scale(1)} 
  }

  .hero-title,
  .admin-brand{
    font-family:var(--serif); 
    font-weight:800; 
    font-size:clamp(32px, 5vw, 48px);
    letter-spacing:.08em;
    background:linear-gradient(
      135deg,
      var(--gold-bright) 0%,
      var(--gold-shimmer) 25%,
      var(--gold) 50%,
      var(--gold-light) 75%,
      var(--gold-bright) 100%
    );
    background-size:300% 300%; 
    -webkit-background-clip:text; 
    background-clip:text; 
    -webkit-text-fill-color:transparent;
    display:inline-block; 
    position:relative; 
    animation:brandShimmer 4s ease-in-out infinite;
    text-shadow:0 4px 20px rgba(212,183,126,.3);
  }

  @keyframes brandShimmer{ 
    0%,100%{
      background-position:0% 50%; 
      filter:brightness(1);
      transform:scale(1);
    } 
    50%{
      background-position:100% 50%; 
      filter:brightness(1.2);
      transform:scale(1.02);
    } 
  }

  /* 카드 및 패널 시스템 */
  .card,
  .panel{
    background:linear-gradient(
      145deg, 
      rgba(15,20,25,.92) 0%, 
      rgba(20,26,36,.88) 25%,
      rgba(25,31,42,.92) 50%,
      rgba(20,26,36,.88) 75%,
      rgba(15,20,25,.92) 100%
    );
    border:1px solid var(--border-1); 
    border-radius:var(--radius); 
    padding:24px;
    backdrop-filter:var(--blur-medium) saturate(130%); 
    box-shadow:var(--shadow-medium), var(--shadow-inset), var(--shadow-glow);
    position:relative; 
    overflow:hidden; 
    transition:all var(--transition-normal);
  }
  .card:hover{ 
    transform:translateY(-3px); 
    border-color:var(--border-2); 
    box-shadow:var(--shadow-deep), var(--shadow-inset), 0 0 30px rgba(212,183,126,.2); 
  }

  /* 섹션 헤더/타이틀 */
  .section-title{
    font-family:var(--serif); 
    font-weight:700; 
    color:var(--gold-bright);
    font-size:20px;
    position:relative;
    padding-left:20px;
    letter-spacing:.02em;
    margin:0 0 16px;
  }
  .section-title::before{
    content:'';
    position:absolute;
    left:0; top:50%; transform:translateY(-50%);
    width:6px; height:75%;
    background:linear-gradient(to bottom, var(--gold-bright), var(--gold-dark));
    border-radius:3px;
    box-shadow:0 0 12px rgba(212,183,126,.4);
  }

  /* 버튼 시스템 */
  .btn{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    padding:10px 16px;
    border:2px solid var(--border-1);
    border-radius:10px;
    background:linear-gradient(145deg, rgba(30,37,47,.9), rgba(20,26,36,.9));
    color:var(--text);
    font-family:var(--sans);
    font-size:14px;
    font-weight:700;
    text-decoration:none;
    cursor:pointer;
    transition:all var(--transition-normal);
    position:relative;
    overflow:hidden;
    backdrop-filter:var(--blur-light);
    box-shadow:var(--shadow-soft);
  }
  .btn:hover:not(:disabled){
    transform:translateY(-2px);
    border-color:var(--gold);
    box-shadow:var(--shadow-medium), 0 0 20px rgba(212,183,126,.3);
    color:var(--gold-bright);
  }
  .btn:disabled{ opacity:.5; cursor:not-allowed; transform:none; }
  .btn.gold{
    background:linear-gradient(145deg, var(--gold-bright), var(--gold-dark));
    color:var(--deep-navy);
    border-color:var(--gold);
    box-shadow:var(--shadow-soft), 0 0 15px rgba(212,183,126,.2);
  }
  .btn.danger{
    background:linear-gradient(145deg, var(--danger), #c0392b);
    color:white; border-color:var(--danger);
  }
  .btn.ghost{
    background:transparent; border-color:var(--border-1); color:var(--text-dim);
  }

  /* 입력 필드 */
  .field{ display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
  .field label{ font-weight:700; color:var(--text-dim); font-size:12px; letter-spacing:.02em; margin-left:4px; }
  .input, .select, .textarea{
    padding:10px 12px; background:rgba(8,13,25,.7);
    border:1px solid var(--border-1); border-radius:8px;
    color:var(--text); font-family:var(--sans); font-size:14px;
    backdrop-filter:var(--blur-light); transition:all var(--transition-normal);
    box-shadow:inset 0 2px 4px rgba(0,0,0,.1);
  }
  .input:focus, .select:focus, .textarea:focus{
    outline:none; border-color:var(--gold);
    box-shadow:inset 0 2px 4px rgba(0,0,0,.1), 0 0 0 3px rgba(212,183,126,.2), 0 0 20px rgba(212,183,126,.1);
    background:rgba(8,13,25,.9);
  }

  /* 상태 인디케이터 */
  .status-wrap{ display:flex; gap:12px; align-items:center; justify-content:center; margin-top:8px; }
  .status-indicator{
    display:flex; align-items:center; gap:10px; font-size:14px; font-weight:700;
    color:var(--text-dim); padding:8px 14px; background:var(--glass-1);
    border:1px solid var(--border-subtle); border-radius:16px; backdrop-filter:var(--blur-light);
  }
  .status-dot{ width:10px; height:10px; border-radius:50%; background:var(--warning); box-shadow:0 0 12px currentColor; }
  .status-dot.ok{ background:var(--success); color:var(--success); }
  .status-dot.bad{ background:var(--danger); color:var(--danger); }

  .pill{
    display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px;
    font-size:12px; font-weight:800; letter-spacing:.04em; border:1px solid var(--border-1);
    background:var(--glass-1); color:var(--text-dim);
  }
  #battleStatePill.wait{ color:#f59e0b; border-color:rgba(245,158,11,.4); }
  #battleStatePill.live{ color:#22c55e; border-color:rgba(34,197,94,.4); }
  #battleStatePill.end{ color:#ef4444; border-color:rgba(239,68,68,.4); }

  /* Roster/Logs/Chat */
  .two-col{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width:800px){ .two-col{ grid-template-columns:1fr; } }

  .team-card .header{
    display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;
  }
  .team-title{ font-family:var(--serif); font-weight:700; color:var(--gold-bright); }
  .team-count{ font-weight:800; color:var(--text-muted); }

  .player-row{
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 12px; border:1px solid var(--border-1); border-radius:10px;
    background:rgba(8,13,25,.5); margin-bottom:8px;
  }
  .player-row .badge{
    display:inline-flex; align-items:center; padding:4px 8px; border-radius:8px;
    background:rgba(212,183,126,.1); color:var(--gold-bright); font-weight:800; margin-right:8px;
  }
  .player-row .stat{ color:var(--text-muted); font-size:12px; }
  .btn-row{ display:flex; gap:8px; }

  .log-box, .chat-box{
    height:260px; overflow:auto; border:1px solid var(--border-1); border-radius:12px;
    padding:10px; background:linear-gradient(145deg, rgba(5,15,28,.95), rgba(8,20,35,.92));
    box-shadow:inset 0 3px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.02), var(--shadow-soft);
    font-size:13px;
  }
  .log-item, .chat-item{
    display:grid; grid-template-columns:70px 80px 1fr; gap:8px; align-items:baseline;
    padding:6px 8px; border-bottom:1px solid rgba(212,183,126,.06);
  }
  .log-item .time, .chat-item .time{ color:var(--text-muted); font-weight:700; font-size:12px; }
  .log-item .type{ color:var(--gold-bright); font-weight:800; }
  .chat-item .type{ color:var(--text-dim); font-weight:800; }
  .log-item .msg, .chat-item .msg{ color:var(--text); }

  .chat-input-row{ display:flex; gap:8px; margin-top:8px; }
  .chat-input{ flex:1; }

  /* In-page Toast */
  #toast{
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px);
    background:linear-gradient(145deg, rgba(0,30,53,.95), rgba(42,52,65,.9));
    color:var(--text); padding:12px 16px; border-radius:10px; border:1px solid var(--border-1);
    box-shadow:var(--shadow-medium), var(--shadow-inset); opacity:0; pointer-events:none; transition:all .3s var(--ease-smooth); z-index:9999;
  }
  #toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }

  @media (max-width:768px){
    .card{ padding:16px; }
  }
  </style>
</head>
<body>
  <div class="container">
    <header class="hero">
      <h1 class="admin-brand">PYXIS Admin</h1>
      <div class="status-wrap">
        <div class="status-indicator">
          <span id="connDot" class="status-dot waiting"></span>
          <span id="connText">연결 대기</span>
        </div>
        <span id="battleStatePill" class="pill wait">대기</span>
      </div>
    </header>

    <main class="row">
      <!-- LEFT: Controls -->
      <section class="card">
        <h2 class="section-title">전투 컨트롤</h2>

        <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap:12px;">
          <div class="field">
            <label for="battleMode">모드</label>
            <select id="battleMode" class="select">
              <option value="2v2" selected>2v2</option>
              <option value="1v1">1v1</option>
              <option value="3v3">3v3</option>
            </select>
          </div>
          <div class="field" style="grid-column: span 2;">
            <label for="battleId">전투 ID</label>
            <input id="battleId" class="input" placeholder="생성 시 자동 입력" />
          </div>
        </div>

        <div class="grid" style="grid-template-columns: repeat(4, auto); gap:8px; align-items:center;">
          <button id="createBattleBtn" class="btn gold">전투 생성</button>
          <button id="startBattleBtn" class="btn">시작</button>
          <button id="btnPauseBattle" class="btn ghost">일시정지</button>
          <button id="endBattleBtn" class="btn danger">종료</button>
          <button id="restartBattleBtn" class="btn ghost">재시작</button>
          <button id="btnConnect" class="btn ghost">재연결</button>
        </div>

        <hr style="border:none;border-top:1px solid var(--border-1); margin:16px 0;" />

        <h3 class="section-title">접속 링크 생성</h3>
        <div class="grid" style="grid-template-columns: 1fr auto; gap:10px;">
          <input id="adminLink" class="input" placeholder="Admin 링크" />
          <button id="generateLinksBtn" class="btn gold">링크 생성</button>

          <input id="playerLink" class="input" placeholder="Player 링크" />
          <div></div>

          <input id="spectatorLink" class="input" placeholder="Spectator 링크" />
          <div></div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border-1); margin:16px 0;" />

        <h3 class="section-title">플레이어 등록</h3>
        <div class="grid" style="grid-template-columns: repeat(2, 1fr); gap:12px;">
          <div class="field">
            <label for="playerName">이름</label>
            <input id="playerName" class="input" placeholder="예: Harry" />
          </div>
          <div class="field">
            <label for="playerTeam">팀</label>
            <select id="playerTeam" class="select">
              <option value="phoenix">불사조 기사단</option>
              <option value="eaters">죽음을 먹는 자들</option>
            </select>
          </div>

          <div class="field">
            <label for="statAtk">공격(1~5)</label>
            <input id="statAtk" type="number" min="1" max="5" class="input" value="3" />
          </div>
          <div class="field">
            <label for="statDef">방어(1~5)</label>
            <input id="statDef" type="number" min="1" max="5" class="input" value="3" />
          </div>
          <div class="field">
            <label for="statAgi">민첩(1~5)</label>
            <input id="statAgi" type="number" min="1" max="5" class="input" value="3" />
          </div>
          <div class="field">
            <label for="statLuk">행운(1~5)</label>
            <input id="statLuk" type="number" min="1" max="5" class="input" value="3" />
          </div>

          <div class="field">
            <label for="playerHp">목표 HP(시작 후 보정)</label>
            <input id="playerHp" type="number" min="1" max="1000" class="input" value="100" />
          </div>
          <div class="field">
            <label for="itemSelect">아이템</label>
            <select id="itemSelect" class="select">
              <option value="">없음</option>
              <option value="dittany">회복약(Dittany)</option>
              <option value="attackBoost">공격 강화</option>
              <option value="defenseBoost">방어 강화</option>
            </select>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-top:8px;">
          <button id="addPlayerBtn" class="btn gold">플레이어 추가</button>
        </div>
      </section>

      <!-- RIGHT: Roster / Chat / Log -->
      <section class="card">
        <h2 class="section-title">팀 & 실시간</h2>

        <div class="two-col">
          <div class="team-card">
            <div class="header">
              <div class="team-title">불사조 기사단</div>
              <div class="team-count"><span id="teamACount">0</span> 명</div>
            </div>
            <div id="teamPhoenix"></div>
          </div>

          <div class="team-card">
            <div class="header">
              <div class="team-title">죽음을 먹는 자들</div>
              <div class="team-count"><span id="teamBCount">0</span> 명</div>
            </div>
            <div id="teamDeathEaters"></div>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border-1); margin:16px 0;" />

        <div class="two-col">
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
              <div class="team-title">전투 로그</div>
            </div>
            <div id="battleLog" class="log-box"></div>
          </div>
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
              <div class="team-title">채팅</div>
            </div>
            <div id="chatMessages" class="chat-box"></div>
            <div class="chat-input-row">
              <input id="chatInput" class="input chat-input" placeholder="메시지 입력 후 Enter" />
              <button id="chatSendBtn" class="btn">전송</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <!-- Toast -->
  <div id="toast" role="status" aria-live="polite"></div>

  <!-- =========================
       Socket.IO Client Loader (origin → CDN 폴백)
       ========================= -->
  <script>
    (function ensureSocketIO(){
      if (window.io) {
        document.dispatchEvent(new Event('socket-io-ready'));
        return;
      }
      function add(src, onload, onerror){
        var s=document.createElement('script');
        s.src=src; s.async=true; s.onload=onload; s.onerror=onerror;
        document.head.appendChild(s);
      }
      add('/socket.io/socket.io.js',
        function(){ document.dispatchEvent(new Event('socket-io-ready')); },
        function(){ add('https://cdn.socket.io/4.7.5/socket.io.min.js',
          function(){ document.dispatchEvent(new Event('socket-io-ready')); },
          function(){ console.warn('[PYXIS] Socket.IO client load failed'); }
        );}
      );
    })();
  </script>

  <!-- =========================
       UI Helpers (전역 window.UI)
       ========================= -->
  <script>
    (function(){
      const $ = (sel, root = document) => root.querySelector(sel);
      const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
      function on(el, evt, handler, opts){ if(!el) return ()=>{}; el.addEventListener(evt, handler, opts); return ()=>el.removeEventListener(evt, handler, opts); }
      function addClass(el, ...cls){ el && el.classList.add(...cls); }
      function removeClass(el, ...cls){ el && el.classList.remove(...cls); }
      function toggleClass(el, cls, force){ el && el.classList.toggle(cls, force); }
      function text(el, value='', typewriter=false){
        if(!el) return;
        if(typewriter && value.length>0){ el.textContent=''; let i=0; const it=setInterval(()=>{ el.textContent+=value[i++]; if(i>=value.length) clearInterval(it);},50);}
        else el.textContent=String(value);
      }

      // Toast (in-page)
      function toast(message, type='info', timeout=1600){
        const el = document.getElementById('toast');
        if(!el) return ()=>{};
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(()=> el.classList.remove('show'), timeout);
        return ()=> el.classList.remove('show');
      }
      const success = (m,t)=>toast(m,'success',t);
      const warning = (m,t)=>toast(m,'warning',t);
      const error = (m,t)=>toast(m,'danger',t);
      const info = (m,t)=>toast(m,'info',t);

      // Connection status
      function setConnectionStatus({ dotEl, textEl, ok, message }){
        if(dotEl){
          removeClass(dotEl, 'ok','bad','idle');
          addClass(dotEl, ok==null? 'idle': ok? 'ok':'bad');
        }
        if(textEl){ text(textEl, message ?? (ok? '연결됨' : ok==null ? '연결 중...' : '연결 끊김')); }
      }

      window.UiHelpers = window.UI = {
        $, $$, on, addClass, removeClass, toggleClass, text,
        toast, success, warning, error, info,
        setConnectionStatus
      };
    })();
  </script>

  <!-- =========================
       Target Selector (전역 window.PyxisTargetSelector / window.PyxisTarget)
       ========================= -->
  <script>
    // PYXIS Target Selector Component - Enhanced Gaming Edition (요약 없이 원본 기반)
    class PyxisTargetSelector {
      constructor(options = {}) {
        this.options = {
          showStats: true, showHp: true, showTeam: true, showAvatar: true,
          allowMultiSelect: false, theme: 'default', battleMode: '2v2',
          enableSoundEffects: false, enableAnimations: true, ...options
        };
        this.isVisible = false; this.targets = []; this.selectedTargets = [];
        this.callback = null; this.battleData = null; this._listenersBound=false; this._focusedIndex=0;

        this._onEscKey = this._onEscKey.bind(this);
        this._onOverlayClick = this._onOverlayClick.bind(this);
        this._onKeyboardNav = this._onKeyboardNav.bind(this);

        this.init();
      }
      init(){ this.createOverlay(); this.setupEventListeners(); this.injectStyles(); }
      injectStyles(){
        if (document.getElementById('pyxis-target-selector-enhanced-styles')) return;
        const s=document.createElement('style'); s.id='pyxis-target-selector-enhanced-styles'; s.textContent=`
          :root{ --pyxis-deep-navy:#00080D; --pyxis-navy-light:#001E35; --pyxis-gold-bright:#DCC7A2; --pyxis-gold-warm:#D4BA8D; --pyxis-border-subtle: rgba(220,199,162,.2); --pyxis-glass-light: rgba(0,30,53,.8); --pyxis-combat-red:#C73E1D; --pyxis-success-green:#2D5A27; --pyxis-warning-amber:#B8860B;}
          .target-overlay{ position:fixed; inset:0; background:linear-gradient(135deg, rgba(0,8,13,.95), rgba(0,30,53,.9), rgba(0,8,13,.95)); backdrop-filter:blur(12px); display:flex; align-items:center; justify-content:center; z-index:10000; opacity:0; animation:fadeInOverlay .4s cubic-bezier(.4,0,.2,1) forwards; }
          @keyframes fadeInOverlay{ from{opacity:0} to{opacity:1} }
          .target-panel{ background:linear-gradient(145deg, rgba(0,30,53,.95), rgba(42,52,65,.9)); backdrop-filter:blur(20px); border:2px solid var(--pyxis-border-subtle); border-radius:20px; padding:32px; max-width:900px; width:90vw; max-height:85vh; overflow:hidden; box-shadow:0 25px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(220,199,162,.1), inset 0 1px 0 rgba(220,199,162,.2); transform:scale(.9) translateY(20px); animation:slideInPanel .5s cubic-bezier(.34,1.56,.64,1) forwards; }
          @keyframes slideInPanel{ to{ transform:scale(1) translateY(0); } }
          .target-title{ font-family:'Cinzel', serif; font-size:clamp(24px,4vw,32px); font-weight:600; color:var(--pyxis-gold-bright); text-align:center; margin-bottom:16px; }
          .target-list{ display:grid; grid-template-columns:repeat(auto-fit, minmax(280px,1fr)); gap:16px; max-height:60vh; overflow:auto; padding:8px; margin-bottom:16px; }
          .target-card{ background:linear-gradient(145deg, rgba(0,30,53,.9), rgba(42,52,65,.8)); border:1.5px solid var(--pyxis-border-subtle); border-radius:16px; padding:16px; cursor:pointer; transition:all .3s; position:relative; }
          .target-card:hover:not(.disabled){ transform:translateY(-4px); border-color:var(--pyxis-gold-bright); box-shadow:0 12px 24px rgba(0,0,0,.3), 0 0 0 1px var(--pyxis-gold-bright), 0 0 20px rgba(220,199,162,.2); }
          .target-card.selected{ border-color:var(--pyxis-gold-bright)!important; background:linear-gradient(145deg, rgba(220,199,162,.15), rgba(212,183,126,.1))!important; box-shadow:0 8px 16px rgba(0,0,0,.2), 0 0 0 2px var(--pyxis-gold-bright), inset 0 0 20px rgba(220,199,162,.1)!important; }
          .target-card.disabled{ opacity:.4; cursor:not-allowed; filter:grayscale(.8); }
          .target-header{ display:flex; gap:12px; align-items:center; margin-bottom:12px; }
          .target-avatar{ width:48px;height:48px;border-radius:12px; background:linear-gradient(145deg, var(--pyxis-gold-warm), var(--pyxis-gold-bright)); display:flex;align-items:center;justify-content:center;font-weight:700;color:#001018; border:2px solid var(--pyxis-border-subtle); }
          .target-name{ font-weight:800; color:var(--pyxis-gold-bright); }
          .target-team{ font-size:12px; padding:2px 8px; border-radius:8px; display:inline-block; margin:4px 0 8px; }
          .target-team.phoenix{ background:rgba(199,62,29,.2); color:#FF6B4A; border:1px solid rgba(199,62,29,.3); }
          .target-team.eaters{ background:rgba(45,90,39,.2); color:#66BB6A; border:1px solid rgba(45,90,39,.3); }
          .target-hp{ display:flex; gap:8px; align-items:center; margin-bottom:12px; }
          .target-hp-text{ font-weight:700; color:var(--pyxis-gold-warm); }
          .target-hp-bar-container{ flex:1; height:8px; border:1px solid var(--pyxis-border-subtle); border-radius:4px; overflow:hidden; background:rgba(0,30,53,.8); }
          .target-hp-bar{ height:100%; background:linear-gradient(90deg, #2D5A27, var(--pyxis-gold-warm), var(--pyxis-gold-bright)); transition:width .4s; }
          .target-hp-bar.low{ background:linear-gradient(90deg, var(--pyxis-combat-red), var(--pyxis-warning-amber)); }
          .target-stats{ display:grid; grid-template-columns:repeat(2,1fr); gap:8px; font-size:12px; color:rgba(220,199,162,.8); margin-bottom:10px;}
          .target-stat{ display:flex; justify-content:space-between; padding:4px 8px; border:1px solid var(--pyxis-border-subtle); border-radius:6px; background:rgba(0,30,53,.5); }
          .status-pill{ padding:2px 8px; border-radius:12px; font-size:10px; font-weight:700; letter-spacing:.5px; margin-right:6px; display:inline-block;}
          .status-pill.alive{ background:rgba(45,90,39,.3); color:#66BB6A; border:1px solid rgba(45,90,39,.5); }
          .status-pill.dead{ background:rgba(199,62,29,.3); color:#FF6B4A; border:1px solid rgba(199,62,29,.5); }
          .status-pill.boosted{ background:rgba(184,134,11,.3); color:#B8860B; border:1px solid rgba(184,134,11,.5); }
          .target-actions{ display:flex; gap:12px; justify-content:center; margin-top:16px; }
          .btn{ padding:10px 16px; border:2px solid var(--pyxis-border-subtle); border-radius:12px; background:linear-gradient(145deg, rgba(0,30,53,.9), rgba(42,52,65,.8)); color:var(--pyxis-gold-bright); font-weight:700; cursor:pointer; }
          .btn-gold{ background:linear-gradient(145deg, var(--pyxis-gold-warm), var(--pyxis-gold-bright)); color:#001018; border-color:var(--pyxis-gold-bright); }
          .no-targets{ text-align:center; color:rgba(220,199,162,.7); padding:40px 20px; border:2px dashed var(--pyxis-border-subtle); border-radius:12px; }
          @media (max-width:768px){ .target-panel{ margin:16px; padding:20px; } .target-list{ grid-template-columns:1fr; max-height:50vh; } }
        `;
        document.head.appendChild(s);
      }
      createOverlay(){
        const ex = document.getElementById('pyxis-target-overlay'); if(ex) ex.remove();
        this.overlay = document.createElement('div');
        this.overlay.id='pyxis-target-overlay'; this.overlay.className='target-overlay'; this.overlay.style.display='none';
        this.overlay.setAttribute('role','dialog'); this.overlay.setAttribute('aria-modal','true'); this.overlay.setAttribute('aria-labelledby','targetTitle');
        this.overlay.innerHTML = `
          <div class="target-panel">
            <div class="target-title" id="targetTitle">전투 대상 선택</div>
            <div class="battle-info" style="text-align:center; margin-bottom:12px; display:none;">
              <div class="battle-mode"></div>
              <div class="turn-info" style="font-size:12px; opacity:.8;"></div>
            </div>
            <div class="target-list" id="targetList" role="listbox" aria-multiselectable="false"></div>
            <div class="target-actions">
              <button class="btn" id="cancelTarget" type="button">취소</button>
              <button class="btn btn-gold" id="confirmTarget" type="button" style="display:none;" disabled>확인 (<span id="selectedCount">0</span>)</button>
            </div>
          </div>`;
        document.body.appendChild(this.overlay);
        this.titleEl = this.overlay.querySelector('#targetTitle');
        this.listEl = this.overlay.querySelector('#targetList');
        this.cancelBtn = this.overlay.querySelector('#cancelTarget');
        this.confirmBtn = this.overlay.querySelector('#confirmTarget');
        this.selectedCountEl = this.overlay.querySelector('#selectedCount');
      }
      setupEventListeners(){
        this.teardownEventListeners();
        if(this.cancelBtn){ this._cancelHandler=()=>this.hide(); this.cancelBtn.addEventListener('click', this._cancelHandler); }
        if(this.confirmBtn){ this._confirmHandler=()=>this.confirm(); this.confirmBtn.addEventListener('click', this._confirmHandler); }
        document.addEventListener('keydown', this._onEscKey);
        document.addEventListener('keydown', this._onKeyboardNav);
        this.overlay.addEventListener('click', this._onOverlayClick);
        this._listenersBound = true;
      }
      teardownEventListeners(){
        if(!this._listenersBound) return;
        if(this._cancelHandler && this.cancelBtn){ this.cancelBtn.removeEventListener('click', this._cancelHandler); this._cancelHandler=null; }
        if(this._confirmHandler && this.confirmBtn){ this.confirmBtn.removeEventListener('click', this._confirmHandler); this._confirmHandler=null; }
        document.removeEventListener('keydown', this._onEscKey);
        document.removeEventListener('keydown', this._onKeyboardNav);
        if(this.overlay) this.overlay.removeEventListener('click', this._onOverlayClick);
        this._listenersBound=false;
      }
      _onEscKey(e){ if(e.key==='Escape' && this.isVisible){ e.preventDefault(); e.stopPropagation(); this.hide(); } }
      _onKeyboardNav(e){
        if(!this.isVisible) return;
        const cards = this.listEl.querySelectorAll('.target-card:not(.disabled)');
        if(cards.length===0) return;
        switch(e.key){
          case 'ArrowDown': case 'ArrowRight': e.preventDefault(); this._focusedIndex=Math.min(this._focusedIndex+1, cards.length-1); this.updateFocus(cards); break;
          case 'ArrowUp': case 'ArrowLeft': e.preventDefault(); this._focusedIndex=Math.max(this._focusedIndex-1, 0); this.updateFocus(cards); break;
          case 'Enter': case ' ': e.preventDefault(); cards[this._focusedIndex]?.click(); break;
          case 'Home': e.preventDefault(); this._focusedIndex=0; this.updateFocus(cards); break;
          case 'End': e.preventDefault(); this._focusedIndex=cards.length-1; this.updateFocus(cards); break;
        }
      }
      updateFocus(cards){ cards.forEach((c,i)=> c.classList.toggle('focused', i===this._focusedIndex)); cards[this._focusedIndex]?.scrollIntoView({behavior:'smooth', block:'nearest'}); }
      _onOverlayClick(e){ if(e.target===this.overlay) this.hide(); }
      show(title, targets, callback, battleData=null){
        this.titleEl.textContent = title || '전투 대상 선택';
        this.targets = Array.isArray(targets)? targets: [];
        this.callback = callback; this.battleData = battleData; this.selectedTargets=[]; this._focusedIndex=0;

        const binfo = this.overlay.querySelector('.battle-info');
        if(this.battleData){
          binfo.style.display = 'block';
          binfo.querySelector('.battle-mode').textContent = `${this.battleData.mode || '2v2'} 전투`;
          binfo.querySelector('.turn-info').textContent = `턴 ${this.battleData.currentTurn||1} • ${this.battleData.currentTeam||'불사조 기사단'} 차례`;
        } else { binfo.style.display='none'; }

        this.renderTargets();
        this.overlay.style.display='flex'; this.isVisible=true;
        const first = this.listEl.querySelector('.target-card:not(.disabled)');
        if(first){ setTimeout(()=>{ first.focus(); this.updateFocus([first]); }, 80); }
      }
      renderTargets(){
        this.listEl.innerHTML='';
        if(this.targets.length===0){
          this.listEl.innerHTML = `<div class="no-targets">선택할 수 있는 대상이 없습니다</div>`;
          return;
        }
        this.targets.forEach((t,i)=> this.listEl.appendChild(this.createTargetCard(t,i)));
        this.confirmBtn.style.display = this.options.allowMultiSelect ? 'inline-flex' : 'none';
        this.listEl.setAttribute('aria-multiselectable', String(!!this.options.allowMultiSelect));
      }
      createTargetCard(target, index){
        const card = document.createElement('div');
        const disabled = target.alive===false || (target.hp||0)<=0;
        card.className = `target-card ${disabled?'disabled':''}`;
        card.tabIndex = disabled? -1 : 0;
        card.setAttribute('role','option');
        card.setAttribute('aria-selected','false');
        card.setAttribute('aria-label', `${target.name || `대상 ${index+1}`} 선택`);

        const header = document.createElement('div'); header.className='target-header';
        const avatar = document.createElement('div'); avatar.className='target-avatar';
        if(target.avatar && this.options.showAvatar){
          const img=document.createElement('img'); img.src=target.avatar; img.alt=target.name||'플레이어';
          img.onerror=()=>{ avatar.textContent=(target.name||'U')[0].toUpperCase(); };
          avatar.appendChild(img);
        } else { avatar.textContent = (target.name||'U')[0].toUpperCase(); }

        const info = document.createElement('div'); info.style.flex='1';
        const nameEl = document.createElement('div'); nameEl.className='target-name'; nameEl.textContent = target.name || `대상 ${index+1}`;
        if(this.options.showTeam && target.team){
          const team=document.createElement('div'); team.className=`target-team ${target.team}`; team.textContent = target.team==='phoenix'?'불사조 기사단':'죽음을 먹는 자들';
          info.appendChild(team);
        }
        info.appendChild(nameEl);
        header.appendChild(avatar); header.appendChild(info);
        card.appendChild(header);

        if(this.options.showHp && target.hp!==undefined){
          const c=document.createElement('div'); c.className='target-hp';
          const t=document.createElement('div'); t.className='target-hp-text'; t.textContent=`${Math.max(0,target.hp)}/${target.maxHp||100}`;
          const barBox=document.createElement('div'); barBox.className='target-hp-bar-container';
          const bar=document.createElement('div'); bar.className='target-hp-bar';
          const pct=Math.max(0, Math.min(100, (target.hp/(target.maxHp||100))*100)); if(pct<=25) bar.classList.add('low'); bar.style.width=`${pct}%`;
          barBox.appendChild(bar); c.appendChild(t); c.appendChild(barBox); card.appendChild(c);
        }

        if(this.options.showStats && target.stats){
          const box=document.createElement('div'); box.className='target-stats';
          const stats=target.stats; const statNames=[['attack','공격','atk'],['defense','방어','def'],['agility','민첩','agi'],['luck','행운','luk']];
          statNames.forEach(([k,label,alt])=>{ const v = stats[k] ?? stats[alt] ?? 3; const s=document.createElement('div'); s.className='target-stat'; s.innerHTML=`<span>${label}</span><span>${v}</span>`; box.appendChild(s); });
          card.appendChild(box);
        }

        const status=document.createElement('div');
        const alive=document.createElement('div'); alive.className=`status-pill ${disabled?'dead':'alive'}`; alive.textContent=disabled?'전투불능':'전투가능'; status.appendChild(alive);
        if(Array.isArray(target.effects)){ target.effects.forEach(e=>{ const pill=document.createElement('div'); pill.className='status-pill boosted'; pill.textContent=(e && e.name) ? e.name : e; status.appendChild(pill); });}
        card.appendChild(status);

        if(!disabled){
          const onPick = (e)=>{ e.preventDefault(); e.stopPropagation(); this.selectTarget(target, card); };
          card.addEventListener('click', onPick);
          card.addEventListener('keypress', (e)=>{ if(e.key==='Enter'||e.key===' ') onPick(e); });
        }
        return card;
      }
      selectTarget(target, cardEl){
        if(target.alive===false || (target.hp||0)<=0) return;
        if(this.options.allowMultiSelect){
          const idx=this.selectedTargets.findIndex(t=> (t.id&&t.id===target.id) || (t.name===target.name));
          if(idx>-1){ this.selectedTargets.splice(idx,1); cardEl.classList.remove('selected'); cardEl.setAttribute('aria-selected','false'); }
          else{ this.selectedTargets.push(target); cardEl.classList.add('selected'); cardEl.setAttribute('aria-selected','true'); }
          this.updateConfirmButton();
        }else{
          this.hide(); this.callback && setTimeout(()=> this.callback(target), 80);
        }
      }
      updateConfirmButton(){
        if(this.confirmBtn && this.selectedCountEl){
          const c=this.selectedTargets.length; this.confirmBtn.disabled = c===0; this.selectedCountEl.textContent = c;
          this.confirmBtn.setAttribute('aria-label', `${c}명의 대상 선택 확인`);
        }
      }
      confirm(){ if(this.selectedTargets.length===0) return; this.hide(); this.callback && setTimeout(()=> this.callback(this.options.allowMultiSelect? this.selectedTargets : this.selectedTargets[0]), 80); }
      hide(){
        if(!this.overlay) return;
        this.overlay.style.opacity='0';
        this.overlay.querySelector('.target-panel').style.transform='scale(.9) translateY(20px)';
        setTimeout(()=>{ this.overlay.style.display='none'; this.isVisible=false; this.targets=[]; this.selectedTargets=[]; this.callback=null; this.battleData=null; this._focusedIndex=0; }, 200);
      }
      updateTargets(targets){ this.targets = Array.isArray(targets)? targets: []; this.selectedTargets=[]; this.renderTargets(); this.updateConfirmButton(); }
      updateBattleData(bd){ this.battleData=bd; const info=this.overlay?.querySelector('.battle-info'); if(info && this.isVisible){ info.querySelector('.battle-mode').textContent = `${bd.mode||'2v2'} 전투`; info.querySelector('.turn-info').textContent = `턴 ${bd.currentTurn||1} • ${bd.currentTeam||'불사조 기사단'} 차례`; } }
      setTheme(theme){ this.options.theme=theme; if(this.overlay){ this.overlay.className=`target-overlay theme-${theme}`; } }
      toggleAnimations(en){ this.options.enableAnimations=en; if(this.overlay){ this.overlay.style.transition = en? '':'none'; const p=this.overlay.querySelector('.target-panel'); if(p) p.style.transition = en? '':'none'; } }
      toggleSoundEffects(en){ this.options.enableSoundEffects=en; }
      destroy(){ this.teardownEventListeners(); if(this.overlay?.parentNode) this.overlay.parentNode.removeChild(this.overlay); const st=document.getElementById('pyxis-target-selector-enhanced-styles'); if(st) st.remove(); this.targets=[]; this.selectedTargets=[]; this.callback=null; this.battleData=null; this.isVisible=false; this._focusedIndex=0; }
    }
    window.PyxisTargetSelector = PyxisTargetSelector;
    window.PyxisTarget = new PyxisTargetSelector({ enableAnimations:true, enableSoundEffects:false, showStats:true, showHp:true, showTeam:true, showAvatar:true });
    window.PyxisTargetUtils = {
      filterByTeam:(targets,team)=> targets.filter(t=>t.team===team),
      filterAlive:(targets)=> targets.filter(t=> t.alive!==false && (t.hp||0)>0),
      sortByHp:(targets,asc=true)=> [...targets].sort((a,b)=> asc? (a.hp||0)-(b.hp||0) : (b.hp||0)-(a.hp||0)),
      sortByTotalStats:(targets,asc=false)=> [...targets].sort((a,b)=>{
        const sa = a.stats? Object.values(a.stats).reduce((s,v)=> s+(v||0),0):0;
        const sb = b.stats? Object.values(b.stats).reduce((s,v)=> s+(v||0),0):0;
        return asc? sa-sb : sb-sa;
      }),
      isValidTarget:(t)=> t && t.alive!==false && (t.hp||0)>0,
      normalizeTarget:(t)=>({
        id: t.id || t.name || Math.random().toString(36).slice(2),
        name: t.name || '무명의 전사',
        team: t.team || 'phoenix',
        hp: Math.max(0, t.hp || 100),
        maxHp: t.maxHp || 100,
        stats:{
          attack: Math.max(1, Math.min(5, t.stats?.attack || t.stats?.atk || 3)),
          defense: Math.max(1, Math.min(5, t.stats?.defense || t.stats?.def || 3)),
          agility: Math.max(1, Math.min(5, t.stats?.agility || t.stats?.agi || 3)),
          luck: Math.max(1, Math.min(5, t.stats?.luck || t.stats?.luk || 3)),
        },
        alive: t.alive!==false && (t.hp||100)>0,
        avatar: t.avatar || null,
        effects: t.effects || []
      })
    };
  </script>

  <!-- =========================
       Enhanced Admin Interface (전역 window.adminInterface)
       ========================= -->
  <script>
    class EnhancedAdminInterface {
      constructor() {
        /** Socket / Connection */
        this.socket = null;
        this.isConnected = false;
        this.isAuthenticated = false;

        /** Battle & Admin */
        const url = new URL(location.href);
        this.currentBattleId = url.searchParams.get('battle') || '';
        this.currentAdminOtp = url.searchParams.get('token') || '';
        this.playerList = [];

        /** Connection & Heartbeat */
        this.connectionState = 'disconnected';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.heartbeatInterval = null;
        this.heartbeatEvery = 15000;
        this.lastPongAt = 0;
        this.connectionTimeout = null;
        this.connectionTimeoutMs = 12000;

        /** Message Queue */
        this.messageQueue = [];
        this.isProcessingQueue = false;

        /** Sync */
        this.lastSyncTime = 0;
        this.syncInterval = null;
        this.syncEvery = 5000;

        /** Metrics */
        this.metrics = {
          messagesReceived: 0,
          messagesSent: 0,
          errors: 0,
          reconnects: 0,
          startTime: Date.now()
        };

        /** 목표 HP 관리 */
        this.desiredHpMap = new Map();

        /** Bootstrap */
        this.init();
      }

      init() {
        this.initElements();
        this.setupEventListeners();
        this.setupStatInputs();
        this.startMetricsCollection();
        this.addLog('system', '강화된 관리자 시스템이 준비되었습니다');

        // 페이지 떠나기 전 정리
        window.addEventListener('beforeunload', () => this.cleanup());

        // 소켓 자동 연결 (io 준비되면 재시도)
        this.connectSocket();
        document.addEventListener('socket-io-ready', () => {
          if (!this.isConnected) this.connectSocket();
        });

        // URL에 battle이 있으면 표시
        if (this.el.battleId) this.el.battleId.value = this.currentBattleId || '';
      }

      initElements() {
        const $ = (sel, ctx = document) => ctx.querySelector(sel);
        this.el = {
          battleMode: $('#battleMode'),
          battleId: $('#battleId'),
          btnCreateBattle: $('#createBattleBtn'),
          btnStartBattle: $('#startBattleBtn'),
          btnEndBattle: $('#endBattleBtn'),
          btnRestartBattle: $('#restartBattleBtn'),
          connDot: $('#connDot'),
          connText: $('#connText'),
          battleStatePill: $('#battleStatePill'),
          btnGenerateLinks: $('#generateLinksBtn'),
          adminLink: $('#adminLink'),
          playerLink: $('#playerLink'),
          spectatorLink: $('#spectatorLink'),
          playerName: $('#playerName'),
          playerTeam: $('#playerTeam'),
          statAtk: $('#statAtk'),
          statDef: $('#statDef'),
          statAgi: $('#statAgi'),
          statLuk: $('#statLuk'),
          playerHp: $('#playerHp'),
          itemSelect: $('#itemSelect'),
          btnAddPlayer: $('#addPlayerBtn'),
          teamPhoenix: $('#teamPhoenix'),
          teamEaters: $('#teamDeathEaters'),
          battleLog: $('#battleLog'),
          chatMessages: $('#chatMessages'),
          chatInput: $('#chatInput'),
          chatSendBtn: $('#chatSendBtn'),
          toast: $('#toast')
        };
        this.optional = {
          btnConnect: $('#btnConnect'),
          btnPauseBattle: $('#btnPauseBattle'),
          teamACount: $('#teamACount'),
          teamBCount: $('#teamBCount')
        };
      }

      setupEventListeners() {
        this.el.btnCreateBattle?.addEventListener('click', () => this.createBattle());
        this.el.btnStartBattle?.addEventListener('click', () => this.startBattle());
        this.el.btnEndBattle?.addEventListener('click', () => this.endBattle());
        this.el.btnRestartBattle?.addEventListener('click', () => this.restartBattle());
        this.el.btnGenerateLinks?.addEventListener('click', () => this.generateLinks());
        this.el.btnAddPlayer?.addEventListener('click', () => this.addPlayer());

        this.el.chatSendBtn?.addEventListener('click', () => this.sendChat());
        this.el.chatInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendChat();
          }
        });

        this.optional.btnConnect?.addEventListener('click', () => this.connectSocket());
        this.optional.btnPauseBattle?.addEventListener('click', () => this.pauseBattle());

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const t = e.target;
            if (t && t === this.el.chatInput) return;
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes((t?.tagName) || '')) e.preventDefault();
          }
        });
      }

      setupStatInputs() {
        const clamp = (v, min, max) => { v = Number(v); if (Number.isNaN(v)) return min; return Math.max(min, Math.min(max, v)); };
        const bindClamp = (el, min, max) => {
          if (!el) return;
          el.addEventListener('change', () => { el.value = clamp(el.value, min, max); });
          el.addEventListener('blur', () => { el.value = clamp(el.value, min, max); });
        };
        bindClamp(this.el.statAtk, 1, 5);
        bindClamp(this.el.statDef, 1, 5);
        bindClamp(this.el.statAgi, 1, 5);
        bindClamp(this.el.statLuk, 1, 5);
        bindClamp(this.el.playerHp, 1, 1000);
      }

      startMetricsCollection() {
        this._metricsTimer = setInterval(() => {
          // const uptime = ((Date.now() - this.metrics.startTime) / 1000).toFixed(0);
          // console.debug('[metrics] uptime(s):', uptime, JSON.stringify(this.metrics));
        }, 15000);
      }

      async fetchJSON(url, opts = {}) {
        const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('Invalid JSON from ' + url); }
        if (!res.ok) throw new Error(data?.error || ('HTTP ' + res.status));
        return data;
      }

      /* ============ Socket ============ */
      connectSocket() {
        if (this.socket?.connected) return;

        try {
          // eslint-disable-next-line no-undef
          this.socket = io({ transports: ['websocket', 'polling'] });

          this.socket.on('connect', () => {
            this.isConnected = true;
            this.setConn(true, '연결 완료');
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            this.processQueue();
            this.startHeartbeat();
            this.startSync();

            if (this.currentBattleId && this.currentAdminOtp) {
              this.socket.emit('adminAuth', { battleId: this.currentBattleId, token: this.currentAdminOtp });
            }
          });

          this.socket.on('disconnect', () => {
            this.isConnected = false;
            this.setConn(false, '연결 끊김');
            this.connectionState = 'disconnected';
            this.stopHeartbeat();
            this.stopSync();
            this.tryReconnect();
          });

          this.socket.on('authSuccess', (payload) => {
            this.isAuthenticated = true;
            this.addLog('system', '관리자 인증 성공');
            if (payload?.battle) {
              this.currentBattleId = payload.battle?.id || this.currentBattleId;
              if (this.el.battleId) this.el.battleId.value = this.currentBattleId || '';
              this.updateBattleStateByStatus(payload.battle?.status || payload.battle?.state);
              this.renderRoster(payload.battle);
            }
          });

          this.socket.on('authError', () => {
            this.isAuthenticated = false;
            this.addLog('error', '관리자 인증 실패');
            this.showToast('관리자 인증 실패', 'error');
          });

          this.socket.on('battleUpdate', (state) => {
            this.metrics.messagesReceived++;
            try {
              if (state?.id) this.currentBattleId = state.id;
              if (this.el.battleId) this.el.battleId.value = this.currentBattleId || '';
              this.updateBattleStateByStatus(state?.status || state?.state);
              this.renderRoster(state);
              if (Array.isArray(state?.log)) {
                const last = state.log.slice(-5);
                last.forEach((l) => this.addLog(l.type || 'event', l.message || ''));
              }
            } catch (e) {
              this.addLog('error', '상태 렌더링 오류');
            }
          });

          this.socket.on('chatMessage', (msg) => {
            this.metrics.messagesReceived++;
            const sender = msg?.sender || msg?.role || '채널';
            const text = msg?.message || '';
            this.appendChat(sender, text);
          });

          this.socket.on('admin:pong', () => {
            this.lastPongAt = Date.now();
          });
        } catch (e) {
          this.metrics.errors++;
          this.addLog('error', '소켓 초기화 실패: ' + e.message);
        }
      }

      tryReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.addLog('error', '재연결 중단(최대 시도 초과)');
          return;
        }
        this.reconnectAttempts++;
        this.metrics.reconnects++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 15000);
        setTimeout(() => {
          this.addLog('system', `재연결 시도 ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          this.connectSocket();
        }, delay);
      }

      startHeartbeat() {
        this.stopHeartbeat();
        this.lastPongAt = Date.now();
        this.heartbeatInterval = setInterval(() => {
          if (!this.socket?.connected) return;
          this.socket.emit('admin:ping', { t: Date.now() });
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = setTimeout(() => {
            const since = Date.now() - this.lastPongAt;
            if (since > this.connectionTimeoutMs) {
              this.socket.disconnect();
            }
          }, this.connectionTimeoutMs + 100);
        }, this.heartbeatEvery);
      }

      stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }

      startSync() {
        this.stopSync();
        this.syncInterval = setInterval(() => {
          if (!this.socket?.connected || !this.currentBattleId) return;
          this.socket.emit('admin:requestState', { battleId: this.currentBattleId });
          this.lastSyncTime = Date.now();
        }, this.syncEvery);
      }

      stopSync() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = null;
      }

      setConn(ok, msg) {
        const { setConnectionStatus } = window.UI || {};
        if (setConnectionStatus) {
          setConnectionStatus({ dotEl: this.el.connDot, textEl: this.el.connText, ok, message: msg });
        } else {
          if (this.el.connDot) {
            this.el.connDot.classList.remove('ok', 'bad');
            this.el.connDot.classList.add(ok ? 'ok' : 'bad');
          }
          if (this.el.connText) this.el.connText.textContent = msg || (ok ? '연결 완료' : '연결 끊김');
        }
      }

      /* ============ 메시지 큐 ============ */
      sendSocketMessage(event, payload = {}, ack) {
        const job = { event, payload, ack };
        if (!this.socket?.connected) {
          this.messageQueue.push(job);
          return;
        }
        try {
          this.metrics.messagesSent++;
          if (typeof ack === 'function') this.socket.emit(event, payload, ack);
          else this.socket.emit(event, payload);
        } catch (e) {
          this.metrics.errors++;
          this.addLog('error', `메시지 전송 실패(${event}): ` + e.message);
        }
      }

      async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;
        try {
          while (this.socket?.connected && this.messageQueue.length > 0) {
            const job = this.messageQueue.shift();
            this.sendSocketMessage(job.event, job.payload, job.ack);
            await new Promise((r) => setTimeout(r, 50));
          }
        } finally {
          this.isProcessingQueue = false;
        }
      }

      /* ============ 배틀 컨트롤 ============ */
      async createBattle() {
        try {
          const mode = this.el.battleMode?.value || '2v2';
          const r = await this.fetchJSON('/api/battles', {
            method: 'POST',
            body: JSON.stringify({ mode })
          });
          const id = r?.id || r?.battleId;
          if (!id) throw new Error('생성 결과에 ID 없음');
          this.currentBattleId = id;
          if (this.el.battleId) this.el.battleId.value = id;

          const q = new URLSearchParams(location.search);
          q.set('battle', id);
          history.replaceState(null, '', location.pathname + '?' + q.toString());

          this.addLog('system', `전투 생성: ${id}`);
          this.showToast('전투 생성 완료', 'success');
        } catch (e) {
          this.addLog('error', '전투 생성 실패: ' + e.message);
          this.showToast('전투 생성 실패', 'error');
        }
      }

      startBattle() {
        if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
        const payload = { battleId: this.currentBattleId, timestamp: Date.now() };
        let acked = false;
        const ack = (res) => {
          acked = true;
          if (res?.success) {
            this.addLog('system', '전투 시작 명령 전송');
            this.updateBattleState('live');
            this.showToast('전투 시작', 'success');
            this.applyDesiredHpAdjustments();
          } else {
            this.addLog('error', `전투 시작 실패: ${res?.error || '알 수 없는 오류'}`);
            this.showToast('전투 시작 실패', 'error');
          }
        };
        this.sendSocketMessage('battle:start', payload, ack);

        setTimeout(async () => {
          if (acked) return;
          try {
            await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/start`, {
              method: 'POST',
              body: JSON.stringify({})
            });
            this.addLog('system', '전투 시작 명령(REST) 전송');
            this.updateBattleState('live');
            this.showToast('전투 시작', 'success');
            this.applyDesiredHpAdjustments();
          } catch (e) {
            this.addLog('error', '전투 시작 실패(REST): ' + e.message);
            this.showToast('전투 시작 실패', 'error');
          }
        }, 600);
      }

      async pauseBattle() {
        if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
        try {
          await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/pause`, {
            method: 'POST',
            body: JSON.stringify({})
          });
          this.updateBattleState('wait');
          this.addLog('system', '전투 일시정지');
          this.showToast('일시정지', 'success');
        } catch (e) {
          this.addLog('error', '일시정지 실패: ' + e.message);
          this.showToast('일시정지 실패', 'error');
        }
      }

      async endBattle() {
        if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
        try {
          await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/end`, {
            method: 'POST',
            body: JSON.stringify({})
          });
          this.updateBattleState('end');
          this.addLog('system', '전투 종료 명령 전송');
          this.showToast('전투 종료', 'success');
        } catch (e) {
          this.addLog('error', '전투 종료 실패: ' + e.message);
          this.showToast('전투 종료 실패', 'error');
        }
      }

      async restartBattle() {
        if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
        try {
          await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/start`, {
            method: 'POST',
            body: JSON.stringify({ restart: true })
          });
          this.updateBattleState('live');
          this.addLog('system', '전투 재시작 명령 전송');
          this.showToast('전투 재시작', 'success');
        } catch (e) {
          this.addLog('error', '전투 재시작 실패: ' + e.message);
          this.showToast('전투 재시작 실패', 'error');
        }
      }

      /* ============ 전투 시작 후 HP 보정 ============ */
      async applyDesiredHpAdjustments() {
        for (const player of this.playerList) {
          const desiredHp = this.desiredHpMap.get(player.name);
          if (!Number.isFinite(desiredHp)) continue;
          const diff = desiredHp - 100;
          if (diff === 0) continue;
          const action = diff > 0 ? 'heal_partial' : 'damage';
          const value = Math.abs(diff);
          try {
            await this.executeBatchCommand(action, [player.id], { value });
            this.addLog('system', `플레이어 "${player.name}" HP 보정: ${desiredHp}`);
          } catch (e) {
            this.addLog('error', `HP 보정 실패(${player.name}): ${e.message}`);
          }
        }
      }

      async executeBatchCommand(action, playerIds = [], extra = {}) {
        if (!this.currentBattleId) throw new Error('전투 ID 없음');
        try {
          await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/command`, {
            method: 'POST',
            body: JSON.stringify({ action, playerIds, ...extra })
          });
          return;
        } catch (e) {
          await new Promise((resolve, reject) => {
            const payload = { battleId: this.currentBattleId, action, playerIds, ...extra };
            this.sendSocketMessage('admin:command', payload, (res) => {
              if (res?.success) resolve();
              else reject(new Error(res?.error || 'command failed'));
            });
          });
        }
      }

      /* ============ 플레이어 추가 ============ */
      collectPlayerData() {
        const name = (this.el.playerName?.value || '').trim();
        const teamSel = this.el.playerTeam?.value || '';
        const desiredHp = Number(this.el.playerHp?.value || 100);
        if (!name || !teamSel) {
          this.showToast('이름과 팀을 선택하세요', 'error');
          return null;
        }
        const clampStat = (v) => { v = Number(v); if (!Number.isFinite(v)) return 3; return Math.max(1, Math.min(5, v)); };
        const stats = {
          atk: clampStat(this.el.statAtk?.value || 3),
          def: clampStat(this.el.statDef?.value || 3),
          agi: clampStat(this.el.statAgi?.value || 3),
          luk: clampStat(this.el.statLuk?.value || 3)
        };
        const hp = 100;
        const team = this._teamKey(teamSel);
        const itemKey = this.el.itemSelect?.value || '';
        const items = itemKey ? [itemKey] : [];
        this.desiredHpMap.set(name, desiredHp);
        return { name, team, stats, hp, items };
      }

      async addPlayer() {
        if (!this.currentBattleId) {
          this.showToast('먼저 전투를 생성하세요', 'error');
          return;
        }
        const data = this.collectPlayerData();
        if (!data) return;

        try {
          this.addLog('system', '플레이어 등록 중...');
          const r = await this.fetchJSON(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players`, {
            method: 'POST',
            body: JSON.stringify(data)
          });
          const player = r?.player || r;
          if (!player || !(player.id || player.name)) throw new Error('플레이어 응답 오류');

          this.playerList = this.uniqueById([...this.playerList, player]);
          this.updateTeamRoster();
          this.resetPlayerForm();

          this.addLog('system', `플레이어 "${player.name}" 등록 완료 (HP목표:${this.desiredHpMap.get(player.name)})`);
          this.showToast(`${player.name} 등록 완료`, 'success');
        } catch (e) {
          this.addLog('error', `플레이어 등록 실패: ${e.message}`);
          this.showToast('플레이어 등록 실패', 'error');
        }
      }

      resetPlayerForm() {
        if (this.el.playerName) this.el.playerName.value = '';
        if (this.el.playerTeam) this.el.playerTeam.value = 'phoenix';
        if (this.el.statAtk) this.el.statAtk.value = 3;
        if (this.el.statDef) this.el.statDef.value = 3;
        if (this.el.statAgi) this.el.statAgi.value = 3;
        if (this.el.statLuk) this.el.statLuk.value = 3;
        if (this.el.playerHp) this.el.playerHp.value = 100;
        if (this.el.itemSelect) this.el.itemSelect.value = '';
      }

      /* ============ 링크/OTP ============ */
      async generateLinks() {
        if (!this.currentBattleId) return this.showToast('전투 ID가 없습니다', 'error');
        try {
          const r = await this.fetchJSON(`/api/admin/battles/${encodeURIComponent(this.currentBattleId)}/links`, {
            method: 'POST',
            body: JSON.stringify({})
          });
          const admin = r?.admin || r?.links?.admin || '';
          const player = r?.player || r?.links?.player || '';
          const spectator = r?.spectator || r?.links?.spectator || '';
          if (this.el.adminLink) this.el.adminLink.value = admin;
          if (this.el.playerLink) this.el.playerLink.value = player;
          if (this.el.spectatorLink) this.el.spectatorLink.value = spectator;

          this.addLog('system', '링크 생성 완료');
          this.showToast('링크 생성 완료', 'success');
        } catch (e) {
          this.addLog('error', '링크 생성 실패: ' + e.message);
          this.showToast('링크 생성 실패', 'error');
        }
      }

      /* ============ 렌더링 ============ */
      updateBattleStateByStatus(st) {
        const s = (st || '').toString().toLowerCase();
        if (/live|running|in_progress/.test(s)) return this.updateBattleState('live');
        if (/end|ended|finished/.test(s)) return this.updateBattleState('end');
        return this.updateBattleState('wait');
      }

      updateBattleState(state, label) {
        if (!this.el.battleStatePill) return;
        this.el.battleStatePill.classList.remove('wait', 'live', 'end');
        const map = { wait: '대기', live: '진행', end: '종료' };
        this.el.battleStatePill.classList.add(state in map ? state : 'wait');
        this.el.battleStatePill.textContent = label || map[state] || map.wait;
      }

      renderRoster(state) {
        const phoenixHost = this.el.teamPhoenix;
        const eatersHost = this.el.teamEaters;
        if (!phoenixHost || !eatersHost) return;

        phoenixHost.innerHTML = '';
        eatersHost.innerHTML = '';

        const players = state?.players || this.playerList || [];
        const list = Array.isArray(players) ? players : [];

        this.playerList = this.uniqueById(list);

        const byTeam = { phoenix: [], eaters: [] };
        for (const p of list) {
          const team = this._teamKey(p.team);
          byTeam[team === 'phoenix' ? 'phoenix' : 'eaters'].push(p);
        }

        if (this.optional.teamACount) this.optional.teamACount.textContent = String(byTeam.phoenix.length);
        if (this.optional.teamBCount) this.optional.teamBCount.textContent = String(byTeam.eaters.length);

        const makeRow = (p) => {
          const hpText = (typeof p.hp === 'number' && typeof p.maxHp === 'number')
            ? ` / HP ${p.hp}/${p.maxHp}`
            : (typeof p.hp === 'number' ? ` / HP ${p.hp}` : '');
          const name = this.escapeHtml(p.name ?? '플레이어');
          const atk = p.stats?.atk ?? p.atk ?? '-';
          const def = p.stats?.def ?? p.def ?? '-';
          const agi = p.stats?.agi ?? p.agi ?? '-';
          const luk = p.stats?.luk ?? p.luk ?? '-';

          const row = document.createElement('div');
          row.className = 'player-row';
          row.innerHTML = `
            <div>
              <span class="badge">${name}</span>
              <span class="stat">공격 ${this.escapeHtml(atk)} / 방어 ${this.escapeHtml(def)} / 민첩 ${this.escapeHtml(agi)} / 행운 ${this.escapeHtml(luk)}${hpText}</span>
            </div>
            <div class="btn-row">
              <button class="btn ghost" data-action="kick" data-id="${this.escapeHtml(p.id || '')}" data-name="${name}">제거</button>
            </div>
          `;
          row.querySelector('[data-action="kick"]')?.addEventListener('click', async () => {
            const id = p.id;
            if (!id || !this.currentBattleId) return;
            if (!confirm(`플레이어 "${p.name}"을(를) 제거하시겠습니까?`)) return;
            try {
              await this.fetchJSON(`/api/battles/${encodeURIComponent(this.currentBattleId)}/players/${encodeURIComponent(id)}`, {
                method: 'DELETE'
              });
              this.addLog('system', `플레이어 제거: ${p.name}`);
              this.showToast('플레이어 제거됨', 'success');
            } catch (err) {
              this.addLog('error', '플레이어 제거 실패: ' + err.message);
              this.showToast('플레이어 제거 실패', 'error');
            }
          });
          return row;
        };

        byTeam.phoenix.forEach((p) => phoenixHost.appendChild(makeRow(p)));
        byTeam.eaters.forEach((p) => eatersHost.appendChild(makeRow(p)));
      }

      updateTeamRoster() {
        this.renderRoster({ players: this.playerList });
      }

      appendChat(sender, message) {
        const box = this.el.chatMessages;
        if (!box) return;
        const item = document.createElement('div');
        item.className = 'chat-item';
        const t = new Date();
        const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
        item.innerHTML = `<span class="time">${time}</span><span class="type">${this.escapeHtml(sender)}</span><span class="msg">${this.escapeHtml(message)}</span>`;
        box.appendChild(item);
        box.scrollTop = box.scrollHeight;
      }

      addLog(type, message) {
        const box = this.el.battleLog;
        const t = new Date();
        const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
        if (box) {
          const item = document.createElement('div');
          item.className = 'log-item';
          item.innerHTML = `<span class="time">${time}</span><span class="type">${this.escapeHtml(type)}</span><span class="msg">${this.escapeHtml(message)}</span>`;
          box.appendChild(item);
          box.scrollTop = box.scrollHeight;
        } else {
          console.log(`[${time}] [${type}] ${message}`);
        }
      }

      showToast(msg) {
        const el = this.el.toast;
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
      }

      /* ============ 채팅 ============ */
      sendChat() {
        const input = this.el.chatInput;
        if (!input) return;
        const v = input.value.trim();
        if (!v) return;

        if (this.socket?.connected && this.isAuthenticated) {
          this.sendSocketMessage('chatMessage', { role: 'admin', message: v, battleId: this.currentBattleId });
        }
        this.appendChat('관리자', v);
        input.value = '';
      }

      /* ============ Helpers ============ */
      _teamKey(t) {
        const s = String(t || '').toLowerCase();
        if (['phoenix', 'a', 'team1'].includes(s)) return 'phoenix';
        if (['eaters', 'b', 'death', 'team2'].includes(s)) return 'eaters';
        return s || 'phoenix';
      }

      uniqueById(array) {
        const seen = new Map();
        (array || []).forEach((item) => {
          const key = (item && (item.id || item.playerId || item.name)) || Math.random().toString(36).slice(2);
          if (!seen.has(key)) seen.set(key, item);
        });
        return Array.from(seen.values());
      }

      escapeHtml(unsafe) {
        const div = document.createElement('div');
        div.textContent = String(unsafe ?? '');
        return div.innerHTML;
      }

      /* ============ 종료/정리 ============ */
      cleanup() {
        this.stopHeartbeat();
        this.stopSync();
        if (this._metricsTimer) clearInterval(this._metricsTimer);
        if (this.socket) { try { this.socket.disconnect(); } catch {} }
      }
    }

    // Bootstrap
    let adminInterface;
    document.addEventListener('DOMContentLoaded', () => {
      adminInterface = new EnhancedAdminInterface();
    });
    window.addEventListener('load', () => {
      window.adminInterface = adminInterface;
    });
  </script>
</body>
</html>
