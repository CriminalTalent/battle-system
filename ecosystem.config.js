// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "battle-server",

      // 레포 루트에서 실행
      cwd: "/root/battle-system",

      // 엔트리: 이전에 제공한 전체본 기준
      // (packages/battle-server/src/server.js 가 아니라 index.js 사용)
      script: "packages/battle-server/index.js",

      // WebSocket 안정성 우선: sticky 세션 미구성 시 단일 인스턴스 권장
      exec_mode: "fork",
      instances: 1,

      // 운영 기본
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      time: true,
      merge_logs: true,

      // 로그 (레포 루트/logs)
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",

      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 3001,

        // 필요 시 Nginx의 도메인만 허용하도록 정확히 지정
        // 예: "https://pyxisbattlesystem.monster"
        CORS_ORIGIN: "*"
      },

      // 재시작 안정성
      min_uptime: "10s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 8000
    }
  ]
};
