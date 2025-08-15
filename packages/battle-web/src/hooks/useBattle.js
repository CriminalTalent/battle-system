import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

/**
 * 전투 시스템 통합 관리 훅
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
    participants: { A: null, B: null },
    currentTurn: null,
    turnCount: 0,
    turnStartTime: null,
    battleLog: [],
    myRole: null,
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

  // ===========================================
  // Refs
  // ===========================================
  
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const actionCooldownRef = useRef(null);

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
        socket.emit('join_battle', { token });
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
        socket.emit('join_battle', { token });
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
        myRole: data.role,
        myTurn: data.battle.currentTurn === data.role
      }));
      toast.success('전투에 참가했습니다!');
    });

    // 전투 상태 업데이트
    socket.on('battle_update', (data) => {
      console.log('전투 업데이트:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        myTurn: data.battle.currentTurn === prev.myRole
      }));
    });

    // 액션 결과
    socket.on('action_result', (data) => {
      console.log('액션 결과:', data);
      
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        myTurn: data.battle.currentTurn === prev.myRole
      }));

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
    });

    // 턴 변경
    socket.on('turn_changed', (data) => {
      console.log('턴 변경:', data);
      setBattleState(prev => ({
        ...prev,
        currentTurn: data.currentTurn,
        turnCount: data.turnCount,
        turnStartTime: data.turnStartTime,
        myTurn: data.currentTurn === prev.myRole
      }));

      if (data.currentTurn === battleState.myRole) {
        toast('당신의 턴입니다!', { icon: '⚔' });
      }
    });

    // 전투 종료
    socket.on('battle_ended', (data) => {
      console.log('전투 종료:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        status: 'ended'
      }));

      if (data.battle.winner) {
        const isWinner = data.battle.participants[battleState.myRole]?.name === data.battle.winner;
        toast.success(isWinner ? '승리했습니다!' : '패배했습니다!', {
          duration: 5000,
          icon: isWinner ? '🏆' : '😢'
        });
      } else {
        toast('무승부입니다!', { icon: '🤝' });
      }
    });

    // 참가자 연결 해제
    socket.on('participant_disconnected', (data) => {
      console.log('참가자 연결 해제:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle
      }));
      toast.error(`${data.participantId}의 연결이 끊어졌습니다`);
    });

    // 에러 처리
    socket.on('error', (error) => {
      console.error('전투 에러:', error);
      toast.error(error.message);
    });

  }, [battleState.myRole, uiState.soundEnabled]);

  // ===========================================
  // 액션 함수들
  // ===========================================

  const executeAction = useCallback(async (action) => {
    if (!socketRef.current?.connected) {
      throw new Error('서버에 연결되지 않았습니다');
    }

    if (!battleState.myTurn) {
      throw new Error('당신의 턴이 아닙니다');
    }

    console.log('액션 실행:', action);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('액션 실행 시간 초과'));
      }, 5000);

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
      socketRef.current.emit('player_action', action);
    });
  }, [battleState.myTurn]);

  const attack = useCallback(async () => {
    return executeAction({ type: 'attack' });
  }, [executeAction]);

  const defend = useCallback(async () => {
    return executeAction({ type: 'defend' });
  }, [executeAction]);

  const surrender = useCallback(async () => {
    if (window.confirm('정말로 항복하시겠습니까?')) {
      return executeAction({ type: 'surrender' });
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
      if (!battleState.myTurn || battleState.status !== 'active') return;

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
          surrender().catch(console.error);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [attack, defend, surrender, battleState.myTurn, battleState.status]);

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

    // 액션 함수들
    executeAction,
    attack,
    defend,
    surrender,

    // 유틸리티 함수들
    clearDamageNumber,
    toggleSound,
    reconnect,
    disconnect,

    // 계산된 값들
    myCharacter: battleState.participants[battleState.myRole],
    enemyCharacter: battleState.participants[battleState.myRole === 'A' ? 'B' : 'A'],
    canAct: battleState.myTurn && battleState.status === 'active' && connectionState.connected
  };
};

export default useBattle;import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

/**
 * 전투 시스템 통합 관리 훅
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
    participants: { A: null, B: null },
    currentTurn: null,
    turnCount: 0,
    turnStartTime: null,
    battleLog: [],
    myRole: null,
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

  // ===========================================
  // Refs
  // ===========================================
  
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const actionCooldownRef = useRef(null);

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
        socket.emit('join_battle', { token });
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
        socket.emit('join_battle', { token });
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
        myRole: data.role,
        myTurn: data.battle.currentTurn === data.role
      }));
      toast.success('전투에 참가했습니다!');
    });

    // 전투 상태 업데이트
    socket.on('battle_update', (data) => {
      console.log('전투 업데이트:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        myTurn: data.battle.currentTurn === prev.myRole
      }));
    });

    // 액션 결과
    socket.on('action_result', (data) => {
      console.log('액션 결과:', data);
      
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        myTurn: data.battle.currentTurn === prev.myRole
      }));

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
    });

    // 턴 변경
    socket.on('turn_changed', (data) => {
      console.log('턴 변경:', data);
      setBattleState(prev => ({
        ...prev,
        currentTurn: data.currentTurn,
        turnCount: data.turnCount,
        turnStartTime: data.turnStartTime,
        myTurn: data.currentTurn === prev.myRole
      }));

      if (data.currentTurn === battleState.myRole) {
        toast('당신의 턴입니다!', { icon: '⚔' });
      }
    });

    // 전투 종료
    socket.on('battle_ended', (data) => {
      console.log('전투 종료:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle,
        status: 'ended'
      }));

      if (data.battle.winner) {
        const isWinner = data.battle.participants[battleState.myRole]?.name === data.battle.winner;
        toast.success(isWinner ? '승리했습니다!' : '패배했습니다!', {
          duration: 5000,
          icon: isWinner ? '🏆' : '😢'
        });
      } else {
        toast('무승부입니다!', { icon: '🤝' });
      }
    });

    // 참가자 연결 해제
    socket.on('participant_disconnected', (data) => {
      console.log('참가자 연결 해제:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battle
      }));
      toast.error(`${data.participantId}의 연결이 끊어졌습니다`);
    });

    // 에러 처리
    socket.on('error', (error) => {
      console.error('전투 에러:', error);
      toast.error(error.message);
    });

  }, [battleState.myRole, uiState.soundEnabled]);

  // ===========================================
  // 액션 함수들
  // ===========================================

  const executeAction = useCallback(async (action) => {
    if (!socketRef.current?.connected) {
      throw new Error('서버에 연결되지 않았습니다');
    }

    if (!battleState.myTurn) {
      throw new Error('당신의 턴이 아닙니다');
    }

    console.log('액션 실행:', action);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('액션 실행 시간 초과'));
      }, 5000);

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
      socketRef.current.emit('player_action', action);
    });
  }, [battleState.myTurn]);

  const attack = useCallback(async () => {
    return executeAction({ type: 'attack' });
  }, [executeAction]);

  const defend = useCallback(async () => {
    return executeAction({ type: 'defend' });
  }, [executeAction]);

  const surrender = useCallback(async () => {
    if (window.confirm('정말로 항복하시겠습니까?')) {
      return executeAction({ type: 'surrender' });
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
      if (!battleState.myTurn || battleState.status !== 'active') return;

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
          surrender().catch(console.error);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [attack, defend, surrender, battleState.myTurn, battleState.status]);

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

    // 액션 함수들
    executeAction,
    attack,
    defend,
    surrender,

    // 유틸리티 함수들
    clearDamageNumber,
    toggleSound,
    reconnect,
    disconnect,

    // 계산된 값들
    myCharacter: battleState.participants[battleState.myRole],
    enemyCharacter: battleState.participants[battleState.myRole === 'A' ? 'B' : 'A'],
    canAct: battleState.myTurn && battleState.status === 'active' && connectionState.connected
  };
};

export default useBattle;
