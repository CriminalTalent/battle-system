"use strict";

/* =========================================================
   PYXIS Player – External JS (logic only)
   - URL: battle, token, name
   - Socket.IO auth + resilient reconnect
   - Server-driven state: players, my panel, turn, log
   - Actions: attack / defend / dodge / useItem / pass
   - Chat + Log
   - No link generation here
   ========================================================= */

(function ensureSocketIO(){
  if (window.io) return;
  function add(src, onload, onerror){
    var s=document.createElement('script');
    s.src=src; s.async=true; s.onload=onload; s.onerror=onerror;
    document.head.appendChild(s);
  }
  add('/socket.io/socket.io.js', null, function(){
    add('https://cdn.socket.io/4.7.5/socket.io.min.js', null, function(){
      console.warn('Socket.IO client load failed');
    });
  });
})();

/* ---------- UI helpers ---------- */
const UI = (() => {
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  function text(el, v){ if(el) el.textContent = String(v == null ? '' : v); }
  function toast(msg){
    const t = $('#toast'); if(!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1200);
  }
  function setConn({ok, msg}){
    const dot = $('#connDot'); const t = $('#connText');
    if(dot){
      dot.classList.remove('ok','bad');
      if(ok===true) dot.classList.add('ok');
      else if(ok===false) dot.classList.add('bad');
    }
    if(t){ text(t, msg || (ok==null ? '연결 중...' : ok ? '연결됨' : '연결 끊김')); }
  }
  return { $, $$, text, toast, setConn };
})();

/* ---------- background twinkles (optional cosmetic) ---------- */
(function buildTwinkles(){
  const el = document.getElementById('twinkles');
  if(!el) return;
  const n = 20, frag = document.createDocumentFragment();
  for(let i=0;i<n;i++){
    const d = document.createElement('div');
    d.className = 'twinkle';
    d.style.left = Math.round(Math.random()*100)+'%';
    d.style.top  = Math.round(Math.random()*100)+'%';
    frag.appendChild(d);
  }
  el.appendChild(frag);
})();

/* =========================================================
   Core Player App
   ========================================================= */
