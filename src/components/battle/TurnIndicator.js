'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, User, Users, Zap } from 'lucide-react';

export default function TurnIndicator({
  currentTurn, // 'A' or 'B'
  myRole, // 'A' or 'B' 
  myTurn = false,
  turnCount = 1,
  turnStartTime = null,
  turnTimeLimit = 30000, // 30초
  participantNames = { A: 'Player A', B: 'Player B' },
  onTimeUp,
  compact = false
}) {
  const [timeRemaining, setTimeRemaining] = useState(turnTimeLimit);
  const [isUrgent, setIsUrgent] = useState(false);

  // 타이머 업데이트
  useEffect(() => {
    if (!turnStartTime) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - turnStartTime;
      const remaining = Math.max(0, turnTimeLimit - elapsed);
      
      setTimeRemaining(remaining);
      setIsUrgent(remaining <= 10000); // 10초 이하일 때 긴급 상태
      
      if (remaining === 0 && onTimeUp) {
        onTimeUp();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [turnStartTime, turnTimeLimit, onTimeUp]);

  // 시간을 초 단위로 변환
  const secondsRemaining = Math.ceil(timeRemaining / 1000);
  const progressPercentage = (timeRemaining / turnTimeLimit) * 100;

  // 현재 턴 플레이어 이름
  const currentPlayerName = participantNames[currentTurn] || `Player ${currentTurn}`;

  // 시간 진행률에 따른 색상
  const getTimeColor = () => {
    if (progressPercentage > 60) return 'text-green-400';
    if (progressPercentage > 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  // 프로그레스 바 색상
  const getProgressColor = () => {
    if (progressPercentage > 60) return 'bg-green-500';
    if (progressPercentage > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // 턴 변경 애니메이션 변형
  const turnChangeVariants = {
    hidden: { opacity: 0, scale: 0.8, y: -20 },
    visible: { 
      opacity: 1, 
      scale: 1, 
      y: 0,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 25
      }
    },
    exit: { 
      opacity: 0, 
      scale: 0.8, 
      y: 20,
      transition: { duration: 0.2 }
    }
  };

  // 긴급 상태 펄스 애니메이션
  const urgentPulse = {
    scale: [1, 1.05, 1],
    transition: {
      duration: 0.8,
      repeat: Infinity,
      ease: "easeInOut"
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-700">
        {/* 턴 표시 */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${myTurn ? 'bg-green-400' : 'bg-gray-500'}`} />
          <span className="text-sm text-white">
            {myTurn ? '내 턴' : `${currentPlayerName}의 턴`}
          </span>
        </div>
        
        {/* 시간 */}
        {turnStartTime && (
          <div className={`flex items-center gap-1 ${getTimeColor()}`}>
            <Clock className="w-3 h-3" />
            <span className="text-sm font-mono">{secondsRemaining}s</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div
      className={`
        bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-700 p-4
        ${isUrgent ? 'border-red-500/50' : ''}
      `}
      animate={isUrgent ? urgentPulse : {}}
    >
      {/* 상단: 턴 정보 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* 턴 아이콘 */}
          <motion.div
            key={currentTurn}
            variants={turnChangeVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`
              p-2 rounded-full 
              ${myTurn ? 'bg-green-600' : 'bg-blue-600'}
            `}
          >
            {myTurn ? <User className="w-5 h-5 text-white" /> : <Users className="w-5 h-5 text-white" />}
          </motion.div>
          
          {/* 턴 정보 텍스트 */}
          <div>
            <AnimatePresence mode="wait">
              <motion.h3
                key={`${currentTurn}-${myTurn}`}
                variants={turnChangeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className={`
                  font-bold text-lg
                  ${myTurn ? 'text-green-400' : 'text-white'}
                `}
              >
                {myTurn ? '당신의 턴' : `${currentPlayerName}의 턴`}
              </motion.h3>
            </AnimatePresence>
            
            <p className="text-sm text-gray-400">
              Turn {turnCount}
            </p>
          </div>
        </div>
        
        {/* 액션 상태 */}
        {myTurn && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 bg-green-600/20 px-3 py-1 rounded-full"
          >
            <Zap className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400 font-medium">액션 선택</span>
          </motion.div>
        )}
      </div>

      {/* 시간 제한 (있는 경우) */}
      {turnStartTime && (
        <div className="space-y-2">
          {/* 시간 표시 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className={`w-4 h-4 ${getTimeColor()}`} />
              <span className="text-sm text-gray-300">남은 시간</span>
            </div>
            
            <motion.span
              key={secondsRemaining}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              className={`font-mono font-bold text-lg ${getTimeColor()}`}
            >
              {secondsRemaining}초
            </motion.span>
          </div>
          
          {/* 프로그레스 바 */}
          <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${getProgressColor()}`}
              initial={{ width: '100%' }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 0.1 }}
            />
            
            {/* 긴급 상태 글로우 */}
            {isUrgent && (
              <motion.div
                className="absolute inset-0 bg-red-500/30 rounded-full"
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{
                  duration: 0.5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
            )}
          </div>
          
          {/* 긴급 메시지 */}
          <AnimatePresence>
            {isUrgent && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center"
              >
                <span className="text-red-400 text-sm font-medium">
                  {myTurn ? '빨리 액션을 선택하세요!' : '상대방이 고민 중입니다...'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 턴 히스토리 (선택적) */}
      {turnCount > 1 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>이전 턴들:</span>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, turnCount - 1) }, (_, i) => {
                const pastTurn = turnCount - 1 - i;
                const pastPlayer = pastTurn % 2 === 1 ? 'A' : 'B';
                return (
                  <div
                    key={pastTurn}
                    className={`w-4 h-4 rounded border text-center leading-3 ${
                      pastPlayer === myRole ? 'bg-green-600/20 border-green-600' : 'bg-gray-600/20 border-gray-600'
                    }`}
                    title={`Turn ${pastTurn}: ${participantNames[pastPlayer]}`}
                  >
                    {pastTurn}
                  </div>
                );
              })}
              {turnCount > 6 && (
                <span className="text-gray-600">...</span>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// 간단한 턴 표시 (상단 바용)
export function SimpleTurnIndicator({ currentTurn, myRole, participantNames }) {
  const myTurn = currentTurn === myRole;
  const currentPlayerName = participantNames[currentTurn] || `Player ${currentTurn}`;
  
  return (
    <div className="flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-4 py-2 rounded-full">
      <div className={`w-3 h-3 rounded-full ${myTurn ? 'bg-green-400' : 'bg-blue-400'}`} />
      <span className="text-white font-medium">
        {myTurn ? '당신의 턴' : `${currentPlayerName}의 턴`}
      </span>
    </div>
  );
}

// 모바일용 컴팩트 턴 표시
export function MobileTurnIndicator(props) {
  return <TurnIndicator {...props} compact={true} />;
}

// 관전자용 턴 표시
export function SpectatorTurnIndicator({ 
  currentTurn, 
  participantNames, 
  turnCount,
  turnStartTime,
  turnTimeLimit 
}) {
  const [timeRemaining, setTimeRemaining] = useState(turnTimeLimit);
  
  useEffect(() => {
    if (!turnStartTime) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - turnStartTime;
      const remaining = Math.max(0, turnTimeLimit - elapsed);
      setTimeRemaining(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [turnStartTime, turnTimeLimit]);

  const secondsRemaining = Math.ceil(timeRemaining / 1000);
  const currentPlayerName = participantNames[currentTurn] || `Player ${currentTurn}`;

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-700 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-blue-400" />
          <div>
            <span className="text-white font-medium">{currentPlayerName}의 턴</span>
            <p className="text-xs text-gray-400">Turn {turnCount}</p>
          </div>
        </div>
        
        {turnStartTime && (
          <div className="flex items-center gap-2 text-gray-300">
            <Clock className="w-4 h-4" />
            <span className="font-mono">{secondsRemaining}s</span>
          </div>
        )}
      </div>
    </div>
  );
}