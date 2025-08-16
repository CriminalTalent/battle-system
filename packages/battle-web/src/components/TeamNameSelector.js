// packages/battle-web/src/components/TeamNameSelector.js
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TeamNameSelector = ({ 
  templates = [], 
  selectedTemplate, 
  onTemplateSelect, 
  disabled = false 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleTemplateSelect = (template) => {
    if (!disabled && onTemplateSelect) {
      onTemplateSelect(template);
      setIsExpanded(false);
    }
  };

  const selectedTemplateData = templates.find(template => template.id === selectedTemplate);

  return (
    <div className="team-name-selector">
      <label className="block text-gray-700 text-sm font-bold mb-2">
        팀 이름 템플릿:
      </label>
      
      {/* 선택된 템플릿 표시 */}
      <div 
        className={`template-selected ${disabled ? 'disabled' : 'cursor-pointer'}`}
        onClick={() => !disabled && setIsExpanded(!isExpanded)}
      >
        {selectedTemplateData ? (
          <div className="template-preview">
            <div className="template-preview-info">
              <h4 className="template-preview-name">
                {getTemplateDisplayName(selectedTemplateData.id)}
              </h4>
              <div className="template-preview-teams">
                <span className="team-name-example team1">
                  {selectedTemplateData.team1Names[0]}
                </span>
                <span className="vs-text">vs</span>
                <span className="team-name-example team2">
                  {selectedTemplateData.team2Names[0]}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="template-placeholder">
            <div className="template-placeholder-text">
              <span>팀 이름 템플릿을 선택하세요</span>
              <p className="text-xs text-gray-500">클릭하여 선택</p>
            </div>
          </div>
        )}
        
        {!disabled && (
          <div className="template-selector-arrow">
            {isExpanded ? '▲' : '▼'}
          </div>
        )}
      </div>

      {/* 템플릿 목록 */}
      <AnimatePresence>
        {isExpanded && !disabled && (
          <motion.div
            className="template-grid"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="template-grid-container">
              {templates.map((template) => (
                <motion.div
                  key={template.id}
                  className={`template-option ${
                    selectedTemplate === template.id ? 'selected' : ''
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTemplateSelect(template)}
                >
                  <div className="template-option-header">
                    <h5 className="template-option-name">
                      {getTemplateDisplayName(template.id)}
                    </h5>
                    {selectedTemplate === template.id && (
                      <div className="template-option-selected-indicator">
                        ✓
                      </div>
                    )}
                  </div>
                  
                  <div className="template-option-preview">
                    <div className="team-examples">
                      <div className="team-column">
                        <span className="team-label">팀 1</span>
                        {template.team1Names.slice(0, 3).map((name, index) => (
                          <span key={index} className="team-name-mini team1">
                            {name}
                          </span>
                        ))}
                        {template.team1Names.length > 3 && (
                          <span className="team-name-more">+{template.team1Names.length - 3}</span>
                        )}
                      </div>
                      
                      <div className="vs-divider">vs</div>
                      
                      <div className="team-column">
                        <span className="team-label">팀 2</span>
                        {template.team2Names.slice(0, 3).map((name, index) => (
                          <span key={index} className="team-name-mini team2">
                            {name}
                          </span>
                        ))}
                        {template.team2Names.length > 3 && (
                          <span className="team-name-more">+{template.team2Names.length - 3}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 안내 메시지 */}
      {templates.length === 0 && (
        <div className="template-selector-empty">
          <p className="text-sm text-gray-500">사용 가능한 팀 이름 템플릿이 없습니다.</p>
        </div>
      )}

      {/* 설명 */}
      <div className="template-description">
        <p className="text-xs text-gray-600 mt-2">
          * 선택한 템플릿에서 랜덤으로 팀 이름이 배정됩니다
        </p>
      </div>
    </div>
  );
};

// 템플릿 ID를 사용자 친화적인 이름으로 변환
const getTemplateDisplayName = (templateId) => {
  const displayNames = {
    default: '기본 템플릿',
    fantasy: '판타지 테마',
    modern: '모던/사이버 테마',
    sports: '스포츠 테마'
  };
  return displayNames[templateId] || templateId.charAt(0).toUpperCase() + templateId.slice(1);
};

export default TeamNameSelector;
