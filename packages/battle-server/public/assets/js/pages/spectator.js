// PYXIS Spectator Page - Enhanced Design Version
// 우아한 디자인과 몰입감 있는 관전 경험을 제공하는 관전자 페이지
class PyxisSpectator {
  constructor() {
    this.battleId = null;
    this.battleState = null;
    this.isAuthenticated = false;
    this.spectatorName = '';
    this.phoenixPlayers = [];
    this.eatersPlayers = [];
    this.lastUpdateTime = Date.now();
    this.battleTimer = null;
    this.uiAnimations = new Map();
    this.cheerCooldown = false;
    this.init();
  }

  init() {
    this.setupElements();
    this.setupEventListeners();
    this.setupSocketEvents();
    this.initializeDesignEnhancements();
    this.checkUrlParams();

    PyxisSocket.init();
    PyxisFX.mount();
  }

  setupElements() {
    // 연결 상태
    this.connectionDot = UI.$('#connectionDot');
    this.connectionText = UI.$('#connectionText');

    // 인증 요소
    this.loginForm = UI.$('#loginForm');
    this.spectatorLoginForm = UI.$('#spectatorLoginForm');
    this.spectatorName = UI.$('#spectatorName');

    // 관전 화면
    this.spectatorArea = UI.$('#spectatorArea');
    this.battlePhase = UI.$('#battlePhase');
    this.battleInfo = UI.$('#battleInfo');
    this.currentTurn = UI.$('#currentTurn');

    // 팀 표시
    this.phoenixMembers = UI.$('#phoenixMembers');
    this.deathMembers = UI.$('#deathMembers');

    // 응원 버튼
    this.cheerButtons = document.querySelectorAll('.cheer-btn');

    // 로그
    this.battleLog = UI.$('#battleLog');

    // 채팅 요소들 (기본 구조에 추가)
    this.createChatInterface();
  }

