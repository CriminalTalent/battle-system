import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

/**
 * 전투 시스템 통합 관리 훅
 * 
 * @param {string} battleId - 전투 ID
 * @param {string} token - 인증 토큰
 * @param {Object} options - 설정 옵션
 */
const useBattle = (battleId, token, options = {}) => {
  // ===========================================
  // 상태 관리
  // ===========================================
  
  const [battleState, setBattleState] = useState({
    battle: null,
    players: [],
    currentPlayer: null,
    spectators: [],
    battleLog: [],
    gameState: 'waiting', // waiting, active, finished, error
    winner: null,
    error: null
  });

  const [connectionState, setConnectionState] = useState({
    connected: false,
    connecting: false,
    error: null,
    reconnectAttempts: 0
  });

  const [playerState, setPlayerState] = useState({
    playerId: null,
    isSpectator: false,
    isCurrentTurn: false,
    canAct: false,
    selectedAction: null,
    actionCooldown: false
  });

  const [uiState, setUiState] = useState({
    showDamageNumbers: [],
    showBattleLog: true,
    soundEnabled: true,
    animationsEnabled: true,
    compactMode: false
  });

  // ===========================================
  // Refs
  // ===========================================
  
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const actionCooldownRef = useRef(null);
  const battleLogRef = useRef(null);

  // ===========================================
  // 소켓 연결 관리
  // ===========================================

  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return;

    setConnectionState(prev => ({ ...prev, connecting: true, error: null }));

    const socket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001', {
      auth: { token },
      query: { battleId },
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
      toast.success('전투에 연결되었습니다!');
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
      toast.error('연결에 실패했습니다: ' + error.message);
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
      } else {
        toast.error('연결이 끊어졌습니다. 재연결 중...');
      }
    });

    // 재연결 시도
    socket.on('reconnect', (attemptNumber) => {
      console.log('재연결 성공:', attemptNumber);
      toast.success('재연결되었습니다!');
    });

    // 재연결 실패
    socket.on('reconnect_failed', () => {
      console.log('재연결 실패');
      toast.error('재연결에 실패했습니다');
    });

    return socket;
  }, [battleId, token]);

  // ===========================================
  // 전투 이벤트 핸들러
  // ===========================================

  const setupBattleEvents = useCallback((socket) => {
    // 전투 상태 업데이트
    socket.on('battleUpdate', (data) => {
      console.log('전투 업데이트:', data);
      setBattleState(prev => ({
        ...prev,
        battle: data.battle,
        players: data.players,
        currentPlayer: data.currentPlayer,
        gameState: data.gameState
      }));
    });

    // 플레이어 참가
    socket.on('playerJoined', (data) => {
      console.log('플레이어 참가:', data);
      setBattleState(prev => ({
        ...prev,
        players: data.players
      }));
      toast.success(`${data.player.name}님이 참가했습니다`);
    });

    // 플레이어 퇴장
    socket.on('playerLeft', (data) => {
      console.log('플레이어 퇴장:', data);
      setBattleState(prev => ({
        ...prev,
        players: data.players
      }));
      toast(`${data.player.name}님이 퇴장했습니다`);
    });

    // 턴 시작
    socket.on('turnStart', (data) => {
      console.log('턴 시작:', data);
      setBattleState(prev => ({
        ...prev,
        currentPlayer: data.currentPlayer
      }));
      
      setPlayerState(prev => ({
        ...prev,
        isCurrentTurn: data.currentPlayer?.id === prev.playerId,
        canAct: data.currentPlayer?.id === prev.playerId
      }));

      if (data.currentPlayer?.id === playerState.playerId) {
        toast('당신의 턴입니다!', { icon: '⚔️' });
      }
    });

    // 액션 결과
    socket.on('actionResult', (data) => {
      console.log('액션 결과:', data);
      
      // 전투 로그 추가
      setBattleState(prev => ({
        ...prev,
        battleLog: [...prev.battleLog, data.logEntry],
        players: data.players
      }));

      // 데미지 숫자 표시
      if (data.damage > 0) {
        setUiState(prev => ({
          ...prev,
          showDamageNumbers: [
            ...prev.showDamageNumbers,
            {
              id: Date.now(),
              damage: data.damage,
              isCritical: data.isCritical,
              targetId: data.targetId,
              timestamp: Date.now()
            }
          ]
        }));
      }

      // 사운드 효과 (옵션)
      if (uiState.soundEnabled && data.soundEffect) {
        playSound(data.soundEffect);
      }
    });

    // 전투 종료
    socket.on('battleEnd', (data) => {
      console.log('전투 종료:', data);
      setBattleState(prev => ({
        ...prev,
        gameState: 'finished',
        winner: data.winner,
        battleLog: [...prev.battleLog, data.logEntry]
      }));

      if (data.winner) {
        toast.success(`${data.winner.name}님이 승리했습니다!`, {
          duration: 5000,
          icon: '🏆'
        });
      } else {
        toast('무승부입니다!', { icon: '🤝' });
      }
    });

    // 에러 처리
    socket.on('error', (error) => {
      console.error('전투 에러:', error);
      setBattleState(prev => ({
        ...prev,
        error: error.message
      }));
      toast.error(error.message);
    });

    // 플레이어 정보 설정
    socket.on('playerInfo', (data) => {
      console.log('플레이어 정보:', data);
      setPlayerState(prev => ({
        ...prev,
        playerId: data.playerId,
        isSpectator: data.isSpectator
      }));
    });

  }, [playerState.playerId, uiState.soundEnabled]);

  // ===========================================
  // 액션 함수들
  // ===========================================

  const performAction = useCallback((actionType, target = null) => {
    if (!socketRef.current?.connected) {
      toast.error('서버에 연결되지 않았습니다');
      return;
    }

    if (!playerState.canAct) {
      toast.error('지금은 행동할 수 없습니다');
      return;
    }

    if (playerState.actionCooldown) {
      toast.error('잠시 후 다시 시도하세요');
      return;
    }

    console.log('액션 수행:', actionType, target);
    
    socketRef.current.emit('playerAction', {
      action: actionType,
      target: target
    });

    // 액션 쿨다운 설정
    setPlayerState(prev => ({ ...prev, actionCooldown: true, canAct: false }));
    
    actionCooldownRef.current = setTimeout(() => {
      setPlayerState(prev => ({ ...prev, actionCooldown: false }));
    }, 1000);

  }, [playerState.canAct, playerState.actionCooldown]);

  const attack = useCallback((target = null) => {
    performAction('attack', target);
  }, [performAction]);

  const defend = useCallback(() => {
    performAction('defend');
  }, [performAction]);

  const surrender = useCallback(() => {
    if (window.confirm('정말로 항복하시겠습니까?')) {
      performAction('surrender');
    }
  }, [performAction]);

  // ===========================================
  // 유틸리티 함수들
  // ===========================================

  const playSound = useCallback((soundType) => {
    if (!uiState.soundEnabled) return;
    
    // 사운드 파일 재생 로직 (실제 구현 시 추가)
    console.log('사운드 재생:', soundType);
  }, [uiState.soundEnabled]);

  const clearDamageNumber = useCallback((id) => {
    setUiState(prev => ({
      ...prev,
      showDamageNumbers: prev.showDamageNumbers.filter(num => num.id !== id)
    }));
  }, []);

  const toggleBattleLog = useCallback(() => {
    setUiState(prev => ({
      ...prev,
      showBattleLog: !prev.showBattleLog
    }));
  }, []);

  const toggleSound = useCallback(() => {
    setUiState(prev => ({
      ...prev,
      soundEnabled: !prev.soundEnabled
    }));
    toast(uiState.soundEnabled ? '사운드 꺼짐' : '사운드 켜짐');
  }, [uiState.soundEnabled]);

  // ===========================================
  // 키보드 단축키
  // ===========================================

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!playerState.canAct) return;

      switch (event.key) {
        case '1':
          event.preventDefault();
          attack();
          break;
        case '2':
          event.preventDefault();
          defend();
          break;
        case 'Tab':
          event.preventDefault();
          toggleBattleLog();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [attack, defend, toggleBattleLog, playerState.canAct]);

  // ===========================================
  // 초기화 및 정리
  // ===========================================

  useEffect(() => {
    const socket = connectSocket();
    if (socket) {
      setupBattleEvents(socket);
    }

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
  }, [connectSocket, setupBattleEvents]);

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
    // 상태
    ...battleState,
    ...connectionState,
    ...playerState,
    ...uiState,

    // 액션 함수들
    attack,
    defend,
    surrender,
    performAction,

    // 유틸리티 함수들
    clearDamageNumber,
    toggleBattleLog,
    toggleSound,
    reconnect: connectSocket,

    // 계산된 값들
    isMyTurn: playerState.isCurrentTurn,
    canPerformAction: playerState.canAct && !playerState.actionCooldown,
    myPlayer: battleState.players.find(p => p.id === playerState.playerId),
    enemyPlayer: battleState.players.find(p => p.id !== playerState.playerId),
  };
};

export default useBattle;
