'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sword, Shield, Clock } from 'lucide-react';
import Button from '../ui/Button';

export default function ActionPanel({ 
  character, 
  onActionSelect, 
  disabled = false,
  isMobile = false,
  turnTimeRemaining = null,
  lastAction = null
}) {
  const [selectedCategory, setSelectedCategory] = useState('basic');
  const [showTooltip, setShowTooltip] = useState(null);

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
          available: true
        },
        {
          id: 'defend',
          type: 'defend', 
          name: '방어',
          description: '다음 턴까지 받는 데미지를 50% 감소시킵니다',
          icon: Shield,
          available: true
        }
      ]
    };

    return actions;
  };

  const actions = getAvailableActions();
  const categories = [
    { id: 'basic', name: '액션', actions: actions.basic }
  ];

  const handleActionClick = (action) => {
    if (disabled || !action.available) return;
    
    const actionData = {
      type: action.type
    };
    
    onActionSelect(actionData);
  };

  const getButtonVariant = (action) => {
    if (!action.available) return 'disabled';
    if (action.type === 'attack') return 'destructive';
    if (action.type === 'defend') return 'secondary';
    if (action.type === 'skill') return 'default';
    if (action.type === 'item') return 'outline';
    return 'default';
  };

  const getActionColor = (action) => {
    if (!action.available) return 'text-gray-500';
    if (action.type === 'attack') return 'text-red-400';
    if (action.type === 'defend') return 'text-blue-400';
    return 'text-white';
  };

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

      {/* 카테고리 탭 제거 - 기본 액션만 있으므로 */}

      {/* 액션 버튼들 */}
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-2'}`}>
        {categories
          .find(cat => cat.id === 'basic')
          ?.actions.map((action) => {
            const IconComponent = action.icon;
            
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
                  disabled={!action.available || disabled}
                  className={`
                    w-full flex items-center gap-2 p-3 text-left
                    ${isMobile ? 'flex-col text-center p-2' : ''}
                    ${!action.available ? 'opacity-50 cursor-not-allowed' : ''}
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
                  </div>

                  {/* 단축키 표시 (데스크톱만) */}
                  {!isMobile && (
                    <div className="text-xs bg-gray-700 px-2 py-1 rounded">
                      {action.type === 'attack' ? '1' : '2'}
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
                      <div className="text-gray-300">{action.description}</div>
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
          <div>상태: {character.statusEffects?.length || 0}개</div>
        </div>
        
        {lastAction && (
          <div className="mt-2 text-xs text-gray-500">
            마지막 액션: {lastAction.name || lastAction.type}
          </div>
        )}
      </div>

      {/* 키보드 안내 (데스크톱만) */}
      {!isMobile && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          단축키: 1(공격), 2(방어)
        </div>
      )}
    </motion.div>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}