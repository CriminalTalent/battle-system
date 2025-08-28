// ecosystem.config.js  (packages/battle-server/ecosystem.config.js)
module.exports = {
  apps: [
    // ────────────────────────────────────────────────
    // 기본: 단일 인스턴스 (Socket.IO 스티키 불필요)
    // ────────────────────────────────────────────────
    {
      name: 'battle-server',
      script: 'src/server.js',
      cwd: __dirname,
      exec_mode: 'fork',             // 단일 프로세스
      instances: 1,

      // 안정성/리소스
      autorestart: true,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,

      // 종료/부팅 타임아웃
      kill_timeout: 8000,
      listen_timeout: 10000,         // wait_ready 쓰면 의미 있음
      wait_ready: false,

      // 로그
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      // log_file: './logs/combined.log', // merge_logs 쓰면 보통 error/out 분리 권장

      // 파일감시
      watch: false,
      // watch_options: { usePolling: false, interval: 100 },
      // ignore_watch: ['node_modules', 'logs', 'uploads'],

      // 환경변수 (서버가 src/config/env.js로 .env 읽지만, 오버라이드 가능)
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: '*',
        LOG_LEVEL: 'info',
        // PUBLIC_BASE_URL: 'https://pyxisbattlesystem.monster',
        // BATTLE_TURN_TIMEOUT: '300000',
        // MAX_PLAYERS_PER_BATTLE: '8',
      },

      // 인스턴스 식별자/파일
      instance_var: 'INSTANCE_ID',
      pid_file: './pids/battle-server.pid',
    },

    // ────────────────────────────────────────────────
    // 선택: 클러스터 모드(멀티 코어 활용)
    // ⚠️ Socket.IO는 'sticky 세션' 필요 → 실행 시 --sticky 플래그 사용 권장
    // 예) pm2 start ecosystem.config.js --only battle-server:cluster --sticky
    // ────────────────────────────────────────────────
    {
      name: 'battle-server:cluster',
      script: 'src/server.js',
      cwd: __dirname,
      exec_mode: 'cluster',
      instances: 'max',              // 또는 특정 숫자

      autorestart: true,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,

      kill_timeout: 8000,
      listen_timeout: 10000,
      wait_ready: false,

      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: './logs/err.cluster.log',
      out_file: './logs/out.cluster.log',

      watch: false,

      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,                  // 여러 인스턴스가 같은 포트 사용(클러스터)
        CORS_ORIGIN: '*',
        LOG_LEVEL: 'info',
      },

      instance_var: 'INSTANCE_ID',
      pid_file: './pids/battle-server.cluster.pid',
    },
  ],
};
