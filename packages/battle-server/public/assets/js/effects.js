// packages/battle-server/public/assets/js/effects.js
/* PYXIS Effects.js
   - 전투 UI 보조 애니메이션 / 시각 효과 컨트롤러
   - effects.css 와 연동
   - 이모지 금지 (유니코드 장식은 CSS로만)
   - 팀 표기는 규정대로 A/B만 사용
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

    /* ─────────────────────────────
     * 기본 인터랙션
     * ───────────────────────────── */
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
      const timeline =
        document.getElementById("timelineFeed") ||
        document.getElementById("battleLog") ||
        document.getElementById("log");
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
      const stars = document.querySelectorAll(".twinkle-star");
      stars.forEach((star) => {
        const animate = () => {
          star.style.animation = "none";
          // reflow
          void star.offsetWidth;
          star.style.animation = "";
        };
        star.addEventListener("animationend", animate);
        setInterval(() => {
          star.classList.add("twinkle");
          setTimeout(() => star.classList.remove("twinkle"), 1200 + Math.random() * 800);
        }, 2000 + Math.random() * 2000);
      });
    },

    bindCardHover() {
      const cards = document.querySelectorAll(".battle-card, .info-card, .card");
      cards.forEach((card) => {
        card.addEventListener("mouseenter", () => card.classList.add("lift"));
        card.addEventListener("mouseleave", () => card.classList.remove("lift"));
      });
    },

    bindButtonShimmer() {
      const buttons = document.querySelectorAll(".shimmer-btn, .premium-btn, .btn");
      buttons.forEach((btn) => {
        btn.addEventListener("mouseenter", () => btn.classList.add("shimmer"));
        btn.addEventListener("mouseleave", () => btn.classList.remove("shimmer"));
      });
    },

    applyBackdropBlur() {
      const panels = document.querySelectorAll(
        ".glass, .battle-card, .info-card, .modal, .backdrop-blur"
      );
      panels.forEach((el) => el.classList.add("backdrop-blur"));
    },

    /* ─────────────────────────────
     * 배너
     * ───────────────────────────── */
    ensureBanner() {
      if (document.getElementById(BANNER_ID)) return;
      const el = document.createElement("div");
      el.id = BANNER_ID;
      el.className = "pyxis-banner";
      document.body.appendChild(el);
    },

    showResultBanner(text, type = "info", holdMs = 1400) {
      const el = document.getElementById(BANNER_ID);
      if (!el) return;
      el.textContent = String(text || "");
      el.className = "pyxis-banner show " + (type || "info");
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => {
        el.className = "pyxis-banner";
      }, Math.max(holdMs, 1200));
    },

    /* ─────────────────────────────
     * 로그 꾸미기
     * ───────────────────────────── */
    tagLog(div, kind) {
      if (!div) return;
      div.classList.add("log-item");
      if (kind) div.classList.add(kind);
    },

    /* ─────────────────────────────
     * 규정 이벤트 배너(팀 표기 A/B 고정)
     * ───────────────────────────── */
    bannerFirst(teamAB) {
      // 선공: 규정상 팀은 "A" 또는 "B"만 사용
      const t = teamAB === "A" ? "A" : teamAB === "B" ? "B" : "?";
      this.showResultBanner(`선공: ${t}팀`, "first");
    },
    bannerKill(name) {
      this.showResultBanner(`${String(name || "")} 사망`, "kill");
    },
    bannerWin(teamAB) {
      const t = teamAB === "A" ? "A" : teamAB === "B" ? "B" : "?";
      this.showResultBanner(`${t}팀 승리`, "win", 2000);
    },
    bannerResolve() {
      this.showResultBanner("라운드 해석", "resolve");
    },
    bannerCommit(teamAB) {
      const t = teamAB === "A" ? "A" : teamAB === "B" ? "B" : "?";
      this.showResultBanner(`커밋 시작: ${t}팀`, "commit");
    },

    /* ─────────────────────────────
     * 룰 반영 보조 배너 (선택 사용)
     * - 치명타/회피/방어 태세 성공 등 UI 힌트
     * ───────────────────────────── */
    bannerCritical(attackerName) {
      this.showResultBanner(`${String(attackerName || "")} 치명타`, "critical");
    },
    bannerDodgeSuccess(defenderName) {
      this.showResultBanner(`${String(defenderName || "")} 회피 성공`, "dodge");
    },
    bannerDefendSuccess(defenderName) {
      this.showResultBanner(`${String(defenderName || "")} 방어 성공`, "defend");
    },
    bannerUseItem(playerName, itemName) {
      this.showResultBanner(`${String(playerName || "")} ${String(itemName || "")} 사용`, "item");
    },
  };

  window.PyxisEffects = Effects;
  window.addEventListener("DOMContentLoaded", () => Effects.init());
})();
