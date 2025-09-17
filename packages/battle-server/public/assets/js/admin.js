/* admin-links-hotfix.js
 * - Robust link/OTP population for 관리자 페이지
 * - Keeps design/IDs intact, only augments behavior
 */
(function(){
  const $ = s => document.querySelector(s);
  const esc = (t)=>String(t??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  function addLog(msg, cls=''){ try{ const logs = $('#logs'); if(!logs) return; const el=document.createElement('div'); el.className='log '+(cls||''); el.textContent = msg; logs.appendChild(el); logs.scrollTop=logs.scrollHeight; }catch(_){} }
  function copyText(text){ try{ navigator.clipboard?.writeText(text); }catch(_){} }

  function resolveBattleId(){
    const sp = new URL(window.location.href).searchParams;
    return (window.battleId || sp.get('battle') || '').trim();
  }

  async function postJson(url, body = {}){
    const res = await fetch(url, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        // 서버가 절대 URL을 조합할 수 있게 힌트 (있어도/없어도 동작)
        'x-base-url': window.location.origin
      },
      body: JSON.stringify(body)
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  function pick(val, ...paths){
    for(const p of paths){
      const v = p.split('.').reduce((acc, k)=> (acc && acc[k]!==undefined) ? acc[k] : undefined, val);
      if(v!==undefined && v!==null) return v;
    }
    return undefined;
  }

  function absolutize(url){
    if(!url) return '';
    try{
      // 이미 절대경로면 그대로, 아니면 origin 기준으로 변환
      return new URL(url, window.location.origin).toString();
    }catch(_){ return String(url); }
  }

  function unifyPlayers(payload){
    // players 또는 playerLinks 모두 수용 + token(otp/token) 통합
    if (Array.isArray(payload?.players)) {
      return payload.players.map(p=>({
        playerId: p.playerId || p.id,
        name    : p.playerName || p.name,
        team    : p.team,
        token   : p.otp || p.token || '',
        url     : p.url ? absolutize(p.url) : ''
      }));
    }
    if (Array.isArray(payload?.playerLinks)) {
      return payload.playerLinks.map(pl=>({
        playerId: pl.playerId || pl.id,
        name    : pl.playerName || pl.name,
        team    : pl.team,
        token   : pl.otp || pl.token || '',
        url     : pl.url ? absolutize(pl.url) : ''
      }));
    }
    return [];
  }

  async function handleGenerate(){
    const id = resolveBattleId();
    if(!id){ addLog('전투 ID가 없습니다(?battle=...)', 'warn'); return; }

    let data;
    try {
      data = await postJson(`/api/admin/battles/${id}/links`, {});
    } catch(_) {
      data = await postJson(`/api/battles/${id}/links`, {});
    }
    console.log('[LINKS_RAW]', data);

    const spectatorOtpEl = $('#spectatorOtp');
    const spectatorUrlEl = $('#spectatorUrl');
    const playerLinksEl  = $('#playerLinks');

    // spectator
    const otpRaw = pick(data, 'spectator.otp','spectator.code','spectator.password','spectatorOtp','otp') || '';
    let   urlRaw = pick(data, 'spectator.url','spectatorUrl','url') || '';
    let   otp = String(otpRaw||'').trim();
    let   surl = String(urlRaw||'').trim();

    if(!surl && otp){
      // 폴백: otp만 내려오면 URL 합성
      surl = `${window.location.origin}/spectator?battle=${encodeURIComponent(id)}&otp=${encodeURIComponent(otp)}`;
      addLog('관전자 URL(폴백) 생성됨');
    }
    if(spectatorOtpEl) spectatorOtpEl.value = otp;
    if(spectatorUrlEl) spectatorUrlEl.value = surl;

    // players
    if(playerLinksEl){ playerLinksEl.innerHTML=''; }
    const base = window.location.origin;
    const list = unifyPlayers(data);

    list.forEach(p=>{
      const name  = p.name || '';
      const team  = p.team || '';
      const token = p.token || '';
      // 서버가 완성 URL을 주면 사용, 아니면 폴백 조합 (token 포함!)
      const link  = p.url && p.url.length
        ? p.url
        : `${base}/player?battle=${encodeURIComponent(id)}&playerId=${encodeURIComponent(p.playerId||'')}&name=${encodeURIComponent(name)}&team=${encodeURIComponent(team)}&token=${encodeURIComponent(token)}`;

      const row = document.createElement('div');
      row.className = 'field';
      row.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
          <div>
            <strong>${esc(name)}</strong>
            <span style="background:var(--gold);color:#000;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:700">${esc(team)}</span>
          </div>
          <button class="btn ghost" data-copy="${esc(link)}">URL복사</button>
        </div>
        <input type="text" readonly value="${esc(link)}">
      `;
      playerLinksEl?.appendChild(row);
    });

    addLog('링크/비밀번호 생성 완료');
    if(otp) addLog('관전자 비밀번호 설정됨: '+otp);
    if(surl) addLog('관전자 URL 설정됨: '+surl);
  }

  function install(){
    const btn = $('#btnGenLinks');
    if(!btn) return;
    btn.addEventListener('click', (ev)=>{
      ev.stopImmediatePropagation?.();
      handleGenerate();
    });
    document.addEventListener('click', (e)=>{
      const t = e.target;
      if(t && t.matches('[data-copy]')){
        copyText(t.getAttribute('data-copy')||'');
        addLog('복사됨');
      }
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', install);
  }else{
    install();
  }
})();