  createChatInterface() {
    // 로그 섹션에 채팅 인터페이스 추가
    const logSection = document.querySelector('.log-section');
    if (logSection) {
      // 탭 버튼 추가
      const tabContainer = document.createElement('div');
      tabContainer.className = 'log-tabs';
      tabContainer.innerHTML = `
        <button class="log-tab active" data-tab="log">전투 로그</button>
        <button class="log-tab" data-tab="chat">채팅</button>
      `;
      logSection.insertBefore(tabContainer, this.battleLog);

      // 채팅 컨테이너 추가
      const chatContainer = document.createElement('div');
      chatContainer.id = 'chatContainer';
      chatContainer.className = 'chat-container';
      chatContainer.style.display = 'none';
      chatContainer.innerHTML = `
        <div id="chatMessages" class="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chatInput" placeholder="메시지 입력... (Enter로 전송)" maxlength="200">
          <button id="chatSend" class="chat-send-btn">전송</button>
        </div>
      `;
      logSection.appendChild(chatContainer);

      // 탭 이벤트 리스너 추가
      document.querySelectorAll('.log-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          this.switchTab(e.target.dataset.tab);
        });
      });

      // 채팅 요소 참조 저장
      this.chatMessages = UI.$('#chatMessages');
      this.chatInput = UI.$('#chatInput');
      this.chatSend = UI.$('#chatSend');

      // 채팅 이벤트 리스너
      this.chatSend.addEventListener('click', () => this.sendChat());
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChat();
      });
    }
  }

  switchTab(tabName) {
    // 탭 버튼 상태 변경
    document.querySelectorAll('.log-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 컨텐츠 표시/숨김
    if (tabName === 'log') {
      this.battleLog.style.display = 'block';
      UI.$('#chatContainer').style.display = 'none';
    } else {
      this.battleLog.style.display = 'none';
      UI.$('#chatContainer').style.display = 'block';
    }
  }

  initializeDesignEnhancements() {
    // 페이지 로드 페이드인
    this.addPageFadeIn();
    
    // 배경 별 효과
    this.addSpectatorStarField();
    
    // 버튼 효과 강화
    this.enhanceButtonEffects();
    
    // 카드 호버 효과
    this.addCardEffects();
    
    // 타이핑 효과 준비
    this.setupTypingEffects();
    
    // 커스텀 스크롤바
    this.customizeScrollbars();
  }

  addPageFadeIn() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 1s ease-out';
    
    setTimeout(() => {
      document.body.style.opacity = '1';
    }, 100);
  }

  addSpectatorStarField() {
    const starField = document.createElement('div');
    starField.className = 'spectator-star-field';
    starField.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: -1;
      overflow: hidden;
    `;

    // 별들 생성 (관전자용으로 더 많이)
    for (let i = 0; i < 75; i++) {
      const star = document.createElement('div');
      star.className = 'spectator-star';
      star.style.cssText = `
        position: absolute;
        width: ${Math.random() * 3 + 1}px;
        height: ${Math.random() * 3 + 1}px;
        background: var(--gold-bright);
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
        animation: spectatorTwinkle ${2 + Math.random() * 4}s infinite;
        box-shadow: 0 0 ${Math.random() * 8 + 4}px var(--gold-bright);
        opacity: ${Math.random() * 0.8 + 0.2};
      `;
      starField.appendChild(star);
    }

    document.body.appendChild(starField);

    // 애니메이션 CSS 추가
    if (!document.querySelector('#phase-announcement-style')) {
      const style = document.createElement('style');
      style.id = 'phase-announcement-style';
      style.textContent = `
        @keyframes phaseAnnouncement {
          0% {
            transform: translate(-50%, -50%) scale(0) rotate(-10deg);
            opacity: 0;
          }
          20% {
            transform: translate(-50%, -50%) scale(1.1) rotate(5deg);
            opacity: 1;
          }
          80% {
            transform: translate(-50%, -50%) scale(1) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(0.9) rotate(0deg);
            opacity: 0;
          }
        }
        
        @keyframes phaseBackground {
          0% {
            opacity: 0;
            transform: scale(0);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
          100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }
        
        @keyframes turnAnnouncement {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0;
          }
          30% {
            transform: translate(-50%, -50%) scale(1.1);
            opacity: 1;
          }
          70% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(0.8);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => {
      announcement.remove();
      bgEffect.remove();
    }, 3000);
  }

  handleActionResult(result) {
    if (!result) return;

    // 액션 결과를 화려하게 표시
    this.showActionEffect(result);
    
    // 로그에 기록
    const logText = this.formatActionResult(result);
    if (logText) {
      this.addLogEntry(logText, 'action');
    }
  }

  showActionEffect(result) {
    const effectContainer = document.createElement('div');
    effectContainer.className = 'action-effect-container';
    effectContainer.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      pointer-events: none;
    `;

    let effectText = '';
    let effectColor = 'var(--text-bright)';
    let effectIcon = '';

    switch (result.type) {
      case 'attack':
        if (result.dodge) {
          effectText = 'MISS!';
          effectColor = 'var(--text-muted)';
          effectIcon = '💨';
        } else {
          effectText = result.crit ? `${result.damage} CRITICAL!` : `${result.damage} 데미지`;
          effectColor = result.crit ? 'var(--warning)' : 'var(--danger)';
          effectIcon = result.crit ? '💥' : '⚔️';
        }
        break;
      case 'useItem':
        if (result.item === '디터니') {
          effectText = `+${result.healed || 10} HP 회복`;
          effectColor = 'var(--success)';
          effectIcon = '💚';
        } else {
          effectText = `${result.item} 사용!`;
          effectColor = 'var(--warning)';
          effectIcon = '✨';
        }
        break;
      case 'defend':
        effectText = '방어 태세!';
        effectColor = 'var(--info)';
        effectIcon = '🛡️';
        break;
      case 'evade':
        effectText = '회피 태세!';
        effectColor = 'var(--success)';
        effectIcon = '💨';
        break;
    }

    effectContainer.innerHTML = `
      <div class="action-effect-main" style="
        font-size: 2.5rem;
        font-weight: 700;
        color: ${effectColor};
        text-shadow: 0 0 20px ${effectColor};
        animation: actionEffectMain 2s ease-out;
        text-align: center;
      ">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">${effectIcon}</div>
        ${effectText}
      </div>
    `;

    document.body.appendChild(effectContainer);

    // 효과 애니메이션
    if (!document.querySelector('#action-effect-style')) {
      const style = document.createElement('style');
      style.id = 'action-effect-style';
      style.textContent = `
        @keyframes actionEffectMain {
          0% {
            transform: scale(0) rotate(-10deg);
            opacity: 0;
          }
          20% {
            transform: scale(1.3) rotate(5deg);
            opacity: 1;
          }
          80% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: scale(0.8) rotate(0deg);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => effectContainer.remove(), 2000);

    // 큰 데미지나 크리티컬 시 화면 효과
    if (result.type === 'attack' && (result.damage > 15 || result.crit)) {
      this.addScreenFlash(result.crit ? 'var(--warning)' : 'var(--danger)');
    }
  }

  addScreenFlash(color) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: ${color};
      opacity: 0.3;
      pointer-events: none;
      z-index: 9998;
      animation: screenFlash 0.5s ease-out;
    `;

    document.body.appendChild(flash);

    if (!document.querySelector('#screen-flash-style')) {
      const style = document.createElement('style');
      style.id = 'screen-flash-style';
      style.textContent = `
        @keyframes screenFlash {
          0% { opacity: 0.5; }
          50% { opacity: 0.2; }
          100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => flash.remove(), 500);
  }

  formatActionResult(result) {
    const actor = this.battleState?.players?.[result.actorPid];
    const target = this.battleState?.players?.[result.targetPid];
    
    if (!actor) return null;

    const actorName = actor.name;
    const targetName = target?.name || '대상';

    switch (result.type) {
      case 'attack':
        if (result.dodge) {
          return `${actorName}의 공격을 ${targetName}이(가) 회피했습니다!`;
        } else {
          const critText = result.crit ? ' (치명타!)' : '';
          const blockText = result.block ? ' (일부 방어됨)' : '';
          return `${actorName}이(가) ${targetName}에게 ${result.damage} 데미지를 입혔습니다${critText}${blockText}`;
        }
      case 'useItem':
        if (result.item === '디터니') {
          return `${actorName}이(가) ${targetName}을(를) ${result.healed || 10} HP 회복시켰습니다`;
        } else {
          return `${actorName}이(가) ${result.item}을(를) 사용했습니다`;
        }
      case 'defend':
        return `${actorName}이(가) 방어 태세를 취했습니다`;
      case 'evade':
        return `${actorName}이(가) 회피 태세를 취했습니다`;
      case 'pass':
        return `${actorName}이(가) 턴을 넘겼습니다`;
      default:
        return `${actorName}이(가) ${result.type} 액션을 수행했습니다`;
    }
  }

  handleBattleEnd(result) {
    this.addBattleEndEffect(result);
    this.addLogEntry(`[전투 종료] ${result.winner} 승리!`, 'system');
    
    // 응원 버튼 비활성화
    this.cheerButtons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });
  }

  addBattleEndEffect(result) {
    const endEffect = document.createElement('div');
    endEffect.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, rgba(0, 8, 13, 0.9), rgba(0, 30, 53, 0.9));
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      animation: battleEndFadeIn 1s ease-out;
    `;

    endEffect.innerHTML = `
      <div style="
        font-family: var(--font-display);
        font-size: 4rem;
        font-weight: 700;
        color: var(--gold-bright);
        text-shadow: 0 0 30px rgba(220, 199, 162, 0.8);
        margin-bottom: 2rem;
        animation: battleEndTitle 2s ease-out;
      ">
        전투 종료
      </div>
      <div style="
        font-size: 2.5rem;
        font-weight: 600;
        color: var(--text-bright);
        margin-bottom: 3rem;
        animation: battleEndWinner 2s ease-out 0.5s both;
      ">
        🏆 ${result.winner} 승리! 🏆
      </div>
      <div style="
        display: flex;
        gap: 2rem;
        animation: battleEndButtons 2s ease-out 1s both;
      ">
        <button onclick="location.reload()" style="
          padding: 1rem 2rem;
          background: linear-gradient(135deg, var(--gold-bright), var(--gold-warm));
          color: var(--deep-navy);
          border: none;
          border-radius: 8px;
          font-size: 1.2rem;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.3s ease;
        " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
          새로고침
        </button>
        <button onclick="window.close()" style="
          padding: 1rem 2rem;
          background: var(--surface-1);
          color: var(--text-bright);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          font-size: 1.2rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.3s ease;
        " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
          닫기
        </button>
      </div>
    `;

    document.body.appendChild(endEffect);

    // 승리 애니메이션 CSS
    if (!document.querySelector('#battle-end-style')) {
      const style = document.createElement('style');
      style.id = 'battle-end-style';
      style.textContent = `
        @keyframes battleEndFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes battleEndTitle {
          0% {
            transform: scale(0) rotate(-10deg);
            opacity: 0;
          }
          50% {
            transform: scale(1.2) rotate(5deg);
            opacity: 1;
          }
          100% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
        }
        
        @keyframes battleEndWinner {
          0% {
            transform: translateY(50px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        
        @keyframes battleEndButtons {
          0% {
            transform: translateY(30px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  addLogEntry(text, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    
    const timestamp = new Date().toLocaleTimeString('ko-KR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    logEntry.innerHTML = `
      <span class="log-time">${timestamp}</span>
      <span class="log-content">${text}</span>
    `;

    // 타입별 색상 및 아이콘
    const typeConfig = {
      system: { icon: '⚙️', color: 'var(--info)' },
      action: { icon: '⚔️', color: 'var(--text-normal)' },
      damage: { icon: '💥', color: 'var(--danger)' },
      heal: { icon: '💚', color: 'var(--success)' },
      info: { icon: 'ℹ️', color: 'var(--text-dim)' }
    };

    const config = typeConfig[type] || typeConfig.info;
    logEntry.style.borderLeft = `3px solid ${config.color}`;
    
    // 아이콘 추가
    const icon = document.createElement('span');
    icon.textContent = config.icon;
    icon.style.marginRight = '0.5rem';
    logEntry.querySelector('.log-content').prepend(icon);

    // 애니메이션으로 추가
    logEntry.style.opacity = '0';
    logEntry.style.transform = 'translateX(-20px)';
    this.battleLog.appendChild(logEntry);

    setTimeout(() => {
      logEntry.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      logEntry.style.opacity = '1';
      logEntry.style.transform = 'translateX(0)';
    }, 10);

    // 자동 스크롤
    this.battleLog.scrollTop = this.battleLog.scrollHeight;

    // 로그 수 제한
    while (this.battleLog.children.length > 150) {
      this.battleLog.removeChild(this.battleLog.firstChild);
    }
  }

  renderChatMessage(message) {
    if (!this.chatMessages) return;

    const chatMsg = document.createElement('div');
    chatMsg.className = `chat-message ${message.type || (message.scope === 'team' ? 'team' : '')}`;
    
    const timestamp = new Date(message.ts || Date.now()).toLocaleTimeString('ko-KR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });

    const senderName = message.from?.nickname || message.nickname || '익명';
    const scope = message.scope === 'team' ? '[팀]' : '[전체]';
    
    chatMsg.innerHTML = `
      <div class="chat-header">
        <span class="chat-sender">${scope} ${senderName}</span>
        <span class="chat-time">${timestamp}</span>
      </div>
      <div class="chat-text">${message.text}</div>
    `;

    // 새 메시지 애니메이션
    chatMsg.style.opacity = '0';
    chatMsg.style.transform = 'translateY(20px)';
    this.chatMessages.appendChild(chatMsg);

    setTimeout(() => {
      chatMsg.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      chatMsg.style.opacity = '1';
      chatMsg.style.transform = 'translateY(0)';
    }, 10);

    // 자동 스크롤
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // 메시지 수 제한
    while (this.chatMessages.children.length > 100) {
      this.chatMessages.removeChild(this.chatMessages.firstChild);
    }

    // 새 메시지 알림 효과
    this.addNewMessageNotification();
  }

  addNewMessageNotification() {
    const chatTab = document.querySelector('[data-tab="chat"]');
    if (chatTab && !chatTab.classList.contains('active')) {
      chatTab.style.animation = 'newMessagePulse 1s ease-out';
      
      setTimeout(() => {
        chatTab.style.animation = '';
      }, 1000);

      if (!document.querySelector('#new-message-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'new-message-pulse-style';
        style.textContent = `
          @keyframes newMessagePulse {
            0%, 100% { transform: scale(1); box-shadow: none; }
            50% { transform: scale(1.1); box-shadow: 0 0 15px rgba(220, 199, 162, 0.5); }
          }
        `;
        document.head.appendChild(style);
      }
    }
  }

  sendChat() {
    if (!this.chatInput || !this.isAuthenticated) return;

    const message = this.chatInput.value.trim();
    if (!message) return;

    PyxisSocket.sendChat({
      battleId: this.battleId,
      text: message,
      nickname: this.spectatorName,
      role: 'spectator',
      scope: 'all'
    });

    this.chatInput.value = '';

    // 전송 효과
    this.chatInput.style.borderColor = 'var(--success)';
    setTimeout(() => {
      this.chatInput.style.borderColor = '';
    }, 300);
  }

  sendCheer(cheerMessage) {
    if (!this.isAuthenticated || this.cheerCooldown) return;

    // 쿨다운 설정 (3초)
    this.cheerCooldown = true;
    setTimeout(() => {
      this.cheerCooldown = false;
    }, 3000);

    // 응원 메시지 전송
    PyxisSocket.sendChat({
      battleId: this.battleId,
      text: `📣 ${cheerMessage}`,
      nickname: this.spectatorName,
      role: 'spectator',
      scope: 'all',
      type: 'cheer'
    });

    // 응원 버튼 쿨다운 표시
    this.cheerButtons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });

    setTimeout(() => {
      this.cheerButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
      });
    }, 3000);
  }

  showCheerMessage(message) {
    const cheerEffect = document.createElement('div');
    cheerEffect.textContent = message.text;
    cheerEffect.style.cssText = `
      position: fixed;
      top: 70%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 2rem;
      font-weight: 700;
      color: var(--warning);
      text-shadow: 0 0 15px rgba(245, 158, 11, 0.8);
      z-index: 9999;
      pointer-events: none;
      animation: cheerEffect 3s ease-out;
    `;

    document.body.appendChild(cheerEffect);

    if (!document.querySelector('#cheer-effect-style')) {
      const style = document.createElement('style');
      style.id = 'cheer-effect-style';
      style.textContent = `
        @keyframes cheerEffect {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0;
          }
          20% {
            transform: translate(-50%, -50%) scale(1.2);
            opacity: 1;
          }
          80% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(0.8);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => cheerEffect.remove(), 3000);
  }

  startBattleTimer() {
    // 1시간 전투 타이머
    const battleDuration = 60 * 60 * 1000; // 1시간
    const startTime = Date.now();

    this.battleTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, battleDuration - elapsed);
      
      if (remaining === 0) {
        clearInterval(this.battleTimer);
        this.addLogEntry('[시간 종료] 전투 시간이 만료되었습니다', 'system');
        return;
      }

      // 타이머 표시 업데이트 (있다면)
      const timerElement = document.querySelector('.battle-timer');
      if (timerElement) {
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
        timerElement.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }, 1000);
  }

  cleanup() {
    // 타이머 정리
    if (this.battleTimer) {
      clearInterval(this.battleTimer);
    }

    // 애니메이션 정리
    this.uiAnimations.clear();

    // 동적 스타일 정리
    const dynamicStyles = document.querySelectorAll('[id$="-style"]');
    dynamicStyles.forEach(style => style.remove());

    // 소켓 정리
    PyxisSocket.cleanup();
  }
}

// 페이지 로드시 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.spectator = new PyxisSpectator();
});

// 페이지 언로드시 정리
window.addEventListener('beforeunload', () => {
  if (window.spectator) {
    window.spectator.cleanup();
  }
});
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spectatorTwinkle {
        0%, 100% { 
          opacity: 0.2; 
          transform: scale(1); 
        }
        25% { 
          opacity: 0.8; 
          transform: scale(1.3); 
        }
        75% { 
          opacity: 0.4; 
          transform: scale(0.8); 
        }
      }
    `;
    document.head.appendChild(style);
  }

  enhanceButtonEffects() {
    // 응원 버튼 효과
    this.cheerButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.createRippleEffect(e, btn);
        this.addCheerParticleEffect(btn);
      });

      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-3px) scale(1.05)';
        btn.style.boxShadow = '0 8px 25px rgba(220, 199, 162, 0.4)';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
        btn.style.boxShadow = '';
      });
    });

    // 일반 버튼들
    const allButtons = document.querySelectorAll('button:not(.cheer-btn)');
    allButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.createRippleEffect(e, btn);
      });
    });
  }

  createRippleEffect(e, element) {
    const ripple = document.createElement('span');
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;

    ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x}px;
      top: ${y}px;
      background: radial-gradient(circle, rgba(220, 199, 162, 0.4) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      animation: spectatorRipple 0.8s ease-out;
    `;

    element.style.position = 'relative';
    element.style.overflow = 'hidden';
    element.appendChild(ripple);

    setTimeout(() => ripple.remove(), 800);

    // 리플 애니메이션 추가
    if (!document.querySelector('#spectator-ripple-style')) {
      const style = document.createElement('style');
      style.id = 'spectator-ripple-style';
      style.textContent = `
        @keyframes spectatorRipple {
          from {
            transform: scale(0);
            opacity: 1;
          }
          to {
            transform: scale(4);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  addCheerParticleEffect(button) {
    // 응원 시 파티클 효과
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `
        position: absolute;
        width: 6px;
        height: 6px;
        background: var(--gold-bright);
        border-radius: 50%;
        pointer-events: none;
        z-index: 1000;
        animation: cheerParticle 1.5s ease-out forwards;
      `;

      const rect = button.getBoundingClientRect();
      particle.style.left = `${rect.left + rect.width / 2}px`;
      particle.style.top = `${rect.top + rect.height / 2}px`;

      // 랜덤 방향으로 파티클 이동
      const angle = (Math.PI * 2 * i) / 8;
      const distance = 50 + Math.random() * 30;
      particle.style.setProperty('--end-x', `${Math.cos(angle) * distance}px`);
      particle.style.setProperty('--end-y', `${Math.sin(angle) * distance}px`);

      document.body.appendChild(particle);

      setTimeout(() => particle.remove(), 1500);
    }

    // 파티클 애니메이션 CSS
    if (!document.querySelector('#cheer-particle-style')) {
      const style = document.createElement('style');
      style.id = 'cheer-particle-style';
      style.textContent = `
        @keyframes cheerParticle {
          0% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(var(--end-x), var(--end-y)) scale(0);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  addCardEffects() {
    const cards = document.querySelectorAll('.team-wrap, .cheer-section, .log-section, .battle-meta');
    cards.forEach(card => {
      card.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
      
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.3), 0 0 15px rgba(220, 199, 162, 0.2)';
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
        card.style.boxShadow = '';
      });
    });
  }

  setupTypingEffects() {
    this.typewriterQueue = [];
    this.isTyping = false;
  }

  customizeScrollbars() {
    const style = document.createElement('style');
    style.textContent = `
      .spectator-container ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      .spectator-container ::-webkit-scrollbar-track {
        background: var(--surface-1);
        border-radius: 4px;
      }
      
      .spectator-container ::-webkit-scrollbar-thumb {
        background: linear-gradient(45deg, var(--gold-bright), var(--gold-warm));
        border-radius: 4px;
        box-shadow: 0 0 5px rgba(220, 199, 162, 0.3);
      }
      
      .spectator-container ::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(45deg, var(--gold-warm), var(--gold-bright));
        box-shadow: 0 0 10px rgba(220, 199, 162, 0.5);
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    // 인증 폼
    this.spectatorLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.authenticate();
    });

    // 응원 버튼
    this.cheerButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const cheerMsg = btn.dataset.cheer;
        this.sendCheer(cheerMsg);
      });
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case '1':
          e.preventDefault();
          this.switchTab('log');
          break;
        case '2':
          e.preventDefault();
          this.switchTab('chat');
          break;
        case 'Enter':
          if (e.target.id !== 'chatInput' && e.target.id !== 'spectatorName') {
            this.chatInput?.focus();
          }
          break;
        case 'Escape':
          this.chatInput?.blur();
          break;
        case 'c':
          if (e.ctrlKey) return; // 복사 허용
          e.preventDefault();
          if (this.cheerButtons.length > 0) {
            this.cheerButtons[0].click();
          }
          break;
      }
    });

    // 페이지 가시성 변경
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isAuthenticated && this.battleId) {
        PyxisSocket.socket.emit('requestState', { battleId: this.battleId });
      }
    });
  }

  setupSocketEvents() {
    // 연결 상태
    PyxisSocket.on('connection:success', () => {
      this.connectionDot.classList.add('active');
      this.connectionText.textContent = '연결됨';
      this.addConnectionPulse(true);
    });

    PyxisSocket.on('connection:disconnect', () => {
      this.connectionDot.classList.remove('active');
      this.connectionText.textContent = '연결 끊김';
      this.addConnectionPulse(false);
    });

    // 인증
    PyxisSocket.on('authSuccess', (data) => this.handleAuthSuccess(data));
    PyxisSocket.on('authError', (msg) => {
      UI.error(`인증 실패: ${msg}`);
      this.addErrorShake();
    });

    // 상태 업데이트
    PyxisSocket.on('state:update', (state) => this.handleStateUpdate(state));
    PyxisSocket.on('state', (state) => this.handleStateUpdate(state));

    // 페이즈 변경
    PyxisSocket.on('phase:change', (phase) => {
      const teamName = phase.phase === 'A' || phase.phase === 'team1' ? '불사조 기사단' : '죽음을 먹는 자들';
      this.addPhaseChangeAnnouncement(teamName, phase.round);
      this.addLogEntry(`[턴 전환] ${teamName} 턴 시작 (라운드 ${phase.round})`, 'system');
    });

    // 액션 결과
    PyxisSocket.on('action:success', (result) => this.handleActionResult(result));
    PyxisSocket.on('actionSuccess', (result) => this.handleActionResult(result));

    // 전투 종료
    PyxisSocket.on('battle:end', (result) => this.handleBattleEnd(result));

    // 로그 & 채팅
    PyxisSocket.on('log:new', (ev) => {
      if (ev?.text) {
        this.addLogEntry(ev.text, ev.type || 'action');
      }
    });

    PyxisSocket.on('chat:new', (msg) => {
      this.renderChatMessage(msg);
    });

    // 응원 메시지
    PyxisSocket.on('cheer:new', (msg) => {
      this.showCheerMessage(msg);
    });
  }

  addConnectionPulse(connected) {
    const pulse = document.createElement('div');
    pulse.style.cssText = `
      position: absolute;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${connected ? 'var(--success)' : 'var(--danger)'};
      animation: connectionPulse 1.5s ease-out;
      pointer-events: none;
    `;

    this.connectionDot.style.position = 'relative';
    this.connectionDot.appendChild(pulse);

    setTimeout(() => pulse.remove(), 1500);
  }

  addErrorShake() {
    this.loginForm.style.animation = 'errorShake 0.5s ease-out';
    
    if (!document.querySelector('#error-shake-style')) {
      const style = document.createElement('style');
      style.id = 'error-shake-style';
      style.textContent = `
        @keyframes errorShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => {
      this.loginForm.style.animation = '';
    }, 500);
  }

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const battleId = params.get('battle');
    const spectatorOtp = params.get('otp');

    if (battleId && spectatorOtp) {
      this.battleId = battleId;
      // 자동 인증 시도 (관전자는 이름만 입력하면 됨)
      PyxisSocket.on('connection:success', () => {
        setTimeout(() => {
          if (this.spectatorName.value) {
            this.authenticate();
          }
        }, 300);
      });
    }
  }

  async authenticate() {
    const name = this.spectatorName.value.trim();
    if (!name) {
      UI.error('관전자 이름을 입력해주세요');
      this.addErrorShake();
      return;
    }

    if (name.length > 20) {
      UI.error('이름은 20글자 이하로 입력해주세요');
      this.addErrorShake();
      return;
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const battleId = params.get('battle') || 'demo';
      const otp = params.get('otp') || 'spectator';

      await PyxisSocket.authenticate({
        role: 'spectator',
        battleId: battleId,
        name: name,
        otp: otp
      });

      this.battleId = battleId;
      this.spectatorName = name;
    } catch (e) {
      UI.error(`인증 실패: ${e.message}`);
      this.addErrorShake();
    }
  }

  handleAuthSuccess(data) {
    this.isAuthenticated = true;
    this.battleState = data.state || data.battle;
    
    UI.hide(this.loginForm);
    UI.show(this.spectatorArea);
    
    this.addSuccessEffect();
    UI.success(`${this.spectatorName}님, 관전을 시작합니다!`);
    
    this.renderBattleState();
    this.startBattleTimer();
  }

  addSuccessEffect() {
    const effect = document.createElement('div');
    effect.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle, rgba(34, 197, 94, 0.3) 0%, transparent 70%);
      pointer-events: none;
      z-index: 9999;
      animation: successWave 1.5s ease-out;
    `;

    document.body.appendChild(effect);

    setTimeout(() => effect.remove(), 1500);
  }

  handleStateUpdate(state) {
    this.battleState = state;
    this.lastUpdateTime = Date.now();
    this.renderBattleState();
  }

  renderBattleState() {
    if (!this.battleState) return;

    // 전투 정보 업데이트
    this.updateBattleInfo();
    
    // 팀 멤버 업데이트
    this.updateTeamMembers();
    
    // 현재 턴 정보
    this.updateCurrentTurn();
  }

  updateBattleInfo() {
    const phase = this.battleState.phase || 'waiting';
    const round = this.battleState.round || 1;
    const turnCount = this.battleState.turnCount || 0;

    const phaseText = {
      'waiting': '전투 대기중',
      'active': '전투 진행중',
      'ended': '전투 종료'
    };

    this.battlePhase.textContent = phaseText[phase] || '알 수 없음';
    this.battleInfo.textContent = `라운드 ${round} | 턴 ${turnCount}`;

    // 페이즈별 색상 변경
    this.battlePhase.className = `battle-phase phase-${phase}`;
  }

  updateTeamMembers() {
    if (!this.battleState.players) return;

    this.phoenixPlayers = [];
    this.eatersPlayers = [];

    Object.values(this.battleState.players).forEach(player => {
      if (player.team === 'A' || player.team === 'team1' || player.team === 'phoenix') {
        this.phoenixPlayers.push(player);
      } else {
        this.eatersPlayers.push(player);
      }
    });

    this.renderTeam(this.phoenixMembers, this.phoenixPlayers, 'phoenix');
    this.renderTeam(this.deathMembers, this.eatersPlayers, 'eaters');
  }

  renderTeam(container, players, teamType) {
    container.innerHTML = '';

    players.forEach(player => {
      const playerCard = document.createElement('div');
      playerCard.className = `spectator-player-card ${player.alive === false ? 'dead' : 'alive'}`;
      
      const hpPercent = Math.max(0, Math.min(100, (player.hp / (player.maxHp || 100)) * 100));
      const statusClass = hpPercent > 60 ? 'healthy' : hpPercent > 30 ? 'wounded' : 'critical';

      playerCard.innerHTML = `
        <div class="player-avatar">
          ${player.avatar ? `<img src="${player.avatar}" alt="${player.name}">` : '👤'}
        </div>
        <div class="player-info">
          <div class="player-name">${player.name}</div>
          <div class="player-hp ${statusClass}">
            <div class="hp-bar">
              <div class="hp-fill" style="width: ${hpPercent}%"></div>
            </div>
            <div class="hp-text">${player.hp}/${player.maxHp || 100}</div>
          </div>
          <div class="player-stats">
            <span>공격 ${player.stats?.attack || player.atk || 0}</span>
            <span>방어 ${player.stats?.defense || player.def || 0}</span>
            <span>민첩 ${player.stats?.agility || player.agi || 0}</span>
            <span>행운 ${player.stats?.luck || player.luk || 0}</span>
          </div>
        </div>
      `;

      // 플레이어 카드 애니메이션
      playerCard.style.opacity = '0';
      playerCard.style.transform = 'translateY(20px)';
      container.appendChild(playerCard);

      setTimeout(() => {
        playerCard.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        playerCard.style.opacity = '1';
        playerCard.style.transform = 'translateY(0)';
      }, players.indexOf(player) * 100);
    });
  }

  updateCurrentTurn() {
    const currentPlayer = this.battleState.turn?.pending?.[0] || this.battleState.turn?.actor;
    
    if (currentPlayer && this.battleState.players[currentPlayer]) {
      const player = this.battleState.players[currentPlayer];
      this.currentTurn.textContent = `현재 턴: ${player.name}`;
      this.currentTurn.className = 'current-turn active';
      
      // 턴 변경 효과
      this.addTurnChangeEffect(player.name);
    } else {
      this.currentTurn.textContent = '현재 턴: 대기중';
      this.currentTurn.className = 'current-turn';
    }
  }

  addTurnChangeEffect(playerName) {
    const announcement = document.createElement('div');
    announcement.textContent = `${playerName}의 턴!`;
    announcement.style.cssText = `
      position: fixed;
      top: 20%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: var(--font-display);
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--gold-bright);
      text-shadow: 0 0 20px rgba(220, 199, 162, 0.8);
      z-index: 10000;
      pointer-events: none;
      animation: turnAnnouncement 2s ease-out;
    `;

    document.body.appendChild(announcement);

    setTimeout(() => announcement.remove(), 2000);
  }

  addPhaseChangeAnnouncement(teamName, round) {
    const announcement = document.createElement('div');
    announcement.textContent = `${teamName} 턴 시작!`;
    announcement.style.cssText = `
      position: fixed;
      top: 25%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: var(--font-display);
      font-size: 3rem;
      font-weight: 700;
      color: var(--gold-bright);
      text-shadow: 0 0 30px rgba(220, 199, 162, 0.9);
      z-index: 10000;
      pointer-events: none;
      animation: phaseAnnouncement 3s ease-out;
    `;

    document.body.appendChild(announcement);

    // 배경 효과
    const bgEffect = document.createElement('div');
    bgEffect.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle, rgba(220, 199, 162, 0.1) 0%, transparent 70%);
      pointer-events: none;
      z-index: 9999;
      animation: phaseBackground 3s ease-out;
    `;

    document.body.appendChild(bgEffect);

    // 애니메이션 CSS 추가
