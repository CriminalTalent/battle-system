# PYXIS Battle System - 실시간 턴제 전투 게임

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-blue.svg)](https://socket.io/)
[![Express](https://img.shields.io/badge/Express-4.18-red.svg)](https://expressjs.com/)
[![PM2](https://img.shields.io/badge/PM2-Ready-orange.svg)](https://pm2.keymetrics.io/)

> 우아한 디자인과 몰입감 있는 UX를 갖춘 팀 대 팀 실시간 턴제 전투 시스템

## 게임 특징

### 핵심 게임플레이
- **팀 대 팀 전투**: 1v1, 2v2, 3v3, 4v4 지원
- **민첩성 기반 이니셔티브**: 팀 민첩성 합계로 선공 결정
- **완전 턴제 시스템**: 팀 단위 턴 진행
- **전략적 액션**: 공격/방어/회피/아이템/패스

### 전투 시스템
- **스탯 기반 계산**: 공격/방어/민첩/행운 (1-10)
- **치명타 시스템**: 행운 스탯에 따른 확률 계산
- **방어 역공격**: 방어 성공 시 반격 기회
- **아이템 전략**: 디터니(회복), 공격/방어 보정기

### 우아한 UI/UX
- **Pyxis 테마**: 짙은 네이비 + 골드 색상 조합
- **Playfair Display 폰트**: 고급스러운 세리프 타이틀
- **글래스모피즘**: 반투명 카드와 백드롭 블러
- **애니메이션**: 천체 회전, 반짝임, 호버 효과
- **반응형 디자인**: 모바일/태블릿 완벽 대응

## 빠른 시작

### 라이브 서버 접속
```
메인 서버: https://pyxisbattlesystem.monster

관리자: https://pyxisbattlesystem.monster/admin
플레이어: https://pyxisbattlesystem.monster/play
관전자: https://pyxisbattlesystem.monster/watch
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
npm run setup

# 개발 서버 실행
npm run dev

# 또는 프로덕션 모드
npm start

# PM2로 실행
npm run pm2:start
```

#### 접속 URL (로컬)
- 관리자: `http://localhost:3001/admin`
- 플레이어: `http://localhost:3001/play`
- 관전자: `http://localhost:3001/watch`
- API 상태: `http://localhost:3001/api/health`

## 게임 진행 가이드

### 1단계: 관리자 - 전투 생성
1. **관리자 페이지** 접속
2. 전투 모드 선택 (1v1~4v4)
3. **"전투 생성"** 클릭
4. OTP 자동 생성 확인

### 2단계: 관리자 - 참여자 구성
1. **플레이어 추가**:
   - 이름 입력 (중복 불가)
   - 팀 선택: 불사조 기사단 vs 죽음을 먹는 자들
   - 스탯 배분 (공격/방어/민첩/행운)
   - 시작 아이템 설정
   - 아바타 이미지 업로드 (선택)

2. **링크 생성**:
   - **"플레이어별 링크 생성"** 클릭
   - 각 플레이어별 전용 링크 생성
   - 관전자 링크도 함께 생성

### 3단계: 참여자 - 입장 및 인증
- **플레이어**: 전용 링크로 접속 → 자동 인증
- **관전자**: 관전자 링크 접속 → 원하는 이름으로 로그인

### 4단계: 관리자 - 전투 시작
1. **"관리자 로그인"** 클릭 (실시간 연결)
2. 모든 플레이어 입장 확인
3. **"전투 시작"** 클릭
4. 민첩성 합계로 선공 팀 결정

### 5단계: 실시간 전투
- **턴제 진행**: 팀의 모든 생존자가 행동 완료 시 턴 종료
- **액션 선택**: 공격/방어/회피/아이템/패스
- **실시간 동기화**: 모든 참여자에게 즉시 반영
- **관전자 응원**: 다양한 응원 메시지로 분위기 UP!

## 전투 시스템 상세

### 공격 계산
```
최종 공격력 = (공격력 × 보정) + 주사위(1-20)
치명타 확률 = 20 - (행운 ÷ 2)
치명타 시 데미지 2배
```

### 방어 메커니즘
```
방어 시: 받는 데미지 - (방어력 × 보정) (최소 1)
방어 성공: 공격자에게 역공격 기회
역공격: (공격력 + 주사위) → 방어 불가
```

### 회피 시스템
```
회피 성공: 민첩성 + 주사위(1-20) ≥ 상대 공격력
성공 시: 완전 무효화
실패 시: 정면 피해
```

### 아이템 효과
- **디터니**: HP 10 즉시 회복 (대상 지정 가능)
- **공격 보정기**: 공격력 1.5배 (1턴간)
- **방어 보정기**: 방어력 1.5배 (1턴간)

## 승리 조건

- **즉시 승리**: 상대팀 전원 HP 0
- **50턴 제한**: 초과 시 총 HP 높은 팀 승리
- **동률**: 무승부 처리
- **관리자 재량**: 강제 종료 가능

## 보안 시스템

### OTP 인증 체계
- **관리자 OTP**: 60분 유효, 모든 권한
- **플레이어 OTP**: 30분 유효, 개별 플레이어별 생성
- **관전자 OTP**: 30분 유효, 공통 사용
- **1회용 토큰**: 사용 후 무효화

### 권한 구분
| 역할 | 권한 |
|------|------|
| **관리자** | 전투 생성/시작/종료, 플레이어 관리, 모든 채팅 열람 |
| **플레이어** | 자신의 행동만, 팀/전체 채팅 |
| **관전자** | 읽기 전용, 응원 메시지만 |

## 디자인 시스템

### 컬러 팔레트
```css
/* 주요 색상 */
--deep-navy: #0a0f1a      /* 메인 배경 */
--gold: #c9a96e           /* 주요 액센트 */
--gold-bright: #e0c494    /* 브라이트 골드 */
--gold-shimmer: #f2e5c7   /* 시머 효과 */

/* 글래스 효과 */
--glass-1: rgba(201,169,110,.08)
--glass-2: rgba(201,169,110,.12)
--border-1: rgba(201,169,110,.16)
```

### 타이포그래피
- **세리프**: Playfair Display (제목, 브랜딩)
- **산세리프**: Inter (본문, UI)

### 애니메이션
- **천체 회전**: 배경 그라데이션 회전
- **반짝임**: 별 모양 트윙클 효과
- **호버**: 카드 리프트와 글로우
- **펄스**: 활성 상태 표시

## 기술 스택

### 백엔드
- **Node.js 18+**: JavaScript 런타임
- **Express.js 4.18**: 웹 프레임워크
- **Socket.IO 4.7**: 실시간 통신
- **PM2**: 프로세스 관리

### 프론트엔드
- **Vanilla JavaScript**: 프레임워크 없는 순수 JS
- **HTML5**: 시멘틱 마크업
- **CSS3**: Grid, Flexbox, 커스텀 프로퍼티
- **Socket.IO Client**: 실시간 동기화

### 인프라
- **Ubuntu 22.04 LTS**: 서버 OS
- **Nginx**: 리버스 프록시, SSL 종료
- **Let's Encrypt**: SSL 인증서
- **PM2 클러스터**: 고가용성

## 프로젝트 구조

```
battle-system/
├── packages/
│   └── battle-server/
│       ├── public/              # 클라이언트 파일
│       │   ├── admin.html       # 관리자 페이지
│       │   ├── play.html        # 플레이어 페이지
│       │   ├── watch.html       # 관전자 페이지
│       │   └── assets/
│       │       ├── pyxis-theme.css    # 통합 테마
│       │       └── favicon.svg        # 파비콘
│       ├── src/
│       │   ├── server.js        # 메인 서버
│       │   ├── config/          # 환경 설정
│       │   ├── services/        # 비즈니스 로직
│       │   └── socket/          # 소켓 핸들러
│       └── .env.example         # 환경변수 예시
├── ecosystem.config.js          # PM2 설정
├── package.json                 # 루트 패키지
└── README.md
```

## 배포 가이드

### PM2 배포 (권장)
```bash
# 환경변수 설정
cp packages/battle-server/.env.example packages/battle-server/.env
nano packages/battle-server/.env

# 의존성 설치
npm run setup

# PM2로 시작
npm run pm2:start

# 상태 확인
npm run pm2:status

# 로그 확인
npm run pm2:logs
```

### Docker 배포
```bash
# 이미지 빌드
docker-compose build

# 서비스 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f battle-server
```

### Nginx 설정 예시
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 환경 설정

### .env 파일 설정
```env
# 서버 설정
NODE_ENV=production
HOST=0.0.0.0
PORT=3001

# 보안
CORS_ORIGIN=*
JWT_SECRET=your-secret-key

# 업로드
MAX_FILE_SIZE=5MB
UPLOAD_PATH=./uploads

# 전투 설정
BATTLE_TURN_TIMEOUT=300000
MAX_PLAYERS_PER_BATTLE=8

# 토큰 만료
TOKEN_EXPIRY_PARTICIPANT=30m
TOKEN_EXPIRY_SPECTATOR=30m

# 공개 URL (선택)
PUBLIC_BASE_URL=https://your-domain.com
```

## 테스트

### API 테스트
```bash
# 서버 상태 확인
curl http://localhost:3001/api/health

# 전투 생성
curl -X POST http://localhost:3001/api/admin/battles \
  -H "Content-Type: application/json" \
  -d '{"mode": "1v1"}'
```

### 기능 테스트 시나리오
1. **관리자 플로우**: 전투 생성 → 플레이어 추가 → 링크 생성 → 전투 시작
2. **플레이어 플로우**: 링크 접속 → 자동 인증 → 턴 대기 → 액션 수행
3. **관전자 플로우**: 관전자 링크 → 이름 설정 → 관전 시작 → 응원

## 게임 플레이 팁

### 플레이어용
- **키보드 단축키**: 1(공격), 2(방어), 3(회피), 4(아이템), 5(패스)
- **팀 채팅**: `/t 메시지` 또는 채널 선택
- **전략 고려**: 민첩성이 높으면 먼저, 행운이 높으면 치명타 확률 증가

### 관전자용
- **응원 단축키**: 1-4(기본 응원), 5-0(재치있는 응원)
- **개성적 이름**: "관전왕", "응원단장" 등으로 개성 표현
- **실시간 관전**: 현재 턴 플레이어 하이라이트 확인

## 트러블슈팅

### 일반적인 문제

**연결 실패**
```bash
# 방화벽 확인
sudo ufw allow 3001

# PM2 상태 확인
pm2 status
pm2 restart battle-server
```

**파일 업로드 실패**
```bash
# 권한 설정
chmod 755 uploads/
chown -R $USER:$USER uploads/
```

**메모리 부족**
```bash
# 메모리 사용량 확인
pm2 monit

# 메모리 제한 재시작
pm2 restart battle-server --max-memory-restart 1G
```

## 기여하기

1. **Fork** 저장소
2. **Feature 브랜치** 생성
```bash
git checkout -b feature/amazing-feature
```
3. **변경사항 커밋**
```bash
git commit -m 'Add amazing feature'
```
4. **브랜치 푸시**
```bash
git push origin feature/amazing-feature
```
5. **Pull Request** 생성

### 개발 가이드라인
- **한글 우선**: 모든 UI 텍스트 한글화
- **디자인 통일**: Pyxis 테마 유지
- **반응형 필수**: 모바일 대응 확인
- **실시간 동기화**: Socket.IO 이벤트 활용
- **이모지 금지**: 텍스트만 사용

## 라이선스

이 프로젝트는 **MIT 라이선스** 하에 배포됩니다.

## 개발자

**CriminalTalent**
- 이메일: rntjdrud1@gmail.com
- GitHub: [@CriminalTalent](https://github.com/CriminalTalent)
- 프로젝트: [battle-system](https://github.com/CriminalTalent/battle-system)

## 관련 링크

- [Socket.IO 문서](https://socket.io/docs/v4/)
- [Express.js 가이드](https://expressjs.com/ko/)
- [PM2 문서](https://pm2.keymetrics.io/docs/)
- [Node.js 가이드](https://nodejs.org/ko/docs/)

---

<div align="center">

**실시간 턴제 전투의 새로운 경험을 만나보세요!**

[라이브 데모 체험](https://pyxisbattlesystem.monster) | [문서 보기](https://github.com/CriminalTalent/battle-system/wiki) | [이슈 신고](https://github.com/CriminalTalent/battle-system/issues)

</div>
