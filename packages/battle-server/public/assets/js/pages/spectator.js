// PYXIS Spectator Page – 이펙트/응원 연동 (디자인/컬러 유지)
class PyxisSpectator {
  constructor(){
    this.currentBattleId = null;
    this.spectatorName = null;
    this.joined = false;
    this.init();
  }

  init(){
    this.setupEls();
    this.setupEvents();
    this.setupSocket();

    PyxisSocket.init();
    PyxisFX.mount();
    PyxisFX.enhanceClicks(document);
  }

  setupEls(){
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    this.loginFormWrap = UI.$('#loginForm');
    this.loginForm = UI.$('#spectatorLoginForm');
    this.spectatorNameInput = UI.$('#spectatorName');

    this.phoenixMembers = UI.$('#phoenixMembers');
    this.deathMembers   = UI.$('#deathMembers');
    this.battleLog      = UI.$('#battleLog');

    this.battlePhaseEl  = UI.$('#battlePhase');
    this.battleInfoEl   = UI.$('#battleInfo');
    this.currentTurnEl  = UI.$('#currentTurn');

    this.cheerButtons = UI.$$('.cheer-btn');
    this.spectatorArea = UI.$('#spectatorArea');
  }

  setupEvents(){
    this.loginForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      const url = new URL(location.href);
      const battle = url.searchParams.get('battle');
      const otp    = url.searchParams.get('token');
      const name   = this.spectatorNameInput.value.trim() || '관전자';
      if (!battle || !otp) return UI.error('잘못된 관전 링크입니다');
      this.currentBattleId = battle; this.spectatorName = name;
      PyxisSocket.authenticateAsSpectator(battle, otp, name).catch(err=> UI.error(err.message));
    });

    this.cheerButtons.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if (!this.currentBattleId) return;
        const phrase = btn.getAttribute('data-cheer');
        PyxisSocket.sendCheer(phrase, this.currentBattleId);
        PyxisFX.vibrate(15);
      });
    });
  }

  setupSocket(){
    PyxisSocket.on('connection:success', ()=>{
      this.connectionDot.classList.add('active');
      this.connectionText.textContent = '연결됨';
    });
    PyxisSocket.on('connection:disconnect', ()=>{
      this.connectionDot.classList.remove('active');
      this.connectionText.textContent = '연결 끊김';
    });

    PyxisSocket.on('authSuccess', (data)=>{
      this.joined = true;
      UI.hide(this.loginFormWrap);
      UI.show(this.spectatorArea);
      this.handleStateUpdate(data.state || data.battle);
      UI.success('관전 시작!');
      PyxisFX.startBattleTimer(60*60*1000); // 관전자도 표시
    });

    PyxisSocket.on('state:update', (s)=> this.handleStateUpdate(s));
    PyxisSocket.on('state',        (s)=> this.handleStateUpdate(s));

    PyxisSocket.on('phase:change', (phase)=>{
      this.addLog(`▶︎ 턴 전환: ${(phase.phase==='A'||phase.phase==='team1')?'불사조 기사단':'죽음을 먹는 자들'} (라운드 ${phase.round})`, 'system');
    });

    PyxisSocket.on('action:success', (r)=> this.handleActionFX(r));
    PyxisSocket.on('actionSuccess',   (r)=> this.handleActionFX(r));

    PyxisSocket.on('log:new', (ev)=> ev?.text && this.addLog(ev.text, ev.type||'action'));
  }

  handleStateUpdate(s){
    if (!s) return;
    const all = Object.values(s.players||{});
    const A = all.filter(p=> p.team==='A'||p.team==='team1');
    const B = all.filter(p=> p.team==='B'||p.team==='team2');

    const render = (wrap, list)=>{
      wrap.innerHTML = '';
      if (list.length===0){
        wrap.innerHTML = `<div class="loading">플레이어를 불러오는 중...</div>`;
        return;
      }
      list.forEach(p=>{
        const row = document.createElement('div');
        row.className = `player-card ${p.alive===false?'defeated':''}`;
        row.dataset.playerId = p.id;
        const pct = UI.calculateHpPercent(p.hp, p.maxHp||100);
        row.innerHTML = `
          <div class="player-avatar" ${p.avatar?`style="background-image:url(${p.avatar})"`:''}></div>
          <div class="player-info">
            <div class="player-name">${p.name}${p.alive===false?' (불능)':''}</div>
            <div class="player-hp"><div class="player-hp-fill" style="width:${pct}%"></div></div>
            <div class="player-stats">공격 ${p.atk} · 방어 ${p.def} · 민첩 ${p.agi} · 행운 ${p.luk}</div>
          </div>
        `;
        wrap.appendChild(row);
      });
    };
    render(this.phoenixMembers, A);
    render(this.deathMembers,   B);

    const statusText = {waiting:'전투 대기 중', active:'전투 진행 중', ended:'전투 종료'};
    this.battlePhaseEl.textContent = statusText[s.status] || '전투 상황';
  }

  handleActionFX(res){
    const targetEl = document.querySelector(`.player-card[data-player-id="${res.targetPid}"]`);
    if (res.type==='attack'){
      if (res.dodge) PyxisFX.showDodge(targetEl);
      else PyxisFX.showHit(targetEl, res.damage||0, {crit:!!res.crit, blocked:!!res.block});
    } else if (res.type==='useItem'){
      if (res.item==='디터니') PyxisFX.showHeal(targetEl, res.healed||10);
      else PyxisFX.sparkAt(targetEl, {ring:true});
    } else if (res.type==='defend'){
      PyxisFX.sparkAt(targetEl, {ring:true});
    } else if (res.type==='evade'){
      PyxisFX.showDodge(targetEl);
    }
  }

  addLog(text, type='info'){
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    row.innerHTML = `<span class="log-time">${UI.formatTime(Date.now())}</span><span class="log-content">${text}</span>`;
    this.battleLog.appendChild(row);
    UI.scrollToBottom(this.battleLog);
    while (this.battleLog.children.length > 100) this.battleLog.removeChild(this.battleLog.firstChild);
  }
}
document.addEventListener('DOMContentLoaded', ()=> window.spectator = new PyxisSpectator());