// PYXIS FX Engine - Enhanced Gaming Combat Effects
// 게임다운 전투 이펙트, 타이머 시스템, 햅틱 피드백, 사운드 효과
(function(){
  'use strict';

  class PyxisFXEngine {
    constructor(){
      this.layer = null;
      this.soundLayer = null;
      this.battleTimer = null;
      this.turnTimer = null;
      this.turnTimerEl = null;
      this.battleEndsAt = null;
      this.onTurnExpire = null;
      this.boundRippleTargets = new WeakSet();
      this.battleChip = null;
      this.audioContext = null;
      this.masterVolume = 0.3;
      this.effectsEnabled = true;
      this.hapticEnabled = true;
      this.soundEnabled = false; // 기본값 false
      
      // 이펙트 큐
      this.effectQueue = [];
      this.isProcessingEffects = false;
      
      // 성능 최적화
      this.activeEffects = new Set();
      this.effectPool = new Map();
      this.rafId = null;
      
      this.init();
    }

    init(){
      this.initAudioContext();
      this.injectStyles();
      this.setupPerformanceOptimization();
    }

    // 오디오 컨텍스트 초기화
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

    // 스타일 주입
    injectStyles(){
      if (document.getElementById('pyxis-fx-enhanced-styles')) return;

      const styleSheet = document.createElement('style');
      styleSheet.id = 'pyxis-fx-enhanced-styles';
      styleSheet.textContent = `
        /* PYXIS FX Engine - Enhanced Combat Effects */
        
        #fx-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 9999;
          overflow: hidden;
          background: transparent;
        }

        /* 전투 흔들림 효과 */
        @keyframes fx-battle-shake {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          15% { transform: translate3d(-4px, 0, 0) scale(1.01); }
          30% { transform: translate3d(5px, -2px, 0) scale(0.99); }
          45% { transform: translate3d(-3px, 2px, 0) scale(1.01); }
          60% { transform: translate3d(4px, -1px, 0) scale(0.99); }
          75% { transform: translate3d(-2px, 1px, 0) scale(1.005); }
        }

        .fx-shake {
          animation: fx-battle-shake 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          will-change: transform;
        }

        .fx-shake.intense {
          animation-duration: 0.7s;
          animation-iteration-count: 2;
        }

        /* 펄스 효과 */
        @keyframes fx-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
          100% { transform: scale(1); opacity: 1; }
        }

        .fx-pulse {
          animation: fx-pulse 0.6s ease-in-out;
        }

        /* 글로우 효과 */
        @keyframes fx-glow {
          0%, 100% { 
            box-shadow: 0 0 20px rgba(220, 199, 162, 0.3);
            filter: brightness(1);
          }
          50% { 
            box-shadow: 0 0 40px rgba(220, 199, 162, 0.6);
            filter: brightness(1.2);
          }
        }

        .fx-glow {
          animation: fx-glow 1s ease-in-out infinite;
        }

        /* 타격 스파크 */
        .fx-hit-spark {
          position: absolute;
          width: 20px;
          height: 20px;
          background: radial-gradient(circle, 
            #DCC7A2 0%, 
            #D4BA8D 35%, 
            transparent 70%);
          border-radius: 50%;
          opacity: 0;
          transform: scale(0.5);
          animation: fx-spark-burst 0.6s ease-out forwards;
          box-shadow: 
            0 0 25px rgba(220, 199, 162, 0.7),
            0 0 50px rgba(220, 199, 162, 0.4);
          filter: blur(0.5px);
        }

        @keyframes fx-spark-burst {
          0% { 
            opacity: 0; 
            transform: scale(0.3) rotate(0deg); 
            filter: blur(1px) brightness(1);
          }
          25% { 
            opacity: 1; 
            transform: scale(1.2) rotate(90deg); 
            filter: blur(0px) brightness(1.4);
          }
          60% { 
            opacity: 0.8; 
            transform: scale(1.6) rotate(180deg); 
            filter: blur(1px) brightness(1.2);
          }
          100% { 
            opacity: 0; 
            transform: scale(2.5) rotate(270deg); 
            filter: blur(2px) brightness(0.8);
          }
        }

        /* 치명타 버스트 */
        .fx-crit-burst {
          position: absolute;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: radial-gradient(circle, 
            #DCC7A2 0%, 
            #D4BA8D 25%, 
            rgba(220, 199, 162, 0.5) 50%, 
            transparent 80%);
          opacity: 0;
          animation: fx-critical-impact 0.8s ease-out forwards;
          box-shadow: 
            0 0 40px rgba(220, 199, 162, 0.9),
            0 0 80px rgba(220, 199, 162, 0.5);
        }

        .fx-crit-burst::before {
          content: '';
          position: absolute;
          inset: -15px;
          border-radius: 50%;
          background: conic-gradient(
            #DCC7A2, 
            transparent, 
            #D4BA8D, 
            transparent, 
            #DCC7A2
          );
          opacity: 0.7;
          animation: fx-crit-ring 0.8s linear forwards;
        }

        @keyframes fx-critical-impact {
          0% { 
            opacity: 0; 
            transform: scale(0.4) rotate(0deg); 
            filter: blur(2px) brightness(1);
          }
          30% { 
            opacity: 1; 
            transform: scale(1.3) rotate(60deg); 
            filter: blur(0px) brightness(1.5);
          }
          70% { 
            opacity: 0.9; 
            transform: scale(1.8) rotate(120deg); 
            filter: blur(1px) brightness(1.3);
          }
          100% { 
            opacity: 0; 
            transform: scale(2.8) rotate(180deg); 
            filter: blur(3px) brightness(0.6);
          }
        }

        @keyframes fx-crit-ring {
          0% { transform: scale(0.8) rotate(0deg); opacity: 0.7; }
          50% { transform: scale(1.3) rotate(180deg); opacity: 0.9; }
          100% { transform: scale(2.2) rotate(360deg); opacity: 0; }
        }

        /* 방어/힐 링 */
        .fx-ring {
          position: absolute;
          width: 70px;
          height: 70px;
          border-radius: 50%;
          border: 4px solid #DCC7A2;
          box-shadow: 
            0 0 25px rgba(220, 199, 162, 0.6),
            inset 0 0 20px rgba(220, 199, 162, 0.3);
          opacity: 0;
          animation: fx-protective-ring 0.9s ease-out forwards;
        }

        .fx-ring.heal {
          border-color: #22C55E;
          box-shadow: 
            0 0 25px rgba(34, 197, 94, 0.6),
            inset 0 0 20px rgba(34, 197, 94, 0.3);
        }

        .fx-ring.shield {
          border-color: #D4BA8D;
          background: radial-gradient(circle, 
            transparent 60%, 
            rgba(220, 199, 162, 0.15) 80%);
        }

        @keyframes fx-protective-ring {
          0% { 
            opacity: 0; 
            transform: scale(0.5); 
            filter: blur(2px);
          }
          40% { 
            opacity: 1; 
            transform: scale(1.2); 
            filter: blur(0px);
          }
          70% { 
            opacity: 0.8; 
            transform: scale(1.5); 
            filter: blur(0.5px);
          }
          100% { 
            opacity: 0; 
            transform: scale(2.2); 
            filter: blur(2px);
          }
        }

        /* 떠오르는 텍스트 */
        .fx-float {
          position: absolute;
          color: #E2E8F0;
          font-weight: 900;
          font-family: 'Inter', sans-serif;
          font-size: 22px;
          text-shadow: 
            0 2px 4px rgba(0, 8, 13, 0.9),
            0 0 25px rgba(220, 199, 162, 0.4);
          opacity: 0;
          transform: translate(-50%, 0);
          animation: fx-damage-float 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          pointer-events: none;
          z-index: 10000;
        }

        .fx-float.crit {
          color: #DCC7A2;
          font-size: 30px;
          font-weight: 700;
          text-shadow: 
            0 3px 6px rgba(0, 8, 13, 0.9),
            0 0 30px rgba(220, 199, 162, 0.7),
            0 0 60px rgba(220, 199, 162, 0.4);
        }

        .fx-float.block {
          color: #94A3B8;
          font-size: 20px;
          font-style: italic;
        }

        .fx-float.heal {
          color: #22C55E;
          font-size: 24px;
          text-shadow: 
            0 2px 4px rgba(0, 8, 13, 0.8),
            0 0 25px rgba(34, 197, 94, 0.5);
        }

        .fx-float.miss {
          color: #F59E0B;
          font-size: 18px;
          font-style: italic;
          opacity: 0.9;
        }

        @keyframes fx-damage-float {
          0% { 
            opacity: 0; 
            transform: translate(-50%, 15px) scale(0.8); 
            filter: blur(2px);
          }
          20% { 
            opacity: 1; 
            transform: translate(-50%, -10px) scale(1.1); 
            filter: blur(0px);
          }
          80% { 
            opacity: 0.9; 
            transform: translate(-50%, -35px) scale(1); 
            filter: blur(0px);
          }
          100% { 
            opacity: 0; 
            transform: translate(-50%, -60px) scale(0.9); 
            filter: blur(1px);
          }
        }

        /* 버튼 리플 */
        .fx-ripple {
          position: absolute;
          border-radius: 50%;
          transform: scale(0);
          background: radial-gradient(circle, 
            #DCC7A2 0%, 
            rgba(220, 199, 162, 0.6) 40%, 
            transparent 80%);
          opacity: 0.8;
          pointer-events: none;
          animation: fx-button-ripple 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
          mix-blend-mode: screen;
        }

        @keyframes fx-button-ripple {
          0% { 
            transform: scale(0); 
            opacity: 0.8; 
          }
          50% { 
            transform: scale(4); 
            opacity: 0.5; 
          }
          100% { 
            transform: scale(8); 
            opacity: 0; 
          }
        }

        /* 전역 배틀 타이머 */
        #fx-battle-timer {
          position: fixed;
          top: 24px;
          right: 24px;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
          background: linear-gradient(145deg, 
            rgba(0, 30, 53, 0.9), 
            rgba(0, 42, 75, 0.8));
          border: 2px solid rgba(220, 199, 162, 0.3);
          border-radius: 20px;
          backdrop-filter: blur(12px);
          box-shadow: 
            0 8px 32px rgba(0, 8, 13, 0.6),
            0 0 0 1px rgba(220, 199, 162, 0.1);
          z-index: 9998;
          pointer-events: none;
          font-family: 'Inter', sans-serif;
        }

        #fx-battle-timer .ring {
          --pct: 100;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          position: relative;
          background: conic-gradient(
            #DCC7A2 calc(var(--pct) * 1%), 
            rgba(0, 30, 53, 0.8) 0
          );
          box-shadow: 
            0 0 20px rgba(220, 199, 162, 0.4),
            inset 0 0 10px rgba(0, 8, 13, 0.6);
        }

        #fx-battle-timer .ring::after {
          content: '';
          position: absolute;
          inset: 6px;
          border-radius: 50%;
          background: #00080D;
          border: 1px solid rgba(220, 199, 162, 0.2);
        }

        #fx-battle-timer .txt {
          font-weight: 700;
          color: #94A3B8;
          font-size: 16px;
          letter-spacing: 0.5px;
          text-shadow: 0 1px 2px rgba(0, 8, 13, 0.8);
        }

        /* 턴 타이머 */
        .fx-turn-timer {
          --pct: 100;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: linear-gradient(145deg, 
            rgba(0, 30, 53, 0.8), 
            rgba(0, 42, 75, 0.7));
          border: 2px solid rgba(220, 199, 162, 0.25);
          border-radius: 16px;
          backdrop-filter: blur(8px);
          box-shadow: 0 4px 20px rgba(0, 8, 13, 0.5);
          margin-bottom: 16px;
        }

        .fx-turn-timer .ring {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: conic-gradient(
            #DCC7A2 calc(var(--pct) * 1%), 
            rgba(0, 30, 53, 0.6) 0
          );
          box-shadow: 
            0 0 15px rgba(220, 199, 162, 0.3),
            inset 0 0 8px rgba(0, 8, 13, 0.5);
          position: relative;
        }

        .fx-turn-timer .ring::after {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          background: #00080D;
          border: 1px solid rgba(220, 199, 162, 0.15);
        }

        .fx-turn-timer .txt {
          font-weight: 600;
          color: #E2E8F0;
          font-size: 14px;
          letter-spacing: 0.3px;
        }

        /* 파티클 효과 */
        .fx-particle {
          position: absolute;
          width: 4px;
          height: 4px;
          background: #DCC7A2;
          border-radius: 50%;
          opacity: 0;
          animation: fx-particle-float 2s ease-out forwards;
          box-shadow: 0 0 10px rgba(220, 199, 162, 0.5);
        }

        @keyframes fx-particle-float {
          0% { 
            opacity: 1; 
            transform: translateY(0) scale(1); 
          }
          100% { 
            opacity: 0; 
            transform: translateY(-100px) scale(0.5); 
          }
        }

        /* 화면 번쩍임 */
        .fx-screen-flash {
          position: fixed;
          inset: 0;
          background: radial-gradient(circle, 
            rgba(220, 199, 162, 0.3) 0%, 
            transparent 70%);
          opacity: 0;
          animation: fx-flash 0.3s ease-out forwards;
          pointer-events: none;
          z-index: 9999;
        }

        @keyframes fx-flash {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }

        /* 모바일 최적화 */
        @media (max-width: 768px) {
          #fx-battle-timer {
            top: 16px;
            right: 16px;
            padding: 12px 16px;
            gap: 10px;
          }

          #fx-battle-timer .ring {
            width: 28px;
            height: 28px;
          }

          #fx-battle-timer .txt {
            font-size: 14px;
          }

          .fx-float {
            font-size: 18px;
          }

          .fx-float.crit {
            font-size: 24px;
          }
        }

        /* 성능 최적화 */
        @media (prefers-reduced-motion: reduce) {
          .fx-shake,
          .fx-pulse,
          .fx-glow,
          .fx-hit-spark,
          .fx-crit-burst,
          .fx-ring,
          .fx-float,
          .fx-ripple,
          .fx-particle {
            animation: none !important;
          }
        }
      `;

      document.head.appendChild(styleSheet);
    }

    // 성능 최적화 설정
    setupPerformanceOptimization(){
      // 이펙트 풀 초기화
      this.effectPool.set('spark', []);
      this.effectPool.set('crit', []);
      this.effectPool.set('ring', []);
      this.effectPool.set('float', []);
      this.effectPool.set('particle', []);

      // RAF 최적화
      this.startEffectLoop();
    }

    // 이펙트 루프 시작
    startEffectLoop(){
      const loop = () => {
        this.processEffectQueue();
        this.cleanupInactiveEffects();
        this.rafId = requestAnimationFrame(loop);
      };
      loop();
    }

    // 이펙트 큐 처리
    processEffectQueue(){
      if (this.effectQueue.length === 0) return;

      const effect = this.effectQueue.shift();
      if (effect && this.effectsEnabled) {
        effect();
      }
    }

    // 비활성 이펙트 정리
    cleanupInactiveEffects(){
      this.activeEffects.forEach(effect => {
        if (!effect.parentNode || effect.offsetParent === null) {
          this.activeEffects.delete(effect);
        }
      });
    }

    // 레이어 마운트
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

    // 유틸리티 메서드들
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
      
      setTimeout(() => {
        if (el.parentNode) {
          el.remove();
          this.activeEffects.delete(el);
        }
      }, duration);
    }

    _formatTime(ms){
      const sec = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(sec / 3600).toString().padStart(2, '0');
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      return `${h}:${m}:${s}`;
    }

    // 햅틱 피드백
    vibrate(pattern){
      if (!this.hapticEnabled || !navigator.vibrate) return;
      try {
        navigator.vibrate(pattern);
      } catch (error) {
        console.warn('Vibration failed:', error);
      }
    }

    // 사운드 재생
    playSound(type, frequency = 440, duration = 0.2, volume = 0.3){
      if (!this.soundEnabled || !this.audioContext) return;

      try {
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume * this.masterVolume, this.audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

        switch (type) {
          case 'hit':
            oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(400, this.audioContext.currentTime + duration);
            break;
          case 'crit':
            oscillator.frequency.setValueAtTime(1200, this.audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1400, this.audioContext.currentTime + 0.1);
            oscillator.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + duration);
            break;
          case 'heal':
            oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime);
            oscillator.frequency.linearRampToValueAtTime(900, this.audioContext.currentTime + duration);
            break;
          case 'shield':
            oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime);
            oscillator.frequency.linearRampToValueAtTime(500, this.audioContext.currentTime + duration);
            break;
          case 'miss':
            oscillator.frequency.setValueAtTime(200, this.audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + duration);
            break;
          case 'button':
            oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
            break;
          default:
            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        }

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
      } catch (error) {
        console.warn('Sound playback failed:', error);
      }
    }

    // 버튼 클릭 강화
    enhanceClicks(root = document){
      const selectors = ['.btn', '.action-btn', '.cheer-btn', '.target-card', '.enhance-hover'];
      
      root.querySelectorAll(selectors.join(',')).forEach(btn => {
        if (this.boundRippleTargets.has(btn)) return;
        this.boundRippleTargets.add(btn);

        const computedStyle = getComputedStyle(btn);
        if (computedStyle.position === 'static') {
          btn.style.position = 'relative';
        }

        btn.addEventListener('pointerdown', (e) => {
          this.createRipple(e);
          this.playSound('button', 800, 0.1, 0.2);
          this.vibrate(20);
        }, { passive: true });
      });
    }

    // 리플 생성
    createRipple(e){
      const ripple = document.createElement('span');
      ripple.className = 'fx-ripple';
      
      const rect = e.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size/2}px`;
      ripple.style.top = `${e.clientY - rect.top - size/2}px`;
      
      e.currentTarget.appendChild(ripple);
      
      setTimeout(() => {
        if (ripple.parentNode) {
          ripple.remove();
        }
      }, 700);
    }

    // 전투 이펙트들
    sparkAt(el, options = {}){
      if (!el || !this.effectsEnabled) return;
      
      this.mount();
      const { crit = false, ring = false, intense = false } = options;
      const center = this._rectCenter(el);
      
      // 스파크 이펙트
      const spark = document.createElement('div');
      spark.className = crit ? 'fx-crit-burst' : 'fx-hit-spark';
      this._place(spark, center.x - (crit ? 30 : 10), center.y - (crit ? 30 : 10), crit ? 800 : 600);

      // 링 이펙트
      if (ring) {
        setTimeout(() => {
          const ringEl = document.createElement('div');
          ringEl.className = `fx-ring ${ring === 'heal' ? 'heal' : ring === 'shield' ? 'shield' : ''}`;
          this._place(ringEl, center.x - 35, center.y - 35, 900);
        }, 100);
      }

      // 파티클 효과 (치명타시)
      if (crit) {
        this.createParticles(center, 8);
      }

      // 사운드
      if (crit) {
        this.playSound('crit', 1200, 0.4, 0.4);
      } else {
        this.playSound('hit', 800, 0.2, 0.3);
      }
    }

    // 파티클 생성
    createParticles(center, count = 5){
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const particle = document.createElement('div');
          particle.className = 'fx-particle';
          
          const angle = (360 / count) * i + Math.random() * 30;
          const distance = 20 + Math.random() * 40;
          const x = center.x + Math.cos(angle * Math.PI / 180) * distance;
          const y = center.y + Math.sin(angle * Math.PI / 180) * distance;
          
          this._place(particle, x, y, 2000);
        }, i * 50);
      }
    }

    // 텍스트 플로팅
    floatText(el, text, className = ''){
      if (!el || !this.effectsEnabled) return;
      
      this.mount();
      const center = this._rectCenter(el);
      const floatEl = document.createElement('div');
      floatEl.className = `fx-float ${className}`;
      floatEl.textContent = text;
      
      // 랜덤 오프셋으로 겹침 방지
      const offsetX = (Math.random() - 0.5) * 20;
      const offsetY = (Math.random() - 0.5) * 10;
      
      this._place(floatEl, center.x + offsetX, center.y - 10 + offsetY, 1200);
    }

    // 카드 흔들림
    shake(el, intense = false){
      if (!el || !this.effectsEnabled) return;
      
      el.classList.remove('fx-shake');
      el.classList.add('fx-shake');
      if (intense) el.classList.add('intense');
      
      setTimeout(() => {
        el.classList.remove('fx-shake', 'intense');
      }, intense ? 700 : 500);
    }

    // 펄스 효과
    pulse(el){
      if (!el || !this.effectsEnabled) return;
      
      el.classList.remove('fx-pulse');
      el.classList.add('fx-pulse');
      
      setTimeout(() => {
        el.classList.remove('fx-pulse');
      }, 600);
    }

    // 글로우 효과
    glow(el, duration = 2000){
      if (!el || !this.effectsEnabled) return;
      
      el.classList.add('fx-glow');
      
      setTimeout(() => {
        el.classList.remove('fx-glow');
      }, duration);
    }

    // 화면 번쩍임
    screenFlash(color = 'rgba(220, 199, 162, 0.3)'){
      if (!this.effectsEnabled) return;
      
      const flash = document.createElement('div');
      flash.className = 'fx-screen-flash';
      flash.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
      
      document.body.appendChild(flash);
      
      setTimeout(() => {
        if (flash.parentNode) {
          flash.remove();
        }
      }, 300);
    }

    // 조합 이펙트들
    showHit(targetEl, damage, options = {}){
      const { crit = false, blocked = false, intense = false } = options;
      
      this.sparkAt(targetEl, { crit, intense });
      this.floatText(targetEl, (blocked ? '차단 ' : '') + `${damage}`, crit ? 'crit' : (blocked ? 'block' : ''));
      this.shake(targetEl, intense || crit);
      
      if (crit) {
        this.screenFlash('rgba(220, 199, 162, 0.2)');
        this.vibrate([40, 40, 60]);
      } else {
        this.vibrate(blocked ? [15, 30] : 30);
      }
    }

    showHeal(targetEl, amount, type = 'heal'){
      this.sparkAt(targetEl, { ring: 'heal' });
      this.floatText(targetEl, `+${amount}`, 'heal');
      this.pulse(targetEl);
      this.playSound('heal', 600, 0.3, 0.3);
      this.vibrate(25);
    }

    showShield(targetEl, amount = null){
      this.sparkAt(targetEl, { ring: 'shield' });
      if (amount) {
        this.floatText(targetEl, `방어 +${amount}`, 'block');
      }
      this.glow(targetEl, 1500);
      this.playSound('shield', 300, 0.4, 0.3);
      this.vibrate([20, 50, 20]);
    }

    showDodge(targetEl){
      this.floatText(targetEl, '회피!', 'miss');
      this.pulse(targetEl);
      this.playSound('miss', 200, 0.3, 0.2);
      this.vibrate([15, 30, 15]);
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
        this.playSound('heal', 700, 0.3, 0.3);
        this.vibrate([30, 50]);
      } else {
        this.playSound('miss', 200, 0.2, 0.2);
        this.vibrate([10, 20, 10]);
      }
    }

    // 상태 변화 이펙트
    showStatusChange(targetEl, status, isPositive = true){
      const className = isPositive ? 'heal' : 'miss';
      this.floatText(targetEl, status, className);
      
      if (isPositive) {
        this.glow(targetEl, 2000);
      } else {
        this.shake(targetEl);
      }
    }

    // 배틀 타이머 (1시간)
    startBattleTimer(totalMs = 3600000){
      this.mount();
      
      const chip = this.battleChip;
      if (!chip) return;
      
      this.battleEndsAt = Date.now() + totalMs;
      const ring = chip.querySelector('.ring');
      const txt = chip.querySelector('.txt');
      
      clearInterval(this.battleTimer);
      
      const tick = () => {
        const remaining = this.battleEndsAt - Date.now();
        const percentage = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
        
        if (ring) ring.style.setProperty('--pct', percentage);
        if (txt) txt.textContent = this._formatTime(remaining);
        
        // 시간 경고 효과
        if (remaining <= 300000 && remaining > 0) { // 5분 남음
          chip.style.borderColor = '#F59E0B';
          if (remaining <= 60000) { // 1분 남음
            chip.style.borderColor = '#EF4444';
            chip.classList.add('fx-pulse');
          }
        }
        
        if (remaining <= 0) {
          clearInterval(this.battleTimer);
          if (txt) txt.textContent = '00:00:00';
          chip.style.borderColor = '#EF4444';
          this.screenFlash('rgba(239, 68, 68, 0.3)');
          document.dispatchEvent(new CustomEvent('pyxis:battle:timeup'));
        }
      };
      
      tick();
      this.battleTimer = setInterval(tick, 1000);
    }

    // 턴 타이머 (5분)
    attachTurnTimer(anchorEl, onExpire){
      this.mount();
      this.onTurnExpire = onExpire;
      
      if (!anchorEl) return;

      if (!this.turnTimerEl) {
        const timerBox = document.createElement('div');
        timerBox.className = 'fx-turn-timer';
        timerBox.innerHTML = `<div class="ring"></div><div class="txt">05:00</div>`;
        anchorEl.prepend(timerBox);
        this.turnTimerEl = timerBox;
      }
    }

    startTurnTimer(totalMs = 300000){
      if (!this.turnTimerEl) return;
      
      const ring = this.turnTimerEl.querySelector('.ring');
      const txt = this.turnTimerEl.querySelector('.txt');
      const startTime = Date.now();
      
      clearInterval(this.turnTimer);
      
      const tick = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, totalMs - elapsed);
        const percentage = (remaining / totalMs) * 100;
        
        if (ring) ring.style.setProperty('--pct', percentage);
        
        const minutes = Math.floor(remaining / 60000).toString().padStart(2, '0');
        const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
        if (txt) txt.textContent = `${minutes}:${seconds}`;
        
        // 시간 경고
        if (remaining <= 60000 && remaining > 0) { // 1분 남음
          this.turnTimerEl.style.borderColor = '#F59E0B';
          if (remaining <= 30000) { // 30초 남음
            this.turnTimerEl.style.borderColor = '#EF4444';
            this.turnTimerEl.classList.add('fx-pulse');
          }
        }
        
        if (remaining <= 0) {
          clearInterval(this.turnTimer);
          this.turnTimerEl.style.borderColor = '#EF4444';
          this.vibrate([100, 100, 100]);
          
          try {
            if (this.onTurnExpire) this.onTurnExpire();
          } catch (error) {
            console.error('Turn expire callback failed:', error);
          }
        }
      };
      
      tick();
      this.turnTimer = setInterval(tick, 1000);
    }

    stopTurnTimer(){
      clearInterval(this.turnTimer);
      
      if (this.turnTimerEl) {
        const ring = this.turnTimerEl.querySelector('.ring');
        const txt = this.turnTimerEl.querySelector('.txt');
        
        if (ring) ring.style.setProperty('--pct', 100);
        if (txt) txt.textContent = '05:00';
        
        this.turnTimerEl.style.borderColor = 'rgba(220, 199, 162, 0.25)';
        this.turnTimerEl.classList.remove('fx-pulse');
      }
    }

    // 설정 메서드들
    setEffectsEnabled(enabled){
      this.effectsEnabled = enabled;
      if (!enabled) {
        // 활성 이펙트 정리
        this.activeEffects.forEach(effect => {
          if (effect.parentNode) {
            effect.remove();
          }
        });
        this.activeEffects.clear();
      }
    }

    setSoundEnabled(enabled){
      this.soundEnabled = enabled;
      if (enabled && !this.audioContext) {
        this.initAudioContext();
      }
    }

    setHapticEnabled(enabled){
      this.hapticEnabled = enabled;
    }

    setMasterVolume(volume){
      this.masterVolume = Math.max(0, Math.min(1, volume));
      if (this.masterGain) {
        this.masterGain.gain.value = this.masterVolume;
      }
    }

    // 고급 기능들
    createComboEffect(targetEl, comboCount){
      if (comboCount <= 1) return;
      
      // 콤보 텍스트
      this.floatText(targetEl, `${comboCount} COMBO!`, 'crit');
      
      // 콤보에 따른 이펙트 강화
      for (let i = 0; i < Math.min(comboCount, 5); i++) {
        setTimeout(() => {
          this.sparkAt(targetEl, { crit: comboCount >= 3 });
        }, i * 100);
      }
      
      // 높은 콤보일수록 강한 효과
      if (comboCount >= 5) {
        this.screenFlash('rgba(220, 199, 162, 0.4)');
        this.vibrate([50, 50, 100, 50, 100]);
      } else if (comboCount >= 3) {
        this.vibrate([30, 50, 30]);
      }
      
      this.playSound('crit', 1000 + (comboCount * 100), 0.3 + (comboCount * 0.05), 0.4);
    }

    createAreaEffect(centerEl, targets, effectType = 'explosion'){
      if (!centerEl || !targets.length) return;
      
      const center = this._rectCenter(centerEl);
      
      // 중심 폭발 효과
      this.sparkAt(centerEl, { crit: true, intense: true });
      this.screenFlash('rgba(220, 199, 162, 0.3)');
      
      // 각 타겟에 순차적 효과
      targets.forEach((target, index) => {
        setTimeout(() => {
          this.sparkAt(target, { ring: true });
          this.shake(target);
        }, index * 150);
      });
      
      // 사운드와 진동
      this.playSound('crit', 800, 0.6, 0.5);
      this.vibrate([100, 50, 100, 50, 150]);
    }

    createWeatherEffect(type = 'stars', duration = 5000){
      if (!this.effectsEnabled) return;
      
      this.mount();
      
      const particleCount = type === 'stars' ? 20 : 30;
      const interval = duration / particleCount;
      
      for (let i = 0; i < particleCount; i++) {
        setTimeout(() => {
          const particle = document.createElement('div');
          particle.className = 'fx-particle';
          
          if (type === 'stars') {
            particle.style.background = '#DCC7A2';
            particle.style.boxShadow = '0 0 15px rgba(220, 199, 162, 0.8)';
          }
          
          const x = Math.random() * window.innerWidth;
          const y = -20;
          
          this._place(particle, x, y, 3000);
        }, i * interval);
      }
    }

    // 디버그 및 테스트 메서드들
    testAllEffects(targetEl){
      if (!targetEl) {
        console.warn('Target element required for effect testing');
        return;
      }
      
      console.log('Testing PYXIS FX Engine effects...');
      
      setTimeout(() => this.showHit(targetEl, 15), 0);
      setTimeout(() => this.showCritical(targetEl, 30), 1000);
      setTimeout(() => this.showHeal(targetEl, 10), 2000);
      setTimeout(() => this.showShield(targetEl, 5), 3000);
      setTimeout(() => this.showDodge(targetEl), 4000);
      setTimeout(() => this.showItemUse(targetEl, '디터니', true), 5000);
      setTimeout(() => this.showItemUse(targetEl, '공격 보정기', false), 6000);
      setTimeout(() => this.createComboEffect(targetEl, 4), 7000);
    }

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

    // 정리
    destroy(){
      // 타이머 정리
      clearInterval(this.battleTimer);
      clearInterval(this.turnTimer);
      
      // RAF 정리
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }
      
      // DOM 정리
      if (this.layer) {
        this.layer.remove();
        this.layer = null;
      }
      
      if (this.battleChip) {
        this.battleChip.remove();
        this.battleChip = null;
      }
      
      if (this.turnTimerEl) {
        this.turnTimerEl.remove();
        this.turnTimerEl = null;
      }
      
      // 오디오 정리
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      
      // 데이터 정리
      this.activeEffects.clear();
      this.effectPool.clear();
      this.effectQueue.length = 0;
      this.boundRippleTargets = new WeakSet();
      
      // 스타일시트 제거
      const styleSheet = document.getElementById('pyxis-fx-enhanced-styles');
      if (styleSheet) {
        styleSheet.remove();
      }
      
      console.log('PYXIS FX Engine destroyed');
    }
  }

  // 전역 인스턴스 생성
  window.PyxisFX = new PyxisFXEngine();

  // 호환성을 위한 별칭
  window.FX = window.PyxisFX;

  // 자동 초기화
  document.addEventListener('DOMContentLoaded', () => {
    window.PyxisFX.enhanceClicks();
    console.log('PYXIS FX Engine initialized');
  });

  // 페이지 언로드시 정리
  window.addEventListener('beforeunload', () => {
    window.PyxisFX.destroy();
  });

})();
