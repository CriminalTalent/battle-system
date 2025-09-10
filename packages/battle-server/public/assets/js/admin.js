/* PYXIS Admin - 관리자 클라이언트 (비밀번호/링크 발급 + 참가자 관리 + 채팅 + 개별 복사) */
(() => {
  const $ = (id) => document.getElementById(id);

  const TEAM_LABEL = {
    phoenix: '불사조 기사단',
    eaters: '죽음을 먹는 자'
  };

  /** 결과 영역을 항목별(칸)로 렌더링하고 각 값 클릭 시 개별 복사 */
  function renderCopyList(items) {
    const list = $('issueList');
    if (!list) return;
    list.innerHTML = '';

    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      const row = document.createElement('div');
      row.className = 'copy-row';
      row.innerHTML = `<span class="copy-label">-</span><code class="copy-value">-</code>`;
      list.appendChild(row);
      return;
    }

    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'copy-row';

      const lab = document.createElement('span');
      lab.className = 'copy-label';
      lab.textContent = label || '정보';

      const val = document.createElement('code');
      val.className = 'copy-value';
      val.textContent = value || '-';
      val.dataset.copy = value || '';

      val.addEventListener('click', () => {
        const text = val.dataset.copy;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          const orig = val.textContent;
          val.textContent = `${orig} (복사됨)`;
          setTimeout(() => (val.textContent = orig), 1200);
        });
      });

      row.appendChild(lab);
      row.appendChild(val);
      list.appendChild(row);
    });
  }

  class AdminApp {
    constructor() {
      this.socket = null;
      this.currentBattleId = null;
      this.token = null;
      this.connected = false;
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

      // 비밀번호 발급(클라이언트 계산 후 리스트 렌더)
      $('btnIssuePlayerPw')?.addEventListener('click', () => this.issuePlayerPasswords());
      $('btnIssueSpectatorPw')?.addEventListener('click', () => this.issueSpectatorPassword());

      // 링크 발급(서버 요청 → 수신 후 리스트 렌더)
      $('btnIssuePlayerLinks')?.addEventListener('click', () => {
        if (!this.currentBattleId) return this.setIssueList([{ label: '오류', value: '전투 ID가 없습니다.' }]);
        this.socket.emit('generatePlayerPassword', { battleId: this.currentBattleId });
        this.setIssueList([{ label: '상태', value: '전투 참가자 링크 발급 요청 중...' }]);
      });
      $('btnIssueSpectatorLink')?.addEventListener('click', () => {
        if (!this.currentBattleId) return this.setIssueList([{ label: '오류', value: '전투 ID가 없습니다.' }]);
        this.socket.emit('generateSpectatorOtp', { battleId: this.currentBattleId });
        this.setIssueList([{ label: '상태', value: '관전자 링크 발급 요청 중...' }]);
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

        if (this.currentBattleId) {
          this.socket.emit('join', { battleId: this.currentBattleId });
        }
        if (this.currentBattleId && this.token) {
          this.socket.emit('adminAuth', { battleId: this.currentBattleId, token: this.token });
        }
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this.setConn(false);
        this.log('system', '서버 연결 해제');
      });

      // 인증
      this.socket.on('auth:success', ({ role, battleId }) => {
        if (battleId) this.currentBattleId = battleId;
        $('currentBattleId').textContent = this.currentBattleId || '-';
        this.log('system', `인증 성공 (${role})`);
      });
      this.socket.on('authError', (e) => {
        console.error('authError', e);
        alert('관리자 시스템 로드 실패: ' + (e?.error || '인증 오류'));
      });

      // 전투 생성
      this.socket.on('battleCreated', (data) => {
        this.currentBattleId = data.battleId;
        $('currentBattleId').textContent = data.battleId;
        $('currentMode').textContent = data.mode;
        this.setIssueList([]);
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

      // 참가자 추가/삭제
      this.socket.on('playerAdded', (payload) => {
        const ok = payload?.success ?? false;
        const player = payload?.player ?? payload;
        if (ok && player) {
          const exists = this.players.find((p) => p.id === player.id);
          if (!exists) this.players.push(player);
          this.renderRoster();
          this.log('system', `전투 참가자 추가됨: ${player.name}`);
        } else if (!ok) {
          alert('전투 참가자 추가 실패: ' + (payload?.error || '알 수 없는 오류'));
        }
      });
      this.socket.on('playerRemoved', (payload) => {
        if (payload?.success) {
          const id = payload.playerId;
          this.players = this.players.filter((p) => p.id !== id);
          this.renderRoster();
          this.log('system', `전투 참가자 제거됨: ${id}`);
        }
      });

      // 링크 발급 결과(서버 → 개별 항목 렌더)
      this.socket.on('playerPasswordGenerated', (res) => {
        if (!res?.success) {
          return this.setIssueList([{ label: '오류', value: '전투 참가자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류') }]);
        }
        const items = (res.playerLinks || []).map((p) => ({
          label: `전투 참가자 링크 (${TEAM_LABEL[p.team] || p.team} - ${p.name})`,
          value: p.url
        }));
        this.setIssueList(items.length ? items : [{ label: '알림', value: '발급된 전투 참가자 링크가 없습니다.' }]);
      });

      this.socket.on('spectatorOtpGenerated', (res) => {
        if (!res?.success) {
          return this.setIssueList([{ label: '오류', value: '관전자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류') }]);
        }
        this.setIssueList([{ label: '관전자 링크', value: res.spectatorUrl }]);
      });

      // 채팅/로그
      this.socket.on('battle:chat', (msg) => this.addChat(msg.name || '익명', msg.message || ''));
      this.socket.on('battle:log',  (entry) => this.log(entry.type || 'log', entry.message || ''));

      // 전투 시작 알림 및 선공 메시지 한글화
      this.socket.on('battle:started', (data) => {
        // data: { firstTeam, agility1, agility2, team1, team2 }
        const team1 = TEAM_LABEL[data.team1] || data.team1;
        const team2 = TEAM_LABEL[data.team2] || data.team2;
        this.log('system', `전투 시작! ${team1} 팀 선공 (민첩성: ${team1}=${data.agility1}, ${team2}=${data.agility2})`);
      });
    }

    setConn(ok) {
      const dot = $('connDot'), txt = $('connText');
      if (!dot || !txt) return;
      dot.classList.remove('ok', 'bad');
      dot.classList.add(ok ? 'ok' : 'bad');
      txt.textContent = ok ? '연결됨' : '해제됨';
    }

    /** 발급 결과 영역을 배열로 받아 칸(행) 단위로 렌더 */
    setIssueList(items) {
      renderCopyList(items);
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
      this.socket.emit('addPlayer', { battleId: this.currentBattleId, playerData });
      this.log('system', `전투 참가자 추가 요청: ${name} (${TEAM_LABEL[team] || team})`);
    }

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

        // 자세히(한글화)
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '자세히';
        const inner = document.createElement('div');
        inner.style.marginTop = '6px';
        inner.innerHTML = `
          <div class="mono">식별자: ${p.id}</div>
          <div>스탯 - 공격 ${p.stats?.attack}, 방어 ${p.stats?.defense}, 민첩 ${p.stats?.agility}, 행운 ${p.stats?.luck}</div>
          <div>아이템 - 디터니 ${p.items?.dittany ?? 0}, 공격 보정기 ${p.items?.attack_booster ?? 0}, 방어 보정기 ${p.items?.defense_booster ?? 0}</div>
          ${p.avatar ? `<div>이미지 주소: <a href="#" class="copyable" data-copy="${p.avatar}">${p.avatar}</a></div>` : ''}
        `;
        details.appendChild(summary);
        details.appendChild(inner);

        // 상세 내 개별 복사 (이미지 주소 등)
        inner.querySelectorAll('.copyable').forEach((a) => {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            const text = a.dataset.copy;
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
              const orig = a.textContent;
              a.textContent = `${orig} (복사됨)`;
              setTimeout(() => (a.textContent = orig), 1200);
            });
          });
        });

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

    // 비밀번호 (클라이언트 계산 → 개별 행)
    issuePlayerPasswords() {
      if (!this.currentBattleId) return this.setIssueList([{ label: '오류', value: '전투 ID가 없습니다.' }]);
      if (!this.players.length) return this.setIssueList([{ label: '알림', value: '발급할 전투 참가자가 없습니다.' }]);
      const items = this.players.map((p) => ({
        label: `전투 참가자 비밀번호 (${TEAM_LABEL[p.team] || p.team} - ${p.name})`,
        value: `player-${p.name}-${this.currentBattleId}`
      }));
      this.setIssueList(items);
    }

    issueSpectatorPassword() {
      if (!this.currentBattleId) return this.setIssueList([{ label: '오류', value: '전투 ID가 없습니다.' }]);
      this.setIssueList([{ label: '관전자 비밀번호', value: `spectator-${this.currentBattleId}` }]);
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

  document.addEventListener('DOMContentLoaded', () => {
    const app = new AdminApp();
    window.PyxisAdmin = app;
    app.init();
  });
})();

