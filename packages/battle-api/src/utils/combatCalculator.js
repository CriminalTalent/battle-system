// ==============================================
// 1. 회피/방어 확률 계산 시스템
// ==============================================

// packages/battle-api/src/utils/combatCalculator.js
class CombatCalculator {
  static calculateDamage(attacker, defender, action) {
    const baseDamage = attacker.attack || 100;
    
    // 회피 확률 계산 (민첩성 기반)
    const dodgeChance = Math.min(defender.agility / 1000, 0.3); // 최대 30%
    if (Math.random() < dodgeChance) {
      return { damage: 0, result: 'DODGE', critical: false };
    }
    
    // 방어 확률 계산
    const blockChance = Math.min(defender.defense / 800, 0.25); // 최대 25%
    let finalDamage = baseDamage;
    let blocked = false;
    
    if (Math.random() < blockChance) {
      finalDamage = Math.floor(finalDamage * 0.3); // 70% 데미지 감소
      blocked = true;
    }
    
    // 크리티컬 계산
    const critChance = Math.min(attacker.luck / 500, 0.2); // 최대 20%
    const critical = Math.random() < critChance;
    if (critical) {
      finalDamage = Math.floor(finalDamage * 1.5);
    }
    
    // 최종 데미지 계산
    const defense = defender.defense || 50;
    finalDamage = Math.max(1, finalDamage - Math.floor(defense * 0.1));
    
    return {
      damage: finalDamage,
      result: blocked ? 'BLOCKED' : 'HIT',
      critical,
      dodged: false,
      blocked
    };
  }
  
  static calculateHealing(healer, target, action) {
    const baseHealing = healer.magic || 80;
    const healingBonus = Math.floor(healer.wisdom * 0.1);
    return Math.floor(baseHealing + healingBonus);
  }
}

// ==============================================
// 2. 렌더링 최적화 및 성능 개선
// ==============================================

// packages/battle-web/src/components/battle/OptimizedBattleField.js
import React, { memo, useMemo, useCallback, Suspense, lazy } from 'react';
import { FixedSizeList as List } from 'react-window';

// Lazy loading 컴포넌트들
const CharacterCard = lazy(() => import('./CharacterCard'));
const EffectRenderer = lazy(() => import('./EffectRenderer'));

const OptimizedBattleField = memo(({ 
  teams, 
  currentTurn, 
  onCharacterClick,
  battleMode 
}) => {
  // 메모이제이션으로 불필요한 재계산 방지
  const layoutConfig = useMemo(() => {
    const totalPlayers = (teams.team1?.length || 0) + (teams.team2?.length || 0);
    
    if (totalPlayers <= 4) {
      return { columns: 2, rows: 2, gap: 20 };
    } else if (totalPlayers <= 6) {
      return { columns: 3, rows: 2, gap: 15 };
    } else {
      return { columns: 4, rows: 2, gap: 10 };
    }
  }, [teams.team1?.length, teams.team2?.length]);

  // 가상화된 리스트 렌더링 (대규모 팀전용)
  const renderVirtualizedTeam = useCallback(({ index, style, data }) => {
    const character = data[index];
    return (
      <div style={style}>
        <Suspense fallback={<div className="animate-pulse bg-gray-200 rounded-lg h-32" />}>
          <CharacterCard
            character={character}
            isActive={currentTurn?.position === index}
            onClick={() => onCharacterClick(character)}
            optimized={true}
          />
        </Suspense>
      </div>
    );
  }, [currentTurn, onCharacterClick]);

  // 대규모 팀전 시 가상화 사용
  if ((teams.team1?.length || 0) > 8) {
    return (
      <div className="grid grid-cols-2 gap-8 h-96">
        <div className="border-2 border-blue-500 rounded-lg p-4">
          <h3 className="text-blue-600 font-bold mb-2">Team 1</h3>
          <List
            height={320}
            itemCount={teams.team1.length}
            itemSize={80}
            itemData={teams.team1}
          >
            {renderVirtualizedTeam}
          </List>
        </div>
        <div className="border-2 border-red-500 rounded-lg p-4">
          <h3 className="text-red-600 font-bold mb-2">Team 2</h3>
          <List
            height={320}
            itemCount={teams.team2.length}
            itemSize={80}
            itemData={teams.team2}
          >
            {renderVirtualizedTeam}
          </List>
        </div>
      </div>
    );
  }

  // 일반 팀전 렌더링
  return (
    <div 
      className="grid gap-4 p-4"
      style={{
        gridTemplateColumns: `repeat(${layoutConfig.columns}, 1fr)`,
        gap: `${layoutConfig.gap}px`
      }}
    >
      {/* Team 1 */}
      <div className="col-span-full border-2 border-blue-500 rounded-lg p-4">
        <h3 className="text-blue-600 font-bold mb-2">Team 1</h3>
        <div className={`grid gap-2 grid-cols-${Math.min(teams.team1?.length || 1, layoutConfig.columns)}`}>
          {teams.team1?.map((character, index) => (
            <Suspense 
              key={`team1-${index}`} 
              fallback={<div className="animate-pulse bg-blue-100 rounded h-24" />}
            >
              <CharacterCard
                character={character}
                teamColor="blue"
                position={index}
                isActive={currentTurn?.team === 'team1' && currentTurn?.position === index}
                onClick={() => onCharacterClick(character)}
              />
            </Suspense>
          ))}
        </div>
      </div>

      {/* Team 2 */}
      <div className="col-span-full border-2 border-red-500 rounded-lg p-4">
        <h3 className="text-red-600 font-bold mb-2">Team 2</h3>
        <div className={`grid gap-2 grid-cols-${Math.min(teams.team2?.length || 1, layoutConfig.columns)}`}>
          {teams.team2?.map((character, index) => (
            <Suspense 
              key={`team2-${index}`} 
              fallback={<div className="animate-pulse bg-red-100 rounded h-24" />}
            >
              <CharacterCard
                character={character}
                teamColor="red"
                position={index}
                isActive={currentTurn?.team === 'team2' && currentTurn?.position === index}
                onClick={() => onCharacterClick(character)}
              />
            </Suspense>
          ))}
        </div>
      </div>
    </div>
  );
});

