// PYXIS UI Helpers - 공통 UI 유틸리티 함수들

class PyxisUI {
  constructor() {
    this.toastContainer = null;
    this.setupToastContainer();
  }

  // 토스트 컨테이너 설정
  setupToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'pyxis-toast-container';
    this.toastContainer.style.cssText = `
      position: fixed; 
      top: 24px; 
      right: 24px; 
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 400px;
      pointer-events: none;
    `;
    document.body.appendChild(this.toastContainer);
  }

  // 알림 토스트
  showNotification(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    const colors = {
      success: 'linear-gradient(135deg, #27ae60, #219a52)',
      error: 'linear-gradient(135deg, #e74c3c, #c0392b)', 
      warning: 'linear-gradient(135deg, #f39c12, #e67e22)',
      info: 'linear-gradient(135deg, #3498db, #2980b9)'
    };

    toast.style.cssText = `
      padding: 16px 24px; 
      border-radius: 12px; 
      color: white; 
      font-weight: 600;
      background: ${colors[type] || colors.info};
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      transform: translateX(100%); 
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      max-width: 100%; 
      word-wrap: break-word; 
      font-size: 14px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
      pointer-events: auto;
      cursor: pointer;
    `;
    
    toast.textContent = message;
    toast.onclick = () => this.removeToast(toast);
    
    this.toastContainer.appendChild(toast);
    
    // 애니메이션
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
    });
    
    // 자동 제거
    setTimeout(() => {
      this.removeToast(toast);
    }, duration);
    
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  // 토스트 제거
  removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    
    toast.style.transform = 'translateX(100%)';
    toast.style.opacity = '0';
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400);
  }

  // 성공 알림
  success(message, duration) {
    this.showNotification(message, 'success', duration);
  }

  // 에러 알림  
  error(message, duration) {
    this.showNotification(message, 'error', duration);
  }

  // 경고 알림
  warning(message, duration) {
    this.showNotification(message, 'warning', duration);
  }

  // 정보 알림
  info(message, duration) {
    this.showNotification(message, 'info', duration);
  }

  // 로딩 상태 토글
  setLoading(element, loading = true) {
    if (!element) return;
    
    if (loading) {
      element.classList.add('loading');
      element.disabled = true;
      element.dataset.originalText = element.textContent;
      if (element.tagName === 'BUTTON') {
        element.textContent = '처리중...';
      }
    } else {
      element.classList.remove('loading');
      element.disabled = false;
      if (element.dataset.originalText) {
        element.textContent = element.dataset.originalText;
        delete element.dataset.originalText;
      }
    }
  }

  // 피드백 효과
  showFeedback(element, type = 'success', duration = 2000) {
    if (!element) return;
    
    const className = `feedback-${type}`;
    element.classList.add(className);
    
    setTimeout(() => {
      element.classList.remove(className);
    }, duration);
  }

  // 클립보드 복사
  async copyToClipboard(text, button = null) {
    try {
      await navigator.clipboard.writeText(text);
      
      if (button) {
        const originalText = button.textContent;
        button.textContent = '복사완료!';
        this.showFeedback(button, 'success');
        
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }
      
      this.success('클립보드에 복사되었습니다!');
      return true;
    } catch (error) {
      console.error('[UI] Clipboard copy failed:', error);
      
      if (button) {
        this.showFeedback(button, 'error');
      }
      
      this.error('클립보드 복사에 실패했습니다');
      return false;
    }
  }

  // 시간 포맷팅
  formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour12: false });
    } catch {
      return '--:--:--';
    }
  }

  // 날짜 포맷팅  
  formatDate(timestamp) {
    try {
      return new Date(timestamp).toLocaleString('ko-KR');
    } catch {
      return '--:--:-- --.--.--';
    }
  }

  // HP 퍼센트 계산
  calculateHpPercent(current, max = 100) {
    if (!current || !max) return 0;
    return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  }

  // 팀 이름 변환
  getTeamName(teamKey) {
    const teamMap = {
      'A': '불사조 기사단',
      'B': '죽음을 먹는 자들', 
      'team1': '불사조 기사단',
      'team2': '죽음을 먹는 자들'
    };
    return teamMap[teamKey] || '알 수 없음';
  }

  // 요소 표시/숨김
  show(element) {
    if (element) {
      element.style.display = '';
      element.classList.remove('hidden', 'hide');
    }
  }

  hide(element) {
    if (element) {
      element.style.display = 'none';
    }
  }

  // 요소 토글
  toggle(element, show = null) {
    if (!element) return;
    
    const isVisible = element.style.display !== 'none' && 
                     !element.classList.contains('hidden') && 
                     !element.classList.contains('hide');
    
    if (show === null) {
      show = !isVisible;
    }
    
    if (show) {
      this.show(element);
    } else {
      this.hide(element);
    }
  }

  // DOM 요소 선택 헬퍼
  $(selector) {
    if (typeof selector === 'string') {
      return document.querySelector(selector);
    }
    return selector; // 이미 요소인 경우
  }

  $$(selector) {
    return document.querySelectorAll(selector);
  }

  // 이벤트 리스너 헬퍼
  on(element, event, handler, options = {}) {
    if (!element) return;
    
    if (typeof element === 'string') {
      element = this.$(element);
    }
    
    if (element) {
      element.addEventListener(event, handler, options);
    }
  }

  off(element, event, handler, options = {}) {
    if (!element) return;
    
    if (typeof element === 'string') {
      element = this.$(element);  
    }
    
    if (element) {
      element.removeEventListener(event, handler, options);
    }
  }

  // 폼 데이터 수집
  getFormData(formElement) {
    if (!formElement) return {};
    
    const formData = new FormData(formElement);
    const data = {};
    
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }
    
    return data;
  }

  // 폼 검증
  validateForm(formElement, rules = {}) {
    if (!formElement) return { valid: false, errors: ['폼을 찾을 수 없습니다'] };
    
    const data = this.getFormData(formElement);
    const errors = [];
    
    Object.entries(rules).forEach(([field, rule]) => {
      const value = data[field];
      
      if (rule.required && (!value || value.trim() === '')) {
        errors.push(`${rule.label || field}은(는) 필수입니다`);
      }
      
      if (rule.minLength && value && value.length < rule.minLength) {
        errors.push(`${rule.label || field}은(는) 최소 ${rule.minLength}자 이상이어야 합니다`);
      }
      
      if (rule.maxLength && value && value.length > rule.maxLength) {
        errors.push(`${rule.label || field}은(는) 최대 ${rule.maxLength}자 이하여야 합니다`);
      }
      
      if (rule.pattern && value && !rule.pattern.test(value)) {
        errors.push(`${rule.label || field} 형식이 올바르지 않습니다`);
      }
    });
    
    return {
      valid: errors.length === 0,
      errors,
      data
    };
  }

  // 애니메이션 완료 대기
  waitForAnimation(element) {
    return new Promise((resolve) => {
      const handleAnimationEnd = () => {
        element.removeEventListener('animationend', handleAnimationEnd);
        element.removeEventListener('transitionend', handleAnimationEnd);
        resolve();
      };
      
      element.addEventListener('animationend', handleAnimationEnd);
      element.addEventListener('transitionend', handleAnimationEnd);
      
      // 안전장치: 2초 후 강제 완료
      setTimeout(resolve, 2000);
    });
  }

  // 스크롤 최하단으로
  scrollToBottom(element) {
    if (!element) return;
    
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }

  // 반응형 브레이크포인트 체크
  isMobile() {
    return window.innerWidth <= 768;
  }

  isTablet() {
    return window.innerWidth > 768 && window.innerWidth <= 1024;
  }

  isDesktop() {
    return window.innerWidth > 1024;
  }

  // 디바운스
  debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        timeout = null;
        if (!immediate) func.apply(this, args);
      };
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(this, args);
    };
  }

  // 스로틀
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // 랜덤 ID 생성
  generateId(prefix = 'pyxis') {
    return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 깊은 복사
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const copy = {};
      Object.keys(obj).forEach(key => {
        copy[key] = this.deepClone(obj[key]);
      });
      return copy;
    }
  }

  // 정리
  cleanup() {
    if (this.toastContainer && this.toastContainer.parentNode) {
      this.toastContainer.parentNode.removeChild(this.toastContainer);
    }
  }
}

// 전역 인스턴스
window.PyxisUI = new PyxisUI();

// 단축 참조
window.UI = window.PyxisUI;
