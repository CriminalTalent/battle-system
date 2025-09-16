
/* admin-links-hotfix.js
 * - Robust link/OTP population for 관리자 페이지
 * - Keeps design/IDs intact, only augments behavior
 */
(function(){
  const $ = s => document.querySelector(s);
  const escapeHtml = (t)=>String(t??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  function addLog(msg, cls=''){ try{ const logs = $('#logs'); if(!logs) return; const el=document.createElement('div'); el.className='log '+(cls||''); el.textContent = msg; logs.appendChild(el); logs.scrollTop=logs.scrollHeight; }catch(_){} }
  function copyText(text){ try{ navigator.clipboard?.writeText(text); }catch(_){} }

  function resolveBattleId(){
    // 우선 전역 상태 or URL 파라미터에서 획득
    const sp = new URL(window.location.href).searchParams;
    return (window.battleId || sp.get('battle') || '').trim();
  }

  async function postJson(url){
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  function pick(val, ...keys){
    for(const k of keys){
      const v = k.split('.').reduce((acc, cur)=> (acc && acc[cur]!==undefined) ? acc[cur] : undefined, val);
      if(v!==undefined && v!==null) return v;
    }
    return undefined;
  }

  function unifyPlayers(payload){
    const list = Array.isArray(payload?.players) ? payload.players : (
      Array.isArray(payload?.playerLinks) ? payload.playerLinks.map(pl=>({ 
        playerId: pl.playerId || pl.id, name: pl.playerName || pl.name, team: pl.team, token: pl.otp, url: pl.url 
      })) : []
    );
    return list;
  }

  async function handleGenerate(){
    const id = resolveBattleId();
    if(!id){ addLog('전투 ID가 없습니다(?battle=...)', 'warn'); return; }

    let data;
    try {
      data = await postJson(`/api/admin/battles/${id}/links`);
    } catch(_) {
      data = await postJson(`/api/battles/${id}/links`);
    }
    console.log('[LINKS_RAW]', data);

    const spectatorOtp = $('#spectatorOtp');
    const spectatorUrl = $('#spectatorUrl');
    const playerLinks = $('#playerLinks');

    // spectator
    const otp = pick(data, 'spectator.otp','spectator.code','spectator.password','spectatorOtp','otp') || '';
    const url = pick(data, 'spectator.url','spectatorUrl','url') || '';
    if(spectatorOtp) spectatorOtp.value = otp;
    if(spectatorUrl) spectatorUrl.value = url;

    // players
    if(playerLinks){ playerLinks.innerHTML=''; }
    const base = window.location.origin;
    const list = unifyPlayers(data);
    list.forEach(p=>{
      const name = p.name || '';
      const team = p.team || '';
      const link = p.url || `${base}/player.html?battle=${encodeURIComponent(id)}&playerId=${encodeURIComponent(p.playerId||'')}&name=${encodeURIComponent(name)}&team=${team}`;
      const row = document.createElement('div');
      row.className = 'field';
      row.innerHTML = `
        <div class="row" style="justify-content:space-between;gap:8px">
          <div><strong>${escapeHtml(name)}</strong> <span class="pill">${escapeHtml(team)}</span></div>
          <button class="btn ghost" data-copy="${escapeHtml(link)}">URL복사</button>
        </div>
        <input type="text" readonly value="${escapeHtml(link)}">
      `;
      playerLinks?.appendChild(row);
    });

    addLog('링크/비밀번호 생성 완료');
    if(otp) addLog('관전자 비밀번호 설정됨: '+otp);
    if(url) addLog('관전자 URL 설정됨: '+url);
  }

  function install(){
    const btn = $('#btnGenLinks');
    if(!btn) return;
    // 기존 핸들러가 있어도 같이 동작해도 무방. 다만 중복 요청 방지.
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
