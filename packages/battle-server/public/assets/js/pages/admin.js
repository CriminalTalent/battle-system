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

  // ========== API ==========
  const API = {
    health:       '/api/health',
    battleCreate: '/api/battles',
    battleGet:    (id) => `/api/battles/${id}`,
    battleStart:  (id) => `/api/battles/${id}/start`,
    battlePause:  (id) => `/api/battles/${id}/pause`,
    battleResume: (id) => `/api/battles/${id}/resume`,
    battleEnd:    (id) => `/api/battles/${id}/end`,
    battleReset:  (id) => `/api/battles/${id}/reset`,
    battleMode:   (id) => `/api/battles/${id}/mode`,
    players:      (id) => `/api/battles/${id}/players`,
    playerDelete: (id, pid) => `/api/battles/${id}/players/${pid}`,
    avatarUpload: (id) => `/api/battles/${id}/avatar`,
    otpCreate:    '/api/admin/otp',
    otpList:      '/api/admin/otp/list',
    otpCleanup:   '/api/admin/otp/cleanup',
  };

  // ========== 링크 생성 ==========
  function setLinks() {
    const base = $('#baseUrl')?.value?.replace(/\/+$/, '') || location.origin;
    const bid  = $('#battleId')?.value?.trim() || '';
    const q    = bid ? `?battle=${encodeURIComponent(bid)}` : '';
    const admin = `${base}/admin${q}`;
    const play  = `${base}/player${q}`; // ← 수정: /play → /player
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
      $('#serverAddr')  && ($('#serverAddr').textContent = data?.addr ?? location.origin);
      $('#socketStatus')&& ($('#socketStatus').textContent = data?.socket ?? 'n/a');
    } catch (e) {
      UI.log('헬스 체크 실패: ' + e.message, 'err');
    }
  }

  // ========== 소켓 ==========
  let socket = null;
  function tryJoinSocket() {
    if (!window.io) return;
    if (socket) { try { socket.disconnect(); } catch(e){} socket = null; }
    const bid = $('#battleId')?.value?.trim();
    if (!bid) return;

    // eslint-disable-next-line no-undef
    socket = io('/', { transports:['websocket','polling'], auth:{ role:'admin', battleId: bid } });
    socket.on('connect', () => UI.log('소켓 연결됨','ok'));
    socket.on('disconnect', (r) => UI.log(`소켓 해제: ${r}`,'err'));

    socket.on('battle:update', (s) => renderState(s));
    socket.on('battleUpdate',  (s) => renderState(s));
    socket.on('state:full',    (s) => renderState(s));
    socket.on('state:delta',   ()  => refreshState());
    socket.on('log',           (m) => UI.log(typeof m === 'string' ? m : (m?.text || m?.msg || '')));
  }

  // ========== 상태 렌더 ==========
  function renderState(state){
    // 기존 UI 구성에 맞춰 필요한 갱신만 수행 (디자인/레이아웃 미변경)
  }

  async function refreshState(){
    const bid = $('#battleId')?.value?.trim();
    if (!bid) return;
    try {
      const s = await jfetch(API.battleGet(bid));
      renderState(s);
    } catch(e){
      UI.log('상태 조회 실패: '+e.message,'err');
    }
  }

  // ========== 배틀 컨트롤 ==========
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
      tryJoinSocket();
    } catch (e) {
      UI.log('배틀 생성 실패: ' + e.message, 'err');
    }
  }
  async function startBattle() { const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleStart(id), { method:'POST' }); $('#battleStatus')&&($('#battleStatus').textContent='진행중'); UI.log('배틀 시작','ok'); }catch(e){ UI.log('배틀 시작 실패: '+e.message,'err'); } }
  async function pauseBattle() { const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battlePause(id), { method:'POST' }); UI.log('일시정지','ok'); }catch(e){ UI.log('일시정지 실패: '+e.message,'err'); } }
  async function resumeBattle(){ const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleResume(id), { method:'POST' }); UI.log('재개','ok'); }catch(e){ UI.log('재개 실패: '+e.message,'err'); } }
  async function endBattle()   { const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleEnd(id),   { method:'POST' }); $('#battleStatus')&&($('#battleStatus').textContent='종료'); UI.log('종료','ok'); }catch(e){ UI.log('종료 실패: '+e.message,'err'); } }
  async function resetBattle() { const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleReset(id), { method:'POST' }); UI.log('리셋 완료','ok'); refreshState(); }catch(e){ UI.log('리셋 실패: '+e.message,'err'); } }

  // ========== 아바타 업로드 ==========
  async function uploadAvatar() {
    const id = $('#battleId')?.value?.trim();
    const file = $('#pAvatarFile')?.files?.[0] || null;
    const url  = $('#pAvatarUrl')?.value?.trim() || '';
    if (!id)  return UI.log('배틀 ID가 비어있습니다','err');
    if (!file && !url) return UI.log('파일 또는 URL을 입력하세요','err');

    const fd = new FormData();
    if (file) fd.append('avatar', file);
    if (url)  fd.append('avatarUrl', url);

    try {
      await fetch(API.avatarUpload(id), { method: 'POST', body: fd });
      UI.log('아바타 업로드 요청 완료','ok');
      refreshState();
    } catch (e) {
      UI.log('아바타 업로드 실패: ' + e.message, 'err');
    }
  }

  // ========== 이벤트 바인딩 ==========
  function bindEvents() {
    $('#baseUrl')?.addEventListener('input', setLinks);
    $('#battleId')?.addEventListener('input', () => { setLinks(); tryJoinSocket(); });

    $('#goAdmin')?.addEventListener('click', () => { const {admin} = setLinks(); window.open(admin, '_blank'); });
    $('#goPlay')?.addEventListener('click',  () => { const {play}  = setLinks(); window.open(play,  '_blank'); });
    $('#goSpectator')?.addEventListener('click', () => { const {spec} = setLinks(); window.open(spec, '_blank'); });

    $('#btnCreate')?.addEventListener('click', createBattle);
    $('#btnStart') ?.addEventListener('click', startBattle);
    $('#btnPause') ?.addEventListener('click', pauseBattle);
    $('#btnResume')?.addEventListener('click', resumeBattle);
    $('#btnEnd')   ?.addEventListener('click', endBattle);
    $('#btnReset') ?.addEventListener('click', resetBattle);

    $('#btnAvatarUpload')?.addEventListener('click', uploadAvatar);

    $('#btnCopyAdmin')    ?.addEventListener('click', () => { const {admin} = setLinks(); UI.copy(admin); });
    $('#btnCopyPlayer')   ?.addEventListener('click', () => { const {play}  = setLinks(); UI.copy(play);  });
    $('#btnCopySpectator')?.addEventListener('click', () => { const {spec}  = setLinks(); UI.copy(spec);  });

    UI.init();
  }

  // ========== 부트 ==========
  window.addEventListener('DOMContentLoaded', () => {
    setLinks();
    bindEvents();
    refreshHealth();
    tryJoinSocket();
  });
})();
