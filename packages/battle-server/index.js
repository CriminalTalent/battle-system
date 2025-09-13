// packages/battle-server/public/assets/js/admin.js
// 플레이어 링크 생성 함수 수정

async function onGeneratePlayerLinks(){
  if(!battleId){ toast('전투 생성 후 이용하세요'); return; }
  
  try{
    let res = await fetch(`/api/admin/battles/${battleId}/links`, { 
      method:'POST', 
      credentials:'include' 
    });
    
    if(!res.ok){ 
      res = await fetch(`/api/battles/${battleId}/links`, { 
        method:'POST', 
        credentials:'include' 
      }); 
    }
    
    if(!res.ok) throw new Error();
    
    const data = await res.json();
    const links = data?.playerLinks || data?.links || [];

    els.playerLinks.innerHTML = '';
    
    links.forEach((link, i) => {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '38px 1fr 72px';
      row.style.gap = '6px';
      row.style.marginBottom = '4px';
      
      // 플레이어 정보 표시 개선
      const playerInfo = `${link.playerName || `플레이어${i+1}`} (${link.team}팀)`;
      
      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;">
          ${i+1}
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:12px;color:var(--text-muted);">${playerInfo}</div>
          <input type="text" class="mono" value="${link.url || ''}" readonly style="font-size:11px;"/>
        </div>
        <button class="btn" style="padding:4px 8px;font-size:12px;">복사</button>
      `;
      
      const input = row.querySelector('input');
      const copyBtn = row.querySelector('button');
      
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          toast(`${playerInfo} 링크가 복사되었습니다`);
          
          // 복사 완료 시각적 피드백
          copyBtn.textContent = '완료';
          copyBtn.style.background = 'var(--success)';
          setTimeout(() => {
            copyBtn.textContent = '복사';
            copyBtn.style.background = '';
          }, 1500);
        } catch {
          toast('복사에 실패했습니다', 'error');
        }
      });
      
      els.playerLinks.appendChild(row);
    });
    
    toast('참가자 링크가 생성되었습니다');
  } catch(_) {
    alert('링크 생성 실패');
  }
}

// 서버 API 수정도 필요합니다 (index.js에서)
// 플레이어 링크 URL 생성 부분을 다음과 같이 수정:

/*
기존:
const playerUrl = `${base}/player?battle=${battleId}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;

수정:
const playerUrl = `${base}/player.html?battle=${battleId}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;
*/

// 또는 password 파라미터도 추가:
/*
const playerUrl = `${base}/player.html?battle=${battleId}&password=${tok}&token=${tok}&playerId=${player.id}&name=${encodeURIComponent(player.name)}&team=${player.team}`;
*/
