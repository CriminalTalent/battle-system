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
    attack_booster: '공격',
    defense_booster: '방어',
    health_potion: '회복'
  };

  const handleUseItem = (itemId) => {
    if (canUseItems && onUseItem) {
      onUseItem(itemId);
    }
  };

  return (
    <motion.div 
      className={`item-panel ${isMinimized ? 'item-panel-minimized' : ''}`}
      initial={{ opacity: 0, x: -300 }}
      animate={{
