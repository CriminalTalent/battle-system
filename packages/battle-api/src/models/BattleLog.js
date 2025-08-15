// packages/battle-api/src/models/BattleLog.js
const mongoose = require('mongoose');

const battleLogSchema = new mongoose.Schema({
  // 연결된 전투
  battleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Battle',
    required: true,
    index: true
  },
  
  roomId: {
    type: String,
    required: true,
    index: true
  },

  // 로그 기본 정보
  turn: {
    type: Number,
    required: true,
    min: 1
  },
  
  sequence: {
    type: Number,
    required: true,
    min: 1
  },

  // 로그 타입별 분류
  type: {
    type: String,
    enum: [
      // 전투 관련
      'battle_start',
      'battle_end', 
      'turn_start',
      'turn_end',
      'turn_timeout',
      
      // 행동 관련
      'action_attack',
      'action_skill',
      'action_defend',
      'action_pass',
      
      // 결과 관련
      'damage_dealt',
      'damage_blocked',
      'heal_applied',
      'critical_hit',
      'miss',
      
      // 상태 이상
      'status_applied',
      'status_removed',
      'status_effect_damage',
      
      // 대사 관련 (새로 추가)
      'dialogue',
      'dialogue_preset_used',
      
      // 시스템
      'player_join',
      'player_disconnect',
      'spectator_join',
      'spectator_leave',
      'system_message',
      'error'
    ],
    required: true
  },

  // 주체와 대상
  actor: {
    type: {
      type: String,
      enum: ['player1', 'player2', 'system', 'spectator']
    },
    characterName: String,
    playerId: String
  },
  
  target: {
    type: {
      type: String,
      enum: ['player1', 'player2', 'both', 'none']
    },
    characterName: String,
    playerId: String
  },

  // 행동 세부사항
  action: {
    // 기본 행동 정보
    name: String, // 스킬명, 행동명 등
    description: String,
    
    // 수치 정보
    damage: {
      base: Number,
      actual: Number,
      blocked: Number,
      type: {
        type: String,
        enum: ['physical', 'magical', 'true', 'heal']
      }
    },
    
    heal: {
      base: Number,
      actual: Number,
      overflow: Number
    },
    
    // 상태 이상
    statusEffects: [{
      type: {
        type: String,
        enum: ['poison', 'burn', 'freeze', 'stun', 'buff_attack', 'buff_defense', 'debuff_attack', 'debuff_defense']
      },
      value: Number,
      duration: Number,
      applied: Boolean
    }],
    
    // 대사 관련 (새로 추가)
    dialogue: {
      message: {
        type: String,
        maxLength: 140
      },
      category: {
        type: String,
        enum: ['attack', 'defend', 'skill', 'hurt', 'victory', 'defeat', 'taunt', 'general']
      },
      isPreset: {
        type: Boolean,
        default: false
      },
      presetIndex: Number,
      characterLength: Number
    },
    
    // 기타 플래그
    isCritical: {
      type: Boolean,
      default: false
    },
    
    isMiss: {
      type: Boolean,
      default: false
    },
    
    isBlocked: {
      type: Boolean,
      default: false
    }
  },

  // 결과 정보
  result: {
    success: {
      type: Boolean,
      default: true
    },
    
    // HP 변화
    hpChanges: {
      actor: {
        before: Number,
        after: Number,
        change: Number
      },
      target: {
        before: Number,
        after: Number,
        change: Number
      }
    },
    
    // 상태 변화
    statusChanges: [{
      target: String,
      type: String,
      action: {
        type: String,
        enum: ['added', 'removed', 'updated', 'triggered']
      },
      value: Number,
      duration: Number
    }],
    
    // 특수 결과
    specialResults: [{
      type: {
        type: String,
        enum: ['knockout', 'revival', 'immunity', 'reflection', 'absorption']
      },
      description: String,
      value: Number
    }]
  },

  // 메시지 정보 (클라이언트 표시용)
  message: {
    // 기본 메시지
    text: {
      type: String,
      required: true,
      maxLength: 500
    },
    
    // 메시지 타입별 스타일링
    style: {
      type: String,
      enum: ['normal', 'damage', 'heal', 'critical', 'miss', 'status', 'dialogue', 'system', 'error'],
      default: 'normal'
    },
    
    // 추가 표시 정보
    icon: String,
    color: String,
    animation: String,
    
    // 다국어 지원
    localized: {
      ko: String,
      en: String,
      ja: String
    }
  },

  // 메타데이터
  metadata: {
    // 성능 측정
    processingTime: Number, // 밀리초
    
    // 클라이언트 동기화
    clientSync: {
      broadcast: {
        type: Boolean,
        default: true
      },
      targets: [{
        type: String,
        enum: ['players', 'spectators', 'all']
      }],
      priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'critical'],
        default: 'normal'
      }
    },
    
    // 디버깅 정보
    debug: {
      calculations: mongoose.Schema.Types.Mixed,
      randomValues: [Number],
      conditions: mongoose.Schema.Types.Mixed
    }
  },

  // 타임스탬프
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false, // timestamp 필드를 직접 관리
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 복합 인덱스
battleLogSchema.index({ battleId: 1, turn: 1, sequence: 1 });
battleLogSchema.index({ roomId: 1, timestamp: -1 });
battleLogSchema.index({ type: 1, timestamp: -1 });
battleLogSchema.index({ 'actor.playerId': 1 });

