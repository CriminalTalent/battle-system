/* 전투 화면 공용 UI 도우미 (admin / player / spectator)
   - 팀 표시 이름, 중앙 무대(현재 플레이어/대기 이미지), 승리 안내
   - 외부 이미지 없이 인라인 SVG만 사용 */
(function () {
  // 기본 팀 이름. 서버 스냅샷의 teamNames가 오면 applyTeamNames로 갱신
  const TEAM_NAMES = { A: 'A팀', B: 'B팀' };
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

  // 대기 이미지: 모래시계 (색은 CSS 토큰을 따라 라이트/다크 자동 전환)
  const WAIT_SVG = `
<svg viewBox="0 0 100 120" aria-hidden="true">
  <g class="hg-turn">
    <path class="hg-glass" d="M30 18 H70 C70 40 56 50 52 60 C56 70 70 80 70 102 H30 C30 80 44 70 48 60 C44 50 30 40 30 18 Z"/>
    <path class="hg-sand" d="M38 30 H62 C60 40 54 46 50 50 C46 46 40 40 38 30 Z"/>
    <path class="hg-sand" d="M36 100 C38 88 44 84 50 82 C56 84 62 88 64 100 Z"/>
    <line class="hg-stream" x1="50" y1="54" x2="50" y2="82"/>
  </g>
  <path class="hg-frame" d="M24 14 H76 M24 106 H76"/>
</svg>`;

  const TROPHY_SVG = `
<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true">
  <path class="trophy-line" d="M19 14H9c0 8 4.5 13 11 13M45 14h10c0 8-4.5 13-11 13"/>
  <path class="trophy-cup" d="M18 8h28v12c0 9-6 16-14 16S18 29 18 20z"/>
  <rect class="trophy-cup" x="28.5" y="35" width="7" height="10" rx="1"/>
  <rect class="trophy-cup" x="19" y="45" width="26" height="8" rx="2.5"/>
  <path class="trophy-star" d="M32 13l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z"/>
</svg>`;

  const DRAW_SVG = `
<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true">
  <path class="draw-line" d="M14 50 L42 14 M50 50 L22 14"/>
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
        <div class="stage-waiting">${WAIT_SVG}<div class="wait-label"></div><div class="wait-sub"></div></div>`;
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
    wait.querySelector('.wait-sub').textContent = battle?.round && battle.status !== 'waiting' ? `${battle.round}라운드` : '';
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

    box.innerHTML = `
      ${w ? TROPHY_SVG : DRAW_SVG}
      <div class="game-over-title">전투 종료</div>
      <div class="game-over-winner">${w ? `${esc(TEAM_NAMES[w])} 승리!` : '무승부'}</div>
      <div class="game-over-detail">${detail}</div>
      ${opts.closable === false ? '' : '<button type="button" class="game-over-close">결과 닫기</button>'}`;
    const close = box.querySelector('.game-over-close');
    if (close) close.addEventListener('click', () => { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); });
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function winnerText(winner) {
    return winner === 'A' || winner === 'B' ? `${TEAM_NAMES[winner]} 승리` : '무승부';
  }

  // ── 테마 (라이트/다크) ──
  const THEME_KEY = 'battle-theme';
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function setTheme(t) {
    const v = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', v);
    try { localStorage.setItem(THEME_KEY, v); } catch (_) {}
    document.querySelectorAll('.theme-toggle').forEach(b => {
      b.setAttribute('aria-label', v === 'dark' ? '밝은 화면으로' : '어두운 화면으로');
      b.title = b.getAttribute('aria-label');
    });
  }
  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light'));
  })();
  document.addEventListener('DOMContentLoaded', () => {
    setTheme(currentTheme());
    document.querySelectorAll('.theme-toggle').forEach(b => b.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')));
  });

  // ── 상단 상태 칩 ──
  const STATUS_TEXT = { waiting: '대기 중', active: '진행 중', paused: '일시정지', ended: '종료' };
  function renderChips(battle) {
    document.querySelectorAll('[data-battle-chips]').forEach(box => {
      const s = battle?.status;
      const parts = [`<span class="chip ${s || ''}"><span class="dot"></span>${esc(STATUS_TEXT[s] || '연결 중')}</span>`];
      if (battle?.round) parts.push(`<span class="chip">${battle.round | 0}라운드</span>`);
      if (battle?.mode) parts.push(`<span class="chip">${esc(battle.mode)}</span>`);
      box.innerHTML = parts.join('');
    });
  }

  window.BattleUI = { TEAM_NAMES, teamName, applyTeamNames, renderStage, hpClass, fillVictory, winnerText, setTheme, renderChips };
})();
