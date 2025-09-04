// ecosystem.config.js - PYXIS Battle System 안정성 강화 설정
module.exports = {
  apps: [
    {
      name: "battle-server",
      // 레포 루트에서 실행
      cwd: "/root/battle-system",
      // 엔트리 포인트
      script: "packages/battle-server/index.js",
      
      // 실행 모드 - WebSocket 안정성을 위한 단일 인스턴스
      exec_mode: "fork",
      instances: 1,
      
      // 기본 운영 설정
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      time: true,
      merge_logs: true,
      
      // 로그 설정 (레포 루트/logs)
      log_file: "./logs/combined.log",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      
      // 환경 변수
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 3001,
        CORS_ORIGIN: "*"
      },
      
      // 개발 환경 (pm2 start ecosystem.config.js --env development)
      env_development: {
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: 3001,
        CORS_ORIGIN: "http://localhost:3000,http://127.0.0.1:3000"
      },
      
      // 스테이징 환경 (pm2 start ecosystem.config.js --env staging)
      env_staging: {
        NODE_ENV: "staging",
        HOST: "0.0.0.0",
        PORT: 3001,
        CORS_ORIGIN: "https://staging.pyxisbattlesystem.monster"
      },
      
      // 프로덕션 환경 (pm2 start ecosystem.config.js --env production)
      env_production: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 3001,
        CORS_ORIGIN: "https://pyxisbattlesystem.monster"
      },
      
      // 재시작 안정성 설정
      min_uptime: "30s",           // 최소 30초 실행 후 정상으로 간주
      max_restarts: 10,            // 1분 내 최대 10회 재시작
      restart_delay: 3000,         // 재시작 간 3초 대기
      exp_backoff_restart_delay: 500,  // 지수적 백오프 시작값
      
      // 프로세스 종료 설정
      kill_timeout: 10000,         // 강제 종료 전 10초 대기
      listen_timeout: 10000,       // 포트 리스닝 타임아웃
      
      // 메모리 관리
      max_memory_restart: "1G",    // 1GB 초과 시 재시작
      
      // Node.js 옵션
      node_args: [
        "--max-old-space-size=1024",  // 힙 메모리 1GB 제한
        "--optimize-for-size"         // 메모리 사용량 최적화
      ],
      
      // 프로세스 모니터링
      pmx: true,                   // PM2 Plus 모니터링 활성화
      
      // 클러스터 재시작 설정 (필요시 활성화)
      // wait_ready: true,         // ready 신호 대기
      // shutdown_with_message: true,
      
      // 에러 처리
      ignore_watch: [
        "node_modules",
        "logs",
        "uploads",
        ".git"
      ],
      
      // 추가 안정성 옵션
      vizion: false,               // Git 메타데이터 수집 비활성화 (성능 향상)
      automation: false,           // 자동화 기능 비활성화
      
      // 크론 작업 (로그 정리 등)
      cron_restart: "0 2 * * *",   // 매일 새벽 2시 재시작 (선택사항)
      
      // 헬스체크 설정
      health_check_grace_period: 3000,
      
      // 소스맵 지원
      source_map_support: true,
      
      // 인스턴스 변수 (필요시 사용)
      instance_var: "INSTANCE_ID",
      
      // 사용자 정의 메트릭 (모니터링용)
      custom_metrics: {
        "Active Battles": () => {
          // 활성 전투 수 반환 로직
          return 0;
        },
        "Connected Users": () => {
          // 연결된 사용자 수 반환 로직
          return 0;
        }
      }
    }
  ],
  
  // 배포 설정 (pm2 deploy 사용시)
  deploy: {
    production: {
      user: "root",
      host: ["65.21.147.119"],
      ref: "origin/main",
      repo: "git@github.com:your-repo/battle-system.git",
      path: "/root/battle-system",
      "pre-deploy-local": "",
      "post-deploy": "npm install && pm2 reload ecosystem.config.js --env production",
      "pre-setup": ""
    }
  }
};
