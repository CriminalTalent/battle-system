# Battle System - 실시간 턴제 전투 게임

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-blue.svg)](https://socket.io/)
[![Express](https://img.shields.io/badge/Express-4.18-red.svg)](https://expressjs.com/)
[![PM2](https://img.shields.io/badge/PM2-Ready-orange.svg)](https://pm2.keymetrics.io/)

> 팀 대 팀 실시간 턴제 전투 시스템 - 민첩성 기반 이니셔티브, 실시간 Socket.IO 동기화, 전술적 아이템 시스템, 관전자 친화적 UI/UX

## 게임 특징

### 전투 모드
- **1v1, 2v2, 3v3, 4v4** 팀 전투 지원
- **민첩성 기반** 선공 결정 시스템
- **완전 턴제** 전투 (팀 단위 턴)

### 전투 시스템
- **공격/방어/회피** 핵심 액션
- **명중률, 회피율, 데미지 차감** 계산
- **치명타 시스템** (행운 스탯 기반)
- **방어 시 역공격** 메커니즘

### 아이템 시스템
- **공격 보정기**: 공격력 1.5배 (1턴)
- **방어 보정기**: 방어력 1.5배 (1턴)  
- **디터니**: HP 10 즉시 회복

### 멀티플레이어
- **실시간 전투 상태** Socket.IO 동기화
- **선택적 캐릭터 이미지** 업로드
- **관전자 모드** (민감 정보 숨김)
- **실시간 채팅** 시스템

## 빠른 시작

### 서버 접속
```
라이브 서버: http://65.21.147.119:3001

관리자: http://65.21.147.119:3001/admin
플레이어: http://65.21.147.119:3001/play
관전자: http://65.21.147.119:3001/watch
```

### 로컬 개발 환경

#### 필수 조건
- Node.js 18+
- npm 8+

#### 설치 및 실행
```bash
# 저장소 클론
git clone https://github.com/CriminalTalent/battle-system.git
cd battle-system

# 의존성 설치
npm install

# API 서버 실행
cd packages/battle-server
npm install
npm run dev

# 또는 PM2 사용
pm2 start index.js --name battle-server
```

#### 접속 URL (로컬)
- 관리자: `http://localhost:3001/admin`
- 플레이어: `http://localhost:3001/play`
- 관전자: `http://localhost:3001/watch`
- 헬스체크: `http://localhost:3001/api/health`

## 게임 진행 가이드

### 1단계: 전투 방 생성
1. 관리자가 `/admin` 접속
2. **"전투 생성"** 클릭
3. 전투 모드 선택 (1v1~4v4)
4. OTP 자동 생성

### 2단계: 플레이어 초대
1. **"링크 생성"** 클릭  
2. 플레이어/관전자 링크 배포
3. 각자 OTP로 인증 후 입장

### 3단계: 캐릭터 생성
플레이어별 설정:
- **이름** (중복 불가)
- **팀 선택**: 불사조 기사단 vs 죽음을 먹는자들
- **스탯 배분** (1~5): 공격/방어/민첩/행운
- **아이템 선택**: 보정기들, 회복템
- **이미지 업로드** (선택)

### 4단계: 전투 시작
1. 관리자가 **"전투 시작"**
2. **민첩성 총합**으로 선공 결정
3. 팀 턴제로 진행

### 5단계: 전술적 전투
- 팀의 모든 생존자가 행동 완료 시 턴 종료
- 공격/방어/회피/아이템/패스 선택
- 실시간 결과 브로드캐스트

## 전투 시스템 상세

### 공격 계산
```
최종 공격력 = 공격력 + 주사위(1-20)
치명타 확률 = 20 - (행운 / 2)
치명타 시 데미지 x2
```

### 방어 시스템
```
방어 시: 받는 데미지 - 방어력 (최소 1)
방어 성공 시: 역공격 기회 제공
역공격: 공격력 + 주사위(1-20) (방어 불가)
```

### 회피 시스템  
```
회피 성공 조건: 민첩성 + 주사위(1-20) ≥ 상대 공격력
회피 성공: 완전 무효화
회피 실패: 정면 피해
```

## 승리 조건

- **즉시 승리**: 상대팀 전원 HP 0
- **50턴 초과**: 총 HP 높은 팀 승리
- **HP 동일**: 무승부
- **관리자 강제 종료** 가능

## 보안 시스템

### OTP 인증
- **6자리 영숫자** 자동 생성
- **역할별 만료 시간**: 관리자(60분), 플레이어(30분), 관전자(30분)
- **1회용 사용** 후 무효화

### 권한 관리
- **관리자**: 모든 제어, 플레이어 관리, 강제 종료
- **플레이어**: 자신 행동만, 팀 채팅
- **관전자**: 읽기 전용, 응원 메시지만

## 기술 스택

### 백엔드
```
Node.js 18+
Express.js 4.18
Socket.IO 4.7
Multer (파일 업로드)
PM2 (프로세스 관리)
```

### 프론트엔드
```
Vanilla JavaScript
HTML5 (시멘틱)
CSS3 (Grid/Flexbox)
Socket.IO Client
```

### 인프라
```
Ubuntu 22.04 LTS
Nginx (리버스 프록시)
PM2 (클러스터 모드)
```

## 프로젝트 구조

```
battle-system/
├── packages/
│   └── battle-server/
│       ├── index.js              # 메인 서버
│       ├── public/              # 웹 클라이언트
│       │   ├── admin.html       # 관리자 페이지
│       │   ├── play.html        # 플레이어 페이지
│       │   └── watch.html       # 관전자 페이지
│       └── src/
│           ├── server.js        # 서버 로직
│           ├── services/
│           │   └── BattleEngine.js  # 전투 엔진
│           └── socket/
│               └── battleSocket.js  # Socket.IO 핸들러
├── docker-compose.yml           # 컨테이너 설정
├── ecosystem.config.js          # PM2 설정
└── README.md
```

## 디자인 시스템

### 컬러 팔레트
```css
--deep-navy: #0a0f1a       /* 배경 */
--gold: #E5C88A            /* 주요 액센트 */
--gold-light: #F5E6B8      /* 텍스트 */
--accent: #2a3441          /* 버튼 */
--success: #27ae60         /* 성공 */
--warning: #f39c12         /* 경고 */
--danger: #e74c3c          /* 위험 */
```

### 반응형 브레이크포인트
- **데스크톱**: 1200px+
- **태블릿**: 768px~1199px
- **모바일**: ~767px

## 배포 가이드

### PM2 배포
```bash
# PM2 설치
npm install -g pm2

# 애플리케이션 시작
pm2 start ecosystem.config.js

# 상태 확인
pm2 status

# 로그 확인
pm2 logs battle-server

# 재시작
pm2 restart battle-server --update-env

# 저장
pm2 save
```

### Docker 배포
```bash
# 이미지 빌드
docker-compose build

# 서비스 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f
```

### Nginx 설정
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 테스트

### API 테스트
```bash
# 헬스체크
curl http://localhost:3001/api/health

# 전투 생성
curl -X POST http://localhost:3001/api/battles \
  -H "Content-Type: application/json" \
  -d '{"mode": "1v1"}'

# 전투 목록
curl http://localhost:3001/api/battles
```

### Socket.IO 테스트
브라우저 개발자 도구에서:
```javascript
const socket = io('http://localhost:3001');
socket.on('connect', () => console.log('연결됨'));
socket.emit('adminAuth', { battleId: 'xxx', otp: 'xxx' });
```

## 환경 설정

### .env 파일 예시
```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# 보안
JWT_SECRET=your-secret-key
CORS_ORIGIN=*

# 업로드
MAX_FILE_SIZE=5MB
UPLOAD_PATH=./uploads

# 전투 설정
BATTLE_TURN_TIMEOUT=300000
MAX_PLAYERS_PER_BATTLE=8
TOKEN_EXPIRY_PARTICIPANT=30m
TOKEN_EXPIRY_SPECTATOR=30m
```

## 트러블슈팅

### 일반적인 문제들

#### Socket.IO 연결 실패
```bash
# 방화벽 확인
sudo ufw status
sudo ufw allow 3001

# PM2 상태 확인
pm2 status
pm2 restart battle-server
```

#### 파일 업로드 실패
```bash
# 업로드 디렉토리 권한 확인
chmod 755 uploads/
chown -R www-data:www-data uploads/
```

#### 메모리 부족
```bash
# PM2 메모리 사용량 확인
pm2 monit

# 메모리 재시작 임계값 설정
pm2 start ecosystem.config.js --max-memory-restart 1G
```

## 기여 방법

1. **Fork** 저장소
2. **Feature 브랜치** 생성 (`git checkout -b feature/AmazingFeature`)
3. **변경사항 커밋** (`git commit -m 'Add some AmazingFeature'`)
4. **브랜치에 푸시** (`git push origin feature/AmazingFeature`)  
5. **Pull Request** 생성

### 개발 가이드라인
- 한글 우선 - 모든 UI 텍스트 한글화
- 디자인 통일 - 기존 컬러 스킴 유지
- 이모지 금지 - 텍스트만 사용
- 반응형 디자인 - 모바일 대응 필수
- 실시간 동기화 - Socket.IO 이벤트 활용

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 개발자

**CriminalTalent**
- GitHub: [@CriminalTalent](https://github.com/CriminalTalent)
- 프로젝트 링크: [https://github.com/CriminalTalent/battle-system](https://github.com/CriminalTalent/battle-system)

## 관련 링크

- [Socket.IO 문서](https://socket.io/docs/v4/)
- [Express.js 문서](https://expressjs.com/)
- [PM2 문서](https://pm2.keymetrics.io/)
- [Docker 문서](https://docs.docker.com/)

---

**실시간 턴제 전투의 새로운 경험을 만나보세요!**
[라이브 데모 체험하기](http://65.21.147.119:3001)
