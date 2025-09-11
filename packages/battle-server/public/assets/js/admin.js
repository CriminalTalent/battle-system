// 1) 소켓 리스너: 서버가 별도 이벤트로 성공을 알려주는 경우 대비
function bindSocketCreateHooks() {
  // 서버가 별도 'battle:created'를 쏘는 경우
  socket.on('battle:created', (battle) => {
    if (!battle) return;
    battleId = battle.id || battle.battleId || battleId;
    onBattleUpdate(battle);
    toast('전투가 생성되었습니다');
    // 컨트롤 활성화
    setCtrlEnabled(true);
    els.btnStart.disabled = false;
    els.btnAdd.disabled = false;
    els.btnGenPlayer.disabled = false;
    els.btnGenSpectator.disabled = false;
    els.btnBuildSpectator.disabled = false;
  });

  // 일부 서버는 'admin:created' 같은 네임으로 보낼 수 있어 대비
  socket.on('admin:created', (payload) => {
    if (!payload?.battle) return;
    battleId = payload.battle.id || payload.battle.battleId || battleId;
    onBattleUpdate(payload.battle);
    toast('전투가 생성되었습니다');
    setCtrlEnabled(true);
    els.btnStart.disabled = false;
    els.btnAdd.disabled = false;
    els.btnGenPlayer.disabled = false;
    els.btnGenSpectator.disabled = false;
    els.btnBuildSpectator.disabled = false;
  });
}

// init() 안에서 bindUI() 후에 한 줄 추가해 주세요.
// bindSocketCreateHooks();

// 2) 전투 생성 로직: 소켓 우선 → REST 폴백(두 경로 다 시도)
async function onCreateBattle(){
  const mode = els.mode.value || '4v4';

  // 2-1) 소켓 기반 생성 먼저 시도
  try {
    // 신/구 네임스페이스 모두 발사
    socket.emit('createBattle', { mode });
    socket.emit('battle:create', { mode });

    // 대부분의 서버는 이어서 battle:update를 브로드캐스트 해줍니다.
    // 1.5초 안에 상태가 갱신되면 성공으로 간주
    const ok = await waitForUpdate(1500);
    if (ok) {
      toast('전투가 생성되었습니다');
      // 컨트롤 활성화
      setCtrlEnabled(true);
      els.btnStart.disabled = false;
      els.btnAdd.disabled = false;
      els.btnGenPlayer.disabled = false;
      els.btnGenSpectator.disabled = false;
      els.btnBuildSpectator.disabled = false;
      return;
    }
  } catch (_) {
    // 소켓 실패 시 조용히 REST로 폴백
  }

  // 2-2) REST 폴백: /api/admin/battles → /api/battles 순서로 시도
  const payload = { mode };
  const headers = { 'Content-Type': 'application/json' };

  // (a) /api/admin/battles
  try {
    let res = await fetch(`/api/admin/battles`, {
      method: 'POST', headers, body: JSON.stringify(payload)
    });
    if (res.ok) {
      const battle = await res.json();
      battleId = battle?.id || battle?.battleId || null;
      socket.emit('join', { battleId }); // 룸 합류
      onBattleUpdate(battle);
      toast('전투가 생성되었습니다');
      setCtrlEnabled(true);
      els.btnStart.disabled = false;
      els.btnAdd.disabled = false;
      els.btnGenPlayer.disabled = false;
      els.btnGenSpectator.disabled = false;
      els.btnBuildSpectator.disabled = false;
      return;
    }
  } catch (_) {}

  // (b) /api/battles
  try {
    let res = await fetch(`/api/battles`, {
      method: 'POST', headers, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('REST 생성 실패');
    const battle = await res.json();
    battleId = battle?.id || battle?.battleId || null;
    socket.emit('join', { battleId }); // 룸 합류
    onBattleUpdate(battle);
    toast('전투가 생성되었습니다');
    setCtrlEnabled(true);
    els.btnStart.disabled = false;
    els.btnAdd.disabled = false;
    els.btnGenPlayer.disabled = false;
    els.btnGenSpectator.disabled = false;
    els.btnBuildSpectator.disabled = false;
    return;
  } catch (e) {
    alert('전투 생성 실패: 소켓/REST 모두 응답 없음');
  }
}

// 3) battle:update 대기 유틸
function waitForUpdate(ms){
  return new Promise((resolve)=>{
    let hit = false;
    const handler = (snap)=>{
      if (hit) return;
      if (snap?.id) {
        hit = true;
        socket.off('battleUpdate', handler);
        socket.off('battle:update', handler);
        battleId = snap.id;
        onBattleUpdate(snap);
        resolve(true);
      }
    };
    socket.on('battleUpdate', handler);
    socket.on('battle:update', handler);
    setTimeout(()=>{
      if (!hit) {
        socket.off('battleUpdate', handler);
        socket.off('battle:update', handler);
        resolve(false);
      }
    }, ms);
  });
}
