// packages/battle-server/public/assets/js/pages/admin.js
// PYXIS Admin Page - 관리자 페이지 로직

class PyxisAdmin {
  constructor() {
    this.battleList = null;
    this.createBattleForm = null;
    this.init();
  }

  init() {
    console.log('[Admin] Initializing admin page');

    this.battleList = UI.$('#battleList');
    this.createBattleForm = UI.$('#createBattleForm');

    this.setupEventListeners();
    this.setupSocketEvents();

    // 소켓 연결
    PyxisSocket.init({ role: 'admin' });
  }

  setupEventListeners() {
    // 전투 생성 폼
    this.createBattleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createBattle();
    });
  }

  setupSocketEvents() {
    PyxisSocket.on('connection:success', () => {
      UI.success('서버에 관리자 연결됨');
    });

    PyxisSocket.on('battle:created', (battle) => {
      this.addBattleToList(battle);
      UI.success(`전투 생성됨: ${battle.name}`);
    });

    PyxisSocket.on('battle:list', (list) => {
      this.renderBattleList(list);
    });

    PyxisSocket.on('battle:error', (err) => {
      UI.error(`에러: ${err}`);
    });
  }

  // 일반 전투 생성
  async createBattle() {
    const formData = UI.getFormData(this.createBattleForm);
    const payload = {
      name: formData.battleName || '새 전투',
      mode: formData.battleMode || 'custom'
    };

    try {
      await PyxisSocket.send('battle:create', payload);
    } catch (err) {
      console.error('[Admin] Battle create failed:', err);
      UI.error('전투 생성 실패');
    }
  }

  // ✅ 빠른 전투 생성 (1:1, 2:2, 3:3, 4:4)
  async createQuickMatch(size) {
    const payload = {
      name: `${size} vs ${size} 빠른 전투`,
      mode: `${size}v${size}`,
      quick: true
    };

    try {
      await PyxisSocket.send('battle:create', payload);
      UI.success(`${size} vs ${size} 전투가 생성되었습니다`);
    } catch (err) {
      console.error('[Admin] Quick battle create failed:', err);
      UI.error(`${size} vs ${size} 전투 생성 실패`);
    }
  }

  // 전투 목록에 추가
  addBattleToList(battle) {
    const entry = document.createElement('div');
    entry.className = 'log-entry system';
    entry.innerHTML = `
      <span class="log-time">${UI.formatTime(Date.now())}</span>
      <span class="log-content">
        <b>${battle.name}</b> [${battle.mode}] - ID: ${battle.id}
      </span>
    `;
    this.battleList.appendChild(entry);
    UI.scrollToBottom(this.battleList);
  }

  // 전투 목록 렌더링
  renderBattleList(list) {
    this.battleList.innerHTML = '';
    list.forEach((battle) => this.addBattleToList(battle));
  }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  window.admin = new PyxisAdmin();
});
