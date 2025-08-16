import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const useBattle = (apiUrl = 'http://localhost:3001') => {
  // 연결 상태
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState(null);
  
  // 배틀 상태
  const [battleState, setBattleState] = useState({
    id: null,
    mode: null,
    status: 'waiting', // waiting, ready, initiative, in_progress, finished
    teams: { team1: [], team2: [] },
    currentPlayer: null,
    currentTurn: 0,
    round: 1,
    battleLogs: [],
    initiativeRolls: null,
    settings: {}
  });
  
  // 플레이어 상태
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [myTeam, setMyTeam] = useState(null);
  const [myPosition, setMyPosition] = useState(null);
  
  // 액션 상태
  const [targetSelection, setTargetSelection] = useState({
    isSelecting: false,
    action: null,
    availableTargets: [],
    selectedTargets: [],
    maxTargets: 1
  });
  
  // 채팅 상태
  const [chatMessages, setChatMessages] = useState([]);
  
  // 팀 이름 템플릿 상태
  const [availableTeamNameTemplates, setAvailableTeamNameTemplates] = useState([]);
  
  // Socket.IO 참조
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Socket.IO 연결 초기화
  const initializeSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setIsConnecting(true);
    setConnectionError(null);

    const socket = io(apiUrl, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true
    });

    socketRef.current = socket;

    // 연결 이벤트
    socket.on('connect', () => {
      console.log('소켓 연결됨:', socket.id);
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionError(null);
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('소켓 연결 끊김:', reason);
      setIsConnected(false);
      
      if (reason === 'io server disconnect') {
        // 서버에서 강제로 끊은 경우 재연결 시도
        reconnectTimeoutRef.current = setTimeout(() => {
          initializeSocket();
        }, 3000);
      }
    });

    socket.on('connect_error', (error) => {
      console.error('소켓 연결 오류:', error);
      setIsConnecting(false);
      setConnectionError(error.message || '서버에 연결할 수 없습니다');
    });

    // 배틀 이벤트
    socket.on('battle_created', (data) => {
      console.log('배틀 생성됨:', data);
      setBattleState(prev => ({
        ...prev,
        id: data.battleId,
        mode: data.mode,
        status: 'waiting'
      }));
    });

    socket.on('battle_joined', (data) => {
      console.log('배틀 참가됨:', data);
      setCurrentPlayer(data.player);
      setMyTeam(data.team);
      setMyPosition(data.position);
    });

    socket.on('battle_updated', (data) => {
      console.log('배틀 업데이트:', data);
      setBattleState(data.battle);
    });

    socket.on('battle_started', (data) => {
      console.log('배틀 시작:', data);
      setBattleState(prev => ({
        ...prev,
        status: 'in_progress',
        ...data
      }));
    });

    socket.on('initiative_rolled', (data) => {
      console.log('선후공 결정:', data);
      setBattleState(prev => ({
        ...prev,
        status: 'initiative',
        initiativeRolls: data.rolls
      }));
    });

    socket.on('turn_started', (data) => {
      console.log('턴 시작:', data);
      setBattleState(prev => ({
        ...prev,
        currentPlayer: data.currentPlayer,
        currentTurn: data.turn
      }));
    });

    socket.on('action_result', (data) => {
      console.log('액션 결과:', data);
      setBattleState(prev => ({
        ...prev,
        ...data.battleState
      }));
      
      // 타겟 선택 초기화
      setTargetSelection({
        isSelecting: false,
        action: null,
        availableTargets: [],
        selectedTargets: [],
        maxTargets: 1
      });
    });

    socket.on('battle_finished', (data) => {
      console.log('배틀 종료:', data);
      setBattleState(prev => ({
        ...prev,
        status: 'finished',
        winner: data.winner
      }));
    });

    socket.on('target_selection_required', (data) => {
      console.log('타겟 선택 필요:', data);
      setTargetSelection({
        isSelecting: true,
        action: data.action,
        availableTargets: data.availableTargets,
        selectedTargets: [],
        maxTargets: data.maxTargets || 1
      });
    });

    socket.on('error', (error) => {
      console.error('소켓 에러:', error);
      setConnectionError(error.message);
    });

    // 채팅 이벤트
    socket.on('chat_message', (data) => {
      console.log('채팅 메시지 수신:', data);
      setChatMessages(prev => [...prev, {
        ...data,
        timestamp: data.timestamp || Date.now()
      }]);
    });

    socket.on('system_message', (data) => {
      console.log('시스템 메시지:', data);
      setChatMessages(prev => [...prev, {
        type: 'system',
        text: data.message,
        timestamp: Date.now()
      }]);
    });

    return socket;
  }, [apiUrl]);

  // 초기화
  useEffect(() => {
    const socket = initializeSocket();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socket) {
        socket.disconnect();
      }
    };
  }, [initializeSocket]);

  // 배틀 생성
  const createBattle = useCallback((mode, settings = {}) => {
    if (!socketRef.current) return;
    
    console.log('배틀 생성 요청:', { mode, settings });
    socketRef.current.emit('create_battle', { mode, settings });
  }, []);

  // 배틀 참가
  const joinBattle = useCallback((battleId, playerData, teamItems = {}) => {
    if (!socketRef.current) return;
    
    console.log('배틀 참가 요청:', { battleId, playerData, teamItems });
    socketRef.current.emit('join_battle', {
      battleId,
      player: playerData,
      teamItems: teamItems
    });
  }, []);

  // 공격
  const attack = useCallback((targets = []) => {
    if (!socketRef.current || !canAct) return Promise.reject('액션을 실행할 수 없습니다');
    
    return new Promise((resolve, reject) => {
      const action = {
        type: 'attack',
        targets: targets.length > 0 ? targets : undefined
      };
      
      console.log('공격 액션:', action);
      socketRef.current.emit('execute_action', { action });
      
      // 타겟이 필요한 경우 타겟 선택 모드로 전환될 것임
      resolve();
    });
  }, []);

  // 방어
  const defend = useCallback(() => {
    if (!socketRef.current || !canAct) return Promise.reject('액션을 실행할 수 없습니다');
    
    return new Promise((resolve, reject) => {
      const action = { type: 'defend' };
      
      console.log('방어 액션:', action);
      socketRef.current.emit('execute_action', { action });
      resolve();
    });
  }, []);

  // 회피
  const dodge = useCallback(() => {
    if (!socketRef.current || !canAct) return Promise.reject('액션을 실행할 수 없습니다');
    
    return new Promise((resolve, reject) => {
      const action = { type: 'dodge' };
      
      console.log('회피 액션:', action);
      socketRef.current.emit('execute_action', { action });
      resolve();
    });
  }, []);

  // 타겟 선택 관련
  const toggleTarget = useCallback((targetId) => {
    setTargetSelection(prev => {
      const isSelected = prev.selectedTargets.includes(targetId);
      let newSelected;
      
      if (isSelected) {
        newSelected = prev.selectedTargets.filter(id => id !== targetId);
      } else {
        if (prev.selectedTargets.length < prev.maxTargets) {
          newSelected = [...prev.selectedTargets, targetId];
        } else {
          // 최대 개수 초과 시 첫 번째 선택을 제거하고 새로운 것 추가
          newSelected = [...prev.selectedTargets.slice(1), targetId];
        }
      }
      
      return {
        ...prev,
        selectedTargets: newSelected
      };
    });
  }, []);

  const confirmTargetSelection = useCallback(() => {
    if (!socketRef.current || targetSelection.selectedTargets.length === 0) return;
    
    const action = {
      type: targetSelection.action.type,
      targets: targetSelection.selectedTargets
    };
    
    console.log('타겟 선택 확인:', action);
    socketRef.current.emit('execute_action', { action });
  }, [targetSelection]);

  const cancelTargetSelection = useCallback(() => {
    setTargetSelection({
      isSelecting: false,
      action: null,
      availableTargets: [],
      selectedTargets: [],
      maxTargets: 1
    });
  }, []);

  // 채팅 메시지 전송
  const sendChatMessage = useCallback((message) => {
    if (!socketRef.current || !message.trim()) return;
    
    console.log('채팅 메시지 전송:', message);
    socketRef.current.emit('chat_message', {
      text: message.trim(),
      timestamp: Date.now()
    });
  }, []);

  // 계산된 상태들
  const isInBattle = battleState.id !== null;
  const isMyTurn = currentPlayer && battleState.currentPlayer?.id === currentPlayer.id;
  const canAct = isMyTurn && battleState.status === 'in_progress' && !targetSelection.isSelecting;
  
  const teamMates = myTeam && battleState.teams[myTeam] 
    ? battleState.teams[myTeam].filter(player => player.id !== currentPlayer?.id)
    : [];
    
  const enemies = myTeam 
    ? battleState.teams[myTeam === 'team1' ? 'team2' : 'team1'] || []
    : [];

  // 디버깅용 로그
  useEffect(() => {
    console.log('useBattle 상태 업데이트:', {
      isConnected,
      isInBattle,
      battleStatus: battleState.status,
      myTeam,
      currentPlayer: currentPlayer?.name,
      isMyTurn,
      canAct,
      chatMessagesCount: chatMessages.length
    });
  }, [isConnected, isInBattle, battleState.status, myTeam, currentPlayer, isMyTurn, canAct, chatMessages.length]);

  return {
    // 연결 상태
    isConnected,
    isConnecting,
    connectionError,
    
    // 배틀 상태
    battleState,
    isInBattle,
    myTeam,
    myPosition,
    currentPlayer,
    
    // 턴 및 액션
    isMyTurn,
    canAct,
    targetSelection,
    
    // 팀 정보
    teamMates,
    enemies,
    
    // 액션 함수들
    createBattle,
    joinBattle,
    attack,
    defend,
    dodge,
    
    // 타겟 선택
    toggleTarget,
    confirmTargetSelection,
    cancelTargetSelection,
    
    // 채팅
    chatMessages,
    sendChatMessage,
    
    // 유틸리티
    socket: socketRef.current
  };
};

export default useBattle;
