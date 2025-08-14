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
  MAX_SPECTATORS: 10,
  STARTING_HP: 100,
  MAX_HP: 100,
  
  // 턴 설정
  TURN_TIMEOUT: 30, // 초
  MAX_TURNS: 100,   // 무한 루프 방지
  
  // 데미지 설정
  MIN_DAMAGE: 10,
  MAX_DAMAGE: 20,
  CRITICAL_CHANCE: 0.1,
  CRITICAL_MULTIPLIER: 2.0,
  
  // 방어 설정
  DEFENSE_REDUCTION: 0.5, // 50% 데미지 감소
  DEFENSE_COUNTERATTACK_CHANCE: 0.3, // 30% 반격 기회
  
  // 상태 설정
  STATUS_EFFECT_MAX_DURATION: 5,
  POISON_DAMAGE_PER_TURN: 5,
  BURN_DAMAGE_PER_TURN: 3,
  
  // 배틀 설정
  BATTLE_TIMEOUT: 3600, // 1시간 (초)
  CLEANUP_INTERVAL: 300, // 5분 (초)
};

// ===========================================
// 액션 타입 정의
// ===========================================

const ACTION_TYPES = {
  ATTACK: 'attack',
  DEFEND: 'defend',
  SKILL: 'skill',
  ITEM: 'item',
  SURRENDER: 'surrender'
};

const VALID_ACTIONS = Object.values(ACTION_TYPES);

// ===========================================
// 전투 상태 정의
// ===========================================

const BATTLE_STATES = {
  WAITING: 'waiting',     // 플레이어 대기 중
  ACTIVE: 'active',       // 전투 진행 중
  PAUSED: 'paused',       // 일시 정지
  FINISHED: 'finished',   // 전투 종료
  TIMEOUT: 'timeout',     // 시간 초과
  ERROR: 'error'          // 오류 발생
};

