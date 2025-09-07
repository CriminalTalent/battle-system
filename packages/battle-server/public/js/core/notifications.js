<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>PYXIS 향상된 디자인 시스템</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- Enhanced Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800&family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    /* ═══════════════════════════════════════════════════════════════════════════════════════════
       PYXIS Battle System - Enhanced Celestial Design System
       우아하고 신비로운 천체 테마의 전투 시스템 UI
       ═══════════════════════════════════════════════════════════════════════════════════════════ */

    /* Reset & Foundation */
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    /* Design Tokens - Celestial Theme */
    :root {
      --deep-space: #000815;
      --dark-navy: #001329;
      --navy-medium: #002242;
      --navy-light: #003055;

      --gold-bright: #DCC7A2;
      --gold-warm: #D4BA8D;
      --gold-soft: #C8AE7A;

      --star-white: #F8F6F0;
      --star-silver: #E8E4DC;
      --star-pale: #D8D2C8;

      --surface-void: var(--deep-space);
      --surface-deep: rgba(0, 19, 41, 0.85);
      --surface-medium: rgba(0, 34, 66, 0.75);
      --surface-light: rgba(0, 48, 85, 0.65);
      --surface-glow: rgba(220, 199, 162, 0.08);

      --border-constellation: 1px solid rgba(220, 199, 162, 0.25);
      --border-starlight: 1px solid rgba(220, 199, 162, 0.4);

      --font-celestial: 'Cinzel', 'Playfair Display', serif;
      --font-constellation: 'Playfair Display', serif;
      --font-stellar: 'Inter', sans-serif;

      --space-nebula: 4px;
      --space-star: 8px;
      --space-asteroid: 12px;
      --space-planet: 16px;
      --space-moon: 24px;
      --space-orbit: 32px;
      --space-galaxy: 48px;

      --blur-stardust: blur(12px);
      --blur-nebula: blur(8px);
      --shadow-constellation: 0 8px 32px rgba(0, 0, 0, 0.6);
      --shadow-stellar: 0 16px 48px rgba(0, 0, 0, 0.7);

      --radius-star: 6px;
      --radius-planet: 12px;
      --radius-nebula: 18px;
      --radius-galaxy: 24px;

      --time-stellar: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      --time-constellation: 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    /* Body & Background */
    html, body { height: 100%; overflow-x: hidden; }
    body {
      font-family: var(--font-stellar);
      color: var(--star-white);
      background:
        radial-gradient(2px 2px at 20px 30px, rgba(220,199,162,.3), transparent),
        radial-gradient(2px 2px at 40px 70px, rgba(220,199,162,.2), transparent),
        radial-gradient(1px 1px at 90px 40px, rgba(220,199,162,.4), transparent),
        radial-gradient(1px 1px at 130px 80px, rgba(220,199,162,.3), transparent),
        radial-gradient(2px 2px at 160px 30px, rgba(220,199,162,.2), transparent),
        radial-gradient(1200px 800px at 50% -200px, rgba(220,199,162,.12), transparent 50%),
        radial-gradient(800px 600px at 80% 100%, rgba(0,48,85,.15), transparent 50%),
        linear-gradient(180deg, var(--deep-space) 0%, var(--dark-navy) 30%, var(--navy-medium) 60%, var(--navy-light) 100%);
      background-size: 200px 100px, 180px 120px, 220px 110px, 190px 140px, 210px 90px, 100% 100%, 100% 100%, 100% 100%;
      min-height: 100vh;
      position: relative;
    }

    /* ===== Scoped PYXIS Header (no emojis) ===== */
    .pyxis-header {
      --ph-gold-bright:#DCC7A2; --ph-gold-warm:#D4BA8D;
      position: relative;
      padding: 48px 32px;
      text-align: center;
      color: #F8F6F0;
      background: linear-gradient(135deg, rgba(220,199,162,.08) 0%, rgba(0,34,66,.4) 50%, rgba(220,199,162,.06) 100%);
      border-bottom: 1px solid rgba(220,199,162,.25);
      backdrop-filter: blur(8px);
      overflow: hidden;
      isolation: isolate;
    }
    .pyxis-header::before{
      content:""; position:absolute; inset:-50%;
      background: conic-gradient(from 0deg,
        rgba(220,199,162,.10) 0deg, transparent 60deg,
        rgba(220,199,162,.06) 120deg, transparent 180deg,
        rgba(220,199,162,.08) 240deg, transparent 300deg,
        rgba(220,199,162,.10) 360deg);
      animation: ph-rotate 30s linear infinite; z-index:-1; pointer-events:none;
    }
    .pyxis-header::after{
      content:""; position:absolute; inset:0;
      background:
        radial-gradient(2px 2px at 20% 30%, rgba(220,199,162,.35), transparent 60%),
        radial-gradient(1.5px 1.5px at 70% 40%, rgba(220,199,162,.25), transparent 60%),
        radial-gradient(1.5px 1.5px at 40% 75%, rgba(220,199,162,.30), transparent 60%),
        radial-gradient(1px 1px at 85% 65%, rgba(220,199,162,.25), transparent 60%),
        radial-gradient(2px 2px at 10% 80%, rgba(220,199,162,.20), transparent 60%);
      opacity:.65; filter: drop-shadow(0 0 12px rgba(220,199,162,.25));
      z-index:-1; pointer-events:none;
    }
    @keyframes ph-rotate{ from{transform:rotate(0)} to{transform:rotate(360deg)} }
    .pyxis-header__title-wrap{ display:inline-flex; align-items:center; gap:18px }
    .pyxis-header__bar{ width:28px; height:2px; background:linear-gradient(90deg,transparent,var(--ph-gold-bright),transparent);
      opacity:.8; transform-origin:center; animation: ph-pulse 2.2s ease-in-out infinite; }
    .pyxis-header__bar--right{ animation-delay:1.1s }
    @keyframes ph-pulse{ 0%{transform:scaleX(.85);opacity:.55} 50%{transform:scaleX(1.15);opacity:1} 100%{transform:scaleX(.85);opacity:.55} }
    .pyxis-header__title{
      font-family:'Cinzel','Playfair Display',serif; font-weight:800;
      letter-spacing:.15em; font-size: clamp(2rem,4vw,3.5rem); line-height:1.1; margin:0 0 12px;
      background: linear-gradient(135deg, var(--gold-bright), #fff, var(--gold-warm));
      -webkit-background-clip:text; background-clip:text; color:transparent;
      text-shadow:0 0 24px rgba(220,199,162,.25);
    }
    .pyxis-header__subtitle{
      font-family:'Playfair Display',serif; font-weight:700; font-size:.9rem;
      letter-spacing:.30em; text-transform:uppercase; color: var(--ph-gold-warm); opacity:.95;
    }
    @media (max-width:768px){ .pyxis-header{padding:36px 20px} .pyxis-header__subtitle{letter-spacing:.22em} }

    /* Container & Layouts */
    .container { max-width: 1600px; margin: 0 auto; padding: var(--space-orbit); }
    .admin-layout {
      display: grid; grid-template-columns: 400px 1fr 380px;
      gap: var(--space-moon); min-height: calc(100vh - 200px);
    }
    .player-layout { display: grid; grid-template-columns: 300px 1fr 340px; gap: var(--space-moon); }

    .spectator-layout { display: grid; grid-template-columns: 400px 1fr; gap: var(--space-moon); }

    /* Panels */
    .panel {
      background: linear-gradient(135deg, var(--surface-deep) 0%, var(--surface-medium) 100%);
      border: var(--border-constellation);
      border-radius: var(--radius-nebula);
      box-shadow: var(--shadow-constellation);
      backdrop-filter: var(--blur-stardust);
      overflow: hidden; position: relative; transition: var(--time-stellar);
    }
    .panel::before {
      content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background: linear-gradient(90deg, transparent 0%, var(--gold-bright) 50%, transparent 100%); opacity:.6;
    }
    .panel:hover { border-color: rgba(220,199,162,.5); box-shadow: var(--shadow-stellar); transform: translateY(-2px); }
    .panel-header {
      padding: var(--space-planet);
      background: linear-gradient(135deg, var(--surface-glow) 0%, rgba(0,34,66,.3) 100%);
      border-bottom: var(--border-constellation);
    }
    .panel-title {
      font-family: var(--font-constellation);
      font-size: 1.125rem; font-weight: 700; color: var(--gold-bright); letter-spacing: .05em; margin: 0;
    }
    .panel-body { padding: var(--space-moon); }

    /* Buttons */
    .btn {
      display:inline-flex; align-items:center; justify-content:center; gap: var(--space-star);
      padding: var(--space-asteroid) var(--space-planet); font-family: var(--font-stellar);
      font-size:.875rem; font-weight:600; border: var(--border-constellation); border-radius: var(--radius-planet);
      background: linear-gradient(135deg, var(--surface-light) 0%, var(--surface-medium) 100%);
      color: var(--star-white); cursor:pointer; transition: var(--time-stellar); position:relative; overflow:hidden; text-decoration:none;
    }
    .btn::before{
      content:''; position:absolute; top:0; left:-100%; width:100%; height:100%;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,.1) 50%, transparent 100%);
      transition: var(--time-constellation);
    }
    .btn:hover { border-color: var(--gold-bright); background: linear-gradient(135deg, var(--surface-medium) 0%, var(--surface-light) 100%); }
    .btn:hover::before{ left:100%; }
    .btn-primary {
      background: linear-gradient(135deg, var(--gold-warm) 0%, var(--gold-bright) 100%);
      color: var(--deep-space); border-color: var(--gold-bright);
    }

    /* Forms */
    .form-group { margin-bottom: var(--space-planet); }
    .form-label { display:block; font-size:.875rem; font-weight:600; color:var(--star-silver); margin-bottom: var(--space-star); letter-spacing:.025em; }
    .form-input, .form-select, .form-textarea {
      width:100%; padding: var(--space-asteroid) var(--space-planet);
      background: rgba(0,19,41,.6); border: var(--border-constellation); border-radius: var(--radius-planet);
      color: var(--star-white); font-family: var(--font-stellar); font-size:.875rem; backdrop-filter: var(--blur-nebula);
      transition: var(--time-stellar);
    }
    .form-input:focus, .form-select:focus, .form-textarea:focus {
      outline:none; border-color: var(--gold-bright);
      box-shadow: 0 0 0 1px rgba(220,199,162,.3); background: rgba(0,19,41,.8);
    }
    .form-input::placeholder { color: var(--star-pale); opacity:.7; }

    /* Status */
    .status-badge{
      display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:50px;
      font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em; position:relative;
    }
    .status-badge::before{ content:''; width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 8px currentColor; }
    .status-waiting{ background: rgba(251,191,36,.2); color:#FBBF24; border:1px solid rgba(251,191,36,.3) }
    .status-active{ background: rgba(34,197,94,.2); color:#22C55E; border:1px solid rgba(34,197,94,.3) }
    .status-finished{ background: rgba(248,113,113,.2); color:#F87171; border:1px solid rgba(248,113,113,.3) }

    /* Demo cards */
    .demo-grid{ display:grid; grid-template-columns: repeat(auto-fit, minmax(300px,1fr)); gap: var(--space-moon); margin-top: var(--space-galaxy); }
    .demo-battle-card{
      background: linear-gradient(135deg, rgba(220,199,162,.1) 0%, rgba(0,34,66,.4) 100%);
      border: var(--border-starlight); border-radius: var(--radius-nebula); padding: var(--space-moon); position:relative; overflow:hidden;
    }
    .card-title{ font-family: var(--font-constellation); font-size:1.25rem; font-weight:700; color:var(--gold-bright); margin-bottom: var(--space-planet); }
    .card-content{ color: var(--star-silver); line-height:1.6; margin-bottom: var(--space-planet); }

    /* Responsive */
    @media (max-width:1200px){
      .admin-layout, .player-layout { grid-template-columns:1fr; gap: var(--space-planet); }
      .spectator-layout { grid-template-columns:1fr; }
    }
    @media (max-width:768px){
      .container{ padding: var(--space-planet); }
    }

    /* A11y */
    .btn:focus-visible, .form-input:focus-visible, .form-select:focus-visible, .form-textarea:focus-visible {
      outline:2px solid var(--gold-bright); outline-offset:2px;
    }
  </style>
</head>

<body>
  <!-- Scoped Design Header (no emojis) -->
  <header class="pyxis-header">
    <div class="pyxis-header__title-wrap">
      <span class="pyxis-header__bar"></span>
      <h1 class="pyxis-header__title">PYXIS</h1>
      <span class="pyxis-header__bar pyxis-header__bar--right"></span>
    </div>
    <p class="pyxis-header__subtitle">BATTLE SYSTEM</p>
  </header>

  <!-- Main Container -->
  <div class="container">
    <!-- Admin-style Demo Layout -->
    <div class="admin-layout">
      <!-- Left: Battle Control -->
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">전투 제어</h3>
        </div>
        <div class="panel-body">
          <div class="form-group">
            <label class="form-label">전투 모드</label>
            <select class="form-select">
              <option>1v1</option>
              <option>2v2</option>
              <option>3v3</option>
              <option>4v4</option>
            </select>
          </div>

          <div class="form-group">
            <button class="btn btn-primary" style="width:100%;">전투 생성</button>
          </div>

          <div class="form-group">
            <button class="btn" style="width:100%;">전투 시작</button>
          </div>

          <div style="margin-top: var(--space-moon);">
            <div class="status-badge status-waiting">대기 중</div>
          </div>
        </div>
      </div>

      <!-- Center: Battle Status -->
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">전투 현황</h3>
        </div>
        <div class="panel-body">
          <div class="demo-grid" style="margin-top:0;">
            <div class="demo-battle-card">
              <h4 class="card-title">불사조 기사단</h4>
              <p class="card-content">팀 A - 4명의 용사들이 준비되었습니다.</p>
              <div class="status-badge status-active">활성화</div>
            </div>

            <div class="demo-battle-card">
              <h4 class="card-title">죽음을 먹는 자들</h4>
              <p class="card-content">팀 B - 전투 준비 완료</p>
              <div class="status-badge status-waiting">대기 중</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Chat & Logs -->
      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">실시간 로그</h3>
        </div>
        <div class="panel-body">
          <div style="height: 200px; overflow-y: auto; padding: var(--space-planet); background: rgba(0, 19, 41, 0.3); border-radius: var(--radius-star); margin-bottom: var(--space-planet);">
            <p style="font-size: .75rem; color: var(--star-pale); margin-bottom: var(--space-star);">[12:34] 전투 시스템 초기화 완료</p>
            <p style="font-size: .75rem; color: var(--star-pale); margin-bottom: var(--space-star);">[12:35] 플레이어 연결: 아서</p>
            <p style="font-size: .75rem; color: var(--gold-bright); margin-bottom: var(--space-star);">[12:36] 전투 준비 완료</p>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <input type="text" class="form-input" placeholder="메시지를 입력하세요...">
          </div>
        </div>
      </div>
    </div>

    <!-- Demo Cards -->
    <div class="demo-grid">
      <div class="demo-battle-card">
        <h4 class="card-title">관리자 콘솔</h4>
        <p class="card-content">전투 생성, 플레이어 관리, 실시간 모니터링이 가능한 관리자 전용 인터페이스입니다.</p>
        <button class="btn btn-primary">관리자 로그인</button>
      </div>

      <div class="demo-battle-card">
        <h4 class="card-title">플레이어 모드</h4>
        <p class="card-content">몰입감 있는 전투 인터페이스와 직관적인 조작으로 빠르게 전투에 참여할 수 있습니다.</p>
        <button class="btn">자세히 보기</button>
      </div>

      <div class="demo-battle-card">
        <h4 class="card-title">관전자 모드</h4>
        <p class="card-content">실시간 전투 로그와 팀 현황을 확인하며 경기를 즐길 수 있습니다.</p>
        <button class="btn">관전 가이드</button>
      </div>
    </div>
  </div>
</body>
</html>