OptimizedBattleField.displayName = 'OptimizedBattleField';

// ==============================================
// 3. Socket 이벤트 Throttling 및 보안
// ==============================================

// packages/battle-api/src/socket/enhancedBattleSocket.js
const rateLimit = require('express-rate-limit');
const { throttle, debounce } = require('lodash');

class EnhancedBattleSocket {
  constructor(io) {
    this.io = io;
    this.actionThrottles = new Map(); // 플레이어별 throttle 관리
    this.turnTimeouts = new Map(); // 턴 타임아웃 관리
    this.connectionStates = new Map(); // 연결 상태 추적
    
    this.setupSocketHandlers();
    this.setupSecurityMiddleware();
  }

  setupSecurityMiddleware() {
    // Rate limiting 설정
    this.actionLimiter = rateLimit({
      windowMs: 1000, // 1초
      max: 5, // 최대 5개 액션
      message: 'Too many actions, please slow down'
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Socket connected: ${socket.id}`);
      
      // 연결 상태 추적
      this.connectionStates.set(socket.id, {
        lastAction: Date.now(),
        actionCount: 0,
        isAuthenticated: false
      });

      // JWT 토큰 검증
      socket.on('authenticate', async (token) => {
        try {
          const decoded = await this.verifyJWT(token);
          socket.userId = decoded.userId;
          socket.battleId = decoded.battleId;
          
          this.connectionStates.get(socket.id).isAuthenticated = true;
          socket.emit('authenticated', { success: true });
          
          // 재연결 처리
          await this.handleReconnection(socket);
          
        } catch (error) {
          socket.emit('auth_error', { message: 'Invalid token' });
          socket.disconnect();
        }
      });

      // Throttled 액션 핸들러
      socket.on('action', this.createThrottledActionHandler(socket));
      
      // 연결 끊김 처리
      socket.on('disconnect', () => this.handleDisconnection(socket));
      
      // 하트비트 설정
      this.setupHeartbeat(socket);
    });
  }

  createThrottledActionHandler(socket) {
    return throttle(async (actionData) => {
      try {
        // 보안 검증
        if (!this.validateAction(socket, actionData)) {
          return;
        }

        // 턴 순서 검증
        if (!this.validateTurnOrder(socket, actionData)) {
          socket.emit('action_error', { message: 'Not your turn' });
          return;
        }

        // 액션 처리
        const result = await this.processAction(socket, actionData);
        
        // 결과 브로드캐스트
        this.io.to(socket.battleId).emit('action_result', result);
        
        // 턴 타임아웃 재설정
        this.resetTurnTimeout(socket.battleId);
        
      } catch (error) {
        console.error('Action processing error:', error);
        socket.emit('action_error', { message: 'Action failed' });
      }
    }, 300); // 300ms throttle
  }

  validateAction(socket, actionData) {
    const state = this.connectionStates.get(socket.id);
    
    // 인증 확인
    if (!state?.isAuthenticated) {
      socket.emit('action_error', { message: 'Not authenticated' });
      return false;
    }

    // Rate limiting 확인
    const now = Date.now();
    if (now - state.lastAction < 200) { // 200ms 최소 간격
      socket.emit('action_error', { message: 'Action too frequent' });
      return false;
    }

    // 액션 데이터 유효성 검증
    if (!actionData || !actionData.type || !actionData.targets) {
      socket.emit('action_error', { message: 'Invalid action data' });
      return false;
    }

    state.lastAction = now;
    state.actionCount++;
    
    return true;
  }

  validateTurnOrder(socket, actionData) {
    const battle = this.getBattle(socket.battleId);
    if (!battle) return false;

    const currentPlayer = this.getCurrentPlayer(battle);
    return currentPlayer?.socketId === socket.id;
  }

  setupHeartbeat(socket) {
    const heartbeat = setInterval(() => {
      socket.emit('ping');
      
      const timeout = setTimeout(() => {
        console.log(`Socket ${socket.id} heartbeat timeout`);
        socket.disconnect();
      }, 5000);

      socket.once('pong', () => {
        clearTimeout(timeout);
      });
    }, 30000); // 30초마다

    socket.on('disconnect', () => {
      clearInterval(heartbeat);
    });
  }

  async handleReconnection(socket) {
    const battle = this.getBattle(socket.battleId);
    if (battle) {
      // 현재 게임 상태 전송
      socket.emit('game_state', {
        battle: battle.getState(),
        timestamp: Date.now()
      });
      
      // 재연결 알림
      socket.to(socket.battleId).emit('player_reconnected', {
        playerId: socket.userId
      });
    }
  }

  handleDisconnection(socket) {
    console.log(`Socket disconnected: ${socket.id}`);
    
    this.connectionStates.delete(socket.id);
    
    if (socket.battleId) {
      // 플레이어 이탈 처리
      this.handlePlayerLeave(socket);
      
      // 턴 타임아웃 설정 (이탈한 플레이어 턴인 경우)
      this.setDisconnectionTimeout(socket);
    }
  }

  setDisconnectionTimeout(socket) {
    const battle = this.getBattle(socket.battleId);
    if (!battle) return;

    const currentPlayer = this.getCurrentPlayer(battle);
    if (currentPlayer?.socketId === socket.id) {
      // 30초 후 자동으로 턴 넘김
      setTimeout(() => {
        if (!this.isPlayerReconnected(socket.userId, socket.battleId)) {
          this.skipTurn(socket.battleId);
        }
      }, 30000);
    }
  }
}

// ==============================================
// 4. 메모리 누수 방지 Hook
// ==============================================

// packages/battle-web/src/hooks/useOptimizedBattle.js
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { debounce } from 'lodash';

export const useOptimizedBattle = (battleId) => {
  const [battleState, setBattleState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  // Refs for cleanup
  const socketRef = useRef(null);
  const timeoutRefs = useRef(new Set());
  const intervalRefs = useRef(new Set());
  
  // Debounced setState to prevent excessive updates
  const debouncedSetBattleState = useMemo(
    () => debounce((newState) => {
      setBattleState(prev => {
        // 깊은 비교로 불필요한 업데이트 방지
        if (JSON.stringify(prev) === JSON.stringify(newState)) {
          return prev;
        }
        return newState;
      });
    }, 100),
    []
  );

  // Socket 연결 관리
  useEffect(() => {
    if (!battleId) return;

    const connectSocket = async () => {
      try {
        setLoading(true);
        setConnectionStatus('connecting');
        
        const socket = await createSocket(battleId);
        socketRef.current = socket;
        
        // Socket 이벤트 리스너들
        socket.on('connect', () => {
          setConnectionStatus('connected');
          setError(null);
        });

        socket.on('disconnect', () => {
          setConnectionStatus('disconnected');
        });

        socket.on('game_state', debouncedSetBattleState);
        
        socket.on('action_result', (result) => {
          debouncedSetBattleState(result.newState);
        });

        socket.on('error', (error) => {
          setError(error.message);
        });

        // 자동 재연결 로직
        socket.on('reconnect', () => {
          setConnectionStatus('connected');
          setError(null);
        });

        setLoading(false);
        
      } catch (err) {
        setError(err.message);
        setLoading(false);
        setConnectionStatus('error');
      }
    };

    connectSocket();

    // Cleanup 함수
    return () => {
      // Socket 연결 정리
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      // Debounced 함수 취소
      debouncedSetBattleState.cancel();
      
      // 모든 타이머 정리
      timeoutRefs.current.forEach(clearTimeout);
      intervalRefs.current.forEach(clearInterval);
      timeoutRefs.current.clear();
      intervalRefs.current.clear();
    };
  }, [battleId, debouncedSetBattleState]);

  // 액션 실행 함수 (메모이제이션)
  const executeAction = useCallback(async (actionType, targets) => {
    if (!socketRef.current || connectionStatus !== 'connected') {
      throw new Error('Not connected to server');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Action timeout'));
      }, 10000);
      
      timeoutRefs.current.add(timeout);

      socketRef.current.emit('action', {
        type: actionType,
        targets,
        timestamp: Date.now()
      });

      socketRef.current.once('action_result', (result) => {
        clearTimeout(timeout);
        timeoutRefs.current.delete(timeout);
        resolve(result);
      });

      socketRef.current.once('action_error', (error) => {
        clearTimeout(timeout);
        timeoutRefs.current.delete(timeout);
        reject(new Error(error.message));
      });
    });
  }, [connectionStatus]);

  // 연결 상태 모니터링
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const pingInterval = setInterval(() => {
        if (socketRef.current) {
          socketRef.current.emit('ping');
        }
      }, 30000);
      
      intervalRefs.current.add(pingInterval);
      
      return () => {
        clearInterval(pingInterval);
        intervalRefs.current.delete(pingInterval);
      };
    }
  }, [connectionStatus]);

  return {
    battleState,
    loading,
    error,
    connectionStatus,
    executeAction,
    isConnected: connectionStatus === 'connected'
  };
};

// ==============================================
// 5. 이미지 Lazy Loading 컴포넌트
// ==============================================

// packages/battle-web/src/components/ui/LazyImage.js
import React, { useState, useRef, useEffect, memo } from 'react';

const LazyImage = memo(({ 
  src, 
  alt, 
  className, 
  placeholder = '/images/character-placeholder.png',
  loading = 'lazy'
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef();

  // Intersection Observer로 화면에 보일 때만 로드
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleLoad = () => {
    setIsLoaded(true);
    setError(false);
  };

  const handleError = () => {
    setError(true);
    setIsLoaded(false);
  };

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {/* Placeholder */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse rounded" />
      )}
      
      {/* 실제 이미지 */}
      {isInView && (
        <img
          src={error ? placeholder : src}
          alt={alt}
          loading={loading}
          onLoad={handleLoad}
          onError={handleError}
          className={`
            transition-opacity duration-300 rounded
            ${isLoaded ? 'opacity-100' : 'opacity-0'}
            ${className}
          `}
        />
      )}
      
      {/* 에러 상태 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded">
          <span className="text-xs text-gray-500">Image failed to load</span>
        </div>
      )}
    </div>
  );
});

LazyImage.displayName = 'LazyImage';

// ==============================================
// 6. 애니메이션 성능 개선
// ==============================================

// packages/battle-web/src/utils/performantAnimations.js
export class PerformantAnimations {
  static createDamageNumber(damage, element, result) {
    // CSS 애니메이션 사용 (JS 애니메이션보다 성능 좋음)
    const damageEl = document.createElement('div');
    damageEl.className = `damage-number ${result.toLowerCase()}`;
    damageEl.textContent = damage;
    
    // CSS 변수로 성능 최적화
    damageEl.style.setProperty('--start-x', '50%');
    damageEl.style.setProperty('--start-y', '50%');
    damageEl.style.setProperty('--end-y', '20%');
    
    element.appendChild(damageEl);
    
    // 애니메이션 완료 후 정리
    setTimeout(() => {
      if (damageEl.parentNode) {
        damageEl.parentNode.removeChild(damageEl);
      }
    }, 1500);
  }

  static createHealingEffect(amount, element) {
    const healEl = document.createElement('div');
    healEl.className = 'healing-number';
    healEl.textContent = `+${amount}`;
    
    element.appendChild(healEl);
    
    setTimeout(() => {
      if (healEl.parentNode) {
        healEl.parentNode.removeChild(healEl);
      }
    }, 1500);
  }

  // 배치 애니메이션 (한 번에 여러 애니메이션)
  static batchAnimations(animations) {
    requestAnimationFrame(() => {
      animations.forEach(anim => anim());
    });
  }

  // GPU 가속 애니메이션
  static createGPUAcceleratedEffect(element, effect) {
    element.style.transform = 'translate3d(0,0,0)'; // GPU 가속 활성화
    element.style.willChange = 'transform, opacity';
    
    // 애니메이션 실행
    element.classList.add(`effect-${effect}`);
    
    // 애니메이션 완료 후 정리
    element.addEventListener('animationend', () => {
      element.style.willChange = 'auto';
      element.classList.remove(`effect-${effect}`);
    }, { once: true });
  }
}

// ==============================================
// 7. 모바일 터치 최적화
// ==============================================

// packages/battle-web/src/hooks/useTouchOptimization.js
import { useState, useEffect, useCallback } from 'react';

export const useTouchOptimization = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [isLongPress, setIsLongPress] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || 'ontouchstart' in window);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleTouchStart = useCallback((e, onLongPress) => {
    setTouchStart({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    });

    // 긴 터치 감지 (500ms)
    setTimeout(() => {
      setIsLongPress(true);
      onLongPress && onLongPress(e);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback((e, onClick) => {
    if (!touchStart) return;

    const touchEnd = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
      time: Date.now()
    };

    const distance = Math.sqrt(
      Math.pow(touchEnd.x - touchStart.x, 2) + 
      Math.pow(touchEnd.y - touchStart.y, 2)
    );

    const duration = touchEnd.time - touchStart.time;

    // 탭 제스처 감지 (짧은 터치 + 작은 움직임)
    if (distance < 10 && duration < 200 && !isLongPress) {
      onClick && onClick(e);
    }

    setTouchStart(null);
    setIsLongPress(false);
  }, [touchStart, isLongPress]);

  return {
    isMobile,
    handleTouchStart,
    handleTouchEnd,
    isLongPress
  };
};

// ==============================================
// 8. 액션 취소 기능
// ==============================================

// packages/battle-web/src/components/battle/ActionCancelSystem.js
import React, { useState, useEffect } from 'react';

export const ActionCancelSystem = ({ 
  onCancel, 
  isActionPending, 
  timeoutDuration = 5000 
}) => {
  const [timeLeft, setTimeLeft] = useState(timeoutDuration / 1000);
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);

  useEffect(() => {
    if (!isActionPending) return;

    setShowCancelPrompt(true);
    let interval;

    const timer = setTimeout(() => {
      setShowCancelPrompt(false);
    }, timeoutDuration);

    if (showCancelPrompt) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 0.1;
        });
      }, 100);
    }

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      setTimeLeft(timeoutDuration / 1000);
    };
  }, [isActionPending, timeoutDuration, showCancelPrompt]);

  // 키보드 ESC 처리
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Escape' && isActionPending) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isActionPending, onCancel]);

  if (!showCancelPrompt || !isActionPending) return null;

  return (
    <div className="fixed top-4 right-4 bg-yellow-100 border border-yellow-400 rounded-lg p-4 shadow-lg z-50">
      <div className="flex items-center space-x-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-yellow-800">
            Action pending...
          </p>
          <p className="text-xs text-yellow-600">
            Press ESC to cancel ({timeLeft.toFixed(1)}s)
          </p>
        </div>
        
        <button
          onClick={onCancel}
          className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 transition-colors"
        >
          Cancel
        </button>
      </div>
      
      {/* 타이머 바 */}
      <div className="mt-2 w-full bg-yellow-200 rounded-full h-1">
        <div 
          className="bg-yellow-500 h-1 rounded-full transition-all duration-100 ease-linear"
          style={{ width: `${(timeLeft / (timeoutDuration / 1000)) * 100}%` }}
        />
      </div>
    </div>
  );
};

// ==============================================
// 9. 상세한 로깅 시스템
// ==============================================

// packages/battle-api/src/services/BattleLogger.js
class BattleLogger {
  constructor() {
    this.logs = new Map(); // battleId -> logs
  }

  logAction(battleId, action) {
    const log = {
      id: this.generateId(),
      battleId,
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      data: {
        playerId: action.playerId,
        actionType: action.type,
        targets: action.targets,
        result: action.result,
        damage: action.damage,
        healing: action.healing,
        statusEffects: action.statusEffects
      }
    };

    if (!this.logs.has(battleId)) {
      this.logs.set(battleId, []);
    }
    
    this.logs.get(battleId).push(log);
    
    // 로그 전송 (실시간)
    this.broadcastLog(battleId, log);
    
    // 데이터베이스 저장 (배치)
    this.queueForDatabase(log);
  }

  logTurnChange(battleId, fromPlayer, toPlayer) {
    const log = {
      id: this.generateId(),
      battleId,
      timestamp: new Date().toISOString(),
      type: 'TURN_CHANGE',
      data: {
        from: fromPlayer,
        to: toPlayer
      }
    };

    this.logs.get(battleId)?.push(log);
    this.broadcastLog(battleId, log);
  }

  logPlayerConnection(battleId, playerId, action) {
    const log = {
      id: this.generateId(),
      battleId,
      timestamp: new Date().toISOString(),
      type: 'CONNECTION',
      data: {
        playerId,
        action, // 'connect', 'disconnect', 'reconnect'
        ip: this.getPlayerIP(playerId)
      }
    };

    this.logs.get(battleId)?.push(log);
    this.broadcastLog(battleId, log);
  }

  logError(battleId, error, context) {
    const log = {
      id: this.generateId(),
      battleId,
      timestamp: new Date().toISOString(),
      type: 'ERROR',
      data: {
        error: error.message,
        stack: error.stack,
        context
      }
    };

    this.logs.get(battleId)?.push(log);
    
    // 에러는 즉시 저장
    this.saveToDatabase(log);
  }

  getBattleLogs(battleId, filters = {}) {
    const logs = this.logs.get(battleId) || [];
    
    let filtered = logs;
    
    if (filters.type) {
      filtered = filtered.filter(log => log.type === filters.type);
    }
    
    if (filters.playerId) {
      filtered = filtered.filter(log => 
        log.data.playerId === filters.playerId ||
        log.data.from === filters.playerId ||
        log.data.to === filters.playerId
      );
    }
    
    if (filters.startTime) {
      filtered = filtered.filter(log => 
        new Date(log.timestamp) >= new Date(filters.startTime)
      );
    }
    
    return filtered.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  broadcastLog(battleId, log) {
    // Socket.io로 실시간 로그 전송
    this.io?.to(battleId).emit('battle_log', log);
  }

  queueForDatabase(log) {
    // 배치 처리를 위한 큐에 추가
    this.dbQueue = this.dbQueue || [];
    this.dbQueue.push(log);
    
    // 100개씩 배치 처리
    if (this.dbQueue.length >= 100) {
      this.flushToDatabase();
    }
  }

  async flushToDatabase() {
    if (!this.dbQueue || this.dbQueue.length === 0) return;
    
    try {
      // 배치 삽입
      await this.database.batchInsertLogs(this.dbQueue);
      this.dbQueue = [];
    } catch (error) {
      console.error('Failed to save logs to database:', error);
    }
  }
}

// ==============================================
// 10. 에러 추적 (Sentry 통합)
// ==============================================

// packages/battle-api/src/middleware/errorTracking.js
const Sentry = require('@sentry/node');

class ErrorTracker {
  static init() {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      beforeSend(event) {
        // 민감한 정보 필터링
        if (event.request?.data) {
          delete event.request.data.password;
          delete event.request.data.token;
        }
        return event;
      }
    });
  }

  static captureError(error, context = {}) {
    Sentry.withScope(scope => {
      // 컨텍스트 정보 추가
      scope.setContext('battle', context.battle);
      scope.setUser({ id: context.userId });
      scope.setTag('component', context.component);
      
      Sentry.captureException(error);
    });
  }

  static captureMessage(message, level = 'info', context = {}) {
    Sentry.withScope(scope => {
      scope.setContext('additional', context);
      Sentry.captureMessage(message, level);
    });
  }

  static addBreadcrumb(message, category, data = {}) {
    Sentry.addBreadcrumb({
      message,
      category,
      data,
      level: 'info'
    });
  }
}

// Express 에러 핸들러
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Sentry에 에러 전송
  ErrorTracker.captureError(err, {
    userId: req.user?.id,
    battle: req.battle?.id,
    component: 'api'
  });

  // 개발 환경에서는 상세 에러, 프로덕션에서는 간단한 메시지
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    stack: isDevelopment ? err.stack : undefined
  });
};

// ==============================================
// 11. 성능 메트릭 수집
// ==============================================

// packages/battle-api/src/middleware/metrics.js
class PerformanceMetrics {
  constructor() {
    this.metrics = {
      actionResponseTime: [],
      socketConnections: 0,
      activeBattles: 0,
      memoryUsage: [],
      cpuUsage: []
    };
    
    this.startMetricsCollection();
  }

  startMetricsCollection() {
    // 메모리 및 CPU 사용량 모니터링
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.metrics.memoryUsage.push({
        timestamp: Date.now(),
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external
      });
      
      this.metrics.cpuUsage.push({
        timestamp: Date.now(),
        user: cpuUsage.user,
        system: cpuUsage.system
      });
      
      // 최근 100개 데이터만 유지
      if (this.metrics.memoryUsage.length > 100) {
        this.metrics.memoryUsage.shift();
      }
      if (this.metrics.cpuUsage.length > 100) {
        this.metrics.cpuUsage.shift();
      }
    }, 5000); // 5초마다
  }

  recordActionTime(startTime, endTime, actionType) {
    const responseTime = endTime - startTime;
    
    this.metrics.actionResponseTime.push({
      timestamp: Date.now(),
      actionType,
      responseTime
    });
    
    // 최근 1000개 액션만 유지
    if (this.metrics.actionResponseTime.length > 1000) {
      this.metrics.actionResponseTime.shift();
    }
  }

  updateSocketCount(count) {
    this.metrics.socketConnections = count;
  }

  updateBattleCount(count) {
    this.metrics.activeBattles = count;
  }

  getMetrics() {
    const now = Date.now();
    const lastHour = now - (60 * 60 * 1000);
    
    // 최근 1시간 데이터 필터링
    const recentActions = this.metrics.actionResponseTime
      .filter(action => action.timestamp > lastHour);
    
    const avgResponseTime = recentActions.length > 0
      ? recentActions.reduce((sum, action) => sum + action.responseTime, 0) / recentActions.length
      : 0;
    
    const recentMemory = this.metrics.memoryUsage
      .filter(mem => mem.timestamp > lastHour);
    
    const currentMemory = recentMemory[recentMemory.length - 1];
    
    return {
      timestamp: now,
      socketConnections: this.metrics.socketConnections,
      activeBattles: this.metrics.activeBattles,
      averageResponseTime: Math.round(avgResponseTime),
      memoryUsage: currentMemory,
      totalActions: recentActions.length,
      actionsByType: this.getActionsByType(recentActions)
    };
  }

  getActionsByType(actions) {
    return actions.reduce((acc, action) => {
      acc[action.actionType] = (acc[action.actionType] || 0) + 1;
      return acc;
    }, {});
  }
}

// ==============================================
// 12. 서버 헬스 체크
// ==============================================

// packages/battle-api/src/routes/health.js
const express = require('express');
const router = express.Router();

class HealthChecker {
  constructor(metrics, database, redis) {
    this.metrics = metrics;
    this.database = database;
    this.redis = redis;
  }

  async checkDatabase() {
    try {
      await this.database.query('SELECT 1');
      return { status: 'healthy', responseTime: Date.now() };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  async checkRedis() {
    try {
      const start = Date.now();
      await this.redis.ping();
      return { 
        status: 'healthy', 
        responseTime: Date.now() - start 
      };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  async checkMemory() {
    const usage = process.memoryUsage();
    const maxHeap = 1024 * 1024 * 1024; // 1GB
    const usagePercent = (usage.heapUsed / maxHeap) * 100;
    
    return {
      status: usagePercent < 80 ? 'healthy' : 'warning',
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      usagePercent: Math.round(usagePercent)
    };
  }

  async getFullHealthStatus() {
    const [database, redis, memory] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMemory()
    ]);

    const metrics = this.metrics.getMetrics();
    
    const overallStatus = [database, redis, memory].every(check => 
      check.status === 'healthy'
    ) ? 'healthy' : 'unhealthy';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: { database, redis, memory },
      metrics
    };
  }
}

// 헬스 체크 엔드포인트
router.get('/health', async (req, res) => {
  try {
    const healthChecker = req.app.get('healthChecker');
    const health = await healthChecker.getFullHealthStatus();
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// 간단한 핑 엔드포인트
router.get('/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==============================================
// 13. 네트워크 재연결 로직
// ==============================================

// packages/battle-web/src/services/reconnection.js
class ReconnectionManager {
  constructor(socket) {
    this.socket = socket;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1초부터 시작
    this.isReconnecting = false;
    
    this.setupReconnectionHandlers();
  }

  setupReconnectionHandlers() {
    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      
      // 서버 측 종료가 아닌 경우에만 재연결 시도
      if (reason !== 'io server disconnect') {
        this.attemptReconnection();
      }
    });

    this.socket.on('connect', () => {
      console.log('Socket reconnected');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.reconnectDelay = 1000;
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Reconnection failed:', error);
    });
  }

  async attemptReconnection() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    // 지수 백오프로 재연결 지연 시간 증가
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      if (this.socket.disconnected) {
        this.socket.connect();
      }
      this.isReconnecting = false;
    }, delay);
  }

  forceReconnect() {
    this.reconnectAttempts = 0;
    this.socket.disconnect();
    this.socket.connect();
  }

  getConnectionStatus() {
    return {
      connected: this.socket.connected,
      reconnecting: this.isReconnecting,
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts
    };
  }
}

// ==============================================
// 14. 종합 보안 미들웨어
// ==============================================

// packages/battle-api/src/middleware/security.js
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');

class SecurityMiddleware {
  static setupSecurity(app) {
    // 기본 보안 헤더
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15분
      max: 100, // 최대 100 요청
      message: 'Too many requests from this IP'
    });
    app.use(limiter);

    // API 전용 더 엄격한 제한
    const apiLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1분
      max: 30, // 최대 30 요청
      skip: (req) => req.ip === '127.0.0.1' // 로컬은 제외
    });
    app.use('/api/', apiLimiter);
  }

  static validateJWT(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // 토큰 만료 체크
      if (decoded.exp < Date.now() / 1000) {
        throw new Error('Token expired');
      }
      
      // 추가 검증 (battleId, 권한 등)
      if (!decoded.battleId || !decoded.userId) {
        throw new Error('Invalid token payload');
      }
      
      return decoded;
    } catch (error) {
      throw new Error(`JWT validation failed: ${error.message}`);
    }
  }

  static validateActionRequest(req, res, next) {
    const { type, targets, battleId } = req.body;
    
    // 필수 필드 검증
    if (!type || !targets || !battleId) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // 액션 타입 검증
    const validActions = ['attack', 'defend', 'heal', 'special'];
    if (!validActions.includes(type)) {
      return res.status(400).json({
        error: 'Invalid action type'
      });
    }

    // 대상 배열 검증
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({
        error: 'Invalid targets'
      });
    }

    // 대상 수 제한 (최대 10명)
    if (targets.length > 10) {
      return res.status(400).json({
        error: 'Too many targets'
      });
    }

    next();
  }

  static preventTurnManipulation(socket, actionData) {
    const battle = getBattle(socket.battleId);
    if (!battle) {
      throw new Error('Battle not found');
    }

    const currentPlayer = getCurrentPlayer(battle);
    
    // 현재 턴 플레이어 확인
    if (currentPlayer.socketId !== socket.id) {
      throw new Error('Not your turn');
    }

    // 액션 시간 제한 (30초)
    const turnStartTime = battle.currentTurnStartTime;
    if (Date.now() - turnStartTime > 30000) {
      throw new Error('Turn timeout');
    }

    // 중복 액션 방지
    if (battle.pendingActions.has(socket.id)) {
      throw new Error('Action already pending');
    }

    return true;
  }
}

// ==============================================
// 15. CSS 애니메이션 정의
// ==============================================

/* packages/battle-web/src/styles/animations.css */
.damage-number {
  position: absolute;
  font-weight: bold;
  font-size: 1.2rem;
  pointer-events: none;
  z-index: 100;
  
  animation: damageFloat 1.5s ease-out forwards;
}

.damage-number.hit {
  color: #ef4444;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
}

.damage-number.critical {
  color: #dc2626;
  font-size: 1.5rem;
  animation: criticalFloat 1.5s ease-out forwards;
}

.damage-number.blocked {
  color: #6b7280;
  font-size: 1rem;
}

.damage-number.dodge {
  color: #10b981;
  font-style: italic;
}

.healing-number {
  position: absolute;
  font-weight: bold;
  font-size: 1.1rem;
  color: #10b981;
  pointer-events: none;
  z-index: 100;
  
  animation: healFloat 1.2s ease-out forwards;
}

@keyframes damageFloat {
  0% {
    transform: translate3d(var(--start-x), var(--start-y), 0) scale(0.8);
    opacity: 0;
  }
  20% {
    transform: translate3d(var(--start-x), calc(var(--start-y) - 10px), 0) scale(1.2);
    opacity: 1;
  }
  100% {
    transform: translate3d(var(--start-x), var(--end-y), 0) scale(1);
    opacity: 0;
  }
}

@keyframes criticalFloat {
  0% {
    transform: translate3d(var(--start-x), var(--start-y), 0) scale(0.5) rotate(-15deg);
    opacity: 0;
  }
  20% {
    transform: translate3d(var(--start-x), calc(var(--start-y) - 15px), 0) scale(1.5) rotate(5deg);
    opacity: 1;
  }
  100% {
    transform: translate3d(var(--start-x), var(--end-y), 0) scale(1) rotate(0deg);
    opacity: 0;
  }
}

@keyframes healFloat {
  0% {
    transform: translate3d(var(--start-x), var(--start-y), 0) scale(0.8);
    opacity: 0;
  }
  30% {
    transform: translate3d(var(--start-x), calc(var(--start-y) - 5px), 0) scale(1.1);
    opacity: 1;
  }
  100% {
    transform: translate3d(var(--start-x), calc(var(--start-y) - 30px), 0) scale(1);
    opacity: 0;
  }
}

/* GPU 가속 효과들 */
.effect-shake {
  animation: shake 0.5s ease-in-out;
}

.effect-glow {
  animation: glow 1s ease-in-out;
}

.effect-pulse {
  animation: pulse 0.8s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translate3d(0, 0, 0); }
  25% { transform: translate3d(-2px, 0, 0); }
  75% { transform: translate3d(2px, 0, 0); }
}

@keyframes glow {
  0% { box-shadow: 0 0 0 rgba(59, 130, 246, 0); }
  50% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.8); }
  100% { box-shadow: 0 0 0 rgba(59, 130, 246, 0); }
}

@keyframes pulse {
  0% { transform: scale3d(1, 1, 1); }
  50% { transform: scale3d(1.1, 1.1, 1); }
  100% { transform: scale3d(1, 1, 1); }
}

/* 모바일 터치 최적화 */
@media (hover: none) and (pointer: coarse) {
  .touch-target {
    min-height: 44px;
    min-width: 44px;
  }
  
  .character-card {
    transform: scale(1.1);
    margin: 8px;
  }
  
  .action-button {
    padding: 12px 24px;
    font-size: 1.1rem;
  }
}

/* 성능 최적화를 위한 will-change */
.animating {
  will-change: transform, opacity;
}

.animating:not(.active) {
  will-change: auto;
}
