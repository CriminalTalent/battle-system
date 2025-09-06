"use strict";

/* =========================================================
   PYXIS Player – External JS (logic only)
   - Reads battle, token, name from URL
   - Socket.IO connection and playerAuth
   - Roster rendering, my panel, turn state
   - Actions: attack / defend / dodge / useItem / pass
   - Chat and Log display
   - No link generation UI/logic here (admin only)
   ========================================================= */

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

(function buildTwinkles(){
  const host = document.getElementById('twinkleLayer'); if(!host) return;
  const count = 70;
  for(let i=0;i<count;i++){
    const s = document.createElement('div'); s.className = 'twinkle';
    const size = (Math.random()*2.5+1).toFixed(2);
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = (Math.random()*100) + '%';
    s.style.top = (Math.random()*100) + '%';
    s.style.animationDuration = (2.0 + Math.random()*3.4).toFixed(2) + 's';
    s.style.opacity = (0.25 + Math.random()*0.55).toFixed(2);
    host.appendChild(s);
  }
})();

class PlayerUI {
  constructor(){
    // Params
    const url = new URL(location.href);
    this.battleId = url.searchParams.get('battle') || '';
    this.token    = url.searchParams.get('token')  || '';
    this.name     = url.searchParams.get('name')   || '';

    // Socket
    this.socket = null;
    this.connected = false;
    this.authed = false;

    // State
    this.me = null;
    this.players = [];
    this.turnFor = null;

    // Elements
    const $ = UI.$;
    this.el = {
      ally: $('#allyUnits'),
      myName: $('#playerName'),
      myTeam: $('#playerTeam'),
      statAtk: $('#statAtk'),
      statDef: $('#statDef'),
      statAgi: $('#statAgi'),
      statLuk: $('#statLuk'),
      hpNow: $('#hpNow'),
      hpMax: $('#hpMax'),
      turnPill: $('#turnPill'),
      turnText: $('#turnText'),
      log: $('#battleLog'),
      chat: $('#chatMessages'),
      chatInput: $('#chatInput'),
      chatSend: $('#chatSendBtn'),
      btnAttack: $('#btnAttack'),
      btnDefend: $('#btnDefend'),
      btnDodge:  $('#btnDodge'),
      btnUseItem:$('#btnUseItem'),
      btnPass:   $('#btnPass')
    };

    this.bind();
    this.connect();
  }

  bind(){
    const e = this.el;
    e.chatSend?.addEventListener('click', () => this.sendChat());
    e.chatInput?.addEventListener('keydown', (ev)=>{
      if(ev.key === 'Enter' && !ev.shiftKey){
        ev.preventDefault();
        this.sendChat();
      }
    });

    e.btnAttack?.addEventListener('click', ()=>this.act('attack'));
    e.btnDefend?.addEventListener('click', ()=>this.act('defend'));
    e.btnDodge?.addEventListener('click',  ()=>this.act('dodge'));
    e.btnUseItem?.addEventListener('click',()=>this.useItem());
    e.btnPass?.addEventListener('click',   ()=>this.act('pass'));
  }

  /* ================= Networking ================= */
  connect(){
    if(!this.battleId || !this.token){
      UI.toast('전투 ID 또는 토큰이 없습니다');
    }
    // eslint-disable-next-line no-undef
    this.socket = io({transports:['websocket','polling']});

    this.socket.on('connect', () => {
      this.connected = true;
      UI.setConn({ok:true, msg:'연결 완료'});
      if(this.battleId && this.token){
        this.socket.emit('playerAuth', {battleId:this.battleId, token:this.token, name:this.name || undefined});
      }
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      UI.setConn({ok:false, msg:'연결 끊김'});
    });

    this.socket.on('authSuccess', (state) => {
      this.authed = true;
      this.applyState(state);
      UI.toast('인증 완료');
    });

    this.socket.on('authError', () => {
      this.authed = false;
      UI.toast('인증 실패');
    });

    // State updates
    this.socket.on('battleUpdate', (state) => {
      this.applyState(state);
    });

    // Chat relay
    this.socket.on('chatMessage', (msg) => {
      this.appendChat(msg?.sender || msg?.role || '채널', msg?.message || '');
    });

    // Direct log line
    this.socket.on('log', (line) => {
      if(line) this.appendLog(line);
    });
  }

  applyState(state){
    if(!state) return;

    // Players
    if(Array.isArray(state.players)){
      this.players = state.players.slice();
      this.renderAllies();
      // Find me by socket mapped id or name
      this.me = this.resolveMe(state);
      this.renderMe();
    }

    // Turn
    if(state.turn && state.turn.current){
      this.turnFor = state.turn.current;
      this.updateTurnPill();
    }

    // Log (append last few)
    if(Array.isArray(state.log)){
      state.log.slice(-5).forEach(l => {
        const msg = typeof l === 'string' ? l : (l.message || '');
        if(msg) this.appendLog(msg);
      });
    }
  }

