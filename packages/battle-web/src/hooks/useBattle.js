import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

/**
 * 팀전 배틀 시스템 통합 관리 훅
 * 민첩성 기반 선후공 시스템 지원
 * 
 * @param {string} apiUrl - 서버 URL
 */
const useBattle = (apiUrl) => {
  // ===========================================
  // 상태 관리
  // ===========================================
  
  const [battleState, setBattleState] = useState({
    id: null,
    status: 'waiting', // waiting, initiative, active, ended
    mode: '1v1', // 1v1, 2v2, 3v3, 4v4
    
    // 팀전 데이터
    teams: { 
      team1: [], 
      team2: [] 
    },
    
    // 턴 관리
    turnOrder: [],
    currentTurnIndex: 0,
    currentPlayer: null,
    
    // 선후공 정보
    initiativeRolls: {
      team1: { agility: 0, diceRoll: 0, total: 0 },
      team2: { agility: 0, diceRoll: 0, total: 0 }
    },
    
    // 로그
    battleLogs: [],
    
    // 시간 정보
    createdAt: null
  });

  const [connectionState, setConnectionState] = useState({
    connected: false,
    connecting: false,
    error: null,
    reconnectAttempts: 0
  });

  const [playerState, setPlayerState] = useState({
    isInBattle: false,
    myTeam: null,
    myPosition: null,
    myPlayer: null,
    isMyTurn: false
  });

  // 대상 선택 상태
  const [targetSelectionState, setTargetSelectionState] = useState({
    isSelecting: false,
    pendingAction: null,
    availableTargets: [],
    selectedTargets: [],
    maxTargets: 1
  });

  // ===========================================
  // Refs
  // ===========================================
  
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // ===========================================
  // 유틸리티 함수들
  // ===========================================

  // 내 캐릭터 찾기
  const getMyCharacter = useCallback(() => {
    if (!playerState.myTeam || playerState.myPosition === null) return null;
    return battleState.teams[playerState.myTeam]?.[playerState.myPosition];
  }, [battleState.teams, playerState.myTeam, playerState.myPosition]);

  // 현재 턴 플레이어 확인
  const getCurrentPlayer = useCallback(() => {
    if (!battleState.turnOrder || battleState.turnOrder.length === 0) return null;
    return battleState.turnOrder[battleState.currentTurnIndex];
  }, [battleState.turnOrder, battleState.currentTurnIndex]);

  // 내 턴인지 확인
  const checkIsMyTurn = useCallback(() => {
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer || !socketRef.current) return false;
    return currentPlayer.id === socketRef.current.id;
  }, [getCurrentPlayer]);

  // 사용 가능한 대상 필터링
  const getAvailableTargets = useCallback((actionType) => {
    const targets = [];
    const myTeam = playerState.myTeam;
    const enemyTeam = myTeam === 'team1' ? 'team2' : 'team1';

    switch (actionType) {
      case 'attack':
        // 상대 팀의 살아있는 멤버
        battleState.teams[enemyTeam]?.forEach((member, index) => {
          if (member && member.status === 'alive' && member.hp > 0) {
            targets.push({
              id: member.id,
              team: enemyTeam,
              position: index,
              character: member
            });
          }
        });
        break;
        
      case 'defend':
      case 'dodge':
        // 자신만 선택 가능
        const myChar = getMyCharacter();
        if (myChar && myChar.status === 'alive') {
          targets.push({
            id: myChar.id,
            team: myTeam,
            position: playerState.myPosition,
            character: myChar
          });
        }
        break;
        
      default:
        break;
    }

    return targets;
  }, [battleState.teams, playerState.myTeam, playerState.myPosition, getMyCharacter]);

  // ===========================================
  // 소켓 연결 관리
  // ===========================================

  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return Promise.resolve();

    setConnectionState(prev => ({ ...prev, connecting: true, error: null }));

    return new Promise((resolve, reject) => {
      const socket = io(apiUrl || 'http://localhost:3001', {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socketRef.current = socket;

      // 연결 성공
      socket.on('connect', () => {
        console.log('소켓 연결 성공:', socket.id);
        setConnectionState({
          connected: true,
          connecting: false,
          error: null,
          reconnectAttempts: 0
        });
        resolve();
      });

      // 연결 실패
      socket.on('connect_error', (error) => {
        console.error('소켓 연결 실패:', error);
        setConnectionState(prev => ({
          ...prev,
          connected: false,
          connecting: false,
          error: error.message,
          reconnectAttempts: prev.reconnectAttempts + 1
        }));
        reject(error);
      });

      // 연결 끊김
      socket.on('disconnect', (reason) => {
        console.log('소켓 연결 끊김:', reason);
        setConnectionState(prev => ({
          ...prev,
          connected: false,
          connecting: false
        }));
      });

      // 재연결 성공
      socket.on('reconnect', (attemptNumber) => {
        console.log('재연결 성공:', attemptNumber);
        setConnectionState(prev => ({
          ...prev,
          connected: true,
          connecting: false,
          error: null,
          reconnectAttempts: 0
        }));
      });

      setupBattleEvents(socket);
    });
  }, [apiUrl]);

  // ===========================================
  // 전투 이벤트 핸들러
  // ===========================================

  const setupBattleEvents = useCallback((socket) => {
    // 배틀 생성 성공
    socket.on('battle_created', (data) => {
      console.log('배틀 생성 성공:', data);
      if (data.success) {
        setBattleState(data.battle);
      }
    });

    // 배틀 업데이트
    socket.on('battle_updated', (data) => {
      console.log('배틀 업데이트:', data);
      if (data.success) {
        setBattleState(data.battle);
        
        // 내가 참가했는지 확인
        const allPlayers = [...data.battle.teams.team1, ...data.battle.teams.team2];
        const myPlayer = allPlayers.find(p => p.id === socket.id);
        
        if (myPlayer) {
          setPlayerState({
            isInBattle: true,
            myTeam: myPlayer.team,
            myPosition: myPlayer.position,
            myPlayer: myPlayer,
            isMyTurn: checkIsMyTurn()
          });
        }
      }
    });

    // 액션 결과
    socket.on('action_result', (data) => {
      console.log('액션 결과:', data);
      if (data.success) {
        setBattleState(data.battle);
        
        // 내 턴 상태 업데이트
        setPlayerState(prev => ({
          ...prev,
          isMyTurn: checkIsMyTurn()
        }));

        // 대상 선택 상태 초기화
        setTargetSelectionState({
          isSelecting: false,
          pendingAction: null,
          availableTargets: [],
          selectedTargets: [],
          maxTargets: 1
        });
      }
    });

    // 에러 처리
    socket.on('error', (error) => {
      console.error('배틀 에러:', error);
      setConnectionState(prev => ({
        ...prev,
        error: error.message
      }));
    });

  }, [checkIsMyTurn]);

  // ===========================================
  // 액션 함수들
  // ===========================================

  // 배틀 생성
  const createBattle = useCallback((mode = '1v1') => {
    if (!socketRef.current) return;
    
    console.log('배틀 생성 요청:', mode);
    socketRef.current.emit('create_battle', { mode });
  }, []);

  // 배틀 참가
  const joinBattle = useCallback((battleId, playerData) => {
    if (!socketRef.current) return;
    
    console.log('배틀 참가 요청:', battleId, playerData);
    socketRef.current.emit('join_battle', {
      battleId,
      playerName: playerData.name || 'Player',
      maxHp: playerData.maxHp || 100,
      attack: playerData.attack || 50,
      defense: playerData.defense || 30,
      agility: playerData.agility || 50
    });
  }, []);

  // 액션 실행
  const executeAction = useCallback((actionData) => {
    if (!socketRef.current?.connected) {
      throw new Error('서버에 연결되지 않았습니다');
    }

    if (!playerState.isMyTurn) {
      throw new Error('당신의 턴이 아닙니다');
    }

    console.log('액션 실행:', actionData);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('액션 실행 시간 초과'));
      }, 10000);

      const handleResult = (data) => {
        clearTimeout(timeout);
        socketRef.current.off('action_result', handleResult);
        socketRef.current.off('error', handleError);
        resolve(data);
      };

      const handleError = (error) => {
        clearTimeout(timeout);
        socketRef.current.off('action_result', handleResult);
        socketRef.current.off('error', handleError);
        reject(new Error(error.message));
      };

      socketRef.current.on('action_result', handleResult);
      socketRef.current.on('error', handleError);
      
      // 서버로 액션 전송
      socketRef.current.emit('execute_action', {
        action: actionData
      });
    });
  }, [playerState.isMyTurn]);

  // 대상 선택이 필요한 액션 실행
  const executeActionWithTargets = useCallback(async (actionType) => {
    const availableTargets = getAvailableTargets(actionType);
    
    if (availableTargets.length === 0) {
      throw new Error('선택 가능한 대상이 없습니다');
    }

    // 자동 대상 선택 (단일 대상인 경우)
    if (availableTargets.length === 1) {
      return executeAction({
        type: actionType,
        targets: [availableTargets[0].id]
      });
    }

    // 수동 대상 선택 필요
    return new Promise((resolve, reject) => {
      setTargetSelectionState({
        isSelecting: true,
        pendingAction: {
          type: actionType,
          resolve,
          reject
        },
        availableTargets,
        selectedTargets: [],
        maxTargets: 1
      });
    });
  }, [executeAction, getAvailableTargets]);

  // 대상 선택 완료
  const confirmTargetSelection = useCallback(async () => {
    const { pendingAction, selectedTargets } = targetSelectionState;
    
    if (!pendingAction || selectedTargets.length === 0) {
      throw new Error('선택된 대상이 없습니다');
    }

    try {
      const result = await executeAction({
        type: pendingAction.type,
        targets: selectedTargets
      });

      // Promise resolve
      if (pendingAction.resolve) {
        pendingAction.resolve(result);
      }

      return result;
    } catch (error) {
      // Promise reject
      if (pendingAction.reject) {
        pendingAction.reject(error);
      }
      throw error;
    } finally {
      // 상태 초기화
      setTargetSelectionState({
        isSelecting: false,
        pendingAction: null,
        availableTargets: [],
        selectedTargets: [],
        maxTargets: 1
      });
    }
  }, [targetSelectionState, executeAction]);

  // 대상 선택 취소
  const cancelTargetSelection = useCallback(() => {
    const { pendingAction } = targetSelectionState;
    
    if (pendingAction && pendingAction.reject) {
      pendingAction.reject(new Error('대상 선택이 취소되었습니다'));
    }

    setTargetSelectionState({
      isSelecting: false,
      pendingAction: null,
      availableTargets: [],
      selectedTargets: [],
      maxTargets: 1
    });
  }, [targetSelectionState]);

  // 대상 토글
  const toggleTarget = useCallback((targetId) => {
    setTargetSelectionState(prev => {
      const isSelected = prev.selectedTargets.includes(targetId);
      
      if (isSelected) {
        // 선택 해제
        return {
          ...prev,
          selectedTargets: prev.selectedTargets.filter(id => id !== targetId)
        };
      } else {
        // 선택 추가 (maxTargets 확인)
        if (prev.selectedTargets.length >= prev.maxTargets) {
          return {
            ...prev,
            selectedTargets: [targetId] // 기존 선택 대체
          };
        } else {
          return {
            ...prev,
            selectedTargets: [...prev.selectedTargets, targetId]
          };
        }
      }
    });
  }, []);

  // 간단한 액션 함수들
  const attack = useCallback(async () => {
    return executeActionWithTargets('attack');
  }, [executeActionWithTargets]);

  const defend = useCallback(async () => {
    return executeActionWithTargets('defend');
  }, [executeActionWithTargets]);

  const dodge = useCallback(async () => {
    return executeActionWithTargets('dodge');
  }, [executeActionWithTargets]);

  // ===========================================
  // 유틸리티 함수들
  // ===========================================

  const reconnect = useCallback(() => {
    return connectSocket();
  }, [connectSocket]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setConnectionState({
      connected: false,
      connecting: false,
      error: null,
      reconnectAttempts: 0
    });
    setPlayerState({
      isInBattle: false,
      myTeam: null,
      myPosition: null,
      myPlayer: null,
      isMyTurn: false
    });
  }, []);

  // ===========================================
  // 키보드 단축키
  // ===========================================

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!playerState.isMyTurn || 
          battleState.status !== 'active' || 
          targetSelectionState.isSelecting) return;

      switch (event.key) {
        case '1':
          event.preventDefault();
          attack().catch(console.error);
          break;
        case '2':
          event.preventDefault();
          defend().catch(console.error);
          break;
        case '3':
          event.preventDefault();
          dodge().catch(console.error);
          break;
        case 'Escape':
          if (targetSelectionState.isSelecting) {
            cancelTargetSelection();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [attack, defend, dodge, playerState.isMyTurn, battleState.status, targetSelectionState.isSelecting, cancelTargetSelection]);

  // ===========================================
  // 초기화 및 정리
  // ===========================================

  useEffect(() => {
    connectSocket().catch(console.error);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [connectSocket]);

  // 턴 상태 업데이트
  useEffect(() => {
    setPlayerState(prev => ({
      ...prev,
      isMyTurn: checkIsMyTurn()
    }));
  }, [battleState.currentTurnIndex, battleState.turnOrder, checkIsMyTurn]);

  // ===========================================
  // 반환값
  // ===========================================

  return {
    // 연결 상태
    socket: socketRef.current,
    isConnected: connectionState.connected,
    isConnecting: connectionState.connecting,
    connectionError: connectionState.error,

    // 배틀 상태
    battleState,
    
    // 플레이어 상태
    isInBattle: playerState.isInBattle,
    myTeam: playerState.myTeam,
    myPosition: playerState.myPosition,
    myPlayer: playerState.myPlayer,
    isMyTurn: playerState.isMyTurn,

    // 대상 선택 상태
    targetSelection: targetSelectionState,

    // 배틀 관리 함수들
    createBattle,
    joinBattle,

    // 액션 함수들
    executeAction,
    executeActionWithTargets,
    attack,
    defend,
    dodge,

    // 대상 선택 함수들
    confirmTargetSelection,
    cancelTargetSelection,
    toggleTarget,
    getAvailableTargets,

    // 유틸리티 함수들
    getMyCharacter,
    getCurrentPlayer,
    reconnect,
    disconnect,

    // 계산된 값들
    canAct: playerState.isMyTurn && 
            battleState.status === 'active' && 
            connectionState.connected && 
            !targetSelectionState.isSelecting,
    
    // 팀전 관련 정보
    isTeamBattle: battleState.mode !== '1v1',
    teamMates: playerState.myTeam ? 
      battleState.teams[playerState.myTeam]?.filter(p => p.id !== socketRef.current?.id) : 
      [],
    enemies: playerState.myTeam ? 
      battleState.teams[playerState.myTeam === 'team1' ? 'team2' : 'team1'] : 
      []
  };
};

export default useBattle;
