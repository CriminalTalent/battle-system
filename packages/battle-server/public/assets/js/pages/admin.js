// admin.js
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const UI = {
    toastTimer: null,
    toast(msg, type = 'ok') {
      const box = $('#toast');
      if (!box) return;
      box.textContent = msg;
      box.className = `toast show ${type}`;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        box.classList.remove('show');
      }, 2600);
    },
    copy(selector) {
      const el = $(selector);
      if (!el) return this.toast('복사 대상이 없습니다', 'warn');
      const text = el.value || el.textContent || '';
      if (!text) return this.toast('복사할 내용이 없습니다', 'warn');
      navigator.clipboard.writeText(text).then(
        () => this.toast('클립보드로 복사됨'),
        () => this.toast('복사 실패', 'err')
      );
    },
    setValue(id, v) { const el = typeof id === 'string' ? $(id) : id; if (el) el.value = v ?? ''; },
    getValue(id) { const el = typeof id === 'string' ? $(id) : id; return el ? (el.value || '') : ''; },
  };

  async function j(url, { method = 'GET', body, headers } = {}) {
    const res = await fetch(url, {
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        headers || {}
      ),
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  function getBattleIdFromURL() {
    const p = new URLSearchParams(location.search);
    return p.get('battle') || '';
  }
  function setURLBattleId(id) {
    const u = new URL(location.href);
    if (id) { u.searchParams.set('battle', id); }
    else { u.searchParams.delete('battle'); }
    history.replaceState({}, '', u);
  }

  class AdminApp {
    constructor() {
      this.el = {
        battleId: $('#battleId'),
        setBattleId: $('#setBattleId'),
        createBattle: $('#createBattle'),
        genLinks: $('#genLinks'),
        adminLink: $('#adminLink'),
        p1Link: $('#p1Link'),
        p2Link: $('#p2Link'),
        spectatorLink: $('#spectatorLink'),
        genPlayerOtp: $('#genPlayerOtp'),
        genSpectatorOtp: $('#genSpectatorOtp'),
        playerOtp: $('#playerOtp'),
        spectatorOtp: $('#spectatorOtp'),
      };
      this.battleId = '';
      this.bind();
      this.init();
    }

    bind() {
      const e = this.el;
      $('#setBattleId')?.addEventListener('click', () => this.applyBattleId());
      $('#createBattle')?.addEventListener('click', () => this.createBattle());
      $('#genLinks')?.addEventListener('click', () => this.generateLinks());

      $('#genPlayerOtp')?.addEventListener('click', () => this.generateOtp('player'));
      $('#genSpectatorOtp')?.addEventListener('click', () => this.generateOtp('spectator'));

      $$('[data-copy]')?.forEach(btn => {
        btn.addEventListener('click', () => UI.copy(btn.getAttribute('data-copy')));
      });

      // Enter 키로 Battle ID 적용
      this.el.battleId?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') this.applyBattleId();
      });
    }

    init() {
      const fromURL = getBattleIdFromURL();
      if (fromURL) {
        this.battleId = fromURL;
        UI.setValue(this.el.battleId, fromURL);
        UI.toast(`Battle ID 적용: ${fromURL}`);
      }
    }

    ensureBattleId() {
      const id = UI.getValue(this.el.battleId).trim();
      if (!id) {
        UI.toast('Battle ID를 먼저 입력/생성하세요', 'warn');
        return null;
      }
      this.battleId = id;
      setURLBattleId(id);
      return id;
    }

    applyBattleId() {
      const id = this.ensureBattleId();
      if (id) UI.toast(`Battle ID 적용: ${id}`);
    }

    async createBattle() {
      try {
        const r = await j('/api/battles', { method: 'POST', body: { mode: '1v1' } });
        // 서버 응답 케이스 대비: id | battleId | code
        const id = r?.id || r?.battleId || r?.code || '';
        if (!id) throw new Error('서버가 battle id를 반환하지 않았습니다');
        this.battleId = id;
        UI.setValue(this.el.battleId, id);
        setURLBattleId(id);
        UI.toast(`전투 생성 완료: ${id}`);
      } catch (e) {
        UI.toast(`전투 생성 실패: ${e.message}`, 'err');
      }
    }

    async generateLinks() {
      const id = this.ensureBattleId();
      if (!id) return;
      try {
        const r = await j(`/api/admin/battles/${encodeURIComponent(id)}/links`, {
          method: 'POST',
          body: {},
        });
        // 가능한 키 이름들에 대응
        const admin = r.admin || r.adminLink || r.admin_url || '';
        const p1 = r.player1 || r.player1Link || r.player_one || r.p1 || '';
        const p2 = r.player2 || r.player2Link || r.player_two || r.p2 || '';
        const spec = r.spectator || r.spectatorLink || r.viewer || r.watch || '';

        UI.setValue(this.el.adminLink, admin);
        UI.setValue(this.el.p1Link, p1);
        UI.setValue(this.el.p2Link, p2);
        UI.setValue(this.el.spectatorLink, spec);

        UI.toast('공유 링크가 생성되었습니다');
      } catch (e) {
        UI.toast(`링크 생성 실패: ${e.message}`, 'err');
      }
    }

    async generateOtp(role) {
      const id = this.ensureBattleId();
      if (!id) return;
      try {
        const r = await j(`/api/admin/battles/${encodeURIComponent(id)}/otp`, {
          method: 'POST',
          body: { role },
        });
        const otp = r?.otp || r?.token || r?.code || '';
        if (!otp) throw new Error('서버가 OTP를 반환하지 않았습니다');

        if (role === 'player') UI.setValue(this.el.playerOtp, otp);
        if (role === 'spectator') UI.setValue(this.el.spectatorOtp, otp);

        UI.toast(`${role} OTP 발급 완료`);
      } catch (e) {
        UI.toast(`${role} OTP 발급 실패: ${e.message}`, 'err');
      }
    }
  }

  // 런치
  window.addEventListener('DOMContentLoaded', () => new AdminApp());
})();
