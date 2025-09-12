// packages/battle-server/ecosystem.config.js
// PM2 실행 설정: 포트 3001 고정, Socket.IO 경로 /socket.io, 로그/메모리/배포 스크립트 포함
module.exports = {
  apps: [
    {
      name: "battle-server",
      cwd: "./packages/battle-server",
      script: "index.js",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      autorestart: true,
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        SOCKET_PATH: "/socket.io"
      },
      // .env 로딩(필요 시). 경로는 이 파일 기준.
      env_file: "./packages/battle-server/.env",
      // 로그/메모리
      out_file: "./logs/battle-server.out.log",
      error_file: "./logs/battle-server.err.log",
      time: true,
      max_memory_restart: "1G",
      kill_timeout: 5000
    }
  ],

  // 선택: pm2 deploy 사용 시
  deploy: {
    production: {
      user: "root",
      host: ["65.21.147.119"],
      ref: "origin/main",
      repo: "https://github.com/CriminalTalent/battle-system.git",
      path: "/root/battle-system",
      "post-deploy": [
        "cd packages/battle-server",
        "npm ci",
        "pm2 reload /root/battle-system/packages/battle-server/ecosystem.config.js --only battle-server --update-env",
        "pm2 save"
      ].join(" && ")
    }
  }
};
