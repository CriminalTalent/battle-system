// ecosystem.config.js - PYXIS Battle System (정리/개선 최종본)
module.exports = {
  apps: [
    {
      // PM2 프로세스 이름 (npm 스크립트/로그 명과 일치)
      name: 'battle-system',

      // 패키지 기준 실행(cwd를 패키지 폴더로 고정: 의존성/상대경로 혼동 방지)
      cwd: '/root/battle-system/packages/battle-server',

      // 엔트리 포인트
      script: 'index.js',

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
      node_args: ['--max-old-space-size=1024', '--optimize-for-size'],

      // .env 로딩(루트 .env 사용)
      env_file: '/root/battle-system/.env',

      // 로그(절대경로로 고정: 작업 디렉토리 변경 시에도 안전)
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_file: '/root/battle-system/logs/combined.log',
      error_file: '/root/battle-system/logs/err.log',
      out_file: '/root/battle-system/logs/out.log',
      pid_file: '/root/battle-system/logs/battle-system.pid',

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

      // ── 기본 환경 변수 ─────────────────────────────────────────
      // (env_file 과 병행 사용 가능. env_production 등이 우선 적용)
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: '*'
      },
      // pm2 start ecosystem.config.js --env development
      env_development: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: 3001,
        CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000'
      },
      // pm2 start ecosystem.config.js --env staging
      env_staging: {
        NODE_ENV: 'staging',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'https://staging.pyxisbattlesystem.monster'
      },
      // pm2 start ecosystem.config.js --env production
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster'
      }
    }
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
      // 패키지 폴더에서 의존성 설치 후 무중단 reload
      'post-deploy':
        'cd /root/battle-system/packages/battle-server && npm ci --omit=dev && pm2 reload /root/battle-system/ecosystem.config.js --env production && pm2 save',
      'pre-setup': ''
    }
  }
};
