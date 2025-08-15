import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

/**
 * 전투 시스템 통합 관리 훅 (팀전 지원)
 * 
 * @param {string} token - 인증 토큰
 * @param {boolean} isSpectator - 관전자 여부
 */
const useBattle = (token, isSpectator = false) => {
  // ===========================================
  // 상태 관리
  // ===========================================
  
  const [battleState, setBattleState] = useState({
    id: null,
    status: 'waiting',
    battleType: '1v1', // '1v1', '2v2', '3v3', '4v4'
    
    // 1v1 데이터
    participants: { A: null, B: null },
    
    // 팀전 데이터
    teams: { team1: [], team2: [] },
    
    // 공통 데이터
    currentTurn: null, // 1v1: 'A'|'B', 팀전: {team: 'team1', position: 0}
    turnCount: 0,
    turnStartTime: null,
    battleLog: [],
    
    // 내 정보
    myRole: null, // 1v1: 'A'|'B', 팀전: 'team1'|'team2'
    myPosition: null, // 팀전에서만 사용: 0, 1, 2, 3
    myUserId: null,
    myTurn: false,
    
    winner: null,
    settings: null
  });

  const [connectionState, setConnectionState] = useState({
    connected: false,
    connecting: false,
    error: null,
    reconnectAttempts: 0
  });

  const [uiState, setUiState] = useState({
    showDamageNumbers: [],
    soundEnabled: true,
    animationsEnabled: true
  });

  // 대상 선택 상태
  const [targetSelectionState, setTargetSelectionState] = useState({
    isSelecting: false,
    pendingAction: null,
    availableTargets: [],
    selectedTargets: [],
    maxTargets: 1,
    allowMultiple: false
  });

  // ===========================================
  // Refs
  // ===========================================
  
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const actionCooldownRef = useRef(null);

  // ===========================================
  // 유틸리티 함수들
  // ===========================================

  // 팀전인지 확인
  const isTeamBattle = useCallback(() => {
    return battleState.battleType && battleState.battleType !== '1v1';
  }, [battleState.battleType]);

  // 현재 플레이어 가져오기
  const getCurrentPlayer = useCallback(() => {
    if (!battleState.currentTurn) return null;
    
    if (isTeamBattle()) {
      const { team, position } = battleState.currentTurn;
      return battleState.teams[team]?.[position];
    } else {
      return battleState.participants[battleState.currentTurn];
    }
  }, [battleState, isTeamBattle]);

  // 내 캐릭터 가져오기
  const getMyCharacter = useCallback(() => {
    if (isTeamBattle()) {
      return battleState.teams[battleState.myRole]?.[battleState.myPosition];
    } else {
      return battleState.participants[battleState.myRole];
    }
  }, [battleState, isTeamBattle]);

  // 사용 가능한 대상 필터링
  const getAvailableTargets = useCallback((actionType) => {
    if (!isTeamBattle()) {
      // 1v1 처리
      const targets = [];
      if (actionType === 'attack') {
        const enemyRole = battleState.myRole === 'A' ? 'B' : 'A';
        const enemy = battleState.participants[enemyRole];
        if (enemy && enemy.currentHp > 0) {
          targets.push({ role: enemyRole, character: enemy });
        }
      } else {
        // defend, heal
        const myChar = battleState.participants[battleState.myRole];
        if (myChar && myChar.currentHp > 0) {
          targets.push({ role: battleState.myRole, character: myChar });
        }
      }
      return targets;
    }

    // 팀전 처리
    const targets = [];
    const myTeam = battleState.myRole;
    const enemyTeam = myTeam === 'team1' ? 'team2' : 'team1';

    if (actionType === 'attack') {
      // 상대 팀의 살아있는 멤버
      battleState.teams[enemyTeam]?.forEach((member, index) => {
        if (member && member.status !== 'dead' && member.currentHp > 0) {
          targets.push({
            team: enemyTeam,
            position: index,
            character: member
          });
        }
      });
    } else if (actionType === 'defend') {
      // 같은 팀의 살아있는 멤버
      battleState.teams[myTeam]?.forEach((member, index) => {
        if (member && member.status !== 'dead' && member.currentHp > 0) {
          targets.push({
            team: myTeam,
            position: index,
            character: member
          });
        }
      });
    } else if (actionType === 'heal') {
      // 같은 팀의 부상당한 멤버
      battleState.teams[myTeam]?.forEach((member, index) => {
        if (member && member.status !== 'dead' && member.currentHp < member.maxHp) {
          targets.push({
            team: myTeam,
            position: index,
            character: member
          });
        }
      });
    }

    return targets;
  }, [battleState, isTeamBattle]);

  // ===========================================
  // 소켓 연결 관리
  // ===========================================

  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return Promise.resolve();

    setConnectionState(prev => ({ ...prev, connecting: true, error: null }));

    return new Promise((resolve, reject) => {
      const socket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001', {
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

        // 전투 참가
        socket.emit('join_battle', { 
          token,
          playerId: localStorage.getItem('playerId') || `player_${Date.now()}`
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
        
        if (reason === 'io server disconnect') {
          toast.error('서버에서 연결을 끊었습니다');
        }
      });

      // 재연결 성공
      socket.on('reconnect', (attemptNumber) => {
        console.log('재연결 성공:', attemptNumber);
        toast.success('재연결되었습니다!');
        socket.emit('join_battle', { 
          token,
          playerId: localStorage.getItem('playerId') || `player_${Date.now()}`
        });
      });

      setupBattleEvents(socket);
    });
  }, [token]);

  // ===========================================
  // 전투 이벤트 핸들러
  // ===========================================

  const setupBattleEvents = useCallback((socket) => {
    // 전투 참가 성공
    socket.on('battle_joined', (data) => {
      console.log('전투 참가:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        myRole: data.myRole,
        myPosition: data.myPosition,
        myUserId: data.myUserId,
        myTurn: isMyTurnCheck(data.battle.currentTurn, data.myRole, data.myPosition, data.battle.battleType)
      }));
      toast.success('전투에 참가했습니다!');
    });

    // 전투 상태 업데이트
    socket.on('battle_update', (data) => {
      console.log('전투 업데이트:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        myTurn: isMyTurnCheck(data.battle.currentTurn, prev.myRole, prev.myPosition, data.battle.battleType)
      }));
    });

    // 액션 결과
    socket.on('action_result', (data) => {
      console.log('액션 결과:', data);
      
      setBattleState(prev => ({
        ...prev,
        ...data.battleState,
        myTurn: isMyTurnCheck(data.battleState.currentTurn, prev.myRole, prev.myPosition, data.battleState.battleType)
      }));

      // 대상 선택 상태 초기화
      setTargetSelectionState({
        isSelecting: false,
        pendingAction: null,
        availableTargets: [],
        selectedTargets: [],
        maxTargets: 1,
        allowMultiple: false
      });

      // 데미지 숫자 표시
      if (data.result && data.result.damageDealt > 0) {
        setUiState(prev => ({
          ...prev,
          showDamageNumbers: [
            ...prev.showDamageNumbers,
            {
              id: Date.now(),
              damage: data.result.damageDealt,
              critical: data.result.critical,
              timestamp: Date.now()
            }
          ]
        }));
      }

      // 사운드 효과
      if (uiState.soundEnabled) {
        playSound(data.action.type);
      }
    });

    // 액션 실패
    socket.on('action_failed', (data) => {
      console.log('액션 실패:', data);
      toast.error(data.error);
      
      // 대상 선택 상태 초기화
      setTargetSelectionState({
        isSelecting: false,
        pendingAction: null,
        availableTargets: [],
        selectedTargets: [],
        maxTargets: 1,
        allowMultiple: false
      });
    });

    // 턴 변경
    socket.on('turn_changed', (data) => {
      console.log('턴 변경:', data);
      setBattleState(prev => {
        const newMyTurn = isMyTurnCheck(data.currentTurn, prev.myRole, prev.myPosition, prev.battleType);
        
        if (newMyTurn) {
          toast('당신의 턴입니다!', { icon: '⚔' });
        }

        return {
          ...prev,
          currentTurn: data.currentTurn,
          turnCount: data.turnCount,
          turnStartTime: data.turnStartTime,
          myTurn: newMyTurn
        };
      });
    });

    // 전투 종료
    socket.on('battle_ended', (data) => {
      console.log('전투 종료:', data);
      setBattleState(prev => ({
        ...prev,
        status: 'ended',
        winner: data.winner
      }));

      if (data.winner) {
        const isWinner = checkIfWinner(data.winner, battleState.myRole, battleState.myUserId);
        toast.success(isWinner ? '승리했습니다!' : '패배했습니다!', {
          duration: 5000,
          icon: isWinner ? '🏆' : '😢'
        });
      } else {
        toast('무승부입니다!', { icon: '🤝' });
      }
    });

    // 플레이어 참가
    socket.on('player_joined', (data) => {
      console.log('플레이어 참가:', data);
      toast.info(`${data.characterName}이(가) 참가했습니다!`);
    });

    // 플레이어 연결 해제
    socket.on('player_disconnected', (data) => {
      console.log('플레이어 연결 해제:', data);
      toast.error(`플레이어의 연결이 끊어졌습니다`);
    });

    // 에러 처리
    socket.on('error', (error) => {
      console.error('전투 에러:', error);
      toast.error(error.message);
    });

  }, [battleState.myRole, battleState.myUserId, uiState.soundEnabled]);

  // 내 턴인지 확인하는 함수
  const isMyTurnCheck = useCallback((currentTurn, myRole, myPosition, battleType) => {
    if (!currentTurn || !myRole) return false;
    
    if (battleType === '1v1') {
      return currentTurn === myRole;
    } else {
      return currentTurn.team === myRole && currentTurn.position === myPosition;
    }
  }, []);

  // 승리자인지 확인하는 함수
  const checkIfWinner = useCallback((winner, myRole, myUserId) => {
    if (typeof winner === 'string') {
      // 1v1: winner는 'A' 또는 'B'
      return winner === myRole;
    } else if (typeof winner === 'object') {
      // 팀전: winner는 {team: 'team1'} 형태
      return winner.team === myRole;
    }
    return false;
  }, []);

  // ===========================================
  // 액션 함수들
  // ===========================================

  const executeAction = useCallback(async (actionData) => {
    if (!socketRef.current?.connected) {
      throw new Error('서버에 연결되지 않았습니다');
    }

    if (!battleState.myTurn) {
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
        socketRef.current.off('action_failed', handleFailure);
        resolve(data);
      };

      const handleFailure = (data) => {
        clearTimeout(timeout);
        socketRef.current.off('action_result', handleResult);
        socketRef.current.off('action_failed', handleFailure);
        reject(new Error(data.error));
      };

      socketRef.current.on('action_result', handleResult);
      socketRef.current.on('action_failed', handleFailure);
      
      // 서버로 액션 전송
      socketRef.current.emit('battle_action', {
        actionType: actionData.type,
        targets: actionData.targets,
        skillName: actionData.skillName,
        extra: actionData.extra
      });
    });
  }, [battleState.myTurn]);

  // 대상 선택이 필요한 액션 실행
  const executeActionWithTargets = useCallback(async (actionData) => {
    const availableTargets = getAvailableTargets(actionData.type);
    
    if (availableTargets.length === 0) {
      throw new Error('선택 가능한 대상이 없습니다');
    }

    // 자동 대상 선택 (단일 대상인 경우)
    if (availableTargets.length === 1 && !actionData.requiresTargetSelection) {
      return executeAction({
        ...actionData,
        targets: [availableTargets[0]]
      });
    }

    // 수동 대상 선택 필요
    return new Promise((resolve, reject) => {
      setTargetSelectionState({
        isSelecting: true,
        pendingAction: actionData,
        availableTargets,
        selectedTargets: [],
        maxTargets: actionData.maxTargets || 1,
        allowMultiple: actionData.allowMultiple || false
      });

      // 액션 데이터에 resolve/reject 저장
      actionData._resolve = resolve;
      actionData._reject = reject;
    });
  }, [executeAction, getAvailableTargets]);

  // 대상 선택 완료
  const confirmTargetSelection = useCallback(async (selectedTargets) => {
    const { pendingAction } = targetSelectionState;
    
    if (!pendingAction) {
      throw new Error('진행 중인 액션이 없습니다');
    }

    try {
      const result = await executeAction({
        ...pendingAction,
        targets: selectedTargets
      });

      // Promise resolve
      if (pendingAction._resolve) {
        pendingAction._resolve(result);
      }

      return result;
    } catch (error) {
      // Promise reject
      if (pendingAction._reject) {
        pendingAction._reject(error);
      }
      throw error;
    } finally {
      // 상태 초기화
      setTargetSelectionState({
        isSelecting: false,
        pendingAction: null,
        availableTargets: [],
        selectedTargets: [],
        maxTargets: 1,
        allowMultiple: false
      });
    }
  }, [targetSelectionState, executeAction]);

  // 대상 선택 취소
  const cancelTargetSelection = useCallback(() => {
    const { pendingAction } = targetSelectionState;
    
    if (pendingAction && pendingAction._reject) {
      pendingAction._reject(new Error('대상 선택이 취소되었습니다'));
    }

    setTargetSelectionState({
      isSelecting: false,
      pendingAction: null,
      availableTargets: [],
      selectedTargets: [],
      maxTargets: 1,
      allowMultiple: false
    });
  }, [targetSelectionState]);

  // 간단한 액션 함수들
  const attack = useCallback(async () => {
    return executeActionWithTargets({ type: 'attack' });
  }, [executeActionWithTargets]);

  const defend = useCallback(async () => {
    return executeActionWithTargets({ type: 'defend' });
  }, [executeActionWithTargets]);

  const heal = useCallback(async () => {
    return executeActionWithTargets({ type: 'heal' });
  }, [executeActionWithTargets]);

  const surrender = useCallback(async () => {
    if (window.confirm('정말로 항복하시겠습니까?')) {
      return executeAction({ type: 'surrender', targets: [] });
    }
  }, [executeAction]);

  // ===========================================
  // 유틸리티 함수들
  // ===========================================

  const playSound = useCallback((soundType) => {
    if (!uiState.soundEnabled) return;
    
    try {
      const audio = new Audio(`/sounds/sfx/${soundType}.mp3`);
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch (error) {
      console.warn('사운드 재생 실패:', error);
    }
  }, [uiState.soundEnabled]);

  const clearDamageNumber = useCallback((id) => {
    setUiState(prev => ({
      ...prev,
      showDamageNumbers: prev.showDamageNumbers.filter(num => num.id !== id)
    }));
  }, []);

  const toggleSound = useCallback(() => {
    setUiState(prev => ({
      ...prev,
      soundEnabled: !prev.soundEnabled
    }));
    toast(uiState.soundEnabled ? '사운드 꺼짐' : '사운드 켜짐');
  }, [uiState.soundEnabled]);

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
  }, []);

  // ===========================================
  // 키보드 단축키
  // ===========================================

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!battleState.myTurn || battleState.status !== 'active' || targetSelectionState.isSelecting) return;

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
          heal().catch(console.error);
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
  }, [attack, defend, heal, battleState.myTurn, battleState.status, targetSelectionState.isSelecting, cancelTargetSelection]);

  // ===========================================
  // 초기화 및 정리
  // ===========================================

  useEffect(() => {
    connectSocket().catch(console.error);

    return () => {
      if (actionCooldownRef.current) {
        clearTimeout(actionCooldownRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [connectSocket]);

  // 데미지 숫자 자동 정리
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      setUiState(prev => ({
        ...prev,
        showDamageNumbers: prev.showDamageNumbers.filter(
          num => now - num.timestamp < 2000
        )
      }));
    }, 100);

    return () => clearInterval(cleanup);
  }, []);

  // ===========================================
  // 반환값
  // ===========================================

  return {
    // 전투 상태
    battleState,
    
    // 연결 상태
    connected: connectionState.connected,
    connecting: connectionState.connecting,
    connectionError: connectionState.error,
    isReconnecting: connectionState.reconnectAttempts > 0 && connectionState.connecting,

    // UI 상태
    ...uiState,

    // 대상 선택 상태
    targetSelection: targetSelectionState,

    // 액션 함수들
    executeAction,
    executeActionWithTargets,
    attack,
    defend,
    heal,
    surrender,

    // 대상 선택 함수들
    confirmTargetSelection,
    cancelTargetSelection,
    getAvailableTargets,

    // 유틸리티 함수들
    clearDamageNumber,
    toggleSound,
    reconnect,
    disconnect,

    // 계산된 값들
    isTeamBattle: isTeamBattle(),
    currentPlayer: getCurrentPlayer(),
    myCharacter: getMyCharacter(),
    canAct: battleState.myTurn && battleState.status === 'active' && connectionState.connected && !targetSelectionState.isSelecting,

    // 1v1 호환성을 위한 값들
    myRole: battleState.myRole,
    enemyCharacter: !isTeamBattle() ? 
      battleState.participants[battleState.myRole === 'A' ? 'B' : 'A'] : 
      null
  };
};

export default useBattle;
