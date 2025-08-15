# 🛡️ 팀전 배틀 시스템

민첩성 기반 선후공 시스템을 갖춘 실시간 팀전 배틀 게임

![Battle System](https://img.shields.io/badge/Version-2.0.0-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![React](https://img.shields.io/badge/React-18+-blue.svg)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7+-red.svg)

## 📖 목차

- [주요 기능](#-주요-기능)
- [게임 시스템](#-게임-시스템)
- [기술 스택](#-기술-스택)
- [빠른 시작](#-빠른-시작)
- [프로젝트 구조](#-프로젝트-구조)
- [API 문서](#-api-문서)
- [배포 가이드](#-배포-가이드)
- [개발 가이드](#-개발-가이드)

## 🎮 주요 기능

### ⚔️ 전투 시스템
- **팀전 지원**: 1v1, 2v2, 3v3, 4v4 모드
- **민첩성 기반 선후공**: 팀 민첩성 총합 + 1d20 주사위로 결정
- **3가지 액션**: 공격, 방어, 회피
- **고급 전투 계산**: 명중률, 회피율, 데미지 감소

### 🎯 액션 시스템
- **공격**: 명중률 80%, 상대의 민첩성 기반 회피 가능
- **방어**: 다음 받는 공격 데미지 50% 감소
- **회피**: 민첩성 +20 증가 (1턴 지속)

### 🌐 실시간 기능
- **Socket.IO**: 실시간 전투 동기화
- **턴 타이머**: 30초 제한 시간
- **자동 재연결**: 연결 끊김 시 자동 재연결
- **실시간 로그**: 모든 액션 기록

### 📱 사용자 경험
- **반응형 디자인**: 모바일/데스크톱 최적화
- **키보드 단축키**: 1(공격), 2(방어), 3(회피)
- **대상 선택 UI**: 직관적인 클릭 인터페이스
- **시각적 피드백**: 애니메이션 및 상태 표시

## 🎲 게임 시스템

### 선후공 결정
```
1. 각 팀의 모든 플레이어 민첩성 합계 계산
2. 각 팀이 1d20 주사위 굴림
3. 민첩성 총합 + 주사위 = 최종 점수
4. 높은 점수를 얻은 팀이 선공
5. 동점 시 재굴림
```

### 턴 순서
```
선공팀 전체 행동 → 후공팀 전체 행동 → 반복
```

### 전투 계산
```javascript
// 공격 계산
기본명중률: 80%
회피율: min(대상 민첩성 / 10, 30%)
기본데미지: 공격력 - 방어력
데미지변동: 80% ~ 120%

// 방어 효과
방어상태: 다음 공격 데미지 50% 감소

// 회피 효과  
회피상태: 민첩성 +20 (1턴 지속)
```

## 🛠️ 기술 스택

### 백엔드
- **Node.js 18+**: 서버 런타임
- **Express.js**: 웹 프레임워크
- **Socket.IO**: 실시간 통신
- **UUID**: 고유 ID 생성
- **Lodash**: 유틸리티 함수

### 프론트엔드
- **React 18+**: UI 라이브러리
- **Framer Motion**: 애니메이션
- **Socket.IO Client**: 실시간 통신
- **Tailwind CSS**: 스타일링

### 개발 도구
- **Nodemon**: 개발 서버 자동 재시작
- **ESLint**: 코드 품질 관리
- **Jest**: 테스트 프레임워크

## 🚀 빠른 시작

### 사전 요구사항
- Node.js 18.0.0 이상
- npm 8.0.0 이상

### 1. 레포지토리 클론
```bash
git clone https://github.com/CriminalTalent/battle-system.git
cd battle-system
```

### 2. 의존성 설치
```bash
# API 서버
cd packages/battle-api
npm run setup

# 웹 클라이언트
cd ../battle-web
npm install
```

### 3. 개발 서버 실행
```bash
# API 서버 (터미널 1)
cd packages/battle-api
npm run dev

# 웹 클라이언트 (터미널 2)
cd packages/battle-web
npm start
```

### 4. 접속
- **웹 클라이언트**: http://localhost:3000
- **API 서버**: http://localhost:3001
- **헬스체크**: http://localhost:3001/api/health

## 📁 프로젝트 구조

```
battle-system/
├── packages/
│   ├── battle-api/              # 백엔드 서버
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   └── BattleEngine.js     # 핵심 전투 엔진
│   │   │   ├── socket/
│   │   │   │   └── battleSocket.js     # Socket.IO 핸들러
│   │   │   └── server.js               # 메인 서버
│   │   ├── package.json
│   │   └── ecosystem.config.js         # PM2 설정
│   └── battle-web/              # 프론트엔드
│       ├── src/
│       │   ├── components/
│       │   │   ├── BattleField.js      # 메인 배틀 화면
│       │   │   └── BattleApp.js        # 앱 컴포넌트
│       │   ├── hooks/
│       │   │   └── useBattle.js        # 배틀 상태 관리
│       │   └── styles/
│       │       └── battle.css          # 스타일시트
│       └── package.json
├── docker-compose.yml           # Docker 컨테이너 설정
└── README.md
```

## 📡 API 문서

### REST API

#### 배틀 생성
```http
POST /api/battles
Content-Type: application/json

{
  "mode": "2v2",
  "settings": {
    "turnTimeLimit": 30000,
    "maxTurns": 50
  }
}
```

#### 배틀 조회
```http
GET /api/battles/:battleId
```

#### 서버 상태
```http
GET /api/health
```

### Socket.IO 이벤트

#### 클라이언트 → 서버
```javascript
// 배틀 생성
socket.emit('create_battle', { mode: '2v2' });

// 배틀 참가
socket.emit('join_battle', {
  battleId: 'battle_123',
  playerName: 'Player1',
  attack: 60,
  defense: 40,
  agility: 70,
  maxHp: 120
});

// 액션 실행
socket.emit('execute_action', {
  action: {
    type: 'attack',
    targets: ['player_id']
  }
});
```

#### 서버 → 클라이언트
```javascript
// 배틀 생성 완료
socket.on('battle_created', (data) => {
  console.log('배틀 ID:', data.battleId);
});

// 배틀 상태 업데이트
socket.on('battle_updated', (data) => {
  console.log('배틀 상태:', data.battle);
});

// 액션 결과
socket.on('action_result', (data) => {
  console.log('액션 결과:', data.result);
});
```

## 🐳 배포 가이드

### Docker를 사용한 배포

#### 1. Docker Compose로 전체 시스템 실행
```bash
# 프로덕션 배포
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 서비스 중단
docker-compose down
```

#### 2. 개별 서비스 배포
```bash
# API 서버만 실행
docker-compose up -d battle-api

# 웹 클라이언트만 실행
docker-compose up -d battle-web
```

### PM2를 사용한 배포

#### 1. PM2 글로벌 설치
```bash
npm install -g pm2
```

#### 2. 프로덕션 실행
```bash
cd packages/battle-api
npm run pm2:start
```

#### 3. 프로세스 관리
```bash
# 상태 확인
pm2 status

# 로그 확인
pm2 logs battle-api

# 재시작
npm run pm2:restart

# 중단
npm run pm2:stop
```

### 환경 변수 설정

#### .env 파일 (packages/battle-api/.env)
```bash
NODE_ENV=production
PORT=3001
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=your-super-secret-key
CLEANUP_INTERVAL=1800000
```

## 👩‍💻 개발 가이드

### 개발 환경 설정

#### 1. Git 훅 설정
```bash
# 커밋 전 린트 검사
npm run lint

# 테스트 실행
npm test
```

#### 2. 코드 스타일
```bash
# ESLint 실행
npm run lint

# 자동 수정
npm run lint:fix
```

### 테스트

#### 1. 단위 테스트
```bash
cd packages/battle-api
npm test
```

#### 2. 통합 테스트
```bash
npm run test:integration
```

#### 3. 커버리지 확인
```bash
npm run test:coverage
```

### 새로운 기능 추가

#### 1. 새로운 액션 타입 추가
```javascript
// packages/battle-api/src/services/BattleEngine.js
processAction(battle, attacker, action) {
  switch (action.type) {
    case 'attack':
      return this.processAttack(battle, attacker, action.targets);
    case 'defend':
      return this.processDefend(battle, attacker);
    case 'dodge':
      return this.processDodge(battle, attacker);
    case 'your_new_action': // 새 액션 추가
      return this.processYourNewAction(battle, attacker, action.targets);
    default:
      throw new Error('Invalid action type');
  }
}
```

#### 2. 새로운 게임 모드 추가
```javascript
// packages/battle-api/src/services/BattleEngine.js
getMinPlayers(mode) {
  const playerCounts = {
    '1v1': 2,
    '2v2': 4,
    '3v3': 6,
    '4v4': 8,
    '5v5': 10, // 새 모드 추가
    'custom': 12 // 커스텀 모드
  };
  return playerCounts[mode] || 2;
}
```

### 디버깅

#### 1. 서버 로그
```bash
# 실시간 로그 확인
tail -f packages/battle-api/logs/app.log

# 에러 로그만 확인
grep "ERROR" packages/battle-api/logs/app.log
```

#### 2. 클라이언트 디버깅
```javascript
// 브라우저 콘솔에서 Socket 상태 확인
window.socket = socket; // useBattle 훅에서 설정
console.log('Socket 상태:', window.socket.connected);
```

## 🤝 기여하기

1. 이 레포지토리를 포크합니다
2. 새로운 기능 브랜치를 생성합니다 (`git checkout -b feature/AmazingFeature`)
3. 변경사항을 커밋합니다 (`git commit -m 'Add some AmazingFeature'`)
4. 브랜치에 푸시합니다 (`git push origin feature/AmazingFeature`)
5. Pull Request를 생성합니다

### 커밋 컨벤션
```
feat: 새로운 기능 추가
fix: 버그 수정
docs: 문서 수정
style: 코드 스타일 변경 (포맷팅 등)
refactor: 코드 리팩토링
test: 테스트 코드 추가/수정
chore: 빌드 도구, 설정 파일 등의 변경
```

## 📝 라이선스

이 프로젝트는 MIT 라이선스 하에 있습니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🐛 버그 리포트 및 문의

버그를 발견하거나 질문이 있으시면 [GitHub Issues](https://github.com/CriminalTalent/battle-system/issues)에 등록해주세요.

## 📊 로드맵

### v2.1.0 (계획)
- [ ] 스킬 시스템 추가
- [ ] 상태 이상 효과 (독, 마비, 수면)
- [ ] 아이템 시스템
- [ ] 관전자 채팅

### v2.2.0 (계획)
- [ ] AI 봇 플레이어
- [ ] 랭킹 시스템
- [ ] 리플레이 기능
- [ ] 커스텀 룰셋

### v3.0.0 (장기)
- [ ] 길드 시스템
- [ ] 토너먼트 모드
- [ ] 모바일 앱
- [ ] 3D 그래픽

## 🙏 감사의 말

이 프로젝트는 다음 오픈소스 라이브러리들 덕분에 가능했습니다:

- [Node.js](https://nodejs.org/)
- [React](https://reactjs.org/)
- [Socket.IO](https://socket.io/)
- [Express.js](https://expressjs.com/)
- [Framer Motion](https://www.framer.com/motion/)

---

⚔️ **Happy Battle Coding!** 🛡️
