'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useBattle from '../hooks/useBattle';
import ChatPanel from './ChatPanel';
import ItemSetup from './ItemSetup';

export default function BattleField({ apiUrl }) {
  const {
    battleState,
    isConnected,
    isConnecting,
    connectionError,
    isInBattle,
    myTeam,
    myPosition,
    isMyTurn,
    createBattle,
    joinBattle,
    attack,
    defend,
    dodge,
    targetSelection,
    confirmTargetSelection,
    cancelTargetSelection,
    toggleTarget,
    canAct,
    teamMates,
    enemies,
    // 채팅 관련 추가
    chatMessages,
    sendChatMessage,
    currentPlayer
  } = useBattle(apiUrl);

  const [selectedAction, setSelectedAction] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showMobileControls, setShowMobileControls] = useState(false);
  // 아이템 관련 상태 추가
  const [isItemPanelMinimized, setIsItemPanelMinimized] = useState(false);
  const [usableItems, setUsableItems] = useState([]);
  
  // 채팅 상태 추가
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  
  const [gameSetup, setGameSetup] = useState({
    mode: '1v1',
    playerName: '',
    battleId: '',
    showJoinForm: false,
    itemsEnabled: true, // 아이템 활성화 여부
    teamItems: {}, // 팀 아이템 설정
    playerStats: {
      attack: 50,
      defense: 30,
      agility: 50,
      maxHp: 100
    }
  });

  const battleFieldRef = useRef(null);

  // 화면 크기 감지
  useEffect(() => {
    const checkMobile = () => {
      setShowMobileControls(window.innerWidth < 768);
      // 모바일에서는 채팅을 기본으로 최소화
      if (window.innerWidth < 768) {
        setIsChatMinimized(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 키보드 단축키
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!canAct || targetSelection.isSelecting) return;

      switch (e.key) {
        case '1':
          e.preventDefault();
          handleQuickAction('attack');
          break;
        case '2':
          e.preventDefault();
          handleQuickAction('defend');
          break;
        case '3':
          e.preventDefault();
          handleQuickAction('dodge');
          break;
        case 'Escape':
          if (targetSelection.isSelecting) {
            cancelTargetSelection();
          }
          break;
        case 'Enter':
          // Enter 키로 채팅 포커스 (채팅이 열려있을 때만)
          if (!isChatMinimized && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            const chatInput = document.querySelector('.chat-input');
            if (chatInput) chatInput.focus();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [canAct, targetSelection.isSelecting, cancelTargetSelection, isChatMinimized]);

  const handleQuickAction = async (actionType) => {
    if (!canAct) return;

    try {
      switch (actionType) {
        case 'attack':
          await attack();
          break;
        case 'defend':
          await defend();
          break;
        case 'dodge':
          await dodge();
          break;
      }
    } catch (error) {
      console.error('액션 실행 실패:', error);
    }
  };

  const handleCreateBattle = () => {
    if (!gameSetup.playerName.trim()) {
      alert('플레이어 이름을 입력하세요');
      return;
    }
    createBattle(gameSetup.mode, {
      itemsEnabled: gameSetup.itemsEnabled
    });
  };

  const handleJoinBattle = () => {
    if (!gameSetup.playerName.trim() || !gameSetup.battleId.trim()) {
      alert('플레이어 이름과 배틀 ID를 입력하세요');
      return;
    }
    joinBattle(gameSetup.battleId, {
      name: gameSetup.playerName,
      ...gameSetup.playerStats
    }, gameSetup.teamItems);
  };

  const handleTargetClick = (targetId) => {
    if (targetSelection.isSelecting) {
      toggleTarget(targetId);
    }
  };

  // 아이템 관련 함수
  const handleItemsChange = (items) => {
    setGameSetup(prev => ({
      ...prev,
      teamItems: items
    }));
  };

  const handleToggleItemPanel = () => {
    setIsItemPanelMinimized(!isItemPanelMinimized);
  };

  const handleUseItem = (itemId) => {
    if (socketRef.current) {
      socketRef.current.emit('execute_action', {
        action: {
          type: 'use_item',
          itemId: itemId
        }
      });
    }
  };

  // 사용 가능한 아이템 목록 업데이트
  useEffect(() => {
    if (isInBattle && socketRef.current) {
      socketRef.current.emit('get_usable_items');
      
      socketRef.current.on('usable_items', (data) => {
        setUsableItems(data.items || []);
      });

      return () => {
        socketRef.current.off('usable_items');
      };
    }
  }, [isInBattle, battleState.currentPlayer]);

  // 채팅 메시지 전송 핸들러
  const handleSendChatMessage = (messageData) => {
    if (sendChatMessage) {
      sendChatMessage(messageData.text);
    }
  };

  // 채팅 토글 핸들러
  const handleToggleChat = () => {
    setIsChatMinimized(!isChatMinimized);
  };

  const playSound = (type) => {
    if (!soundEnabled) return;
    try {
      const audio = new Audio(`/sounds/sfx/${type}.mp3`);
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch (error) {
      console.warn('사운드 재생 실패:', error);
    }
  };

  // 팀 멤버 렌더링
  const renderTeamMembers = (team, teamName, isMyTeamSide = false) => {
    if (!team || team.length === 0) return null;

    const teamSize = team.length;
    
    // 팀 크기에 따른 레이아웃 결정
    const getTeamLayout = () => {
      switch (teamSize) {
        case 1: // 1v1
          return 'flex justify-center items-center';
        case 2: // 2v2
          return 'grid grid-rows-2 gap-6';
        case 3: // 3v3
          return 'grid grid-rows-3 gap-4';
        case 4: // 4v4
          return 'grid grid-cols-2 grid-rows-2 gap-4';
        default:
          return 'flex justify-center items-center';
      }
    };

    const layoutClass = getTeamLayout();

    return (
      <div className={`${layoutClass} h-full w-full max-w-md mx-auto`}>
        {team.map((member, index) => {
          if (!member) return null;
          
          const isCurrentTurn = battleState.currentPlayer?.id === member.id;
          const isSelectable = targetSelection.isSelecting && 
                              targetSelection.availableTargets.some(t => t.id === member.id);
          const isSelected = targetSelection.selectedTargets.includes(member.id);
          
          return (
            <motion.div
              key={`${teamName}-${index}`}
              initial={{ 
                x: isMyTeamSide ? -100 : 100, 
                opacity: 0,
                scale: 0.8 
              }}
              animate={{ 
                x: 0, 
                opacity: 1,
                scale: 1 
              }}
              transition={{ 
                duration: 0.8, 
                delay: index * 0.2 
              }}
              className={`relative ${teamSize === 4 ? 'transform scale-90' : ''}`}
              onClick={() => handleTargetClick(member.id)}
            >
              <CharacterCard
                character={member}
                isCurrentTurn={isCurrentTurn}
                isSelectable={isSelectable}
                isSelected={isSelected}
                compact={teamSize > 2}
                teamColor={teamName === 'team1' ? 'blue' : 'red'}
              />
              
              {/* 포지션 번호 표시 */}
              <div className={`
                absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${teamName === 'team1' ? 'bg-blue-600 text-white' : 'bg-red-600 text-white'}
              `}>
                {index + 1}
              </div>

              {/* 현재 턴 표시 */}
              {isCurrentTurn && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-4 left-1/2 transform -translate-x-1/2"
                >
                  <div className="bg-yellow-500 text-black px-2 py-1 rounded text-xs font-bold">
                    턴
                  </div>
                </motion.div>
              )}

              {/* 선택 표시 */}
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-0 border-4 border-yellow-400 rounded-lg pointer-events-none"
                />
              )}
            </motion.div>
          );
        })}
      </div>
    );
  };

  // 캐릭터 카드 컴포넌트
  const CharacterCard = ({ 
    character, 
    isCurrentTurn, 
    isSelectable, 
    isSelected, 
    compact, 
    teamColor 
  }) => {
    const healthPercent = (character.hp / character.maxHp) * 100;
    const isDead = character.status === 'dead' || character.hp <= 0;

    return (
      <div className={`
        relative p-4 rounded-lg border-2 transition-all duration-300 cursor-pointer
        ${isDead ? 'opacity-50 grayscale' : ''}
        ${isCurrentTurn ? 'border-yellow-400 bg-yellow-100 shadow-lg transform scale-105' : 'border-gray-300 bg-white'}
        ${isSelectable ? 'border-green-400 bg-green-50 hover:bg-green-100' : ''}
        ${isSelected ? 'border-yellow-400 bg-yellow-200' : ''}
        ${compact ? 'text-sm' : ''}
      `}>
        {/* 캐릭터 이름 */}
        <div className="font-bold text-center mb-2">
          {character.name}
        </div>

        {/* HP 바 */}
        <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
          <div 
            className={`h-3 rounded-full transition-all duration-500 ${
              healthPercent > 60 ? 'bg-green-500' :
              healthPercent > 30 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${healthPercent}%` }}
          />
        </div>

        {/* HP 텍스트 */}
        <div className="text-center text-sm mb-2">
          HP: {character.hp}/{character.maxHp}
        </div>

        {/* 스탯 정보 */}
        {!compact && (
          <div className="text-xs text-gray-600 grid grid-cols-3 gap-1">
            <div>공격: {character.attack || 50}</div>
            <div>방어: {character.defense || 30}</div>
            <div>민첩: {character.agility || 50}</div>
          </div>
        )}

        {/* 상태 효과 표시 */}
        {character.defendBuff && (
          <div className="absolute top-1 right-1 bg-blue-500 text-white px-1 py-0.5 rounded text-xs">
            방어
          </div>
        )}
        {character.dodgeBuff && (
          <div className="absolute top-1 right-1 bg-green-500 text-white px-1 py-0.5 rounded text-xs">
            회피
          </div>
        )}
      </div>
    );
  };

  // 연결 중 화면
  if (isConnecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center p-8 bg-black/20 rounded-lg backdrop-blur-sm">
          <div className="animate-spin w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <h2 className="text-white text-2xl mb-4">서버에 연결 중...</h2>
        </div>
      </div>
    );
  }

  // 연결 실패 화면
  if (connectionError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center p-8 bg-black/20 rounded-lg backdrop-blur-sm">
          <h2 className="text-white text-2xl mb-4">연결 실패</h2>
          <p className="text-red-300 mb-4">{connectionError}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  // 게임 설정 화면 (배틀에 참가하지 않은 경우)
  if (!isInBattle) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="w-full max-w-2xl p-8 bg-black/20 rounded-lg backdrop-blur-sm">
          <h1 className="text-white text-3xl text-center mb-8">팀전 배틀 시스템</h1>
          
          <div className="bg-white rounded-lg p-6">
            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-bold mb-2">
                플레이어 이름:
              </label>
              <input
                type="text"
                value={gameSetup.playerName}
                onChange={(e) => setGameSetup(prev => ({
                  ...prev,
                  playerName: e.target.value
                }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="이름을 입력하세요"
              />
            </div>

            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-bold mb-2">
                스탯 설정:
              </label>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(gameSetup.playerStats).map(([stat, value]) => (
                  <div key={stat}>
                    <label className="block text-gray-600 text-xs mb-1">
                      {stat === 'attack' ? '공격력' :
                       stat === 'defense' ? '방어력' :
                       stat === 'agility' ? '민첩성' : '최대 HP'}:
                    </label>
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => setGameSetup(prev => ({
                        ...prev,
                        playerStats: {
                          ...prev.playerStats,
                          [stat]: parseInt(e.target.value) || 0
                        }
                      }))}
                      className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:border-blue-500"
                      min="10"
                      max={stat === 'maxHp' ? "200" : "100"}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-bold mb-2">
                게임 모드:
              </label>
              <select 
                value={gameSetup.mode} 
                onChange={(e) => setGameSetup(prev => ({
                  ...prev,
                  mode: e.target.value
                }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="1v1">1 vs 1</option>
                <option value="2v2">2 vs 2</option>
                <option value="3v3">3 vs 3</option>
                <option value="4v4">4 vs 4</option>
              </select>
            </div>

            <div className="flex gap-4 mb-4">
              <button 
                onClick={handleCreateBattle}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                새 배틀 생성
              </button>
              
              <button 
                onClick={() => setGameSetup(prev => ({
                  ...prev,
                  showJoinForm: !prev.showJoinForm
                }))}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                배틀 참가
              </button>
            </div>

            {gameSetup.showJoinForm && (
              <div className="border-t pt-4">
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    배틀 ID:
                  </label>
                  <input
                    type="text"
                    value={gameSetup.battleId}
                    onChange={(e) => setGameSetup(prev => ({
                      ...prev,
                      battleId: e.target.value
                    }))}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                    placeholder="배틀 ID를 입력하세요"
                  />
                </div>
                <button 
                  onClick={handleJoinBattle}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                >
                  참가하기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 배틀 화면
  return (
    <div 
      ref={battleFieldRef}
      className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900"
    >
      {/* 상단 UI */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4">
        <div className="flex justify-between items-center">
          {/* 배틀 정보 */}
          <div className="bg-black/50 backdrop-blur-sm px-4 py-2 rounded-lg text-white">
            <div className="text-sm">
              {battleState.mode} | 상태: {battleState.status}
            </div>
            {battleState.currentPlayer && (
              <div className="text-xs text-gray-300">
                현재 턴: {battleState.currentPlayer.name}
              </div>
            )}
          </div>

          {/* 설정 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`px-3 py-2 rounded-lg text-white text-sm transition-colors ${
                soundEnabled 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              사운드 {soundEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* 선후공 결정 화면 */}
      {battleState.status === 'initiative' && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-center mb-6">선후공 결정!</h2>
            
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">Team 1</h3>
                <p>민첩성: {battleState.initiativeRolls.team1.agility}</p>
                <p>주사위: {battleState.initiativeRolls.team1.diceRoll}</p>
                <p className="font-bold">이합: {battleState.initiativeRolls.team1.total}</p>
              </div>
              
              <div className="text-center text-2xl font-bold">VS</div>
              
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">Team 2</h3>
                <p>민첩성: {battleState.initiativeRolls.team2.agility}</p>
                <p>주사위: {battleState.initiativeRolls.team2.diceRoll}</p>
                <p className="font-bold">이합: {battleState.initiativeRolls.team2.total}</p>
              </div>
            </div>

            <div className="mt-6 text-center">
              {battleState.initiativeRolls.team1.total > battleState.initiativeRolls.team2.total ? (
                <p className="text-blue-600 font-bold">Team 1이 선공!</p>
              ) : battleState.initiativeRolls.team2.total > battleState.initiativeRolls.team1.total ? (
                <p className="text-red-600 font-bold">Team 2가 선공!</p>
              ) : (
                <p className="text-gray-600">동점! 다시 굴립니다...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 메인 전투 영역 */}
      <div className="relative h-screen flex pt-20 pb-16">
        {/* 왼쪽 팀 */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            <div className="text-center mb-4">
              <h3 className={`text-xl font-bold ${
                myTeam === 'team1' ? 'text-blue-300' : 'text-blue-400'
              }`}>
                Team 1 {myTeam === 'team1' && '(내 팀)'}
              </h3>
            </div>
            {renderTeamMembers(battleState.teams?.team1, 'team1', true)}
          </div>
        </div>

        {/* 중앙 VS */}
        <div className="flex-shrink-0 w-32 flex items-center justify-center">
          <motion.div
            initial={{ scale: 0, rotate: 180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.8 }}
            className="text-6xl font-bold text-white drop-shadow-lg"
          >
            VS
          </motion.div>
        </div>

        {/* 오른쪽 팀 */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            <div className="text-center mb-4">
              <h3 className={`text-xl font-bold ${
                myTeam === 'team2' ? 'text-red-300' : 'text-red-400'
              }`}>
                Team 2 {myTeam === 'team2' && '(내 팀)'}
              </h3>
            </div>
            {renderTeamMembers(battleState.teams?.team2, 'team2', false)}
          </div>
        </div>
      </div>

      {/* 하단 액션 패널 */}
      {canAct && !targetSelection.isSelecting && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4">
            <div className="flex gap-4">
              <button
                onClick={() => handleQuickAction('attack')}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-bold"
              >
                공격 (1)
              </button>
              <button
                onClick={() => handleQuickAction('defend')}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-bold"
              >
                방어 (2)
              </button>
              <button
                onClick={() => handleQuickAction('dodge')}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-bold"
              >
                회피 (3)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 대상 선택 UI */}
      {targetSelection.isSelecting && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <div className="bg-black/50 backdrop-blur-sm rounded-lg p-4">
            <p className="text-white text-center mb-4">
              대상을 선택하세요 ({targetSelection.selectedTargets.length}/{targetSelection.maxTargets})
            </p>
            <div className="flex gap-4">
              <button
                onClick={confirmTargetSelection}
                disabled={targetSelection.selectedTargets.length === 0}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
              >
                확인
              </button>
              <button
                onClick={cancelTargetSelection}
                className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 배틀 로그 */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 max-h-48 overflow-y-auto">
        <div className="space-y-1">
          {battleState.battleLogs?.slice(-10).map((log, index) => (
            <div key={index} className="text-white text-sm">
              <span className="text-gray-400 text-xs">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className="ml-2">{log.message}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 채팅 패널 */}
      {isInBattle && (
        <ChatPanel
          messages={chatMessages || []}
          onSendMessage={handleSendChatMessage}
          currentPlayer={currentPlayer}
          isMinimized={isChatMinimized}
          onToggleMinimize={handleToggleChat}
          battleStatus={battleState.status}
        />
      )}

      {/* 연결 상태 표시 */}
      {!isConnected && (
        <div className="fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg">
          연결 끊김
        </div>
      )}

      {/* 키보드 단축키 안내 */}
      <div className="fixed top-20 right-4 bg-black/50 backdrop-blur-sm text-white p-3 rounded-lg text-sm">
        <p className="mb-1">단축키:</p>
        <p>1: 공격 | 2: 방어 | 3: 회피</p>
        <p>Enter: 채팅 | ESC: 취소</p>
      </div>
    </div>
  );
}
