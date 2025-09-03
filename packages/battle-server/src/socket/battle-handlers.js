/* packages/battle-server/src/socket/battle-handlers.js
 * ────────────────────────────────────────────────────────────────────
 * PYXIS Battle Handlers - Socket.IO 서버 사이드 핸들러
 * - 실시간 전투 시스템
 * - 인증 및 권한 관리
 * - 턴 관리 및 액션 처리
 * - 채팅 및 관전자 시스템
 * ────────────────────────────────────────────────────────────────────
 */

const { Server } = require('socket.io');

// ════════════════════════════════════════════════════════════════════
// 인메모리 데이터 스토어 (실제 환경에서는 Redis/DB 사용 권장)
// ════════════════════════════════════════════════════════════════════

const battles = new Map();
const players = new Map();
const spectators = new Map();
const admins = new Map();

// ════════════════════════════════════════════════════════════════════
// 전투 데이터 구조
// ════════════════════════════════════════════════════════════════════

class Battle {
  constructor(id, mode = '2v2') {
    this.id = id;
    this.mode = mode;
    this.status = 'waiting'; // waiting, ongoing, paused, ended
    this.created = Date.now();
    this.started = null;
    this.ended = null;
    
    // 팀 구성
    this.teams = {
      A: [], // 불사조 기사단
      B: []  // 죽음을 먹는 자들
    };
    
    // 턴 관리
    this.currentTurn = 1;
    this.currentTeam = null; // 'A' or 'B'
    this.turnStartTime = null;
    this.turnTimeLimit = 5 * 60 * 1000; // 5분
    this.turnTimer = null;
    
    // 전투 로그
    this.logs = [];
    this.maxLogs = 1000;
    
    // OTP 관리
    this.adminOtp = this.generateOtp();
    this.spectatorOtp = this.generateOtp();
    this.playerTokens = new Map();
  }

