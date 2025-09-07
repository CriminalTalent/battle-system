// admin (2).js
(() => {
  // ===== Utilities =====
  const $  = (s, r=document) => r.querySelector(s);
  const qp = new URLSearchParams(location.search);

  const UI = {
    logArea: null,
    init() { this.logArea = $('#logArea'); },
    log(msg, cls='') {
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

  async function jfetch(url, opt={}) {
    const res = await fetch(url, { headers:{'Content-Type':'application/json', ...(opt.headers||{})}, ...opt });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(`${res.status} ${body?.message || body?.error || res.statusText}`);
    return body ?? {};
  }

  // ===== API endpoints (REST) =====
  const API = {
    health:       '/api/health',
    battleCreate: '/api/battles',
    battleGet:    (id) => `/api/battles/${id}`,
    battleStart:  (id) => `/api/battles/${id}/start`,
    battlePause:  (id) => `/api/battles/${id}/pause`,
    battleResume: (id) => `/api/battles/${id}/resume`,
    battleEnd:    (id) => `/api/battles/${id}/end`,
    battleReset:  (id) => `/api/battles/${id}/reset`,

    // 필요 시 관리자용 OTP 발급/조회 (서버 구현과 맞춰 사용)
    otpCreate:    '/api/admin/otp',
    otpList:      '/api/admin/otp/list',
    otpCleanup:   '/api/admin/otp/cleanup',
  };

  // ===== Link builders =====
  function setLinks() {
    const base = $('#baseUrl')?.value?.replace(/\/+$/,'') || location.origin;
    const bid  = $('#battleId')?.value?.trim() || '';
    const q    = bid ? `?battle=${encodeURIComponent(bid)}` : '';

    // 표준 경로 가정: /player, /spectator (라우팅은 프로젝트 환경에 맞게 서빙)
    const admin = `${base}/admin${q}`;
    const play  = `${base}/player${q}`;
    const spec  = `${base}/spectator${q}`;

    if ($('#linkAdmin'))     $('#linkAdmin').textContent = admin;
    if ($('#linkPlayer'))    $('#linkPlayer').textContent = play;
    if ($('#linkSpectator')) $('#linkSpectator').textContent = spec;

    return { base, bid, admin, play, spec };
  }

  // per-player deep link: /player?battle=..&playerId=..&otp=..
  function makePlayerDeepLink(base, battleId, playerId, playerToken) {
    const p = new URLSearchParams({ battle: battleId, playerId });
    if (playerToken) p.set('otp', playerToken);
    return `${base}/player?${p.toString()}`;
  }

  // spectator deep link: /spectator?battle=..&otp=..&name=..
  function makeSpectatorDeepLink(base, battleId, spectatorOtp, nickname='') {
    const p = new URLSearchParams({ battle: battleId });
    if (spectatorOtp) p.set('otp', spectatorOtp);
    if (nickname)     p.set('name', nickname);
    return `${base}/spectator?${p.toString()}`;
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

  // ===== Socket (선택) — 필요 시 관리자 소켓 합류 등 =====
  let socket = null;
  function ensureSocket() {
    if (socket) return socket;
    if (!window.io) return null;
    // eslint-disable-next-line no-undef
    socket = io('/', { transports:['websocket','polling'] });
    return socket;
  }

  // ===== Battle lifecycle =====
  async function createBattle() {
    const mode = $('#selMode')?.value || '2v2';
    try {
      const res = await jfetch(API.battleCreate, { method:'POST', body: JSON.stringify({ mode }) });
      const id = res?.battleId || res?.id || '';
      if (!id) throw new Error('서버가 battleId를 반환하지 않았습니다.');
      // 생성 직후 자동 채움 + 링크 갱신 + 복사까지
      $('#battleId').value = id;
      const links = setLinks();
      UI.copy(links.admin);
      $('#battleStatus') && ($('#battleStatus').textContent = '생성됨');
      UI.log(`배틀 생성: ${id} (${mode})`, 'ok');
    } catch (e) {
      UI.log('배틀 생성 실패: ' + e.message, 'err');
    }
  }

  async function startBattle(){ const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleStart(id),{method:'POST'}); $('#battleStatus')&&($('#battleStatus').textContent='진행중'); UI.log('배틀 시작','ok'); }catch(e){ UI.log('배틀 시작 실패: '+e.message,'err'); } }
  async function pauseBattle(){ const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battlePause(id),{method:'POST'}); UI.log('일시정지','ok'); }catch(e){ UI.log('일시정지 실패: '+e.message,'err'); } }
  async function resumeBattle(){const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleResume(id),{method:'POST'}); UI.log('재개','ok'); }catch(e){ UI.log('재개 실패: '+e.message,'err'); } }
  async function endBattle(){   const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleEnd(id),   {method:'POST'}); $('#battleStatus')&&($('#battleStatus').textContent='종료'); UI.log('종료','ok'); }catch(e){ UI.log('종료 실패: '+e.message,'err'); } }
  async function resetBattle(){ const id=$('#battleId')?.value?.trim(); if(!id) return UI.log('배틀 ID가 비어있습니다','err'); try{ await jfetch(API.battleReset(id), {method:'POST'}); UI.log('리셋 완료','ok'); }catch(e){ UI.log('리셋 실패: '+e.message,'err'); } }

  // ===== Links UI actions =====
  function bindEvents() {
    // URL의 ?battle= 가 있으면 자동 채움
    const qBattle = qp.get('battle');
    if (qBattle && $('#battleId')) $('#battleId').value = qBattle;

    $('#baseUrl')?.addEventListener('input', setLinks);
    $('#battleId')?.addEventListener('input', setLinks);

    $('#btnCreate')?.addEventListener('click', createBattle);
    $('#btnStart') ?.addEventListener('click', startBattle);
    $('#btnPause') ?.addEventListener('click', pauseBattle);
    $('#btnResume')?.addEventListener('click', resumeBattle);
    $('#btnEnd')   ?.addEventListener('click', endBattle);
    $('#btnReset') ?.addEventListener('click', resetBattle);

    $('#goAdmin')     ?.addEventListener('click', ()=>{ const {admin}=setLinks(); window.open(admin,'_blank'); });
    $('#goPlay')      ?.addEventListener('click', ()=>{ const {play} =setLinks(); window.open(play ,'_blank'); });
    $('#goSpectator') ?.addEventListener('click', ()=>{ const {spec} =setLinks(); window.open(spec ,'_blank'); });

    $('#btnCopyAdmin')    ?.addEventListener('click', ()=>{ const {admin}=setLinks(); UI.copy(admin); });
    $('#btnCopyPlayer')   ?.addEventListener('click', ()=>{ const {play} =setLinks(); UI.copy(play ); });
    $('#btnCopySpectator')?.addEventListener('click', ()=>{ const {spec} =setLinks(); UI.copy(spec ); });

    // 선택: 개별 플레이어/관전자 딥링크 만들기 (관리자 UI에 입력칸이 있다면)
    $('#btnBuildPlayerLink')?.addEventListener('click', ()=>{
      const { base, bid } = setLinks();
      const playerId = $('#playerIdForLink')?.value?.trim() || '';
      const playerToken = $('#playerTokenForLink')?.value?.trim() || '';
      if (!bid)       return UI.log('배틀 ID를 먼저 설정하세요','err');
      if (!playerId)  return UI.log('playerId를 입력하세요','err');
      if (!playerToken) return UI.log('플레이어 토큰(otp)을 입력하세요','err'); // 서버는 개별 플레이어 토큰 필요 :contentReference[oaicite:4]{index=4}
      const link = makePlayerDeepLink(base, bid, playerId, playerToken);
      $('#linkPlayer') && ($('#linkPlayer').textContent = link);
      UI.copy(link);
      UI.log('플레이어 링크 생성 완료','ok');
    });

    $('#btnBuildSpectatorLink')?.addEventListener('click', ()=>{
      const { base, bid } = setLinks();
      const otp  = $('#spectatorOtpForLink')?.value?.trim() || '';
      const name = $('#spectatorNameForLink')?.value?.trim() || '';
      if (!bid) return UI.log('배틀 ID를 먼저 설정하세요','err');
      if (!otp) return UI.log('관전자 OTP를 입력하세요','err'); // 관전자도 OTP 필수 :contentReference[oaicite:5]{index=5}
      const link = makeSpectatorDeepLink(base, bid, otp, name);
      $('#linkSpectator') && ($('#linkSpectator').textContent = link);
      UI.copy(link);
      UI.log('관전자 링크 생성 완료','ok');
    });
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    setLinks();
    bindEvents();
    UI.init();
    refreshHealth();
  });
})();
