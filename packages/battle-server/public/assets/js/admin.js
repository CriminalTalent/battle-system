/* PYXIS Admin - A/B 팀표기, 스탯 한글, 아바타 미리보기, 로그 꼬리표 숨김, 관전자 발급 연동 */
(() => {
  const $  = (sel, r = document) => r.querySelector(sel);
  const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));

  const TEAM_SHORT = (key) => (key === 'eaters' ? 'B' : 'A'); // 화면 표시만 A/B

  class AdminApp {
    constructor() {
      this.socket = null;
      this.battleId = null;
      this.players = [];
    }

    init() {
      this.bindUI();
      this.connect();
    }

    bindUI() {
      // 전투
      $('#btnCreateBattle')?.addEventListener('click', () => {
        const mode = $('#battleMode').value || '1v1';
        this.socket?.emit('createBattle', { mode });
        this.log({ type: 'system', message: `전투 생성 요청: ${mode}` });
      });
      $('#btnStartBattle')?.addEventListener('click', () => this.emitIfId('startBattle'));
      $('#btnPauseBattle')?.addEventListener('click', () => this.emitIfId('pauseBattle'));
      $('#btnResumeBattle')?.addEventListener('click', () => this.emitIfId('resumeBattle'));
      $('#btnEndBattle')?.addEventListener('click', () => this.emitIfId('endBattle'));

      // 참가자 추가
      $('#btnAddPlayer')?.addEventListener('click', () => this.addPlayer());

      // 아바타 미리보기
      $('#pImage')?.addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        const img = $('#pImagePreview');
        if (!img) return;
        if (!f) { img.src = ''; return; }
        img.src = URL.createObjectURL(f);
      });

      // 발급 도구(공용 리스트)
      $('#btnIssuePlayerLinks')?.addEventListener('click', () => this.issuePlayerLinks());
      $('#btnIssueSpectatorLink')?.addEventListener('click', () => this.issueSpectatorLink());

      $('#btnIssuePlayerPw')?.addEventListener('click', () => this.copyList([
        { label: '안내', value: '플레이어는 개별 링크를 통해 자동 인증됩니다.' }
      ]));
      $('#btnIssueSpectatorPw')?.addEventListener('click', () => {
        if (!this.battleId) return this.copyList([{ label: '오류', value: '전투 ID 없음' }]);
        this.copyList([{ label: '관전자 비밀번호', value: `spectator-${this.battleId}` }]);
      });

      // 채팅
      $('#btnChatSend')?.addEventListener('click', () => this.sendChat());
      $('#chatText')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChat(); });
    }

    emitIfId(event) {
      if (!this.battleId) return alert('전투 ID가 없습니다.');
      this.socket.emit(event, { battleId: this.battleId });
    }

    connect() {
      const s = window.io ? window.io(undefined, { transports: ['websocket'], withCredentials: true }) : null;
      if (!s) return alert('Socket.IO 로드 실패');

      this.socket = s;
      window.PyxisAdmin = this; // spectatorIssue helper에서 사용

      const dot = $('#connDot'); const txt = $('#connText');
      const setConn = (ok) => { if (dot) dot.className = 'dot ' + (ok ? 'ok':'bad'); if (txt) txt.textContent = ok ? '연결됨' : '연결 끊김'; };

      s.on('connect', () => setConn(true));
      s.on('disconnect', () => setConn(false));

      // 전투 생성 결과
      s.on('battleCreated', (res) => {
        if (!res || res.success === false) {
          alert('전투 생성 실패: ' + (res?.error || '알 수 없는 오류'));
          return;
        }
        this.battleId = res.battleId;
        $('#currentBattleId').textContent = res.battleId;
        $('#currentMode').textContent = res.mode || '-';
        s.emit('join', { battleId: res.battleId });
      });

      // 상태 업데이트
      s.on('battle:update', (b) => {
        if (!b) return;
        this.battleId = b.id;
        $('#currentBattleId').textContent = b.id || '-';
        $('#currentMode').textContent = b.mode || '-';
        this.players = Array.isArray(b.players) ? b.players : [];
        this.renderRoster();
        this.renderLogs(Array.isArray(b.log) ? b.log : []);
      });

      // 단일 로그/채팅
      s.on('battle:log', (entry) => this.log(entry));
      s.on('battle:chat', ({ name, message }) => this.addChat(name, message));

      // 관전자 링크 발급 결과(공용 리스트에서 사용)
      s.on('spectatorOtpGenerated', (res) => {
        if (!res?.success) {
          this.copyList([{ label: '오류', value: '관전자 링크 발급 실패: ' + (res?.error || '알 수 없는 오류') }]);
          return;
        }
        this.copyList([{ label: '관전자 링크', value: res.spectatorUrl }]);
      });
    }

    // 참가자 추가
    async addPlayer() {
      if (!this.battleId) return alert('전투 ID가 없습니다.');

      const name = ($('#pName')?.value || '').trim();
      const team = $('#pTeam')?.value || 'phoenix';
      const hp = parseInt($('#pHP')?.value || '100', 10);
      const stats = {
        attack: parseInt($('#sATK')?.value || '3', 10),
        defense: parseInt($('#sDEF')?.value || '3', 10),
        agility: parseInt($('#sDEX')?.value || '3', 10),
        luck: parseInt($('#sLUK')?.value || '3', 10)
      };
      const items = {
        dittany: parseInt($('#itemDittany')?.value || '1', 10),
        attack_booster: parseInt($('#itemAtkBoost')?.value || '1', 10),
        defense_booster: parseInt($('#itemDefBoost')?.value || '1', 10)
      };

      // 아바타 업로드(선택)
      let avatarUrl = null;
      const file = $('#pImage')?.files?.[0] || null;
      if (file) {
        try {
          const fd = new FormData();
          fd.append('avatar', file);
          const res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
          const data = await res.json();
          if (data?.ok && data?.avatarUrl) avatarUrl = data.avatarUrl;
        } catch (e) { console.warn('이미지 업로드 실패', e); }
      }

      const playerData = { name, team, hp, stats, items, avatar: avatarUrl };
      this.socket.emit('addPlayer', { battleId: this.battleId, playerData });
    }

    // 인원 목록 렌더 (아바타 + 한글 스탯, 팀 A/B 뱃지)
    renderRoster() {
      const a = $('#rosterPhoenix'); const b = $('#rosterEaters');
      if (a) a.innerHTML = ''; if (b) b.innerHTML = '';

      (this.players || []).forEach((p) => {
        const box = document.createElement('div');
        box.className = 'player';

        // avatar
        const av = document.createElement('div');
        av.className = 'avatar';
        if (p.avatar) {
          const img = document.createElement('img');
          img.src = p.avatar;
          img.alt = p.name || 'avatar';
          img.onerror = () => { av.textContent = (p.name||'U').charAt(0).toUpperCase(); };
          av.appendChild(img);
        } else {
          av.textContent = (p.name||'U').charAt(0).toUpperCase();
        }

        const info = document.createElement('div');

        const name = document.createElement('div');
        name.style.fontWeight = '800';
        name.textContent = p.name || '이름없음';

        const tag = document.createElement('span');
        tag.className = 'badge';
        tag.style.marginLeft = '6px';
        tag.textContent = `팀 ${TEAM_SHORT(p.team)}`;
        name.appendChild(tag);

        const hp = document.createElement('div');
        hp.className = 'mono';
        hp.textContent = `HP ${Math.max(0, p.hp||0)} / ${Math.max(1, p.maxHp||1)}`;

        // 스탯 한글
        const st = document.createElement('div');
        st.className = 'mono';
        const s = p.stats || {};
        st.textContent = `공격 ${s.attack ?? 0} | 방어 ${s.defense ?? 0} | 민첩 ${s.agility ?? 0} | 행운 ${s.luck ?? 0}`;

        info.appendChild(name);
        info.appendChild(hp);
        info.appendChild(st);

        box.appendChild(av);
        box.appendChild(info);

        (p.team === 'eaters' ? b : a).appendChild(box);
      });
    }

    renderLogs(list) {
      const box = $('#battleLog');
      if (!box) return;
      box.innerHTML = '';
      (list || []).slice(-200).forEach((e) => this.log(e, true));
    }

    // 로그에서 " (phoenix팀)" / " (eaters팀)" 숨김
    cleanLogMessage(msg) {
      return String(msg || '').replace(/\s*\((phoenix|eaters)팀\)/gi, '').trim();
    }

    log(entry, appendOnly = false) {
      const box = $('#battleLog');
      if (!box) return;
      const div = document.createElement('div');
      const ts = new Date(entry?.ts || entry?.timestamp || Date.now()).toLocaleTimeString();
      div.textContent = `[${ts}] ${this.cleanLogMessage(entry?.message || '')}`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
      if (!appendOnly && entry?.type) { /* hook */ }
    }

    addChat(name, message) {
      const box = $('#chatView');
      if (!box) return;
      const div = document.createElement('div');
      div.textContent = `${name || '익명'}: ${message || ''}`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }

    sendChat() {
      if (!this.battleId) return;
      const text = ($('#chatText')?.value || '').trim();
      if (!text) return;
      this.socket.emit('chat:send', { battleId: this.battleId, name: '관리자', message: text, role: 'admin' });
      $('#chatText').value = '';
    }

    // 발급 결과를 복사 가능한 리스트로 렌더
    copyList(items = []) {
      const box = $('#issueList');
      if (!box) return;
      box.innerHTML = '';
      if (!items.length) {
        const row = document.createElement('div'); row.className = 'copy-row';
        row.innerHTML = `<span class="copy-label">-</span><span class="copy-value">-</span>`;
        box.appendChild(row); return;
      }
      items.forEach(({ label, value }) => {
        const row = document.createElement('div'); row.className = 'copy-row';
        const lab = document.createElement('span'); lab.className = 'copy-label'; lab.textContent = label || '정보';
        const val = document.createElement('span'); val.className = 'copy-value'; val.textContent = value || '-';
        val.style.userSelect = 'all'; val.style.cursor = 'pointer';
        val.addEventListener('click', () => {
          navigator.clipboard.writeText(value || '').then(() => {
            const o = val.textContent; val.textContent = o + ' (복사됨)'; setTimeout(() => (val.textContent = o), 900);
          });
        });
        row.appendChild(lab); row.appendChild(val); box.appendChild(row);
      });
    }

    issuePlayerLinks() {
      if (!this.battleId) return this.copyList([{ label: '오류', value: '전투 ID 없음' }]);
      // 서버 쪽에서 개별 링크를 바로 만들지 않았으면, 프론트에서 구성
      const base = location.origin + '/player?battle=' + this.battleId;
      const items = (this.players || []).map(p => ({
        label: `플레이어 ${p.name}`,
        value: `${base}&token=player-${encodeURIComponent(p.name)}-${this.battleId}&name=${encodeURIComponent(p.name)}`
      }));
      if (!items.length) items.push({ label: '안내', value: '먼저 참가자를 추가하세요.' });
      this.copyList(items);
    }

    issueSpectatorLink() {
      if (!this.battleId) return this.copyList([{ label: '오류', value: '전투 ID 없음' }]);
      const url = `${location.origin}/spectator?battle=${this.battleId}&otp=spectator-${this.battleId}`;
      this.copyList([{ label: '관전자 링크', value: url }]);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const app = new AdminApp();
    app.init();
  });
})();
