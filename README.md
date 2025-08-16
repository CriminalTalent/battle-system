# Battle System

Team-vs-Team turn-based battle game featuring agility-based initiative, real-time sync via Socket.IO, tactical items, and spectator-friendly UI/UX.

## Features
- Team modes: 1v1, 2v2, 3v3, 4v4
- Agility-based initiative and turn order
- Core actions: Attack, Guard, Evade
- Hit chance, dodge, damage reduction calculations
- Tactical item system with duration-based effects
- Real-time battle state and chat via Socket.IO
- Optional character images per player
- Spectator mode with sensitive info redaction

## Tech Stack
- Backend: Node.js, Express, Socket.IO
- Frontend: React, Tailwind CSS, Framer Motion, Socket.IO Client
- Tooling: ESLint, Nodemon
- Orchestration: docker-compose (and optional `k8s/`, `nginx/` for deployment)

## Repository Structure
```
battle-system/
├─ backend/
├─ database/
├─ docs/
├─ k8s/
├─ nginx/
├─ packages/
│  ├─ battle-api/
│  │  └─ src/
│  │     ├─ services/
│  │     │  └─ BattleEngine.js
│  │     ├─ socket/
│  │     │  └─ battleSocket.js
│  │     └─ server.js
│  └─ battle-web/
│     └─ src/
│        ├─ components/
│        ├─ hooks/
│        └─ styles/
├─ scripts/
├─ .env.example
├─ docker-compose.yml
├─ package.json
├─ LICENSE
└─ README.md
```

> The tree above summarizes the directories currently visible in the repository and the structure described by the project documentation.

## Getting Started

### Prerequisites
- Node.js 18+
- npm 8+

### Clone
```bash
git clone https://github.com/CriminalTalent/battle-system.git
cd battle-system
```

### Install
```bash
# API server
cd packages/battle-api
npm install

# Web client
cd ../battle-web
npm install
```

### Run (Development)
```bash
# Terminal 1 - API
cd packages/battle-api
npm run dev

# Terminal 2 - Web
cd packages/battle-web
npm start
```

### URLs
- Web: http://localhost:3000
- API: http://localhost:3001
- Health: http://localhost:3001/api/health

## Configuration
Copy `.env.example` to `.env` and fill the required variables for both `packages/battle-api` and `packages/battle-web` as needed. Do not commit secrets.

## API Overview
- `GET /api/health`: health check

Detailed REST and socket payloads should be maintained under `docs/`.

## Socket Events (Examples)

Client to Server:
```js
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
    maxHp: 120
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
```

## Development Notes

### Monorepo Workspaces
If you use npm workspaces, define them in the root `package.json` and add convenience scripts:

```jsonc
{
  "private": true,
  "workspaces": [
    "packages/battle-api",
    "packages/battle-web"
  ],
  "scripts": {
    "dev:api": "npm --workspace packages/battle-api run dev",
    "dev:web": "npm --workspace packages/battle-web start",
    "dev": "npm run dev:api & npm run dev:web",
    "build": "npm --workspace packages/battle-api run build && npm --workspace packages/battle-web run build",
    "lint": "npm --workspace packages/battle-api run lint && npm --workspace packages/battle-web run lint",
    "test": "npm --workspace packages/battle-api test && npm --workspace packages/battle-web test"
  }
}
```

### Lint and Test
- Add ESLint/Prettier and a shared config across packages.
- For `battle-web`: Jest + React Testing Library.
- For `battle-api`: Jest unit tests for `BattleEngine` and socket handlers.

## Docker and Deployment
- Local development uses `docker-compose.yml` at the repository root.
- Rename any ambiguous root file named `Docker` to `Dockerfile` or move Dockerfiles into a `docker/` directory per service. Example:
  - `packages/battle-api/Dockerfile`
  - `packages/battle-web/Dockerfile`
- Ensure Nginx websocket upgrade headers are configured for Socket.IO.

## Security
- Do not expose team-private item information or internal logs to spectators.
- Validate all client actions on the server.
- Store secrets in environment variables, not in Git.
- Rate-limit socket connections and add guardrails on admin operations.

## License
See `LICENSE` in the repository root.
