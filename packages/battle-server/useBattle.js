// useBattle.js
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

/**
 * Pyxis 전투 클라이언트 훅 (풀버전)
 * - 서버 소켓 이벤트와 호환: adminAuth / playerAuth / spectatorAuth, battleUpdate, actionSuccess, actionError
 * - 엔진 액션: attack / defend(가드 대상 지원) / dodge / riposte / item / pass / ready
 * - 역할별 권한 반영, 턴/행동 가능 여부 자동 계산
 *
 * @param {string} battleId         전투 ID (필수)
 * @param {string} otp              OTP(플레이어/관리자/관전자)
 * @param {Object} options
 *  - role: 'player' | 'spectator' | 'admin' (기본 'player')
 *  - socketUrl: 소켓 엔드포인트 (기본 window.origin)
 *  - path: 소켓 경로 (서버는 '/socket.io/' 사용) => 기본 '/socket.io/'
 *  - playerId: 플레이어 ID(플레이어일 때 권장)
 *  - name: 관전자명(관전자일 때 옵션)
 *  - team: 클라이언트에서 미리 알고 있는 팀키('team1'|'team2') (선택)
 *  - reconnect: { attempts, delay, delayMax }
 */
const useBattle = (battleId, otp, options = {}) => {
  const {
    role = 'player',
    socketUrl = (typeof window !== 'undefined' ? window.location.origin : (process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001')),
    path = '/socket.io/',
    playerId: optPlayerId,
    name: optName,
    team: optTeam,
    reconnect = { attempts: 5, delay: 1000, delayMax: 5000 },
  } = options;

  // ─────────────────────────────────────────────────────────
  // 상태
  // ─────────────────────────────────────────────────────────
  const [battle, setBattle] = useState(null);  // 서버 battle 객체 그대로 저장
  const [battleLog, setBattleLog] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState(null);

  const [myPlayerId, setMyPlayerId] = useState(optPlayerId || null);
  const [myRole, setMyRole] = useState(role);
  const [myName, setMyName] = useState(optName || (role === 'spectator' ? '관전자' : null));

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showBattleLog, setShowBattleLog] = useState(true);
  const [showDamageNumbers, setShowDamageNumbers] = useState([]);

  // ─────────────────────────────────────────────────────────
  // Refs
  // ─────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const cooldownRef = useRef(null);

  // ─────────────────────────────────────────────────────────
  // 파생 값들
  // ─────────────────────────────────────────────────────────
  const players = useMemo(() => {
    if (!battle) return [];
    const t1 = battle?.teams?.team1?.players || [];
    const t2 = battle?.teams?.team2?.players || [];
    return [...t1, ...t2];
  }, [battle]);

  const myPlayer = useMemo(() => {
    if (!myPlayerId) return null;
    return players.find(p => p.id === myPlayerId) || null;
  }, [players, myPlayerId]);

  const myTeamKey = useMemo(() => {
    if (optTeam) return optTeam;
    if (myPlayer) return myPlayer.team;
    return null;
  }, [optTeam, myPlayer]);

  const gameState = useMemo(() => {
    if (!battle) return 'idle';
    if (battle.status === 'waiting') return 'waiting';
    if (battle.status === 'ongoing') return 'active';
    if (battle.status === 'ended') return 'finished';
    return 'unknown';
  }, [battle]);

  const isMyTurn = useMemo(() => {
    if (!battle || !myPlayer) return false;
    if (battle.status !== 'ongoing') return false;
    if (battle.currentTeam !== myPlayer.team) return false;
    if (!myPlayer.alive) return false;
    return !myPlayer.hasActed; // 내 팀 차례이며 아직 행동 안했으면 true
  }, [battle, myPlayer]);

  const canPerformAction = useMemo(() => {
    if (myRole !== 'player') return false;
    if (!battle || !myPlayer) return false;
    if (battle.status !== 'ongoing') return false;
    if (!isMyTurn) return false;
    return true;
  }, [battle, myPlayer, myRole, isMyTurn]);

  // ─────────────────────────────────────────────────────────
  // 내부 유틸
  // ─────────────────────────────────────────────────────────
  const unifyBattlePayload = (payload) => {
    // 서버는 battleUpdate에 battle 객체 자체를 보내거나, {battle: ...} 형태를 보낼 수 있음
    if (!payload) return null;
    if (payload?.battle) return payload.battle;
    return payload;
    // (socket/battleSocket.js의 battle-state 이벤트는 { state }였지만,
    //  여기서는 battleUpdate만 사용)
  };

  const toastErr = (msg) => toast.error(typeof msg === 'string' ? msg : '에러가 발생했습니다');

  // ─────────────────────────────────────────────────────────
  // 소켓 연결 & 인증
  // ─────────────────────────────────────────────────────────
  const connectSocket = useCallback(() => {
    if (!battleId) {
      setConnError('battleId가 없습니다');
      return null;
    }
    if (socketRef.current?.connected) return socketRef.current;

    setConnecting(true);
    setConnError(null);

    const socket = io(socketUrl, {
      path,
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: reconnect.attempts ?? 5,
      reconnectionDelay: reconnect.delay ?? 1000,
      reconnectionDelayMax: reconnect.delayMax ?? 5000,
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setConnecting(false);
      setConnError(null);
      // 역할별 인증
      try {
        if (myRole === 'admin') {
          socket.emit('adminAuth', { battleId, otp });
        } else if (myRole === 'spectator') {
          socket.emit('spectatorAuth', { battleId, otp, spectatorName: myName || '관전자' });
        } else {
          // player
          if (!optPlayerId) {
            // 플레이어 ID가 아직 없다면, 서버가 authSuccess로 player를 내려줘야 함
            socket.emit('playerAuth', { battleId, otp, playerId: null });
          } else {
            socket.emit('playerAuth', { battleId, otp, playerId: optPlayerId });
          }
        }
      } catch (e) {
        console.error('auth emit error', e);
      }
      toast.success('서버에 연결되었습니다!');
    });

    socket.on('connect_error', (err) => {
      setConnected(false);
      setConnecting(false);
      setConnError(err?.message || '연결 실패');
      toastErr(`연결 실패: ${err?.message || ''}`);
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      setConnecting(false);
      if (reason === 'io server disconnect') {
        toastErr('서버와의 연결이 종료되었습니다');
      } else {
        toast('연결이 끊어졌습니다. 재연결 시도 중…');
      }
    });

    // 인증 결과
    socket.on('authSuccess', (payload) => {
      const roleFromServer = payload?.role || myRole;
      setMyRole(roleFromServer);
      const b = unifyBattlePayload(payload);
      const merged = b || payload?.battle || null;
      if (merged) {
        setBattle(merged);
        setBattleLog(merged.battleLog || []);
      }
      if (payload?.player?.id && !myPlayerId) {
        setMyPlayerId(payload.player.id);
      }
    });

    socket.on('authError', (msg) => {
      setConnError(msg || '인증 실패');
      toastErr(`인증 실패: ${msg || ''}`);
    });

    // 실시간 전투 갱신
    socket.on('battleUpdate', (data) => {
      const b = unifyBattlePayload(data);
      if (!b) return;
      setBattle(b);
      setBattleLog(b.battleLog || []);
    });

    // 공지 핀 업데이트(선택)
    socket.on('noticeUpdate', ({ text }) => {
      setBattle(prev => (prev ? { ...prev, notice: { ...(prev.notice || {}), text } } : prev));
    });

    // 액션 응답
    socket.on('actionSuccess', (result) => {
      // 서버 구현에 따라 result가 없을 수 있음
      // 다음 battleUpdate에서 상태가 반영되므로 여기서는 안내만
      if (result?.message) toast.success(result.message);
    });

    socket.on('actionError', (msg) => {
      toastErr(msg || '행동 실행 실패');
    });

    return socket;
  }, [battleId, otp, socketUrl, path, reconnect.attempts, reconnect.delay, reconnect.delayMax, myRole, myName, optPlayerId, myPlayerId]);

  // ─────────────────────────────────────────────────────────
  // 액션 송신
  // ─────────────────────────────────────────────────────────
  const emitAction = useCallback((action) => {
    const s = socketRef.current;
    if (!s?.connected) return toastErr('서버에 연결되어 있지 않습니다.');
    if (myRole !== 'player') return toastErr('플레이어만 행동할 수 있습니다.');
    if (!myPlayerId) return toastErr('플레이어 ID가 없습니다.');

    // 서버 규격: { battleId, playerId, action }
    s.emit('playerAction', { battleId, playerId: myPlayerId, action });
  }, [battleId, myPlayerId, myRole]);

  // 편의 액션들
  const ready = useCallback(() => {
    emitAction({ type: 'ready' });
  }, [emitAction]);

  const attack = useCallback((targetId) => {
    if (!targetId) return toastErr('공격 대상이 필요합니다.');
    emitAction({ type: 'attack', targetId });
  }, [emitAction]);

  const defend = useCallback((guardTargetId = null) => {
    // 가드: 아군 targetId 지정 가능, 자기 자신 방어시 null
    emitAction({ type: 'defend', targetId: guardTargetId || undefined });
  }, [emitAction]);

  const dodge = useCallback(() => {
    emitAction({ type: 'dodge' });
  }, [emitAction]);

  const riposte = useCallback(() => {
    emitAction({ type: 'riposte' });
  }, [emitAction]);

  const useItem = useCallback((itemType, targetId = null) => {
    if (!itemType) return toastErr('아이템 타입이 필요합니다.');
    emitAction({ type: 'item', itemType, targetId: targetId || undefined });
  }, [emitAction]);

  const passTurn = useCallback(() => {
    emitAction({ type: 'pass' });
  }, [emitAction]);

  // (선택) 항복 처리: 엔진에 없음 → pass로 대체하거나 서버 쪽 구현 시 교체
  const surrender = useCallback(() => {
    if (window.confirm('정말로 항복하시겠습니까?')) passTurn();
  }, [passTurn]);

  // ─────────────────────────────────────────────────────────
  // UI 유틸
  // ─────────────────────────────────────────────────────────
  const clearDamageNumber = useCallback((id) => {
    setShowDamageNumbers(prev => prev.filter(d => d.id !== id));
  }, []);

  const toggleLog = useCallback(() => setShowBattleLog(v => !v), []);
  const toggleSound = useCallback(() => {
    setSoundEnabled((v) => {
      toast(v ? '사운드 꺼짐' : '사운드 켜짐');
      return !v;
    });
  }, []);

  // ─────────────────────────────────────────────────────────
  // 단축키 (예시)
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!canPerformAction) return;
      if (e.key === '2') { e.preventDefault(); defend(); }
      if (e.key === '3') { e.preventDefault(); dodge(); }
      if (e.key === '4') { e.preventDefault(); riposte(); }
      // 공격(1)은 타겟 선택 UI가 보통 필요하니 훅 외부에서 처리 권장
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPerformAction, defend, dodge, riposte]);

  // ─────────────────────────────────────────────────────────
  // 연결/해제
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const s = connectSocket();
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      try { s?.disconnect(); } catch (_) {}
      socketRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId, otp, myRole, myPlayerId, socketUrl, path]);

  // ─────────────────────────────────────────────────────────
  // 반환
  // ─────────────────────────────────────────────────────────
  return {
    // 연결 상태
    connected, connecting, connError,

    // 전투 스냅샷
    battle,
    battleLog,
    status: battle?.status || 'unknown',
    roundNumber: battle?.roundNumber ?? null,
    turnNumber: battle?.turnNumber ?? null,
    currentTeam: battle?.currentTeam || null,
    turnDeadline: battle?.turnDeadline || null,
    winner: battle?.winner || null,

    // 플레이어
    players,
    myPlayer,
    myPlayerId,
    myTeamKey,
    role: myRole,

    // 파생
    gameState,
    isMyTurn,
    canPerformAction,

    // UI
    showBattleLog,
    soundEnabled,
    showDamageNumbers,

    // 액션
    ready,
    attack,
    defend,       // defend(allyId?) → 가드
    dodge,
    riposte,
    useItem,
    passTurn,
    surrender,

    // UI 토글
    clearDamageNumber,
    toggleBattleLog: toggleLog,
    toggleSound,

    // 재연결 트리거
    reconnect: connectSocket,
  };
};

export default useBattle;
