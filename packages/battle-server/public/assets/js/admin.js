/* PYXIS Admin - 관리자 클라이언트 (비밀번호 발급 / 참가자 관리 강화) */
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

      /** 최신 전투 상태의 플레이어 목록(서버에서 내려주는 원본) */
      this.players = [];
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

      // 비밀번호 발급(링크 아님)
      $('btnIssuePlayerPw')?.addEventListener('click', () => this.issuePlayerPasswords());
      $('btnIssueSpectatorPw')?.addEventListener('click', () => this.issueSpectatorPassword());

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

        // 룸 합류
        if (this.currentBattleId) {
          this.socket.emit('join', { battleId: this.currentBattleId });
        }
        // 관리자 인증
        if (this.currentBattleId && this.token) {
          this.socket.emit('adminAuth', { battleId: this.currentBattleId, token: this.token });
        }
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this.setConn(false);
        this.log('system', '서버 연결 해제');
      });

      // 인증 성공/오류
      this.socket.on('auth:success', ({ role, battleId }) => {
        if (battleId) this.currentBattleId = battleId;
        $('currentBattleId').textContent = this.currentBattleId || '-';
        this.log('system', `인증 성공 (${role})`);
      });
      this.socket.on('authError', (e) => {
        console.error('authError', e);
        alert('관리자 시스템 로드 실패: ' + (e?.error || '인증 오류'));
      });

      // 전투 생성 결과
      this.socket.on('battleCreated', (data) => {
        this.currentBattleId = data.battleId;
        $('currentBattleId').textContent = data.battleId;
        $('currentMode').textContent = data.mode;
        $('adminUrl').textContent = data.adminUrl || '-';
        $('playerUrl').textContent = data.playerBase || '-';
        $('spectatorUrl').textContent = data.spectatorBase || '-';
        this.log('system', `전투 생성됨: ${data.battleId}`);
      });

      // 상태 업데이트
      this.socket.on('battle:update', (battle) => {
        if (!battle || !battle.id) return;
        this.currentBattleId = battle.id;
        $('currentBattleId').textContent = battle.id;
        $('currentMode').textContent = battle.mode || '-';
        this.players = Array.isArray(battle.players) ? battle.players : [];
        this.renderRoster();
      });

      // 참가자 추가 결과
      this.socket.on('playerAdded', (payload) => {
        const ok = payload?.success ?? false;
        const player = payload?.player ?? payload;
        if (ok && player) {
          // 최신 목록을 재요청하지 않아도 되도록 로컬 반영 + 렌더
          const exists = this.players.find((p) => p.id === player.id);
          if (!exists) this.players.push(player);
          this.renderRoster();
          this.log('system', `전투 참가자 추가됨: ${player.name}`);
        } else if (!ok) {
          alert('전투 참가자 추가 실패: ' + (payload?.error || '알 수 없는 오류'));
        }
      });

      // 참가자 제거 결과
      this.socket.on('playerRemoved', (payload) => {
        if (payload?.success) {
          const id = payload.playerId;
          this.players = this.players.filter((p) => p.id !== id);
          this.renderRoster();
          this.log('system', `전투 참가자 제거됨: ${id}`);
        } else {
          alert('전투 참가자 제거 실패: ' + (payload?.error || '알 수 없는 오류'));
        }
      });

      // 전투 이벤트들
      ['battle:started','battle:ended','battle:paused','battle:resumed'].forEach(evt => {
        this.socket.on(evt, (battle) => {
          if (battle?.players) {
            this.players = battle.players;
            this.renderRoster();
          }
        });
      });

      // 채팅/로그
      this.socket.on('battle:chat', (msg) => this.addChat(msg.name || '익명', msg.message || ''));
      this.socket.on('battle:log',  (entry) => this.log(entry.type || 'log', entry.message || ''));
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
          fd.append('avatar', file); // 서버 필드명: avatar
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
      // 서버 스펙: { battleId, playerData }
      this.socket.emit('addPlayer', { battleId: this.currentBattleId, playerData });
      this.log('system', `전투 참가자 추가 요청: ${name} (${TEAM_LABEL[team] || team})`);
    }

    /** 참가자 목록 렌더 + 상세/삭제 버튼 */
    renderRoster() {
      const px = $('rosterPhoenix');
      const et = $('rosterEaters');
      if (px) px.innerHTML = '';
      if (et) et.innerHTML = '';

      (this.players || []).forEach((p) => {
        const container = p.team === 'phoenix' ? px : et;
        if (!container) return;

        const wrap = document.createElement('div');
        wrap.className = 'roster-player';

        const title = document.createElement('div');
        title.style.display = 'flex';
        title.style.justifyContent = 'space-between';
        title.style.alignItems = 'center';
        title.innerHTML = `<strong>${TEAM_LABEL[p.team] || p.team} - ${p.name}</strong> <span class="muted">HP: ${p.hp}</span>`;

        // details: 스탯/아이템 확인
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '자세히';
        const inner = document.createElement('div');
        inner.style.marginTop = '6px';
        inner.innerHTML = `
          <div class="mono">ID: ${p.id}</div>
          <div>스탯 - ATK ${p.stats?.attack}, DEF ${p.stats?.defense}, AGI ${p.stats?.agility}, LUK ${p.stats?.luck}</div>
          <div>아이템 - 디터니 ${p.items?.dittany ?? 0}, 공격 보정기 ${p.items?.attack_booster ?? 0}, 방어 보정기 ${p.items?.defense_booster ?? 0}</div>
          ${p.avatar ? `<div>이미지: <a href="${p.avatar}" target="_blank">${p.avatar}</a></div>` : ''}
        `;
        details.appendChild(summary);
        details.appendChild(inner);

        // 삭제 버튼
        const btnRow = document.createElement('div');
        btnRow.className = 'row-buttons';
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '삭제';
        delBtn.addEventListener('click', () => {
          if (!this.currentBattleId) return alert('전투 ID가 없습니다.');
          if (!confirm(`전투 참가자 "${p.name}"을(를) 삭제할까요?`)) return;
          this.socket.emit('removePlayer', { battleId: this.currentBattleId, playerId: p.id });
        });
        btnRow.appendChild(delBtn);

        wrap.appendChild(title);
        wrap.appendChild(details);
        wrap.appendChild(btnRow);
        container.appendChild(wrap);
      });
    }

    /** 전투 참가자 비밀번호 발급 (링크가 아닌 순수 토큰) */
    issuePlayerPasswords() {
      if (!this.currentBattleId) {
        $('issueResult').textContent = '전투 ID가 없습니다.';
        return;
      }
      if (!this.players.length) {
        $('issueResult').textContent = '발급할 전투 참가자가 없습니다.';
        return;
      }
      const lines = this.players.map((p) => {
        const pw = `player-${p.name}-${this.currentBattleId}`;
        return `• ${TEAM_LABEL[p.team] || p.team} - ${p.name}: ${pw}`;
      });
      $('issueResult').textContent = lines.join('\n');
    }

    /** 관전자 비밀번호 발급 */
    issueSpectatorPassword() {
      if (!this.currentBattleId) {
        $('issueResult').textContent = '전투 ID가 없습니다.';
        return;
      }
      const pw = `spectator-${this.currentBattleId}`;
      $('issueResult').textContent = `관전자 비밀번호: ${pw}`;
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
