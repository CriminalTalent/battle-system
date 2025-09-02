# ✨ PYXIS Battle System

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-blue.svg)](https://socket.io/)
[![Express](https://img.shields.io/badge/Express-4.18-red.svg)](https://expressjs.com/)
[![PM2](https://img.shields.io/badge/PM2-Ready-orange.svg)](https://pm2.keymetrics.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> 🌟 **우아한 디자인과 몰입감 있는 UX를 갖춘 실시간 턴제 전투 시스템**  
> 천체 테마의 고급스러운 인터페이스로 팀 대 팀 전략 전투를 경험하세요!

<div align="center">

![PYXIS Logo](https://raw.githubusercontent.com/CriminalTalent/battle-system/main/docs/pyxis-logo.png)

**[라이브 데모](https://pyxisbattlesystem.monster)** • **[문서](https://github.com/CriminalTalent/battle-system/wiki)** • **[이슈 신고](https://github.com/CriminalTalent/battle-system/issues)**

</div>

---

## 🎯 핵심 특징

### 🎮 **완벽한 게임플레이**
- **팀 대 팀 전투**: 1v1, 2v2, 3v3, 4v4 지원
- **민첩성 기반 이니셔티브**: 팀 민첩성 합계로 선공 결정
- **전략적 턴제 시스템**: 공격/방어/회피/아이템/패스 선택
- **실시간 동기화**: 모든 액션 즉시 반영
- **자동 패스**: 5분 무반응시 자동 턴 넘김

### ⚔️ **깊이있는 전투 시스템**
- **스탯 기반 계산**: 공격/방어/민첩/행운 (1-10, 총합 12포인트)
- **주사위 시스템**: 모든 액션에 1-20 주사위 적용
- **치명타 메커니즘**: 행운 스탯에 따른 확률 계산
- **방어 역공격**: 방어 성공시 반격 기회 제공
- **아이템 전략**: 디터니(회복), 공격/방어 보정기

### 🎨 **우아한 UI/UX**
- **Pyxis 천체 테마**: 짙은 네이비(#00080D) + 골드(#DCC7A2) 조합
- **Cinzel 디스플레이 폰트**: 고급스러운 세리프 타이틀
- **글래스모피즘**: 반투명 카드와 백드롭 블러 효과
- **부드러운 애니메이션**: 별 반짝임, 호버 효과, 시머 효과
- **완벽한 반응형**: 모바일/태블릿/데스크톱 최적화

### 🚀 **고급 기능**
- **실시간 채팅**: 팀 채팅 및 전체 채팅 지원
- **관전자 시스템**: 실시간 관전 + 응원 메시지
- **OTP 인증**: 보안 강화된 접근 제어
- **아바타 시스템**: 플레이어별 이미지 업로드
- **통계 모니터링**: 실시간 서버 및 전투 통계

---

## 🚀 빠른 시작

### 📋 필수 조건
- Node.js 18+
- npm 8+
- Git

### ⚡ 라이브 서버 접속
```
메인 서버: https://pyxisbattlesystem.monster

관리자: https://pyxisbattlesystem.monster/admin
플레이어: https://pyxisbattlesystem.monster/play
관전자: https://pyxisbattlesystem.monster/watch
```

### 🔧 로컬 개발 환경

```bash
# 저장소 클론
git clone https://github.com/CriminalTalent/battle-system.git
cd battle-system

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 또는 프로덕션 모드
npm start

# PM2로 실행
npm run pm2:start
```

#### 🌐 접속 URL (로컬)
- **관리자**: http://localhost:3001/admin
- **플레이어**: http://localhost:3001/play  
- **관전자**: http://localhost:3001/watch
- **API 상태**: http://localhost:3001/api/health

---

## 🎮 게임 가이드

### 🔥 전투 시작하기

#### **1단계: 관리자 - 전투 생성**
1. 관리자 페이지 접속
2. 전투 모드 선택 (1v1 ~ 4v4)
3. **"전투 생성"** 클릭
4. 전투 ID 자동 생성 확인

#### **2단계: 관리자 - 참여자 구성**
1. **플레이어 추가**:
   - 이름 입력 (중복 불가, 최대 20글자)
   - 팀 선택: 불사조 기사단 vs 죽음을 먹는 자들
   - 스탯 배분: 총 12포인트를 공격/방어/민첩/행운에 분배
   - 시작 아이템 설정: 디터니, 공격/방어 보정기
   - 아바타 이미지 업로드 (선택사항, 최대 5MB)

2. **링크 생성**:
   - **"플레이어별 링크 생성"** 클릭
   - 각 플레이어별 전용 OTP 링크 생성
   - 관전자 링크도 함께 생성 (최대 30명)

#### **3단계: 참여자 - 입장 및 인증**
- **플레이어**: 전용 링크로 접속 → 자동 인증 및 전투 입장
- **관전자**: 관전자 링크 접속 → 원하는 닉네임으로 로그인

#### **4단계: 관리자 - 전투 시작**
1. **"전투 시작"** 클릭
2. 양 팀 민첩성 합계 계산 후 선공 팀 자동 결정
3. 실시간 전투 시작!

### ⚔️ 전투 시스템 이해하기

#### **기본 전투 공식**
```
🗡️  기본 공격력 = 공격력 + 주사위(1-20) - 상대 방어력
💥 치명타 확률 = 주사위(1-20) ≥ (20 - 행운/2)
🎯 명중률 = 행운 + 주사위(1-20)
🏃 회피율 = 민첩성 + 주사위(1-20) ≥ 상대 공격력
🛡️  방어 역공 = 민첩성 + 주사위(1-20) ≥ 상대 공격력
```

#### **액션 옵션**
- **🗡️ 공격**: 적을 선택하여 대미지 가하기
- **🛡️ 방어**: 적의 공격을 막고 역공격 기회
- **🏃 회피**: 다음 공격에 대한 회피율 +5 보너스
- **💊 아이템**: 디터니(HP +10), 공격/방어 보정기 사용
- **⏭️ 패스**: 아무 행동 없이 턴 넘기기

#### **아이템 시스템**
| 아이템 | 효과 | 성공률 | 사용법 |
|--------|------|--------|--------|
| 디터니 | HP +10 | 100% | 아군 대상 선택 |
| 공격 보정기 | 다음 공격 1.5배 | 10% | 즉시 사용 |
| 방어 보정기 | 다음 방어 1.5배 | 10% | 즉시 사용 |

### 🏁 승부 결정
- **전멸**: 한 팀이 모두 HP 0이 되면 즉시 승부 결정
- **시간 종료**: 1시간 경과시 양 팀 총 HP 합계로 승자 결정
- **최대 턴**: 100턴 도달시 HP 합계로 승자 결정

---

## 🖥️ 사용자 인터페이스

### 👨‍💼 관리자 페이지
```
┌─────────────────────────────────────────┐
│              PYXIS 헤더                 │
├─────────────────────────────────────────┤
│전투 제어│    참여자 관리     │ 모니터링  │
│        │                   │          │
│ ┌전투생성┐ │ ┌─플레이어 추가─┐ │ ┌실시간┐ │
│ │모드선택│ │ │ 이름│팀│스탯    │ │ │통계  │ │
│ └──────┘ │ │ 아바타│아이템   │ │ └────┘ │
│         │ └─────────────┘ │        │
│ ┌제어버튼┐ │                │ ┌전투  │ │
│ │시작│종료│ │ ┌───팀 로스터───┐ │ │진행  │ │
│ └──────┘ │ │ 불사조 │ 죽음을 │ │ │상황  │ │
│         │ │ 기사단 │ 먹는  │ │ └────┘ │
│ ┌링크생성┐ │ └─────────────┘ │        │
│ └──────┘ │                │ ┌로그   │ │
└─────────────────────────────┤ │채팅   │ │
                              │ └────┘ │
                              └────────┘
```

### 🎮 플레이어 페이지
```
┌─────────────────────────────────────────┐
│              PYXIS 헤더                 │
├─────────────────────────────────────────┤
│  내 정보  │    전투 현황      │  액션   │
│  & 팀원   │                   │  패널   │
│         │  ┌─ 턴 정보 ─┐    │        │
│  ┌내정보┐  │  현재턴│타이머   │  ┌액션┐ │
│  │아바타│  └───────────┘    │  │선택│ │
│  │스탯HP│  │                   │  └──┘ │
│  └────┘  │  ┌─ 전투 상황 ─┐  │        │
│         │  │ 양팀 HP현황   │  │ ┌타겟┐ │
│  ┌팀원들┐  └─────────────┘  │  │선택│ │
│  │상태  │  │                   │  └──┘ │
│  └────┘  │                   │        │
└─────────────────────────────────────────┤
│            로그 & 채팅                  │
│  ┌─────전투로그─────┐ ┌──────채팅──────┐ │
│  │ 실시간 액션 로그  │ │ 팀/전체 채팅   │ │
│  └─────────────────┘ └──────────────┘ │
└─────────────────────────────────────────┘
```

### 👀 관전자 페이지
```
┌─────────────────────────────────────────┐
│              PYXIS 헤더                 │
├─────────────────────────────────────────┤
│플레이어 상태│      실시간 전투 뷰       │
│           │                          │
│ ┌양팀현황┐  │  ┌──── 현재 액션 ────┐  │
│ │불사조  │  │  │     누구의 턴     │  │
│ │기사단  │  │  └─────────────────┘  │
│ └──────┘  │                          │
│          │  ┌──── 액션 결과 ────┐  │
│ ┌죽음을  │  │   실시간 전투 로그   │  │
│ │먹는자들│  │                      │  │
│ └──────┘  │  └─────────────────┘  │
│          │                          │
│ ┌전투정보┐  │  ┌──── 응원하기 ────┐  │
│ │턴│시간│  │  │ 🎉 📣 💪 ⭐ 🔥   │  │
│ └──────┘  │  └─────────────────┘  │
└─────────────────────────────────────────┤
│              채팅 & 응원                │
│  ┌────────채팅 메시지────────┐          │
│  │ 플레이어/관전자 대화       │          │
│  └─────────────────────────┘          │
└─────────────────────────────────────────┘
```

---

## 🎯 고급 기능

### 🔐 보안 시스템
- **OTP 인증**: 6자리 영숫자 일회용 비밀번호
- **역할 기반 권한**: 관리자/플레이어/관전자 구분
- **세션 관리**: 연결 상태 추적 및 복구
- **파일 업로드 보안**: 이미지 파일만 허용, 5MB 제한

### 📊 실시간 모니터링
- **서버 통계**: CPU, 메모리, 연결 수
- **전투 통계**: 턴 수, 액션 수, 플레이 시간
- **연결 관리**: 실시간 접속자 추적
- **로그 시스템**: 모든 액션 기록 및 분석

### 🌐 네트워킹 최적화
- **Socket.IO 4.7**: WebSocket + Polling 폴백
- **연결 복구**: 자동 재연결 및 상태 동기화
- **지연 최소화**: 효율적인 이벤트 브로드캐스팅
- **확장성**: 다중 서버 지원 가능한 구조

---

## 🛠️ 개발 및 배포

### 📁 프로젝트 구조
```
battle-system/
├── packages/battle-server/
│   ├── src/
│   │   ├── engine/
│   │   │   └── BattleEngine.js      # 핵심 전투 로직
│   │   └── socket/
│   │       └── socketHandlers.js    # 실시간 통신
│   ├── public/
│   │   ├── assets/
│   │   │   ├── css/                 # 우아한 스타일
│   │   │   └── js/                  # 클라이언트 로직
│   │   └── pages/                   # HTML 페이지
│   ├── uploads/                     # 아바타 이미지
│   └── index.js                     # 서버 메인
├── package.json
└── README.md
```

### 🔨 개발 명령어
```bash
# 개발 서버 (핫 리로드)
npm run dev

# 프로덕션 빌드
npm start

# PM2 배포
npm run pm2:start

# 로그 확인
npm run pm2:logs

# 서버 상태 확인
npm run health

# 코드 검사
npm run lint

# 정리
npm run clean
```

### 🚀 프로덕션 배포

#### **PM2 설정** (ecosystem.config.js)
```javascript
module.exports = {
  apps: [{
    name: 'battle-system',
    script: 'packages/battle-server/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    max_memory_restart: '1G',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    time: true
  }]
}
```

#### **Nginx 설정**
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
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🎮 게임 플레이 팁

### 👨‍💼 관리자용
- **팀 밸런스**: 각 팀의 총 스탯 합계를 비슷하게 맞추기
- **아이템 배분**: 전투 길이에 따라 아이템 개수 조절
- **실시간 모니터링**: 연결 상태와 턴 진행 상황 확인
- **채팅 관리**: 부적절한 메시지 모니터링

### 🎮 플레이어용
- **키보드 단축키**: 1(공격), 2(방어), 3(회피), 4(아이템), 5(패스)
- **스탯 전략**: 
  - 공격형: 공격 7+ 행운 3+
  - 방어형: 방어 7+ 민첩 3+
  - 균형형: 모든 스탯 3씩
- **아이템 타이밍**: 위기상황에서 디터니, 결정적 순간에 보정기
- **팀 소통**: 채팅으로 전략 공유 및 협력

### 👀 관전자용
- **응원 단축키**: 다양한 응원 메시지로 분위기 메이커 역할
- **개성적 닉네임**: "응원단장", "전투 해설가" 등으로 재미 더하기
- **실시간 해설**: 채팅으로 전투 상황 분석 및 예측

---

## 🔧 트러블슈팅

### 🚨 일반적인 문제

**연결 실패**
```bash
# 방화벽 확인
sudo ufw allow 3001

# PM2 상태 확인
pm2 status
pm2 restart battle-system
```

**파일 업로드 실패**
```bash
# 권한 설정
chmod 755 uploads/
chown -R $USER:$USER uploads/

# 디스크 용량 확인
df -h
```

**메모리 부족**
```bash
# 메모리 사용량 확인
pm2 monit

# 메모리 제한으로 재시작
pm2 restart battle-system --max-memory-restart 1G
```

**Socket 연결 문제**
```bash
# 포트 사용 확인
lsof -i :3001

# 방화벽 설정
sudo ufw status
sudo ufw allow 3001/tcp
```

### 🐛 디버깅 팁
```bash
# 개발 모드로 디버깅
npm run debug

# 로그 실시간 확인
pm2 logs battle-system --lines 100 --raw

# 상세 에러 로그
NODE_ENV=development npm start
```

---

## 🤝 기여하기

### 🔀 기여 프로세스
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

### 📝 개발 가이드라인
- **한글 우선**: 모든 UI 텍스트 한글화
- **디자인 통일**: Pyxis 테마(네이비+골드) 유지
- **반응형 필수**: 모바일 대응 확인
- **실시간 동기화**: Socket.IO 이벤트 활용
- **코드 품질**: ESLint + Prettier 준수
- **테스트 작성**: 새 기능은 테스트 코드 포함

### 🎨 디자인 시스템
```css
/* 핵심 색상 */
--deep-navy: #00080D;    /* 배경 */
--gold-bright: #DCC7A2;  /* 주요 액센트 */
--navy-light: #001E35;   /* 카드 배경 */
--gold-warm: #D4BA8D;    /* 호버 상태 */

/* 타이포그래피 */
--font-display: 'Cinzel', serif;     /* 제목용 */
--font-body: 'Inter', sans-serif;    /* 본문용 */
--font-mono: 'JetBrains Mono';       /* 코드/숫자용 */
```

---

## 📜 라이센스

이 프로젝트는 **MIT 라이센스** 하에 배포됩니다.

```
MIT License

Copyright (c) 2024 CriminalTalent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 👨‍💻 개발자 정보

**CriminalTalent**
- 📧 이메일: rntjdrud1@gmail.com
- 🐙 GitHub: [@CriminalTalent](https://github.com/CriminalTalent)
- 🌍 프로젝트: [battle-system](https://github.com/CriminalTalent/battle-system)

---

## 🔗 관련 링크

- [Socket.IO 문서](https://socket.io/docs/v4/)
- [Express.js 가이드](https://expressjs.com/ko/)
- [PM2 문서](https://pm2.keymetrics.io/docs/)
- [Node.js 가이드](https://nodejs.org/ko/docs/)
- [CSS Grid 가이드](https://css-tricks.com/snippets/css/complete-guide-grid/)

---

## 🎉 감사의 말

이 프로젝트를 가능하게 해준 모든 오픈소스 프로젝트와 개발자분들께 감사드립니다:

- **Socket.IO 팀** - 실시간 통신의 혁신
- **Express.js 팀** - 견고한 웹 프레임워크
- **Node.js 커뮤니티** - 지속적인 개선과 지원
- **모든 기여자들** - 버그 리포트와 개선 제안

---

<div align="center">

## ✨ **실시간 턴제 전투의 새로운 경험을 만나보세요!** ✨

[![Play Now](https://img.shields.io/badge/🎮_지금_플레이-pyxisbattlesystem.monster-gold?style=for-the-badge&logo=rocket)](https://pyxisbattlesystem.monster)

**[라이브 데모 체험](https://pyxisbattlesystem.monster)** • **[개발 문서](https://github.com/CriminalTalent/battle-system/wiki)** • **[이슈 신고](https://github.com/CriminalTalent/battle-system/issues)**

---

⭐ **이 프로젝트가 마음에 드셨다면 Star를 눌러주세요!** ⭐

</div>
