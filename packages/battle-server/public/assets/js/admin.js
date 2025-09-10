/* PYXIS Admin - 관리자 클라이언트 */

(() => {
  const $ = (id) => document.getElementById(id);

  const TEAM_LABEL = {
    phoenix: '불사조 기사단',
    eaters: '죽음을 먹는 자'
  };

  class AdminApp {
    constructor() {
      this.socket = null;
      this.currentBattleId = null;
      this.token = null;
      this.connected = false;
    }

    init() {
      this.parseQuery();
      this.bindUI();
      this.setupSocket();
      this.log('system', '관리자 클라이언트 초기화');
    }

    parseQuery() {
      const u = new URL(window.location.href);
      this.currentBattleId = u.searchParams.get('battle');
      this.token = u.searchParams.get('token');
      if (this.currentBattleId) $('currentBattleId').textContent = this.currentBattleId;
    }

    bindUI() {
      $('btnCreateBattle')?.addEventListener('click', () => {
        const mode = $('battleMode').value || '1v1';
        this.socket?.emit('createBattle', { mode });
        this.log('system', `전투 생성 요청: ${mode}`);
      });

      $('btnStartBattle')?.addEventListener('click', () => {
        if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
        this.socket.emit('startBattle', { battleId: this.currentBattleId });
      });
      $('btnPauseBattle')?.addEventListener('click', () => {
        if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
        this.socket.emit('pauseBattle', { battleId: this.currentBattleId });
      });
      $('btnResumeBattle')?.addEventListener('click', () => {
        if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
        this.socket.emit('resumeBattle', { battleId: this.currentBattleId });
      });
      $('btnEndBattle')?.addEventListener('click', () => {
        if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
        this.socket.emit('endBattle', { battleId: this.currentBattleId });
      });

      $('btnAddPlayer')?.addEventListener('click', () => this.addPlayer());

      $('btnGenParticipantLinks')?.addEventListener('click', () => {
        if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
        this.socket.emit('generatePlayerPassword', { battleId: this.currentBattleId });
      });
      $('btnGenSpectatorLink')?.addEventListener('click', () => {
        if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
        this.socket.emit('generateSpectatorOtp', { battleId: this.currentBattleId });
      });

      $('btnChatSend')?.addEventListener('click', () => {
        const text = $('chatText').value.trim();
        if (!text || !this.currentBattleId) return;
        this.socket.emit('chat:send', {
          battleId: this.currentBattleId,
          name: '관리자',
          message: text,
          role: 'admin'
        });
        $('chatText').value = '';
      });
    }

    setupSocket() {
      this.socket = io({ withCredentials: true });

      this.socket.on('connect', () => {
        this.connected = true;
        this.setConn(true);
        this.log('system', '서버와 연결됨');

        // 방 조인(일반)
        if (this.currentBattleId) {
          this.socket.emit('join', { battleId: this.currentBattleId });
        }

        // 관리자 인증(쿼리 파라미터 있을 때)
        if (this.currentBattleId && this.token) {
          this.socket.emit('adminAuth', {
            battleId: this.currentBattleId,
            token: this.token
          });
        }
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this.setConn(false);
        this.log('system', '서버 연결 해제');
      });

      // 인증 성공
      this.socket.on('auth:success', ({ role, battleId }) => {
        if (battleId) this.currentBattleId = battleId;
        $('currentBattleId').textContent = this.currentBattleId || '-';
        this.log('system', `인증 성공 (${role})`);
      });

      // 인증 에러
      this.socket.on('authError', (e) => {
        console.error('authError', e);
        alert('관리자 시스템 로드 실패: ' + (e?.error || '인증 오류'));
      });

      // 전투 생성 결과
      this.socket.on('battleCreated', (data) => {
        this.currentBattleId = data.battleId;
        $('currentBattleId').textContent = data.battleId;
        $('currentMode').textContent = data.mode;
        $('adminUrl').textContent = data.adminUrl;
        $('playerUrl').textContent = data.playerBase;
        $('spectatorUrl').textContent = data.spectatorBase;
        this.log('system', `전투 생성됨: ${data.battleId}`);
      });

      // 전투 상태 업데이트 수신 → 목록 렌더
      this.socket.on('battle:update', (battle) => {
        if (!battle || !battle.id) return;
        this.currentBattleId = battle.id;
        $('currentBattleId').textContent = battle.id;
        $('currentMode').textContent = battle.mode || '-';
        this.renderRoster(battle.players || []);
      });

      // 전투 시작/종료/일시정지/재개 알림 → 최신 상태로 반영
      this.socket.on('battle:started', (battle) => this.renderRoster(battle.players || []));
      this.socket.on('battle:ended',   (battle) => this.renderRoster(battle.players || []));
      this.socket.on('battle:paused',  (battle) => this.renderRoster(battle.players || []));
      this.socket.on('battle:resumed', (battle) => this.renderRoster(battle.players || []));

      // 전투 참가자 추가 결과(서버는 {success, player} 형태로 내려줌)
      this.socket.on('playerAdded', (payload) => {
        const ok = payload?.success ?? false;
        const player = payload?.player ?? payload; // 호환
        if (ok && player) {
          this.addPlayerToRoster(player);
          this.log('system', `전투 참가자 추가됨: ${player.name}`);
        } else if (!ok) {
          alert('전투 참가자 추가 실패: ' + (payload?.error || '알 수 없는 오류'));
        }
      });

      // 링크 발급 결과
      this.socket.on('playerPasswordGenerated', (res) => {
        if (!res?.success) {
          $('issueResult').textContent = '전투 참가자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류');
          return;
        }
        const lines = (res.playerLinks || []).map(
          (p) => `• ${TEAM_LABEL[p.team] || p.team} - ${p.name}: ${p.url}`
        );
        $('issueResult').textContent = lines.length ? lines.join('\n') : '발급된 링크가 없습니다.';
      });

      this.socket.on('spectatorOtpGenerated', (res) => {
        if (!res?.success) {
          $('issueResult').textContent = '관전자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류');
          return;
        }
        $('issueResult').textContent = `관전자 링크: ${res.spectatorUrl}`;
      });

      // 채팅 수신
      this.socket.on('battle:chat', (msg) => {
        this.addChat(msg.name || '익명', msg.message || '');
      });

      // 로그 수신
      this.socket.on('battle:log', (entry) => {
        this.log(entry.type || 'log', entry.message || '');
      });
    }

    setConn(ok) {
      const dot = $('connDot'), txt = $('connText');
      if (!dot || !txt) return;
      dot.classList.remove('ok', 'bad');
      dot.classList.add(ok ? 'ok' : 'bad');
      txt.textContent = ok ? '연결됨' : '해제됨';
    }

    async addPlayer() {
      if (!this.currentBattleId) {
        alert('전투 ID가 없습니다. 먼저 전투를 생성하거나 adminUrl로 접속하세요.');
        return;
      }

      const name = $('pName').value.trim();
      const team = $('pTeam').value;
      const stats = {
        attack: parseInt($('sATK').value || '3', 10),
        defense: parseInt($('sDEF').value || '3', 10),
        agility: parseInt($('sDEX').value || '3', 10),
        luck: parseInt($('sLUK').value || '3', 10)
      };
      const hp = parseInt($('pHP').value || '100', 10);
      const items = {
        dittany: parseInt($('itemDittany').value || '1', 10),
        attack_booster: parseInt($('itemAtkBoost').value || '1', 10),
        defense_booster: parseInt($('itemDefBoost').value || '1', 10)
      };

      let avatarUrl = null;
      const file = $('pImage')?.files?.[0] || null;
      if (file) {
        try {
          const fd = new FormData();
          // 서버는 필드명을 'avatar'로 기대한다 (엔드포인트: /api/upload/avatar)
          fd.append('avatar', file);
          const res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
          const data = await res.json();
          if (data?.ok && data?.avatarUrl) {
            avatarUrl = data.avatarUrl;
          } else {
            console.warn('이미지 업로드 실패', data);
          }
        } catch (e) {
          console.error('이미지 업로드 오류', e);
        }
      }

      const playerData = { name, team, stats, hp, items, avatar: avatarUrl };

      // 서버가 기대하는 페이로드: { battleId, playerData }
      this.socket.emit('addPlayer', { battleId: this.currentBattleId, playerData });
      this.log('system', `전투 참가자 추가 요청: ${name} (${TEAM_LABEL[team] || team})`);
    }

    renderRoster(players) {
      const px = $('rosterPhoenix');
      const et = $('rosterEaters');
      if (px) px.innerHTML = '';
      if (et) et.innerHTML = '';
      (players || []).forEach((p) => this.addPlayerToRoster(p));
    }

    addPlayerToRoster(player) {
      const container = player.team === 'phoenix' ? $('rosterPhoenix') : $('rosterEaters');
      if (!container) return;
      const el = document.createElement('div');
      el.className = 'roster-player';
      el.textContent = `${TEAM_LABEL[player.team] || player.team} - ${player.name} (HP: ${player.hp})`;
      container.appendChild(el);
    }

    log(type, message) {
      const box = $('battleLog');
      if (!box) return;
      const el = document.createElement('div');
      el.textContent = `[${type}] ${message}`;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    }

    addChat(name, text) {
      const box = $('chatView');
      if (!box) return;
      const el = document.createElement('div');
      el.textContent = `${name}: ${text}`;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    }
  }

  // 자동 초기화
  document.addEventListener('DOMContentLoaded', () => {
    const app = new AdminApp();
    window.PyxisAdmin = app;
    app.init();
  });
})();
