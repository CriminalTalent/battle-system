<!-- packages/battle-server/public/pages/spectator.html -->
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>관전자 - PYXIS 전투</title>
  <link rel="stylesheet" href="/assets/css/style.css" />
  <script defer src="/assets/js/spectator.js"></script>
</head>
<body>
  <header class="pyxis-header">
    <div class="connection-status">
      <span id="connectionDot" class="status-dot"></span>
      <span id="connectionText">연결 확인 중...</span>
    </div>
    <h1>PYXIS 관전자 모드</h1>
  </header>

  <main class="spectator-container">

    <!-- 인증 섹션 -->
    <section id="loginForm">
      <h2>관전자 인증</h2>
      <form id="spectatorLoginForm">
        <input type="text" id="spectatorName" placeholder="이름 입력" required maxlength="20" />
        <button type="submit">입장하기</button>
      </form>
    </section>

    <!-- 전투 관전 화면 -->
    <section id="spectatorArea" style="display: none;">
      <div class="battle-meta">
        <div id="battlePhase">전투 상태</div>
        <div id="battleInfo"></div>
        <div id="currentTurn">현재 턴: -</div>
      </div>

      <div class="teams-container">
        <div class="team-wrap">
          <h3>불사조 기사단</h3>
          <div id="phoenixMembers" class="team-list"></div>
        </div>
        <div class="team-wrap">
          <h3>죽음을 먹는 자들</h3>
          <div id="deathMembers" class="team-list"></div>
        </div>
      </div>

      <section class="cheer-section">
        <h3>응원하기</h3>
        <div class="cheer-buttons">
          <button class="cheer-btn" data-cheer="힘내라!">힘내라!</button>
          <button class="cheer-btn" data-cheer="최고야!">최고야!</button>
          <button class="cheer-btn" data-cheer="역전 가자!">역전 가자!</button>
          <button class="cheer-btn" data-cheer="죽으면 죽어!">죽으면 죽어!</button>
        </div>
      </section>

      <section class="log-section">
        <h3>전투 로그</h3>
        <div id="battleLog" class="log-container"></div>
      </section>
    </section>
  </main>
</body>
</html>
