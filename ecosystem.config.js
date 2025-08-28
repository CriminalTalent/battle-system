// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "battle-server",
      cwd: "/root/battle-system", // 루트 기준
      script: "packages/battle-server/src/server.js", // 실제 엔트리
      exec_mode: "cluster",
      instances: "max",

      // 기본 운영 옵션
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      time: true,
      merge_logs: true,
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",

      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 3001,
        CORS_ORIGIN: "*"
      },

      // 종료/재시작 안정성(선택)
      min_uptime: "10s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 8000
    }
  ]
};
