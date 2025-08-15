import React from 'react';
import { motion } from 'framer-motion';

/**
 * 전투 시스템용 Button 컴포넌트
 */
const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  shortcut,
  onClick,
  className = '',
  ...rest
}) => {
  // 버튼 스타일 정의
  const baseStyles = `
    relative inline-flex items-center justify-center
    font-medium rounded-xl transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:cursor-not-allowed disabled:opacity-50
    select-none
    ${fullWidth ? 'w-full' : ''}
  `;
  
  // 크기별 스타일
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
    xl: 'px-8 py-4 text-xl'
  };
  
  // 변형별 스타일
  const variantStyles = {
    primary: `bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl
              focus:ring-red-500 ${!disabled ? 'active:bg-red-800' : ''}`,
    secondary: `bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl
                focus:ring-blue-500 ${!disabled ? 'active:bg-blue-800' : ''}`,
    success: `bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl
              focus:ring-green-500 ${!disabled ? 'active:bg-green-800' : ''}`,
    danger: `bg-red-700 hover:bg-red-800 text-white shadow-lg hover:shadow-xl
             focus:ring-red-600 ${!disabled ? 'active:bg-red-900' : ''}`,
    warning: `bg-yellow-600 hover:bg-yellow-700 text-white shadow-lg hover:shadow-xl
              focus:ring-yellow-500 ${!disabled ? 'active:bg-yellow-800' : ''}`,
    ghost: `bg-transparent hover:bg-white/10 text-white border border-white/20 hover:border-white/40
            focus:ring-white/50`,
    outline: `bg-transparent hover:bg-gray-50 text-gray-700 border border-gray-300 hover:border-gray-400
              focus:ring-gray-500`,
    disabled: 'bg-gray-400 text-gray-200 cursor-not-allowed'
  };

  // 버튼 애니메이션 설정
  const buttonVariants = {
    idle: { 
      scale: 1,
      boxShadow: variant === 'ghost' ? 'none' : '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    },
    hover: { 
      scale: disabled ? 1 : 1.02,
      boxShadow: disabled ? undefined : 
        variant === 'ghost' ? 'none' : '0 10px 15px -3px rgba(0, 0, 0, 0.2)'
    },
    tap: { 
      scale: disabled ? 1 : 0.98,
      transition: { duration: 0.1 }
    }
  };

  // 로딩 스피너 컴포넌트
  const LoadingSpinner = () => (
    <motion.div
      className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    />
  );

  // 단축키 배지 컴포넌트
  const ShortcutBadge = ({ shortcut }) => (
    <span className="ml-2 px-1.5 py-0.5 bg-black/20 rounded text-xs font-mono">
      {shortcut}
    </span>
  );

  const finalVariant = disabled ? 'disabled' : variant;
  const combinedClassName = `${baseStyles} ${sizeStyles[size]} ${variantStyles[finalVariant]} ${className}`;

  return (
    <motion.button
      className={combinedClassName}
      variants={buttonVariants}
      initial="idle"
      whileHover="hover"
      whileTap="tap"
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {/* 배경 글로우 효과 */}
      {!disabled && variant !== 'ghost' && (
        <motion.div
          className="absolute inset-0 rounded-xl opacity-0"
          style={{
            background: `radial-gradient(circle, ${
              variant === 'primary' ? '#ef4444' :
              variant === 'secondary' ? '#3b82f6' :
              variant === 'success' ? '#10b981' :
              variant === 'danger' ? '#dc2626' :
              variant === 'warning' ? '#f59e0b' : 'transparent'
            }40 0%, transparent 70%)`
          }}
          whileHover={{ opacity: 0.3 }}
          transition={{ duration: 0.2 }}
        />
      )}

      {/* 버튼 내용 */}
      <span className="relative flex items-center justify-center gap-2">
        {/* 로딩 상태 */}
        {loading && <LoadingSpinner />}
        
        {/* 왼쪽 아이콘 */}
        {leftIcon && !loading && (
          <span className="flex-shrink-0">
            {leftIcon}
          </span>
        )}

        {/* 텍스트 내용 */}
        {children && (
          <span className={`flex items-center ${loading ? 'opacity-0' : ''}`}>
            {children}
          </span>
        )}

        {/* 오른쪽 아이콘 */}
        {rightIcon && !loading && (
          <span className="flex-shrink-0">
            {rightIcon}
          </span>
        )}

        {/* 단축키 표시 */}
        {shortcut && !loading && (
          <ShortcutBadge shortcut={shortcut} />
        )}
      </span>

      {/* 리플 효과 */}
      <motion.div
        className="absolute inset-0 rounded-xl overflow-hidden"
        style={{ pointerEvents: 'none' }}
      >
        <motion.div
          className="absolute inset-0 bg-white/20 rounded-full scale-0"
          whileTap={{
            scale: disabled ? 0 : 4,
            opacity: [0.5, 0],
            transition: { duration: 0.4 }
          }}
        />
      </motion.div>
    </motion.button>
  );
};

// 특화된 버튼 컴포넌트들
export const AttackButton = (props) => (
  <Button variant="primary" {...props} />
);

export const DefendButton = (props) => (
  <Button variant="secondary" {...props} />
);

export const SkillButton = (props) => (
  <Button variant="warning" {...props} />
);

export const DangerButton = (props) => (
  <Button variant="danger" {...props} />
);

export const GhostButton = (props) => (
  <Button variant="ghost" {...props} />
);

// 버튼 그룹 컴포넌트
export const ButtonGroup = ({ 
  children, 
  orientation = 'horizontal',
  spacing = 'md',
  className = ''
}) => {
  const orientationClass = orientation === 'horizontal' ? 'flex-row' : 'flex-col';
  const spacingClass = {
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4'
  }[spacing];

  return (
    <div className={`flex ${orientationClass} ${spacingClass} ${className}`}>
      {children}
    </div>
  );
};

export default Button;
