// ecosystem.config.js - PYXIS Battle System (정리/개선 버전)
module.exports = {
  apps: [
    {
      // PM2 프로세스 이름 (npm 스크립트/로그 명과 일치)
      name: 'battle-system',

      // 레포 루트 기준 실행
      cwd: '/root/battle-system',

      // 엔트리 포인트
      script: 'packages/battle-server/index.js',

      // WebSocket 안정성: 단일 인스턴스 유지 (클러스터 대신 fork)
      exec_mode: 'fork',
      instances: 1,

      // 재시작/안정성
      watch: false,
      autorestart: true,
      min_uptime: '30s',                 // 30초 이내 크래시 시 비정상으로 판단
      max_restarts: 10,                  // 단기간 과도 재시작 방지
      restart_delay: 3000,               // 재시작 사이 대기
      exp_backoff_restart_delay: 500,    // 지수 백오프 시작값
      kill_timeout: 10000,               // SIGINT 후 강제종료까지 대기
      listen_timeout: 10000,             // 리스닝 대기(ready 사용 안 함)

      // 메모리 한도 초과 시 재시작
      max_memory_restart: '1G',

      // Node.js 런타임 옵션
      node_args: [
        '--max-old-space-size=1024',
        '--optimize-for-size',
      ],

      // 로그
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // logs 디렉토리 존재 가정 (/root/battle-system/logs)
      log_file: './logs/combined.log',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      pid_file: './logs/battle-system.pid',

      // 불필요 디렉토리 감시 제외
      ignore_watch: ['node_modules', 'logs', 'uploads', '.git'],

      // PM2 내부 Git 메타 수집 비활성(성능/권한 이슈 감소)
      vizion: false,

      // 소스맵 스택트레이스 지원
      source_map_support: true,

      // 인스턴스 식별 환경변수 이름
      instance_var: 'INSTANCE_ID',

      // 정기 재시작(선택) — 매일 새벽 2시
      cron_restart: '0 2 * * *',

      // ── 환경 변수 ──────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: '*',
      },
      // pm2 start ecosystem.config.js --env development
      env_development: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: 3001,
        CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
      },
      // pm2 start ecosystem.config.js --env staging
      env_staging: {
        NODE_ENV: 'staging',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'https://staging.pyxisbattlesystem.monster',
      },
      // pm2 start ecosystem.config.js --env production
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster',
      },
    },
  ],

  // ── 배포 설정 (pm2 deploy) ───────────────────────────────────────────
  deploy: {
    production: {
      user: 'root',
      host: ['65.21.147.119'],
      ref: 'origin/main',
      repo: 'git@github.com:CriminalTalent/battle-system.git',
      path: '/root/battle-system',
      'pre-deploy-local': '',
      // 필요 패키지만 설치하고 환경 적용 후 무중단 reload
      'post-deploy':
        'npm ci --omit=dev && pm2 reload ecosystem.config.js --env production && pm2 save',
      'pre-setup': '',
    },
  },
};
