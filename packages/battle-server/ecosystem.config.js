// ecosystem.config.js - PYXIS Battle System (통합 설정)
// 서버 실행: /root/battle-system/ 에서 실행
module.exports = {
  apps: [
    {
      name: 'pyxis-battle-system',
      
      // 작업 디렉토리를 루트로 설정하여 상대경로 문제 해결
      cwd: '/root/battle-system',
      script: 'packages/battle-server/index.js',

      // WebSocket을 위한 단일 인스턴스
      exec_mode: 'fork',
      instances: 1,
      
      // 재시작 설정
      watch: false,
      autorestart: true,
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 500,
      kill_timeout: 15000,
      listen_timeout: 10000,
      max_memory_restart: '1G',

      // Node.js 최적화
      node_args: [
        '--max-old-space-size=1024',
        '--optimize-for-size',
        '--enable-source-maps'
      ],

      // 환경변수 파일 (루트 기준)
      env_file: '.env',

      // 로그 설정
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_file: './logs/combined.log',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      pid_file: './logs/battle-system.pid',

      // 감시 제외 목록
      ignore_watch: [
        'node_modules',
        'logs',
        'uploads',
        '.git',
        '*.log'
      ],

      // 기타 설정
      vizion: false,
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
      
      // 매일 새벽 2시 자동 재시작
      cron_restart: '0 2 * * *',

      // 환경별 설정
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: '*',
        LOG_LEVEL: 'info'
      },
      
      env_development: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: 3001,
        CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
        LOG_LEVEL: 'debug'
      },
      
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0', 
        PORT: 3001,
        CORS_ORIGIN: 'https://pyxisbattlesystem.monster,http://65.21.147.119:3001',
        LOG_LEVEL: 'info'
      }
    }
  ],

  // 배포 설정 (PM2 Deploy 사용 시)
  deploy: {
    production: {
      user: 'root',
      host: ['65.21.147.119'],
      ref: 'origin/main',
      repo: 'git@github.com:CriminalTalent/battle-system.git',
      path: '/root/battle-system',
      'pre-deploy-local': '',
      'post-deploy': [
        // 필요 디렉토리 생성
        'mkdir -p logs uploads packages/battle-server/public/uploads/avatars',
        // 의존성 설치 (루트와 패키지 모두)
        'npm ci --omit=dev',
        'cd packages/battle-server && npm ci --omit=dev',
        // PM2 재시작
        'cd /root/battle-system && pm2 reload ecosystem.config.js --env production',
        'pm2 save'
      ].join(' && '),
      'pre-setup': ''
    }
  }
};
