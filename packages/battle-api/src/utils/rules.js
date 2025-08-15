/**
 * Game Rules and Constants
 * 게임 규칙과 상수 정의
 */

// ===========================================
// 기본 게임 상수
// ===========================================

const GAME_CONSTANTS = {
  // 플레이어 설정
  MAX_PLAYERS: 2,
  MAX_SPECTATORS: 50,
  STARTING_HP: 100,
  MAX_HP: 100,
  
  // 스탯 제한
  MIN_STAT: 1,
  MAX_STAT: 5,
  TOTAL_STAT_POINTS: 14, // 기본 4 + 추가 10
  
  // 턴 설정
  TURN_TIMEOUT: 30000, // 30초 (밀리초)
  MAX_TURNS: 100,      // 무한 루프 방지
  
  // 주사위 설정
  DICE_SIDES: 20,
  
  // 전투 계산 상수
  BASE_HIT_THRESHOLD: 10,
  BASE_CRITICAL_THRESHOLD: 20,
  CRITICAL_MULTIPLIER: 1.5,
  DEFENSE_ACTION_MULTIPLIER: 1.5,
  
  // 배틀 설정
  BATTLE_TIMEOUT: 3600000, // 1시간 (밀리초)
  CLEANUP_INTERVAL: 300000, // 5분 (밀리초)
};

// ===========================================
// 액션 타입 정의
// ===========================================

const BATTLE_ACTIONS = {
  ATTACK: 'attack',
  DEFEND: 'defend',
  SURRENDER: 'surrender'
};

const VALID_ACTIONS = Object.values(BATTLE_ACTIONS);

// ===========================================
// 전투 상태 정의
// ===========================================

const BATTLE_STATUS = {
  WAITING: 'waiting',     // 플레이어 대기 중
  ACTIVE: 'active',       // 전투 진행 중
  PAUSED: 'paused',       // 일시 정지
  ENDED: 'ended',         // 전투 종료
  ERROR: 'error'          // 오류 발생
};

const PLAYER_STATUS = {
  WAITING: 'waiting',     // 대기 중
  READY: 'ready',         // 준비 완료
  ACTIVE: 'active',       // 턴 진행 중
  DEFENDING: 'defending', // 방어 중
  DEAD: 'dead',          // 사망
  DISCONNECTED: 'disconnected' // 연결 끊김
};

// ===========================================
// 상태 효과 정의
// ===========================================

const STATUS_EFFECTS = {
  DEFEND: {
    type: 'defend',
    name: '방어 태세',
    description: '방어력이 증가합니다',
    icon: 'shield',
    color: 'blue',
    isPositive: true
  },
  STUNNED: {
    type: 'stunned',
    name: '기절',
    description: '행동할 수 없습니다',
    icon: 'dizzy',
    color: 'purple',
    isPositive: false
  }
};

// ===========================================
// 승리 조건 정의
// ===========================================

const WIN_CONDITIONS = {
  HP_ZERO: 'hp_zero',           // 상대 HP 0
  SURRENDER: 'surrender',       // 상대 항복
  TIMEOUT: 'timeout',           // 시간 초과 (HP 높은 쪽 승리)
  DISCONNECT: 'disconnect',     // 상대 연결 끊김
  FORFEIT: 'forfeit'           // 기권
};

// ===========================================
// 룰셋 정의
// ===========================================

const RULESETS = {
  standard: {
    name: 'Standard',
    description: '기본 전투 룰셋',
    baseStats: {
      maxHp: 100,
      attack: 3,
      defense: 3,
      agility: 3,
      luck: 2
    },
    turnTimeLimit: 30000,
    maxTurns: 100,
    allowSurrender: true
  },
  
  quick: {
    name: 'Quick Battle',
    description: '빠른 전투 (시간 제한 짧음)',
    baseStats: {
      maxHp: 100,
      attack: 4,
      defense: 2,
      agility: 4,
      luck: 3
    },
    turnTimeLimit: 15000,
    maxTurns: 50,
    allowSurrender: true
  },
  
  hardcore: {
    name: 'Hardcore',
    description: '하드코어 모드 (높은 데미지)',
    baseStats: {
      maxHp: 100,
      attack: 5,
      defense: 1,
      agility: 3,
      luck: 4
    },
    turnTimeLimit: 45000,
    maxTurns: 150,
    allowSurrender: false
  }
};

