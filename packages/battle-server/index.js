// index.js 수정사항

// 1. 환경변수 수정 (파일 상단 부분)
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://pyxisbattlesystem.monster';

// 2. 전투 참가자 추가 Socket 이벤트 수정
socket.on('addPlayer', ({ battleId, playerData }) => {
  try {
    console.log(`[SOCKET] 전투 참가자 추가 요청:`, playerData);
    
    const battle = ensureBattle(battleId);
    
    // 이름 중복 체크 수정
    const existingPlayer = battle.players.find(p => p.name === playerData.name);
    if (existingPlayer) {
      console.log(`[SOCKET] 중복된 이름: ${playerData.name}`);
      socket.emit('playerAdded', { 
        success: false, 
        error: `이미 등록된 이름입니다: ${playerData.name}` 
      });
      return;
    }
    
    // 팀별 인원 수 체크
    const teamPlayers = battle.players.filter(p => p.team === playerData.team);
    const maxPlayersPerTeam = parseInt(battle.mode.charAt(0)); // 1v1 -> 1, 2v2 -> 2
    
    if (teamPlayers.length >= maxPlayersPerTeam) {
      socket.emit('playerAdded', { 
        success: false, 
        error: `${playerData.team} 팀이 이미 가득 찼습니다 (${maxPlayersPerTeam}명)` 
      });
      return;
    }
    
    // 새 전투 참가자 생성
    const player = {
      id: `p_${Math.random().toString(36).slice(2, 10)}`,
      name: playerData.name,
      team: playerData.team,
      hp: parseInt(playerData.hp || 100),
      maxHp: parseInt(playerData.hp || 100),
      stats: {
        attack: parseInt(playerData.stats.attack || 3),
        defense: parseInt(playerData.stats.defense || 3),
        agility: parseInt(playerData.stats.agility || 3),
        luck: parseInt(playerData.stats.luck || 3)
      },
      items: {
        dittany: parseInt(playerData.items.dittany || 1),
        attack_booster: parseInt(playerData.items.attack_booster || 1),
        defense_booster: parseInt(playerData.items.defense_booster || 1)
      },
      avatar: playerData.avatar || null,
      isReady: false,
      isAlive: true
    };
    
    battle.players.push(player);
    pushLog(battle, 'system', `전투 참가자 추가: ${player.name} (${player.team}팀)`);
    
    // 모든 클라이언트에게 업데이트 전송
    io.to(battleId).emit('battle:update', serializeBattle(battle));
    socket.emit('playerAdded', { success: true, player });
    
    console.log(`[SOCKET] 전투 참가자 추가 완료: ${player.name}`);
    
  } catch (error) {
    console.error('[SOCKET] 전투 참가자 추가 오류:', error);
    socket.emit('playerAdded', { 
      success: false, 
      error: `전투 참가자 추가 실패: ${error.message}` 
    });
  }
});

// 3. 전투 생성 시 URL 생성 수정
function createNewBattle(mode = '1v1') {
  const battleId = `b_${Math.random().toString(36).slice(2, 10)}`;
  const battle = ensureBattle(battleId);
  battle.mode = mode;
  battle.status = 'waiting';
  pushLog(battle, 'system', `전투 생성: 모드=${mode}`);
  
  // URL 생성 수정
  const adminUrl = `${PUBLIC_BASE_URL}/admin?battle=${battleId}&token=admin-${battleId}`;
  const playerBase = `${PUBLIC_BASE_URL}/player?battle=${battleId}`;
  const spectatorBase = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}`;
  
  return {
    battleId,
    battle,
    adminUrl,
    playerBase,
    spectatorBase
  };
}

// 4. 전투 참가자별 링크 생성 수정
socket.on('generatePlayerOtp', ({ battleId }) => {
  try {
    console.log(`[SOCKET] 전투 참가자 링크 생성: ${battleId}`);
    
    const battle = ensureBattle(battleId);
    
    if (battle.players.length === 0) {
      socket.emit('playerOtpGenerated', { 
        success: false, 
        error: '먼저 전투 참가자를 추가하세요' 
      });
      return;
    }
    
    const playerLinks = battle.players.map(player => ({
      name: player.name,
      url: `${PUBLIC_BASE_URL}/player?battle=${battleId}&token=player-${player.name}-${battleId}&name=${encodeURIComponent(player.name)}`
    }));
    
    socket.emit('playerOtpGenerated', { success: true, playerLinks });
    console.log(`[SOCKET] 전투 참가자 링크 생성 완료: ${playerLinks.length}개`);
    
  } catch (error) {
    console.error('[SOCKET] 전투 참가자 링크 생성 오류:', error);
    socket.emit('playerOtpGenerated', { 
      success: false, 
      error: error.message 
    });
  }
});

// 5. 관전자 링크 생성 수정
socket.on('generateSpectatorOtp', ({ battleId }) => {
  try {
    console.log(`[SOCKET] 관전자 링크 생성: ${battleId}`);
    
    const spectatorUrl = `${PUBLIC_BASE_URL}/spectator?battle=${battleId}&otp=spectator-${battleId}`;
    
    socket.emit('spectatorOtpGenerated', { success: true, spectatorUrl });
    console.log(`[SOCKET] 관전자 링크 생성 완료: ${spectatorUrl}`);
    
  } catch (error) {
    console.error('[SOCKET] 관전자 링크 생성 오류:', error);
    socket.emit('spectatorOtpGenerated', { 
      success: false, 
      error: error.message 
    });
  }
});

// 6. REST API도 수정
app.post('/api/battles', (req, res) => {
  try {
    const mode = String(req.body?.mode || '1v1');
    const result = createNewBattle(mode);
    
    res.json({
      ok: true,
      id: result.battleId,
      adminUrl: result.adminUrl,
      playerBase: result.playerBase,
      spectatorBase: result.spectatorBase
    });
  } catch (error) {
    console.error('전투 생성 API 오류:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});