const PLAYER_STATES = {
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
  POISON: {
    name: 'poison',
    icon: '☠️',
    description: '매 턴 독 데미지를 받습니다',
    damagePerTurn: 5,
    duration: 3,
    stackable: false
  },
  BURN: {
    name: 'burn',
    icon: '🔥',
    description: '매 턴 화상 데미지를 받습니다',
    damagePerTurn: 3,
    duration: 4,
    stackable: false
  },
  REGENERATION: {
    name: 'regeneration',
    icon: '💚',
    description: '매 턴 HP가 회복됩니다',
    healPerTurn: 8,
    duration: 3,
    stackable: false
  },
  SHIELD: {
    name: 'shield',
    icon: '🛡️',
    description: '다음 공격을 완전히 막습니다',
    blockNextAttack: true,
    duration: 1,
    stackable: false
  },
  STUN: {
    name: 'stun',
    icon: '💫',
    description: '행동할 수 없습니다',
    preventAction: true,
    duration: 1,
    stackable: false
  },
  RAGE: {
    name: 'rage',
    icon: '😡',
    description: '공격력이 증가합니다',
    damageMultiplier: 1.5,
    duration: 3,
    stackable: false
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
// 유효성 검사 함수들
// ===========================================

/**
 * 액션이 유효한지 검사
 */
function isValidAction(action) {
  return VALID_ACTIONS.includes(action);
}

/**
 * 플레이어가 액션을 수행할 수 있는지 검사
 */
function canPlayerAct(player, battleState) {
  // 전투가 활성 상태인가?
  if (battleState !== BATTLE_STATES.ACTIVE) {
    return { valid: false, reason: 'Battle is not active' };
  }
  
  // 플레이어가 살아있는가?
  if (player.hp <= 0) {
    return { valid: false, reason: 'Player is dead' };
  }
  
  // 플레이어가 기절 상태인가?
  if (player.statusEffects?.some(effect => effect.name === 'stun')) {
    return { valid: false, reason: 'Player is stunned' };
  }
  
  // 플레이어가 연결되어 있는가?
  if (player.state === PLAYER_STATES.DISCONNECTED) {
    return { valid: false, reason: 'Player is disconnected' };
  }
  
  return { valid: true };
}

/**
 * 전투 시작 조건 검사
 */
function canStartBattle(players) {
  // 충분한 플레이어가 있는가?
  if (players.length < 2) {
    return { valid: false, reason: 'Not enough players' };
  }
  
  // 모든 플레이어가 준비되었는가?
  if (!players.every(p => p.state === PLAYER_STATES.READY)) {
    return { valid: false, reason: 'Not all players are ready' };
  }
  
  // 모든 플레이어가 연결되어 있는가?
  if (!players.every(p => p.connected)) {
    return { valid: false, reason: 'Some players are disconnected' };
  }
  
  return { valid: true };
}

// ===========================================
// 게임 규칙 함수들
// ===========================================

/**
 * 턴 순서 결정 (스피드 기반, 미래 확장용)
 */
function determineTurnOrder(players) {
  return players
    .map((player, index) => ({ ...player, originalIndex: index }))
    .sort((a, b) => {
      // 스피드가 같으면 랜덤
      if (a.speed === b.speed) {
        return Math.random() - 0.5;
      }
      return b.speed - a.speed; // 높은 스피드가 먼저
    });
}

/**
 * 다음 턴 플레이어 결정
 */
function getNextPlayer(currentPlayerIndex, players) {
  const alivePlayers = players.filter(p => p.hp > 0);
  if (alivePlayers.length <= 1) return null;
  
  let nextIndex = (currentPlayerIndex + 1) % players.length;
  
  // 죽은 플레이어는 건너뛰기
  while (players[nextIndex].hp <= 0) {
    nextIndex = (nextIndex + 1) % players.length;
  }
  
  return nextIndex;
}

/**
 * 전투 종료 조건 검사
 */
function checkBattleEndCondition(players, turnCount) {
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
 * 데미지 타입별 계산
 */
function calculateDamageByType(baseDamage, damageType = 'physical', target) {
  let finalDamage = baseDamage;
  
  switch (damageType) {
    case 'physical':
      // 물리 데미지는 방어력 적용
      finalDamage = Math.max(1, baseDamage - (target.defense || 0));
      break;
      
    case 'magical':
      // 마법 데미지는 마법 저항 적용
      finalDamage = Math.max(1, baseDamage - (target.magicResist || 0));
      break;
      
    case 'true':
      // 고정 데미지는 감소 없음
      finalDamage = baseDamage;
      break;
      
    default:
      finalDamage = baseDamage;
  }
  
  return Math.floor(finalDamage);
}

/**
 * 레벨업 경험치 계산 (미래 확장용)
 */
function getExpRequiredForLevel(level) {
  return Math.floor(100 * Math.pow(1.2, level - 1));
}

/**
 * 크리티컬 히트 메시지 생성
 */
function getCriticalHitMessage(attackerName, targetName, damage) {
  const messages = [
    `${attackerName}의 치명타! ${targetName}에게 ${damage} 데미지!`,
    `${attackerName}의 완벽한 공격! ${damage} 크리티컬 데미지!`,
    `${attackerName}이(가) 급소를 노렸다! ${damage} 데미지!`,
    `${attackerName}의 강력한 일격! ${targetName}이(가) ${damage} 데미지를 받았다!`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * 방어 성공 메시지 생성
 */
function getDefenseMessage(defenderName, reducedDamage) {
  const messages = [
    `${defenderName}이(가) 공격을 막아냈다! ${reducedDamage} 데미지 감소!`,
    `${defenderName}의 완벽한 방어! ${reducedDamage} 데미지 차단!`,
    `${defenderName}이(가) 몸을 웅크렸다! ${reducedDamage} 데미지 경감!`,
    `${defenderName}의 수비 자세! ${reducedDamage} 데미지 흡수!`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

module.exports = {
  // 상수들
  GAME_CONSTANTS,
  ACTION_TYPES,
  BATTLE_STATES,
  PLAYER_STATES,
  STATUS_EFFECTS,
  WIN_CONDITIONS,
  
  // 유효성 검사 함수들
  isValidAction,
  canPlayerAct,
  canStartBattle,
  
  // 게임 규칙 함수들
  determineTurnOrder,
  getNextPlayer,
  checkBattleEndCondition,
  calculateDamageByType,
  getExpRequiredForLevel,
  getCriticalHitMessage,
  getDefenseMessage
};