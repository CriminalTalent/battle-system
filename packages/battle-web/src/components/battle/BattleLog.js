'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sword, 
  Shield, 
  Heart, 
  Clock, 
  User, 
  AlertCircle,
  ChevronDown,
  ChevronUp 
} from 'lucide-react';

export default function BattleLog({ 
  logs = [],
  maxHeight = "16rem",
  maxLogs = 100,
  autoScroll = true,
  showTimestamps = false,
  showIcons = true,
  compact = false,
  className = ""
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newLogCount, setNewLogCount] = useState(0);
  const scrollRef = useRef(null);
  const lastLogCountRef = useRef(0);

  // 새 로그 감지 및 자동 스크롤
  useEffect(() => {
    const currentLogCount = logs.length;
    
    if (currentLogCount > lastLogCountRef.current) {
      const newLogs = currentLogCount - lastLogCountRef.current;
      
      if (!isAtBottom) {
        setNewLogCount(prev => prev + newLogs);
      } else if (autoScroll && scrollRef.current) {
        // 자동 스크롤
        setTimeout(() => {
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }, 100);
      }
    }
    
    lastLogCountRef.current = currentLogCount;
  }, [logs, isAtBottom, autoScroll]);

  // 스크롤 위치 감지
  const handleScroll = () => {
    if (!scrollRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 50;
    
    if (atBottom !== isAtBottom) {
      setIsAtBottom(atBottom);
      if (atBottom) {
        setNewLogCount(0);
      }
    }
  };

  // 하단으로 스크롤
  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
    setNewLogCount(0);
  };

  // 로그 타입별 아이콘
  const getLogIcon = (log) => {
    if (!showIcons) return null;
    
    switch (log.type) {
      case 'attack':
        return <Sword className="w-4 h-4 text-red-400" />;
      case 'defend':
        return <Shield className="w-4 h-4 text-blue-400" />;
      case 'heal':
      case 'item':
        return <Heart className="w-4 h-4 text-green-400" />;
      case 'system':
        return <AlertCircle className="w-4 h-4 text-yellow-400" />;
      case 'status_effect':
        return <Clock className="w-4 h-4 text-purple-400" />;
      default:
        return <User className="w-4 h-4 text-gray-400" />;
    }
  };

  // 로그 타입별 스타일
  const getLogStyle = (log) => {
    const baseStyle = "flex items-start gap-2 p-2 rounded-lg text-sm";
    
    switch (log.type) {
      case 'attack':
        return `${baseStyle} ${log.hit === false 
          ? 'bg-gray-800/50 text-gray-300' 
          : log.critical 
            ? 'bg-red-900/30 text-red-200 border border-red-500/30' 
            : 'bg-red-900/20 text-red-300'
        }`;
      case 'defend':
        return `${baseStyle} bg-blue-900/20 text-blue-300`;
      case 'heal':
      case 'item':
        return `${baseStyle} bg-green-900/20 text-green-300`;
      case 'system':
        return `${baseStyle} bg-yellow-900/20 text-yellow-300 font-medium`;
      case 'status_effect':
        return `${baseStyle} bg-purple-900/20 text-purple-300`;
      default:
        return `${baseStyle} bg-gray-800/30 text-gray-300`;
    }
  };

  // 시간 포맷
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  // 로그 메시지 파싱 (특수 텍스트 강조)
  const parseLogMessage = (message) => {
    if (!message) return message;
    
    // 데미지 숫자 강조
    message = message.replace(/(\d+)\s*데미지/g, '<span class="font-bold text-red-400">$1 데미지</span>');
    
    // 회복량 강조
    message = message.replace(/(\d+)\s*회복/g, '<span class="font-bold text-green-400">$1 회복</span>');
    
    // 크리티컬 강조
    message = message.replace(/(크리티컬!?)/g, '<span class="font-bold text-yellow-400">$1</span>');
    
    // 플레이어 이름 강조
    message = message.replace(/([가-힣a-zA-Z0-9_]+)이/g, '<span class="font-medium text-white">$1</span>이');
    message = message.replace(/([가-힣a-zA-Z0-9_]+)의/g, '<span class="font-medium text-white">$1</span>의');
    
    return message;
  };

  // 표시할 로그 제한
  const displayLogs = logs.slice(-maxLogs);

  const logItemVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: { 
      opacity: 1, 
      y: 0, 
      scale: 1,
      transition: { duration: 0.3 }
    },
    exit: { 
      opacity: 0, 
      x: -20,
      transition: { duration: 0.2 }
    }
  };

  return (
    <div className={`bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg ${className}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-white text-sm">전투 로그</h3>
          <span className="text-xs text-gray-400">({displayLogs.length})</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 새 메시지 알림 */}
          {newLogCount > 0 && (
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              onClick={scrollToBottom}
              className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-full transition-colors"
            >
              {newLogCount}개 새 메시지
              <ChevronDown className="w-3 h-3" />
            </motion.button>
          )}
          
          {/* 확장/축소 버튼 */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            {isExpanded ? 
              <ChevronUp className="w-4 h-4 text-gray-400" /> : 
              <ChevronDown className="w-4 h-4 text-gray-400" />
            }
          </button>
        </div>
      </div>

      {/* 로그 내용 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="overflow-y-auto p-3 space-y-2"
              style={{ maxHeight }}
            >
              {displayLogs.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">아직 전투 로그가 없습니다</p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {displayLogs.map((log, index) => (
                    <motion.div
                      key={log.id || `${log.timestamp}-${index}`}
                      variants={logItemVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      layout
                      className={getLogStyle(log)}
                    >
                      {/* 아이콘 */}
                      <div className="flex-shrink-0 mt-0.5">
                        {getLogIcon(log)}
                      </div>
                      
                      {/* 메시지 내용 */}
                      <div className="flex-1 min-w-0">
                        <div 
                          className="break-words"
                          dangerouslySetInnerHTML={{ 
                            __html: parseLogMessage(log.message) 
                          }}
                        />
                        
                        {/* 추가 정보 (컴팩트 모드가 아닐 때) */}
                        {!compact && (
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                            {showTimestamps && log.timestamp && (
                              <span>{formatTime(log.timestamp)}</span>
                            )}
                            
                            {/* 데미지/치유 상세 정보 */}
                            {log.type === 'attack' && log.hit && (
                              <span>
                                {log.critical && '크리티컬 '}
                                주사위: {log.roll}
                              </span>
                            )}
                            
                            {log.type === 'attack' && log.hit === false && (
                              <span>명중 실패 (주사위: {log.roll})</span>
                            )}
                            
                            {(log.type === 'heal' || log.type === 'item') && log.heal && (
                              <span>회복량: {log.heal}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
            
            {/* 자동 스크롤되지 않을 때 하단 가기 버튼 */}
            {!isAtBottom && displayLogs.length > 0 && (
              <div className="absolute bottom-4 right-4">
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={scrollToBottom}
                  className="p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full shadow-lg border border-gray-600 transition-colors"
                  title="최신 로그로 이동"
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 컴팩트 전투 로그 (작은 공간용)
export function CompactBattleLog({ logs, ...props }) {
  return (
    <BattleLog
      logs={logs}
      maxHeight="8rem"
      compact={true}
      showTimestamps={false}
      showIcons={false}
      {...props}
    />
  );
}

// 전체화면 전투 로그 (관전자용)
export function FullBattleLog({ logs, ...props }) {
  return (
    <BattleLog
      logs={logs}
      maxHeight="24rem"
      showTimestamps={true}
      showIcons={true}
      maxLogs={200}
      {...props}
    />
  );
}

// 모바일 전투 로그
export function MobileBattleLog({ logs, ...props }) {
  return (
    <BattleLog
      logs={logs}
      maxHeight="12rem"
      compact={true}
      showTimestamps={false}
      className="text-sm"
      {...props}
    />
  );
}