/* PYXIS Effects.js
   - 전투 UI 보조 애니메이션 / 시각 효과 컨트롤러
   - effects.css 와 연동
   - 이모지 금지 (✦ 같은 유니코드 문자는 CSS 장식 전용)
*/

(function () {
  "use strict";

  const Effects = {
    init() {
      this.bindCheerButtons();
      this.observeTimeline();
      this.twinkleStars();
      this.bindCardHover();
      this.bindButtonShimmer();
      this.applyBackdropBlur();
    },

    // 응원 버튼 클릭 시 shimmer 효과 일시 적용
    bindCheerButtons() {
      const buttons = document.querySelectorAll(".cheer-btn");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          btn.classList.add("shimmer");
          setTimeout(() => btn.classList.remove("shimmer"), 1500);
        });
      });
    },

    // 타임라인에 새로운 로그가 추가되면 flash 효과
    observeTimeline() {
      const timeline = document.getElementById("timelineFeed") || document.getElementById("battleLog");
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

    // ✦ 별 반짝임 효과 (CSS에서 .twinkle-star 사용)
    twinkleStars() {
      const stars = document.querySelectorAll('.twinkle-star');
      stars.forEach((star) => {
        const animate = () => {
          star.style.animation = 'none';
          // 강제로 리플로우
          void star.offsetWidth;
          star.style.animation = '';
        };
        star.addEventListener('animationend', animate);
        setInterval(() => {
          star.classList.add('twinkle');
          setTimeout(() => star.classList.remove('twinkle'), 1200 + Math.random() * 800);
        }, 2000 + Math.random() * 2000);
      });
    },

    // 카드/버튼 hover 시 부드러운 상승 효과
    bindCardHover() {
      const cards = document.querySelectorAll('.battle-card, .info-card');
      cards.forEach((card) => {
        card.addEventListener('mouseenter', () => {
          card.classList.add('lift');
        });
        card.addEventListener('mouseleave', () => {
          card.classList.remove('lift');
        });
      });
    },

    // 버튼 shimmer 효과 (프리미엄 버튼 등)
    bindButtonShimmer() {
      const buttons = document.querySelectorAll('.shimmer-btn, .premium-btn');
      buttons.forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          btn.classList.add('shimmer');
        });
        btn.addEventListener('mouseleave', () => {
          btn.classList.remove('shimmer');
        });
      });
    },

    // 모든 주요 카드/패널에 백드롭 블러 효과 적용
    applyBackdropBlur() {
      const panels = document.querySelectorAll('.glass, .battle-card, .info-card, .modal, .backdrop-blur');
      panels.forEach((el) => {
        el.style.backdropFilter = 'blur(8px)';
        el.style.background = 'rgba(20, 20, 30, 0.55)';
      });
    }
  };

  // 전역에 바인딩
  window.PyxisEffects = Effects;

  // DOM 준비 후 실행
  window.addEventListener("DOMContentLoaded", () => {
    Effects.init();
  });
})();
