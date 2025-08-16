Battle System

Team-vs-Team turn-based battle game featuring agility-based initiative, real-time sync via Socket.IO, tactical items, and spectator-friendly UI/UX.

Features

Team modes: 1v1, 2v2, 3v3, 4v4

Agility-based initiative and turn order

Core actions: Attack, Guard, Evade

Hit chance, dodge, damage reduction calculations

Tactical item system with duration-based effects

Real-time battle state and chat via Socket.IO

Optional character images per player

Spectator mode with sensitive info redaction

Tech Stack

Backend: Node.js, Express, Socket.IO

Frontend: React, Tailwind CSS, Framer Motion, Socket.IO Client

Tooling: ESLint, Nodemon

Orchestration: docker-compose (and optional k8s/, nginx/ for deployment)

Repository Structure
battle-system/
├─ backend/                 # Optional server infra or scripts (if used)
├─ database/                # DB migrations/seed (if used)
├─ docs/                    # Additional documentation
├─ k8s/                     # Kubernetes manifests
├─ nginx/                   # Nginx reverse-proxy configs
├─ packages/
│  ├─ battle-api/           # API server (Express + Socket.IO)
│  │  └─ src/
│  │     ├─ services/
│  │     │  └─ BattleEngine.js
│  │     ├─ socket/
│  │     │  └─ battleSocket.js
│  │     └─ server.js
│  └─ battle-web/           # React web client
│     └─ src/
│        ├─ components/
│        ├─ hooks/
│        └─ styles/
├─ scripts/                 # Repo-level scripts
├─ .env.example
├─ docker-compose.yml
├─ package.json
├─ LICENSE
└─ README.md


(위 구조는 현재 레포 README와 루트 디렉토리에서 확인되는 항목을 기준으로 요약했습니다.) 
GitHub

Getting Started
Prerequisites

Node.js 18+

npm 8+

Clone
git clone https://github.com/CriminalTalent/battle-system.git
cd battle-system

Install
# API server
cd packages/battle-api
npm install

# Web client
cd ../battle-web
npm install

Run (Development)
# Terminal 1 - API
cd packages/battle-api
npm run dev

# Terminal 2 - Web
cd packages/battle-web
npm start

URLs

Web: http://localhost:3000

API: http://localhost:3001

Health: http://localhost:3001/api/health
(위 주소는 현재 README에 기재된 값 기준입니다.) 
GitHub

Configuration

Copy .env.example to .env and fill required variables for both battle-api and battle-web as needed. Keep secrets out of version control.

API Overview

GET /api/health: health check
Additional endpoints and detailed payloads should be documented under docs/.

Socket Events (Examples)

Client → Server (examples):

// create a battle
socket.emit('create_battle', {
  mode: '2v2',
  settings: {
    itemsEnabled: true,
    characterImagesEnabled: true,
    turnTimeLimit: 300000,
    maxTurns: 50
  }
});

// join a battle
socket.emit('join_battle', {
  battleId: 'battle_123',
  player: {
    name: 'Player1',
    attack: 60,
    defense: 40,
    agility: 70,
    maxHp: 120,
    // optional: characterImageId: 'warrior'
  },
  teamItems: {
    attack_booster: 2,
    defense_booster: 1,
    health_potion: 3
  }
});

// execute action
socket.emit('execute_action', {
  action: { type: 'attack', targets: ['player_id'] }
});

// use item
socket.emit('execute_action', {
  action: { type: 'use_item', itemId: 'attack_booster' }
});


(샘플 이벤트 유형은 현재 README에 기재된 예시 기반입니다. 상세 스키마는 docs/에서 지속 관리 권장.) 
GitHub

Development Notes

Monorepo: if using npm workspaces, define "workspaces" in root package.json and add convenience scripts such as:

{
  "scripts": {
    "dev:api": "npm --workspace packages/battle-api run dev",
    "dev:web": "npm --workspace packages/battle-web start",
    "dev": "run-p dev:api dev:web"
  }
}


(루트 package.json의 실제 설정 여부는 레포 본문 확인 필요) 
GitHub

Lint/Format: add ESLint/Prettier with a shared config across packages.

Testing: recommend Jest + React Testing Library for battle-web, and Jest for battle-api services (e.g., BattleEngine).

Docs: keep README concise; move extended API/socket docs to docs/ and link.

Docker and Deployment

Local: docker-compose.yml is present at the repo root. Ensure services are named predictably (e.g., api, web, nginx) and that .env is mounted securely in development only. 
GitHub

Kubernetes: manifests under k8s/. Consider templating with Helm or Kustomize.

Nginx: reverse-proxy configs under nginx/. Keep CORS and websocket upgrade headers aligned with Socket.IO.

Security

Never expose team-private item info or internal logs to spectators.

Validate all client actions server-side in battle-api.

Keep secrets in environment variables, not in Git.

Rate-limit socket connections and add basic auth on admin endpoints.

License

See LICENSE at the repo root.