// PYXIS 관리자용 전투 룰 계산 함수 (플레이어/관전자와 동일하게 적용)
function calcAttack(player, target) {
  // 공격력 + 주사위(1~20) - 상대 방어력
  const dice = rollDice();
  const attack = player.atk + dice - target.def;
  return Math.max(0, attack);
}

function calcHit(player) {
  // 행운 + 주사위(1~20)
  return player.luk + rollDice();
}

function calcDodge(player) {
  // 민첩 + 주사위(1~20)
  return player.dex + rollDice();
}

function isCritical(player) {
  // 주사위(1~20) ≥ (20 - 행운/2)
  const dice = rollDice();
  return dice >= (20 - player.luk / 2);
}

function calcDefense(player, attacker) {
  // 민첩 + 주사위(1~20) - 상대 공격수치
  return player.dex + rollDice() - attacker.atk;
}

function calcDamage(attacker, defender) {
  // 방어력 - 상대 공격력 = 남은 수만큼 대미지
  return Math.max(0, attacker.atk - defender.def);
}

function isDodgeSuccess(player, attacker) {
  // 민첩 + 주사위(1~20) ≥ 상대 공격수치
  return (player.dex + rollDice()) >= attacker.atk;
}

function useAtkItem(player) {
  // 공격력 ×1.5, 성공확률 10%
  if (Math.random() < 0.1) return player.atk * 1.5;
  return player.atk;
}
function useDefItem(player) {
  // 방어력 ×1.5, 성공확률 10%
  if (Math.random() < 0.1) return player.def * 1.5;
  return player.def;
}
function useHealItem(player) {
  // HP 10 고정 회복
  player.hp = Math.min(player.maxHp, player.hp + 10);
}

function rollDice() {
  return Math.floor(Math.random() * 20) + 1;
}
