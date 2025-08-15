// packages/battle-api/src/models/Battle.js
const mongoose = require('mongoose');

const battleSchema = new mongoose.Schema({
  // 고유 식별자
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // 전투 참가자
  players: {
    player1: {
      characterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Character',
        required: true
      },
      socketId: String,
      isConnected: {
        type: Boolean,
        default: false
      },
      joinedAt: Date,
      lastActionAt: Date,
      // 대사 사용 여부 (턴당 1회 제한)
      dialogueUsedThisTurn: {
        type: Boolean,
        default: false
      }
    },
    player2: {
      characterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Character',
        required: true
      },
      socketId: String,
      isConnected: {
        type: Boolean,
        default: false
      },
      joinedAt: Date,
      lastActionAt: Date,
      // 대사 사용 여부 (턴당 1회 제한)
      dialogueUsedThisTurn: {
        type: Boolean,
        default: false
      }
    }
  },

  // 턴 관리 (대사 시스템용으로 확장)
  turnSystem: {
    currentTurn: {
      type: Number,
      default: 1
    },
    currentPlayer: {
      type: String,
      enum: ['player1', 'player2'],
      default: 'player1'
    },
    turnStartTime: {
      type: Date,
      default: Date.now
    },
    turnTimeLimit: {
      type: Number,
      default: 600 // 10분 = 600초
    },
    actionSubmitted: {
      type: Boolean,
      default: false
    },
    // 턴 히스토리
    turnHistory: [{
      turn: Number,
      player: String,
      startTime: Date,
      endTime: Date,
      action: String,
      dialogueUsed: {
        type: Boolean,
        default: false
      }
    }]
  },

  // 전투 상태
  battleState: {
    status: {
      type: String,
      enum: ['waiting', 'ready', 'in_progress', 'paused', 'completed', 'abandoned'],
      default: 'waiting'
    },
    winner: {
      type: String,
      enum: ['player1', 'player2', 'draw'],
      default: null
    },
    startedAt: Date,
    endedAt: Date,
    totalTurns: {
      type: Number,
      default: 0
    }
  },

  // 대사 히스토리 (새로 추가)
  dialogueHistory: [{
    turn: {
      type: Number,
      required: true
    },
    player: {
      type: String,
      enum: ['player1', 'player2'],
      required: true
    },
    characterName: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true,
      maxLength: 140,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    // 프리셋 대사인지 직접 입력인지
    isPreset: {
      type: Boolean,
      default: false
    },
    presetCategory: {
      type: String,
      enum: ['attack', 'defend', 'skill', 'hurt', 'victory', 'defeat', 'taunt', 'general']
    }
  }],

  // 액션 히스토리
  actionHistory: [{
    turn: Number,
    player: String,
    action: {
      type: {
        type: String,
        enum: ['attack', 'defend', 'skill', 'item']
      },
      details: mongoose.Schema.Types.Mixed
    },
    result: mongoose.Schema.Types.Mixed,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  // 전투 룰셋
  rules: {
    maxTurns: {
      type: Number,
      default: 50
    },
    turnTimeLimit: {
      type: Number,
      default: 600 // 10분
    },
    allowSpectators: {
      type: Boolean,
      default: true
    },
    enableDialogue: {
      type: Boolean,
      default: true
    },
    dialogueTimeLimit: {
      type: Number,
      default: 600 // 대사 입력 시간 제한 (10분)
    },
    maxDialogueLength: {
      type: Number,
      default: 140
    },
    autoProgressTurn: {
      type: Boolean,
      default: false
    }
  },

  // 관람자 관리
  spectators: [{
    socketId: String,
    joinedAt: {
      type: Date,
      default: Date.now
    },
    nickname: {
      type: String,
      default: 'Guest'
    }
  }],

  // 전투 통계
  statistics: {
    totalDamageDealt: {
      player1: {
        type: Number,
        default: 0
      },
      player2: {
        type: Number,
        default: 0
      }
    },
    skillsUsed: {
      player1: {
        type: Number,
        default: 0
      },
      player2: {
        type: Number,
        default: 0
      }
    },
    criticalHits: {
      player1: {
        type: Number,
        default: 0
      },
      player2: {
        type: Number,
        default: 0
      }
    },
    dialogueCount: {
      player1: {
        type: Number,
        default: 0
      },
      player2: {
        type: Number,
        default: 0
      }
    }
  },

  // 메타데이터
  createdBy: {
    type: String,
    default: 'admin'
  },
  
  isPrivate: {
    type: Boolean,
    default: false
  },
  
  // 리플레이 저장 여부
  saveReplay: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 인덱스 설정
battleSchema.index({ roomId: 1 });
battleSchema.index({ token: 1 });
battleSchema.index({ 'battleState.status': 1 });
battleSchema.index({ createdAt: -1 });
battleSchema.index({ 'players.player1.socketId': 1 });
battleSchema.index({ 'players.player2.socketId': 1 });

// 가상 필드: 전투 진행 시간
battleSchema.virtual('duration').get(function() {
  if (!this.battleState.startedAt) return 0;
  
  const endTime = this.battleState.endedAt || new Date();
  return Math.floor((endTime - this.battleState.startedAt) / 1000); // 초 단위
});

// 가상 필드: 현재 턴 남은 시간
battleSchema.virtual('currentTurnTimeRemaining').get(function() {
  if (!this.turnSystem.turnStartTime) return 0;
  
  const elapsed = Math.floor((new Date() - this.turnSystem.turnStartTime) / 1000);
  return Math.max(0, this.turnSystem.turnTimeLimit - elapsed);
});

// 가상 필드: 양쪽 플레이어 모두 연결되었는지
battleSchema.virtual('bothPlayersConnected').get(function() {
  return this.players.player1.isConnected && this.players.player2.isConnected;
});

// 메서드: 다음 턴으로 넘어가기
battleSchema.methods.nextTurn = function() {
  // 턴 히스토리에 현재 턴 기록
  this.turnSystem.turnHistory.push({
    turn: this.turnSystem.currentTurn,
    player: this.turnSystem.currentPlayer,
    startTime: this.turnSystem.turnStartTime,
    endTime: new Date(),
    action: this.turnSystem.actionSubmitted ? 'submitted' : 'timeout',
    dialogueUsed: this.players[this.turnSystem.currentPlayer].dialogueUsedThisTurn
  });

  // 다음 턴 설정
  this.turnSystem.currentTurn++;
  this.turnSystem.currentPlayer = this.turnSystem.currentPlayer === 'player1' ? 'player2' : 'player1';
  this.turnSystem.turnStartTime = new Date();
  this.turnSystem.actionSubmitted = false;
  
  // 대사 사용 상태 리셋
  this.players.player1.dialogueUsedThisTurn = false;
  this.players.player2.dialogueUsedThisTurn = false;
  
  this.battleState.totalTurns = this.turnSystem.currentTurn;
};

// 메서드: 대사 추가
battleSchema.methods.addDialogue = function(player, characterName, message, isPreset = false, presetCategory = null) {
  // 글자 수 제한 확인
  if (message.length > this.rules.maxDialogueLength) {
    throw new Error(`대사는 ${this.rules.maxDialogueLength}자를 초과할 수 없습니다.`);
  }

  // 현재 턴에 이미 대사를 사용했는지 확인
  if (this.players[player].dialogueUsedThisTurn) {
    throw new Error('이번 턴에 이미 대사를 입력했습니다.');
  }

  // 현재 플레이어의 턴인지 확인
  if (this.turnSystem.currentPlayer !== player) {
    throw new Error('자신의 턴이 아닙니다.');
  }

  // 시간 제한 확인
  if (this.currentTurnTimeRemaining <= 0) {
    throw new Error('턴 시간이 종료되었습니다.');
  }

  // 대사 추가
  const dialogue = {
    turn: this.turnSystem.currentTurn,
    player,
    characterName,
    message: message.trim(),
    timestamp: new Date(),
    isPreset,
    presetCategory
  };

  this.dialogueHistory.push(dialogue);
  this.players[player].dialogueUsedThisTurn = true;
  this.statistics.dialogueCount[player]++;

  return dialogue;
};

// 메서드: 플레이어 연결
battleSchema.methods.connectPlayer = function(player, socketId) {
  if (this.players[player]) {
    this.players[player].socketId = socketId;
    this.players[player].isConnected = true;
    this.players[player].joinedAt = new Date();
    
    // 양쪽 플레이어가 모두 연결되면 전투 시작 준비
    if (this.bothPlayersConnected && this.battleState.status === 'waiting') {
      this.battleState.status = 'ready';
    }
  }
};

// 메서드: 플레이어 연결 해제
battleSchema.methods.disconnectPlayer = function(socketId) {
  if (this.players.player1.socketId === socketId) {
    this.players.player1.isConnected = false;
    this.players.player1.socketId = null;
  } else if (this.players.player2.socketId === socketId) {
    this.players.player2.isConnected = false;
    this.players.player2.socketId = null;
  }

  // 전투 중이라면 일시정지
  if (this.battleState.status === 'in_progress') {
    this.battleState.status = 'paused';
  }
};

// 메서드: 관람자 추가
battleSchema.methods.addSpectator = function(socketId, nickname = 'Guest') {
  if (!this.rules.allowSpectators) {
    throw new Error('이 전투는 관람이 허용되지 않습니다.');
  }

  this.spectators.push({
    socketId,
    nickname,
    joinedAt: new Date()
  });
};

// 메서드: 관람자 제거
battleSchema.methods.removeSpectator = function(socketId) {
  this.spectators = this.spectators.filter(spec => spec.socketId !== socketId);
};

// 메서드: 전투 시작
battleSchema.methods.startBattle = function() {
  if (this.battleState.status !== 'ready') {
    throw new Error('전투를 시작할 수 없는 상태입니다.');
  }

  this.battleState.status = 'in_progress';
  this.battleState.startedAt = new Date();
  this.turnSystem.turnStartTime = new Date();
};

// 메서드: 전투 종료
battleSchema.methods.endBattle = function(winner = null) {
  this.battleState.status = 'completed';
  this.battleState.endedAt = new Date();
  this.battleState.winner = winner;
};

// 메서드: 턴 시간 초과 확인
battleSchema.methods.isTimedOut = function() {
  return this.currentTurnTimeRemaining <= 0;
};

// 메서드: 특정 플레이어의 대사 가져오기
battleSchema.methods.getDialoguesByPlayer = function(player) {
  return this.dialogueHistory.filter(dialogue => dialogue.player === player);
};

// 메서드: 특정 턴의 대사 가져오기
battleSchema.methods.getDialoguesByTurn = function(turn) {
  return this.dialogueHistory.filter(dialogue => dialogue.turn === turn);
};

// 스태틱 메서드: 토큰으로 전투 찾기
battleSchema.statics.findByToken = function(token) {
  return this.findOne({ token, 'battleState.status': { $ne: 'completed' } });
};

// 스태틱 메서드: 룸 ID로 전투 찾기
battleSchema.statics.findByRoomId = function(roomId) {
  return this.findOne({ roomId });
};

// 스태틱 메서드: 진행 중인 전투 목록
battleSchema.statics.getActiveBattles = function() {
  return this.find({ 
    'battleState.status': { $in: ['waiting', 'ready', 'in_progress', 'paused'] }
  }).sort({ createdAt: -1 });
};

// 미들웨어: 저장 전 검증
battleSchema.pre('save', function(next) {
  // 턴 시간 제한 확인
  if (this.turnSystem.turnTimeLimit > 1800) { // 최대 30분
    this.turnSystem.turnTimeLimit = 1800;
  }
  
  // 대사 길이 제한 확인
  if (this.rules.maxDialogueLength > 200) { // 최대 200자
    this.rules.maxDialogueLength = 200;
  }
  
  next();
});

module.exports = mongoose.model('Battle', battleSchema);