  generateOtp() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }

  generatePlayerToken() {
    return Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  }

  addPlayer(playerData) {
    const player = {
      id: playerData.id || this.generatePlayerId(),
      name: playerData.name,
      team: playerData.team,
      stats: playerData.stats || { attack: 1, defense: 1, agility: 1, luck: 1 },
      hp: playerData.maxHp || 100,
      maxHp: playerData.maxHp || 100,
      items: playerData.items || { dittany: 1, attackBoost: 1, defenseBoost: 1 },
      status: 'alive', // alive, dead, unconscious
      effects: [], // 상태 효과들
      token: this.generatePlayerToken(),
      joinedAt: Date.now(),
      actionThisTurn: null,
      avatar: playerData.avatar || null
    };

    if (this.teams[playerData.team].length >= this.getMaxPlayersPerTeam()) {
      throw new Error('팀이 가득 찼습니다');
    }

    this.teams[playerData.team].push(player);
    this.playerTokens.set(player.token, player.id);
    
    return player;
  }

  generatePlayerId() {
    return 'P' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  getMaxPlayersPerTeam() {
    return parseInt(this.mode.charAt(0));
  }

  addLog(type, message, data = {}) {
    const log = {
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      type,
      message,
      data,
      timestamp: Date.now(),
      turn: this.currentTurn
    };

    this.logs.push(log);
    
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    return log;
  }

  getAllPlayers() {
    return [...this.teams.A, ...this.teams.B];
  }

  getPlayer(playerId) {
    return this.getAllPlayers().find(p => p.id === playerId);
  }

  canStartBattle() {
    return this.teams.A.length > 0 && this.teams.B.length > 0 && this.status === 'waiting';
  }

  startBattle() {
    if (!this.canStartBattle()) {
      throw new Error('전투를 시작할 수 없습니다');
    }

    this.status = 'ongoing';
    this.started = Date.now();
    
    // 선공 결정 (민첩성 합계)
    const teamAAgi = this.teams.A.reduce((sum, p) => sum + p.stats.agility, 0);
    const teamBAgi = this.teams.B.reduce((sum, p) => sum + p.stats.agility, 0);
    
    this.currentTeam = teamAAgi >= teamBAgi ? 'A' : 'B';
    this.startTurn();

    this.addLog('system', `전투가 시작되었습니다! ${this.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'}이 선공합니다.`, {
      teamAAgi,
      teamBAgi,
      firstTeam: this.currentTeam
    });
  }

  startTurn() {
    this.turnStartTime = Date.now();
    
    // 모든 플레이어 액션 초기화
    this.teams[this.currentTeam].forEach(player => {
      player.actionThisTurn = null;
    });
    
    // 자동 패스 타이머 설정
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }
    
    this.turnTimer = setTimeout(() => {
      this.autoPass();
    }, this.turnTimeLimit);
  }

  autoPass() {
    this.addLog('system', '시간 초과로 턴이 자동으로 넘어갑니다.');
    this.endTurn();
  }

  canEndTurn() {
    const currentTeamPlayers = this.teams[this.currentTeam].filter(p => p.status === 'alive');
    return currentTeamPlayers.every(p => p.actionThisTurn !== null);
  }

  endTurn() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // 승부 판정
    if (this.checkBattleEnd()) {
      return;
    }

    // 턴 교체
    this.currentTeam = this.currentTeam === 'A' ? 'B' : 'A';
    this.currentTurn++;
    
    // 50턴 제한
    if (this.currentTurn > 50) {
      this.endBattle('timeout');
      return;
    }

    this.startTurn();
    
    this.addLog('system', `턴 ${this.currentTurn}: ${this.currentTeam === 'A' ? '불사조 기사단' : '죽음을 먹는 자들'}의 턴입니다.`);
  }

  checkBattleEnd() {
    const teamAAlive = this.teams.A.filter(p => p.status === 'alive' && p.hp > 0);
    const teamBAlive = this.teams.B.filter(p => p.status === 'alive' && p.hp > 0);

    if (teamAAlive.length === 0) {
      this.endBattle('team_b_wins');
      return true;
    }
    
    if (teamBAlive.length === 0) {
      this.endBattle('team_a_wins');
      return true;
    }

    return false;
  }

  endBattle(reason = 'unknown') {
    this.status = 'ended';
    this.ended = Date.now();
    
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    let winner = null;
    let message = '전투가 종료되었습니다.';

    switch (reason) {
      case 'team_a_wins':
        winner = 'A';
        message = '불사조 기사단이 승리했습니다!';
        break;
      case 'team_b_wins':
        winner = 'B';
        message = '죽음을 먹는 자들이 승리했습니다!';
        break;
      case 'timeout':
        // HP 합계로 승자 결정
        const teamAHp = this.teams.A.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
        const teamBHp = this.teams.B.reduce((sum, p) => sum + Math.max(0, p.hp), 0);
        
        if (teamAHp > teamBHp) {
          winner = 'A';
          message = '시간 초과! HP 합계로 불사조 기사단이 승리했습니다!';
        } else if (teamBHp > teamAHp) {
          winner = 'B';
          message = '시간 초과! HP 합계로 죽음을 먹는 자들이 승리했습니다!';
        } else {
          message = '시간 초과! 무승부입니다!';
        }
        break;
    }

    this.addLog('system', message, { winner, reason });
  }

  // 전투 액션 처리
  processAction(playerId, action) {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('플레이어를 찾을 수 없습니다');
    
    if (this.status !== 'ongoing') throw new Error('전투가 진행 중이 아닙니다');
    if (player.team !== this.currentTeam) throw new Error('현재 팀의 턴이 아닙니다');
    if (player.status !== 'alive') throw new Error('사망한 플레이어는 행동할 수 없습니다');
    if (player.actionThisTurn !== null) throw new Error('이미 이번 턴에 행동했습니다');

    const result = this.executeAction(player, action);
    player.actionThisTurn = action.type;

    // 턴 종료 체크
    if (this.canEndTurn()) {
      setTimeout(() => this.endTurn(), 1000);
    }

    return result;
  }

  executeAction(player, action) {
    const roll = () => Math.floor(Math.random() * 20) + 1;
    
    switch (action.type) {
      case 'attack':
        return this.processAttack(player, action.target, roll());
        
      case 'defend':
        return this.processDefend(player, roll());
        
      case 'dodge':
        return this.processDodge(player, roll());
        
      case 'item':
        return this.processItem(player, action.itemType, action.target, roll());
        
      case 'pass':
        return this.processPass(player);
        
      default:
        throw new Error('알 수 없는 액션 타입입니다');
    }
  }

  processAttack(attacker, targetId, roll) {
    const target = this.getPlayer(targetId);
    if (!target) throw new Error('대상을 찾을 수 없습니다');
    if (target.team === attacker.team) throw new Error('같은 팀을 공격할 수 없습니다');
    if (target.status !== 'alive') throw new Error('사망한 대상을 공격할 수 없습니다');

    const attackPower = attacker.stats.attack;
    const hitRoll = attacker.stats.luck + roll;
    const critThreshold = 20 - Math.floor(attacker.stats.luck / 2);
    const isCritical = roll >= critThreshold;
    
    let damage = attackPower + roll - target.stats.defense;
    if (isCritical) damage *= 2;
    damage = Math.max(1, damage);

    target.hp = Math.max(0, target.hp - damage);
    
    if (target.hp === 0) {
      target.status = 'dead';
    }

    const logMessage = `${attacker.name}이(가) ${target.name}을(를) 공격했습니다! ${isCritical ? '치명타! ' : ''}${damage} 데미지!`;
    this.addLog('action', logMessage, {
      attacker: attacker.id,
      target: target.id,
      damage,
      isCritical,
      roll,
      targetHp: target.hp
    });

    return { success: true, damage, isCritical, targetHp: target.hp };
  }

  processDefend(defender, roll) {
    const defenseValue = defender.stats.defense + roll;
    
    // 방어 상태 적용 (다음 공격 시 데미지 감소)
    defender.effects.push({
      type: 'defending',
      value: defenseValue,
      duration: 1
    });

    this.addLog('action', `${defender.name}이(가) 방어 자세를 취했습니다! 방어력: ${defenseValue}`, {
      defender: defender.id,
      defenseValue,
      roll
    });

    return { success: true, defenseValue };
  }

  processDodge(dodger, roll) {
    const dodgeValue = dodger.stats.agility + roll;
    
    // 회피 상태 적용 (다음 공격 시 완전 회피 시도)
    dodger.effects.push({
      type: 'dodging',
      value: dodgeValue,
      duration: 1
    });

    this.addLog('action', `${dodger.name}이(가) 회피 자세를 취했습니다! 민첩성: ${dodgeValue}`, {
      dodger: dodger.id,
      dodgeValue,
      roll
    });

    return { success: true, dodgeValue };
  }

  processItem(user, itemType, targetId, roll) {
    if (user.items[itemType] <= 0) {
      throw new Error('아이템이 부족합니다');
    }

    let target = user;
    if (targetId && targetId !== user.id) {
      target = this.getPlayer(targetId);
      if (!target) throw new Error('대상을 찾을 수 없습니다');
    }

    user.items[itemType]--;
    let result = {};

    switch (itemType) {
      case 'dittany':
        const healAmount = 10;
        target.hp = Math.min(target.maxHp, target.hp + healAmount);
        this.addLog('action', `${user.name}이(가) ${target.name}에게 디터니를 사용했습니다! HP ${healAmount} 회복!`, {
          user: user.id,
          target: target.id,
          healAmount,
          targetHp: target.hp
        });
        result = { success: true, healAmount, targetHp: target.hp };
        break;

      case 'attackBoost':
        const successRate = 0.1;
        const success = Math.random() < successRate;
        if (success) {
          user.effects.push({ type: 'attackBoost', multiplier: 1.5, duration: 1 });
          this.addLog('action', `${user.name}이(가) 공격 보정기를 성공적으로 사용했습니다! 공격력 1.5배!`, {
            user: user.id,
            success: true
          });
        } else {
          this.addLog('action', `${user.name}이(가) 공격 보정기 사용에 실패했습니다.`, {
            user: user.id,
            success: false
          });
        }
        result = { success, effect: success ? 'attackBoost' : null };
        break;

      case 'defenseBoost':
        const defSuccessRate = 0.1;
        const defSuccess = Math.random() < defSuccessRate;
        if (defSuccess) {
          user.effects.push({ type: 'defenseBoost', multiplier: 1.5, duration: 1 });
          this.addLog('action', `${user.name}이(가) 방어 보정기를 성공적으로 사용했습니다! 방어력 1.5배!`, {
            user: user.id,
            success: true
          });
        } else {
          this.addLog('action', `${user.name}이(가) 방어 보정기 사용에 실패했습니다.`, {
            user: user.id,
            success: false
          });
        }
        result = { success: defSuccess, effect: defSuccess ? 'defenseBoost' : null };
        break;
    }

    return result;
  }

  processPass(player) {
    this.addLog('action', `${player.name}이(가) 턴을 패스했습니다.`, {
      player: player.id
    });

    return { success: true };
  }

  getSnapshot() {
    return {
      id: this.id,
      mode: this.mode,
      status: this.status,
      currentTurn: this.currentTurn,
      currentTeam: this.currentTeam,
      turnStartTime: this.turnStartTime,
      turnTimeLimit: this.turnTimeLimit,
      teams: {
        A: this.teams.A.map(p => ({ ...p })),
        B: this.teams.B.map(p => ({ ...p }))
      },
      logs: this.logs.slice(-50), // 최근 50개만
      created: this.created,
      started: this.started,
      ended: this.ended,
      adminOtp: this.adminOtp,
      spectatorOtp: this.spectatorOtp
    };
  }
}

