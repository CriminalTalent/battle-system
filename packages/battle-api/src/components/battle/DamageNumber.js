'use client';

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export default function DamageNumber({ 
  damage, 
  critical = false, 
  type = 'damage', // 'damage', 'heal', 'miss', 'block'
  position = { x: 0, y: 0 },
  duration = 2000,
  onComplete
}) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onComplete) {
        setTimeout(onComplete, 300); // 애니메이션 완료 후 콜백
      }
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  // 타입별 스타일
  const getTypeStyle = () => {
    switch (type) {
      case 'damage':
        return {
          color: critical ? '#fbbf24' : '#ef4444', // 크리티컬은 노란색, 일반은 빨간색
          fontWeight: critical ? '900' : '700',
          textShadow: critical 
            ? '0 0 10px #fbbf24, 0 0 20px #fbbf24' 
            : '0 0 5px #ef4444',
          scale: critical ? 1.2 : 1
        };
      case 'heal':
        return {
          color: '#10b981', // 초록색
          fontWeight: '700',
          textShadow: '0 0 5px #10b981'
        };
      case 'miss':
        return {
          color: '#6b7280', // 회색
          fontWeight: '600',
          textShadow: '0 0 3px #6b7280'
        };
      case 'block':
        return {
          color: '#3b82f6', // 파란색
          fontWeight: '700',
          textShadow: '0 0 5px #3b82f6'
        };
      default:
        return {
          color: '#ffffff',
          fontWeight: '600'
        };
    }
  };

  // 애니메이션 변형
  const getAnimationVariants = () => {
    const baseY = -60;
    const randomX = (Math.random() - 0.5) * 40; // -20 ~ 20px 랜덤

    switch (type) {
      case 'damage':
        return {
          initial: { 
            opacity: 0, 
            scale: 0.5, 
            x: position.x, 
            y: position.y 
          },
          animate: { 
            opacity: [0, 1, 1, 0], 
            scale: critical ? [0.5, 1.3, 1.2, 1.1] : [0.5, 1.1, 1, 0.9],
            x: position.x + randomX, 
            y: position.y + baseY,
            rotate: critical ? [0, -5, 5, 0] : 0
          },
          transition: { 
            duration: duration / 1000,
            ease: "easeOut",
            times: [0, 0.2, 0.8, 1]
          }
        };
      
      case 'heal':
        return {
          initial: { 
            opacity: 0, 
            scale: 0.8, 
            x: position.x, 
            y: position.y 
          },
          animate: { 
            opacity: [0, 1, 1, 0], 
            scale: [0.8, 1.1, 1.05, 1],
            x: position.x, 
            y: position.y + baseY,
            rotate: [0, 2, -2, 0]
          },
          transition: { 
            duration: duration / 1000,
            ease: "easeOut",
            times: [0, 0.3, 0.7, 1]
          }
        };
      
      case 'miss':
        return {
          initial: { 
            opacity: 0, 
            scale: 1, 
            x: position.x, 
            y: position.y 
          },
          animate: { 
            opacity: [0, 1, 1, 0], 
            scale: [1, 1.1, 1, 0.9],
            x: position.x + randomX * 1.5, 
            y: position.y + baseY * 0.5,
            rotate: [0, 10, -10, 0]
          },
          transition: { 
            duration: (duration * 0.8) / 1000,
            ease: "easeInOut",
            times: [0, 0.2, 0.6, 1]
          }
        };
      
      case 'block':
        return {
          initial: { 
            opacity: 0, 
            scale: 0.9, 
            x: position.x, 
            y: position.y 
          },
          animate: { 
            opacity: [0, 1, 1, 0], 
            scale: [0.9, 1.2, 1, 0.8],
            x: position.x, 
            y: position.y + baseY * 0.7
          },
          transition: { 
            duration: (duration * 0.9) / 1000,
            ease: "easeOut",
            times: [0, 0.25, 0.75, 1]
          }
        };
      
      default:
        return {
          initial: { opacity: 0, y: position.y },
          animate: { opacity: [0, 1, 0], y: position.y + baseY },
          transition: { duration: duration / 1000 }
        };
    }
  };

  // 표시할 텍스트
  const getDisplayText = () => {
    switch (type) {
      case 'damage':
        return `-${damage}`;
      case 'heal':
        return `+${damage}`;
      case 'miss':
        return 'MISS';
      case 'block':
        return 'BLOCK';
      default:
        return damage.toString();
    }
  };

  // 크리티컬 추가 효과
  const getCriticalText = () => {
    if (!critical || type !== 'damage') return null;
    
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ 
          opacity: [0, 1, 1, 0],
          scale: [0.5, 1.2, 1, 0.8],
          y: [10, -20, -25, -30]
        }}
        transition={{ 
          duration: duration / 1000,
          delay: 0.1,
          times: [0, 0.3, 0.7, 1]
        }}
        className="absolute top-0 left-1/2 transform -translate-x-1/2"
        style={{
          color: '#fbbf24',
          fontSize: '0.75rem',
          fontWeight: '800',
          textShadow: '0 0 8px #fbbf24',
          letterSpacing: '0.1em'
        }}
      >
        CRITICAL!
      </motion.div>
    );
  };

  const variants = getAnimationVariants();
  const typeStyle = getTypeStyle();

  if (!isVisible) return null;

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)'
      }}
    >
      {/* 메인 데미지 숫자 */}
      <motion.div
        initial={variants.initial}
        animate={variants.animate}
        transition={variants.transition}
        className="relative flex items-center justify-center"
        style={{
          fontSize: critical ? '2rem' : '1.5rem',
          ...typeStyle,
          userSelect: 'none',
          fontFamily: 'monospace'
        }}
      >
        {getDisplayText()}
        
        {/* 크리티컬 텍스트 */}
        {getCriticalText()}
        
        {/* 글로우 효과 (크리티컬일 때) */}
        {critical && type === 'damage' && (
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{
              boxShadow: [
                '0 0 0px #fbbf24',
                '0 0 20px #fbbf24',
                '0 0 10px #fbbf24',
                '0 0 0px #fbbf24'
              ]
            }}
            transition={{
              duration: duration / 1000,
              times: [0, 0.3, 0.7, 1]
            }}
          />
        )}
      </motion.div>
      
      {/* 배경 글로우 */}
      <motion.div
        className="absolute inset-0 rounded-full blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.6, 0.4, 0] }}
        transition={{ 
          duration: duration / 1000,
          times: [0, 0.2, 0.8, 1]
        }}
        style={{
          backgroundColor: typeStyle.color,
          transform: 'scale(1.5)',
          zIndex: -1
        }}
      />
    </div>
  );
}

