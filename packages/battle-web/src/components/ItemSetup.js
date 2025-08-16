// packages/battle-web/src/components/ItemSetup.js
import React, { useState } from 'react';
import { motion } from 'framer-motion';

const ItemSetup = ({ onItemsChange, disabled = false }) => {
  const [selectedItems, setSelectedItems] = useState({
    attack_booster: 0,
    defense_booster: 0,
    health_potion: 0
  });

  const itemDefinitions = {
    attack_booster: {
      id: 'attack_booster',
      name: '공격 보정기',
      description: '공격력을 15 증가시킵니다 (3턴 지속)',
      maxQuantity: 3,
      icon: '공격 보정기'
    },
    defense_booster: {
      id: 'defense_booster',
      name: '방어 보정기',
      description: '방어력을 10 증가시킵니다 (3턴 지속)',
      maxQuantity: 3,
      icon: '방어 보정기'
    },
    health_potion: {
      id: 'health_potion',
      name: '회복 물약',
      description: 'HP를 30 회복합니다',
      maxQuantity: 3,
      icon: '회복 물약'
    }
  };

  const handleItemChange = (itemId, quantity) => {
    const newItems = {
      ...selectedItems,
      [itemId]: Math.max(0, Math.min(quantity, itemDefinitions[itemId].maxQuantity))
    };
    
    setSelectedItems(newItems);
    
    // 0이 아닌 아이템만 전달
    const filteredItems = Object.fromEntries(
      Object.entries(newItems).filter(([key, value]) => value > 0)
    );
    
    onItemsChange(filteredItems);
  };

  const getTotalItems = () => {
    return Object.values(selectedItems).reduce((sum, count) => sum + count, 0);
  };

  const maxTotalItems = 6; // 최대 6개 아이템

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="item-setup-container"
    >
      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-700 mb-2">
          팀 아이템 설정 ({getTotalItems()}/{maxTotalItems})
        </h3>
        <p className="text-sm text-gray-600 mb-3">
          * 아이템은 팀원들과 공유되며, 상대방에게는 보이지 않습니다
        </p>
        <p className="text-xs text-gray-500 mb-4">
          * 첫 번째 참가자만 아이템을 설정할 수 있습니다
        </p>
      </div>

      <div className="space-y-4">
        {Object.entries(itemDefinitions).map(([itemId, item]) => (
          <motion.div
            key={itemId}
            className="item-card"
            whileHover={{ scale: disabled ? 1 : 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center justify-between p-4 bg-white border-2 border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
              <div className="flex items-center space-x-4 flex-1">
                <div className="item-icon text-2xl">
                  {item.icon}
                </div>
                <div className="item-info flex-1">
                  <h4 className="font-semibold text-gray-800">{item.name}</h4>
                  <p className="text-sm text-gray-600">{item.description}</p>
                </div>
              </div>
              
              <div className="item-controls flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleItemChange(itemId, selectedItems[itemId] - 1)}
                  disabled={disabled || selectedItems[itemId] <= 0}
                  className="quantity-btn quantity-btn-minus"
                >
                  -
                </button>
                
                <span className="quantity-display">
                  {selectedItems[itemId]}
                </span>
                
                <button
                  type="button"
                  onClick={() => handleItemChange(itemId, selectedItems[itemId] + 1)}
                  disabled={
                    disabled || 
                    selectedItems[itemId] >= item.maxQuantity || 
                    getTotalItems() >= maxTotalItems
                  }
                  className="quantity-btn quantity-btn-plus"
                >
                  +
                </button>
              </div>
            </div>
            
            {selectedItems[itemId] > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="selected-indicator"
              >
                <div className="mt-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                  선택됨: {selectedItems[itemId]}개
                </div>
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>

      {getTotalItems() >= maxTotalItems && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
        >
          <p className="text-sm text-yellow-700">
            최대 아이템 개수에 도달했습니다 ({maxTotalItems}개)
          </p>
        </motion.div>
      )}

      <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <h4 className="font-semibold text-gray-700 mb-2">아이템 사용 규칙:</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 아이템은 자신의 턴에 사용할 수 있습니다</li>
          <li>• 보정기는 중복 사용할 수 없습니다</li>
          <li>• 회복 물약은 HP가 가득 찬 상태에서도 사용 가능합니다</li>
          <li>• 팀원 누구나 아이템을 사용할 수 있습니다</li>
        </ul>
      </div>
    </motion.div>
  );
};

export default ItemSetup;
