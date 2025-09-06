// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'battle-system',
      script: 'packages/battle-server/index.js',

      /**
       * Socket.IO 를 sticky 없이 쓰면 단일 프로세스(fork)가 안전합니다.
       * 스케일이 필요하면 아래 주석처럼 cluster + sticky(nginx)로 전환하세요.
       */
      instances: process.env.PM2_INSTANCES ? parseInt(process.env.PM2_INSTANCES, 10) : 1,
      exec_mode: 'fork', // 'cluster' 로 바꾸고 sticky 세션 구성 가능

      /**
       * 파일 감시는 서버에서 보통 비활성화(성능/안정성).
       * 개발 환경에서는 nodemon 등 별도 사용.
       */
      watch: false,

      /**
       * .env 를 자동으로 로드 (pm2가 dotenv 파싱)
       * 각 env_* 값이 우선됩니다.
       */
      env_file: '.env',

      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        // SOCKET_IO_PATH: '/socket.io',
        // TRUST_PROXY: '1'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001
      },

      /**
       * 안정성/자원관리
       */
      autorestart: true,
      min_uptime: '5s',                  // 실행 5초 내 죽으면 재시작 카운트
      max_restarts: 10,                  // 빠른 실패 재시작 한도
      exp_backoff_restart_delay: 200,    // 지수 백오프(ms)
      kill_timeout: 5000,                // 그레이스풀 종료 대기
      node_args: ['--enable-source-maps'],
      max_memory_restart: '1G',          // 메모리 넘치면 재시작

      /**
       * 로깅
       * logs/ 디렉토리가 존재해야 합니다.
       */
      merge_logs: true,
      time: true, // pm2 기본 타임스탬프
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_file: 'logs/combined.log',

      /**
       * 헬스체크용 HTTP 준비시간이 필요한 경우 사용 (cluster 시 유용)
       * listen_timeout: 10000,
      */

      /**
       * 클러스터 전환 예시:
       * instances: 'max',
       * exec_mode: 'cluster',
       * 그리고 nginx 에 sticky(IPC/쿠키 기반) 라우팅을 구성해야 함.
       */
    }
  ]
};
