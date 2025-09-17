/**
 * PYXIS Battle System - PM2 통합 설정 (ESM 버전)
 * 이 파일은 ESM 환경("type":"module")에서 동작하도록 export default 를 사용합니다.
 * 실행 기준 디렉토리(cwd)는 리포지토리 루트(/root/battle-system)로 고정합니다.
 */

const config = {
  apps: [
    {
      name: 'pyxis-battle-system',

      // 리포지토리 루트에서 실행되도록 고정 (상대경로 문제 방지)
      cwd: '/root/battle-system',

      // 서버 엔트리
      script: 'packages/battle-server/index.js',

      // WebSocket 특성상 단일 인스턴스 권장
      exec_mode: 'fork',
      instances: 1,

      // 안정화/재시작 정책
      watch: false,
      autorestart: true,
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 500,
      kill_timeout: 15000,
      listen_timeout: 10000,
      max_memory_restart: '1G',

      // Node 런타임 최적화
      node_args: [
        '--max-old-space-size=1024',
        '--optimize-for-size',
        '--enable-source-maps'
      ],

      // .env 절대경로 지정 (배포/수동 모두 안전)
      env_file: '/root/battle-system/.env',

      // 로그 (절대경로 권장)
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/root/battle-system/logs/out.log',
      error_file: '/root/battle-system/logs/error.log',
      pid_file: '/root/battle-system/logs/battle-system.pid',

      // 파일 감시 제외
      ignore_watch: [
        'node_modules',
        'logs',
        'uploads',
        'packages/battle-server/public/uploads',
        '.git',
        '*.log'
      ],

      // 기타
      vizion: false,
      source_map_support: true,
      instance_var: 'INSTANCE_ID',

      // 매일 새벽 2시 자동 재시작
      cron_restart: '0 2 * * *',

      // 공통 기본값(미설정 시 fallback)
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        // 여러 출처 허용 시 쉼표로 구분
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster,http://65.21.147.119:3001,*',
        LOG_LEVEL: 'info'
      },

      // 로컬 개발
      env_development: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: 3001,
        CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
        LOG_LEVEL: 'debug'
      },

      // 프로덕션 오버라이드
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster,http://65.21.147.119:3001',
        LOG_LEVEL: 'info'
      }
    }
  ],

  // PM2 Deploy(선택사항)
  deploy: {
    production: {
      user: 'root',
      host: ['65.21.147.119'],
      ref: 'origin/main',
      repo: 'git@github.com:CriminalTalent/battle-system.git',
      path: '/root/battle-system',

      'pre-deploy-local': '',

      'post-deploy': [
        // 디렉토리 준비
        'mkdir -p /root/battle-system/logs',
        'mkdir -p /root/battle-system/uploads',
        'mkdir -p /root/battle-system/current/packages/battle-server/public/uploads/avatars || true',

        // 의존성 설치(루트 + 서버 패키지)
        'cd /root/battle-system/current && npm ci --omit=dev',
        'cd /root/battle-system/current/packages/battle-server && npm ci --omit=dev',

        // PM2 (ESM config)
        'pm2 startOrReload /root/battle-system/current/packages/battle-server/ecosystem.config.js --env production',
        'pm2 save'
      ].join(' && '),

      'pre-setup': ''
    }
  }
};

export default config;
