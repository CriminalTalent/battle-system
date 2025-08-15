// 스탯 정보 정의
export const STAT_INFO = {
  attack: {
    name: '공격력',
    description: '기본 데미지를 결정합니다 (1-5)',
    color: 'text-red-400'
  },
  defense: {
    name: '방어력', 
    description: '받는 데미지를 줄입니다 (1-5)',
    color: 'text-blue-400'
  },
  agility: {
    name: '민첩',
    description: '명중률과 회피율을 결정합니다 (1-5)',
    color: 'text-green-400'
  },
  luck: {
    name: '행운',
    description: '크리티컬 히트 확률을 높입니다 (1-5)',
    color: 'text-yellow-400'
  }
};

// 게임 기본 설정
export const GAME_CONFIG = {
  STARTING_HP: 100,           // 시작 체력
  MIN_STAT: 1,               // 최소 스탯 값
  MAX_STAT: 5,               // 최대 스탯 값
  STAT_POINTS: 12,           // 총 스탯 포인트 (평균 3씩 배분)
  DICE_SIDES: 20,            // 주사위 면의 수 (d20)
  BASE_AC: 10,               // 기본 방어도 (AC = 10 + 민첩)
  BASE_DAMAGE_DICE: 6,       // 기본 데미지 주사위 (1d6)
  MIN_DAMAGE: 1,             // 최소 데미지
  CRITICAL_MULTIPLIER: 2     // 크리티컬 데미지 배수
};

// 전투 메시지
export const BATTLE_MESSAGES = {
  MISS: '공격이 빗나갔습니다!',
  DODGE: '공격을 회피했습니다!',
  CRITICAL: '치명타!',
  NORMAL_HIT: '공격이 적중했습니다!',
  BATTLE_START: '전투가 시작됩니다!',
  VICTORY: '승리했습니다!',
  DEFEAT: '패배했습니다!',
  TURN_START: '의 턴입니다.',
  DAMAGE_DEALT: '에게',
  DAMAGE_RECEIVED: '데미지를 입혔습니다!'
};

// 난이도 설정
export const DIFFICULTY_SETTINGS = {
  easy: { 
    statBonus: -1, 
    name: '초보 전사',
    description: '쉬운 상대입니다.'
  },
  normal: { 
    statBonus: 0, 
    name: '전사',
    description: '보통 수준의 상대입니다.'
  },
  hard: { 
    statBonus: 1, 
    name: '정예 전사',
    description: '강한 상대입니다.'
  },
  boss: { 
    statBonus: 2, 
    name: '보스 전사',
    description: '매우 강한 상대입니다.'
  }
};

// 색상 테마
export const COLORS = {
  HP_COLORS: {
    HIGH: 'bg-green-500',      // 60% 이상
    MEDIUM: 'bg-yellow-500',   // 30-60%
    LOW: 'bg-orange-500',      // 10-30%
    CRITICAL: 'bg-red-500'     // 10% 미만
  },
  STAT_COLORS: {
    attack: 'text-red-400',
    defense: 'text-blue-400',
    agility: 'text-green-400',
    luck: 'text-yellow-400'
  }
};

// 경험치 계산 설정
export const EXP_CONFIG = {
  BASE_EXP: 100,             // 기본 경험치
  DIFFICULTY_BONUS: 25,      // 난이도당 추가 경험치
  MIN_EXP: 50,               // 최소 경험치
  VICTORY_BONUS: 1.5         // 승리 보너스 배수
};
