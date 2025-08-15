'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sword, Shield, Clock, Heart, Zap, Target, Users } from 'lucide-react';
import Button from '../ui/Button';
import TargetSelector from './TargetSelector';

export default function ActionPanel({ 
  character, 
  battleState, // 추가: 전투 상태 정보
  currentPlayer, // 추가: 현재 플레이어 정보
  onActionSelect, 
  disabled = false,
  isMobile = false,
  turnTimeRemaining = null,
  lastAction = null
}) {
  const [selectedCategory, setSelectedCategory] = useState('basic');
  const [showTooltip, setShowTooltip] = useState(null);
  
  // TargetSelector 상태
  const [showTargetSelector, setShowTargetSelector] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedTargets, setSelectedTargets] = useState([]);

  // 사용 가능한 액션 계산
  const getAvailableActions = () => {
    const actions = {
      basic: [
        {
          id: 'attack',
          type: 'attack',
          name: '공격',
          description: '기본 공격으로 상대에게 데미지를 입힙니다',
          icon: Sword,
          available: true,
          needsTarget: true,
          targetType: 'enemy'
        },
        {
          id: 'defend',
          type: 'defend', 
          name: '방어',
          description: '다음 턴까지 받는 데미지를 50% 감소시킵니다',
          icon: Shield,
          available: true,
          needsTarget: true,
          targetType: 'ally'
        },
        {
          id: 'heal',
          type: 'heal',
          name: '힐',
          description: '아군의 HP를 회복시킵니다',
          icon: Heart,
          available: character.mp >= 20, // MP 조건 예시
          needsTarget: true,
          targetType: 'ally',
          mpCost: 20
        }
      ],
      skills: [
        {
          id: 'fireball',
          type: 'skill',
          name: '파이어볼',
          description: '강력한 화염 마법으로 적에게 큰 데미지를 입힙니다',
          icon: Zap,
          available: character.mp >= 30,
          needsTarget: true,
          targetType: 'enemy',
          mpCost: 30,
          skillData: {
            id: 'fireball',
            name: '파이어볼',
            targetType: 'enemy',
            allowMultiple: false
          }
        }
      ]
    };

    return actions;
  };

  const actions = getAvailableActions();
  const categories = [
    { id: 'basic', name: '기본 액션', actions: actions.basic },
    { id: 'skills', name: '스킬', actions: actions.skills }
  ];

  // 액션 클릭 핸들러
  const handleActionClick = (action) => {
    if (disabled || !action.available) return;

    // 대상 선택이 필요한 경우
    if (action.needsTarget) {
      setPendingAction(action);
      setShowTargetSelector(true);
      setSelectedTargets([]);
    } else {
      // 대상 선택이 불필요한 경우 (현재는 모든 액션이 대상 필요)
      const actionData = {
        type: action.type,
        targets: [] // 자동 대상 설정
      };
      onActionSelect(actionData);
    }
  };

  // 대상 선택 완료 핸들러
  const handleTargetSelect = (targets) => {
    if (!pendingAction) return;

    const actionData = {
      type: pendingAction.type,
      targets: targets,
      skillData: pendingAction.skillData || null,
      mpCost: pendingAction.mpCost || 0
    };

    // 단일 선택의 경우 즉시 실행
    if (!pendingAction.skillData?.allowMultiple) {
      setShowTargetSelector(false);
      setPendingAction(null);
      onActionSelect(actionData);
    } else {
      // 다중 선택의 경우 타겟 저장
      setSelectedTargets(targets);
    }
  };

  // 대상 선택 확인 (다중 선택용)
  const handleTargetConfirm = (targets) => {
    if (!pendingAction) return;

    const actionData = {
      type: pendingAction.type,
      targets: targets,
      skillData: pendingAction.skillData || null,
      mpCost: pendingAction.mpCost || 0
    };

    setShowTargetSelector(false);
    setPendingAction(null);
    setSelectedTargets([]);
    onActionSelect(actionData);
  };

  // 대상 선택 취소
  const handleTargetCancel = () => {
    setShowTargetSelector(false);
    setPendingAction(null);
    setSelectedTargets([]);
  };

  // 사용 가능한 대상 수 계산 (미리보기용)
  const getAvailableTargetCount = (action) => {
    if (!battleState || !currentPlayer || !action.needsTarget) return 0;

    const currentTeam = currentPlayer.team;
    const oppositeTeam = currentTeam === 'team1' ? 'team2' : 'team1';

    let count = 0;

    switch (action.targetType) {
      case 'enemy':
        const enemies = battleState.teams?.[oppositeTeam] || [];
        count = enemies.filter(member => 
          member && member.status !== 'dead' && member.currentHp > 0
        ).length;
        break;
      case 'ally':
        const allies = battleState.teams?.[currentTeam] || [];
        if (action.type === 'heal') {
          count = allies.filter(member => 
            member && member.status !== 'dead' && member.currentHp < member.maxHp
          ).length;
        } else {
          count = allies.filter(member => 
            member && member.status !== 'dead' && member.currentHp > 0
          ).length;
        }
        break;
    }

    return count;
  };

  const getButtonVariant = (action) => {
    if (!action.available) return 'disabled';
    if (action.type === 'attack') return 'destructive';
    if (action.type === 'defend') return 'secondary';
    if (action.type === 'heal') return 'success';
    if (action.type === 'skill') return 'default';
    return 'default';
  };

  const getActionColor = (action) => {
    if (!action.available) return 'text-gray-500';
    if (action.type === 'attack') return 'text-red-400';
    if (action.type === 'defend') return 'text-blue-400';
    if (action.type === 'heal') return 'text-green-400';
    if (action.type === 'skill') return 'text-purple-400';
    return 'text-white';
  };

  // 키보드 단축키
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (disabled || showTargetSelector) return;

      const key = e.key;
      const basicActions = actions.basic;

      if (key === '1' && basicActions[0]?.available) {
        handleActionClick(basicActions[0]);
      } else if (key === '2' && basicActions[1]?.available) {
        handleActionClick(basicActions[1]);
      } else if (key === '3' && basicActions[2]?.available) {
        handleActionClick(basicActions[2]);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [disabled, showTargetSelector, actions]);

  const panelVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: {
        duration: 0.3,
        staggerChildren: 0.1
      }
    }
  };

  const actionVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 }
  };

  return (
    <>
      <motion.div
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        className={`
          bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-700
          ${isMobile ? 'p-3' : 'p-4'}
          ${disabled ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        {/* 상단 정보 */}
        <div className="flex justify-between items-center mb-4">
          <h3 className={`font-bold text-white ${isMobile ? 'text-sm' : 'text-base'}`}>
            액션 선택
          </h3>

          {turnTimeRemaining && (
            <div className="flex items-center gap-2 text-yellow-400">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-mono">
                {Math.ceil(turnTimeRemaining / 1000)}초
              </span>
            </div>
          )}
        </div>

        {/* 카테고리 탭 (스킬이 있는 경우만) */}
        {categories.length > 1 && (
          <div className="flex gap-2 mb-4">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`
                  px-3 py-1 rounded text-sm transition-colors
                  ${selectedCategory === category.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }
                `}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}

        {/* 액션 버튼들 */}
        <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {categories
            .find(cat => cat.id === selectedCategory)
            ?.actions.map((action, index) => {
              const IconComponent = action.icon;
              const targetCount = getAvailableTargetCount(action);

              return (
                <motion.div
                  key={action.id}
                  variants={actionVariants}
                  className="relative"
                  onMouseEnter={() => !isMobile && setShowTooltip(action.id)}
                  onMouseLeave={() => setShowTooltip(null)}
                >
                  <Button
                    variant={getButtonVariant(action)}
                    onClick={() => handleActionClick(action)}
                    disabled={!action.available || disabled || targetCount === 0}
                    className={`
                      w-full flex items-center gap-2 p-3 text-left relative
                      ${isMobile ? 'flex-col text-center p-2' : ''}
                      ${!action.available || targetCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                  >
                    <IconComponent 
                      className={`w-5 h-5 flex-shrink-0 ${getActionColor(action)}`} 
                    />

                    <div className="flex-1">
                      <div className={`font-medium ${isMobile ? 'text-sm' : 'text-base'}`}>
                        {action.name}
                      </div>

                      {!isMobile && (
                        <div className="text-xs text-gray-400 mt-1">
                          {action.description}
                        </div>
                      )}

                      {/* 대상 수 표시 */}
                      {action.needsTarget && (
                        <div className="flex items-center gap-1 mt-1">
                          <Target className="w-3 h-3 text-gray-500" />
                          <span className="text-xs text-gray-500">
                            {targetCount}개 대상
                          </span>
                        </div>
                      )}
                    </div>

                    {/* MP 비용 표시 */}
                    {action.mpCost && (
                      <div className="text-xs bg-purple-600/20 text-purple-300 px-2 py-1 rounded">
                        MP {action.mpCost}
                      </div>
                    )}

                    {/* 단축키 표시 (데스크톱만) */}
                    {!isMobile && selectedCategory === 'basic' && (
                      <div className="text-xs bg-gray-700 px-2 py-1 rounded">
                        {index + 1}
                      </div>
                    )}
                  </Button>

                  {/* 툴팁 (데스크톱만) */}
                  {!isMobile && showTooltip === action.id && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50"
                    >
                      <div className="bg-gray-800 text-white text-xs rounded-lg p-3 shadow-lg max-w-48">
                        <div className="font-medium mb-1">{action.name}</div>
                        <div className="text-gray-300 mb-2">{action.description}</div>
                        
                        {action.mpCost && (
                          <div className="text-purple-300">MP 비용: {action.mpCost}</div>
                        )}
                        
                        {action.needsTarget && (
                          <div className="text-blue-300">
                            대상: {action.targetType === 'enemy' ? '적' : '아군'} ({targetCount}개)
                          </div>
                        )}
                      </div>

                      {/* 툴팁 화살표 */}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                        <div className="border-4 border-transparent border-t-gray-800" />
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
        </div>

        {/* 하단 정보 */}
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="flex justify-between text-xs text-gray-400">
            <div>HP: {character.hp}/{character.maxHp}</div>
            {character.mp !== undefined && (
              <div>MP: {character.mp}/{character.maxMp}</div>
            )}
            <div>상태: {character.statusEffects?.length || 0}개</div>
          </div>

          {lastAction && (
            <div className="mt-2 text-xs text-gray-500">
              마지막 액션: {lastAction.name || lastAction.type}
              {lastAction.targets && lastAction.targets.length > 0 && (
                <span> → {lastAction.targets.map(t => t.name).join(', ')}</span>
              )}
            </div>
          )}
        </div>

        {/* 키보드 안내 (데스크톱만) */}
        {!isMobile && selectedCategory === 'basic' && (
          <div className="mt-2 text-xs text-gray-500 text-center">
            단축키: 1(공격), 2(방어), 3(힐)
          </div>
        )}

        {/* 대상 선택 중 표시 */}
        {pendingAction && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-2 bg-blue-600/20 border border-blue-600/30 rounded-lg"
          >
            <div className="flex items-center gap-2 text-blue-300">
              <Users className="w-4 h-4" />
              <span className="text-sm">
                {pendingAction.name}의 대상을 선택하세요
              </span>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* 대상 선택 모달 */}
      <TargetSelector
        isOpen={showTargetSelector}
        battleState={battleState}
        currentPlayer={currentPlayer}
        actionType={pendingAction?.type}
        skillData={pendingAction?.skillData}
        allowMultiSelect={pendingAction?.skillData?.allowMultiple || false}
        maxTargets={pendingAction?.skillData?.maxTargets || 1}
        onTargetSelect={handleTargetSelect}
        onConfirm={handleTargetConfirm}
        onCancel={handleTargetCancel}
        compact={isMobile}
      />
    </>
  );
}

// 간소화된 모바일 전용 액션 패널
export function MobileActionPanel(props) {
  return <ActionPanel {...props} isMobile={true} />;
}

// 관전자용 액션 패널 (읽기 전용)
export function SpectatorActionPanel({ character, lastAction }) {
  return (
    <div className="bg-gray-900/50 backdrop-blur-sm rounded-lg border border-gray-700 p-4">
      <h3 className="font-bold text-white text-sm mb-3">캐릭터 정보</h3>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">HP</span>
          <span className="text-white font-mono">
            {character.hp}/{character.maxHp}
          </span>
        </div>

        {character.mp !== undefined && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-300">MP</span>
            <span className="text-blue-300 font-mono">
              {character.mp}/{character.maxMp}
            </span>
          </div>
        )}

        {character.statusEffects && character.statusEffects.length > 0 && (
          <div>
            <span className="text-gray-300 text-sm">상태:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {character.statusEffects.map((effect, index) => (
                <span
                  key={index}
                  className={`px-2 py-1 text-xs rounded-full ${
                    effect.type === 'buff' 
                      ? 'bg-green-600 text-green-100' 
                      : effect.type === 'debuff'
                      ? 'bg-red-600 text-red-100'
                      : 'bg-blue-600 text-blue-100'
                  }`}
                >
                  {effect.source || effect.type} ({effect.duration})
                </span>
              ))}
            </div>
          </div>
        )}

        {lastAction && (
          <div className="pt-2 border-t border-gray-700">
            <span className="text-gray-300 text-sm">마지막 액션:</span>
            <div className="text-white text-sm mt-1">
              {lastAction.name || lastAction.type}
              {lastAction.targets && lastAction.targets.length > 0 && (
                <div className="text-gray-400 text-xs mt-1">
                  대상: {lastAction.targets.map(t => t.name).join(', ')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}