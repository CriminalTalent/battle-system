// DialoguePanel.js - 대사 입력 컴포넌트
import React, { useState } from 'react';

const DialoguePanel = ({ 
  character, 
  onSendDialogue, 
  canSendDialogue = false,
  dialogueUsed = false,
  turnTimeRemaining = 0,
  timeDisplay = "0:00",
  isMyTurn = false
}) => {
  const [message, setMessage] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');

  const handleSend = () => {
    if (message.trim() && canSendDialogue) {
      onSendDialogue(message.trim());
      setMessage('');
      setSelectedPreset('');
    }
  };

  const handlePresetSelect = (preset) => {
    setMessage(preset);
    setSelectedPreset(preset);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getStatusMessage = () => {
    if (!isMyTurn) return "상대방의 턴입니다";
    if (dialogueUsed) return "이번 턴에 이미 대사를 입력했습니다";
    if (turnTimeRemaining <= 0) return "시간이 종료되었습니다";
    return `대사 입력 가능 (남은 시간: ${timeDisplay})`;
  };

  const getStatusColor = () => {
    if (!isMyTurn) return "text-gray-400";
    if (dialogueUsed) return "text-yellow-400";
    if (turnTimeRemaining <= 60) return "text-red-400"; // 1분 이하일 때 빨간색
    if (turnTimeRemaining <= 180) return "text-orange-400"; // 3분 이하일 때 주황색
    return "text-green-400";
  };

  return (
    <div className="dialogue-panel bg-gray-800 p-4 rounded-lg">
      <div className="flex justify-between items-center mb-2">
        <label className="text-white text-sm font-bold">
          {character.name}의 대사
        </label>
        <div className={`text-xs font-mono ${getStatusColor()}`}>
          {isMyTurn && timeDisplay}
        </div>
      </div>
      
      {/* 상태 메시지 */}
      <div className={`text-xs mb-3 ${getStatusColor()}`}>
        {getStatusMessage()}
      </div>
      
      {/* 대사 입력창 */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="대사를 입력하세요... (최대 140자)"
          maxLength={140}
          disabled={!canSendDialogue}
          className="flex-1 p-2 border rounded bg-gray-700 text-white 
                     placeholder-gray-400 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!canSendDialogue || !message.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded 
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {dialogueUsed ? '완료' : '말하기'}
        </button>
      </div>

      {/* 프리셋 대사 버튼들 */}
      {character.dialoguePresets && character.dialoguePresets.length > 0 && (
        <div className="preset-dialogues">
          <div className="text-white text-xs mb-2">빠른 대사:</div>
          <div className="flex flex-wrap gap-1">
            {character.dialoguePresets.map((preset, index) => (
              <button
                key={index}
                onClick={() => handlePresetSelect(preset)}
                disabled={!canSendDialogue}
                className={`px-2 py-1 text-xs rounded transition-colors
                           ${selectedPreset === preset 
                             ? 'bg-blue-600 text-white' 
                             : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                           } disabled:opacity-50`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 글자 수 카운터 */}
      <div className="text-right text-xs text-gray-400 mt-1">
        {message.length}/140
      </div>
    </div>
  );
};

// DialogueHistory.js - 대사 히스토리 컴포넌트
const DialogueHistory = ({ dialogues = [], maxHeight = "200px" }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    // 새 대사가 추가되면 자동 스크롤
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [dialogues]);

  return (
    <div className="dialogue-history bg-gray-900 rounded-lg p-3">
      <h4 className="text-white text-sm font-bold mb-2">대화 기록</h4>
      <div 
        ref={scrollRef}
        className="overflow-y-auto space-y-2"
        style={{ maxHeight }}
      >
        {dialogues.map((dialogue, index) => (
          <div 
            key={index}
            className="dialogue-item p-2 bg-gray-800 rounded text-sm"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-blue-400">
                {dialogue.characterName}
              </span>
              <span className="text-gray-500 text-xs">
                {new Date(dialogue.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-white">
              "{dialogue.message}"
            </div>
          </div>
        ))}
        
        {dialogues.length === 0 && (
          <div className="text-gray-500 text-center py-4">
            아직 대화가 없습니다
          </div>
        )}
      </div>
    </div>
  );
};

// useBattle.js에 추가할 훅 로직 - 턴당 10분 타이머 포함
const useBattleDialogue = (socket, roomId, currentTurn, playerTurn) => {
  const [dialogues, setDialogues] = useState([]);
  const [dialogueUsed, setDialogueUsed] = useState(false); // 이번 턴에 대사 사용했는지
  const [turnTimeRemaining, setTurnTimeRemaining] = useState(600); // 10분 = 600초
  const [isMyTurn, setIsMyTurn] = useState(false);

  useEffect(() => {
    if (!socket) return;

    // 대사 수신 이벤트
    socket.on('dialogue_sent', (data) => {
      setDialogues(prev => [...prev, {
        characterName: data.characterName,
        message: data.message,
        timestamp: data.timestamp,
        turn: data.turn
      }]);
    });

    // 턴 변경 이벤트
    socket.on('turn_changed', (data) => {
      setDialogueUsed(false); // 새 턴에서는 대사 다시 사용 가능
      setTurnTimeRemaining(600); // 10분 리셋
      setIsMyTurn(data.currentPlayer === playerTurn);
    });

    return () => {
      socket.off('dialogue_sent');
      socket.off('turn_changed');
    };
  }, [socket, playerTurn]);

  // 턴 타이머
  useEffect(() => {
    if (isMyTurn && turnTimeRemaining > 0) {
      const timer = setTimeout(() => {
        setTurnTimeRemaining(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isMyTurn, turnTimeRemaining]);

  const sendDialogue = (message) => {
    if (socket && roomId && isMyTurn && !dialogueUsed && turnTimeRemaining > 0) {
      socket.emit('send_dialogue', {
        roomId,
        message,
        timestamp: Date.now(),
        turn: currentTurn
      });
      
      setDialogueUsed(true); // 이번 턴에 대사 사용 완료
    }
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    dialogues,
    sendDialogue,
    canSendDialogue: isMyTurn && !dialogueUsed && turnTimeRemaining > 0,
    dialogueUsed,
    turnTimeRemaining,
    timeDisplay: formatTime(turnTimeRemaining),
    isMyTurn
  };
};

export { DialoguePanel, DialogueHistory, useBattleDialogue };