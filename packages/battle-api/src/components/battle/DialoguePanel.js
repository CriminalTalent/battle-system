// packages/battle-web/src/components/battle/DialoguePanel.js
import React, { useState, useEffect, useRef } from 'react';
import { Send, Clock, MessageSquare, Zap } from 'lucide-react';

const DialoguePanel = ({ 
  character,
  battle,
  isMyTurn,
  canSendDialogue,
  dialogueUsed,
  turnTimeRemaining,
  onSendDialogue,
  onUseDialoguePreset,
  disabled = false,
  className = ""
}) => {
  const [message, setMessage] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [showPresets, setShowPresets] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  // 자동 포커스
  useEffect(() => {
    if (isMyTurn && canSendDialogue && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isMyTurn, canSendDialogue]);

  // 시간 경고 효과
  useEffect(() => {
    if (turnTimeRemaining <= 60 && turnTimeRemaining > 0 && panelRef.current) {
      panelRef.current.classList.add('animate-pulse');
    } else if (panelRef.current) {
      panelRef.current.classList.remove('animate-pulse');
    }
  }, [turnTimeRemaining]);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setMessage(value);
    setSelectedPreset(null);
    
    // 타이핑 상태 관리
    setIsTyping(value.length > 0);
  };

  const handleSendMessage = () => {
    if (!message.trim() || !canSendDialogue || disabled) return;
    
    onSendDialogue(message.trim(), selectedCategory);
    setMessage('');
    setSelectedPreset(null);
    setIsTyping(false);
  };

  const handlePresetSelect = (preset, index) => {
    if (!canSendDialogue || disabled) return;
    
    onUseDialoguePreset(index, selectedCategory);
    setSelectedPreset({ preset, index });
    setMessage(preset);
    setShowPresets(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusMessage = () => {
    if (!isMyTurn) return "상대방의 턴입니다";
    if (dialogueUsed) return "이번 턴에 이미 대사를 입력했습니다";
    if (turnTimeRemaining <= 0) return "시간이 종료되었습니다";
    if (disabled) return "전투가 진행 중이 아닙니다";
    return "대사를 입력하세요";
  };

  const getStatusColor = () => {
    if (!isMyTurn || disabled) return "text-gray-400";
    if (dialogueUsed) return "text-yellow-400";
    if (turnTimeRemaining <= 30) return "text-red-400";
    if (turnTimeRemaining <= 60) return "text-orange-400";
    if (turnTimeRemaining <= 180) return "text-yellow-400";
    return "text-green-400";
  };

  const getBorderColor = () => {
    if (!isMyTurn || disabled) return "border-gray-600";
    if (dialogueUsed) return "border-yellow-500";
    if (turnTimeRemaining <= 30) return "border-red-500";
    if (turnTimeRemaining <= 60) return "border-orange-500";
    return "border-blue-500";
  };

  // 카테고리별 프리셋 필터링
  const getPresetsByCategory = (category) => {
    if (!character.dialoguePresets) return [];
    return character.dialoguePresets
      .filter(preset => preset.category === category)
      .map(preset => preset.message);
  };

  const categories = [
    { value: 'general', label: '일반', icon: '💬' },
    { value: 'attack', label: '공격', icon: '⚔️' },
    { value: 'defend', label: '방어', icon: '🛡️' },
    { value: 'skill', label: '스킬', icon: '✨' },
    { value: 'taunt', label: '도발', icon: '😤' },
    { value: 'hurt', label: '피해', icon: '😵' },
    { value: 'victory', label: '승리', icon: '🎉' },
    { value: 'defeat', label: '패배', icon: '😭' }
  ];

  const currentPresets = getPresetsByCategory(selectedCategory);

  return (
    <div 
      ref={panelRef}
      className={`dialogue-panel bg-gray-800 rounded-lg border-2 transition-all duration-300 ${getBorderColor()} ${className}`}
    >
      {/* 헤더 */}
      <div className="p-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <span className="text-white text-sm font-semibold">
              {character.name}의 대사
            </span>
          </div>
          
          {isMyTurn && (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className={`text-xs font-mono ${getStatusColor()}`}>
                {formatTime(turnTimeRemaining)}
              </span>
            </div>
          )}
        </div>
        
        <div className={`text-xs mt-1 ${getStatusColor()}`}>
          {getStatusMessage()}
        </div>
      </div>

      {/* 메인 입력 영역 */}
      <div className="p-3">
        {/* 카테고리 선택 */}
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-2">카테고리:</div>
          <div className="flex flex-wrap gap-1">
            {categories.map((category) => (
              <button
                key={category.value}
                onClick={() => setSelectedCategory(category.value)}
                disabled={!canSendDialogue || disabled}
                className={`px-2 py-1 text-xs rounded transition-colors
                           ${selectedCategory === category.value
                             ? 'bg-blue-600 text-white'
                             : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                           } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {category.icon} {category.label}
              </button>
            ))}
          </div>
        </div>

        {/* 입력창과 버튼 */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={message}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="대사를 입력하세요... (최대 140자)"
              maxLength={140}
              rows={2}
              disabled={!canSendDialogue || disabled}
              className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white 
                       placeholder-gray-400 resize-none focus:outline-none focus:border-blue-500
                       disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            />
            
            {/* 글자 수 표시 */}
            <div className="absolute bottom-1 right-2 text-xs text-gray-400">
              {message.length}/140
            </div>
          </div>
          
          <div className="flex flex-col gap-1">
            <button
              onClick={handleSendMessage}
              disabled={!canSendDialogue || !message.trim() || disabled}
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                       flex items-center gap-1 text-sm"
            >
              <Send className="w-3 h-3" />
              {dialogueUsed ? '완료' : '전송'}
            </button>
            
            <button
              onClick={() => setShowPresets(!showPresets)}
              disabled={!canSendDialogue || disabled || currentPresets.length === 0}
              className="px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                       flex items-center gap-1 text-sm"
            >
              <Zap className="w-3 h-3" />
              프리셋
            </button>
          </div>
        </div>

        {/* 프리셋 대사 목록 */}
        {showPresets && currentPresets.length > 0 && (
          <div className="border border-gray-600 rounded p-2 bg-gray-750">
            <div className="text-xs text-gray-400 mb-2">
              {categories.find(c => c.value === selectedCategory)?.icon}{' '}
              {categories.find(c => c.value === selectedCategory)?.label} 프리셋:
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {currentPresets.map((preset, index) => (
                <button
                  key={index}
                  onClick={() => handlePresetSelect(preset, index)}
                  disabled={!canSendDialogue || disabled}
                  className={`w-full text-left px-2 py-1 text-xs rounded transition-colors
                             ${selectedPreset?.index === index && selectedPreset?.preset === preset
                               ? 'bg-blue-600 text-white'
                               : 'bg-gray-600 text-gray-200 hover:bg-gray-500'
                             } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  "{preset}"
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 프리셋이 없을 때 */}
        {showPresets && currentPresets.length === 0 && (
          <div className="border border-gray-600 rounded p-3 bg-gray-750 text-center">
            <div className="text-gray-400 text-xs">
              {categories.find(c => c.value === selectedCategory)?.label} 카테고리의 프리셋 대사가 없습니다
            </div>
          </div>
        )}

        {/* 도움말 */}
        {isMyTurn && canSendDialogue && !dialogueUsed && (
          <div className="mt-2 text-xs text-gray-500">
            💡 Enter로 전송 • 턴당 1회만 가능 • 도발 대사는 특수 효과가 있습니다
          </div>
        )}

        {/* 특수 상태 표시 */}
        {selectedCategory === 'taunt' && canSendDialogue && (
          <div className="mt-2 p-2 bg-orange-900 border border-orange-600 rounded text-xs">
            <div className="text-orange-200 font-semibold">⚠️ 도발 효과</div>
            <div className="text-orange-300">
              도발 대사를 사용하면 상대방의 정확도가 일시적으로 감소합니다
            </div>
          </div>
        )}
      </div>

      {/* 상태 표시줄 */}
      <div className={`px-3 py-2 border-t border-gray-700 bg-gray-750 rounded-b-lg`}>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              canSendDialogue ? 'bg-green-400' : 
              isMyTurn ? 'bg-yellow-400' : 'bg-gray-400'
            }`} />
            <span className="text-gray-300">
              {isTyping ? '입력 중...' : 
               dialogueUsed ? '대사 전송 완료' :
               canSendDialogue ? '대사 입력 대기' : '대기 중'}
            </span>
          </div>
          
          {battle?.settings?.ruleset?.dialogueEnabled === false && (
            <span className="text-red-400">대사 기능 비활성</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default DialoguePanel;