'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Progress from '../ui/Progress';
import DamageNumber from './DamageNumber';

export default function CharacterCard({ 
  character, 
  isOpponent = false, 
  isActive = false,
  animationQueue = [],
  showStats = false,
  size = 'normal' // 'small', 'normal', 'large'
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [currentAnimations, setCurrentAnimations] = useState([]);
  const cardRef = useRef(null);

  // 애니메이션 큐 처리
  useEffect(() => {
    if (animationQueue.length > 0) {
      const newAnimations = animationQueue.filter(
        anim => !currentAnimations.find(curr => curr.id === anim.id)
      );
      
      if (newAnimations.length > 0) {
        setCurrentAnimations(prev => [...prev, ...newAnimations]);
        
        // 애니메이션 자동 제거
        newAnimations.forEach(anim => {
          setTimeout(() => {
            setCurrentAnimations(prev => prev.filter(curr => curr.id !== anim.id));
          }, 2000);
        });
      }
    }
  }, [animationQueue, currentAnimations]);

  const getHpPercentage = () => {
    return Math.max(0, (character.hp / character.maxHp) * 100);
  };

  const getMpPercentage = () => {
    return Math.max(0, (character.mp / character.maxMp) * 100);
  };

  const getHpColor = () => {
    const percentage = getHpPercentage();
    if (percentage > 60) return 'bg-green-500';
    if (percentage > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getCardSize = () => {
    switch (size) {
      case 'small':
        return {
          container: 'w-48 h-64',
          image: 'h-32',
          name: 'text-sm',
          hp: 'text-xs'
        };
      case 'large':
        return {
          container: 'w-80 h-96',
          image: 'h-56',
          name: 'text-xl',
          hp: 'text-sm'
        };
      default:
        return {
          container: 'w-64 h-80',
          image: 'h-44',
          name: 'text-lg',
          hp: 'text-sm'
        };
    }
  };

  const cardSize = getCardSize();

  const cardVariants = {
    idle: {
      scale: 1,
      y: 0,
      rotateY: isOpponent ? 0 : 0,
    },
    active: {
      scale: 1.05,
      y: -10,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 20
      }
    },
    damage: {
      x: [0, -10, 10, -5, 5, 0],
      transition: { duration: 0.5 }
    },
    critical: {
      scale: [1, 1.2, 1],
      rotate: [0, -5, 5, 0],
      transition: { duration: 0.6 }
    }
  };

  const getImageFallback = () => {
    return (
      <div className={`${cardSize.image} bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center`}>
        <div className="text-gray-400 text-center">
          <div className="w-16 h-16 mx-auto mb-2 bg-gray-700 rounded-full flex items-center justify-center">
            <span className="text-2xl">?</span>
          </div>
          <p className="text-xs">이미지 없음</p>
        </div>
      </div>
    );
  };

  return (
    <div className="relative">
      {/* 메인 캐릭터 카드 */}
      <motion.div
        ref={cardRef}
        variants={cardVariants}
        initial="idle"
        animate={isActive ? "active" : "idle"}
        className={`
          ${cardSize.container} 
          relative bg-gradient-to-br from-gray-800 to-gray-900 
          rounded-xl shadow-2xl border-2 overflow-hidden
          ${isActive ? 'border-blue-400 shadow-blue-400/50' : 'border-gray-600'}
          ${character.hp <= 0 ? 'grayscale opacity-50' : ''}
        `}
      >
        {/* 연결 상태 표시 */}
        <div className="absolute top-2 right-2 z-10">
          <div 
            className={`w-3 h-3 rounded-full ${
              character.connected ? 'bg-green-400' : 'bg-red-400'
            }`}
            title={character.connected ? '연결됨' : '연결 끊김'}
          />
        </div>

        {/* 캐릭터 이미지 */}
        <div className="relative overflow-hidden">
          {!imageError ? (
            <img
              src={character.image}
              alt={character.name}
              className={`${cardSize.image} w-full object-cover transition-all duration-300`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              style={{
                filter: character.hp <= 0 ? 'grayscale(100%)' : 'none'
              }}
            />
          ) : (
            getImageFallback()
          )}
          
          {/* 로딩 오버레이 */}
          {!imageLoaded && !imageError && (
            <div className={`${cardSize.image} absolute inset-0 bg-gray-700 animate-pulse`} />
          )}

          {/* 액티브 글로우 이펙트 */}
          {isActive && (
            <motion.div
              className="absolute inset-0 bg-blue-400/20"
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}
        </div>

        {/* 캐릭터 정보 */}
        <div className="p-4 flex-1">
          {/* 이름 */}
          <h3 className={`${cardSize.name} font-bold text-white mb-3 text-center truncate`}>
            {character.name}
          </h3>

          {/* HP 바 */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className={`${cardSize.hp} text-gray-300 font-medium`}>HP</span>
              <span className={`${cardSize.hp} text-white font-mono`}>
                {character.hp}/{character.maxHp}
              </span>
            </div>
            <Progress
              value={getHpPercentage()}
              className="h-3"
              indicatorClassName={getHpColor()}
            />
          </div>

          {/* MP 바 */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className={`${cardSize.hp} text-gray-300 font-medium`}>MP</span>
              <span className={`${cardSize.hp} text-white font-mono`}>
                {character.mp}/{character.maxMp}
              </span>
            </div>
            <Progress
              value={getMpPercentage()}
              className="h-3"
              indicatorClassName="bg-blue-500"
            />
          </div>

          {/* 상태 효과 (간단한 표시) */}
          {character.statusEffects && character.statusEffects.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {character.statusEffects.slice(0, 3).map((effect, index) => (
                <span
                  key={index}
                  className={`px-2 py-1 text-xs rounded-full ${
                    effect.type === 'buff' 
                      ? 'bg-green-600 text-green-100' 
                      : effect.type === 'debuff'
                      ? 'bg-red-600 text-red-100'
                      : 'bg-blue-600 text-blue-100'
                  }`}
                  title={effect.source || effect.type}
                >
                  {effect.type === 'buff' ? '+' : effect.type === 'debuff' ? '-' : ''}
                  {effect.duration}
                </span>
              ))}
              {character.statusEffects.length > 3 && (
                <span className="px-2 py-1 text-xs rounded-full bg-gray-600 text-gray-100">
                  +{character.statusEffects.length - 3}
                </span>
              )}
            </div>
          )}

          {/* 스탯 정보 (선택적) */}
          {showStats && character.stats && (
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
              <div>공격: {character.stats.attack}</div>
              <div>방어: {character.stats.defense}</div>
              <div>속도: {character.stats.speed}</div>
              <div>운: {character.stats.luck}</div>
            </div>
          )}

          {/* 전투 통계 (선택적) */}
          {character.battleStats && showStats && (
            <div className="mt-2 pt-2 border-t border-gray-600 text-xs text-gray-400">
              <div className="grid grid-cols-2 gap-1">
                <div>데미지: {character.battleStats.damageDealt}</div>
                <div>받은피해: {character.battleStats.damageTaken}</div>
                <div>크리티컬: {character.battleStats.criticalHits}</div>
                <div>액션: {character.battleStats.actionsUsed}</div>
              </div>
            </div>
          )}
        </div>

        {/* 사망 오버레이 */}
        {character.hp <= 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60 flex items-center justify-center"
          >
            <div className="text-red-400 font-bold text-2xl">패배</div>
          </motion.div>
        )}
      </motion.div>

      {/* 데미지 숫자 애니메이션 */}
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

      {/* 액티브 테두리 효과 */}
      {isActive && character.hp > 0 && (
        <div className="absolute -inset-1 bg-blue-400/30 rounded-xl blur-sm -z-10" />
      )}

      {/* 호버 효과 (데스크톱) */}
      <style jsx>{`
        @media (hover: hover) {
          .character-card:hover {
            transform: translateY(-5px);
            transition: transform 0.2s ease;
          }
        }
      `}</style>
    </div>
  );
}

// 프리셋 컴포넌트들
export function SmallCharacterCard(props) {
  return <CharacterCard {...props} size="small" />;
}

export function LargeCharacterCard(props) {
  return <CharacterCard {...props} size="large" />;
}

export function SpectatorCharacterCard(props) {
  return <CharacterCard {...props} showStats={true} />;
}