// 가상 필드: 로그 고유 ID
battleLogSchema.virtual('logId').get(function() {
  return `${this.battleId}_${this.turn}_${this.sequence}`;
});

// 가상 필드: 표시용 시간
battleLogSchema.virtual('displayTime').get(function() {
  return this.timestamp.toLocaleTimeString();
});

// 가상 필드: 대사 로그인지 확인
battleLogSchema.virtual('isDialogue').get(function() {
  return this.type === 'dialogue' || this.type === 'dialogue_preset_used';
});

// 스태틱 메서드: 전투의 모든 로그 가져오기
battleLogSchema.statics.getBattleLogs = function(battleId, options = {}) {
  const query = { battleId };
  
  // 타입 필터
  if (options.types && Array.isArray(options.types)) {
    query.type = { $in: options.types };
  }
  
  // 턴 범위 필터
  if (options.fromTurn) {
    query.turn = { $gte: options.fromTurn };
  }
  if (options.toTurn) {
    query.turn = { ...query.turn, $lte: options.toTurn };
  }
  
  // 정렬 및 제한
  const sort = options.sort || { turn: 1, sequence: 1 };
  const limit = options.limit || 1000;
  
  return this.find(query)
    .sort(sort)
    .limit(limit)
    .populate('battleId', 'roomId title characters');
};

// 스태틱 메서드: 대사 로그만 가져오기
battleLogSchema.statics.getDialogueLogs = function(battleId, options = {}) {
  return this.getBattleLogs(battleId, {
    ...options,
    types: ['dialogue', 'dialogue_preset_used']
  });
};

// 스태틱 메서드: 최근 로그 가져오기
battleLogSchema.statics.getRecentLogs = function(battleId, count = 10) {
  return this.find({ battleId })
    .sort({ turn: -1, sequence: -1 })
    .limit(count)
    .populate('battleId', 'roomId title');
};