  resolveMe(state){
    // Prefer server to mark me explicitly
    if(state.self && (state.self.id || state.self.name)) return state.self;

    // Fallback by token mapping in players, else by name
    const byToken = this.players.find(p => p.token === this.token);
    if(byToken) return byToken;
    if(this.name){
      const byName = this.players.find(p => (p.name||'').toLowerCase() === this.name.toLowerCase());
      if(byName) return byName;
    }
    return null;
  }

  renderAllies(){
    const host = this.el.ally; if(!host) return;
    host.innerHTML = '';
    const myTeam = this.teamKey(this.me?.team);

    const allies = this.players.filter(p => this.teamKey(p.team) === myTeam);
    allies.forEach(p => {
      const name = this.escape(p.name || '플레이어');
      const atk = p.stats?.atk ?? p.atk ?? '-';
      const def = p.stats?.def ?? p.def ?? '-';
      const agi = p.stats?.agi ?? p.agi ?? '-';
      const luk = p.stats?.luk ?? p.luk ?? '-';
      const hpTxt = (typeof p.hp === 'number' && typeof p.maxHp === 'number')
        ? `HP ${p.hp}/${p.maxHp}`
        : (typeof p.hp === 'number' ? `HP ${p.hp}` : 'HP -');

      const row = document.createElement('div');
      row.className = 'unit';
      row.innerHTML = `
        <div class="name">${name}</div>
        <div class="stat">${hpTxt} · 공격 ${atk} / 방어 ${def} / 민첩 ${agi} / 행운 ${luk}</div>
      `;
      host.appendChild(row);
    });
  }

  renderMe(){
    const m = this.me || {};
    UI.text(this.el.myName, m.name || '-');
    const tk = this.teamKey(m.team);
    UI.text(this.el.myTeam, tk === 'phoenix' ? '불사조 기사단' : '죽음을 먹는 자들');

    const a = m.stats?.atk ?? m.atk ?? '-';
    const d = m.stats?.def ?? m.def ?? '-';
    const g = m.stats?.agi ?? m.agi ?? '-';
    const l = m.stats?.luk ?? m.luk ?? '-';
    UI.text(this.el.statAtk, a);
    UI.text(this.el.statDef, d);
    UI.text(this.el.statAgi, g);
    UI.text(this.el.statLuk, l);

    const hp = typeof m.hp === 'number' ? m.hp : '-';
    const mx = typeof m.maxHp === 'number' ? m.maxHp : '-';
    UI.text(this.el.hpNow, hp);
    UI.text(this.el.hpMax, mx);
  }

  updateTurnPill(){
    const pill = this.el.turnPill, txt = this.el.turnText;
    const isMine = this.turnFor && this.me && (this.turnFor === this.me.id || this.turnFor === this.me.name);
    if(pill){
      pill.classList.remove('turn','wait','off');
      pill.classList.add(isMine ? 'turn' : 'wait');
      pill.textContent = isMine ? '내 턴' : '대기';
    }
    if(txt) txt.textContent = isMine ? '내가 행동할 차례' : '상대/팀원 턴';
    // Enable/disable buttons
    const enable = !!isMine && this.authed;
    ['btnAttack','btnDefend','btnDodge','btnUseItem','btnPass'].forEach(k=>{
      const b = this.el[k]; if(b) b.disabled = !enable;
    });
  }

  sendChat(){
    const v = (this.el.chatInput?.value || '').trim();
    if(!v) return;
    if(this.socket?.connected && this.authed){
      this.socket.emit('chatMessage', {role:'player', message:v, battleId:this.battleId});
    }
    this.appendChat(this.me?.name || '나', v);
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
    item.innerHTML = `<span class="time">${hh}:${mm}:${ss}</span><span class="msg">${this.escape(sender)}: ${this.escape(msg)}</span>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  appendLog(msg){
    const box = this.el.log; if(!box) return;
    const t = new Date();
    const hh = String(t.getHours()).padStart(2,'0');
    const mm = String(t.getMinutes()).padStart(2,'0');
    const ss = String(t.getSeconds()).padStart(2,'0');
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `<span class="time">${hh}:${mm}:${ss}</span><span class="msg">${this.escape(msg)}</span>`;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  act(kind){
    if(!this.authed || !this.socket?.connected) return UI.toast('행동 불가 상태입니다');
    if(!this.me?.id) return UI.toast('플레이어 정보가 없습니다');
    const payload = { battleId:this.battleId, playerId:this.me.id, action:kind };
    this.socket.emit('player:action', payload, (res)=>{
      if(res?.success){ UI.toast('행동 전송 완료'); }
      else { UI.toast('행동 전송 실패'); }
    });
  }

  useItem(){
    // 서버에서 현재 보유 아이템 확인/소모 처리. 간단히 액션만 보냄.
    this.act('useItem');
  }

  /* ================= Utils ================= */
  teamKey(t){
    const s = String(t || '').toLowerCase();
    if(['phoenix','a','team1'].includes(s)) return 'phoenix';
    if(['eaters','b','team2','death','deatheaters'].includes(s)) return 'eaters';
    return 'phoenix';
  }
  escape(v){
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PlayerUI();
});
