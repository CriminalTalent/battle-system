// packages/battle-server/public/js/core/notifications.js
// ──────────────────────────────────────────────
// 브라우저 알림(Notification API) 헬퍼
// ──────────────────────────────────────────────

/**
 * 알림 권한 요청
 */
export function requestNotificationPermission() {
    if (!("Notification" in window)) {
        console.warn("브라우저가 Notification API를 지원하지 않음");
        return;
    }

    if (Notification.permission === "default") {
        Notification.requestPermission().then((result) => {
            console.log("Notification permission:", result);
        });
    }
}

/**
 * 알림 보내기
 * @param {string} title - 알림 제목
 * @param {string} body - 알림 내용
 * @param {string} icon - 아이콘 이미지 URL (기본값: favicon.svg)
 */
export function sendNotification(
    title,
    body,
    icon = "/assets/images/favicon.svg"
) {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
        new Notification(title, {
            body,
            icon,
            badge: icon,
            lang: "ko",
        });
    } else {
        console.warn("알림 권한이 없음:", Notification.permission);
    }
}

/**
 * 예: 특정 이벤트에서 호출
 * sendNotification("전투 시작!", "불사조 기사단 vs 죽음을 먹는 자들");
 */