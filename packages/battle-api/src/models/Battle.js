// packages/battle-api/src/models/Battle.js (팀전 버전)
const mongoose = require('mongoose');

const battleSchema = new mongoose.Schema({
  // 기본 정보
  roomId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  
  token: {
    type: String,
    required: true,
    unique: true
  },
  
  title: {
    type: String,
    required: true,
    trim: true,
    maxLength: 100
  },
  
  description: {
    type: String,
    maxLength: 500,
    default: ''
  },

  // 팀전 구조 (새로 설계)
  battleType: {
    type: String,
    enum: ['1v1', '2v2', '3v3', '4v4'],
    required: true,
    default: '1v1'
  },

  teams: {
    team1: [{
      position: {
        type: Number,
        required: true, // 0, 1, 2, 3 (최대 4명)
      },
      characterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Character',
        required: true
      },
      playerId: String,
      socketId: String,
      isReady: {
        type: Boolean,
        default: false
      },
      isAlive: {
        type: Boolean,
        default: true
      },
      joinedAt: {
        type: Date,
        default: Date.now
      }
    }],
    team2: [{
      position: {
        type: Number,
        required: true,
      },
      characterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Character',
        required: true
      },
      playerId: String,
      socketId: String,
      isReady: {
        type: Boolean,
        default: false
      },
      isAlive: {
        type: Boolean,
        default: true
      },
      joinedAt: Date
    }]
  },

  // 턴 관리 (팀전 지원)
  currentTurn: {
    team: {
      type: String,
      enum: ['team1', 'team2'],
      default: 'team1'
    },
    position: {
      type: Number,
      default: 0 // 팀 내 순서
    }
  },
  
  turnNumber: {
    type: Number,
    default: 1
  },
  
  turnStartTime: {
    type: Date,
    default: Date.now
  },
  
  turnTimeLimit: {
    type: Number,
    default: 600 // 10분 = 600초
  },

  // 턴 순서 관리
  turnOrder: [{
    team: String,
    position: Number,
    playerId: String
  }],

  // 액션 기록 (팀전 지원)
  turnActions: [{
    turn: Number,
    actor: {
      team: String,
      position: Number,
      playerId: String,
      characterName: String
    },
    target: {
      team: String,
      position: Number,
      playerId: String,
      characterName: String
    },
    action: {
      type: {
        type: String,
        enum: ['attack', 'skill', 'defend', 'heal', 'dialogue', 'pass']
      },
      skillName: String,
      targetType: {
        type: String,
        enum: ['single', 'multiple', 'all_enemies', 'all_allies', 'self']
      },
      damage: Number,
      heal: Number,
      effects: [mongoose.Schema.Types.Mixed],
      message: String,
      timestamp: {
        type: Date,
        default: Date.now
      }
    },
    result: {
      success: Boolean,
      targets: [{
        team: String,
        position: Number,
        damage: Number,
        heal: Number,
        statusEffects: [mongoose.Schema.Types.Mixed]
      }],
      message: String
    }
  }],

  // 대사 기록 (팀전 지원)
  dialogueHistory: [{
    turn: Number,
    actor: {
      team: String,
      position: Number,
      playerId: String,
      characterName: String
    },
    message: {
      type: String,
      required: true,
      maxLength: 140
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    category: {
      type: String,
      enum: ['attack', 'defend', 'skill', 'hurt', 'victory', 'defeat', 'taunt', 'general'],
      default: 'general'
    }
  }],

  // 팀별 대사 사용 추적
  dialogueUsage: {
    team1: new Map(), // position -> {turn, used, timestamp}
    team2: new Map()
  },

  // 전투 설정
  settings: {
    maxTurns: {
      type: Number,
      default: 100 // 팀전은 더 긴 전투
    },
    allowSpectators: {
      type: Boolean,
      default: true
    },
    autoSave: {
      type: Boolean,
      default: true
    },
    ruleset: {
      criticalMultiplier: {
        type: Number,
        default: 1.5
      },
      defenseReduction: {
        type: Number,
        default: 0.5
      },
      statusEffectDuration: {
        type: Number,
        default: 3
      },
      dialogueEnabled: {
        type: Boolean,
        default: true
      },
      dialogueTimeLimit: {
        type: Number,
        default: 600
      },
      // 팀전 특별 규칙
      friendlyFire: {
        type: Boolean,
        default: false
      },
      reviveAllowed: {
        type: Boolean,
        default: false
      }
    }
  },

  // 전투 상태
  status: {
    type: String,
    enum: ['waiting', 'ready', 'active', 'paused', 'finished', 'cancelled'],
    default: 'waiting'
  },

  // 전투 결과
  result: {
    winner: {
      type: String,
      enum: ['team1', 'team2', 'draw', 'cancelled']
    },
    reason: {
      type: String,
      enum: ['elimination', 'timeout', 'surrender', 'disconnect', 'draw']
    },
    finalStats: {
      team1: [{
        position: Number,
        damageDealt: Number,
        damageTaken: Number,
        skillsUsed: Number,
        dialoguesUsed: Number,
        survivedTurns: Number
      }],
      team2: [{
        position: Number,
        damageDealt: Number,
        damageTaken: Number,
        skillsUsed: Number,
        dialoguesUsed: Number,
        survivedTurns: Number
      }]
    },
    endedAt: Date
  },

  // 관람자 (기존과 동일)
  spectators: [{
    socketId: String,
    joinedAt: {
      type: Date,
      default: Date.now
    },
    nickname: {
      type: String,
      default: 'Anonymous'
    }
  }],

  // 메타데이터
  createdBy: {
    type: String,
    default: 'admin'
  },
  
  version: {
    type: Number,
    default: 2 // 팀전 버전
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 가상 필드: 현재 액터
battleSchema.virtual('currentActor').get(function() {
  const currentTeam = this.teams[this.currentTurn.team];
  return currentTeam.find(member => member.position === this.currentTurn.position);
});

// 가상 필드: 팀별 생존자 수
battleSchema.virtual('aliveCount').get(function() {
  return {
    team1: this.teams.team1.filter(member => member.isAlive).length,
    team2: this.teams.team2.filter(member => member.isAlive).length
  };
});

// 메서드: 플레이어 찾기
battleSchema.methods.findPlayer = function(playerId) {
  for (const teamName of ['team1', 'team2']) {
    const member = this.teams[teamName].find(m => m.playerId === playerId);
    if (member) {
      return {
        team: teamName,
        position: member.position,
        member
      };
    }
  }
  return null;
};

// 메서드: 대상 유효성 검증
battleSchema.methods.isValidTarget = function(actorTeam, actorPosition, targetTeam, targetPosition, actionType) {
  const target = this.teams[targetTeam]?.find(m => m.position === targetPosition);
  
  if (!target) return false;
  
  switch (actionType) {
    case 'attack':
    case 'skill_attack':
      // 공격은 상대 팀의 살아있는 멤버만
      return targetTeam !== actorTeam && target.isAlive;
    
    case 'heal':
    case 'defend':
      // 힐/방어는 같은 팀의 살아있는 멤버만
      return targetTeam === actorTeam && target.isAlive;
    
    case 'buff':
      // 버프는 같은 팀만
      return targetTeam === actorTeam && target.isAlive;
    
    case 'debuff':
      // 디버프는 상대 팀만
      return targetTeam !== actorTeam && target.isAlive;
    
    default:
      return true;
  }
};

// 메서드: 사용 가능한 대상 목록
battleSchema.methods.getAvailableTargets = function(actorTeam, actionType) {
  const targets = [];
  
  for (const teamName of ['team1', 'team2']) {
    for (const member of this.teams[teamName]) {
      if (this.isValidTarget(actorTeam, null, teamName, member.position, actionType)) {
        targets.push({
          team: teamName,
          position: member.position,
          playerId: member.playerId,
          characterName: member.characterId?.name || 'Unknown',
          isAlive: member.isAlive
        });
      }
    }
  }
  
  return targets;
};

// 메서드: 다음 턴 계산
battleSchema.methods.nextTurn = function() {
  // 현재 팀에서 다음 살아있는 멤버 찾기
  let nextTeam = this.currentTurn.team;
  let nextPosition = this.currentTurn.position;
  
  // 같은 팀에서 다음 살아있는 멤버 찾기
  const currentTeamMembers = this.teams[nextTeam].filter(m => m.isAlive);
  const currentIndex = currentTeamMembers.findIndex(m => m.position === nextPosition);
  
  if (currentIndex < currentTeamMembers.length - 1) {
    // 같은 팀의 다음 멤버
    nextPosition = currentTeamMembers[currentIndex + 1].position;
  } else {
    // 다른 팀으로 넘어가기
    nextTeam = nextTeam === 'team1' ? 'team2' : 'team1';
    const nextTeamMembers = this.teams[nextTeam].filter(m => m.isAlive);
    
    if (nextTeamMembers.length > 0) {
      nextPosition = nextTeamMembers[0].position;
      
      // 한 바퀴 돌았으면 턴 번호 증가
      if (nextTeam === 'team1') {
        this.turnNumber++;
      }
    }
  }
  
  this.currentTurn = {
    team: nextTeam,
    position: nextPosition
  };
  this.turnStartTime = new Date();
};

// 메서드: 대사 추가 (팀전 버전)
battleSchema.methods.addDialogue = function(team, position, playerId, characterName, message, category = 'general') {
  if (message.length > 140) {
    throw new Error('대사는 140자를 초과할 수 없습니다.');
  }
  
  // 현재 턴에 이미 대사를 사용했는지 확인
  if (this.hasUsedDialogueThisTurn(team, position)) {
    throw new Error('이번 턴에 이미 대사를 사용했습니다.');
  }
  
  // 대사 기록 추가
  const dialogueEntry = {
    turn: this.turnNumber,
    actor: {
      team,
      position,
      playerId,
      characterName
    },
    message: message.trim(),
    category,
    timestamp: new Date()
  };
  
  this.dialogueHistory.push(dialogueEntry);
  
  // 대사 사용 표시
  this.markDialogueUsed(team, position);
  
  return dialogueEntry;
};

// 메서드: 이번 턴에 대사 사용했는지 확인 (팀전 버전)
battleSchema.methods.hasUsedDialogueThisTurn = function(team, position) {
  if (!this.dialogueUsage[team]) return false;
  
  const key = `${position}_${this.turnNumber}`;
  return this.dialogueUsage[team].has(key);
};

// 메서드: 대사 사용 표시 (팀전 버전)
battleSchema.methods.markDialogueUsed = function(team, position) {
  if (!this.dialogueUsage[team]) {
    this.dialogueUsage[team] = new Map();
  }
  
  const key = `${position}_${this.turnNumber}`;
  this.dialogueUsage[team].set(key, {
    turn: this.turnNumber,
    used: true,
    timestamp: new Date()
  });
};

// 메서드: 전투 종료 확인 (팀전 버전)
battleSchema.methods.checkBattleEnd = function() {
  const team1Alive = this.teams.team1.filter(m => m.isAlive).length;
  const team2Alive = this.teams.team2.filter(m => m.isAlive).length;
  
  if (team1Alive === 0 && team2Alive === 0) {
    return { ended: true, winner: 'draw', reason: 'both_teams_eliminated' };
  }
  
  if (team1Alive === 0) {
    return { ended: true, winner: 'team2', reason: 'elimination' };
  }
  
  if (team2Alive === 0) {
    return { ended: true, winner: 'team1', reason: 'elimination' };
  }
  
  // 최대 턴 수 확인
  if (this.turnNumber >= this.settings.maxTurns) {
    if (team1Alive > team2Alive) {
      return { ended: true, winner: 'team1', reason: 'timeout' };
    } else if (team2Alive > team1Alive) {
      return { ended: true, winner: 'team2', reason: 'timeout' };
    } else {
      return { ended: true, winner: 'draw', reason: 'timeout' };
    }
  }
  
  return { ended: false };
};

// 메서드: 팀 준비 상태 확인
battleSchema.methods.isTeamReady = function(teamName) {
  return this.teams[teamName].every(member => member.isReady);
};

// 메서드: 모든 팀 준비 완료 확인
battleSchema.methods.allTeamsReady = function() {
  return this.isTeamReady('team1') && this.isTeamReady('team2');
};

// 스태틱 메서드: 배틀 타입별 최대 인원
battleSchema.statics.getMaxPlayersPerTeam = function(battleType) {
  const typeMap = {
    '1v1': 1,
    '2v2': 2,
    '3v3': 3,
    '4v4': 4
  };
  return typeMap[battleType] || 1;
};

module.exports = mongoose.model('Battle', battleSchema);