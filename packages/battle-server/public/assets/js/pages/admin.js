// packages/battle-server/public/assets/js/pages/admin.js
"use strict";

/* =========================================================
   PYXIS Admin – External JS (logic only)
   - Socket.IO connection & auth (admin)
   - REST helpers
   - Battle controls (create/start/pause/end/restart)
   - Link generation with robust fallbacks
   - Player registration & roster rendering
   - Chat & Log rendering
   - Starfield twinkles & UI helpers (toast, connection)
   Requirements:
   - admin.html provides all elements with ids referenced here
   - No emojis in any output
   ========================================================= */

/* ---------------------------------------------------------
   Socket.IO loader fallback (if /socket.io not available)
   The HTML already includes /socket.io/socket.io.js, but keep a guard.
--------------------------------------------------------- */
(function ensureSocketIO(){
  if (window.io) return;
  function add(src, onload, onerror){
    var s=document.createElement('script'); s.src=src; s.async=true; s.onload=onload; s.onerror=onerror; document.head.appendChild(s);
  }
  add('/socket.io/socket.io.js', function(){}, function(){
    add('https://cdn.socket.io/4.7.5/socket.io.min.js', function(){}, function(){
      console.warn('Socket.IO client load failed');
    });
  });
})();

/* ---------------------------------------------------------
   Minimal UI helpers
--------------------------------------------------------- */
const UI = (() => {
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  function text(el, v){ if(el) el.textContent = String(v == null ? '' : v); }
  function toast(msg){
    const el = $('#toast'); if(!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(()=>el.classList.remove('show'), 1600);
  }
  function setConn({ok, msg}){
    const dot = $('#connDot'); const t = $('#connText');
    if(dot){ dot.classList.remove('ok','bad'); if(ok===true) dot.classList.add('ok'); else if(ok===false) dot.classList.add('bad'); }
    if(t){ text(t, msg || (ok==null ? '연결 중...' : ok ? '연결됨' : '연결 끊김')); }
  }
  return { $, $$, text, toast, setConn };
})();

/* ---------------------------------------------------------
   Starfield twinkles (pure DOM dots)
--------------------------------------------------------- */
(function buildTwinkles(){
  const host = document.getElementById('twinkleLayer'); if(!host) return;
  const count = 80;
  for(let i=0;i<count;i++){
    const s = document.createElement('div'); s.className = 'twinkle';
    const size = (Math.random()*2.5+1).toFixed(2);
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = (Math.random()*100) + '%';
    s.style.top = (Math.random()*100) + '%';
    s.style.animationDuration = (2.2 + Math.random()*3.6).toFixed(2) + 's';
    s.style.opacity = (0.25 + Math.random()*0.55).toFixed(2);
    host.appendChild(s);
  }
})();

/* ---------------------------------------------------------
   Admin UI class
--------------------------------------------------------- */
class AdminUI {
  constructor(){
    // Socket and auth
    this.socket = null;
    this.connected = false;
    this.authed = false;

    // State
    const url = new URL(location.href);
    this.battleId = url.searchParams.get('battle') || '';
    this.adminToken = url.searchParams.get('token') || '';
    this.players = [];

    // Intervals
    this.heartbeat = null;
    this.syncer = null;

    // Desired starting HP per player name (applied on start)
    this.desiredHp = new Map();

    // Elements
    const $ = UI.$;
    this.el = {
      // Controls
      mode: $('#battleMode'),
      id: $('#battleId'),
      create: $('#createBattleBtn'),
      start: $('#startBattleBtn'),
      pause: $('#pauseBattleBtn'),
      end: $('#endBattleBtn'),
      restart: $('#restartBattleBtn'),
      reconnect: $('#reconnectBtn'),

      // Links
      adminLink: $('#adminLink'),
      playerLink: $('#playerLink'),
      spectatorLink: $('#spectatorLink'),
      genLinks: $('#generateLinksBtn'),
      copyAdmin: $('#copyAdmin'),
      copyPlayer: $('#copyPlayer'),
      copySpectator: $('#copySpectator'),

      // Player form
      name: $('#playerName'),
      team: $('#playerTeam'),
      atk: $('#statAtk'),
      def: $('#statDef'),
      agi: $('#statAgi'),
      luk: $('#statLuk'),
      hp:  $('#playerHp'),
      item: $('#itemSelect'),
      add: $('#addPlayerBtn'),

      // Roster
      teamA: $('#teamPhoenix'),
      teamB: $('#teamDeathEaters'),
      teamACount: $('#teamACount'),
      teamBCount: $('#teamBCount'),

      // Log & Chat
      log: $('#battleLog'),
      chat: $('#chatMessages'),
      chatInput: $('#chatInput'),
      chatSend: $('#chatSendBtn'),

      // Status pill
      pill: $('#battleStatePill')
    };

    this.bind();
    this.bootstrap();
  }

  bind(){
    const e = this.el;

    // Control buttons
    e.create?.addEventListener('click', () => this.createBattle());
    e.start?.addEventListener('click', () => this.startBattle());
    e.pause?.addEventListener('click', () => this.pauseBattle());
    e.end?.addEventListener('click', () => this.endBattle());
    e.restart?.addEventListener('click', () => this.restartBattle());
    e.reconnect?.addEventListener('click', () => this.connect());

    // Link generation
    e.genLinks?.addEventListener('click', () => this.generateLinks());
    e.copyAdmin?.addEventListener('click', () => this.copy(e.adminLink));
    e.copyPlayer?.addEventListener('click', () => this.copy(e.playerLink));
    e.copySpectator?.addEventListener('click', () => this.copy(e.spectatorLink));

    // Player
    e.add?.addEventListener('click', () => this.addPlayer());

    // Chat
    e.chatSend?.addEventListener('click', () => this.sendChat());
    e.chatInput?.addEventListener('keydown', (ev) => {
      if(ev.key === 'Enter' && !ev.shiftKey){
        ev.preventDefault();
        this.sendChat();
      }
    });

    // Clamp numeric inputs
    const clamp = (el, min, max) => {
      const v = Number(el.value);
      el.value = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
    };
    ['atk','def','agi','luk'].forEach(k => {
      e[k]?.addEventListener('change', () => clamp(e[k], 1, 5));
      e[k]?.addEventListener('blur',  () => clamp(e[k], 1, 5));
    });
    e.hp?.addEventListener('change', () => clamp(e.hp, 1, 1000));
    e.hp?.addEventListener('blur',  () => clamp(e.hp, 1, 1000));
  }

  bootstrap(){
    if(this.el.id) this.el.id.value = this.battleId || '';
    this.updatePill('wait');
    this.connect();
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  /* ================= Networking ================= */
  connect(){
    if(this.socket?.connected) return;
    // eslint-disable-next-line no-undef
    this.socket = io({transports:['websocket','polling']});

    this.socket.on('connect', () => {
      this.connected = true;
      UI.setConn({ok:true, msg:'연결 완료'});

      if(this.battleId && this.adminToken){
        this.socket.emit('adminAuth', {battleId:this.battleId, token:this.adminToken});
      }
      this.startHeartbeat();
      this.startSync();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      UI.setConn({ok:false, msg:'연결 끊김'});
      this.stopHeartbeat();
      this.stopSync();
    });

    this.socket.on('authSuccess', (payload) => {
      this.authed = true;
      if(payload?.battle){
        this.battleId = payload.battle.id || this.battleId;
        if(this.el.id) this.el.id.value = this.battleId;
        this.updatePillByStatus(payload.battle.status || payload.battle.state);
        this.renderRoster(payload.battle.players || []);
      }
      this.log('system','관리자 인증 성공');
    });

    this.socket.on('authError', () => {
      this.authed = false;
      this.log('error','관리자 인증 실패');
      UI.toast('관리자 인증 실패');
    });

    this.socket.on('battleUpdate', (state) => {
      if(state?.id){
        this.battleId = state.id;
        if(this.el.id) this.el.id.value = this.battleId;
      }
      this.updatePillByStatus(state?.status || state?.state);
      this.renderRoster(state?.players || []);
      if(Array.isArray(state?.log)){
        state.log.slice(-5).forEach(l => this.log(l.type || 'event', l.message || ''));
      }
    });

    this.socket.on('chatMessage', (msg) => {
      this.appendChat(msg?.sender || msg?.role || '채널', msg?.message || '');
    });
  }

  startHeartbeat(){
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if(!this.socket?.connected) return;
      this.socket.emit('admin:ping', {t:Date.now()});
    }, 15000);
  }
  stopHeartbeat(){ if(this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null; }

  startSync(){
    this.stopSync();
    this.syncer = setInterval(() => {
      if(this.socket?.connected && this.battleId){
        this.socket.emit('admin:requestState', {battleId:this.battleId});
      }
    }, 5000);
  }
  stopSync(){ if(this.syncer) clearInterval(this.syncer); this.syncer = null; }

  /* ================= REST helper ================= */
  async j(url, opts={}){
    const res = await fetch(url, {headers:{'Content-Type':'application/json'}, ...opts});
    const t = await res.text(); let d = {};
    try{ d = t ? JSON.parse(t) : {}; } catch{ throw new Error('Invalid JSON'); }
    if(!res.ok) throw new Error(d?.error || ('HTTP '+res.status));
    return d;
  }

  /* ================= Controls ================= */
  async createBattle(){
    try{
      const mode = this.el.mode?.value || '2v2';
      const r = await this.j('/api/battles', {method:'POST', body:JSON.stringify({mode})});
      const id = r?.id || r?.battleId;
      if(!id) throw new Error('ID 없음');

      this.battleId = id;
      if(this.el.id) this.el.id.value = id;

      const q = new URLSearchParams(location.search);
      q.set('battle', id);
      history.replaceState(null, '', location.pathname + '?' + q.toString());

      this.log('system', '전투 생성: ' + id);
      UI.toast('전투 생성 완료');
    }catch(e){
      this.log('error','전투 생성 실패: ' + e.message);
      UI.toast('전투 생성 실패');
    }
  }

  startBattle(){
    if(!this.battleId) return UI.toast('전투 ID가 없습니다');
    const payload = {battleId: this.battleId};
    this.socket?.emit('battle:start', payload, (res) => {
      if(res?.success){
        this.updatePill('live');
        this.log('system','전투 시작');
        UI.toast('전투 시작');
        this.applyDesiredHp();
      } else {
        this.log('error','전투 시작 실패');
        UI.toast('전투 시작 실패');
      }
    });
  }

  async pauseBattle(){
    if(!this.battleId) return UI.toast('전투 ID가 없습니다');
    try{
      await this.j(`/api/admin/battles/${encodeURIComponent(this.battleId)}/pause`, {method:'POST', body:JSON.stringify({})});
      this.updatePill('wait');
      this.log('system','전투 일시정지');
      UI.toast('일시정지');
    }catch(e){
      this.log('error','일시정지 실패: ' + e.message);
      UI.toast('일시정지 실패');
    }
  }

  async endBattle(){
    if(!this.battleId) return UI.toast('전투 ID가 없습니다');
    try{
      await this.j(`/api/admin/battles/${encodeURIComponent(this.battleId)}/end`, {method:'POST', body:JSON.stringify({})});
      this.updatePill('end');
      this.log('system','전투 종료');
      UI.toast('전투 종료');
    }catch(e){
      this.log('error','전투 종료 실패: ' + e.message);
      UI.toast('전투 종료 실패');
    }
  }

  async restartBattle(){
    if(!this.battleId) return UI.toast('전투 ID가 없습니다');
    try{
      await this.j(`/api/admin/battles/${encodeURIComponent(this.battleId)}/start`, {method:'POST', body:JSON.stringify({restart:true})});
      this.updatePill('live');
      this.log('system','전투 재시작');
      UI.toast('전투 재시작');
    }catch(e){
      this.log('error','전투 재시작 실패: ' + e.message);
      UI.toast('전투 재시작 실패');
    }
  }

  /* ================= Links ================= */
  async generateLinks(){
    if(!this.battleId) return UI.toast('전투 ID가 없습니다');

    // 1) REST attempt
    try{
      const r = await this.j(`/api/admin/battles/${encodeURIComponent(this.battleId)}/links`, {method:'POST', body:JSON.stringify({})});
      const admin = r?.admin || r?.links?.admin || '';
      const player = r?.player || r?.links?.player || '';
      const spectator = r?.spectator || r?.links?.spectator || '';
      if(this.el.adminLink) this.el.adminLink.value = admin;
      if(this.el.playerLink) this.el.playerLink.value = player;
      if(this.el.spectatorLink) this.el.spectatorLink.value = spectator;
      this.log('system','링크 생성 완료');
      UI.toast('링크 생성 완료');
      return;
    }catch(e){
      // Continue to socket fallback
    }

    // 2) Socket fallback (if server implements it)
    const viaSocket = await new Promise((resolve) => {
      if(!this.socket?.connected){ return resolve(null); }
      try{
        this.socket.emit('admin:generateLinks', {battleId:this.battleId}, (ack) => {
          resolve(ack && ack.ok ? ack : null);
        });
      }catch{ resolve(null); }
    });
    if(viaSocket){
      const admin = viaSocket.adminUrl || '';
      const player = viaSocket.playerUrl || '';
      const spectator = viaSocket.spectatorUrl || '';
      if(this.el.adminLink) this.el.adminLink.value = admin;
      if(this.el.playerLink) this.el.playerLink.value = player;
      if(this.el.spectatorLink) this.el.spectatorLink.value = spectator;
      this.log('system','링크 생성 완료');
      UI.toast('링크 생성 완료');
      return;
    }

    // 3) Emergency builder (token placeholders) — spectator route fixed to /spectator
    const base = location.origin.replace(/\/+$/,'');
    const id   = encodeURIComponent(this.battleId);

    const url = new URL(location.href);
    const token = url.searchParams.get('token') || this.adminToken || '';

    const admin = `${base}/admin?battle=${id}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const player = `${base}/play?battle=${id}&token={playerOtp}`;
    const spectator = `${base}/spectator?battle=${id}&token={spectatorOtp}`;

    if(this.el.adminLink) this.el.adminLink.value = admin;
    if(this.el.playerLink) this.el.playerLink.value = player;
    if(this.el.spectatorLink) this.el.spectatorLink.value = spectator;

    this.log('system','임시 링크 생성(토큰 자리표시자 포함)');
    UI.toast('임시 링크를 생성했습니다. 토큰이 필요합니다.');
  }

  async copy(inputEl){
    if(!inputEl || !inputEl.value) return UI.toast('복사할 링크가 없습니다');
    try{
      await navigator.clipboard.writeText(inputEl.value);
      UI.toast('복사 완료');
    }catch{
      inputEl.select();
      document.execCommand('copy');
      UI.toast('복사 완료');
    }
  }

  /* ================= Players ================= */
  collectPlayer(){
    const name = (this.el.name?.value || '').trim();
    const team = this.teamKey(this.el.team?.value || 'phoenix');
    if(!name){ UI.toast('이름을 입력하세요'); return null; }

    const clamp = (v) => { v = Number(v); if(!Number.isFinite(v)) return 3; return Math.max(1, Math.min(5, v)); };
    const stats = {
      atk: clamp(this.el.atk.value),
      def: clamp(this.el.def.value),
      agi: clamp(this.el.agi.value),
      luk: clamp(this.el.luk.value)
    };
    const items = this.el.item?.value ? [this.el.item.value] : [];
    const hpTgt = Number(this.el.hp?.value || 100);
    this.desiredHp.set(name, hpTgt);
    return { name, team, stats, hp: 100, items };
  }

  async addPlayer(){
    if(!this.battleId) return UI.toast('먼저 전투를 생성하세요');
    const payload = this.collectPlayer(); if(!payload) return;

    try{
      const r = await this.j(`/api/battles/${encodeURIComponent(this.battleId)}/players`, {method:'POST', body:JSON.stringify(payload)});
      const p = r?.player || r; if(!p || !(p.id || p.name)) throw new Error('응답 오류');
      this.players = this.uniqueById([...this.players, p]);
      this.renderRoster(this.players);
      this.resetForm();
      this.log('system', `플레이어 등록: ${p.name} (HP목표:${this.desiredHp.get(p.name)})`);
      UI.toast('플레이어 등록 완료');
    }catch(e){
      this.log('error', '플레이어 등록 실패: ' + e.message);
      UI.toast('플레이어 등록 실패');
    }
  }

  resetForm(){
    if(this.el.name) this.el.name.value = '';
    if(this.el.team) this.el.team.value = 'phoenix';
    ['atk','def','agi','luk'].forEach(k => { if(this.el[k]) this.el[k].value = 3; });
    if(this.el.hp) this.el.hp.value = 100;
    if(this.el.item) this.el.item.value = '';
  }

  async applyDesiredHp(){
    // Apply desired HP after the battle starts
    for(const p of this.players){
      const tgt = this.desiredHp.get(p.name);
      if(!Number.isFinite(tgt)) continue;
      const diff = tgt - 100;
      if(diff === 0) continue;

      const action = diff > 0 ? 'heal_partial' : 'damage';
      const value  = Math.abs(diff);

      // Try REST
      try{
        await this.j(`/api/admin/battles/${encodeURIComponent(this.battleId)}/command`, {
          method: 'POST',
          body: JSON.stringify({action, playerIds:[p.id], value})
        });
        this.log('system', `HP 보정: ${p.name} → ${tgt}`);
        continue;
      }catch(e){}

      // Fallback to socket command
      await new Promise((res, rej) => {
        try{
          this.socket.emit('admin:command',
            {battleId:this.battleId, action, playerIds:[p.id], value},
            (r)=> r?.success ? res() : rej(new Error(r?.error || 'command failed')));
        }catch(err){ rej(err); }
      });
      this.log('system', `HP 보정(WS): ${p.name} → ${tgt}`);
    }
  }

  renderRoster(players){
    const list = Array.isArray(players) ? players : [];
    this.players = this.uniqueById(list);

    const by = { phoenix: [], eaters: [] };
    for(const p of this.players){
      (this.teamKey(p.team) === 'phoenix' ? by.phoenix : by.eaters).push(p);
    }

    const make = (p) => {
      const name = this.escape(p.name || '플레이어');
      const atk = p.stats?.atk ?? p.atk ?? '-';
      const def = p.stats?.def ?? p.def ?? '-';
      const agi = p.stats?.agi ?? p.agi ?? '-';
      const luk = p.stats?.luk ?? p.luk ?? '-';
      const hpTxt = (typeof p.hp === 'number' && typeof p.maxHp === 'number')
        ? ` / HP ${p.hp}/${p.maxHp}`
        : (typeof p.hp === 'number' ? ` / HP ${p.hp}` : '');

      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <div>
          <span class="badge">${name}</span>
          <span class="stat">공격 ${atk} / 방어 ${def} / 민첩 ${agi} / 행운 ${luk}${hpTxt}</span>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-kick="${this.escape(p.id || '')}" data-name="${name}">제거</button>
        </div>`;
      row.querySelector('[data-kick]')?.addEventListener('click', async () => {
        if(!p.id || !this.battleId) return;
        if(!confirm(`플레이어 "${p.name}"을(를) 제거하시겠습니까?`)) return;
        try{
          await this.j(`/api/battles/${encodeURIComponent(this.battleId)}/players/${encodeURIComponent(p.id)}`, {method:'DELETE'});
          this.players = this.players.filter(x => x.id !== p.id);
          this.renderRoster(this.players);
          UI.toast('플레이어 제거됨');
          this.log('system','플레이어 제거: ' + p.name);
        }catch(err){
          UI.toast('플레이어 제거 실패');
          this.log('error','플레이어 제거 실패: ' + err.message);
        }
      });
      return row;
    };

    const hostA = this.el.teamA, hostB = this.el.teamB;
    if(hostA) hostA.innerHTML = '';
    if(hostB) hostB.innerHTML = '';
    by.phoenix.forEach(p => hostA?.appendChild(make(p)));
    by.eaters.forEach(p => hostB?.appendChild(make(p)));

    if(this.el.teamACount) this.el.teamACount.textContent = String(by.phoenix.length);
    if(this.el.teamBCount) this.el.teamBCount.textContent = String(by.eaters.length);
  }

  /* ================= Chat / Log ================= */
  sendChat(){
    const v = (this.el.chatInput?.value || '').trim();
    if(!v) return;
    if(this.socket?.connected && this.authed){
      this.socket.emit('chatMessage', {role:'admin', message:v, battleId:this.battleId});
    }
    this.appendChat('관리자', v);
    this.el.chatInput.value = '';
  }

  appendChat(sender, msg){
    const box = this.el.chat; if(!box) return;
    const t = new Date();
    const hh = String(t.getHours()).padStart(2,'0');
    const mm = String(t.getMinutes()).padStart(2,'0');
    const ss = String(t.getSeconds()).padStart(2,'0');

    const item = document.createElement('div');
    item.className = 'chat-item';
    item.innerHTML = `<span class="time">${hh}:${mm}:${ss}</span><span class="type">${this.escape(sender)}</span><span class="msg">${this.escape(msg)}</span>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  log(type, msg){
    const box = this.el.log;
    const t = new Date();
    const hh = String(t.getHours()).padStart(2,'0');
    const mm = String(t.getMinutes()).padStart(2,'0');
    const ss = String(t.getSeconds()).padStart(2,'0');
    if(box){
      const item = document.createElement('div');
      item.className = 'log-item';
      item.innerHTML = `<span class="time">${hh}:${mm}:${ss}</span><span class="type">${this.escape(type)}</span><span class="msg">${this.escape(msg)}</span>`;
      box.appendChild(item);
      box.scrollTop = box.scrollHeight;
    } else {
      console.log(`[${hh}:${mm}:${ss}] [${type}] ${msg}`);
    }
  }

  /* ================= Utils ================= */
  updatePill(state){
    const pill = this.el.pill; if(!pill) return;
    pill.classList.remove('wait','live','end');
    const map = {wait:'대기', live:'진행', end:'종료'};
    pill.classList.add(state in map ? state : 'wait');
    pill.textContent = map[state] || map.wait;
  }

  updatePillByStatus(st){
    const s = String(st || '').toLowerCase();
    if(/live|running|in_progress/.test(s)) return this.updatePill('live');
    if(/end|ended|finished/.test(s)) return this.updatePill('end');
    return this.updatePill('wait');
  }

  teamKey(t){
    const s = String(t || '').toLowerCase();
    if(['phoenix','a','team1'].includes(s)) return 'phoenix';
    if(['eaters','b','team2','death','deatheaters'].includes(s)) return 'eaters';
    return 'phoenix';
  }

  uniqueById(arr){
    const m = new Map();
    (arr || []).forEach(it => {
      const k = it?.id || it?.playerId || it?.name;
      if(!m.has(k)) m.set(k, it);
    });
    return Array.from(m.values());
  }

  escape(v){
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  }

  cleanup(){
    this.stopHeartbeat();
    this.stopSync();
    try{ this.socket?.disconnect(); }catch{}
  }
}

/* ---------------------------------------------------------
   Bootstrap
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const admin = new AdminUI();
  window.adminInterface = admin;
});
