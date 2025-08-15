/**
 * 전투 시스템 상수 정의
 * 롤 20 기반 턴제 전투 시스템
 */

// ===========================================
// 기본 게임 상수
// ===========================================

export const GAME_CONSTANTS = {
  // 플레이어 설정
  MAX_PLAYERS: 2,
  MAX_SPECTATORS: 50,
  STARTING_HP: 100,
  MAX_HP: 100,
  
  // 스탯 제한 (각 스탯 1-5, 총합 14)
  MIN_STAT: 1,
  MAX_STAT: 5,
  TOTAL_STAT_POINTS: 14, // 공격+방어+민첩+행운 = 14
  
  // 롤 20 시스템
  DICE_SIDES: 20,
  BASE_HIT_THRESHOLD: 10,
  
  // 턴 설정
  TURN_TIMEOUT: 30000, // 30초
  MAX_TURNS: 100,
  
  // 데미지 계산
  CRITICAL_MULTIPLIER: 1.5,
  DEFENSE_REDUCTION: 0.5
};

// ===========================================
// 액션 타입
// ===========================================

export const BATTLE_ACTIONS = {
  ATTACK: 'attack',
  DEFEND: 'defend', 
  SURRENDER: 'surrender'
};

// ===========================================
// 전투 상태
// ===========================================

export const BATTLE_STATUS = {
  WAITING: 'waiting',     // 플레이어 대기
  ACTIVE: 'active',       // 전투 진행중
  PAUSED: 'paused',       // 일시정지
  ENDED: 'ended',         // 전투 종료
  ERROR: 'error'          // 오류
};

export const PLAYER_STATUS = {
  WAITING: 'waiting',
  READY: 'ready', 
  ACTIVE: 'active',
  DEFENDING: 'defending',
  DEAD: 'dead',
  DISCONNECTED: 'disconnected'
};

// ===========================================
// 스탯 정보
// ===========================================

export const STAT_INFO = {
  attack: {
    name: '공격력',
    description: '기본 데미지를 결정합니다 (1-5)',
    color: 'text-red-400',
    icon: '⚔️'
  },
  defense: {
    name: '방어력', 
    description: '받는 데미지를 줄입니다 (1-5)',
    color: 'text-blue-400',
    icon: '🛡️'
  },
  agility: {
    name: '민첩',
    description: '명중률과 회피율을 결정합니다 (1-5)',
    color: 'text-green-400',
    icon: '💨'
  },
  luck: {
    name: '행운',
    description: '크리티컬 히트 확률을 높입니다 (1-5)',
    color: 'text-yellow-400',
    icon: '🍀'
  }
};

// ===========================================
// 추천 빌드 (총 14포인트 분배)
// ===========================================

export const RECOMMENDED_BUILDS = {
  balanced: {
    name: '균형형',
    stats: { attack: 3, defense: 4, agility: 4, luck: 3 },
    description: '모든 능력이 고르게 분배된 안정적인 빌드',
    color: 'bg-blue-600'
  },
  attacker: {
    name: '공격형', 
    stats: { attack: 5, defense: 2, agility: 4, luck: 3 },
    description: '높은 공격력으로 빠르게 적을 제압',
    color: 'bg-red-600'
  },
  tank: {
    name: '방어형',
    stats: { attack: 2, defense: 5, agility: 3, luck: 4 },
    description: '높은 방어력으로 오래 버티는 빌드',
    color: 'bg-blue-800'
  },
  speedster: {
    name: '속도형',
    stats: { attack: 3, defense: 2, agility: 5, luck: 4 },
    description: '높은 민첩으로 회피와 선공을 노림',
    color: 'bg-green-600'
  },
  lucky: {
    name: '행운형',
    stats: { attack: 4, defense: 3, agility: 2, luck: 5 },
    description: '높은 행운으로 크리티컬을 노림',
    color: 'bg-yellow-600'
  }
};

// ===========================================
// 승리 조건
// ===========================================

export const WIN_CONDITIONS = {
  HP_ZERO: 'hp_zero',           // 상대 HP 0
  SURRENDER: 'surrender',       // 항복
  TIMEOUT: 'timeout',           // 시간 초과 (HP 높은 쪽 승리)
  DISCONNECT: 'disconnect',     // 연결 끊김
  FORFEIT: 'forfeit'           // 기권
};

// ===========================================
// UI 상수
// ===========================================

export const UI_CONSTANTS = {
  // 애니메이션 지속시간
  DAMAGE_ANIMATION_DURATION: 2000,
  TURN_TRANSITION_DURATION: 1000,
  CARD_HOVER_DURATION: 200,
  
  // HP 바 색상 임계값
  HP_DANGER_THRESHOLD: 25,
  HP_WARNING_THRESHOLD: 50, 
  HP_GOOD_THRESHOLD: 75,
  
  // 턴 타이머
  TURN_TIME_WARNING: 10000, // 10초
  TURN_TIME_CRITICAL: 5000,  // 5초
  
  // 로그 설정
  MAX_VISIBLE_LOGS: 50,
  AUTO_SCROLL_THRESHOLD: 100,
  
  // 반응형 브레이크포인트
  MOBILE_BREAKPOINT: 768,
  TABLET_BREAKPOINT: 1024
};

