/**
 * PYXIS Battle System - PM2 통합 설정 (ESM)
 * 리포 루트: /root/battle-system, 릴리스 symlink: /root/battle-system/current
 */
const BASE = '/root/battle-system';
const CURRENT = `${BASE}/current`;

const config = {
  apps: [
    {
      name: 'pyxis-battle-system',

      // 배포 경로와 일치
      cwd: CURRENT,

      // 서버 엔트리 (TS 빌드 시 dist/index.js로 변경)
      script: 'packages/battle-server/index.js',

      // WebSocket 특성상 단일 인스턴스(스티키 없으면)
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
      // wait_ready: true, // 서버가 process.send('ready') 호출 시만 활성
      // listen_timeout: 10000,

      // Node 런타임
      node_args: [
        '--max-old-space-size=1024',
        '--enable-source-maps'
      ],

      // 릴리스별 .env 사용
      env_file: `${CURRENT}/.env`,

      // 로그(공유 디렉터리 유지)
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: `${BASE}/logs/out.log`,
      error_file: `${BASE}/logs/error.log`,
      pid_file: `${BASE}/logs/battle-system.pid`,

      // 파일 감시 제외(안전)
      ignore_watch: [
        'node_modules',
        'logs',
        'uploads',
        'packages/battle-server/public/uploads',
        '.git',
        '*.log'
      ],

      vizion: false,
      source_map_support: true,
      instance_var: 'INSTANCE_ID',

      // 매일 새벽 2시(서울) 자동 재시작
      cron_restart: '0 2 * * *',

      // 공통 기본값
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Seoul',
        HOST: '0.0.0.0',
        PORT: 3001,
        // 필요 출처만 나열(보안). 와일드카드가 필요하면 뒤에 ,* 추가
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster,http://65.21.147.119:3001',
        LOG_LEVEL: 'info'
      },

      // 로컬 개발
      env_development: {
        NODE_ENV: 'development',
        TZ: 'Asia/Seoul',
        HOST: '127.0.0.1',
        PORT: 3001,
        CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
        LOG_LEVEL: 'debug'
      },

      // 프로덕션 오버라이드
      env_production: {
        NODE_ENV: 'production',
        TZ: 'Asia/Seoul',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster,http://65.21.147.119:3001',
        LOG_LEVEL: 'info'
      }
    }
  ],

  // PM2 Deploy
  deploy: {
    production: {
      user: 'root',
      host: ['65.21.147.119'],
      ref: 'origin/main',
      repo: 'git@github.com:CriminalTalent/battle-system.git',
      path: BASE,

      'post-deploy': [
        // 디렉토리 준비
        `mkdir -p ${BASE}/logs`,
        `mkdir -p ${BASE}/uploads`,
        `mkdir -p ${CURRENT}/packages/battle-server/public/uploads/avatars || true`,

        // 의존성 설치(루트 + 서버 패키지)
        `cd ${CURRENT} && npm ci --omit=dev`,
        `cd ${CURRENT}/packages/battle-server && npm ci --omit=dev`,

        // PM2 (ESM config)
        `pm2 startOrReload ${CURRENT}/packages/battle-server/ecosystem.config.mjs --env production`,
        'pm2 save'
      ].join(' && ')
    }
  }
};

export default config;