const PlayerApp = (() => {
  const $ = UI.$, $$ = UI.$$;

  return class PlayerApp {
    constructor(){
      this.socket   = null;
      this.battleId = new URLSearchParams(location.search).get('battle') || '';
      this.name     = '';
      this.token    = '';
      this.authed   = false;
      this.state    = null;

      this.bindAuth();
      this.bindActions();
      this.connect();
    }

    bindAuth(){
      const nameEl  = document.getElementById('authName');
      const tokEl   = document.getElementById('authToken');
      const bidEl   = document.getElementById('authBattleId');
      const btn     = document.getElementById('btnAuth');

      if (this.battleId && bidEl) bidEl.value = this.battleId;

      btn && btn.addEventListener('click', () => {
        this.name     = (nameEl  && nameEl.value || '').trim();
        this.token    = (tokEl   && tokEl.value  || '').trim();
        this.battleId = (bidEl   && bidEl.value  || '').trim() || this.battleId;

        if(!this.battleId || !this.token || !this.name){
          UI.toast('battle / token / 이름을 입력하세요');
          return;
        }
        this.connect(true);
      });
    }

    bindActions(){
      const byId = (id) => document.getElementById(id);
      const btnAttack = byId('btnAttack');
      const btnDefend = byId('btnDefend');
      const btnDodge  = byId('btnDodge');
      const btnItem   = byId('btnItem');
      const btnPass   = byId('btnPass');

      btnAttack && btnAttack.addEventListener('click', ()=> this.emitAction('attack'));
      btnDefend && btnDefend.addEventListener('click', ()=> this.emitAction('defend'));
      btnDodge  && btnDodge .addEventListener('click', ()=> this.emitAction('dodge'));
      btnItem   && btnItem  .addEventListener('click', ()=> this.emitAction('item'));
      btnPass   && btnPass  .addEventListener('click', ()=> this.emitAction('pass'));
    }

    emitAction(kind){
      if(!this.socket || !this.authed) return UI.toast('인증 필요');
      this.socket.emit('player:action', { type: kind });
    }

    connect(byUser){
      if(!window.io){ UI.toast('socket.io 로딩중'); return; }
      if(this.socket){ try { this.socket.disconnect(); } catch(e){} }

      // eslint-disable-next-line no-undef
      this.socket = io('/', { transports:['websocket','polling'] });

      this.socket.on('connect', () => {
        UI.setConn({ok:true});
        // 자동 재인증 또는 버튼으로 요청된 인증
        this._clearReconnect();
        if(this.battleId && this.token){
          // 다양한 서버 케이스 호환
          this.socket.emit('playerAuth', {battleId:this.battleId, token:this.token, name:this.name || undefined});
          this.socket.emit('auth',       {battleId:this.battleId, token:this.token, role:'player', name:this.name || undefined});
          this.socket.emit('join',       {battleId:this.battleId, role:'player',    name:this.name || undefined});
          // 신규 서버용 통합 조인
          this.socket.emit('joinBattle', {battleId:this.battleId, role:'player', playerId:this.name || undefined, otp:this.token});
        }
      });

      this.socket.on('disconnect', () => {
        UI.setConn({ok:false});
        this.authed = false;
        this._scheduleReconnect();
      });

      /* ---- Auth results ---- */
      const onAuthOk = (state) => {
        this.authed = true;
        UI.toast('인증 완료');
        this.applyState(state);
      };
      const onAuthErr = (e) => {
        this.authed = false;
        UI.toast('인증 실패');
      };
      this.socket.on('authSuccess', onAuthOk);
      this.socket.on('auth:ok',     onAuthOk);
      this.socket.on('authError',   onAuthErr);
      this.socket.on('auth:err',    onAuthErr);
      // 신규 서버: joinSuccess 에 state 포함
      this.socket.on('joinSuccess', (p)=> onAuthOk(p && p.state ? p.state : p));

      /* ---- State updates ---- */
      const onState = (state) => this.applyState(state);
      this.socket.on('battleUpdate', onState);
      this.socket.on('state:full',   onState);
      this.socket.on('state:delta',  () => {
        // 일부 서버는 델타만 줌 → 풀스냅샷 재요청
        this.socket.emit('getState', { battleId: this.battleId });
      });

      /* ---- Chat / Log ---- */
      this.socket.on('chatMessage', (m) => this.appendChat(m));
      this.socket.on('chat',        (m) => this.appendChat(m));
      this.socket.on('log',         (m) => this.appendLog(m));

      // 초기 상태 요청
      try { this.socket.emit('getState', { battleId: this.battleId }); } catch(e){}
    }

    applyState(state){
      if(!state) return;
      this.state = state;
      this.renderMe();
      this.renderRoster();
      this.renderTurn();
      this.renderLog();
      const modal = document.getElementById('authModal');
      const main  = document.getElementById('mainUI');
      if (modal && main) { modal.style.display = 'none'; main.style.display = 'block'; }
    }

    /* ---- Render helpers (UI skeleton은 변경하지 않음) ---- */
    renderMe(){
      const me = this.findMe();
      const nameEl   = document.getElementById('playerName');
      const teamEl   = document.getElementById('playerTeam');
      const hpEl     = document.getElementById('playerHp');
      const hpFill   = document.getElementById('hpFill');
      UI.text(nameEl, me?.name || me?.id || '-');
      UI.text(teamEl, me?.team || '-');
      UI.text(hpEl,   me?.hp != null ? me.hp : '-');
      if(hpFill){
        const hp = Math.max(0, Math.min(100, (me?.hp || 0)));
        hpFill.style.width = hp + '%';
      }
    }

    renderRoster(){
      const listEl = document.getElementById('roster'); if(!listEl) return;
      listEl.innerHTML = '';
      const arr = Array.isArray(this.state?.players) ? this.state.players : [];
      arr.forEach(p => {
        const li = document.createElement('div');
        li.className = 'item';
        li.innerHTML = `
          <div class="name">${p.name || p.id || '-'}</div>
          <div class="stat"><span>팀</span><b>${p.team || '-'}</b></div>
          <div class="stat"><span>HP</span><b>${p.hp != null ? p.hp : '-'}</b></div>
        `;
        listEl.appendChild(li);
      });
    }

    renderTurn(){
      const t = document.getElementById('turnStatus');
      const curName = this.state?.turn?.currentName || this.state?.turn?.currentPlayerName || '';
      if(t) UI.text(t, curName ? `현재 턴: ${curName}` : '대기중');
    }

    renderLog(){
      const el = document.getElementById('battleLog'); if(!el) return;
      const lines = this.state?.log || this.state?.logs || [];
      el.innerHTML = '';
      lines.slice(-200).forEach(it => {
        const row = document.createElement('div');
        row.className = 'logline';
        row.textContent = String(it?.text || it?.msg || it);
        el.appendChild(row);
      });
      el.scrollTop = el.scrollHeight;
    }

    appendChat(m){
      const el = document.getElementById('battleLog'); if(!el) return;
      const row = document.createElement('div');
      row.className = 'logline';
      row.textContent = `[채팅] ${(m && (m.name || m.user || '익명'))}: ${m && m.text ? m.text : ''}`;
      el.appendChild(row);
      el.scrollTop = el.scrollHeight;
    }

    appendLog(m){
      const el = document.getElementById('battleLog'); if(!el) return;
      const row = document.createElement('div');
      row.className = 'logline';
      row.textContent = String(m && (m.text || m.msg) || m);
      el.appendChild(row);
      el.scrollTop = el.scrollHeight;
    }

    findMe(){
      const arr = Array.isArray(this.state?.players) ? this.state.players : [];
      return arr.find(p => (p.name && p.name === this.name) || (p.id && p.id === this.name)) || null;
    }

    /* ---- reconnect backoff ---- */
    _scheduleReconnect(){
      if(this._recon) return;
      let n = 0;
      const tick = () => {
        this._recon = setTimeout(() => {
          n = Math.min(n+1, 6);
          this.connect();
        }, Math.min(7000, 1000 * (1+n)));
      };
      tick();
    }
    _clearReconnect(){
      if(this._recon){ clearTimeout(this._recon); this._recon = null; }
    }
  };
})();

/* =========================================================
   Boot
   ========================================================= */
window.addEventListener('DOMContentLoaded', () => {
  window.__PYXIS_PLAYER__ = new PlayerApp();
});
