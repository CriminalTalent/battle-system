/* ═══════════════════════════════════════════════════════════════════════
   PYXIS Admin JavaScript
   ─────────────────────────────────────────────────────────────────────
   관리자 페이지 핵심 로직 및 UI 제어
   Socket.IO 연동 및 실시간 전투 관리
   ═══════════════════════════════════════════════════════════════════════ */

class PyxisAdmin {
  constructor() {
    this.currentBattleId = null;
    this.adminOtp = null;
    this.spectatorOtp = null;
    this.playerList = [];
    this.battleState = 'waiting';
    this.socket = null;
    this.isConnected = false;
    this.state = {};
  }

  init() {
    console.log('[PYXIS Admin] Initializing...');
    this.setupSocket();
    this.setupEventListeners();
    this.addLog('system', '관리자 시스템 초기화 완료');
  }

  setupSocket() {
    this.socket = io({ withCredentials: true });

    this.socket.on('connect', () => {
      console.log('[SOCKET] Connected');
      this.isConnected = true;
      this.addLog('system', '서버와 연결됨');
    });

    this.socket.on('disconnect', () => {
      console.log('[SOCKET] Disconnected');
      this.isConnected = false;
      this.addLog('system', '서버 연결 해제');
    });

    // battle events
    this.socket.on('battleCreated', (data) => {
      this.currentBattleId = data.battleId;
      document.getElementById('currentBattleId').textContent = data.battleId;
      document.getElementById('currentMode').textContent = data.mode;
      document.getElementById('adminUrl').textContent = data.adminUrl;
      document.getElementById('playerUrl').textContent = data.playerBase;
      document.getElementById('spectatorUrl').textContent = data.spectatorBase;
      this.addLog('system', `전투 생성됨: ${data.battleId}`);
    });

    this.socket.on('playerAdded', (player) => {
      this.addPlayerToRoster(player);
      this.addLog('system', `플레이어 추가됨: ${player.name}`);
    });

    this.socket.on('battleLog', (entry) => {
      this.addLog(entry.type, entry.message);
    });

    this.socket.on('chat', (msg) => {
      this.addChat(msg.user, msg.text);
    });
  }

  setupEventListeners() {
    const btnCreateBattle = document.getElementById('btnCreateBattle');
    if (btnCreateBattle) {
      btnCreateBattle.addEventListener('click', () => {
        const mode = document.getElementById('battleMode').value;
        this.createBattle(mode);
      });
    }

    const btnAddPlayer = document.getElementById('btnAddPlayer');
    if (btnAddPlayer) {
      btnAddPlayer.addEventListener('click', () => {
        this.addPlayer();
      });
    }

    const btnChatSend = document.getElementById('btnChatSend');
    if (btnChatSend) {
      btnChatSend.addEventListener('click', () => {
        const text = document.getElementById('chatText').value;
        if (text && this.socket) {
          this.socket.emit('chat', { text });
          document.getElementById('chatText').value = '';
        }
      });
    }
  }

  createBattle(mode) {
    if (!this.socket) return;
    this.socket.emit('createBattle', { mode });
    this.addLog('system', `전투 생성 요청: ${mode}`);
  }

  addPlayer() {
    if (!this.socket) return;
    const name = document.getElementById('pName').value;
    const team = document.getElementById('pTeam').value;
    const stats = {
      attack: parseInt(document.getElementById('sATK').value),
      defense: parseInt(document.getElementById('sDEF').value),
      agility: parseInt(document.getElementById('sDEX').value),
      luck: parseInt(document.getElementById('sLUK').value)
    };
    const hp = parseInt(document.getElementById('pHP').value);
    const items = {
      dittany: parseInt(document.getElementById('itemDittany').value),
      attack_booster: parseInt(document.getElementById('itemAtkBoost').value),
      defense_booster: parseInt(document.getElementById('itemDefBoost').value)
    };

    const avatarInput = document.getElementById('pAvatar');
    const avatarFile = avatarInput && avatarInput.files.length > 0 ? avatarInput.files[0] : null;

    if (avatarFile) {
      const formData = new FormData();
      formData.append('avatar', avatarFile);

      fetch(`/api/battles/${this.currentBattleId}/avatar`, {
        method: 'POST',
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          const avatarUrl = data.url;
          this.socket.emit('addPlayer', { name, team, stats, hp, items, avatar: avatarUrl });
        })
        .catch(err => {
          console.error('아바타 업로드 오류:', err);
        });
    } else {
      this.socket.emit('addPlayer', { name, team, stats, hp, items });
    }
  }

  addPlayerToRoster(player) {
    let teamName = '';
    let container = null;

    if (player.team === 'phoenix') {
      teamName = '불사조 기사단';
      container = document.getElementById('rosterPhoenix');
    } else if (player.team === 'eaters') {
      teamName = '죽음을 먹는 자';
      container = document.getElementById('rosterEaters');
    }

    if (!container) return;
    const el = document.createElement('div');
    el.className = 'roster-player';
    el.textContent = `${teamName} - ${player.name} (HP: ${player.hp})`;
    container.appendChild(el);
  }

  addLog(type, message) {
    const log = document.getElementById('battleLog');
    if (!log) return;
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.textContent = `[${type}] ${message}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  addChat(user, text) {
    const chatView = document.getElementById('chatView');
    if (!chatView) return;
    const el = document.createElement('div');
    el.className = 'chat-entry';
    el.textContent = `${user}: ${text}`;
    chatView.appendChild(el);
    chatView.scrollTop = chatView.scrollHeight;
  }

  getDebugInfo() {
    return {
      battleId: this.currentBattleId,
      isConnected: this.isConnected,
      players: this.playerList,
      state: this.state
    };
  }
}

window.PyxisAdmin = new PyxisAdmin();

/* === 자동 초기화 === */
document.addEventListener('DOMContentLoaded', () => {
  if (window.PyxisAdmin && typeof window.PyxisAdmin.init === 'function') {
    window.PyxisAdmin.init();
  }
});
