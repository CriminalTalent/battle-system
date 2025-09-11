/* PYXIS Effects.js
   - 전투 UI 보조 애니메이션 / 시각 효과 컨트롤러
   - effects.css 와 연동
   - 이모지 금지 (유니코드 장식은 CSS로만)
*/
(function () {
  "use strict";

  const BANNER_ID = "pyxis-result-banner";

  const Effects = {
    init() {
      this.ensureBanner();
      this.bindCheerButtons();
      this.observeTimeline();
      this.twinkleStars();
      this.bindCardHover();
      this.bindButtonShimmer();
      this.applyBackdropBlur();
    },

    bindCheerButtons() {
      const buttons = document.querySelectorAll(".cheer-btn");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          btn.classList.add("shimmer");
          setTimeout(() => btn.classList.remove("shimmer"), 1500);
        });
      });
    },

    observeTimeline() {
      const timeline = document.getElementById("timelineFeed") || document.getElementById("battleLog") || document.getElementById("log");
      if (!timeline) return;

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              node.classList.add("tl-flash");
              setTimeout(() => node.classList.remove("tl-flash"), 1200);
            }
          });
        });
      });

      observer.observe(timeline, { childList: true });
    },

    twinkleStars() {
      const stars = document.querySelectorAll('.twinkle-star');
      stars.forEach((star) => {
        const animate = () => {
          star.style.animation = 'none';
          void star.offsetWidth; // reflow
          star.style.animation = '';
        };
        star.addEventListener('animationend', animate);
        setInterval(() => {
          star.classList.add('twinkle');
          setTimeout(() => star.classList.remove('twinkle'), 1200 + Math.random() * 800);
        }, 2000 + Math.random() * 2000);
      });
    },

    bindCardHover() {
      const cards = document.querySelectorAll('.battle-card, .info-card, .card');
      cards.forEach((card) => {
        card.addEventListener('mouseenter', () => card.classList.add('lift'));
        card.addEventListener('mouseleave', () => card.classList.remove('lift'));
      });
    },

    bindButtonShimmer() {
      const buttons = document.querySelectorAll('.shimmer-btn, .premium-btn, .btn');
      buttons.forEach((btn) => {
        btn.addEventListener('mouseenter', () => btn.classList.add('shimmer'));
        btn.addEventListener('mouseleave', () => btn.classList.remove('shimmer'));
      });
    },

    applyBackdropBlur() {
      const panels = document.querySelectorAll('.glass, .battle-card, .info-card, .modal, .backdrop-blur');
      panels.forEach((el) => el.classList.add('backdrop-blur'));
    },

    ensureBanner() {
      if (document.getElementById(BANNER_ID)) return;
      const el = document.createElement('div');
      el.id = BANNER_ID;
      el.className = 'pyxis-banner';
      document.body.appendChild(el);
    },

    showResultBanner(text, type = 'info', holdMs = 1400) {
      const el = document.getElementById(BANNER_ID);
      if (!el) return;
      el.textContent = text;
      el.className = 'pyxis-banner show';
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => { el.className = 'pyxis-banner'; }, Math.max(holdMs, 1200));
    },

    tagLog(div, kind) {
      if (!div) return;
      div.classList.add('log-item');
      if (kind) div.classList.add(kind);
    },

    bannerFirst(teamAB){ this.showResultBanner(`선공: ${teamAB}팀`, 'first'); },
    bannerKill(name){ this.showResultBanner(`${name} 사망`, 'kill'); },
    bannerWin(teamAB){ this.showResultBanner(`${teamAB}팀 승리`, 'win', 2000); },
    bannerResolve(){ this.showResultBanner('라운드 해석', 'resolve'); },
    bannerCommit(teamAB){ this.showResultBanner(`커밋 시작: ${teamAB}팀`, 'commit'); },
  };

  window.PyxisEffects = Effects;
  window.addEventListener("DOMContentLoaded", () => Effects.init());
})();