// ===========================================
// 유효성 검사 함수들
// ===========================================

/**
 * 액션이 유효한지 검사
 */
function isValidAction(action) {
  return VALID_ACTIONS.includes(action);
}

/**
 * 스탯이 유효한지 검사
 */
function isValidStats(stats) {
  const requiredStats = ['attack', 'defense', 'agility', 'luck'];
  
  for (const stat of requiredStats) {
    if (!stats[stat] || 
        stats[stat] < GAME_CONSTANTS.MIN_STAT || 
        stats[stat] > GAME_CONSTANTS.MAX_STAT) {
      return false;
    }
  }
  
  // 총 스탯 포인트 확인
  const totalStats = requiredStats.reduce((sum, stat) => sum + stats[stat], 0);
  if (totalStats !== GAME_CONSTANTS.TOTAL_STAT_POINTS) {
    return false;
  }
  
  return true;
}

/**
 * 플레이어가 액션을 수행할 수 있는지 검사
 */
function canPlayerAct(player, battleState) {
  // 전투가 활성 상태인가?
  if (battleState !== BATTLE_STATUS.ACTIVE) {
    return { valid: false, reason: 'Battle is not active' };
  }
  
  // 플레이어가 살아있는가?
  if (player.hp <= 0) {
    return { valid: false, reason: 'Player is dead' };
  }
  
  // 플레이어가 기절 상태인가?
  if (player.statusEffects?.some(effect => effect.type === 'stunned')) {
    return { valid: false, reason: 'Player is stunned' };
  }
  
  // 플레이어가 연결되어 있는가?
  if (!player.connected) {
    return { valid: false, reason: 'Player is disconnected' };
  }
  
  return { valid: true };
}

/**
 * 전투 시작 조건 검사
 */
function canStartBattle(participants) {
  const players = Object.values(participants);
  
  // 충분한 플레이어가 있는가?
  if (players.length < 2) {
    return { valid: false, reason: 'Not enough players' };
  }
  
  // 모든 플레이어가 연결되어 있는가?
  if (!players.every(p => p.connected)) {
    return { valid: false, reason: 'Some players are disconnected' };
  }
  
  // 모든 플레이어의 스탯이 유효한가?
  if (!players.every(p => isValidStats(p.stats))) {
    return { valid: false, reason: 'Invalid player stats' };
  }
  
  return { valid: true };
}

// ===========================================
// 게임 규칙 함수들
// ===========================================

/**
 * 턴 순서 결정 (민첩 기반)
 */
function determineTurnOrder(participants) {
  const players = Object.entries(participants);
  const [keyA, playerA] = players[0];
  const [keyB, playerB] = players[1];
  
  // 민첩 비교
  if (playerA.stats.agility > playerB.stats.agility) {
    return keyA;
  } else if (playerB.stats.agility > playerA.stats.agility) {
    return keyB;
  } else {
    // 민첩이 같으면 행운으로 결정
    if (playerA.stats.luck > playerB.stats.luck) {
      return keyA;
    } else if (playerB.stats.luck > playerA.stats.luck) {
      return keyB;
    } else {
      // 모든 것이 같으면 랜덤
      return Math.random() < 0.5 ? keyA : keyB;
    }
  }
}

/**
 * 전투 종료 조건 검사
 */
function checkBattleEndCondition(participants, turnCount) {
  const players = Object.values(participants);
  const alivePlayers = players.filter(p => p.hp > 0);
  
  // 한 명만 살아있으면 승리
  if (alivePlayers.length === 1) {
    return {
      ended: true,
      winner: alivePlayers[0],
      condition: WIN_CONDITIONS.HP_ZERO
    };
  }
  
  // 모두 죽었으면 무승부
  if (alivePlayers.length === 0) {
    return {
      ended: true,
      winner: null,
      condition: WIN_CONDITIONS.HP_ZERO
    };
  }
  
  // 최대 턴 수 초과시 HP 높은 쪽 승리
  if (turnCount >= GAME_CONSTANTS.MAX_TURNS) {
    const winner = alivePlayers.reduce((prev, current) => 
      (prev.hp > current.hp) ? prev : current
    );
    
    return {
      ended: true,
      winner,
      condition: WIN_CONDITIONS.TIMEOUT
    };
  }
  
  return { ended: false };
}

