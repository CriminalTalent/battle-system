# 멀티 스테이지 빌드를 위한 Dockerfile

# Build stage
FROM node:18-alpine as builder

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 정보 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci

# 소스 코드 복사
COPY . .

# 환경변수 설정 (빌드 시)
ARG REACT_APP_API_URL=http://localhost:3001
ARG REACT_APP_SOCKET_URL=http://localhost:3001
ARG GENERATE_SOURCEMAP=false

ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_SOCKET_URL=$REACT_APP_SOCKET_URL
ENV GENERATE_SOURCEMAP=$GENERATE_SOURCEMAP

# 프로덕션 빌드
RUN npm run build

# Production stage
FROM nginx:alpine as production

# 빌드된 파일을 nginx로 복사
COPY --from=builder /app/build /usr/share/nginx/html

# nginx 설정 파일 복사 (SPA를 위한 설정)
COPY nginx.conf /etc/nginx/nginx.conf

# 포트 노출
EXPOSE 80

# nginx 시작
CMD ["nginx", "-g", "daemon off;"]