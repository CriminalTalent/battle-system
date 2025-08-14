'use client';

import { motion } from 'framer-motion';
import { forwardRef } from 'react';

const Progress = forwardRef(({ 
  value = 0, 
  max = 100,
  className = "",
  indicatorClassName = "",
  showValue = false,
  animated = true,
  size = "normal", // "small", "normal", "large"
  variant = "default", // "default", "health", "danger"
  direction = "left-to-right" // "left-to-right", "right-to-left"
}, ref) => {
  // 값 정규화 (0-100)
  const normalizedValue = Math.max(0, Math.min(100, (value / max) * 100));
  
  // 크기별 스타일
  const sizeClasses = {
    small: "h-1",
    normal: "h-3", 
    large: "h-4"
  };
  
  // 변형별 색상
  const getVariantColor = () => {
    if (indicatorClassName) return indicatorClassName;
    
    switch (variant) {
      case "health":
        if (normalizedValue > 60) return "bg-green-500";
        if (normalizedValue > 30) return "bg-yellow-500"; 
        return "bg-red-500";
      case "danger":
        return "bg-red-500";
      default:
        return "bg-blue-500";
    }
  };
  
  // 방향별 스타일
  const getDirectionStyle = () => {
    if (direction === "right-to-left") {
      return {
        marginLeft: "auto",
        transformOrigin: "right"
      };
    }
    return {
      transformOrigin: "left"
    };
  };

  return (
    <div 
      ref={ref}
      className={`
        relative overflow-hidden rounded-full bg-gray-700 
        ${sizeClasses[size]} 
        ${className}
      `}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`진행률 ${normalizedValue.toFixed(1)}%`}
    >
      {/* 진행률 바 */}
      {animated ? (
        <motion.div
          className={`
            h-full rounded-full transition-colors duration-200
            ${getVariantColor()}
          `}
          style={getDirectionStyle()}
          initial={{ width: 0 }}
          animate={{ width: `${normalizedValue}%` }}
          transition={{
            duration: 0.8,
            ease: "easeOut"
          }}
        />
      ) : (
        <div
          className={`
            h-full rounded-full transition-all duration-300
            ${getVariantColor()}
          `}
          style={{
            width: `${normalizedValue}%`,
            ...getDirectionStyle()
          }}
        />
      )}
      
      {/* 글로우 효과 (health variant) */}
      {variant === "health" && normalizedValue > 0 && (
        <div
          className={`
            absolute inset-0 rounded-full opacity-50 blur-sm
            ${getVariantColor()}
          `}
          style={{
            width: `${normalizedValue}%`,
            ...getDirectionStyle()
          }}
        />
      )}
      
      {/* 값 텍스트 (선택적) */}
      {showValue && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-medium text-white drop-shadow-sm">
            {Math.round(normalizedValue)}%
          </span>
        </div>
      )}
      
      {/* 위험 상태 펄스 효과 */}
      {variant === "health" && normalizedValue <= 20 && normalizedValue > 0 && (
        <motion.div
          className="absolute inset-0 bg-red-500 rounded-full opacity-30"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          style={{
            width: `${normalizedValue}%`,
            ...getDirectionStyle()
          }}
        />
      )}
      
      {/* 세그먼트 표시 (선택적) */}
      {max > 100 && (
        <div className="absolute inset-0 flex">
          {Array.from({ length: Math.ceil(max / 25) }, (_, i) => (
            <div
              key={i}
              className="flex-1 border-r border-gray-600 last:border-r-0"
              style={{ opacity: 0.3 }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

Progress.displayName = "Progress";

// HP 전용 프리셋
export function HealthBar({ current, max, ...props }) {
  return (
    <Progress
      value={current}
      max={max}
      variant="health"
      animated={true}
      size="normal"
      {...props}
    />
  );
}

// 작은 HP 바 (리스트용)
export function SmallHealthBar({ current, max, ...props }) {
  return (
    <Progress
      value={current}
      max={max}
      variant="health"
      animated={true}
      size="small"
      {...props}
    />
  );
}

// 큰 HP 바 (메인 캐릭터용)
export function LargeHealthBar({ current, max, showValue = true, ...props }) {
  return (
    <Progress
      value={current}
      max={max}
      variant="health"
      animated={true}
      size="large"
      showValue={showValue}
      {...props}
    />
  );
}

// 시간 제한 바
export function TimerBar({ timeRemaining, totalTime, ...props }) {
  return (
    <Progress
      value={timeRemaining}
      max={totalTime}
      variant="danger"
      animated={false}
      direction="right-to-left"
      {...props}
    />
  );
}

// 로딩 바
export function LoadingBar({ progress, ...props }) {
  return (
    <Progress
      value={progress}
      variant="default"
      animated={true}
      showValue={true}
      {...props}
    />
  );
}

export default Progress;