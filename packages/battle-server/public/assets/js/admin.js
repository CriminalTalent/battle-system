<script>
/* PYXIS Admin - 관리자 클라이언트 (비밀번호/링크 발급 + 참가자 관리 + 채팅 + 개별 복사)
   - 관리자 인증 기본 미사용(요청 시 window.PYXIS_REQUIRE_ADMIN_AUTH=true 설정)
   - 팀키 phoenix/death 기준, eaters 폴백 호환
   - 신/구 이벤트명/DOM ID 양쪽 호환
   - 이모지 미사용, 한글 라벨 고정
*/
(() => {
  // ====== 유틸 ======
  const $id = (id) => document.getElementById(id);
  const pickEl = (...ids) => ids.map($id).find(Boolean) || null; // 여러 후보 ID 중 첫번째 존재 엘리먼트
  const on = (el, evt, fn) => el && el.addEventListener(evt, fn);

  const TEAM_KEY = (raw) => (raw === 'eaters' ? 'death' : raw); // 과거 eaters → death 폴백
  const TEAM_LABEL = { phoenix: 'A팀', death: 'B팀' }; // 7학년 기준 A/B 표시(요청 반영)

  // 안전 escape
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));

  // 결과 리스트(개별 복사). issueList가 없으면 링크 박스로 분배
  function renderCopyList(items) {
    const list = pickEl('issueList');
    if (!list) return; // 없으면 패스(다른 방식으로 출력)
    list.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      const row = document.createElement('div');
      row.className = 'copy-row';
      row.innerHTML = `<span class="copy-label">-</span><code class="copy-value">-</code>`;
      list.appendChild(row);
      return;
    }
    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'copy-row';

      const lab = document.createElement('span');
      lab.className = 'copy-label';
      lab.textContent = label || '정보';

      const val = document.createElement('code');
      val.className = 'copy-value';
      val.textContent = value || '-';
      val.dataset.copy = value || '';

      val.addEventListener('click', () => {
        const text = val.dataset.copy;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          const orig = val.textContent;
          val.textContent = `${orig} (복사됨)`;
          setTimeout(() => (val.textContent = orig), 1200);
        });
      });

      row.appendChild(lab);
      row.appendChild(val);
      list.appendChild(row);
    });
  }

  // 링크 전용 출력(제가 드린 HTML 구조 호환)
  function renderLinkBoxes({ playerLinks = [], spectatorLink = '' }) {
    const playerBox = pickEl('playerLinks');   // 제안 HTML
    const specBox   = pickEl('spectatorLink'); // 제안 HTML
    const linkWrap  = pickEl('linkSection');
    if (!playerBox && !specBox) return;

    if (playerBox) {
      playerBox.innerHTML = '';
      if (playerLinks.length) {
        playerLinks.forEach(({ name, team, url }) => {
          const item = document.createElement('div');
          item.className = 'link-item';
          item.innerHTML = `
            <div class="link-label">${esc(name)} (${TEAM_LABEL[TEAM_KEY(team)] || team})</div>
            <div class="link-url" title="클릭하여 복사">${esc(url)}</div>
          `;
          const urlEl = item.querySelector('.link-url');
          urlEl.addEventListener('click', () => {
            navigator.clipboard.writeText(url).then(()=> toast('링크가 복사되었습니다.', 'success'));
          });
          playerBox.appendChild(item);
        });
      } else {
        playerBox.innerHTML = '<div class="link-item"><div class="link-label">알림</div><div class="link-url">발급된 전투 참가자 링크가 없습니다.</div></div>';
      }
    }
    if (specBox) {
      specBox.innerHTML = '';
      if (spectatorLink) {
        const item = document.createElement('div');
        item.className = 'link-item';
        item.innerHTML = `
          <div class="link-label">관전자 링크</div>
          <div class="link-url" title="클릭하여 복사">${esc(spectatorLink)}</div>
        `;
        const urlEl = item.querySelector('.link-url');
        urlEl.addEventListener('click', () => {
          navigator.clipboard.writeText(spectatorLink).then(()=> toast('링크가 복사되었습니다.', 'success'));
        });
        specBox.appendChild(item);
      }
    }
    if (linkWrap) linkWrap.style.display = 'block';
  }

  // 토스트(제안 HTML과 호환)
  function toast(message, type='info') {
    const el = pickEl('toast');
    if (!el) { console[type==='error'?'error':'log'](message); return; }
    el.textContent = message;
    el.className = `toast ${type}`;
    el.classList.add('show');
    setTimeout(()=> el.classList.remove('show'), 2200);
  }

  class AdminApp {
    constructor() {
      // 상태
      this.socket = null;
      this.currentBattleId = null;
      this.connected = false;
      this.players = [];
      this.mode = '1v1';

      // DOM 후보(양쪽 템플릿 호환)
      this.el = {
        // 표시
        currentBattleId: pickEl('currentBattleId','battleId'), // 표시용
        currentMode:     pickEl('currentMode'),
        connDot:         pickEl('connDot'),
        connText:        pickEl('connText'),

        // 컨트롤
        battleMode:      pickEl('battleMode'),
        btnCreate:       pickEl('btnCreateBattle'),
        btnStart:        pickEl('btnStartBattle'),
        btnPause:        pickEl('btnPauseBattle'),
        btnResume:       pickEl('btnResumeBattle'),
        btnEnd:          pickEl('btnEndBattle'),
        btnGenLinks:     pickEl('btnGenerateLinks'),

        // 발급(비밀번호/링크)
        btnIssuePlayerPw:   pickEl('btnIssuePlayerPw'),
        btnIssueSpectPw:    pickEl('btnIssueSpectatorPw'),
        btnIssuePlayerLinks:pickEl('btnIssuePlayerLinks'),
        btnIssueSpectLink:  pickEl('btnIssueSpectatorLink'),

        // 참가자 입력
        pName:         pickEl('pName','playerName'),
        pTeam:         pickEl('pTeam','playerTeam'),
        sATK:          pickEl('sATK','statAttack'),
        sDEF:          pickEl('sDEF','statDefense'),
        sDEX:          pickEl('sDEX','statAgility'),
        sLUK:          pickEl('sLUK','statLuck'),
        pHP:           pickEl('pHP'),
        itemDittany:   pickEl('itemDittany'),
        itemAtkBoost:  pickEl('itemAtkBoost','itemAttack'),
        itemDefBoost:  pickEl('itemDefBoost','itemDefense'),
        pImage:        pickEl('pImage','playerAvatar'),
        btnAddPlayer:  pickEl('btnAddPlayer'),

        // 로스터
        rosterA: pickEl('rosterPhoenix','phoenixTeam'), // A팀 컨테이너
        rosterB: pickEl('rosterEaters','deathTeam'),    // B팀 컨테이너

        // 채팅/로그
        chatInput: pickEl('chatText','chatInput'),
        chatSend:  pickEl('btnChatSend','btnSendChat'),
        chatView:  pickEl('chatView','chatContainer'),
        logView:   pickEl('battleLog'),

        // 링크 박스(제안 HTML)
        playerLinks: pickEl('playerLinks'),
        spectatorLink: pickEl('spectatorLink'),
        linkSection: pickEl('linkSection'),

        // 발급 리스트(원래 코드)
        issueList: pickEl('issueList'),
      };
    }

    init() {
      this.parseQuery();
      this.bindUI();
      this.setupSocket();
      this.log('system', '관리자 클라이언트 초기화');
    }

    parseQuery() {
      const u = new URL(window.location.href);
      this.currentBattleId = u.searchParams.get('battle') || null;
      const token = u.searchParams.get('token'); // 기본 미사용
      if (this.el.currentBattleId) this.el.currentBattleId.textContent = this.currentBattleId || '대기 중';
      if (this.el.battleMode) this.mode = this.el.battleMode.value || '1v1';
      // 관리자 인증 필요 시 명시적으로 켜기
      this.requireAuth = !!window.PYXIS_REQUIRE_ADMIN_AUTH;
      this.adminToken = this.requireAuth ? token : null;
    }

    bindUI() {
      // 전투 모드 선택
      on(this.el.battleMode,'change',()=>{ this.mode = this.el.battleMode.value || '1v1'; });

      // 전투 제어
      on(this.el.btnCreate,'click',()=> this.emitCreateBattle());
      on(this.el.btnStart,'click',()=> this.emitStartBattle());
      on(this.el.btnPause,'click',()=> this.emitPauseBattle());
      on(this.el.btnResume,'click',()=> this.emitResumeBattle());
      on(this.el.btnEnd,'click',()=> this.emitEndBattle());

      // 참가자 추가
      on(this.el.btnAddPlayer,'click',()=> this.addPlayer());

      // 비밀번호/링크 발급(클라/서버 겸용)
      on(this.el.btnIssuePlayerPw,   'click',()=> this.issuePlayerPasswords());
      on(this.el.btnIssueSpectPw,    'click',()=> this.issueSpectatorPassword());
      on(this.el.btnIssuePlayerLinks,'click',()=> this.requestPlayerLinks());
      on(this.el.btnIssueSpectLink,  'click',()=> this.requestSpectatorLink());
      on(this.el.btnGenLinks,        'click',()=> this.requestPlayerLinks()); // 제안 HTML 버튼

      // 채팅
      on(this.el.chatSend,'click',()=> this.sendChat());
      on(this.el.chatInput,'keydown',(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); this.sendChat(); } });
    }

    setupSocket() {
      this.socket = io(window.PYXIS_SERVER_URL || undefined, { transports:['websocket','polling'], timeout:20000 });

      this.socket.on('connect', () => {
        this.connected = true; this.setConn(true);
        this.log('system', '서버와 연결됨');

        // 방 참여
        if (this.currentBattleId) {
          this.socket.emit('join', { battleId: this.currentBattleId });
        }

        // 필요 시에만 관리자 인증
        if (this.requireAuth && this.currentBattleId && this.adminToken) {
          this.socket.emit('adminAuth', { battleId: this.currentBattleId, token: this.adminToken });
        }
      });

      this.socket.on('disconnect', () => {
        this.connected = false; this.setConn(false);
        this.log('system', '서버 연결 해제');
      });

      // 인증 성공(선택적)
      this.socket.on('auth:success', ({ role, battleId }) => {
        if (battleId) this.currentBattleId = battleId;
        if (this.el.currentBattleId) this.el.currentBattleId.textContent = this.currentBattleId || '-';
        this.log('system', `인증 성공 (${role})`);
      });
      this.socket.on('authError', (e) => {
        console.warn('authError', e);
        toast('관리자 인증 오류(인증 없이도 사용 가능합니다).', 'error');
      });

      // 전투 생성(신/구)
      this.socket.on('battleCreated', (data) => this.onBattleCreated(data));
      this.socket.on('admin:battle_created', (data) => this.onBattleCreated({ battleId:data?.id, mode:data?.mode }));

      // 상태 업데이트(신/구)
      this.socket.on('battle:update', (battle) => this.onBattleUpdate(battle));
      this.socket.on('battleUpdate',  (battle) => this.onBattleUpdate(battle));
      this.socket.on('admin:update',  (data)   => data?.battle && this.onBattleUpdate(data.battle));

      // 참가자 추가/삭제(신/구)
      this.socket.on('playerAdded',   (payload) => this.onPlayerAdded(payload));
      this.socket.on('player:added',  (payload) => this.onPlayerAdded({ success:true, player:payload?.player || payload }));
      this.socket.on('playerRemoved', (payload) => this.onPlayerRemoved(payload));
      this.socket.on('player:removed',(payload) => this.onPlayerRemoved({ success:true, playerId:payload?.playerId || payload?.id }));

      // 링크/비밀번호 발급 결과
      this.socket.on('playerPasswordGenerated', (res)=> this.onPlayerLinksGenerated(res));
      this.socket.on('admin:links',             (res)=> this.onPlayerLinksGenerated({ success:true, playerLinks:res?.links||[] }));
      this.socket.on('spectatorOtpGenerated',   (res)=> this.onSpectatorLinkGenerated(res));

      // 채팅/로그(신/구)
      this.socket.on('battle:chat', (msg)=> this.addChat(msg.name || '익명', msg.message || ''));
      this.socket.on('chat:message',(msg)=> this.addChat(msg.senderName || '익명', msg.message || ''));
      this.socket.on('battle:log',  (entry)=> this.log(entry.type || 'log', entry.message || ''));
    }

    // ===== 전투 제어 emit =====
    emitCreateBattle(){
      const mode = this.mode || '1v1';
      // 신/구 이벤트 모두 시도
      let sent = false;
      try { this.socket.emit('createBattle', { mode }); sent = true; } catch(_){}
      try { this.socket.emit('admin:create_battle', { mode }); sent = true; } catch(_){}
      this.log('system', `전투 생성 요청: ${mode}${sent?'':''}`);
    }
    emitStartBattle(){
      if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
      try { this.socket.emit('startBattle', { battleId: this.currentBattleId }); } catch(_){}
      try { this.socket.emit('admin:start_battle', { battleId: this.currentBattleId }); } catch(_){}
    }
    emitPauseBattle(){
      if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
      try { this.socket.emit('pauseBattle', { battleId: this.currentBattleId }); } catch(_){}
      try { this.socket.emit('admin:pause_battle', { battleId: this.currentBattleId }); } catch(_){}
    }
    emitResumeBattle(){
      if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
      try { this.socket.emit('resumeBattle', { battleId: this.currentBattleId }); } catch(_){}
      try { this.socket.emit('admin:resume_battle', { battleId: this.currentBattleId }); } catch(_){}
    }
    emitEndBattle(){
      if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
      try { this.socket.emit('endBattle', { battleId: this.currentBattleId }); } catch(_){}
      try { this.socket.emit('admin:end_battle', { battleId: this.currentBattleId }); } catch(_){}
    }

    // ===== 소켓 수신 핸들러 =====
    onBattleCreated(data){
      this.currentBattleId = data?.battleId || data?.id || this.currentBattleId;
      if (this.el.currentBattleId) this.el.currentBattleId.textContent = this.currentBattleId || '-';
      if (this.el.currentMode) this.el.currentMode.textContent = data?.mode || this.mode || '-';
      this.setIssueList([]);
      this.log('system', `전투 생성됨: ${this.currentBattleId}`);
      // 생성 직후 방 참여 보장
      if (this.currentBattleId) this.socket.emit('join', { battleId: this.currentBattleId });
    }

    onBattleUpdate(battle){
      if (!battle || !battle.id) return;
      this.currentBattleId = battle.id;
      if (this.el.currentBattleId) this.el.currentBattleId.textContent = battle.id;
      if (this.el.currentMode) this.el.currentMode.textContent = battle.mode || '-';
      this.players = Array.isArray(battle.players) ? battle.players : [];
      this.renderRoster();
      // 제안 HTML의 통계칸이 있으면 갱신 가능(있을 때만)
      const statPlayersEl = $id('statPlayers');
      if (statPlayersEl) {
        const connected = this.players.filter(p=>p.isConnected).length;
        statPlayersEl.textContent = `${connected}/${this.players.length}`;
      }
    }

    onPlayerAdded(payload){
      const ok = payload?.success ?? true;
      const player = payload?.player ?? payload;
      if (!ok || !player) {
        alert('전투 참가자 추가 실패: ' + (payload?.error || '알 수 없는 오류'));
        return;
      }
      const idx = this.players.findIndex(p => p.id === player.id);
      if (idx === -1) this.players.push(player); else this.players[idx] = player;
      this.renderRoster();
      this.log('system', `전투 참가자 추가됨: ${player.name}`);
      // 제안 HTML 폼 초기화
      if (this.el.pName) this.el.pName.value = '';
      if (this.el.pImage) this.el.pImage.value = '';
    }

    onPlayerRemoved(payload){
      if (!payload?.success) return;
      const id = payload.playerId;
      this.players = this.players.filter((p)=> p.id !== id);
      this.renderRoster();
      this.log('system', `전투 참가자 제거됨: ${id}`);
    }

    onPlayerLinksGenerated(res){
      if (!res?.success) {
        const msg = '전투 참가자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류');
        this.setIssueList([{ label:'오류', value: msg }]);
        toast(msg,'error');
        return;
      }
      const items = (res.playerLinks || []).map(p=>({
        label: `전투 참가자 링크 (${TEAM_LABEL[TEAM_KEY(p.team)] || p.team} - ${p.name})`,
        value: p.url
      }));
      if (this.el.issueList) {
        this.setIssueList(items.length ? items : [{ label:'알림', value:'발급된 전투 참가자 링크가 없습니다.' }]);
      } else {
        // 제안 HTML 방식으로 출력
        renderLinkBoxes({ playerLinks: res.playerLinks });
      }
    }

    onSpectatorLinkGenerated(res){
      if (!res?.success) {
        const msg = '관전자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류');
        this.setIssueList([{ label:'오류', value: msg }]);
        toast(msg,'error');
        return;
      }
      if (this.el.issueList) {
        this.setIssueList([{ label:'관전자 링크', value: res.spectatorUrl }]);
      } else {
        renderLinkBoxes({ spectatorLink: res.spectatorUrl });
      }
    }

    // ===== 연결 상태 =====
    setConn(ok){
      const { connDot, connText } = this.el;
      if (connDot) { connDot.classList.remove('ok','bad'); connDot.classList.add(ok?'ok':'bad'); }
      if (connText) connText.textContent = ok ? '연결됨' : '해제됨';
    }

    // ===== 결과 리스트 바인딩 =====
    setIssueList(items){ renderCopyList(items); }

    // ===== 참가자 추가 =====
    async addPlayer() {
      if (!this.currentBattleId) {
        alert('전투 ID가 없습니다. 먼저 전투를 생성하거나 adminUrl로 접속하세요.');
        return;
      }
      const name = (this.el.pName?.value || '').trim();
      const rawTeam = this.el.pTeam?.value || 'phoenix';
      const team = TEAM_KEY(rawTeam);
      const stats = {
        attack:  this.clampInt(this.el.sATK?.value, 1, 5, 3),
        defense: this.clampInt(this.el.sDEF?.value, 1, 5, 3),
        agility: this.clampInt(this.el.sDEX?.value, 1, 5, 3),
        luck:    this.clampInt(this.el.sLUK?.value, 1, 5, 3),
      };
      const hp = this.clampInt(this.el.pHP?.value ?? '100', 1, 100, 100);
      const items = {
        dittany:        this.clampInt(this.el.itemDittany?.value ?? '1', 0, 5, 1),
        attack_booster: this.clampInt(this.el.itemAtkBoost?.value ?? '1', 0, 5, 1),
        defense_booster:this.clampInt(this.el.itemDefBoost?.value ?? '1', 0, 5, 1),
      };
      if (!name) return alert('전투 참가자 이름을 입력하세요.');

      let avatarUrl = null;
      const file = this.el.pImage?.files?.[0] || null;
      if (file) {
        try {
          const fd = new FormData();
          fd.append('avatar', file); // 서버 필드명: avatar
          // 신 경로 우선, 실패 시 구 경로 폴백
          let res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
          if (!res.ok) res = await fetch('/api/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (data?.ok && (data.avatarUrl || data.url)) {
            avatarUrl = data.avatarUrl || data.url;
          }
        } catch(e) {
          console.warn('이미지 업로드 실패', e);
        }
      }

      const playerData = { name, team, stats, hp, maxHp:100, items, avatar: avatarUrl };

      // 신/구 이벤트 모두 시도
      try { this.socket.emit('addPlayer', { battleId: this.currentBattleId, playerData }); } catch(_){}
      try { this.socket.emit('admin:add_player', playerData); } catch(_){}

      this.log('system', `전투 참가자 추가 요청: ${name} (${TEAM_LABEL[team] || team})`);
    }

    // ===== 로스터 렌더 =====
    renderRoster(){
      const a = this.el.rosterA, b = this.el.rosterB;
      if (a) a.innerHTML=''; if (b) b.innerHTML='';

      (this.players || []).forEach((p)=>{
        const team = TEAM_KEY(p.team);
        const container = team === 'phoenix' ? a : b;
        if (!container) return;

        const wrap = document.createElement('div');
        wrap.className = 'roster-player';
        wrap.style.border = '1px solid rgba(255,255,255,.08)';
        wrap.style.borderRadius = '10px';
        wrap.style.padding = '8px';
        wrap.style.marginBottom = '8px';
        const hp = Math.max(0, Math.min(100, Math.round((p.hp / (p.maxHp||100))*100)));

        wrap.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${esc(p.name)}</strong>
            <span class="muted">HP: ${p.hp}/${p.maxHp||100} (${hp}%)</span>
          </div>
          <details style="margin-top:6px">
            <summary>자세히</summary>
            <div class="mono" style="margin-top:6px">
              스탯 - 공격 ${p.stats?.attack ?? '-'}, 방어 ${p.stats?.defense ?? '-'}, 민첩 ${p.stats?.agility ?? '-'}, 행운 ${p.stats?.luck ?? '-'}
            </div>
            <div>아이템 - 디터니 ${p.items?.dittany ?? 0}, 공격 보정기 ${p.items?.attack_booster ?? 0}, 방어 보정기 ${p.items?.defense_booster ?? 0}</div>
            ${p.avatar ? `<div>이미지 주소: <a href="#" class="copyable" data-copy="${esc(p.avatar)}">${esc(p.avatar)}</a></div>` : ''}
          </details>
        `;

        // 상세 내 개별 복사
        wrap.querySelectorAll('.copyable').forEach((a) => {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            const text = a.dataset.copy;
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
              const orig = a.textContent;
              a.textContent = `${orig} (복사됨)`;
              setTimeout(() => (a.textContent = orig), 1200);
            });
          });
        });

        container.appendChild(wrap);
      });

      if (a && !a.children.length) a.innerHTML = '<div class="muted">팀원이 없습니다</div>';
      if (b && !b.children.length) b.innerHTML = '<div class="muted">팀원이 없습니다</div>';
    }

    // ===== 비밀번호/링크 발급 =====
    issuePlayerPasswords(){
      if (!this.currentBattleId) return this.setIssueList([{ label:'오류', value:'전투 ID가 없습니다.' }]);
      if (!this.players.length)   return this.setIssueList([{ label:'알림', value:'발급할 전투 참가자가 없습니다.' }]);

      // 요구: 비밀번호 명시 고정
      const items = this.players.map((p)=>({
        label: `전투 참가자 비밀번호 (${TEAM_LABEL[TEAM_KEY(p.team)] || p.team} - ${p.name})`,
        value: `player-${p.name}-${this.currentBattleId}`
      }));

      if (this.el.issueList) this.setIssueList(items);
      else renderLinkBoxes({}); // issueList가 없을 때는 링크 박스만 유지
    }

    issueSpectatorPassword(){
      if (!this.currentBattleId) return this.setIssueList([{ label:'오류', value:'전투 ID가 없습니다.' }]);
      const pw = `spectator-${this.currentBattleId}`;
      if (this.el.issueList) this.setIssueList([{ label:'관전자 비밀번호', value: pw }]);
      else renderLinkBoxes({});
    }

    requestPlayerLinks(){
      if (!this.currentBattleId) {
        const msg = '전투 ID가 없습니다.';
        if (this.el.issueList) this.setIssueList([{ label:'오류', value: msg }]);
        toast(msg,'error'); return;
      }
      // 1) 서버 이벤트 시도(신/구)
      let asked = false;
      try { this.socket.emit('generatePlayerPassword', { battleId: this.currentBattleId }); asked = true; } catch(_){}
      try { this.socket.emit('admin:generate_links', { battleId: this.currentBattleId }); asked = true; } catch(_){}
      if (asked) {
        if (this.el.issueList) this.setIssueList([{ label:'상태', value:'전투 참가자 링크 발급 요청 중...' }]);
        return;
      }
      // 2) 클라이언트 생성 폴백(플레이어 토큰이 battle 데이터에 있을 때)
      const baseUrl = window.location.origin;
      const links = [];
      (this.players||[]).forEach(player=>{
        if (player?.token) {
          links.push({ name: player.name, team: player.team, url: `${baseUrl}/player?battle=${this.currentBattleId}&name=${encodeURIComponent(player.name)}&token=${player.token}` });
        }
      });
      if (links.length) {
        if (this.el.issueList) {
          this.setIssueList(links.map(l=>({ label:`전투 참가자 링크 (${TEAM_LABEL[TEAM_KEY(l.team)] || l.team} - ${l.name})`, value:l.url })));
        } else {
          renderLinkBoxes({ playerLinks: links });
        }
        toast('링크가 생성되었습니다.','success');
      } else {
        const msg = '생성 가능한 전투 참가자 링크가 없습니다.';
        if (this.el.issueList) this.setIssueList([{ label:'알림', value: msg }]);
        toast(msg,'info');
      }
    }

    requestSpectatorLink(){
      if (!this.currentBattleId) {
        const msg = '전투 ID가 없습니다.';
        if (this.el.issueList) this.setIssueList([{ label:'오류', value: msg }]);
        toast(msg,'error'); return;
      }
      // 1) 서버 이벤트 시도
      let asked = false;
      try { this.socket.emit('generateSpectatorOtp', { battleId: this.currentBattleId }); asked = true; } catch(_){}
      try { this.socket.emit('admin:generate_spectator_link', { battleId: this.currentBattleId }); asked = true; } catch(_){}
      if (asked) {
        if (this.el.issueList) this.setIssueList([{ label:'상태', value:'관전자 링크 발급 요청 중...' }]);
        return;
      }
      // 2) 간단 폴백(비밀번호 별도 발급)
      const baseUrl = window.location.origin;
      const spectatorUrl = `${baseUrl}/spectator?battle=${this.currentBattleId}`;
      if (this.el.issueList) this.setIssueList([{ label:'관전자 링크', value: spectatorUrl }]);
      else renderLinkBoxes({ spectatorLink: spectatorUrl });
      toast('관전자 링크가 생성되었습니다.','success');
    }

    // ===== 채팅/로그 =====
    sendChat(){
      const text = (this.el.chatInput?.value || '').trim();
      if (!text || !this.currentBattleId) return;
      // 신/구 이벤트 모두 시도
      try { this.socket.emit('chat:send', { battleId:this.currentBattleId, name:'관리자', message:text, role:'admin' }); } catch(_){}
      try { this.socket.emit('admin:chat', { message:text }); } catch(_){}
      try { this.socket.emit('battle:chat', { name:'관리자', message:text }); } catch(_){}
      if (this.el.chatInput) this.el.chatInput.value = '';
    }

    log(type, message){
      const box = this.el.logView;
      if (!box) return;
      const el = document.createElement('div');
      const ts = new Date().toLocaleTimeString();
      el.textContent = `[${ts}] ${message}`;
      el.className = 'log-entry';
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
      if (box.children.length > 200) box.removeChild(box.firstChild);
    }

    addChat(name, text){
      const box = this.el.chatView;
      if (!box) return;
      const el = document.createElement('div');
      const ts = new Date().toLocaleTimeString();
      el.textContent = `${name} [${ts}]: ${text}`;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
      if (box.children.length > 120) box.removeChild(box.firstChild);
    }

    // ===== 보조 =====
    clampInt(v,min,max,fallback=0){
      const n = parseInt(v,10);
      if (Number.isNaN(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const app = new AdminApp();
    window.PyxisAdmin = app;
    app.init();
  });
})();
</script>
