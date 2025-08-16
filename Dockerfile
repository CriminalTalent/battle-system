# docker-compose.yml
version: '3.8'

services:
  # 백엔드 API 서버
  battle-api:
    build: 
      context: ./packages/battle-api
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your-super-secret-jwt-key-change-this
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    volumes:
      - ./packages/battle-api/logs:/app/logs
      - ./packages/battle-api/uploads:/app/uploads
    restart: unless-stopped

  # 프론트엔드 웹 서버
  battle-web:
    build:
      context: ./packages/battle-web
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3001
      - NODE_ENV=production
    depends_on:
      - battle-api
    restart: unless-stopped

  # Redis (실시간 데이터 캐싱)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  # Nginx (리버스 프록시)
  nginx:
    build:
      context: ./nginx
      dockerfile: Dockerfile
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - battle-web
      - battle-api
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    restart: unless-stopped

volumes:
  redis-data:

---
# packages/battle-api/Dockerfile
FROM node:18-alpine

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 애플리케이션 코드 복사
COPY . .

# 필요한 디렉토리 생성
RUN mkdir -p logs uploads/characters uploads/temp

# 포트 노출
EXPOSE 3001

# 헬스체크 추가
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# 애플리케이션 시작
CMD ["npm", "start"]

---
# packages/battle-web/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci

# 소스 코드 복사 및 빌드
COPY . .
RUN npm run build

# 프로덕션 이미지
FROM node:18-alpine AS runner

WORKDIR /app

# 프로덕션 의존성만 설치
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 빌드된 애플리케이션 복사
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./

# 포트 노출
EXPOSE 3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# 애플리케이션 시작
CMD ["npm", "start"]

---
# nginx/Dockerfile
FROM nginx:alpine

# 설정 파일 복사
COPY nginx.conf /etc/nginx/nginx.conf

# SSL 디렉토리 생성
RUN mkdir -p /etc/nginx/ssl

# 포트 노출
EXPOSE 80 443

---
# nginx/nginx.conf
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # 로그 설정
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                   '$status $body_bytes_sent "$http_referer" '
                   '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log;

    # Gzip 압축
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/xml+rss application/json;

    # 업스트림 설정
    upstream battle-api {
        server battle-api:3001;
    }

    upstream battle-web {
        server battle-web:3000;
    }

    # HTTP 서버
    server {
        listen 80;
        server_name localhost;

        # API 요청 프록시
        location /api {
            proxy_pass http://battle-api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # Socket.IO 요청 프록시
        location /socket.io {
            proxy_pass http://battle-api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # 웹 애플리케이션 프록시
        location / {
            proxy_pass http://battle-web;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}

---
# scripts/deploy.sh
#!/bin/bash

echo "🚀 배틀 시스템 배포를 시작합니다..."

# 환경 체크
if ! command -v docker &> /dev/null; then
    echo "❌ Docker가 설치되지 않았습니다."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose가 설치되지 않았습니다."
    exit 1
fi

# 기존 컨테이너 정리
echo "🧹 기존 컨테이너를 정리합니다..."
docker-compose down

# 이미지 빌드
echo "🔨 Docker 이미지를 빌드합니다..."
docker-compose build --no-cache

# 컨테이너 시작
echo "🚀 컨테이너를 시작합니다..."
docker-compose up -d

# 헬스체크
echo "🔍 서비스 상태를 확인합니다..."
sleep 30

# API 서버 헬스체크
if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ API 서버가 정상 작동중입니다."
else
    echo "❌ API 서버에 문제가 있습니다."
fi

# 웹 서버 헬스체크
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ 웹 서버가 정상 작동중입니다."
else
    echo "❌ 웹 서버에 문제가 있습니다."
fi

echo ""
echo "🎉 배포가 완료되었습니다!"
echo "📱 웹 애플리케이션: http://localhost"
echo "🔧 API 서버: http://localhost/api"
echo ""
echo "📊 로그 확인: docker-compose logs -f"
echo "🛑 서비스 중단: docker-compose down"

---
# scripts/quick-start.sh
#!/bin/bash

echo "⚡ 빠른 시작 스크립트"

# 개발 환경 확인
if [ ! -f ".env" ]; then
    echo "📝 환경 설정 파일을 생성합니다..."
    cp .env.example .env
fi

# Node.js 의존성 설치
echo "📦 의존성을 설치합니다..."
cd packages/battle-api && npm install
cd ../battle-web && npm install
cd ../..

# 개발 서버 시작
echo "🚀 개발 서버를 시작합니다..."

# API 서버 백그라운드 실행
cd packages/battle-api
npm run dev &
API_PID=$!

# 웹 서버 시작
cd ../battle-web
npm run dev &
WEB_PID=$!

echo ""
echo "🎉 개발 서버가 시작되었습니다!"
echo "📱 웹 애플리케이션: http://localhost:3000"
echo "🔧 API 서버: http://localhost:3001"
echo ""
echo "🛑 서버 중단: Ctrl+C"

# 종료 시그널 처리
trap "kill $API_PID $WEB_PID" EXIT

wait

---
# .env.example
# 환경 설정 파일 예시

# 서버 설정
NODE_ENV=development
PORT=3001
WEB_PORT=3000

# JWT 설정
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

# Redis 설정
REDIS_URL=redis://localhost:6379

# 데이터베이스 설정 (선택사항)
# DATABASE_URL=postgresql://username:password@localhost:5432/battledb

# 로그 설정
LOG_LEVEL=info

# API URL 설정
NEXT_PUBLIC_API_URL=http://localhost:3001

# Sentry 설정 (선택사항)
# SENTRY_DSN=your-sentry-dsn

# 파일 업로드 설정
MAX_FILE_SIZE=5MB
UPLOAD_PATH=./uploads

---
# package.json (루트)
{
  "name": "battle-system",
  "version": "1.0.0",
  "description": "팀전 배틀 시스템",
  "scripts": {
    "install:all": "npm install && cd packages/battle-api && npm install && cd ../battle-web && npm install",
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "cd packages/battle-api && npm run dev",
    "dev:web": "cd packages/battle-web && npm run dev",
    "build": "cd packages/battle-api && npm run build && cd ../battle-web && npm run build",
    "start": "concurrently \"npm run start:api\" \"npm run start:web\"",
    "start:api": "cd packages/battle-api && npm start",
    "start:web": "cd packages/battle-web && npm start",
    "deploy": "chmod +x scripts/deploy.sh && ./scripts/deploy.sh",
    "quick-start": "chmod +x scripts/quick-start.sh && ./scripts/quick-start.sh"
  },
  "devDependencies": {
    "concurrently": "^7.6.0"
  }
}
