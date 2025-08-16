// packages/battle-web/src/components/CharacterSelector.js
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const CharacterSelector = ({ 
  characters = [], 
  selectedCharacter, 
  onCharacterSelect, 
  disabled = false 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCharacterSelect = (character) => {
    if (!disabled && onCharacterSelect) {
      onCharacterSelect(character);
      setIsExpanded(false);
    }
  };

  const selectedCharacterData = characters.find(char => char.id === selectedCharacter);

  return (
    <div className="character-selector">
      <label className="block text-gray-700 text-sm font-bold mb-2">
        캐릭터 선택:
      </label>
      
      {/* 선택된 캐릭터 표시 */}
      <div 
        className={`character-selected ${disabled ? 'disabled' : 'cursor-pointer'}`}
        onClick={() => !disabled && setIsExpanded(!isExpanded)}
      >
        {selectedCharacterData ? (
          <div className="character-preview">
            <img 
              src={selectedCharacterData.imageUrl} 
              alt={selectedCharacterData.name}
              className="character-preview-image"
              onError={(e) => {
                e.target.src = '/images/characters/default.png';
              }}
            />
            <div className="character-preview-info">
              <h4 className="character-preview-name">{selectedCharacterData.name}</h4>
              <p className="character-preview-description">{selectedCharacterData.description}</p>
            </div>
          </div>
        ) : (
          <div className="character-placeholder">
            <div className="character-placeholder-icon">캐릭터 선택</div>
            <div className="character-placeholder-text">
              <span>캐릭터를 선택하세요</span>
              <p className="text-xs text-gray-500">클릭하여 선택</p>
            </div>
          </div>
        )}
        
        {!disabled && (
          <div className="character-selector-arrow">
            {isExpanded ? '▲' : '▼'}
          </div>
        )}
      </div>

      {/* 캐릭터 목록 */}
      <AnimatePresence>
        {isExpanded && !disabled && (
          <motion.div
            className="character-grid"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="character-grid-container">
              {characters.map((character) => (
                <motion.div
                  key={character.id}
                  className={`character-option ${
                    selectedCharacter === character.id ? 'selected' : ''
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleCharacterSelect(character)}
                >
                  <div className="character-option-image-container">
                    <img 
                      src={character.imageUrl} 
                      alt={character.name}
                      className="character-option-image"
                      onError={(e) => {
                        e.target.src = '/images/characters/default.png';
                      }}
                    />
                    {selectedCharacter === character.id && (
                      <div className="character-option-selected-overlay">
                        ✓
                      </div>
                    )}
                  </div>
                  <div className="character-option-info">
                    <h5 className="character-option-name">{character.name}</h5>
                    <p className="character-option-description">{character.description}</p>
                  </div>
                </motion.div>
              ))}
              
              {/* 캐릭터 없음 옵션 */}
              <motion.div
                className={`character-option ${
                  selectedCharacter === null ? 'selected' : ''
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleCharacterSelect(null)}
              >
                <div className="character-option-image-container">
                  <div className="character-option-default">
                  </div>
                  {selectedCharacter === null && (
                    <div className="character-option-selected-overlay">
                      ✓
                    </div>
                  )}
                </div>
                <div className="character-option-info">
                  <h5 className="character-option-name">기본</h5>
                  <p className="character-option-description">캐릭터 이미지 없음</p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 안내 메시지 */}
      {characters.length === 0 && (
        <div className="character-selector-empty">
          <p className="text-sm text-gray-500">사용 가능한 캐릭터 이미지가 없습니다.</p>
        </div>
      )}
    </div>
  );
};

export default CharacterSelector;
