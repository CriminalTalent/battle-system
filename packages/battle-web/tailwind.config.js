/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        // 전투 테마 색상
        battle: {
          primary: '#ef4444',      // 빨간색 (공격)
          secondary: '#3b82f6',    // 파란색 (방어) 
          success: '#10b981',      // 초록색 (성공)
          warning: '#f59e0b',      // 노란색 (경고)
          danger: '#dc2626',       // 진한 빨강 (위험)
          dark: '#1f2937',         // 어두운 배경
          light: '#f9fafb'         // 밝은 배경
        },
        
        // HP 바 색상
        hp: {
          high: '#10b981',     // 초록색 (70-100%)
          medium: '#f59e0b',   // 노란색 (30-70%)
          low: '#ef4444',      // 빨간색 (0-30%)
          critical: '#dc2626'  // 진한 빨강 (0-10%)
        },
        
        // 데미지 타입 색상
        damage: {
          physical: '#ef4444',    // 물리 데미지
          magical: '#8b5cf6',     // 마법 데미지
          heal: '#10b981',        // 회복
          critical: '#fbbf24',    // 크리티컬
          miss: '#6b7280',        // 빗나감
          block: '#3b82f6'        // 블록
        },
        
        // 상태 효과 색상
        status: {
          poison: '#16a34a',      // 독
          burn: '#dc2626',        // 화상
          regeneration: '#059669', // 재생
          shield: '#0ea5e9',      // 보호막
          stun: '#7c3aed',        // 기절
          rage: '#ea580c'         // 분노
        }
      },
      
      animation: {
        // 커스텀 애니메이션
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'wiggle': 'wiggle 1s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'shake': 'shake 0.5s cubic-bezier(.36,.07,.19,.97)',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'fade-in': 'fadeIn 0.5s ease-in',
        'damage-number': 'damageNumber 1.5s ease-out forwards',
        'critical-flash': 'criticalFlash 0.3s ease-out',
        'hp-decrease': 'hpDecrease 0.5s ease-out',
        'turn-highlight': 'turnHighlight 1s ease-in-out infinite'
      },
      
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(59, 130, 246, 0.5)' },
          '100%': { boxShadow: '0 0 20px rgba(59, 130, 246, 0.8)' },
        },
        shake: {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-4px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(4px, 0, 0)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        damageNumber: {
          '0%': { 
            transform: 'translateY(0) scale(1)', 
            opacity: '1' 
          },
          '50%': { 
            transform: 'translateY(-20px) scale(1.2)', 
            opacity: '1' 
          },
          '100%': { 
            transform: 'translateY(-40px) scale(1)', 
            opacity: '0' 
          },
        },
        criticalFlash: {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(251, 191, 36, 0.3)' },
        },
        hpDecrease: {
          '0%': { width: 'var(--old-width)' },
          '100%': { width: 'var(--new-width)' },
        },
        turnHighlight: {
          '0%, 100%': { 
            boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.5)' 
          },
          '50%': { 
            boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.8)' 
          },
        }
      },
      
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '120': '30rem',
      },
      
      fontSize: {
        'xxs': '0.625rem',
        '3xl': '1.875rem',
      },
      
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      
      backdropBlur: {
        'xs': '2px',
      },
      
      zIndex: {
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
      },
      
      maxWidth: {
        '8xl': '88rem',
        '9xl': '96rem',
      },
      
      screens: {
        'xs': '475px',
        '3xl': '1600px',
      },
      
      fontFamily: {
        'battle': ['Inter', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      
      boxShadow: {
        'battle': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'battle-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'inner-lg': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.1)',
        'glow-blue': '0 0 20px rgba(59, 130, 246, 0.5)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.5)',
        'glow-green': '0 0 20px rgba(16, 185, 129, 0.5)',
        'glow-yellow': '0 0 20px rgba(245, 158, 11, 0.5)',
      },
      
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
        '800': '800ms',
        '1200': '1200ms',
      },
      
      scale: {
        '102': '1.02',
        '103': '1.03',
      }
    },
  },
  plugins: [
    // 커스텀 유틸리티 클래스들
    function({ addUtilities, theme }) {
      const newUtilities = {
        // 글래스모피즘 효과
        '.glass': {
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        },
        
        // 글로우 효과들
        '.glow-blue': {
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
        },
        '.glow-red': {
          boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)',
        },
        '.glow-green': {
          boxShadow: '0 0 20px rgba(16, 185, 129, 0.5)',
        },
        
        // 그라디언트 텍스트
        '.text-gradient-blue': {
          background: 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
          '-webkit-background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
          'background-clip': 'text',
        },
        '.text-gradient-red': {
          background: 'linear-gradient(45deg, #ef4444, #dc2626)',
          '-webkit-background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
          'background-clip': 'text',
        },
        '.text-gradient-green': {
          background: 'linear-gradient(45deg, #10b981, #059669)',
          '-webkit-background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
          'background-clip': 'text',
        },
        
        // 네온 효과
        '.neon-blue': {
          color: '#3b82f6',
          textShadow: '0 0 5px #3b82f6, 0 0 10px #3b82f6, 0 0 15px #3b82f6',
        },
        '.neon-red': {
          color: '#ef4444',
          textShadow: '0 0 5px #ef4444, 0 0 10px #ef4444, 0 0 15px #ef4444',
        },
        
        // 배틀 카드 스타일
        '.battle-card': {
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '1rem',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        },
        
        // 호버 효과들
        '.hover-lift': {
          transition: 'transform 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-2px)',
          },
        },
        '.hover-glow': {
          transition: 'box-shadow 0.2s ease-in-out',
          '&:hover': {
            boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
          },
        },
        
        // 사용자 선택 불가
        '.no-select': {
          '-webkit-user-select': 'none',
          '-moz-user-select': 'none',
          '-ms-user-select': 'none',
          'user-select': 'none',
        },
        
        // 스크롤바 스타일링
        '.scrollbar-thin': {
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.1)',
            borderRadius: '3px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '3px',
            '&:hover': {
              background: 'rgba(0, 0, 0, 0.5)',
            },
          },
        },
      };
      
      addUtilities(newUtilities);
    },
    
    // 안전한 영역을 위한 플러그인 (모바일)
    function({ addUtilities }) {
      const safeAreaUtilities = {
        '.pt-safe': {
          paddingTop: 'env(safe-area-inset-top)',
        },
        '.pb-safe': {
          paddingBottom: 'env(safe-area-inset-bottom)',
        },
        '.pl-safe': {
          paddingLeft: 'env(safe-area-inset-left)',
        },
        '.pr-safe': {
          paddingRight: 'env(safe-area-inset-right)',
        },
      };
      
      addUtilities(safeAreaUtilities);
    },
  ],
  
  // 다크 모드 설정
  darkMode: 'class',
  
  // 중요한 스타일 보호
  important: false,
  
  // 프리플라이트 스타일 사용
  corePlugins: {
    preflight: true,
  },
};