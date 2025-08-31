// PYXIS FX Engine – 전투 이펙트/타이머/모바일 터치 햅틱 (디자인 컬러/레이아웃 변경 없음)
(function(){
  class FX {
    constructor(){
      this.layer = null;
      this.battleTimer = null;
      this.turnTimer = null;
      this.turnTimerEl = null;
      this.battleEndsAt = null; // Date.now() + 1h
      this.onTurnExpire = null;
      this.boundRippleTargets = new WeakSet();
    }

    mount(){
      if (this.layer) return;
      this.layer = document.createElement('div');
      this.layer.id = 'fx-layer';
      document.body.appendChild(this.layer);
      // 전역 배틀 타이머 UI
      const chip = document.createElement('div');
      chip.id = 'fx-battle-timer';
      chip.innerHTML = `<div class="ring"></div><div class="txt">--:--:--</div>`;
      document.body.appendChild(chip);
      this.battleChip = chip;
    }

    // ===== Basic Utilities =====
    _rectCenter(el){
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    }
    _place(el, x, y){
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
      this.layer.appendChild(el);
      // auto remove
      setTimeout(()=> el.remove(), 1000);
    }
    _formatLeftMS(ms){
      const sec = Math.max(0, Math.floor(ms/1000));
      const h = Math.floor(sec/3600).toString().padStart(2,'0');
      const m = Math.floor((sec%3600)/60).toString().padStart(2,'0');
      const s = (sec%60).toString().padStart(2,'0');
      return `${h}:${m}:${s}`;
    }
    vibrate(pattern){
      if (navigator.vibrate) try{ navigator.vibrate(pattern); }catch(_){}
    }

    // ===== Click/Tap Ripple =====
    enhanceClicks(root=document){
      const sel = ['.btn', '.action-btn', '.cheer-btn'];
      root.querySelectorAll(sel.join(',')).forEach(btn=>{
        if (this.boundRippleTargets.has(btn)) return;
        this.boundRippleTargets.add(btn);
        btn.style.position = getComputedStyle(btn).position === 'static' ? 'relative' : getComputedStyle(btn).position;
        btn.addEventListener('pointerdown', (e)=>{
          const rip = document.createElement('span');
          rip.className = 'fx-ripple';
          const rect = e.currentTarget.getBoundingClientRect();
          const size = Math.max(rect.width, rect.height);
          rip.style.width = rip.style.height = `${size}px`;
          rip.style.left = `${e.clientX - rect.left - size/2}px`;
          rip.style.top  = `${e.clientY - rect.top  - size/2}px`;
          e.currentTarget.appendChild(rip);
          setTimeout(()=> rip.remove(), 700);
        }, {passive:true});
      });
    }

    // ===== Combat Effects =====
    sparkAt(el, {crit=false, ring=false}={}){
      if (!el) return;
      const p = this._rectCenter(el);
      const node = document.createElement('div');
      node.className = crit ? 'fx-crit-burst' : 'fx-hit-spark';
      this._place(node, p.x-7, p.y-7);
      if (ring){
        const r = document.createElement('div');
        r.className = 'fx-ring';
        this._place(r, p.x-27, p.y-27);
      }
    }
    floatText(el, text, cls=''){
      if (!el) return;
      const p = this._rectCenter(el);
      const t = document.createElement('div');
      t.className = `fx-float ${cls||''}`;
      t.textContent = text;
      this._place(t, p.x, p.y-10);
    }
    shake(el){ if (el) { el.classList.add('fx-shake'); setTimeout(()=> el.classList.remove('fx-shake'), 400); } }

    // shorthand
    showHit(targetEl, dmg, {crit=false, blocked=false}={}){
      this.sparkAt(targetEl, {crit});
      this.floatText(targetEl, (blocked?'−':'') + `${dmg}`, crit?'crit':(blocked?'block':''));
      this.shake(targetEl);
      this.vibrate(crit ? [40,40,60] : 30);
    }
    showHeal(targetEl, amount){
      this.sparkAt(targetEl, {ring:true});
      this.floatText(targetEl, `+${amount}`, 'heal');
      this.vibrate(20);
    }
    showDodge(targetEl){
      this.floatText(targetEl, '회피', 'miss');
      this.vibrate([15,30,15]);
    }

    // ===== Battle Timer (1h) =====
    startBattleTimer(totalMs=3600000){
      this.mount();
      const chip = this.battleChip;
      this.battleEndsAt = Date.now() + totalMs;
      const ring = chip.querySelector('.ring');
      const txt  = chip.querySelector('.txt');

      clearInterval(this.battleTimer);
      const tick = ()=>{
        const left = this.battleEndsAt - Date.now();
        const pct = Math.max(0, Math.min(100, Math.floor(100*left/totalMs)));
        ring.style.setProperty('--pct', pct);
        txt.textContent = this._formatLeftMS(left);
        if (left <= 0){
          clearInterval(this.battleTimer);
          txt.textContent = '00:00:00';
          document.dispatchEvent(new CustomEvent('pyxis:battle:timeup'));
        }
      };
      tick();
      this.battleTimer = setInterval(tick, 1000);
    }

    // ===== Turn Timer (5min) + autopass callback =====
    attachTurnTimer(anchorEl, onExpire){
      this.mount();
      this.onTurnExpire = onExpire;
      if (!anchorEl) return;

      if (!this.turnTimerEl){
        const box = document.createElement('div');
        box.className = 'fx-turn-timer';
        box.innerHTML = `<div class="ring"></div><div class="txt">05:00</div>`;
        anchorEl.prepend(box);
        this.turnTimerEl = box;
      }
    }
    startTurnTimer(totalMs=300000){
      if (!this.turnTimerEl) return;
      const ring = this.turnTimerEl.querySelector('.ring');
      const txt  = this.turnTimerEl.querySelector('.txt');
      const started = Date.now();
      clearInterval(this.turnTimer);
      const tick = ()=>{
        const spent = Date.now() - started;
        const left  = Math.max(0, totalMs - spent);
        const pct   = Math.max(0, Math.min(100, Math.floor(100*left/totalMs)));
        ring.style.setProperty('--pct', pct);

        const m = Math.floor(left/60000).toString().padStart(2,'0');
        const s = Math.floor((left%60000)/1000).toString().padStart(2,'0');
        txt.textContent = `${m}:${s}`;

        if (left <= 0){
          clearInterval(this.turnTimer);
          try{ this.onTurnExpire && this.onTurnExpire(); }catch(_){}
        }
      };
      tick();
      this.turnTimer = setInterval(tick, 1000);
    }
    stopTurnTimer(){
      clearInterval(this.turnTimer);
      if (this.turnTimerEl){
        const ring = this.turnTimerEl.querySelector('.ring');
        const txt  = this.turnTimerEl.querySelector('.txt');
        ring && ring.style.setProperty('--pct', 100);
        txt  && (txt.textContent = '05:00');
      }
    }
  }

  // 글로벌
  window.PyxisFX = new FX();
})();
