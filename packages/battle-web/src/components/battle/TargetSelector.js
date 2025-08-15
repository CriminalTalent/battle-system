'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sword, 
  Shield, 
  Heart, 
  Zap, 
  Users, 
  X, 
  Check,
  Target,
  AlertCircle,
  Skull
} from 'lucide-react';

export default function TargetSelector({
  // 전투 상태
  battleState,
  currentPlayer,
  actionType, // 'attack', 'defend', 'heal', 'skill'
  skillData = null, // 스킬 사용시 스킬 정보
  
  // 콜백
  onTargetSelect,
  onCancel,
  onConfirm,
  
  // UI 설정
  isOpen = false,
  allowMultiSelect = false,
  maxTargets = 1,
  
  // 디자인
  compact = false
}) {
  const [selectedTargets, setSelectedTargets] = useState([]);
  const [hoveredTarget, setHoveredTarget] = useState(null);

  // 선택 가능한 대상 필터링
  const availableTargets = useMemo(() => {
    if (!battleState || !currentPlayer) return { team1: [], team2: [] };

    const currentTeam = currentPlayer.team;
    const oppositeTeam = currentTeam === 'team1' ? 'team2' : 'team1';

    let team1Targets = [];
    let team2Targets = [];

    // 팀별 멤버 가져오기
    const team1Members = battleState.teams?.team1 || [];
    const team2Members = battleState.teams?.team2 || [];

    // 액션 타입에 따른 필터링
    switch (actionType) {
      case 'attack':
        // 공격: 상대 팀의 살아있는 멤버만
        if (currentTeam === 'team1') {
          team2Targets = team2Members.filter(member => 
            member && member.status !== 'dead' && member.currentHp > 0
          );
        } else {
          team1Targets = team1Members.filter(member => 
            member && member.status !== 'dead' && member.currentHp > 0
          );
        }
        break;

      case 'defend':
        // 방어: 같은 팀의 살아있는 멤버 (자신 포함)
        if (currentTeam === 'team1') {
          team1Targets = team1Members.filter(member => 
            member && member.status !== 'dead' && member.currentHp > 0
          );
        } else {
          team2Targets = team2Members.filter(member => 
            member && member.status !== 'dead' && member.currentHp > 0
          );
        }
        break;

      case 'heal':
        // 힐: 같은 팀의 부상당한 멤버
        if (currentTeam === 'team1') {
          team1Targets = team1Members.filter(member => 
            member && member.status !== 'dead' && member.currentHp < member.maxHp
          );
        } else {
          team2Targets = team2Members.filter(member => 
            member && member.status !== 'dead' && member.currentHp < member.maxHp
          );
        }
        break;

      case 'skill':
        // 스킬: 스킬 데이터에 따라 결정
        if (skillData) {
          const { targetType } = skillData;
          
          switch (targetType) {
            case 'enemy':
              if (currentTeam === 'team1') {
                team2Targets = team2Members.filter(member => 
                  member && member.status !== 'dead' && member.currentHp > 0
                );
              } else {
                team1Targets = team1Members.filter(member => 
                  member && member.status !== 'dead' && member.currentHp > 0
                );
              }
              break;
            case 'ally':
              if (currentTeam === 'team1') {
                team1Targets = team1Members.filter(member => 
                  member && member.status !== 'dead' && member.currentHp > 0
                );
              } else {
                team2Targets = team2Members.filter(member => 
                  member && member.status !== 'dead' && member.currentHp > 0
                );
              }
              break;
            case 'all':
              team1Targets = team1Members.filter(member => 
                member && member.status !== 'dead' && member.currentHp > 0
              );
              team2Targets = team2Members.filter(member => 
                member && member.status !== 'dead' && member.currentHp > 0
              );
              break;
          }
        }
        break;

      default:
        // 모든 살아있는 멤버
        team1Targets = team1Members.filter(member => 
          member && member.status !== 'dead' && member.currentHp > 0
        );
        team2Targets = team2Members.filter(member => 
          member && member.status !== 'dead' && member.currentHp > 0
        );
    }

    return { team1: team1Targets, team2: team2Targets };
  }, [battleState, currentPlayer, actionType, skillData]);

  // 대상 선택 핸들러
  const handleTargetClick = (target) => {
    const targetId = `${target.team}-${target.position}`;
    
    if (allowMultiSelect) {
      setSelectedTargets(prev => {
        const isSelected = prev.some(t => `${t.team}-${t.position}` === targetId);
        
        if (isSelected) {
          // 선택 해제
          return prev.filter(t => `${t.team}-${t.position}` !== targetId);
        } else {
          // 선택 추가 (최대 개수 체크)
          if (prev.length >= maxTargets) {
            return [target]; // 최대 개수 초과시 새로운 대상으로 교체
          }
          return [...prev, target];
        }
      });
    } else {
      // 단일 선택
      setSelectedTargets([target]);
      // 단일 선택의 경우 즉시 콜백 호출
      if (onTargetSelect) {
        onTargetSelect([target]);
      }
    }
  };

  // 확인 버튼 핸들러
  const handleConfirm = () => {
    if (selectedTargets.length > 0 && onConfirm) {
      onConfirm(selectedTargets);
    }
  };

  // 취소 핸들러
  const handleCancel = () => {
    setSelectedTargets([]);
    if (onCancel) {
      onCancel();
    }
  };

  // HP 퍼센테이지 계산
  const getHpPercentage = (member) => {
    if (!member || member.maxHp === 0) return 0;
    return (member.currentHp / member.maxHp) * 100;
  };

  // HP 바 색상 계산
  const getHpColor = (percentage) => {
    if (percentage > 75) return 'bg-green-500';
    if (percentage > 50) return 'bg-yellow-500';
    if (percentage > 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // 액션 아이콘 가져오기
  const getActionIcon = () => {
    switch (actionType) {
      case 'attack':
        return <Sword className="w-5 h-5" />;
      case 'defend':
        return <Shield className="w-5 h-5" />;
      case 'heal':
        return <Heart className="w-5 h-5" />;
      case 'skill':
        return <Zap className="w-5 h-5" />;
      default:
        return <Target className="w-5 h-5" />;
    }
  };

  // 액션 제목 가져오기
  const getActionTitle = () => {
    switch (actionType) {
      case 'attack':
        return '공격 대상 선택';
      case 'defend':
        return '방어 대상 선택';
      case 'heal':
        return '힐 대상 선택';
      case 'skill':
        return skillData ? `${skillData.name} 대상 선택` : '스킬 대상 선택';
      default:
        return '대상 선택';
    }
  };

  // 대상 렌더링
  const renderTarget = (member, teamName) => {
    const targetId = `${member.team}-${member.position}`;
    const isSelected = selectedTargets.some(t => `${t.team}-${t.position}` === targetId);
    const isHovered = hoveredTarget === targetId;
    const hpPercentage = getHpPercentage(member);
    const isDead = member.status === 'dead' || member.currentHp <= 0;

    return (
      <motion.div
        key={targetId}
        className={`
          relative p-3 rounded-lg border-2 cursor-pointer transition-all duration-200
          ${isDead 
            ? 'bg-gray-800 border-gray-600 cursor-not-allowed opacity-50' 
            : isSelected 
              ? 'bg-blue-600/30 border-blue-400 shadow-lg shadow-blue-500/20' 
              : isHovered
                ? 'bg-gray-700 border-gray-400'
                : 'bg-gray-800 border-gray-600 hover:border-gray-500'
          }
          ${compact ? 'p-2' : 'p-3'}
        `}
        onClick={() => !isDead && handleTargetClick(member)}
        onMouseEnter={() => !isDead && setHoveredTarget(targetId)}
        onMouseLeave={() => setHoveredTarget(null)}
        whileHover={!isDead ? { scale: 1.02 } : {}}
        whileTap={!isDead ? { scale: 0.98 } : {}}
        layout
      >
        {/* 선택 표시 */}
        {isSelected && !isDead && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-2 -right-2 bg-blue-500 rounded-full p-1 z-10"
          >
            <Check className="w-3 h-3 text-white" />
          </motion.div>
        )}

        {/* 죽음 표시 */}
        {isDead && (
          <div className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 z-10">
            <Skull className="w-3 h-3 text-white" />
          </div>
        )}

        {/* 캐릭터 정보 */}
        <div className="flex flex-col items-center space-y-2">
          {/* 아바타 */}
          <div className={`
            w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center
            ${member.team === 'team1' 
              ? 'from-blue-500 to-blue-700' 
              : 'from-red-500 to-red-700'
            }
            ${isDead ? 'grayscale' : ''}
          `}>
            <Users className="w-6 h-6 text-white" />
          </div>

          {/* 이름 */}
          <div className="text-center">
            <p className={`text-sm font-medium ${isDead ? 'text-gray-500' : 'text-white'}`}>
              {member.name || `Player ${member.position + 1}`}
            </p>
            <p className="text-xs text-gray-400">
              Position {member.position + 1}
            </p>
          </div>

          {/* HP 바 */}
          <div className="w-full">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">HP</span>
              <span className={isDead ? 'text-red-400' : 'text-white'}>
                {member.currentHp}/{member.maxHp}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
              <motion.div
                className={`h-full ${getHpColor(hpPercentage)} ${isDead ? 'opacity-50' : ''}`}
                initial={{ width: 0 }}
                animate={{ width: `${hpPercentage}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* 상태 이상 표시 */}
          {member.statusEffects && member.statusEffects.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {member.statusEffects.map((effect, index) => (
                <div
                  key={index}
                  className="px-1 py-0.5 bg-purple-600/30 text-purple-300 text-xs rounded"
                  title={effect.name}
                >
                  {effect.name.slice(0, 3)}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  // 팀 렌더링
  const renderTeam = (teamMembers, teamName, teamLabel) => {
    if (teamMembers.length === 0) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`
            w-3 h-3 rounded-full 
            ${teamName === 'team1' ? 'bg-blue-500' : 'bg-red-500'}
          `} />
          <h3 className="font-semibold text-white">{teamLabel}</h3>
          <span className="text-sm text-gray-400">
            ({teamMembers.length}명)
          </span>
        </div>

        <div className={`
          grid gap-3
          ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}
        `}>
          {teamMembers.map((member) => renderTarget(member, teamName))}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleCancel}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className={`
            bg-gray-900 rounded-xl border border-gray-700 shadow-2xl
            ${compact ? 'max-w-md' : 'max-w-4xl'}
            w-full max-h-[90vh] overflow-auto
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                {getActionIcon()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  {getActionTitle()}
                </h2>
                <p className="text-sm text-gray-400">
                  {allowMultiSelect 
                    ? `최대 ${maxTargets}개 대상 선택 가능`
                    : '1개 대상을 선택하세요'
                  }
                </p>
              </div>
            </div>
            
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* 대상 목록 */}
          <div className="p-4 space-y-6">
            {/* 경고 메시지 */}
            {availableTargets.team1.length === 0 && availableTargets.team2.length === 0 && (
              <div className="flex items-center gap-3 p-4 bg-yellow-600/20 border border-yellow-600/30 rounded-lg">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
                <div>
                  <p className="text-yellow-400 font-medium">
                    선택 가능한 대상이 없습니다
                  </p>
                  <p className="text-sm text-gray-400">
                    다른 액션을 선택해보세요
                  </p>
                </div>
              </div>
            )}

            {/* Team 1 */}
            {renderTeam(availableTargets.team1, 'team1', 'Team 1')}
            
            {/* Team 2 */}
            {renderTeam(availableTargets.team2, 'team2', 'Team 2')}
          </div>

          {/* 하단 버튼 */}
          <div className="flex gap-3 p-4 border-t border-gray-700">
            <button
              onClick={handleCancel}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              취소
            </button>
            
            {allowMultiSelect && (
              <button
                onClick={handleConfirm}
                disabled={selectedTargets.length === 0}
                className={`
                  flex-1 px-4 py-2 rounded-lg transition-colors
                  ${selectedTargets.length > 0
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  }
                `}
              >
                확인 ({selectedTargets.length}/{maxTargets})
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// 간단한 인라인 대상 선택 컴포넌트
export function InlineTargetSelector({
  availableTargets = [],
  selectedTarget,
  onTargetChange,
  compact = true
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {availableTargets.map((target, index) => (
        <button
          key={`${target.team}-${target.position}`}
          onClick={() => onTargetChange(target)}
          className={`
            px-3 py-2 rounded-lg text-sm border transition-colors
            ${selectedTarget?.position === target.position && selectedTarget?.team === target.team
              ? 'bg-blue-600 border-blue-400 text-white'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
            }
          `}
        >
          {target.name || `P${target.position + 1}`}
        </button>
      ))}
    </div>
  );
}

// 빠른 대상 선택 (액션 패널용)
export function QuickTargetSelector({
  targets = [],
  onSelect,
  actionType = 'attack'
}) {
  const getActionColor = () => {
    switch (actionType) {
      case 'attack': return 'border-red-500 text-red-400';
      case 'defend': return 'border-blue-500 text-blue-400';
      case 'heal': return 'border-green-500 text-green-400';
      default: return 'border-gray-500 text-gray-400';
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {targets.map((target, index) => (
        <button
          key={index}
          onClick={() => onSelect(target)}
          className={`
            p-2 rounded border-2 hover:bg-gray-700 transition-colors
            ${getActionColor()}
          `}
        >
          <div className="text-sm font-medium">
            {target.name || `Player ${target.position + 1}`}
          </div>
          <div className="text-xs opacity-75">
            HP: {target.currentHp}/{target.maxHp}
          </div>
        </button>
      ))}
    </div>
  );
}