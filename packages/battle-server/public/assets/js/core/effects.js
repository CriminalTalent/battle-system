// PYXIS FX Engine - Enhanced Gaming Combat Effects (Revised)
// - 게임다운 전투 이펙트, 타이머, 햅틱, 사운드
// - 관전자/관리자 UI와 느슨 결합: 문서 이벤트/소켓 바인딩, 타깃 엘리먼트 자동 탐색
// - 로컬스토리지로 효과/사운드/햅틱 설정 유지
// - 퍼포먼스: 요청 큐, RAF 루프, 모션 축소 존중
(function(){
  'use strict';

  const LS_KEYS = {
    effects: 'pyxis_fx_effects_enabled',
    sound:   'pyxis_fx_sound_enabled',
    haptic:  'pyxis_fx_haptic_enabled',
    volume:  'pyxis_fx_master_volume'
  };

  class PyxisFXEngine {
    constructor(){
      // DOM 레이어
      this.layer = null;
      this.battleChip = null;
      this.turnTimerEl = null;

      // 오디오
      this.audioContext = null;
      this.masterGain = null;
      this.masterVolume = 0.3;
      this.soundEnabled = false; // 기본 false (사용자 제스처 후 활성 권장)

      // 햅틱/이펙트
      this.effectsEnabled = true;
      this.hapticEnabled = true;

      // 타이머
      this.battleTimer = null;
      this.turnTimer = null;
      this.battleEndsAt = null;
      this.onTurnExpire = null;

      // 내부 상태/큐
      this.boundRippleTargets = new WeakSet();
      this.effectQueue = [];
      this.activeEffects = new Set();
      this.rafId = null;

      // 선택자 힌트(느슨 결합)
      this.playerSelectors = [
        '[data-player-id="{{id}}"]',
        '.player-item .player-name',  // 관전자 UI
        '.player-row .badge'          // 관리자 UI
      ];

      // 초기화
      this.init();
    }

    /* ================= 초기화 ================= */
    init(){
      // 설정 복원
      this.restorePrefs();

      // 접근성: 모션 축소 선호시 이펙트 기본 OFF
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.effectsEnabled = false;
      }

      // 오디오 준비
      this.initAudioContext();

      // 스타일 & 루프
      this.injectStyles();
      this.startEffectLoop();

      // 전역 이벤트 리스너(선택 사용)
      this.attachDocumentEventBridge();
    }

    restorePrefs(){
      try {
        const e = localStorage.getItem(LS_KEYS.effects);
        const s = localStorage.getItem(LS_KEYS.sound);
        const h = localStorage.getItem(LS_KEYS.haptic);
        const v = localStorage.getItem(LS_KEYS.volume);
        if (e !== null) this.effectsEnabled = e === '1';
        if (s !== null) this.soundEnabled   = s === '1';
        if (h !== null) this.hapticEnabled  = h === '1';
        if (v !== null) this.masterVolume   = Math.max(0, Math.min(1, Number(v)));
      } catch {}
    }
    persistPrefs(){
      try {
        localStorage.setItem(LS_KEYS.effects, this.effectsEnabled ? '1' : '0');
        localStorage.setItem(LS_KEYS.sound,   this.soundEnabled   ? '1' : '0');
        localStorage.setItem(LS_KEYS.haptic,  this.hapticEnabled  ? '1' : '0');
        localStorage.setItem(LS_KEYS.volume,  String(this.masterVolume));
      } catch {}
    }

    /* ================= 오디오 ================= */
    initAudioContext(){
      try {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.masterVolume;
        this.masterGain.connect(this.audioContext.destination);
      } catch (error) {
        console.warn('Audio context initialization failed:', error);
        this.soundEnabled = false;
      }
    }

    playSound(type, frequency = 440, duration = 0.2, volume = 0.3){
      if (!this.soundEnabled || !this.audioContext) return;

      try {
        if (this.audioContext.state === 'suspended') {
          // 사용자가 명시적으로 사운드를 켰다면 resume 시도
          this.audioContext.resume().catch(()=>{});
        }

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.connect(gain);
        gain.connect(this.masterGain);

        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(volume * this.masterVolume, this.audioContext.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

        switch (type) {
          case 'hit':
            osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, this.audioContext.currentTime + duration);
            break;
          case 'crit':
            osc.frequency.setValueAtTime(1200, this.audioContext.currentTime);
            osc.frequency.setValueAtTime(1400, this.audioContext.currentTime + 0.1);
            osc.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + duration);
            break;
          case 'heal':
            osc.frequency.setValueAtTime(600, this.audioContext.currentTime);
            osc.frequency.linearRampToValueAtTime(900, this.audioContext.currentTime + duration);
            break;
          case 'shield':
            osc.frequency.setValueAtTime(300, this.audioContext.currentTime);
            osc.frequency.linearRampToValueAtTime(500, this.audioContext.currentTime + duration);
            break;
          case 'miss':
            osc.frequency.setValueAtTime(200, this.audioContext.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + duration);
            break;
          case 'button':
            osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
            break;
          default:
            osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        }
        osc.start(this.audioContext.currentTime);
        osc.stop(this.audioContext.currentTime + duration);
      } catch (error) {
        console.warn('Sound playback failed:', error);
      }
    }

    /* ================= 스타일/레이아웃 ================= */
    injectStyles(){
      if (document.getElementById('pyxis-fx-enhanced-styles')) return;
      const styleSheet = document.createElement('style');
      styleSheet.id = 'pyxis-fx-enhanced-styles';
      styleSheet.textContent = `
        /* PYXIS FX Engine - Enhanced Combat Effects */
        #fx-layer{position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;background:transparent}

        @keyframes fx-battle-shake{
          0%,100%{transform:translate3d(0,0,0) scale(1)}
          15%{transform:translate3d(-4px,0,0) scale(1.01)}
          30%{transform:translate3d(5px,-2px,0) scale(.99)}
          45%{transform:translate3d(-3px,2px,0) scale(1.01)}
          60%{transform:translate3d(4px,-1px,0) scale(.99)}
          75%{transform:translate3d(-2px,1px,0) scale(1.005)}
        }
        .fx-shake{animation:fx-battle-shake .5s cubic-bezier(.68,-.55,.265,1.55);will-change:transform}
        .fx-shake.intense{animation-duration:.7s;animation-iteration-count:2}

        @keyframes fx-pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.8}100%{transform:scale(1);opacity:1}}
        .fx-pulse{animation:fx-pulse .6s ease-in-out}

        @keyframes fx-glow{
          0%,100%{box-shadow:0 0 20px rgba(220,199,162,.3);filter:brightness(1)}
          50%{box-shadow:0 0 40px rgba(220,199,162,.6);filter:brightness(1.2)}
        }
        .fx-glow{animation:fx-glow 1s ease-in-out infinite}

        .fx-hit-spark{
          position:absolute;width:20px;height:20px;border-radius:50%;
          background:radial-gradient(circle,#DCC7A2 0%,#D4BA8D 35%,transparent 70%);
          opacity:0;transform:scale(.5);animation:fx-spark-burst .6s ease-out forwards;
          box-shadow:0 0 25px rgba(220,199,162,.7),0 0 50px rgba(220,199,162,.4);filter:blur(.5px)
        }
        @keyframes fx-spark-burst{
          0%{opacity:0;transform:scale(.3) rotate(0);filter:blur(1px) brightness(1)}
          25%{opacity:1;transform:scale(1.2) rotate(90deg);filter:blur(0) brightness(1.4)}
          60%{opacity:.8;transform:scale(1.6) rotate(180deg);filter:blur(1px) brightness(1.2)}
          100%{opacity:0;transform:scale(2.5) rotate(270deg);filter:blur(2px) brightness(.8)}
        }

        .fx-crit-burst{
          position:absolute;width:60px;height:60px;border-radius:50%;
          background:radial-gradient(circle,#DCC7A2 0%,#D4BA8D 25%,rgba(220,199,162,.5) 50%,transparent 80%);
          opacity:0;animation:fx-critical-impact .8s ease-out forwards;
          box-shadow:0 0 40px rgba(220,199,162,.9),0 0 80px rgba(220,199,162,.5)
        }
        .fx-crit-burst::before{
          content:'';position:absolute;inset:-15px;border-radius:50%;
          background:conic-gradient(#DCC7A2,transparent,#D4BA8D,transparent,#DCC7A2);
          opacity:.7;animation:fx-crit-ring .8s linear forwards
        }
        @keyframes fx-critical-impact{
          0%{opacity:0;transform:scale(.4) rotate(0);filter:blur(2px) brightness(1)}
          30%{opacity:1;transform:scale(1.3) rotate(60deg);filter:blur(0) brightness(1.5)}
          70%{opacity:.9;transform:scale(1.8) rotate(120deg);filter:blur(1px) brightness(1.3)}
          100%{opacity:0;transform:scale(2.8) rotate(180deg);filter:blur(3px) brightness(.6)}
        }
        @keyframes fx-crit-ring{
          0%{transform:scale(.8) rotate(0);opacity:.7}
          50%{transform:scale(1.3) rotate(180deg);opacity:.9}
          100%{transform:scale(2.2) rotate(360deg);opacity:0}
        }

        .fx-ring{
          position:absolute;width:70px;height:70px;border-radius:50%;border:4px solid #DCC7A2;
          box-shadow:0 0 25px rgba(220,199,162,.6),inset 0 0 20px rgba(220,199,162,.3);
          opacity:0;animation:fx-protective-ring .9s ease-out forwards
        }
        .fx-ring.heal{border-color:#22C55E;box-shadow:0 0 25px rgba(34,197,94,.6),inset 0 0 20px rgba(34,197,94,.3)}
        .fx-ring.shield{border-color:#D4BA8D;background:radial-gradient(circle,transparent 60%,rgba(220,199,162,.15) 80%)}
        @keyframes fx-protective-ring{
          0%{opacity:0;transform:scale(.5);filter:blur(2px)}
          40%{opacity:1;transform:scale(1.2);filter:blur(0)}
          70%{opacity:.8;transform:scale(1.5);filter:blur(.5px)}
          100%{opacity:0;transform:scale(2.2);filter:blur(2px)}
        }

        .fx-float{
          position:absolute;color:#E2E8F0;font-weight:900;font-family:Inter,sans-serif;font-size:22px;
          text-shadow:0 2px 4px rgba(0,8,13,.9),0 0 25px rgba(220,199,162,.4);
          opacity:0;transform:translate(-50%,0);animation:fx-damage-float 1.2s cubic-bezier(.25,.46,.45,.94) forwards;
          pointer-events:none;z-index:10000
        }
        .fx-float.crit{color:#DCC7A2;font-size:30px;font-weight:700;text-shadow:0 3px 6px rgba(0,8,13,.9),0 0 30px rgba(220,199,162,.7),0 0 60px rgba(220,199,162,.4)}
        .fx-float.block{color:#94A3B8;font-size:20px;font-style:italic}
        .fx-float.heal{color:#22C55E;font-size:24px;text-shadow:0 2px 4px rgba(0,8,13,.8),0 0 25px rgba(34,197,94,.5)}
        .fx-float.miss{color:#F59E0B;font-size:18px;font-style:italic;opacity:.9}
        @keyframes fx-damage-float{
          0%{opacity:0;transform:translate(-50%,15px) scale(.8);filter:blur(2px)}
          20%{opacity:1;transform:translate(-50%,-10px) scale(1.1);filter:blur(0)}
          80%{opacity:.9;transform:translate(-50%,-35px) scale(1)}
          100%{opacity:0;transform:translate(-50%,-60px) scale(.9);filter:blur(1px)}
        }

        .fx-ripple{
          position:absolute;border-radius:50%;transform:scale(0);
          background:radial-gradient(circle,#DCC7A2 0%,rgba(220,199,162,.6) 40%,transparent 80%);
          opacity:.8;pointer-events:none;animation:fx-button-ripple .7s cubic-bezier(.25,.46,.45,.94) forwards;mix-blend-mode:screen
        }
        @keyframes fx-button-ripple{0%{transform:scale(0);opacity:.8}50%{transform:scale(4);opacity:.5}100%{transform:scale(8);opacity:0}}

        #fx-battle-timer{
          position:fixed;top:24px;right:24px;display:flex;align-items:center;gap:14px;padding:16px 20px;
          background:linear-gradient(145deg, rgba(0,30,53,.9), rgba(0,42,75,.8));
          border:2px solid rgba(220,199,162,.3);border-radius:20px;backdrop-filter:blur(12px);
          box-shadow:0 8px 32px rgba(0,8,13,.6),0 0 0 1px rgba(220,199,162,.1);
          z-index:9998;pointer-events:none;font-family:Inter,sans-serif
        }
        #fx-battle-timer .ring{
          --pct:100;width:36px;height:36px;border-radius:50%;position:relative;
          background:conic-gradient(#DCC7A2 calc(var(--pct) * 1%), rgba(0,30,53,.8) 0);
          box-shadow:0 0 20px rgba(220,199,162,.4), inset 0 0 10px rgba(0,8,13,.6)
        }
        #fx-battle-timer .ring::after{content:'';position:absolute;inset:6px;border-radius:50%;background:#00080D;border:1px solid rgba(220,199,162,.2)}
        #fx-battle-timer .txt{font-weight:700;color:#94A3B8;font-size:16px;letter-spacing:.5px;text-shadow:0 1px 2px rgba(0,8,13,.8)}

        .fx-turn-timer{--pct:100;display:flex;align-items:center;gap:10px;padding:12px 16px;
          background:linear-gradient(145deg, rgba(0,30,53,.8), rgba(0,42,75,.7));
          border:2px solid rgba(220,199,162,.25);border-radius:16px;backdrop-filter:blur(8px);box-shadow:0 4px 20px rgba(0,8,13,.5);margin-bottom:16px}
        .fx-turn-timer .ring{
          width:28px;height:28px;border-radius:50%;
          background:conic-gradient(#DCC7A2 calc(var(--pct) * 1%), rgba(0,30,53,.6) 0);
          box-shadow:0 0 15px rgba(220,199,162,.3), inset 0 0 8px rgba(0,8,13,.5);position:relative
        }
        .fx-turn-timer .ring::after{content:'';position:absolute;inset:4px;border-radius:50%;background:#00080D;border:1px solid rgba(220,199,162,.15)}
        .fx-turn-timer .txt{font-weight:600;color:#E2E8F0;font-size:14px;letter-spacing:.3px}

        .fx-particle{position:absolute;width:4px;height:4px;background:#DCC7A2;border-radius:50%;opacity:0;animation:fx-particle-float 2s ease-out forwards;box-shadow:0 0 10px rgba(220,199,162,.5)}
        @keyframes fx-particle-float{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-100px) scale(.5)}}

        .fx-screen-flash{position:fixed;inset:0;background:radial-gradient(circle, rgba(220,199,162,.3) 0%, transparent 70%);opacity:0;animation:fx-flash .3s ease-out forwards;pointer-events:none;z-index:9999}
        @keyframes fx-flash{0%,100%{opacity:0}50%{opacity:1}}

        @media (max-width:768px){
          #fx-battle-timer{top:16px;right:16px;padding:12px 16px;gap:10px}
          #fx-battle-timer .ring{width:28px;height:28px}
          #fx-battle-timer .txt{font-size:14px}
          .fx-float{font-size:18px}
          .fx-float.crit{font-size:24px}
        }
        @media (prefers-reduced-motion: reduce){
          .fx-shake,.fx-pulse,.fx-glow,.fx-hit-spark,.fx-crit-burst,.fx-ring,.fx-float,.fx-ripple,.fx-particle{animation:none !important}
        }
      `;
      document.head.appendChild(styleSheet);
    }

    mount(){
      if (this.layer) return;

      // 이펙트 레이어
      this.layer = document.createElement('div');
      this.layer.id = 'fx-layer';
      this.layer.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;overflow:hidden;';
      document.body.appendChild(this.layer);

      // 배틀 타이머 칩
      const chip = document.createElement('div');
      chip.id = 'fx-battle-timer';
      chip.innerHTML = `<div class="ring"></div><div class="txt">--:--:--</div>`;
      document.body.appendChild(chip);
      this.battleChip = chip;
    }

    /* ================= 루프/큐 ================= */
    startEffectLoop(){
      const loop = () => {
        try {
          this.processEffectQueue();
          this.cleanupInactiveEffects();
        } finally {
          this.rafId = requestAnimationFrame(loop);
        }
      };
      this.rafId = requestAnimationFrame(loop);
    }
    enqueue(fn){
      if (typeof fn === 'function') this.effectQueue.push(fn);
    }
    processEffectQueue(){
      if (!this.effectsEnabled || this.effectQueue.length === 0) return;
      // 프레임당 최대 n개(폭주 방지)
      const n = Math.min(6, this.effectQueue.length);
      for (let i=0;i<n;i++){
        const job = this.effectQueue.shift();
        try { job && job(); } catch(e){ /* no-op */ }
      }
    }
    cleanupInactiveEffects(){
      this.activeEffects.forEach(el=>{
        if (!el.isConnected) this.activeEffects.delete(el);
      });
    }

    /* ================= 유틸 ================= */
    _rectCenter(el){
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    }
    _place(el, x, y, duration = 1000){
      el.style.position = 'absolute';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      this.layer.appendChild(el);
      this.activeEffects.add(el);
      setTimeout(()=>{ try{ el.remove(); }catch{} this.activeEffects.delete(el); }, duration);
    }
    _formatTime(ms){
      const sec = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(sec / 3600).toString().padStart(2, '0');
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
    vibrate(pattern){
      if (!this.hapticEnabled || !navigator.vibrate) return;
      try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    }

    /* ================= 버튼/클릭 FX ================= */
    enhanceClicks(root = document){
      const selectors = ['.btn', '.action-btn', '.cheer-btn', '.target-card', '.enhance-hover'];
      root.querySelectorAll(selectors.join(',')).forEach(btn=>{
        if (this.boundRippleTargets.has(btn)) return;
        this.boundRippleTargets.add(btn);

        const cs = getComputedStyle(btn);
        if (cs.position === 'static') btn.style.position = 'relative';

        btn.addEventListener('pointerdown', (e)=>{
          this.createRipple(e);
          this.playSound('button', 800, 0.08, 0.18);
          this.vibrate(20);
        }, { passive:true });
      });
    }
    createRipple(e){
      const ripple = document.createElement('span');
      ripple.className = 'fx-ripple';
      const rect = e.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size/2}px`;
      ripple.style.top  = `${e.clientY - rect.top  - size/2}px`;
      e.currentTarget.appendChild(ripple);
      setTimeout(()=>{ try{ ripple.remove(); }catch{} }, 720);
    }

    /* ================= 이펙트 프리미티브 ================= */
    sparkAt(el, options = {}){
      if (!el || !this.effectsEnabled) return;
      this.mount();
      const { crit = false, ring = false, intense = false } = options;
      const center = this._rectCenter(el);

      // 스파크/크리티컬 버스트
      this.enqueue(()=>{
        const spark = document.createElement('div');
        spark.className = crit ? 'fx-crit-burst' : 'fx-hit-spark';
        this._place(spark, center.x - (crit ? 30 : 10), center.y - (crit ? 30 : 10), crit ? 820 : 620);
      });

      // 링 이펙트
      if (ring) {
        setTimeout(()=>{
          const ringEl = document.createElement('div');
          ringEl.className = `fx-ring ${ring === 'heal' ? 'heal' : ring === 'shield' ? 'shield' : ''}`;
          this._place(ringEl, center.x - 35, center.y - 35, 900);
        }, 80);
      }

      // 치명타면 파티클 보너스
      if (crit) this.createParticles(center, 8);

      // 사운드
      this.playSound(crit ? 'crit' : 'hit', crit ? 1200 : 800, crit ? 0.35 : 0.2, crit ? 0.4 : 0.3);
    }

    createParticles(center, count = 5){
      for (let i=0;i<count;i++){
        setTimeout(()=>{
          const p = document.createElement('div');
          p.className = 'fx-particle';
          const angleDeg = (360 / count) * i + Math.random() * 30;
          const angle = angleDeg * Math.PI / 180;
          const dist = 20 + Math.random()*40;
          const x = center.x + Math.cos(angle) * dist;
          const y = center.y + Math.sin(angle) * dist;
          this._place(p, x, y, 2000);
        }, i*50);
      }
    }

    floatText(el, text, className = ''){
      if (!el || !this.effectsEnabled) return;
      this.mount();
      const center = this._rectCenter(el);
      const floatEl = document.createElement('div');
      floatEl.className = `fx-float ${className}`;
      floatEl.textContent = text;
      const offsetX = (Math.random() - 0.5) * 20;
      const offsetY = (Math.random() - 0.5) * 10;
      this._place(floatEl, center.x + offsetX, center.y - 10 + offsetY, 1200);
    }

    shake(el, intense = false){
      if (!el || !this.effectsEnabled) return;
      el.classList.remove('fx-shake','intense');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('fx-shake');
      if (intense) el.classList.add('intense');
      setTimeout(()=> el.classList.remove('fx-shake','intense'), intense ? 720 : 520);
    }

    pulse(el){
      if (!el || !this.effectsEnabled) return;
      el.classList.remove('fx-pulse');
      void el.offsetWidth;
      el.classList.add('fx-pulse');
      setTimeout(()=> el.classList.remove('fx-pulse'), 640);
    }

    glow(el, duration = 2000){
      if (!el || !this.effectsEnabled) return;
      el.classList.add('fx-glow');
      setTimeout(()=> el.classList.remove('fx-glow'), duration);
    }

    screenFlash(color = 'rgba(220, 199, 162, 0.3)'){
      if (!this.effectsEnabled) return;
      const flash = document.createElement('div');
      flash.className = 'fx-screen-flash';
      flash.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
      document.body.appendChild(flash);
      setTimeout(()=>{ try{ flash.remove(); }catch{} }, 320);
    }

    /* ================= 조합 이펙트 ================= */
    showHit(targetEl, damage, options = {}){
      const { crit = false, blocked = false, intense = false } = options;
      this.sparkAt(targetEl, { crit, intense });
      this.floatText(targetEl, (blocked ? '차단 ' : '') + `${damage}`, crit ? 'crit' : (blocked ? 'block' : ''));
      this.shake(targetEl, intense || crit);
      if (crit) {
        this.screenFlash('rgba(220,199,162,0.2)');
        this.vibrate([40,40,60]);
      } else {
        this.vibrate(blocked ? [15,30] : 30);
      }
    }
    showHeal(targetEl, amount){
      this.sparkAt(targetEl, { ring: 'heal' });
      this.floatText(targetEl, `+${amount}`, 'heal');
      this.pulse(targetEl);
      this.playSound('heal', 600, 0.28, 0.28);
      this.vibrate(25);
    }
    showShield(targetEl, amount = null){
      this.sparkAt(targetEl, { ring: 'shield' });
      if (amount) this.floatText(targetEl, `방어 +${amount}`, 'block');
      this.glow(targetEl, 1500);
      this.playSound('shield', 300, 0.34, 0.3);
      this.vibrate([20,50,20]);
    }
    showDodge(targetEl){
      this.floatText(targetEl, '회피!', 'miss');
      this.pulse(targetEl);
      this.playSound('miss', 200, 0.26, 0.18);
      this.vibrate([15,30,15]);
    }
    showMiss(targetEl){
      this.floatText(targetEl, '빗나감', 'miss');
      this.playSound('miss', 150, 0.2, 0.15);
      this.vibrate(10);
    }
    showCritical(targetEl, damage){
      this.showHit(targetEl, damage, { crit: true, intense: true });
      this.floatText(targetEl, '치명타!', 'crit');
    }
    showItemUse(targetEl, itemName, success = true){
      const className = success ? 'heal' : 'miss';
      const text = success ? `${itemName} 성공!` : `${itemName} 실패...`;
      this.floatText(targetEl, text, className);
      this.pulse(targetEl);
      if (success) {
        this.glow(targetEl, 1000);
        this.playSound('heal', 700, 0.28, 0.28);
        this.vibrate([30,50]);
      } else {
        this.playSound('miss', 200, 0.2, 0.18);
        this.vibrate([10,20,10]);
      }
    }
    showStatusChange(targetEl, status, isPositive = true){
      this.floatText(targetEl, status, isPositive ? 'heal' : 'miss');
      if (isPositive) this.glow(targetEl, 2000);
      else this.shake(targetEl);
    }
    createComboEffect(targetEl, comboCount){
      if (comboCount <= 1) return;
      this.floatText(targetEl, `${comboCount} COMBO!`, 'crit');
      for (let i=0;i<Math.min(comboCount,5);i++){
        setTimeout(()=> this.sparkAt(targetEl, { crit: comboCount >= 3 }), i*100);
      }
      if (comboCount >= 5) {
        this.screenFlash('rgba(220,199,162,0.4)');
        this.vibrate([50,50,100,50,100]);
      } else if (comboCount >= 3) {
        this.vibrate([30,50,30]);
      }
      this.playSound('crit', 1000 + (comboCount * 100), 0.28 + (comboCount * 0.04), 0.4);
    }
    createAreaEffect(centerEl, targets, effectType = 'explosion'){
      if (!centerEl || !targets?.length) return;
      this.sparkAt(centerEl, { crit:true, intense:true });
      this.screenFlash('rgba(220,199,162,0.3)');
      targets.forEach((t, i)=> setTimeout(()=>{ this.sparkAt(t, { ring:true }); this.shake(t); }, i*150));
      this.playSound('crit', 800, 0.5, 0.5);
      this.vibrate([100,50,100,50,150]);
    }

    /* ================= 배틀/턴 타이머 ================= */
    startBattleTimer(totalMs = 3600000){
      this.mount();
      const chip = this.battleChip;
      if (!chip) return;
      this.battleEndsAt = Date.now() + totalMs;
      const ring = chip.querySelector('.ring');
      const txt  = chip.querySelector('.txt');
      clearInterval(this.battleTimer);
      const tick = ()=>{
        const remaining = this.battleEndsAt - Date.now();
        const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
        if (ring) ring.style.setProperty('--pct', pct);
        if (txt)  txt.textContent = this._formatTime(remaining);
        if (remaining <= 300000 && remaining > 0) { // 5분 경고
          chip.style.borderColor = '#F59E0B';
          if (remaining <= 60000) {
            chip.style.borderColor = '#EF4444';
            chip.classList.add('fx-pulse');
          }
        }
        if (remaining <= 0) {
          clearInterval(this.battleTimer);
          if (txt) txt.textContent = '00:00:00';
          chip.style.borderColor = '#EF4444';
          this.screenFlash('rgba(239,68,68,0.3)');
          document.dispatchEvent(new CustomEvent('pyxis:battle:timeup'));
        }
      };
      tick();
      this.battleTimer = setInterval(tick, 1000);
    }

    attachTurnTimer(anchorEl, onExpire){
      this.mount();
      this.onTurnExpire = onExpire || null;
      if (!anchorEl) {
        // 관전자 기본 앵커 시도
        anchorEl = document.getElementById('currentAction') || document.body;
      }
      if (!this.turnTimerEl) {
        const box = document.createElement('div');
        box.className = 'fx-turn-timer';
        box.innerHTML = `<div class="ring"></div><div class="txt">05:00</div>`;
        anchorEl.prepend(box);
        this.turnTimerEl = box;
      }
    }
    startTurnTimer(totalMs = 300000){
      if (!this.turnTimerEl) return;
      const ring = this.turnTimerEl.querySelector('.ring');
      const txt  = this.turnTimerEl.querySelector('.txt');
      const start = Date.now();
      clearInterval(this.turnTimer);
      const tick = ()=>{
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, totalMs - elapsed);
        const pct = (remaining / totalMs) * 100;
        if (ring) ring.style.setProperty('--pct', pct);
        const m = Math.floor(remaining/60000).toString().padStart(2,'0');
        const s = Math.floor((remaining%60000)/1000).toString().padStart(2,'0');
        if (txt) txt.textContent = `${m}:${s}`;
        if (remaining <= 60000 && remaining > 0) {
          this.turnTimerEl.style.borderColor = '#F59E0B';
          if (remaining <= 30000) {
            this.turnTimerEl.style.borderColor = '#EF4444';
            this.turnTimerEl.classList.add('fx-pulse');
          }
        }
        if (remaining <= 0) {
          clearInterval(this.turnTimer);
          this.turnTimerEl.style.borderColor = '#EF4444';
          this.vibrate([100,100,100]);
          try { this.onTurnExpire && this.onTurnExpire(); } catch(e){ console.error(e); }
          document.dispatchEvent(new CustomEvent('pyxis:turn:timeup'));
        }
      };
      tick();
      this.turnTimer = setInterval(tick, 1000);
    }
    stopTurnTimer(){
      clearInterval(this.turnTimer);
      if (!this.turnTimerEl) return;
      const ring = this.turnTimerEl.querySelector('.ring');
      const txt  = this.turnTimerEl.querySelector('.txt');
      if (ring) ring.style.setProperty('--pct', 100);
      if (txt)  txt.textContent = '05:00';
      this.turnTimerEl.style.borderColor = 'rgba(220,199,162,0.25)';
      this.turnTimerEl.classList.remove('fx-pulse');
    }

    /* ================= 설정 API ================= */
    setEffectsEnabled(enabled){
      this.effectsEnabled = !!enabled;
      this.persistPrefs();
      if (!enabled) {
        this.activeEffects.forEach(el=>{ try{ el.remove(); }catch{} });
        this.activeEffects.clear();
      }
    }
    setSoundEnabled(enabled){
      this.soundEnabled = !!enabled;
      if (enabled && !this.audioContext) this.initAudioContext();
      this.persistPrefs();
    }
    setHapticEnabled(enabled){
      this.hapticEnabled = !!enabled;
      this.persistPrefs();
    }
    setMasterVolume(volume){
      this.masterVolume = Math.max(0, Math.min(1, volume));
      if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
      this.persistPrefs();
    }

    /* ================= 통합(느슨 결합) ================= */
    // 소켓에 바인딩(선택): 서버 이벤트명을 넘겨주면 FX 자동 적용을 시도
    bindSocket(socket, opts = {}){
      if (!socket) return;
      const ev = Object.assign({
        turnStart: 'turnStart',
        actionResult: 'actionResult',
        battleEnd: 'battleEnd'
      }, opts.events || {});

      socket.on(ev.turnStart, (data)=>{
        // data: { currentPlayerName, timeLimit }
        const anchor = document.getElementById('currentAction') || document.body;
        this.attachTurnTimer(anchor, ()=> socket.emit && socket.emit('pyxis:turn:expired', { name: data?.currentPlayerName }));
        if (data?.timeLimit) this.startTurnTimer((data.timeLimit|0) * 1000);
      });

      socket.on(ev.actionResult, (data)=>{
        // 가능한 필드: { targetId, targetName, amount, critical, blocked, type, message }
        const el = this.findPlayerElement({ id: data?.targetId, name: data?.targetName }) || document.body;
        const msg = (data?.message || '').toString();
        const amount = Number.isFinite(data?.amount) ? data.amount : this._guessAmountFromMessage(msg);
        const t = (data?.type || this._guessTypeFromMessage(msg)).toLowerCase();

        try {
          if (t === 'heal') return this.showHeal(el, Math.abs(amount||0)||10);
          if (t === 'shield' || /방어|보호막/.test(msg)) return this.showShield(el, Math.abs(amount||0)||null);
          if (t === 'miss' || /빗나감|실패|회피/.test(msg)) return /회피/.test(msg) ? this.showDodge(el) : this.showMiss(el);
          if (data?.critical || /치명타|크리티컬/.test(msg)) return this.showCritical(el, Math.abs(amount||0)||20);
          // default: hit
          this.showHit(el, Math.abs(amount||0)||12, { blocked: !!data?.blocked, crit: !!data?.critical });
        } catch(e){ /* ignore */ }
      });

      socket.on(ev.battleEnd, ()=>{
        this.stopTurnTimer();
        this.screenFlash('rgba(239,68,68,0.28)');
      });
    }

    // 문서 이벤트 브리지: 외부에서 document.dispatchEvent(new CustomEvent('pyxis:fx', {detail:{...}}))
    attachDocumentEventBridge(){
      document.addEventListener('pyxis:fx', (e)=>{
        const d = e?.detail || {};
        const el = this.findPlayerElement({ id: d.targetId, name: d.targetName }) || d.targetEl || document.body;
        const amt = d.amount ?? 0;
        switch ((d.kind||'').toLowerCase()){
          case 'hit':     return this.showHit(el, Math.abs(amt)||12, { crit: !!d.crit, blocked: !!d.blocked, intense: !!d.intense });
          case 'crit':    return this.showCritical(el, Math.abs(amt)||22);
          case 'heal':    return this.showHeal(el, Math.abs(amt)||10);
          case 'shield':  return this.showShield(el, Math.abs(amt)||null);
          case 'dodge':   return this.showDodge(el);
          case 'miss':    return this.showMiss(el);
          case 'combo':   return this.createComboEffect(el, Math.max(2, d.comboCount|0));
          case 'area':    return this.createAreaEffect(el, d.targets || [], d.effectType || 'explosion');
          case 'status':  return this.showStatusChange(el, d.text || '상태 변화', !!d.positive);
          case 'flash':   return this.screenFlash(d.color || 'rgba(220,199,162,0.3)');
          default: /* no-op */ break;
        }
      });
    }

    _guessTypeFromMessage(msg){
      if (/치명타|크리티컬/i.test(msg)) return 'crit';
      if (/회복|치유|힐/i.test(msg)) return 'heal';
      if (/방어|보호막|차단/i.test(msg)) return 'shield';
      if (/회피/i.test(msg)) return 'dodge';
      if (/빗나감|실패/i.test(msg)) return 'miss';
      return 'hit';
    }
    _guessAmountFromMessage(msg){
      const m = msg.match(/([+-]?\d{1,4})/);
      return m ? parseInt(m[1], 10) : NaN;
    }

    // 이름/ID로 타깃 DOM 추정(관전자/관리자 UI 호환)
    findPlayerElement(ref = {}){
      const id = ref?.id;
      const name = (ref?.name || '').toString().trim();
      // 1) data-player-id
      if (id){
        const sel = this.playerSelectors[0].replace('{{id}}', CSS.escape(String(id)));
        const byId = document.querySelector(sel);
        if (byId) return this._rowToCard(byId);
      }
      // 2) spectator: .player-item .player-name
      if (name){
        const nodes = document.querySelectorAll(this.playerSelectors[1]);
        for (const n of nodes){
          if (n.textContent.trim() === name) return this._rowToCard(n.closest('.player-item') || n);
        }
      }
      // 3) admin: .player-row .badge
      if (name){
        const nodes = document.querySelectorAll(this.playerSelectors[2]);
        for (const n of nodes){
          if (n.textContent.trim() === name) return this._rowToCard(n.closest('.player-row') || n);
        }
      }
      // 4) 없으면 null
      return null;
    }
    _rowToCard(row){
      // 카드/아이템 루트(효과 적용 시각적으로 보이는 블록 우선)
      return row.querySelector('.player-card') || row;
    }

    /* ================= 상태/정리 ================= */
    getStatus(){
      return {
        effectsEnabled: this.effectsEnabled,
        soundEnabled: this.soundEnabled,
        hapticEnabled: this.hapticEnabled,
        masterVolume: this.masterVolume,
        activeEffects: this.activeEffects.size,
        audioContextState: this.audioContext?.state || 'unavailable',
        battleTimerActive: !!this.battleTimer,
        turnTimerActive: !!this.turnTimer
      };
    }

    destroy(){
      // 타이머
      clearInterval(this.battleTimer);
      clearInterval(this.turnTimer);

      // RAF
      if (this.rafId) cancelAnimationFrame(this.rafId);

      // DOM
      try { this.layer?.remove(); } catch {}
      try { this.battleChip?.remove(); } catch {}
      try { this.turnTimerEl?.remove(); } catch {}
      this.layer = this.battleChip = this.turnTimerEl = null;

      // 오디오
      if (this.audioContext) {
        try { this.audioContext.close(); } catch {}
        this.audioContext = null;
      }

      // 데이터
      this.activeEffects.clear();
      this.effectQueue.length = 0;
      this.boundRippleTargets = new WeakSet();

      // 스타일
      const style = document.getElementById('pyxis-fx-enhanced-styles');
      if (style) try { style.remove(); } catch {}

      // 상태 저장
      this.persistPrefs();

      console.log('PYXIS FX Engine destroyed');
    }
  }

  // 전역 인스턴스
  window.PyxisFX = new PyxisFXEngine();
  window.FX = window.PyxisFX; // 별칭

  // 자동 초기화
  document.addEventListener('DOMContentLoaded', ()=>{
    window.PyxisFX.enhanceClicks();
    // 관객 기본 앵커 자동 연결 시도 (#currentAction 존재 시)
    const anchor = document.getElementById('currentAction');
    if (anchor) window.PyxisFX.attachTurnTimer(anchor, null);
    // 콘솔 안내
    // console.log('PYXIS FX Engine initialized', window.PyxisFX.getStatus());
  });

  // 페이지 언로드시 정리
  window.addEventListener('beforeunload', ()=>{
    window.PyxisFX.destroy();
  });

})();
