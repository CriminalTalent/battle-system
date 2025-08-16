// packages/battle-web/src/components/battle/SpectatorView.js
'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  EyeIcon, 
  ChatBubbleLeftIcon, 
  UserGroupIcon,
  ClockIcon,
  TrophyIcon,
  ShieldCheckIcon,
  BoltIcon,
  HeartIcon,
  MinusIcon,
  PlusIcon
} from '@heroicons/react/24/outline';
import CharacterCard from './CharacterCard';
import BattleLog from './BattleLog';
import { useSocket } from '../../hooks/useSocket';

const SpectatorView = ({ battleId, initialSpectatorInfo }) => {
  const socket = useSocket();
  const [battle, setBattle] = useState(null);
  const [spectators, setSpectators] = useState([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showSpectatorList, setShowSpectatorList] = useState(false);
  const [spectatorInfo, setSpectatorInfo] = useState(initialSpectatorInfo);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (!socket || !battleId) return;

    // 관전자로 배틀 참여
    socket.emit('join_as_spectator', {
      battleId,
      spectatorInfo
    });

    // 소켓 이벤트 리스너
    const handleSpectatorJoined = (data) => {
      setBattle(data.battle);
      setSpectatorCount(data.spectatorCount);
      setConnected(true);
      setError(null);
    };

    const handleSpectatorBattleState = (battleState) => {
      setBattle(battleState);
    };

    const handleSpectatorBattleUpdated = (data) => {
      setBattle(data.battle);
    };

    const handleSpectatorActionResult = (data) => {
      // 배틀 로그에 액션 결과 추가
      if (battle) {
        const updatedBattle = { ...battle };
        if (!updatedBattle.logs) updatedBattle.logs = [];
        updatedBattle.logs.push({
          id: `log_${Date.now()}`,
          type: 'action',
          text: data.result.message || '액션이 실행되었습니다.',
          timestamp: Date.now()
        });
        setBattle(updatedBattle);
      }
    };

    const handleSpectatorUpdate = (data) => {
      setSpectatorCount(data.spectatorCount);
      
      // 관전자 목록 업데이트
      if (data.type === 'joined') {
        setSpectators(prev => [...prev, data.spectator]);
      } else if (data.type === 'left') {
        setSpectators(prev => prev.filter(s => s.id !== data.spectator.id));
      }
    };

    const handleSpectatorChatMessage = (message) => {
      setChatMessages(prev => [...prev, message]);
    };

    const handleError = (errorData) => {
      setError(errorData.message);
      setConnected(false);
    };

    // 이벤트 리스너 등록
    socket.on('spectator_joined', handleSpectatorJoined);
    socket.on('spectator_battle_state', handleSpectatorBattleState);
    socket.on('spectator_battle_updated', handleSpectatorBattleUpdated);
    socket.on('spectator_action_result', handleSpectatorActionResult);
    socket.on('spectator_update', handleSpectatorUpdate);
    socket.on('spectator_chat_message', handleSpectatorChatMessage);
    socket.on('error', handleError);

    return () => {
      socket.off('spectator_joined', handleSpectatorJoined);
      socket.off('spectator_battle_state', handleSpectatorBattleState);
      socket.off('spectator_battle_updated', handleSpectatorBattleUpdated);
      socket.off('spectator_action_result', handleSpectatorActionResult);
      socket.off('spectator_update', handleSpectatorUpdate);
      socket.off('spectator_chat_message', handleSpectatorChatMessage);
      socket.off('error', handleError);
    };
  }, [socket, battleId, spectatorInfo]);

  const sendChatMessage = () => {
    if (!chatInput.trim() || !socket || !connected) return;

    socket.emit('spectator_chat', {
      text: chatInput.trim()
    });

    setChatInput('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const getBattleStatusText = () => {
    if (!battle) return '로딩 중...';
    
    switch (battle.status) {
      case 'waiting':
        return '플레이어 대기 중';
      case 'ready':
        return '배틀 준비 완료';
      case 'active':
        return `진행 중 - 턴 ${battle.currentTurn}`;
      case 'finished':
        return '배틀 종료';
      default:
        return battle.status;
    }
  };

  const getCurrentPlayerName = () => {
    if (!battle || battle.status !== 'active') return null;
    
    const currentTeam = battle.teams[battle.currentTeam];
    const currentPlayer = currentTeam?.players?.[battle.currentPlayerIndex];
    
    return currentPlayer?.name;
  };

  const getWinnerText = () => {
    if (!battle?.winner) return null;
    
    if (battle.winner.startsWith('team')) {
      const team = battle.teams[battle.winner];
      return `${team.name || battle.winner} 승리!`;
    }
    
    return `${battle.winner} 승리!`;
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-900 via-red-800 to-red-900 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <MinusIcon className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">연결 오류</h2>
          <p className="text-red-200">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  if (!connected || !battle) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 text-center">
          <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <EyeIcon className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">관전 연결 중...</h2>
          <p className="text-blue-200">배틀에 접속하고 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 relative overflow-hidden">
      {/* 배경 효과 */}
      <div className="absolute inset-0 bg-[url('/images/battle-bg.jpg')] bg-cover bg-center opacity-10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
      
      {/* 헤더 */}
      <motion.header 
        className="relative z-10 p-4 bg-black/20 backdrop-blur-sm border-b border-white/10"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-blue-600/20 rounded-full flex items-center justify-center">
              <EyeIcon className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">관전 모드</h1>
              <p className="text-sm text-blue-200">{getBattleStatusText()}</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* 현재 턴 플레이어 */}
            {getCurrentPlayerName() && (
              <div className="flex items-center space-x-2 bg-yellow-500/20 px-3 py-1 rounded-full">
                <ClockIcon className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-yellow-200">{getCurrentPlayerName()}의 턴</span>
              </div>
            )}

            {/* 관전자 수 */}
            <button
              onClick={() => setShowSpectatorList(!showSpectatorList)}
              className="flex items-center space-x-2 bg-purple-600/20 hover:bg-purple-600/30 px-3 py-2 rounded-lg transition-colors"
            >
              <UserGroupIcon className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-purple-200">{spectatorCount}</span>
            </button>

            {/* 채팅 토글 */}
            <button
              onClick={() => setShowChat(!showChat)}
              className="flex items-center space-x-2 bg-green-600/20 hover:bg-green-600/30 px-3 py-2 rounded-lg transition-colors"
            >
              <ChatBubbleLeftIcon className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-200">채팅</span>
            </button>

            {/* 최소화 버튼 */}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-2 bg-gray-600/20 hover:bg-gray-600/30 rounded-lg transition-colors"
            >
              {isMinimized ? (
                <PlusIcon className="w-4 h-4 text-gray-400" />
              ) : (
                <MinusIcon className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {!isMinimized && (
          <motion.main 
            className="relative z-10 p-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <div className="max-w-7xl mx-auto">
              {/* 승리 메시지 */}
              {battle.status === 'finished' && battle.winner && (
                <motion.div
                  className="mb-6 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 backdrop-blur-lg rounded-2xl p-6 border border-yellow-500/30 text-center"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <TrophyIcon className="w-12 h-12 text-yellow-400 mx-auto mb-2" />
                  <h2 className="text-2xl font-bold text-yellow-200 mb-1">{getWinnerText()}</h2>
                  <p className="text-yellow-300/80">배틀이 종료되었습니다</p>
                </motion.div>
              )}

              {/* 배틀 필드 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* 팀 1 */}
                <div className="space-y-4">
                  <div className="bg-blue-600/20 backdrop-blur-lg rounded-xl p-4 border border-blue-500/30">
                    <h3 className="text-lg font-bold text-blue-200 mb-4 flex items-center">
                      <ShieldCheckIcon className="w-5 h-5 mr-2" />
                      {battle.teams.team1.name || 'Team 1'}
                    </h3>
                    <div className="grid gap-3">
                      {battle.teams.team1.players.map((player, index) => (
                        <CharacterCard
                          key={player.id}
                          player={player}
                          isCurrentPlayer={
                            battle.status === 'active' && 
                            battle.currentTeam === 'team1' && 
                            battle.currentPlayerIndex === index
                          }
                          isSpectatorMode={true}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* 팀 2 */}
                <div className="space-y-4">
                  <div className="bg-red-600/20 backdrop-blur-lg rounded-xl p-4 border border-red-500/30">
                    <h3 className="text-lg font-bold text-red-200 mb-4 flex items-center">
                      <BoltIcon className="w-5 h-5 mr-2" />
                      {battle.teams.team2.name || 'Team 2'}
                    </h3>
                    <div className="grid gap-3">
                      {battle.teams.team2.players.map((player, index) => (
                        <CharacterCard
                          key={player.id}
                          player={player}
                          isCurrentPlayer={
                            battle.status === 'active' && 
                            battle.currentTeam === 'team2' && 
                            battle.currentPlayerIndex === index
                          }
                          isSpectatorMode={true}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 배틀 로그 */}
              <div className="bg-black/30 backdrop-blur-lg rounded-xl border border-white/10">
                <BattleLog 
                  logs={battle.logs || []} 
                  maxHeight="300px"
                  isSpectatorMode={true}
                />
              </div>
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      {/* 관전자 목록 사이드바 */}
      <AnimatePresence>
        {showSpectatorList && (
          <motion.div
            className="fixed top-0 right-0 h-full w-80 bg-black/50 backdrop-blur-xl border-l border-white/10 z-50"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20 }}
          >
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center">
                  <UserGroupIcon className="w-5 h-5 mr-2" />
                  관전자 ({spectatorCount})
                </h3>
                <button
                  onClick={() => setShowSpectatorList(false)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  <MinusIcon className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-2 overflow-y-auto h-full">
              {spectators.map((spectator) => (
                <div
                  key={spectator.id}
                  className="flex items-center space-x-3 p-2 bg-white/5 rounded-lg"
                >
                  <div className="w-8 h-8 bg-purple-600/20 rounded-full flex items-center justify-center">
                    <EyeIcon className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{spectator.name}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(spectator.joinedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              {spectators.length === 0 && (
                <div className="text-center py-8">
                  <EyeIcon className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-400">다른 관전자가 없습니다</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 관전자 채팅 사이드바 */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            className="fixed bottom-0 right-0 w-80 h-96 bg-black/50 backdrop-blur-xl border-t border-l border-white/10 z-50 rounded-tl-xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 20 }}
          >
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center">
                  <ChatBubbleLeftIcon className="w-5 h-5 mr-2" />
                  관전자 채팅
                </h3>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                >
                  <MinusIcon className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
            
            {/* 채팅 메시지 영역 */}
            <div className="flex-1 p-4 overflow-y-auto h-60 space-y-2">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className="bg-white/5 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-green-300">
                      {message.spectatorName}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-white">{message.text}</p>
                </div>
              ))}
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <ChatBubbleLeftIcon className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-400">아직 채팅 메시지가 없습니다</p>
                </div>
              )}
            </div>

            {/* 채팅 입력 영역 */}
            <div className="p-4 border-t border-white/10">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="관전자들과 채팅하세요..."
                  className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                  maxLength={200}
                />
                <button
                  onClick={sendChatMessage}
                  disabled={!chatInput.trim() || !connected}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  전송
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 연결 상태 표시 */}
      <div className="fixed bottom-4 left-4 z-40">
        <div className={`flex items-center space-x-2 px-3 py-2 rounded-lg ${
          connected 
            ? 'bg-green-600/20 border border-green-500/30' 
            : 'bg-red-600/20 border border-red-500/30'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-400' : 'bg-red-400'
          } ${connected ? 'animate-pulse' : ''}`} />
          <span className={`text-sm ${
            connected ? 'text-green-200' : 'text-red-200'
          }`}>
            {connected ? '관전 중' : '연결 끊김'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SpectatorView;