// 인스턴스 메서드: 대사 로그 생성
battleLogSchema.statics.createDialogueLog = function(battleId, roomId, turn, sequence, actor, dialogue) {
  const message = dialogue.isPreset 
    ? `${actor.characterName}: "${dialogue.message}" (프리셋)`
    : `${actor.characterName}: "${dialogue.message}"`;

  return this.create({
    battleId,
    roomId,
    turn,
    sequence,
    type: dialogue.isPreset ? 'dialogue_preset_used' : 'dialogue',
    actor: {
      type: actor.type,
      characterName: actor.characterName,
      playerId: actor.playerId
    },
    action: {
      dialogue: {
        message: dialogue.message,
        category: dialogue.category,
        isPreset: dialogue.isPreset,
        presetIndex: dialogue.presetIndex,
        characterLength: dialogue.message.length
      }
    },
    message: {
      text: message,
      style: 'dialogue',
      icon: '💭',
      color: dialogue.isPreset ? '#22d3ee' : '#60a5fa'
    },
    result: {
      success: true
    },
    metadata: {
      clientSync: {
        broadcast: true,
        targets: ['all'],
        priority: 'normal'
      }
    }
  });
};

// 인스턴스 메서드: 액션 로그 생성
battleLogSchema.statics.createActionLog = function(battleId, roomId, turn, sequence, actor, target, action, result) {
  let messageText = '';
  let messageStyle = 'normal';
  let icon = '';
  
  switch (action.type) {
    case 'attack':
      messageText = `${actor.characterName}이(가) ${target.characterName}을(를) 공격했습니다!`;
      messageStyle = 'damage';
      icon = '⚔️';
      break;
    case 'skill':
      messageText = `${actor.characterName}이(가) ${action.name} 스킬을 사용했습니다!`;
      messageStyle = 'normal';
      icon = '✨';
      break;
    case 'defend':
      messageText = `${actor.characterName}이(가) 방어 자세를 취했습니다.`;
      messageStyle = 'normal';
      icon = '🛡️';
      break;
    default:
      messageText = `${actor.characterName}이(가) ${action.type} 행동을 했습니다.`;
  }

  if (result.damage && result.damage > 0) {
    messageText += ` ${result.damage} 데미지!`;
    if (result.isCritical) {
      messageText += ' 치명타!';
      messageStyle = 'critical';
      icon = '💥';
    }
  }

  if (result.heal && result.heal > 0) {
    messageText += ` ${result.heal} 회복!`;
    messageStyle = 'heal';
    icon = '💚';
  }

  return this.create({
    battleId,
    roomId,
    turn,
    sequence,
    type: `action_${action.type}`,
    actor: {
      type: actor.type,
      characterName: actor.characterName,
      playerId: actor.playerId
    },
    target: {
      type: target.type,
      characterName: target.characterName,
      playerId: target.playerId
    },
    action,
    result,
    message: {
      text: messageText,
      style: messageStyle,
      icon,
      color: messageStyle === 'critical' ? '#ef4444' : 
             messageStyle === 'heal' ? '#22c55e' : 
             messageStyle === 'damage' ? '#f97316' : '#6b7280'
    },
    metadata: {
      clientSync: {
        broadcast: true,
        targets: ['all'],
        priority: result.isCritical ? 'high' : 'normal'
      }
    }
  });
};

// 인스턴스 메서드: 시스템 로그 생성
battleLogSchema.statics.createSystemLog = function(battleId, roomId, turn, sequence, type, message, metadata = {}) {
  return this.create({
    battleId,
    roomId,
    turn,
    sequence,
    type,
    actor: {
      type: 'system'
    },
    message: {
      text: message,
      style: 'system',
      icon: '⚙️',
      color: '#6b7280'
    },
    result: {
      success: true
    },
    metadata: {
      clientSync: {
        broadcast: true,
        targets: ['all'],
        priority: 'normal'
      },
      ...metadata
    }
  });
};

// 미들웨어: 저장 전 검증
battleLogSchema.pre('save', function(next) {
  // 대사 길이 검증
  if (this.action && this.action.dialogue && this.action.dialogue.message) {
    if (this.action.dialogue.message.length > 140) {
      return next(new Error('대사는 140자를 초과할 수 없습니다.'));
    }
  }
  
  // 메시지 텍스트 필수 확인
  if (!this.message || !this.message.text) {
    return next(new Error('메시지 텍스트는 필수입니다.'));
  }
  
  next();
});

module.exports = mongoose.model('BattleLog', battleLogSchema);