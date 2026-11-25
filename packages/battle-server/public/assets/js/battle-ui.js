/* 전투 화면 공용 UI 도우미 (admin / player / spectator)
   - 팀 표시 이름, 중앙 무대(현재 플레이어/대기 이미지), 승리 안내
   - 외부 이미지 없이 인라인 SVG만 사용 */
(function () {
  // 기본 팀 이름. 서버 스냅샷의 teamNames가 오면 applyTeamNames로 갱신
  const TEAM_NAMES = { A: '불사조 기사단', B: '죽음을 먹는 자' };
  const teamName = t => TEAM_NAMES[t] || String(t ?? '');

  /** 스냅샷의 팀 이름 반영: [data-team-name="A|B"] 요소의 글자를 바꿈 (textContent라 이스케이프 불필요) */
  function applyTeamNames(snap) {
    const n = snap?.teamNames;
    if (n && typeof n === 'object') {
      if (typeof n.A === 'string' && n.A) TEAM_NAMES.A = n.A;
      if (typeof n.B === 'string' && n.B) TEAM_NAMES.B = n.B;
    }
    document.querySelectorAll('[data-team-name]').forEach(el => {
      const v = teamName(el.getAttribute('data-team-name'));
      if (el.textContent !== v) el.textContent = v;
    });
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const WAIT_SVG = `
<svg viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <radialGradient id="wcore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFF4D0"/><stop offset="55%" stop-color="#F5D58A"/><stop offset="100%" stop-color="#C99A3B" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FF5A6E"/><stop offset="50%" stop-color="#F5D58A"/><stop offset="100%" stop-color="#4F8BFF"/>
    </linearGradient>
  </defs>
  <g class="wait-ring"><circle cx="100" cy="100" r="86" fill="none" stroke="url(#wring)" stroke-width="2" stroke-dasharray="4 10" opacity=".8"/></g>
  <g class="wait-ring rev"><circle cx="100" cy="100" r="70" fill="none" stroke="#B98CFF" stroke-width="1.5" stroke-dasharray="22 12" opacity=".7"/></g>
  <circle cx="100" cy="100" r="54" fill="rgba(10,8,30,.85)" stroke="#F5D58A" stroke-width="2"/>
  <g stroke="#F5D58A" stroke-width="2" opacity=".8">
    <line x1="100" y1="50" x2="100" y2="58"/><line x1="100" y1="142" x2="100" y2="150"/>
    <line x1="50" y1="100" x2="58" y2="100"/><line x1="142" y1="100" x2="150" y2="100"/>
  </g>
  <g class="wait-hand"><line x1="100" y1="100" x2="100" y2="62" stroke="#FFE7A8" stroke-width="3" stroke-linecap="round"/></g>
  <circle class="wait-core" cx="100" cy="100" r="16" fill="url(#wcore)"/>
  <path class="wait-spark" d="M30 40 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#FFE7A8"/>
  <path class="wait-spark" d="M168 48 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#B98CFF"/>
  <path class="wait-spark" d="M160 160 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#4F8BFF"/>
  <path class="wait-spark" d="M36 158 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#FF5A6E"/>
</svg>`;

  const TROPHY_SVG = `
<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFF1C2"/><stop offset="100%" stop-color="#C99A3B"/></linearGradient></defs>
  <path d="M18 8h28v12c0 9-6 16-14 16S18 29 18 20z" fill="url(#tg)"/>
  <path d="M18 12H8c0 9 5 14 11 14M46 12h10c0 9-5 14-11 14" fill="none" stroke="url(#tg)" stroke-width="4"/>
  <rect x="28" y="36" width="8" height="10" fill="url(#tg)"/>
  <rect x="18" y="46" width="28" height="8" rx="2" fill="url(#tg)"/>
  <path d="M32 14l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z" fill="#fff" opacity=".85"/>
</svg>`;

  const DRAW_SVG = `
<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M14 50 L42 14 M50 50 L22 14" stroke="#F5D58A" stroke-width="5" stroke-linecap="round"/>
  <circle cx="14" cy="50" r="5" fill="#C99A3B"/><circle cx="50" cy="50" r="5" fill="#C99A3B"/>
</svg>`;

  const PHASE_WAIT_TEXT = {
    resolve: '라운드 해석 중',
    inter: '잠시 휴식 중',
    idle: '전투 시작 대기 중',
  };

  /** 중앙 무대: 현재 플레이어가 있으면 초상(없으면 이니셜), 없으면 대기 이미지 */
  function renderStage(stage, battle) {
    if (!stage) return;
    if (!stage.dataset.ready) {
      stage.innerHTML = `
        <img class="stage-img" alt="현재 플레이어" hidden/>
        <div class="stage-initial" hidden></div>
        <div class="stage-waiting">${WAIT_SVG}<div class="wait-label"></div></div>`;
      const img = stage.querySelector('.stage-img');
      img.addEventListener('error', () => { img.hidden = true; if (img.dataset.name) { const ini = stage.querySelector('.stage-initial'); ini.textContent = img.dataset.name; ini.hidden = false; } });
      stage.dataset.ready = '1';
    }
    const img = stage.querySelector('.stage-img');
    const ini = stage.querySelector('.stage-initial');
    const wait = stage.querySelector('.stage-waiting');
    const cp = battle?.currentTurn?.currentPlayer;
    stage.classList.remove('team-a', 'team-b');

    if (cp && cp.name && battle?.status !== 'ended') {
      if (cp.team === 'A') stage.classList.add('team-a');
      if (cp.team === 'B') stage.classList.add('team-b');
      wait.hidden = true;
      const initial = Array.from(String(cp.name).trim())[0] || '?';
      img.dataset.name = initial;
      if (cp.avatar) {
        if (img.getAttribute('src') !== cp.avatar) img.src = cp.avatar;
        img.hidden = false; ini.hidden = true;
      } else {
        img.hidden = true; img.removeAttribute('src');
        ini.textContent = initial; ini.hidden = false;
      }
      return;
    }
    img.hidden = true; ini.hidden = true; wait.hidden = false;
    let label = PHASE_WAIT_TEXT[battle?.phase] || '대기 중';
    if (battle?.status === 'paused') label = '일시정지';
    else if (battle?.status === 'ended') label = '전투 종료';
    else if (!battle || battle.status === 'waiting') label = '전투 시작 대기 중';
    wait.querySelector('.wait-label').textContent = label;
  }

  /** HP 퍼센트에 따른 막대 색 클래스 */
  function hpClass(pct) { return pct <= 30 ? 'low' : pct <= 60 ? 'mid' : ''; }

  /** 승리 안내 오버레이 내용 채우기 */
  function fillVictory(overlay, winner, battle, opts = {}) {
    if (!overlay) return;
    const box = overlay.querySelector('.game-over-box');
    const players = Array.isArray(battle?.players) ? battle.players : [];
    const sum = t => players.filter(p => p.team === t && p.hp > 0).reduce((s, p) => s + (p.hp | 0), 0);
    const w = winner === 'A' || winner === 'B' ? winner : null;
    const survivors = w ? players.filter(p => p.team === w && p.hp > 0).map(p => esc(p.name)) : [];
    let detail = '';
    if (w) {
      detail += survivors.length ? `생존자 <span class="members">${survivors.join(', ')}</span><br>` : '';
    } else {
      detail += '승패가 가려지지 않았습니다<br>';
    }
    if (players.length) detail += `생존 HP 합계 ${esc(TEAM_NAMES.A)} ${sum('A')} : ${sum('B')} ${esc(TEAM_NAMES.B)}`;
    if (battle?.round) detail += `<br>${battle.round}라운드`;

    overlay.classList.remove('win-a', 'win-b');
    if (w) overlay.classList.add(w === 'A' ? 'win-a' : 'win-b');

    let confetti = '';
    if (w) {
      const colors = ['#F5D58A', '#FFE7A8', w === 'A' ? '#FF5A6E' : '#4F8BFF', w === 'A' ? '#FF9A5A' : '#36E0C8', '#B98CFF'];
      for (let i = 0; i < 36; i++) {
        confetti += `<i style="left:${(i * 37) % 100}%;background:${colors[i % colors.length]};animation-duration:${3 + (i % 5)}s;animation-delay:${(i % 9) * 0.35}s"></i>`;
      }
    }

    box.innerHTML = `
      ${w ? TROPHY_SVG : DRAW_SVG}
      <div class="game-over-title">전투 종료</div>
      <div class="game-over-winner">${w ? `${esc(TEAM_NAMES[w])} 승리!` : '무승부'}</div>
      <div class="game-over-detail">${detail}</div>
      ${opts.closable === false ? '' : '<button type="button" class="game-over-close">결과 닫기</button>'}`;
    let cf = overlay.querySelector('.confetti');
    if (!cf) { cf = document.createElement('div'); cf.className = 'confetti'; overlay.prepend(cf); }
    cf.innerHTML = confetti;
    const close = box.querySelector('.game-over-close');
    if (close) close.addEventListener('click', () => { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); });
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function winnerText(winner) {
    return winner === 'A' || winner === 'B' ? `${TEAM_NAMES[winner]} 승리` : '무승부';
  }

  window.BattleUI = { TEAM_NAMES, teamName, applyTeamNames, renderStage, hpClass, fillVictory, winnerText };
})();
