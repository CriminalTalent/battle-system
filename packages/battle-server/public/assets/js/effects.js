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
    }
  };

  // 전역에 바인딩
  window.PyxisEffects = Effects;

  // DOM 준비 후 실행
  window.addEventListener("DOMContentLoaded", () => {
    Effects.init();
  });
})();
