// packages/battle-web/src/components/ItemPanel.js
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ItemPanel = ({ 
  items = [], 
  activeEffects = {},
  onUseItem, 
  onToggleMinimize,
  isMinimized,
  canUseItems = false
}) => {
  const itemIcons = {
    attack_booster: '공격 보정기',
    defense_booster: '방어 보정기',
    health_potion: '회복 물약'
  };

  const handleUseItem = (itemId) => {
    if (canUseItems && onUseItem) {
      onUseItem(itemId);
    }
  };

  const hasActiveEffects = Object.keys(activeEffects).length > 0;

  return (
    <motion.div 
      className={`item-panel ${isMinimized ? 'item-panel-minimized' : ''}`}
      initial={{ opacity: 0, x: -300 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* 아이템 패널 헤더 */}
      <div className="item-header" onClick={onToggleMinimize}>
        <div className="item-title">
          팀 아이템
          {items.length > 0 && !isMinimized && (
            <span className="ml-2 text-xs opacity-75">({items.length})</span>
          )}
        </div>
        <button className="chat-minimize-btn">
          {isMinimized ? '열기' : '닫기'}
        </button>
      </div>

      {/* 아이템 패널 내용 */}
      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            className="item-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* 아이템 목록 */}
            {items.length > 0 ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    className="item-slot"
                    whileHover={{ scale: 1.02 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="item-slot-info">
                      <div className="item-slot-icon">
                        {itemIcons[item.id] || '아이템'}
                      </div>
                      <div className="item-slot-details">
                        <h4>{item.name}</h4>
                        <p>{item.description}</p>
                      </div>
                    </div>
                    
                    <div className="item-slot-quantity">
                      x{item.quantity}
                    </div>
                    
                    <button
                      onClick={() => handleUseItem(item.id)}
                      disabled={!canUseItems}
                      className="item-use-btn"
                      title={!canUseItems ? '자신의 턴에만 사용 가능합니다' : '아이템 사용'}
                    >
                      사용
                    </button>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">사용 가능한 아이템이 없습니다</p>
              </div>
            )}

            {/* 활성화된 효과 표시 */}
            {hasActiveEffects && (
              <motion.div
                className="active-effects"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <h4>활성화된 효과</h4>
                {Object.entries(activeEffects).map(([effectId, effect]) => (
                  <div key={effectId} className="effect-item">
                    <span>{effect.name}</span>
                    <span className="effect-duration">
                      {effect.remainingTurns}턴 남음
                    </span>
                  </div>
                ))}
              </motion.div>
            )}

            {/* 사용 안내 */}
            {!canUseItems && items.length > 0 && (
              <div className="mt-4 p-3 bg-yellow-900 bg-opacity-20 border border-yellow-700 border-opacity-30 rounded-lg">
                <p className="text-xs text-yellow-300">
                  자신의 턴에만 아이템을 사용할 수 있습니다
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ItemPanel;
