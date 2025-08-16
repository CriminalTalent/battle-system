// packages/battle-web/src/components/battle/CharacterCard.js
// Merged CharacterCard with Spectator Mode + backward-compat for previous props
// - Supports both `player` (new battle UI) and `character` (legacy) prop shapes
// - Adds spectator UI (isSpectatorMode), selection states, current turn indicator
// - Keeps animationQueue/DamageNumber/Progress from legacy component
// - Uses framer-motion and heroicons (outline + solid Heart)
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Progress from '../ui/Progress';
import DamageNumber from './DamageNumber';

import { 
  HeartIcon, 
  ShieldCheckIcon, 
  BoltIcon, 
  EyeIcon,
  ClockIcon,
  StarIcon
} from '@heroicons/react/24/outline';
import { HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';

function normalizeInput({ player, character }) {
  // Prefer new `player` shape; fall back to legacy `character`
  const src = player ?? character ?? {};

  // Map common fields
  const name = src.name ?? 'Unknown';
  const hp = typeof src.hp === 'number' ? src.hp : 0;
  const maxHp = typeof src.maxHp === 'number' ? src.maxHp : Math.max(1, hp);
  const mp = typeof src.mp === 'number' ? src.mp : (src.maxMp ? src.maxMp : 0);
  const maxMp = typeof src.maxMp === 'number' ? src.maxMp : (mp || 0);

  // Image mapping
  const characterImage = src.characterImage
    ? (src.characterImage.imageUrl || `/images/characters/${src.characterImage.id}.png`)
    : (src.image || '/images/characters/default.png');
  const characterImageName = src.characterImage?.name || src.imageName || src.name || 'Character';

  // Stats mapping
  const attack = src.attack ?? src.stats?.attack ?? 0;
  const defense = src.defense ?? src.stats?.defense ?? 0;
  const agility = src.agility ?? src.stats?.speed ?? 0;

  // Effects mapping (new: activeEffects object, legacy: statusEffects array)
  const activeEffectsObj = src.activeEffects || {};
  const statusEffectsArr = src.statusEffects || [];
  // Normalize to array of chips for rendering
  const effects = Object.entries(activeEffectsObj).map(([id, e]) => ({
    id,
    type: e.type || 'unknown',
    name: e.name || '효과',
    remainingTurns: e.remainingTurns ?? null
  })).concat(
    statusEffectsArr.map((e, idx) => ({
      id: `legacy-${idx}`,
      type: e.type || 'unknown',
      name: e.source || e.type || '효과',
      remainingTurns: e.duration ?? null
    }))
  );

  return {
    id: src.id,
    team: src.team,
    position: src.position,
    name,
    hp,
    maxHp,
    mp,
    maxMp,
    attack,
    defense,
    agility,
    isAlive: (src.isAlive !== undefined ? src.isAlive : (hp > 0 && src.status !== 'dead')),
    imageUrl: characterImage,
    imageName: characterImageName,
    effects
  };
}

export default function CharacterCard({
  player,
  character,             // backward-compat
  isOpponent = false,
  isActive = false,
  isCurrentPlayer = false, // new
  isSpectatorMode = false, // new
  onClick = null,          // new
  isSelectable = false,    // new
  isSelected = false,      // new
  animationQueue = [],     // legacy
  showStats = false,       // legacy (overridden by spectator mode)
  size = 'normal'          // 'small', 'normal', 'large'
}) {
  const data = normalizeInput({ player, character });
  const hpPercentage = Math.max(0, (data.hp / (data.maxHp || 1)) * 100);
  const isAlive = data.isAlive;
  const cardRef = useRef(null);

  // local animation state (legacy support)
  const [currentAnimations, setCurrentAnimations] = useState([]);
  useEffect(() => {
    if (animationQueue.length > 0) {
      const newAnimations = animationQueue.filter(
        anim => !currentAnimations.find(curr => curr.id === anim.id)
      );
      if (newAnimations.length > 0) {
        setCurrentAnimations(prev => [...prev, ...newAnimations]);
        newAnimations.forEach(anim => {
          setTimeout(() => {
            setCurrentAnimations(prev => prev.filter(curr => curr.id !== anim.id));
          }, 2000);
        });
      }
    }
  }, [animationQueue, currentAnimations]);

  const getHpBarColor = () => {
    if (hpPercentage > 60) return 'from-green-500 to-green-400';
    if (hpPercentage > 30) return 'from-yellow-500 to-yellow-400';
    return 'from-red-500 to-red-400';
  };

  const getHpSolidColor = () => {
    if (hpPercentage > 60) return 'bg-green-500';
    if (hpPercentage > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const showDetailedStats = !isSpectatorMode && (showStats || true); // show basic ATK/DEF/AGI by default in player mode

  const getCardSize = () => {
    switch (size) {
      case 'small':
        return { container: 'w-56', image: 'h-28', name: 'text-sm', hp: 'text-xs', padding: 'p-3' };
      case 'large':
        return { container: 'w-96', image: 'h-60', name: 'text-xl', hp: 'text-sm', padding: 'p-5' };
      default:
        return { container: 'w-72', image: 'h-40', name: 'text-lg', hp: 'text-sm', padding: 'p-4' };
    }
  };
  const cardSize = getCardSize();

  const cardVariants = {
    idle: { scale: 1, y: 0 },
    active: { scale: 1.03, y: -6, transition: { type: 'spring', stiffness: 280, damping: 22 } },
    damage: { x: [0, -10, 10, -5, 5, 0], transition: { duration: 0.5 } },
    critical: { scale: [1, 1.2, 1], rotate: [0, -5, 5, 0], transition: { duration: 0.6 } }
  };

  return (
    <div className="relative">
      <motion.div
        ref={cardRef}
        variants={cardVariants}
        initial="idle"
        animate={isActive ? 'active' : 'idle'}
        onClick={onClick}
        className={`
          ${cardSize.container}
          relative rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer
          ${isSpectatorMode 
            ? 'bg-white/5 border-white/10 hover:bg-white/10' 
            : isSelectable
              ? (isSelected ? 'bg-blue-500/20 border-blue-500/50 hover:bg-blue-500/30'
                            : 'bg-white/10 border-white/20 hover:bg-white/20')
              : 'bg-white/10 border-white/20 hover:bg-white/15'
          }
          ${isActive ? 'shadow-blue-400/30 shadow-lg' : ''}
          ${!isAlive ? 'opacity-60' : ''}
        `}
      >
        {/* Spectator badge */}
        {isSpectatorMode && (
          <div className="absolute top-2 right-2 z-10">
            <EyeIcon className="w-4 h-4 text-purple-400 opacity-70" />
          </div>
        )}

        {/* Current turn indicator */}
        {isCurrentPlayer && (
          <motion.div
            className="absolute -top-2 -right-2 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center z-10"
            animate={{ scale: [1, 1.2, 1], rotate: [0, 360] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ClockIcon className="w-3 h-3 text-yellow-900" />
          </motion.div>
        )}

        {/* Death overlay */}
        {!isAlive && (
          <div className="absolute inset-0 bg-red-900/50 rounded-xl flex items-center justify-center backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <HeartIcon className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-red-200 font-bold text-sm">전투 불능</p>
            </div>
          </div>
        )}

        {/* Image */}
        <div className="relative overflow-hidden">
          <img
            src={data.imageUrl}
            alt={data.imageName}
            className={`${cardSize.image} w-full object-cover transition-all duration-300 ${!isAlive ? 'grayscale' : ''}`}
            onError={(e) => { e.currentTarget.src = '/images/characters/default.png'; }}
          />
          {/* Active glow */}
          {isActive && isAlive && (
            <motion.div
              className="absolute inset-0 bg-blue-400/10"
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}
        </div>

        {/* Content */}
        <div className={`${cardSize.padding} space-y-3`}>
          {/* Header (name + optional position) */}
          <div className="flex items-center space-x-3">
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-white truncate">{data.name}</h4>

              {/* HP bar */}
              <div className="mt-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white/60">HP</span>
                  <span className="text-xs text-white font-mono">
                    {data.hp} / {data.maxHp}
                  </span>
                </div>
                {/* If Progress component exists, use it; also animate width bar for extra smoothness */}
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <motion.div
                    className={`h-2 rounded-full bg-gradient-to-r ${getHpBarColor()}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${hpPercentage}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              </div>

              {/* MP (only if provided) */}
              {data.maxMp > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/60">MP</span>
                    <span className="text-xs text-white font-mono">
                      {data.mp} / {data.maxMp}
                    </span>
                  </div>
                  <Progress value={Math.max(0, (data.mp / data.maxMp) * 100)} className="h-2" indicatorClassName="bg-blue-500" />
                </div>
              )}
            </div>

            {/* Position badge (hide in spectator) */}
            {!isSpectatorMode && data.position !== undefined && (
              <div className="relative">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center border border-white/20">
                  <span className="text-xs text-white font-bold">{String(data.position)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Stats */}
          {(!isSpectatorMode) ? (
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="bg-red-500/20 rounded-lg p-2 text-center">
                <div className="text-red-300 text-xs mb-1">공격</div>
                <div className="text-white font-bold">{data.attack}</div>
              </div>
              <div className="bg-blue-500/20 rounded-lg p-2 text-center">
                <div className="text-blue-300 text-xs mb-1">방어</div>
                <div className="text-white font-bold">{data.defense}</div>
              </div>
              <div className="bg-green-500/20 rounded-lg p-2 text-center">
                <div className="text-green-300 text-xs mb-1">민첩</div>
                <div className="text-white font-bold">{data.agility}</div>
              </div>
            </div>
          ) : (
            <div className="flex justify-between text-xs text-white/60">
              <span>ATK: {data.attack}</span>
              <span>DEF: {data.defense}</span>
              <span>AGI: {data.agility}</span>
            </div>
          )}

          {/* Effects */}
          {data.effects.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-white/60 flex items-center">
                <StarIcon className="w-3 h-3 mr-1" />
                활성 효과
              </div>
              <div className="flex flex-wrap gap-1">
                {data.effects.map((effect) => (
                  <motion.div
                    key={effect.id}
                    className={`px-2 py-1 rounded-full text-xs flex items-center space-x-1 ${
                      isSpectatorMode
                        ? 'bg-purple-500/20 text-purple-300'
                        : effect.type === 'attack_boost'
                          ? 'bg-red-500/20 text-red-300'
                          : effect.type === 'defense_boost'
                            ? 'bg-blue-500/20 text-blue-300'
                            : effect.type === 'agility_boost'
                              ? 'bg-green-500/20 text-green-300'
                              : 'bg-purple-500/20 text-purple-300'
                    }`}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    title={effect.name}
                  >
                    <span>{effect.name || '효과'}</span>
                    {effect.remainingTurns != null && (
                      <span className="bg-white/20 rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                        {effect.remainingTurns}
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Selectable prompt */}
          {isSelectable && (
            <div className="text-center">
              <div className={`text-xs font-medium ${isSelected ? 'text-blue-300' : 'text-white/60'}`}>
                {isSelected ? '선택됨' : '클릭하여 선택'}
              </div>
            </div>
          )}

          {/* Spectator-only footer */}
          {isSpectatorMode && (
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-xs text-white/50">
                <div className="flex items-center space-x-1">
                  <EyeIcon className="w-3 h-3" />
                  <span>관전 중</span>
                </div>
                {data.imageName && <span>{data.imageName}</span>}
              </div>
            </div>
          )}
        </div>

        {/* Legacy death overlay (keep subtle) */}
        {!isAlive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 pointer-events-none"
          />
        )}
      </motion.div>

      {/* Damage numbers (legacy) */}
      <AnimatePresence>
        {currentAnimations.map((animation) => (
          <DamageNumber
            key={animation.id}
            damage={animation.damage}
            critical={animation.critical}
            type={animation.type}
            position={{
              x: cardRef.current ? cardRef.current.offsetWidth / 2 : 0,
              y: cardRef.current ? cardRef.current.offsetHeight / 3 : 0
            }}
          />
        ))}
      </AnimatePresence>

      {/* Active border glow */}
      {isActive && isAlive && (
        <div className="absolute -inset-1 bg-blue-400/30 rounded-xl blur-sm -z-10" />
      )}
    </div>
  );
}

// Presets (backward-compat)
export function SmallCharacterCard(props) { return <CharacterCard {...props} size="small" />; }
export function LargeCharacterCard(props) { return <CharacterCard {...props} size="large" />; }
export function SpectatorCharacterCard(props) { return <CharacterCard {...props} isSpectatorMode={true} showStats={true} />; }
