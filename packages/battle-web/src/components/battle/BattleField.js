'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import CharacterCard from './CharacterCard';
import ActionPanel from './ActionPanel';
import BattleLog from './BattleLog';
import TurnIndicator from './TurnIndicator';
import LoadingSpinner from '../shared/LoadingSpinner';
import { useBattle } from '@/hooks/useBattle';
import { BATTLE_STATUS } from '@/utils/constants';

export default function BattleField({ token, isSpectator = false }) {
  const {
    battleState,
    connected,
    connectionError,
    isReconnecting,
    executeAction,
    reconnect,
    disconnect
  } = useBattle(token, isSpectator);

  const [selectedAction, setSelectedAction] = useState(null);
  const [animationQueue, setAnimationQueue] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showMobileControls, setShowMobileControls] = useState(false);
  
  const battleFieldRef = useRef(null);
  const lastLogCountRef = useRef(0);

  // 화면 크기 감지
  useEffect(() => {
    const checkMobile = () => {
      setShowMobileControls(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 새 로그 감지 및 애니메이션
  useEffect(() => {
    if (!battleState?.battleLog) return;
    
    const currentLogCount = battleState.battleLog.length;
    if (currentLogCount > lastLogCountRef.current) {
      const newLogs = battleState.battleLog.slice(lastLogCountRef.current);
      newLogs.forEach(log => {
        if (log.type === 'attack' && log.hit) {
          triggerDamageAnimation(log);
        }
        if (soundEnabled) {
          playSound(log.type);
        }
      });
    }
    lastLogCountRef.current = currentLogCount;
  }, [battleState?.battleLog, soundEnabled]);

  // 키보드 단축키
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!battleState || !battleState.myTurn || isSpectator) return;
      
      switch (e.key) {
        case '1':
          handleQuickAction({ type: 'attack' });
          break;
        case '2':
          handleQuickAction({ type: 'defend' });
          break;
        case 'Escape':
          setSelectedAction(null);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [battleState, isSpectator]);

  const triggerDamageAnimation = (logEntry) => {
    const animation = {
      id: Date.now(),
      type: 'damage',
      target: logEntry.defender,
      damage: logEntry.damage,
      critical: logEntry.critical
    };
    
    setAnimationQueue(prev => [...prev, animation]);
    
    // 애니메이션 제거
    setTimeout(() => {
      setAnimationQueue(prev => prev.filter(a => a.id !== animation.id));
    }, 2000);
  };

  const playSound = (type) => {
    // 실제 구현에서는 Audio API 사용
    const audio = new Audio(`/sounds/sfx/${type}.mp3`);
    audio.volume = 0.3;
    audio.play().catch(() => {}); // 자동재생 정책으로 인한 에러 무시
  };

  const handleQuickAction = async (action) => {
    if (!battleState?.myTurn || isSpectator) return;
    
    try {
      await executeAction(action);
    } catch (error) {
      toast.error('액션 실행 실패: ' + error.message);
    }
  };

  const handleActionSelect = async (action) => {
    if (!action) return;
    
    try {
      setSelectedAction(null);
      await executeAction(action);
      toast.success('액션이 실행되었습니다');
    } catch (error) {
      toast.error('액션 실행 실패: ' + error.message);
    }
  };

  const handleReconnect = () => {
    toast.loading('재연결 중...', { id: 'reconnect' });
    reconnect()
      .then(() => {
        toast.success('재연결되었습니다', { id: 'reconnect' });
      })
      .catch(() => {
        toast.error('재연결에 실패했습니다', { id: 'reconnect' });
      });
  };

  // 연결 상태 확인
  if (!connected && !isReconnecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center p-8 bg-black/20 rounded-lg backdrop-blur-sm">
          <LoadingSpinner className="w-16 h-16 mx-auto mb-4" />
          <h2 className="text-white text-2xl mb-4">전투에 연결하는 중...</h2>
          {connectionError && (
            <div className="mt-4 p-4 bg-red-500/20 rounded-lg">
              <p className="text-red-300 mb-3">{connectionError}</p>
              <button 
                onClick={handleReconnect}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                다시 연결
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 재연결 중
  if (isReconnecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center p-8 bg-black/20 rounded-lg backdrop-blur-sm">
          <LoadingSpinner className="w-16 h-16 mx-auto mb-4" />
          <h2 className="text-white text-2xl mb-4">재연결 중...</h2>
          <p className="text-gray-300">잠시만 기다려주세요</p>
        </div>
      </div>
    );
  }

  // 전투 데이터 없음
  if (!battleState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center p-8 bg-black/20 rounded-lg backdrop-blur-sm">
          <h2 className="text-white text-2xl mb-4">전투를 찾을 수 없습니다</h2>
          <p className="text-gray-300 mb-4">올바른 링크인지 확인해주세요</p>
          <button 
            onClick={() => window.location.href = '/'}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            메인으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 관람자 뷰
  if (isSpectator) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="container mx-auto p-4">
          <h1 className="text-white text-2xl mb-4">전투 관람</h1>
          {/* 관람자용 UI 구현 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="flex justify-between mb-4">
                <CharacterCard character={battleState.participants.A} />
                <CharacterCard character={battleState.participants.B} />
              </div>
            </div>
            <div>
              <TurnIndicator 
                currentTurn={battleState.currentTurn}
                turnCount={battleState.turnCount}
                participantNames={{
                  A: battleState.participants.A.name,
                  B: battleState.participants.B.name
                }}
              />
              <BattleLog logs={battleState.battleLog} className="mt-4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { participants, currentTurn, myRole, myTurn, status } = battleState;
  const opponent = myRole === 'A' ? participants.B : participants.A;
  const myCharacter = participants[myRole];

  return (
    <div 
      ref={battleFieldRef}
      className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden"
    >
      {/* 상단 UI */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4">
        <div className="flex justify-between items-center">
          {/* 턴 표시 */}
          <TurnIndicator 
            currentTurn={currentTurn}
            myRole={myRole}
            myTurn={myTurn}
            turnCount={battleState.turnCount}
            turnStartTime={battleState.turnStartTime}
            turnTimeLimit={battleState.settings?.turnTimeLimit}
            participantNames={{
              A: participants.A.name,
              B: participants.B.name
            }}
          />
          
          {/* 설정 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              사운드
            </button>
            
            <button
              onClick={disconnect}
              className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors text-white"
            >
              나가기
            </button>
          </div>
        </div>
      </div>

      {/* 메인 전투 영역 */}
      <div className="relative h-screen flex">
        {/* 왼쪽 캐릭터 (상대) */}
        <div className="flex-1 flex items-center justify-start pl-8">
          <motion.div
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="relative"
          >
            <CharacterCard
              character={opponent}
              isOpponent={true}
              isActive={currentTurn !== myRole}
              animationQueue={animationQueue.filter(a => a.target === opponent.name)}
            />
          </motion.div>
        </div>

        {/* 중앙 전투 정보 */}
        <div className="flex-shrink-0 w-80 flex flex-col justify-center items-center relative">
          {/* 전투 상태 표시 */}
          <div className="mb-8 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="bg-black/30 backdrop-blur-sm rounded-lg p-4"
            >
              <h3 className="text-white text-xl mb-2">
                {status === BATTLE_STATUS.WAITING && '전투 대기 중'}
                {status === BATTLE_STATUS.ACTIVE && '전투 진행 중'}
                {status === BATTLE_STATUS.PAUSED && '일시정지'}
                {status === BATTLE_STATUS.ENDED && '전투 종료'}
              </h3>
              
              {status === BATTLE_STATUS.ACTIVE && (
                <p className="text-gray-300">
                  턴 {battleState.turnCount}
                </p>
              )}
            </motion.div>
          </div>

          {/* VS 표시 */}
          <motion.div
            initial={{ scale: 0, rotate: 180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="text-6xl font-bold text-white mb-8 drop-shadow-lg"
          >
            VS
          </motion.div>

          {/* 액션 패널 (모바일에서는 하단으로) */}
          {!showMobileControls && myTurn && status === BATTLE_STATUS.ACTIVE && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-black/30 backdrop-blur-sm rounded-lg p-4"
            >
              <ActionPanel
                character={myCharacter}
                onActionSelect={handleActionSelect}
                disabled={!myTurn}
              />
            </motion.div>
          )}
        </div>

        {/* 오른쪽 캐릭터 (나) */}
        <div className="flex-1 flex items-center justify-end pr-8">
          <motion.div
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="relative"
          >
            <CharacterCard
              character={myCharacter}
              isOpponent={false}
              isActive={currentTurn === myRole}
              animationQueue={animationQueue.filter(a => a.target === myCharacter.name)}
            />
          </motion.div>
        </div>
      </div>

      {/* 하단 전투 로그 */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-black/40 backdrop-blur-sm">
        <BattleLog 
          logs={battleState.battleLog}
          maxHeight="12rem"
        />
      </div>

      {/* 모바일 액션 패널 */}
      {showMobileControls && myTurn && status === BATTLE_STATUS.ACTIVE && (
        <div className="fixed bottom-52 left-0 right-0 p-4 bg-black/50 backdrop-blur-sm">
          <ActionPanel
            character={myCharacter}
            onActionSelect={handleActionSelect}
            disabled={!myTurn}
            isMobile={true}
          />
        </div>
      )}

      {/* 연결 상태 표시 */}
      {!connected && (
        <div className="fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg">
          연결 끊김
        </div>
      )}

      {/* 키보드 단축키 안내 */}
      <div className="fixed bottom-4 right-4 bg-black/50 backdrop-blur-sm text-white p-3 rounded-lg text-sm">
        <p className="mb-1">단축키:</p>
        <p>1: 공격 | 2: 방어</p>
      </div>
    </div>
  );
}