// ════════════════════════════════════════════════════════════════════
// Socket.IO 서버 초기화
// ════════════════════════════════════════════════════════════════════

function initializeSocketHandlers(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"]
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000
  });

  // ────────────────────────────────────────────────────────────────
  // 유틸리티 함수들
  // ────────────────────────────────────────────────────────────────

  function broadcastToBattle(battleId, event, data) {
    io.to(`battle:${battleId}`).emit(event, data);
  }

  function broadcastToTeam(battleId, team, event, data) {
    io.to(`battle:${battleId}:team:${team}`).emit(event, data);
  }

  function broadcastBattleState(battleId) {
    const battle = battles.get(battleId);
    if (battle) {
      broadcastToBattle(battleId, 'state:update', battle.getSnapshot());
    }
  }

  function sanitizeString(str, maxLength = 500) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLength);
  }

  // ────────────────────────────────────────────────────────────────
  // 연결 및 인증
  // ────────────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    console.log(`[Socket] 새 연결: ${socket.id}`);
    
    let authenticated = false;
    let role = null;
    let battleId = null;
    let playerId = null;

    // 관리자 인증
    socket.on('adminAuth', ({ battleId: bid, otp }) => {
      try {
        if (authenticated) return;
        
        const battle = battles.get(bid);
        if (!battle) {
          return socket.emit('authError', '존재하지 않는 전투입니다');
        }

        if (battle.adminOtp !== otp) {
          return socket.emit('authError', '잘못된 관리자 OTP입니다');
        }

        authenticated = true;
        role = 'admin';
        battleId = bid;

        socket.join(`battle:${battleId}`);
        admins.set(socket.id, { battleId, role, socketId: socket.id });

        socket.emit('authSuccess', { 
          role: 'admin', 
          battleId,
          state: battle.getSnapshot()
        });

        console.log(`[Auth] 관리자 인증 성공: ${socket.id} -> ${battleId}`);
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:endBattle', () => {
      try {
        if (role !== 'admin') throw new Error('권한이 없습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        battle.endBattle('admin_ended');
        broadcastBattleState(battleId);

        console.log(`[Admin] 전투 강제 종료: ${battleId}`);
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

    // ────────────────────────────────────────────────────────────────
    // 플레이어 전용 이벤트
    // ────────────────────────────────────────────────────────────────

    socket.on('player:action', (actionData) => {
      try {
        if (role !== 'player') throw new Error('권한이 없습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const result = battle.processAction(playerId, actionData);
        
        socket.emit('player:actionResult', { success: true, result });
        broadcastBattleState(battleId);

        console.log(`[Player] 액션 처리: ${playerId} -> ${actionData.type}`);
      } catch (error) {
        socket.emit('player:actionError', error.message);
      }
    });

    // ────────────────────────────────────────────────────────────────
    // 채팅 시스템
    // ────────────────────────────────────────────────────────────────

    socket.on('chat:send', ({ message, channel = 'all' }) => {
      try {
        if (!authenticated) throw new Error('인증이 필요합니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const sanitizedMessage = sanitizeString(message, 500);
        if (!sanitizedMessage.trim()) return;

        let senderName = '익명';
        let senderRole = role;

        if (role === 'player') {
          const player = battle.getPlayer(playerId);
          senderName = player ? player.name : '플레이어';
        } else if (role === 'spectator') {
          const spectator = spectators.get(socket.id);
          senderName = spectator ? spectator.name : '관전자';
        } else if (role === 'admin') {
          senderName = '관리자';
        }

        const chatMessage = {
          id: 'C' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
          sender: senderName,
          role: senderRole,
          message: sanitizedMessage,
          channel,
          timestamp: Date.now()
        };

        // 채널별 전송
        switch (channel) {
          case 'team':
            if (role === 'player') {
              const player = battle.getPlayer(playerId);
              if (player) {
                broadcastToTeam(battleId, player.team, 'chat:message', chatMessage);
              }
            }
            break;
          case 'spectator':
            if (role === 'spectator') {
              io.to(`battle:${battleId}`).emit('chat:spectator', chatMessage);
            }
            break;
          default: // 'all'
            broadcastToBattle(battleId, 'chat:message', chatMessage);
        }

        console.log(`[Chat] ${senderName} (${channel}): ${sanitizedMessage}`);
      } catch (error) {
        socket.emit('chat:error', error.message);
      }
    });

    // 관전자 응원 메시지
    socket.on('spectator:cheer', ({ message, team }) => {
      try {
        if (role !== 'spectator') throw new Error('관전자만 응원할 수 있습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const spectator = spectators.get(socket.id);
        const cheerMessage = {
          id: 'CH' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
          spectator: spectator.name,
          message: sanitizeString(message, 200),
          team,
          timestamp: Date.now()
        };

        broadcastToBattle(battleId, 'spectator:cheer', cheerMessage);
        
        console.log(`[Cheer] ${spectator.name} -> ${team}팀: ${message}`);
      } catch (error) {
        socket.emit('spectator:error', error.message);
      }
    });

    // ────────────────────────────────────────────────────────────────
    // 공통 이벤트
    // ────────────────────────────────────────────────────────────────

    socket.on('battle:getState', () => {
      try {
        if (!authenticated || !battleId) throw new Error('인증이 필요합니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        socket.emit('battle:state', battle.getSnapshot());
      } catch (error) {
        socket.emit('battle:error', error.message);
      }
    });

    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // ────────────────────────────────────────────────────────────────
    // 연결 해제 처리
    // ────────────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] 연결 해제: ${socket.id} (${reason})`);

      try {
        // 데이터 정리
        if (role === 'player') {
          players.delete(socket.id);
          
          if (battleId) {
            const battle = battles.get(battleId);
            if (battle) {
              const player = battle.getPlayer(playerId);
              if (player) {
                battle.addLog('system', `${player.name}이 연결을 끊었습니다.`);
                broadcastBattleState(battleId);
              }
            }
          }
        } else if (role === 'spectator') {
          const spectator = spectators.get(socket.id);
          spectators.delete(socket.id);
          
          if (spectator && battleId) {
            const battle = battles.get(battleId);
            if (battle) {
              battle.addLog('system', `관전자 ${spectator.name}이 퇴장했습니다.`);
              broadcastBattleState(battleId);
            }
          }
        } else if (role === 'admin') {
          admins.delete(socket.id);
        }
      } catch (error) {
        console.error(`[Socket] 연결 해제 처리 오류: ${error.message}`);
      }
    });

    // 에러 핸들링
    socket.on('error', (error) => {
      console.error(`[Socket] 소켓 오류 ${socket.id}:`, error);
    });

    // 연결 성공 알림
    socket.emit('connection:ready', {
      socketId: socket.id,
      timestamp: Date.now(),
      message: 'PYXIS 전투 시스템에 연결되었습니다'
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 정리 작업 (선택사항)
  // ────────────────────────────────────────────────────────────────

  // 오래된 전투 정리 (1시간마다)
  setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24시간

    for (const [battleId, battle] of battles.entries()) {
      if (now - battle.created > maxAge) {
        console.log(`[Cleanup] 오래된 전투 제거: ${battleId}`);
        battles.delete(battleId);
      }
    }
  }, 60 * 60 * 1000);

  console.log('[Socket] PYXIS Battle Handlers 초기화 완료');
  return io;
}

// ════════════════════════════════════════════════════════════════════
// API 헬퍼 함수들 (REST API에서 사용)
// ════════════════════════════════════════════════════════════════════

function createBattle(mode = '2v2') {
  const battleId = 'B' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const battle = new Battle(battleId, mode);
  battles.set(battleId, battle);
  
  return {
    battleId,
    adminOtp: battle.adminOtp,
    spectatorOtp: battle.spectatorOtp,
    state: battle.getSnapshot()
  };
}

function getBattle(battleId) {
  return battles.get(battleId);
}

function addPlayerToBattle(battleId, playerData) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('전투를 찾을 수 없습니다');
  
  return battle.addPlayer(playerData);
}

function generatePlayerLinks(battleId) {
  const battle = battles.get(battleId);
  if (!battle) throw new Error('전투를 찾을 수 없습니다');

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3001';
  const links = {
    admin: `${baseUrl}/admin?battleId=${battleId}&otp=${battle.adminOtp}`,
    spectator: `${baseUrl}/watch?battleId=${battleId}&otp=${battle.spectatorOtp}`,
    players: {}
  };

  // 각 플레이어별 개별 링크 생성
  battle.getAllPlayers().forEach(player => {
    links.players[player.id] = {
      name: player.name,
      team: player.team,
      url: `${baseUrl}/play?battleId=${battleId}&playerId=${player.id}&otp=${player.token}`
    };
  });

  return links;
}

function getAllBattles() {
  return Array.from(battles.values()).map(battle => battle.getSnapshot());
}

function deleteBattle(battleId) {
  const deleted = battles.delete(battleId);
  if (deleted) {
    console.log(`[API] 전투 삭제: ${battleId}`);
  }
  return deleted;
}

// ════════════════════════════════════════════════════════════════════
// 모듈 내보내기
// ════════════════════════════════════════════════════════════════════

module.exports = {
  initializeSocketHandlers,
  Battle,
  
  // API 헬퍼 함수들
  createBattle,
  getBattle,
  addPlayerToBattle,
  generatePlayerLinks,
  getAllBattles,
  deleteBattle,
  
  // 데이터 접근자 (디버그용)
  getBattles: () => battles,
  getPlayers: () => players,
  getSpectators: () => spectators,
  getAdmins: () => admins
};
        socket.emit('authError', error.message);
      }
    });

    // 플레이어 인증
    socket.on('playerAuth', ({ battleId: bid, playerId: pid, otp }) => {
      try {
        if (authenticated) return;
        
        const battle = battles.get(bid);
        if (!battle) {
          return socket.emit('authError', '존재하지 않는 전투입니다');
        }

        const player = battle.getPlayer(pid);
        if (!player) {
          return socket.emit('authError', '존재하지 않는 플레이어입니다');
        }

        if (player.token !== otp) {
          return socket.emit('authError', '잘못된 플레이어 토큰입니다');
        }

        authenticated = true;
        role = 'player';
        battleId = bid;
        playerId = pid;

        socket.join(`battle:${battleId}`);
        socket.join(`battle:${battleId}:team:${player.team}`);
        
        players.set(socket.id, { 
          battleId, 
          playerId, 
          role, 
          team: player.team,
          socketId: socket.id 
        });

        socket.emit('authSuccess', { 
          role: 'player', 
          battleId,
          playerId,
          playerData: player,
          state: battle.getSnapshot()
        });

        battle.addLog('system', `${player.name}이 전투에 참여했습니다.`);
        broadcastBattleState(battleId);

        console.log(`[Auth] 플레이어 인증 성공: ${socket.id} -> ${battleId} (${player.name})`);
      } catch (error) {
        socket.emit('authError', error.message);
      }
    });

    // 관전자 인증
    socket.on('spectatorAuth', ({ battleId: bid, otp, spectatorName = '관전자' }) => {
      try {
        if (authenticated) return;
        
        const battle = battles.get(bid);
        if (!battle) {
          return socket.emit('authError', '존재하지 않는 전투입니다');
        }

        if (battle.spectatorOtp !== otp) {
          return socket.emit('authError', '잘못된 관전자 OTP입니다');
        }

        authenticated = true;
        role = 'spectator';
        battleId = bid;
        
        const spectatorData = {
          name: sanitizeString(spectatorName, 50),
          battleId,
          role,
          socketId: socket.id,
          joinedAt: Date.now()
        };

        socket.join(`battle:${battleId}`);
        spectators.set(socket.id, spectatorData);

        socket.emit('authSuccess', {
          role: 'spectator',
          battleId,
          spectatorData,
          state: battle.getSnapshot()
        });

        battle.addLog('system', `관전자 ${spectatorData.name}이 입장했습니다.`);
        broadcastBattleState(battleId);

        console.log(`[Auth] 관전자 인증 성공: ${socket.id} -> ${battleId} (${spectatorData.name})`);
      } catch (error) {
        socket.emit('authError', error.message);
      }
    });

    // ────────────────────────────────────────────────────────────────
    // 관리자 전용 이벤트
    // ────────────────────────────────────────────────────────────────

    socket.on('admin:createBattle', ({ mode = '2v2' }) => {
      try {
        if (role !== 'admin') throw new Error('권한이 없습니다');

        const battleId = 'B' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        const battle = new Battle(battleId, mode);
        battles.set(battleId, battle);

        socket.emit('admin:battleCreated', {
          battleId,
          adminOtp: battle.adminOtp,
          spectatorOtp: battle.spectatorOtp,
          state: battle.getSnapshot()
        });

        console.log(`[Admin] 전투 생성: ${battleId} (${mode})`);
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:addPlayer', (playerData) => {
      try {
        if (role !== 'admin') throw new Error('권한이 없습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        const player = battle.addPlayer(playerData);
        
        socket.emit('admin:playerAdded', { player });
        broadcastBattleState(battleId);

        console.log(`[Admin] 플레이어 추가: ${player.name} (${player.team}팀)`);
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:startBattle', () => {
      try {
        if (role !== 'admin') throw new Error('권한이 없습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        battle.startBattle();
        
        socket.emit('admin:battleStarted', { success: true });
        broadcastBattleState(battleId);

        console.log(`[Admin] 전투 시작: ${battleId}`);
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:pauseBattle', () => {
      try {
        if (role !== 'admin') throw new Error('권한이 없습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        battle.status = 'paused';
        if (battle.turnTimer) {
          clearTimeout(battle.turnTimer);
          battle.turnTimer = null;
        }

        battle.addLog('system', '관리자에 의해 전투가 일시정지되었습니다.');
        broadcastBattleState(battleId);

        console.log(`[Admin] 전투 일시정지: ${battleId}`);
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

    socket.on('admin:resumeBattle', () => {
      try {
        if (role !== 'admin') throw new Error('권한이 없습니다');

        const battle = battles.get(battleId);
        if (!battle) throw new Error('전투를 찾을 수 없습니다');

        battle.status = 'ongoing';
        battle.startTurn();

        battle.addLog('system', '관리자에 의해 전투가 재개되었습니다.');
        broadcastBattleState(battleId);

        console.log(`[Admin] 전투 재개: ${battleId}`);
      } catch (error) {
      } catch (error) {
        socket.emit('admin:error', error.message);
      }
    });

  }); // end of io.on('connection')

} // end of initializeSocketHandlers()

// 모듈 내보내기
module.exports = {
  initializeSocketHandlers,
  Battle,
  createBattle,
  getBattle,
  addPlayerToBattle,
  generatePlayerLinks,
  getAllBattles,
  deleteBattle,
  getBattles: () => battles,
  getPlayers: () => players,
  getSpectators: () => spectators,
  getAdmins: () => admins
};
