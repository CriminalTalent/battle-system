import React from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';

/**
 * 전투 시스템용 Button 컴포넌트
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - 버튼 내용
 * @param {'primary'|'secondary'|'danger'|'success'|'warning'|'ghost'} props.variant - 버튼 스타일
 * @param {'sm'|'md'|'lg'|'xl'} props.size - 버튼 크기
 * @param {boolean} props.disabled - 비활성화 상태
 * @param {boolean} props.loading - 로딩 상태
 * @param {boolean} props.fullWidth - 전체 너비
 * @param {React.ReactNode} props.leftIcon - 왼쪽 아이콘
 * @param {React.ReactNode} props.rightIcon - 오른쪽 아이콘
 * @param {string} props.shortcut - 키보드 단축키 표시
 * @param {Function} props.onClick - 클릭 핸들러
 * @param {string} props.className - 추가 CSS 클래스
 * @param {...any} props.rest - 기타 props
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
  className,
  ...rest
}) => {
  // 버튼 스타일 정의
  const baseStyles = clsx(
    // 기본 스타일
    'relative inline-flex items-center justify-center',
    'font-medium rounded-xl transition-all duration-200',
    'focus:outline-none focus:ring-2 focus:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'no-select',
    
    // 크기별 스타일
    {
      'px-3 py-1.5 text-sm': size === 'sm',
      'px-4 py-2 text-base': size === 'md',
      'px-6 py-3 text-lg': size === 'lg',
      'px-8 py-4 text-xl': size === 'xl',
    },
    
    // 전체 너비
    {
      'w-full': fullWidth,
    },
    
    // 변형별 스타일
    {
      // Primary (공격 버튼)
      'bg-battle-primary hover:bg-red-600 text-white shadow-lg hover:shadow-xl': 
        variant === 'primary' && !disabled,
      'focus:ring-red-500': variant === 'primary',
      
      // Secondary (방어 버튼)
      'bg-battle-secondary hover:bg-blue-600 text-white shadow-lg hover:shadow-xl': 
        variant === 'secondary' && !disabled,
      'focus:ring-blue-500': variant === 'secondary',
      
      // Success (성공 액션)
      'bg-battle-success hover:bg-green-600 text-white shadow-lg hover:shadow-xl': 
        variant === 'success' && !disabled,
      'focus:ring-green-500': variant === 'success',
      
      // Danger (위험한 액션)
      'bg-battle-danger hover:bg-red-700 text-white shadow-lg hover:shadow-xl': 
        variant === 'danger' && !disabled,
      'focus:ring-red-600': variant === 'danger',
      
      // Warning (경고 액션)
      'bg-battle-warning hover:bg-yellow-600 text-white shadow-lg hover:shadow-xl': 
        variant === 'warning' && !disabled,
      'focus:ring-yellow-500': variant === 'warning',
      
      // Ghost (투명한 버튼)
      'bg-transparent hover:bg-white/10 text-white border border-white/20 hover:border-white/40': 
        variant === 'ghost' && !disabled,
      'focus:ring-white/50': variant === 'ghost',
    }
  );

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

  return (
    <motion.button
      className={clsx(baseStyles, className)}
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
          <span className={clsx(
            'flex items-center',
            loading && 'opacity-0'
          )}>
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
  className 
}) => {
  const groupStyles = clsx(
    'flex',
    {
      'flex-row': orientation === 'horizontal',
      'flex-col': orientation === 'vertical',
      'gap-2': spacing === 'sm',
      'gap-3': spacing === 'md',
      'gap-4': spacing === 'lg',
    },
    className
  );

  return (
    <div className={groupStyles}>
      {children}
    </div>
  );
};

export default Button;