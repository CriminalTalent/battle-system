// packages/battle-web/src/components/ChatPanel.js
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ChatPanel = ({ 
  messages = [], 
  onSendMessage, 
  currentPlayer, 
  isMinimized, 
  onToggleMinimize,
  battleStatus 
}) => {
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // 메시지가 추가될 때마다 스크롤을 맨 아래로
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim() && onSendMessage) {
      onSendMessage({
        text: newMessage.trim(),
        type: 'chat',
        timestamp: Date.now()
      });
      setNewMessage('');
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    setIsTyping(e.target.value.length > 0);
  };

  const getMessageTypeClass = (messageType) => {
    switch (messageType) {
      case 'system':
        return 'chat-message-system';
      case 'action':
        return 'chat-message-action';
      case 'damage':
        return 'chat-message-damage';
      case 'chat':
      default:
        return 'chat-message-chat';
    }
  };

  const getPlayerTeamClass = (playerId) => {
    // 현재 플레이어와 같은 팀인지 확인하는 로직
    return playerId === currentPlayer?.id ? 'chat-message-own' : 'chat-message-other';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const isChatDisabled = battleStatus === 'finished';

  return (
    <motion.div 
      className={`chat-panel ${isMinimized ? 'chat-panel-minimized' : ''}`}
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* 채팅 헤더 */}
      <div className="chat-header" onClick={onToggleMinimize}>
        <div className="chat-title">
          <span>전투 채팅</span>
          {isMinimized && messages.length > 0 && (
            <span className="chat-unread-count">{messages.length}</span>
          )}
        </div>
        <button className="chat-minimize-btn">
          {isMinimized ? '열기' : '닫기'}
        </button>
      </div>

      {/* 채팅 내용 */}
      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            className="chat-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* 메시지 목록 */}
            <div className="chat-messages">
              <AnimatePresence>
                {messages.map((message, index) => (
                  <motion.div
                    key={`${message.timestamp}-${index}`}
                    className={`chat-message ${getMessageTypeClass(message.type)} ${
                      message.playerId ? getPlayerTeamClass(message.playerId) : ''
                    }`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="chat-message-header">
                      {message.playerName && (
                        <span className="chat-message-sender">
                          {message.playerName}
                        </span>
                      )}
                      <span className="chat-message-timestamp">
                        {formatTimestamp(message.timestamp)}
                      </span>
                    </div>
                    <div className="chat-message-text">
                      {message.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* 메시지 입력 */}
            <form className="chat-input-form" onSubmit={handleSendMessage}>
              <div className={`chat-input-container ${isTyping ? 'chat-input-typing' : ''}`}>
                <input
                  ref={inputRef}
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  placeholder={isChatDisabled ? "전투가 종료되었습니다" : "메시지를 입력하세요..."}
                  className="chat-input"
                  disabled={isChatDisabled}
                  maxLength={200}
                />
                <button
                  type="submit"
                  className="chat-send-btn"
                  disabled={!newMessage.trim() || isChatDisabled}
                >
                  전송
                </button>
              </div>
              {newMessage.length > 150 && (
                <div className="chat-char-count">
                  {newMessage.length}/200
                </div>
              )}
            </form>

            {/* 채팅 상태 표시 */}
            {battleStatus === 'in_progress' && (
              <div className="chat-status">
                <span className="chat-status-indicator"></span>
                전투 진행 중
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ChatPanel;
