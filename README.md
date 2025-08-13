# Battle System - 프로젝트 구조

```
battle-system/
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── LICENSE
├── docs/
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── RULES.md
├── scripts/
│   ├── deploy.sh
│   ├── backup.sh
│   └── setup.sh
├── nginx/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── ssl/
├── packages/
│   ├── battle-api/                  # 백엔드 (Node.js + Socket.IO)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   ├── jest.config.js
│   │   ├── src/
│   │   │   ├── app.js              # 메인 애플리케이션
│   │   │   ├── config/
│   │   │   │   ├── database.js
│   │   │   │   ├── redis.js
│   │   │   │   └── logger.js
│   │   │   ├── middleware/
│   │   │   │   ├── auth.js
│   │   │   │   ├── validation.js
│   │   │   │   ├── rateLimit.js
│   │   │   │   └── errorHandler.js
│   │   │   ├── routes/
│   │   │   │   ├── index.js
│   │   │   │   ├── admin.js
│   │   │   │   ├── battle.js
│   │   │   │   ├── upload.js
│   │   │   │   └── health.js
│   │   │   ├── services/
│   │   │   │   ├── BattleEngine.js  # 핵심 전투 엔진
│   │   │   │   ├── TokenService.js
│   │   │   │   ├── ImageService.js
│   │   │   │   ├── StatsService.js
│   │   │   │   └── NotificationService.js
│   │   │   ├── socket/
│   │   │   │   ├── battleSocket.js  # Socket.IO 핸들러
│   │   │   │   ├── adminSocket.js
│   │   │   │   └── spectatorSocket.js
│   │   │   ├── models/
│   │   │   │   ├── Battle.js
│   │   │   │   ├── Character.js
│   │   │   │   └── BattleLog.js
│   │   │   ├── utils/
│   │   │   │   ├── dice.js
│   │   │   │   ├── rules.js
│   │   │   │   ├── constants.js
│   │   │   │   ├── helpers.js
│   │   │   │   └── validators.js
│   │   │   └── tests/
│   │   │       ├── battle.test.js
│   │   │       ├── token.test.js
│   │   │       └── dice.test.js
│   │   ├── uploads/                 # 업로드된 이미지 저장
│   │   │   ├── characters/
│   │   │   └── temp/
│   │   └── logs/                    # 로그 파일
│   │
│   └── battle-web/                  # 프론트엔드 (Next.js)
│       ├── package.json
│       ├── Dockerfile
│       ├── .dockerignore
│       ├── next.config.js
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.js
│       │   │   ├── page.js          # 메인 페이지
│       │   │   ├── globals.css
│       │   │   ├── admin/
│       │   │   │   ├── page.js      # 관리자 패널
│       │   │   │   ├── create/
│       │   │   │   │   └── page.js  # 전투방 생성
│       │   │   │   └── dashboard/
│       │   │   │       └── page.js  # 관리자 대시보드
│       │   │   ├── battle/
│       │   │   │   └── [token]/
│       │   │   │       └── page.js  # 전투 참가 페이지
│       │   │   ├── watch/
│       │   │   │   └── [roomId]/
│       │   │   │       └── page.js  # 관람 페이지
│       │   │   └── api/
│       │   │       └── auth/
│       │   │           └── route.js
│       │   ├── components/
│       │   │   ├── ui/              # 기본 UI 컴포넌트
│       │   │   │   ├── Button.js
│       │   │   │   ├── Card.js
│       │   │   │   ├── Input.js
│       │   │   │   ├── Modal.js
│       │   │   │   ├── Progress.js
│       │   │   │   ├── Badge.js
│       │   │   │   └── Toast.js
│       │   │   ├── layout/
│       │   │   │   ├── Header.js
│       │   │   │   ├── Footer.js
│       │   │   │   └── Sidebar.js
│       │   │   ├── battle/          # 전투 관련 컴포넌트
│       │   │   │   ├── BattleField.js
│       │   │   │   ├── CharacterCard.js
│       │   │   │   ├── HealthBar.js
│       │   │   │   ├── ActionPanel.js
│       │   │   │   ├── SkillPanel.js
│       │   │   │   ├── BattleLog.js
│       │   │   │   ├── TurnIndicator.js
│       │   │   │   ├── StatusEffects.js
│       │   │   │   ├── DamageNumber.js
│       │   │   │   └── SpectatorView.js
│       │   │   ├── admin/           # 관리자 컴포넌트
│       │   │   │   ├── AdminPanel.js
│       │   │   │   ├── BattleCreator.js
│       │   │   │   ├── CharacterUpload.js
│       │   │   │   ├── LinkGenerator.js
│       │   │   │   ├── BattleList.js
│       │   │   │   ├── StatsPanel.js
│       │   │   │   └── RulesetEditor.js
│       │   │   └── shared/          # 공용 컴포넌트
│       │   │       ├── LoadingSpinner.js
│       │   │       ├── ErrorBoundary.js
│       │   │       ├── ImageUpload.js
│       │   │       └── CopyToClipboard.js
│       │   ├── hooks/               # 커스텀 훅
│       │   │   ├── useSocket.js
│       │   │   ├── useBattle.js
│       │   │   ├── useAuth.js
│       │   │   ├── useLocalStorage.js
│       │   │   ├── useDebounce.js
│       │   │   └── useNotification.js
│       │   ├── services/            # API 서비스
│       │   │   ├── api.js
│       │   │   ├── socket.js
│       │   │   ├── auth.js
│       │   │   ├── upload.js
│       │   │   └── analytics.js
│       │   ├── utils/               # 유틸리티
│       │   │   ├── constants.js
│       │   │   ├── helpers.js
│       │   │   ├── formatters.js
│       │   │   ├── validators.js
│       │   │   └── animations.js
│       │   ├── store/               # 상태 관리 (선택사항)
│       │   │   ├── battleStore.js
│       │   │   ├── authStore.js
│       │   │   └── uiStore.js
│       │   └── styles/              # 스타일
│       │       ├── globals.css
│       │       ├── components.css
│       │       └── animations.css
│       ├── public/
│       │   ├── images/
│       │   │   ├── characters/      # 기본 캐릭터 이미지
│       │   │   ├── backgrounds/     # 배경 이미지
│       │   │   ├── effects/         # 이펙트 이미지
│       │   │   └── ui/              # UI 아이콘
│       │   ├── sounds/              # 사운드 파일
│       │   │   ├── sfx/
│       │   │   └── bgm/
│       │   ├── favicon.ico
│       │   └── manifest.json
│       └── __tests__/               # 프론트엔드 테스트
│           ├── components/
│           ├── hooks/
│           └── utils/
│
├── database/                        # 데이터베이스 (선택사항)
│   ├── migrations/
│   ├── seeds/
│   └── schema.sql
│
└── k8s/                            # Kubernetes 배포 (선택사항)
    ├── namespace.yaml
    ├── configmap.yaml
    ├── secret.yaml
    ├── api-deployment.yaml
    ├── web-deployment.yaml
    ├── nginx-deployment.yaml
    ├── redis-deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

## 📁 주요 디렉토리 설명

### `/packages/battle-api/` - 백엔드
- **`src/services/BattleEngine.js`**: 핵심 전투 로직 (턴 관리, 액션 처리, 상태 계산)
- **`src/socket/battleSocket.js`**: 실시간 통신 핸들러
- **`src/services/TokenService.js`**: JWT 토큰 생성/검증 (초대링크)
- **`src/routes/`**: REST API 엔드포인트
- **`src/utils/rules.js`**: 전투 룰셋 정의

### `/packages/battle-web/` - 프론트엔드
- **`src/components/battle/`**: 전투 화면 UI 컴포넌트
- **`src/components/admin/`**: 관리자 패널 컴포넌트
- **`src/hooks/useBattle.js`**: 전투 상태 관리 훅
- **`src/services/socket.js`**: Socket.IO 클라이언트

### `/nginx/` - 웹 서버
- **`nginx.conf`**: 리버스 프록시 + SSL 설정
- **`ssl/`**: SSL 인증서 저장

### `/scripts/` - 배포 스크립트
- **`deploy.sh`**: 원클릭 배포 스크립트
- **`backup.sh`**: 데이터 백업 스크립트

## 🚀 주요 기능별 파일 매핑

### 전투 시스템 코어
```
BattleEngine.js + battleSocket.js + BattleField.js
```

### 초대/관람 링크 시스템
```
TokenService.js + LinkGenerator.js + [token]/page.js
```

### 관리자 패널
```
admin.js (routes) + AdminPanel.js + BattleCreator.js
```

### 실시간 UI
```
useSocket.js + useBattle.js + CharacterCard.js + BattleLog.js
```

### 이미지 업로드
```
ImageService.js + upload.js (routes) + ImageUpload.js
```

이 구조로 GitHub에 올리면 각 기능별로 명확하게 분리되어 있어서 협업하기 좋고, 단계적으로 개발하기도 편할 것 같습니다!
