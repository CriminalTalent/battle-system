// PYXIS Player Page - 이펙트/타이머/오토패스 연동 (디자인/컬러 변경 없음)
class PyxisPlayer {
  constructor() {
    this.currentBattleId = null;
    this.battleState = null;
    this.myPlayerId = null;
    this.myPlayerData = null;
    this.joined = false;

    this.battleTimerStarted = false;

    this.init();
  }

  // 초기화
  init() {
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initFromUrl();

    PyxisSocket.init();
    PyxisFX.mount();
    PyxisFX.enhanceClicks(document);
  }

  // DOM
  setupElements() {
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    this.authSection = UI.$('#authSection');
    this.authForm = UI.$('#authForm');
    this.authBattleId = UI.$('#authBattleId');
    this.authToken = UI.$('#authToken');
    this.authName = UI.$('#authName');

    // 주요 영역
    this.playerInfo = UI.$('#playerInfo');
    this.myNameEl   = UI.$('#myName');
    this.myTeamEl   = UI.$('#myTeam');
    this.statAttack = UI.$('#statAttack');
    this.statDefense= UI.$('#statDefense');
    this.statAgility= UI.$('#statAgility');
    this.statLuck   = UI.$('#statLuck');
    this.myHpFill   = UI.$('#myHpFill');
    this.myHpText   = UI.$('#myHpText');

    // 아이템
    this.itemDittany = UI.$('#itemDittany .item-count');
    this.itemAtkBoost= UI.$('#itemAttackBoost .item-count');
    this.itemDefBoost= UI.$('#itemDefenseBoost .item-count');

    // 액션
    this.btnAttack = UI.$('#btnAttack');
    this.btnDefend = UI.$('#btnDefend');
    this.btnDodge  = UI.$('#btnDodge');
    this.btnUseItem= UI.$('#btnUseItem');
    this.btnPass   = UI.$('#btnPass');
    this.actionArea= UI.$('#actionArea');

    // 채팅/로그
    this.chatMessages = UI.$('#chatMessages');
    this.chatInput    = UI.$('#chatInput');
    this.chatSendBtn  = UI.$('#chatSendBtn');
    this.logViewer    = UI.$('#logViewer');

    // 타겟 선택(전역 TargetSelector도 존재)
    this.targetSelector = window.PyxisTarget;
  }

