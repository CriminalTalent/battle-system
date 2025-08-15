// packages/battle-api/src/models/Character.js
const mongoose = require('mongoose');

const characterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxLength: 50
  },
  
  // 기본 스탯
  stats: {
    hp: {
      type: Number,
      required: true,
      min: 1,
      max: 9999,
      default: 100
    },
    maxHp: {
      type: Number,
      required: true,
      min: 1,
      max: 9999,
      default: 100
    },
    attack: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
      default: 20
    },
    defense: {
      type: Number,
      required: true,
      min: 0,
      max: 999,
      default: 10
    },
    speed: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
      default: 15
    },
    accuracy: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
      default: 85
    },
    criticalRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 5
    }
  },

  // 스킬 목록
  skills: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxLength: 30
    },
    type: {
      type: String,
      enum: ['attack', 'heal', 'buff', 'debuff', 'special'],
      required: true
    },
    power: {
      type: Number,
      min: 0,
      max: 999,
      default: 0
    },
    cost: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    cooldown: {
      type: Number,
      min: 0,
      max: 10,
      default: 0
    },
    description: {
      type: String,
      maxLength: 200,
      default: ''
    },
    effects: [{
      type: {
        type: String,
        enum: ['damage', 'heal', 'buff_attack', 'buff_defense', 'debuff_attack', 'debuff_defense', 'stun', 'poison']
      },
      value: Number,
      duration: {
        type: Number,
        default: 1
      }
    }]
  }],

  // 상태 이상
  statusEffects: [{
    type: {
      type: String,
      enum: ['poison', 'burn', 'freeze', 'stun', 'buff_attack', 'buff_defense', 'debuff_attack', 'debuff_defense']
    },
    value: Number,
    duration: Number,
    appliedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // 이미지 정보
  image: {
    url: {
      type: String,
      default: ''
    },
    filename: {
      type: String,
      default: ''
    },
    originalName: {
      type: String,
      default: ''
    }
  },

  // 대사 프리셋 (새로 추가)
  dialoguePresets: [{
    category: {
      type: String,
      enum: ['attack', 'defend', 'skill', 'hurt', 'victory', 'defeat', 'taunt', 'general'],
      default: 'general'
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxLength: 140
    }
  }],

  // 스킬 쿨다운 상태
  skillCooldowns: [{
    skillName: String,
    remainingTurns: {
      type: Number,
      default: 0
    }
  }],

  // 전투 통계
  battleStats: {
    totalDamageDealt: {
      type: Number,
      default: 0
    },
    totalDamageTaken: {
      type: Number,
      default: 0
    },
    skillsUsed: {
      type: Number,
      default: 0
    },
    criticalHits: {
      type: Number,
      default: 0
    }
  },

  // 메타데이터
  createdBy: {
    type: String,
    default: 'admin'
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 가상 필드: 현재 HP 퍼센티지
characterSchema.virtual('hpPercentage').get(function() {
  return Math.round((this.stats.hp / this.stats.maxHp) * 100);
});

// 가상 필드: 살아있는지 확인
characterSchema.virtual('isAlive').get(function() {
  return this.stats.hp > 0;
});

// 인덱스 설정
characterSchema.index({ name: 1 });
characterSchema.index({ createdBy: 1 });
characterSchema.index({ isActive: 1 });

// 메서드: 데미지 받기
characterSchema.methods.takeDamage = function(damage) {
  this.stats.hp = Math.max(0, this.stats.hp - damage);
  this.battleStats.totalDamageTaken += damage;
  return this.stats.hp;
};

// 메서드: 회복
characterSchema.methods.heal = function(amount) {
  const oldHp = this.stats.hp;
  this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + amount);
  return this.stats.hp - oldHp; // 실제 회복량 반환
};

// 메서드: 상태 이상 추가
characterSchema.methods.addStatusEffect = function(effect) {
  // 기존 같은 타입의 효과가 있다면 갱신
  const existingIndex = this.statusEffects.findIndex(e => e.type === effect.type);
  
  if (existingIndex >= 0) {
    this.statusEffects[existingIndex] = {
      ...effect,
      appliedAt: new Date()
    };
  } else {
    this.statusEffects.push({
      ...effect,
      appliedAt: new Date()
    });
  }
};

// 메서드: 상태 이상 제거
characterSchema.methods.removeStatusEffect = function(effectType) {
  this.statusEffects = this.statusEffects.filter(effect => effect.type !== effectType);
};

// 메서드: 스킬 쿨다운 업데이트
characterSchema.methods.updateCooldowns = function() {
  this.skillCooldowns.forEach(cooldown => {
    if (cooldown.remainingTurns > 0) {
      cooldown.remainingTurns--;
    }
  });
  
  // 쿨다운이 끝난 스킬들 제거
  this.skillCooldowns = this.skillCooldowns.filter(cooldown => cooldown.remainingTurns > 0);
};

// 메서드: 스킬 사용 가능 여부 확인
characterSchema.methods.canUseSkill = function(skillName) {
  const skill = this.skills.find(s => s.name === skillName);
  if (!skill) return false;
  
  const cooldown = this.skillCooldowns.find(c => c.skillName === skillName);
  return !cooldown || cooldown.remainingTurns <= 0;
};

// 메서드: 대사 프리셋 추가
characterSchema.methods.addDialoguePreset = function(category, message) {
  if (message.length > 140) {
    throw new Error('대사는 140자를 초과할 수 없습니다.');
  }
  
  this.dialoguePresets.push({
    category,
    message: message.trim()
  });
};

// 메서드: 카테고리별 대사 프리셋 가져오기
characterSchema.methods.getDialoguesByCategory = function(category) {
  return this.dialoguePresets
    .filter(preset => preset.category === category)
    .map(preset => preset.message);
};

// 스태틱 메서드: 이름으로 캐릭터 찾기
characterSchema.statics.findByName = function(name) {
  return this.findOne({ name: new RegExp(name, 'i'), isActive: true });
};

// 스태틱 메서드: 활성 캐릭터 목록
characterSchema.statics.getActiveCharacters = function() {
  return this.find({ isActive: true }).sort({ name: 1 });
};

// 미들웨어: 저장 전 검증
characterSchema.pre('save', function(next) {
  // HP가 maxHp를 초과하지 않도록 보장
  if (this.stats.hp > this.stats.maxHp) {
    this.stats.hp = this.stats.maxHp;
  }
  
  // 음수 스탯 방지
  Object.keys(this.stats).forEach(key => {
    if (key !== 'hp' && this.stats[key] < 0) {
      this.stats[key] = 0;
    }
  });
  
  next();
});

module.exports = mongoose.model('Character', characterSchema);