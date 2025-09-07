// admin (2).js
(() => {
  // ===== Utils =====
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const qp = new URLSearchParams(location.search);

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
    const res = await fetch(url, { headers: { 'Content-Type':'application/json', ...(opt.headers||{}) }, ...opt });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(`${res.status} ${body?.message || body?.error || res.statusText}`);
    return body ?? {};
  }

  // ===== API =====
  const API = {
    health:       '/api/health',
    battleCreate: '/api/battles',
    battleGet:    (id) => `/api/battles/${id}`,
    players:      (id) => `/api/battles/${id}/players`,
    otpCreate:    '/api/admin/otp',
    otpList:      '/api/admin/otp/list',
    otpCleanup:   '/api/admin/otp/cleanup',
    battleStart:  (id) => `/api/battles/${id}/start`,
    battlePause:  (id) => `/api/battles/${id}/pause`,
    battleResume: (id) => `/api/battles/${id}/resume`,
    battleEnd:    (id) => `/api/battles/${id}/end`,
    battleReset:  (id) => `/api/battles/${id}/reset`,
  };

  // ===== 링크 생성 (/play, /watch 기준) =====
  function setLinks() {
    const base = $('#baseUrl')?.value?.replace(/\/+$/, '') || location.origin;
    const bid  = $('#battleId')?.value?.trim() || '';
    const q    = bid ? `?battle=${encodeURIComponent(bid)}` : '';
    const admin = `${base}/admin${q}`;
    const play  = `${base}/play${q}`;     // README 기준: /play (플레이어)
    const spec  = `${base}/watch${q}`;    // README 기준: /watch (관전자)
    if ($('#linkAdmin'))     $('#linkAdmin').textContent = admin;
    if ($('#linkPlayer'))    $('#linkPlayer').textContent = play;
    if ($('#linkSpectator')) $('#linkSpectator').textContent = spec;
    return { admin, play, spec, bid, base };
  }

  // 플레이어별 OTP 포함 링크 만들기 (선택)
  function makePlayerLink(base, battleId, name, otp) {
    const qp = new URLSearchParams({ battle: battleId });
    if (otp)  qp.set('otp', otp);
    if (name) qp.set('name', name);
    return `${base}/play?${qp.toString()}`;
  }

  function makeSpectatorLink(base, battleId, otp) {
    const qp = new URLSearchParams({ battle: battleId });
    if (otp) qp.set('otp', otp);
    return `${base}/watch?${qp.toString()}`;
  }

  // ===== Health =====
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

  // ===== State render (레이아웃/디자인 미변경) =====
  function renderState(_state) {}

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

  // ===== 소켓 =====
  let socket = null;
  function tryJoinSocket() {
    if (!window.io) return;
    if (socket) { try { socket.disconnect(); } catch(e){} socket = null; }
    const bid = $('#battleId')?.value?.trim();
    if (!bid) return;
    // eslint-disable-next-line no-undef
    socket = io('/', { transports:['websocket','polling'], auth:{ role:'admin', battleId: bid } });
    socket.on('connect',   () => UI.log('소켓 연결됨','ok'));
    socket.on('disconnect',(r) => UI.log(`소켓 해제: ${r}`,'err'));
    socket.on('battle:update', (s) => renderState(s));
    socket.on('battleUpdate',  (s) => renderState(s));
    socket.on('state:full',    (s) => renderState(s));
    socket.on('state:delta',   ()  => refreshState());
    socket.on('log',           (m) => UI.log(typeof m === 'string' ? m : (m?.text || m?.msg || '')));
  }

  // ===== 전투 만들기/제어 =====
  async function createBattle() {
    const mode = $('#selMode')?.value || '1v1';
    try {
      const res = await jfetch(API.battleCreate, { method: 'POST', body: JSON.stringify({ mode }) });
      const id = res?.battleId || res?.id || '';
      if (!id) throw new Error('서버가 battleId를 반환하지 않았습니다.');
      $('#battleId').value = id;                // 생성 직후 자동 채움
      setLinks();                               // 링크 즉시 갱신
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

  // ===== OTP/링크 관련 (선택) =====
  async function createPlayerOtpAndLink() {
    const bid  = $('#battleId')?.value?.trim();
    const base = $('#baseUrl')?.value?.replace(/\/+$/, '') || location.origin;
    const name = $('#playerNameForLink')?.value?.trim() || ''; // 관리자 UI에 입력칸이 있다고 가정
    if (!bid)  return UI.log('배틀 ID가 비어있습니다','err');
    if (!name) return UI.log('플레이어 이름을 입력하세요','err');
    try {
      // 서버에서 OTP 발급 (엔드포인트가 다르면 맞춰주세요)
      const res = await jfetch(API.otpCreate, { method: 'POST', body: JSON.stringify({ battleId: bid, name }) });
      const otp = res?.otp || res?.token || '';
      const link = makePlayerLink(base, bid, name, otp);
      $('#linkPlayer') && ($('#linkPlayer').textContent = link);
      UI.copy(link);
      UI.log(`플레이어 링크 생성: ${name}`, 'ok');
    } catch (e) {
      UI.log('플레이어 OTP/링크 생성 실패: ' + e.message, 'err');
    }
  }

  function bindEvents() {
    // URL 쿼리에 battle= 가 있으면 입력 자동 채움
    const qBattle = qp.get('battle');
    if (qBattle && $('#battleId')) $('#battleId').value = qBattle;

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

    $('#btnCreatePlayerLink')?.addEventListener('click', createPlayerOtpAndLink); // 선택 기능
    $('#btnCopyAdmin')    ?.addEventListener('click', () => { const {admin} = setLinks(); UI.copy(admin); });
    $('#btnCopyPlayer')   ?.addEventListener('click', () => { const {play}  = setLinks(); UI.copy(play);  });
    $('#btnCopySpectator')?.addEventListener('click', () => { const {spec}  = setLinks(); UI.copy(spec);  });

    UI.init();
  }

  window.addEventListener('DOMContentLoaded', () => {
    setLinks();
    bindEvents();
    refreshHealth();
    tryJoinSocket();
  });
})();