// 프리셋 컴포넌트들
export function CriticalDamage({ damage, position, onComplete }) {
  return (
    <DamageNumber
      damage={damage}
      critical={true}
      type="damage"
      position={position}
      duration={2500}
      onComplete={onComplete}
    />
  );
}

export function NormalDamage({ damage, position, onComplete }) {
  return (
    <DamageNumber
      damage={damage}
      critical={false}
      type="damage"
      position={position}
      duration={2000}
      onComplete={onComplete}
    />
  );
}

export function HealNumber({ amount, position, onComplete }) {
  return (
    <DamageNumber
      damage={amount}
      type="heal"
      position={position}
      duration={2000}
      onComplete={onComplete}
    />
  );
}

export function MissText({ position, onComplete }) {
  return (
    <DamageNumber
      damage={0}
      type="miss"
      position={position}
      duration={1500}
      onComplete={onComplete}
    />
  );
}

export function BlockText({ position, onComplete }) {
  return (
    <DamageNumber
      damage={0}
      type="block"
      position={position}
      duration={1800}
      onComplete={onComplete}
    />
  );
}

// 복합 데미지 표시 (여러 숫자 동시 표시)
export function MultipleDamageNumbers({ damages, basePosition, onComplete }) {
  return (
    <div className="absolute pointer-events-none">
      {damages.map((dmg, index) => (
        <DamageNumber
          key={index}
          damage={dmg.amount}
          critical={dmg.critical}
          type={dmg.type || 'damage'}
          position={{
            x: basePosition.x + (index - damages.length / 2) * 30,
            y: basePosition.y + index * 10
          }}
          duration={2000 + index * 200}
          onComplete={index === damages.length - 1 ? onComplete : undefined}
        />
      ))}
    </div>
  );
}