  // 이벤트
  setupEventListeners() {
    // 인증
    this.authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.authenticate();
    });

    // 액션 버튼
    this.btnAttack.addEventListener('click', () => this.doAttack());
    this.btnDefend.addEventListener('click', () => this.sendAction('defend'));
    this.btnDodge .addEventListener('click', () => this.sendAction('evade'));
    this.btnUseItem.addEventListener('click', () => this.doUseItem());
    this.btnPass  .addEventListener('click', () => this.confirmPass());

    // 채팅
    this.chatSendBtn.addEventListener('click', () => this.sendChat());
    this.chatInput.addEventListener('keypress', (e)=>{ if (e.key==='Enter') this.sendChat(); });

    // 단축키
    document.addEventListener('keydown', (e)=>{
      if (!this.isMyTurn()) return;
      if (this.targetSelector?.isShown()) return;
      const map = { '1':'attack', '2':'defend', '3':'evade', '4':'item', '5':'pass' };
      if (map[e.key]) {
        e.preventDefault();
        if (e.key==='1') this.doAttack();
        if (e.key==='2') this.sendAction('defend');
        if (e.key==='3') this.sendAction('evade');
        if (e.key==='4') this.doUseItem();
        if (e.key==='5') this.confirmPass();
      }
    });

    // 화면 복귀 시 상태 동기화
    document.addEventListener('visibilitychange', ()=>{
      if (!document.hidden && this.joined && this.currentBattleId){
        PyxisSocket.socket.emit('requestState', { battleId: this.currentBattleId });
      }
    });
  }

  // 소켓
  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', ()=>{
      this.connectionDot.classList.add('active');
      this.connectionText.textContent = '연결됨';
    });
    PyxisSocket.on('connection:disconnect', ()=>{
      this.connectionDot.classList.remove('active');
      this.connectionText.textContent = '연결 끊김';
    });

    // 인증
    PyxisSocket.on('authSuccess', (data)=> this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (msg)=> UI.error(`인증 실패: ${msg}`));

    // 상태
    PyxisSocket.on('state:update', (s)=> this.handleStateUpdate(s));
    PyxisSocket.on('state', (s)=> this.handleStateUpdate(s));

    // 턴/페이즈
    PyxisSocket.on('phase:change', (phase)=>{
      this.addLog(`[턴 전환] ${phase.phase==='A'||phase.phase==='team1'?'불사조 기사단':'죽음을 먹는 자들'} (라운드 ${phase.round})`, 'system');
      if (this.isMyTurn()) {
        this.startMyTurnTimer();
      } else {
        PyxisFX.stopTurnTimer();
      }
    });

    // 액션 결과(표준)
    PyxisSocket.on('action:success', (result)=> this.handleActionFX(result));
    PyxisSocket.on('actionSuccess',   (result)=> this.handleActionFX(result));

    // 로그/채팅
    PyxisSocket.on('log:new', (ev)=> ev?.text && this.addLog(ev.text, ev.type||'action'));
    PyxisSocket.on('chat:new', (msg)=> this.renderChat(msg));
  }

  // URL 파라미터
  initFromUrl() {
    const q = new URLSearchParams(location.search);
    const b = q.get('battle'); const t = q.get('token'); const n = q.get('name');
    if (b && t && n){
      this.authBattleId.value = b;
      this.authToken.value = t;
      this.authName.value = decodeURIComponent(n);
      PyxisSocket.on('connection:success', ()=> setTimeout(()=> this.authenticate(), 300));
    } else {
      UI.show(this.authSection);
    }
  }

  // 인증
  async authenticate(){
    const v = UI.validateForm(this.authForm, {
      authBattleId: { required:true, label:'전투 ID' },
      authToken:    { required:true, label:'플레이어 OTP' },
      authName:     { required:true, label:'플레이어 이름' }
    });
    if (!v.valid){ UI.error(v.errors[0]); return; }
    try{
      this.currentBattleId = v.data.authBattleId;
      await PyxisSocket.authenticate({
        role:'player',
        battleId: v.data.authBattleId,
        token: v.data.authToken,
        name: v.data.authName,
        playerId: v.data.authName,
        otp: v.data.authToken
      });
    }catch(e){
      UI.error(`인증 실패: ${e.message}`);
    }
  }

  handleAuthSuccess(data){
    this.joined = true;
    this.battleState = data.state || data.battle;
    this.myPlayerId = data.selfPid || data.playerId || data.player?.id;
    this.myPlayerData = this.myPlayerId && this.battleState?.players ? this.battleState.players[this.myPlayerId] : null;

    UI.hide(this.authSection);
    UI.success('전투 입장 완료!');
    this.renderAll();

    // 전투 타이머 (1시간) – 전투 시작 시점부터
    if (!this.battleTimerStarted){
      PyxisFX.startBattleTimer(60*60*1000);
      this.battleTimerStarted = true;
    }

    // 내 턴이면 5분 타이머 시작
    if (this.isMyTurn()) this.startMyTurnTimer();
  }

  handleStateUpdate(state){
    this.battleState = state;
    if (this.myPlayerId && state?.players) {
      this.myPlayerData = state.players[this.myPlayerId] || this.myPlayerData;
    }
    this.renderAll();

    if (this.isMyTurn()) this.startMyTurnTimer();
    else PyxisFX.stopTurnTimer();
  }

  // 렌더
  renderAll(){
    if (!this.battleState || !this.myPlayerData) return;

    // 내 정보
    this.myNameEl.textContent = this.myPlayerData.name || '-';
    this.myTeamEl.textContent = UI.getTeamName(this.myPlayerData.team);

    const s = this.myPlayerData.stats || {
      attack:this.myPlayerData.atk,
      defense:this.myPlayerData.def,
      agility:this.myPlayerData.agi,
      luck:this.myPlayerData.luk
    };
    this.statAttack.textContent = s.attack ?? this.myPlayerData.atk ?? 0;
    this.statDefense.textContent= s.defense?? this.myPlayerData.def ?? 0;
    this.statAgility.textContent= s.agility?? this.myPlayerData.agi ?? 0;
    this.statLuck.textContent   = s.luck   ?? this.myPlayerData.luk ?? 0;

    const hpPct = UI.calculateHpPercent(this.myPlayerData.hp, this.myPlayerData.maxHp||100);
    this.myHpFill.style.width = `${hpPct}%`;
    this.myHpText.textContent = `${this.myPlayerData.hp}/${this.myPlayerData.maxHp||100}`;

    // 아이템
    const items = this.myPlayerData.items || {};
    this.itemDittany.textContent = items.dittany ?? items.Dittany ?? 0;
    this.itemAtkBoost.textContent= items.atkBoost ?? 0;
    this.itemDefBoost.textContent= items.defBoost ?? 0;

    // 버튼 활성
    const canAct = this.isMyTurn() && this.myPlayerData.alive !== false;
    [this.btnAttack,this.btnDefend,this.btnDodge,this.btnUseItem,this.btnPass].forEach(b=> b.disabled = !canAct);
  }

  // 채팅/로그
  renderChat(message){
    const el = document.createElement('div');
    el.className = `chat-message ${message.type || (message.scope==='team'?'team':'')}`;
    el.innerHTML = `
      <span class="chat-time">${UI.formatTime(message.ts||Date.now())}</span>
      <span class="chat-content">${message.type==='system'
        ? `[시스템] ${message.text}`
        : `${message.scope==='team'?'[팀] ':'[전체] '}${(message.from?.nickname || message.nickname || '익명')}: ${message.text}`}</span>
    `;
    this.chatMessages.appendChild(el);
    UI.scrollToBottom(this.chatMessages);
    while (this.chatMessages.children.length > 100) this.chatMessages.removeChild(this.chatMessages.firstChild);
  }
  addLog(text, type='info'){
    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    row.innerHTML = `<span class="time">${UI.formatTime(Date.now())}</span><span class="content">${text}</span>`;
    this.logViewer.appendChild(row);
    UI.scrollToBottom(this.logViewer);
    while (this.logViewer.children.length > 100) this.logViewer.removeChild(this.logViewer.firstChild);
  }

  // 턴/타이머
  isMyTurn(){
    const cur = this.battleState?.turn?.pending?.[0] || this.battleState?.turn?.actor;
    return !!(cur && cur === this.myPlayerId && this.myPlayerData?.alive !== false);
  }
  startMyTurnTimer(){
    // 액션 영역 상단에 붙여서 표기
    PyxisFX.attachTurnTimer(this.actionArea, ()=> this.autoPass());
    PyxisFX.startTurnTimer(5*60*1000); // 5분
    // 햅틱 + 토스트
    PyxisFX.vibrate([40,40,40]);
    UI.info('당신의 턴입니다! (5분 제한)');
  }
  async autoPass(){
    if (!this.isMyTurn()) return; // 이미 턴이 넘어갔으면 무시
    UI.warning('5분 경과로 자동 패스됩니다');
    await this.sendAction('pass');
  }
  confirmPass(){
    if (confirm('정말로 턴을 넘기시겠습니까?')) this.sendAction('pass');
  }

  // 액션
  async sendAction(type, extra={}){
    if (!PyxisSocket.isConnected()) return UI.error('서버에 연결되어 있지 않습니다');
    try{
      await PyxisSocket.sendPlayerAction(type, extra.targetPid||null, this.currentBattleId, this.myPlayerId);
    }catch(e){ UI.error(`행동 실패: ${e.message}`); }
  }

  doAttack(){
    const enemies = this.getEnemies();
    if (enemies.length === 0) return UI.error('공격할 대상이 없습니다!');
    window.PyxisTarget.show('공격 대상 선택', enemies, (t)=> this.sendAction('attack', { targetPid:t.id }));
  }
  doUseItem(){
    const items = (this.myPlayerData?.items)||{};
    const menu = [];
    if ((items.dittany??0)>0)   menu.push('디터니');
    if ((items.atkBoost??0)>0)  menu.push('공격 보정기');
    if ((items.defBoost??0)>0)  menu.push('방어 보정기');
    if (menu.length===0) return UI.error('사용 가능한 아이템이 없습니다');
    const pick = prompt(`사용할 아이템을 입력하세요:\n${menu.join(', ')}`);
    if (!pick) return;

    if (pick === '디터니'){
      const allies = this.getAllies().filter(p=>p.alive!==false);
      if (allies.length===0) return UI.error('회복 대상이 없습니다');
      window.PyxisTarget.show('회복 대상 선택', allies, (t)=> this.sendAction('useItem', { item:'디터니', targetPid:t.id }));
    } else if (pick === '공격 보정기' || pick==='방어 보정기'){
      this.sendAction('useItem', { item: pick, targetPid: this.myPlayerId });
    } else {
      UI.error('알 수 없는 아이템입니다.');
    }
  }

  getEnemies(){
    if (!this.battleState?.players || !this.myPlayerData) return [];
    const mineA = (this.myPlayerData.team==='A'||this.myPlayerData.team==='team1');
    return Object.values(this.battleState.players).filter(p=>{
      const isA = (p.team==='A'||p.team==='team1');
      return mineA!==isA && p.alive!==false;
    });
  }
  getAllies(){
    if (!this.battleState?.players || !this.myPlayerData) return [];
    const mineA = (this.myPlayerData.team==='A'||this.myPlayerData.team==='team1');
    return Object.values(this.battleState.players).filter(p=>{
      const isA = (p.team==='A'||p.team==='team1');
      return mineA===isA && p.alive!==false;
    });
  }

  // 액션 결과 이펙트 연동 (서버에서 주는 표준 형태 가정)
  handleActionFX(result){
    if (!result) return;
    // result: { type: 'attack'|'defend'|'evade'|'useItem'|'pass', actorPid, targetPid, damage, healed, crit, dodge, block, item }
    const targetEl = document.querySelector(`.unit[data-player-id="${result.targetPid}"]`)
                      || document.querySelector(`.player-card[data-player-id="${result.targetPid}"]`)
                      || this.playerInfo; // fallback
    if (result.type === 'attack'){
      if (result.dodge) {
        PyxisFX.showDodge(targetEl);
        this.addLog(`회피 성공!`, 'action');
      } else {
        PyxisFX.showHit(targetEl, result.damage||0, {crit: !!result.crit, blocked: !!result.block});
        this.addLog(`${result.crit?'치명타! ':''}${result.damage||0} 피해`, 'action');
      }
    } else if (result.type === 'useItem'){
      if (result.item === '디터니'){
        PyxisFX.showHeal(targetEl, result.healed||10);
        this.addLog(`디터니 사용: +${result.healed||10} 회복`, 'action');
      } else if (result.item){
        PyxisFX.sparkAt(targetEl, {ring:true});
        this.addLog(`${result.item} 사용`, 'action');
      }
    } else if (result.type === 'defend'){
      PyxisFX.sparkAt(targetEl, {ring:true});
      this.addLog(`방어 태세`, 'action');
    } else if (result.type === 'evade'){
      PyxisFX.showDodge(targetEl);
      this.addLog(`회피 시도`, 'action');
    } else if (result.type === 'pass'){
      this.addLog(`패스`, 'action');
    }
  }

  // 채팅
  sendChat(){
    const msg = this.chatInput.value.trim();
    if (!msg || !this.currentBattleId) return;
    let scope = 'all', text = msg;
    if (msg.startsWith('/t ')) { scope='team'; text = msg.slice(3).trim(); }
    PyxisSocket.sendChat({ battleId:this.currentBattleId, text, nickname:this.myPlayerData?.name||'플레이어', role:'player', scope });
    this.chatInput.value = '';
  }

  cleanup(){ PyxisSocket.cleanup(); }
}
document.addEventListener('DOMContentLoaded', ()=> window.player = new PyxisPlayer());
window.addEventListener('beforeunload', ()=> window.player && window.player.cleanup());
