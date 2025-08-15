import React from 'react';
import { motion } from 'framer-motion';

const LoadingSpinner = ({ 
  size = 'md', 
  color = 'blue',
  className = '',
  ...props 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  const colorClasses = {
    blue: 'border-blue-500',
    red: 'border-red-500',
    green: 'border-green-500',
    yellow: 'border-yellow-500',
    white: 'border-white',
    gray: 'border-gray-500'
  };

  return (
    <motion.div
      className={`
        ${sizeClasses[size]} 
        border-2 border-t-transparent 
        ${colorClasses[color]} 
        rounded-full 
        ${className}
      `}
      animate={{ rotate: 360 }}
      transition={{
        duration: 1,
        repeat: Infinity,
        ease: 'linear'
      }}
      {...props}
    />
  );
};

export default LoadingSpinner;
