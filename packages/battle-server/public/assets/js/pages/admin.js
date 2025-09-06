// admin.js
(() => {
  // ========== 유틸 ==========
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const UI = {
    logArea: null,
    init() { this.logArea = $('#logArea'); },
    log(msg, cls = '') {
      if (!this.logArea) return;
      const el = document.createElement('div');
      el.className = 'logline ' + cls;
      el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      this.logArea.appendChild(el);
      this.logArea.scrollTop = this.logArea.scrollHeight;
    },
    copy(text) {
      if (!text) return this.log('복사할 내용이 없습니다','err');
      navigator.clipboard.writeText(text).then(
        () => this.log('클립보드로 복사했습니다.','ok'),
        (e)  => this.log('복사 실패: '+e.message,'err')
      );
    }
  };

  async function jfetch(url, opt = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(opt.headers||{}) },
      ...opt
    });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) {
      const msg = body?.message || body?.error || res.statusText;
      throw new Error(`${res.status} ${msg}`);
    }
    return body ?? {};
  }

  // ========== API 경로 ==========
  const API = {
    health: '/api/health',
    battleCreate: '/api/battles',
    battleStatus: (id) => `/api/battles/${id}`,
    battleEnd:     (id) => `/api/battles/${id}/end`,
    battleReset:   (id) => `/api/battles/${id}/reset`,
    battleMode:    (id) => `/api/battles/${id}/mode`,
    players:       (id) => `/api/battles/${id}/players`,
    playerDelete:  (id, pid) => `/api/battles/${id}/players/${pid}`,
    avatarUpload:  (id) => `/api/battles/${id}/avatar`,
    // 서버 로그 상 /api/admin/battles/:id/otp 는 404 → 전역 OTP 매니저 사용
    otpCreate:     '/api/admin/otp',
    otpList:       '/api/admin/otp/list',
    otpCleanup:    '/api/admin/otp/cleanup',
  };

  // ========== 링크 생성 ==========
  function setLinks() {
    const base = $('#baseUrl')?.value?.replace(/\/+$/, '') || location.origin;
    const bid  = $('#battleId')?.value?.trim() || '';
    const q    = bid ? `?battle=${encodeURIComponent(bid)}` : '';
    const admin = `${base}/admin${q}`;
    const play  = `${base}/play${q}`;
    const spec  = `${base}/spectator${q}`;
    $('#linkAdmin') && ($('#linkAdmin').textContent = admin);
    $('#linkPlayer') && ($('#linkPlayer').textContent = play);
    $('#linkSpectator') && ($('#linkSpectator').textContent = spec);
    return { admin, play, spec };
  }

  // ========== 헬스 체크 ==========
  async function refreshHealth() {
    try {
      const data = await jfetch(API.health);
      $('#envName')     && ($('#envName').textContent = data?.env ?? 'unknown');
      $('#serverAddr')  && ($('#serverAddr').textContent = location.host);
      $('#monServer')   && ($('#monServer').textContent  = location.origin);
      $('#monEnv')      && ($('#monEnv').textContent     = data?.env ?? '—');
      $('#monPort')     && ($('#monPort').textContent    = data?.port ?? '—');
      $('#monUptime')   && ($('#monUptime').textContent  = (data?.uptimeSec != null) ? `${Math.floor(data.uptimeSec)}s` : '—');
      const pill = $('#healthPill');
      if (pill) { pill.textContent = 'Health: OK'; }
      UI.log('헬스체크 성공', 'ok');
    } catch (e) {
      const pill = $('#healthPill');
      if (pill) { pill.textContent = 'Health: FAIL'; }
      UI.log('헬스체크 실패: ' + e.message, 'err');
    }
  }

  // ========== 배틀 ==========
  async function createBattle() {
    const mode = $('#selMode')?.value || '1v1';
    try {
      const res = await jfetch(API.battleCreate, { method: 'POST', body: JSON.stringify({ mode }) });
      const id = res?.battleId || res?.id || '';
      if (!id) throw new Error('서버가 battleId를 반환하지 않았습니다.');
      $('#battleId').value = id;
      setLinks();
      $('#battleStatus') && ($('#battleStatus').textContent = '생성됨');
      UI.log(`배틀 생성: ${id} (${mode})`, 'ok');
      tryJoinSocket(); // 채팅 연결 시도
    } catch (e) {
      UI.log('배틀 생성 실패: ' + e.message, 'err');
    }
  }

  async function endBattle() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    try {
      await jfetch(API.battleEnd(id), { method: 'POST' });
      $('#battleStatus') && ($('#battleStatus').textContent = '종료됨');
      UI.log(`배틀 종료: ${id}`, 'ok');
    } catch (e) {
      UI.log('배틀 종료 실패: ' + e.message, 'err');
    }
  }

  async function resetBattle() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    try {
      await jfetch(API.battleReset(id), { method: 'POST' });
      UI.log(`라운드 리셋: ${id}`, 'ok');
    } catch (e) {
      UI.log('리셋 실패: ' + e.message, 'err');
    }
  }

  async function applyMode() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    const mode = $('#selMode')?.value || '1v1';
    try {
      await jfetch(API.battleMode(id), { method: 'POST', body: JSON.stringify({ mode }) });
      UI.log(`모드 적용: ${id} -> ${mode}`, 'ok');
    } catch (e) {
      UI.log('모드 적용 실패: ' + e.message, 'err');
    }
  }

  async function refreshBattle() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    try {
      const res = await jfetch(API.battleStatus(id));
      $('#battleStatus') && ($('#battleStatus').textContent = res?.status || '활성');
      UI.log(`배틀 상태: ${id} -> ${$('#battleStatus')?.textContent || ''}`, 'ok');
    } catch (e) {
      UI.log('배틀 상태 조회 실패: ' + e.message, 'err');
    }
  }

  // ========== 플레이어 ==========
  async function addPlayer() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    const name = $('#playerName')?.value?.trim();
    const team = $('#playerTeam')?.value || 'phoenix';
    if (!name) return UI.log('닉네임을 입력하세요.', 'err');

    try {
      await jfetch(API.players(id), { method: 'POST', body: JSON.stringify({ name, team }) });
      $('#playerName').value = '';
      await refreshPlayers();
      UI.log(`플레이어 추가: ${name} (${team})`, 'ok');
    } catch (e) {
      UI.log('플레이어 추가 실패: ' + e.message, 'err');
    }
  }

  async function refreshPlayers() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return;
    try {
      const res = await jfetch(API.players(id));
      const list = Array.isArray(res?.players) ? res.players : (res ?? []);
      const tbody = $('#playersBody'); if (!tbody) return;
      tbody.innerHTML = '';
      list.forEach((p, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="text-zinc-500">${i + 1}</td>
          <td class="font-medium">${p.name ?? '-'}</td>
          <td><span class="pill">${p.team ?? '-'}</span></td>
          <td>${p.status ?? '—'}</td>
          <td class="text-right"><button class="btn !px-2" data-pid="${p.id ?? p._id ?? i}">제거</button></td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-pid]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.getAttribute('data-pid');
          try {
            await jfetch(API.playerDelete(id, pid), { method: 'DELETE' });
            await refreshPlayers();
            UI.log(`플레이어 제거: ${pid}`, 'ok');
          } catch (e) {
            UI.log('플레이어 제거 실패: ' + e.message, 'err');
          }
        });
      });
    } catch (e) {
      UI.log('참가자 조회 실패: ' + e.message, 'err');
    }
  }

  async function clearPlayers() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    try {
      await jfetch(API.players(id), { method: 'DELETE' });
      await refreshPlayers();
      UI.log('플레이어 전체 제거', 'ok');
    } catch (e) {
      UI.log('전체 제거 실패: ' + e.message, 'err');
    }
  }

  // ========== 아바타 업로드 ==========
  async function uploadAvatar() {
    const id = $('#battleId')?.value?.trim();
    if (!id) return UI.log('배틀 코드가 필요합니다.', 'err');
    const file = $('#avatarFile')?.files?.[0];
    if (!file) return UI.log('파일을 선택하세요.', 'err');
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const res = await fetch(API.avatarUpload(id), { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      $('#avatarUploadResult') && ($('#avatarUploadResult').textContent = '업로드 완료');
      UI.log('아바타 업로드 성공', 'ok');
    } catch (e) {
      $('#avatarUploadResult') && ($('#avatarUploadResult').textContent = '업로드 실패: ' + e.message);
      UI.log('아바타 업로드 실패: ' + e.message, 'err');
    }
  }

  // ========== OTP (글로벌) ==========
  async function makeOTP() {
    // UI에서 type/ttl/maxUses를 받음
    const type    = $('#otpType')?.value || 'spectator';
    const ttl     = parseInt($('#otpTTL')?.value || '0', 10) || undefined;
    const maxUses = parseInt($('#otpMaxUses')?.value || '0', 10) || undefined;

    try {
      const res = await jfetch(API.otpCreate, { method: 'POST', body: JSON.stringify({ type, ttl, maxUses }) });
      $('#otpResult') && ($('#otpResult').textContent = JSON.stringify(res, null, 2));
      await refreshOTPList();
      UI.log(`OTP 생성 성공: ${type}`, 'ok');
    } catch (e) {
      UI.log('OTP 생성 실패: ' + e.message, 'err');
    }
  }

  async function refreshOTPList() {
    try {
      const res = await jfetch(API.otpList);
      const items = Array.isArray(res?.items) ? res.items : (res ?? []);
      const tbody = $('#otpListBody'); if (!tbody) return;
      tbody.innerHTML = '';
      items.forEach(it => {
        const remain = (it.expiresAt ? (it.expiresAt - Date.now()) : it.remainingTtl) ?? 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="pill">${it.type ?? '-'}</span></td>
          <td class="mono">${it.otp ?? it.code ?? '-'}</td>
          <td>${remain > 0 ? Math.floor(remain / 1000) + 's' : '만료됨'}</td>
          <td>${it.maxUses ?? '-'} / ${it.used ?? it.usedCount ?? 0}</td>
          <td class="text-right"><button class="btn !px-2" data-copy="${it.otp ?? it.code ?? ''}">복사</button></td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-copy');
          if (val) UI.copy(val);
        });
      });
    } catch (e) {
      UI.log('OTP 목록 조회 실패: ' + e.message, 'err');
    }
  }

  async function cleanupOTP() {
    try {
      await jfetch(API.otpCleanup, { method: 'POST' });
      await refreshOTPList();
      UI.log('만료 OTP 정리 완료', 'ok');
    } catch (e) {
      UI.log('정리 실패: ' + e.message, 'err');
    }
  }

  // ========== 운영자 채팅(socket.io) & 응원 ==========
  let socket = null;
  function appendChat({ name='시스템', role='system', text='', ts=Date.now(), self=false }) {
    const box = $('#chatBox'); if (!box) return;
    const d = new Date(ts);
    const line = document.createElement('div');
    line.className = self ? 'msg-me' : (role === 'system' ? 'msg-sys' : 'msg-else');
    line.textContent = `[${d.toLocaleTimeString()}] ${name}: ${text}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function tryJoinSocket() {
    const state = $('#sockState');
    if (!window.io) { state && (state.textContent = 'socket.io 없음'); return; }
    const bid = $('#battleId')?.value?.trim() || new URLSearchParams(location.search).get('battle') || '';
    if (!bid) { state && (state.textContent = '배틀코드 필요'); return; }

    const name = $('#adminName')?.value?.trim() || '관리자';
    localStorage.setItem('pyxis_admin_name', name);

    if (!socket) socket = io({ transports: ['websocket','polling'] });

    socket.off();
    socket.on('connect', () => { state && (state.textContent = '연결됨'); appendChat({ text:'채팅 서버 연결', role:'system' }); socket.emit('join', { role:'admin', battleId: bid, name }); });
    socket.on('disconnect', () => { state && (state.textContent = '해제됨'); appendChat({ text:'연결 해제', role:'system' }); });
    socket.on('connect_error', (e) => { state && (state.textContent = '오류'); appendChat({ text:'연결 오류: '+e.message, role:'system' }); });

    // 서버에서 내려주는 채팅 브로드캐스트 이벤트명 가정: 'chat'
    socket.on('chat', (msg) => {
      if (!msg || (msg.battleId && msg.battleId !== bid)) return;
      appendChat({ name: msg.name || '익명', role: msg.role || 'user', text: msg.text || '', ts: msg.ts || Date.now(), self:false });
    });
  }

  function sendChat(text) {
    if (!text) return;
    const bid = $('#battleId')?.value?.trim();
    if (!socket || socket.disconnected) return appendChat({ text:'연결되지 않음', role:'system' });
    if (!bid) return appendChat({ text:'배틀코드가 필요합니다.', role:'system' });
    const name = $('#adminName')?.value?.trim() || '관리자';
    const payload = { battleId: bid, role:'admin', name, text: text.slice(0, 500), ts: Date.now() };
    socket.emit('chat', payload);
    appendChat({ ...payload, self:true });
  }

  // ========== 이벤트 바인딩 ==========
  function bindEvents() {
    // 링크/복사
    $('#baseUrl')?.addEventListener('input', setLinks);
    $('#battleId')?.addEventListener('input', () => { setLinks(); tryJoinSocket(); });
    $('#goAdmin')?.addEventListener('click', () => { const {admin} = setLinks(); window.open(admin, '_blank'); });
    $('#goPlay')?.addEventListener('click', () => { const {play}  = setLinks(); window.open(play, '_blank'); });
    $('#goSpectator')?.addEventListener('click', () => { const {spec} = setLinks(); window.open(spec, '_blank'); });
    $('#copyAllLinks')?.addEventListener('click', () => {
      const {admin, play, spec} = setLinks();
      UI.copy(`Admin: ${admin}\nPlayer: ${play}\nSpectator: ${spec}`);
    });

    // 헬스
    $('#btnPing')?.addEventListener('click', refreshHealth);
    $('#btnOpenMetrics')?.addEventListener('click', () => window.open('/api/health','_blank'));

    // 배틀
    $('#btnBattleNew')?.addEventListener('click', createBattle);
    $('#btnBattleEnd')?.addEventListener('click', endBattle);
    $('#btnBattleReset')?.addEventListener('click', resetBattle);
    $('#btnApplyMode')?.addEventListener('click', applyMode);
    $('#btnRefreshBattle')?.addEventListener('click', refreshBattle);

    // 플레이어
    $('#btnAddPlayer')?.addEventListener('click', addPlayer);
    $('#btnRefreshPlayers')?.addEventListener('click', refreshPlayers);
    $('#btnClearPlayers')?.addEventListener('click', clearPlayers);

    // 아바타
    $('#btnUploadAvatar')?.addEventListener('click', uploadAvatar);

    // OTP
    $('#btnMakeOTP')?.addEventListener('click', makeOTP);
    $('#btnCopyOTP')?.addEventListener('click', () => {
      const txt = $('#otpResult')?.textContent?.trim();
      if (!txt) return UI.log('복사할 OTP 결과가 없습니다.','err');
      try { const obj = JSON.parse(txt); UI.copy(obj.otp || obj.code || txt); }
      catch { UI.copy(txt); }
    });
    $('#btnRefreshOTPs')?.addEventListener('click', refreshOTPList);
    $('#btnRevokeExpired')?.addEventListener('click', cleanupOTP);

    // 로그
    $('#btnClearLog')?.addEventListener('click', () => { UI.logArea.innerHTML = ''; });

    // 채팅
    $('#btnSendChat')?.addEventListener('click', () => {
      const t = $('#chatInput')?.value?.trim();
      if (!t) return;
      $('#chatInput').value = '';
      sendChat(t);
    });
    $('#chatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#btnSendChat').click(); }
    });
    $('#btnReconnect')?.addEventListener('click', tryJoinSocket);
    $('#btnSaveName')?.addEventListener('click', () => {
      localStorage.setItem('pyxis_admin_name', $('#adminName')?.value?.trim() || '관리자');
      appendChat({ text: '이름 저장됨', role: 'system' });
    });

    // 응원(6개 고정)
    document.querySelectorAll('.send-cheer')?.forEach(btn => {
      btn.addEventListener('click', () => sendChat(btn.textContent));
    });
  }

  // ========== 초기화 ==========
  function initFromQuery() {
    const params = new URLSearchParams(location.search);
    const qBattle = params.get('battle');
    if (qBattle && $('#battleId')) {
      $('#battleId').value = qBattle;
    }
  }

  function initPersist() {
    const savedName = localStorage.getItem('pyxis_admin_name');
    if (savedName && $('#adminName')) $('#adminName').value = savedName;
  }

  window.addEventListener('DOMContentLoaded', () => {
    UI.init();
    initFromQuery();
    initPersist();
    setLinks();
    refreshHealth();
    bindEvents();
    if ($('#battleId')?.value) { refreshBattle(); refreshPlayers(); }
    tryJoinSocket();
    UI.log('Admin UI 초기화 완료', 'ok');
  });
})();