/**
 * 스탯 요약 정보 생성
 */
function getStatsInfo(stats) {
  return {
    attack: stats.attack,
    defense: stats.defense,
    agility: stats.agility,
    luck: stats.luck,
    total: stats.attack + stats.defense + stats.agility + stats.luck,
    
    // 계산된 값들
    hitBonus: stats.agility - 3, // 민첩 3 기준으로 명중률 보너스
    criticalRange: stats.luck,   // 크리티컬 범위
    damageBonus: stats.attack - 3, // 공격력 3 기준으로 데미지 보너스
    defenseReduction: stats.defense // 방어력만큼 데미지 감소
  };
}

/**
 * 전투 메시지 생성
 */
function generateBattleMessage(type, data) {
  switch (type) {
    case 'attack_hit':
      return data.critical 
        ? `${data.attacker}의 크리티컬 히트! ${data.defender}에게 ${data.damage} 데미지!`
        : `${data.attacker}이(가) ${data.defender}에게 ${data.damage} 데미지를 입혔습니다!`;
        
    case 'attack_miss':
      return `${data.attacker}의 공격이 빗나갔습니다!`;
      
    case 'attack_dodge':
      return `${data.defender}이(가) ${data.attacker}의 공격을 회피했습니다!`;
      
    case 'defend':
      return `${data.defender}이(가) 방어 태세를 취했습니다!`;
      
    case 'surrender':
      return `${data.player}이(가) 항복했습니다!`;
      
    case 'battle_start':
      return `전투가 시작되었습니다! ${data.first}이(가) 선공입니다!`;
      
    case 'battle_end':
      return data.winner 
        ? `${data.winner}이(가) 승리했습니다!`
        : '무승부입니다!';
        
    case 'turn_timeout':
      return `${data.player}의 시간이 초과되어 자동으로 방어합니다.`;
      
    default:
      return '알 수 없는 이벤트가 발생했습니다.';
  }
}

/**
 * 기본 스탯 배치 추천
 */
function getRecommendedBuilds() {
  return {
    balanced: {
      name: '균형형',
      stats: { attack: 3, defense: 4, agility: 4, luck: 3 },
      description: '모든 능력이 고르게 분배된 안정적인 빌드'
    },
    
    attacker: {
      name: '공격형',
      stats: { attack: 5, defense: 2, agility: 4, luck: 3 },
      description: '높은 공격력으로 빠르게 적을 제압하는 빌드'
    },
    
    tank: {
      name: '방어형',
      stats: { attack: 2, defense: 5, agility: 3, luck: 4 },
      description: '높은 방어력으로 오래 버티는 빌드'
    },
    
    speedster: {
      name: '속도형',
      stats: { attack: 3, defense: 2, agility: 5, luck: 4 },
      description: '높은 민첩으로 회피와 선공을 노리는 빌드'
    },
    
    lucky: {
      name: '행운형',
      stats: { attack: 4, defense: 3, agility: 2, luck: 5 },
      description: '높은 행운으로 크리티컬을 노리는 빌드'
    }
  };
}

module.exports = {
  // 상수들
  GAME_CONSTANTS,
  BATTLE_ACTIONS,
  BATTLE_STATUS,
  PLAYER_STATUS,
  STATUS_EFFECTS,
  WIN_CONDITIONS,
  RULESETS,
  
  // 유효성 검사 함수들
  isValidAction,
  isValidStats,
  canPlayerAct,
  canStartBattle,
  
  // 게임 규칙 함수들
  determineTurnOrder,
  checkBattleEndCondition,
  getStatsInfo,
  generateBattleMessage,
  getRecommendedBuilds
};