// ===========================================
// 소켓 이벤트
// ===========================================

export const SOCKET_EVENTS = {
  // 클라이언트 -> 서버
  JOIN_BATTLE: 'join_battle',
  PLAYER_ACTION: 'player_action',
  GET_BATTLE_STATE: 'get_battle_state',
  
  // 서버 -> 클라이언트  
  BATTLE_JOINED: 'battle_joined',
  BATTLE_UPDATE: 'battle_update',
  ACTION_RESULT: 'action_result',
  ACTION_FAILED: 'action_failed',
  TURN_CHANGED: 'turn_changed',
  BATTLE_ENDED: 'battle_ended',
  PARTICIPANT_DISCONNECTED: 'participant_disconnected',
  ERROR: 'error'
};

// ===========================================
// 메시지
// ===========================================

export const ERROR_MESSAGES = {
  CONNECTION_FAILED: '서버에 연결할 수 없습니다',
  BATTLE_NOT_FOUND: '전투를 찾을 수 없습니다',
  TOKEN_INVALID: '유효하지 않은 토큰입니다',
  TOKEN_EXPIRED: '토큰이 만료되었습니다',
  NOT_YOUR_TURN: '당신의 턴이 아닙니다',
  INVALID_ACTION: '유효하지 않은 액션입니다',
  PLAYER_DISCONNECTED: '플레이어 연결이 끊어졌습니다',
  BATTLE_ENDED: '전투가 종료되었습니다'
};

export const SUCCESS_MESSAGES = {
  CONNECTED: '전투에 연결되었습니다',
  RECONNECTED: '재연결되었습니다',
  ACTION_SUCCESS: '액션이 실행되었습니다',
  BATTLE_CREATED: '전투가 생성되었습니다'
};

// ===========================================
// 키보드 단축키
// ===========================================

export const KEYBOARD_SHORTCUTS = {
  ATTACK: '1',
  DEFEND: '2',
  SURRENDER: '3',
  TOGGLE_LOG: 'Tab',
  ESCAPE: 'Escape'
};

// ===========================================
// 색상 테마
// ===========================================

export const COLORS = {
  primary: '#3b82f6',
  secondary: '#64748b', 
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  
  hp: {
    high: '#10b981',    // 70-100%
    medium: '#f59e0b',  // 30-70%
    low: '#ef4444',     // 0-30%
    critical: '#dc2626' // 0-10%
  },
  
  actions: {
    attack: '#ef4444',
    defend: '#3b82f6',
    surrender: '#64748b'
  },
  
  status: {
    connected: '#10b981',
    disconnected: '#ef4444',
    waiting: '#f59e0b'
  }
};

// ===========================================
// 사운드 효과
// ===========================================

export const SOUND_EFFECTS = {
  attack_hit: '/sounds/sfx/sword_hit.mp3',
  attack_miss: '/sounds/sfx/swoosh.mp3', 
  attack_critical: '/sounds/sfx/critical_hit.mp3',
  defend: '/sounds/sfx/shield_block.mp3',
  turn_start: '/sounds/sfx/bell.mp3',
  battle_start: '/sounds/sfx/battle_start.mp3',
  battle_end: '/sounds/sfx/victory.mp3',
  error: '/sounds/sfx/error.mp3'
};

// ===========================================
// 기본 설정
// ===========================================

export const DEFAULT_SETTINGS = {
  soundEnabled: true,
  animationsEnabled: true,
  showBattleLog: true,
  compactMode: false,
  autoScroll: true,
  showDamageNumbers: true
};

// ===========================================
// 유효성 검사
// ===========================================

export const VALIDATION_RULES = {
  PLAYER_NAME: {
    minLength: 2,
    maxLength: 20,
    required: true,
    pattern: /^[가-힣a-zA-Z0-9_\s]{2,20}$/
  },
  STATS: {
    min: GAME_CONSTANTS.MIN_STAT,
    max: GAME_CONSTANTS.MAX_STAT,
    total: GAME_CONSTANTS.TOTAL_STAT_POINTS
  }
};

// ===========================================
// API 엔드포인트
// ===========================================

export const API_ENDPOINTS = {
  HEALTH: '/health',
  BATTLES: '/api/battles',
  BATTLE_BY_ID: (id) => `/api/battles/${id}`,
  ADMIN_BATTLES: '/api/admin/battles',
  AUTH_VERIFY: '/api/auth/verify'
};
