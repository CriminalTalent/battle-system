# 배틀 시스템

민첩성 기반 선후공 시스템과 실시간 채팅, 전략적 아이템 시스템을 갖춘 팀전 배틀 게임

![Battle System](https://img.shields.io/badge/Version-2.2.0-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![React](https://img.shields.io/badge/React-18+-blue.svg)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7+-red.svg)

## 목차

- [주요 기능](#주요-기능)
- [게임 시스템](#게임-시스템)
- [아이템 시스템](#아이템-시스템)
- [기술 스택](#기술-스택)
- [빠른 시작](#빠른-시작)
- [프로젝트 구조](#프로젝트-구조)
- [API 문서](#api-문서)
- [배포 가이드](#배포-가이드)
- [개발 가이드](#개발-가이드)

## 주요 기능

### 전투 시스템
- **팀전 지원**: 1v1, 2v2, 3v3, 4v4 모드
- **민첩성 기반 선후공**: 팀 민첩성 총합 + 1d100 주사위로 결정
- **3가지 기본 액션**: 공격, 방어, 회피
- **고급 전투 계산**: 명중률, 회피율, 데미지 감소
- **타겟 선택 시스템**: 직관적인 타겟 선택 UI

### 아이템 시스템 🎒
- **전략적 아이템**: 공격/방어 보정기, 회복 물약
- **팀 전용 비밀**: 같은 팀원만 아이템 정보 공유
- **운영진 설정**: 게임 생성 시 팀장이 아이템 구성 결정
- **실시간 사용**: 배틀 중 턴에서 아이템 사용 가능
- **효과 관리**: 지속 효과 및 남은 턴 수 표시

### 액션 시스템
- **공격**: 명중률 80%, 상대의 민첩성 기반 회피 가능
- **방어**: 다음 받는 공격 데미지 50% 감소
- **회피**: 민첩성 +20 증가 (1턴 지속)
- **아이템 사용**: 보정기, 회복 물약 등 전략적 활용

### 실시간 기능
- **Socket.IO**: 실시간 전투 동기화
- **실시간 채팅**: 배틀 중 팀원 간 소통
- **턴 타이머**: 30초 제한 시간 (설정 가능)
- **자동 재연결**: 연결 끊김 시 자동 재연결
- **실시간 로그**: 모든 액션 및 아이템 사용 기록

### 채팅 시스템 💬
- **실시간 메시지**: 배틀 참가자 간 실시간 대화
- **시스템 메시지**: 게임 이벤트 자동 알림
- **메시지 필터링**: 기본적인 욕설 필터
- **채팅 히스토리**: 메시지 기록 유지
- **최소화 기능**: 모바일에서 공간 절약

### 사용자 경험
- **반응형 디자인**: 모바일/데스크톱 최적화
- **키보드 단축키**: 1(공격), 2(방어), 3(회피), Enter(채팅)
- **대상 선택 UI**: 직관적인 클릭 인터페이스
- **시각적 피드백**: 애니메이션 및 상태 표시
- **글래스모피즘 디자인**: 모던한 UI/UX

## 게임 시스템

### 선후공 결정
```
1. 각 팀의 모든 플레이어 민첩성 합계 계산
2. 시스템이 두 민첩성합계를 기반으로 1D100 다이스를 굴림
3. 다이스 점수가 높은쪽이 선공
4. 동점 시 재굴림
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

// 아이템 효과
공격보정기: 공격력 +15 (3턴 지속)
방어보정기: 방어력 +10 (3턴 지속)
회복물약: HP +30 (즉시 효과)
```

### 배틀 플로우
```
배틀 생성 → 아이템 설정 → 플레이어 참가 → 준비 완료 → 선후공 결정 → 배틀 시작 → 턴 진행 → 승부 결정
```

## 아이템 시스템

### 아이템 종류

#### 🗡️ 공격 보정기
- **효과**: 공격력 +15
- **지속시간**: 3턴
- **사용 제한**: 중복 사용 불가
- **최대 개수**: 3개

#### 🛡️ 방어 보정기
- **효과**: 방어력 +10
- **지속시간**: 3턴
- **사용 제한**: 중복 사용 불가
- **최대 개수**: 3개

#### 🧪 회복 물약
- **효과**: HP +30 즉시 회복
- **지속시간**: 즉시
- **사용 제한**: 없음
- **최대 개수**: 3개

### 아이템 규칙

#### 설정 규칙
- **팀장 권한**: 첫 번째 참가자가 팀 아이템 구성
- **수량 제한**: 총 6개 아이템까지 설정 가능
- **비밀 유지**: 상대팀에게 아이템 정보 비공개

#### 사용 규칙
- **턴 제한**: 자신의 턴에만 사용 가능
- **턴 소모**: 아이템 사용도 하나의 액션으로 간주
- **공유 사용**: 팀원 누구나 팀 아이템 사용 가능
- **효과 중첩**: 보정기는 중복 사용 불가, 물약은 제한 없음

#### 보안 기능
- **팀별 격리**: 각 팀의 아이템 정보는 해당 팀만 접근
- **서버 검증**: 모든 아이템 사용은 서버에서 유효성 검증
- **상대방 차단**: 상대팀이나 관전자는 아이템 정보 확인 불가

## 기술 스택

### 백엔드
- **Node.js 18+**: 서버 런타임
- **Express.js**: 웹 프레임워크
- **Socket.IO**: 실시간 통신
- **UUID**: 고유 ID 생성

### 프론트엔드
- **React 18+**: UI 라이브러리
- **Framer Motion**: 애니메이션
- **Socket.IO Client**: 실시간 통신
- **Tailwind CSS**: 스타일링

### 개발 도구
- **Nodemon**: 개발 서버 자동 재시작
- **ESLint**: 코드 품질 관리

## 빠른 시작

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
npm install

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

## 프로젝트 구조

```
battle-system/
├── packages/
│   ├── battle-api/              # 백엔드 서버
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   └── BattleEngine.js     # 핵심 전투 엔진 + 아이템 시스템
│   │   │   ├── socket/
│   │   │   │   └── battleSocket.js     # Socket.IO 핸들러
│   │   │   └── server.js               # 메인 서버
│   │   └── package.json
│   └── battle-web/              # 프론트엔드
│       ├── src/
│       │   ├── components/
│       │   │   ├── BattleField.js      # 메인 배틀 화면
│       │   │   ├── ChatPanel.js        # 채팅 시스템
│       │   │   ├── ItemSetup.js        # 아이템 설정
│       │   │   ├── ItemPanel.js        # 배틀 중 아이템 패널
│       │   │   └── BattleApp.js        # 앱 컴포넌트
│       │   ├── hooks/
│       │   │   └── useBattle.js        # 배틀 상태 관리
│       │   └── styles/
│       │       └── battle.css          # 스타일시트
│       └── package.json
└── README.md
```

## API 문서

### REST API

#### 서버 상태
```http
GET /api/health
```

### Socket.IO 이벤트

#### 클라이언트 → 서버
```javascript
// 배틀 생성 (아이템 시스템 포함)
socket.emit('create_battle', { 
  mode: '2v2',
  settings: {
    itemsEnabled: true,
    turnTimeLimit: 30000,
    maxTurns: 50
  }
});

// 배틀 참가 (팀 아이템 포함)
socket.emit('join_battle', {
  battleId: 'battle_123',
  player: {
    name: 'Player1',
    attack: 60,
    defense: 40,
    agility: 70,
    maxHp: 120
  },
  teamItems: {
    attack_booster: 2,
    defense_booster: 1,
    health_potion: 3
  }
});

// 액션 실행
socket.emit('execute_action', {
  action: {
    type: 'attack',
    targets: ['player_id']
  }
});

// 아이템 사용
socket.emit('execute_action', {
  action: {
    type: 'use_item',
    itemId: 'attack_booster'
  }
});

// 사용 가능한 아이템 목록 요청
socket.emit('get_usable_items');

// 팀 아이템 정보 요청 (같은 팀만)
socket.emit('get_team_items');

// 채팅 메시지 전송
socket.emit('chat_message', {
  text: '좋은 전략이네요!',
  timestamp: Date.now()
});

// 배틀 상태 요청
socket.emit('get_battle_state', {
  battleId: 'battle_123'
});
```

#### 서버 → 클라이언트
```javascript
// 배틀 생성 완료
socket.on('battle_created', (data) => {
  console.log('배틀 ID:', data.battleId);
  console.log('아이템 활성화:', data.itemsEnabled);
});

// 배틀 참가 완료
socket.on('battle_joined', (data) => {
  console.log('팀:', data.team);
  console.log('포지션:', data.position);
  console.log('팀 아이템:', data.battle.teamItems);
});

// 배틀 상태 업데이트 (팀별 다른 정보)
socket.on('battle_updated', (data) => {
  console.log('배틀 상태:', data.battle);
  console.log('팀 아이템:', data.battle.teamItems); // 같은 팀만
});

// 사용 가능한 아이템 목록
socket.on('usable_items', (data) => {
  console.log('사용 가능한 아이템:', data.items);
});

// 팀 아이템 정보
socket.on('team_items', (data) => {
  console.log('팀 아이템:', data.items);
});

// 선후공 결정
socket.on('initiative_rolled', (data) => {
  console.log('선후공 결과:', data.rolls);
});

// 배틀 시작
socket.on('battle_started', (data) => {
  console.log('배틀 시작!');
  console.log('팀 아이템:', data.battle.teamItems); // 같은 팀만
});

// 턴 시작
socket.on('turn_started', (data) => {
  console.log('현재 플레이어:', data.currentPlayer);
  console.log('턴:', data.turn);
});

// 타겟 선택 요구
socket.on('target_selection_required', (data) => {
  console.log('타겟 선택 필요:', data.availableTargets);
});

// 액션 결과 (아이템 사용 포함)
socket.on('action_result', (data) => {
  console.log('액션 결과:', data.result);
  if (data.result.type === 'use_item') {
    console.log('아이템 사용:', data.result.item);
    console.log('효과:', data.result.result.effects);
  }
});

// 배틀 종료
socket.on('battle_finished', (data) => {
  console.log('승자:', data.winner);
});

// 채팅 메시지 수신
socket.on('chat_message', (data) => {
  console.log(`${data.playerName}: ${data.text}`);
});

// 시스템 메시지
socket.on('system_message', (data) => {
  console.log('시스템:', data.message);
});

// 에러
socket.on('error', (error) => {
  console.error('에러:', error.message);
});
```

## 배포 가이드

### 환경 변수 설정

#### .env 파일 (packages/battle-api/.env)
```bash
NODE_ENV=production
PORT=3001
CORS_ORIGIN=http://localhost:3000
CLEANUP_INTERVAL=1800000
TURN_TIME_LIMIT=30000
MAX_TURNS=50
ITEMS_ENABLED=true
```

### PM2를 사용한 배포

#### 1. PM2 글로벌 설치
```bash
npm install -g pm2
```

#### 2. 프로덕션 실행
```bash
cd packages/battle-api
pm2 start src/server.js --name "battle-api"
```

#### 3. 프로세스 관리
```bash
# 상태 확인
pm2 status

# 로그 확인
pm2 logs battle-api

# 재시작
pm2 restart battle-api

# 중단
pm2 stop battle-api
```

## 개발 가이드

### 아이템 시스템 커스터마이징

#### 새로운 아이템 추가
```javascript
// packages/battle-api/src/services/BattleEngine.js
this.itemDefinitions = {
  // 기존 아이템들...
  speed_booster: {
    id: 'speed_booster',
    name: '민첩 보정기',
    description: '민첩성을 20 증가시킵니다',
    type: 'booster',
    effect: { agility: 20 },
    duration: 2,
    usable: true
  }
};
```

#### 아이템 효과 커스터마이징
```javascript
// packages/battle-api/src/services/BattleEngine.js
applyItemEffect(battle, player, item) {
  if (item.type === 'consumable') {
    // 즉시 효과
    if (item.effect.heal) {
      const healAmount = Math.min(item.effect.heal, player.maxHp - player.hp);
      player.hp += healAmount;
    }
  } else if (item.type === 'booster') {
    // 지속 효과
    player.activeItems[item.id] = {
      ...item,
      remainingTurns: item.duration
    };
    
    // 스탯 적용
    Object.entries(item.effect).forEach(([stat, value]) => {
      player[stat] = (player[stat] || 0) + value;
    });
  }
}
```

### 채팅 시스템 커스터마이징

#### 메시지 필터링 수정
```javascript
// packages/battle-api/src/socket/battleSocket.js
filterMessage(message) {
  const forbiddenWords = ['욕설1', '욕설2'];
  let filteredMessage = message;
  
  forbiddenWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    filteredMessage = filteredMessage.replace(regex, '*'.repeat(word.length));
  });
  
  return filteredMessage;
}
```

#### 채팅 UI 커스터마이징
```css
/* packages/battle-web/src/styles/battle.css */
.chat-panel {
  /* 위치, 크기, 색상 등 수정 */
}

.item-panel {
  /* 아이템 패널 스타일 수정 */
}
```

### 새로운 액션 타입 추가

#### 1. BattleEngine.js에 액션 로직 추가
```javascript
processAction(battle, attacker, action) {
  switch (action.type) {
    case 'attack':
      return this.processAttack(battle, attacker, action.targets);
    case 'defend':
      return this.processDefend(battle, attacker);
    case 'dodge':
      return this.processDodge(battle, attacker);
    case 'use_item':
      return this.useItem(battle, attacker, action.itemId);
    case 'heal': // 새 액션 추가
      return this.processHeal(battle, attacker, action.targets);
    default:
      throw new Error('Invalid action type');
  }
}

processHeal(battle, healer, targets) {
  // 힐 로직 구현
}
```

#### 2. 프론트엔드에 버튼 추가
```javascript
// packages/battle-web/src/components/BattleField.js
<button
  onClick={() => handleQuickAction('heal')}
  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg"
>
  힐 (4)
</button>
```

### 새로운 게임 모드 추가
```javascript
// packages/battle-api/src/services/BattleEngine.js
getMinPlayers(mode) {
  const playerCounts = {
    '1v1': 2,
    '2v2': 4,
    '3v3': 6,
    '4v4': 8,
    '5v5': 10, // 새 모드 추가
    'battle_royale': 8 // 배틀로얄 모드
  };
  return playerCounts[mode] || 2;
}
```

### 아이템 밸런스 조정
```javascript
// packages/battle-api/src/services/BattleEngine.js
this.itemDefinitions = {
  attack_booster: {
    effect: { attack: 12 }, // 15에서 12로 너프
    duration: 2 // 3턴에서 2턴으로 변경
  },
  health_potion: {
    effect: { heal: 40 } // 30에서 40으로 버프
  }
};
```

### 디버깅

#### 서버 로그 확인
```bash
# 실시간 로그
pm2 logs battle-api

# 아이템 관련 로그만 확인
pm2 logs battle-api | grep item
```

#### 클라이언트 디버깅
```javascript
// 브라우저 콘솔에서 상태 확인
console.log('Socket 연결 상태:', socket.connected);
console.log('배틀 상태:', battleState);
console.log('사용 가능한 아이템:', usableItems);
console.log('팀 아이템:', teamItems);
```

### 성능 모니터링

#### 배틀 통계 확인
```javascript
// BattleEngine에서 통계 조회
const stats = battleEngine.getStats();
console.log('활성 배틀:', stats.activeBattles);
console.log('대기 중 배틀:', stats.waitingBattles);
console.log('아이템 사용 횟수:', stats.itemUsageCount);
```

## 주요 변경사항 (v2.2.0)

### 새로운 기능
- ✅ **전략적 아이템 시스템**: 공격/방어 보정기, 회복 물약
- ✅ **팀 전용 비밀 아이템**: 상대팀에게 비공개
- ✅ **아이템 설정 UI**: 게임 생성 시 직관적인 아이템 구성
- ✅ **실시간 아이템 패널**: 배틀 중 아이템 사용 및 효과 표시
- ✅ **아이템 효과 관리**: 지속 효과 및 남은 턴 수 표시

### 개선사항
- 🔧 **팀별 데이터 격리**: 서버에서 팀별로 다른 정보 전송
- 🔧 **아이템 유효성 검증**: 서버에서 모든 아이템 사용 검증
- 🔧 **UI/UX 개선**: 아이템 패널 및 설정 화면 추가
- 🔧 **게임 밸런스**: 아이템 수량 제한 및 효과 조정

### 이전 기능 (v2.1.0)
- ✅ 실시간 채팅 시스템
- ✅ 타겟 선택 UI 개선
- ✅ 글래스모피즘 디자인 적용
- ✅ 모바일 반응형 지원
- ✅ 키보드 단축키 확장

## 로드맵

### v2.3.0 (계획)
- [ ] 스킬 시스템 추가 (궁극기 등)
- [ ] 상태 이상 효과 (독, 마비, 수면)
- [ ] 아이템 조합 시스템
- [ ] 관전자 모드

### v2.4.0 (계획)
- [ ] AI 봇 플레이어
- [ ] 랭킹 시스템
- [ ] 리플레이 기능
- [ ] 커스텀 룰셋

### v3.0.0 (장기)
- [ ] 길드 시스템
- [ ] 토너먼트 모드
- [ ] 모바일 앱
- [ ] 3D 그래픽

## 라이선스

MIT License

## 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/ItemSystem`)
3. Commit your Changes (`git commit -m 'Add Item System'`)
4. Push to the Branch (`git push origin feature/ItemSystem`)
5. Open a Pull Request

## 지원

문제가 발생하거나 질문이 있으시면 [Issues](https://github.com/CriminalTalent/battle-system/issues)에 올려주세요.

### FAQ

**Q: 아이템은 어떻게 설정하나요?**
A: 배틀 생성 시 첫 번째 참가자가 "아이템 시스템 사용"을 체크하고 원하는 아이템을 선택할 수 있습니다.

**Q: 상대팀이 우리 아이템을 볼 수 있나요?**
A: 아니요. 아이템 정보는 같은 팀원들만 볼 수 있으며, 상대팀이나 관전자에게는 완전히 비공개입니다.

**Q: 아이템을 언제 사용할 수 있나요?**
A: 자신의 턴에만 아이템을 사용할 수 있으며, 아이템 사용도 하나의 액션으로 간주됩니다.

**Q: 보정기를 중복으로 사용할 수 있나요?**
A: 같은 종류의 보정기는 중복 사용할 수 없습니다. 이미 효과가 활성화된 상태에서는 사용이 제한됩니다.
